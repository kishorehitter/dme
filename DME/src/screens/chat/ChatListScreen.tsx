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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../context/AuthContext';
import { chatAPI } from '../../services/api';
import { websocketService, WebSocketMessage } from '../../services/websocket';
import { StatusService, Status, UserStatusGroup } from '../../services/StatusService';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { Conversation } from '../../types';

interface ChatListScreenProps {
  navigation: any;
}

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

    return (
      <View style={styles.conversationItem}>
        {/* Avatar triggered: Status/Preview */}
        <TouchableOpacity
          onPress={() => {
            if (hasStatus && userStatus) {
              navigation.navigate('StatusViewer', { 
                statuses: userStatus.statuses, 
                initialIndex: 0,
                currentUserId: user?.id,
                isOwn: false
              });
            } else {
              // Optionally show a full-screen image preview here if no status
              Alert.alert('Profile', 'Showing profile picture preview...');
            }
          }}
          style={[styles.avatarContainer, hasStatus && styles.avatarRingContainer, ringStyle]}
        >
          {avatarSticker ? (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.stickerAvatar}>{avatarSticker}</Text>
            </View>
          ) : profilePicture ? (
            <Image source={{ uri: profilePicture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
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
    <View style={styles.container}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
