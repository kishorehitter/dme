import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  FlatList,
  ScrollView,
  StatusBar,
  NativeModules,
  Platform,
} from 'react-native';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import LinearGradient from 'react-native-linear-gradient';
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

import AvatarWithFallback, { getAvatarGradient } from '../../components/AvatarWithFallback';
import AvatarPickerModal from '../../components/AvatarPickerModal';
import { QuickReactionPicker } from '../../components/QuickReactionPicker';
import LegalModal, { LegalTabType } from '../../components/LegalModal';
import { ALL_PRESET_AVATARS, PRESET_AVATARS } from '../../utils/presetAvatars';
// import Toast from 'react-native-toast-message'; // Assuming this is used for notifications (commented out as not used in current scope)
import { useAuth } from '../../context/AuthContext';
import { saveLocalAvatar } from '../../utils/avatarCache';
import { useTheme } from '../../context/ThemeContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { authAPI } from '../../services/api'; // Assuming this has the checkUsername and completeProfileSetup functions

// --- Start: Removed compressImage helper. ---
// --- Revised pickImage to prepare image info (base64 URL, name, type) directly ---
// --- for FormData, avoiding fetch/blob/File conversion. ---

const QUICK_REACTIONS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', 
  '😂', '😍', '😮', '😢', '😡', '👍', '👎', '🎉', '🔥', '✨', '💯', '🙏', '👏', '😎', '🤔'
];

const AVATAR_COLORS = [
  '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', 
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50', 
  '#8BC34A', '#FF9800', '#FF5722', '#795548', '#607D8B'
];

const getAvatarColor = (name: string) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export const ProfileSetupScreen: React.FC = () => {
  const { user, completeProfileSetup } = useAuth();
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme, isDark), [theme, isDark]);
  const navigation = useNavigation(); // Add this
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState('');

  const nameToHash = displayName.trim() || username.trim() || 'User';

  const gradientColors = getAvatarGradient(nameToHash);
  const [quickReaction, setQuickReaction] = useState('❤️');
  // State to hold image info (base64 URL, name, type) for FormData upload
  const [selectedImageInfo, setSelectedImageInfo] = useState<{ uri: string, name: string, type: string } | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null); // State for image preview
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [galleryPickerVisible, setGalleryPickerVisible] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const currentStickerImage = selectedSticker && PRESET_AVATARS[selectedSticker]
    ? PRESET_AVATARS[selectedSticker]
    : ALL_PRESET_AVATARS[0]?.image;

  const handleSelectAvatar = (stickerId: string) => {
    setSelectedSticker(stickerId);
    setImagePreviewUrl(null);
    setSelectedImageInfo(null);
    AsyncStorage.removeItem('pending_google_photo').catch(() => {});
  };
  const [focusedField, setFocusedField] = useState<'username' | 'displayName' | 'bio' | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTabType>('privacy');

  const openLegalModal = (tab: LegalTabType) => {
    setLegalModalTab(tab);
    setLegalModalVisible(true);
  };

  useEffect(() => {
    let isMounted = true;
    const loadGooglePhoto = async () => {
      try {
        const googlePhoto = await AsyncStorage.getItem('pending_google_photo');
        if (googlePhoto && isMounted) {
          // 1. Immediately show Google avatar preview in UI
          setImagePreviewUrl(googlePhoto);

          // 2. Download the Google image file to cache so it can be uploaded via FormData on submit
          const localFilePath = `${RNFS.CachesDirectoryPath}/google_avatar_${Date.now()}.jpg`;
          const result = await RNFS.downloadFile({
            fromUrl: googlePhoto,
            toFile: localFilePath,
          }).promise;

          if (result.statusCode === 200 && isMounted) {
            const fileUri = Platform.OS === 'android' ? `file://${localFilePath}` : localFilePath;
            setSelectedImageInfo({
              uri: fileUri,
              name: 'google_avatar.jpg',
              type: 'image/jpeg',
            });
            setImagePreviewUrl(fileUri);
          }
        }
      } catch (err) {
        console.error('[ProfileSetup] Error pre-filling Google photo:', err);
      }
    };
    loadGooglePhoto();
    return () => {
      isMounted = false;
    };
  }, []);


  const checkUsername = async (value: string) => {
    // Character validation: alphanumeric and underscores only
    const regex = /^[a-zA-Z0-9_]*$/;
    if (value.length > 0 && !regex.test(value)) {
      setUsernameError('Invalid characters');
      setIsAvailable(null);
      setIsChecking(false);
      return;
    }
    
    setUsernameError(null);

    if (value.length < 3) {
      setIsAvailable(null);
      return;
    }
    
    setIsChecking(true);
    try {
      // Use the authAPI to check username availability
      await authAPI.checkUsername(value);
      setIsAvailable(true);
    } catch (error: any) {
      // Assuming error.response.status === 400 or similar indicates not available
      setIsAvailable(false); 
    } finally {
      setIsChecking(false);
    }
  };

  const handleGallerySelect = (assets: GalleryAsset[]) => {
    if (assets && assets.length > 0) {
      const asset = assets[0];
      const fileType = asset.type || 'image/jpeg';
      const fileName = asset.fileName || 'profile.jpg';
      
      setSelectedImageInfo({ uri: asset.uri, name: fileName, type: fileType });
      setImagePreviewUrl(asset.uri);
      setSelectedSticker(null);
    }
    setGalleryPickerVisible(false);
  };



  const handleCompleteSetup = async () => {
    if (!username || isAvailable === false) {
      Alert.alert('Error', 'Please choose a valid unique username');
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await AsyncStorage.getItem('access_token');

      // Prepare data for the API call using FormData
      const formData = new FormData();
      formData.append('username', username);
      formData.append('display_name', displayName);
      formData.append('bio', bio);
      formData.append('quick_reaction', quickReaction);
      formData.append('avatar_sticker', selectedSticker || '');

      // Append profile_picture if image info is available
      if (selectedImageInfo) {
        if (user?.id) {
          saveLocalAvatar(user.id, selectedImageInfo.uri).catch(() => {});
        }
        // Append the image info object directly. FormData in React Native often handles this structure.
        // This mirrors the successful approach from ProfileScreen.tsx for uploads.
        formData.append('profile_picture', {
          uri: selectedImageInfo.uri, // This is the base64 data URL
          type: selectedImageInfo.type,
          name: selectedImageInfo.name,
        } as any); // 'as any' to bypass potential type checking issues for the object structure
      }

      // Make the API call using AuthContext completeProfileSetup
      await completeProfileSetup(formData);
      await AsyncStorage.removeItem('pending_google_photo').catch(() => {});
    } catch (error: any) {
      console.error('Profile setup error:', error);
      Alert.alert('Error', error.response?.data?.detail || error.message || 'Failed to set up profile');
    } finally {
      setIsSubmitting(false);
    }
  };



  return (
    <ScrollView 
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        s.container, 
        { 
          paddingTop: insets.top > 0 ? insets.top + 16 : 24, 
          paddingBottom: (insets.bottom > 0 ? insets.bottom : 24) + 20 
        }
      ]}
    >
      <Text style={s.title}>Complete your profile</Text>
      
      {/* Profile Picture / 3D Avatar Area (Matches ProfileScreen edit mode exactly) */}
      <View style={s.avatarEditRow}>
        {/* Avatar Circle with Camera Badge */}
        <View style={s.avatarWrapper120}>
          <TouchableOpacity
            onPress={() => setGalleryPickerVisible(true)}
            activeOpacity={0.88}
            style={StyleSheet.absoluteFillObject}
          >
            {isSubmitting ? (
              <View style={[s.profilePicture, s.previewPlaceholder, s.uploadingContainer]}>
                <ActivityIndicator size="large" color={theme.textMuted} />
              </View>
            ) : (
              <AvatarWithFallback
                uri={imagePreviewUrl}
                displayName={displayName || username || 'User'}
                sticker={selectedSticker}
                style={[s.profilePicture, { borderWidth: 0 }]}
                initialSize={52}
              />
            )}
            <TouchableOpacity
              style={s.cameraIcon}
              onPress={() => setGalleryPickerVisible(true)}
              activeOpacity={0.8}
            >
              <Icon name="camera" size={17} color="#000000" />
            </TouchableOpacity>
          </TouchableOpacity>
        </View>

        {/* Dedicated 3D Avatar Button next to Profile Circle */}
        <TouchableOpacity
          style={s.avatarStickerButton}
          onPress={() => setAvatarModalVisible(true)}
          activeOpacity={0.78}
        >
          <LinearGradient
            colors={['#FFF', '#3B82F6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.avatarStickerIconWrap}
          >
            <MaterialIcon name="face-retouching-natural" size={32} color="#000" />
          </LinearGradient>
          <View style={s.avatarStickerTextCol}>
            <Text style={s.avatarStickerTitle} numberOfLines={1}>3D Avatar</Text>
            <Text style={s.avatarStickerSub} numberOfLines={1}>
              {selectedSticker ? 'Change 3D' : 'Choose 3D'}
            </Text>
          </View>
          <View style={s.avatarStickerArrowWrap}>
            <Icon name="chevron-forward" size={15} color={theme.primary} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={s.inputGroup}>
        <Text style={s.inputLabel}>Username</Text>
        <View style={[
          s.inputWrapper,
          focusedField === 'username' && s.inputWrapperFocused,
          usernameError ? s.inputWrapperError : (isAvailable === true && s.inputWrapperSuccess)
        ]}>
          <Icon name="at" size={20} color={focusedField === 'username' ? theme.primary : theme.textSecondary} style={s.inputIcon} />
          <TextInput
            style={s.textInput}
            placeholder="Enter Unique Username"
            placeholderTextColor={theme.placeholder}
            value={username}
            onChangeText={(text) => {
              const lowerText = text.toLowerCase().trim();
              setUsername(lowerText);
              
              // Immediate character validation
              const regex = /^[a-zA-Z0-9_]*$/;
              if (lowerText.length > 0 && !regex.test(lowerText)) {
                setUsernameError('Only letters, numbers, and underscores allowed');
                setIsAvailable(null);
              } else {
                setUsernameError(null);
                checkUsername(lowerText);
              }
            }}
            onFocus={() => setFocusedField('username')}
            onBlur={() => setFocusedField(null)}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {isChecking && <ActivityIndicator size="small" color={theme.primary} />}
        </View>
        <View style={s.helperTextContainer}>
          {usernameError ? (
            <Text style={s.errorText}>{usernameError}</Text>
          ) : (
            <>
              {isAvailable === false && <Text style={s.errorText}>Username is already taken</Text>}
              {isAvailable === true && <Text style={s.successText}>Username is available</Text>}
              {isAvailable === null && !isChecking && (
                <Text style={s.helperText}>Must be at least 3 characters</Text>
              )}
            </>
          )}
        </View>
      </View>

      <View style={s.inputGroup}>
        <Text style={s.inputLabel}>Display Name</Text>
        <View style={[
          s.inputWrapper,
          focusedField === 'displayName' && s.inputWrapperFocused
        ]}>
          <Icon name="person-outline" size={20} color={focusedField === 'displayName' ? theme.primary : theme.textSecondary} style={s.inputIcon} />
          <TextInput
            style={s.textInput}
            placeholder="Display Name (e.g. John Doe)"
            placeholderTextColor={theme.placeholder}
            value={displayName}
            onChangeText={setDisplayName}
            onFocus={() => setFocusedField('displayName')}
            onBlur={() => setFocusedField(null)}
          />
        </View>
      </View>

      <View style={s.inputGroup}>
        <Text style={[s.inputLabel, { marginTop: 18 }]}>Bio (Optional)</Text>
        <View style={[
          s.inputWrapper,
          focusedField === 'bio' && s.inputWrapperFocused,
          { minHeight: 80, alignItems: 'flex-start' }
        ]}>
          <Icon name="create-outline" size={20} color={focusedField === 'bio' ? theme.primary : theme.textSecondary} style={[s.inputIcon, { marginTop: 12 }]} />
          <TextInput
            style={[s.textInput, { minHeight: 60, textAlignVertical: 'top' }]}
            placeholder="Tell us something about yourself..."
            placeholderTextColor={theme.placeholder}
            value={bio}
            onChangeText={setBio}
            multiline
            onFocus={() => setFocusedField('bio')}
            onBlur={() => setFocusedField(null)}
          />
        </View>
      </View>

      <View style={s.reactionSection}>
        <Text style={s.sectionLabel}>Double-Tap Reaction</Text>
        <View style={s.reactionContainer}>
          <QuickReactionPicker
            selectedEmoji={quickReaction}
            onSelectEmoji={setQuickReaction}
          />
        </View>
      </View>

      <View style={s.checkboxRow}>
        <TouchableOpacity 
          onPress={() => setAgreed(!agreed)}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon 
            name={agreed ? "checkbox" : "square-outline"} 
            size={22} 
            color={agreed ? theme.primary : theme.textSecondary} 
            style={{ marginRight: 10 }}
          />
        </TouchableOpacity>
        <Text style={s.checkboxLabel}>
          I agree to the{' '}
          <Text 
            style={s.linkText}
            onPress={() => openLegalModal('terms')}
          >
            Terms of Service
          </Text>
          {' '}and{' '}
          <Text 
            style={s.linkText}
            onPress={() => openLegalModal('privacy')}
          >
            Privacy Policy
          </Text>
        </Text>
      </View>

      <TouchableOpacity
        style={[
          s.nextButton,
          (isSubmitting || isAvailable !== true || !username || !agreed) && s.nextButtonDisabled
        ]}
        onPress={handleCompleteSetup}
        disabled={isSubmitting || isAvailable !== true || !username || !agreed}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={s.nextButtonText}>Start Chatting</Text>
        )}
      </TouchableOpacity>
      <CustomGalleryPicker
        visible={galleryPickerVisible}
        onClose={() => setGalleryPickerVisible(false)}
        onSelect={handleGallerySelect}
        maxSelect={1}
        assetType="Photos"
      />
      <AvatarPickerModal
        visible={avatarModalVisible}
        onClose={() => setAvatarModalVisible(false)}
        onSelect={handleSelectAvatar}
        currentSticker={selectedSticker}
        profilePicture={imagePreviewUrl}
        displayName={displayName || username || 'User'}
      />
      <LegalModal
        visible={legalModalVisible}
        initialTab={legalModalTab}
        onClose={() => setLegalModalVisible(false)}
      />
    </ScrollView>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors, isDark = false) => StyleSheet.create({
  container: { 
    paddingHorizontal: 24, 
    paddingTop: 24, 
    paddingBottom: 24, 
    backgroundColor: theme.background 
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 12, textAlign: 'center', color: theme.textPrimary },
  inputGroup: {
    marginBottom: 0,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: theme.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.inputBackground,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  inputWrapperFocused: {
    borderColor: theme.primary,
    backgroundColor: theme.background,
  },
  inputWrapperError: {
    borderColor: '#EF4444',
  },
  inputWrapperSuccess: {
    borderColor: '#10B981',
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: theme.textPrimary,
    paddingVertical: 10,
    fontWeight: 600,
  },
  helperTextContainer: {
    marginTop: 4,
    minHeight: 18,
    marginBottom:6,
    alignItems: 'flex-end',
  },
  helperText: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
    paddingHorizontal: 4,
  },
  checkboxLabel: {
    fontSize: 14,
    color: theme.textSecondary,
    flex: 1,
  },
  linkText: {
    color: theme.primary,
    fontWeight: '600',
  },
  nextButton: { backgroundColor: theme.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  nextButtonDisabled: { backgroundColor: theme.border },
  nextButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  errorText: { color: '#EF4444', fontSize: 12, fontWeight: '500' },
  successText: { color: '#10B981', fontSize: 12, fontWeight: '500' },
  

  avatarEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: 16,
    gap: 16,
    width: '100%',
    marginBottom: 8,
  },
  avatarWrapper120: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  profilePicture: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#FFFFFF',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.surface,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  avatarStickerButton: {
    flex: 1,
    maxWidth: 205,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarStickerIconWrap: {
    position: 'relative',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarStickerPreviewImg: {
    width: 40,
    height: 40,
  },
  avatarStickerSparkleBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#0F62FE',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  avatarStickerTextCol: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  avatarStickerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.2,
  },
  avatarStickerSub: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.primary,
    marginTop: 2,
  },
  avatarStickerArrowWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 2,
  },

  // Profile Picture / Sticker Styles
  profilePictureContainer: {
    alignItems: 'center',
    marginBottom: 12,
    alignSelf: 'center',
  },
  avatarWrapper: {
    width: 120,
    height: 120,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  removePhotoButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#EF4444',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 6,
    zIndex: 10,
  },
  previewPlaceholder: {
    backgroundColor: theme.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePictureText: {
    fontSize: 48,
    color: theme.primary,
    fontWeight: 'bold',
  },
  stickerAvatar: {
    fontSize: 72,
  },
  uploadingContainer: {
    backgroundColor: theme.background,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  sideActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  cameraIconText: {
    fontSize: 18,
  },
  changePhotoText: {
    color: theme.primary,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.modalBackground || theme.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  modalClose: {
    fontSize: 24,
    color: theme.textSecondary,
  },
  stickerOptions: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  genderTab: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    backgroundColor: theme.inputBackground,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  genderTabActive: {
    backgroundColor: theme.primary,
  },
  genderTabText: {
    fontSize: 16,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  genderTabTextActive: {
    color: '#FFF',
  },
  stickerGrid: {
    paddingHorizontal: 4,
  },
  stickerItem: {
    flex: 1/3, // Makes it occupy 1/3 of the row width
    aspectRatio: 1, // Keeps it square
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
    backgroundColor: theme.inputBackground,
    borderRadius: 8,
    padding: 8,
  },
  stickerEmoji: {
    fontSize: 48,
  },
  stickerLabel: {
    fontSize: 10,
    color: theme.textSecondary,
    marginTop: 4,
  },
  uploadImageButton: {
    marginTop: 24,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 8,
  },
  uploadImageButtonText: {
    fontSize: 16,
    color: theme.primary,
    fontWeight: '600',
  },
  reactionSection: {
    marginVertical: 16,
  },
  reactionContainer: {
    width: '100%',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  reactionScroll: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  reactionItem: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    borderRadius: 22,
    overflow: 'visible',
  },
  reactionItemActive: {
    transform: [{ scale: 1.15 }],
  },
  reactionCheckBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionText: {
    fontSize: 24,
  },
});
