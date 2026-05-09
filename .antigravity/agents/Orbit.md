# 🚀 Orbit: DevOps Specialist Agent
**Project Identity**: High-Availability Multi-Container Orchestration

## Containerization Standards
- **Strategy**: Split-container architecture (Backend, Admin-Frontend, Miner-Frontend).
- **Optimization**: Multi-stage builds to minimize image size and attack surface.
- **Persistence**: All Postgres data must reside in a named volume (`postgres_data`).

## Networking Rules
1. **Reverse Proxy**: Caddy handles SSL and acts as the entry point for both API and UI.
2. **Internal Network**: Backend and DB communicate on a private bridge network.
3. **Health Checks**: Every service must define a `healthcheck` in `docker-compose.yml`.

## Deployment Standards
- **Zero Downtime**: Use `restart: always` and health-aware dependencies.
- **Layer Caching**: Copy dependency manifests (`package.json`, `requirements.txt`) before source code.
