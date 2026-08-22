import React, { useState, useEffect, useCallback, useRef } from 'react';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingTour, { TourTarget, TourStepKey } from '../../components/OnboardingTour';
import {
  View,
  Text as RNText,
  FlatList,
  TouchableOpacity,
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
} from 'react-native';


import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

const SafeText = (props: any) => {
  const children = React.Children.map(props.children, child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return child;
  });
  return <RNText {...props}>{children}</RNText>;
};
const Text = SafeText;
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
  visible, onClose, onNewGroup, onClearAll, onProfile, onLogout, onSelect, onSettings, onAppUpdate, onShareApp
}: { 
  visible: boolean, onClose: () => void, onNewGroup: () => void, onClearAll: () => void,
  onProfile: () => void, onLogout: () => void, onSelect: () => void,
  onSettings: () => void, onAppUpdate: () => void, onShareApp: () => void
}) => {
  const { hasUpdate } = useUpdateInfo();
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme, isDark), [theme, isDark]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}>
        <View style={s.popover}>
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

const renderLastMessageContent = (lastMessage: Conversation['last_message']) => {
  if (!lastMessage) return 'No messages yet';
  
  if (isTriviaChallengeMessage(lastMessage) || isScoreSubmissionMessage(lastMessage)) {
    return 'No messages yet';
  }

  const message_type = lastMessage.message_type;
  const content = lastMessage.content || '';

  if (
    message_type === 'lottie_sticker' || 
    message_type === 'sticker' || 
    (content && (content.includes('/stickers/') || content.endsWith('.json')))
  ) {
    return <><Icon name="image-outline" size={14} color="#666" /> Sticker</>;
  }

  // Guard against any raw JSON or TRIVIA prefix leaks
  if (
    typeof content === 'string' &&
    (content.startsWith('[TRIVIA_') ||
      content.includes('[TRIVIA_') ||
      (content.includes('"challengeId"') && (content.includes('"questions"') || content.includes('"entry"') || content.includes('"leaderboard"'))))
  ) {
    return 'No messages yet';
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

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const cached = localDatabase.getConversations();
      return cached && cached.length > 0 ? cached : [];
    } catch {
      return [];
    }
  });
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const initialTabParam = route?.params?.initialTab || route?.params?.tab;
  const [activeTab, setActiveTab] = useState<'all' | 'friends' | 'groups' | 'pending'>(
    initialTabParam === 'pending' || initialTabParam === 'friends' || initialTabParam === 'groups'
      ? initialTabParam
      : 'all'
  );
  const [friends, setFriends] = useState<any[]>([]);
  const [messageRequests, setMessageRequests] = useState<any[]>([]);
  const [friendRequestsCount, setFriendRequestsCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    try {
      const cached = localDatabase.getConversations();
      return !cached || cached.length === 0;
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const { user, logout } = useAuth();
  const updateInfo = useUpdateInfo();
  const insets = useSafeAreaInsets();
  const isLoadingRef = useRef(false);
  const deletedConversationIdsRef = useRef<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

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
    setCountdownActive(true);
    setCountdownValue(3);
    let tick = 3;
    countdownIntervalRef.current = setInterval(() => {
      tick -= 1;
      setCountdownValue(tick);
      if (tick <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      }
    }, 1000);
    countdownTimerRef.current = setTimeout(() => {
      setSearchQuery('');
      setCountdownActive(false);
      setCountdownValue(3);
    }, 3000);
  };

  // Reset idle timer on every keystroke
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    clearCountdown();
    if (!searchQuery.trim()) return;
    idleTimerRef.current = setTimeout(() => {
      startCountdown();
    }, 1000);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // ── Search bar pink glow border animation ─────────────────────────────────
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

  const [isKeyboardActive, setIsKeyboardActive] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      if (searchRef.current?.isFocused()) {
        setIsKeyboardActive(true);
      }
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      if (isKeyboardActive) {
        setIsKeyboardActive(false);
        searchRef.current?.blur();
      }
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isKeyboardActive]);

  // ── Onboarding tour ────────────────────────────────────────────────────────
  const ONBOARDING_KEY = `dme_onboarding_done_v1_${user?.id || 'default'}`;
  const [tourVisible, setTourVisible] = useState(false);
  const [tourTargets, setTourTargets] = useState<Partial<Record<TourStepKey, TourTarget>>>({});
  const fabRef = useRef<View>(null);
  const playBtnRef = useRef<View>(null);
  const menuBtnRef = useRef<View>(null);
  const triviaBtnRef = useRef<View>(null);

  // Check if first launch
  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(ONBOARDING_KEY).then(val => {
      if (!val) {
        // Delay slightly so the layout is fully settled before we measure
        setTimeout(() => measureAllTargets(), 650);
      }
    });
  }, [user?.id]);

  const measureRef = (ref: React.RefObject<View>, key: TourStepKey) => {
    return new Promise<void>((resolve) => {
      let attempts = 0;
      const tryMeasure = () => {
        if (!ref.current) {
          resolve();
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
            setTimeout(tryMeasure, 150);
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
      await Promise.all([
        measureRef(fabRef, 'fab'),
        measureRef(playBtnRef, 'play'),
        measureRef(menuBtnRef, 'menu'),
        measureRef(triviaBtnRef, 'trivia'),
      ]);
      // statusTab arrives separately via the event listener below
    } catch (error) {
      console.error('Error measuring targets:', error);
    }
  };

  const handleTourFinished = () => {
    setTourVisible(false);
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

  // 2. Once all 5 targets are measured, show the tour
  useEffect(() => {
    const allReady = (['fab', 'play', 'menu', 'statusTab', 'trivia'] as TourStepKey[]).every(k => tourTargets[k]);
    if (allReady && !tourVisible) {
      setTourVisible(true);
    }
  }, [tourTargets]);

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

  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const spinValue = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      userTouchedSearch.current = false;
      setActiveRoomCode((global as any).activeMusicRoomCode || null);
    }, [])
  );

  useEffect(() => {
    const handleVisibility = () => {
      setActiveRoomCode((global as any).activeMusicRoomCode || null);
    };

    const subMinimize = DeviceEventEmitter.addListener('minimize_music_room', handleVisibility);
    const subOpen = DeviceEventEmitter.addListener('open_music_room', handleVisibility);
    const subClose = DeviceEventEmitter.addListener('close_music_room', () => setActiveRoomCode(null));

    return () => {
      subMinimize.remove();
      subOpen.remove();
      subClose.remove();
    };
  }, []);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (activeRoomCode) {
      animation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 4000,
          useNativeDriver: true,
        })
      );
      animation.start();
    } else {
      spinValue.setValue(0);
    }
    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [activeRoomCode]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const [previewData, setPreviewData] = useState<{
    visible: boolean; uri: string | null; isGroup: boolean; displayName: string; sticker: string | null;
  }>({
    visible: false, uri: null, isGroup: false, displayName: '', sticker: null,
  });

  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  const fetchRealLastMessage = useCallback(async (conversationId: number) => {
    try {
      const msgs = await chatAPI.getMessages(conversationId);
      const msgsList = Array.isArray(msgs) ? msgs : (msgs?.results || []);
      const realMsgs = msgsList.filter(
        (m: any) => !isTriviaChallengeMessage(m) && !isScoreSubmissionMessage(m)
      );
      if (realMsgs.length > 0) {
        const latestReal = realMsgs[realMsgs.length - 1];
        const formattedLastMsg = {
          id: latestReal.id || 0,
          content: latestReal.content || '',
          message_type: latestReal.message_type || 'text',
          created_at: latestReal.created_at,
          sender_id: latestReal.sender?.id || latestReal.sender_id || 0,
          status: latestReal.status || (latestReal.is_read ? 'read' : 'sent'),
        };
        setConversations(prev => {
          const updated = prev.map(c =>
            c.id === conversationId ? { ...c, last_message: formattedLastMsg } : c
          );
          localDatabase.saveConversations(updated);
          return updated;
        });
        localDatabase.saveMessages(msgsList, conversationId);
      }
    } catch (err) {
      console.warn('Could not fetch real last message for conv', conversationId, err);
    }
  }, []);

  const cleanConversationLastMessage = useCallback(
    (conv: Conversation): Conversation => {
      if (!conv.last_message) {
        const inMemory = conversationsRef.current.find(c => c.id === conv.id);
        if (
          inMemory?.last_message &&
          !isTriviaChallengeMessage(inMemory.last_message) &&
          !isScoreSubmissionMessage(inMemory.last_message)
        ) {
          return { ...conv, last_message: inMemory.last_message };
        }
        try {
          const cachedConvs = localDatabase.getConversations();
          const cached = cachedConvs.find(c => c.id === conv.id);
          if (
            cached?.last_message &&
            !isTriviaChallengeMessage(cached.last_message) &&
            !isScoreSubmissionMessage(cached.last_message)
          ) {
            return { ...conv, last_message: cached.last_message };
          }
        } catch {}
        return conv;
      }

      if (isTriviaChallengeMessage(conv.last_message) || isScoreSubmissionMessage(conv.last_message)) {
        if (conv.last_message.content) {
          syncChallengeFromMessage(conv.last_message.content, conv.id);
        }

        // 1. Check in-memory previous conversations state
        const existingConv = conversationsRef.current.find(c => c.id === conv.id);
        if (
          existingConv?.last_message &&
          !isTriviaChallengeMessage(existingConv.last_message) &&
          !isScoreSubmissionMessage(existingConv.last_message)
        ) {
          return {
            ...conv,
            last_message: existingConv.last_message,
          };
        }

        // 2. Check local database cached messages
        try {
          const recentMsgs = localDatabase.getRecentMessages(conv.id, 30);
          const realMsgs = recentMsgs.filter(
            m => !isTriviaChallengeMessage(m) && !isScoreSubmissionMessage(m)
          );
          if (realMsgs.length > 0) {
            const latestReal = realMsgs[realMsgs.length - 1];
            return {
              ...conv,
              last_message: {
                id: latestReal.id || 0,
                content: latestReal.content || '',
                message_type: latestReal.message_type || 'text',
                created_at: latestReal.created_at,
                sender_id: latestReal.sender?.id || latestReal.sender_id || 0,
                status: latestReal.status || (latestReal.is_read ? 'read' : 'sent'),
              },
            };
          }
        } catch {}

        // 3. Check local database cached conversation
        try {
          const cachedConvs = localDatabase.getConversations();
          const cached = cachedConvs.find(c => c.id === conv.id);
          if (
            cached?.last_message &&
            !isTriviaChallengeMessage(cached.last_message) &&
            !isScoreSubmissionMessage(cached.last_message)
          ) {
            return {
              ...conv,
              last_message: cached.last_message,
            };
          }
        } catch {}

        // 4. Trigger asynchronous fetch of actual messages from server to restore real message
        fetchRealLastMessage(conv.id);

        return {
          ...conv,
          last_message: null,
        };
      }
      return conv;
    },
    [fetchRealLastMessage]
  );

  const loadConversations = useCallback(async () => {
    if (isLoadingRef.current) return;
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
      
      // Clean contest/score submission messages so chat list stays 100% clean
      conversationsArray = conversationsArray.map(cleanConversationLastMessage);

      // Cache fresh data to local DB
      localDatabase.saveConversations(conversationsArray);

      const directUserIds = new Set(
        conversationsArray
          .filter(c => !c.is_group && c.other_user?.id)
          .map(c => c.other_user!.id)
      );
      setConversations(conversationsArray);
      setStatusGroups(StatusService.groupByUser(statuses.filter(s => s.user_id !== user?.id && directUserIds.has(s.user_id))));

      if (Array.isArray(msgReqs)) {
        setMessageRequests(msgReqs);
      }
      const receivedReqs = Array.isArray(friendReqs?.received) ? friendReqs.received : [];
      setFriendRequestsCount(receivedReqs.length);
      setFriends(Array.isArray(friendsList) ? friendsList : (friendsList?.results || []));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isLoadingRef.current = false;
    }
  }, [user?.id, cleanConversationLastMessage]);

  useEffect(() => {
    loadConversations();
    websocketService.connectToNotifications().catch(err => console.error('Notification connection failed:', err));

    const unsubscribe = websocketService.onMessage((message) => {
        if (message.type === 'new_message_summary') {
            const newMessage = message.data;
            if (isTriviaChallengeMessage(newMessage) || isScoreSubmissionMessage(newMessage)) {
                if (newMessage.content) {
                    syncChallengeFromMessage(newMessage.content, newMessage.conversation);
                }
                return;
            }
            setConversations(prev => {
                const existing = prev.find(c => c.id === newMessage.conversation);
                if (existing) {
                    const isOwnMessage = newMessage.sender.id === user?.id;
                    const isEdit = existing.last_message?.id === newMessage.id;
                    const isReaction = newMessage.is_reaction === true;
                    const updated = { 
                        ...existing, 
                        last_message: {
                            id: newMessage.id,
                            content: newMessage.content,
                            message_type: newMessage.message_type,
                            created_at: newMessage.created_at,
                            sender_id: newMessage.sender.id,
                            status: newMessage.is_read ? 'read' : (newMessage.delivered_at ? 'delivered' : 'sent')
                        },
                        unread_count: (isEdit || isReaction)
                          ? (existing.unread_count || 0)
                          : (isOwnMessage ? (existing.unread_count || 0) : (existing.unread_count || 0) + 1)
                    };
                    // Save to local cache
                    localDatabase.saveConversation(updated);
                    return [updated, ...prev.filter(c => c.id !== newMessage.conversation)];
                }
                loadConversations();
                return prev;
            });
        } else if (message.type === 'delivered') {
            const { message_ids } = message.data;
            if (message_ids && Array.isArray(message_ids)) {
                setConversations(prev => {
                    return prev.map(c => {
                        if (c.last_message && message_ids.includes(c.last_message.id) && c.last_message.sender_id === user?.id) {
                            const updated = {
                                ...c,
                                last_message: { ...c.last_message, status: 'delivered' as const }
                            };
                            localDatabase.saveConversation(updated);
                            return updated;
                        }
                        return c;
                    });
                });
            }
        } else if (message.type === 'read_receipt') {
            const { message_ids } = message.data;
            if (message_ids && Array.isArray(message_ids)) {
                setConversations(prev => {
                    return prev.map(c => {
                        if (c.last_message && message_ids.includes(c.last_message.id) && c.last_message.sender_id === user?.id) {
                            const updated = {
                                ...c,
                                last_message: { ...c.last_message, status: 'read' as const }
                            };
                            localDatabase.saveConversation(updated);
                            return updated;
                        }
                        return c;
                    });
                });
            }
        } else if (message.type === 'message_request_status') {
            // Update the conversation's message_request_status inline so the
            // conversation moves between Pending / All / Friends immediately.
            const { conversation_id, status: reqStatus } = message.data || {};
            if (conversation_id) {
                setConversations(prev => {
                    const exists = prev.some(c => c.id === conversation_id);
                    if (!exists) {
                        // Conversation isn't in the list yet (e.g., sender's convo was hidden
                        // by the receiver-pending filter). Do a full reload to fetch it.
                        loadConversations();
                        return prev;
                    }
                    return prev.map(c =>
                        c.id === conversation_id
                            ? { ...c, message_request_status: reqStatus }
                            : c
                    );
                });
                // For accepted/rejected, always do a full reload to ensure correct ordering
                // and friend-status enrichment from the server.
                if (reqStatus === 'accepted') {
                    loadConversations();
                }
            }
            // Refresh friends list too — friendship state may have changed.
            chatAPI.getFriends().then(data => {
                setFriends(Array.isArray(data) ? data : (data?.results || []));
            }).catch(() => {});
        }
    });

    const readSub = DeviceEventEmitter.addListener('conversation_read', ({ conversationId }) => {
        const cId = parseInt(conversationId, 10);
        setConversations(prev => prev.map(c => {
            if (c.id === cId) {
                const updated = { ...c, unread_count: 0 };
                localDatabase.saveConversation(updated);
                return updated;
            }
            return c;
        }));
    });

    // When a friend request is accepted from FriendListScreen, reload everything
    // so the conversation appears in All/Friends with the correct status.
    const friendAcceptedSub = DeviceEventEmitter.addListener('friend_request_accepted', () => {
        loadConversations();
    });

    return () => { 
        websocketService.disconnectRoom();
        unsubscribe();
        readSub.remove();
        friendAcceptedSub.remove();
    };
  }, [loadConversations]);

  // Reload conversations whenever the screen comes back into focus
  // (e.g. after returning from ChatRoomScreen or ProfileScreen)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Defer network call until back navigation transition completes smoothly
      const timer = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          loadConversations();
        });
      }, 200);

      return () => clearTimeout(timer);
    });
    return unsubscribe;
  }, [navigation, loadConversations]);

  useEffect(() => {
    const tabParam = route?.params?.initialTab || route?.params?.tab;
    if (tabParam && ['all', 'friends', 'groups', 'pending'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [route?.params?.initialTab, route?.params?.tab]);

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => await logout() },
    ]);
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

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
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
      headerTitleAlign: 'center',
      headerTitle: () => (
        selectionMode ? (
          <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#8212c7' }}>{selectedIds.length} Selected</Text>
        ) : (
          <View ref={triviaBtnRef} collapsable={false}>
            <TouchableOpacity
              onPress={() => navigation.navigate('TriviaHub')}
            >
              <View style={{ alignItems: 'center' }}>
                <Icon name="book-outline" size={30} color={theme.textPrimary} />
                
              </View>
            </TouchableOpacity>
          </View>
        )
      ),
      headerLeft: () => (
        selectionMode ? (
          <TouchableOpacity style={{marginLeft: 16}} onPress={() => { setSelectionMode(false); setSelectedIds([]); }}>
              <Text style={{color: '#666', fontSize: 16}}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ fontWeight: 'bold', fontSize: 28, color: '#222', marginLeft: 16 }}>Yesenta</Text>
        )
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
          {selectionMode ? (
            <TouchableOpacity style={{ marginRight: 16 }} onPress={handleBatchDelete} disabled={selectedIds.length === 0}>
                <Text style={{color: '#F44336', fontWeight: 'bold'}}>Delete</Text>
            </TouchableOpacity>
          ) : (
             <>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Profile')}
                  style={{ marginRight: 32 }}
                >
                  <AvatarWithFallback
                    uri={user?.profile_picture}
                    sticker={user?.avatar_sticker}
                    displayName={user?.display_name || user?.username || ''}
                    style={{ width: 34, height: 34, borderRadius: 17 }}
                  />
                </TouchableOpacity>
                <View ref={playBtnRef} collapsable={false}>
                  <TouchableOpacity
                    onPress={() => {
                      if (activeRoomCode) {
                        DeviceEventEmitter.emit('minimize_music_room', false);
                      } else {
                        navigation.navigate('YouTubeDiscovery', {});
                      }
                    }}
                    style={{ marginRight: 12 }}
                  >
                    {activeRoomCode ? (
                      <Animated.View style={{ transform: [{ rotate: spin }] }}>
                        <LinearGradient
                          colors={['#FF007F', '#000000', '#b10000', '#333333']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                        >
                          <Icon name="disc" size={15} color="#fff" />
                        </LinearGradient>
                      </Animated.View>
                    ) : (
                      <Icon name="play" size={32} color="#af0000" />
                    )}
                  </TouchableOpacity>
                </View>
                <View ref={menuBtnRef} collapsable={false}>
                  <TouchableOpacity onPress={() => setMenuVisible(true)}>
                      <Icon name="menu" size={26} color={theme.textPrimary} />
                  </TouchableOpacity>
                </View>
             </>
          )}
        </View>
      ),
      headerStyle: { backgroundColor: selectionMode ? '#F8F0FF' : theme.surface, elevation: 0, shadowOpacity: 0, borderBottomWidth: 0 },
    });
  }, [navigation, selectionMode, selectedIds, handleBatchDelete, activeRoomCode]);

  const handleShareApp = async () => {
    try {
      const shareUrl = 'https://dme-19zq.onrender.com/invite';
      await Share.share({
        message: `Join me on Yesenta! It's a fast, secured messaging app with Learn and Watch together. Download it here: ${shareUrl}`,
      });
    } catch (error) {
      console.warn('Error sharing app', error);
    }
  };

  // ── Center-screen toast ─────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'info' | 'error'>('success');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      await chatAPI.acceptMessageRequest(requestId);
      showToast('Message request accepted!');
      loadConversations();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to accept message request');
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      showToast('Message request declined. You can accept it later to continue chatting.', 'info');
      loadConversations();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to decline message request');
    }
  };

  const unreadChatsCount = conversations.filter(c => !c.is_group).reduce((acc, c) => acc + (c.unread_count || 0), 0);
  const unreadGroupsCount = conversations.filter(c => c.is_group).reduce((acc, c) => acc + (c.unread_count || 0), 0);
  const unreadTotalCount = unreadChatsCount + unreadGroupsCount;

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
        onSettings={() => {
          setMenuVisible(false);
          navigation.navigate('Settings');
        }}
        onAppUpdate={() => {
          setMenuVisible(false);
          if (updateInfo.hasUpdate && updateInfo.downloadUrl) {
            handleDownloadUpdate(updateInfo.downloadUrl);
          } else {
            Alert.alert('App Update', 'You are on the latest version of Yesenta.');
          }
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
      {/* ── Center-screen fade toast ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.toastOverlay} pointerEvents="none">
          <Animated.View style={[s.toastBox, { opacity: toastOpacity }]}>
            <Icon
              name={toastType === 'success' ? 'checkmark-circle' : 'close-circle'}
              size={22}
              color={toastType === 'success' ? '#4CAF50' : '#FF5252'}
              style={{ marginRight: 8 }}
            />
            <Text style={s.toastText}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>
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
              }}
              onBlur={() => {
                setIsSearchFocused(false);
                startSpinReverse();
                setIsKeyboardActive(false);
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
        ListHeaderComponent={
          <View style={[s.tabContainer, { backgroundColor: theme.surface }]}>
            {/* ── Category Switcher: Left-aligned (< Category >) ── */}
            <View style={s.tabNavRow}>
              {/* Prev arrow */}
              <TouchableOpacity
                onPress={() => {
                  if (activeTab === 'pending') {
                    setActiveTab('all');
                    return;
                  }
                  const cycle: Array<'all' | 'friends' | 'groups'> = ['all', 'friends', 'groups'];
                  const cur = cycle.includes(activeTab as any) ? cycle.indexOf(activeTab as any) : 0;
                  const next = (cur - 1 + cycle.length) % cycle.length;
                  setActiveTab(cycle[next]);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                activeOpacity={0.7}
                style={{ padding: 2 }}
              >
                <Icon
                  name="chevron-back"
                  size={14}
                  color={activeTab === 'pending' ? (isDark ? '#38BDF8' : '#0EA5E9') : (isDark ? '#93C5FD' : '#0B192C')}
                />
              </TouchableOpacity>

              {/* Category label */}
              <TouchableOpacity
                onPress={() => {
                  if (activeTab === 'pending') {
                    setActiveTab('all');
                  } else {
                    const cycle: Array<'all' | 'friends' | 'groups'> = ['all', 'friends', 'groups'];
                    const cur = cycle.includes(activeTab as any) ? cycle.indexOf(activeTab as any) : 0;
                    const next = (cur + 1) % cycle.length;
                    setActiveTab(cycle[next]);
                  }
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                style={{ marginHorizontal: 6 }}
              >
                <Text
                  style={[
                    s.tabNavLabel,
                    activeTab === 'pending' && s.tabNavLabelInactive,
                  ]}
                  numberOfLines={1}
                >
                  {activeTab === 'all'
                    ? 'All Messages'
                    : activeTab === 'friends'
                    ? 'Friends Chat'
                    : activeTab === 'groups'
                    ? 'Groups Chat'
                    : 'All Messages'}
                </Text>
              </TouchableOpacity>

              {/* Next arrow */}
              <TouchableOpacity
                onPress={() => {
                  if (activeTab === 'pending') {
                    setActiveTab('all');
                    return;
                  }
                  const cycle: Array<'all' | 'friends' | 'groups'> = ['all', 'friends', 'groups'];
                  const cur = cycle.includes(activeTab as any) ? cycle.indexOf(activeTab as any) : 0;
                  const next = (cur + 1) % cycle.length;
                  setActiveTab(cycle[next]);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                activeOpacity={0.7}
                style={{ padding: 2 }}
              >
                <Icon
                  name="chevron-forward"
                  size={14}
                  color={activeTab === 'pending' ? (isDark ? '#38BDF8' : '#0EA5E9') : (isDark ? '#93C5FD' : '#0B192C')}
                />
              </TouchableOpacity>
            </View>

            {/* ── Pending: Right-aligned ── */}
            <TouchableOpacity
              style={s.pendingTabBtn}
              onPress={() => setActiveTab(activeTab === 'pending' ? 'all' : 'pending')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  s.pendingTabText,
                  activeTab === 'pending' ? s.pendingTabTextActive : s.pendingTabTextInactive,
                ]}
              >
                Pending
              </Text>
              {pendingRequestsCount > 0 && (
                <View
                  style={[
                    s.requestsCountBadge,
                    activeTab === 'pending' ? s.requestsCountBadgeActive : s.requestsCountBadgeInactive,
                  ]}
                >
                  <Text style={s.requestsCountText}>{pendingRequestsCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        }

        data={listData}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 80, 110) }}
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
                    navigation.navigate('ChatRoom', { 
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
          const isFriend = userId ? friends.some((f: any) => f.id === userId || String(f.id) === String(userId)) : false;
          const hasStatus = isFriend && userStatuses && userStatuses.length > 0;
          const hasUnseen = statusGroup ? statusGroup.has_unseen : false;
          
          let isOnline = false;
          if (isFriend && !item.is_group && item.other_user) {
            const isPrivacyNobody = item.other_user.last_seen_privacy === 'nobody';
            if (!isPrivacyNobody) {
              const lastSeen = new Date(item.other_user.last_seen).getTime();
              const now = Date.now();
              isOnline = (now - lastSeen) < 120000;
            }
          }

          return (
            <TouchableOpacity
              style={[s.conversationItem, isSelected && s.logItemSelected]}
              activeOpacity={0.7}
              delayPressIn={0}
              onPress={() => {
                if (selectionMode) {
                  toggleSelection(item.id);
                } else {
                  navigation.navigate('ChatRoom', { 
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
            >
              {selectionMode && (
                <View style={s.checkboxContainer}>
                  <Icon name={isSelected ? "checkbox" : "square-outline"} size={22} color="#4597f5f6" />
                </View>
              )}
              <View style={{ position: 'relative', width: 50, height: 50, justifyContent: 'center', alignItems: 'center' }}>
                {hasStatus && (
                  hasUnseen ? (
                    <LinearGradient
                      colors={['#ff4d6d', '#4597f5f6']}
                      start={{ x: 0, y: 1 }}
                      end={{ x: 1, y: 0 }}
                      style={{
                        position: 'absolute',
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        position: 'absolute',
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                        borderWidth: 2,
                        borderColor: '#ccc',
                      }}
                    />
                  )
                )}
                <AvatarWithFallback
                  uri={item.is_group ? item.profile_picture : item.other_user?.profile_picture}
                  sticker={item.is_group ? null : item.other_user?.avatar_sticker}
                  displayName={item.is_group
                    ? (item.name || 'Group')
                    : (item.other_user?.display_name || item.other_user?.email || 'User')}
                  isGroup={item.is_group}
                  style={{
                    width:        44,
                    height:       44,
                    borderRadius: 22,
                  }}
                  onPress={() => {
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
                {!item.is_group && isOnline && <View style={s.onlineDot} />}
              </View>
              <View style={s.content}>
                <Text style={s.name}>{String(item.is_group ? (item.name || 'Group') : (item.other_user?.display_name || item.other_user?.email || 'User') || '')}</Text>
                <View style={s.lastMessageRow}>
                  {item.last_message && item.last_message.sender_id === user?.id && renderMessageTicks(item.last_message)}
                  <Text style={s.lastMessage} numberOfLines={1}>
                    {!item.is_group && item.message_request_status === 'pending' && item.message_request_sender_id === user?.id ? (
                      <><Icon name="hourglass-outline" size={14} color="#666" /> Message request pending</>
                    ) : !item.is_group && item.message_request_status === 'rejected' && item.message_request_sender_id === user?.id ? (
                      <><Icon name="close-circle-outline" size={14} color="#F44336" /> Message request declined</>
                    ) : !item.is_group && item.message_request_status === 'accepted' && item.message_request_sender_id === user?.id && item.last_message === null ? (
                      <><Icon name="checkmark-circle-outline" size={14} color="#4CAF50" /> Message request approved</>
                    ) : item.is_group && item.last_message === null ? (
                      <><Icon name="chatbubble-outline" size={13} color={isDark ? '#64748B' : '#94A3B8'} /> Tap to start chatting</>
                    ) : (
                      renderLastMessageContent(item.last_message)
                    )}
                  </Text>
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
            </TouchableOpacity>
          );
        }}
        keyExtractor={(item) => item.id.toString()}
        extraData={conversations}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadConversations} tintColor={THEME_COLOR} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 320, paddingHorizontal: 24, paddingVertical: 40 }}>
              <Icon 
                name={
                  activeTab === 'pending'
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
                {activeTab === 'pending'
                  ? 'No pending requests'
                  : activeTab === 'groups' 
                  ? 'No groups yet' 
                  : activeTab === 'friends'
                  ? 'No friend chats yet'
                  : 'No conversations yet'}
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 4, textAlign: 'center' }}>
                {activeTab === 'pending'
                  ? 'Message and friend requests will appear here'
                  : activeTab === 'groups'
                  ? 'Group chats you join will appear here'
                  : activeTab === 'friends'
                  ? 'Chats with your friends will appear here'
                  : 'Tap + to start a new chat'}
              </Text>
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
      <View 
        ref={fabRef} 
        collapsable={false} 
        style={[s.fabWrapper, { bottom: 80 + insets.bottom }]}
      >
        <TouchableOpacity 
          style={s.composeButton} 
          onPress={() => navigation.navigate('FriendList')}
          activeOpacity={0.82}
        >
          {/* Theme-Consistent Premium Glass Gradient */}
          <LinearGradient
            colors={
              isDark
                ? ['#0E2849', '#071527']
                : ['#FFFFFF', '#F0F5FF']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderTopLeftRadius: 25,
                borderTopRightRadius: 10,
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
              },
            ]}
          />

          {/* Icon */}
          <Icon name="person-add" size={24} color={isDark ? theme.primary : '#205CB8'} />

          {/* Notification Badge */}
          {friendRequestsCount > 0 && (
            <View style={s.badgeContainer}>
              <Text style={s.badgeText}>
                {friendRequestsCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {tourVisible && (
        <OnboardingTour
          targets={tourTargets}
          onFinished={handleTourFinished}
        />
      )}
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
  conversationItem: { flexDirection: 'row', backgroundColor: theme.surface, padding: spacing.md },
  content: { flex: 1, justifyContent: 'center', marginLeft: spacing.md },
  name: { fontSize: fontSize.lg, fontWeight: '600', color: theme.textPrimary },
  lastMessageRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  lastMessage: { fontSize: fontSize.md, color: theme.textSecondary, flex: 1 },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: theme.surface,
  },
  tabNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabNavLabel: { fontSize: 13.5, fontWeight: '700', color: isDark ? '#93C5FD' : '#0B192C', letterSpacing: 0.1 },
  tabNavLabelInactive: { color: isDark ? '#38BDF8' : '#0EA5E9', fontWeight: '500' },
  pendingTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto' as any,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  pendingTabText: { fontSize: 13.5 },
  pendingTabTextInactive: { color: isDark ? '#38BDF8' : '#0EA5E9', fontWeight: '500' },
  pendingTabTextActive: { color: isDark ? '#93C5FD' : '#0B192C', fontWeight: '700' },
  logItemSelected: {
    backgroundColor: theme.surface,
  },
  checkboxContainer: {
    marginRight: 10,
    justifyContent: 'center',
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
  fabWrapper: { position: 'absolute', bottom: 80, right: 16, zIndex: 50 },
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
  toastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 30, 0.88)',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  toastText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});