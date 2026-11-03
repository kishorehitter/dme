package com.DME.shaders

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class DualSurfaceViewManager : SimpleViewManager<DualSurfaceVideoView>() {

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(reactContext: ThemedReactContext): DualSurfaceVideoView {
        return DualSurfaceVideoView(reactContext)
    }

    override fun onDropViewInstance(view: DualSurfaceVideoView) {
        super.onDropViewInstance(view)
        view.cleanup()
    }

    @ReactProp(name = "source")
    fun setSource(view: DualSurfaceVideoView, source: ReadableMap?) {
        if (source == null) {
            view.stopPlayback()
            return
        }
        val uri = if (source.hasKey("uri")) source.getString("uri") else null
        val headers = if (source.hasKey("headers")) {
            val hMap = HashMap<String, String>()
            val headerMap = source.getMap("headers")
            val iterator = headerMap?.keySetIterator()
            while (iterator != null && iterator.hasNextKey()) {
                val key = iterator.nextKey()
                headerMap.getString(key)?.let { hMap[key] = it }
            }
            hMap
        } else null
        view.setSource(uri, headers)
    }

    @ReactProp(name = "play")
    fun setPlay(view: DualSurfaceVideoView, play: Boolean) {
        view.setPlay(play)
    }

    @ReactProp(name = "muted")
    fun setMuted(view: DualSurfaceVideoView, muted: Boolean) {
        view.setMuted(muted)
    }

    @ReactProp(name = "volume", defaultFloat = 1.0f)
    fun setVolume(view: DualSurfaceVideoView, volume: Float) {
        view.setVolume(volume)
    }

    @ReactProp(name = "bleedEnabled", defaultBoolean = true)
    fun setBleedEnabled(view: DualSurfaceVideoView, enabled: Boolean) {
        view.setBleedEnabled(enabled)
    }

    @ReactProp(name = "bleedDarkness", defaultFloat = 0.55f)
    fun setBleedDarkness(view: DualSurfaceVideoView, darkness: Float) {
        view.setBleedDarkness(darkness)
    }

    @ReactProp(name = "bbdCropPercent", defaultFloat = 0.0f)
    fun setBbdCropPercent(view: DualSurfaceVideoView, cropPercent: Float) {
        view.setBbdCropPercent(cropPercent)
    }

    @ReactProp(name = "blurSigma", defaultFloat = 48.0f)
    fun setBlurSigma(view: DualSurfaceVideoView, sigma: Float) {
        view.setBlurSigma(sigma)
    }

    @ReactProp(name = "contentRect")
    fun setContentRect(view: DualSurfaceVideoView, rect: ReadableMap?) {
        if (rect == null) {
            view.setContentRect(null)
            return
        }
        val density = view.context.resources.displayMetrics.density
        val x = (if (rect.hasKey("x")) rect.getDouble("x") else 0.0) * density
        val y = (if (rect.hasKey("y")) rect.getDouble("y") else 0.0) * density
        val w = (if (rect.hasKey("width")) rect.getDouble("width") else -1.0) * density
        val h = (if (rect.hasKey("height")) rect.getDouble("height") else -1.0) * density

        if (w > 0 && h > 0) {
            view.setContentRect(android.graphics.RectF(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat()))
        } else {
            view.setContentRect(null)
        }
    }

    @ReactProp(name = "quality")
    fun setQuality(view: DualSurfaceVideoView, quality: String?) {
        view.setQuality(quality ?: "auto")
    }

    @ReactProp(name = "playbackRate", defaultFloat = 1.0f)
    fun setPlaybackRate(view: DualSurfaceVideoView, rate: Float) {
        view.setPlaybackRate(rate)
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
        val map = HashMap<String, Any>()
        val events = listOf("Ready", "Progress", "End", "Buffer", "Error", "AspectRatio", "ExactResolution", "QualitiesAvailable")
        for (event in events) {
            val topName = "top$event"
            val regName = "on$event"
            map[topName] = MapBuilder.of("registrationName", regName)
        }
        return map
    }

    override fun getCommandsMap(): Map<String, Int> {
        return mapOf(
            "seekTo" to COMMAND_SEEK_TO,
            "play" to COMMAND_PLAY,
            "pause" to COMMAND_PAUSE,
            "setVolume" to COMMAND_SET_VOLUME,
            "setQuality" to COMMAND_SET_QUALITY,
            "stop" to COMMAND_STOP,
            "setPlaybackRate" to COMMAND_SET_PLAYBACK_RATE
        )
    }

    @Deprecated("Deprecated in Java")
    override fun receiveCommand(view: DualSurfaceVideoView, commandId: Int, args: ReadableArray?) {
        when (commandId) {
            COMMAND_SEEK_TO -> {
                val seconds = args?.getDouble(0) ?: 0.0
                view.seekTo(seconds)
            }
            COMMAND_PLAY -> view.setPlay(true)
            COMMAND_PAUSE -> view.setPlay(false)
            COMMAND_SET_VOLUME -> {
                val volume = args?.getDouble(0)?.toFloat() ?: 1.0f
                view.setVolume(volume)
            }
            COMMAND_SET_QUALITY -> {
                val quality = args?.getString(0) ?: "auto"
                view.setQuality(quality)
            }
            COMMAND_STOP -> view.stopPlayback()
            COMMAND_SET_PLAYBACK_RATE -> {
                val rate = args?.getDouble(0)?.toFloat() ?: 1.0f
                view.setPlaybackRate(rate)
            }
        }
    }

    override fun receiveCommand(view: DualSurfaceVideoView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "seekTo" -> {
                val seconds = args?.getDouble(0) ?: 0.0
                view.seekTo(seconds)
            }
            "play" -> view.setPlay(true)
            "pause" -> view.setPlay(false)
            "setVolume" -> {
                val volume = args?.getDouble(0)?.toFloat() ?: 1.0f
                view.setVolume(volume)
            }
            "setQuality" -> {
                val quality = args?.getString(0) ?: "auto"
                view.setQuality(quality)
            }
            "stop" -> view.stopPlayback()
            "setPlaybackRate" -> {
                val rate = args?.getDouble(0)?.toFloat() ?: 1.0f
                view.setPlaybackRate(rate)
            }
        }
    }

    companion object {
        const val REACT_CLASS = "DualSurfaceVideoView"

        const val COMMAND_SEEK_TO = 1
        const val COMMAND_PLAY = 2
        const val COMMAND_PAUSE = 3
        const val COMMAND_SET_VOLUME = 4
        const val COMMAND_SET_QUALITY = 5
        const val COMMAND_STOP = 6
        const val COMMAND_SET_PLAYBACK_RATE = 7
    }
}
