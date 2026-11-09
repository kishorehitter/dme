import React, { useState, useEffect, useCallback, useRef } from 'react';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import LottieStickerMessage from '../../components/LottieStickerMessage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingTour, { TourTarget, TourStepKey } from '../../components/OnboardingTour';
import LogoutConfirmationModal from '../../components/LogoutConfirmationModal';
import ChatLockPinModal from '../../components/ChatLockPinModal';
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';
import {
  View,
  Text as RNText,
  FlatList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Platform,
  Modal,
  TextInput,
  LayoutAnimation,
  UIManager,
  PanResponder,
  Linking,
  Animated,
  Easing,
  Share,
  Keyboard,
  Dimensions,
  InteractionManager,
  StatusBar,
  NativeModules,
  AppState,
} from 'react-native';
import BiometricService from '../../services/BiometricService';


import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { launchImageLibrary } from 'react-native-image-picker';

const SafeText = (props: any) => {
  const children = React.Children.map(props.children, child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return child;
  });
  return <RNText {...props}>{children}</RNText>;
};
const Text = SafeText;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const fluidDropdownAnimation = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import { useUpdateInfo } from '../../context/UpdateContext';
import { useFocusEffect } from '@react-navigation/native';
import { downloadAndInstallAPK } from '../../services/updateDownloader';
import { useAuth } from '../../context/AuthContext';
import { chatAPI } from '../../services/api';
import { getApiUrl } from '../../config/network';
import localDatabase from '../../services/LocalDatabase';
import { websocketService, WebSocketMessage } from '../../services/websocket';
import { StatusService, Status, UserStatusGroup } from '../../services/StatusService';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { useTheme } from '../../context/ThemeContext';
import { Conversation, User } from '../../types';
import { MessageCipher, BackupManager, KeyManager } from '../../services/e2ee';
import BackupRestoreModal from '../../components/e2ee/BackupRestoreModal';
import BackupSetupModal from '../../components/e2ee/BackupSetupModal';
import {
  isTriviaChallengeMessage,
  isScoreSubmissionMessage,
  getScoreSubmissionFromContent,
  getChallengePayloadFromContent,
  syncChallengeFromMessage,
} from '../../services/TriviaChallengeService';

interface ChatListScreenProps {
  navigation: any;
}

const PopoverMenu = ({ 
  visible, onClose, onNewGroup, onClearAll, onProfile, onLogout, onSelect, onSettings, onAppUpdate, onShareApp, onChatBackup, onAppTour
}: { 
  visible: boolean, onClose: () => void, onNewGroup: () => void, onClearAll: () => void,
  onProfile: () => void, onLogout: () => void, onSelect: () => void,
  onSettings: () => void, onAppUpdate: () => void, onShareApp: () => void, onChatBackup: () => void,
  onAppTour?: () => void
}) => {
  const { hasUpdate } = useUpdateInfo();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const s = React.useMemo(() => dynamicStyles(theme, isDark), [theme, isDark]);

  const topOffset = (StatusBar.currentHeight || insets.top || 0) + 50;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={s.popoverBackdrop}
        onPress={onClose}
        activeOpacity={1}
      >
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
        <View style={[s.popover, { top: topOffset }]} onStartShouldSetResponder={() => true}>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onAppUpdate(); }}>
            <Icon name="download-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>App Update</Text>
            {hasUpdate && (
              <View style={s.newBadge}>
                <Text style={s.newBadgeText}>New</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onProfile(); }}>
            <Icon name="person-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onNewGroup(); }}>
            <Icon name="people-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>New Group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onClearAll(); }}>
            <Icon name="trash-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>Clear all chats</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onSelect(); }}>
            <Icon name="checkbox-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>Select and clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onShareApp(); }}>
            <Icon name="share-social-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>Share App</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onChatBackup(); }}>
            <Icon name="shield-checkmark-outline" size={20} color="#10B981" />
            <Text style={s.popoverText}>Chat Backup</Text>
          </TouchableOpacity>
          {onAppTour && (
            <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onAppTour(); }}>
              <Icon name="compass-outline" size={20} color={theme.textPrimary} />
              <Text style={s.popoverText}>App Tour</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.popoverItem} onPress={() => { onClose(); onSettings(); }}>
            <Icon name="settings-outline" size={20} color={theme.textPrimary} />
            <Text style={s.popoverText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.popoverItem, { borderTopWidth: 1, borderColor: theme.border, marginTop: 4 }]} onPress={() => { onClose(); onLogout(); }}>
            <Icon name="log-out-outline" size={20} color="#F44336" />
            <Text style={[s.popoverText, { color: '#F44336' }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const formatMessageTime = (dateString: string | undefined | null) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  
  const isToday = date.toDateString() === now.toDateString();
  
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (isYesterday) {
    return 'Yesterday';
  } else {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    return `${day}/${month}/${year}`;
  }
};

const isEncryptedContent = (text: any): boolean => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  return trimmed.includes('"ciphertext"') && trimmed.includes('"senderIdentityKey"');
};

const renderLastMessageContent = (lastMessage: Conversation['last_message']) => {
  if (!lastMessage) return 'No messages yet';
  
  try {
    if (typeof isTriviaChallengeMessage === 'function' && isTriviaChallengeMessage(lastMessage)) {
      return 'No messages yet';
    }
    if (typeof isScoreSubmissionMessage === 'function' && isScoreSubmissionMessage(lastMessage)) {
      return 'No messages yet';
    }
  } catch {}

  let message_type = typeof lastMessage.message_type === 'string' ? lastMessage.message_type : '';
  const rawContent = lastMessage.content;
  let content = typeof rawContent === 'string' ? rawContent : (rawContent ? JSON.stringify(rawContent) : '');

  // Extract clean text if content is wrapped in raw JSON envelope (e.g. {"content":"hy", "message_type":"text"})
  if (typeof content === 'string' && content.trim().startsWith('{') && content.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed && typeof parsed === 'object') {
        if (!parsed.ciphertext && !parsed.senderIdentityKey) {
          if (typeof parsed.content === 'string') {
            content = parsed.content;
          } else if (typeof parsed.text === 'string') {
            content = parsed.text;
          } else if (typeof parsed.message === 'string') {
            content = parsed.message;
          }
          if (parsed.message_type && !message_type) {
            message_type = parsed.message_type;
          }
        }
      }
    } catch {}
  }

  if (
    message_type === 'lottie_sticker' || 
    message_type === 'sticker' || 
    (content && (content.includes('/stickers/') || content.endsWith('.json')))
  ) {
    return <><Icon name="image-outline" size={14} color="#666" /> Sticker</>;
  }

  // Guard against any raw JSON or TRIVIA prefix leaks
  if (
    content.startsWith('[TRIVIA_') ||
    content.includes('[TRIVIA_') ||
    (content.includes('"challengeId"') && (content.includes('"questions"') || content.includes('"entry"') || content.includes('"leaderboard"')))
  ) {
    return 'No messages yet';
  }

  if (
    content.includes('"ciphertext"') ||
    content.includes('"senderIdentityKey"') ||
    isEncryptedContent(content)
  ) {
    // 1. Try SQLite cache by server message ID (plaintext stored on send/receive)
    if (lastMessage.id) {
      try {
        const local = localDatabase.getMessageById(lastMessage.id);
        if (local && local.content && typeof local.content === 'string' && !isEncryptedContent(local.content) && !local.content.includes('Unable to decrypt')) {
          // If it's a media type, show icon not the URL/path
          const mt = local.message_type || message_type;
          if (mt === 'image') return <><Icon name="image" size={14} color="#666" /> Photo</>;
          if (mt === 'video') return <><Icon name="videocam" size={14} color="#666" /> Video</>;
          if (mt === 'audio') return <><Icon name="mic" size={14} color="#666" /> Audio</>;
          if (mt === 'lottie_sticker' || mt === 'sticker') return <><Icon name="image-outline" size={14} color="#666" /> Sticker</>;
          return local.content;
        }
      } catch {}
    }
    // 2. Fallback: if message_type is known, show icon — never show raw ciphertext
    if (message_type === 'image') return <><Icon name="image" size={14} color="#666" /> Photo</>;
    if (message_type === 'video') return <><Icon name="videocam" size={14} color="#666" /> Video</>;
    if (message_type === 'audio') return <><Icon name="mic" size={14} color="#666" /> Audio</>;
    if (message_type === 'lottie_sticker' || message_type === 'sticker') return <><Icon name="image-outline" size={14} color="#666" /> Sticker</>;
    if (message_type === 'document') return <><Icon name="document-text" size={14} color="#666" /> Document</>;
    // 3. Unknown type with encrypted content — show lock
    return <><Icon name="lock-closed-outline" size={13} color="#888" /> Message</>;
  }
  
  switch (message_type) {
    case 'image':
      return <><Icon name="image" size={14} color="#666" /> Photo</>;
    case 'video':
      return <><Icon name="videocam" size={14} color="#666" /> Video</>;
    case 'audio':
      return <><Icon name="mic" size={14} color="#666" /> Audio</>;
    case 'document':
      return <><Icon name="document-text" size={14} color="#666" /> Document</>;
    case 'trivia_challenge':
      return 'No messages yet';
    case 'text':
    default:
      return content || '';
  }
};

const renderMessageTicks = (lastMessage: any) => {
  const status = lastMessage.status || (lastMessage.is_read ? 'read' : (lastMessage.delivered_at ? 'delivered' : 'sent'));
  
  switch (status) {
    case 'read':
      return (
        <Icon 
          name="checkmark-done" 
          size={16} 
          color="#4597f5f6" 
          style={{ 
            marginRight: 3,
            textShadowColor: '#4597f5f6',
            textShadowOffset: { width: 0.1, height: 0.1 },
            textShadowRadius: 1,
          }} 
        />
      );
    case 'delivered':
      return (
        <Icon 
          name="checkmark-done" 
          size={16} 
          color="#A0A0A0" 
          style={{ 
            marginRight: 3,
            textShadowColor: '#A0A0A0',
            textShadowOffset: { width: 0.1, height: 0.1 },
            textShadowRadius: 1,
          }} 
        />
      );
    case 'sending':
      return <Icon name="time-outline" size={14} color="#A0A0A0" style={{ marginRight: 3 }} />;
    case 'sent':
    default:
      return (
        <Icon 
          name="checkmark" 
          size={16} 
          color="#A0A0A0" 
          style={{ 
            marginRight: 3,
            textShadowColor: '#A0A0A0',
            textShadowOffset: { width: 0.1, height: 0.1 },
            textShadowRadius: 1,
          }} 
        />
      );
  }
};

interface ConversationItemRowProps {
  item: Conversation;
  isSelected: boolean;
  selectionMode: boolean;
  statusGroups: UserStatusGroup[];
  friends: any[];
  user: any;
  theme: any;
  isDark: boolean;
  s: any;
  typingUserName?: string | null;
  onPress: () => void;
  onLongPress: () => void;
  onAvatarPress: () => void;
}

const ConversationItemRowComponent: React.FC<ConversationItemRowProps> = ({
  item,
  isSelected,
  selectionMode,
  statusGroups,
  friends,
  user,
  theme,
  isDark,
  s,
  typingUserName,
  onPress,
  onLongPress,
  onAvatarPress,
}) => {
  const selectAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(selectAnim, {
      toValue: isSelected ? 1 : 0,
      duration: 250,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: false,
    }).start();
  }, [isSelected, selectAnim]);

  const userId = item.is_group ? null : item.other_user?.id;
  const statusGroup = userId ? statusGroups.find(g => g.user_id === userId) : null;
  const userStatuses = statusGroup ? statusGroup.statuses : [];
  const isFriend = userId ? friends.some((f: any) => f.id === userId || String(f.id) === String(userId)) : false;
  const hasStatus = isFriend && userStatuses && userStatuses.length > 0;
  const hasUnseen = statusGroup ? statusGroup.has_unseen : false;

  let isOnline = false;
  if (isFriend && !item.is_group && item.other_user) {
    const isPrivacyNobody = (item.other_user as any)?.last_seen_privacy === 'nobody';
    if (!isPrivacyNobody) {
      if (item.other_user.last_seen === null) {
        isOnline = true;
      } else {
        const lastSeen = new Date(item.other_user.last_seen).getTime();
        const now = Date.now();
        isOnline = (now - lastSeen) < 120000;
      }
    }
  }

  // Clean neutral light grey row background when selected / clicked:
  // Light Mode: soft light grey tint rgba(0, 0, 0, 0.06)
  // Dark Mode: subtle translucent grey rgba(255, 255, 255, 0.08)
  const rowHighlightBg = selectAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.surface, isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'],
  });

  return (
    <Animated.View style={{ backgroundColor: rowHighlightBg, position: 'relative' }}>
      <Pressable
        android_ripple={{
          color: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
          borderless: false,
        }}
        style={({ pressed }) => [
          s.conversationItem,
          { backgroundColor: 'transparent' },
          Platform.OS === 'ios' && pressed && { opacity: 0.75 },
        ]}
        unstable_pressDelay={0}
        pressRetentionOffset={{ top: 20, left: 20, right: 20, bottom: 20 }}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        {/* Left animated indicator bar */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: isDark ? '#94A3B8' : '#64748B',
            opacity: selectAnim,
          }}
        />

        {selectionMode && (
          <View style={s.checkboxContainer}>
            <Icon
              name={isSelected ? 'checkbox' : 'square-outline'}
              size={22}
              color={isSelected ? (isDark ? '#38BDF8' : '#00A884') : (isDark ? '#64748B' : '#94A3B8')}
            />
          </View>
        )}

        <View style={{ position: 'relative', width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }}>
          {hasStatus && (
            hasUnseen ? (
              <LinearGradient
                colors={['#0F62FE', '#00E5FF', '#10B981']}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={{
                  position: 'absolute',
                  width: 47,
                  height: 47,
                  borderRadius: 23.5,
                }}
              />
            ) : (
              <View
                style={{
                  position: 'absolute',
                  width: 47,
                  height: 47,
                  borderRadius: 23.5,
                  borderWidth: 1.5,
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.25)' : '#D1D5DB',
                }}
              />
            )
          )}
          <AvatarWithFallback
            uri={item.is_group ? item.profile_picture : item.other_user?.profile_picture}
            sticker={item.is_group ? null : item.other_user?.avatar_sticker}
            displayName={
              item.is_group
                ? item.name || 'Group'
                : item.other_user?.display_name || item.other_user?.email || 'User'
            }
            isGroup={item.is_group}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 0,
            }}
            onPress={selectionMode ? onPress : onAvatarPress}
          />
          {!item.is_group && isOnline && <View style={s.onlineDot} />}
        </View>

        <View style={s.centerContent}>
          <View style={s.titleRow}>
            <Text style={s.name} numberOfLines={1}>
              {item.is_group
                ? item.name || 'Group'
                : item.other_user?.display_name || item.other_user?.email || 'User'}
            </Text>
          </View>
          <View style={s.messageRow}>
            {typingUserName ? (
              <Text
                style={[
                  s.lastMessage,
                  { color: '#10B981', fontWeight: '600' },
                ]}
                numberOfLines={1}
              >
                {item.is_group ? `${typingUserName} is typing...` : 'typing...'}
              </Text>
            ) : (
              <Text
                style={[
                  s.lastMessage,
                  item.unread_count > 0 && s.unreadMessage,
                ]}
                numberOfLines={1}
              >
                {!item.is_group &&
                item.message_request_status === 'pending' &&
                item.message_request_sender_id === user?.id ? (
                  <>
                    <Icon name="hourglass-outline" size={14} color="#666" /> Message request pending
                  </>
                ) : !item.is_group &&
                  item.message_request_status === 'rejected' &&
                  item.message_request_sender_id === user?.id ? (
                  <>
                    <Icon name="close-circle-outline" size={14} color="#F44336" /> Message request declined
                  </>
                ) : !item.is_group &&
                  item.message_request_status === 'accepted' &&
                  item.message_request_sender_id === user?.id &&
                  item.last_message === null ? (
                  <>
                    <Icon name="checkmark-circle-outline" size={14} color="#4CAF50" /> Message request approved
                  </>
                ) : item.is_group && item.last_message === null ? (
                  <>
                    <Icon name="chatbubble-outline" size={13} color={isDark ? '#64748B' : '#94A3B8'} /> Tap to start
                    chatting
                  </>
                ) : (
                  renderLastMessageContent(item.last_message)
                )}
              </Text>
            )}
          </View>
        </View>

        <View style={s.rightContent}>
          <Text style={s.time}>{formatMessageTime(item.last_message?.created_at || item.updated_at)}</Text>
          {item.unread_count > 0 && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadCount}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
};

const ConversationItemRow = React.memo<ConversationItemRowProps>(
  ConversationItemRowComponent,
  (prev, next) => {
    return (
      prev.isSelected === next.isSelected &&
      prev.selectionMode === next.selectionMode &&
      prev.isDark === next.isDark &&
      prev.theme === next.theme &&
      prev.item === next.item &&
      prev.statusGroups === next.statusGroups &&
      prev.friends === next.friends &&
      prev.user?.id === next.user?.id &&
      prev.typingUserName === next.typingUserName
    );
  }
);

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ navigation, route }: any) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme, isDark), [theme, isDark]);

  useFocusEffect(
    useCallback(() => {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
      }
    }, [isDark])
  );

  const navigateToChatRoom = useCallback((params: any) => {
    navigation.navigate('ChatRoom', params);
  }, [navigation]);

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const cached = localDatabase.getConversations(true);
      return cached && cached.length > 0 ? cached : [];
    } catch {
      return [];
    }
  });

  const [typingMap, setTypingMap] = useState<Record<number, string>>({});
  const typingTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      Object.values(typingTimeoutsRef.current).forEach(t => clearTimeout(t));
    };
  }, []);
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const initialTabParam = route?.params?.initialTab || route?.params?.tab;
  const [activeTab, setActiveTab] = useState<'all' | 'groups' | 'pending' | 'locked'>(
    initialTabParam === 'pending' || initialTabParam === 'groups'
      ? initialTabParam
      : 'all'
  );
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [isLockedAuthenticated, setIsLockedAuthenticated] = useState<boolean>(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinModalMode, setPinModalMode] = useState<'setup' | 'verify'>('verify');
  const [pendingActionAfterPin, setPendingActionAfterPin] = useState<(() => void) | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const chevronAnim = useRef(new Animated.Value(0)).current;
  const arrowRotation = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const [friends, setFriends] = useState<any[]>([]);
  const [messageRequests, setMessageRequests] = useState<any[]>([]);
  const [friendRequestsCount, setFriendRequestsCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    try {
      const cached = localDatabase.getConversations(true);
      return !cached || cached.length === 0;
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [backupSetupModalVisible, setBackupSetupModalVisible] = useState(false);
  const { user, logout } = useAuth();
  const updateInfo = useUpdateInfo();
  const insets = useSafeAreaInsets();
  const isLoadingRef = useRef(false);
  const deletedConversationIdsRef = useRef<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(() => Boolean((global as any).isMusicPlaying));
  const spinValue = useRef(new Animated.Value(0)).current;
  const [myStatuses, setMyStatuses] = useState<Status[]>([]);

  useFocusEffect(
    useCallback(() => {
      userTouchedSearch.current = false;
      setActiveRoomCode((global as any).activeMusicRoomCode || null);
      setIsMusicPlaying(Boolean((global as any).isMusicPlaying));
      if (user?.id) {
        StatusService.getStatuses().then(statuses => {
          if (Array.isArray(statuses)) {
            setMyStatuses(statuses.filter((s: Status) => s.user_id === user.id));
          }
        }).catch(() => {});
      }
    }, [user?.id])
  );

  const [statusGalleryVisible, setStatusGalleryVisible] = useState(false);

  const handleUploadStatus = useCallback(() => {
    setStatusGalleryVisible(true);
  }, []);

  const handleStatusGallerySelect = useCallback((assets: GalleryAsset[]) => {
    setStatusGalleryVisible(false);
    if (assets && assets.length > 0) {
      const asset = assets[0];
      if (!asset?.uri) return;
      navigation.navigate('StatusEditor', {
        mediaUri: asset.uri,
        mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
        source: 'gallery',
      });
    }
  }, [navigation]);

  const handleProfileAvatarPress = useCallback(() => {
    if (myStatuses.length > 0) {
      navigation.navigate('StatusViewer', {
        statuses: myStatuses,
        initialIndex: 0,
        currentUserId: user?.id,
        isOwn: true,
      });
    } else {
      navigation.navigate('Profile');
    }
  }, [myStatuses, navigation, user?.id]);

  useEffect(() => {
    const handleVisibility = () => {
      setActiveRoomCode((global as any).activeMusicRoomCode || null);
      setIsMusicPlaying(Boolean((global as any).isMusicPlaying));
    };
    const handlePlaybackState = (playing: boolean) => {
      setIsMusicPlaying(Boolean(playing));
    };

    const subMinimize = DeviceEventEmitter.addListener('minimize_music_room', handleVisibility);
    const subOpen = DeviceEventEmitter.addListener('open_music_room', handleVisibility);
    const subClose = DeviceEventEmitter.addListener('close_music_room', () => {
      setActiveRoomCode(null);
      setIsMusicPlaying(false);
    });
    const subPlayback = DeviceEventEmitter.addListener('music_playback_state_changed', handlePlaybackState);

    let spinAnimation: Animated.CompositeAnimation | null = null;
    if (activeRoomCode) {
      spinValue.setValue(0);
      spinAnimation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      spinAnimation.start();
    } else {
      spinValue.setValue(0);
    }

    return () => {
      subMinimize.remove();
      subOpen.remove();
      subClose.remove();
      subPlayback.remove();
      if (spinAnimation) spinAnimation.stop();
    };
  }, [activeRoomCode]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  // Expandable entertainment hub (Disco Ball + Trivia Book + Add Friend) - initially opened
  const [isHubExpanded, setIsHubExpanded] = useState(true);
  const wasExpandedBeforeKeyboard = useRef(true);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      if (searchRef.current?.isFocused()) {
        setIsKeyboardActive(true);
        wasExpandedBeforeKeyboard.current = isHubExpanded;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setIsHubExpanded(false);
      }
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      if (isKeyboardActive) {
        setIsKeyboardActive(false);
        searchRef.current?.blur();
        if (wasExpandedBeforeKeyboard.current) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setIsHubExpanded(true);
        }
      }
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isKeyboardActive, isHubExpanded]);

  // ── Onboarding tour ────────────────────────────────────────────────────────
  const ONBOARDING_KEY = `dme_onboarding_done_v1_${user?.id || 'default'}`;
  const [tourVisible, setTourVisible] = useState(false);
  const [tourRequested, setTourRequested] = useState(false);
  const [tourTargets, setTourTargets] = useState<Partial<Record<TourStepKey, TourTarget>>>({});
  const fabRef = useRef<View>(null);
  const playBtnRef = useRef<View>(null);
  const menuBtnRef = useRef<View>(null);
  const triviaBtnRef = useRef<View>(null);

  const measureRef = (ref: React.RefObject<View>, key: TourStepKey) => {
    return new Promise<void>((resolve) => {
      let attempts = 0;
      const tryMeasure = () => {
        if (!ref.current) {
          if (attempts < 10) {
            attempts++;
            setTimeout(tryMeasure, 120);
          } else {
            resolve();
          }
          return;
        }
        ref.current.measure((x, y, width, height, pageX, pageY) => {
          if (width > 0 && height > 0) {
            setTourTargets((prev) => ({
              ...prev,
              [key]: { key, x: pageX, y: pageY, width, height } as TourTarget,
            }));
            resolve();
          } else if (attempts < 10) {
            attempts++;
            setTimeout(tryMeasure, 120);
          } else {
            console.warn(`Failed to measure ${key} after 10 attempts`);
            resolve();
          }
        });
      };
      tryMeasure();
    });
  };

  const measureAllTargets = async () => {
    try {
      setIsHubExpanded(true);
      DeviceEventEmitter.emit('request_status_tab_measure');

      await new Promise(r => setTimeout(r, 100));

      await Promise.all([
        measureRef(fabRef, 'fab'),
        measureRef(triviaBtnRef, 'trivia'),
        measureRef(playBtnRef, 'play'),
              ]);

      // Fallback for statusTab if event didn't arrive
      setTimeout(() => {
        setTourTargets(prev => {
          if (prev.statusTab) return prev;
          const statusW = 32;
          const statusH = 32;
          const screenW = Dimensions.get('window').width;
          const screenH = Dimensions.get('window').height;
          const statusX = (screenW - statusW) / 2;
          const statusY = screenH - (64 + (insets.bottom || 48)) + 6;
          return {
            ...prev,
            statusTab: { key: 'statusTab', x: statusX, y: statusY, width: statusW, height: statusH },
          };
        });
      }, 300);
    } catch (error) {
      console.error('Error measuring targets:', error);
    }
  };

  const startOnboardingTour = useCallback(() => {
    setIsHubExpanded(true);
    setTourRequested(true);
    setTimeout(() => {
      measureAllTargets();
    }, 200);
  }, [insets.bottom]);

  // Check if first launch — only show the guidance tour once for brand new registered users, never on comeback/reinstall
  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(ONBOARDING_KEY).then(async (val) => {
      if (val) return; // Tour already seen

      // Check if user is a brand new user who just completed initial profile setup
      const isFreshSignup = await AsyncStorage.getItem('dme_is_fresh_signup');
      if (isFreshSignup === 'true') {
        await AsyncStorage.removeItem('dme_is_fresh_signup');
        startOnboardingTour();
      } else {
        // Returning user logging in on fresh install or comeback — suppress tour permanently
        await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      }
    });
  }, [user?.id, startOnboardingTour]);

  useEffect(() => {
    const replaySub = DeviceEventEmitter.addListener('replay_onboarding_tour', startOnboardingTour);
    return () => replaySub.remove();
  }, [startOnboardingTour]);



  const handleTourFinished = () => {
    setTourVisible(false);
    setTourRequested(false);
    AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  };

  // 1. Listen for the status tab's real position (sent from MainTabs)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('status_tab_measured', (data) => {
      setTourTargets(prev => ({
        ...prev,
        statusTab: { key: 'statusTab', x: data.x, y: data.y, width: data.width, height: data.height },
      }));
    });
    return () => sub.remove();
  }, []);

  // 2. Once all 5 targets are measured and tour was requested, show the tour
  useEffect(() => {
    const allReady = (['fab', 'trivia', 'play', 'statusTab'] as TourStepKey[]).every(k => tourTargets[k]);
    if (allReady && tourRequested) {
      setTourVisible(true);
      setTourRequested(false);
    }
  }, [tourTargets, tourRequested]);

  const handleDownloadUpdate = async (downloadUrl: string) => {
    try {
      setIsDownloadingUpdate(true);
      setDownloadProgress(0);
      await downloadAndInstallAPK(downloadUrl, (received, total) => {
        if (total > 0) {
          setDownloadProgress(Math.round((received / total) * 100));
        }
      });
    } catch (error) {
      console.error('Update download/install failed', error);
      Alert.alert('Update Failed', 'Failed to download or install the app update. Please try again.');
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  // ── Search bar pink glow border animation ─────────────────────────────
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchBarWidth, setSearchBarWidth] = useState(350);
  const borderTranslateX = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const translateAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const opacityAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const startSpinForward = () => {
    translateAnimRef.current?.stop();
    opacityAnimRef.current?.stop();
    borderTranslateX.setValue(0);

    translateAnimRef.current = Animated.timing(borderTranslateX, {
      toValue: -searchBarWidth,
      duration: 3000,
      useNativeDriver: true,
      easing: Easing.linear,
    });

    opacityAnimRef.current = Animated.timing(glowOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    });

    Animated.parallel([translateAnimRef.current, opacityAnimRef.current]).start();
  };

  const startSpinReverse = () => {
    translateAnimRef.current?.stop();
    opacityAnimRef.current?.stop();

    borderTranslateX.stopAnimation(current => {
      const duration = Math.abs(current) > 0 ? (Math.abs(current) / searchBarWidth) * 3000 : 0;

      translateAnimRef.current = Animated.timing(borderTranslateX, {
        toValue: 0,
        duration: duration,
        useNativeDriver: true,
        easing: Easing.linear,
      });

      opacityAnimRef.current = Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      });

      Animated.parallel([translateAnimRef.current, opacityAnimRef.current]).start();
    });
  };

  const [previewData, setPreviewData] = useState<{
    visible: boolean; uri: string | null; isGroup: boolean; displayName: string; sticker: string | null;
  }>({
    visible: false, uri: null, isGroup: false, displayName: '', sticker: null,
  });

  const pendingReloadRef = useRef(false);

  const loadConversations = useCallback(async () => {
    if (isLoadingRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    isLoadingRef.current = true;
    try {
      const [convs, statuses, msgReqs, friendReqs, friendsList] = await Promise.all([
        chatAPI.getConversations(),
        StatusService.getStatuses(),
        chatAPI.getMessageRequests(),
        chatAPI.getFriendRequests(),
        chatAPI.getFriends().catch(() => [])
      ]);
      let conversationsArray: Conversation[] = [];
      if (Array.isArray(convs)) conversationsArray = convs;
      else if (convs?.results) conversationsArray = convs.results;
      conversationsArray = conversationsArray.filter(c => !deletedConversationIdsRef.current.has(c.id));

      // Cache fresh data to local DB
      localDatabase.saveConversations(conversationsArray);

      const directUserIds = new Set(
        conversationsArray
          .filter(c => !c.is_group && c.other_user?.id)
          .map(c => c.other_user!.id)
      );
      setConversations(conversationsArray);
      if (Array.isArray(statuses) && user?.id) {
        setMyStatuses(statuses.filter((s: Status) => s.user_id === user.id));
      }
      setStatusGroups(StatusService.groupByUser(statuses.filter(s => s.user_id !== user?.id && directUserIds.has(s.user_id))));

      if (Array.isArray(msgReqs)) {
        setMessageRequests(msgReqs);
      }
      const receivedReqs = Array.isArray(friendReqs?.received) ? friendReqs.received : [];
      setFriendRequestsCount(receivedReqs.length);
      setFriends(Array.isArray(friendsList) ? friendsList : (friendsList?.results || []));
    } catch (e) {
      console.warn('Failed to load conversations', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isLoadingRef.current = false;
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        loadConversations();
      }
    }
  }, [user?.id]);

  // Initial load on mount and every time screen gains focus
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  // Instantly update last message preview and unread badge when a message arrives or is sent
  useEffect(() => {
    const handleUpdate = ({ conversationId, last_message }: { conversationId?: number; last_message?: any }) => {
      if (!conversationId || !last_message) return;
      const convId = Number(conversationId);
      const senderId = Number(last_message.sender_id || last_message.sender?.id || 0);
      const isIncoming = senderId !== Number(user?.id);
      const normalizedLastMessage = {
        id: Number(last_message.id) || Date.now(),
        content: String(last_message.content || ''),
        message_type: String(last_message.message_type || 'text'),
        created_at: last_message.created_at || new Date().toISOString(),
        sender_id: senderId,
        sender: last_message.sender,
      };

      setConversations(prev => {
        const existingIndex = prev.findIndex(c => c.id === convId);
        if (existingIndex !== -1) {
          const existing = prev[existingIndex];
          const updatedConv: Conversation = {
            ...existing,
            last_message: normalizedLastMessage as any,
            updated_at: last_message.created_at || new Date().toISOString(),
            unread_count: isIncoming ? (existing.unread_count || 0) + 1 : existing.unread_count,
          };
          const rest = prev.filter((_, idx) => idx !== existingIndex);
          return [updatedConv, ...rest];
        }
        return prev;
      });

      // Background sync to ensure full state, badges & requests are updated
      loadConversations();
    };

    const handleFriendUpdate = (data?: any) => {
      if (data?.action === 'sent') {
        setFriendRequestsCount(prev => prev + 1);
      } else if (data?.action === 'accepted' || data?.action === 'rejected' || data?.action === 'cancelled') {
        setFriendRequestsCount(prev => Math.max(0, prev - 1));
      }
      loadConversations();
    };

    const sub1 = DeviceEventEmitter.addListener('chat_list_update', handleUpdate);
    const sub2 = DeviceEventEmitter.addListener('local_message_sent', ({ conversationId, message }) => {
      handleUpdate({ conversationId, last_message: message });
    });
    const sub3 = DeviceEventEmitter.addListener('friend_request_updated', handleFriendUpdate);
    const sub4 = DeviceEventEmitter.addListener('friend_request_accepted', () => loadConversations());

    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      sub4.remove();
    };
  }, [user?.id, loadConversations]);

  // Connect to persistent global notification WebSocket stream for instant real-time updates
  useEffect(() => {
    if (user?.id) {
      websocketService.connectToNotifications().catch(err => {
        console.log('[ChatListScreen] Notification WS error:', err);
      });
    }

    const unsub = websocketService.onMessage((msg: WebSocketMessage) => {
      if (msg.type === 'new_message_summary' && msg.data) {
        const messageData = msg.data;
        const convId = Number(messageData.conversation_id || messageData.conversation);
        if (convId) {
          if (typingTimeoutsRef.current[convId]) {
            clearTimeout(typingTimeoutsRef.current[convId]);
            delete typingTimeoutsRef.current[convId];
          }
          setTypingMap(prev => {
            if (!prev[convId]) return prev;
            const next = { ...prev };
            delete next[convId];
            return next;
          });

          const senderId = Number(messageData.sender?.id || messageData.sender_id || 0);
          const isIncoming = senderId !== Number(user?.id);
          const last_message = {
            id: Number(messageData.id) || Date.now(),
            content: String(messageData.content || ''),
            message_type: String(messageData.message_type || 'text'),
            created_at: messageData.created_at || new Date().toISOString(),
            sender_id: senderId,
            sender: messageData.sender,
          };

          setConversations(prev => {
            const existingIndex = prev.findIndex(c => c.id === convId);
            if (existingIndex !== -1) {
              const existing = prev[existingIndex];
              const updatedConv: Conversation = {
                ...existing,
                last_message: last_message as any,
                updated_at: last_message.created_at,
                unread_count: isIncoming ? (existing.unread_count || 0) + 1 : existing.unread_count,
              };
              const rest = prev.filter((_, idx) => idx !== existingIndex);
              return [updatedConv, ...rest];
            }
            return prev;
          });

          // Sync fresh data from API
          loadConversations();
        }
      } else if (
        msg.type === 'read_receipt' ||
        msg.type === 'delivered' ||
        msg.type === 'message_request_created' ||
        msg.type === 'message_request_status' ||
        msg.type === 'friend_request_update' ||
        msg.type === 'friend_request_updated'
      ) {
        if (msg.type === 'friend_request_update' || msg.type === 'friend_request_updated') {
          const action = msg.data?.action;
          if (action === 'sent') {
            setFriendRequestsCount(prev => prev + 1);
          } else if (action === 'accepted' || action === 'rejected' || action === 'cancelled') {
            setFriendRequestsCount(prev => Math.max(0, prev - 1));
          }
        }
        loadConversations();
      } else if (msg.type === 'typing' && msg.data) {
        console.log('[ChatListScreen] Typing WS message received:', msg.data);
        const convId = Number(msg.data.conversation_id);
        const senderId = Number(msg.data.user_id || 0);
        const isTyping = Boolean(msg.data.is_typing);
        const userName = msg.data.user_name || 'Someone';

        if (convId && (!senderId || senderId !== Number(user?.id))) {
          if (typingTimeoutsRef.current[convId]) {
            clearTimeout(typingTimeoutsRef.current[convId]);
            delete typingTimeoutsRef.current[convId];
          }

          if (isTyping) {
            setTypingMap(prev => ({ ...prev, [convId]: userName }));
            typingTimeoutsRef.current[convId] = setTimeout(() => {
              setTypingMap(prev => {
                if (!prev[convId]) return prev;
                const next = { ...prev };
                delete next[convId];
                return next;
              });
              delete typingTimeoutsRef.current[convId];
            }, 3500);
          } else {
            setTypingMap(prev => {
              if (!prev[convId]) return prev;
              const next = { ...prev };
              delete next[convId];
              return next;
            });
          }
        }
      }
    });

    return () => {
      unsub();
    };
  }, [user?.id, loadConversations]);

  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const searchRef = useRef<TextInput>(null);
  const userTouchedSearch = useRef(false);

  // ── Auto-reset countdown after 1 s of idle typing ───────────────────────────
  const [countdownActive, setCountdownActive] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdown = () => {
    setCountdownActive(false);
    setCountdownValue(3);
    if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  };

  const startCountdown = () => {
  };

  useEffect(() => {
    const tabParam = route?.params?.initialTab || route?.params?.tab;
    if (tabParam && ['all', 'groups', 'pending'].includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [route?.params?.initialTab, route?.params?.tab]);

  const handleLogout = () => {
    setLogoutModalVisible(true);
  };

  const handleConfirmLogout = async () => {
    try {
      setIsLoggingOut(true);
      setIsLockedAuthenticated(false);
      setLockedIds([]);
      setActiveTab('all');
      await logout();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setIsLoggingOut(false);
      setLogoutModalVisible(false);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Chats',
      'Are you sure you want to delete all conversations?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await chatAPI.deleteAllConversations();
              loadConversations();
              Toast.show({ type: 'success', text1: 'All chats cleared' });
            } catch (error) {
              Alert.alert('Error', 'Failed to clear chats');
            }
          } 
        },
      ]
    );
  };

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const toggleDropdown = useCallback(() => {
    LayoutAnimation.configureNext(fluidDropdownAnimation);
    const nextState = !isDropdownOpen;
    setIsDropdownOpen(nextState);
    Animated.timing(chevronAnim, {
      toValue: nextState ? 1 : 0,
      duration: 220,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [isDropdownOpen, chevronAnim]);

  const handleCancelDropdown = useCallback(() => {
    LayoutAnimation.configureNext(fluidDropdownAnimation);
    setIsDropdownOpen(false);
    Animated.timing(chevronAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
    setActiveTab('all');
  }, [chevronAnim]);

  // ── Center-screen animated modal toast (matching friend request style) ─────
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastIcon, setToastIcon] = useState('checkmark-circle');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((message: string, icon: string = 'checkmark-circle') => {
    setToastMessage(message);
    setToastIcon(icon);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  }, [toastOpacity]);

  const handleLockedTabPress = async () => {
    // If no chats are locked in the vault, mute the action and do not open PIN modal
    if (lockedIds.length === 0) {
      showToast('No locked chats', 'lock-closed');
      return;
    }

    if (activeTab === 'locked') {
      setActiveTab('all');
      return;
    }

    if (isLockedAuthenticated) {
      setActiveTab('locked');
      return;
    }

    const hasPin = await BiometricService.hasPin(user?.id);
    setPinModalMode(hasPin ? 'verify' : 'setup');
    setPendingActionAfterPin(() => () => {
      setIsLockedAuthenticated(true);
      setActiveTab('locked');
    });
    setPinModalVisible(true);
  };

  const handlePinSuccess = () => {
    setPinModalVisible(false);
    if (pendingActionAfterPin) {
      pendingActionAfterPin();
      setPendingActionAfterPin(null);
    }
  };

  // Auto-relock when app is backgrounded or minimized; reload conversations when active
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'background' || nextState === 'inactive') {
        setIsLockedAuthenticated(false);
        setActiveTab(prev => (prev === 'locked' ? 'all' : prev));
      } else if (nextState === 'active') {
        loadConversations();
      }
    });
    return () => sub.remove();
  }, [loadConversations]);

  // Guard: Never allow activeTab === 'locked' if user is not authenticated for locked chats
  useEffect(() => {
    if (activeTab === 'locked' && !isLockedAuthenticated) {
      setActiveTab('all');
    }
  }, [activeTab, isLockedAuthenticated]);

  // Guard: If activeTab === 'locked' but there are no locked chats, revert to 'all'
  useEffect(() => {
    if (activeTab === 'locked' && lockedIds.length === 0) {
      setActiveTab('all');
    }
  }, [activeTab, lockedIds.length]);

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBatchToggleLock = async () => {
    if (selectedIds.length === 0) return;

    const allLocked = selectedIds.every(id => lockedIds.includes(id));
    const newLockState = !allLocked;

    const executeLockToggle = async () => {
      const currentLocked = await BiometricService.getPersistedLockedChatIds(user?.id);
      let updated: number[];
      if (newLockState) {
        updated = Array.from(new Set([...currentLocked, ...selectedIds]));
      } else {
        updated = currentLocked.filter(id => !selectedIds.includes(id));
      }

      await BiometricService.setPersistedLockedChatIds(user?.id, updated);
      setLockedIds(updated);
      setSelectionMode(false);
      setSelectedIds([]);
      loadConversations();

      showToast(newLockState ? 'Chat Locked' : 'Chat Unlocked', newLockState ? 'lock-closed' : 'lock-open');
    };

    const hasPin = await BiometricService.hasPin(user?.id);
    setPinModalMode(hasPin ? 'verify' : 'setup');
    setPendingActionAfterPin(() => executeLockToggle);
    setPinModalVisible(true);
  };

  const handleBatchDelete = async () => {
    Alert.alert('Delete Selected', `Delete ${selectedIds.length} chats?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await Promise.all(selectedIds.map(id => chatAPI.deleteConversation(id)));
            setSelectionMode(false);
            setSelectedIds([]);
            loadConversations();
          } catch (error) { Alert.alert('Error', 'Failed to delete'); }
      }}
    ]);
  };

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: {
        backgroundColor: selectionMode 
          ? (isDark ? '#0F172A' : '#0B192C') 
          : theme.surface,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: 0,
      },
      headerTitleAlign: 'center',
      headerTitle: () => {
        if (selectionMode) return null;
        const brandTextStyle = {
          fontFamily: 'Poppins-Bold',
          fontSize: 22,
          fontWeight: 900,
          color: isDark ? '#FFFFFF' : '#0F172A',
          letterSpacing: 1.2,
          includeFontPadding: false,
          textShadowColor: 'rgba(0, 0, 0, 0.75)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 1,
        };
        return (
          <View
            accessible={true}
            accessibilityRole="header"
            accessibilityLabel="YOUTELITE"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={brandTextStyle}>YOUT</Text>
            <Text style={[brandTextStyle, { marginHorizontal: 1.4 }]}>E</Text>
            <Text style={brandTextStyle}>LITE</Text>
          </View>
        );
      },
      headerLeft: () => (
        selectionMode ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16 }}>
            <TouchableOpacity
              onPress={() => { setSelectionMode(false); setSelectedIds([]); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
              style={{ padding: 4 }}
            >
              <Icon name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#FFFFFF', marginLeft: 12 }}>
              {selectedIds.length} Selected
            </Text>
          </View>
        ) : (
          <View style={{ width: 125, flexDirection: 'row', alignItems: 'center', paddingLeft: 24 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Profile"
              accessibilityRole="button"
            >
              <Icon name="create-outline" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
          </View>
        )
      ),
      headerRight: () => (
        selectionMode ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 14 }}>
            {/* Lock / Unlock Pill with Vector Icon */}
            <TouchableOpacity
              style={[s.headerPillBtn, selectedIds.length === 0 && { opacity: 0.5 }]}
              onPress={handleBatchToggleLock}
              disabled={selectedIds.length === 0}
              activeOpacity={0.7}
            >
              <Icon
                name={selectedIds.every(id => lockedIds.includes(id)) ? 'lock-open' : 'lock-closed'}
                size={13}
                color="#FFFFFF"
                style={{ marginRight: 4 }}
              />
              <Text style={s.headerPillBtnText}>
                {selectedIds.every(id => lockedIds.includes(id)) ? 'Unlock' : 'Lock'}
              </Text>
            </TouchableOpacity>

            {/* Delete Pill */}
            <TouchableOpacity
              style={[s.headerDeletePillBtn, selectedIds.length === 0 && { opacity: 0.5 }]}
              onPress={handleBatchDelete}
              disabled={selectedIds.length === 0}
              activeOpacity={0.7}
            >
              <Icon
                name="trash-outline"
                size={13}
                color="#FFFFFF"
                style={{ marginRight: 4 }}
              />
              <Text style={s.headerDeletePillBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 125, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 18 }}>
            <View ref={menuBtnRef} collapsable={false}>
              <TouchableOpacity
                onPress={() => setMenuVisible(true)}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="menu" size={26} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        )
      ),
    });
  }, [navigation, selectionMode, selectedIds, handleBatchDelete, activeRoomCode, isMusicPlaying, spin, isDark, theme, user, friendRequestsCount]);

  const handleShareApp = async () => {
    try {
      const shareUrl = 'https://dme-19zq.onrender.com/invite';
      await Share.share({
        message: `Join me on youtelite! It's a fast, secured messaging app with Learn and Watch together. Download it here: ${shareUrl}`,
      });
    } catch (error) {
      console.warn('Error sharing app', error);
    }
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      await chatAPI.acceptMessageRequest(requestId);
      showToast('Message request accepted', 'checkmark-circle');
      loadConversations();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to accept message request');
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      showToast('Message request declined', 'close-circle');
      loadConversations();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to decline message request');
    }
  };

  // Count of 1-to-1 conversations visible in "All Messages" list that have unseen messages
  const unreadDirectChatsCount = conversations.filter(c => {
    if (c.is_group || lockedIds.includes(c.id) || (c.unread_count || 0) <= 0) return false;
    if (c.last_message === null) return false;
    const reqStatus = (c as any).message_request_status;
    const senderId = (c as any).message_request_sender_id;
    if (reqStatus === 'pending' || reqStatus === 'rejected') {
      const isFriend = c.other_user
        ? friends.some((f: any) => f.id === c.other_user?.id || String(f.id) === String(c.other_user?.id))
        : false;
      if (senderId !== user?.id && !isFriend) return false;
    }
    return true;
  }).length;

  // Count of group conversations in "Groups" list that have unseen messages (how many unseen groups)
  const unreadGroupsCount = conversations.filter(
    c => c.is_group && !lockedIds.includes(c.id) && (c.unread_count || 0) > 0
  ).length;

  // Overall count of unseen conversation items in "All Messages" list (not sum of all messages)
  const unreadAllCount = unreadDirectChatsCount + unreadGroupsCount;

  // Count of locked conversations that have unseen messages
  const unreadLockedCount = conversations.filter(
    c => lockedIds.includes(c.id) && (c.unread_count || 0) > 0
  ).length;

  const filteredConversations = conversations.filter(c => {
    let matchesTab = true;
    
    // Filter out 1-to-1 chats with no messages (groups always stay visible)
    if (!c.is_group && c.last_message === null) {
      return false;
    }
    // Hide incoming pending or rejected message requests from User B's Chats/All list
    if (!c.is_group && (c.message_request_status === 'pending' || c.message_request_status === 'rejected')) {
      const isFriend = c.other_user ? friends.some((f: any) => f.id === c.other_user?.id || String(f.id) === String(c.other_user?.id)) : false;
      if (c.message_request_sender_id !== user?.id && !isFriend) {
        return false;
      }
    }

    const isLocked = lockedIds.includes(c.id);

    if (activeTab === 'locked') {
      if (!isLocked) return false;
      matchesTab = true;
    } else {
      if (isLocked) return false;

      if (activeTab === 'friends') {
        const isFriend = c.other_user ? friends.some((f: any) => f.id === c.other_user?.id || String(f.id) === String(c.other_user?.id)) : false;
        matchesTab = !c.is_group && isFriend;
      } else if (activeTab === 'groups') {
        matchesTab = c.is_group;
      } else if (activeTab === 'pending') {
        return false;
      } else if (activeTab === 'all') {
        matchesTab = true;
      }
    }
    if (!matchesTab) return false;
    
    if (searchQuery.trim()) {
      const displayName = c.is_group 
        ? (c.name || 'Group') 
        : (c.other_user?.display_name || c.other_user?.email || 'User');
      return displayName.toLowerCase().startsWith(searchQuery.trim().toLowerCase());
    }
    return true;
  });

  const pendingRequestsCount = messageRequests.filter(mr => {
    const isFriend = mr.sender ? friends.some((f: any) => f.id === mr.sender?.id || String(f.id) === String(mr.sender?.id)) : false;
    return !isFriend;
  }).length;

  let listData: any[] = [];
  if (activeTab === 'pending') {
    const filteredRequests = messageRequests.filter(mr => {
      const isFriend = mr.sender ? friends.some((f: any) => f.id === mr.sender?.id || String(f.id) === String(mr.sender?.id)) : false;
      if (isFriend) return false;

      if (!searchQuery.trim()) return true;
      const reqSender = mr.sender;
      const displayName = reqSender?.display_name || reqSender?.email || 'User';
      return displayName.toLowerCase().startsWith(searchQuery.trim().toLowerCase());
    });
    listData = filteredRequests.map(mr => ({
      ...mr,
      isMessageRequest: true,
    }));
  } else {
    listData = [...filteredConversations];
  }

  return (
    <View 
      style={s.container}
      onLayout={(e) => {
        const { height } = e.nativeEvent.layout;
        const windowHeight = Dimensions.get('window').height;
        // Ignore layout updates caused by keyboard animations (which shrink the screen heavily).
        // Only accept heights that are near the full window height (accounting for headers/tabs).
        if (height > windowHeight - 250) {
          if (!containerHeight || Math.abs(containerHeight - height) > 1) {
            setContainerHeight(height);
          }
        }
      }}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
      <PopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
        onShareApp={handleShareApp}
        onNewGroup={() => { setMenuVisible(false); navigation.navigate('CreateGroup'); }}
        onClearAll={() => { setMenuVisible(false); handleClearAll(); }}
        onProfile={() => { setMenuVisible(false); navigation.navigate('Profile'); }}        
        onLogout={() => { setMenuVisible(false); handleLogout(); }}
        onSelect={() => { setMenuVisible(false); setSelectionMode(true); }}
        onChatBackup={async () => {
          setMenuVisible(false);
          try {
            const status = await BackupManager.checkServerBackupStatus();
            if (status.hasBackup) {
              Alert.alert(
                'E2EE Chat Backup',
                'You have an active encrypted backup in the cloud. What would you like to do?',
                [
                  {
                    text: 'Restore Chats',
                    onPress: () => setRestoreModalVisible(true),
                  },
                  {
                    text: 'Create New Backup',
                    onPress: () => setBackupSetupModalVisible(true),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            } else {
              setBackupSetupModalVisible(true);
            }
          } catch {
            setBackupSetupModalVisible(true);
          }
        }}
        onAppTour={startOnboardingTour}
        onSettings={() => {
          setMenuVisible(false);
          navigation.navigate('Settings');
        }}
        onAppUpdate={() => {
          setMenuVisible(false);
          if (updateInfo.hasUpdate && updateInfo.downloadUrl) {
            handleDownloadUpdate(updateInfo.downloadUrl);
          } else {
            Alert.alert('App Update', 'You are on the latest version of youtelite.');
          }
        }}
      />
      <LogoutConfirmationModal
        visible={logoutModalVisible}
        onClose={() => setLogoutModalVisible(false)}
        onConfirm={handleConfirmLogout}
        loading={isLoggingOut}
      />
      <ChatLockPinModal
        visible={pinModalVisible}
        mode={pinModalMode}
        userId={user?.id}
        onSuccess={handlePinSuccess}
        onCancel={() => {
          setPinModalVisible(false);
          setPendingActionAfterPin(null);
        }}
      />
      <BackupRestoreModal
        visible={restoreModalVisible}
        onSuccess={async () => {
          setRestoreModalVisible(false);
          await loadConversations();
        }}
        onSkip={async () => {
          setRestoreModalVisible(false);
          await KeyManager.ensureKeysSetup(true);
          await loadConversations();
        }}
      />
      <BackupSetupModal
        visible={backupSetupModalVisible}
        onClose={() => setBackupSetupModalVisible(false)}
        onSuccess={() => {
          setBackupSetupModalVisible(false);
        }}
      />
      <Modal visible={isDownloadingUpdate} transparent animationType="fade">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <View style={{
            width: 280,
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: 24,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5,
          }}>
            <ActivityIndicator size="large" color="#4597f5f6" style={{ marginBottom: 16 }} />
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 8 }}>
              Downloading Update
            </Text>
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 16, textAlign: 'center' }}>
              Please wait while the new version is being downloaded...
            </Text>
            <View style={{
              width: '100%',
              height: 6,
              backgroundColor: '#eee',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 8,
            }}>
              <View style={{
                width: `${downloadProgress}%`,
                height: '100%',
                backgroundColor: '#4597f5f6',
              }} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#4597f5f6' }}>
              {downloadProgress}%
            </Text>
          </View>
        </View>
      </Modal>

      {/* ── Top Action Row (Profile Story Circle on Left, Horizontal Disco & Trivia Dock on Right) ── */}
      <View style={s.topActionRow}>
        {/* Left: Profile with dynamic Status border or plain circle, and + badge */}
        <View style={s.profileStoryContainer}>
          <TouchableOpacity
            onPress={handleProfileAvatarPress}
            activeOpacity={0.85}
            accessibilityLabel={myStatuses.length > 0 ? "View my status" : "My Profile"}
          >
            {myStatuses.length > 0 ? (
              /* Outer border with combination logo colors (Cobalt Blue -> Cyan -> Emerald) */
              <LinearGradient
                colors={['#0F62FE', '#00E5FF', '#10B981']}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={s.storyCircleGradient}
              >
                <View style={s.storyCircleInner}>
                  <AvatarWithFallback
                    uri={user?.profile_picture}
                    sticker={user?.avatar_sticker}
                    displayName={user?.display_name || user?.username || user?.email || 'User'}
                    style={s.storyAvatar}
                  />
                </View>
              </LinearGradient>
            ) : (
              /* Plain circle with no outer border */
              <View style={s.plainProfileCircle}>
                <AvatarWithFallback
                  uri={user?.profile_picture}
                  sticker={user?.avatar_sticker}
                  displayName={user?.display_name || user?.username || user?.email || 'User'}
                  style={s.plainAvatar}
                />
              </View>
            )}
          </TouchableOpacity>

          {/* + circle at bottom right edge of circle to upload status */}
          <TouchableOpacity
            style={[s.addStatusBadge, { borderColor: theme.surface }]}
            onPress={handleUploadStatus}
            activeOpacity={0.85}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Upload status"
          >
            <View style={s.addStatusBadgeGradient}>
              <Icon name="add" size={15} color="#000000" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Center: Friend List Button between Profile and Book */}
        <View ref={fabRef} collapsable={false}>
          <TouchableOpacity
            onPress={() => {
              if (friendRequestsCount > 0) {
                navigation.navigate('FriendList', { initialTab: 'approve' });
              } else {
                navigation.navigate('FriendList', { initialTab: 'friends' });
              }
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.friendBtnRow}
            accessibilityLabel="Friend List"
          >
            <Icon name="people" size={34} color={isDark ? '#94A3B8' : '#64748B'} />
            {friendRequestsCount > 0 && (
              <View style={s.headerFriendBadge}>
                <Text style={s.headerFriendBadgeText}>
                  {friendRequestsCount > 99 ? '99+' : friendRequestsCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Right: Book Button (Knowledge Quest) without outer container and without inner circle */}
        <View ref={triviaBtnRef} collapsable={false}>
          <TouchableOpacity
            onPress={() => navigation.navigate('TriviaHub')}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={s.bookButtonPlain}
            accessibilityLabel="Q-Zone"
          >
            <View pointerEvents="none">
              <LottieStickerMessage
                url="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4da/lottie.json"
                size={50}
                autoPlay={false}
              />
            </View>
          </TouchableOpacity>
        </View>
      </View>
      <View
        style={{ paddingHorizontal: 16, paddingBottom: 4, paddingTop: 4, backgroundColor: theme.surface }}
        onTouchStart={() => { userTouchedSearch.current = true; }}
      >
        {/* ── Search bar with rotating pink glow border ── */}
        <View 
          focusable={true}
          focusableInTouchMode={true}
          onLayout={e => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && w !== searchBarWidth) {
              setSearchBarWidth(w);
            }
          }}
          style={{ borderRadius: 24, overflow: 'hidden' }}
        >
          <LinearGradient
            colors={isSearchFocused ? ['#424242f6', '#4597f5f6'] : [theme.inputBackground, theme.inputBackground]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          {/* Sliding pink glow overlay — visible and animates only when focused */}
          {isSearchFocused && (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: searchBarWidth * 2,
                  opacity: glowOpacity,
                },
                { transform: [{ translateX: borderTranslateX }] },
              ]}
            >
              <LinearGradient
                colors={['#FF1493', '#FF69B4', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: '100%', height: '100%' }}
              />
            </Animated.View>
          )}
          {/* White input box when focused (sits 1.5px inset), otherwise matches light-grey pill shape */}
          <View style={{
            margin: 1.5,
            borderRadius: 22.5,
            backgroundColor: isSearchFocused ? theme.surface : theme.inputBackground,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
          }}>
            <Icon name="search" size={20} color={isSearchFocused ? '#FF1493' : '#888'} />
            <TextInput
              ref={searchRef}
              style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 16, color: theme.inputText }}
              placeholder="Search by name..."
              placeholderTextColor={theme.placeholder || "#888"}
              value={searchQuery}
              caretHidden={!isSearchFocused}
              onChangeText={v => {
                setSearchQuery(v);
                if (countdownActive) clearCountdown();
              }}
              onFocus={() => {
                if (!userTouchedSearch.current) {
                  // Android auto-assigned focus — reject it immediately
                  searchRef.current?.blur();
                  return;
                }
                setIsSearchFocused(true);
                startSpinForward();
                setIsKeyboardActive(true);
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsHubExpanded(false);
              }}
              onBlur={() => {
                setIsSearchFocused(false);
                startSpinReverse();
                setIsKeyboardActive(false);
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsHubExpanded(true);
              }}
            />
            {searchQuery.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {countdownActive && (
                  <View style={{
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: '#cccccc',
                    justifyContent: 'center', alignItems: 'center',
                  }}>
                    <Text style={{ color: '#222', fontSize: 11, fontWeight: '700' }}>{countdownValue}s</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => { clearCountdown(); setSearchQuery(''); }}>
                  <Icon name="close-circle" size={20} color="#888" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>

      <FlatList
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        ListHeaderComponent={
          <View style={[s.tabContainerWrapper, { backgroundColor: theme.surface }]}>
            {/* ── 2 Visible Main Tabs: All & Groups ── */}
            <View style={s.tabContainer}>
              <View style={s.tabsGroupRow}>
                {/* All Tab */}
                <TouchableOpacity
                  style={[
                    s.mainTabPill,
                    activeTab === 'all' && s.mainTabPillActive,
                  ]}
                  onPress={() => {
                    if (isDropdownOpen) setIsDropdownOpen(false);
                    setActiveTab('all');
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      s.mainTabPillText,
                      activeTab === 'all' ? s.mainTabPillTextActive : s.mainTabPillTextInactive,
                    ]}
                  >
                    All Messages
                  </Text>
                  {unreadAllCount > 0 && (
                    <View style={s.mainTabBadge}>
                      <Text style={s.mainTabBadgeText}>{unreadAllCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Groups Tab */}
                <TouchableOpacity
                  style={[
                    s.mainTabPill,
                    activeTab === 'groups' && s.mainTabPillActive,
                  ]}
                  onPress={() => {
                    if (isDropdownOpen) setIsDropdownOpen(false);
                    setActiveTab('groups');
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      s.mainTabPillText,
                      activeTab === 'groups' ? s.mainTabPillTextActive : s.mainTabPillTextInactive,
                    ]}
                  >
                    Groups
                  </Text>
                  {unreadGroupsCount > 0 && (
                    <View style={s.mainTabBadge}>
                      <Text style={s.mainTabBadgeText}>{unreadGroupsCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              {/* ── Dropdown / Close Toggle Button in Right Corner ── */}
              <TouchableOpacity
                style={[
                  s.dropdownToggleBtn,
                  isDropdownOpen && s.dropdownToggleBtnActive,
                ]}
                onPress={isDropdownOpen ? handleCancelDropdown : toggleDropdown}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Animated.View style={{ transform: [{ rotate: arrowRotation }] }}>
                  <Icon
                    name="chevron-down"
                    size={18}
                    color={isDark ? (isDropdownOpen ? '#38BDF8' : '#94A3B8') : (isDropdownOpen ? '#0EA5E9' : '#64748B')}
                  />
                </Animated.View>
                {!isDropdownOpen && (unreadLockedCount > 0 || pendingRequestsCount > 0) && (
                  <View style={s.dropdownGlowWrapper}>
                    <View style={s.dropdownGlowHalo} />
                    <View style={s.dropdownBadgeDot} />
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* ── Collapsible Sub-Drawer: Right-aligned [ Locked ] [ Pending ] ── */}
            {isDropdownOpen && (
              <View style={s.subDrawerContainer}>
                <View style={s.subDrawerRightGroup}>
                  {/* Locked Tab */}
                  <TouchableOpacity
                    style={[
                      s.subDrawerTabBtn,
                      activeTab === 'locked' && s.subDrawerTabBtnActive,
                      lockedIds.length === 0 && s.subDrawerTabBtnMuted,
                    ]}
                    onPress={handleLockedTabPress}
                    activeOpacity={lockedIds.length === 0 ? 0.9 : 0.7}
                  >
                    <Icon
                      name={activeTab === 'locked' && isLockedAuthenticated ? 'lock-open-outline' : 'lock-closed'}
                      size={13}
                      color={
                        lockedIds.length === 0
                          ? (isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.45)')
                          : activeTab === 'locked'
                          ? (isDark ? '#38BDF8' : '#0B192C')
                          : (isDark ? '#94A3B8' : '#64748B')
                      }
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        s.subDrawerTabText,
                        lockedIds.length === 0
                          ? s.subDrawerTabTextMuted
                          : activeTab === 'locked'
                          ? s.subDrawerTabTextActive
                          : s.subDrawerTabTextInactive,
                      ]}
                    >
                      Locked
                    </Text>
                    {unreadLockedCount > 0 && (
                      <View style={[s.drawerBadge, s.drawerBadgeActive]}>
                        <Text style={s.drawerBadgeText}>{unreadLockedCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Pending Tab */}
                  <TouchableOpacity
                    style={[
                      s.subDrawerTabBtn,
                      activeTab === 'pending' && s.subDrawerTabBtnActive,
                    ]}
                    onPress={() => setActiveTab(activeTab === 'pending' ? 'all' : 'pending')}
                    activeOpacity={0.7}
                  >
                    <Icon
                      name="time-outline"
                      size={13}
                      color={activeTab === 'pending' ? (isDark ? '#38BDF8' : '#0B192C') : (isDark ? '#94A3B8' : '#64748B')}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        s.subDrawerTabText,
                        activeTab === 'pending' ? s.subDrawerTabTextActive : s.subDrawerTabTextInactive,
                      ]}
                    >
                      Pending
                    </Text>
                    {pendingRequestsCount > 0 && (
                      <View style={[s.drawerBadge, activeTab === 'pending' ? s.drawerBadgeActive : s.drawerBadgeInactive]}>
                        <Text style={s.drawerBadgeText}>{pendingRequestsCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        }

        data={listData}
        extraData={typingMap}
        windowSize={7}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={50}
        initialNumToRender={12}
        removeClippedSubviews={true}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 86, 116) }}
        renderItem={({ item }) => {
          if ((item as any).isMessageRequest) {
            const reqSender = item.sender;
            const displayName = reqSender?.display_name || reqSender?.username || reqSender?.email || 'User';
            const lastMsg = item.conversation_detail?.last_message;
            const lastMsgContent = lastMsg ? renderLastMessageContent(lastMsg) : 'Sent you a message request';
            const lastMsgTime = lastMsg ? formatMessageTime(lastMsg.created_at) : '';

            const convId = item.conversation || item.conversation_id;

            return (
              <TouchableOpacity
                style={s.conversationItem}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => {
                  if (convId) {
                    navigateToChatRoom({ 
                      conversationId: Number(convId),
                      name: displayName,
                      avatarUri: reqSender?.profile_picture,
                      avatarSticker: reqSender?.avatar_sticker,
                      isGroup: false,
                      otherUser: reqSender,
                      messageRequestStatus: item.status || 'pending',
                      messageRequestSenderId: reqSender?.id,
                    });
                  }
                }}
              >
                <AvatarWithFallback
                  uri={reqSender?.profile_picture}
                  sticker={reqSender?.avatar_sticker}
                  displayName={displayName}
                  style={s.avatar}
                />
                <View style={s.content}>
                  <Text style={s.name}>{displayName}</Text>
                  <Text style={s.lastMessage} numberOfLines={1}>
                    {lastMsgContent}
                  </Text>
                </View>
                                <View style={[s.rightContent, { flexDirection: 'row', alignItems: 'center' }]}>
                  {lastMsgTime ? <Text style={[s.time, { marginRight: 8 }]}>{lastMsgTime}</Text> : null}
                  {item.status === 'pending' ? (
                    <>
                      <TouchableOpacity
                        style={[s.smallBtn, { backgroundColor: '#fff', marginRight: 6 }]}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          handleAcceptRequest(item.id);
                        }}>
                        <Icon name="checkmark" size={14} color="#000" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.smallBtn, { backgroundColor: '#fff' }]}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          handleRejectRequest(item.id);
                        }}>
                        <Icon name="close" size={14} color="#000" />
                      </TouchableOpacity>
                    </>
                  ) : item.status === 'rejected' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ color: '#f00', marginRight: 8, fontSize: 12 }}>
                        Request rejected. You can accept to continue chatting.
                      </Text>
                      <TouchableOpacity
                        style={[s.smallBtn, { backgroundColor: '#fff' }]}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          handleAcceptRequest(item.id);
                        }}>
                        <Icon name="checkmark" size={14} color="#000" />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }

          if ((item as any).isVirtual) {
            // Virtual rows removed — no-op guard kept for safety
            return null;
          }

          const isSelected = selectedIds.includes(item.id);
          const userId = item.is_group ? null : item.other_user?.id;
          const statusGroup = userId ? statusGroups.find(g => g.user_id === userId) : null;
          const userStatuses = statusGroup ? statusGroup.statuses : [];

          return (
            <ConversationItemRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              selectionMode={selectionMode}
              statusGroups={statusGroups}
              friends={friends}
              user={user}
              theme={theme}
              isDark={isDark}
              s={s}
              typingUserName={typingMap[item.id] || null}
              onPress={() => {
                if (selectionMode) {
                  toggleSelection(item.id);
                } else {
                  navigateToChatRoom({ 
                    conversationId: item.id, 
                    name: item.is_group ? (item.name || 'Group') : (item.other_user?.display_name || 'User'),
                    avatarUri: item.is_group ? item.profile_picture : item.other_user?.profile_picture,
                    avatarSticker: item.is_group ? null : item.other_user?.avatar_sticker,
                    isGroup: item.is_group,
                    otherUser: item.is_group ? null : item.other_user,
                  });
                }
              }}
              onLongPress={() => {
                if (!selectionMode) {
                  setSelectionMode(true);
                  toggleSelection(item.id);
                }
              }}
              onAvatarPress={() => {
                const userId = item.is_group ? null : item.other_user?.id;
                const statusGroup = userId ? statusGroups.find(g => g.user_id === userId) : null;
                const userStatuses = statusGroup ? statusGroup.statuses : [];
                const isFriend = userId ? friends.some((f: any) => f.id === userId || String(f.id) === String(userId)) : false;
                const hasStatus = isFriend && userStatuses && userStatuses.length > 0;
                if (hasStatus) {
                  navigation.navigate('StatusViewer', {
                    statuses: userStatuses,
                    initialIndex: 0,
                  });
                } else {
                  setPreviewData({
                    visible: true,
                    uri: item.is_group ? item.profile_picture : item.other_user?.profile_picture,
                    isGroup: item.is_group,
                    displayName: item.is_group 
                      ? (item.name || 'Group') 
                      : (item.other_user?.display_name || item.other_user?.email || 'User'),
                    sticker: item.is_group ? null : item.other_user?.avatar_sticker,
                  });
                }
              }}
            />
          );
        }}
        keyExtractor={(item) => item.id.toString()}
        extraData={conversations}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadConversations} tintColor={THEME_COLOR} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 85 }}>
              <Icon 
                name={
                  activeTab === 'locked'
                    ? 'lock-closed-outline'
                    : activeTab === 'pending'
                    ? 'mail-unread-outline'
                    : activeTab === 'groups' 
                    ? 'people-outline' 
                    : activeTab === 'friends' 
                    ? 'person-outline' 
                    : 'chatbubble-ellipses-outline'
                } 
                size={48} 
                color={isDark ? '#4A4A4D' : '#D0C8E0'} 
              />
              <Text style={{ fontSize: 17, fontWeight: '600', color: theme.textPrimary, marginTop: 12, textAlign: 'center' }}>
                {activeTab === 'locked'
                  ? 'No locked chats'
                  : activeTab === 'pending'
                  ? 'No pending requests'
                  : activeTab === 'groups' 
                  ? 'No groups yet' 
                  : activeTab === 'friends'
                  ? 'No friend chats yet'
                  : 'No conversations yet'}
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 4, textAlign: 'center' }}>
                {activeTab === 'locked'
                  ? 'Select chats and tap Lock to store them securely'
                  : activeTab === 'pending'
                  ? 'Message and friend requests will appear here'
                  : activeTab === 'groups'
                  ? 'Group chats you join will appear here'
                  : activeTab === 'friends'
                  ? 'Chats with your friends will appear here'
                  : 'Tap the Friends icon above to start chatting'}
              </Text>
              {(activeTab === 'all' || activeTab === 'friends') && (
                <TouchableOpacity
                  onPress={() => navigation.navigate('FriendList', { initialTab: 'friends' })}
                  activeOpacity={0.85}
                  style={{
                    marginTop: 18,
                    borderRadius: 24,
                    overflow: 'hidden',
                    elevation: 5,
                    shadowColor: '#0F62FE',
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.35,
                    shadowRadius: 6,
                  }}
                >
                  <LinearGradient
                    colors={['#0F62FE', '#00D2FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      paddingHorizontal: 22,
                      paddingVertical: 11,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Icon name="people" size={18} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>Start a Chat</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />
      <Modal visible={previewData.visible} transparent={true} animationType="none">
        <TouchableOpacity 
          style={s.modalOverlay} 
          onPress={() => setPreviewData(p => ({ ...p, visible: false }))}
          activeOpacity={1}
        >
            <View style={s.previewContainer}>
                <AvatarWithFallback
                    uri={previewData.uri}
                    sticker={previewData.sticker}
                    displayName={previewData.displayName}
                    isGroup={previewData.isGroup}
                    style={s.previewImage}
                />
                <Text style={s.previewName}>{String(previewData.displayName || '')}</Text>
            </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Center-screen animated modal toast (matching friend request) ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.toastOverlay} pointerEvents="none">
          <Animated.View style={[s.toastBox, { opacity: toastOpacity }]}>
            <Icon
              name={toastIcon || 'checkmark-circle'}
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={s.toastText}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Disco Ball Floating Button Alone (Music Room / Watch Together) ── */}
      <View 
        pointerEvents="box-none"
        style={[s.fabWrapper, { bottom: 120 + insets.bottom }]}
      >
        <View ref={playBtnRef} collapsable={false}>
          <TouchableOpacity
            style={[
              s.miniFabRoundedButton,
              { borderColor: isDark ? 'rgba(56, 189, 248, 0.55)' : 'rgba(99, 102, 241, 0.35)' }
            ]}
            onPress={() => {
              if (activeRoomCode) {
                DeviceEventEmitter.emit('minimize_music_room', false);
              } else {
                navigation.navigate('YouTubeDiscovery', {});
              }
            }}
            activeOpacity={0.82}
            accessibilityLabel="Music Room"
          >
            <LinearGradient
              colors={
                isDark
                  ? ['#1E3A8A', '#0F172A']
                  : ['#FFFFFF', '#E0E7FF']
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 31 }]}
            />
            {/* 3D Specular Highlight Sheen */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 3,
                left: 10,
                right: 10,
                height: 14,
                borderRadius: 12,
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.7)',
              }}
            />
            <View pointerEvents="none" style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
              {activeRoomCode ? (
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                  <LottieStickerMessage
                    url="https://fonts.gstatic.com/s/e/notoemoji/latest/1faa9/lottie.json"
                    size={46}
                    autoPlay={true}
                  />
                </Animated.View>
              ) : (
                <LottieStickerMessage
                  url="https://fonts.gstatic.com/s/e/notoemoji/latest/1faa9/lottie.json"
                  size={46}
                  autoPlay={false}
                />
              )}
            </View>
            {activeRoomCode && (
              <View style={s.musicActiveDot} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {tourVisible && (
        <OnboardingTour
          targets={tourTargets}
          onFinished={handleTourFinished}
        />
      )}

      <CustomGalleryPicker
        visible={statusGalleryVisible}
        onClose={() => setStatusGalleryVisible(false)}
        onSelect={handleStatusGallerySelect}
        maxSelect={1}
        assetType="All"
        maxDuration={61}
      />
    </View>
  );
};

const THEME_COLOR = '#4597f5f6';
const BG_COLOR = '#E8DEF8';

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors, isDark = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surface },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: { backgroundColor: theme.surface, borderWidth: 1, borderColor: THEME_COLOR, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: THEME_COLOR, fontSize: fontSize.lg, fontWeight: 'bold' },
  conversationItem: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  content: { flex: 1, justifyContent: 'center', marginLeft: spacing.md },
  name: { fontSize: fontSize.lg, fontWeight: '600', color: theme.textPrimary },
  lastMessageRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  lastMessage: { fontSize: fontSize.md, color: theme.textSecondary, flex: 1 },
  tabContainerWrapper: {
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: theme.surface,
  },
  tabsGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mainTabPill: {
    paddingVertical: 5,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  mainTabPillActive: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.16)' : '#E0F2FE',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(14, 165, 233, 0.28)',
  },
  mainTabPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  mainTabPillTextActive: {
    color: isDark ? '#38BDF8' : '#0B192C',
    fontWeight: '700',
  },
  mainTabPillTextInactive: {
    color: isDark ? '#94A3B8' : '#64748B',
  },
  mainTabBadge: {
    marginLeft: 6,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    backgroundColor: isDark ? '#38BDF8' : '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  mainTabBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '700',
    lineHeight: 11,
  },
  dropdownToggleBtn: {
    minWidth: 32,
    minHeight: 30,
    paddingTop: 4,
    paddingBottom: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto' as any,
    position: 'relative',
  },
  dropdownToggleBtnActive: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(14, 165, 233, 0.12)',
  },
  dropdownGlowWrapper: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownGlowHalo: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(14, 165, 233, 0.35)',
  },
  dropdownBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: isDark ? '#38BDF8' : '#0284C7',
    shadowColor: isDark ? '#38BDF8' : '#0284C7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 5,
    elevation: 3,
  },
  cancelDropdownBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(14, 165, 233, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto' as any,
  },
  cancelDropdownText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: isDark ? '#38BDF8' : '#0284C7',
  },
  subDrawerContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  subDrawerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 6,
  },
  subDrawerTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  subDrawerTabBtnActive: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(14, 165, 233, 0.15)',
    borderWidth: 1,
    borderColor: isDark ? '#38BDF8' : '#0EA5E9',
  },
  subDrawerTabBtnMuted: {
    opacity: 0.42,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  },
  subDrawerTabText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  subDrawerTabTextActive: {
    color: isDark ? '#38BDF8' : '#0369A1',
    fontWeight: '700',
  },
  subDrawerTabTextInactive: {
    color: isDark ? '#94A3B8' : '#64748B',
  },
  subDrawerTabTextMuted: {
    color: isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)',
    fontWeight: '500',
  },
  drawerBadge: {
    marginLeft: 6,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  drawerBadgeActive: {
    backgroundColor: isDark ? '#38BDF8' : '#0EA5E9',
  },
  drawerBadgeInactive: {
    backgroundColor: isDark ? '#475569' : '#94A3B8',
  },
  drawerBadgeText: {
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '700',
    lineHeight: 11,
  },
  pendingTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto' as any,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  headerPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  headerPillBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  headerDeletePillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  headerDeletePillBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  toastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(11, 25, 44, 0.92)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '600',
  },
  logItemSelected: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.16)' : '#E0F2FE',
    borderLeftColor: isDark ? '#38BDF8' : '#2563EB',
  },
  checkboxContainer: {
    marginRight: 10,
    justifyContent: 'center',
  },
  popoverBackdrop: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.25)',
  },
  popover: { position: 'absolute', top: 50, right: 16, width: 180, backgroundColor: theme.surface, borderRadius: 8, padding: 8, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 1000 },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  popoverText: { fontSize: 14, color: theme.textPrimary },
  newBadge: {
    marginLeft: 'auto',
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: theme.surface,
  },
  profileStoryContainer: {
    position: 'relative',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCircleGradient: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCircleInner: {
    width: 59,
    height: 59,
    borderRadius: 29.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyAvatar: {
    width: 59,
    height: 59,
    borderRadius: 29.5,
    borderWidth: 0,
  },
  plainProfileCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 0,
  },
  addStatusBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 23,
    height: 23,
    borderRadius: 11.5,
    borderWidth: 2,
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    zIndex: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  addStatusBadgeGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 11.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  bookButtonPlain: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendBtnRow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  hubContainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: isDark
      ? 'rgba(56, 189, 248, 0.65)'
      : 'rgba(32, 92, 184, 0.35)',
    backgroundColor: isDark
      ? '#060B14'
      : '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 6,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.6 : 0.2,
    shadowRadius: 10,
  },
  fabWrapper: { 
    position: 'absolute', 
    bottom: 98, 
    right: 16, 
    zIndex: 50,
    alignItems: 'center',
  },
  hubContainer: {
    width: 66,
    borderRadius: 33,
    borderWidth: 1.5,
    borderColor: isDark
      ? 'rgba(56, 189, 248, 0.65)'
      : 'rgba(32, 92, 184, 0.35)',
    backgroundColor: isDark
      ? '#060B14'
      : '#FFFFFF',
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 7,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.75 : 0.25,
    shadowRadius: 16,
  },
  headerFriendBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    minWidth: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerFriendBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  hubTopToggleButton: {
    width: 44,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniFabRoundedButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: isDark
      ? 'rgba(56, 189, 248, 0.4)'
      : 'rgba(32, 92, 184, 0.22)',
    backgroundColor: isDark
      ? '#071527'
      : '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.5 : 0.22,
    shadowRadius: 6,
  },
  musicActiveDot: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#10B981',
    borderWidth: 1.5,
    borderColor: isDark ? '#071527' : '#FFFFFF',
  },
  composeButton: {
    width: 60,
    height: 50,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderWidth: 1.5,
    borderColor: isDark
      ? 'rgba(56, 189, 248, 0.4)'
      : 'rgba(32, 92, 184, 0.22)',
    backgroundColor: isDark
      ? '#071527'
      : '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4, // Clean contained depth (no bottom shadow bleed)
    shadowColor: isDark ? '#000000' : '#205CB8',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.35 : 0.16,
    shadowRadius: 6,
  },
  badgeContainer: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#10B981',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: theme.background,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },

  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0, 
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#25D366',
    borderWidth: 2,
    borderColor: theme.background,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  previewContainer: { width: 300, backgroundColor: theme.surface, borderRadius: 16, padding: 20, alignItems: 'center' },
  previewImage: { width: 280, height: 280, borderRadius: 140, marginBottom: 16 },
  previewPlaceholder: { width: 200, height: 200, borderRadius: 150, backgroundColor: BG_COLOR, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  previewText: {fontSize: 180, fontWeight: 'bold', color: THEME_COLOR },
  previewName: { fontSize: 20, fontWeight: 'bold', color: theme.textPrimary },
  unreadBadge: {
    backgroundColor: '#888888',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadCount: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 10,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  rightContent: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  time: {
    fontSize: 12,
    color: theme.textSecondary,
    marginBottom: 4,
  },
  // Message request tab styles
  smallBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  requestsCountBadge: {
    marginLeft: 4,
    borderRadius: 3, // Small square shape
    minWidth: 15,
    height: 15,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2.5,
  },
  requestsCountBadgeInactive: {
    backgroundColor: isDark ? '#38BDF8' : '#0EA5E9', // Light blue when pending is inactive
  },
  requestsCountBadgeActive: {
    backgroundColor: isDark ? '#1E3A8A' : '#0B192C', // Dark navy blue when pending is clicked
  },
  requestsCountText: {
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '700',
    lineHeight: 11,
  },
  mutedCountBadge: {
    marginLeft: 5,
    backgroundColor: '#8E8E93',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  mutedCountText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
