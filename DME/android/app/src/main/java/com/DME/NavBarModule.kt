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
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    val color = Color.parseColor(colorString)
    MainActivity.pinnedNavBarColor = color
    activity.runOnUiThread {
      activity.window.navigationBarColor = color
    }
  }

  @ReactMethod
  fun clear() {
    MainActivity.pinnedNavBarColor = null
  }
}