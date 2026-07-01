import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

interface AppSplashProps {
  onFinish: () => void;
  startFadeOut: boolean;
}

const AppSplash: React.FC<AppSplashProps> = ({ onFinish, startFadeOut }) => {
  const scaleValue = useRef(new Animated.Value(1)).current;
  const opacityValue = useRef(new Animated.Value(1)).current;
  const [zoomFinished, setZoomFinished] = useState(false);

  useEffect(() => {
    // Phase 1: Zoom in (0.4 second)
    Animated.timing(scaleValue, {
      toValue: 1.5,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      setZoomFinished(true);
    });
  }, [scaleValue]);

  useEffect(() => {
    // Phase 2: Fade out once zoom is finished AND app is ready
    if (zoomFinished && startFadeOut) {
      Animated.timing(opacityValue, {
        toValue: 0,
        duration: 300, // Faster fade out
        useNativeDriver: true,
      }).start(onFinish);
    }
  }, [zoomFinished, startFadeOut, opacityValue, onFinish]);

  return (
    <Animated.View style={[styles.container, { opacity: opacityValue }]}>
      <Animated.Image
        source={require('../assets/logo.png')}
        style={[styles.logo, { transform: [{ scale: scaleValue }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    zIndex: 9999,
  },
  logo: {
    width: 140,
    height: 140,
  },
});

export default AppSplash;
