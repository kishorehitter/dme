import React from 'react';
import {
  View, Text, Image, StyleSheet,
  TouchableOpacity, Dimensions
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { Status } from '../services/StatusService';

const { width } = Dimensions.get('window');

interface Props {
  status:        Status;
  onViewViewers: (statusId: number) => void;
  onDelete:      (statusId: number) => void;
}

const StatusListItem: React.FC<Props> = ({ status, onViewViewers, onDelete }) => {
  const navigation = useNavigation<any>();

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 12) return `${hrs}h ago`;
    return 'today';
  };

  const mediaUrl = status.media_url || status.media_file;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => navigation.navigate('StatusViewer', {
        statuses:      [status],
        initialIndex:  0,
        currentUserId: status.user_id,
        isOwn:         true,
      })}
      activeOpacity={0.85}
    >
      {/* Thumbnail — works for both photo and video */}
      <View style={styles.mediaContainer}>
        {mediaUrl ? (
          <Image source={{ uri: mediaUrl }} style={styles.media} />
        ) : (
          <View style={[styles.media, styles.mediaFallback]}>
            <Icon name="image-outline" size={40} color="#aaa" />
          </View>
        )}

        {/* Video badge */}
        {status.media_type === 'video' && (
          <View style={styles.videoBadge}>
            <Icon name="play-circle" size={36} color="#fff" />
          </View>
        )}

        {/* Caption overlay */}
        {!!status.caption && (
          <View style={styles.captionOverlay}>
            <Text style={styles.captionText} numberOfLines={2}>
              {status.caption}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom info row */}
      <View style={styles.infoRow}>
        <Text style={styles.time}>{timeAgo(status.created_at)}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => onViewViewers(status.id)}
            style={styles.actionBtn}
          >
            <Icon name="eye" size={18} color="#8100D1" />
            <Text style={styles.countText}>{status.view_count ?? 0}</Text>
          </TouchableOpacity>
           {/* Like count */}
          <View style={styles.actionBtn}>
            <Icon name="heart" size={18} color="#ff4d6d" />
            <Text style={styles.countText}>{(status as any).like_count ?? 0}</Text>
          </View>
          <TouchableOpacity
            onPress={() => onDelete(status.id)}
            style={styles.actionBtn}
          >
            <Icon name="trash-outline" size={18} color="#e53935" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginVertical: 8,
    marginHorizontal: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  mediaContainer: {
    width: '100%',
    height: 220,
    backgroundColor: '#111',
  },
  media: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  mediaFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  videoBadge: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  captionOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  captionText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  time: {
    fontSize: 13,
    color: '#888',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  countText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
  },
});

export default StatusListItem;