import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { requireNativeComponent, NativeSyntheticEvent, findNodeHandle, UIManager, Keyboard } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface ContentCommittedEvent {
  uri: string;
  mimeType: string;
}

interface TextChangeEvent {
  text: string;
}

interface Props {
  style?: any;
  placeholder?: string;
  placeholderTextColor?: string;
  text?: string;
  onContentCommitted?: (event: NativeSyntheticEvent<ContentCommittedEvent>) => void;
  onTextChange?: (event: NativeSyntheticEvent<TextChangeEvent>) => void;
  onChangeText?: (text: string) => void;
  onContentSizeChange?: (event: NativeSyntheticEvent<{ contentSize: { width: number; height: number } }>) => void;
  multiline?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: string;
  underlineColorAndroid?: string;
}

export interface RichTextInputRef {
  clear: () => void;
  setText: (text: string) => void;
  focus: () => void;
  blur: () => void;
}

const NativeRichTextInput = requireNativeComponent<any>('RichTextInput');

const RichTextInput = forwardRef<RichTextInputRef, Props>((props, ref) => {
  const { theme } = useTheme();
  const { onTextChange, onChangeText, onContentSizeChange, text, style, placeholderTextColor, ...rest } = props;
  const nativeRef = useRef<any>(null);
  useImperativeHandle(ref, () => ({
    clear: () => {
      try {
        nativeRef.current?.setNativeProps?.({ text: '' });
      } catch (_) {}

      const handle = findNodeHandle(nativeRef.current);
      if (handle != null) {
        try {
          const config = UIManager.getViewManagerConfig?.('RichTextInput');
          const command = config?.Commands?.clear ?? 1;
          UIManager.dispatchViewManagerCommand(handle, command as any, []);
        } catch (_) {
          try {
            UIManager.dispatchViewManagerCommand(handle, 1, []);
          } catch (_) {
            try {
              UIManager.dispatchViewManagerCommand(handle, 'clear', []);
            } catch (_) {}
          }
        }
      }
    },
    setText: (newText: string) => {
      try {
        nativeRef.current?.setNativeProps?.({ text: newText });
      } catch (_) {}

      const handle = findNodeHandle(nativeRef.current);
      if (handle != null) {
        try {
          const config = UIManager.getViewManagerConfig?.('RichTextInput');
          const command = config?.Commands?.setText ?? 2;
          UIManager.dispatchViewManagerCommand(handle, command as any, [newText]);
        } catch (_) {
          try {
            UIManager.dispatchViewManagerCommand(handle, 2, [newText]);
          } catch (_) {
            try {
              UIManager.dispatchViewManagerCommand(handle, 'setText', [newText]);
            } catch (_) {}
          }
        }
      }
    },
    focus: () => {
      nativeRef.current?.focus?.();
    },
    blur: () => {
      Keyboard.dismiss();
      const handle = findNodeHandle(nativeRef.current);
      if (handle != null) {
        try {
          UIManager.dispatchViewManagerCommand(handle, 'blur', []);
        } catch (e) {
          nativeRef.current?.blur?.();
        }
      } else {
        nativeRef.current?.blur?.();
      }
    },
  }));

  const _onTextChange = (event: NativeSyntheticEvent<TextChangeEvent>) => {
    if (onTextChange) onTextChange(event);
    if (onChangeText) onChangeText(event.nativeEvent.text);
  };

  const _onContentCommitted = (event: NativeSyntheticEvent<ContentCommittedEvent>) => {
    if (rest.onContentCommitted) rest.onContentCommitted(event);
  };

  return (
    <NativeRichTextInput
      {...rest}
      ref={nativeRef}
      style={[{ color: theme.textPrimary }, style]}
      placeholderTextColor={placeholderTextColor ?? theme.textMuted}
      onTextChange={_onTextChange}
      onContentSizeChange={onContentSizeChange}
      onContentCommitted={_onContentCommitted}
    />
  );
});

export default RichTextInput;