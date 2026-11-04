# zenpilot - the user's real Zen browser (MCP)

Fork used here: https://github.com/JulienPrince/zenpilot (no self-update, closes its port when done).
macOS + Zen Browser only. Tools: `mcp__zenpilot__list_tabs`, `new_tab`, `switch_tab`, `close_tab`,
`navigate`, `read_page`, `click`, `type`, `select`, `upload`, `scroll`, `screenshot`, `get_text`,
`report_limitation`. If they're deferred, load them with ToolSearch in one call.

## Loop

1. `new_tab(url)` (or `list_tabs` + `switch_tab` to reuse the user's tab).
2. `read_page` → outline with refs like `r12` (~200 tokens for a form, ~3k for a long article).
3. `click(ref)` / `type(ref, text, submit?)` / `select(ref, option)` → each returns only what changed
   (`+` new lines with fresh refs, `-` removed). Call `read_page` again only when you need the whole page.
4. `get_text` for the readable text; `screenshot` only when layout/visuals matter (an image costs more).

Refs expire on the next `read_page` or navigation.

## What it can't do (by design)

No JavaScript execution, no network/console access, no cookies/passwords/downloads. For those use
`netcheck.mjs` / `mock.mjs` / dev-browser - on a local or test copy of the site, not the user's logged-in session.

## Safety behaviour to expect

- **Allowlist**: an unknown site makes a macOS dialog appear for the user (or fails with prompts off).
  If it's refused, ask the user; don't route around it.
- **Separate Zen**: zenpilot opens Claude's own Zen (profile `zenpilot`, logged out of everything) next
  to the user's. For a site with an account, the user logs in once in that window.
- **Port release**: Claude's Zen is quit when the session ends, after `release_after_minutes`
  (default 10) unused, or with `zenpilot release`; the next call reopens it. Don't be surprised by a
  fresh window and new tab ids after a pause - call `list_tabs`.
- **Stop button**: if the user presses Stop in Zen, stop and ask how to go on.

## Troubleshooting

- `zenpilot doctor` - config, profile, who holds the port.
- `zenpilot log --errors` - failed calls. `zenpilot report` - what Claude couldn't do this session.
