---
description: Inspect the existing platform, database, data pipelines and performance before major changes
---

When the user invokes `/auditplatform <focus>`, coordinate the existing-project audit.

1. Read `.agents/agents.md` and both files under `.agents/context/`.
2. Act as `@investigator` and run the `repository_discovery` skill. Inspect the actual current repository and active runtime non-destructively.
3. Act as `@architect` and run the `architecture_performance_audit` skill for the supplied `<focus>` or, if omitted, the full platform.
4. Act as `@security` to identify immediate secret/provenance/commercial-compliance risks that influence architecture priorities.
5. Produce the required reports in `agent_reports/`.
6. Do not implement major architecture changes in this workflow. End with a prioritized plan and the smallest high-confidence next task for human approval.

Always distinguish verified facts, inferred risks and suggested changes.
