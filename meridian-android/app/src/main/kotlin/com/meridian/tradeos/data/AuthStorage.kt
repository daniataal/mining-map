package com.meridian.tradeos.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

private const val PREFS_FILE = "meridian_auth_encrypted"
private const val KEY_ACCESS_TOKEN = "access_token"
private const val KEY_USERNAME = "username"
private const val KEY_ROLE = "role"
private const val KEY_USER_ID = "user_id"

class AuthStorage(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun accessToken(): String? =
        prefs.getString(KEY_ACCESS_TOKEN, null)?.trim()?.takeIf { it.isNotEmpty() }

    fun username(): String? = prefs.getString(KEY_USERNAME, null)

    fun role(): String? = prefs.getString(KEY_ROLE, null)

    fun userId(): String? = prefs.getString(KEY_USER_ID, null)

    fun isLoggedIn(): Boolean = !accessToken().isNullOrEmpty()

    fun saveSession(accessToken: String, username: String, role: String, userId: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken.trim())
            .putString(KEY_USERNAME, username)
            .putString(KEY_ROLE, role)
            .putString(KEY_USER_ID, userId)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
