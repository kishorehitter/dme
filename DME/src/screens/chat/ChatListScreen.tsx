import React, { useState, useEffect, useCallback, useRef } from 'react';
import AvatarWithFallback from '../../components/AvatarWithFallback';
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
  StatusBar,
  Platform,
  Modal,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import { MediaPickerModal } from '../../components/MediaPickerModal';

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
  visible, onClose, onNewGroup, onClearAll, onProfile, onLogout, onSelect
}: { 
  visible: boolean, onClose: () => void, onNewGroup: () => void, onClearAll: () => void,
  onProfile: () => void, onLogout: () => void, onSelect: () => void
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}>
        <View style={styles.popover}>
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
          <TouchableOpacity style={[styles.popoverItem, { borderTopWidth: 1, borderColor: '#eee', marginTop: 4 }]} onPress={() => { onClose(); onLogout(); }}>
            <Icon name="log-out-outline" size={20} color="#F44336" />
            <Text style={[styles.popoverText, { color: '#F44336' }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ navigation }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'groups'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [cameraMenuVisible, setCameraMenuVisible] = useState(false);
  const { user, logout } = useAuth();
  const isLoadingRef = useRef(false);
  const deletedConversationIdsRef = useRef<Set<number>>(new Set());

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

  const handleAddStatus = () => {
    setCameraMenuVisible(true);
  };

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitleAlign: selectionMode ? 'center' : 'left',
      headerTitle: () => (
        !selectionMode ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Image
                    source={require('../../assets/logo.png')}
                    style={{ width: 35, height: 35, borderRadius: 14, marginRight: 8 }}
                />
                <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#8212c7' }}>DME</Text>
            </View>
        ) : (
            <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#8212c7' }}>{selectedIds.length} Selected</Text>
        )
      ),
      headerLeft: selectionMode ? () => (
        <TouchableOpacity style={{marginLeft: 16}} onPress={() => { setSelectionMode(false); setSelectedIds([]); }}>
            <Text style={{color: '#666', fontSize: 16}}>Cancel</Text>
        </TouchableOpacity>
      ) : undefined,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
          {selectionMode ? (
            <TouchableOpacity style={{ marginRight: 16 }} onPress={handleBatchDelete} disabled={selectedIds.length === 0}>
                <Text style={{color: '#F44336', fontWeight: 'bold'}}>Delete</Text>
            </TouchableOpacity>
          ) : (
             <>
                <TouchableOpacity onPress={handleAddStatus} style={{ marginRight: 16 }} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                    <Icon name="camera-outline" size={24} color="#000" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMenuVisible(true)}>
                    <Icon name="ellipsis-vertical" size={24} color="#8100D1" />
                </TouchableOpacity>
             </>
          )}
        </View>
      ),
      headerStyle: { backgroundColor: selectionMode ? '#F8F0FF' : '#fff', elevation: 2, shadowOpacity: 0.1 },
    });
  }, [navigation, selectionMode, selectedIds, handleBatchDelete]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <PopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
        onNewGroup={() => { setMenuVisible(false); navigation.navigate('CreateGroup'); }}
        onClearAll={() => { setMenuVisible(false); handleClearAll(); }}
        onProfile={() => { setMenuVisible(false); navigation.navigate('Profile'); }}        onLogout={() => { setMenuVisible(false); handleLogout(); }}
        onSelect={() => { setMenuVisible(false); setSelectionMode(true); }}
      />
      <MediaPickerModal 
          visible={cameraMenuVisible} 
          onClose={() => setCameraMenuVisible(false)}
          top={Platform.OS === 'ios' ? 50 : 40}
          right={16}
          onMediaSelected={(asset, type) => {
              navigation.navigate('StatusEditor', {
                mediaUri: asset.uri,
                mediaType: type === 'image' ? 'photo' : 'video',
                source: 'camera',
              });
          }}
      />
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'all' && styles.activeTabButton]} onPress={() => setActiveTab('all')}>
          <Text style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>Chats</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'groups' && styles.activeTabButton]} onPress={() => setActiveTab('groups')}>
          <Text style={[styles.tabText, activeTab === 'groups' && styles.activeTabText]}>Groups</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={conversations.filter(c => activeTab === 'all' || c.is_group)}
        renderItem={({ item }) => {
          const isSelected = selectedIds.includes(item.id);
          const userId = item.is_group ? null : item.other_user?.id;
          const userStatuses = userId ? statusGroups.find(g => g.user_id === userId)?.statuses : [];
          const hasStatus = userStatuses && userStatuses.length > 0;

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
              />
              <View style={styles.content}>
                <Text style={styles.name}>{String(item.is_group ? (item.name || 'Group') : (item.other_user?.display_name || item.other_user?.email || 'User') || '')}</Text>
                <Text style={styles.lastMessage}>{String(item.last_message?.content || '')}</Text>
              </View>
              {item.unread_count > 0 && (
                <View style={styles.unreadBadge}>
                    <Text style={styles.unreadCount}>{item.unread_count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        keyExtractor={(item) => item.id.toString()}
        extraData={conversations}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadConversations} tintColor={THEME_COLOR} />}
      />
      <Modal visible={previewData.visible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setPreviewData(p => ({ ...p, visible: false }))}>
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
      <TouchableOpacity style={styles.composeButton} onPress={() => navigation.navigate('NewChat')}>
        <Text style={styles.composeButtonText}>+</Text>
      </TouchableOpacity>
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
  conversationItem: { flexDirection: 'row', backgroundColor: '#FFFFFF', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  content: { flex: 1, justifyContent: 'center', marginLeft: spacing.md },
  name: { fontSize: fontSize.lg, fontWeight: '600', color: '#000' },
  lastMessage: { fontSize: fontSize.md, color: '#666' },
  tabContainer: { flexDirection: 'row', padding: spacing.sm, backgroundColor: '#F8F8F8', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  tabButton: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: borderRadius.md },
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
  composeButton: { position: 'absolute', bottom: spacing.xxl, right: spacing.xl, width: 60, height: 60, borderRadius: 30, backgroundColor: THEME_COLOR, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  composeButtonText: { color: '#FFF', fontSize: 36, fontWeight: '300', marginTop: -4 },
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
});
