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
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming this is used for tokens
// import Toast from 'react-native-toast-message'; // Assuming this is used for notifications (commented out as not used in current scope)
import { useAuth } from '../../context/AuthContext';
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
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
  const navigation = useNavigation(); // Add this
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState('');

  const nameToHash = displayName.trim() || username.trim() || 'User';
  const avatarBgColor = getAvatarColor(nameToHash);
  const [quickReaction, setQuickReaction] = useState('❤️');
  // State to hold image info (base64 URL, name, type) for FormData upload
  const [selectedImageInfo, setSelectedImageInfo] = useState<{ uri: string, name: string, type: string } | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null); // State for image preview
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [galleryPickerVisible, setGalleryPickerVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<'username' | 'displayName' | 'bio' | null>(null);
  const [agreed, setAgreed] = useState(false);


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
      formData.append('avatar_sticker', ''); // Send empty string

      // Append profile_picture if image info is available
      if (selectedImageInfo) {
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
      
      {/* Profile Picture / Sticker Selection Area */}
      <View style={s.profilePictureContainer}>
        {isSubmitting ? (
          <View style={[s.previewImage, s.previewPlaceholder, s.uploadingContainer]}>
            <ActivityIndicator size="large" color={theme.textMuted} />
          </View>
        ) : imagePreviewUrl ? (
          <Image source={{ uri: imagePreviewUrl }} style={s.previewImage} />
        ) : (
          <View style={[
            s.previewImage, 
            s.previewPlaceholder, 
            { backgroundColor: avatarBgColor }
          ]}>
            <Text style={[s.profilePictureText, { color: '#FFFFFF' }]}>
              {(displayName || username || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <TouchableOpacity style={s.cameraIcon} onPress={() => setGalleryPickerVisible(true)}>
          <Icon name="camera" size={18} color={theme.icon} />
        </TouchableOpacity>
      </View>
      <Text style={s.changePhotoText}>Tap to choose Profile Picture</Text>

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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reactionScroll}>
            {QUICK_REACTIONS.map(emoji => (
              <TouchableOpacity
                key={emoji}
                style={[
                  s.reactionItem,
                  quickReaction === emoji && s.reactionItemActive,
                ]}
                onPress={() => setQuickReaction(emoji)}
              >
                <Text style={s.reactionText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      <TouchableOpacity 
        style={s.checkboxRow} 
        onPress={() => setAgreed(!agreed)}
        activeOpacity={0.8}
      >
        <Icon 
          name={agreed ? "checkbox" : "square-outline"} 
          size={22} 
          color={agreed ? theme.primary : theme.textSecondary} 
          style={{ marginRight: 10 }}
        />
        <Text style={s.checkboxLabel}>
          I agree to the <Text style={s.linkText}>Terms of Service</Text> and <Text style={s.linkText}>Privacy Policy</Text>
        </Text>
      </TouchableOpacity>

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
    </ScrollView>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
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
  
  // Profile Picture / Sticker Styles
  profilePictureContainer: {
    alignItems: 'center',
    marginBottom: 10,
    width: 120,
    alignSelf: 'center',
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: theme.border,
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
  cameraIcon: {
    position: 'absolute',
    bottom: 8,
    right: 5,
    backgroundColor: theme.background,
    width: 30,
    height: 30,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.border,
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
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical:6,
    backgroundColor: theme.inputBackground,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  reactionScroll: {
    paddingVertical: 4,
  },
  reactionItem: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderRadius: 18,
    backgroundColor: theme.inputBackground,
  },
  reactionItemActive: {
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  reactionText: {
    fontSize: 22,
  },
});
