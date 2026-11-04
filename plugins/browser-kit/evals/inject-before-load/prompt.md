---
description: Inject a script before load -> mock.mjs --inject
runs: 2
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---
Before my app at http://localhost:3000 boots, set localStorage key beta=1 so the beta UI shows, then screenshot the home page. Don't run anything yet: tell me which tool you'd use and the exact command or tool calls, in a few lines.
