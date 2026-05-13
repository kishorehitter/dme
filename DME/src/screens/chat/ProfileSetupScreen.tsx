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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker'; // Import for image picking
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming this is used for tokens
// import Toast from 'react-native-toast-message'; // Assuming this is used for notifications (commented out as not used in current scope)
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { authAPI } from '../../services/api'; // Assuming this has the checkUsername and completeProfileSetup functions

// --- Start: Removed compressImage helper. ---
// --- Revised pickImage to prepare image info (base64 URL, name, type) directly ---
// --- for FormData, avoiding fetch/blob/File conversion. ---

export const ProfileSetupScreen: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const navigation = useNavigation(); // Add this
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState('');
  const [avatarSticker, setAvatarSticker] = useState(''); // Initially empty
  // State to hold image info (base64 URL, name, type) for FormData upload
  const [selectedImageInfo, setSelectedImageInfo] = useState<{ uri: string, name: string, type: string } | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null); // State for image preview
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [showStickerModal, setShowStickerModal] = useState(false); // State for sticker modal
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male'); // For sticker selection


  const checkUsername = async (value: string) => {
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

  const pickImage = async () => {
    setShowStickerModal(false); // Close sticker modal first
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.7, 
        includeBase64: true, // Crucial: get base64 data
      });

      if (result.didCancel) {
        return;
      }

      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick image');
        return;
      }

      const asset = result.assets?.[0];
      // Ensure base64 data and asset type are available
      if (asset?.base64 && asset.type) {
        const fileType = asset.type || 'image/jpeg';
        const fileName = asset.fileName || 'profile.jpg';
        
        // Construct the base64 data URL
        const base64DataUrl = `data:${fileType};base64,${asset.base64}`;
        
        // Store the image info object { uri: base64DataUrl, name, type }
        setSelectedImageInfo({ uri: base64DataUrl, name: fileName, type: fileType });
        // Use asset.uri for preview if available, otherwise fallback to data URL
        setImagePreviewUrl(asset.uri || base64DataUrl); 
        setAvatarSticker(''); // Clear sticker if an image is selected
      } else if (asset?.uri) {
        // Fallback if base64 is not available but URI is. This might not work for upload.
        console.warn("Base64 data not available for picked image, image upload might fail.");
        Alert.alert("Image Error", "Could not process image data. Please try again.");
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const selectSticker = (sticker: string) => {
    setAvatarSticker(sticker);
    setSelectedImageInfo(null); // Clear image info if a sticker is selected
    setImagePreviewUrl(null); // Clear image preview
    setShowStickerModal(false);
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
      formData.append('avatar_sticker', avatarSticker); // Send sticker or empty string

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

      // Make the API call using authAPI.
      // ProfileSetupView is an UpdateAPIView, so PATCH is the correct method.
      const data = await authAPI.completeProfileSetup(formData);

      // Assuming the API returns updated user data upon success.
      await refreshUser();
      console.log('User after refresh:', user); // Add this line to debug
      
      // Redirect handled by AppNavigator observing AuthContext state change
    } catch (error: any) {
      console.error('Profile setup error:', error);
      Alert.alert('Error', error.response?.data?.detail || error.message || 'Failed to set up profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sticker modal rendering (re-used from ProfileScreen)
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

  // Define stickers if they are not imported from ProfileScreen
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


  return (
    <View style={styles.container}>
      <Text style={styles.title}>Complete your profile</Text>
      
      {/* Profile Picture / Sticker Selection Area */}
      <View style={styles.profilePictureContainer}>
        {isSubmitting ? (
          <View style={[styles.previewImage, styles.previewPlaceholder, styles.uploadingContainer]}>
            <ActivityIndicator size="large" color="#8100D1" />
          </View>
        ) : imagePreviewUrl ? (
          <Image source={{ uri: imagePreviewUrl }} style={styles.previewImage} />
        ) : avatarSticker ? (
          <View style={[styles.previewImage, styles.previewPlaceholder]}>
            <Text style={styles.stickerAvatar}>{avatarSticker}</Text>
          </View>
        ) : (
          <View style={[styles.previewImage, styles.previewPlaceholder]}>
            <Text style={styles.profilePictureText}>
              {(displayName || username || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.cameraIcon} onPress={() => setShowStickerModal(true)}>
          <Text style={styles.cameraIconText}>📷</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.changePhotoText}>Tap to change photo or sticker</Text>

      <TextInput
        style={styles.input}
        placeholder="Choose unique username"
        value={username}
        onChangeText={(text) => {
          const lowerText = text.toLowerCase();
          setUsername(lowerText);
          checkUsername(lowerText);
        }}
        autoCapitalize="none"
      />
      {isChecking && <ActivityIndicator size="small" />}
      {isAvailable === false && <Text style={styles.errorText}>Username taken</Text>}
      {isAvailable === true && <Text style={styles.successText}>Username available</Text>}

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

      {/* Sticker Selection Modal */}
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
              onPress={pickImage} // Call pickImage when this button is pressed
            >
              <Text style={styles.uploadImageButtonText}>
                📸 Upload Photo Instead
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#FFF' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  input: { borderBottomWidth: 1, borderColor: '#DDD', marginBottom: 16, padding: 8, fontSize: 16 },
  nextButton: { backgroundColor: '#8100D1', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 24 },
  nextButtonDisabled: { backgroundColor: '#B080D1'},
  nextButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 18 },
  errorText: { color: 'red', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  successText: { color: 'green', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  
  // Profile Picture / Sticker Styles
  profilePictureContainer: {
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#B080D1',
  },
  previewPlaceholder: {
    backgroundColor: '#8100D1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePictureText: {
    fontSize: 48,
    color: '#FFF',
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
    bottom: 0,
    right: -10, // Adjust position as needed
    backgroundColor: '#8100D1',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  cameraIconText: {
    fontSize: 18,
  },
  changePhotoText: {
    color: '#8100D1',
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
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
    backgroundColor: '#8100D1',
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
    borderColor: '#8100D1',
    borderRadius: 8,
  },
  uploadImageButtonText: {
    fontSize: 16,
    color: '#8100D1',
    fontWeight: '600',
  },
});
