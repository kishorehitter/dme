import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Image, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

const HeartbeatSplash: React.FC<{ onFinish: () => void }> = ({ onFinish }) => {
  const scaleValue = useRef(new Animated.Value(1)).current;
  const opacityValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.sequence([
      Animated.timing(scaleValue, { toValue: 1.1, duration: 500, useNativeDriver: true }),
      Animated.timing(scaleValue, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]);

    Animated.loop(pulse).start();

    // After 2.5 seconds, fade out and finish splash
    setTimeout(() => {
      Animated.timing(opacityValue, { toValue: 0, duration: 500, useNativeDriver: true }).start(onFinish);
    }, 2500);
  }, []);

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
    width: 150,
    height: 150,
  },
});

export default HeartbeatSplash;
