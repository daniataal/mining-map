# Prioritized Execution Plan

## 1. Do Not Implement New Ingestion Yet
- We have verified that the database already contains 1.2 million AIS positions and over 7,500 vessels.
- **Goal**: Do not add a new AIS provider or scraper. 

## 2. Debug UI Visibility (Vessels)
- **Goal**: Investigate why Middle East vessels or worldwide tankers might be missing from the frontend map.
- **Action**: Check `mining-viz/src/components/MapComponent.tsx` and the corresponding backend endpoint in `main.py` for hardcoded filters, bounding box limitations, or tier omissions.

## 3. Refactor Backend Monolith
- **Goal**: Break down `backend/main.py`.
- **Action**: Incrementally extract domain-specific routers (e.g., maritime, licenses, intelligence) into `backend/api/` and `backend/services/`.

## 4. Ensure BBox Pagination for Massive Tables
- **Goal**: Protect API and frontend performance.
- **Action**: Audit the API routes serving `petroleum_osm_features` and `oil_ais_positions`. Confirm they strictly enforce bounding boxes (`bbox`) and limits.

## Next Smallest Safe Task (For Human Approval)
**Debug Vessel Visibility in UI**: Run the `/debugissue` workflow specifically targeting the missing vessel data on the map. We will trace the API call from `MapComponent.tsx` to `main.py` to identify if a filter is inadvertently hiding the 1.2M AIS positions stored in the database.
