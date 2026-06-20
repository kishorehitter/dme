import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { requireNativeComponent, NativeSyntheticEvent, findNodeHandle, UIManager } from 'react-native';

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
}

export interface RichTextInputRef {
  clear: () => void;
  setText: (text: string) => void;
}

const NativeRichTextInput = requireNativeComponent<any>('RichTextInput');

const RichTextInput = forwardRef<RichTextInputRef, Props>((props, ref) => {
  const { onTextChange, onChangeText, onContentSizeChange, text, ...rest } = props;
  const nativeRef = useRef<any>(null);

  // ✅ Expose clear/setText so parent can imperatively control text
  useImperativeHandle(ref, () => ({
    clear: () => {
      const node = findNodeHandle(nativeRef.current);
      if (node) {
        UIManager.dispatchViewManagerCommand(node, 'clear', []);
      }
    },
    setText: (newText: string) => {
      const node = findNodeHandle(nativeRef.current);
      if (node) {
        UIManager.dispatchViewManagerCommand(node, 'setText', [newText]);
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
      // ✅ Don't pass text prop — uncontrolled, native handles its own state
      onTextChange={_onTextChange}
      onContentSizeChange={onContentSizeChange}
      onContentCommitted={_onContentCommitted}
    />
  );
});

export default RichTextInput;