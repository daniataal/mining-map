package com.meridian.tradeos.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class MarketTickerRow(
    val symbol: String,
    val price: String,
    val category: String? = null,
    val up: Boolean? = null,
    val change: String? = null,
)

@Serializable
data class MiningLicenseDto(
    val id: String,
    val company: String,
    @SerialName("licenseType") val licenseType: String = "",
    val commodity: String = "",
    val status: String = "",
    val date: String? = null,
    val country: String = "",
    val region: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    @SerialName("phoneNumber") val phoneNumber: String? = null,
    @SerialName("contactPerson") val contactPerson: String? = null,
    @SerialName("geoSource") val geoSource: String? = null,
    @SerialName("geoApproximated") val geoApproximated: Boolean? = null,
    @SerialName("geoConfidence") val geoConfidence: Double? = null,
    @SerialName("originalLat") val originalLat: Double? = null,
    @SerialName("originalLng") val originalLng: Double? = null,
)

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String = "bearer",
    val username: String,
    val role: String,
    val id: String,
)

@Serializable
data class ShipmentLegDto(
    val id: String,
    @SerialName("dealId") val dealId: String,
    @SerialName("dealLabel") val dealLabel: String? = null,
    val origin: String = "",
    val destination: String = "",
    val incoterm: String = "",
    val status: String = "",
    val eta: String? = null,
    val notes: String? = null,
    @SerialName("createdAt") val createdAt: String? = null,
)

@Serializable
data class OilTradeFlow(
    val country: String,
    val iso2: String,
    val lat: Double,
    val lng: Double,
    val export_value_usd: Double? = null,
    val import_value_usd: Double? = null,
    val top_hs_code: String = "",
    val top_hs_description: String = "",
    val category: String = "other",
    val year: Int = 0,
    val rank: Int = 0,
)

@Serializable
data class OilSummary(
    val flows: List<OilTradeFlow> = emptyList(),
    val source: String = "",
    val data_as_of: String = "",
    val limitations: List<String> = emptyList(),
)
