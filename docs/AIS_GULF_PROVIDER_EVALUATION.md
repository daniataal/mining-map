# AIS Gulf / chokepoint provider evaluation (MER-A-AIS)

**Status:** Planning deliverable for balanced roadmap Track A1.  
**Policy:** Open/legal tiers only; UI must label coverage gaps ([AGENTS.md](../AGENTS.md)).

## Problem

Connected community AIS (AISStream) has **sparse/absent** observations in the Persian Gulf, Strait of Hormuz, and Gulf of Oman. Empty map tiles must **not** imply “no traffic.”

## Candidate sources (evaluate before spend)

| Source | Type | Gulf relevance | License / cost | Integration fit |
|--------|------|----------------|----------------|-----------------|
| **AISStream** (current) | Community AIS | Low in Gulf | API key; ToS | `oil-live-intel-worker` — live |
| **AISHub** | Contributor network | High if receivers contributed | Free with **shared receiver** obligation | New adapter; `maritime_source_health` row |
| **BarentsWatch** | Government AIS | Norway EEZ only — **not Gulf** | OAuth client | `barentswatch_ais_sync.py` — regional |
| **Denmark AIS** | Government | Baltic/North Sea — not Gulf | Public/regional | Planned in matrix |
| **Port events / VTMS** | Inference | Medium | Varies | `port_event_observations` |
| **Commercial AIS** | Paid | High | **CEO approval** | Out of MVP; document only |

## Recommended path (MVP)

1. **Keep honest UI** — `maritime_watch_zones`, coverage gap counts, vessel drawer Gulf copy (shipped).
2. **Expose metrics** — `sync-status.watch_zone_observations_24h` per zone (shipped).
3. **Prioritize ingest** — worker polls watch zones by `priority` when bbox subscription is configurable.
4. **AISHub spike** — ops doc for contributing a receiver OR accepting contributor ToS; proof curl with bbox `22,48,30,58`.
5. **Do not** claim commercial-tracker parity without a licensed feed.

## Acceptance

- Map pan to Hormuz: banner + `coverage_gap_watch_zone_count` OR non-zero `watch_zone_observations_24h` for `persian_gulf_fujairah_hormuz`.
- Decision recorded in Obsidian `12_Decisions/` when provider is chosen.

## References

- [DATA_SOURCES.md](./DATA_SOURCES.md) — AIS rows  
- [LIVE_DATA.md](./LIVE_DATA.md) — coverage APIs  
- Migration `017_open_ais_coverage.sql`, `019_gulf_of_oman_watch.sql`
