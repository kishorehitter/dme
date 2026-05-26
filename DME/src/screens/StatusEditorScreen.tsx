/**
 * StatusEditorScreen.tsx  — Reverted to stable version with system bar management
 */

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
  PermissionsAndroid,
  NativeModules,
  Dimensions,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { StatusService } from '../services/StatusService';
import { VisibilityModal } from '../components/VisibilityModal';

const { width, height } = Dimensions.get('window');
const MAX_VIDEO_SECONDS = 30;

async function compressAndTrimVideo(uri: string): Promise<string> {
  try {
    const { FFmpegKit, ReturnCode } = await import('ffmpeg-kit-react-native');
    const outPath = uri.replace(/\.[^.]+$/, '_c.mp4');
    const cmd =
      `-i "${uri}" -t ${MAX_VIDEO_SECONDS} -vcodec libx264 -crf 28 ` +
      `-preset ultrafast -acodec aac -b:a 96k "${outPath}" -y`;
    const session = await FFmpegKit.execute(cmd);
    const code = await session.getReturnCode();
    return ReturnCode.isSuccess(code) ? outPath : uri;
  } catch {
    return uri; // graceful fallback – ffmpeg-kit not installed
  }
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
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    // Automatically open picker if no media is provided AND not from camera
    if (!mediaUri && !params.mediaUri && source !== 'camera') {
      showPickerOptions();
    }
  }, []);

  useLayoutEffect(() => {
    if (Platform.OS === 'android' && NativeModules.SystemBar) {
      NativeModules.SystemBar.setStatusBarColor('#000000', true);
      NativeModules.SystemBar.setNavigationBarColor('#000000', true);
    }
    return () => {
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#FFFFFF', false);
        NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', false);
      }
    };
  }, []);

  const showPickerOptions = () => {
    if (source === 'camera') return; // Don't allow gallery if we came from camera
    
    Keyboard.dismiss();
    Alert.alert('Add to Status', 'Choose source', [
      { text: '📷 Camera', onPress: showCameraOptions },
      { text: '🖼️ Gallery', onPress: openGallery },
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => { if (!mediaUri) navigation.goBack(); },
      },
    ]);
  };

  const showCameraOptions = async () => {
    try {
      const result = await launchCamera({ mediaType: 'mixed', quality: 0.8 });
      handleResult(result);
    } catch (e) {
      console.error('System camera failed:', e);
    }
  };

  const openGallery = async () => {
    Keyboard.dismiss();
    setIsPicking(true);
    try {
      handleResult(await launchImageLibrary({ mediaType: 'mixed', quality: 0.5 }));
    } finally {
      setIsPicking(false);
    }
  };

  const handleResult = (result: any) => {
    if (result.didCancel) {
      if (!mediaUri) navigation.goBack();
      return;
    }
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setVideoError(false);
      setMediaUri(asset.uri);
      setMediaType(asset.type?.startsWith('video') ? 'video' : 'photo');
      setSource('gallery');
    }
  };

  const handleUpload = async () => {
    if (!mediaUri) return;
    Keyboard.dismiss();

    let uploadUri = mediaUri;
    
    if (mediaType === 'video') {
      setProcessing(true);
      try {
        uploadUri = await compressAndTrimVideo(mediaUri);
      } finally {
        setProcessing(false);
      }
    }
    setUploading(true);
    try {
      await StatusService.saveStatus(uploadUri, caption, mediaType, restrictedTo);
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Posted!',
        text2: 'Your status was uploaded.',
        position: 'bottom',
      });
    } catch (err: any) {
      setUploading(false);
      console.error('[StatusEditor] Upload failed:', err);
      Toast.show({
        type: 'error',
        text1: 'Upload failed',
        text2: err?.message ?? 'Try again.',
        position: 'bottom',
      });
    }
  };

  const renderLoadingOverlay = () => {
    if (!isPicking && !uploading && !processing) return null;
    return (
      <View style={s.processingOverlay}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={s.processingText}>
          {uploading ? 'Uploading...' : processing ? 'Compressing...' : 'Opening...'}
        </Text>
      </View>
    );
  };

  if (!mediaUri) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <TouchableOpacity style={[s.closeAbs, { top: insets.top + (Platform.OS === 'ios' ? 8 : 18) }]} onPress={() => navigation.goBack()}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <Icon name="image-outline" size={72} color="#555" />
        <Text style={s.noMediaText}>No media selected</Text>
        {source !== 'camera' && (
          <TouchableOpacity style={s.pickBtn} onPress={showPickerOptions}>
            <Text style={s.pickBtnText}>Choose Media</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      {renderLoadingOverlay()}

      {mediaType === 'video' ? (
        <Video
          key={mediaUri}
          source={{ uri: mediaUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          repeat
          paused={uploading || processing}
          onError={(e) => {
            console.error('[StatusEditor] Video error:', e);
            setVideoError(true);
          }}
        />
      ) : (
        <Image
          key={mediaUri}
          source={{ uri: mediaUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoad={() => console.log('[StatusEditor] Image loaded successfully')}
          onError={(e) => console.error('[StatusEditor] Image load error:', e.nativeEvent.error)}
        />
      )}

      <View style={s.scrim} pointerEvents="none" />

      {!!caption && (
        <View style={s.captionOverlay} pointerEvents="none">
          <Text style={s.captionOverlayText}>{caption}</Text>
        </View>
      )}

      <TouchableOpacity 
        style={[s.closeAbs, { top: insets.top + (Platform.OS === 'ios' ? 8 : 18) }]} 
        onPress={() => navigation.goBack()}
      >
        <Icon name="close" size={28} color="#fff" />
      </TouchableOpacity>

      {source !== 'camera' && (
        <TouchableOpacity 
          style={[s.changeBtn, { top: insets.top + (Platform.OS === 'ios' ? 8 : 18) }]} 
          onPress={showPickerOptions}
        >
          <Icon name="swap-horizontal" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      <View style={[s.bottomBarAbsolute, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={s.privacyBtn} onPress={() => setModalVisible(true)}>
          <Icon name={restrictedTo.length > 0 ? "eye-off" : "eye"} size={22} color="#fff" />
        </TouchableOpacity>
        <TextInput
          style={s.captionInput}
          placeholder="Add a caption…"
          placeholderTextColor="rgba(255,255,255,0.55)"
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={255}
        />
        <TouchableOpacity
          style={[s.sendBtn, (uploading || processing) && { opacity: 0.55 }]}
          onPress={handleUpload}
          disabled={uploading || processing}
        >
          {uploading
            ? <ActivityIndicator color="#fff" />
            : <Icon name="send" size={26} color="#8100D1" />
          }
        </TouchableOpacity>
      </View>
      
      <VisibilityModal 
        visible={modalVisible} 
        onClose={() => setModalVisible(false)} 
        onSelect={setRestrictedTo}
        initialSelected={restrictedTo}
      />
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  scrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260, backgroundColor: 'rgba(0,0,0,0.5)' },
  captionOverlay: { position: 'absolute', bottom: 140, left: 24, right: 24, alignItems: 'center' },
  captionOverlayText: {
    color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  closeAbs: {
    position: 'absolute', left: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6,
  },
  changeBtn: {
    position: 'absolute', right: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6,
  },
  privacyBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: 10, marginRight: 10,
  },
  bottomBarAbsolute: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  captionInput: {
    flex: 1, color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22, marginRight: 10, maxHeight: 100, textAlign: 'center',
  },
  sendBtn: {
    backgroundColor: '#fff', borderRadius: 25,
    width: 48, height: 48, justifyContent: 'center', alignItems: 'center',
  },
  noMediaText: { color: '#fff', fontSize: 16, marginTop: 16, marginBottom: 24 },
  pickBtn: { backgroundColor: '#8100D1', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24 },
  pickBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', zIndex: 20,
  },
  processingText: { color: '#fff', marginTop: 12, fontSize: 15 },
});

export default StatusEditorScreen;
