package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SpaceDashboard
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.data.MiningLicenseDto
import com.meridian.tradeos.ui.MeridianViewModel
import com.meridian.tradeos.ui.components.LicenseDetailSheet
import com.meridian.tradeos.ui.map.MeridianLicenseMap
import com.meridian.tradeos.ui.theme.AccentCyan
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.SurfaceElevated
import com.meridian.tradeos.ui.theme.TextPrimary
import com.meridian.tradeos.ui.theme.TextSecondary

private enum class MainTab {
    Map,
    Dashboard,
    Pipeline,
    Logistics,
    Oil,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainShellScreen(
    vm: MeridianViewModel,
    onOpenSettings: () -> Unit,
    onOpenLegacyWebDebug: (() -> Unit)?,
) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(MainTab.Map) }
    var sheetLicense by remember { mutableStateOf<MiningLicenseDto?>(null) }

    LaunchedEffect(Unit) { vm.refreshAll() }

    Scaffold(
        containerColor = BackgroundDeep,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = when (tab) {
                            MainTab.Map -> "Fleet map"
                            MainTab.Dashboard -> "Dashboard"
                            MainTab.Pipeline -> "Pipeline"
                            MainTab.Logistics -> "Logistics"
                            MainTab.Oil -> "Oil & gas"
                        },
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary,
                        fontSize = 18.sp,
                    )
                },
                actions = {
                    if (BuildConfig.DEBUG && onOpenLegacyWebDebug != null) {
                        val openWeb = onOpenLegacyWebDebug
                        TextButton(onClick = { openWeb() }) {
                            Text("Web desk", color = AccentCyan, fontSize = 12.sp)
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            imageVector = Icons.Filled.Settings,
                            contentDescription = "Settings",
                            tint = TextSecondary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BackgroundDeep.copy(alpha = 0.94f),
                    titleContentColor = TextPrimary,
                ),
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = SurfaceElevated,
                contentColor = TextSecondary,
            ) {
                val colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = AccentCyan,
                    selectedTextColor = AccentCyan,
                    unselectedIconColor = TextSecondary,
                    unselectedTextColor = TextSecondary,
                    indicatorColor = AccentCyan.copy(alpha = 0.12f),
                )
                NavigationBarItem(
                    selected = tab == MainTab.Map,
                    onClick = { tab = MainTab.Map },
                    icon = { Icon(Icons.Filled.Map, contentDescription = null) },
                    label = { Text("Map") },
                    colors = colors,
                )
                NavigationBarItem(
                    selected = tab == MainTab.Dashboard,
                    onClick = { tab = MainTab.Dashboard },
                    icon = { Icon(Icons.Filled.SpaceDashboard, contentDescription = null) },
                    label = { Text("Dash") },
                    colors = colors,
                )
                NavigationBarItem(
                    selected = tab == MainTab.Pipeline,
                    onClick = { tab = MainTab.Pipeline },
                    icon = { Icon(Icons.Filled.Assignment, contentDescription = null) },
                    label = { Text("Pipe") },
                    colors = colors,
                )
                NavigationBarItem(
                    selected = tab == MainTab.Logistics,
                    onClick = { tab = MainTab.Logistics },
                    icon = { Icon(Icons.Filled.LocalShipping, contentDescription = null) },
                    label = { Text("Logistics") },
                    colors = colors,
                )
                NavigationBarItem(
                    selected = tab == MainTab.Oil,
                    onClick = { tab = MainTab.Oil },
                    icon = { Icon(Icons.Filled.WaterDrop, contentDescription = null) },
                    label = { Text("Oil") },
                    colors = colors,
                )
            }
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (tab) {
                MainTab.Map -> MeridianLicenseMap(
                    licenses = ui.licenses,
                    onLicenseClick = { sheetLicense = it },
                    modifier = Modifier.fillMaxSize(),
                )
                MainTab.Dashboard -> DashboardDeskScreen(
                    ticker = ui.ticker,
                    licenseCount = ui.licenses.size,
                    loading = ui.loading,
                    error = ui.refreshError,
                )
                MainTab.Pipeline -> PipelineDeskScreen(
                    licenses = ui.licenses,
                    onLicenseClick = { sheetLicense = it },
                )
                MainTab.Logistics -> LogisticsDeskScreen(shipments = ui.shipments)
                MainTab.Oil -> OilDeskScreen(summary = ui.oilSummary)
            }
        }
        LicenseDetailSheet(license = sheetLicense, onDismiss = { sheetLicense = null })
    }
}
