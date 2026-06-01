---
description: Reproduce and fix a specific bug in the existing application with evidence and regression tests
---

When the user invokes `/debugissue <bug report>`:

1. Read `.agents/agents.md` and project context.
2. Act as `@debugger`: reproduce the exact failure using the existing application path.
3. If storage/data/providers are involved, act as `@investigator` to inspect the actual existing database and data flow.
4. Write the root-cause conclusion before changing implementation.
5. Route the minimal implementation to `@backend`, `@frontend`, `@data` or `@devops` as appropriate.
6. Have `@debugger` add regression validation and verify the fix.
7. Have `@integrator` prepare the final handoff: changed files, commands, results, risks and rollback.

Do not create a parallel prototype unless the report proves no existing responsible pathway exists.
