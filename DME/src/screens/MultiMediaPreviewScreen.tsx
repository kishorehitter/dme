/**
 * MultiMediaPreviewScreen.tsx
 *
 * Registered as a React Navigation screen so the preview opens
 * via the native stack slide-from-right transition (exactly like
 * StatusEditorScreen), with zero JS-thread stutter or stuck frames.
 *
 * Route params:
 *   mediaItems  – SelectedMedia[] to preview/edit
 *   themeColor  – accent color string
 *   sendEventId – unique ID emitted via DeviceEventEmitter when user sends
 */

import React, { useCallback } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { MultiMediaPreviewModal, SelectedMedia } from '../components/MultiMediaPreviewModal';
import { useTheme } from '../context/ThemeContext';

interface RouteParams {
  mediaItems: SelectedMedia[];
  themeColor?: string;
  sendEventId: string;
}

const MultiMediaPreviewScreen: React.FC<{ route: any; navigation: any }> = ({
  route,
  navigation,
}) => {
  const { mediaItems, themeColor, sendEventId } = route.params as RouteParams;
  const { theme } = useTheme();

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSend = useCallback(
    (items: SelectedMedia[]) => {
      DeviceEventEmitter.emit(sendEventId, items);
      navigation.goBack();
    },
    [navigation, sendEventId]
  );

  return (
    <MultiMediaPreviewModal
      visible={true}
      mediaItems={mediaItems}
      onClose={handleClose}
      onSend={handleSend}
      themeColor={themeColor ?? theme.primary}
    />
  );
};

export default MultiMediaPreviewScreen;
