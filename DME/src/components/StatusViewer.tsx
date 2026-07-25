/**
 * StatusViewer.tsx — Final
 *
 * Fixes in this version
 * ─────────────────────
 * [1] Buttons not working — tapZones absoluteFillObject was covering the entire
 *     screen including the bottom bar, swallowing all button taps.
 *     Fixed: tapZones now only covers the media area (above the bottom bar).
 * [2] Caption centered — added textAlign: 'center'
 * [3] Bottom bar layout: Like LEFT · Reply input CENTER (rounded) · Save RIGHT
 *     spaced with justifyContent: 'space-between'
 * [4] Reply input is always visible in bottom bar (not hidden behind a toggle),
 *     tapping it focuses + pauses progress. Send button inside the input.
 * [5] All elements respect safe area insets — nothing hidden under notch or nav bar
 */

import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions,
  TouchableWithoutFeedback, TouchableOpacity,
  StatusBar, Animated, FlatList, Modal,
  ActivityIndicator, Alert, Platform,
  PanResponder, TextInput, KeyboardAvoidingView,
  NativeModules, DeviceEventEmitter,
} from 'react-native';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Video from 'react-native-video';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../utils/image';
import {
  StatusService, Status, StatusViewer as ViewerType, LikedUser
} from '../services/StatusService';
import AvatarWithFallback from './AvatarWithFallback';
import { pinNavBarColor } from '../utils/navBarPin';
import Toast from 'react-native-toast-message';

const { width: W, height: H } = Dimensions.get('screen');
const PHOTO_DURATION = 5000;
const BOTTOM_BAR_HEIGHT = 80;

interface ViewerSheetProps {
  statusId:  number;
  viewCount: number;
  visible:   boolean;
  onClose:   () => void;
}

const ViewerSheet: React.FC<{
  statusId: number;
  visible: boolean;
  type: 'views' | 'likes';
  onClose: () => void;
}> = ({ statusId, visible, type, onClose }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const safeBottom = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'ios' ? 34 : 12);

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    setLoading(true);
    StatusService.getInteractions(statusId)
      .then(res => {
        if (isMounted) setData(type === 'views' ? (res?.viewers || []) : (res?.likes || []));
      })
      .catch(() => { if (isMounted) setData([]); })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [visible, statusId, type]);

  const renderItem = ({ item }: { item: any }) => {
    const isLike = type === 'likes';
    const name = isLike ? item.username : item.viewer_username;
    const avatar = isLike ? item.avatar : item.viewer_avatar;
    const sticker = isLike ? item.avatar_sticker : item.viewer_avatar_sticker;
    const time = isLike ? item.liked_at : item.viewed_at;

    return (
      <View style={vs.row}>
        <AvatarWithFallback
          uri={avatar}
          sticker={sticker}
          displayName={name}
          style={vs.avatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={vs.name}>{name}</Text>
          <Text style={vs.time}>
            {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {isLike && <Icon name="heart" size={16} color="#ff4d6d" />}
      </View>
    );
  };



  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={vs.overlay} />
      </TouchableWithoutFeedback>
      <View style={[vs.sheet, { paddingBottom: safeBottom + 16 }]}>
        <View style={vs.handle} />
        <Text style={vs.title}>{type === 'views' ? 'Viewers' : 'Likers'}</Text>
        {loading ? <ActivityIndicator color="#4597f5f6" style={{ marginTop: 24 }} /> : 
         <FlatList data={data} keyExtractor={i => String(i.user_id || i.viewer_id)} renderItem={renderItem} />}
      </View>
    </Modal>
  );
};

const vs = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginBottom: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  toggleActive: {
    borderBottomColor: '#4597f5f6',
  },
  toggleText: {
    fontSize: 14,
    color: '#888',
    fontWeight: '500',
  },
  toggleTextActive: {
    color: '#4597f5f6',
    fontWeight: '600',
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: H * 0.6, backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  handle:  { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  title:   { fontSize: 16, fontWeight: '600', textAlign: 'center', paddingBottom: 12, color: '#111' },
  empty:   { textAlign: 'center', color: '#aaa', marginTop: 24, fontSize: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  avatar:  { width: 42, height: 42, borderRadius: 21, marginRight: 12 },
  fallback:{ backgroundColor: '#d1c4e9', justifyContent: 'center', alignItems: 'center' },
  name:    { fontSize: 14, fontWeight: '500', color: '#111' },
  time:    { fontSize: 12, color: '#888', marginTop: 2 },
});

interface RouteParams {
  statuses:      Status[];
  initialIndex:  number;
  currentUserId: number;
  isOwn:         boolean;
  uploadQueue?:  any[];
}

const MAX_VIDEO_SECONDS = 30;

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

const StatusViewerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route      = useRoute();
  const insets     = useSafeAreaInsets();
  const safeBottom = 34;
  const safeTop = insets.top > 0 ? insets.top : (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 20);

  const { theme, isDark } = useTheme();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'android') {
        pinNavBarColor('#00000000');
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setFitsSystemWindows(false);
          NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        }
      }

      return () => {
        if (Platform.OS === 'android') {
          pinNavBarColor(theme.navBar);
          if (NativeModules.SystemBar) {
            NativeModules.SystemBar.setFitsSystemWindows(true);
            NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
          }
        }
      };
    }, [theme, isDark])
  );


  const params = (route.params as RouteParams) || {};
  const { statuses: initialStatuses = [], initialIndex = 0, isOwn = false, uploadQueue = null } = params;

  // We construct temporary Status objects for local preview
  const mappedQueueStatuses = uploadQueue ? uploadQueue.map((item: any, idx: number) => ({
    id: -(idx + 1), // temporary negative ID to identify uploading items
    user_id: params.currentUserId || 0,
    username: 'You',
    user_avatar: null,
    user_avatar_sticker: null,
    media_url: item.mediaUri,
    media_file: item.mediaUri,
    media_type: item.mediaType,
    caption: item.caption || null,
    caption_x: item.translationX || 0,
    caption_y: item.translationY || 0,
    caption_scale: item.scale || 1,
    caption_rotation: item.rotation || 0,
    created_at: new Date().toISOString(),
    view_count: 0,
    is_viewed: true,
  })) : [];

  const [statuses,      setStatuses]      = useState<Status[]>(uploadQueue ? mappedQueueStatuses : initialStatuses);
  const [index,         setIndex]         = useState(initialIndex);
  const [showViewers,   setShowViewers]   = useState(false);
  const [sheetType,     setSheetType]     = useState<'views' | 'likes'>('views'); // Track which list to show
  const [videoDuration, setVideoDuration] = useState(PHOTO_DURATION);
  const [videoPaused,   setVideoPaused]   = useState(false);

  const [liked,       setLiked]       = useState(false);
  const [likeCount,   setLikeCount]   = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);

  const [replyText,   setReplyText]   = useState('');
  const [replyFocused,setReplyFocused]= useState(false);
  const [replySending,setReplySending]= useState(false);

  const [saving, setSaving] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);


  // Background Upload states
  const [isUploading, setIsUploading] = useState(!!uploadQueue);
  const [uploadIndex, setUploadIndex] = useState(0);
  const activeUploadRef = useRef<boolean>(true);
  const uploadedIdsRef = useRef<number[]>([]);

  useEffect(() => {
    if (isUploading) {
      setIndex(uploadIndex);
    }
  }, [uploadIndex, isUploading]);

  const handleCancelUpload = useCallback(async () => {
    activeUploadRef.current = false;
    setIsUploading(false);

    const idsToDelete = [...uploadedIdsRef.current];
    if (idsToDelete.length > 0) {
      Toast.show({ type: 'info', text1: 'Cancelling and cleaning up...' });
      for (const id of idsToDelete) {
        try {
          await StatusService.deleteStatus(id);
        } catch (err) {
          console.error('[StatusViewer Cancel] failed to delete status:', id, err);
        }
      }
    }

    Toast.show({ type: 'info', text1: 'Upload cancelled' });
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs');
    }
  }, [navigation]);

  useEffect(() => {
    if (!isUploading) return;
    
    const { BackHandler } = require('react-native');
    const backAction = () => {
      handleCancelUpload();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [isUploading, handleCancelUpload]);

  useEffect(() => {
    if (!uploadQueue || !isUploading) return;

    activeUploadRef.current = true;
    uploadedIdsRef.current = [];

    const runUploads = async () => {
      try {
        const RNFS = require('react-native-fs');
        const finalStatuses: Status[] = [...statuses];

        for (let i = 0; i < uploadQueue.length; i++) {
          if (!activeUploadRef.current) break;
          setUploadIndex(i);

          const item = uploadQueue[i];
          let finalUri = item.mediaUri;
          let tempPathToCleanup: string | null = null;
          let compressedPathToCleanup: string | null = null;

          try {
            // 1. Copy content:// URI to cache
            if (finalUri.startsWith('content://')) {
              const ext = item.mediaType === 'video' ? 'mp4' : 'jpg';
              const tempPath = `${RNFS.CachesDirectoryPath}/status_temp_${Date.now()}.${ext}`;
              await RNFS.copyFile(finalUri, tempPath);
              finalUri = `file://${tempPath}`;
              tempPathToCleanup = tempPath;
            }

            // 2. Compress video
            if (item.mediaType === 'video') {
              const processedUri = await compressAndTrimVideo(finalUri);
              if (processedUri !== finalUri) {
                finalUri = processedUri;
                compressedPathToCleanup = processedUri.replace('file://', '');
              }
            }

            if (!activeUploadRef.current) {
              if (tempPathToCleanup) await RNFS.unlink(tempPathToCleanup).catch(() => {});
              if (compressedPathToCleanup) await RNFS.unlink(compressedPathToCleanup).catch(() => {});
              break;
            }

            // 3. Upload to backend
            const uploadedStatus = await StatusService.saveStatus(
              finalUri,
              item.caption || '',
              item.mediaType,
              item.restrictedTo,
              item.translationX || 0,
              item.translationY || 0,
              item.scale || 1,
              item.rotation || 0
            );

            if (uploadedStatus && uploadedStatus.id) {
              uploadedIdsRef.current.push(uploadedStatus.id);
              // Replace temporary status with real uploaded status, but keep the local URI to prevent source reload/jump
              finalStatuses[i] = {
                ...uploadedStatus,
                media_url: item.mediaUri,
                media_file: item.mediaUri,
              };
              setStatuses([...finalStatuses]);
            }

          } catch (err) {
            console.error('[StatusViewer BackgroundUpload] failed for index', i, err);
            Alert.alert('Upload Failed', `Could not upload item ${i + 1}.`);
            break;
          } finally {
            if (tempPathToCleanup) {
              try { await RNFS.unlink(tempPathToCleanup); } catch {}
            }
            if (compressedPathToCleanup) {
              try { await RNFS.unlink(compressedPathToCleanup); } catch {}
            }
          }
        }

        if (activeUploadRef.current) {
          setIsUploading(false);
          setIndex(0);
          Toast.show({ type: 'success', text1: 'Statuses uploaded successfully!' });
        }

      } catch (err) {
        console.error('[StatusViewer BackgroundUpload] loop error:', err);
      }
    };

    runUploads();

    return () => {
      activeUploadRef.current = false;
    };
  }, [uploadQueue, isUploading]);

  useEffect(() => {
    setVideoLoaded(false);
  }, [index]);

  const progress  = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const viewedSet = useRef(new Set<number>());
  const replyRef  = useRef<TextInput>(null);
  const flatListRef = useRef<FlatList>(null);
  const isScrollingRef = useRef(false);

  const current = statuses[index];
  const isVideo = current?.media_type === 'video';
  const isOwner = isOwn;

  const translateY   = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !replyFocused && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove:    (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) {
          Animated.timing(translateY, { toValue: H, duration: 200, useNativeDriver: true })
            .start(() => navigation.goBack());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const closeViewer = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs');
    }
  }, [navigation]);

  const startProgress = useCallback((duration: number) => {
    progress.setValue(0);
    animation.current?.stop();
    animation.current = Animated.timing(progress, { toValue: 1, duration, useNativeDriver: false });
    animation.current.start(({ finished }) => {
      if (!finished) return;
      setIndex(i => {
        if (i < statuses.length - 1) return i + 1;
        setTimeout(closeViewer, 0);
        return i;
      });
    });
  }, [statuses.length, closeViewer, progress]);

  const stopProgress = useCallback(() => animation.current?.stop(), []);

  // Sync index state change to scroll FlatList to correct item
  useEffect(() => {
    if (flatListRef.current && !isScrollingRef.current) {
      flatListRef.current.scrollToIndex({ index, animated: true });
    }
  }, [index]);

  const onMomentumScrollEnd = useCallback((e: any) => {
    isScrollingRef.current = false;
    const offset = e.nativeEvent.contentOffset.x;
    const nextIndex = Math.round(offset / W);
    if (nextIndex !== index && nextIndex >= 0 && nextIndex < statuses.length) {
      setIndex(nextIndex);
    }
  }, [index, statuses.length]);

  const onScrollBeginDrag = useCallback(() => {
    isScrollingRef.current = true;
    stopProgress();
  }, [stopProgress]);

  useEffect(() => {
    if (!current) return;

    if (!isOwner && !viewedSet.current.has(current.id)) {
      viewedSet.current.add(current.id);
      StatusService.markViewed(current.id);
    }

    if (!isOwner) {
      setLiked((current as any).is_liked ?? false);
      setLikeCount((current as any).like_count ?? 0);
    }
  }, [index, current?.id]);

  useEffect(() => {
    if (isUploading) {
      stopProgress();
      return;
    }
    if (!current || isVideo) return;
    startProgress(PHOTO_DURATION);
    return () => animation.current?.stop();
  }, [index, isUploading]);

  useEffect(() => {
    if (isUploading) return;
    if (replyFocused) stopProgress();
    else if (!isVideo) startProgress(PHOTO_DURATION);
  }, [replyFocused, isUploading]);

  const handleTap = (side: 'left' | 'right') => {
    if (isUploading) return;
    if (replyFocused) {
      replyRef.current?.blur();
      return;
    }
    stopProgress();
    if (side === 'left') {
      setIndex(i => Math.max(0, i - 1));
    } else {
      setIndex(i => {
        if (i < statuses.length - 1) return i + 1;
        setTimeout(closeViewer, 0);
        return i;
      });
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Status', 'Remove this status?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await StatusService.deleteStatus(current.id);
            const updated = statuses.filter(s => s.id !== current.id);
            if (updated.length === 0) { navigation.goBack(); return; }
            setStatuses(updated);
            setIndex(i => Math.min(i, updated.length - 1));
          } catch { Alert.alert('Error', 'Could not delete status.'); }
        },
      },
    ]);
  };

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    const was = liked;
    setLiked(!was);
    setLikeCount(c => Math.max(0, c + (was ? -1 : 1)));
    try {
      if (was) await StatusService.unlikeStatus(current.id);
      else     await StatusService.likeStatus(current.id);
    } catch {
      setLiked(was);
      setLikeCount(c => Math.max(0, c + (was ? 1 : -1)));
    } finally {
      setLikeLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      await StatusService.replyToStatus(current.id, replyText.trim());
      setReplyText('');
      replyRef.current?.blur();
      Alert.alert('Sent', `Reply sent to ${current.username}`);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send reply.');
    } finally {
      setReplySending(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const RNFetchBlob    = (await import('rn-fetch-blob')).default;
      const { CameraRoll } = await import('@react-native-camera-roll/camera-roll');
      const { dirs }       = RNFetchBlob.fs;
      const ext            = isVideo ? 'mp4' : 'jpg';
      const dest           = `${dirs.CacheDir}/sv_${current.id}.${ext}`;
      const url            = current.media_url || current.media_file;
      await RNFetchBlob.config({ path: dest }).fetch('GET', url);
      await CameraRoll.saveAsset(`file://${dest}`, { type: isVideo ? 'video' : 'photo' });
      Alert.alert('Saved', 'Saved to your gallery.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Check storage permissions.');
    } finally {
      setSaving(false);
    }
  };

  if (!current) { return null; }

  const displayName = isOwner ? 'My Status' : current.username;
  const bottomBarH = BOTTOM_BAR_HEIGHT + safeBottom;

  const isDarkText = false; // Always white text/icons
  const textColor = isDarkText ? '#000000' : '#ffffff';
  const secondaryColor = isDarkText ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
  const trackBg = isDarkText ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.4)';
  const inputBg = isDarkText ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.15)';
  const borderCol = isDarkText ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.15)';
  const placeholderCol = isDarkText ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)';
  const shadowColor = isDarkText ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)';

  return (
    <View
      style={s.container}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />


      {/* ── Media FlatList (Allows horizontal swiping between statuses) ── */}
      <FlatList
        ref={flatListRef}
        data={statuses}
        keyExtractor={item => String(item.id)}
        horizontal={true}
        pagingEnabled={true}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({
          length: W,
          offset: W * i,
          index: i,
        })}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScrollToIndexFailed={(info) => {
          const wait = new Promise(resolve => setTimeout(resolve, 50));
          wait.then(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
          });
        }}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ width: W * statuses.length }}
        renderItem={({ item, index: i }) => {
          const isItemVideo = item.media_type === 'video';
          return (
            <View style={{ width: W, height: H, backgroundColor: '#000000' }}>
              {isItemVideo ? (
                <>
                  <Video
                    source={{ uri: resolveImageUrl(item.media_url || item.media_file) }}
                    style={[StyleSheet.absoluteFill, { opacity: i === index && videoLoaded ? 1 : 0 }]}
                    resizeMode="contain"
                    paused={i !== index || isUploading || videoPaused || showViewers || replyFocused}
                    repeat={false}
                    onLoad={({ duration }) => {
                      if (i !== index) return;
                      const ms = (duration || 10) * 1000;
                      setVideoDuration(ms);
                      setVideoLoaded(true);
                      if (!isUploading) {
                        startProgress(ms);
                      }
                    }}
                    onEnd={() => {
                      if (i !== index || isUploading) return;
                      setIndex(curr => {
                        if (curr < statuses.length - 1) return curr + 1;
                        setTimeout(closeViewer, 0);
                        return curr;
                      });
                    }}
                  />
                  {i === index && !videoLoaded && (
                    <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
                      <ActivityIndicator size="large" color="#ffffff" />
                    </View>
                  )}
                </>
              ) : (
                <>
                  {/* Dynamic background: blurred cover fills screen for photo statuses */}
                  <Image
                    source={{ uri: resolveImageUrl(item.media_url || item.media_file) }}
                    style={[StyleSheet.absoluteFill, s.bgCoverPhoto]}
                    resizeMode="cover"
                    blurRadius={15}
                  />
                  <Image
                    source={{ uri: resolveImageUrl(item.media_url || item.media_file) }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                    resizeMethod={Platform.OS === 'android' ? 'resize' : 'auto'}
                  />
                </>
              )}
            </View>
          );
        }}
      />

      {/* ── Top scrim: WhatsApp style soft top fade ── */}
      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.3)', 'transparent']}
        style={[s.topScrim, { height: safeTop + 90 }]}
        pointerEvents="none"
      />

      {/* ── Bottom scrim: soft subtle fade ── */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)']}
        style={[s.bottomScrim, { height: bottomBarH + 20 }]}
        pointerEvents="none"
      />
      
      {/* ── Progress bars ── */}
      <View style={[s.progressRow, { top: safeTop + 6, opacity: 1 }]} pointerEvents="none">
        {statuses.map((_, i) => (
          <View key={i} style={[s.track, { backgroundColor: trackBg }]}>
            <Animated.View style={[s.trackFill, {
              backgroundColor: textColor,
              width: i < index ? '100%'
                : i === index
                  ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                  : '0%',
            }]} />
          </View>
        ))}
      </View>

      {/* ── Header ── */}
      <View style={[s.header, { top: safeTop + 18, opacity: 1 }]} pointerEvents="box-none">
        <View style={s.headerLeft}>
          <AvatarWithFallback
            uri={current.user_avatar}
            sticker={current.user_avatar_sticker}
            displayName={displayName}
            style={s.avatar}
          />
          <View style={{ marginLeft: 8 }}>
            <Text style={[s.headerName, { color: textColor, textShadowColor: shadowColor }]}>{displayName}</Text>
            <Text style={[s.headerTime, { color: secondaryColor, textShadowColor: shadowColor }]}>
              {new Date(current.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => isUploading ? handleCancelUpload() : navigation.goBack()} style={s.iconBtn}>
            <Icon name="close" size={26} color={textColor} style={[s.iconShadow, { textShadowColor: shadowColor }]} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.tapZones, { bottom: bottomBarH }]} pointerEvents="box-none">
        <TouchableWithoutFeedback onPress={() => handleTap('left')}>
          <View style={{ flex: 1 }} />
        </TouchableWithoutFeedback>
        <TouchableWithoutFeedback onPress={() => handleTap('right')}>
          <View style={{ flex: 2 }} />
        </TouchableWithoutFeedback>
      </View>

      {!!current.caption && !replyFocused && (
        <View 
          style={[
            s.captionWrap, 
            { 
              transform: [
                { translateX: current.caption_x || 0 },
                { translateY: current.caption_y || 0 },
                { scale: current.caption_scale || 1 },
                { rotate: `${((current.caption_rotation || 0) * 180) / Math.PI}deg` }
              ] 
            }
          ]} 
          pointerEvents="none"
        >
          <Text style={[s.caption, { textShadowColor: shadowColor }]}>{current.caption}</Text>
        </View>
      )}

      {!isUploading && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[s.kvWrapper, { opacity: 1 }]}
        >
          <View style={[s.bottomBar, { paddingBottom: safeBottom }]}>
            {isOwner ? (
              <>
                <TouchableOpacity
                  style={s.ownerActionBtn}
                  onPress={() => { stopProgress(); setSheetType('views'); setShowViewers(true); }}
                >
                  <Icon name="eye-outline" size={26} color={textColor} style={[s.iconShadow, { textShadowColor: shadowColor }]} />
                  <Text style={[s.ownerActionText, { color: textColor, textShadowColor: shadowColor }]}>{current.view_count}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.ownerLikesCenter}
                  onPress={() => { stopProgress(); setSheetType('likes'); setShowViewers(true); }}
                >
                  <Icon name="heart" size={24} color={textColor} style={[s.iconShadow, { textShadowColor: shadowColor }]} />
                  <Text style={[s.ownerActionText, { color: textColor, textShadowColor: shadowColor }]}>{(current as any).like_count ?? 0}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.ownerActionBtn}
                  onPress={handleDelete}
                >
                  <Icon name="trash-outline" size={24} color={textColor} style={[s.iconShadow, { textShadowColor: shadowColor }]} />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={s.likeBtn}
                  onPress={handleLike}
                  disabled={likeLoading}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon
                    name={liked ? 'heart' : 'heart-outline'}
                    size={28}
                    color={liked ? '#ff4d6d' : textColor}
                  />
                </TouchableOpacity>

                <View style={[s.replyWrap, { backgroundColor: inputBg, borderColor: borderCol }]}>
                  <TextInput
                    ref={replyRef}
                    style={[s.replyInput, { color: textColor }]}
                    placeholder={`Reply to ${current.username}…`}
                    placeholderTextColor={placeholderCol}
                    value={replyText}
                    onChangeText={setReplyText}
                    onFocus={() => setReplyFocused(true)}
                    onBlur={() => setReplyFocused(false)}
                    returnKeyType="send"
                    onSubmitEditing={handleSendReply}
                    maxLength={500}
                    blurOnSubmit={false}
                  />
                  <TouchableOpacity
                    style={[s.sendBtn, (!replyText.trim() || replySending) && { opacity: 0.4 }]}
                    onPress={handleSendReply}
                    disabled={!replyText.trim() || replySending}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    {replySending
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Icon name="send" size={16} color="#fff" />
                    }
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={s.saveBtn}
                  onPress={handleSave}
                  disabled={saving}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={textColor} />
                    : <Icon name="download-outline" size={26} color={textColor} />
                  }
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      )}

      {isUploading && (
        <View style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
        }}>
          <View style={{
            backgroundColor: 'rgba(30, 30, 30, 0.9)',
            borderRadius: 16,
            padding: 24,
            alignItems: 'center',
            width: W * 0.75,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.1)',
          }}>
            <ActivityIndicator size="large" color="#4597f5f6" style={{ marginBottom: 16 }} />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
              Uploading status
            </Text>
            <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 13, marginTop: 6, marginBottom: 20, textAlign: 'center' }}>
              Item {uploadIndex + 1} of {uploadQueue.length}
            </Text>
            <TouchableOpacity
              onPress={handleCancelUpload}
              style={{
                backgroundColor: 'rgba(255, 69, 58, 0.15)',
                borderWidth: 1,
                borderColor: 'rgb(255, 69, 58)',
                borderRadius: 20,
                paddingVertical: 10,
                paddingHorizontal: 24,
                width: '100%',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'rgb(255, 69, 58)', fontWeight: '700', fontSize: 14 }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isOwner && (
        <ViewerSheet
          statusId={current.id}
          type={sheetType}
          visible={showViewers}
          onClose={() => {
            setShowViewers(false);
            startProgress(isVideo ? videoDuration : PHOTO_DURATION);
          }}
        />
      )}
    </View>
  );
};

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  // Dynamic background for photo statuses: fully bright blurred cover image
  bgCoverPhoto: {
    opacity: 1.0,
  },
  // Top scrim — fades from dark at top to transparent
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  // Bottom scrim — fades from transparent to dark at bottom
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },

  progressRow: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 4, zIndex: 10 },
  track:       { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 1, overflow: 'hidden' },
  trackFill:   { height: '100%', backgroundColor: '#fff', borderRadius: 1 },
  header:        { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, zIndex: 10 },
  headerLeft:    { flexDirection: 'row', alignItems: 'center' },
  avatar:        { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  avatarFallback:{ backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  headerName:    { color: '#fff', fontWeight: '600', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  headerTime:    { color: 'rgba(255,255,255,0.85)', fontSize: 11, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  headerRight:   { flexDirection: 'row', alignItems: 'center' },
  iconBtn:       { padding: 8, marginLeft: 4 },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  tapZones: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row' },
  captionWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 100,
    padding: 40,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 120,
    minHeight: 120,
  },
  caption: { color: '#fff', fontSize: 24, fontWeight: 'bold', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  // kvWrapper sits on the absolute top layer (zIndex 999)
  kvWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 999 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, justifyContent: 'space-between' },
  ownerActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  ownerActionText: { color: '#fff', fontSize: 14, marginLeft: 6, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  ownerLikesCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeBtn:   { alignItems: 'center', minWidth: 36 },
  // WhatsApp translucent rounded input capsule
  replyWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', marginHorizontal: 12, paddingLeft: 14, paddingRight: 6, minHeight: 42 },
  replyInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 8, maxHeight: 80 },
  sendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4597f5f6', justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
  saveBtn: { alignItems: 'center', minWidth: 36 },
});

export default StatusViewerScreen;