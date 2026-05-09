package com.meridian.tradeos.ui.map

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.meridian.tradeos.data.MiningLicenseDto
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point

private const val MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json"
private const val SOURCE_ID = "meridian-licenses"
private const val LAYER_ID = "meridian-license-circles"

@Composable
fun MeridianLicenseMap(
    licenses: List<MiningLicenseDto>,
    onLicenseClick: (MiningLicenseDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = context as ComponentActivity

    val mapView = remember {
        MapView(context).also { it.onCreate(null) }
    }

    var styleReady by remember { mutableStateOf(false) }
    var styleRef by remember { mutableStateOf<Style?>(null) }
    val latestLicenses by rememberUpdatedState(licenses)
    val onLicenseTap by rememberUpdatedState(onLicenseClick)

    DisposableEffect(activity, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> {}
            }
        }
        activity.lifecycle.addObserver(observer)
        mapView.getMapAsync { map ->
            map.uiSettings.isAttributionEnabled = true
            val center = LatLng(7.9465, -1.0232)
            map.moveCamera(CameraUpdateFactory.newLatLngZoom(center, 5.2))
            map.setStyle(Style.Builder().fromUri(MAP_STYLE_URL)) { style ->
                style.addSource(
                    GeoJsonSource(SOURCE_ID, FeatureCollection.fromFeatures(emptyList())),
                )
                style.addLayer(
                    CircleLayer(LAYER_ID, SOURCE_ID).withProperties(
                        PropertyFactory.circleRadius(9f),
                        PropertyFactory.circleColor("#00E5FF"),
                        PropertyFactory.circleOpacity(0.88f),
                        PropertyFactory.circleStrokeWidth(1.5f),
                        PropertyFactory.circleStrokeColor("#FFFFFF"),
                    ),
                )
                styleRef = style
                styleReady = true
                map.addOnMapClickListener { latLng ->
                    val screen = map.projection.toScreenLocation(latLng)
                    val feats = map.queryRenderedFeatures(screen, LAYER_ID)
                    val id = feats.firstOrNull()?.getStringProperty("id") ?: return@addOnMapClickListener false
                    val lic = latestLicenses.firstOrNull { it.id == id }
                    if (lic != null) onLicenseTap(lic)
                    true
                }
            }
        }
        onDispose {
            activity.lifecycle.removeObserver(observer)
            mapView.onDestroy()
        }
    }

    LaunchedEffect(licenses, styleReady) {
        if (!styleReady) return@LaunchedEffect
        val style = styleRef ?: return@LaunchedEffect
        val src = style.getSourceAs<GeoJsonSource>(SOURCE_ID) ?: return@LaunchedEffect
        val feats = licenses.mapNotNull { lic ->
            val lat = lic.lat ?: return@mapNotNull null
            val lng = lic.lng ?: return@mapNotNull null
            Feature.fromGeometry(Point.fromLngLat(lng, lat)).apply {
                addStringProperty("id", lic.id)
                addStringProperty("company", lic.company)
            }
        }
        src.setGeoJson(FeatureCollection.fromFeatures(feats))
    }

    AndroidView(
        factory = { mapView },
        modifier = modifier,
    )
}
