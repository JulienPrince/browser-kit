---
type: llm
---
PASS if the reply chooses the bundled netcheck.mjs script (node .../scripts/netcheck.mjs <url> ...) to report failed requests, console errors and page errors. Mentioning --wait, --all or --script is fine. FAIL if it relies only on zenpilot (which cannot see the network), or only on curl.
