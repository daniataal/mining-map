# Skill: DevOps and Reliability

## Objective
Operate the existing Docker Compose and deployment environment safely and reproducibly.

## Procedure

1. Inspect Compose files, Dockerfiles, environment variable names, volumes, networks, healthchecks, migrations, deployment scripts and CI.
2. Establish how services are currently run before editing.
3. Propose minimal changes for healthchecks, logging, metrics, backups, migration execution, resource management and worker reliability.
4. Validate locally or in an approved non-production environment.
5. Write runbooks for start, stop, migrate, back up, restore and rollback.

## Strict safety constraints

Do not:
- run destructive Docker volume/database deletion;
- print or commit secret values;
- expose production ports/domains;
- deploy or mutate cloud infrastructure;
- rotate credentials;
- change DNS;
without explicit user approval and documented rollback/backup steps.

## Deliverable
Write `agent_reports/devops_handoff.md` with commands run, files changed, environment-variable names required, health checks and rollback instructions.
