---
description: Scripted flow on a local app -> dev-browser
runs: 2
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---
My app runs on http://localhost:3000. Log in with the test account, go to /dashboard and take a screenshot so I can see if the layout is broken. Don't run anything yet: tell me which tool you'd use and the exact command or tool calls, in a few lines.
