# Skill: Debugging and Test-Driven Root-Cause Fix

## Objective
Solve proven failures at the responsible layer, with reproducible evidence.

## Procedure

1. Restate the observed failure and expected result.
2. Reproduce it using the existing app/runtime whenever possible.
3. Trace the full data path: provider/data file -> ingestion -> storage -> API -> client state -> map rendering.
4. Use logs, non-destructive queries, API calls and UI observations to isolate the failing layer.
5. Write a root-cause statement before coding.
6. Implement the smallest fix consistent with architecture.
7. Add regression tests and validate end to end.
8. Write `agent_reports/debug_<issue_slug>.md`.

## Required report sections

- Symptom.
- Reproduction.
- Actual data path.
- Evidence collected.
- Root cause.
- Change set.
- Tests.
- Before/after validation.
- Remaining limitations.

## Prohibition
Do not build a replacement subsystem simply because the existing one has not yet been inspected.
