# Bulk import: mining licenses (CSV)

Use the same CSV format in the **web app** (file upload), **Meridian mobile** (paste), and `POST /licenses/import` / `POST /licenses/import-text` on the API.

## Required columns

| Column   | Description |
|----------|-------------|
| `company` | Non-empty name |
| `country` | Non-empty country |

## Location (choose one style per row)

You must provide coordinates in one of these ways:

1. **`lat` + `lng`** — decimal degrees (`latitude` / `longitude` / `lon` aliases are accepted in the header row).
2. **`location`** — either:
   - **Coordinate pair in one cell:** formats such as `6.5,-1.5`, `6.5; -1.5`, or two numbers separated by whitespace (works for **any** country), or
   - **Ghana place name:** when `country` is Ghana (see below), the cell may be a region or district label matched against the same approximate centroid table used in data conversion (`backend/ghana_location_centroids.py`). These coordinates are **regional centroids**, not surveyed mine positions.

Header aliases for `location`: `place`, `site`, `area`.

For countries **other than Ghana**, named place resolution is **not** applied — use `lat`/`lng` or a coordinate pair in `location`.

Optional: if the `region` column is empty and `location` carried a place label, `region` is filled from the first line of `location` for display.

## Optional columns

`region`, `commodity`, `license_type`, `status`, `phone_number`, `contact_person`

If `license_type` is empty, it defaults to `Unknown`. If `status` is empty, it defaults to `Operating`.

## Header aliases

These header names are accepted (case-insensitive, spaces become underscores):

- `licenseType` → `license_type`
- `phoneNumber` → `phone_number`
- `contactPerson` → `contact_person`
- `latitude` / `longitude` → `lat` / `lng`
- `place` / `site` / `area` → `location`

## Template files

- **Download from API:** `GET /licenses/template` (returns CSV with example rows)
- **Repo copy:** `mining-viz/public/licenses-import-template.csv`

## Rules

- First row must be the header row.
- UTF-8 (recommended); the API also accepts Latin-1 as a fallback for uploaded files.
- **All-or-nothing:** if any data row fails validation, **no rows** are inserted and the API returns **422** with a list of `{ "row", "message" }` entries (`row` is the 1-based CSV line number).
- Blank lines are skipped.

## API

- `POST /licenses/import` — multipart form field `file` (CSV).
- `POST /licenses/import-text` — JSON body `{ "csv": "<full CSV text>" }` (for mobile paste).

## After import: precise coordinates

Admin-facing HTTP geocoding for existing rows (Nominatim / optional Mapbox) lives at `POST /api/admin/geocode-licenses` and is documented in the backend — it is **not** invoked during CSV import.
