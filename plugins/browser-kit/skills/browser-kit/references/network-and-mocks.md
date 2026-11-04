# Network reports, mocks and injected scripts

Both scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/` (quote the path: it may contain spaces). They use the
project's Playwright if it has a browser downloaded, else dev-browser's (`doctor.mjs` shows which). They start
a fresh, logged-out headless Chromium each run; with `--mocks`, service workers are blocked so they can't
answer requests before the mocks.

## Report shape (netcheck and mock)

```json
{
  "url": "...", "finalUrl": "...", "status": 200, "title": "...", "ms": 1289,
  "playwright": "1.58.2 (dev-browser)", "browser": "chromium",
  "failedRequests": [{ "method": "GET", "url": "...", "status": 500, "type": "fetch", "ms": 12 },
                     { "method": "GET", "url": "...", "error": "net::ERR_ABORTED", "status": 404, "type": "script" }],
  "consoleErrors": [{ "type": "error", "text": "...", "at": "https://.../app.js:42" }],
  "pageErrors": ["TypeError: x is undefined (at render (app.js:10:5))"],
  "requests": { "total": 37, "byType": { "document": 1, "script": 12, "fetch": 9 } },
  "mocks": [{ "url": "**/api/users*", "hits": 1 }],
  "scriptLog": ["..."],
  "ok": false
}
```

Lists are capped (`--max`, default 30; `*Truncated` says how many were dropped). Texts and URLs are clipped.

## Recipes

**A page "doesn't load data"**: `netcheck.mjs <url> --wait 3000` → look for the API call in
`failedRequests`; no failure but empty UI → `--all` to see whether the call happened at all.

**Behind a login**: steps file logs in first (use test credentials the user gives you, never guess
real ones), then navigates:

```js
// steps.mjs
export default async (page, { log }) => {
  await page.getByLabel("Email").fill(process.env.TEST_EMAIL);
  await page.getByLabel("Password").fill(process.env.TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
  await page.goto(new URL("/reports", page.url()).href);
  log("on", page.url());
};
```

Run with `TEST_EMAIL=... TEST_PASSWORD=... node "${CLAUDE_PLUGIN_ROOT}/scripts/netcheck.mjs" http://localhost:3000/login --script steps.mjs`.

**Error UI**: mock the endpoint with `"status": 500` (or `"abort": "connectionrefused"` for offline,
`"delayMs": 5000` for a spinner/timeout), then `--script` checks what the user sees and `--screenshot`
captures it.

**Race conditions**: give two endpoints different `delayMs` to force an order the real backend rarely produces.

**Spy on the page before it loads** (`--inject spy.js`):

```js
// spy.js - record every fetch the app makes, readable from steps.mjs via page.evaluate
window.__calls = [];
const real = window.fetch;
window.fetch = (...args) => { window.__calls.push(String(args[0])); return real(...args); };
```

```js
// steps.mjs
export default async (page, { log }) => log(JSON.stringify(await page.evaluate(() => window.__calls)));
```

Other injection uses: feature flags (`localStorage.setItem(...)` before the app boots), freezing
`Date.now`, disabling animations, silencing a third-party widget.

**Mock didn't apply** (`hits: 0`): the glob must match the full URL (`**/api/users*` not `/api/users`);
for query strings end with `*`; regex form is `"/\\/api\\/users\\b/"` (escape for JSON). `method` is
case-insensitive. Mocks are tried in file order: put specific patterns before broad ones like `**/api/*`.

## Limits

- Fresh browser each run: no session from zenpilot or dev-browser carries over; log in via `--script`.
- Service workers are blocked when `--mocks` is given; a PWA that needs its service worker to work
  can't be tested with mocks this way - use netcheck without mocks, or a Playwright test.
- WebSockets aren't mocked by `mocks.json`.
