/**
 * StickerPickerSheet.tsx
 * Bottom sheet for choosing custom Lottie animated stickers.
 *
 * Features:
 *  - Matches Google Keyboard / Gboard layout and height exactly.
 *  - Continuous vertical back-to-back scrolling across all category packs.
 *  - Category tab bar at top with auto-sync on scroll and smooth tap-to-scroll.
 *  - Safe bottom padding for translucent Android navigation bar.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
  Easing,
} from 'react-native';
import LottieView from 'lottie-react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Sticker, StickerPack } from '../stickers/stickerPacks';
import { useTheme } from '../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const SHEET_HEIGHT = 286; // Reduced by 6px to match Google Keyboard height exactly
const COLUMN_COUNT = 6;
const STICKER_SIZE = (SCREEN_W - 16) / COLUMN_COUNT;

interface Props {
  visible: boolean;
  stickerPacks: StickerPack[];
  onSelectSticker: (sticker: Sticker, packId: string) => void;
  onClose: () => void;
  sheetHeight?: number;
}

// ─── Shared fetch cache (avoids duplicate network requests across all cells) ───
export const lottiePickerCache = new Map<string, any>();
let isPreloadingStarted = false;

export const preloadStickers = (packs: StickerPack[]) => {
  if (!packs || isPreloadingStarted || !packs[0]?.stickers) return;
  isPreloadingStarted = true;
  // Preload only the first 12 stickers of the first pack to avoid choking the JS thread
  const initialStickers = packs[0].stickers.slice(0, 12);
  initialStickers.forEach(sticker => {
    if (!sticker.url || lottiePickerCache.has(sticker.url)) return;
    fetch(sticker.url)
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (json) {
          lottiePickerCache.set(sticker.url, json);
        }
      })
      .catch(() => {});
  });
};

const ROW_HEIGHT = 58; // 52px cell height + 6px marginVertical (3px top + 3px bottom)

// ─── Individual sticker row ───────────────────────────────────────────────────
const StickerRow = React.memo(
  ({
    stickers,
    packId,
    onSelect,
    styles,
  }: {
    stickers: Sticker[];
    packId: string;
    onSelect: (s: Sticker, packId: string) => void;
    styles: ReturnType<typeof dynamicStyles>;
  }) => (
    <View style={styles.stickerRow}>
      {stickers.map(stk => (
        <StickerCell
          key={stk.id}
          sticker={stk}
          packId={packId}
          onSelect={onSelect}
          styles={styles}
        />
      ))}
    </View>
  ),
);

// ─── Individual sticker cell ──────────────────────────────────────────────────
const StickerCell = React.memo(
  ({
    sticker,
    packId,
    onSelect,
    styles,
  }: {
    sticker: Sticker;
    packId: string;
    onSelect: (s: Sticker, packId: string) => void;
    styles: ReturnType<typeof dynamicStyles>;
  }) => {
    const cachedData = lottiePickerCache.get(sticker.url);
    const [animationData, setAnimationData] = useState<any>(cachedData ?? null);
    const [loaded, setLoaded] = useState(!!cachedData);

    useEffect(() => {
      if (!sticker.url) return;
      const existing = lottiePickerCache.get(sticker.url);
      if (existing) {
        if (!animationData) {
          setAnimationData(existing);
          setLoaded(true);
        }
        return;
      }
      let active = true;
      fetch(sticker.url)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(json => {
          if (!active) return;
          lottiePickerCache.set(sticker.url, json);
          setAnimationData(json);
          setLoaded(true);
        })
        .catch(err =>
          console.warn('[StickerPicker] Failed to load:', sticker.url, err),
        );
      return () => { active = false; };
    }, [sticker.url, animationData]);

    const handlePress = useCallback(() => {
      onSelect(sticker, packId);
    }, [sticker, packId, onSelect]);

    const emojiMatch = sticker.name
      ? sticker.name.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u)?.[0] || ''
      : '';

    return (
      <TouchableOpacity
        style={styles.stickerCell}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        {/* Native Emoji is always rendered cleanly so cells are NEVER blank */}
        {emojiMatch ? (
          <Text style={{ fontSize: 28, position: 'absolute', textAlign: 'center' }}>
            {emojiMatch}
          </Text>
        ) : null}

        {loaded && animationData ? (
          <LottieView
            source={animationData}
            autoPlay={false}
            progress={0.5}
            style={styles.stickerAnim}
            resizeMode="contain"
          />
        ) : (
          !emojiMatch && (
            <View style={StyleSheet.absoluteFill}>
              <ActivityIndicator size="small" color="#4CAF50" />
            </View>
          )
        )}
      </TouchableOpacity>
    );
  },
);

// ─── Pack icon map (pack.id → Ionicons names) ────────────────────────────────
const PACK_ICONS: Record<string, { filled: string; outline: string }> = {
  party:      { filled: 'star',          outline: 'star-outline' },
  hearts:     { filled: 'heart',         outline: 'heart-outline' },
  smileys:    { filled: 'happy',         outline: 'happy-outline' },
  people:     { filled: 'people',        outline: 'people-outline' },
  animals:    { filled: 'paw',           outline: 'paw-outline' },
  food:       { filled: 'fast-food',     outline: 'fast-food-outline' },
  activities: { filled: 'football',      outline: 'football-outline' },
  objects:    { filled: 'bulb',          outline: 'bulb-outline' },
};

// ─── Main Component ───────────────────────────────────────────────────────────
const StickerPickerSheet: React.FC<Props> = ({
  visible,
  stickerPacks,
  onSelectSticker,
  onClose,
  sheetHeight = SHEET_HEIGHT,
}) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16);
  const totalSheetHeight = sheetHeight + (insets.bottom > 0 ? insets.bottom : 0);
  const styles = useMemo(() => dynamicStyles(theme, isDark, safeBottom, totalSheetHeight), [theme, isDark, safeBottom, totalSheetHeight]);
  
  const [activePackId, setActivePackId] = useState<string>(stickerPacks[0]?.id ?? '');
  const flatListRef = useRef<FlatList>(null);
  const tabScrollViewRef = useRef<ScrollView>(null);

  const activeColor = isDark ? '#8AB4F8' : '#1A73E8';
  const inactiveColor = isDark ? '#9AA0A6' : '#5F6368';

  const slideAnim = useRef(new Animated.Value(totalSheetHeight)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    preloadStickers(stickerPacks);
  }, [stickerPacks]);

  // Slide in / out (Snappy 120ms curve)
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: totalSheetHeight,
          duration: 100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 80,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, opacityAnim, totalSheetHeight]);
  // ─── Flatten data into continuous list items (Rows of 6) ─────────────────────
  const { listData, packHeaderIndices } = useMemo(() => {
    const data: Array<{
      id: string;
      type: 'row';
      packId: string;
      stickers: Sticker[];
    }> = [];
    const headerIndices: Record<string, number> = {};

    stickerPacks.forEach(pack => {
      headerIndices[pack.id] = data.length;

      const stickers = pack.stickers || [];
      for (let i = 0; i < stickers.length; i += COLUMN_COUNT) {
        const rowStickers = stickers.slice(i, i + COLUMN_COUNT);
        data.push({
          id: `row_${pack.id}_${i}`,
          type: 'row',
          packId: pack.id,
          stickers: rowStickers,
        });
      }
    });

    return { listData: data, packHeaderIndices: headerIndices };
  }, [stickerPacks]);

  // ─── Scroll to Category Header on Tab Press ──────────────────────────────────
  const handleSelectTab = useCallback(
    (packId: string) => {
      setActivePackId(packId);
      const index = packHeaderIndices[packId];
      if (index !== undefined && flatListRef.current) {
        flatListRef.current.scrollToOffset({
          offset: index * ROW_HEIGHT,
          animated: true,
        });
      }
    },
    [packHeaderIndices],
  );

  const activePackIdRef = useRef(activePackId);
  activePackIdRef.current = activePackId;

  // ─── Viewability Config for Auto Tab Syncing on Scroll ─────────────────────
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      const firstVisible = viewableItems[0]?.item;
      if (firstVisible && firstVisible.packId && firstVisible.packId !== activePackIdRef.current) {
        setActivePackId(firstVisible.packId);
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 20,
  }).current;

  const renderListItem = useCallback(
    ({ item }: { item: (typeof listData)[number] }) => (
      <StickerRow
        stickers={item.stickers}
        packId={item.packId}
        onSelect={onSelectSticker}
        styles={styles}
      />
    ),
    [onSelectSticker, styles],
  );

  return (
    <Animated.View
      style={[
        styles.sheet,
        { transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* 1. Category tabs row */}
      <View style={styles.tabRow}>
          <ScrollView
            ref={tabScrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
          >
            {stickerPacks.map(pack => (
              <TouchableOpacity
                key={pack.id}
                style={[
                  styles.categoryTab,
                  activePackId === pack.id && styles.categoryTabActive,
                ]}
                onPress={() => handleSelectTab(pack.id)}
                activeOpacity={0.7}
              >
                <Icon
                  name={
                    activePackId === pack.id
                      ? PACK_ICONS[pack.id]?.filled ?? 'apps'
                      : PACK_ICONS[pack.id]?.outline ?? 'apps-outline'
                  }
                  size={20}
                  color={activePackId === pack.id ? activeColor : inactiveColor}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 2. Continuous Back-to-Back Grid List */}
        <View style={styles.gridContainer}>
          <FlatList
            ref={flatListRef}
            data={listData}
            renderItem={renderListItem}
            keyExtractor={item => item.id}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.grid, { paddingBottom: safeBottom + 8 }]}
            initialNumToRender={5}
            maxToRenderPerBatch={6}
            windowSize={3}
            removeClippedSubviews={Platform.OS === 'android'}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScrollToIndexFailed={info => {
              flatListRef.current?.scrollToOffset({
                offset: ROW_HEIGHT * info.index,
                animated: true,
              });
            }}
          />
        </View>
      </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const dynamicStyles = (
  theme: import('../utils/theme').ThemeColors,
  isDark: boolean,
  safeBottom: number,
  baseHeight: number = SHEET_HEIGHT,
) => {
  const gboardBg = isDark ? '#202124' : '#F1F3F4';
  const borderClr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const activeTabClr = isDark ? '#8AB4F8' : '#1A73E8';
  const sectionTextClr = isDark ? '#9AA0A6' : '#5F6368';

  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: baseHeight,
      paddingBottom: safeBottom,
      backgroundColor: gboardBg,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      zIndex: 100,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 16,
    },
    // 1. Category tabs row
    tabRow: {
      borderBottomWidth: 1,
      borderBottomColor: borderClr,
      paddingTop: 2,
    },
    categoryScroll: {
      paddingHorizontal: 4,
      alignItems: 'center',
      flexDirection: 'row',
    },
    categoryTab: {
      width: 44,
      height: 38,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
      marginHorizontal: 2,
      borderBottomWidth: 2.5,
      borderBottomColor: 'transparent',
    },
    categoryTabActive: {
      borderBottomColor: activeTabClr,
    },

    // 2. Main Grid Container
    gridContainer: {
      flex: 1,
    },
    grid: {
      paddingHorizontal: 4,
      paddingTop: 0,
    },
    stickerRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      alignItems: 'center',
      height: ROW_HEIGHT,
      margin: 0,
      padding: 0,
    },
    stickerCell: {
      width: STICKER_SIZE,
      height: ROW_HEIGHT,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 0,
      margin: 0,
    },
    stickerAnim: {
      width: STICKER_SIZE - 10,
      height: 48,
    },
  });
};

export default StickerPickerSheet;
