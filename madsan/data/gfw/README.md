# GFW Maritime Context Import

Place licensed/approved Global Fishing Watch anchorage or port context exports here for local import.

Supported names:

- `anchorages.geojson`
- `anchorages.csv`

The Go ingestion job type is `maritime_context_import`. You can also pass a specific local file path in the job payload:

```json
{"path":"data/gfw/anchorages.geojson","source":"gfw_anchorages"}
```

CSV columns are flexible, but these names are preferred: `id`, `name`, `lat`, `lon`, `context_type`, `port_group_id`, `port_name`, `country_code`, `radius_m`, `confidence`.
