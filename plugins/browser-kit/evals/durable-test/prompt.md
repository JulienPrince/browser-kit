---
description: Replay in CI -> @playwright/test
runs: 2
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---
We keep breaking the error banner on /users when the API fails. I want a test that runs in our CI on every pull request. Don't run anything yet: tell me which tool you'd use and the exact command or tool calls, in a few lines.
