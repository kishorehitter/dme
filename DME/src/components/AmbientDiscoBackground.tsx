import React, { useEffect, memo } from 'react';
import { StyleSheet, View, Dimensions, Platform, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export type RoomTheme = 'cinema' | 'rave' | 'dark'; // | 'light';

interface AmbientDiscoBackgroundProps {
  isPlaying?: boolean;
  isMinimized?: boolean;
  fullscreen?: boolean;
  videoId?: string;
  thumbnail?: string;
  theme?: RoomTheme;
}

// 2.2x canvas size for generous visible motion range
const CANVAS_SIZE = Math.round(Math.max(SCREEN_WIDTH, SCREEN_HEIGHT) * 2.2);

// ── 1. CINEMA VIP THEME: Electric Aqua & Jelly Ocean ──
const SWIRL_SPECTRUM_1 = [
  'rgba(0, 242, 254, 0.85)',   // Electric Aqua (#00F2FE)
  'rgba(0, 119, 255, 0.72)',   // Jelly Royal Blue (#0077FF)
  'rgba(2, 40, 80, 0.82)',     // Deep Oceanic Abyss (#022850)
  'rgba(56, 189, 248, 0.80)',  // Radiant Ice Sky Cyan (#38BDF8)
  'rgba(0, 242, 254, 0.85)',   // Loop
];

const SWIRL_SPECTRUM_2 = [
  'rgba(0, 194, 255, 0.78)',   // Vivid Jelly Cyan (#00C2FF)
  'rgba(125, 249, 255, 0.68)', // Shimmering Crystalline Aqua (#7DF9FF)
  'rgba(3, 25, 52, 0.85)',     // Midnight Abyssal Indigo (#031934)
  'rgba(14, 165, 233, 0.75)',  // Deep Azure Ribbon (#0EA5E9)
  'rgba(0, 194, 255, 0.78)',   // Loop
];

const SWIRL_SPECTRUM_3 = [
  'rgba(186, 250, 255, 0.80)', // Brilliant Aqua-White Diamond Highlight (#BAFAFF)
  'transparent',
  'rgba(0, 242, 254, 0.72)',   // Electric Aqua Flare (#00F2FE)
  'transparent',
];

const STOPS_MAIN = [0, 0.28, 0.50, 0.78, 1.0];
const STOPS_DIAG = [0, 0.35, 0.65, 1.0];

const AmbientDiscoBackground: React.FC<AmbientDiscoBackgroundProps> = ({
  isPlaying = false,
  isMinimized = false,
  fullscreen = false,
  thumbnail,
  theme = 'cinema',
}) => {
  // ── Swirl Layer 1: Clockwise Fast Swirl ──
  const rot1 = useSharedValue(0);
  const driftX1 = useSharedValue(0);
  const driftY1 = useSharedValue(0);
  const scaleX1 = useSharedValue(1);
  const scaleY1 = useSharedValue(1);

  // ── Swirl Layer 2: Counter-Clockwise Swirl ──
  const rot2 = useSharedValue(0);
  const driftX2 = useSharedValue(0);
  const driftY2 = useSharedValue(0);
  const scaleX2 = useSharedValue(1);
  const scaleY2 = useSharedValue(1);

  // ── Swirl Layer 3: Dynamic Cross-Wave Fluid Sweep ──
  const rot3 = useSharedValue(45);
  const driftX3 = useSharedValue(0);
  const driftY3 = useSharedValue(0);
  const scale3 = useSharedValue(1);

  const masterOpacity = useSharedValue(0.90);

  useEffect(() => {
    if (isMinimized || fullscreen || theme === 'dark' /* || (theme as any) === 'light' */) {
      cancelAnimation(rot1); cancelAnimation(driftX1); cancelAnimation(driftY1); cancelAnimation(scaleX1); cancelAnimation(scaleY1);
      cancelAnimation(rot2); cancelAnimation(driftX2); cancelAnimation(driftY2); cancelAnimation(scaleX2); cancelAnimation(scaleY2);
      cancelAnimation(rot3); cancelAnimation(driftX3); cancelAnimation(driftY3); cancelAnimation(scale3);
      return;
    }

    const sinEasing = Easing.inOut(Easing.sin);
    const linearEasing = Easing.linear;

    // ── Visibly active 360° rotations (9.5s - 15s periods for clear visible liquid swirling) ──
    rot1.value = withRepeat(withTiming(360, { duration: 9500, easing: linearEasing }), -1, false);
    rot2.value = withRepeat(withTiming(-360, { duration: 12000, easing: linearEasing }), -1, false);
    rot3.value = withRepeat(withTiming(360, { duration: 15000, easing: linearEasing }), -1, false);

    // ── Layer 1 Fluid Wave Drift & Morphing ──
    driftX1.value = withRepeat(
      withSequence(
        withTiming(SCREEN_WIDTH * 0.38, { duration: 4200, easing: sinEasing }),
        withTiming(-SCREEN_WIDTH * 0.32, { duration: 4800, easing: sinEasing }),
        withTiming(0, { duration: 3800, easing: sinEasing })
      ), -1, true
    );
    driftY1.value = withRepeat(
      withSequence(
        withTiming(SCREEN_HEIGHT * 0.22, { duration: 4500, easing: sinEasing }),
        withTiming(-SCREEN_HEIGHT * 0.25, { duration: 5200, easing: sinEasing }),
        withTiming(0, { duration: 4000, easing: sinEasing })
      ), -1, true
    );
    scaleX1.value = withRepeat(
      withSequence(
        withTiming(1.30, { duration: 3600, easing: sinEasing }),
        withTiming(0.85, { duration: 4200, easing: sinEasing })
      ), -1, true
    );
    scaleY1.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 3800, easing: sinEasing }),
        withTiming(1.28, { duration: 3400, easing: sinEasing })
      ), -1, true
    );

    // ── Layer 2 Fluid Wave Drift & Morphing ──
    driftX2.value = withRepeat(
      withSequence(
        withTiming(-SCREEN_WIDTH * 0.35, { duration: 4600, easing: sinEasing }),
        withTiming(SCREEN_WIDTH * 0.32, { duration: 5400, easing: sinEasing }),
        withTiming(0, { duration: 4200, easing: sinEasing })
      ), -1, true
    );
    driftY2.value = withRepeat(
      withSequence(
        withTiming(-SCREEN_HEIGHT * 0.24, { duration: 5000, easing: sinEasing }),
        withTiming(SCREEN_HEIGHT * 0.22, { duration: 4400, easing: sinEasing }),
        withTiming(0, { duration: 4600, easing: sinEasing })
      ), -1, true
    );
    scaleX2.value = withRepeat(
      withSequence(
        withTiming(0.88, { duration: 3500, easing: sinEasing }),
        withTiming(1.32, { duration: 3900, easing: sinEasing })
      ), -1, true
    );
    scaleY2.value = withRepeat(
      withSequence(
        withTiming(1.28, { duration: 3600, easing: sinEasing }),
        withTiming(0.86, { duration: 4200, easing: sinEasing })
      ), -1, true
    );

    // ── Layer 3 Dynamic Cross-Wave Fluid Sweep ──
    driftX3.value = withRepeat(
      withSequence(
        withTiming(SCREEN_WIDTH * 0.28, { duration: 5000, easing: sinEasing }),
        withTiming(-SCREEN_WIDTH * 0.28, { duration: 4600, easing: sinEasing }),
        withTiming(0, { duration: 4800, easing: sinEasing })
      ), -1, true
    );
    driftY3.value = withRepeat(
      withSequence(
        withTiming(-SCREEN_HEIGHT * 0.20, { duration: 4800, easing: sinEasing }),
        withTiming(SCREEN_HEIGHT * 0.22, { duration: 5400, easing: sinEasing }),
        withTiming(0, { duration: 4400, easing: sinEasing })
      ), -1, true
    );
    scale3.value = withRepeat(
      withSequence(
        withTiming(1.25, { duration: 4000, easing: sinEasing }),
        withTiming(0.92, { duration: 4500, easing: sinEasing })
      ), -1, true
    );

    return () => {
      cancelAnimation(rot1); cancelAnimation(driftX1); cancelAnimation(driftY1); cancelAnimation(scaleX1); cancelAnimation(scaleY1);
      cancelAnimation(rot2); cancelAnimation(driftX2); cancelAnimation(driftY2); cancelAnimation(scaleX2); cancelAnimation(scaleY2);
      cancelAnimation(rot3); cancelAnimation(driftX3); cancelAnimation(driftY3); cancelAnimation(scale3);
    };
  }, [isMinimized, fullscreen, theme]);

  // Subtle rhythm breathing when music is playing
  useEffect(() => {
    if (isPlaying) {
      masterOpacity.value = withTiming(0.98, { duration: 500 });
    } else {
      masterOpacity.value = withTiming(0.72, { duration: 700 });
    }
  }, [isPlaying]);

  const style1 = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftX1.value },
      { translateY: driftY1.value },
      { rotate: `${rot1.value}deg` },
      { scaleX: scaleX1.value },
      { scaleY: scaleY1.value },
    ],
    opacity: masterOpacity.value,
  }));

  const style2 = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftX2.value },
      { translateY: driftY2.value },
      { rotate: `${rot2.value}deg` },
      { scaleX: scaleX2.value },
      { scaleY: scaleY2.value },
    ],
    opacity: masterOpacity.value * 0.92,
  }));

  const style3 = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftX3.value },
      { translateY: driftY3.value },
      { rotate: `${rot3.value}deg` },
      { scale: scale3.value },
    ],
    opacity: masterOpacity.value * 0.85,
  }));

  if (fullscreen) {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]} />;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME 1: PITCH DARK MODE (Pure Minimalist OLED Black)
  // ═══════════════════════════════════════════════════════════════════════════
  if (theme === 'dark') {
    return (
      <View style={styles.container} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]} />
        <LinearGradient
          colors={['#08080C', '#000000', '#050508']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME 2: LIGHT MODE (Pure Solid Crisp White) - COMMENTED OUT
  // ═══════════════════════════════════════════════════════════════════════════
  /*
  if ((theme as any) === 'light') {
    return (
      <View style={styles.container} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#ffffff' }]} />
      </View>
    );
  }
  */

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME 3: RAVE LIVE BLEED (100% Transparent, Video Bleed Illuminates Room)
  // ═══════════════════════════════════════════════════════════════════════════
  if (theme === 'rave') {
    return (
      <View style={styles.container} pointerEvents="none">
        {/* Subtle vignette for header & chat input legibility without dimming live bleed */}
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0.12)', // Subtle top tint for status bar/header icon contrast
            'rgba(0, 0, 0, 0.00)', // Completely clear - live bleed shines bright edge to edge!
            'rgba(0, 0, 0, 0.00)', // Completely clear center
            'rgba(0, 0, 0, 0.25)', // Minimal feather at very bottom for chat input legibility
          ]}
          locations={[0, 0.15, 0.75, 1.0]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME 4: CINEMA VIP (Midnight Obsidian & Molten Imperial Gold - Option 1)
  // ═══════════════════════════════════════════════════════════════════════════
  const blendStyle = Platform.OS === 'ios' ? { mixBlendMode: 'screen' as const } : {};

  return (
    <View style={styles.container} pointerEvents="none">
      {/* ── 1. ACTIVE UNDERLYING SWIRLING MOLTEN GOLD LIGHT ── */}
      {/* Layer A: Clockwise Swirling Molten Gold Surface */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style1]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_1}
          locations={STOPS_MAIN}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* Layer B: Counter-Clockwise Swirling Warm Bronze & Amber Surface */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style2]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_2}
          locations={STOPS_MAIN}
          start={{ x: 0.9, y: 0.1 }}
          end={{ x: 0.1, y: 0.9 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* Layer C: Brilliant 24k Gold Highlight Current */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style3]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_3}
          locations={STOPS_DIAG}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* ── 2. DEEP OCEAN VELVET OVERLAY (Aqua & Jelly Blue VIP Cinema) ── */}
      <LinearGradient
        colors={[
          'rgba(4, 14, 24, 0.58)',   // Top: Cool deep navy behind video player (58% Dark)
          'rgba(2, 10, 18, 0.40)',   // Upper Center: Luminous ambient bridge (40% Dark)
          'rgba(2, 8, 16, 0.68)',    // Lower Center: Rich dark oceanic velvet (68% Dark)
          'rgba(1, 4, 10, 0.92)',    // Bottom: Ultra-deep pitch navy behind chat stream (92% Dark)
        ]}
        locations={[0, 0.28, 0.65, 1.0]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  canvasWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    marginLeft: -CANVAS_SIZE / 2,
    marginTop: -CANVAS_SIZE / 2,
  },
  canvasFill: {
    width: '100%',
    height: '100%',
  },
});

export default memo(AmbientDiscoBackground);
