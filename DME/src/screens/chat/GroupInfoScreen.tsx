import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  FlatList,
  Modal,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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

  // ── Center-screen custom fade toast ──
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  // Modern Confirmation Modal States
  const [removeMemberModalVisible, setRemoveMemberModalVisible] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ id: number; name: string; avatar?: string; sticker?: string } | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);

  const [leaveGroupModalVisible, setLeaveGroupModalVisible] = useState(false);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);

  const loadDetails = async () => {
    try {
      const data = await chatAPI.getConversation(conversationId);
      setConversation(data);
      setEditName(data.name || '');
      setEditDescription(data.description || '');
      
      const participant = data.participants.find((p: any) => p.user.id === currentUser?.id);
      setIsAdmin(participant?.is_admin || false);
    } catch (error) {
      console.error('Failed to load group details:', error);
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
      showToast('Group Updated');
    } catch (error) {
      showToast('Failed to Update Group');
    }
  };

  const handleOpenRemoveMember = (user: any) => {
    setMemberToRemove({
      id: user.id,
      name: user.display_name || user.username || user.email || 'Member',
      avatar: user.profile_picture,
      sticker: user.avatar_sticker,
    });
    setRemoveMemberModalVisible(true);
  };

  const confirmRemoveMember = async () => {
    if (!memberToRemove) return;
    setIsRemovingMember(true);
    try {
      await chatAPI.removeParticipant(conversationId, memberToRemove.id);
      setRemoveMemberModalVisible(false);
      setMemberToRemove(null);
      loadDetails();
      showToast('Member Removed');
    } catch (error) {
      showToast('Failed to Remove Member');
    } finally {
      setIsRemovingMember(false);
    }
  };

  const handleOpenLeaveGroup = () => {
    setLeaveGroupModalVisible(true);
  };

  const confirmLeaveGroup = async () => {
    setIsLeavingGroup(true);
    try {
      await chatAPI.deleteConversation(conversationId);
      setLeaveGroupModalVisible(false);
      navigation.navigate('MainTabs', { screen: 'Chats' });
    } catch (error) {
      showToast('Failed to Leave Group');
    } finally {
      setIsLeavingGroup(false);
    }
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
        showToast('Group Photo Updated');
      } catch (error) {
        console.error("Upload error:", error);
        showToast('Failed to Update Photo');
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
      showToast('Group Photo Removed');
    } catch (error) {
      showToast('Failed to Remove Photo');
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
      {/* Clean In-Screen Header */}
      <View style={[s.customHeader, { paddingTop: insets.top + 8, backgroundColor: theme.background }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={s.headerBackButton}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          android_ripple={{ color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderless: true, radius: 20 }}
        >
          <Icon name="arrow-back" size={24} color={theme.textPrimary} />
        </Pressable>
        <Text style={s.headerTitleText} numberOfLines={1}>
          Group Info
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}>
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
                <TouchableOpacity onPress={() => handleOpenRemoveMember(p.user)}>
                  <Text style={s.removeText}>Remove</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.actionItem} onPress={handleOpenLeaveGroup}>
            <Text style={s.leaveText}>Leave Group</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {isUploading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {/* MODERN REMOVE MEMBER CONFIRMATION MODAL */}
      <Modal
        visible={removeMemberModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!isRemovingMember) {
            setRemoveMemberModalVisible(false);
            setMemberToRemove(null);
          }
        }}
      >
        <View style={s.confirmModalOverlay}>
          <View
            style={[
              s.confirmModalCard,
              {
                backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            {/* Red Glowing Icon Circle */}
            <View style={s.confirmIconCircle}>
              <Icon name="person-remove-outline" size={32} color="#EF4444" />
            </View>

            {/* Modal Title & Description */}
            <Text style={[s.confirmModalTitle, { color: theme.textPrimary }]}>
              Remove Member?
            </Text>
            <Text style={[s.confirmModalSubText, { color: theme.textSecondary }]}>
              Are you sure you want to remove this member from the group? They will no longer have access to this conversation.
            </Text>

            {/* Member Preview Snippet */}
            {memberToRemove && (
              <View
                style={[
                  s.memberSnippet,
                  {
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.08)' : '#FEF2F2',
                    borderColor: isDark ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.2)',
                  },
                ]}
              >
                <View style={{ marginRight: 12 }}>
                  {memberToRemove.sticker ? (
                    <Text style={{ fontSize: 26 }}>{memberToRemove.sticker}</Text>
                  ) : (
                    <AvatarWithFallback
                      uri={memberToRemove.avatar}
                      displayName={memberToRemove.name}
                      style={{ width: 44, height: 44, borderRadius: 22 }}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.memberSnippetName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {memberToRemove.name}
                  </Text>
                  <Text style={[s.memberSnippetRole, { color: '#EF4444' }]}>
                    Will be removed from group
                  </Text>
                </View>
              </View>
            )}

            {/* Action Buttons */}
            <View style={s.confirmBtnRow}>
              <TouchableOpacity
                style={[
                  s.confirmCancelBtn,
                  { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' },
                ]}
                onPress={() => {
                  setRemoveMemberModalVisible(false);
                  setMemberToRemove(null);
                }}
                disabled={isRemovingMember}
                activeOpacity={0.8}
              >
                <Text style={[s.confirmCancelText, { color: theme.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.confirmDeleteBtn}
                onPress={confirmRemoveMember}
                disabled={isRemovingMember}
                activeOpacity={0.85}
              >
                {isRemovingMember ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={s.confirmDeleteText}>Remove</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODERN LEAVE GROUP CONFIRMATION MODAL */}
      <Modal
        visible={leaveGroupModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!isLeavingGroup) setLeaveGroupModalVisible(false);
        }}
      >
        <View style={s.confirmModalOverlay}>
          <View
            style={[
              s.confirmModalCard,
              {
                backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            {/* Red Glowing Icon Circle */}
            <View style={s.confirmIconCircle}>
              <Icon name="log-out-outline" size={32} color="#EF4444" />
            </View>

            {/* Modal Title & Description */}
            <Text style={[s.confirmModalTitle, { color: theme.textPrimary }]}>
              Leave Group?
            </Text>
            <Text style={[s.confirmModalSubText, { color: theme.textSecondary }]}>
              Are you sure you want to leave <Text style={{ fontWeight: '700', color: theme.textPrimary }}>{conversation?.name || 'this group'}</Text>? You will no longer receive messages from this group.
            </Text>

            {/* Action Buttons */}
            <View style={s.confirmBtnRow}>
              <TouchableOpacity
                style={[
                  s.confirmCancelBtn,
                  { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' },
                ]}
                onPress={() => setLeaveGroupModalVisible(false)}
                disabled={isLeavingGroup}
                activeOpacity={0.8}
              >
                <Text style={[s.confirmCancelText, { color: theme.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.confirmDeleteBtn}
                onPress={confirmLeaveGroup}
                disabled={isLeavingGroup}
                activeOpacity={0.85}
              >
                {isLeavingGroup ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={s.confirmDeleteText}>Leave</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Center-screen fade toast ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.toastOverlay} pointerEvents="none">
          <Animated.View
            style={[
              s.toastBox,
              {
                opacity: toastOpacity,
                backgroundColor: isDark ? '#1E293B' : '#0F172A',
              },
            ]}
          >
            <Icon
              name={toastMessage.includes('Failed') ? 'close-circle' : 'checkmark-circle'}
              size={22}
              color={toastMessage.includes('Failed') ? '#EF4444' : '#10B981'}
              style={{ marginRight: 8 }}
            />
            <Text style={s.toastText}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>

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
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerBackButton: {
    padding: 6,
    marginRight: 12,
    borderRadius: 20,
  },
  headerTitleText: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  // Modern Confirmation Modal Styles
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: 'center',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    borderWidth: 1,
  },
  confirmIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalSubText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  memberSnippet: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 22,
  },
  memberSnippetName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  memberSnippetRole: {
    fontSize: 12,
    fontWeight: '600',
  },
  confirmBtnRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  confirmDeleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  confirmDeleteText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
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
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default GroupInfoScreen;