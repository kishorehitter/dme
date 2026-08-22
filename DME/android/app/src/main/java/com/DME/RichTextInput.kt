package com.DME

import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.facebook.react.views.textinput.ReactEditText

class RichTextInput(context: ThemedReactContext) : ReactEditText(context) {
    private var isSettingText = false

    private val exactContentHeight: Int
        get() {
            val textLayout = this.layout
            return if (textLayout != null) {
                textLayout.height + paddingTop + paddingBottom
            } else {
                lineCount * lineHeight + paddingTop + paddingBottom
            }
        }

    override fun scrollTo(x: Int, y: Int) {
        val density = context.resources.displayMetrics.density
        val maxH = if (maxHeight != Int.MAX_VALUE && maxHeight > 0) maxHeight else (180 * density).toInt()
        
        // Prevent native vertical scroll if the content fits in max height.
        // This stops the text box from hiding the top line before it expands!
        if (exactContentHeight <= maxH) {
            super.scrollTo(x, 0)
        } else {
            super.scrollTo(x, y)
        }
    }

    private var lastEmittedContentHeight = 0.0

    fun emitContentSizeChange() {
        val density = context.resources.displayMetrics.density
        if (density <= 0f) return
        val textLayout = this.layout
        val contentHeight = if (textLayout != null) {
            (textLayout.height + paddingTop + paddingBottom).toDouble() / density
        } else {
            (lineCount * lineHeight + paddingTop + paddingBottom).toDouble() / density
        }
        val contentWidth = width.toDouble() / density
        
        if (Math.abs(contentHeight - lastEmittedContentHeight) >= 0.5) {
            lastEmittedContentHeight = contentHeight
            val event = Arguments.createMap()
            val contentSize = Arguments.createMap()
            contentSize.putDouble("width", contentWidth)
            contentSize.putDouble("height", contentHeight)
            event.putMap("contentSize", contentSize)
            
            try {
                (context as? ReactContext)?.getJSModule(RCTEventEmitter::class.java)
                    ?.receiveEvent(id, "topContentSizeChange", event)
            } catch (_: Exception) {}
        }
    }

    init {
        // Ensure standard keyboard behavior is enabled
        setSingleLine(false)
        inputType = InputType.TYPE_CLASS_TEXT or 
                    InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or 
                    InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                    InputType.TYPE_TEXT_FLAG_IME_MULTI_LINE
        setHorizontallyScrolling(false)
        maxLines = 20
        background = null // Remove default Android EditText underline (black line)
        
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (isSettingText) return

                val event = Arguments.createMap()
                event.putString("text", s.toString())
                try {
                    (context as? ReactContext)?.getJSModule(RCTEventEmitter::class.java)
                        ?.receiveEvent(id, "topTextChange", event)
                } catch (_: Exception) {}
                
                post { emitContentSizeChange() }
            }
            override fun afterTextChanged(s: Editable?) {
                post { emitContentSizeChange() }
            }
        })
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        post { emitContentSizeChange() }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        emitContentSizeChange()
    }

    fun setRichText(text: String?) {
        val nextText = text ?: ""
        if (nextText != this.text.toString()) {
            isSettingText = true
            setText(nextText)
            setSelection(nextText.length)
            isSettingText = false
            post { emitContentSizeChange() }
        }
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val ic = super.onCreateInputConnection(outAttrs) ?: return null

        EditorInfoCompat.setContentMimeTypes(outAttrs, arrayOf("image/gif", "image/png", "image/jpeg"))
        
        return InputConnectionCompat.createWrapper(ic, outAttrs, object : InputConnectionCompat.OnCommitContentListener {
            override fun onCommitContent(inputContentInfo: androidx.core.view.inputmethod.InputContentInfoCompat, flags: Int, opts: android.os.Bundle?): Boolean {
                val isPermissionGranted = (flags and InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0
                if (isPermissionGranted) {
                    inputContentInfo.requestPermission()
                }

                // ✅ ROBUST DISMISSAL STRATEGY
                // 1. Finish any pending text composition
                ic.finishComposingText()

                // 2. Explicitly hide the keyboard
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(windowToken, 0)

                // 3. Clear focus to prevent IME from re-opening
                clearFocus()

                val event = Arguments.createMap()
                event.putString("uri", inputContentInfo.contentUri.toString())
                event.putString("mimeType", inputContentInfo.description.getMimeType(0))

                (context as ReactContext).getJSModule(RCTEventEmitter::class.java)
                    .receiveEvent(id, "topContentCommitted", event)

                return true
            }
        })
    }
}
