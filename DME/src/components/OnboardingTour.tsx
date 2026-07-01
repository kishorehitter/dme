import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export interface TourTarget {
  key: TourStepKey;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TourStepKey = 'fab' | 'play' | 'menu' | 'statusTab';

const STEPS: {
  key: TourStepKey;
  icon: string;
  title: string;
  description: string;
  tipPosition: 'top' | 'bottom';
}[] = [
  {
    key: 'fab',
    icon: 'person-add-outline',
    title: 'Add a New Friend',
    description: 'Tap this button to search for people and start a new conversation or create a group chat.',
    tipPosition: 'top',
  },
  {
    key: 'play',
    icon: 'play-circle-outline',
    title: 'Music Room',
    description: 'Open the Music Room to discover and listen to YouTube tracks together with your friends in real-time.',
    tipPosition: 'bottom',
  },
  {
    key: 'menu',
    icon: 'ellipsis-vertical',
    title: 'More Options',
    description: 'Access your profile, create groups, clear chats, settings, app updates and logout from this menu.',
    tipPosition: 'bottom',
  },
  {
    key: 'statusTab',
    icon: 'person-circle-outline',
    title: 'Status Tab',
    description: 'Switch to the Status tab to upload photos or videos as your status and see updates from friends.',
    tipPosition: 'top',
  },
];

interface OnboardingTourProps {
  targets: Partial<Record<TourStepKey, TourTarget>>;
  onFinished: () => void;
}

// Padding added around the raw measured target to form the glow ring.
const RING_PADDING = 16;

const OnboardingTour: React.FC<OnboardingTourProps> = ({ targets, onFinished }) => {
  const [stepIdx, setStepIdx] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(40)).current;

  // Pulse animation values
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  const step = STEPS[stepIdx];
  const target = step ? targets[step.key] : undefined;

  // Entrance animation
  useEffect(() => {
    fadeAnim.setValue(0);
    cardSlide.setValue(40);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
        easing: Easing.out(Easing.quad),
      }),
      Animated.spring(cardSlide, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [stepIdx]);

  // Pulsing glow animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.15,
            duration: 1200,
            useNativeDriver: true,
            easing: Easing.out(Easing.quad),
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
            easing: Easing.in(Easing.quad),
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
            easing: Easing.out(Easing.quad),
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 1200,
            useNativeDriver: true,
            easing: Easing.in(Easing.quad),
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [stepIdx]);

  if (!target || !step) return null;

  // ── Glow geometry ──────────────────────────────────────────────────────
  // Build every ring from the SAME center point and the SAME base box so
  // they can never drift apart from one another or from the real button.
  // A scale-transform on a centered box keeps the visual center fixed,
  // which is what was breaking before (the old code computed left/top
  // from one box size while scaling a differently-sized box, and also
  // mixed `measure()` coordinates — relative to the nearest parent — with
  // a Modal that re-roots the coordinate space).
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;

  const baseW = target.width + RING_PADDING * 2;
  const baseH = target.height + RING_PADDING * 2;
  const baseLeft = cx - baseW / 2;
  const baseTop = cy - baseH / 2;
  const baseRadius = Math.max(baseW, baseH) / 2;

  // Card positioning
  const CARD_W = SCREEN_W - 40;
  const cardX = (SCREEN_W - CARD_W) / 2;
  const CARD_H = 230;

  const cardAboveY = target.y - CARD_H - 30;
  const cardBelowY = target.y + target.height + 40;

  let cardY: number;

  if (step.tipPosition === 'top') {
    cardY = cardAboveY > 20 ? cardAboveY : Math.min(cardBelowY, SCREEN_H - CARD_H - 20);
  } else {
    cardY = cardBelowY + CARD_H < SCREEN_H - 20 ? cardBelowY : Math.max(cardAboveY, 20);
  }

  const isLast = stepIdx === STEPS.length - 1;
  const handleNext = () => (isLast ? onFinished() : setStepIdx(i => i + 1));
  const handleSkip = () => onFinished();

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]} pointerEvents="box-none">
        <View style={styles.fullScrim} />

        {/* Outer soft halo */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowOuter,
            {
              left: baseLeft,
              top: baseTop,
              width: baseW,
              height: baseH,
              borderRadius: baseRadius,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity.interpolate({
                inputRange: [0, 0.6],
                outputRange: [0, 0.18],
              }),
            },
          ]}
        />

        {/* Main pulsing ring — sits exactly on the button outline */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowRing,
            {
              left: baseLeft,
              top: baseTop,
              width: baseW,
              height: baseH,
              borderRadius: baseRadius,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />

        {/* Static crisp ring directly on the button, no pulse — keeps a
            stable anchor even while the animated rings scale outward */}
        <View
          pointerEvents="none"
          style={[
            styles.glowStatic,
            {
              left: baseLeft,
              top: baseTop,
              width: baseW,
              height: baseH,
              borderRadius: baseRadius,
            },
          ]}
        />

        {/* Tooltip card */}
        <Animated.View
          style={[
            styles.card,
            {
              left: cardX,
              top: cardY,
              width: CARD_W,
              opacity: fadeAnim,
              transform: [{ translateY: cardSlide }],
            },
          ]}
        >
          <LinearGradient
            colors={['#8100D1', '#FF007F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cardHeader}
          >
            <Icon name={step.icon} size={22} color="#fff" />
            <Text style={styles.cardTitle}>{step.title}</Text>
            <Text style={styles.stepIndicator}>{stepIdx + 1}/{STEPS.length}</Text>
          </LinearGradient>

          <View style={styles.cardBody}>
            <Text style={styles.cardDesc}>{step.description}</Text>
            <View style={styles.dotsRow}>
              {STEPS.map((_, i) => (
                <View key={i} style={[styles.dot, i === stepIdx && styles.dotActive]} />
              ))}
            </View>
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} onPress={handleNext}>
                <LinearGradient
                  colors={['#8100D1', '#FF007F']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.nextBtn}
                >
                  <Text style={styles.nextText}>{isLast ? '🎉 Got it!' : 'Next'}</Text>
                  {!isLast && <Icon name="arrow-forward" size={15} color="#fff" style={{ marginLeft: 4 }} />}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fullScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  glowOuter: {
    position: 'absolute',
    backgroundColor: 'rgba(129, 0, 209, 0.12)',
    zIndex: 3,
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(129, 0, 209, 0.18)',
    borderWidth: 3,
    borderColor: '#8100D1',
    shadowColor: '#8100D1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 25,
    elevation: 10,
    zIndex: 5,
  },
  glowStatic: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    zIndex: 6,
  },
  card: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: '#fff',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    overflow: 'hidden',
    zIndex: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  stepIndicator: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
  },
  cardBody: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  cardDesc: {
    fontSize: 14,
    color: '#444',
    lineHeight: 21,
    marginBottom: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 18,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ddd',
  },
  dotActive: {
    backgroundColor: '#8100D1',
    width: 20,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 30,
  },
  nextText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default OnboardingTour;