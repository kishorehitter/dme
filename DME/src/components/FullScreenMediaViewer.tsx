import React, { useEffect, useLayoutEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Platform, BackHandler, NativeModules, Dimensions } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');

interface Props {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  onClose: () => void;
}

const FullScreenMediaViewer: React.FC<Props> = ({ mediaUrl, mediaType, onClose }) => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  useLayoutEffect(() => {
    if (Platform.OS === 'android') {
      pinNavBarColor('#00000000');
      try { changeNavigationBarColor('#00000000', true, false); } catch {}
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
      }
      return () => {
        pinNavBarColor(theme.navBar);
        try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch {}
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
        }
      };
    }
  }, [theme, isDark]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      // Intercept hardware back button
      const backAction = () => {
        onClose();
        return true; // Prevent default behavior
      };

      const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => backHandler.remove();
    }
  }, [onClose]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      {mediaType === 'video' ? (
        <Video
          source={{ uri: mediaUrl }}
          style={{ width: SCREEN_W, height: SCREEN_H }}
          controls={true}
          resizeMode="contain"
          repeat
        />
      ) : (
        <ImageViewer
          imageUrls={[{ url: mediaUrl }]}
          enableSwipeDown
          onSwipeDown={onClose}
          style={{ width: SCREEN_W, height: SCREEN_H }}
          cropWidth={SCREEN_W}
          cropHeight={SCREEN_H}
          renderIndicator={() => null}
        />
      )}
      <TouchableOpacity
        style={[
          styles.closeButton,
          {
            top: insets.top > 0 ? insets.top + 10 : 20,
            right: insets.right > 0 ? insets.right + 10 : 20,
          }
        ]}
        onPress={onClose}
      >
        <Icon name="close" size={35} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 1000 },
  closeButton: { position: 'absolute', zIndex: 10, padding: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 25 },
});

export default FullScreenMediaViewer;
