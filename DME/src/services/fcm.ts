import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidStyle,
  AndroidLaunchActivityFlag,
  EventType,
  Event,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, DeviceEventEmitter, AppState, AppStateStatus } from 'react-native';
import Toast from 'react-native-toast-message';
import { API_BASE_URL, getApiUrl } from '../config/network';

export const ACTIONS = {
  ANSWER: 'answer_call',
  REJECT: 'reject_call',
  REPLY: 'reply_message',
  CALLBACK: 'callback',
} as const;

export const CHANNELS = {
  CALL: 'incoming_call_channel',
  MESSAGE: 'message_reply_channel',
  DEFAULT: 'default_channel',
} as const;

export type NotificationType =
  | 'incoming_call'
  | 'missed_call'
  | 'new_message'
  | string;

export interface FCMData {
  type?:            NotificationType;
  call_id?:         string;
  caller_id?:       string;
  caller_name?:     string;
  caller_avatar?:   string;
  call_type?:       string;
  room_id?:         string;
  conversation_id?: string;
  conv_id?:         string;
  sender?:          string;
  notif_title?:     string;
  notif_body?:      string;
  screen?:          string;
  params?:          string;
  _action?:         string;
  autoAccept?:      boolean;
  isFromOverlay?:   boolean;
  [key: string]: any;
}

export type TokenCallback = (token: string) => void;
export type PressCallback = (data: FCMData) => void;

let currentAppState: AppStateStatus = AppState.currentState;
AppState.addEventListener('change', (nextState: AppStateStatus) => {
  currentAppState = nextState;
});

class FCMService {
  private _initialNotificationHandled = false;
  private _activeConversationId: string | null = null;
  private _isInCall = false;
  private _processedEventIds: Set<string> = new Set();
  private _onNotificationPress: PressCallback | null = null;
  private _lastHandledCallId: string | null = null;
  private _lastHandledType: string | null = null;
  private _lastHandledTimestamp: number = 0;

  setActiveConversation(id: string | null) {
    this._activeConversationId = id;
    console.log(`[FCMService] Active conversation: ${id}`);
  }

  getActiveConversation(): string | null {
    return this._activeConversationId;
  }

  setIsInCall(value: boolean) {
    this._isInCall = value;
    console.log(`[FCMService] Is in call: ${value}`);
  }

  getIsInCall(): boolean {
    return this._isInCall;
  }

  private async isHandledCheck(callId: string, type: string): Promise<boolean> {
    if (!callId) return false;
    try {
      const key = 'fcm_handled_call_ids';
      const handledJson = await AsyncStorage.getItem(key);
      const handled: string[] = handledJson ? JSON.parse(handledJson) : [];
      return handled.includes(`${type}_${callId}`);
    } catch (e) {
      return false;
    }
  }

  private async isStaleOrDuplicate(remoteMessage: FirebaseMessagingTypes.RemoteMessage): Promise<boolean> {
    const data = (remoteMessage.data ?? {}) as FCMData;
    const callId = data.call_id;
    const type = data.type;
    const sentTime = remoteMessage.sentTime;

    if (!callId) return false;

    // 1. Check for stale incoming calls (> 45s old)
    if (type === 'incoming_call' && sentTime) {
      const age = Date.now() - sentTime;
      if (age > 45000) {
        console.log(`[FCMService] Ignoring stale incoming_call (age: ${age}ms)`);
        return true;
      }
    }

    // 2. Persistent deduplication
    if (type && await this.isHandledCheck(callId, type)) {
      console.log(`[FCMService] Persistent deduplication hit for ${type}_${callId}`);
      return true;
    }

    // Add to handled list
    if (type) await this.markCallHandled(callId, type);

    return false;
  }

  async markCallHandled(callId: string, type: string = 'incoming_call'): Promise<void> {
    if (!callId) return;
    try {
      const key = 'fcm_handled_call_ids';
      const handledJson = await AsyncStorage.getItem(key);
      let handled: string[] = handledJson ? JSON.parse(handledJson) : [];
      const uniqueKey = `${type}_${callId}`;
      if (!handled.includes(uniqueKey)) {
        handled.push(uniqueKey);
        if (handled.length > 50) handled = handled.slice(-50);
        await AsyncStorage.setItem(key, JSON.stringify(handled));
      }
    } catch (e) {
      console.warn('[FCMService] markCallHandled error:', e);
    }
  }

  setOnNotificationPress(cb: PressCallback) {
    this._onNotificationPress = cb;
  }

  async rejectCallAPI(callId: string): Promise<void> {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) return;
      await fetch(`${API_BASE_URL}/calls/reject/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ call_id: parseInt(callId, 10) }),
      });
      console.log('[FCMService] Call rejected via API');
    } catch (err) {
      console.error('[FCMService] rejectCallAPI error:', err);
    }
  }

  async replyMessageAPI(conversationId: string, text: string): Promise<void> {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) return;
      const res = await fetch(
        getApiUrl(`chat/conversations/${conversationId}/messages/`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: text, message_type: 'text' }),
        }
      );
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'Reply failed' });
        return;
      }
      const result = await res.json();
      Toast.show({ type: 'success', text1: 'Reply sent' });
      DeviceEventEmitter.emit('local_message_sent', {
        conversationId: parseInt(conversationId, 10),
        message: result,
      });
    } catch (err) {
      console.error('[FCMService] replyMessageAPI error:', err);
    }
  }

  async displayIncomingCallNotification(data: FCMData): Promise<void> {
    const notifId = data.call_id
      ? `incoming_call_${data.call_id}`
      : 'incoming_call_notification';

    await notifee.cancelNotification(notifId).catch(() => {});

    // Ensure largeIcon is a valid string URL or omit it completely
    const largeIcon = (data.caller_avatar && typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
      ? data.caller_avatar 
      : null;

    const notificationPayload: any = {
      id: notifId,
      title: data.notif_title || 'Incoming Call',
      body: data.notif_body || `${data.caller_name || 'Someone'} is calling…`,
      data: data as { [key: string]: string },
      android: {
        channelId: CHANNELS.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        category: 'call',
        autoCancel: false,
        ongoing: true,
        timeoutAfter: 30000,
        fullScreenAction: {
          id: 'incoming_call_fullscreen',
          launchActivity: 'com.DME.MainActivity',
          launchActivityFlags: [AndroidLaunchActivityFlag.SINGLE_TOP],
        },
        pressAction: {
          id: 'default',
          launchActivity: 'com.DME.MainActivity',
        },
        actions: [
          {
            title: 'Reject',
            pressAction: { id: ACTIONS.REJECT },
          },
          {
            title: 'Answer',
            pressAction: {
              id: ACTIONS.ANSWER,
              launchActivity: 'com.DME.MainActivity',
            },
          },
        ],
      },
    };

    if (largeIcon) {
      notificationPayload.android.largeIcon = largeIcon;
    }

    await notifee.displayNotification(notificationPayload);
  }

  async displayMissedCallNotification(data: FCMData): Promise<void> {
    if (data.call_id) {
      await notifee.cancelNotification(`incoming_call_${data.call_id}`).catch(() => {});
    }

    const largeIcon = (data.caller_avatar && typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
      ? data.caller_avatar 
      : null;

    const notificationPayload: any = {
      id: `missed_call_${data.call_id || Date.now()}`,
      title: data.notif_title || 'Missed Call',
      body: data.notif_body || `You missed a call from ${data.caller_name || 'Someone'}`,
      data: Object.entries({
        ...data,
        type: 'missed_call',
      }).reduce((acc, [key, value]) => {
        // Convert everything (booleans, numbers) cleanly to a string
        acc[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return acc;
      }, {} as Record<string, string>),
      android: {
        channelId: CHANNELS.CALL,
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
          launchActivity: 'com.DME.MainActivity',
        },
        actions: [
          {
            title: 'Call Back',
            pressAction: {
              id: ACTIONS.CALLBACK,
              launchActivity: 'com.DME.MainActivity',
            },
          },
        ],
      },
    };

    if (largeIcon) {
      notificationPayload.android.largeIcon = largeIcon;
    }

    await notifee.displayNotification(notificationPayload);
  }

  async displayGroupedMessageNotification(data: FCMData): Promise<void> {
    const convId = data.conv_id || data.conversation_id;
    if (!convId) return;

    const notifId = `chat_notif_${convId}`;
    const displayed = await notifee.getDisplayedNotifications();
    const existing = displayed.find((n) => n.id === notifId);

    let messages: any[] = (existing?.notification?.android?.style as any)?.messages ?? [];
    messages.push({
      text: data.notif_body || '',
      timestamp: Date.now(),
      person: { name: data.sender || 'Someone' },
    });
    if (messages.length > 10) messages = messages.slice(-10);

    const largeIcon = (data.sender_avatar && typeof data.sender_avatar === 'string' && data.sender_avatar.startsWith('http')) 
      ? data.sender_avatar 
      : null;

    const notificationPayload: any = {
      id: notifId,
      title: data.sender || 'New Message',
      body: data.notif_body || '',
      data: data as { [key: string]: string },
      android: {
        channelId: CHANNELS.MESSAGE,
        importance: AndroidImportance.HIGH,
        category: 'msg',
        autoCancel: true,
        pressAction: {
          id: 'default',
          launchActivity: 'com.DME.MainActivity',
        },
        style: {
          type: AndroidStyle.MESSAGING,
          person: { name: data.sender || 'Someone' },
          messages,
        },
        actions: [
          {
            title: 'Reply',
            pressAction: { id: ACTIONS.REPLY },
            input: {
              placeholder: 'Type a reply…',
              allowFreeFormInput: true,
              editableInputs: [],
              buttonLabel: 'Send',
            },
          },
        ],
      },
    };

    if (largeIcon) {
      notificationPayload.android.largeIcon = largeIcon;
    }

    await notifee.displayNotification(notificationPayload);
  }

  async displayMusicInviteNotification(data: FCMData): Promise<void> {
    const channelId = await notifee.createChannel({
      id: 'music_invites',
      name: 'Music Invitations',
      importance: AndroidImportance.HIGH,
    });

    await notifee.displayNotification({
      id: `music_invite_${data.room_code}`,
      title: data.notif_title || 'Watch Together Invitation',
      body: data.notif_body || 'Join the music room!',
      data: data,
      android: {
        channelId,
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
        },
      },
    });
  }

  async displayDefaultNotification(
    title?: string,
    body?: string,
    data?: FCMData
  ): Promise<void> {
    if (!title && !body) return;

    const largeIcon = (data?.caller_avatar && typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
      ? data.caller_avatar 
      : null;

    const notificationPayload: any = {
      title: title ?? '',
      body: body ?? '',
      data: (data ?? {}) as { [key: string]: string },
      android: {
        channelId: CHANNELS.DEFAULT,
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
          launchActivity: 'com.DME.MainActivity',
        },
      },
    };

    if (largeIcon) {
      notificationPayload.android.largeIcon = largeIcon;
    }

    await notifee.displayNotification(notificationPayload);
  }

  async routeMessage(remoteMessage: FirebaseMessagingTypes.RemoteMessage): Promise<void> {
    const data = (remoteMessage.data ?? {}) as FCMData;
    
    // ✅ NEW: Deduplicate using notif_id (sent from backend)
    const notifId = data.notif_id;
    if (notifId) {
      if (this._processedEventIds.has(notifId)) {
        console.log(`[FCMService] Deduplicating message: ${notifId}`);
        return;
      }
      this._processedEventIds.add(notifId);
      setTimeout(() => this._processedEventIds.delete(notifId), 5000); // 5s window
    }

    const title = remoteMessage.notification?.title ?? data.notif_title;
    const body = remoteMessage.notification?.body ?? data.notif_body;

    console.log('[FCMService] Routing message, type:', data.type);

    // ✅ Persistent deduplication & staleness check
    if (await this.isStaleOrDuplicate(remoteMessage)) return;

    if (Platform.OS === 'android') {
      switch (data.type) {
        case 'incoming_call': {
          if (this._isInCall) {
            console.log('[FCMService] Already in call, ignoring incoming_call');
            return;
          }

          await this.displayIncomingCallNotification(data);

          if (this._onNotificationPress) {
            console.log('[FCMService] Foreground call: navigating directly');
            this._onNotificationPress({
              ...data,
              _action: data._action ?? undefined,
            });
          }
          break;
        }

        case 'missed_call': {
          await this.displayMissedCallNotification(data);
          DeviceEventEmitter.emit('call_missed_externally', data);
          // Removed auto-navigation for missed_call to prevent unwanted screen jumps.
          // Navigation will only happen if the user actually taps the notification.
          break;
        }

        case 'cancel_call': {
          console.log('[FCMService] Call cancelled by caller, dismissing notification');
          if (data.call_id) {
            // Mark both types as handled to prevent late retries or ghost missed calls
            await this.markCallHandled(data.call_id, 'incoming_call');
            await this.markCallHandled(data.call_id, 'missed_call');
            await notifee.cancelNotification(`incoming_call_${data.call_id}`).catch(() => {});
          }
          await notifee.cancelNotification('incoming_call_notification').catch(() => {});
          
          DeviceEventEmitter.emit('call_cancelled_externally', data);
          break;
        }

        case 'new_message': {
          const convId = data.conv_id || data.conversation_id;
          if (convId && this._activeConversationId === String(convId)) return;
          await this.displayGroupedMessageNotification(data);
          break;
        }

        case 'music_invite': {
          await this.displayMusicInviteNotification(data);
          break;
        }

        default:
          await this.displayDefaultNotification(title, body, data);
          break;
      }
    } else {
      if (!remoteMessage.notification) {
        if (data.type === 'incoming_call' && !this._isInCall) {
          await this.displayIncomingCallNotification(data);
          this._onNotificationPress?.({ ...data, _action: data._action ?? undefined });
        } else if (data.type === 'new_message') {
          const convId = data.conv_id || data.conversation_id;
          if (convId && this._activeConversationId === String(convId)) return;
          await this.displayGroupedMessageNotification(data);
        } else {
          await this.displayDefaultNotification(title, body, data);
        }
      }
    }
  }

  async handleAnswerAction(data: FCMData, isFromBackground: boolean = false): Promise<void> {
    console.log('[FCMService] Handling answer action:', {
      data,
      isFromBackground,
      appState: currentAppState,
    });

    const enrichedData = {
      ...data,
      type: 'incoming_call', // Ensure type is present for navigation routing
      _action: ACTIONS.ANSWER,
      autoAccept: true,
      timestamp: Date.now(),
      fromBackground: isFromBackground,
    };

    await AsyncStorage.setItem('pending_call_answer', JSON.stringify(enrichedData));

    if (this._onNotificationPress) {
      this._onNotificationPress(enrichedData);
    }
  }

  async initialize(
    onTokenReceived?: TokenCallback,
    onNotificationPress?: PressCallback
  ): Promise<{ unsubscribe: () => void }> {
    if (onNotificationPress) this.setOnNotificationPress(onNotificationPress);

    if (Platform.OS === 'android') {
      await Promise.all([
        notifee.createChannel({
          id: CHANNELS.CALL,
          name: 'Incoming Calls',
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          vibration: true,
          sound: 'default',
          bypassDnd: true,
        }),
        notifee.createChannel({
          id: CHANNELS.MESSAGE,
          name: 'Messages',
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          vibration: true,
          sound: 'default',
        }),
        notifee.createChannel({
          id: CHANNELS.DEFAULT,
          name: 'Default',
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          vibration: true,
          sound: 'default',
        }),
      ]);
    }

    await notifee.requestPermission();

    const token = await messaging().getToken().catch(() => null);
    if (token && onTokenReceived) onTokenReceived(token);

    const unsubToken = messaging().onTokenRefresh((t) => onTokenReceived?.(t));
    const unsubMsg = messaging().onMessage((m) => this.routeMessage(m));

    const unsubBackground = notifee.onBackgroundEvent(async ({ type, detail }: Event) => {
      if (type !== EventType.ACTION_PRESS) return;

      const { notification, pressAction } = detail;
      const data = (notification?.data ?? {}) as FCMData;

      console.log('[FCMService] Notifee background event:', {
        type,
        action: pressAction?.id,
        call_id: data.call_id,
      });

      if (pressAction?.id === ACTIONS.ANSWER) {
        await notifee.cancelNotification(notification?.id || '');
        const enrichedData = {
          ...data,
          type: 'incoming_call',
          _action: ACTIONS.ANSWER,
          autoAccept: true,
        };
        await this.handleAnswerAction(enrichedData, true);
        DeviceEventEmitter.emit('fcm_action_answer', enrichedData);
      } else if (pressAction?.id === ACTIONS.REJECT) {
        await notifee.cancelNotification(notification?.id || '');
        if (data.call_id) await this.rejectCallAPI(data.call_id);

        DeviceEventEmitter.emit('fcm_action_reject', {
          ...data,
          _action: ACTIONS.REJECT,
        });
      } else if (pressAction?.id === ACTIONS.CALLBACK) {
        console.log('[FCMService] Notifee background event: CALLBACK');
        await notifee.cancelNotification(notification?.id || '');
        // Save to AsyncStorage so App.tsx can pick it up on launch/resume
        await AsyncStorage.setItem('pending_callback_call', JSON.stringify({
          ...data,
          _action: ACTIONS.CALLBACK,
          timestamp: Date.now()
        }));
      } else if (pressAction?.id === ACTIONS.REPLY) {
        const text = (detail as any).input;
        const convId = data.conv_id || data.conversation_id;
        console.log(`[FCMService] Background REPLY action for conv ${convId}, text: ${text}`);
        if (convId && text) {
          await notifee.cancelNotification(notification?.id || '');
          await this.replyMessageAPI(convId, text);
        }
      }
    });

    const unsubOpen = messaging().onNotificationOpenedApp(async (remoteMessage) => {
      const data = (remoteMessage.data ?? {}) as FCMData;
      console.log('[FCMService] App opened from notification:', data.type);

      if (data.type === 'incoming_call') {
        try {
          const pending = await AsyncStorage.getItem('pending_call_answer');
          if (pending) {
            const parsed = JSON.parse(pending);
            if (String(parsed.call_id) === String(data.call_id) && parsed.fromBackground) {
              onNotificationPress?.({
                ...data,
                autoAccept: true,
                _action: ACTIONS.ANSWER,
              });
              await AsyncStorage.removeItem('pending_call_answer');
              return;
            }
          }
        } catch (e) {
          console.warn('[FCMService] Error checking pending answer:', e);
        }

        onNotificationPress?.({
          ...data,
          autoAccept: false,
          _action: data._action || undefined,
        });
      } else {
        onNotificationPress?.(data);
      }
    });

    const unsubFore = notifee.onForegroundEvent(async ({ type, detail }: Event) => {
      if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;

      const eventId = detail.notification?.id || Math.random().toString();
      if (this._processedEventIds.has(eventId)) return;
      this._processedEventIds.add(eventId);
      setTimeout(() => this._processedEventIds.delete(eventId), 2000);

      const { notification, pressAction } = detail;
      const data = (notification?.data ?? {}) as FCMData;

      console.log(`[FCMService] Notifee event: type=${type} action=${pressAction?.id}`);

      if (type === EventType.PRESS) {
        onNotificationPress?.(data);
      } else if (type === EventType.ACTION_PRESS) {
        const actionId = pressAction?.id;

        if (actionId === ACTIONS.ANSWER) {
          await notifee.cancelNotification(notification?.id || '');
          await this.handleAnswerAction({
            ...data,
            type: 'incoming_call', // Ensure type is present
            autoAccept: true,
          }, false);
          DeviceEventEmitter.emit('fcm_action_answer', {
            ...data,
            type: 'incoming_call',
            _action: ACTIONS.ANSWER,
            autoAccept: true,
          });
        } else if (actionId === ACTIONS.REJECT) {
          await notifee.cancelNotification(notification?.id || '');
          if (data.call_id) await this.rejectCallAPI(data.call_id);

          const enrichedData = { ...data, _action: ACTIONS.REJECT };
          DeviceEventEmitter.emit('fcm_action_reject', enrichedData);
          onNotificationPress?.(enrichedData);
        } else if (actionId === ACTIONS.CALLBACK) {
          await notifee.cancelNotification(notification?.id || '');
          onNotificationPress?.({ ...data, _action: ACTIONS.CALLBACK });
        } else if (actionId === ACTIONS.REPLY) {
          const text = (detail as any).input;
          const convId = data.conv_id || data.conversation_id;
          console.log(`[FCMService] REPLY action triggered, convId: ${convId}, text: ${text}`);
          if (convId && text) {
            await notifee.cancelNotification(notification?.id || '');
            await this.replyMessageAPI(convId, text);
          } else {
            console.error(`[FCMService] REPLY failed: missing convId or text`, { convId, text });
          }
        }
      }
    });

    return {
      unsubscribe: () => {
        if (typeof unsubToken === 'function') unsubToken();
        if (typeof unsubMsg === 'function') unsubMsg();
        if (typeof unsubOpen === 'function') unsubOpen();
        if (typeof unsubFore === 'function') unsubFore();
        // unsubBackground is not a function (notifee.onBackgroundEvent returns void)
      },
    };
  }

  async getInitialNotification(): Promise<FCMData | null> {
    if (this._initialNotificationHandled) return null;
    this._initialNotificationHandled = true;

    const n = await notifee.getInitialNotification().catch(() => null);
    if (n?.notification?.data) {
      const d = { ...(n.notification.data as FCMData) };
      if (n.pressAction?.id) d._action = n.pressAction.id;

      if (d._action === ACTIONS.ANSWER) {
        d.autoAccept = true;
        d.type = 'incoming_call'; // Force type for routing
        // Dismiss it immediately
        await notifee.cancelNotification(n.notification.id || '');
      }

      console.log('[FCMService] Initial notification (Notifee):', d.type, 'Action:', d._action);
      return d;
    }

    const f = await messaging().getInitialNotification().catch(() => null);
    if (f) {
      const d = (f.data ?? {}) as FCMData;
      if (d._action === ACTIONS.ANSWER) {
        d.autoAccept = true;
        d.type = 'incoming_call';
      }

      console.log('[FCMService] Initial notification (Firebase):', d.type, 'Action:', d._action);
      return d;
    }

    return null;
  }

  async cancelIncomingCallNotification(callId?: string): Promise<void> {
    const ids = [
      'incoming_call_notification',
      ...(callId ? [`incoming_call_${callId}`] : []),
    ];
    await Promise.all(ids.map((id) => notifee.cancelNotification(id).catch(() => {})));
  }

  async cancelAllCallNotifications(): Promise<void> {
    try {
      const displayed = await notifee.getDisplayedNotifications();
      await Promise.all(
        displayed
          .filter((n) => {
            const id = n.id || '';
            return id.includes('incoming_call') || id.includes('missed_call');
          })
          .map((n) => {
            console.log('[FCMService] Cancelling:', n.id);
            return notifee.cancelNotification(n.id || '').catch(() => {});
          })
      );
    } catch (err) {
      console.error('[FCMService] cancelAllCallNotifications error:', err);
    }
  }

  async registerDevice(): Promise<void> {
    try {
      const fcmToken = await messaging().getToken();
      const accessToken = await AsyncStorage.getItem('access_token');
      if (!fcmToken || !accessToken) return;

      let deviceId = await AsyncStorage.getItem('fcm_device_id');
      if (!deviceId) {
        deviceId = Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('fcm_device_id', deviceId);
      }

      await fetch(`${API_BASE_URL}/fcm/register/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          device_id: deviceId,
          registration_token: fcmToken,
          platform: Platform.OS,
        }),
      });
      console.log('[FCMService] Device registered');
    } catch (e) {
      console.error('[FCMService] registerDevice error:', e);
    }
  }

  async unregisterDevice(): Promise<void> {
    try {
      const accessToken = await AsyncStorage.getItem('access_token');
      const deviceId = await AsyncStorage.getItem('fcm_device_id');
      if (!accessToken || !deviceId) return;
      await fetch(`${API_BASE_URL}/fcm/remove/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ device_id: deviceId }),
      });
    } catch (e) {
      console.error('[FCMService] unregisterDevice error:', e);
    }
  }

  cleanup() {}
}

export const fcmService = new FCMService();
export default fcmService;