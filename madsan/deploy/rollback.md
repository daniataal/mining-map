# MadSan V2 rollback

1. Keep `mining-map_postgres_data` volume untouched.
2. Stop V2 only: `docker compose -f madsan/deploy/docker-compose.yml stop`
3. Restore legacy Caddy/nginx routes to `mining-viz` + legacy API.
4. If `madsan_db` corrupted: restore from timestamped `pg_dump` in backups/.
5. Do **not** run `docker compose down -v`.
