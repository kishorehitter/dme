/**
 * ChatRoomScreen v7
 * REAL FIXES:
 * 1. SCROLL: Use inverted={true} FlatList with reversed messages array
 *    - This ALWAYS starts at bottom, no scrollToEnd needed
 * 2. AUDIO: WhatsApp-style audio player with smooth progress
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
  Animated,
  PanResponder,
  Linking,
  DeviceEventEmitter,
  Alert,
} from 'react-native';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { chatAPI } from '../../services/api';
import { websocketService, WebSocketMessage } from '../../services/websocket';
import { spacing, borderRadius, fontSize, colors } from '../../utils/theme';
import { Message } from '../../types';
import { useAuth } from '../../context/AuthContext';
import audioRecorder from '../../modules/AudioRecorder';
import AudioPlayer from '../../components/AudioPlayer';
import { pick, types, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import fcmService from '../../services/fcm';
import notifee from '@notifee/react-native';
import Icon from 'react-native-vector-icons/Ionicons';

import FullScreenMediaViewer from '../../components/FullScreenMediaViewer';
import { API_BASE_URL, getApiUrl } from '../../config/network';
import { resolveImageUrl } from '../../utils/image';

const THEME_COLOR = '#8100D1';
const SENT_COLOR = '#B0B0B0';
const BASE_URL = API_BASE_URL.replace('/api', '');

const HeaderAvatar = ({ uri, isGroup, chatTitle, style }: any) => {
  const [error, setError] = useState(false);

  if (!uri || error) {
    if (isGroup) {
      return (
        <View style={[style, { backgroundColor: THEME_COLOR, justifyContent: 'center', alignItems: 'center' }]}>
          <Icon name="people" size={24} color="#FFF" />
        </View>
      );
    }
    return (
      <View style={[style, styles.avatarPlaceholder]}>
        <Text style={styles.headerAvatarText}>
          {(chatTitle || 'U').charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: resolveImageUrl(uri) }}
      style={style}
      onError={() => setError(true)}
    />
  );
};

const MessageAvatar = ({ uri, sName, style }: any) => {
  const [error, setError] = useState(false);

  if (!uri || error) {
    return (
      <View style={[style, styles.avatarPlaceholder]}>
        <Text style={styles.avatarText}>
          {(sName || 'U').charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: resolveImageUrl(uri) }}
      style={style}
      onError={() => setError(true)}
    />
  );
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
interface OtherUser {
  id: number;
  display_name: string;
  first_name: string;
  email: string;
  profile_picture: string | null;
  avatar_sticker: string | null;
  status: string;
  last_seen: string;
}

export const ChatRoomScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { conversationId, name } = route.params;
  const { user: currentUser } = useAuth();

  // Dismiss notifications for this conversation on mount and when conversationId changes
  useEffect(() => {
    fcmService.setActiveConversation(String(conversationId));

    const dismissNotifications = async () => {
      try {
        const notifications = await notifee.getDisplayedNotifications();
        for (const notification of notifications) {
          if (
            notification.notification.data?.conv_id === String(conversationId) &&
            notification.id
          ) {
            await notifee.cancelNotification(notification.id);
          }
        }
      } catch (err) {
        console.error('Error dismissing notifications:', err);
      }
    };
    dismissNotifications();

    return () => {
      fcmService.setActiveConversation(null);
    };
  }, [conversationId]);

  // FIX 1: Store messages in REVERSED order for inverted FlatList
  // inverted FlatList shows last item first (bottom) without any scrollToEnd
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<any>(null); // Added
  const [isGroup, setIsGroup] = useState(false); // Added
  const [groupDescription, setGroupDescription] = useState(''); // Added
  const [activeGroupCall, setActiveGroupCall] = useState<any>(null); // Restore this
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [oldestMessageId, setOldestMessageId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [isUserBlocked, setIsUserBlocked] = useState(false); // Whether current user blocked other
  const [amIBlocked, setAmIBlocked] = useState(false); // Whether other user blocked current user
  const [chatTitle, setChatTitle] = useState(name || 'Chat');
  const [shouldSkipLoad, setShouldSkipLoad] = useState(false); // Skip loading messages
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false); // Scroll to bottom button
  const [showMessageActions, setShowMessageActions] = useState(false); // Instagram-style long press menu
  const [recentEmojis, setRecentEmojis] = useState<string[]>([
    '❤️',
    '😂',
    '😮',
    '😢',
    '😡',
  ]); // Last 5 used emojis
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState(false); // Full emoji picker overlay
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null); // Message being edited
  const [isConversationDeleted, setIsConversationDeleted] = useState(false); // Track if conversation was deleted
  const [highlightMessageId, setHighlightMessageId] = useState<number | null>(null); // Message to highlight
  const [searchMode, setSearchMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]); // Indices of matches
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);

  // Double-tap reaction animation state
  const [mediaErrorIds, setMediaErrorIds] = useState<number[]>([]);
  const [doubleTapReaction, setDoubleTapReaction] = useState<{
    visible: boolean;
    x: number;
    y: number;
    messageId: number | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    messageId: null,
  });
  const doubleTapScale = useRef(new Animated.Value(0)).current;
  const doubleTapOpacity = useRef(new Animated.Value(0)).current;
  const lastTapTimeRef = useRef<number>(0);
  const doubleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isCancelled, setIsCancelled] = useState(false);
  const [slideOffset, setSlideOffset] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatIsActiveRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);

  // Recording refs
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micButtonScale = useRef(new Animated.Value(1)).current;
  const isRecordingRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideX = useRef(new Animated.Value(0)).current;
  const isCancelledRef = useRef(false);
  const recordingTimeRef = useRef(0);
  const animationRef = useRef<any>(null);
  const isHoldingRef = useRef(false);
  const currentScrollOffset = useRef(0);
  const contentHeightRef = useRef(0);

  const EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🎉'];

  useEffect(() => {
    // Check if chat should be cleared or deleted (from navigation params)
    const params = route?.params;
    const isCleared = params?.cleared === true;
    const isDeleted = params?.deleted === true;

    // If conversation was deleted, redirect to chat list
    if (isDeleted) {
      console.log('Conversation deleted, redirecting to chat list');
      setIsConversationDeleted(true);
      websocketService.disconnect();
      navigation.goBack();
      return;
    }

    // Set skip flag BEFORE loading messages
    if (isCleared) {
      setShouldSkipLoad(true);
      setMessages([]);
      setOldestMessageId(null);
      console.log('Chat cleared - skipping message load');
    }

    loadConversationDetails();
    connectWebSocket();

    // Only load messages if not cleared
    if (!isCleared) {
      loadMessages();
    }

    // Scroll to specific message if ID provided
    const scrollToId = route.params?.scrollToMessageId;
    if (scrollToId) {
      setTimeout(() => {
        const index = messagesRef.current.findIndex(m => m.id === scrollToId);
        if (index >= 0) {
            setHighlightMessageId(scrollToId);
            try {
              flatListRef.current?.scrollToIndex({ 
                index, 
                animated: true, 
                viewPosition: 0.5 
              });
            } catch (err) {
              console.warn('ScrollToIndex failed initially:', err);
              // Fallback to offset if needed, though onScrollToIndexFailed usually handles this
            }
        }
      }, 1000); // Give it time to load and render
    }

    // Activate search mode if requested
    if (route.params?.searchMode) {
      setSearchMode(true);
    }

    const focusSub = navigation.addListener('focus', () => {
      chatIsActiveRef.current = true;
      const unread = messagesRef.current.some(
        m => m.sender.id !== currentUser?.id && !m.is_read,
      );
      if (unread) markAsRead();
    });

    const blurSub = navigation.addListener('blur', () => {
      chatIsActiveRef.current = false;
    });

    return () => {
      websocketService.disconnect();
      focusSub();
      blurSub();
      cleanupRecording();
      if (doubleTapTimeoutRef.current)
        clearTimeout(doubleTapTimeoutRef.current);
    };
  }, [conversationId]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('local_message_sent', data => {
      if (data.conversationId === parseInt(conversationId, 10)) {
        console.log('ChatRoomScreen: Instant update from notification reply');
        const nm = data.message;
        setMessages(prev => {
          const arr = Array.isArray(prev) ? prev : [];
          if (arr.some(m => m.id === nm.id)) return arr;
          return [nm, ...arr];
        });
      }
    });
    return () => sub.remove();
  }, [conversationId]);

  useEffect(() => {
    const unsub = websocketService.onMessage(handleWebSocketMessage);
    return () => {
      unsub();
    };
  }, [currentUser]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Check for blocked status from navigation params
  useEffect(() => {
    const params = route?.params;

    if (params?.isBlocked !== undefined) {
      setIsUserBlocked(params.isBlocked);
    }

    if (params?.cleared) {
      // Clear messages locally when chat was cleared
      console.log('Clearing messages locally due to cleared flag');
      setMessages([]);
      setOldestMessageId(null);
      setShouldSkipLoad(true);
    }

    // Check if conversation was deleted
    if (params?.deleted) {
      console.log('Conversation deleted, redirecting to chat list');
      setIsConversationDeleted(true);
      websocketService.disconnect();
      navigation.goBack();
    }
  }, [route?.params, conversationId]);

  const cleanupRecording = () => {
    if (recordingIntervalRef.current)
      clearInterval(recordingIntervalRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (animationRef.current) animationRef.current.stop();
  };

  const requestPermission = async (): Promise<boolean> => {
    const perm = Platform.OS === 'ios' ? PERMISSIONS.IOS.MICROPHONE : PERMISSIONS.ANDROID.RECORD_AUDIO;
    const status = await check(perm);
    
    if (status === RESULTS.GRANTED) return true;
    
    if (status === RESULTS.DENIED) {
      const result = await request(perm);
      return result === RESULTS.GRANTED;
    }
    
    if (status === RESULTS.BLOCKED) {
      Alert.alert('Permission Blocked', 'Microphone access is blocked. Please enable it in Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settings', onPress: () => openSettings() }
      ]);
    }
    return false;
  };

  const loadConversationDetails = async () => {
    try {
      const data = await chatAPI.getConversation(conversationId);
      setConversation(data); // Add this line
      setIsGroup(data.is_group);
      setGroupDescription(data.description || '');

      if (data.is_group) {
        setChatTitle(data.name || 'Group Chat');
        // Check for active group call
        const activeCall = data.group_calls?.find((c: any) => c.is_active);
        if (activeCall) setActiveGroupCall(activeCall);
      } else {
        const other = data?.participants?.find(
          (p: any) => p.user && p.user.id !== currentUser?.id,
        );
        if (other?.user) {
          setOtherUser(other.user);
          setChatTitle(
            other.user.display_name ||
              other.user.first_name ||
              other.user.email ||
              'Unknown',
          );

          // Check if user is blocked (from params or API)
          const params = route?.params;
          if (params?.isBlocked !== undefined) {
            setIsUserBlocked(params.isBlocked);
          } else {
            await checkBlockStatus(other.user.id);
          }

          // Check if I'm blocked by this user
          await checkIfAmIBlocked(other.user.id);
        }
      }
    } catch (error) {
      console.log(
        'Could not load conversation details, using name from params:',
        name,
      );
      if (name) setChatTitle(name);
    }
  };

  const checkBlockStatus = async (userId: number) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`accounts/users/${userId}/block-status/`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        setIsUserBlocked(data.blocked || false);
      }

      // Also check if I'm blocked by this user (reverse check would need a different endpoint)
      // For now, we'll use a heuristic: if last_seen is very old but they're connecting to WebSocket, they might have blocked us
      // Better approach: add a new endpoint to check if I'm blocked
    } catch (error) {
      console.error('Error checking block status:', error);
    }
  };

  const checkIfAmIBlocked = async (userId: number) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      // Check if the other user has blocked me by trying to send a test message
      // Actually, we need a proper endpoint for this
      // For now, we'll use a heuristic: if last_seen is very old but they're connecting to WebSocket, they might have blocked us
      // Better approach: add a new endpoint to check if I'm blocked
      const response = await fetch(
        getApiUrl(`accounts/users/${userId}/blocked-by-status/`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        setAmIBlocked(data.blocked_by || false);
      }
    } catch (error) {
      // Endpoint might not exist yet, that's okay
      console.log('Could not check if blocked by user');
    }
  };

  const loadMessages = async () => {
    // Skip loading if chat was cleared
    if (shouldSkipLoad) {
      console.log('Skipping message load - chat cleared');
      return;
    }

    try {
      const data = await chatAPI.getMessages(conversationId);
      const arr: Message[] = Array.isArray(data) ? data : data?.results ?? [];

      if (arr.length > 0) {
        setOldestMessageId(arr[0].id);
        setHasMoreMessages(arr.length >= 50);
      }

      // FIX 1: Reverse for inverted FlatList
      // inverted FlatList renders last item at visual bottom
      // So we reverse: newest message at index 0 = shown at bottom
      setMessages([...arr].reverse());

      if (chatIsActiveRef.current) {
        const hasUnread = arr.some(
          m => m.sender.id !== currentUser?.id && !m.is_read,
        );
        if (hasUnread) markAsRead();
      }
    } catch {
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Load older messages when user scrolls to bottom of inverted list (= top visually)
  const loadOlderMessages = async () => {
    if (isLoadingOlder || !hasMoreMessages || !oldestMessageId) return;
    setIsLoadingOlder(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const url = `${BASE_URL}/api/chat/conversations/${conversationId}/messages/?limit=50&before_id=${oldestMessageId}`;
      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        const older: Message[] = Array.isArray(data)
          ? data
          : data.results ?? [];
        if (older.length > 0) {
          setOldestMessageId(older[0].id);
          setHasMoreMessages(older.length >= 50);
          // FIX 1: Append to end of reversed array (= top visually in inverted list)
          setMessages(prev => [
            ...(Array.isArray(prev) ? prev : []),
            ...older.reverse(),
          ]);
        } else {
          setHasMoreMessages(false);
        }
      }
    } catch {
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const markAsRead = async () => {
    try {
      await chatAPI.markAsRead(conversationId);
      setMessages(prev =>
        (Array.isArray(prev) ? prev : []).map(m =>
          m.sender.id !== currentUser?.id ? { ...m, is_read: true } : m,
        ),
      );
    } catch {}
  };

  const connectWebSocket = async () => {
    try {
      await websocketService.connect(conversationId);
    } catch {}
  };

  const handleWebSocketMessage = (wsMsg: WebSocketMessage) => {
    const _type = (wsMsg.type as unknown) as string;
    switch (_type) {
      case 'message': {
        const isOwn = wsMsg.data.sender?.id === currentUser?.id;
        const nm: Message = {
          ...wsMsg.data,
          reactions: wsMsg.data.reactions ?? {},
          delivered_at: !isOwn
            ? wsMsg.data.delivered_at || new Date().toISOString()
            : wsMsg.data.delivered_at,
        };
        setMessages(prev => {
          const arr = Array.isArray(prev) ? prev : [];
          if (isOwn) {
            const idx = arr.findIndex(
              m =>
                m.id > 1000000000 &&
                m.content === nm.content &&
                m.sender.id === currentUser?.id,
            );
            if (idx >= 0) {
              const next = [...arr];
              next[idx] = nm;
              return next;
            }
            return arr;
          }
          if (arr.some(m => m.id === nm.id)) return arr;
          // FIX 1: Prepend to reversed array (newest at index 0)
          return [nm, ...arr];
        });
        if (chatIsActiveRef.current && !isOwn) {
          setTimeout(() => markAsRead(), 100);
        }
        break;
      }
      case 'typing':
        if (wsMsg.data.user_id !== currentUser?.id) {
          setTypingUsers(prev => {
            const arr = Array.isArray(prev) ? prev : [];
            if (wsMsg.data.is_typing && !arr.includes(wsMsg.data.user_name))
              return [...arr, wsMsg.data.user_name];
            if (!wsMsg.data.is_typing)
              return arr.filter((u: string) => u !== wsMsg.data.user_name);
            return arr;
          });
        }
        break;
      case 'delivered':
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            wsMsg.data.message_ids?.includes(m.id) &&
            m.sender.id === currentUser?.id
              ? { ...m, delivered_at: new Date().toISOString() }
              : m,
          ),
        );
        break;
      case 'read_receipt':
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            wsMsg.data.message_ids?.includes(m.id)
              ? { ...m, is_read: true }
              : m,
          ),
        );
        break;
      case 'reaction':
        console.log('💬 WebSocket reaction received:', wsMsg.data);
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            m.id === wsMsg.data.message_id
              ? { ...m, reactions: wsMsg.data.reactions || {} }
              : m,
          ),
        );
        console.log(
          '💬 Reaction state updated for message:',
          wsMsg.data.message_id,
        );
        break;
      case 'group_call':
        console.log('📞 Group call event received:', wsMsg.data);
        if (
          wsMsg.data.event === 'started' ||
          wsMsg.data.event === 'user_joined'
        ) {
          setActiveGroupCall({
            id: wsMsg.data.call_id,
            room_id: wsMsg.data.room_id,
            call_type: wsMsg.data.call_type || 'audio',
            is_active: true,
          });
          Toast.show({
            type: 'info',
            text1: 'Group call active',
            text2: `${wsMsg.data.user_name} joined the call`,
            position: 'top',
          });
        } else if (wsMsg.data.event === 'ended') {
          setActiveGroupCall(null);
        }
        break;
    }
  };

  const sendMessage = async (content?: string) => {
    const text = (content ?? inputText).trim();
    if (!text || isSending) return;

    // If editing a message
    if (editingMessageId) {
      try {
        await chatAPI.editMessage(editingMessageId, text);
        // Update the message in the list
        setMessages(prev =>
          prev.map(m =>
            m.id === editingMessageId ? { ...m, content: text } : m,
          ),
        );
        setInputText('');
        setEditingMessageId(null);
        Toast.show({
          type: 'success',
          text1: 'Message edited',
          position: 'bottom',
        });
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Failed to edit',
          position: 'bottom',
        });
      }
      return;
    }

    setIsSending(true);
    setInputText('');
    setHighlightMessageId(null); // Clear any active highlight when sending a new message

    if (websocketService.getConnectionState()) {
      const optimistic: any = {
        id: Date.now(),
        conversation: conversationId,
        sender: {
          id: currentUser!.id,
          email: currentUser!.email || '',
          display_name:
            currentUser!.display_name || currentUser!.first_name || '',
          profile_picture: null,
          avatar_sticker: null,
        },
        content: text,
        message_type: 'text',
        is_read: false,
        delivered_at: null,
        created_at: new Date().toISOString(),
        reactions: {},
        reply_to: replyToMessage
          ? {
              id: replyToMessage.id,
              content: replyToMessage.content,
              sender: replyToMessage.sender,
            }
          : null,
      };
      // FIX 1: Prepend to reversed array
      setMessages(prev => [optimistic, ...(Array.isArray(prev) ? prev : [])]);
      websocketService.sendMessage(text, replyToMessage?.id);
      setReplyToMessage(null);
      setIsSending(false);

      // Auto-scroll to bottom after sending reply
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 100);
    } else {
      try {
        const token = await AsyncStorage.getItem('access_token');
        const body: any = { content: text, message_type: 'text' };
        if (replyToMessage) body.reply_to = replyToMessage.id;
        const res = await fetch(
          `${BASE_URL}/api/chat/conversations/${conversationId}/messages/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          },
        );
        if (res.ok) {
          const nm = await res.json();
          setMessages(prev => [nm, ...(Array.isArray(prev) ? prev : [])]);
          setReplyToMessage(null);
          // Auto-scroll to bottom after sending reply
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          }, 100);
        }
      } catch {
        setInputText(text);
      } finally {
        setIsSending(false);
      }
    }
  };

  const sendReaction = async (messageId: number, emoji: string) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      setMessages(prev =>
        (Array.isArray(prev) ? prev : []).map(m =>
          m.id === messageId
            ? {
                ...m,
                reactions: { ...m.reactions, [String(currentUser?.id)]: emoji },
              }
            : m,
        ),
      );
      if (websocketService.getConnectionState())
        websocketService.sendReaction(messageId, emoji);
      await fetch(`${BASE_URL}/api/chat/messages/${messageId}/react/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ emoji }),
      });
      setShowEmojiPicker(false);
      setSelectedMessage(null);
    } catch {}
  };

  const toggleReaction = async (messageId: number, emoji: string) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const currentUserId = String(currentUser?.id);

      // Check if user already has this reaction
      let hasReaction = false;
      setMessages(prev => {
        const msg = prev.find(m => m.id === messageId);
        if (msg && msg.reactions && msg.reactions[currentUserId] === emoji) {
          hasReaction = true;
        }
        return prev;
      });

      // Wait a bit for state to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      if (hasReaction) {
        // Remove reaction - update local state first
        setMessages(prev =>
          prev.map(m => {
            if (
              m.id === messageId &&
              m.reactions &&
              m.reactions[currentUserId] === emoji
            ) {
              const newReactions = { ...m.reactions };
              delete newReactions[currentUserId];
              return { ...m, reactions: newReactions };
            }
            return m;
          }),
        );

        // Call API to remove reaction (send empty emoji or use DELETE if available)
        // For now, we'll just update locally since backend may not support removal
        console.log('Reaction removed locally');
      } else {
        // Add reaction
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { ...m, reactions: { ...m.reactions, [currentUserId]: emoji } }
              : m,
          ),
        );

        if (websocketService.getConnectionState())
          websocketService.sendReaction(messageId, emoji);

        await fetch(`${BASE_URL}/api/chat/messages/${messageId}/react/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ emoji }),
        });
      }
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
  };

  const handleTyping = (text: string) => {
    setInputText(text);
    if (websocketService.getConnectionState())
      websocketService.sendTyping(!!text);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (websocketService.getConnectionState())
        websocketService.sendTyping(false);
    }, 2000);
  };

  // Functional camera handler: Launch directly with video/photo mode
  const handleCameraCapture = () => {
    Alert.alert('Camera', 'Choose mode', [
      {
        text: '📷 Photo',
        onPress: async () => {
          const perm = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
          const status = await check(perm);
          
          if (status === RESULTS.DENIED) {
            const requested = await request(perm);
            if (requested !== RESULTS.GRANTED) {
              Alert.alert('Permission Denied', 'Camera access is required. Please enable it in Settings.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Settings', onPress: () => openSettings() }
              ]);
              return;
            }
          } else if (status === RESULTS.BLOCKED) {
            Alert.alert('Permission Blocked', 'Camera access is blocked. Please enable it in Settings.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Settings', onPress: () => openSettings() }
            ]);
            return;
          }

          const result = await launchCamera({ mediaType: 'photo', quality: 0.85, saveToPhotos: true });
          if (result.didCancel || result.errorCode) return;
          const asset = result.assets?.[0];
          if (asset?.uri) await sendImageMessage(asset);
        },
      },
      {
        text: '🎥 Video',
        onPress: async () => {
          const perm = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
          const status = await check(perm);
          
          if (status === RESULTS.DENIED) {
            const requested = await request(perm);
            if (requested !== RESULTS.GRANTED) {
              Alert.alert('Permission Denied', 'Camera access is required. Please enable it in Settings.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Settings', onPress: () => openSettings() }
              ]);
              return;
            }
          } else if (status === RESULTS.BLOCKED) {
            Alert.alert('Permission Blocked', 'Camera access is blocked. Please enable it in Settings.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Settings', onPress: () => openSettings() }
            ]);
            return;
          }

          const result = await launchCamera({ mediaType: 'video', videoQuality: 'medium', durationLimit: 30 });
          if (result.didCancel || result.errorCode) return;
          const asset = result.assets?.[0];
          if (asset?.uri) await sendImageMessage(asset);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleAttachment = async () => {
    Alert.alert('Attach File', 'Select an option', [
      {
        text: '🖼️ Gallery',
        onPress: async () => {
          try {
            const result = await launchImageLibrary({
              mediaType: 'mixed',
              quality: 0.85,
              selectionLimit: 1,
            });
            if (result.didCancel || result.errorCode) return;
            const asset = result.assets?.[0];
            if (asset?.uri) await sendImageMessage(asset);
          } catch (error) {
            console.error('Gallery error:', error);
          }
        },
      },
      {
        text: '📄 Document',
        onPress: async () => {
          try {
            const [res] = await pick({
              type: [types.allFiles],
              allowMultiSelection: false,
            });
            if (res) {
              await sendDocumentMessage(res);
            }
          } catch (err: any) {
            if (err?.code !== errorCodes.OPERATION_CANCELED) {
              console.error('DocumentPicker error:', err);
            }
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendDocumentMessage = async (doc: any) => {
    setIsSending(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('content', '');
      fd.append('message_type', 'document');
      fd.append('media_file', {
        uri: doc.uri,
        type: doc.type || 'application/octet-stream',
        name: doc.name || 'document',
      } as any);

      const res = await fetch(
        `${BASE_URL}/api/chat/conversations/${conversationId}/messages/`,
        {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'multipart/form-data',
          },
          body: fd,
        },
      );

      if (res.ok) {
        const nm = await res.json();
        setMessages(prev => [nm, ...(Array.isArray(prev) ? prev : [])]);
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      console.error('Document upload error:', e);
      Toast.show({ type: 'error', text1: 'Failed to send document' });
    } finally {
      setIsSending(false);
    }
  };

  const sendImageMessage = async (asset: any) => {
    setIsSending(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('content', '');
      
      const isVideo = asset.type?.startsWith('video') || asset.uri.endsWith('.mp4') || asset.uri.endsWith('.mov');
      const messageType = isVideo ? 'video' : 'image';
      
      fd.append('message_type', messageType);
      fd.append('media_file', {
        uri: asset.uri,
        type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        name: asset.fileName || `${messageType}_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
      } as any);

      console.log(`[Chat] Sending ${messageType} message:`, asset.uri);
      
      const res = await fetch(
        `${BASE_URL}/api/chat/conversations/${conversationId}/messages/`,
        {
          method: 'POST',
          headers: { 
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'multipart/form-data',
          },
          body: fd,
        },
      );

      if (res.ok) {
        const nm = await res.json();
        setMessages(prev => [nm, ...(Array.isArray(prev) ? prev : [])]);
      } else {
        const errorText = await res.text();
        console.error('[Chat] Upload failed:', res.status, errorText);
        throw new Error(`Upload failed: ${res.status}`);
      }
    } catch (e) {
      console.error('[Chat] Exception during upload:', e);
      Toast.show({
        type: 'error',
        text1: 'Failed to send media',
        text2: 'Please check your connection and try again',
        position: 'bottom',
      });
    } finally {
      setIsSending(false);
    }
  };

  // ── VOICE RECORDING ──────────────────────────────
  const startTimer = () => {
    if (recordingIntervalRef.current)
      clearInterval(recordingIntervalRef.current);
    recordingTimeRef.current = 0;
    setRecordingTime(0);
    recordingIntervalRef.current = setInterval(() => {
      recordingTimeRef.current += 1;
      setRecordingTime(recordingTimeRef.current);
    }, 1000);
  };

  const stopTimer = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    recordingTimeRef.current = 0;
    setRecordingTime(0);
  };

  const startPulse = () => {
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(micButtonScale, {
          toValue: 1.3,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(micButtonScale, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    animationRef.current = p;
    p.start();
  };

  const stopPulse = () => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    micButtonScale.setValue(1);
  };

  const startRecordingProcess = async () => {
    isRecordingRef.current = true;
    isCancelledRef.current = false;
    setIsRecording(true);
    setIsCancelled(false);
    slideX.setValue(0);
    setSlideOffset(0);
    startTimer();
    startPulse();
    try {
      await audioRecorder.startRecording();
    } catch {
      isRecordingRef.current = false;
      setIsRecording(false);
      stopTimer();
      stopPulse();
      Toast.show({
        type: 'error',
        text1: 'Recording Error',
        text2: 'Check microphone permission',
        position: 'bottom',
      });
    }
  };

  const stopRecordingAndSend = async () => {
    if (!isRecordingRef.current) return;
    // Capture the duration BEFORE stopping the timer
    const finalDuration = recordingTimeRef.current;
    stopTimer();
    stopPulse();
    isRecordingRef.current = false;
    isCancelledRef.current = false;
    setIsRecording(false);
    setIsCancelled(false);
    slideX.setValue(0);
    setSlideOffset(0);
    try {
      const path = await audioRecorder.stopRecording();
      if (path) await sendVoiceMessage(path, finalDuration);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Recording Error',
        position: 'bottom',
      });
    }
  };

  const cancelRecordingProcess = async () => {
    if (!isRecordingRef.current) return;
    stopTimer();
    stopPulse();
    isRecordingRef.current = false;
    isCancelledRef.current = false;
    setIsRecording(false);
    setIsCancelled(false);
    slideX.setValue(0);
    setSlideOffset(0);
    try {
      await audioRecorder.cancelRecording();
    } catch {}
    Toast.show({
      type: 'info',
      text1: 'Recording cancelled',
      position: 'bottom',
    });
  };

  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: async () => {
        isHoldingRef.current = true;
        if (isRecordingRef.current) return;
        
        const ok = await requestPermission();
        if (!ok) {
          isHoldingRef.current = false;
          return;
        }

        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        holdTimerRef.current = setTimeout(() => {
          if (isHoldingRef.current) startRecordingProcess();
        }, 1000);
      },
      onPanResponderMove: (_, g) => {
        if (!isRecordingRef.current) return;
        if (g.dx < -10) {
          const off = Math.min(Math.abs(g.dx), 120);
          slideX.setValue(-off * 0.5);
          setSlideOffset(off);
          if (off > 80 && !isCancelledRef.current) {
            isCancelledRef.current = true;
            setIsCancelled(true);
          } else if (off <= 80 && isCancelledRef.current) {
            isCancelledRef.current = false;
            setIsCancelled(false);
          }
        } else {
          slideX.setValue(0);
          setSlideOffset(0);
          if (isCancelledRef.current) {
            isCancelledRef.current = false;
            setIsCancelled(false);
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        isHoldingRef.current = false;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true }).start();
        setSlideOffset(0);
        if (!isRecordingRef.current) return;
        if (isCancelledRef.current || g.dx < -80) cancelRecordingProcess();
        else stopRecordingAndSend();
      },
      onPanResponderTerminate: () => {
        isHoldingRef.current = false;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        if (isRecordingRef.current) cancelRecordingProcess();
      },
    }),
  ).current;

  const sendVoiceMessage = async (filePath: string, duration: number) => {
    setIsSending(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const uri = !filePath.startsWith('file://')
        ? `file://${filePath}`
        : filePath;
      const fd = new FormData();
      fd.append('content', 'Voice message');
      fd.append('message_type', 'audio');
      fd.append('media_file', {
        uri,
        type: 'audio/mp4',
        name: `v_${Date.now()}.m4a`,
      } as any);
      // Send the actual recording duration
      fd.append('duration', duration.toString());

      return new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `${BASE_URL}/api/chat/conversations/${conversationId}/messages/`,
        );
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () => {
          setIsSending(false);
          if (xhr.status >= 200 && xhr.status < 300) {
            const nm = JSON.parse(xhr.responseText);
            // Store the actual duration with the message
            const messageWithDuration = { ...nm, audio_duration: duration };
            setMessages(prev => [
              messageWithDuration,
              ...(Array.isArray(prev) ? prev : []),
            ]);
            res(nm);
          } else {
            console.error('Upload failed:', xhr.status, xhr.responseText);
            Toast.show({
              type: 'error',
              text1: `Upload failed (${xhr.status})`,
              position: 'bottom',
            });
            rej(new Error(String(xhr.status)));
          }
        };
        xhr.onerror = () => {
          setIsSending(false);
          Toast.show({
            type: 'error',
            text1: 'Network error',
            position: 'bottom',
          });
          rej(new Error('network'));
        };
        xhr.send(fd);
      });
    } catch {
      setIsSending(false);
    }
  };

  // ── FORMATTERS ──────────────────────────────────
  const fmtRec = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(
      2,
      '0',
    )}`;
  const fmtMsgTime = (d: string) =>
    new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtLastSeen = (d: string | null) => {
    // If last_seen is null, user is currently online
    if (!d) return 'Online';

    const now = Date.now();
    const lastSeenTime = new Date(d).getTime();
    const diffMs = now - lastSeenTime;
    const diffMin = diffMs / 60000;
    const diffHours = diffMs / 3600000;
    const diffDays = diffMs / 86400000;

    // If less than 2 minutes, show "Online" (they just disconnected)
    if (diffMin < 2) return 'Online';
    // If less than 60 minutes, show minutes
    if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
    // If today (less than 24 hours), show time
    if (diffHours < 24) {
      const lastSeenDate = new Date(lastSeenTime);
      const hours = lastSeenDate.getHours();
      const minutes = lastSeenDate.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHour = hours % 12 || 12;
      return `Today at ${displayHour}:${minutes
        .toString()
        .padStart(2, '0')} ${ampm}`;
    }
    // If yesterday, show yesterday with time
    if (diffDays < 2) {
      const lastSeenDate = new Date(lastSeenTime);
      const hours = lastSeenDate.getHours();
      const minutes = lastSeenDate.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHour = hours % 12 || 12;
      return `Yesterday at ${displayHour}:${minutes
        .toString()
        .padStart(2, '0')} ${ampm}`;
    }
    // Otherwise show date with time
    const lastSeenDate = new Date(lastSeenTime);
    return lastSeenDate.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const jumpToMessage = (id: number) => {
    const idx = messages.findIndex(m => m.id === id);
    if (idx >= 0) {
      try {
        flatListRef.current?.scrollToIndex({
          index: idx,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (err) {
        console.warn('jumpToMessage scroll failed:', err);
      }
    }
  };

  // Scroll to bottom button handler
  const scrollToBottom = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowScrollToBottom(false);
    setHighlightMessageId(null); // Clear highlight when returning to bottom
  };

  // Handle scroll to show/hide scroll-to-bottom button
  const handleOnScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    // Show button when scrolled up more than 200px from bottom
    setShowScrollToBottom(offset > 200);

    // If we are highlighted and scroll back to very bottom, clear highlight
    if (highlightMessageId && offset < 20) {
        setHighlightMessageId(null);
    }
  };

  // Instagram-style long press menu handlers
  const handleMessageLongPress = (item: Message) => {
    setSelectedMessage(item);
    setShowMessageActions(true);
  };

  // Double-tap to react with heart
  const handleMessagePress = (item: Message, event: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (doubleTapTimeoutRef.current) {
      clearTimeout(doubleTapTimeoutRef.current);
      doubleTapTimeoutRef.current = null;
    }

    if (now - lastTapTimeRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected!
      handleDoubleTapReaction(item);
      lastTapTimeRef.current = 0;
    } else {
      // First tap - wait to see if there's a second tap
      doubleTapTimeoutRef.current = setTimeout(() => {
        // If timeout completes, it was a single tap
        lastTapTimeRef.current = 0;
        doubleTapTimeoutRef.current = null;
        
        // OPEN MEDIA ON SINGLE TAP
        if (item.message_type === 'image') {
           navigation.navigate('MediaViewer', { mediaUrl: resolveImageUrl((item as any).media_url || item.media_file), mediaType: 'image' });
        } else if (item.message_type === 'video') {
           navigation.navigate('MediaViewer', { mediaUrl: resolveImageUrl((item as any).media_url || item.media_file), mediaType: 'video' });
        }
      }, DOUBLE_TAP_DELAY);
      lastTapTimeRef.current = now;
    }
  };

  const handleDoubleTapReaction = (item: Message) => {
    // Show the heart animation in center of screen
    setDoubleTapReaction({ visible: true, x: 0, y: 0, messageId: item.id });

    // Run the pop animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(doubleTapScale, {
          toValue: 1.5,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(doubleTapOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(doubleTapScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(doubleTapOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setDoubleTapReaction({ visible: false, x: 0, y: 0, messageId: null });
      doubleTapScale.setValue(0);
      doubleTapOpacity.setValue(0);
    });

    // Toggle the heart reaction (add if not present, remove if present)
    toggleReaction(item.id, '❤️');
  };

  const handleSearchTextChange = (text: string) => {
    setSearchText(text);
    if (!text.trim()) {
      setSearchResults([]);
      setCurrentResultIndex(-1);
      return;
    }

    const term = text.toLowerCase();
    const matches: number[] = [];
    messages.forEach((m, index) => {
      if (m.content?.toLowerCase().includes(term)) {
        matches.push(index);
      }
    });

    setSearchResults(matches);
    if (matches.length > 0) {
      setCurrentResultIndex(0);
      // Optional: auto-scroll to the first match
      jumpToSearchIndex(matches[0]);
    } else {
      setCurrentResultIndex(-1);
    }
  };

  const jumpToSearchIndex = (index: number) => {
    try {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
      // Optionally highlight the message ID
      setHighlightMessageId(messages[index].id);
    } catch (err) {
      console.warn('jumpToSearchIndex failed:', err);
    }
  };

  const goToNextResult = () => {
    if (searchResults.length === 0) return;
    const nextIndex = (currentResultIndex + 1) % searchResults.length;
    setCurrentResultIndex(nextIndex);
    jumpToSearchIndex(searchResults[nextIndex]);
  };

  const goToPrevResult = () => {
    if (searchResults.length === 0) return;
    const prevIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentResultIndex(prevIndex);
    jumpToSearchIndex(searchResults[prevIndex]);
  };

  const renderSearchBar = () => {
    if (!searchMode) return null;
    return (
      <View style={styles.searchBar}>
        <TouchableOpacity onPress={() => { setSearchMode(false); setSearchText(''); setSearchResults([]); setCurrentResultIndex(-1); }}>
          <Icon name="arrow-back" size={24} color="#666" />
        </TouchableOpacity>
        <TextInput
          style={styles.searchInput}
          placeholder="Search messages..."
          value={searchText}
          onChangeText={handleSearchTextChange}
          autoFocus
        />
        {searchResults.length > 0 && (
          <View style={styles.searchNav}>
            <Text style={styles.searchCount}>
              {currentResultIndex + 1} of {searchResults.length}
            </Text>
            <TouchableOpacity onPress={goToPrevResult} style={styles.searchNavButton}>
              <Icon name="chevron-up" size={24} color={THEME_COLOR} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goToNextResult} style={styles.searchNavButton}>
              <Icon name="chevron-down" size={24} color={THEME_COLOR} />
            </TouchableOpacity>
          </View>
        )}
        {searchText.length > 0 && !searchResults.length && (
            <TouchableOpacity onPress={() => {setSearchText(''); setSearchResults([]); setCurrentResultIndex(-1);}}>
                <Icon name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
        )}
      </View>
    );
  };

  const handleQuickReaction = async (emoji: string) => {
    if (!selectedMessage) return;

    // Add to recent emojis
    setRecentEmojis(prev => {
      const filtered = prev.filter(e => e !== emoji);
      return [emoji, ...filtered].slice(0, 5);
    });

    await sendReaction(selectedMessage.id, emoji);
    setShowMessageActions(false);
    setSelectedMessage(null);
  };

  const handleReplyFromMenu = () => {
    if (!selectedMessage) return;
    setReplyToMessage(selectedMessage);
    setShowMessageActions(false);
    setSelectedMessage(null);
  };

  const handleEditMessage = () => {
    if (!selectedMessage) return;

    // Open message in input box for editing
    setInputText(selectedMessage.content);
    setEditingMessageId(selectedMessage.id);
    setShowMessageActions(false);
    setSelectedMessage(null);
  };

  const handleDeleteMessage = async () => {
    if (!selectedMessage) return;

    try {
      await chatAPI.deleteMessage(selectedMessage.id);

      // Update the message in the list to show as deleted
      setMessages(prev =>
        prev.map(m =>
          m.id === selectedMessage.id
            ? { ...m, is_deleted: true, content: 'The message was removed' }
            : m,
        ),
      );

      setShowMessageActions(false);
      setSelectedMessage(null);
      Toast.show({
        type: 'success',
        text1:
          selectedMessage.sender.id === currentUser?.id
            ? 'Message unsent'
            : 'Message deleted',
        position: 'bottom',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Failed to delete',
        position: 'bottom',
      });
    }
  };

  // ── RENDER MESSAGE ───────────────────────────────
  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender.id === currentUser?.id;
    const sName =
      item.sender.display_name ||
      item.sender.first_name ||
      item.sender.email ||
      'Unknown';
    const reaction = item.reactions?.[String(currentUser?.id)];
    const allReactions = item.reactions || {};
    const hasReactions = Object.keys(allReactions).length > 0;

    // Handle deleted messages
    if (item.is_deleted) {
      return (
        <View
          style={[
            styles.messageContainer,
            isMe ? styles.myMessageContainer : styles.theirMessageContainer,
          ]}
        >
          {!isMe && (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              {item.sender.avatar_sticker ? (
                <Text style={{ fontSize: 20 }}>
                  {item.sender.avatar_sticker}
                </Text>
              ) : item.sender.profile_picture ? (
                <Image
                  source={{ uri: resolveImageUrl(item.sender.profile_picture) }}
                  style={styles.avatar}
                />
              ) : (
                <Text style={styles.avatarText}>
                  {sName.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
          )}
          <View
            style={[
              styles.messageBubble,
              isMe ? styles.myMessageBubble : styles.theirMessageBubble,
              { backgroundColor: '#F5F5F5' },
            ]}
          >
            <Text
              style={[
                styles.messageText,
                { color: '#999', fontStyle: 'italic' },
              ]}
            >
              {item.content || 'The message was removed'}
            </Text>
          </View>
        </View>
      );
    }
  const renderMedia = () => {
    if (item.is_deleted) return null;
    const rawUrl = (item as any).media_url || item.media_file;
    const url = resolveImageUrl(rawUrl);
    
    const isStatusReply = item.content?.startsWith('↩ Replied to status');
    const hasMediaError = mediaErrorIds.includes(item.id);

    const timeOverlay = (
      <View style={styles.mediaTimeOverlay}>
        <Text style={styles.mediaTimeText}>{fmtMsgTime(item.created_at)}</Text>
      </View>
    );

    // If media failed to load and it's a status reply, show expiration placeholder
    if ((!url || hasMediaError) && isStatusReply) {
      return (
        <View style={[styles.imageContainer, { backgroundColor: '#F5F5F5', borderStyle: 'dashed', borderWidth: 1, borderColor: '#DDD' }]}>
          <Icon name="time-outline" size={40} color="#BBB" />
          <Text style={{ color: '#999', fontSize: 13, marginTop: 8, fontWeight: '600' }}>Status expired</Text>
          {timeOverlay}
        </View>
      );
    }

    if (!url) return null;

    const isImage = item.message_type === 'image' || 
                    (item.media_file && /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(item.media_file));

// Stable, fixed placeholder to prevent reflows during scroll
const MediaPreview = ({ url, style, onPress }: any) => {
  return (
    <TouchableOpacity 
      onPress={onPress} 
      style={[
        style, 
        { 
          aspectRatio: 16 / 9, // WhatsApp uses a consistent base aspect ratio for previews
          backgroundColor: '#E8E8E8', 
          borderRadius: borderRadius.lg,
          overflow: 'hidden'
        }
      ]}
    >
      <Image 
        source={{ uri: url }} 
        style={{ width: '100%', height: '100%' }} 
        resizeMode="cover" 
      />
    </TouchableOpacity>
  );
};

// ... inside renderMedia:

    if (isImage)
      return (
        <TouchableOpacity 
          style={styles.imageContainer}
          onPress={(e) => handleMessagePress(item, e)}
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.9}
          delayLongPress={500}
        >
          <Image 
            source={{ uri: url }} 
            style={styles.fixedMedia} 
            resizeMode="contain" 
            onError={() => {
              console.log('Media load error for message:', item.id);
              setMediaErrorIds(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
            }}
          />
          {timeOverlay}
        </TouchableOpacity>
      );

    if (item.message_type === 'audio')
      return (
        <View style={styles.audioContainer}>
          <AudioPlayer
            mediaUrl={url}
            themeColor={THEME_COLOR}
            duration={item.audio_duration}
            messageId={item.id}
          />
          {timeOverlay}
        </View>
      );

    if (item.message_type === 'video' || (item.media_file?.toLowerCase().endsWith('.mp4') || item.media_file?.toLowerCase().endsWith('.mov')))
      return (
        <TouchableOpacity
          style={styles.videoContainer}
          onPress={(e) => handleMessagePress(item, e)}
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.9}
          delayLongPress={500}
        >
          <View style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Icon name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
          </View>
          {timeOverlay}
        </TouchableOpacity>
      );      return null;
    };

    const renderHighlightedText = (text: string, term: string) => {
        if (!term || !text) return <Text>{text}</Text>;
        
        const parts = text.split(new RegExp(`(${term})`, 'gi'));
        return (
            <Text>
                {parts.map((part, i) => (
                    <Text 
                        key={i} 
                        style={part.toLowerCase() === term.toLowerCase() ? styles.highlightedText : null}
                    >
                        {part}
                    </Text>
                ))}
            </Text>
        );
    };

    return (
      <View
        style={[
          styles.messageContainer,
          isMe ? styles.myMessageContainer : styles.theirMessageContainer,
        ]}
      >
        {!isMe && (
          <MessageAvatar
            uri={item.sender.profile_picture}
            sName={sName}
            style={styles.avatar}
          />
        )}

        <TouchableOpacity
          style={[
            styles.messageBubble,
            isMe ? styles.myMessageBubble : styles.theirMessageBubble,
            highlightMessageId === item.id && { 
              backgroundColor: isMe ? '#D0BCFF' : '#E0E0E0',
              borderWidth: 2,
              borderColor: THEME_COLOR 
            }
          ]}
          onPress={e => handleMessagePress(item, e)}
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.8}
          delayLongPress={500}
        >
          {item.reply_to && (
            <TouchableOpacity
              style={styles.replyIndicator}
              onPress={() => jumpToMessage(item.reply_to.id)}
              activeOpacity={0.7}
            >
              <View style={styles.replyIndicatorLine} />
              <View style={styles.replyIndicatorContentWrapper}>
                <Text style={styles.replyIndicatorText} numberOfLines={1}>
                  {item.reply_to.sender?.id === currentUser?.id
                    ? 'You'
                    : item.reply_to.sender?.display_name || 'User'}
                </Text>
                <Text style={styles.replyIndicatorContent} numberOfLines={2}>
                  {item.reply_to.content}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {!isMe && isGroup && <Text style={styles.senderName}>{sName}</Text>}

          {/* Media inside bubble - no background/padding wrapper here */}
          {renderMedia()}

          {(item.message_type === 'text' || (!!item.content && !['image', 'video', 'voice note', 'voice message', 'document', 'media'].includes(item.content.toLowerCase()))) && (
            <Text
              style={[
                styles.messageText,
                isMe ? styles.myMessageText : styles.theirMessageText,
                item.message_type !== 'text' && { marginTop: 6 }
              ]}
            >
              {renderHighlightedText(item.content, searchText)}
            </Text>
          )}

          {hasReactions && (
            <View style={styles.reactionBadge}>
              {Object.entries(allReactions).map(([userId, emoji]) => (
                <Text key={userId} style={styles.reactionEmoji}>
                  {emoji}
                </Text>
              ))}
            </View>
          )}

          {/* Footer only for non-media messages to avoid double time */}
          {!['image', 'video', 'audio', 'voice note'].includes(item.message_type) && (
            <View style={styles.messageFooter}>
                <Text
                style={[
                    styles.messageTime,
                    isMe ? styles.myMessageTime : styles.theirMessageTime,
                ]}
                >
                {fmtMsgTime(item.created_at)}
                </Text>
                {isMe && (
                <Text style={styles.messageStatus}>
                    {item.is_read ? (
                    <Text style={styles.seenText}>✓✓</Text>
                    ) : item.delivered_at ? (
                    <Text style={styles.deliveredText}>✓✓</Text>
                    ) : (
                    <Text style={styles.sentText}>✓</Text>
                    )}
                </Text>
                )}
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={THEME_COLOR} />
      </View>
    );
  }

  const renderGroupCallBanner = () => {
    if (!activeGroupCall || !isGroup) return null;
    return (
      <View style={styles.callBanner}>
        <Text style={styles.callBannerText}>📞 Group call in progress...</Text>
        <TouchableOpacity
          style={styles.joinButton}
          onPress={() => {
            navigation.navigate('Call', {
              callType: activeGroupCall.call_type,
              room_id: activeGroupCall.room_id,
              conversationId: conversationId,
              isGroupCall: true,
            });
          }}
        >
          <Text style={styles.joinButtonText}>Join</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      {searchMode ? renderSearchBar() : (
      <View style={styles.customHeader}>
        <TouchableOpacity 
           style={styles.headerBackButton}
           onPress={() => navigation.goBack()}
        >
          <Text><Icon name="arrow-back" size={24} color={THEME_COLOR} /></Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() =>
            isGroup
              ? navigation.navigate('GroupInfo', { conversationId })
              : otherUser &&
                navigation.navigate('Profile', {
                  user: otherUser,
                  conversationId,
                })
          }
          activeOpacity={0.7}
        >
          {isGroup ? (
            <HeaderAvatar
              uri={conversation?.profile_picture}
              isGroup={true}
              style={styles.headerAvatar}
            />
          ) : (
            otherUser &&
            (otherUser.avatar_sticker ? (
              <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
                <Text style={styles.headerSticker}>
                  {otherUser.avatar_sticker}
                </Text>
              </View>
            ) : (
              <HeaderAvatar
                uri={otherUser.profile_picture}
                isGroup={false}
                chatTitle={chatTitle}
                style={styles.headerAvatar}
              />
            ))
          )}

          <View style={styles.headerTextContainer}>
            <Text style={styles.headerName} numberOfLines={1}>
              {chatTitle}
            </Text>
            <Text style={styles.headerStatus}>
              {isGroup
                ? groupDescription || 'Group details'
                : otherUser
                ? amIBlocked
                  ? ''
                  : fmtLastSeen(otherUser.last_seen) === 'Online'
                  ? 'Online'
                  : `Last seen ${fmtLastSeen(otherUser.last_seen)}`
                : ''}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.callIcon}
            onPress={() => {
              if (isGroup) {
                navigation.navigate('Call', {
                  callType: 'video',
                  conversationId: conversationId,
                  isGroupCall: true,
                  initiating: true,
                });
              } else if (otherUser) {
                navigation.navigate('Call', {
                  callType: 'video',
                  remoteUserId: otherUser.id,
                  remoteUserName: chatTitle,
                  remoteUserPic: otherUser.profile_picture,
                  conversationId: conversationId,
                });
              }
            }}
            activeOpacity={0.7}
          >
            <Icon name="videocam" size={22} color={THEME_COLOR} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.callIcon}
            onPress={() => {
              if (isGroup) {
                navigation.navigate('Call', {
                  callType: 'audio',
                  conversationId: conversationId,
                  isGroupCall: true,
                  initiating: true,
                });
              } else if (otherUser) {
                navigation.navigate('Call', {
                  callType: 'audio',
                  remoteUserId: otherUser.id,
                  remoteUserName: chatTitle,
                  remoteUserPic: otherUser.profile_picture,
                  conversationId: conversationId,
                });
              }
            }}
            activeOpacity={0.7}
          >
            <Icon name="call" size={20} color={THEME_COLOR} />
          </TouchableOpacity>
        </View>
      </View>
      )}

      {renderGroupCallBanner()}

      {/* FIX 1: inverted FlatList - always starts at bottom, no scrollToEnd needed */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={[styles.messagesList, { paddingBottom: 8 }]}
        inverted={true}
        // Load older messages when user scrolls to top (= onEndReached in inverted list)
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.3}
        onScroll={handleOnScroll}
        onScrollToIndexFailed={info => {
            console.warn('ScrollToIndex failed, retrying after layout...', info);
            const wait = setTimeout(() => {
                flatListRef.current?.scrollToIndex({ 
                    index: info.index, 
                    animated: true, 
                    viewPosition: 0.5 
                });
            }, 500);
            return () => clearTimeout(wait);
        }}
        scrollEventThrottle={16}
        ListFooterComponent={
          isLoadingOlder ? (
            <View style={styles.loadingOlderContainer}>
              <ActivityIndicator size="small" color={THEME_COLOR} />
              <Text style={styles.loadingOlderText}>
                Loading older messages...
              </Text>
            </View>
          ) : null
        }
        initialNumToRender={30}
        maxToRenderPerBatch={20}
        windowSize={10}
        removeClippedSubviews={false}
        ListEmptyComponent={
          !isLoading && searchText ? (
            <View style={styles.emptySearchContainer}>
              <Icon name="search-outline" size={48} color="#DDD" />
              <Text style={styles.emptySearchText}>No messages found</Text>
            </View>
          ) : null
        }
      />

      {/* Scroll to bottom button */}
      {showScrollToBottom && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={scrollToBottom}
          activeOpacity={0.8}
        >
          <Icon name="chevron-down" size={24} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* Typing */}
      {typingUsers.length > 0 && (
        <View style={styles.typingContainer}>
          <Text style={styles.typingText}>
            {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
          </Text>
        </View>
      )}

      {/* Reply preview */}
      {replyToMessage && (
        <View style={styles.replyPreview}>
          <View style={styles.replyPreviewContent}>
            <Text style={styles.replyPreviewTitle}>
              Replying to{' '}
              {replyToMessage.sender.id === currentUser?.id
                ? 'yourself'
                : replyToMessage.sender.display_name || 'User'}
            </Text>
            <Text style={styles.replyPreviewText} numberOfLines={2}>
              {replyToMessage.content}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setReplyToMessage(null)}
            style={styles.cancelReplyButton}
          >
            <Icon name="close" size={20} color="#666" />
          </TouchableOpacity>
        </View>
      )}

      {/* Emoji picker */}
      <Modal
        visible={showEmojiPicker}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowEmojiPicker(false);
          setSelectedMessage(null);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowEmojiPicker(false);
            setSelectedMessage(null);
          }}
        >
          <View style={styles.emojiPicker}>
            <Text style={styles.emojiPickerTitle}>React with</Text>
            <View style={styles.emojiGrid}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  style={styles.emojiButton}
                  onPress={() =>
                    selectedMessage && sendReaction(selectedMessage.id, e)
                  }
                >
                  <Text style={styles.emoji}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {selectedMessage && (
              <View style={styles.messageActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    if (selectedMessage) {
                      setReplyToMessage(selectedMessage);
                      setShowEmojiPicker(false);
                      setSelectedMessage(null);
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-undo-outline"
                      size={20}
                      color={THEME_COLOR}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.actionButtonText}>Reply</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Double-tap reaction animation overlay */}
      {doubleTapReaction.visible && (
        <View style={styles.doubleTapOverlay}>
          <Animated.View
            style={[
              styles.doubleTapReaction,
              {
                transform: [{ scale: doubleTapScale }],
                opacity: doubleTapOpacity,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.doubleTapHeart}>❤️</Text>
          </Animated.View>
        </View>
      )}

      {/* Instagram-style message actions menu */}
      <Modal
        visible={showMessageActions}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowMessageActions(false);
          setSelectedMessage(null);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowMessageActions(false);
            setSelectedMessage(null);
          }}
        >
          <View style={styles.messageActionsContainer}>
            {/* Horizontal emoji row */}
            <View style={styles.emojiRow}>
              {recentEmojis.map((emoji, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.emojiQuickButton}
                  onPress={() => handleQuickReaction(emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.emojiQuick}>{emoji}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.emojiQuickButton}
                onPress={() => {
                  setShowFullEmojiPicker(true);
                  setShowMessageActions(false);
                }}
                activeOpacity={0.7}
              >
                <Icon name="add" size={28} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Vertical actions menu */}
            <View style={styles.actionsColumn}>
              <TouchableOpacity
                style={styles.actionMenuItem}
                onPress={handleReplyFromMenu}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon
                    name="arrow-undo-outline"
                    size={20}
                    color="#333"
                    style={{ marginRight: 12 }}
                  />
                  <Text style={styles.actionMenuItemText}>Reply</Text>
                </View>
              </TouchableOpacity>
              {selectedMessage?.sender.id === currentUser?.id && (
                <>
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={handleEditMessage}
                  >
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Icon
                        name="create-outline"
                        size={20}
                        color="#333"
                        style={{ marginRight: 12 }}
                      />
                      <Text style={styles.actionMenuItemText}>Edit</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={handleDeleteMessage}
                  >
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Icon
                        name="trash-outline"
                        size={20}
                        color="#FF4444"
                        style={{ marginRight: 12 }}
                      />
                      <Text
                        style={[
                          styles.actionMenuItemText,
                          { color: '#FF4444' },
                        ]}
                      >
                        Unsend
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
              {selectedMessage?.sender.id !== currentUser?.id && (
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={handleDeleteMessage}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="trash-outline"
                      size={20}
                      color="#FF4444"
                      style={{ marginRight: 12 }}
                    />
                    <Text
                      style={[styles.actionMenuItemText, { color: '#FF4444' },]}
                    >
                      Delete
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full emoji picker overlay */}
      <Modal
        visible={showFullEmojiPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFullEmojiPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFullEmojiPicker(false)}
        >
          <View style={styles.emojiPicker}>
            <Text style={styles.emojiPickerTitle}>All Emojis</Text>
            <View style={styles.emojiGrid}>
              {[
                '❤️',
                '😂',
                '😍',
                '😮',
                '😢',
                '😡',
                '👍',
                '👎',
                '🎉',
                '🔥',
                '✨',
                '💯',
                '😎',
                '🤔',
                '👏',
                '🙏',
              ].map(e => (
                <TouchableOpacity
                  key={e}
                  style={styles.emojiButton}
                  onPress={() => {
                    handleQuickReaction(e);
                    setShowFullEmojiPicker(false);
                  }}
                >
                  <Text style={styles.emoji}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Permission modal */}
      <Modal
        visible={showPermissionModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.permissionModalOverlay}>
          <View style={styles.permissionModal}>
            <Icon
              name="mic"
              size={48}
              color={THEME_COLOR}
              style={{ marginBottom: spacing.md }}
            />
            <Text style={styles.permissionModalTitle}>
              Microphone Access Required
            </Text>
            <Text style={styles.permissionModalMessage}>
              Allow microphone access to record voice messages.
            </Text>
            <View style={styles.permissionModalButtons}>
              <TouchableOpacity
                style={[styles.permissionButton, styles.allowButton]}
                onPress={() => {
                  setShowPermissionModal(false);
                  Linking.openSettings();
                }}
              >
                <Text
                  style={[
                    styles.permissionButtonText,
                    styles.permissionButtonTextWhite,
                  ]}
                >
                  Allow Access
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.permissionButton, styles.notNowButton]}
                onPress={() => setShowPermissionModal(false)}
              >
                <Text
                  style={[
                    styles.permissionButtonText,
                    styles.permissionButtonTextDark,
                  ]}
                >
                  Not Now
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Input bar */}
      {isUserBlocked ? (
        <View style={styles.blockedContainer}>
          <Text style={styles.blockedText}>You have blocked this user</Text>
          <TouchableOpacity
            style={styles.unblockButton}
            onPress={async () => {
              if (!otherUser?.id) return;
              try {
                const token = await AsyncStorage.getItem('access_token');
                const response = await fetch(
                  getApiUrl(`accounts/users/${otherUser.id}/block/`),
                  {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ blocked: false }),
                  },
                );
                if (response.ok) {
                  setIsUserBlocked(false);
                  Toast.show({
                    type: 'success',
                    text1: 'User unblocked',
                    position: 'bottom',
                  });
                }
              } catch (error) {
                Toast.show({
                  type: 'error',
                  text1: 'Failed to unblock user',
                  position: 'bottom',
                });
              }
            }}
          >
            <Text style={styles.unblockButtonText}>Unblock User</Text>
          </TouchableOpacity>
        </View>
      ) : amIBlocked ? (
        <View style={styles.blockedContainer}>
          <Text style={styles.blockedText}>You are blocked by this user</Text>
          <Text style={styles.blockedSubtext}>
            Messages will not be delivered
          </Text>
        </View>
      ) : (
        <View style={styles.inputContainer}>
          {!isRecording && (
            <>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={handleAttachment}
              >
                <Icon name="add-outline" size={28} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={handleCameraCapture}
              >
                <Icon name="camera" size={28} color="#666" />
              </TouchableOpacity>
            </>
          )}

          {!isRecording && (
            <TextInput
              style={styles.input}
              placeholder={
                editingMessageId ? 'Edit your message...' : 'Message'
              }
              placeholderTextColor="#999"
              value={inputText}
              onChangeText={handleTyping}
              multiline
              maxLength={2000}
            />
          )}

          {isRecording && (
            <Animated.View
              style={[
                styles.recordingContainerInline,
                { transform: [{ translateX: slideX }] },
              ]}
            >
              <Animated.View
                style={[
                  styles.recordingPulseSmall,
                  { transform: [{ scale: micButtonScale }] },
                ]}
              >
                <View style={styles.recordingDotSmall} />
              </Animated.View>
              <Text style={styles.recordingTimerInline}>
                {fmtRec(recordingTime)}
              </Text>
              <Text
                style={[
                  styles.slideHint,
                  isCancelled && styles.slideHintCancel,
                ]}
              >
                {isCancelled ? '✕ Release to cancel' : '◀ Slide to cancel'}
              </Text>
            </Animated.View>
          )}

          <Animated.View
            style={[
              styles.micButton,
              isRecording && styles.micButtonRecording,
              { transform: [{ scale: isRecording ? 1 : micButtonScale }] },
            ]}
            {...micPanResponder.panHandlers}
            collapsable={false}
          >
            <Icon
              name={isRecording ? 'mic' : 'mic'}
              size={24}
              color={isRecording ? '#FFF' : '#666'}
            />
          </Animated.View>

          {!isRecording && (
            <TouchableOpacity
              style={[
                styles.sendButton,
                { backgroundColor: editingMessageId ? '#FF9800' : THEME_COLOR },
              ]}
              onPress={() => sendMessage()}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Icon
                  name={editingMessageId ? 'checkmark' : 'send'}
                  size={20}
                  color="#FFF"
                  style={!editingMessageId ? { marginLeft: 2 } : {}}
                />
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      <Toast />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    height: 60,
  },
  headerLeft: { width: 40, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 28, color: '#8100D1', fontWeight: '300' },
  headerBackButton: {
    marginRight: spacing.sm,
    padding: spacing.xs,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  callIcon: {
    marginLeft: spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callIconText: { fontSize: 18 },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: spacing.sm,
  },
  headerSticker: {
    fontSize: 28,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  headerAvatarText: {
    color: THEME_COLOR,
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  headerTextContainer: { flex: 1 },
  headerName: { fontSize: fontSize.lg, fontWeight: '600', color: THEME_COLOR },
  headerStatus: { fontSize: fontSize.xs, color: '#666' },
  activeText: { color: '#25D366', fontWeight: '500' },
  messagesList: { padding: spacing.md },
  loadingOlderContainer: {
    padding: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  loadingOlderText: {
    marginLeft: spacing.sm,
    fontSize: fontSize.sm,
    color: '#666',
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
    alignItems: 'flex-end',
  },
  myMessageContainer: { justifyContent: 'flex-end' },
  theirMessageContainer: { justifyContent: 'flex-start' },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: spacing.xs },
  avatarPlaceholder: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: THEME_COLOR, fontSize: fontSize.sm, fontWeight: 'bold' },
  messageBubble: {
    maxWidth: '75%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
  },
  myMessageBubble: { backgroundColor: '#E8DEF8', borderTopRightRadius: 4 },
  theirMessageBubble: { backgroundColor: '#F0F0F0', borderTopLeftRadius: 4 },
  senderName: {
    fontSize: fontSize.xs,
    color: THEME_COLOR,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  messageText: { fontSize: fontSize.md, lineHeight: 20 },
  myMessageText: { color: '#000' },
  theirMessageText: { color: '#000' },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  messageTime: { fontSize: fontSize.xs },
  myMessageTime: { color: '#666' },
  theirMessageTime: { color: '#666' },
  messageStatus: {
    fontSize: fontSize.xs,
    marginLeft: spacing.xs,
    fontWeight: '700',
  },
  seenText: { color: THEME_COLOR },
  deliveredText: { color: SENT_COLOR },
  sentText: { color: SENT_COLOR },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xs,
  },
  videoPreviewContainer: {
    width: 200,
    height: 150,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  videoPlayOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  documentMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    minWidth: 120,
  },
  documentIcon: { fontSize: fontSize.lg, marginRight: spacing.sm },
  documentText: { fontSize: fontSize.md },
  replyIndicator: {
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
  },
  replyIndicatorLine: {
    width: 3,
    backgroundColor: THEME_COLOR,
    borderRadius: 2,
    marginRight: 8,
    flexShrink: 0,
  },
  replyIndicatorText: {
    fontSize: fontSize.xs,
    color: THEME_COLOR,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyIndicatorContent: {
    fontSize: fontSize.sm,
    color: '#666',
    flexShrink: 1,
  },
  reactionBadge: {
    position: 'absolute',
    bottom: -8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flexDirection: 'row',
    gap: 2,
  },
  reactionEmoji: { fontSize: 14 },
  typingContainer: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  typingText: { fontSize: fontSize.xs, color: '#666', fontStyle: 'italic' },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  replyPreviewContent: {
    flex: 1,
    borderLeftWidth: 3,
    borderLeftColor: THEME_COLOR,
    paddingLeft: spacing.sm,
  },
  replyPreviewTitle: {
    fontSize: fontSize.xs,
    color: THEME_COLOR,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyPreviewText: { fontSize: fontSize.sm, color: '#666' },
  cancelReplyButton: { padding: spacing.sm },
  cancelReplyText: { fontSize: fontSize.lg, color: '#666' },
  inputContainer: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    minHeight: 56,
  },
  recordingContainerInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: borderRadius.xl,
    padding: spacing.sm,
    minHeight: 48,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: '#FFD0D0',
  },
  recordingPulseSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,68,68,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  recordingDotSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF4444',
  },
  recordingTimerInline: {
    flex: 1,
    fontSize: fontSize.lg,
    color: '#FF4444',
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'SF Mono' : 'monospace',
  },
  slideHint: { fontSize: fontSize.sm, color: '#999' },
  slideHintCancel: { color: '#FF4444', fontWeight: '600' },
  attachmentButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  attachmentButtonText: { fontSize: fontSize.xl },
  input: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
    color: '#000',
    maxHeight: 100,
    minHeight: 40,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  micButtonRecording: { backgroundColor: '#FF4444' },
  micButtonText: { fontSize: fontSize.xl },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sendButtonText: { color: '#FFF', fontSize: fontSize.lg, marginTop: -2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  emojiPicker: {
    backgroundColor: '#FFF',
    padding: spacing.lg,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
  },
  emojiPickerTitle: {
    fontSize: fontSize.md,
    color: '#666',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  emojiButton: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
  emoji: { fontSize: 28 },
  messageActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  actionButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  actionButtonText: {
    fontSize: fontSize.md,
    color: THEME_COLOR,
    fontWeight: '600',
  },
  permissionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  permissionModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  permissionModalIcon: { fontSize: 48, marginBottom: spacing.md },
  permissionModalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: '#000',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  permissionModalMessage: {
    fontSize: fontSize.md,
    color: '#666',
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  permissionModalButtons: { flexDirection: 'row', width: '100%' },
  permissionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    marginHorizontal: spacing.xs,
  },
  allowButton: { backgroundColor: THEME_COLOR },
  notNowButton: { backgroundColor: '#F5F5F5' },
  permissionButtonText: { fontSize: fontSize.md, fontWeight: '600' },
  permissionButtonTextDark: { color: '#000' },
  permissionButtonTextWhite: { color: '#FFFFFF' },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 70,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#999999',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  scrollToBottomIcon: {
    fontSize: 20,
    color: '#FFF',
  },
  // Blocked user UI
  blockedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: '#F5F5F5',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    gap: spacing.md,
  },
  blockedText: {
    fontSize: fontSize.md,
    color: '#666666',
    fontWeight: '500',
  },
  blockedSubtext: {
    fontSize: fontSize.sm,
    color: '#999999',
    marginTop: 4,
  },
  unblockButton: {
    backgroundColor: '#888888',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  unblockButtonText: {
    color: '#FFF',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  // Instagram-style message actions menu
  messageActionsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 0,
    width: '85%',
    maxWidth: 340,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  emojiQuickButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiQuick: {
    fontSize: 28,
  },
  actionsColumn: {
    paddingVertical: 8,
  },
  actionMenuItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  actionMenuItemText: {
    fontSize: 16,
    color: '#000',
  },
  // Double-tap reaction animation
  doubleTapOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    pointerEvents: 'box-none',
  },
  doubleTapReaction: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  doubleTapHeart: {
    fontSize: 80,
    textAlign: 'center',
  },
  // Search bar styles
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    marginLeft: spacing.md,
  },
  searchNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchCount: {
    fontSize: 14,
    color: '#666',
    marginRight: spacing.sm,
  },
  searchNavButton: {
    padding: 4,
  },
  // Empty search styles
  emptySearchContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
    transform: [{ scaleY: -1 }], // Because list is inverted
  },
  mediaWrapper: {
    marginTop: spacing.xs,
    position: 'relative',
    alignSelf: 'flex-start',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  imageContainer: {
    width: 250,
    height: 250,
    marginTop: 2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoContainer: {
    width: 250,
    aspectRatio: 16 / 9,
    marginTop: 2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fixedMedia: {
    width: '100%',
    height: '100%',
  },
  audioContainer: {
    marginTop: 2,
    width: 250,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: borderRadius.md,
    padding: spacing.xs,
  },
  mediaTimeOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  mediaTimeText: {
    fontSize: fontSize.xs,
    color: '#FFF',
  },
  emptySearchText: {
    marginTop: spacing.md,
    fontSize: 16,
    color: '#999',
  },
  highlightedText: {
    backgroundColor: '#FFEB3B',
    color: '#000',
  },
});
