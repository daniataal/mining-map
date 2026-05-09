package com.meridian.tradeos.ui.screens

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.data.AuthStorage
import com.meridian.tradeos.ui.theme.AccentAmber
import com.meridian.tradeos.ui.theme.AccentAmberDim
import com.meridian.tradeos.ui.theme.AccentGlow
import com.meridian.tradeos.ui.theme.AccentGlowFade
import com.meridian.tradeos.ui.theme.AccentGold
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.MeshBlueDeep
import com.meridian.tradeos.ui.theme.MeshPurpleDeep
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import kotlinx.coroutines.delay

@Composable
fun SplashScreen(
    onContinueSignedIn: () -> Unit,
    onContinueSignedOut: () -> Unit,
) {
    val context = LocalContext.current
    val auth = remember(context) { AuthStorage(context.applicationContext) }
    var triggered by remember { mutableStateOf(false) }

    val alpha by animateFloatAsState(
        targetValue    = if (triggered) 1f else 0f,
        animationSpec  = tween(durationMillis = 900, easing = FastOutSlowInEasing),
        label          = "splash_alpha",
    )
    val scale by animateFloatAsState(
        targetValue   = if (triggered) 1f else 0.88f,
        animationSpec = tween(durationMillis = 900, easing = FastOutSlowInEasing),
        label         = "splash_scale",
    )
    val glowAlpha by animateFloatAsState(
        targetValue   = if (triggered) 0.65f else 0f,
        animationSpec = tween(durationMillis = 1300, easing = FastOutSlowInEasing),
        label         = "glow_alpha",
    )

    LaunchedEffect(Unit) {
        triggered = true
        delay(1400)
        if (auth.isLoggedIn()) onContinueSignedIn() else onContinueSignedOut()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.radialGradient(
                    colors = listOf(MeshPurpleDeep, MeshBlueDeep, BackgroundDeep),
                    center = Offset(540f, 900f),
                    radius = 1400f,
                )
            ),
        contentAlignment = Alignment.Center,
    ) {
        // Radial amber glow halo — sits behind the wordmark
        Box(
            modifier = Modifier
                .size(320.dp)
                .alpha(glowAlpha)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(AccentGlow, AccentGlowFade, Color.Transparent),
                    )
                )
        )

        Column(
            modifier = Modifier
                .scale(scale)
                .alpha(alpha),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // ── Wordmark ───────────────────────────────────────────────────
            Text(
                text          = "MERIDIAN",
                fontSize      = 46.sp,
                fontWeight    = FontWeight.ExtraBold,
                letterSpacing = 10.sp,
                color         = TextPrimary,
                textAlign     = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(8.dp))

            // ── Amber accent rule ──────────────────────────────────────────
            Box(
                modifier = Modifier
                    .width(200.dp)
                    .height(2.dp)
                    .background(
                        brush = Brush.horizontalGradient(
                            colors = listOf(
                                Color.Transparent,
                                AccentAmber,
                                AccentGold,
                                AccentAmber,
                                Color.Transparent,
                            )
                        )
                    )
            )

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text          = "TRADE  OS",
                fontSize      = 13.sp,
                fontWeight    = FontWeight.SemiBold,
                letterSpacing = 7.sp,
                color         = AccentAmberDim,
                textAlign     = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(40.dp))

            Text(
                text          = "where commodities flow",
                fontSize      = 13.sp,
                fontWeight    = FontWeight.Light,
                letterSpacing = 1.5.sp,
                color         = TextMuted,
                textAlign     = TextAlign.Center,
            )
        }
    }
}
