---
description: Implement an approved feature through existing backend, frontend, data and runtime layers
---

When the user invokes `/implementfeature <approved feature>`:

1. Read project context and existing baseline/architecture reports. If no baseline exists for affected areas, execute repository discovery first.
2. Act as `@lead` to create bounded acceptance criteria.
3. Route architecture/data/API considerations to `@architect`, `@data` and `@backend`.
4. Route UX/map integration to `@frontend`.
5. Route security/provenance implications to `@security`.
6. Act as `@integrator` to implement the approved cross-layer change inside the existing app.
7. Act as `@debugger` to run regression validation.
8. Act as `@devops` only for necessary safe runtime/Compose/documentation changes.
9. Save an implementation handoff report with tests and rollback instructions.

Preserve working features; do not silently rewrite unrelated systems.
