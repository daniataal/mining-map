package com.meridian.tradeos.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.ui.screens.CommandCenterScreen
import com.meridian.tradeos.ui.screens.LegacyWebDeskScreen
import com.meridian.tradeos.ui.screens.SettingsScreen
import com.meridian.tradeos.ui.screens.SplashScreen

sealed class Screen(val route: String) {
    object Splash         : Screen("splash")
    object MapDesk        : Screen("map_desk")
    object LegacyWebDesk  : Screen("legacy_web_desk")
    object Settings       : Screen("settings")
}

@Composable
fun MeridianNavGraph(navController: NavHostController) {
    NavHost(
        navController    = navController,
        startDestination = Screen.Splash.route,
    ) {
        composable(Screen.Splash.route) {
            SplashScreen(
                onNavigateToMap = {
                    navController.navigate(Screen.MapDesk.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.MapDesk.route) {
            CommandCenterScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onOpenLegacyWebDesk = if (BuildConfig.DEBUG) {
                    { navController.navigate(Screen.LegacyWebDesk.route) }
                } else {
                    null
                },
            )
        }

        composable(Screen.LegacyWebDesk.route) {
            LegacyWebDeskScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
            )
        }
    }
}
