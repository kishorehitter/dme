package com.DME

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SpeechRecognitionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var speechPromise: Promise? = null
    private val REQUEST_SPEECH_CODE = 8192

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == REQUEST_SPEECH_CODE) {
                if (speechPromise != null) {
                    if (resultCode == Activity.RESULT_OK && data != null) {
                        val results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                        if (!results.isNullOrEmpty()) {
                            speechPromise?.resolve(results[0])
                        } else {
                            speechPromise?.resolve("")
                        }
                    } else {
                        speechPromise?.resolve("")
                    }
                    speechPromise = null
                }
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String {
        return "SpeechRecognition"
    }

    @ReactMethod
    fun startSpeechRecognition(prompt: String?, promise: Promise) {
        val act = reactApplicationContext.currentActivity
        if (act == null) {
            promise.reject("E_ACTIVITY_DOES_NOT_EXIST", "Activity doesn't exist")
            return
        }

        speechPromise = promise

        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, prompt ?: "Speak to write...")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            act.startActivityForResult(intent, REQUEST_SPEECH_CODE)
        } catch (e: Exception) {
            speechPromise?.reject("E_SPEECH_FAILED", e.message)
            speechPromise = null
        }
    }
}

