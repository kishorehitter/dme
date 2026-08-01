import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Image, StatusBar,
  NativeModules, Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  GoogleOneTapSignIn, isSuccessResponse,
  isNoSavedCredentialFoundResponse, isCancelledResponse,
  isErrorWithCode,
} from 'react-native-nitro-google-signin';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { pinNavBarColor } from '../utils/navBarPin';

GoogleOneTapSignIn.configure({
  webClientId: '336096929365-e3p49jq04cr8sbqqmlm64nh1qgsl0j51.apps.googleusercontent.com',
  offlineAccess: false,
});

const GoogleLoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { googleLogin } = useAuth();
  const { theme, isDark } = useTheme();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    StatusBar.setTranslucent(true);
    StatusBar.setBarStyle('dark-content');
    StatusBar.setBackgroundColor('transparent');
    if (Platform.OS === 'android') {
      try { changeNavigationBarColor('#00000000', false, false); } catch (e) {}
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
      }
    }

    return () => {
      // Reset system bars to active app theme after sign up / login
      StatusBar.setBarStyle(theme.statusBarStyle);
      StatusBar.setBackgroundColor(theme.statusBar);
      pinNavBarColor(theme.navBar);
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch (e) {}
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
          NativeModules.SystemBar.setStatusBarColor(theme.statusBar, isDark);
        }
      }
    };
  }, []);

  const enterLoadingState = () => {
    setLoading(true);
  };

  const exitLoadingState = () => {
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    enterLoadingState();
    try {
      await GoogleOneTapSignIn.checkPlayServices();

      let response = await GoogleOneTapSignIn.signIn();

      if (isNoSavedCredentialFoundResponse(response)) {
        response = await GoogleOneTapSignIn.createAccount();
      }

      if (isCancelledResponse(response)) {
        console.log('[Google Login] User cancelled sign-in');
        exitLoadingState();
        return;
      }

      if (isSuccessResponse(response)) {
        const { idToken } = response.data;
        if (!idToken) throw new Error('No ID token received from Google');
        await googleLogin(idToken);
        // Success: leave the black loading screen up — this screen is about
        // to unmount as AppNavigator swaps to the authenticated stack, so
        // there's no flash back to the login UI in between.
      }
    } catch (error: any) {
      console.error('[Google Login] Error:', error);
      exitLoadingState();

      const isCancel =
        (isErrorWithCode(error) && error.code === 'SIGN_IN_CANCELLED') ||
        (error?.message && error.message.toLowerCase().includes('cancel'));

      if (!isCancel) {
        Alert.alert('Google Login Failed', error.message || 'Failed to sign in with Google');
      } else {
        console.log('[Google Login] User cancelled sign-in (caught as error)');
      }
    }
  };

  const safeTop = Math.max(insets.top, StatusBar.currentHeight || 0, 24);
  const safeBottom = Math.max(insets.bottom, 16);

  return (
    <LinearGradient
      colors={['#96C5DC', '#7EB9D8', '#96C5DC']}
      useAngle={true}
      angle={355}
      style={styles.container}
    >
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent={true}
      />
      <View style={[
        styles.content,
        { paddingTop: safeTop, paddingBottom: safeBottom }
      ]}>
        <Image
          source={require('../assets/logo.png')}
          style={{ width: 120, height: 120, borderRadius: 5 }}
        />
        <Text style={styles.appName}>Inaivo</Text>

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleLogin}
          disabled={loading}
          activeOpacity={0.9}
        >
          <View style={styles.buttonContent}>
            <Image
              source={require('../assets/google.png')}
              style={{ width: 20, height: 21, marginRight: 8 }}
            />
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.footer}>
          By signing in, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>

      {loading && (
        <LinearGradient
          colors={['#96C5DC', '#7EB9D8', '#96C5DC']}
          useAngle={true}
          angle={355}
          style={styles.fullScreenLoader}
          pointerEvents="auto"
        >
          <ActivityIndicator color="#fafafa" size="large" />
        </LinearGradient>
      )}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  appName: { fontSize: 50, fontWeight: 'bold', color: '#000', marginBottom: 8 },
  googleButton: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#ffffff', paddingVertical: 16, paddingHorizontal: 32,
    borderWidth: 1, borderColor: '#404042', borderRadius: 8,
    width: '100%', maxWidth: 300, marginBottom: 20,
    position: 'relative',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: { color: '#242424', fontSize: 16, fontWeight: '600' },
  footer: {
    fontSize: 12, color: '#000000',
    textAlign: 'center', marginTop: 20, paddingHorizontal: 20,
  },
  fullScreenLoader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
  },
});

export default GoogleLoginScreen;