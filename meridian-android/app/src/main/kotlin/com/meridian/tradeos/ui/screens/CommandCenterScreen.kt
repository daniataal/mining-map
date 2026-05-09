package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.effectiveApiBaseUrl
import com.meridian.tradeos.network.fetchMarketTicker
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.AccentAmberDim
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import com.meridian.tradeos.ui.theme.TextSecondary
import kotlinx.coroutines.launch

private enum class BackendProbeState {
    Idle,
    Loading,
    Ok,
    Error,
}

@Composable
fun CommandCenterScreen(
    onNavigateToSettings: () -> Unit,
    onOpenLegacyWebDesk: (() -> Unit)?,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    var apiBase by remember { mutableStateOf("") }
    var probeState by remember { mutableStateOf(BackendProbeState.Idle) }
    var probeDetail by remember { mutableStateOf<String?>(null) }

    fun refreshApiBase() {
        apiBase = effectiveApiBaseUrl(context)
    }

    LaunchedEffect(Unit) { refreshApiBase() }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshApiBase()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDeep)
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Command center",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Native shell · same FastAPI as mining-viz",
                    fontSize = 12.sp,
                    color = TextMuted,
                )
            }
            IconButton(
                onClick = onNavigateToSettings,
                modifier = Modifier.background(Color.Black.copy(alpha = 0.35f), CircleShape),
            ) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = "Settings",
                    tint = TextSecondary,
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 16.dp) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(
                    text = "Map",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Geographic desk UI will live here (Compose + map SDK). This screen proves the app talks to your backend over HTTP, not an embedded browser.",
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = TextMuted,
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 16.dp, glowAccent = true) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(
                    text = "Backend",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "API base URL",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.2.sp,
                    color = TextMuted,
                )
                Text(
                    text = apiBase.ifEmpty { "…" },
                    fontSize = 13.sp,
                    color = TextSecondary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = connectionLine(probeState, probeDetail),
                    fontSize = 13.sp,
                    color = when (probeState) {
                        BackendProbeState.Ok -> AccentAmberDim
                        BackendProbeState.Error -> Color(0xFFFF6B6B)
                        else -> TextMuted,
                    },
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        val base = effectiveApiBaseUrl(context)
                        apiBase = base
                        probeState = BackendProbeState.Loading
                        probeDetail = null
                        scope.launch {
                            val result = fetchMarketTicker(base)
                            result.fold(
                                onSuccess = { rows ->
                                    probeState = BackendProbeState.Ok
                                    val first = rows.firstOrNull()
                                    probeDetail = if (first != null) {
                                        "${rows.size} rows · sample: ${first.symbol} ${first.price}"
                                    } else {
                                        "200 OK · empty list"
                                    }
                                },
                                onFailure = { e ->
                                    probeState = BackendProbeState.Error
                                    probeDetail = e.message ?: e::class.simpleName ?: "Error"
                                },
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = probeState != BackendProbeState.Loading,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentAmberDim,
                        contentColor = TextPrimary,
                    ),
                ) {
                    Text(
                        if (probeState == BackendProbeState.Loading) "Testing…" else "Test GET /api/market-ticker",
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        if (onOpenLegacyWebDesk != null) {
            TextButton(onClick = onOpenLegacyWebDesk, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Open legacy web desk (dev)", color = TextMuted, fontSize = 13.sp)
            }
        }

        if (!BuildConfig.DEBUG) {
            Text(
                text = "Release builds use native UI only. Vite / WebView is not linked from here.",
                fontSize = 11.sp,
                color = TextMuted,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

private fun connectionLine(state: BackendProbeState, detail: String?): String {
    val prefix = "Connection: "
    return prefix + when (state) {
        BackendProbeState.Idle -> "not tested yet"
        BackendProbeState.Loading -> "request in flight…"
        BackendProbeState.Ok -> "OK — ${detail ?: "success"}"
        BackendProbeState.Error -> "failed — ${detail ?: "unknown"}"
    }
}
