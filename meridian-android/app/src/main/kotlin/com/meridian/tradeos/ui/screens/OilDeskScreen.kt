package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.data.OilSummary
import com.meridian.tradeos.data.OilTradeFlow
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import java.text.NumberFormat
import java.util.Locale

@Composable
fun OilDeskScreen(
    summary: OilSummary?,
    modifier: Modifier = Modifier,
) {
    val fmt = remember {
        NumberFormat.getCurrencyInstance(Locale.US).apply {
            maximumFractionDigits = 0
        }
    }

    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = "Oil & gas",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
        )
        Text(
            text = "Trade flows · GET /api/oil/summary",
            fontSize = 12.sp,
            color = TextMuted,
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )

        if (summary == null || summary.flows.isEmpty()) {
            val msg = summary?.limitations?.firstOrNull()
            Text(
                text = msg ?: "No oil summary data. Ingest on the backend if tables are empty.",
                color = TextMuted,
                fontSize = 13.sp,
            )
            return
        }

        GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 14.dp) {
            Column(Modifier.padding(14.dp)) {
                Text("Source", fontSize = 10.sp, color = TextMuted, fontWeight = FontWeight.Bold)
                Text(summary.source, fontSize = 13.sp, color = TextPrimary)
                Spacer(Modifier.height(6.dp))
                Text("As of", fontSize = 10.sp, color = TextMuted, fontWeight = FontWeight.Bold)
                Text(summary.data_as_of, fontSize = 13.sp, color = TextPrimary)
            }
        }

        LazyColumn(
            modifier = Modifier.padding(top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(summary.flows, key = { "${it.iso2}-${it.rank}-${it.country}" }) { flow ->
                OilFlowRow(flow, fmt)
            }
        }
    }
}

@Composable
private fun OilFlowRow(flow: OilTradeFlow, fmt: NumberFormat) {
    GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 12.dp) {
        Column(Modifier.padding(12.dp)) {
            Text(
                text = "${flow.rank}. ${flow.country} (${flow.iso2})",
                style = MaterialTheme.typography.titleSmall,
                color = TextPrimary,
                fontWeight = FontWeight.SemiBold,
            )
            val exp = flow.export_value_usd
            Text(
                text = if (exp != null) "Exports ${fmt.format(exp)} USD" else "Exports —",
                fontSize = 13.sp,
                color = TextMuted,
                modifier = Modifier.padding(top = 4.dp),
            )
            Text(
                text = "${flow.top_hs_code} · ${flow.top_hs_description} · ${flow.category}",
                fontSize = 12.sp,
                color = TextMuted,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
