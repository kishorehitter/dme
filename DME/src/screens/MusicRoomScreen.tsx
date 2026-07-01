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

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback,
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
import { startMusicService, updateMusicService, stopMusicService } from '../services/MusicServiceBridge';
import Icon from 'react-native-vector-icons/Ionicons';
import { useMusicRoom, Song, QueueItem } from '../hooks/useMusicRoom';
import YouTubeDiscoveryScreen from './YouTubeDiscoveryScreen';
import { useAuth } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { useCall } from '../context/CallContext';
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
  onShowRelated: () => void;
  isFullscreen: boolean;
  isDrivePlayer?: boolean;
}

const VideoControls: React.FC<ControlsProps> = ({
  visible, isPlaying, isEnded, canControl, isBuffering,
  position, duration,
  onPlayPause, onSeek, onNext, onToggleFullscreen, onShowRelated, isFullscreen,
  isDrivePlayer,
}) => {
  const canControlRef = useRef(canControl);
  const durationRef = useRef(duration);

  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const opacity    = useRef(new Animated.Value(1)).current;
  const knobX      = useRef(new Animated.Value(0)).current;
  // Independent from `opacity` — drives the track's thumb/expanded-height
  // reveal. In non-fullscreen mode the thin progress line must stay
  // visible even while `opacity` fades the rest of the controls out, so
  // it needs its own animated value rather than sharing `opacity`.
  const trackExpand = useRef(new Animated.Value(0)).current;
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
    if (!isFullscreen) {
      Animated.timing(trackExpand, {
        toValue:         visible ? 1 : 0,
        duration:        200,
        useNativeDriver: false, // animates height, which native driver can't handle
      }).start();
    }
  }, [visible, isFullscreen]);

  useEffect(() => {
    if (!isSeeking.current) {
      const rawX = pct * barWidth.current;
      const clampedX = Math.max(5, Math.min(Math.max(5, barWidth.current - 5), rawX));
      knobX.setValue(clampedX);
    }
  }, [pct]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      isSeeking.current = true;
      const rawX = Math.max(0, Math.min(barWidth.current, evt.nativeEvent.locationX));
      const clampedX = Math.max(5, Math.min(Math.max(5, barWidth.current - 5), rawX));
      knobX.setValue(clampedX);
      if (durationRef.current > 0 && barWidth.current > 0) {
        seekTarget.current = (rawX / barWidth.current) * durationRef.current;
      } else {
        seekTarget.current = 0;
      }
    },

    onPanResponderMove: (evt) => {
      const touchX = evt.nativeEvent.pageX - barLayoutX.current;
      const rawX = Math.max(0, Math.min(barWidth.current, touchX));
      const clampedX = Math.max(5, Math.min(Math.max(5, barWidth.current - 5), rawX));
      knobX.setValue(clampedX);
      if (durationRef.current > 0 && barWidth.current > 0) {
        seekTarget.current = (rawX / barWidth.current) * durationRef.current;
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
    <Animated.View style={[cv.wrap, { opacity: isFullscreen ? opacity : 1 }]} pointerEvents={(visible || !isFullscreen) ? 'box-none' : 'none'}>
      <View style={[cv.scrimTop, { opacity: 0 }]} pointerEvents="none" />
      <View style={[cv.scrimBottom, { opacity: 0 }]} pointerEvents="none" />

      <Animated.View style={[{ position: 'absolute', top: 2, left: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
        <TouchableOpacity style={cv.relatedBtn} onPress={onShowRelated}>
          <Icon name="layers-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', top: 2, right: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
        <TouchableOpacity style={cv.expandBtn} onPress={onToggleFullscreen}>
          <Icon name="expand" size={18} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      {isDrivePlayer && !isBuffering && !isEnded && (
        <Animated.View
          style={[cv.centreBtn, { opacity }]}
          pointerEvents={visible ? 'auto' : 'none'}
        >
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => onPlayPause()}
            activeOpacity={0.7}
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
        </Animated.View>
      )}

      {!isDrivePlayer && !isBuffering && !isEnded && (
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

      {isFullscreen ? (
        // ── FULLSCREEN: unchanged from the original behavior — entire
        // bar (track + time row) only appears on tap, governed by the
        // same `opacity` as play/pause/skip/expand, positioned exactly
        // where it has always sat (above the bottom, with its existing
        // padding) — not pinned to bottom:0.
        <View style={[cv.bottomBar, { paddingHorizontal: 0, paddingBottom: 0 }]}>
          <View style={[cv.timeRow, { paddingHorizontal: 16, marginBottom: 8 }]}>
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
          <View
            {...pan.panHandlers}
            style={{ height: 24, justifyContent: 'flex-end', paddingHorizontal: 0 }}
            onLayout={(event) => {
              const { x, width: w } = event.nativeEvent.layout;
              barLayoutX.current = x;
              barWidth.current = w;
            }}
          >
            <View style={[cv.track, { borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <View style={[cv.fill, { width: `${pct * 100}%`, borderRadius: 0 }]} />
              <Animated.View style={[cv.knob, { transform: [{ translateX: knobX }], bottom: -3, top: undefined }]} />
            </View>
          </View>
        </View>
      ) : (
        // ── NON-FULLSCREEN: YouTube-style. Time/skip row fades in/out
        // with the rest of the controls (shares `opacity`). The thin
        // progress line below it is ALWAYS visible — pinned flush to the
        // video's absolute bottom edge, full width, no padding — and only
        // its thumb + taller interactive hit area expand on tap, via the
        // independent `trackExpand` value so it never disappears with the
        // rest of the controls.
        <>
          <Animated.View style={[cv.timeRow, cv.timeRowFloating, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
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
          </Animated.View>

          <View
            {...pan.panHandlers}
            style={cv.bottomEdgeTrackHit}
            onLayout={(event) => {
              const { x, width: w } = event.nativeEvent.layout;
              barLayoutX.current = x;
              barWidth.current = w;
            }}
          >
            <Animated.View
              style={[
                cv.bottomEdgeTrack,
                {
                  height: trackExpand.interpolate({ inputRange: [0, 1], outputRange: [2, 4] }),
                },
              ]}
            >
              <View style={[cv.fill, { width: `${pct * 100}%` }]} />
              <Animated.View
                style={[
                  cv.knob,
                  {
                    opacity: trackExpand,
                    transform: [{ translateX: knobX }],
                  },
                ]}
              />
            </Animated.View>
          </View>
        </>
      )}
    </Animated.View>
  );
};

const cv = StyleSheet.create({
  wrap:             { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  scrimTop:         { position: 'absolute', top: 0, left: 0, right: 0, height: 80, backgroundColor: 'transparent' },
  scrimBottom:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, backgroundColor: 'transparent' },
  expandBtn:        { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  relatedBtn:       { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  bufferWrap:       { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  bufferText:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  centreBtn:        { width: 70, height: 70, justifyContent: 'center', alignItems: 'center' },
  centreBtnInner:   { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  centreBtnDisabled:{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.2)' },
  bottomBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 12 },
  // ── Non-fullscreen, always-visible bottom-edge progress line ──
  bottomEdgeTrackHit: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24, // generous invisible drag area
    justifyContent: 'flex-end', // Aligns the line flush to the absolute bottom edge
  },
  bottomEdgeTrack: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
  },
  timeRowFloating: {
    position: 'absolute',
    left: 2,
    right: 8,
    bottom: 4, // slightly lower — closer to the always-visible progress track
  },
  track:            { height: 2, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 1, justifyContent: 'center' },
  fill:             { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#c4c4c4', borderRadius: 1 },
  knob:             { position: 'absolute', top: -2, marginLeft: -5, width: 6, height: 6, borderRadius: 6, backgroundColor: '#fff' },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  timeText:         { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700' },
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
const MusicRoomScreen = ({ route, navigation, isMinimized }: any) => {
  // ✅ AUDIO DELAY OFFSET (in seconds)
  // Adjust this value to calibrate audio-to-video alignment (lip-sync).
  // Negative values delay the video player to match audio lag (e.g., Bluetooth).
  // Try values between -0.10 (100ms) and -0.20 (200ms) for typical Bluetooth devices.
  const AUDIO_VIDEO_OFFSET = -0.30;

  const { roomCode, isDJMode, initialVideoId, initialSource, initialTitle, initialThumbnail, roomName: initialRoomName } = route.params || {};
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  
  // Calculate initial position from background cache on mount
  const cachedRoomState = musicWebSocketService.getLastRoomState();
  const initialRoomPosition = (cachedRoomState && musicWebSocketService.getCurrentRoomCode() === roomCode) ? (cachedRoomState.position || 0) : 0;

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
  const [livePosition, setLivePosition] = useState(initialRoomPosition);
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat');
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<{url: string, type: 'image' | 'video'} | null>(null);
  const [pendingMedia, setPendingMedia] = useState<any | null>(null);
  const [isMediaModalVisible, setIsMediaModalVisible] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [stickerPreview, setStickerPreview] = useState<{uri: string; mimeType: string} | null>(null);
  const [isDJBackgrounded, setIsDJBackgrounded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  // ✅ NEW: bumped by an explicit replay action to force the audio load
  // effect to re-run even when currentSong?.videoId is unchanged (replaying
  // the SAME video). Distinct from videoId itself so normal playback,
  // seeking, and sync never accidentally trigger a reload — only an
  // explicit user replay does.
  const [audioReloadToken, setAudioReloadToken] = useState(0);
  // Guards the rendezvous's compensating delay against a stale callback
  // firing if the effect re-runs (new song, etc.) before the delay elapses.
  const rendezvousTokenRef = useRef(0);
  // ✅ NEW: single source of truth for "both audio (TrackPlayer) and video
  // (YoutubePlayer/DrivePlayer) are ready AND aligned at the same position,
  // safe to reveal the real frame to the user." Until this is true, the UI
  // shows pure black + spinner — no thumbnail, no peeking at a half-loaded
  // or unsynced frame. This replaces:
  //   - the old "isPlayerReady && isTrackPlayerReady" play-prop gate, which
  //     let audio actually start (TrackPlayer.play() inside
  //     playYouTubeVideo()) independently of this gate, causing audio to
  //     start before video.
  //   - the ad-overlay's translucent thumbnail flicker, which sat on top of
  //     the live WebView while ad-detection ran.
  const [mediaFullySynced, setMediaFullySynced] = useState(false);
  // True while we are actively re-establishing sync after a seek — video
  // is held paused+spinner, audio is the "anchor" we wait on.
  const [isReseeking, setIsReseeking] = useState(false);
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
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  // ✅ Single related-videos panel state. Opened either via the top-left
  // icon button (available anytime, anyone — DJ or participant) or
  // automatically when the video ends (existing behavior). Shows queue +
  // fresh suggestions only — no PIP, no current-song display, per spec.
  const [showRelated, setShowRelated] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [showRoomInfo, setShowRoomInfo] = useState(true);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [roomScreenReady, setRoomScreenReady] = useState(false);
  const roomRevealedOnceRef = useRef(false);


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

  useLayoutEffect(() => {
    try { changeNavigationBarColor('#000000', false, false); } catch (e) {}
  }, []);
  // ⚡ Set nav bar to black synchronously before the first paint so Android
  // never shows a white flash when the music screen opens.
  useLayoutEffect(() => {
    if (!showDiscovery) {
      try { changeNavigationBarColor('#000000', false, false); } catch (e) {}
    } else {
      try { changeNavigationBarColor('#111111', false, false); } catch (e) {}
    }
  }, [showDiscovery]);

  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (fullscreen) {
      wasFullscreen.current = true;
      Orientation.lockToLandscape();
      StatusBar.setHidden(true);
      hideNavigationBar();
    } else {
      Orientation.lockToPortrait();
      StatusBar.setHidden(false);
      
      // Only call showNavigationBar if we are actually exiting a fullscreen state.
      // Calling it on initial mount forces the OS to redraw the bar and flashes it white.
      if (wasFullscreen.current) {
        showNavigationBar();
        setTimeout(() => {
          try { changeNavigationBarColor('#000000', false, false); } catch (e) {}
        }, 100);
      }
    }
  }, [fullscreen]);

  useEffect(() => {
    return () => {
      Orientation.lockToPortrait();
      StatusBar.setHidden(false);
      try { changeNavigationBarColor('#FFFFFF', true, false); } catch (e) {}
      
      if (!(global as any).keepMusicRoomAlive) {
        try { TrackPlayerService.endSession(); } catch (_) {}
        stopMusicService();
        loadedAudioSessionRef.current = null;
        (global as any).loadedAudioSessionId = null;
        (global as any).activeMusicRoomCode = null;
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (typingIndicatorTimeout.current) {
        clearTimeout(typingIndicatorTimeout.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (seekPollRef.current) clearInterval(seekPollRef.current);
    };
  }, []);

  useEffect(() => {
    (global as any).keepMusicRoomAlive = false;
  }, []);

  // Refs
  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialized = useRef(false);
  const metadataLock = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  // Lets fetchSwipeSuggestions (declared with stable empty deps further
  // down) always read the CURRENT queue when it runs, without needing
  // `queue` in its dependency array — same rationale as currentSongRef.
  const roomStateQueueRef = useRef<QueueItem[]>([]);
  const livePositionRef = useRef(initialRoomPosition);
  const roomPositionRef = useRef(0);
  const isInBackgroundRef = useRef(false);
  const isDJBackgroundedRef = useRef(false);
  const djForegroundReturnTime = useRef<number>(0);
  const seekingRef = useRef(false);
  const isUserAction = useRef(false);
  const preloadedRef = useRef(false);
  const playerReadyTime = useRef(0);
  const isPlayerReadyRef = useRef(false);
  const lastSeekTimeRef = useRef(0); // ✅ Tracks last seek time to prevent seek storms
  const joinSnapshotConsumed = useRef(false); // ✅ NEW
  const lastSnapVideoId = useRef<string | null>(null);
  const isAdPlayingRef = useRef(false);
  const masterDuration = useRef(0);
  const playingStartTime = useRef(0);

  const adSkipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realDurationLockedRef = useRef(false);
  const autoSkipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adMuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ✅ NEW: screen-owned ground truth for "have I (this screen instance,
  // this room) already loaded this exact track into TrackPlayer".
  // Deliberately NOT derived from TrackPlayer.isPlaying()/getProgress() —
  // those reflect momentary native playback state and flip during normal
  // buffering/seeking, which previously caused the audio effect to reload
  // the entire track from the network on every watch_sync tick. This ref
  // is only ever set by this screen's own successful load, and cleared on
  // unmount/destroy, so it can't be fooled by a transient native blip.
  const loadedAudioSessionRef = useRef<string | null>((global as any).loadedAudioSessionId || null);

  // Kept current by an effect right after showControlsFor's own
  // declaration further down — lets the plain tap handler above call the
  // latest showControlsFor without needing it declared yet at this point
  // in the component body.
  const showControlsForRef = useRef<(ms?: number) => void>(() => {});

  // AppState refs for background/foreground position tracking
  const appState = useRef(AppState.currentState);
  const backgroundStartPosition = useRef<number>(0);
  const backgroundStartTime = useRef<number>(0);

  const { callState } = useCall();

  const { roomState, isConnected, isLoading, playerRef, loadSong, syncPlay, syncPause, syncSeek, addToQueue, pinVideo, unpinVideo, passAux, updateCurrentSongMetadata, updateRoomName, joinSnapshot } = useMusicRoom(roomCode, user?.id ?? 0, isPlayerReadyRef, playerReadyTime, isAdPlayingRef, isDJBackgroundedRef);
  const { isDJ, currentSong, isPlaying, position, queue, participants, roomName } = roomState;

  // Ref that always holds the latest isConnected value — safe to read inside
  // async callbacks / setInterval closures that would otherwise capture a stale copy.
  const isConnectedRef = useRef(isConnected);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  const handleMinimize = useCallback(() => {
    (global as any).keepMusicRoomAlive = true;
    (global as any).activeMusicRoomCode = roomCode;
    DeviceEventEmitter.emit('minimize_music_room', true);
  }, [roomCode]);

  useEffect(() => {
    (global as any).activeMusicRoomCode = roomCode;
  }, [roomCode]);

  useEffect(() => {
    if (callState.isActive) {
      console.log('📞 [CALL ACTIVE] Pausing music room playback');
      if (isPlaying && (isDJ || isDJMode)) {
        syncPause(livePositionRef.current || 0);
      }
    }
  }, [callState.isActive, isPlaying, isDJ, isDJMode, syncPause]);

  const seekPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ✅ NEW: monotonic token so a stale seek's delayed resume (playVideo
  // after the settle timeout) can detect it's been superseded by a newer
  // seek and skip firing, instead of yanking the player out of the newer
  // seek's own settle window.
  const resumeSeekTokenRef = useRef(0);

  // ✅ NEW: Unified performLocalSeek helper to coordinate audio and video seeking
  const performLocalSeek = useCallback((t: number) => {
    if (t < 0 || isNaN(t)) return;
    if (seekingRef.current) return;

    // Simulate user action window to ignore transient updates
    isUserAction.current = true;
    const actionTimer = setTimeout(() => { isUserAction.current = false; }, 3000);

    lastSeekTimeRef.current = Date.now();
    seekingRef.current = true;
    setIsReseeking(true);

    // Invalidate any pending audio-resume from a previous seek.
    resumeSeekTokenRef.current++;

    if (seekPollRef.current) {
      clearInterval(seekPollRef.current);
      seekPollRef.current = null;
    }

    try {
      if (!playerRef.current || typeof playerRef.current.seekTo !== 'function') {
        seekingRef.current = false;
        clearTimeout(actionTimer);
        return;
      }

      // Seek video in-place while staying in playing state (prevents stutter/stuck frame)
      playerRef.current.seekTo(t, true);

      setLivePosition(t);
      livePositionRef.current = t;

      // Both Drive and YouTube IFrames own the audio. seekTo above already moved it.
      // Give the IFrame 600ms to buffer the new position, then unblock.
      console.log('🎯 [SEEK SYNC] Waiting for IFrame to buffer seek to', t);
      setTimeout(() => {
        setIsReseeking(false);
        setTimeout(() => { seekingRef.current = false; }, 800);
      }, 600);

    } catch (error) {
      console.error('🎯 [LOCAL SEEK ERROR]', error);
      if (seekPollRef.current) {
        clearInterval(seekPollRef.current);
        seekPollRef.current = null;
      }
      setIsReseeking(false);
      seekingRef.current = false;
    }
  }, [isPlaying, playerRef, isPlayerReadyRef]);

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

  // ✅ FIX: this effect now ONLY loads the track when the SONG itself
  // changes (videoId/source) — isPlaying is deliberately NOT a dependency.
  // Previously isPlaying was in the dependency array, and since room-state
  // isPlaying flips false→true on practically every watch_sync tick, this
  // effect was re-running constantly and calling playYouTubeVideo() (a full
  // network reload) on every sync, seek, and position update. That's what
  // caused "video reloads instead of continuing seamlessly" and "jumping
  // backward resets to the start" — every seek triggered a sync, which
  // toggled isPlaying, which reloaded the whole track from scratch.
  // Starting/stopping playback in response to isPlaying is now handled by
  // the separate lightweight effect below.
  useEffect(() => {
    console.log('🎵 [AUDIO LOAD EFFECT] fired:', {
      videoId: currentSong?.videoId,
      source: currentSong?.source,
    });

    if (!currentSong?.videoId) {
      setIsTrackPlayerReady(false);
      setMediaFullySynced(false);
      return;
    }



    // ✅ Already loaded THIS exact track in THIS screen session — do
    // nothing. This is the only reload guard now, and it's based on our
    // own ref (set after a successful load below), never on a live
    // native read like isPlaying()/getProgress() which can be transiently
    // false during normal buffering and would falsely trigger a reload.
    if (loadedAudioSessionRef.current === currentSong.videoId) {
      console.log('🎵 [AUDIO LOAD EFFECT] Already loaded — skipping reload');
      setIsTrackPlayerReady(true);
      return;
    }

    let cancelled = false;
    setIsTrackPlayerReady(false);
    // ✅ NEW: a fresh load always starts unsynced — pure black+spinner
    // until the rendezvous effect below confirms both engines are ready
    // and explicitly starts them together.
    setMediaFullySynced(false);
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const startAudio = async () => {
      try {
        console.log('🎵 [AUDIO] Preparing track (autoplay deferred to rendezvous):', currentSong.title);
        // ✅ FIX (audio starting ~1s before video): autoplay=false means
        // this only calls setMediaItem() (which starts buffering) and
        // does NOT call TrackPlayer.play(). Playback is started explicitly
        // by the rendezvous effect below, in the same tick as the video's
        // playVideo(), once both report ready.
        await TrackPlayerService.playYouTubeVideo(
          currentSong.videoId,
          currentSong.title,
          currentSong.channelTitle || 'Music Room',
          currentSong.thumbnail,
          currentSong.source,
          undefined,
          false // autoplay
        );
        if (cancelled) return;

        // ✅ Mark as loaded for THIS session only after a successful load.
        // Cleared on unmount/destroy so a new room never inherits this.
        loadedAudioSessionRef.current = currentSong.videoId;
        (global as any).loadedAudioSessionId = currentSong.videoId;

        // 🎵 YouTube/Drive path: start the foreground service so Android won't kill
        // the process in the background, and show the media notification.
        if (!currentSong.source || currentSong.source === 'youtube' || currentSong.source === 'drive') {
          startMusicService(
            currentSong.title,
            currentSong.channelTitle || 'Music Room',
            currentSong.thumbnail || '',
            isDJ || isDJMode
          );
        }
        // ✅ Mark TrackPlayer ready immediately after stream is loaded to prevent 3s initial delay
        setIsTrackPlayerReady(true);
      } catch (e) {
        console.error('🎵 [AUDIO] Start error:', e);
        if (!cancelled) setIsTrackPlayerReady(true); // Unblock on error
      }
    };

    startAudio();

    return () => {
      cancelled = true;
      if (safetyTimer) clearTimeout(safetyTimer);
    };
  }, [currentSong?.videoId, currentSong?.source, audioReloadToken]);

  // ✅ NEW: the rendezvous. Fires whenever either engine's readiness flag
  // changes. Only acts on a FRESH load (mediaFullySynced still false) —
  // once a track has been started this way, ongoing play/pause is handled
  // by the lightweight effect below, and seeks are handled by the
  // dedicated re-seek effect further down.
  //
  // This is the fix for "audio starts ~1s before video": previously
  // TrackPlayer.play() fired the instant the stream URL resolved,
  // independent of whether the video had finished loading. Now audio is
  // only PREPARED (autoplay:false above) until this effect confirms the
  // video side is ALSO ready, then both are started together — TrackPlayer
  // explicitly seeked to 0 and played, video's playVideo() called in the
  // same synchronous block.
  // ✅ Ref that mirrors playerState for use inside intervals/timeouts
  // (state variables capture stale closures, this ref is always current).
  const playerStateRef = useRef('unstarted');

  useEffect(() => {
    if (mediaFullySynced) return; // already running, nothing to do
    if (!currentSong?.videoId) return;
    if (isReseeking) return; // a seek is in control right now, not us

    // Drive now uses the same rendezvous as YouTube — no special case needed.

    if (isPlayerReady && isTrackPlayerReady) {
      // If room isn't playing yet (DJ startup — syncPlay comes later),
      // both engines are ready and paused. That IS synced — just not
      // playing. Let the play/pause reflection handle the actual start
      // when isPlaying becomes true.
      if (!isPlaying) {
        console.log('🎯 [RENDEZVOUS] Both ready, room paused — synced by definition');
        setMediaFullySynced(true);
        return;
      }

      console.log('🎯 [RENDEZVOUS] Both engines ready — syncing startup');

      const startPos = livePositionRef.current > 0 ? livePositionRef.current : 0;

      // Seek video to starting position
      try { playerRef.current?.seekTo?.(startPos, true); } catch (_) {}

      // The play prop (which no longer includes mediaFullySynced) will
      // cause the video to start playing. Poll until the video confirms
      // 'playing' state, then start audio and remove the overlay.
      const myToken = ++rendezvousTokenRef.current;
      let ticks = 0;
      const checkInterval = setInterval(() => {
        ticks++;
        if (rendezvousTokenRef.current !== myToken) {
          clearInterval(checkInterval);
          return;
        }

        const videoPlaying = playerStateRef.current === 'playing';
        const timedOut = ticks >= 40; // 4s safety

        if (videoPlaying || timedOut) {
          clearInterval(checkInterval);
          console.log(timedOut
            ? '🎯 [RENDEZVOUS] Safety timeout — starting audio anyway'
            : '🎯 [RENDEZVOUS] Video confirmed playing — starting audio');

          // Start audio — video is already playing (or we timed out).


          livePositionRef.current = startPos;
          setLivePosition(startPos);
          setMediaFullySynced(true);
        }
      }, 100);
    }
  }, [isPlayerReady, isTrackPlayerReady, currentSong?.videoId, currentSong?.source, mediaFullySynced, isReseeking, isPlaying]);

  // ✅ NEW: gates the ENTIRE room UI behind a plain black overlay until
  // the very first song is fully loaded, metadata-resolved, and
  // audio+video are synced.
  useEffect(() => {
    if (roomRevealedOnceRef.current) return;
    const isSongInfoReady =
      !!currentSong?.videoId &&
      currentSong.title !== 'Loading...' &&
      currentSong.title !== 'Initializing...';
    if (mediaFullySynced && isSongInfoReady) {
      const t = setTimeout(() => {
        roomRevealedOnceRef.current = true;
        setRoomScreenReady(true);
      }, 120);
      return () => clearTimeout(t);
    }
  }, [mediaFullySynced, currentSong?.videoId, currentSong?.title]);

  // ✅ NEW: lightweight play/pause reflection — reacts to room isPlaying
  // WITHOUT ever calling setMediaItem/reloading. This is the only place
  // isPlaying should affect TrackPlayer once a track is loaded.
  useEffect(() => {
    if (!currentSong?.videoId) return;
    // Don't try to control playback before our own load effect has
    // actually loaded this track into TrackPlayer.
    if (loadedAudioSessionRef.current !== currentSong.videoId) return;
    // Don't fight the rendezvous on the very first start, and don't fight
    // an active re-seek — both have their own explicit play/pause calls.
    if (!mediaFullySynced || isReseeking) return;

    // Keep the media notification play/pause icon in sync for YouTube/Drive tracks.
    if (!currentSong?.source || currentSong?.source === 'youtube' || currentSong?.source === 'drive') {
       updateMusicService(
        currentSong?.title ?? '',
        currentSong?.channelTitle ?? 'Music Room',
        currentSong?.thumbnail ?? '',
        isPlaying,
        isDJ || isDJMode
      );
    }
  }, [isPlaying, currentSong?.videoId, currentSong?.source, currentSong?.title, currentSong?.channelTitle, currentSong?.thumbnail, mediaFullySynced, isReseeking, isDJ, isDJMode]);

  // ✅ Seeding initial compensated position immediately when joinSnapshot is received
  // This ensures livePositionRef is set before the player becomes ready, so the rendezvous
  // starts playback directly from the compensated position instead of starting at 0.
  useEffect(() => {
    if (!isDJ && !isDJMode && joinSnapshot && livePositionRef.current === 0) {
      const elapsed = (Date.now() - joinSnapshot.receivedAt) / 1000;
      const targetPos = joinSnapshot.position + elapsed;
      livePositionRef.current = targetPos;
      setLivePosition(targetPos);
      console.log('🎵 [JOIN] Seeding initial compensated position:', targetPos);
    }
  }, [joinSnapshot, isDJ, isDJMode]);

  // ✅ NEW: Keep participant TrackPlayer and video in sync with room position
  // Fires when DJ broadcasts a sync update (position changes from WebSocket)
  useEffect(() => {
    if (isDJ) return; // DJ manages their own position
    if (!isPlaying || !currentSong?.videoId) return;
    if (isDJBackgroundedRef.current) return; // ← KEY FIX: ignore syncs while DJ is backgrounded

    // ✅ Ignore syncs for 3s after DJ returns to foreground
    if (djForegroundReturnTime.current > 0 &&
        Date.now() - djForegroundReturnTime.current < 3000) {
      console.log('📱 [PARTICIPANT SYNC] Skipping — DJ foreground cooldown');
      return;
    }

    // Guard: don't drift-sync until the player is actually ready AND the join snapshot has been consumed.
    // Before the player is ready, livePositionRef is 0 — so drift = full room position (false positive).
    // Before snapshot is consumed, we haven't done the initial seek yet so any drift seek would fight it.
    if (!isPlayerReadyRef.current) return;
    if (!isDJ && !isDJMode && !joinSnapshotConsumed.current) return;

    // ✅ Cooldown: ignore drift syncs if we performed a seek very recently (within 5 seconds)
    // to give the video player enough time to buffer, start playing, and catch up.
    if (Date.now() - lastSeekTimeRef.current < 5000) return;

    // Drift check: Both Drive and YouTube IFrames report their current time via onProgress -> livePositionRef
    let currentPosition = livePositionRef.current;
    const drift = Math.abs(currentPosition - position);

    if (drift > 3 && !seekingRef.current && !isReseeking) {
      console.log('🎵 [PARTICIPANT SYNC] Drift detected:', drift, '— resyncing to room position:', position);
      performLocalSeek(position);
    }
  }, [position, isDJ, isDJMode, isPlaying, currentSong?.videoId, currentSong?.source, performLocalSeek, isReseeking]);

  // ✅ NEW: Hybrid Perfect Sync Listener
  // 1. Gives WebView a head-start while audio buffers (150ms delay)
  // 2. Snaps video to exact audio position once playback starts for frame-accuracy
  // 3. Includes a 'retry' snap at 300ms to ensure it lands even on slow devices
  // 4. Guarded by lastSnapVideoId to only fire once per song (preventing resume jumps)
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackStateChanged, (event) => {

      if (event.state === PlaybackState.Ready) {
        const activeTrack = TrackPlayer.getActiveMediaItem();

        setIsTrackPlayerReady(true);

        if (activeTrack?.mediaId && activeTrack.mediaId !== lastSnapVideoId.current) {
          lastSnapVideoId.current = activeTrack.mediaId;

          setTimeout(() => {
            const { position: tpPosition } = TrackPlayer.getProgress();
            if (playerRef.current && isPlayerReadyRef.current && tpPosition > 0.1) {
              playerRef.current.seekTo(tpPosition + AUDIO_VIDEO_OFFSET, true);
              livePositionRef.current = tpPosition;
            }
          }, 50);

          setTimeout(() => {
            const { position: tpPosition } = TrackPlayer.getProgress();
            if (playerRef.current && isPlayerReadyRef.current && tpPosition > 0.1) {
              playerRef.current.seekTo(tpPosition + AUDIO_VIDEO_OFFSET, true);
              livePositionRef.current = tpPosition;
            }
          }, 300);
        }

      } else if (
        event.state === PlaybackState.Ended ||
        event.state === PlaybackState.Error
      ) {
        setIsTrackPlayerReady(false);
      }

    });

    return () => sub.remove();
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
          // ✅ Tell participants DJ is back — no need to seek since the WebView played continuously
          musicWebSocketService.sendBackgroundState(false, livePositionRef.current);
          console.log('📱 [FG] Returned to foreground. Playing seamlessly at:', livePositionRef.current);
        } else {
          // Participant side — no need to seek, WebView kept playing.
          console.log('📱 [FG] Participant returned to foreground.');
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
    roomStateQueueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    livePositionRef.current = livePosition;
  }, [livePosition]);

  useEffect(() => {
    if (currentSong?.videoId) {
      preloadedRef.current = false;
      joinSnapshotConsumed.current = false; // ✅ NEW: reset for each new song
      playerStateRef.current = 'unstarted';
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
          // ✅ Ticker is now the only ad detector — perform the actual skip
          // here too (previously split between this effect and the removed
          // onReady interval, which is what caused duration to thrash).
          playerRef.current?.fastForwardAd?.();
          playerRef.current?.seekTo?.(0, true);
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
  }, [isConnected, isDJ, isPlaying, currentSong?.videoId, syncPlay, playerState, isPlayerReadyRef, mediaFullySynced, isReseeking]);

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
      // ✅ FIX (replay button not replaying): the audio load effect's
      // dependency array is [currentSong?.videoId, currentSong?.source] —
      // replaying the SAME video means videoId doesn't change, so that
      // effect never re-fires, and loadedAudioSessionRef still thinks this
      // track is "already loaded" from before it ended. Clearing the ref
      // here forces the next load-effect pass to treat this as a genuine
      // fresh load and actually restart TrackPlayer from position 0.
      if (richSong.videoId === loadedAudioSessionRef.current) {
        loadedAudioSessionRef.current = null;
        (global as any).loadedAudioSessionId = null;
        setAudioReloadToken(t => t + 1);
      }
      setIsSyncing(true);
      loadSong(richSong, currentRoomName);
    } else {
      addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
    }
    Keyboard.dismiss();
  }, [isDJ, isDJMode, loadSong, addToQueue, user?.display_name, playerState, queue, currentRoomName]);

  useEffect(() => {
    const playSub = DeviceEventEmitter.addListener('MEDIA_PLAY', () => {
      if (isDJ || isDJMode) {
        syncPlay(livePositionRef.current || 0);
      }
    });
    const pauseSub = DeviceEventEmitter.addListener('MEDIA_PAUSE', () => {
      if (isDJ || isDJMode) {
        syncPause(livePositionRef.current || 0);
      }
    });
    return () => {
      playSub.remove();
      pauseSub.remove();
    };
  }, [isDJ, isDJMode, syncPlay, syncPause]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('VIDEO_SELECTED', async (data) => {
      if (data.roomCode !== roomCode) return;

      // If already connected, bypass waiting completely (use ref to avoid stale closure)
      if (!isConnectedRef.current) {
        // Wait for WebSocket to be connected (max 15s)
        const waitForConnection = () => new Promise<void>((resolve, reject) => {
          let elapsed = 0;
          const interval = setInterval(() => {
            elapsed += 100;
            if (isConnectedRef.current) {   // ← always reads the LATEST value
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
        // If we already have a title from params/selection, build the song immediately
        // without an extra network round-trip so the UI shows real info right away.
        if (data.title && data.thumbnail) {
          song = {
            videoId:      data.videoId,
            title:        data.title,
            thumbnail:    data.thumbnail,
            channelTitle: data.channelTitle || 'YouTube',
            addedBy:      user?.display_name || 'Someone',
            source:       'youtube',
          };
        } else {
          song = await fetchYouTubeMetadata(data.videoId, user?.display_name);
          song.source = 'youtube';
        }
      }

      handleSelectSong(song);
      setShowDiscovery(false);
      setIsFirstCreation(false);
    });

    return () => sub.remove();
  }, [roomCode, user?.display_name, handleSelectSong]);

  useEffect(() => {
    if (currentSong?.videoId && metadataLock.current !== currentSong.videoId &&
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
  }, [currentSong?.videoId, currentSong?.title, user?.display_name, updateCurrentSongMetadata]);

  const showControlsFor = useCallback((ms = 3500) => {
    setShowControls(true);
    if (controlTimer.current) clearTimeout(controlTimer.current);
    if (isPlaying) {
      controlTimer.current = setTimeout(() => setShowControls(false), ms) as any;
    }
  }, [isPlaying]);

  // Keep the swipe gesture's ref pointed at the latest showControlsFor —
  // see the comment at showControlsForRef's declaration for why this
  // indirection is necessary.
  useEffect(() => {
    showControlsForRef.current = showControlsFor;
  }, [showControlsFor]);

  useEffect(() => { showControlsFor(); }, [isPlaying, showControlsFor]);

  useEffect(() => {
    if (isDJMode && initialVideoId && isConnected && !hasInitialized.current) {
      hasInitialized.current = true;
      const isDrive = initialSource === 'drive';

      const buildAndLoad = (resolvedTitle: string, resolvedThumbnail: string, resolvedChannel: string) => {
        setIsSyncing(true);
        const song: Song = {
          videoId: initialVideoId,
          title: resolvedTitle,
          thumbnail: resolvedThumbnail,
          channelTitle: resolvedChannel,
          addedBy: user?.display_name ?? 'You',
          source: isDrive ? 'drive' : 'youtube',
        };
        loadSong(song, currentRoomName);
      };

      if (isDrive) {
        // Drive: we have the title already from params or fallback
        setTimeout(() => {
          buildAndLoad(
            initialTitle || 'Drive Video',
            initialThumbnail || 'https://via.placeholder.com/150/1a1a2e/FFFFFF?text=Drive',
            'Google Drive',
          );
        }, 500);
      } else if (initialTitle && initialThumbnail) {
        // YouTube: all info already available from route params (selected from history/likes)
        setTimeout(() => {
          buildAndLoad(
            initialTitle,
            initialThumbnail,
            'YouTube',
          );
        }, 500);
      } else {
        // YouTube: WebView interception — no title captured. Fetch metadata then load.
        // Start loading the video immediately with a placeholder so playback isn't delayed,
        // then update with real metadata as soon as the fetch returns.
        const fallbackThumb = `https://img.youtube.com/vi/${initialVideoId}/mqdefault.jpg`;
        setTimeout(() => {
          buildAndLoad('Loading...', fallbackThumb, 'YouTube');
        }, 500);

        // Fetch real metadata in parallel and update once resolved
        fetchYouTubeMetadata(initialVideoId, user?.display_name)
          .then((meta) => {
            if (meta?.title) {
              updateCurrentSongMetadata({
                ...meta,
                addedBy: user?.display_name ?? 'You',
                source: 'youtube',
              });
            }
          })
          .catch((e) => console.warn('🎵 Initial metadata fetch failed:', e));
      }
    }
  }, [isConnected, initialVideoId, initialSource, initialTitle, initialThumbnail, isDJMode, loadSong, updateCurrentSongMetadata, user?.display_name]);

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
    if (isMinimized) return;

    const backAction = () => {
      if (showDiscovery) { setShowDiscovery(false); return true; }
      if (fullscreen) { setFullscreen(false); return true; }
      setShowLeaveConfirm(true);
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => { backHandler.remove(); };
  }, [showDiscovery, fullscreen, isMinimized]);

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

  // Single related-videos fetch, used by both triggers (top-left button,
  // anytime; auto-open on video end). Filters out anything already in the
  // queue, since those render as their own grid cells (with pinner avatar
  // badges) via the `queue` prop — showing them again here as plain
  // suggestions would be a confusing duplicate. Does NOT itself open the
  // panel — callers decide when (see call sites below).
  const fetchRelated = useCallback(async () => {
    setIsLoadingRelated(true);
    try {
      const queuedIds = new Set(roomStateQueueRef.current.map(q => q.song.videoId));

      if (currentSongRef.current?.source === 'drive') {
        console.log('📂 [RELATED] Drive video detected — fetching from watch history or trending');
        let fallbackSongs: Song[] = [];

        try {
          const historyData = await musicAPI.getWatchHistory();
          if (Array.isArray(historyData) && historyData.length > 0) {
            const mappedHistory = historyData
              .map((item: any) => ({
                videoId: item.video_id,
                title: item.title,
                thumbnail: item.thumbnail,
                channelTitle: item.channel_title || 'Music History',
                source: item.source || 'youtube',
              }))
              .filter((song: Song) => song.videoId !== currentSongRef.current?.videoId && !queuedIds.has(song.videoId));

            // Shuffle history to show random suggestions
            fallbackSongs = mappedHistory.sort(() => 0.5 - Math.random());
          }
        } catch (err) {
          console.warn('📂 [RELATED] Failed to load history:', err);
        }

        // If history is empty or loading history failed, fetch trending YouTube videos
        if (fallbackSongs.length === 0) {
          try {
            console.log('📂 [RELATED] History empty — fetching trending YouTube videos');
            const searchData = await musicAPI.searchYouTube('trending music');
            if (searchData && Array.isArray(searchData.items)) {
              fallbackSongs = searchData.items
                .map((item: any) => ({
                  videoId: item.id.videoId,
                  title: item.snippet.title,
                  thumbnail: item.snippet.thumbnails.medium.url,
                  channelTitle: item.snippet.channelTitle,
                  source: 'youtube',
                }))
                .filter((song: Song) => !queuedIds.has(song.videoId));
            }
          } catch (err) {
            console.error('📂 [RELATED] Failed to fetch search trending:', err);
          }
        }

        setRelatedVideos(fallbackSongs.slice(0, 15));
      } else {
        const data = await musicAPI.getRelatedVideos(currentSongRef.current?.videoId || '');
        const fresh = data.items
          .map((item: any) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium.url,
            channelTitle: item.snippet.channelTitle,
          }))
          .filter((song: Song) => !queuedIds.has(song.videoId));
        setRelatedVideos(fresh);
      }
    } catch (e) {
      console.error('Related videos fetch failed:', e);
    } finally {
      setIsLoadingRelated(false);
    }
  }, []);

  // Re-fetch whenever the panel opens (button or auto-on-end), and again
  // if the current song changes while it's still open (so suggestions
  // don't go stale if playback advances to a new song mid-browse).
  useEffect(() => {
    if (showRelated) {
      fetchRelated();
    }
  }, [showRelated, currentSong?.videoId, fetchRelated]);

  const onPlayerStateChange = async (state: string) => {
    // ✅ Always update the ref so intervals/timeouts can read the
    // current video state without stale-closure issues.
    playerStateRef.current = state;
    setPlayerState(state);

    if (state === 'playing') {
      if (playingStartTime.current === 0) playingStartTime.current = Date.now();
    } else {
      playingStartTime.current = 0;
    }

    // ✅ FIX: Suppress buffering state changes during active seek.
    // The seekingRef prevents the spinner↔pause icon flicker that
    // occurs when the video reports buffering→playing→buffering at
    // the new position while audio is still catching up.
    if (!seekingRef.current) {
      if (state === 'buffering' || state === 'unstarted' || state === 'cued') setIsBuffering(true);
      else setIsBuffering(false);
    }
    if (['unstarted', 'playing', 'paused', 'cued', 'buffering'].includes(state)) setIsPlayerReady(true);

    if (state === 'ended') {
      if (duration > 0) {
        if ((isDJ || isDJMode) && queue.length > 0) {
          setIsSyncing(true);
          passAux();
        } else {
          fetchRelated();
          setTimeout(() => {
            setPlayerState(curr => {
              if (curr === 'ended') setShowRelated(true);
              return curr;
            });
          }, 3000);
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
      // Nothing queued to skip to — show the related panel immediately so
      // there's visible feedback and a way to pick something, instead of
      // silently fetching suggestions in the background with no UI change.
      setShowRelated(true);
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
    if (seekingRef.current) return;

    // Broadcast seek to the room
    syncSeek(t);

    // Perform local seek coordination
    performLocalSeek(t);
  }, [performLocalSeek, syncSeek]);

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
                (global as any).keepMusicRoomAlive = false;
                (global as any).activeMusicRoomCode = null;
                (global as any).loadedAudioSessionId = null;
                try { TrackPlayerService.endSession(); } catch (_) {}
                stopMusicService();
                loadedAudioSessionRef.current = null;
                musicWebSocketService.disconnect();
                DeviceEventEmitter.emit('close_music_room');
              }}>
                <Text style={s.buttonText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (!roomCode) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={s.loadingContainer}>
        <StatusBar barStyle={isMinimized ? "dark-content" : "light-content"} backgroundColor="transparent" translucent={true} />
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={s.loadingText}>{isDJMode ? 'Creating room...' : 'Joining room...'}</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={isMinimized ? "dark-content" : "light-content"} backgroundColor="transparent" translucent={true} />

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
          {!fullscreen && (!isKeyboardVisible || isEditingName) && (
            <View style={s.header}>
              <TouchableOpacity onPress={handleMinimize} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="arrow-back" size={28} color="#fff" />
              </TouchableOpacity>
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
                    returnKeyType="done"
                    blurOnSubmit={true}
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

          {/* VIDEO — stays in its normal flow position always now. The
              related-videos panel (opened via the top-left icon button,
              not a swipe/PIP) renders as a separate overlay on top while
              this keeps playing underneath, unaffected. */}
          <View style={fullscreen ? s.videoWrapFullscreen : s.videoWrap}>
            <View style={StyleSheet.absoluteFill} pointerEvents={currentSong?.source === 'drive' ? 'box-none' : 'none'}>
              {currentSong && currentSong.videoId ? (
                
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
                    }}
                    onStreamResolved={(cdnUrl, cdnHeaders) => {
                      if (!currentSong) return;
                      console.log('🎵 [DRIVE AUDIO] Stream resolved — WebView owns audio');
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
                    muted={false}  // IFrame owns audio — TrackPlayer is NOT used for YouTube
                    onVideoData={(extractedTitle, author) => {
                      if (currentSong && (currentSong.title === 'Loading...' || currentSong.title === 'Initializing...' || !currentSong.channelTitle)) {
                        console.log('🎵 [METADATA] Extracted video data from IFrame:', extractedTitle, 'by', author);
                        updateCurrentSongMetadata({
                          ...currentSong,
                          title: extractedTitle || currentSong.title,
                          channelTitle: author || currentSong.channelTitle || 'YouTube',
                        });
                      }
                    }}
                    onReady={() => {
                      // NOTE: do NOT call setVolume(0) here — we want real audio from the IFrame
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
                      playerReadyTime.current = Date.now();
                      setIsBuffering(false);

                      if (!isDJ && !isDJMode && joinSnapshot && !joinSnapshotConsumed.current) {
                        joinSnapshotConsumed.current = true;
                        const snapshotTime = joinSnapshot.receivedAt;
                        const snapshotPosition = joinSnapshot.position;
                        // Use the most recent watch_sync position which is more accurate than snapshot
                        // snapshot was saved on room_state, but by now we may have received fresher syncs
                        // We use the latest `position` from roomState for accuracy
                        setTimeout(() => {
                          const elapsed = (Date.now() - snapshotTime) / 1000;
                          const targetPosition = snapshotPosition + elapsed;
                          const safePosition = duration > 0
                            ? Math.min(targetPosition, duration - 2)
                            : targetPosition;
                          console.log('👋 [JOIN] Seeking to live position:', safePosition, '(snapshot:', snapshotPosition, '+ elapsed:', elapsed.toFixed(1), 's)');
                          playerRef.current?.seekTo(safePosition, true);
                          livePositionRef.current = safePosition;
                          lastSeekTimeRef.current = Date.now();
                        }, 500); // Reduced from 2000ms — player is already ready at this point
                      }

                      setIsAdPlaying(true);
                      isAdPlayingRef.current = true;
                      realDurationLockedRef.current = false;

                      // ✅ FIX (Bug 1 — duration jumping / desync):
                      // Previously this block ran its OWN setInterval that
                      // independently measured duration and decided
                      // ad-vs-real-video, calling setDuration/setRealDuration
                      // on its own schedule. The "Stable Position ticker"
                      // effect elsewhere in this component does the exact
                      // same job with a different (stricter, sample-averaged)
                      // heuristic. Having two independent detectors meant
                      // duration could be overwritten by whichever one fired
                      // last, visibly jumping between values. We now let the
                      // ticker be the single source of truth — onReady only
                      // seeds "assume this is an ad until the ticker proves
                      // otherwise", matching what the ticker already expects
                      // (isAdPlayingRef starts true, masterDuration starts 0).
                      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
                      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);

                      // Safety net only: if the ticker hasn't cleared the
                      // "assume ad" flag within 20s (e.g. ticker hasn't
                      // started yet, very slow buffering), stop blocking the
                      // UI on the ad overlay. This does NOT touch duration.
                      adMuteTimer.current = setTimeout(() => {
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
                  <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" />
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
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' }}>
                  {playerError === 'embed_not_allowed'
                    ? 'The video owner has restricted playback outside YouTube'
                    : 'Video Unplayable'}
                </Text>
                {(isDJ || isDJMode) && (
                  <TouchableOpacity
                    onPress={() => {
                      if (autoSkipTimer.current) clearTimeout(autoSkipTimer.current);
                      setPlayerError(null);
                      setShowDiscovery(true);
                    }}
                    style={{ marginTop: 8, backgroundColor: '#31313100', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, elevation: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Pick Another Video</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Simple tap on empty video space shows controls. A tap that
                lands on a VideoControls button (rendered after this, on
                top) fires that button's onPress instead, never reaching
                here — same as the original behavior, swipe gesture removed
                per spec (replaced by the top-left Related icon button). */}
            {!playerError && playerState !== 'ended' && (
              <TouchableWithoutFeedback onPress={() => showControlsForRef.current()}>
                <View style={StyleSheet.absoluteFill} />
              </TouchableWithoutFeedback>
            )}

            <VideoControls
              visible={showControls && !playerError}
              isPlaying={isPlaying}
              isEnded={playerState === 'ended'}
              canControl={(isDJ || isDJMode) && isPlayerReady}
              isBuffering={!isReseeking && (isBuffering || (currentSong?.source !== 'drive' && !isTrackPlayerReady)) && !!currentSong}
              position={livePosition}
              duration={duration}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onNext={handleNext}
              onToggleFullscreen={() => setFullscreen(!fullscreen)}
              onShowRelated={() => setShowRelated(true)}
              isFullscreen={fullscreen}
              isDrivePlayer={currentSong?.source === 'drive'}
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

            {/* Ad overlay — only for YouTube, Drive has no ads. Pure black,
                no thumbnail — a translucent thumbnail here was sitting on
                top of the live (possibly already-playing) WebView frame
                underneath and was the source of the reported flicker. */}
            {isAdPlaying && !playerError && currentSong?.source !== 'drive' && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20, justifyContent: 'center', alignItems: 'center' }]} />
            )}

            {/* ✅ Sync overlay — covers ONLY the initial startup
                rendezvous (before audio+video are both confirmed running).
                NOT shown during seeks — the video stays visible with its
                natural seek behavior, only audio is briefly silent. */}
            {!playerError && currentSong?.videoId && currentSong.title !== 'Initializing...' &&
              !mediaFullySynced && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 30, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" />
              </View>
            )}

            {/* Small corner indicator during seek — audio catching up */}
            {isReseeking && mediaFullySynced && (
              <View style={[StyleSheet.absoluteFill, { zIndex: 35, justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
                <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              </View>
            )}

            {/* Related videos overlay — queue (global play order, with
                pinner avatar badges) + fresh suggestions. No PIP, no
                current-song display, per spec. Opened via the top-left
                Related icon button (anytime) or automatically when the
                video ends. Selecting ANY video here while the player has
                ENDED plays it immediately (handleSelectSong's forcePlay
                path) instead of only pinning it into a queue that nothing
                would ever auto-advance from. */}
            {showRelated && !fullscreen && currentSong?.source !== 'drive' && (
              <View style={s.relatedOverlay}>
                <TouchableOpacity
                  style={s.relatedCloseBtn}
                  onPress={() => setShowRelated(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close-circle" size={36} color="#fff" />
                </TouchableOpacity>
                {isLoadingRelated && relatedVideos.length === 0 && (
                  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }]}>
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" />
                  </View>
                )}
                <RelatedVideosGrid
                  queueItems={queue}
                  suggestedVideos={relatedVideos}
                  myUserId={user?.id ?? -1}
                  onPinVideo={(song) => {
                    if (playerState === 'ended') {
                      // Nothing left for the room to auto-advance to —
                      // play this immediately instead of just pinning it.
                      setShowRelated(false);
                      handleSelectSong(song, true);
                    } else {
                      pinVideo(song);
                    }
                  }}
                  onUnpinVideo={(videoId) => unpinVideo(videoId)}
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
                        <Icon name="person-add-outline" size={16} color="#fdfdfd" />
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
                  {(() => {
                    // ✅ Queue tab shows ONLY the viewing user's own pinned
                    // items — per spec, each person's queue is private to
                    // them in this view (the Related grid is where everyone
                    // sees everyone's pins). We still show each item's
                    // GLOBAL position (its index in the full, all-users
                    // queue) so a user can tell when their pick is actually
                    // coming up, not just its position within their own
                    // filtered list.
                    const myQueue = queue
                      .map((item, globalIndex) => ({ item, globalIndex }))
                      .filter(({ item }) => item.addedById === (user?.id ?? -1));

                    return (
                      <>
                        <View style={s.queueHeader}>
                          <Text style={s.queueTitle}>My Queue ({myQueue.length})</Text>
                          <TouchableOpacity onPress={() => setActiveTab('chat')} style={s.queueCloseBtn}>
                            <Icon name="close-circle" size={20} color="#fff" />
                            <Text style={s.queueCloseText}>Close</Text>
                          </TouchableOpacity>
                        </View>
                        <FlatList
                          data={myQueue}
                          keyExtractor={({ item }) => `${item.song.videoId}_${item.addedById}`}
                          style={{ flex: 1 }}
                          contentContainerStyle={{ padding: 12 }}
                          ListEmptyComponent={<Text style={s.emptyText}>Your queue is empty — swipe the video to browse and pin songs</Text>}
                          renderItem={({ item: { item, globalIndex } }) => (
                            <View style={s.qRow}>
                              <Text style={s.qNum}>{globalIndex + 1}</Text>
                              <Image source={{ uri: item.song.thumbnail }} style={s.qThumb} />
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={s.qTitle} numberOfLines={1}>{item.song.title}</Text>
                                <Text style={s.qBy}>Up next in #{globalIndex + 1} position</Text>
                              </View>
                              <TouchableOpacity onPress={() => unpinVideo(item.song.videoId)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Icon name="close-circle" size={24} color="rgba(255,255,255,0.5)" />
                              </TouchableOpacity>
                            </View>
                          )}
                        />
                      </>
                    );
                  })()}
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
      {/* ✅ NEW: plain black cover — hides the placeholder header/np-bar/
          video/nav-bar flash until the first song is truly ready to play.
          Sits above everything (header, video, controls, related panel)
          via zIndex, and blocks taps until lifted. */}
      {!roomScreenReady && (
        <View style={s.fullRoomLoadingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color="rgba(255,255,255,0.85)" />
        </View>
      )}
    </View>
  );
};

// Styles
const s = StyleSheet.create({
  fullRoomLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 500,
    elevation: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  relatedOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 15 },
  relatedCloseBtn:   { position: 'absolute', top: 12, left: 12, zIndex: 60 },
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
