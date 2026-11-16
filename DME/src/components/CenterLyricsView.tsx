import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  FlatListProps,
  Animated as RNAnimated,
  StyleProp,
  ViewStyle,
  Platform,
  Dimensions,
  GestureResponderEvent,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { LyricLine, cleanArtistName } from '../services/LyricsService';

const ITEM_HEIGHT = 80;

const AnimatedFlatList = (Reanimated.FlatList ||
  Reanimated.createAnimatedComponent(FlatList)) as unknown as React.ComponentType<
  FlatListProps<DisplayItem> & { ref?: any }
>;

interface CenterLyricsViewProps {
  lines: LyricLine[];
  currentPosition: number;
  isLoading: boolean;
  instrumental: boolean;
  hasLyrics: boolean;
  hasPlainLyrics: boolean;
  plainLyrics?: string;
  artistName?: string;
  trackName?: string;
  isPlaying: boolean;
  isDark?: boolean;
  style?: StyleProp<ViewStyle>;
  fadeHeight?: number;
  isMismatch?: boolean;
}

interface DisplayItem {
  id: string;
  text: string;
  isHeader: boolean;
  isEmpty: boolean;
}

interface LyricRowProps {
  item: DisplayItem;
  index: number;
  scrollY: SharedValue<number>;
}

/**
 * LyricRow: Continuous Millimeter-Scale & Opacity Interpolation
 * Runs 100% on the native UI thread / GPU via Reanimated worklets.
 *
 * As the user scrolls:
 * - dist = (index * ITEM_HEIGHT) - scrollY
 * - dist <= -ITEM_HEIGHT * 0.5: Opacity 0 (disappears smoothly when past top border)
 * - dist == 0 (Active Focal Row): Scale 0.80, Opacity 1.0 (Maximum brightness, bold and clear)
 * - dist == ITEM_HEIGHT (Row 1 after active): Scale 0.65, Opacity 0.42 (faded down significantly, distinct secondary layer)
 * - dist == ITEM_HEIGHT * 2 (Row 2 after active): Scale 0.52, Opacity 0.10 (very mildly visible, almost invisible)
 * - dist >= ITEM_HEIGHT * 3 (Row 3+ / last set): Scale 0.42, Opacity 0.0 (completely ground hidden / not visible to eyes)
 */
const LyricRow: React.FC<LyricRowProps> = React.memo(({ item, index, scrollY }) => {
  const itemY = index * ITEM_HEIGHT;

  const animatedStyle = useAnimatedStyle(() => {
    // Relative distance in pixels from the top border of the lyrics container
    const dist = itemY - scrollY.value;

    // 1. Opacity / Brightness:
    // - Above top border: fades gracefully to 0.0 only after -20px
    // - At active top border & overshoot zone (dist in [-20, 0]): Solid 1.0 (deadband prevents any dimming/flicker)
    // - Ease-in cushion (dist 0 to 40): smoothly transitions 1.0 -> 0.70 so arrival feels soft and slower
    // - Row 1 after active (dist == ITEM_HEIGHT): 0.42 (significantly reduced brightness)
    // - Row 2 after active (dist == ITEM_HEIGHT * 2): 0.10 (very mildly visible, almost close to invisible)
    // - Row 3+ after active (dist >= ITEM_HEIGHT * 3): 0.0 (ground hidden based on scroll)
    const opacity = interpolate(
      dist,
      [
        -ITEM_HEIGHT * 0.75,
        -20,
        0,
        40,
        ITEM_HEIGHT,
        ITEM_HEIGHT * 1.8,
        ITEM_HEIGHT * 2,
        ITEM_HEIGHT * 2.8,
        ITEM_HEIGHT * 3,
      ],
      [
        0.0,
        1.0,
        1.0,
        0.70,
        0.42,
        0.18,
        0.10,
        0.02,
        0.0,
      ],
      Extrapolation.CLAMP
    );

    // 2. Continuous Millimeter Scale Growth with Ease-In Arrival:
    // - Upcoming rows start at scale 0.42
    // - Smoothly grow: 0.42 -> 0.52 -> 0.65 -> 0.74 (at 40px) -> 0.80 (at 0px)
    // - The gradual growth between 40px and 0px visually cushions the deceleration, making the motion feel calmer and less rushed
    // - For all dist <= 0, scale is PERMANENTLY LOCKED at 0.80 via Extrapolation.CLAMP:
    //   It CANNOT shrink, reduce, or pulse when settling!
    const scale = interpolate(
      dist,
      [0, 40, ITEM_HEIGHT, ITEM_HEIGHT * 2, ITEM_HEIGHT * 3],
      [0.80, 0.74, 0.65, 0.52, 0.42],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ scale }],
    };
  });

  if (item.isHeader) {
    return (
      <Reanimated.View style={[S.headerContainer, animatedStyle]}>
        <Text style={S.headerText}>{item.text}</Text>
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View style={[S.lineContainer, animatedStyle]}>
      <Text style={S.lyricText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
    </Reanimated.View>
  );
});

export const CenterLyricsView: React.FC<CenterLyricsViewProps> = ({
  lines,
  isLoading,
  instrumental,
  hasLyrics,
  hasPlainLyrics,
  plainLyrics,
  artistName,
  style,
  isMismatch = false,
}) => {
  const listRef = useRef<FlatList<DisplayItem>>(null);
  const scrollY = useSharedValue(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // ── Prepare Unified Display Items (Works for both LRCLIB and Genius) ──
  const displayItems: DisplayItem[] = useMemo(() => {
    let items: DisplayItem[] = [];

    if (hasLyrics && lines && lines.length > 0) {
      items = lines
        .map((l, idx) => {
          const trimmed = l.text.trim();
          return {
            id: `synced_${idx}`,
            text: trimmed,
            isHeader: /^\[.*\]$/.test(trimmed),
            isEmpty: false,
          };
        })
        .filter((item) => item.text.length > 0);
    } else if (hasPlainLyrics && plainLyrics) {
      items = plainLyrics
        .split('\n')
        .map((raw, idx) => {
          const trimmed = raw.trim();
          return {
            id: `plain_${idx}`,
            text: trimmed,
            isHeader: /^\[.*\]$/.test(trimmed),
            isEmpty: false,
          };
        })
        .filter((item) => item.text.length > 0);
    }

    if (items.length > 0) {
      const artist = cleanArtistName(artistName);
      if (artist) {
        items.push({ id: 'credit_label', text: 'Song by', isHeader: true, isEmpty: false });
        items.push({ id: 'credit_artist', text: artist, isHeader: false, isEmpty: false });
      }
    }

    return items;
  }, [hasLyrics, lines, hasPlainLyrics, plainLyrics, artistName]);

  // Reset scroll to top whenever a new song arrives
  useEffect(() => {
    scrollY.value = 0;
    targetIndexRef.current = 0;
    if (listRef.current) {
      try {
        listRef.current.scrollToOffset({ offset: 0, animated: false });
      } catch (_) {}
    }
  }, [displayItems, scrollY]);

  // UI thread continuous scroll handler
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // ── "No lyrics" / "Lyrics mismatch" fade-out alert ──
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertMessage, setAlertMessage] = useState('No lyrics found');
  const alertOpacity = useRef(new RNAnimated.Value(0)).current;
  const prevLoadingRef = useRef(isLoading);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (wasLoading && !isLoading && !hasLyrics && !hasPlainLyrics && !instrumental) {
      const msg = isMismatch ? 'Lyrics mismatch — no verified lyrics found' : 'No lyrics found';
      setAlertMessage(msg);
      setAlertVisible(true);
      alertOpacity.setValue(1);
      const timer = setTimeout(() => {
        RNAnimated.timing(alertOpacity, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }).start(() => setAlertVisible(false));
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, hasLyrics, hasPlainLyrics, instrumental, isMismatch]);

  const hasContent = displayItems.length > 0;

  // ── Ultra-low Latency Instant Double-Tap (0ms response on touch down) ──
  const lastTapTimeRef = useRef<number>(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const targetIndexRef = useRef<number>(0);

  const scrollNextLyric = useCallback(() => {
    if (!displayItems || displayItems.length === 0) return;
    const currentOffset = Math.max(0, scrollY.value);
    const currentIndex = Math.round(currentOffset / ITEM_HEIGHT);
    const baseIndex = Math.max(currentIndex, targetIndexRef.current);
    const nextIndex = Math.min(displayItems.length - 1, baseIndex + 1);
    targetIndexRef.current = nextIndex;
    const targetOffset = nextIndex * ITEM_HEIGHT;

    listRef.current?.scrollToOffset({
      offset: targetOffset,
      animated: true,
    });
  }, [displayItems, scrollY]);

  const scrollPrevLyric = useCallback(() => {
    if (!displayItems || displayItems.length === 0) return;
    const currentOffset = Math.max(0, scrollY.value);
    const currentIndex = Math.round(currentOffset / ITEM_HEIGHT);
    const baseIndex = Math.min(currentIndex, targetIndexRef.current);
    const prevIndex = Math.max(0, baseIndex - 1);
    targetIndexRef.current = prevIndex;
    const targetOffset = prevIndex * ITEM_HEIGHT;

    listRef.current?.scrollToOffset({
      offset: targetOffset,
      animated: true,
    });
  }, [displayItems, scrollY]);

  const handleTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      if (!displayItems || displayItems.length === 0) return;
      const now = Date.now();
      const { pageX, pageY } = e.nativeEvent;
      const elapsed = now - lastTapTimeRef.current;
      const distX = Math.abs(pageX - lastTapPosRef.current.x);
      const distY = Math.abs(pageY - lastTapPosRef.current.y);

      // Instant double-tap detected on touch down (0ms latency, no waiting for finger lift!)
      if (elapsed > 35 && elapsed < 380 && distX < 50 && distY < 50) {
        lastTapTimeRef.current = 0; // consume tap
        const screenW = Dimensions.get('window').width;
        // Left 28% triggers previous lyric; center and right triggers next lyric
        if (pageX < screenW * 0.28) {
          scrollPrevLyric();
        } else {
          scrollNextLyric();
        }
      } else {
        lastTapTimeRef.current = now;
        lastTapPosRef.current = { x: pageX, y: pageY };
      }
    },
    [displayItems, scrollNextLyric, scrollPrevLyric]
  );

  const handleTouchEnd = useCallback((e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    const distX = Math.abs(pageX - lastTapPosRef.current.x);
    const distY = Math.abs(pageY - lastTapPosRef.current.y);
    // If user dragged/swiped, cancel pending double-tap
    if (distX > 15 || distY > 15) {
      lastTapTimeRef.current = 0;
    }
  }, []);

  return (
    <View
      style={[{ flex: 1, overflow: 'hidden' }, style]}
      onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
    >
      {isLoading ? null
      : instrumental ? (
        <View style={S.center}>
          <Text style={S.stateText}>♪ Instrumental ♪</Text>
        </View>
      ) : hasContent ? (
        <View
          style={{ flex: 1 }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <AnimatedFlatList
            ref={listRef}
            data={displayItems}
            keyExtractor={(item: DisplayItem) => item.id}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            overScrollMode="never"
            bounces={false}
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              lastTapTimeRef.current = 0;
            }}
            onMomentumScrollEnd={(e: any) => {
              targetIndexRef.current = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
            }}
            onScrollEndDrag={(e: any) => {
              targetIndexRef.current = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
            }}
            getItemLayout={(_: any, index: number) => ({
              length: ITEM_HEIGHT,
              offset: ITEM_HEIGHT * index,
              index,
            })}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            contentContainerStyle={{
              paddingTop: 0,
              paddingBottom: Math.max(450, containerHeight + 200),
              paddingHorizontal: 16,
            }}
            renderItem={({ item, index }: { item: DisplayItem; index: number }) => (
              <LyricRow
                item={item}
                index={index}
                scrollY={scrollY}
              />
            )}
          />
        </View>
      ) : alertVisible ? (
        <View style={S.center}>
          <RNAnimated.Text
            style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: 13,
              fontWeight: '500',
              textAlign: 'center',
              opacity: alertOpacity,
              paddingHorizontal: 20,
            }}
          >
            {alertMessage}
          </RNAnimated.Text>
        </View>
      ) : null}
    </View>
  );
};

const S = {
  center: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  stateText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
  },
  headerContainer: {
    height: ITEM_HEIGHT,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    textAlign: 'center' as const,
  },
  lineContainer: {
    height: ITEM_HEIGHT,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 4,
  },
  lyricText: {
    fontSize: 18.5,
    lineHeight: 23,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    textAlign: 'center' as const,
    includeFontPadding: false,
  },
};

export default CenterLyricsView;
