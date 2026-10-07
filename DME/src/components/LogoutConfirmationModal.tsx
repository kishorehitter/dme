import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  ActivityIndicator,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

interface LogoutConfirmationModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export const LogoutConfirmationModal: React.FC<LogoutConfirmationModalProps> = ({
  visible,
  onClose,
  onConfirm,
  loading = false,
}) => {
  const { theme, isDark } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(0.92);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[s.overlay, { opacity: opacityAnim }]}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View
              style={[
                s.dialogOuter,
                {
                  transform: [{ scale: scaleAnim }],
                  shadowColor: '#ffffff',
                },
              ]}
            >
              {/* Luminous Multi-Color Sleek Gradient Border */}
              <LinearGradient
                colors={['#ffffff', '#ffffff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.gradientBorder}
              >
                {/* Modal Inner Surface */}
                <View style={[s.dialogInner, { backgroundColor: isDark ? '#0D1322' : theme.surface }]}>
                  {/* Top Ambient Glow */}
                  <View style={s.topGlowAura} pointerEvents="none">
                    <LinearGradient
                      colors={['rgba(255, 255, 255, 1.0)', 'rgba(255,255,255,1.0)', 'transparent']}
                      style={s.glowGradient}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                    />
                  </View>

                  {/* Icon Badge */}
                  <View style={s.iconBadgeWrapper}>
                    <LinearGradient
                      colors={['rgba(244, 63, 94, 0.25)', 'rgba(229, 224, 235, 0.15)']}
                      style={s.iconBadgeGradient}
                    >
                      <View style={s.iconCircleInner}>
                        <Icon name="log-out-outline" size={30} color="#F43F5E" />
                      </View>
                    </LinearGradient>
                  </View>

                  {/* Title & Description */}
                  <Text style={[s.title, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                    Log Out?
                  </Text>
                  <Text style={[s.description, { color: isDark ? '#94A3B8' : theme.textSecondary }]}>
                    Are you sure you want to log out? 
                  </Text>

                  {/* Action Buttons */}
                  <View style={s.buttonsRow}>
                    {/* Cancel Button */}
                    <TouchableOpacity
                      style={[
                        s.cancelButton,
                        {
                          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                          borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
                        },
                      ]}
                      onPress={onClose}
                      activeOpacity={0.7}
                      disabled={loading}
                    >
                      <Text style={[s.cancelButtonText, { color: isDark ? '#E2E8F0' : theme.textPrimary }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>

                    {/* Logout Button */}
                    <TouchableOpacity
                      style={s.logoutButtonTouch}
                      onPress={onConfirm}
                      activeOpacity={0.85}
                      disabled={loading}
                    >
                      <LinearGradient
                        colors={['#F43F5E', '#E11D48', '#BE123C']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={s.logoutGradient}
                      >
                        {loading ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <Icon name="log-out-outline" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
                            <Text style={s.logoutButtonText}>Log Out</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dialogOuter: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    elevation: 12,
  },
  gradientBorder: {
    padding: 1.8,
    borderRadius: 26,
  },
  dialogInner: {
    borderRadius: 24.2,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    overflow: 'hidden',
  },
  topGlowAura: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  glowGradient: {
    width: '100%',
    height: '100%',
  },
  iconBadgeWrapper: {
    marginBottom: 16,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  iconBadgeGradient: {
    width: 66,
    height: 66,
    borderRadius: 33,
    padding: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleInner: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 8,
    letterSpacing: 0.1,
  },
  buttonsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  logoutButtonTouch: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logoutGradient: {
    flex: 1,
    borderRadius: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default LogoutConfirmationModal;
