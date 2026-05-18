import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  StatusBar,
  View,
  StyleSheet,
  DeviceEventEmitter,
  AppState,
  AppStateStatus,
  NativeModules,
  Platform,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { AuthProvider } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import CallOverlay from './src/components/CallOverlay';
import AppNavigator from './src/navigation/AppNavigator';
import HeartbeatSplash from './src/components/HeartbeatSplash';
import { CommonActions, NavigationContainerRef } from '@react-navigation/native';
import fcmService, { FCMData, ACTIONS } from './src/services/fcm';
import AsyncStorage from '@react-native-async-storage/async-storage';

export let navigationRef: NavigationContainerRef<any> | null = null;

export function setNavigationRef(ref: NavigationContainerRef<any>) {
  navigationRef = ref;
}

export function handleNotificationNavigation(data: FCMData) {
  if (!navigationRef) {
    console.warn('[App] navigationRef not ready yet');
    return;
  }

  const { type, _action } = data;
  console.log('[App] handleNotificationNavigation type:', type, 'action:', _action);

  if (_action === ACTIONS.REJECT) {
    const currentRoute = navigationRef.getCurrentRoute();
    if (currentRoute?.name === 'IncomingCall') {
      if (navigationRef.canGoBack()) {
        navigationRef.dispatch(CommonActions.goBack());
      } else {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          }),
        );
      }
    }
    DeviceEventEmitter.emit('call_rejected_externally', data);
    return;
  }

  if (type === 'incoming_call' || _action === ACTIONS.ANSWER) {
    const conversationId = data.conversation_id || data.conv_id || null;
    const shouldAutoAccept = _action === ACTIONS.ANSWER || data.autoAccept === true;

    navigationRef.dispatch(
      CommonActions.navigate('IncomingCall', {
        call_id:         data.call_id,
        caller_id:       data.caller_id,
        caller_name:     data.caller_name,
        call_type:       data.call_type,
        caller_avatar:   data.caller_avatar   || null,
        room_id:         data.room_id         || null,
        conversation_id: conversationId,
        autoAccept:      shouldAutoAccept,
        _action:         _action || null,
      }),
    );
    return;
  }

  if (type === 'missed_call') {
    DeviceEventEmitter.emit('call_missed_externally', data);
    
    if (_action === ACTIONS.CALLBACK) {
      const targetUserId = data.caller_id || data.sender_id || data.from_id;
      if (targetUserId) {
        console.log('[App] Initiating CALLBACK to:', targetUserId);
        navigationRef.dispatch(
          CommonActions.navigate('Call', {
            callType:       data.call_type || 'audio',
            receiverId:     targetUserId,
            remoteUserName: data.caller_name || data.sender_name || 'User',
            remoteUserPic:  data.caller_avatar || data.sender_avatar || null,
          }),
        );
        return;
      }
    }

    navigationRef.dispatch(
      CommonActions.navigate('IncomingCall', {
        ...data,
        _action: 'missed_call',
      }),
    );
    return;
  }

  if (_action === ACTIONS.CALLBACK) {
    const targetUserId = data.caller_id || data.sender_id || data.from_id;
    if (targetUserId) {
      console.log('[App] Initiating CALLBACK (fallback) to:', targetUserId);
      navigationRef.dispatch(
        CommonActions.navigate('Call', {
          callType:       data.call_type || 'audio',
          receiverId:     targetUserId,
          remoteUserName: data.caller_name || data.sender_name || 'User',
          remoteUserPic:  data.caller_avatar || data.sender_avatar || null,
        }),
      );
    }
    return;
  }

  if (type === 'new_message' && (data.conv_id || data.conversation_id)) {
    const convId = data.conv_id || data.conversation_id;
    navigationRef.dispatch(
      CommonActions.navigate('ChatRoom', {
        conversationId: parseInt(convId!, 10),
      }),
    );
  }
}

export default function App() {
  const [isSplashFinished, setIsSplashFinished] = useState(false);
  const pendingNavigation = useRef<FCMData | null>(null);
  const navigationReadyRef = useRef(false);

  const checkPendingActions = useCallback(async () => {
    if (!navigationReadyRef.current) return;

    try {
      const pendingCallback = await AsyncStorage.getItem('pending_callback_call');
      if (pendingCallback) {
        const parsed = JSON.parse(pendingCallback);
        console.log('[App] Found pending callback on resume:', parsed);
        await AsyncStorage.removeItem('pending_callback_call');
        handleNotificationNavigation(parsed);
        return;
      }

      const pendingAnswer = await AsyncStorage.getItem('pending_call_answer');
      if (pendingAnswer) {
        const parsed = JSON.parse(pendingAnswer);
        if (parsed._action === ACTIONS.ANSWER) {
          console.log('[App] Found pending answer on resume:', parsed);
          handleNotificationNavigation(parsed);
        }
      }
    } catch (e) {
      console.warn('[App] Error checking pending actions:', e);
    }
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[App] App became active, checking for pending actions');
        checkPendingActions();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      } else {
        AppState.removeEventListener('change', handleAppStateChange);
      }
    };
  }, [checkPendingActions]);

  useEffect(() => {
    let unsubscribeFCM: (() => void) | undefined;

    fcmService
      .initialize(
        token => {
          console.log('[App] FCM token registered');
          fcmService.registerDevice();
        },
        data => {
          console.log('[App] onNotificationPress:', data);
          if (navigationReadyRef.current) {
            handleNotificationNavigation(data);
          } else {
            pendingNavigation.current = data;
          }
        },
      )
      .then(({ unsubscribe }) => {
        unsubscribeFCM = unsubscribe;
      });

    fcmService.getInitialNotification().then(async data => {
      let finalData = data;
      try {
        const pendingCallback = await AsyncStorage.getItem('pending_callback_call');
        if (pendingCallback) {
          const parsed = JSON.parse(pendingCallback);
          console.log('[App] Found pending callback from background:', parsed);
          finalData = parsed;
          await AsyncStorage.removeItem('pending_callback_call');
        }
      } catch (e) {
        console.warn('[App] Error checking pending callback:', e);
      }

      if (finalData) {
        console.log('[App] Cold start notification (resolved):', finalData);
        pendingNavigation.current = finalData;
      }
    });

    const deviceEventSub = DeviceEventEmitter.addListener(
      'incoming_call',
      data => handleNotificationNavigation({ ...data, type: 'incoming_call' }),
    );

    return () => {
      unsubscribeFCM?.();
      if (deviceEventSub && typeof deviceEventSub.remove === 'function') {
        deviceEventSub.remove();
      } else if (DeviceEventEmitter.removeSubscription) {
        DeviceEventEmitter.removeSubscription(deviceEventSub as any);
      }
    };
  }, []);

  function onNavigatorReady() {
    navigationReadyRef.current = true;
    
    if (pendingNavigation.current) {
      console.log('[App] Flushing pending navigation');
      handleNotificationNavigation(pendingNavigation.current);
      pendingNavigation.current = null;
    }
    
    checkPendingActions();
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider style={styles.container}>
        <View style={styles.safeAreaWrapper}>
          {!isSplashFinished ? (
            <HeartbeatSplash onFinish={() => setIsSplashFinished(true)} />
          ) : (
            <AuthProvider>
              <CallProvider>
                <StatusBar
                  barStyle="dark-content"
                  backgroundColor="#FFFFFF"
                  translucent={false}
                />
                <AppNavigator
                  setNavigationRef={setNavigationRef}
                  onNavigatorReady={onNavigatorReady}
                />
                <CallOverlay />
                <Toast />
              </CallProvider>
            </AuthProvider>
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1 },
  safeAreaWrapper:  { 
    flex: 1, 
    backgroundColor: '#FFFFFF',
  },
});
