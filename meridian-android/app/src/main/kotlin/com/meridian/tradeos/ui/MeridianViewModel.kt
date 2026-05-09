package com.meridian.tradeos.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.meridian.tradeos.data.AuthStorage
import com.meridian.tradeos.data.MarketTickerRow
import com.meridian.tradeos.data.MeridianRepository
import com.meridian.tradeos.data.MiningLicenseDto
import com.meridian.tradeos.data.OilSummary
import com.meridian.tradeos.data.ShipmentLegDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MeridianUiState(
    val licenses: List<MiningLicenseDto> = emptyList(),
    val ticker: List<MarketTickerRow> = emptyList(),
    val shipments: List<ShipmentLegDto> = emptyList(),
    val oilSummary: OilSummary? = null,
    val loading: Boolean = false,
    val refreshError: String? = null,
)

class MeridianViewModel(application: Application) : AndroidViewModel(application) {

    private val repo = MeridianRepository(application)
    private val auth = AuthStorage(application)

    private val _ui = MutableStateFlow(MeridianUiState())
    val ui: StateFlow<MeridianUiState> = _ui.asStateFlow()

    fun authToken(): String? = auth.accessToken()

    fun refreshAll() {
        val token = auth.accessToken()
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, refreshError = null) }
            var err: String? = null

            repo.fetchLicenses(token).fold(
                onSuccess = { rows -> _ui.update { s -> s.copy(licenses = rows) } },
                onFailure = { e -> err = e.message ?: "Licenses failed" },
            )
            repo.fetchMarketTicker(token).fold(
                onSuccess = { rows -> _ui.update { s -> s.copy(ticker = rows) } },
                onFailure = { /* dashboard still useful */ },
            )
            repo.fetchShipments(token).fold(
                onSuccess = { rows -> _ui.update { s -> s.copy(shipments = rows) } },
                onFailure = { /* optional */ },
            )
            repo.fetchOilSummary(token).fold(
                onSuccess = { oil -> _ui.update { s -> s.copy(oilSummary = oil) } },
                onFailure = { /* optional */ },
            )

            _ui.update { it.copy(loading = false, refreshError = err) }
        }
    }

    companion object {
        fun factory(app: Application): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                MeridianViewModel(app) as T
        }
    }
}
