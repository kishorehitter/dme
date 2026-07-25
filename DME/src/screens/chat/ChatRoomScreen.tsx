/**
 * ChatRoomScreen v7
 * REAL FIXES:
 * 1. SCROLL: Use inverted={true} FlatList with reversed messages array
 *    - This ALWAYS starts at bottom, no scrollToEnd needed
 * 2. AUDIO: WhatsApp-style audio player with smooth progress
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import FastImage from 'react-native-fast-image';
import {
  View,
  Text,
  Image,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Animated,
  PanResponder,
  Linking,
  DeviceEventEmitter,
  Alert,
  Dimensions,
  InteractionManager,
  ScrollView,
} from 'react-native';
import RNFetchBlob from 'rn-fetch-blob';
import FileViewer from 'react-native-file-viewer';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-toast-message';
import { chatAPI } from '../../services/api';
import localDatabase from '../../services/LocalDatabase';
import { websocketService, WebSocketMessage } from '../../services/websocket';
import { spacing, borderRadius, fontSize, colors } from '../../utils/theme';
import { Message } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import audioRecorder from '../../modules/AudioRecorder';
import AudioPlayer from '../../components/AudioPlayer';
import { pick, types, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import fcmService from '../../services/fcm';
import notifee from '@notifee/react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { StatusService } from '../../services/StatusService';
import RichTextInput from '../../components/RichTextInput';
import ChatInputArea from '../../components/ChatInputArea';

import FullScreenMediaViewer from '../../components/FullScreenMediaViewer';
import { API_BASE_URL, getApiUrl } from '../../config/network';
import { resolveImageUrl } from '../../utils/image';
import { MediaPickerModal } from '../../components/MediaPickerModal';
import StickerPreviewModal from '../../components/StickerPreviewModal';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import { MultiMediaPreviewModal, SelectedMedia } from '../../components/MultiMediaPreviewModal';
import { ChatMediaGrid } from '../../components/ChatMediaGrid';
import { MediaGroupListModal } from '../../components/MediaGroupListModal';
import { CustomGalleryPicker } from '../../components/CustomGalleryPicker';
import StickerPickerSheet from '../../components/StickerPickerSheet';
import LottieStickerMessage from '../../components/LottieStickerMessage';
import LottieView from 'lottie-react-native';
import { BUILT_IN_STICKER_PACKS, Sticker } from '../../stickers/stickerPacks';

const FRESH_CHAT_STICKERS = [
  {
    id: 'hi',
    name: 'Say Hi 👋',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44b/lottie.json',
  },
  {
    id: 'hello',
    name: 'Hello! 🫶',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1faf6/lottie.json',
  },
  {
    id: 'smiley',
    name: 'Smile 😊',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60a/lottie.json',
  },
  {
    id: 'exciting',
    name: 'Exciting 🥳',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f973/lottie.json',
  },
];



const SENT_COLOR = '#B0B0B0';
const BASE_URL = API_BASE_URL.replace('/api', '');

const MessageAvatar = ({ uri, sticker, sName, userId, style, navigation, conversationId }: any) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);

  const [hasStatus, setHasStatus] = useState(false);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      try {
        const statuses = await StatusService.getStatuses();
        if (active) {
          setHasStatus(statuses.some(s => s.user_id === userId));
        }
      } catch (err) {
        console.error('Status check error in MessageAvatar:', err);
      }
    };
    checkStatus();
    return () => {
      active = false;
    };
  }, [userId]);

  const handleAvatarPress = async () => {
    try {
      const statuses = await StatusService.getStatuses();
      const userStatuses = statuses.filter(s => s.user_id === userId);
      
      if (userStatuses.length > 0) {
        navigation.navigate('StatusViewer', { statuses: userStatuses, initialIndex: 0 });
      } else {
        navigation.navigate('Profile', { user: { id: userId, display_name: sName }, conversationId });
      }
    } catch (err) {
      navigation.navigate('Profile', { user: { id: userId, display_name: sName }, conversationId });
    }
  };

  const avatarStyle = {
    ...style,
    ...(hasStatus && { borderWidth: 2, borderColor: theme.primary, padding: 2 }),
  };

  return (
    <AvatarWithFallback
      uri={uri}
      sticker={sticker}
      displayName={sName}
      style={avatarStyle}
      onPress={handleAvatarPress}
      isGroup={false}
    />
  );
};

// Helper to get alphabetic initials safely
const getInitials = (name: string) => {
  if (typeof name !== 'string') return null;
  const match = name.trim().match(/[a-zA-Z]/);
  return match ? match[0].toUpperCase() : null;
};

// ... inside HeaderAvatar, MessageAvatar, and renderMessage:
// Replace .charAt(0).toUpperCase() with getInitials(name)

interface OtherUser {
  id: number;
  display_name: string;
  email: string;
  profile_picture: string | null;
  avatar_sticker: string | null;
  status: string;
  last_seen: string;
}

const getMessagePreviewText = (message: Message | null | undefined, messagesList?: Message[]) => {
  if (!message) return '';
  let msgType = message.message_type;
  let msgContent = message.content;

  // Handle synthetic media_group
  if ((message as any).type === 'media_group' || (message as any).messages) {
    const messages = (message as any).messages || [];
    const hasVideo = messages.some((m: any) => m.message_type === 'video');
    return hasVideo ? 'Video' : 'Image';
  }

  if (!msgType && messagesList) {
    const fullMsg = messagesList.find(m => m.id === message.id);
    if (fullMsg) {
      msgType = fullMsg.message_type;
      msgContent = fullMsg.content;
    }
  }
  switch (msgType) {
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'document':
      return 'Document';
    case 'text':
    default:
      return msgContent || '';
  }
};

const getReplyMediaUrl = (reply: Message, messagesList?: Message[]) => {
  // Handle synthetic media_group
  if ((reply as any).type === 'media_group' || (reply as any).messages) {
    const firstMsg = (reply as any).messages?.[0];
    if (firstMsg) {
      const mediaFile = firstMsg.media_file || firstMsg.media_url;
      return mediaFile ? resolveImageUrl(mediaFile) : null;
    }
  }

  let mediaFile = reply.media_file || (reply as any).media_url;
  if (!mediaFile && messagesList) {
    const fullMsg = messagesList.find(m => m.id === reply.id);
    if (fullMsg) {
      mediaFile = fullMsg.media_file || (fullMsg as any).media_url;
    }
  }
  return mediaFile ? resolveImageUrl(mediaFile) : null;
};

const getReplyMessageType = (reply: Message, messagesList?: Message[]) => {
  if ((reply as any).type === 'media_group' || (reply as any).messages) {
    const firstMsg = (reply as any).messages?.[0];
    return firstMsg?.message_type || 'image';
  }

  let type = reply.message_type;
  if (!type && messagesList) {
    const fullMsg = messagesList.find(m => m.id === reply.id);
    if (fullMsg) {
      type = fullMsg.message_type;
    }
  }
  return type;
};

const renderReplyThumbnail = (reply: Message, messagesList?: Message[]) => {
  const replyType = getReplyMessageType(reply, messagesList);
  const mediaUrl = getReplyMediaUrl(reply, messagesList);

  if (replyType === 'image' && mediaUrl) {
    return (
      <Image
        source={{ uri: mediaUrl }}
        style={s.replyMediaThumbnail}
        resizeMode="cover"
      />
    );
  }

  if (replyType === 'video') {
    return (
      <View style={s.replyMediaPlaceholder}>
        <Icon name="play" size={16} color="#FFF" />
      </View>
    );
  }

  if (replyType === 'document') {
    let iconName = 'document-text-outline';
    const fileName = (mediaUrl || reply.content || '').split('/').pop() || 'Document';
    const fileExt = fileName.split('.').pop()?.toLowerCase();
    if (fileExt === 'pdf') iconName = 'document-outline';
    else if (['doc', 'docx'].includes(fileExt || '')) iconName = 'document-attach-outline';
    else if (['xlsx', 'csv', 'txt', 'zip', 'rar'].includes(fileExt || '')) iconName = 'document-text-outline';

    return (
      <View style={s.replyMediaPlaceholder}>
        <Icon name={iconName} size={18} color={theme.primary} />
      </View>
    );
  }

  return null;
};

const getFileIconColor = (fileExt: string) => {
  switch (fileExt) {
    case 'pdf':
      return '#D32F2F'; // Red
    case 'doc':
    case 'docx':
      return '#1976D2'; // Blue
    case 'xls':
    case 'xlsx':
    case 'csv':
      return '#388E3C'; // Green
    case 'ppt':
    case 'pptx':
      return '#E64A19'; // Orange/Red
    case 'zip':
    case 'rar':
    case '7z':
      return '#F57C00'; // Orange
    case 'txt':
      return '#607D8B'; // Slate Grey
    default:
      return theme.primary;
  }
};

const shouldShowDateSeparator = (index: number, messagesList: Message[]) => {
  if (!messagesList || index < 0 || index >= messagesList.length) return false;
  if (index === messagesList.length - 1) {
    return true;
  }
  const currentMsg = messagesList[index];
  const nextMsg = messagesList[index + 1]; // next in inverted array is older chronologically
  if (!currentMsg || !nextMsg) return false;

  const currentDate = new Date(currentMsg.created_at);
  const nextDate = new Date(nextMsg.created_at);

  return (
    currentDate.getFullYear() !== nextDate.getFullYear() ||
    currentDate.getMonth() !== nextDate.getMonth() ||
    currentDate.getDate() !== nextDate.getDate()
  );
};

const formatSeparatorDate = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    const messageDate = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    if (isSameDay(messageDate, today)) {
      return 'Today';
    } else if (isSameDay(messageDate, yesterday)) {
      return 'Yesterday';
    } else {
      return messageDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  } catch (e) {
    return '';
  }
};


const DIMENSIONS_CACHE_KEY = 'chat_image_dimensions_cache';
let imageDimensionsCache = new Map<string, { width: number; height: number }>();

// Load from AsyncStorage once when module is imported
AsyncStorage.getItem(DIMENSIONS_CACHE_KEY).then(val => {
  if (val) {
    try {
      const parsed = JSON.parse(val);
      imageDimensionsCache = new Map(Object.entries(parsed));
    } catch (e) {
      console.warn('Failed to parse dimensions cache:', e);
    }
  }
}).catch(err => {
  console.warn('Failed to load dimensions cache from storage:', err);
});

const saveDimensionsToStorage = async () => {
  try {
    const obj = Object.fromEntries(imageDimensionsCache.entries());
    await AsyncStorage.setItem(DIMENSIONS_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save dimensions cache to storage:', e);
  }
};

const ChatImage = ({ url, isMe, onLongPress, onPress, timeOverlay, isSticker }: any) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);

  const [dimensions, setDimensions] = useState<{ width: number; height: number }>(() => {
    if (url && imageDimensionsCache.has(url)) {
      return imageDimensionsCache.get(url)!;
    }
    return isSticker ? { width: 100, height: 100 } : { width: 200, height: 150 };
  });
  const [loading, setLoading] = useState(!imageDimensionsCache.has(url));

  useEffect(() => {
    let isActive = true;
    let task: any = null;
    if (url) {
      if (imageDimensionsCache.has(url)) {
        setLoading(false);
        return;
      }
      // Defer getSize to prevent mid-transition layout shifts
      task = InteractionManager.runAfterInteractions(() => {
        if (!isActive) return;
        Image.getSize(url, (width, height) => {
          if (!isActive) return;
          if (width && height) {
            const MAX_W = isSticker ? 100 : 200;
            const MAX_H = isSticker ? 150 : 300;

            let dW = width;
            let dH = height;

            const aspectRatio = width / height;

            if (dW > MAX_W) {
              dW = MAX_W;
              dH = MAX_W / aspectRatio;
            }

            if (dH > MAX_H) {
              dH = MAX_H;
              dW = MAX_H * aspectRatio;
            }

            const resolved = { width: dW, height: dH };
            imageDimensionsCache.set(url, resolved);
            saveDimensionsToStorage();
            setDimensions(resolved);
            setLoading(false);
          }
        }, () => {
          if (!isActive) return;
          const fallback = isSticker ? { width: 100, height: 100 } : { width: 200, height: 150 };
          imageDimensionsCache.set(url, fallback);
          saveDimensionsToStorage();
          setDimensions(fallback);
          setLoading(false);
        });
      });
    }
    return () => {
      isActive = false;
      if (task) task.cancel();
    };
  }, [url, isSticker]);

  return (
    <TouchableOpacity 
      style={[
        s.imageContainer, 
        { 
            alignSelf: isMe ? 'flex-end' : 'flex-start',
            width: dimensions.width,
            height: dimensions.height,
            backgroundColor: isSticker ? 'transparent' : '#EAEAEA',
            padding: 0,
            marginTop: 4,
            justifyContent: 'center',
            alignItems: 'center',
        }
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.9}
    >
      <FastImage 
        source={{ uri: url }} 
        style={{ 
          height: dimensions.height, 
          width: dimensions.width,
          borderRadius: isSticker ? 0 : 12,
        }} 
        resizeMode={FastImage.resizeMode.contain}
        onLoadEnd={() => setLoading(false)}
      />
      {loading && !isSticker && (
        <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      )}
      {!isSticker && timeOverlay}
    </TouchableOpacity>
  );
};

let uniqueCounter = 0;

export const ChatRoomScreen: React.FC<any> = ({ navigation, route }) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);

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

  // inverted FlatList shows last item first (bottom) without any scrollToEnd
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<any>(null); 
  const [liveReadTimes, setLiveReadTimes] = useState<{ [userId: number]: string }>({});
  const [selectedReceiptUser, setSelectedReceiptUser] = useState<{ id: number; name: string; seenTime: string } | null>(null);
  const [isGroup, setIsGroup] = useState<boolean>(!!route.params?.isGroup); 
  const [groupDescription, setGroupDescription] = useState(''); 
  const [activeGroupCall, setActiveGroupCall] = useState<any>(null); 
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
  const [otherUser, setOtherUser] = useState<OtherUser | null>(route.params?.otherUser || null);
  const [friendStatus, setFriendStatus] = useState<string>(route.params?.otherUser?.friend_status || 'none'); // 'none' | 'sent_pending' | 'received_pending' | 'friends'
  const [messageRequestStatus, setMessageRequestStatus] = useState<string | null>(null); // null | 'pending' | 'accepted' | 'rejected'
  const [messageRequestSenderId, setMessageRequestSenderId] = useState<number | null>(null);
  const [isUserBlocked, setIsUserBlocked] = useState(false); // Whether current user blocked other
  const [amIBlocked, setAmIBlocked] = useState(false); // Whether other user blocked current user
  const [lastSeenPrivacy, setLastSeenPrivacy] = useState<'everyone' | 'nobody'>('everyone');
  const [chatTitle, setChatTitle] = useState(name || 'Chat');
  const [shouldSkipLoad, setShouldSkipLoad] = useState(false); // Skip loading messages
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false); // Scroll to bottom button
  const [showMessageActions, setShowMessageActions] = useState(false); 
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 }); 
  const [cameraMenuVisible, setCameraMenuVisible] = useState(false);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
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
  const [stickerPreview, setStickerPreview] = useState<{uri: string; mimeType: string} | null>(null);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [multiPreviewVisible, setMultiPreviewVisible] = useState(false);
  const [galleryPickerVisible, setGalleryPickerVisible] = useState(false);
  const [selectedMultiMedia, setSelectedMultiMedia] = useState<SelectedMedia[]>([]);
  const [groupListVisible, setGroupListVisible] = useState(false);
  const [selectedGroupMessages, setSelectedGroupMessages] = useState<Message[]>([]);
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
  const activeUploadsRef = useRef<{ [localId: string]: AbortController }>({});

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
  const [inputClearKey, setInputClearKey] = useState(0);
  const clearInputRef = useRef<() => void>(null);

  const EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🎉'];

  // Load from local SQLite cache immediately on mount (no InteractionManager deferral)
  // to render messages instantly during the navigation slide transition
  useEffect(() => {
    if (route.params?.cleared || route.params?.deleted) {
      return;
    }
    try {
      const cached = localDatabase.getMessages(conversationId);
      if (cached && cached.length > 0) {
        // Only load the latest 15 messages initially to keep transition ultra-smooth and avoid thread freeze
        const latestCached = cached.slice(-15);
        const mappedCached = latestCached.map(msg => {
          if (!msg.sender?.id && currentUser) {
            const isMe = msg.user === (currentUser.display_name || currentUser.first_name || currentUser.email);
            if (isMe) {
              msg.sender = {
                ...msg.sender,
                id: currentUser.id
              };
            }
          }
          return msg;
        });
        setOldestMessageId(mappedCached[0].id || null);
        setHasMoreMessages(cached.length >= 50);
        setMessages([...mappedCached].reverse());
        setIsLoading(false);
      }
    } catch (e) {
      console.warn('⚠️ Failed to load cached messages on mount:', e);
    }
  }, [conversationId, currentUser, route.params?.cleared, route.params?.deleted]);

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

    const task = InteractionManager.runAfterInteractions(() => {
      // Add a small delay (100ms) after the navigation animation settles
      // to guarantee zero stutters or mid-animation jumps
      setTimeout(() => {
        loadConversationDetails();
        connectWebSocket();

        // Only load messages if not cleared
        if (!isCleared) {
          loadMessages();
        }
      }, 100);
    });

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
      InteractionManager.runAfterInteractions(() => {
        // Add a slight delay to ensure the native slide transition is 100% complete
        // before we trigger the `conversation_read` event which re-renders the heavy ChatListScreen
        setTimeout(() => {
          if (!chatIsActiveRef.current) return;
          const unread = messagesRef.current.some(
            m => m.sender.id !== currentUser?.id && !m.is_read,
          );
          if (unread) markAsRead();
        }, 300);
      });
    });

    const blurSub = navigation.addListener('blur', () => {
      chatIsActiveRef.current = false;
    });

    return () => {
      task.cancel();
      websocketService.disconnectRoom();
      if (focusSub) focusSub();
      if (blurSub) blurSub();
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

    const loadLastSeenPrivacy = async () => {
      try {
        const key = `settings_last_seen_${currentUser?.id || 'default'}`;
        const val = await AsyncStorage.getItem(key);
        if (val) {
          setLastSeenPrivacy(val as 'everyone' | 'nobody');
        }
      } catch (e) {
        console.warn(e);
      }
    };
    loadLastSeenPrivacy();

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
          // Set friend status if the API returns it
          if (other.user.friend_status) {
            setFriendStatus(other.user.friend_status);
          }

          setMessageRequestStatus(data.message_request_status || null);
          setMessageRequestSenderId(data.message_request_sender_id || null);

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

  const handleApproveMessageRequest = async () => {
    try {
      await chatAPI.approveMessageRequest(conversationId);
      setMessageRequestStatus('accepted');
      Toast.show({
        type: 'success',
        text1: 'Message request approved',
        position: 'bottom',
      });
    } catch (err) {
      console.error('Failed to approve message request:', err);
      Alert.alert('Error', 'Failed to approve message request.');
    }
  };

  const handleRejectMessageRequest = async () => {
    try {
      await chatAPI.rejectMessageRequest(conversationId);
      setMessageRequestStatus('rejected');
      Alert.alert('Request Declined', 'Message request has been declined.');
      navigation.goBack();
    } catch (err) {
      console.error('Failed to reject message request:', err);
      Alert.alert('Error', 'Failed to decline message request.');
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
    if (shouldSkipLoad) {
      console.log('Skipping message load - chat cleared');
      return;
    }

    // Load from local SQLite cache first for instant offline rendering
    try {
      const cached = localDatabase.getMessages(conversationId);
      if (cached && cached.length > 0) {
        // Fallback for pre-existing cached messages (where sender_id was stored as 0)
        const mappedCached = cached.map(msg => {
          if (!msg.sender?.id && currentUser) {
            const isMe = msg.user === (currentUser.display_name || currentUser.first_name || currentUser.email);
            if (isMe) {
              msg.sender = {
                ...msg.sender,
                id: currentUser.id
              };
            }
          }
          return msg;
        });
        setOldestMessageId(mappedCached[0].id || null);
        setHasMoreMessages(mappedCached.length >= 50);
        // Reverse because inverted FlatList expects index 0 to be the newest message (at the bottom)
        setMessages([...mappedCached].reverse());
        setIsLoading(false); // Can hide loading indicator early
      }
    } catch (e) {
      console.warn('⚠️ Failed to load cached messages:', e);
    }

    try {
      const data = await chatAPI.getMessages(conversationId);
      const arr: Message[] = Array.isArray(data) ? data : data?.results ?? [];

      if (arr.length > 0) {
        setOldestMessageId(arr[0].id);
        setHasMoreMessages(arr.length >= 50);
      }

      // Cache fresh messages in SQLite
      localDatabase.saveMessages(arr, conversationId);

      setMessages([...arr].reverse());

      if (chatIsActiveRef.current) {
        const hasUnread = arr.some(
          m => m.sender.id !== currentUser?.id && !m.is_read,
        );
        if (hasUnread) markAsRead();
      }
    } catch (e) {
      console.error('❌ Failed to fetch messages from API:', e);
      // If we don't have cached messages and API failed, fallback to empty
      setMessages(prev => (prev.length > 0 ? prev : []));
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
      DeviceEventEmitter.emit('conversation_read', { conversationId });
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
      case 'error': {
        const errorMsg = wsMsg.data?.error || 'Message could not be sent';
        Toast.show({
          type: 'error',
          text1: errorMsg,
          position: 'bottom',
        });
        loadConversationDetails();
        loadMessages(); // reload to clear any failed optimistic messages
        break;
      }
      case 'message': {
        const isOwn = wsMsg.data.sender?.id === currentUser?.id;
        const nm: Message = {
          ...wsMsg.data,
          reactions: wsMsg.data.reactions ?? {},
          delivered_at: !isOwn
            ? wsMsg.data.delivered_at || new Date().toISOString()
            : wsMsg.data.delivered_at,
        };

        // Cache the incoming message locally in SQLite
        if (isOwn) {
          const senderName = currentUser?.display_name || currentUser?.email || '';
          const localId = localDatabase.findSendingMessage(nm.content, senderName);
          if (localId) {
            localDatabase.updateMessageServerId(localId, nm.id, 'sent');
          } else {
            localDatabase.saveMessage({ ...nm, conversation: conversationId }, nm.id.toString(), 'sent');
          }
          // Query backend conversation details to instantly update friendship/message-gating status
          loadConversationDetails();
        } else {
          localDatabase.saveMessage({ ...nm, conversation: conversationId }, nm.id.toString(), 'sent');
        }

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
            if (wsMsg.data.is_typing) {
                if (!arr.includes(wsMsg.data.user_name)) return [...arr, wsMsg.data.user_name];
                return arr;
            } else {
                return arr.filter((u: string) => u !== wsMsg.data.user_name);
            }
          });
          // Auto-clear typing indicator after 3 seconds as a safety
          if (wsMsg.data.is_typing) {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
                setTypingUsers(prev => prev.filter(u => u !== wsMsg.data.user_name));
            }, 3000);
          }
        }
        break;
      case 'delivered':
        setMessages(prev => {
          const updated = (Array.isArray(prev) ? prev : []).map(m => {
            if (wsMsg.data.message_ids?.includes(m.id) && m.sender.id === currentUser?.id) {
              const updatedMsg = { ...m, delivered_at: new Date().toISOString() };
              const localId = m.local_id || m.id.toString();
              localDatabase.saveMessage({ ...updatedMsg, conversation: conversationId }, localId, 'delivered');
              return updatedMsg;
            }
            return m;
          });
          return updated;
        });
        break;
      case 'read_receipt':
        const readerId = wsMsg.data.user_id;
        const msgIds = wsMsg.data.message_ids || [];
        if (readerId && msgIds.length > 0) {
          // Record current time as live read time
          setLiveReadTimes(prev => ({
            ...prev,
            [readerId]: new Date().toISOString()
          }));
          
          const maxMsgId = Math.max(...msgIds);
          setConversation(prev => {
            if (!prev || !prev.participants) return prev;
            return {
              ...prev,
              participants: prev.participants.map((p: any) => {
                if (p.user?.id === readerId) {
                  return { ...p, last_read_message: maxMsgId };
                }
                return p;
              })
            };
          });
        }
        setMessages(prev => {
          const updated = (Array.isArray(prev) ? prev : []).map(m => {
            if (wsMsg.data.message_ids?.includes(m.id)) {
              const updatedMsg = { ...m, is_read: true };
              const localId = m.local_id || m.id.toString();
              localDatabase.saveMessage({ ...updatedMsg, conversation: conversationId }, localId, 'read');
              return updatedMsg;
            }
            return m;
          });
          return updated;
        });
        break;
      case 'reaction':
        console.log('💬 WebSocket reaction received:', wsMsg.data);
        setMessages(prev => {
          const updated = (Array.isArray(prev) ? prev : []).map(m => {
            if (m.id === wsMsg.data.message_id) {
              const updatedMsg = { ...m, reactions: wsMsg.data.reactions || {} };
              const localId = m.local_id || m.id.toString();
              localDatabase.saveMessage({ ...updatedMsg, conversation: conversationId }, localId);
              return updatedMsg;
            }
            return m;
          });
          return updated;
        });
        console.log(
          '💬 Reaction state updated for message:',
          wsMsg.data.message_id,
        );
        break;
      case 'message_edit': {
        const { message_id, content, edited_at } = wsMsg.data;
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            m.id === message_id ? { ...m, content, edited_at } : m
          )
        );
        const target = messagesRef.current.find(m => m.id === message_id);
        const localId = target?.local_id || message_id.toString();
        localDatabase.updateMessageText(localId, content, edited_at || new Date().toISOString());
        break;
      }
      case 'message_delete': {
        const { message_id, content } = wsMsg.data;
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            m.id === message_id ? { ...m, is_deleted: true, content } : m
          )
        );
        const target = messagesRef.current.find(m => m.id === message_id);
        const localId = target?.local_id || message_id.toString();
        localDatabase.softDeleteMessage(localId);
        break;
      }
      case 'message_request_created': {
        const { conversation_id, status, sender_id } = wsMsg.data;
        if (conversation_id === parseInt(conversationId, 10)) {
          setMessageRequestStatus(status);
          setMessageRequestSenderId(sender_id);
        }
        break;
      }
      case 'message_request_status': {
        const { conversation_id, status, sender_id } = wsMsg.data;
        if (conversation_id === parseInt(conversationId, 10)) {
          setMessageRequestStatus(status);
          setMessageRequestSenderId(sender_id);
          if (status === 'rejected' && sender_id === currentUser?.id) {
            Alert.alert('Request Declined', 'Your message request was declined by the user.');
            navigation.goBack();
          }
        }
        break;
      }
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
        const editedAt = new Date().toISOString();
        const target = messagesRef.current.find(m => m.id === editingMessageId);
        const localId = target?.local_id || editingMessageId.toString();
        localDatabase.updateMessageText(localId, text, editedAt);

        // Update the message in the list
        setMessages(prev =>
          prev.map(m =>
            m.id === editingMessageId ? { ...m, content: text, edited_at: editedAt } : m,
          ),
        );
        setInputText(''); 
        clearInputRef.current?.();
        setInputClearKey(k => k + 1);
        setEditingMessageId(null);
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
    clearInputRef.current?.();
    setInputClearKey(k => k + 1);
    setHighlightMessageId(null); // Clear any active highlight when sending a new message

    if (websocketService.getConnectionState()) {
      const localId = Date.now().toString();
      const optimistic: any = {
        id: Date.now(), // temp ID for UI indexing compatibility
        local_id: localId,
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
              message_type: replyToMessage.message_type,
              media_file: replyToMessage.media_file,
              sender: replyToMessage.sender,
            }
          : null,
      };

      // Save to SQLite
      localDatabase.saveMessage(optimistic, localId, 'sending');

      // FIX 1: Prepend to reversed array
      setMessages(prev => [optimistic, ...(Array.isArray(prev) ? prev : [])]);
      websocketService.sendMessage(text, replyToMessage?.id);
      setReplyToMessage(null);
      setIsSending(false);
      setInputText('');
      clearInputRef.current?.();

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
          setInputText('');
          clearInputRef.current?.();  
          // Query backend conversation details to instantly update friendship/message-gating status
          loadConversationDetails();
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          }, 100);
        }
      } catch {
        clearInputRef.current?.(text);
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

  const typingIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTypingState = useRef<boolean | null>(null);

  const handleTyping = useCallback((text: string) => {
    setInputText(text); // ✅ back to normal, no setTimeout needed

    const isTyping = text.length > 0;
    if (lastTypingState.current === isTyping) return;

    if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);

    if (isTyping) {
      typingIndicatorTimeout.current = setTimeout(() => {
        if (websocketService.getConnectionState()) {
          websocketService.sendTyping(true);
          lastTypingState.current = true;
        }
      }, 400);
    } else {
      lastTypingState.current = false;
      if (websocketService.getConnectionState()) {
        websocketService.sendTyping(false);
      }
    }
  }, []);

  const handleAttachmentStable = useCallback(() => {
    setAttachmentMenuVisible(true);
  }, []);

  const handleCameraCaptureStable = useCallback(() => {
    setCameraMenuVisible(true);
  }, []);

  const setStickerPreviewStable = useCallback((val: any) => {
    setStickerPreview(val);
  }, []);

  const sendMessageStable = useCallback(() => {
    sendMessage();
  }, [sendMessage]);

  // ── Send a Lottie sticker (no upload — URL stored in content) ─────────────
  const sendLottieSticker = useCallback(async (sticker: Sticker) => {
    setStickerPickerVisible(false);
    uniqueCounter++;
    const localId = `lsticker_${Date.now()}_${uniqueCounter}`;
    const tempId = Date.now() + uniqueCounter + 2000000000;
    const optimisticMsg: any = {
      id: tempId,
      local_id: localId,
      conversation: conversationId,
      sender: {
        id: currentUser!.id,
        email: currentUser!.email || '',
        display_name: currentUser!.display_name || currentUser!.first_name || '',
        profile_picture: null,
        avatar_sticker: null,
      },
      content: sticker.url,   // store URL as content
      message_type: 'lottie_sticker',
      media_file: null,
      is_read: false,
      delivered_at: null,
      created_at: new Date().toISOString(),
      reactions: {},
      reply_to: null,
      status: 'sending',
    };
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    try {
      const token = await AsyncStorage.getItem('access_token');
      const body = {
        content: sticker.url,
        message_type: 'lottie_sticker',
      };
      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const nm = await res.json();
        setMessages(prev =>
          prev.map(m =>
            m.local_id === localId || m.id === tempId
              ? { ...nm, local_id: localId, status: 'sent' }
              : m,
          ),
        );
        localDatabase.saveMessage(nm, localId, 'sent');
      } else {
        // Non-critical: mark as failed
        setMessages(prev =>
          prev.map(m =>
            m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
          ),
        );
      }
    } catch (e) {
      console.error('[Chat] Lottie sticker send error:', e);
      setMessages(prev =>
        prev.map(m =>
          m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
        ),
      );
    }
  }, [conversationId, currentUser, flatListRef]);

  // ── Send a Remote GIF (stored in content, message_type = 'image') ────────
  const sendGifMessage = useCallback(async (gifUrl: string) => {
    setStickerPickerVisible(false);
    uniqueCounter++;
    const localId = `gif_${Date.now()}_${uniqueCounter}`;
    const tempId = Date.now() + uniqueCounter + 1000000000;
    const optimisticMsg: any = {
      id: tempId,
      local_id: localId,
      conversation: conversationId,
      sender: {
        id: currentUser!.id,
        email: currentUser!.email || '',
        display_name: currentUser!.display_name || currentUser!.first_name || '',
        profile_picture: null,
        avatar_sticker: null,
      },
      content: gifUrl,
      message_type: 'image',
      media_file: null,
      is_read: false,
      delivered_at: null,
      created_at: new Date().toISOString(),
      reactions: {},
      reply_to: null,
      status: 'sending',
    };
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    try {
      const token = await AsyncStorage.getItem('access_token');
      const body = {
        content: gifUrl,
        message_type: 'image',
      };
      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const nm = await res.json();
        setMessages(prev =>
          prev.map(m =>
            m.local_id === localId || m.id === tempId
              ? { ...nm, local_id: localId, status: 'sent' }
              : m,
          ),
        );
        localDatabase.saveMessage(nm, localId, 'sent');
      } else {
        setMessages(prev =>
          prev.map(m =>
            m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
          ),
        );
      }
    } catch (e) {
      console.error('[Chat] GIF send error:', e);
      setMessages(prev =>
        prev.map(m =>
          m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
        ),
      );
    }
  }, [conversationId, currentUser, flatListRef]);

  // Replaces handleCameraCapture

  const handleCameraCapture = () => {
    setCameraMenuVisible(true);
  };

  const handleAttachment = () => {
     setAttachmentMenuVisible(true);
  };

  const sendDocumentMessage = async (doc: any, caption: string = '') => {
    // 1. Optimistic UI
    uniqueCounter++;
    const localId = `doc_${Date.now()}_${uniqueCounter}_${Math.random().toString(36).substr(2, 5)}`;
    const tempId = Date.now() + uniqueCounter + 1000000000;
    const optimisticMsg: any = {
      id: tempId,
      local_id: localId,
      conversation: conversationId,
      sender: { id: currentUser!.id, email: currentUser!.email || '', display_name: currentUser!.display_name || currentUser!.first_name || '', profile_picture: null, avatar_sticker: null },
      content: caption,
      message_type: 'document',
      media_file: doc.uri, // Use local URI temporarily
      is_read: false, delivered_at: null, created_at: new Date().toISOString(),
      reactions: {}, reply_to: null, status: 'sending',
    };
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    const controller = new AbortController();
    activeUploadsRef.current[localId] = controller;

    // 2. Background Upload (No setIsSending lock)
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('content', caption);
      fd.append('message_type', 'document');
      fd.append('media_file', { uri: doc.uri, type: doc.type || 'application/octet-stream', name: doc.name || 'document' } as any);
      
      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' },
        body: fd,
        signal: controller.signal,
      });

      if (res.ok) {
        const nm = await res.json();
        setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...nm, local_id: localId, status: 'sent' } : m));
        localDatabase.saveMessage(nm, localId, 'sent');
      } else {
        throw new Error('Upload failed');
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('Document upload aborted:', localId);
        return;
      }
      console.error('Document upload error:', e);
      setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...m, status: 'failed' } : m));
      localDatabase.updateMessageStatus(localId, 'failed');
    } finally {
      delete activeUploadsRef.current[localId];
    }
  };

  const sendImageMessage = async (asset: any, caption: string = '') => {
    const isVideo = asset.type?.startsWith('video') || asset.uri.endsWith('.mp4') || asset.uri.endsWith('.mov');
    const messageType = isVideo ? 'video' : 'image';
    
    // 1. Optimistic UI
    uniqueCounter++;
    const localId = `img_${Date.now()}_${uniqueCounter}_${Math.random().toString(36).substr(2, 5)}`;
    const tempId = Date.now() + uniqueCounter + 1000000000;
    const optimisticMsg: any = {
      id: tempId,
      local_id: localId,
      conversation: conversationId,
      sender: { id: currentUser!.id, email: currentUser!.email || '', display_name: currentUser!.display_name || currentUser!.first_name || '', profile_picture: null, avatar_sticker: null },
      content: caption,
      message_type: messageType,
      media_file: asset.uri, // Use local URI temporarily
      is_read: false, delivered_at: null, created_at: new Date().toISOString(),
      reactions: {}, reply_to: null, status: 'sending',
    };
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    const controller = new AbortController();
    activeUploadsRef.current[localId] = controller;

    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('content', caption);
      fd.append('message_type', messageType);
      fd.append('media_file', { uri: asset.uri, type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'), name: asset.fileName || `${messageType}_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}` } as any);

      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' },
        body: fd,
        signal: controller.signal,
      });

      if (res.ok) {
        const nm = await res.json();
        setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...nm, local_id: localId, status: 'sent' } : m));
        localDatabase.saveMessage(nm, localId, 'sent');
      } else {
        throw new Error(`Upload failed: ${res.status}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('Image/Video upload aborted:', localId);
        return;
      }
      console.error('[Chat] Exception during upload:', e);
      setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...m, status: 'failed' } : m));
      localDatabase.updateMessageStatus(localId, 'failed');
    } finally {
      delete activeUploadsRef.current[localId];
    }
  };

  const retryMessage = async (msg: Message) => {
    const localId = msg.local_id || msg.id.toString();
    const tempId = msg.id;

    // Reset status to 'sending'
    setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'sending' } : m));
    localDatabase.updateMessageStatus(localId, 'sending');

    const controller = new AbortController();
    activeUploadsRef.current[localId] = controller;

    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('content', msg.content || '');
      fd.append('message_type', msg.message_type);

      const isVideo = msg.message_type === 'video';
      const isDocument = msg.message_type === 'document';
      
      let mimeType = 'image/jpeg';
      let fileName = `media_${Date.now()}.jpg`;
      if (isVideo) {
        mimeType = 'video/mp4';
        fileName = `media_${Date.now()}.mp4`;
      } else if (isDocument) {
        mimeType = 'application/octet-stream';
        fileName = `doc_${Date.now()}`;
      }

      fd.append('media_file', {
        uri: msg.media_file,
        type: mimeType,
        name: fileName,
      } as any);

      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' },
        body: fd,
        signal: controller.signal,
      });

      if (res.ok) {
        const nm = await res.json();
        setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...nm, local_id: localId, status: 'sent' } : m));
        localDatabase.saveMessage(nm, localId, 'sent');
      } else {
        throw new Error('Upload failed');
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('Upload aborted:', localId);
        return;
      }
      console.error('[Chat] Exception during retry:', e);
      setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? { ...m, status: 'failed' } : m));
      localDatabase.updateMessageStatus(localId, 'failed');
    } finally {
      delete activeUploadsRef.current[localId];
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

    let finalDuration = recordingTimeRef.current;
    
    if (Platform.OS === 'android') {
      try {
        const ms = await audioRecorder.getRecordingDuration();
        if (ms > 0) {
          finalDuration = Math.round(ms / 1000);
        }
      } catch (e) {
        console.error('Error getting recording duration:', e);
      }
    }
    
    if (finalDuration < 1) {
      cancelRecordingProcess();
      return;
    }

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
  const handleMessageLongPress = (item: Message, event?: any) => {
    setSelectedMessage(item);
    if (event && event.nativeEvent) {
      const { pageX, pageY } = event.nativeEvent;
      setMenuPosition({ x: pageX, y: pageY });
    } else {
      setMenuPosition({ x: 0, y: 0 });
    }
    setShowMessageActions(true);
  };

  // Double-tap to react with heart
  const handleMessagePress = (item: Message, event: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    const { pageX, pageY } = event.nativeEvent;

    if (doubleTapTimeoutRef.current) {
      clearTimeout(doubleTapTimeoutRef.current);
      doubleTapTimeoutRef.current = null;
    }

    if (now - lastTapTimeRef.current < DOUBLE_TAP_DELAY) {
      handleDoubleTapReaction(item, pageX, pageY);
      lastTapTimeRef.current = 0;
    } else {
      doubleTapTimeoutRef.current = setTimeout(async () => {
        lastTapTimeRef.current = 0;
        doubleTapTimeoutRef.current = null;
        
        // OPEN MEDIA (Only for media messages)
        if ((item as any).type === 'media_group') {
            // Single-tap on grouped media → open the scrollable list
            setSelectedGroupMessages((item as any).messages || []);
            setGroupListVisible(true);
        } else if (item.message_type === 'image') {
            navigation.navigate('MediaViewer', { mediaUrl: resolveImageUrl((item as any).media_url || item.media_file), mediaType: 'image' });
        } else if (item.message_type === 'video') {
            navigation.navigate('MediaViewer', { mediaUrl: resolveImageUrl((item as any).media_url || item.media_file), mediaType: 'video' });
        }
      }, DOUBLE_TAP_DELAY);
      lastTapTimeRef.current = now;
    }
  };

  const handleDoubleTapReaction = (item: Message, x: number = 0, y: number = 0) => {
    const targetId = (item as any).type === 'media_group' ? (item as any).messages[0].id : item.id;
    // Show the heart animation at tap location
    setDoubleTapReaction({ visible: true, x, y, messageId: targetId });

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

    // Toggle the user's quick reaction (add if not present, remove if present)
    const reactionEmoji = currentUser?.quick_reaction || '❤️';
    toggleReaction(targetId, reactionEmoji);
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
      <View style={s.searchBar}>
        <TouchableOpacity onPress={() => { setSearchMode(false); setSearchText(''); setSearchResults([]); setCurrentResultIndex(-1); }}>
          <Icon name="arrow-back" size={24} color="#666" />
        </TouchableOpacity>
        <TextInput
          style={s.searchInput}
          placeholder="Search messages..."
          value={searchText}
          onChangeText={handleSearchTextChange}
          autoFocus
        />
        {searchResults.length > 0 && (
          <View style={s.searchNav}>
            <Text style={s.searchCount}>
              {`${currentResultIndex + 1} of ${searchResults.length}`}
            </Text>
            <TouchableOpacity onPress={goToPrevResult} style={s.searchNavButton}>
              <Icon name="chevron-up" size={24} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goToNextResult} style={s.searchNavButton}>
              <Icon name="chevron-down" size={24} color={theme.primary} />
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

    const targetId = (selectedMessage as any).type === 'media_group' ? (selectedMessage as any).messages[0].id : selectedMessage.id;
    await sendReaction(targetId, emoji);
    setShowMessageActions(false);
    setSelectedMessage(null);
  };

  const handleReplyFromMenu = () => {
    if (!selectedMessage) return;
    const targetMsg = (selectedMessage as any).type === 'media_group' ? (selectedMessage as any).messages[0] : selectedMessage;
    setReplyToMessage(targetMsg);
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

  const handleDeleteMessage = () => {
    if (!selectedMessage) return;

    const msgToDelete = selectedMessage;
    const isGroup = (msgToDelete as any).type === 'media_group';
    const isMe = msgToDelete.sender?.id === currentUser?.id;

    // ── 1. INSTANT optimistic UI update ──────────────────────────────────────
    if (isGroup) {
      setMessages(prev => prev.filter(m => m.id !== msgToDelete.id));
    } else {
      setMessages(prev =>
        prev.map(m =>
          m.id === msgToDelete.id
            ? { ...m, is_deleted: true, content: 'The message was removed' }
            : m,
        ),
      );
      const localId = msgToDelete.local_id || msgToDelete.id.toString();
      localDatabase.softDeleteMessage(localId);
    }

    // ── 2. Close menu instantly ───────────────────────────────────────────────
    setShowMessageActions(false);
    setSelectedMessage(null);
    Toast.show({
      type: 'success',
      text1: isMe ? 'Message unsent' : 'Message deleted',
      position: 'bottom',
    });

    // ── 3. Fire API in background (no await) ─────────────────────────────────
    const doDelete = async () => {
      try {
        if (isGroup) {
          const groupMessages: any[] = (msgToDelete as any).messages || [];
          await Promise.all(
            groupMessages
              .filter((m: any) => m.id && m.id < 1000000000)
              .map((m: any) => chatAPI.deleteMessage(m.id))
          );
        } else {
          await chatAPI.deleteMessage(msgToDelete.id);
        }
      } catch (error) {
        console.error('[Chat] Delete API error (restoring):', error);
        // Silently restore the message if API failed
        if (isGroup) {
          setMessages(prev => [msgToDelete, ...prev]);
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === msgToDelete.id ? msgToDelete : m,
            ),
          );
        }
        Toast.show({ type: 'error', text1: 'Could not delete, please try again', position: 'bottom' });
      }
    };
    doDelete();
  };

  const handleCopyMessage = () => {
    if (!selectedMessage) return;
    Clipboard.setString(selectedMessage.content);
    setShowMessageActions(false);
    setSelectedMessage(null);
    Toast.show({
      type: 'success',
      text1: 'Copied to clipboard',
      position: 'bottom',
    });
  };

  const latestSeenMessageId = useMemo(() => {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.sender?.id === currentUser?.id && m.is_read && !m.is_deleted) {
        return m.id;
      }
    }
    return null;
  }, [messages, currentUser?.id]);

  const fmtSeenTime = useCallback((d: string | null) => {
    if (!d) return 'Seen now';
    const now = Date.now();
    const seenTime = new Date(d).getTime();
    const diffMs = now - seenTime;
    const diffMin = diffMs / 60000;
    const diffHours = diffMs / 3600000;
    const diffDays = diffMs / 86400000;

    if (diffMin < 1) return 'Seen now';
    if (diffMin < 60) return `Seen ${Math.floor(diffMin)}m ago`;
    if (diffHours < 24) return `Seen ${Math.floor(diffHours)}h ago`;
    if (diffDays < 2) return 'Seen yesterday';
    return `Seen ${new Date(seenTime).toLocaleDateString()}`;
  }, []);

  const getMessageViewers = (msg: Message, conversationDetails: any) => {
    if (!conversationDetails || !conversationDetails.participants) return [];
    return conversationDetails.participants.filter((p: any) => {
      if (!p.user) return false;
      if (p.user.id === msg.sender?.id) return false; // exclude sender
      if (!p.last_read_message) return false;
      const lastReadId = typeof p.last_read_message === 'object' 
        ? p.last_read_message.id 
        : p.last_read_message;
      return lastReadId >= msg.id;
    });
  };

  const getSeenTime = (userId: number, msg: Message) => {
    const liveTime = liveReadTimes[userId];
    if (liveTime) return liveTime;
    return msg.created_at;
  };

  const GroupReadReceipts = ({ msg }: { msg: Message }) => {
    const viewers = useMemo(() => getMessageViewers(msg, conversation), [msg, conversation]);
    
    if (viewers.length === 0) return null;

    const isMe = msg.sender.id === currentUser?.id;

    return (
      <View style={[
        s.groupReceiptsContainer,
        {
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          marginRight: isMe ? 16 : 0,
          marginLeft: isMe ? 0 : (isGroup ? 48 : 16),
          marginTop: 2,
          marginBottom: 6,
        }
      ]}>
        <View style={s.groupReceiptsRow}>
          {viewers.map((v: any, idx: number) => {
            const isSelected = selectedReceiptUser?.id === v.user.id;
            return (
              <TouchableOpacity
                key={v.user.id}
                style={[
                  s.groupReceiptAvatarWrapper,
                  idx > 0 && { marginLeft: -6 },
                  isSelected && { borderWidth: 1.5, borderColor: theme.primary, borderRadius: 10, padding: 1 }
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  if (isSelected) {
                    setSelectedReceiptUser(null);
                  } else {
                    const time = fmtSeenTime(getSeenTime(v.user.id, msg));
                    const name = v.user.display_name || v.user.first_name || v.user.email || 'User';
                    setSelectedReceiptUser({ id: v.user.id, name, seenTime: time });
                  }
                }}
              >
                <AvatarWithFallback
                  uri={v.user.profile_picture}
                  sticker={v.user.avatar_sticker}
                  displayName={v.user.display_name || v.user.first_name || v.user.email || 'User'}
                  style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 0 }}
                  isGroup={false}
                  initialSize={9}
                  iconSize={9}
                />
              </TouchableOpacity>
            );
          })}
        </View>
        
        {selectedReceiptUser && viewers.some((v: any) => v.user.id === selectedReceiptUser.id) && (
          <Text style={[
            s.receiptDetailText,
            { textAlign: isMe ? 'right' : 'left' }
          ]}>
            {`${selectedReceiptUser.name} • ${selectedReceiptUser.seenTime}`}
          </Text>
        )}
      </View>
    );
  };

  const groupedMessages = useMemo(() => {
    const seenIds = new Set<string | number>();
    const deduplicated = (Array.isArray(messages) ? messages : []).filter(msg => {
      if (!msg) return false;
      const uid = msg.local_id || msg.id;
      if (seenIds.has(uid)) {
        return false;
      }
      seenIds.add(uid);
      return true;
    });

    const result: any[] = [];
    let currentGroup: Message[] = [];
    
    for (let i = deduplicated.length - 1; i >= 0; i--) {
       const msg = deduplicated[i];
       const isMedia = ['image', 'video'].includes(msg.message_type);
       
       if (isMedia && !msg.is_deleted && (msg as any).status !== 'failed') {
          if (currentGroup.length === 0) {
             currentGroup.push(msg);
          } else {
             const prevMsg = currentGroup[currentGroup.length - 1];
             const timeDiff = Math.abs(new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime());
             const sameSender = msg.sender.id === prevMsg.sender.id;
             
             if (sameSender && timeDiff < 60000) {
                currentGroup.push(msg);
             } else {
                if (currentGroup.length > 1) {
                   result.push({
                      type: 'media_group',
                      messages: [...currentGroup],
                      id: 'group_' + currentGroup[0].id,
                      sender: currentGroup[0].sender,
                      created_at: currentGroup[0].created_at,
                      reactions: currentGroup.reduce((acc, m) => ({ ...acc, ...(m.reactions || {}) }), {}),
                      content: currentGroup.find(m => m.content && m.content.trim())?.content || ''
                   });
                } else {
                   result.push(currentGroup[0]);
                }
                currentGroup = [msg];
             }
          }
       } else {
          if (currentGroup.length > 0) {
             if (currentGroup.length > 1) {
                result.push({
                   type: 'media_group',
                   messages: [...currentGroup],
                   id: 'group_' + currentGroup[0].id,
                   sender: currentGroup[0].sender,
                   created_at: currentGroup[0].created_at,
                   reactions: currentGroup.reduce((acc, m) => ({ ...acc, ...(m.reactions || {}) }), {}),
                   content: currentGroup.find(m => m.content && m.content.trim())?.content || ''
                });
             } else {
                result.push(currentGroup[0]);
             }
             currentGroup = [];
          }
          result.push(msg);
       }
    }
    
    if (currentGroup.length > 0) {
       if (currentGroup.length > 1) {
          result.push({
             type: 'media_group',
             messages: [...currentGroup],
             id: 'group_' + currentGroup[0].id,
             sender: currentGroup[0].sender,
             created_at: currentGroup[0].created_at,
             reactions: currentGroup.reduce((acc, m) => ({ ...acc, ...(m.reactions || {}) }), {}),
             content: currentGroup.find(m => m.content && m.content.trim())?.content || ''
          });
       } else {
          result.push(currentGroup[0]);
       }
    }
    
    return result.reverse();
  }, [messages]);

  // ── RENDER MESSAGE ───────────────────────────────
  const renderMessage = useCallback(({ item, index }: { item: any; index: number }) => {
    const isMe = item.sender.id === currentUser?.id;
    const sName =
      item.sender?.display_name ||
      item.sender?.first_name ||
      item.sender?.email ||
      'Unknown';
    const reaction = item.reactions?.[String(currentUser?.id)];
    const allReactions = item.reactions || {};
    // Only count reactions that actually have an emoji string
    const validReactions = Object.entries(allReactions).filter(([_, emoji]) => !!emoji && String(emoji).trim() !== '');
    const hasReactions = validReactions.length > 0;

    // We want to show avatar beside the receiver-side message group's first message (chronologically).
    // In our inverted list, messages are ordered newest-to-oldest, i.e. messages[0] is newest.
    // The chronologically previous message is messages[index + 1].
    // So the current message is the first of a consecutive block from the sender if:
    // the previous message (index + 1) is from a different sender (or doesn't exist).
    const isFirstInGroup = !isMe && (!groupedMessages[index + 1] || (groupedMessages[index + 1].sender?.id !== item.sender?.id));

    // Handle deleted messages
    if (item.is_deleted) {
      return (
        <View style={{ flexDirection: 'column', width: '100%' }}>
          {shouldShowDateSeparator(index, groupedMessages) && (
            <View style={s.dateSeparator}>
              <Text style={s.dateSeparatorText}>
                {formatSeparatorDate(item.created_at)}
              </Text>
            </View>
          )}
          <View
            style={[
              s.messageContainer,
              isMe ? s.myMessageContainer : s.theirMessageContainer,
            ]}
          >
            {!isMe && (
              isFirstInGroup ? (
                <MessageAvatar
                  uri={item.sender.profile_picture}
                  sticker={item.sender.avatar_sticker}
                  sName={sName}
                  userId={item.sender.id}
                  style={s.avatar}
                  navigation={navigation}
                  conversationId={conversationId}
                />
              ) : (
                <View style={{ width: 32, marginRight: spacing.xs }} />
              )
            )}
            <View
              style={[
                s.messageBubble,
                isMe ? s.myMessageBubble : s.theirMessageBubble,
                { backgroundColor: theme.chatBackground },
              ]}
            >
              <Text
                style={[
                  s.messageText,
                  { color: theme.textMuted, fontStyle: 'italic' },
                ]}
              >
                The message was removed
              </Text>
            </View>
          </View>
        </View>
      );
    }
    const renderMedia = () => {
    if (item.is_deleted) return null;
    
    // ONLY process media messages
    if (!['image', 'video', 'audio', 'document'].includes(item.message_type) && item.type !== 'media_group') return null;

    if (item.type === 'media_group') {
      return (
        <ChatMediaGrid
          messages={item.messages}
          onCancelUpload={() => {
            // Cancel all messages in this group
            item.messages.forEach((msg: any) => {
              const localId = msg.local_id || msg.id.toString();
              if (activeUploadsRef.current[localId]) {
                activeUploadsRef.current[localId].abort();
                delete activeUploadsRef.current[localId];
              }
              // Set status to failed in UI and DB
              setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'failed' } : m));
              localDatabase.updateMessageStatus(localId, 'failed');
            });
          }}
          onRetryUpload={() => {
            // Retry all failed messages in this group
            item.messages.forEach((msg: any) => {
              if (msg.status === 'failed' || msg.status === 'sending') {
                retryMessage(msg);
              }
            });
          }}
        />
      );
    }

    const isMe = item.sender.id === currentUser?.id;
    const rawUrl = (item as any).media_url || item.media_file || (item.content?.startsWith('http') ? item.content : null);
    const url = resolveImageUrl(rawUrl);
    
    const isStatusReply = item.content?.startsWith('↩ Replied to status');
    const hasMediaError = mediaErrorIds.includes(item.id);

    const alignmentStyle = { alignSelf: isMe ? 'flex-end' : 'flex-start' };

    // Unified Placeholder for deleted/unavailable media
    if (!url || hasMediaError || (isStatusReply && !url)) {
        let label = 'Media unavailable';
        if (isStatusReply) label = 'Status unavailable';
        else if (item.message_type === 'audio') label = 'Audio unavailable';
        else if (item.message_type === 'video') label = 'Video unavailable';
        else if (item.message_type === 'document') label = 'Document unavailable';

        return (
          <View 
            pointerEvents="none"
            style={[s.imageContainer, alignmentStyle, { backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0', padding: 10 }]}
          >
            <Icon name="alert-circle-outline" size={32} color="#999" />
            <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 8, fontWeight: '500', textAlign: 'center' }}>
               {label}
            </Text>
          </View>
        );
      }

    const downloadAndOpenFile = async (url: string, fileName: string) => {
        const { dirs } = RNFetchBlob.fs;
        const path = `${dirs.DocumentDir}/${fileName}`;
        
        try {
            const exists = await RNFetchBlob.fs.exists(path);
            if (!exists) {
                await RNFetchBlob.config({
                    path,
                    fileCache: true,
                }).fetch('GET', url);
            }
            await FileViewer.open(path);
        } catch (e) {
            console.error('File view error:', e);
            Alert.alert('Error', 'Could not open file');
        }
    };

    if (item.message_type === 'document') {
        const fileName = (item.media_file || 'Document').split('/').pop() || 'Document';
        const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
        let iconName = 'document-text-outline';
        if (fileExt === 'pdf') iconName = 'document-outline';
        else if (['doc', 'docx'].includes(fileExt || '')) iconName = 'document-attach-outline';
        else if (['xlsx', 'csv', 'txt', 'zip', 'rar'].includes(fileExt || '')) iconName = 'document-text-outline';
        
        const fileColor = getFileIconColor(fileExt);

        return (
          <View style={[s.documentBubbleInner, { alignSelf: isMe ? 'flex-end' : 'flex-start' }]}>
            {/* Left side: Icon + Extension label below it */}
            <View style={s.documentLeftContainer}>
              <Icon name={iconName} size={32} color={fileColor} />
              <Text style={[s.documentExtLabel, { color: fileColor }]}>
                {fileExt.toUpperCase() || 'FILE'}
              </Text>
            </View>

            {/* Middle: File name */}
            <View style={s.documentCenterContainer}>
              <Text 
                style={s.documentFileNameText} 
                numberOfLines={2}
                ellipsizeMode="middle"
              >
                {fileName}
              </Text>
            </View>

            {/* Right side: Green circular download button or Spinner */}
            <TouchableOpacity 
              style={s.documentDownloadButton}
              onPress={() => item.status !== 'sending' && downloadAndOpenFile(url, fileName)}
              activeOpacity={0.7}
              disabled={item.status === 'sending'}
            >
              {item.status === 'sending' ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Icon name="arrow-down" size={16} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>
        );
    }


    const isImage = item.message_type === 'image' || 
        (item.media_file && /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(item.media_file));

    const isSticker = item.media_file?.toLowerCase().endsWith('.webp');

    if (isImage) {
      // While sending, use the local URI directly from item.media_file so we show the actual image
      const displayUrl = (item as any).status === 'sending' ? (item.media_file || url) : url;
      return (
        <View style={{ position: 'relative' }}>
          <ChatImage 
            url={displayUrl}
            isMe={isMe}
            onPress={(e: any) => handleMessagePress(item, e)}
            onLongPress={(e: any) => handleMessageLongPress(item, e)}
            isSticker={isSticker}
          />
          {(item as any).status === 'sending' && (
            <View style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
                justifyContent: 'center', alignItems: 'center',
                borderRadius: isSticker ? 0 : 12,
                gap: 10,
            }}>
              <ActivityIndicator size="large" color="#FFF" />
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.8)',
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
                onPress={() => {
                  const localId = item.local_id || item.id.toString();
                  if (activeUploadsRef.current[localId]) {
                    activeUploadsRef.current[localId].abort();
                    delete activeUploadsRef.current[localId];
                  }
                  setMessages(prev => prev.map(m => m.id === item.id ? { ...m, status: 'failed' } : m));
                  localDatabase.updateMessageStatus(localId, 'failed');
                }}
              >
                <Icon name="close" size={14} color="#FFF" />
                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
          {(item as any).status === 'failed' && (
            <TouchableOpacity
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: isSticker ? 0 : 12,
                gap: 6,
              }}
              onPress={() => retryMessage(item)}
              activeOpacity={0.85}
            >
              <Icon name="refresh" size={32} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }}>Tap to retry</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    if (item.message_type === 'audio') {
      return (
        <View style={[s.audioContainer, alignmentStyle, { position: 'relative' }]}>
          <AudioPlayer
            mediaUrl={url}
            themeColor={theme.primary}
            duration={item.audio_duration}
            messageId={item.id}
          />
          {item.status === 'sending' && (
            <View style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(255,255,255,0.7)',
                justifyContent: 'center', alignItems: 'center',
                borderRadius: 20,
            }}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          )}
        </View>
      );
    }

    if (item.message_type === 'video') {
      return (
        <TouchableOpacity
          style={[s.videoContainer, alignmentStyle, { alignItems: isMe ? 'flex-end' : 'flex-start' }]}
          onPress={(e) => handleMessagePress(item, e)}
          onLongPress={(e) => handleMessageLongPress(item, e)}
          activeOpacity={0.9}
          delayLongPress={500}
          disabled={item.status === 'sending'}
        >
          <View style={{ justifyContent: 'center', alignItems: 'center', flex: 1, width: '100%' }}>
            {item.status === 'sending' ? (
                <ActivityIndicator size="large" color="#FFF" />
            ) : (
                <Icon name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
            )}
          </View>
        </TouchableOpacity>
      );
    }
      
      return null;
    };

    const isMediaMessage = ['image', 'video'].includes(item.message_type) || item.type === 'media_group';

    const renderReplyIndicator = (reply: Message, isSender: boolean) => {
      const hasThumbnail = ['image', 'video', 'document'].includes(getReplyMessageType(reply, messages) || '');
      return (
        <TouchableOpacity
          style={[s.replyIndicator, { backgroundColor: isSender ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)' }]}
          onPress={() => jumpToMessage(reply.id)}
          activeOpacity={0.7}
        >
          <View style={[s.replyIndicatorLine, { backgroundColor: isSender ? '#FFFFFF' : theme.primary }]} />
          <View style={s.replyIndicatorContentWrapper}>
            <Text style={[s.replyIndicatorText, { color: isSender ? '#FFFFFF' : theme.primary }]} numberOfLines={1}>
              {String(reply.sender?.id === currentUser?.id ? 'You' : reply.sender?.display_name || 'User')}
            </Text>
            <Text style={[s.replyIndicatorContent, { color: isSender ? '#EEEEEE' : '#666' }]} numberOfLines={2}>
              {getMessagePreviewText(reply, messages)}
            </Text>
          </View>
          {hasThumbnail && (
            <View style={s.replyThumbnailContainer}>
              {renderReplyThumbnail(reply, messages)}
            </View>
          )}
        </TouchableOpacity>
      );
    };

    const renderReactionsBadge = (isSender: boolean) => (
      <View style={[
        s.reactionBadge,
        {
          alignSelf: isSender ? 'flex-end' : 'flex-start',
          backgroundColor: theme.background,
          borderRadius: 12,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderWidth: 1,
          borderColor: '#E0E0E0',
          marginTop: 0,
          marginLeft: isSender ? 0 : 4,
          marginRight: isSender ? 4 : 0,
          shadowcolor: theme.textPrimary,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.1,
          shadowRadius: 1,
          elevation: 1,
        }
      ]}>
        {validReactions.map(([userId, emoji]) => (
          <Text key={userId} style={s.reactionEmoji}>{String(emoji || '')}</Text>
        ))}
      </View>
    );

    return (
      <View style={{ flexDirection: 'column', width: '100%' }}>
        {shouldShowDateSeparator(index, groupedMessages) && (
          <View style={s.dateSeparator}>
            <Text style={s.dateSeparatorText}>
              {formatSeparatorDate(item.created_at)}
            </Text>
          </View>
        )}
        <View
          style={[
            s.messageContainer,
            isMe ? s.myMessageContainer : s.theirMessageContainer,
            hasReactions && { marginBottom: 12 },
          ]}
        >
          {!isMe && (
            isFirstInGroup ? (
              <MessageAvatar
                uri={item.sender.profile_picture}
                sticker={item.sender.avatar_sticker}
                sName={sName}
                userId={item.sender.id}
                style={s.avatar}
                navigation={navigation}
                conversationId={conversationId}
              />
            ) : (
              <View style={{ width: 32, marginRight: spacing.xs }} />
            )
          )}

          {item.message_type === 'lottie_sticker' ? (
            <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <LottieStickerMessage
                url={item.content}
                onLongPress={() => handleMessageLongPress(item, {} as any)}
                onPress={() => {}}
              />
            </View>
          ) : ['image', 'video', 'audio', 'document'].includes(item.message_type) || item.type === 'media_group' ? (
            (() => {
              const hasCaption = !!(item.content && item.content.trim());
              return (
                <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '80%', position: 'relative' }}>
                  <TouchableOpacity
                    style={[
                      s.messageBubble,
                      isMe ? s.myMessageBubble : s.theirMessageBubble,
                      { alignItems: isMe ? 'flex-end' : 'flex-start' },
                      isMediaMessage && { padding: 0, overflow: 'hidden', backgroundColor: 'transparent' },
                      !isMediaMessage && { minWidth: 50 },
                      highlightMessageId === item.id && { 
                        backgroundColor: isMe ? '#D0BCFF' : '#E0E0E0',
                        borderWidth: 2,
                        borderColor: theme.primary 
                      }
                    ]}
                    onPress={(e) => {
                       // Only trigger message press if NOT media (media has its own internal handlers)
                       // and specifically ignore if it's an unavailable media
                       const isMedia = ['image', 'video', 'audio'].includes(item.message_type) || item.type === 'media_group';
                       const isUnavailable = item.type === 'media_group' ? false : (!resolveImageUrl((item as any).media_url || item.media_file) || mediaErrorIds.includes(item.id));

                       if (isMedia && isUnavailable) return;
                       handleMessagePress(item, e);
                       }}
                    onLongPress={(e) => handleMessageLongPress(item, e)}
                    activeOpacity={0.8}
                    delayLongPress={500}
                  >
                    {item.reply_to && renderReplyIndicator(item.reply_to, isMe)}
                    {!isMe && isGroup && <Text style={s.senderName} numberOfLines={1} ellipsizeMode="tail">{String(sName || '')}</Text>}
                    <View>
                      <View style={{ position: 'relative' }}>
                        {renderMedia()}
                      </View>
                      {hasCaption && (
                        <View style={{
                          maxWidth: 240,
                          paddingHorizontal: 8,
                          paddingTop: 6,
                          paddingBottom: 4,
                          alignSelf: isMe ? 'flex-end' : 'flex-start',
                        }}>
                          <Text style={{
                            fontSize: 14,
                            color: '#1A1A1A',
                            lineHeight: 18,
                            textAlign: isMe ? 'right' : 'left',
                          }}>
                            {String(item.content)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  {hasReactions && renderReactionsBadge(isMe)}
                </View>
              );
            })()
          ) : (
            isMe ? (
              <View style={{ maxWidth: '80%', minWidth: 50, alignSelf: 'flex-end' }}>
                <TouchableOpacity
                  style={[
                    {
                      width: '100%',
                      alignItems: 'flex-start',
                      padding: spacing.md,
                      borderRadius: borderRadius.lg,
                      borderTopRightRadius: 4,
                      overflow: 'hidden',
                    }
                  ]}
                  onPress={(e) => handleMessagePress(item, e)}
                  onLongPress={(e) => handleMessageLongPress(item, e)}
                  activeOpacity={0.8}
                  delayLongPress={500}
                >
                  <LinearGradient
                    colors={['#d68df5', '#9b50d8', '#8e2bff']}
                    start={{ x: 0, y: 1 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                  {item.reply_to && renderReplyIndicator(item.reply_to, true)}
                  {!!item.edited_at && (
                    <Text style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.7)', marginBottom: 2, fontStyle: 'italic' }}>Edited</Text>
                  )}
                  <Text style={[s.messageText, { color: '#FFFFFF' }]}>
                    {String(item.content || '')}
                  </Text>
                </TouchableOpacity>
                {hasReactions && renderReactionsBadge(true)}
              </View>
            ) : (
              <View style={{ maxWidth: '70%', minWidth: 50, alignSelf: 'flex-start' }}>
                <TouchableOpacity
                  style={[
                    s.messageBubble,
                    s.theirMessageBubble,
                    {
                      width: '100%',
                      alignItems: 'flex-start',
                      backgroundColor: '#EFEFEF',
                      borderTopLeftRadius: 4,
                      padding: spacing.md,
                      borderRadius: borderRadius.lg,
                    }
                  ]}
                  onPress={(e) => handleMessagePress(item, e)}
                  onLongPress={(e) => handleMessageLongPress(item, e)}
                  activeOpacity={0.8}
                  delayLongPress={500}
                >
                  {item.reply_to && renderReplyIndicator(item.reply_to, false)}
                  {!isMe && isGroup && <Text style={s.senderName} numberOfLines={1} ellipsizeMode="tail">{String(sName || '')}</Text>}
                  {!!item.edited_at && (
                    <Text style={{ fontSize: 11, color: '#ff0000', marginBottom: 2, fontStyle: 'italic' }}>Edited</Text>
                  )}
                  <Text style={[s.messageText, { color: theme.textPrimary }]}>
                    {String(item.content || '')}
                  </Text>
                                  </TouchableOpacity>
                {hasReactions && renderReactionsBadge(false)}
              </View>
            )
          )}
        </View>
        
        {/* Seen Status (Instagram Style) */}
        {!isGroup && item.id === latestSeenMessageId && (
          <View style={{ alignSelf: 'flex-end', marginRight: 16, marginTop: -2, marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '500' }}>
              {fmtSeenTime(item.delivered_at || item.created_at)}
            </Text>
          </View>
        )}

        {isGroup && item.id === messages[0]?.id && (
          <GroupReadReceipts msg={item} />
        )}
      </View>
    );
  }, [currentUser, isGroup, highlightMessageId, mediaErrorIds, messages, editingMessageId, latestSeenMessageId, fmtSeenTime, liveReadTimes, selectedReceiptUser]);
  

  const renderGroupCallBanner = () => {
    if (!activeGroupCall || !isGroup) return null;
    return (
      <View style={s.callBanner}>
        <Text style={s.callBannerText}>📞 Group call in progress...</Text>
        <TouchableOpacity
          style={s.joinButton}
          onPress={() => {
            navigation.navigate('Call', {
              callType: activeGroupCall.call_type,
              room_id: activeGroupCall.room_id,
              conversationId: conversationId,
              isGroupCall: true,
            });
          }}
        >
          <Text style={s.joinButtonText}>Join</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      {searchMode ? renderSearchBar() : (
      <View style={s.customHeader}>
        <TouchableOpacity 
           style={s.headerBackButton}
           onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color={'#111111'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.headerCenter}
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
          <AvatarWithFallback
            uri={isGroup ? (conversation?.profile_picture || route.params?.avatarUri) : (otherUser?.profile_picture || route.params?.avatarUri)}
            sticker={isGroup ? null : (otherUser?.avatar_sticker || route.params?.avatarSticker)}
            displayName={isGroup ? (conversation?.name || chatTitle) : (otherUser?.display_name || otherUser?.email || chatTitle)}
            isGroup={isGroup}
            style={s.headerAvatar}
          />

          <View style={s.headerTextContainer}>
            <Text style={s.headerName} numberOfLines={1}>
              {chatTitle}
            </Text>
            <Text style={s.headerStatus}>
              {isGroup
                ? groupDescription || 'Group details'
                : otherUser
                ? amIBlocked
                  ? ''
                  : otherUser.last_seen_privacy === 'nobody'
                  ? ''
                  : fmtLastSeen(otherUser.last_seen) === 'Online'
                  ? 'Online'
                  : `Last seen ${fmtLastSeen(otherUser.last_seen)}`
                : ''}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={s.headerRight}>
          {/* Call buttons are disabled and muted if users are not friends (except in groups) */}
          <TouchableOpacity
            style={[s.callIcon, !isGroup && friendStatus !== 'friends' && { opacity: 0.3 }]}
            disabled={!isGroup && friendStatus !== 'friends'}
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
            <Icon name="videocam" size={22} color={'#111111'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.callIcon, !isGroup && friendStatus !== 'friends' && { opacity: 0.3 }]}
            disabled={!isGroup && friendStatus !== 'friends'}
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
            <Icon name="call" size={20} color={'#111111'} />
          </TouchableOpacity>
        </View>
      </View>
      )}

      {renderGroupCallBanner()}

      {/* FIX 1: inverted FlatList - always starts at bottom, no scrollToEnd needed */}
      <FlatList
        ref={flatListRef}
        data={groupedMessages}
        renderItem={renderMessage}
        keyExtractor={item => (item.local_id || item.id).toString()}
        contentContainerStyle={[s.messagesList, { paddingBottom: 8 }]}
        inverted={true}
        // Load older messages when user scrolls to top (= onEndReached in inverted list)
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.3}
        onScroll={handleOnScroll}
        onScrollToIndexFailed={info => {
          console.warn('ScrollToIndex failed, scrolling to estimated offset and retrying...', info);
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
          setTimeout(() => {
            try {
              flatListRef.current?.scrollToIndex({ 
                index: info.index, 
                animated: true, 
                viewPosition: 0.5 
              });
            } catch (err) {
              console.warn('ScrollToIndex retry failed:', err);
            }
          }, 100);
        }}
        scrollEventThrottle={16}
        ListFooterComponent={
          isLoadingOlder ? (
            <View style={s.loadingOlderContainer}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={s.loadingOlderText}>
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
          isLoading ? (
            <View style={s.listLoadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : !isLoading && searchText ? (
            <View style={s.emptySearchContainer}>
              <Icon name="search-outline" size={48} color="#DDD" />
              <Text style={s.emptySearchText}>No messages found</Text>
            </View>
          ) : null
        }
      />

      {/* Scroll to bottom button */}
      {showScrollToBottom && (
        <TouchableOpacity
          style={s.scrollToBottomButton}
          onPress={scrollToBottom}
          activeOpacity={0.8}
        >
          <Icon name="chevron-down" size={24} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* Typing */}
      {typingUsers.length > 0 && (
        <View style={s.typingContainer}>
          <Text style={s.typingText}>
            {`${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'are' : 'is'} typing...`}
          </Text>
        </View>
      )}

      {/* Reply preview */}
      {replyToMessage && (
        <View style={s.replyPreview}>
          <View style={s.replyPreviewContent}>
            <Text style={s.replyPreviewTitle}>
              {`Replying to ${replyToMessage.sender.id === currentUser?.id ? 'yourself' : replyToMessage.sender.display_name || 'User'}`}
            </Text>
            <Text style={s.replyPreviewText} numberOfLines={2}>
              {getMessagePreviewText(replyToMessage, messages)}
            </Text>
          </View>
          {['image', 'video', 'document'].includes(getReplyMessageType(replyToMessage, messages) || '') && (
            <View style={s.replyPreviewThumbnailContainer}>
              {renderReplyThumbnail(replyToMessage, messages)}
            </View>
          )}
          <TouchableOpacity
            onPress={() => setReplyToMessage(null)}
            style={s.cancelReplyButton}
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
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowEmojiPicker(false);
            setSelectedMessage(null);
          }}
        >
          <View style={s.emojiPicker}>
            <Text style={s.emojiPickerTitle}>React with</Text>
            <View style={s.emojiGrid}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  style={s.emojiButton}
                  onPress={() => {
                    if (selectedMessage) {
                      const targetId = (selectedMessage as any).type === 'media_group' ? (selectedMessage as any).messages[0].id : selectedMessage.id;
                      sendReaction(targetId, e);
                    }
                  }}
                >
                  <Text style={s.emoji}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {selectedMessage && (
              <View style={s.messageActions}>
                <TouchableOpacity
                  style={s.actionButton}
                  onPress={() => {
                    if (selectedMessage) {
                      const targetMsg = (selectedMessage as any).type === 'media_group' ? (selectedMessage as any).messages[0] : selectedMessage;
                      setReplyToMessage(targetMsg);
                      setShowEmojiPicker(false);
                      setSelectedMessage(null);
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-undo-outline"
                      size={20}
                      color={theme.primary}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={s.actionButtonText}>Reply</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Double-tap reaction animation overlay */}
      {doubleTapReaction.visible && (
        <View style={s.doubleTapOverlay}>
          <Animated.View
            style={[
              s.doubleTapReaction,
              {
                top: doubleTapReaction.y,
                left: doubleTapReaction.x,
                transform: [{ scale: doubleTapScale }],
                opacity: doubleTapOpacity,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={s.doubleTapHeart}>{currentUser?.quick_reaction || '❤️'}</Text>
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
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }}
          activeOpacity={1}
          onPress={() => {
            setShowMessageActions(false);
            setSelectedMessage(null);
          }}
        >
          {selectedMessage && (() => {
            const isMe = selectedMessage.sender.id === currentUser?.id;
            const screenHeight = Dimensions.get('window').height;
            const positionStyle: any = { position: 'absolute', width: 280 };
            
            const isTemp = selectedMessage.id > 1000000000;
            const msgTime = new Date(selectedMessage.created_at).getTime();
            const now = Date.now();
            const diffMin = (now - msgTime) / (1000 * 60);
            const canEdit = !isTemp && diffMin <= 15;
            const canUnsend = !isTemp && diffMin <= 1440; // 24 hours
            
            if (menuPosition.y < screenHeight * 0.45) {
              positionStyle.top = Math.max(70, menuPosition.y + 10);
            } else {
              positionStyle.bottom = Math.max(80, (screenHeight - menuPosition.y) + 10);
            }
            
            if (isMe) {
              positionStyle.right = 16;
            } else {
              positionStyle.left = 48; // offset for avatar
            }

            return (
              <View style={[s.messageActionsContainer, positionStyle]}>
                {/* Row 1: Reactions */}
                <View style={s.emojiRow}>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={['❤️', '😂', '😁','😒','😊', '🤣', '🤗','🥰','😘', '😉', '😏','😔','🤫', '✅', '🤔','🙄','🥳','🔥', '😍', '🥹', '😭', '😮', '👍', '🙏', '💯']}
                    keyExtractor={(item) => item}
                    contentContainerStyle={{ paddingHorizontal: 8 }}
                    renderItem={({ item: emoji }) => (
                      <TouchableOpacity
                        style={s.emojiQuickButton}
                        onPress={() => handleQuickReaction(emoji)}
                        activeOpacity={0.7}
                      >
                        <Text style={s.emojiQuick}>{emoji}</Text>
                      </TouchableOpacity>
                    )}
                  />
                </View>

                {/* Row 2: Sender (Time & Status) vs Receiver (Time Only) */}
                {isMe ? (
                  <View style={s.menuTimeStatusRow}>
                    <Text style={s.menuTimeText}>
                      {fmtMsgTime(selectedMessage.created_at)}
                    </Text>
                    <Text style={s.menuTimeText}>
                      {new Date(selectedMessage.created_at).toLocaleDateString()}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {selectedMessage.is_read ? (
                        <Icon name="checkmark-done" size={16} color={theme.primary} />
                      ) : selectedMessage.delivered_at ? (
                        <Icon name="checkmark-done" size={16} color="#A0A0A0" />
                      ) : (
                        <Icon name="checkmark" size={16} color="#A0A0A0" />
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={s.menuTimeStatusRow}>
                    <Text style={s.menuTimeText}>
                      {fmtMsgTime(selectedMessage.created_at)}
                    </Text>
                    <Text style={s.menuTimeText}>
                      {new Date(selectedMessage.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                )}

                {/* Vertical actions menu */}
                <View style={s.actionsColumn}>
                  {/* Row 3: Reply */}
                  <TouchableOpacity
                    style={s.actionMenuItem}
                    onPress={handleReplyFromMenu}
                  >
                    <View style={s.actionMenuItemContent}>
                      <Icon
                        name="arrow-undo-outline"
                        size={20}
                        color="#333"
                        style={{ marginRight: 12 }}
                      />
                      <Text style={s.actionMenuItemText}>Reply</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Row 4 (Sender Edit, Receiver Copy) */}
                  {isMe ? (
                    <>
                      {/* Edit */}
                      {canEdit && (
                        <TouchableOpacity
                          style={s.actionMenuItem}
                          onPress={handleEditMessage}
                        >
                          <View style={s.actionMenuItemContent}>
                            <Icon
                              name="create-outline"
                              size={20}
                              color="#333"
                              style={{ marginRight: 12 }}
                            />
                            <Text style={s.actionMenuItemText}>Edit</Text>
                          </View>
                        </TouchableOpacity>
                      )}

                      {/* Copy */}
                      <TouchableOpacity
                        style={s.actionMenuItem}
                        onPress={handleCopyMessage}
                      >
                        <View style={s.actionMenuItemContent}>
                          <Icon
                            name="copy-outline"
                            size={20}
                            color="#333"
                            style={{ marginRight: 12 }}
                          />
                          <Text style={s.actionMenuItemText}>Copy</Text>
                        </View>
                      </TouchableOpacity>

                      {/* Unsend */}
                      {canUnsend && (
                        <TouchableOpacity
                          style={s.actionMenuItem}
                          onPress={handleDeleteMessage}
                        >
                          <View style={s.actionMenuItemContent}>
                            <Icon
                              name="trash-outline"
                              size={20}
                              color="#FF4444"
                              style={{ marginRight: 12 }}
                            />
                            <Text style={[s.actionMenuItemText, { color: '#FF4444' }]}>
                              Unsend
                            </Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Copy */}
                      <TouchableOpacity
                        style={s.actionMenuItem}
                        onPress={handleCopyMessage}
                      >
                        <View style={s.actionMenuItemContent}>
                          <Icon
                            name="copy-outline"
                            size={20}
                            color="#333"
                            style={{ marginRight: 12 }}
                          />
                          <Text style={s.actionMenuItemText}>Copy</Text>
                        </View>
                      </TouchableOpacity>

                      {/* Delete */}
                      <TouchableOpacity
                        style={s.actionMenuItem}
                        onPress={handleDeleteMessage}
                      >
                        <View style={s.actionMenuItemContent}>
                          <Icon
                            name="trash-outline"
                            size={20}
                            color="#FF4444"
                            style={{ marginRight: 12 }}
                          />
                          <Text style={[s.actionMenuItemText, { color: '#FF4444' }]}>
                            Delete
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          })()}
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
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFullEmojiPicker(false)}
        >
          <View style={s.emojiPicker}>
            <Text style={s.emojiPickerTitle}>All Emojis</Text>
            <View style={s.emojiGrid}>
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
                  style={s.emojiButton}
                  onPress={() => {
                    handleQuickReaction(e);
                    setShowFullEmojiPicker(false);
                  }}
                >
                  <Text style={s.emoji}>{e}</Text>
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
        <View style={s.permissionModalOverlay}>
          <View style={s.permissionModal}>
            <Icon
              name="mic"
              size={48}
              color={theme.primary}
              style={{ marginBottom: spacing.md }}
            />
            <Text style={s.permissionModalTitle}>
              Microphone Access Required
            </Text>
            <Text style={s.permissionModalMessage}>
              Allow microphone access to record voice messages.
            </Text>
            <View style={s.permissionModalButtons}>
              <TouchableOpacity
                style={[s.permissionButton, s.allowButton]}
                onPress={() => {
                  setShowPermissionModal(false);
                  Linking.openSettings();
                }}
              >
                <Text
                  style={[
                    s.permissionButtonText,
                    s.permissionButtonTextWhite,
                  ]}
                >
                  Allow Access
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.permissionButton, s.notNowButton]}
                onPress={() => setShowPermissionModal(false)}
              >
                <Text
                  style={[
                    s.permissionButtonText,
                    s.permissionButtonTextDark,
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
        <View style={s.blockedContainer}>
          <Text style={s.blockedText}>You have blocked this user</Text>
          <TouchableOpacity
            style={s.unblockButton}
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
                  try {
                    const key = `settings_blocked_users_${currentUser?.id || 'default'}`;
                    const stored = await AsyncStorage.getItem(key);
                    const list = stored ? JSON.parse(stored) : [];
                    const filtered = list.filter((u: any) => u.id !== otherUser.id.toString());
                    await AsyncStorage.setItem(key, JSON.stringify(filtered));
                  } catch (e) {
                    console.warn(e);
                  }
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
            <Text style={s.unblockButtonText}>Unblock User</Text>
          </TouchableOpacity>
        </View>
      ) : amIBlocked ? (
        <View style={s.blockedContainer}>
          <Text style={s.blockedText}>You are blocked by this user</Text>
          <Text style={s.blockedSubtext}>
            Messages will not be delivered
          </Text>
        </View>
      ) : (
        <>
          {messages.length === 0 && !isLoading && (
            <View style={s.quickStickersRowWrapper}>
              <View style={s.quickStickersContainerEvenly}>
                {FRESH_CHAT_STICKERS.map((st) => (
                  <TouchableOpacity
                    key={st.id}
                    style={s.quickStickerCard}
                    onPress={() => sendLottieSticker(st)}
                    activeOpacity={0.7}
                  >
                    <LottieView
                      source={{ uri: st.url }}
                      autoPlay
                      loop
                      style={s.quickStickerLottie}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          <View style={s.inputContainer}>
            {/* Scenario A: The sender is waiting for approval */}
            {!isGroup && friendStatus !== 'friends' && messageRequestStatus === 'pending' && messageRequestSenderId === currentUser?.id ? (
              <View style={{
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                borderTopWidth: 0.5,
                borderTopColor: 'rgba(255, 255, 255, 0.1)',
                paddingHorizontal: 16,
                paddingVertical: 14,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 13.5, color: 'rgba(255, 255, 255, 0.7)', fontWeight: '600', textAlign: 'center' }}>
                  ⏳ Message request pending
                </Text>
                <Text style={{ fontSize: 11.5, color: 'rgba(255, 255, 255, 0.4)', marginTop: 2, textAlign: 'center' }}>
                  You can send more messages once your request is approved.
                </Text>
              </View>
            ) : !isGroup && friendStatus !== 'friends' && messageRequestStatus === 'pending' && messageRequestSenderId !== currentUser?.id ? (
              /* Scenario B: The receiver sees a pending request */
              <View style={{
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                borderTopWidth: 0.5,
                borderTopColor: 'rgba(255, 255, 255, 0.1)',
                paddingHorizontal: 16,
                paddingVertical: 14,
                alignItems: 'center',
              }}>
                <Text style={{ fontSize: 13.5, color: '#fff', fontWeight: '700', textAlign: 'center' }}>
                  💬 Message Request
                </Text>
                <Text style={{ fontSize: 11.5, color: 'rgba(255, 255, 255, 0.5)', marginTop: 2, marginBottom: 12, textAlign: 'center' }}>
                  Do you want to let {otherUser?.display_name || otherUser?.first_name || 'this user'} message you?
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, width: '100%', paddingHorizontal: 12 }}>
                  <TouchableOpacity
                    onPress={handleRejectMessageRequest}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(255, 69, 58, 0.15)',
                      borderWidth: 1,
                      borderColor: 'rgb(255, 69, 58)',
                      borderRadius: 20,
                      paddingVertical: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: 'rgb(255, 69, 58)', fontWeight: '700', fontSize: 13 }}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleApproveMessageRequest}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(52, 199, 89, 0.15)',
                      borderWidth: 1,
                      borderColor: 'rgb(52, 199, 89)',
                      borderRadius: 20,
                      paddingVertical: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: 'rgb(52, 199, 89)', fontWeight: '700', fontSize: 13 }}>Approve</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Scenario C: Normal input composer */
              <ChatInputArea
                isRecording={isRecording}
                editingMessageId={editingMessageId}
                inputText={inputText}
                isSending={isSending}
                handleAttachment={handleAttachmentStable}       
                handleCameraCapture={handleCameraCaptureStable}
                handleTyping={handleTyping}
                sendMessage={sendMessageStable}
                setStickerPreview={setStickerPreviewStable}
                micPanResponder={micPanResponder}
                micButtonScale={micButtonScale}
                THEME_COLOR={theme.primary}
                inputClearKey={inputClearKey}
                onRegisterClear={(fn) => { clearInputRef.current = fn; }}
                isDisabled={false}
                onOpenStickerPicker={() => setStickerPickerVisible(true)}
              />
            )}

            {isRecording && (
              <Animated.View
                style={[
                  s.recordingContainerInline,
                  { transform: [{ translateX: slideX }] },
                ]}
              >
                <Animated.View
                  style={[
                    s.recordingPulseSmall,
                    { transform: [{ scale: micButtonScale }] },
                  ]}
                >
                  <View style={s.recordingDotSmall} />
                </Animated.View>
                <Text style={s.recordingTimerInline}>
                  {fmtRec(recordingTime)}
                </Text>
                <Text
                  style={[
                    s.slideHint,
                    isCancelled && s.slideHintCancel,
                  ]}
                >
                  {isCancelled ? '✕ Release to cancel' : '◀ Slide to cancel'}
                </Text>
              </Animated.View>
            )}
          </View>
        </>
      )}

      <Toast />

      {/* ── Lottie Sticker Picker Sheet ──────────────────────────────── */}
      <StickerPickerSheet
        visible={stickerPickerVisible}
        stickerPacks={BUILT_IN_STICKER_PACKS}
        onSelectSticker={(sticker) => sendLottieSticker(sticker)}
        onClose={() => setStickerPickerVisible(false)}
      />

      <StickerPreviewModal
        visible={!!stickerPreview}
        mediaUri={stickerPreview?.uri ?? ''}
        mimeType={stickerPreview?.mimeType ?? ''}
        onClose={() => setStickerPreview(null)}
        theme="light"
        restoreNavBarColor="#ffffff"
        onSend={async (uri, mimeType, caption) => {
          setStickerPreview(null);
          await sendImageMessage({ uri, type: mimeType });
        }}
      />
      <MediaPickerModal
          visible={cameraMenuVisible}
          onClose={() => setCameraMenuVisible(false)}
          mode="camera"
          bottom={Platform.OS === 'ios' ? 70 : 60}
          left={60}
          onMediaSelected={async (assets: any[]) => {
              if (assets.length > 0) {
                  setSelectedMultiMedia(assets.map(asset => ({
                      uri: asset.uri,
                      type: asset.type || 'image/jpeg',
                      fileName: asset.fileName
                  })));
                  setMultiPreviewVisible(true);
              }
          }}
      />
      <MediaPickerModal 
          visible={attachmentMenuVisible} 
          onClose={() => setAttachmentMenuVisible(false)}
          mode="attachment"
          bottom={Platform.OS === 'ios' ? 70 : 60}
          left={20}
          onMediaSelected={async (assets: any[]) => {
              // This handler is now only for camera captures from attachment menu
              if (assets.length > 0) {
                  setSelectedMultiMedia(assets.map(asset => ({
                      uri: asset.uri,
                      type: asset.type || (asset.uri.endsWith('.mp4') || asset.uri.endsWith('.mov') ? 'video/mp4' : 'image/jpeg'),
                      fileName: asset.fileName
                  })));
                  setMultiPreviewVisible(true);
              }
          }}
          onDocumentSelected={async (docs: any[]) => {
              if (docs && docs.length > 0) {
                  docs.forEach(doc => sendDocumentMessage(doc));
              }
          }}
          onOpenGallery={() => {
              setAttachmentMenuVisible(false);
              setGalleryPickerVisible(true);
          }}
      />
      <CustomGalleryPicker
        visible={galleryPickerVisible}
        onClose={() => setGalleryPickerVisible(false)}
        themeColor={theme.primary}
        onSelect={(assets) => {
          if (assets.length > 0) {
            setSelectedMultiMedia(assets.map(asset => ({
              uri: asset.uri,
              type: asset.type,
              fileName: asset.fileName,
            })));
            setMultiPreviewVisible(true);
          }
        }}
      />
      <MultiMediaPreviewModal
        visible={multiPreviewVisible}
        mediaItems={selectedMultiMedia}
        onClose={() => {
          setMultiPreviewVisible(false);
          setSelectedMultiMedia([]);
        }}
        onSend={(items) => {
          items.forEach(item => {
            sendImageMessage(item, item.caption);
          });
        }}
        themeColor={theme.primary}
      />
      <MediaGroupListModal
        visible={groupListVisible}
        messages={selectedGroupMessages}
        onClose={() => {
          setGroupListVisible(false);
          setSelectedGroupMessages([]);
        }}
        onSelectMedia={(msg) => {
          // Close the vertical list modal
          setGroupListVisible(false); 
          
          // Map all messages in the group to a compatible MediaItem format
          const mediaList = selectedGroupMessages.map(m => ({
            mediaUrl: resolveImageUrl((m as any).media_url || m.media_file),
            mediaType: m.message_type === 'video' ? 'video' : 'image' as 'image' | 'video',
            id: m.id,
            caption: m.content || '',
          }));
          
          const initialIndex = selectedGroupMessages.findIndex(m => m.id === msg.id);
          
          navigation.navigate('MediaViewer', { 
            mediaUrl: resolveImageUrl((msg as any).media_url || msg.media_file), 
            mediaType: msg.message_type === 'video' ? 'video' : 'image',
            mediaList,
            initialIndex: initialIndex >= 0 ? initialIndex : 0,
          });
        }}
        themeColor={theme.primary}
      />
      </KeyboardAvoidingView>
      );
      };

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    height: 60,
  },
  headerLeft: { width: 40, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 28, color: theme.textPrimary, fontWeight: '300' },
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
    color: theme.primary,
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  headerTextContainer: { flex: 1 },
  headerName: { fontSize: fontSize.lg, fontWeight: '600', color: 'black' },
  headerStatus: { fontSize: fontSize.xs, color: theme.textSecondary },
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
    color: theme.textSecondary,
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
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: theme.primary, fontSize: fontSize.sm, fontWeight: 'bold' },
  messageBubble: {
    borderRadius: borderRadius.lg,
  },
  myMessageBubble: { backgroundColor: 'transparent', borderTopRightRadius: 4 },
  theirMessageBubble: { backgroundColor: 'transparent', borderTopLeftRadius: 4 },
  senderName: {
    fontSize: fontSize.sm,
    color: theme.primary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  messageText: { fontSize: 16, lineHeight: 22, flexShrink:0, flex:0 },
  myMessageText: { color: theme.textPrimary },
  theirMessageText: { color: theme.textPrimary },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  messageTime: { fontSize: fontSize.xs },
  myMessageTime: { color: theme.textSecondary },
  theirMessageTime: { color: theme.textSecondary },
  messageStatus: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  seenText: { color: theme.primary },
  deliveredText: { color: SENT_COLOR },
  sentText: { color: SENT_COLOR },
  groupReceiptsContainer: {
    marginVertical: 4,
    flexDirection: 'column',
  },
  groupReceiptsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupReceiptAvatarWrapper: {
    shadowcolor: theme.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1,
    elevation: 1,
  },
  receiptDetailText: {
    fontSize: 10,
    color: theme.textMuted,
    marginTop: 4,
    fontWeight: '500',
  },
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
    backgroundcolor: theme.textPrimary,
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
  documentBubbleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: borderRadius.md,
    width: 250,
  },
  documentLeftContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    minWidth: 42,
  },
  documentExtLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
  },
  documentCenterContainer: {
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  documentFileNameText: {
    fontSize: 13,
    color: theme.textPrimary,
    fontWeight: '500',
  },
  documentDownloadButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2E7D32', // Premium Green
    justifyContent: 'center',
    alignItems: 'center',
    shadowcolor: theme.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  dateSeparator: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginVertical: 12,
  },
  dateSeparatorText: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  replyIndicator: {
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    minWidth: 180,
  },
  replyIndicatorLine: {
    width: 3,
    backgroundColor: theme.primary,
    borderRadius: 2,
    marginRight: 8,
    flexShrink: 0,
  },
  replyIndicatorText: {
    fontSize: fontSize.xs,
    color: theme.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyIndicatorContent: {
    fontSize: fontSize.sm,
    color: theme.textSecondary,
    flexShrink: 1,
  },
  replyThumbnailContainer: {
    marginLeft: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  replyPreviewThumbnailContainer: {
    marginRight: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  replyMediaThumbnail: {
    width: '100%',
    height: '100%',
  },
  replyMediaPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  reactionBadge: {
    alignSelf: 'flex-end',
    backgroundColor: theme.background,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
    marginRight: 4,
    marginBottom: 4,
  },
  reactionEmoji: { fontSize: 16 },
  inlineTimestampContainer: {
    position: 'absolute',
    bottom: -2,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    zIndex: 10,
  },
  inlineTimestampText: {
    fontSize: fontSize.xs,
  },
  inlineMessageStatus: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  typingContainer: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  typingText: { fontSize: fontSize.xs, color: theme.textSecondary, fontStyle: 'italic' },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.chatBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  replyPreviewContent: {
    flex: 1,
    borderLeftWidth: 3,
    borderLeftColor: theme.primary,
    paddingLeft: spacing.sm,
  },
  replyPreviewTitle: {
    fontSize: fontSize.xs,
    color: theme.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyPreviewText: { fontSize: fontSize.sm, color: theme.textSecondary },
  cancelReplyButton: { padding: spacing.sm },
  cancelReplyText: { fontSize: fontSize.lg, color: theme.textSecondary },
  inputContainer: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: theme.background,
    alignItems: 'flex-end',
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
  slideHint: { fontSize: fontSize.sm, color: theme.textMuted },
  slideHintCancel: { color: '#FF4444', fontWeight: '600' },
  attachmentButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.chatBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  attachmentButtonText: { fontSize: fontSize.xl },
  input: {
    flex: 1,
    backgroundColor: theme.chatBackground,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
    color: theme.textPrimary,
    maxHeight: 100,
    minHeight: 40,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.chatBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  micButtonRecording: { backgroundColor: '#FF4444' },
  micButtonText: { fontSize: fontSize.xl },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  sendButtonText: { color: '#FFF', fontSize: fontSize.lg, marginTop: -2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  emojiPicker: {
    backgroundColor: theme.background,
    padding: spacing.lg,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
  },
  emojiPickerTitle: {
    fontSize: fontSize.md,
    color: theme.textSecondary,
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
    color: theme.primary,
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
    backgroundColor: theme.background,
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
    color: theme.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  permissionModalMessage: {
    fontSize: fontSize.md,
    color: theme.textSecondary,
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
  allowButton: { backgroundColor: theme.primary },
  notNowButton: { backgroundColor: theme.chatBackground },
  permissionButtonText: { fontSize: fontSize.md, fontWeight: '600' },
  permissionButtonTextDark: { color: theme.textPrimary },
  permissionButtonTextWhite: { color: '#FFFFFF' },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 70,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundcolor: theme.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
    shadowcolor: theme.textPrimary,
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
    backgroundColor: theme.chatBackground,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    gap: spacing.md,
  },
  blockedText: {
    fontSize: fontSize.md,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  blockedSubtext: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
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
    backgroundColor: theme.background,
    borderRadius: 16,
    padding: 0,
    width: 200,
    shadowcolor: theme.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    overflow: 'hidden',
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  emojiQuickButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  emojiQuick: {
    fontSize: 28,
  },
  menuTimeStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  menuTimeText: {
    fontSize: 13,
    color: theme.textSecondary,
  },
  menuStatusText: {
    fontSize: 13,
    color: theme.textSecondary,
  },
  actionsColumn: {
    paddingVertical: 4,
  },
  actionMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  actionMenuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionMenuItemText: {
    fontSize: 15,
    color: theme.textPrimary,
  },
  // Double-tap reaction animation
  doubleTapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    pointerEvents: 'none',
  },
  doubleTapReaction: {
    position: 'absolute',
    width: 50,
    height: 50,
    marginLeft: -25,
    marginTop: -25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doubleTapHeart: {
    fontSize: 40,
    textAlign: 'center',
  },
  // Search bar styles
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    paddingHorizontal: spacing.md,
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: theme.textPrimary,
    marginLeft: spacing.md,
  },
  searchNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchCount: {
    fontSize: 14,
    color: theme.textSecondary,
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
  listLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 150,
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
    color: theme.textMuted,
  },
  highlightedText: {
    backgroundColor: '#FFEB3B',
    color: theme.textPrimary,
  },
  replyIndicatorContentWrapper: {
    flex: 1,
  },
  callBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
  },
  callBannerText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '500',
  },
  joinButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
  },
  joinButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  documentIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: 'rgba(129, 0, 209, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickStickersRowWrapper: {
    paddingVertical: 12,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    width: '100%',
  },
  quickStickersContainerEvenly: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    width: '100%',
  },
  quickStickerCard: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickStickerLottie: {
    width: 60,
    height: 60,
  },
});
