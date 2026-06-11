# GEM tracker workbooks (MadSan standalone)

Place Global Energy Monitor `.xlsx` trackers here for `legacy-tier2` / `RunGEMImport`:

| File | Tracker |
|------|---------|
| `Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx` | `gem_extraction` |
| `Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx` | `gem_plants` |
| `GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx` | `gem_pipelines` |

Download from [Global Energy Monitor](https://globalenergymonitor.org/). Files are not committed (large binaries).

Auto-detect order: `madsan/data/gem/` → monorepo repo root (transitional fallback).

```bash
cd madsan/backend
go run ./cmd/legacy-tier2 --tables gem_extraction,gem_plants,gem_pipelines --dry-run
```
