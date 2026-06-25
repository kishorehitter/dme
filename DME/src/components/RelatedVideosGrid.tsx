import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, FlatList } from 'react-native';
import { Song, QueueItem } from '../hooks/useMusicRoom';
import Icon from 'react-native-vector-icons/Ionicons';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 40) / 2;

interface Props {
  // Queue in global FIFO play order (earliest pin first — this IS the
  // actual upcoming play order, identical to what the room will play next
  // when the current song ends). Each item already carries who pinned it.
  queueItems: QueueItem[];

  // Fresh YouTube-suggested related videos (not yet pinned by anyone).
  // Filtered server-side by keyword/content-type/channel — see
  // views.py _build_related_query.
  suggestedVideos: Song[];

  myUserId: number;

  onPinVideo: (song: Song) => void;
  onUnpinVideo: (videoId: string) => void;
}

const RelatedVideosGrid: React.FC<Props> = ({
  queueItems,
  suggestedVideos,
  myUserId,
  onPinVideo,
  onUnpinVideo,
}) => {
  // One flat list of "cards": queued items first (in their actual upcoming
  // play order), then fresh suggestions.
  type Card =
    | { kind: 'queued'; item: QueueItem }
    | { kind: 'suggested'; song: Song };

  const cards: Card[] = [
    ...queueItems.map((item): Card => ({ kind: 'queued', item })),
    ...suggestedVideos.map((song): Card => ({ kind: 'suggested', song })),
  ];

  const PAGE_CARD_SLOTS = 4;
  const pages: Card[][] = [];
  for (let i = 0; i < cards.length; i += PAGE_CARD_SLOTS) {
    pages.push(cards.slice(i, i + PAGE_CARD_SLOTS));
  }
  if (pages.length === 0) pages.push([]);

  const renderCard = (card: Card, key: string) => {
    if (card.kind === 'queued') {
      const { item } = card;
      return (
        <View key={key} style={styles.videoItem}>
          <View>
            <Image source={{ uri: item.song.thumbnail }} style={styles.thumbnail} />
            {/* Pinner avatar badge — small rounded circle, top-left */}
            <View style={styles.avatarBadge}>
              {item.addedByAvatar ? (
                <Image source={{ uri: item.addedByAvatar }} style={styles.avatarBadgeImg} />
              ) : (
                <View style={[styles.avatarBadgeImg, styles.avatarBadgeFallback]}>
                  <Text style={styles.avatarBadgeFallbackText}>
                    {(item.addedByName || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            {/* Cancel — only meaningful for MY OWN pins; server enforces
                this anyway, but hiding it for others' pins avoids a
                confusing no-op tap. */}
            {item.addedById === myUserId && (
              <TouchableOpacity
                style={styles.cancelBadge}
                onPress={() => onUnpinVideo(item.song.videoId)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.videoTitle} numberOfLines={2}>{item.song.title}</Text>
          <Text style={styles.pinnedByText} numberOfLines={1}>
            {item.addedById === myUserId ? 'Your pick' : `${item.addedByName}'s pick`}
          </Text>
        </View>
      );
    }

    const { song } = card;
    return (
      <TouchableOpacity key={key} style={styles.videoItem} onPress={() => onPinVideo(song)}>
        <Image source={{ uri: song.thumbnail }} style={styles.thumbnail} />
        <Text style={styles.videoTitle} numberOfLines={2}>{song.title}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={pages}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item: pageCards, index: pageIndex }) => (
          <View style={styles.page}>
            <View style={styles.grid}>
              {pageCards.map((card, i) => renderCard(card, `${pageIndex}-${i}`))}
              
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 0 },
  page: { width: width },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: 0 },
  videoItem: { width: ITEM_WIDTH, gap: 0, marginBottom: 0 },
  thumbnail: { width: ITEM_WIDTH, height: ITEM_WIDTH * 0.44, borderRadius: 6 },
  videoTitle: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  pinnedByText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'center', marginTop: 1 },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 30, width: '100%' },
  avatarBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  avatarBadgeImg: { width: '100%', height: '100%' },
  avatarBadgeFallback: { backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  avatarBadgeFallbackText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cancelBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
  },
});

export default RelatedVideosGrid;