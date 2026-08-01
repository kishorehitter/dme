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
import { useTheme } from '../context/ThemeContext';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export interface TourTarget {
  key: TourStepKey;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TourStepKey = 'fab' | 'play' | 'menu' | 'statusTab' | 'trivia';

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
    description: 'Tap this button to search for a User, view your Friend list or Sent and Accept new Friend Request.',
    tipPosition: 'top',
  },
  {
    key: 'play',
    icon: 'play-circle-outline',
    title: 'Watch Together',
    description: 'Create/Join a room to discover new content, learn, listen to music, and watch videos with your friends in real time.',
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
  {
    key: 'trivia',
    icon: 'help-circle-outline',
    title: 'Knowledge Quest',
    description: 'Challenge yourself with general knowledge questions! Tap here to start a solo quiz and test your knowledge across topics.',
    tipPosition: 'bottom',
  },
];

interface OnboardingTourProps {
  targets: Partial<Record<TourStepKey, TourTarget>>;
  onFinished: () => void;
}

// Padding added around the raw measured target to form the glow ring.
const RING_PADDING = 16;

const OnboardingTour: React.FC<OnboardingTourProps> = ({ targets, onFinished }) => {
  const { theme } = useTheme();
  const styles = dynamicStyles(theme);

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

  const isTopPointer = target.y < 150;

  const baseW = target.width + RING_PADDING * 2;
  const baseH = target.height + RING_PADDING * 2;
  const baseLeft = cx - baseW / 2;
  const baseTop = cy - baseH / 2;
  const baseRadius = Math.max(baseW, baseH) / 2;

  // Card positioning
  const CARD_W = SCREEN_W - 40;
  const cardX = (SCREEN_W - CARD_W) / 2;
  const CARD_H = 230;

  const isBottomStep = step.key === 'statusTab' || step.key === 'fab';
  const cardAboveY = target.y - CARD_H - (isBottomStep ? 60 : 30);
  const cardBelowY = target.y + target.height + (isTopPointer ? 75 : 40);

  let cardY: number;

  if (step.tipPosition === 'top') {
    cardY = cardAboveY > 20 ? cardAboveY : Math.min(cardBelowY, SCREEN_H - CARD_H - 20);
  } else {
    cardY = cardBelowY + CARD_H < SCREEN_H - 20 ? cardBelowY : Math.max(cardAboveY, 20);
  }

  const isLast = stepIdx === STEPS.length - 1;
  const handleNext = () => (isLast ? onFinished() : setStepIdx(i => i + 1));
  const handleSkip = () => onFinished();

  const emoji = isTopPointer ? '👆' : '👇';

  // Bouncing translateY calculation from the pulseScale
  // Bounces up towards target for top items, bounces down towards target for bottom items
  const bounceY = pulseScale.interpolate({
    inputRange: [1, 1.15],
    outputRange: [0, isTopPointer ? -12 : 12],
  });

  const emojiSize = 46;
  // Helper to adjust horizontal offsets for each tour step pointer individually
  const getHorizontalOffset = (key: TourStepKey) => {
    switch (key) {
      case 'play':
        return 0;      // Music Room pointer offset (positive = right, negative = left)
      case 'trivia':
        return 4;      // Trivia pointer offset
      case 'menu':
        return 4;      // Menu pointer offset
      case 'fab':
        return -12;    // New Chat pointer offset
      case 'statusTab':
        return -12;    // Status Tab pointer offset
      default:
        return 0;
    }
  };

  const fingerLeft = cx - emojiSize / 2 + getHorizontalOffset(step.key);
  const fingerTop = isTopPointer
    ? target.y + target.height + 4 // Below the target pointing up
    : target.y - emojiSize - (isBottomStep ? 18 : 4);    // Above the target pointing down, shifted up for bottom steps

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]} pointerEvents="box-none">
        <View style={styles.fullScrim} />

        {/* Finger pointer emoji only — replaces all circular glow outlines */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.fingerPointer,
            {
              left: fingerLeft,
              top: fingerTop,
              transform: [
                { translateY: bounceY },
              ],
              opacity: pulseOpacity.interpolate({
                inputRange: [0, 0.6],
                outputRange: [0.6, 1],
              }),
            },
          ]}
        >
          <Text style={{ fontSize: emojiSize }}>{emoji}</Text>
        </Animated.View>

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
            colors={['#303030e8', '#000000f3']}
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
                  colors={['#004696', '#112741']}
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

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  fullScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  fingerPointer: {
    position: 'absolute',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 1, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 12,
  },
  card: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: theme.surface,
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
    color: theme.textSecondary,
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
    backgroundColor: theme.border,
  },
  dotActive: {
    backgroundColor: '#4597f5f6',
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
    color: theme.textSecondary,
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