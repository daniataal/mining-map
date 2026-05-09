package com.meridian.tradeos.navigation

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.ui.MeridianViewModel
import com.meridian.tradeos.ui.screens.AuthScreen
import com.meridian.tradeos.ui.screens.LegacyWebDeskScreen
import com.meridian.tradeos.ui.screens.MainShellScreen
import com.meridian.tradeos.ui.screens.SettingsScreen
import com.meridian.tradeos.ui.screens.SplashScreen

sealed class Screen(val route: String) {
    data object Splash : Screen("splash")
    data object Auth : Screen("auth")
    data object Main : Screen("main")
    data object LegacyWebDesk : Screen("legacy_web_desk")
    data object Settings : Screen("settings")
}

@Composable
fun MeridianNavGraph(navController: NavHostController) {
    val app = LocalContext.current.applicationContext as Application

    NavHost(
        navController = navController,
        startDestination = Screen.Splash.route,
    ) {
        composable(Screen.Splash.route) {
            SplashScreen(
                onContinueSignedIn = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
                onContinueSignedOut = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Auth.route) {
            AuthScreen(
                onSignedIn = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.Auth.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Main.route) {
            val vm: MeridianViewModel = viewModel(factory = MeridianViewModel.factory(app))
            MainShellScreen(
                vm = vm,
                onOpenSettings = { navController.navigate(Screen.Settings.route) },
                onOpenLegacyWebDebug = if (BuildConfig.DEBUG) {
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
                onLoggedOut = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Main.route) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }
    }
}
