import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, FlatList } from 'react-native';
import { Song, QueueItem, Participant } from '../hooks/useMusicRoom';
import AvatarWithFallback from '../components/AvatarWithFallback';
import Icon from 'react-native-vector-icons/Ionicons';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = width / 2;

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
  myAvatar?: string | null;
  myAvatarSticker?: string | null;
  participants: Participant[];

  onPinVideo: (song: Song) => void;
  onUnpinVideo: (videoId: string) => void;
  // Pass the currently playing song to reserve PiP slot 1.
  // Pass null when video has ended so slot 1 shows a real suggested video instead.
  currentSong?: Song | null;
  scrollX?: any;
  onScrollX?: (x: number) => void;
  onSelectCurrent?: () => void;
}

const RelatedVideosGrid: React.FC<Props> = ({
  queueItems,
  suggestedVideos,
  myUserId,
  myAvatar,
  myAvatarSticker,
  participants,
  onPinVideo,
  onUnpinVideo,
  currentSong,
  scrollX,
  onScrollX,
  onSelectCurrent,
}) => {
  // One flat list of "cards": current song first (reserves PiP space while
  // playing — transparent slot overlaid by the live Animated.View player),
  // queued items next, then fresh suggestions.
  // When currentSong is null (video ended), no slot is reserved.
  type Card =
    | { kind: 'current'; song: Song }
    | { kind: 'queued'; item: QueueItem }
    | { kind: 'suggested'; song: Song };

  const PAGE_CARD_SLOTS = 4;
  const MIN_SETS = 4; // Always maintain at least 4 complete sets (16 cards)
  const MIN_CARDS = MIN_SETS * PAGE_CARD_SLOTS;

  const currentCount = currentSong ? 1 : 0;
  const queueCount = queueItems.length;
  const occupiedCount = currentCount + queueCount;

  // Calculate target total so that every set has exactly 4 cards
  const targetTotal = Math.max(MIN_CARDS, Math.ceil(occupiedCount / PAGE_CARD_SLOTS) * PAGE_CARD_SLOTS);
  const neededSuggestions = Math.max(0, targetTotal - occupiedCount);

  const cards: Card[] = [];
  if (currentSong) {
    cards.push({ kind: 'current', song: currentSong });
  }
  cards.push(...queueItems.map((item): Card => ({ kind: 'queued', item })));
  cards.push(...suggestedVideos.slice(0, neededSuggestions).map((song): Card => ({ kind: 'suggested', song })));

  // Trim to exact multiple of PAGE_CARD_SLOTS to guarantee zero dangling/orphan slots
  const fullSetsCardsCount = Math.floor(cards.length / PAGE_CARD_SLOTS) * PAGE_CARD_SLOTS;
  const finalCards = fullSetsCardsCount > 0 ? cards.slice(0, fullSetsCardsCount) : cards;

  const pages: Card[][] = [];
  for (let i = 0; i < finalCards.length; i += PAGE_CARD_SLOTS) {
    pages.push(finalCards.slice(i, i + PAGE_CARD_SLOTS));
  }
  if (pages.length === 0) pages.push([]);

  const renderCard = (card: Card, key: string) => {
    if (card.kind === 'current') {
      return (
        <TouchableOpacity
          key={key}
          style={styles.videoItem}
          activeOpacity={0.85}
          onPress={onSelectCurrent}
        >
          <Image source={{ uri: card.song.thumbnail }} style={styles.thumbnail} />
          <View style={styles.nowPlayingBadge}>
            <View style={styles.playingDot} />
            <Text style={styles.nowPlayingText}>PLAYING</Text>
          </View>
          <View style={styles.titleOverlay}>
            <Text style={styles.videoTitle} numberOfLines={1}>{card.song.title}</Text>
            {card.song.channelTitle ? (
              <Text style={styles.channelTitleText} numberOfLines={1}>{card.song.channelTitle}</Text>
            ) : null}
          </View>
        </TouchableOpacity>
      );
    }

    if (card.kind === 'queued') {
      const { item } = card;
      const isMine = item.addedById === myUserId;
      const pinner = participants.find(participant => participant.user_id === item.addedById);
      const hasCurrentUserAvatar = isMine && (myAvatar !== undefined || myAvatarSticker !== undefined);
      const avatarSticker = hasCurrentUserAvatar
        ? myAvatarSticker
        : pinner
          ? pinner.avatar_sticker !== undefined
            ? pinner.avatar_sticker
            : item.addedByAvatarSticker
          : item.addedByAvatarSticker;
      const avatarUri = hasCurrentUserAvatar
        ? myAvatar
        : pinner
          ? pinner.avatar !== undefined
            ? pinner.avatar
            : item.addedByAvatar
          : item.addedByAvatar;

      return (
        <View key={key} style={styles.videoItem}>
          <Image source={{ uri: item.song.thumbnail }} style={styles.thumbnail} />
          {/* Pinner avatar badge — small rounded circle, top-left */}
          <View style={styles.avatarBadge}>
            <AvatarWithFallback
              uri={avatarSticker ? undefined : avatarUri}
              displayName={item.addedByName}
              sticker={avatarSticker}
              style={styles.avatarBadgeImage}
            />
          </View>
          {/* Cancel — only meaningful for MY OWN pins; server enforces
              this anyway, but hiding it for others' pins avoids a
              confusing no-op tap. */}
          {isMine && (
            <TouchableOpacity
              style={styles.cancelBadge}
              onPress={() => onUnpinVideo(item.song.videoId)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close-circle" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          <View style={styles.titleOverlay}>
            <Text style={styles.videoTitle} numberOfLines={1}>{item.song.title}</Text>
            {item.song.channelTitle && (
              <Text style={styles.channelTitleText} numberOfLines={1}>{item.song.channelTitle}</Text>
            )}
          </View>
        </View>
      );
    }

    const { song } = card;
    return (
      <TouchableOpacity key={key} style={styles.videoItem} onPress={() => onPinVideo(song)}>
        <Image source={{ uri: song.thumbnail }} style={styles.thumbnail} />
        <View style={styles.titleOverlay}>
          <Text style={styles.videoTitle} numberOfLines={1}>{song.title}</Text>
          {song.channelTitle && (
            <Text style={styles.channelTitleText} numberOfLines={1}>{song.channelTitle}</Text>
          )}
        </View>
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
        onScroll={(event: any) => {
          const x = event?.nativeEvent?.contentOffset?.x || 0;
          onScrollX?.(x);
        }}
        onMomentumScrollEnd={(event: any) => {
          const x = event?.nativeEvent?.contentOffset?.x || 0;
          onScrollX?.(x);
        }}
        onScrollEndDrag={(event: any) => {
          const x = event?.nativeEvent?.contentOffset?.x || 0;
          onScrollX?.(x);
        }}
        scrollEventThrottle={16}
        renderItem={({ item: pageCards, index: pageIndex }) => {
          const col1 = pageCards.slice(0, 2);
          const col2 = pageCards.slice(2, 4);
          return (
            <View style={styles.page}>
              <View style={styles.grid}>
                <View style={styles.column}>
                  {col1.map((card, i) => renderCard(card, `${pageIndex}-c1-${i}`))}
                </View>
                <View style={styles.column}>
                  {col2.map((card, i) => renderCard(card, `${pageIndex}-c2-${i}`))}
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 0 },
  page: { width: width },
  grid: { flexDirection: 'row', width: width },
  column: { width: ITEM_WIDTH, flexDirection: 'column' },
  videoItem: { width: ITEM_WIDTH, height: ITEM_WIDTH * 0.5625, position: 'relative', overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  videoTitle: { color: '#fff', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  channelTitleText: { color: 'rgba(255,255,255,0.6)', fontSize: 8.5, textAlign: 'center', marginTop: 1 },
  pinnedByText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'center', marginTop: 1 },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 30, width: '100%' },
  avatarBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    zIndex: 2,
  },
  avatarBadgeImage: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  cancelBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
  },
  nowPlayingBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 4,
    zIndex: 2,
  },
  playingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  nowPlayingText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

export default RelatedVideosGrid;