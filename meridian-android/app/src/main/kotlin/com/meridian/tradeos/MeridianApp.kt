package com.meridian.tradeos

import android.app.Application
import org.maplibre.android.MapLibre

class MeridianApp : Application() {
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
    }
}
