import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Dimensions, Platform, BackHandler } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

const { width, height } = Dimensions.get('window');

interface Props {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  onClose: () => void;
}

const FullScreenMediaViewer: React.FC<Props> = ({ mediaUrl, mediaType, onClose }) => {
  useEffect(() => {
    if (Platform.OS === 'android') {
      try {
        changeNavigationBarColor('#000000', false);
      } catch (e) {}

      // Intercept hardware back button
      const backAction = () => {
        onClose();
        return true; // Prevent default behavior (e.g., closing the screen underneath)
      };

      const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => backHandler.remove();
    }
  }, [onClose]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent={true} />
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
  );
};

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 1000 },
  media: { width, height },
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 10, padding: 10 },
});

export default FullScreenMediaViewer;
