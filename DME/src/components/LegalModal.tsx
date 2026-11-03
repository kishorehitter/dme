import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';

export type LegalTabType = 'privacy' | 'terms';

interface LegalModalProps {
  visible: boolean;
  initialTab?: LegalTabType;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  visible,
  initialTab = 'privacy',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<LegalTabType>(initialTab);

  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.appBadge}>
                <Text style={styles.appBadgeText}>Youtelite</Text>
              </View>
              <Text style={styles.headerTitle}>Legal & Policies</Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="close" size={20} color="#0F172A" />
            </TouchableOpacity>
          </View>

          {/* Segmented Switcher */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'privacy' && styles.tabBtnActive]}
              onPress={() => setActiveTab('privacy')}
              activeOpacity={0.8}
            >
              <Icon
                name="shield-checkmark"
                size={16}
                color={activeTab === 'privacy' ? '#0F172A' : '#94A3B8'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'privacy' && styles.tabTextActive,
                ]}
              >
                Privacy Policy
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'terms' && styles.tabBtnActive]}
              onPress={() => setActiveTab('terms')}
              activeOpacity={0.8}
            >
              <Icon
                name="document-text"
                size={16}
                color={activeTab === 'terms' ? '#0F172A' : '#94A3B8'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'terms' && styles.tabTextActive,
                ]}
              >
                Terms of Service
              </Text>
            </TouchableOpacity>
          </View>

          {/* Document Content */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'privacy' ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
          </ScrollView>

          {/* Bottom Action Footer */}
          <View style={styles.footerBar}>
            <TouchableOpacity
              style={styles.doneBtnTouch}
              onPress={onClose}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={['#1E293B', '#0F172A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.doneBtnGradient}
              >
                <Text style={styles.doneBtnText}>I Understand & Close</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

/* ── Content: Privacy Policy ── */
const PrivacyPolicyContent = () => (
  <View style={styles.contentWrap}>
    <Text style={styles.docTitle}>Privacy Policy</Text>
    <Text style={styles.docMeta}>Effective Date: October 30, 2026</Text>

    <Text style={styles.p}>
      Welcome to <Text style={styles.bold}>Youtelite</Text>. Your privacy is paramount. This Privacy Policy details how we collect, use, and protect your information when using the Youtelite mobile application.
    </Text>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>1. End-to-End Encryption (E2EE)</Text>
      <Text style={styles.p}>
        • Private 1-on-1 messages, media, and voice notes are protected by <Text style={styles.cyan}>End-to-End Encryption</Text>.{'\n'}
        • Cryptographic private keys reside exclusively on your local device. We cannot read, inspect, or decrypt your personal conversations.{'\n'}
        • Call audio and video streams (powered by WebRTC) are transmitted encrypted and are <Text style={styles.bold}>never recorded or stored on our servers</Text>.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>2. Information We Collect</Text>
      <Text style={styles.p}>
        • <Text style={styles.bold}>Account Profile:</Text> Display name, email address, profile photo (avatar), and bio provided during registration or Google Sign-In.{'\n'}
        • <Text style={styles.bold}>User-Generated Content:</Text> Custom trivia sets, study materials/PDFs you upload for quiz generation, and 24-hour status stories.{'\n'}
        • <Text style={styles.bold}>Device & Push Tokens:</Text> Firebase Cloud Messaging (FCM) tokens for instant call and message notifications.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>3. Device Permissions & Usage</Text>
      <Text style={styles.p}>
        • <Text style={styles.bold}>Camera & Microphone:</Text> Used solely for live video/voice calling, voice notes, and sending photo attachments.{'\n'}
        • <Text style={styles.bold}>Photos & Media:</Text> Allows selecting photos, videos, and study PDFs to share in chat or create custom quizzes.{'\n'}
        • <Text style={styles.bold}>Biometrics:</Text> Optional fingerprint/face unlock for private chats. Biometric data is processed exclusively by your Android Keystore and is never accessible to Youtelite.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>4. Third-Party Services</Text>
      <Text style={styles.p}>
        • <Text style={styles.bold}>Google Sign-In & Firebase:</Text> User authentication and push notification delivery (governed by Google's Privacy Policy).{'\n'}
        • <Text style={styles.bold}>LiveKit:</Text> Relays encrypted audio/video packets for real-time WebRTC calling.{'\n'}
        • <Text style={styles.bold}>YouTube Discovery:</Text> Streams publicly available YouTube media in compliance with YouTube API Terms. We do not download, store, or sell YouTube content.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>5. Account Deletion & User Rights</Text>
      <Text style={styles.p}>
        You have the complete right to access, export, or permanently delete your account at any time via: {'\n'}
        <Text style={styles.cyan}>Settings ➔ Account ➔ Delete Account</Text>.{'\n'}
        Deleting your account immediately purges your profile, credentials, and server records.
      </Text>
    </View>
  </View>
);

/* ── Content: Terms of Service ── */
const TermsOfServiceContent = () => (
  <View style={styles.contentWrap}>
    <Text style={styles.docTitle}>Terms of Service</Text>
    <Text style={styles.docMeta}>Effective Date: October 30, 2026</Text>

    <Text style={styles.p}>
      By creating an account or tapping "Continue with Google", you agree to these Terms of Service. Please read them carefully.
    </Text>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>1. Eligibility & Conduct</Text>
      <Text style={styles.p}>
        • You must be at least 13 years old to use Youtelite.{'\n'}
        • You agree not to transmit illegal, harassing, defamatory, abusive, or fraudulent content.{'\n'}
        • Spamming, reverse-engineering, hacking, or attempting to compromise app cryptography is strictly prohibited.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>2. Encryption & Keys Responsibility</Text>
      <Text style={styles.p}>
        Because private keys are stored on your device for End-to-End Encryption, if you delete the app or lose your phone without an encrypted backup, your message history cannot be recovered by Youtelite.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>3. Q-Zone & Trivia Disclaimer</Text>
      <Text style={styles.p}>
        • Q-Zone and CrackIt trivia question banks, mock exams, and analytics are provided strictly for educational self-study.{'\n'}
        • <Text style={styles.bold}>Non-Affiliation Notice:</Text> Youtelite is an independent application and is not affiliated with, endorsed by, or representative of any government agency, examination board (TNPSC, UPSC, SSC), or official authority.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>4. YouTube & Media Disclaimer</Text>
      <Text style={styles.p}>
        Youtelite is independent and is not affiliated with Google LLC or YouTube. All video titles, thumbnails, and audio streams are property of their respective copyright owners. Playback complies with YouTube Terms of Service.
      </Text>
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.h2}>5. Disclaimer of Warranties & Liability</Text>
      <Text style={styles.p}>
        Youtelite is provided on an "AS IS" and "AS AVAILABLE" basis. To the maximum extent permitted by law, Youtelite and its developers shall not be liable for any indirect, incidental, or consequential damages resulting from app use.
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  appBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  appBadgeText: {
    fontFamily: 'ClashDisplay-Bold',
    color: '#0F172A',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 4,
    gap: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.08,
    shadowRadius: 2.5,
  },
  tabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    paddingBottom: 28,
  },
  contentWrap: {
    gap: 14,
  },
  docTitle: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  docMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  p: {
    color: '#334155',
    fontSize: 13.5,
    lineHeight: 22,
  },
  bold: {
    color: '#0F172A',
    fontWeight: '700',
  },
  cyan: {
    color: '#0284C7',
    fontWeight: '700',
  },
  sectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  h2: {
    color: '#0F172A',
    fontSize: 14.5,
    fontWeight: '800',
    marginBottom: 8,
  },
  footerBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  doneBtnTouch: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  doneBtnGradient: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});

export default LegalModal;
