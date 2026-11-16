import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  StyleSheet,
  Dimensions,
  LayoutChangeEvent,
  GestureResponderEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

export const QUICK_REACTIONS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', 
  '🖤', '🤍', '🤎', '😂', '😍', '😮', 
  '😢', '😡', '👍', '👎', '🎉', '🔥', 
  '✨', '💯', '🙏', '👏', '😎', '🤔',
];

const NUM_PAGES = Math.ceil(QUICK_REACTIONS.length / 6); // 4

export interface QuickReactionPickerProps {
  selectedEmoji: string;
  onSelectEmoji: (emoji: string) => void;
}

export const QuickReactionPicker: React.FC<QuickReactionPickerProps> = React.memo(({
  selectedEmoji,
  onSelectEmoji,
}) => {
  const { theme, isDark } = useTheme();
  const s = useMemo(() => dynamicStyles(theme, isDark), [theme, isDark]);

  const [containerWidth, setContainerWidth] = useState(() => {
    const win = Dimensions.get('window').width;
    return Math.max(240, win - 64);
  });

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const hasScrolledToInitial = useRef(false);

  const itemWidth = useMemo(() => {
    return containerWidth > 0 ? containerWidth / 6 : 50;
  }, [containerWidth]);

  const thumbWidth = useMemo(() => {
    return containerWidth > 0 ? containerWidth / NUM_PAGES : 60;
  }, [containerWidth]);

  const maxScroll = useMemo(() => {
    return Math.max(1, containerWidth * (NUM_PAGES - 1));
  }, [containerWidth]);

  const maxThumbTranslate = useMemo(() => {
    return Math.max(0, containerWidth - thumbWidth);
  }, [containerWidth, thumbWidth]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - containerWidth) > 1) {
      setContainerWidth(w);
    }
  }, [containerWidth]);

  // Regular function to handle scroll without "object is not a function" error
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollX.setValue(x);
  }, [scrollX]);

  // Scroll to active emoji set on mount
  useEffect(() => {
    if (containerWidth > 0 && !hasScrolledToInitial.current) {
      const idx = QUICK_REACTIONS.indexOf(selectedEmoji);
      if (idx >= 0) {
        const pageIndex = Math.floor(idx / 6);
        hasScrolledToInitial.current = true;
        if (pageIndex > 0) {
          setTimeout(() => {
            scrollViewRef.current?.scrollTo({
              x: pageIndex * containerWidth,
              animated: false,
            });
          }, 80);
        }
      }
    }
  }, [containerWidth, selectedEmoji]);

  const thumbTranslateX = useMemo(() => {
    return scrollX.interpolate({
      inputRange: [0, maxScroll],
      outputRange: [0, maxThumbTranslate],
      extrapolate: 'clamp',
    });
  }, [maxScroll, maxThumbTranslate, scrollX]);

  const handleTrackPress = useCallback((e: GestureResponderEvent) => {
    if (containerWidth <= 0) return;
    const clickX = e.nativeEvent.locationX;
    const page = Math.min(NUM_PAGES - 1, Math.max(0, Math.floor((clickX / containerWidth) * NUM_PAGES)));
    scrollViewRef.current?.scrollTo({
      x: page * containerWidth,
      animated: true,
    });
  }, [containerWidth]);

  return (
    <View style={s.container} onLayout={onLayout}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        snapToInterval={containerWidth}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
      >
        {QUICK_REACTIONS.map((emoji) => {
          const isActive = selectedEmoji === emoji;
          return (
            <View key={emoji} style={[s.itemWrapper, { width: itemWidth }]}>
              <TouchableOpacity
                style={[s.emojiItem, isActive && s.emojiItemActive]}
                onPress={() => onSelectEmoji(emoji)}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              >
                <Text style={[s.emojiText, isActive && s.emojiTextActive]}>{emoji}</Text>
                {isActive && (
                  <View style={s.checkBadge}>
                    <Icon name="checkmark" size={8} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Full Length Sleek Scrollbar Indicator */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleTrackPress}
        style={s.scrollbarTrack}
      >
        <Animated.View
          style={[
            s.scrollbarThumb,
            {
              width: thumbWidth,
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </TouchableOpacity>
    </View>
  );
});

const dynamicStyles = (theme: import('../utils/theme').ThemeColors, isDark = false) => StyleSheet.create({
  container: {
    width: '100%',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.025)',
    overflow: 'hidden',
    marginTop: 4,
  },
  scrollContent: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 8,
  },
  itemWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiItem: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  emojiItemActive: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
    transform: [{ scale: 1.12 }],
  },
  emojiText: {
    fontSize: 22,
  },
  emojiTextActive: {
    fontSize: 22,
  },
  checkBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: isDark ? '#1F2937' : '#FFFFFF',
    elevation: 2,
  },
  scrollbarTrack: {
    width: '100%',
    height: 3,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
    overflow: 'hidden',
  },
  scrollbarThumb: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: isDark ? '#6B7280' : '#9CA3AF',
  },
});
