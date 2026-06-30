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
import AppSplash from './src/components/AppSplash';
import { CommonActions, NavigationContainerRef } from '@react-navigation/native';
import fcmService, { FCMData, ACTIONS } from './src/services/fcm';
import AsyncStorage from '@react-native-async-storage/async-storage';
import websocketService from './src/services/websocket';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { UpdateProvider } from './src/context/UpdateContext';

export let navigationRef: NavigationContainerRef<any> | null = null;

export function setNavigationRef(ref: NavigationContainerRef<any>) {
  navigationRef = ref;
}

export function handleNotificationNavigation(data: FCMData) {
  if (!navigationRef) {
    console.warn('[App] ❌ navigationRef is NULL!');
    return;
  }

  const { type, _action } = data;
  console.log('[App] 🔄 handleNotificationNavigation', {
    type,
    action: _action,
    roomCode: data.room_code,
    videoId: data.video_id,
  });

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

  if (type === 'music_invite') {
    console.log('[App] 🎵 Music invite detected, navigating to room:', data.room_code);
    try {
        DeviceEventEmitter.emit('open_music_room', {
          roomCode: data.room_code,
          isDJMode: false,
          initialVideoId: data.video_id,
        });
        console.log('[App] ✅ open_music_room event emitted successfully');
    } catch (e) {
        console.error('[App] ❌ Navigation dispatch failed:', e);
    }
    return;  // ✅ Add explicit return
  }
}

export default function App() {
  const [isSplashFinished, setIsSplashFinished] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const pendingNavigation = useRef<FCMData | null>(null);
  const navigationReadyRef = useRef(false);

  const checkPendingActions = useCallback(async () => {
    if (!navigationReadyRef.current) return;

    try {
      const allKeys = await AsyncStorage.getAllKeys();
      console.log('[App] AsyncStorage keys:', allKeys);
      
      const pendingCallback = await AsyncStorage.getItem('pending_callback_call');
      if (pendingCallback) {
        const parsed = JSON.parse(pendingCallback);
        console.log('[App] Found pending callback on resume:', parsed);
        await AsyncStorage.removeItem('pending_callback_call');
        handleNotificationNavigation(parsed);
        return;
      }

      const pendingInvite = await AsyncStorage.getItem('pending_music_invite');
      console.log('[App] pending_music_invite value:', pendingInvite);
      if (pendingInvite) {
        const parsed = JSON.parse(pendingInvite);
        console.log('[App] Found pending music invite on resume.');
        
        AsyncStorage.removeItem('pending_music_invite');
        handleNotificationNavigation(parsed);
        return;
      }

      const pendingAnswer = await AsyncStorage.getItem('pending_call_answer');
      if (pendingAnswer) {
        const parsed = JSON.parse(pendingAnswer);
        if (parsed._action === ACTIONS.ANSWER) {
          console.log('[App] Found pending answer on resume:', parsed);
          await AsyncStorage.removeItem('pending_call_answer');
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
    let navigationTimeout: NodeJS.Timeout;

    fcmService
      .initialize(
        token => {
          console.log('[App] FCM token registered');
          fcmService.registerDevice();
        },
        data => {
          console.log('[App] 🔔 onNotificationPress:', data);
          if (navigationReadyRef.current) {
            // ✅ FIX: Small delay to ensure navigation stack is fully restored
            setTimeout(() => {
                console.log('[App] 🚀 Executing delayed notification navigation');
                handleNotificationNavigation(data);
            }, 800);
          } else {
            console.log('[App] ⏳ Navigator not ready, storing pending navigation');
            pendingNavigation.current = data;
          }
        },
      )
      .then(({ unsubscribe }) => {
        unsubscribeFCM = unsubscribe;
      });

    // ✅ NEW: Handle notifications opened from background state
    const unsubscribeOpenedApp = messaging().onNotificationOpenedApp((remoteMessage) => {
        console.log('[App] 📱 App opened from background by notification:', remoteMessage.data);
        if (remoteMessage.data) {
            handleNotificationNavigation(remoteMessage.data as FCMData);
        }
    });

    // ✅ NEW: Handle Notifee taps (for custom notifications)
    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS && detail.notification?.data?.type === 'music_invite') {
        console.log('[App] 🔔 Notifee notification pressed:', detail.notification.data);
        handleNotificationNavigation(detail.notification.data as FCMData);
      }
    });

    // ✅ Handle initial notification when app is launched from killed state
    fcmService.getInitialNotification().then(async (notificationData) => {
      console.log('[App] 📱 Initial notification data:', notificationData);
      
      if (!notificationData) {
        console.log('[App] No initial notification');
        return;
      }

      let finalData = notificationData;

      try {
        // Check for stored pending actions (lower priority than initial notification)
        const pendingAnswer = await AsyncStorage.getItem('pending_call_answer');
        if (pendingAnswer && (Date.now() - JSON.parse(pendingAnswer).timestamp < 60000)) {
          const parsed = JSON.parse(pendingAnswer);
          if (parsed._action === ACTIONS.ANSWER) {
            console.log('[App] Using pending answer instead');
            finalData = { ...parsed, autoAccept: true, type: 'incoming_call' };
            await AsyncStorage.removeItem('pending_call_answer');
          }
        } else if (pendingAnswer) {
          await AsyncStorage.removeItem('pending_call_answer');
        }

        const pendingCallback = await AsyncStorage.getItem('pending_callback_call');
        if (pendingCallback && (Date.now() - JSON.parse(pendingCallback).timestamp < 60000)) {
          const parsed = JSON.parse(pendingCallback);
          console.log('[App] Using pending callback instead');
          finalData = parsed;
          await AsyncStorage.removeItem('pending_callback_call');
        } else if (pendingCallback) {
          await AsyncStorage.removeItem('pending_callback_call');
        }
      } catch (e) {
        console.warn('[App] Error checking pending storage:', e);
      }

      // ✅ Store for handling when navigator is ready
      console.log('[App] 💾 Storing initial notification:', finalData.type);
      pendingNavigation.current = finalData;

      // If navigator is already ready, handle immediately
      if (navigationReadyRef.current) {
        console.log('[App] 🚀 Navigator ready, handling navigation immediately');
        setTimeout(() => handleNotificationNavigation(finalData), 100);
      } else {
        // Set a timeout fallback (in case onNavigatorReady doesn't get called)
        navigationTimeout = setTimeout(() => {
          console.log('[App] ⏰ Timeout: forcing navigation anyway');
          if (pendingNavigation.current) {
            handleNotificationNavigation(pendingNavigation.current);
          }
        }, 3000);
      }
    });

    // WebSocket listener
    const unsubWs = websocketService.onMessage((msg: any) => {
      switch (msg.type) {
        case 'call_end':
          console.log('[App] WS call_end:', msg.call_id);
          DeviceEventEmitter.emit('call_cancelled_externally', { call_id: msg.call_id });
          break;
        case 'call_rejected':
          console.log('[App] WS call_rejected:', msg.call_id);
          DeviceEventEmitter.emit('call_rejected_externally', { call_id: msg.call_id });
          break;
        case 'call_accepted':
          console.log('[App] WS call_accepted:', msg.call_id);
          DeviceEventEmitter.emit('call_accepted_externally', { call_id: msg.call_id });
          break;
      }
    });

    const deviceEventSub = DeviceEventEmitter.addListener(
      'incoming_call',
      data => handleNotificationNavigation({ ...data, type: 'incoming_call' }),
    );

    return () => {
      clearTimeout(navigationTimeout);
      unsubscribeFCM?.();
      unsubWs();
      if (deviceEventSub && typeof deviceEventSub.remove === 'function') {
        deviceEventSub.remove();
      }
    };
  }, []);

  function onNavigatorReady() {
    navigationReadyRef.current = true;
    console.log('[App] ✅ Navigator READY');
    setIsAppReady(true);
    
    // ✅ Immediately flush pending notification
    if (pendingNavigation.current) {
      console.log('[App] 🚀 Flushing pending navigation:', pendingNavigation.current);
      const data = pendingNavigation.current;
      pendingNavigation.current = null;
      
      // Small delay to ensure all navigation infrastructure is ready
      setTimeout(() => {
        console.log('[App] Executing navigation to:', data.type);
        handleNotificationNavigation(data);
      }, 200);
    }
    
    checkPendingActions();
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <UpdateProvider>
          <View style={styles.container}>
            <StatusBar
              barStyle="dark-content"
              backgroundColor="transparent"
              translucent={true}
            />
            <AuthProvider>
              <CallProvider>
                <AppNavigator
                  setNavigationRef={setNavigationRef}
                  onNavigatorReady={onNavigatorReady}
                />
                <CallOverlay />
                <Toast />
              </CallProvider>
            </AuthProvider>
            {!isSplashFinished && (
              <AppSplash 
                onFinish={() => setIsSplashFinished(true)} 
                startFadeOut={isAppReady}
              />
            )}
          </View>
        </UpdateProvider>
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
