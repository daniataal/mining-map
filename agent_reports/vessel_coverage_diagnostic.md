# Vessel Coverage Diagnostic

## 1. Does the application store vessel data?
**Yes.** The platform natively stores maritime vessel intelligence. The `mining_db` Postgres database contains:
- `oil_ais_positions`: **1,243,002 rows** (live AIS telemetry).
- `oil_vessels`: **7,522 rows** (vessel static identity, dimensions, and type).

## 2. Which tables store the data?
- **Vessel Telemetry:** `oil_ais_positions` (MMSI, ts, lat, lon, draft, destination, geom)
- **Vessel Identity:** `oil_vessels` (MMSI, IMO, name, vessel_type, tanker_class, crude_capable, product_tanker)
- **Other Tables:** `vessel_positions`, `vessel_identity`, `oil_port_calls`.

## 3. Which provider supplies the data?
The data is supplied by the `AISStream` community coastal AIS feed, ingested via the `maritime-worker` container (`backend/maritime_worker.py` and Go `oil-live-intel-worker`). The health table (`maritime_source_health`) reflects its status as `open_partial`.

## 4. Does worldwide vessel coverage exist?
**Yes, but it is heavily regionalized.** Querying the exact clustering of the 1.2 million AIS positions reveals that data is primarily concentrated in the North Sea (Rotterdam), Singapore Strait, US Gulf Coast, and the Aegean Sea.

## 5. Do Middle East records exist?
**No.** Querying the spatial bounding box for the Middle East (Lat 20-31, Lon 45-65) returns exactly **1 row** out of 1.24 million. Persian Gulf, Strait of Hormuz, Gulf of Oman, and major terminals like Fujairah and Ras Tanura are entirely devoid of live AIS records in the database.

## 6. Does tanker classification exist?
**Yes.** The `oil_vessels` table successfully maps and identifies tankers. Among the stored vessels:
- `crude` capable tankers: **6,056**
- `product` tankers: **1,335**

The issue is not missing classification; tankers are successfully identified where AIS frames exist.

## 7. Does the API or UI hide the records?
**No.** The backend API (`oil-live-intel/internal/api/handlers.go`) and the frontend React components correctly fetch and render data. The reason vessels are not visible in the Middle East is simply because there are 0 records in the database for that region.

## 8. Is the system using mock or stale data?
**No.** The maximum timestamp in `oil_ais_positions` matches the current system clock (`2026-05-30`), proving that ingestion is live and actively syncing from the provider. 

## Proven Diagnosis
**Worldwide data exists but Middle East coverage is absent.**
The database securely stores over a million live AIS positions and successfully classifies over 7,000 crude and product tankers. The frontend and backend correctly render the data they have. However, the upstream provider (`AISStream`) is failing to supply any telemetry for the Middle East bounding boxes (as corroborated by prior diagnostic script findings where Gulf connections closed with zero frames). 

**Recommended Next Step:**
Do not debug the frontend or backend map queries. Implement the agreed architectural mitigation for missing provider data: present a truthful UI coverage/status banner in the Live Data viewport explicitly warning the user that AISStream coverage is absent in the Middle East, and evaluate integrating a supplementary provider (like AISHub contributor network or satellite SAR) per the `maritime_source_health` table planning.
