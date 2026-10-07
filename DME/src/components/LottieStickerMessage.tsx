import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { useTheme } from '../context/ThemeContext';
import { lottiePickerCache } from './StickerPickerSheet';

const STICKER_RENDER_SIZE = 60;
const lottieCache = lottiePickerCache || new Map<string, any>();

export const getEmojiFromUrl = (url: string): string => {
  try {
    const match = url?.match(/latest\/([^/]+)\/lottie\.json/);
    if (match && match[1]) {
      const parts = match[1].split(/[_-]/);
      return String.fromCodePoint(...parts.map(p => parseInt(p, 16)));
    }
  } catch (_) {}
  return '';
};

interface Props {
  url: string;
  onLongPress?: () => void;
  onPress?: () => void;
  size?: number;
  autoPlay?: boolean;
}

const LottieStickerMessage: React.FC<Props> = ({ url, onLongPress, onPress, size, autoPlay = false }) => {
  const { theme } = useTheme();
  const renderSize = size || STICKER_RENDER_SIZE;
  const s = React.useMemo(() => dynamicStyles(theme, renderSize), [theme, renderSize]);
  const lottieRef = useRef<LottieView>(null);
  
  const [animationData, setAnimationData] = useState<any>(lottieCache.get(url) ?? null);
  const [loaded, setLoaded] = useState(lottieCache.has(url));
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fallbackEmoji = React.useMemo(() => getEmojiFromUrl(url), [url]);

  const [isLooping, setIsLooping] = useState(autoPlay);
  const [staticProgress, setStaticProgress] = useState<number | undefined>(autoPlay ? undefined : 0.5);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startThreeLoops = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStaticProgress(undefined);
    setIsLooping(true);
    try {
      lottieRef.current?.reset();
      lottieRef.current?.play();
    } catch (_) {}

    // Exactly 3 loops duration (~3.0s total at normal speed)
    timerRef.current = setTimeout(() => {
      setIsLooping(false);
      // Immediately freeze at mid-progress 0.5 so it is 100% visible and NEVER blank/hidden!
      setStaticProgress(0.5);
      try {
        lottieRef.current?.pause();
      } catch (_) {}
    }, 3000);
  }, []);

  useEffect(() => {
    let active = true;
    if (!url) return;

    if (lottieCache.has(url)) {
      setAnimationData(lottieCache.get(url));
      setLoaded(true);
      if (autoPlay) {
        startThreeLoops();
      }
      return;
    }

    setLoaded(false);
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load JSON');
        return res.json();
      })
      .then(json => {
        if (!active) return;
        lottieCache.set(url, json);
        setAnimationData(json);
        setLoaded(true);
        if (autoPlay) {
          startThreeLoops();
        }
      })
      .catch(err => {
        console.warn('[LottieStickerMessage] Error loading remote JSON:', err);
      });

    return () => {
      active = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [url, autoPlay, startThreeLoops]);

  const handlePress = useCallback(() => {
    if (onPress) onPress();
    startThreeLoops();

    // Bounce micro-interaction
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.22,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [onPress, startThreeLoops, scaleAnim]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={s.wrapper}
    >
      {/* Fallback Emoji is ONLY rendered while Lottie JSON is loading (NEVER double stacked) */}
      {!loaded && fallbackEmoji ? (
        <Text style={{ position: 'absolute', fontSize: renderSize * 0.65, textAlign: 'center' }}>
          {fallbackEmoji}
        </Text>
      ) : null}

      {/* Lottie Sticker */}
      {loaded && animationData && (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <LottieView
            ref={lottieRef}
            source={animationData}
            autoPlay={isLooping}
            loop={isLooping}
            progress={staticProgress}
            style={s.lottie}
            resizeMode="contain"
            renderMode="AUTOMATIC"
            cacheComposition
          />
        </Animated.View>
      )}
    </TouchableOpacity>
  );
};

const dynamicStyles = (theme: any, renderSize: number) => StyleSheet.create({
  wrapper: {
    width: renderSize,
    height: renderSize,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottie: {
    width: renderSize,
    height: renderSize,
  },
  shimmer: {
    position: 'absolute',
    width: renderSize * 0.75,
    height: renderSize * 0.75,
    borderRadius: renderSize * 0.375,
    backgroundColor: theme.inputBackground,
  },
});

export default LottieStickerMessage;
