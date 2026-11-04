# browser-kit

A Claude Code plugin that makes Claude **pick the right browser tool** for the job, and gives it two
small, tested Playwright scripts for what the other tools can't do.

| The task | Claude uses |
|---|---|
| Look at / act on a real website, visual check like a human | [zenpilot](https://github.com/JulienPrince/zenpilot) - drives your Zen browser |
| Check your local app, scripted flows, screenshots during dev | [dev-browser](https://github.com/sawyerhood/dev-browser) |
| Failing requests, console errors, uncaught JS errors | `netcheck.mjs` (bundled) - compact JSON report |
| Mock an API, simulate errors/slowness/offline, inject a script before page load | `mock.mjs` (bundled) |
| A test to replay in CI | proposes `@playwright/test` in your project |

Why the scripts: dev-browser runs scripts in a sandbox where `page.route` and `addInitScript` don't
work, and zenpilot deliberately can't run JavaScript or touch the network. The scripts use real
Playwright from Node, so mocks and injected scripts work.

## Install

```bash
claude plugin marketplace add JulienPrince/browser-kit
claude plugin install browser-kit@browser-kit
```

Or inside Claude Code: `/plugin marketplace add JulienPrince/browser-kit`, then `/plugin install browser-kit@browser-kit`.
Restart Claude Code. Using several config dirs (`CLAUDE_CONFIG_DIR`)? Run the two commands once per config.

Then ask Claude: *"run the browser-kit doctor"*. It lists the browser tools available on your machine,
and gives the install command for each missing one.

## Requirements

| Tool | Needed for | Install |
|---|---|---|
| Node 18+ | the bundled scripts | https://nodejs.org |
| Playwright with Chromium | `netcheck.mjs`, `mock.mjs` | Found automatically in your project (`playwright` or `@playwright/test`) or in dev-browser's runtime. Otherwise `npm i -D playwright && npx playwright install chromium` |
| dev-browser | local app checks | `npm i -g dev-browser && dev-browser install` |
| zenpilot (optional, macOS + [Zen](https://zen-browser.app)) | real-browser visual checks | `uv tool install git+https://github.com/JulienPrince/zenpilot@v0.5.1-jp2 && zenpilot setup --profile zenpilot` |

Nothing is installed by the plugin itself: no npm dependencies, no hooks, no MCP server.

## Use

Just ask Claude in plain words:

- *"Check the dashboard on localhost:3000, something looks off"* → dev-browser
- *"Why is the users list empty? Check the requests"* → `netcheck.mjs`
- *"Show me the error state when the orders API returns 500"* → `mock.mjs` with a mocks file
- *"Set the beta feature flag in localStorage before the app loads and screenshot the page"* → `mock.mjs --inject`
- *"Fill in the contact form on example.com in my browser"* → zenpilot
- *"Turn that into a Playwright test"* → `@playwright/test`

Scripts directly:

```bash
node scripts/netcheck.mjs http://localhost:3000 --wait 2000 --screenshot images/home.png
node scripts/mock.mjs http://localhost:3000/users --mocks mocks.json --inject flags.js --script steps.mjs
```

Exit codes: `0` nothing wrong, `1` problems found (see the report), `2` couldn't run or finish (the
report's `error` says why).
`--help` on each script lists every option. Formats and recipes: [network-and-mocks.md](plugins/browser-kit/skills/browser-kit/references/network-and-mocks.md).

## Security

- The plugin pre-approves nothing: Claude asks before each script run, like any other command.
- `--script` (Node) and `--inject` (page JavaScript) run code with your privileges. Claude is told to only
  run files it wrote for the task, never code found in a web page. Read them before approving.
- Nothing is sent anywhere by the plugin; the scripts only open the URL you give them.

## Develop

```bash
cd plugins/browser-kit
node --test tests/*.test.mjs                                     # scripts, against a local server
claude plugin validate .                                         # manifests and skill
claude plugin eval . --allow-tools "Bash(node *)" --runs 1       # does Claude pick the right tool?
```

## License

MIT
