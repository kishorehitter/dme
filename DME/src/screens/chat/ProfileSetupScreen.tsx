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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { CustomGalleryPicker, GalleryAsset } from '../../components/CustomGalleryPicker';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming this is used for tokens
// import Toast from 'react-native-toast-message'; // Assuming this is used for notifications (commented out as not used in current scope)
import { useAuth } from '../../context/AuthContext';
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
      style={{ backgroundColor: '#FFF' }}
      contentContainerStyle={[
        styles.container, 
        { 
          paddingTop: insets.top > 0 ? insets.top + 16 : 24, 
          paddingBottom: (insets.bottom > 0 ? insets.bottom : 24) + 20 
        }
      ]}
    >
      <Text style={styles.title}>Complete your profile</Text>
      
      {/* Profile Picture / Sticker Selection Area */}
      <View style={styles.profilePictureContainer}>
        {isSubmitting ? (
          <View style={[styles.previewImage, styles.previewPlaceholder, styles.uploadingContainer]}>
            <ActivityIndicator size="large" color="#555555" />
          </View>
        ) : imagePreviewUrl ? (
          <Image source={{ uri: imagePreviewUrl }} style={styles.previewImage} />
        ) : (
          <View style={[
            styles.previewImage, 
            styles.previewPlaceholder, 
            { backgroundColor: avatarBgColor }
          ]}>
            <Text style={[styles.profilePictureText, { color: '#FFFFFF' }]}>
              {(displayName || username || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.cameraIcon} onPress={() => setGalleryPickerVisible(true)}>
          <Icon name="camera" size={18} color="#000" />
        </TouchableOpacity>
      </View>
      <Text style={styles.changePhotoText}>Tap to change photo</Text>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.inputWithValidation}
          placeholder="Choose unique username"
          value={username}
          onChangeText={(text) => {
            const lowerText = text.toLowerCase();
            setUsername(lowerText);
            
            // Immediate character validation
            const regex = /^[a-zA-Z0-9_]*$/;
            if (lowerText.length > 0 && !regex.test(lowerText)) {
              setUsernameError('Invalid characters');
              setIsAvailable(null);
            } else {
              setUsernameError(null);
              checkUsername(lowerText);
            }
          }}
          autoCapitalize="none"
        />
        <View style={styles.validationFeedback}>
          {isChecking && <ActivityIndicator size="small" />}
          {usernameError ? (
            <Text style={styles.errorText}>{usernameError}</Text>
          ) : (
            <>
              {isAvailable === false && <Text style={styles.errorText}>Taken</Text>}
              {isAvailable === true && <Text style={styles.successText}>Available</Text>}
            </>
          )}
        </View>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Display Name (e.g. John Doe)"
        value={displayName}
        onChangeText={setDisplayName}
      />

      <TextInput
        style={styles.input}
        placeholder="Bio (optional)"
        value={bio}
        onChangeText={setBio}
        multiline
      />

      <View style={styles.reactionSection}>
        <Text style={styles.sectionLabel}>Double-Tap Reaction</Text>
        <View style={styles.reactionContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reactionScroll}>
            {QUICK_REACTIONS.map(emoji => (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.reactionItem,
                  quickReaction === emoji && styles.reactionItemActive,
                ]}
                onPress={() => setQuickReaction(emoji)}
              >
                <Text style={styles.reactionText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.hint}>Choose your default double-tap reaction</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.nextButton,
          (isSubmitting || isAvailable !== true || !username) && styles.nextButtonDisabled
        ]}
        onPress={handleCompleteSetup}
        disabled={isSubmitting || isAvailable !== true || !username}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.nextButtonText}>Start Chatting</Text>
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

const styles = StyleSheet.create({
  container: { 
    paddingHorizontal: 24, 
    paddingTop: 24, 
    paddingBottom: 24, 
    backgroundColor: '#FFF' 
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  input: { borderBottomWidth: 1, borderColor: '#DDD', marginBottom: 16, padding: 8, fontSize: 16 },
  nextButton: { backgroundColor: '#4597f5f6', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 24 },
  nextButtonDisabled: { backgroundColor: '#A2C2F8'},
  nextButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 18 },
  errorText: { color: 'red', fontSize: 12 },
  successText: { color: 'green', fontSize: 12 },
  
  // Profile Picture / Sticker Styles
  profilePictureContainer: {
    alignItems: 'center',
    marginBottom: 16,
    width: 120,
    alignSelf: 'center',
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#4597f5f6',
  },
  previewPlaceholder: {
    backgroundColor: '#EBF3FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePictureText: {
    fontSize: 48,
    color: '#4597f5f6',
    fontWeight: 'bold',
  },
  stickerAvatar: {
    fontSize: 72,
  },
  uploadingContainer: {
    backgroundColor: '#FFF',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 8,
    right: 5,
    backgroundColor: '#FFF',
    width: 30,
    height: 30,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4597f5f6',
  },
  cameraIconText: {
    fontSize: 18,
  },
  changePhotoText: {
    color: '#4597f5f6',
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#DDD',
  },
  inputWithValidation: {
    flex: 1,
    padding: 8,
    fontSize: 16,
  },
  validationFeedback: {
    paddingRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
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
  },
  modalClose: {
    fontSize: 24,
    color: '#666',
  },
  stickerOptions: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  genderTab: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#EEE',
    marginHorizontal: 4,
    borderRadius: 8,
  },
  genderTabActive: {
    backgroundColor: '#4597f5f6',
  },
  genderTabText: {
    fontSize: 16,
    color: '#666',
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
    backgroundColor: '#EEE',
    borderRadius: 8,
    padding: 8,
  },
  stickerEmoji: {
    fontSize: 48,
  },
  stickerLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  uploadImageButton: {
    marginTop: 24,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4597f5f6',
    borderRadius: 8,
  },
  uploadImageButtonText: {
    fontSize: 16,
    color: '#4597f5f6',
    fontWeight: '600',
  },
  reactionSection: {
    marginVertical: 16,
  },
  reactionContainer: {
    borderWidth: 1,
    borderColor: '#EAEAEA',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FAFAFA',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  reactionScroll: {
    paddingVertical: 4,
  },
  reactionItem: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderRadius: 22,
    backgroundColor: '#F5F5F5',
  },
  reactionItemActive: {
    backgroundColor: '#EBF3FE',
    borderWidth: 1,
    borderColor: '#4597f5f6',
  },
  reactionText: {
    fontSize: 24,
  },
  hint: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
});
