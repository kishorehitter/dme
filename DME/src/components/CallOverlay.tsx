// src/components/CallOverlay.tsx
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useCall } from '../context/CallContext';
import { CommonActions } from '@react-navigation/native';
// ✅ Import the global navigationRef from App.tsx
import { navigationRef } from '../../App';


const CallOverlay = () => {
  const { callState, maximizeCall } = useCall();

  if (!callState.isActive || !callState.isMinimized) {
    return null;
  }

  const { callParams, duration } = callState;
  const remoteUserName = callParams?.remoteUserName || callParams?.caller_name || 'User';
  const callType = callParams?.callType || callParams?.call_type || 'audio';

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handlePress = () => {
    maximizeCall();
    
    // ✅ Use global navigationRef with CommonActions for reliable navigation
    if (navigationRef) {
      navigationRef.dispatch(
        CommonActions.navigate('Call', { 
          ...callParams, 
          ...callState.liveKitConfig,
          isFromOverlay: true,
          isCaller: callParams?.isCaller !== undefined ? callParams.isCaller : (!callParams?.callId && !callParams?.call_id)
        })
      );
    }
  };
  return (
    <View style={styles.safeArea}>
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.container}
        onPress={handlePress}
      >
        <View style={styles.leftSection}>
          <View style={styles.iconContainer}>
            <Icon
              name={callType === 'video' ? 'videocam' : 'call'}
              size={20}
              color="#fff"
            />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.nameText} numberOfLines={1}>
              {remoteUserName}
            </Text>
            <Text style={styles.statusText}>
              Tap to return to call • {formatDuration(duration)}
            </Text>
          </View>
        </View>
        <Icon name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  container: {
    backgroundColor: '#34C759',
    marginHorizontal: 10,
    marginTop: Platform.OS === 'android' ? 10 : 0,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  nameText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  statusText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '500',
  },
});

export default CallOverlay;