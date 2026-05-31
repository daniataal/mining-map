# Middle East Maritime Provider Strategy

## 1. Executive Summary
The existing `AISStream` ingestion pipeline correctly handles global tanker discovery and telemetry for regions like the North Sea and Singapore, but returns effectively zero records for the Middle East (Persian Gulf, Gulf of Oman, Strait of Hormuz). 

This report evaluates candidate providers based on verified evidence regarding their API terms, real-world regional coverage limitations, and commercial availability. 

---

## 2. Existing Architecture Integration Points
Any new provider must seamlessly adapt its payload to the existing PostGIS and Postgres architecture:
- **`oil_vessels`**: Accepts `ON CONFLICT (mmsi) DO UPDATE` identity payloads containing IMO, Name, and ShipType/tanker classifications.
- **`oil_ais_positions`**: Accepts standard telemetry appends (Lat, Lon, Heading, Speed) enriched with the provider's source name (e.g., `provider = 'spire'`). The read path automatically deduplicates identical MMSIs via `DISTINCT ON (mmsi)`.
- **`oil_port_calls`**: Calculated asynchronously based on geofences; unaffected by the raw provider choice as long as `oil_ais_positions` is populated.
- **`maritime_source_health`**: Requires an adapter to report connection health, frames received, and abnormal disconnects to power frontend UI coverage warnings.

---

## 3. Candidate Providers Evaluated

### Option A: AISHub (Terrestrial Contributor Network)
- **Verified Access Terms:** The AISHub API is **strictly free for contributors only**. To obtain an API key, we must host and share a physical AIS receiving station that maintains 90% uptime and tracks at least 10 vessels. There is no official paid alternative.
- **Regional Coverage Evidence:** AISHub relies exclusively on land-based coastal receivers. Due to geopolitical tensions in the Persian Gulf, Fujairah, and the Strait of Hormuz, vessels frequently employ AIS shutdowns or experience GPS jamming. Furthermore, land receivers lack the range to cover the deep offshore shipping lanes of the Strait of Hormuz and Gulf of Oman.
- **Verdict:** AISHub cannot reliably cover the Middle East gap. 

### Option B: Kpler / Spire Maritime (Commercial Satellite + Terrestrial)
- **Data Capabilities:** Provides live, identified tanker positions (MMSI, IMO, ShipType) overcoming the line-of-sight limitations of terrestrial receivers by using a satellite constellation. 
- **Commercial terms & Pricing:** Spire's maritime unit was acquired by Kpler. There is no public, standardized pricing. Actual costs vary significantly based on API volume, bounding boxes, and refresh rates. **A custom quote from Kpler sales is required.**
- **Integration Fit:** Exceptional. It provides both live telemetry for `oil_ais_positions` and commercial tanker classification for `oil_vessels`.

### Option C: Sentinel-1 SAR (Copernicus / Open Satellite)
- **Data Capabilities:** Synthetic Aperture Radar detects the physical presence of large metal objects (vessels) regardless of weather or deliberate AIS shutdowns.
- **Limitations:** Provides **delayed physical vessel detection** only. It does not provide MMSI, IMO, or tanker classification (commercial cargo/trade intelligence is impossible). 
- **Commercial terms:** Open and free.
- **Integration Fit:** Cannot populate `oil_vessels` or standard `oil_ais_positions`. Must be stored in a separate table for "dark ship" or anchorage counting.

---

## 4. Final Recommendation

**multiple-source strategy required, with clear justification.**

### Justification
1. **The physical limitation:** The Persian Gulf and Strait of Hormuz cannot be covered by free terrestrial networks (like AISHub or AISStream) due to severe coastal range limits, active GPS jamming, and offshore AIS spoofing.
2. **Identity vs. Reality:** To identify tankers (`oil_vessels`) and track their live movement (`oil_ais_positions`), a commercial satellite AIS provider (Kpler/Spire) is absolutely mandatory. 
3. **Validating dark activity:** Because vessels turn off their transponders in the Gulf, even commercial satellite AIS will have gaps. Sentinel-1 SAR is required to count physical vessels at anchorages (e.g., Fujairah) to validate whether a drop in AIS signals indicates missing ships or merely disabled transponders.

### Next Steps (Do not implement)
1. **commercial satellite AIS quote required:** We must contact Kpler to negotiate pricing for a Gulf-specific bounding box API subscription.
2. We cannot proceed with AISHub as it requires hardware contribution and cannot cover the deep offshore Gulf.
