---
type: llm
---
PASS if the reply proposes a @playwright/test spec in the project (npx playwright test, page.route to fake the failure, an expect on the banner), possibly asking before adding the dependency. FAIL if it only proposes running the bundled scripts or dev-browser by hand.
