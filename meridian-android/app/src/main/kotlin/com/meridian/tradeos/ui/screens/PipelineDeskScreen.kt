package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.clickable
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
import com.meridian.tradeos.data.MiningLicenseDto
import com.meridian.tradeos.ui.components.GlassCard
import com.meridian.tradeos.ui.theme.AccentCyan
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary

@Composable
fun PipelineDeskScreen(
    licenses: List<MiningLicenseDto>,
    onLicenseClick: (MiningLicenseDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    val grouped = licenses.groupBy { it.status.ifBlank { "Unknown" } }
        .toSortedMap(compareBy { it })

    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = "Pipeline",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
        )
        Text(
            text = "Licenses by status · same data as web Kanban",
            fontSize = 12.sp,
            color = TextMuted,
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )

        LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            for ((status, rows) in grouped) {
                item(key = "h-$status") {
                    Text(
                        text = status.uppercase(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = AccentCyan,
                        modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
                    )
                }
                items(rows, key = { it.id }) { lic ->
                    GlassCard(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onLicenseClick(lic) },
                        cornerRadius = 14.dp,
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(
                                text = lic.company,
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = "${lic.commodity} · ${lic.country}",
                                fontSize = 13.sp,
                                color = TextMuted,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
