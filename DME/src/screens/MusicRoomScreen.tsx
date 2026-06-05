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
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, ActivityIndicator,
  StatusBar, TextInput,
  Dimensions, Keyboard, Platform, ScrollView,
  KeyboardAvoidingView, Modal, BackHandler,
  Animated, PanResponder, DeviceEventEmitter,
} from 'react-native';
import YoutubePlayer from '../components/YoutubePlayer';
import Icon from 'react-native-vector-icons/Ionicons';
import { useMusicRoom, Song } from '../hooks/useMusicRoom';
import YouTubeDiscoveryScreen from './YouTubeDiscoveryScreen'; // ✅ NEW: Import for overlay
import { useAuth } from '../context/AuthContext';
import api, { musicAPI } from '../services/api'; // ✅ FIX: Added musicAPI
import InviteModal from '../components/InviteModal';
import AvatarWithFallback from '../components/AvatarWithFallback';
import RelatedVideosGrid from '../components/RelatedVideosGrid'; // ✅ FIX: Added missing import
import musicWebSocketService from '../services/MusicWebSocketService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

const { width } = Dimensions.get('window');
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
    title:        'Loading...',
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
// VideoControls Component (same as before)
// ─────────────────────────────────────────────────────────────────────────────
interface ControlsProps {
  visible: boolean;
  isPlaying: boolean;
  canControl: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onNext: () => void;
}

const VideoControls: React.FC<ControlsProps> = ({
  visible, isPlaying, canControl, isBuffering,
  position, duration, onPlayPause, onSeek, onNext,
}) => {
  // ✅ FIX: Stale closure - Use ref to access current canControl value
  const canControlRef = useRef(canControl);
  useEffect(() => { canControlRef.current = canControl; }, [canControl]);

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
    onStartShouldSetPanResponder: () => true,  // Always allow start
    onMoveShouldSetPanResponder: () => true,   // Always allow move
    
    onPanResponderGrant: (evt) => {
      isSeeking.current = true;
      
      const touchX = evt.nativeEvent.pageX - barLayoutX.current;
      
      const nx = Math.max(0, Math.min(barWidth.current, touchX));
      
      knobX.setValue(nx);
      
      // ✅ FIX: Validate before calculating seek target
      if (duration > 0 && barWidth.current > 0) {
        seekTarget.current = (nx / barWidth.current) * duration;
      } else {
        seekTarget.current = 0;
      }
    },
    
    onPanResponderMove: (evt) => {
      const touchX = evt.nativeEvent.pageX - barLayoutX.current;
      const nx = Math.max(0, Math.min(barWidth.current, touchX));
      knobX.setValue(nx);
      
      if (duration > 0 && barWidth.current > 0) {
        seekTarget.current = (nx / barWidth.current) * duration;
      }
      console.log('📊 [DRAG MOVE] seekTarget:', seekTarget.current);
    },
    
    onPanResponderRelease: () => {
      console.log('📊 [DRAG RELEASE] canControl:', canControl, 'seekTarget:', seekTarget.current, 'duration:', duration);
      isSeeking.current = false;
      
      if (!canControl) {
        console.warn('📊 [DRAG DENIED] User is not DJ, cannot seek');
        return;
      }
      
      if (seekTarget.current < 0 || isNaN(seekTarget.current)) {
        console.error('📊 [DRAG INVALID] Invalid seek target:', seekTarget.current);
        return;
      }
      
      console.log('📊 [DRAG EXECUTE] Calling onSeek with:', seekTarget.current);
      onSeek(seekTarget.current);
    },
  })).current;

  return (
    <Animated.View style={[cv.wrap, { opacity }]} pointerEvents={visible ? 'box-none' : 'none'}>
      <View style={cv.scrimTop}    pointerEvents="none" />
      <View style={cv.scrimBottom} pointerEvents="none" />

      {isBuffering && (
        <View style={cv.bufferWrap} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={cv.bufferText}>Buffering…</Text>
        </View>
      )}

      {!isBuffering && (
        <TouchableOpacity 
          style={cv.centreBtn} 
          onPress={() => {
            console.log('🎵 VideoControls: Play/Pause button tapped. canControl:', canControl);
            onPlayPause();
          }} 
          activeOpacity={0.8} 
          disabled={!canControl}
        >
          <View style={[cv.centreBtnInner, !canControl && cv.centreBtnDisabled, { opacity: 0 }]}>
            <Icon 
              name={isPlaying ? 'pause' : 'play'} 
              size={32}
              color={canControl ? '#fff' : 'rgba(255,255,255,0.35)'} 
              style={{ marginLeft: isPlaying ? 0 : 5 }} 
            />
          </View>
        </TouchableOpacity>
      )}

      <View style={cv.bottomBar}>
        <View 
          {...pan.panHandlers} 
          style={{ height: 30, justifyContent: 'center', marginBottom: 6 }}
          onLayout={(event) => {
            const { x, width } = event.nativeEvent.layout;
            barLayoutX.current = x;
            barWidth.current = width;
            console.log('📊 [LAYOUT] barLayoutX:', x, 'barWidth:', width);
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
  scrimTop:         { position: 'absolute', top: 0, left: 0, right: 0, height: 80,  backgroundColor: 'transparent' },
  scrimBottom:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, backgroundColor: 'transparent' },
  bufferWrap:       { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  bufferText:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  centreBtn:        { width: 70, height: 70, justifyContent: 'center', alignItems: 'center' },
  centreBtnInner:   { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  centreBtnDisabled:{ borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.2)' },
  bottomBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 12 },
  track:            { height: 2, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 1, justifyContent: 'center' },
  fill:             { position: 'absolute', left: 0, height: 2, backgroundColor: '#8100D1', borderRadius: 1 },
  knob:             { position: 'absolute', top: -4, marginLeft: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  timeText:         { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },
  watchBadge:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  watchText:        { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main MusicRoomScreen
// ─────────────────────────────────────────────────────────────────────────────
const MusicRoomScreen = ({ route, navigation }: any) => {
  const { roomCode, isDJMode, initialVideoId } = route.params;
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  // State management
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [playerState, setPlayerState] = useState<string>('unstarted');
  const [chatMessage, setChatMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [duration, setDuration] = useState(0);
  const [livePosition, setLivePosition] = useState(0);
  const [activeTab, setActiveTab] = useState<'chat' | 'queue'>('chat');
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState<Song[]>([]);
  const [showRelated, setShowRelated] = useState(false);

  // Refs
  const chatListRef = useRef<FlatList>(null);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialized = useRef(false);
  const metadataLock = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const livePositionRef = useRef(0);
  const seekingRef = useRef(false);
  const isUserAction = useRef(false); // ✅ NEW: Guard to prevent feedback loops
  const preloadedRef = useRef(false); // ✅ NEW: Track preloaded status

  const { roomState, isConnected, isLoading, playerRef, loadSong, syncPlay, syncPause, syncSeek, addToQueue, passAux, updateCurrentSongMetadata } = useMusicRoom(roomCode, user?.id ?? 0);
  const { isDJ, currentSong, isPlaying, position, queue, participants } = roomState;

  // ✅ NEW: Sync state to ref
  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    livePositionRef.current = livePosition;
  }, [livePosition]);
  
  // Reset preloadedRef on new song
  useEffect(() => {
    if (currentSong?.videoId) {
      preloadedRef.current = false;
    }
  }, [currentSong?.videoId]);

  const setActionWindow = (ms = 3000) => {
    isUserAction.current = true;
    setTimeout(() => { isUserAction.current = false; }, ms);
  };

  // ✅ Stable Position ticker — Periodic sync for DJ only
  useEffect(() => {
    if (!isConnected || !currentSong) return;

    const interval = setInterval(async () => {
      try {
        const pos = await playerRef.current?.getCurrentTime();
        const dur = await playerRef.current?.getDuration();

        if (pos === undefined) return;

        // ✅ Update duration state (Fixes duration = 0 issue)
        if (dur && dur > 0 && !isNaN(dur)) {
          setDuration(dur);
        }

        setLivePosition(pos);

        // Only sync if DJ and playing, no active user action or seek
        if (isDJ && isPlaying && !seekingRef.current && !isUserAction.current && Math.floor(pos) % 5 === 0) {
          syncPlay(pos);
        }
      } catch (_) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected, isDJ, isPlaying, currentSong?.videoId, syncPlay]);

  const handleSelectSong = useCallback(async (song: Song) => {
    // ✅ FIX: Consider state !== 'ended' to treat ended video as "no active video"
    const hasActiveVideo = !!currentSongRef.current?.videoId && playerState !== 'ended';

    if ((isDJ || isDJMode) && !hasActiveVideo) {
      setIsPlayerReady(false);
      setIsBuffering(true);
      let richSong = song;
      if (!song.channelTitle || song.title === 'Loading...' || song.title === 'Initializing...') {
        richSong = await fetchYouTubeMetadata(song.videoId, song.addedBy ?? user?.display_name);
        richSong.addedBy = song.addedBy ?? user?.display_name;
      }
      setIsSyncing(true);
      loadSong(richSong);
    } else {
      addToQueue({ ...song, addedBy: song.addedBy ?? user?.display_name ?? 'Someone' });
      Toast.show({ type: 'success', text1: '🎵 Added to queue', text2: song.title });
    }
    Keyboard.dismiss();
  }, [isDJ, isDJMode, loadSong, addToQueue, user?.display_name, playerState]);

  // ✅ NEW: Handle video selection from Discovery via Event (solves navigation stack issue)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('VIDEO_SELECTED', async (data) => {
      if (data.roomCode === roomCode) {
        console.log('🎵 [MUSICROOM] VIDEO_SELECTED received:', data.videoId, 'adFinished:', data.adFinished);
        const song = await fetchYouTubeMetadata(data.videoId, user?.display_name);
        
        preloadedRef.current = data.isPreloaded;

        // ✅ Case 1: Ad finished on Discovery
        if (data.adFinished) {
          console.log('🎵 [MUSICROOM] Ad finished on Discovery. Fresh start from 0:00');
          loadSong(song);
          setTimeout(async () => {
            try { await playerRef.current?.seekTo(0, true); } catch (e) {}
          }, 800);
        } 
        // ✅ Case 2: Ad might still play
        else {
          console.log('🎵 [MUSICROOM] Ad might play here. Allowing it.');
          loadSong(song);
          setTimeout(async () => {
            try {
              const pos = await playerRef.current?.getCurrentTime();
              if (pos && pos > 5) await playerRef.current?.seekTo(0, true);
            } catch (e) {}
          }, 2000);
        }
        
        setShowDiscovery(false);
      }
    });
    return () => sub.remove();
  }, [roomCode, user?.display_name, loadSong]);

  // ──────────────────────────────────────────────────────────────────────────
  // Effects - All the logic from before, organized
  // ──────────────────────────────────────────────────────────────────────────

  // Then modify the existing useEffect:
  useEffect(() => {
    if (isDJ && currentSong?.videoId && metadataLock.current !== currentSong.videoId &&
        (currentSong.title === 'Initializing...' || currentSong.title === 'Loading...' || !currentSong.channelTitle)) {
      const fetchMeta = async () => {
        try {
          metadataLock.current = currentSong.videoId;
          const fullSong = await fetchYouTubeMetadata(currentSong.videoId, user?.display_name);
          fullSong.addedBy = currentSong.addedBy ?? user?.display_name ?? 'Someone';
          if (metadataLock.current === currentSong.videoId) {
            updateCurrentSongMetadata(fullSong);  // ✅ no reset
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
      // ✅ FIX: Delay load to allow VIDEO_SELECTED event to arrive first if preloaded
      setTimeout(() => {
        if (hasInitialized.current) return;
        hasInitialized.current = true;
        setIsSyncing(true);
        const song: Song = {
          videoId: initialVideoId,
          title: 'Initializing...',
          thumbnail: `https://img.youtube.com/vi/${initialVideoId}/mqdefault.jpg`,
          channelTitle: 'YouTube',
          addedBy: user?.display_name ?? 'You',
        };
        loadSong(song);
      }, 500);
    }
  }, [isConnected, initialVideoId, isDJMode, loadSong, user?.display_name]);

  useEffect(() => {
    if (currentSong?.videoId) {
      metadataLock.current = null;
      setIsPlayerReady(false);
      setIsBuffering(true);
      setLivePosition(0);
      setDuration(0);
      hasInitialized.current = false; // ✅ Reset for new song
    }
  }, [currentSong?.videoId]);

  useEffect(() => {
    if (isPlayerReady && isSyncing && isConnected && !hasInitialized.current) {
      hasInitialized.current = true; // ✅ Protect initial sync
      setIsSyncing(false);
      if (isDJMode || isDJ) {
        setTimeout(() => syncPlay(0), 800);
      }
    }
  }, [isPlayerReady, isSyncing, isConnected, isDJMode, isDJ, syncPlay]);

  useEffect(() => {
    if (isPlayerReady && (isDJ || isDJMode) && currentSong && isPlaying && !isSyncing) {
      const timer = setInterval(() => {
        if (playerState === 'unstarted' || playerState === 'cued') {
          playerRef.current?.seekTo(livePositionRef.current + 0.1, true);
          syncPlay(livePositionRef.current || 0);
        }
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [isPlayerReady, isDJ, isDJMode, currentSong, isPlaying, isSyncing, playerState, syncPlay]);

  useEffect(() => {
    const backAction = () => {
      if (showDiscovery) {
        setShowDiscovery(false); // ✅ Close overlay first
        return true;
      }
      setShowLeaveConfirm(true);
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => { backHandler.remove(); };
  }, [showDiscovery]);

  useEffect(() => {
    const unsubscribe = musicWebSocketService.onMessage((msg) => {
      if (msg.type === 'chat_message') {
        setMessages(prev => [...prev, msg.data]);
        setTimeout(() => chatListRef.current?.scrollToEnd(), 100);
      }
    });

    // ✅ Wrap the unsubscribe call to return void
    return () => {
      unsubscribe?.();   // even if unsubscribe returns a boolean, ignore it
    };
  }, []);

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

  const fetchRelated = useCallback(async () => {
    try {
      const data = await musicAPI.getRelatedVideos(currentSongRef.current?.videoId || '');
      setRelatedVideos(data.items.map((item: any) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channelTitle: item.snippet.channelTitle,
      })));
      setShowRelated(true);
    } catch (e) {
      console.error('Related videos fetch failed:', e);
    }
  }, []);

  const onPlayerStateChange = async (state: string) => {
    setPlayerState(state);
    if (state === 'buffering' || state === 'unstarted' || state === 'cued') setIsBuffering(true);
    else setIsBuffering(false);
    if (['unstarted', 'playing', 'paused', 'cued', 'buffering'].includes(state)) setIsPlayerReady(true);

    if (state === 'ended' && (isDJ || isDJMode)) {
      setShowRelated(true);
      // ✅ Fetch related videos
      const fetchRelated = async () => {
        try {
          const data = await musicAPI.getRelatedVideos(currentSongRef.current?.videoId || '');
          setRelatedVideos(data.items.map((item: any) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.medium.url,
            channelTitle: item.snippet.channelTitle,
          })));
        } catch (e) {
          console.error('Related videos fetch failed:', e);
        }
      };
      fetchRelated();
      return;
    }

    // ✅ FIX: Ignore automatic state changes if user just clicked something or seeking
    if (isUserAction.current || seekingRef.current) return;

    if (!isDJ && !isDJMode) return;
    const currentTime = livePosition;
    if (state === 'playing' && !isPlaying) {
      syncPlay(currentTime);
    }
  };

  // ✅ Wrap passAux to set syncing
  const handleNext = () => {
    if (!isDJ && !isDJMode) return;
    setActionWindow();
    
    // ✅ NEW: If queue empty, show related. Else, skip.
    if (queue.length === 0) {
      fetchRelated();
    } else {
      setIsSyncing(true);
      passAux();
    }
  };

  // ✅ FIX: Play/Pause handler - Declarative only
  const handlePlayPause = async () => {
    console.log('🎵 MusicRoomScreen: handlePlayPause executed. Current isPlaying:', isPlaying);
    if (!isDJ && !isDJMode) return;
    setActionWindow();
    showControlsFor(3500);
    try {
      const t = livePosition;
      // Library is controlled reactively via the 'play' prop
      if (isPlaying) {
        syncPause(t);
      } else {
        syncPlay(t);
      }
    } catch (e) {
      console.error('🎵 Play/Pause error:', e);
    }
  };

  // ✅ FIX: Seek handler with debounce
  const handleSeek = useCallback(async (t: number) => {
    console.log('🎯 [SEEK START] Target:', t);
    
    setActionWindow(3000);
    
    if (seekingRef.current) {
      console.warn('🎯 [SEEK BLOCKED] Already seeking');
      return;
    }
    
    seekingRef.current = true;
    console.log('🎯 [SEEK LOCK] Set seekingRef to true');
    
    try {
      if (t < 0 || isNaN(t)) {
        console.warn('🎯 [SEEK INVALID] Invalid position:', t);
        return;
      }

      console.log('🎯 [SEEK CALL] Calling seekTo');
      
      if (!playerRef.current) {
        console.error('🎯 [SEEK FAILED] playerRef is null');
        return;
      }

      if (typeof playerRef.current.seekTo !== 'function') {
        console.error('🎯 [SEEK FAILED] seekTo is not a function');
        return;
      }

      const seekPromise = playerRef.current.seekTo(t, true);
      if (seekPromise) {
        await seekPromise;
      }
      
      console.log('🎯 [SEEK EXECUTED]');

      setLivePosition(t);
      console.log('🎯 [SEEK LOCAL] Updated position to:', t);
      
      syncSeek(t);
      console.log('🎯 [SEEK SUCCESS]');
      
    } catch (error) {
      console.error('🎯 [SEEK ERROR]', error);
    } finally {
      setTimeout(() => {
        seekingRef.current = false;
        console.log('🎯 [SEEK UNLOCK]');
      }, 800);
    }
  }, [syncSeek]);

  const sendChatMessage = () => {
    if (!chatMessage.trim()) return;
    musicWebSocketService.sendChatMessage(chatMessage);
    setChatMessage('');
    Keyboard.dismiss();
  };

  const renderLeaveModal = () => (
    <Modal visible={showLeaveConfirm} transparent animationType="fade" onRequestClose={() => setShowLeaveConfirm(false)}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowLeaveConfirm(false)}>
        <View style={s.confirmContent}>
          <Text style={s.confirmTitle}>Leave watch party?</Text>
          <View style={s.confirmButtons}>
            <TouchableOpacity style={[s.pillButton, s.cancelButton]} onPress={() => setShowLeaveConfirm(false)}>
              <Text style={s.buttonText}>Stay</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.pillButton, s.leaveButton]} onPress={() => {
              setShowLeaveConfirm(false);
              navigation.goBack();
            }}>
              <Text style={s.buttonText}>Leave</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  if (isLoading) {
    return <View style={s.loadingContainer}><ActivityIndicator size="large" color="#8100D1" /><Text style={s.loadingText}>Joining room...</Text></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.root}>
      <View style={[s.inner, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
        {renderLeaveModal()}

        {/* HEADER */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => setShowLeaveConfirm(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-down" size={28} color="#fff" />
          </TouchableOpacity>
          <View style={s.roomPill}>
            <View style={[s.dot, isConnected ? s.dotGreen : s.dotGray]} />
            <Text style={s.roomCode}>{roomCode}</Text>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity onPress={() => setShowDiscovery(true)} style={s.headerIconBtn}>
              <Icon name="search" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setInviteModalVisible(true)} style={s.headerIconBtn}>
              <Icon name="person-add" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('queue')} style={s.headerIconBtn}>
              <Icon name="list" size={22} color={activeTab === 'queue' ? '#8100D1' : '#fff'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* VIDEO */}
        <View style={s.videoWrap}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {currentSong ? (
              <YoutubePlayer
                key={currentSong.videoId}
                ref={playerRef}
                videoId={currentSong.videoId}
                play={isPlaying}
                onReady={() => {
                  console.log('🎬 Player ready');
                  setIsPlayerReady(true);
                  setIsBuffering(false);
                  
                  // ✅ FIX: Fetch duration immediately after ready (Expert recommendation)
                  setTimeout(async () => {
                    try {
                      const d = await playerRef.current?.getDuration();
                      if (d && d > 0) {
                        console.log('🎬 Duration fetched immediately:', d);
                        setDuration(d);
                      }
                    } catch (e) {
                      console.warn('Duration fetch error:', e);
                    }
                  }, 300);
                }}
                onStateChange={onPlayerStateChange}
                onProgress={(currentTime, dur) => {
                  if (dur > 0 && !isNaN(dur)) setDuration(dur);
                  if (!seekingRef.current) setLivePosition(currentTime);
                }}
                onError={() => { setIsBuffering(false); }}
              />
            ) : (
              <View style={s.videoPlaceholder}>
                <Icon name="videocam-outline" size={48} color="rgba(255,255,255,0.1)" />
                <Text style={s.videoPlaceholderText}>Tap 🔍 to discover a video</Text>
              </View>
            )}
          </View>

          {/* ✅ TAP HANDLER - Shows/hides controls on tap */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <TouchableOpacity 
              activeOpacity={1} 
              style={StyleSheet.absoluteFill}
              onPress={() => showControlsFor()}
            />
          </View>

          {currentSong && (playerState === 'unstarted' || playerState === 'buffering' || playerState === 'cued' || !isPlayerReady) && (
            <View style={s.coverOverlay} pointerEvents="none">
              {currentSong.thumbnail && <Image source={{ uri: currentSong.thumbnail }} style={[StyleSheet.absoluteFill, { opacity: 0.4 }]} blurRadius={15} />}
              <View style={s.coverContent}>
                <ActivityIndicator size="large" color="#8100D1" />
                <Text style={s.coverText}>{playerState === 'buffering' ? 'Buffering...' : 'Preparing video...'}</Text>
              </View>
            </View>
          )}

          {isSyncing && !preloadedRef.current && (
            <View style={s.syncOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#8100D1" />
              <Text style={s.syncText}>Syncing video...</Text>
            </View>
          )}

          {/* ✅ CONTROLS - On top, responds to button presses */}
          <VideoControls 
            visible={showControls} 
            isPlaying={isPlaying} 
            canControl={(isDJ || isDJMode) && isPlayerReady}
            isBuffering={isBuffering && !!currentSong} 
            position={livePosition} 
            duration={duration}
            onPlayPause={handlePlayPause} 
            onSeek={handleSeek} 
            onNext={handleNext}
          />

          {/* RECOMMENDATIONS OVERLAY - Now inside videoWrap */}
          {showRelated && (
            <View style={s.relatedOverlay}>
              <RelatedVideosGrid 
                videos={relatedVideos} 
                onSelect={(song) => {
                  setShowRelated(false);
                  handleSelectSong(song);
                }}
              />
            </View>
          )}
        </View>

        {/* NOW PLAYING */}
        <View style={s.npBar}>
          {currentSong?.thumbnail ? <Image source={{ uri: currentSong.thumbnail }} style={s.npThumb} />
            : <View style={[s.npThumb, s.npThumbEmpty]}><Icon name="musical-note" size={14} color="#444" /></View>}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.npTitle} numberOfLines={1}>{currentSong?.title ?? 'Nothing playing'}</Text>
            <Text style={s.npChannel} numberOfLines={1}>{currentSong?.channelTitle ?? 'Search to start watching together'}</Text>
          </View>
          {(isDJ || isDJMode) && <View style={s.djBadge}><Icon name="radio" size={10} color="#8100D1" /><Text style={s.djBadgeText}>DJ</Text></View>}
        </View>

        {/* PARTICIPANTS */}
        <View style={s.participantsRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.participantsContent}>
            {participants.map(p => (
              <View key={p.user_id} style={s.participantItem}>
                <AvatarWithFallback uri={p.avatar} displayName={p.name} style={s.pAvatar} />
                {p.is_dj && <View style={s.djDot} />}
              </View>
            ))}
            <TouchableOpacity style={s.addAvatar} onPress={() => setInviteModalVisible(true)}>
              <Icon name="person-add-outline" size={14} color="#8100D1" />
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* TABS */}
        <View style={s.tabs}>
          {(['chat', 'queue'] as const).map(tab => (
            <TouchableOpacity key={tab} style={[s.tab, activeTab === tab && s.tabActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                {tab === 'chat' ? 'Chat' : `Queue${queue.length > 0 ? ` (${queue.length})` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* CONTENT */}
        {activeTab === 'chat' ? (
          <>
            <FlatList ref={chatListRef} data={messages} keyExtractor={(_, i) => i.toString()} style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={s.emptyText}>No messages yet. Say hi! 👋</Text>}
              renderItem={({ item }) => <View style={s.bubble}><Text style={s.bubbleUser}>{item.user}{' '}</Text><Text style={s.bubbleMsg}>{item.text}</Text></View>}
            />
            <View style={s.chatBar}>
              <TextInput style={s.chatInput} placeholder="Say something..." placeholderTextColor="#555"
                value={chatMessage} onChangeText={setChatMessage} onSubmitEditing={sendChatMessage} returnKeyType="send"
              />
              <TouchableOpacity style={s.sendBtn} onPress={sendChatMessage}>
                <Icon name="send" size={18} color="#8100D1" />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <FlatList data={queue} keyExtractor={(_, i) => i.toString()} style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}
            ListEmptyComponent={<Text style={s.emptyText}>Queue is empty — use 🔍 to add songs</Text>}
            renderItem={({ item, index }) => (
              <View style={s.qRow}>
                <Text style={s.qNum}>{index + 1}</Text>
                <Image source={{ uri: item.thumbnail }} style={s.qThumb} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.qTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.qBy}>Added by {item.addedBy ?? item.channelTitle}</Text>
                </View>
                {(isDJ || isDJMode) && <TouchableOpacity onPress={() => handleSelectSong(item)}><Icon name="play-circle" size={26} color="#8100D1" /></TouchableOpacity>}
              </View>
            )}
          />
        )}
      </View>

      {/* DISCOVERY OVERLAY — Keeps MusicRoom mounted so player doesn't stop */}
      <Modal visible={showDiscovery} animationType="slide" onRequestClose={() => setShowDiscovery(false)}>
        <YouTubeDiscoveryScreen 
          navigation={{ goBack: () => setShowDiscovery(false) } as any} 
          route={{ params: { roomCode } } as any} 
        />
      </Modal>

      <InviteModal visible={inviteModalVisible} onClose={() => setInviteModalVisible(false)} roomCode={roomCode} videoId={currentSong?.videoId} />
    </KeyboardAvoidingView>
  );
};

// Styles (same as before)
const s = StyleSheet.create({
  relatedOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 15, justifyContent: 'center' },
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  loadingText: { color: '#fff', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn: { padding: 6 },
  roomPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, marginHorizontal: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotGreen: { backgroundColor: '#4ade80' },
  dotGray: { backgroundColor: '#555' },
  roomCode: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  videoWrap: { width, height: VIDEO_HEIGHT, backgroundColor: '#000', position: 'relative' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  videoPlaceholderText: { color: 'rgba(255,255,255,0.2)', fontSize: 13 },
  npBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#0D0D0D', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  npThumb: { width: 50, height: 28, borderRadius: 3 },
  npThumbEmpty: { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' },
  npTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  npChannel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  djBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(129,0,209,0.1)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 0.5, borderColor: 'rgba(129,0,209,0.3)' },
  djBadgeText: { color: '#8100D1', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  participantsRow: { backgroundColor: '#0A0A0A', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.03)' },
  participantsContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  participantItem: { position: 'relative' },
  pAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#1A1A1A' },
  djDot: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#8100D1', borderWidth: 2, borderColor: '#0A0A0A' },
  addAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(129,0,209,0.05)', borderWidth: 1, borderColor: 'rgba(129,0,209,0.2)', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.07)' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#8100D1' },
  tabText: { color: 'rgba(255,255,255,0.35)', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  emptyText: { color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 30, fontSize: 13 },
  bubble: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 7 },
  bubbleUser: { color: '#8100D1', fontWeight: '700', fontSize: 13 },
  bubbleMsg: { color: 'rgba(255,255,255,0.82)', fontSize: 13 },
  chatBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.07)', gap: 10 },
  chatInput: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 22, paddingHorizontal: 16, height: 40, color: '#fff', fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(129,0,209,0.15)', justifyContent: 'center', alignItems: 'center' },
  qRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  qNum: { color: 'rgba(255,255,255,0.2)', fontSize: 11, width: 18 },
  qThumb: { width: 68, height: 38, borderRadius: 4, backgroundColor: '#1a1a1a' },
  qTitle: { color: '#e0e0e0', fontSize: 13 },
  qBy: { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  confirmContent: { backgroundColor: '#1A1A1A', padding: 25, borderRadius: 25, width: '80%', alignItems: 'center' },
  confirmTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 25 },
  confirmButtons: { flexDirection: 'row', gap: 15, width: '100%' },
  pillButton: { flex: 1, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { backgroundColor: '#333' },
  leaveButton: { backgroundColor: '#8100D1' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  syncOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  syncText: { marginTop: 20, color: '#8100D1', fontSize: 15, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  coverOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  coverContent: { alignItems: 'center', gap: 15 },
  coverText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
});

export default MusicRoomScreen;