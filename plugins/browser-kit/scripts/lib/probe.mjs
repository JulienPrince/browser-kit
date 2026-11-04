// Open a page with Playwright and report what went wrong, compactly.
// Shared by netcheck.mjs (observe) and mock.mjs (observe + mock + inject).

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { findAllPlaywrights, launch } from "./playwright.mjs";

const MAX_TEXT = 300;
const MAX_URL = 200;
const DEFAULT_ALL_CAP = 200;
// Playwright's route.abort() error codes.
export const ABORT_CODES = [
  "aborted", "accessdenied", "addressunreachable", "blockedbyclient", "blockedbyresponse",
  "connectionaborted", "connectionclosed", "connectionfailed", "connectionrefused", "connectionreset",
  "internetdisconnected", "namenotresolved", "timedout", "failed",
];

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
// eslint-disable-next-line no-control-regex
const plain = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");

export class UsageError extends Error {}

export function parseArgs(argv, { allowMocks }) {
  const opts = {
    url: null, wait: 1500, timeout: 30000, deadline: 120000, browser: "chromium", headed: false, all: false,
    warnings: false, screenshot: null, script: null, mocks: null, inject: [], max: 30, maxGiven: false,
    viewport: { width: 1280, height: 800 },
  };
  const valueFlags = ["--wait", "--timeout", "--deadline", "--browser", "--screenshot", "--script", "--max"];
  if (allowMocks) valueFlags.push("--mocks", "--inject");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") throw new UsageError("");
    else if (a === "--headed") opts.headed = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--warnings") opts.warnings = true;
    else if (valueFlags.includes(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      const v = argv[++i];
      if (a === "--wait") opts.wait = num(a, v, 0);
      else if (a === "--timeout") opts.timeout = num(a, v, 1);
      else if (a === "--deadline") opts.deadline = num(a, v, 1);
      else if (a === "--max") (opts.max = num(a, v, 1)), (opts.maxGiven = true);
      else if (a === "--browser") opts.browser = v;
      else if (a === "--screenshot") opts.screenshot = resolve(v);
      else if (a === "--script") opts.script = resolve(v);
      else if (a === "--mocks") opts.mocks = resolve(v);
      else if (a === "--inject") opts.inject.push(resolve(v));
    } else if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
    else if (!opts.url) opts.url = a;
    else throw new UsageError(`unexpected argument ${a}`);
  }
  if (!opts.url) throw new UsageError("missing URL");
  if (!/^(https?|file):/.test(opts.url)) throw new UsageError(`URL must start with http(s):// or file:// (${opts.url})`);
  if (!["chromium", "firefox", "webkit"].includes(opts.browser)) throw new UsageError("--browser must be chromium, firefox or webkit");
  if (allowMocks && !opts.mocks && !opts.inject.length) throw new UsageError("give --mocks and/or --inject");
  for (const f of [opts.mocks, ...opts.inject, opts.script].filter(Boolean)) {
    if (!existsSync(f)) throw new UsageError(`file not found: ${f}`);
  }
  if (opts.mocks) opts.mockList = loadMocks(opts.mocks); // fail fast, before starting a browser
  return opts;
}

function num(flag, v, min) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new UsageError(`${flag} must be a number ≥ ${min}`);
  return n;
}

/** Mocks file: JSON array of { url, method?, status?, json?, body?, headers?, contentType?, abort?, delayMs? }. */
export function loadMocks(path) {
  let list;
  try {
    list = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`can't read mocks ${path}: ${e.message}`);
  }
  if (!Array.isArray(list)) throw new UsageError("mocks file must be a JSON array");
  list.forEach((m, i) => {
    const where = `mock #${i + 1}`;
    if (!m || typeof m.url !== "string") throw new UsageError(`${where} needs a "url" glob or /regex/`);
    if (m.abort !== undefined && m.abort !== true && !ABORT_CODES.includes(m.abort)) {
      throw new UsageError(`${where}: "abort" must be true or one of ${ABORT_CODES.join(", ")}`);
    }
    if (m.status !== undefined && !(Number.isInteger(m.status) && m.status >= 100 && m.status <= 599)) {
      throw new UsageError(`${where}: "status" must be an HTTP status code`);
    }
    if (m.method !== undefined && typeof m.method !== "string") throw new UsageError(`${where}: "method" must be a string like "GET"`);
    if (m.body !== undefined && typeof m.body !== "string") throw new UsageError(`${where}: "body" must be a string (use "json" for objects)`);
    if (m.contentType !== undefined && typeof m.contentType !== "string") throw new UsageError(`${where}: "contentType" must be a string`);
    if (m.headers !== undefined && (typeof m.headers !== "object" || m.headers === null || Array.isArray(m.headers) ||
        Object.values(m.headers).some((v) => typeof v !== "string"))) {
      throw new UsageError(`${where}: "headers" must be an object of string values`);
    }
    if (m.delayMs !== undefined && !(Number.isFinite(m.delayMs) && m.delayMs >= 0)) {
      throw new UsageError(`${where}: "delayMs" must be a number ≥ 0`);
    }
    try {
      matcher(m.url);
    } catch (e) {
      throw new UsageError(`${where}: bad regex ${m.url}: ${e.message}`);
    }
  });
  return list.map((m) => ({ ...m, hits: 0 }));
}

export function matcher(pattern) {
  const re = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  // g/y make RegExp.test stateful (lastIndex), so a pattern would match every other request.
  return re ? new RegExp(re[1], re[2].replace(/[gy]/g, "")) : pattern; // glob string handled by Playwright
}

export async function probe(opts) {
  const report = {
    url: opts.url, finalUrl: null, status: null, title: null, ms: 0, playwright: null, browser: opts.browser,
    failedRequests: [], consoleErrors: [], pageErrors: [], requests: { total: 0, byType: {} },
  };
  opts.partial = report; // printed by the --deadline watchdog if the run never finishes
  const installs = findAllPlaywrights();
  const started = Date.now();
  const { browser, found } = await launch(installs, { ...opts, timeout: Math.min(opts.timeout, 60000) });
  report.playwright = `${found.version} (${found.source})`;
  const all = [];
  const pending = new Set(); // async event handlers still running
  const timers = new Set(); // delayMs timers, cleared at the end so the process can exit
  const track = (p) => {
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  try {
    const context = await browser.newContext({
      viewport: opts.viewport,
      // A service worker could answer requests before route() sees them.
      ...(opts.mockList && { serviceWorkers: "block" }),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeout);
    page.setDefaultNavigationTimeout(opts.timeout);

    for (const file of opts.inject) await context.addInitScript({ path: file });
    if (opts.inject.length) report.injected = opts.inject;

    if (opts.mockList) {
      report.mocks = opts.mockList;
      // Playwright tries the most recently added route first; add in reverse so the first mock wins.
      for (const m of [...opts.mockList].reverse()) {
        await context.route(matcher(m.url), async (route) => {
          if (m.method && route.request().method() !== m.method.toUpperCase()) return route.fallback();
          m.hits++;
          if (m.delayMs) {
            await new Promise((r) => {
              const t = setTimeout(() => {
                timers.delete(t);
                r();
              }, m.delayMs);
              timers.add(t);
            });
          }
          try {
            if (m.abort) return await route.abort(m.abort === true ? "failed" : m.abort);
            const fulfill = { status: m.status ?? 200, headers: m.headers };
            if (m.json !== undefined) fulfill.json = m.json;
            else {
              fulfill.body = m.body ?? "";
              if (m.contentType) fulfill.contentType = m.contentType;
            }
            return await route.fulfill(fulfill);
          } catch {} // page closed meanwhile
        });
      }
    }

    const timings = new Map();
    page.on("request", (req) => {
      timings.set(req, Date.now());
      report.requests.total++;
      const t = req.resourceType();
      report.requests.byType[t] = (report.requests.byType[t] || 0) + 1;
    });
    const record = async (req, failed) => {
      const res = await req.response().catch(() => null);
      const status = res ? res.status() : null;
      const entry = { method: req.method(), url: clip(req.url(), MAX_URL), type: req.resourceType() };
      if (failed) {
        // Chromium aborts some answered requests (a 404 script, say): keep the HTTP status when there is one.
        entry.error = req.failure()?.errorText || "failed";
        if (status !== null) entry.status = status;
      } else {
        entry.status = status;
        entry.ms = Date.now() - (timings.get(req) || Date.now());
      }
      if (opts.all) all.push(entry);
      if (failed || (status !== null && status >= 400)) report.failedRequests.push(entry);
    };
    page.on("requestfinished", (req) => track(record(req, false)));
    page.on("requestfailed", (req) => track(record(req, true)));
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || (opts.warnings && type === "warning")) {
        const loc = msg.location();
        report.consoleErrors.push({ type, text: clip(msg.text(), MAX_TEXT), at: loc?.url ? `${clip(loc.url, MAX_URL)}:${loc.lineNumber}` : undefined });
      }
    });
    page.on("pageerror", (err) => {
      const where = (err.stack || "").split("\n").find((l) => /^\s*at /.test(l));
      report.pageErrors.push(clip(err.message + (where ? ` (${where.trim()})` : ""), MAX_TEXT));
    });

    try {
      const response = await page.goto(opts.url, { waitUntil: "load" });
      report.status = response ? response.status() : null;
      if (opts.script) {
        const mod = await import(pathToFileURL(opts.script).href);
        if (typeof mod.default !== "function") throw new Error(`${opts.script} must export a default async function (page, { log })`);
        const logs = [];
        const log = (...a) => logs.push(a.map(String).join(" "));
        // stdout is the JSON report: route the script's console.log/info into scriptLog.
        const saved = { log: console.log, info: console.info };
        console.log = console.info = log;
        try {
          await mod.default(page, { log });
        } finally {
          Object.assign(console, saved);
          if (logs.length) report.scriptLog = logs.map((l) => clip(l, MAX_TEXT));
        }
      }
      if (opts.wait) await page.waitForTimeout(opts.wait);
    } catch (e) {
      // Keep what was observed so far: it often explains the failure.
      report.error = clip(plain(e.message).split("\nCall log:")[0].trim(), 600);
    }
    report.finalUrl = page.url();
    report.title = await page.title().catch(() => null);
    if (opts.screenshot) {
      try {
        mkdirSync(dirname(opts.screenshot), { recursive: true });
        await page.screenshot({ path: opts.screenshot });
        report.screenshot = opts.screenshot;
      } catch (e) {
        report.screenshotError = clip(plain(e.message), 300);
      }
    }
    let grace;
    await Promise.race([Promise.allSettled([...pending]), new Promise((r) => (grace = setTimeout(r, 2000)))]);
    clearTimeout(grace);
  } finally {
    for (const t of timers) clearTimeout(t);
    report.ms = Date.now() - started;
    await browser.close().catch(() => {});
  }

  for (const key of ["failedRequests", "consoleErrors", "pageErrors"]) {
    if (report[key].length > opts.max) {
      report[`${key}Truncated`] = report[key].length - opts.max;
      report[key] = report[key].slice(0, opts.max);
    }
  }
  if (opts.all) {
    const cap = opts.maxGiven ? opts.max : DEFAULT_ALL_CAP;
    if (all.length > cap) report.allTruncated = all.length - cap;
    report.all = all.slice(0, cap);
  }
  if (report.mocks) report.mocks = report.mocks.map((m) => ({ url: m.url, ...(m.method && { method: m.method }), hits: m.hits }));
  report.ok = !report.error && !report.failedRequests.length && !report.consoleErrors.length && !report.pageErrors.length &&
    (report.status === null || report.status < 400);
  return report;
}

export async function main(argv, { allowMocks, usage }) {
  let opts;
  try {
    opts = parseArgs(argv, { allowMocks });
  } catch (e) {
    if (e instanceof UsageError) {
      if (!e.message) {
        console.log(usage); // --help
        return 0;
      }
      console.error(`error: ${e.message}\n`);
      console.error(usage);
      return 2;
    }
    throw e;
  }
  // Last resort against anything that hangs (a stuck --script, a browser that never answers).
  const watchdog = setTimeout(() => {
    // Print what was observed so far: it usually shows where the run got stuck.
    const partial = { ...(opts.partial || { url: opts.url }) };
    if (partial.mocks) partial.mocks = partial.mocks.map((m) => ({ url: m.url, hits: m.hits }));
    for (const key of ["failedRequests", "consoleErrors", "pageErrors"]) if (partial[key]) partial[key] = partial[key].slice(0, opts.max);
    Object.assign(partial, { ok: false, error: `gave up after --deadline ${opts.deadline} ms (partial report)` });
    process.stdout.write(JSON.stringify(partial, null, 2) + "\n", () => process.exit(2));
  }, opts.deadline);
  try {
    const report = await probe(opts);
    console.log(JSON.stringify(report, null, 2));
    return report.error ? 2 : report.ok ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ url: opts.url, ok: false, error: clip(plain(e.message), 600), tried: e.tried }, null, 2));
    return 2;
  } finally {
    clearTimeout(watchdog);
  }
}
