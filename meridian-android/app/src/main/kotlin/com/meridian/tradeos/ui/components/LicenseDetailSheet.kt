package com.meridian.tradeos.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.meridian.tradeos.data.MiningLicenseDto
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LicenseDetailSheet(
    license: MiningLicenseDto?,
    onDismiss: () -> Unit,
) {
    if (license == null) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp),
        ) {
            Text(
                text = license.company,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
            )
            Spacer(modifier = Modifier.height(8.dp))
            detailLine("Status", license.status)
            detailLine("Commodity", license.commodity)
            detailLine("License", license.licenseType)
            detailLine("Country", license.country)
            detailLine("Region", license.region)
            license.contactPerson?.takeIf { it.isNotBlank() }?.let { detailLine("Contact", it) }
            license.phoneNumber?.takeIf { it.isNotBlank() }?.let { detailLine("Phone", it) }
            license.date?.takeIf { it.isNotBlank() }?.let { detailLine("Issued", it) }
            val lat = license.lat
            val lng = license.lng
            if (lat != null && lng != null) {
                detailLine("Coordinates", String.format("%.4f, %.4f", lat, lng))
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun detailLine(label: String, value: String) {
    if (value.isBlank()) return
    Spacer(modifier = Modifier.height(6.dp))
    Text(
        text = label.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = TextMuted,
    )
    Text(
        text = value,
        style = MaterialTheme.typography.bodyMedium,
        color = TextPrimary,
    )
}
