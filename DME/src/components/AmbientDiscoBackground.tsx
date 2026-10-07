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

export type RoomTheme = 'cinema' | 'rave' | 'dark' | 'light';

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

// ── 1. CINEMA OLED THEME: Vivid TV Screen Blue & Deep Glow Purple Swirl ──
const SWIRL_SPECTRUM_1 = [
  'rgba(0, 230, 255, 0.72)',   // Electric Neon Cyan / TV Blue (#00E6FF)
  'rgba(99, 102, 241, 0.45)',  // Indigo Flow
  'rgba(217, 70, 239, 0.65)',  // Vivid Glow Purple / Fuchsia (#D946EF)
  'rgba(147, 51, 234, 0.48)',  // Deep Violet
  'rgba(0, 230, 255, 0.72)',   // Loop
];

const SWIRL_SPECTRUM_2 = [
  'rgba(168, 85, 247, 0.68)',  // Deep Glow Purple (#A855F7)
  'rgba(124, 58, 237, 0.48)',  // Electric Violet
  'rgba(0, 210, 255, 0.66)',   // TV Screen Blue
  'rgba(59, 130, 246, 0.45)',  // Royal Cobalt
  'rgba(168, 85, 247, 0.68)',  // Loop
];

const SWIRL_SPECTRUM_3 = [
  'rgba(0, 240, 255, 0.60)',   // Bright Cyan Highlight
  'transparent',
  'rgba(217, 70, 239, 0.60)',  // Bright Purple Highlight
  'transparent',
];

// ── 2. LIGHT FROST THEME: Soft Porcelain Sky & Lavender Aura ──
const LIGHT_SPECTRUM_1 = [
  'rgba(186, 230, 253, 0.75)', // Soft Sky Blue
  'rgba(224, 231, 255, 0.55)', // Soft Lavender
  'rgba(245, 208, 254, 0.65)', // Soft Rose/Lilac
  'rgba(216, 180, 254, 0.55)', // Soft Purple
  'rgba(186, 230, 253, 0.75)', // Loop
];

const LIGHT_SPECTRUM_2 = [
  'rgba(245, 208, 254, 0.65)',
  'rgba(216, 180, 254, 0.55)',
  'rgba(186, 230, 253, 0.70)',
  'rgba(199, 210, 254, 0.55)',
  'rgba(245, 208, 254, 0.65)',
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
    if (isMinimized || fullscreen || theme === 'dark') {
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
        withTiming(-SCREEN_HEIGHT * 0.20, { duration: 5200, easing: sinEasing }),
        withTiming(0, { duration: 4000, easing: sinEasing })
      ), -1, true
    );
    scaleX1.value = withRepeat(
      withSequence(
        withTiming(1.30, { duration: 3200, easing: sinEasing }),
        withTiming(0.85, { duration: 3600, easing: sinEasing })
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
  // THEME 2: LIGHT FROST MODE (Clean Porcelain Pearl White)
  // ═══════════════════════════════════════════════════════════════════════════
  if (theme === 'light') {
    return (
      <View style={styles.container} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F8FAFC' }]} />

        {/* Soft Ambient Light Swirl */}
        <Animated.View style={[styles.canvasWrap, style1]}>
          <LinearGradient
            colors={LIGHT_SPECTRUM_1}
            locations={STOPS_MAIN}
            start={{ x: 0.1, y: 0.1 }}
            end={{ x: 0.9, y: 0.9 }}
            style={styles.canvasFill}
          />
        </Animated.View>

        <Animated.View style={[styles.canvasWrap, style2]}>
          <LinearGradient
            colors={LIGHT_SPECTRUM_2}
            locations={STOPS_MAIN}
            start={{ x: 0.9, y: 0.1 }}
            end={{ x: 0.1, y: 0.9 }}
            style={styles.canvasFill}
          />
        </Animated.View>

        {/* Translucent Frosted Glass Scrim */}
        <LinearGradient
          colors={[
            'rgba(248, 250, 252, 0.45)',
            'rgba(248, 250, 252, 0.25)',
            'rgba(248, 250, 252, 0.55)',
            'rgba(241, 245, 249, 0.85)',
          ]}
          locations={[0, 0.28, 0.65, 1.0]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

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
  // THEME 4: CINEMA OLED (Deep Smoked Glass TV Blue & Glow Purple Swirl)
  // ═══════════════════════════════════════════════════════════════════════════
  const blendStyle = Platform.OS === 'ios' ? { mixBlendMode: 'screen' as const } : {};

  return (
    <View style={styles.container} pointerEvents="none">
      {/* ── 2. ACTIVE UNDERLYING SWIRLING LIQUID LIGHT ── */}
      {/* Layer A: Clockwise Swirling Blue-Purple Surface */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style1]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_1}
          locations={STOPS_MAIN}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* Layer B: Counter-Clockwise Swirling Purple-Blue Surface */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style2]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_2}
          locations={STOPS_MAIN}
          start={{ x: 0.9, y: 0.1 }}
          end={{ x: 0.1, y: 0.9 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* Layer C: Dynamic Highlight Current */}
      <Animated.View style={[styles.canvasWrap, blendStyle, style3]}>
        <LinearGradient
          colors={SWIRL_SPECTRUM_3}
          locations={STOPS_DIAG}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.canvasFill}
        />
      </Animated.View>

      {/* ── 3. DEEP SMOKED VELVET DARK OVERLAY ── */}
      <LinearGradient
        colors={[
          'rgba(5, 5, 8, 0.65)',   // Top: Deep moody tint behind video player (65% Dark)
          'rgba(5, 5, 8, 0.50)',   // Upper Center: Subtle ambient bridge (50% Dark)
          'rgba(5, 5, 8, 0.72)',   // Lower Center: Rich dark velvet (72% Dark)
          'rgba(5, 5, 8, 0.90)',   // Bottom: Ultra-deep pitch velvet behind chat stream (90% Dark)
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
