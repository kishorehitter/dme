import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { Message } from '../types';
import { resolveImageUrl } from '../utils/image';
import { useTheme } from '../context/ThemeContext';

interface ChatMediaGridProps {
  messages: Message[];
  /** Called when user taps Cancel while uploading */
  onCancelUpload?: () => void;
  /** Called when user taps the retry icon after cancellation */
  onRetryUpload?: () => void;
}

export const ChatMediaGrid: React.FC<ChatMediaGridProps> = ({
  messages,
  onCancelUpload,
  onRetryUpload,
}) => {
  const { theme, isDark } = useTheme();
  const styles = dynamicStyles(theme);

  const totalCount = messages.length;
  if (totalCount < 2) return null;

  const tiles = messages.slice(0, 4).map((msg) => {
    const isSending = (msg as any).status === 'sending';
    const rawUrl = isSending
      ? (msg.media_file || (msg as any).media_url)
      : ((msg as any).media_url || msg.media_file);
    return {
      url: isSending ? rawUrl : resolveImageUrl(rawUrl),
      isVideo: msg.message_type === 'video',
      isSending,
    };
  });

  const anySending = messages.some((msg) => (msg as any).status === 'sending');
  const anyFailed = messages.some((msg) => (msg as any).status === 'failed');

  const renderTile = (
    tile: { url: string; isVideo: boolean; isSending: boolean },
    idx: number,
    extraOverlay?: React.ReactNode
  ) => (
    <View key={idx} style={StyleSheet.absoluteFill}>
      <FastImage
        source={{ uri: tile.url }}
        style={styles.image}
        resizeMode={FastImage.resizeMode.cover}
      />
      {!tile.isSending && tile.isVideo && (
        <View style={styles.playOverlay}>
          <Icon name="play" size={20} color="#FFF" />
        </View>
      )}
      {extraOverlay}
    </View>
  );

  const renderLayout = () => {
    if (totalCount === 2) {
      return (
        <View style={styles.row}>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[0], 0)}
          </View>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[1], 1)}
          </View>
        </View>
      );
    }

    if (totalCount === 3) {
      return (
        <View style={styles.row}>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[0], 0)}
          </View>
          <View style={styles.columnHalf}>
            <View style={[styles.columnHalfRow, { position: 'relative' }]}>
              {renderTile(tiles[1], 1)}
            </View>
            <View style={[styles.columnHalfRow, { position: 'relative' }]}>
              {renderTile(tiles[2], 2)}
            </View>
          </View>
        </View>
      );
    }

    // 4+ → 2×2
    const remaining = totalCount - 3;
    return (
      <View style={styles.grid2x2}>
        <View style={styles.rowHalf}>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[0], 0)}
          </View>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[1], 1)}
          </View>
        </View>
        <View style={styles.rowHalf}>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(tiles[2], 2)}
          </View>
          <View style={[styles.columnHalf, { position: 'relative' }]}>
            {renderTile(
              tiles[3],
              3,
              remaining > 0 ? (
                <View style={styles.countOverlay}>
                  <Text style={styles.countText}>+{remaining}</Text>
                </View>
              ) : undefined
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {renderLayout()}

      {/* Single central spinner overlay while uploading */}
      {anySending && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancelUpload}
          >
            <Icon name="close" size={18} color="#FFF" />
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Retry state after failure / cancellation */}
      {anyFailed && !anySending && (
        <TouchableOpacity
          style={styles.uploadOverlay}
          onPress={onRetryUpload}
          activeOpacity={0.85}
        >
          <Icon name="refresh" size={36} color="#FFF" />
          <Text style={styles.retryText}>Tap to retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  container: {
    width: 230,
    height: 230,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
  grid2x2: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  rowHalf: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
  columnHalf: {
    flex: 1,
    gap: 2,
  },
  columnHalfRow: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  // Full-grid upload overlay
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.8)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  cancelText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
});
