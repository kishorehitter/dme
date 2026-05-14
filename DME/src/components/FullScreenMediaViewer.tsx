import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar, Dimensions } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';

const { width, height } = Dimensions.get('window');

interface Props {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  onClose: () => void;
}

const FullScreenMediaViewer: React.FC<Props> = ({ mediaUrl, mediaType, onClose }) => {
  return (
    <Modal visible={true} transparent={false} animationType="fade" onRequestClose={onClose}>
      <StatusBar hidden />
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
