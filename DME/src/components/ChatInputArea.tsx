import React, { memo, useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  StyleSheet,
  Platform,
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

    // Register clear function with parent on mount
    useEffect(() => {
      onRegisterClear?.(() => {
        setLocalClearKey(k => k + 1);
        setInputHeight(MIN_HEIGHT);
        inputRef.current?.clear();
      });
    }, [onRegisterClear]);

    // Reset height when key changes (media send remount)
    useEffect(() => {
      setInputHeight(MIN_HEIGHT);
    }, [inputClearKey]);

    useEffect(() => {
      // Edit mode: parent pushed text into field
      if (inputText !== '' && prevInputText.current === '') {
        inputRef.current?.setText(inputText);
      }
      // Reset: edit cancelled/confirmed, or any other parent-driven clear
      if (inputText === '' && prevInputText.current !== '') {
        inputRef.current?.clear();
      }
      prevInputText.current = inputText;
    }, [inputText]);

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
            <>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={handleAttachment}
              >
                <Icon name="add-outline" size={22} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={handleCameraCapture}
              >
                <Icon name="camera" size={24} color="#666" />
              </TouchableOpacity>
            </>
          )}

          {!isRecording && (
            // ✅ No wrapper memo — just pass directly, no text prop binding
            <RichTextInput
              key={inputClearKey} 
              ref={inputRef}
              style={[styles.input, { height: inputHeight }]}
              placeholder={placeholder}
              placeholderTextColor="#999"
              autoFocus={localClearKey > 0}            
              onChangeText={handleTyping}  // ✅ direct, no wrapper
              onContentSizeChange={handleContentSizeChange}
              multiline
              maxLength={2000}
              onContentCommitted={handleContentCommitted}
            />
          )}

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

          {!isRecording && (
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
    alignItems: 'flex-end',
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