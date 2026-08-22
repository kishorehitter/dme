import React, { useState, useEffect, useLayoutEffect } from 'react';
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
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import { chatAPI } from '../../services/api';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { User } from '../../types';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../context/ThemeContext';
import { getApiUrl } from '../../config/network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateGroupScreenProps {
  navigation: any;
}

export const CreateGroupScreen: React.FC<CreateGroupScreenProps> = ({
  navigation,
}) => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupImage, setGroupImage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => {
            if (step === 2) {
              setStep(1);
            } else {
              navigation.goBack();
            }
          }}
          style={{ marginLeft: 15 }}
        >
          <Icon name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      ),
      headerTitle: step === 1 ? 'Create Group' : 'New Group',
      headerTitleStyle: { color: theme.textPrimary },
      headerStyle: { backgroundColor: theme.surface },
      headerTintColor: theme.textPrimary,
    });
  }, [navigation, step, theme]);

  const [chattedUsers, setChattedUsers] = useState<User[]>([]);

  useEffect(() => {
    const loadChattedUsers = async () => {
      setIsLoading(true);
      try {
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
            // Include only if accepted or null (meaning no request pending/rejected)
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
        
        setChattedUsers(chatted);
        setUsers(chatted);
      } catch (error) {
        console.error('Error fetching conversations for group:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadChattedUsers();
  }, []);

  useEffect(() => {
    if (step === 1) {
      if (!searchQuery.trim()) {
        setUsers(chattedUsers);
      } else {
        const query = searchQuery.toLowerCase();
        const filtered = chattedUsers.filter(user => {
          const name = (user.display_name || '').toLowerCase();
          const email = (user.email || '').toLowerCase();
          const username = (user.username || '').toLowerCase();
          return name.includes(query) || email.includes(query) || username.includes(query);
        });
        setUsers(filtered);
      }
    }
  }, [searchQuery, chattedUsers, step]);

  const toggleUserSelection = (user: User) => {
    if (selectedUsers.some(u => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter(u => u.id !== user.id));
    } else {
      setSelectedUsers([...selectedUsers, user]);
    }
  };

  const handlePickImage = () => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Error', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset) setGroupImage(asset);
    });
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    setIsCreating(true);
    try {
      const formData = new FormData();
      formData.append('name', groupName);
      formData.append('description', groupDescription);
      formData.append('is_group', 'true');
      
      selectedUsers.forEach(u => formData.append('participant_ids', u.id.toString()));
      
      if (groupImage) {
        formData.append('profile_picture', {
          uri: groupImage.uri,
          type: groupImage.type,
          name: groupImage.fileName || 'group.jpg',
        });
      }

      const response = await chatAPI.createConversation(formData);

      navigation.replace('ChatRoom', {
        conversationId: response.id,
        name: response.name,
        avatarUri: response.profile_picture,
        isGroup: true,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  if (step === 1) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Add Participants</Text>
          <Text style={s.headerSubtitle}>
            {selectedUsers.length} selected
          </Text>
        </View>

        <View style={s.searchContainer}>
          <TextInput
            style={s.searchInput}
            placeholder="Search users..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {selectedUsers.length > 0 && (
          <View style={s.selectedContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {selectedUsers.map(user => (
                <TouchableOpacity
                  key={user.id}
                  style={s.selectedUser}
                  onPress={() => toggleUserSelection(user)}
                >
                  <View style={{position: 'relative'}}>
                    <AvatarWithFallback 
                      uri={user.profile_picture} 
                      displayName={user.display_name || user.email || 'User'} 
                      sticker={user.avatar_sticker} 
                      style={{ width: 50, height: 50, borderRadius: 25 }}
                    />
                    <View style={s.removeBadge}>
                      <Text style={s.removeBadgeText}>×</Text>
                    </View>
                  </View>
                  <Text style={s.selectedName} numberOfLines={1}>
                    {user.display_name || user.email || 'User'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <FlatList
          data={users}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.userItem}
              onPress={() => toggleUserSelection(item)}
            >
              <View
                style={[
                  s.checkbox,
                  selectedUsers.some(u => u.id === item.id) &&
                    s.checkboxSelected,
                ]}
              >
                {selectedUsers.some(u => u.id === item.id) && (
                  <Text style={s.checkmark}>✓</Text>
                )}
              </View>
              <AvatarWithFallback 
                uri={item.profile_picture} 
                displayName={item.display_name || item.email || 'User'} 
                sticker={item.avatar_sticker} 
                style={s.avatar} 
              />
              <View style={s.userInfo}>
                <Text style={s.userName}>
                  {item.display_name || item.email}
                </Text>
                <Text style={s.userEmail}>{item.email}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={() => (
            <View style={s.emptyList}>
              <Text style={{ color: '#888' }}>
                {searchQuery ? 'No matching contacts found' : 'No recent chats found'}
              </Text>
            </View>
          )}
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 16) + (selectedUsers.length > 0 ? 84 : 20),
          }}
        />

        {selectedUsers.length > 0 && (
          <TouchableOpacity
            style={[s.nextButton, { bottom: Math.max(insets.bottom, 16) + 16 }]}
            onPress={() => setStep(2)}
          >
            <Text style={s.nextButtonText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{
        paddingBottom: Math.max(insets.bottom, 16) + 32,
      }}
    >
      <View style={s.form}>
        <View style={s.avatarPicker}>
          <TouchableOpacity onPress={handlePickImage} style={s.avatarLarge}>
            {groupImage ? (
              <Image source={{ uri: groupImage.uri }} style={s.avatarLarge} />
            ) : (
              <Icon name="camera" size={40} color="#888" />
            )}
            <View style={s.plusIconContainer}>
              <Icon name="add" size={20} color="#FFF" />
            </View>
          </TouchableOpacity>
          <Text style={s.pickerLabel}>
            {groupImage ? 'Change Image' : 'Add Group Image'}
          </Text>
        </View>

        <Text style={s.label}>Group Name</Text>
        <TextInput
          style={s.input}
          placeholder="Enter group name"
          value={groupName}
          onChangeText={setGroupName}
          maxLength={50}
        />

        <Text style={s.label}>Description (Bio)</Text>
        <TextInput
          style={[s.input, s.textArea]}
          placeholder="What is this group about?"
          value={groupDescription}
          onChangeText={setGroupDescription}
          multiline
          numberOfLines={3}
        />

        <View style={s.summary}>
          <Text style={s.summaryTitle}>
            Participants: {selectedUsers.length}
          </Text>
          <View style={s.summaryChips}>
            {selectedUsers.map(u => (
              <View key={u.id} style={s.chip}>
                <Text style={s.chipText}>{u.display_name || u.email}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[s.createButton, isCreating && s.disabledButton]}
          onPress={handleCreateGroup}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={s.createButtonText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    padding: spacing.lg,
    backgroundColor: theme.primary,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: fontSize.xl,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.sm,
  },
  backLink: {
    color: '#FFF',
    textDecorationLine: 'underline',
    marginTop: spacing.xs,
  },
  searchContainer: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchInput: {
    backgroundColor: theme.inputBackground,
    color: theme.inputText,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    fontSize: fontSize.md,
  },
  selectedContainer: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.surface,
  },
  selectedUser: {
    alignItems: 'center',
    marginRight: spacing.md,
    width: 60,
  },
  selectedAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  selectedAvatarText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  selectedName: {
    fontSize: 10,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  removeBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: '#FF3B30',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.surface,
  },
  removeBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  userItem: {
    flexDirection: 'row',
    padding: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.primary,
    marginRight: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: theme.primary,
  },
  checkmark: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  userEmail: {
    fontSize: fontSize.xs,
    color: theme.textSecondary,
  },
  emptyList: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  nextButton: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.xl,
    backgroundColor: theme.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    elevation: 4,
  },
  nextButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: fontSize.md,
  },
  form: {
    padding: spacing.xl,
  },
  avatarPicker: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatarLarge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  plusIconContainer: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: theme.primary,
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: theme.surface,
  },
  pickerLabel: {
    color: theme.primary,
    fontWeight: '600',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    color: theme.textPrimary,
    paddingVertical: spacing.sm,
    fontSize: fontSize.lg,
    marginBottom: spacing.xl,
  },
  textArea: {
    fontSize: fontSize.md,
  },
  summary: {
    backgroundColor: theme.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xl,
  },
  summaryTitle: {
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: spacing.sm,
  },
  summaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: theme.inputBackground,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  createButton: {
    backgroundColor: theme.primary,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#FFF',
    fontSize: fontSize.lg,
    fontWeight: 'bold',
  },
  disabledButton: {
    opacity: 0.7,
  },
});

export default CreateGroupScreen;
