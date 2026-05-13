package com.DME

import android.app.Application
import android.os.Build
import com.arthenica.ffmpegkit.reactnative.FFmpegKitReactNativePackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Remove FFmpegKit on emulator (x86_64) - native .so files not available
          val isEmulator = Build.SUPPORTED_ABIS.any { it.contains("x86") }
          if (isEmulator) {
            removeAll { it is FFmpegKitReactNativePackage }
          }
          add(AudioRecorderPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}