#!/usr/bin/env node
// Open a URL in a fresh headless browser and print a compact JSON report of what failed:
// HTTP >= 400 and network errors, console errors, uncaught page errors.
// Exit code: 0 clean, 1 problems found, 2 couldn't run or finish (usage, setup, or the page/--script failed:
// the report's "error" says why and keeps what was observed until then).

import { main } from "./lib/probe.mjs";

const usage = `usage: netcheck.mjs <url> [options]

  --wait <ms>          extra time after load for late requests (default 1500)
  --script <file.mjs>  run steps after load: export default async (page, { log }) => {...}
  --screenshot <png>   save a screenshot (put it in the workspace's images/)
  --all                also list every request (method, url, status, ms)
  --warnings           include console warnings
  --browser <name>     chromium (default), firefox or webkit
  --headed             show the browser window
  --timeout <ms>       per-action timeout (default 30000)
  --deadline <ms>      give up on the whole run after this long (default 120000)
  --max <n>            cap each list (default 30; --all defaults to 200)
  A --script file runs with full Node privileges: only use files you wrote. Use log(), not console.log.`;

process.exitCode = await main(process.argv.slice(2), { allowMocks: false, usage });
