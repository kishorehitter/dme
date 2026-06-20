package com.DME

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.textinput.ReactTextInputManager
import com.facebook.react.common.MapBuilder

class RichTextInputViewManager : ReactTextInputManager() {
    override fun getName() = "RichTextInput"

    override fun createViewInstance(reactContext: ThemedReactContext): RichTextInput {
        val view = RichTextInput(reactContext)
        // Ensure it looks like a standard multiline-capable input
        view.setPadding(0, 0, 0, 0)
        return view
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
        val baseEvents = super.getExportedCustomDirectEventTypeConstants()
        val events = if (baseEvents != null) HashMap(baseEvents) else HashMap<String, Any>()
        
        events["topContentCommitted"] = MapBuilder.of("registrationName", "onContentCommitted")
        events["topTextChange"] = MapBuilder.of("registrationName", "onTextChange")
        events["topContentSizeChange"] = MapBuilder.of("registrationName", "onContentSizeChange")
        
        return events
    }

    @ReactProp(name = "text")
    fun setText(view: RichTextInput, text: String?) {
        view.setRichText(text)
    }
}
