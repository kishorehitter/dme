package com.DME

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.textinput.ReactTextInputManager
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.common.MapBuilder
import com.facebook.react.bridge.ReadableArray

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
    fun setTextProp(view: RichTextInput, text: String?) {
        view.setRichText(text)
    }

    companion object {
        const val COMMAND_CLEAR = 1
        const val COMMAND_SET_TEXT = 2
    }

    override fun getCommandsMap(): Map<String, Int> {
        return MapBuilder.of(
            "clear", COMMAND_CLEAR,
            "setText", COMMAND_SET_TEXT
        )
    }

    override fun receiveCommand(root: ReactEditText, commandId: Int, args: ReadableArray?) {
        val view = root as? RichTextInput
        if (view == null) {
            super.receiveCommand(root, commandId, args)
            return
        }
        when (commandId) {
            COMMAND_CLEAR -> view.setRichText("")
            COMMAND_SET_TEXT -> {
                val text = args?.getString(0)
                view.setRichText(text)
            }
            else -> super.receiveCommand(root, commandId, args)
        }
    }

    override fun receiveCommand(root: ReactEditText, commandId: String, args: ReadableArray?) {
        val view = root as? RichTextInput
        if (view == null) {
            super.receiveCommand(root, commandId, args)
            return
        }
        val commandIdInt = commandId.toIntOrNull()
        if (commandIdInt != null) {
            receiveCommand(root, commandIdInt, args)
            return
        }
        when (commandId) {
            "clear" -> view.setRichText("")
            "setText" -> {
                val text = args?.getString(0)
                view.setRichText(text)
            }
            else -> super.receiveCommand(root, commandId, args)
        }
    }
}
