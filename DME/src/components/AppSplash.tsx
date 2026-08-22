import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated, Image, Dimensions } from 'react-native';

interface AppSplashProps {
  onFinish: () => void;
  startFadeOut: boolean;
}

const LOGO_SIZE = 140;

const AppSplash: React.FC<AppSplashProps> = ({ onFinish, startFadeOut }) => {
  const opacityValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (startFadeOut) {
      Animated.timing(opacityValue, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(onFinish);
    }
  }, [startFadeOut, opacityValue, onFinish]);

  return (
    <Animated.View style={[styles.container, { opacity: opacityValue }]} pointerEvents="none">
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </Animated.View>
  );
};

// Use Dimensions.get('screen') — this includes status bar + nav bar pixels
// so the splash always covers the FULL physical screen regardless of any
// parent layout shift caused by SafeAreaProvider inset measurement.
const { width: SW, height: SH } = Dimensions.get('screen');

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SW,
    height: SH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050811',
    zIndex: 9999,
    elevation: 9999,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});

export default AppSplash;
