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

    var videoAspectRatio: Float = 16f / 9f
        private set

    fun getVideoRectOnScreen(): android.graphics.Rect {
        val cr = renderer.contentRect
        val loc = IntArray(2)
        getLocationOnScreen(loc)
        if (cr != null && cr.width() > 0 && cr.height() > 0) {
            return android.graphics.Rect(
                loc[0] + cr.left.toInt(),
                loc[1] + cr.top.toInt(),
                loc[0] + cr.right.toInt(),
                loc[1] + cr.bottom.toInt()
            )
        }
        val dm = resources.displayMetrics
        val w = if (width > 50) width else dm.widthPixels
        val ar = if (videoAspectRatio > 0f) videoAspectRatio else (16f / 9f)
        val h = if (height > 50) Math.min(height, Math.round(w / ar)) else Math.round(w / ar)
        val left = if (width > 50) loc[0] else 0
        val top = if (height > 50) loc[1] else run {
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            val sb = if (resId > 0) resources.getDimensionPixelSize(resId) else 0
            sb + Math.round(58f * dm.density)
        }
        return android.graphics.Rect(left, top, left + w, top + h)
    }

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
        glSurfaceView.renderMode = GLSurfaceView.RENDERMODE_WHEN_DIRTY

        addView(
            glSurfaceView,
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
    }

    private fun getOrCreatePlayer(mediaSourceFactory: DefaultMediaSourceFactory): ExoPlayer {
        val existing = player
        if (existing != null) return existing

        val newPlayer = ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()
            .apply {
                addListener(this@DualSurfaceVideoView)
                playWhenReady = isPlayingProp
                volume = if (isMutedProp) 0f else currentVolumeProp
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

    fun setSource(uri: String?, headers: Map<String, String>? = null) {
        if (uri.isNullOrEmpty()) {
            stopPlayback()
            return
        }
        if (uri == currentUri && headers == customHeaders && player != null) return
        currentUri = uri
        customHeaders = headers
        hasFiredReady = false
        renderer.isPlaybackActive = false
        glSurfaceView.requestRender()

        // 1. Build HTTP data source with custom headers
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(10000)
            .setReadTimeoutMs(10000)

        customHeaders?.let { h ->
            httpDataSourceFactory.setDefaultRequestProperties(h)
        }

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
        p.setMediaSource(mediaSource, true)
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
        player?.volume = if (muted) 0f else currentVolumeProp
    }

    fun setVolume(volume: Float) {
        currentVolumeProp = volume.coerceIn(0f, 1f)
        if (!isMutedProp) {
            player?.volume = currentVolumeProp
        }
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
    }

    fun stopPlayback() {
        player?.stop()
        player?.clearMediaItems()
        player?.setPlaybackSpeed(1.0f)
        currentPlaybackRateProp = 1.0f
        currentUri = null
        hasFiredReady = false
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

    fun setBleedEnabled(enabled: Boolean) {
        renderer.bleedEnabled = enabled
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

    fun setBlurSigma(sigma: Float) {
        renderer.blurSigma = sigma
        glSurfaceView.requestRender()
    }

    fun setContentRect(rect: android.graphics.RectF?) {
        renderer.contentRect = rect
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

    override fun onRenderedFirstFrame() {
        if (!hasFiredReady) {
            hasFiredReady = true
            val isLive = player?.isCurrentMediaItemLive == true
            val durationSec = (player?.duration?.coerceAtLeast(0) ?: 0) / 1000.0
            val event = Arguments.createMap().apply {
                putDouble("duration", durationSec)
                putBoolean("isLive", isLive)
            }
            sendEvent("onReady", event)
        }
    }

    override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (videoSize.width > 0 && videoSize.height > 0) {
            val ar = videoSize.width.toFloat() / videoSize.height.toFloat()
            videoAspectRatio = ar
            renderer.videoAspectRatio = ar
            glSurfaceView.requestRender()

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

        if (currentQualityProp != "auto") {
            setQuality(currentQualityProp)
        }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            Player.STATE_READY -> {
                renderer.isPlaybackActive = true
                glSurfaceView.requestRender()
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
                    if (!hasFiredReady && (currentPos > 0 || dur > 0 || isLive)) {
                        hasFiredReady = true
                        val readyEvt = Arguments.createMap().apply {
                            putDouble("duration", dur)
                            putBoolean("isLive", isLive)
                        }
                        sendEvent("onReady", readyEvt)
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
        progressRunnable?.let { handler.removeCallbacks(it) }
        player?.stop()
        player?.release()
        player = null
        renderer.release()
    }
}
