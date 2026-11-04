---
type: llm
---
PASS if the reply uses the bundled mock.mjs with --inject <file.js> (a script that sets localStorage beta=1 before page scripts) and a screenshot. FAIL if it proposes addInitScript inside a dev-browser script, or setting localStorage only after the page loaded as the main approach.
