package com.meridian.tradeos.data

import android.content.Context
import com.meridian.tradeos.effectiveApiBaseUrl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

private val json = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(45, TimeUnit.SECONDS)
    .build()

class MeridianRepository(private val context: Context) {

    fun apiBase(): String = effectiveApiBaseUrl(context)

    private fun authHeader(token: String?): String? =
        token?.trim()?.takeIf { it.isNotEmpty() }?.let { "Bearer $it" }

    private suspend inline fun <reified T> get(
        path: String,
        token: String? = null,
        decoder: (String) -> T,
    ): Result<T> = withContext(Dispatchers.IO) {
        val url = "${apiBase().trimEnd('/')}$path"
        try {
            val b = Request.Builder().url(url).get()
            authHeader(token)?.let { b.header("Authorization", it) }
            client.newCall(b.build()).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException(trimErrorBody(body, response.code)),
                    )
                }
                Result.success(decoder(body))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun postJson(
        path: String,
        jsonBody: String,
        token: String? = null,
    ): Result<String> = withContext(Dispatchers.IO) {
        val url = "${apiBase().trimEnd('/')}$path"
        try {
            val media = "application/json; charset=utf-8".toMediaType()
            val reqBody = jsonBody.toRequestBody(media)
            val b = Request.Builder().url(url).post(reqBody)
            authHeader(token)?.let { b.header("Authorization", it) }
            client.newCall(b.build()).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException(trimErrorBody(body, response.code)),
                    )
                }
                Result.success(body)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun login(username: String, password: String): Result<LoginResponse> {
        val payload = json.encodeToString(
            buildJsonObject {
                put("username", username)
                put("password", password)
            },
        )
        return postJson("/auth/login", payload).map { body ->
            json.decodeFromString(LoginResponse.serializer(), body)
        }
    }

    suspend fun register(username: String, password: String, role: String = "user"): Result<Unit> {
        val payload = json.encodeToString(
            buildJsonObject {
                put("username", username)
                put("password", password)
                put("role", role)
            },
        )
        return postJson("/auth/register", payload).map { }
    }

    suspend fun fetchLicenses(token: String?): Result<List<MiningLicenseDto>> =
        get("/licenses", token) { body ->
            val el = json.parseToJsonElement(body)
            if (el is JsonObject && el.containsKey("error")) {
                val msg = el["error"]?.jsonPrimitive?.contentOrNull ?: "License error"
                throw IllegalStateException(msg)
            }
            if (el !is JsonArray) throw IllegalStateException("Unexpected licenses payload")
            json.decodeFromJsonElement(ListSerializer(MiningLicenseDto.serializer()), el)
        }

    suspend fun fetchMarketTicker(token: String? = null): Result<List<MarketTickerRow>> =
        get("/api/market-ticker", token) { body ->
            json.decodeFromString(ListSerializer(MarketTickerRow.serializer()), body)
        }

    suspend fun fetchShipments(token: String? = null): Result<List<ShipmentLegDto>> =
        get("/api/logistics/shipments", token) { body ->
            json.decodeFromString(ListSerializer(ShipmentLegDto.serializer()), body)
        }

    suspend fun fetchOilSummary(token: String? = null): Result<OilSummary> =
        get("/api/oil/summary", token) { body -> parseOilSummaryJson(body, json) }
}

private fun trimErrorBody(body: String, code: Int): String {
    val t = body.trim()
    if (t.isEmpty()) return "HTTP $code"
    return t.take(280)
}
