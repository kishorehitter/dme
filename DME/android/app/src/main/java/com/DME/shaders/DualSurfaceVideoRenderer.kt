package com.DME.shaders

import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Handler
import android.os.Looper
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * DualSurfaceVideoRenderer
 * 
 * Re-engineered 1:1 from Rave Watch Party's native OpenGL ES 2.0 decompiled shaders:
 * (com.wemesh.android.legacy.shaders.BackgroundResizeShader,
 *  com.wemesh.android.legacy.shaders.BackgroundBlurYShader,
 *  com.wemesh.android.legacy.shaders.BackgroundBlurVertexShader,
 *  com.wemesh.android.legacy.shaders.ShaderRenderer).
 *
 * Pipeline Architecture:
 * 1. ExoPlayer decodes video once directly onto GL_TEXTURE_EXTERNAL_OES (zero duplicate decoding).
 * 2. PASS 1 (BackgroundResizeShader):
 *    - Viewport: Low-resolution Framebuffer Object (FBO) (60 x [60 * screenAspect], ~60x133).
 *    - Maps video center outward to fill background aspect ratio (eliminating oily vertical stretch).
 *    - Crops black letterbox bars using vLetterboxPercentage.
 *    - Performs 12-tap horizontal 1D Gaussian blur across normalized kernel weights.
 * 3. PASS 2 (BackgroundBlurYShader):
 *    - Viewport: Full screen (window framebuffer 0).
 *    - Samples Pass 1's FBO texture via sampler2D with hardware GL_LINEAR bilinear filtering.
 *    - Performs 12-tap vertical 1D Gaussian blur, completing a mathematically pure 2D Gaussian blur.
 *    - Result: Silky-smooth, cloud-like ambient glowing aura with ZERO visible dots, edges, or lines.
 * 4. PASS 3 (Foreground Content Blit):
 *    - Renders sharp, unblurred, letterbox-cropped video quad centered inside the video container.
 */
class DualSurfaceVideoRenderer(
    private val glSurfaceView: GLSurfaceView,
    private val onFrameListener: (() -> Unit)? = null
) : GLSurfaceView.Renderer, SurfaceTexture.OnFrameAvailableListener {

    private var textureId: Int = 0
    private var surfaceTexture: SurfaceTexture? = null
    private var videoSurface: Surface? = null
    @Volatile private var isReleased = false

    private val mvpMatrix = FloatArray(16)
    private val stMatrix = FloatArray(16)
    private val identityMatrix = FloatArray(16)

    // Full quad vertex buffer (-1..1)
    private val quadVertices: FloatBuffer
    // Standard texture coordinate buffer (0..1)
    private val quadTexCoords: FloatBuffer

    // FBO (Offscreen Framebuffer for Rave downsampled blur)
    private var fboId = 0
    private var fboTextureId = 0
    private var fboWidth = 60
    private var fboHeight = 133

    // ── Shader Programs ──
    // 1. Foreground Sharp Content Shader
    private var blitProgram = 0
    private var blitPositionHandle = 0
    private var blitTexCoordHandle = 0
    private var blitMVPMatrixHandle = 0
    private var blitSTMatrixHandle = 0
    private var blitTextureHandle = 0
    private var blitCropHandle = 0
    private var blitHorizCropHandle = 0
    private var blitHalfSizeHandle = 0
    private var blitRadiusHandle = 0
    private var blitDisplayModeHandle = 0

    // 2. Rave Pass 1: BackgroundResizeShader (Horizontal Gaussian downsample to FBO)
    private var resizeProgram = 0
    private var resizePositionHandle = 0
    private var resizeTexCoordHandle = 0
    private var resizeMVPMatrixHandle = 0
    private var resizeSTMatrixHandle = 0
    private var resizeTextureHandle = 0
    private var resizeLetterboxHandle = 0
    private var resizeAspectRatioHandle = 0
    private var resizeFboSizeHandle = 0

    // 3. Rave Pass 2: BackgroundBlurYShader (Vertical Gaussian upscale to Screen)
    private var blurYProgram = 0
    private var blurYPositionHandle = 0
    private var blurYTexCoordHandle = 0
    private var blurYMVPMatrixHandle = 0
    private var blurYSTMatrixHandle = 0
    private var blurYTextureHandle = 0
    private var blurYLetterboxHandle = 0
    private var blurYAspectRatioHandle = 0
    private var blurYFboSizeHandle = 0
    private var blurYDarknessHandle = 0

    // 4. Cinema Pass: Ambient Disco VIP Aurora Fluid Shader
    private var cinemaProgram = 0
    private var cinemaPositionHandle = 0
    private var cinemaTexCoordHandle = 0
    private var cinemaMVPMatrixHandle = 0
    private var cinemaTimeHandle = 0
    private var cinemaResolutionHandle = 0
    private val startTimeNs = System.nanoTime()

    // Pre-allocated identity matrix to eliminate 60-120 heap allocations per second (stops GC churn)
    private val cinemaMvpMatrix = FloatArray(16).apply {
        Matrix.setIdentityM(this, 0)
    }

    // Cinema Pass FBO (downsampling to eliminate GPU thermal throttling and lag)
    private var cinemaFboId = 0
    private var cinemaFboTextureId = 0
    private var cinemaFboWidth = 0
    private var cinemaFboHeight = 0

    // Cinema Pass 2: Upscale blit program (bilinear hardware filtering to physical screen)
    private var cinemaBlitProgram = 0
    private var cinemaBlitPositionHandle = 0
    private var cinemaBlitTexCoordHandle = 0
    private var cinemaBlitTextureHandle = 0

    // State properties (updated from UI thread)
    @Volatile var roomTheme: String = "rave"
    @Volatile var bleedEnabled: Boolean = true
    @Volatile var isTransparentBackground: Boolean = false
    @Volatile var bleedDarkness: Float = 0.55f
    @Volatile var bbdCropPercent: Float = 0.0f
    @Volatile var bbdHorizCropPercent: Float = 0.0f
    @Volatile var displayMode: Int = 0 // 0 = Fit Dynamic (Shrink/Expand Container), 1 = Zoom to Fill
    @Volatile var videoAspectRatio: Float = 16f / 9f
    @Volatile var blurSigma: Float = 48.0f
    @Volatile var contentRect: android.graphics.RectF? = null
    @Volatile var isPlaybackActive: Boolean = false

    // Smooth crop & zoom interpolation state (slow-motion cinematic fluid filling animation)
    private var currentCropPercent: Float = 0.0f
    private var currentHorizCropPercent: Float = 0.0f
    private var currentZoomProgress: Float = 0.0f // 0.0f = Fit, 1.0f = Zoom to Fill
    private var liveEffectiveCropPercent: Float = 0.0f
    private var liveEffectiveHorizCropPercent: Float = 0.0f
    private var lastFrameTimeNs: Long = 0L

    // Cubic in-out animation engines (380ms smooth fluid transition, exactly matching React Native Easing.inOut(Easing.cubic))
    private val ANIM_DURATION_NS: Long = 380_000_000L // 380ms (ultra-smooth, zero stutter, perfectly synced)
    private fun easeInOutCubic(progress: Float): Float {
        return if (progress < 0.5f) {
            4f * progress * progress * progress
        } else {
            1f - Math.pow((-2.0 * progress + 2.0), 3.0).toFloat() / 2f
        }
    }
    private var cropAnimStartTimeNs: Long = 0L
    private var cropAnimStartVert: Float = 0f
    private var cropAnimStartHoriz: Float = 0f
    private var cropAnimTargetVert: Float = 0f
    private var cropAnimTargetHoriz: Float = 0f

    private var zoomAnimStartTimeNs: Long = 0L
    private var zoomAnimStartProgress: Float = 0f
    private var zoomAnimTargetProgress: Float = 0f

    // Smooth viewport rectangle interpolation (prevents any viewport jumps or black stutter)
    private var currentRectLeft: Float = -1f
    private var currentRectTop: Float = -1f
    private var currentRectRight: Float = -1f
    private var currentRectBottom: Float = -1f

    private var rectAnimStartTimeNs: Long = 0L
    private var rectAnimStartLeft: Float = 0f
    private var rectAnimStartTop: Float = 0f
    private var rectAnimStartRight: Float = 0f
    private var rectAnimStartBottom: Float = 0f
    private var rectAnimTargetLeft: Float = -1f
    private var rectAnimTargetTop: Float = -1f
    private var rectAnimTargetRight: Float = -1f
    private var rectAnimTargetBottom: Float = -1f
    private var currentRectAnimProgress: Float = 1.0f

    // Live Frame Black Bar Detection (Rave post-playback BBD: Letterbox & Pillarbox)
    private var bbdFrameCounter = 0
    private var bbdDetectionDone = false
    private val bbdLetterboxSamples = ArrayList<Float>()
    private val bbdPillarboxSamples = ArrayList<Float>()
    private var bbdFullFrameCount = 0
    private var bbdPixelBuffer: ByteBuffer? = null
    var onBbdResultListener: ((aspectRatio: Float, verticalPercent: Float, horizontalPercent: Float) -> Unit)? = null

    fun resetBbd() {
        bbdDetectionDone = false
        bbdFrameCounter = 0
        bbdLetterboxSamples.clear()
        bbdPillarboxSamples.clear()
        bbdFullFrameCount = 0
        bbdCropPercent = 0.0f
        bbdHorizCropPercent = 0.0f
        currentCropPercent = 0.0f
        currentHorizCropPercent = 0.0f
        liveEffectiveCropPercent = 0.0f
        liveEffectiveHorizCropPercent = 0.0f
        currentZoomProgress = if (displayMode == 1) 1.0f else 0.0f
        currentRectLeft = -1f
        currentRectTop = -1f
        currentRectRight = -1f
        currentRectBottom = -1f
        lastFrameTimeNs = 0L

        cropAnimStartTimeNs = 0L
        cropAnimStartVert = 0f
        cropAnimStartHoriz = 0f
        cropAnimTargetVert = 0f
        cropAnimTargetHoriz = 0f

        zoomAnimStartTimeNs = 0L
        zoomAnimStartProgress = if (displayMode == 1) 1.0f else 0.0f
        zoomAnimTargetProgress = zoomAnimStartProgress

        rectAnimStartTimeNs = 0L
        currentRectAnimProgress = 1.0f
        rectAnimTargetLeft = -1f
        rectAnimTargetTop = -1f
        rectAnimTargetRight = -1f
        rectAnimTargetBottom = -1f
    }

    fun onSeek() {
        // If detection has not completed yet, reset counter to sample at new position
        if (!bbdDetectionDone && bbdLetterboxSamples.isEmpty() && bbdPillarboxSamples.isEmpty()) {
            bbdFrameCounter = 0
            bbdFullFrameCount = 0
        }
    }

    private var surfaceWidth = 0
    private var surfaceHeight = 0
    private var updateSurface = false
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        val quad = floatArrayOf(
            -1.0f, -1.0f, 0.0f,
             1.0f, -1.0f, 0.0f,
            -1.0f,  1.0f, 0.0f,
             1.0f,  1.0f, 0.0f
        )
        quadVertices = ByteBuffer.allocateDirect(quad.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .put(quad)
        quadVertices.position(0)

        val texCoords = floatArrayOf(
            0.0f, 0.0f,
            1.0f, 0.0f,
            0.0f, 1.0f,
            1.0f, 1.0f
        )
        quadTexCoords = ByteBuffer.allocateDirect(texCoords.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .put(texCoords)
        quadTexCoords.position(0)

        Matrix.setIdentityM(mvpMatrix, 0)
        Matrix.setIdentityM(stMatrix, 0)
        Matrix.setIdentityM(identityMatrix, 0)
    }

    fun getVideoSurface(): Surface? = videoSurface

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        // Reset FBO state and pixel buffers so new GL objects are cleanly created in new EGL context
        fboId = 0
        fboTextureId = 0
        fboHeight = 0
        bbdPixelBuffer = null

        cinemaFboId = 0
        cinemaFboTextureId = 0
        cinemaFboWidth = 0
        cinemaFboHeight = 0

        // 1. Create OES Texture for ExoPlayer
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR.toFloat())
        GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR.toFloat())
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        // 2. Create SurfaceTexture and Surface on main thread
        mainHandler.post {
            surfaceTexture = SurfaceTexture(textureId).apply {
                setOnFrameAvailableListener(this@DualSurfaceVideoRenderer)
            }
            videoSurface = Surface(surfaceTexture)
            onFrameListener?.invoke()
        }

        // 3. Compile Shaders
        initBlitShader()
        initResizeShader()
        initBlurYShader()
        initCinemaShader()
        initCinemaBlitShader()

        GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        surfaceWidth = width
        surfaceHeight = height
        GLES20.glViewport(0, 0, width, height)
        // In non-bleed themes (Cinema, Dark), avoid destroying and allocating GPU FBO textures during continuous height animation
        if (bleedEnabled) {
            initFbo(width, height)
        }
        glSurfaceView.requestRender()
    }

    private fun initFbo(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val screenAspect = height.toFloat() / width.toFloat()
        // Rave MEDIUM resolution: 60px base width, scaled by display aspect ratio
        fboWidth = 60
        val targetHeight = (fboWidth * screenAspect).toInt().coerceAtLeast(30)
        if (fboId != 0 && fboTextureId != 0 && Math.abs(fboHeight - targetHeight) <= 6) {
            return
        }
        fboHeight = targetHeight

        if (fboTextureId != 0) {
            GLES20.glDeleteTextures(1, intArrayOf(fboTextureId), 0)
            fboTextureId = 0
        }
        if (fboId != 0) {
            GLES20.glDeleteFramebuffers(1, intArrayOf(fboId), 0)
            fboId = 0
        }

        // Generate FBO Texture with bilinear filtering for seamless hardware upscaling
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        fboTextureId = textures[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, fboTextureId)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA,
            fboWidth, fboHeight, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null
        )
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        // Generate Framebuffer Object
        val framebuffers = IntArray(1)
        GLES20.glGenFramebuffers(1, framebuffers, 0)
        fboId = framebuffers[0]
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboId)
        GLES20.glFramebufferTexture2D(
            GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0,
            GLES20.GL_TEXTURE_2D, fboTextureId, 0
        )
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)

        // Preallocate reusable direct byte buffer for BBD pixel reading
        bbdPixelBuffer = ByteBuffer.allocateDirect(fboWidth * fboHeight * 4).order(ByteOrder.nativeOrder())
    }

    override fun onFrameAvailable(surfaceTexture: SurfaceTexture?) {
        if (isReleased) return
        synchronized(this) {
            updateSurface = true
        }
        glSurfaceView.requestRender()
    }

    override fun onDrawFrame(gl: GL10?) {
        if (isReleased) return

        if (surfaceWidth <= 0 || surfaceHeight <= 0) {
            return
        }

        if (!isPlaybackActive && roomTheme != "cinema") {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
            GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
            return
        }

        var hasNewFrame = false
        synchronized(this) {
            if (updateSurface && !isReleased) {
                try {
                    surfaceTexture?.updateTexImage()
                    surfaceTexture?.getTransformMatrix(stMatrix)
                    hasNewFrame = true
                } catch (e: Throwable) {
                    android.util.Log.w("DualSurfaceRenderer", "Failed to update texture image: ${e.message}")
                }
                updateSurface = false
            }
        }

        if (isReleased) return

        // ── Smooth crop, zoom, and viewport interpolation (slow-motion cinematic fluid filling animation) ──
        val now = System.nanoTime()
        lastFrameTimeNs = now

        val targetCrop = if (videoAspectRatio < 2.30f) bbdCropPercent.coerceIn(0.0f, 0.26f) else 0.0f
        val targetHorizCrop = if (videoAspectRatio < 2.30f) bbdHorizCropPercent.coerceIn(0.0f, 0.38f) else 0.0f
        val targetZoomProgress = if (displayMode == 1) 1.0f else 0.0f

        var isAnimating = false

        // 1 & 2. Quintic smootherstep for letterbox & pillarbox crop (luxurious 2.2s slow motion, zero initial jerk)
        if (Math.abs(targetCrop - cropAnimTargetVert) > 0.0001f || Math.abs(targetHorizCrop - cropAnimTargetHoriz) > 0.0001f) {
            cropAnimStartTimeNs = now
            cropAnimStartVert = currentCropPercent
            cropAnimStartHoriz = currentHorizCropPercent
            cropAnimTargetVert = targetCrop
            cropAnimTargetHoriz = targetHorizCrop
        }

        if (cropAnimStartTimeNs > 0L) {
            val progress = ((now - cropAnimStartTimeNs).toFloat() / ANIM_DURATION_NS).coerceIn(0f, 1f)
            val smooth = easeInOutCubic(progress)
            currentCropPercent = cropAnimStartVert + (cropAnimTargetVert - cropAnimStartVert) * smooth
            currentHorizCropPercent = cropAnimStartHoriz + (cropAnimTargetHoriz - cropAnimStartHoriz) * smooth

            if (progress < 1.0f) {
                isAnimating = true
            } else {
                cropAnimStartTimeNs = 0L
                currentCropPercent = cropAnimTargetVert
                currentHorizCropPercent = cropAnimTargetHoriz
            }
        }

        // 3. Cubic in-out for Zoom mode transition (380ms smooth fluid glide, zero lag)
        if (Math.abs(targetZoomProgress - zoomAnimTargetProgress) > 0.0001f) {
            zoomAnimStartTimeNs = now
            zoomAnimStartProgress = currentZoomProgress
            zoomAnimTargetProgress = targetZoomProgress
        }

        if (zoomAnimStartTimeNs > 0L) {
            val progress = ((now - zoomAnimStartTimeNs).toFloat() / ANIM_DURATION_NS).coerceIn(0f, 1f)
            val smooth = easeInOutCubic(progress)
            currentZoomProgress = zoomAnimStartProgress + (zoomAnimTargetProgress - zoomAnimStartProgress) * smooth

            if (progress < 1.0f) {
                isAnimating = true
            } else {
                zoomAnimStartTimeNs = 0L
                currentZoomProgress = zoomAnimTargetProgress
            }
        }

        val isSmallOrPipSurface = surfaceWidth < 500 && surfaceHeight < 500

        // 4. Cubic in-out for viewport rectangle (380ms smooth container morphing)
        val rectTarget = if (isSmallOrPipSurface) null else contentRect
        if (rectTarget != null) {
            if (currentRectLeft < 0f) {
                // First frame initialization: snap cleanly to start
                currentRectLeft = rectTarget.left
                currentRectTop = rectTarget.top
                currentRectRight = rectTarget.right
                currentRectBottom = rectTarget.bottom
                rectAnimTargetLeft = rectTarget.left
                rectAnimTargetTop = rectTarget.top
                rectAnimTargetRight = rectTarget.right
                rectAnimTargetBottom = rectTarget.bottom
            } else {
                val dL = Math.abs(rectTarget.left - rectAnimTargetLeft)
                val dT = Math.abs(rectTarget.top - rectAnimTargetTop)
                val dR = Math.abs(rectTarget.right - rectAnimTargetRight)
                val dB = Math.abs(rectTarget.bottom - rectAnimTargetBottom)

                // If an animation is already in progress and the new target is very close (within 80px,
                // which is React Native synchronizing the exact layout of the same BBD event):
                val isBbdSyncNudge = rectAnimStartTimeNs > 0L && dL < 80f && dT < 80f && dR < 80f && dB < 80f
                if (isBbdSyncNudge) {
                    // Update target cleanly WITHOUT resetting timer or progress to prevent jump / re-expand!
                    rectAnimTargetLeft = rectTarget.left
                    rectAnimTargetTop = rectTarget.top
                    rectAnimTargetRight = rectTarget.right
                    rectAnimTargetBottom = rectTarget.bottom
                } else if (dL > 1.5f || dT > 1.5f || dR > 1.5f || dB > 1.5f) {
                    if (rectAnimStartTimeNs > 0L) {
                        // Re-target in flight smoothly without dropping progress or unshrinking!
                        rectAnimStartLeft = currentRectLeft
                        rectAnimStartTop = currentRectTop
                        rectAnimStartRight = currentRectRight
                        rectAnimStartBottom = currentRectBottom
                        rectAnimTargetLeft = rectTarget.left
                        rectAnimTargetTop = rectTarget.top
                        rectAnimTargetRight = rectTarget.right
                        rectAnimTargetBottom = rectTarget.bottom
                        val elapsed = now - rectAnimStartTimeNs
                        if (elapsed > ANIM_DURATION_NS / 2) {
                            rectAnimStartTimeNs = now - ANIM_DURATION_NS / 2
                        }
                    } else {
                        rectAnimStartTimeNs = now
                        rectAnimStartLeft = currentRectLeft
                        rectAnimStartTop = currentRectTop
                        rectAnimStartRight = currentRectRight
                        rectAnimStartBottom = currentRectBottom
                        rectAnimTargetLeft = rectTarget.left
                        rectAnimTargetTop = rectTarget.top
                        rectAnimTargetRight = rectTarget.right
                        rectAnimTargetBottom = rectTarget.bottom
                        currentRectAnimProgress = 0.0f
                    }
                }
            }
        } else if (!isSmallOrPipSurface && surfaceWidth > 0 && surfaceHeight > 0) {
            // In Non-rave mode (Cinema, Dark): contentRect is not provided.
            // Match currentRect directly to live surface bounds driven by Reanimated:
            currentRectLeft = 0f
            currentRectTop = 0f
            currentRectRight = surfaceWidth.toFloat()
            currentRectBottom = surfaceHeight.toFloat()
            rectAnimTargetLeft = 0f
            rectAnimTargetTop = 0f
            rectAnimTargetRight = surfaceWidth.toFloat()
            rectAnimTargetBottom = surfaceHeight.toFloat()
            rectAnimStartTimeNs = 0L
        }

        // Active rectangle animation interpolation (runs for ALL themes when rectAnimStartTimeNs > 0):
        if (rectAnimStartTimeNs > 0L) {
            val progress = ((now - rectAnimStartTimeNs).toFloat() / ANIM_DURATION_NS).coerceIn(0f, 1f)
            val smooth = easeInOutCubic(progress)
            currentRectAnimProgress = smooth
            currentRectLeft = rectAnimStartLeft + (rectAnimTargetLeft - rectAnimStartLeft) * smooth
            currentRectTop = rectAnimStartTop + (rectAnimTargetTop - rectAnimStartTop) * smooth
            currentRectRight = rectAnimStartRight + (rectAnimTargetRight - rectAnimStartRight) * smooth
            currentRectBottom = rectAnimStartBottom + (rectAnimTargetBottom - rectAnimStartBottom) * smooth

            if (progress < 1.0f) {
                isAnimating = true
            } else {
                rectAnimStartTimeNs = 0L
                currentRectAnimProgress = 1.0f
                currentRectLeft = rectAnimTargetLeft
                currentRectTop = rectAnimTargetTop
                currentRectRight = rectAnimTargetRight
                currentRectBottom = rectAnimTargetBottom
            }
        }

        if (isAnimating || (roomTheme == "cinema" && !isSmallOrPipSurface)) {
            glSurfaceView.requestRender()
        }

        val curW: Float
        val curH: Float
        if (currentRectLeft >= 0f && currentRectRight > currentRectLeft && currentRectBottom > currentRectTop) {
            curW = currentRectRight - currentRectLeft
            curH = currentRectBottom - currentRectTop
        } else {
            curW = surfaceWidth.toFloat()
            curH = surfaceHeight.toFloat()
        }
        calculateLiveCrop(curW, curH)

        // ── PASS 1 & 2: BACKGROUND PASS ──
        if (roomTheme == "rave" && bleedEnabled && !isSmallOrPipSurface) {
            renderBackgroundPass()
        } else if (roomTheme == "cinema" && !isSmallOrPipSurface) {
            renderCinemaPass()
        } else {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
            GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        }

        // Live Frame Black Bar Detection (Rave post-playback BBD on actual decoded video frames)
        if (hasNewFrame && !bbdDetectionDone && videoAspectRatio < 2.30f) {
            checkBlackBarDetection()
        }

        // ── PASS 3: FOREGROUND SHARP CONTENT SHADER (Aspect-fit with BBD crop) ──
        if (isPlaybackActive) {
            renderForegroundPass(isSmallOrPipSurface)
        }
    }

    private fun checkBlackBarDetection() {
        bbdFrameCounter++

        // Fast-track early detection: sample frames 1 to 5 immediately so initial frame 0 / startup
        // resolves black bars or full frame in <100ms before playback begins!
        // Then fall back to every 25 frames (~0.8s) up to frame 900 (~30s) for videos with dark/fade intros.
        val shouldSample = (bbdFrameCounter <= 5) || (bbdFrameCounter % 25 == 0 && bbdFrameCounter <= 900)
        if (shouldSample) {
            if (fboId == 0 || fboTextureId == 0) {
                initFbo(surfaceWidth, surfaceHeight)
                if (fboId == 0) return
            }

            // Always ensure FBO has the uncropped downscaled frame for BBD analysis
            renderResizePassOnly(0.0f)

            // Read pixels from FBO (size: fboWidth x fboHeight) using reusable buffer
            val neededCap = fboWidth * fboHeight * 4
            var buffer = bbdPixelBuffer
            if (buffer == null || buffer.capacity() < neededCap) {
                buffer = ByteBuffer.allocateDirect(neededCap).order(ByteOrder.nativeOrder())
                bbdPixelBuffer = buffer
            }
            buffer.position(0)
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboId)
            GLES20.glReadPixels(0, 0, fboWidth, fboHeight, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buffer)
            // Immediately restore default screen framebuffer (0) so next pass does not render offscreen
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            buffer.position(0)

            analyzeBbdFrame(buffer)
        }
    }

    private fun isBlackRow(buffer: ByteBuffer, y: Int, width: Int): Boolean {
        var darkCount = 0
        var totalCount = 0
        // Sample middle 70% of columns (x from 15% to 85%) to avoid curved edge artifacts
        val startX = (width * 0.15f).toInt()
        val endX = (width * 0.85f).toInt()
        for (x in startX until endX step 2) {
            val idx = (y * width + x) * 4
            if (idx + 2 < buffer.capacity()) {
                val r = buffer.get(idx).toInt() and 0xFF
                val g = buffer.get(idx + 1).toInt() and 0xFF
                val b = buffer.get(idx + 2).toInt() and 0xFF
                // Rave BBD threshold: RGB all <= 22 (accommodates subtle video compression artifacts)
                if (r <= 22 && g <= 22 && b <= 22) {
                    darkCount++
                }
                totalCount++
            }
        }
        return totalCount > 0 && (darkCount.toFloat() / totalCount.toFloat()) >= 0.85f
    }

    private fun isBlackColumn(buffer: ByteBuffer, x: Int, width: Int, height: Int): Boolean {
        var darkCount = 0
        var totalCount = 0
        // Sample middle 70% of rows (y from 15% to 85%) to avoid curved edge artifacts
        val startY = (height * 0.15f).toInt()
        val endY = (height * 0.85f).toInt()
        for (y in startY until endY step 1) {
            val idx = (y * width + x) * 4
            if (idx + 2 < buffer.capacity()) {
                val r = buffer.get(idx).toInt() and 0xFF
                val g = buffer.get(idx + 1).toInt() and 0xFF
                val b = buffer.get(idx + 2).toInt() and 0xFF
                // Rave BBD threshold: RGB all <= 22
                if (r <= 22 && g <= 22 && b <= 22) {
                    darkCount++
                }
                totalCount++
            }
        }
        return totalCount > 0 && (darkCount.toFloat() / totalCount.toFloat()) >= 0.85f
    }

    private fun analyzeBbdFrame(buffer: ByteBuffer) {
        if (fboHeight <= 10 || fboWidth <= 10) return

        // 1. Check if the frame itself is all-black (intro / dark transition / fade)
        // Sample center region: from y = 35% to 65%
        var centerDarkCount = 0
        var centerTotalCount = 0
        val centerStartY = (fboHeight * 0.35f).toInt()
        val centerEndY = (fboHeight * 0.65f).toInt()
        val scanStartX = (fboWidth * 0.20f).toInt()
        val scanEndX = (fboWidth * 0.80f).toInt()
        for (y in centerStartY until centerEndY step 2) {
            for (x in scanStartX until scanEndX step 2) {
                val idx = (y * fboWidth + x) * 4
                if (idx + 2 < buffer.capacity()) {
                    val r = buffer.get(idx).toInt() and 0xFF
                    val g = buffer.get(idx + 1).toInt() and 0xFF
                    val b = buffer.get(idx + 2).toInt() and 0xFF
                    if (r <= 22 && g <= 22 && b <= 22) {
                        centerDarkCount++
                    }
                    centerTotalCount++
                }
            }
        }
        val isAllBlackFrame = centerTotalCount > 0 && (centerDarkCount.toFloat() / centerTotalCount.toFloat()) >= 0.85f
        if (isAllBlackFrame) {
            // Entire screen (including center) is dark or black (e.g. intro/fade)!
            // Rave rule: Ignore all-black frames and CONTINUE waiting for visual scenes!
            return
        }

        // 2. Count black rows from top and bottom (Letterbox)
        // In OpenGL, row 0 is the bottom, and row (fboHeight - 1) is the top
        var topBlackRows = 0
        for (y in (fboHeight - 1) downTo 0) {
            if (isBlackRow(buffer, y, fboWidth)) {
                topBlackRows++
            } else {
                break
            }
        }

        var bottomBlackRows = 0
        for (y in 0 until fboHeight) {
            if (isBlackRow(buffer, y, fboWidth)) {
                bottomBlackRows++
            } else {
                break
            }
        }

        val cropRows = Math.min(topBlackRows, bottomBlackRows)
        val vertPct = cropRows.toFloat() / fboHeight.toFloat()

        // 3. Count black columns from left and right (Pillarbox)
        var leftBlackCols = 0
        for (x in 0 until fboWidth) {
            if (isBlackColumn(buffer, x, fboWidth, fboHeight)) {
                leftBlackCols++
            } else {
                break
            }
        }

        var rightBlackCols = 0
        for (x in (fboWidth - 1) downTo 0) {
            if (isBlackColumn(buffer, x, fboWidth, fboHeight)) {
                rightBlackCols++
            } else {
                break
            }
        }

        val cropCols = Math.min(leftBlackCols, rightBlackCols)
        val horizPct = cropCols.toFloat() / fboWidth.toFloat()

        val isLetterboxed = vertPct >= 0.035f && vertPct <= 0.26f
        val isPillarboxed = horizPct >= 0.045f && horizPct <= 0.38f

        // Critical safety: If a frame has black borders on ALL FOUR SIDES, it is a centered floating logo or intro card
        // (like Haarika & Hassine in Ramuloo Ramulaa). It is NOT a real full-screen visual scene.
        // Skip this frame and continue waiting for the actual movie scenes!
        if (isLetterboxed && isPillarboxed) {
            return
        }

        if (isLetterboxed || isPillarboxed) {
            val safeVertPct = if (isLetterboxed) vertPct else 0.0f
            val safeHorizPct = if (isPillarboxed) horizPct else 0.0f

            bbdLetterboxSamples.add(safeVertPct)
            bbdPillarboxSamples.add(safeHorizPct)

            // Require 2 consistent samples before locking (fast early lock in <50ms while avoiding 1-frame glitches):
            if (bbdLetterboxSamples.size >= 2) {
                val sortedVert = bbdLetterboxSamples.sorted()
                val sortedHoriz = bbdPillarboxSamples.sorted()
                val medianVertCrop = sortedVert[sortedVert.size / 2]
                val medianHorizCrop = sortedHoriz[sortedHoriz.size / 2]

                val effectiveW = (1.0f - 2.0f * medianHorizCrop).coerceAtLeast(0.2f)
                val effectiveH = (1.0f - 2.0f * medianVertCrop).coerceAtLeast(0.2f)
                val detectedAr = videoAspectRatio * (effectiveW / effectiveH)

                bbdDetectionDone = true // Lock immediately so detection never re-evaluates on resized layout
                bbdCropPercent = medianVertCrop
                bbdHorizCropPercent = medianHorizCrop

                // Immediately trigger smooth viewport morphing right on detection confirmation frame!
                // Runs for full-screen surface themes (Cinema, Rave, Dark) where contentRect is provided:
                if (displayMode == 0 && contentRect != null) {
                    val curL = if (currentRectLeft >= 0f) currentRectLeft else 0f
                    val curT = if (currentRectTop >= 0f) currentRectTop else 0f
                    val curR = if (currentRectRight > curL) currentRectRight else surfaceWidth.toFloat()
                    val curB = if (currentRectBottom > curT) currentRectBottom else surfaceHeight.toFloat()
                    val activeW = curR - curL
                    val maxAllowedH = surfaceHeight * 0.55f
                    val targetH = (activeW / detectedAr).coerceAtMost(maxAllowedH)
                    if (Math.abs(targetH - (curB - curT)) > 2f) {
                        rectAnimStartTimeNs = System.nanoTime()
                        rectAnimStartLeft = curL
                        rectAnimStartTop = curT
                        rectAnimStartRight = curR
                        rectAnimStartBottom = curB
                        rectAnimTargetLeft = curL
                        rectAnimTargetTop = curT
                        rectAnimTargetBottom = curT + targetH
                        rectAnimTargetRight = curR
                        currentRectAnimProgress = 0.0f
                    }
                }

                glSurfaceView.requestRender() // Trigger smooth filling animation immediately

                mainHandler.post {
                    onBbdResultListener?.invoke(detectedAr, medianVertCrop, medianHorizCrop)
                }
            }
        } else {
            // Full frame video with active visuals reaching the edges (e.g. "Ala Bolelo")
            bbdFullFrameCount++
            // If we have verified 2 separate valid non-black frames with 0% black bars:
            if (bbdFullFrameCount >= 2 && bbdLetterboxSamples.isEmpty() && bbdPillarboxSamples.isEmpty()) {
                bbdDetectionDone = true // Lock immediately as full frame native aspect ratio
                bbdCropPercent = 0.0f
                bbdHorizCropPercent = 0.0f
                mainHandler.post {
                    onBbdResultListener?.invoke(videoAspectRatio, 0.0f, 0.0f)
                }
            }
        }
    }

    private fun renderResizePassOnly(cropPercent: Float) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboId)
        GLES20.glViewport(0, 0, fboWidth, fboHeight)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

        GLES20.glUseProgram(resizeProgram)

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(resizePositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(resizePositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(resizeTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(resizeTexCoordHandle)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glUniform1i(resizeTextureHandle, 0)

        GLES20.glUniformMatrix4fv(resizeMVPMatrixHandle, 1, false, identityMatrix, 0)
        GLES20.glUniformMatrix4fv(resizeSTMatrixHandle, 1, false, stMatrix, 0)
        GLES20.glUniform1f(resizeLetterboxHandle, cropPercent)
        GLES20.glUniform1f(resizeAspectRatioHandle, videoAspectRatio)
        GLES20.glUniform2f(resizeFboSizeHandle, fboWidth.toFloat(), fboHeight.toFloat())

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(resizePositionHandle)
        GLES20.glDisableVertexAttribArray(resizeTexCoordHandle)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }

    private fun calculateLiveCrop(curW: Float, curH: Float) {
        val containerAspect = if (curH > 0) curW / curH else 1.777f

        // In Fit mode: calculate live crop percentage with ZERO image stretching, ZERO shaking, and ZERO subpixel wobble!
        // Live mathematical aspect lock: as container height decreases, containerAspect increases.
        // 0.5 * (1.0 - videoAspectRatio / containerAspect) guarantees that the active video picture
        // on screen NEVER expands or shrinks by even 1 pixel during container morphing or settled state!
        val fitVertCrop = if (videoAspectRatio < 2.30f && bbdCropPercent > 0.001f && containerAspect > (videoAspectRatio - 0.01f)) {
            ((1.0f - (videoAspectRatio / containerAspect)) * 0.5f).coerceIn(0.0f, bbdCropPercent)
        } else {
            0.0f
        }

        val fitHorizCrop = if (videoAspectRatio < 2.30f && bbdHorizCropPercent > 0.001f && containerAspect < (videoAspectRatio + 0.01f)) {
            ((1.0f - (containerAspect / videoAspectRatio)) * 0.5f).coerceIn(0.0f, bbdHorizCropPercent)
        } else {
            0.0f
        }

        // True visual aspect ratio with active content visible:
        val activeVisualAspect = if (bbdCropPercent > 0.001f || bbdHorizCropPercent > 0.001f) {
            videoAspectRatio * ((1f - 2f * bbdHorizCropPercent) / (1f - 2f * bbdCropPercent))
        } else {
            videoAspectRatio
        }

        // In Zoom to Fill mode (or when zooming): zoom into active video to completely fill containerAspect:
        var zoomHorizCrop = bbdHorizCropPercent
        var zoomVertCrop = bbdCropPercent
        if (activeVisualAspect > containerAspect + 0.005f) {
            val extraHoriz = ((1.0f - (containerAspect / activeVisualAspect)) * 0.5f).coerceIn(0.0f, 0.45f)
            zoomHorizCrop = (bbdHorizCropPercent + extraHoriz * (1.0f - 2.0f * bbdHorizCropPercent)).coerceIn(0.0f, 0.48f)
        } else if (activeVisualAspect < containerAspect - 0.005f) {
            val extraVert = ((1.0f - (activeVisualAspect / containerAspect)) * 0.5f).coerceIn(0.0f, 0.45f)
            zoomVertCrop = (bbdCropPercent + extraVert * (1.0f - 2.0f * bbdCropPercent)).coerceIn(0.0f, 0.48f)
        }

        // Smoothly blend between Fit mode (rock-solid, zero shaking) and Zoom mode (cinematic zoom-to-fill):
        liveEffectiveCropPercent = (fitVertCrop + (zoomVertCrop - fitVertCrop) * currentZoomProgress).coerceIn(0.0f, 0.48f)
        liveEffectiveHorizCropPercent = (fitHorizCrop + (zoomHorizCrop - fitHorizCrop) * currentZoomProgress).coerceIn(0.0f, 0.48f)
    }

    private fun renderBackgroundPass() {
        if (fboId == 0 || fboTextureId == 0) {
            initFbo(surfaceWidth, surfaceHeight)
            if (fboId == 0) return
        }

        // Native Cinemascope streams (>= 2.30, e.g. 21:9 or 2.39:1) do NOT have baked black bars.
        // Applying bbdCropPercent to an already widescreen stream would cut into real video content!
        val safeCropPercent = if (videoAspectRatio < 2.30f) {
            liveEffectiveCropPercent
        } else {
            0.0f
        }

        // ── PASS 1: BackgroundResizeShader (Horizontal Gaussian Downsample into FBO) ──
        renderResizePassOnly(safeCropPercent)

        // ── PASS 2: BackgroundBlurYShader (Vertical Gaussian Upscale into Screen Framebuffer) ──
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)

        GLES20.glUseProgram(blurYProgram)

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(blurYPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(blurYPositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(blurYTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(blurYTexCoordHandle)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, fboTextureId)
        GLES20.glUniform1i(blurYTextureHandle, 0)

        GLES20.glUniformMatrix4fv(blurYMVPMatrixHandle, 1, false, identityMatrix, 0)
        GLES20.glUniformMatrix4fv(blurYSTMatrixHandle, 1, false, identityMatrix, 0)
        GLES20.glUniform1f(blurYLetterboxHandle, safeCropPercent)
        GLES20.glUniform1f(blurYAspectRatioHandle, videoAspectRatio)
        GLES20.glUniform2f(blurYFboSizeHandle, fboWidth.toFloat(), fboHeight.toFloat())
        GLES20.glUniform1f(blurYDarknessHandle, bleedDarkness)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(blurYPositionHandle)
        GLES20.glDisableVertexAttribArray(blurYTexCoordHandle)
    }

    private fun renderForegroundPass(forceFullScreenViewport: Boolean = false) {
        // Explicitly bind the default screen framebuffer (0) to ensure foreground draws to screen
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glUseProgram(blitProgram)

        val rect = if (forceFullScreenViewport) null else contentRect
        val vpX: Int
        val vpY: Int
        val vpW: Int
        val vpH: Int
        val curW: Float
        val curH: Float

        if (surfaceWidth > 0 && surfaceHeight > 0) {
            if (currentRectLeft < 0f) {
                if (rect != null && rect.width() > 0 && rect.height() > 0) {
                    currentRectLeft = rect.left
                    currentRectTop = rect.top
                    currentRectRight = rect.right
                    currentRectBottom = rect.bottom
                } else {
                    currentRectLeft = 0f
                    currentRectTop = 0f
                    currentRectRight = surfaceWidth.toFloat()
                    currentRectBottom = surfaceHeight.toFloat()
                }
            }

            curW = Math.max(1f, currentRectRight - currentRectLeft)
            curH = Math.max(1f, currentRectBottom - currentRectTop)

            vpX = Math.max(0, Math.min(Math.round(currentRectLeft), surfaceWidth - 1))
            vpY = Math.max(0, Math.min(Math.round(surfaceHeight - currentRectBottom), surfaceHeight - 1))
            vpW = Math.max(1, Math.min(Math.round(curW), surfaceWidth - vpX))
            vpH = Math.max(1, Math.min(Math.round(curH), surfaceHeight - vpY))
            GLES20.glViewport(vpX, vpY, vpW, vpH)
        } else {
            curW = surfaceWidth.toFloat()
            curH = surfaceHeight.toFloat()
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
        }

        val effectiveCropPercent = liveEffectiveCropPercent
        val effectiveHorizCropPercent = liveEffectiveHorizCropPercent

        // The quad ALWAYS completely covers the active viewport with identity matrix (zero scaling gap, zero letterbox blink):
        val fgMatrix = FloatArray(16)
        Matrix.setIdentityM(fgMatrix, 0)

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(blitPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(blitPositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(blitTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(blitTexCoordHandle)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glUniform1i(blitTextureHandle, 0)

        val density = glSurfaceView.context.resources.displayMetrics.density
        val radius = if (!forceFullScreenViewport) 16.0f * density else 0.0f
        val quadW = curW
        val quadH = curH
        val halfW = quadW * 0.5f
        val halfH = quadH * 0.5f

        GLES20.glUniformMatrix4fv(blitMVPMatrixHandle, 1, false, fgMatrix, 0)
        GLES20.glUniformMatrix4fv(blitSTMatrixHandle, 1, false, stMatrix, 0)
        GLES20.glUniform1f(blitCropHandle, effectiveCropPercent)
        GLES20.glUniform1f(blitHorizCropHandle, effectiveHorizCropPercent)
        GLES20.glUniform2f(blitHalfSizeHandle, halfW, halfH)
        GLES20.glUniform1f(blitRadiusHandle, radius)
        GLES20.glUniform1i(blitDisplayModeHandle, displayMode)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glDisableVertexAttribArray(blitPositionHandle)
        GLES20.glDisableVertexAttribArray(blitTexCoordHandle)
    }

    private fun initBlitShader() {
        val vertexShader = """
            uniform mat4 uMVPMatrix;
            uniform mat4 uSTMatrix;
            attribute vec4 aPosition;
            attribute vec4 aTextureCoord;
            uniform vec2 uHalfSize;
            varying vec2 vTextureCoord;
            varying vec2 vLocalPos;
            void main() {
                gl_Position = uMVPMatrix * aPosition;
                vTextureCoord = (uSTMatrix * aTextureCoord).xy;
                vLocalPos = aPosition.xy * uHalfSize;
            }
        """.trimIndent()

        val fragmentShader = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 vTextureCoord;
            varying vec2 vLocalPos;
            uniform samplerExternalOES sTexture;
            uniform vec2 uHalfSize;
            uniform float uRadius;
            uniform float uCropPercent;
            uniform float uHorizCropPercent;
            uniform int uDisplayMode;
            void main() {
                // Texture coordinates are mathematically calculated in Java for both Fit and Zoom modes:
                // Fit mode: uCropPercent tracks live container boundary as height animates
                // Zoom mode: uCropPercent / uHorizCropPercent crops black bars AND fills containerAspect
                vec2 coord;
                coord.y = uCropPercent + vTextureCoord.y * (1.0 - 2.0 * uCropPercent);
                coord.x = uHorizCropPercent + vTextureCoord.x * (1.0 - 2.0 * uHorizCropPercent);
                coord = clamp(coord, 0.0, 1.0);

                vec4 color = texture2D(sTexture, coord);
                if (uRadius > 0.5) {
                    vec2 q = abs(vLocalPos) - uHalfSize + vec2(uRadius);
                    float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - uRadius;
                    float alpha = clamp(0.5 - d, 0.0, 1.0);
                    gl_FragColor = vec4(color.rgb, color.a * alpha);
                } else {
                    gl_FragColor = color;
                }
            }
        """.trimIndent()

        blitProgram = createProgram(vertexShader, fragmentShader)
        blitPositionHandle = GLES20.glGetAttribLocation(blitProgram, "aPosition")
        blitTexCoordHandle = GLES20.glGetAttribLocation(blitProgram, "aTextureCoord")
        blitMVPMatrixHandle = GLES20.glGetUniformLocation(blitProgram, "uMVPMatrix")
        blitSTMatrixHandle = GLES20.glGetUniformLocation(blitProgram, "uSTMatrix")
        blitTextureHandle = GLES20.glGetUniformLocation(blitProgram, "sTexture")
        blitCropHandle = GLES20.glGetUniformLocation(blitProgram, "uCropPercent")
        blitHorizCropHandle = GLES20.glGetUniformLocation(blitProgram, "uHorizCropPercent")
        blitHalfSizeHandle = GLES20.glGetUniformLocation(blitProgram, "uHalfSize")
        blitRadiusHandle = GLES20.glGetUniformLocation(blitProgram, "uRadius")
        blitDisplayModeHandle = GLES20.glGetUniformLocation(blitProgram, "uDisplayMode")
    }

    /**
     * Rave Pass 1: BackgroundResizeShader
     * Decompiled directly from Rave's classes11.dex (com.wemesh.android.legacy.shaders.BackgroundResizeShader)
     */
    private fun initResizeShader() {
        val vertexShader = """
            uniform mat4 uMVPMatrix;
            uniform mat4 uSTMatrix;
            attribute vec4 aPosition;
            attribute vec4 aTextureCoord;
            varying vec2 vTextureCoord;
            uniform float vLetterboxPercentage;
            varying float fLetterboxPercentage;
            uniform float vAspectRatio;
            varying float fAspectRatio;
            void main() {
                gl_Position = uMVPMatrix * aPosition;
                vTextureCoord = (uSTMatrix * aTextureCoord).xy;
                fLetterboxPercentage = vLetterboxPercentage;
                fAspectRatio = vAspectRatio;
            }
        """.trimIndent()

        val fragmentShader = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 vTextureCoord;
            uniform samplerExternalOES sTexture;
            varying float fLetterboxPercentage;
            varying float fAspectRatio;
            uniform vec2 uFboSize;

            void main() {
                vec4 colorAvg = vec4(0.0);
                float xCoord;
                float xStep;
                float yCoord;
                float yStep;
                float modifiedAspectRatio = (fAspectRatio / ((1.0 - 2.0 * fLetterboxPercentage) * uFboSize.x / uFboSize.y));
                xStep = 1.0 / (modifiedAspectRatio * uFboSize.x);
                if (vTextureCoord.x >= 0.5) {
                    xCoord = 0.5 + (vTextureCoord.x - 0.5) / modifiedAspectRatio;
                } else {
                    xCoord = 0.5 - (0.5 - vTextureCoord.x) / modifiedAspectRatio;
                }
                yStep = 1.0 * (1.0 - 2.0 * fLetterboxPercentage) / uFboSize.y;
                if (vTextureCoord.y >= 0.5) {
                    yCoord = 0.5 + (vTextureCoord.y - 0.5) * (1.0 - 2.0 * fLetterboxPercentage);
                } else {
                    yCoord = 0.5 - (0.5 - vTextureCoord.y) * (1.0 - 2.0 * fLetterboxPercentage);
                }

                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord)) * 0.101354;
                colorAvg += texture2D(sTexture, vec2(xCoord + 1.0 * xStep, yCoord)) * 0.098157;
                colorAvg += texture2D(sTexture, vec2(xCoord - 1.0 * xStep, yCoord)) * 0.098157;
                colorAvg += texture2D(sTexture, vec2(xCoord + 2.0 * xStep, yCoord)) * 0.089160;
                colorAvg += texture2D(sTexture, vec2(xCoord - 2.0 * xStep, yCoord)) * 0.089160;
                colorAvg += texture2D(sTexture, vec2(xCoord + 3.0 * xStep, yCoord)) * 0.075960;
                colorAvg += texture2D(sTexture, vec2(xCoord - 3.0 * xStep, yCoord)) * 0.075960;
                colorAvg += texture2D(sTexture, vec2(xCoord + 4.0 * xStep, yCoord)) * 0.060696;
                colorAvg += texture2D(sTexture, vec2(xCoord - 4.0 * xStep, yCoord)) * 0.060696;
                colorAvg += texture2D(sTexture, vec2(xCoord + 5.0 * xStep, yCoord)) * 0.045489;
                colorAvg += texture2D(sTexture, vec2(xCoord - 5.0 * xStep, yCoord)) * 0.045489;
                colorAvg += texture2D(sTexture, vec2(xCoord + 6.0 * xStep, yCoord)) * 0.031975;
                colorAvg += texture2D(sTexture, vec2(xCoord - 6.0 * xStep, yCoord)) * 0.031975;
                colorAvg += texture2D(sTexture, vec2(xCoord + 7.0 * xStep, yCoord)) * 0.021081;
                colorAvg += texture2D(sTexture, vec2(xCoord - 7.0 * xStep, yCoord)) * 0.021081;
                colorAvg += texture2D(sTexture, vec2(xCoord + 8.0 * xStep, yCoord)) * 0.013035;
                colorAvg += texture2D(sTexture, vec2(xCoord - 8.0 * xStep, yCoord)) * 0.013035;
                colorAvg += texture2D(sTexture, vec2(xCoord + 9.0 * xStep, yCoord)) * 0.007560;
                colorAvg += texture2D(sTexture, vec2(xCoord - 9.0 * xStep, yCoord)) * 0.007560;
                colorAvg += texture2D(sTexture, vec2(xCoord + 10.0 * xStep, yCoord)) * 0.004112;
                colorAvg += texture2D(sTexture, vec2(xCoord - 10.0 * xStep, yCoord)) * 0.004112;
                colorAvg += texture2D(sTexture, vec2(xCoord + 11.0 * xStep, yCoord)) * 0.002098;
                colorAvg += texture2D(sTexture, vec2(xCoord - 11.0 * xStep, yCoord)) * 0.002098;

                gl_FragColor = vec4(colorAvg.rgb, 1.0);
            }
        """.trimIndent()

        resizeProgram = createProgram(vertexShader, fragmentShader)
        resizePositionHandle = GLES20.glGetAttribLocation(resizeProgram, "aPosition")
        resizeTexCoordHandle = GLES20.glGetAttribLocation(resizeProgram, "aTextureCoord")
        resizeMVPMatrixHandle = GLES20.glGetUniformLocation(resizeProgram, "uMVPMatrix")
        resizeSTMatrixHandle = GLES20.glGetUniformLocation(resizeProgram, "uSTMatrix")
        resizeTextureHandle = GLES20.glGetUniformLocation(resizeProgram, "sTexture")
        resizeLetterboxHandle = GLES20.glGetUniformLocation(resizeProgram, "vLetterboxPercentage")
        resizeAspectRatioHandle = GLES20.glGetUniformLocation(resizeProgram, "vAspectRatio")
        resizeFboSizeHandle = GLES20.glGetUniformLocation(resizeProgram, "uFboSize")
    }

    /**
     * Rave Pass 2: BackgroundBlurYShader
     * Decompiled directly from Rave's classes11.dex (com.wemesh.android.legacy.shaders.BackgroundBlurYShader)
     */
    private fun initBlurYShader() {
        val vertexShader = """
            uniform mat4 uMVPMatrix;
            uniform mat4 uSTMatrix;
            attribute vec4 aPosition;
            attribute vec4 aTextureCoord;
            varying vec2 vTextureCoord;
            uniform float vLetterboxPercentage;
            varying float fLetterboxPercentage;
            uniform float vAspectRatio;
            varying float fAspectRatio;
            void main() {
                gl_Position = uMVPMatrix * aPosition;
                vTextureCoord = (uSTMatrix * aTextureCoord).xy;
                fLetterboxPercentage = vLetterboxPercentage;
                fAspectRatio = vAspectRatio;
            }
        """.trimIndent()

        val fragmentShader = """
            precision mediump float;
            varying vec2 vTextureCoord;
            uniform sampler2D sTexture;
            uniform vec2 uFboSize;
            uniform float uDarkness;

            void main() {
                vec4 colorAvg = vec4(0.0);
                float xCoord = vTextureCoord.x;
                float yStep = 1.0 / uFboSize.y;
                float yCoord = vTextureCoord.y;

                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord)) * 0.101354;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 1.0 * yStep)) * 0.098157;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 1.0 * yStep)) * 0.098157;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 2.0 * yStep)) * 0.089160;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 2.0 * yStep)) * 0.089160;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 3.0 * yStep)) * 0.075960;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 3.0 * yStep)) * 0.075960;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 4.0 * yStep)) * 0.060696;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 4.0 * yStep)) * 0.060696;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 5.0 * yStep)) * 0.045489;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 5.0 * yStep)) * 0.045489;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 6.0 * yStep)) * 0.031975;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 6.0 * yStep)) * 0.031975;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 7.0 * yStep)) * 0.021081;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 7.0 * yStep)) * 0.021081;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 8.0 * yStep)) * 0.013035;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 8.0 * yStep)) * 0.013035;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 9.0 * yStep)) * 0.007560;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 9.0 * yStep)) * 0.007560;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 10.0 * yStep)) * 0.004112;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 10.0 * yStep)) * 0.004112;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord + 11.0 * yStep)) * 0.002098;
                colorAvg += texture2D(sTexture, vec2(xCoord, yCoord - 11.0 * yStep)) * 0.002098;

                // Rave aesthetic: subtle saturation enhancement + atmospheric dimming for high-contrast UI
                vec3 c = colorAvg.rgb;
                float gray = dot(c, vec3(0.299, 0.587, 0.114));
                vec3 vivid = clamp(mix(vec3(gray), c, 1.25), 0.0, 1.0);

                gl_FragColor = vec4(vivid * uDarkness, 1.0);
            }
        """.trimIndent()

        blurYProgram = createProgram(vertexShader, fragmentShader)
        blurYPositionHandle = GLES20.glGetAttribLocation(blurYProgram, "aPosition")
        blurYTexCoordHandle = GLES20.glGetAttribLocation(blurYProgram, "aTextureCoord")
        blurYMVPMatrixHandle = GLES20.glGetUniformLocation(blurYProgram, "uMVPMatrix")
        blurYSTMatrixHandle = GLES20.glGetUniformLocation(blurYProgram, "uSTMatrix")
        blurYTextureHandle = GLES20.glGetUniformLocation(blurYProgram, "sTexture")
        blurYLetterboxHandle = GLES20.glGetUniformLocation(blurYProgram, "vLetterboxPercentage")
        blurYAspectRatioHandle = GLES20.glGetUniformLocation(blurYProgram, "vAspectRatio")
        blurYFboSizeHandle = GLES20.glGetUniformLocation(blurYProgram, "uFboSize")
        blurYDarknessHandle = GLES20.glGetUniformLocation(blurYProgram, "uDarkness")
    }

    /**
     * Pass: Cinema VIP Theme Ambient Fluid Shader (Option B: Subsurface Liquid Glass)
     * Inspired by light bending through heavy submerged optical glass.
     * Molten oceanic refraction with deep obsidian base and zero bubble noise.
     */
    private fun initCinemaShader() {
        val vertexShader = """
            uniform mat4 uMVPMatrix;
            attribute vec4 aPosition;
            attribute vec4 aTextureCoord;
            varying vec2 vTextureCoord;
            void main() {
                gl_Position = uMVPMatrix * aPosition;
                vTextureCoord = aTextureCoord.xy;
            }
        """.trimIndent()

        val fragmentShader = """
            precision highp float;
            varying vec2 vTextureCoord;
            uniform float uTime;
            uniform vec2 uResolution;

            void main() {
                vec2 uv = vTextureCoord;
                float aspect = uResolution.x / max(uResolution.y, 1.0);
                vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

                // Dynamic, fluid motion (Subsurface Liquid Glass)
                float t = uTime * 0.50;

                // ── 1. DOMAIN WARPING (Molten Liquid Glass Curvature) ──
                vec2 q = p * 1.8;
                vec2 w1 = vec2(
                    sin(q.x * 1.8 + t * 0.32 + sin(q.y * 1.5 + t * 0.22)),
                    cos(q.y * 1.6 - t * 0.28 + cos(q.x * 2.0 - t * 0.18))
                );
                vec2 w2 = vec2(
                    cos(q.y * 2.2 + w1.x * 1.35 + t * 0.20),
                    sin(q.x * 2.0 + w1.y * 1.35 - t * 0.16)
                );
                vec2 glassCoord = q + w2 * 0.22;

                // ── 2. CHROMATIC SUBSURFACE REFRACTION ──
                float waveR = sin(glassCoord.x * 2.5 + glassCoord.y * 1.8 + t * 0.25);
                float waveG = sin(glassCoord.x * 2.5 + glassCoord.y * 1.8 + t * 0.25 + 0.20);
                float waveB = sin(glassCoord.x * 2.5 + glassCoord.y * 1.8 + t * 0.25 + 0.40);

                float baseFlow = clamp((waveR + waveG + waveB) * 0.333 * 0.5 + 0.5, 0.0, 1.0);
                float glassCurvature = pow(baseFlow, 2.0);

                // ── 3. LUMINOUS OCEANIC SAPPHIRE & COBALT PALETTE (Radiant, reduced darkness) ──
                vec3 cAbyss    = vec3(0.035, 0.085, 0.180); // Luminous Deep Ocean Blue (no pitch black)
                vec3 cTrench   = vec3(0.055, 0.135, 0.265); // Rich Royal Navy
                vec3 cNavy     = vec3(0.085, 0.210, 0.380); // Vibrant Oceanic Azure
                vec3 cSapphire = vec3(0.125, 0.310, 0.520); // Sapphire Liquid Glass
                vec3 cMarine   = vec3(0.180, 0.430, 0.660); // Refracted Marine Light
                vec3 cPrism    = vec3(0.260, 0.580, 0.820); // Radiant Chromatic Crest

                // Smooth gradient blending across molten glass folds
                vec3 col = mix(cAbyss, cTrench, smoothstep(0.0, 0.5, uv.y));
                col = mix(col, cNavy, smoothstep(0.12, 0.62, baseFlow) * 0.80);
                col = mix(col, cSapphire, smoothstep(0.35, 0.80, glassCurvature) * 0.65);
                col = mix(col, cMarine, smoothstep(0.55, 0.95, glassCurvature) * 0.40);

                // Chromatic dispersion sheen on the crests of the glass waves
                float prismGlint = pow(clamp(waveR * waveB, 0.0, 1.0), 3.0);
                col += cPrism * (prismGlint * 0.38);

                // ── 4. CHAT READABILITY OVERLAY (Softened so deep blue glows radiantly) ──
                float vY = 1.0 - uv.y;
                float darkFactor;
                if (vY < 0.25) {
                    darkFactor = mix(0.20, 0.10, vY / 0.25);
                } else if (vY < 0.60) {
                    darkFactor = mix(0.10, 0.32, (vY - 0.25) / 0.35);
                } else {
                    darkFactor = mix(0.32, 0.52, (vY - 0.60) / 0.40);
                }

                col *= (1.0 - darkFactor * 0.45);

                gl_FragColor = vec4(col, 1.0);
            }
        """.trimIndent()

        cinemaProgram = createProgram(vertexShader, fragmentShader)
        cinemaPositionHandle = GLES20.glGetAttribLocation(cinemaProgram, "aPosition")
        cinemaTexCoordHandle = GLES20.glGetAttribLocation(cinemaProgram, "aTextureCoord")
        cinemaMVPMatrixHandle = GLES20.glGetUniformLocation(cinemaProgram, "uMVPMatrix")
        cinemaTimeHandle = GLES20.glGetUniformLocation(cinemaProgram, "uTime")
        cinemaResolutionHandle = GLES20.glGetUniformLocation(cinemaProgram, "uResolution")
    }

    private fun initCinemaBlitShader() {
        val vertexShader = """
            attribute vec4 aPosition;
            attribute vec4 aTextureCoord;
            varying vec2 vTextureCoord;
            void main() {
                gl_Position = aPosition;
                vTextureCoord = aTextureCoord.xy;
            }
        """.trimIndent()

        val fragmentShader = """
            precision mediump float;
            varying vec2 vTextureCoord;
            uniform sampler2D sTexture;
            void main() {
                gl_FragColor = texture2D(sTexture, vTextureCoord);
            }
        """.trimIndent()

        cinemaBlitProgram = createProgram(vertexShader, fragmentShader)
        cinemaBlitPositionHandle = GLES20.glGetAttribLocation(cinemaBlitProgram, "aPosition")
        cinemaBlitTexCoordHandle = GLES20.glGetAttribLocation(cinemaBlitProgram, "aTextureCoord")
        cinemaBlitTextureHandle = GLES20.glGetUniformLocation(cinemaBlitProgram, "sTexture")
    }

    private fun initCinemaFbo(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val targetWidth = (width / 2).coerceAtLeast(180)
        val targetHeight = (height / 2).coerceAtLeast(320)
        if (cinemaFboId != 0 && cinemaFboTextureId != 0 &&
            Math.abs(cinemaFboWidth - targetWidth) <= 4 &&
            Math.abs(cinemaFboHeight - targetHeight) <= 8
        ) {
            return
        }
        cinemaFboWidth = targetWidth
        cinemaFboHeight = targetHeight

        if (cinemaFboTextureId != 0) {
            GLES20.glDeleteTextures(1, intArrayOf(cinemaFboTextureId), 0)
            cinemaFboTextureId = 0
        }
        if (cinemaFboId != 0) {
            GLES20.glDeleteFramebuffers(1, intArrayOf(cinemaFboId), 0)
            cinemaFboId = 0
        }

        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        cinemaFboTextureId = textures[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, cinemaFboTextureId)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA,
            cinemaFboWidth, cinemaFboHeight, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null
        )
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        val framebuffers = IntArray(1)
        GLES20.glGenFramebuffers(1, framebuffers, 0)
        cinemaFboId = framebuffers[0]
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, cinemaFboId)
        GLES20.glFramebufferTexture2D(
            GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0,
            GLES20.GL_TEXTURE_2D, cinemaFboTextureId, 0
        )
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }

    private fun renderCinemaPass() {
        if (cinemaProgram == 0) return

        initCinemaFbo(surfaceWidth, surfaceHeight)
        if (cinemaFboId == 0 || cinemaFboTextureId == 0) {
            renderCinemaDirectToScreen()
            return
        }

        // ── PASS 1: Render procedural ocean flow into intermediate FBO (half resolution) ──
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, cinemaFboId)
        GLES20.glViewport(0, 0, cinemaFboWidth, cinemaFboHeight)
        GLES20.glUseProgram(cinemaProgram)

        GLES20.glUniformMatrix4fv(cinemaMVPMatrixHandle, 1, false, cinemaMvpMatrix, 0)

        // Bounded time modulo prevents float precision loss after long playback
        val nowSec = (((System.nanoTime() - startTimeNs) / 1_000_000_000.0) % 3600.0).toFloat()
        GLES20.glUniform1f(cinemaTimeHandle, nowSec)
        GLES20.glUniform2f(cinemaResolutionHandle, cinemaFboWidth.toFloat(), cinemaFboHeight.toFloat())

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(cinemaPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(cinemaPositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(cinemaTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(cinemaTexCoordHandle)

        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(cinemaPositionHandle)
        GLES20.glDisableVertexAttribArray(cinemaTexCoordHandle)

        // ── PASS 2: Hardware bilinear upscale to physical screen resolution (GL_LINEAR) ──
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)

        if (cinemaBlitProgram != 0) {
            GLES20.glUseProgram(cinemaBlitProgram)

            quadVertices.position(0)
            GLES20.glVertexAttribPointer(cinemaBlitPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
            GLES20.glEnableVertexAttribArray(cinemaBlitPositionHandle)

            quadTexCoords.position(0)
            GLES20.glVertexAttribPointer(cinemaBlitTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
            GLES20.glEnableVertexAttribArray(cinemaBlitTexCoordHandle)

            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, cinemaFboTextureId)
            GLES20.glUniform1i(cinemaBlitTextureHandle, 0)

            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

            GLES20.glDisableVertexAttribArray(cinemaBlitPositionHandle)
            GLES20.glDisableVertexAttribArray(cinemaBlitTexCoordHandle)
        }
    }

    private fun renderCinemaDirectToScreen() {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
        GLES20.glUseProgram(cinemaProgram)

        GLES20.glUniformMatrix4fv(cinemaMVPMatrixHandle, 1, false, cinemaMvpMatrix, 0)

        val nowSec = (((System.nanoTime() - startTimeNs) / 1_000_000_000.0) % 3600.0).toFloat()
        GLES20.glUniform1f(cinemaTimeHandle, nowSec)
        GLES20.glUniform2f(cinemaResolutionHandle, surfaceWidth.toFloat(), surfaceHeight.toFloat())

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(cinemaPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(cinemaPositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(cinemaTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(cinemaTexCoordHandle)

        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(cinemaPositionHandle)
        GLES20.glDisableVertexAttribArray(cinemaTexCoordHandle)
    }

    private fun createProgram(vertexSource: String, fragmentSource: String): Int {
        val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexSource)
        if (vertexShader == 0) return 0
        val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource)
        if (fragmentShader == 0) return 0
        val program = GLES20.glCreateProgram()
        if (program != 0) {
            GLES20.glAttachShader(program, vertexShader)
            GLES20.glAttachShader(program, fragmentShader)
            GLES20.glLinkProgram(program)
            val linkStatus = IntArray(1)
            GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0)
            if (linkStatus[0] != GLES20.GL_TRUE) {
                val error = GLES20.glGetProgramInfoLog(program)
                android.util.Log.e("DualSurfaceRenderer", "Could not link program: $error")
                GLES20.glDeleteProgram(program)
                return 0
            }
        }
        return program
    }

    private fun loadShader(type: Int, shaderCode: String): Int {
        val shader = GLES20.glCreateShader(type)
        if (shader != 0) {
            GLES20.glShaderSource(shader, shaderCode)
            GLES20.glCompileShader(shader)
            val compiled = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
            if (compiled[0] == 0) {
                val error = GLES20.glGetShaderInfoLog(shader)
                android.util.Log.e("DualSurfaceRenderer", "Could not compile shader $type: $error")
                GLES20.glDeleteShader(shader)
                return 0
            }
        }
        return shader
    }

    fun release() {
        isReleased = true
        glSurfaceView.queueEvent {
            try {
                if (fboTextureId != 0) {
                    GLES20.glDeleteTextures(1, intArrayOf(fboTextureId), 0)
                    fboTextureId = 0
                }
                if (fboId != 0) {
                    GLES20.glDeleteFramebuffers(1, intArrayOf(fboId), 0)
                    fboId = 0
                }
                if (textureId != 0) {
                    GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
                    textureId = 0
                }
                if (blitProgram != 0) {
                    GLES20.glDeleteProgram(blitProgram)
                    blitProgram = 0
                }
                if (resizeProgram != 0) {
                    GLES20.glDeleteProgram(resizeProgram)
                    resizeProgram = 0
                }
                if (blurYProgram != 0) {
                    GLES20.glDeleteProgram(blurYProgram)
                    blurYProgram = 0
                }
                if (cinemaFboTextureId != 0) {
                    GLES20.glDeleteTextures(1, intArrayOf(cinemaFboTextureId), 0)
                    cinemaFboTextureId = 0
                }
                if (cinemaFboId != 0) {
                    GLES20.glDeleteFramebuffers(1, intArrayOf(cinemaFboId), 0)
                    cinemaFboId = 0
                }
                if (cinemaBlitProgram != 0) {
                    GLES20.glDeleteProgram(cinemaBlitProgram)
                    cinemaBlitProgram = 0
                }
                if (cinemaProgram != 0) {
                    GLES20.glDeleteProgram(cinemaProgram)
                    cinemaProgram = 0
                }
                surfaceTexture?.release()
                surfaceTexture = null
                videoSurface?.release()
                videoSurface = null
            } catch (e: Throwable) {
                android.util.Log.e("DualSurfaceRenderer", "Error during GL release: ${e.message}")
            }
        }
    }
}
