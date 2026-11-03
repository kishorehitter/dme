import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { BackupManager } from '../../services/e2ee/BackupManager';

interface BackupRestoreModalProps {
  visible: boolean;
  onSuccess: () => void;
  onSkip: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  visible,
  onSuccess,
  onSkip,
}) => {
  const { theme, isDark } = useTheme();
  const [mode, setMode] = useState<'pin' | 'recovery'>('pin');
  const [pin, setPin] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPin, setNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const pinInputRef = useRef<TextInput>(null);

  // Auto-focus the PIN input when the modal mounts on screen
  useEffect(() => {
    if (visible && mode === 'pin') {
      const timer = setTimeout(() => {
        pinInputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [visible, mode]);

  const handlePinChange = (val: string) => {
    const clean = val.replace(/[^0-9]/g, '').slice(0, 6);
    setPin(clean);
    setErrorMsg('');

    if (clean.length === 6) {
      submitPinRestore(clean);
    }
  };

  const submitPinRestore = (enteredPin: string) => {
    if (!enteredPin || enteredPin.length !== 6) return;

    Keyboard.dismiss();
    setLoading(true);
    setErrorMsg('');

    setTimeout(async () => {
      try {
        await BackupManager.restoreWithPin(enteredPin);
        Toast.show({
          type: 'success',
          text1: 'Chats Restored',
          text2: 'All your encrypted messages have been recovered!',
        });
        onSuccess();
      } catch (err: any) {
        if (err.message === 'INVALID_PIN') {
          setErrorMsg('Incorrect PIN. Please try again.');
          setPin('');
          setTimeout(() => pinInputRef.current?.focus(), 200);
        } else if (err.message === 'CORRUPTED_BACKUP') {
          // Stale or corrupted backup on server — master key decrypted fine but payload is invalid.
          // This happens when the backup was created with an old version of the app.
          Alert.alert(
            'Backup Corrupted or Outdated',
            'Your backup was created with an older version and cannot be restored.\n\nPlease go to Settings → Chat Backup → Reset Backup, then set up a new backup. Your messages on this device are still intact.',
            [{ text: 'OK', onPress: onSkip }]
          );
        } else {
          setErrorMsg('Failed to restore backup. Check your connection and try again.');
        }
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const submitRecoveryRestore = () => {
    const cleanKey = recoveryKey.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
    if (cleanKey.length !== 16) {
      setErrorMsg('Recovery Key must be 16 characters.');
      return;
    }
    if (newPin.length !== 6) {
      setErrorMsg('New PIN must be exactly 6 digits.');
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setErrorMsg('');

    setTimeout(async () => {
      try {
        await BackupManager.restoreWithRecoveryKey(cleanKey, newPin);
        Toast.show({
          type: 'success',
          text1: 'Chats Restored & PIN Reset',
          text2: 'Your chats are recovered and your new PIN is set.',
        });
        onSuccess();
      } catch (err: any) {
        if (err.message === 'INVALID_RECOVERY_KEY') {
          setErrorMsg('Invalid Emergency Recovery Key.');
        } else {
          setErrorMsg('Recovery failed. Please check details.');
        }
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleSkipPrompt = () => {
    Alert.alert(
      'Skip Chat Restore?',
      'If you skip without entering your PIN, your previous encrypted messages will not be restored on this device.\n\nAre you sure you want to start fresh?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip & Start Fresh',
          style: 'destructive',
          onPress: onSkip,
        },
      ]
    );
  };

  const formatKeyInput = (text: string) => {
    const clean = text.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 16);
    let formatted = '';
    for (let i = 0; i < clean.length; i++) {
      formatted += clean[i];
      if ((i + 1) % 4 === 0 && i !== 15) {
        formatted += '-';
      }
    }
    setRecoveryKey(formatted);
    setErrorMsg('');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[s.modalCard, { backgroundColor: isDark ? '#181B20' : '#FFFFFF', borderColor: isDark ? '#2D323A' : '#E5E7EB' }]}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            {/* Header Icon */}
            <View style={[s.iconCircle, { backgroundColor: isDark ? 'rgba(78, 140, 255, 0.15)' : '#EFF6FF' }]}>
              <Icon
                name={mode === 'pin' ? 'shield-checkmark' : 'key'}
                size={34}
                color="#3B82F6"
              />
            </View>

            {/* Title & Subtitle */}
            <Text style={[s.title, { color: isDark ? '#FFFFFF' : '#111827' }]}>
              {mode === 'pin' ? 'Restore Encrypted Chats' : 'Emergency Recovery'}
            </Text>
            <Text style={[s.subtitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
              {mode === 'pin'
                ? 'An encrypted chat backup was found. Enter your 6-digit PIN to restore your messages.'
                : 'Enter your 16-character Emergency Recovery Key to recover your chats and choose a new PIN.'}
            </Text>

            {errorMsg ? (
              <View style={s.errorBadge}>
                <Icon name="alert-circle" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                <Text style={s.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Mode 1: 6-Digit PIN View */}
            {mode === 'pin' ? (
              <View style={s.pinSection}>
                {/* 6 Interactive PIN Digit Boxes with Full Native Input Overlay */}
                <View style={s.pinWrapper}>
                  <View style={s.boxesContainer} pointerEvents="none">
                    {[0, 1, 2, 3, 4, 5].map((idx) => {
                      const isFilled = pin.length > idx;
                      const isCurrent = pin.length === idx;
                      return (
                        <View
                          key={idx}
                          style={[
                            s.pinBox,
                            {
                              borderColor: isCurrent
                                ? '#3B82F6'
                                : isFilled
                                ? '#10B981'
                                : isDark
                                ? '#374151'
                                : '#D1D5DB',
                              backgroundColor: isDark ? '#111317' : '#F9FAFB',
                            },
                          ]}
                        >
                          <Text style={[s.pinDigit, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                            {isFilled ? '●' : ''}
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* Real, full-width touchable TextInput directly over the boxes */}
                  <TextInput
                    ref={pinInputRef}
                    value={pin}
                    editable={!loading}
                    onChangeText={handlePinChange}
                    keyboardType="number-pad"
                    maxLength={6}
                    caretHidden
                    style={s.fullOverlayInput}
                  />
                </View>

                {/* Explicit Action Button for Manual Submit */}
                <TouchableOpacity
                  style={[
                    s.primaryBtn,
                    {
                      opacity: pin.length === 6 && !loading ? 1 : 0.6,
                      backgroundColor: loading ? (isDark ? '#1E3A8A' : '#93C5FD') : '#3B82F6',
                    },
                  ]}
                  disabled={pin.length !== 6 || loading}
                  onPress={() => submitPinRestore(pin)}
                >
                  {loading ? (
                    <View style={s.loadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={s.primaryBtnText}>Decrypting & Restoring...</Text>
                    </View>
                  ) : (
                    <Text style={s.primaryBtnText}>Restore Chats</Text>
                  )}
                </TouchableOpacity>

                {!loading && (
                  <TouchableOpacity
                    style={s.linkBtn}
                    onPress={() => {
                      setMode('recovery');
                      setErrorMsg('');
                      setPin('');
                    }}
                  >
                    <Text style={s.linkBtnText}>Forgot PIN? Use Recovery Key</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* Mode 2: Emergency Recovery Key View */
              <View style={s.recoverySection}>
                <Text style={[s.inputLabel, { color: isDark ? '#D1D5DB' : '#374151' }]}>
                  16-Character Recovery Key
                </Text>
                <TextInput
                  value={recoveryKey}
                  editable={!loading}
                  onChangeText={formatKeyInput}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
                  autoCapitalize="characters"
                  style={[
                    s.textInput,
                    {
                      color: isDark ? '#FFFFFF' : '#111827',
                      backgroundColor: isDark ? '#111317' : '#F9FAFB',
                      borderColor: isDark ? '#374151' : '#E5E7EB',
                      opacity: loading ? 0.6 : 1,
                    },
                  ]}
                />

                <Text style={[s.inputLabel, { color: isDark ? '#D1D5DB' : '#374151', marginTop: 14 }]}>
                  New 6-Digit PIN
                </Text>
                <TextInput
                  value={newPin}
                  editable={!loading}
                  onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit PIN"
                  placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  style={[
                    s.textInput,
                    {
                      color: isDark ? '#FFFFFF' : '#111827',
                      backgroundColor: isDark ? '#111317' : '#F9FAFB',
                      borderColor: isDark ? '#374151' : '#E5E7EB',
                      opacity: loading ? 0.6 : 1,
                    },
                  ]}
                />

                <TouchableOpacity
                  style={[
                    s.primaryBtn,
                    {
                      opacity:
                        recoveryKey.replace(/[^0-9a-zA-Z]/g, '').length === 16 && newPin.length === 6 && !loading
                          ? 1
                          : 0.6,
                      backgroundColor: loading ? (isDark ? '#1E3A8A' : '#93C5FD') : '#3B82F6',
                    },
                  ]}
                  disabled={loading}
                  onPress={submitRecoveryRestore}
                >
                  {loading ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={s.primaryBtnText}>Restoring & Resetting...</Text>
                    </View>
                  ) : (
                    <Text style={s.primaryBtnText}>Restore & Set New PIN</Text>
                  )}
                </TouchableOpacity>

                {!loading && (
                  <TouchableOpacity
                    style={s.linkBtn}
                    onPress={() => {
                      setMode('pin');
                      setErrorMsg('');
                      setRecoveryKey('');
                      setNewPin('');
                    }}
                  >
                    <Text style={s.linkBtnText}>Back to PIN</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Skip & Start Fresh Option */}
            {!loading && (
              <TouchableOpacity style={s.skipBtn} onPress={handleSkipPrompt}>
                <Text style={[s.skipBtnText, { color: isDark ? '#6B7280' : '#9CA3AF' }]}>
                  Skip & Start Fresh
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 390,
    maxHeight: '88%',
    borderRadius: 24,
    borderWidth: 1,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
    paddingHorizontal: 6,
  },
  errorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '500',
  },
  pinSection: {
    width: '100%',
    alignItems: 'center',
  },
  pinWrapper: {
    width: '100%',
    height: 56,
    position: 'relative',
    marginVertical: 12,
    justifyContent: 'center',
  },
  boxesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  pinBox: {
    width: 46,
    height: 54,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDigit: {
    fontSize: 22,
    fontWeight: '700',
  },
  fullOverlayInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    color: 'transparent',
    fontSize: 1,
    zIndex: 10,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBtn: {
    marginTop: 16,
    paddingVertical: 8,
  },
  linkBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
  recoverySection: {
    width: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '600',
  },
  primaryBtn: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  skipBtn: {
    marginTop: 12,
    paddingVertical: 8,
  },
  skipBtnText: {
    fontSize: 13,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});

export default BackupRestoreModal;
