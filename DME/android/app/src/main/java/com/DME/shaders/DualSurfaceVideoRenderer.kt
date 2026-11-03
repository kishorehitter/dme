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

    // State properties (updated from UI thread)
    @Volatile var bleedEnabled: Boolean = true
    @Volatile var bleedDarkness: Float = 0.55f
    @Volatile var bbdCropPercent: Float = 0.0f
    @Volatile var videoAspectRatio: Float = 16f / 9f
    @Volatile var blurSigma: Float = 48.0f
    @Volatile var contentRect: android.graphics.RectF? = null
    @Volatile var isPlaybackActive: Boolean = false

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

        GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        surfaceWidth = width
        surfaceHeight = height
        GLES20.glViewport(0, 0, width, height)
        initFbo(width, height)
        glSurfaceView.requestRender()
    }

    private fun initFbo(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val screenAspect = height.toFloat() / width.toFloat()
        // Rave MEDIUM resolution: 60px base width, scaled by display aspect ratio
        fboWidth = 60
        fboHeight = (fboWidth * screenAspect).toInt().coerceAtLeast(30)

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

        if (!isPlaybackActive) {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
            GLES20.glClearColor(0f, 0f, 0f, 0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
            return
        }

        synchronized(this) {
            if (updateSurface && !isReleased) {
                try {
                    surfaceTexture?.updateTexImage()
                    surfaceTexture?.getTransformMatrix(stMatrix)
                } catch (e: Throwable) {
                    android.util.Log.w("DualSurfaceRenderer", "Failed to update texture image: ${e.message}")
                }
                updateSurface = false
            }
        }

        if (isReleased) return

        val rect = contentRect
        val isInvalidRect = rect != null && (rect.right > surfaceWidth || rect.bottom > surfaceHeight || rect.width() > surfaceWidth || rect.height() > surfaceHeight)
        val isSmallOrPipSurface = (surfaceWidth < 700 && surfaceHeight < 700) || isInvalidRect

        // ── PASS 1 & 2: RAVE 2-PASS DOWNSAMPLED SEPARABLE GAUSSIAN BLEED ──
        if (bleedEnabled && !isSmallOrPipSurface) {
            renderBackgroundPass()
        } else {
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        }

        // ── PASS 3: FOREGROUND SHARP CONTENT SHADER (Aspect-fit with BBD crop) ──
        renderForegroundPass(isInvalidRect)
    }

    private fun renderBackgroundPass() {
        if (fboId == 0 || fboTextureId == 0) {
            initFbo(surfaceWidth, surfaceHeight)
            if (fboId == 0) return
        }

        // ── PASS 1: BackgroundResizeShader (Horizontal Gaussian Downsample into FBO) ──
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

        // Native widescreen streams (>= 1.82, e.g. 21:9 or 2.39:1) do NOT have baked black bars.
        // Applying bbdCropPercent to an already widescreen stream would cut into real video content!
        val safeCropPercent = if (videoAspectRatio < 1.82f) {
            bbdCropPercent.coerceIn(0.0f, 0.22f)
        } else {
            0.0f
        }

        GLES20.glUniformMatrix4fv(resizeMVPMatrixHandle, 1, false, identityMatrix, 0)
        GLES20.glUniformMatrix4fv(resizeSTMatrixHandle, 1, false, stMatrix, 0)
        GLES20.glUniform1f(resizeLetterboxHandle, safeCropPercent)
        GLES20.glUniform1f(resizeAspectRatioHandle, videoAspectRatio)
        GLES20.glUniform2f(resizeFboSizeHandle, fboWidth.toFloat(), fboHeight.toFloat())

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(resizePositionHandle)
        GLES20.glDisableVertexAttribArray(resizeTexCoordHandle)

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
        GLES20.glUseProgram(blitProgram)

        val rect = if (forceFullScreenViewport) null else contentRect
        if (rect != null && rect.width() > 0 && rect.height() > 0) {
            val vpX = rect.left.toInt()
            val vpY = (surfaceHeight - rect.bottom).toInt()
            val vpW = rect.width().toInt()
            val vpH = rect.height().toInt()
            GLES20.glViewport(vpX, vpY, vpW, vpH)
        } else {
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
        }

        val curW = rect?.width() ?: surfaceWidth.toFloat()
        val curH = rect?.height() ?: surfaceHeight.toFloat()
        val containerAspect = if (curH > 0) curW / curH else 1.777f

        // Only apply BBD crop if the underlying video stream is 16:9 (< 1.82).
        // If the stream is natively widescreen (>= 1.82), it has no baked black bars.
        val safeCropPercent = if (videoAspectRatio < 1.82f) {
            bbdCropPercent.coerceIn(0.0f, 0.22f)
        } else {
            0.0f
        }

        val effectiveVideoAspect = if (safeCropPercent > 0.005f) {
            videoAspectRatio / (1.0f - (2.0f * safeCropPercent))
        } else {
            videoAspectRatio
        }

        var scaleX = 1.0f
        var scaleY = 1.0f
        if (effectiveVideoAspect > containerAspect) {
            scaleY = containerAspect / effectiveVideoAspect
        } else {
            scaleX = effectiveVideoAspect / containerAspect
        }

        val fgMatrix = FloatArray(16)
        Matrix.setIdentityM(fgMatrix, 0)
        Matrix.scaleM(fgMatrix, 0, scaleX, scaleY, 1.0f)

        quadVertices.position(0)
        GLES20.glVertexAttribPointer(blitPositionHandle, 3, GLES20.GL_FLOAT, false, 0, quadVertices)
        GLES20.glEnableVertexAttribArray(blitPositionHandle)

        quadTexCoords.position(0)
        GLES20.glVertexAttribPointer(blitTexCoordHandle, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
        GLES20.glEnableVertexAttribArray(blitTexCoordHandle)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glUniform1i(blitTextureHandle, 0)

        GLES20.glUniformMatrix4fv(blitMVPMatrixHandle, 1, false, fgMatrix, 0)
        GLES20.glUniformMatrix4fv(blitSTMatrixHandle, 1, false, stMatrix, 0)
        GLES20.glUniform1f(blitCropHandle, safeCropPercent)

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
            uniform float uCropPercent;
            varying vec2 vTextureCoord;
            void main() {
                gl_Position = uMVPMatrix * aPosition;
                vec4 coord = aTextureCoord;
                if (uCropPercent > 0.001) {
                    coord.y = uCropPercent + aTextureCoord.y * (1.0 - 2.0 * uCropPercent);
                }
                vTextureCoord = (uSTMatrix * coord).xy;
            }
        """.trimIndent()

        val fragmentShader = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 vTextureCoord;
            uniform samplerExternalOES sTexture;
            void main() {
                gl_FragColor = texture2D(sTexture, vTextureCoord);
            }
        """.trimIndent()

        blitProgram = createProgram(vertexShader, fragmentShader)
        blitPositionHandle = GLES20.glGetAttribLocation(blitProgram, "aPosition")
        blitTexCoordHandle = GLES20.glGetAttribLocation(blitProgram, "aTextureCoord")
        blitMVPMatrixHandle = GLES20.glGetUniformLocation(blitProgram, "uMVPMatrix")
        blitSTMatrixHandle = GLES20.glGetUniformLocation(blitProgram, "uSTMatrix")
        blitTextureHandle = GLES20.glGetUniformLocation(blitProgram, "sTexture")
        blitCropHandle = GLES20.glGetUniformLocation(blitProgram, "uCropPercent")
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
