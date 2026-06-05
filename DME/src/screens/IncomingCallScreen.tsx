import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Alert,
  Image,
  DeviceEventEmitter,
  Vibration,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import fcmService from '../services/fcm';
import { ACTIONS } from '../services/fcm';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function IncomingCallScreen() {
  const route      = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets     = useSafeAreaInsets();
  const { user }   = useAuth();

  const p = route.params || {};

  const call_id         = p.call_id         ?? p.callId         ?? null;
  const caller_name     = p.caller_name     ?? p.remoteUserName ?? 'Someone';
  const call_type       = p.call_type       ?? p.callType       ?? 'audio';
  const conversation_id = p.conversation_id ?? p.conversationId ?? null;
  const caller_avatar   = p.caller_avatar   ?? p.remoteUserPic  ?? null;
  const autoAccept      = p.autoAccept      === true;
  const _action         = p._action         ?? null;

  const isGroupCall = call_type?.startsWith('group_') || p.isGroupCall === true;
  const callIdNum   = call_id ? parseInt(String(call_id), 10) : null;
  const cleanType   = call_type?.replace('group_', '') || 'audio';

  const [isCallMissed, setIsCallMissed] = useState(false);
  
  const isHandled       = useRef(false);
  const autoRejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef    = useRef(false);
  const vibrationRef    = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (call_id) {
      setIsCallMissed(_action === 'missed_call');
      isHandled.current = false;

      // ✅ Auto-answer if requested via notification button
      if (autoAccept && !isHandled.current && _action === ACTIONS.ANSWER) {
        console.log('[IncomingCallScreen] autoAccept detected, answering call...');
        // Small delay to ensure everything is mounted
        const t = setTimeout(() => {
          handleAnswer();
        }, 500);
        return () => clearTimeout(t);
      }
    }
  }, [call_id, _action, autoAccept, handleAnswer]);

  useKeepAwake();

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => { isFocusedRef.current = false; };
    }, [])
  );

  useEffect(() => {
    // Don't vibrate if we are auto-answering
    if (!isCallMissed && !isHandled.current && !autoAccept) {
      if (Platform.OS === 'android') {
        Vibration.vibrate([1000, 1000, 1000], true);
      }
    }
    return () => {
      Vibration.cancel();
    };
  }, [isCallMissed, autoAccept]);

  const handleDismiss = useCallback(() => {
    if (isHandled.current) return;
    isHandled.current = true;
    Vibration.cancel();
    if (autoRejectTimer.current) clearTimeout(autoRejectTimer.current);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);

    if (isFocusedRef.current) {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    }
  }, [navigation]);

  useEffect(() => {
    const unsubCancel = DeviceEventEmitter.addListener('call_cancelled_externally', (data) => {
      if (String(data.call_id) === String(call_id)) {
        console.log('[IncomingCallScreen] Call cancelled externally');
        handleDismiss();
      }
    });

    const unsubMissed = DeviceEventEmitter.addListener('call_missed_externally', (data) => {
      if (String(data.call_id) === String(call_id)) {
        console.log('[IncomingCallScreen] Call marked as missed externally');
        setIsCallMissed(true);
        Vibration.cancel();
        
        // Auto-dismiss after 2 seconds
        autoDismissTimer.current = setTimeout(() => {
          handleDismiss();
        }, 2000);
      }
    });

    // Local safety timeout (35s)
    autoRejectTimer.current = setTimeout(() => {
      if (!isHandled.current && !isCallMissed) {
        console.log('[IncomingCallScreen] Local timeout reached');
        handleDismiss();
      }
    }, 35000);

    return () => {
      unsubCancel.remove();
      unsubMissed.remove();
      if (autoRejectTimer.current) clearTimeout(autoRejectTimer.current);
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
  }, [call_id, handleDismiss, isCallMissed]);

  const handleReject = useCallback(async () => {
    if (isHandled.current) return;
    
    // If already missed, just dismiss locally
    if (isCallMissed) {
      handleDismiss();
      return;
    }

    isHandled.current = true;
    if (autoRejectTimer.current) clearTimeout(autoRejectTimer.current);
    Vibration.cancel();

    fcmService.cancelIncomingCallNotification(String(call_id)).catch(() => {});
    if (call_id) fcmService.markCallHandled(String(call_id), 'incoming_call');
    
    if (!isGroupCall && callIdNum) {
      api.post('/calls/reject/', { call_id: callIdNum }).catch((e) => {});
    }

    if (isFocusedRef.current) {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    }
  }, [call_id, callIdNum, isGroupCall, navigation, isCallMissed, handleDismiss]);

  const handleAnswer = useCallback(async () => {
    if (isHandled.current || isCallMissed) return;
    isHandled.current = true;
    
    if (autoRejectTimer.current) clearTimeout(autoRejectTimer.current);
    Vibration.cancel();

    await fcmService.cancelIncomingCallNotification(String(call_id));
    if (call_id) await fcmService.markCallHandled(String(call_id), 'incoming_call');

    if (!isGroupCall) {
      try {
        await api.post('/calls/accept/', { call_id: callIdNum });
      } catch (err) {
        Alert.alert('Call Error', 'Could not accept call.');
        if (isFocusedRef.current) navigation.goBack();
        return;
      }
    }

    let token: string, serverUrl: string;
    try {
      let res;
      if (isGroupCall) {
        res = await api.post('/calls/livekit/token/', { conversation_id: String(conversation_id), call_type: cleanType });
      } else {
        res = await api.post('/calls/livekit/token/', { call_id: callIdNum, receiver_id: user?.id, call_type: cleanType });
      }
      token = res.data.token;
      serverUrl = res.data.server_url;
    } catch (err) {
      Alert.alert('Error', 'Could not join the call');
      if (isFocusedRef.current) navigation.goBack();
      return;
    }

    if (isFocusedRef.current) {
      navigation.replace('Call', {
        isGroupCall,
        conversationId:  String(conversation_id),
        callType:        cleanType,
        callId:          call_id ? String(call_id) : null,
        remoteUserName:  caller_name,
        remoteUserPic:   caller_avatar,
        token,
        serverUrl,
        receiverId:      !isGroupCall ? String(user?.id) : undefined,
      });
    }
  }, [call_id, callIdNum, isGroupCall, conversation_id, cleanType, caller_name, caller_avatar, user, navigation, isCallMissed]);

  const displayName = isGroupCall ? `${caller_name} (Group)` : caller_name;
  const callLabel   = `Incoming ${cleanType} call`;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.callerSection}>
        <View style={styles.avatarWrapper}>
          {caller_avatar ? (
            <Image source={{ uri: caller_avatar }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>
                {(caller_name?.[0] ?? '?').toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.callerName}>{displayName}</Text>
        <Text style={styles.callTypeLabel}>{callLabel}</Text>
        {isCallMissed && <Text style={styles.missedText}>Call missed</Text>}
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity 
          style={styles.rejectBtn} 
          onPress={handleReject}
          activeOpacity={0.7}
        >
          <Text style={styles.btnLabel}>{isCallMissed ? 'Close' : 'Reject'}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.answerBtn, isCallMissed && styles.disabledBtn]} 
          onPress={handleAnswer}
          disabled={isCallMissed}
          activeOpacity={isCallMissed ? 1 : 0.7}
        >
          <Text style={styles.btnLabel}>{isCallMissed ? 'Ended' : 'Answer'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  callerSection:  { alignItems: 'center', gap: 12 },
  avatarWrapper: {
    width: 120, height: 120, borderRadius: 60,
    overflow: 'hidden', borderWidth: 3,
    borderColor: '#E8DEF8', marginBottom: 8,
  },
  avatarImage:    { width: '100%', height: '100%' },
  avatarFallback: {
    flex: 1, backgroundColor: '#8100D1',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarInitial:  { fontSize: 48, color: '#fff', fontWeight: '600' },
  callerName: {
    fontSize: 28, color: '#000', fontWeight: '700',
    letterSpacing: 0.3, textAlign: 'center',
  },
  callTypeLabel:  { fontSize: 15, color: '#666', marginTop: 4 },
  missedText: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '600',
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center',
  },
  rejectBtn: {
    backgroundColor: '#FF3B30',
    borderRadius: 50,
    paddingVertical: 16, paddingHorizontal: 40,
    minWidth: 130, alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E8DEF8',
  },
  answerBtn: {
    backgroundColor: '#8100D1',
    borderRadius: 50,
    paddingVertical: 16, paddingHorizontal: 40,
    minWidth: 130, alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E8DEF8',
  },
  disabledBtn: {
    backgroundColor: '#ccc',
    borderColor: '#ccc',
  },
  btnLabel: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
});