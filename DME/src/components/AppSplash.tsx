import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

interface AppSplashProps {
  onFinish: () => void;
  startFadeOut: boolean;
}

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
      <LinearGradient
        colors={['#FFFFFF', '#B9DCED', '#96C5DC', '#7EB9D8', '#96C5DC', '#B9DCED', '#FFFFFF']}
        useAngle={true}
        angle={355}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
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
    backgroundColor: '#ffffff',
    zIndex: 9999,
  },
  logo: {
    width: 160,
    height: 160,
  },
});

export default AppSplash;
