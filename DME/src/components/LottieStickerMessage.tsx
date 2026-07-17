/**
 * LottieStickerMessage.tsx
 * Renders an animated Lottie sticker inside a chat message bubble.
 * - No bubble background (transparent, like Telegram)
 * - Loops the animation
 * - Shows a loading shimmer while the JSON downloads
 */

import React, { useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import LottieView from 'lottie-react-native';

const STICKER_RENDER_SIZE = 90;

interface Props {
  url: string;
  onLongPress?: () => void;
  onPress?: () => void;
}

const LottieStickerMessage: React.FC<Props> = ({ url, onLongPress, onPress }) => {
  const [loaded, setLoaded] = useState(false);
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(0.6)).current;

  // Pop-in animation when sticker loads
  const handleLoad = () => {
    setLoaded(true);
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 12,
      stiffness: 200,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={styles.wrapper}
    >
      {/* Shimmer placeholder while loading */}
      {!loaded && (
        <View style={styles.shimmer} />
      )}

      {/* Lottie Sticker */}
      <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: loaded ? 1 : 0 }}>
        <LottieView
          source={{ uri: url }}
          autoPlay
          loop
          style={styles.lottie}
          onAnimationLoaded={handleLoad}
          resizeMode="contain"
          renderMode="HARDWARE"
          cacheComposition
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: STICKER_RENDER_SIZE,
    height: STICKER_RENDER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottie: {
    width: STICKER_RENDER_SIZE,
    height: STICKER_RENDER_SIZE,
  },
  shimmer: {
    position: 'absolute',
    width: STICKER_RENDER_SIZE * 0.75,
    height: STICKER_RENDER_SIZE * 0.75,
    borderRadius: STICKER_RENDER_SIZE * 0.375,
    backgroundColor: '#E8E8E8',
  },
});

export default LottieStickerMessage;
