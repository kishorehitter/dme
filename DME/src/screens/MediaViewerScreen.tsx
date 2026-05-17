import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Dimensions, NativeModules, Platform } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');
const { SystemBar } = NativeModules;

const MediaViewerScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { mediaUrl, mediaType } = route.params as { mediaUrl: string; mediaType: 'image' | 'video' };

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

  const handleClose = () => {
    navigation.goBack();
  };

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
          onSwipeDown={handleClose}
          style={styles.media}
          renderIndicator={() => null}
        />
      )}
      
      <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
        <Icon name="close" size={35} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width, height },
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 10, padding: 10 },
});

export default MediaViewerScreen;
