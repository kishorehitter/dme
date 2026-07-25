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
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatAPI, callsAPI } from '../../services/api';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { User } from '../../types';
import { getApiUrl } from '../../config/network';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../context/ThemeContext';

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
  const { theme } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
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
      <Animated.View style={[s.pendingPill, { transform: [{ scale: scaleAnim }] }]}>
        <Icon name="time-outline" size={13} color="#FF9800" />
        <Text style={s.pendingPillText}>Sent</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="close-circle" size={15} color={theme.icon} />
        </TouchableOpacity>
      </Animated.View>
    );
  }

  if (friendStatus === 'received_pending') {
    return (
      <View style={s.choiceRow}>
        <TouchableOpacity style={s.acceptBtn} onPress={onAdd}>
          <Icon name="checkmark" size={14} color={theme.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.rejectBtn} onPress={onCancel}>
          <Icon name="close" size={14} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>
    );
  }

  if (friendStatus === 'friends') {
    return (
      <View style={s.friendsBadge}>
        <Icon name="people" size={13} color="#4CAF50" />
        <Text style={s.friendsBadgeText}>Friends</Text>
      </View>
    );
  }

  // none
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={s.addPersonBtn} onPress={handleAdd}>
        <Icon name="person-add" size={18} color={theme.primary} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Main Screen ──────────────────────────────────────────────────────────────
export const FriendListScreen: React.FC<FriendListScreenProps> = ({ navigation, route }) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
  const isAdding = route?.params?.isAdding || false;
  const isInvitingToCall = route?.params?.isInvitingToCall || false;
  const initialConversationId = route?.params?.conversationId;
  const receiverId = route?.params?.receiverId;
  const existingMemberIds = route?.params?.existingMemberIds || [];

  React.useLayoutEffect(() => {
    if (isInvitingToCall) {
      navigation.setOptions({
        title: 'Invite to Call',
        headerTitleStyle: { color: theme.textPrimary, fontWeight: 'bold' },
        headerTintColor: theme.textPrimary,
      });
    } else if (isAdding) {
      navigation.setOptions({
        title: 'Add Member',
        headerTitleStyle: { color: theme.textPrimary, fontWeight: 'bold' },
        headerTintColor: theme.textPrimary,
      });
    }
  }, [navigation, isAdding, isInvitingToCall, theme]);

  const [conversationId, setConversationId] = useState(initialConversationId);
  const [activeTab, setActiveTab] = useState<HubTab>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewFriendSearchActive, setIsNewFriendSearchActive] = useState(false);

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

  // ── Find new friend manually ──────────────────────────────────────────────────
  const handleFindNewFriend = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setIsNewFriendSearchActive(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const res = await fetch(
        getApiUrl(`chat/users/search/?q=${encodeURIComponent(query)}`),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        // Strict case-insensitive matching by username
        const exactMatch = Array.isArray(data)
          ? data.filter(u => (u.username || '').toLowerCase() === query.toLowerCase())
          : [];
        setSearchResults(exactMatch);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error(err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsNewFriendSearchActive(false);
  };

  // ── Center-screen toast ─────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string) => {
    const cleanMessage = message.replace(/[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}🎉]+\s*$/gu, '').trim();
    setToastMessage(cleanMessage);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

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
      showToast('Friend Request Sent');
      // Reload sent requests and switch to Sent tab
      await loadFriendRequests();
      // Small delay so user sees the toast first, then switch tab
      setTimeout(() => {
        setIsNewFriendSearchActive(false);
        setSearchResults([]);
        setSearchQuery('');
        setActiveTab('requests');
      }, 900);
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
    showToast('Friend Request Cancelled');
  };

  const handleAcceptFriendRequest = async (requestId: number) => {
    try {
      await chatAPI.acceptFriendRequest(requestId);
      showToast('Friend Request Accepted');
      await loadFriendRequests();
      await loadFriends();
    } catch {
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const handleRejectFriendRequest = async (requestId: number) => {
    try {
      await chatAPI.rejectFriendRequest(requestId);
      showToast('Request Declined');
      await loadFriendRequests();
    } catch {
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };

  const handleCancelSentRequest = async (requestId: number) => {
    try {
      await chatAPI.cancelFriendRequest(requestId);
      showToast('Request Cancelled');
      await loadFriendRequests();
    } catch {
      Alert.alert('Error', 'Failed to cancel friend request');
    }
  };

  const handleAcceptFromSearch = async (userId: number) => {
    const req = friendRequests.find((r: any) => r.sender?.id === userId || r.from_user?.id === userId);
    if (req) {
      await handleAcceptFriendRequest(req.id);
    } else {
      showToast('Friend Request Accepted');
      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friend_status: 'friends' } : u));
    }
  };

  const handleRejectFromSearch = async (userId: number) => {
    const req = friendRequests.find((r: any) => r.sender?.id === userId || r.from_user?.id === userId);
    if (req) await handleRejectFriendRequest(req.id);
    else showToast('Request Declined');
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
      <TouchableOpacity style={s.userRow} onPress={() => startChat(item)} activeOpacity={0.7}>
        <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={s.avatar} />
        <View style={s.userInfo}>
          <Text style={s.userName}>{displayName}</Text>
          <Text style={s.userSub} numberOfLines={1}>{item.username ? `@${item.username}` : item.email}</Text>
        </View>
        <TouchableOpacity style={s.chatBtn} onPress={() => startChat(item)}>
          <Icon name="chatbubble-ellipses" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderRequestItem = ({ item }: { item: any }) => {
    const receiver = item.receiver || item.to_user;
    const displayName = receiver?.display_name || receiver?.username || receiver?.email || 'User';
    return (
      <View style={s.userRow}>
        <AvatarWithFallback uri={receiver?.profile_picture} displayName={displayName} sticker={receiver?.avatar_sticker} style={s.avatar} />
        <View style={s.userInfo}>
          <Text style={s.userName}>{displayName}</Text>
          <Text style={s.userSub}>Request sent · waiting</Text>
        </View>
        <TouchableOpacity
          style={s.rejectBtn}
          onPress={() => handleCancelSentRequest(item.id)}
        >
          <Icon name="close" size={14} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderApproveItem = ({ item }: { item: any }) => {
    const sender = item.sender || item.from_user;
    const displayName = sender?.display_name || sender?.username || sender?.email || 'User';
    return (
      <View style={s.userRow}>
        <AvatarWithFallback uri={sender?.profile_picture} displayName={displayName} sticker={sender?.avatar_sticker} style={s.avatar} />
        <View style={s.userInfo}>
          <Text style={s.userName}>{displayName}</Text>
          <Text style={s.userSub}>Wants to be your friend</Text>
        </View>
        <View style={s.choiceRow}>
          <TouchableOpacity style={s.acceptBtn} onPress={() => handleAcceptFriendRequest(item.id)}>
            <Icon name="checkmark" size={15} color={theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={s.rejectBtn} onPress={() => handleRejectFriendRequest(item.id)}>
            <Icon name="close" size={15} color={theme.textPrimary} />
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
          style={[s.userRow, isAlreadyMember && { opacity: 0.55 }]}
          onPress={() => {
            if (isAlreadyMember) return;
            if (isInvitingToCall) handleInviteToCall(item);
            else toggleUserSelection(item.id);
          }}
          activeOpacity={0.7}
          disabled={isAlreadyMember}
        >
          <View style={[s.checkbox, isSelected && s.checkboxSelected, isAlreadyMember && s.checkboxDisabled]}>
            {(isSelected || isAlreadyMember) && <Icon name="checkmark" size={14} color="#FFF" />}
          </View>
          <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={s.avatar} />
          <View style={s.userInfo}>
            <Text style={s.userName}>{displayName}</Text>
            <Text style={s.userSub} numberOfLines={1}>{isAlreadyMember ? 'Already a member' : (item.username ? `@${item.username}` : item.email)}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <View style={s.userRow}>
        <TouchableOpacity 
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
          onPress={() => navigation.navigate('Profile', { user: item })}
          activeOpacity={0.7}
        >
          <AvatarWithFallback uri={item.profile_picture} displayName={displayName} sticker={item.avatar_sticker} style={s.avatar} />
          <View style={s.userInfo}>
            <Text style={s.userName}>{displayName}</Text>
            <Text style={s.userSub} numberOfLines={1}>{item.username ? `@${item.username}` : item.email}</Text>
          </View>
        </TouchableOpacity>
        <AnimatedAddButton
          friendStatus={item.friend_status || 'none'}
          onAdd={() => {
            if (item.friend_status === 'received_pending') {
              handleAcceptFromSearch(item.id);
            } else {
              handleAddFriend(item.id);
            }
          }}
          onCancel={() => {
            if (item.friend_status === 'received_pending') {
              handleRejectFromSearch(item.id);
            } else {
              handleCancelFriendRequest(item.id);
            }
          }}
        />
      </View>
    );
  };

  const isGroupMode = isAdding || isInvitingToCall;

  const getFilteredLocalData = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      if (activeTab === 'friends') return friends;
      if (activeTab === 'requests') return sentFriendRequests;
      return incomingFriendRequests;
    }

    if (activeTab === 'friends') {
      return friends.filter(u => 
        (u.display_name && u.display_name.toLowerCase().includes(query)) ||
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query))
      );
    } else if (activeTab === 'requests') {
      return sentFriendRequests.filter(item => {
        const receiver = item.receiver || item.to_user;
        const name = (receiver?.display_name || receiver?.username || receiver?.email || '').toLowerCase();
        return name.includes(query);
      });
    } else {
      return incomingFriendRequests.filter(item => {
        const sender = item.sender || item.from_user;
        const name = (sender?.display_name || sender?.username || sender?.email || '').toLowerCase();
        return name.includes(query);
      });
    }
  };

  const displayData: any[] = isGroupMode
    ? (searchQuery.trim() 
        ? addModeUsers.filter(u => {
            const lowerQ = searchQuery.trim().toLowerCase();
            return (u.display_name && u.display_name.toLowerCase().includes(lowerQ)) ||
                   (u.username && u.username.toLowerCase().includes(lowerQ)) ||
                   (u.email && u.email.toLowerCase().includes(lowerQ));
          })
        : addModeUsers)
    : isNewFriendSearchActive
    ? searchResults
    : getFilteredLocalData();

  const isDisplayLoading = isGroupMode
    ? isSearching || isLoadingFriends
    : isNewFriendSearchActive
    ? isSearching
    : activeTab === 'friends'
    ? isLoadingFriends
    : activeTab === 'requests' || activeTab === 'approve'
    ? isLoadingRequests
    : isSearching;

  const incomingCount = incomingFriendRequests.length;

  return (
    <View style={s.container}>

      {/* ── Center-screen fade toast ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.toastOverlay} pointerEvents="none">
          <Animated.View style={[s.toastBox, { opacity: toastOpacity }]}>
            <Icon
              name={(toastMessage.includes('Sent') || toastMessage.includes('Accepted')) ? 'checkmark-circle' : 'close-circle'}
              size={22}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={s.toastText}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>
      <View style={s.searchWrapper}>
        <View style={s.searchBar}>
          <Icon name="search" size={18} color={theme.icon} style={{ marginRight: 8 }} />
          <TextInput
            style={s.searchInput}
            placeholder={isInvitingToCall ? 'Search friends...' : isGroupMode ? 'Search contacts...' : 'Search by name or username...'}
            placeholderTextColor={theme.placeholder}
            value={searchQuery}
            onChangeText={v => {
              setSearchQuery(v);
              if (isNewFriendSearchActive) {
                setIsNewFriendSearchActive(false);
                setSearchResults([]);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {!isGroupMode && (
                <TouchableOpacity 
                  style={s.findNewBtn} 
                  onPress={handleFindNewFriend}
                  activeOpacity={0.7}
                >
                  <Text style={s.findNewText}>Tap to Find</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleClearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={18} color={theme.icon} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {!isGroupMode && (
        <View style={s.tabRow}>
          {(['friends', 'approve', 'requests'] as HubTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.tabBtn, activeTab === tab && s.tabBtnActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                {tab === 'friends' ? 'Friends'
                  : tab === 'approve' ? `Requests (${incomingCount})`
                  : `Sent (${sentFriendRequests.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isDisplayLoading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={(item, i) => (item?.id ?? i).toString()}
          renderItem={
            isGroupMode
              ? renderSearchResult
              : isNewFriendSearchActive
              ? renderSearchResult
              : activeTab === 'friends'
              ? renderFriendItem
              : activeTab === 'approve'
              ? renderApproveItem
              : renderRequestItem
          }
          ListEmptyComponent={
            <View style={s.centered}>
              <Icon
                name={
                  isNewFriendSearchActive
                    ? 'search-outline'
                    : searchQuery.trim()
                    ? 'search-outline'
                    : activeTab === 'friends'
                    ? 'people-outline'
                    : activeTab === 'approve'
                    ? 'checkmark-circle-outline'
                    : 'paper-plane-outline'
                }
                size={52}
                color={theme.icon}
                style={{ marginBottom: 12 }}
              />
              <Text style={s.emptyTitle}>
                {isNewFriendSearchActive
                  ? 'No users found'
                  : searchQuery.trim()
                  ? 'No matches found'
                  : activeTab === 'friends'
                  ? 'No friends yet'
                  : activeTab === 'approve'
                  ? 'No friend requests received'
                  : 'No sent requests'}
              </Text>
              <Text style={s.emptySub}>
                {isNewFriendSearchActive
                  ? 'Try searching a different exact username'
                  : searchQuery.trim()
                  ? 'No matching people in your list'
                  : activeTab === 'friends'
                  ? 'Search for people and send friend requests'
                  : activeTab === 'approve' ? 'Incoming friend requests appear here'
                  : 'Friend requests you send appear here'}
              </Text>
            </View>
          }
          contentContainerStyle={displayData.length === 0 ? s.emptyList : undefined}
        />
      )}

      {isGroupMode && selectedUserIds.length > 0 && (
        <TouchableOpacity
          style={[s.floatBtn, isSubmitting && { opacity: 0.7 }]}
          onPress={handleAddMembers}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={s.floatBtnText}>
              {isInvitingToCall ? 'Invite to call' : `Add (${selectedUserIds.length})`}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.inputBackground,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.inputText,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  tabBtnActive: {
    backgroundColor: theme.border,
    borderColor: theme.textPrimary,
  },
  tabText: { fontSize: 12, color: theme.textSecondary, fontWeight: '500' },
  tabTextActive: { color: theme.textPrimary, fontWeight: '700' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: theme.textPrimary, marginBottom: 2 },
  userSub: { fontSize: 13, color: theme.textMuted },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  msgBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPersonBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.inputBackground,
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
    backgroundColor: theme.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  rejectBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: theme.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
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
    borderWidth: 2, borderColor: theme.primary,
    marginRight: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: theme.primary },
  checkboxDisabled: { backgroundColor: theme.border, borderColor: theme.border },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyList: { flexGrow: 1 },
  emptyIcon: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: theme.textSecondary, marginBottom: 6 },
  emptySub: { fontSize: 14, color: theme.textMuted, textAlign: 'center' },
  floatBtn: {
    position: 'absolute', bottom: 28, right: 24,
    backgroundColor: theme.primary,
    paddingHorizontal: 28, paddingVertical: 13,
    borderRadius: 28,
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
  floatBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  findNewBtn: {
    backgroundColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  findNewText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
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
    backgroundColor: theme.surface,
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
    color: theme.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default FriendListScreen;
