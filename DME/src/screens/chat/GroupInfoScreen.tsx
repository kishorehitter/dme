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
  Modal,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';
import { useFocusEffect } from '@react-navigation/native';
import { chatAPI } from '../../services/api';
import { resolveImageUrl } from '../../utils/image';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { useAuth } from '../../context/AuthContext';
import Icon from 'react-native-vector-icons/Ionicons';

import AvatarWithFallback from '../../components/AvatarWithFallback';
import { useTheme } from '../../context/ThemeContext';

export const GroupInfoScreen: React.FC<any> = ({ navigation, route }) => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
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
    setShowImageModal(false);
    setGalleryPickerVisible(true);
  };

  const handleGallerySelect = async (assets: GalleryAsset[]) => {
    setGalleryPickerVisible(false);
    if (assets && assets.length > 0) {
      const asset = assets[0];
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('profile_picture', {
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'profile.jpg',
        } as any);

        await chatAPI.updateConversationProfile(conversationId, formData);
        loadDetails();
      } catch (error) {
        console.error("Upload error:", error);
        Alert.alert('Error', 'Failed to update profile picture');
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleRemoveImage = async () => {
    setShowImageModal(false);
    setIsUploading(true);
    try {
      await chatAPI.removeConversationProfile(conversationId);
      loadDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to remove group image');
    } finally {
      setIsUploading(false);
    }
  };

  const [showImageModal, setShowImageModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [galleryPickerVisible, setGalleryPickerVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState<{ url?: string }>({});

  const handleAvatarPress = () => {
    // Single tap: Admin edits image, others see nothing
    if (isAdmin) {
      setShowImageModal(true);
    }
  };

  const handleAvatarLongPress = () => {
    // Long press: Everyone sees preview if image exists
    if (conversation?.profile_picture) {
      setPreviewContent({ url: conversation.profile_picture });
      setShowPreview(true);
    }
  };

  return (
    <View style={s.container}>
      <ScrollView>
        {/* Header Info */}
        <View style={s.header}>
          <View style={s.avatarContainer}>
            <TouchableOpacity 
              onPress={handleAvatarPress}
              onLongPress={handleAvatarLongPress}
              activeOpacity={0.8}
            >
              {conversation?.profile_picture ? (
                <Image 
                  source={{ uri: resolveImageUrl(conversation.profile_picture) }} 
                  style={s.avatar} 
                />
              ) : (
                <View style={s.avatarPlaceholder}>
                  <Icon name="people" size={40} color={colors.primary} />
                </View>
              )}
              {isAdmin && (
                <View style={s.editBadge}>
                  <Icon name="camera" size={18} color={theme.textPrimary} />
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Image Action Modal */}
          <Modal visible={showImageModal} transparent animationType="slide">
            <View style={s.modalOverlay}>
              <View style={s.modalContent}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>Group Photo</Text>
                  <TouchableOpacity onPress={() => setShowImageModal(false)}><Text style={s.modalClose}>✕</Text></TouchableOpacity>
                </View>
                
                <View style={s.imageActionRow}>
                  <TouchableOpacity style={s.actionButton} onPress={handleUpdateImage}>
                    <Text style={s.actionButtonText}>📸 Upload</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionButton, s.removeButton]} onPress={handleRemoveImage}>
                    <Text style={[s.actionButtonText, s.removeButtonText]}>🗑️ Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Profile Picture Preview Modal */}
          <Modal visible={showPreview} transparent={true} animationType="fade" onRequestClose={() => setShowPreview(false)}>
            <TouchableOpacity style={s.previewModalOverlay} activeOpacity={1} onPress={() => setShowPreview(false)}>
              <View style={s.previewModalContent}>
                {previewContent.url ? (
                  <Image source={{ uri: resolveImageUrl(previewContent.url) }} style={s.previewImage} />
                ) : (
                  <View style={s.previewPlaceholder}>
                    <Icon name="people" size={80} color="#fff" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </Modal>


          {isEditing ? (
            <View style={s.editForm}>
              <TextInput
                style={s.nameInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Group Name"
                placeholderTextColor={theme.placeholder}
              />
              <TextInput
                style={s.descInput}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Description"
                placeholderTextColor={theme.placeholder}
                multiline
              />
              <View style={s.editButtons}>
                <TouchableOpacity onPress={() => setIsEditing(false)} style={s.cancelButton}>
                  <Text style={{color: theme.textPrimary}}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleUpdateGroup} style={s.saveButton}>
                  <Text style={s.saveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.infoContainer}>
              <Text style={s.groupName}>{conversation?.name}</Text>
              <Text style={s.groupDesc}>{conversation?.description || 'No description'}</Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => setIsEditing(true)} style={s.editButton}>
                 
                  <Icon name="pencil" size={16} color={theme.textPrimary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Participants List */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{conversation?.participants.length} Participants</Text>
            {isAdmin && (
              <TouchableOpacity onPress={() => navigation.navigate('FriendList', { 
                conversationId, 
                isAdding: true,
                existingMemberIds: conversation.participants.map((p: any) => p.user.id)
              })}>
                <Text style={s.addLink}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {conversation?.participants.map((p: any) => (
            <TouchableOpacity 
              key={p.id} 
              style={s.participantItem}
              onPress={() => navigation.navigate('Profile', { user: p.user, conversationId })}
            >
              <View style={[s.participantAvatar, { backgroundColor: '#E8DEF8' }]}>
                {p.user.avatar_sticker ? (
                  <Text style={{ fontSize: 20 }}>{p.user.avatar_sticker}</Text>
                ) : (
                  <AvatarWithFallback
                    uri={p.user.profile_picture}
                    displayName={p.user.display_name || p.user.username || p.user.email}
                    style={{ width: 40, height: 40, borderRadius: 20 }}
                  />
                )}
              </View>
              <View style={s.participantInfo}>
                <Text style={s.participantName}>
                  {p.user.id === currentUser?.id ? 'You' : (p.user.display_name || p.user.username || p.user.email)}
                </Text>
                {p.is_admin && <View style={s.adminBadge}><Text style={s.adminBadgeText}>Admin</Text></View>}
              </View>
              
              {isAdmin && p.user.id !== currentUser?.id && (
                <TouchableOpacity onPress={() => handleRemoveMember(p.user.id, p.user.display_name || p.user.email)}>
                  <Text style={s.removeText}>Remove</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.actionItem} onPress={handleLeaveGroup}>
            <Text style={s.leaveText}>Leave Group</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {isUploading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <CustomGalleryPicker
        visible={galleryPickerVisible}
        onClose={() => setGalleryPickerVisible(false)}
        onSelect={handleGallerySelect}
        maxSelect={1}
        assetType="Photos"
      />
    </View>
  );
};

const THEME_COLOR = '#4597f5f6';

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: theme.surface,
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatarContainer: { marginBottom: spacing.md },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: theme.surface, borderWidth: 2, borderColor: theme.border },
  editBadge: {
    position: 'absolute', bottom: 8, right: 0,
    backgroundColor: theme.surface, padding: 1, borderRadius: 2, borderColor: theme.primary, borderWidth: 1
  },
  editBadgeText: { color: theme.surface, fontSize: 10, fontWeight: 'bold' },
  avatarPlaceholder: { 
    width: 100, height: 100, borderRadius: 50, 
    backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: theme.border
  },
  avatarText: { fontSize: 40 },
  infoContainer: { alignItems: 'center' },
  groupName: { fontSize: fontSize.xl, fontWeight: 'bold', color: theme.textPrimary },
  groupDesc: { fontSize: fontSize.md, color: theme.textSecondary, marginTop: 4, textAlign: 'center' },
  editButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  editLink: { color: theme.primary, fontWeight: '600' },
  editForm: { width: '100%' },
  nameInput: { 
    borderBottomWidth: 1, borderBottomColor: theme.primary, color: theme.textPrimary,
    fontSize: fontSize.lg, padding: 8, marginBottom: 16 
  },
  descInput: { 
    borderBottomWidth: 1, borderBottomColor: theme.border, color: theme.textPrimary,
    fontSize: fontSize.md, padding: 8, marginBottom: 16 
  },
  editButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  cancelButton: { padding: 8 },
  saveButton: { backgroundColor: theme.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
  saveText: { color: '#FFF', fontWeight: 'bold' },
  section: { backgroundColor: theme.surface, marginTop: spacing.md, paddingVertical: spacing.sm },
  sectionHeader: { 
    flexDirection: 'row', justifyContent: 'space-between', 
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: theme.border
  },
  sectionTitle: { fontWeight: 'bold', color: theme.textSecondary },
  addLink: { color: theme.primary, fontWeight: 'bold' },
  participantItem: { 
    flexDirection: 'row', alignItems: 'center', 
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.border
  },
  participantAvatar: { 
    width: 40, height: 40, borderRadius: 20, 
    backgroundColor: theme.icon, justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.md
  },
  participantInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  participantName: { fontSize: fontSize.md, fontWeight: '500', color: theme.textPrimary },
  adminBadge: { 
    backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 2, 
    borderRadius: 4, marginLeft: 8 
  },
  adminBadgeText: { fontSize: 10, color: '#2E7D32', fontWeight: 'bold' },
  removeText: { color: '#FF3B30', fontSize: fontSize.sm },
  actions: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  actionItem: { 
    backgroundColor: theme.surface, padding: spacing.lg, 
    borderRadius: borderRadius.md, alignItems: 'center',
    borderWidth: 1, borderColor: '#FFE5E5'
  },
  leaveText: { color: '#FF3B30', fontWeight: 'bold', fontSize: fontSize.md },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: theme.textPrimary },
  modalClose: { fontSize: 18, color: theme.textSecondary },
  imageActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  removeButton: {
    borderColor: '#FF3B30',
  },
  actionButtonText: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: '600',
  },
  removeButtonText: {
    color: '#FF3B30',
  },
  previewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewModalContent: {
    width: 250,
    height: 250,
    backgroundColor: theme.surface,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: 250,
    height: 250,
  },
  previewPlaceholder: {
    width: 250,
    height: 250,
    backgroundColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
});

export default GroupInfoScreen;