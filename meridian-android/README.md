# Meridian Trade OS — Android

Native Kotlin + Jetpack Compose app. Package: `com.meridian.tradeos`. minSdk 26, targetSdk 34.

- **Open in Android Studio:** File → Open → select `meridian-android/`; Studio auto-generates the Gradle wrapper jar on sync.
- **Run on device / emulator:** press ▶ Run in Android Studio (requires API 26+ AVD or physical device).
- **Build debug APK locally:** `cd meridian-android && gradle wrapper --gradle-version=8.7 && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- **CI — download APK from GitHub Actions:** push to `meridian-android/**` or trigger workflow `Meridian Android — Build Debug APK` manually → Actions tab → select run → **Artifacts** section → download `meridian-debug-apk`.
- **Release signing:** add `signingConfigs { release { ... } }` in `app/build.gradle.kts` with GitHub secrets `KEYSTORE_FILE`, `KEY_ALIAS`, `KEY_PASSWORD`; switch CI step to `assembleRelease`.

## Map & data (web desk)

The native UI is a shell. **Map, licenses, oil mode, and tickers** load inside an in-app **WebView** (same React app as `mining-viz`).

1. Start the backend on port **8000** and the Vite app on **5173** (or deploy both).
2. **Emulator:** default URL is `http://10.0.2.2:5173/` (already in `BuildConfig`).
3. **Physical device:** Settings → **Web desk URL** → e.g. `http://192.168.1.x:5173` (your PC’s LAN IP).
4. Home → **OPEN MAP & DATA** (or any commodity tile) opens the web desk.

> Production: use **HTTPS** and set the saved URL to your deployed site; you can turn off `usesCleartextTraffic` for release builds if everything is TLS.
