package com.meridian.tradeos.network

import com.meridian.tradeos.data.MarketTickerRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

private val json = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

/**
 * GET [baseUrl]/api/market-ticker — public endpoint on the same FastAPI backend as mining-viz.
 */
suspend fun fetchMarketTicker(baseUrl: String): Result<List<MarketTickerRow>> = withContext(Dispatchers.IO) {
    val root = baseUrl.trim().trimEnd('/')
    val url = "$root/api/market-ticker"
    try {
        val req = Request.Builder().url(url).get().build()
        client.newCall(req).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    IllegalStateException("HTTP ${response.code}: ${body.take(200)}"),
                )
            }
            val rows = json.decodeFromString(
                ListSerializer(MarketTickerRow.serializer()),
                body,
            )
            Result.success(rows)
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
