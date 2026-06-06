# Global Cockpit — manual smoke checklist

Use after changes to **Global map lenses**, **Live Data from Global**, **Risk (beta)**, **Routes hubs/vessels**, **sanctions API**, or **company map hover**.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Stack** | Postgres + `oil-live-intel` (Go) + `mining-viz` dev server; backend reachable for licenses / admin if needed |
| **Intelligence Cockpit** | Default on. Set `VITE_INTELLIGENCE_COCKPIT_ENABLED=false` only when regression-testing legacy nav |
| **Auth** | Sign in if your environment gates the map |
| **Sanctions data** | Run `POST /api/admin/oil-live/graph-sync` (includes OpenSanctions screening step). Optional: set `OPENSANCTIONS_API_KEY` on **oil-live-intel** for higher quota (`OPENSANCTIONS_COUNTRY_CACHE_TTL_SECONDS` optional; see `.env.example`) |
| **Session reset (Global Live Data fly)** | Clear `sessionStorage` key `meridian_live_data_hub_flew` or use a fresh browser tab to re-test one-time Gulf fly |

## Automated checks (optional, before UI)

From repo root:

```bash
cd mining-viz && npm test -- src/lib/globalMapLens.test.ts src/lib/sanctionsCountryLayer.test.ts src/lib/licenseMapCluster.test.ts
cd oil-live-intel && go test ./internal/api/... ./internal/services/sanctions/...
```

Sanctions API (no auth on read path):

```bash
curl -sS "http://localhost:<oil-live-port>/api/oil-live/sanctions/country-summary" | head -c 400
curl -sS "http://localhost:<oil-live-port>/api/oil-live/sanctions/country-summary?country=Iran" | head -c 400
```

Expect JSON with `countries`, `disclaimer`, `source_tier`, `api_key_configured`. Empty `countries` after graph-sync usually means no screened entities yet—not a routing failure.

---

## 1. Global mode — sub-tabs (map lenses)

1. Open the map with Intelligence Cockpit enabled.
2. Select top mode **Global** (not legacy “Global map” tab only—cockpit shows mode row: Global, Assets, Routes, …).
3. Confirm sub-tabs: **Countries**, **Licenses**, **Trade flows**, **Risk (beta)**.
4. Under the sub-tabs, confirm helper copy changes per lens (e.g. Trade flows → “Macro trade corridors (Comtrade)”, Risk → ESG / coverage / OpenSanctions).

| Sub-tab | Expected map behavior |
|---------|------------------------|
| **Countries** | Country summary / cluster bubbles at low zoom; country borders emphasized when focusing a country |
| **Licenses** | Individual license markers when zoomed in; banner “Zoom in to see individual license assets” below drill threshold; **no** country-summary bypass for cluster rail unless country focus |
| **Trade flows** | Top banner “Macro trade corridors (Comtrade) — tier: macro”; **Show macro arcs** checkbox toggles Comtrade arcs; license markers **dimmed** |
| **Risk (beta)** | Top banner “ESG + AIS coverage gaps + sanctions (beta)”; ESG protected zones in layer control; AIS **Risk lens coverage** overlay; country fill choropleth for sanctions signal (amber/red where screened matches exist) |

5. Click a country on the map (Countries or Trade flows lens). **Expected:** country focus chip, intelligence rail opens with country panel.
6. In the rail, scroll to **OpenSanctions screening**. **Expected:** loading → summary or honest “no screened counterparties” copy; entity list with external links when graph-sync populated data.

---

## 2. Live Data opened from Global

1. Stay in **Global** mode; open sidebar tab **Live Data** (not Historic).
2. **Expected:** cyan banner: “Live trade layers on — macro/country view paused”.
3. **Expected (first time this session):** map flies once toward Gulf / live-data hub (`meridian_live_data_hub_flew` set). Switch away from Live Data and back—**no second auto-fly** in the same session while still in Global.
4. Switch to another mode (e.g. **Assets**) and open Live Data—**expected:** auto-fly runs again (session key is Global-specific).
5. Toggle Live Data map layers (terminals, vessels, corridors). **Expected:** layers render; coverage counts update; no crash when macro/country lens is paused.

---

## 3. Risk lens — ESG, coverage, sanctions (v1 map + v2 detail)

**Map (Global → Risk (beta))**

1. Enable **ESG Protected Zones** in the map layers control. **Expected:** conservation zone polygons visible.
2. **Expected:** `RiskLensCoverageOverlay` visible (AIS / coverage gap visualization).
3. Pan to countries with screened entities (post graph-sync). **Expected:** choropleth tint on country polygons (review = amber, flagged = stronger red); clear/low signal stays subtle.

**Rail + API (country detail)**

1. Click a country with known OpenSanctions hits (e.g. Iran, Russia—depends on your DB).
2. **Expected:** `CountrySanctionsSection` shows `flag_level`, match counts, `source_tier`, `api_key_configured` vs public tier.
3. **Expected:** up to bounded entity list with `sanctions_status` and OpenSanctions links when IDs exist.

**If sanctions map/rail are empty**

- Re-run graph-sync with OpenSanctions step enabled and key if rate-limited.
- Confirm `GET /api/oil-live/sanctions/country-summary` returns rows in `countries`.
- Do **not** treat missing provider data as “no risk”—UI should show empty/honest messaging.

---

## 4. Routes — Hubs vs Vessels

1. Select cockpit mode **Routes**.
2. Confirm sub-tabs include **Hubs** and **Vessels** (and **Pipelines** if present—pipelines force infrastructure layer on).

**Hubs**

1. Ensure view is **Route planner** (cockpit syncs ports/airports on map when Hubs selected).
2. **Expected:** larger, emphasized port (⚓) and airport (✈) markers (`emphasized` styling); z-index above base route markers.
3. Start pick on map (origin/destination). **Expected:** pick styling on emphasized markers; hub pick fills route planner fields.

**Vessels**

1. Switch Routes sub-tab to **Vessels**.
2. **Expected:** maritime / AIS layer enabled; vessel chevrons visible where provider has coverage.
3. Switch back to **Hubs**. **Expected:** maritime layer off; hub markers remain emphasized.

---

## 5. Assets sublayers (regression)

*This session’s diff does not rewire Assets sublayers; smoke as regression only.*

1. Select **Assets** mode.
2. Step through sub-tabs: **Mines**, **Oil fields**, **Refineries**, **Tank farms**, **Ports**.
3. **Expected:** map view mode switches appropriately; infrastructure / license layers still load; no console errors.

---

## 6. Live Data — Companies hover → map

1. Open **Live Data** sidebar → **Companies** tab.
2. Find a company row with a map pin (terminal or corridor source from API `map_lat` / `map_lng`).
3. **Hover** the row. **Expected:** corresponding map highlight (terminal/corridor) without opening the dossier.
4. **Mouse leave** row. **Expected:** highlight clears.
5. **Click** row (or map fly control if shown). **Expected:** map flies to pin; entity panel opens.
6. Switch to another Live Data tab. **Expected:** hover highlight cleared.

---

## 7. Macro trade toggle (Global Trade flows + Live Data)

1. **Global → Trade flows:** toggle **Show macro arcs** off/on. **Expected:** Comtrade arcs disappear/reappear; checkbox state persists while on that lens.
2. **Live Data** sidebar (any mode): if macro trade toggle is exposed for live context, toggle and confirm arcs respect `liveDataMacroTradeOn` without breaking live vessel layers.

---

## 8. Intelligence rail — license cluster

1. **Global → Licenses**, zoom to cluster bubble, open cluster in rail.
2. **Expected:** “Open license list” (or equivalent) control visible; action focuses sidebar/licenses as wired.

---

## Out of scope / do not fail smoke for

- Persian Gulf AIS gaps (known provider coverage limits—banners should say so).
- Paid BOL or transaction execution flows.
- `.cursor/` debug logs, Obsidian vault graph JSON (not product code).

## Sign-off

| Area | Pass | Notes |
|------|------|-------|
| Global sub-tabs | ☐ | |
| Live Data from Global | ☐ | |
| Risk / sanctions | ☐ | graph-sync + key |
| Routes Hubs/Vessels | ☐ | |
| Assets regression | ☐ | |
| Company hover | ☐ | |
