import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const OTPVerifyScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verification Not Required</Text>
      <Text style={styles.text}>
        This app uses Google Sign-In only. No OTP verification needed.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  text: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
