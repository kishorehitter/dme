package com.DME

import android.os.Build
import android.os.Bundle
import android.graphics.Color
import android.view.WindowManager
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.app.PictureInPictureParams
import android.util.Rational
import android.content.res.Configuration
import android.content.Intent
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.view.View
import android.view.ViewGroup
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.Arguments
import com.DME.shaders.DualSurfaceVideoView

class MainActivity : ReactActivity() {

  companion object {
    var isPipEnabled: Boolean = false
    var isPipMinimized: Boolean = false
    var isProgrammaticClose: Boolean = false
    var currentActivityInstance: MainActivity? = null
    var pipAspectRatioNumerator: Int = 16
    var pipAspectRatioDenominator: Int = 9
  }

  override fun getMainComponentName(): String = "frontend"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    currentActivityInstance = this
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
      window.isStatusBarContrastEnforced = false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.navigationBarDividerColor = Color.TRANSPARENT
      val layoutParams = window.attributes
      layoutParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      window.attributes = layoutParams
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.navigationBarDividerColor = Color.TRANSPARENT
      val layoutParams = window.attributes
      layoutParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      window.attributes = layoutParams
    }
    window.setSoftInputMode(
      WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or
      WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
    )
    window.decorView.addOnLayoutChangeListener(decorLayoutListener)
    handleMusicRoomNotificationIntent(intent)
  }

  private val decorLayoutListener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob ->
    if (l != ol || t != ot || r != or || b != ob) {
      if (isPipEnabled && !isPipMinimized && !isInPictureInPictureMode) {
        refreshPipParams()
      }
    }
  }

  private var observedVideoView: View? = null
  private val videoLayoutListener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldL, oldT, oldR, oldB ->
    if (left != oldL || top != oldT || right != oldR || bottom != oldB) {
      if (isPipEnabled && !isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !isDestroyed)) {
        refreshPipParams()
      }
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    window.decorView.removeOnLayoutChangeListener(decorLayoutListener)
    observedVideoView?.removeOnLayoutChangeListener(videoLayoutListener)
    observedVideoView = null
    if (currentActivityInstance == this) {
      currentActivityInstance = null
    }
  }

  fun getSafeRational(num: Int, den: Int): Rational {
    if (num <= 0 || den <= 0) return Rational(16, 9)
    val floatRatio = num.toFloat() / den.toFloat()
    // Android PiP aspect ratio limits: between 1:2.39 (0.41841) and 2.39:1 (2.39)
    return when {
      floatRatio < 0.41841004f -> Rational(100, 239)
      floatRatio > 2.39f -> Rational(239, 100)
      else -> Rational(num, den)
    }
  }

  private fun findVideoView(view: View): View? {
    if (view is DualSurfaceVideoView) {
      if (view.width > 0 && view.height > 0) {
        return view
      }
    }
    val className = view.javaClass.name
    if (className.contains("DualSurfaceVideoView", ignoreCase = true) ||
        className.contains("ReactExoplayerView", ignoreCase = true) ||
        className.contains("SurfaceView", ignoreCase = true) ||
        className.contains("TextureView", ignoreCase = true)) {
      if (view.width > 0 && view.height > 0) {
        return view
      }
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val child = findVideoView(view.getChildAt(i))
        if (child != null) return child
      }
    }
    return null
  }

  fun refreshPipParams() {
    if (isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed)) return
    if (!isPipEnabled || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val params = buildPipParams(autoEnter = isPipEnabled)
      if (params != null) {
        setPictureInPictureParams(params)
      }
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error refreshing PiP params: ${e.message}")
    }
  }

  private var lastFullScreenVideoRect: Rect? = null

  fun buildPipParams(autoEnter: Boolean? = null): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val rational = getSafeRational(pipAspectRatioNumerator, pipAspectRatioDenominator)
    val builder = PictureInPictureParams.Builder().setAspectRatio(rational)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (autoEnter != null) {
        builder.setAutoEnterEnabled(autoEnter)
      }
      builder.setSeamlessResizeEnabled(true)
    }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        val decorW = window.decorView.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val decorH = window.decorView.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels

        val rectToUse: Rect = if (isInPictureInPictureMode) {
          lastFullScreenVideoRect ?: Rect(0, 0, decorW, decorH)
        } else {
          val videoView = findVideoView(window.decorView)
          val rawRect = if (videoView != null) {
            if (observedVideoView != videoView) {
              observedVideoView?.removeOnLayoutChangeListener(videoLayoutListener)
              videoView.addOnLayoutChangeListener(videoLayoutListener)
              observedVideoView = videoView
            }
            val dsv = if (videoView is DualSurfaceVideoView) videoView
                      else (videoView.parent as? DualSurfaceVideoView)
            if (dsv != null) {
              dsv.getVideoRectInWindow()
            } else {
              val r = Rect()
              videoView.getGlobalVisibleRect(r)
              r
            }
          } else {
            val ar = rational.numerator.toFloat() / rational.denominator.toFloat()
            val h = Math.round(decorW.toFloat() / ar)
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            val sb = if (resId > 0) resources.getDimensionPixelSize(resId) else 0
            val top = sb + Math.round(58f * resources.displayMetrics.density)
            Rect(0, top, decorW, top + h)
          }

          val targetRatio = rational.numerator.toFloat() / rational.denominator.toFloat()
          val viewW = rawRect.width().coerceAtLeast(1)
          val viewH = rawRect.height().coerceAtLeast(1)
          val currentRatio = viewW.toFloat() / viewH.toFloat()

          val finalRect = if (Math.abs(currentRatio - targetRatio) < 0.005f) {
            Rect(rawRect)
          } else if (currentRatio > targetRatio) {
            val targetW = Math.round(viewH.toFloat() * targetRatio).coerceIn(1, decorW)
            val diffX = (viewW - targetW) / 2
            Rect(rawRect.left + diffX, rawRect.top, rawRect.left + diffX + targetW, rawRect.bottom)
          } else {
            val targetH = Math.round(viewW.toFloat() / targetRatio).coerceIn(1, decorH)
            val diffY = (viewH - targetH) / 2
            Rect(rawRect.left, rawRect.top + diffY, rawRect.right, rawRect.top + diffY + targetH)
          }

          // Strict containment inside window decor bounds
          if (finalRect.left < 0) finalRect.offset(-finalRect.left, 0)
          if (finalRect.top < 0) finalRect.offset(0, -finalRect.top)
          if (finalRect.right > decorW) finalRect.offset(decorW - finalRect.right, 0)
          if (finalRect.bottom > decorH) finalRect.offset(0, decorH - finalRect.bottom)

          if (!isPipMinimized) {
            lastFullScreenVideoRect = finalRect
          }
          finalRect
        }

        builder.setSourceRectHint(rectToUse)
      }
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error in buildPipParams: ${e.message}")
    }

    return builder.build()
  }

  fun updatePipAspectRatio(num: Int, den: Int) {
    pipAspectRatioNumerator = num
    pipAspectRatioDenominator = den
    if (isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed)) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val params = buildPipParams(autoEnter = isPipEnabled)
        if (params != null) {
          setPictureInPictureParams(params)
        }
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Error updating PiP aspect ratio: ${e.message}")
      }
    }
  }

  fun updatePipParams(enabled: Boolean) {
    isPipEnabled = enabled
    if (isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed)) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val params = buildPipParams(autoEnter = enabled)
        if (params != null) {
          setPictureInPictureParams(params)
        }
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Error setting PiP params: ${e.message}")
      }
    }
  }

  fun closePip() {
    isPipEnabled = false
    isPipMinimized = false
    isProgrammaticClose = true
    updatePipParams(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode) {
      try {
        moveTaskToBack(true)
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Error closing PiP: ${e.message}")
      }
    }
  }

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed)) return
    if (isPipEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (!isInPictureInPictureMode) {
        try {
          val params = buildPipParams()
          if (params != null) {
            enterPictureInPictureMode(params)
          }
        } catch (e: Exception) {
          android.util.Log.e("MainActivity", "Failed to enter PiP onUserLeaveHint: ${e.message}")
        }
      }
    }
  }

  override fun invokeDefaultOnBackPressed() {
    if (isPipEnabled && isPipMinimized && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val params = buildPipParams()
        if (params != null && enterPictureInPictureMode(params)) {
          return
        }
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Failed to enter PiP invokeDefaultOnBackPressed: ${e.message}")
      }
    }
    super.invokeDefaultOnBackPressed()
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    runOnUiThread {
      try {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        window.decorView.setBackgroundColor(Color.BLACK)
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Error in onPictureInPictureModeChanged: ${e.message}")
      }
    }
    if (isInPictureInPictureMode) {
      refreshPipParams()
    }
    val wasProgrammatic = isProgrammaticClose
    if (!isInPictureInPictureMode) {
      isProgrammaticClose = false
    }
    val isExpanded = !isInPictureInPictureMode && !isFinishing && !wasProgrammatic
    try {
      val params = Arguments.createMap()
      params.putBoolean("isInPictureInPictureMode", isInPictureInPictureMode)
      params.putBoolean("isExpanded", isExpanded)
      MusicServiceModule.sendEvent("onPictureInPictureModeChanged", params)
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error emitting PiP event: ${e.message}")
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val layoutParams = window.attributes
      layoutParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      window.attributes = layoutParams
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val layoutParams = window.attributes
      layoutParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      window.attributes = layoutParams
    }
    if (hasFocus) {
      window.setSoftInputMode(
        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or
        WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
      )
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleMusicRoomNotificationIntent(intent)
  }

  private fun handleMusicRoomNotificationIntent(intent: Intent?) {
    if (intent?.getBooleanExtra("MAXIMIZE_MUSIC_ROOM", false) == true || intent?.action == "OPEN_MUSIC_ROOM") {
      intent.removeExtra("MAXIMIZE_MUSIC_ROOM")
      MusicServiceModule.sendEvent("maximize_music_room")
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        MusicServiceModule.sendEvent("maximize_music_room")
      }, 250)
    }
  }

  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    val intent = android.content.Intent("onConfigurationChanged")
    intent.putExtra("newConfig", newConfig)
    this.sendBroadcast(intent)
  }
}
