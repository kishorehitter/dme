import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { BackupManager } from '../../services/e2ee/BackupManager';

interface BackupSetupModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const BackupSetupModal: React.FC<BackupSetupModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const { theme, isDark } = useTheme();
  const [step, setStep] = useState<'create_pin' | 'confirm_pin' | 'show_recovery'>('create_pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const resetState = () => {
    setStep('create_pin');
    setPin('');
    setConfirmPin('');
    setGeneratedRecoveryKey('');
    setErrorMsg('');
    setCopied(false);
    setLoading(false);
  };

  const handleCreatePinNext = () => {
    if (pin.length !== 6) {
      setErrorMsg('PIN must be exactly 6 digits.');
      return;
    }
    setErrorMsg('');
    setStep('confirm_pin');
  };

  const handleConfirmPin = () => {
    if (confirmPin !== pin) {
      setErrorMsg('PINs do not match. Try again.');
      setConfirmPin('');
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setErrorMsg('');

    // Yield to JS event loop so React Native immediately repaints the disabled loading button
    setTimeout(async () => {
      try {
        const { recoveryKey } = await BackupManager.setupBackup(pin);
        setGeneratedRecoveryKey(recoveryKey);
        setStep('show_recovery');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to initialize backup.');
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleCopyKey = () => {
    Clipboard.setString(generatedRecoveryKey);
    setCopied(true);
    Toast.show({
      type: 'success',
      text1: 'Key Copied',
      text2: 'Emergency recovery key copied to clipboard!',
    });
    setTimeout(() => setCopied(false), 3000);
  };

  const handleFinish = () => {
    resetState();
    onClose();
    if (onSuccess) onSuccess();
    Toast.show({
      type: 'success',
      text1: 'Chat Backup Active',
      text2: 'Your encrypted messages are now protected and backed up.',
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[s.modalCard, { backgroundColor: isDark ? '#181B20' : '#FFFFFF', borderColor: isDark ? '#2D323A' : '#E5E7EB' }]}>
          {/* Header Close */}
          {step !== 'show_recovery' && (
            <TouchableOpacity
              style={s.closeBtn}
              disabled={loading}
              onPress={() => {
                if (loading) return;
                resetState();
                onClose();
              }}
            >
              <Icon name="close" size={22} color={isDark ? '#9CA3AF' : '#6B7280'} />
            </TouchableOpacity>
          )}

          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            {/* Icon */}
            <View style={[s.iconCircle, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5' }]}>
              <Icon
                name={step === 'show_recovery' ? 'key' : 'shield-checkmark'}
                size={34}
                color="#10B981"
              />
            </View>

            {/* Titles based on Step */}
            {step === 'create_pin' && (
              <>
                <Text style={[s.title, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                  Create Backup PIN
                </Text>
                <Text style={[s.subtitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
                  Choose a 6-digit PIN to encrypt your chats. You will need this PIN to restore your messages if you reinstall the app.
                </Text>
              </>
            )}

            {step === 'confirm_pin' && (
              <>
                <Text style={[s.title, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                  Confirm Your PIN
                </Text>
                <Text style={[s.subtitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
                  Re-enter your 6-digit PIN to ensure it matches.
                </Text>
              </>
            )}

            {step === 'show_recovery' && (
              <>
                <Text style={[s.title, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                  Save Your Recovery Key
                </Text>
                <Text style={[s.subtitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
                  This 16-character master key is your safety net. If you forget your 6-digit PIN, this is the only way to recover your messages.
                </Text>
              </>
            )}

            {errorMsg ? (
              <View style={s.errorBadge}>
                <Icon name="alert-circle" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                <Text style={s.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Step 1: Create PIN */}
            {step === 'create_pin' && (
              <View style={s.stepSection}>
                <TextInput
                  value={pin}
                  onChangeText={(t) => {
                    const clean = t.replace(/[^0-9]/g, '').slice(0, 6);
                    setPin(clean);
                    setErrorMsg('');
                  }}
                  placeholder="Enter 6-digit PIN"
                  placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  autoFocus
                  style={[
                    s.textInput,
                    {
                      color: isDark ? '#FFFFFF' : '#111827',
                      backgroundColor: isDark ? '#111317' : '#F9FAFB',
                      borderColor: isDark ? '#374151' : '#E5E7EB',
                    },
                  ]}
                />

                <TouchableOpacity
                  style={[s.primaryBtn, { opacity: pin.length === 6 ? 1 : 0.5 }]}
                  disabled={pin.length !== 6}
                  onPress={handleCreatePinNext}
                >
                  <Text style={s.primaryBtnText}>Next</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2: Confirm PIN */}
            {step === 'confirm_pin' && (
              <View style={s.stepSection}>
                <TextInput
                  value={confirmPin}
                  editable={!loading}
                  onChangeText={(t) => {
                    const clean = t.replace(/[^0-9]/g, '').slice(0, 6);
                    setConfirmPin(clean);
                    setErrorMsg('');
                  }}
                  placeholder="Re-enter 6-digit PIN"
                  placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  autoFocus
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
                      opacity: confirmPin.length === 6 && !loading ? 1 : 0.6,
                      backgroundColor: loading ? (isDark ? '#065F46' : '#6EE7B7') : '#10B981',
                    },
                  ]}
                  disabled={confirmPin.length !== 6 || loading}
                  onPress={handleConfirmPin}
                >
                  {loading ? (
                    <View style={s.loadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={s.primaryBtnText}>Encrypting & Saving...</Text>
                    </View>
                  ) : (
                    <Text style={s.primaryBtnText}>Encrypt & Save</Text>
                  )}
                </TouchableOpacity>

                {!loading && (
                  <TouchableOpacity
                    style={s.backBtn}
                    onPress={() => {
                      setStep('create_pin');
                      setConfirmPin('');
                      setErrorMsg('');
                    }}
                  >
                    <Text style={[s.backBtnText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Back</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Step 3: Show Recovery Key */}
            {step === 'show_recovery' && (
              <View style={s.stepSection}>
                <View style={[s.recoveryKeyBox, { backgroundColor: isDark ? '#111317' : '#F3F4F6', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
                  <Text style={[s.recoveryKeyText, { color: isDark ? '#10B981' : '#059669' }]} selectable>
                    {generatedRecoveryKey}
                  </Text>
                </View>

                <TouchableOpacity style={s.copyBtn} onPress={handleCopyKey}>
                  <Icon name={copied ? 'checkmark' : 'copy-outline'} size={18} color="#3B82F6" style={{ marginRight: 6 }} />
                  <Text style={s.copyBtnText}>{copied ? 'Copied to Clipboard!' : 'Copy Recovery Key'}</Text>
                </TouchableOpacity>

                <View style={s.warningCard}>
                  <Icon name="warning-outline" size={18} color="#F59E0B" style={{ marginRight: 8, marginTop: 2 }} />
                  <Text style={s.warningText}>
                    Keep this key confidential. Store it in a secure notes app or on paper.
                  </Text>
                </View>

                <TouchableOpacity style={s.primaryBtn} onPress={handleFinish}>
                  <Text style={s.primaryBtnText}>I Saved My Recovery Key</Text>
                </TouchableOpacity>
              </View>
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
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 390,
    maxHeight: '88%',
    borderRadius: 24,
    borderWidth: 1,
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    position: 'relative',
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 8,
    zIndex: 10,
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
  stepSection: {
    width: '100%',
    paddingBottom: 4,
  },
  textInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 4,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 8,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  recoveryKeyBox: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoveryKeyText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  copyBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  warningText: {
    color: '#D97706',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    lineHeight: 18,
  },
});

export default BackupSetupModal;
