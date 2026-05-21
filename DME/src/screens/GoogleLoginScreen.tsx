/**
 * Google Login Screen
 *
 * The only authentication method - auto-triggers Google Sign-In on mount.
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';

// Configure Google Sign-In
GoogleSignin.configure({
  webClientId: '336096929365-e3p49jq04cr8sbqqmlm64nh1qgsl0j51.apps.googleusercontent.com',
  offlineAccess: true,
  forceCodeForRefreshToken: true,
});

const GoogleLoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { googleLogin } = useAuth();
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState('');

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setLoadingStatus('Connecting...');
      console.log('[Google Login] Starting Google Sign-In...');

      // Check if user is already signed in and sign them out to force account selection
      const currentUser = await GoogleSignin.getCurrentUser();
      if (currentUser) {
        console.log('[Google Login] Current user found, signing out to force selection...');
        await GoogleSignin.signOut();
        console.log('[Google Login] Signed out current user.');
      }

      // Check if Google Play Services is available
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      console.log('[Google Login] Google Play Services available');

      setLoadingStatus('Loading...');
      // Sign in with Google (v10+ API returns { type: 'success', data: { idToken, user, ... } })
      const userInfo = await GoogleSignin.signIn();
      const email = userInfo.data?.user?.email;
      console.log('[Google Login] Google Sign-In successful:', email);

      // Get the ID token from the signIn response (v10+ includes it in data)
      const idToken = userInfo.data?.idToken;

      if (!idToken) {
        throw new Error('No ID token received from Google');
      }

      console.log('[Google Login] Got ID token:', idToken.substring(0, 20) + '...');

      setLoadingStatus('Verifying...');
      // Send ID token to backend
      console.log('[Google Login] Sending to backend...');
      await googleLogin(idToken);
      console.log('[Google Login] Backend login successful');

    } catch (error: any) {
      console.error('[Google Login] Error:', error);
  // ... rest of the file

      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('[Google Login] User cancelled sign-in');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        console.log('[Google Login] Sign-in in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          'Google Play Services Not Available',
          'Please install or update Google Play Services on your device.'
        );
      } else {
        Alert.alert(
          'Google Login Failed',
          error.message || 'Failed to sign in with Google'
        );
      }
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        
        

         <Image
                source={require('../assets/logo.png')}
                style={{ width: 100, height: 100, borderRadius: 5, marginBottom: 0}}
              />
        <Text style={styles.appName}>DME</Text>
        {/* <Text style={styles.tagline}>Secure messaging, powered by Google</Text> */}

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Image
            source={require('../assets/google.png')}
            style={{ width: 20, height: 21, borderRadius: 0, marginRight: 8}}
          />
          {loading ? (
            <View style={styles.loadingWrapper}>
              <ActivityIndicator color="#7b00c7" size="small" />
              <Text style={[styles.googleButtonText, { marginLeft: 10 }]}>{loadingStatus}</Text>
            </View>
          ) : (
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footer}>
          By signing in, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  appName: {
    fontSize: 50,
    fontWeight: 'bold',
    color: '#7b00c7',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    marginBottom: 40,
  },
  logo: {
    fontSize: 80,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: '#404042',
    borderRadius: 8,
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  googleIcon: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 12,
    backgroundColor: '#fff',
    color: '#3f3f3f',
    width: 28,
    height: 28,
    borderRadius: 4,
    textAlign: 'center',
    lineHeight: 28,
  },
  googleButtonText: {
    color: '#242424',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
  },
});

export default GoogleLoginScreen;
