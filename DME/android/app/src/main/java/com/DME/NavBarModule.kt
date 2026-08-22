package com.DME

import android.graphics.Color
import android.os.Build
import androidx.core.view.WindowCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NavBarModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var currentColor: String? = null

  override fun getName() = "NavBarPin"

  @ReactMethod
  fun setColor(colorString: String) {
    if (colorString == currentColor) return
    currentColor = colorString
    android.util.Log.d("SystemBarNav", "NavBarPin.setColor called: color=$colorString")
    try {
      val color = if (colorString == "#00000000" || colorString.equals("transparent", ignoreCase = true)) {
        Color.TRANSPARENT
      } else {
        Color.parseColor(colorString)
      }
      val activity = reactApplicationContext.currentActivity
      activity?.runOnUiThread {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        activity.window.navigationBarColor = color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          activity.window.isNavigationBarContrastEnforced = false
          activity.window.isStatusBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          activity.window.navigationBarDividerColor = Color.TRANSPARENT
        }
      }
    } catch (e: Exception) {
      // Ignore invalid colors
    }
  }

  @ReactMethod
  fun clear() {
    // No-op
  }
}