import java.io.File
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * FastAPI backend base URL (axios / VITE_API_BASE in mining-viz). Resolved in order:
 * 1. Environment variable MERIDIAN_API_HOST
 * 2. Gradle property MERIDIAN_API_HOST (e.g. ORG_GRADLE_PROJECT_MERIDIAN_API_HOST in CI)
 * 3. secrets.properties MERIDIAN_API_HOST
 * 4. local.properties MERIDIAN_API_HOST
 * 5. Emulator default http://10.0.2.2:8000
 */
fun meridianApiHost(project: org.gradle.api.Project): String {
    System.getenv("MERIDIAN_API_HOST")?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { return it.trimEnd('/') }
    (project.findProperty("MERIDIAN_API_HOST") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { return it.trimEnd('/') }
    val root = project.rootProject.projectDir
    val secrets = File(root, "secrets.properties")
    if (secrets.exists()) {
        val p = Properties()
        secrets.inputStream().use { p.load(it) }
        p.getProperty("MERIDIAN_API_HOST")?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it.trimEnd('/') }
    }
    val local = File(root, "local.properties")
    if (local.exists()) {
        val p = Properties()
        local.inputStream().use { p.load(it) }
        p.getProperty("MERIDIAN_API_HOST")?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it.trimEnd('/') }
    }
    return "http://10.0.2.2:8000"
}

/**
 * Host for the mining-viz web app (Vite / static deploy). Resolved in order:
 * 1. Environment variable MERIDIAN_WEB_HOST
 * 2. Gradle property MERIDIAN_WEB_HOST (e.g. -PMERIDIAN_WEB_HOST=... or ORG_GRADLE_PROJECT_MERIDIAN_WEB_HOST in CI)
 * 3. secrets.properties in project root (MERIDIAN_WEB_HOST=...) — gitignored, use for local prod URL
 * 4. local.properties MERIDIAN_WEB_HOST (Android Studio)
 * 5. Emulator default http://10.0.2.2:5173
 */
fun meridianWebHost(project: org.gradle.api.Project): String {
    System.getenv("MERIDIAN_WEB_HOST")?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { return it.trimEnd('/') }
    (project.findProperty("MERIDIAN_WEB_HOST") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?.let { return it.trimEnd('/') }
    val root = project.rootProject.projectDir
    val secrets = File(root, "secrets.properties")
    if (secrets.exists()) {
        val p = Properties()
        secrets.inputStream().use { p.load(it) }
        p.getProperty("MERIDIAN_WEB_HOST")?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it.trimEnd('/') }
    }
    val local = File(root, "local.properties")
    if (local.exists()) {
        val p = Properties()
        local.inputStream().use { p.load(it) }
        p.getProperty("MERIDIAN_WEB_HOST")?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it.trimEnd('/') }
    }
    return "http://10.0.2.2:5173"
}

android {
    namespace = "com.meridian.tradeos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.meridian.tradeos"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        val webHost = meridianWebHost(project)
        val webEscaped = webHost.replace("\\", "\\\\").replace("\"", "\\\"")
        buildConfigField("String", "MERIDIAN_WEB_URL", "\"$webEscaped\"")

        val apiHost = meridianApiHost(project)
        val apiEscaped = apiHost.replace("\\", "\\\\").replace("\"", "\\\"")
        buildConfigField("String", "MERIDIAN_API_BASE_URL", "\"$apiEscaped\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.13"
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.material.icons.extended)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)

    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.maplibre.android.sdk)
    implementation(libs.androidx.security.crypto)
}
