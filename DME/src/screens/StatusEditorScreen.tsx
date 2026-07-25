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
import { pinNavBarColor } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
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
    const cmd = `-i "${cleanPath}" -t ${MAX_VIDEO_SECONDS} -vcodec libx264 -crf 28 -preset ultrafast -acodec aac -b:a 96k "${outPath}" -y`;
    const session = await FFmpegKit.execute(cmd);
    const code = await session.getReturnCode();
    return ReturnCode.isSuccess(code) ? `file://${outPath}` : uri;
  } catch { return uri; }
}

interface PendingMediaItem {
  mediaUri: string;
  mediaType: 'photo' | 'video';
}

interface RouteParams {
  mediaUri?: string;
  mediaType?: 'photo' | 'video';
  source?: 'camera' | 'gallery';
  pendingMedia?: PendingMediaItem[];
  // Internal: used when chaining stories
  _storyIndex?: number;
  _storyTotal?: number;
  restrictedTo?: number[];
}

const StatusEditorScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const params = (route.params as RouteParams) ?? {};

  const pendingMedia: PendingMediaItem[] = params.pendingMedia ?? [];
  const storyIndex = params._storyIndex ?? 1;
  const storyTotal = params._storyTotal ?? (1 + pendingMedia.length);
  const hasMore = pendingMedia.length > 0;

  const [mediaUri, setMediaUri] = useState<string | null>(params.mediaUri ?? null);
  const [mediaType, setMediaType] = useState<'photo' | 'video'>(params.mediaType ?? 'photo');
  const [source, setSource] = useState<'camera' | 'gallery'>(params.source ?? 'gallery');
  const [caption, setCaption] = useState('');
  const [restrictedTo, setRestrictedTo] = useState<number[]>(params.restrictedTo ?? []);
  const [modalVisible, setModalVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const navigatingAwayRef = React.useRef(false);

  useEffect(() => {
    if (!params.restrictedTo) {
      fetchPrivacyDefaults();
    }
    if (Platform.OS === 'android') {
      pinNavBarColor('#000000');
      try {
        changeNavigationBarColor('#000000', false, false);
      } catch (err) {
        console.warn('[StatusEditorScreen] Navigation bar color error:', err);
      }
    }
    return () => {
      if (Platform.OS === 'android') {
        if (!navigatingAwayRef.current) {
          pinNavBarColor('#FFFFFF');
          try {
            changeNavigationBarColor('#FFFFFF', true, false);
          } catch (err) {
            console.warn('[StatusEditorScreen] Navigation bar color restore error:', err);
          }
        }
      }
    };
  }, [params.restrictedTo]);

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
    if (Platform.OS === 'android') {
      pinNavBarColor('#000000');
      if (NativeModules.SystemBar) {
        // Set to dark
        NativeModules.SystemBar.setNavigationBarColor('#000000', false);
        NativeModules.SystemBar.setStatusBarColor('#000000', false);
      }
    }
    return () => {
      if (Platform.OS === 'android') {
        if (!navigatingAwayRef.current) {
          pinNavBarColor('#FFFFFF');
          if (NativeModules.SystemBar) {
            // Reset to default light
            NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', true);
            NativeModules.SystemBar.setStatusBarColor('#FFFFFF', true);
          }
        }
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

  const handleUpload = () => {
    if (!mediaUri) return;

    Keyboard.dismiss();
    navigatingAwayRef.current = true;

    // Build the upload queue
    // Only the first status (current one) gets the caption and gesture values.
    // The rest (pendingMedia) get default values.
    const queue = [
      {
        mediaUri: mediaUri,
        mediaType: mediaType,
        caption: caption,
        restrictedTo: restrictedTo,
        translationX: translationX.value,
        translationY: translationY.value,
        scale: scale.value,
        rotation: rotation.value,
      },
      ...pendingMedia.map(item => ({
        mediaUri: item.mediaUri,
        mediaType: item.mediaType,
        caption: '',
        restrictedTo: restrictedTo,
        translationX: 0,
        translationY: 0,
        scale: 1,
        rotation: 0,
      }))
    ];

    // Navigate directly to StatusViewer to run the uploads in background with visual progress tracker
    setTimeout(() => {
      navigation.replace('StatusViewer', {
        uploadQueue: queue,
        isOwn: true,
      });
    }, 150);
  };

  return (
    <GestureHandlerRootView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* ── Multi-story progress header ── */}
      {storyTotal > 1 && (
        <View style={[s.progressHeader, { paddingTop: insets.top > 0 ? insets.top + 4 : 8 }]}>
          {Array.from({ length: storyTotal }).map((_, i) => (
            <View
              key={i}
              style={[
                s.progressSegment,
                i < storyIndex ? s.progressDone :
                i === storyIndex - 1 ? s.progressActive :
                s.progressUpcoming,
              ]}
            />
          ))}
        </View>
      )}

      {/* ── Back / close button ── */}
      <TouchableOpacity style={[s.backBtn, { top: insets.top > 0 ? insets.top + 16 : 28 }]} onPress={() => navigation.goBack()}>
        <Icon name="arrow-back" size={24} color="#fff" />
      </TouchableOpacity>
      
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
          style={[s.sendBtn, (uploading || processing) && { opacity: 0.7 }]} 
          onPress={handleUpload}
          disabled={uploading || processing}
        >
          {uploading || processing ? (
            <ActivityIndicator color="#4597f5f6" size="small" />
          ) : (
            <Icon name="send" size={26} color="#4597f5f6" />
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
  // ── Multi-story progress bar ──────────────────────────────────────────────
  progressHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 4,
    zIndex: 1000,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  progressDone: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  progressActive: {
    backgroundColor: '#4597f5',
  },
  progressUpcoming: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  backBtn: {
    position: 'absolute',
    top: 28,
    left: 12,
    zIndex: 1001,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 22,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

});

export default StatusEditorScreen;