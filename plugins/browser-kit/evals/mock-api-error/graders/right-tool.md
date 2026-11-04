---
type: llm
---
PASS if the reply uses the bundled mock.mjs script with a mocks JSON file containing an entry for the orders API with status 500 (and optionally --screenshot or --script). FAIL if it proposes page.route inside a dev-browser script, or changing the backend code, as the way to do it.
