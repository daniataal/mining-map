# Broker Workspace rollback

## Feature flags

Set in `mining-viz` environment:

```bash
VITE_BROKER_WORKSPACE_ENABLED=false
VITE_INTELLIGENCE_COCKPIT_ENABLED=false
```

`VITE_INTELLIGENCE_COCKPIT_ENABLED=false` restores legacy 6-tab navigation and popup-first map UX while keeping Supply Chain backend APIs.

This disables:

- `BrokerWorkspaceProvider` wrapper
- `MapComponentBridge` (falls back to plain `MapComponent`)
- Broker workspace map overlays and API client wiring

## Database

Migration `028_broker_deal_packs.sql` adds tables only. Rollback = stop using APIs; optional `DROP TABLE` only with explicit approval.

## Pack / unpack

`POST /api/oil-live/workspaces/{id}/packs/{pid}/unpack` restores loose entities (`packed_into_pack_id = NULL`).
