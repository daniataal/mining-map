package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.data.ShipmentLegDto
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary

@Composable
fun LogisticsDeskScreen(
    shipments: List<ShipmentLegDto>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = "Logistics",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
        )
        Text(
            text = "Shipments · GET /api/logistics/shipments",
            fontSize = 12.sp,
            color = TextMuted,
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )

        if (shipments.isEmpty()) {
            Text(
                text = "No shipments yet. Create rows in the web Logistics desk or via API.",
                color = TextMuted,
                fontSize = 13.sp,
            )
            return
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(shipments, key = { it.id }) { s ->
                GlassCard(modifier = Modifier.fillMaxWidth(), cornerRadius = 14.dp) {
                    Column(Modifier.padding(14.dp)) {
                        Text(
                            text = s.dealLabel ?: s.dealId,
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "${s.origin} → ${s.destination}",
                            fontSize = 13.sp,
                            color = TextMuted,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            text = "${s.status} · ${s.incoterm}",
                            fontSize = 12.sp,
                            color = TextMuted,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        s.eta?.takeIf { it.isNotBlank() }?.let {
                            Text("ETA $it", fontSize = 12.sp, color = TextMuted)
                        }
                    }
                }
            }
        }
    }
}
