# Skill: Full-Stack Feature Integration

## Objective
Deliver an approved feature through the actual backend, frontend, data and Docker/runtime layers.

## Procedure

1. Read the approved baseline/architecture/specification reports.
2. Confirm existing implementation patterns and interfaces.
3. Produce a short feature plan with touched files, API/data contract, migration impact and acceptance criteria.
4. Implement in small reviewable changes.
5. Run backend tests, frontend tests/typecheck/build and runtime smoke checks appropriate to the repository.
6. Verify the feature visually or through API outputs and database queries.
7. Write a handoff with changed files, run commands, screenshots/API examples, limitations and rollback.

## Integration constraints

- Keep existing map/UI identity unless approved otherwise.
- Do not hide or replace global data when applying view filters.
- Do not add duplicate services for data already present in the database.
- Any new integration must expose provider status/freshness and fail safely.
