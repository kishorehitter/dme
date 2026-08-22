import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  StatusBar,
  Platform,
  Image,
  BackHandler,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { Message } from '../types';
import { resolveImageUrl } from '../utils/image';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const { theme } = useTheme();
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
        backgroundColor: theme.inputBackground,
        position: 'relative',
      }}
    >
      <FastImage
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode={FastImage.resizeMode.contain}
      />
      {isVideo && (
        <View style={overlayStyles.playOverlay}>
          <Icon name="play-circle" size={50} color="#FFF" />
        </View>
      )}
    </TouchableOpacity>
  );
};

const overlayStyles = StyleSheet.create({
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const MediaGroupListModal: React.FC<MediaGroupListModalProps> = ({
  visible,
  messages,
  onClose,
  onSelectMedia,
}) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = dynamicStyles(theme);

  // Hard block hardware back button
  useEffect(() => {
    if (!visible) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => backSub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  // Status bar height on Android
  const statusBarHeight = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : insets.top;

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
    // Render as absolute overlay over the activity — NOT as a Modal dialog
    // This keeps the same Window as the activity so nav bar color applies correctly
    <View style={[styles.root, StyleSheet.absoluteFillObject]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={true}
      />

      {/* Header — sits below status bar */}
      <View style={[styles.header, { paddingTop: statusBarHeight }]}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
          <Icon name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {messages.length} Photos
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Scrollable Feed — extends fully to bottom edge, no padding for nav bar */}
      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />
    </View>
  );
};

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) =>
  StyleSheet.create({
    root: {
      backgroundColor: theme.background,
      zIndex: 9999,
      elevation: 20,
    },
    list: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    backButton: {
      padding: 8,
    },
    headerTitle: {
      color: theme.textPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    listContent: {
      padding: 16,
      gap: 16,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    },
    captionContainer: {
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.surface,
    },
    captionText: {
      color: theme.textPrimary,
      fontSize: 15,
      lineHeight: 20,
    },
  });

export default MediaGroupListModal;
