package com.meridian.tradeos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import com.meridian.tradeos.navigation.MeridianNavGraph
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.MeridianTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MeridianTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color    = BackgroundDeep,
                ) {
                    val navController = rememberNavController()
                    MeridianNavGraph(navController = navController)
                }
            }
        }
    }
}
