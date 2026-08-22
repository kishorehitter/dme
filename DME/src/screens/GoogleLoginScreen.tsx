import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Image, StatusBar,
  NativeModules, Platform, Animated, Easing, Dimensions,
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

GoogleOneTapSignIn.configure({
  webClientId: '336096929365-e3p49jq04cr8sbqqmlm64nh1qgsl0j51.apps.googleusercontent.com',
  offlineAccess: false,
});

// Fixed subtle micro-starfield (minimal & non-distracting)
const STARS = [
  { top: '6%', left: '14%', size: 2, opacity: 0.65 },
  { top: '10%', left: '78%', size: 1.5, opacity: 0.5 },
  { top: '16%', left: '32%', size: 2.2, opacity: 0.8 },
  { top: '20%', left: '88%', size: 1.5, opacity: 0.55 },
  { top: '26%', left: '10%', size: 2, opacity: 0.6 },
  { top: '13%', left: '55%', size: 1.5, opacity: 0.4 },
  { top: '32%', left: '82%', size: 2, opacity: 0.65 },
  { top: '5%', left: '62%', size: 2.2, opacity: 0.75 },
  { top: '23%', left: '46%', size: 1.5, opacity: 0.45 },
  { top: '30%', left: '22%', size: 1.8, opacity: 0.55 },
];

const GoogleLoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { googleLogin } = useAuth();
  const { theme, isDark } = useTheme();
  const [isOpeningGoogle, setIsOpeningGoogle] = useState(false);
  const [loading, setLoading] = useState(false);

  // Animations
  const earthGlowPulse = useRef(new Animated.Value(0.75)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const shootingStarAnim = useRef(new Animated.Value(0)).current;
  const starfieldPulse = useRef(new Animated.Value(0.7)).current;
  const buttonGlowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Earth Atmosphere Gentle Breathing Pulse
    const earthLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(earthGlowPulse, {
          toValue: 1.05,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(earthGlowPulse, {
          toValue: 0.75,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // 2. Subtle Starfield Twinkle
    const starLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(starfieldPulse, {
          toValue: 1.0,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(starfieldPulse, {
          toValue: 0.65,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // 3. Subtle floating for the logo
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -5,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 5,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    // 4. Periodic Minimal Shooting Star Streak (Every ~6s)
    let isMounted = true;
    const runShootingStar = () => {
      if (!isMounted) return;
      shootingStarAnim.setValue(0);
      Animated.sequence([
        Animated.delay(2200),
        Animated.timing(shootingStarAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(4500),
      ]).start(() => {
        if (isMounted) runShootingStar();
      });
    };

    earthLoop.start();
    starLoop.start();
    floatLoop.start();
    runShootingStar();

    return () => {
      isMounted = false;
      earthLoop.stop();
      starLoop.stop();
      floatLoop.stop();
    };
  }, []);

  useEffect(() => {
    StatusBar.setTranslucent(true);
    StatusBar.setBarStyle('light-content');
    StatusBar.setBackgroundColor('transparent');
    if (Platform.OS === 'android') {
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
        NativeModules.SystemBar.setFitsSystemWindows(false);
        NativeModules.SystemBar.setWindowBackground('#050811');
      }
      pinNavBarColor('#00000000', true);
    }

    return () => {
      StatusBar.setBarStyle(theme.statusBarStyle);
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android') {
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setWindowBackground(theme.background);
          NativeModules.SystemBar.setNavigationBarColor('#00000000', isDark);
          NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
        }
        pinNavBarColor('#00000000', isDark);
      }
    };
  }, []);

  const handleGoogleLogin = async () => {
    if (isOpeningGoogle || loading) return;
    setIsOpeningGoogle(true);

    Animated.timing(buttonGlowAnim, {
      toValue: 1,
      duration: 350,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    try {
      await GoogleOneTapSignIn.checkPlayServices();

      // Open the compact half-screen bottom sheet with scrollable account picker
      let response = await GoogleOneTapSignIn.createAccount();

      if (isCancelledResponse(response)) {
        console.log('[Google Login] User cancelled sign-in');
        setIsOpeningGoogle(false);
        setLoading(false);
        Animated.timing(buttonGlowAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
        return;
      }

      if (isSuccessResponse(response)) {
        const { idToken } = response.data;
        if (!idToken) throw new Error('No ID token received from Google');

        setLoading(true);
        setIsOpeningGoogle(false);
        await googleLogin(idToken);
      }
    } catch (error: any) {
      console.error('[Google Login] Error:', error);
      setIsOpeningGoogle(false);
      setLoading(false);
      Animated.timing(buttonGlowAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();

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
  const isBusy = isOpeningGoogle || loading;

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={true}
      />

      {/* ── Deep Cosmos Background (Dark top & bottom, light sky blue in center) ── */}
      <View style={StyleSheet.absoluteFillObject}>
        <LinearGradient
          colors={['#020408', '#050E1E', '#0B2548', '#050E1E', '#020408']}
          locations={[0, 0.25, 0.50, 0.75, 1]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>

      {/* ── Center Ambient Sky Blue Aura ── */}
      <View style={styles.centerAuraContainer} pointerEvents="none">
        <LinearGradient
          colors={['rgba(56, 189, 248, 0.25)', 'rgba(14, 165, 233, 0.12)', 'transparent']}
          style={styles.centerAura}
        />
      </View>

      {/* ── Minimal Galaxy Sky & Starfield ── */}
      <View style={styles.skyContainer} pointerEvents="none">
        {/* Twinkling Micro Stars */}
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: starfieldPulse }]}>
          {STARS.map((star, idx) => (
            <View
              key={`star_${idx}`}
              style={[
                styles.starDot,
                {
                  top: star.top as any,
                  left: star.left as any,
                  width: star.size,
                  height: star.size,
                  opacity: star.opacity,
                },
              ]}
            />
          ))}
        </Animated.View>

        {/* ── Minimal Shooting Star ── */}
        <Animated.View
          style={[
            styles.shootingStarWrapper,
            {
              transform: [
                {
                  translateX: shootingStarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-80, SCREEN_WIDTH * 0.95],
                  }),
                },
                {
                  translateY: shootingStarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [SCREEN_HEIGHT * 0.05, SCREEN_HEIGHT * 0.42],
                  }),
                },
                { rotate: '36deg' },
              ],
              opacity: shootingStarAnim.interpolate({
                inputRange: [0, 0.15, 0.7, 1],
                outputRange: [0, 0.85, 0.85, 0],
              }),
            },
          ]}
        >
          <LinearGradient
            colors={['#FFFFFF', 'rgba(56, 189, 248, 0.75)', 'rgba(56, 189, 248, 0.15)', 'transparent']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 0 }}
            style={styles.shootingStarTail}
          />
        </Animated.View>
      </View>

      {/* ── Minimal Earth Horizon Curve (Bottom) ── */}
      <View style={styles.earthContainer} pointerEvents="none">
        {/* Luminous Atmospheric Ozone Glow Ring */}
        <Animated.View
          style={[
            styles.earthAtmosphereGlow,
            {
              opacity: earthGlowPulse,
              transform: [{ scaleY: earthGlowPulse.interpolate({ inputRange: [0.75, 1.05], outputRange: [0.99, 1.01] }) }],
            },
          ]}
        />

        {/* Curved Planet Limb Body */}
        <LinearGradient
          colors={[
            'rgba(30, 64, 175, 0.42)',
            'rgba(14, 30, 60, 0.75)',
            '#060B18',
            '#030509',
          ]}
          style={styles.earthBodyGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.45 }}
        />
      </View>

      {/* ── Centered Screen Content ── */}
      <View style={styles.content}>
        <View style={styles.centerContainer}>
          {/* App Logo */}
          <View style={styles.logoWrapper}>
            <Image
              source={require('../assets/logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>

          {/* App Title */}
          <Text style={styles.appName}>Yesenta</Text>
          <Text style={styles.tagline}>
            Moments made better together.
          </Text>

          {/* ── Glowing Google Button ── */}
          <View style={styles.buttonOuterWrapper}>
            <TouchableOpacity
              onPress={handleGoogleLogin}
              disabled={isBusy}
              activeOpacity={0.88}
              style={styles.buttonTouchArea}
            >
              {/* Luminous Multi-Color Border Gradient */}
              <LinearGradient
                colors={['#38BDF8', '#818CF8', '#C084FC', '#F472B6', '#38BDF8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.buttonGradientBorder}
              >
                {/* Dark Obsidian Glass Center */}
                <View style={styles.buttonInner}>
                  {isOpeningGoogle ? (
                    <ActivityIndicator color="#0F172A" size="small" style={{ marginRight: 12 }} />
                  ) : (
                    <Image
                      source={require('../assets/google.png')}
                      style={styles.googleIcon}
                    />
                  )}
                  <Text style={styles.googleButtonText}>
                    {isOpeningGoogle ? 'Connecting with Google...' : 'Continue with Google'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Terms and Privacy Footer */}
          <Text style={styles.footer}>
            By continuing, you agree to our{' '}
            <Text style={styles.footerLink}>Terms of Service</Text> and{' '}
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </Text>
        </View>
      </View>

      {/* Full Screen Loading Indicator for Server Sync */}
      {loading && (
        <View style={styles.fullScreenLoader} pointerEvents="auto">
          <ActivityIndicator color="#38BDF8" size="large" />
          <Text style={styles.loaderText}>Signing you in...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050811',
  },
  skyContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  centerAuraContainer: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.22,
    left: (SCREEN_WIDTH - 300) / 2,
    width: 300,
    height: 300,
    borderRadius: 150,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerAura: {
    width: '100%',
    height: '100%',
    borderRadius: 150,
  },
  starDot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  shootingStarWrapper: {
    position: 'absolute',
    width: 90,
    height: 3,
  },
  shootingStarTail: {
    flex: 1,
    borderRadius: 2,
  },
  earthContainer: {
    position: 'absolute',
    bottom: -SCREEN_WIDTH * 1.32,
    left: -SCREEN_WIDTH * 0.65,
    width: SCREEN_WIDTH * 2.3,
    height: SCREEN_WIDTH * 2.3,
    borderRadius: SCREEN_WIDTH * 1.15,
    overflow: 'hidden',
    alignItems: 'center',
  },
  earthAtmosphereGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: SCREEN_WIDTH * 1.15,
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
  },
  earthBodyGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SCREEN_WIDTH * 1.15,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    zIndex: 2,
  },
  centerContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipContainer: {
    marginBottom: 24,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  chipGradient: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  chipText: {
    color: '#E0F2FE',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  logoWrapper: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 120,
    height: 120,
  },
  appName: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginTop: 4,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.2,
    maxWidth: 290,
  },
  buttonOuterWrapper: {
    width: '100%',
    maxWidth: 320,
    marginTop: 36,
    marginBottom: 16,
    shadowColor: '#818CF8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 8,
  },
  buttonTouchArea: {
    width: '100%',
  },
  buttonGradientBorder: {
    padding: 1.8,
    borderRadius: 16,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14.5,
  },
  googleIcon: {
    width: 21,
    height: 21,
    marginRight: 12,
  },
  googleButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footer: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 18,
    marginBottom: 8,
  },
  footerLink: {
    color: '#94A3B8',
    textDecorationLine: 'underline',
  },
  fullScreenLoader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050811',
    zIndex: 999,
    elevation: 999,
  },
  loaderText: {
    color: '#E0F2FE',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 14,
  },
});

export default GoogleLoginScreen;
