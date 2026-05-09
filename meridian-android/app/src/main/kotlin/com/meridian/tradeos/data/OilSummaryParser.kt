package com.meridian.tradeos.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Mirrors mining-viz normalization: accepts either `flows` or
 * `top_exporters_by_value` + `breakdown_by_hs` from GET /api/oil/summary.
 */
fun parseOilSummaryJson(body: String, json: Json): OilSummary {
    val root = json.parseToJsonElement(body).jsonObject
    if (root.containsKey("error") && root["top_exporters_by_value"] == null && root["flows"] == null) {
        val msg = root["error"]?.jsonPrimitive?.contentOrNull
        return OilSummary(limitations = listOfNotNull(msg))
    }

    val flowsEl = root["flows"]?.jsonArray
    if (flowsEl != null && flowsEl.isNotEmpty()) {
        val flows = json.decodeFromJsonElement(ListSerializer(OilTradeFlow.serializer()), flowsEl)
        return OilSummary(
            flows = flows,
            source = root["source"]?.jsonPrimitive?.contentOrNull
                ?: root["provenance"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            data_as_of = root["data_as_of"]?.jsonPrimitive?.contentOrNull
                ?: root["year"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            limitations = limitationList(root),
        )
    }

    return normalizeFromTopExporters(root)
}

private fun limitationList(root: JsonObject): List<String> =
    root["limitations"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()

private fun normalizeFromTopExporters(root: JsonObject): OilSummary {
    val limitations = limitationList(root)
    val tops = root["top_exporters_by_value"]?.jsonArray
    if (tops == null || tops.isEmpty()) {
        return OilSummary(limitations = limitations)
    }

    val breakdown = root["breakdown_by_hs"]?.jsonObject ?: JsonObject(emptyMap())
    val year = root["year"]?.jsonPrimitive?.intOrNull ?: 2022

    val flows = tops.mapIndexed { index, el ->
        val row = el.jsonObject
        val iso2 = row["reporter_iso2"]?.jsonPrimitive?.contentOrNull?.uppercase().orEmpty().ifEmpty { "XX" }
        val coord = iso2ToOilCoord(iso2)
        val dominant = dominantHsForCountry(iso2, breakdown)
        OilTradeFlow(
            country = row["reporter"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            iso2 = iso2,
            lat = coord.first,
            lng = coord.second,
            export_value_usd = row["total_value_usd"]?.jsonPrimitive?.doubleOrNull,
            import_value_usd = null,
            top_hs_code = dominant.first,
            top_hs_description = dominant.third,
            category = dominant.second,
            year = year,
            rank = index + 1,
        )
    }

    return OilSummary(
        flows = flows,
        source = root["provenance"]?.jsonPrimitive?.contentOrNull ?: "UN Comtrade (aggregated via backend)",
        data_as_of = year.toString(),
        limitations = limitations.ifEmpty {
            listOf("Country-level exports only. Ingest oil data if this list is empty.")
        },
    )
}

private val HS_TO_CATEGORY = mapOf(
    "2709" to "crude",
    "2710" to "refined",
    "2711" to "gas",
)

private fun dominantHsForCountry(
    iso2: String,
    breakdown: JsonObject,
): Triple<String, String, String> {
    val u = iso2.uppercase()
    var bestHs: String? = null
    var bestVal = 0.0
    for (hs in listOf("2709", "2710", "2711")) {
        val exporters = breakdown[hs]?.jsonObject?.get("exporters")?.jsonArray ?: continue
        for (e in exporters) {
            val o = e.jsonObject
            val rep = o["reporter_iso2"]?.jsonPrimitive?.contentOrNull?.uppercase().orEmpty()
            if (rep != u) continue
            val v = o["trade_value_usd"]?.jsonPrimitive?.doubleOrNull ?: 0.0
            if (v > bestVal) {
                bestVal = v
                bestHs = hs
            }
        }
    }
    val hs = bestHs ?: return Triple("2709", "other", "Petroleum (aggregated)")
    val cat = HS_TO_CATEGORY[hs] ?: "other"
    val desc = when (hs) {
        "2709" -> "Petroleum oils, crude"
        "2710" -> "Petroleum oils, not crude"
        "2711" -> "Petroleum gases"
        else -> "Petroleum (aggregated)"
    }
    return Triple(hs, cat, desc)
}

private fun iso2ToOilCoord(iso2: String): Pair<Double, Double> {
    val c = ISO2_COORD[iso2.uppercase()]
    return c ?: (20.0 to 10.0)
}

private val ISO2_COORD: Map<String, Pair<Double, Double>> = mapOf(
    "SA" to (23.9 to 45.1),
    "RU" to (61.5 to 90.4),
    "NO" to (60.5 to 8.5),
    "AE" to (23.4 to 53.8),
    "US" to (37.1 to -95.7),
    "IQ" to (33.2 to 43.7),
    "CA" to (56.1 to -106.3),
    "KW" to (29.3 to 47.5),
    "QA" to (25.4 to 51.2),
    "KZ" to (48.0 to 66.9),
    "IR" to (32.4 to 53.7),
    "NG" to (9.1 to 8.7),
    "LY" to (26.3 to 17.2),
    "DZ" to (28.0 to 2.6),
    "AO" to (-11.2 to 17.9),
    "BR" to (-14.2 to -51.9),
    "OM" to (21.5 to 55.9),
    "MX" to (23.6 to -102.5),
    "EC" to (-1.8 to -78.2),
    "VE" to (6.4 to -66.6),
    "GH" to (7.9 to -1.0),
    "GQ" to (1.7 to 10.3),
    "GA" to (-0.8 to 11.6),
    "TT" to (10.7 to -61.2),
    "AZ" to (40.1 to 47.6),
    "TM" to (38.9 to 59.6),
    "MY" to (4.2 to 108.0),
    "ID" to (-0.8 to 113.9),
    "AU" to (-25.3 to 133.8),
    "NL" to (52.1 to 5.3),
    "SG" to (1.4 to 103.8),
)
