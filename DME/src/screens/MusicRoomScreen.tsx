/**
 * MusicRoomScreen — COMPLETE & CORRECTED
 *
 * INCLUDES ALL FIXES:
 * 1. ✅ Play/Pause buttons work (properly implemented)
 * 2. ✅ Seek bar doesn't jump back (seekingRef prevents ticker updates during seek)
 * 3. ✅ Song selection: if playing → add to queue; if not playing → play new song
 * 4. ✅ Music continues playing when navigating to Discovery and back
 * 5. ✅ Back button: closes room and returns to previous screen (ChatList)
 * 6. ✅ After selecting multiple songs, back button goes to Discovery (not MusicRoom)
 * 7. ✅ Fullscreen rotation mode
 * 8. ✅ SEAMLESS BACKGROUND AUDIO: WebView always muted, TrackPlayer owns ALL audio
 *       — zero gap on minimize / lock screen / foreground return
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, ActivityIndicator,
  StatusBar, TextInput,
  Dimensions, Keyboard, Platform, ScrollView,
  KeyboardAvoidingView, Modal, BackHandler,
  Animated, PanResponder, DeviceEventEmitter, AppState,
} from 'react-native';
import DrivePlayer from '../components/DrivePlayer';
import YoutubePlayer from '../components/YoutubePlayer';
import TrackPlayerService from '../services/TrackPlayerService';
import TrackPlayer, { Event, PlaybackState } from '@rntp/player';
import Icon from 'react-native-vector-icons/Ionicons';
import { useMusicRoom, Song } from '../hooks/useMusicRoom';
import YouTubeDiscoveryScreen from './YouTubeDiscoveryScreen';
import { useAuth } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import api, { musicAPI } from '../services/api';
import InviteModal from '../components/InviteModal';
import AvatarWithFallback from '../components/AvatarWithFallback';
import RelatedVideosGrid from '../components/RelatedVideosGrid';
import musicWebSocketService from '../services/MusicWebSocketService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Orientation from 'react-native-orientation-locker';
import changeNavigationBarColor, { hideNavigationBar, showNavigationBar } from 'react-native-navigation-bar-color';
import { resolveImageUrl } from '../utils/image';
import { colors } from '../utils/theme';
import { API_BASE_URL } from '../config/network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import FullScreenMediaViewer from '../components/FullScreenMediaViewer';
import RichTextInput, { RichTextInputRef } from '../components/RichTextInput';
import StickerPreviewModal from '../components/StickerPreviewModal';
import FastImage from 'react-native-fast-image';

const { width, height } = Dimensions.get('window');
const VIDEO_HEIGHT = width * (9 / 16);

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────
const fmtTime = (s: number) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const fetchYouTubeMetadata = async (videoId: string, fallbackName?: string): Promise<Song> => {
  const base: Song = {
    videoId,
    title:        fallbackName ?? 'YouTube Video',
    thumbnail:    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    channelTitle: 'YouTube',
    addedBy:      fallbackName ?? 'Someone',
  };
  try {
    const resp = await api.post('/music/youtube/search/', {
      query:      `https://www.youtube.com/watch?v=${videoId}`,
      maxResults: 1,
    });
    if (resp.data?.items?.length > 0) {
      const item = resp.data.items[0];
      return {
        ...base,
        title:        item.snippet.title,
        thumbnail:    item.snippet.thumbnails.medium.url,
        channelTitle: item.snippet.channelTitle,
      };
    }
  } catch (e) {
    console.warn('🎵 Metadata fetch failed:', e);
  }
  return base;
};

// ─────────────────────────────────────────────────────────────────────────────
// VideoControls Component
// ─────────────────────────────────────────────────────────────────────────────
interface ControlsProps {
  visible: boolean;
  isPlaying: boolean;
  isEnded: boolean;
  canControl: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
}

const VideoControls: React.FC<ControlsProps> = ({
  visible, isPlaying, isEnded, canControl, isBuffering,
  position, duration,
  onPlayPause, onSeek, onNext, onToggleFullscreen,
}) => {
  const canControlRef = useRef(canControl);
  const durationRef = useRef(duration);

  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const opacity    = useRef(new Animated.Value(1)).current;
  const knobX      = useRef(new Animated.Value(0)).current;
  const isSeeking  = useRef(false);
  const seekTarget = useRef(0);
  const barLayoutX = useRef(0);
  const barWidth   = useRef(width - 32);
  const pct = duration > 0 ? Math.min(position / duration, 1) : 0;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue:         visible ? 1 : 0,
      duration:        200,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (!isSeeking.current) {
      knobX.setValue(pct * barWidth.current);
    }
  }, [pct]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      isSeeking.current = true;
      const nx = Math.max(0, Math.min(barWidth.current, evt.nativeEvent.locationX));
      knobX.setValue(nx);
      if (durationRef.current > 0 && barWidth.current > 0) {
        seekTarget.current = (nx / barWidth.current) * durationRef.current;
      } else {
        seekTarget.current = 0;
      }
    },

    onPanResponderMove: (evt) => {
      const touchX = evt.nativeEvent.pageX - barLayoutX.current;
      const nx = Math.max(0, Math.min(barWidth.current, touchX));
      knobX.setValue(nx);
      if (durationRef.current > 0 && barWidth.current > 0) {
        seekTarget.current = (nx / barWidth.current) * durationRef.current;
      }
    },

    onPanResponderRelease: () => {
      isSeeking.current = false;
      if (!canControlRef.current) {
        console.warn('📊 [DRAG DENIED] User is not DJ, cannot seek');
        return;
      }
      if (seekTarget.current < 0 || isNaN(seekTarget.current)) return;
      onSeek(seekTarget.current);
    },
  })).current;

  return (
    <Animated.View style={[cv.wrap, { opacity }]} pointerEvents={visible ? 'box-none' : 'none'}>
      <View style={[cv.scrimTop, { opacity: 0 }]} pointerEvents="none" />
      <View style={[cv.scrimBottom, { opacity: 0 }]} pointerEvents="none" />

      <TouchableOpacity style={cv.expandBtn} onPress={onToggleFullscreen}>
        <Icon name="expand" size={18} color="#fff" />
      </TouchableOpacity>

      {!isBuffering && !isEnded && (
        <TouchableOpacity
          style={[cv.centreBtn, { opacity: 0 }]}
          onPress={() => onPlayPause()}
          activeOpacity={0}
          disabled={!canControl}
        >
          <View style={[cv.centreBtnInner, !canControl && cv.centreBtnDisabled]}>
            <Icon
              name={isPlaying ? 'pause' : 'play'}
              size={32}
              color={canControl ? '#fff' : 'rgba(255,255,255,0.35)'}
              style={{ marginLeft: isPlaying ? 0 : 5 }}
            />
          </View>
        </TouchableOpacity>
      )}

      {isEnded && (
        <TouchableOpacity
          style={[cv.centreBtn, { position: 'absolute', zIndex: 1000, opacity: 0 }]}
          onPress={() => {}}
          disabled={!canControl}
        >
          <View style={cv.centreBtnInner}>
            <Icon name="refresh" size={32} color="#fff" />
          </View>
        </TouchableOpacity>
      )}

      <View style={cv.bottomBar}>
        <View
          {...pan.panHandlers}
          style={{ height: 30, justifyContent: 'center', marginBottom: 6 }}
          onLayout={(event) => {
            const { x, width: w } = event.nativeEvent.layout;
            barLayoutX.current = x;
            barWidth.current = w;
          }}
        >
          <View style={cv.track}>
            <View style={[cv.fill, { width: `${pct * 100}%` }]} />
            <Animated.View style={[cv.knob, { transform: [{ translateX: knobX }] }]} />
          </View>
        </View>
        <View style={cv.timeRow}>
          <Text style={cv.timeText}>{fmtTime(position)} / {fmtTime(duration)}</Text>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {!canControl && (
              <View style={cv.watchBadge}>
                <Icon name="eye-outline" size={11} color="rgba(255,255,255,0.5)" />
                <Text style={cv.watchText}>Watching</Text>
              </View>
            )}
            {canControl && (
              <TouchableOpacity onPress={onNext} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="play-skip-forward" size={20} color="rgba(255,255,255,0.85)" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const cv = StyleSheet.create({
  wrap:             { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  scrimTop:         { position: 'absolute', top: 0, left: 0, right: 0, height: 80, backgroundColor: 'transparent' },
  scrimBottom:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, backgroundColor: 'transparent' },
  expandBtn:        { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  bufferWrap:       { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  bufferText:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  centreBtn:        { width: 70, height: 70, justifyContent: 'center', alignItems: 'center' },
  centreBtnInner:   { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  centreBtnDisabled:{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.2)' },
  bottomBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 12 },
  track:            { height: 2, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 1, justifyContent: 'center' },
  fill:             { position: 'absolute', left: 0, height: 2, backgroundColor: '#fff', borderRadius: 1 },
  knob:             { position: 'absolute', top: -4, marginLeft: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  timeText:         { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },
  watchBadge:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  watchText:        { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ScaledImage
// ─────────────────────────────────────────────────────────────────────────────
const ScaledImage = ({ uri, style, resizeMode, isAnimated }: {
  uri: string | undefined,
  style?: any,
  resizeMode?: any,
  isAnimated?: boolean
}) => {
  const [dims, setDims] = useState({ width: 160, height: 120 });
  if (!uri) return null;
  const isGif = isAnimated ||
    uri.toLowerCase().includes('.gif') ||
    uri.toLowerCase().includes('.webp') ||
    uri.startsWith('content://');

  useEffect(() => {
    if (uri) {
      Image.getSize(uri, (w, h) => {
        const MAX_W = 160;
        let finalW = w;
        let finalH = h;
        if (w > MAX_W) {
          finalW = MAX_W;
          finalH = (h * MAX_W) / w;
        }
        setDims({ width: finalW, height: finalH });
      }, () => {});
    }
  }, [uri]);

  if (isGif) {
    return (
      <FastImage
        source={{ uri, priority: FastImage.priority.normal }}
        style={[style, { width: dims.width, height: dims.height }]}
        resizeMode={resizeMode === 'contain'
          ? FastImage.resizeMode.contain
          : FastImage.resizeMode.cover}
      />
    );
  }

  return (
    <Image
      key={uri}
      source={{ uri }}
      style={[style, { width: dims.width, height: dims.height }]}
      resizeMode={resizeMode}
      progressiveRenderingEnabled={false}
      fadeDuration={0}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main MusicRoomScreen
// ─────────────────────────────────────────────────────────────────────────────
const MusicRoomScreen = ({ route, navigation }: any) => {
  const { roomCode, isDJMode, initialVideoId, roomName: initialRoomName } = route.params;
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const chatListRef = useRef<FlatList>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToBottom = useCallback((animated = true) => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      chatListRef.current?.scrollToEnd({ animated });
    }, 150);
  }, []);

  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingState = useRef<boolean | null>(null);

  const handleTyping = useCallback((text: string) => {
    const isTyping = text.length > 0;

    if (isTyping) {
      if (!lastTypingState.current) {
        lastTypingState.current = true;
        musicWebSocketService.sendTyping(true);
      }

      if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
      typingIndicatorTimeout.current = setTimeout(() => {
        musicWebSocketService.sendTyping(false);
        lastTypingState.current = false;
      }, 3000);
    } else {
      if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
      lastTypingState.current = false;
      musicWebSocketService.sendTyping(false);
    }
  }, []);

  const handleTextChange = (text: string) => {
    setChatMessage(text);
    handleTyping(text);
  };

  // State management
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentRoomName, setCurrentRoomName] = useState(initialRoomName || '');
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isTrackPlayerReady, setIsTrackPlayerReady] = useState(false);
  const trackPlayerReadyTime = useRef(0);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [playerState, setPlayerState] = useState<string>('unstarted');
  const [chatMessage, setChatMessage] = useState('');
  const [inputClearKey, setInputClearKey] = useState(0);
  const [inputHeight, setInputHeight] = useState(40);
  const [preparingVideoId, setPreparingVideoId] = useState<string | null>(initialVideoId || null);
  const [isFirstCreation, setIsFirstCreation] = useState(!!initialVideoId);
  const [prepTime, setPrepTime] = useState(0);
  const [adFinished, setAdFinished] = useState(false);
  const [adStatus, setAdStatus] = useState('');
  const [roomNameInput, setRoomNameInput] = useState('');
  const [hasSubmittedName, setHasSubmittedName] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [duration, setDuration] = useState(0);
  const [livePosition, setLivePosition] = useState(0);
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat');
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<{url: string, type: 'image' | 'video'} | null>(null);
  const [pendingMedia, setPendingMedia] = useState<any | null>(null);
  const [isMediaModalVisible, setIsMediaModalVisible] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [stickerPreview, setStickerPreview] = useState<{uri: string; mimeType: string} | null>(null);
  const [isDJBackgrounded, setIsDJBackgrounded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const richInputRef = useRef<RichTextInputRef>(null);

  useEffect(() => {
    if (chatMessage === '') {
      richInputRef.current?.clear();
    }
  }, [chatMessage]);

  const checkLikeStatus = useCallback(async (videoId: string, source: string = 'youtube') => {
    try {
      const likes = await musicAPI.getLikes();
      const liked = likes.some((l: any) => l.video_id === videoId && l.source === source);
      setIsLiked(liked);
    } catch (e) {
      console.error('Error checking like status:', e);
    }
  }, []);

  const handleToggleLike = async () => {
    if (!currentSong?.videoId) return;
    try {
      const videoData = {
        video_id: currentSong.videoId,
        title: currentSong.title,
        thumbnail: currentSong.thumbnail,
        channel_title: currentSong.channelTitle,
        source: currentSong.source || 'youtube',
      };
      const res = await musicAPI.toggleLike(videoData);
      setIsLiked(res.liked);
      Toast.show({
        type: 'success',
        text1: res.liked ? 'Added to Likes' : 'Removed from Likes',
        position: 'bottom',
      });
    } catch (e) {
      console.error('Error toggling like:', e);
    }
  };

  const recordHistory = useCallback(async (song: Song) => {
    try {
      await musicAPI.recordWatchHistory({
        video_id: song.videoId,
        title: song.title,
        thumbnail: song.thumbnail,
        channel_title: song.channelTitle,
        source: song.source || 'youtube',
      });
    } catch (e) {
      console.error('Error recording history:', e);
    }
  }, []);

  // ✅ REMOVED: isNativePlaying state — TrackPlayer always runs, no toggling needed

  const sendPendingMedia = async () => {
    if (!pendingMedia) return;
    Keyboard.dismiss();
    await handleMediaSelection(pendingMedia);
    setPendingMedia(null);
  };

  const handleMediaSelection = async (asset: any) => {
    setIsSendingMedia(true);
    setIsMediaModalVisible(false);
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();

      const isGif =
        asset.uri.toLowerCase().endsWith('.gif') ||
        asset.uri.toLowerCase().endsWith('.webp') ||
        asset.type === 'image/gif' ||
        asset.type === 'image/webp' ||
        asset.fileName?.toLowerCase().endsWith('.gif') ||
        asset.fileName?.toLowerCase().endsWith('.webp');

      const messageType = isGif ? 'gif' : 'image';

      fd.append('media_file', {
        uri: asset.uri,
        type: asset.type || (isGif ? 'image/gif' : 'image/jpeg'),
        name: asset.fileName || `${messageType}_${Date.now()}.${isGif ? (asset.type === 'image/webp' ? 'webp' : 'gif') : 'jpg'}`,
      } as any);
      fd.append('room_code', roomCode);

      const res = await fetch(`${API_BASE_URL}/music/upload/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
      });

      if (res.ok) {
        const data = await res.json();
        musicWebSocketService.sendChatMessage('', replyingTo, data.url, messageType);
        setReplyingTo(null);
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      console.error('Media upload error:', e);
      Toast.show({ type: 'error', text1: 'Failed to send media' });
    } finally {
      setIsSendingMedia(false);
    }
  };

  const handleOpenGallery = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 1,
        selectionLimit: 1,
      });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setStickerPreview({
          uri: asset.uri || '',
          mimeType: asset.type || 'image/jpeg',
        });
      }
    } catch (e) {
      console.error('Gallery open error:', e);
    }
  };

  const lastTapTimeRef = useRef(0);
  const doubleTapTimeoutRef = useRef<any>(null);
  const doubleTapScale = useRef(new Animated.Value(0)).current;
  const doubleTapOpacity = useRef(new Animated.Value(0)).current;
  const [doubleTapReaction, setDoubleTapReaction] = useState({ visible: false, x: 0, y: 0 });
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<Song[]>([]);
  const [showRelated, setShowRelated] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [showRoomInfo, setShowRoomInfo] = useState(true);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      setShowRoomInfo(false);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setShowRoomInfo(true);
      if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
      lastTypingState.current = false;
      musicWebSocketService.sendTyping(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);


  const renderNpBar = () => {
    if (!currentSong) return null;
    return (
      <View style={s.npBar}>
        <Image source={{ uri: currentSong.thumbnail }} style={s.npThumb} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.npTitle} numberOfLines={1}>{currentSong.title}</Text>
          <Text style={s.npChannel} numberOfLines={1}>{currentSong.channelTitle}</Text>
        </View>
        <TouchableOpacity onPress={handleToggleLike} style={s.likeBtn}>
          <Icon 
            name={isLiked ? "heart" : "heart-outline"} 
            size={24} 
            color={isLiked ? "#FF3B30" : "rgba(255,255,255,0.6)"} 
          />
        </TouchableOpacity>
      </View>
    );
  };
  // ----------------------------


  useFocusEffect(
    React.useCallback(() => {
      try { changeNavigationBarColor('#000000', false); } catch (e) {}
      return () => {};
    }, [])
  );

  useEffect(() => {
    if (!showDiscovery) {
      const t = setTimeout(() => {
        try { changeNavigationBarColor('#000000', false); } catch (e) {}
      }, 300);
      return () => clearTimeout(t);
    } else {
      try { changeNavigationBarColor('#111111', false); } catch (e) {}
    }
  }, [showDiscovery]);

  useEffect(() => {
    if (fullscreen) {
      Orientation.lockToLandscape();
      StatusBar.setHidden(true);
      hideNavigationBar();
    } else {
      Orientation.lockToPortrait();
      StatusBar.setHidden(false);
      showNavigationBar();
    }
  }, [fullscreen]);

  useEffect(() => {
    return () => {
      Orientation.lockToPortrait();
      StatusBar.setHidden(false);
      // Stop audio when screen unmounts (leave room, back gesture, etc.)
      try { TrackPlayer.stop(); } catch (_) {}
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (typingIndicatorTimeout.current) {
        clearTimeout(typingIndicatorTimeout.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Refs
  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialized = useRef(false);
  const metadataLock = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const livePositionRef = useRef(0);
  const roomPositionRef = useRef(0);
  const isInBackgroundRef = useRef(false);
  const isDJBackgroundedRef = useRef(false);
  const djForegroundReturnTime = useRef<number>(0);
  const seekingRef = useRef(false);
  const isUserAction = useRef(false);
  const preloadedRef = useRef(false);
  const playerReadyTime = useRef(0);
  const isPlayerReadyRef = useRef(false);
  const joinSnapshotConsumed = useRef(false); // ✅ NEW
  const lastSnapVideoId = useRef<string | null>(null);
  const isAdPlayingRef = useRef(false);
  const masterDuration = useRef(0);
  const playingStartTime = useRef(0);

  const adSkipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realDurationLockedRef = useRef(false);
  const autoSkipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adMuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AppState refs for background/foreground position tracking
  const appState = useRef(AppState.currentState);
  const backgroundStartPosition = useRef<number>(0);
  const backgroundStartTime = useRef<number>(0);

  const { roomState, isConnected, isLoading, playerRef, loadSong, syncPlay, syncPause, syncSeek, addToQueue, passAux, updateCurrentSongMetadata, updateRoomName, joinSnapshot } = useMusicRoom(roomCode, user?.id ?? 0, isPlayerReadyRef, playerReadyTime, isAdPlayingRef, isDJBackgroundedRef);
  const { isDJ, currentSong, isPlaying, position, queue, participants, roomName } = roomState;

  // --- RE-IMPLEMENTED LOGIC ---
  useEffect(() => {
    if (currentSong?.videoId && isPlaying && isPlayerReady) {
      // Record history only after 5 seconds of playback to avoid spamming skips
      const timer = setTimeout(() => {
        recordHistory(currentSong);
      }, 5000);
      
      checkLikeStatus(currentSong.videoId, currentSong.source || 'youtube');
      
      return () => clearTimeout(timer);
    }
  }, [currentSong?.videoId, isPlaying, isPlayerReady]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO ENGINE — TrackPlayer owns ALL audio at ALL times
  // WebView is permanently muted (muted={true} in JSX below)
  // This is what makes background/foreground seamless with zero gap
  // ─────────────────────────────────────────────────────────────────────────

  // Initialize TrackPlayer once on mount
  useEffect(() => {
    TrackPlayerService.setupPlayer();
  }, []);

  // ✅ START/STOP TrackPlayer audio based on room play state
  // No hand-off, no switching — TrackPlayer simply always owns the audio
  // NOTE: ALL @rntp/player v5 APIs are synchronous (void) — no await needed
  useEffect(() => {
    console.log('🎵 [AUDIO EFFECT] fired:', {
      videoId: currentSong?.videoId,
      source: currentSong?.source,
      isPlaying,
      title: currentSong?.title,
    });

    if (!currentSong?.videoId || !isPlaying) {
      console.log('🎵 [AUDIO EFFECT] early return — no song or not playing');
      if (currentSong?.source !== 'drive') {
        try { TrackPlayer.pause(); } catch (_) {}
      }
      setIsTrackPlayerReady(false);
      return;
    }

    if (currentSong.source === 'drive') {
      console.log('🎵 [AUDIO EFFECT] Drive — unblocking player');
      setIsTrackPlayerReady(true);
      return;
    }

    // ── YouTube: load stream URL async, then hand off to sync TrackPlayer ──
    let cancelled = false;
    setIsTrackPlayerReady(false);

    const startAudio = async () => {
      try {
        // v5: getActiveMediaItem() is SYNCHRONOUS — no await
        const activeTrack = TrackPlayer.getActiveMediaItem();
        if (activeTrack?.mediaId !== currentSong.videoId) {
          console.log('🎵 [AUDIO] Loading new track:', currentSong.title);
          // playYouTubeVideo does an async fetch then calls sync TrackPlayer APIs
          await TrackPlayerService.playYouTubeVideo(
            currentSong.videoId,
            currentSong.title,
            currentSong.channelTitle || 'Music Room',
            currentSong.thumbnail,
            currentSong.source
          );
          if (!cancelled) {
            const pos = livePositionRef.current;
            if (pos > 0) {
              // v5: seekTo() is SYNCHRONOUS — no await
              TrackPlayer.seekTo(pos);
            }
            setIsTrackPlayerReady(true);
          }
        } else {
          // v5: isPlaying() is SYNCHRONOUS — no await
          const isPlayingNow = TrackPlayer.isPlaying();
          if (!isPlayingNow) {
            // v5: play() is SYNCHRONOUS — no await
            TrackPlayer.play();
          }
          if (!cancelled) setIsTrackPlayerReady(true);
        }
      } catch (e) {
        console.error('🎵 [AUDIO] Start error:', e);
        if (!cancelled) setIsTrackPlayerReady(true);
      }
    };

    startAudio();
    return () => { cancelled = true; };
  }, [currentSong?.videoId, currentSong?.source, isPlaying]);

  // ✅ NEW: Keep participant TrackPlayer in sync with room position
  // Fires when DJ broadcasts a sync update (position changes from WebSocket)
  // NOTE: ALL @rntp/player v5 APIs are synchronous — no await
  useEffect(() => {
    if (isDJ) return; // DJ manages their own position
    if (!isPlaying || !currentSong?.videoId) return;
    if (isDJBackgroundedRef.current) return; // ← KEY FIX: ignore syncs while DJ is backgrounded

    // ✅ Ignore syncs for 3s after DJ returns to foreground
    // DJ's first few broadcasts after waking up may still be stale
    if (djForegroundReturnTime.current > 0 &&
        Date.now() - djForegroundReturnTime.current < 3000) {
      console.log('📱 [PARTICIPANT SYNC] Skipping — DJ foreground cooldown');
      return;
    }

    const syncAudioToRoom = () => {
      try {
        // v5: getProgress() is SYNCHRONOUS — no await
        const progress = TrackPlayer.getProgress();
        const tpPosition = progress.position;
        const drift = Math.abs(tpPosition - position);

        // ✅ Raised threshold: 5s instead of 2s to avoid buffering-noise resyncs
        if (drift > 5) {
          console.log('🎵 [PARTICIPANT SYNC] Drift detected:', drift, '— resyncing');
          // v5: seekTo() is SYNCHRONOUS — no await
          TrackPlayer.seekTo(position);
          livePositionRef.current = position;
        }
      } catch (e) {}
    };

    syncAudioToRoom();
  }, [position, isDJ, isPlaying, currentSong?.videoId]);

  // ✅ NEW: Hybrid Perfect Sync Listener
  // 1. Gives WebView a head-start while audio buffers (150ms delay)
  // 2. Snaps video to exact audio position once playback starts for frame-accuracy
  // 3. Includes a 'retry' snap at 300ms to ensure it lands even on slow devices
  // 4. Guarded by lastSnapVideoId to only fire once per song (preventing resume jumps)
  useEffect(() => {
    let headStartTimeout: ReturnType<typeof setTimeout> | null = null;

    const sub = TrackPlayer.addEventListener(Event.PlaybackStateChanged, (event) => {
      if (event.state === PlaybackState.Buffering) {
        // Head-start: unblock WebView while audio buffers
        headStartTimeout = setTimeout(() => {
          setIsTrackPlayerReady(true);
        }, 150);

      } else if (event.state === PlaybackState.Ready) {
        // ✅ Cancel head-start timer if Ready (playing) fires before it completes
        if (headStartTimeout) {
          clearTimeout(headStartTimeout);
          headStartTimeout = null;
        }

        // v5: getActiveMediaItem() is SYNCHRONOUS — no await
        const activeTrack = TrackPlayer.getActiveMediaItem();
        
        // ✅ Only snap once per song to avoid visual jumps on manual pause/resume
        if (activeTrack?.mediaId && activeTrack.mediaId !== lastSnapVideoId.current) {
          lastSnapVideoId.current = activeTrack.mediaId;
          console.log('🎵 [SYNC] New track detected, starting sync sequence:', activeTrack.mediaId);
          
          // Ensure WebView is unblocked
          setIsTrackPlayerReady(true);

          // Pass 1: Quick snap (50ms)
          setTimeout(() => {
            // v5: getProgress() is SYNCHRONOUS — no await
            const progress = TrackPlayer.getProgress();
            const tpPosition = progress.position;
            if (playerRef.current && isPlayerReadyRef.current && tpPosition > 0.1) {
              playerRef.current.seekTo(tpPosition, true);
              livePositionRef.current = tpPosition;
              console.log('🎵 [SYNC] Pass 1 (50ms) snapped to:', tpPosition);
            }
          }, 50);

          // Pass 2: Retry snap (300ms) for stability on slow initializations
          setTimeout(() => {
            // v5: getProgress() is SYNCHRONOUS — no await
            const progress = TrackPlayer.getProgress();
            const tpPosition = progress.position;
            if (playerRef.current && isPlayerReadyRef.current && tpPosition > 0.1) {
              playerRef.current.seekTo(tpPosition, true);
              livePositionRef.current = tpPosition;
              console.log('🎵 [SYNC] Pass 2 (300ms) snapped to:', tpPosition);
            }
          }, 300);
        }
      } else if (event.state === PlaybackState.Ended || event.state === PlaybackState.Error) {
        if (headStartTimeout) {
          clearTimeout(headStartTimeout);
          headStartTimeout = null;
        }
        setIsTrackPlayerReady(false);
      }
    });

    return () => {
      sub.remove();
      if (headStartTimeout) clearTimeout(headStartTimeout);
    };
  }, []);

  // ✅ APPSTATE — seamless background/foreground transition
  // TrackPlayer keeps playing uninterrupted in the background (OS handles it).
  // On foreground return, we just snap the muted WebView to the correct timestamp.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      const prevState = appState.current;
      appState.current = nextState;

      if (nextState === 'background' && prevState === 'active') {
        isInBackgroundRef.current = true; // ✅ Mark as backgrounded
        backgroundStartPosition.current = livePositionRef.current;
        backgroundStartTime.current = Date.now();
        console.log('📱 [BG] Saved position:', backgroundStartPosition.current);

        // ✅ Tell participants DJ is backgrounded — they should keep playing
        if (isDJ || isDJMode) {
          musicWebSocketService.sendBackgroundState(true, livePositionRef.current);
        }

      } else if (nextState === 'active' && prevState === 'background') {
        isInBackgroundRef.current = false; // ✅ Back in foreground

        if (isDJ || isDJMode) {
          try {
            // v5: getProgress() is SYNCHRONOUS — no await
            const progress = TrackPlayer.getProgress();
            const actualPosition = progress.position;
            console.log('📱 [FG] TrackPlayer actual position:', actualPosition);

            livePositionRef.current = actualPosition;
            setLivePosition(actualPosition);

            // ✅ Tell participants DJ is back — resume sync
            musicWebSocketService.sendBackgroundState(false, actualPosition);
            syncPlay(actualPosition);

            // Snap the muted WebView to the correct time so video matches audio
            if (isPlaying && playerRef.current && isPlayerReadyRef.current) {
              playerRef.current.seekTo(actualPosition, true);
            }
          } catch (e) {
            // Fallback to elapsed calculation
            const elapsed = (Date.now() - backgroundStartTime.current) / 1000;
            const resumePosition = backgroundStartPosition.current + elapsed;
            
            livePositionRef.current = resumePosition;
            musicWebSocketService.sendBackgroundState(false, resumePosition);
            syncPlay(resumePosition);
            
            if (isPlaying && playerRef.current && isPlayerReadyRef.current) {
              playerRef.current.seekTo(resumePosition, true);
              setLivePosition(resumePosition);
            }
          }
        } else {
            // Participant side — snap WebView to where TrackPlayer is
            const elapsed = (Date.now() - backgroundStartTime.current) / 1000;
            const resumePosition = backgroundStartPosition.current + elapsed;
            if (isPlaying && playerRef.current && isPlayerReadyRef.current) {
              playerRef.current.seekTo(resumePosition, true);
              setLivePosition(resumePosition);
              livePositionRef.current = resumePosition;
            }
        }
      }
    });

    return () => subscription.remove();
  }, [isPlaying, isDJ, isDJMode, syncPlay]);

  // ─────────────────────────────────────────────────────────────────────────
  // Remaining effects (unchanged from original)
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    isAdPlayingRef.current = isAdPlaying;
  }, [isAdPlaying]);

  useEffect(() => {
    if (roomName) setCurrentRoomName(roomName);
  }, [roomName]);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    livePositionRef.current = livePosition;
  }, [livePosition]);

  useEffect(() => {
    if (currentSong?.videoId) {
      preloadedRef.current = false;
      joinSnapshotConsumed.current = false; // ✅ NEW: reset for each new song
    }
  }, [currentSong?.videoId]);

  const setActionWindow = (ms = 3000) => {
    isUserAction.current = true;
    setTimeout(() => { isUserAction.current = false; }, ms);
  };

  // Stable Position ticker — periodic sync for DJ only
  useEffect(() => {
    if (!isConnected || !currentSong) return;

    let durationSamples: number[] = [];
    let stableDuration: number | null = null;
    let lastCurrentTime = 0;

    const interval = setInterval(async () => {
      if (!isPlayerReadyRef.current || playerState === 'unstarted') return;

      try {
        const pos = await playerRef.current?.getCurrentTime();
        const dur = await playerRef.current?.getDuration();
        if (pos !== undefined && pos !== null) {
          setLivePosition(pos);
          livePositionRef.current = pos;
        }

        if (dur && dur > 0 && !stableDuration) {
          durationSamples.push(dur);
          if (durationSamples.length >= 3) {
            const avg = durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length;
            const maxDiff = Math.max(...durationSamples.map(v => Math.abs(v - avg)));
            if (maxDiff < 2) {
              stableDuration = avg;
              masterDuration.current = stableDuration;
              setDuration(stableDuration);
              playerRef.current?.setRealDuration(stableDuration);
            } else {
              durationSamples = durationSamples.slice(-3);
            }
          }
        }

        const isAdByTimeReset = (pos < 1 && lastCurrentTime > 10) ||
          (pos !== undefined && lastCurrentTime > 0 && pos < lastCurrentTime - 5);
        const isAdByDuration = (stableDuration && dur && Math.abs(dur - stableDuration) > 10);
        const isAd = isAdByTimeReset || isAdByDuration;

        if (isAd && !isAdPlayingRef.current) {
          isAdPlayingRef.current = true;
          setIsAdPlaying(true);
          playerRef.current?.fastForwardAd?.();
        } else if (!isAd && isAdPlayingRef.current) {
          isAdPlayingRef.current = false;
          setIsAdPlaying(false);
        }

        lastCurrentTime = pos;

        if (isDJ && isPlaying && !isAdPlayingRef.current && !seekingRef.current && !isUserAction.current && Math.floor(pos ?? 0) % 5 === 0) {
          syncPlay(pos ?? 0);
        }
      } catch (_) {}
    }, 500);

    return () => clearInterval(interval);
  }, [isConnected, isDJ, isPlaying, currentSong?.videoId, syncPlay, playerState, isPlayerReadyRef]);

  const handleSelectSong = useCallback(async (song: Song, forcePlay = false) => {
    const hasActiveVideo = !!currentSongRef.current?.videoId && playerState !== 'ended';

    if (forcePlay || (!hasActiveVideo && queue.length === 0)) {
      setIsPlayerReady(false);
      setIsBuffering(true);
      let richSong = song;
      if (!song.channelTitle || song.title === 'Loading...' || song.title === 'Initializing...') {
        richSong = await fetchYouTubeMetadata(song.videoId, song.addedBy ?? user?.display_name);
        richSong.addedBy = song.addedBy ?? user?.display_name;
      }
      setIsSyncing(true);
      loadSong(richSong, currentRoomName);
    } else {
      addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
    }
    Keyboard.dismiss();
  }, [isDJ, isDJMode, loadSong, addToQueue, user?.display_name, playerState, queue, currentRoomName]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('VIDEO_SELECTED', async (data) => {
      if (data.roomCode !== roomCode) return;

      // Wait for WebSocket to be connected (max 15s)
      const waitForConnection = () => new Promise<void>((resolve, reject) => {
        if (isConnected) { resolve(); return; }
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 100;
          if (isConnected) {
            clearInterval(interval);
            resolve();
          } else if (elapsed >= 15000) {
            clearInterval(interval);
            reject(new Error('WS timeout'));
          }
        }, 100);
      });

      try {
        await waitForConnection();
      } catch (e) {
        console.error('VIDEO_SELECTED: WS never connected');
        Toast.show({ type: 'error', text1: 'Connection failed, try again' });
        return;
      }

      // Now safe to load
      let song: Song;
      if (data.source === 'drive') {
        song = {
          videoId:      data.videoId,
          title:        data.title || 'Drive Video',
          thumbnail:    data.thumbnail || 'https://via.placeholder.com/150/1a1a2e/FFFFFF?text=Drive',
          channelTitle: 'Google Drive',
          addedBy:      user?.display_name || 'Someone',
          source:       'drive',
        };
      } else {
        song = await fetchYouTubeMetadata(data.videoId, user?.display_name);
        song.source = 'youtube';
      }

      handleSelectSong(song);
      setShowDiscovery(false);
      setIsFirstCreation(false);
    });

    return () => sub.remove();
  }, [roomCode, user?.display_name, handleSelectSong, isConnected]);

  useEffect(() => {
    if (isDJ && currentSong?.videoId && metadataLock.current !== currentSong.videoId &&
        (currentSong.title === 'Initializing...' || currentSong.title === 'Loading...' || !currentSong.channelTitle)) {
      const fetchMeta = async () => {
        try {
          metadataLock.current = currentSong.videoId;
          const fullSong = await fetchYouTubeMetadata(currentSong.videoId, user?.display_name);
          fullSong.addedBy = currentSong.addedBy ?? user?.display_name ?? 'Someone';
          if (metadataLock.current === currentSong.videoId) {
            updateCurrentSongMetadata(fullSong);
          }
        } catch (e) {
          console.warn('🎵 Metadata fetch failed:', e);
        }
      };
      fetchMeta();
    }
  }, [isDJ, currentSong?.videoId, currentSong?.title, user?.display_name, updateCurrentSongMetadata]);

  const showControlsFor = useCallback((ms = 3500) => {
    setShowControls(true);
    if (controlTimer.current) clearTimeout(controlTimer.current);
    if (isPlaying) {
      controlTimer.current = setTimeout(() => setShowControls(false), ms) as any;
    }
  }, [isPlaying]);

  useEffect(() => { showControlsFor(); }, [isPlaying, showControlsFor]);

  useEffect(() => {
    if (isDJMode && initialVideoId && isConnected && !hasInitialized.current) {
      setTimeout(() => {
        // Do NOT set hasInitialized here — let the Sync effect set it later!
        setIsSyncing(true);
        const song: Song = {
          videoId: initialVideoId,
          title: 'Initializing...',
          thumbnail: `https://img.youtube.com/vi/${initialVideoId}/mqdefault.jpg`,
          channelTitle: 'YouTube',
          addedBy: user?.display_name ?? 'You',
        };
        loadSong(song, currentRoomName);
      }, 500);
    }
  }, [isConnected, initialVideoId, isDJMode, loadSong, user?.display_name]);

  useEffect(() => {
    if (currentSong?.videoId) {
      metadataLock.current = null;
      setIsPlayerReady(false);
      setIsTrackPlayerReady(false); // ✅ Block WebView until audio is ready
      lastSnapVideoId.current = null; // ✅ Allow snap for new song
      setPlayerError(null);
      isPlayerReadyRef.current = false;
      playerReadyTime.current = 0;
      isAdPlayingRef.current = false;
      masterDuration.current = 0;
      playingStartTime.current = 0;
      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);
      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
      realDurationLockedRef.current = false;
      setIsBuffering(true);
      setLivePosition(0);
      setDuration(0);
      setShowRelated(false);
      hasInitialized.current = false;
    }
  }, [currentSong?.videoId]);

  useEffect(() => {
    return () => {
      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);
      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (isPlayerReady && isSyncing && isConnected) {
      hasInitialized.current = true;
      setIsSyncing(false);
      if (isDJMode || isDJ) {
        // ✅ DJ: Start playback upon ready
        setTimeout(() => syncPlay(0), 800);
      }
    }
  }, [isPlayerReady, isSyncing, isConnected, isDJMode, isDJ, syncPlay]);

  useEffect(() => {
    if (isPlayerReady && (isDJ || isDJMode) && currentSong && isPlaying && !isSyncing) {
      const timer = setInterval(() => {
        if (playerState === 'unstarted' || playerState === 'cued') {
          if (isPlayerReadyRef.current && !isAdPlayingRef.current) {
            playerRef.current?.seekTo(livePositionRef.current + 0.1, true);
            syncPlay(livePositionRef.current || 0);
          }
        }
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [isPlayerReady, isDJ, isDJMode, currentSong, isPlaying, isSyncing, playerState, syncPlay]);

  useEffect(() => {
    const backAction = () => {
      if (showDiscovery) { setShowDiscovery(false); return true; }
      if (fullscreen) { setFullscreen(false); return true; }
      setShowLeaveConfirm(true);
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => { backHandler.remove(); };
  }, [showDiscovery, fullscreen]);

  useEffect(() => {
    const unsubscribe = musicWebSocketService.onMessage((msg) => {
      if (msg.type === 'chat_message') {
        setMessages(prev => [...prev, msg.data]);
        scrollToBottom(true);
      } else if (msg.type === 'typing') {
        const { user_id, user_name, is_typing } = msg.data;
        console.log(`[FRONTEND TYPING] received user_id=${user_id} user_name=${user_name} is_typing=${is_typing} | myId=${user?.id}`);
        // Filter out own typing — use Number() for safe int comparison
        if (Number(user_id) === Number(user?.id)) {
          console.log('[FRONTEND TYPING] Filtered out (own typing)');
          return;
        }

        console.log('[FRONTEND TYPING] Calling setTypingUsers with:', user_name, is_typing);
        setTypingUsers(prev => {
          const arr = Array.isArray(prev) ? prev : [];
          const next = is_typing
            ? arr.includes(user_name) ? arr : [...arr, user_name]
            : arr.filter(u => u !== user_name);
          console.log('[FRONTEND TYPING] typingUsers:', next);
          return next;
        });

        if (is_typing) {
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUsers(prev => prev.filter(u => u !== user_name));
          }, 3000);
        }
      } else if (msg.type === 'reaction') {
        const { message_id, reaction, user: reactionUser } = msg.data;
        setMessages(prev => prev.map(m => {
          if (m.id === message_id) {
            const reactions = m.reactions || {};
            reactions[reactionUser] = reaction;
            return { ...m, reactions };
          }
          return m;
        }));
      } else if (msg.type === 'dj_background') {
        const isBackground = msg.data.is_background;
        setIsDJBackgrounded(isBackground);
        isDJBackgroundedRef.current = isBackground;
        
        // ✅ When DJ returns, set a 3s cooldown before participant resyncs
        if (!isBackground) {
          djForegroundReturnTime.current = Date.now();
        }
      }
    });
    return () => { unsubscribe?.(); };
  }, [user?.id]);

  useEffect(() => {
    if (!isPlayerReady || !currentSong) return;
    const t = setTimeout(async () => {
      try {
        const d = await playerRef.current?.getDuration();
        if (d && d > 0) setDuration(d);
      } catch (_) {}
    }, 2000);
    return () => clearTimeout(t);
  }, [isPlayerReady, currentSong?.videoId]);

  useEffect(() => {
    if (duration > 0 && isPlayerReady) {
      playerRef.current?.setRealDuration(duration);
    }
  }, [duration, isPlayerReady]);

  const fetchRelated = useCallback(async () => {
    try {
      const data = await musicAPI.getRelatedVideos(currentSongRef.current?.videoId || '');
      setRelatedVideos(data.items.map((item: any) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channelTitle: item.snippet.channelTitle,
      })));
      setTimeout(() => {
        setPlayerState(curr => {
          if (curr === 'ended') setShowRelated(true);
          return curr;
        });
      }, 3000);
    } catch (e) {
      console.error('Related videos fetch failed:', e);
    }
  }, []);

  const onPlayerStateChange = async (state: string) => {
    setPlayerState(state);

    if (state === 'playing') {
      if (playingStartTime.current === 0) playingStartTime.current = Date.now();
    } else {
      playingStartTime.current = 0;
    }

    if (state === 'buffering' || state === 'unstarted' || state === 'cued') setIsBuffering(true);
    else setIsBuffering(false);
    if (['unstarted', 'playing', 'paused', 'cued', 'buffering'].includes(state)) setIsPlayerReady(true);

    if (state === 'ended') {
      if (duration > 0) {
        if ((isDJ || isDJMode) && queue.length > 0) {
          setIsSyncing(true);
          passAux();
        } else {
          fetchRelated();
        }
      }
      return;
    }

    if (isUserAction.current || seekingRef.current) return;
    if (!isDJ && !isDJMode) return;
    
    // ✅ KEY FIX: Don't broadcast pause when DJ goes to background
    // WebView naturally pauses in background — this is NOT a user action
    if (isInBackgroundRef.current) {
      console.log('📱 [BG] Ignoring WebView state change while backgrounded:', state);
      return;
    }

    const currentTime = livePosition;
    if (state === 'playing' && !isPlaying) {
      syncPlay(currentTime);
    }
  };

  const handleNext = () => {
    if (!isDJ && !isDJMode) return;
    setActionWindow();
    if (queue.length === 0) {
      fetchRelated();
    } else {
      setIsSyncing(true);
      passAux();
    }
  };

  const handlePlayPause = async () => {
    if (!isDJ && !isDJMode) return;
    setActionWindow();
    showControlsFor(3500);
    try {
      const t = livePosition;
      if (isPlaying) {
        syncPause(t);
      } else {
        syncPlay(t);
      }
    } catch (e) {
      console.error('🎵 Play/Pause error:', e);
    }
  };

  const handleSeek = useCallback(async (t: number) => {
    if (isAdPlayingRef.current) return;

    setActionWindow(3000);

    if (seekingRef.current) return;
    seekingRef.current = true;

    try {
      if (t < 0 || isNaN(t)) return;
      if (!playerRef.current || typeof playerRef.current.seekTo !== 'function') return;

      const seekPromise = playerRef.current.seekTo(t, true);
      if (seekPromise) await seekPromise;

      setLivePosition(t);

      // ✅ Also seek TrackPlayer so audio stays in sync after a manual seek
      // v5: seekTo() is SYNCHRONOUS — no await
      TrackPlayer.seekTo(t);

      syncSeek(t);
    } catch (error) {
      console.error('🎯 [SEEK ERROR]', error);
    } finally {
      setTimeout(() => { seekingRef.current = false; }, 800);
    }
  }, [syncSeek]);

  const handlePress = (item: any, event: any) => {
    const now = Date.now();
    const { pageX, pageY } = event.nativeEvent;

    if (doubleTapTimeoutRef.current && now - doubleTapTimeoutRef.current < 300) {
      clearTimeout(doubleTapTimeoutRef.current as any);
      doubleTapTimeoutRef.current = null;
      handleDoubleTapReaction(item, pageX, pageY);
    } else {
      doubleTapTimeoutRef.current = now;
      setTimeout(() => {
        if (doubleTapTimeoutRef.current === now) {
          doubleTapTimeoutRef.current = null;
          handleMessagePress(item);
        }
      }, 300);
    }
  };

  const handleMessageLongPress = (item: any) => { setReplyingTo(item); };

  const handleDoubleTapReaction = (item: any, x: number = 0, y: number = 0) => {
    const reactionEmoji = user?.quick_reaction || '❤️';
    const myName = user?.display_name || user?.email;
    const currentReactions = item.reactions || {};
    const alreadyReacted = currentReactions[myName] === reactionEmoji;
    const emojiToSend = alreadyReacted ? '' : reactionEmoji;

    if (!alreadyReacted) {
      setDoubleTapReaction({ visible: true, x, y });
      doubleTapScale.setValue(0);
      doubleTapOpacity.setValue(0);

      Animated.sequence([
        Animated.parallel([
          Animated.timing(doubleTapScale, { toValue: 1.5, duration: 300, useNativeDriver: true }),
          Animated.timing(doubleTapOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        ]),
        Animated.timing(doubleTapScale, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(doubleTapOpacity, { toValue: 0, duration: 200, delay: 500, useNativeDriver: true }),
      ]).start(() => {
        setDoubleTapReaction({ visible: false, x: 0, y: 0 });
        doubleTapScale.setValue(0);
        doubleTapOpacity.setValue(0);
      });
    }

    if (item.id) musicWebSocketService.sendReaction(item.id, emojiToSend);
  };

  const handleMessagePress = (item: any) => {
    if (item.message_type === 'image' && item.message_type !== 'gif' && item.message_type !== 'sticker') {
      setFullScreenMedia({ url: item.media_url, type: 'image' });
    }
  };
const sendChatMessage = () => {
  if (!chatMessage.trim()) return;
  musicWebSocketService.sendChatMessage(chatMessage, replyingTo);
  setChatMessage('');
  setInputHeight(40);
  setInputClearKey(k => k + 1);
  setReplyingTo(null);

  if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
  lastTypingState.current = false;
  musicWebSocketService.sendTyping(false);
};

  const handleUpdateRoomName = () => {
    if (editedName.trim()) {
      updateRoomName(editedName.trim());
      setCurrentRoomName(editedName.trim());
    }
    setIsEditingName(false);
    Keyboard.dismiss();
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      try { changeNavigationBarColor('#000000', false); } catch (e) {}
    }
  }, [showLeaveConfirm]);

  const renderLeaveModal = () => {
    if (!showLeaveConfirm) return null;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowLeaveConfirm(false)}>
          <View style={s.confirmContent}>
            <Text style={s.confirmTitle}>Leave watch party?</Text>
            <View style={s.confirmButtons}>
              <TouchableOpacity style={[s.pillButton, s.cancelButton]} onPress={() => setShowLeaveConfirm(false)}>
                <Text style={s.buttonText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.pillButton, s.leaveButton]} onPress={() => {
                setShowLeaveConfirm(false);
                // v5: stop() is SYNCHRONOUS — no await
                try { TrackPlayer.stop(); } catch (e) {}
                navigation.goBack();
              }}>
                <Text style={s.buttonText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#8100D1" />
        <Text style={s.loadingText}>Joining room...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

      {/* IMMERSIVE BACKGROUND */}
      <View style={StyleSheet.absoluteFill}>
        {currentSong?.thumbnail ? (
          <Image source={{ uri: currentSong.thumbnail }} style={StyleSheet.absoluteFill} blurRadius={30} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.85)' }]} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.inner}
      >
        <View style={{ flex: 1, paddingTop: insets.top }}>
          {renderLeaveModal()}

          {/* HEADER */}
          {!fullscreen && !isKeyboardVisible && (
            <View style={s.header}>
              <TouchableOpacity onPress={() => setShowLeaveConfirm(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <View style={s.headerTitleContainer}>
                {isEditingName ? (
                  <TextInput
                    style={s.headerTitleInput}
                    value={editedName}
                    onChangeText={setEditedName}
                    onSubmitEditing={handleUpdateRoomName}
                    onBlur={handleUpdateRoomName}
                    autoFocus
                    maxLength={25}
                    placeholder="Room Name"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                  />
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      if (isDJ || isDJMode) {
                        setEditedName(currentRoomName);
                        setIsEditingName(true);
                      }
                    }}
                    style={s.headerTitleTouch}
                  >
                    <Text style={s.headerTitleText} numberOfLines={1}>{currentRoomName || roomCode}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={s.headerRight}>
                <TouchableOpacity onPress={() => setShowDiscovery(true)} style={s.headerIconBtn}>
                  <Icon name="search" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setInviteModalVisible(true)} style={s.headerIconBtn}>
                  <Icon name="person-add" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTab(activeTab === 'chat' ? 'queue' : 'chat')} style={s.headerIconBtn}>
                  <Icon name="list" size={22} color={activeTab === 'queue' ? '#8100D1' : '#fff'} />
                  {queue.length > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{queue.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* VIDEO */}
          <View style={fullscreen ? s.videoWrapFullscreen : s.videoWrap}>
            <View style={StyleSheet.absoluteFill} pointerEvents={currentSong?.source === 'drive' ? 'box-none' : 'none'}>
              {currentSong && currentSong.videoId && currentSong.title !== 'Initializing...' ? (
                
                // ─── Drive Video ───────────────────────────────────────────────
                currentSong.source === 'drive' ? (
                  <DrivePlayer
                    key={currentSong.videoId}
                    ref={playerRef}
                    fileId={currentSong.videoId}
                    play={isPlaying && !playerError && isPlayerReady}
                    muted={false}
                    onReady={() => {
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
                      playerReadyTime.current = Date.now();
                      setIsBuffering(false);
                      setIsTrackPlayerReady(true); // Drive doesn't use TrackPlayer
                    }}
                    onStateChange={onPlayerStateChange}
                    onProgress={(currentTime, dur) => {
                      if (dur > 0 && !isNaN(dur)) setDuration(dur);
                      if (!seekingRef.current) setLivePosition(currentTime);
                    }}
                    onError={() => {
                      setIsBuffering(false);
                      setPlayerError('unknown');
                    }}
                  />
                ) : (
                  // ─── YouTube Video ─────────────────────────────────────────
                  <YoutubePlayer
                    key={currentSong.videoId}
                    ref={playerRef}
                    videoId={currentSong.videoId}
                    play={isPlaying && !playerError && isPlayerReady && isTrackPlayerReady}
                    muted={true}
                    onReady={() => {
                      playerRef.current?.setVolume?.(0);
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
                      playerReadyTime.current = Date.now();
                      setIsBuffering(false);

                      if (!isDJ && !isDJMode && joinSnapshot && !joinSnapshotConsumed.current) {
                        joinSnapshotConsumed.current = true;
                        const snapshotTime = joinSnapshot.receivedAt;
                        const snapshotPosition = joinSnapshot.position;
                        setTimeout(() => {
                          const targetPosition = snapshotPosition +
                            ((Date.now() - snapshotTime) / 1000);
                          const safePosition = duration > 0
                            ? Math.min(targetPosition, duration - 2)
                            : targetPosition;
                          console.log('👋 [JOIN] Seeking to live position:', safePosition);
                          playerRef.current?.seekTo(safePosition, true);
                          // v5: seekTo() is SYNCHRONOUS — no await
                          try { TrackPlayer.seekTo(safePosition); } catch (_) {}
                        }, 2000);
                      }

                      setIsAdPlaying(true);
                      isAdPlayingRef.current = true;
                      realDurationLockedRef.current = false;

                      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
                      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);

                      adSkipIntervalRef.current = setInterval(async () => {
                        try {
                          const dur = await playerRef.current?.getDuration();
                          if (!dur || dur <= 0) return;

                          if (!realDurationLockedRef.current && masterDuration.current === 0) {
                            masterDuration.current = dur;
                            return;
                          }

                          const isAd = masterDuration.current > 0 &&
                            Math.abs(dur - masterDuration.current) > 10;

                          if (isAd) {
                            isAdPlayingRef.current = true;
                            setIsAdPlaying(true);
                            playerRef.current?.seekTo(0, true);
                          } else {
                            if (!realDurationLockedRef.current) {
                              realDurationLockedRef.current = true;
                              masterDuration.current = dur;
                              playerRef.current?.setRealDuration(dur);
                              setDuration(dur);
                            }
                            if (isAdPlayingRef.current) {
                              isAdPlayingRef.current = false;
                              setIsAdPlaying(false);
                            }
                          }
                        } catch (e) {}
                      }, 500);

                      adMuteTimer.current = setTimeout(() => {
                        if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
                        setIsAdPlaying(false);
                        isAdPlayingRef.current = false;
                      }, 20000);

                      setTimeout(async () => {
                        try {
                          const d = await playerRef.current?.getDuration();
                          if (d && d > 0) {
                            setDuration(d);
                            playerRef.current?.setRealDuration(d);
                          }
                        } catch (e) {}
                      }, 300);
                    }}
                    onAdStarted={() => { isAdPlayingRef.current = true; }}
                    onAdEnded={() => { isAdPlayingRef.current = false; }}
                    onStateChange={onPlayerStateChange}
                    onProgress={(currentTime, dur) => {
                      if (dur > 0 && !isNaN(dur)) setDuration(dur);
                      if (!seekingRef.current) setLivePosition(currentTime);
                    }}
                    onError={(error) => {
                      setIsBuffering(false);
                      if (error === 'embed_not_allowed' || error === 150 || error === 101) {
                        setPlayerError('embed_not_allowed');
                        if (autoSkipTimer.current) clearTimeout(autoSkipTimer.current);
                        autoSkipTimer.current = setTimeout(() => {
                          setPlayerError(curr => {
                            if (curr === 'embed_not_allowed') { handleNext(); return null; }
                            return curr;
                          });
                        }, 3000);
                      } else {
                        setPlayerError('unknown');
                      }
                    }}
                  />
                )

              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
                  {currentSong?.thumbnail && (
                    <Image source={{ uri: currentSong.thumbnail }} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} blurRadius={25} />
                  )}
                </View>
              )}
            </View>

            {/* Error overlay */}
            {playerError && (
              <View style={[StyleSheet.absoluteFill, {
                backgroundColor: 'rgba(0,0,0,0.92)',
                justifyContent: 'center', alignItems: 'center',
                gap: 12, padding: 24, zIndex: 999,
              }]}>
                <Icon name="ban-outline" size={48} color="#ff4444" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
                  {playerError === 'embed_not_allowed' ? 'This video cannot be played' : 'Playback error'}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' }}>
                  {playerError === 'embed_not_allowed'
                    ? 'The video owner has restricted playback outside YouTube'
                    : 'Something went wrong. Try another video.'}
                </Text>
                {(isDJ || isDJMode) && (
                  <TouchableOpacity
                    onPress={() => {
                      if (autoSkipTimer.current) clearTimeout(autoSkipTimer.current);
                      setPlayerError(null);
                      setShowDiscovery(true);
                    }}
                    style={{ marginTop: 8, backgroundColor: '#8100D1', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, elevation: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Pick Another Video</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Tap handler */}
            {!playerError && playerState !== 'ended' && (
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => showControlsFor()} />
              </View>
            )}

            <VideoControls
              visible={showControls && !playerError}
              isPlaying={isPlaying}
              isEnded={playerState === 'ended'}
              canControl={(isDJ || isDJMode) && isPlayerReady}
              isBuffering={isBuffering && !!currentSong}
              position={livePosition}
              duration={duration}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onNext={handleNext}
              onToggleFullscreen={() => setFullscreen(!fullscreen)}
            />

            {/* Persistent Replay Button */}
            {playerState === 'ended' && (
              <TouchableOpacity
                style={{ position: 'absolute', width: 100, height: 100, top: (VIDEO_HEIGHT / 2) - 50, left: (width / 2) - 50, zIndex: 1000 }}
                onPress={async () => {
                  if (currentSong) {
                    await handleSelectSong(currentSong, true);
                    playerRef.current?.seekTo(0, true);
                    syncPlay(0);
                  }
                }}
              />
            )}

            {/* Ad overlay — only for YouTube, Drive has no ads */}
            {isAdPlaying && !playerError && currentSong?.source !== 'drive' && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20, justifyContent: 'center', alignItems: 'center' }]}>
                {currentSong?.thumbnail && (
                  <Image source={{ uri: currentSong.thumbnail }} style={[StyleSheet.absoluteFill, { opacity: 0.15 }]} blurRadius={20} />
                )}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.8)' }]} />
              </View>
            )}

            {/* Related videos overlay — only for YouTube */}
            {showRelated && !fullscreen && currentSong?.source !== 'drive' && (
              <View style={s.relatedOverlay}>
                <RelatedVideosGrid
                  videos={relatedVideos}
                  onSelect={(song) => { setShowRelated(false); handleSelectSong(song); }}
                  onReplay={() => { if (currentSong) { setShowRelated(false); handleSelectSong(currentSong); } }}
                />
              </View>
            )}
          </View>

          {!fullscreen && (
            <View>
              <TouchableOpacity style={s.toggleBtn} onPress={() => setShowRoomInfo(!showRoomInfo)}>
                <Text style={s.toggleText}>{showRoomInfo ? 'Hide Room Info' : 'Show Info'}</Text>
                <Icon name={showRoomInfo ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>

              {showRoomInfo && (
                <>
                  {renderNpBar()}

                  <View style={s.participantsRow}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.participantsContent}>
                      {participants.map(p => (
                        <View key={p.user_id} style={s.participantItem}>
                          <AvatarWithFallback 
                            uri={p.avatar} 
                            displayName={p.name} 
                            sticker={p.avatar_sticker} 
                            style={s.pAvatar} 
                          />
                          {p.is_dj && (
                            <View style={{ position: 'absolute', top: -6, right: -4, zIndex: 10 }}>
                              <Icon name="star" size={16} color="#ffffff" />
                            </View>
                          )}
                        </View>
                      ))}
                      <TouchableOpacity style={s.addAvatar} onPress={() => setInviteModalVisible(true)}>
                        <Icon name="person-add-outline" size={16} color="#8100D1" />
                      </TouchableOpacity>
                    </ScrollView>
                  </View>
                </>
              )}
            </View>
          )}

          {!fullscreen && (
            <>
              {activeTab === 'chat' ? (
                <>
                  <FlatList
                    ref={chatListRef}
                    data={messages}
                    keyExtractor={(item, i) => item.id || i.toString()}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={() => scrollToBottom(true)}
                    onLayout={() => scrollToBottom(false)}
                    ListEmptyComponent={<Text style={s.emptyText}>No messages yet. Say hi! 👋</Text>}
                    renderItem={({ item, index }) => {
                      if (item.message_type === 'system') {
                        return (
                          <View style={s.systemMsgContainer}>
                            <Text style={s.systemMsgText}>{item.text}</Text>
                          </View>
                        );
                      }
                      const isMe = item.user === (user?.display_name || user?.email);
                      const prevMsg = index > 0 ? messages[index - 1] : null;
                      const showAvatar = !prevMsg || prevMsg.message_type === 'system' || prevMsg.user !== item.user;
                      const sender = participants.find(p => p.name === item.user);
                      const reactions = item.reactions ? Object.values(item.reactions) as string[] : [];
                      const isMedia = item.message_type === 'image' || item.message_type === 'gif' || item.message_type === 'sticker';
                      const isSticker = item.message_type === 'sticker';

                      return (
                        <View style={[s.bubble, isMe && s.bubbleMe]}>
                          {showAvatar && (
                            <View style={[
                              { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
                              isMe ? { justifyContent: 'flex-end' } : {}
                            ]}>
                              {!isMe && (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <View style={{ position: 'relative', marginRight: 8 }}>
                                    <AvatarWithFallback 
                                      uri={sender?.avatar} 
                                      displayName={item.user} 
                                      sticker={sender?.avatar_sticker} 
                                      style={s.messageAvatar} 
                                    />
                                    {sender?.is_dj && (
                                      <View style={{ position: 'absolute', top: -10, right: -4 }}>
                                        <Icon name="star" size={14} color="#FFD700" />
                                      </View>
                                    )}
                                  </View>
                                </View>
                              )}
                              {isMe && (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <View style={{ position: 'relative', marginLeft: 8 }}>
                                    <AvatarWithFallback 
                                      uri={user?.profile_picture}
                                      displayName={item.user}
                                      style={s.messageAvatar} 
                                    />
                                  </View>
                                </View>
                              )}
                            </View>
                          )}
                          <TouchableOpacity onPress={(e) => handlePress(item, e)} onLongPress={() => handleMessageLongPress(item)} activeOpacity={1}>
                            <View style={[
                              s.msgContainer,
                              isMe ? s.msgContainerMe : s.msgContainerThem,
                              isMedia && s.mediaMsgContainer,
                              isSticker && { backgroundColor: 'transparent' },
                              !isMe && !showAvatar && { marginLeft: 32 },
                            ]}>
                              {item.reply_to && (
                                <View style={s.replyBubble}>
                                  <Text style={s.replyUser}>{item.reply_to.user}</Text>
                                  <Text style={s.replyText} numberOfLines={1}>{item.reply_to.text}</Text>
                                </View>
                              )}
                              {isMedia ? (
                                <View style={{ position: 'relative' }}>
                                  <ScaledImage
                                    uri={resolveImageUrl(item.media_url)}
                                    isAnimated={item.message_type === 'gif' || item.message_type === 'sticker'}
                                    style={[
                                      isSticker ? s.stickerImage : s.messageImage,
                                      { backgroundColor: isSticker ? 'transparent' : 'rgba(255,255,255,0.05)' },
                                    ]}
                                    resizeMode="contain"
                                  />
                                  {item.message_type === 'image' &&
                                    !item.media_url.toLowerCase().includes('sticker') &&
                                    !item.media_url.toLowerCase().includes('gif') &&
                                    !item.media_url.toLowerCase().includes('webp') && (
                                    <View />
                                  )}
                                </View>
                              ) : (
                                <Text style={s.bubbleMsg}>{item.text}</Text>
                              )}
                              {reactions.filter(r => !!r).length > 0 && (
                                <View style={[s.reactionContainer, isMe ? s.reactionContainerMe : s.reactionContainerThem]}>
                                  <Text style={s.reactionEmoji}>{reactions.filter(r => !!r)[0]}</Text>
                                </View>
                              )}
                            </View>
                          </TouchableOpacity>
                        </View>
                      );
                    }}
                  />

                  {typingUsers.length > 0 && (
                    <View style={s.typingContainer}>
                      <Text style={s.typingText}>
                        {`${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'are' : 'is'} typing...`}
                      </Text>
                    </View>
                  )}

                  {replyingTo && (
                    <View style={s.replyBar}>
                      <View style={s.replyBarContent}>
                        <Icon name="arrow-undo-outline" size={16} color="#8100D1" />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={s.replyBarUser}>Replying to {replyingTo.user}</Text>
                          <Text style={s.replyBarText} numberOfLines={1}>{replyingTo.text}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setReplyingTo(null)}>
                          <Icon name="close-circle" size={20} color="rgba(255,255,255,0.4)" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <View style={s.chatBar}>
                    <TouchableOpacity style={s.plusBtn} onPress={handleOpenGallery}>
                      <Icon name="add" size={24} color="#8100D1" />
                    </TouchableOpacity>
                    <RichTextInput
                      key={inputClearKey}
                      ref={richInputRef}
                      style={[s.chatInput, { height: inputHeight }]}
                      autoFocus={inputClearKey > 0}
                      onChangeText={handleTextChange}
                      onContentSizeChange={(e) => {
                        const h = e.nativeEvent?.contentSize?.height;
                        if (h) setInputHeight(Math.max(40, Math.min(150, Math.ceil(h))));
                      }}
                      onSubmitEditing={sendChatMessage}
                      returnKeyType="send"
                      multiline
                      placeholder="Type a message..."
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      onContentCommitted={(event) => {
                        const { uri, mimeType } = event.nativeEvent;
                        Keyboard.dismiss();
                        setTimeout(() => { setStickerPreview({ uri, mimeType }); }, 100);
                      }}
                    />
                    <TouchableOpacity style={s.sendBtn} onPress={sendChatMessage} disabled={isSendingMedia}>
                      {isSendingMedia ? (
                        <ActivityIndicator size="small" color="#8100D1" />
                      ) : (
                        <Icon name="send" size={18} color="#8100D1" />
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={s.queueHeader}>
                    <Text style={s.queueTitle}>Up Next ({queue.length})</Text>
                    <TouchableOpacity onPress={() => setActiveTab('chat')} style={s.queueCloseBtn}>
                      <Icon name="close-circle" size={20} color="#fff" />
                      <Text style={s.queueCloseText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    data={queue}
                    keyExtractor={(_, i) => i.toString()}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 12 }}
                    ListEmptyComponent={<Text style={s.emptyText}>Queue is empty — use 🔍 to add songs</Text>}
                    renderItem={({ item, index }) => (
                      <View style={s.qRow}>
                        <Text style={s.qNum}>{index + 1}</Text>
                        <Image source={{ uri: item.thumbnail }} style={s.qThumb} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={s.qTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={s.qBy}>Added by {item.addedBy ?? item.channelTitle}</Text>
                        </View>
                        {(isDJ || isDJMode) && (
                          <TouchableOpacity onPress={() => handleSelectSong(item)}>
                            <Icon name="play-circle" size={26} color="#8100D1" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  />
                </View>
              )}
            </>
          )}
        </View>

        {/* DISCOVERY OVERLAY */}
        <Modal visible={showDiscovery} animationType="slide" onRequestClose={() => setShowDiscovery(false)}>
          <YouTubeDiscoveryScreen
            navigation={{ goBack: () => setShowDiscovery(false) } as any}
            route={{ params: { roomCode } } as any}
          />
        </Modal>

        {/* STICKER PREVIEW MODAL */}
        <StickerPreviewModal
          visible={!!stickerPreview}
          mediaUri={stickerPreview?.uri ?? ''}
          mimeType={stickerPreview?.mimeType ?? ''}
          onClose={() => setStickerPreview(null)}
          onSend={async (uri, mimeType, caption) => {
            setStickerPreview(null);
            const ext = mimeType.split('/')[1] || 'png';
            await handleMediaSelection({
              uri,
              type: mimeType,
              fileName: `sticker_${Date.now()}.${ext}`,
            });
            if (caption.trim()) {
              musicWebSocketService.sendChatMessage(caption, replyingTo);
            }
          }}
        />

        <InviteModal
          visible={inviteModalVisible}
          onClose={() => setInviteModalVisible(false)}
          roomCode={roomCode}
          videoId={currentSong?.videoId}
        />

        {doubleTapReaction.visible && (
          <View style={s.doubleTapOverlay}>
            <Animated.View style={[
              s.doubleTapReaction,
              { top: doubleTapReaction.y, left: doubleTapReaction.x, transform: [{ scale: doubleTapScale }], opacity: doubleTapOpacity },
            ]}>
              <Text style={s.doubleTapHeart}>{user?.quick_reaction || '❤️'}</Text>
            </Animated.View>
          </View>
        )}

        {fullScreenMedia && (
          <FullScreenMediaViewer
            mediaUrl={fullScreenMedia.url}
            mediaType={fullScreenMedia.type}
            onClose={() => setFullScreenMedia(null)}
          />
        )}

      </KeyboardAvoidingView>
    </View>
  );
};

// Styles
const s = StyleSheet.create({
  relatedOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 15 },
  root:              { flex: 1, backgroundColor: '#000' },
  inner:             { flex: 1, backgroundColor: '#000' },
  loadingContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:       { color: '#fff', marginTop: 12 },
  header:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  headerRight:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn:     { padding: 6, position: 'relative' },
  badge:             { position: 'absolute', top: 2, right: 2, backgroundColor: '#8100D1', borderRadius: 9, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#000', paddingHorizontal: 2 },
  badgeText:         { color: '#fff', fontSize: 9, fontWeight: '800' },
  headerTitleContainer: { flex: 1, flexDirection: 'row', gap: 8, marginHorizontal: 8 },
  headerTitleTouch:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 5 },
  headerTitleInput:  { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#8100D1', padding: 0, minWidth: 100 },
  headerTitleText:   { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  dot:               { width: 6, height: 6, borderRadius: 3 },
  videoWrap:         { width, height: VIDEO_HEIGHT, backgroundColor: '#000', position: 'relative' },
  videoWrapFullscreen: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 99 },
  npBar:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#0D0D0D', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  npThumb:           { width: 50, height: 28, borderRadius: 3 },
  npThumbEmpty:      { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' },
  npTitle:           { color: '#fff', fontSize: 13, fontWeight: '700' },
  npChannel:         { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  likeBtn:           { padding: 4, marginLeft: 8 },
  djBadge:           { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(129,0,209,0.1)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 0.5, borderColor: 'rgba(129,0,209,0.3)' },
  djBadgeText:       { color: '#8100D1', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  participantsRow:   { backgroundColor: 'rgba(0,0,0,0.5)', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.03)' },
  participantsContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  participantItem:   { position: 'relative' },
  pAvatar:           { width: 38, height: 38, borderRadius: 19, borderWidth: 0.5, borderColor: '#ffffff', overflow: 'hidden' },
  messageAvatar:     { width: 32, height: 32, borderRadius: 16, borderWidth: 0.5, borderColor: '#ffffff' },
  djDot:             { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#8100D1', borderWidth: 1, borderColor: '#cc00ff' },
  addAvatar:         { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgb(0, 0, 0)', borderWidth: 0.5, borderColor: '#ffffff', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  queueHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.3)' },
  queueTitle:        { color: '#fff', fontSize: 14, fontWeight: '700' },
  queueCloseBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  queueCloseText:    { color: '#fff', fontSize: 12, fontWeight: '600' },
  emptyText:         { color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 30, fontSize: 13 },
  bubble:            { marginBottom: 12, maxWidth: '85%', alignSelf: 'flex-start', position: 'relative', flexDirection: 'row', alignItems: 'flex-start' },
  bubbleMe:          { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubbleUser:        { color: '#8100D1', fontWeight: '700', fontSize: 11, marginBottom: 2, marginLeft: 4 },
  msgContainer:      { paddingHorizontal: 8, paddingVertical: 8, paddingBottom: 10, borderRadius: 18, position: 'relative' },
  msgContainerThem:  { borderTopLeftRadius: 4 },
  msgContainerMe:    { borderTopRightRadius: 4 },
  bubbleMsg:         { color: '#fff', fontSize: 13 },
  replyBubble:       { padding: 4, borderRadius: 8, marginBottom: 2, borderLeftWidth: 3, borderLeftColor: '#8100D1' },
  replyUser:         { color: '#8100D1', fontSize: 10, fontWeight: '700' },
  replyText:         { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  reactionContainer: { 
    marginTop: 0,
    alignSelf: 'flex-start',
    padding: 2, 
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#000'
  },
  reactionContainerThem: { alignSelf: 'flex-start' },
  reactionContainerMe: { alignSelf: 'flex-end' },
  reactionEmoji:     { fontSize: 12 },
  replyBar:          { backgroundColor: '#111', borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)' },
  replyBarContent:   { flexDirection: 'row', alignItems: 'center', padding: 10 },
  replyBarUser:      { color: '#8100D1', fontSize: 12, fontWeight: '700' },
  replyBarText:      { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  doubleTapOverlay:  { ...StyleSheet.absoluteFillObject, zIndex: 9999, pointerEvents: 'none' },
  doubleTapReaction: { position: 'absolute', width: 50, height: 50, marginLeft: -25, marginTop: -25, justifyContent: 'center', alignItems: 'center' },
  doubleTapHeart:    { fontSize: 40, textAlign: 'center' },
  chatBar:           { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.07)', gap: 10, backgroundColor: '#000' },
  chatInput:         { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 10 : 8, minHeight: 40, maxHeight: 150, color: '#fff', fontSize: 14, textAlignVertical: 'top' },
  sendBtn:           { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(129,0,209,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  plusBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  mediaMsgContainer: { padding: 0, borderRadius: 12, overflow: 'hidden' },
  messageImage:      { width: width * 0.4, height: width * 0.3, borderRadius: 12 },
  stickerImage:      { width: width * 0.22, height: width * 0.22 },
  qRow:              { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  qNum:              { color: 'rgba(255,255,255,0.2)', fontSize: 11, width: 18 },
  qThumb:            { width: 68, height: 38, borderRadius: 4, backgroundColor: '#1a1a1a' },
  qTitle:            { color: '#e0e0e0', fontSize: 13 },
  qBy:               { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2 },
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  confirmContent:    { backgroundColor: '#1A1A1A', padding: 25, borderRadius: 25, width: '80%', alignItems: 'center' },
  confirmTitle:      { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 25 },
  confirmButtons:    { flexDirection: 'row', gap: 15, width: '100%' },
  pillButton:        { flex: 1, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center' },
  cancelButton:      { backgroundColor: '#333' },
  leaveButton:       { backgroundColor: '#8100D1' },
  buttonText:        { color: '#fff', fontWeight: 'bold' },
  previewContainer:  { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#111', borderTopWidth: 1, borderColor: '#333' },
  previewImage:      { width: 60, height: 60, borderRadius: 8 },
  sendPendingBtn:    { marginLeft: 'auto', backgroundColor: '#8100D1', padding: 10, borderRadius: 20 },
  closePendingBtn:   { marginLeft: 10, backgroundColor: '#333', padding: 5, borderRadius: 15 },
  syncOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  syncText:          { marginTop: 20, color: '#8100D1', fontSize: 15, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  coverOverlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  coverContent:      { alignItems: 'center', gap: 15 },
  coverText:         { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  toggleBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.5)', gap: 5 },
  toggleText:        { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  systemMsgContainer: { alignSelf: 'center', marginVertical: 8, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 16, paddingVertical: 4, borderRadius: 12 },
  systemMsgText:     { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontStyle: 'italic' },
  typingContainer:    { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: 'transparent' },
  typingText:         { color: '#fff', fontSize: 12, fontStyle: 'italic' },
});

export default MusicRoomScreen;
