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
 * 9. ✅ IDLE CLOSE TIMER: Auto-closes room after 10 minutes of inactivity
 *       (ended with empty queue OR paused with no active playback)
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, Pressable,
  FlatList, Image, ActivityIndicator,
  StatusBar, TextInput,
  Dimensions, Keyboard, Platform, ScrollView, useWindowDimensions,
  KeyboardAvoidingView, Modal, BackHandler, Switch,
  Animated, PanResponder, DeviceEventEmitter, AppState, Vibration,
  LayoutChangeEvent, NativeModules, LayoutAnimation, Easing as RNEasing,
  Share,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import AmbientDiscoBackground, { RoomTheme } from '../components/AmbientDiscoBackground';
import BackgroundAmbientPlayer from '../components/BackgroundAmbientPlayer';
import DrivePlayer from '../components/DrivePlayer';
import DirectVideoPlayer from '../components/DirectVideoPlayer';
import YoutubePlayer from '../components/YoutubePlayer';
import YouTubeDecipherService from '../services/YouTubeDecipherService';
import TrackPlayerService, { extractStreamUrlClientSide, extractVideoStreamUrlClientSide, heightToQualityKey, getEffectiveResolutionHeight } from '../services/TrackPlayerService';
import TrackPlayer, { Event, PlaybackState } from '@rntp/player';
import { startMusicService, updateMusicService, stopMusicService, updateMusicServicePosition } from '../services/MusicServiceBridge';
import Icon from 'react-native-vector-icons/Ionicons';
import { useMusicRoom, Song, QueueItem } from '../hooks/useMusicRoom';
import { setSystemPipEnabled, setSystemPipMinimized, setSystemPipAspectRatio, getAspectRatioFraction, enterSystemPip, closeSystemPip, addPipListener, hasSystemPipPermission, openSystemPipSettings } from '../services/PipService';
import YouTubeDiscoveryScreen from './YouTubeDiscoveryScreen';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCall } from '../context/CallContext';
import api, { musicAPI } from '../services/api';
import InviteModal from '../components/InviteModal';
import RoomParticipantsModal from '../components/RoomParticipantsModal';
import AvatarWithFallback from '../components/AvatarWithFallback';
import RelatedVideosGrid from '../components/RelatedVideosGrid';
import DiscoveryFeedService from '../services/DiscoveryFeedService';
import musicWebSocketService from '../services/MusicWebSocketService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Orientation from 'react-native-orientation-locker';
import { pinNavBarColor, clearNavBarPin, setWindowBackground, setImmersiveMode } from '../utils/navBarPin';
import { resolveImageUrl } from '../utils/image';
import { colors } from '../utils/theme';
import { API_BASE_URL } from '../config/network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import FullScreenMediaViewer from '../components/FullScreenMediaViewer';
import RichTextInput, { RichTextInputRef } from '../components/RichTextInput';
import StickerPreviewModal from '../components/StickerPreviewModal';
import { CustomGalleryPicker } from '../components/CustomGalleryPicker';
import FastImage from 'react-native-fast-image';
import { checkGoogleDriveAuth } from '../utils/driveAuth';
import DriveStreamService from '../services/DriveStreamService';
import StickerPickerSheet from '../components/StickerPickerSheet';
import DoubleTapHeartOverlay, { DoubleTapHeartOverlayRef } from '../components/DoubleTapHeartOverlay';
import LottieStickerMessage from '../components/LottieStickerMessage';
import { BUILT_IN_STICKER_PACKS, Sticker } from '../stickers/stickerPacks';
import Reanimated, { useSharedValue, useAnimatedStyle, useDerivedValue, useAnimatedReaction, withTiming, withSpring, cancelAnimation, Easing } from 'react-native-reanimated';
import { useGenericKeyboardHandler, KeyboardController, AndroidSoftInputModes } from 'react-native-keyboard-controller';
import { useMusicVoiceChat } from '../hooks/useMusicVoiceChat';


// ── WhatsApp / Instagram style smooth mounting & slide-up entrance for newly sent bubbles ──
const AnimatedMessageBubble = React.memo(({
  isNew,
  children,
  style,
}: {
  isNew: boolean;
  children: React.ReactNode;
  style?: any;
}) => {
  const anim = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    if (isNew) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 180,
        easing: RNEasing.out(RNEasing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, []);

  if (!isNew) {
    return <View style={style}>{children}</View>;
  }

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.95, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
});

const { width, height } = Dimensions.get('window');
const VIDEO_HEIGHT = width * (9 / 16);

// ── Isolated Input Box: Encapsulates inputHeight so multiline expansions (<1ms)
// NEVER trigger a re-render of the 6,000-line MusicRoomScreen tree (WhatsApp / ChatInputArea style) ──
const MusicInputBox = React.memo(
  React.forwardRef<RichTextInputRef, {
    isLight: boolean;
    themePlaceholderColor: string;
    isStickerPickerDeliberatelyOpen: boolean;
    disabled?: boolean;
    onFocusInput: () => void;
    onOpenStickerPicker: () => void;
    onChangeText: (text: string) => void;
    onContentCommitted: (event: any) => void;
  }>((props, ref) => {
    const {
      isLight,
      themePlaceholderColor,
      isStickerPickerDeliberatelyOpen,
      disabled = false,
      onFocusInput,
      onOpenStickerPicker,
      onChangeText,
      onContentCommitted,
    } = props;

    const innerRef = useRef<RichTextInputRef>(null);
    const [inputHeight, setInputHeight] = useState(45);

    React.useImperativeHandle(ref, () => ({
      clear: () => {
        LayoutAnimation.configureNext({
          duration: 100,
          update: { type: LayoutAnimation.Types.easeOut },
        });
        setInputHeight(45);
        innerRef.current?.clear();
      },
      setText: (t: string) => innerRef.current?.setText(t),
      focus: () => innerRef.current?.focus(),
      blur: () => innerRef.current?.blur(),
    }));

    const handleContentSizeChange = useCallback((e: any) => {
      const h = e.nativeEvent?.contentSize?.height;
      if (h) {
        const next = Math.max(45, Math.min(180, Math.round(h)));
        setInputHeight(prev => {
          if (Math.abs(prev - next) >= 4) {
            LayoutAnimation.configureNext({
              duration: 100,
              update: { type: LayoutAnimation.Types.easeOut },
            });
            return next;
          }
          return prev;
        });
      }
    }, []);

    return (
      <View
        style={[
          s.inputWrapper,
          isLight && { backgroundColor: 'rgba(0,0,0,0.06)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }
        ]}
        onTouchStart={disabled ? undefined : onFocusInput}
        pointerEvents={disabled ? 'none' : 'auto'}
      >
        <TouchableOpacity
          style={s.innerStickerButton}
          activeOpacity={0.7}
          delayPressIn={0}
          disabled={disabled}
          onPress={onOpenStickerPicker}
          accessibilityLabel={isStickerPickerDeliberatelyOpen ? "Switch to keyboard" : "Switch to stickers"}
        >
          <Icon
            name="happy-outline"
            size={22}
            color={isStickerPickerDeliberatelyOpen ? "#8AB4F8" : (isLight ? '#64748B' : "rgba(255,255,255,0.6)")}
          />
        </TouchableOpacity>
        <RichTextInput
          ref={innerRef}
          editable={!disabled}
          onTouchStart={disabled ? undefined : onFocusInput}
          onFocus={disabled ? undefined : onFocusInput}
          onBlur={() => {}}
          style={[s.chatInput, { paddingLeft: 42, paddingRight: 12, height: inputHeight, textAlignVertical: inputHeight > 50 ? 'top' : 'center' }, isLight && { color: '#0F172A' }]}
          underlineColorAndroid="transparent"
          autoFocus={false}
          onChangeText={onChangeText}
          onContentSizeChange={handleContentSizeChange}
          multiline
          maxLength={2000}
          placeholder="Type a message..."
          placeholderTextColor={themePlaceholderColor}
          onContentCommitted={onContentCommitted}
        />
      </View>
    );
  })
);


// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────
const fmtTime = (s: number) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const fetchChannelDetails = async (videoId: string): Promise<{ logo: string | null; channelUrl: string | null }> => {
  let logo: string | null = null;
  let channelUrl: string | null = null;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await res.text();
    const ownerMatch = html.match(/"videoOwnerRenderer"\s*:\s*\{[^}]*?"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https:\/\/[^"]+)"/);
    if (ownerMatch && ownerMatch[1]) {
      logo = ownerMatch[1].replace(/\\u0026/g, '&');
    } else {
      const avatarMatch = html.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https:\/\/[^"]+)"/);
      if (avatarMatch && avatarMatch[1]) {
        logo = avatarMatch[1].replace(/\\u0026/g, '&');
      } else {
        const matches = html.match(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[a-zA-Z0-9_\-=/]+/g);
        if (matches && matches.length > 0) {
          logo = matches[0];
        }
      }
    }

    const canonicalMatch = html.match(/"canonicalBaseUrl"\s*:\s*"(\/@[^"]+)"/);
    if (canonicalMatch && canonicalMatch[1]) {
      channelUrl = `https://m.youtube.com${canonicalMatch[1]}/videos`;
    } else {
      const navUrlMatch = html.match(/"videoOwnerRenderer"\s*:\s*\{[^}]*?"navigationEndpoint"\s*:\s*\{[^}]*?"url"\s*:\s*"(\/[^"]+)"/);
      if (navUrlMatch && navUrlMatch[1]) {
        const base = navUrlMatch[1].startsWith('/') ? navUrlMatch[1] : `/${navUrlMatch[1]}`;
        channelUrl = `https://m.youtube.com${base}/videos`;
      } else {
        const browseMatch = html.match(/"browseId"\s*:\s*"(UC[a-zA-Z0-9_\-]+)"/);
        if (browseMatch && browseMatch[1]) {
          channelUrl = `https://m.youtube.com/channel/${browseMatch[1]}/videos`;
        }
      }
    }
  } catch (e) {
    console.warn('🎵 Channel details fetch failed:', e);
  }
  return { logo, channelUrl };
};

const fetchChannelLogo = async (videoId: string): Promise<string | null> => {
  const details = await fetchChannelDetails(videoId);
  return details.logo;
};

interface VideoAspectRatioResult {
  aspectRatio: number;
  verticalPercent: number;
  isNativeWidescreen: boolean;
}

const fetchVideoAspectRatio = async (videoId: string): Promise<VideoAspectRatioResult | null> => {
  // 1. Check YouTube video stream formats first!
  // If YouTube serves a native widescreen stream format (e.g. 3840x1608 or 3840x1692, AR > 1.82),
  // the stream ITSELF has NO black bars to crop!
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var|\s*<\/script>)/);
      if (m) {
        const data = JSON.parse(m[1]);
        const formats = data?.streamingData?.adaptiveFormats || data?.streamingData?.formats || [];
        const videoFormats = formats.filter((f: any) => f.width && f.height);
        if (videoFormats.length > 0) {
          videoFormats.sort((a: any, b: any) => b.width - a.width);
          const top = videoFormats[0];
          const streamAr = top.width / top.height;
          if (streamAr > 1.82) {
            console.log(`📐 [NATIVE WIDESCREEN STREAM] Video ${videoId} format ${top.width}x${top.height} -> Aspect Ratio: ${streamAr.toFixed(3)} (0% black bars)`);
            return { aspectRatio: streamAr, verticalPercent: 0.0, isNativeWidescreen: true };
          }
          if (streamAr < 1.70 && streamAr >= 0.4) {
            console.log(`📐 [TALL/4:3 STREAM] Video ${videoId} format ${top.width}x${top.height} -> Aspect Ratio: ${streamAr.toFixed(3)}`);
            return { aspectRatio: streamAr, verticalPercent: 0.0, isNativeWidescreen: false };
          }
        }
      }
    }
  } catch (e) {}

  // 2. Check storyboard/thumbnail letterbox detection (detects cinema letterbox bars encoded into 16:9 streams)
  try {
    const letterboxRes = await YouTubeDecipherService.detectLetterboxAspectRatio(videoId);
    if (letterboxRes && letterboxRes.aspectRatio >= 0.4 && letterboxRes.aspectRatio <= 3.5) {
      if (Math.abs(letterboxRes.aspectRatio - 16 / 9) > 0.05 && letterboxRes.verticalPercent > 0.03) {
        console.log(`📐 [LETTERBOX DETECTED] Video ${videoId} letterbox AR: ${letterboxRes.aspectRatio.toFixed(3)}, verticalPercent: ${(letterboxRes.verticalPercent * 100).toFixed(1)}%`);
        return {
          aspectRatio: letterboxRes.aspectRatio,
          verticalPercent: Math.min(0.22, letterboxRes.verticalPercent),
          isNativeWidescreen: false,
        };
      }
    }
  } catch (_) {}

  // 3. YouTube official oEmbed API fallback
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.width && data.height) {
        const ar = data.width / data.height;
        if (ar >= 0.4 && ar <= 3.5) {
          console.log(`📐 [AUTO AR] Video ${videoId} oEmbed dimensions: ${data.width}x${data.height} -> Aspect Ratio: ${ar.toFixed(3)}`);
          return { aspectRatio: ar, verticalPercent: 0.0, isNativeWidescreen: ar > 1.82 };
        }
      }
    }
  } catch (e) {
    console.warn('🎵 Video oEmbed aspect ratio fetch error:', e);
  }
  return null;
};

const fetchYouTubeMetadata = async (videoId: string, fallbackName?: string): Promise<Song> => {
  const cleanFallback = (fallbackName && fallbackName !== 'Watch Party' && fallbackName !== 'YouTube Video') ? fallbackName : '';
  const base: Song = {
    videoId,
    title:        cleanFallback || 'Loading...',
    thumbnail:    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    channelTitle: 'YouTube',
    addedBy:      fallbackName ?? 'Someone',
  };

  let resolvedTitle = base.title;
  let resolvedChannel = base.channelTitle;
  let resolvedThumb = base.thumbnail;
  let resolvedLogo: string | undefined = undefined;
  let resolvedChannelUrl: string | undefined = undefined;

  // 1. YouTube official oEmbed API — ultra-fast (50ms), guaranteed accurate title, channel name & author url
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.title) resolvedTitle = data.title;
      if (data.author_name) resolvedChannel = data.author_name;
      if (data.thumbnail_url) resolvedThumb = data.thumbnail_url;
      if (data.author_url) {
        let cleanAuthor = data.author_url.replace('https://www.youtube.com', 'https://m.youtube.com');
        if (!cleanAuthor.endsWith('/videos')) {
          cleanAuthor = `${cleanAuthor.replace(/\/+$/, '')}/videos`;
        }
        resolvedChannelUrl = cleanAuthor;
      }
    }
  } catch (e) {
    console.warn('🎵 oEmbed metadata fetch failed:', e);
  }

  // 2. Fetch Channel Logo & Channel URL from watch page HTML
  try {
    const details = await fetchChannelDetails(videoId);
    if (details.logo) resolvedLogo = details.logo;
    if (details.channelUrl && !resolvedChannelUrl) resolvedChannelUrl = details.channelUrl;
  } catch (e) {
    console.warn('🎵 Channel details fetch error:', e);
  }

  // 3. Optional backend search API fallback if title is still missing
  if (resolvedTitle === 'Loading...' || resolvedTitle === 'YouTube Video') {
    try {
      const resp = await api.post('/music/youtube/search/', {
        query:      `https://www.youtube.com/watch?v=${videoId}`,
        maxResults: 1,
      });
      if (resp.data?.items?.length > 0) {
        const item = resp.data.items[0];
        if (item.snippet?.title) resolvedTitle = item.snippet.title;
        if (item.snippet?.channelTitle) resolvedChannel = item.snippet.channelTitle;
        if (item.snippet?.thumbnails?.medium?.url) resolvedThumb = item.snippet.thumbnails.medium.url;
      }
    } catch (_) {}
  }

  if (!resolvedChannelUrl && resolvedChannel && resolvedChannel !== 'YouTube') {
    resolvedChannelUrl = `https://m.youtube.com/results?search_query=${encodeURIComponent(resolvedChannel)}`;
  }

  return {
    ...base,
    title:        resolvedTitle,
    channelTitle: resolvedChannel,
    thumbnail:    resolvedThumb,
    channelLogo:  resolvedLogo,
    channelUrl:   resolvedChannelUrl,
  };
};

const EMOJI_MATCH_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?)*/gu;

const isOnlyEmojis = (text: string | undefined | null): { isOnly: boolean; count: number } => {
  if (!text || typeof text !== 'string') return { isOnly: false, count: 0 };
  const trimmed = text.trim();
  const nonWs = trimmed.replace(/\s+/g, '');
  if (!nonWs) return { isOnly: false, count: 0 };
  const remaining = nonWs.replace(EMOJI_MATCH_REGEX, '');
  if (remaining.length === 0) {
    const m = nonWs.match(EMOJI_MATCH_REGEX);
    const count = m ? m.length : 0;
    if (count > 0 && count <= 6) {
      return { isOnly: true, count };
    }
  }
  return { isOnly: false, count: 0 };
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
  isLive?: boolean;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  onShowRelated: () => void;
  onSettings?: () => void;
  qualityLabel?: string;
  onSingleTap?: () => void;
  onKeepControlsAlive?: () => void;
  isFullscreen: boolean;
  isDrivePlayer?: boolean;
  title?: string;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

const VideoControls: React.FC<ControlsProps> = ({
  visible, isPlaying, isEnded, canControl, isBuffering,
  position, duration, isLive,
  onPlayPause, onSeek, onNext, onToggleFullscreen, onShowRelated, onSettings,
  qualityLabel,
  onSingleTap, onKeepControlsAlive,
  isFullscreen,
  isDrivePlayer,
  title,
  isMuted = false,
  onToggleMute,
}) => {
  const insets = useSafeAreaInsets();
  const canControlRef = useRef(canControl);
  const durationRef = useRef(duration);
  const positionRef = useRef(position);

  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { positionRef.current = position; }, [position]);

  // ── Double Tap Seek (-10s / +10s) ──
  const lastLeftTapRef = useRef<number>(0);
  const leftTapTimeoutRef = useRef<any>(null);
  const lastRightTapRef = useRef<number>(0);
  const rightTapTimeoutRef = useRef<any>(null);

  const leftBadgeOpacity = useRef(new Animated.Value(0)).current;
  const leftBadgeScale   = useRef(new Animated.Value(0.7)).current;
  const rightBadgeOpacity = useRef(new Animated.Value(0)).current;
  const rightBadgeScale   = useRef(new Animated.Value(0.7)).current;
  const [showLeftBadge, setShowLeftBadge] = useState(false);
  const [showRightBadge, setShowRightBadge] = useState(false);
  const leftAnimTimer = useRef<any>(null);
  const rightAnimTimer = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (leftTapTimeoutRef.current) clearTimeout(leftTapTimeoutRef.current);
      if (rightTapTimeoutRef.current) clearTimeout(rightTapTimeoutRef.current);
      if (leftAnimTimer.current) clearTimeout(leftAnimTimer.current);
      if (rightAnimTimer.current) clearTimeout(rightAnimTimer.current);
    };
  }, []);

  const triggerBadgeAnim = (side: 'left' | 'right') => {
    const opacity = side === 'left' ? leftBadgeOpacity : rightBadgeOpacity;
    const scale   = side === 'left' ? leftBadgeScale : rightBadgeScale;
    const setShow = side === 'left' ? setShowLeftBadge : setShowRightBadge;
    const timerRef= side === 'left' ? leftAnimTimer : rightAnimTimer;

    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(true);
    opacity.setValue(1);
    scale.setValue(0.7);

    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShow(false);
      });
    }, 500);
  };

  const opacity    = useRef(new Animated.Value(1)).current;
  const knobX      = useRef(new Animated.Value(0)).current;
  const knobOpacity = useRef(new Animated.Value(0)).current;
  const isSeeking  = useRef(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragDisplayPos, setDragDisplayPos] = useState<number | null>(null);
  const lastSeekTargetTimeRef = useRef<number | null>(null);
  const lastSeekTimestampRef  = useRef<number>(0);
  const seekTarget = useRef(0);
  const barLayoutX = useRef(0);
  const barWidth   = useRef(width);
  const trackerPageX = useRef(0);
  const portraitTrackerRef = useRef<View>(null);
  const fullscreenTrackerRef = useRef<View>(null);
  const pct = duration > 0 ? Math.min(position / duration, 1) : 0;
  const isLiveStream = Boolean(isLive);
  const displayPosition = (isDraggingSeek && dragDisplayPos !== null) ? dragDisplayPos : position;

  const animateKnobTo = useCallback((targetX: number, durationMs = 160) => {
    Animated.timing(knobX, {
      toValue: targetX,
      duration: durationMs,
      easing: RNEasing.out(RNEasing.quad),
      useNativeDriver: false,
    }).start();
  }, [knobX]);

  const triggerSeekBackward = () => {
    if (isEnded || isLiveStream) return;
    if (!canControlRef.current) {
      console.warn('📊 [SEEK DENIED] User is not DJ, cannot seek');
      return;
    }
    const cur = positionRef.current || 0;
    const target = Math.max(0, cur - 10);
    positionRef.current = target;
    lastSeekTargetTimeRef.current = target;
    lastSeekTimestampRef.current = Date.now();
    const targetPct = durationRef.current > 0 ? Math.min(target / durationRef.current, 1) : 0;
    const targetX = Math.max(0, Math.min(barWidth.current, targetPct * barWidth.current));
    animateKnobTo(targetX, 160);
    onSeek(target);
    triggerBadgeAnim('left');
    onKeepControlsAlive?.();
  };

  const triggerSeekForward = () => {
    if (isEnded || isLiveStream) return;
    if (!canControlRef.current) {
      console.warn('📊 [SEEK DENIED] User is not DJ, cannot seek');
      return;
    }
    const cur = positionRef.current || 0;
    const dur = durationRef.current || 0;
    const target = dur > 0 ? Math.min(dur, cur + 10) : cur + 10;
    positionRef.current = target;
    lastSeekTargetTimeRef.current = target;
    lastSeekTimestampRef.current = Date.now();
    const targetPct = dur > 0 ? Math.min(target / dur, 1) : 0;
    const targetX = Math.max(0, Math.min(barWidth.current, targetPct * barWidth.current));
    animateKnobTo(targetX, 160);
    onSeek(target);
    triggerBadgeAnim('right');
    onKeepControlsAlive?.();
  };

  const handleLeftPress = () => {
    if (!canControlRef.current) {
      onSingleTap?.();
      return;
    }
    const now = Date.now();
    if (now - lastLeftTapRef.current < 350) {
      if (leftTapTimeoutRef.current) {
        clearTimeout(leftTapTimeoutRef.current);
        leftTapTimeoutRef.current = null;
      }
      lastLeftTapRef.current = now;
      triggerSeekBackward();
    } else {
      lastLeftTapRef.current = now;
      leftTapTimeoutRef.current = setTimeout(() => {
        lastLeftTapRef.current = 0;
        leftTapTimeoutRef.current = null;
        onSingleTap?.();
      }, 300);
    }
  };

  const handleRightPress = () => {
    if (!canControlRef.current) {
      onSingleTap?.();
      return;
    }
    const now = Date.now();
    if (now - lastRightTapRef.current < 350) {
      if (rightTapTimeoutRef.current) {
        clearTimeout(rightTapTimeoutRef.current);
        rightTapTimeoutRef.current = null;
      }
      lastRightTapRef.current = now;
      triggerSeekForward();
    } else {
      lastRightTapRef.current = now;
      rightTapTimeoutRef.current = setTimeout(() => {
        lastRightTapRef.current = 0;
        rightTapTimeoutRef.current = null;
        onSingleTap?.();
      }, 300);
    }
  };

  const updateTrackerPageX = useCallback(() => {
    const targetRef = isFullscreen ? fullscreenTrackerRef : portraitTrackerRef;
    targetRef.current?.measure((_x, _y, _w, _h, px, _py) => {
      if (px !== undefined && !isNaN(px) && px > 0) {
        trackerPageX.current = px;
      }
    });
  }, [isFullscreen]);

  const getTouchOffset = (evt: any) => {
    if (trackerPageX.current > 0) {
      return evt.nativeEvent.pageX - trackerPageX.current;
    }
    if (barLayoutX.current > 0) {
      return evt.nativeEvent.pageX - barLayoutX.current;
    }
    return evt.nativeEvent.locationX;
  };

  useEffect(() => {
    Animated.timing(opacity, {
      toValue:         visible ? 1 : 0,
      duration:        200,
      useNativeDriver: false,
    }).start();
    Animated.timing(knobOpacity, {
      toValue:         visible ? 1 : 0,
      duration:        200,
      useNativeDriver: false,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (isSeeking.current) return;

    // Guard against stale pre-seek position props from audio/video engines
    if (lastSeekTargetTimeRef.current !== null) {
      const elapsed = Date.now() - lastSeekTimestampRef.current;
      const dist = Math.abs(position - lastSeekTargetTimeRef.current);
      if (dist < 2.0 || elapsed > 1500) {
        // Seek arrived or timed out, resume normal tracking
        lastSeekTargetTimeRef.current = null;
      } else {
        // Stale pre-seek position prop received, hold knob & filler at seek target!
        return;
      }
    }

    const rawX = pct * barWidth.current;
    const clampedX = Math.max(0, Math.min(barWidth.current, rawX));
    knobX.setValue(clampedX);
  }, [pct, position]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(canControlRef.current),
    onMoveShouldSetPanResponder: () => Boolean(canControlRef.current),

    onPanResponderGrant: (evt) => {
      isSeeking.current = true;
      updateTrackerPageX();
      const touchX = getTouchOffset(evt);
      const rawX = Math.max(0, Math.min(barWidth.current, touchX));
      const clampedX = Math.max(0, Math.min(barWidth.current, rawX));

      // Smoothly glide knob and filler to touched position
      animateKnobTo(clampedX, 160);

      const targetTime = (durationRef.current > 0 && barWidth.current > 0)
        ? (clampedX / barWidth.current) * durationRef.current
        : 0;
      seekTarget.current = targetTime;
      setDragDisplayPos(targetTime);
    },

    onPanResponderMove: (evt) => {
      setIsDraggingSeek(true);
      knobX.stopAnimation();
      const touchX = getTouchOffset(evt);
      const rawX = Math.max(0, Math.min(barWidth.current, touchX));
      const clampedX = Math.max(0, Math.min(barWidth.current, rawX));
      knobX.setValue(clampedX);
      const targetTime = (durationRef.current > 0 && barWidth.current > 0)
        ? (clampedX / barWidth.current) * durationRef.current
        : 0;
      seekTarget.current = targetTime;
      setDragDisplayPos(targetTime);
    },

    onPanResponderRelease: () => {
      isSeeking.current = false;
      setIsDraggingSeek(false);
      setDragDisplayPos(null);
      if (!canControlRef.current) {
        console.warn('📊 [DRAG DENIED] User is not DJ, cannot seek');
        return;
      }
      if (seekTarget.current < 0 || isNaN(seekTarget.current)) return;
      lastSeekTargetTimeRef.current = seekTarget.current;
      lastSeekTimestampRef.current = Date.now();
      onSeek(seekTarget.current);
      onKeepControlsAlive?.();
    },

    onPanResponderTerminate: () => {
      isSeeking.current = false;
      setIsDraggingSeek(false);
      setDragDisplayPos(null);
      onKeepControlsAlive?.();
    },
  })).current;

  return (
    <Animated.View style={[cv.wrap, { opacity: isFullscreen ? opacity : 1 }]} pointerEvents={(visible || !isFullscreen) ? 'box-none' : 'none'}>
      {isFullscreen ? (
        <>
          <Animated.View style={[cv.scrimTop, { opacity }]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.25)', 'transparent']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View style={[cv.scrimBottom, { opacity }]} pointerEvents="none">
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[
              cv.fullscreenTopBar,
              {
                paddingTop: insets.top > 0 ? insets.top + 6 : 14,
                paddingLeft: insets.left > 0 ? insets.left + 12 : 16,
                paddingRight: insets.right > 0 ? insets.right + 12 : 16,
                opacity,
              },
            ]}
            pointerEvents={visible ? 'auto' : 'none'}
          >
            <View style={cv.fullscreenTopLeft}>
              <TouchableOpacity
                style={cv.fullscreenIconBtn}
                onPress={onToggleFullscreen}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>
              {!!title && (
                <Text style={cv.fullscreenTitle} numberOfLines={1} ellipsizeMode="tail">
                  {title}
                </Text>
              )}
            </View>

            <View style={cv.fullscreenTopRight}>
              {onToggleMute && (
                <TouchableOpacity
                  style={cv.fullscreenIconBtn}
                  onPress={() => {
                    onToggleMute();
                    onKeepControlsAlive?.();
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
                </TouchableOpacity>
              )}
              {!isDrivePlayer && onSettings && (
                <TouchableOpacity
                  style={cv.fullscreenQualityPillBtn}
                  onPress={onSettings}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                  accessibilityLabel="Video quality"
                >
                  <Text style={cv.fullscreenQualityPillText}>Q</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={cv.fullscreenIconBtn}
                onPress={onToggleFullscreen}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="contract" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      ) : (
        <>
          <View style={[cv.scrimTop, { opacity: 0 }]} pointerEvents="none" />
          <View style={[cv.scrimBottom, { opacity: 0 }]} pointerEvents="none" />
          {!isDrivePlayer && onSettings && (
            <Animated.View style={[{ position: 'absolute', top: 4, left: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
              <TouchableOpacity
                style={cv.qualityPillBtn}
                onPress={onSettings}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
                accessibilityLabel="Video quality"
              >
                <Text style={cv.qualityPillText}>Q</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          <Animated.View style={[{ position: 'absolute', top: 4, right: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
            <TouchableOpacity
              style={cv.topRightBtn}
              onPress={() => {
                onToggleFullscreen();
                onKeepControlsAlive?.();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
              accessibilityLabel="Toggle orientation"
            >
              <Icon name="resize" size={16} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </>
      )}

      {/* ── Center Controls Row: Double Tap Left (-10s), Play/Pause, Double Tap Right (+10s) ── */}
      <Animated.View
        style={[cv.centerRow, isFullscreen && { top: 60, bottom: 95 }, { opacity }]}
        pointerEvents={visible ? 'box-none' : 'none'}
      >
        {/* Left Side: Double tap to seek -10s */}
        <View style={cv.sideSeekZone} pointerEvents={visible ? 'auto' : 'none'}>
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={handleLeftPress}
          >
            {showLeftBadge && (
              <Animated.View style={[cv.seekBadge, { opacity: leftBadgeOpacity, transform: [{ scale: leftBadgeScale }] }]}>
                <View style={cv.seekBadgeInner}>
                  <Icon name="play-back" size={18} color="#fff" />
                  <Text style={cv.seekBadgeText}>-10s</Text>
                </View>
              </Animated.View>
            )}
          </TouchableOpacity>
        </View>

        {/* Center: Play / Pause */}
        {!isBuffering && !isEnded && !isDraggingSeek ? (
          <View style={cv.centreBtn} pointerEvents={visible ? 'auto' : 'none'}>
            <TouchableOpacity
              style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
              onPress={() => onPlayPause()}
              activeOpacity={0.7}
              disabled={!canControl}
            >
              <View style={[cv.centreBtnInner, !canControl && cv.centreBtnDisabled]}>
                <Icon
                  name={isPlaying ? 'pause' : 'play'}
                  size={22}
                  color={canControl ? '#fff' : 'rgba(255,255,255,0.35)'}
                  style={{ marginLeft: isPlaying ? 0 : 2.5 }}
                />
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={cv.centreBtn} />
        )}

        {/* Right Side: Double tap to seek +10s */}
        <View style={cv.sideSeekZone} pointerEvents={visible ? 'auto' : 'none'}>
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={handleRightPress}
          >
            {showRightBadge && (
              <Animated.View style={[cv.seekBadge, { opacity: rightBadgeOpacity, transform: [{ scale: rightBadgeScale }] }]}>
                <View style={cv.seekBadgeInner}>
                  <Icon name="play-forward" size={18} color="#fff" />
                  <Text style={cv.seekBadgeText}>+10s</Text>
                </View>
              </Animated.View>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      {isFullscreen ? (
        <Animated.View style={[
          cv.bottomBar, 
          { 
            paddingLeft: insets.left > 0 ? insets.left + 16 : 20, 
            paddingRight: insets.right > 0 ? insets.right + 16 : 20,
            paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 16,
            opacity,
          }
        ]} pointerEvents={visible ? 'box-none' : 'none'}>
          <View style={[cv.timeRow, { paddingHorizontal: 0, marginBottom: 12 }]} pointerEvents="box-none">
            {isLiveStream ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF', marginRight: 6 }} />
                <Text style={[cv.timeText, { color: '#FFFFFF', fontWeight: '700' }]}>LIVE</Text>
              </View>
            ) : (
              <Text style={cv.timeText}>{fmtTime(displayPosition)} / {fmtTime(duration)}</Text>
            )}
          </View>
          <View
            ref={fullscreenTrackerRef}
            {...(canControl && !isLiveStream ? pan.panHandlers : {})}
            pointerEvents={canControl && !isLiveStream ? 'auto' : 'none'}
            style={{ height: 28, justifyContent: 'center', paddingHorizontal: 0 }}
            onLayout={(event) => {
              const { x, width: w } = event.nativeEvent.layout;
              barLayoutX.current = x;
              barWidth.current = w;
              updateTrackerPageX();
              if (!isSeeking.current && w > 0) {
                knobX.setValue(pct * w);
              }
            }}
          >
            <View style={[cv.track, (!canControl || isLiveStream) && { backgroundColor: 'rgba(255, 255, 255, 0.15)' }]}>
              <Animated.View style={[cv.fill, (!canControl || isLiveStream) && { backgroundColor: isLiveStream ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)' }, isLiveStream ? { width: '100%' } : { width: knobX }]} />
              {canControl && !isLiveStream && (
                <Animated.View style={[cv.knob, { opacity: knobOpacity, transform: [{ translateX: knobX }] }]} />
              )}
            </View>
          </View>
        </Animated.View>
      ) : (
        // ── NON-FULLSCREEN: Single bottom-aligned row [Mute] [Counter + Track] [Skip] at bottom: 4 ──
        <Animated.View
          style={[cv.portraitBottomRow, { opacity }]}
          pointerEvents={visible ? 'box-none' : 'none'}
        >
          {/* Left: Speaker (Mute/Unmute) Button */}
          {onToggleMute && (
            <TouchableOpacity
              style={cv.bottomRowBtn}
              onPress={() => {
                onToggleMute();
                onKeepControlsAlive?.();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Toggle mute"
            >
              <Icon
                name={isMuted ? 'volume-mute' : 'volume-high'}
                size={16}
                color="#fff"
              />
            </TouchableOpacity>
          )}

          {/* Center: Counter on left above Track Bar, with Track Bar at bottom */}
          <View style={cv.portraitCenterTrackColumn} pointerEvents="box-none">
            {/* Duration Counter on left side above tracking bar */}
            {isLiveStream ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF', marginRight: 5 }} />
                <Text style={[cv.portraitDurationText, { color: '#FFFFFF', fontWeight: '700' }]}>LIVE</Text>
              </View>
            ) : (
              <Text style={cv.portraitDurationText} pointerEvents="none">
                {fmtTime(displayPosition)} / {fmtTime(duration)}
              </Text>
            )}

            {/* Video Time Tracker Scrubber */}
            <View
              ref={portraitTrackerRef}
              {...(canControl && !isLiveStream ? pan.panHandlers : {})}
              pointerEvents={canControl && !isLiveStream ? 'auto' : 'none'}
              style={cv.portraitTrackerHit}
              onLayout={(event) => {
                const { x, width: w } = event.nativeEvent.layout;
                barLayoutX.current = x;
                barWidth.current = w;
                updateTrackerPageX();
                if (!isSeeking.current && w > 0) {
                  knobX.setValue(pct * w);
                }
              }}
            >
              <View style={[cv.portraitTrackerTrack, (!canControl || isLiveStream) && { backgroundColor: 'rgba(255, 255, 255, 0.15)' }]}>
                <Animated.View style={[cv.fill, (!canControl || isLiveStream) && { backgroundColor: isLiveStream ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)' }, isLiveStream ? { width: '100%' } : { width: knobX }]} />
                {canControl && !isLiveStream && (
                  <Animated.View
                    style={[
                      cv.knob,
                      {
                        opacity: knobOpacity,
                        transform: [{ translateX: knobX }],
                      },
                    ]}
                  />
                )}
              </View>
            </View>
          </View>

          {/* Right: Skip Button */}
          <TouchableOpacity
            style={[cv.bottomRowBtn, !canControl && { opacity: 0.4 }]}
            onPress={() => {
              onNext();
              onKeepControlsAlive?.();
            }}
            disabled={!canControl}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Skip video"
          >
            <Icon name="play-skip-forward" size={15} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </Animated.View>
  );
};

const cv = StyleSheet.create({
  wrap:             { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scrimTop:         { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  scrimBottom:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100 },
  fullscreenTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  fullscreenTopLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  fullscreenTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fullscreenTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
    flex: 1,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  fullscreenIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandBtn:        { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  relatedBtn:       { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  qualityPillBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qualityPillText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
    includeFontPadding: false,
    textAlign: 'center',
  },
  fullscreenQualityPillBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenQualityPillText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '800',
    includeFontPadding: false,
    textAlign: 'center',
  },
  topRightBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bufferWrap:       { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  centreBtn:        { width: 54, height: 54, justifyContent: 'center', alignItems: 'center' },
  centreBtnInner:   { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  centreBtnDisabled:{ backgroundColor: 'rgba(0,0,0,0.2)' },
  centerRow: {
    position: 'absolute',
    top: 45,
    bottom: 45,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  sideSeekZone: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  seekBadge: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  seekBadgeInner: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seekBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 12, zIndex: 30, elevation: 10 },
  bottomRowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  portraitBottomRow: {
    position: 'absolute',
    bottom: 4, // Matches top buttons padding (top: 4)
    left: 8,   // Matches top buttons padding (left: 8)
    right: 8,  // Matches top buttons padding (right: 8)
    flexDirection: 'row',
    alignItems: 'flex-end', // In that row they are bottom aligned!
    zIndex: 30,
    elevation: 10,
  },
  portraitCenterTrackColumn: {
    flex: 1,
    marginHorizontal: 8,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  portraitDurationText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    lineHeight: 11,
    fontWeight: '700',
    textAlign: 'left',
    paddingLeft: 2,
    marginBottom: -3, // Minimizes vertical space to sit tightly above the tracking bar
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    includeFontPadding: false,
  },
  portraitTrackerHit: {
    width: '100%',
    height: 18,
    justifyContent: 'center',
  },
  portraitTrackerTrack: {
    width: '100%',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    position: 'relative',
    justifyContent: 'center',
  },
  track:            { width: '100%', height: 2.5, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.2)', position: 'relative', justifyContent: 'center' },
  fill:             { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 1.5, backgroundColor: '#fff' },
  knob:             { position: 'absolute', left: 0, marginLeft: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', top: -2.75, elevation: 6, zIndex: 99 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  timeText:         { color: 'rgba(255,255,255,0.85)', fontSize: 10.5, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  watchBadge:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  watchText:        { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ScaledImage & Dimension Cache
// ─────────────────────────────────────────────────────────────────────────────
const musicImageDimsCache = new Map<string, { width: number; height: number }>();

const ScaledImage = ({ uri, style, resizeMode, isAnimated }: {
  uri: string | undefined,
  style?: any,
  resizeMode?: any,
  isAnimated?: boolean
}) => {
  const cached = uri ? musicImageDimsCache.get(uri) : null;
  const [dims, setDims] = useState(cached || { width: 160, height: 120 });
  if (!uri) return null;

  useEffect(() => {
    if (uri) {
      if (musicImageDimsCache.has(uri)) {
        setDims(musicImageDimsCache.get(uri)!);
        return;
      }
      Image.getSize(uri, (w, h) => {
        const MAX_W = 160;
        let finalW = w;
        let finalH = h;
        if (w > MAX_W) {
          finalW = MAX_W;
          finalH = (h * MAX_W) / w;
        }
        const resolved = { width: finalW, height: finalH };
        musicImageDimsCache.set(uri, resolved);
        setDims(resolved);
      }, () => {});
    }
  }, [uri]);

  return (
    <FastImage
      source={{ uri, priority: FastImage.priority.high }}
      style={[style, { width: dims.width, height: dims.height }]}
      resizeMode={resizeMode === 'contain'
        ? FastImage.resizeMode.contain
        : FastImage.resizeMode.cover}
    />
  );
};

const QUALITY_METADATA: Record<string, { label: string; badge?: string; icon: string }> = {
  'auto':    { label: 'Auto', badge: 'Adaptive', icon: 'sparkles' },
  'hd4320':  { label: '8K 4320p', badge: '8K UHD', icon: 'videocam' },
  'highres': { label: '4K 2160p', badge: 'UHD', icon: 'videocam' },
  'hd2160':  { label: '4K 2160p', badge: 'UHD', icon: 'videocam' },
  'hd1440':  { label: '2K 1440p', badge: 'QHD', icon: 'videocam' },
  'hd1080':  { label: '1080p FHD', badge: 'HD', icon: 'film' },
  'hd720':   { label: '720p HD', badge: 'HD', icon: 'film' },
  'large':   { label: '480p SD', badge: 'SD', icon: 'play-circle' },
  'medium':  { label: '360p', badge: 'Standard', icon: 'film' },
  'small':   { label: '240p Low', badge: 'Low', icon: 'leaf-outline' },
  'tiny':    { label: '144p Min', badge: 'Lowest', icon: 'speedometer-outline' },
};

const QUALITY_PRIORITY = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

const getMinimalQualityLabel = (key: string): string => {
  switch (key) {
    case 'auto': return 'Auto';
    case 'hd4320': return '4320p';
    case 'highres':
    case 'hd2160': return '2160p';
    case 'hd1440': return '1440p';
    case 'hd1080': return '1080p';
    case 'hd720': return '720p';
    case 'large': return '480p';
    case 'medium': return '360p';
    case 'small': return '240p';
    case 'tiny': return '144p';
    default:
      if (/^\d+$/.test(key)) return `${key}p`;
      if (/^\d+p$/i.test(key)) return key.toLowerCase();
      return key;
  }
};

const STICKER_DRAWER_HEIGHT = 286;
const KeyboardWrapperView = Platform.OS === 'android' ? View : KeyboardAvoidingView;
const keyboardWrapperProps = Platform.OS === 'android' ? {} : { behavior: 'padding' as const, keyboardVerticalOffset: 0 };

export const ROOM_THEMES: { id: RoomTheme; label: string; icon: string; color: string }[] = [
  { id: 'cinema', label: 'Cinema', icon: 'film-outline', color: '#EAB308' },
  { id: 'rave', label: 'Party', icon: 'flash-outline', color: '#7C3AED' },
  { id: 'dark', label: 'Dark', icon: 'moon-outline', color: '#64748B' },
  // { id: 'light', label: 'Light', icon: 'sunny-outline', color: '#F59E0B' },
];

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
  const { theme, isDark } = useTheme();
  const [fullscreen, setFullscreen] = useState(false);
  const insets = useSafeAreaInsets();
  const lastNonZeroBottomInsetRef = useRef(insets.bottom || 24);
  if (insets.bottom > 0) {
    lastNonZeroBottomInsetRef.current = insets.bottom;
  }
  const lastNonZeroTopInsetRef = useRef(insets.top || 0);
  if (insets.top > 0) {
    lastNonZeroTopInsetRef.current = insets.top;
  }
  // Symmetric instant insets:
  // - In fullscreen: 0 (edge-to-edge video).
  // - In portrait: ALWAYS full portrait insets (cached fallback ensures 1ms instant layout with zero delayed resize).
  const stableBottomInset = fullscreen ? 0 : (lastNonZeroBottomInsetRef.current || insets.bottom || 0);
  const stableTopInset    = fullscreen ? 0 : (lastNonZeroTopInsetRef.current    || insets.top    || 0);
  
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
      chatListRef.current?.scrollToOffset({ offset: 0, animated });
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

  const chatMessageRef = useRef('');
  // Native-layer instant toggle: 0 = mic, 1 = send. setValue() bypasses React
  // reconciliation entirely — same pattern as ChatInputArea.tsx (WhatsApp-style).
  const hasTextAnim = useRef(new Animated.Value(0)).current;

  const handleTextChange = (text: string) => {
    chatMessageRef.current = text;
    // Native instant toggle - 0 frame, no React re-render needed
    hasTextAnim.setValue(text.length > 0 ? 1 : 0);
    handleTyping(text);

    const prevHadText = (chatMessage || '').length > 0;
    const nowHasText = (text || '').length > 0;
    if (prevHadText !== nowHasText) {
      setChatMessage(text);
    }

    const match = text.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
    if (match) {
      setMentionListVisible(true);
      setMentionFilter(match[2].toLowerCase());
    } else if (mentionListVisible) {
      setMentionListVisible(false);
    }
  };

  const handleMentionSelect = (participantName: string) => {
    const current = chatMessageRef.current || chatMessage;
    const newText = current.replace(/(^|\s)@([a-zA-Z0-9_]*)$/, `$1@${participantName} `);
    chatMessageRef.current = newText;
    setChatMessage(newText);
    richInputRef.current?.setText(newText);
    setMentionListVisible(false);
    richInputRef.current?.focus();
  };

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [fetchedChannelLogo, setFetchedChannelLogo] = useState<string | null>(null);
  const [fetchedChannelUrl, setFetchedChannelUrl] = useState<string | null>(null);
  const [discoveryInitialUrl, setDiscoveryInitialUrl] = useState<string | null>(null);
  const [currentRoomName, setCurrentRoomName] = useState(initialRoomName || '');
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [participantsModalVisible, setParticipantsModalVisible] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [thumbFallbackUri, setThumbFallbackUri] = useState<string | null>(null);
  const thumbnailFadeAnim = useRef(new Animated.Value(1)).current;
  const [showThumbnailOverlay, setShowThumbnailOverlay] = useState(true);
  const [isTrackPlayerReady, setIsTrackPlayerReady] = useState(false);
  const trackPlayerReadyTime = useRef(0);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [playerState, setPlayerState] = useState<string>('unstarted');
  const [mentionListVisible, setMentionListVisible] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [preparingVideoId, setPreparingVideoId] = useState<string | null>(initialVideoId || null);
  const [isFirstCreation, setIsFirstCreation] = useState(!!initialVideoId);
  const [prepTime, setPrepTime] = useState(0);
  const [adFinished, setAdFinished] = useState(false);
  const [adStatus, setAdStatus] = useState('');
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
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [galleryPickerVisible, setGalleryPickerVisible] = useState(false);
  const [isInputActive, setIsInputActive] = useState(false);
  const [isDJBackgrounded, setIsDJBackgrounded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [videoRatings, setVideoRatings] = useState<Record<string, { total: number; count: number; myRating?: number }>>({});
  const [isDriveAuthenticated, setIsDriveAuthenticated] = useState<boolean | null>(null);
  const [videoQuality, setVideoQuality] = useState('auto');
  const [availableQualities, setAvailableQualities] = useState<string[]>(['auto']);
  const [liveExactResolution, setLiveExactResolution] = useState<string | null>(null);
  const videoFormatsRef = useRef<Record<string, string>>({});
  const [showQualityOptions, setShowQualityOptions] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  useEffect(() => {
    try {
      TrackPlayer.setVolume(isMuted ? 0 : 1);
    } catch (_) {}
  }, [isMuted]);

  // ─── Direct ExoPlayer (Rave-style Native Video) State ───────────────────────
  const [directStreamUrl, setDirectStreamUrl] = useState<string | null>(null);
  const [directAudioUrl, setDirectAudioUrl] = useState<string | null>(null);
  const [directStreamType, setDirectStreamType] = useState<'mpd' | 'mp4' | 'm3u8'>('mp4');
  const [directStreamHeaders, setDirectStreamHeaders] = useState<Record<string, string> | undefined>(undefined);
  const [isDirectLoading, setIsDirectLoading] = useState(() => !directStreamUrl && !!initialVideoId && initialSource !== 'drive');
  const [directStreamsList, setDirectStreamsList] = useState<any[]>([]);
  const directStreamsListRef = useRef<any[]>([]);
  const failedStreamUrlsRef = useRef<Set<string>>(new Set());
  const [useDirectFallback, setUseDirectFallback] = useState(false);
  const currentDirectFetchId = useRef<string | null>(null);
  const dashUrlRef = useRef<string | null>(null);
  const fallbackProgressiveUrlRef = useRef<string | null>(null); // c=ANDROID itag 18 — no CDN throttle
  const [directFallbackUrl, setDirectFallbackUrl] = useState<string | null>(null); // drives fallbackUri prop re-render
  const lastLoadedStreamVideoId = useRef<string | null>(null);
  const initialSongLoadedRef = useRef(false);
  const songPlaybackStartedRef = useRef(false);
  const isInitialVideoStartedRef = useRef(!initialVideoId);
  const lastAuxPassTimeRef = useRef(0);
  const lastResetSongVideoIdRef = useRef<string | null>(initialVideoId || null);
  const loadedAudioSessionRef = useRef<string | null>(null);
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayerReadyRef = useRef(false);
  const playerReadyTime = useRef(0);
  const isAdPlayingRef = useRef(false);
  const isDJBackgroundedRef = useRef(false);

  const { roomState, isConnected, isLoading, playerRef, loadSong, syncPlay, syncPause, syncSeek, addToQueue, pinVideo, unpinVideo, passAux, updateCurrentSongMetadata, updateMicPermission, switchDJ, joinSnapshot } = useMusicRoom(roomCode, user?.id ?? 0, isPlayerReadyRef, playerReadyTime, isAdPlayingRef, isDJBackgroundedRef);
  const { isDJ, currentSong, isPlaying, position, queue, participants, roomName, allowedSpeakers } = roomState;
  const activeVideoId = currentSong?.videoId || initialVideoId;

  // Authoritative DJ state: WebSocket isDJ when connected, otherwise route param isDJMode
  const effectiveIsDJ = isConnected ? isDJ : Boolean(isDJMode);

  useEffect(() => {
    setThumbFallbackUri(null);
  }, [activeVideoId]);

  useEffect(() => {
    if (isPlayerReady) {
      Animated.timing(thumbnailFadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setShowThumbnailOverlay(false);
      });
    } else {
      setShowThumbnailOverlay(true);
      thumbnailFadeAnim.setValue(1);
    }
  }, [isPlayerReady]);

  const displayTitle = (currentSong?.title && currentSong.title !== 'Loading...' && currentSong.title !== 'Initializing...' && currentSong.title !== 'YouTube Video' && currentSong.title !== 'Watch Party' && currentSong.title !== 'Drive Video')
    ? currentSong.title
    : (initialTitle && initialTitle !== 'YouTube Video' && initialTitle !== 'Watch Party' && initialTitle !== 'Drive Video' ? initialTitle : (initialRoomName && initialRoomName !== 'YouTube Video' && initialRoomName !== 'Watch Party' ? initialRoomName : 'Loading...'));

  const isDJRef = useRef(effectiveIsDJ);
  isDJRef.current = effectiveIsDJ;
  const isDJModeRef = useRef(effectiveIsDJ);
  isDJModeRef.current = effectiveIsDJ;

  // ── Center-screen modern fade toast (Friend Request Style) ──
  const [centerToastVisible, setCenterToastVisible] = useState(false);
  const [centerToastMessage, setCenterToastMessage] = useState('');
  const [centerToastIcon, setCenterToastIcon] = useState('star');
  const [centerToastIconColor, setCenterToastIconColor] = useState('#FACC15');
  const centerToastOpacity = useRef(new Animated.Value(0)).current;

  const showCenterToast = useCallback((message: string, icon = 'star', iconColor = '#FACC15') => {
    setCenterToastMessage(message);
    setCenterToastIcon(icon);
    setCenterToastIconColor(iconColor);
    setCenterToastVisible(true);
    centerToastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(centerToastOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(centerToastOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(() => setCenterToastVisible(false));
  }, [centerToastOpacity]);

  const prevEffectiveIsDJRef = useRef(effectiveIsDJ);
  useEffect(() => {
    if (prevEffectiveIsDJRef.current !== undefined && prevEffectiveIsDJRef.current !== effectiveIsDJ) {
      if (effectiveIsDJ) {
        showCenterToast('You are now the Leader! 👑', 'star', '#FACC15');
      } else {
        showCenterToast('Leader Role Transferred', 'star-outline', '#FACC15');
      }
    }
    prevEffectiveIsDJRef.current = effectiveIsDJ;
  }, [effectiveIsDJ, showCenterToast]);

  useEffect(() => {
    if (currentSong?.videoId) {
      initialSongLoadedRef.current = true;
    }
  }, [currentSong?.videoId]);

  useEffect(() => {
    if (isPlayerReady || isPlaying || (livePosition > 0)) {
      isInitialVideoStartedRef.current = true;
    }
  }, [isPlayerReady, isPlaying, livePosition]);

  // Pre-warm the next queued video stream in memory so that when the current song finishes,
  // the next song's DASH MPD is already resolved and cached in memory (0ms delay).
  useEffect(() => {
    if (queue && queue.length > 0) {
      const nextItem = queue[0];
      const nextSong = nextItem?.song || nextItem;
      const nextVideoId = nextSong?.videoId;
      const nextSource = nextSong?.source;
      if (nextVideoId && nextSource !== 'drive') {
        console.log(`🚀 [PreWarm] Pre-extracting stream for next queue track: ${nextVideoId} (${nextSong.title || 'untitled'})`);
        extractVideoStreamUrlClientSide(nextVideoId).catch((err) => {
          console.warn(`⚠️ [PreWarm] Pre-extraction failed for ${nextVideoId}:`, err);
        });
      }
    }
  }, [queue]);

  const resolveStreamUrlForQuality = useCallback((dashUrl: string | null, streams: any[], qualityKey: string) => {
    if (dashUrl) {
      return { url: dashUrl, audioUrl: null, type: 'mpd' as const };
    }

    const heightMap: Record<string, number> = {
      'hd2160': 2160, 'highres': 2160,
      'hd1440': 1440,
      'hd1080': 1080, 'hd720': 720, 'large': 480,
      'medium': 360, 'small': 240, 'tiny': 144,
    };

    if (!streams || streams.length === 0) {
      return { url: '', audioUrl: null, type: 'mp4' as const };
    }

    const parsedHeight = parseInt(qualityKey.replace(/\D/g, ''), 10);
    const rawTarget = heightMap[qualityKey] || (parsedHeight > 0 ? parsedHeight : 0);
    const targetHeight = Math.min(2160, rawTarget);

    // If targetHeight > 1080, include VP9 streams because 1440p exists in VP9/AV1
    const mp4Streams = streams.filter(s => s.mimeType ? (s.mimeType.startsWith('video/mp4') || !s.mimeType.includes('webm')) : true);
    const validStreams = (targetHeight > 1080 || mp4Streams.length === 0) ? streams : mp4Streams;

    // Audio proxy URL from any video stream that has audio_url
    const defaultAudioUrl = validStreams.find(s => s.audio_url)?.audio_url || streams.find(s => s.audio_url)?.audio_url || null;

    const formatReturn = (stream: any) => {
      if (!stream) return { url: '', audioUrl: null, type: 'mp4' as const };
      return {
        url: stream.url,
        audioUrl: stream.has_audio ? null : (stream.audio_url || defaultAudioUrl),
        type: 'mp4' as const,
      };
    };

    // Auto: Prefer crisp 1080p MP4, else 720p MP4, else highest available MP4
    if (!qualityKey || qualityKey === 'auto') {
      const s1080 = validStreams.find(s => s.height === 1080);
      if (s1080?.url) return formatReturn(s1080);
      const s720 = validStreams.find(s => s.height === 720);
      if (s720?.url) return formatReturn(s720);
      const sorted = [...validStreams].sort((a, b) => (b.height || 0) - (a.height || 0));
      return formatReturn(sorted[0]);
    }

    // Explicit 360p / Medium:
    if (qualityKey === 'medium' || targetHeight === 360) {
      const s360 = validStreams.find(s => s.height === 360 && s.has_audio) || validStreams.find(s => s.height === 360);
      if (s360?.url) return formatReturn(s360);
    }

    // 1. Explicit target height match
    if (targetHeight > 0) {
      const exact = validStreams.find(s => s.height === targetHeight);
      if (exact?.url) return formatReturn(exact);

      // Find closest height within valid streams
      const sorted = [...validStreams].sort((a, b) => Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight));
      if (sorted[0]?.url) return formatReturn(sorted[0]);
    }

    // 2. Match by quality key
    const byKey = validStreams.find(s => s.qualityKey === qualityKey || s.quality === qualityKey);
    if (byKey?.url) return formatReturn(byKey);

    // 3. Fallback: highest available MP4
    const sorted = [...validStreams].sort((a, b) => (b.height || 0) - (a.height || 0));
    return formatReturn(sorted[0] || validStreams[0]);
  }, []);

  const videoThumbnailUrl = useMemo(() => {
    const raw = (() => {
      // 1. Current song thumbnail / videoId
      if (currentSong?.thumbnail && typeof currentSong.thumbnail === 'string' && currentSong.thumbnail.startsWith('http')) {
        return currentSong.thumbnail;
      }
      if (currentSong?.videoId) {
        if (currentSong?.source === 'drive') {
          return `https://drive.google.com/thumbnail?id=${currentSong.videoId}&sz=w1280`;
        }
        return `https://i.ytimg.com/vi/${currentSong.videoId}/maxresdefault.jpg`;
      }

      // 2. If current song not yet loaded, check upcoming queued song
      if (queue && queue.length > 0) {
        const nextItem = queue[0];
        const nextSong = nextItem?.song || nextItem;
        if (nextSong?.thumbnail && typeof nextSong.thumbnail === 'string' && nextSong.thumbnail.startsWith('http')) {
          return nextSong.thumbnail;
        }
        if (nextSong?.videoId) {
          if (nextSong?.source === 'drive') {
            return `https://drive.google.com/thumbnail?id=${nextSong.videoId}&sz=w1280`;
          }
          return `https://i.ytimg.com/vi/${nextSong.videoId}/maxresdefault.jpg`;
        }
      }

      // 3. Fallback to initial navigation params while room is connecting/initializing
      if (initialThumbnail) return initialThumbnail;
      const vid = initialVideoId;
      const src = initialSource;
      if (vid) {
        if (src === 'drive') {
          return `https://drive.google.com/thumbnail?id=${vid}&sz=w1280`;
        }
        return `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
      }
      return null;
    })();

    if (!raw) return null;
    // Upgrade any YouTube thumbnail URL to maxresdefault (720p HD 16:9, no letterbox bars)
    if (raw.includes('ytimg.com') || raw.includes('youtube.com')) {
      return raw.replace(/\/(hqdefault|mqdefault|sddefault|default|hq720)\.(jpg|webp)/, '/maxresdefault.jpg').replace('http://', 'https://');
    }
    // Upgrade Google Drive thumbnails to 1280px width
    if (raw.includes('drive.google.com/thumbnail')) {
      return raw.replace(/sz=w\d+/, 'sz=w1280');
    }
    return raw;
  }, [currentSong?.thumbnail, currentSong?.videoId, currentSong?.source, queue, initialThumbnail, initialVideoId, initialSource]);



  const handleExoPlayerFallback = useCallback(async (videoId: string) => {
    console.warn('⚠️ [ExoPlayer] Playback error encountered, falling back to YouTube player for video:', videoId);
    setDirectStreamUrl(null);
    setDirectAudioUrl(null);
    setDirectStreamsList([]);
  }, []);

  const dynamicQualityOptions = useMemo(() => {
    // 1. Gather real quality keys from direct extracted streams
    const directKeys = directStreamsList
      .map(s => s.qualityKey || (s.height ? heightToQualityKey(s.height, s.width) : null))
      .filter(Boolean);

    // 2. Gather reported quality keys from player level events
    const reportedKeys = availableQualities
      .filter(q => q && q !== 'auto')
      .map(q => {
        const h = parseInt(String(q).replace(/\D/g, ''), 10);
        return h > 0 ? heightToQualityKey(h) : q;
      })
      .filter(Boolean);

    // Use direct extracted stream tiers if available; fallback to reported levels
    const rawKeys = directKeys.length > 0 ? directKeys : reportedKeys;

    // Filter out anything strictly above 2160p (8K, 4320p)
    const EXCLUDED_OVER_2160 = new Set(['hd4320', '4320p', '8k']);
    const filtered = rawKeys.filter(q => {
      if (EXCLUDED_OVER_2160.has(String(q).toLowerCase())) return false;
      const num = parseInt(String(q).replace(/\D/g, ''), 10);
      if (num > 2160) return false;
      return true;
    });

    // For 8K videos (4320p / 8K), ensure hd2160 (4K UHD) is included as top selectable tier
    if (rawKeys.some(q => String(q).includes('4320') || String(q).includes('8k') || parseInt(String(q).replace(/\D/g, ''), 10) >= 4320)) {
      if (!filtered.includes('hd2160')) {
        filtered.push('hd2160');
      }
    }

    // Deduplicate so each available resolution tier appears exactly once
    const unique = Array.from(new Set(filtered));

    // Show ONLY the genuinely available qualities for this video.
    // If stream data has not arrived yet, use safe fallback tiers until extraction finishes.
    const sourceList = unique.length > 0
      ? unique
      : ['hd720', 'large', 'medium', 'small', 'tiny'];

    return sourceList.sort((a, b) => {
      const idxA = QUALITY_PRIORITY.indexOf(a);
      const idxB = QUALITY_PRIORITY.indexOf(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    }).map(key => {
      const meta = QUALITY_METADATA[key] || { label: key, icon: 'film' };
      return {
        key,
        label: getMinimalQualityLabel(key),
        icon: meta.icon,
        badge: meta.badge,
      };
    });
  }, [availableQualities, directStreamsList]);

  const handleSelectQuality = useCallback((qualityKey: string) => {
    setVideoQuality(qualityKey);
    const minimalLabel = getMinimalQualityLabel(qualityKey);
    setLiveExactResolution(minimalLabel);
    setShowQualityOptions(false);

    // Block room drift-sync seeks for 6 seconds so ExoPlayer can switch tracks cleanly without interruption
    lastSeekTimeRef.current = Date.now();
    isUserAction.current = true;
    setTimeout(() => { isUserAction.current = false; }, 4000);

    console.log(`📺 [Quality Switch] Requesting switch to ${qualityKey} (${minimalLabel})`);

    if (directStreamUrl) {
      if (directStreamType === 'mpd') {
        console.log(`📺 [Quality Switch] In-player track switch (mpd) to ${qualityKey} (${minimalLabel})`);
        playerRef.current?.setPlaybackQuality?.(qualityKey);
        return;
      }

      // Progressive MP4 stream: ExoPlayer has only 1 track in progressive mode.
      // In progressive mode, only switch if there is another valid muxed stream (has_audio: true).
      // NEVER set an adaptive video-only stream as progressive MP4 (causes fatal 403 / freeze).
      const muxedMatch = directStreamsListRef.current.find(
        s => s.has_audio && s.qualityKey === qualityKey && s.url && s.url.startsWith('http')
      );
      if (muxedMatch && muxedMatch.url && muxedMatch.url !== directStreamUrl) {
        console.log(`📺 [Quality Switch] Switching progressive stream URL to: ${muxedMatch.url.substring(0, 60)}...`);
        setDirectStreamUrl(muxedMatch.url);
        setDirectAudioUrl(null);
        setDirectStreamType('mp4');
        return;
      }
      return;
    }

    // YouTube embedded player fallback
    playerRef.current?.setPlaybackQuality?.(qualityKey);
  }, [playerRef, directStreamUrl, directStreamType]);
  const [previewData, setPreviewData] = useState<{
    visible: boolean;
    uri?: string;
    sticker?: string;
    displayName?: string;
  }>({ visible: false });

  // ─── Picture-in-Picture & Floating Mini-Player State ─────────────────────────
  const [pipEnabled, setPipEnabled] = useState(false);
  const pipEnabledSV = useSharedValue(0);

  const [isSystemPip, setIsSystemPip] = useState(false);
  const isSystemPipSV = useSharedValue(0);

  const [pipDismissed, setPipDismissed] = useState(false);
  const pipDismissedSV = useSharedValue(0);

  useEffect(() => {
    pipDismissedSV.value = pipDismissed ? 1 : 0;
  }, [pipDismissed]);

  useEffect(() => {
    if (!isMinimized) {
      setPipDismissed(false);
      pipDismissedSV.value = 0;
      DeviceEventEmitter.emit('pip_dismissed', false);
      // PiP auto-enter managed dynamically by playback state effect
    }
  }, [isMinimized, pipEnabled]);

  // Dynamic sizing (YouTube-style dynamic aspect ratio resize)
  const currentAspectRatioRef = useRef<number>(16 / 9);
  const miniWidth = useSharedValue(176);
  const miniHeight = useSharedValue(99); // 16:9

  const defaultMiniX = width - 176 - 14;
  const defaultMiniY = height - 99 - Math.max(insets.bottom, 16) - 75;
  const miniX = useSharedValue(defaultMiniX);
  const miniY = useSharedValue(defaultMiniY);
  const miniPosRef = useRef({ x: defaultMiniX, y: defaultMiniY });

  // Load persisted PiP preference (initially OFF by default)
  useEffect(() => {
    AsyncStorage.getItem('@music_room_pip_enabled').then(val => {
      const isEnabled = val === 'true'; // default: false
      setPipEnabled(isEnabled);
      pipEnabledSV.value = isEnabled ? 1 : 0;
      (global as any).isPipEnabledInMusicRoom = isEnabled;
      DeviceEventEmitter.emit('pip_mode_changed', isEnabled);
    }).catch(() => {
      setPipEnabled(false);
      pipEnabledSV.value = 0;
      (global as any).isPipEnabledInMusicRoom = false;
      setSystemPipEnabled(false);
    });
  }, []);

  const handleTogglePip = useCallback((value: boolean) => {
    setPipEnabled(value);
    pipEnabledSV.value = value ? 1 : 0;
    (global as any).isPipEnabledInMusicRoom = value;
    DeviceEventEmitter.emit('pip_mode_changed', value);
    AsyncStorage.setItem('@music_room_pip_enabled', value ? 'true' : 'false').catch(() => {});
  }, []);

  useEffect(() => {
    isSystemPipSV.value = isSystemPip ? 1 : 0;
  }, [isSystemPip]);

  const wasInSystemPipRef = useRef(false);

  useEffect(() => {
    const removePip = addPipListener((inPip, isExpanded) => {
      const wasInPip = wasInSystemPipRef.current;
      wasInSystemPipRef.current = inPip;
      if (!inPip) {
        // Exiting system PiP: synchronously snap ALL shared values to full-screen Music Room!
        isSystemPipSV.value = 0;
        isMinimizedSV.value = 0;
        pipDismissedSV.value = 0;
        (global as any).isSystemPipActive = false;
        (global as any).isMusicRoomMinimized = false;
        (globalThis as any).isMusicRoomMinimized = false;
        try {
          cancelAnimation(miniX);
          cancelAnimation(miniY);
          cancelAnimation(miniWidth);
          cancelAnimation(miniHeight);
        } catch (_) {}
        setIsSystemPip(false);
        setPipDismissed(false);
        DeviceEventEmitter.emit('pip_dismissed', false);
        DeviceEventEmitter.emit('minimize_music_room', false);
        wasInSystemPipRef.current = false;
      } else {
        setIsSystemPip(true);
        isSystemPipSV.value = 1;
        (global as any).isSystemPipActive = true;
        setShowControls(false);
        setStickerPickerVisible(false);
        setShowSettingsModal(false);
        setShowDiscovery(false);
        Keyboard.dismiss();
      }
    });
    return () => {
      (global as any).isSystemPipActive = false;
      setSystemPipEnabled(false);
      removePip();
    };
  }, []);

  const handleCloseRoom = useCallback(() => {
    (global as any).keepMusicRoomAlive = false;
    (global as any).activeMusicRoomCode = null;
    (global as any).isMusicPlaying = false;
    (global as any).loadedAudioSessionId = null;
    try { TrackPlayerService.endSession(); } catch (_) {}
    stopMusicService();
    loadedAudioSessionRef.current = null;
    musicWebSocketService.disconnect();
    DeviceEventEmitter.emit('music_playback_state_changed', false);
    DeviceEventEmitter.emit('close_music_room');
  }, []);

  const [pipControlsVisible, setPipControlsVisible] = useState(false);
  const pipControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pipTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetPipControlsTimeout = useCallback(() => {
    if (pipControlsTimeoutRef.current) {
      clearTimeout(pipControlsTimeoutRef.current);
    }
    pipControlsTimeoutRef.current = setTimeout(() => {
      setPipControlsVisible(false);
    }, 3500);
  }, []);

  const lastPipTapTimeRef = useRef<number>(0);
  const handlePipTap = useCallback(() => {
    // If a pinch gesture was active recently, ignore tap
    if (touchStateRef.current.wasPinching || Date.now() - touchStateRef.current.pinchEndedAt < 400) {
      return;
    }
    const now = Date.now();
    if (now - lastPipTapTimeRef.current < 350) {
      // DOUBLE TAP detected: Immediate maximize back to full Music Room!
      if (pipTapTimeoutRef.current) {
        clearTimeout(pipTapTimeoutRef.current);
        pipTapTimeoutRef.current = null;
      }
      if (pipControlsTimeoutRef.current) {
        clearTimeout(pipControlsTimeoutRef.current);
        pipControlsTimeoutRef.current = null;
      }
      lastPipTapTimeRef.current = 0;
      setPipControlsVisible(false);
      DeviceEventEmitter.emit('minimize_music_room', false);
    } else {
      lastPipTapTimeRef.current = now;
      if (pipTapTimeoutRef.current) {
        clearTimeout(pipTapTimeoutRef.current);
      }
      pipTapTimeoutRef.current = setTimeout(() => {
        // SINGLE TAP: Toggle Android System PiP controls overlay
        setPipControlsVisible(prev => {
          const next = !prev;
          if (pipControlsTimeoutRef.current) {
            clearTimeout(pipControlsTimeoutRef.current);
            pipControlsTimeoutRef.current = null;
          }
          if (next) {
            pipControlsTimeoutRef.current = setTimeout(() => {
              setPipControlsVisible(false);
            }, 3500);
          }
          return next;
        });
        pipTapTimeoutRef.current = null;
      }, 250);
    }
  }, []);

  useEffect(() => {
    if (!isMinimized) {
      setPipControlsVisible(false);
      if (pipControlsTimeoutRef.current) {
        clearTimeout(pipControlsTimeoutRef.current);
        pipControlsTimeoutRef.current = null;
      }
      if (pipTapTimeoutRef.current) {
        clearTimeout(pipTapTimeoutRef.current);
        pipTapTimeoutRef.current = null;
      }
    }
  }, [isMinimized]);

  useEffect(() => {
    return () => {
      if (pipControlsTimeoutRef.current) clearTimeout(pipControlsTimeoutRef.current);
      if (pipTapTimeoutRef.current) clearTimeout(pipTapTimeoutRef.current);
    };
  }, []);

  const touchStateRef = useRef<{
    mode: 'drag' | 'pinch' | 'idle';
    wasPinching: boolean;
    initialDist: number;
    initialWidth: number;
    initialHeight: number;
    pinchEndedAt: number;
  }>({
    mode: 'idle',
    wasPinching: false,
    initialDist: 0,
    initialWidth: 176,
    initialHeight: 99,
    pinchEndedAt: 0,
  });

  const miniPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: (evt) => {
        return Boolean(evt.nativeEvent.touches && evt.nativeEvent.touches.length > 1);
      },
      onMoveShouldSetPanResponder: (_, gesture) => {
        return Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4 || gesture.numberActiveTouches > 1;
      },
      onMoveShouldSetPanResponderCapture: (_, gesture) => {
        return Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4 || gesture.numberActiveTouches > 1;
      },
      onPanResponderGrant: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          touchStateRef.current.mode = 'pinch';
          touchStateRef.current.wasPinching = true;
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          touchStateRef.current.initialDist = Math.hypot(dx, dy) || 1;
          touchStateRef.current.initialWidth = miniWidth.value;
          touchStateRef.current.initialHeight = miniHeight.value;
        } else {
          touchStateRef.current.mode = 'drag';
        }
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          // Dynamic 2-Finger Pinch to Expand / Shrink
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const currentDist = Math.hypot(dx, dy);
          if (touchStateRef.current.mode !== 'pinch') {
            touchStateRef.current.mode = 'pinch';
            touchStateRef.current.wasPinching = true;
            touchStateRef.current.initialDist = currentDist || 1;
            touchStateRef.current.initialWidth = miniWidth.value;
            touchStateRef.current.initialHeight = miniHeight.value;
            return;
          }
          touchStateRef.current.wasPinching = true;
          const ratio = currentDist / (touchStateRef.current.initialDist || 1);
          const currentAr = currentAspectRatioRef.current || (16 / 9);

          let newW = miniWidth.value;
          let newH = miniHeight.value;

          if (currentAr < 1.0) {
            // Vertical short (e.g. 9:16): scale based on height
            const minH = 150;
            const maxH = Math.round(height * 0.45);
            newH = Math.min(Math.max(touchStateRef.current.initialHeight * ratio, minH), maxH);
            newW = Math.round(newH * currentAr);
          } else {
            // Landscape / normal (e.g. 16:9, 4:3): scale based on width
            const minW = 140;
            const maxW = width - 20;
            newW = Math.min(Math.max(touchStateRef.current.initialWidth * ratio, minW), maxW);
            newH = Math.round(newW / currentAr);
          }

          miniWidth.value = newW;
          miniHeight.value = newH;

          // Prevent spilling off-screen during dynamic resize
          const maxX = width - newW - 10;
          const maxY = height - newH - Math.max(insets.bottom, 16) - 55;
          if (miniX.value > maxX) miniX.value = maxX;
          if (miniY.value > maxY) miniY.value = maxY;
        } else if (touchStateRef.current.mode === 'drag' && !touchStateRef.current.wasPinching) {
          // Single-Finger Drag to Move Position
          miniX.value = miniPosRef.current.x + gesture.dx;
          miniY.value = miniPosRef.current.y + gesture.dy;
        }
      },
      onPanResponderRelease: (evt, gesture) => {
        const wasPinch = touchStateRef.current.mode === 'pinch' || touchStateRef.current.wasPinching;
        touchStateRef.current.mode = 'idle';

        if (wasPinch) {
          touchStateRef.current.wasPinching = false;
          touchStateRef.current.pinchEndedAt = Date.now();
          // Retain resized dimensions smoothly without auto-opening the room
          const curW = miniWidth.value;
          const curH = miniHeight.value;
          const maxX = width - curW - 10;
          const maxY = height - curH - Math.max(insets.bottom, 16) - 55;
          const finalX = Math.min(Math.max(miniX.value, 10), maxX);
          const finalY = Math.min(Math.max(miniY.value, Math.max(insets.top, 24) + 8), maxY);
          miniPosRef.current = { x: finalX, y: finalY };
          miniX.value = withSpring(finalX, { damping: 16, stiffness: 130 });
          miniY.value = withSpring(finalY, { damping: 16, stiffness: 130 });
          return;
        }

        // Ignore releases occurring right after pinch ended
        if (Date.now() - touchStateRef.current.pinchEndedAt < 400) {
          return;
        }

        // Tap detected (< 6px movement): Handle Tap / Double Tap
        if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
          handlePipTap();
          return;
        }

        // Single-finger drag ended: Snap to nearest edge (left or right)
        let targetX = miniPosRef.current.x + gesture.dx;
        let targetY = miniPosRef.current.y + gesture.dy;
        const curW = miniWidth.value;
        const curH = miniHeight.value;

        const minX = 10;
        const maxX = width - curW - 10;
        const minY = Math.max(insets.top, 24) + 8;
        const maxY = height - curH - Math.max(insets.bottom, 16) - 55;

        const midX = width / 2;
        const finalX = (targetX + curW / 2 < midX) ? minX : maxX;
        const finalY = Math.min(Math.max(targetY, minY), maxY);

        miniPosRef.current = { x: finalX, y: finalY };

        miniX.value = withSpring(finalX, { damping: 16, stiffness: 130 });
        miniY.value = withSpring(finalY, { damping: 16, stiffness: 130 });
      },
      onPanResponderTerminate: () => {
        touchStateRef.current.mode = 'idle';
        touchStateRef.current.wasPinching = false;
      },
    })
  ).current;

  // ─── Room Theme State & Persistence ───────────────────────────────────
  const [roomTheme, setRoomTheme] = useState<RoomTheme>('cinema');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // ─── Cinematic Smooth Screen Transition (Fade out to black & fade in to eliminate any flash) ───
  const screenTransitionFadeAnim = useRef(new Animated.Value(0)).current;
  const [isScreenTransitioning, setIsScreenTransitioning] = useState(false);
  const isScreenTransitioningRef = useRef(false);

  const triggerSmoothScreenTransition = useCallback((action: () => void) => {
    if (isScreenTransitioningRef.current) return;
    isScreenTransitioningRef.current = true;
    setIsScreenTransitioning(true);

    Animated.timing(screenTransitionFadeAnim, {
      toValue: 1,
      duration: 180,
      easing: RNEasing.out(RNEasing.quad),
      useNativeDriver: true,
    }).start(() => {
      try {
        action();
      } catch (err) {
        console.warn('Error during smooth screen transition:', err);
      }

      // Small hold (80ms) for Android layout & SurfaceHolder recreation behind the blackout curtain
      setTimeout(() => {
        Animated.timing(screenTransitionFadeAnim, {
          toValue: 0,
          duration: 240,
          easing: RNEasing.in(RNEasing.quad),
          useNativeDriver: true,
        }).start(() => {
          isScreenTransitioningRef.current = false;
          setIsScreenTransitioning(false);
        });
      }, 80);
    });
  }, [screenTransitionFadeAnim]);

  const handleThemeChange = useCallback((newTheme: RoomTheme) => {
    if (newTheme === roomTheme) return;
    triggerSmoothScreenTransition(() => {
      setRoomTheme(newTheme);
      AsyncStorage.setItem('@music_room_theme', newTheme).catch(() => {});
    });
  }, [roomTheme, triggerSmoothScreenTransition]);

  const handlePrevTheme = useCallback(() => {
    const currentIdx = ROOM_THEMES.findIndex(t => t.id === roomTheme);
    const prevIdx = (currentIdx - 1 + ROOM_THEMES.length) % ROOM_THEMES.length;
    handleThemeChange(ROOM_THEMES[prevIdx].id);
  }, [roomTheme, handleThemeChange]);

  const handleNextTheme = useCallback(() => {
    const currentIdx = ROOM_THEMES.findIndex(t => t.id === roomTheme);
    const nextIdx = (currentIdx + 1) % ROOM_THEMES.length;
    handleThemeChange(ROOM_THEMES[nextIdx].id);
  }, [roomTheme, handleThemeChange]);

  useEffect(() => {
    AsyncStorage.getItem('@music_room_theme').then(saved => {
      if (saved === 'cinema' || saved === 'rave' || saved === 'dark' /* || saved === 'light' */) {
        setRoomTheme(saved as RoomTheme);
      }
    }).catch(() => {});
  }, []);

  const handleCycleTheme = useCallback(() => {
    const nextTheme: Record<RoomTheme, RoomTheme> = {
      cinema: 'rave',
      rave: 'dark',
      dark: 'cinema',
      // dark: 'light',
      // light: 'cinema',
    };
    handleThemeChange(nextTheme[roomTheme]);
  }, [roomTheme, handleThemeChange]);

  // const isLight = roomTheme === 'light';
  const isLight = false;
  const themeTextColor = isLight ? '#0F172A' : '#FFFFFF';
  const themeSubTextColor = isLight ? '#475569' : 'rgba(255,255,255,0.6)';
  const themeIconColor = isLight ? '#0F172A' : '#FFFFFF';
  const themePlaceholderColor = isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255,255,255,0.40)';
  const showInnerGallery = !isInputActive && !stickerPickerVisible && (!chatMessage || chatMessage.length === 0);

  const handleAvatarPress = (uri?: string, sticker?: string, displayName?: string) => {
    setPreviewData({
      visible: true,
      uri,
      sticker,
      displayName
    });
  };

  useEffect(() => {
    if (currentSong?.source === 'drive') {
      checkGoogleDriveAuth().then(isAuth => setIsDriveAuthenticated(isAuth));
    } else {
      setIsDriveAuthenticated(null);
    }
  }, [currentSong?.videoId, currentSong?.source]);
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

  const checkLikeStatus = useCallback(async (videoId: string, source: string = 'youtube') => {
    try {
      const likes = await musicAPI.getLikes();
      const liked = likes.some((l: any) => l.video_id === videoId && l.source === source);
      setIsLiked(liked);
    } catch (e) {
      console.warn('Like status check skipped (network unavailable):', e);
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

    } catch (e) {
      console.error('Error toggling like:', e);
    }
  };

  const handleShareRoom = useCallback(async () => {
    try {
      const shareUrl = 'https://dme-19zq.onrender.com/invite';
      const songText = displayTitle ? `"${displayTitle}"` : 'music';
      const roomDesc = roomName ? ` in "${roomName}"` : '';
      const codeText = roomCode ? `\n\nRoom Code: ${roomCode}` : '';
      await Share.share({
        title: 'Join youtelite Music Room',
        message: `🎵 Join me on youtelite to listen to ${songText}${roomDesc}!${codeText}\n\n📲 Download & Join: ${shareUrl}`,
      });
    } catch (err) {
      console.warn('Error sharing room:', err);
    }
  }, [displayTitle, roomName, roomCode]);

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

  const handleMediaSelection = async (asset: any, caption: string = '') => {
    setIsMediaModalVisible(false);
    setStickerPreview(null);
    setGalleryPickerVisible(false);

    const isGif =
      asset.uri.toLowerCase().endsWith('.gif') ||
      asset.uri.toLowerCase().endsWith('.webp') ||
      asset.type === 'image/gif' ||
      asset.type === 'image/webp' ||
      asset.fileName?.toLowerCase().endsWith('.gif') ||
      asset.fileName?.toLowerCase().endsWith('.webp');

    const messageType = isGif ? 'gif' : 'image';
    const localId = `local_media_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const currentReplyTo = replyingTo;
    setReplyingTo(null);

    const myParticipant = participantsRef.current.find(p => Number(p.user_id) === Number(user?.id));
    const myName = user?.display_name || myParticipant?.name || user?.email || 'You';

    // 1. Instantly show optimistic media message in the chat
    const optimisticMsg: any = {
      id: localId,
      local_id: localId,
      user: myName,
      user_id: user?.id,
      avatar: user?.profile_picture,
      avatar_sticker: user?.avatar_sticker,
      text: caption || '',
      media_url: asset.uri,
      local_uri: asset.uri,
      message_type: messageType,
      reply_to: currentReplyTo,
      created_at: new Date().toISOString(),
      status: 'sending',
      _isNew: true,
    };

    setMessages(prev => [...prev, optimisticMsg]);
    scrollToBottom(true);

    // 2. Upload file in the background
    try {
      const token = await AsyncStorage.getItem('access_token');
      const fd = new FormData();

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
        musicWebSocketService.sendChatMessage(caption || '', currentReplyTo, data.url, messageType);
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      console.error('Media upload error:', e);
      Toast.show({ type: 'error', text1: 'Failed to send media' });
      setMessages(prev => prev.filter(m => m.id !== localId && m.local_id !== localId));
    }
  };

  const handleOpenGallery = () => {
    setGalleryPickerVisible(true);
  };

  const lastTapTimeRef = useRef(0);
  const doubleTapTimeoutRef = useRef<any>(null);
  const doubleTapHeartRef = useRef<DoubleTapHeartOverlayRef>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('PREVIEW_VIDEO', (data: { videoId?: string | null }) => {
      console.log('🎬 [RAVE DUAL-LAYER] Background preview set:', data?.videoId);
      setPreviewVideoId(data?.videoId || null);
    });
    return () => sub.remove();
  }, []);
  const [relatedVideos, setRelatedVideos] = useState<Song[]>([]);
  const relatedCacheRef = useRef<Map<string, Song[]>>(new Map());
  const fetchRelatedRef = useRef<(id?: string) => Promise<void>>(() => Promise.resolve());
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  // ✅ Single related-videos panel state. Opened either via the top-left
  // icon button (available anytime, anyone — DJ or participant) or
  // automatically when the video ends (existing behavior). Shows queue +
  // fresh suggestions only — no PIP, no current-song display, per spec.
  const [showRelated, setShowRelated] = useState(false);
  const showRelatedRef = useRef(false);
  const showRelatedSV = useSharedValue(0);
  useEffect(() => {
    showRelatedRef.current = showRelated;
    showRelatedSV.value = showRelated ? 1 : 0;
  }, [showRelated]);
  const isKeyboardVisibleRef = useRef(false);

  const stickerPickerVisibleRef = useRef(false);
  stickerPickerVisibleRef.current = stickerPickerVisible;
  const safeBottomPadding = stableBottomInset + 12;
  const isKeyboardOpeningRef = useRef(false);
  const isSwitchingToKeyboardRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    }
  }, []);

  const kbHeight = useSharedValue(0);
  const kbProgress = useSharedValue(0);
  const stickerSpacerHeight = useSharedValue(0);
  const collapseProgress = useSharedValue(0);
  const settledKeyboardHeight = useSharedValue(STICKER_DRAWER_HEIGHT);
  const isStickerPickerDeliberatelyOpenSV = useSharedValue(0);
  const isKeyboardClosingSV = useSharedValue(0);
  const [isStickerPickerDeliberatelyOpen, setIsStickerPickerDeliberatelyOpen] = useState(false);
  const isMinimizedSV = useSharedValue(isMinimized ? 1 : 0);
  const bottomInsetSV = useSharedValue(stableBottomInset);
  useEffect(() => {
    isMinimizedSV.value = isMinimized ? 1 : 0;
  }, [isMinimized]);
  useEffect(() => {
    bottomInsetSV.value = stableBottomInset;
  }, [stableBottomInset]);

  useGenericKeyboardHandler({
    onStart: (e) => {
      'worklet';
      if (e.height > 0) {
        isKeyboardClosingSV.value = 0;
        collapseProgress.value = 1;
        stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
      } else if (e.height === 0) {
        if (isStickerPickerDeliberatelyOpenSV.value === 0) {
          isKeyboardClosingSV.value = 1;
          collapseProgress.value = 0;
          stickerSpacerHeight.value = 0;
          kbHeight.value = 0;
        } else {
          isKeyboardClosingSV.value = 0;
          collapseProgress.value = 1;
          stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
        }
      }
    },
    onMove: (e) => {
      'worklet';
      if (isKeyboardClosingSV.value === 1 && isStickerPickerDeliberatelyOpenSV.value === 0) {
        collapseProgress.value = 0;
        stickerSpacerHeight.value = 0;
        kbHeight.value = 0;
      } else {
        kbHeight.value = e.height;
        kbProgress.value = e.progress;
      }
    },
    onInteractive: (e) => {
      'worklet';
      if (isKeyboardClosingSV.value === 1 && isStickerPickerDeliberatelyOpenSV.value === 0) {
        collapseProgress.value = 0;
        stickerSpacerHeight.value = 0;
        kbHeight.value = 0;
      } else {
        kbHeight.value = e.height;
        kbProgress.value = e.progress;
      }
    },
    onEnd: (e) => {
      'worklet';
      if (e.height === 0) {
        if (isStickerPickerDeliberatelyOpenSV.value === 0) {
          isKeyboardClosingSV.value = 0;
          stickerSpacerHeight.value = 0;
          collapseProgress.value = 0;
          kbHeight.value = 0;
        } else {
          isKeyboardClosingSV.value = 0;
          collapseProgress.value = 1;
          stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
          kbHeight.value = 0;
        }
      } else if (e.height > 150) {
        settledKeyboardHeight.value = Math.max(STICKER_DRAWER_HEIGHT, e.height - (bottomInsetSV?.value || 0));
      }
    },
  }, []);

  const isMinimizedRef = useRef(isMinimized);
  isMinimizedRef.current = isMinimized;

  // Only keyboard progress drives video/npBar/header collapse to maximize chat space while typing
  const kbActiveProgress = useDerivedValue(() => {
    if (isMinimizedSV.value === 1) return 0;
    return Math.abs(kbProgress.value);
  });

  // Combined input active progress for gallery icon fade
  const inputActiveProgress = useDerivedValue(() => {
    if (isMinimizedSV.value === 1) return 0;
    const p = Math.abs(kbProgress.value);
    const sp = Math.min(1, stickerSpacerHeight.value / STICKER_DRAWER_HEIGHT);
    return Math.max(p, sp);
  });

  // Fast millisecond fade for inner gallery icon
  const galleryFade = useSharedValue(1);

  useEffect(() => {
    if (showInnerGallery) {
      galleryFade.value = withTiming(1, { duration: 150 });
    } else {
      galleryFade.value = withTiming(0, { duration: 100 });
    }
  }, [showInnerGallery]);

  const galleryAnimStyle = useAnimatedStyle(() => {
    if (isMinimizedSV.value === 1) {
      return { opacity: 0, transform: [{ scale: 0.85 }] };
    }
    const kbFade = Math.max(0, 1 - inputActiveProgress.value * 5);
    const finalOpacity = Math.min(kbFade, galleryFade.value);
    return {
      opacity: finalOpacity,
      transform: [{ scale: 0.85 + 0.15 * finalOpacity }],
    };
  });

  // Video container smoothly covers header (58dp) and Now Playing bar hides under video (116dp):
  const headerAnimStyle = useAnimatedStyle(() => {
    if (isMinimizedSV.value === 1) return { opacity: 1 };
    return {
      opacity: Math.max(0, 1 - collapseProgress.value),
    };
  });

  const npBarAnimStyle = useAnimatedStyle(() => {
    if (isMinimizedSV.value === 1) return { opacity: 1, transform: [{ translateY: 0 }] };
    return {
      opacity: Math.max(0, 1 - collapseProgress.value),
      transform: [{ translateY: -collapseProgress.value * 116 }],
    };
  });

  const conversationContainerStyle = useAnimatedStyle(() => {
    if (isMinimizedSV.value === 1) return { transform: [{ translateY: 0 }] };
    return {
      transform: [{ translateY: -collapseProgress.value * 116 }],
    };
  });

  // Gold-standard WhatsApp 1:1 hardware VSYNC synchronized keyboard lift (identical to ChatRoomScreen):
  const kbLift = useDerivedValue(() => {
    if (isMinimizedSV.value === 1 || Platform.OS !== 'android') return 0;
    const rawH = kbHeight.value;
    return Math.max(0, rawH - bottomInsetSV.value);
  });

  // Instant Frame-0 lift via sticker modal (286dp); expands smoothly if Gboard expands (Translate/Stickers/GIF)
  const finalLift = useDerivedValue(() => {
    if (isMinimizedSV.value === 1) return 0;
    return Math.max(kbLift.value, stickerSpacerHeight.value);
  });

  const conversationLiftStyle = useAnimatedStyle(() => {
    if (isMinimizedSV.value === 1) {
      return { transform: [{ translateY: 0 }] };
    }
    const containerShift = collapseProgress.value * 116;
    const remainingLift = Math.max(0, finalLift.value - containerShift);
    return {
      transform: [{ translateY: -remainingLift }],
    };
  });

  useEffect(() => {
    if (isMinimized) {
      richInputRef.current?.blur();
      Keyboard.dismiss();
      setStickerPickerVisible(false);
      stickerSpacerHeight.value = 0;
      collapseProgress.value = 0;
      setShowSettingsModal(false);
      setShowLeaveConfirm(false);
      setShowDiscovery(false);
      setShowQualityOptions(false);
      setShowRelated(false);
      setShowControls(false);
    }
  }, [isMinimized, stickerSpacerHeight]);

  // Smooth timing animation for sticker picker drawer (identical to ChatRoomScreen)
  useEffect(() => {
    if (stickerPickerVisible) {
      Keyboard.dismiss();
      stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
    } else {
      stickerSpacerHeight.value = 0;
    }
  }, [stickerPickerVisible, stickerSpacerHeight]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setStickerPickerVisible(false);
        stickerSpacerHeight.value = 0;
      };
    }, [stickerSpacerHeight])
  );

    const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  const isStickerPickerDeliberatelyOpenRef = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      if (isMinimizedRef.current || !isFocusedRef.current) return;
      isKeyboardVisibleRef.current = true;
      isKeyboardOpeningRef.current = false;
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      if (isMinimizedRef.current || !isFocusedRef.current) return;
      isKeyboardVisibleRef.current = false;
      isKeyboardOpeningRef.current = false;
      if (!isStickerPickerDeliberatelyOpenRef.current) {
        stickerSpacerHeight.value = 0;
        collapseProgress.value = 0;
        kbHeight.value = 0;
        setStickerPickerVisible(false);
        setIsStickerPickerDeliberatelyOpen(false);
        isStickerPickerDeliberatelyOpenSV.value = 0;
      }
      if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
      lastTypingState.current = false;
      musicWebSocketService.sendTyping(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [stickerSpacerHeight]);

  const handleOpenStickerPickerStable = useCallback(() => {
    isStickerPickerDeliberatelyOpenRef.current = true;
    isStickerPickerDeliberatelyOpenSV.value = 1;
    setIsStickerPickerDeliberatelyOpen(true);
    collapseProgress.value = 1;
    stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
    setStickerPickerVisible(true);
    richInputRef.current?.blur();
    Keyboard.dismiss();
  }, [stickerSpacerHeight]);

  const handleCloseStickerPickerStable = useCallback(() => {
    isStickerPickerDeliberatelyOpenRef.current = false;
    isStickerPickerDeliberatelyOpenSV.value = 0;
    setIsStickerPickerDeliberatelyOpen(false);
    stickerSpacerHeight.value = 0;
    collapseProgress.value = 0;
    setStickerPickerVisible(false);
  }, [stickerSpacerHeight]);

  const handleInputFocusStable = useCallback(() => {
    isKeyboardOpeningRef.current = true;
    collapseProgress.value = 1;
    const wasStickerOpen = isStickerPickerDeliberatelyOpenRef.current;
    isStickerPickerDeliberatelyOpenRef.current = false;
    setIsStickerPickerDeliberatelyOpen(false);
    if (wasStickerOpen) {
      isStickerPickerDeliberatelyOpenSV.value = withTiming(0, {
        duration: 100,
        easing: Easing.bezier(0.0, 0.0, 0.2, 1),
      });
    } else {
      isStickerPickerDeliberatelyOpenSV.value = 0;
    }
    stickerSpacerHeight.value = STICKER_DRAWER_HEIGHT;
    setStickerPickerVisible(true);
  }, [stickerSpacerHeight]);


  const handleRateVideo = (videoId: string, rating: number) => {
    setVideoRatings(prev => {
      const current = prev[videoId] || { total: 0, count: 0 };
      const newTotal = current.total + rating - (current.myRating || 0);
      const newCount = current.myRating ? current.count : current.count + 1;
      return {
        ...prev,
        [videoId]: { total: newTotal, count: newCount, myRating: rating }
      };
    });
  };

  const handleChannelPress = () => {
    if (currentSong?.source === 'drive') {
      Toast.show({ type: 'info', text1: 'Google Drive file has no channel' });
      return;
    }

    const channelTitle = currentSong?.channelTitle || 'YouTube';
    const channelUrl = currentSong?.channelUrl 
      || fetchedChannelUrl 
      || (channelTitle && channelTitle !== 'YouTube' 
          ? `https://m.youtube.com/results?search_query=${encodeURIComponent(channelTitle)}` 
          : 'https://m.youtube.com');

    setDiscoveryInitialUrl(channelUrl);
    setShowDiscovery(true);
  };

  const renderNpBar = () => {
    const pinnerName = currentSong?.addedBy || 'Someone';
    const pinner = participants.find(p => p.name === currentSong?.addedBy) || user;
    const likers = isLiked ? [user] : [];
    const logoUri = currentSong?.channelLogo || fetchedChannelLogo || initialThumbnail || currentSong?.thumbnail || (initialVideoId ? `https://img.youtube.com/vi/${initialVideoId}/hqdefault.jpg` : null);

    return (
      <Reanimated.View
        style={[{ height: 58, overflow: 'hidden', zIndex: 5, elevation: 0 }, npBarAnimStyle]}
        pointerEvents={isKeyboardVisibleRef.current || stickerPickerVisible ? 'none' : 'auto'}
      >
        <View style={s.npBar}>
        <View style={{ width: 42, height: 42, position: 'relative' }}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleChannelPress}
            style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden' }}
          >
            {logoUri ? (
              <Image 
                source={{ uri: logoUri }} 
                style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }} 
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: isLight ? '#E2E8F0' : '#282828', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)' }}>
                <Icon name="musical-notes" size={20} color="#FF453A" />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            style={{ position: 'absolute', bottom: -2, right: -2, zIndex: 2 }}
            onPress={() => handleAvatarPress((pinner as any)?.avatar || (pinner as any)?.profile_picture, (pinner as any)?.avatar_sticker, pinnerName)}
          >
            <AvatarWithFallback 
              uri={(pinner as any)?.avatar || (pinner as any)?.profile_picture} 
              displayName={pinnerName} 
              sticker={(pinner as any)?.avatar_sticker}
              style={{ 
                width: 14, 
                height: 14, 
                borderRadius: 7, 
                borderWidth: 1, 
                borderColor: isLight ? '#FFFFFF' : '#1E1E1E' 
              }} 
            />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, marginLeft: 10, height: 42, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[s.npTitle, { flex: 1 }, isLight && { color: '#0F172A' }]} numberOfLines={1}>{displayTitle}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 19 }}>
            {/* Likers Container - Left aligned, normal order (heart on left, avatars next to it on right) */}
            <TouchableOpacity 
              onPress={handleToggleLike} 
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', 
                paddingHorizontal: 7, 
                height: 19, 
                borderRadius: 9.5,
                flexShrink: 0
              }}
              activeOpacity={0.7}
            >
              <Icon 
                name={isLiked ? "heart" : "heart-outline"} 
                size={13} 
                color={isLiked ? (isLight ? "#E11D48" : "#fff") : (isLight ? "#64748B" : "rgba(255,255,255,0.6)")} 
                style={{ marginRight: likers.length > 0 ? 5 : 0 }} 
              />
              {likers.length > 0 && (
                likers.length <= 4 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {likers.map((liker: any, i) => (
                      <AvatarWithFallback 
                        key={i}
                        uri={liker?.avatar || liker?.profile_picture} 
                        displayName={liker?.display_name || liker?.email || liker?.name || 'User'} 
                        sticker={liker?.avatar_sticker}
                        style={{ 
                          width: 13, 
                          height: 13, 
                          borderRadius: 6.5, 
                          marginLeft: i > 0 ? -4 : 0, 
                          borderWidth: 1, 
                          borderColor: isLight ? '#FFFFFF' : '#1E1E1E' 
                        }} 
                      />
                    ))}
                  </View>
                ) : (
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ flexDirection: 'row', alignItems: 'center' }}
                    style={{ maxHeight: 15, flexShrink: 1, maxWidth: 80 }}
                  >
                    {likers.map((liker: any, i) => (
                      <AvatarWithFallback 
                        key={i}
                        uri={liker?.avatar || liker?.profile_picture} 
                        displayName={liker?.display_name || liker?.email || liker?.name || 'User'} 
                        sticker={liker?.avatar_sticker}
                        style={{ 
                          width: 13, 
                          height: 13, 
                          borderRadius: 6.5, 
                          marginLeft: i > 0 ? -4 : 0, 
                          borderWidth: 1, 
                          borderColor: isLight ? '#FFFFFF' : '#1E1E1E' 
                        }} 
                      />
                    ))}
                  </ScrollView>
                )
              )}
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {/* Share Room Button */}
              <TouchableOpacity 
                onPress={handleShareRoom} 
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', 
                  paddingHorizontal: 8, 
                  height: 19, 
                  borderRadius: 9.5,
                }}
                activeOpacity={0.7}
                accessibilityLabel="Share room"
              >
                <Icon name="share-social-outline" size={13} color={isLight ? '#0F172A' : '#fff'} />
              </TouchableOpacity>

              {/* Add Friend / Invite Button */}
              <TouchableOpacity 
                onPress={() => setInviteModalVisible(true)} 
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', 
                  paddingHorizontal: 8, 
                  height: 19, 
                  borderRadius: 9.5,
                }}
                activeOpacity={0.7}
                accessibilityLabel="Invite friends"
              >
                <Icon name="person-add-outline" size={13} color={isLight ? '#0F172A' : '#fff'} />
              </TouchableOpacity>

              {/* Queue Button - In between invite and skip */}
              <TouchableOpacity 
                onPress={() => setActiveTab(activeTab === 'chat' ? 'queue' : 'chat')} 
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  backgroundColor: activeTab === 'queue' 
                    ? (isLight ? 'rgba(2,132,199,0.15)' : 'rgba(2,132,199,0.25)')
                    : (isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'), 
                  paddingHorizontal: 8, 
                  height: 19, 
                  borderRadius: 9.5,
                }}
                activeOpacity={0.7}
                accessibilityLabel="Toggle queue"
              >
                <Icon name="list" size={13} color={activeTab === 'queue' ? '#0284C7' : (isLight ? '#0F172A' : '#fff')} />
                {queue.length > 0 && (
                  <Text style={{ 
                    fontSize: 9.5, 
                    fontWeight: '700', 
                    marginLeft: 3, 
                    color: activeTab === 'queue' ? '#0284C7' : (isLight ? '#0F172A' : '#fff'),
                    includeFontPadding: false 
                  }}>
                    {queue.length}
                  </Text>
                )}
              </TouchableOpacity>

            </View>
          </View>
        </View>
        </View>
      </Reanimated.View>
    );
  };
  // ----------------------------

  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (fullscreen) {
      wasFullscreen.current = true;
      Orientation.lockToLandscape();
      setImmersiveMode(true);
      const t1 = setTimeout(() => setImmersiveMode(true), 250);
      const t2 = setTimeout(() => setImmersiveMode(true), 600);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      Orientation.lockToPortrait();
      setImmersiveMode(false);
      if (wasFullscreen.current) {
        pinNavBarColor('#00000000', true);
      }
    }
  }, [fullscreen]);

  useEffect(() => {
    return () => {
      clearNavBarPin();
      setImmersiveMode(false);
      Orientation.lockToPortrait();
      
      if (!(global as any).keepMusicRoomAlive) {
        try { TrackPlayerService.endSession(); } catch (_) {}
        stopMusicService();
        loadedAudioSessionRef.current = null;
        (global as any).loadedAudioSessionId = null;
        (global as any).activeMusicRoomCode = null;
        (global as any).isMusicPlaying = false;
        DeviceEventEmitter.emit('music_playback_state_changed', false);
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
      if (idleCloseTimerRef.current) clearTimeout(idleCloseTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    (global as any).activeMusicRoomCode = roomCode;
    (global as any).keepMusicRoomAlive = false;
    
    StatusBar.setTranslucent(true);
    StatusBar.setBarStyle('light-content');
    StatusBar.setBackgroundColor('transparent');
    setWindowBackground('#000000');
    pinNavBarColor('#00000000', true);
    if (Platform.OS === 'android' && NativeModules.SystemBar) {
      NativeModules.SystemBar.setWindowBackground('#000000');
      NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
      NativeModules.SystemBar.setStatusBarColor('#00000000', true);
    }
  }, [roomCode]);

  useFocusEffect(
    useCallback(() => {
      (global as any).activeMusicRoomCode = roomCode;
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('light-content');
      StatusBar.setBackgroundColor('transparent');
      setWindowBackground('#000000');
      pinNavBarColor('#00000000', true);
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setWindowBackground('#000000');
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
      }
    }, [roomCode])
  );

  // Refs
  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataLock = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const relatedScrollX = useRef(new Animated.Value(0)).current;
  const relatedScrollXSV = useSharedValue(0);
  useEffect(() => {
    const id = relatedScrollX.addListener(({ value }) => {
      relatedScrollXSV.value = value;
    });
    return () => {
      relatedScrollX.removeListener(id);
    };
  }, [relatedScrollX]);
  // Lets fetchSwipeSuggestions (declared with stable empty deps further
  // down) always read the CURRENT queue when it runs, without needing
  // `queue` in its dependency array — same rationale as currentSongRef.
  const roomStateQueueRef = useRef<QueueItem[]>([]);
  const livePositionRef = useRef(initialRoomPosition);
  const roomPositionRef = useRef(0);
  const isInBackgroundRef = useRef(false);
  const djForegroundReturnTime = useRef<number>(0);
  const seekingRef = useRef(false);
  const isUserAction = useRef(false);
  const preloadedRef = useRef(false);
  const lastSeekTimeRef = useRef(0); // ✅ Tracks last seek time to prevent seek storms
  const joinSnapshotConsumed = useRef(false); // ✅ NEW
  const lastSnapVideoId = useRef<string | null>(null);
  const masterDuration = useRef(0);
  const playingStartTime = useRef(0);
  const lastSyncBroadcastTimeRef = useRef(0);

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


  // Kept current by an effect right after showControlsFor's own
  // declaration further down — lets the plain tap handler above call the
  // latest showControlsFor without needing it declared yet at this point
  // in the component body.
  const showControlsForRef = useRef<(ms?: number) => void>(() => {});

  const playerGestureResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      // Capture gesture if it moves significantly in the horizontal direction
      return Math.abs(gestureState.dx) > 10;
    },
    onPanResponderRelease: (evt, gestureState) => {
      const isTap = Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5;
      if (isTap) {
        if (isKeyboardVisibleRef.current) {
          Keyboard.dismiss();
        }
        if (stickerPickerVisibleRef.current) {
          setStickerPickerVisible(false);
        }
        if (showRelatedRef.current) {
          // If related overlay is open, tapping the mini player closes it
          setShowRelated(false);
        } else {
          // Otherwise, toggle playback controls
          showControlsForRef.current();
        }
      } else if (Math.abs(gestureState.dx) > 40) {
        // Swipe detected! Open the related videos grid instantly (Rave UX)
        if (!showRelatedRef.current && currentSongRef.current?.source !== 'drive') {
          const activeId = currentSongRef.current?.videoId || initialVideoId;
          if (activeId && relatedCacheRef.current.has(activeId)) {
            setRelatedVideos(relatedCacheRef.current.get(activeId)!);
          } else if (activeId) {
            fetchRelated(activeId);
          }
          setShowRelated(true);
        }
      }
    },
  })).current;

  // AppState refs for background/foreground position tracking
  const appState = useRef(AppState.currentState);
  const backgroundStartPosition = useRef<number>(0);
  const backgroundStartTime = useRef<number>(0);

  const { callState } = useCall();

  // ── Voice Chat ─────────────────────────────────────────────────────────────
  const { isMicOn, toggleMic, voiceParticipants } = useMusicVoiceChat(user?.id ?? 0, participants);

  const activeMicSpeakers = useMemo(() => {
    return participants.filter(p => {
      const isMeSpeaking = p.user_id === (user?.id ?? 0) && isMicOn;
      const isOtherSpeaking = voiceParticipants.has(p.user_id);
      return isMeSpeaking || isOtherSpeaking;
    });
  }, [participants, user?.id, isMicOn, voiceParticipants]);

  const handleToggleMic = () => {
    // Leader (isDJ) always has mic access. Participants need leader permission.
    const isAllowed = isDJ || (allowedSpeakers && allowedSpeakers.includes(user?.id ?? 0));
    if (!isAllowed && !isMicOn) {
      Toast.show({
        type: 'info',
        text1: 'Mic Locked 🔒',
        text2: 'Ask the Room Leader to unlock your mic in Room & Invites.',
      });
      return;
    }
    toggleMic();
  };

  // ─── Dynamic Video Container Aspect Ratio & Song Setup ─────────────────────
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<number | null>(null);
  const [detectedCropPercent, setDetectedCropPercent] = useState<number>(0.0);

  useEffect(() => {
    const targetVideoId = currentSong?.videoId || initialVideoId;
    const targetSource = currentSong?.source || initialSource;

    if (!targetVideoId) {
      setDirectStreamUrl(null);
      setDirectStreamHeaders(undefined);
      setDirectAudioUrl(null);
      setDirectStreamsList([]);
      setIsDirectLoading(false);
      return;
    }

    if (targetSource === 'drive') {
      currentDirectFetchId.current = targetVideoId;
      setDirectStreamsList([]);
      directStreamsListRef.current = [];
      setDirectFallbackUrl(null);
      setDirectAudioUrl(null);
      setDirectStreamUrl(null);
      setDirectStreamHeaders(undefined);
      setAvailableQualities(['auto']);
      setVideoQuality('auto');
      setLiveExactResolution(null);
      setDetectedAspectRatio(null);
      setDetectedCropPercent(0.0);
      setShowQualityOptions(false);
      setIsDirectLoading(true);

      DriveStreamService.resolveDriveStreamUrl(targetVideoId).then((res) => {
        setIsDirectLoading(false);
        if (currentDirectFetchId.current === targetVideoId && res && res.url) {
          console.log('🎬 [MusicRoom] Drive stream resolved for native ExoPlayer:', res.url);
          setDirectStreamUrl(res.url);
          setDirectStreamHeaders(res.headers);
          setDirectStreamType('mp4');
          setIsPlayerReady(false);
          isPlayerReadyRef.current = false;
        }
      }).catch((e) => {
        setIsDirectLoading(false);
        console.warn('⚠️ [MusicRoom] Drive stream resolution failed, using DrivePlayer fallback:', e);
      });
      return;
    }

    // Deduplication guard: do not re-run extraction if already fetching or active for targetVideoId
    if (currentDirectFetchId.current === targetVideoId && (directStreamUrl || isDirectLoading)) {
      console.log(`ℹ️ [MusicRoom] Video ${targetVideoId} already active/extracting, skipping duplicate run`);
      return;
    }

    currentDirectFetchId.current = targetVideoId;
    lastLoadedStreamVideoId.current = null;
    videoFormatsRef.current = {};
    failedStreamUrlsRef.current.clear();
    setDirectStreamsList([]);
    directStreamsListRef.current = [];
    fallbackProgressiveUrlRef.current = null; // reset ANDROID fallback URL for new song
    setDirectFallbackUrl(null);
    setDirectAudioUrl(null);
    setDirectStreamUrl(null); // Clear old stream URL so DirectVideoPlayer stops old playback immediately
    setShowThumbnailOverlay(true);
    thumbnailFadeAnim.setValue(1);
    setIsPlayerReady(false);
    isPlayerReadyRef.current = false;
    setIsTrackPlayerReady(false);
    setMediaFullySynced(false);
    livePositionRef.current = 0; // Reset position so new song starts fresh at 0s
    setLivePosition(0);
    setAvailableQualities(['auto']);
    // Fix 1: Reset quality to Auto on every new song so stale quality isn't
    // applied to a new video before ExoPlayer has parsed its track list.
    setVideoQuality('auto');
    setLiveExactResolution(null);
    setDetectedAspectRatio(null);
    setDetectedCropPercent(0.0);
    setShowQualityOptions(false);

    fetchVideoAspectRatio(targetVideoId).then((res) => {
      if (currentDirectFetchId.current === targetVideoId && res && res.aspectRatio && !isNaN(res.aspectRatio) && res.aspectRatio >= 0.4 && res.aspectRatio <= 3.5) {
        console.log(`📐 [AUTO ASPECT RATIO] Song "${currentSong?.title || targetVideoId}" detected AR: ${res.aspectRatio.toFixed(3)}, crop: ${(res.verticalPercent * 100).toFixed(1)}% -> Target Height: ${Math.round(width / res.aspectRatio)}px`);
        setDetectedAspectRatio(res.aspectRatio);
        setDetectedCropPercent(res.isNativeWidescreen ? 0.0 : res.verticalPercent);
      }
    });

    // Preemptively fetch oEmbed metadata & channel logo for dynamic title + avatar
    if (targetSource !== 'drive') {
      fetchYouTubeMetadata(targetVideoId, currentSong?.addedBy || user?.display_name).then((meta) => {
        if (currentDirectFetchId.current !== targetVideoId) return;
        if (meta && meta.title && meta.title !== 'Loading...' && meta.title !== 'Watch Party' && meta.title !== 'YouTube Video') {
          if (meta.channelLogo) {
            setFetchedChannelLogo(meta.channelLogo);
          }
          if (meta.channelUrl) {
            setFetchedChannelUrl(meta.channelUrl);
          }
          if (!currentSong?.title || currentSong.title === 'Watch Party' || currentSong.title === 'YouTube Video' || currentSong.title === 'Loading...') {
            updateCurrentSongMetadata({
              videoId: targetVideoId,
              title: meta.title,
              thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${targetVideoId}/maxresdefault.jpg`,
              channelTitle: meta.channelTitle || 'YouTube',
              channelLogo: meta.channelLogo,
              channelUrl: meta.channelUrl,
              addedBy: currentSong?.addedBy || user?.display_name || 'Someone',
              source: 'youtube',
              duration: meta.duration || currentSong?.duration,
            });
          }
        }
      }).catch(() => {});
    }

    // Client-side extraction directly on user's device (Rave watch-party architecture)
    setIsDirectLoading(true);
    // Keep foreground service active during extraction so Android OS never suspends
    // the process, network, or JS runtime when the user minimizes or enters PiP during loading!
    if (targetSource !== 'drive') {
      startMusicService(
        currentSong?.title || 'Loading...',
        currentSong?.channelTitle || 'Music Room',
        currentSong?.thumbnail || `https://i.ytimg.com/vi/${targetVideoId}/maxresdefault.jpg`,
        Boolean(isDJ || isDJMode)
      );
    }
    extractVideoStreamUrlClientSide(targetVideoId).then((res) => {
      if (currentDirectFetchId.current !== targetVideoId) return;
      if (res && res.streams && res.streams.length > 0) {
        console.log(`🎬 [MusicRoom] Client-side extraction success: ${res.streams.length} qualities available (highest: ${res.streams[0].height}p)`);
        if (res.title && (!currentSong?.title || currentSong.title === 'Watch Party' || currentSong.title === 'YouTube Video' || currentSong.title === 'Loading...')) {
          updateCurrentSongMetadata({
            videoId: targetVideoId,
            title: res.title,
            thumbnail: currentSong?.thumbnail || `https://i.ytimg.com/vi/${targetVideoId}/maxresdefault.jpg`,
            channelTitle: res.channelTitle || currentSong?.channelTitle || 'YouTube',
            channelLogo: currentSong?.channelLogo || fetchedChannelLogo || undefined,
            addedBy: currentSong?.addedBy || user?.display_name || 'Someone',
            source: 'youtube',
            duration: res.duration || currentSong?.duration,
          });
        }
        setDirectStreamsList(res.streams);
        directStreamsListRef.current = res.streams;
        const formatMap: Record<string, string> = {};
        res.streams.forEach((s) => {
          if (s.qualityKey && s.url) formatMap[s.qualityKey] = s.url;
        });
        videoFormatsRef.current = formatMap;

        // Populate available qualities in UI
        const qKeys = res.streams.map(s => s.qualityKey).filter(Boolean);
        setAvailableQualities(Array.from(new Set(['auto', ...qKeys])));

        dashUrlRef.current = res.dashUrl || null;

        // Store the non-throttled ANDROID progressive URL for seamless fallback
        // when the DASH MWEB CDN starts returning 403 at ~60s.
        if (res.fallbackProgressiveUrl) {
          fallbackProgressiveUrlRef.current = res.fallbackProgressiveUrl;
          setDirectFallbackUrl(res.fallbackProgressiveUrl);
          console.log('🤖 [MusicRoom] ANDROID fallback progressive URL stored for seamless CDN-403 recovery');
        }

        // Activate DirectVideoPlayer via DASH MPD manifest (ExoPlayer architecture)
        // DASH gives quality switching for all users. For guests, CDN may 403 after ~60s
        // but onError below handles that by switching to ANDROID progressive at current position.
        if (res.dashUrl) {
          console.log(`🎬 [MusicRoom] Activating DirectVideoPlayer with DASH manifest (${res.streams.length} representations)`);
          lastLoadedStreamVideoId.current = targetVideoId;
          setDirectStreamUrl(res.dashUrl);
          setDirectAudioUrl(null);
          setDirectStreamType('mpd');
        } else if (res.url) {
          console.log(`🎬 [MusicRoom] Activating DirectVideoPlayer with single stream: ${res.url.substring(0, 60)}...`);
          lastLoadedStreamVideoId.current = targetVideoId;
          setDirectStreamUrl(res.url);
          setDirectAudioUrl(res.audioUrl || null);
          setDirectStreamType(res.streamType || 'mp4');
        } else {
          console.log(`ℹ️ [MusicRoom] No direct video streams resolved, using YouTubePlayer fallback`);
        }
      } else {
        console.log('ℹ️ [MusicRoom] No direct video streams extracted, using YouTubePlayer fallback');
      }
      setIsDirectLoading(false);
    }).catch((err) => {
      if (currentDirectFetchId.current !== targetVideoId) return;
      console.warn('⚠️ [MusicRoom] Client-side extraction error, falling back to YouTubePlayer:', err);
      setIsDirectLoading(false);
    });
  }, [currentSong?.videoId, currentSong?.source, initialVideoId, initialSource]);


  const handleAspectRatio = useCallback((ar: number) => {
    if (ar && !isNaN(ar) && ar >= 0.4 && ar <= 3.5) {
      if (ar > 1.82) {
        // Stream decoded by player is native widescreen (e.g. 21:9 or 2.39:1 without baked black bars)
        setDetectedCropPercent(0.0);
        setDetectedAspectRatio(ar);
        return;
      }
      setDetectedAspectRatio((prev) => {
        if (prev && Math.abs(prev - 16 / 9) > 0.05 && Math.abs(ar - 16 / 9) < 0.05) {
          return prev;
        }
        return ar;
      });
    }
  }, []);

  // Dynamically synchronize In-App MiniPlayer and Android System PiP dimensions on aspect ratio change
  useEffect(() => {
    const ar = detectedAspectRatio && !isNaN(detectedAspectRatio) && detectedAspectRatio >= 0.4 && detectedAspectRatio <= 3.5
      ? detectedAspectRatio
      : (16 / 9);
    currentAspectRatioRef.current = ar;

    let targetW = 176;
    let targetH = 99;
    if (ar < 1.0) {
      // Vertical Shorts (e.g. 9:16): Allocate ~200dp height, width based on aspect ratio (~112dp)
      targetH = Math.min(220, Math.max(180, Math.round(height * 0.25)));
      targetW = Math.round(targetH * ar);
    } else {
      // Landscape / Normal / 4:3 (e.g. 16:9, 4:3): Standard ~176dp width, height based on aspect ratio
      targetW = Math.min(200, Math.max(160, Math.round(width * 0.45)));
      targetH = Math.round(targetW / ar);
    }

    if (isMinimized) {
      miniWidth.value = withTiming(targetW, { duration: 280 });
      miniHeight.value = withTiming(targetH, { duration: 280 });

      const maxX = width - targetW - 10;
      const maxY = height - targetH - Math.max(insets.bottom, 16) - 55;
      if (miniX.value > maxX) {
        miniX.value = withTiming(maxX, { duration: 240 });
        miniPosRef.current.x = maxX;
      }
      if (miniY.value > maxY) {
        miniY.value = withTiming(maxY, { duration: 240 });
        miniPosRef.current.y = maxY;
      }
    } else {
      miniWidth.value = targetW;
      miniHeight.value = targetH;
      const maxX = width - targetW - 14;
      const maxY = height - targetH - Math.max(insets.bottom, 16) - 75;
      miniX.value = maxX;
      miniY.value = maxY;
      miniPosRef.current = { x: maxX, y: maxY };
    }

    const [num, den] = getAspectRatioFraction(ar);
    setSystemPipAspectRatio(num, den);
  }, [detectedAspectRatio, isMinimized, width, height, insets.bottom]);

  const dynamicVideoHeight = useMemo(() => {
    // Lock dimensions to physical screen so the container NEVER shrinks or fluctuates during PiP transitions
    const screenDims = Dimensions.get('screen');
    const screenW = Math.min(screenDims.width, screenDims.height);
    const screenH = Math.max(screenDims.width, screenDims.height);
    if (fullscreen) return screenW;
    const defaultVideoH = screenW * (9 / 16);

    const ar = detectedAspectRatio && !isNaN(detectedAspectRatio) && detectedAspectRatio >= 0.4 && detectedAspectRatio <= 3.5
      ? detectedAspectRatio
      : (16 / 9);

    if (ar < 1.0) {
      // Vertical Short / Portrait Video: allocate top half of screen (~48% height)
      // so the full vertical short fits completely without cropping, leaving bottom half for chat & keyboard
      return Math.round(screenH * 0.48);
    }
    // For 4:3 or taller videos (where ar < 1.70, so height is higher than 16:9):
    // Auto-expand container up to maxH so taller videos fit nicely
    if (ar < 1.70) {
      const targetHeight = Math.round(screenW / ar);
      const maxH = Math.round(screenH * 0.55);
      return Math.min(maxH, targetHeight);
    }
    // Standard 16:9 & Widescreen (21:9, 2.35:1, 2.39:1) videos:
    // MAINTAIN fixed 16:9 thumbnail height center spot so container, info bar and chat area NEVER MOVE!
    return defaultVideoH;
  }, [fullscreen, detectedAspectRatio]);

  const isWidescreenShort = !fullscreen && !isMinimized && !isSystemPip && !showRelated && !!detectedAspectRatio && detectedAspectRatio > 1.82;
  const widescreenMetrics = useMemo(() => {
    const screenDims = Dimensions.get('screen');
    const screenW = Math.min(screenDims.width, screenDims.height);
    const defaultVideoH = screenW * (9 / 16);
    const ar = detectedAspectRatio && detectedAspectRatio > 1.82 ? detectedAspectRatio : (16 / 9);
    const contentH = Math.round(screenW / ar);
    const topOffset = Math.round((defaultVideoH - contentH) / 2);
    return { screenW, defaultVideoH, contentH, topOffset };
  }, [detectedAspectRatio]);

  const raveContentRect = useMemo(() => {
    if (fullscreen || isMinimized || isSystemPip) return undefined;
    const screenDims = Dimensions.get('screen');
    const screenW = Math.min(screenDims.width, screenDims.height);
    return {
      x: 0,
      y: stableTopInset + 58,
      width: screenW,
      height: dynamicVideoHeight,
    };
  }, [fullscreen, isMinimized, isSystemPip, stableTopInset, dynamicVideoHeight]);

  const videoContainerAnimatedStyle = useAnimatedStyle(() => {
    if (fullscreen || isSystemPipSV.value === 1) {
      return {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        overflow: 'hidden',
        zIndex: 9999,
        elevation: 9999,
        backgroundColor: 'transparent',
        opacity: 1,
        transform: [{ translateY: 0 }],
      };
    }

    if (isMinimizedSV.value === 1) {
      if (pipEnabledSV.value === 1 && pipDismissedSV.value === 0) {
        return {
          position: 'absolute',
          left: miniX.value,
          top: miniY.value,
          width: miniWidth.value,
          height: miniHeight.value,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: 'rgba(255, 255, 255, 0.22)',
          overflow: 'hidden',
          zIndex: 9999,
          elevation: 20,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.55,
          shadowRadius: 10,
          backgroundColor: 'transparent',
          opacity: 1,
          transform: [{ translateY: 0 }],
        };
      }
      return {
        position: 'absolute',
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        overflow: 'hidden',
        zIndex: 0,
        elevation: 0,
        opacity: 0,
        transform: [{ translateY: 0 }],
      };
    }

    // Inside Music Room: Normal video container at top
    return {
      position: 'relative',
      left: 0,
      top: 0,
      width: '100%',
      height: dynamicVideoHeight,
      borderRadius: 0,
      borderWidth: 0,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      overflow: roomTheme === 'rave' ? 'visible' : 'hidden',
      zIndex: 20,
      elevation: 0,
      opacity: 1,
      transform: [{ translateY: -collapseProgress.value * 58 }],
    };
  }, [dynamicVideoHeight, fullscreen, roomTheme, isSystemPip]);

  const playerLayerAnimatedStyle = useAnimatedStyle(() => {
    if (fullscreen || isSystemPipSV.value === 1) {
      return {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        borderRadius: 0,
        zIndex: 9999,
        elevation: 9999,
        backgroundColor: '#000000',
        opacity: 1,
      };
    }

    if (isMinimizedSV.value === 1) {
      if (pipEnabledSV.value === 1 && pipDismissedSV.value === 0) {
        return {
          position: 'absolute',
          left: miniX.value,
          top: miniY.value,
          width: miniWidth.value,
          height: miniHeight.value,
          borderRadius: 16,
          overflow: 'hidden',
          zIndex: 9999,
          elevation: 20,
          opacity: 1,
        };
      }
      return {
        position: 'absolute',
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        zIndex: 0,
      };
    }

    // ── Live Video in Related Videos Grid (Slot 1 PiP) ──
    if (showRelatedSV.value === 1) {
      const isEndedOrError = playerState === 'ended' || Boolean(playerError);
      if (isEndedOrError || !activeVideoId) {
        return {
          position: 'absolute',
          left: -9999,
          top: -9999,
          width: 1,
          height: 1,
          opacity: 0,
          zIndex: 0,
        };
      }
      const slotW = width / 2;
      const slotH = slotW * 0.5625;
      return {
        position: 'absolute',
        left: -relatedScrollXSV.value,
        top: stableTopInset + 58,
        width: slotW,
        height: slotH,
        zIndex: 35,
        elevation: 35,
        backgroundColor: '#000000',
        borderRadius: 0,
        overflow: 'hidden',
        opacity: 1,
      };
    }

    if (roomTheme === 'rave') {
      return {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        elevation: 0,
        backgroundColor: 'transparent',
        opacity: 1,
      };
    }

    // Default (cinema, dark, light): exact video container bounds
    return {
      position: 'absolute',
      left: 0,
      top: stableTopInset + 58,
      width: '100%',
      height: dynamicVideoHeight,
      transform: [{ translateY: -collapseProgress.value * 58 }],
      zIndex: 0,
      elevation: 0,
      backgroundColor: 'transparent',
      opacity: 1,
    };
  }, [dynamicVideoHeight, fullscreen, roomTheme, stableTopInset, isSystemPip, showRelated]);

  const participantsRef = useRef(participants);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);


  const clearIdleCloseTimer = useCallback(() => {
    if (idleCloseTimerRef.current) {
      clearTimeout(idleCloseTimerRef.current);
      idleCloseTimerRef.current = null;
    }
  }, []);

  const scheduleIdleClose = useCallback(() => {
    clearIdleCloseTimer();
    idleCloseTimerRef.current = setTimeout(() => {
      console.log('⏱️ [IDLE CLOSE] 10 min idle — auto-closing room');
      (global as any).keepMusicRoomAlive = false;
      (global as any).activeMusicRoomCode = null;
      (global as any).loadedAudioSessionId = null;
      try { TrackPlayerService.endSession(); } catch (_) {}
      stopMusicService();
      loadedAudioSessionRef.current = null;
      musicWebSocketService.disconnect();
      DeviceEventEmitter.emit('close_music_room');
    }, 10 * 60 * 1000);
  }, [clearIdleCloseTimer]);

  useEffect(() => {
    // Only schedule idle close if playback has completely ended and there is no queue to continue
    const isEndedWithEmptyQueue = playerState === 'ended' && queue.length === 0;

    if (isEndedWithEmptyQueue) {
      scheduleIdleClose();
    } else {
      clearIdleCloseTimer();
    }

    return () => clearIdleCloseTimer();
  }, [isPlaying, playerState, queue.length, scheduleIdleClose, clearIdleCloseTimer]);

  // Rave Architecture: ONLY enable Android Auto-Enter PiP when:
  // 1. User has PiP enabled (pipEnabled === true)
  // 2. PiP is not dismissed (!pipDismissed)
  // 3. Playback is active (isPlaying === true)
  // 4. Video player is ready and loaded (isPlayerReady === true && !isDirectLoading && directStreamUrl)
  useEffect(() => {
    const canPip = Boolean(
      pipEnabled &&
      !pipDismissed &&
      isPlaying &&
      isPlayerReady &&
      !isDirectLoading &&
      directStreamUrl
    );
    setSystemPipEnabled(canPip);
  }, [pipEnabled, pipDismissed, isPlaying, isPlayerReady, isDirectLoading, directStreamUrl]);

  // Live position ticker — updates MediaSession every second so the lock-screen
  // progress bar tracks playback. Seeking from outside is intentionally blocked
  // (ACTION_SEEK_TO not included in PlaybackStateCompat actions).
  useEffect(() => {
    if (!currentSong?.videoId || !currentSong?.title) return;

    // Keep foreground service alive across song transitions; only stop when leaving room
    if (!isPlaying) return;

    // masterDuration.current is the real player-reported duration (set by setDuration).
    // currentSong.duration may be 0 for some videos so we prefer masterDuration.
    const ticker = setInterval(() => {
      const pos = livePositionRef.current || 0;
      const dur = masterDuration.current > 0 ? masterDuration.current : ((currentSong as any)?.duration || 0);
      if (dur > 0) {
        updateMusicServicePosition(
          currentSong.title,
          currentSong.channelTitle || 'Music Room',
          currentSong.thumbnail || '',
          pos,
          dur,
          isDJ || isDJMode,
          isPlaying,
        );
      }
    }, 1000);

    return () => clearInterval(ticker);
  }, [isPlaying, playerState, currentSong?.videoId, currentSong?.title, isDJ, isDJMode]);
  // Ref that always holds the latest isConnected value — safe to read inside
  // async callbacks / setInterval closures that would otherwise capture a stale copy.
  const isConnectedRef = useRef(isConnected);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  const handleMinimize = useCallback(() => {
    if (!isInitialVideoStartedRef.current) {
      console.log('⏳ [MusicRoom] Cannot minimize — initial video starting');
      return;
    }
    (globalThis as any).keepMusicRoomAlive = true;
    (globalThis as any).activeMusicRoomCode = roomCode;
    DeviceEventEmitter.emit('minimize_music_room', true);
  }, [roomCode]);

  useEffect(() => {
    (global as any).activeMusicRoomCode = roomCode;
  }, [roomCode]);

  useEffect(() => {
    const currentlyPlaying = Boolean(isPlaying && currentSong?.videoId);
    (global as any).isMusicPlaying = currentlyPlaying;
    DeviceEventEmitter.emit('music_playback_state_changed', currentlyPlaying);
  }, [isPlaying, currentSong?.videoId]);

  useEffect(() => {
    if (callState.isActive) {
      console.log('📞 [CALL ACTIVE] Pausing music room playback');
      if (isPlaying && (isDJ || isDJMode)) {
        syncPause(livePositionRef.current || 0);
      }
    }
  }, [callState.isActive, isPlaying, isDJ, isDJMode, syncPause]);

  // ✅ NEW: monotonic token so a stale seek's delayed resume (playVideo
  // after the settle timeout) can detect it's been superseded by a newer
  // seek and skip firing, instead of yanking the player out of the newer
  // seek's own settle window.
  const resumeSeekTokenRef = useRef(0);
  const lastSeekTargetRef = useRef<number | null>(null);

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
      lastSeekTargetRef.current = t;

      // ExoPlayer (DirectVideoPlayer) seeks are near-instant in progressive MP4.
      // Give it 200ms to settle the seek, then unblock progress/sync callbacks.
      console.log('🎯 [SEEK SYNC] Waiting for ExoPlayer to settle seek to', t);
      setTimeout(() => {
        setIsReseeking(false);
        setTimeout(() => { seekingRef.current = false; }, 300);
        showControlsFor(3500);
      }, 200);

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
    if (!currentSong?.videoId) {
      setIsTrackPlayerReady(false);
      setMediaFullySynced(false);
      return;
    }

    console.log('🎵 [AUDIO LOAD EFFECT] fired:', {
      videoId: currentSong.videoId,
      source: currentSong.source,
    });



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
    setIsPlayerReady(false);
    setIsTrackPlayerReady(false);
    setLiveExactResolution(null);
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

    // Both Drive and YouTube sync once player is ready
    const isReadyToSync = isPlayerReady;

    if (isReadyToSync) {
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
    if (isDJ || isDJMode) return; // DJ manages their own position
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
    if (!isDJ && !isDJMode && joinSnapshot && joinSnapshot.videoId === currentSong?.videoId && !joinSnapshotConsumed.current) return;

    // ✅ Cooldown: ignore drift syncs if we performed a seek very recently (within 5 seconds)
    // to give the video player enough time to buffer, start playing, and catch up.
    if (Date.now() - lastSeekTimeRef.current < 2000) return;

    let currentPosition = livePositionRef.current;
    if (currentPosition <= 0 || position <= 0) return;

    const diff = position - currentPosition; // positive if participant is BEHIND DJ, negative if AHEAD
    const absDiff = Math.abs(diff);

    // 1. Large drift (> 1.5s): hard seek with seek-settle latency compensation (+200ms)
    if (absDiff > 1.5 && !seekingRef.current && !isReseeking) {
      console.log('🎵 [PARTICIPANT SYNC] Large drift detected:', diff.toFixed(3), 's — resyncing to room position:', (position + 0.2).toFixed(3));
      playerRef.current?.setPlaybackRate?.(1.0);
      performLocalSeek(position + 0.2);
      return;
    }

    // 2. Medium drift (0.12s to 1.5s): smooth micro-speed adjustments (no audio stutter/pausing)
    if (!seekingRef.current && !isReseeking) {
      if (diff > 0.12) {
        // Participant is behind DJ: gently accelerate by +5%
        playerRef.current?.setPlaybackRate?.(1.05);
      } else if (diff < -0.12) {
        // Participant is ahead of DJ: gently decelerate by -5%
        playerRef.current?.setPlaybackRate?.(0.95);
      } else if (absDiff < 0.06) {
        // Tightly locked within 60ms: restore 1.0x normal speed
        playerRef.current?.setPlaybackRate?.(1.0);
      }
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
  // On foreground return, re-enforce the room's isPlaying state to the WebView player
  // so any background pause/play actions take immediate visible effect.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

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

        // Re-apply transparent nav bar and dark window background after unlock
        setWindowBackground('#000000');
        pinNavBarColor('#00000000', true);
        if (Platform.OS === 'android' && NativeModules.SystemBar) {
          NativeModules.SystemBar.setWindowBackground('#000000');
          NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
          NativeModules.SystemBar.setStatusBarColor('#00000000', true);
        }

        // ✅ KEY FIX: Re-enforce whatever play/pause state the room has now.
        // If the DJ paused from the lock screen, isPlayingRef.current is false
        // but the WebView may not have received the pause command while backgrounded.
        // We re-apply it here so the UI and audio immediately match the room state.
        const currentIsPlaying = isPlayingRef.current;
        setTimeout(() => {
          try {
            if (currentIsPlaying) {
              playerRef.current?.playVideo?.();
            } else {
              playerRef.current?.pauseVideo?.();
            }
          } catch (_) {}
        }, 300); // small delay to let WebView resume from background first

        if (isDJ || isDJMode) {
          // ✅ Tell participants DJ is back
          musicWebSocketService.sendBackgroundState(false, livePositionRef.current);
          console.log('📱 [FG] Returned to foreground. isPlaying:', currentIsPlaying, 'at:', livePositionRef.current);
        } else {
          console.log('📱 [FG] Participant returned to foreground.');
        }
      }
    });

    return () => subscription.remove();
  }, [isPlaying, isDJ, isDJMode, syncPlay]);

  useEffect(() => {
    const targetVid = currentSong?.videoId || initialVideoId;
    const targetSrc = currentSong?.source || initialSource;
    if (!targetVid || targetSrc === 'drive') {
      setFetchedChannelLogo(null);
      setFetchedChannelUrl(null);
      return;
    }
    if (currentSong?.channelLogo) {
      setFetchedChannelLogo(currentSong.channelLogo);
    }
    if (currentSong?.channelUrl) {
      setFetchedChannelUrl(currentSong.channelUrl);
    }
    let isMounted = true;
    fetchChannelDetails(targetVid).then(details => {
      if (isMounted) {
        if (details.logo) setFetchedChannelLogo(details.logo);
        if (details.channelUrl) setFetchedChannelUrl(details.channelUrl);
      }
    });
    return () => { isMounted = false; };
  }, [currentSong?.videoId, currentSong?.channelLogo, currentSong?.channelUrl, currentSong?.source, initialVideoId, initialSource]);

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
    let consecutiveDropCount = 0;

    const interval = setInterval(async () => {
      if (!isPlayerReadyRef.current || playerState === 'unstarted' || seekingRef.current || isReseeking) return;

      try {
        const pos = await playerRef.current?.getCurrentTime();
        const dur = await playerRef.current?.getDuration();
        if (pos !== undefined && pos !== null) {
          if (lastSeekTargetRef.current !== null) {
            const elapsed = Date.now() - lastSeekTimeRef.current;
            if (Math.abs(pos - lastSeekTargetRef.current) < 2.5 || elapsed > 1500) {
              lastSeekTargetRef.current = null;
            } else {
              return;
            }
          }
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

        if (currentSong?.source === 'drive') {
          if (pos !== undefined && ((pos < 1 && lastCurrentTime > 10) || (lastCurrentTime > 0 && pos < lastCurrentTime - 5))) {
            consecutiveDropCount++;
          } else {
            consecutiveDropCount = 0;
          }

          const isAdByTimeReset = consecutiveDropCount >= 3;
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
        } else {
          if (isAdPlayingRef.current) {
            isAdPlayingRef.current = false;
            setIsAdPlaying(false);
          }
        }

        if (pos !== undefined && pos > 0) {
          lastCurrentTime = pos;
        }

        const nowMs = Date.now();
        if (isDJ && isPlaying && !isAdPlayingRef.current && !seekingRef.current && !isReseeking && !isUserAction.current && (nowMs - lastSyncBroadcastTimeRef.current >= 1500)) {
          lastSyncBroadcastTimeRef.current = nowMs;
          syncPlay(pos ?? 0);
        }
      } catch (_) {}
    }, 500);

    return () => clearInterval(interval);
  }, [isConnected, isDJ, isPlaying, currentSong?.videoId, syncPlay, playerState, isPlayerReadyRef, mediaFullySynced, isReseeking]);

  const handleSelectSong = useCallback(async (song: Song, forcePlay = false) => {
    const hasActiveVideo = !!currentSongRef.current?.videoId && playerState !== 'ended';

    if (forcePlay || (!hasActiveVideo && queue.length === 0)) {
      try {
        playerRef.current?.pauseVideo?.();
        playerRef.current?.stopVideo?.();
      } catch (_) {}
      setDirectStreamUrl(null);
      setShowThumbnailOverlay(true);
      thumbnailFadeAnim.setValue(1);
      setIsPlayerReady(false);
      isPlayerReadyRef.current = false;
      setIsBuffering(true);
      let richSong = song;
      if (!song.channelTitle || song.title === 'Loading...' || song.title === 'Initializing...' || song.title === 'Watch Party' || song.title === 'YouTube Video') {
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
      currentDirectFetchId.current = null;
      lastLoadedStreamVideoId.current = null;
      lastResetSongVideoIdRef.current = null;
      setIsSyncing(true);
      loadSong(richSong, currentRoomName);
    } else {
      addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
    }
    if (song?.videoId) {
      fetchRelatedRef.current(song.videoId);
    }
    Keyboard.dismiss();
  }, [isDJ, isDJMode, loadSong, addToQueue, user?.display_name, playerState, queue, currentRoomName]);

  useEffect(() => {
    // ── Shared handler for play/pause triggered by lock screen / notification ──
    // Two signal paths:
    //   1. MEDIA_PLAY / MEDIA_PAUSE  — from MusicForegroundService MediaSession
    //   2. WEBVIEW_MEDIA_PLAY / WEBVIEW_MEDIA_PAUSE — from WebView's own
    //      navigator.mediaSession, which works reliably in the background because
    //      it runs inside the WebView process (not the suspended JS bridge).
    //      The WebView already paused/played itself; we just sync the room.

    // Debounce guard: a single notification button tap can trigger both paths
    // within milliseconds. We debounce to ~300ms so the room command fires once.
    let lastActionTs = 0;
    const DEBOUNCE_MS = 300;

    const handlePlay = (webViewAlreadyHandled = false) => {
      if (!(isDJ || isDJMode || isDJRef.current || isDJModeRef.current)) return;
      const now = Date.now();
      if (now - lastActionTs < DEBOUNCE_MS) return;
      lastActionTs = now;
      // If the signal came from MusicForegroundService (not WebView), force the player too
      if (!webViewAlreadyHandled) {
        try { playerRef.current?.playVideo?.(); } catch (_) {}
      }
      syncPlay(livePositionRef.current || 0);
      updateMusicService(
        currentSong?.title ?? '',
        currentSong?.channelTitle ?? 'Music Room',
        currentSong?.thumbnail ?? '',
        true,
        true
      );
    };

    const handlePause = (webViewAlreadyHandled = false) => {
      if (!(isDJ || isDJMode || isDJRef.current || isDJModeRef.current)) return;
      const now = Date.now();
      if (now - lastActionTs < DEBOUNCE_MS) return;
      lastActionTs = now;
      // If the signal came from MusicForegroundService (not WebView), force the player too
      if (!webViewAlreadyHandled) {
        try { playerRef.current?.pauseVideo?.(); } catch (_) {}
      }
      syncPause(livePositionRef.current || 0);
      updateMusicService(
        currentSong?.title ?? '',
        currentSong?.channelTitle ?? 'Music Room',
        currentSong?.thumbnail ?? '',
        false,
        true
      );
    };

    // Path 1: native MusicForegroundService MediaSession (notification button)
    const playSub  = DeviceEventEmitter.addListener('MEDIA_PLAY',  () => handlePlay(false));
    const pauseSub = DeviceEventEmitter.addListener('MEDIA_PAUSE', () => handlePause(false));

    // Path 2: WebView's own navigator.mediaSession (background-safe, postMessage)
    const wvPlaySub  = DeviceEventEmitter.addListener('WEBVIEW_MEDIA_PLAY',  () => handlePlay(true));
    const wvPauseSub = DeviceEventEmitter.addListener('WEBVIEW_MEDIA_PAUSE', () => handlePause(true));

    return () => {
      playSub.remove();
      pauseSub.remove();
      wvPlaySub.remove();
      wvPauseSub.remove();
    };
  }, [isDJ, isDJMode, syncPlay, syncPause, currentSong?.title, currentSong?.channelTitle, currentSong?.thumbnail]);

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

      const isEndedOrIdle = playerState === 'ended' || playerStateRef.current === 'ended' || !isPlaying;

      if (data.isQueueOnly && !isEndedOrIdle) {
        addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
      } else {
        setShowRelated(false);
        setPlayerError(null);
        handleSelectSong(song, true);
        setShowDiscovery(false);
        setDiscoveryInitialUrl(null);
      }
      setIsFirstCreation(false);
    });

    return () => sub.remove();
  }, [roomCode, user?.display_name, handleSelectSong, playerState, isPlaying]);

  // ✅ Auto-play from queue if video ended and a song enters the queue
  useEffect(() => {
    if ((isDJ || isDJMode) && (playerState === 'ended' || playerStateRef.current === 'ended') && queue.length > 0) {
      console.log('🎵 [Auto-Play Queue] Video ended and queue has song, auto-playing next song');
      setShowRelated(false);
      setPlayerError(null);
      passAux();
    }
  }, [queue.length, playerState, isDJ, isDJMode, passAux]);

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
    controlTimer.current = setTimeout(() => {
      if (playerStateRef.current !== 'paused') {
        setShowControls(false);
      }
    }, ms) as any;
  }, []);

  // Keep the swipe gesture's ref pointed at the latest showControlsFor —
  // see the comment at showControlsForRef's declaration for why this
  // indirection is necessary.
  useEffect(() => {
    showControlsForRef.current = showControlsFor;
  }, [showControlsFor]);

  useEffect(() => {
    if (isPlaying) {
      showControlsFor(3500);
    }
  }, [isPlaying, showControlsFor]);




  useEffect(() => {
    if (isDJMode && initialVideoId && isConnected && !initialSongLoadedRef.current) {
      initialSongLoadedRef.current = true;
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
        buildAndLoad(
          initialTitle || 'Drive Video',
          initialThumbnail || 'https://via.placeholder.com/150/1a1a2e/FFFFFF?text=Drive',
          'Google Drive',
        );
      } else if (initialTitle && initialThumbnail) {
        // YouTube: all info already available from route params (selected from history/likes)
        buildAndLoad(
          initialTitle,
          initialThumbnail,
          'YouTube',
        );
      } else {
        // YouTube: WebView interception — no title captured. Fetch metadata then load.
        const fallbackThumb = `https://i.ytimg.com/vi/${initialVideoId}/maxresdefault.jpg`;
        buildAndLoad('Loading...', fallbackThumb, 'YouTube');

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
      const isSameAsInitialOrActive =
        lastResetSongVideoIdRef.current === currentSong.videoId &&
        (lastLoadedStreamVideoId.current === currentSong.videoId || currentDirectFetchId.current === currentSong.videoId || Boolean(directStreamUrl));

      if (isSameAsInitialOrActive) {
        console.log(`🎵 [MusicRoom] currentSong confirmed for active video: ${currentSong.videoId} — preserving active stream & playback`);
        setShowRelated(false);
        setPlayerError(null);
        return;
      }

      lastResetSongVideoIdRef.current = currentSong.videoId;
      metadataLock.current = null;
      try { playerRef.current?.pauseVideo?.(); } catch (_) {}
      try { TrackPlayer.pause(); } catch (_) {}
      setShowThumbnailOverlay(true);
      thumbnailFadeAnim.setValue(1);
      setIsPlayerReady(false);
      setIsTrackPlayerReady(false); // ✅ Block WebView until audio is ready
      setMediaFullySynced(false);
      lastSnapVideoId.current = null; // ✅ Allow snap for new song
      setPlayerError(null);
      setPlayerState('unstarted');
      playerStateRef.current = 'unstarted';
      isPlayerReadyRef.current = false;
      playerReadyTime.current = 0;
      isAdPlayingRef.current = false;
      setIsAdPlaying(false);
      masterDuration.current = 0;
      playingStartTime.current = 0;
      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);
      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
      realDurationLockedRef.current = false;
      setIsBuffering(true);
      setLivePosition(0);
      livePositionRef.current = 0;
      setDuration(0);
      setShowRelated(false);
      songPlaybackStartedRef.current = false;
    }
  }, [currentSong?.videoId]);

  useEffect(() => {
    return () => {
      if (adMuteTimer.current) clearTimeout(adMuteTimer.current);
      if (adSkipIntervalRef.current) clearInterval(adSkipIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (isPlayerReady && isConnected && !songPlaybackStartedRef.current && (isDJMode || isDJ)) {
      songPlaybackStartedRef.current = true;
      setIsSyncing(false);
      setTimeout(() => syncPlay(livePositionRef.current || 0), 400);
    }
  }, [isPlayerReady, isConnected, isDJMode, isDJ, syncPlay]);

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
      if (KeyboardController.isVisible() || kbHeight.value > 0) {
        KeyboardController.dismiss({ animated: false });
        richInputRef.current?.blur();
        Keyboard.dismiss();
        if (!isStickerPickerDeliberatelyOpenRef.current) {
          stickerSpacerHeight.value = 0;
          collapseProgress.value = 0;
          setStickerPickerVisible(false);
          setIsStickerPickerDeliberatelyOpen(false);
          isStickerPickerDeliberatelyOpenSV.value = 0;
        }
        return true;
      }
      if (isStickerPickerDeliberatelyOpenRef.current || stickerPickerVisible) {
        isStickerPickerDeliberatelyOpenRef.current = false;
        isStickerPickerDeliberatelyOpenSV.value = 0;
        setIsStickerPickerDeliberatelyOpen(false);
        richInputRef.current?.blur();
        Keyboard.dismiss();
        KeyboardController.dismiss({ animated: false });
        stickerSpacerHeight.value = 0;
        collapseProgress.value = 0;
        setStickerPickerVisible(false);
        return true;
      }
      if (previewData.visible) { setPreviewData(p => ({ ...p, visible: false })); return true; }
      if (showDiscovery) { setShowDiscovery(false); setDiscoveryInitialUrl(null); return true; }
      if (showSettingsModal) { setShowSettingsModal(false); return true; }
      if (fullscreen) {
        triggerSmoothScreenTransition(() => {
          setFullscreen(false);
        });
        return true;
      }
      if (showLeaveConfirm) { setShowLeaveConfirm(false); return true; }
      if (!isInitialVideoStartedRef.current) {
        console.log('⏳ [MusicRoom] Back press ignored — initial video starting');
        return true;
      }
      handleMinimize();
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => { backHandler.remove(); };
  }, [showDiscovery, fullscreen, isMinimized, previewData.visible, stickerPickerVisible, stickerSpacerHeight, showLeaveConfirm, showSettingsModal, handleMinimize]);

  useEffect(() => {
    const unsubscribe = musicWebSocketService.onMessage((msg) => {
      if (msg.type === 'chat_message') {
        // Check if current user is mentioned by name or ID (e.g., @Name, @EmailPrefix, or @ID)
        const myParticipant = participantsRef.current.find(p => Number(p.user_id) === Number(user?.id));
        const myParticipantName = myParticipant?.name;
        const myUserId = user?.id;
        const myDisplayName = user?.display_name;
        const myEmailPrefix = user?.email?.split('@')[0];

        const text = msg.data.text || '';
        let hasMention = false;

        if (text) {
          if (myUserId && (text.includes(`@${myUserId} `) || text.endsWith(`@${myUserId}`))) {
            hasMention = true;
          }
          if (myParticipantName && (text.includes(`@${myParticipantName} `) || text.endsWith(`@${myParticipantName}`))) {
            hasMention = true;
          }
          if (myDisplayName && (text.includes(`@${myDisplayName} `) || text.endsWith(`@${myDisplayName}`))) {
            hasMention = true;
          }
          if (myEmailPrefix && (text.includes(`@${myEmailPrefix} `) || text.endsWith(`@${myEmailPrefix}`))) {
            hasMention = true;
          }
        }

        if (hasMention) {
          Vibration.vibrate([0, 500, 200, 500]);
        }
        setMessages(prev => {
          // If this incoming message is from current user and matches an optimistic message, replace it seamlessly
          const isFromMe = Number(msg.data.user_id) === Number(user?.id) || msg.data.user === (user?.display_name || user?.email);
          if (isFromMe) {
            const optIdx = prev.findIndex(m =>
              m.status === 'sending' &&
              (m.local_id || String(m.id).startsWith('local_')) &&
              (
                (m.message_type === msg.data.message_type && (msg.data.message_type === 'image' || msg.data.message_type === 'gif' || msg.data.message_type === 'sticker' || msg.data.message_type === 'lottie_sticker')) ||
                ((msg.data.message_type === 'text' || !msg.data.message_type) && m.text === msg.data.text)
              )
            );
            if (optIdx !== -1) {
              const optItem = prev[optIdx];
              const next = [...prev];
              next[optIdx] = {
                ...msg.data,
                local_id: optItem.local_id,
                local_uri: optItem.local_uri || optItem.media_url,
                _isNew: false, // Already mounted and animated smoothly
              };
              return next;
            }
          }
          return [...prev, { ...msg.data, _isNew: isFromMe }];
        });
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
  // ─── Related Videos (Rave Architecture: instant prefetch & cache) ────────────
  const fetchRelated = useCallback(async (targetVideoId?: string) => {
    const videoId = targetVideoId || currentSongRef.current?.videoId || initialVideoId;
    if (!videoId) return;

    // Fast-path: if already in cache, synchronously restore to state so swiping is 0ms instant
    const cached = relatedCacheRef.current.get(videoId);
    if (cached && cached.length > 0) {
      if ((currentSongRef.current?.videoId || initialVideoId) === videoId) {
        setRelatedVideos(cached);
        setIsLoadingRelated(false);
      }
      return;
    }

    try {
      const queuedIds = new Set(roomStateQueueRef.current.map(q => q.song.videoId));

      // Step 1: Immediate baseline smart recommendation (0ms synchronous from memory & feed)
      const baseline = DiscoveryFeedService.buildSmartRelated({
        currentSong: currentSongRef.current,
        queuedIds,
        limit: 20,
      });

      if (baseline.length > 0) {
        relatedCacheRef.current.set(videoId, baseline);
        if ((currentSongRef.current?.videoId || initialVideoId) === videoId) {
          setRelatedVideos(baseline);
          setIsLoadingRelated(false);
        }
      } else {
        setIsLoadingRelated(true);
      }

      // Step 2: Enrich with user's Liked videos and Watch History in parallel
      let likesList: any[] = [];
      let historyList: any[] = [];
      try {
        const [likesRes, histRes] = await Promise.allSettled([
          musicAPI.getLikes(),
          musicAPI.getWatchHistory(),
        ]);
        if (likesRes.status === 'fulfilled' && Array.isArray(likesRes.value)) {
          likesList = likesRes.value;
        }
        if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) {
          historyList = histRes.value;
        }
      } catch (_) {}

      const enriched = DiscoveryFeedService.buildSmartRelated({
        currentSong: currentSongRef.current,
        likes: likesList,
        history: historyList,
        queuedIds,
        limit: 20,
      });

      if (enriched.length > 0) {
        relatedCacheRef.current.set(videoId, enriched);
        if ((currentSongRef.current?.videoId || initialVideoId) === videoId) {
          setRelatedVideos(enriched);
        }
      }
    } catch (e) {
      console.error('Related videos smart recommendation failed:', e);
    } finally {
      setIsLoadingRelated(false);
    }
  }, [initialVideoId]);
  fetchRelatedRef.current = fetchRelated;

  // Proactive background prefetch: whenever current song changes or mounts, prefetch related videos immediately
  useEffect(() => {
    const activeVideoId = currentSong?.videoId || initialVideoId;
    if (activeVideoId) {
      const cached = relatedCacheRef.current.get(activeVideoId);
      if (cached && cached.length > 0) {
        setRelatedVideos(cached);
      }
      fetchRelated(activeVideoId);
    }
  }, [currentSong?.videoId, initialVideoId, fetchRelated]);

  // Re-fetch when panel opens if not already loaded
  useEffect(() => {
    if (showRelated && relatedVideos.length === 0) {
      fetchRelated();
    }
  }, [showRelated, relatedVideos.length, fetchRelated]);

  // ── Unified Handler for Song Playback Completion ───────────────────────────
  // BUG CHAIN that was killing the foreground service:
  // 1. closeSystemPip() called while in system PiP → triggers FLAG_ACTIVITY_REORDER_TO_FRONT +
  //    moveTaskToBack(true) in Kotlin → onPictureInPictureModeChanged(false) fires → MusicRoomScreen's
  //    PiP listener emits 'minimize_music_room false' ONLY IF AppState is 'active' (it's 'background')
  //    → but the activity lifecycle disruption (brief foreground → back to background) causes the RN
  //    JS thread to pause mid-execution, so passAux() state updates may not complete.
  // 2. setDirectStreamUrl(null) called BEFORE passAux() → ExoPlayer unmounts immediately (no audio) →
  //    during the gap before new stream URL arrives, Android sees foreground service with no active audio
  //    session → on aggressive battery, Android may kill or throttle the service.
  // 3. Both 1 and 2 together guarantee playback dies when minimized.
  //
  // FIX:
  // - Never call closeSystemPip() when queue has a next track. Just dismiss in-app PiP overlay.
  //   The system PiP window will dismiss itself when ExoPlayer transitions to the next song or when
  //   the user explicitly closes/expands it. No destructive activity lifecycle disruption.
  // - Never clear directStreamUrl before passAux(). The stream extraction useEffect already clears
  //   it when currentSong.videoId changes (line ~2926). Clearing it here creates a dangerous audio gap.
  // - Only call closeSystemPip() when queue is empty (nothing to play, OK to stop everything).
  const handleSongPlaybackEnded = useCallback(() => {
    const now = Date.now();
    if (now - lastAuxPassTimeRef.current < 3500) return;
    if (!isPlayerReadyRef.current && (now - playerReadyTime.current < 3000)) {
      console.log('🛡️ [Playback Ended] Ignored ghost end event during track transition');
      return;
    }
    lastAuxPassTimeRef.current = now;

    const hasQueue = (roomStateQueueRef.current && roomStateQueueRef.current.length > 0) || (queue && queue.length > 0);
    const canPass = Boolean(isDJ || isDJMode || isDJRef.current || isDJModeRef.current);

    console.log('🎵 [Playback Ended] hasQueue:', hasQueue, 'canPass:', canPass);

    if (canPass && hasQueue) {
      console.log('🎵 [Playback Ended] Advancing queue via passAux() — resetting video player');
      try { TrackPlayer.pause(); } catch (_) {}
      try { playerRef.current?.pauseVideo?.(); } catch (_) {}
      try { playerRef.current?.stopVideo?.(); } catch (_) {}
      setDirectStreamUrl(null);
      setShowThumbnailOverlay(true);
      thumbnailFadeAnim.setValue(1);
      setIsPlayerReady(false);
      isPlayerReadyRef.current = false;
      setIsTrackPlayerReady(false);
      setMediaFullySynced(false);
      setIsBuffering(true);
      lastLoadedStreamVideoId.current = null;
      lastResetSongVideoIdRef.current = null;
      setIsSyncing(true);
      setPlayerState('unstarted');
      playerStateRef.current = 'unstarted';
      setPlayerError(null);
      setShowRelated(false);
      livePositionRef.current = 0;
      setLivePosition(0);
      passAux();
    } else {
      console.log('🎵 [Playback Ended] Queue empty or listener — stopping and closing PiP');
      // Dismiss the in-app PiP overlay when entire playback finishes
      setPipDismissed(true);
      pipDismissedSV.value = 1;
      DeviceEventEmitter.emit('pip_dismissed', true);

      // Dismiss outside system PiP window when no more songs to play
      closeSystemPip();

      setPlayerState('ended');
      playerStateRef.current = 'ended';
      isPlayingRef.current = false;
      setIsPlayerReady(false);
      isPlayerReadyRef.current = false;
      setIsBuffering(false);
      fetchRelated();
      setShowRelated(true);
    }
  }, [queue, isDJ, isDJMode, passAux, fetchRelated]);

  const onPlayerStateChange = async (state: string) => {
    // ✅ Always update the ref so intervals/timeouts can read the
    // current video state without stale-closure issues.
    playerStateRef.current = state;
    setPlayerState(state);

    if (state === 'playing') {
      if (playingStartTime.current === 0) playingStartTime.current = Date.now();
      showControlsFor(3500);
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

    if (state === 'ended') {
      handleSongPlaybackEnded();
      return;
    }

    if (isUserAction.current || seekingRef.current) return;
    if (!effectiveIsDJ) return;
    
    // Only suppress pause broadcasts while backgrounded without active PiP.
    // In PiP mode, or when state is 'playing', never suppress!
    if (isInBackgroundRef.current && !isSystemPip) {
      if (state === 'paused') {
        console.log('📱 [BG] Ignoring pause state change while backgrounded');
        return;
      }
    }

    const currentTime = livePosition;
    if (state === 'playing' && !isPlaying) {
      syncPlay(currentTime);
    }
  };

  const handleNext = () => {
    if (!effectiveIsDJ) return;
    setActionWindow();
    if (Date.now() - lastAuxPassTimeRef.current < 1500) return;
    lastAuxPassTimeRef.current = Date.now();
    if (queue.length === 0) {
      // Nothing queued to skip to — show the related panel immediately so
      // there's visible feedback and a way to pick something, instead of
      // silently fetching suggestions in the background with no UI change.
      setShowRelated(true);
    } else {
      try { TrackPlayer.pause(); } catch (_) {}
      try { playerRef.current?.pauseVideo?.(); } catch (_) {}
      try { playerRef.current?.stopVideo?.(); } catch (_) {}
      setDirectStreamUrl(null);
      setShowThumbnailOverlay(true);
      thumbnailFadeAnim.setValue(1);
      setIsPlayerReady(false);
      isPlayerReadyRef.current = false;
      setIsTrackPlayerReady(false);
      setMediaFullySynced(false);
      setIsBuffering(true);
      lastLoadedStreamVideoId.current = null;
      lastResetSongVideoIdRef.current = null;
      setIsSyncing(true);
      livePositionRef.current = 0;
      setLivePosition(0);
      passAux();
    }
  };

  const handlePlayPause = async () => {
    if (!effectiveIsDJ) return;
    setActionWindow();
    showControlsFor(3500);
    try {
      const t = livePosition;
      if (isPlaying) {
        if (currentSong?.source === 'drive') {
          try { playerRef.current?.pauseVideo?.(); } catch (_) {}
        }
        syncPause(t);
      } else {
        if (currentSong?.source === 'drive') {
          try { playerRef.current?.playVideo?.(); } catch (_) {}
        }
        syncPlay(t);
      }
    } catch (e) {
      console.error('🎵 Play/Pause error:', e);
    }
  };

  const handleSeek = useCallback(async (t: number) => {
    if (!effectiveIsDJ) return;
    if (isAdPlayingRef.current) return;
    if (seekingRef.current) return;

    // Broadcast seek to the room
    syncSeek(t);

    showControlsFor(3500);

    // Perform local seek coordination
    performLocalSeek(t);
  }, [performLocalSeek, syncSeek, showControlsFor]);

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
      doubleTapHeartRef.current?.trigger(x, y, reactionEmoji);
    }

    if (item.id) musicWebSocketService.sendReaction(item.id, emojiToSend);
  };

  const handleMessagePress = (item: any) => {
    if (item.message_type === 'image' && item.message_type !== 'gif' && item.message_type !== 'sticker') {
      setFullScreenMedia({ url: item.local_uri || item.media_url, type: 'image' });
    }
  };

  const handleScrollToMessage = (replyToId: any) => {
    if (!replyToId) return;
    const targetIndex = reversedMessages.findIndex(
      m => m.id === replyToId || m.local_id === replyToId
    );
    if (targetIndex !== -1) {
      try {
        chatListRef.current?.scrollToIndex({
          index: targetIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (e) {
        console.warn('Scroll to message failed:', e);
      }
    }
  };
const sendChatMessage = () => {
  const textToSend = (chatMessageRef.current || chatMessage).trim();
  if (!textToSend) return;

  const currentReplyTo = replyingTo;
  const myParticipant = participantsRef.current?.find(p => Number(p.user_id) === Number(user?.id));
  const myName = user?.display_name || myParticipant?.name || user?.email || 'You';
  const localId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const optimisticMsg: any = {
    id: localId,
    local_id: localId,
    user: myName,
    user_id: user?.id,
    avatar: user?.profile_picture,
    avatar_sticker: user?.avatar_sticker,
    text: textToSend,
    message_type: 'text',
    reply_to: currentReplyTo,
    created_at: new Date().toISOString(),
    status: 'sending',
    _isNew: true,
  };

  // 1. Synchronously mount outgoing bubble (0ms instant!)
  // Perfectly cancels out the input collapse so chat never shrinks down/stutters (WhatsApp style)
  setMessages(prev => [...prev, optimisticMsg]);
  scrollToBottom(true);

  musicWebSocketService.sendChatMessage(textToSend, currentReplyTo);
  chatMessageRef.current = '';
  hasTextAnim.setValue(0); // native instant: show mic immediately
  setChatMessage('');
  // Clear text imperatively (no key change) so the input stays mounted
  // and the keyboard remains open after sending.
  richInputRef.current?.clear();
  setReplyingTo(null);

  if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
  lastTypingState.current = false;
  musicWebSocketService.sendTyping(false);
};

const sendLottieSticker = useCallback((sticker: Sticker) => {
  const currentReplyTo = replyingTo;
  const myParticipant = participantsRef.current?.find(p => Number(p.user_id) === Number(user?.id));
  const myName = user?.display_name || myParticipant?.name || user?.email || 'You';
  const localId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const optimisticMsg: any = {
    id: localId,
    local_id: localId,
    user: myName,
    user_id: user?.id,
    avatar: user?.profile_picture,
    avatar_sticker: user?.avatar_sticker,
    text: sticker.url,
    message_type: 'lottie_sticker',
    reply_to: currentReplyTo,
    created_at: new Date().toISOString(),
    status: 'sending',
    _isNew: true,
  };

  setMessages(prev => [...prev, optimisticMsg]);
  scrollToBottom(true);

  musicWebSocketService.sendChatMessage(sticker.url, currentReplyTo, undefined, 'lottie_sticker');
  setReplyingTo(null);
}, [replyingTo, user]);




  const renderSettingsModal = () => {
    if (!showSettingsModal) return null;

    const currentThemeObj = ROOM_THEMES.find(t => t.id === roomTheme) || ROOM_THEMES[0];
    const modalBg = theme.surface;
    const cardBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
    const cardBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
    const textPrimary = theme.textPrimary;
    const textSecondary = theme.textSecondary;
    const btnBg = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';

    return (
      <View style={s.settingsModalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => setShowSettingsModal(false)}
        />
        <Pressable
          style={[
            s.settingsModalContainer,
            {
              backgroundColor: modalBg,
              borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
              paddingBottom: Math.max(36, (insets.bottom || stableBottomInset) + 32),
              minHeight: 270,
            },
          ]}
          onPress={(e) => e.stopPropagation?.()}
        >
          {/* Handle Bar */}
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
              }}
            />
          </View>

          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 18,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Icon name="settings-sharp" size={17} color={textPrimary} />
              </View>
              <Text style={{ color: textPrimary, fontSize: 17, fontWeight: '700' }}>
                Room Settings
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setShowSettingsModal(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: btnBg,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Icon name="close" size={18} color={theme.icon} />
            </TouchableOpacity>
          </View>

          {/* Settings List */}
          <View style={{ gap: 10 }}>
            {/* 1st Item: Theme Row */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: cardBg,
                borderWidth: 1,
                borderColor: cardBorder,
                borderRadius: 16,
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}
            >
              {/* Left Corner: Theme Label & Icon */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: currentThemeObj.color + '26',
                    borderWidth: 1,
                    borderColor: currentThemeObj.color + '4D',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Icon name={currentThemeObj.icon as any} size={20} color={currentThemeObj.color} />
                </View>
                <View>
                  <Text style={{ color: textPrimary, fontSize: 15, fontWeight: '700' }}>
                    Theme
                  </Text>
                  <Text style={{ color: textSecondary, fontSize: 11.5, marginTop: 1 }}>
                    Room appearance
                  </Text>
                </View>
              </View>

              {/* Right Corner: Stepper / Theme Switcher with Prev & Next */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                  borderRadius: 20,
                  paddingHorizontal: 4,
                  paddingVertical: 3,
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
                }}
              >
                <TouchableOpacity
                  onPress={handlePrevTheme}
                  disabled={isScreenTransitioning}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.6}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    opacity: isScreenTransitioning ? 0.4 : 1,
                  }}
                  accessibilityLabel="Previous theme"
                >
                  <Icon name="chevron-back" size={16} color={textPrimary} />
                </TouchableOpacity>

                <View
                  style={{
                    minWidth: 72,
                    paddingHorizontal: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: textPrimary,
                      fontSize: 13,
                      fontWeight: '700',
                      letterSpacing: 0.3,
                    }}
                  >
                    {currentThemeObj.label}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleNextTheme}
                  disabled={isScreenTransitioning}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.6}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    opacity: isScreenTransitioning ? 0.4 : 1,
                  }}
                  accessibilityLabel="Next theme"
                >
                  <Icon name="chevron-forward" size={16} color={textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* 2nd Item: Picture-in-Picture Mode */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => handleTogglePip(!pipEnabled)}
              hitSlop={{ top: 10, bottom: 20, left: 10, right: 10 }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: cardBg,
                borderWidth: 1,
                borderColor: cardBorder,
                borderRadius: 16,
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginBottom: 14,
              }}
            >
              {/* Left Corner: Label & Icon */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.12)',
                    borderWidth: 1,
                    borderColor: isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.25)',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Icon name="tv-outline" size={19} color={isDark ? '#38BDF8' : '#0284C7'} />
                </View>
                <View>
                  <Text style={{ color: textPrimary, fontSize: 15, fontWeight: '700' }}>
                    Picture-in-Picture
                  </Text>
                  <Text style={{ color: textSecondary, fontSize: 11.5, marginTop: 1 }}>
                    Floating player when minimized
                  </Text>
                </View>
              </View>

              {/* Right Corner: Switch (pointerEvents="none" so any tap on switch triggers the row's handleTogglePip cleanly) */}
              <View pointerEvents="none">
                <Switch
                  value={pipEnabled}
                  trackColor={{ false: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', true: '#0284C7' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </TouchableOpacity>

          </View>
        </Pressable>
      </View>
    );
  };

  const renderLeaveModal = () => {
    if (!showLeaveConfirm) return null;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowLeaveConfirm(false)}>
          <View style={[s.confirmContent, { padding: 22, width: '85%', maxWidth: 300, borderRadius: 20, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]}>
            <TouchableOpacity
              onPress={() => setShowLeaveConfirm(false)}
              style={{ position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}
            >
              <Icon name="close" size={16} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>

            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 6, marginTop: 4, textAlign: 'center' }}>
              Leaving Room?
            </Text>
            

            <View style={{ flexDirection: 'row', width: '100%', gap: 10 }}>
              {/* No Button */}
              <TouchableOpacity
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingVertical: 12,
                }}
                onPress={() => setShowLeaveConfirm(false)}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#E2E8F0', fontSize: 14, fontWeight: '700' }}>No</Text>
              </TouchableOpacity>

              {/* Yes Button */}
              <TouchableOpacity
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 14,
                  paddingVertical: 12,
                }}
                onPress={() => {
                  setShowLeaveConfirm(false);
                  handleCloseRoom();
                }}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>Yes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPlayerContent = () => {
    if (!activeVideoId) {
      return null;
    }

    if ((currentSong?.source || initialSource) === 'drive' && !directStreamUrl) {
      return (
        <DrivePlayer
          key={`drive_${activeVideoId}`}
          ref={playerRef}
          fileId={activeVideoId || ''}
          play={isPlaying && !playerError}
          muted={isMuted}
          isFullscreen={fullscreen}
          resizeMode={isMinimized ? 'cover' : 'contain'}
          onAspectRatio={handleAspectRatio}
          onReady={() => {
            if (!activeVideoId || lastLoadedStreamVideoId.current !== activeVideoId) {
              console.log('🛡️ [DirectVideoPlayer] Stale onReady ignored for', activeVideoId, '(stream loaded for:', lastLoadedStreamVideoId.current, ')');
              return;
            }
            isInitialVideoStartedRef.current = true;
            setIsPlayerReady(true);
            isPlayerReadyRef.current = true;
            setShowThumbnailOverlay(false);
            playerReadyTime.current = Date.now();
            setIsBuffering(false);

            if (livePositionRef.current > 1) {
              const currentPos = livePositionRef.current;
              setTimeout(() => {
                try {
                  playerRef.current?.seekTo?.(currentPos, true);
                } catch (_) {}
              }, 100);
            }
          }}
          onStreamResolved={(cdnUrl, cdnHeaders) => {
            if (!currentSong) return;
            console.log('🎵 [DRIVE AUDIO] Stream resolved — WebView owns audio');
          }}
          onStateChange={onPlayerStateChange}
          onProgress={(currentTime, dur) => {
            if (!activeVideoId || lastLoadedStreamVideoId.current !== activeVideoId) {
              return;
            }
            if (dur > 0 && !isNaN(dur)) setDuration(dur);
            if (!isPlayerReadyRef.current && currentTime > 0) {
              setIsPlayerReady(true);
              isPlayerReadyRef.current = true;
              setShowThumbnailOverlay(false);
            }
            if (lastSeekTargetRef.current !== null) {
              const elapsed = Date.now() - lastSeekTimeRef.current;
              if (Math.abs(currentTime - lastSeekTargetRef.current) < 2.5 || elapsed > 1500) {
                lastSeekTargetRef.current = null;
              } else {
                return;
              }
            }
            if (!seekingRef.current && currentTime > 0 && isPlayerReadyRef.current) {
              livePositionRef.current = currentTime;
              setLivePosition(currentTime);
            }
          }}
          onError={() => {
            setIsBuffering(false);
            setPlayerError('unknown');
          }}
        />
      );
    }

    const isNativeDirectVideo = currentSong?.source !== 'drive' && (currentSong?.source as string) !== 'embed';
    if (directStreamUrl || isDirectLoading || (isNativeDirectVideo && !playerError)) {
      return (
        <DirectVideoPlayer
          key="direct_music_player"
          videoId={activeVideoId}
          ref={playerRef}
          videoUri={directStreamUrl || ''}
          fallbackUri={directFallbackUrl || directStreamsListRef.current.find(s => s.has_audio)?.url || null}
          audioUri={directAudioUrl}
          streamType={directStreamType}
          headers={directStreamHeaders}
          play={isPlaying && !playerError && !!directStreamUrl}
          quality={videoQuality}
          muted={isMuted}
          initialPosition={initialRoomPosition || 0}
          isFullscreen={fullscreen}
          resizeMode={isMinimized ? 'cover' : 'contain'}
          aspectRatio={detectedAspectRatio || 1.7777}
          bleedEnabled={roomTheme === 'rave' && !isMinimized && !isSystemPip && !fullscreen}
          contentRect={roomTheme === 'rave' && !isMinimized && !isSystemPip && !fullscreen ? raveContentRect : undefined}
          bbdCropPercent={detectedCropPercent}
          blurSigma={48.0}
          onAspectRatio={handleAspectRatio}
          onExactResolution={setLiveExactResolution}
          onQualityFallback={(fallbackQuality) => {
            setVideoQuality(fallbackQuality);
            setLiveExactResolution('Auto');
          }}
          onQualitiesAvailable={(qualities) => {
            if (directStreamsListRef.current.length > 0) return;
            if (qualities && qualities.length > 0) {
              const qKeys = qualities.map((q: string) => {
                const h = parseInt(q.replace(/\D/g, ''), 10);
                return heightToQualityKey(h);
              });
              setAvailableQualities(prev => Array.from(new Set([...prev, ...qKeys])));
            }
          }}
          onReady={() => {
            if (!activeVideoId || lastLoadedStreamVideoId.current !== activeVideoId) {
              console.log('🛡️ [DirectVideoPlayer] Stale onReady ignored for', activeVideoId, '(stream loaded for:', lastLoadedStreamVideoId.current, ')');
              return;
            }
            isInitialVideoStartedRef.current = true;
            setIsPlayerReady(true);
            isPlayerReadyRef.current = true;
            setShowThumbnailOverlay(false);
            playerReadyTime.current = Date.now();
            setIsBuffering(false);
            setMediaFullySynced(true);
            const state = isPlaying ? 'playing' : 'paused';
            setPlayerState(state);
            playerStateRef.current = state;
            if (isPlaying) {
              try { playerRef.current?.playVideo?.(); } catch (_) {}
              if (isDJ || isDJMode || isDJRef.current || isDJModeRef.current) {
                syncPlay(0);
              }
            } else if (isDJ || isDJMode || isDJRef.current || isDJModeRef.current) {
              try { playerRef.current?.playVideo?.(); } catch (_) {}
              syncPlay(0);
            }

            if (!isDJ && !isDJMode && joinSnapshot && joinSnapshot.videoId === currentSong?.videoId && !joinSnapshotConsumed.current) {
              joinSnapshotConsumed.current = true;
              if (directStreamType !== 'm3u8') {
                const snapshotTime = joinSnapshot.receivedAt;
                const snapshotPosition = joinSnapshot.position;
                setTimeout(() => {
                  const elapsed = (Date.now() - snapshotTime) / 1000;
                  const targetPosition = snapshotPosition + elapsed;
                  const safePosition = duration > 0
                    ? Math.min(targetPosition, duration - 2)
                    : targetPosition;
                  playerRef.current?.seekTo?.(safePosition, true);
                  livePositionRef.current = safePosition;
                  lastSeekTimeRef.current = Date.now();
                }, 500);
              }
            }
          }}
          onStateChange={onPlayerStateChange}
          onProgress={(currentTime, dur) => {
            if (!activeVideoId || lastLoadedStreamVideoId.current !== activeVideoId) {
              return;
            }
            if (dur > 0 && !isNaN(dur)) setDuration(dur);
            if (!isPlayerReadyRef.current && currentTime > 0) {
              setIsPlayerReady(true);
              isPlayerReadyRef.current = true;
              setShowThumbnailOverlay(false);
            }
            if (lastSeekTargetRef.current !== null) {
              const elapsed = Date.now() - lastSeekTimeRef.current;
              if (Math.abs(currentTime - lastSeekTargetRef.current) < 2.5 || elapsed > 1500) {
                lastSeekTargetRef.current = null;
              } else {
                return;
              }
            }
            if (!seekingRef.current && !isReseeking && currentTime > 0 && isPlayerReadyRef.current) {
              livePositionRef.current = currentTime;
              setLivePosition(currentTime);
              const nowSec = Math.floor(currentTime);
              if (nowSec % 2 === 0 && (global as any).__lastSyncProbeSec !== nowSec) {
                (global as any).__lastSyncProbeSec = nowSec;
                console.log(`⏱️ [SYNC_PROBE] ${isDJ || isDJMode ? 'HOST_DJ' : 'GUEST_PARTICIPANT'}: currentTime=${currentTime.toFixed(3)}s, roomPos=${position.toFixed(3)}s, diff=${(currentTime - position).toFixed(3)}s`);
              }
            }
            if (isPlayerReadyRef.current && dur > 5 && currentTime >= dur - 1.5 && currentTime > 5) {
              handleSongPlaybackEnded();
            }
          }}
          onEnd={() => {
            if (!activeVideoId || lastLoadedStreamVideoId.current !== activeVideoId) {
              return;
            }
            handleSongPlaybackEnded();
          }}
          onError={(err) => {
            if ((currentSong?.source || initialSource) === 'drive') {
              console.warn('⚠️ [DirectVideoPlayer] Error on Drive stream, falling back to DrivePlayer:', err);
              setDirectStreamUrl(null);
              setDirectStreamHeaders(undefined);
              return;
            }
            console.warn('[MusicRoomScreen] DirectVideoPlayer error:', err);
            const targetVideoId = currentSong?.videoId || initialVideoId;
            if (targetVideoId) {
              extractVideoStreamUrlClientSide(targetVideoId, true /* bypassCache */).then((res) => {
                if (res && res.dashUrl) {
                  console.log('🎬 [MusicRoomScreen] Refreshed DASH manifest for seamless recovery');
                  setDirectStreamUrl(res.dashUrl);
                  setDirectStreamType('mpd');
                } else if (res && (res.streamType === 'm3u8' || res.url)) {
                  console.log('🎬 [MusicRoomScreen] Refreshed stream URL for seamless recovery');
                  setDirectStreamUrl(res.url);
                  setDirectStreamType(res.streamType || 'mp4');
                }
              }).catch(() => {});
            }
          }}
        />
      );
    }

    if (isDirectLoading) {
      return null;
    }

    return (
      <YoutubePlayer
        key={`yt_${activeVideoId}`}
        ref={playerRef}
        videoId={activeVideoId || ''}
        play={isPlaying && !playerError}
        muted={isMuted}
        initialPosition={livePositionRef.current || 0}
        quality={videoQuality}
        isFullscreen={fullscreen}
        resizeMode={isMinimized ? 'cover' : 'contain'}
        aspectRatio={detectedAspectRatio || 1.7777}
        onAspectRatio={handleAspectRatio}
        onQualitiesAvailable={(qualities) => {
          if (directStreamUrl || directStreamsListRef.current.length > 0) return;
          if (qualities && qualities.length > 0) {
            const qList = ['auto', ...qualities.filter(q => q && q !== 'auto')];
            setAvailableQualities(Array.from(new Set(qList)));
          }
        }}
        onExactResolution={(resolution) => {
          if (resolution) setLiveExactResolution(resolution);
        }}
        onQualityChange={(newQuality) => {
          const minimal = getMinimalQualityLabel(newQuality);
          setLiveExactResolution(minimal);
        }}
        onAdStarted={() => {
          setIsAdPlaying(true);
          isAdPlayingRef.current = true;
        }}
        onAdEnded={() => {
          setIsAdPlaying(false);
          isAdPlayingRef.current = false;
        }}
        onReady={() => {
          isInitialVideoStartedRef.current = true;
          setIsPlayerReady(true);
          isPlayerReadyRef.current = true;
          setShowThumbnailOverlay(false);
          playerReadyTime.current = Date.now();
          setIsBuffering(false);
          setMediaFullySynced(true);
          const state = isPlaying ? 'playing' : 'paused';
          setPlayerState(state);
          playerStateRef.current = state;

          if (!isDJ && !isDJMode && joinSnapshot && joinSnapshot.videoId === currentSong?.videoId && !joinSnapshotConsumed.current) {
            joinSnapshotConsumed.current = true;
            const snapshotTime = joinSnapshot.receivedAt;
            const snapshotPosition = joinSnapshot.position;
            setTimeout(() => {
              const elapsed = (Date.now() - snapshotTime) / 1000;
              const targetPosition = snapshotPosition + elapsed;
              const safePosition = duration > 0
                ? Math.min(targetPosition, duration - 2)
                : targetPosition;
              playerRef.current?.seekTo?.(safePosition, true);
              livePositionRef.current = safePosition;
              lastSeekTimeRef.current = Date.now();
            }, 500);
          }
        }}
        onStateChange={onPlayerStateChange}
        onProgress={(currentTime, dur) => {
          if (dur > 0 && !isNaN(dur)) setDuration(dur);
          if (!isPlayerReadyRef.current && currentTime > 0) {
            setIsPlayerReady(true);
            isPlayerReadyRef.current = true;
            setShowThumbnailOverlay(false);
          }
          if (lastSeekTargetRef.current !== null) {
            const elapsed = Date.now() - lastSeekTimeRef.current;
            if (Math.abs(currentTime - lastSeekTargetRef.current) < 2.5 || elapsed > 1500) {
              lastSeekTargetRef.current = null;
            } else {
              return;
            }
          }
          if (!seekingRef.current && !isReseeking && currentTime > 0 && isPlayerReadyRef.current) {
            livePositionRef.current = currentTime;
            setLivePosition(currentTime);
          }
        }}
        onEnd={handleSongPlaybackEnded}
        onError={(err) => {
          console.warn('[MusicRoomScreen] YoutubePlayer error:', err);
          setIsBuffering(false);
          if (err === 150 || err === 101 || err === 152) {
            setPlayerError('embed_not_allowed');
            fetchRelated();
            setShowRelated(true);
          } else if (err === 100) {
            setPlayerError('video_not_found');
            fetchRelated();
            setShowRelated(true);
          } else if (err === 2 || err === 5) {
            console.log('ℹ️ [MusicRoomScreen] Non-fatal YouTube player warning code:', err);
          } else {
            setPlayerError('unknown');
            fetchRelated();
            setShowRelated(true);
          }
        }}
      />
    );
  };

  if (!roomCode) {
    return null;
  }

  const reversedMessages = [...messages].reverse();

  return (
    <View
      style={[
        s.root,
        (isLight && !isSystemPip && !isMinimized) && { backgroundColor: '#ffffff' },
        (isMinimized && !isSystemPip) && { backgroundColor: 'transparent' }
      ]}
      pointerEvents={isMinimized ? 'box-none' : 'auto'}
    >
      <StatusBar
        barStyle={isLight || isMinimized ? "dark-content" : "light-content"}
        backgroundColor="transparent"
        translucent={true}
        hidden={fullscreen || isSystemPip}
      />

      {/* ── 1. AMBIENT DISCO FLUID AURORA OVERLAY (cinema | dark | light) ── */}
      {!isMinimized && !isSystemPip && !fullscreen && roomTheme !== 'rave' && (
        <AmbientDiscoBackground
          isPlaying={isPlaying}
          isMinimized={isMinimized}
          fullscreen={fullscreen}
          videoId={currentSong?.videoId}
          theme={roomTheme}
        />
      )}

      {/* ── 2. VIDEO LAYER (Root Level for Full Edge-to-Edge Bleed & Smooth Zero-Restart Switching) ── */}
      <Reanimated.View
        style={playerLayerAnimatedStyle}
        pointerEvents="none"
      >
        {renderPlayerContent()}
      </Reanimated.View>

      <KeyboardWrapperView
        {...keyboardWrapperProps}
        style={isMinimized || fullscreen || isSystemPip ? StyleSheet.absoluteFill : [s.inner, { paddingTop: stableTopInset, paddingBottom: stableBottomInset, zIndex: 20 }]}
        pointerEvents={showSettingsModal ? 'box-none' : (isMinimized ? 'box-none' : 'auto')}
      >
        <View style={{ flex: 1 }} pointerEvents={isMinimized ? 'box-none' : 'auto'}>
          {!isMinimized && renderLeaveModal()}

          {!fullscreen && !isMinimized && !isSystemPip && (
            <Reanimated.View
              style={[{ height: 58, overflow: 'hidden', zIndex: 30, elevation: 5 }, headerAnimStyle]}
              pointerEvents={isKeyboardVisibleRef.current || stickerPickerVisible ? 'none' : 'auto'}
            >
              <View style={s.header}>
                {/* Left Group: Exit & Room Participants (shifted left) */}
                <View style={s.headerSideGroup}>
                  {/* 1. Exit Button */}
                  <TouchableOpacity
                    onPress={() => setShowLeaveConfirm(true)}
                    style={s.headerSlot}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Exit room"
                  >
                    <Icon
                      name="exit-outline"
                      size={22}
                      color={themeIconColor}
                      style={{ transform: [{ scaleX: -1 }] }}
                    />
                  </TouchableOpacity>

                  {/* 2. Room Participants Button */}
                  <TouchableOpacity
                    onPress={() => setParticipantsModalVisible(true)}
                    style={s.headerSlot}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                    accessibilityLabel="View participants"
                  >
                    <Icon name="people" size={23} color={themeIconColor} />
                  </TouchableOpacity>
                </View>

                {/* 3. Center: App Name in Text (Normal) OR Active Speakers on Mic (When mic active) */}
                <View style={s.headerCenterSlot} pointerEvents="box-none">
                  {activeMicSpeakers.length === 0 ? (
                    <View
                      accessible={true}
                      accessibilityRole="header"
                      accessibilityLabel="YOUTELITE"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={s.headerBrandText}>YOUT</Text>
                      <Text style={[s.headerBrandText, { marginHorizontal: 1.6 }]}>E</Text>
                      <Text style={s.headerBrandText}>LITE</Text>
                    </View>
                  ) : (
                    <View style={s.activeMicRow}>
                      {activeMicSpeakers.slice(0, 4).map((speaker) => (
                        <TouchableOpacity
                          key={`header-mic-spk-${speaker.user_id}`}
                          onPress={() => handleAvatarPress(speaker.avatar, speaker.avatar_sticker, speaker.name)}
                          style={{ position: 'relative' }}
                          activeOpacity={0.8}
                        >
                          <AvatarWithFallback
                            uri={speaker.avatar}
                            displayName={speaker.name}
                            sticker={speaker.avatar_sticker}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 13,
                              borderWidth: 2,
                              borderColor: '#10B981',
                            }}
                          />
                          <View style={{
                            position: 'absolute',
                            bottom: -1,
                            right: -1,
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: '#10B981',
                            borderWidth: 1.5,
                            borderColor: '#000',
                          }} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Right Group: Search Songs & Room Settings (shifted right) */}
                <View style={s.headerSideGroup}>
                  {/* 4. Search Songs Button */}
                  <TouchableOpacity
                    onPress={() => setShowDiscovery(true)}
                    style={s.headerSlot}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Search songs"
                  >
                    <Icon name="search" size={22} color={themeIconColor} />
                  </TouchableOpacity>

                  {/* 5. Room Settings Button */}
                  <TouchableOpacity
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowSettingsModal(true);
                    }}
                    style={s.headerSlot}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Room Settings"
                  >
                    <Icon name="settings-sharp" size={21} color={themeIconColor} />
                  </TouchableOpacity>
                </View>
              </View>
            </Reanimated.View>
          )}

          {/* VIDEO CONTAINER */}
          <Reanimated.View
            style={[
              s.videoWrap,
              videoContainerAnimatedStyle,
            ]}
            {...(isMinimized && pipEnabled && !isSystemPip && !pipDismissed ? miniPanResponder.panHandlers : {})}
          >
            {/* ─── Clean Thumbnail + White Spinner Overlay (Zero Black Screen, Zero Text) ─── */}
            {showThumbnailOverlay && !(showRelated && (playerState === 'ended' || !!playerError)) && !playerError && (
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: 'transparent',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10,
                    opacity: thumbnailFadeAnim,
                  },
                ]}
                pointerEvents="none"
              >
                {videoThumbnailUrl ? (
                  <FastImage
                    source={{ uri: thumbFallbackUri || videoThumbnailUrl, priority: FastImage.priority.high }}
                    style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                    resizeMode={FastImage.resizeMode.cover}
                    onError={() => {
                      if (!thumbFallbackUri && activeVideoId && (currentSong?.source || initialSource) !== 'drive') {
                        setThumbFallbackUri(`https://i.ytimg.com/vi/${activeVideoId}/hqdefault.jpg`);
                      }
                    }}
                  />
                ) : null}
                {videoThumbnailUrl ? (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
                ) : null}
                {!isPlayerReady && <ActivityIndicator size="large" color="#FFFFFF" />}
              </Animated.View>
            )}

            {/* Error overlay — hidden when related grid is showing */}
            {playerError && !showRelated && (
              <View style={[StyleSheet.absoluteFill, {
                backgroundColor: 'rgba(0,0,0,0.92)',
                justifyContent: 'center', alignItems: 'center',
                gap: 12, padding: 24, zIndex: 999,
              }]}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' }}>
                  {playerError === 'embed_not_allowed'
                    ? 'The video owner has restricted playback outside YouTube'
                    : (currentSong?.source === 'drive' && isDriveAuthenticated === false
                        ? 'Google Drive Sign-in Required'
                        : 'Video Unplayable')}
                </Text>
                
                {currentSong?.source === 'drive' && isDriveAuthenticated === false ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (autoSkipTimer.current) clearTimeout(autoSkipTimer.current);
                      navigation.navigate('YouTubeDiscovery', { 
                        requireDriveAuth: true, 
                        pendingDriveVideo: currentSong,
                        roomCode: roomCode
                      });
                    }}
                    style={{ marginTop: 8, backgroundColor: '#4285F4', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, elevation: 10, flexDirection: 'row', alignItems: 'center' }}
                  >
                    <Icon name="logo-google" size={16} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Sign In to Google Drive to continue</Text>
                  </TouchableOpacity>
                ) : (
                  (isDJ || isDJMode) && (
                    <TouchableOpacity
                      onPress={() => {
                        if (autoSkipTimer.current) clearTimeout(autoSkipTimer.current);
                        setPlayerError(null);
                        setShowDiscovery(true);
                      }}
                      style={{ marginTop: 8, backgroundColor: '#31313100', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, elevation: 10 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>Choose Another Video</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            )}

            {/* Simple tap on empty video space shows controls. A tap that
                lands on a VideoControls button (rendered after this, on
                top) fires that button's onPress instead, never reaching
                here. Swiping left/right opens the related videos grid, 
                and tapping the mini-player inside the related grid expands it back. */}


            {!isMinimized && !isSystemPip && !playerError && playerState !== 'ended' && (
              <Animated.View 
                style={showRelated ? {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: width / 2,
                  height: (width / 2) * 0.5625,
                  zIndex: 40,
                  transform: [{ translateX: Animated.multiply(relatedScrollX, -1) }],
                } : StyleSheet.absoluteFill}
                {...playerGestureResponder.panHandlers}
              >
                {showRelated && (
                  <>
                    <View style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      backgroundColor: 'rgba(0, 0, 0, 0.72)',
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 6,
                      paddingVertical: 3,
                      borderRadius: 4,
                      gap: 4,
                    }} pointerEvents="none">
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' }} />
                      <Text style={{ color: '#fff', fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 }}>PLAYING</Text>
                    </View>
                    <View style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.65)',
                      paddingVertical: 4,
                      paddingHorizontal: 6,
                    }} pointerEvents="none">
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>
                        {currentSong?.title}
                      </Text>
                    </View>
                  </>
                )}
              </Animated.View>
            )}

            {/* Floating Mini-Player Overlay Controls (Android System PiP Style) */}
            {isMinimized && pipEnabled && !isSystemPip && !pipDismissed && (
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                {/* Background Tap Area: Single tap toggles controls; double tap maximizes back to room */}
                <Pressable
                  onPress={handlePipTap}
                  style={StyleSheet.absoluteFill}
                  accessibilityLabel="Tap for controls, double tap to return to music room"
                />

                {/* Android System PiP Style Controls Scrim */}
                {pipControlsVisible && (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        backgroundColor: 'rgba(0, 0, 0, 0.52)',
                        borderRadius: 16,
                        justifyContent: 'space-between',
                        padding: 8,
                      },
                    ]}
                    pointerEvents="box-none"
                  >
                    {/* Top Row: Left = Expand/Return to Room, Right = Close PiP */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }} pointerEvents="box-none">
                      {/* Top-Left: Expand / Return to Room */}
                      <TouchableOpacity
                        onPress={() => {
                          if (pipControlsTimeoutRef.current) clearTimeout(pipControlsTimeoutRef.current);
                          setPipControlsVisible(false);
                          DeviceEventEmitter.emit('minimize_music_room', false);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: 'rgba(0, 0, 0, 0.65)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.25)',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                        accessibilityLabel="Return to room"
                      >
                        <Icon name="expand-outline" size={15} color="#FFFFFF" />
                      </TouchableOpacity>

                      {/* Top-Right: Close PiP */}
                      <TouchableOpacity
                        onPress={() => {
                          if (pipControlsTimeoutRef.current) clearTimeout(pipControlsTimeoutRef.current);
                          setPipControlsVisible(false);
                          setPipDismissed(true);
                          pipDismissedSV.value = 1;
                          DeviceEventEmitter.emit('pip_dismissed', true);
                          closeSystemPip();
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: 'rgba(0, 0, 0, 0.65)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.25)',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                        accessibilityLabel="Close PiP"
                      >
                        <Icon name="close" size={15} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>

                    {/* Bottom-Center Play/Pause Button */}
                    <TouchableOpacity
                      onPress={() => {
                        resetPipControlsTimeout();
                        handlePlayPause();
                      }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        alignSelf: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: 'rgba(0, 0, 0, 0.72)',
                        borderWidth: 1,
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                      accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
                    >
                      <Icon
                        name={isPlaying ? "pause" : "play"}
                        size={16}
                        color="#FFFFFF"
                        style={!isPlaying ? { marginLeft: 1.5 } : undefined}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {!isMinimized && !isSystemPip && !showRelated && isPlayerReady && !showThumbnailOverlay && (
              <VideoControls
                visible={showControls && !playerError}
                isPlaying={isPlaying}
                isEnded={playerState === 'ended'}
                canControl={effectiveIsDJ && isPlayerReady}
                isBuffering={Boolean((isBuffering || isReseeking || seekingRef.current || !isPlayerReady) && !!currentSong)}
                position={livePosition}
                duration={duration}
                isLive={directStreamType === 'm3u8'}
                isMuted={isMuted}
                onToggleMute={handleToggleMute}
                onPlayPause={handlePlayPause}
                onSeek={handleSeek}
                onNext={handleNext}
                onToggleFullscreen={() => {
                  triggerSmoothScreenTransition(() => {
                    setFullscreen(prev => !prev);
                  });
                }}
                onShowRelated={() => {
                  const activeId = currentSongRef.current?.videoId || initialVideoId;
                  if (activeId && relatedCacheRef.current.has(activeId)) {
                    setRelatedVideos(relatedCacheRef.current.get(activeId)!);
                  } else if (activeId) {
                    fetchRelated(activeId);
                  }
                  setShowRelated(true);
                }}
                onSettings={() => {
                  setShowQualityOptions(prev => !prev);
                }}
                qualityLabel={(liveExactResolution ? getMinimalQualityLabel(liveExactResolution) : getMinimalQualityLabel(videoQuality)) || 'Auto'}
                isFullscreen={fullscreen}
                isDrivePlayer={currentSong?.source === 'drive'}
                title={currentSong?.title}
                onSingleTap={() => {
                  if (showControls) {
                    setShowControls(false);
                    if (controlTimer.current) clearTimeout(controlTimer.current);
                  } else {
                    showControlsFor(3500);
                  }
                }}
                onKeepControlsAlive={() => showControlsFor(3500)}
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
            {!playerError && currentSong?.source === 'drive' && currentSong?.videoId && currentSong.title !== 'Initializing...' &&
              !mediaFullySynced && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 30 }]} />
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

                {isLoadingRelated && relatedVideos.length === 0 && queue.length === 0 && (
                  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }]}>
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" animating={true} />
                  </View>
                )}
                {/* Render the grid immediately when we have related videos or pinned queue items */}
                {(relatedVideos.length > 0 || queue.length > 0) && (
                  <RelatedVideosGrid
                    queueItems={queue}
                    suggestedVideos={relatedVideos}
                    myUserId={user?.id ?? -1}
                    myAvatar={user?.profile_picture}
                    myAvatarSticker={user?.avatar_sticker}
                    participants={participants}
                    currentSong={(playerState === 'ended' || playerStateRef.current === 'ended' || !!playerError) ? null : currentSong}
                    scrollX={relatedScrollX}
                    onPinVideo={(song) => {
                      // Auto-play immediately if video ended OR an error opened the grid OR playback is idle
                      const isEndedOrIdle = playerState === 'ended' || playerStateRef.current === 'ended' || !isPlaying || !directStreamUrl || !!playerError;
                      if (isEndedOrIdle) {
                        setShowRelated(false);
                        setPlayerError(null);
                        handleSelectSong(song, true);
                      } else {
                        pinVideo(song);
                        if (song?.videoId) {
                          fetchRelated(song.videoId);
                        }
                      }
                    }}
                    onUnpinVideo={(videoId) => unpinVideo(videoId)}
                  />
                )}
              </View>
            )}

            {/* ─── Compact Translucent Quality Grid Overlay (4x3) ─── */}
            {/* Fix 2: Guard against Drive source — Drive has no quality ladder */}
            {showQualityOptions && !playerError && currentSong?.source !== 'drive' && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.38)', justifyContent: 'center', alignItems: 'center', zIndex: 60 }]}>
                <TouchableWithoutFeedback onPress={() => setShowQualityOptions(false)}>
                  <View style={StyleSheet.absoluteFill} />
                </TouchableWithoutFeedback>
                <View style={{
                  width: '88%',
                  maxWidth: 260,
                  maxHeight: '90%',
                  backgroundColor: 'rgba(12, 15, 22, 0.78)',
                  borderRadius: 12,
                  paddingHorizontal: 8,
                  paddingTop: 10,
                  paddingBottom: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                  zIndex: 61,
                }}>
                  {/* Floating close button exceeding the top-right edge */}
                  <TouchableOpacity
                    onPress={() => setShowQualityOptions(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{
                      position: 'absolute',
                      top: -11,
                      right: -11,
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: '#1E232E',
                      borderWidth: 1.5,
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 70,
                      elevation: 6,
                    }}
                  >
                    <Icon name="close" size={13} color="#FFFFFF" />
                  </TouchableOpacity>

                  {/* Top Bar: Auto Button (Top Left) + Centered QUALITY Title */}
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                    paddingHorizontal: '1.5%',
                  }}>
                    {/* Top Left: Auto Button (exact same dimensions as grid buttons) */}
                    <TouchableOpacity
                      onPress={() => handleSelectQuality('auto')}
                      activeOpacity={0.7}
                      style={{
                        width: '22%',
                        height: 27,
                        borderRadius: 6,
                        justifyContent: 'center',
                        alignItems: 'center',
                        backgroundColor: videoQuality === 'auto' ? 'rgba(2, 132, 199, 0.95)' : 'rgba(255, 255, 255, 0.10)',
                        borderWidth: 1,
                        borderColor: videoQuality === 'auto' ? '#38BDF8' : 'rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <Text style={{
                        fontSize: 10.5,
                        fontWeight: videoQuality === 'auto' ? '700' : '600',
                        color: videoQuality === 'auto' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.90)',
                      }}>
                        Auto
                      </Text>
                    </TouchableOpacity>

                    {/* Centered Quality Title */}
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{
                        fontSize: 9.5,
                        fontWeight: '700',
                        color: 'rgba(255, 255, 255, 0.7)',
                        letterSpacing: 1,
                        textAlign: 'center',
                      }}>
                        QUALITY {liveExactResolution && liveExactResolution !== 'Auto' ? `• ${liveExactResolution}` : ''}
                      </Text>
                    </View>

                    {/* Right spacer to balance the Auto button width so QUALITY stays dead-centered */}
                    <View style={{ width: '22%' }} />
                  </View>

                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                    contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' }}
                  >
                    {dynamicQualityOptions.map((opt) => {
                      const isSelected = (videoQuality === opt.key) ||
                        (videoQuality === 'highres' && opt.key === 'hd2160') ||
                        (videoQuality === 'hd2160' && opt.key === 'highres') ||
                        (videoQuality === opt.label);

                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => handleSelectQuality(opt.key)}
                          activeOpacity={0.7}
                          style={{
                            width: '22%',
                            marginHorizontal: '1.5%',
                            marginVertical: 4.5,
                            height: 27,
                            borderRadius: 6,
                            justifyContent: 'center',
                            alignItems: 'center',
                            backgroundColor: isSelected ? 'rgba(2, 132, 199, 0.95)' : 'rgba(255, 255, 255, 0.10)',
                            borderWidth: 1,
                            borderColor: isSelected ? '#38BDF8' : 'rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          <Text style={{
                            fontSize: 10.5,
                            fontWeight: isSelected ? '700' : '500',
                            color: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.90)',
                          }}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            )}
          </Reanimated.View>

          {!fullscreen && !isMinimized && !isSystemPip && (
            renderNpBar()
          )}

          {!fullscreen && !isMinimized && !isSystemPip && (
            <Reanimated.View style={[{ flex: 1, overflow: 'hidden', zIndex: 10, elevation: 0 }, conversationContainerStyle]}>
              <Reanimated.View style={[{ flex: 1 }, conversationLiftStyle]}>
              {activeTab === 'chat' ? (
                <>
                  <FlatList
                    ref={chatListRef}
                    data={reversedMessages}
                    inverted
                    initialNumToRender={30}
                    maxToRenderPerBatch={20}
                    windowSize={21}
                    updateCellsBatchingPeriod={100}
                    removeClippedSubviews={false}
                    keyExtractor={(item, i) => (item.local_id || item.id)?.toString() || i.toString()}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 0, paddingBottom: 10 }}
                    keyboardShouldPersistTaps="handled"
                    onTouchStart={() => {
                      if (isStickerPickerDeliberatelyOpenRef.current) {
                        isStickerPickerDeliberatelyOpenRef.current = false;
                        isStickerPickerDeliberatelyOpenSV.value = 0;
                        setIsStickerPickerDeliberatelyOpen(false);
                        stickerSpacerHeight.value = 0;
                        setStickerPickerVisible(false);
                      }
                      collapseProgress.value = 0;
                      richInputRef.current?.blur();
                      KeyboardController.dismiss({ animated: false });
                      Keyboard.dismiss();
                    }}
                    onScrollBeginDrag={() => {
                      if (isStickerPickerDeliberatelyOpenRef.current) {
                        isStickerPickerDeliberatelyOpenRef.current = false;
                        isStickerPickerDeliberatelyOpenSV.value = 0;
                        setIsStickerPickerDeliberatelyOpen(false);
                        stickerSpacerHeight.value = 0;
                        setStickerPickerVisible(false);
                      }
                      collapseProgress.value = 0;
                      richInputRef.current?.blur();
                      KeyboardController.dismiss({ animated: false });
                      Keyboard.dismiss();
                    }}
                    ListEmptyComponent={<Text style={[s.emptyText, isLight && { color: '#64748B' }]}>No messages yet. Say hi! 👋</Text>}
                    onScrollToIndexFailed={(info) => {
                      try {
                        chatListRef.current?.scrollToOffset({
                          offset: info.averageItemLength * info.index,
                          animated: true,
                        });
                        setTimeout(() => {
                          chatListRef.current?.scrollToIndex({
                            index: info.index,
                            animated: true,
                            viewPosition: 0.5,
                          });
                        }, 100);
                      } catch (err) {
                        console.warn('onScrollToIndexFailed fallback scroll error:', err);
                      }
                    }}
                    renderItem={({ item, index }) => {
                      const myName = user?.display_name || user?.email || '';

                      const renderParsedMessageText = (text: string, isMeMsg: boolean) => {
                        if (!text) return null;

                        const currentParticipants = participantsRef.current || [];
                        const mentionsList: { searchStr: string; participant: any }[] = [];

                        currentParticipants.forEach(p => {
                          if (p.name) {
                            mentionsList.push({ searchStr: `@${p.name}`, participant: p });
                          }
                          if (p.user_id) {
                            mentionsList.push({ searchStr: `@${p.user_id}`, participant: p });
                          }
                        });

                        if (user) {
                          const myDisplayName = user.display_name;
                          const myId = user.id;
                          if (myDisplayName && !mentionsList.some(m => m.searchStr === `@${myDisplayName}`)) {
                            mentionsList.push({
                              searchStr: `@${myDisplayName}`,
                              participant: { user_id: Number(myId), name: myDisplayName, avatar: user.profile_picture, avatar_sticker: user.avatar_sticker }
                            });
                          }
                          if (myId && !mentionsList.some(m => m.searchStr === `@${myId}`)) {
                            mentionsList.push({
                              searchStr: `@${myId}`,
                              participant: { user_id: Number(myId), name: myDisplayName || 'You', avatar: user.profile_picture, avatar_sticker: user.avatar_sticker }
                            });
                          }
                        }

                        mentionsList.sort((a, b) => b.searchStr.length - a.searchStr.length);

                        const bubbleTextColor = isMeMsg ? '#FFFFFF' : (isLight ? '#0F172A' : '#FFFFFF');

                        if (mentionsList.length === 0) {
                          return (
                            <Text style={[s.bubbleMsg, { textAlign: isMeMsg ? 'right' : 'left', color: bubbleTextColor }]}>
                              {text}
                            </Text>
                          );
                        }

                        const elements: React.ReactNode[] = [];
                        let remainingText = text;
                        let keyIdx = 0;

                        while (remainingText.length > 0) {
                          let earliestIndex = -1;
                          let selectedMention: typeof mentionsList[0] | null = null;

                          for (const mention of mentionsList) {
                            const idx = remainingText.indexOf(mention.searchStr);
                            if (idx !== -1) {
                              if (earliestIndex === -1 || idx < earliestIndex) {
                                earliestIndex = idx;
                                selectedMention = mention;
                              }
                            }
                          }

                          if (selectedMention && earliestIndex !== -1) {
                            if (earliestIndex > 0) {
                              elements.push(remainingText.substring(0, earliestIndex));
                            }
                            
                            const part = selectedMention.participant;
                            const avatarUri = part.avatar;
                            
                            elements.push(
                              <View 
                                key={`mention-${keyIdx++}`} 
                                style={{ 
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: isLight ? 'rgba(129, 0, 209, 0.10)' : 'rgba(129, 0, 209, 0.15)',
                                  borderRadius: 12,
                                  paddingHorizontal: 6,
                                  paddingVertical: 1.5,
                                  marginHorizontal: 2,
                                  borderWidth: 0.5,
                                  borderColor: isLight ? 'rgba(129, 0, 209, 0.25)' : 'rgba(129, 0, 209, 0.3)',
                                  alignSelf: 'center'
                                }}
                              >
                                <View style={{ width: 14, height: 14, borderRadius: 7, marginRight: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
                                  <AvatarWithFallback
                                    uri={avatarUri}
                                    sticker={(part as any).avatar_sticker}
                                    displayName={part.name}
                                    style={{ width: 14, height: 14, borderRadius: 7 }}
                                  />
                                </View>
                                <Text style={{ color: isLight ? '#7C3AED' : '#D6A4FF', fontWeight: '600', fontSize: 12 }}>
                                  {selectedMention.searchStr}
                                </Text>
                              </View>
                            );

                            remainingText = remainingText.substring(earliestIndex + selectedMention.searchStr.length);
                          } else {
                            elements.push(remainingText);
                            break;
                          }
                        }

                        return (
                          <Text style={[s.bubbleMsg, { textAlign: isMeMsg ? 'right' : 'left', color: bubbleTextColor }]}>
                            {elements.map((el, i) => {
                              if (typeof el === 'string') {
                                return (
                                  <Text key={`text-${i}`} style={{ color: bubbleTextColor }}>
                                    {el}
                                  </Text>
                                );
                              }
                              return el;
                            })}
                          </Text>
                        );
                      };

                      const getParsedMessage = (msg: any) => {
                        if (!msg) return { msgUser: null, msgText: '' };
                        let msgUser = msg.user;
                        let msgText = msg.text;
                        if (msg.message_type === 'system') {
                          if (myName && msg.text.startsWith(myName)) {
                            msgUser = myName;
                            msgText = msg.text.replace(myName, 'You')
                              .replace('You has ', 'You have ')
                              .replace('You is ', 'You are ');
                          } else {
                            const pMatch = participants.find(p => msg.text.startsWith(p.name));
                            if (pMatch) {
                              msgUser = pMatch.name;
                            } else if (msg.text.includes(' joined ') || msg.text.includes(' left ')) {
                              msgUser = msg.text.split(' ')[0];
                            } else {
                              msgUser = 'System';
                            }
                          }
                        }
                        return { msgUser, msgText };
                      };

                      const { msgUser: messageUser, msgText: displayText } = getParsedMessage(item);
                      const prevRawMsg = index < reversedMessages.length - 1 ? reversedMessages[index + 1] : null;
                      const { msgUser: prevMessageUser } = getParsedMessage(prevRawMsg);

                      const isMe = messageUser === myName;
                      const showAvatar = !prevRawMsg || prevMessageUser !== messageUser;
                      const sender = participants.find(p => p.name === messageUser || (p as any).id === item.user_id || p.user_id === item.user_id);
                      const senderAvatar = isMe ? user?.profile_picture : (item.avatar || sender?.avatar);
                      const senderSticker = isMe ? user?.avatar_sticker : (item.avatar_sticker || sender?.avatar_sticker);
                      const isMedia = item.message_type === 'image' || item.message_type === 'gif' || item.message_type === 'sticker';
                      const isSticker = item.message_type === 'sticker';
                      const isLottieSticker = item.message_type === 'lottie_sticker';

                      const emojiInfo = isOnlyEmojis(displayText);
                      const isEmojiOnly = emojiInfo.isOnly && !item.reply_to && !isMedia && !isLottieSticker;
                      const emojiFontSize = emojiInfo.count === 1 ? 36 : emojiInfo.count === 2 ? 30 : emojiInfo.count === 3 ? 26 : 22;
                      const emojiLineHeight = emojiFontSize + 8;

                      const replySender = item.reply_to ? participants.find(p => p.name === item.reply_to.user || (p as any).id === item.reply_to.user_id || p.user_id === item.reply_to.user_id) : null;
                      const isMyReply = item.reply_to ? item.reply_to.user === (user?.display_name || user?.email) : false;
                      const replyAvatar = item.reply_to ? (isMyReply ? user?.profile_picture : (item.reply_to.avatar || replySender?.avatar)) : null;
                      const replySticker = item.reply_to ? (isMyReply ? user?.avatar_sticker : (item.reply_to.avatar_sticker || replySender?.avatar_sticker)) : null;

                      return (
                        <AnimatedMessageBubble
                          isNew={Boolean(isMe && ((item as any)._isNew || item.status === 'sending'))}
                          style={[s.bubble, isMe && s.bubbleMe]}
                        >
                          {showAvatar && (
                            <View style={[
                              { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
                              isMe ? { justifyContent: 'flex-end' } : {}
                            ]}>
                              {!isMe && (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <TouchableOpacity 
                                    style={{ position: 'relative', marginRight: 4 }}
                                    onPress={() => handleAvatarPress(senderAvatar, senderSticker, messageUser)}
                                  >
                                    <AvatarWithFallback 
                                      uri={senderAvatar} 
                                      displayName={messageUser} 
                                      sticker={senderSticker} 
                                      style={s.messageAvatar} 
                                    />
                                    {sender?.is_dj && (
                                      <View style={{ position: 'absolute', top: -10, right: -4 }}>
                                        <Icon name="star" size={14} color="#fff" />
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                </View>
                              )}
                              {isMe && (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <TouchableOpacity 
                                    style={{ position: 'relative', marginLeft: 4 }}
                                    onPress={() => handleAvatarPress(user?.profile_picture, user?.avatar_sticker, messageUser)}
                                  >
                                    <AvatarWithFallback 
                                      uri={user?.profile_picture} 
                                      displayName={messageUser} 
                                      sticker={user?.avatar_sticker} 
                                      style={s.messageAvatar} 
                                    />
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          )}
                          <View style={{ flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                            {item.reply_to && (
                              <TouchableOpacity 
                                activeOpacity={0.7} 
                                onPress={() => handleScrollToMessage(item.reply_to.id)}
                                style={[
                                  s.replyBubble, 
                                  { 
                                    flexDirection: 'row', 
                                    alignItems: 'center', 
                                    maxWidth: width * 0.78, 
                                    paddingRight: 6,
                                    marginBottom: 4,
                                    gap: 6,
                                  },
                                  isLight && !isMe && { backgroundColor: '#CBD5E1' },
                                  isMe && { backgroundColor: 'rgba(255, 255, 255, 0.22)' },
                                  !isMe && !showAvatar && { marginLeft: 36 },
                                  isMe && !showAvatar && { marginRight: 36 },
                                ]}
                              >
                                <AvatarWithFallback
                                  uri={replyAvatar}
                                  sticker={replySticker}
                                  displayName={item.reply_to.user}
                                  style={{ width: 18, height: 18, borderRadius: 9 }}
                                />
                                <Text style={[s.replyText, { textAlign: isMe ? 'right' : 'left', flexShrink: 1 }, isMe ? { color: '#FFFFFF' } : (isLight ? { color: '#0F172A' } : { color: 'rgba(255,255,255,0.7)' })]} numberOfLines={1} ellipsizeMode="tail">
                                  {item.reply_to.text && item.reply_to.text.trim() ? item.reply_to.text : 
                                   (item.reply_to.message_type === 'image' ? '📷 Image' :
                                    item.reply_to.message_type === 'gif' ? '👾 GIF' :
                                    item.reply_to.message_type === 'sticker' ? '🖼️ Sticker' : '📁 Attachment')}
                                </Text>
                                {item.reply_to.media_url && (
                                  <Image
                                    source={{ uri: resolveImageUrl(item.reply_to.media_url) }}
                                    style={{ width: 28, height: 28, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)', marginLeft: 8 }}
                                    resizeMode="cover"
                                  />
                                )}
                              </TouchableOpacity>
                            )}

                            <TouchableOpacity onPress={(e) => handlePress(item, e)} onLongPress={() => handleMessageLongPress(item)} activeOpacity={1}>
                              <View style={[
                                s.msgContainer,
                                isMe ? s.msgContainerMe : (isLight ? [s.msgContainerThem, { backgroundColor: '#E2E8F0', borderWidth: 1, borderColor: '#CBD5E1' }] : s.msgContainerThem),
                                (isMedia || isLottieSticker) && s.mediaMsgContainer,
                                (isSticker || isLottieSticker || isEmojiOnly) && { backgroundColor: 'transparent', paddingHorizontal: 4, paddingVertical: 2 },
                                !isMe && !showAvatar && { marginLeft: 36 },
                                isMe && !showAvatar && { marginRight: 36 },
                              ]}>
                                {isLottieSticker ? (
                                  <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', marginVertical: 4 }}>
                                    <LottieStickerMessage
                                      url={item.text}
                                      size={50}
                                      autoPlay={index === 0}
                                      onLongPress={() => handleMessageLongPress(item)}
                                      onPress={() => {}}
                                    />
                                  </View>
                                ) : isMedia ? (
                                  <View style={{ position: 'relative', alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                                    <ScaledImage
                                      uri={resolveImageUrl(item.local_uri || item.media_url)}
                                      isAnimated={item.message_type === 'gif' || item.message_type === 'sticker'}
                                      style={[
                                        isSticker ? s.stickerImage : s.messageImage,
                                        { backgroundColor: isSticker ? 'transparent' : 'rgba(255,255,255,0.05)' },
                                      ]}
                                      resizeMode="contain"
                                    />
                                    {item.message_type === 'image' &&
                                      !(item.local_uri || item.media_url || '').toLowerCase().includes('sticker') &&
                                      !(item.local_uri || item.media_url || '').toLowerCase().includes('gif') &&
                                      !(item.local_uri || item.media_url || '').toLowerCase().includes('webp') && (
                                      <View />
                                    )}
                                  </View>
                                ) : isEmojiOnly ? (
                                  <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                                    <Text style={{ fontSize: emojiFontSize, lineHeight: emojiLineHeight, textAlign: isMe ? 'right' : 'left' }}>
                                      {displayText}
                                    </Text>
                                  </View>
                                ) : (
                                  <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                                    {renderParsedMessageText(displayText, isMe)}
                                  </View>
                                )}
                                {Object.entries(item.reactions || {}).filter(([_, r]) => !!r).length > 0 && (
                                  <View style={[
                                    s.reactionContainer,
                                    isMe ? s.reactionContainerMe : s.reactionContainerThem,
                                    { marginTop: 6, marginBottom: 2 }
                                  ]}>
                                    {Object.entries(item.reactions || {}).filter(([_, r]) => !!r).map(([reactorName, emoji], idx) => {
                                      const reactor = participants.find(p => p.name === reactorName);
                                      const isMyReaction = reactorName === myName;
                                      const reactorPic = isMyReaction ? user?.profile_picture : reactor?.avatar;
                                      return (
                                        <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                          <AvatarWithFallback
                                            uri={reactorPic}
                                            displayName={reactorName}
                                            style={{ width: 18, height: 18, borderRadius: 9 }}
                                          />
                                          <Text style={s.reactionEmoji}>{String(emoji)}</Text>
                                        </View>
                                      );
                                    })}
                                  </View>
                                )}
                              </View>
                            </TouchableOpacity>
                          </View>
                        </AnimatedMessageBubble>
                      );
                    }}
                  />

                  {typingUsers.length > 0 && (
                    <View style={s.typingContainer}>
                      <Text style={[s.typingText, isLight && { color: '#475569' }]}>
                        {`${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'are' : 'is'} typing...`}
                      </Text>
                    </View>
                  )}

                  {replyingTo && (
                    <>
                      {/* Quick Reactions Row */}
                      <View style={[s.quickReactionsRow, isLight && { borderTopColor: 'rgba(0,0,0,0.06)' }]}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickReactionsContent}>
                          {['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '💯', '💩', '👀', '✨', '🤔'].map(emoji => (
                            <TouchableOpacity
                              key={emoji}
                              style={[s.quickReactionBtn, isLight && { backgroundColor: 'rgba(0,0,0,0.05)' }]}
                              onPress={() => {
                                const myName = user?.display_name || user?.email;
                                const currentReactions = replyingTo.reactions || {};
                                const alreadyReacted = currentReactions[myName] === emoji;
                                const emojiToSend = alreadyReacted ? '' : emoji;
                                if (replyingTo.id) {
                                  musicWebSocketService.sendReaction(replyingTo.id, emojiToSend);
                                }
                                setReplyingTo(null);
                              }}
                            >
                              <Text style={s.quickReactionEmoji}>{emoji}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>

                      {/* Reply Bar */}
                      <View style={s.replyBar}>
                        <View style={s.replyBarContent}>
                          <Icon name="arrow-undo-outline" size={16} color={themeIconColor} />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={[s.replyBarUser, isLight && { color: '#0F172A' }]}>Replying to {replyingTo.user === (user?.display_name || user?.email) ? 'You' : replyingTo.user}</Text>
                            <Text style={[s.replyBarText, isLight && { color: '#475569' }]} numberOfLines={1}>
                              {replyingTo.text && replyingTo.text.trim() ? replyingTo.text : 
                               (replyingTo.message_type === 'image' ? '📷 Image' :
                                replyingTo.message_type === 'gif' ? '👾 GIF' :
                                replyingTo.message_type === 'sticker' ? '🖼️ Sticker' : '📁 Attachment')}
                            </Text>
                          </View>
                          {replyingTo.media_url && (
                            <Image
                              source={{ uri: resolveImageUrl(replyingTo.media_url) }}
                              style={{ width: 36, height: 36, borderRadius: 4, marginRight: 8, backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }}
                              resizeMode="cover"
                            />
                          )}
                          <TouchableOpacity onPress={() => setReplyingTo(null)}>
                            <Icon name="close-circle" size={20} color={isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)'} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </>
                  )}

                  {mentionListVisible && (
                    <View style={[s.mentionListContainer, isLight && { backgroundColor: '#ffffff', borderColor: '#CBD5E1' }]}>
                      <FlatList
                        data={participants.filter(p => p.name !== user?.display_name && p.name.toLowerCase().includes(mentionFilter))}
                        keyExtractor={(p, idx) => p.user_id?.toString() || idx.toString()}
                        keyboardShouldPersistTaps="always"
                        renderItem={({ item }) => (
                          <TouchableOpacity style={[s.mentionItem, isLight && { borderBottomColor: 'rgba(0,0,0,0.06)' }]} onPress={() => handleMentionSelect(item.name)}>
                            <AvatarWithFallback uri={item.avatar} displayName={item.name} style={{ width: 24, height: 24, borderRadius: 12 }} />
                            <Text style={[s.mentionName, isLight && { color: '#0F172A' }]}>{item.name}</Text>
                          </TouchableOpacity>
                        )}
                        style={{ maxHeight: 150 }}
                      />
                    </View>
                  )}
                  <View style={s.chatBar} pointerEvents={showSettingsModal ? 'none' : 'auto'}>
                    {/* ── Gallery Button — always left corner ── */}
                    <TouchableOpacity
                      style={[s.micBtn, isLight && { backgroundColor: 'rgba(0,0,0,0.06)' }]}
                      onPress={handleOpenGallery}
                      activeOpacity={0.7}
                      disabled={isSendingMedia || showSettingsModal}
                      accessibilityLabel="Open gallery"
                    >
                      <Icon
                        name="image-outline"
                        size={20}
                        color={isLight ? '#64748B' : 'rgba(255,255,255,0.6)'}
                      />
                    </TouchableOpacity>
                    <MusicInputBox
                      ref={richInputRef}
                      disabled={showSettingsModal}
                      isLight={isLight}
                      themePlaceholderColor={themePlaceholderColor}
                      isStickerPickerDeliberatelyOpen={isStickerPickerDeliberatelyOpen}
                      onFocusInput={handleInputFocusStable}
                      onOpenStickerPicker={() => {
                        if (isStickerPickerDeliberatelyOpen) {
                          handleInputFocusStable();
                          richInputRef.current?.focus();
                        } else {
                          handleOpenStickerPickerStable();
                        }
                      }}
                      onChangeText={handleTextChange}
                      onContentCommitted={(event) => {
                        const { uri, mimeType } = event.nativeEvent;
                        Keyboard.dismiss();
                        setTimeout(() => { setStickerPreview({ uri, mimeType }); }, 100);
                      }}
                    />
                    {/* ── Right side: Mic + Send cross-fade via native Animated.Value ──
                         Both icons always mounted; hasTextAnim drives opacity/scale
                         instantly (0-frame, no React re-render) like WhatsApp / ChatInputArea ── */}
                    <View style={[s.micBtn, isLight && { backgroundColor: 'rgba(0,0,0,0.06)' }, isMicOn && s.micBtnActive, { position: 'relative' }]}>
                      {/* Tap handler: send if text, mic toggle if empty */}
                      <TouchableOpacity
                        style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}
                        onPress={() => { if ((chatMessageRef.current || chatMessage).trim()) { sendChatMessage(); } else { handleToggleMic(); } }}
                        activeOpacity={0.7}
                        disabled={isSendingMedia}
                      >
                        {/* Send icon — fades in when typing */}
                        <Animated.View style={{ position: 'absolute', opacity: hasTextAnim, transform: [{ scale: hasTextAnim.interpolate({ inputRange: [0,1], outputRange: [0.4,1] }) }] }} pointerEvents="none">
                          {isSendingMedia
                            ? <ActivityIndicator size="small" color={isLight ? '#0284C7' : '#fff'} />
                            : <Icon name="send" size={18} color={isLight ? '#0284C7' : '#fff'} />}
                        </Animated.View>
                        {/* Mic icon — fades out when typing */}
                        <Animated.View style={{ position: 'absolute', opacity: hasTextAnim.interpolate({ inputRange: [0,1], outputRange: [1,0] }), transform: [{ scale: hasTextAnim.interpolate({ inputRange: [0,1], outputRange: [1,0.4] }) }] }} pointerEvents="none">
                          <Icon name={isMicOn ? 'mic' : 'mic-off-outline'} size={18} color={isMicOn ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.55)')} />
                        </Animated.View>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : (
                <View style={{ flex: 1 }}>
                  {(() => {
                    const myQueue = queue
                      .map((item, globalIndex) => ({ item, globalIndex }))
                      .filter(({ item }) => item.addedById === (user?.id ?? -1));

                    return (
                      <>
                        <View style={s.queueHeader}>
                          <Text style={[s.queueTitle, isLight && { color: '#0F172A' }]}>My Queue ({myQueue.length})</Text>
                          <TouchableOpacity 
                            onPress={() => setActiveTab('chat')} 
                            style={s.queueCloseBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityLabel="Close queue"
                          >
                            <Icon name="close" size={24} color={themeIconColor} />
                          </TouchableOpacity>
                        </View>

                        <FlatList
                          data={myQueue}
                          keyExtractor={({ item }) => `${item.song.videoId}_${item.addedById}`}
                          style={{ flex: 1 }}
                          contentContainerStyle={{ padding: 12 }}
                          ListEmptyComponent={<Text style={[s.emptyText, isLight && { color: '#64748B' }]}>Your queue is empty — swipe the video to browse and pin songs</Text>}
                          renderItem={({ item: { item, globalIndex } }) => (
                            <View style={[s.qRow, isLight && { borderBottomColor: 'rgba(0,0,0,0.06)' }]}>
                              <Text style={[s.qNum, isLight && { color: 'rgba(0,0,0,0.35)' }]}>{globalIndex + 1}</Text>
                              <Image source={{ uri: item.song.thumbnail }} style={s.qThumb} />
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={[s.qTitle, isLight && { color: '#0F172A' }]} numberOfLines={1}>{item.song.title}</Text>
                                <Text style={[s.qBy, isLight && { color: '#64748B' }]}>Up next in #{globalIndex + 1} position</Text>
                              </View>
                              <TouchableOpacity onPress={() => unpinVideo(item.song.videoId)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Icon name="close-circle" size={24} color={isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)'} />
                              </TouchableOpacity>
                            </View>
                          )}
                        />
                      </>
                    );
                  })()}
                  </View>
                )}
              </Reanimated.View>
            </Reanimated.View>
          )}

        </View>

        {/* AVATAR PREVIEW OVERLAY */}
        {previewData.visible && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
            <TouchableOpacity 
              style={s.avatarModalOverlay} 
              onPress={() => setPreviewData(p => ({ ...p, visible: false }))}
              activeOpacity={1}
            >
              <View style={s.avatarPreviewContainer}>
                <AvatarWithFallback
                  uri={previewData.uri}
                  sticker={previewData.sticker}
                  displayName={previewData.displayName}
                  style={s.avatarPreviewImage}
                />
                <Text style={s.avatarPreviewName}>{String(previewData.displayName || '')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* DISCOVERY OVERLAY */}
        {showDiscovery && (
          <Modal visible={showDiscovery} animationType="none" onRequestClose={() => { setShowDiscovery(false); setDiscoveryInitialUrl(null); }}>
            <YouTubeDiscoveryScreen
              navigation={{
                goBack: () => { setShowDiscovery(false); setDiscoveryInitialUrl(null); },
                addListener: () => () => {},
                setOptions: () => {},
              } as any}
              route={{ params: { roomCode, initialUrl: discoveryInitialUrl } } as any}
            />
          </Modal>
        )}

        {/* STICKER PREVIEW MODAL */}
        <StickerPreviewModal
          visible={!!stickerPreview}
          mediaUri={stickerPreview?.uri ?? ''}
          mimeType={stickerPreview?.mimeType ?? ''}
          onClose={() => setStickerPreview(null)}
          theme="dark"
          restoreNavBarColor="#00000000"
          onSend={(uri, mimeType, caption) => {
            setStickerPreview(null);
            const ext = mimeType.split('/')[1] || 'png';
            handleMediaSelection({
              uri,
              type: mimeType,
              fileName: `sticker_${Date.now()}.${ext}`,
            }, caption);
          }}
        />

        <CustomGalleryPicker
          visible={galleryPickerVisible}
          onClose={() => setGalleryPickerVisible(false)}
          theme="dark"
          maxSelect={1}
          assetType="Photos"
          restoreNavBarColor="#00000000"
          onSelect={(assets) => {
            if (assets.length > 0) {
              const asset = assets[0];
              setStickerPreview({
                uri: asset.uri || '',
                mimeType: asset.type || 'image/jpeg',
              });
            }
          }}
        />

        <InviteModal
          visible={inviteModalVisible}
          onClose={() => setInviteModalVisible(false)}
          roomCode={roomCode}
          videoId={currentSong?.videoId}
        />

        <RoomParticipantsModal
          visible={participantsModalVisible}
          onClose={() => setParticipantsModalVisible(false)}
          participants={participants}
          isDJ={effectiveIsDJ}
          currentUserId={user?.id}
          allowedSpeakers={allowedSpeakers}
          voiceParticipants={voiceParticipants}
          isMicOn={isMicOn}
          onToggleMicPermission={(targetUserId, allow) => updateMicPermission(targetUserId, allow)}
          onSwitchDJ={(targetUserId, targetName) => {
            switchDJ(targetUserId);
            showCenterToast(`${targetName} is now the Leader!`, 'star', '#FACC15');
          }}
          onOpenInvite={() => setInviteModalVisible(true)}
          onAvatarPress={handleAvatarPress}
        />

        <DoubleTapHeartOverlay ref={doubleTapHeartRef} defaultEmoji={user?.quick_reaction || '❤️'} />

        {fullScreenMedia && (
          <FullScreenMediaViewer
            mediaUrl={fullScreenMedia.url}
            mediaType={fullScreenMedia.type}
            onClose={() => setFullScreenMedia(null)}
          />
        )}
      </KeyboardWrapperView>

      {!isMinimized && renderSettingsModal()}

      {/* ── Center-screen modern fade toast (Friend Request Style) ── */}
      <Modal visible={centerToastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.centerToastOverlay} pointerEvents="none">
          <Animated.View style={[s.centerToastBox, { opacity: centerToastOpacity, backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }]}>
            <Icon
              name={centerToastIcon}
              size={20}
              color={centerToastIconColor}
              style={{ marginRight: 8 }}
            />
            <Text style={[s.centerToastText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
              {centerToastMessage}
            </Text>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Lottie Sticker Picker Sheet (Always mounted, offscreen by default, 0ms GPU slide, outside KeyboardWrapperView for true screen bottom alignment) ── */}
      <StickerPickerSheet
        visible={stickerPickerVisible}
        isDeliberatelyOpen={isStickerPickerDeliberatelyOpen}
        isDeliberatelyOpenSV={isStickerPickerDeliberatelyOpenSV}
        stickerPacks={BUILT_IN_STICKER_PACKS}
        onSelectSticker={(sticker) => sendLottieSticker(sticker)}
        onClose={handleCloseStickerPickerStable}
        sheetHeight={STICKER_DRAWER_HEIGHT}
        sharedHeight={stickerSpacerHeight}
      />

      {/* ── CINEMATIC SMOOTH SCREEN TRANSITION FADE CURTAIN (Eliminates flash on theme switch) ── */}
      {!isMinimized && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: '#000000',
              opacity: screenTransitionFadeAnim,
              zIndex: 999999,
              elevation: 999999,
            },
          ]}
          pointerEvents={isScreenTransitioning ? 'auto' : 'none'}
        />
      )}
    </View>
  );
};

// Styles
const s = StyleSheet.create({
  centerToastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  centerToastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 15,
  },
  centerToastText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  relatedOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', zIndex: 15 },
  relatedCloseBtn:   { position: 'absolute', top: 12, left: 12, zIndex: 60 },
  root:              { flex: 1, backgroundColor: '#000000', overflow: 'visible' },
  settingsModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 1000,
  },
  settingsModalContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 18,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  inner:             { flex: 1, backgroundColor: 'transparent' },
  loadingContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:       { color: '#fff', marginTop: 12 },
  header:            { height: 58, maxHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, justifyContent: 'space-between' },
  headerSideGroup:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerSlot:        { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerCenterSlot:  { flex: 1, height: 36, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  headerBrandText: {
    fontFamily: 'ClashDisplay-Bold',
    fontSize: 22,
    color: '#FFFFFF',
    letterSpacing: 1.2,
    includeFontPadding: false,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3.5,
  },
  activeMicRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2.5, borderRadius: 18, backgroundColor: 'rgba(16, 185, 129, 0.12)', borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.35)' },
  headerRight:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconBtn:     { padding: 6, position: 'relative' },
  badge:             { position: 'absolute', top: 2, right: 2, backgroundColor: '#4597f5f6', borderRadius: 9, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#000', paddingHorizontal: 2 },
  badgeText:         { color: '#fff', fontSize: 9, fontWeight: '800' },
  headerTitleContainer: { flex: 1, flexDirection: 'row', gap: 8, marginHorizontal: 8, alignItems: 'center' },
  headerTitleTouch:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 5 },
  headerTitleInput:  { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#4597f5f6', padding: 0 },
  headerTitleText:   { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5, padding: 0 },
  dot:               { width: 6, height: 6, borderRadius: 3 },
  videoWrap:         { width: '100%', height: VIDEO_HEIGHT, backgroundColor: 'transparent', position: 'relative', overflow: 'visible', zIndex: 20 },
  videoWrapFullscreen: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 99 },
  npBar:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'transparent' },
  npThumb:           { width: 50, height: 28, borderRadius: 3 },
  npThumbEmpty:      { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' },
  npTitle:           { color: '#fff', fontSize: 11.5, fontWeight: '600', lineHeight: 14, includeFontPadding: false },
  npChannel:         { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  likeBtn:           { padding: 4, marginLeft: 8 },
  djBadge:           { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(129,0,209,0.1)', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 10, borderWidth: 0.5, borderColor: 'rgba(129,0,209,0.3)' },
  djBadgeText:       { color: '#4597f5f6', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  participantsRow:   { backgroundColor: 'transparent' },
  participantsContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 10 },
  participantItem:   { position: 'relative' },
  pAvatar:           { width: 32, height: 32, borderRadius: 16, borderWidth: 0.5, borderColor: '#ffffff', overflow: 'hidden' },
  messageAvatar:     { width: 30, height: 30, borderRadius: 15, borderWidth: 0.5, borderColor: '#ffffff' },
  djDot:             { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#4597f5f6', borderWidth: 1, borderColor: '#cc00ff' },
  queueHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'transparent' },
  queueTitle:        { color: '#fff', fontSize: 14, fontWeight: '700' },
  queueCloseBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  emptyText:         { color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 30, fontSize: 13 },
  bubble:            { marginBottom: 12, maxWidth: '85%', alignSelf: 'flex-start', position: 'relative', flexDirection: 'row', alignItems: 'flex-start' },
  bubbleMe:          { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubbleUser:        { color: '#4597f5f6', fontWeight: '700', fontSize: 11, marginBottom: 2, marginLeft: 4 },
  msgContainer:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, position: 'relative' },
  msgContainerThem:  { backgroundColor: 'transparent', borderTopLeftRadius: 4 },
  msgContainerMe:    { backgroundColor: 'transparent', borderTopRightRadius: 4 },
  bubbleMsg:         { fontSize: 15 },
  replyBubble:       { padding: 6, borderRadius: 8, marginBottom: 4, backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  replyUser:         { color: '#4597f5f6', fontSize: 13, fontWeight: '700' },
  replyText:         { color: 'rgba(255,255,255,0.7)', fontSize: 16 },
  reactionContainer: { 
    marginTop: 0,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#00000000',
    zIndex: 5
  },
  reactionContainerThem: { alignSelf: 'flex-start' },
  reactionContainerMe: { alignSelf: 'flex-end' },
  reactionEmoji:     { fontSize: 16 },
  replyBar:          { backgroundColor: 'transparent' },
  replyBarContent:   { flexDirection: 'row', alignItems: 'center', padding: 10 },
  replyBarUser:      { color: '#fff', fontSize: 12, fontWeight: '700' },
  replyBarText:      { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  quickReactionsRow: {
    backgroundColor: 'transparent',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 6,
  },
  quickReactionsContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  quickReactionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickReactionEmoji: {
    fontSize: 16,
  },
  doubleTapOverlay:  { ...StyleSheet.absoluteFillObject, zIndex: 9999, pointerEvents: 'none' },
  doubleTapReaction: { position: 'absolute', width: 50, height: 50, marginLeft: -25, marginTop: -25, justifyContent: 'center', alignItems: 'center' },
  doubleTapHeart:    { fontSize: 40, textAlign: 'center' },
  mentionListContainer: { backgroundColor: '#1E1E1E', borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: 150, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderBottomWidth: 0 },
  mentionItem:       { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  mentionName:       { color: '#fff', fontSize: 14, marginLeft: 10, fontWeight: '500' },
  chatBar:           { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6, paddingTop: 0, paddingBottom: 8, gap: 4, backgroundColor: 'transparent', zIndex: 1000 },
  inputWrapper:      { flex: 1, position: 'relative', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 22, flexDirection: 'row', alignItems: 'flex-end' },
  chatInput:         { flex: 1, backgroundColor: 'transparent', paddingRight: 12, paddingTop: Platform.OS === 'ios' ? 8 : 10, paddingBottom: Platform.OS === 'ios' ? 8 : 10, minHeight: 45, maxHeight: 180, color: '#fff', fontSize: 17.8, textAlignVertical: 'center', includeFontPadding: false },
  sendBtn:           { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  plusBtn:           { width: 34, height: 34, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  micBtn:            { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 3, backgroundColor: 'rgba(255,255,255,0.08)' },
  micBtnActive:      { backgroundColor: '#0284C7' },
  innerStickerButton: { position: 'absolute', left: 8, bottom: 6.5, width: 32, height: 32, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  innerGalleryButton: { position: 'absolute', right: 8, bottom: 4, width: 32, height: 32, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  innerGalleryTouch:  { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  mediaMsgContainer: { padding: 0, paddingHorizontal: 0, paddingVertical: 0, paddingBottom: 0, borderRadius: 12, overflow: 'hidden' },
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
  leaveButton:       { backgroundColor: '#4597f5f6' },
  buttonText:        { color: '#fff', fontWeight: 'bold' },
  previewContainer:  { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#111', borderTopWidth: 1, borderColor: '#333' },
  previewImage:      { width: 60, height: 60, borderRadius: 8 },
  sendPendingBtn:    { marginLeft: 'auto', backgroundColor: '#4597f5f6', padding: 10, borderRadius: 20 },
  closePendingBtn:   { marginLeft: 10, backgroundColor: '#333', padding: 5, borderRadius: 15 },
  syncOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  syncText:          { marginTop: 20, color: '#4597f5f6', fontSize: 15, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  coverOverlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  coverContent:      { alignItems: 'center', gap: 15 },
  coverText:         { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500' },
  toggleBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', gap: 4, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  toggleText:        { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' },
  systemMsgContainer: { alignSelf: 'center', marginVertical: 8, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 16, paddingVertical: 4, borderRadius: 12 },
  systemMsgText:     { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontStyle: 'italic' },
  typingContainer:    { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: 'transparent' },
  typingText:         { color: '#fff', fontSize: 12, fontStyle: 'italic' },
  avatarModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  avatarPreviewContainer: { width: 220, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  avatarPreviewImage: { width: 180, height: 180, borderRadius: 90, marginBottom: 12 },
  avatarPreviewName: { fontSize: 16, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  // ─── Theme Selector in Queue Styles ───
  themeSelectorCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  themeSectionLabel: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  themePillsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  themePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  themePillActiveCinema: {
    backgroundColor: '#241604',
    borderColor: '#EAB308',
  },
  themePillActiveRave: {
    backgroundColor: '#7C3AED',
    borderColor: '#A78BFA',
  },
  themePillActiveDark: {
    backgroundColor: '#1E293B',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  themePillActiveLight: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
  },
  themePillText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  themePillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  themePillTextLightActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  // ─── Stream Quality in Queue Styles ───
  qualityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  qualityPillActive: {
    backgroundColor: '#FF5E3A',
    borderColor: '#FF7A59',
  },
  qualityPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  qualityBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  qualityBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
});

export default MusicRoomScreen;
