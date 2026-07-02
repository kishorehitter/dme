package com.DME

import android.graphics.Color
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NavBarModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "NavBarPin"

  @ReactMethod
  fun setColor(colorString: String) {
    try {
      val color = Color.parseColor(colorString)
      MainActivity.pinnedNavBarColor = color
      val activity = reactApplicationContext.currentActivity
      activity?.runOnUiThread {
        activity.window.navigationBarColor = color
      }
    } catch (e: Exception) {
      // Ignore invalid colors
    }
  }

  @ReactMethod
  fun clear() {
    MainActivity.pinnedNavBarColor = null
  }
}