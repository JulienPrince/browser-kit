// End-to-end tests of netcheck.mjs, mock.mjs and doctor.mjs against a local server.
// Run: node --test tests/   (needs a Playwright with chromium, see scripts/doctor.mjs)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "scripts");
const tmp = mkdtempSync(join(tmpdir(), "browser-kit-"));
let base;
let server;

const BUGGY = `<!doctype html><title>buggy</title>
<ul id="users"></ul><p id="flag"></p>
<script src="/missing.js"></script>
<script>
  document.getElementById("flag").textContent = window.__flag || "none";
  fetch("/api/users").then(r => r.json()).then(list => {
    document.getElementById("users").textContent = list.map(u => u.name).join(",");
  }).catch(e => { document.getElementById("users").textContent = "fetch failed"; });
  fetch("/api/broken");
  console.error("boom from console");
  setTimeout(() => { throw new Error("kaboom uncaught"); }, 10);
</script>`;

before(async () => {
  server = createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    if (req.url === "/") return send(200, "text/html", BUGGY);
    if (req.url === "/clean") return send(200, "text/html", "<!doctype html><title>clean</title><p>ok</p>");
    if (req.url === "/api/users") return send(200, "application/json", JSON.stringify([{ name: "Real" }]));
    if (req.url === "/api/broken") return send(500, "application/json", '{"error":"server"}');
    return send(404, "text/plain", "not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Async on purpose: the test server lives in this process and must keep answering.
function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(scripts, script), ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      resolve({ code, json, stdout, stderr });
    });
  });
}

async function closedPort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test("netcheck: a clean page exits 0", async () => {
  const r = await run("netcheck.mjs", [`${base}/clean`, "--wait", "100"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.status, 200);
  assert.equal(r.json.title, "clean");
});

test("netcheck: reports HTTP errors, console errors and uncaught exceptions", async () => {
  const r = await run("netcheck.mjs", [`${base}/`, "--wait", "300"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const failed = Object.fromEntries(r.json.failedRequests.map((f) => [new URL(f.url).pathname, f.status]));
  assert.equal(failed["/api/broken"], 500);
  assert.equal(failed["/missing.js"], 404);
  assert.ok(r.json.consoleErrors.some((c) => c.text.includes("boom from console")));
  assert.ok(r.json.pageErrors.some((e) => e.includes("kaboom uncaught")));
});

test("mock: mocked responses, injected script and steps", async () => {
  const mocks = join(tmp, "mocks.json");
  writeFileSync(mocks, JSON.stringify([
    { url: "**/api/users", json: [{ name: "Mocked" }] },
    { url: "/\\/api\\/broken$/", method: "GET", status: 200, json: { fixed: true } },
    { url: "**/missing.js", body: "/* stub */", contentType: "application/javascript" },
  ]));
  const inject = join(tmp, "inject.js");
  writeFileSync(inject, 'window.__flag = "injected"; console.log = console.log;');
  const steps = join(tmp, "steps.mjs");
  writeFileSync(steps, `export default async (page, { log }) => {
    await page.waitForFunction(() => document.getElementById("users").textContent !== "");
    log("users=" + await page.textContent("#users"));
    log("flag=" + await page.textContent("#flag"));
  };`);
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--inject", inject, "--script", steps, "--wait", "300"]);
  assert.ok(r.json, r.stdout + r.stderr);
  assert.deepEqual(r.json.scriptLog, ["users=Mocked", "flag=injected"]);
  assert.deepEqual(r.json.mocks.map((m) => m.hits), [1, 1, 1]);
  assert.equal(r.json.failedRequests.length, 0); // everything that failed is now mocked
  assert.ok(r.json.pageErrors.some((e) => e.includes("kaboom"))); // still reported
  assert.equal(r.code, 1);
});

test("mock: abort simulates a network failure", async () => {
  const mocks = join(tmp, "abort.json");
  writeFileSync(mocks, JSON.stringify([{ url: "**/api/users", abort: "connectionrefused" }]));
  const steps = join(tmp, "abort-steps.mjs");
  writeFileSync(steps, `export default async (page, { log }) => {
    await page.waitForFunction(() => document.getElementById("users").textContent !== "");
    log(await page.textContent("#users"));
  };`);
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--script", steps, "--wait", "100"]);
  assert.deepEqual(r.json.scriptLog, ["fetch failed"]);
  const users = r.json.failedRequests.find((f) => f.url.endsWith("/api/users"));
  assert.match(users.error, /CONNECTION_REFUSED|refused/i);
});

test("screenshot is written", async () => {
  const png = join(tmp, "images", "clean.png");
  const r = await run("netcheck.mjs", [`${base}/clean`, "--wait", "0", "--screenshot", png]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(existsSync(png));
  assert.equal(r.json.screenshot, png);
});

test("--all lists every request", async () => {
  const r = await run("netcheck.mjs", [`${base}/`, "--wait", "300", "--all"]);
  const paths = r.json.all.map((e) => new URL(e.url).pathname);
  for (const p of ["/", "/missing.js", "/api/users", "/api/broken"]) assert.ok(paths.includes(p), p);
});

test("usage errors exit 2 with help", async () => {
  assert.equal((await run("netcheck.mjs", [])).code, 2);
  assert.equal((await run("netcheck.mjs", ["not-a-url"])).code, 2);
  assert.equal((await run("netcheck.mjs", [`${base}/`, "--mocks", "x.json"])).code, 2); // mocks only in mock.mjs
  assert.equal((await run("mock.mjs", [`${base}/`])).code, 2);
  const bad = join(tmp, "bad.json");
  writeFileSync(bad, '{"url": "not an array"}');
  const r = await run("mock.mjs", [`${base}/`, "--mocks", bad]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /JSON array/);
});

test("unreachable site is a setup error, not a crash", async () => {
  const r = await run("netcheck.mjs", [`http://127.0.0.1:${await closedPort()}/`, "--timeout", "5000"]);
  assert.equal(r.code, 2);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /ERR_CONNECTION_REFUSED|refused/i);
  assert.doesNotMatch(r.json.error, /Call log/);
});

test("doctor: which() scans PATH without a shell", async () => {
  const { which } = await import("../scripts/doctor.mjs");
  assert.equal(which("node", dirname(process.execPath)), process.execPath);
  assert.equal(which("definitely-not-a-command-xyz"), null);
});

test("doctor --json reports every tool with a fix when missing", async () => {
  const out = (await run("doctor.mjs", ["--json"])).json;
  for (const k of ["node", "playwright", "devBrowser", "zenpilot"]) {
    assert.ok(k in out, k);
    assert.ok(out[k].ok || out[k].fix, `${k} must be ok or say how to fix it`);
  }
});

test("BROWSER_KIT_PLAYWRIGHT overrides the lookup; a bad one falls back", async () => {
  const { findPlaywright } = await import("../scripts/lib/playwright.mjs");
  const found = findPlaywright();
  process.env.BROWSER_KIT_PLAYWRIGHT = dirname(found.path);
  try {
    assert.equal(findPlaywright().source, "env");
    process.env.BROWSER_KIT_PLAYWRIGHT = join(tmp, "nope");
    assert.notEqual(findPlaywright().source, "env");
  } finally {
    delete process.env.BROWSER_KIT_PLAYWRIGHT;
  }
});

// --- regressions found in review ---------------------------------------------------------

const usersSteps = () => {
  const f = join(tmp, "users-steps.mjs");
  writeFileSync(f, `export default async (page, { log }) => {
    await page.waitForFunction(() => document.getElementById("users").textContent !== "");
    log(await page.textContent("#users"));
  };`);
  return f;
};

test("mock: the first matching mock wins, even with overlapping patterns", async () => {
  const mocks = join(tmp, "overlap.json");
  writeFileSync(mocks, JSON.stringify([
    { url: "**/api/users", json: [{ name: "Specific" }] },
    { url: "**/api/*", json: [{ name: "Generic" }] },
  ]));
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--script", usersSteps(), "--wait", "100"]);
  assert.deepEqual(r.json.scriptLog, ["Specific"]);
  assert.deepEqual(r.json.mocks.map((m) => m.hits), [1, 1]); // users → first, broken → second
});

test("mock: a method that doesn't match falls through to the next mock", async () => {
  const mocks = join(tmp, "method.json");
  writeFileSync(mocks, JSON.stringify([
    { url: "**/api/users", method: "post", json: [{ name: "Post" }] },
    { url: "**/api/users", method: "get", json: [{ name: "Get" }] },
  ]));
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--script", usersSteps(), "--wait", "100"]);
  assert.deepEqual(r.json.scriptLog, ["Get"]);
  assert.deepEqual(r.json.mocks.map((m) => m.hits), [0, 1]);
});

test("mock: a /regex/g pattern matches every request, not every other one", async () => {
  const mocks = join(tmp, "regex-g.json");
  writeFileSync(mocks, JSON.stringify([{ url: "/\\/api\\/(users|broken)$/g", json: [{ name: "Rx" }] }]));
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--wait", "300"]);
  assert.equal(r.json.mocks[0].hits, 2);
});

test("mock: invalid mocks are usage errors before any browser starts", async () => {
  for (const bad of [
    [{ url: "**/x", abort: "bogus" }],
    [{ url: "**/x", status: 99 }],
    [{ url: "**/x", delayMs: -1 }],
    [{ url: "/(unclosed/" }],
  ]) {
    const f = join(tmp, "invalid.json");
    writeFileSync(f, JSON.stringify(bad));
    const r = await run("mock.mjs", [`${base}/`, "--mocks", f]);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.match(r.stderr, /mock #1/);
  }
});

test("mock: a long delayMs doesn't keep the process alive after the run", async () => {
  const mocks = join(tmp, "slow.json");
  writeFileSync(mocks, JSON.stringify([{ url: "**/api/users", delayMs: 20000, json: [] }]));
  const t0 = Date.now();
  const r = await run("mock.mjs", [`${base}/`, "--mocks", mocks, "--wait", "200"]);
  assert.ok(r.json, r.stdout + r.stderr);
  assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
});

test("a failing --script keeps the report and says why", async () => {
  const steps = join(tmp, "throws.mjs");
  writeFileSync(steps, 'export default async (page, { log }) => { log("before"); throw new Error("step exploded"); };');
  const r = await run("netcheck.mjs", [`${base}/`, "--script", steps, "--wait", "300"]);
  assert.equal(r.code, 2);
  assert.match(r.json.error, /step exploded/);
  assert.deepEqual(r.json.scriptLog, ["before"]);
  assert.ok(r.json.failedRequests.length > 0); // observations made before the failure are kept
  assert.doesNotMatch(r.stdout, /\\u001b|\u001b/); // no terminal colour codes
});

test("--max caps every list, including --all", async () => {
  const r = await run("netcheck.mjs", [`${base}/`, "--wait", "300", "--all", "--max", "1"]);
  assert.equal(r.json.failedRequests.length, 1);
  assert.ok(r.json.failedRequestsTruncated >= 1);
  assert.equal(r.json.all.length, 1);
  assert.ok(r.json.allTruncated >= 3);
});

test("--timeout 0 is refused, --deadline stops a stuck run", async () => {
  assert.equal((await run("netcheck.mjs", [`${base}/`, "--timeout", "0"])).code, 2);
  const steps = join(tmp, "stuck.mjs");
  writeFileSync(steps, "export default async () => { await new Promise(() => {}); };");
  const t0 = Date.now();
  const r = await run("netcheck.mjs", [`${base}/clean`, "--script", steps, "--deadline", "3000"]);
  assert.equal(r.code, 2);
  assert.match(r.json.error, /deadline/);
  assert.ok(Date.now() - t0 < 10000);
});

test("second review: method/headers/body types, console.log in --script, --help, partial deadline report", async () => {
  for (const bad of [[{ url: "**/x", method: 5 }], [{ url: "**/x", headers: "x" }], [{ url: "**/x", body: { a: 1 } }]]) {
    const f = join(tmp, "invalid2.json");
    writeFileSync(f, JSON.stringify(bad));
    assert.equal((await run("mock.mjs", [`${base}/`, "--mocks", f])).code, 2, JSON.stringify(bad));
  }
  const noisy = join(tmp, "noisy.mjs");
  writeFileSync(noisy, 'export default async () => { console.log("hello from script"); };');
  const r = await run("netcheck.mjs", [`${base}/clean`, "--script", noisy, "--wait", "0"]);
  assert.ok(r.json, "stdout must stay pure JSON: " + r.stdout.slice(0, 80));
  assert.deepEqual(r.json.scriptLog, ["hello from script"]);
  const help = await run("netcheck.mjs", ["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: netcheck/);
  const stuck = join(tmp, "stuck2.mjs");
  writeFileSync(stuck, "export default async () => { await new Promise(() => {}); };");
  const d = await run("netcheck.mjs", [`${base}/`, "--script", stuck, "--deadline", "3000"]);
  assert.equal(d.code, 2);
  assert.match(d.json.error, /partial report/);
  assert.ok(d.json.failedRequests.length > 0); // observed before getting stuck
});
