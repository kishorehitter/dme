import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated as RNAnimated,
  StyleProp,
  ViewStyle,
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

const AnimatedFlatList = Reanimated.createAnimatedComponent(
  FlatList as new () => FlatList<DisplayItem>
);

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
 * - dist <= -ITEM_HEIGHT * 0.5: Opacity 0 (it alone disappears the moment it passes the top border)
 * - dist == 0 (Top Active Focal Row): Scale 0.80, Opacity 1.0 (Maximum brightness, 100% pure white)
 * - dist == ITEM_HEIGHT (Row 1): Scale 0.68, Opacity 0.75
 * - dist == ITEM_HEIGHT * 2 (Row 2): Scale 0.56, Opacity 0.50
 * - dist == ITEM_HEIGHT * 3 (Row 3): Scale 0.46, Opacity 0.25
 * - dist >= ITEM_HEIGHT * 4 (Row 4+): Scale 0.40, Opacity 0.0 (Clean empty space below)
 *
 * Scale grows continuously: 0.40 -> 0.41 -> 0.42 -> 0.43 ... -> 0.80
 * with every single millimeter of finger scroll!
 */
const LyricRow: React.FC<LyricRowProps> = React.memo(({ item, index, scrollY }) => {
  const itemY = index * ITEM_HEIGHT;

  const animatedStyle = useAnimatedStyle(() => {
    // Relative distance in pixels from the top border of the lyrics container
    const dist = itemY - scrollY.value;

    // 1. Opacity / Brightness:
    // - Above top border: fades rapidly to 0.0 so it alone disappears
    // - At top border: 1.0 (100% pure white)
    // - Progressively decreases down through Row 1, Row 2, Row 3
    // - Row 4+ (dist >= ITEM_HEIGHT * 4): 0.0 (clean space below)
    const opacity = interpolate(
      dist,
      [-ITEM_HEIGHT * 0.5, -4, 0, ITEM_HEIGHT, ITEM_HEIGHT * 2, ITEM_HEIGHT * 3, ITEM_HEIGHT * 4],
      [0.0, 0.2, 1.0, 0.80, 0.55, 0.25, 0.0],
      Extrapolation.CLAMP
    );

    // 2. Continuous Millimeter Scale Growth:
    // - Bottom / Upcoming rows start at scale 0.40
    // - As they scroll up toward the top, they smoothly grow: 0.40 -> 0.41 -> 0.42 ... -> 0.80
    // - Active line reaches the maximum scale limit: 0.80
    const scale = interpolate(
      dist,
      [-ITEM_HEIGHT * 0.5, 0, ITEM_HEIGHT, ITEM_HEIGHT * 2, ITEM_HEIGHT * 3, ITEM_HEIGHT * 4],
      [0.70, 0.80, 0.68, 0.56, 0.46, 0.40],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ scale }],
    };
  });

  if (item.isHeader) {
    const isCredit = item.id === 'credit_label';
    return (
      <Reanimated.View
        style={[
          S.headerContainer,
          isCredit && { marginTop: 20 },
          animatedStyle,
        ]}
      >
        <Text style={S.headerText}>{item.text}</Text>
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View style={[S.lineContainer, animatedStyle]}>
      <Text style={S.lyricText}>{item.text}</Text>
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
        <AnimatedFlatList
          ref={listRef}
          data={displayItems}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          getItemLayout={(_, index) => ({
            length: ITEM_HEIGHT,
            offset: ITEM_HEIGHT * index,
            index,
          })}
          contentContainerStyle={{
            paddingTop: 0,
            paddingBottom: Math.max(450, containerHeight + 200),
            paddingHorizontal: 16,
          }}
          renderItem={({ item, index }) => (
            <LyricRow item={item} index={index} scrollY={scrollY} />
          )}
        />
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
    minHeight: ITEM_HEIGHT,
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
