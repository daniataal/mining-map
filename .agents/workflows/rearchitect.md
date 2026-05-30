---
description: Redesign a proven bottleneck or flawed implementation for correctness, performance and efficiency
---

When the user invokes `/rearchitect <area or problem>`:

1. Act as `@investigator` to establish existing implementation and dependencies.
2. Act as `@architect` to gather objective evidence: profiles, query plans, payloads, render counts, throughput, memory or failure logs.
3. Write an architecture decision record with current design, proven failure, alternatives, chosen target, migration stages, performance goals, risks and rollback.
4. Act as `@security` and `@devops` to review operational/data risks.
5. Do not implement until the redesign is bounded and the human approves the migration plan.
6. Once approved, route implementation through `@backend`, `@frontend`, `@data`, `@integrator` and `@debugger`.

Prioritize incremental replacement and measurable improvement over a wholesale rewrite.
