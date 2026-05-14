import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatAPI, callsAPI } from '../../services/api';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { User } from '../../types';
import { getApiUrl } from '../../config/network';

interface NewChatScreenProps {
  navigation: any;
  route: any;
}

export const NewChatScreen: React.FC<NewChatScreenProps> = ({
  navigation,
  route,
}) => {
  const isAdding = route?.params?.isAdding || false;
  const isInvitingToCall = route?.params?.isInvitingToCall || false;
  const initialConversationId = route?.params?.conversationId;
  const receiverId = route?.params?.receiverId;
  const existingMemberIds = route?.params?.existingMemberIds || [];

  const [conversationId, setConversationId] = useState(initialConversationId);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Fallback: If conversationId is undefined (e.g. 1-on-1 call started from logs or not passed),
  // fetch/create it using the receiverId.
  useEffect(() => {
    const fetchConversationId = async () => {
      if (!conversationId && receiverId && isInvitingToCall) {
        try {
          console.log('[NewChat] Fetching conversationId for receiverId:', receiverId);
          const conversation = await chatAPI.getOrCreateDirectChat(Number(receiverId));
          if (conversation && conversation.id) {
            setConversationId(conversation.id);
          }
        } catch (error) {
          console.error('[NewChat] Error fetching conversationId:', error);
        }
      }
    };
    fetchConversationId();
  }, [conversationId, receiverId, isInvitingToCall]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (debouncedQuery) {
      searchUsers(debouncedQuery);
    } else {
      setUsers([]);
    }
  }, [debouncedQuery]);

  const searchUsers = async (query: string) => {
    setIsLoading(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`chat/users/search/?q=${encodeURIComponent(query)}`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        console.error('Search failed:', response.status);
        setUsers([]);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const startChat = async (user: User) => {
    try {
      const conversation = await chatAPI.getOrCreateDirectChat(user.id);
      const displayName =
        user.display_name || user.first_name || user.email || 'Unknown';
      navigation.navigate('ChatRoom', {
        conversationId: conversation.id,
        name: displayName,
      });
    } catch (error: any) {
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const toggleUserSelection = (userId: number) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.length === 0) return;
    setIsSubmitting(true);
    try {
      await chatAPI.addParticipant(conversationId, selectedUserIds);
      Alert.alert('Success', 'Members added successfully');
      navigation.goBack();
    } catch (error) {
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
    console.log('[NewChat] Inviting user:', { userId: user.id, roomName: currentRoomName, callId: currentCallId, callType: callType });
    try {
      if (!currentRoomName) throw new Error('Missing roomName');
      await callsAPI.inviteToGroupCall(user.id, currentRoomName, currentCallId, callType);
      Alert.alert('Success', `Invitation sent to ${user.display_name || user.email}`);
      navigation.goBack();
    } catch (error) {
      console.error('[NewChat] Invite error:', error);
      Alert.alert('Error', 'Failed to send invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderUser = ({ item }: { item: User }) => {
    const isSelected = selectedUserIds.includes(item.id);
    const isAlreadyMember = existingMemberIds.includes(item.id);
    const displayName =
      item.display_name || item.first_name || item.email || 'Unknown';
    const avatarSticker = item.avatar_sticker;

    return (
      <TouchableOpacity
        style={[styles.userItem, isAlreadyMember && styles.disabledUserItem]}
        onPress={() => {
          if (isAlreadyMember) return;
          if (isInvitingToCall) {
            handleInviteToCall(item);
          } else {
            isAdding ? toggleUserSelection(item.id) : startChat(item);
          }
        }}
        disabled={isAlreadyMember}
      >
        {isAdding && (
          <View
            style={[
              styles.checkbox,
              isSelected && styles.checkboxSelected,
              isAlreadyMember && styles.checkboxDisabled,
            ]}
          >
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
            {isAlreadyMember && <Text style={styles.checkmark}>✓</Text>}
          </View>
        )}
        <View style={styles.avatarContainer}>
          {avatarSticker ? (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.stickerAvatar}>{avatarSticker}</Text>
            </View>
          ) : item.profile_picture ? (
            <Image
              source={{ uri: item.profile_picture }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{item.email}</Text>
          {isAlreadyMember && (
            <Text style={styles.alreadyMemberLabel}>Already a member</Text>
          )}
        </View>

        {!isAdding && <Text style={styles.chatIcon}>💬</Text>}
      </TouchableOpacity>
    );
  };

  const ListHeader = () => {
    if (isAdding) return null;
    return (
      <TouchableOpacity
        style={styles.newGroupItem}
        onPress={() => navigation.navigate('CreateGroup')}
      >
        <View style={styles.newGroupIconContainer}>
          <Text style={styles.newGroupIcon}>👥</Text>
        </View>
        <Text style={styles.newGroupText}>New Group</Text>
      </TouchableOpacity>
    );
  };

  const EmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🔍</Text>
      <Text style={styles.emptyTitle}>Search for users</Text>
      <Text style={styles.emptySubtitle}>
        Type a name or email to start a new conversation
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Users List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={ListHeader}
          data={users}
          renderItem={renderUser}
          keyExtractor={item => item.id.toString()}
          ListEmptyComponent={EmptyComponent}
          contentContainerStyle={users.length === 0 ? styles.emptyList : {}}
        />
      )}

      {isAdding && selectedUserIds.length > 0 && (
        <TouchableOpacity
          style={[styles.nextButton, isSubmitting && styles.disabledButton]}
          onPress={handleAddMembers}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.nextButtonText}>
              {isInvitingToCall ? 'Invite to call' : `Add to Group (${selectedUserIds.length})`}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const THEME_COLOR = '#8100D1';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  searchContainer: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchIcon: {
    fontSize: fontSize.md,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  clearIcon: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    padding: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newGroupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  newGroupIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F0E6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  newGroupIcon: {
    fontSize: 24,
  },
  newGroupText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: THEME_COLOR,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  disabledUserItem: {
    backgroundColor: '#F9F9F9',
    opacity: 0.8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: THEME_COLOR,
    marginRight: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: THEME_COLOR,
  },
  checkboxDisabled: {
    backgroundColor: '#CCCCCC',
    borderColor: '#CCCCCC',
  },
  checkmark: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  avatarContainer: {
    marginRight: spacing.md,
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
    fontSize: fontSize.lg,
    fontWeight: 'bold',
  },
  stickerAvatar: {
    fontSize: 36,
  },
  content: {
    flex: 1,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: THEME_COLOR,
    marginBottom: spacing.xs,
  },
  email: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  alreadyMemberLabel: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 2,
  },
  chatIcon: {
    fontSize: fontSize.xl,
    color: THEME_COLOR,
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
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
  nextButton: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.xl,
    backgroundColor: THEME_COLOR,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  nextButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: fontSize.md,
  },
  disabledButton: {
    opacity: 0.7,
  },
});

export default NewChatScreen;
