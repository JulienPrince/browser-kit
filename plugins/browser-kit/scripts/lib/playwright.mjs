// Find a Playwright install without adding a dependency to the plugin.
// Order: $BROWSER_KIT_PLAYWRIGHT, the current project, dev-browser's runtime.
// launch() falls through to the next install when one has no browser downloaded.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const INSTALL_HINT =
  "No Playwright found. Either add it to the project (npm i -D playwright && npx playwright install chromium) " +
  "or install dev-browser (npm i -g dev-browser && dev-browser install), whose runtime bundles Playwright.";

function candidates(cwd) {
  const list = [];
  if (process.env.BROWSER_KIT_PLAYWRIGHT) {
    list.push({ source: "env", base: join(process.env.BROWSER_KIT_PLAYWRIGHT, "noop.js"), id: process.env.BROWSER_KIT_PLAYWRIGHT });
  }
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    list.push({ source: `project (${name})`, base: join(cwd, "noop.js"), id: name });
  }
  list.push({ source: "dev-browser", base: join(homedir(), ".dev-browser", "noop.js"), id: "playwright" });
  return list;
}

function versionOf(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const data = JSON.parse(readFileSync(pkg, "utf8"));
        if (data.name && data.version) return data.version;
      } catch {}
    }
    dir = dirname(dir);
  }
  return "unknown";
}

/** Every usable Playwright install, best first: [{ pw, source, version, path }]. */
export function findAllPlaywrights(cwd = process.cwd()) {
  const found = [];
  const tried = [];
  const seen = new Set();
  for (const c of candidates(cwd)) {
    try {
      const require = createRequire(c.base);
      const path = require.resolve(c.id);
      if (seen.has(path)) continue;
      const pw = require(path);
      if (!pw.chromium) throw new Error("no chromium export");
      seen.add(path);
      found.push({ pw, source: c.source, version: versionOf(path), path });
    } catch (e) {
      tried.push(`${c.source}: ${e.code || e.message}`);
    }
  }
  if (!found.length) {
    const err = new Error(INSTALL_HINT);
    err.tried = tried;
    throw err;
  }
  return found;
}

/** The first install found (for reporting); launch() may still fall through to another. */
export function findPlaywright(cwd = process.cwd()) {
  return findAllPlaywrights(cwd)[0];
}

const MISSING_BROWSER = /Executable doesn't exist|Looks like Playwright .* was just installed|please run .*playwright install/i;

/** Launch with the first install that has the browser. Returns { browser, found }. */
export async function launch(installs, { browser = "chromium", headed = false, timeout = 30000 } = {}) {
  const missing = [];
  for (const found of installs) {
    const type = found.pw[browser];
    if (!type) throw new Error(`Unknown browser '${browser}' (use chromium, firefox or webkit).`);
    try {
      return { browser: await type.launch({ headless: !headed, timeout }), found };
    } catch (e) {
      if (!MISSING_BROWSER.test(e.message)) throw e;
      missing.push(found);
    }
  }
  const first = missing[0];
  throw new Error(
    `No ${browser} build is downloaded for the Playwright installs found (${missing.map((f) => `${f.version} via ${f.source}`).join(", ")}). ` +
      `Run: npx playwright@${first.version} install ${browser}`,
  );
}
