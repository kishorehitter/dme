/**
 * YouTubeDiscoveryScreen — Optimized for Queue & Navigation
 *
 * FIXES:
 * 1. For EXISTING rooms: Emit 'VIDEO_SELECTED' and call goBack().
 *    This avoids stack buildup (no more 5x back button) and allows MusicRoom
 *    to handle the song (add-to-queue or play) seamlessly.
 *
 * 2. For NEW rooms: Keep replace() to start a fresh session.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, Text, DeviceEventEmitter,
} from 'react-native';
import { WebView } from 'react-native-webview';
import YoutubePlayer from '../components/YoutubePlayer'; // ✅ Import
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

const YouTubeDiscoveryScreen = ({ navigation, route }: any) => {
  const { roomCode } = route.params || {};
  const webViewRef   = useRef<WebView>(null);
  const insets       = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [preparingTime, setPreparingTime] = useState(0);
  const [adStatus, setAdStatus] = useState('Initializing...');
  
  const isNavigating = useRef(false);
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ✅ NEW: Refs to track preloading & ad detection
  const preloadPlayerRef = useRef<any>(null);
  const preloadingVideoId = useRef<string | null>(null);
  const adFinishedRef = useRef(false);
  const playerStateRef = useRef<string>('unstarted');
  const lastPositionRef = useRef(0);
  const positionStableCountRef = useRef(0);

  // FIX: reset the guard whenever this screen comes back into focus
  useFocusEffect(
    React.useCallback(() => {
      isNavigating.current = false;
      setLoading(false);
      setPreparingTime(0);
      setAdStatus('');
      preloadingVideoId.current = null;
      adFinishedRef.current = false;
      playerStateRef.current = 'unstarted';
      lastPositionRef.current = 0;
      positionStableCountRef.current = 0;
      return () => {
        if (navTimeout.current) clearTimeout(navTimeout.current);
      };
    }, [])
  );

  // ✅ NEW: Monitor hidden player to detect when ad finishes
  const handleHiddenPlayerStateChange = (state: string) => {
    playerStateRef.current = state;
    if (state === 'playing') setAdStatus('Playing...');
  };

  const handleHiddenPlayerProgress = async (currentTime: number, duration: number) => {
    const positionDelta = Math.abs(currentTime - lastPositionRef.current);
    if (positionDelta < 0.5) {
      positionStableCountRef.current++;
      if (currentTime < 2) setAdStatus('🎬 Loading video...');
      else if (currentTime >= 2) setAdStatus('📺 Playing ad...');
      
      if (positionStableCountRef.current >= 3 && currentTime > 2) {
        adFinishedRef.current = true;
        // ✅ NAVIGATION TRIGGER: Ad finished!
        triggerNavigation(); 
      }
    } else {
      positionStableCountRef.current = 0;
      if (positionDelta > 3) {
        adFinishedRef.current = true;
        // ✅ NAVIGATION TRIGGER: Ad finished!
        triggerNavigation();
      }
    }
    lastPositionRef.current = currentTime;
  };

  // ✅ NEW: Helper to trigger navigation immediately when ad finishes
  const triggerNavigation = () => {
    if (isNavigating.current && !loading) return; // Already navigating
    console.log('🎵 [DISCOVERY] Ad finished detected. Navigating now.');
    
    // Clear the main timeout so it doesn't fire later
    if (navTimeout.current) clearTimeout(navTimeout.current);
    
    // Perform navigation
    setLoading(false);
    
    if (roomCode) {
      navigation.goBack();
      setTimeout(() => DeviceEventEmitter.emit('VIDEO_SELECTED', { roomCode, videoId: preloadingVideoId.current, isPreloaded: true, adFinished: true }), 100);
    } else {
      const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      navigation.replace('MusicRoom', { roomCode: newRoomCode, isDJMode: true });
      setTimeout(() => DeviceEventEmitter.emit('VIDEO_SELECTED', { roomCode: newRoomCode, videoId: preloadingVideoId.current, isDJMode: true, isPreloaded: true, adFinished: true }), 100);
    }
  };

  const handleNavigationStateChange = (navState: any) => {
    if (isNavigating.current) return;

    const { url } = navState;
    const videoIdMatch =
      url.match(/[?&]v=([^&]+)/) ||
      url.match(/shorts\/([^?&/]+)/);

    if (!videoIdMatch?.[1]) return;

    const videoId = videoIdMatch[1];
    isNavigating.current = true;
    preloadingVideoId.current = videoId;
    adFinishedRef.current = false;
    positionStableCountRef.current = 0;

    console.log('🎵 [DISCOVERY] Video detected:', videoId);
    setLoading(true);
    setPreparingTime(0);

    const startTime = Date.now();
    const prepTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setPreparingTime(elapsed);
      if (elapsed > 60 && !adFinishedRef.current) adFinishedRef.current = true;
    }, 500);

    if (roomCode) {
      navTimeout.current = setTimeout(() => {
        setLoading(false);
        clearInterval(prepTimer);
        navigation.goBack();
        setTimeout(() => DeviceEventEmitter.emit('VIDEO_SELECTED', { roomCode, videoId, isPreloaded: true, adFinished: adFinishedRef.current }), 100);
      }, 65000);
    } else {
      const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      navTimeout.current = setTimeout(() => {
        setLoading(false);
        clearInterval(prepTimer);
        navigation.replace('MusicRoom', { roomCode: newRoomCode, isDJMode: true });
        setTimeout(() => DeviceEventEmitter.emit('VIDEO_SELECTED', { roomCode: newRoomCode, videoId, isDJMode: true, isPreloaded: true, adFinished: adFinishedRef.current }), 100);
      }, 65000);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Discovery</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.webWrap}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://m.youtube.com' }}
          onNavigationStateChange={handleNavigationStateChange}
          style={styles.webview}
          userAgent="Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36"
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#8100D1" />
            <Text style={styles.loadingText}>Preparing video... ({preparingTime}s / 65s max)</Text>
            <Text style={styles.subText}>{adStatus}</Text>
          </View>
        )}

        {/* ✅ HIDDEN PLAYER: Monitors ad progress */}
        {preloadingVideoId.current && (
          <View style={{ position: 'absolute', width: 0, height: 0, opacity: 0, zIndex: -1 }}>
            <YoutubePlayer
              ref={preloadPlayerRef}
              videoId={preloadingVideoId.current}
              play={true}
              onStateChange={handleHiddenPlayerStateChange}
              onProgress={handleHiddenPlayerProgress}
            />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#fff' },
  header:         { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backBtn:        { padding: 8 },
  headerTitle:    { fontSize: 18, fontWeight: '700', color: '#000' },
  webWrap:        { flex: 1, position: 'relative' },
  webview:        { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  loadingText:    { marginTop: 15, fontSize: 14, color: '#8100D1', fontWeight: '600' },
  subText:        { marginTop: 8, fontSize: 13, color: '#fff', fontWeight: '500' },
});

export default YouTubeDiscoveryScreen;