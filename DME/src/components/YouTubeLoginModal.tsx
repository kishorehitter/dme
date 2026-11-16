import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Ionicons';
import { checkYouTubeAuth, setHasSkippedYtLogin } from '../utils/youtubeAuth';

interface YouTubeLoginModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  isDark?: boolean;
}

export const YouTubeLoginModal: React.FC<YouTubeLoginModalProps> = ({
  visible,
  onClose,
  onSuccess,
  isDark = true,
}) => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(false);
  const authCheckLock = useRef(false);

  const handleNavStateChange = async (navState: any) => {
    const { url } = navState;
    if (!url) return;

    // Check if the user returned to YouTube after completing Google accounts login
    const isAtYouTube = url.includes('m.youtube.com') || url.includes('youtube.com');
    const isGoogleAccounts = url.includes('accounts.google.com') || url.includes('accounts.youtube.com');

    if (isAtYouTube && !isGoogleAccounts && !authCheckLock.current) {
      authCheckLock.current = true;
      setTimeout(async () => {
        const authed = await checkYouTubeAuth();
        if (authed) {
          console.log('🎉 [YouTubeLoginModal] Login verified via checkYouTubeAuth');
          await setHasSkippedYtLogin(false);
          onSuccess();
        } else {
          authCheckLock.current = false;
        }
      }, 1000);
    }
  };

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === 'youtube_logged_in' && !authCheckLock.current) {
        authCheckLock.current = true;
        console.log('🎉 [YouTubeLoginModal] In-page YouTube login confirmed!');
        await setHasSkippedYtLogin(false);
        onSuccess();
      }
    } catch (_) {}
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? '#0F0F0F' : '#FFFFFF'} />
        {/* Header Bar */}
        <View style={[styles.header, { borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
          <View style={styles.headerTitleRow}>
            <Icon name="logo-youtube" size={24} color="#FF0000" style={{ marginRight: 8 }} />
            <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
              Sign in to YouTube
            </Text>
            {loading && (
              <ActivityIndicator size="small" color="#FF0000" style={{ marginLeft: 10 }} />
            )}
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.closeBtn}
            accessibilityLabel="Close"
          >
            <Icon name="close" size={22} color={isDark ? '#FFFFFF' : '#0F172A'} />
          </TouchableOpacity>
        </View>

        {/* WebView — non-blocking loading to allow seamless email & password transitions */}
        <View style={{ flex: 1, position: 'relative' }}>
          <WebView
            ref={webViewRef}
            source={{
              uri: 'https://m.youtube.com/signin?action_handle_signin=true',
            }}
            userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            domStorageEnabled={true}
            javaScriptEnabled={true}
            setSupportMultipleWindows={false}
            onOpenWindow={(event) => {
              webViewRef.current?.injectJavaScript(
                `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
              );
            }}
            onShouldStartLoadWithRequest={(request) => {
              const url = request.url;
              if (url.startsWith('intent:') || url.startsWith('vnd.youtube:')) {
                return false;
              }
              return true;
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onNavigationStateChange={handleNavStateChange}
            onMessage={handleMessage}
            injectedJavaScript={`
              (function() {
                function checkLogin() {
                  try {
                    if (window.location.href.indexOf('accounts.google.com') === -1) {
                      if (window.ytcfg && typeof window.ytcfg.get === 'function') {
                        if (window.ytcfg.get('LOGGED_IN') === true) {
                          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'youtube_logged_in' }));
                          return;
                        }
                      }
                      if (document.querySelector('ytm-avatar, button[aria-label*="Account" i], button[aria-label*="profile" i]')) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'youtube_logged_in' }));
                        return;
                      }
                    }
                  } catch(e) {}
                }
                setInterval(checkLogin, 1000);
              })();
              true;
            `}
            style={{ flex: 1, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' }}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
});

export default YouTubeLoginModal;
