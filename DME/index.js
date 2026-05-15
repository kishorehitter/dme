/** 
  @format
 */

import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import 'event-target-polyfill';
import { decode, encode } from 'base64-arraybuffer';

// Polyfill for AbortController
if (typeof global.AbortController === 'undefined') {
  const { AbortController, AbortSignal } = require('abort-controller');
  global.AbortController = AbortController;
  global.AbortSignal = AbortSignal;
}

// Polyfill for ReadableStream, WritableStream, and TransformStream
if (
  typeof global.ReadableStream === 'undefined' ||
  typeof global.WritableStream === 'undefined' ||
  typeof global.TransformStream === 'undefined'
) {
  const streams = require('web-streams-polyfill');
  if (typeof global.ReadableStream === 'undefined') {
    global.ReadableStream = streams.ReadableStream;
  }
  if (typeof global.WritableStream === 'undefined') {
    global.WritableStream = streams.WritableStream;
  }
  if (typeof global.TransformStream === 'undefined') {
    global.TransformStream = streams.TransformStream;
  }
}

// Polyfill for Event and others if missing
if (typeof global.Event === 'undefined') {
  const { Event, CustomEvent } = require('event-target-polyfill');
  global.Event = Event;
  global.CustomEvent = CustomEvent;
}

// Polyfill for TextEncoder / TextDecoder
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('text-encoding');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Polyfill for navigator.userAgent
if (typeof navigator !== 'undefined' && !navigator.userAgent) {
  navigator.userAgent = 'ReactNative';
}

import { AppRegistry, DeviceEventEmitter } from 'react-native';
import { registerGlobals } from '@livekit/react-native-webrtc';
import App from './App';

// Register LiveKit WebRTC globals
registerGlobals();

import messaging from '@react-native-firebase/messaging';
import notifee, {
  AndroidImportance,
  EventType,
  AndroidStyle,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './src/config/network';
import { name as appName } from './app.json';

// Standard action IDs for calls
const ACTIONS = {
  ANSWER: 'answer_call',
  REJECT: 'reject_call',
  REPLY: 'reply_message',
  CALLBACK: 'callback',
};

// CHANNEL IDs
const CHANNELS = {
  CALL: 'incoming_call_channel',
  MESSAGE: 'message_reply_channel',
  DEFAULT: 'default_channel',
};

async function isDuplicateBgCall(callId, type, sentTime) {
  if (!callId || !type) return false;

  // 1. Check for stale incoming calls (> 45s old)
  if (type === 'incoming_call' && sentTime) {
    const age = Date.now() - sentTime;
    if (age > 45000) {
      console.log(`[FCM Background] Ignoring stale incoming_call (age: ${age}ms)`);
      return true;
    }
  }

  // 2. Persistent deduplication
  try {
    const key = 'fcm_handled_call_ids';
    const handledJson = await AsyncStorage.getItem(key);
    let handled = handledJson ? JSON.parse(handledJson) : [];
    
    const uniqueKey = `${type}_${callId}`;
    if (handled.includes(uniqueKey)) {
      console.log(`[FCM Background] Persistent deduplication hit for ${uniqueKey}`);
      return true;
    }

    // Add to handled list, keep last 50 entries
    handled.push(uniqueKey);
    if (handled.length > 50) handled = handled.slice(-50);
    await AsyncStorage.setItem(key, JSON.stringify(handled));
  } catch (e) {
    console.warn('[FCM Background] Deduplication storage error:', e);
  }

  return false;
}

async function markCallHandled(callId, type = 'incoming_call') {
  if (!callId) return;
  try {
    const key = 'fcm_handled_call_ids';
    const handledJson = await AsyncStorage.getItem(key);
    let handled = handledJson ? JSON.parse(handledJson) : [];
    const uniqueKey = `${type}_${callId}`;
    if (!handled.includes(uniqueKey)) {
      handled.push(uniqueKey);
      if (handled.length > 50) handled = handled.slice(-50);
      await AsyncStorage.setItem(key, JSON.stringify(handled));
    }
  } catch (e) {}
}

/**
 * Register background message handler (MUST be at top level)
 * This handles DATA-ONLY messages when app is in background or killed
 */
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('[FCM Background] message received:', remoteMessage);

  const { data } = remoteMessage;
  if (!data) return;

  // Persistent deduplication & staleness check
  if (await isDuplicateBgCall(data.call_id, data.type, remoteMessage.sentTime)) return;

  // 1. Handle Incoming Call
  if (data.type === 'incoming_call') {
    // Reset missed count for this caller
    if (data.caller_id) {
      AsyncStorage.removeItem(`missed_count_${data.caller_id}`).catch(() => {});
    }

    const callId = data.call_id;
    const notifId = callId ? `incoming_call_${callId}` : 'incoming_call_notification';

    // Cancel ALL previous incoming call notifications to be safe
    try {
      const displayed = await notifee.getDisplayedNotifications();
      for (const n of displayed) {
        if (n.id === 'incoming_call_notification' || n.id.startsWith('incoming_call_')) {
          await notifee.cancelNotification(n.id);
        }
      }
    } catch (err) {
      console.error('[FCM Background] Error cancelling old notifications:', err);
    }

    await notifee.createChannel({
      id: CHANNELS.CALL,
      name: 'Incoming Calls',
      importance: AndroidImportance.HIGH,
      vibration: true,
      sound: 'default',
      bypassDnd: true,
    });

    const largeIcon = (typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
      ? data.caller_avatar 
      : null;

    const notificationPayload = {
      id: notifId,
      title: data.notif_title || 'Incoming Call',
      body: data.notif_body || `${data.caller_name || 'Someone'} is calling...`,
      data: data,
      android: {
        channelId: CHANNELS.CALL,
        importance: AndroidImportance.HIGH,
        visibility: 1, // VISIBILITY_PUBLIC
        category: 'call',
        fullScreenAction: {
          id: ACTIONS.ANSWER,
          launchActivity: 'default',
        },
        pressAction: {
          id: 'default',
          launchActivity: 'default',
        },
        autoCancel: false,
        ongoing: true, // Prevent swipe away
        timeoutAfter: 30000, // 30 seconds auto-timeout
        actions: [
          {
            id: ACTIONS.ANSWER,
            title: 'Answer',
            pressAction: {
              id: ACTIONS.ANSWER,
              launchActivity: 'default', // MUST open app
            },
          },
          {
            id: ACTIONS.REJECT,
            title: 'Reject',
            pressAction: {
              id: ACTIONS.REJECT,
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

  // 2. Handle Missed Call
  else if (data.type === 'missed_call') {
    const callId = data.call_id;
    
    // Cancel the specific incoming call notification
    if (callId) {
      await markCallHandled(callId, 'incoming_call');
      await notifee.cancelNotification(`incoming_call_${callId}`).catch(() => {});
    }
    await notifee.cancelNotification('incoming_call_notification').catch(() => {});

    await displayMissedCallNotification(data);
  }

  // 3. Handle Cancel Call (Caller hung up before answer)
  else if (data.type === 'cancel_call') {
    const callId = data.call_id;
    if (callId) {
      await markCallHandled(callId, 'incoming_call');
      await markCallHandled(callId, 'missed_call');
      await notifee.cancelNotification(`incoming_call_${callId}`).catch(() => {});
    }
    await notifee.cancelNotification('incoming_call_notification').catch(() => {});
  }

  // 4. Handle New Message (WhatsApp Style Grouping)
  else if (data.type === 'new_message') {
    await displayGroupedNotification(data);
  }
});

/**
 * Helper to display grouped messaging style notification (WhatsApp style)
 */
async function displayGroupedNotification(data) {
  const convId = data.conv_id || data.conversation_id;
  if (!convId) return;

  const notificationId = `chat_notif_${convId}`;

  // Get all displayed notifications to check for existing one
  const displayedNotifications = await notifee.getDisplayedNotifications();
  const existingNotification = displayedNotifications.find(
    n => n.id === notificationId,
  );

  let messages = [];
  if (
    existingNotification &&
    existingNotification.notification.android?.style?.messages
  ) {
    messages = [...existingNotification.notification.android.style.messages];
  }

  // Add the new message to the list
  messages.push({
    text: data.notif_body || '',
    timestamp: Date.now(),
    person: {
      name: data.sender || 'Someone',
    },
  });

  // Keep only the last 10 messages for display
  if (messages.length > 10) {
    messages.shift();
  }

  await notifee.createChannel({
    id: CHANNELS.MESSAGE,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
  });

  const largeIcon = (typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
    ? data.caller_avatar 
    : null;

  const notificationPayload = {
    id: notificationId,
    title: data.sender || 'New Message',
    body: data.notif_body || '',
    data: data,
    android: {
      channelId: CHANNELS.MESSAGE,
      importance: AndroidImportance.HIGH,
      category: 'msg',
      autoCancel: true,
      pressAction: {
        id: 'default',
        launchActivity: 'default',
      },
      style: {
        type: AndroidStyle.MESSAGING,
        person: {
          name: data.sender || 'Someone',
        },
        messages: messages,
      },
      actions: [
        {
          id: ACTIONS.REPLY,
          title: '💬 Reply',
          input: true,
          pressAction: {
            id: ACTIONS.REPLY,
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

/**
 * Display grouped missed call notifications (WhatsApp style)
 */
async function displayMissedCallNotification(data) {
  const callerId = data.caller_id;
  if (!callerId) return;

  const notifId = `missed_call_${callerId}`;
  const storageKey = `missed_count_${callerId}`;
  
  // Get and increment missed count
  let count = 1;
  try {
    const saved = await AsyncStorage.getItem(storageKey);
    if (saved) count = parseInt(saved, 10) + 1;
    await AsyncStorage.setItem(storageKey, String(count));
  } catch (e) {}

  const title = count > 1 ? `${count} Missed Calls` : 'Missed Call';
  const body = count > 1 
    ? `${data.caller_name || 'Someone'} (${count} calls)` 
    : `You missed a call from ${data.caller_name || 'Someone'}`;

  await notifee.createChannel({
    id: CHANNELS.CALL,
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH,
  });

  const largeIcon = (typeof data.caller_avatar === 'string' && data.caller_avatar.startsWith('http')) 
    ? data.caller_avatar 
    : null;

  const notificationPayload = {
    id: notifId,
    title: title,
    body: body,
    data: {
      ...data,
      type: 'missed_call',
    },
    android: {
      channelId: CHANNELS.CALL,
      importance: AndroidImportance.HIGH,
      pressAction: {
        id: 'default',
        launchActivity: 'default',
      },
      actions: [
        {
          id: ACTIONS.CALLBACK,
          title: '📞 Call Back',
          pressAction: {
            id: ACTIONS.CALLBACK,
            launchActivity: 'default',
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

/**
 * API call to reject a call from background
 */
async function handleRejectCall(callId) {
  try {
    console.log('[index.js] handleRejectCall called with callId:', callId);

    const token = await AsyncStorage.getItem('access_token');
    if (!token) {
      console.error('[index.js] No auth token found for rejecting call');
      return;
    }

    console.log('[index.js] Sending reject request to API...');

    const response = await fetch(`${API_BASE_URL}/calls/reject/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ call_id: parseInt(callId, 10) }),
    });

    if (response.ok) {
      console.log(
        '[index.js] ✅ Call rejected successfully via background API',
      );
    } else {
      const errorData = await response.json().catch(() => null);
      console.error(
        '[index.js] ❌ Failed to reject call, status:',
        response.status,
        errorData,
      );
    }

    // Cancel the call notification after rejecting
    const notifId = callId
      ? `incoming_call_${callId}`
      : 'incoming_call_notification';
    await notifee.cancelNotification(notifId);
    console.log('[index.js] Cancelled notification:', notifId);
  } catch (err) {
    console.error('[index.js] Error rejecting call:', err);
  }
}

/**
 * Handle Notifee background events (e.g., button clicks when app is killed)
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;
  console.log(`[Notifee Background] Event Type: ${type}, Action: ${pressAction?.id}`);

  if (type === EventType.ACTION_PRESS) {
    const callData = notification?.data || {};
    
    if (pressAction.id === ACTIONS.ANSWER) {
      console.log('[Notifee Background] Answer call pressed - storing pending answer');
      const enrichedData = { 
        ...callData, 
        _action: ACTIONS.ANSWER,
        timestamp: Date.now(),
        fromBackground: true 
      };
      await AsyncStorage.setItem('pending_call_answer', JSON.stringify(enrichedData));
      const notifId = callData.call_id ? `incoming_call_${callData.call_id}` : 'incoming_call_notification';
      await notifee.cancelNotification(notifId);
    } else if (pressAction.id === ACTIONS.REJECT) {
      console.log('[Notifee Background] Reject call pressed');
      const callId = callData.call_id;
      const notifId = callId ? `incoming_call_${callId}` : 'incoming_call_notification';
      await notifee.cancelNotification(notifId);
      if (callId) await handleRejectCall(callId);
    } else if (pressAction.id === ACTIONS.CALLBACK) {
      console.log('[Notifee Background] Call back pressed');
      const enrichedData = { 
        ...callData, 
        _action: ACTIONS.CALLBACK,
        timestamp: Date.now()
      };
      await AsyncStorage.setItem('pending_callback_call', JSON.stringify(enrichedData));
      await notifee.cancelNotification(notification.id);
    } else if (pressAction.id === ACTIONS.REPLY) {
      const text = detail.input;
      const convId = callData.conv_id || callData.conversation_id;
      console.log(`[Notifee Background] REPLY action, convId: ${convId}, text: ${text}`);
      
      if (convId && text) {
        await notifee.cancelNotification(notification.id);
        
        try {
          const token = await AsyncStorage.getItem('access_token');
          console.log(`[Notifee Background] Token found: ${!!token}`);
          
          if (token) {
            const url = `${API_BASE_URL}/chat/conversations/${convId}/messages/`;
            console.log(`[Notifee Background] Fetching: ${url}`);
            
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ content: text, message_type: 'text' }),
            });
            
            if (response.ok) {
              console.log('[Notifee Background] Reply sent successfully');
            } else {
              const errBody = await response.text();
              console.error(`[Notifee Background] Reply failed: ${response.status} - ${errBody}`);
            }
          }
        } catch (err) {
          console.error('[Notifee Background] Reply API error:', err);
        }
      } else {
        console.warn('[Notifee Background] Missing convId or text');
      }
    }
  }
});

AppRegistry.registerComponent(appName, () => App);
