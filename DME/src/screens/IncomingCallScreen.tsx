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

  console.log('[IncomingCall] params:', {
    call_id, caller_name, call_type, isGroupCall, conversation_id, autoAccept, _action,
  });

  const [isCallMissed, setIsCallMissed] = useState(false);
  
  const isHandled       = useRef(false);
  const autoRejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef    = useRef(false);
  const vibrationRef    = useRef<NodeJS.Timeout | null>(null);

  // ✅ Reset state when a new call ID is received (e.g. consecutive calls)
  useEffect(() => {
    if (call_id) {
      console.log('[IncomingCall] New call detected, resetting state for ID:', call_id);
      setIsCallMissed(false);
      isHandled.current = false;
    }
  }, [call_id]);

  useKeepAwake();

  // Track focus state
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => { isFocusedRef.current = false; };
    }, [])
  );

  // Start vibration/ringing on mount
  useEffect(() => {
    if (!isCallMissed && !isHandled.current) {
      if (Platform.OS === 'android') {
        Vibration.vibrate([1000, 1000, 1000], true);
      }
    }
    return () => {
      Vibration.cancel();
      if (vibrationRef.current) clearInterval(vibrationRef.current);
    };
  }, [isCallMissed]);

  // Listen for FCM actions
  useEffect(() => {
    const ansSub = DeviceEventEmitter.addListener('fcm_action_answer', (data) => {
      console.log('[IncomingCall] Received fcm_action_answer:', data);
      if (String(data.call_id) === String(call_id) && !isHandled.current && !isCallMissed) {
        handleAnswer();
      }
    });
    
    const rejSub = DeviceEventEmitter.addListener('fcm_action_reject', (data) => {
      console.log('[IncomingCall] Received fcm_action_reject:', data);
      if (String(data.call_id) === String(call_id) && !isHandled.current) {
        handleReject();
      }
    });
    
    const missedSub = DeviceEventEmitter.addListener('call_missed_externally', (data) => {
      console.log('[IncomingCall] Received call_missed_externally:', data);
      if (String(data.call_id) === String(call_id) && !isHandled.current) {
        setIsCallMissed(true);
        handleReject();
      }
    });

    const cancelSub = DeviceEventEmitter.addListener('call_cancelled_externally', (data) => {
      console.log('[IncomingCall] Received call_cancelled_externally:', data);
      if (String(data.call_id) === String(call_id) && !isHandled.current) {
        // Just close the screen without showing "Missed" state
        handleReject();
      }
    });

    return () => {
      ansSub.remove();
      rejSub.remove();
      missedSub.remove();
      cancelSub.remove();
    };
  }, [call_id, isCallMissed]);

  // Handle _action from params
  useEffect(() => {
    if (_action === 'missed_call' && !isHandled.current) {
      console.log('[IncomingCall] Closing screen due to missed_call action');
      setIsCallMissed(true);
      handleReject();
    }
  }, [_action]);

  // Auto-reject after 30s
  useEffect(() => {
    if (isCallMissed || isHandled.current) return;
    
    autoRejectTimer.current = setTimeout(() => {
      if (!isHandled.current && !isCallMissed) {
        console.log('[IncomingCall] Auto-rejecting after 30.5s timeout (fallback)');
        setIsCallMissed(true);
        handleReject();
      }
    }, 30_500);

    return () => {
      if (autoRejectTimer.current) {
        clearTimeout(autoRejectTimer.current);
        autoRejectTimer.current = null;
      }
    };
  }, [isCallMissed]);

  // Block hardware back to prevent accidental exit
  useEffect(() => {
    const onBackPress = () => {
      // Force block the back button if we are still on this screen 
      // and haven't entered the missed/ended state.
      if (!isCallMissed) {
        console.log('[IncomingCall] Back button pressed - forced block to stay on call screen');
        return true; 
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isCallMissed]);

  const handleReject = useCallback(async () => {
    // Already handled or currently rejecting
    if (isHandled.current) return;
    
    isHandled.current = true;
    
    if (autoRejectTimer.current) {
      clearTimeout(autoRejectTimer.current);
      autoRejectTimer.current = null;
    }
    Vibration.cancel();
    if (vibrationRef.current) clearInterval(vibrationRef.current);

    // Perform cleanup and API call
    fcmService.cancelIncomingCallNotification(String(call_id)).catch(() => {});
    if (call_id) fcmService.markCallHandled(String(call_id), 'incoming_call');
    if (!isGroupCall && callIdNum) {
      api.post('/calls/reject/', { call_id: callIdNum }).catch((e) => console.warn('[IncomingCall] Reject error:', e));
    }

    // Immediately close the screen
    if (isFocusedRef.current) {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      }
    }
  }, [call_id, callIdNum, isGroupCall, navigation]);

  const handleAnswer = useCallback(async () => {
    if (isHandled.current || isCallMissed) {
      console.log('[IncomingCall] Answer blocked: isHandled=', isHandled.current, 'isCallMissed=', isCallMissed);
      Alert.alert('Call Ended', 'This call has already ended', [{ text: 'OK' }]);
      if (isFocusedRef.current) navigation.goBack();
      return;
    }
    
    isHandled.current = true;
    
    if (autoRejectTimer.current) {
      clearTimeout(autoRejectTimer.current);
      autoRejectTimer.current = null;
    }
    Vibration.cancel();
    if (vibrationRef.current) clearInterval(vibrationRef.current);

    await fcmService.cancelIncomingCallNotification(String(call_id));
    if (call_id) await fcmService.markCallHandled(String(call_id), 'incoming_call');

    if (!isGroupCall) {
      if (!callIdNum) {
        Alert.alert('Error', 'Missing call ID');
        if (isFocusedRef.current) navigation.goBack();
        return;
      }
      try {
        await api.post('/calls/accept/', { call_id: callIdNum });
        console.log('[IncomingCall] Call accepted on backend');
      } catch (err: any) {
        console.error('[IncomingCall] Accept failed:', err?.message);
        Alert.alert('Call Error', 'Could not accept call. Please try again.');
        if (isFocusedRef.current) navigation.goBack();
        return;
      }
    }

    let token: string, serverUrl: string;
    try {
      let res;
      if (isGroupCall) {
        res = await api.post('/calls/livekit/token/', {
          conversation_id: String(conversation_id),
          call_type:       cleanType,
        });
      } else {
        res = await api.post('/calls/livekit/token/', {
          call_id:     callIdNum,
          receiver_id: user?.id,
          call_type:   cleanType,
        });
      }
      token     = res.data.token;
      serverUrl = res.data.server_url;
      console.log('[IncomingCall] Got LiveKit token, room:', res.data.room_name);
    } catch (err) {
      console.error('[IncomingCall] Token fetch failed:', err);
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
  }, [
    call_id, callIdNum, isGroupCall, conversation_id,
    cleanType, caller_name, caller_avatar, user, navigation,
    isCallMissed,
  ]);

  // ✅ Auto-answer: Handle autoAccept prop OR _action from FCM OR pending answer
  useEffect(() => {
    // ✅ Check multiple conditions for auto-answer (robust detection)
    const shouldAutoAnswer = 
      autoAccept === true || 
      _action === 'answer_call' || 
      _action === ACTIONS.ANSWER;
    
    if (shouldAutoAnswer && !isHandled.current && !isCallMissed && call_id) {
      console.log('[IncomingCall] Auto-answering (autoAccept:', autoAccept, '_action:', _action, ')');
      
      // ✅ Slightly longer delay for background state navigation
      const t = setTimeout(() => {
        if (!isHandled.current && !isCallMissed && isFocusedRef.current) {
          handleAnswer();
        }
      }, 500);
      
      return () => clearTimeout(t);
    }
  }, [autoAccept, _action, isCallMissed, call_id]);

  // ✅ Fallback: Check AsyncStorage for pending answer (critical for background state)
  useEffect(() => {
    const checkPendingAnswer = async () => {
      try {
        const pending = await AsyncStorage.getItem('pending_call_answer');
        if (pending) {
          const parsed = JSON.parse(pending);
          // Process if: same call_id + recent (< 15s for background) + not handled + not missed
          if (String(parsed.call_id) === String(call_id) && 
              Date.now() - parsed.timestamp < 15000 &&
              !isHandled.current && !isCallMissed) {
            console.log('[IncomingCall] Processing pending answer from storage (background fallback)');
            await AsyncStorage.removeItem('pending_call_answer');
            // Small delay to ensure navigation is complete
            setTimeout(() => {
              if (!isHandled.current && !isCallMissed && isFocusedRef.current) {
                handleAnswer();
              }
            }, 200);
          } else if (String(parsed.call_id) === String(call_id)) {
            // Clear stale pending answer
            await AsyncStorage.removeItem('pending_call_answer');
          }
        }
      } catch (e) {
        console.warn('[IncomingCall] Error checking pending answer:', e);
      }
    };
    
    // Run on mount and when call_id changes
    checkPendingAnswer();
  }, [call_id, isCallMissed]);

  // Render
  const displayName = isGroupCall ? `${caller_name} (Group)` : caller_name;
  const callLabel   = `Incoming ${cleanType} call`;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
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
        
        {isCallMissed && (
          <Text style={styles.missedText}>Call missed</Text>
        )}
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity 
          style={styles.rejectBtn} 
          onPress={handleReject}
          disabled={isHandled.current && !isCallMissed}
          activeOpacity={0.7}
        >
          <Text style={styles.btnLabel}>
            {isCallMissed ? 'Close' : 'Reject'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.answerBtn,
            (isHandled.current || isCallMissed) && styles.answerBtnDisabled
          ]} 
          onPress={handleAnswer}
          disabled={isHandled.current || isCallMissed}
          activeOpacity={0.7}
        >
          <Text style={styles.btnLabel}>
            {isCallMissed ? 'Ended' : 'Answer'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'space-between',
    paddingTop: 100,
    paddingBottom: 80,
    paddingHorizontal: 32,
  },
  callerSection:  { alignItems: 'center', gap: 12 },
  avatarWrapper: {
    width: 120, height: 120, borderRadius: 60,
    overflow: 'hidden', borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)', marginBottom: 8,
  },
  avatarImage:    { width: '100%', height: '100%' },
  avatarFallback: {
    flex: 1, backgroundColor: '#6C63FF',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarInitial:  { fontSize: 48, color: '#fff', fontWeight: '600' },
  callerName: {
    fontSize: 28, color: '#fff', fontWeight: '700',
    letterSpacing: 0.3, textAlign: 'center',
  },
  callTypeLabel:  { fontSize: 15, color: 'rgba(255,255,255,0.55)', marginTop: 4 },
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
    backgroundColor: '#d40423', borderRadius: 50,
    paddingVertical: 16, paddingHorizontal: 40,
    minWidth: 130, alignItems: 'center',
  },
  answerBtn: {
    backgroundColor: '#0ab318', borderRadius: 50,
    paddingVertical: 16, paddingHorizontal: 40,
    minWidth: 130, alignItems: 'center',
  },
  answerBtnDisabled: {
    backgroundColor: '#666',
  },
  btnLabel: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
});