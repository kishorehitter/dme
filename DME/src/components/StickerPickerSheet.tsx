/**
 * StickerPickerSheet.tsx
 * Bottom sheet for choosing custom Lottie animated stickers.
 *
 * Layout:
 *  - Top Bar: "Stickers" title (left) and Close button (right)
 *  - Middle Content: Grid of small animated Lottie stickers (5 columns, no text titles)
 *  - Bottom Bar: Category quick selectors for sticker packs (❤️, 😄, 👋, 😭)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import LottieView from 'lottie-react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import type { Sticker, StickerPack } from '../stickers/stickerPacks';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_H * 0.45;
const COLUMN_COUNT = 5; // Reduced sticker size by increasing column count
const STICKER_SIZE = (SCREEN_W - 16) / COLUMN_COUNT;

interface Props {
  visible: boolean;
  stickerPacks: StickerPack[];
  onSelectSticker: (sticker: Sticker, packId: string) => void;
  onClose: () => void;
}

// ─── Individual sticker cell ──────────────────────────────────────────────────
const StickerCell = React.memo(
  ({
    sticker,
    packId,
    onSelect,
  }: {
    sticker: Sticker;
    packId: string;
    onSelect: (s: Sticker, packId: string) => void;
  }) => {
    const [loaded, setLoaded] = useState(false);
    const lottieRef = useRef<LottieView>(null);

    const handlePress = useCallback(() => {
      onSelect(sticker, packId);
    }, [sticker, packId, onSelect]);

    return (
      <TouchableOpacity
        style={styles.stickerCell}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <LottieView
          ref={lottieRef}
          source={{ uri: sticker.url }}
          autoPlay
          loop
          style={styles.stickerAnim}
          onAnimationLoaded={() => setLoaded(true)}
          resizeMode="contain"
          renderMode="HARDWARE"
        />
        {!loaded && (
          <View style={StyleSheet.absoluteFill}>
            <ActivityIndicator size="small" color="#4CAF50" />
          </View>
        )}
      </TouchableOpacity>
    );
  },
);

// ─── Main Component ───────────────────────────────────────────────────────────
const StickerPickerSheet: React.FC<Props> = ({
  visible,
  stickerPacks,
  onSelectSticker,
  onClose,
}) => {
  const [activePackId, setActivePackId] = useState<string>(stickerPacks[0]?.id ?? '');

  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Slide in / out
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 200,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_HEIGHT,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, opacityAnim]);

  const activePack = stickerPacks.find(p => p.id === activePackId) ?? stickerPacks[0];

  const renderSticker = useCallback(
    ({ item }: { item: Sticker }) => (
      <StickerCell
        sticker={item}
        packId={activePackId}
        onSelect={onSelectSticker}
      />
    ),
    [activePackId, onSelectSticker],
  );

  if (!visible && slideAnim._value === SHEET_HEIGHT) return null;

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: opacityAnim }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }] },
        ]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        {/* Handle bar */}
        <View style={styles.handleBar} />

        {/* 1. Top Bar Navigation (Title + Close button) */}
        <View style={styles.topHeader}>
          <Text style={styles.headerTitle}>Stickers</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <Icon name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        {/* 2. Grid Area (Main Content Scroll of small Lottie stickers) */}
        <View style={styles.gridContainer}>
          <FlatList
            key={activePackId}
            data={activePack?.stickers ?? []}
            renderItem={renderSticker}
            keyExtractor={item => item.id}
            numColumns={COLUMN_COUNT}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.grid}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={3}
          />
        </View>

        {/* 3. Bottom Category Bar (Selectors at the bottom) */}
        <View style={styles.bottomCategoryBar}>
          {stickerPacks.map(pack => (
            <TouchableOpacity
              key={pack.id}
              style={[
                styles.categoryTab,
                activePackId === pack.id && styles.categoryTabActive,
              ]}
              onPress={() => setActivePackId(pack.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.categoryTabEmoji}>{pack.emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>
    </>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
    zIndex: 90,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  handleBar: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    marginTop: 10,
    marginBottom: 4,
  },

  // 1. Top Header
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerTitle: {
    fontSize: 16,
    color: '#333333',
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },

  // 2. Main Grid Container
  gridContainer: {
    flex: 1,
    paddingBottom: 50, // Space for bottom category bar
  },
  grid: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
  },
  stickerCell: {
    width: STICKER_SIZE,
    height: STICKER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  stickerAnim: {
    width: STICKER_SIZE - 16,
    height: STICKER_SIZE - 16,
  },

  // 3. Bottom Category Bar
  bottomCategoryBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 50,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 8 : 0,
  },
  categoryTab: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  categoryTabActive: {
    backgroundColor: '#E8F5E9', // Soft green background
  },
  categoryTabEmoji: {
    fontSize: 20,
  },
});

export default StickerPickerSheet;
