package com.DME

import android.app.Activity
import android.app.AppOpsManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Rational
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

class PipModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PipModule"

  private fun getValidActivity(): MainActivity? {
    val act = reactApplicationContext.currentActivity
    if (act is MainActivity && !act.isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !act.isDestroyed)) {
      return act
    }
    val fallback = MainActivity.currentActivityInstance
    if (fallback != null && !fallback.isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !fallback.isDestroyed)) {
      return fallback
    }
    return null
  }

  @ReactMethod
  fun setPipEnabled(enabled: Boolean) {
    val activity = getValidActivity() ?: return
    activity.runOnUiThread {
      activity.updatePipParams(enabled)
    }
  }

  @ReactMethod
  fun setPipMinimized(minimized: Boolean) {
    MainActivity.isPipMinimized = minimized
  }

  @ReactMethod
  fun updatePipAspectRatio(numerator: Int, denominator: Int) {
    val activity = getValidActivity() ?: return
    activity.runOnUiThread {
      activity.updatePipAspectRatio(numerator, denominator)
    }
  }

  @ReactMethod
  fun closePip(promise: Promise) {
    val activity = getValidActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Current activity is null or destroyed")
      return
    }
    activity.runOnUiThread {
      try {
        activity.closePip()
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("PIP_CLOSE_ERROR", e.message)
      }
    }
  }

  @ReactMethod
  fun enterPipMode(aspectRatioNumerator: Int, aspectRatioDenominator: Int, promise: Promise) {
    val activity = getValidActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Current activity is null or destroyed")
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      activity.runOnUiThread {
        try {
          if (aspectRatioNumerator > 0 && aspectRatioDenominator > 0) {
            MainActivity.pipAspectRatioNumerator = aspectRatioNumerator
            MainActivity.pipAspectRatioDenominator = aspectRatioDenominator
          }
          val params = activity.buildPipParams() ?: run {
            val num = if (aspectRatioNumerator > 0) aspectRatioNumerator else MainActivity.pipAspectRatioNumerator
            val den = if (aspectRatioDenominator > 0) aspectRatioDenominator else MainActivity.pipAspectRatioDenominator
            val rational = activity.getSafeRational(num, den)
            PictureInPictureParams.Builder()
              .setAspectRatio(rational)
              .build()
          }
          val entered = activity.enterPictureInPictureMode(params)
          promise.resolve(entered)
        } catch (e: Exception) {
          promise.reject("PIP_ERROR", e.message)
        }
      }
    } else {
      promise.reject("UNSUPPORTED", "Picture in picture requires Android Oreo (API 26) or higher")
    }
  }

  @ReactMethod
  fun isPipSupported(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val packageManager = reactApplicationContext.packageManager
      val supported = packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)
      promise.resolve(supported)
    } else {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun hasPipPermission(promise: Promise) {
    val activity = getValidActivity() ?: reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val appOps = activity.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
      if (appOps == null) {
        promise.resolve(false)
        return
      }
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
          Process.myUid(),
          activity.packageName
        )
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(
          AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
          Process.myUid(),
          activity.packageName
        )
      }
      promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    } else {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun openPipSettings(promise: Promise) {
    val activity = getValidActivity() ?: reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Current activity is null")
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val intent = Intent(
          "android.settings.PICTURE_IN_PICTURE_SETTINGS",
          Uri.fromParts("package", activity.packageName, null)
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        promise.resolve(true)
      } catch (e: Exception) {
        try {
          val intent = Intent(Settings.ACTION_SETTINGS)
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          activity.startActivity(intent)
          promise.resolve(true)
        } catch (e2: Exception) {
          promise.reject("SETTINGS_ERROR", e2.message)
        }
      }
    } else {
      promise.reject("UNSUPPORTED", "Picture-in-picture is not supported on this Android version")
    }
  }
}
