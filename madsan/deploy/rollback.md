# MadSan V2 rollback

1. Keep legacy `mining-map_postgres_data` volume untouched (if monorepo stack still on host).
2. Stop V2 only (from `/opt/madsan`): `docker compose -f deploy/docker-compose.yml stop`
3. Restore legacy Caddy/nginx routes to `mining-viz` + legacy API.
4. If `madsan_db` corrupted: restore from timestamped `pg_dump` in backups/.
5. Do **not** run `docker compose down -v`.
