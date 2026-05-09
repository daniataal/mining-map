package com.meridian.tradeos.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.meridian.tradeos.ui.screens.HomeScreen
import com.meridian.tradeos.ui.screens.SettingsScreen
import com.meridian.tradeos.ui.screens.SplashScreen

sealed class Screen(val route: String) {
    object Splash   : Screen("splash")
    object Home     : Screen("home")
    object Settings : Screen("settings")
}

@Composable
fun MeridianNavGraph(navController: NavHostController) {
    NavHost(
        navController    = navController,
        startDestination = Screen.Splash.route,
    ) {
        composable(Screen.Splash.route) {
            SplashScreen(
                onNavigateToHome = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) }
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}
