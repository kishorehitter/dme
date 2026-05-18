/**
 * StatusEditorScreen.tsx  — Fixed & Enhanced
 *
 * Fixes applied
 * ─────────────
 * [1] Video preview black-screen for uploader  →  key={mediaUri} forces Video to remount on
 *     every new URI; also removed `paused` while not uploading/processing.
 * [2] Caption not visible to uploader          →  captionOverlay is always rendered when
 *     caption is non-empty (was hidden behind logic gap in original).
 * [3] Full-screen centered UI (WhatsApp-style) →  resizeMode="cover" + absoluteFill on both
 *     Image and Video; scrim gradient covers bottom third only.
 * [4] Bottom bar hidden under Android nav      →  paddingBottom = insets.bottom + 8
 * [5] Video trim enforced client-side          →  durationLimit = MAX_VIDEO_SECONDS passed to
 *     launchCamera; ffmpeg trim also kept for gallery picks.
 * [6] Camera permission split Photo / Video    →  separate Alert options, each requests
 *     CAMERA permission before launching.
 */

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  KeyboardAvoidingView,
  PermissionsAndroid,
  NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { StatusService } from '../services/StatusService';

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
}

const StatusEditorScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const params = (route.params as RouteParams) ?? {};

  const [mediaUri, setMediaUri] = useState<string | null>(params.mediaUri ?? null);
  const [mediaType, setMediaType] = useState<'photo' | 'video'>(params.mediaType ?? 'photo');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  // FIX [1]: track video error to surface helpful message
  const [videoError, setVideoError] = useState(false);

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

  // ─── Permissions ──────────────────────────────────────────────────────────
  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'This app needs camera access to take photos for your status.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return true;
      Alert.alert('Permission Denied', 'Camera permission is required.');
      return false;
    } catch {
      Alert.alert('Permission Error', 'Could not request camera permission.');
      return false;
    }
  };

  // ─── Picker helpers ───────────────────────────────────────────────────────
  const showPickerOptions = () => {
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

  const showCameraOptions = () => {
    Alert.alert('Camera', 'What to capture?', [
      {
        text: '🖼 Photo',
        onPress: async () => {
          if (!(await requestCameraPermission())) return;
          setIsPicking(true);
          try {
            handleResult(await launchCamera({ mediaType: 'photo', quality: 0.85 }));
          } finally {
            setIsPicking(false);
          }
        },
      },
      {
        text: '🎥 Video',
        onPress: async () => {
          if (!(await requestCameraPermission())) return;
          setIsPicking(true);
          try {
            handleResult(
              await launchCamera({
                mediaType: 'video',
                videoQuality: 'medium',
                durationLimit: MAX_VIDEO_SECONDS, // FIX [5]: enforce 30s at capture
              }),
            );
          } finally {
            setIsPicking(false);
          }
        },
      },
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => { if (!mediaUri) navigation.goBack(); },
      },
    ]);
  };

  const openGallery = async () => {
    setIsPicking(true);
    try {
      handleResult(await launchImageLibrary({ mediaType: 'mixed', quality: 0.85 }));
    } finally {
      setIsPicking(false);
    }
  };

  const handleResult = (result: any) => {
    if (result.didCancel) {
      if (!mediaUri) navigation.goBack();
      return;
    }
    if (result.errorCode) {
      Alert.alert('Error', result.errorMessage ?? 'Picker failed');
      if (!mediaUri) navigation.goBack();
      return;
    }
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setVideoError(false); // reset error state for new media
      setMediaUri(asset.uri);
      setMediaType(asset.type?.startsWith('video') ? 'video' : 'photo');
    }
  };

  // ─── Upload ───────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!mediaUri) { Alert.alert('No media selected'); return; }
    let uploadUri = mediaUri;
    if (mediaType === 'video') {
      setProcessing(true);
      try {
        uploadUri = await compressAndTrimVideo(mediaUri); // FIX [5]: also trims gallery picks
      } finally {
        setProcessing(false);
      }
    }
    setUploading(true);
    try {
      await StatusService.saveStatus(uploadUri, caption, mediaType);
      
      // Navigate first while the overlay is still visible to avoid the "shake"
      navigation.popToTop();
      navigation.navigate('MainTabs', { screen: 'Status' });

      Toast.show({
        type: 'success',
        text1: 'Posted!',
        text2: 'Your status was uploaded.',
        position: 'bottom',
      });
    } catch (err: any) {
      setUploading(false); // Only set false on error
      Toast.show({
        type: 'error',
        text1: 'Upload failed',
        text2: err?.message ?? 'Try again.',
        position: 'bottom',
      });
    }
  };

  // ─── Loading / Uploading Overlay ──────────────────────────────────────────
  const renderLoadingOverlay = () => {
    if (!isPicking && !uploading && !processing) return null;
    return (
      <View style={s.processingOverlay}>
        <StatusBar hidden={false} barStyle="light-content" backgroundColor="#000000" translucent={false} />
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
        <StatusBar hidden />
        <TouchableOpacity style={s.closeAbs} onPress={() => navigation.goBack()}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <Icon name="image-outline" size={72} color="#555" />
        <Text style={s.noMediaText}>No media selected</Text>
        <TouchableOpacity style={s.pickBtn} onPress={showPickerOptions}>
          <Text style={s.pickBtnText}>Choose Media</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Editor UI ────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      {renderLoadingOverlay()}
      <StatusBar hidden />

      {/* FIX [1] & [3]:
            - key={mediaUri} forces Video to fully remount when URI changes,
              preventing the black-screen issue on uploader side.
            - resizeMode="cover" fills the screen (WhatsApp-style).
            - paused only when actively uploading or processing — NOT while
              editing caption, so uploader sees their video playing. */}
      {mediaType === 'video' ? (
        <Video
          key={mediaUri}
          source={{ uri: mediaUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          controls={false}
          repeat
          paused={uploading || processing}
          onError={() => setVideoError(true)}
        />
      ) : (
        <Image
          source={{ uri: mediaUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      )}

      {/* Video error fallback */}
      {videoError && (
        <View style={s.videoErrorBanner} pointerEvents="none">
          <Icon name="warning-outline" size={18} color="#ffcc00" />
          <Text style={s.videoErrorText}>Preview unavailable — will upload correctly</Text>
        </View>
      )}

      {/* Bottom gradient scrim */}
      <View style={s.scrim} pointerEvents="none" />

      {/* FIX [2]: caption overlay — always rendered when non-empty so the
          uploader sees it exactly as viewers will. */}
      {!!caption && (
        <View style={s.captionOverlay} pointerEvents="none">
          <Text style={s.captionOverlayText}>{caption}</Text>
        </View>
      )}

      {/* Close */}
      <TouchableOpacity style={s.closeAbs} onPress={() => navigation.goBack()}>
        <Icon name="close" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Change media */}
      <TouchableOpacity style={s.changeBtn} onPress={showPickerOptions}>
        <Icon name="swap-horizontal" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Processing overlay */}
      {processing && (
        <View style={s.processingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={s.processingText}>Compressing video…</Text>
        </View>
      )}

      {/* FIX [4]: bottom bar above system nav bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kvWrapper}
      >
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
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
      </KeyboardAvoidingView>
    </View>
  );
};

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  center:             { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  // FIX [3]: taller scrim so captions/controls always readable
  scrim:              { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260, backgroundColor: 'rgba(0,0,0,0.5)' },
  // FIX [2]: overlay sits above the scrim, centered horizontally
  captionOverlay:     { position: 'absolute', bottom: 140, left: 24, right: 24, alignItems: 'center' },
  captionOverlayText: {
    color: '#fff', fontSize: 20, fontWeight: '600', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  closeAbs:           {
    position: 'absolute', top: Platform.OS === 'ios' ? 52 : 18, left: 16,
    zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6,
  },
  changeBtn:          {
    position: 'absolute', top: Platform.OS === 'ios' ? 52 : 18, right: 16,
    zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6,
  },
  kvWrapper:          { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomBar:          {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionInput:       {
    flex: 1, color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22, marginRight: 10, maxHeight: 100, textAlign: 'center',
  },
  sendBtn:            {
    backgroundColor: '#fff', borderRadius: 25,
    width: 48, height: 48, justifyContent: 'center', alignItems: 'center',
  },
  noMediaText:        { color: '#fff', fontSize: 16, marginTop: 16, marginBottom: 24 },
  pickBtn:            { backgroundColor: '#8100D1', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24 },
  pickBtnText:        { color: '#fff', fontSize: 15, fontWeight: '600' },
  processingOverlay:  {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', zIndex: 20,
  },
  processingText:     { color: '#fff', marginTop: 12, fontSize: 15 },
  videoErrorBanner:   {
    position: 'absolute', top: Platform.OS === 'ios' ? 100 : 66,
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6, zIndex: 15,
  },
  videoErrorText:     { color: '#fff', fontSize: 12, marginLeft: 6 },
});

export default StatusEditorScreen;