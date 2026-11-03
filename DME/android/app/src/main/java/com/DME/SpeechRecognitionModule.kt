package com.DME

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

class SpeechRecognitionModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var speechRecognizer: SpeechRecognizer? = null

    override fun getName(): String {
        return "SpeechRecognition"
    }

    private fun sendEvent(eventName: String, params: Any?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            // Ignore if listener not mounted
        }
    }

    @ReactMethod
    fun startListening(language: String?, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val context = reactContext.currentActivity ?: reactContext
                val available = SpeechRecognizer.isRecognitionAvailable(context) || SpeechRecognizer.isRecognitionAvailable(reactContext)
                if (!available) {
                    promise.reject("E_NOT_AVAILABLE", "Speech recognition is not available on this device")
                    return@runOnUiThread
                }

                try {
                    speechRecognizer?.cancel()
                    speechRecognizer?.destroy()
                } catch (e: Exception) {}
                speechRecognizer = null

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            sendEvent("onSpeechReady", null)
                        }

                        override fun onBeginningOfSpeech() {
                            sendEvent("onSpeechStart", null)
                        }

                        override fun onRmsChanged(rmsdB: Float) {
                            val map = Arguments.createMap().apply {
                                putDouble("rms", rmsdB.toDouble())
                            }
                            sendEvent("onSpeechVolume", map)
                        }

                        override fun onBufferReceived(buffer: ByteArray?) {}

                        override fun onEndOfSpeech() {
                            sendEvent("onSpeechEnd", null)
                        }

                        override fun onError(error: Int) {
                            val errorMessage = when (error) {
                                SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                                SpeechRecognizer.ERROR_CLIENT -> "Client error"
                                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required"
                                SpeechRecognizer.ERROR_NETWORK -> "Network error"
                                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                                SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected"
                                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognition service busy"
                                SpeechRecognizer.ERROR_SERVER -> "Server error"
                                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
                                else -> "Speech recognition error ($error)"
                            }
                            val map = Arguments.createMap().apply {
                                putInt("code", error)
                                putString("message", errorMessage)
                            }
                            sendEvent("onSpeechError", map)
                        }

                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = if (!matches.isNullOrEmpty()) matches[0] else ""
                            val map = Arguments.createMap().apply {
                                putString("text", text)
                            }
                            sendEvent("onSpeechResults", map)
                        }

                        override fun onPartialResults(partialResults: Bundle?) {
                            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = if (!matches.isNullOrEmpty()) matches[0] else ""
                            val map = Arguments.createMap().apply {
                                putString("text", text)
                            }
                            sendEvent("onSpeechPartialResults", map)
                        }

                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                }

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    // Extend silence-detection timeout to 5 seconds
                    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 5000L)
                    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 5000L)
                    // Ensure minimum listening time so short words/numbers are captured
                    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L)
                    if (!language.isNullOrEmpty()) {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                    }
                }

                speechRecognizer?.startListening(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_START_FAILED", e.message)
            }
        }
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                speechRecognizer?.stopListening()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_STOP_FAILED", e.message)
            }
        }
    }

    @ReactMethod
    fun cancelListening(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                speechRecognizer?.cancel()
                speechRecognizer?.destroy()
                speechRecognizer = null
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_CANCEL_FAILED", e.message)
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String?) {}

    @ReactMethod
    fun removeListeners(count: Int?) {}
}


