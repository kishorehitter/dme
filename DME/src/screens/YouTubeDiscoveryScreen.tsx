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
  TextInput, Keyboard, KeyboardAvoidingView,
  Platform, Dimensions, Image, FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { musicAPI } from '../services/api';
import Toast from 'react-native-toast-message';

const { width } = Dimensions.get('window');

type TabType = 'youtube' | 'drive' | 'likes' | 'history';

// Tracks which tab the selected video came from
// so we can emit the correct source in the event
let selectedSource: 'youtube' | 'drive' = 'youtube';

const YouTubeDiscoveryScreen = ({ navigation, route }: any) => {
  const { roomCode } = route.params || {};
  const isFlow2 = !!roomCode;

  const youtubeWebViewRef = useRef<WebView>(null);
  const driveWebViewRef   = useRef<WebView>(null);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab]       = useState<TabType>('youtube');
  const [roomName, setRoomName]         = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay]   = useState(false);

  // History / Likes
  const [history, setHistory]           = useState<any[]>([]);
  const [likes, setLikes]               = useState<any[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [likesQuery, setLikesQuery]     = useState('');

  const isNavigating = useRef(false);

  // ─── Load history & likes on mount ────────────────────────────────────────
  useEffect(() => {
    isNavigating.current = false;
    loadHistory();
    loadLikes();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await musicAPI.getWatchHistory();
      setHistory(data);
    } catch (e) {
      console.error('History load failed', e);
    }
  };

  const loadLikes = async () => {
    try {
      const data = await musicAPI.getLikes();
      setLikes(data);
    } catch (e) {
      console.error('Likes load failed', e);
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
      setShowOverlay(true);

      // Send Drive back to home so user doesn't stay on file view
      driveWebViewRef.current?.injectJavaScript(
        `window.location.href = "https://drive.google.com"; true;`
      );
    }
  };

  // ─── History / Likes grid item selection ──────────────────────────────────
  const handleSelectMedia = (item: any, source: 'youtube' | 'drive') => {
    selectedSource = source;
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
  const handleStartParty = () => {
    if (!roomName.trim()) { alert('Please enter a party name'); return; }
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;

    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigation.replace('MusicRoom', {
      roomCode: newRoomCode,
      isDJMode: true,
      roomName: roomName,
    });

    // Increase delay to 800ms to give WS time to connect
    setTimeout(() => {
      DeviceEventEmitter.emit('VIDEO_SELECTED', {
        roomCode: newRoomCode,
        videoId:  selectedVideoId,
        source:   selectedSource,
      });
    }, 800); // was 100ms
  };

  const handleAddToQueue = () => {
    if (!selectedVideoId) return;
    if (isNavigating.current) return;
    isNavigating.current = true;

    navigation.goBack();

    setTimeout(() => {
      DeviceEventEmitter.emit('VIDEO_SELECTED', {
        roomCode,
        videoId: selectedVideoId,
        source:  selectedSource,
      });
    }, 800); // was 100ms
  };

  // ─── Grid item renderer (History & Likes) ─────────────────────────────────
  const renderGridItem = (
    { item }: { item: any },
    type: 'history' | 'likes'
  ) => {
    const isDrive  = item.source === 'drive';
    const thumb    = isDrive
      ? (item.thumbnail || 'https://via.placeholder.com/150/000000/FFFFFF?text=Drive')
      : item.thumbnail;
    const videoId  = item.video_id;
    const source   = item.source || 'youtube';

    return (
      <View style={styles.gridItem}>
        <TouchableOpacity
          style={styles.gridItemClick}
          onPress={() => handleSelectMedia(item, source)}
        >
          <Image source={{ uri: thumb }} style={styles.gridThumb} />
          <View style={styles.gridInfo}>
            <Text style={styles.gridTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.gridSub}>
              {item.channel_title || (isDrive ? 'Google Drive' : '')}
            </Text>
          </View>
        </TouchableOpacity>
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

  // ─── Overlay thumbnail ─────────────────────────────────────────────────────
  const overlayThumb = selectedSource === 'drive'
    ? 'https://via.placeholder.com/800x450/1a1a2e/FFFFFF?text=Google+Drive+Video'
    : `https://img.youtube.com/vi/${selectedVideoId}/hqdefault.jpg`;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <View style={[styles.mainContent, { paddingTop: insets.top || 30 }]}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Media Center</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {(['youtube', 'drive', 'likes', 'history'] as TabType[]).map((tab) => {
            const icons: Record<TabType, string> = {
              youtube:  'logo-youtube',
              drive:    'logo-google',
              likes:    'heart',
              history:  'time',
            };
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tab, activeTab === tab && styles.activeTab]}
              >
                <Icon
                  name={icons[tab]}
                  size={16}
                  color={activeTab === tab ? '#fff' : '#666'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Content Area */}
        <View style={styles.contentArea}>

          {/* YouTube Tab */}
          {activeTab === 'youtube' && (
            <WebView
              ref={youtubeWebViewRef}
              source={{ uri: 'https://m.youtube.com' }}
              onNavigationStateChange={handleYouTubeNavChange}
              style={styles.webview}
              userAgent="Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36"
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback={true}
              javaScriptEnabled={true}
              backgroundColor="#000"
            />
          )}

          {/* Drive Tab — WebView approach, no OAuth needed */}
          {activeTab === 'drive' && (
            <WebView
              ref={driveWebViewRef}
              source={{ uri: 'https://drive.google.com' }}
              onNavigationStateChange={(navState) => {
                console.log('DRIVE NAV:', navState.url);
                handleDriveNavChange(navState);
              }}
              onShouldStartLoadWithRequest={(request) => {
                console.log('DRIVE LOAD REQUEST:', request.url);
                handleDriveNavChange({ url: request.url });
                // If it's a file URL, block navigation and handle it ourselves
                const isFile =
                  request.url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) ||
                  request.url.match(/drive\.google\.com\/open\?id=([^&]+)/);
                if (isFile) return false; // block, we handle it
                return true; // allow everything else
              }}
              injectedJavaScript={`
                (function() {
                  // Poll for file links and intercept clicks
                  function interceptDriveLinks() {
                    // Target file cards/rows in Drive UI
                    document.querySelectorAll('[data-id]').forEach(function(el) {
                      if (el._intercepted) return;
                      el._intercepted = true;
                      el.addEventListener('click', function(e) {
                        var id = el.getAttribute('data-id');
                        if (id) {
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'driveFileSelected',
                            fileId: id,
                            fileName: el.getAttribute('data-filename') || 
                                      el.querySelector('[data-tooltip]')?.getAttribute('data-tooltip') || 
                                      'Drive Video'
                          }));
                        }
                      });
                    });
                  }

                  // Run immediately and on DOM changes
                  interceptDriveLinks();
                  var observer = new MutationObserver(interceptDriveLinks);
                  observer.observe(document.body, { childList: true, subtree: true });

                  // Also intercept fetch/XHR to catch Drive's internal navigation
                  var originalPushState = history.pushState;
                  history.pushState = function() {
                    originalPushState.apply(this, arguments);
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'urlChange',
                      url: window.location.href
                    }));
                  };

                  var originalReplaceState = history.replaceState;
                  history.replaceState = function() {
                    originalReplaceState.apply(this, arguments);
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'urlChange',
                      url: window.location.href
                    }));
                  };
                })();
                true;
              `}
              onMessage={(event) => {
                try {
                  const msg = JSON.parse(event.nativeEvent.data);
                  console.log('DRIVE MESSAGE:', msg);

                  if (msg.type === 'driveFileSelected' && msg.fileId) {
                    selectedSource = 'drive';
                    setSelectedVideoId(msg.fileId);
                    setShowOverlay(true);
                  } else if (msg.type === 'urlChange') {
                    handleDriveNavChange({ url: msg.url });
                  }
                } catch (e) {}
              }}
              style={styles.webview}
              userAgent="Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36"
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              thirdPartyCookiesEnabled={true}
              backgroundColor="#fff"
            />
          )}

          {/* Likes Tab */}
          {activeTab === 'likes' && (
            <View style={styles.tabContent}>
              <View style={styles.searchBar}>
                <Icon name="search" size={18} color="#666" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search likes..."
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
                  <Text style={styles.emptyText}>No liked videos yet</Text>
                }
              />
            </View>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <View style={styles.tabContent}>
              <View style={styles.searchBar}>
                <Icon name="search" size={18} color="#666" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search history..."
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
                  <Text style={styles.emptyText}>No watch history yet</Text>
                }
              />
            </View>
          )}

        </View>
      </View>

      {/* Selection Overlay */}
      {showOverlay && selectedVideoId && (
        <View style={styles.fullscreenOverlay}>
          <Image
            source={{ uri: overlayThumb }}
            style={StyleSheet.absoluteFill}
            blurRadius={20}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.75)' }]} />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.overlayInner}
          >
            <TouchableOpacity
              style={styles.closeOverlay}
              onPress={() => setShowOverlay(false)}
            >
              <Icon name="close" size={28} color="#fff" />
            </TouchableOpacity>

            {/* Flow 1 — Start new party */}
            {!isFlow2 ? (
              <View style={[styles.topSection, { paddingTop: insets.top + 20 }]}>
                <Text style={styles.namingTitle}>Name your party</Text>
                <TextInput
                  style={styles.namingInput}
                  placeholder="e.g. Movie Night..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={roomName}
                  onChangeText={setRoomName}
                  maxLength={25}
                  autoFocus={true}
                />
                <TouchableOpacity
                  style={[styles.submitBtn, !roomName.trim() && styles.submitBtnDisabled]}
                  onPress={handleStartParty}
                  disabled={!roomName.trim()}
                >
                  <Text style={styles.submitBtnText}>🎉 Start Party</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.topSection} />
            )}

            {/* Center icon */}
            <View style={styles.centerSection}>
              <Icon
                name={selectedSource === 'drive' ? 'logo-google' : 'logo-youtube'}
                size={40}
                color={selectedSource === 'drive' ? '#4285F4' : '#FF0000'}
              />
              <Icon name="play-circle" size={60} color="#8100D1" />
              <Text style={styles.videoSelectedText}>Ready to Play!</Text>
              <Text style={styles.videoSourceText}>
                {selectedSource === 'drive' ? '📁 Google Drive' : '▶️ YouTube'}
              </Text>
            </View>

            {/* Flow 2 — Add to queue */}
            {isFlow2 && (
              <View style={styles.bottomSection}>
                <TouchableOpacity style={styles.actionBtn} onPress={handleAddToQueue}>
                  <Icon name="add-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.actionBtnText}>Add to Queue</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isFlow2 && <View style={styles.bottomSpacer} />}
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#fff' },
  mainContent:       { flex: 1 },
  header:            { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backBtn:           { padding: 8 },
  headerTitle:       { fontSize: 18, fontWeight: '700', color: '#000' },

  tabBar:            { flexDirection: 'row', paddingHorizontal: 1, paddingVertical: 2, gap: 8, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab:               { width: 80, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  activeTab:         { backgroundColor: '#9200ec' },
  tabText:           { fontSize: 13, fontWeight: '600', color: '#666' },
  activeTabText:     { color: '#fff' },

  contentArea:       { flex: 1 },
  webview:           { flex: 1 },
  tabContent:        { flex: 1, backgroundColor: '#f8f8f8' },

  searchBar:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: 12, paddingHorizontal: 12, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#eee' },
  searchInput:       { flex: 1, marginLeft: 8, fontSize: 14, color: '#000' },

  gridContent:       { padding: 6 },
  gridItem:          { flex: 0.5, margin: 6, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, position: 'relative' },
  gridItemClick:     { flex: 1 },
  gridThumb:         { width: '100%', height: 100, backgroundColor: '#eee' },
  gridInfo:          { padding: 10 },
  gridTitle:         { fontSize: 12, fontWeight: '700', color: '#333', height: 34 },
  gridSub:           { fontSize: 10, color: '#888', marginTop: 4 },
  removeItem:        { position: 'absolute', top: 5, right: 5, zIndex: 10 },

  emptyText:         { textAlign: 'center', marginTop: 40, color: '#999' },

  fullscreenOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 999 },
  overlayInner:      { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 40 },
  closeOverlay:      { position: 'absolute', top: 50, right: 20, padding: 10 },
  topSection:        { width: '100%', alignItems: 'center' },
  namingTitle:       { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 20 },
  namingInput:       { width: '100%', height: 60, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 15, paddingHorizontal: 20, color: '#fff', fontSize: 18, textAlign: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  submitBtn:         { marginTop: 20, backgroundColor: '#8100D1', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 25 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  centerSection:     { alignItems: 'center', gap: 15 },
  videoSelectedText: { color: '#4ade80', fontSize: 20, fontWeight: '800' },
  videoSourceText:   { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  bottomSection:     { width: '100%', alignItems: 'center', paddingBottom: 40 },
  actionBtn:         { flexDirection: 'row', backgroundColor: '#8100D1', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  actionBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  bottomSpacer:      { height: 100 },
});

export default YouTubeDiscoveryScreen;