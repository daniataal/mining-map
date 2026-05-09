package com.meridian.tradeos.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val MeridianDarkColorScheme = darkColorScheme(
    primary             = AccentAmber,
    onPrimary           = TextOnAccent,
    primaryContainer    = Color(0xFF3D2800),
    onPrimaryContainer  = AccentGold,
    secondary           = AccentGold,
    onSecondary         = TextOnAccent,
    secondaryContainer  = Color(0xFF2A1E00),
    onSecondaryContainer = AccentGold,
    tertiary            = AccentCyan,
    onTertiary          = TextPrimary,
    background          = BackgroundDeep,
    onBackground        = TextPrimary,
    surface             = SurfaceElevated,
    onSurface           = TextPrimary,
    surfaceVariant      = SurfaceSheet,
    onSurfaceVariant    = TextSecondary,
    outline             = GlassBorder,
    outlineVariant      = GlassBorderSubtle,
    error               = StatusError,
    onError             = TextPrimary,
)

@Composable
fun MeridianTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = BackgroundDeep.toArgb()
            window.navigationBarColor = BackgroundDeep.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = MeridianDarkColorScheme,
        typography  = MeridianTypography,
        content     = content,
    )
}
