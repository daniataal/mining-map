# Bulk import: mining licenses (CSV)

Use the same CSV format in the **web app** (file upload), **Meridian mobile** (paste), and `POST /licenses/import` / `POST /licenses/import-text` on the API.

## Required columns

| Column   | Description                          |
|----------|--------------------------------------|
| `company` | Non-empty name                       |
| `country` | Non-empty country                  |
| `lat`    | Decimal latitude (−90 … 90)          |
| `lng`    | Decimal longitude (−180 … 180)      |

## Optional columns

`region`, `commodity`, `license_type`, `status`, `phone_number`, `contact_person`

If `license_type` is empty, it defaults to `Unknown`. If `status` is empty, it defaults to `Operating`.

## Header aliases

These header names are accepted (case-insensitive, spaces become underscores):

- `licenseType` → `license_type`
- `phoneNumber` → `phone_number`
- `contactPerson` → `contact_person`
- `latitude` / `longitude` → `lat` / `lng`

## Template files

- **Download from API:** `GET /licenses/template` (returns `import_template.csv`)
- **Repo copy:** `mining-viz/public/licenses-import-template.csv`

## Rules

- First row must be the header row.
- UTF-8 (recommended); the API also accepts Latin-1 as a fallback for uploaded files.
- **All-or-nothing:** if any data row fails validation, **no rows** are inserted and the API returns **422** with a list of `{ "row", "message" }` entries (`row` is the 1-based CSV line number).
- Blank lines are skipped.

## API

- `POST /licenses/import` — multipart form field `file` (CSV).
- `POST /licenses/import-text` — JSON body `{ "csv": "<full CSV text>" }` (for mobile paste).
