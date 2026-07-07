import React, { memo, useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import RichTextInput, { RichTextInputRef } from '../components/RichTextInput';
import { spacing, borderRadius, fontSize } from '../utils/theme';
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 180;
const ChatInputArea = memo(({
    isRecording,
    editingMessageId,
    inputText,
    isSending,
    handleAttachment,
    handleCameraCapture,
    handleTyping,
    sendMessage,
    setStickerPreview,
    micPanResponder,
    micButtonScale,
    THEME_COLOR,
    inputClearKey,
    onRegisterClear,
}: any) => {

    const inputRef = useRef<RichTextInputRef>(null);
    const prevInputText = useRef(inputText);
    const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);
    const [localClearKey, setLocalClearKey] = useState(0);
    const [isKeyboardVisible, setKeyboardVisible] = useState(false);
    const isTypingRef = useRef(false);

    const handleTypingInternal = useCallback((text: string) => {
      isTypingRef.current = true;
      handleTyping?.(text);
    }, [handleTyping]);

    useEffect(() => {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const showSubscription = Keyboard.addListener(showEvent, () => {
        setKeyboardVisible(true);
      });
      const hideSubscription = Keyboard.addListener(hideEvent, () => {
        setKeyboardVisible(false);
      });

      return () => {
        showSubscription.remove();
        hideSubscription.remove();
      };
    }, []);

    // Register clear function with parent on mount
    useEffect(() => {
      onRegisterClear?.(() => {
        setLocalClearKey(k => k + 1);
        setInputHeight(MIN_HEIGHT);
        inputRef.current?.clear();
      });
    }, [onRegisterClear]);

    const prevEditingId = useRef(editingMessageId);
    // EDIT MODE: When editingMessageId changes to a truthy value,
    // force-push inputText into the native field. This runs independently
    // of the typing guard and guarantees the edit text always appears.
    useEffect(() => {
      if (editingMessageId && inputText) {
        inputRef.current?.setText(inputText);
        prevInputText.current = inputText;
      } else if (prevEditingId.current && !editingMessageId) {
        // If we stopped editing, clear the text
        inputRef.current?.clear();
        prevInputText.current = '';
      }
      prevEditingId.current = editingMessageId;
    }, [editingMessageId]);

    const handleContentSizeChange = useCallback((event: any) => {
      const h = event.nativeEvent?.contentSize?.height;
      if (h) {
        setInputHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(h))));
      }
    }, []);

    const handleContentCommitted = useCallback((event: any) => {
        const { uri, mimeType } = event.nativeEvent;
        if (uri) setStickerPreview({ uri, mimeType });
    }, [setStickerPreview]);

    const handleSend = useCallback(() => {
        sendMessage();
    }, [sendMessage]);

    const placeholder = editingMessageId ? 'Edit your message...' : 'Message';

    return (
        <View style={styles.inputContainer}>
          {!isRecording && (
            <TouchableOpacity
              style={styles.attachmentButton}
              onPress={handleAttachment}
            >
              <Icon name="add-outline" size={22} color="#666" />
            </TouchableOpacity>
          )}

          {!isRecording && (
            <RichTextInput
              key={inputClearKey} 
              ref={inputRef}
              style={styles.input}
              placeholder={placeholder}
              placeholderTextColor="#999"
              autoFocus={localClearKey > 0}            
              onChangeText={handleTypingInternal}
              onContentSizeChange={handleContentSizeChange}
              multiline
              maxLength={2000}
              onContentCommitted={handleContentCommitted}
            />
          )}

          {(!inputText || inputText.trim() === '' || isRecording) ? (
            <Animated.View
              style={[
                styles.micButton,
                isRecording && styles.micButtonRecording,
                { transform: [{ scale: isRecording ? 1 : micButtonScale }] },
              ]}
              {...micPanResponder.panHandlers}
              collapsable={false}
            >
              <Icon
                name="mic"
                size={22}
                color={isRecording ? '#FFF' : '#666'}
              />
            </Animated.View>
          ) : (
            <TouchableOpacity
              style={[
                styles.sendButton,
                { backgroundColor: editingMessageId ? '#FF9800' : THEME_COLOR },
              ]}
              onPress={handleSend}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Icon
                  name={editingMessageId ? 'checkmark' : 'send'}
                  size={20}
                  color="#FFF"
                  style={!editingMessageId ? { marginLeft: 2 } : {}}
                />
              )}
            </TouchableOpacity>
          )}
        </View>
    );
});

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 2,
  },
  attachmentButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: borderRadius.xl,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: fontSize.md,
    color: '#000',
    textAlignVertical: 'top',
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    marginBottom: 1,
  },
  micButtonRecording: { backgroundColor: '#FF4444' },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    marginBottom: 2,
  },
});

export default ChatInputArea;