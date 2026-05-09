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
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Sync
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
    var webUrl by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        val sp = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
        webUrl = sp.getString(KEY_WEB_BASE_URL, null)?.trim()
            ?: BuildConfig.MERIDIAN_WEB_URL.trim()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDeep)
            .padding(top = 48.dp)
            .verticalScroll(rememberScrollState())
    ) {
        // ── Top bar ────────────────────────────────────────────────────────
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

            SettingsSection(title = "WEB DESK (MAP & DATA)") {
                Text(
                    text          = "URL of your mining-map web app (Vite dev or deployed HTTPS). Emulator default: http://10.0.2.2:5173 — physical phone: http://YOUR_PC_IP:5173",
                    fontSize      = 11.sp,
                    color         = TextMuted,
                    modifier      = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                OutlinedTextField(
                    value                   = webUrl,
                    onValueChange           = { webUrl = it },
                    label                   = { Text("Base URL", color = TextMuted) },
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
                        context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
                            .edit()
                            .putString(KEY_WEB_BASE_URL, webUrl.trim().trimEnd('/'))
                            .apply()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors   = ButtonDefaults.buttonColors(
                        containerColor = AccentAmberDim,
                        contentColor   = TextPrimary,
                    ),
                ) {
                    Text("Save URL", fontWeight = FontWeight.SemiBold)
                }
                SettingsDivider()
                SettingsRow(icon = Icons.Filled.Sync, label = "Tip", value = "Run API on :8000 & web on :5173")
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
