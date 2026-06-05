import React, { useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Image,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  NativeModules,
  Dimensions,
  Keyboard,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import api from '../services/api';
import { StatusService } from '../services/StatusService';
import { VisibilityModal } from '../components/VisibilityModal';

const { width, height } = Dimensions.get('window');
const MAX_VIDEO_SECONDS = 30;

// ... (compressAndTrimVideo function) ...
async function compressAndTrimVideo(uri: string): Promise<string> {
  try {
    const RNFS = require('react-native-fs');
    const { FFmpegKit, ReturnCode } = await import('ffmpeg-kit-react-native');
    const cleanPath = uri.replace('file://', '');
    const outPath    = `${RNFS.CachesDirectoryPath}/status_${Date.now()}.mp4`;
    const cmd = `-i "${uri}" -t ${MAX_VIDEO_SECONDS} -vcodec libx264 -crf 28 -preset ultrafast -acodec aac -b:a 96k "${outPath}" -y`;
    const session = await FFmpegKit.execute(cmd);
    const code = await session.getReturnCode();
    return ReturnCode.isSuccess(code) ? `file://${outPath}` : uri;
  } catch { return uri; }
}

interface RouteParams {
  mediaUri?: string;
  mediaType?: 'photo' | 'video';
  source?: 'camera' | 'gallery';
}

const StatusEditorScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const params = (route.params as RouteParams) ?? {};

  const [mediaUri, setMediaUri] = useState<string | null>(params.mediaUri ?? null);
  const [mediaType, setMediaType] = useState<'photo' | 'video'>(params.mediaType ?? 'photo');
  const [source, setSource] = useState<'camera' | 'gallery'>(params.source ?? 'gallery');
  const [caption, setCaption] = useState('');
  const [restrictedTo, setRestrictedTo] = useState<number[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  // Gesture state
  const translationX = useSharedValue((width / 2) - 50); // Center on X
  const translationY = useSharedValue(height - 250); // Set to near bottom of screen
  const baseTranslationX = useSharedValue((width / 2) - 50);
  const baseTranslationY = useSharedValue(height - 250);
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1); 
  const rotation = useSharedValue(0);
  const baseRotation = useSharedValue(0);

  const gesture = Gesture.Simultaneous(
    Gesture.Pan()
      .onStart(() => {
        baseTranslationX.value = translationX.value;
        baseTranslationY.value = translationY.value;
      })
      .onUpdate((e) => {
        translationX.value = baseTranslationX.value + e.translationX;
        translationY.value = baseTranslationY.value + e.translationY;
      }),
    Gesture.Rotation()
      .onStart(() => { baseRotation.value = rotation.value; })
      .onUpdate((e) => {
        rotation.value = baseRotation.value + e.rotation;
      }),
    Gesture.Pinch()
      .onStart(() => { baseScale.value = scale.value; })
      .onUpdate((e) => {
        scale.value = baseScale.value * e.scale;
      })
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value },
      { scale: scale.value },
      { rotateZ: `${(rotation.value * 180) / Math.PI}deg` },
    ],
  }));

  useLayoutEffect(() => {
    if (Platform.OS === 'android' && NativeModules.SystemBar) {
      // Set to dark
      NativeModules.SystemBar.setNavigationBarColor('#000000', false);
      NativeModules.SystemBar.setStatusBarColor('#000000', false);
    }
    return () => {
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        // Reset to default light
        NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', true);
        NativeModules.SystemBar.setStatusBarColor('#FFFFFF', true);
      }
    };
  }, []);

  const fetchPrivacyDefaults = async () => {
    try {
      const res = await api.get('/chat/privacy/status/');
      if (res.data?.restricted_to) setRestrictedTo(res.data.restricted_to);
    } catch (e) { console.log('[StatusEditor] Failed to fetch privacy defaults:', e); }
  };

  // ... (showPickerOptions, showCameraOptions, openGallery, handleResult, handleUpload stays same) ...
  const showPickerOptions = () => {
    if (source === 'camera') return;
    Keyboard.dismiss();
    Alert.alert('Add to Status', 'Choose source', [
      { text: '📷 Camera', onPress: showCameraOptions },
      { text: '🖼️ Gallery', onPress: openGallery },
      { text: 'Cancel', style: 'cancel', onPress: () => { if (!mediaUri) navigation.goBack(); }, },
    ]);
  };
  const showCameraOptions = async () => {
      const { launchCamera } = require('react-native-image-picker');
      const result = await launchCamera({ mediaType: 'mixed', quality: 0.8, saveToPhotos: false });
      handleResult(result);
  };
  const openGallery = async () => {
      const { launchImageLibrary } = require('react-native-image-picker');
      setIsPicking(true);
      try { handleResult(await launchImageLibrary({ mediaType: 'mixed', quality: 0.5 })); }
      finally { setIsPicking(false); }
  };
  const handleResult = (result: any) => {
    if (result.didCancel) { if (!mediaUri) navigation.goBack(); return; }
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setMediaUri(asset.uri);
      setMediaType(asset.type?.startsWith('video') ? 'video' : 'photo');
      setSource('gallery');
    }
  };

  const handleUpload = async () => {
    if (!mediaUri) return;
    setUploading(true);
    try {
      await StatusService.saveStatus(
        mediaUri, 
        caption, 
        mediaType, 
        restrictedTo,
        translationX.value,
        translationY.value,
        scale.value,
        rotation.value
      );
      navigation.goBack();
    } catch (err: any) {
      setUploading(false);
      Toast.show({ type: 'error', text1: 'Upload failed' });
    }
  };

  return (
    <GestureHandlerRootView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {mediaType === 'video' ? (
        <Video source={{ uri: mediaUri! }} style={StyleSheet.absoluteFill} resizeMode="contain" repeat />
      ) : (
        <Image source={{ uri: mediaUri! }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      )}

      {!!caption && (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[s.captionOverlay, animatedStyle]}>
            <Text style={s.captionOverlayText}>{caption}</Text>
          </Animated.View>
        </GestureDetector>
      )}

      <View style={[s.bottomBarAbsolute, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={s.privacyBtn} onPress={() => setModalVisible(true)}>
          <Icon name={restrictedTo.length > 0 ? "eye-off" : "eye"} size={22} color="#fff" />
        </TouchableOpacity>
        <TextInput
          style={s.captionInput}
          placeholder="Add a caption…"
          value={caption}
          onChangeText={setCaption}
        />
        <TouchableOpacity 
          style={[s.sendBtn, uploading && { opacity: 0.7 }]} 
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#8100D1" size="small" />
          ) : (
            <Icon name="send" size={26} color="#8100D1" />
          )}
        </TouchableOpacity>
      </View>
      
      <VisibilityModal 
        visible={modalVisible} 
        onClose={() => setModalVisible(false)} 
        onSelect={setRestrictedTo}
        initialSelected={restrictedTo}
      />
    </GestureHandlerRootView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  captionOverlay: { 
    position: 'absolute', 
    top: 0,
    left: 0,
    zIndex: 100, 
    padding: 40, // Significantly increased padding for easier two-finger gestures
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 120, // Increased minWidth to ensure a larger hit box
    minHeight: 120, // Added minHeight for better touch target
  },
  captionOverlayText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  bottomBarAbsolute: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    flexDirection: 'row', alignItems: 'center', 
    padding: 20, 
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  captionInput: { 
    flex: 1, color: '#ffffff', fontSize: 18,
    paddingHorizontal: 16, paddingVertical: 12, 
    backgroundColor: 'rgba(97, 97, 97, 0.5)', // Changed to light grey
    borderRadius: 22, marginRight: 10 , marginLeft: 10,
    maxWidth: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtn: {
    backgroundColor: 'rgba(97, 97, 97, 0.5)', 
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center'
  },
  privacyBtn: {
    backgroundColor: 'rgba(97, 97, 97, 0.5)', // Changed to light grey    
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center'
  },

});

export default StatusEditorScreen;