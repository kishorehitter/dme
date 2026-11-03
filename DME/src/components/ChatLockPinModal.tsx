import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import BiometricService from '../services/BiometricService';

interface ChatLockPinModalProps {
  visible: boolean;
  mode: 'setup' | 'verify';
  userId?: number | string;
  title?: string;
  subtitle?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ChatLockPinModal: React.FC<ChatLockPinModalProps> = ({
  visible,
  mode,
  userId,
  title,
  subtitle,
  onSuccess,
  onCancel,
}) => {
  const { theme, isDark } = useTheme();

  // 'setup' mode has 2 steps: 'enter' (step 1) and 'confirm' (step 2)
  const [setupStep, setSetupStep] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState<string>('');
  const [currentPin, setCurrentPin] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [hasBiometrics, setHasBiometrics] = useState<boolean>(false);

  // Shake animation for incorrect PIN
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Check biometric capability on mount
  useEffect(() => {
    BiometricService.getSupportedBiometry().then((type) => {
      setHasBiometrics(!!type);
    });
  }, []);

  // Reset state whenever modal becomes visible
  useEffect(() => {
    if (visible) {
      setSetupStep('enter');
      setFirstPin('');
      setCurrentPin('');
      setErrorText('');
    }
  }, [visible]);

  const triggerShake = () => {
    Vibration.vibrate(50);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleDigitPress = (digit: string) => {
    if (currentPin.length >= 4) return;
    setErrorText('');
    const newPin = currentPin + digit;
    setCurrentPin(newPin);

    if (newPin.length === 4) {
      handleCompletePin(newPin);
    }
  };

  const handleDelete = () => {
    if (currentPin.length > 0) {
      setCurrentPin(prev => prev.slice(0, -1));
      setErrorText('');
    }
  };

  const handleCompletePin = async (completedPin: string) => {
    if (mode === 'setup') {
      if (setupStep === 'enter') {
        // Move to confirm step
        setFirstPin(completedPin);
        setCurrentPin('');
        setSetupStep('confirm');
      } else {
        // Confirm step
        if (completedPin === firstPin) {
          await BiometricService.setPin(userId, completedPin);
          onSuccess();
        } else {
          triggerShake();
          setErrorText('PINs do not match. Please try again.');
          setTimeout(() => {
            setSetupStep('enter');
            setFirstPin('');
            setCurrentPin('');
          }, 600);
        }
      }
    } else {
      // 'verify' mode
      const isValid = await BiometricService.verifyPin(userId, completedPin);
      if (isValid) {
        onSuccess();
      } else {
        triggerShake();
        setErrorText('Incorrect PIN. Please try again.');
        setTimeout(() => {
          setCurrentPin('');
        }, 500);
      }
    }
  };

  const handleFingerprintAuth = async () => {
    const success = await BiometricService.authenticateBiometric(
      'Locked Chats',
      'Scan your fingerprint to unlock'
    );
    if (success) {
      onSuccess();
    }
  };

  if (!visible) return null;

  // Title & Subtitle based on mode and step
  let displayTitle = title;
  let displaySubtitle = subtitle;

  if (mode === 'setup') {
    if (setupStep === 'enter') {
      displayTitle = 'Set 4-Digit Chat PIN';
      displaySubtitle = 'Create a 4-digit PIN to secure and access your locked chats';
    } else {
      displayTitle = 'Confirm Your 4-Digit PIN';
      displaySubtitle = 'Re-enter your 4-digit PIN to confirm';
    }
  } else {
    if (!displayTitle) displayTitle = 'Locked Chats';
    if (!displaySubtitle) displaySubtitle = 'Enter your 4-digit PIN to view locked chats';
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: isDark ? '#0A1526' : '#FFFFFF' }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.lockIconBadge, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(32, 92, 184, 0.1)' }]}>
              <Icon name="lock-closed" size={26} color={isDark ? '#38BDF8' : '#205CB8'} />
            </View>
            <TouchableOpacity 
              style={styles.closeBtn} 
              onPress={onCancel} 
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="close" size={24} color={isDark ? '#94A3B8' : '#64748B'} />
            </TouchableOpacity>
          </View>

          {/* Title & Subtitle */}
          <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#0B192C' }]}>{displayTitle}</Text>
          <Text style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>{displaySubtitle}</Text>

          {/* 4 Animated PIN Dots */}
          <Animated.View style={[styles.dotsContainer, { transform: [{ translateX: shakeAnim }] }]}>
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = currentPin.length > idx;
              return (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    isFilled
                      ? [styles.dotFilled, { backgroundColor: errorText ? '#EF4444' : (isDark ? '#38BDF8' : '#205CB8'), borderColor: errorText ? '#EF4444' : (isDark ? '#38BDF8' : '#205CB8') }]
                      : [styles.dotEmpty, { borderColor: isDark ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.35)' }],
                  ]}
                />
              );
            })}
          </Animated.View>

          {/* Error Message */}
          {errorText ? (
            <Text style={styles.errorText}>{errorText}</Text>
          ) : (
            <View style={{ height: 20 }} />
          )}

          {/* Numeric Keypad (0-9) */}
          <View style={styles.keypad}>
            {[
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
              ['biometric', '0', 'delete'],
            ].map((row, rIdx) => (
              <View key={rIdx} style={styles.keypadRow}>
                {row.map((item, cIdx) => {
                  if (item === 'biometric') {
                    if (hasBiometrics && mode === 'verify') {
                      return (
                        <TouchableOpacity
                          key={cIdx}
                          style={styles.actionKeyButton}
                          onPress={handleFingerprintAuth}
                          activeOpacity={0.7}
                        >
                          <Icon name="finger-print" size={28} color={isDark ? '#38BDF8' : '#205CB8'} />
                        </TouchableOpacity>
                      );
                    }
                    return <View key={cIdx} style={styles.keyButtonEmpty} />;
                  }

                  if (item === 'delete') {
                    return (
                      <TouchableOpacity
                        key={cIdx}
                        style={styles.actionKeyButton}
                        onPress={handleDelete}
                        activeOpacity={0.7}
                      >
                        <Icon name="backspace-outline" size={24} color={isDark ? '#E2E8F0' : '#1E293B'} />
                      </TouchableOpacity>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={cIdx}
                      style={[
                        styles.keyButton,
                        {
                          backgroundColor: isDark ? 'rgba(30, 41, 59, 0.7)' : 'rgba(241, 245, 249, 0.95)',
                          borderColor: isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(203, 213, 225, 0.6)',
                        },
                      ]}
                      onPress={() => handleDigitPress(item)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.keyText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 0,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    elevation: 0,
    shadowOpacity: 0,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 14,
  },
  lockIconBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    padding: 6,
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  dotEmpty: {
    backgroundColor: 'transparent',
  },
  dotFilled: {
    elevation: 0,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    height: 20,
    marginBottom: 4,
  },
  keypad: {
    width: '100%',
    marginTop: 8,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  keyButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
  },
  actionKeyButton: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
    backgroundColor: 'transparent',
  },
  keyButtonEmpty: {
    width: 62,
    height: 62,
  },
  keyText: {
    fontSize: 24,
    fontWeight: '600',
  },
});

export default ChatLockPinModal;
