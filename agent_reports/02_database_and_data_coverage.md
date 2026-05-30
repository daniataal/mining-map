# Database and Data Coverage

## Table Overview
The `mining_db` holds 70 relational tables covering licenses, oil flows, vessels, entities, and infrastructure.

## Populated Entities
- **Licenses (Mining)**: 72,583 rows. Significant cadastre dataset.
- **Vessel Data**: 
  - `oil_ais_positions`: 1,242,837 rows. High-frequency AIS stream data.
  - `oil_port_calls`: 33,938 rows.
  - `oil_vessels`: 7,522 rows.
  - `vessel_positions`: 24,967 rows.
  - `vessel_identity`: 5,792 rows.
- **Infrastructure**:
  - `petroleum_osm_features`: 303,274 rows. 
  - `oil_terminals`: 7 rows. (Gap identified: bulk storage and terminals need more data sources).
- **Entities & Trade**:
  - `oil_companies`: 4,414 rows.
  - `meridian_cargo_records`: 330 rows.
  - `oil_trade_flows`: 306 rows.

## Answer regarding vessel coverage
Vessels and tankers **do already exist** in the application's own storage. The database has a significant volume of AIS positions and thousands of recorded vessels. If the user does not see Middle East vessels in the UI, the issue is likely a UI filter, a bounding box limitation, or a backend API issue, rather than a lack of an AIS provider. There is no need to add a new AIS provider.
