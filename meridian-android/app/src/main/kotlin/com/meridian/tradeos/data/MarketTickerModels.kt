package com.meridian.tradeos.data

import kotlinx.serialization.Serializable

@Serializable
data class MarketTickerRow(
    val symbol: String,
    val price: String,
    val category: String? = null,
    val up: Boolean? = null,
    val change: String? = null,
)
