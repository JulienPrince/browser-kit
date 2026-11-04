# dev-browser - scripted Playwright for local apps (CLI)

https://github.com/sawyerhood/dev-browser. Scripts run in a QuickJS sandbox (not Node) that forwards
calls to a daemon running real Playwright. `dev-browser --help` documents the full API (~4k tokens:
read it once per session at most, and only the part you need).

If `dev-browser` isn't on PATH, it may be installed under nvm: `ls ~/.nvm/versions/node/*/bin/dev-browser`
(`doctor.mjs` finds it).

## Verified in the sandbox

| Works | Doesn't work |
|---|---|
| `browser.getPage(name)` - named pages persist between calls | `page.route(...)` - hangs until the 30 s script timeout |
| `goto`, `click`, `fill`, `locator`, `getByRole`, `waitForURL`, `waitForResponse` | `page.addInitScript(...)` / `context.addInitScript` - `__transport_receive` error |
| `page.evaluate(fn)` - run JS in the page after load | Anything taking a callback that must answer back (route handlers) |
| Listeners: `page.on("request")`, `page.on("console")` | Node APIs: `require`, `fs`, `process`, `fetch` in the script itself |
| `saveScreenshot(buf, name)` → `~/.dev-browser/tmp/<name>` | |
| `page.domCua.getVisibleDom()` - visible interactive elements, cheap | |

For mocks and injected scripts use `mock.mjs`; for a network/console report `netcheck.mjs`.

## Recipes

```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("app");
await page.goto("http://localhost:3000/login");
await page.getByLabel("Email").fill("test@example.com");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/dashboard", { timeout: 10000 });
console.log(await page.domCua.getVisibleDom());
EOF
```

- **Cheap page read**: `page.domCua.getVisibleDom()` (~1.6k tokens on a Wikipedia article). Never print
  `snapshotForAI().full` on a text-heavy page (~215k tokens). Use `snapshotForAI({ track })` + `.incremental`
  only on small apps.
- **Screenshot**: `const p = await saveScreenshot(await page.screenshot(), "home.png"); console.log(p);`
  then move the file to the workspace's `images/`.
- **Quick runtime stub** (after load only): `await page.evaluate(() => { window.fetch = ... })`.
  Requests made during page load are not covered - use `mock.mjs --inject` for that.
- **Attach to an existing Chrome**: `dev-browser --connect http://localhost:9222`. It speaks CDP (Chrome),
  not Zen's WebDriver BiDi: don't point it at zenpilot's Zen.
- Close named pages you no longer need: `await browser.closePage("app")`.
