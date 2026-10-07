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
  Text as RNText,
  Image,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  BackHandler,
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
  StatusBar,
  LayoutChangeEvent,
} from 'react-native';

const SafeText = (props: any) => {
  const children = React.Children.map(props.children, child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return child;
  });
  return <RNText {...props}>{children}</RNText>;
};
const Text = SafeText;
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
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { spacing, borderRadius, fontSize, colors } from '../../utils/theme';
import { Message } from '../../types';
import { pinNavBarColor } from '../../utils/navBarPin';
import { useAuth } from '../../context/AuthContext';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { NativeModules } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import audioRecorder from '../../modules/AudioRecorder';
import AudioPlayer from '../../components/AudioPlayer';
import { pick, types, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import fcmService from '../../services/fcm';
import { MessageCipher, MediaCipher, MediaE2EEMetadata } from '../../services/e2ee';
import notifee from '@notifee/react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { StatusService } from '../../services/StatusService';
import RichTextInput from '../../components/RichTextInput';
import ChatInputArea from '../../components/ChatInputArea';

import FullScreenMediaViewer from '../../components/FullScreenMediaViewer';
import { ForwardMessageModal } from '../../components/ForwardMessageModal';
import { DeleteConfirmationModal } from '../../components/DeleteConfirmationModal';
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
import DoubleTapHeartOverlay, { DoubleTapHeartOverlayRef } from '../../components/DoubleTapHeartOverlay';
import LottieStickerMessage from '../../components/LottieStickerMessage';
import LottieView from 'lottie-react-native';
import { BUILT_IN_STICKER_PACKS, Sticker } from '../../stickers/stickerPacks';
import {
  isTriviaChallengeMessage,
  isScoreSubmissionMessage,
  syncChallengeFromMessage,
} from '../../services/TriviaChallengeService';
import {
  ChatTheme,
  CHAT_THEME_PRESETS,
  ChatThemeService,
} from '../../services/theme/ChatThemeService';
import { ChatThemeModal } from '../../components/chat/ChatThemeModal';

const NEW_CHAT_STICKERS = [
  {
    id: 'smile',
    name: 'Smile ☺️',
    emoji: '☺️',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60a/lottie.json',
  },
  {
    id: 'pray',
    name: 'Pray 🙏',
    emoji: '🙏',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f64f/lottie.json',
  },
  {
    id: 'wave',
    name: 'Hi 👋',
    emoji: '👋',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44b/lottie.json',
  },
  {
    id: 'starstruck',
    name: 'Star-Struck 🤩',
    emoji: '🤩',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f929/lottie.json',
  },
  {
    id: 'angel',
    name: 'Halo 😇',
    emoji: '😇',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f607/lottie.json',
  },
  {
    id: 'partypop',
    name: 'Party! 🎉',
    emoji: '🎉',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/lottie.json',
  },
  {
    id: 'redheart',
    name: 'Heart ❤️',
    emoji: '❤️',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2764_fe0f/lottie.json',
  },
  {
    id: 'lovehearts',
    name: 'Hearts 🥰',
    emoji: '🥰',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f970/lottie.json',
  },
  {
    id: 'party',
    name: 'Celebrate 🥳',
    emoji: '🥳',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f973/lottie.json',
  },
  {
    id: 'fire2',
    name: 'Fire 🔥',
    emoji: '🔥',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/lottie.json',
  },
  {
    id: 'cool',
    name: 'Cool 😎',
    emoji: '😎',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/lottie.json',
  },
  {
    id: 'thumbsup',
    name: 'Like 👍',
    emoji: '👍',
    url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/lottie.json',
  },
];

const FRESH_CHAT_STICKERS = NEW_CHAT_STICKERS;



const SENT_COLOR = '#B0B0B0';
const BASE_URL = API_BASE_URL.replace('/api', '');

const MessageAvatar = ({ uri, sticker, sName, userId, style, navigation, conversationId }: any) => {
  const handleAvatarPress = () => {
    navigation.navigate('Profile', { user: { id: userId, display_name: sName }, conversationId });
  };

  return (
    <AvatarWithFallback
      uri={uri}
      sticker={sticker}
      displayName={sName}
      style={style}
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
const EMOJI_MATCH_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?)*/gu;

const isOnlyEmojis = (text: string | undefined | null): { isOnly: boolean; count: number } => {
  if (!text || typeof text !== 'string') return { isOnly: false, count: 0 };
  const trimmed = text.trim();
  const nonWs = trimmed.replace(/\s+/g, '');
  if (!nonWs) return { isOnly: false, count: 0 };
  const remaining = nonWs.replace(EMOJI_MATCH_REGEX, '');
  if (remaining.length === 0) {
    const m = nonWs.match(EMOJI_MATCH_REGEX);
    const count = m ? m.length : 0;
    if (count > 0 && count <= 6) {
      return { isOnly: true, count };
    }
  }
  return { isOnly: false, count: 0 };
};

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

const renderReplyThumbnail = (reply: Message, messagesList?: Message[], themePrimary: string = '#0084FF') => {
  const replyType = getReplyMessageType(reply, messagesList);
  const mediaUrl = getReplyMediaUrl(reply, messagesList);

  if (replyType === 'image' && mediaUrl) {
    return (
      <Image
        source={{ uri: mediaUrl }}
        style={{ width: '100%', height: '100%', borderRadius: 4 }}
        resizeMode="cover"
      />
    );
  }

  if (replyType === 'video') {
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center', borderRadius: 4 }}>
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
    else if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(fileExt || '')) iconName = 'musical-notes-outline';

    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center', borderRadius: 4 }}>
        <Icon name={iconName} size={18} color={themePrimary} />
      </View>
    );
  }

  return null;
};

const getFileIconColor = (fileExt: string, defaultColor: string = '#0084FF') => {
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
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'ogg':
    case 'flac':
    case 'opus':
      return '#9C27B0'; // Purple for Audio
    default:
      return defaultColor;
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

const isLocalUriUsable = (uri?: string) => {
  if (!uri) return false;
  // content:// URIs are transient Android ContentProvider permissions from keyboards / external pickers.
  // When the app is closed/reopened, content:// permissions from another package become invalid.
  if (uri.startsWith('content://')) return false;
  return uri.startsWith('file://') || uri.startsWith('/');
};

const getMediaExtension = (mimeType?: string, fileName?: string): string => {
  if (mimeType?.includes('gif') || fileName?.toLowerCase().endsWith('.gif')) return 'gif';
  if (mimeType?.includes('webp') || fileName?.toLowerCase().endsWith('.webp')) return 'webp';
  if (mimeType?.includes('png') || fileName?.toLowerCase().endsWith('.png')) return 'png';
  if (mimeType?.includes('mp4') || fileName?.toLowerCase().endsWith('.mp4')) return 'mp4';
  return 'jpg';
};

const calculateImageDimensions = (width: number, height: number, isSticker: boolean, isGif: boolean = false) => {
  // Tier 2 (medium/clear): GIFs — noticeably larger than stickers so animations & details are clear
  if (isGif) {
    const MAX_GIF_W = 230;
    const MAX_GIF_H = 300;
    if (!width || !height || width <= 0 || height <= 0) {
      return { width: 210, height: 210 };
    }
    const aspectRatio = width / height;
    let dW = MAX_GIF_W;
    let dH = dW / aspectRatio;
    if (dH > MAX_GIF_H) {
      dH = MAX_GIF_H;
      dW = dH * aspectRatio;
    }
    return { width: Math.round(dW), height: Math.round(dH) };
  }

  // Tier 3 (small): Stickers — compact size for emotion/reaction stickers
  if (isSticker) {
    const MAX_STICKER = 100;
    if (!width || !height || width <= 0 || height <= 0) {
      return { width: MAX_STICKER, height: MAX_STICKER };
    }
    const aspectRatio = width / height;
    let dW = MAX_STICKER;
    let dH = MAX_STICKER;
    if (aspectRatio > 1) {
      dW = MAX_STICKER;
      dH = Math.round(MAX_STICKER / aspectRatio);
    } else {
      dH = MAX_STICKER;
      dW = Math.round(MAX_STICKER * aspectRatio);
    }
    return { width: Math.max(55, dW), height: Math.max(55, dH) };
  }

  // Tier 1 (largest): Raw photos and videos
  const MAX_W = 260;
  const MAX_H = 340;

  if (!width || !height || width <= 0 || height <= 0) {
    return { width: 240, height: 240 };
  }

  const aspectRatio = width / height;
  let dW = MAX_W;
  let dH = dW / aspectRatio;
  if (dH > MAX_H) {
    dH = MAX_H;
    dW = dH * aspectRatio;
  }

  return { width: Math.round(dW), height: Math.round(dH) };
};

const ChatImage = React.memo(({ url, isMe, onLongPress, onPress, timeOverlay, isSticker, isGif, origWidth, origHeight, localUri, mediaE2ee, isDark }: any) => {
  const effectiveIsGif = Boolean(isGif);
  const effectiveIsSticker = Boolean(isSticker) && !effectiveIsGif;

  const usableLocalUri = isLocalUriUsable(localUri) ? localUri : null;

  // Detect upfront if the file is encrypted but we have no key (and no local copy)
  const isEncUrl = !usableLocalUri && url && (url.includes('.enc') || url.includes('/raw/upload/'));
  const hasNoKey = !mediaE2ee || !mediaE2ee.media_key;

  const [decryptionFailed, setDecryptionFailed] = useState(() => !!(isEncUrl && hasNoKey));

  const [resolvedUri, setResolvedUri] = useState<string>(() => {
    if (usableLocalUri) return usableLocalUri;
    if (mediaE2ee?.file_hash) {
      const ext = getMediaExtension(mediaE2ee.mime_type, mediaE2ee.file_name);
      const syncLocal = MediaCipher.getDecryptedLocalUriSync(mediaE2ee.file_hash, ext);
      if (syncLocal) return syncLocal;
    }
    return url;
  });

  const [dimensions, setDimensions] = useState<{ width: number; height: number }>(() => {
    const targetW = origWidth || mediaE2ee?.width;
    const targetH = origHeight || mediaE2ee?.height;
    if (targetW && targetH) {
      const resolved = calculateImageDimensions(targetW, targetH, effectiveIsSticker, effectiveIsGif);
      if (url) imageDimensionsCache.set(url, { width: targetW, height: targetH });
      return resolved;
    }
    const cachedEntry = (url && imageDimensionsCache.get(url)) || (usableLocalUri && imageDimensionsCache.get(usableLocalUri));
    if (cachedEntry) {
      return calculateImageDimensions(cachedEntry.width, cachedEntry.height, effectiveIsSticker, effectiveIsGif);
    }
    return effectiveIsGif ? { width: 210, height: 210 } : (effectiveIsSticker ? { width: 100, height: 100 } : { width: 240, height: 240 });
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isActive = true;

    if (usableLocalUri) {
      setResolvedUri(prev => prev === usableLocalUri ? prev : usableLocalUri);
      setLoading(false);
      return;
    }

    // If the URL is an encrypted .enc file but we have no decryption key,
    // mark as failed immediately instead of trying to load binary data as an image
    const isEncrypted = url && (url.includes('.enc') || url.includes('/raw/upload/'));
    if (isEncrypted && (!mediaE2ee || !mediaE2ee.media_key)) {
      setDecryptionFailed(true);
      setLoading(false);
      return;
    }

    // Handle Media E2EE Decryption if encrypted
    if (mediaE2ee && mediaE2ee.media_key && url) {
      const ext = getMediaExtension(mediaE2ee.mime_type, mediaE2ee.file_name);
      MediaCipher.getDecryptedLocalUriIfExists(mediaE2ee.file_hash, ext).then(cachedUri => {
        if (!isActive) return;
        if (cachedUri) {
          setResolvedUri(prev => prev === cachedUri ? prev : cachedUri);
          setLoading(false);
        } else {
          MediaCipher.decryptMediaFile(url, mediaE2ee.media_key, mediaE2ee.nonce, mediaE2ee.file_hash, ext)
            .then(decryptedPath => {
              if (!isActive) return;
              setResolvedUri(prev => prev === decryptedPath ? prev : decryptedPath);
              setLoading(false);
            })
            .catch(err => {
              console.warn('[ChatImage] Decryption or download failed:', err);
              if (isActive) {
                setLoading(false);
                setDecryptionFailed(true);
              }
            });
        }
      });
      return;
    }

    if (url) {
      const targetUri = usableLocalUri || url;
      setResolvedUri(prev => prev === targetUri ? prev : targetUri);
      const cachedEntry = imageDimensionsCache.get(url) || (usableLocalUri && imageDimensionsCache.get(usableLocalUri));
      if (cachedEntry) {
        setDimensions(calculateImageDimensions(cachedEntry.width, cachedEntry.height, !!isSticker, !!isGif));
        return;
      }
      if (origWidth && origHeight) {
        const resolved = calculateImageDimensions(origWidth, origHeight, !!isSticker, !!isGif);
        imageDimensionsCache.set(url, { width: origWidth, height: origHeight });
        setDimensions(resolved);
        return;
      }
    }
    return () => {
      isActive = false;
    };
  }, [url, isSticker, isGif, origWidth, origHeight, usableLocalUri, mediaE2ee?.file_hash, mediaE2ee?.media_key]);

  if (decryptionFailed) {
    return (
      <View
        style={{
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          width: dimensions.width,
          height: dimensions.height,
          backgroundColor: isDark ? '#2C2C2E' : '#EAEAEA',
          borderRadius: 14,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 12,
        }}
      >
        <Icon name="image-outline" size={28} color={isDark ? '#8E8E93' : '#888'} />
        <Text style={{ fontSize: 11, color: isDark ? '#8E8E93' : '#888', marginTop: 4, textAlign: 'center' }}>
          Media unavailable
        </Text>
        {timeOverlay}
      </View>
    );
  }

  return (
    <TouchableOpacity 
      style={{ 
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        width: dimensions.width,
        height: dimensions.height,
        backgroundColor: 'transparent',
        borderRadius: isSticker ? 0 : (isGif ? 8 : 14),
        overflow: 'hidden',
        padding: 0,
        marginTop: 0,
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.9}
    >
      <FastImage 
        source={{ uri: resolvedUri }} 
        style={{ 
          height: dimensions.height, 
          width: dimensions.width,
          borderRadius: isSticker ? 0 : (isGif ? 8 : 14),
        }} 
        resizeMode={FastImage.resizeMode.contain}
        onError={() => {
          if (resolvedUri !== url && url) {
            setResolvedUri(url);
          } else {
            setLoading(false);
          }
        }}
        onLoad={(e: any) => {
          const { width: w, height: h } = e?.nativeEvent || {};
          if (w && h) {
            if (url) imageDimensionsCache.set(url, { width: w, height: h });
            if (localUri) imageDimensionsCache.set(localUri, { width: w, height: h });
            const resolved = calculateImageDimensions(w, h, effectiveIsSticker, effectiveIsGif);
            setDimensions(prev => {
              if (prev.width === resolved.width && prev.height === resolved.height) return prev;
              return resolved;
            });
            saveDimensionsToStorage();
          }
          setLoading(false);
        }}
        onLoadEnd={() => setLoading(false)}
      />
      {!isSticker && timeOverlay}
    </TouchableOpacity>
  );
}, (prev, next) => {
  return (
    prev.url === next.url &&
    prev.localUri === next.localUri &&
    prev.isMe === next.isMe &&
    prev.isSticker === next.isSticker &&
    prev.isGif === next.isGif &&
    prev.origWidth === next.origWidth &&
    prev.origHeight === next.origHeight &&
    prev.mediaE2ee?.file_hash === next.mediaE2ee?.file_hash &&
    prev.mediaE2ee?.media_key === next.mediaE2ee?.media_key
  );
});

let uniqueCounter = 0;

const KeyboardWrapperView = Platform.OS === 'android' ? View : KeyboardAvoidingView;
const keyboardWrapperProps = Platform.OS === 'android' ? {} : { behavior: 'padding' as const, keyboardVerticalOffset: 90 };

const ChatRoomScreenComponent: React.FC<any> = ({ navigation, route }) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);

  const insets = useSafeAreaInsets();
  const { conversationId, name } = route.params;

  const [chatTheme, setChatTheme] = useState<ChatTheme>(() => {
    return route.params?.chatTheme || ChatThemeService.getCachedTheme(conversationId);
  });
  const [showThemeModal, setShowThemeModal] = useState(false);

  useEffect(() => {
    let active = true;
    InteractionManager.runAfterInteractions(() => {
      if (!active) return;
      ChatThemeService.getChatTheme(conversationId).then(t => {
        if (t && active) setChatTheme(t);
      }).catch(() => {});
    });
    return () => { active = false; };
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      if ((global as any).activeMusicRoomCode) return;
      const isCustomTheme = Boolean(chatTheme?.id && chatTheme.id !== 'default');
      pinNavBarColor('#00000000', isCustomTheme ? true : isDark);
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setFitsSystemWindows(false);
        NativeModules.SystemBar.setStatusBarColor('#00000000', isCustomTheme ? false : !isDark);
        NativeModules.SystemBar.setNavigationBarColor('#00000000', isCustomTheme ? true : isDark);
      }
    }, [isDark, chatTheme?.id])
  );
  const { user: currentUser } = useAuth();

  // Dismiss notifications for this conversation on mount and when conversationId changes
  useEffect(() => {
    fcmService.setActiveConversation(String(conversationId));

    let isSubscribed = true;
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        if (!isSubscribed) return;
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
    });

    return () => {
      isSubscribed = false;
      task?.cancel?.();
      fcmService.setActiveConversation(null);
    };
  }, [conversationId]);

  // Initial cached messages from SQLite (queried once with LIMIT 20 for instant 0ms mount)
  const initialCached = React.useMemo(() => {
    if (route.params?.cleared || route.params?.deleted) return [];
    try {
      return localDatabase.getRecentMessages(Number(conversationId), 20) || [];
    } catch {
      return [];
    }
  }, [conversationId, route.params?.cleared, route.params?.deleted]);

  // inverted FlatList shows last item first (bottom) without any scrollToEnd
  const [messages, setMessages] = useState<Message[]>(() => {
    return initialCached.length > 0 ? [...initialCached].reverse() : [];
  });
  const [conversation, setConversation] = useState<any>(null); 
  const [liveReadTimes, setLiveReadTimes] = useState<{ [userId: number]: string }>({});
  const [selectedReceiptUser, setSelectedReceiptUser] = useState<{ id: number; name: string; seenTime: string } | null>(null);
  const [isGroup, setIsGroup] = useState<boolean>(!!route.params?.isGroup); 
  const [groupDescription, setGroupDescription] = useState(''); 
  const [activeGroupCall, setActiveGroupCall] = useState<any>(null); 
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasLoadedInitialMessages, setHasLoadedInitialMessages] = useState<boolean>(() => {
    return initialCached.length > 0;
  });
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [oldestMessageId, setOldestMessageId] = useState<number | null>(() => {
    return initialCached.length > 0 ? (initialCached[0].id || null) : null;
  });
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [otherUser, setOtherUser] = useState<OtherUser | null>(route.params?.otherUser || null);
  const [friendStatus, setFriendStatus] = useState<string>(() => {
    if (route.params?.isGroup) return 'friends';
    if (route.params?.otherUser?.friend_status) return route.params.otherUser.friend_status;
    if (route.params?.messageRequestStatus === 'pending') return 'none';
    return 'friends'; // Default to normal chat unless explicitly pending
  });
  const [headerHasStatus, setHeaderHasStatus] = useState(false);
  const [headerStatuses, setHeaderStatuses] = useState<any[]>([]);

  useEffect(() => {
    if (isGroup || !otherUser?.id) return;
    let active = true;
    let task: any = null;
    task = InteractionManager.runAfterInteractions(() => {
      StatusService.getStatuses()
        .then((statuses: any[]) => {
          if (!active) return;
          // Use Number() to safely compare regardless of string/number type from API
          const userStatuses = statuses.filter(
            (st: any) => Number(st.user_id) === Number(otherUser.id)
          );
          setHeaderHasStatus(userStatuses.length > 0);
          setHeaderStatuses(userStatuses);
        })
        .catch(() => {/* silent */});
    });
    return () => {
      active = false;
      task?.cancel?.();
    };
  }, [isGroup, otherUser?.id]);

  const fetchDynamicFriendStatus = useCallback(async (targetId: number) => {
    if (!targetId || targetId === currentUser?.id) return;
    try {
      const friendsList = await chatAPI.getFriends();
      const isFriend = Array.isArray(friendsList) && friendsList.some((f: any) => Number(f.id) === Number(targetId));
      if (isFriend) {
        setFriendStatus('friends');
        return;
      }
      const reqs = await chatAPI.getFriendRequests();
      const req = Array.isArray(reqs) && reqs.find((r: any) =>
        Number(r.sender?.id || r.from_user?.id) === Number(targetId) ||
        Number(r.receiver?.id || r.to_user?.id) === Number(targetId)
      );
      if (req) {
        const isOutgoing = Number(req.sender?.id || req.from_user?.id) === Number(currentUser?.id) || req.direction === 'outgoing';
        setFriendStatus(isOutgoing ? 'pending' : 'received_pending');
      } else {
        setFriendStatus('none');
      }
    } catch (err) {
      console.warn('Error loading friend status dynamically in chat:', err);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (isGroup) return;
    const targetId = otherUser?.id || route.params?.otherUser?.id;
    if (targetId) {
      const task = InteractionManager.runAfterInteractions(() => {
        fetchDynamicFriendStatus(Number(targetId));
      });
      return () => {
        task?.cancel?.();
      };
    }
  }, [isGroup, otherUser?.id, route.params?.otherUser?.id, fetchDynamicFriendStatus]);

  const [messageRequestStatus, setMessageRequestStatus] = useState<string | null>(
    route.params?.messageRequestStatus || null
  ); // null | 'pending' | 'accepted' | 'rejected'
  const [messageRequestSenderId, setMessageRequestSenderId] = useState<number | null>(
    route.params?.messageRequestSenderId || null
  );
  const [isUserBlocked, setIsUserBlocked] = useState(false); // Whether current user blocked other
  const [amIBlocked, setAmIBlocked] = useState(false); // Whether other user blocked current user
  const [lastSeenPrivacy, setLastSeenPrivacy] = useState<'everyone' | 'nobody'>('everyone');
  const [chatTitle, setChatTitle] = useState(name || 'Chat');
  const [shouldSkipLoad, setShouldSkipLoad] = useState(false); // Skip loading messages
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const scrollToBottomAnim = useRef(new Animated.Value(0)).current; // Native animated scroll to bottom button
  const isScrollButtonVisibleRef = useRef(false);
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

  // ── Multi-select, Delete & Forward State ──────────────────────────────
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const selectedMessageIdsRef = useRef<number[]>([]);
  selectedMessageIdsRef.current = selectedMessageIds;
  const isSelectionMode = selectedMessageIds.length > 0;

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [messagesToDelete, setMessagesToDelete] = useState<Message[]>([]);
  const [messagesToForward, setMessagesToForward] = useState<Message[]>([]);
  const [selectedGroupMessages, setSelectedGroupMessages] = useState<Message[]>([]);
  const [highlightMessageId, setHighlightMessageId] = useState<number | null>(null); // Message to highlight
  const [searchMode, setSearchMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]); // Indices of matches
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);

  // Double-tap reaction animation state
  const [mediaErrorIds, setMediaErrorIds] = useState<number[]>([]);
  const doubleTapHeartRef = useRef<DoubleTapHeartOverlayRef>(null);
  const lastTapTimeRef = useRef<number>(0);
  const doubleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const safeBottomPadding = insets.bottom + spacing.md;
  const { height: keyboardHeight, progress } = useReanimatedKeyboardAnimation();
  const stickerSpacerHeight = useSharedValue(0);

  // Lifts the entire content area (messages + input bar) up together with the keyboard or sticker drawer.
  // Messages and input always move as one unit — no layout recalculation, just a GPU transform.
  // kbHeight from KeyboardProvider includes the nav bar area, so subtract insets.bottom
  // to avoid double-counting with the container's paddingBottom.
  const contentLiftStyle = useAnimatedStyle(() => {
    const kbHeight = Math.abs(keyboardHeight.value);
    const lift = kbHeight > 0 ? Math.max(0, kbHeight - insets.bottom) : 0;
    const finalLift = Math.max(lift, stickerSpacerHeight.value);
    return {
      transform: [{ translateY: -finalLift }],
    };
  });

  const stickerPickerVisibleRef = useRef(false);
  stickerPickerVisibleRef.current = stickerPickerVisible;

  useEffect(() => {
    if (stickerPickerVisible) {
      Keyboard.dismiss();
      stickerSpacerHeight.value = withTiming(286, {
        duration: 250,
        easing: Easing.bezier(0.0, 0.0, 0.2, 1),
      });
    } else {
      stickerSpacerHeight.value = withTiming(0, {
        duration: 220,
        easing: Easing.bezier(0.4, 0.0, 1, 1),
      });
    }
  }, [stickerPickerVisible, stickerSpacerHeight]);

  const isFocusedRef = useRef(true);
  const isNavigatingBack = useRef(false);

  const handleGoBack = useCallback(() => {
    if (isNavigatingBack.current) return;
    isNavigatingBack.current = true;

    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs', { screen: 'Chats' });
    }
    setTimeout(() => Keyboard.dismiss(), 50);
  }, [navigation]);

  useEffect(() => {
    const onBackPress = () => {
      if (!isFocusedRef.current) return false;
      if (selectedMessageIdsRef.current.length > 0) {
        setSelectedMessageIds([]);
        return true;
      }
      if (stickerPickerVisibleRef.current) {
        setStickerPickerVisible(false);
        return true;
      }
      handleGoBack();
      return true;
    };
    const subBack = BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => {
      subBack.remove();
    };
  }, [handleGoBack]);
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

    // Defer all network calls and websocket connection until AFTER the slide-in animation completes.
    // The SQLite cache (initialCached) already displayed instantly — network sync
    // is a background refresh that should not compete with the screen transition.
    InteractionManager.runAfterInteractions(() => {
      connectWebSocket();
      loadConversationDetails();
      if (!isCleared) {
        loadMessages();
      }
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
      isFocusedRef.current = true;
      isNavigatingBack.current = false;
      InteractionManager.runAfterInteractions(() => {
        // Add a slight delay to ensure the native slide transition is 100% complete
        // before we trigger the `conversation_read` event which re-renders the heavy ChatListScreen
        setTimeout(() => {
          if (!chatIsActiveRef.current) return;
          const unread = messagesRef.current.some(
            m => !m?.is_read && m?.sender?.id !== currentUser?.id
          );
          if (unread && conversationId) {
            chatAPI.markAsRead(Number(conversationId)).then(() => {
              DeviceEventEmitter.emit('conversation_read', { conversationId: Number(conversationId) });
            }).catch(() => {});
          }
        }, 300);
      });
    });

    const blurSub = navigation.addListener('blur', () => {
      chatIsActiveRef.current = false;
      isFocusedRef.current = false;
    });

    return () => {
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
          setOtherUser(prev => ({
            ...prev,
            ...other.user,
            last_seen: other.user.last_seen !== undefined ? other.user.last_seen : prev?.last_seen,
          }));
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

    try {
      const data = await chatAPI.getMessages(conversationId);
      const rawArr: Message[] = Array.isArray(data) ? data : data?.results ?? [];
      const arr = await MessageCipher.processMessageList(currentUser?.id || 0, rawArr);

      if (arr.length > 0) {
        setOldestMessageId(arr[0].id);
        setHasMoreMessages(arr.length >= 50);
        // Cache fresh decrypted messages in SQLite
        localDatabase.saveMessages(arr, conversationId);

        // Sync incoming trivia challenges or score submissions
        arr.forEach(m => {
          if (m?.content && (isTriviaChallengeMessage(m) || isScoreSubmissionMessage(m))) {
            syncChallengeFromMessage(m.content, conversationId);
          }
        });
      } else {
        // If server returns empty list (chat cleared or DB wiped), wipe stale local cache immediately
        setOldestMessageId(null);
        setHasMoreMessages(false);
        localDatabase.clearConversationMessages(conversationId);
        setMessages([]);
        return;
      }

      const reversedNew = [...arr].reverse();
      const current = messagesRef.current;
      
      // Compare the visible subset currently loaded
      const sliceLength = Math.min(current.length, reversedNew.length);
      const isSliceIdentical =
        sliceLength > 0 &&
        current.slice(0, sliceLength).every(
          (m, idx) =>
            m.id === reversedNew[idx]?.id &&
            m.content === reversedNew[idx]?.content &&
            m.status === reversedNew[idx]?.status &&
            JSON.stringify(m.reactions || {}) === JSON.stringify(reversedNew[idx]?.reactions || {})
        );

      // Only update state if current list was empty or if the latest messages actually changed
      if (!isSliceIdentical) {
        setMessages(reversedNew);
      }

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
      setHasLoadedInitialMessages(true);
    }
  };

  // Load older messages when user scrolls to bottom of inverted list (= top visually)
  const loadOlderMessages = async () => {
    if (isLoadingOlder || !hasMoreMessages || !oldestMessageId || !hasLoadedInitialMessages || messages.length < 15) return;
    setIsLoadingOlder(true);
    try {
      // 1. Instant SQLite cache check for older messages
      const cachedOlder = localDatabase.getMessagesBefore(conversationId, oldestMessageId, 30);
      if (cachedOlder && cachedOlder.length > 0) {
        setOldestMessageId(cachedOlder[0].id);
        setMessages(prev => [
          ...(Array.isArray(prev) ? prev : []),
          ...cachedOlder.reverse(),
        ]);
      }

      // 2. Fetch older messages from server in background
      const token = await AsyncStorage.getItem('access_token');
      const url = `${BASE_URL}/api/chat/conversations/${conversationId}/messages/?limit=50&before_id=${oldestMessageId}`;
      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        const rawOlder: Message[] = Array.isArray(data)
          ? data
          : data.results ?? [];
        const older = await MessageCipher.processMessageList(currentUser?.id || 0, rawOlder);
        if (older.length > 0) {
          setOldestMessageId(older[0].id);
          setHasMoreMessages(older.length >= 50);
          // Cache older decrypted messages
          localDatabase.saveMessages(older, conversationId);
          // Append to end of reversed array (= top visually in inverted list) if not already added
          setMessages(prev => {
            const currentIds = new Set(prev.map(m => m.id));
            const newToAdd = older.filter(m => !currentIds.has(m.id)).reverse();
            if (newToAdd.length === 0) return prev;
            return [...prev, ...newToAdd];
          });
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

  const handleWebSocketMessage = async (wsMsg: WebSocketMessage) => {
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
        
        if (isOwn) {
          const senderName = currentUser?.display_name || currentUser?.email || '';
          const optMsg = messagesRef.current.find(
            m => (m.id > 1000000000 || m.status === 'sending') && m.sender?.id === currentUser?.id
          );
          const localId = optMsg?.local_id || localDatabase.findSendingMessage(optMsg?.content || '', senderName) || localDatabase.findFirstSendingMessage(senderName);
          if (localId) {
            localDatabase.updateMessageServerId(localId, wsMsg.data.id, 'sent');
          }

          setMessages(prev => {
            const arr = Array.isArray(prev) ? prev : [];
            const idx = arr.findIndex(
              m =>
                (m.id > 1000000000 || m.status === 'sending') &&
                m.sender.id === currentUser?.id,
            );
            if (idx >= 0) {
              const next = [...arr];
              next[idx] = { ...arr[idx], id: wsMsg.data.id, delivered_at: wsMsg.data.delivered_at, status: 'sent' };
              return next;
            }
            return arr;
          });
          // Do NOT call loadConversationDetails() here — it triggers 3 network calls
          // (getConversation, checkBlockStatus, checkIfAmIBlocked) and causes a 1-2s JS
          // thread stall that freezes the input every time you send a message.
          break;
        }

        // Recipient side: Decrypt through MessageCipher (Double Ratchet + Media E2EE parser)
        const processedMsg = await MessageCipher.processIncomingMessage(currentUser?.id || 0, wsMsg.data);

        // Sync incoming trivia challenges or score submissions
        if (wsMsg.data?.content && (isTriviaChallengeMessage(wsMsg.data) || isScoreSubmissionMessage(wsMsg.data))) {
          syncChallengeFromMessage(wsMsg.data.content, conversationId);
        }

        const nm: Message = {
          ...processedMsg,
          reactions: wsMsg.data.reactions ?? {},
          delivered_at: wsMsg.data.delivered_at || new Date().toISOString(),
        };

        // Cache the incoming message locally in SQLite
        localDatabase.saveMessage({ ...nm, conversation: conversationId }, nm.id.toString(), 'sent');

        setMessages(prev => {
          const arr = Array.isArray(prev) ? prev : [];
          if (arr.some(m => m.id === nm.id)) return arr;
          return [nm, ...arr];
        });
        if (chatIsActiveRef.current) {
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
      case 'read_receipt': {
        const readerId = wsMsg.data.user_id;
        const msgIds = wsMsg.data.message_ids || [];
        if (readerId && msgIds.length > 0) {
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
            if (wsMsg.data.message_ids?.includes(m.id) && m.sender.id === currentUser?.id) {
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
      }
      case 'reaction':
        setMessages(prev => {
          const updated = (Array.isArray(prev) ? prev : []).map(m => {
            if (m.id === wsMsg.data?.message_id) {
              const reactions = { ...(m.reactions || {}) };
              const emoji = wsMsg.data.emoji;
              const userId = String(wsMsg.data.user_id);
              
              if (!emoji || emoji.trim() === '') {
                delete reactions[userId];
              } else {
                reactions[userId] = emoji;
              }
              const updatedMsg = { ...m, reactions };
              const localId = m.local_id || m.id.toString();
              localDatabase.saveMessage({ ...updatedMsg, conversation: conversationId }, localId, 'read');
              return updatedMsg;
            }
            return m;
          });
          return updated;
        });
        break;
      case 'message_edit': {
        const { message_id, content, edited_at } = wsMsg.data;
        const target = messagesRef.current.find(m => m.id === message_id);
        const localId = target?.local_id || message_id.toString();
        localDatabase.updateMessageText(localId, content, edited_at);
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            m.id === message_id ? { ...m, content, edited_at } : m,
          ),
        );
        break;
      }
      case 'message_delete': {
        const { message_id } = wsMsg.data;
        const target = messagesRef.current.find(m => m.id === message_id);
        const localId = target?.local_id || message_id.toString();
        localDatabase.softDeleteMessage(localId);
        setMessages(prev =>
          (Array.isArray(prev) ? prev : []).map(m =>
            m.id === message_id ? { ...m, is_deleted: true, content: 'The message was removed' } : m,
          ),
        );
        break;
      }
      case 'message_request_status': {
        const { status: reqStatus, sender_id: reqSenderId } = wsMsg.data;
        setMessageRequestStatus(reqStatus);
        setMessageRequestSenderId(reqSenderId);
        if (reqStatus === 'accepted') {
          setFriendStatus('friends');
        }
        break;
      }
      case 'message_request_created': {
        const { status: reqStatus, sender_id: reqSenderId } = wsMsg.data;
        setMessageRequestStatus(reqStatus);
        setMessageRequestSenderId(reqSenderId);
        break;
      }
      case 'friend_request_update': {
        const { status: fStatus } = wsMsg.data;
        if (fStatus === 'accepted') {
          setFriendStatus('friends');
          setMessageRequestStatus('accepted');
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

  const sendMessage = async (content?: string, sendStartTime?: number) => {
    const t0 = sendStartTime || performance.now();
    const text = (content ?? inputTextRef.current ?? inputText).trim();
    if (!text) return;

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
        inputTextRef.current = '';
        setInputText(''); 
        clearInputRef.current?.();
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

    inputTextRef.current = '';
    // Only call clearInputRef when content came from inputTextRef (no prior clear happened).
    // When content is passed as an argument, ChatInputArea's handleSend already cleared.
    if (!content) {
      clearInputRef.current?.();
    }
    setHighlightMessageId(null); // Clear any active highlight when sending a new message

    // ── Optimistic Message (Sent immediately to UI at 0ms) ──
    uniqueCounter++;
    const localId = `txt_${Date.now()}_${uniqueCounter}`;
    const tempId = Date.now() + uniqueCounter + 1000000000;

    const currentReply = replyToMessage;
    if (replyToMessage) {
      setReplyToMessage(null);
    }

    const optimisticMsg: Message = {
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
      content: text,
      message_type: 'text',
      media_file: null,
      is_read: false,
      delivered_at: null,
      created_at: new Date().toISOString(),
      reactions: {},
      reply_to: currentReply,
      status: 'sending',
    };

    // 1. Synchronously render in UI (0ms instant!)
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    if (currentScrollOffset.current > 10) {
      requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));
    }
    const uiRenderTime = (performance.now() - t0).toFixed(2);
    console.log(`🚀 [PERF: SEND] Optimistic message rendered on UI in: ${uiRenderTime}ms`);

    // 2. Persist to offline SQLite & Background E2EE encryption (deferred via setTimeout so UI thread never hitches)
    setTimeout(async () => {
      try {
        localDatabase.saveMessage(optimisticMsg, localId, 'sending');
      } catch (dbErr) {
        console.warn('Offline message save error:', dbErr);
      }

      let payloadToSend = text;
      const recipientId = otherUser?.id || (conversation?.other_user as any)?.id;
      if (!isGroup && recipientId) {
        try {
          const e2eeStart = performance.now();
          payloadToSend = await MessageCipher.encrypt(recipientId, text);
          const e2eeTime = (performance.now() - e2eeStart).toFixed(2);
          console.log(`🔒 [PERF: E2EE] Double Ratchet encryption completed in: ${e2eeTime}ms`);
        } catch (encryptErr) {
          console.warn('⚠️ E2EE Direct message encryption failed, falling back to plaintext:', encryptErr);
          payloadToSend = text;
        }
      }

      const payload: any = {
        content: payloadToSend,
        message_type: 'text',
      };
      if (currentReply) {
        payload.reply_to_id = currentReply.id;
      }

      try {
        if (websocketService.getConnectionState()) {
          websocketService.sendMessage(payload);
          const totalWsTime = (performance.now() - t0).toFixed(2);
          console.log(`📡 [PERF: NETWORK] Dispatched over WebSocket in: ${totalWsTime}ms`);
        } else {
          try {
            const token = await AsyncStorage.getItem('access_token');
            const res = await fetch(
              `${BASE_URL}/api/chat/conversations/${conversationId}/messages/`,
              {
                method: 'POST',
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
              },
            );
            if (res.ok) {
              const nm = await res.json();
              setMessages(prev =>
                prev.map(m =>
                  m.local_id === localId || m.id === tempId
                    ? { ...nm, local_id: localId, content: text, status: 'sent' }
                    : m,
                ),
              );
              localDatabase.saveMessage({ ...nm, content: text }, localId, 'sent');
              if (nm.is_message_request) {
                setMessageRequestStatus('pending');
                setMessageRequestSenderId(currentUser!.id);
              }
            } else {
              setMessages(prev =>
                prev.map(m =>
                  m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
                ),
              );
            }
          } catch {
            setMessages(prev =>
              prev.map(m =>
                m.local_id === localId || m.id === tempId ? { ...m, status: 'failed' } : m,
              ),
            );
          }
        }
      } catch (err) {
        console.error('Error sending message:', err);
      }
    }, 0);
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

      const targetMsg = messagesRef.current.find(m => m.id === messageId);
      const currentReactions = targetMsg?.reactions || {};
      const hasReaction = currentReactions[currentUserId] === emoji;

      const newReactions = { ...currentReactions };
      if (hasReaction) {
        delete newReactions[currentUserId];
      } else {
        newReactions[currentUserId] = emoji;
      }

      setMessages(prev =>
        (Array.isArray(prev) ? prev : []).map(m =>
          m.id === messageId ? { ...m, reactions: newReactions } : m
        )
      );

      const localId = targetMsg?.local_id || messageId.toString();
      if (targetMsg) {
        localDatabase.saveMessage(
          { ...targetMsg, reactions: newReactions, conversation: conversationId },
          localId,
          'read'
        );
      }

      const payloadEmoji = hasReaction ? '' : emoji;
      if (websocketService.getConnectionState()) {
        websocketService.sendReaction(messageId, payloadEmoji);
      }

      await fetch(`${BASE_URL}/api/chat/messages/${messageId}/react/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ emoji: payloadEmoji }),
      });
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
  };

  const typingIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTypingState = useRef<boolean | null>(null);
  const inputTextRef = useRef('');

  const handleTyping = useCallback((text: string) => {
    inputTextRef.current = text;

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

  const sendMessageStable = useCallback((content?: string, sendStartTime?: number) => {
    sendMessage(content, sendStartTime);
  }, []);

  const handleRegisterClearStable = useCallback((fn: any) => {
    clearInputRef.current = fn;
  }, []);

  const handleOpenStickerPickerStable = useCallback(() => {
    setStickerPickerVisible(true);
  }, []);

  const handleCloseStickerPickerStable = useCallback(() => {
    setStickerPickerVisible(false);
  }, []);

  const handleInputFocusStable = useCallback(() => {
    setStickerPickerVisible(false);
  }, []);

  // ── Send a Lottie sticker (no upload — URL stored in content) ─────────────
  const sendLottieSticker = useCallback(async (sticker: Sticker) => {
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
    isNearBottomRef.current = true;
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));
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
        // Show pending banner immediately if this was the first message
        if (nm.is_message_request) {
          setMessageRequestStatus('pending');
          setMessageRequestSenderId(currentUser!.id);
        }
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
        // Show pending banner immediately if this was the first message
        if (nm.is_message_request) {
          setMessageRequestStatus('pending');
          setMessageRequestSenderId(currentUser!.id);
        }
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
      media_file_local: doc.uri,
      is_read: false, delivered_at: null, created_at: new Date().toISOString(),
      reactions: {}, reply_to: null, status: 'sending',
    };
    isNearBottomRef.current = true;
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    const controller = new AbortController();
    activeUploadsRef.current[localId] = controller;

    // 2. Background Upload (No setIsSending lock)
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();

      let uploadUri = doc.uri;
      let uploadName = doc.name || `doc_${Date.now()}`;
      let uploadType = doc.type || 'application/octet-stream';
      let payloadContent = caption;

      let persistentLocalUri = doc.uri;
      if (doc.uri && typeof doc.uri === 'string' && doc.uri.startsWith('content://')) {
        try {
          const { dirs } = RNFetchBlob.fs;
          const mediaDir = `${dirs.DocumentDir}/media`;
          const exists = await RNFetchBlob.fs.isDir(mediaDir).catch(() => false);
          if (!exists) {
            await RNFetchBlob.fs.mkdir(mediaDir).catch(() => {});
          }
          const fileExt = doc.name?.split('.').pop() || 'bin';
          const permDest = `${mediaDir}/doc_${Date.now()}.${fileExt}`;
          await RNFetchBlob.fs.cp(doc.uri, permDest);
          persistentLocalUri = `file://${permDest}`;
          uploadUri = permDest;
        } catch (copyErr) {
          console.warn('[Chat] Failed to copy document content:// URI:', copyErr);
        }
      }

      let mediaMeta: MediaE2EEMetadata | null = null;

      // 1-on-1 End-to-End Encryption for documents
      if (!isGroup && otherUser?.id) {
        try {
          const encResult = await MediaCipher.encryptMediaFile(
            uploadUri,
            uploadType,
            uploadName
          );
          uploadUri = encResult.encryptedUri;
          uploadName = encResult.fileName;
          uploadType = 'application/octet-stream';

          mediaMeta = {
            is_media_encrypted: true,
            media_key: encResult.mediaKey,
            nonce: encResult.nonce,
            file_hash: encResult.fileHash,
            mime_type: doc.type || 'application/octet-stream',
            file_name: doc.name || 'document',
            file_size: encResult.originalSize,
            caption: caption,
          };

          // Encrypt metadata with Double Ratchet to recipient
          payloadContent = await MessageCipher.encrypt(otherUser.id, JSON.stringify(mediaMeta));
        } catch (encErr) {
          console.warn('[E2EE] Document encryption fallback:', encErr);
          uploadUri = doc.uri;
          payloadContent = caption;
        }
      }

      fd.append('content', payloadContent);
      fd.append('message_type', 'document');
      fd.append('media_file', { uri: uploadUri, type: uploadType, name: uploadName } as any);
      
      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' },
        body: fd,
        signal: controller.signal,
      });

      if (res.ok) {
        const nm = await res.json();
        if (mediaMeta && nm.id) {
          AsyncStorage.setItem(`@e2ee_meta_${nm.id}`, JSON.stringify(mediaMeta)).catch(() => {});
        }
        const updatedMsg = {
          ...nm,
          content: caption,
          local_id: localId,
          status: 'sent',
          message_type: 'document',
          media_file_local: persistentLocalUri,
          media_e2ee: mediaMeta,
        };
        setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? updatedMsg : m));
        localDatabase.saveMessage(updatedMsg, localId, 'sent');
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

  const sendImageMessage = async (asset: any, caption: string = '', mediaGroupId?: string) => {
    const isVideo = asset.type?.startsWith('video') || asset.uri?.endsWith('.mp4') || asset.uri?.endsWith('.mov');
    const isGif = !!asset.isGif || asset.type === 'image/gif' || asset.type?.includes('gif') || asset.uri?.toLowerCase().endsWith('.gif') || asset.uri?.toLowerCase().includes('gif') || asset.fileName?.toLowerCase().endsWith('.gif');
    // ONLY Gboard keyboard content or explicit stickers are stickers (regular photos from gallery/camera are NOT stickers)
    const isKeyboardContent = !!asset.isSticker || (typeof asset.uri === 'string' && (asset.uri.includes('inputcontent') || asset.uri.includes('inputmethod') || asset.uri.includes('gboard_sticker')));
    const isSticker = isKeyboardContent && !isGif && !isVideo;
    const messageType = isSticker ? 'sticker' : (isGif ? 'gif' : (isVideo ? 'video' : 'image'));

    let initialWidth = asset.width;
    let initialHeight = asset.height;
    if ((!initialWidth || !initialHeight) && asset.uri && !isVideo) {
      try {
        await new Promise<void>((resolve) => {
          Image.getSize(
            asset.uri,
            (w, h) => {
              initialWidth = w;
              initialHeight = h;
              resolve();
            },
            () => resolve()
          );
        });
      } catch {}
    }
    
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
      media_file_local: asset.uri,
      media_group_id: mediaGroupId || null,
      width: initialWidth,
      height: initialHeight,
      is_read: false, delivered_at: null, created_at: new Date().toISOString(),
      reactions: {}, reply_to: null, status: 'sending',
    };
    if (asset.uri && initialWidth && initialHeight) {
      imageDimensionsCache.set(asset.uri, { width: initialWidth, height: initialHeight });
    }
    isNearBottomRef.current = true;
    localDatabase.saveMessage(optimisticMsg, localId, 'sending');
    setMessages(prev => [optimisticMsg, ...(Array.isArray(prev) ? prev : [])]);
    requestAnimationFrame(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }));
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);

    const controller = new AbortController();
    activeUploadsRef.current[localId] = controller;

    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();

      let uploadUri = asset.uri;
      const uploadExt = isVideo ? 'mp4' : getMediaExtension(asset.type, asset.fileName);
      let uploadName = asset.fileName || `${messageType}_${Date.now()}.${uploadExt}`;
      let uploadType = asset.type || (isVideo ? 'video/mp4' : `image/${uploadExt}`);
      let payloadContent = caption;

      let persistentLocalUri = asset.uri;
      if (asset.uri && typeof asset.uri === 'string' && asset.uri.startsWith('content://')) {
        try {
          const { dirs } = RNFetchBlob.fs;
          const mediaDir = `${dirs.DocumentDir}/media`;
          const exists = await RNFetchBlob.fs.isDir(mediaDir).catch(() => false);
          if (!exists) {
            await RNFetchBlob.fs.mkdir(mediaDir).catch(() => {});
          }
          const filePrefix = isSticker ? 'gboard_sticker' : (isGif ? 'gif' : (isVideo ? 'video' : 'img'));
          const permDest = `${mediaDir}/${filePrefix}_${Date.now()}.${uploadExt}`;
          await RNFetchBlob.fs.cp(asset.uri, permDest);
          persistentLocalUri = `file://${permDest}`;
          uploadUri = permDest;
        } catch (copyErr) {
          console.warn('[Chat] Failed to copy content:// URI to persistent storage:', copyErr);
        }
      }

      let mediaMeta: MediaE2EEMetadata | null = null;

      // 1-on-1 End-to-End Media Encryption (for ALL media: photos, videos, stickers, GIFs)
      if (!isGroup && otherUser?.id) {
        try {
          const encResult = await MediaCipher.encryptMediaFile(
            asset.uri,
            uploadType,
            uploadName
          );
          uploadUri = encResult.encryptedUri;
          uploadName = encResult.fileName;
          uploadType = 'application/octet-stream';

          mediaMeta = {
            is_media_encrypted: true,
            media_key: encResult.mediaKey,
            nonce: encResult.nonce,
            file_hash: encResult.fileHash,
            mime_type: encResult.mimeType,
            file_name: encResult.fileName,
            file_size: encResult.originalSize,
            caption: caption,
            width: asset.width,
            height: asset.height,
            is_sticker: isSticker,
            is_gif: isGif,
          };

          // Encrypt metadata with Double Ratchet to recipient
          payloadContent = await MessageCipher.encrypt(otherUser.id, JSON.stringify(mediaMeta));
        } catch (encErr) {
          console.warn('[E2EE] Media encryption fallback:', encErr);
          uploadUri = asset.uri;
          payloadContent = caption;
        }
      }

      fd.append('content', payloadContent);
      fd.append('message_type', isVideo ? 'video' : 'image');
      if (mediaGroupId) {
        fd.append('media_group_id', mediaGroupId);
      }
      fd.append('media_file', { uri: uploadUri, type: uploadType, name: uploadName } as any);

      const res = await fetch(`${BASE_URL}/api/chat/conversations/${conversationId}/messages/`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'multipart/form-data' },
        body: fd,
        signal: controller.signal,
      });

      if (res.ok) {
        const nm = await res.json();
        const serverUrl = resolveImageUrl(nm.media_url || nm.media_file);
        if (asset.uri && imageDimensionsCache.has(asset.uri)) {
          imageDimensionsCache.set(serverUrl, imageDimensionsCache.get(asset.uri)!);
        } else if (asset.width && asset.height) {
          imageDimensionsCache.set(serverUrl, { width: asset.width, height: asset.height });
        }
        if (mediaMeta && nm.id) {
          AsyncStorage.setItem(`@e2ee_meta_${nm.id}`, JSON.stringify(mediaMeta)).catch(() => {});
        }
        const updatedMsg = {
          ...nm,
          content: caption,
          local_id: localId,
          status: 'sent',
          message_type: messageType,
          width: asset.width || optimisticMsg.width,
          height: asset.height || optimisticMsg.height,
          media_file_local: persistentLocalUri,
          media_e2ee: mediaMeta,
        };
        setMessages(prev => prev.map(m => (m.local_id === localId || m.id === tempId) ? updatedMsg : m));
        localDatabase.saveMessage(updatedMsg, localId, 'sent');
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
      if (path) {
        await sendVoiceMessage(path, Math.max(1, finalDuration));
      }
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
        const textToSend = (inputTextRef.current || '').trim();
        if (textToSend.length > 0) {
          isHoldingRef.current = false;
          inputTextRef.current = '';
          clearInputRef.current?.();
          sendMessage(textToSend);
          return;
        }

        isHoldingRef.current = true;
        if (isRecordingRef.current) return;
        
        const ok = await requestPermission();
        if (!ok || !isHoldingRef.current) {
          isHoldingRef.current = false;
          return;
        }

        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        holdTimerRef.current = setTimeout(() => {
          if (isHoldingRef.current) {
            startRecordingProcess();
          }
        }, 120);
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
        const wasHolding = isHoldingRef.current;
        isHoldingRef.current = false;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true }).start();
        setSlideOffset(0);
        if (!isRecordingRef.current) {
          if (wasHolding) {
            Toast.show({
              type: 'info',
              text1: 'Hold to record voice message',
              position: 'bottom',
              visibilityTime: 1500,
            });
          }
          return;
        }
        if (isCancelledRef.current || g.dx < -80) {
          cancelRecordingProcess();
        } else {
          stopRecordingAndSend();
        }
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
  const fmtLastSeen = (d: string | null | undefined) => {
    if (!d) return '';

    const lastSeenTime = new Date(d).getTime();
    if (isNaN(lastSeenTime) || lastSeenTime <= 0) return '';

    const now = Date.now();
    const diffMs = now - lastSeenTime;
    const diffMin = diffMs / 60000;
    const diffHours = diffMs / 3600000;
    const diffDays = diffMs / 86400000;

    // If within 2 minutes, show "Online"
    if (diffMin < 2 && diffMin >= -1) return 'Online';
    // If less than 60 minutes, show minutes
    if (diffMin >= 2 && diffMin < 60) return `${Math.floor(diffMin)}m ago`;
    // If today (less than 24 hours), show time
    if (diffHours < 24) {
      const lastSeenDate = new Date(lastSeenTime);
      const hours = lastSeenDate.getHours();
      const minutes = lastSeenDate.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHour = hours % 12 || 12;
      return `today at ${displayHour}:${minutes
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
      return `yesterday at ${displayHour}:${minutes
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

  const isNearBottomRef = useRef(true);
  const isScrollingToBottomRef = useRef(false);
  const scrollAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom button handler
  const scrollToBottom = () => {
    isScrollingToBottomRef.current = true;
    isNearBottomRef.current = true;
    currentScrollOffset.current = 0;
    isScrollButtonVisibleRef.current = false;
    setHighlightMessageId(null); // Clear highlight when returning to bottom

    // Native instant fade out (0ms)
    Animated.timing(scrollToBottomAnim, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start();

    if (scrollAnimTimeoutRef.current) {
      clearTimeout(scrollAnimTimeoutRef.current);
    }
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    scrollAnimTimeoutRef.current = setTimeout(() => {
      isScrollingToBottomRef.current = false;
    }, 650);
  };

  // Handle scroll to show/hide scroll-to-bottom button
  const handleOnScroll = useCallback((event: any) => {
    const offset = event.nativeEvent?.contentOffset?.y ?? 0;
    currentScrollOffset.current = offset;
    isNearBottomRef.current = offset < 80;

    // If currently performing programmatic scroll to bottom, keep button hidden
    if (isScrollingToBottomRef.current) {
      return;
    }

    // Native 0ms instant fade in / fade out with hysteresis
    if (offset <= 120) {
      if (isScrollButtonVisibleRef.current) {
        isScrollButtonVisibleRef.current = false;
        Animated.timing(scrollToBottomAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }).start();
      }
    } else if (offset > 280) {
      if (!isScrollButtonVisibleRef.current) {
        isScrollButtonVisibleRef.current = true;
        Animated.timing(scrollToBottomAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start();
      }
    }

    // If we are highlighted and scroll back to very bottom, clear highlight
    if (highlightMessageId && offset < 30) {
      setHighlightMessageId(null);
    }
  }, [highlightMessageId, scrollToBottomAnim]);

  // Instagram-style long press menu handlers
  const handleMessageLongPress = (item: Message, event?: any) => {
    if (selectedMessageIdsRef.current.length > 0) {
      handleToggleSelectMessage(item.id);
      return;
    }
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
    if (selectedMessageIdsRef.current.length > 0) {
      handleToggleSelectMessage(item.id);
      return;
    }
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
        
        const isVideoMessage = item.message_type === 'video' ||
          (item.media_e2ee as any)?.mime_type?.startsWith('video') ||
          item.media_file?.toLowerCase().endsWith('.mp4') ||
          item.media_file?.toLowerCase().endsWith('.mov') ||
          item.media_file_local?.toLowerCase().endsWith('.mp4') ||
          item.media_file_local?.toLowerCase().endsWith('.mov') ||
          (typeof item.content === 'string' && (item.content.endsWith('.mp4') || item.content.endsWith('.mov')));

        // OPEN MEDIA (Only for media messages)
        if ((item as any).type === 'media_group') {
            // Single-tap on grouped media → open the scrollable list
            setSelectedGroupMessages((item as any).messages || []);
            setGroupListVisible(true);
        } else if (isVideoMessage) {
            let openUri = isLocalUriUsable((item as any).media_file_local) ? (item as any).media_file_local : null;
            if (!openUri && isLocalUriUsable((item as any).media_file)) {
              openUri = (item as any).media_file;
            }
            if (!openUri && (item as any).media_e2ee?.file_hash) {
              openUri = await MediaCipher.getDecryptedLocalUriIfExists((item as any).media_e2ee.file_hash, 'mp4');
              if (!openUri && (item as any).media_e2ee?.media_key) {
                const rawEncUrl = resolveImageUrl((item as any).media_url || item.media_file);
                if (rawEncUrl) {
                  openUri = await MediaCipher.decryptMediaFile(rawEncUrl, (item as any).media_e2ee.media_key, (item as any).media_e2ee.nonce, (item as any).media_e2ee.file_hash, 'mp4').catch(() => null);
                }
              }
            }
            if (!openUri) {
              openUri = resolveImageUrl((item as any).media_url || item.media_file || (item as any).media_file_local);
            }
            if (openUri) {
              navigation.navigate('MediaViewer', { mediaUrl: openUri, mediaType: 'video' });
            }
        } else if (['image', 'sticker', 'gif'].includes(item.message_type) || Boolean(item.media_e2ee) || Boolean((item as any).media_file_local) || (item.media_file && !item.media_file.endsWith('.mp3') && !item.media_file.endsWith('.pdf'))) {
            const isSticker = item.message_type === 'sticker' ||
              (item.media_e2ee as any)?.is_sticker === true ||
              (typeof item.media_file_local === 'string' && (item.media_file_local.includes('gboard_sticker') || item.media_file_local.includes('inputcontent') || item.media_file_local.includes('inputmethod'))) ||
              (typeof item.media_file === 'string' && (item.media_file.includes('gboard_sticker') || item.media_file.includes('inputcontent') || item.media_file.includes('inputmethod')));

            const isGif = item.message_type === 'gif' ||
              (item.media_e2ee as any)?.is_gif === true ||
              item.media_file?.toLowerCase().endsWith('.gif') ||
              item.media_file_local?.toLowerCase().endsWith('.gif') ||
              item.media_e2ee?.mime_type === 'image/gif' ||
              item.media_e2ee?.file_name?.toLowerCase().endsWith('.gif') ||
              (typeof item.content === 'string' && item.content.includes('.gif'));

            const ext = isGif ? 'gif' : (isSticker ? (getMediaExtension((item as any).media_e2ee?.mime_type, (item as any).media_e2ee?.file_name) || 'webp') : getMediaExtension((item as any).media_e2ee?.mime_type, (item as any).media_e2ee?.file_name || (item as any).media_file));
            let openUri = isLocalUriUsable((item as any).media_file_local) ? (item as any).media_file_local : null;
            if (!openUri && isLocalUriUsable((item as any).media_file)) {
              openUri = (item as any).media_file;
            }
            if (!openUri && (item as any).media_e2ee?.file_hash) {
              openUri = await MediaCipher.getDecryptedLocalUriIfExists((item as any).media_e2ee.file_hash, ext);
              if (!openUri && (item as any).media_e2ee?.media_key) {
                const rawEncUrl = resolveImageUrl((item as any).media_url || item.media_file);
                if (rawEncUrl) {
                  openUri = await MediaCipher.decryptMediaFile(rawEncUrl, (item as any).media_e2ee.media_key, (item as any).media_e2ee.nonce, (item as any).media_e2ee.file_hash, ext).catch(() => null);
                }
              }
            }
            if (!openUri) {
              openUri = resolveImageUrl((item as any).media_url || item.media_file || (item as any).media_file_local || item.content);
            }
            if (openUri) {
              navigation.navigate('MediaViewer', { mediaUrl: openUri, mediaType: 'image' });
            }
        }
      }, DOUBLE_TAP_DELAY);
      lastTapTimeRef.current = now;
    }
  };

  const handleDoubleTapReaction = (item: Message, x: number = 0, y: number = 0) => {
    const targetId = (item as any).type === 'media_group' ? (item as any).messages[0].id : item.id;
    const reactionEmoji = currentUser?.quick_reaction || '❤️';
    
    // Snappy Native UI Pop Animation (Zero React state re-render lag)
    doubleTapHeartRef.current?.trigger(x, y, reactionEmoji);

    // Toggle the user's quick reaction
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

  // ── MULTI-SELECT, FORWARD & DELETE ACTIONS ──────────────────────────────
  const handleEnterSelectionMode = (msg: Message) => {
    setShowMessageActions(false);
    setSelectedMessage(null);
    setSelectedMessageIds([msg.id]);
  };

  const handleToggleSelectMessage = (msgId: number) => {
    setSelectedMessageIds(prev =>
      prev.includes(msgId) ? prev.filter(id => id !== msgId) : [...prev, msgId]
    );
  };

  const handleForwardSingle = (msg: Message) => {
    setShowMessageActions(false);
    setSelectedMessage(null);
    setMessagesToForward([msg]);
    setShowForwardModal(true);
  };

  const handleForwardSelected = () => {
    const selectedMsgs = groupedMessages.filter(m => selectedMessageIds.includes(m.id));
    if (selectedMsgs.length === 0) return;
    setMessagesToForward(selectedMsgs);
    setShowForwardModal(true);
  };

  const handleCopySelected = () => {
    const selectedMsgs = groupedMessages
      .filter(m => selectedMessageIds.includes(m.id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const combined = selectedMsgs.map(m => m.content).filter(Boolean).join('\n\n');
    if (combined) {
      Clipboard.setString(combined);
      Toast.show({
        type: 'success',
        text1: `Copied ${selectedMsgs.length} message${selectedMsgs.length > 1 ? 's' : ''}`,
        position: 'bottom',
      });
      setSelectedMessageIds([]);
    }
  };

  const canUnsendAll = (msgs: Message[]) => {
    if (msgs.length === 0) return false;
    const now = Date.now();
    return msgs.every(m => {
      const isMe = m.sender?.id === currentUser?.id;
      const isTemp = m.id > 1000000000;
      const msgTime = new Date(m.created_at).getTime();
      const diffMin = (now - msgTime) / (1000 * 60);
      return isMe && !isTemp && diffMin <= 1440 && !m.is_deleted;
    });
  };

  const handleOpenDeleteModalForSingle = (msg: Message) => {
    setShowMessageActions(false);
    setSelectedMessage(null);
    if (canUnsendAll([msg])) {
      handleUnsendForEveryone([msg]);
    } else {
      handleDeleteForMe([msg]);
    }
  };

  const handleOpenDeleteModalForSelected = () => {
    const selectedMsgs = groupedMessages.filter(m => selectedMessageIds.includes(m.id));
    if (selectedMsgs.length === 0) return;
    if (canUnsendAll(selectedMsgs)) {
      handleUnsendForEveryone(selectedMsgs);
    } else {
      handleDeleteForMe(selectedMsgs);
    }
  };

  const handleDeleteForMe = async (msgs: Message[]) => {
    if (msgs.length === 0) return;
    setSelectedMessageIds([]);

    // 1. Optimistic remove from UI
    setMessages(prev => prev.filter(m => !msgs.some(d => d.id === m.id)));

    // 2. Remove locally from SQLite
    msgs.forEach(m => {
      const localId = m.local_id || m.id.toString();
      localDatabase.hardDeleteMessage(localId);
    });

    // 3. API call in background (for_everyone = false)
    try {
      await Promise.all(
        msgs
          .filter(m => m.id && m.id < 1000000000)
          .map(m => chatAPI.deleteMessage(m.id, false))
      );
    } catch (err) {
      console.warn('[Chat] DeleteForMe API warning:', err);
    }
  };

  const handleUnsendForEveryone = async (msgs: Message[]) => {
    if (msgs.length === 0) return;
    setSelectedMessageIds([]);

    // 1. Optimistic soft delete in UI
    setMessages(prev =>
      prev.map(m =>
        msgs.some(d => d.id === m.id)
          ? { ...m, is_deleted: true, content: 'The message was removed' }
          : m
      )
    );

    // 2. SQLite soft delete
    msgs.forEach(m => {
      const localId = m.local_id || m.id.toString();
      localDatabase.softDeleteMessage(localId);
    });

    // 3. API call in background (for_everyone = true)
    try {
      await Promise.all(
        msgs
          .filter(m => m.id && m.id < 1000000000)
          .map(m => chatAPI.deleteMessage(m.id, true))
      );
    } catch (err) {
      console.error('[Chat] UnsendForEveryone API error:', err);
      // Restore on failure
      setMessages(prev =>
        prev.map(m => {
          const original = msgs.find(d => d.id === m.id);
          return original ? original : m;
        })
      );
    }
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

  const getDirectMessageSeenTime = useCallback((msg: Message) => {
    const otherUserId = otherUser?.id || route.params?.otherUser?.id;
    if (otherUserId && liveReadTimes[Number(otherUserId)]) {
      return liveReadTimes[Number(otherUserId)];
    }
    const otherParticipant = conversation?.participants?.find(
      (p: any) => p.user && p.user.id !== currentUser?.id
    );
    if (otherParticipant?.last_read_at) {
      return otherParticipant.last_read_at;
    }
    if ((msg as any).read_at) {
      return (msg as any).read_at;
    }
    if (msg.delivered_at) {
      return msg.delivered_at;
    }
    return null;
  }, [otherUser?.id, route.params?.otherUser?.id, liveReadTimes, conversation?.participants, currentUser?.id]);

  const fmtSeenTime = useCallback((d: string | null | undefined) => {
    if (!d) return 'Seen';
    const now = Date.now();
    const seenTime = new Date(d).getTime();
    if (isNaN(seenTime) || seenTime <= 0) return 'Seen';

    const diffMs = now - seenTime;
    const diffMin = diffMs / 60000;
    const diffHours = diffMs / 3600000;
    const diffDays = diffMs / 86400000;

    if (diffMin < 1 && diffMin >= -1) return 'Seen now';
    if (diffMin < 60 && diffMin >= 1) return `Seen ${Math.floor(diffMin)}m ago`;
    if (diffHours < 24) return `Seen ${Math.floor(diffHours)}h ago`;
    if (diffDays < 2) return 'Seen yesterday';
    return `Seen ${new Date(seenTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
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
      // Filter out raw challenge payloads from chat bubbles (handled in background)
      if (isTriviaChallengeMessage(msg) || isScoreSubmissionMessage(msg)) {
        return false;
      }
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
             const sameSender = msg.sender.id === prevMsg.sender.id;
             
             // ONLY group if both messages explicitly belong to the same multi-select batch (media_group_id)
             // or programmatic simultaneous batch (within 800ms)
             const hasMatchingGroupId = Boolean((msg as any).media_group_id && (prevMsg as any).media_group_id && (msg as any).media_group_id === (prevMsg as any).media_group_id);
             const timeDiff = Math.abs(new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime());
             const isSimultaneousLegacy = !(msg as any).media_group_id && !(prevMsg as any).media_group_id && sameSender && timeDiff <= 800;

             if (sameSender && (hasMatchingGroupId || isSimultaneousLegacy)) {
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

    const isSelected = selectedMessageIds.includes(item.id);

    // Handle deleted messages
    if (item.is_deleted) {
      return (
        <TouchableOpacity
          activeOpacity={isSelectionMode ? 0.7 : 1}
          onPress={isSelectionMode ? () => handleToggleSelectMessage(item.id) : undefined}
          style={[
            { flexDirection: 'column', width: '100%' },
            isSelected && { backgroundColor: theme.primary + '18' },
          ]}
        >
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
            {isSelectionMode && (
              <View
                style={[
                  s.selectionCheckbox,
                  { borderColor: isSelected ? theme.primary : '#AAA' },
                  isSelected && { backgroundColor: theme.primary },
                ]}
              >
                {isSelected && <Icon name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            )}
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
        </TouchableOpacity>
      );
    }

    const rawUrl = (item as any).media_url || item.media_file || (item as any).media_file_local || (item.content?.startsWith('http') ? item.content : null);
    const url = resolveImageUrl(rawUrl);
    
    const isStatusReply = typeof item.content === 'string' && item.content.startsWith('↩ Replied to status');

    const isGif = item.message_type === 'gif' ||
      (item.media_e2ee as any)?.is_gif === true ||
      item.media_file?.toLowerCase().endsWith('.gif') ||
      item.media_file_local?.toLowerCase().endsWith('.gif') ||
      item.media_file?.toLowerCase().includes('/gif_') ||
      item.media_file_local?.toLowerCase().includes('/gif_') ||
      item.media_e2ee?.mime_type === 'image/gif' ||
      item.media_e2ee?.file_name?.toLowerCase().endsWith('.gif') ||
      (typeof item.content === 'string' && item.content.includes('.gif'));

    const isSticker = !isGif && (
      item.message_type === 'sticker' ||
      (item.media_e2ee as any)?.is_sticker === true ||
      (typeof item.media_file_local === 'string' && (item.media_file_local.includes('gboard_sticker') || item.media_file_local.includes('inputcontent') || item.media_file_local.includes('inputmethod'))) ||
      (typeof item.media_file === 'string' && (item.media_file.includes('gboard_sticker') || item.media_file.includes('inputcontent') || item.media_file.includes('inputmethod')))
    );

    const isVideo = item.message_type === 'video' ||
      (item.media_e2ee as any)?.mime_type?.startsWith('video') ||
      item.media_file?.toLowerCase().endsWith('.mp4') ||
      item.media_file?.toLowerCase().endsWith('.mov') ||
      item.media_file_local?.toLowerCase().endsWith('.mp4') ||
      item.media_file_local?.toLowerCase().endsWith('.mov') ||
      (typeof item.content === 'string' && (item.content.endsWith('.mp4') || item.content.endsWith('.mov')));

    const isImage = !isVideo && (item.message_type === 'image' || item.message_type === 'sticker' || isSticker || isGif ||
        Boolean(item.media_e2ee) || Boolean(item.media_file && !item.media_file.endsWith('.mp4') && !item.media_file.endsWith('.mov') && !item.media_file.endsWith('.mp3') && !item.media_file.endsWith('.pdf')) || Boolean((item as any).media_file_local));

    const isMediaMessage = ['image', 'video', 'sticker'].includes(item.message_type) || item.type === 'media_group' || isSticker || isGif || isVideo || Boolean(item.media_file) || Boolean((item as any).media_file_local) || Boolean(item.media_e2ee);

    const alignmentStyle = { alignSelf: isMe ? 'flex-end' : 'flex-start' };

    const renderMedia = () => {
    if (item.is_deleted) return null;
    
    // ONLY process media messages
    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(item.message_type) && item.type !== 'media_group' && !isSticker && !isGif && !item.media_file && !(item as any).media_file_local && !item.media_e2ee) return null;

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

    const downloadAndOpenFile = async (msgItem: Message) => {
        const { dirs } = RNFetchBlob.fs;
        const e2ee = (msgItem as any).media_e2ee;
        const rawFileName = e2ee?.file_name || (msgItem.media_file || 'Document').split('/').pop() || 'Document';
        const fileExt = (e2ee?.file_name || rawFileName).split('.').pop()?.toLowerCase() || '';
        const fileName = rawFileName;
        const localDest = `${dirs.DocumentDir}/${fileName}`;
        
        try {
            let targetPath: string | null = null;
            const localUri = (msgItem as any).media_file_local || msgItem.media_file;

            if (isLocalUriUsable(localUri)) {
                targetPath = (localUri as string).replace('file://', '');
            } else if (localUri && (localUri as string).startsWith('content://')) {
                await RNFetchBlob.fs.cp(localUri, localDest).catch(() => {});
                targetPath = localDest;
            }

            // If encrypted with E2EE, decrypt first!
            if (!targetPath && e2ee?.file_hash) {
                targetPath = await MediaCipher.getDecryptedLocalUriIfExists(e2ee.file_hash, fileExt);
                if (targetPath) {
                    targetPath = targetPath.replace('file://', '');
                }
                if (!targetPath && e2ee?.media_key) {
                    const rawEncUrl = resolveImageUrl((msgItem as any).media_url || msgItem.media_file);
                    if (rawEncUrl) {
                        const decryptedUri = await MediaCipher.decryptMediaFile(
                            rawEncUrl,
                            e2ee.media_key,
                            e2ee.nonce,
                            e2ee.file_hash,
                            fileExt
                        );
                        if (decryptedUri) {
                            targetPath = decryptedUri.replace('file://', '');
                        }
                    }
                }
            }

            // If not encrypted or plain download
            if (!targetPath) {
                const downloadUrl = resolveImageUrl((msgItem as any).media_url || msgItem.media_file);
                if (downloadUrl) {
                    const exists = await RNFetchBlob.fs.exists(localDest);
                    if (!exists) {
                        await RNFetchBlob.config({
                            path: localDest,
                            fileCache: true,
                        }).fetch('GET', downloadUrl);
                    }
                    targetPath = localDest;
                }
            }

            if (!targetPath) {
                Alert.alert('Download Error', 'Could not locate or decrypt file.');
                return;
            }

            // Attempt 1: Open with FileViewer
            try {
                await FileViewer.open(targetPath, { showOpenWithDialog: true });
                return;
            } catch (openErr: any) {
                console.warn('FileViewer open with specific mime failed, trying generic intent:', openErr?.message);
            }

            // Attempt 2: If FileViewer failed due to mime type, try Android actionViewIntent with */*
            if (Platform.OS === 'android' && RNFetchBlob.android) {
                try {
                    await RNFetchBlob.android.actionViewIntent(targetPath, '*/*');
                    return;
                } catch (intentErr) {
                    console.warn('ActionViewIntent failed:', intentErr);
                }

                // Attempt 3: Add to Android system download manager with notification
                try {
                    RNFetchBlob.android.addCompleteDownload({
                        title: fileName,
                        description: 'File downloaded successfully',
                        mime: 'application/octet-stream',
                        path: targetPath,
                        showNotification: true,
                    });
                    Toast.show({
                        type: 'success',
                        text1: 'Download Complete',
                        text2: `${fileName} saved to Downloads`,
                        position: 'bottom',
                    });
                    return;
                } catch (downloadErr) {
                    console.warn('addCompleteDownload failed:', downloadErr);
                }
            }

            // Attempt 4: Share sheet fallback
            try {
                const { Share: RNShare } = require('react-native');
                await RNShare.share({
                    url: `file://${targetPath}`,
                    title: fileName,
                });
            } catch {
                Toast.show({
                    type: 'success',
                    text1: 'File Downloaded',
                    text2: `${fileName} saved to device`,
                    position: 'bottom',
                });
            }
        } catch (e: any) {
            console.error('Download and open error:', e);
            Alert.alert('Download Error', 'Could not download or open file.');
        }
    };

    if (item.message_type === 'document') {
        const e2ee = (item as any).media_e2ee;
        const rawFileName = e2ee?.file_name || (item.media_file || 'Document').split('/').pop() || 'Document';
        const fileExt = (e2ee?.file_name || rawFileName).split('.').pop()?.toLowerCase() || '';
        const fileName = rawFileName;
        let iconName = 'document-text-outline';
        if (fileExt === 'pdf') iconName = 'document-outline';
        const fileColor = fileExt === 'pdf' 
          ? '#EF4444' 
          : ['doc', 'docx'].includes(fileExt) 
          ? '#3B82F6' 
          : ['xlsx', 'csv'].includes(fileExt) 
          ? '#10B981' 
          : ['zip', 'rar'].includes(fileExt) 
          ? '#F59E0B' 
          : (chatTheme?.accentColor || theme.primary);

        const isCustom = Boolean(chatTheme?.id && chatTheme.id !== 'default');
        const docTextColor = isMe
          ? (chatTheme?.myBubble?.textColor || '#FFFFFF')
          : (isCustom ? (chatTheme?.theirBubble?.textColor || theme.textPrimary) : (isDark ? '#FFFFFF' : '#111B21'));
        const docGradient = isMe ? (chatTheme?.myBubble?.gradient || null) : null;
        const docBgColor = isMe
          ? (docGradient ? 'transparent' : (chatTheme?.myBubble?.solidColor || theme.myMessage))
          : (isCustom ? (chatTheme?.theirBubble?.backgroundColor || (isDark ? '#1E293B' : '#EAECEF')) : (isDark ? '#1E293B' : '#EAECEF'));

        return (
          <View
            style={[
              s.documentBubbleInner,
              {
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                backgroundColor: docBgColor,
                borderTopRightRadius: isMe ? 4 : borderRadius.lg,
                borderTopLeftRadius: !isMe ? 4 : borderRadius.lg,
                borderRadius: borderRadius.lg,
                overflow: 'hidden',
                ...(!isMe && !isDark && !isCustom ? {
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: 'rgba(0, 0, 0, 0.08)',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.05,
                  shadowRadius: 1.5,
                  elevation: 1,
                } : {}),
              },
            ]}
          >
            {isMe && docGradient && (
              <LinearGradient
                colors={docGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}

            {/* Left side: Icon + Extension label below it */}
            <View style={s.documentLeftContainer}>
              <Icon name={iconName} size={32} color={isMe ? '#FFFFFF' : fileColor} />
              <Text style={[s.documentExtLabel, { color: isMe ? 'rgba(255, 255, 255, 0.9)' : fileColor }]}>
                {fileExt.toUpperCase() || 'FILE'}
              </Text>
            </View>

            {/* Middle: File name */}
            <View style={s.documentCenterContainer}>
              <Text 
                style={[s.documentFileNameText, { color: docTextColor, fontWeight: '600' }]} 
                numberOfLines={2}
                ellipsizeMode="middle"
              >
                {fileName}
              </Text>
            </View>

            {/* Right side: Green circular download button or Spinner */}
            <TouchableOpacity 
              style={[
                s.documentDownloadButton,
                isMe && { backgroundColor: 'rgba(255, 255, 255, 0.25)' },
              ]}
              onPress={() => item.status !== 'sending' && downloadAndOpenFile(item)}
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


    if (isImage) {
      // While sending, use the local URI directly from item.media_file so we show the actual image
      const displayUrl = (item as any).status === 'sending' ? (item.media_file || url) : url;
      return (
        <View style={{ position: 'relative' }}>
          <ChatImage 
            url={displayUrl}
            isMe={isMe}
            isDark={isDark}
            onPress={(e: any) => handleMessagePress(item, e)}
            onLongPress={(e: any) => handleMessageLongPress(item, e)}
            isSticker={isSticker}
            isGif={isGif}
            origWidth={(item as any).width}
            origHeight={(item as any).height}
            localUri={(item as any).media_file_local || item.media_file}
            mediaE2ee={(item as any).media_e2ee}
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
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.8)',
                  justifyContent: 'center',
                  alignItems: 'center',
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
                <Icon name="close" size={16} color="#FFF" />
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

    if (isVideo) {
      return (
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            style={[
              {
                width: 240,
                height: 160,
                borderRadius: 14,
                backgroundColor: '#1C1C1E',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                alignSelf: isMe ? 'flex-end' : 'flex-start',
              },
            ]}
            onPress={(e) => handleMessagePress(item, e)}
            onLongPress={(e) => handleMessageLongPress(item, e)}
            activeOpacity={0.9}
            delayLongPress={500}
            disabled={item.status === 'sending'}
          >
            <View style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: 'rgba(0,0,0,0.6)',
              borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.7)',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Icon name="play" size={28} color="#FFF" style={{ marginLeft: 3 }} />
            </View>
            <View style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              backgroundColor: 'rgba(0,0,0,0.65)',
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}>
              <Icon name="videocam" size={12} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '600' }}>Video</Text>
            </View>
          </TouchableOpacity>
          {(item as any).status === 'sending' && (
            <View style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.55)',
                justifyContent: 'center', alignItems: 'center',
                borderRadius: 14,
                gap: 10,
            }}>
              <ActivityIndicator size="large" color="#FFF" />
              <TouchableOpacity
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.8)',
                  justifyContent: 'center',
                  alignItems: 'center',
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
                <Icon name="close" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}
          {(item as any).status === 'failed' && (
            <TouchableOpacity
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 14,
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

    if (!url && !item.media_e2ee && !(item as any).media_file_local) {
      let label = isStatusReply ? 'Status unavailable' : 'Media unavailable';
      return (
        <View 
          pointerEvents="none"
          style={[s.imageContainer, alignmentStyle, { backgroundColor: isDark ? '#2C2C2E' : '#F0F0F0', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: isDark ? '#3A3A3C' : '#E0E0E0', padding: 10 }]}
        >
          <Icon name="alert-circle-outline" size={32} color="#999" />
          <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 8, fontWeight: '500', textAlign: 'center' }}>
             {label}
          </Text>
        </View>
      );
    }

    return null;
  };

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
              {renderReplyThumbnail(reply, messages, theme.primary)}
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
      <TouchableOpacity
        activeOpacity={isSelectionMode ? 0.7 : 1}
        onPress={isSelectionMode ? () => handleToggleSelectMessage(item.id) : undefined}
        style={[
          { flexDirection: 'column', width: '100%' },
          isSelected && { backgroundColor: theme.primary + '18' },
        ]}
      >
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
          {isSelectionMode && (
            <View
              style={[
                s.selectionCheckbox,
                { borderColor: isSelected ? theme.primary : '#AAA' },
                isSelected && { backgroundColor: theme.primary },
              ]}
            >
              {isSelected && <Icon name="checkmark" size={13} color="#FFFFFF" />}
            </View>
          )}

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
                size={60}
                autoPlay={index === 0}
                onLongPress={() => handleMessageLongPress(item, {} as any)}
                onPress={() => {}}
              />
            </View>
          ) : isMediaMessage ? (
            (() => {
              const isRawCipherOrError = (text?: string) => {
                if (!text) return true;
                const t = text.trim();
                if (t.startsWith('{') && t.includes('"ciphertext"')) return true;
                if (t.startsWith('🔒')) return true;
                if (['📷 Photo', '📹 Video', '🎵 Audio', '📄 Document'].includes(t)) return true;
                return false;
              };
              const hasCaption = !!(item.content && item.content.trim() && !isRawCipherOrError(item.content));
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
                        backgroundColor: isMe ? theme.myMessage : theme.theirMessage,
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
                            color: isMe ? '#FFFFFF' : '#111B21',
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
            (() => {
              const emojiInfo = isOnlyEmojis(item.content);
              const isEmojiOnly = emojiInfo.isOnly && !item.reply_to;
              const emojiFontSize = emojiInfo.count === 1 ? 36 : emojiInfo.count === 2 ? 30 : emojiInfo.count === 3 ? 26 : 22;
              const emojiLineHeight = emojiFontSize + 8;

              const isCustom = Boolean(chatTheme?.id && chatTheme.id !== 'default');
              const myBubbleGradient = chatTheme?.myBubble?.gradient || null;
              const myBubbleBg = myBubbleGradient ? 'transparent' : (chatTheme?.myBubble?.solidColor || theme.myMessage);
              const myBubbleTextColor = chatTheme?.myBubble?.textColor || '#FFFFFF';

              const theirBubbleBg = isCustom
                ? (chatTheme?.theirBubble?.backgroundColor || theme.theirMessage)
                : (isDark ? '#1E293B' : '#EAECEF');
              const theirBubbleTextColor = isCustom
                ? (chatTheme?.theirBubble?.textColor || theme.textPrimary)
                : (isDark ? '#FFFFFF' : '#111B21');

              return isMe ? (
                <View style={{ maxWidth: '80%', minWidth: isEmojiOnly ? undefined : 50, alignSelf: 'flex-end' }}>
                  <TouchableOpacity
                    style={isEmojiOnly ? {
                      backgroundColor: 'transparent',
                      paddingHorizontal: 4,
                      paddingVertical: 2,
                      alignItems: 'flex-end',
                    } : [
                      s.messageBubble,
                      s.myMessageBubble,
                      {
                        width: '100%',
                        alignItems: 'flex-end',
                        backgroundColor: myBubbleBg,
                        borderTopRightRadius: 4,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: borderRadius.lg,
                        overflow: 'hidden',
                      }
                    ]}
                    onPress={(e) => handleMessagePress(item, e)}
                    onLongPress={(e) => handleMessageLongPress(item, e)}
                    activeOpacity={0.8}
                    delayLongPress={500}
                  >
                    {!isEmojiOnly && myBubbleGradient && (
                      <LinearGradient
                        colors={myBubbleGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    {item.reply_to && renderReplyIndicator(item.reply_to, true)}
                    {!!item.edited_at && (
                      <Text style={{ fontSize: 11, color: isEmojiOnly ? theme.textMuted : (chatTheme?.myBubble?.timeColor || 'rgba(255, 255, 255, 0.75)'), marginBottom: 2, fontStyle: 'italic' }}>Edited</Text>
                    )}
                    <Text style={isEmojiOnly ? { fontSize: emojiFontSize, lineHeight: emojiLineHeight } : [s.messageText, { color: myBubbleTextColor }]}>
                      {typeof item.content === 'string' && item.content.includes('"ciphertext"') && item.content.includes('"senderIdentityKey"') ? '🔒 [Encrypted message]' : String(item.content || '')}
                    </Text>
                  </TouchableOpacity>
                  {hasReactions && renderReactionsBadge(true)}
                </View>
              ) : (
                <View style={{ maxWidth: '70%', minWidth: isEmojiOnly ? undefined : 50, alignSelf: 'flex-start' }}>
                  <TouchableOpacity
                    style={isEmojiOnly ? {
                      backgroundColor: 'transparent',
                      paddingHorizontal: 4,
                      paddingVertical: 2,
                      alignItems: 'flex-start',
                    } : [
                      s.messageBubble,
                      s.theirMessageBubble,
                      {
                        width: '100%',
                        alignItems: 'flex-start',
                        backgroundColor: theirBubbleBg,
                        borderTopLeftRadius: 4,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: borderRadius.lg,
                        ...(!isDark && !isCustom ? {
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: 'rgba(0, 0, 0, 0.08)',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.05,
                          shadowRadius: 1.5,
                          elevation: 1,
                        } : {}),
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
                      <Text style={{ fontSize: 11, color: isEmojiOnly ? theme.textMuted : '#ff0000', marginBottom: 2, fontStyle: 'italic' }}>Edited</Text>
                    )}
                    <Text style={isEmojiOnly ? { fontSize: emojiFontSize, lineHeight: emojiLineHeight } : [s.messageText, { color: theirBubbleTextColor }]}>
                      {typeof item.content === 'string' && item.content.includes('"ciphertext"') && item.content.includes('"senderIdentityKey"') ? '🔒 [Encrypted message]' : String(item.content || '')}
                    </Text>
                  </TouchableOpacity>
                  {hasReactions && renderReactionsBadge(false)}
                </View>
              );
            })()
          )}
        </View>
        
        {/* Seen Status (Instagram Style) */}
        {!isGroup && item.id === latestSeenMessageId && (
          <View style={{ alignSelf: 'flex-end', marginRight: 16, marginTop: -2, marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '500' }}>
              {fmtSeenTime(getDirectMessageSeenTime(item))}
            </Text>
          </View>
        )}

        {isGroup && item.id === messages[0]?.id && (
          <GroupReadReceipts msg={item} />
        )}
      </TouchableOpacity>
    );
  }, [currentUser, isGroup, highlightMessageId, mediaErrorIds, messages, editingMessageId, latestSeenMessageId, fmtSeenTime, getDirectMessageSeenTime, liveReadTimes, selectedReceiptUser, selectedMessageIds, isSelectionMode, chatTheme]);
  

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

  const renderSelectionHeader = () => {
    const selectedMsgs = groupedMessages.filter(m => selectedMessageIds.includes(m.id));
    const allHaveText = selectedMsgs.length > 0 && selectedMsgs.every(m => !!m.content && m.content.trim() !== '');

    return (
      <View style={[s.customHeader, { paddingTop: insets.top, height: 60 + insets.top }]}>
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark ? 'rgba(10, 14, 22, 0.88)' : 'rgba(255, 255, 255, 0.92)',
            },
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={s.headerBackButton}
            onPress={() => setSelectedMessageIds([])}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Icon name="close" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '700', color: theme.textPrimary, marginLeft: 12 }}>
            {selectedMessageIds.length} Selected
          </Text>
        </View>

        <View style={s.headerRight}>
          {/* Forward */}
          <TouchableOpacity
            style={{ padding: 8, marginRight: 4 }}
            onPress={handleForwardSelected}
            activeOpacity={0.7}
          >
            <Icon name="arrow-redo-outline" size={22} color={theme.textPrimary} />
          </TouchableOpacity>

          {/* Copy */}
          {allHaveText && (
            <TouchableOpacity
              style={{ padding: 8, marginRight: 4 }}
              onPress={handleCopySelected}
              activeOpacity={0.7}
            >
              <Icon name="copy-outline" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
          )}

          {/* Delete / Trash */}
          <TouchableOpacity
            style={{ padding: 8 }}
            onPress={handleOpenDeleteModalForSelected}
            activeOpacity={0.7}
          >
            <Icon name="trash-outline" size={22} color="#FF4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCustomHeader = () => {
    const isCustomTheme = Boolean(chatTheme?.id && chatTheme.id !== 'default');
    return (
      <View style={[s.customHeader, { paddingTop: insets.top, height: 60 + insets.top }]}>
        {/* Header Glass Backdrop Overlay */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isCustomTheme
                ? 'rgba(0, 0, 0, 0.28)'
                : (isDark ? 'rgba(10, 14, 22, 0.75)' : 'rgba(255, 255, 255, 0.82)'),
            },
          ]}
        />
        <Pressable 
           style={s.headerBackButton}
           onPress={handleGoBack}
           hitSlop={{ top: 16, bottom: 16, left: 16, right: 8 }}
           android_ripple={{ color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderless: true, radius: 20 }}
        >
          <Icon name="arrow-back" size={24} color={isCustomTheme ? '#FFFFFF' : theme.textPrimary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Pressable
            onPress={() => {
              if (!isGroup && headerHasStatus && headerStatuses.length > 0) {
                navigation.navigate('StatusViewer', { statuses: headerStatuses, initialIndex: 0 });
              } else if (isGroup) {
                navigation.navigate('GroupInfo', { conversationId });
              } else {
                const targetUser = otherUser || conversation?.other_user;
                if (targetUser) {
                  navigation.navigate('Profile', { user: targetUser, conversationId });
                }
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <View
              style={[
                {
                  width: 38, height: 38, borderRadius: 19,
                  marginRight: 6,
                  borderWidth: (!isGroup && headerHasStatus) ? 2 : 0,
                  borderColor: (!isGroup && headerHasStatus) ? theme.primary : 'transparent',
                  padding: (!isGroup && headerHasStatus) ? 2 : 0,
                }
              ]}
            >
              <AvatarWithFallback
                uri={isGroup ? (conversation?.profile_picture || route.params?.avatarUri) : (otherUser?.profile_picture || route.params?.avatarUri)}
                sticker={isGroup ? null : (otherUser?.avatar_sticker || route.params?.avatarSticker)}
                displayName={isGroup ? (conversation?.name || chatTitle) : (otherUser?.display_name || otherUser?.email || chatTitle)}
                isGroup={isGroup}
                style={{ width: '100%', height: '100%', borderRadius: 19 }}
              />
            </View>
          </Pressable>

          <Pressable
            style={s.headerTextContainer}
            onPress={() => {
              if (isGroup) {
                navigation.navigate('GroupInfo', { conversationId });
              } else {
                const targetUser = otherUser || conversation?.other_user;
                if (targetUser) {
                  navigation.navigate('Profile', { user: targetUser, conversationId });
                }
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          >
            <Text style={[s.headerName, isCustomTheme && { color: '#FFFFFF' }]} numberOfLines={1}>
              {chatTitle}
            </Text>
            <Text style={[s.headerStatus, isCustomTheme && { color: 'rgba(255, 255, 255, 0.75)' }]} numberOfLines={1}>
              {isGroup
                ? groupDescription || 'Group details'
                : otherUser
                ? amIBlocked
                ? ''
                : otherUser.last_seen_privacy === 'nobody'
                ? ''
                : (() => {
                    const formatted = fmtLastSeen(otherUser.last_seen);
                    if (!formatted) return '';
                    if (formatted === 'Online') return 'Online';
                    return `Last seen ${formatted}`;
                  })()
                : ''}
            </Text>
          </Pressable>
        </View>

        <View style={s.headerRight}>
          {/* Call buttons are disabled and muted if users are not friends (except in groups) */}
          <TouchableOpacity
            style={[
              s.callIcon,
              isCustomTheme && { backgroundColor: 'rgba(255, 255, 255, 0.15)' },
              !isGroup && friendStatus !== 'friends' && { opacity: 0.3 }
            ]}
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
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Icon name="videocam" size={19} color={isCustomTheme ? '#FFFFFF' : theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              s.callIcon,
              isCustomTheme && { backgroundColor: 'rgba(255, 255, 255, 0.15)' },
              !isGroup && friendStatus !== 'friends' && { opacity: 0.3 }
            ]}
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
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Icon name="call" size={17} color={isCustomTheme ? '#FFFFFF' : theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.callIcon, isCustomTheme && { backgroundColor: 'rgba(255, 255, 255, 0.15)' }]}
            onPress={() => setShowThemeModal(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Icon name="color-palette-outline" size={18} color={isCustomTheme ? '#FFFFFF' : theme.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* 1. Full Screen Edge-to-Edge Static Background Layer (Status Bar to Bottom Nav Bar) */}
      {chatTheme?.background?.type === 'gradient' && chatTheme.background.colors ? (
        <LinearGradient
          colors={chatTheme.background.colors}
          style={StyleSheet.absoluteFill}
        />
      ) : chatTheme?.background?.type === 'image' && chatTheme.background.imageUrl ? (
        <View style={StyleSheet.absoluteFill}>
          <FastImage
            source={{ uri: chatTheme.background.imageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `rgba(0, 0, 0, ${chatTheme.background.overlayDim ?? 0.35})` },
            ]}
          />
        </View>
      ) : chatTheme?.background?.solidColor && chatTheme.background.solidColor !== 'transparent' ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: chatTheme.background.solidColor },
          ]}
        />
      ) : null}

      <StatusBar
        barStyle={chatTheme?.id && chatTheme.id !== 'default' ? 'light-content' : (isDark ? 'light-content' : 'dark-content')}
        backgroundColor="transparent"
        translucent={true}
      />
      <KeyboardWrapperView
        style={[s.container, { backgroundColor: 'transparent', paddingBottom: insets.bottom }]}
        {...keyboardWrapperProps}
      >
        {/* Header */}
        {isSelectionMode ? (
          renderSelectionHeader()
        ) : searchMode ? (
          renderSearchBar()
        ) : (
          renderCustomHeader()
        )}

      {renderGroupCallBanner()}

      {/* Content area: messages + input bar lift together as one unit when keyboard opens.
          Using translateY (GPU-only transform) means zero layout recalculation → no jerk/shake.
          Wrapped in overflow: 'hidden' so translated messages are clipped cleanly below the header. */}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Reanimated.View style={[{ flex: 1 }, contentLiftStyle]}>

      {/* Messages list container with relative positioning for FAB and overlays */}
      <View style={{ flex: 1, position: 'relative' }}>
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          renderItem={renderMessage}
          keyExtractor={item => (item.local_id || item.id).toString()}
          style={{ backgroundColor: 'transparent' }}
          contentContainerStyle={s.messagesList}
          inverted={true}
          // Disable scroll during back navigation so the FlatList gesture responder
          // does not compete with the back button tap and cause 500ms input latency.
          scrollEnabled={!isNavigatingBack.current}
          keyboardShouldPersistTaps="handled"
          // Load older messages when user scrolls to top (= onEndReached in inverted list)
          onEndReached={loadOlderMessages}
          onEndReachedThreshold={0.3}
          onScroll={handleOnScroll}
          onMomentumScrollEnd={handleOnScroll}
          onScrollEndDrag={handleOnScroll}
          scrollEventThrottle={16}
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
          ListFooterComponent={
            isLoadingOlder ? (
              <View style={s.loadingOlderContainer}>
                <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.75)" />
              </View>
            ) : null
          }
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            }
          }}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          updateCellsBatchingPeriod={30}
          removeClippedSubviews={Platform.OS === 'android'}
          ListEmptyComponent={
            !isLoading && searchText ? (
              <View style={s.emptySearchContainer}>
                <Icon name="search-outline" size={48} color="#DDD" />
                <Text style={s.emptySearchText}>No messages found</Text>
              </View>
            ) : null
          }
        />

        {/* Scroll to bottom button (GPU-accelerated native fade in/out) */}
        <Animated.View
          style={[
            s.scrollToBottomButton,
            {
              opacity: scrollToBottomAnim,
              transform: [
                {
                  scale: scrollToBottomAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={s.scrollToBottomInner}
            onPress={scrollToBottom}
            activeOpacity={0.8}
            accessibilityLabel="Scroll to bottom"
          >
            <Icon name="chevron-down" size={22} color={theme.textPrimary} />
          </TouchableOpacity>
        </Animated.View>
      </View>

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
      {showEmojiPicker && (
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
      )}

      {/* Instagram-style message actions menu */}
      {showMessageActions && (
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
          style={{ flex: 1, backgroundColor: 'transparent' }}
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
                  {/* Reply */}
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

                  {/* Forward */}
                  <TouchableOpacity
                    style={s.actionMenuItem}
                    onPress={() => handleForwardSingle(selectedMessage)}
                  >
                    <View style={s.actionMenuItemContent}>
                      <Icon
                        name="arrow-redo-outline"
                        size={20}
                        color="#333"
                        style={{ marginRight: 12 }}
                      />
                      <Text style={s.actionMenuItemText}>Forward</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Copy */}
                  {!!selectedMessage.content && (
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
                  )}

                  {/* Select */}
                  <TouchableOpacity
                    style={s.actionMenuItem}
                    onPress={() => handleEnterSelectionMode(selectedMessage)}
                  >
                    <View style={s.actionMenuItemContent}>
                      <Icon
                        name="checkbox-outline"
                        size={20}
                        color="#333"
                        style={{ marginRight: 12 }}
                      />
                      <Text style={s.actionMenuItemText}>Select</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Edit */}
                  {isMe && canEdit && (
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

                  {/* Unsend / Delete */}
                  <TouchableOpacity
                    style={s.actionMenuItem}
                    onPress={() => handleOpenDeleteModalForSingle(selectedMessage)}
                  >
                    <View style={s.actionMenuItemContent}>
                      <Icon
                        name="trash-outline"
                        size={20}
                        color="#FF4444"
                        style={{ marginRight: 12 }}
                      />
                      <Text style={[s.actionMenuItemText, { color: '#FF4444' }]}>
                        {isMe && canUnsend ? 'Unsend' : 'Delete for me'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}
        </TouchableOpacity>
      </Modal>
      )}

      {/* Full emoji picker overlay */}
      {showFullEmojiPicker && (
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
      )}

      {/* Permission modal */}
      {showPermissionModal && (
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
      )}


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
          {hasLoadedInitialMessages && messages.length === 0 && (
            <View style={s.quickStickersRowWrapper}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.quickStickersScrollRow}
              >
                {NEW_CHAT_STICKERS.map((st) => (
                  <TouchableOpacity
                    key={st.id}
                    style={s.quickStickerCard}
                    onPress={() => sendLottieSticker(st)}
                    activeOpacity={0.7}
                  >
                    <LottieView
                      source={{ uri: st.url }}
                      autoPlay={true}
                      loop={true}
                      style={s.quickStickerLottie}
                      resizeMode="contain"
                    />
                    <Text style={s.quickStickerCardLabel}>{st.emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {!isGroup && friendStatus !== 'friends' && messageRequestStatus === 'pending' ? (
            /* Scenario A & B: Message request banner */
            <View style={{
              width: '100%',
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.md,
              backgroundColor: theme.background,
            }}>
              <View style={{
                backgroundColor: theme.surface,
                borderRadius: borderRadius.lg,
                borderWidth: 1,
                borderColor: theme.border,
                padding: spacing.lg,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.1,
                shadowRadius: 2,
                elevation: 2,
              }}>
                {messageRequestSenderId === currentUser?.id ? (
                  /* Scenario A: The sender is waiting for approval */
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, color: theme.textPrimary, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>
                      ⏳ Message Request Pending
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center' }}>
                      You can send more messages once your request is approved.
                    </Text>
                  </View>
                ) : (
                  /* Scenario B: The receiver sees a pending request */
                  <View style={{ alignItems: 'center', width: '100%' }}>
                    <Text style={{ fontSize: 14, color: theme.textPrimary, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>
                      💬 Message Request
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', marginBottom: 16 }}>
                      Do you want to let {otherUser?.display_name || otherUser?.first_name || 'this user'} message you?
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                      <TouchableOpacity
                        onPress={handleRejectMessageRequest}
                        style={{
                          flex: 1,
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          borderWidth: 1,
                          borderColor: '#EF4444',
                          borderRadius: borderRadius.md,
                          paddingVertical: 10,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 13 }}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleApproveMessageRequest}
                        style={{
                          flex: 1,
                          backgroundColor: 'rgba(16, 185, 129, 0.1)',
                          borderWidth: 1,
                          borderColor: '#10B981',
                          borderRadius: borderRadius.md,
                          paddingVertical: 10,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 13 }}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : (
            /* Scenario C: Normal input composer */
            <View style={s.inputContainer}>
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
                onRegisterClear={handleRegisterClearStable}
                isDisabled={false}
                onOpenStickerPicker={handleOpenStickerPickerStable}
                isStickerPickerVisible={stickerPickerVisible}
                onCloseStickerPicker={handleCloseStickerPickerStable}
                onFocus={handleInputFocusStable}
                isCustomTheme={Boolean(chatTheme?.id && chatTheme.id !== 'default')}
                chatTheme={chatTheme}
              />

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
          )}
        </>
      )}
        </Reanimated.View>
      </View>

      {/* Forward Message Modal */}
      {showForwardModal && (
        <ForwardMessageModal
          visible={showForwardModal}
          onClose={() => {
            setShowForwardModal(false);
            setMessagesToForward([]);
          }}
          messagesToForward={messagesToForward}
          onForwardComplete={() => {
            setSelectedMessageIds([]);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <DeleteConfirmationModal
          visible={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setMessagesToDelete([]);
          }}
          allCanUnsend={canUnsendAll(messagesToDelete)}
          selectedCount={messagesToDelete.length}
          onDeleteForMe={() => handleDeleteForMe(messagesToDelete)}
          onUnsendForEveryone={() => handleUnsendForEveryone(messagesToDelete)}
        />
      )}

      <Toast />

      {/* ── Lottie Sticker Picker Sheet (Always mounted, offscreen by default, 0ms GPU slide) ── */}
      <StickerPickerSheet
        visible={stickerPickerVisible}
        stickerPacks={BUILT_IN_STICKER_PACKS}
        onSelectSticker={(sticker) => sendLottieSticker(sticker)}
        onClose={() => setStickerPickerVisible(false)}
        sheetHeight={286}
      />

      {!!stickerPreview && (
        <StickerPreviewModal
          visible={!!stickerPreview}
          mediaUri={stickerPreview?.uri ?? ''}
          mimeType={stickerPreview?.mimeType ?? ''}
          onClose={() => setStickerPreview(null)}
          theme={isDark ? 'dark' : 'light'}
          restoreNavBarColor={theme.background}
          onSend={async (uri, mimeType, caption) => {
            setStickerPreview(null);
            const isGif = !!(mimeType === 'image/gif' || mimeType?.includes('gif') || uri?.toLowerCase().endsWith('.gif') || uri?.toLowerCase().includes('gif'));
            const isSticker = !isGif;
            await sendImageMessage({ uri, type: mimeType, isSticker, isGif }, caption);
          }}
        />
      )}
      {cameraMenuVisible && (
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
                    setCameraMenuVisible(false);
                    setMultiPreviewVisible(true);
                }
            }}
        />
      )}
      {attachmentMenuVisible && (
        <MediaPickerModal 
            visible={attachmentMenuVisible} 
            onClose={() => setAttachmentMenuVisible(false)}
            mode="attachment"
            bottom={Platform.OS === 'ios' ? 70 : 60}
            left={20}
            onMediaSelected={async (assets: any[]) => {
                if (assets.length > 0) {
                    setSelectedMultiMedia(assets.map(asset => ({
                        uri: asset.uri,
                        type: asset.type || (asset.uri.endsWith('.mp4') || asset.uri.endsWith('.mov') ? 'video/mp4' : 'image/jpeg'),
                        fileName: asset.fileName
                    })));
                    setAttachmentMenuVisible(false);
                    setMultiPreviewVisible(true);
                }
            }}
            onDocumentSelected={async (docs: any[]) => {
                if (docs && docs.length > 0) {
                    setAttachmentMenuVisible(false);
                    docs.forEach(doc => sendDocumentMessage(doc));
                }
            }}
            onOpenGallery={() => {
                setAttachmentMenuVisible(false);
                setGalleryPickerVisible(true);
            }}
        />
      )}
      {galleryPickerVisible && (
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
              setGalleryPickerVisible(false);
              setMultiPreviewVisible(true);
            }
          }}
        />
      )}
      {multiPreviewVisible && (
        <MultiMediaPreviewModal
          visible={multiPreviewVisible}
          mediaItems={selectedMultiMedia}
          onClose={() => {
            setMultiPreviewVisible(false);
            setSelectedMultiMedia([]);
          }}
          onSend={(items) => {
            setMultiPreviewVisible(false);
            setSelectedMultiMedia([]);
            const mediaGroupId = items.length > 1 ? `mg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` : undefined;
            items.forEach(item => {
              sendImageMessage(item, item.caption, mediaGroupId);
            });
          }}
          themeColor={theme.primary}
        />
      )}
    </KeyboardWrapperView>
      {groupListVisible && (
        <MediaGroupListModal
          visible={groupListVisible}
          messages={selectedGroupMessages}
          onClose={() => {
            setGroupListVisible(false);
            setSelectedGroupMessages([]);
          }}
        onSelectMedia={(msg) => {
          setGroupListVisible(false);
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
      />
      )}
      {showThemeModal && (
        <ChatThemeModal
          visible={showThemeModal}
          onClose={() => setShowThemeModal(false)}
          currentTheme={chatTheme}
          conversationId={conversationId}
          onSelectTheme={(theme) => setChatTheme(theme)}
        />
      )}

      {/* Double-tap reaction animation overlay (At absolute screen root for pixel-perfect coordinates) */}
      <DoubleTapHeartOverlay ref={doubleTapHeartRef} defaultEmoji={currentUser?.quick_reaction || '❤️'} />
    </View>
  );
};

let _cachedStyles: ReturnType<typeof StyleSheet.create> | null = null;
let _cachedTheme: any = null;
const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => {
  if (_cachedStyles && _cachedTheme === theme) return _cachedStyles;
  _cachedTheme = theme;
  _cachedStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
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
    backgroundColor: 'transparent',
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: spacing.xs,
    height: 56,
    zIndex: 10,
  },
  headerLeft: { width: 36, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 26, color: theme.textPrimary, fontWeight: '300' },
  headerBackButton: {
    marginRight: 2,
    padding: 6,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginRight: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 0,
  },
  callIcon: {
    marginLeft: 4,
    width: 33,
    height: 33,
    borderRadius: 16.5,
    backgroundColor: theme.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callIconText: { fontSize: 16 },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 6,
  },
  headerSticker: {
    fontSize: 26,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  headerAvatarText: {
    color: theme.primary,
    fontSize: fontSize.md,
    fontWeight: 'bold',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  headerTextContainer: { flex: 1, justifyContent: 'center' },
  headerName: { fontSize: 16, fontWeight: '600', color: theme.textPrimary, letterSpacing: 0.1 },
  headerStatus: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },
  activeText: { color: '#25D366', fontWeight: '500' },
  messagesList: {
    paddingHorizontal: spacing.md,
    paddingTop: 2,
    paddingBottom: 8,
  },
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
    borderColor: theme.border,
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
    backgroundColor: theme.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
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
    paddingHorizontal: spacing.sm,
    paddingTop: 0,
    paddingBottom: 2,
    backgroundColor: 'transparent',
    alignItems: 'flex-end',
    zIndex: 1000,
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
    bottom: 12,
    alignSelf: 'center',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.card || theme.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 50,
  },
  scrollToBottomInner: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
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
    zIndex: 10,
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
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
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
    width: 210,
    height: 210,
    marginTop: 2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoContainer: {
    width: 210,
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
    width: 220,
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
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    width: '100%',
  },
  quickStickersScrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
  },
  quickStickersContainerEvenly: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    width: '100%',
  },
  quickStickerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    minWidth: 56,
  },
  quickStickerLottie: {
    width: 48,
    height: 48,
  },
  quickStickerCardLabel: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  selectionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    alignSelf: 'center',
  },
  newChatCenteredOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 5,
  },
  newChatWelcomeCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: theme.card || theme.surface,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  newChatAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    marginBottom: 8,
  },
  newChatName: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  newChatUsername: {
    fontSize: 13,
    color: theme.textMuted || theme.textSecondary,
    fontWeight: '500',
    marginTop: 1,
    marginBottom: 4,
  },
  newChatBio: {
    fontSize: 12.5,
    color: theme.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
    paddingHorizontal: 8,
    lineHeight: 17,
  },
  newChatActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    width: '100%',
    justifyContent: 'center',
  },
  newChatActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minHeight: 36,
  },
  newChatActionBtnSecondary: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  newChatActionBtnDisabled: {
    opacity: 0.6,
  },
  newChatActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  newChatActionBtnTextSecondary: {
    color: theme.textPrimary,
  },
  newChatStickersSection: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    paddingTop: 10,
    alignItems: 'center',
  },
  newChatStickersLabel: {
    fontSize: 11.5,
    color: theme.textMuted || theme.textSecondary,
    fontWeight: '600',
    marginBottom: 8,
  },
  quickStickersScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 10,
  },
  quickStickerScrollBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    minWidth: 48,
  },
  quickStickerScrollEmoji: {
    fontSize: 10,
    marginTop: 2,
    color: theme.textSecondary,
    fontWeight: '600',
  },
});
  return _cachedStyles;
};

export const ChatRoomScreen = React.memo(ChatRoomScreenComponent);
