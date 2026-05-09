package com.meridian.tradeos.ui.screens

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.meridian.tradeos.BuildConfig
import com.meridian.tradeos.ui.theme.BackgroundDeep

internal const val MERIDIAN_PREFS = "meridian_prefs"
internal const val KEY_WEB_BASE_URL = "web_base_url"

/** Loads the same React “mining-map” web app (map, licenses, oil, etc.) inside a WebView. */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebDeskScreen(onNavigateBack: () -> Unit) {
    val context = LocalContext.current
    var targetUrl by remember { mutableStateOf<String?>(null) }
    var loadProgress by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        val sp = context.getSharedPreferences(MERIDIAN_PREFS, Context.MODE_PRIVATE)
        val saved = sp.getString(KEY_WEB_BASE_URL, null)?.trim()?.trimEnd('/')
        val base = if (saved.isNullOrEmpty()) {
            BuildConfig.MERIDIAN_WEB_URL.trim().trimEnd('/')
        } else {
            saved
        }
        targetUrl = "$base/"
    }

    Scaffold(
        containerColor = BackgroundDeep,
        topBar = {
            TopAppBar(
                title = { Text("Intelligence desk", color = Color.White) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = Color.White,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BackgroundDeep),
            )
        },
    ) { padding ->
        val url = targetUrl
        if (url == null) {
            Box(Modifier.fillMaxSize().padding(padding))
            return@Scaffold
        }

        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (loadProgress in 1..99) {
                LinearProgressIndicator(
                    progress = { loadProgress / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            key(url) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            webViewClient = WebViewClient()
                            webChromeClient = object : WebChromeClient() {
                                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                    loadProgress = newProgress
                                }
                            }
                            loadUrl(url)
                        }
                    },
                )
            }
        }
    }
}
