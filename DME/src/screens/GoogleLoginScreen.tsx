import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Image, StatusBar,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  GoogleOneTapSignIn, isSuccessResponse,
  isNoSavedCredentialFoundResponse, isCancelledResponse,
} from 'react-native-nitro-google-signin';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

GoogleOneTapSignIn.configure({
  webClientId: '336096929365-e3p49jq04cr8sbqqmlm64nh1qgsl0j51.apps.googleusercontent.com',
  offlineAccess: true,
});

const GoogleLoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { googleLogin } = useAuth();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    StatusBar.setBarStyle('dark-content');
    try { changeNavigationBarColor('transparent', true, false); } catch (e) {}
    
    // Reset to solid white when leaving the login screen so other screens don't get messed up
    return () => {
      try { changeNavigationBarColor('#ffffff', true, false); } catch (e) {}
    };
  }, []);

  const enterLoadingState = () => {
    setLoading(true);
  };

  const exitLoadingState = () => {
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
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
      Alert.alert('Google Login Failed', error.message || 'Failed to sign in with Google');
    }
  };

  return (
    <LinearGradient
      colors={['#000000', '#111418', '#111820', '#173050', '#1D5875', '#5592B1', '#96C5DC', '#B9DCED', '#7EB9D8', '#4F9FC2', '#2B78A2', '#1A5570', '#1A2B3F', '#161b20', '#111111']}
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
        { paddingTop: insets.top, paddingBottom: insets.bottom }
      ]}>
        <Image
          source={require('../assets/logo.png')}
          style={{ width: 120, height: 120, borderRadius: 5 }}
        />
        <Text style={styles.appName}>DME</Text>

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
          colors={['#000000', '#111418', '#111820', '#173050', '#1D5875', '#5592B1', '#96C5DC', '#B9DCED', '#7EB9D8', '#4F9FC2', '#2B78A2', '#1A5570', '#1A2B3F', '#161b20', '#111111']}
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
  appName: { fontSize: 50, fontWeight: 'bold', color: '#4597f5f6', marginBottom: 8 },
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