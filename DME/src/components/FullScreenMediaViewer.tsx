import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar, Dimensions, NativeModules, Platform } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';

const { width, height } = Dimensions.get('window');
const { SystemBar } = NativeModules;

interface Props {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  onClose: () => void;
}

const FullScreenMediaViewer: React.FC<Props> = ({ mediaUrl, mediaType, onClose }) => {
  useEffect(() => {
    if (Platform.OS === 'android' && SystemBar) {
      // Industry Standard: Black bars for media viewing
      SystemBar.setStatusBarColor('#000000', true);
      SystemBar.setNavigationBarColor('#000000', true);
    }
    
    return () => {
      if (Platform.OS === 'android' && SystemBar) {
        // Restore to app standard: White bars
        SystemBar.setStatusBarColor('#FFFFFF', false);
        SystemBar.setNavigationBarColor('#FFFFFF', false);
      }
    };
  }, []);

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={true}
      presentationStyle="overFullScreen"
      onShow={() => {
        if (Platform.OS === 'android' && SystemBar) {
          SystemBar.setStatusBarColor('#000000', true);
          SystemBar.setNavigationBarColor('#000000', true);
        }
      }}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent={true} />
      <View style={styles.container}>
        {mediaType === 'video' ? (
          <Video
            source={{ uri: mediaUrl }}
            style={styles.media}
            controls={true}
            resizeMode="contain"
            repeat
          />
        ) : (
          <ImageViewer
            imageUrls={[{ url: mediaUrl }]}
            enableSwipeDown
            onSwipeDown={onClose}
            style={styles.media}
            renderIndicator={() => null}
          />
        )}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Icon name="close" size={35} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width, height },
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 10, padding: 10 },
});

export default FullScreenMediaViewer;
