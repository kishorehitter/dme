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
    isStickerPickerVisible,
    onCloseStickerPicker,
    onFocus,
    isCustomTheme,
    chatTheme,
}: any) => {

    const { theme, isDark } = useTheme();
    const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
    const inputRef = useRef<RichTextInputRef>(null);
    const prevInputText = useRef(inputText);
    // Mirror text in a ref so handleSend always reads the latest value
    // synchronously without waiting for a React re-render cycle.
    const localInputTextRef = useRef(inputText || '');
    const [localInputText, setLocalInputText] = useState(inputText || '');
    const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);
    const [localClearKey, setLocalClearKey] = useState(0);

    // ── Instant native button toggle (bypasses React render entirely) ─────────
    // Animated.Value.setValue() pushes directly to the native layer with zero
    // JS reconciliation — this is how WhatsApp achieves 0-frame button switching.
    //   0 = mic visible / send hidden
    //   1 = send visible / mic hidden
    const hasTextAnim = useRef(
      new Animated.Value((inputText || '').length > 0 ? 1 : 0)
    ).current;

    const handleTypingInternal = useCallback((text: string) => {
      const t0 = performance.now();
      localInputTextRef.current = text;
      // Native instant toggle — no React re-render needed for button switch
      hasTextAnim.setValue(text.length > 0 ? 1 : 0);
      setLocalInputText(text);
      handleTyping?.(text);
      const dt = (performance.now() - t0).toFixed(2);
      if (text.length === 1) {
        console.log(`⏱️ [PERF: TYPING] Native button switch in: ${dt}ms`);
      }
    }, [handleTyping, hasTextAnim]);

    const handleSend = useCallback(() => {
      const sendStartTime = performance.now();
      const textToSend = (localInputTextRef.current || '').trim();
      if (!textToSend) return;
      // 1. Native instant reset — mic appears before React has rendered anything
      hasTextAnim.setValue(0);
      localInputTextRef.current = '';
      setLocalInputText('');
      setInputHeight(MIN_HEIGHT);
      inputRef.current?.clear();
      const resetTime = (performance.now() - sendStartTime).toFixed(2);
      console.log(`⚡ [PERF: RESET] Native button+input reset in: ${resetTime}ms`);
      // 2. Dispatch send
      sendMessage?.(textToSend, sendStartTime);
    }, [sendMessage, hasTextAnim]);
    useEffect(() => {
      const emojiSub = DeviceEventEmitter.addListener('INSERT_EMOJI_CHAR', (emoji) => {
        setLocalInputText(prev => {
          const next = prev + emoji;
          localInputTextRef.current = next;
          hasTextAnim.setValue(next.length > 0 ? 1 : 0);
          inputRef.current?.setText(next);
          handleTyping?.(next);
          return next;
        });
      });

      return () => {
        emojiSub.remove();
      };
    }, [handleTyping, hasTextAnim]);

    // Register clear function with parent on mount
    useEffect(() => {
      onRegisterClear?.(() => {
        setLocalClearKey(k => k + 1);
        setInputHeight(MIN_HEIGHT);
        localInputTextRef.current = '';
        hasTextAnim.setValue(0); // native instant: show mic immediately
        setLocalInputText('');
        inputRef.current?.clear();
        // NOTE: No focus() here — calling focus after clear causes Android keyboard
        // show/hide animation thrash which stalls the UI for 1-2s after every send.
      });
    }, [onRegisterClear, hasTextAnim]);

    useEffect(() => {
      return () => {
        inputRef.current?.blur();
      };
    }, []);

    const prevEditingId = useRef(editingMessageId);
    useEffect(() => {
      if (editingMessageId && inputText) {
        hasTextAnim.setValue(inputText.length > 0 ? 1 : 0);
        setLocalInputText(inputText);
        inputRef.current?.setText(inputText);
        prevInputText.current = inputText;
      } else if (prevEditingId.current && !editingMessageId) {
        hasTextAnim.setValue(0);
        setLocalInputText('');
        inputRef.current?.clear();
        prevInputText.current = '';
      }
      prevEditingId.current = editingMessageId;
    }, [editingMessageId, hasTextAnim]);

    const handleContentSizeChange = useCallback((event: any) => {
      const h = event.nativeEvent?.contentSize?.height;
      if (h) {
        const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)));
        setInputHeight(prev => (Math.abs(prev - next) >= 4 ? next : prev));
      }
    }, []);

    const handleContentCommitted = useCallback((event: any) => {
        const { uri, mimeType } = event.nativeEvent;
        if (uri) setStickerPreview({ uri, mimeType });
    }, [setStickerPreview]);

    const placeholder = isDisabled ? 'Messaging is restricted' : (editingMessageId ? 'Edit your message...' : 'Message');

    return (
        <View style={styles.inputContainer}>
          {!isRecording && (
            <TouchableOpacity
              style={[
                styles.attachmentButton,
                {
                  backgroundColor: isCustomTheme
                    ? 'rgba(255, 255, 255, 0.22)'
                    : (isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)'),
                },
                isDisabled && { opacity: 0.5 },
              ]}
              onPress={handleAttachment}
              disabled={isDisabled}
              activeOpacity={0.7}
            >
              <Icon
                name="add"
                size={24}
                color={isCustomTheme ? '#FFFFFF' : theme.textPrimary}
              />
            </TouchableOpacity>
          )}

          {!isRecording && (() => {
            const showStickerButton = !editingMessageId;
            return (
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: isCustomTheme
                      ? 'rgba(0, 0, 0, 0.35)'
                      : theme.inputBackground,
                    borderWidth: isCustomTheme ? StyleSheet.hairlineWidth : 0,
                    borderColor: isCustomTheme ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                  },
                  isDisabled && { backgroundColor: theme.border },
                ]}
              >
                {showStickerButton && (
                  <TouchableOpacity
                    style={styles.innerStickerButton}
                    activeOpacity={0.7}
                    delayPressIn={0}
                    onPress={() => {
                      inputRef.current?.blur();
                      Keyboard.dismiss();
                      if (isStickerPickerVisible) {
                        onCloseStickerPicker?.();
                      } else {
                        onOpenStickerPicker?.();
                      }
                    }}
                    disabled={isDisabled}
                    accessibilityLabel={isStickerPickerVisible ? "Close sticker picker" : "Open sticker picker"}
                  >
                    <Icon
                      name={isStickerPickerVisible ? "close-circle" : "happy-outline"}
                      size={isStickerPickerVisible ? 22 : 24}
                      color={
                        isStickerPickerVisible
                          ? (isDark ? "#FFFFFF" : "#000000")
                          : (isCustomTheme ? 'rgba(255, 255, 255, 0.85)' : theme.icon)
                      }
                    />
                  </TouchableOpacity>
                )}

                <RichTextInput
                  ref={inputRef}
                  onFocus={onFocus}
                  style={[
                    styles.input,
                    {
                      height: inputHeight,
                      color: isCustomTheme ? '#FFFFFF' : theme.textPrimary,
                    },
                    showStickerButton ? { paddingLeft: 42 } : { paddingLeft: 12 },
                    isDisabled && { color: theme.textMuted }
                  ]}
                  pointerEvents={isDisabled ? 'none' : 'auto'}
                  placeholder={placeholder}
                  placeholderTextColor={isCustomTheme ? 'rgba(255, 255, 255, 0.60)' : theme.placeholder}
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
                styles.actionButton,
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
          ) : (
            <Animated.View
              style={[
                styles.actionButton,
                {
                  backgroundColor: isRecording
                    ? '#FF4444'
                    : editingMessageId
                    ? '#FF9800'
                    : hasTextAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [
                          isCustomTheme
                            ? 'rgba(255, 255, 255, 0.22)'
                            : (isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)'),
                          '#0EA5E9',
                        ],
                      }),
                },
                isRecording && styles.actionButtonRecording,
              ]}
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                onPressIn={() => {
                  const text = (localInputTextRef.current || '').trim();
                  if (text.length > 0) {
                    handleSend();
                  }
                }}
                activeOpacity={0.8}
                delayPressIn={0}
                {...micPanResponder.panHandlers}
              >
                {/* 1. Send Icon (Cross-fades in instantly on typing) */}
                <Animated.View
                  style={[
                    styles.iconLayer,
                    {
                      opacity: hasTextAnim,
                      transform: [
                        {
                          scale: hasTextAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.4, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Icon
                    name={editingMessageId ? 'checkmark' : 'send'}
                    size={20}
                    color="#FFF"
                    style={!editingMessageId ? { marginLeft: 2 } : {}}
                  />
                </Animated.View>

                {/* 2. Mic Icon (Cross-fades in instantly when empty) */}
                <Animated.View
                  style={[
                    styles.iconLayer,
                    {
                      opacity: hasTextAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                      transform: [
                        { scale: isRecording ? 1 : micButtonScale },
                        {
                          scale: hasTextAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 0.4],
                          }),
                        },
                      ],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Icon
                    name="mic"
                    size={22}
                    color={isCustomTheme ? '#FFFFFF' : theme.textPrimary}
                  />
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>
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
  actionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    marginBottom: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  actionButtonRecording: {
    backgroundColor: '#FF4444',
  },
  iconLayer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    width: 38,
    height: 38,
  },
});

export default ChatInputArea;