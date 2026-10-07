/**
 * StickerPickerSheet.tsx
 *
 * Performance Architecture:
 *  - Picker shows ONLY emoji characters (native Text) — NO Lottie, NO network fetch
 *    during rendering. A full sticker grid renders in ~0ms cold.
 *
 *  - On tap: SendFlashOverlay fetches & plays the Lottie JSON once at center,
 *    then calls onSelectSticker to actually send. Flash = ~120ms Lottie + fade.
 *
 *  - Sheet slides in/out purely on GPU (single translateY, useNativeDriver: true).
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing as ReanimatedEasing,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Sticker, StickerPack } from '../stickers/stickerPacks';
import { useTheme } from '../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const SHEET_HEIGHT = 286;
const COLUMN_COUNT = 6;
const STICKER_SIZE = (SCREEN_W - 16) / COLUMN_COUNT;
const ROW_HEIGHT = 58;

interface Props {
  visible: boolean;
  stickerPacks: StickerPack[];
  onSelectSticker: (sticker: Sticker, packId: string) => void;
  onClose: () => void;
  sheetHeight?: number;
}

// ─── Shared Lottie cache (exported for LottieStickerMessage) ──────────────────
export const lottiePickerCache = new Map<string, any>();
export const preloadStickers = (_packs: StickerPack[]) => {};

// ─── Pre-extract emojis from sticker names (runs once at module level) ───────
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const _emojiCache = new Map<string, string>();
const getEmoji = (sticker: Sticker): string => {
  if (_emojiCache.has(sticker.id)) return _emojiCache.get(sticker.id)!;
  const m = sticker.name?.match(EMOJI_RE);
  const e = m ? m[0] : (sticker.name?.slice(-2) || '🙂');
  _emojiCache.set(sticker.id, e);
  return e;
};

// ─── Lightweight emoji cell — pure Text, zero network, zero Lottie ────────────
const StickerCell = React.memo(
  ({
    sticker,
    packId,
    onSelect,
    cellSize,
  }: {
    sticker: Sticker;
    packId: string;
    onSelect: (s: Sticker, packId: string) => void;
    cellSize: number;
  }) => {
    const emoji = getEmoji(sticker);
    const handlePress = useCallback(() => {
      onSelect(sticker, packId);
    }, [sticker, packId, onSelect]);

    return (
      <TouchableOpacity
        style={{ width: cellSize, height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'center' }}
        onPress={handlePress}
        activeOpacity={0.4}
      >
        <Text style={{ fontSize: 30, textAlign: 'center' }} allowFontScaling={false}>
          {emoji}
        </Text>
      </TouchableOpacity>
    );
  },
  (prev, next) => prev.sticker.id === next.sticker.id,
);

// ─── Sticker row — 6 emoji cells ─────────────────────────────────────────────
const StickerRow = React.memo(
  ({
    stickers,
    packId,
    onSelect,
    cellSize,
  }: {
    stickers: Sticker[];
    packId: string;
    onSelect: (s: Sticker, packId: string) => void;
    cellSize: number;
  }) => (
    <View style={{ flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'center' }}>
      {stickers.map(stk => (
        <StickerCell key={stk.id} sticker={stk} packId={packId} onSelect={onSelect} cellSize={cellSize} />
      ))}
    </View>
  ),
);

// ─── Pack icon map (pack.id → Icon names) ────────────────────────────────────
const PACK_ICONS: Record<string, { filled: string; outline: string; isMci?: boolean }> = {
  smileys:          { filled: 'happy',         outline: 'happy-outline' },
  hearts:           { filled: 'heart',         outline: 'heart-outline' },
  'party-avatars':  { filled: 'party-popper',  outline: 'party-popper', isMci: true },
  avatars:          { filled: 'party-popper',  outline: 'party-popper', isMci: true },
  people:           { filled: 'hands-pray',    outline: 'hands-pray',   isMci: true },
  party:            { filled: 'sparkles',      outline: 'sparkles-outline' },
  animals:          { filled: 'paw',           outline: 'paw-outline' },
  food:             { filled: 'fast-food',     outline: 'fast-food-outline' },
  activities:       { filled: 'football',      outline: 'football-outline' },
  objects:          { filled: 'bulb',          outline: 'bulb-outline' },
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

  const activeColor   = isDark ? '#FFFFFF' : '#000000';
  const inactiveColor = isDark ? '#9AA0A6' : '#5F6368';

  // ── Reanimated GPU slide in / out (Google Keyboard speed & smooth Material curve) ──
  const translateY = useSharedValue(totalSheetHeight);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: 250,
        easing: ReanimatedEasing.bezier(0.0, 0.0, 0.2, 1),
      });
    } else {
      translateY.value = withTiming(totalSheetHeight, {
        duration: 220,
        easing: ReanimatedEasing.bezier(0.4, 0.0, 1, 1),
      });
    }
  }, [visible, totalSheetHeight, translateY]);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ── Immediate 0ms send on tap (no blocking flash animation) ─────────────────
  const handleSelect = useCallback(
    (sticker: Sticker, packId: string) => {
      onSelectSticker(sticker, packId);
    },
    [onSelectSticker],
  );

  // ── Flatten packs → rows of 6 ────────────────────────────────────────────────
  const { listData, packHeaderIndices } = useMemo(() => {
    const data: Array<{ id: string; packId: string; stickers: Sticker[] }> = [];
    const headerIndices: Record<string, number> = {};

    stickerPacks.forEach(pack => {
      headerIndices[pack.id] = data.length;
      const stickers = pack.stickers || [];
      for (let i = 0; i < stickers.length; i += COLUMN_COUNT) {
        data.push({
          id: `row_${pack.id}_${i}`,
          packId: pack.id,
          stickers: stickers.slice(i, i + COLUMN_COUNT),
        });
      }
    });

    return { listData: data, packHeaderIndices: headerIndices };
  }, [stickerPacks]);

  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSelectTab = useCallback(
    (packId: string) => {
      setActivePackId(packId);
      isProgrammaticScrollRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 350);

      const packIndex = stickerPacks.findIndex(p => p.id === packId);
      if (packIndex >= 0 && tabScrollViewRef.current) {
        tabScrollViewRef.current.scrollTo({ x: Math.max(0, packIndex * 48 - 60), animated: true });
      }

      const index = packHeaderIndices[packId];
      if (index !== undefined && flatListRef.current) {
        flatListRef.current.scrollToOffset({ offset: index * ROW_HEIGHT, animated: false });
      }
    },
    [packHeaderIndices, stickerPacks],
  );

  const activePackIdRef = useRef(activePackId);
  activePackIdRef.current = activePackId;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (isProgrammaticScrollRef.current) return;
    const firstVisible = viewableItems?.[0]?.item;
    if (firstVisible?.packId && firstVisible.packId !== activePackIdRef.current) {
      setActivePackId(firstVisible.packId);
      const packIdx = stickerPacks.findIndex(p => p.id === firstVisible.packId);
      if (packIdx >= 0 && tabScrollViewRef.current) {
        tabScrollViewRef.current.scrollTo({ x: Math.max(0, packIdx * 48 - 60), animated: true });
      }
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  const cellSize = STICKER_SIZE;

  const renderListItem = useCallback(
    ({ item }: { item: (typeof listData)[number] }) => (
      <StickerRow
        stickers={item.stickers}
        packId={item.packId}
        onSelect={handleSelect}
        cellSize={cellSize}
      />
    ),
    [handleSelect, cellSize],
  );

  return (
    <Reanimated.View
      style={[styles.sheet, animatedSheetStyle]}
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
              style={[styles.categoryTab, activePackId === pack.id && styles.categoryTabActive]}
              onPress={() => handleSelectTab(pack.id)}
              activeOpacity={0.7}
            >
              {PACK_ICONS[pack.id]?.isMci ? (
                <MaterialCommunityIcon
                  name={PACK_ICONS[pack.id]?.filled ?? 'hands-pray'}
                  size={21}
                  color={activePackId === pack.id ? activeColor : inactiveColor}
                />
              ) : (
                <Icon
                  name={
                    activePackId === pack.id
                      ? PACK_ICONS[pack.id]?.filled ?? 'apps'
                      : PACK_ICONS[pack.id]?.outline ?? 'apps-outline'
                  }
                  size={20}
                  color={activePackId === pack.id ? activeColor : inactiveColor}
                />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 2. Emoji-only grid — pure Text, no Lottie, no network calls */}
      <View style={styles.gridContainer}>
        <FlatList
          ref={flatListRef}
          data={listData}
          renderItem={renderListItem}
          keyExtractor={item => item.id}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.grid, { paddingBottom: safeBottom + 8 }]}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={4}
          removeClippedSubviews={Platform.OS === 'android'}
          onScrollBeginDrag={() => { isProgrammaticScrollRef.current = false; }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollToIndexFailed={info => {
            flatListRef.current?.scrollToOffset({ offset: ROW_HEIGHT * info.index, animated: false });
          }}
        />
      </View>
    </Reanimated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const dynamicStyles = (
  theme: import('../utils/theme').ThemeColors,
  isDark: boolean,
  safeBottom: number,
  baseHeight: number = SHEET_HEIGHT,
) => {
  const gboardBg   = isDark ? '#202124' : '#F1F3F4';
  const borderClr  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const activeTabClr = isDark ? '#FFFFFF' : '#000000';

  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: baseHeight,
      paddingBottom: safeBottom,
      backgroundColor: gboardBg,
      zIndex: 100,
      elevation: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
    },
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
    gridContainer: { flex: 1 },
    grid: { paddingHorizontal: 4, paddingTop: 0 },
  });
};

export default StickerPickerSheet;
