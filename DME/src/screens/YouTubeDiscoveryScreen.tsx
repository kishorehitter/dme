/**
 * YouTubeDiscoveryScreen — MEDIA CENTER
 * - 4 Tabs: YouTube, Google Drive, Likes, History
 * - Drive: WebView approach (no OAuth, no API, no verification needed)
 * - Unified History/Likes management
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  StatusBar, Text, DeviceEventEmitter,
  TextInput, Keyboard, BackHandler,
  Platform, Dimensions, Image, FlatList, ActivityIndicator,
  KeyboardAvoidingView, Animated, Easing, NativeModules, PanResponder,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { musicAPI } from '../services/api';
import Toast from 'react-native-toast-message';
import { pinNavBarColor } from '../utils/navBarPin';
import LottieStickerMessage from '../components/LottieStickerMessage';
import { useTheme } from '../context/ThemeContext';

import { checkGoogleDriveAuth } from '../utils/driveAuth';
import DiscoveryFeedService from '../services/DiscoveryFeedService';
import FastImage from 'react-native-fast-image';

const { width } = Dimensions.get('window');

type TabType = 'youtube' | 'drive' | 'likes' | 'history';

const TAB_META: Record<TabType, { icon: string; label: string; color: string }> = {
  youtube:  { icon: 'logo-youtube',  label: 'YouTube', color: '#FF3B3B' },
  drive:    { icon: 'logo-google',   label: 'Drive',   color: '#4DA3FF' },
  likes:    { icon: 'heart',         label: 'Likes',   color: '#FF6EB4' },
  history:  { icon: 'time',          label: 'History', color: '#FFBB45' },
};

// Tracks which tab the selected video came from
// so we can emit the correct source in the event
let selectedSource: 'youtube' | 'drive' = 'youtube';

export const YOUTUBE_CATEGORIES = [
  { id: 'trending', label: '🔥 Trending', query: 'trending' },
  { id: 'music', label: '🎵 Music', query: 'trending music' },
  { id: 'gaming', label: '🎮 Gaming', query: 'trending gaming' },
  { id: 'movies', label: '🎬 Movies', query: 'trending movie trailers' },
  { id: 'viral', label: '⚡ Viral', query: 'viral hits' },
  { id: 'lofi', label: '🎧 Lo-Fi', query: 'lo-fi beats' },
];

const OfflineErrorView = ({
  onRetry,
  isRetrying,
  isDark = false,
  title = 'Unable to Load Content',
  message = 'Something went wrong while loading. Please tap Try Again to reload.',
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  isDark?: boolean;
  title?: string;
  message?: string;
}) => (
  <View style={styles.offlineContainer}>
    <View style={[styles.offlineCard, {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
    }]}>
      <View style={styles.offlineIconContainer}>
        <Icon name="alert-circle-outline" size={44} color="#fd0000" />
      </View>

      <Text style={[styles.offlineTitle, { color: isDark ? '#fff' : '#111111' }]}>{title}</Text>
      <Text style={[styles.offlineMessage, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)' }]}>{message}</Text>

      <TouchableOpacity
        style={styles.retryBtnWrapper}
        onPress={onRetry}
        disabled={isRetrying}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={['#000000', '#fd0000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.retryBtn}
        >
          {isRetrying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Icon name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.retryBtnText}>Try Again</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  </View>
);

const DiscoBallLoadingView = ({ isDark = false, bgColor }: { isDark?: boolean; bgColor?: string }) => {
  return (
    <View style={[styles.loadingContainer, { backgroundColor: bgColor || (isDark ? '#0F0F0F' : '#FFFFFF') }]}>
      <View style={styles.glowBallWrapper}>
        <LottieStickerMessage
          url="https://fonts.gstatic.com/s/e/notoemoji/latest/1faa9/lottie.json"
          size={96}
          autoPlay={true}
        />
      </View>
    </View>
  );
};

const YouTubeDiscoveryScreen = ({ navigation, route }: any) => {
  const { theme, isDark } = useTheme();
  const { roomCode, requireDriveAuth, pendingDriveVideo: initialPendingVideo, initialUrl } = route.params || {};
  const isFlow2 = !!roomCode;

  // Only show splash when opened from Discovery button; skip completely when searching from Music Room
  const [showSplash, setShowSplash] = useState(!isFlow2);
  const splashFadeAnim = useRef(new Animated.Value(1)).current;

  const dismissSplash = useCallback(() => {
    Animated.timing(splashFadeAnim, {
      toValue: 0,
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start(() => {
      setShowSplash(false);
    });
  }, [splashFadeAnim]);

  useEffect(() => {
    if (isFlow2) {
      setShowSplash(false);
      return;
    }
    const timer = setTimeout(() => {
      dismissSplash();
    }, 1200);

    return () => clearTimeout(timer);
  }, [isFlow2, dismissSplash]);

  const youtubeWebViewRef = useRef<WebView>(null);
  const ytCanGoBackRef    = useRef(false);
  const driveWebViewRef   = useRef<WebView>(null);
  const pendingDriveVideoRef = useRef<any>(initialPendingVideo || null);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab]       = useState<TabType>(initialUrl ? 'youtube' : (requireDriveAuth ? 'drive' : 'youtube'));
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem]       = useState<any | null>(null);
  const [showOverlay, setShowOverlay]   = useState(false);
  const [isSelectingMedia, setIsSelectingMedia] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [touchingCardId, setTouchingCardId] = useState<string | null>(null);
  const selectedPlayingVideoIdRef = useRef<string | null>(null);

  // Helper to skip ad and stop background YouTube playback immediately
  const stopWebViewPlaybackAndSkip = useCallback(() => {
    try {
      youtubeWebViewRef.current?.injectJavaScript(`
        (function() {
          try {
            var skipBtn = document.querySelector('.ytp-ad-skip-button, .videoAdUiSkipButton, button.ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button, [class*="skip-button"]');
            if (skipBtn && typeof skipBtn.click === 'function') skipBtn.click();
            var vids = document.querySelectorAll('video');
            for (var i = 0; i < vids.length; i++) {
              vids[i].pause();
              vids[i].muted = true;
            }
          } catch(e) {}
        })(); true;
      `);
    } catch (e) {}
  }, []);

  // Guarantee native transparent status bar so dimmed overlays cover the status bar completely
  useFocusEffect(
    useCallback(() => {
      StatusBar.setTranslucent(true);
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#00000000', !isDark);
      }
      return () => {
        stopWebViewPlaybackAndSkip();
      };
    }, [stopWebViewPlaybackAndSkip, isDark])
  );

  useEffect(() => {
    StatusBar.setTranslucent(true);
    StatusBar.setBackgroundColor('transparent');
    if (Platform.OS === 'android' && NativeModules.SystemBar) {
      NativeModules.SystemBar.setStatusBarColor('#00000000', !isDark);
    }
  }, [isSelectingMedia, showOverlay, isDark]);

  // Stop background YouTube audio if user switches tabs away from YouTube
  useEffect(() => {
    if (activeTab !== 'youtube') {
      stopWebViewPlaybackAndSkip();
    }
  }, [activeTab, stopWebViewPlaybackAndSkip]);

  // Auto-recovery state for YouTube net::ERR_CONNECTION_RESET
  const ytRecoveryCount = useRef(0);
  const hasLoadedRef = useRef(false);

  const handleAutoRecover = useCallback(() => {
    if (hasLoadedRef.current) return;
    if (ytRecoveryCount.current >= 2) {
      setYtError(true);
      return;
    }
    ytRecoveryCount.current += 1;

    setTimeout(() => {
      youtubeWebViewRef.current?.reload();
    }, 600);
  }, []);

  useEffect(() => {
    if (initialUrl) {
      setActiveTab('youtube');
      hasLoadedRef.current = false;
      youtubeWebViewRef.current?.injectJavaScript(
        `if (window.location.href !== "${initialUrl}") { window.location.href = "${initialUrl}"; } true;`
      );
    }
  }, [initialUrl]);

  // Bottom tab bar
  const TABS: TabType[] = ['youtube', 'drive', 'likes', 'history'];

  function tabIndexFor(t: TabType): number {
    return TABS.indexOf(t);
  }

  const switchTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  // Dropdown state for tab selector
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownDimAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(dropdownDimAnim, {
      toValue: isDropdownOpen ? 1 : 0,
      duration: isDropdownOpen ? 220 : 180,
      useNativeDriver: true,
    }).start();
  }, [isDropdownOpen, dropdownDimAnim]);

  // Swipe Down gesture to Open dropdown
  const openPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy > 10 || gestureState.vy > 0.25) {
          setIsDropdownOpen(true);
        }
      },
    })
  ).current;

  // Swipe Up gesture to Close dropdown
  const closePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return gestureState.dy < -10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy < -10 || gestureState.vy < -0.25) {
          setIsDropdownOpen(false);
        }
      },
    })
  ).current;

  // History / Likes
  const [history, setHistory]           = useState<any[]>([]);
  const [likes, setLikes]               = useState<any[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [likesQuery, setLikesQuery]     = useState('');

  // Error state management
  const [isRetrying, setIsRetrying]     = useState(false);
  const [ytError, setYtError]           = useState(false);
  const [driveError, setDriveError]     = useState(false);
  const [likesError, setLikesError]     = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const isNavigating = useRef(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDropdownOpen) {
        setIsDropdownOpen(false);
        return true;
      }
      if (isSelectingMedia || showOverlay) {
        Keyboard.dismiss();
        setIsSelectingMedia(false);
        setShowOverlay(false);
        selectedPlayingVideoIdRef.current = null;
        stopWebViewPlaybackAndSkip();
        if (ytCanGoBackRef.current) {
          youtubeWebViewRef.current?.goBack();
        }
        return true;
      }
      if (activeTab === 'youtube' && ytCanGoBackRef.current) {
        youtubeWebViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [showOverlay, activeTab, isSelectingMedia, isDropdownOpen]);

  useEffect(() => {
    if (!showOverlay) {
      DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: null });
    }
  }, [showOverlay]);

  useEffect(() => {
    return () => {
      DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: null });
    };
  }, []);

  const loadInitialData = () => {
    setYtError(false);
    setDriveError(false);
    setLikesError(false);
    setHistoryError(false);

    loadHistory();
    loadLikes();
  };

  useEffect(() => {
    isNavigating.current = false;
    loadInitialData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor('#00000000', true);
    }, [])
  );

  const handleRetry = () => {
    setIsRetrying(true);
    hasLoadedRef.current = false;
    ytRecoveryCount.current = 0;
    setYtError(false);
    setDriveError(false);
    setLikesError(false);
    setHistoryError(false);

    if (activeTab === 'youtube') {
      youtubeWebViewRef.current?.reload();
    } else if (activeTab === 'drive') {
      driveWebViewRef.current?.reload();
    }

    loadHistory();
    loadLikes();
    setTimeout(() => {
      setIsRetrying(false);
    }, 600);
  };

  const loadHistory = async () => {
    try {
      const data = await musicAPI.getWatchHistory();
      setHistory(data);
      setHistoryError(false);
    } catch (e) {
      console.error('History load failed', e);
      setHistoryError(true);
    }
  };

  const loadLikes = async () => {
    try {
      const data = await musicAPI.getLikes();
      setLikes(data);
      setLikesError(false);
    } catch (e) {
      console.error('Likes load failed', e);
      setLikesError(true);
    }
  };

  // ─── YouTube Video Selection (Rave Architecture) ──────────────────────────
  const handleSelectYouTubeVideo = useCallback(async (vId: string, initialTitle?: string, thumb?: string, channel?: string) => {
    if (isSelectingMedia) return;
    setIsSelectingMedia(true);
    selectedPlayingVideoIdRef.current = vId;
    selectedSource = 'youtube';
    setSelectedVideoId(vId);
    setShowOverlay(true);

    // Command the YouTube WebView to navigate to watch page so the video & ads play in background at lowest volume
    try {
      youtubeWebViewRef.current?.injectJavaScript(`
        (function() {
          try {
            if (window.location.href.indexOf("${vId}") === -1) {
              window.location.href = "https://m.youtube.com/watch?v=${vId}";
            }
          } catch(e) {}
        })(); true;
      `);
    } catch (e) {}

    let resolvedTitle = (initialTitle || '').trim();
    let resolvedThumbnail = thumb || `https://img.youtube.com/vi/${vId}/hqdefault.jpg`;
    let resolvedChannel = (channel || 'YouTube').trim();

    // Fetch official metadata before showing the start watching overlay so the user never sees
    // a placeholder or title replacement jumping on the screen
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1600);

      const resp = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vId}&format=json`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        if (data?.title) {
          resolvedTitle = data.title;
        }
        if (data?.thumbnail_url) {
          resolvedThumbnail = data.thumbnail_url;
        }
        if (data?.author_name) {
          resolvedChannel = data.author_name;
        }
      }
    } catch (_e) {
      // Abort or network failure; continue with resolvedTitle
    }

    if (!resolvedTitle) {
      resolvedTitle = 'YouTube Video';
    }

    const clickedItem = {
      videoId: vId,
      video_id: vId,
      title: resolvedTitle,
      thumbnail: resolvedThumbnail,
      channelTitle: resolvedChannel,
    };

    setSelectedItem(clickedItem);
    DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: vId });
    setIsSelectingMedia(false);
  }, [isSelectingMedia]);

  const handleYouTubeMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'youtubeVideoClicked' && data.videoId) {
        DiscoveryFeedService.addVideos([{
          videoId: data.videoId,
          title: data.title || '',
          channelTitle: data.channelTitle || '',
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${data.videoId}/hqdefault.jpg`,
          addedBy: 'YouTube',
          source: 'youtube',
        }]);
        handleSelectYouTubeVideo(data.videoId, data.title, data.thumbnail, data.channelTitle);
      } else if (data.type === 'homeVideosExtracted' && Array.isArray(data.videos)) {
        DiscoveryFeedService.addVideos(data.videos);
      }
    } catch (e) {}
  }, [handleSelectYouTubeVideo]);

  const handleYouTubeNavChange = (_navState: any) => {
    // Navigation state changes should NEVER auto-select a video
    // Video selection is strictly driven by explicit user clicks on video cards
  };

  // ─── Drive WebView — intercept file selection ─────────────────────────────
  const handleDriveNavChange = (navState: any) => {
    const { url } = navState;
    console.log('DRIVE URL:', url);

    if (pendingDriveVideoRef.current && url.includes('drive.google.com/drive')) {
      const item = pendingDriveVideoRef.current;
      pendingDriveVideoRef.current = null;
      handleSelectMedia(item, 'drive');
      return;
    }

    // Pattern 1: /file/d/{fileId}/view  or  /file/d/{fileId}/edit
    // Pattern 2: open?id={fileId}
    const driveFileMatch =
      url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) ||
      url.match(/drive\.google\.com\/open\?id=([^&]+)/);

    if (driveFileMatch?.[1]) {
      const fileId = driveFileMatch[1];
      console.log('DRIVE FILE ID:', fileId);

      selectedSource = 'drive';
      setSelectedVideoId(fileId);
      setSelectedItem(null);
      
      setShowOverlay(true);

      // Send Drive back to home so user doesn't stay on file view
      driveWebViewRef.current?.injectJavaScript(
        `window.location.href = "https://drive.google.com"; true;`
      );
    }
  };

  // ─── History / Likes grid item selection ──────────────────────────────────
  const handleSelectMedia = async (item: any, source: 'youtube' | 'drive', skipAuthCheck: boolean = false) => {
    if (isSelectingMedia) return;
    setIsSelectingMedia(true);

    const targetVid = source === 'youtube' ? (item.video_id || item.videoId) : (item.video_id || item.id);
    setSelectedCardId(targetVid);
    selectedSource = source;
    setSelectedVideoId(targetVid);
    setSelectedItem(item);
    setShowOverlay(true);

    try {
      if (source === 'drive' && !skipAuthCheck) {
        const isAuth = await checkGoogleDriveAuth();
        if (!isAuth) {
          setShowOverlay(false);
          setSelectedVideoId(null);
          setSelectedCardId(null);
          pendingDriveVideoRef.current = item;
          setActiveTab('drive');
          Toast.show({
            type: 'info',
            text1: 'Sign in required',
            text2: 'Please sign in to Google Drive to play this video.',
          });
          return;
        }
      }

      if (targetVid && source === 'youtube') {
        DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: targetVid });
      }
    } catch (e) {
      console.error('Error selecting media:', e);
      setShowOverlay(false);
    } finally {
      setIsSelectingMedia(false);
      setSelectedCardId(null);
      setTouchingCardId(null);
    }
  };

  // ─── Remove items ──────────────────────────────────────────────────────────
  const removeHistoryItem = async (videoId: string, source: string) => {
    try {
      await musicAPI.deleteHistoryItem(videoId, source);
      setHistory(prev =>
        prev.filter(item => !(item.video_id === videoId && item.source === source))
      );
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Failed to remove' });
    }
  };

  const removeLikeItem = async (videoId: string, source: string) => {
    try {
      await musicAPI.removeLike(videoId, source);
      setLikes(prev =>
        prev.filter(item => !(item.video_id === videoId && item.source === source))
      );
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Failed to remove' });
    }
  };

  const [isStartingParty, setIsStartingParty] = useState(false);
  const [isPartyActionLoading, setIsPartyActionLoading] = useState(false);

  const handleStartParty = async () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;
    setIsStartingParty(true);

    // Skip/stop background WebView playback immediately
    stopWebViewPlaybackAndSkip();

    const finalTitle = selectedItem?.title || (selectedSource === 'drive' ? 'Drive Video' : '');
    const finalChannel = selectedItem?.channelTitle || selectedItem?.channel_title || (selectedSource === 'drive' ? 'Google Drive' : 'YouTube');
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w1280`
      : (selectedItem?.thumbnail
          ? selectedItem.thumbnail.replace(/\/(hqdefault|mqdefault|sddefault|default|hq720)\.(jpg|webp)/, '/maxresdefault.jpg').replace('http://', 'https://')
          : `https://i.ytimg.com/vi/${selectedVideoId}/maxresdefault.jpg`);

    if (initThumbnail) {
      FastImage.preload([{ uri: initThumbnail, priority: FastImage.priority.high }]);
    }

    DeviceEventEmitter.emit('open_music_room', {
      roomCode: newRoomCode,
      isDJMode: true,
      roomName: finalTitle,
      initialVideoId: selectedVideoId,
      initialSource: selectedSource,
      initialTitle: finalTitle,
      initialThumbnail: initThumbnail,
      initialChannelTitle: finalChannel,
    });

    if (typeof navigation?.setOptions === 'function') {
      navigation.setOptions({ animation: 'none' });
    }
    navigation?.goBack?.();
    setIsStartingParty(false);
  };

  const handleAddToQueue = async () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;

    // Skip/stop background WebView playback immediately
    stopWebViewPlaybackAndSkip();

    const finalTitle = selectedItem?.title || (selectedSource === 'drive' ? 'Drive Video' : '');
    const finalChannel = selectedItem?.channelTitle || selectedItem?.channel_title || (selectedSource === 'drive' ? 'Google Drive' : 'YouTube');
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w1280`
      : (selectedItem?.thumbnail
          ? selectedItem.thumbnail.replace(/\/(hqdefault|mqdefault|sddefault|default|hq720)\.(jpg|webp)/, '/maxresdefault.jpg').replace('http://', 'https://')
          : `https://i.ytimg.com/vi/${selectedVideoId}/maxresdefault.jpg`);

    if (initThumbnail) {
      FastImage.preload([{ uri: initThumbnail, priority: FastImage.priority.high }]);
    }

    setShowOverlay(false);
    Toast.show({
      type: 'success',
      text1: 'Added to Queue',
      text2: finalTitle || 'Video queued',
      visibilityTime: 2000,
    });

    DeviceEventEmitter.emit('VIDEO_SELECTED', {
      roomCode,
      videoId: selectedVideoId,
      source:  selectedSource,
      title: finalTitle,
      thumbnail: initThumbnail,
      channelTitle: finalChannel,
      isQueueOnly: true,
    });

    setTimeout(() => {
      isNavigating.current = false;
      setIsPartyActionLoading(false);
    }, 400);
  };

  const handlePlayNowInFlow2 = async () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;
    setIsPartyActionLoading(true);

    // Skip/stop background WebView playback immediately
    stopWebViewPlaybackAndSkip();

    const finalTitle = selectedItem?.title || (selectedSource === 'drive' ? 'Drive Video' : '');
    const finalChannel = selectedItem?.channelTitle || selectedItem?.channel_title || (selectedSource === 'drive' ? 'Google Drive' : 'YouTube');
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w1280`
      : (selectedItem?.thumbnail
          ? selectedItem.thumbnail.replace(/\/(hqdefault|mqdefault|sddefault|default|hq720)\.(jpg|webp)/, '/maxresdefault.jpg').replace('http://', 'https://')
          : `https://i.ytimg.com/vi/${selectedVideoId}/maxresdefault.jpg`);

    if (initThumbnail) {
      FastImage.preload([{ uri: initThumbnail, priority: FastImage.priority.high }]);
    }

    if (typeof navigation?.setOptions === 'function') {
      navigation.setOptions({ animation: 'none' });
    }
    navigation?.goBack?.();

    // Immediately dispatch selection without 200ms lag
    DeviceEventEmitter.emit('VIDEO_SELECTED', {
      roomCode,
      videoId: selectedVideoId,
      source:  selectedSource,
      title: finalTitle,
      thumbnail: initThumbnail,
      channelTitle: finalChannel,
      isQueueOnly: false,
    });
    setTimeout(() => {
      isNavigating.current = false;
      setIsPartyActionLoading(false);
    }, 400);
  };

  // ─── Grid item renderer (History & Likes & YouTube) ───────────────────────
  const renderGridItem = (
    { item }: { item: any },
    type: 'history' | 'likes' | 'youtube'
  ) => {
    const isDrive  = item.source === 'drive';
    let videoId = item.video_id || item.videoId || item.id?.videoId || (typeof item.id === 'string' ? item.id : '');
    let thumb = item.thumbnail || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.high?.url || '';
    let title = item.title || item.snippet?.title || '';
    let channel = item.channel_title || item.channelTitle || item.snippet?.channelTitle || '';
    let source = item.source || 'youtube';

    if (type === 'youtube') {
      if (item.id?.videoId) videoId = item.id.videoId;
      if (item.snippet?.title) title = item.snippet.title;
      if (item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.high?.url) {
        thumb = item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.high?.url;
      }
      if (item.snippet?.channelTitle) channel = item.snippet.channelTitle;
      if (!thumb && videoId) thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    if (isDrive && !thumb) {
      thumb = 'https://via.placeholder.com/150/000000/FFFFFF?text=Drive';
    }

    // We can't remove items from youtube search
    const canRemove = type === 'history' || type === 'likes';

    const isSpinnerActive = selectedCardId === videoId || touchingCardId === videoId;

    return (
      <View style={[styles.gridItem, {
        backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.03)',
        borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)',
      }]}>
        <TouchableOpacity
          style={styles.gridItemClick}
          disabled={isSelectingMedia || !!selectedCardId}
          activeOpacity={0.7}
          onPressIn={() => {
            // Spinner appears the EXACT millisecond touch down & dimming effect starts!
            setTouchingCardId(videoId);
          }}
          onPressOut={() => {
            // If user dragged to scroll instead of selecting, clear touch state after short debounce
            setTimeout(() => {
              setTouchingCardId(prev => (prev === videoId && selectedCardId !== videoId ? null : prev));
            }, 120);
          }}
          onPress={() => {
            const vid = videoId;
            setSelectedCardId(vid);
            setTouchingCardId(vid);
            handleSelectMedia(
              {
                ...item,
                videoId: vid,
                video_id: vid,
                title,
                thumbnail: thumb,
                channelTitle: channel,
                channel_title: channel,
                source,
              },
              source
            );
          }}
        >
          <View style={styles.gridThumb}>
            <Image source={{ uri: thumb }} style={styles.gridThumbImage} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.thumbGradient}
            />
            {isSpinnerActive && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }]}>
                <ActivityIndicator size="small" color="#FF007F" />
              </View>
            )}
            <View style={styles.thumbInfo}>
              <Text style={styles.thumbTitle} numberOfLines={2}>
                {title}
              </Text>
              {type === 'youtube' && channel ? (
                <Text style={styles.thumbSub}>
                  {channel}
                </Text>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
        {canRemove && (
          <TouchableOpacity
            style={styles.removeItem}
            onPress={() =>
              type === 'history'
                ? removeHistoryItem(videoId, source)
                : removeLikeItem(videoId, source)
            }
          >
            <View style={styles.removeBtnBg}>
              <Icon name="trash-outline" size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const filteredHistory = history.filter(item =>
    item.title?.toLowerCase().includes(historyQuery.toLowerCase()) ||
    item.channel_title?.toLowerCase().includes(historyQuery.toLowerCase())
  );

  const filteredLikes = likes.filter(item =>
    item.title?.toLowerCase().includes(likesQuery.toLowerCase()) ||
    item.channel_title?.toLowerCase().includes(likesQuery.toLowerCase())
  );


// ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF',
        },
      ]}
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={true}
      />

      {/* ── Content Card (full screen below status bar) ── */}
      <View
        style={[
          styles.cardWrapper,
          {
            flex: 1,
            marginTop: insets.top,
            marginBottom: activeTab === 'youtube' ? 0 : insets.bottom,
            marginHorizontal: 0,
          },
        ]}
      >

        {/* ── Center Curved Toggle Button (closed state with Swipe Down support) ── */}
        {!isDropdownOpen && (
          <View
            style={styles.topToggleHitZone}
            {...openPanResponder.panHandlers}
          >
            <TouchableOpacity
              style={[
                styles.centerCurvedBtn,
                {
                  backgroundColor: isDark ? 'rgba(20, 20, 25, 0.94)' : 'rgba(255, 255, 255, 0.96)',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
                },
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 16, left: 24, right: 24 }}
              onPress={() => setIsDropdownOpen(true)}
            >
              <Icon
                name="chevron-down"
                size={17}
                color={isDark ? '#FFF' : '#333'}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Single-Row Tabs Dropdown (open state with Swipe Up support) ── */}
        {isDropdownOpen && (
          <>
            <Animated.View
              style={[
                styles.dropdownBackdrop,
                {
                  opacity: dropdownDimAnim,
                  backgroundColor: isDark ? 'rgba(0, 0, 0, 0.50)' : 'rgba(0, 0, 0, 0.32)',
                },
              ]}
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setIsDropdownOpen(false)}
              />
            </Animated.View>
            <View
              style={[
                styles.floatingTabRowCard,
                {
                  backgroundColor: isDark ? 'rgba(18, 18, 22, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
                },
              ]}
              {...closePanResponder.panHandlers}
            >
              <View style={styles.topTabRow}>
                {TABS.map((tab) => {
                  const m = TAB_META[tab];
                  const isActive = activeTab === tab;
                  return (
                    <TouchableOpacity
                      key={tab}
                      style={[
                        styles.topTabBox,
                        { backgroundColor: isActive ? m.color + '22' : 'transparent' },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        switchTab(tab);
                        setIsDropdownOpen(false);
                      }}
                    >
                      <Icon
                        name={m.icon}
                        size={isActive ? 24 : 22}
                        color={isActive ? m.color : (isDark ? '#94A3B8' : '#64748B')}
                      />
                      <Text
                        style={[
                          styles.topTabLabel,
                          { color: isActive ? m.color : (isDark ? '#94A3B8' : '#64748B') },
                        ]}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Seamless Attached Semi-Rounded Close Button */}
              <TouchableOpacity
                style={[
                  styles.closeCurveHandle,
                  {
                    backgroundColor: isDark ? 'rgba(18, 18, 22, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
                  },
                ]}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 16, left: 24, right: 24 }}
                onPress={() => setIsDropdownOpen(false)}
              >
                {/* Seamless bridge mask: hides/removes the tab container border line right above the button */}
                <View
                  style={[
                    styles.handleBridgeMask,
                    { backgroundColor: isDark ? 'rgba(18, 18, 22, 0.96)' : 'rgba(255, 255, 255, 0.98)' },
                  ]}
                />
                <Icon
                  name="chevron-up"
                  size={16}
                  color={isDark ? '#FFF' : '#333'}
                />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Content Card (Full Screen Height below Notch) */}
        <View
          style={[
            styles.contentCard,
            {
              flex: 1,
              backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF',
              borderColor: 'transparent',
              marginHorizontal: 0,
              marginTop: 0,
              borderRadius: 0,
              borderWidth: 0,
            },
          ]}>

          {/* YouTube Tab — Mobile YouTube Interface (Rave Architecture) */}
          {activeTab === 'youtube' && (
            ytError ? (
              <OfflineErrorView
                onRetry={handleRetry}
                isRetrying={isRetrying}
                isDark={isDark}
                title="Unable to Load YouTube"
                message="Could not connect to YouTube. Tap Try Again to reload."
              />
            ) : (
              <WebView
                ref={youtubeWebViewRef}
                source={{ uri: initialUrl || 'https://m.youtube.com' }}
                onLoadEnd={() => {
                  hasLoadedRef.current = true;
                  ytRecoveryCount.current = 0;
                  dismissSplash();
                }}
                cacheMode="LOAD_DEFAULT"
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  if (!hasLoadedRef.current && (nativeEvent.code === -101 || nativeEvent.description?.includes('ERR_CONNECTION_RESET'))) {
                    handleAutoRecover();
                  } else if (!hasLoadedRef.current) {
                    setYtError(true);
                  }
                }}
                renderError={() => (
                  <OfflineErrorView
                    onRetry={handleRetry}
                    isRetrying={isRetrying}
                    isDark={isDark}
                    title="Unable to Load YouTube"
                    message="Could not connect to YouTube. Tap Try Again to reload."
                  />
                )}
                setSupportMultipleWindows={false}
                onOpenWindow={(event) => {
                  youtubeWebViewRef.current?.injectJavaScript(
                    `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
                  );
                }}
                onShouldStartLoadWithRequest={(request) => {
                  const url = request.url;
                  // Block deep links/external app intents so playback stays in WebView
                  if (url.startsWith('intent:') || url.startsWith('vnd.youtube:')) {
                    return false;
                  }
                  // Allow watch page to load so video & ads play inside WebView
                  if (url.includes('/watch') || url.includes('v=')) {
                    const videoMatch = url.match(/[?&]v=([^&]+)/) || url.match(/\/shorts\/([^/?#]+)/);
                    if (videoMatch?.[1] && selectedPlayingVideoIdRef.current !== videoMatch[1]) {
                      handleSelectYouTubeVideo(videoMatch[1]);
                    }
                    return true;
                  }
                  // Allow home, browse, trending, channel, and root shorts navigation
                  return true;
                }}
                userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
                javaScriptEnabled={true}
                domStorageEnabled={true}
                thirdPartyCookiesEnabled={true}
                sharedCookiesEnabled={true}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                style={{ flex: 1 }}
                injectedJavaScript={`
                  (function() {
                    function extractCardMeta(el, videoId) {
                      try {
                        var container = el.closest('ytm-compact-video-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-item-section-renderer, .compact-media-item, .media-item, [class*="media-item"]') || el;
                        var titleEl = container.querySelector('h3, h4, [class*="headline"], [class*="title"], .media-item-headline, .compact-media-item-headline');
                        var title = (titleEl ? (titleEl.innerText || titleEl.textContent) : '') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
                        title = title.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim();

                        var channelEl = container.querySelector('[class*="channel"], [class*="byline"], [class*="subhead"], [class*="subtitle"], ytm-badge-and-byline-renderer');
                        var channel = (channelEl ? (channelEl.innerText || channelEl.textContent) : '') || '';
                        channel = channel.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim();

                        var img = container.querySelector('img[src*="ytimg"], img[src*="googleusercontent"], img[src*="ggpht"], img');
                        var thumb = (img && img.src && !img.src.startsWith('data:')) ? img.src : ('https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg');

                        return { title: title, channelTitle: channel, thumbnail: thumb };
                      } catch(e) {
                        return { title: '', channelTitle: '', thumbnail: 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' };
                      }
                    }

                    document.addEventListener('click', function(e) {
                      // Only real user clicks - never automated/script clicks
                      if (!e.isTrusted) return;

                      var el = e.target.closest('a');
                      if (!el || !el.href) return;

                      // Never intercept clicks on bottom pivot bar (Home, Shorts, Subscriptions) or header
                      if (el.closest('ytm-pivot-bar-renderer, ytm-pivot-bar-item-renderer, .pivot-bar, ytm-app-bar-renderer, header')) {
                        return;
                      }

                      var href = el.href;
                      // Do not intercept root /shorts tab navigation
                      if (href.endsWith('/shorts') || href.endsWith('/shorts/')) {
                        return;
                      }

                      var m = href.match(/[?&]v=([^&]+)/) || href.match(/\\/shorts\\/([^/?#]+)/);
                      if (m && m[1]) {
                        // Only select if it came from an actual video card in the feed
                        var isCard = el.closest('ytm-compact-video-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-item-section-renderer, .compact-media-item, .media-item, [class*="media-item"]') || el.classList.contains('media-item-thumbnail-container');
                        if (isCard) {
                          e.preventDefault();
                          e.stopPropagation();
                          var meta = extractCardMeta(el, m[1]);
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'youtubeVideoClicked',
                            videoId: m[1],
                            title: meta.title,
                            channelTitle: meta.channelTitle,
                            thumbnail: meta.thumbnail
                          }));
                          // Immediately navigate to watch page so video and ads start playing in background at lowest volume
                          window.location.href = 'https://m.youtube.com/watch?v=' + m[1];
                        }
                      }
                    }, true);

                    function enforcePlaybackAndLowestVolume() {
                      try {
                        if (window.location.href.indexOf('/watch') !== -1 || window.location.href.indexOf('v=') !== -1) {
                          var vids = document.querySelectorAll('video');
                          for (var i = 0; i < vids.length; i++) {
                            var v = vids[i];
                            if (v) {
                              v.muted = false;
                              v.volume = 0.05;
                              if (v.paused) {
                                v.play().catch(function() {});
                              }
                            }
                          }
                          var unmuteBtn = document.querySelector('.ytp-unmute, .ytp-mute-button[title*="unmute" i], button[aria-label*="unmute" i]');
                          if (unmuteBtn && typeof unmuteBtn.click === 'function') unmuteBtn.click();
                          var bigPlayBtn = document.querySelector('.ytp-large-play-button, button.slim-video-action-bar-actions');
                          if (bigPlayBtn && typeof bigPlayBtn.click === 'function') bigPlayBtn.click();
                        }
                      } catch(e) {}
                    }
                    setInterval(enforcePlaybackAndLowestVolume, 300);

                    function harvestVideos() {
                      try {
                        var links = document.querySelectorAll('a[href*="/watch?v="], a[href*="v="], a[href*="/shorts/"]');
                        var found = [];
                        var seen = {};
                        for (var i = 0; i < links.length; i++) {
                          var a = links[i];
                          var href = a.href || a.getAttribute('href') || '';
                          var m = href.match(/[?&]v=([^&]+)/) || href.match(/\\/shorts\\/([^/?#]+)/);
                          if (!m || !m[1]) continue;
                          var vId = m[1];
                          if (seen[vId]) continue;
                          seen[vId] = true;

                          var meta = extractCardMeta(a, vId);
                          found.push({
                            videoId: vId,
                            title: meta.title || 'YouTube Video',
                            channelTitle: meta.channelTitle || 'YouTube',
                            thumbnail: meta.thumbnail,
                            source: 'youtube'
                          });
                        }
                        if (found.length > 0) {
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'homeVideosExtracted',
                            videos: found
                          }));
                        }
                      } catch(e) {}
                    }

                    function dismissConsent() {
                      try {
                        var consentBtn = document.querySelector('form[action*="consent"] button, button[aria-label*="Accept" i], button[aria-label*="Agree" i], .eom-button-accept button, ytm-consent-bump-renderer button, [aria-label*="Reject all" i], button.c-button');
                        if (consentBtn && typeof consentBtn.click === 'function') {
                          consentBtn.click();
                        }
                      } catch(e) {}
                    }

                    dismissConsent();
                    setTimeout(dismissConsent, 800);
                    setTimeout(dismissConsent, 2000);

                    setTimeout(harvestVideos, 1200);
                    setTimeout(harvestVideos, 2500);
                    setTimeout(harvestVideos, 5000);

                    window.addEventListener('scroll', function() {
                      if (window._harvestTimeout) clearTimeout(window._harvestTimeout);
                      window._harvestTimeout = setTimeout(harvestVideos, 800);
                    }, { passive: true });

                    try {
                      var harvestObs = new MutationObserver(function() {
                        if (window._harvestObsTimeout) clearTimeout(window._harvestObsTimeout);
                        window._harvestObsTimeout = setTimeout(harvestVideos, 1200);
                      });
                      harvestObs.observe(document.body, { childList: true, subtree: true });
                    } catch(e) {}
                  })(); true;
                `}
                onNavigationStateChange={(navState) => {
                  ytCanGoBackRef.current = navState.canGoBack;
                  handleYouTubeNavChange(navState);
                }}
                onMessage={handleYouTubeMessage}
              />
            )
          )}

        {/* Drive Tab */}
        {activeTab === 'drive' && (
          driveError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Google Drive"
              message="Could not connect to Google Drive. Tap Try Again to reload." />
          ) : (
            <WebView
              ref={driveWebViewRef}
              source={{ uri: 'https://drive.google.com' }}
              onLoadEnd={dismissSplash}
              renderError={() => (
                <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
                  title="Unable to Load Google Drive"
                  message="Could not connect to Google Drive. Tap Try Again to reload." />
              )}
              setSupportMultipleWindows={false}
              onOpenWindow={(event) => {
                driveWebViewRef.current?.injectJavaScript(
                  `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
                );
              }}
              onShouldStartLoadWithRequest={(request) => {
                const url = request.url;
                console.log('DRIVE REQUEST:', url);
                if (url.includes('google.com') || url.includes('googleapis.com') ||
                  url.includes('gstatic.com') || url.includes('accounts.google') ||
                  url.includes('about:blank')) return true;
                const isFile = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) ||
                  url.match(/drive\.google\.com\/open\?id=([^&]+)/);
                if (isFile) { handleDriveNavChange({ url }); return false; }
                return false;
              }}
              userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
              javaScriptEnabled={true}
              domStorageEnabled={true}
              thirdPartyCookiesEnabled={true}
              sharedCookiesEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              style={{ flex: 1, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' }}
              onNavigationStateChange={(navState) => handleDriveNavChange(navState)}
              onMessage={(event) => {
                try {
                  const msg = JSON.parse(event.nativeEvent.data);
                  if (msg.type === 'driveFileSelected' && msg.fileId) {
                    selectedSource = 'drive';
                    setSelectedVideoId(msg.fileId);
                    setShowOverlay(true);
                  } else if (msg.type === 'urlChange') {
                    handleDriveNavChange({ url: msg.url });
                  }
                } catch (e) {}
              }}
              injectedJavaScript={`
                (function() {
                  document.addEventListener('click', function(e) {
                    var el = e.target.closest('a');
                    if (el && el.target === '_blank') { e.preventDefault(); window.location.href = el.href; }
                  }, true);
                  function interceptDriveLinks() {
                    document.querySelectorAll('[data-id]').forEach(function(el) {
                      if (el._intercepted) return;
                      el._intercepted = true;
                      el.addEventListener('click', function(e) {
                        var id = el.getAttribute('data-id');
                        if (id) {
                          e.preventDefault(); e.stopPropagation();
                          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'driveFileSelected', fileId: id }));
                        }
                      });
                    });
                  }
                  interceptDriveLinks();
                  var obs = new MutationObserver(interceptDriveLinks);
                  obs.observe(document.body, { childList: true, subtree: true });
                })(); true;
              `}
            />
          )
        )}

        {/* Likes Tab */}
        {activeTab === 'likes' && (
          likesError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Likes"
              message="Connect to the internet to view and sync your liked videos." />
          ) : (
            <View style={[styles.listContent, { paddingTop: 6, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' }]}>
              <View style={[styles.searchBar, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
              }]}>
                <Icon name="search" size={16} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'} />
                <TextInput
                  style={[styles.searchInput, { color: isDark ? '#fff' : '#111' }]}
                  placeholder="Search liked videos..."
                  placeholderTextColor={isDark ? 'rgba(255, 255, 255, 0.38)' : 'rgba(0, 0, 0, 0.4)'}
                  value={likesQuery}
                  onChangeText={setLikesQuery}
                />
              </View>
              <FlatList
                data={filteredLikes}
                numColumns={2}
                keyExtractor={item => item.id.toString()}
                renderItem={item => renderGridItem(item, 'likes')}
                contentContainerStyle={styles.gridContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Icon name="heart-outline" size={48} color={isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'} />
                    <Text style={[styles.emptyText, { color: isDark ? '#fff' : '#111' }]}>No liked videos yet</Text>
                    <Text style={[styles.emptySubText, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)' }]}>Videos you like will appear here</Text>
                  </View>
                }
              />
            </View>
          )
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          historyError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Watch History"
              message="Connect to the internet to view and sync your watch history." />
          ) : (
            <View style={[styles.listContent, { paddingTop: 6, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' }]}>
              <View style={[styles.searchBar, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
              }]}>
                <Icon name="search" size={16} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'} />
                <TextInput
                  style={[styles.searchInput, { color: isDark ? '#fff' : '#111' }]}
                  placeholder="Search watch history..."
                  placeholderTextColor={isDark ? 'rgba(255, 255, 255, 0.38)' : 'rgba(0, 0, 0, 0.4)'}
                  value={historyQuery}
                  onChangeText={setHistoryQuery}
                />
              </View>
              <FlatList
                data={filteredHistory}
                numColumns={2}
                keyExtractor={item => item.id.toString()}
                renderItem={item => renderGridItem(item, 'history')}
                contentContainerStyle={styles.gridContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Icon name="time-outline" size={48} color={isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'} />
                    <Text style={[styles.emptyText, { color: isDark ? '#fff' : '#111' }]}>No watch history yet</Text>
                    <Text style={[styles.emptySubText, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)' }]}>Videos you watch will appear here</Text>
                  </View>
                }
              />
            </View>
          )
        )}

        </View>
        {/* end contentCard */}

      </View>
      {/* end cardWrapper */}

      {/* ── Overlay: Start Watching full-screen backdrop ── */}
      {showOverlay && selectedVideoId && (
        <View
          style={[
            styles.overlayBackdrop,
            {
              backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF',
              paddingTop: (insets.top || 0) + 24,
              paddingBottom: 24 + (activeTab === 'youtube' ? insets.bottom : 0),
            },
          ]}
        >

          {/* Close button — always top-right, below status bar */}
          <TouchableOpacity
            style={[
              styles.overlayCloseBtn,
              {
                top: (insets.top || 0) + 14,
                backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
              },
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setShowOverlay(false);
              setIsSelectingMedia(false);
              setIsStartingParty(false);
              setIsPartyActionLoading(false);
              setSelectedCardId(null);
              selectedPlayingVideoIdRef.current = null;
              stopWebViewPlaybackAndSkip();
              if (ytCanGoBackRef.current) {
                youtubeWebViewRef.current?.goBack();
              }
            }}
          >
            <Icon name="close" size={18} color={isDark ? '#ffffff' : '#111111'} />
          </TouchableOpacity>

          {isSelectingMedia && !selectedItem?.title ? (
            <View style={styles.overlayLoadingContainer}>
              <ActivityIndicator size="large" color="#FF007F" />
            </View>
          ) : (
            <>
              {/* Plain Brand Icon without badge container */}
              <View style={styles.overlayIconWrap}>
                <Icon
                  name={selectedSource === 'drive' ? 'logo-google' : 'logo-youtube'}
                  size={36}
                  color={selectedSource === 'drive' ? '#4285F4' : '#FF0000'}
                />
              </View>

              <Text style={[styles.overlayTitle, { color: isDark ? '#fff' : '#111' }]} numberOfLines={2}>
                {selectedItem?.title || 'YouTube Video'}
              </Text>
              <Text style={[styles.overlaySubtitle, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)' }]}>
                {isFlow2 ? 'Add this video to the lobby queue?' : 'Start a new lobby with this video!'}
              </Text>

              {/* Short Plain Text Note over the button */}
              {selectedSource === 'youtube' && (
                <View style={styles.skipAdPlainNoteRow}>
                  <Icon
                    name="play-forward"
                    size={11}
                    color={isDark ? '#FF6584' : '#E60067'}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.skipAdPlainNoteText, { color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)' }]}>
                    Auto-skips ads
                  </Text>
                </View>
              )}

              {/* Flow 1 — Start Watching (reduced size, clean horizontal button) */}
              {!isFlow2 && (
                <TouchableOpacity
                  style={[styles.overlayActionBtn, isStartingParty && { opacity: 0.7 }]}
                  onPress={handleStartParty}
                  disabled={isStartingParty}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#b10000', '#FF007F']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.overlayActionBtnGrad}
                  >
                    <View style={styles.actionBtnRow}>
                      {isStartingParty ? (
                        <ActivityIndicator size={16} color="#fff" style={{ marginRight: 6 }} />
                      ) : (
                        <Icon name="play" size={16} color="#fff" style={{ marginRight: 6 }} />
                      )}
                      <Text style={styles.overlayActionBtnText}>
                        {isStartingParty ? 'Preparing...' : 'Start Watching'}
                      </Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              {/* Flow 2 — Add to Queue / Play Now (reduced size, clean horizontal buttons) */}
              {isFlow2 && (
                <View style={styles.flow2BtnRow}>
                  <TouchableOpacity
                    style={[styles.overlayActionBtn, { flex: 1, marginTop: 0 }]}
                    onPress={handleAddToQueue}
                    disabled={isPartyActionLoading}
                  >
                    <LinearGradient
                      colors={['#1a6ef5', '#0d4ec7']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={styles.overlayActionBtnGrad}
                    >
                      <View style={styles.actionBtnRow}>
                        <Icon name="add-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
                        <Text style={styles.overlayActionBtnText}>Add to Queue</Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.overlayActionBtn, { flex: 1, marginTop: 0 }]}
                    onPress={handlePlayNowInFlow2}
                    disabled={isPartyActionLoading}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#b10000', '#FF007F']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={styles.overlayActionBtnGrad}
                    >
                      <View style={styles.actionBtnRow}>
                        {isPartyActionLoading ? (
                          <ActivityIndicator size={16} color="#fff" style={{ marginRight: 6 }} />
                        ) : (
                          <Icon name="play" size={16} color="#fff" style={{ marginRight: 6 }} />
                        )}
                        <Text style={styles.overlayActionBtnText}>
                          {isPartyActionLoading ? 'Starting...' : 'Play Now'}
                        </Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

        </View>
      )}

      {/* 2-Second Initial Splash Overlay that Fades Out Slowly */}
      {showSplash && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.splashOverlay,
            { opacity: splashFadeAnim, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF' },
          ]}
          pointerEvents="none"
        >
          <DiscoBallLoadingView isDark={isDark} bgColor={isDark ? '#0F0F0F' : '#FFFFFF'} />
        </Animated.View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  splashOverlay: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  glowBallWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerIconRing: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },

  // Center Curved Toggle Button (closed state)
  topToggleHitZone: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: 120,
    height: 42,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  centerCurvedBtn: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: 52,
    height: 26,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderWidth: 1,
    borderTopWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },

  // Floating Single-Row Tab Bar (open state)
  floatingTabRowCard: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    zIndex: 101,
    elevation: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    alignItems: 'center',
  },
  topTabRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  topTabBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 14,
    marginHorizontal: 4,
  },
  topTabLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  closeCurveHandle: {
    position: 'absolute',
    bottom: -25,
    alignSelf: 'center',
    width: 52,
    height: 26,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 102,
    elevation: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  handleBridgeMask: {
    position: 'absolute',
    top: -2,
    left: 0.5,
    right: 0.5,
    height: 3.5,
    zIndex: 10,
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
  },

  // Card wrapper — shared container for contentCard + overlay
  cardWrapper: {
    flex: 1,
    position: 'relative',
  },

  // Content Card (visual shell only — sizing comes from cardWrapper)
  contentCard: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: { flex: 1 },
  listContent: { flex: 1 },

  // Search bar (dark)
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 6, marginTop: 4, marginBottom: 6, paddingHorizontal: 12, height: 40,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: '#fff' },

  // Categories
  categoryRowWrapper: {
    paddingBottom: 8,
  },
  categoryScroll: {
    paddingHorizontal: 12,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Grid
  gridContent: { paddingHorizontal: 3, paddingTop: 2, paddingBottom: 28 },
  gridItem: {
    flex: 0.5, margin: 3,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    position: 'relative',
  },
  gridItemClick: { flex: 1 },
  gridThumb: {
    width: '100%', height: 104,
    backgroundColor: 'rgba(255,255,255,0.05)',
    position: 'relative',
    overflow: 'hidden',
  },
  gridThumbImage: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbGradient: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0, height: '55%',
  },
  thumbInfo: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 7, paddingVertical: 6,
    justifyContent: 'flex-end',
  },
  thumbTitle: {
    fontSize: 10, fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    lineHeight: 13,
  },
  thumbSub: {
    fontSize: 8, fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  removeItem: { position: 'absolute', top: 6, right: 6, zIndex: 10 },
  removeBtnBg: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.3)', marginTop: 12 },
  emptySubText: { fontSize: 12, color: 'rgba(255,255,255,0.18)', marginTop: 4 },

  // Overlay — full screen solid backdrop over playing video
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 50,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    padding: 24,
  },
  overlayLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  overlayCard: {
    // inner layout container — no background, overlay bg handles it
  },
  overlayHandle: { height: 0 },
  overlayCloseBtn: {
    position: 'absolute', top: 14, right: 14,
    padding: 6, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 10,
  },
  overlayIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  overlayTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    minHeight: 56,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 28,
  },
  overlaySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  namingInput: {
    width: '100%', height: 48,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, paddingHorizontal: 18,
    color: '#fff', fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 16,
  },
  skipAdPlainNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    alignSelf: 'center',
  },
  skipAdPlainNoteText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  overlayActionBtn: {
    borderRadius: 22,
    overflow: 'hidden',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 200,
    shadowColor: '#FF007F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  flow2BtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
  },
  overlayActionBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13.5,
    paddingHorizontal: 16,
    width: '100%',
  },
  actionBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayActionBtnText: {
    color: '#fff',
    fontSize: 14.5,
    fontWeight: '700',
  },

  // Offline View Styles
  offlineContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'transparent', padding: 20,
  },
  offlineCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 22, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  offlineIconContainer: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(253,0,0,0.12)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  offlineTitle: { fontSize: 19, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  offlineMessage: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 19, marginBottom: 20, paddingHorizontal: 8 },
  troubleshootBox: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14, padding: 14, marginBottom: 22,
  },
  troubleshootHeader: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)',
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  troubleshootItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  troubleshootIcon: { marginRight: 10, width: 20, textAlign: 'center' },
  troubleshootText: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 18 },
  retryBtnWrapper: { width: '100%', borderRadius: 25, overflow: 'hidden' },
  retryBtn: {
    height: 50, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
  },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default YouTubeDiscoveryScreen;
