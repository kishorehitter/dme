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
  View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback,
  FlatList, Image, ActivityIndicator,
  StatusBar, TextInput,
  Dimensions, Keyboard, Platform, ScrollView,
  KeyboardAvoidingView, Modal, BackHandler,
  Animated, PanResponder, DeviceEventEmitter, AppState, Vibration,
  LayoutChangeEvent, NativeModules, LayoutAnimation, Easing as RNEasing,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import AmbientDiscoBackground, { RoomTheme } from '../components/AmbientDiscoBackground';
import BackgroundAmbientPlayer from '../components/BackgroundAmbientPlayer';
import DrivePlayer from '../components/DrivePlayer';
import DirectVideoPlayer from '../components/DirectVideoPlayer';
import YoutubePlayer from '../components/YoutubePlayer';
import TrackPlayerService, { extractStreamUrlClientSide, extractVideoStreamUrlClientSide, heightToQualityKey, getEffectiveResolutionHeight } from '../services/TrackPlayerService';
import TrackPlayer, { Event, PlaybackState } from '@rntp/player';
import { startMusicService, updateMusicService, stopMusicService } from '../services/MusicServiceBridge';
import Icon from 'react-native-vector-icons/Ionicons';
import { useMusicRoom, Song, QueueItem } from '../hooks/useMusicRoom';
import YouTubeDiscoveryScreen from './YouTubeDiscoveryScreen';
import { useAuth } from '../context/AuthContext';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCall } from '../context/CallContext';
import api, { musicAPI } from '../services/api';
import InviteModal from '../components/InviteModal';
import AvatarWithFallback from '../components/AvatarWithFallback';
import RelatedVideosGrid from '../components/RelatedVideosGrid';
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
import StickerPickerSheet from '../components/StickerPickerSheet';
import DoubleTapHeartOverlay, { DoubleTapHeartOverlayRef } from '../components/DoubleTapHeartOverlay';
import LottieStickerMessage from '../components/LottieStickerMessage';
import { BUILT_IN_STICKER_PACKS, Sticker } from '../stickers/stickerPacks';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useMusicVoiceChat } from '../hooks/useMusicVoiceChat';


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

const fetchChannelLogo = async (videoId: string): Promise<string | null> => {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await res.text();
    const ownerMatch = html.match(/"videoOwnerRenderer"\s*:\s*\{[^}]*?"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https:\/\/[^"]+)"/);
    if (ownerMatch && ownerMatch[1]) {
      return ownerMatch[1].replace(/\\u0026/g, '&');
    }
    const avatarMatch = html.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https:\/\/[^"]+)"/);
    if (avatarMatch && avatarMatch[1]) {
      return avatarMatch[1].replace(/\\u0026/g, '&');
    }
    const matches = html.match(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[a-zA-Z0-9_\-=/]+/g);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  } catch (e) {
    console.warn('🎵 Channel logo fetch failed:', e);
  }
  return null;
};

const fetchVideoAspectRatio = async (videoId: string): Promise<number | null> => {
  // 1. Check YouTube video stream formats (provides exact pixel aspect ratio e.g. 1.437 for Pavazha Malli)
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
          const ar = top.width / top.height;
          if (ar >= 0.4 && ar <= 3.5) {
            console.log(`📐 [EXACT FORMAT AR] Video ${videoId} format ${top.width}x${top.height} -> Aspect Ratio: ${ar.toFixed(3)}`);
            return ar;
          }
        }
      }
    }
  } catch (e) {}

  // 2. YouTube official oEmbed API fallback
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.width && data.height) {
        const ar = data.width / data.height;
        if (ar >= 0.4 && ar <= 3.5) {
          console.log(`📐 [AUTO AR] Video ${videoId} oEmbed dimensions: ${data.width}x${data.height} -> Aspect Ratio: ${ar.toFixed(3)}`);
          return ar;
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
    thumbnail:    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    channelTitle: 'YouTube',
    addedBy:      fallbackName ?? 'Someone',
  };

  let resolvedTitle = base.title;
  let resolvedChannel = base.channelTitle;
  let resolvedThumb = base.thumbnail;
  let resolvedLogo: string | undefined = undefined;

  // 1. YouTube official oEmbed API — ultra-fast (50ms), guaranteed accurate title & channel name
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.title) resolvedTitle = data.title;
      if (data.author_name) resolvedChannel = data.author_name;
      if (data.thumbnail_url) resolvedThumb = data.thumbnail_url;
    }
  } catch (e) {
    console.warn('🎵 oEmbed metadata fetch failed:', e);
  }

  // 2. Fetch Channel Logo from watch page HTML
  try {
    const channelLogo = await fetchChannelLogo(videoId);
    if (channelLogo) resolvedLogo = channelLogo;
  } catch (e) {
    console.warn('🎵 Channel logo fetch error:', e);
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

  return {
    ...base,
    title:        resolvedTitle,
    channelTitle: resolvedChannel,
    thumbnail:    resolvedThumb,
    channelLogo:  resolvedLogo,
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
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  onShowRelated: () => void;
  onSettings?: () => void;
  onSingleTap?: () => void;
  onKeepControlsAlive?: () => void;
  isFullscreen: boolean;
  isDrivePlayer?: boolean;
  title?: string;
}

const VideoControls: React.FC<ControlsProps> = ({
  visible, isPlaying, isEnded, canControl, isBuffering,
  position, duration,
  onPlayPause, onSeek, onNext, onToggleFullscreen, onShowRelated, onSettings,
  onSingleTap, onKeepControlsAlive,
  isFullscreen,
  isDrivePlayer,
  title,
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

  const triggerSeekBackward = () => {
    if (isEnded) return;
    if (!canControlRef.current) {
      console.warn('📊 [SEEK DENIED] User is not DJ, cannot seek');
      return;
    }
    const cur = positionRef.current || 0;
    const target = Math.max(0, cur - 10);
    positionRef.current = target;
    onSeek(target);
    triggerBadgeAnim('left');
    onKeepControlsAlive?.();
  };

  const triggerSeekForward = () => {
    if (isEnded) return;
    if (!canControlRef.current) {
      console.warn('📊 [SEEK DENIED] User is not DJ, cannot seek');
      return;
    }
    const cur = positionRef.current || 0;
    const dur = durationRef.current || 0;
    const target = dur > 0 ? Math.min(dur, cur + 10) : cur + 10;
    positionRef.current = target;
    onSeek(target);
    triggerBadgeAnim('right');
    onKeepControlsAlive?.();
  };

  const handleLeftPress = () => {
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

  const opacity    = useRef(new Animated.Value(1)).current;
  const knobX      = useRef(new Animated.Value(0)).current;
  const knobOpacity = useRef(new Animated.Value(0)).current;
  const isSeeking  = useRef(false);
  const seekTarget = useRef(0);
  const barLayoutX = useRef(0);
  const barWidth   = useRef(width);
  const pct = duration > 0 ? Math.min(position / duration, 1) : 0;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue:         visible ? 1 : 0,
      duration:        200,
      useNativeDriver: true,
    }).start();
    Animated.timing(knobOpacity, {
      toValue:         visible ? 1 : 0,
      duration:        200,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (!isSeeking.current) {
      const rawX = pct * barWidth.current;
      const clampedX = Math.max(0, Math.min(barWidth.current, rawX));
      knobX.setValue(clampedX);
    }
  }, [pct]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      isSeeking.current = true;
      const rawX = Math.max(0, Math.min(barWidth.current, evt.nativeEvent.locationX));
      const clampedX = Math.max(0, Math.min(barWidth.current, rawX));
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
      const clampedX = Math.max(0, Math.min(barWidth.current, rawX));
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
              {!isDrivePlayer && onSettings && (
                <TouchableOpacity
                  style={cv.fullscreenIconBtn}
                  onPress={onSettings}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="settings-sharp" size={18} color="#fff" />
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
            <Animated.View style={[{ position: 'absolute', top: 2, left: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
              <TouchableOpacity style={cv.relatedBtn} onPress={onSettings} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="settings-sharp" size={18} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          )}
          <Animated.View style={[{ position: 'absolute', top: 2, right: 8 }, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
            <TouchableOpacity style={cv.expandBtn} onPress={onToggleFullscreen} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="expand" size={18} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </>
      )}

      {/* ── Center Controls Row: Double Tap Left (-10s), Play/Pause, Double Tap Right (+10s) ── */}
      <Animated.View
        style={[cv.centerRow, { opacity }]}
        pointerEvents={visible ? 'box-none' : 'none'}
      >
        {/* Left Side: Double tap to seek -10s */}
        <TouchableOpacity
          style={cv.sideSeekZone}
          activeOpacity={1}
          onPress={handleLeftPress}
          pointerEvents={visible ? 'auto' : 'none'}
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

        {/* Center: Play / Pause */}
        {!isBuffering && !isEnded ? (
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
        <TouchableOpacity
          style={cv.sideSeekZone}
          activeOpacity={1}
          onPress={handleRightPress}
          pointerEvents={visible ? 'auto' : 'none'}
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
        ]} pointerEvents={visible ? 'auto' : 'none'}>
          <View style={[cv.timeRow, { paddingHorizontal: 0, marginBottom: 12 }]}>
            <Text style={cv.timeText}>{fmtTime(position)} / {fmtTime(duration)}</Text>
          </View>
          <View
            {...pan.panHandlers}
            style={{ height: 28, justifyContent: 'center', paddingHorizontal: 0 }}
            onLayout={(event) => {
              const { x, width: w } = event.nativeEvent.layout;
              barLayoutX.current = x;
              barWidth.current = w;
            }}
          >
            <View style={cv.track}>
              <View style={[cv.fill, { width: `${pct * 100}%` }]} />
              <Animated.View style={[cv.knob, { opacity: knobOpacity, transform: [{ translateX: knobX }] }]} />
            </View>
          </View>
        </Animated.View>
      ) : (
        // ── NON-FULLSCREEN: Static height track, knob appears on tap ──
        <>
          <Animated.View style={[cv.timeRow, cv.timeRowFloating, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
            <Text style={cv.timeText}>{fmtTime(position)} / {fmtTime(duration)}</Text>
          </Animated.View>

          <Animated.View
            {...pan.panHandlers}
            style={[cv.bottomEdgeTrackHit, { opacity }]}
            pointerEvents={visible ? 'auto' : 'none'}
            onLayout={(event) => {
              const { x, width: w } = event.nativeEvent.layout;
              barLayoutX.current = x;
              barWidth.current = w;
            }}
          >
            <View style={cv.bottomEdgeTrack}>
              <View style={[cv.fill, { width: `${pct * 100}%` }]} />
              <Animated.View
                style={[
                  cv.knob,
                  {
                    opacity: knobOpacity,
                    transform: [{ translateX: knobX }],
                  },
                ]}
              />
            </View>
          </Animated.View>
        </>
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
  bufferWrap:       { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  bufferText:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
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
  bottomBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 12 },
  // ── Non-fullscreen, always-visible bottom-edge progress line ──
  bottomEdgeTrackHit: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24, // generous invisible drag area
    justifyContent: 'flex-end', // Aligns the line flush to the absolute bottom edge (bottom: 0)
  },
  bottomEdgeTrack: {
    width: '100%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    position: 'relative',
    justifyContent: 'center',
  },
  timeRowFloating: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
  },
  track:            { width: '100%', height: 1.5, backgroundColor: 'rgba(255,255,255,0.2)', position: 'relative', justifyContent: 'center' },
  fill:             { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fff' },
  knob:             { position: 'absolute', left: 0, marginLeft: -3.5, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff', top: -2.75, elevation: 6, zIndex: 99 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  timeText:         { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700' },
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

const QUALITY_PRIORITY = ['auto', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

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

const KeyboardWrapperView = Platform.OS === 'android' ? View : KeyboardAvoidingView;
const keyboardWrapperProps = Platform.OS === 'android' ? {} : { behavior: 'padding' as const, keyboardVerticalOffset: 0 };

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
  const stableBottomInset = fullscreen ? 0 : (insets.bottom > 0 ? insets.bottom : (lastNonZeroBottomInsetRef.current || 0));
  const stableTopInset    = fullscreen ? 0 : (insets.top    > 0 ? insets.top    : (lastNonZeroTopInsetRef.current    || 0));
  
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

  const handleTextChange = (text: string) => {
    setChatMessage(text);
    handleTyping(text);

    const match = text.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
    if (match) {
      setMentionListVisible(true);
      setMentionFilter(match[2].toLowerCase());
    } else {
      setMentionListVisible(false);
    }
  };

  const handleMentionSelect = (participantName: string) => {
    const newText = chatMessage.replace(/(^|\s)@([a-zA-Z0-9_]*)$/, `$1@${participantName} `);
    setChatMessage(newText);
    richInputRef.current?.setText(newText);
    setMentionListVisible(false);
    richInputRef.current?.focus();
  };

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [fetchedChannelLogo, setFetchedChannelLogo] = useState<string | null>(null);
  const [currentRoomName, setCurrentRoomName] = useState(initialRoomName || '');
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isTrackPlayerReady, setIsTrackPlayerReady] = useState(false);
  const trackPlayerReadyTime = useRef(0);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [playerState, setPlayerState] = useState<string>('unstarted');
  const [mentionListVisible, setMentionListVisible] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
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
  const [isDJBackgrounded, setIsDJBackgrounded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [videoRatings, setVideoRatings] = useState<Record<string, { total: number; count: number; myRating?: number }>>({});
  const [isDriveAuthenticated, setIsDriveAuthenticated] = useState<boolean | null>(null);
  const [videoQuality, setVideoQuality] = useState('auto');
  const [availableQualities, setAvailableQualities] = useState<string[]>(['auto']);
  const [liveExactResolution, setLiveExactResolution] = useState<string | null>(null);
  const videoFormatsRef = useRef<Record<string, string>>({});
  const [showQualityOptions, setShowQualityOptions] = useState(false);

  // ─── Direct ExoPlayer (Rave-style Native Video) State ───────────────────────
  const [directStreamUrl, setDirectStreamUrl] = useState<string | null>(null);
  const [directAudioUrl, setDirectAudioUrl] = useState<string | null>(null);
  const [directStreamType, setDirectStreamType] = useState<'mpd' | 'mp4' | 'm3u8'>('mp4');
  const [isDirectLoading, setIsDirectLoading] = useState(false);
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
  const lastAuxPassTimeRef = useRef(0);
  const loadedAudioSessionRef = useRef<string | null>((global as any).loadedAudioSessionId || null);
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayerReadyRef = useRef(false);
  const playerReadyTime = useRef(0);
  const isAdPlayingRef = useRef(false);
  const isDJBackgroundedRef = useRef(false);

  const { roomState, isConnected, isLoading, playerRef, loadSong, syncPlay, syncPause, syncSeek, addToQueue, pinVideo, unpinVideo, passAux, updateCurrentSongMetadata, updateMicPermission, joinSnapshot } = useMusicRoom(roomCode, user?.id ?? 0, isPlayerReadyRef, playerReadyTime, isAdPlayingRef, isDJBackgroundedRef);
  const { isDJ, currentSong, isPlaying, position, queue, participants, roomName, allowedSpeakers } = roomState;

  useEffect(() => {
    if (currentSong?.videoId) {
      initialSongLoadedRef.current = true;
    }
  }, [currentSong?.videoId]);

  const resolveStreamUrlForQuality = useCallback((dashUrl: string | null, streams: any[], qualityKey: string) => {
    if (dashUrl) {
      return { url: dashUrl, audioUrl: null, type: 'mpd' as const };
    }

    const heightMap: Record<string, number> = {
      'hd1440': 1440,
      'hd1080': 1080, 'hd720': 720, 'large': 480,
      'medium': 360, 'small': 240, 'tiny': 144,
    };

    if (!streams || streams.length === 0) {
      return { url: '', audioUrl: null, type: 'mp4' as const };
    }

    const parsedHeight = parseInt(qualityKey.replace(/\D/g, ''), 10);
    const rawTarget = heightMap[qualityKey] || (parsedHeight > 0 ? parsedHeight : 0);
    const targetHeight = Math.min(1440, rawTarget);

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
    // 1. Current song thumbnail / videoId
    if (currentSong?.thumbnail && typeof currentSong.thumbnail === 'string' && currentSong.thumbnail.startsWith('http')) {
      return currentSong.thumbnail;
    }
    if (currentSong?.videoId) {
      if (currentSong?.source === 'drive') {
        return `https://drive.google.com/thumbnail?id=${currentSong.videoId}&sz=w800`;
      }
      return `https://img.youtube.com/vi/${currentSong.videoId}/hqdefault.jpg`;
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
          return `https://drive.google.com/thumbnail?id=${nextSong.videoId}&sz=w800`;
        }
        return `https://img.youtube.com/vi/${nextSong.videoId}/hqdefault.jpg`;
      }
    }

    // 3. Only fall back to initial navigation params on cold start before the room loads
    if (!initialSongLoadedRef.current) {
      if (initialThumbnail) return initialThumbnail;
      const vid = initialVideoId;
      const src = initialSource;
      if (vid) {
        if (src === 'drive') {
          return `https://drive.google.com/thumbnail?id=${vid}&sz=w800`;
        }
        return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
      }
    }
    return null;
  }, [currentSong?.thumbnail, currentSong?.videoId, currentSong?.source, queue]);



  const handleExoPlayerFallback = useCallback(async (videoId: string) => {
    console.warn('⚠️ [ExoPlayer] Playback error encountered, falling back to YouTube player for video:', videoId);
    setDirectStreamUrl(null);
    setDirectAudioUrl(null);
    setDirectStreamsList([]);
  }, []);

  const dynamicQualityOptions = useMemo(() => {
    // Prioritize direct extracted streams if available
    const directKeys = directStreamsList.map(s => s.qualityKey).filter(Boolean);
    const validLevels = (directKeys.length > 0 ? directKeys : availableQualities).filter(q => q && q !== 'auto');
    const sourceList = validLevels.length > 0
      ? ['auto', ...validLevels]
      : ['auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

    // Filter out anything strictly above 1440p (8K, 4K, 2160p, 4320p)
    const EXCLUDED_OVER_1440 = new Set(['hd4320', 'highres', 'hd2160', '4320p', '2160p', '8k', '4k']);
    const filtered = sourceList.filter(q => {
      if (EXCLUDED_OVER_1440.has(String(q).toLowerCase())) return false;
      const num = parseInt(String(q).replace(/\D/g, ''), 10);
      if (num > 1440) return false;
      return true;
    });
    const unique = Array.from(new Set(filtered));

    return unique.sort((a, b) => {
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

  // ─── Room Theme State & Persistence ─────────────────────────────────────────
  const [roomTheme, setRoomTheme] = useState<RoomTheme>('cinema');

  useEffect(() => {
    AsyncStorage.getItem('@music_room_theme').then(saved => {
      if (saved === 'cinema' || saved === 'rave' || saved === 'dark' || saved === 'light') {
        setRoomTheme(saved as RoomTheme);
      }
    }).catch(() => {});
  }, []);

  const handleThemeChange = (newTheme: RoomTheme) => {
    setRoomTheme(newTheme);
    AsyncStorage.setItem('@music_room_theme', newTheme).catch(() => {});
  };

  const handleCycleTheme = () => {
    const nextTheme: Record<RoomTheme, RoomTheme> = {
      cinema: 'rave',
      rave: 'dark',
      dark: 'light',
      light: 'cinema',
    };
    handleThemeChange(nextTheme[roomTheme]);
  };

  const isLight = roomTheme === 'light';
  const themeTextColor = isLight ? '#0F172A' : '#FFFFFF';
  const themeSubTextColor = isLight ? '#475569' : 'rgba(255,255,255,0.6)';
  const themeIconColor = isLight ? '#0F172A' : '#FFFFFF';
  const themePlaceholderColor = isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255,255,255,0.40)';

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
      text: caption || '',
      media_url: asset.uri,
      local_uri: asset.uri,
      message_type: messageType,
      reply_to: currentReplyTo,
      created_at: new Date().toISOString(),
      status: 'sending',
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
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  // ✅ Single related-videos panel state. Opened either via the top-left
  // icon button (available anytime, anyone — DJ or participant) or
  // automatically when the video ends (existing behavior). Shows queue +
  // fresh suggestions only — no PIP, no current-song display, per spec.
  const [showRelated, setShowRelated] = useState(false);
  const showRelatedRef = useRef(false);
  useEffect(() => {
    showRelatedRef.current = showRelated;
  }, [showRelated]);
  const isKeyboardVisibleRef = useRef(false);

  const stickerPickerVisibleRef = useRef(false);
  stickerPickerVisibleRef.current = stickerPickerVisible;
  const safeBottomPadding = stableBottomInset + 12;
  const { height: keyboardHeight, progress } = useReanimatedKeyboardAnimation();
  const stickerSpacerHeight = useSharedValue(0);
  // Lifts the entire conversation area (messages + chat bar) smoothly when keyboard or sticker drawer opens.
  // Using pure GPU translateY transform ensures 60fps/120fps with zero layout recalculation and zero jerking.
  const conversationLiftStyle = useAnimatedStyle(() => {
    const kbHeight = Math.abs(keyboardHeight.value);
    const lift = kbHeight > 0 ? Math.max(0, kbHeight - stableBottomInset) : 0;
    const finalLift = Math.max(lift, stickerSpacerHeight.value);
    return {
      transform: [{ translateY: -finalLift }],
    };
  });

  useEffect(() => {
    if (isMinimized) {
      setStickerPickerVisible(false);
      stickerSpacerHeight.value = 0;
    }
  }, [isMinimized, stickerSpacerHeight]);

  useEffect(() => {
    if (stickerPickerVisible) {
      Keyboard.dismiss();
      stickerSpacerHeight.value = withTiming(286, {
        duration: 250,
        easing: Easing.bezier(0.0, 0.0, 0.2, 1),
      });
    } else {
      stickerSpacerHeight.value = withTiming(0, {
        duration: 220,
        easing: Easing.bezier(0.4, 0.0, 1, 1),
      });
    }
  }, [stickerPickerVisible, stickerSpacerHeight]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setStickerPickerVisible(false);
        stickerSpacerHeight.value = 0;
      };
    }, [])
  );

  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  useEffect(() => {
    const handleShow = () => {
      if (isMinimized || !isFocusedRef.current) return;
      isKeyboardVisibleRef.current = true;
      setStickerPickerVisible(false);
    };

    const handleHide = () => {
      if (isMinimized || !isFocusedRef.current) return;
      isKeyboardVisibleRef.current = false;
      if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
      lastTypingState.current = false;
      musicWebSocketService.sendTyping(false);
    };

    const listeners = [
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', handleShow),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', handleHide),
    ];

    return () => {
      listeners.forEach(l => l.remove());
    };
  }, [safeBottomPadding]);


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

  const renderNpBar = () => {
    const displayTitle = (currentSong?.title && currentSong.title !== 'Loading...' && currentSong.title !== 'Initializing...' && currentSong.title !== 'YouTube Video' && currentSong.title !== 'Watch Party' && currentSong.title !== 'Drive Video')
      ? currentSong.title
      : (!initialSongLoadedRef.current && initialTitle && initialTitle !== 'YouTube Video' && initialTitle !== 'Watch Party' && initialTitle !== 'Drive Video' ? initialTitle : (!initialSongLoadedRef.current && initialRoomName && initialRoomName !== 'YouTube Video' && initialRoomName !== 'Watch Party' ? initialRoomName : 'Loading...'));

    const pinnerName = currentSong?.addedBy || 'Someone';
    const pinner = participants.find(p => p.name === currentSong?.addedBy) || user;
    const likers = isLiked ? [user] : [];
    const logoUri = currentSong?.channelLogo || fetchedChannelLogo || (!initialSongLoadedRef.current ? initialThumbnail : null) || currentSong?.thumbnail || (initialVideoId ? `https://img.youtube.com/vi/${initialVideoId}/hqdefault.jpg` : null);

    return (
      <View style={s.npBar}>
        <View style={{ width: 36, height: 36, position: 'relative' }}>
          {logoUri ? (
            <Image 
              source={{ uri: logoUri }} 
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }} 
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isLight ? '#E2E8F0' : '#282828', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)' }}>
              <Icon name="musical-notes" size={18} color="#FF453A" />
            </View>
          )}
          <TouchableOpacity 
            style={{ position: 'absolute', bottom: -2, right: -2 }}
            onPress={() => handleAvatarPress(pinner?.avatar || pinner?.profile_picture, pinner?.avatar_sticker, pinnerName)}
          >
            <AvatarWithFallback 
              uri={pinner?.avatar || pinner?.profile_picture} 
              displayName={pinnerName} 
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
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[s.npTitle, { flex: 1 }, isLight && { color: '#0F172A' }]} numberOfLines={1}>{displayTitle}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            {/* Likers Container - Left aligned, normal order (heart on left, avatars next to it on right) */}
            <TouchableOpacity 
              onPress={handleToggleLike} 
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', 
                paddingHorizontal: 8, 
                paddingVertical: 4, 
                borderRadius: 14,
                flexShrink: 0
              }}
              activeOpacity={0.7}
            >
              <Icon 
                name={isLiked ? "heart" : "heart-outline"} 
                size={16} 
                color={isLiked ? (isLight ? "#E11D48" : "#fff") : (isLight ? "#64748B" : "rgba(255,255,255,0.6)")} 
                style={{ marginRight: likers.length > 0 ? 6 : 0 }} 
              />
              {likers.length > 0 && (
                likers.length <= 4 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {likers.map((liker, i) => (
                      <AvatarWithFallback 
                        key={i}
                        uri={liker?.avatar || liker?.profile_picture} 
                        displayName={liker?.display_name || liker?.email || liker?.name || 'User'} 
                        style={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: 8, 
                          marginLeft: i > 0 ? -6 : 0, 
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
                    style={{ maxHeight: 20, flexShrink: 1, maxWidth: 80 }}
                  >
                    {likers.map((liker, i) => (
                      <AvatarWithFallback 
                        key={i}
                        uri={liker?.avatar || liker?.profile_picture} 
                        displayName={liker?.display_name || liker?.email || liker?.name || 'User'} 
                        style={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: 8, 
                          marginLeft: i > 0 ? -6 : 0, 
                          borderWidth: 1, 
                          borderColor: isLight ? '#FFFFFF' : '#1E1E1E' 
                        }} 
                      />
                    ))}
                  </ScrollView>
                )
              )}
            </TouchableOpacity>

            {/* Skip Button - Moved to the right end of the like row */}
            <TouchableOpacity 
              onPress={handleNext} 
              disabled={!(isDJ || isDJMode)}
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', 
                paddingHorizontal: 12, 
                paddingVertical: 4, 
                borderRadius: 14,
                opacity: (isDJ || isDJMode) ? 1 : 0.4
              }}
              activeOpacity={0.7}
            >
              <Icon name="play-skip-forward" size={16} color={isLight ? '#0F172A' : '#fff'} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
      NativeModules.SystemBar.setFitsSystemWindows(false);
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
        NativeModules.SystemBar.setFitsSystemWindows(false);
      }
    }, [roomCode])
  );

  // Refs
  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataLock = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const relatedScrollX = useRef(new Animated.Value(0)).current;
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
        if (showRelatedRef.current) {
          // If related overlay is open, tapping the mini player closes it
          setShowRelated(false);
        } else {
          // Otherwise, toggle playback controls
          showControlsForRef.current();
        }
      } else if (Math.abs(gestureState.dx) > 40) {
        // Swipe detected! Open the related videos grid
        if (!showRelatedRef.current && currentSongRef.current?.source !== 'drive') {
          fetchRelated();
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

  useEffect(() => {
    const targetVideoId = currentSong?.videoId || initialVideoId;
    const targetSource = currentSong?.source || initialSource;

    if (!targetVideoId || targetSource === 'drive') {
      if (targetSource === 'drive') {
        setDirectStreamUrl(null);
        setDirectAudioUrl(null);
        setDirectStreamsList([]);
        setIsDirectLoading(false);
      }
      return;
    }

    // Deduplication guard: do not re-run extraction if already fetching or active for targetVideoId
    if (currentDirectFetchId.current === targetVideoId) {
      console.log(`ℹ️ [MusicRoom] Video ${targetVideoId} already active/extracting, skipping duplicate run`);
      return;
    }

    currentDirectFetchId.current = targetVideoId;
    videoFormatsRef.current = {};
    failedStreamUrlsRef.current.clear();
    setDirectStreamsList([]);
    directStreamsListRef.current = [];
    fallbackProgressiveUrlRef.current = null; // reset ANDROID fallback URL for new song
    setDirectFallbackUrl(null);
    setDirectStreamUrl(null); // Clear previous video stream immediately so no frozen screenshot displays
    setDirectAudioUrl(null);
    livePositionRef.current = 0; // Reset position so new song starts fresh at 0s
    setLivePosition(0);
    setAvailableQualities(['auto']);
    // Fix 1: Reset quality to Auto on every new song so stale quality isn't
    // applied to a new video before ExoPlayer has parsed its track list.
    setVideoQuality('auto');
    setLiveExactResolution(null);
    setShowQualityOptions(false);

    fetchVideoAspectRatio(targetVideoId).then((ar) => {
      if (currentDirectFetchId.current === targetVideoId && ar && !isNaN(ar) && ar >= 0.4 && ar <= 3.5) {
        console.log(`📐 [AUTO ASPECT RATIO] Song "${currentSong?.title || targetVideoId}" detected AR: ${ar.toFixed(3)} -> Target Height: ${Math.round(width / ar)}px`);
        setDetectedAspectRatio(ar);
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
          if (!currentSong?.title || currentSong.title === 'Watch Party' || currentSong.title === 'YouTube Video' || currentSong.title === 'Loading...') {
            updateCurrentSongMetadata({
              videoId: targetVideoId,
              title: meta.title,
              thumbnail: meta.thumbnail || `https://img.youtube.com/vi/${targetVideoId}/hqdefault.jpg`,
              channelTitle: meta.channelTitle || 'YouTube',
              channelLogo: meta.channelLogo,
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
    extractVideoStreamUrlClientSide(targetVideoId).then((res) => {
      if (currentDirectFetchId.current !== targetVideoId) return;
      if (res && res.streams && res.streams.length > 0) {
        console.log(`🎬 [MusicRoom] Client-side extraction success: ${res.streams.length} qualities available (highest: ${res.streams[0].height}p)`);
        if (res.title && (!currentSong?.title || currentSong.title === 'Watch Party' || currentSong.title === 'YouTube Video' || currentSong.title === 'Loading...')) {
          updateCurrentSongMetadata({
            videoId: targetVideoId,
            title: res.title,
            thumbnail: currentSong?.thumbnail || `https://img.youtube.com/vi/${targetVideoId}/hqdefault.jpg`,
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
        if (res.dashUrl) {
          console.log(`🎬 [MusicRoom] Activating DirectVideoPlayer with DASH manifest (${res.streams.length} representations)`);
          setDirectStreamUrl(res.dashUrl);
          setDirectAudioUrl(null);
          setDirectStreamType('mpd');
        } else if (res.url) {
          console.log(`🎬 [MusicRoom] Activating DirectVideoPlayer with single stream: ${res.url.substring(0, 60)}...`);
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
      setDetectedAspectRatio(ar);
    }
  }, []);

  const dynamicVideoHeight = useMemo(() => {
    if (fullscreen) return height;
    if (detectedAspectRatio && !isNaN(detectedAspectRatio) && detectedAspectRatio > 0) {
      if (detectedAspectRatio < 1.0) {
        // Vertical Short / Portrait Video: allocate top half of screen (~48% height)
        // so the full vertical short fits completely without cropping, leaving bottom half for chat & keyboard
        return Math.round(height * 0.48);
      }
      // Standard / Landscape / 4:3 videos
      const targetHeight = width / detectedAspectRatio;
      const minH = VIDEO_HEIGHT; // Minimum height is the thumbnail height (standard 16:9) — never shrinks below this
      const maxH = width * 0.85; // ~340px max bound (tall 4:3 videos like Pavazha Malli)
      return Math.max(minH, Math.min(maxH, targetHeight));
    }
    return VIDEO_HEIGHT; // Default standard 16:9
  }, [fullscreen, detectedAspectRatio]);

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
    // Only schedule idle close if playback has completely ended and there is no active song or queue
    const isEndedWithEmptyQueue = playerState === 'ended' && !currentSong?.videoId && queue.length === 0;

    if (isEndedWithEmptyQueue) {
      scheduleIdleClose();
    } else {
      clearIdleCloseTimer();
    }

    return () => clearIdleCloseTimer();
  }, [isPlaying, playerState, queue.length, currentSong?.videoId, scheduleIdleClose, clearIdleCloseTimer]);
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

      // ExoPlayer (DirectVideoPlayer) seeks are near-instant in progressive MP4.
      // Give it 200ms to settle the seek, then unblock progress/sync callbacks.
      console.log('🎯 [SEEK SYNC] Waiting for ExoPlayer to settle seek to', t);
      setTimeout(() => {
        setIsReseeking(false);
        setTimeout(() => { seekingRef.current = false; }, 300);
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

    // Drive now uses the same rendezvous as YouTube — no special case needed.

    const isReadyToSync = currentSong?.source === 'drive'
      ? (isPlayerReady && isTrackPlayerReady)
      : isPlayerReady;

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
          NativeModules.SystemBar.setFitsSystemWindows(false);
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
      return;
    }
    if (currentSong?.channelLogo) {
      setFetchedChannelLogo(currentSong.channelLogo);
      return;
    }
    let isMounted = true;
    fetchChannelLogo(targetVid).then(logo => {
      if (isMounted && logo) {
        setFetchedChannelLogo(logo);
      }
    });
    return () => { isMounted = false; };
  }, [currentSong?.videoId, currentSong?.channelLogo, currentSong?.source, initialVideoId, initialSource]);

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

        if (isDJ && isPlaying && !isAdPlayingRef.current && !seekingRef.current && !isReseeking && !isUserAction.current && Math.floor(pos ?? 0) % 5 === 0) {
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
      } catch (_) {}
      setIsPlayerReady(false);
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
      setIsSyncing(true);
      loadSong(richSong, currentRoomName);
    } else {
      addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
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
      if (!(isDJ || isDJMode)) return;
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
      if (!(isDJ || isDJMode)) return;
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
        const fallbackThumb = `https://img.youtube.com/vi/${initialVideoId}/mqdefault.jpg`;
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
      metadataLock.current = null;
      setIsPlayerReady(false);
      setIsTrackPlayerReady(false); // ✅ Block WebView until audio is ready
      lastSnapVideoId.current = null; // ✅ Allow snap for new song
      setPlayerError(null);
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
      if (isKeyboardVisibleRef.current) {
        richInputRef.current?.blur();
        Keyboard.dismiss();
        isKeyboardVisibleRef.current = false;
        stickerSpacerHeight.value = 0;
        return true;
      }
      if (stickerPickerVisible) {
        richInputRef.current?.blur();
        Keyboard.dismiss();
        setStickerPickerVisible(false);
        stickerSpacerHeight.value = 0;
        return true;
      }
      if (previewData.visible) { setPreviewData(p => ({ ...p, visible: false })); return true; }
      if (showDiscovery) { setShowDiscovery(false); return true; }
      if (fullscreen) { setFullscreen(false); return true; }
      if (showLeaveConfirm) { setShowLeaveConfirm(false); return true; }
      setShowLeaveConfirm(true);
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => { backHandler.remove(); };
  }, [showDiscovery, fullscreen, isMinimized, previewData.visible, stickerPickerVisible, stickerSpacerHeight, showLeaveConfirm]);

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
          // If this incoming message is from current user and matches an optimistic media message, replace it
          const isFromMe = Number(msg.data.user_id) === Number(user?.id) || msg.data.user === (user?.display_name || user?.email);
          if (isFromMe && (msg.data.message_type === 'image' || msg.data.message_type === 'gif' || msg.data.message_type === 'sticker')) {
            const optIdx = prev.findIndex(m =>
              m.status === 'sending' &&
              (m.local_id || String(m.id).startsWith('local_')) &&
              m.message_type === msg.data.message_type
            );
            if (optIdx !== -1) {
              const optItem = prev[optIdx];
              const next = [...prev];
              next[optIdx] = {
                ...msg.data,
                local_id: optItem.local_id,
                local_uri: optItem.local_uri || optItem.media_url,
              };
              return next;
            }
          }
          return [...prev, msg.data];
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
  const fetchRelated = useCallback(async () => {
    setIsLoadingRelated(true);
    // Don't clear the list immediately — keep previous results visible while
    // re-fetching so the user never sees an empty black grid with a spinner.
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
          .filter((song: Song) => !queuedIds.has(song.videoId) && song.videoId !== currentSongRef.current?.videoId);
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
    if (['playing', 'paused'].includes(state)) setIsPlayerReady(true);

    if (state === 'ended') {
      if (duration > 0) {
        if (isDJ || isDJMode) {
          if (Date.now() - lastAuxPassTimeRef.current < 1500) return;
          lastAuxPassTimeRef.current = Date.now();
          setIsPlayerReady(false);
          isPlayerReadyRef.current = false;
          setIsBuffering(true);
          setIsSyncing(true);
          setDirectStreamUrl(null);
          setDirectAudioUrl(null);
          livePositionRef.current = 0;
          setLivePosition(0);
          passAux();
        } else {
          fetchRelated();
          setShowRelated(true);
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
    if (Date.now() - lastAuxPassTimeRef.current < 1500) return;
    lastAuxPassTimeRef.current = Date.now();
    if (queue.length === 0) {
      // Nothing queued to skip to — show the related panel immediately so
      // there's visible feedback and a way to pick something, instead of
      // silently fetching suggestions in the background with no UI change.
      setShowRelated(true);
    } else {
      try {
        playerRef.current?.pauseVideo?.();
      } catch (_) {}
      setIsPlayerReady(false);
      isPlayerReadyRef.current = false;
      setIsBuffering(true);
      setIsSyncing(true);
      setDirectStreamUrl(null);
      setDirectAudioUrl(null);
      livePositionRef.current = 0;
      setLivePosition(0);
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
  if (!chatMessage.trim()) return;
  musicWebSocketService.sendChatMessage(chatMessage, replyingTo);
  setChatMessage('');
  setInputHeight(40);
  // Clear text imperatively (no key change) so the input stays mounted
  // and the keyboard remains open after sending.
  richInputRef.current?.clear();
  setReplyingTo(null);

  if (typingIndicatorTimeout.current) clearTimeout(typingIndicatorTimeout.current);
  lastTypingState.current = false;
  musicWebSocketService.sendTyping(false);
};

const sendLottieSticker = useCallback((sticker: Sticker) => {
  musicWebSocketService.sendChatMessage(sticker.url, replyingTo, undefined, 'lottie_sticker');
  setReplyingTo(null);
}, [replyingTo]);




  const renderLeaveModal = () => {
    if (!showLeaveConfirm) return null;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowLeaveConfirm(false)}>
          <View style={[s.confirmContent, { padding: 20, width: '85%', maxWidth: 300, borderRadius: 20, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]}>
            <TouchableOpacity
              onPress={() => setShowLeaveConfirm(false)}
              style={{ position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}
            >
              <Icon name="close" size={16} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>

            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 18, marginTop: 4, textAlign: 'center' }}>
              Watch Party
            </Text>

            <View style={{ flexDirection: 'row', width: '100%', gap: 10 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(226, 232, 240, 0.12)',
                  borderColor: 'rgba(203, 213, 225, 0.35)',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 6,
                }}
                onPress={() => {
                  setShowLeaveConfirm(false);
                  handleMinimize();
                }}
                activeOpacity={0.7}
              >
                <Icon name="contract-outline" size={17} color="#CBD5E1" />
                <Text style={{ color: '#E2E8F0', fontSize: 13, fontWeight: '700' }}>Minimize</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(226, 232, 240, 0.12)',
                  borderColor: 'rgba(203, 213, 225, 0.35)',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 6,
                }}
                onPress={() => {
                  setShowLeaveConfirm(false);
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
                }}
                activeOpacity={0.7}
              >
                <Icon name="exit-outline" size={17} color="#CBD5E1" />
                <Text style={{ color: '#E2E8F0', fontSize: 13, fontWeight: '700' }}>Close</Text>
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

  const reversedMessages = [...messages].reverse();

  return (
    <View style={[s.root, isLight && { backgroundColor: '#F8FAFC' }]}>
      <StatusBar barStyle={isLight || isMinimized ? "dark-content" : "light-content"} backgroundColor="transparent" translucent={true} />

      {/* ── 1. RAVE DUAL-LAYER: BACKGROUND LIVE BLURRED VIDEO LAYER ── */}
      <BackgroundAmbientPlayer
        videoId={previewVideoId || currentSong?.videoId || (initialSongLoadedRef.current ? null : initialVideoId)}
        thumbnailUrl={videoThumbnailUrl}
        isPlayerReady={isPlayerReady || !!previewVideoId}
        isPlaying={isPlaying || !!previewVideoId}
        currentTime={livePosition}
        isMinimized={isMinimized}
        fullscreen={fullscreen}
        theme={roomTheme}
      />

      {/* ── 2. AMBIENT DISCO FLUID AURORA OVERLAY (cinema | dark | light) ── */}
      <AmbientDiscoBackground
        isPlaying={isPlaying}
        isMinimized={isMinimized}
        fullscreen={fullscreen}
        videoId={currentSong?.videoId}
        theme={roomTheme}
      />

      <KeyboardWrapperView
        {...keyboardWrapperProps}
        style={[s.inner, { paddingTop: stableTopInset, paddingBottom: stableBottomInset }]}
      >
        <View style={{ flex: 1 }}>
          {renderLeaveModal()}

          {!fullscreen && (
            <View style={s.header}>
              {/* Left Side: Leader Profile + Expandable Speaker Slots */}
              {(() => {
                const leader = participants.find(p => p.is_dj) || participants[0];
                const isLeaderVoiceActive = leader ? (
                  leader.user_id === (user?.id ?? 0) ? isMicOn : voiceParticipants.has(leader.user_id)
                ) : false;

                const allowedOtherSpeakers = participants.filter(p => {
                  if (p.user_id === leader?.user_id) return false;
                  const isAllowed = allowedSpeakers && allowedSpeakers.includes(p.user_id);
                  const isVoiceActive = p.user_id === (user?.id ?? 0) ? isMicOn : voiceParticipants.has(p.user_id);
                  return isAllowed || isVoiceActive;
                });

                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', zIndex: 10 }}>
                    {/* Theme Switch Button in Header Left Corner */}
                    <TouchableOpacity
                      onPress={handleCycleTheme}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        borderColor: isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.2)',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: 6,
                      }}
                      accessibilityLabel="Switch room theme"
                    >
                      <Icon
                        name={roomTheme === 'cinema' ? 'color-palette' : (roomTheme === 'rave' ? 'videocam' : (roomTheme === 'dark' ? 'moon' : 'sunny'))}
                        size={16}
                        color={isLight ? '#0F172A' : '#FFFFFF'}
                      />
                    </TouchableOpacity>

                    {/* Slot 1: Leader (DJ) */}
                    {leader && (
                      <TouchableOpacity
                        onPress={() => handleAvatarPress(leader.avatar, leader.avatar_sticker, leader.name)}
                        style={{ marginRight: 4, position: 'relative' }}
                      >
                        <AvatarWithFallback
                          uri={leader.avatar}
                          displayName={leader.name}
                          sticker={leader.avatar_sticker}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            borderWidth: isLeaderVoiceActive ? 2 : 1.5,
                            borderColor: isLeaderVoiceActive
                              ? '#10B981'
                              : (isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'),
                          }}
                        />
                        <View style={{ position: 'absolute', top: -4, right: -4, zIndex: 10 }}>
                          <Icon name="star" size={11} color="#FFD700" />
                        </View>
                        {isLeaderVoiceActive && (
                          <View style={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#10B981', borderWidth: 1.5, borderColor: '#050811', zIndex: 11 }} />
                        )}
                      </TouchableOpacity>
                    )}

                    {/* Allowed/Active Speaker Profiles (up to 3) */}
                    {allowedOtherSpeakers.slice(0, 3).map((speaker) => {
                      const isVoiceOn = speaker.user_id === (user?.id ?? 0) ? isMicOn : voiceParticipants.has(speaker.user_id);
                      return (
                        <TouchableOpacity
                          key={`speaker-slot-${speaker.user_id}`}
                          onPress={() => handleAvatarPress(speaker.avatar, speaker.avatar_sticker, speaker.name)}
                          style={{ marginRight: 4, position: 'relative' }}
                        >
                          <AvatarWithFallback
                            uri={speaker.avatar}
                            displayName={speaker.name}
                            sticker={speaker.avatar_sticker}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 13,
                              borderWidth: isVoiceOn ? 2 : 1.5,
                              borderColor: isVoiceOn
                                ? '#10B981'
                                : (isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'),
                            }}
                          />
                          {isVoiceOn && (
                            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#10B981', borderWidth: 1.5, borderColor: '#050811', zIndex: 11 }} />
                          )}
                        </TouchableOpacity>
                      );
                    })}

                    {/* Single Next Open Dummy Slot (only shown if less than 3 extra speakers) */}
                    {allowedOtherSpeakers.length < 3 && (
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          borderWidth: 1,
                          borderStyle: 'dashed',
                          borderColor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)',
                          backgroundColor: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginRight: 4,
                        }}
                      >
                        <Icon
                          name="volume-medium-outline"
                          size={12}
                          color={isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)'}
                        />
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* Center: App Logo (Exact Center) */}
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', pointerEvents: 'box-none' }}>
                <TouchableOpacity
                  onPress={() => setShowLeaveConfirm(true)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 2,
                    borderRadius: 8,
                    backgroundColor: isLight ? 'rgba(0,0,0,0.05)' : 'transparent',
                  }}
                >
                  <Image
                    source={require('../assets/logo.png')}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      tintColor: isLight ? '#0F172A' : undefined,
                    }}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              </View>

              {/* Right Side: Actions */}
              <View style={s.headerRight}>
                <TouchableOpacity onPress={() => setInviteModalVisible(true)} style={s.headerIconBtn}>
                  <Icon name="person-add-outline" size={22} color={themeIconColor} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowDiscovery(true)} style={s.headerIconBtn}>
                  <Icon name="search" size={22} color={themeIconColor} />
                </TouchableOpacity>
                
                <TouchableOpacity onPress={() => setActiveTab(activeTab === 'chat' ? 'queue' : 'chat')} style={s.headerIconBtn}>
                  <Icon name="list" size={22} color={activeTab === 'queue' ? '#0284C7' : themeIconColor} />
                  {queue.length > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{queue.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {fullscreen && (
            <View style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: '#000',
              zIndex: 98
            }} />
          )}

          {/* VIDEO CONTAINER */}
          <View style={fullscreen ? {
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: '#000',
              zIndex: 99,
              overflow: 'hidden'
            } : [s.videoWrap, { height: dynamicVideoHeight }]}>
            <Animated.View style={fullscreen ? StyleSheet.absoluteFill : (showRelated ? {
              position: 'absolute',
              top: 0,
              left: 0,
              // Collapse to 0×0 when video ended/errored — the grid's slot 1 then
              // shows the static thumbnail card instead of a black PiP box
              width: (playerState === 'ended' || !!playerError) ? 0 : width / 2,
              height: (playerState === 'ended' || !!playerError) ? 0 : (width / 2) * 0.5625,
              zIndex: 16,
              backgroundColor: '#000',
              overflow: 'hidden',
              opacity: relatedScrollX.interpolate({
                inputRange: [0, width],
                outputRange: [1, 0],
                extrapolate: 'clamp',
              }),
            } : [StyleSheet.absoluteFill, { overflow: 'hidden' }])} pointerEvents={currentSong?.source === 'drive' ? 'box-none' : 'none'}>

              {/* ── Player Section ────────────────────────────────────────── */}
              {/* Keep player mounted while playing (shows as PiP in slot 1 of the related grid).
                  Only unmount when video has ended or errored — then slot 1 becomes a real video. */}
              {!(showRelated && (playerState === 'ended' || !!playerError)) && (currentSong?.videoId || (initialSongLoadedRef.current ? null : initialVideoId)) ? (

                // ─── Drive Video ───────────────────────────────────────────────
                (currentSong?.source || initialSource) === 'drive' ? (
                  <DrivePlayer
                    key={currentSong?.videoId || (initialSongLoadedRef.current ? 'drive_active' : initialVideoId)}
                    ref={playerRef}
                    fileId={currentSong?.videoId || (initialSongLoadedRef.current ? '' : initialVideoId)}
                    play={isPlaying && !playerError}
                    muted={false}
                    isFullscreen={fullscreen}
                    onAspectRatio={handleAspectRatio}
                    onReady={() => {
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
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
                      if (dur > 0 && !isNaN(dur)) setDuration(dur);
                      if (!seekingRef.current && currentTime > 0) {
                        livePositionRef.current = currentTime;
                        setLivePosition(currentTime);
                      }
                    }}
                    onError={() => {
                      setIsBuffering(false);
                      setPlayerError('unknown');
                    }}
                  />
                ) : directStreamUrl ? (
                  <DirectVideoPlayer
                    key={`direct_${currentSong?.videoId || (initialSongLoadedRef.current ? 'direct_active' : initialVideoId) || 'direct_player'}`}
                    ref={playerRef}
                    videoUri={directStreamUrl}
                    fallbackUri={directFallbackUrl || directStreamsListRef.current.find(s => s.has_audio)?.url || null}
                    audioUri={directAudioUrl}
                    streamType={directStreamType}
                    play={isPlaying && !playerError}
                    quality={videoQuality}
                    muted={false}
                    initialPosition={livePositionRef.current || initialRoomPosition || 0}
                    isFullscreen={fullscreen}
                    aspectRatio={detectedAspectRatio || 1.7777}
                    onAspectRatio={handleAspectRatio}
                    onExactResolution={setLiveExactResolution}
                    onQualityFallback={(fallbackQuality) => {
                      setVideoQuality(fallbackQuality);
                      setLiveExactResolution('Auto');
                    }}
                    onQualitiesAvailable={(qualities) => {
                      // Fix 3: ExoPlayer's track list can be incomplete (e.g. only 1-2 resolutions
                      // reported even when the DASH MPD has 6+). Only fall back to ExoPlayer's list
                      // if we have no extraction-derived streams yet.
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
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
                      playerReadyTime.current = Date.now();
                      setIsBuffering(false);
                      setMediaFullySynced(true);
                      const state = isPlaying ? 'playing' : 'paused';
                      setPlayerState(state);
                      playerStateRef.current = state;

                      if (!isDJ && !isDJMode && joinSnapshot && !joinSnapshotConsumed.current) {
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
                      if (!seekingRef.current && !isReseeking && currentTime > 0) {
                        livePositionRef.current = currentTime;
                        setLivePosition(currentTime);
                      }
                    }}
                    onEnd={() => {
                      if (isDJ || isDJMode) {
                        if (Date.now() - lastAuxPassTimeRef.current < 1500) return;
                        lastAuxPassTimeRef.current = Date.now();
                        setIsPlayerReady(false);
                        isPlayerReadyRef.current = false;
                        setIsBuffering(true);
                        setIsSyncing(true);
                        setDirectStreamUrl(null);
                        setDirectAudioUrl(null);
                        livePositionRef.current = 0;
                        setLivePosition(0);
                        passAux();
                      } else {
                        fetchRelated();
                        setShowRelated(true);
                      }
                    }}
                    onError={(err) => {
                      const errStr = JSON.stringify(err);
                      console.warn('[MusicRoomScreen] DirectVideoPlayer error (after internal recovery failed):', errStr);

                      const reextractVideoId = currentDirectFetchId.current;
                      if (reextractVideoId) {
                        console.log('🔄 [MusicRoomScreen] Re-extracting fresh streams after failure...');
                        dashUrlRef.current = null;
                        currentDirectFetchId.current = null;
                        setIsDirectLoading(true);

                        extractVideoStreamUrlClientSide(reextractVideoId).then((res) => {
                          if (!res) return;
                          currentDirectFetchId.current = reextractVideoId;
                          const progFallback = res.fallbackProgressiveUrl || fallbackProgressiveUrlRef.current;
                          if (res.dashUrl) {
                            console.log('✅ [MusicRoomScreen] Re-extraction success — restoring DASH quality switching');
                            setDirectStreamsList(res.streams || []);
                            directStreamsListRef.current = res.streams || [];
                            dashUrlRef.current = res.dashUrl;
                            setVideoQuality('auto');
                            setLiveExactResolution('Auto');
                            setDirectStreamUrl(res.dashUrl);
                            setDirectAudioUrl(null);
                            setDirectStreamType('mpd');
                          } else if (progFallback) {
                            console.log('🎬 [MusicRoomScreen] Escalated recovery: falling back to progressive stream');
                            setDirectStreamUrl(progFallback);
                            setDirectAudioUrl(null);
                            setDirectStreamType('mp4');
                          } else if (res.url) {
                            setDirectStreamUrl(res.url);
                            setDirectAudioUrl(null);
                            setDirectStreamType('mp4');
                          } else {
                            console.warn('[MusicRoomScreen] Re-extraction produced no streams, retrying direct player');
                          }
                          setIsDirectLoading(false);
                        }).catch(() => {
                          if (fallbackProgressiveUrlRef.current) {
                            setDirectStreamUrl(fallbackProgressiveUrlRef.current);
                            setDirectStreamType('mp4');
                          }
                          setIsDirectLoading(false);
                        });
                        return;
                      }

                      if (fallbackProgressiveUrlRef.current) {
                        setDirectStreamUrl(fallbackProgressiveUrlRef.current);
                        setDirectStreamType('mp4');
                      }
                    }}
                  />
                ) : isDirectLoading ? (
                  <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#4F46E5" />
                  </View>
                ) : (
                  <YoutubePlayer
                    key={currentSong?.videoId || (initialSongLoadedRef.current ? 'yt_active' : initialVideoId) || 'yt_player'}
                    ref={playerRef}
                    videoId={currentSong?.videoId || (initialSongLoadedRef.current ? '' : initialVideoId) || ''}
                    play={isPlaying && !playerError}
                    muted={false}
                    initialPosition={livePositionRef.current || 0}
                    quality={videoQuality}
                    isFullscreen={fullscreen}
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
                      setIsPlayerReady(true);
                      isPlayerReadyRef.current = true;
                      playerReadyTime.current = Date.now();
                      setIsBuffering(false);
                      setMediaFullySynced(true);
                      const state = isPlaying ? 'playing' : 'paused';
                      setPlayerState(state);
                      playerStateRef.current = state;

                      if (!isDJ && !isDJMode && joinSnapshot && !joinSnapshotConsumed.current) {
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
                      if (!seekingRef.current && !isReseeking && currentTime > 0) {
                        livePositionRef.current = currentTime;
                        setLivePosition(currentTime);
                      }
                    }}
                    onEnd={() => {
                      if ((isDJ || isDJMode) && queue.length > 0) {
                        if (Date.now() - lastAuxPassTimeRef.current < 1500) return;
                        lastAuxPassTimeRef.current = Date.now();
                        setIsPlayerReady(false);
                        isPlayerReadyRef.current = false;
                        setIsBuffering(true);
                        setIsSyncing(true);
                        passAux();
                      } else {
                        fetchRelated();
                        setShowRelated(true);
                      }
                    }}
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
                )
              ) : null}

              {/* ─── Clean Thumbnail + White Spinner Overlay (Zero Black Screen, Zero Text) ─── */}
              {!(showRelated && (playerState === 'ended' || !!playerError)) && !isPlayerReady && !playerError && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', zIndex: 10 }]} pointerEvents="none">
                  {videoThumbnailUrl ? (
                    <FastImage
                      key={videoThumbnailUrl}
                      source={{ uri: videoThumbnailUrl, priority: FastImage.priority.high }}
                      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                  ) : null}
                  {videoThumbnailUrl ? (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
                  ) : null}
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              )}
            </Animated.View>

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


            {!playerError && playerState !== 'ended' && (
              <View 
                style={showRelated ? {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: width / 2,
                  height: (width / 2) * 0.5625,
                  zIndex: 17,
                } : StyleSheet.absoluteFill}
                {...playerGestureResponder.panHandlers}
              />
            )}

            <VideoControls
              visible={showControls && !playerError}
              isPlaying={isPlaying}
              isEnded={playerState === 'ended'}
              canControl={(isDJ || isDJMode) && isPlayerReady}
              isBuffering={!isReseeking && (isBuffering || (currentSong?.source === 'drive' && !isTrackPlayerReady)) && !!currentSong}
              position={livePosition}
              duration={duration}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onNext={handleNext}
              onToggleFullscreen={() => setFullscreen(!fullscreen)}
              onShowRelated={() => setShowRelated(true)}
              onSettings={() => {
                setShowQualityOptions(prev => !prev);
              }}
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

                {isLoadingRelated && relatedVideos.length === 0 && (
                  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }]}>
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" animating={true} />
                  </View>
                )}
                {/* Only render the grid once we have videos — avoids the brief
                    flash of an empty grid with a spinner box in slot 1 */}
                {relatedVideos.length > 0 && (
                  <RelatedVideosGrid
                    queueItems={queue}
                    suggestedVideos={relatedVideos}
                    myUserId={user?.id ?? -1}
                    currentSong={currentSong}
                    scrollX={relatedScrollX}
                    onPinVideo={(song) => {
                      // Auto-play immediately if video ended OR an error opened the grid
                      if (playerState === 'ended' || !!playerError) {
                        setShowRelated(false);
                        setPlayerError(null);
                        handleSelectSong(song, true);
                      } else {
                        pinVideo(song);
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
                  maxWidth: 255,
                  maxHeight: '90%',
                  backgroundColor: 'rgba(12, 15, 22, 0.72)',
                  borderRadius: 10,
                  padding: 6,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                  zIndex: 61,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 }}>
                    <Text style={{ fontSize: 9.5, fontWeight: '700', color: 'rgba(255, 255, 255, 0.6)', letterSpacing: 0.8 }}>
                      QUALITY {liveExactResolution ? `• ${liveExactResolution}` : ''}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowQualityOptions(false)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ padding: 2 }}
                    >
                      <Icon name="close" size={13} color="rgba(255, 255, 255, 0.7)" />
                    </TouchableOpacity>
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
                            width: '22.5%',
                            marginHorizontal: '1.25%',
                            marginVertical: 3,
                            height: 26,
                            borderRadius: 5,
                            justifyContent: 'center',
                            alignItems: 'center',
                            backgroundColor: isSelected ? 'rgba(2, 132, 199, 0.9)' : 'rgba(255, 255, 255, 0.10)',
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
          </View>

          {!fullscreen && (
            renderNpBar()
          )}

          {!fullscreen && (
            <View style={{ flex: 1, overflow: 'hidden' }}>
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
                              participant: { user_id: Number(myId), name: myDisplayName, avatar: user.profile_picture }
                            });
                          }
                          if (myId && !mentionsList.some(m => m.searchStr === `@${myId}`)) {
                            mentionsList.push({
                              searchStr: `@${myId}`,
                              participant: { user_id: Number(myId), name: myDisplayName || 'You', avatar: user.profile_picture }
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
                      const sender = participants.find(p => p.name === messageUser);
                      const isMedia = item.message_type === 'image' || item.message_type === 'gif' || item.message_type === 'sticker';
                      const isSticker = item.message_type === 'sticker';
                      const isLottieSticker = item.message_type === 'lottie_sticker';

                      const emojiInfo = isOnlyEmojis(displayText);
                      const isEmojiOnly = emojiInfo.isOnly && !item.reply_to && !isMedia && !isLottieSticker;
                      const emojiFontSize = emojiInfo.count === 1 ? 36 : emojiInfo.count === 2 ? 30 : emojiInfo.count === 3 ? 26 : 22;
                      const emojiLineHeight = emojiFontSize + 8;

                      const replySender = item.reply_to ? participants.find(p => p.name === item.reply_to.user) : null;
                      const isMyReply = item.reply_to ? item.reply_to.user === (user?.display_name || user?.email) : false;
                      const replyAvatar = item.reply_to ? (isMyReply ? user?.profile_picture : replySender?.avatar) : null;

                      return (
                        <View style={[s.bubble, isMe && s.bubbleMe]}>
                          {showAvatar && (
                            <View style={[
                              { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
                              isMe ? { justifyContent: 'flex-end' } : {}
                            ]}>
                              {!isMe && (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <TouchableOpacity 
                                    style={{ position: 'relative', marginRight: 4 }}
                                    onPress={() => handleAvatarPress(sender?.avatar, sender?.avatar_sticker, messageUser)}
                                  >
                                    <AvatarWithFallback 
                                      uri={sender?.avatar} 
                                      displayName={messageUser} 
                                      sticker={sender?.avatar_sticker} 
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
                                    onPress={() => handleAvatarPress(user?.profile_picture, undefined, messageUser)}
                                  >
                                    <AvatarWithFallback 
                                      uri={user?.profile_picture} 
                                      displayName={messageUser} 
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
                        </View>
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
                    <View style={[s.mentionListContainer, isLight && { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }]}>
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
                  <View style={s.chatBar}>
                    <TouchableOpacity style={s.plusBtn} onPress={handleOpenGallery}>
                      <Icon name="add" size={24} color={isLight ? '#0284C7' : '#fffffff6'} />
                    </TouchableOpacity>
                    <View
                      style={[
                        s.inputWrapper,
                        { minHeight: 40 },
                        isLight && { backgroundColor: 'rgba(0,0,0,0.06)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }
                      ]}
                    >
                      <TouchableOpacity
                        style={s.innerStickerButton}
                        activeOpacity={0.7}
                        delayPressIn={0}
                        onPress={() => {
                          if (stickerPickerVisible) {
                            richInputRef.current?.blur();
                            Keyboard.dismiss();
                            setStickerPickerVisible(false);
                          } else {
                            richInputRef.current?.blur();
                            Keyboard.dismiss();
                            setStickerPickerVisible(true);
                          }
                        }}
                        accessibilityLabel="Toggle sticker picker"
                      >
                        <Icon
                          name={stickerPickerVisible ? "close-circle" : "sparkles-outline"}
                          size={22}
                          color={stickerPickerVisible ? "#8AB4F8" : (isLight ? '#64748B' : "rgba(255,255,255,0.6)")}
                        />
                      </TouchableOpacity>
                      <RichTextInput
                        ref={richInputRef}
                        onFocus={() => {
                          setStickerPickerVisible(false);
                        }}
                        style={[s.chatInput, { height: inputHeight, paddingLeft: 42 }, isLight && { color: '#0F172A' }]}
                        underlineColorAndroid="transparent"
                        onChangeText={handleTextChange}
                        onContentSizeChange={(e) => {
                          const h = e.nativeEvent?.contentSize?.height;
                          if (h) {
                            const next = Math.max(40, Math.min(150, Math.round(h)));
                            setInputHeight(prev => (Math.abs(prev - next) >= 4 ? next : prev));
                          }
                        }}
                        multiline
                        placeholder="Type a message..."
                        placeholderTextColor={themePlaceholderColor}
                        onContentCommitted={(event) => {
                          const { uri, mimeType } = event.nativeEvent;
                          Keyboard.dismiss();
                          setTimeout(() => { setStickerPreview({ uri, mimeType }); }, 100);
                        }}
                      />
                    </View>
                    <TouchableOpacity style={s.sendBtn} onPress={sendChatMessage} disabled={isSendingMedia}>
                      {isSendingMedia ? (
                        <ActivityIndicator size="small" color={isLight ? '#0284C7' : '#f5f5f5f6'} />
                      ) : (
                        <Icon name="send" size={18} color={isLight ? '#0284C7' : '#fffffff6'} />
                      )}
                    </TouchableOpacity>
                    {/* ── Mic Button ─────────────────────────────────── */}
                    <TouchableOpacity
                      style={[s.micBtn, isMicOn && s.micBtnActive]}
                      onPress={handleToggleMic}
                      activeOpacity={0.7}
                      accessibilityLabel={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
                    >
                      <Icon
                        name={isMicOn ? 'mic' : 'mic-off-outline'}
                        size={18}
                        color={isMicOn ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.55)')}
                      />
                    </TouchableOpacity>
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

                        {/* ─── ROOM THEME SELECTOR ─── */}
                        <View style={[s.themeSelectorCard, isLight && { backgroundColor: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)' }]}>
                          <Text style={[s.themeSectionLabel, isLight && { color: '#64748B' }]}>ROOM THEME</Text>
                          <View style={s.themePillsContainer}>
                            <TouchableOpacity
                              onPress={() => handleThemeChange('cinema')}
                              style={[s.themePill, isLight && { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.08)' }, roomTheme === 'cinema' && s.themePillActiveCinema]}
                              activeOpacity={0.75}
                            >
                              <Icon name="color-palette" size={13} color={roomTheme === 'cinema' ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.6)')} />
                              <Text style={[s.themePillText, isLight && { color: '#475569' }, roomTheme === 'cinema' && s.themePillTextActive]}>Cinema</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleThemeChange('rave')}
                              style={[s.themePill, isLight && { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.08)' }, roomTheme === 'rave' && s.themePillActiveRave]}
                              activeOpacity={0.75}
                            >
                              <Icon name="videocam" size={13} color={roomTheme === 'rave' ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.6)')} />
                              <Text style={[s.themePillText, isLight && { color: '#475569' }, roomTheme === 'rave' && s.themePillTextActive]}>Rave</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleThemeChange('dark')}
                              style={[s.themePill, isLight && { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.08)' }, roomTheme === 'dark' && s.themePillActiveDark]}
                              activeOpacity={0.75}
                            >
                              <Icon name="moon" size={13} color={roomTheme === 'dark' ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.6)')} />
                              <Text style={[s.themePillText, isLight && { color: '#475569' }, roomTheme === 'dark' && s.themePillTextActive]}>Dark</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleThemeChange('light')}
                              style={[s.themePill, isLight && { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.08)' }, roomTheme === 'light' && s.themePillActiveLight]}
                              activeOpacity={0.75}
                            >
                              <Icon name="sunny" size={13} color={roomTheme === 'light' ? '#0F172A' : (isLight ? '#64748B' : 'rgba(255,255,255,0.6)')} />
                              <Text style={[s.themePillText, isLight && { color: '#475569' }, roomTheme === 'light' && s.themePillTextLightActive]}>Light</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* ─── STREAM QUALITY SELECTOR ─── */}
                        {currentSong?.source !== 'drive' && (
                          <View style={[s.themeSelectorCard, isLight && { backgroundColor: 'rgba(0,0,0,0.04)', borderColor: 'rgba(0,0,0,0.08)' }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <Text style={[s.themeSectionLabel, { marginBottom: 0, marginLeft: 4 }, isLight && { color: '#64748B' }]}>
                                STREAM QUALITY
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4 }}>
                                <Icon name="pulse-outline" size={12} color="#10B981" />
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#10B981' }}>
                                  {liveExactResolution || (videoQuality === 'auto' ? 'Auto' : getMinimalQualityLabel(videoQuality))}
                                </Text>
                              </View>
                            </View>

                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingVertical: 2 }}
                            >
                              {dynamicQualityOptions.map((opt) => {
                                const isSelected = (videoQuality === opt.key) ||
                                  (videoQuality === 'highres' && opt.key === 'hd2160') ||
                                  (videoQuality === 'hd2160' && opt.key === 'highres');

                                return (
                                  <TouchableOpacity
                                    key={opt.key}
                                    onPress={() => handleSelectQuality(opt.key)}
                                    activeOpacity={0.75}
                                    style={[
                                      s.qualityPill,
                                      isLight && { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.08)' },
                                      isSelected && s.qualityPillActive,
                                    ]}
                                  >
                                    <Icon
                                      name={opt.icon || 'film'}
                                      size={13}
                                      color={isSelected ? '#fff' : (isLight ? '#64748B' : 'rgba(255,255,255,0.6)')}
                                    />
                                    <Text
                                      style={[
                                        s.themePillText,
                                        isLight && { color: '#475569' },
                                        isSelected && s.qualityPillTextActive,
                                      ]}
                                    >
                                      {opt.label}
                                    </Text>
                                    {opt.badge && (
                                      <View
                                        style={[
                                          s.qualityBadge,
                                          isSelected
                                            ? { backgroundColor: 'rgba(255,255,255,0.22)' }
                                            : (isLight ? { backgroundColor: 'rgba(0,0,0,0.08)' } : { backgroundColor: 'rgba(255,255,255,0.1)' }),
                                        ]}
                                      >
                                        <Text
                                          style={[
                                            s.qualityBadgeText,
                                            isSelected
                                              ? { color: '#ffffff' }
                                              : (isLight ? { color: '#64748B' } : { color: 'rgba(255,255,255,0.6)' }),
                                          ]}
                                        >
                                          {opt.badge}
                                        </Text>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}
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
            </View>
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
        <Modal visible={showDiscovery} animationType="none" onRequestClose={() => setShowDiscovery(false)}>
          <YouTubeDiscoveryScreen
            navigation={{
              goBack: () => setShowDiscovery(false),
              addListener: () => () => {},
              setOptions: () => {},
            } as any}
            route={{ params: { roomCode } } as any}
          />
        </Modal>

        {/* ── Lottie Sticker Picker Sheet (Always mounted, offscreen by default, 0ms GPU slide) ── */}
        <StickerPickerSheet
          visible={stickerPickerVisible}
          stickerPacks={BUILT_IN_STICKER_PACKS}
          onSelectSticker={(sticker) => sendLottieSticker(sticker)}
          onClose={() => setStickerPickerVisible(false)}
          sheetHeight={286}
        />

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
          participants={participants}
          isDJ={isDJ}
          allowedSpeakers={allowedSpeakers}
          onToggleMicPermission={(targetUserId, allow) => updateMicPermission(targetUserId, allow)}
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
    </View>
  );
};

// Styles
const s = StyleSheet.create({
  relatedOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', zIndex: 15 },
  relatedCloseBtn:   { position: 'absolute', top: 12, left: 12, zIndex: 60 },
  root:              { flex: 1, backgroundColor: '#000000', overflow: 'visible' },
  inner:             { flex: 1, backgroundColor: 'transparent' },
  loadingContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:       { color: '#fff', marginTop: 12 },
  header:            { height: 48, maxHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, justifyContent: 'space-between' },
  headerRight:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconBtn:     { padding: 6, position: 'relative' },
  badge:             { position: 'absolute', top: 2, right: 2, backgroundColor: '#4597f5f6', borderRadius: 9, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#000', paddingHorizontal: 2 },
  badgeText:         { color: '#fff', fontSize: 9, fontWeight: '800' },
  headerTitleContainer: { flex: 1, flexDirection: 'row', gap: 8, marginHorizontal: 8, alignItems: 'center' },
  headerTitleTouch:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 5 },
  headerTitleInput:  { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#4597f5f6', padding: 0 },
  headerTitleText:   { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5, padding: 0 },
  dot:               { width: 6, height: 6, borderRadius: 3 },
  videoWrap:         { width: '100%', height: VIDEO_HEIGHT, backgroundColor: '#000', position: 'relative', overflow: 'visible', zIndex: 20 },
  videoWrapFullscreen: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 99 },
  npBar:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'transparent' },
  npThumb:           { width: 50, height: 28, borderRadius: 3 },
  npThumbEmpty:      { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' },
  npTitle:           { color: '#fff', fontSize: 12, fontWeight: '600', lineHeight: 16 },
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
  msgContainerThem:  { backgroundColor: 'rgba(255, 255, 255, 0.12)', borderTopLeftRadius: 4 },
  msgContainerMe:    { backgroundColor: '#0284C7', borderTopRightRadius: 4 },
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
  chatInput:         { flex: 1, backgroundColor: 'transparent', paddingRight: 14, paddingTop: Platform.OS === 'ios' ? 8 : 6, paddingBottom: Platform.OS === 'ios' ? 8 : 6, minHeight: 40, maxHeight: 150, color: '#fff', fontSize: 16, textAlignVertical: 'top' },
  sendBtn:           { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  plusBtn:           { width: 34, height: 34, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  micBtn:            { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 3, backgroundColor: 'rgba(255,255,255,0.08)' },
  micBtnActive:      { backgroundColor: '#0284C7' },
  innerStickerButton: { position: 'absolute', left: 8, bottom: 4, width: 32, height: 32, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
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
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
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