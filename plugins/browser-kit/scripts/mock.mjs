#!/usr/bin/env node
// Open a URL with mocked network responses and/or scripts injected before any page script,
// then print the same compact JSON report as netcheck.mjs, plus how often each mock was hit.
// Exit code: 0 clean, 1 problems found, 2 couldn't run or finish (usage, setup, or the page/--script failed:
// the report's "error" says why and keeps what was observed until then).

import { main } from "./lib/probe.mjs";

const usage = `usage: mock.mjs <url> --mocks <mocks.json> [--inject <file.js>]... [options]

  --mocks <file.json>  JSON array of mocks, the first matching one wins:
                         { "url": "**/api/users*" | "/regex/", "method": "GET",
                           "status": 200, "json": {...} | "body": "...", "contentType": "...",
                           "headers": {...}, "delayMs": 0, "abort": "failed" }
                       method is case-insensitive; abort is true or a Playwright error code
                       (connectionrefused, timedout, internetdisconnected, failed, ...)
  --inject <file.js>   script run in every page before its own scripts (repeatable)
  --script <file.mjs>  run steps after load: export default async (page, { log }) => {...}
  --wait <ms>          extra time after load (default 1500)
  --screenshot <png>   save a screenshot (put it in the workspace's images/)
  --all                also list every request
  --warnings           include console warnings
  --browser <name>     chromium (default), firefox or webkit
  --headed             show the browser window
  --timeout <ms>       per-action timeout (default 30000)
  --deadline <ms>      give up on the whole run after this long (default 120000)
  --max <n>            cap each list (default 30; --all defaults to 200)
  --script (Node) and --inject (page) files run with full privileges: only use files you wrote.
  In --script, use log() (console.log is captured into scriptLog too).`;

process.exitCode = await main(process.argv.slice(2), { allowMocks: true, usage });
