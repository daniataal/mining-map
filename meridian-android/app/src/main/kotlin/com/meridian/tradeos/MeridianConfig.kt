package com.meridian.tradeos

import android.content.Context

const val MERIDIAN_PREFS = "meridian_prefs"

/** User override for REST API base (same backend as mining-viz / FastAPI). */
const val KEY_API_BASE_URL_OVERRIDE = "api_base_url_override"

/** User override for legacy WebView host (Vite / deployed mining-viz). Not used in native-first mode. */
const val KEY_WEB_BASE_URL_OVERRIDE = "web_base_url_override"

/** Legacy preference key from older builds; still read for migration. */
const val LEGACY_WEB_BASE_URL = "web_base_url"

fun effectiveApiBaseUrl(context: Context): String {
    val sp = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
    val o = sp.getString(KEY_API_BASE_URL_OVERRIDE, null)?.trim()?.trimEnd('/')
    if (!o.isNullOrEmpty()) return o
    return BuildConfig.MERIDIAN_API_BASE_URL.trim().trimEnd('/')
}

fun effectiveLegacyWebBaseUrl(context: Context): String {
    val sp = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
    val override = sp.getString(KEY_WEB_BASE_URL_OVERRIDE, null)?.trim()?.trimEnd('/')
        .takeIf { !it.isNullOrEmpty() }
        ?: sp.getString(LEGACY_WEB_BASE_URL, null)?.trim()?.trimEnd('/')
    return if (override.isNullOrEmpty()) {
        BuildConfig.MERIDIAN_WEB_URL.trim().trimEnd('/')
    } else {
        override
    }
}
