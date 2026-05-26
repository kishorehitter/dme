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
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import { chatAPI } from '../../services/api';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { User } from '../../types';
import { getApiUrl } from '../../config/network';

interface CreateGroupScreenProps {
  navigation: any;
}

export const CreateGroupScreen: React.FC<CreateGroupScreenProps> = ({
  navigation,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupImage, setGroupImage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (step === 1 && searchQuery) {
      const delayDebounceFn = setTimeout(() => {
        searchUsers(searchQuery);
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    } else if (step === 1) {
      setUsers([]);
    }
  }, [searchQuery, step]);

  const searchUsers = async (query: string) => {
    setIsLoading(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`chat/users/search/?q=${encodeURIComponent(query)}`),
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  if (step === 1) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add Participants</Text>
          <Text style={styles.headerSubtitle}>
            {selectedUsers.length} selected
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {selectedUsers.length > 0 && (
          <View style={styles.selectedContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {selectedUsers.map(user => (
                <TouchableOpacity
                  key={user.id}
                  style={styles.selectedUser}
                  onPress={() => toggleUserSelection(user)}
                >
                  <View style={[styles.selectedAvatar, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Icon name="person" size={20} color="#8100D1" />
                    <View style={styles.removeBadge}>
                      <Text style={styles.removeBadgeText}>×</Text>
                    </View>
                  </View>
                  <Text style={styles.selectedName} numberOfLines={1}>
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
              style={styles.userItem}
              onPress={() => toggleUserSelection(item)}
            >
              <View
                style={[
                  styles.checkbox,
                  selectedUsers.some(u => u.id === item.id) &&
                    styles.checkboxSelected,
                ]}
              >
                {selectedUsers.some(u => u.id === item.id) && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>
                  {item.display_name || item.email}
                </Text>
                <Text style={styles.userEmail}>{item.email}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyList}>
              <Text>
                {searchQuery ? 'No users found' : 'Search for participants'}
              </Text>
            </View>
          )}
        />

        {selectedUsers.length > 0 && (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() => setStep(2)}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>New Group</Text>
        <TouchableOpacity onPress={() => setStep(1)}>
          <Text style={styles.backLink}>Back to participants</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <View style={styles.avatarPicker}>
          <TouchableOpacity onPress={handlePickImage} style={styles.avatarLarge}>
            {groupImage ? (
              <Image source={{ uri: groupImage.uri }} style={styles.avatarLarge} />
            ) : (
              <Text style={styles.avatarLargeText}>👥</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.pickerLabel}>
            {groupImage ? 'Change Image' : 'Add Group Image'}
          </Text>
        </View>

        <Text style={styles.label}>Group Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter group name"
          value={groupName}
          onChangeText={setGroupName}
          maxLength={50}
        />

        <Text style={styles.label}>Description (Bio)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What is this group about?"
          value={groupDescription}
          onChangeText={setGroupDescription}
          multiline
          numberOfLines={3}
        />

        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>
            Participants: {selectedUsers.length}
          </Text>
          <View style={styles.summaryChips}>
            {selectedUsers.map(u => (
              <View key={u.id} style={styles.chip}>
                <Text style={styles.chipText}>{u.display_name || u.email}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.createButton, isCreating && styles.disabledButton]}
          onPress={handleCreateGroup}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.createButtonText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const THEME_COLOR = '#8100D1';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  header: {
    padding: spacing.lg,
    backgroundColor: THEME_COLOR,
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
    borderBottomColor: '#EEE',
  },
  searchInput: {
    backgroundColor: '#F5F5F5',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    fontSize: fontSize.md,
  },
  selectedContainer: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    backgroundColor: '#FDFDFD',
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
    backgroundColor: THEME_COLOR,
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
    color: '#666',
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
    borderColor: '#FFF',
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
    borderBottomColor: '#F9F9F9',
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
  },
  userEmail: {
    fontSize: fontSize.xs,
    color: '#999',
  },
  emptyList: {
    padding: spacing.xl,
    alignItems: 'center',
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
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarLargeText: {
    fontSize: 50,
  },
  pickerLabel: {
    color: THEME_COLOR,
    fontWeight: '600',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#333',
    marginBottom: spacing.xs,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#DDD',
    paddingVertical: spacing.sm,
    fontSize: fontSize.lg,
    marginBottom: spacing.xl,
  },
  textArea: {
    fontSize: fontSize.md,
  },
  summary: {
    backgroundColor: '#F9F9F9',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xl,
  },
  summaryTitle: {
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  summaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: '#EEE',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: {
    fontSize: 12,
    color: '#666',
  },
  createButton: {
    backgroundColor: THEME_COLOR,
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
