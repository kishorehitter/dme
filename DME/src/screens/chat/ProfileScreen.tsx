import React, { useState, useEffect, useRef } from 'react';
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
import { launchImageLibrary } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { getApiUrl } from '../../config/network';

interface ProfileScreenProps {
  navigation: any;
  route: any;
}

interface UserProfile {
  id: number;
  email: string;
  display_name: string;
  username: string; // Add
  profile_picture: string | null;
  avatar_sticker: string | null;
  bio: string; // Add (replace status)
}

// Sticker avatars (6 male, 6 female)
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

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  navigation,
  route,
}) => {
  const { user, logout } = useAuth();
  const viewingOtherProfile = route?.params?.user;
  const isReadOnly = !!viewingOtherProfile; // Read-only mode when viewing other users
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [formData, setFormData] = useState({
    display_name: '',
    username: '', // Add
    bio: '', // Add
  });
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>(
    'male',
  );

  // For friend profile - clear chat and block
  const [isBlocked, setIsBlocked] = useState(false);
  const [sharedMedia, setSharedMedia] = useState<any[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [displayedMedia, setDisplayedMedia] = useState<any[]>([]);
  const [hasMoreMedia, setHasMoreMedia] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const displayedCountRef = useRef(3); // Start with 3 images

  const loadSharedMedia = async () => {
    if (!viewingOtherProfile?.id) return;
    setIsLoadingMedia(true);
    try {
      const token = await AsyncStorage.getItem('access_token');

      // Get ALL messages first (not just images)
      const messagesResponse = await fetch(
        getApiUrl(`chat/conversations/${viewingOtherProfile.id}/messages/`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (messagesResponse.ok) {
        const data = await messagesResponse.json();
        const allMessages = Array.isArray(data) ? data : data?.results ?? [];

        // Filter for image messages only
        const allImages = allMessages.filter(
          (m: any) => m.message_type === 'image' && m.media_file,
        );

        setSharedMedia(allImages);

        // Show only first 3 initially
        const initialImages = allImages.slice(0, 3);
        setDisplayedMedia(initialImages);
        setHasMoreMedia(allImages.length > 3);
        displayedCountRef.current = 3;

        console.log(
          'Loaded media:',
          allImages.length,
          'images, showing:',
          initialImages.length,
        );
      }
    } catch (error) {
      console.error('Error loading media:', error);
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const loadMoreMedia = () => {
    if (isLoadingMore || !hasMoreMedia) return;

    setIsLoadingMore(true);
    const nextCount = displayedCountRef.current + 3;
    const nextImages = sharedMedia.slice(0, nextCount);

    setDisplayedMedia(nextImages);
    displayedCountRef.current = nextCount;

    if (nextCount >= sharedMedia.length) {
      setHasMoreMedia(false);
    }

    setIsLoadingMore(false);
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

              // Get conversationId from route params if available
              const convId = route.params?.conversationId;

              if (!convId) {
                Toast.show({
                  type: 'error',
                  text1: 'No conversation found',
                  position: 'bottom',
                });
                return;
              }

              // Call clear chat API
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

              // Navigate back to chat list
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

                // Just go back to ChatList - user can navigate to chat naturally
                // This prevents WebSocket connection errors
                navigation.navigate('MainTabs', { screen: 'Chats' });
              } else {
                // Only show error if it's a real error (not 200 OK)
                const errorData = await response.json().catch(() => ({}));
                console.error('Block/unblock error:', errorData);
                Toast.show({
                  type: 'error',
                  text1:
                    errorData.error || `Failed to ${action.toLowerCase()} user`,
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
    if (viewingOtherProfile) {
      loadSharedMedia();
      loadBlockStatus();
    }
  }, [viewingOtherProfile]);

  useEffect(() => {
    if (viewingOtherProfile) {
      // Viewing another user's profile - read-only mode
      setProfile(viewingOtherProfile);
      setFormData({
        display_name: viewingOtherProfile.display_name || '',
        username: viewingOtherProfile.username || '', // Add
        bio: viewingOtherProfile.bio || '', // Add (replace status)
      });
    } else {
      loadProfile();
    }
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
          username: data.username || '', // Add
          bio: data.bio || '', // Add
        });
      } else if (user) {
        // Fallback to context user data
        setProfile(user as any);
        setFormData({
          display_name: user.display_name || '',
          username: user.username || '', // Add
          bio: user.bio || '', // Add
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      if (user) {
        setProfile(user as any);
        setFormData({
          display_name: user.display_name || '',
          username: user.username || '', // Add
          bio: user.bio || '', // Add
        });
      }
    }
  };

  const compressImage = async (uri: string): Promise<string | null> => {
    return new Promise(resolve => {
      const img = new Image();
      img.src = uri;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const maxSize = 800;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height * maxSize) / width;
            width = maxSize;
          } else {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const estimatedSize = (compressedDataUrl.length * 3) / 4;

        if (estimatedSize > 50000) {
          const finalDataUrl = canvas.toDataURL('image/jpeg', 0.5);
          resolve(finalDataUrl);
        } else {
          resolve(compressedDataUrl);
        }
      };
      img.onerror = () => {
        resolve(null);
      };
    });
  };

  const pickImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.7,
        includeBase64: true,
      });

      if (result.didCancel) {
        return;
      }

      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick image');
        return;
      }

      const asset = result.assets?.[0];
      if (asset?.base64) {
        const base64Image = `data:${asset.type};base64,${asset.base64}`;
        const estimatedSize = (asset.base64.length * 3) / 4;

        setIsUploadingImage(true);

        let imageToUpload = base64Image;
        if (estimatedSize > 50000) {
          const compressedImage = await compressImage(asset.uri || '');
          if (compressedImage) {
            imageToUpload = compressedImage;
          }
        }

        await uploadProfilePicture(imageToUpload);
        setIsUploadingImage(false);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
      setIsUploadingImage(false);
    }
  };

  const uploadProfilePicture = async (imageData: string) => {
    try {
      const token = await AsyncStorage.getItem('access_token');

      const formDataUpload = new FormData();
      formDataUpload.append('profile_picture', {
        uri: imageData,
        type: 'image/jpeg',
        name: 'profile.jpg',
      } as any);
      // Clear avatar sticker when uploading image
      formDataUpload.append('avatar_sticker', '');

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

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        Alert.alert('Success', 'Profile picture updated successfully');
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert(
          'Error',
          errorData.message || 'Failed to update profile picture',
        );
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
            profile_picture: null, // Clear image when using sticker
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
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
    // Add validation for username
    if (!formData.username.trim()) {
      Alert.alert('Error', 'Username is required.');
      setIsSaving(false);
      return;
    }
    // Add validation for bio (optional, but good practice)
    if (formData.bio.trim().length > 139) {
      Alert.alert('Error', 'Bio cannot exceed 139 characters.');
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    try {
      const token = await AsyncStorage.getItem('access_token');

      // Prepare the data to send - include new fields
      const updateData: any = {
        username: formData.username.trim(), // New field
        bio: formData.bio.trim(), // Replaces status
      };

      // Keep display_name if provided
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
        // Update form data with response to ensure sync
        setFormData({
          display_name: data.display_name || '',
          username: data.username || '',
          bio: data.bio || '',
        });
        Alert.alert('Success', 'Profile updated successfully', [
          {
            text: 'OK',
            onPress: () => navigation.navigate('MainTabs', { screen: 'Chats' }),
          },
        ]);
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert('Error', errorData.message || 'Failed to update profile');
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
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  const renderStickerItem = ({
    item,
  }: {
    item: { id: string; emoji: string; label: string };
  }) => (
    <TouchableOpacity
      style={styles.stickerItem}
      onPress={() => selectSticker(item.emoji)}
    >
      <Text style={styles.stickerEmoji}>{item.emoji}</Text>
      <Text style={styles.stickerLabel}>{item.label}</Text>
    </TouchableOpacity>
  );

  // Simplified friend profile view
  if (isReadOnly && viewingOtherProfile) {
    // Use username as primary identifier for display if available, then fallback
    const displayName =
      viewingOtherProfile.display_name ||
      viewingOtherProfile.username || // Add username here
      viewingOtherProfile.first_name ||
      viewingOtherProfile.email ||
      'User';
    const bio = viewingOtherProfile.bio || 'No bio available'; // Use 'bio' instead of 'status'

    return (
      <ScrollView style={styles.container}>
        {/* Profile Header */}
        <View style={styles.friendProfileHeader}>
          {/* Profile Picture */}
          <View style={styles.friendAvatarContainer}>
            {viewingOtherProfile.avatar_sticker ? (
              <View
                style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}
              >
                <Text style={styles.stickerAvatar}>
                  {viewingOtherProfile.avatar_sticker}
                </Text>
              </View>
            ) : viewingOtherProfile.profile_picture ? (
              <Image
                source={{ uri: viewingOtherProfile.profile_picture }}
                style={styles.friendAvatar}
              />
            ) : (
              <View
                style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}
              >
                <Text style={styles.friendAvatarText}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Username */}
          <Text style={styles.friendName}>{displayName}</Text>

          {/* Bio */}
          <Text style={styles.friendBio}>{bio}</Text>
        </View>

        {/* Shared Media Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Shared Media</Text>
          </View>

          {isLoadingMedia ? (
            <View style={styles.mediaLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : displayedMedia.length > 0 ? (
            <>
              <FlatList
                data={displayedMedia}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={item => item.id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.mediaItemHorizontal}
                    onPress={() => setSelectedImage(item.media_file)}
                  >
                    <Image
                      source={{ uri: item.media_file }}
                      style={styles.mediaImageHorizontal}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                )}
                onEndReached={loadMoreMedia}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  isLoadingMore ? (
                    <View style={styles.mediaLoadingFooter}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  ) : null
                }
              />
              {hasMoreMedia && (
                <TouchableOpacity
                  style={styles.loadMoreButton}
                  onPress={loadMoreMedia}
                >
                  <Text style={styles.loadMoreButtonText}>Load More</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={styles.mediaEmpty}>
              <Text style={styles.mediaEmptyText}>No shared media</Text>
            </View>
          )}
        </View>

        {/* Image Viewer Modal */}
        <Modal
          visible={!!selectedImage}
          transparent
          onRequestClose={() => setSelectedImage(null)}
        >
          <View style={styles.imageViewerModal}>
            <TouchableOpacity
              style={styles.imageViewerClose}
              onPress={() => setSelectedImage(null)}
            >
              <Text style={styles.imageViewerCloseText}>✕</Text>
            </TouchableOpacity>
            {selectedImage && (
              <Image
                source={{ uri: selectedImage }}
                style={styles.imageViewerImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>

        {/* Action Buttons - Stacked vertically */}
        <View style={styles.friendActionsSection}>
          <TouchableOpacity
            style={styles.friendActionButton}
            onPress={handleClearChat}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconContainer}>
              <Text style={styles.actionIcon}>🗑️</Text>
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Clear Chat</Text>
              <Text style={styles.actionSubtitle}>
                Clear messages from your view
              </Text>
            </View>
            <Text style={styles.actionArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.actionSeparator} />

          <TouchableOpacity
            style={[
              styles.friendActionButton,
              isBlocked && styles.blockActionActive,
            ]}
            onPress={handleBlockUser}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.actionIconContainer,
                isBlocked && styles.actionIconContainerActive,
              ]}
            >
              <Text style={styles.actionIcon}>{isBlocked ? '✓' : '🚫'}</Text>
            </View>
            <View style={styles.actionTextContainer}>
              <Text
                style={[
                  styles.actionTitle,
                  isBlocked && styles.actionTitleActive,
                ]}
              >
                {isBlocked ? 'Unblock User' : 'Block User'}
              </Text>
              <Text
                style={[
                  styles.actionSubtitle,
                  isBlocked && styles.actionSubtitleActive,
                ]}
              >
                {isBlocked
                  ? 'User is currently blocked'
                  : 'Prevent them from messaging you'}
              </Text>
            </View>
            <Text style={styles.actionArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Own profile view continues below...
  return (
    <ScrollView style={styles.container}>
      {/* Profile Picture Section */}
      <View style={styles.profilePictureSection}>
        {!isReadOnly && (
          <TouchableOpacity
            onPress={() => setShowStickerModal(true)}
            style={styles.profilePictureContainer}
            disabled={isUploadingImage}
          >
            {isUploadingImage ? (
              <View
                style={[
                  styles.profilePicture,
                  styles.profilePicturePlaceholder,
                  styles.uploadingContainer,
                ]}
              >
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : profile?.avatar_sticker ? (
              <View
                style={[
                  styles.profilePicture,
                  styles.profilePicturePlaceholder,
                ]}
              >
                <Text style={styles.stickerAvatar}>
                  {profile.avatar_sticker}
                </Text>
              </View>
            ) : profile?.profile_picture ? (
              <Image
                source={{ uri: profile.profile_picture }}
                style={styles.profilePicture}
              />
            ) : (
              <View
                style={[
                  styles.profilePicture,
                  styles.profilePicturePlaceholder,
                ]}
              >
                <Text style={styles.profilePictureText}>
                  {(formData.display_name || formData.username || 'U')
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.cameraIcon}>
              <Text style={styles.cameraIconText}>📷</Text>
            </View>
          </TouchableOpacity>
        )}
        {/* Read-only profile picture display */}
        {isReadOnly && (
          <View style={styles.profilePictureContainer}>
            {profile?.avatar_sticker ? (
              <View
                style={[
                  styles.profilePicture,
                  styles.profilePicturePlaceholder,
                ]}
              >
                <Text style={styles.stickerAvatar}>
                  {profile.avatar_sticker}
                </Text>
              </View>
            ) : profile?.profile_picture ? (
              <Image
                source={{ uri: profile.profile_picture }}
                style={styles.profilePicture}
              />
            ) : (
              <View
                style={[
                  styles.profilePicture,
                  styles.profilePicturePlaceholder,
                ]}
              >
                <Text style={styles.profilePictureText}>
                  {(formData.display_name || formData.username || 'U')
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.changePhotoText}>
          {isReadOnly ? 'Profile Picture' : 'Tap to change photo or sticker'}
        </Text>
      </View>

      {/* Profile Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {isReadOnly ? 'User Information' : 'Profile Information'}
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, styles.inputDisabled]}
            value={profile?.email || user?.email || ''}
            editable={false}
          />
          <Text style={styles.hint}>Email cannot be changed</Text>
        </View>

        {/* Username input */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[styles.input, isReadOnly && styles.inputDisabled]}
            value={formData.username}
            onChangeText={value =>
              setFormData({ ...formData, username: value })
            }
            placeholder="Unique username (e.g., johndoe)"
            placeholderTextColor={colors.textSecondary}
            editable={!isReadOnly}
          />
          {!isReadOnly && (
            <Text style={styles.hint}>
              Must be unique. Can only be changed once every 14 days.
            </Text>
          )}
        </View>

        {/* Display Name input (kept as is for now, but user might want username instead) */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={[styles.input, isReadOnly && styles.inputDisabled]}
            value={formData.display_name}
            onChangeText={value =>
              setFormData({ ...formData, display_name: value })
            }
            placeholder="How others see you (optional)"
            placeholderTextColor={colors.textSecondary}
            editable={!isReadOnly}
          />
          {!isReadOnly && (
            <Text style={styles.hint}>
              This is your public display name. Username is for login and
              search.
            </Text>
          )}
        </View>

        {/* Bio input (replaces status) */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[
              styles.input,
              styles.multilineInput,
              isReadOnly && styles.inputDisabled,
            ]}
            value={formData.bio}
            onChangeText={value => setFormData({ ...formData, bio: value })}
            placeholder="Your bio"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={139}
            editable={!isReadOnly}
          />
          {!isReadOnly && (
            <Text style={styles.hint}>
              {(formData.bio || '').length}/139 characters
            </Text>
          )}
        </View>

        {!isReadOnly && (
          <TouchableOpacity
            style={[
              styles.saveButton,
              (isSaving || isUploadingImage) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={isSaving || isUploadingImage}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textLight} />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Account Section - Only show for own profile */}
      {!isReadOnly && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <Text style={styles.menuItemText}>Logout</Text>
            <Text style={styles.menuItemIcon}>→</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>DME v1.0.0</Text>
      </View>

      {/* Sticker Selection Modal - Only for own profile */}
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
                <TouchableOpacity onPress={() => setShowStickerModal(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.stickerOptions}>
                <TouchableOpacity
                  style={[
                    styles.genderTab,
                    selectedGender === 'male' && styles.genderTabActive,
                  ]}
                  onPress={() => setSelectedGender('male')}
                >
                  <Text
                    style={[
                      styles.genderTabText,
                      selectedGender === 'male' && styles.genderTabTextActive,
                    ]}
                  >
                    Male
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.genderTab,
                    selectedGender === 'female' && styles.genderTabActive,
                  ]}
                  onPress={() => setSelectedGender('female')}
                >
                  <Text
                    style={[
                      styles.genderTabText,
                      selectedGender === 'female' && styles.genderTabTextActive,
                    ]}
                  >
                    Female
                  </Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={
                  selectedGender === 'male' ? MALE_STICKERS : FEMALE_STICKERS
                }
                renderItem={renderStickerItem}
                keyExtractor={item => item.id}
                numColumns={3}
                contentContainerStyle={styles.stickerGrid}
              />

              <TouchableOpacity
                style={styles.uploadImageButton}
                onPress={() => {
                  setShowStickerModal(false);
                  setTimeout(pickImage, 300);
                }}
              >
                <Text style={styles.uploadImageButtonText}>
                  📸 Upload Photo Instead
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  profilePictureSection: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    backgroundColor: colors.surface,
  },
  profilePictureContainer: {
    position: 'relative',
  },
  profilePicture: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profilePicturePlaceholder: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.primaryLight,
  },
  profilePictureText: {
    fontSize: 48,
    color: colors.textLight,
    fontWeight: 'bold',
  },
  stickerAvatar: {
    fontSize: 72,
  },
  uploadingContainer: {
    backgroundColor: colors.background,
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  cameraIconText: {
    fontSize: 18,
  },
  changePhotoText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  section: {
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfWidth: {
    width: '48%',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: colors.background,
    opacity: 0.7,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: colors.textLight,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemText: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  menuItemIcon: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  modalClose: {
    fontSize: fontSize.xl,
    color: colors.textSecondary,
  },
  stickerOptions: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  genderTab: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.background,
    marginHorizontal: spacing.xs,
    borderRadius: borderRadius.md,
  },
  genderTabActive: {
    backgroundColor: colors.primary,
  },
  genderTabText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  genderTabTextActive: {
    color: colors.textLight,
  },
  stickerGrid: {
    paddingHorizontal: spacing.xs,
  },
  stickerItem: {
    flex: 1,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  stickerEmoji: {
    fontSize: 48,
  },
  stickerLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  uploadImageButtonText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  // Image viewer modal
  imageViewerModal: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerImage: {
    width: '100%',
    height: '100%',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 10,
  },
  imageViewerCloseText: {
    fontSize: 24,
    color: '#FFF',
  },
  // Friend profile styles (WhatsApp/Instagram inspired)
  friendProfileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  friendAvatarContainer: {
    marginBottom: spacing.lg,
  },
  friendAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  friendAvatarPlaceholder: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.primaryLight,
  },
  friendAvatarText: {
    fontSize: 48,
    color: colors.textLight,
    fontWeight: 'bold',
  },
  friendName: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  friendBio: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  // Section styles
  section: {
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  // Media horizontal scroll
  mediaLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  mediaLoadingFooter: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  loadMoreButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  loadMoreButtonText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  mediaItemHorizontal: {
    width: 100,
    height: 100,
    marginRight: spacing.sm,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  mediaImageHorizontal: {
    width: '100%',
    height: '100%',
  },
  mediaEmpty: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  mediaEmptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  // Action buttons - stacked vertically
  friendActionsSection: {
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  friendActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  blockActionActive: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  actionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  actionIconContainerActive: {
    backgroundColor: '#888888',
  },
  actionIcon: {
    fontSize: 20,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  actionTitleActive: {
    color: '#888888',
  },
  actionSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  actionSubtitleActive: {
    color: '#888888',
  },
  actionArrow: {
    fontSize: 24,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  actionSeparator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
});

export default ProfileScreen;
