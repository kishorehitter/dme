import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  StatusBar,
  Platform,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
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

const ImageWithFallback = ({ uri, isGroup, displayName, style }: any) => {
  const [error, setError] = useState(false);

  if (!uri || error) {
    if (isGroup) {
      return (
        <View style={[style, { backgroundColor: BG_COLOR, justifyContent: 'center', alignItems: 'center' }]}>
          <Icon name="people" size={28} color="#8100D1" />
        </View>
      );
    }
    return (
      <View style={[style, styles.avatarPlaceholder]}>
        <Text style={styles.avatarText}>
          {(displayName || 'U').charAt(0).toUpperCase()}
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

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'groups'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user, logout } = useAuth();
  const isLoadingRef = useRef(false);
  const deletedConversationIdsRef = useRef<Set<number>>(new Set());

  const [previewData, setPreviewData] = useState<{
    visible: boolean;
    uri: string | null;
    isGroup: boolean;
    displayName: string;
    sticker: string | null;
  }>({
    visible: false,
    uri: null,
    isGroup: false,
    displayName: '',
    sticker: null,
  });

  const loadConversations = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      const [convs, statuses] = await Promise.all([
        chatAPI.getConversations(),
        StatusService.getStatuses()
      ]);
      
      let conversationsArray: Conversation[] = [];
      if (Array.isArray(convs)) conversationsArray = convs;
      else if (convs?.results) conversationsArray = convs.results;
      
      conversationsArray = conversationsArray.filter(c => !deletedConversationIdsRef.current.has(c.id));
      setConversations(conversationsArray);
      setStatusGroups(StatusService.groupByUser(statuses.filter(s => s.user_id !== user?.id)));
    } catch (error: any) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isLoadingRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    loadConversations();

    // Connect to WebSocket for real-time updates
    websocketService.connectToChatList();

    // Listen for WebSocket events to update the chat list immediately
    const unsubscribe = websocketService.onMessage((wsMessage: WebSocketMessage) => {
      if (wsMessage.type === 'message' && wsMessage.data) {
        console.log('📋 Real-time message received, updating chat list');
        const newMessage = wsMessage.data;
        const conversationId = newMessage.conversation;

        setConversations(prev => prev.map(conv => {
          if (conv.id === conversationId) {
            return {
              ...conv,
              last_message: newMessage,
              unread_count: conv.unread_count + 1
            };
          }
          return conv;
        }));
      } else if (wsMessage.type === 'read_receipt') {
        loadConversations();
      }
    });

    // Poll for new messages every 30 seconds
    const pollInterval = setInterval(() => {
      loadConversations();
    }, 30000);

    // Listen for local message sent (from notification)
    const localSub = DeviceEventEmitter.addListener('local_message_sent', (data) => {
      console.log('📋 Local message sent from notification, refreshing chat list');
      loadConversations();
    });

    return () => {
      clearInterval(pollInterval);
      unsubscribe();
      localSub.remove();
      websocketService.disconnect();
    };
  }, []); // Empty array - only runs on mount

  // Refresh chat list when screen comes into focus (user navigates back from chat room)
  useEffect(() => {
    const focusSubscription = navigation.addListener('focus', () => {
      console.log('📋 Chat list focused, refreshing...');
      loadConversations();
    });
    return focusSubscription;
  }, [navigation, loadConversations]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadConversations();
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  const handleLongPressConversation = (item: Conversation) => {
    const displayName = item.is_group
      ? item.name || 'Group Chat'
      : item.other_user?.display_name || item.other_user?.first_name || 'Unknown';

    Alert.alert(
      item.is_group ? 'Group Options' : 'Chat Options',
      displayName,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: item.is_group ? 'Leave Group' : 'Delete Chat',
          style: 'destructive',
          onPress: () => handleDeleteConversation(item.id, displayName),
        },
      ]
    );
  };

  const handleDeleteConversation = async (conversationId: number, conversationName: string) => {
    Alert.alert(
      'Delete Chat',
      `Are you sure you want to delete "${conversationName}"? This will remove the chat from your list but messages will remain for the other person.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Disconnect WebSocket if connected to this conversation
              websocketService.disconnect();

              // Call API to delete conversation (clears messages and removes from list)
              await chatAPI.deleteConversation(conversationId);
              console.log(`Conversation ${conversationId} deleted successfully`);
              
              // Reload conversations to reflect the deletion
              loadConversations();
              
              Toast.show({ 
                type: 'success', 
                text1: 'Chat deleted', 
                text2: 'Conversation removed from your list',
                position: 'bottom' 
              });
            } catch (error: any) {
              console.error('Error deleting conversation:', error);
              Toast.show({ 
                type: 'error', 
                text1: 'Failed to delete', 
                text2: error?.response?.data?.error || 'Please try again',
                position: 'bottom' 
              });
            }
          },
        },
      ]
    );
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const displayName = item.is_group
      ? item.name || 'Group Chat'
      : item.other_user?.display_name || item.other_user?.first_name || 'Unknown';

    const profilePicture = item.is_group
      ? item.profile_picture
      : item.other_user?.profile_picture;

    const avatarSticker = item.is_group
      ? null
      : item.other_user?.avatar_sticker;

    const lastMessage = item.last_message?.content || 'No messages yet';
    const time = item.last_message?.created_at
      ? formatTime(item.last_message.created_at)
      : '';

    // Determine status ring style
    const userStatus = !item.is_group && item.other_user ? statusGroups.find(g => g.user_id === item.other_user?.id) : null;
    const hasStatus = !!userStatus;
    const allSeen = hasStatus ? !userStatus!.has_unseen : true;
    const ringStyle = hasStatus 
      ? allSeen ? styles.statusViewedRing : styles.statusNewRing
      : {};

    const handleAvatarPress = () => {
      if (hasStatus && userStatus) {
        navigation.navigate('StatusViewer', { 
          statuses: userStatus.statuses, 
          initialIndex: 0,
          currentUserId: user?.id,
          isOwn: false
        });
      } else {
        // No status, show profile/group info
        if (item.is_group) {
          navigation.navigate('GroupInfo', { conversationId: item.id });
        } else if (item.other_user) {
          navigation.navigate('Profile', { user: item.other_user, conversationId: item.id });
        }
      }
    };

    const handleAvatarLongPress = () => {
      setPreviewData({
        visible: true,
        uri: profilePicture,
        isGroup: item.is_group,
        displayName: displayName,
        sticker: avatarSticker,
      });
    };

    return (
      <View style={styles.conversationItem}>
        {/* Avatar triggered: Status/Preview on tap, Square Preview on long press */}
        <TouchableOpacity
          onPress={handleAvatarPress}
          onLongPress={handleAvatarLongPress}
          delayLongPress={300}
          style={[styles.avatarContainer, hasStatus && styles.avatarRingContainer, ringStyle]}
        >
          {avatarSticker ? (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.stickerAvatar}>{avatarSticker}</Text>
            </View>
          ) : (
            <ImageWithFallback
              uri={profilePicture}
              isGroup={item.is_group}
              displayName={displayName}
              style={styles.avatar}
            />
          )}
        </TouchableOpacity>

        {/* Content triggered: Open Chat */}
        <TouchableOpacity
          style={styles.content}
          onPress={() => navigation.navigate('ChatRoom', { conversationId: item.id, name: displayName })}
          onLongPress={() => {
            handleLongPressConversation(item);
          }}
        >
          <View style={styles.contentHeader}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.time}>{time}</Text>
          </View>
          <Text style={styles.lastMessage} numberOfLines={1}>{lastMessage}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const EmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>💬</Text>
      <Text style={styles.emptyTitle}>No conversations yet</Text>
      <Text style={styles.emptySubtitle}>
        Start a new chat by tapping the compose button
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const filteredConversations = conversations.filter(c => {
    if (activeTab === 'groups') return c.is_group;
    return true; // Show all for 'all' tab
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Quick Preview Modal */}
      <Modal
        visible={previewData.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewData(prev => ({ ...prev, visible: false }))}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPreviewData(prev => ({ ...prev, visible: false }))}
        >
          <View style={styles.quickPreviewContainer}>
            <View style={styles.quickPreviewHeader}>
              <Text style={styles.quickPreviewTitle} numberOfLines={1}>{previewData.displayName}</Text>
            </View>
            <View style={styles.quickPreviewImageContainer}>
              {previewData.sticker ? (
                <View style={[styles.quickPreviewAvatar, styles.avatarPlaceholder, { borderRadius: 0 }]}>
                  <Text style={{ fontSize: 120 }}>{previewData.sticker}</Text>
                </View>
              ) : (
                <ImageWithFallback
                  uri={previewData.uri}
                  isGroup={previewData.isGroup}
                  displayName={previewData.displayName}
                  style={[styles.quickPreviewAvatar, { borderRadius: 0 }]}
                  largeLetter={true}
                />
              )}
            </View>
            <View style={styles.quickPreviewFooter}>
              <TouchableOpacity
                style={styles.quickPreviewAction}
                onPress={() => {
                  setPreviewData(prev => ({ ...prev, visible: false }));
                  const conv = conversations.find(c => {
                    const dName = c.is_group 
                      ? c.name || 'Group Chat'
                      : c.other_user?.display_name || c.other_user?.first_name || 'Unknown';
                    return dName === previewData.displayName;
                  });
                  if (conv) {
                    navigation.navigate('ChatRoom', { 
                      conversationId: conv.id, 
                      name: previewData.displayName 
                    });
                  }
                }}
              >
                <Icon name="chatbubble" size={24} color={THEME_COLOR} />
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.quickPreviewAction}
                onPress={() => {
                  setPreviewData(prev => ({ ...prev, visible: false }));
                  const conv = conversations.find(c => {
                    const dName = c.is_group 
                      ? c.name || 'Group Chat'
                      : c.other_user?.display_name || c.other_user?.first_name || 'Unknown';
                    return dName === previewData.displayName;
                  });
                  if (conv) {
                    navigation.navigate('Call', {
                      callType: 'audio',
                      conversationId: conv.id,
                      initiating: true,
                      isGroupCall: conv.is_group,
                      remoteUserId: conv.other_user?.id,
                      remoteUserName: previewData.displayName,
                      remoteUserPic: previewData.uri
                    });
                  }
                }}
              >
                <Icon name="call" size={24} color={THEME_COLOR} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickPreviewAction}
                onPress={() => {
                  setPreviewData(prev => ({ ...prev, visible: false }));
                  const conv = conversations.find(c => {
                    const dName = c.is_group 
                      ? c.name || 'Group Chat'
                      : c.other_user?.display_name || c.other_user?.first_name || 'Unknown';
                    return dName === previewData.displayName;
                  });
                  if (conv) {
                    if (conv.is_group) {
                      navigation.navigate('GroupInfo', { conversationId: conv.id });
                    } else if (conv.other_user) {
                      navigation.navigate('Profile', { user: conv.other_user, conversationId: conv.id });
                    }
                  }
                }}
              >
                <Icon name="information-circle" size={26} color={THEME_COLOR} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'all' && styles.activeTabButton]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>Chats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'groups' && styles.activeTabButton]}
          onPress={() => setActiveTab('groups')}
        >
          <Text style={[styles.tabText, activeTab === 'groups' && styles.activeTabText]}>Groups</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredConversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={EmptyComponent}
        contentContainerStyle={
          conversations.length === 0 ? styles.emptyList : {}
        }
      />

      {/* Compose Button */}
      <TouchableOpacity
        style={styles.composeButton}
        onPress={() => navigation.navigate('NewChat')}
      >
        <Text style={styles.composeButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
};

const THEME_COLOR = '#8100D1';
const BG_COLOR = '#E8DEF8';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickPreviewContainer: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 0, // Square like WhatsApp
    overflow: 'hidden',
  },
  quickPreviewHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 10,
    zIndex: 10,
  },
  quickPreviewTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '500',
  },
  quickPreviewImageContainer: {
    width: 280,
    height: 280,
  },
  quickPreviewAvatar: {
    width: 280,
    height: 280,
  },
  quickPreviewFooter: {
    flexDirection: 'row',
    height: 50,
    backgroundColor: '#FFFFFF',
  },
  quickPreviewAction: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    padding: spacing.sm,
    backgroundColor: '#F8F8F8',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  activeTabButton: {
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabText: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: THEME_COLOR,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  conversationItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  avatarContainer: {
    marginRight: spacing.md,
  },
  avatarRingContainer: {
    padding: 2,
    borderRadius: 29,
  },
  statusNewRing: {
    borderWidth: 2,
    borderColor: '#8100D1', // Purple
  },
  statusViewedRing: {
    borderWidth: 2,
    borderColor: '#CCC', // Light Grey
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: THEME_COLOR,
    fontSize: fontSize.xl,
    fontWeight: 'bold',
  },
  stickerAvatar: {
    fontSize: 36,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  contentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: '#000',
    flex: 1,
  },
  time: {
    fontSize: fontSize.xs,
    color: '#999',
    marginLeft: spacing.sm,
  },
  contentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: fontSize.md,
    color: '#666',
    flex: 1,
  },
  badge: {
    backgroundColor: THEME_COLOR,
    borderRadius: borderRadius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    marginLeft: spacing.sm,
  },
  badgeText: {
    color: '#FFF',
    fontSize: fontSize.xs,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: '#000',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: '#666',
    textAlign: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
  composeButton: {
    position: 'absolute',
    bottom: spacing.xxl,
    right: spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: THEME_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  composeButtonText: {
    color: '#FFF',
    fontSize: 36,
    fontWeight: '300',
    marginTop: -4,
  },
});

export default ChatListScreen;
