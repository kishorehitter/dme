import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  Dimensions,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  Image,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { Message } from '../types';
import { resolveImageUrl } from '../utils/image';

const { width } = Dimensions.get('window');

interface MediaGroupListModalProps {
  visible: boolean;
  messages: Message[];
  onClose: () => void;
  onSelectMedia: (msg: Message) => void;
  themeColor?: string;
}

const AutoHeightMedia = ({
  uri,
  isVideo,
  onPress,
}: {
  uri: string;
  isVideo: boolean;
  onPress: () => void;
}) => {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!uri) return;
    if (uri.endsWith('.mp4') || uri.endsWith('.mov') || uri.endsWith('.mkv') || isVideo) {
      setAspectRatio(1.777); // 16:9 for videos
      return;
    }
    Image.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          setAspectRatio(w / h);
        }
      },
      () => {
        setAspectRatio(1.333); // Fallback
      }
    );
  }, [uri, isVideo]);

  const cardWidth = width - 32;
  const finalRatio = aspectRatio || 1.333;
  const calculatedHeight = cardWidth / finalRatio;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        width: '100%',
        height: calculatedHeight,
        backgroundColor: '#F5F5F5',
        position: 'relative',
      }}
    >
      <FastImage
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode={FastImage.resizeMode.contain}
      />
      {isVideo && (
        <View style={styles.playOverlay}>
          <Icon name="play-circle" size={50} color="#FFF" />
        </View>
      )}
    </TouchableOpacity>
  );
};

export const MediaGroupListModal: React.FC<MediaGroupListModalProps> = ({
  visible,
  messages,
  onClose,
  onSelectMedia,
  themeColor = '#4597f5f6',
}) => {
  const renderItem = ({ item }: { item: Message }) => {
    const rawUrl = (item as any).media_url || item.media_file;
    const url = resolveImageUrl(rawUrl);
    const isVideo = item.message_type === 'video';

    return (
      <View style={styles.card}>
        <AutoHeightMedia
          uri={url}
          isVideo={isVideo}
          onPress={() => onSelectMedia(item)}
        />
        {item.content ? (
          <View style={styles.captionContainer}>
            <Text style={styles.captionText}>{item.content}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={true} />
      <SafeAreaView style={[styles.container, Platform.OS === 'android' && { paddingTop: StatusBar.currentHeight }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {messages.length} Photos
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Scrollable Feed */}
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  list: {
    backgroundColor: '#F7F7F7',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#1A1A1A',
    fontSize: 17,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    // card shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captionContainer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  captionText: {
    color: '#1A1A1A',
    fontSize: 15,
    lineHeight: 20,
  },
});

export default MediaGroupListModal;
