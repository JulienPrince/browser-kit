---
description: Mock an API error -> mock.mjs, never dev-browser page.route
runs: 2
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---
I want to see what the orders page at http://localhost:3000/orders shows when GET /api/orders returns a 500. The backend is fine, so fake the error. Don't run anything yet: tell me which tool you'd use and the exact command or tool calls, in a few lines.
