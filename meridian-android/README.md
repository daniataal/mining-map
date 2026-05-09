# Meridian Trade OS — Android

Native Kotlin + Jetpack Compose app. Package: `com.meridian.tradeos`. minSdk 26, targetSdk 34.

- **Open in Android Studio:** File → Open → select `meridian-android/`; Studio auto-generates the Gradle wrapper jar on sync.
- **Run on device / emulator:** press ▶ Run in Android Studio (requires API 26+ AVD or physical device).
- **Build debug APK locally:** `cd meridian-android && gradle wrapper --gradle-version=8.7 && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- **CI — download APK from GitHub Actions:** push to `meridian-android/**` or trigger workflow `Meridian Android — Build Debug APK` manually → Actions tab → select run → **Artifacts** section → download `meridian-debug-apk`.
- **Release signing:** add `signingConfigs { release { ... } }` in `app/build.gradle.kts` with GitHub secrets `KEYSTORE_FILE`, `KEY_ALIAS`, `KEY_PASSWORD`; switch CI step to `assembleRelease`.

> Future API base: `https://api.meridian.trade/v1` — deep link scheme: `meridian://trade`
