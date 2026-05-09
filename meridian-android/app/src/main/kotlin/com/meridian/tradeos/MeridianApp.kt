package com.meridian.tradeos

import android.app.Application

class MeridianApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Future: init DI (Hilt/Koin), Crashlytics, analytics
    }
}
