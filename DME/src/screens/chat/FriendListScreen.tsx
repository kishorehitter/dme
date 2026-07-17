import React, { useState, useEffect, useRef, useCallback } from 'react';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatAPI, callsAPI } from '../../services/api';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { User } from '../../types';
import { getApiUrl } from '../../config/network';
import Icon from 'react-native-vector-icons/Ionicons';

interface FriendListScreenProps {
  navigation: any;
  route: any;
}

type HubTab = 'friends' | 'requests' | 'approve';

// ── Animated add-person button ──────────────────────────────────────────────
const AnimatedAddButton = ({
  friendStatus,
  onAdd,
  onCancel,
}: {
  friendStatus: string;
  onAdd: () => void;
  onCancel: () => void;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  const runPop = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.4, duration: 120, useNativeDriver: true, easing: Easing.out(Easing.back(2)) }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    Animated.timing(checkAnim, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  };

  const handleAdd = () => {
    runPop();
    onAdd();
  };

  if (friendStatus === 'sent_pending') {
    return (
      <Animated.View style={[styles.pendingPill, { transform: [{ scale: scaleAnim }] }]}>
        <Icon name="time-outline" size={13} color="#FF9800" />
        <Text style={styles.pendingPillText}>Sent</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="close-circle" size={15} color="#aaa" />
        </TouchableOpacity>
      </Animated.View>
    );
  }

  if (friendStatus === 'received_pending') {
    return (
      <View style={styles.choiceRow}>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAdd}>
          <Icon name="checkmark" size={14} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectBtn} onPress={onCancel}>
          <Icon name="close" size={14} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  }

  if (friendStatus === 'friends') {
    return (
      <View style={styles.friendsBadge}>
        <Icon name="people" size={13} color="#4CAF50" />
        <Text style={styles.friendsBadgeText}>Friends</Text>
      </View>
    );
  }

  // none
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={styles.addPersonBtn} onPress={handleAdd}>
        <Icon name="person-add" size={18} color="#4597f5" />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Main Screen ──────────────────────────────────────────────────────────────
export const FriendListScreen: React.FC<FriendListScreenProps> = ({ navigation, route }) => {
  const isAdding = route?.params?.isAdding || false;
  const isInvitingToCall = route?.params?.isInvitingToCall || false;
  const initialConversationId = route?.params?.conversationId;
  const receiverId = route?.params?.receiverId;
  const existingMemberIds = route?.params?.existingMemberIds || [];

  React.useLayoutEffect(() => {
    if (isInvitingToCall) {
      navigation.setOptions({
        title: 'Invite to Call',
        headerTitleStyle: { color: '#000000', fontWeight: 'bold' },
        headerTintColor: '#000000',
      });
    } else if (isAdding) {
      navigation.setOptions({
        title: 'Add Member',
        headerTitleStyle: { color: '#000000', fontWeight: 'bold' },
        headerTintColor: '#000000',
      });
    }
  }, [navigation, isAdding, isInvitingToCall]);

  const [conversationId, setConversationId] = useState(initialConversationId);
  const [activeTab, setActiveTab] = useState<HubTab>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // People search
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Friends list
  const [friends, setFriends] = useState<User[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);

  // Friend requests: incoming (to approve) and outgoing (sent by me)
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<any[]>([]);
  const [sentFriendRequests, setSentFriendRequests] = useState<any[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Keep a combined friendRequests for backward-compat with search helpers
  const friendRequests = [...incomingFriendRequests, ...sentFriendRequests];

  // Group add / call invite mode
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [addModeUsers, setAddModeUsers] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Fallback: fetch conversationId for call invite ──────────────────────────
  useEffect(() => {
    if (!conversationId && receiverId && isInvitingToCall) {
      chatAPI.getOrCreateDirectChat(Number(receiverId))
        .then(c => c?.id && setConversationId(c.id))
        .catch(err => console.error('[FriendList] fetchConversationId error:', err));
    }
  }, [conversationId, receiverId, isInvitingToCall]);

  // ── Debounce search ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 450);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Load friends / requests on mount ────────────────────────────────────────
  const loadFriends = useCallback(async () => {
    setIsLoadingFriends(true);
    try {
      const data = await chatAPI.getFriends();
      setFriends(Array.isArray(data) ? data : (data?.results || []));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFriends(false);
    }
  }, []);

  const loadFriendRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const data = await chatAPI.getFriendRequests();
      // API returns { received: [], sent: [] }
      const received = Array.isArray(data?.received) ? data.received : [];
      const sent = Array.isArray(data?.sent) ? data.sent : [];
      setIncomingFriendRequests(received);
      setSentFriendRequests(sent);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  const loadAddModeUsers = useCallback(async () => {
    if (!isAdding && !isInvitingToCall) return;
    setIsLoadingFriends(true);
    try {
      // ── Call invite mode: show ONLY real friends ──────────────────────────────
      // (not everyone the user has ever chatted with)
      if (isInvitingToCall) {
        const friendsRes = await chatAPI.getFriends();
        const friendsArray: any[] = Array.isArray(friendsRes)
          ? friendsRes
          : (friendsRes?.results || []);

        const users: User[] = friendsArray
          .filter((f: any) => f && f.id)
          .map((f: any) => ({
            id: f.id,
            username: f.username,
            email: f.email,
            display_name: f.display_name,
            profile_picture: f.profile_picture,
            avatar_sticker: f.avatar_sticker,
          } as User));

        setAddModeUsers(users);
        return;
      }

      // ── Group add mode: friends + accepted conversation contacts ─────────────
      const [convs, friendsRes] = await Promise.all([
        chatAPI.getConversations(),
        chatAPI.getFriends()
      ]);
      
      let conversationsArray: any[] = [];
      if (Array.isArray(convs)) {
        conversationsArray = convs;
      } else if (convs?.results) {
        conversationsArray = convs.results;
      }

      let friendsArray: any[] = [];
      if (Array.isArray(friendsRes)) {
        friendsArray = friendsRes;
      } else if (friendsRes?.results) {
        friendsArray = friendsRes.results;
      }
      
      const chatted: User[] = [];
      const seenUserIds = new Set<number>();
      
      // Add friends first
      friendsArray.forEach((friend: any) => {
        if (friend && friend.id && !seenUserIds.has(friend.id)) {
          seenUserIds.add(friend.id);
          chatted.push({
            id: friend.id,
            username: friend.username,
            email: friend.email,
            display_name: friend.display_name,
            profile_picture: friend.profile_picture,
            avatar_sticker: friend.avatar_sticker,
          } as User);
        }
      });

      // Add people who accepted the message request or have no request (e.g. established chats)
      conversationsArray.forEach((c: any) => {
        if (!c.is_group && c.other_user && c.other_user.id) {
          const isPendingOrRejected = c.message_request_status === 'pending' || c.message_request_status === 'rejected';
          if (!isPendingOrRejected && !seenUserIds.has(c.other_user.id)) {
            seenUserIds.add(c.other_user.id);
            chatted.push({
              id: c.other_user.id,
              username: c.other_user.username,
              email: c.other_user.email,
              display_name: c.other_user.display_name,
              profile_picture: c.other_user.profile_picture,
              avatar_sticker: c.other_user.avatar_sticker,
            } as User);
          }
        }
      });

      setAddModeUsers(chatted);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFriends(false);
    }
  }, [isAdding, isInvitingToCall]);

  useEffect(() => {
    if (isAdding || isInvitingToCall) {
      loadAddModeUsers();
    } else {
      loadFriends();
      loadFriendRequests();
    }
  }, [isAdding, isInvitingToCall]);

  // ── People search ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isAdding || isInvitingToCall) return; // Search is handled locally for group add / call invite mode
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const search = async () => {
      setIsSearching(true);
      try {
        const token = await AsyncStorage.getItem('access_token');
        const contactsOnly = (isAdding || isInvitingToCall) ? '&contacts_only=true' : '';
        const res = await fetch(
          getApiUrl(`chat/users/search/?q=${encodeURIComponent(debouncedQuery.trim())}${contactsOnly}`),
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    };
    search();
  }, [debouncedQuery, isAdding, isInvitingToCall]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const startChat = async (user: User) => {
    try {
      const conversation = await chatAPI.getOrCreateDirectChat(user.id);
      navigation.navigate('ChatRoom', {
        conversationId: conversation.id,
        name: user.display_name || user.email || 'Unknown',
        avatarUri: user.profile_picture,
        avatarSticker: user.avatar_sticker,
        isGroup: false,
        otherUser: user,
      });
    } catch {
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleAddFriend = async (userId: number) => {
    try {
      await chatAPI.sendFriendRequest(userId);
      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friend_status: 'sent_pending' } : u));
    } catch {
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  const handleCancelFriendRequest = async (userId: number) => {
    try {
      await chatAPI.cancelFriendRequestByUserId(userId);
    } catch (err) {
      console.warn('Cancel friend request error (non-critical):', err);
    }
    // Update UI optimistically regardless
    setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friend_status: 'none' } : u));
  };

  const handleAcceptFriendRequest = async (requestId: number) => {
    try {
      await chatAPI.acceptFriendRequest(requestId);
      await loadFriendRequests();
      await loadFriends();
    } catch {
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const handleRejectFriendRequest = async (requestId: number) => {
    try {
      await chatAPI.rejectFriendRequest(requestId);
      await loadFriendRequests();
    } catch {
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };

  const handleCancelSentRequest = async (requestId: number) => {
    try {
      await chatAPI.cancelFriendRequest(requestId);
      await loadFriendRequests();
    } catch {
      Alert.alert('Error', 'Failed to cancel friend request');
    }
  };

  const handleAcceptFromSearch = async (userId: number) => {
    const req = friendRequests.find((r: any) => r.sender?.id === userId || r.from_user?.id === userId);
    if (req) await handleAcceptFriendRequest(req.id);
    else {
      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friend_status: 'friends' } : u));
    }
  };

  const handleRejectFromSearch = async (userId: number) => {
    const req = friendRequests.find((r: any) => r.sender?.id === userId || r.from_user?.id === userId);
    if (req) await handleRejectFriendRequest(req.id);
    setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friend_status: 'none' } : u));
  };

  const toggleUserSelection = (userId: number) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.length === 0) return;
    setIsSubmitting(true);
    try {
      await chatAPI.addParticipant(conversationId, selectedUserIds);
      Alert.alert('Success', 'Members added successfully');
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to add members');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentRoomName = route?.params?.roomName;
  const currentCallId = route?.params?.callId;
  const callType = route?.params?.callType;

  const handleInviteToCall = async (user: User) => {
    setIsSubmitting(true);
    try {
      if (!currentRoomName) throw new Error('Missing roomName');
      await callsAPI.inviteToGroupCall(user.id, currentRoomName, currentCallId, callType);
      Alert.alert('Success', `Invitation sent to ${user.display_name || user.email}`);
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to send invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const renderFriendItem = ({ item }: { item: User }) => {
    const displayName = item.display_name || item.email || 'Unknown';
    return (
      <TouchableOpacity style={styles.userRow} onPress={() => startChat(item)} activeOpacity={0.7}>
        <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userSub} numberOfLines={1}>{item.username ? `@${item.username}` : item.email}</Text>
        </View>
        <TouchableOpacity style={styles.chatBtn} onPress={() => startChat(item)}>
          <Icon name="chatbubble-ellipses" size={20} color="#4597f5" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderRequestItem = ({ item }: { item: any }) => {
    const receiver = item.receiver || item.to_user;
    const displayName = receiver?.display_name || receiver?.username || receiver?.email || 'User';
    return (
      <View style={styles.userRow}>
        <AvatarWithFallback uri={receiver?.profile_picture} displayName={displayName} sticker={receiver?.avatar_sticker} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userSub}>Request sent · waiting</Text>
        </View>
        <TouchableOpacity
          style={[styles.rejectBtn, { paddingHorizontal: 10, borderRadius: 6 }]}
          onPress={() => handleCancelSentRequest(item.id)}
        >
          <Icon name="close" size={14} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderApproveItem = ({ item }: { item: any }) => {
    const sender = item.sender || item.from_user;
    const displayName = sender?.display_name || sender?.username || sender?.email || 'User';
    return (
      <View style={styles.userRow}>
        <AvatarWithFallback uri={sender?.profile_picture} displayName={displayName} sticker={sender?.avatar_sticker} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userSub}>Wants to be your friend</Text>
        </View>
        <View style={styles.choiceRow}>
          <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAcceptFriendRequest(item.id)}>
            <Icon name="checkmark" size={15} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => handleRejectFriendRequest(item.id)}>
            <Icon name="close" size={15} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSearchResult = ({ item }: { item: User }) => {
    const displayName = item.display_name || item.email || 'Unknown';
    const isSelected = selectedUserIds.includes(item.id);
    const isAlreadyMember = existingMemberIds.includes(item.id);

    if (isAdding || isInvitingToCall) {
      return (
        <TouchableOpacity
          style={[styles.userRow, isAlreadyMember && { opacity: 0.55 }]}
          onPress={() => {
            if (isAlreadyMember) return;
            if (isInvitingToCall) handleInviteToCall(item);
            else toggleUserSelection(item.id);
          }}
          activeOpacity={0.7}
          disabled={isAlreadyMember}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected, isAlreadyMember && styles.checkboxDisabled]}>
            {(isSelected || isAlreadyMember) && <Icon name="checkmark" size={14} color="#FFF" />}
          </View>
          <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={styles.avatar} />
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{displayName}</Text>
            <Text style={styles.userSub} numberOfLines={1}>{isAlreadyMember ? 'Already a member' : (item.username ? `@${item.username}` : item.email)}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity 
        style={styles.userRow} 
        onPress={() => navigation.navigate('Profile', { user: item })}
        activeOpacity={0.7}
      >
        <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userSub} numberOfLines={1}>{item.username ? `@${item.username}` : item.email}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const isGroupMode = isAdding || isInvitingToCall;
  const hasSearchQuery = debouncedQuery.trim().length > 0;

  const displayData: any[] = isGroupMode
    ? (debouncedQuery.trim() 
        ? addModeUsers.filter(u => {
            const lowerQ = debouncedQuery.trim().toLowerCase();
            return (u.display_name && u.display_name.toLowerCase().includes(lowerQ)) ||
                   (u.username && u.username.toLowerCase().includes(lowerQ)) ||
                   (u.email && u.email.toLowerCase().includes(lowerQ));
          })
        : addModeUsers)
    : hasSearchQuery
    ? searchResults
    : activeTab === 'friends'
    ? friends
    : activeTab === 'requests'
    ? sentFriendRequests
    : incomingFriendRequests;

  const isDisplayLoading = isGroupMode
    ? isSearching || isLoadingFriends
    : hasSearchQuery
    ? isSearching
    : activeTab === 'friends'
    ? isLoadingFriends
    : activeTab === 'requests' || activeTab === 'approve'
    ? isLoadingRequests
    : isSearching;

  const incomingCount = incomingFriendRequests.length;

  return (
    <View style={styles.container}>
      <View style={styles.searchWrapper}>
        <View style={styles.searchBar}>
          <Icon name="search" size={18} color="#888" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder={isInvitingToCall ? 'Search friends...' : isGroupMode ? 'Search contacts...' : 'Search by name or username...'}
            placeholderTextColor="#AAA"
            value={searchQuery}
            onChangeText={v => {
              setSearchQuery(v);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={18} color="#AAA" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isGroupMode && (
        <View style={styles.tabRow}>
          {(['friends', 'approve', 'requests'] as HubTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'friends' ? 'Friends'
                  : tab === 'approve' ? `Requests (${incomingCount})`
                  : `Sent (${sentFriendRequests.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isDisplayLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4597f5" />
        </View>
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={(item, i) => (item?.id ?? i).toString()}
          renderItem={
            isGroupMode
              ? renderSearchResult
              : hasSearchQuery
              ? renderSearchResult
              : activeTab === 'friends'
              ? renderFriendItem
              : activeTab === 'approve'
              ? renderApproveItem
              : renderRequestItem
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyIcon}>
                {hasSearchQuery ? '🔍'
                  : activeTab === 'friends' ? '👥'
                  : activeTab === 'approve' ? '✅'
                  : '📤'}
              </Text>
              <Text style={styles.emptyTitle}>
                {hasSearchQuery ? (debouncedQuery.trim() ? 'No users found' : 'Search for someone')
                  : activeTab === 'friends' ? 'No friends yet'
                  : activeTab === 'approve' ? 'No friend requests received'
                  : 'No sent requests'}
              </Text>
              <Text style={styles.emptySub}>
                {hasSearchQuery ? 'Try a different name or username'
                  : activeTab === 'friends' ? 'Search for people and send friend requests'
                  : activeTab === 'approve' ? 'Incoming friend requests appear here'
                  : 'Friend requests you send appear here'}
              </Text>
            </View>
          }
          contentContainerStyle={displayData.length === 0 ? styles.emptyList : undefined}
        />
      )}

      {isGroupMode && selectedUserIds.length > 0 && (
        <TouchableOpacity
          style={[styles.floatBtn, isSubmitting && { opacity: 0.7 }]}
          onPress={handleAddMembers}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.floatBtnText}>
              {isInvitingToCall ? 'Invite to call' : `Add (${selectedUserIds.length})`}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const BLUE = '#4597f5';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#333',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  tabBtnActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  tabText: { fontSize: 12, color: '#666', fontWeight: '500' },
  tabTextActive: { color: '#FFF', fontWeight: '700' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  avatar: { width: 46, height: 46, borderRadius: 23, marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: '#222', marginBottom: 2 },
  userSub: { fontSize: 13, color: '#888' },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  msgBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAF2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAF2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPersonBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAF2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFB74D',
    gap: 5,
  },
  pendingPillText: { fontSize: 12, color: '#FF9800', fontWeight: '600' },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acceptBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#4CAF50',
    justifyContent: 'center', alignItems: 'center',
  },
  rejectBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#F44336',
    justifyContent: 'center', alignItems: 'center',
  },
  friendsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 5,
  },
  friendsBadgeText: { fontSize: 12, color: '#4CAF50', fontWeight: '600' },
  checkbox: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: BLUE,
    marginRight: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: BLUE },
  checkboxDisabled: { backgroundColor: '#CCC', borderColor: '#CCC' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyList: { flexGrow: 1 },
  emptyIcon: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#555', marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#AAA', textAlign: 'center' },
  floatBtn: {
    position: 'absolute', bottom: 28, right: 24,
    backgroundColor: BLUE,
    paddingHorizontal: 28, paddingVertical: 13,
    borderRadius: 28,
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
  floatBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

export default FriendListScreen;
