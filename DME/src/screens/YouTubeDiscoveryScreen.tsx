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
  KeyboardAvoidingView, Animated, Easing, PanResponder,
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

// Helper to check network connectivity
const checkNetwork = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    // Note: 'cache' option is not supported in React Native fetch — omit it
    const response = await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok || response.status === 204;
  } catch (e) {
    return false;
  }
};

const OfflineErrorView = ({
  onRetry,
  isRetrying,
  isDark = true,
  title = 'No Internet Connection',
  message = 'YouTube Discovery requires an active internet connection to load videos, search, and access your media.',
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
        <Icon name="cloud-offline-outline" size={48} color="#fd0000" />
      </View>

      <Text style={[styles.offlineTitle, { color: isDark ? '#fff' : '#111111' }]}>{title}</Text>
      <Text style={[styles.offlineMessage, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)' }]}>{message}</Text>

      <View style={[styles.troubleshootBox, {
        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      }]}>
        <Text style={[styles.troubleshootHeader, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)' }]}>
          Troubleshooting Steps:
        </Text>

        <View style={styles.troubleshootItem}>
          <Icon name="wifi-outline" size={18} color={isDark ? '#888' : '#555'} style={styles.troubleshootIcon} />
          <Text style={[styles.troubleshootText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)' }]}>
            Check your Wi-Fi or cellular data connection.
          </Text>
        </View>

        <View style={styles.troubleshootItem}>
          <Icon name="airplane-outline" size={18} color={isDark ? '#888' : '#555'} style={styles.troubleshootIcon} />
          <Text style={[styles.troubleshootText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)' }]}>
            Ensure Airplane mode is turned off.
          </Text>
        </View>

        <View style={styles.troubleshootItem}>
          <Icon name="refresh-circle-outline" size={18} color={isDark ? '#888' : '#555'} style={styles.troubleshootIcon} />
          <Text style={[styles.troubleshootText, { color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)' }]}>
            Tap "Try Again" below once reconnected to network.
          </Text>
        </View>
      </View>

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

const DiscoBallLoadingView = ({ isDark = true, bgColor }: { isDark?: boolean; bgColor?: string }) => {
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
  const { roomCode, requireDriveAuth, pendingDriveVideo: initialPendingVideo } = route.params || {};
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

  const [activeTab, setActiveTab]       = useState<TabType>(requireDriveAuth ? 'drive' : 'youtube');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem]       = useState<any | null>(null);
  const [showOverlay, setShowOverlay]   = useState(false);

  // Bottom tab bar
  const TABS: TabType[] = ['youtube', 'drive', 'likes', 'history'];

  function tabIndexFor(t: TabType): number {
    return TABS.indexOf(t);
  }

  const switchTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  // Edge-to-edge toggle: swipe up expands content to full screen (hides header + tabs);
  // swipe down restores the chrome.
  const [hideChrome, setHideChrome] = useState(false);
  const panY = useRef(new Animated.Value(0)).current;
  const headerHeight = useRef(0);
  const chromeAnim = useRef(new Animated.Value(1)).current;

  const toggleChrome = useCallback((expand: boolean) => {
    if (hideChrome === expand) return;
    setHideChrome(expand);
    Animated.timing(chromeAnim, {
      toValue: expand ? 0 : 1,
      duration: 260,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [hideChrome, chromeAnim]);

  const CHROME_HEIGHT = 128;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => {
        const ne = e.nativeEvent as any;
        return Math.abs(ne.translationY || 0) < 6 && (ne.locationY || ne.y || 0) < 140;
      },
      onPanResponderGrant: () => { panY.setValue(0); },
      onPanResponderMove: (_, g) => {
        if (hideChrome && g.dy > 0) panY.setValue(g.dy);
        if (!hideChrome && g.dy < 0) panY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const threshold = CHROME_HEIGHT * 0.35;
        if (g.dy > threshold) {
          toggleChrome(true);
        } else if (g.dy < -threshold) {
          toggleChrome(false);
        }
        Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      },
    })
  ).current;

  // History / Likes
  const [history, setHistory]           = useState<any[]>([]);
  const [likes, setLikes]               = useState<any[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [likesQuery, setLikesQuery]     = useState('');

  // Offline & error state management
  const [isOffline, setIsOffline]       = useState(false);
  const [isRetrying, setIsRetrying]     = useState(false);
  const [ytError, setYtError]           = useState(false);
  const [driveError, setDriveError]     = useState(false);
  const [likesError, setLikesError]     = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const isNavigating = useRef(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showOverlay) {
        Keyboard.dismiss();
        setShowOverlay(false);
        return true;
      }
      if (activeTab === 'youtube' && ytCanGoBackRef.current) {
        youtubeWebViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [showOverlay, activeTab]);

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

  const loadInitialData = async () => {
    setIsRetrying(true);
    const online = await checkNetwork();
    if (!online) {
      setIsOffline(true);
      setIsRetrying(false);
      return;
    }
    setIsOffline(false);
    setYtError(false);
    setDriveError(false);
    setLikesError(false);
    setHistoryError(false);

    loadHistory();
    loadLikes();
    setIsRetrying(false);
  };

  useEffect(() => {
    isNavigating.current = false;
    loadInitialData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor('#00000000', isDark);
    }, [isDark])
  );

  const handleRetry = async () => {
    setIsRetrying(true);
    const online = await checkNetwork();
    if (!online) {
      Toast.show({
        type: 'error',
        text1: 'No Internet Connection',
        text2: 'Please connect to Wi-Fi or mobile data and try again.',
      });
      setIsOffline(true);
      setIsRetrying(false);
      return;
    }

    setIsOffline(false);
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
    setIsRetrying(false);
  };

  const loadHistory = async () => {
    try {
      const data = await musicAPI.getWatchHistory();
      setHistory(data);
      setHistoryError(false);
    } catch (e) {
      console.error('History load failed', e);
      const online = await checkNetwork();
      if (!online) {
        setHistoryError(true);
      }
    }
  };

  const loadLikes = async () => {
    try {
      const data = await musicAPI.getLikes();
      setLikes(data);
      setLikesError(false);
    } catch (e) {
      console.error('Likes load failed', e);
      const online = await checkNetwork();
      if (!online) {
        setLikesError(true);
      }
    }
  };

  // ─── YouTube Video Selection (Rave Architecture) ──────────────────────────
  const handleSelectYouTubeVideo = useCallback((vId: string, title?: string, thumb?: string, channel?: string) => {
    const clickedItem = {
      videoId: vId,
      video_id: vId,
      title: title || '',
      thumbnail: thumb || `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
      channelTitle: channel || 'YouTube',
    };

    selectedSource = 'youtube';
    setSelectedVideoId(vId);
    setSelectedItem(clickedItem);
    DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: vId });
    setShowOverlay(true);

    // Fast oEmbed lookup to obtain official title & author if needed
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vId}&format=json`)
      .then(r => r.json())
      .then(data => {
        if (data?.title) {
          setSelectedItem((prev: any) => (prev ? {
            ...prev,
            title: data.title,
            thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
            channelTitle: data.author_name || prev.channelTitle || 'YouTube',
          } : {
            videoId: vId,
            video_id: vId,
            title: data.title,
            thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
            channelTitle: data.author_name || 'YouTube',
          }));
        }
      })
      .catch(() => {});
  }, []);

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

  const handleYouTubeNavChange = (navState: any) => {
    const { url, title: navTitle } = navState;

    const videoIdMatch =
      url.match(/[?&]v=([^&]+)/) ||
      url.match(/shorts\/([^?&/]+)/);

    if (videoIdMatch?.[1]) {
      const vId = videoIdMatch[1];
      const cleanTitle = (navTitle && !navTitle.includes('m.youtube.com') && !navTitle.includes('YouTube') && !navTitle.startsWith('http'))
        ? navTitle.replace(/ - YouTube$/, '').trim()
        : '';

      handleSelectYouTubeVideo(vId, cleanTitle);
    }
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
    if (source === 'drive') {
      const isAuth = await checkGoogleDriveAuth();
      if (!isAuth) {
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

    selectedSource = source;
    const targetVid = source === 'youtube' ? (item.video_id || item.videoId) : (item.video_id || item.id);
    setSelectedVideoId(targetVid);
    setSelectedItem(item);
    if (targetVid && source === 'youtube') {
      DeviceEventEmitter.emit('PREVIEW_VIDEO', { videoId: targetVid });
    }
    
    setShowOverlay(true);
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

  const handleStartParty = async () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;
    setIsStartingParty(true);

    const finalTitle = selectedItem?.title || (selectedSource === 'drive' ? 'Drive Video' : '');
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w400`
      : (selectedItem?.thumbnail || `https://img.youtube.com/vi/${selectedVideoId}/hqdefault.jpg`);

    if (initThumbnail) {
      Image.prefetch(initThumbnail).catch(() => {});
    }

    DeviceEventEmitter.emit('open_music_room', {
      roomCode: newRoomCode,
      isDJMode: true,
      roomName: finalTitle,
      initialVideoId: selectedVideoId,
      initialSource: selectedSource,
      initialTitle: finalTitle,
      initialThumbnail: initThumbnail,
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

    const finalTitle = selectedItem?.title || (selectedSource === 'drive' ? 'Drive Video' : '');
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w400`
      : selectedItem?.thumbnail;

    if (typeof navigation?.setOptions === 'function') {
      navigation.setOptions({ animation: 'none' });
    }
    navigation?.goBack?.();

    setTimeout(() => {
      DeviceEventEmitter.emit('VIDEO_SELECTED', {
        roomCode,
        videoId: selectedVideoId,
        source:  selectedSource,
        title: finalTitle,
        thumbnail: initThumbnail,
      });
    }, 200);
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

    return (
      <View style={[styles.gridItem, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)' }]}>
        <TouchableOpacity
          style={styles.gridItemClick}
          onPress={() => handleSelectMedia(
            type === 'youtube' ? { video_id: videoId, videoId, title, thumbnail: thumb, channel_title: channel, channelTitle: channel } : item,
            source
          )}
        >
          <View style={styles.gridThumb}>
            <Image source={{ uri: thumb }} style={styles.gridThumbImage} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.thumbGradient}
            />
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
    <View style={[styles.container, { backgroundColor: isDark ? '#0F0F0F' : theme.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent={true} />

{/* ── Top Tab Bar ── */}
        <View style={[styles.topTabBar, { height: 64 + (insets.top || 28), paddingTop: (insets.top || 28) + 14 }]}>
          <View style={styles.topTabRow}>
            {TABS.map((tab) => {
              const m = TAB_META[tab];
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[
                    styles.topTabBox,
                    { backgroundColor: isActive ? m.color + '18' : 'transparent' },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => switchTab(tab)}
                >
                  <Icon
                    name={m.icon}
                    size={isActive ? 24 : 22}
                    color={isActive ? m.color : '#AAAAAA'}
                  />
                  <Text style={[styles.topTabLabel, { color: isActive ? m.color : '#999999' }]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

      {/* ── Content Card (full screen) ── */}
      <View style={[styles.cardWrapper, { flex: 1, marginBottom: 0 }]} {...(panResponder as any).panHandlers}>

        {/* Content Card */}
        <View style={[styles.contentCard, { flex: 1, backgroundColor: isDark ? '#0F0F0F' : '#FFFFFF', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', marginTop: (insets.top || 28) + 64, marginHorizontal: 0 }]}>

          {/* YouTube Tab — Mobile YouTube Interface (Rave Architecture) */}
          {activeTab === 'youtube' && (
            isOffline || ytError ? (
              <OfflineErrorView
                onRetry={handleRetry}
                isRetrying={isRetrying}
                isDark={isDark}
                title="Unable to Load YouTube"
                message="YouTube requires an active internet connection to browse and select videos."
              />
            ) : (
              <WebView
                ref={youtubeWebViewRef}
                source={{ uri: 'https://m.youtube.com' }}
                onLoadEnd={dismissSplash}
                onError={() => {
                  dismissSplash();
                  setYtError(true);
                }}
                renderError={() => (
                  <OfflineErrorView
                    onRetry={handleRetry}
                    isRetrying={isRetrying}
                    isDark={isDark}
                    title="Unable to Load YouTube"
                    message="Could not connect to YouTube. Please check your internet connection and try again."
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
                  const videoMatch = url.match(/[?&]v=([^&]+)/) || url.match(/\/shorts\/([^/?#]+)/);
                  if (videoMatch?.[1]) {
                    handleSelectYouTubeVideo(videoMatch[1]);
                    return false;
                  }
                  return true;
                }}
                userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
                javaScriptEnabled={true}
                domStorageEnabled={true}
                thirdPartyCookiesEnabled={true}
                sharedCookiesEnabled={true}
                allowsInlineMediaPlayback={false}
                mediaPlaybackRequiresUserAction={true}
                style={{ flex: 1, backgroundColor: isDark ? "#0F0F0F" : "#FFFFFF" }}
                injectedJavaScript={`
                  (function() {
                    function extractCardMeta(el, videoId) {
                      try {
                        var container = el.closest('ytm-compact-video-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-item-section-renderer, .compact-media-item, .media-item, [class*="media-item"]') || el;
                        var titleEl = container.querySelector('h3, h4, [class*="headline"], [class*="title"], .media-item-headline');
                        var title = (titleEl ? titleEl.textContent : '') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
                        title = title.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim();

                        var channelEl = container.querySelector('[class*="channel"], [class*="byline"], [class*="subhead"], [class*="subtitle"], ytm-badge-and-byline-renderer');
                        var channel = (channelEl ? channelEl.textContent : '') || '';
                        channel = channel.replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim();

                        var img = container.querySelector('img[src*="ytimg"], img[src*="googleusercontent"], img[src*="ggpht"], img');
                        var thumb = (img && img.src && !img.src.startsWith('data:')) ? img.src : ('https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg');

                        return { title: title, channelTitle: channel, thumbnail: thumb };
                      } catch(e) {
                        return { title: '', channelTitle: '', thumbnail: 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' };
                      }
                    }

                    function checkUrl(url) {
                      if (!url) return;
                      var m = url.match(/[?&]v=([^&]+)/) || url.match(/\\/shorts\\/([^/?#]+)/);
                      if (m && m[1]) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                          type: 'youtubeVideoClicked',
                          videoId: m[1]
                        }));
                      }
                    }

                    document.addEventListener('click', function(e) {
                      var el = e.target.closest('a');
                      if (el && el.href) {
                        var m = el.href.match(/[?&]v=([^&]+)/) || el.href.match(/\\/shorts\\/([^/?#]+)/);
                        if (m && m[1]) {
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
                        }
                      }
                    }, true);

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

                    setTimeout(harvestVideos, 1500);
                    setTimeout(harvestVideos, 3500);
                    setTimeout(harvestVideos, 6000);
                    window.addEventListener('scroll', function() {
                      if (window._harvestTimeout) clearTimeout(window._harvestTimeout);
                      window._harvestTimeout = setTimeout(harvestVideos, 1200);
                    }, { passive: true });

                    var origPush = history.pushState;
                    history.pushState = function() {
                      origPush.apply(this, arguments);
                      checkUrl(location.href);
                    };
                    var origReplace = history.replaceState;
                    history.replaceState = function() {
                      origReplace.apply(this, arguments);
                      checkUrl(location.href);
                    };
                    window.addEventListener('popstate', function() {
                      checkUrl(location.href);
                    });
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
          isOffline || driveError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Google Drive"
              message="Google Drive requires an active internet connection to browse and select files." />
          ) : (
            <WebView
              ref={driveWebViewRef}
              source={{ uri: 'https://drive.google.com' }}
              onLoadEnd={dismissSplash}
              onError={() => {
                dismissSplash();
                setDriveError(true);
              }}
              renderError={() => (
                <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
                  title="Unable to Load Google Drive"
                  message="Could not connect to Google Drive. Please check your internet connection and try again." />
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
              style={{ flex: 1, backgroundColor: isDark ? "#121212" : "#FFFFFF" }}
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
          isOffline || likesError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Likes"
              message="Connect to the internet to view and sync your liked videos." />
          ) : (
            <View style={styles.listContent}>
              <View style={[styles.searchBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                <Icon name="search" size={16} color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)"} />
                <TextInput
                  style={[styles.searchInput, { color: theme.textPrimary }]}
                  placeholder="Search liked videos..."
                  placeholderTextColor={isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.4)"}
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
                    <Icon name="heart-outline" size={48} color={isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No liked videos yet</Text>
                    <Text style={[styles.emptySubText, { color: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)" }]}>Videos you like will appear here</Text>
                  </View>
                }
              />
            </View>
          )
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          isOffline || historyError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying} isDark={isDark}
              title="Unable to Load Watch History"
              message="Connect to the internet to view and sync your watch history." />
          ) : (
            <View style={styles.listContent}>
              <View style={[styles.searchBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                <Icon name="search" size={16} color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)"} />
                <TextInput
                  style={[styles.searchInput, { color: theme.textPrimary }]}
                  placeholder="Search watch history..."
                  placeholderTextColor={isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.4)"}
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
                    <Icon name="time-outline" size={48} color={isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No watch history yet</Text>
                    <Text style={[styles.emptySubText, { color: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)" }]}>Videos you watch will appear here</Text>
                  </View>
                }
              />
            </View>
          )
        )}

        </View>
        {/* end contentCard */}

        {/* ── Overlay: absoluteFillObject inside cardWrapper = exact card size ── */}
        {showOverlay && selectedVideoId && (
          <View style={[styles.overlayBackdrop, { backgroundColor: isDark ? '#121212' : '#FFFFFF', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>

            {/* Close button — always top-right, never moves */}
            <TouchableOpacity
              style={[styles.overlayCloseBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
              onPress={() => { Keyboard.dismiss(); setShowOverlay(false); }}
            >
              <Icon name="close" size={18} color={isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)"} />
            </TouchableOpacity>

            {/* Source badge */}
            <View style={[styles.overlaySourceRow, { justifyContent: 'center' }]}>
              <View style={[
                styles.overlaySourceBadge,
                { backgroundColor: selectedSource === 'drive' ? '#4285F418' : '#FF000018',
                  borderColor:      selectedSource === 'drive' ? '#4285F455' : '#FF000055' }
              ]}>
                <Icon
                  name={selectedSource === 'drive' ? 'logo-google' : 'logo-youtube'}
                  size={14}
                  color={selectedSource === 'drive' ? '#4DA3FF' : '#FF4444'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.overlaySourceLabel, { color: selectedSource === 'drive' ? '#4DA3FF' : '#FF5555' }]}>
                  {selectedSource === 'drive' ? 'Google Drive' : 'YouTube'}
                </Text>
              </View>
            </View>

            <Text style={[styles.overlayTitle, { textAlign: 'center', color: theme.textPrimary }]} numberOfLines={2}>
              {selectedItem?.title || 'Video Selected ✓'}
            </Text>
            <Text style={[styles.overlaySubtitle, { textAlign: 'center', color: theme.textSecondary }]}>
              {isFlow2 ? 'Add this video to the party queue?' : 'Start a new watch party with this video!'}
            </Text>

            {/* Flow 1 — name & play */}
            {!isFlow2 && (
              <>
                <TouchableOpacity
                  style={[styles.overlayActionBtn, isStartingParty && { opacity: 0.7 }]}
                  onPress={handleStartParty}
                  disabled={isStartingParty}
                >
                  <LinearGradient
                    colors={['#b10000', '#FF007F']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.overlayActionBtnGrad}
                  >
                    {isStartingParty ? (
                      <ActivityIndicator size={18} color="#fff" style={{ marginRight: 8 }} />
                    ) : (
                      <Icon name="play" size={18} color="#fff" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.overlayActionBtnText}>{isStartingParty ? 'Preparing...' : 'Start Watching'}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {/* Flow 2 — add to queue */}
            {isFlow2 && (
              <TouchableOpacity style={styles.overlayActionBtn} onPress={handleAddToQueue}>
                <LinearGradient
                  colors={['#1a6ef5', '#0d4ec7']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.overlayActionBtnGrad}
                >
                  <Icon name="add-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.overlayActionBtnText}>Add to Queue</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

          </View>
        )}

      </View>
      {/* end cardWrapper */}

      {/* 2-Second Initial Splash Overlay that Fades Out Slowly */}
      {showSplash && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.splashOverlay,
            { opacity: splashFadeAnim, backgroundColor: isDark ? '#0F0F0F' : theme.background },
          ]}
          pointerEvents="none"
        >
          <DiscoBallLoadingView isDark={isDark} bgColor={isDark ? '#0F0F0F' : theme.background} />
        </Animated.View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020912' },
  splashOverlay: {
    backgroundColor: '#020912',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#020912',
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

  // Top Tab Bar
  topTabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute', top: 0, left: 0, right: 0,
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#FFFFFF',
    zIndex: 60,
    height: 64,
    paddingTop: 8,
    paddingBottom: 8,
  },
  topTabRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  topTabBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    marginHorizontal: 6,
    overflow: 'hidden',
  },
  topTabLabel: { fontSize: 11, fontWeight: '700', color: '#999999' },

  // Card wrapper — shared container for contentCard + overlay
  cardWrapper: {
    flex: 1,
    marginHorizontal: 12,
    position: 'relative',
  },

  // Content Card (visual shell only — sizing comes from cardWrapper)
  contentCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  webview: { flex: 1 },
  listContent: { flex: 1 },

  // Search bar (dark)
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    margin: 12, paddingHorizontal: 14, height: 42,
    borderRadius: 21, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
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
  gridContent: { padding: 8 },
  gridItem: {
    flex: 0.5, margin: 5,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    position: 'relative',
  },
  gridItemClick: { flex: 1 },
  gridThumb: {
    width: '100%', height: 96,
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

  // Overlay — absoluteFillObject scoped inside cardWrapper, content anchored to top
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: '#121212',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    padding: 24,
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
  overlaySourceRow: { flexDirection: 'row', marginBottom: 12 },
  overlaySourceBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  overlaySourceLabel: { fontSize: 13, fontWeight: '600' },
  overlayTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 6 },
  overlaySubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 },
  namingInput: {
    width: '100%', height: 48,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, paddingHorizontal: 18,
    color: '#fff', fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 16,
  },
  overlayActionBtn: { borderRadius: 25, overflow: 'hidden', marginTop: 4, alignSelf: 'center' },
  overlayActionBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, paddingHorizontal: 24,
  },
  overlayActionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

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
