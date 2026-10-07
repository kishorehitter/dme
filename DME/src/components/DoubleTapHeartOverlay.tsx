import React, { useRef, useImperativeHandle, forwardRef, memo } from 'react';
import { StyleSheet, View, Text, Animated, Easing } from 'react-native';

export interface DoubleTapHeartOverlayRef {
  trigger: (x: number, y: number, emoji?: string) => void;
}

interface Props {
  defaultEmoji?: string;
}

const PARTICLE_ANGLES = [0, 60, 120, 180, 240, 300];
const PARTICLE_COLORS = ['#FF4D6D', '#FFD166', '#48CAE4', '#FF70A6', '#A2D2FF', '#F72585'];

const DoubleTapHeartOverlay = forwardRef<DoubleTapHeartOverlayRef, Props>(({ defaultEmoji = '❤️' }, ref) => {
  const [coords, setCoords] = React.useState({ x: 0, y: 0 });
  const [activeEmoji, setActiveEmoji] = React.useState(defaultEmoji);
  const [visible, setVisible] = React.useState(false);

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const burstProgress = useRef(new Animated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    trigger: (x: number, y: number, emoji?: string) => {
      setCoords({ x, y });
      if (emoji) setActiveEmoji(emoji);
      setVisible(true);

      // Reset values
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      translateYAnim.setValue(0);
      rotateAnim.setValue(0);
      burstProgress.setValue(0);

      Animated.parallel([
        // 1. Snappy Heart Scale Pop & Settle (Industrial Standard)
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.18,
              duration: 150,
              easing: Easing.out(Easing.back(1.4)),
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(rotateAnim, {
              toValue: 1,
              duration: 150,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          // Gentle float up and clean fade out
          Animated.parallel([
            Animated.timing(translateYAnim, {
              toValue: -24,
              duration: 220,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 0.88,
              duration: 220,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 220,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),

        // 2. Micro Sparkle Burst Particles (100% Native Driver)
        Animated.timing(burstProgress, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setVisible(false);
        scaleAnim.setValue(0);
        opacityAnim.setValue(0);
        translateYAnim.setValue(0);
        rotateAnim.setValue(0);
        burstProgress.setValue(0);
      });
    },
  }));

  if (!visible) return null;

  const heartRotation = rotateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-8deg', '4deg', '0deg'],
  });

  return (
    <View style={styles.overlay} pointerEvents="none">
      {/* Sparkle Particle Accents */}
      {PARTICLE_ANGLES.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const dist = 24;
        const targetX = Math.cos(rad) * dist;
        const targetY = Math.sin(rad) * dist;

        const particleTranslateX = burstProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, targetX],
        });
        const particleTranslateY = burstProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, targetY],
        });
        const particleScale = burstProgress.interpolate({
          inputRange: [0, 0.4, 1],
          outputRange: [0, 1, 0],
        });
        const particleOpacity = burstProgress.interpolate({
          inputRange: [0, 0.2, 0.8, 1],
          outputRange: [0, 1, 0.8, 0],
        });

        return (
          <Animated.View
            key={`particle-${i}`}
            style={[
              styles.particle,
              {
                top: coords.y,
                left: coords.x,
                backgroundColor: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
                transform: [
                  { translateX: particleTranslateX },
                  { translateY: particleTranslateY },
                  { scale: particleScale },
                ],
                opacity: particleOpacity,
              },
            ]}
          />
        );
      })}

      {/* Main Heart with tilt & float */}
      <Animated.View
        style={[
          styles.reaction,
          {
            top: coords.y,
            left: coords.x,
            transform: [
              { translateY: translateYAnim },
              { rotate: heartRotation },
              { scale: scaleAnim },
            ],
            opacity: opacityAnim,
          },
        ]}
      >
        <Text style={styles.heartText}>{activeEmoji}</Text>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    pointerEvents: 'none',
  },
  reaction: {
    position: 'absolute',
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartText: {
    fontSize: 34,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  particle: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: -2.5,
    marginTop: -2.5,
  },
});

export default memo(DoubleTapHeartOverlay);
