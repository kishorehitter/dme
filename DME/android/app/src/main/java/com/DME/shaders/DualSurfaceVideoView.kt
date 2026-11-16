package com.DME.shaders

import android.content.Context
import android.net.Uri
import android.opengl.GLSurfaceView
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.RCTEventEmitter

class DualSurfaceVideoView(context: Context) : FrameLayout(context), Player.Listener {

    companion object {
        private val activeInstances = java.util.Collections.newSetFromMap(java.util.WeakHashMap<DualSurfaceVideoView, Boolean>())
        @Volatile
        private var isGlobalInterruptionMuted: Boolean = false

        @JvmStatic
        fun registerInstance(view: DualSurfaceVideoView) {
            synchronized(activeInstances) {
                activeInstances.add(view)
            }
            view.post {
                view.applyMuteState()
            }
        }

        @JvmStatic
        fun unregisterInstance(view: DualSurfaceVideoView) {
            synchronized(activeInstances) {
                activeInstances.remove(view)
            }
        }

        @JvmStatic
        fun setGlobalInterruptionMuted(muted: Boolean) {
            android.util.Log.i("DualSurfaceVideoView", "setGlobalInterruptionMuted: muted=$muted, activeCount=${synchronized(activeInstances) { activeInstances.size }}")
            isGlobalInterruptionMuted = muted
            val mainHandler = Handler(Looper.getMainLooper())
            mainHandler.post {
                val views = synchronized(activeInstances) {
                    activeInstances.toList()
                }
                for (v in views) {
                    v.applyMuteState()
                }
            }
        }

        @JvmStatic
        fun isGlobalInterruptionMuted(): Boolean = isGlobalInterruptionMuted
    }

    var videoAspectRatio: Float = 16f / 9f
        private set

    fun getVideoRectInWindow(): android.graphics.Rect {
        val windowRect = android.graphics.Rect()
        getGlobalVisibleRect(windowRect)
        val dm = resources.displayMetrics
        val decorW = dm.widthPixels
        val decorH = dm.heightPixels

        if (windowRect.width() <= 50 || windowRect.height() <= 50) {
            val ar = if (videoAspectRatio > 0f) videoAspectRatio else (16f / 9f)
            val h = Math.round(decorW.toFloat() / ar)
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            val sb = if (resId > 0) resources.getDimensionPixelSize(resId) else 0
            val top = sb + Math.round(58f * dm.density)
            return android.graphics.Rect(0, top, decorW, top + h)
        }

        // Use contentRect whenever provided to map exact video bounds on screen
        val cr = renderer.contentRect
        if (cr != null && cr.width() > 0 && cr.height() > 0) {
            val left = Math.max(windowRect.left, windowRect.left + cr.left.toInt())
            val top = Math.max(windowRect.top, windowRect.top + cr.top.toInt())
            val right = Math.min(windowRect.right, windowRect.left + cr.right.toInt())
            val bottom = Math.min(windowRect.bottom, windowRect.top + cr.bottom.toInt())
            if (right > left && bottom > top) {
                return android.graphics.Rect(left, top, right, bottom)
            }
        }

        val ar = if (videoAspectRatio > 0f) videoAspectRatio else (16f / 9f)
        val viewW = windowRect.width()
        val viewH = windowRect.height()
        val viewAr = viewW.toFloat() / viewH.toFloat()

        return if (Math.abs(viewAr - ar) < 0.02f) {
            windowRect
        } else if (viewAr > ar) {
            val targetW = Math.round(viewH.toFloat() * ar)
            val diffX = (viewW - targetW) / 2
            android.graphics.Rect(windowRect.left + diffX, windowRect.top, windowRect.left + diffX + targetW, windowRect.bottom)
        } else {
            val targetH = Math.round(viewW.toFloat() / ar)
            val diffY = (viewH - targetH) / 2
            android.graphics.Rect(windowRect.left, windowRect.top + diffY, windowRect.right, windowRect.top + diffY + targetH)
        }
    }

    fun getVideoRectOnScreen(): android.graphics.Rect = getVideoRectInWindow()

    private val glSurfaceView: GLSurfaceView = GLSurfaceView(context)
    private val renderer: DualSurfaceVideoRenderer
    private var player: ExoPlayer? = null

    private var currentUri: String? = null
    private var customHeaders: Map<String, String>? = null
    private var isPlayingProp: Boolean = true
    private var isMutedProp: Boolean = false
    private var currentVolumeProp: Float = 1.0f
    private val handler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private var hasFiredReady: Boolean = false

    init {
        glSurfaceView.setEGLContextClientVersion(2)
        glSurfaceView.preserveEGLContextOnPause = true
        renderer = DualSurfaceVideoRenderer(glSurfaceView) {
            // Called on main thread when videoSurface is ready
            attachSurfaceToPlayer()
        }
        glSurfaceView.setRenderer(renderer)
        glSurfaceView.renderMode = if (renderer.roomTheme == "cinema") {
            GLSurfaceView.RENDERMODE_CONTINUOUSLY
        } else {
            GLSurfaceView.RENDERMODE_WHEN_DIRTY
        }

        renderer.onBbdResultListener = { ar, cropPct, horizCropPct ->
            val event = Arguments.createMap().apply {
                putDouble("aspectRatio", ar.toDouble())
                putDouble("verticalPercent", cropPct.toDouble())
                putDouble("horizontalPercent", horizCropPct.toDouble())
            }
            sendEvent("onBlackBarDetected", event)
        }

        addView(
            glSurfaceView,
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        registerInstance(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        registerInstance(this)
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        unregisterInstance(this)
    }

    fun applyMuteState() {
        val effectiveMuted = isMutedProp || isGlobalInterruptionMuted
        val targetVolume = if (effectiveMuted) 0f else currentVolumeProp
        player?.volume = targetVolume
        android.util.Log.i("DualSurfaceVideoView", "applyMuteState: isMutedProp=$isMutedProp, isGlobalInterruptionMuted=$isGlobalInterruptionMuted -> targetVolume=$targetVolume")
    }

    override fun requestLayout() {
        super.requestLayout()
        if (width == 0 || height == 0) {
            post(measureAndLayout)
        }
    }

    private val measureAndLayout = Runnable {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        glSurfaceView.requestRender()
        if (w > 0 && h > 0 && com.DME.MainActivity.isPipEnabled && com.DME.MainActivity.currentActivityInstance?.isInPictureInPictureMode == true) {
            post {
                com.DME.MainActivity.currentActivityInstance?.refreshPipParams()
            }
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (changed && com.DME.MainActivity.isPipEnabled && com.DME.MainActivity.currentActivityInstance?.isInPictureInPictureMode == true) {
            post {
                com.DME.MainActivity.currentActivityInstance?.refreshPipParams()
            }
        }
    }

    private fun getOrCreatePlayer(mediaSourceFactory: DefaultMediaSourceFactory): ExoPlayer {
        val existing = player
        if (existing != null) return existing

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val newPlayer = ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttributes, false)
            .build()
            .apply {
                addListener(this@DualSurfaceVideoView)
                playWhenReady = isPlayingProp
                volume = if (isMutedProp || isGlobalInterruptionMuted) 0f else currentVolumeProp
            }
        player = newPlayer
        attachSurfaceToPlayer()
        startProgressTracking()
        return newPlayer
    }

    private fun attachSurfaceToPlayer() {
        val surface = renderer.getVideoSurface()
        if (surface != null && surface.isValid && player != null) {
            player?.setVideoSurface(surface)
        }
    }

    fun setSource(uri: String?, headers: Map<String, String>? = null, startPositionSeconds: Double? = null) {
        if (uri.isNullOrEmpty()) {
            stopPlayback()
            return
        }
        if (uri == currentUri && headers == customHeaders && player != null) return
        currentUri = uri
        customHeaders = headers
        hasFiredReady = false
        renderer.resetBbd()
        renderer.isPlaybackActive = false
        glSurfaceView.requestRender()

        // 1. Build HTTP data source with custom headers and cookie authentication
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(10000)
            .setReadTimeoutMs(10000)

        val mergedHeaders = mutableMapOf<String, String>()

        val isYouTube = uri.contains("googlevideo.com") || uri.contains("youtube") || uri.endsWith(".mpd")
        if (isYouTube) {
            try {
                val cm = android.webkit.CookieManager.getInstance()
                val rawCookie = cm.getCookie("https://www.youtube.com") ?: cm.getCookie("https://m.youtube.com")
                if (!rawCookie.isNullOrEmpty()) {
                    // Only retain visitor-session cookies (VISITOR_INFO1_LIVE, YSC, PREF)
                    // Never inject user account cookies (LOGIN_INFO, SAPISID, SSID, HSID, SID, APISID)
                    // into visitor/PO-token chunk streams — Google CDN rejects the mismatch at 59s!
                    val safeCookies = rawCookie.split(";")
                        .map { it.trim() }
                        .filter { c ->
                            c.startsWith("VISITOR_INFO1_LIVE=") ||
                            c.startsWith("YSC=") ||
                            c.startsWith("PREF=")
                        }
                        .joinToString("; ")
                    if (safeCookies.isNotEmpty()) {
                        mergedHeaders["Cookie"] = safeCookies
                    }
                }
            } catch (_: Exception) {}
            mergedHeaders["Referer"] = "https://m.youtube.com/"
            mergedHeaders["Origin"] = "https://m.youtube.com"
        }

        // Apply custom headers passed from React Native (can override default headers)
        customHeaders?.let { h ->
            mergedHeaders.putAll(h)
        }

        // Ensure visitor cookie is synced into CookieManager for both logged-in and logged-out states
        val effectiveCookie = mergedHeaders["Cookie"]
        if (!effectiveCookie.isNullOrEmpty() && effectiveCookie.contains("VISITOR_INFO1_LIVE")) {
            try {
                val cm = android.webkit.CookieManager.getInstance()
                cm.setCookie("https://www.youtube.com", effectiveCookie)
                cm.setCookie("https://m.youtube.com", effectiveCookie)
                cm.setCookie(".youtube.com", effectiveCookie)
                cm.flush()
            } catch (_: Exception) {}
        }

        // MWEB DASH formats require mobile Safari User-Agent to match BotGuard Web PO-tokens
        val defaultUa = if (isYouTube) {
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        } else {
            "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip"
        }
        val ua = mergedHeaders["User-Agent"] ?: defaultUa
        httpDataSourceFactory.setUserAgent(ua)
        httpDataSourceFactory.setDefaultRequestProperties(mergedHeaders)

        // 2. Wrap in DefaultDataSource so file:// (local MPD manifests), content://, and https:// streams all work!
        val dataSourceFactory = DefaultDataSource.Factory(context, httpDataSourceFactory)
        val mediaSourceFactory = DefaultMediaSourceFactory(context)
            .setDataSourceFactory(dataSourceFactory)

        val p = getOrCreatePlayer(mediaSourceFactory)
        attachSurfaceToPlayer()

        // Reset track selection overrides and size constraints for the new track
        p.trackSelectionParameters = p.trackSelectionParameters
            .buildUpon()
            .clearOverrides()
            .clearVideoSizeConstraints()
            .build()
        currentQualityProp = "auto"

        // 3. Infer stream format (DASH MPD vs HLS M3U8 vs progressive MP4)
        val uriParsed = Uri.parse(uri)
        val isDash = uri.endsWith(".mpd") || uri.contains("dash") || uri.startsWith("data:application/dash+xml")
        val isHls = uri.endsWith(".m3u8") || uri.contains("m3u8") || uri.contains("hls_variant") || uri.contains("hls")
        val mediaItem = MediaItem.Builder()
            .setUri(uriParsed)
            .apply {
                if (isDash) {
                    setMimeType(MimeTypes.APPLICATION_MPD)
                } else if (isHls) {
                    setMimeType(MimeTypes.APPLICATION_M3U8)
                }
            }
            .build()

        val mediaSource = mediaSourceFactory.createMediaSource(mediaItem)
        val shouldReset = (startPositionSeconds == null || startPositionSeconds <= 0.0)
        p.setMediaSource(mediaSource, shouldReset)
        if (startPositionSeconds != null && startPositionSeconds > 0.0) {
            p.seekTo((startPositionSeconds * 1000).toLong())
        }
        p.prepare()
        p.setPlaybackSpeed(currentPlaybackRateProp)
        p.playWhenReady = isPlayingProp
    }

    fun setPlay(play: Boolean) {
        isPlayingProp = play
        player?.playWhenReady = play
    }

    fun setMuted(muted: Boolean) {
        isMutedProp = muted
        applyMuteState()
    }

    fun setVolume(volume: Float) {
        currentVolumeProp = volume.coerceIn(0f, 1f)
        applyMuteState()
    }

    private var currentPlaybackRateProp: Float = 1.0f

    fun setPlaybackRate(rate: Float) {
        val safeRate = rate.coerceIn(0.25f, 2.0f)
        currentPlaybackRateProp = safeRate
        player?.setPlaybackSpeed(safeRate)
    }

    fun seekTo(seconds: Double) {
        val p = player ?: return
        if (p.isCurrentMediaItemLive) {
            if (!p.isCurrentMediaItemSeekable || seconds <= 0) {
                p.seekToDefaultPosition()
                return
            }
        }
        val ms = (seconds * 1000).toLong()
        p.seekTo(ms)
        renderer.onSeek()
    }

    fun stopPlayback() {
        player?.stop()
        player?.clearMediaItems()
        player?.setPlaybackSpeed(1.0f)
        currentPlaybackRateProp = 1.0f
        currentUri = null
        hasFiredReady = false
        renderer.resetBbd()
        renderer.isPlaybackActive = false
        glSurfaceView.requestRender()
    }

    private var currentQualityProp: String = "auto"

    fun setQuality(quality: String) {
        currentQualityProp = quality
        val p = player ?: return

        if (quality.equals("auto", ignoreCase = true)) {
            p.trackSelectionParameters = p.trackSelectionParameters
                .buildUpon()
                .clearVideoSizeConstraints()
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .build()
            android.util.Log.i("DualSurfaceVideoView", "Quality set to AUTO (constraints cleared)")
            return
        }

        val targetHeight = parseQualityHeight(quality)
        if (targetHeight <= 0) return

        android.util.Log.i("DualSurfaceVideoView", "Setting ExoPlayer quality to: $quality (targetHeight=$targetHeight)")

        var applied = false
        val tracks = p.currentTracks
        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_VIDEO) {
                var bestTrackIdx = -1
                var minDiff = Int.MAX_VALUE
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    if (format.height > 0) {
                        val diff = Math.abs(format.height - targetHeight)
                        if (diff < minDiff) {
                            minDiff = diff
                            bestTrackIdx = i
                        }
                    }
                }
                if (bestTrackIdx != -1) {
                    val override = TrackSelectionOverride(
                        group.mediaTrackGroup,
                        listOf(bestTrackIdx)
                    )
                    p.trackSelectionParameters = p.trackSelectionParameters
                        .buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                        .addOverride(override)
                        .setMaxVideoSize(Int.MAX_VALUE, targetHeight)
                        .build()
                    applied = true
                    android.util.Log.i("DualSurfaceVideoView", "Applied TrackSelectionOverride to index $bestTrackIdx (height=$targetHeight)")
                    break
                }
            }
        }

        if (!applied) {
            p.trackSelectionParameters = p.trackSelectionParameters
                .buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .setMaxVideoSize(Int.MAX_VALUE, targetHeight)
                .setMinVideoSize(0, targetHeight)
                .build()
            android.util.Log.i("DualSurfaceVideoView", "Applied MaxVideoSize constraint (height=$targetHeight)")
        }
    }

    private fun parseQualityHeight(q: String): Int {
        val lower = q.lowercase()
        val map = mapOf(
            "hd2160" to 2160,
            "highres" to 2160,
            "hd1440" to 1440,
            "hd1080" to 1080,
            "hd720" to 720,
            "large" to 480,
            "medium" to 360,
            "small" to 240,
            "tiny" to 144
        )
        if (map.containsKey(lower)) {
            return map[lower]!!
        }
        val digits = q.filter { it.isDigit() }
        return digits.toIntOrNull() ?: 0
    }

    fun setRoomTheme(theme: String) {
        renderer.roomTheme = theme
        glSurfaceView.renderMode = if (theme == "cinema") {
            GLSurfaceView.RENDERMODE_CONTINUOUSLY
        } else {
            GLSurfaceView.RENDERMODE_WHEN_DIRTY
        }
        glSurfaceView.requestRender()
    }

    fun setBleedEnabled(enabled: Boolean) {
        renderer.bleedEnabled = enabled
        glSurfaceView.requestRender()
    }

    fun setIsTransparentBackground(transparent: Boolean) {
        renderer.isTransparentBackground = transparent
        glSurfaceView.requestRender()
    }

    fun setBleedDarkness(darkness: Float) {
        renderer.bleedDarkness = darkness
        glSurfaceView.requestRender()
    }

    fun setBbdCropPercent(cropPercent: Float) {
        renderer.bbdCropPercent = cropPercent
        glSurfaceView.requestRender()
    }

    fun setBbdHorizCropPercent(cropPercent: Float) {
        renderer.bbdHorizCropPercent = cropPercent
        glSurfaceView.requestRender()
    }

    fun setBlurSigma(sigma: Float) {
        renderer.blurSigma = sigma
        glSurfaceView.requestRender()
    }

    fun setContentRect(rect: android.graphics.RectF?) {
        renderer.contentRect = rect
        glSurfaceView.requestRender()
        post {
            com.DME.MainActivity.currentActivityInstance?.refreshPipParams()
        }
    }

    fun setDisplayMode(mode: Int) {
        renderer.displayMode = mode
        glSurfaceView.requestRender()
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (visibility == View.VISIBLE) {
            glSurfaceView.requestRender()
        }
    }

    override fun onTouchEvent(event: MotionEvent?): Boolean {
        return false
    }

    // ── ExoPlayer Player.Listener Callbacks ──

    private fun sendReadyEvent() {
        if (!hasFiredReady) {
            hasFiredReady = true
            val isLive = (player?.isCurrentMediaItemLive == true) || (currentUri?.contains(".m3u8") == true) || (currentUri?.contains("hls") == true)
            val durationSec = if (isLive) 0.0 else ((player?.duration?.coerceAtLeast(0) ?: 0) / 1000.0)
            val event = Arguments.createMap().apply {
                putDouble("duration", durationSec)
                putBoolean("isLive", isLive)
            }
            sendEvent("onReady", event)
        }
    }

    override fun onRenderedFirstFrame() {
        renderer.isPlaybackActive = true
        glSurfaceView.requestRender()
        sendReadyEvent()
        if (com.DME.MainActivity.isPipEnabled && com.DME.MainActivity.currentActivityInstance?.isInPictureInPictureMode == true) {
            post {
                com.DME.MainActivity.currentActivityInstance?.refreshPipParams()
            }
        }
    }

    override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (videoSize.width > 0 && videoSize.height > 0) {
            val ar = videoSize.width.toFloat() / videoSize.height.toFloat()
            videoAspectRatio = ar
            renderer.videoAspectRatio = ar
            glSurfaceView.requestRender()
            post {
                com.DME.MainActivity.currentActivityInstance?.refreshPipParams()
            }

            val event = Arguments.createMap().apply {
                putDouble("aspectRatio", ar.toDouble())
                putInt("width", videoSize.width)
                putInt("height", videoSize.height)
            }
            sendEvent("onAspectRatio", event)

            val resEvent = Arguments.createMap().apply {
                putString("resolution", "${videoSize.height}p")
                putInt("height", videoSize.height)
                putInt("width", videoSize.width)
            }
            sendEvent("onExactResolution", resEvent)
        }
    }

    override fun onTracksChanged(tracks: Tracks) {
        val qualities = ArrayList<String>()
        var hasSelectedAudio = false
        var audioGroupToSelect: Tracks.Group? = null

        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_VIDEO) {
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    if (format.height > 0) {
                        val qKey = when (format.height) {
                            in 2160..Int.MAX_VALUE -> "hd2160"
                            in 1440..2159 -> "hd1440"
                            in 1080..1439 -> "hd1080"
                            in 720..1079 -> "hd720"
                            in 480..719 -> "large"
                            in 360..479 -> "medium"
                            in 240..359 -> "small"
                            else -> "tiny"
                        }
                        if (!qualities.contains(qKey)) {
                            qualities.add(qKey)
                        }
                    }
                }
            } else if (group.type == C.TRACK_TYPE_AUDIO) {
                val f = if (group.length > 0) group.getTrackFormat(0) else null
                android.util.Log.i("DualSurfaceVideoView", "Audio track group: selected=${group.isSelected}, supported=${group.isSupported}, count=${group.length}, sampleMime=${f?.sampleMimeType}, containerMime=${f?.containerMimeType}, codecs=${f?.codecs}, rate=${f?.sampleRate}, ch=${f?.channelCount}")
                if (group.isSelected) {
                    hasSelectedAudio = true
                } else if (audioGroupToSelect == null && group.isSupported) {
                    audioGroupToSelect = group
                }
            }
        }
        if (qualities.isNotEmpty()) {
            val event = Arguments.createMap().apply {
                val arr = Arguments.createArray()
                for (q in qualities) arr.pushString(q)
                putArray("qualities", arr)
            }
            sendEvent("onQualitiesAvailable", event)
        }

        // If audio track is not automatically selected by ExoPlayer, force select it
        if (!hasSelectedAudio && audioGroupToSelect != null) {
            android.util.Log.i("DualSurfaceVideoView", "Explicitly selecting audio track group")
            player?.let { p ->
                val audioOverride = TrackSelectionOverride(audioGroupToSelect.mediaTrackGroup, listOf(0))
                p.trackSelectionParameters = p.trackSelectionParameters
                    .buildUpon()
                    .addOverride(audioOverride)
                    .build()
            }
        }

        if (currentQualityProp != "auto") {
            setQuality(currentQualityProp)
        }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            Player.STATE_READY -> {
                // Check if this stream has a video track
                val hasVideoTrack = player?.currentTracks?.isTypeSupported(C.TRACK_TYPE_VIDEO) == true ||
                        player?.currentTracks?.isTypeSelected(C.TRACK_TYPE_VIDEO) == true
                if (!hasVideoTrack) {
                    // Audio-only streams will never fire onRenderedFirstFrame
                    renderer.isPlaybackActive = true
                    glSurfaceView.requestRender()
                    sendReadyEvent()
                } else {
                    // For video streams, DO NOT set isPlaybackActive or requestRender here!
                    // Wait for onRenderedFirstFrame() so the actual decoded frame is ready on SurfaceTexture.
                    // Fallback after 1500ms in case backgrounded or display surface off.
                    postDelayed({
                        if (!hasFiredReady && player?.playbackState == Player.STATE_READY) {
                            renderer.isPlaybackActive = true
                            glSurfaceView.requestRender()
                            sendReadyEvent()
                        }
                    }, 1500)
                }

                val bufferEvent = Arguments.createMap().apply {
                    putBoolean("isBuffering", false)
                }
                sendEvent("onBuffer", bufferEvent)
            }
            Player.STATE_ENDED -> {
                sendEvent("onEnd", Arguments.createMap())
            }
            Player.STATE_BUFFERING -> {
                val event = Arguments.createMap().apply {
                    putBoolean("isBuffering", true)
                }
                sendEvent("onBuffer", event)
            }
            else -> {}
        }
    }

    override fun onPlayerError(error: PlaybackException) {
        android.util.Log.e("DualSurfaceVideoView", "ExoPlayer error: ${error.message}", error)
        val event = Arguments.createMap().apply {
            putString("error", error.message ?: "Unknown playback error")
            putInt("errorCode", error.errorCode)
        }
        sendEvent("onError", event)
    }

    private fun startProgressTracking() {
        progressRunnable = object : Runnable {
            override fun run() {
                val p = player
                if (p != null && p.playbackState == Player.STATE_READY && renderer.isPlaybackActive) {
                    val currentPos = p.currentPosition / 1000.0
                    val isLive = (p.isCurrentMediaItemLive) || (currentUri?.contains(".m3u8") == true) || (currentUri?.contains("hls") == true)
                    val dur = if (isLive) 0.0 else ((p.duration.coerceAtLeast(0)) / 1000.0)
                    if (!hasFiredReady && (currentPos > 0 || isLive)) {
                        sendReadyEvent()
                    }
                    val event = Arguments.createMap().apply {
                        putDouble("currentTime", if (isLive) 0.0 else currentPos)
                        putDouble("duration", dur)
                        putBoolean("isLive", isLive)
                    }
                    sendEvent("onProgress", event)
                }
                handler.postDelayed(this, 250)
            }
        }
        handler.post(progressRunnable!!)
    }

    // Modern Fabric / Bridgeless event dispatcher
    private class FabricEvent(
        surfaceId: Int,
        viewTag: Int,
        private val name: String,
        private val data: WritableMap
    ) : Event<FabricEvent>(surfaceId, viewTag) {
        override fun getEventName(): String = name
        override fun getEventData(): WritableMap = data
        override fun canCoalesce(): Boolean = false
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        val reactContext = context as? ReactContext ?: return
        val topEventName = if (eventName.startsWith("top")) eventName else {
            "top" + eventName.removePrefix("on")
        }

        fun doSend() {
            val targetId = id
            if (targetId == View.NO_ID || targetId == -1) {
                // View ID not assigned yet, schedule retry
                handler.postDelayed({ doSend() }, 80)
                return
            }
            try {
                val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, targetId)
                if (eventDispatcher != null) {
                    val surfaceId = UIManagerHelper.getSurfaceId(this as View)
                    eventDispatcher.dispatchEvent(FabricEvent(surfaceId, targetId, topEventName, params))
                    return
                }
            } catch (_: Throwable) {}

            try {
                @Suppress("DEPRECATION")
                reactContext.getJSModule(RCTEventEmitter::class.java)?.receiveEvent(targetId, topEventName, params)
            } catch (_: Throwable) {}
        }

        if (Looper.myLooper() == Looper.getMainLooper()) {
            doSend()
        } else {
            handler.post { doSend() }
        }
    }

    fun cleanup() {
        unregisterInstance(this)
        progressRunnable?.let { handler.removeCallbacks(it) }
        player?.stop()
        player?.release()
        player = null
        renderer.release()
    }
}
