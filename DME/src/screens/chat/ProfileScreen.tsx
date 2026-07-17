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
  TouchableWithoutFeedback,
  Dimensions,
  Linking,
  InteractionManager,
  Share,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { launchImageLibrary } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import Clipboard from '@react-native-clipboard/clipboard';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { getApiUrl } from '../../config/network';
import { resolveImageUrl } from '../../utils/image';
import { StatusService, UserStatusGroup, Status } from '../../services/StatusService';
import { chatAPI } from '../../services/api';
import { MediaPickerModal } from '../../components/MediaPickerModal';
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';

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
  quick_reaction: string;
  bio: string;
  last_username_change: string | null;
}

const QUICK_REACTIONS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', 
  '😂', '😍', '😮', '😢', '😡', '👍', '👎', '🎉', '🔥', '✨', '💯', '🙏', '👏', '😎', '🤔'
];

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

import AvatarWithFallback from '../../components/AvatarWithFallback';

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  navigation,
  route,
}) => {
  const { user, logout, deleteAccount, refreshUser } = useAuth();
  const viewingOtherProfile = route?.params?.user;
  const isReadOnly = !!viewingOtherProfile;
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(route?.params?.conversationId || null);
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (viewingOtherProfile) return viewingOtherProfile;
    if (user) {
      return {
        id: user.id,
        display_name: user.display_name || '',
        username: user.username || '',
        bio: user.bio || '',
        profile_picture: user.profile_picture || null,
        avatar_sticker: user.avatar_sticker || null,
        quick_reaction: user.quick_reaction || '❤️',
      } as any;
    }
    return null;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [statusGalleryVisible, setStatusGalleryVisible] = useState(false);
  const [profileGalleryVisible, setProfileGalleryVisible] = useState(false);
  const [formData, setFormData] = useState(() => {
    const p = viewingOtherProfile || user;
    return {
      display_name: p?.display_name || '',
      username: p?.username || '',
      bio: p?.bio || '',
      quick_reaction: p?.quick_reaction || '❤️',
    };
  });
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male');
  const [isBlocked, setIsBlocked] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [friendStatus, setFriendStatus] = useState<string>(() => {
    return viewingOtherProfile?.friend_status || 'none';
  });

  const handleCopyUsername = () => {
    if (profile?.username) {
      Clipboard.setString(profile.username);
      Toast.show({
        type: 'success',
        text1: 'Username copied',
        text2: `@${profile.username} copied to clipboard`,
        position: 'bottom',
      });
    }
  };
  const [showMenu, setShowMenu] = useState(false);
  const [sharedMedia, setSharedMedia] = useState<any[]>([]);
  const [activeAlbumTab, setActiveAlbumTab] = useState('image');

  const ALBUM_TABS = [
    { key: 'image', label: 'Images', icon: 'image-outline' },
    { key: 'video', label: 'Videos', icon: 'videocam-outline' },
    { key: 'audio', label: 'Audio', icon: 'mic-outline' },
    { key: 'document', label: 'Docs', icon: 'document-text-outline' },
  ];

  const fetchSharedMedia = async () => {
    if (!conversationId) return;
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`chat/conversations/${conversationId}/media/?type=${activeAlbumTab}`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setSharedMedia(data);
      }
    } catch (error) {
      console.warn('Failed to fetch shared media for profile:', error);
    }
  };

  useEffect(() => {
    if (isReadOnly && conversationId) {
      const task = InteractionManager.runAfterInteractions(() => {
        fetchSharedMedia();
      });
      return () => task.cancel();
    }
  }, [isReadOnly, conversationId, activeAlbumTab]);

  useEffect(() => {
    navigation.setOptions({
      title: isReadOnly ? (profile?.display_name || 'Profile') : (isEditingMode ? 'Edit Profile' : 'My Profile'),
      headerTintColor: '#1A1A1A',
      headerTitleStyle: {
        color: '#1A1A1A',
        fontWeight: 'bold',
        fontSize: 20,
      },
      headerRight: (isReadOnly || !isEditingMode) ? () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
          {isReadOnly && conversationId ? (
            <TouchableOpacity 
              onPress={() => navigation.navigate('ChatRoom', { conversationId, searchMode: true })}
              style={{ marginRight: 16 }}
            >
              <Icon name="search" size={24} color="#1A1A1A" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setShowMenu(true)}>
            <Icon name="ellipsis-vertical" size={24} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
      ) : undefined
    });
  }, [navigation, isReadOnly, isEditingMode, conversationId, profile?.display_name]);

  useEffect(() => {
    if (!isReadOnly && isEditingMode) {
      navigation.setOptions({
        headerLeft: () => (
          <TouchableOpacity onPress={() => setIsEditingMode(false)} style={{ marginLeft: 16 }}>
            <Icon name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
        )
      });
    } else {
      navigation.setOptions({
        headerLeft: undefined
      });
    }
  }, [navigation, isReadOnly, isEditingMode]);

  const fetchFriendStatus = async () => {
    if (!viewingOtherProfile?.id) return;
    try {
      const friendsList = await chatAPI.getFriends();
      const isFriend = friendsList.some((f: any) => f.id === viewingOtherProfile.id);
      if (isFriend) {
        setFriendStatus('friends');
        return;
      }
      
      const reqs = await chatAPI.getFriendRequests();
      const req = reqs.find((r: any) => 
        r.sender?.id === viewingOtherProfile.id || 
        r.from_user?.id === viewingOtherProfile.id || 
        r.receiver?.id === viewingOtherProfile.id || 
        r.to_user?.id === viewingOtherProfile.id
      );
      if (req) {
        const isOutgoing = req.sender?.id === user?.id || req.from_user?.id === user?.id || req.direction === 'outgoing';
        setFriendStatus(isOutgoing ? 'sent_pending' : 'received_pending');
      } else {
        setFriendStatus('none');
      }
    } catch (err) {
      console.warn('Error loading friend status dynamically:', err);
    }
  };

  const handleFriendAction = async () => {
    if (!profile) return;
    try {
      if (friendStatus === 'none') {
        await chatAPI.sendFriendRequest(profile.id);
        setFriendStatus('sent_pending');
        Toast.show({ type: 'success', text1: 'Friend request sent', position: 'bottom' });
      } else if (friendStatus === 'sent_pending') {
        await chatAPI.cancelFriendRequestByUserId(profile.id);
        setFriendStatus('none');
        Toast.show({ type: 'info', text1: 'Friend request cancelled', position: 'bottom' });
      } else if (friendStatus === 'received_pending') {
        const reqs = await chatAPI.getFriendRequests();
        const incomingReq = reqs.find((r: any) => r.sender?.id === profile.id || r.from_user?.id === profile.id);
        if (incomingReq) {
          await chatAPI.acceptFriendRequest(incomingReq.id);
          setFriendStatus('friends');
          Toast.show({ type: 'success', text1: 'Friend request accepted', position: 'bottom' });
        } else {
          await chatAPI.sendFriendRequest(profile.id);
        }
      } else if (friendStatus === 'friends') {
        Alert.alert(
          'Remove Friend',
          `Are you sure you want to remove ${displayNameFromProfile(profile)} from your friends?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: async () => {
                try {
                  await chatAPI.unfriend(profile.id);
                  setFriendStatus('none');
                  Toast.show({ type: 'info', text1: 'Friend removed', position: 'bottom' });
                } catch {
                  Alert.alert('Error', 'Failed to remove friend');
                }
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to update friendship status');
    }
  };

  const handleOpenChat = async () => {
    if (!profile) return;
    try {
      let convId = route.params?.conversationId;
      if (!convId) {
        const conversation = await chatAPI.getOrCreateDirectChat(profile.id);
        convId = conversation.id;
      }
      if (convId) {
        navigation.navigate('ChatRoom', {
          conversationId: convId,
          name: displayNameFromProfile(profile),
          avatarUri: profile.profile_picture,
          avatarSticker: profile.avatar_sticker,
          isGroup: false,
          otherUser: profile,
        });
      } else {
        Alert.alert('Error', 'Could not open chat room');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to open chat room');
    }
  };

  const displayNameFromProfile = (p: any) => {
    return p.display_name || p.username || p.email || 'User';
  };

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

  const handleMediaSelected = (assets: any[]) => {
    setMediaPickerVisible(false);
    if (Array.isArray(assets) && assets.length > 0) {
      const asset = assets[0];
      navigation.navigate('StatusEditor', {
        mediaUri: asset.uri,
        mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
        source: 'gallery',
      });
    } else if (assets && (assets as any).uri) {
      const asset = assets as any;
      navigation.navigate('StatusEditor', {
        mediaUri: asset.uri,
        mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
        source: 'gallery',
      });
    }
  };

  const handleStatusGallerySelect = (assets: GalleryAsset[]) => {
    setStatusGalleryVisible(false);
    if (assets && assets.length > 0) {
      const asset = assets[0];
      navigation.navigate('StatusEditor', {
        mediaUri: asset.uri,
        mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
        source: 'gallery',
      });
    }
  };

  const handleProfileGallerySelect = async (assets: GalleryAsset[]) => {
    setProfileGalleryVisible(false);
    if (assets && assets.length > 0) {
      const asset = assets[0];
      setIsUploadingImage(true);
      await uploadProfilePicture(asset);
      setIsUploadingImage(false);
    }
  };

  const handleShareProfile = async () => {
    try {
      const shareMessage = `Username: ${profile?.username || ''}`;
      await Share.share({
        message: shareMessage,
      });
    } catch (error) {
      console.error('Error sharing profile:', error);
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
        } else {
          setUserStatus(null);
        }
      } else {
        setUserStatus(null);
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
                
                try {
                  const key = `settings_blocked_users_${user?.id || 'default'}`;
                  const stored = await AsyncStorage.getItem(key);
                  const list = stored ? JSON.parse(stored) : [];
                  if (!isBlocked) {
                    // Blocked: Add to list
                    const name = viewingOtherProfile.display_name || viewingOtherProfile.username || viewingOtherProfile.email || 'User';
                    if (!list.some((u: any) => u.id === viewingOtherProfile.id.toString())) {
                      list.push({ id: viewingOtherProfile.id.toString(), name });
                    }
                  } else {
                    // Unblocked: Remove from list
                    const filtered = list.filter((u: any) => u.id !== viewingOtherProfile.id.toString());
                    await AsyncStorage.setItem(key, JSON.stringify(filtered));
                  }
                  if (!isBlocked) {
                    await AsyncStorage.setItem(key, JSON.stringify(list));
                  }
                } catch (e) {
                  console.warn('Failed to sync blocked list in ProfileScreen', e);
                }

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
        fetchFriendStatus();
        
        if (!route?.params?.conversationId) {
          try {
            const token = await AsyncStorage.getItem('access_token');
            const response = await fetch(getApiUrl('chat/conversations/'), {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
              const convs = await response.json();
              const match = convs.find((c: any) => !c.is_group && c.other_user?.id === viewingOtherProfile.id);
              if (match) {
                setConversationId(match.id);
              }
            }
          } catch (e) {
            console.warn('Failed to auto-resolve conversation ID:', e);
          }
        }
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
              quick_reaction: fullProfile.quick_reaction || '❤️',
            });
          } else if (response.status === 403) {
            Alert.alert(
              'Profile Unavailable',
              'This profile is not available.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          } else {
            setProfile(viewingOtherProfile);
            setFormData({
              display_name: viewingOtherProfile.display_name || '',
              username: viewingOtherProfile.username || '',
              bio: viewingOtherProfile.bio || '',
              quick_reaction: viewingOtherProfile.quick_reaction || '❤️',
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
    const task = InteractionManager.runAfterInteractions(() => {
      initializeProfile();
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadStatus();
    });
    return unsubscribe;
  }, [navigation]);

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
          quick_reaction: data.quick_reaction || '❤️',
        });
      } else if (user) {
        setProfile(user as any);
        setFormData({
          display_name: user.display_name || '',
          username: user.username || '',
          bio: user.bio || '',
          quick_reaction: user.quick_reaction || '❤️',
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
          quick_reaction: user.quick_reaction || '❤️',
        });
      }
    }
  };

  const pickImage = () => {
    setProfileGalleryVisible(true);
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
        quick_reaction: formData.quick_reaction,
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
          quick_reaction: data.quick_reaction || '❤️',
        });
        await refreshUser();
        Toast.show({
          type: 'success',
          text1: 'Profile updated successfully',
          position: 'bottom',
        });
        setIsEditingMode(false);
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

  if ((isReadOnly || !isEditingMode) && profile) {
    const displayName = profile.display_name || profile.username || profile.email || 'User';
    const bio = profile.bio || 'No bio available'; 

    return (
      <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.friendProfileHeader}>
          <TouchableOpacity 
            style={styles.avatarWrapper90}
            onPress={handleAvatarPress}
            onLongPress={handleAvatarLongPress}
            activeOpacity={0.8}
          >
            {hasStatus && (
              allSeen ? (
                <View style={styles.ringViewed90} />
              ) : (
                <LinearGradient
                  colors={['#ff4d6d', '#4597f5f6']}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientRing90}
                >
                  <View style={styles.gradientRingInner90} />
                </LinearGradient>
              )
            )}
            <AvatarWithFallback 
              uri={profile.profile_picture} 
              displayName={displayName} 
              sticker={profile.avatar_sticker} 
              style={styles.friendAvatar} 
            />
          </TouchableOpacity>

          <View style={styles.friendHeaderInfo}>
            <Text style={styles.friendName}>{displayName}</Text>
            {profile.username ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={styles.friendUsername}>
                  <Text style={{ color: '#999', fontSize: 14, fontWeight: 'normal' }}>@</Text>
                  {profile.username}
                </Text>
                <TouchableOpacity onPress={handleCopyUsername} style={{ padding: 4 }}>
                  <Icon name="copy-outline" size={20} color="#777" />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* Bio and Friends Count placed below the profile row */}
        <View style={[styles.friendDetailsContainer, { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, marginRight: 16, marginLeft: 8 }}>
            <Text style={styles.friendBioText}>{bio}</Text>
          </View>
          <View style={{ alignItems: 'center', minWidth: 65, paddingTop: 4 }}>
            <Text style={{ fontSize: 12, color: '#666', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>Friends</Text>
            <Text style={{ fontSize: 18, color: '#1A1A1A', fontWeight: 'bold', marginTop: 2 }}>
              {profile.friends_count !== undefined ? profile.friends_count : 0}
            </Text>
          </View>
        </View>

        <View style={styles.profileButtonsRow}>
          {isReadOnly ? (
            <>
              <TouchableOpacity
                style={[
                  styles.profileActionBtn,
                  friendStatus === 'none' ? styles.primaryBtn : styles.secondaryBtn
                ]}
                onPress={handleFriendAction}
              >
                <Text style={[
                  styles.profileActionBtnText,
                  friendStatus === 'none' ? styles.primaryBtnText : styles.secondaryBtnText
                ]}>
                  {friendStatus === 'none' && 'Add Friend'}
                  {friendStatus === 'sent_pending' && 'Cancel Request'}
                  {friendStatus === 'received_pending' && 'Accept Request'}
                  {friendStatus === 'friends' && 'Friends'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileActionBtn, styles.secondaryBtn]}
                onPress={handleOpenChat}
              >
                <Text style={[styles.profileActionBtnText, styles.secondaryBtnText]}>
                  Message
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.profileActionBtn, styles.primaryBtn]}
                onPress={() => setIsEditingMode(true)}
              >
                <Text style={[styles.profileActionBtnText, styles.primaryBtnText]}>
                  Edit Profile
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileActionBtn, styles.secondaryBtn]}
                onPress={handleShareProfile}
              >
                <Text style={[styles.profileActionBtnText, styles.secondaryBtnText]}>
                  Share Profile
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {isReadOnly ? (
          <View style={styles.sharedAlbumSection}>
            <Text style={styles.sharedAlbumTitle}>Shared Album</Text>

            <View style={styles.albumTabRow}>
              {ALBUM_TABS.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.albumTab, activeAlbumTab === tab.key && styles.activeAlbumTab]}
                  onPress={() => setActiveAlbumTab(tab.key)}
                >
                  <Icon name={tab.icon} size={16} color={activeAlbumTab === tab.key ? colors.primary : '#888'} />
                  <Text style={[styles.albumTabText, activeAlbumTab === tab.key && styles.activeAlbumTabText]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {sharedMedia.length === 0 ? (
              <View style={styles.emptySharedMedia}>
                <Icon name="folder-open-outline" size={48} color="#CCC" />
                <Text style={styles.emptySharedMediaText}>No {activeAlbumTab}s shared yet</Text>
              </View>
            ) : activeAlbumTab === 'image' || activeAlbumTab === 'video' ? (
              <View style={styles.mediaGrid}>
                {sharedMedia.map((item, index) => {
                  const url = resolveImageUrl(item.media_url || item.media_file);
                  const mediaList = sharedMedia.map(m => ({
                    mediaUrl: resolveImageUrl(m.media_url || m.media_file),
                    mediaType: activeAlbumTab as 'image' | 'video',
                    id: m.id,
                    caption: m.content || '',
                  }));
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.gridImageWrapper}
                      onPress={() => navigation.navigate('MediaViewer', {
                        mediaUrl: url,
                        mediaType: activeAlbumTab,
                        mediaList,
                        initialIndex: index,
                      })}
                    >
                      {activeAlbumTab === 'image' ? (
                        <Image source={{ uri: url }} style={styles.gridImage} />
                      ) : (
                        <View style={styles.mediaPlaceholder}>
                          <Icon name="play-circle-outline" size={32} color="#fff" style={styles.playIcon} />
                          <View style={styles.videoOverlay} />
                          <Icon name="videocam" size={24} color="#ccc" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.mediaListContainer}>
                {sharedMedia.map(item => {
                  const date = new Date(item.created_at).toLocaleDateString();
                  const fileName = item.media_file ? item.media_file.split('/').pop() : 'Media File';
                  return (
                    <TouchableOpacity 
                      key={item.id}
                      style={styles.mediaListItem} 
                      onPress={() => {
                        if (item.media_file || item.media_url) {
                          const url = resolveImageUrl(item.media_file || item.media_url);
                          Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open file URL'));
                        }
                      }}
                    >
                      <View style={[styles.listIconContainer, activeAlbumTab === 'audio' ? styles.audioIconBg : styles.docIconBg]}>
                        <Icon name={activeAlbumTab === 'audio' ? 'mic' : 'document-text'} size={20} color="#fff" />
                      </View>
                      <View style={styles.listTextContainer}>
                        <Text style={styles.listFileName} numberOfLines={1}>{fileName}</Text>
                        <Text style={styles.listDate}>{date}</Text>
                      </View>
                      <Icon name="chevron-forward" size={18} color="#ccc" />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.sharedAlbumSection, { flex: 1 }]}>
            {/* Horizontal list of uploaded stories directly below the buttons */}
            {hasStatus && userStatus && (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.sharedAlbumTitle}>Status</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false} 
                  contentContainerStyle={styles.horizontalScrollContent}
                >
                  {userStatus.statuses.map((status: Status) => {
                    const isVideo = status.media_type === 'video';
                    return (
                      <TouchableOpacity
                        key={status.id}
                        style={styles.horizontalImageWrapper}
                        onPress={() => {
                          navigation.navigate('StatusViewer', { 
                            statuses: userStatus.statuses, 
                            initialIndex: userStatus.statuses.indexOf(status),
                            currentUserId: user?.id,
                            isOwn: true
                          });
                        }}
                      >
                        <Image source={{ uri: resolveImageUrl(status.media_url) }} style={styles.horizontalImage} />
                        {isVideo && (
                          <View style={styles.videoOverlay}>
                            <Icon name="play" size={16} color="#fff" style={styles.playIcon} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.uploadStorySection}>
              <TouchableOpacity 
                style={styles.uploadStoryCard} 
                onPress={() => setStatusGalleryVisible(true)}
              >
                <View style={styles.plusIconCircle}>
                  <Icon name="add" size={26} color="#0095f6" />
                </View>
                <Text style={styles.uploadStoryText}>Upload Status</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Menu Popover Modal */}
        <Modal
          visible={showMenu}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowMenu(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowMenu(false)}>
            <View style={styles.modalBackdrop}>
              <View style={styles.popoverMenu}>
                {conversationId ? (
                  <TouchableOpacity
                    style={styles.popoverItem}
                    onPress={() => {
                      setShowMenu(false);
                      handleClearChat();
                    }}
                  >
                    <Icon name="trash-outline" size={20} color="#F44336" />
                    <Text style={[styles.popoverText, { color: '#F44336' }]}>Clear Chat</Text>
                  </TouchableOpacity>
                ) : null}
                {conversationId ? <View style={styles.popoverSeparator} /> : null}
                <TouchableOpacity
                  style={styles.popoverItem}
                  onPress={() => {
                    setShowMenu(false);
                    handleBlockUser();
                  }}
                >
                  <Icon name={isBlocked ? 'shield-checkmark-outline' : 'ban-outline'} size={20} color={isBlocked ? colors.primary : '#F44336'} />
                  <Text style={[styles.popoverText, isBlocked && { color: colors.primary }]}>
                    {isBlocked ? 'Unblock User' : 'Block User'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        <MediaPickerModal 
          visible={mediaPickerVisible} 
          onClose={() => setMediaPickerVisible(false)}
          onMediaSelected={handleMediaSelected}
        />

        <CustomGalleryPicker
          visible={statusGalleryVisible}
          onClose={() => setStatusGalleryVisible(false)}
          onSelect={handleStatusGallerySelect}
          maxSelect={1}
          assetType="All"
          maxDuration={61}
        />

        <CustomGalleryPicker
          visible={profileGalleryVisible}
          onClose={() => setProfileGalleryVisible(false)}
          onSelect={handleProfileGallerySelect}
          maxSelect={1}
          assetType="Photos"
        />
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
            style={styles.avatarWrapper120}
            disabled={isUploadingImage}
          >
            {hasStatus && (
              allSeen ? (
                <View style={styles.ringViewed120} />
              ) : (
                <LinearGradient
                  colors={['#ff4d6d', '#4597f5f6']}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientRing120}
                >
                  <View style={styles.gradientRingInner120} />
                </LinearGradient>
              )
            )}
            <AvatarWithFallback 
              uri={profile?.profile_picture} 
              displayName={formData.display_name || formData.username || 'User'} 
              sticker={profile?.avatar_sticker}
              style={styles.profilePicture} 
            />
            <TouchableOpacity style={styles.cameraIcon} onPress={() => setShowStickerModal(true)}>
              <Text style={styles.cameraIconText}><Icon name="camera" size={18} color="#000" /></Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        {!isUploadingImage && isReadOnly && (
          <TouchableOpacity 
            onPress={handleAvatarPress}
            onLongPress={handleAvatarLongPress}
            style={styles.avatarWrapper120}
          >
            {hasStatus && (
              allSeen ? (
                <View style={styles.ringViewed120} />
              ) : (
                <LinearGradient
                  colors={['#ff4d6d', '#4597f5f6']}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientRing120}
                >
                  <View style={styles.gradientRingInner120} />
                </LinearGradient>
              )
            )}
            <AvatarWithFallback 
              uri={profile?.profile_picture} 
              displayName={formData.display_name || formData.username || 'User'} 
              sticker={profile?.avatar_sticker}
              style={styles.profilePicture} 
            />
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
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Double-Tap Reaction</Text>
            <View style={styles.emojiSelectionRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {QUICK_REACTIONS.map(emoji => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.emojiSelectItem,
                      formData.quick_reaction === emoji && styles.emojiSelectItemActive,
                    ]}
                    onPress={() => setFormData({ ...formData, quick_reaction: emoji })}
                  >
                    <Text style={styles.emojiSelectText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <Text style={styles.hint}>Choose the emoji that appears when you double-tap a message.</Text>
          </View>
        )}

        {!isReadOnly && (
          <TouchableOpacity
            style={[
              styles.saveButton, 
              (isSaving || isUploadingImage || (usernameError || (!usernameEditable && formData.username !== profile?.username))) && styles.saveButtonDisabled
            ]}
            onPress={handleSave}
            disabled={isSaving || isUploadingImage || !!usernameError || (!usernameEditable && formData.username !== profile?.username)}
          >
            {isSaving ? <ActivityIndicator color={colors.textLight} /> : <Text style={styles.saveButtonText}>Update Changes</Text>}
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
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <AvatarWithFallback 
                  uri={profile?.profile_picture} 
                  displayName={profile?.display_name || profile?.username || user?.display_name || user?.username || 'User'} 
                  sticker={profile?.avatar_sticker}
                  style={{ width: 80, height: 80, borderRadius: 40 }} 
                />
                <Text style={{ fontSize: 12, color: '#666', marginTop: 6, fontFamily: 'Kalam-Regular' }}>Current Avatar</Text>
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

      <CustomGalleryPicker
        visible={profileGalleryVisible}
        onClose={() => setProfileGalleryVisible(false)}
        onSelect={handleProfileGallerySelect}
        maxSelect={1}
        assetType="Photos"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  profilePictureSection: { alignItems: 'center', paddingVertical: spacing.lg, backgroundColor: colors.surface },
  profilePictureContainer: { position: 'relative' },
  profilePicture: { width: 120, height: 120, borderRadius: 60 },
  avatarWrapper90: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  avatarWrapper120: {
    width: 130,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  gradientRing90: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientRingInner90: {
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: '#ffffff',
  },
  ringViewed90: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#ccc',
  },
  gradientRing120: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientRingInner120: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: '#ffffff',
  },
  ringViewed120: {
    position: 'absolute',
    width: 126,
    height: 126,
    borderRadius: 63,
    borderWidth: 2,
    borderColor: '#ccc',
  },
  profilePicturePlaceholder: { backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: colors.primaryLight },
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
  friendProfileHeader: { flexDirection: 'row', padding: 16, alignItems: 'center', backgroundColor: '#FFF' },
  friendAvatarContainer: { position: 'relative' },
  friendAvatar: { width: 90, height: 90, borderRadius: 45 },
  friendAvatarPlaceholder: { backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: colors.primary, borderRadius: 45, overflow: 'hidden' },
  friendAvatarText: { fontSize: 32, color: colors.primary, fontWeight: 'bold' },
  friendHeaderInfo: { flex: 1, marginLeft: 16 },
  friendName: { fontSize: 20, color: '#000', fontWeight: '600' },
  friendUsername: { fontSize: 16, fontWeight: '500', color: '#777' },
  friendBioText: { fontSize: 14, color: '#333', marginTop: 4 },
  friendsCountText: { fontSize: 14, color: '#4597f5f6', fontWeight: 'bold', marginTop: 4 },
  friendDetailsContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#FFF',
  },
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
    backgroundColor: '#FFFFFF',
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
  emojiSelectionRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.xs,
  },
  emojiSelectItem: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderRadius: 22,
  },
  emojiSelectItemActive: {
    backgroundColor: colors.primary + '20',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  emojiSelectText: {
    fontSize: 24,
  },
  profileButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    width: '100%',
  },
  profileActionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 5,
  },
  profileActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: '#0095f6',
  },
  primaryBtnText: {
    color: '#ffffff',
  },
  secondaryBtn: {
    backgroundColor: '#efefef',
    borderWidth: 1,
    borderColor: '#dbdbdb',
  },
  secondaryBtnText: {
    color: '#000000',
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-start', alignItems: 'flex-end' },
  popoverMenu: { position: 'absolute', top: 50, right: 16, width: 180, backgroundColor: '#fff', borderRadius: 8, padding: 8, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 1000 },
  popoverSeparator: { height: 1, backgroundColor: '#eee', marginVertical: 4 },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  popoverText: { fontSize: 14, color: '#333' },
  
  sharedAlbumSection: { padding: 16, backgroundColor: '#FFF', flex: 1 },
  sharedAlbumTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  emptySharedMedia: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptySharedMediaText: { fontSize: 14, color: '#999', marginTop: 8 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridImageWrapper: { margin: 1, width: (Dimensions.get('window').width - 32 - 6) / 3, height: (Dimensions.get('window').width - 32 - 6) / 3 },
  gridImage: { width: '100%', height: '100%', borderRadius: 4 },
  albumTabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 12 },
  albumTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent', gap: 4 },
  activeAlbumTab: { borderBottomColor: colors.primary },
  albumTabText: { fontSize: 11, color: '#888' },
  activeAlbumTabText: { color: colors.primary, fontWeight: '600' },
  mediaPlaceholder: { flex: 1, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', borderRadius: 4 },
  videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 4 },
  playIcon: { position: 'absolute', zIndex: 1 },
  mediaListContainer: { paddingVertical: 4 },
  mediaListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  listIconContainer: { width: 36, height: 36, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  audioIconBg: { backgroundColor: colors.primary },
  docIconBg: { backgroundColor: '#FF9800' },
  listTextContainer: { flex: 1 },
  listFileName: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  listDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  horizontalScrollContent: {
    paddingVertical: 8,
    gap: 8,
  },
  horizontalImageWrapper: {
    width: (Dimensions.get('window').width - 32 - 16) / 3,
    height: (Dimensions.get('window').width - 32 - 16) / 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  horizontalImage: {
    width: '100%',
    height: '100%',
  },
  horizontalUploadCard: {
    width: (Dimensions.get('window').width - 32 - 16) / 3,
    height: (Dimensions.get('window').width - 32 - 16) / 3,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  horizontalPlusCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E6F4FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  horizontalUploadText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#0095f6',
    textAlign: 'center',
  },
  uploadStorySection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: '#FFFFFF',
  },
  uploadStoryCard: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  plusIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E6F4FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  uploadStoryText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#0095f6',
  },
});
