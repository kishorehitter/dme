import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated, Dimensions, StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

const { width, height } = Dimensions.get('window');
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

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
    <AnimatedLinearGradient
      colors={['transparent', '#B9DCED', '#96C5DC', '#7EB9D8', '#96C5DC', '#B9DCED', '#FFFFFF']}
      useAngle={true}
      angle={355}
      style={[styles.container, { opacity: opacityValue }]}
    >
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <Animated.Image
        source={require('../assets/logo.png')}
        style={[styles.logo, { transform: [{ scale: scaleValue }] }]}
        resizeMode="contain"
      />
    </AnimatedLinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    zIndex: 9999,
  },
  logo: {
    width: 160,
    height: 160,
  },
});

export default AppSplash;
