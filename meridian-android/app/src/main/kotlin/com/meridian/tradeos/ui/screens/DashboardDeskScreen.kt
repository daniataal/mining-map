package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.data.MarketTickerRow
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.AccentCyan
import com.meridian.tradeos.ui.theme.StatusError
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary

@Composable
fun DashboardDeskScreen(
    ticker: List<MarketTickerRow>,
    licenseCount: Int,
    loading: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = "Dashboard",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
        )
        Text(
            text = "Markets and fleet snapshot",
            fontSize = 12.sp,
            color = TextMuted,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
        )

        if (loading && ticker.isEmpty()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(color = AccentCyan)
            }
        }

        error?.let { err ->
            Text(
                text = err,
                color = StatusError,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 16.dp, glowAccent = true) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    text = "Market ticker",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "GET /api/market-ticker",
                    fontSize = 10.sp,
                    color = TextMuted,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (ticker.isEmpty() && !loading) {
                        Text("No ticker rows yet.", color = TextMuted, fontSize = 13.sp)
                    } else {
                        ticker.forEach { row -> TickerChip(row) }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 16.dp) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    text = "Licenses on record",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "$licenseCount",
                    fontSize = 36.sp,
                    fontWeight = FontWeight.Bold,
                    color = AccentCyan,
                )
                Text(
                    text = "GET /licenses",
                    fontSize = 11.sp,
                    color = TextMuted,
                )
            }
        }
    }
}

@Composable
private fun TickerChip(row: MarketTickerRow) {
    val tone = when (row.up) {
        true -> Color(0xFF4CAF50)
        false -> StatusError
        null -> TextMuted
    }
    GlassCard(modifier = Modifier, cornerRadius = 12.dp) {
        Column(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            Text(
                text = row.symbol,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = TextMuted,
            )
            Text(
                text = row.price,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
            )
            Text(
                text = row.change ?: "—",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = tone,
            )
        }
    }
}
