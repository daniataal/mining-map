package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.Landscape
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.ui.components.CommodityTile
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.AccentAmber
import com.meridian.tradeos.ui.theme.AccentAmberDim
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.GlassBorderSubtle
import com.meridian.tradeos.ui.theme.MeshAmberHint
import com.meridian.tradeos.ui.theme.MeshBlueDeep
import com.meridian.tradeos.ui.theme.MeshPurpleDeep
import com.meridian.tradeos.ui.theme.StatusActive
import com.meridian.tradeos.ui.theme.StatusAmber
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import com.meridian.tradeos.ui.theme.TextSecondary
import com.meridian.tradeos.ui.theme.TileLogisticsEnd
import com.meridian.tradeos.ui.theme.TileLogisticsStart
import com.meridian.tradeos.ui.theme.TileMarketsEnd
import com.meridian.tradeos.ui.theme.TileMarketsStart
import com.meridian.tradeos.ui.theme.TileMiningEnd
import com.meridian.tradeos.ui.theme.TileMiningStart
import com.meridian.tradeos.ui.theme.TileOilEnd
import com.meridian.tradeos.ui.theme.TileOilStart

@Composable
fun HomeScreen(
    onNavigateToSettings: () -> Unit,
    onOpenCommandCenter: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDeep)
    ) {
        CinematicBackground()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 48.dp)          // status-bar clearance (edge-to-edge)
                .verticalScroll(rememberScrollState())
        ) {
            HomeTopBar(onSettingsClick = onNavigateToSettings)

            Spacer(modifier = Modifier.height(4.dp))

            // ── Greeting ───────────────────────────────────────────────────
            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Text(
                    text  = "Good morning",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                )
                Text(
                    text       = "Trade Dashboard",
                    style      = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color      = TextPrimary,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text  = "Map, licenses, oil & tickers run in the web desk (Vite + API).",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick     = onOpenCommandCenter,
                modifier    = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                shape       = RoundedCornerShape(16.dp),
                colors      = ButtonDefaults.buttonColors(
                    containerColor = AccentAmber,
                    contentColor   = Color.Black,
                ),
            ) {
                Text(
                    text       = "OPEN MAP & DATA",
                    fontSize   = 11.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = 1.2.sp,
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // ── Portfolio overview card ────────────────────────────────────
            GlassCard(
                modifier     = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                glowAccent   = true,
                cornerRadius = 20.dp,
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(
                        modifier            = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment   = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(
                                text          = "PORTFOLIO OVERVIEW",
                                fontSize      = 10.sp,
                                fontWeight    = FontWeight.SemiBold,
                                letterSpacing = 1.5.sp,
                                color         = AccentAmberDim,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text       = "3 Active Streams",
                                style      = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                                color      = TextPrimary,
                            )
                        }
                        Icon(
                            imageVector     = Icons.Filled.TrendingUp,
                            contentDescription = "Trend",
                            tint            = AccentAmber,
                            modifier        = Modifier.size(28.dp),
                        )
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                        StatChip(label = "Mining",    value = "Active",  color = StatusActive)
                        StatChip(label = "Oil",       value = "Active",  color = StatusAmber)
                        StatChip(label = "Logistics", value = "Standby", color = TextMuted)
                    }
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            SectionHeader("COMMODITY STREAMS")

            Spacer(modifier = Modifier.height(12.dp))

            // ── 2 × 2 tile grid ───────────────────────────────────────────
            Column(
                modifier            = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CommodityTile(
                        title          = "Mining",
                        subtitle       = "Licenses & sites",
                        icon           = Icons.Filled.Landscape,
                        gradientStart  = TileMiningStart,
                        gradientEnd    = TileMiningEnd,
                        badge          = "LIVE",
                        onClick        = onOpenCommandCenter,
                        modifier       = Modifier.weight(1f),
                    )
                    CommodityTile(
                        title          = "Oil & Gas",
                        subtitle       = "Trade flows",
                        icon           = Icons.Filled.WaterDrop,
                        gradientStart  = TileOilStart,
                        gradientEnd    = TileOilEnd,
                        badge          = "LIVE",
                        onClick        = onOpenCommandCenter,
                        modifier       = Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CommodityTile(
                        title          = "Logistics",
                        subtitle       = "Shipments & routes",
                        icon           = Icons.Filled.LocalShipping,
                        gradientStart  = TileLogisticsStart,
                        gradientEnd    = TileLogisticsEnd,
                        onClick        = onOpenCommandCenter,
                        modifier       = Modifier.weight(1f),
                    )
                    CommodityTile(
                        title          = "Markets",
                        subtitle       = "Price signals",
                        icon           = Icons.Filled.CandlestickChart,
                        gradientStart  = TileMarketsStart,
                        gradientEnd    = TileMarketsEnd,
                        badge          = "SOON",
                        onClick        = onOpenCommandCenter,
                        modifier       = Modifier.weight(1f),
                    )
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            SectionHeader("RECENT ACTIVITY")

            Spacer(modifier = Modifier.height(12.dp))

            Column(
                modifier            = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ActivityRow(
                    icon   = Icons.Filled.Landscape,
                    title  = "Gold Mine SA-47",
                    detail = "License renewed",
                    time   = "2h ago",
                )
                ActivityRow(
                    icon   = Icons.Filled.WaterDrop,
                    title  = "Oil Trade Batch #318",
                    detail = "Shipment confirmed",
                    time   = "5h ago",
                )
                ActivityRow(
                    icon   = Icons.Filled.LocalShipping,
                    title  = "Logistics Route 12",
                    detail = "In transit",
                    time   = "1d ago",
                )
            }

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

// ── Private sub-composables ───────────────────────────────────────────────

@Composable
private fun CinematicBackground() {
    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.linearGradient(
                        colors = listOf(MeshBlueDeep, BackgroundDeep, MeshPurpleDeep),
                        start  = Offset(0f, 0f),
                        end    = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
                    )
                )
        )
        // Warm amber warmth hint — upper-right corner
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(280.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(MeshAmberHint, Color.Transparent),
                        center = Offset(Float.POSITIVE_INFINITY, 0f),
                        radius = 600f,
                    )
                )
        )
    }
}

@Composable
private fun HomeTopBar(onSettingsClick: () -> Unit) {
    Row(
        modifier              = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment     = Alignment.CenterVertically,
    ) {
        Column {
            Text(
                text          = "MERIDIAN",
                fontSize      = 20.sp,
                fontWeight    = FontWeight.ExtraBold,
                letterSpacing = 4.sp,
                color         = TextPrimary,
            )
            Text(
                text          = "Trade OS",
                fontSize      = 10.sp,
                fontWeight    = FontWeight.Normal,
                letterSpacing = 2.sp,
                color         = AccentAmberDim,
            )
        }
        IconButton(onClick = onSettingsClick) {
            Icon(
                imageVector        = Icons.Filled.Settings,
                contentDescription = "Settings",
                tint               = TextSecondary,
                modifier           = Modifier.size(22.dp),
            )
        }
    }
}

@Composable
private fun SectionHeader(label: String) {
    Text(
        text          = label,
        modifier      = Modifier.padding(horizontal = 20.dp),
        fontSize      = 10.sp,
        fontWeight    = FontWeight.SemiBold,
        letterSpacing = 2.sp,
        color         = TextMuted,
    )
}

@Composable
private fun StatChip(label: String, value: String, color: Color) {
    Column {
        Text(
            text          = label,
            fontSize      = 10.sp,
            color         = TextMuted,
            letterSpacing = 0.5.sp,
        )
        Text(
            text       = value,
            fontSize   = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color      = color,
        )
    }
}

@Composable
private fun ActivityRow(
    icon: ImageVector,
    title: String,
    detail: String,
    time: String,
) {
    GlassCard(
        modifier     = Modifier.fillMaxWidth(),
        cornerRadius = 14.dp,
    ) {
        Row(
            modifier              = Modifier.padding(14.dp),
            verticalAlignment     = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(AccentAmber.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector        = icon,
                    contentDescription = null,
                    tint               = AccentAmber,
                    modifier           = Modifier.size(18.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text       = title,
                    style      = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color      = TextPrimary,
                )
                Text(
                    text  = detail,
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                )
            }
            Text(
                text  = time,
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
            )
        }
    }
}
