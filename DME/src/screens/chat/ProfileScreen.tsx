/**
 * ProfileScreen.tsx
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchImageLibrary } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { getApiUrl } from '../../config/network';
import { resolveImageUrl } from '../../utils/image';
import { StatusService, UserStatusGroup } from '../../services/StatusService';

interface ProfileScreenProps {
  navigation: any;
  route: any;
}

interface UserProfile {
  id: number;
  email: string;
  display_name: string;
  username: string;
  profile_picture: string | null;
  avatar_sticker: string | null;
  bio: string;
}

const MALE_STICKERS = [
  { id: 'm1', emoji: '👨', label: 'Man' },
  { id: 'm2', emoji: '👦', label: 'Boy' },
  { id: 'm3', emoji: '🧔', label: 'Bearded' },
  { id: 'm4', emoji: '👨‍🎓', label: 'Graduate' },
  { id: 'm5', emoji: '👨‍💼', label: 'Professional' },
  { id: 'm6', emoji: '👨‍🚀', label: 'Astronaut' },
];

const FEMALE_STICKERS = [
  { id: 'f1', emoji: '👩', label: 'Woman' },
  { id: 'f2', emoji: '👧', label: 'Girl' },
  { id: 'f3', emoji: '👩‍🦰', label: 'Redhead' },
  { id: 'f4', emoji: '👩‍🎓', label: 'Graduate' },
  { id: 'f5', emoji: '👩‍💼', label: 'Professional' },
  { id: 'f6', emoji: '👩‍🚀', label: 'Astronaut' },
];

// Helper to get alphabetic initials safely
const getInitials = (name: string) => {
  if (typeof name !== 'string') return null;
  const match = name.trim().match(/[a-zA-Z]/);
  return match ? match[0].toUpperCase() : null;
};

const AvatarWithFallback = ({ uri, displayName, sticker, style }: any) => {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [uri]);

  if (!uri || error) {
    if (sticker) {
      return (
        <View style={[style, styles.friendAvatarPlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ fontSize: style.width * 0.5 }}>{sticker}</Text>
        </View>
      );
    }
    
    const initial = getInitials(displayName);
    if (initial) {
        return (
          <View style={[style, styles.friendAvatarPlaceholder, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary + '20' }]}>
            <Text style={{ fontSize: style.width * 0.4, color: colors.primary, fontWeight: 'bold' }}>{initial}</Text>
          </View>
        );
    }

    return (
      <View style={[style, styles.friendAvatarPlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
        <Icon name="person" size={style.width / 2} color={colors.primary} />
      </View>
    );
  }

  return (
    <Image
      key={uri}
      source={{ uri: resolveImageUrl(uri) }}
      style={style}
      onError={() => setError(true)}
    />
  );
};

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  navigation,
  route,
}) => {
  const { user, logout, deleteAccount, refreshUser } = useAuth();
  const viewingOtherProfile = route?.params?.user;
  const isReadOnly = !!viewingOtherProfile;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [formData, setFormData] = useState({
    display_name: '',
    username: '',
    bio: '',
  });
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male');
  const [isBlocked, setIsBlocked] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const usernameEditable = React.useMemo(() => {
    // Priority: fetched profile object first, then fallback to global user object
    const lastChange = profile?.last_username_change || user?.last_username_change;
    if (!lastChange) return true;
    
    const lastChangeDate = new Date(lastChange);
    const now = new Date();
    const diffTime = now.getTime() - lastChangeDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 14;
  }, [profile?.last_username_change, user?.last_username_change]);

  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<{ url?: string; sticker?: string }>({});
  const [userStatus, setUserStatus] = useState<UserStatusGroup | null>(null);

  const hasStatus = !!userStatus && userStatus.statuses.length > 0;
  const allSeen = hasStatus ? !userStatus!.has_unseen : true;
  const ringStyle = hasStatus 
    ? allSeen ? styles.statusViewedRing : styles.statusNewRing
    : {};

  const handleAvatarPress = () => {
    if (hasStatus && userStatus) {
      navigation.navigate('StatusViewer', { 
        statuses: userStatus.statuses, 
        initialIndex: 0,
        currentUserId: user?.id,
        isOwn: userStatus.user_id === user?.id
      });
    } else {
      handleAvatarLongPress();
    }
  };

  const handleAvatarLongPress = () => {
    if (profile) {
      setPreviewContent({
        url: profile.profile_picture || undefined,
        sticker: profile.avatar_sticker || undefined,
      });
      setShowPreview(true);
    }
  };

  const loadStatus = async () => {
    const userId = viewingOtherProfile?.id || user?.id;
    if (!userId) return;
    try {
      const statuses = await StatusService.getStatuses();
      const filtered = statuses.filter(s => s.user_id === userId);
      if (filtered.length > 0) {
        const groups = StatusService.groupByUser(filtered);
        if (groups.length > 0) {
          setUserStatus(groups[0]);
        }
      }
    } catch (err) {
      console.warn('[ProfileScreen] Error loading status:', err);
    }
  };

  const loadBlockStatus = async () => {
    if (!viewingOtherProfile?.id) return;
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`accounts/users/${viewingOtherProfile.id}/block-status/`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        setIsBlocked(data.blocked || false);
      }
    } catch (error) {
      console.error('Error loading block status:', error);
    }
  };

  const handleClearChat = async () => {
    if (!viewingOtherProfile?.id) return;

    Alert.alert(
      'Clear Chat',
      'This will clear all messages from this conversation on your device only. The other person will still see all messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem('access_token');
              const convId = route.params?.conversationId;

              if (!convId) {
                Toast.show({
                  type: 'error',
                  text1: 'No conversation found',
                  position: 'bottom',
                });
                return;
              }

              const response = await fetch(
                getApiUrl(`chat/conversations/${convId}/clear/`),
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                },
              );

              if (!response.ok) {
                throw new Error('Failed to clear chat');
              }

              Toast.show({
                type: 'success',
                text1: 'Chat cleared',
                position: 'bottom',
              });

              navigation.navigate('MainTabs', { screen: 'Chats' });
            } catch (error) {
              console.error('Error clearing chat:', error);
              Toast.show({
                type: 'error',
                text1: 'Failed to clear chat',
                position: 'bottom',
              });
            }
          },
        },
      ],
    );
  };

  const handleBlockUser = async () => {
    if (!viewingOtherProfile?.id) return;

    const action = isBlocked ? 'Unblock' : 'Block';
    Alert.alert(
      `${action} User`,
      `Are you sure you want to ${action.toLowerCase()} ${
        viewingOtherProfile.display_name || viewingOtherProfile.first_name
      }?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: isBlocked ? 'default' : 'destructive',
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem('access_token');
              const response = await fetch(
                getApiUrl(`accounts/users/${viewingOtherProfile.id}/block/`),
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ blocked: !isBlocked }),
                },
              );

              if (response.ok || response.status === 200) {
                setIsBlocked(!isBlocked);
                Toast.show({
                  type: 'success',
                  text1: isBlocked ? 'User unblocked' : 'User blocked',
                  position: 'bottom',
                });

                navigation.navigate('MainTabs', { screen: 'Chats' });
              } else {
                const errorData = await response.json().catch(() => ({}));
                Toast.show({
                  type: 'error',
                  text1: errorData.error || `Failed to ${action.toLowerCase()} user`,
                  position: 'bottom',
                });
              }
            } catch (error) {
              console.error('Block/unblock error:', error);
              Toast.show({
                type: 'error',
                text1: `Failed to ${action.toLowerCase()} user`,
                position: 'bottom',
              });
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    const initializeProfile = async () => {
      loadStatus();
      if (viewingOtherProfile) {
        loadBlockStatus();
        try {
          const token = await AsyncStorage.getItem('access_token');
          const response = await fetch(getApiUrl(`accounts/users/${viewingOtherProfile.id}/`), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const fullProfile = await response.json();
            setProfile(fullProfile);
            setFormData({
              display_name: fullProfile.display_name || '',
              username: fullProfile.username || '',
              bio: fullProfile.bio || '',
            });
          } else {
            setProfile(viewingOtherProfile);
            setFormData({
              display_name: viewingOtherProfile.display_name || '',
              username: viewingOtherProfile.username || '',
              bio: viewingOtherProfile.bio || '',
            });
          }
        } catch (err) {
          console.error("Error fetching full profile:", err);
          setProfile(viewingOtherProfile);
        }
      } else {
        loadProfile();
      }
    };
    initializeProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl('accounts/profile/'),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        setFormData({
          display_name: data.display_name || '',
          username: data.username || '',
          bio: data.bio || '',
        });
      } else if (user) {
        setProfile(user as any);
        setFormData({
          display_name: user.display_name || '',
          username: user.username || '',
          bio: user.bio || '',
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      if (user) {
        setProfile(user as any);
        setFormData({
          display_name: user.display_name || '',
          username: user.username || '',
          bio: user.bio || '',
        });
      }
    }
  };

  const pickImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.7,
      });

      if (result.didCancel || result.errorCode) return;

      const asset = result.assets?.[0];
      if (asset?.uri) {
        setIsUploadingImage(true);
        await uploadProfilePicture(asset);
        setIsUploadingImage(false);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
      setIsUploadingImage(false);
    }
  };

  const handleRemovePhoto = async () => {
    setIsUploadingImage(true);
    try {
      const token = await AsyncStorage.getItem('access_token');

      const response = await fetch(
        getApiUrl('accounts/profile/update/'),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profile_picture: null,
            avatar_sticker: null,
          }),
        },
      );

      const data = await response.json();
      if (response.ok) {
        setProfile(data);
        await refreshUser();
        setShowStickerModal(false);
        Toast.show({ type: 'success', text1: 'Profile picture removed' });
      } else {
        Alert.alert('Error', data.message || 'Failed to remove profile picture');
      }
    } catch (error) {
      console.error('Error removing image:', error);
      Alert.alert('Error', 'Failed to remove profile picture');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const uploadProfilePicture = async (asset: any) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const formDataUpload = new FormData();
      
      formDataUpload.append('profile_picture', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'profile.jpg',
      } as any);

      const response = await fetch(
        getApiUrl('accounts/profile/update/'),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formDataUpload,
        },
      );

      const data = await response.json();
      if (response.ok) {
        const freshData = { ...data, profile_picture: data.profile_picture ? `${resolveImageUrl(data.profile_picture)}?t=${Date.now()}` : null };
        setProfile(freshData);
        await refreshUser();
        Toast.show({ type: 'success', text1: 'Profile picture updated' });
      } else {
        Alert.alert('Error', data.message || 'Failed to update profile picture');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', 'Failed to upload profile picture');
    }
  };

  const selectSticker = async (sticker: string) => {
    try {
      setIsUploadingImage(true);
      const token = await AsyncStorage.getItem('access_token');

      const response = await fetch(
        getApiUrl('accounts/profile/update/'),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            avatar_sticker: sticker,
            profile_picture: null,
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        await refreshUser();
        setShowStickerModal(false);
        Alert.alert('Success', 'Avatar sticker updated successfully');
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert('Error', errorData.message || 'Failed to update avatar');
      }
    } catch (error) {
      console.error('Error updating sticker:', error);
      Alert.alert('Error', 'Failed to update avatar');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!formData.username.trim()) {
      Alert.alert('Error', 'Username is required.');
      setIsSaving(false);
      return;
    }
    if (formData.bio.trim().length > 139) {
      Alert.alert('Error', 'Bio cannot exceed 139 characters.');
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const updateData: any = {
        username: formData.username.trim(),
        bio: formData.bio.trim(),
      };
      if (formData.display_name && formData.display_name.trim() !== '') {
        updateData.display_name = formData.display_name.trim();
      }

      const response = await fetch(
        getApiUrl('accounts/profile/update/'),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        setFormData({
          display_name: data.display_name || '',
          username: data.username || '',
          bio: data.bio || '',
        });
        Toast.show({
          type: 'success',
          text1: 'Profile updated successfully',
          position: 'bottom',
        });
        navigation.navigate('MainTabs', { screen: 'Chats' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        // Use the specific 'message' from our backend update
        Alert.alert('Error', errorData.message || errorData.username?.[0] || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => await logout() },
    ]);
  };

  const handleDeleteAccount = async () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action is permanent and will delete all your data including messages and media.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await deleteAccount();
              Toast.show({
                type: 'success',
                text1: 'Account deleted',
                text2: 'Your account has been permanently removed.'
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          } 
        },
      ]
    );
  };

  const renderStickerItem = ({ item }: { item: { id: string; emoji: string; label: string } }) => (
    <TouchableOpacity
      style={styles.stickerItem}
      onPress={() => selectSticker(item.emoji)}
    >
      <Text style={styles.stickerEmoji}>{item.emoji}</Text>
      <Text style={styles.stickerLabel}>{item.label}</Text>
    </TouchableOpacity>
  );

  if (isReadOnly && profile) {
    const displayName = profile.display_name || profile.username || profile.email || 'User';
    const bio = profile.bio || 'No bio available'; 

    return (
      <ScrollView style={styles.container}>
        <View style={styles.friendProfileHeader}>
          <TouchableOpacity 
            style={[styles.friendAvatarContainer, (hasStatus) && styles.avatarRingContainer, ringStyle]}
            onPress={handleAvatarPress}
            onLongPress={handleAvatarLongPress}
            activeOpacity={0.8}
          >
            {profile.avatar_sticker ? (
              <View style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}>
                <Text style={styles.stickerAvatar}>{profile.avatar_sticker}</Text>
              </View>
            ) : (
              <AvatarWithFallback 
                uri={profile.profile_picture} 
                displayName={displayName} 
                sticker={profile.avatar_sticker} 
                style={styles.friendAvatar} 
              />            )}
          </TouchableOpacity>

          <Text style={styles.friendName}>{displayName}</Text>
          <Text style={styles.friendBio}>{bio}</Text>

          <View style={styles.quickActionContainer}>
            <TouchableOpacity
              style={styles.messageButtonCircle}
              onPress={() => navigation.navigate('ChatRoom', { conversationId: route.params.conversationId, name: displayName })}
            >
              <Icon name="chatbox" size={28} color="#8100D1" />
            </TouchableOpacity><Text style={styles.messageButtonLabel}>Message</Text>
          </View>

          <View style={styles.actionGrid}>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Call', { callType: 'audio', remoteUserId: profile.id, remoteUserName: displayName, remoteUserPic: profile.profile_picture, conversationId: route.params.conversationId })}>
                <View style={styles.gridIconContainer}><Icon name="call" size={24} color={colors.primary} /></View>
                <Text style={styles.gridButtonText}>Audio Call</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Call', { callType: 'video', remoteUserId: profile.id, remoteUserName: displayName, remoteUserPic: profile.profile_picture, conversationId: route.params.conversationId })}>
                <View style={styles.gridIconContainer}><Icon name="videocam" size={24} color={colors.primary} /></View>
                <Text style={styles.gridButtonText}>Video Call</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('SharedMedia', { conversationId: route.params.conversationId, otherUserId: profile.id })}>
                <View style={styles.gridIconContainer}><Icon name="images" size={24} color={colors.primary} /></View>
                <Text style={styles.gridButtonText}>Shared Media</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('ChatRoom', { conversationId: route.params.conversationId, searchMode: true })}>
                <View style={styles.gridIconContainer}><Icon name="search" size={24} color={colors.primary} /></View>
                <Text style={styles.gridButtonText}>Search</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.friendActionsSection}>
          <TouchableOpacity style={styles.friendActionButton} onPress={handleClearChat} activeOpacity={0.7}>
            <View style={styles.actionIconContainer}><Icon name="trash-outline" size={22} color="#F44336" /></View>
            <View style={styles.actionTextContainer}><Text style={[styles.actionTitle, { color: '#F44336' }]}>Clear Chat</Text></View>
          </TouchableOpacity>
          <View style={styles.actionSeparator} />
          <TouchableOpacity style={[styles.friendActionButton, isBlocked && styles.blockActionActive]} onPress={handleBlockUser} activeOpacity={0.7}>
            <View style={[styles.actionIconContainer, isBlocked && styles.actionIconContainerActive]}>
              <Icon name={isBlocked ? 'shield-checkmark-outline' : 'ban-outline'} size={22} color={isBlocked ? colors.primary : '#F44336'} />
            </View>
            <View style={styles.actionTextContainer}><Text style={[styles.actionTitle, isBlocked && styles.actionTitleActive]}>{isBlocked ? 'Unblock User' : 'Block User'}</Text></View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profilePictureSection}>
        {isUploadingImage && (
          <View style={[styles.profilePicture, styles.profilePicturePlaceholder, styles.uploadingContainer]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        {!isUploadingImage && !isReadOnly && (
          <TouchableOpacity
            onPress={handleAvatarPress}
            onLongPress={handleAvatarLongPress}
            style={[styles.profilePictureContainer, (hasStatus) && styles.avatarRingContainer, ringStyle]}
            disabled={isUploadingImage}
          >
            {profile?.avatar_sticker ? (
              <View style={[styles.profilePicture, styles.profilePicturePlaceholder]}>
                <Text style={styles.stickerAvatar}>{profile.avatar_sticker}</Text>
              </View>
            ) : (
              <AvatarWithFallback 
                uri={profile?.profile_picture} 
                displayName={formData.display_name || formData.username} 
                sticker={profile?.avatar_sticker}
                style={styles.profilePicture} 
             />
            )}
            <TouchableOpacity style={styles.cameraIcon} onPress={() => setShowStickerModal(true)}>
              <Text style={styles.cameraIconText}><Icon name="camera" size={18} color="#000" /></Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        {!isUploadingImage && isReadOnly && (
          <TouchableOpacity 
            onPress={handleAvatarPress}
            onLongPress={handleAvatarLongPress}
            style={[styles.profilePictureContainer, (hasStatus) && styles.avatarRingContainer, ringStyle]}
          >
            {profile?.avatar_sticker ? (
              <View style={[styles.profilePicture, styles.profilePicturePlaceholder]}>
                <Text style={styles.stickerAvatar}>{profile.avatar_sticker}</Text>
              </View>
            ) : (
              <AvatarWithFallback 
                uri={profile?.profile_picture} 
                displayName={formData.display_name || formData.username} 
                sticker={profile?.avatar_sticker}
                style={styles.profilePicture} 
             />
            )}
          </TouchableOpacity>
        )}
        <Text style={styles.changePhotoText}>
          {isReadOnly ? (hasStatus ? 'Tap to view status' : 'Profile Picture') : (hasStatus ? 'Tap for status, long press for preview' : 'Tap for status, long press to preview')}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{isReadOnly ? 'User Information' : 'Profile Information'}</Text>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email</Text>
          <TextInput style={[styles.input, styles.inputDisabled]} value={profile?.email || user?.email || ''} editable={false} />
          <Text style={styles.hint}>Email cannot be changed</Text>
        </View>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[
              styles.input, 
              (isReadOnly || !usernameEditable) && styles.inputDisabled, 
              usernameError && styles.inputError
            ]}
            value={formData.username}
            onChangeText={value => {
              const lowerText = value.toLowerCase();
              setFormData({ ...formData, username: lowerText });
              
              // Character validation
              const regex = /^[a-zA-Z0-9_]*$/;
              if (lowerText.length > 0 && !regex.test(lowerText)) {
                setUsernameError('Invalid characters');
              } else {
                setUsernameError(null);
              }
            }}
            placeholder="Unique username (e.g., johndoe)"
            placeholderTextColor={colors.textSecondary}
            editable={!isReadOnly && usernameEditable}
          />
          {usernameError ? (
            <Text style={styles.errorText}>{usernameError}</Text>
          ) : !isReadOnly && (
            <Text style={[styles.hint, !usernameEditable && { color: 'red' }]}>
              {usernameEditable 
                ? 'Must be unique. Can only be changed once every 14 days.' 
                : 'Username can only be changed once every 14 days.'}
            </Text>
          )}
        </View>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={[styles.input, isReadOnly && styles.inputDisabled]}
            value={formData.display_name}
            onChangeText={value => setFormData({ ...formData, display_name: value })}
            placeholder="How others see you (optional)"
            placeholderTextColor={colors.textSecondary}
            editable={!isReadOnly}
          />
          {!isReadOnly && <Text style={styles.hint}>This is your public display name.</Text>}
        </View>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.multilineInput, isReadOnly && styles.inputDisabled]}
            value={formData.bio}
            onChangeText={value => setFormData({ ...formData, bio: value })}
            placeholder="Your bio"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={139}
            editable={!isReadOnly}
          />
          {!isReadOnly && <Text style={styles.hint}>{(formData.bio || '').length}/139 characters</Text>}
        </View>
        {!isReadOnly && (
          <TouchableOpacity
            style={[
              styles.saveButton, 
              (isSaving || isUploadingImage || (usernameError || (!usernameEditable && formData.username !== profile?.username))) && styles.saveButtonDisabled
            ]}
            onPress={handleSave}
            disabled={isSaving || isUploadingImage || !!usernameError || (!usernameEditable && formData.username !== profile?.username)}
          >
            {isSaving ? <ActivityIndicator color={colors.textLight} /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
          </TouchableOpacity>
        )}
      </View>

      {!isReadOnly && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.accountButtonsRow}>
            <TouchableOpacity style={[styles.accountButton, styles.logoutButtonBorder]} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.accountButton, styles.deleteButtonBorder]} onPress={handleDeleteAccount}>
              <Text style={styles.deleteButtonText}>Delete Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal visible={showPreview} transparent={true} animationType="fade" onRequestClose={() => setShowPreview(false)}>
        <TouchableOpacity style={styles.previewModalOverlay} activeOpacity={1} onPress={() => setShowPreview(false)}>
          <View style={styles.previewModalContent}>
            {previewContent.sticker ? (
              <View style={styles.previewStickerContainer}>
                <Text style={styles.previewStickerText}>{previewContent.sticker}</Text>
              </View>
            ) : previewContent.url ? (
              <Image source={{ uri: resolveImageUrl(previewContent.url) }} style={styles.previewImage} />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Icon name="person" size={80} color="#fff" />
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {!isReadOnly && (
        <Modal
          visible={showStickerModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowStickerModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Choose Avatar</Text>
                <TouchableOpacity onPress={() => setShowStickerModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <View style={styles.stickerOptions}>
                <TouchableOpacity style={[styles.genderTab, selectedGender === 'male' && styles.genderTabActive]} onPress={() => setSelectedGender('male')}><Text style={[styles.genderTabText, selectedGender === 'male' && styles.genderTabTextActive]}>Male</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.genderTab, selectedGender === 'female' && styles.genderTabActive]} onPress={() => setSelectedGender('female')}><Text style={[styles.genderTabText, selectedGender === 'female' && styles.genderTabTextActive]}>Female</Text></TouchableOpacity>
              </View>
              <FlatList
                data={selectedGender === 'male' ? MALE_STICKERS : FEMALE_STICKERS}
                renderItem={renderStickerItem}
                keyExtractor={item => item.id}
                numColumns={3}
                contentContainerStyle={styles.stickerGrid}
              />
              <View style={styles.imageActionRow}>
                <TouchableOpacity style={styles.actionButton} onPress={() => { setShowStickerModal(false); setTimeout(pickImage, 300); }}><Text style={styles.actionButtonText}>📸 Upload</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, styles.removeButton]} onPress={handleRemovePhoto}><Text style={[styles.actionButtonText, styles.removeButtonText]}>🗑️ Remove</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  profilePictureSection: { alignItems: 'center', paddingVertical: spacing.lg, backgroundColor: colors.surface },
  profilePictureContainer: { position: 'relative' },
  profilePicture: { width: 120, height: 120, borderRadius: 60 },
  profilePicturePlaceholder: { backgroundColor: '#E8DEF8', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: colors.primaryLight },
  stickerAvatar: { fontSize: 72 },
  cameraIcon: { position: 'absolute', bottom: 10, right: 8, backgroundColor: colors.surface, width: 24, height: 24, borderRadius: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  cameraIconText: { fontSize: 18 },
  changePhotoText: { marginTop: spacing.sm, fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  section: { backgroundColor: colors.surface, marginTop: spacing.sm, padding: spacing.lg },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: 'bold', color: colors.textPrimary, marginBottom: spacing.lg },
  inputContainer: { marginBottom: spacing.lg },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.background, padding: spacing.md, borderRadius: borderRadius.md, color: colors.textPrimary, fontSize: fontSize.md },
  inputError: { borderColor: 'red', borderWidth: 1 },
  inputDisabled: { opacity: 0.6 },
  multilineInput: { height: 80, textAlignVertical: 'top' },
  hint: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  saveButton: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.md },
  saveButtonText: { color: colors.textLight, fontWeight: 'bold' },
  saveButtonDisabled: { opacity: 0.5 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  menuItemText: { fontSize: fontSize.md, color: colors.textPrimary },
  menuItemIcon: { fontSize: fontSize.md, color: colors.textSecondary },
  accountButtonsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  accountButton: { 
    flex: 1, 
    paddingVertical: spacing.sm, 
    borderRadius: borderRadius.md, 
    alignItems: 'center', 
    justifyContent: 'center',
    borderWidth: 1,
  },
  logoutButtonBorder: { 
    borderColor: '#7e788a', 
    marginRight: spacing.sm 
  },
  deleteButtonBorder: { 
    borderColor: '#F44336', 
    marginLeft: spacing.sm 
  },
  logoutButtonText: { 
    color: '#7e788a', 
    fontWeight: '900',
    fontSize: fontSize.md 
  },
  deleteButtonText: { 
    color: '#F44336', 
    fontWeight: '800',
    fontSize: fontSize.md 
  },
  footer: { alignItems: 'center', padding: spacing.xl },
  footerText: { fontSize: fontSize.sm, color: colors.textSecondary },
  friendProfileHeader: { alignItems: 'center', padding: spacing.lg, backgroundColor: colors.surface },
  friendAvatarContainer: { position: 'relative' },
  friendAvatar: { width: 120, height: 120, borderRadius: 60 },
  friendAvatarPlaceholder: { backgroundColor: '#E8DEF8', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: colors.primary },
  friendAvatarText: { fontSize: 40, color: colors.primary, fontWeight: 'bold' },
  friendName: { fontSize: fontSize.xl, fontWeight: 'bold', marginTop: spacing.md, color: colors.textPrimary },
  friendBio: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: spacing.xs },
  quickActionContainer: { alignItems: 'center', marginTop: spacing.lg },
  messageButtonCircle: { width: 100, height: 60, borderRadius: borderRadius.md, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  messageButtonLabel: { marginTop: spacing.xs, color: colors.primary },
  actionGrid: { marginTop: spacing.xl, width: '100%' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.md },
  gridButton: { alignItems: 'center', width: '40%' },
  gridIconContainer: { width: 100, height: 60, borderRadius: borderRadius.md, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  gridButtonText: { fontSize: fontSize.sm, color: colors.textPrimary },
  friendActionsSection: { backgroundColor: colors.surface, marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  friendActionButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  actionIconContainer: { width: 40, height: 40, borderRadius: borderRadius.md, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
  actionTitle: { fontSize: fontSize.md, color: colors.textPrimary },
  actionSeparator: { height: 1, backgroundColor: colors.background },
  actionIconContainerActive: { backgroundColor: colors.primaryLight },
  blockActionActive: {},
  actionTitleActive: { color: colors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.lg, borderTopRightRadius: borderRadius.lg, padding: spacing.lg, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: fontSize.lg, fontWeight: 'bold' },
  modalClose: { fontSize: fontSize.lg, color: colors.textSecondary },
  stickerOptions: { flexDirection: 'row', marginBottom: spacing.md },
  genderTab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: colors.background },
  genderTabActive: { borderBottomColor: colors.primary },
  genderTabText: { fontSize: fontSize.md, color: colors.textSecondary },
  genderTabTextActive: { color: colors.primary, fontWeight: 'bold' },
  stickerGrid: { justifyContent: 'center' },
  stickerItem: { width: '33%', alignItems: 'center', padding: spacing.sm },
  stickerEmoji: { fontSize: 40 },
  stickerLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  imageActionRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg },
  actionButton: { padding: spacing.md, backgroundColor: colors.background, borderRadius: borderRadius.md, width: '45%', alignItems: 'center' },
  actionButtonText: { fontSize: fontSize.md, color: colors.textPrimary },
  removeButton: { backgroundColor: '#FEEAEA' },
  removeButtonText: { color: '#F44336' },
  previewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewModalContent: {
    width: 250,
    height: 250,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: 250,
    height: 250,
  },
  previewStickerContainer: {
    width: 250,
    height: 250,
    backgroundColor: '#E8DEF8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewStickerText: {
    fontSize: 120,
  },
  previewPlaceholder: {
    width: 250,
    height: 250,
    backgroundColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusViewedRing: { borderWidth: 3, borderColor: '#ccc' },
 
});
