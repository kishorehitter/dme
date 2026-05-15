import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  FlatList,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { chatAPI } from '../../services/api';
import { resolveImageUrl } from '../../utils/image';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { useAuth } from '../../context/AuthContext';

export const GroupInfoScreen: React.FC<any> = ({ navigation, route }) => {
  const { conversationId } = route.params;
  const { user: currentUser } = useAuth();
  
  const [conversation, setConversation] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const loadDetails = async () => {
    try {
      const data = await chatAPI.getConversation(conversationId);
      setConversation(data);
      setEditName(data.name || '');
      setEditDescription(data.description || '');
      
      const participant = data.participants.find((p: any) => p.user.id === currentUser?.id);
      setIsAdmin(participant?.is_admin || false);
    } catch (error) {
      Alert.alert('Error', 'Failed to load group details');
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadDetails();
    }, [conversationId])
  );

  const handleUpdateGroup = async () => {
    try {
      await chatAPI.updateConversation(conversationId, {
        name: editName,
        description: editDescription,
      });
      setIsEditing(false);
      loadDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to update group');
    }
  };

  const handleRemoveMember = (userId: number, userName: string) => {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${userName} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              await chatAPI.removeParticipant(conversationId, userId);
              loadDetails();
            } catch (error) {
              Alert.alert('Error', 'Failed to remove member');
            }
          }
        }
      ]
    );
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Leave', 
          style: 'destructive',
          onPress: async () => {
            try {
              await chatAPI.deleteConversation(conversationId);
              navigation.navigate('MainTabs', { screen: 'Chats' });
            } catch (error) {
              Alert.alert('Error', 'Failed to leave group');
            }
          }
        }
      ]
    );
  };

  const handleUpdateImage = async () => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, async (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Error', response.errorMessage);
        return;
      }
      const asset = response.assets?.[0];
      if (asset) {
        try {
          const formData = new FormData();
          formData.append('profile_picture', {
            uri: asset.uri,
            type: asset.type,
            name: asset.fileName || 'profile.jpg',
          });

          await chatAPI.updateConversationProfile(conversationId, formData);
          loadDetails();
        } catch (error) {
          Alert.alert('Error', 'Failed to update profile picture');
        }
      }
    });
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header Info */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <TouchableOpacity onPress={isAdmin ? handleUpdateImage : undefined} disabled={!isAdmin}>
            {conversation?.profile_picture ? (
              <Image source={{ uri: resolveImageUrl(conversation.profile_picture) }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>👥</Text>
              </View>
            )}
            {isAdmin && <View style={styles.editBadge}><Text style={styles.editBadgeText}>Edit</Text></View>}
          </TouchableOpacity>

        </View>
// ... rest of the file ...

        {isEditing ? (
          <View style={styles.editForm}>
            <TextInput
              style={styles.nameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Group Name"
            />
            <TextInput
              style={styles.descInput}
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Description"
              multiline
            />
            <View style={styles.editButtons}>
              <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.cancelButton}>
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleUpdateGroup} style={styles.saveButton}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.infoContainer}>
            <Text style={styles.groupName}>{conversation?.name}</Text>
            <Text style={styles.groupDesc}>{conversation?.description || 'No description'}</Text>
            {isAdmin && (
              <TouchableOpacity onPress={() => setIsEditing(true)}>
                <Text style={styles.editLink}>Edit Group Info</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Participants List */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{conversation?.participants.length} Participants</Text>
          {isAdmin && (
            <TouchableOpacity onPress={() => navigation.navigate('NewChat', { 
              conversationId, 
              isAdding: true,
              existingMemberIds: conversation.participants.map((p: any) => p.user.id)
            })}>
              <Text style={styles.addLink}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {conversation?.participants.map((p: any) => (
          <View key={p.id} style={styles.participantItem}>
            <View style={styles.participantAvatar}>
              {p.user.avatar_sticker ? (
                <Text style={{ fontSize: 20 }}>{p.user.avatar_sticker}</Text>
              ) : p.user.profile_picture ? (
                <Image 
                  source={{ uri: resolveImageUrl(p.user.profile_picture) }} 
                  style={{ width: 40, height: 40, borderRadius: 20 }} 
                />
              ) : (
                <Text>{(p.user.display_name || p.user.username || p.user.email).charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.participantInfo}>
              <Text style={styles.participantName}>
                {p.user.id === currentUser?.id ? 'You' : (p.user.display_name || p.user.username || p.user.email)}
              </Text>
              {p.is_admin && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>Admin</Text></View>}
            </View>
            
            {isAdmin && p.user.id !== currentUser?.id && (
              <TouchableOpacity onPress={() => handleRemoveMember(p.user.id, p.user.display_name || p.user.email)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionItem} onPress={handleLeaveGroup}>
          <Text style={styles.leaveText}>Leave Group</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const THEME_COLOR = '#8100D1';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: '#FFF',
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  avatarContainer: { marginBottom: spacing.md },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#000', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12
  },
  editBadgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  avatarPlaceholder: { 
    width: 100, height: 100, borderRadius: 50, 
    backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' 
  },
  avatarText: { fontSize: 40 },
  infoContainer: { alignItems: 'center' },
  groupName: { fontSize: fontSize.xl, fontWeight: 'bold', color: '#000' },
  groupDesc: { fontSize: fontSize.md, color: '#666', marginTop: 4, textAlign: 'center' },
  editLink: { color: THEME_COLOR, fontWeight: '600', marginTop: spacing.md },
  editForm: { width: '100%' },
  nameInput: { 
    borderBottomWidth: 1, borderBottomColor: THEME_COLOR, 
    fontSize: fontSize.lg, padding: 8, marginBottom: 16 
  },
  descInput: { 
    borderBottomWidth: 1, borderBottomColor: '#DDD', 
    fontSize: fontSize.md, padding: 8, marginBottom: 16 
  },
  editButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  cancelButton: { padding: 8 },
  saveButton: { backgroundColor: THEME_COLOR, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
  saveText: { color: '#FFF', fontWeight: 'bold' },
  section: { backgroundColor: '#FFF', marginTop: spacing.md, paddingVertical: spacing.sm },
  sectionHeader: { 
    flexDirection: 'row', justifyContent: 'space-between', 
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0'
  },
  sectionTitle: { fontWeight: 'bold', color: '#666' },
  addLink: { color: THEME_COLOR, fontWeight: 'bold' },
  participantItem: { 
    flexDirection: 'row', alignItems: 'center', 
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: '#F9F9F9'
  },
  participantAvatar: { 
    width: 40, height: 40, borderRadius: 20, 
    backgroundColor: '#EEE', justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.md
  },
  participantInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  participantName: { fontSize: fontSize.md, fontWeight: '500' },
  adminBadge: { 
    backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 2, 
    borderRadius: 4, marginLeft: 8 
  },
  adminBadgeText: { fontSize: 10, color: '#2E7D32', fontWeight: 'bold' },
  removeText: { color: '#FF3B30', fontSize: fontSize.sm },
  actions: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  actionItem: { 
    backgroundColor: '#FFF', padding: spacing.lg, 
    borderRadius: borderRadius.md, alignItems: 'center',
    borderWidth: 1, borderColor: '#FFE5E5'
  },
  leaveText: { color: '#FF3B30', fontWeight: 'bold', fontSize: fontSize.md },
});

export default GroupInfoScreen;
