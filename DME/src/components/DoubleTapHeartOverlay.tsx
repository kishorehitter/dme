import React, { useRef, useImperativeHandle, forwardRef, memo } from 'react';
import { StyleSheet, View, Text, Animated, Easing, Vibration } from 'react-native';

export interface DoubleTapHeartOverlayRef {
  trigger: (x: number, y: number, emoji?: string) => void;
}

interface Props {
  defaultEmoji?: string;
}

const LIKE_PARTICLES = [
  { angle: 30, color: '#FF7597', size: 3.5 },
  { angle: 90, color: '#FFD166', size: 2.8 },
  { angle: 150, color: '#FFB3C6', size: 3.5 },
  { angle: 210, color: '#FFA4BA', size: 3.0 },
  { angle: 270, color: '#FF69B4', size: 3.5 },
  { angle: 330, color: '#FF94AA', size: 3.0 },
];

const DoubleTapHeartOverlay = forwardRef<DoubleTapHeartOverlayRef, Props>(({ defaultEmoji = '❤️' }, ref) => {
  const [coords, setCoords] = React.useState({ x: 0, y: 0 });
  const [activeEmoji, setActiveEmoji] = React.useState(defaultEmoji);
  const [visible, setVisible] = React.useState(false);

  const heartScaleAnim = useRef(new Animated.Value(1)).current;
  const burstAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useImperativeHandle(ref, () => ({
    trigger: (x: number, y: number, emoji?: string) => {
      try { Vibration.vibrate(12); } catch (_) {}
      setCoords({ x, y });
      if (emoji) setActiveEmoji(emoji);
      setVisible(true);

      // Stop previous animation if currently running
      if (animRef.current) {
        animRef.current.stop();
      }

      // Reset values
      burstAnim.setValue(0);
      heartScaleAnim.setValue(1);

      const anim = Animated.parallel([
        Animated.sequence([
          Animated.timing(heartScaleAnim, {
            toValue: 0.80,
            duration: 90,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(heartScaleAnim, {
            toValue: 1.22,
            friction: 5,
            tension: 260,
            useNativeDriver: true,
          }),
          Animated.spring(heartScaleAnim, {
            toValue: 1.0,
            friction: 6,
            tension: 180,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(burstAnim, {
          toValue: 1,
          duration: 950,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]);

      animRef.current = anim;
      anim.start(() => {
        setVisible(false);
        burstAnim.setValue(0);
        heartScaleAnim.setValue(1);
        animRef.current = null;
      });
    },
  }));

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      {/* Micro Sparkle Burst Particles */}
      {LIKE_PARTICLES.map((particle, idx) => {
        const rad = (particle.angle * Math.PI) / 180;
        const dist = 22;
        const targetX = Math.cos(rad) * dist;
        const targetY = Math.sin(rad) * dist;

        return (
          <Animated.View
            key={`dt-particle-${idx}`}
            style={[
              styles.particle,
              {
                top: coords.y,
                left: coords.x,
                width: particle.size,
                height: particle.size,
                borderRadius: particle.size / 2,
                backgroundColor: particle.color,
                transform: [
                  {
                    translateX: burstAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, targetX],
                    }),
                  },
                  {
                    translateY: burstAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, targetY],
                    }),
                  },
                  {
                    scale: burstAnim.interpolate({
                      inputRange: [0, 0.35, 1],
                      outputRange: [0, 1.15, 0],
                    }),
                  },
                ],
                opacity: burstAnim.interpolate({
                  inputRange: [0, 0.2, 0.75, 1],
                  outputRange: [0, 1, 0.85, 0],
                }),
              },
            ]}
          />
        );
      })}

      {/* Floating Main Heart / Reaction Emoji */}
      <Animated.View
        style={[
          styles.reaction,
          {
            top: coords.y,
            left: coords.x,
            transform: [
              {
                translateY: burstAnim.interpolate({
                  inputRange: [0, 0.45, 1],
                  outputRange: [0, -12, -24],
                }),
              },
              {
                scale: heartScaleAnim,
              },
              {
                rotate: burstAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: ['0deg', '-5deg', '5deg'],
                }),
              },
            ],
            opacity: burstAnim.interpolate({
              inputRange: [0, 0.12, 0.7, 1],
              outputRange: [0, 1, 0.9, 0],
            }),
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
    fontSize: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 4,
  },
  particle: {
    position: 'absolute',
    marginLeft: -1.75,
    marginTop: -1.75,
  },
});

export default memo(DoubleTapHeartOverlay);
