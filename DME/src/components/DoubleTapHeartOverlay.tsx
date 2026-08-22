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
        // 1. Snappy Heart Scale Pop & Settle
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.35,
              duration: 140,
              easing: Easing.out(Easing.back(1.8)),
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 70,
              useNativeDriver: true,
            }),
            Animated.timing(rotateAnim, {
              toValue: 1,
              duration: 140,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          // Float up, gently scale down and fade out
          Animated.parallel([
            Animated.timing(translateYAnim, {
              toValue: -42,
              duration: 220,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 0.82,
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
        Animated.sequence([
          Animated.timing(burstProgress, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
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
    outputRange: ['-12deg', '6deg', '0deg'],
  });

  return (
    <View style={styles.overlay} pointerEvents="none">
      {/* Sparkle Particle Accents */}
      {PARTICLE_ANGLES.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const dist = 38;
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
          outputRange: [0, 1.2, 0],
        });
        const particleOpacity = burstProgress.interpolate({
          inputRange: [0, 0.3, 0.8, 1],
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
    width: 60,
    height: 60,
    marginLeft: -30,
    marginTop: -30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartText: {
    fontSize: 50,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  particle: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginLeft: -3.5,
    marginTop: -3.5,
  },
});

export default memo(DoubleTapHeartOverlay);
