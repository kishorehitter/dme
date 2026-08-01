import React, { memo, useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Keyboard,
  DeviceEventEmitter,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import RichTextInput, { RichTextInputRef } from '../components/RichTextInput';
import { spacing, borderRadius, fontSize } from '../utils/theme';
import { useTheme } from '../context/ThemeContext';
const MIN_HEIGHT = 45;
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
    isDisabled,
    onRegisterClear,
    onOpenStickerPicker,
}: any) => {

    const { theme, isDark } = useTheme();
    const styles = dynamicStyles(theme);
    const inputRef = useRef<RichTextInputRef>(null);
    const prevInputText = useRef(inputText);
    const [localInputText, setLocalInputText] = useState(inputText || '');
    const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);
    const [localClearKey, setLocalClearKey] = useState(0);
    const isTypingRef = useRef(false);

    const handleTypingInternal = useCallback((text: string) => {
      isTypingRef.current = true;
      setLocalInputText(text);
      handleTyping?.(text);
    }, [handleTyping]);

    useEffect(() => {
      const emojiSub = DeviceEventEmitter.addListener('INSERT_EMOJI_CHAR', (emoji) => {
        setLocalInputText(prev => {
          const next = prev + emoji;
          inputRef.current?.setText(next);
          handleTyping?.(next);
          return next;
        });
      });

      return () => {
        emojiSub.remove();
      };
    }, []);

    // Register clear function with parent on mount
    useEffect(() => {
      onRegisterClear?.(() => {
        setLocalClearKey(k => k + 1);
        setInputHeight(MIN_HEIGHT);
        setLocalInputText('');
        inputRef.current?.clear();
      });
    }, [onRegisterClear]);

    useEffect(() => {
      return () => {
        inputRef.current?.blur();
      };
    }, []);

    const prevEditingId = useRef(editingMessageId);
    // EDIT MODE: When editingMessageId changes to a truthy value,
    // force-push inputText into the native field. This runs independently
    // of the typing guard and guarantees the edit text always appears.
    useEffect(() => {
      if (editingMessageId && inputText) {
        setLocalInputText(inputText);
        inputRef.current?.setText(inputText);
        prevInputText.current = inputText;
      } else if (prevEditingId.current && !editingMessageId) {
        // If we stopped editing, clear the text
        setLocalInputText('');
        inputRef.current?.clear();
        prevInputText.current = '';
      }
      prevEditingId.current = editingMessageId;
    }, [editingMessageId]);

    const handleContentSizeChange = useCallback((event: any) => {
      const h = event.nativeEvent?.contentSize?.height;
      if (h) {
        setInputHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h)));
      }
    }, []);


    const handleContentCommitted = useCallback((event: any) => {
        const { uri, mimeType } = event.nativeEvent;
        if (uri) setStickerPreview({ uri, mimeType });
    }, [setStickerPreview]);

    const handleSend = useCallback(() => {
        sendMessage(localInputText);
    }, [sendMessage, localInputText]);

    const placeholder = isDisabled ? 'Messaging is restricted' : (editingMessageId ? 'Edit your message...' : 'Message');

    return (
        <View style={styles.inputContainer}>
          {!isRecording && (
            <TouchableOpacity
              style={[styles.attachmentButton, isDisabled && { opacity: 0.5 }]}
              onPress={handleAttachment}
              disabled={isDisabled}
            >
              <Icon name="add-outline" size={22} color={theme.icon} />
            </TouchableOpacity>
          )}

          {!isRecording && (() => {
            const showStickerButton = !editingMessageId;
            return (
              <View style={[styles.inputWrapper, { backgroundColor: theme.inputBackground }, isDisabled && { backgroundColor: theme.border }]}>
                {showStickerButton && (
                  <TouchableOpacity
                    style={styles.innerStickerButton}
                    onPress={() => {
                      if (Keyboard.isVisible()) {
                        Keyboard.dismiss();
                        return;
                      }
                      Keyboard.dismiss();
                      onOpenStickerPicker?.();
                    }}
                    disabled={isDisabled}
                    accessibilityLabel="Open sticker picker"
                  >
                    <Icon name="happy-outline" size={24} color={theme.icon} />
                  </TouchableOpacity>
                )}

                <RichTextInput
                  key={inputClearKey} 
                  ref={inputRef}
                  style={[
                    styles.input,
                    { height: inputHeight, color: theme.textPrimary },
                    showStickerButton ? { paddingLeft: 42 } : { paddingLeft: 12 },
                    isDisabled && { color: theme.textMuted }
                  ]}
                  pointerEvents={isDisabled ? 'none' : 'auto'}
                  placeholder={placeholder}
                  placeholderTextColor={theme.placeholder}
                  autoFocus={false}
                  onChangeText={handleTypingInternal}
                  onContentSizeChange={handleContentSizeChange}
                  multiline
                  maxLength={2000}
                  onContentCommitted={handleContentCommitted}
                />
              </View>
            );
          })()}

          {isDisabled ? (
            <View
              style={[
                styles.sendButton,
                { backgroundColor: theme.border },
              ]}
            >
              <Icon
                name="send"
                size={20}
                color={theme.icon}
                style={{ marginLeft: 2 }}
              />
            </View>
          ) : (!localInputText || localInputText.trim() === '' || isRecording) ? (
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
                color={isRecording ? '#FFF' : theme.icon}
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

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 2,
  },
  attachmentButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // backgroundColor applied via inline theme
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    marginBottom: 2,
  },
  inputWrapper: {
    flex: 1,
    position: 'relative',
    // backgroundColor applied via inline theme
    borderRadius: borderRadius.xl,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  innerStickerButton: {
    position: 'absolute',
    left: 8,
    bottom: 5,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  stickerIcon: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingRight: 12,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: Platform.OS === 'ios' ? 8 : 6,
    fontSize: 17.8,
    // color applied via inline theme
    textAlignVertical: 'top',
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    // backgroundColor applied via inline theme
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