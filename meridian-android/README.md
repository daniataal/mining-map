# Meridian Trade OS — Android

Native **Kotlin + Jetpack Compose** app (`com.meridian.tradeos`, minSdk 26, targetSdk 34). The UI is **Compose-first** and talks to the **same FastAPI** as `mining-viz` (see `mining-viz/src/lib/api.ts`): JWT auth, `GET /licenses`, `GET /api/market-ticker`, `GET /api/logistics/shipments`, `GET /api/oil/summary`, etc. Visual language is a **dark nautical / chart-room** palette (slate blues, cyan accents, amber highlights) inspired by professional vessel-tracking apps — without using any third-party trademarks in the product name.

## What is fully native vs. not

| Area | Status |
|------|--------|
| Auth (login / register) + encrypted token storage | **Native** — `AuthStorage` (EncryptedSharedPreferences), `/auth/login`, `/auth/register` |
| Map (license markers from API lat/lng) | **Native** — MapLibre, public demo style URL (no API keys) |
| Bottom navigation (Map, Dash, Pipeline, Logistics, Oil) | **Native** |
| Dashboard (ticker + license count) | **Native** — `/api/market-ticker`, `/licenses` |
| Pipeline (list by status, detail sheet) | **Native** |
| Logistics (shipment list) | **Native** — `/api/logistics/shipments` |
| Oil (normalized summary + ranked flows) | **Native** — `/api/oil/summary` (same normalization idea as web) |
| Settings (API base override only in normal builds) | **Native** |
| Legacy full mining-viz in WebView | **Debug-only** — top bar “Web desk” and optional Settings section; not linked in release |

**Not in this pass (web parity gaps):** Kanban drag-and-drop, dossier / admin panel, activity log UI, meeting points, miner listings, local-only license merge, filters, i18n, AI/LOI tools — those remain on the web or for later native work.

## Build & run

- **Android Studio:** File → Open → `meridian-android/`
- **Debug APK:** `cd meridian-android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- **CI:** `.github/workflows/meridian-android-apk.yml` runs `assembleDebug` (no Google Maps secrets; MapLibre + demo tiles only).

## API base URL (`BuildConfig.MERIDIAN_API_BASE_URL`)

Resolved at build time (first non-empty): `MERIDIAN_API_HOST` env → Gradle property → `secrets.properties` → `local.properties` → `http://10.0.2.2:8000` for the emulator.

**In-app:** Settings → optional **API base** override (no “test connection” / probe UI).

## Legacy web host (`BuildConfig.MERIDIAN_WEB_URL`)

Used **only** for the optional debug WebView. Same resolution pattern with `MERIDIAN_WEB_HOST`. Release builds do not surface this in Settings.

## Local dev

1. Run FastAPI on **:8000** (see repo `backend/`).
2. Emulator: default API URL uses `10.0.2.2:8000`.
3. Physical device: set LAN URL via override or `MERIDIAN_API_HOST` when building.

> Prefer HTTPS in production; adjust `usesCleartextTraffic` when everything is TLS-terminated.

## Package layout (main sources)

```
com.meridian.tradeos/
  MainActivity.kt, MeridianApp.kt, MeridianConfig.kt
  data/           — ApiDtos, AuthStorage, MeridianRepository, OilSummaryParser
  navigation/     — NavGraph (splash → auth/main, settings, debug web)
  ui/
    MeridianViewModel.kt
    components/   — GlassCard, LicenseDetailSheet
    map/          — MeridianLicenseMap (MapLibre)
    screens/      — Auth, Splash, MainShell, Dashboard, Pipeline, Logistics, Oil, Settings, LegacyWebDesk
    theme/        — Color, Theme, Type
```
