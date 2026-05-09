package com.meridian.tradeos.ui.screens

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Api
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Web
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.KEY_API_BASE_URL_OVERRIDE
import com.meridian.tradeos.KEY_WEB_BASE_URL_OVERRIDE
import com.meridian.tradeos.LEGACY_WEB_BASE_URL
import com.meridian.tradeos.MERIDIAN_PREFS
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.AccentAmberDim
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.GlassBorderSubtle
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import com.meridian.tradeos.ui.theme.TextSecondary

@Composable
fun SettingsScreen(onNavigateBack: () -> Unit) {
    val context = LocalContext.current
    var apiUrl by remember { mutableStateOf("") }
    var webUrl by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        val sp = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
        apiUrl = sp.getString(KEY_API_BASE_URL_OVERRIDE, null)?.trim().orEmpty()
        webUrl = sp.getString(KEY_WEB_BASE_URL_OVERRIDE, null)?.trim().orEmpty()
            .ifEmpty { sp.getString(LEGACY_WEB_BASE_URL, null)?.trim().orEmpty() }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDeep)
            .padding(top = 48.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Row(
            modifier          = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onNavigateBack) {
                Icon(
                    imageVector        = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint               = TextSecondary,
                )
            }
            Text(
                text       = "Settings",
                style      = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color      = TextPrimary,
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Column(
            modifier            = Modifier.padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SettingsSection(title = "ACCOUNT") {
                SettingsRow(icon = Icons.Filled.Person,   label = "Profile",  value = "Meridian User")
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Security, label = "Security", value = "2FA enabled")
            }

            SettingsSection(title = "BACKEND API (NATIVE)") {
                Text(
                    text          = "Native mode talks to the FastAPI server directly (same routes as mining-viz: VITE_API_BASE / axios baseURL). It is usually NOT the Vite dev URL (:5173). Default emulator: ${BuildConfig.MERIDIAN_API_BASE_URL}",
                    fontSize      = 11.sp,
                    color         = TextMuted,
                    modifier      = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                OutlinedTextField(
                    value                   = apiUrl,
                    onValueChange           = { apiUrl = it },
                    label                   = { Text("Override API base URL (optional)", color = TextMuted) },
                    placeholder             = { Text("Leave empty for build default", color = TextMuted) },
                    singleLine              = true,
                    modifier                = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors                  = OutlinedTextFieldDefaults.colors(
                        focusedTextColor   = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = AccentAmberDim,
                        unfocusedBorderColor = GlassBorderSubtle,
                    ),
                )
                Button(
                    onClick  = {
                        val ed = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE).edit()
                        val v = apiUrl.trim().trimEnd('/')
                        if (v.isEmpty()) ed.remove(KEY_API_BASE_URL_OVERRIDE) else ed.putString(KEY_API_BASE_URL_OVERRIDE, v)
                        ed.apply()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors   = ButtonDefaults.buttonColors(
                        containerColor = AccentAmberDim,
                        contentColor   = TextPrimary,
                    ),
                ) {
                    Text("Save API override", fontWeight = FontWeight.SemiBold)
                }
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Api, label = "Build default", value = BuildConfig.MERIDIAN_API_BASE_URL)
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Sync, label = "Tip", value = "Backend :8000 · Vite :5173 (web only)")
            }

            SettingsSection(title = "LEGACY WEB DESK (WEBVIEW)") {
                Text(
                    text          = "Optional: host for the React mining-viz app inside a WebView. Not required for native-first usage. Build default: ${BuildConfig.MERIDIAN_WEB_URL}",
                    fontSize      = 11.sp,
                    color         = TextMuted,
                    modifier      = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                OutlinedTextField(
                    value                   = webUrl,
                    onValueChange           = { webUrl = it },
                    label                   = { Text("Override Vite / web base URL (optional)", color = TextMuted) },
                    placeholder             = { Text("Leave empty for build default", color = TextMuted) },
                    singleLine              = true,
                    modifier                = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors                  = OutlinedTextFieldDefaults.colors(
                        focusedTextColor   = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = AccentAmberDim,
                        unfocusedBorderColor = GlassBorderSubtle,
                    ),
                )
                Button(
                    onClick  = {
                        val ed = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE).edit()
                        val v = webUrl.trim().trimEnd('/')
                        if (v.isEmpty()) ed.remove(KEY_WEB_BASE_URL_OVERRIDE) else ed.putString(KEY_WEB_BASE_URL_OVERRIDE, v)
                        ed.apply()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors   = ButtonDefaults.buttonColors(
                        containerColor = AccentAmberDim,
                        contentColor   = TextPrimary,
                    ),
                ) {
                    Text("Save web override", fontWeight = FontWeight.SemiBold)
                }
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Web, label = "Debug", value = "Legacy WebView from command center")
            }

            SettingsSection(title = "APPEARANCE") {
                SettingsRow(icon = Icons.Filled.DarkMode, label = "Theme",  value = "Dark")
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Language, label = "Region", value = "Global")
            }

            SettingsSection(title = "ABOUT") {
                SettingsRow(icon = Icons.Filled.Info, label = "Version", value = "1.0.0-dev")
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Code, label = "Build",   value = "meridian-android")
            }
        }

        Spacer(modifier = Modifier.height(40.dp))
    }
}

// ── Private sub-composables ───────────────────────────────────────────────

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column {
        Text(
            text          = title,
            fontSize      = 10.sp,
            fontWeight    = FontWeight.SemiBold,
            letterSpacing = 1.5.sp,
            color         = TextMuted,
            modifier      = Modifier.padding(bottom = 8.dp),
        )
        GlassCard(
            modifier     = Modifier.fillMaxWidth(),
            cornerRadius = 16.dp,
        ) {
            Column(
                modifier = Modifier.padding(vertical = 4.dp),
                content  = content,
            )
        }
    }
}

@Composable
private fun SettingsDivider() {
    Divider(
        modifier  = Modifier.padding(horizontal = 16.dp),
        thickness = 0.5.dp,
        color     = GlassBorderSubtle,
    )
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    label: String,
    value: String,
) {
    Row(
        modifier              = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment     = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment     = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector        = icon,
                contentDescription = null,
                tint               = AccentAmberDim,
                modifier           = Modifier.size(18.dp),
            )
            Text(
                text  = label,
                style = MaterialTheme.typography.bodyMedium,
                color = TextPrimary,
            )
        }
        Text(
            text  = value,
            style = MaterialTheme.typography.bodyMedium,
            color = TextMuted,
        )
    }
}
