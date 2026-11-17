// src/hooks/useMusicRoom.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import musicWebSocketService from '../services/MusicWebSocketService';

export interface Participant {
  user_id: number;
  name: string;
  is_dj: boolean;
  avatar?: string | null;
  avatar_sticker?: string | null;
}

export interface Song {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  channelLogo?: string;
  channelUrl?: string;
  addedBy: string;
  duration?: number;
  source?: 'youtube' | 'drive'; 
  playSessionId?: string;
}

// ✅ NEW: a queue entry — wraps a Song with WHO pinned it and WHEN, so the
// client can render per-user avatar badges (Related grid, visible to
// everyone) and filter to "my queue only" (Queue tab, client-side filter —
// the data itself isn't private, see consumers.py _pin_video).
export interface QueueItem {
  song: Song;
  addedById: number;
  addedByName: string;
  addedByAvatar?: string;
  addedByAvatarSticker?: string;
  pinnedAt: number; // epoch seconds — global FIFO order across ALL users
}

export interface RoomState {
  roomCode: string;
  roomName?: string; // ✅ Made optional
  isDJ: boolean;
  currentSong: Song | null;
  position: number;
  isPlaying: boolean;
  queue: QueueItem[];
  participants: Participant[];
  allowedSpeakers: number[];
}

export const resolveSongSource = (source?: string, videoId?: string): 'youtube' | 'drive' => {
  if (source === 'drive') return 'drive';
  if (source === 'youtube') return 'youtube';
  if (videoId && (videoId.length > 15 || videoId.includes('-') || (videoId.includes('_') && videoId.length > 15))) {
    return 'drive';
  }
  return 'youtube';
};

// Backend sends queue items as snake_case
// ({ song, added_by_id, added_by_name, added_by_avatar, pinned_at }).
// This normalizes to the camelCase QueueItem shape the rest of the app uses,
// and tolerates legacy plain-Song queue items (pre-pin-feature data) by
// wrapping them with placeholder attribution so old/new shapes never crash
// the UI during a rolling deploy.
const normalizeQueueItem = (raw: any): QueueItem => {
  if (raw && raw.song) {
    const s = raw.song;
    const isDrive = resolveSongSource(s.source, s.videoId) === 'drive';
    return {
      song: {
        ...s,
        source: isDrive ? 'drive' : (s.source || 'youtube'),
        title: s.title || (isDrive ? 'Drive Video' : 'YouTube Video'),
        channelTitle: s.channelTitle || (isDrive ? 'Google Drive' : 'YouTube'),
      },
      addedById: raw.added_by_id,
      addedByName: raw.added_by_name ?? 'Someone',
      addedByAvatar: raw.added_by_avatar,
      addedByAvatarSticker: raw.added_by_avatar_sticker,
      pinnedAt: raw.pinned_at ?? 0,
    };
  }
  // Legacy shape: queue item WAS the Song itself.
  const isDrive = raw ? resolveSongSource(raw.source, raw.videoId) === 'drive' : false;
  return {
    song: raw ? {
      ...raw,
      source: isDrive ? 'drive' : (raw.source || 'youtube'),
      title: raw.title || (isDrive ? 'Drive Video' : 'YouTube Video'),
      channelTitle: raw.channelTitle || (isDrive ? 'Google Drive' : 'YouTube'),
    } : raw,
    addedById: -1,
    addedByName: raw?.addedBy ?? 'Someone',
    addedByAvatar: undefined,
    pinnedAt: 0,
  };
};

const normalizeQueue = (rawQueue: any[]): QueueItem[] =>
  Array.isArray(rawQueue) ? rawQueue.map(normalizeQueueItem) : [];

export const useMusicRoom = (
  roomCode: string, 
  userId: number,
  isPlayerReadyRef?: React.MutableRefObject<boolean>,
  playerReadyTimeRef?: React.MutableRefObject<number>,
  isAdPlayingRef?: React.MutableRefObject<boolean>,
  isDJBackgroundedRef?: React.MutableRefObject<boolean>
) => {
  const [roomState, setRoomState] = useState<RoomState>(() => {
    const cached = musicWebSocketService.getLastRoomState();
    if (cached && musicWebSocketService.getCurrentRoomCode() === roomCode) {
      return cached;
    }
    return {
      roomCode,
      roomName: '', // ✅ Initialized as empty string
      isDJ: false,
      currentSong: null,
      position: 0,
      isPlaying: false,
      queue: [],
      participants: [],
      allowedSpeakers: []
    };
  });

  const roomStateRef = useRef(roomState);
  const userIdRef = useRef(userId);

  useEffect(() => {
    roomStateRef.current = roomState;
    musicWebSocketService.setLastRoomState(roomState);
  }, [roomState]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [joinSnapshot, setJoinSnapshot] = useState<{videoId?: string | null, position: number, isPlaying: boolean, receivedAt: number} | null>(null);
  const playerRef = useRef<any>(null);

  // Connect to music room
  useEffect(() => {
    const connectToRoom = async () => {
      try {
        setIsLoading(true);
        if (musicWebSocketService.getConnectionState() && musicWebSocketService.getCurrentRoomCode() === roomCode) {
          console.log('🎵 Music WS already connected, reusing connection');
          setIsConnected(true);
        } else {
          await musicWebSocketService.connect(roomCode);
          setIsConnected(true);
        }
      } catch (error) {
        console.warn('Failed to connect to music room (network/backend unavailable):', error);
      } finally {
        setIsLoading(false);
      }
    };

    connectToRoom();

    // Listen for messages
    const unsubscribe = musicWebSocketService.onMessage(async (message) => {
      const currentState = roomStateRef.current;
      const currentUserId = userIdRef.current;

      switch (message.type) {

        case 'room_state':
          setRoomState(prev => {
            const incomingVideo = message.data.current_video;
            const isSame = incomingVideo && prev.currentSong?.videoId === incomingVideo.videoId;
            const isDriveVideo = incomingVideo ? resolveSongSource(incomingVideo.source, incomingVideo.videoId) === 'drive' : false;
            const currentVideo = incomingVideo ? {
              ...incomingVideo,
              source: isDriveVideo ? 'drive' : (incomingVideo.source || (isSame ? prev.currentSong?.source : undefined) || 'youtube'),
              title: incomingVideo.title || (isDriveVideo ? 'Drive Video' : 'YouTube Video'),
              channelTitle: incomingVideo.channelTitle || (isDriveVideo ? 'Google Drive' : 'YouTube'),
              playSessionId: isSame && prev.currentSong?.playSessionId
                ? prev.currentSong.playSessionId
                : (incomingVideo.playSessionId || `${incomingVideo.videoId}_${Date.now()}`),
            } : null;
            return {
              ...prev,
              isDJ: message.data.is_dj,
              roomName: message.data.room_name || message.data.name || '',
              currentSong: currentVideo,
              position: message.data.position,
              isPlaying: message.data.is_playing,
              queue: normalizeQueue(message.data.queue),
              participants: message.data.participants,
              allowedSpeakers: message.data.allowed_speakers || []
            };
          });
          
          // ✅ Save snapshot for the screen to consume on player ready
          setJoinSnapshot({
            videoId: message.data.current_video?.videoId || null,
            position: message.data.position,
            isPlaying: message.data.is_playing,
            receivedAt: Date.now(), // ✅ timestamp for drift compensation
          });
          break;

        case 'mic_permission_update':
          setRoomState(prev => ({
            ...prev,
            allowedSpeakers: message.data.allowed_speakers || []
          }));
          break;

        case 'watch_load':
          const isDifferentWatchSong = !roomStateRef.current.currentSong || roomStateRef.current.currentSong.videoId !== message.data.video?.videoId;
          if (isDifferentWatchSong) {
            if (isPlayerReadyRef) isPlayerReadyRef.current = false;
            if (playerRef?.current) {
              try { playerRef.current.pauseVideo?.(); } catch (_) {}
            }
          }
          setRoomState(prev => {
            const incoming = message.data.video;
            if (!incoming) return prev;
            const isSame = prev.currentSong?.videoId === incoming.videoId;
            const isDrive = resolveSongSource(incoming.source, incoming.videoId) === 'drive';
            const updatedSong: Song = {
              ...incoming,
              source: isDrive ? 'drive' : (incoming.source || (isSame ? prev.currentSong?.source : undefined) || 'youtube'),
              title: incoming.title || (isDrive ? 'Drive Video' : 'YouTube Video'),
              channelTitle: incoming.channelTitle || (isDrive ? 'Google Drive' : 'YouTube'),
              playSessionId: isSame && prev.currentSong?.playSessionId
                ? prev.currentSong.playSessionId
                : (incoming.playSessionId || `${incoming.videoId}_${Date.now()}`),
            };
            return {
              ...prev,
              currentSong: updatedSong,
              roomName: message.data.room_name || message.data.name || prev.roomName,
              position: 0,
              isPlaying: true
            };
          });
          break;

        case 'watch_sync':
          const { position, is_playing, host_timestamp, is_dj_background } = message.data;

          // ✅ KEY FIX: ignore position/seeking syncs while DJ is backgrounded,
          // but update isPlaying state if it changed so DJ's local state doesn't get stuck.
          if (isDJBackgroundedRef?.current) {
            setRoomState(prev => {
              if (prev.isPlaying !== is_playing) {
                console.log('📱 [HOOK] DJ backgrounded: Updating play/pause state to:', is_playing);
                return { ...prev, isPlaying: is_playing };
              }
              console.log('📱 [HOOK] Ignoring position sync — DJ is backgrounded');
              return prev;
            });
            break;
          }

          // Compensate network delay
          const rawDelay = host_timestamp ? (Date.now() - host_timestamp) / 1000 : 0;
          const safeDelay = Math.min(Math.max(0, rawDelay), 0.12);
          const syncPos = position + safeDelay;

          // We removed the old '!is_playing && is_dj_background' guard. Since the DJ's
          // app now safely prevents involuntary WebView background pauses at the source,
          // any pause sync received while the DJ is backgrounded is guaranteed to be a
          // deliberate remote control action (lock screen/notification) and must be obeyed.
          setRoomState(prev => ({
            ...prev,
            position: syncPos,
            isPlaying: is_playing
          }));

          // Sync seeking is coordinated entirely by MusicRoomScreen to keep audio and video in sync.
          break;

        case 'dj_background':
          if (message.data.is_background) {
            // DJ went background — participants keep playing, ignore future pause syncs
            console.log('📱 [PARTICIPANT] DJ went background — continuing playback');
            setRoomState(prev => ({ 
              ...prev, 
              // Keep isPlaying as-is — don't stop participant playback
              // Just update position to DJ's last known position
              position: message.data.position 
            }));
          } else {
            // DJ came back — resume normal sync
            console.log('📱 [PARTICIPANT] DJ returned to foreground');
            setRoomState(prev => ({ ...prev, position: message.data.position }));
          }
          break;

        case 'queue_update':
          setRoomState(prev => ({
            ...prev,
            queue: normalizeQueue(message.data.queue)
          }));
          break;

        case 'aux_passed':
          if (isPlayerReadyRef) isPlayerReadyRef.current = false;
          const nextSongFromMsg = message.data.next_song;
          const isNextDrive = nextSongFromMsg ? resolveSongSource(nextSongFromMsg.source, nextSongFromMsg.videoId) === 'drive' : false;
          setRoomState(prev => ({
            ...prev,
            currentSong: nextSongFromMsg ? {
              ...nextSongFromMsg,
              source: isNextDrive ? 'drive' : (nextSongFromMsg.source || 'youtube'),
              title: nextSongFromMsg.title || (isNextDrive ? 'Drive Video' : 'YouTube Video'),
              channelTitle: nextSongFromMsg.channelTitle || (isNextDrive ? 'Google Drive' : 'YouTube'),
              playSessionId: `${nextSongFromMsg.videoId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            } : null,
            roomName: message.data.room_name || prev.roomName,
            position: 0,
            isPlaying: true
          }));
          break;

        case 'participant_update':
          const updatedParticipants = message.data.participants;
          const myParticipant = updatedParticipants
            .find((p: Participant) => p.user_id === currentUserId);

          setRoomState(prev => ({
            ...prev,
            participants: updatedParticipants,
            isDJ: myParticipant?.is_dj ?? prev.isDJ
          }));
          break;

        case 'dj_switched':
          const newDjId = message.data.new_dj_id;
          const isNowDJ = currentUserId === newDjId;
          const updatedParts = message.data.participants;
          setRoomState(prev => ({
            ...prev,
            isDJ: isNowDJ,
            participants: updatedParts || prev.participants,
            allowedSpeakers: message.data.allowed_speakers || prev.allowedSpeakers,
          }));
          break;

        case 'room_name_update':
          setRoomState(prev => ({
            ...prev,
            roomName: message.data.room_name
          }));
          break;
      }
    });

    return () => {
      unsubscribe();
      if (!(global as any).keepMusicRoomAlive) {
        musicWebSocketService.disconnect();
      }
    };
  }, [roomCode]);

  // DJ Controls
  const loadSong = useCallback((song: Song, customRoomName?: string) => { // ✅ Added param
    const isDrive = resolveSongSource(song.source, song.videoId) === 'drive';
    const songWithSession: Song = {
      ...song,
      source: isDrive ? 'drive' : (song.source || 'youtube'),
      title: song.title || (isDrive ? 'Drive Video' : 'YouTube Video'),
      channelTitle: song.channelTitle || (isDrive ? 'Google Drive' : 'YouTube'),
      playSessionId: `${song.videoId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    };
    setRoomState(prev => ({
      ...prev,
      currentSong: songWithSession,
      roomName: customRoomName || prev.roomName, // ✅ Local update
      position: 0,
      isPlaying: false
    }));
    musicWebSocketService.loadVideo(songWithSession, customRoomName); // ✅ Pass to service
  }, []);

  const syncPlay = useCallback((position: number) => {
    // ✅ 100% Solution: Stop DJ from broadcasting syncs if they are in an ad!
    if (isAdPlayingRef?.current) {
      console.log('🚫 [SYNC BROADCAST] Blocked: Ad is playing');
      return;
    }
    setRoomState(prev => ({ ...prev, isPlaying: true, position }));
    musicWebSocketService.syncPlayback(position, true);
  }, []);

  const syncPause = useCallback((position: number) => {
    // ✅ Also block pause syncs during ads
    if (isAdPlayingRef?.current) return;
    setRoomState(prev => ({ ...prev, isPlaying: false, position }));
    musicWebSocketService.syncPlayback(position, false);
  }, []);

  const syncSeek = useCallback((pos: number) => {
    setRoomState(prev => ({ ...prev, position: pos }));
    musicWebSocketService.syncPlayback(pos, roomStateRef.current.isPlaying);
  }, []);

  const updateLocalPosition = useCallback((pos: number) => {
    setRoomState(prev => ({ ...prev, position: pos }));
  }, []);

  const addToQueue = useCallback((song: Song) => {
    musicWebSocketService.addToQueue(song);
  }, []);

  // ✅ NEW: pin a related video into the caller's own queue. Server enforces
  // the global-FIFO ordering and dedupe — this just sends the request.
  const pinVideo = useCallback((song: Song) => {
    musicWebSocketService.pinVideo(song);
  }, []);

  // ✅ NEW: unpin the caller's own queue item for this videoId. Server
  // enforces that only YOUR pin is removed, regardless of what's sent.
  const unpinVideo = useCallback((videoId: string) => {
    musicWebSocketService.unpinVideo(videoId);
  }, []);

  const passAux = useCallback(() => {
    setRoomState(prev => {
      if (prev.queue && prev.queue.length > 0) {
        const nextItem = prev.queue[0];
        const nextSong = nextItem?.song || nextItem;
        const songWithSession: Song = {
          ...nextSong,
          playSessionId: `${nextSong.videoId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        };
        return {
          ...prev,
          currentSong: songWithSession,
          queue: prev.queue.slice(1),
          position: 0,
          isPlaying: true,
        };
      }
      return prev;
    });
    musicWebSocketService.passAux();
  }, []);

  const updateRoomName = useCallback((newName: string) => {
    setRoomState(prev => ({ ...prev, roomName: newName }));
    musicWebSocketService.updateRoomName(newName);
  }, []);

  const updateCurrentSongMetadata = useCallback((enrichedSong: Song) => {
    setRoomState(prev => ({
      ...prev,
      currentSong: prev.currentSong ? {
        ...prev.currentSong,
        ...enrichedSong,
        source: enrichedSong.source || prev.currentSong.source || 'youtube',
        playSessionId: prev.currentSong.playSessionId,
      } : enrichedSong,
    }));
  }, []);


  const updateMicPermission = useCallback((targetUserId: number, allowed: boolean) => {
    musicWebSocketService.updateMicPermission(targetUserId, allowed);
  }, []);

  const switchDJ = useCallback((targetUserId: number) => {
    musicWebSocketService.switchDJ(targetUserId);
  }, []);

  return {
    roomState,
    setRoomState,
    joinSnapshot,
    isConnected,
    isLoading,
    playerRef,
    updateCurrentSongMetadata,
    updateRoomName,
    updateMicPermission,
    switchDJ,
    loadSong,
    syncPlay,
    syncPause,
    syncSeek,
    updateLocalPosition,
    addToQueue,
    pinVideo,
    unpinVideo,
    passAux,
  };
};