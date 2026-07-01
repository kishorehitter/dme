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
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
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
import { websocketService, WebSocketMessage } from '../../services/websocket';
import { StatusService, Status, UserStatusGroup } from '../../services/StatusService';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { Conversation } from '../../types';
import { resolveImageUrl } from '../../utils/image';

interface ChatListScreenProps {
  navigation: any;
}

const PopoverMenu = ({ 
  visible, onClose, onNewGroup, onClearAll, onProfile, onLogout, onSelect, onSettings, onAppUpdate
}: { 
  visible: boolean, onClose: () => void, onNewGroup: () => void, onClearAll: () => void,
  onProfile: () => void, onLogout: () => void, onSelect: () => void,
  onSettings: () => void, onAppUpdate: () => void
}) => {
  const { hasUpdate } = useUpdateInfo();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}>
        <View style={styles.popover}>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onAppUpdate(); }}>
            <Icon name="download-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>App Update</Text>
            {hasUpdate && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>New</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onProfile(); }}>
            <Icon name="person-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onNewGroup(); }}>
            <Icon name="people-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>New Group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onClearAll(); }}>
            <Icon name="trash-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Clear all chats</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onSelect(); }}>
            <Icon name="checkbox-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Select and clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onSettings(); }}>
            <Icon name="settings-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.popoverItem, { borderTopWidth: 1, borderColor: '#eee', marginTop: 4 }]} onPress={() => { onClose(); onLogout(); }}>
            <Icon name="log-out-outline" size={20} color="#F44336" />
            <Text style={[styles.popoverText, { color: '#F44336' }]}>Logout</Text>
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

const renderLastMessage = (lastMessage: Conversation['last_message']) => {
  if (!lastMessage) return 'No messages yet';
  
  const { message_type, content } = lastMessage;
  
  switch (message_type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎵 Audio';
    case 'document':
      return '📄 Document';
    case 'text':
    default:
      return content || '';
  }
};

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ navigation }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'groups'>('all');
  const [isLoading, setIsLoading] = useState(true);
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

  // ── Onboarding tour ────────────────────────────────────────────────────────
  const ONBOARDING_KEY = 'dme_onboarding_done_v1';
  const [tourVisible, setTourVisible] = useState(false);
  const [tourTargets, setTourTargets] = useState<Partial<Record<TourStepKey, TourTarget>>>({});
  const fabRef = useRef<View>(null);
  const playBtnRef = useRef<View>(null);
  const menuBtnRef = useRef<View>(null);


  // Check if first launch
  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then(val => {
      if (!val) {
        // Delay slightly so the layout is fully settled before we measure
        setTimeout(() => measureAllTargets(), 650);
      }
    });
  }, []);

  const measureRef = (ref: React.RefObject<View>, key: TourStepKey) => {
    return new Promise<void>((resolve) => {
      if (!ref.current) {
        console.warn(`Ref for ${key} is not available`);
        resolve();
        return;
      }
      ref.current.measure((x, y, width, height, pageX, pageY) => {
        setTourTargets((prev) => ({
          ...prev,
          [key]: { key, x: pageX, y: pageY, width, height } as TourTarget,
        }));
        resolve();
      });
    });
  };

  const measureAllTargets = async () => {
    try {
      await Promise.all([
        measureRef(fabRef, 'fab'),
        measureRef(playBtnRef, 'play'),
        measureRef(menuBtnRef, 'menu'),
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

  // 2. Once all 4 targets are measured, show the tour
  useEffect(() => {
    const allReady = (['fab', 'play', 'menu', 'statusTab'] as TourStepKey[]).every(k => tourTargets[k]);
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

  const loadConversations = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      const [convs, statuses] = await Promise.all([chatAPI.getConversations(), StatusService.getStatuses()]);
      let conversationsArray: Conversation[] = [];
      if (Array.isArray(convs)) conversationsArray = convs;
      else if (convs?.results) conversationsArray = convs.results;
      conversationsArray = conversationsArray.filter(c => !deletedConversationIdsRef.current.has(c.id));
      setConversations(conversationsArray);
      setStatusGroups(StatusService.groupByUser(statuses.filter(s => s.user_id !== user?.id)));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isLoadingRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    loadConversations();
    websocketService.connectToNotifications().catch(err => console.error('Notification connection failed:', err));

    const unsubscribe = websocketService.onMessage((message) => {
        if (message.type === 'new_message_summary') {
            const newMessage = message.data;
            setConversations(prev => {
                const existing = prev.find(c => c.id === newMessage.conversation);
                if (existing) {
                    const isOwnMessage = newMessage.sender.id === user?.id;
                    const updated = { 
                        ...existing, 
                        last_message: {
                            id: newMessage.id,
                            content: newMessage.content,
                            message_type: newMessage.message_type,
                            created_at: newMessage.created_at,
                            sender_id: newMessage.sender.id
                        },
                        unread_count: isOwnMessage ? (existing.unread_count || 0) : (existing.unread_count || 0) + 1 
                    };
                    return [updated, ...prev.filter(c => c.id !== newMessage.conversation)];
                }
                loadConversations();
                return prev;
            });
        }
    });

    const readSub = DeviceEventEmitter.addListener('conversation_read', ({ conversationId }) => {
        setConversations(prev => prev.map(c => 
            c.id === parseInt(conversationId, 10) ? { ...c, unread_count: 0 } : c
        ));
    });

    return () => { 
        websocketService.disconnectRoom();
        unsubscribe();
        readSub.remove();
    };
  }, [loadConversations]);

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
        ) : null
      ),
      headerLeft: () => (
        selectionMode ? (
          <TouchableOpacity style={{marginLeft: 16}} onPress={() => { setSelectionMode(false); setSelectedIds([]); }}>
              <Text style={{color: '#666', fontSize: 16}}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16 }}>
              <Image
                  source={require('../../assets/logo.png')}
                  style={{ width: 35, height: 35, borderRadius: 14, marginRight: 8 }}
              />
              <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#8212c7' }}>DME</Text>
          </View>
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
                <View ref={playBtnRef} collapsable={false}>
                  <TouchableOpacity
                    onPress={() => {
                      if (activeRoomCode) {
                        DeviceEventEmitter.emit('minimize_music_room', false);
                      } else {
                        navigation.navigate('YouTubeDiscovery', {});
                      }
                    }}
                    style={{ marginRight: 16 }}
                  >
                    {activeRoomCode ? (
                      <Animated.View style={{ transform: [{ rotate: spin }] }}>
                        <LinearGradient
                          colors={['#FF007F', '#00FFFF', '#FFD700', '#7F00FF']}
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
                      <LinearGradient
                        colors={['#FF007F', '#7F00FF']}
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
                        <Icon name="play" size={14} color="#fff" style={{ marginLeft: 2 }} />
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                </View>
                <View ref={menuBtnRef} collapsable={false}>
                  <TouchableOpacity onPress={() => setMenuVisible(true)}>
                      <Icon name="ellipsis-vertical" size={24} color="#8100D1" />
                  </TouchableOpacity>
                </View>
             </>
          )}
        </View>
      ),
      headerStyle: { backgroundColor: selectionMode ? '#F8F0FF' : '#fff', elevation: 0, shadowOpacity: 0, borderBottomWidth: 0 },
    });
  }, [navigation, selectionMode, selectedIds, handleBatchDelete, activeRoomCode]);

  return (
    <View style={styles.container}>
      <PopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
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
            Alert.alert('App Update', 'You are on the latest version of DME.');
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
            <ActivityIndicator size="large" color="#8100D1" style={{ marginBottom: 16 }} />
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
                backgroundColor: '#8100D1',
              }} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#8100D1' }}>
              {downloadProgress}%
            </Text>
          </View>
        </View>
      </Modal>
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12 }}>
          <Icon name="search" size={20} color="#888" />
          <TextInput
            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 16, color: '#333' }}
            placeholder="Search by name..."
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={20} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        ListHeaderComponent={
          <View style={[styles.tabContainer, { backgroundColor: '#fff', paddingBottom: 8 }]}>
            {activeTab === 'all' ? (
              <TouchableOpacity style={{ flex: 1, marginHorizontal: 4 }} onPress={() => setActiveTab('all')}>
                <LinearGradient
                  colors={['#FF007F', '#7F00FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 1.5, borderRadius: borderRadius.lg || 8 }}
                >
                  <View style={{
                    backgroundColor: '#FFFFFF',
                    paddingVertical: (spacing.sm || 8) - 1.5,
                    alignItems: 'center',
                    borderRadius: (borderRadius.lg || 8) - 1.5,
                  }}>
                    <Text style={[styles.tabText, styles.activeTabText]}>Chats</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[
                  styles.tabButton, 
                  { 
                    borderWidth: 1, 
                    borderColor: '#CCCCCC', 
                    marginHorizontal: 4,
                    paddingVertical: (spacing.sm || 8) - 1,
                  }
                ]} 
                onPress={() => setActiveTab('all')}
              >
                <Text style={styles.tabText}>Chats</Text>
              </TouchableOpacity>
            )}

            {activeTab === 'groups' ? (
              <TouchableOpacity style={{ flex: 1, marginHorizontal: 4 }} onPress={() => setActiveTab('groups')}>
                <LinearGradient
                  colors={['#FF007F', '#7F00FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 1.5, borderRadius: borderRadius.lg || 8 }}
                >
                  <View style={{
                    backgroundColor: '#FFFFFF',
                    paddingVertical: (spacing.sm || 8) - 1.5,
                    alignItems: 'center',
                    borderRadius: (borderRadius.lg || 8) - 1.5,
                  }}>
                    <Text style={[styles.tabText, styles.activeTabText]}>Groups</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[
                  styles.tabButton, 
                  { 
                    borderWidth: 1, 
                    borderColor: '#CCCCCC', 
                    marginHorizontal: 4,
                    paddingVertical: (spacing.sm || 8) - 1,
                  }
                ]} 
                onPress={() => setActiveTab('groups')}
              >
                <Text style={styles.tabText}>Groups</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        data={conversations.filter(c => {
          const matchesTab = activeTab === 'all' || c.is_group;
          if (!matchesTab) return false;
          
          if (searchQuery.trim()) {
            const displayName = c.is_group 
              ? (c.name || 'Group') 
              : (c.other_user?.display_name || c.other_user?.email || 'User');
            return displayName.toLowerCase().startsWith(searchQuery.trim().toLowerCase());
          }
          return true;
        })}
  
       
        renderItem={({ item }) => {
          const isSelected = selectedIds.includes(item.id);
          const userId = item.is_group ? null : item.other_user?.id;
          const userStatuses = userId ? statusGroups.find(g => g.user_id === userId)?.statuses : [];
          const hasStatus = userStatuses && userStatuses.length > 0;
          
          let isOnline = false;
          if (!item.is_group && item.other_user) {
            const isPrivacyNobody = item.other_user.last_seen_privacy === 'nobody';
            if (!isPrivacyNobody) {
              const lastSeen = new Date(item.other_user.last_seen).getTime();
              const now = Date.now();
              isOnline = (now - lastSeen) < 120000;
            }
          }

          return (
            <TouchableOpacity
              style={[styles.conversationItem, isSelected && styles.logItemSelected]}
              onPress={() => {
                if (selectionMode) {
                  toggleSelection(item.id);
                } else {
                  navigation.navigate('ChatRoom', { conversationId: item.id, name: item.is_group ? (item.name || 'Group') : (item.other_user?.display_name || 'User') });
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
                <View style={styles.checkboxContainer}>
                  <Icon name={isSelected ? "checkbox" : "square-outline"} size={22} color="#8100D1" />
                </View>
              )}
              <View style={{ position: 'relative' }}>
                <AvatarWithFallback
                  uri={item.is_group ? item.profile_picture : item.other_user?.profile_picture}
                  sticker={item.is_group ? null : item.other_user?.avatar_sticker}
                  displayName={item.is_group
                    ? (item.name || 'Group')
                    : (item.other_user?.display_name || item.other_user?.email || 'User')}
                  isGroup={item.is_group}
                  style={{
                    width:        50,
                    height:       50,
                    borderRadius: 25,
                    ...(hasStatus && { borderWidth: 2.5, borderColor: '#8100D1', }),
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
                {!item.is_group && isOnline && <View style={styles.onlineDot} />}
              </View>
              <View style={styles.content}>
                <Text style={styles.name}>{String(item.is_group ? (item.name || 'Group') : (item.other_user?.display_name || item.other_user?.email || 'User') || '')}</Text>
                <Text style={styles.lastMessage} numberOfLines={1}>{renderLastMessage(item.last_message)}</Text>
              </View>
              <View style={styles.rightContent}>
                <Text style={styles.time}>{formatMessageTime(item.last_message?.created_at)}</Text>
                {item.unread_count > 0 && (
                  <View style={styles.unreadBadge}>
                      <Text style={styles.unreadCount}>{item.unread_count}</Text>
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
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 220 }}>
              <Icon name="chatbubble-ellipses-outline" size={44} color="#E0D0F5" />
              <Text style={{ fontSize: 16, fontWeight: '400', color: '#c2c2c2', marginTop: 6 }}>
                No conversations yet
              </Text>
              
            </View>
          ) : null
        }
      />
      <Modal visible={previewData.visible} transparent={true} animationType="none">
        <TouchableOpacity 
          style={styles.modalOverlay} 
          onPress={() => setPreviewData(p => ({ ...p, visible: false }))}
          activeOpacity={1}
        >
            <View style={styles.previewContainer}>
                <AvatarWithFallback
                    uri={previewData.uri}
                    sticker={previewData.sticker}
                    displayName={previewData.displayName}
                    isGroup={previewData.isGroup}
                    style={styles.previewImage}
                />
                <Text style={styles.previewName}>{String(previewData.displayName || '')}</Text>
            </View>
        </TouchableOpacity>
      </Modal>
      <View ref={fabRef} collapsable={false} style={styles.fabWrapper}>
        <TouchableOpacity style={styles.composeButton} onPress={() => navigation.navigate('NewChat')}>
          <Icon name="person-add-outline" size={25} color="#FFF" />
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

const THEME_COLOR = '#8100D1';
const BG_COLOR = '#E8DEF8';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: { backgroundColor: '#E8DEF8', borderWidth: 1, borderColor: THEME_COLOR, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: THEME_COLOR, fontSize: fontSize.lg, fontWeight: 'bold' },
  conversationItem: { flexDirection: 'row', backgroundColor: '#FFFFFF', padding: spacing.md },
  content: { flex: 1, justifyContent: 'center', marginLeft: spacing.md },
  name: { fontSize: fontSize.lg, fontWeight: '600', color: '#000' },
  lastMessage: { fontSize: fontSize.md, color: '#666' },
  tabContainer: { flexDirection: 'row', padding: spacing.sm },
  tabButton: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: borderRadius.lg, shadowRadius: 2 },
  activeTabButton: { backgroundColor: '#FFFFFF', elevation: 2, shadowRadius: 2 },
  tabText: { fontSize: fontSize.md, fontWeight: '500', color: '#666' },
  activeTabText: { color: THEME_COLOR, fontWeight: '700' },
  logItemSelected: {
    backgroundColor: '#F8F0FF',
  },
  checkboxContainer: {
    marginRight: 10,
    justifyContent: 'center',
  },
  popover: { position: 'absolute', top: 50, right: 16, width: 180, backgroundColor: '#fff', borderRadius: 8, padding: 8, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 1000 },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  popoverText: { fontSize: 14, color: '#333' },
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
  fabWrapper: { position: 'absolute', bottom: spacing.xxl, right: spacing.xl },
  composeButton: { width: 60, height: 50, borderTopLeftRadius: 25, borderBottomLeftRadius: 10, borderBottomEndRadius: 10, backgroundColor: THEME_COLOR, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },

  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#25D366',
    borderWidth: 2,
    borderColor: '#fff',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  previewContainer: { width: 300, backgroundColor: '#FFF', borderRadius: 16, padding: 20, alignItems: 'center' },
  previewImage: { width: 280, height: 280, borderRadius: 140, marginBottom: 16 },
  previewPlaceholder: { width: 200, height: 200, borderRadius: 150, backgroundColor: BG_COLOR, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  previewText: {fontSize: 180, fontWeight: 'bold', color: THEME_COLOR },
  previewName: { fontSize: 20, fontWeight: 'bold' },
  unreadBadge: {
    backgroundColor: '#8100D1',
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
    color: '#666',
    marginBottom: 4,
  },
});