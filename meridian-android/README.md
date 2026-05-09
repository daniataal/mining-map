# Meridian Trade OS — Android

Native Kotlin + Jetpack Compose app. Package: `com.meridian.tradeos`. minSdk 26, targetSdk 34.

The **primary experience is native UI** (Compose) that calls the **same FastAPI backend** as `mining-viz` (e.g. `/licenses`, `/api/market-ticker`, `/api/oil/summary`). A **WebView is not** the main surface: an optional **legacy web desk** (embedded mining-viz) is available **only in debug** builds from the command center.

- **WebView** = an embedded browser (`WebView`) loading a URL.
- **Native app** = Compose screens + HTTP client (`OkHttp`) + JSON (`kotlinx.serialization`) against the **REST API base URL**, matching how the web app uses `VITE_API_BASE` / axios `baseURL` in `mining-viz/src/lib/api.ts`.

- **Open in Android Studio:** File → Open → select `meridian-android/`; Studio auto-generates the Gradle wrapper jar on sync.
- **Run on device / emulator:** press ▶ Run in Android Studio (requires API 26+ AVD or physical device).
- **Build debug APK locally:** `cd meridian-android && gradle wrapper --gradle-version=8.7 && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- **CI — download APK from GitHub Actions:** push to `meridian-android/**` or trigger workflow `Meridian Android — Build Debug APK` manually → Actions tab → select run → **Artifacts** section → download `meridian-debug-apk`.
- **Release signing:** add `signingConfigs { release { ... } }` in `app/build.gradle.kts` with GitHub secrets `KEYSTORE_FILE`, `KEY_ALIAS`, `KEY_PASSWORD`; switch CI step to `assembleRelease`.

## Backend API base URL (`BuildConfig.MERIDIAN_API_BASE_URL`)

Used for native REST calls. Resolved at build time from the first non-empty source:

1. Environment variable `MERIDIAN_API_HOST`
2. Gradle property `MERIDIAN_API_HOST` (e.g. `-PMERIDIAN_API_HOST=...` or `ORG_GRADLE_PROJECT_MERIDIAN_API_HOST` in CI — the workflow can map repo secret **`MERIDIAN_API_HOST`**)
3. `meridian-android/secrets.properties` — copy `secrets.properties.example` to `secrets.properties` (gitignored)
4. `local.properties` → `MERIDIAN_API_HOST=...`
5. Fallback: `http://10.0.2.2:8000` (emulator → host machine FastAPI)

**Optional in-app override:** Settings → **Override API base URL** (cleared when empty + **Save API override**).

## Legacy web host (`BuildConfig.MERIDIAN_WEB_URL`)

Only for the optional **legacy WebView** (debug). Same resolution pattern with `MERIDIAN_WEB_HOST`, fallback `http://10.0.2.2:5173`. **Not required** for native-first usage.

## mining-viz vs backend (reference)

- **mining-viz** (Vite) often runs on **:5173**; it talks to FastAPI on **:8000** unless `VITE_API_BASE` is set (`mining-viz/src/lib/api.ts`).
- The Android app’s **API** field must point at the **backend** (e.g. `http://10.0.2.2:8000`), not the Vite dev server, unless you intentionally put a reverse proxy in front of both.

## Local dev

1. Backend on **8000**, Vite on **5173** (for web only).
2. **Emulator:** default API URL reaches your machine at `10.0.2.2:8000`.
3. **Physical device:** set LAN URL in `secrets.properties` / Settings override, or rebuild with `MERIDIAN_API_HOST=http://192.168.x.x:8000`.

> Production: prefer **HTTPS**; you can turn off `usesCleartextTraffic` for release builds if everything is TLS.
