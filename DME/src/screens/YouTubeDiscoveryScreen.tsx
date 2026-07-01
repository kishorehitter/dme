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
  Platform, Dimensions, Image, FlatList, ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
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

  const isNavigating = useRef(false);

  useEffect(() => {
    isNavigating.current = false;
    loadHistory();
    loadLikes();
    handleSearchYouTube('trending music videos');
  }, []);

  const handleSearchYouTube = async (queryToSearch?: string) => {
    const q = queryToSearch || ytQuery;
    if (!q.trim()) return;
    Keyboard.dismiss();
    setIsYtSearching(true);
    try {
      const data = await musicAPI.searchYouTube(q, 15);
      if (data && data.items) {
        setYtResults(data.items);
      } else {
        setYtResults([]);
      }
    } catch (e) {
      console.error('YouTube search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed' });
    } finally {
      setIsYtSearching(false);
    }
  };

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
  const handleSelectMedia = (item: any, source: 'youtube' | 'drive') => {
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

    if (typeof navigation.setOptions === 'function') {
      navigation.setOptions({ animationEnabled: false });
    }
    navigation.goBack();
    DeviceEventEmitter.emit('open_music_room', {
      roomCode: newRoomCode,
      isDJMode: true,
      roomName: roomName,
      initialVideoId: selectedVideoId,
      initialSource: selectedSource,
      initialTitle: finalTitle,
      initialThumbnail: initThumbnail,
    });

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
            <Text style={styles.gridSub}>
              {channel || (isDrive ? 'Google Drive' : '')}
            </Text>
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

  // ─── Overlay thumbnail ─────────────────────────────────────────────────────
  const overlayThumb = selectedSource === 'drive'
    ? 'https://via.placeholder.com/800x450/1a1a2e/FFFFFF?text=Google+Drive+Video'
    : `https://img.youtube.com/vi/${selectedVideoId}/hqdefault.jpg`;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar 
        barStyle={showOverlay && selectedVideoId ? "light-content" : "dark-content"} 
        backgroundColor="transparent" 
        translucent={true}
      />

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
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={{ overflow: 'hidden', borderRadius: 16 }}
              >
                {isActive ? (
                  <LinearGradient
                    colors={['#FF007F', '#7F00FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.tab}
                  >
                    <Icon
                      name={icons[tab]}
                      size={16}
                      color="#fff"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.tabText, styles.activeTabText]}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.tab, styles.inactiveTab]}>
                    <Icon
                      name={icons[tab]}
                      size={16}
                      color="#666"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.tabText}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Text>
                  </View>
                )}
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
              
              setSupportMultipleWindows={false}
              onOpenWindow={(event) => {
                  youtubeWebViewRef.current?.injectJavaScript(
                      `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
                  );
              }}
              
              onShouldStartLoadWithRequest={(request) => {
                  const url = request.url;
                  
                  // Intercept video clicks immediately
                  const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/shorts\/([^?&/]+)/);
                  if (videoIdMatch?.[1]) {
                      handleYouTubeNavChange({ url });
                      return false; // Stop loading the video page
                  }
                  
                  if (
                      url.includes('youtube.com') ||
                      url.includes('google.com') ||
                      url.includes('googleapis.com') ||
                      url.includes('gstatic.com') ||
                      url.includes('accounts.google') ||
                      url.includes('about:blank')
                  ) {
                      return true; 
                  }
                  return false;
              }}

              userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
              
              javaScriptEnabled={true}
              domStorageEnabled={true}
              thirdPartyCookiesEnabled={true}
              sharedCookiesEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              backgroundColor="#000"
              style={{ flex: 1 }}
            />
          )}

          {/* Drive Tab — WebView approach, no OAuth needed */}
          {activeTab === 'drive' && (
            <WebView
                ref={driveWebViewRef}
                source={{ uri: 'https://drive.google.com' }}
                
                // ✅ These 3 lines fix the external app opening:
                setSupportMultipleWindows={false}
                onOpenWindow={(event) => {
                    // Force all new windows to load in same WebView
                    driveWebViewRef.current?.injectJavaScript(
                        `window.location.href = "${event.nativeEvent.targetUrl}"; true;`
                    );
                }}
                
                onShouldStartLoadWithRequest={(request) => {
                    const url = request.url;
                    console.log('DRIVE REQUEST:', url);

                    // ✅ Allow ALL Google domains inside WebView
                    if (
                        url.includes('google.com') ||
                        url.includes('googleapis.com') ||
                        url.includes('gstatic.com') ||
                        url.includes('accounts.google') ||
                        url.includes('about:blank')
                    ) {
                        return true; // stay inside WebView
                    }

                    // ✅ Block file URLs — handle ourselves
                    const isFile =
                        url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) ||
                        url.match(/drive\.google\.com\/open\?id=([^&]+)/);
                    if (isFile) {
                        handleDriveNavChange({ url });
                        return false;
                    }

                    // Block everything else
                    return false;
                }}

                // ✅ Chrome 120 user agent — older ones trigger external redirect
                userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
                
                javaScriptEnabled={true}
                domStorageEnabled={true}
                thirdPartyCookiesEnabled={true}
                sharedCookiesEnabled={true}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                backgroundColor="#fff"
                style={styles.webview}

                onNavigationStateChange={(navState) => {
                    handleDriveNavChange(navState);
                }}
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
                        // Prevent target="_blank" links from opening externally
                        document.addEventListener('click', function(e) {
                            var el = e.target.closest('a');
                            if (el && el.target === '_blank') {
                                e.preventDefault();
                                window.location.href = el.href;
                            }
                        }, true);

                        function interceptDriveLinks() {
                            document.querySelectorAll('[data-id]').forEach(function(el) {
                                if (el._intercepted) return;
                                el._intercepted = true;
                                el.addEventListener('click', function(e) {
                                    var id = el.getAttribute('data-id');
                                    if (id) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.ReactNativeWebView.postMessage(JSON.stringify({
                                            type: 'driveFileSelected',
                                            fileId: id,
                                        }));
                                    }
                                });
                            });
                        }

                        interceptDriveLinks();
                        var observer = new MutationObserver(interceptDriveLinks);
                        observer.observe(document.body, { childList: true, subtree: true });
                    })();
                    true;
                `}
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
                <Text style={styles.namingTitle}>Name your Lobby</Text>
                <TextInput
                  style={styles.namingInput}
                  placeholder="e.g. Fun Time..."
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
                  <Text style={styles.submitBtnText}>Start Party 🎉</Text>
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
  tab:               { width: 80, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  inactiveTab:       { backgroundColor: '#f0f0f0' },
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