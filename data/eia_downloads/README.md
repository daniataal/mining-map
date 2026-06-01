# EIA historic import files

**Put files here** (repo path):

```text
mining-map/data/eia_downloads/
```

Copy from your Mac Downloads folder if you already downloaded them:

```bash
cp ~/Downloads/EIA_downloads/impa*.{xls,xlsx} "data/eia_downloads/"
```

Accepted names: `impa*.xls`, `impa*.xlsx`, or `import.xlsx` (Petroleum Supply Monthly **Imports** sheet).

These files are **gitignored** (large binaries). Commit only this README; copy the folder to the production VM under the same path.

After files are present:

```bash
docker compose up -d eia-historic-sync-worker
docker compose logs eia-historic-sync-worker --tail 20
```

Meridian auto-ingests on worker start and every 6 hours. See [docs/LIVE_DATA.md](../../docs/LIVE_DATA.md).
