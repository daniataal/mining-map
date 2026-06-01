---
description: Determine why worldwide or Middle East tanker vessels are missing from the existing application
---

When the user invokes `/vesselcoverage`:

1. Read `.agents/context/KNOWN_FINDINGS_AND_CONSTRAINTS.md`.
2. Do not use the standalone AISStream diagnostic scripts as the application solution.
3. Act as `@investigator` to locate the actual app vessel provider, storage tables/files, ingestion job, API endpoints and frontend map filters.
4. Query the actual app storage non-destructively for:
   - latest vessel timestamp;
   - worldwide vessel and tanker counts;
   - Middle East, Persian Gulf, Hormuz, Gulf of Oman, Fujairah, Jebel Ali and Ras Tanura counts;
   - available vessel-type/tanker-identification fields;
   - provider freshness and failures.
5. Act as `@debugger` to determine whether missing markers arise from absent source data, failed ingestion, stale storage, query bounds, tanker classification, API serialization, UI state/filtering or renderer performance.
6. Act as `@architect` to recommend the smallest correct solution and only propose a provider adapter/new ingestion source if the existing app does not contain adequate data.
7. Require truthful UI coverage/status messaging where the provider lacks data.
8. Save `agent_reports/vessel_coverage_diagnostic.md`.

End with verified counts, the responsible code/data path, the reason vessels are missing and the exact files/services to change.
