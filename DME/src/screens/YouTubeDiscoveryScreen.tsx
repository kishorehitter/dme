/**
 * YouTubeDiscoveryScreen — MEDIA CENTER
 * - 4 Tabs: YouTube, Google Drive, Likes, History
 * - Drive: WebView approach (no OAuth, no API, no verification needed)
 * - Unified History/Likes management
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  StatusBar, Text, DeviceEventEmitter,
  TextInput, Keyboard, BackHandler,
  Platform, Dimensions, Image, FlatList, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { musicAPI } from '../services/api';
import Toast from 'react-native-toast-message';
import { pinNavBarColor } from '../utils/navBarPin';

import { checkGoogleDriveAuth } from '../utils/driveAuth';

const { width } = Dimensions.get('window');

type TabType = 'youtube' | 'drive' | 'likes' | 'history';

// Tracks which tab the selected video came from
// so we can emit the correct source in the event
let selectedSource: 'youtube' | 'drive' = 'youtube';

// Helper to check network connectivity
const checkNetwork = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      cache: 'no-store',
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
  title = 'No Internet Connection',
  message = 'YouTube Discovery requires an active internet connection to load videos, search, and access your media.',
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  title?: string;
  message?: string;
}) => (
  <View style={styles.offlineContainer}>
    <View style={styles.offlineCard}>
      <View style={styles.offlineIconContainer}>
        <Icon name="cloud-offline-outline" size={48} color="#fd0000" />
      </View>

      <Text style={styles.offlineTitle}>{title}</Text>
      <Text style={styles.offlineMessage}>{message}</Text>

      <View style={styles.troubleshootBox}>
        <Text style={styles.troubleshootHeader}>Troubleshooting Steps:</Text>

        <View style={styles.troubleshootItem}>
          <Icon name="wifi-outline" size={18} color="#555" style={styles.troubleshootIcon} />
          <Text style={styles.troubleshootText}>
            Check your Wi-Fi or cellular data connection.
          </Text>
        </View>

        <View style={styles.troubleshootItem}>
          <Icon name="airplane-outline" size={18} color="#555" style={styles.troubleshootIcon} />
          <Text style={styles.troubleshootText}>
            Ensure Airplane mode is turned off.
          </Text>
        </View>

        <View style={styles.troubleshootItem}>
          <Icon name="refresh-circle-outline" size={18} color="#555" style={styles.troubleshootIcon} />
          <Text style={styles.troubleshootText}>
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

const YouTubeDiscoveryScreen = ({ navigation, route }: any) => {
  const { roomCode, requireDriveAuth, pendingDriveVideo: initialPendingVideo } = route.params || {};
  const isFlow2 = !!roomCode;

  const youtubeWebViewRef = useRef<WebView>(null);
  const driveWebViewRef   = useRef<WebView>(null);
  const pendingDriveVideoRef = useRef<any>(initialPendingVideo || null);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab]       = useState<TabType>(requireDriveAuth ? 'drive' : 'youtube');
  const [roomName, setRoomName]         = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem]       = useState<any | null>(null);
  const [showOverlay, setShowOverlay]   = useState(false);

  // History / Likes
  const [history, setHistory]           = useState<any[]>([]);
  const [likes, setLikes]               = useState<any[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [likesQuery, setLikesQuery]     = useState('');

  const [ytQuery, setYtQuery]           = useState('');
  const [ytResults, setYtResults]       = useState<any[]>([]);
  const [isYtSearching, setIsYtSearching] = useState(false);

  // Offline & error state management
  const [isOffline, setIsOffline]       = useState(false);
  const [isRetrying, setIsRetrying]     = useState(false);
  const [ytError, setYtError]           = useState(false);
  const [driveError, setDriveError]     = useState(false);
  const [likesError, setLikesError]     = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const isNavigating = useRef(false);

  useEffect(() => {
    if (!showOverlay) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      setShowOverlay(false);
      return true;
    });
    return () => sub.remove();
  }, [showOverlay]);

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
    handleSearchYouTube('trending music videos');
    setIsRetrying(false);
  };

  useEffect(() => {
    isNavigating.current = false;
    loadInitialData();

    // Set the navigation bar to transparent so the edge-to-edge screen content naturally bleeds through it
    const unsubscribeFocus = navigation.addListener('focus', () => {
      pinNavBarColor('#00000000');
    });
    pinNavBarColor('#00000000');

    return () => {
      unsubscribeFocus();
    };
  }, [navigation]);

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
      handleSearchYouTube('trending music videos');
    } else if (activeTab === 'drive') {
      driveWebViewRef.current?.reload();
    }

    loadHistory();
    loadLikes();
    setIsRetrying(false);
  };

  const handleSearchYouTube = async (queryToSearch?: string) => {
    const q = queryToSearch || ytQuery;
    if (!q.trim()) return;
    Keyboard.dismiss();
    setIsYtSearching(true);
    try {
      const data = await musicAPI.searchYouTube(q, 15);
      if (data && data.items) {
        setYtResults(data.items);
        setYtError(false);
      } else {
        setYtResults([]);
      }
    } catch (e) {
      console.error('YouTube search failed', e);
      const online = await checkNetwork();
      if (!online) {
        setIsOffline(true);
        setYtError(true);
      }
    } finally {
      setIsYtSearching(false);
    }
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

  // ─── YouTube WebView — intercept video selection ───────────────────────────
  const handleYouTubeNavChange = (navState: any) => {
    const { url } = navState;
    const videoIdMatch =
      url.match(/[?&]v=([^&]+)/) ||
      url.match(/shorts\/([^?&/]+)/);

    if (videoIdMatch?.[1]) {
      selectedSource = 'youtube';
      setSelectedVideoId(videoIdMatch[1]);
      setSelectedItem(null); // URL parsing doesn't have an item object
      
      setShowOverlay(true);
      youtubeWebViewRef.current?.injectJavaScript(
        `window.location.href = "https://m.youtube.com"; true;`
      );
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
  const handleSelectMedia = async (item: any, source: 'youtube' | 'drive') => {
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
    setSelectedItem(item);
    if (source === 'youtube') {
      setSelectedVideoId(item.video_id || item.videoId);
    } else {
      setSelectedVideoId(item.video_id || item.id);
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

  // ─── Start new party (Flow 1) ──────────────────────────────────────────────
  const handleStartParty = async () => {
    if (!roomName.trim()) { alert('Please enter a party name'); return; }
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;

    let finalTitle = undefined;
    if (selectedSource === 'drive') {
      try {
        const res = await fetch(`https://drive.google.com/file/d/${selectedVideoId}/view`);
        const text = await res.text();
        const match = text.match(/<title>([^<]+)<\/title>/);
        if (match) {
          finalTitle = match[1].replace(' - Google Drive', '').trim();
        }
      } catch (e) {}
      if (!finalTitle) finalTitle = selectedItem?.title || 'Drive Video';
    } else {
      finalTitle = selectedItem?.title;
    }

    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initThumbnail = selectedSource === 'drive'
      ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w400`
      : selectedItem?.thumbnail;

    await new Promise(resolve => setTimeout(resolve, 50));

    DeviceEventEmitter.emit('open_music_room', {
      roomCode: newRoomCode,
      isDJMode: true,
      roomName: roomName,
      initialVideoId: selectedVideoId,
      initialSource: selectedSource,
      initialTitle: finalTitle,
      initialThumbnail: initThumbnail,
    });

    setTimeout(() => {
      if (typeof navigation.setOptions === 'function') {
        navigation.setOptions({ animationEnabled: false });
      }
      navigation.goBack();
    }, 150);

  };

  const handleAddToQueue = async () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;

    let finalTitle = undefined;
    if (selectedSource === 'drive') {
      try {
        const res = await fetch(`https://drive.google.com/file/d/${selectedVideoId}/view`);
        const text = await res.text();
        const match = text.match(/<title>([^<]+)<\/title>/);
        if (match) {
          finalTitle = match[1].replace(' - Google Drive', '').trim();
        }
      } catch (e) {}
      if (!finalTitle) finalTitle = selectedItem?.title || 'Drive Video';
    } else {
      finalTitle = selectedItem?.title;
    }

    navigation.goBack();

    setTimeout(() => {
      DeviceEventEmitter.emit('VIDEO_SELECTED', {
        roomCode,
        videoId: selectedVideoId,
        source:  selectedSource,
        title: finalTitle,
        thumbnail: selectedSource === 'drive' 
            ? `https://drive.google.com/thumbnail?id=${selectedVideoId}&sz=w400`  // ← real thumbnail
            : selectedItem?.thumbnail,
      });
    }, 800); // was 100ms
  };

  // ─── Grid item renderer (History & Likes & YouTube) ───────────────────────
  const renderGridItem = (
    { item }: { item: any },
    type: 'history' | 'likes' | 'youtube'
  ) => {
    const isDrive  = item.source === 'drive';
    let videoId = item.video_id || item.videoId;
    let thumb = item.thumbnail;
    let title = item.title;
    let channel = item.channel_title || item.channelTitle;
    let source = item.source || 'youtube';

    if (type === 'youtube' && item.id?.videoId) {
      videoId = item.id.videoId;
      title = item.snippet?.title;
      thumb = item.snippet?.thumbnails?.medium?.url;
      channel = item.snippet?.channelTitle;
    }

    if (isDrive && !thumb) {
      thumb = 'https://via.placeholder.com/150/000000/FFFFFF?text=Drive';
    }

    // We can't remove items from youtube search
    const canRemove = type === 'history' || type === 'likes';

    return (
      <View style={styles.gridItem}>
        <TouchableOpacity
          style={styles.gridItemClick}
          onPress={() => handleSelectMedia(
            type === 'youtube' ? { video_id: videoId, title, thumbnail: thumb, channel_title: channel } : item, 
            source
          )}
        >
          <Image source={{ uri: thumb }} style={styles.gridThumb} />
          <View style={styles.gridInfo}>
            <Text style={styles.gridTitle} numberOfLines={2}>
              {title}
            </Text>
            {type === 'youtube' && channel ? (
              <Text style={styles.gridSub}>
                {channel}
              </Text>
            ) : null}
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
            <Icon name="close-circle" size={20} color="rgba(255,255,255,0.4)" />
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
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

      {/* Premium soda glassy dark-blue background */}
      <LinearGradient
        colors={['#020912', '#050f1e', '#071524']}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Glassy blue top glow */}
      <LinearGradient
        colors={['rgba(0,120,255,0.13)', 'rgba(0,60,160,0.05)', 'transparent']}
        style={[StyleSheet.absoluteFillObject, { height: '55%' }]}
      />
      {/* Subtle cobalt bottom accent */}
      <LinearGradient
        colors={['transparent', 'rgba(0,80,200,0.07)']}
        style={[StyleSheet.absoluteFillObject, { top: '60%' }]}
      />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: (insets.top || 28) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Icon name="play-circle" size={18} color="#fd0000" style={{ marginRight: 6 }} />
          <Text style={styles.headerTitle}>Media Center</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Tab Selector Cards ── */}
      <View style={styles.tabCardRow}>
        {(['youtube', 'drive', 'likes', 'history'] as TabType[]).map((tab) => {
          const meta: Record<TabType, { icon: string; label: string; color: string }> = {
            youtube:  { icon: 'logo-youtube',  label: 'YouTube', color: '#FF3B3B' },
            drive:    { icon: 'logo-google',   label: 'Drive',   color: '#4DA3FF' },
            likes:    { icon: 'heart',         label: 'Likes',   color: '#FF6EB4' },
            history:  { icon: 'time',          label: 'History', color: '#FFBB45' },
          };
          const isActive = activeTab === tab;
          const m = meta[tab];
          return (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={styles.tabCard}
              activeOpacity={0.75}
            >
              {isActive ? (
                <LinearGradient
                  colors={['#1e1830', '#251a35']}
                  style={styles.tabCardInner}
                >
                  <View style={[styles.tabCardIconRing, { borderColor: m.color + '55', backgroundColor: m.color + '22' }]}>
                    <Icon name={m.icon} size={22} color={m.color} />
                  </View>
                  <Text style={[styles.tabCardLabel, { color: m.color }]}>{m.label}</Text>
                  <View style={[styles.tabCardDot, { backgroundColor: m.color }]} />
                </LinearGradient>
              ) : (
                <View style={[styles.tabCardInner, styles.tabCardInactive]}>
                  <View style={styles.tabCardIconRingOff}>
                    <Icon name={m.icon} size={20} color="rgba(255,255,255,0.3)" />
                  </View>
                  <Text style={styles.tabCardLabelOff}>{m.label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Content Card + Overlay wrapper (shared container for exact size match) ── */}
      <View style={[styles.cardWrapper, { marginBottom: 12 + (insets.bottom || 0) }]}>

        {/* Content Card */}
        <View style={styles.contentCard}>

          {/* YouTube Tab */}
          {activeTab === 'youtube' && (
            isOffline || ytError ? (
              <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
                title="Unable to Load YouTube"
                message="YouTube Discovery requires an active internet connection to load videos, search, and access media." />
            ) : (
              <WebView
                ref={youtubeWebViewRef}
                source={{ uri: 'https://m.youtube.com' }}
                onNavigationStateChange={handleYouTubeNavChange}
                onError={() => setYtError(true)}
                renderError={() => (
                  <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
                    title="Unable to Load YouTube"
                    message="Could not connect to YouTube. Please check your internet connection and try again." />
                )}
                setSupportMultipleWindows={false}
                onOpenWindow={(event) => {
                  youtubeWebViewRef.current?.injectJavaScript(
                    `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
                  );
                }}
                onShouldStartLoadWithRequest={(request) => {
                  const url = request.url;
                  const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/shorts\/([^?&/]+)/);
                  if (videoIdMatch?.[1]) { handleYouTubeNavChange({ url }); return false; }
                  return url.includes('youtube.com') || url.includes('google.com') ||
                    url.includes('googleapis.com') || url.includes('gstatic.com') ||
                    url.includes('accounts.google') || url.includes('about:blank');
                }}
                userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
                javaScriptEnabled={true}
                domStorageEnabled={true}
                thirdPartyCookiesEnabled={true}
                sharedCookiesEnabled={true}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                backgroundColor="#000"
                style={{ flex: 1, borderRadius: 20 }}
              />
          )
        )}

        {/* Drive Tab */}
        {activeTab === 'drive' && (
          isOffline || driveError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
              title="Unable to Load Google Drive"
              message="Google Drive requires an active internet connection to browse and select files." />
          ) : (
            <WebView
              ref={driveWebViewRef}
              source={{ uri: 'https://drive.google.com' }}
              onError={() => setDriveError(true)}
              renderError={() => (
                <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
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
              backgroundColor="#fff"
              style={styles.webview}
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
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
              title="Unable to Load Likes"
              message="Connect to the internet to view and sync your liked videos." />
          ) : (
            <View style={styles.listContent}>
              <View style={styles.searchBar}>
                <Icon name="search" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search liked videos..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
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
                    <Icon name="heart-outline" size={48} color="rgba(255,255,255,0.12)" />
                    <Text style={styles.emptyText}>No liked videos yet</Text>
                    <Text style={styles.emptySubText}>Videos you like will appear here</Text>
                  </View>
                }
              />
            </View>
          )
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          isOffline || historyError ? (
            <OfflineErrorView onRetry={handleRetry} isRetrying={isRetrying}
              title="Unable to Load Watch History"
              message="Connect to the internet to view and sync your watch history." />
          ) : (
            <View style={styles.listContent}>
              <View style={styles.searchBar}>
                <Icon name="search" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search watch history..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
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
                    <Icon name="time-outline" size={48} color="rgba(255,255,255,0.12)" />
                    <Text style={styles.emptyText}>No watch history yet</Text>
                    <Text style={styles.emptySubText}>Videos you watch will appear here</Text>
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
          <View style={styles.overlayBackdrop}>

            {/* Close button — always top-right, never moves */}
            <TouchableOpacity
              style={styles.overlayCloseBtn}
              onPress={() => { Keyboard.dismiss(); setShowOverlay(false); }}
            >
              <Icon name="close" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>

            {/* Source badge */}
            <View style={styles.overlaySourceRow}>
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

            <Text style={styles.overlayTitle}>Video Selected ✓</Text>
            <Text style={styles.overlaySubtitle}>
              {isFlow2 ? 'Add this video to the party queue?' : 'Give your room a name to start'}
            </Text>

            {/* Flow 1 — name & play */}
            {!isFlow2 && (
              <>
                <TextInput
                  style={styles.namingInput}
                  placeholder="Type the Room Name here.."
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={roomName}
                  onChangeText={setRoomName}
                  maxLength={25}
                  returnKeyType="done"
                  onSubmitEditing={handleStartParty}
                />
                <TouchableOpacity
                  style={[styles.overlayActionBtn, !roomName.trim() && { opacity: 0.35 }]}
                  onPress={handleStartParty}
                  disabled={!roomName.trim()}
                >
                  <LinearGradient
                    colors={['#b10000', '#FF007F']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.overlayActionBtnGrad}
                  >
                    <Icon name="play" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.overlayActionBtnText}>Start Watching</Text>
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

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020912' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },

  // Tab Cards
  tabCardRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 14, gap: 8,
  },
  tabCard: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  tabCardInner: {
    alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  tabCardInactive: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.06)' },
  tabCardIconRing: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center', marginBottom: 6,
  },
  tabCardIconRingOff: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 6,
  },
  tabCardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  tabCardLabelOff: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.28)' },
  tabCardDot: { width: 4, height: 4, borderRadius: 2, marginTop: 5 },

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
  gridThumb: { width: '100%', height: 96, backgroundColor: 'rgba(255,255,255,0.05)' },
  gridInfo: { padding: 8 },
  gridTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.88)', height: 32 },
  gridSub: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 3 },
  removeItem: { position: 'absolute', top: 5, right: 5, zIndex: 10 },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.3)', marginTop: 12 },
  emptySubText: { fontSize: 12, color: 'rgba(255,255,255,0.18)', marginTop: 4 },

  // Overlay — absoluteFillObject scoped inside cardWrapper, content anchored to top
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: '#050f1e',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    // Content anchored to top — never moves with keyboard
    justifyContent: 'flex-start',
    paddingHorizontal: 22,
    paddingTop: 48,
    paddingBottom: 24,
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
  overlayActionBtn: { borderRadius: 25, overflow: 'hidden', marginTop: 4 },
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