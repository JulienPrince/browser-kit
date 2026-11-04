---
type: llm
---
PASS if the reply uses dev-browser with page.domCua.getVisibleDom() (or another visible-only, cheap read) and does NOT print the full snapshotForAI output. FAIL if it plans to print snapshotForAI().full for the whole page.
