// src/hooks/useMusicRoom.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import musicWebSocketService from '../services/MusicWebSocketService';

export interface Participant {
  user_id: number;
  name: string;
  is_dj: boolean;
  avatar?: string;
  avatar_sticker?: string;
}

export interface Song {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  addedBy: string;
  duration?: number;
  source?: 'youtube' | 'drive'; 
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
}

// Backend sends queue items as snake_case
// ({ song, added_by_id, added_by_name, added_by_avatar, pinned_at }).
// This normalizes to the camelCase QueueItem shape the rest of the app uses,
// and tolerates legacy plain-Song queue items (pre-pin-feature data) by
// wrapping them with placeholder attribution so old/new shapes never crash
// the UI during a rolling deploy.
const normalizeQueueItem = (raw: any): QueueItem => {
  if (raw && raw.song) {
    return {
      song: raw.song,
      addedById: raw.added_by_id,
      addedByName: raw.added_by_name ?? 'Someone',
      addedByAvatar: raw.added_by_avatar,
      pinnedAt: raw.pinned_at ?? 0,
    };
  }
  // Legacy shape: queue item WAS the Song itself.
  return {
    song: raw,
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
  const [roomState, setRoomState] = useState<RoomState>({
    roomCode,
    roomName: '', // ✅ Initialized as empty string
    isDJ: false,
    currentSong: null,
    position: 0,
    isPlaying: false,
    queue: [],
    participants: []
  });

  const roomStateRef = useRef(roomState);
  const userIdRef = useRef(userId);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [joinSnapshot, setJoinSnapshot] = useState<{position: number, isPlaying: boolean, receivedAt: number} | null>(null);
  const playerRef = useRef<any>(null);

  // Connect to music room
  useEffect(() => {
    const connectToRoom = async () => {
      try {
        setIsLoading(true);
        await musicWebSocketService.connect(roomCode);
        setIsConnected(true);
      } catch (error) {
        console.error('Failed to connect to music room:', error);
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
          setRoomState(prev => ({
            ...prev,
            isDJ: message.data.is_dj,
            roomName: message.data.room_name || message.data.name || '',
            currentSong: message.data.current_video,
            position: message.data.position,
            isPlaying: message.data.is_playing,
            queue: normalizeQueue(message.data.queue),
            participants: message.data.participants
          }));
          
          // ✅ Save snapshot for the screen to consume on player ready
          setJoinSnapshot({
            position: message.data.position,
            isPlaying: message.data.is_playing,
            receivedAt: Date.now(), // ✅ timestamp for drift compensation
          });
          break;

        case 'watch_load':
          setRoomState(prev => ({
            ...prev,
            currentSong: message.data.video,
            roomName: message.data.room_name || message.data.name || prev.roomName,
            position: 0,
            isPlaying: true
          }));
          break;

        case 'watch_sync':
          // ✅ KEY FIX: ignore syncs while DJ is backgrounded
          if (isDJBackgroundedRef?.current) {
            console.log('📱 [HOOK] Ignoring sync — DJ is backgrounded');
            break;
          }

          const { position, is_playing, host_timestamp, is_dj_background } = message.data;
          // Compensate network delay
          const delay = host_timestamp ? (Date.now() - host_timestamp) / 1000 : 0;
          const syncPos = position + Math.max(0, delay);

          // ✅ If DJ is backgrounded and sync says pause — ignore the pause
          // TrackPlayer keeps playing, WebView keeps playing
          if (!is_playing && is_dj_background) {
            console.log('📱 [PARTICIPANT] Ignoring pause sync — DJ is backgrounded');
            break;
          }

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
          setRoomState(prev => ({
            ...prev,
            currentSong: message.data.next_song,
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
      musicWebSocketService.disconnect();
    };
  }, [roomCode]);

  // DJ Controls
  const loadSong = useCallback((song: Song, customRoomName?: string) => { // ✅ Added param
    setRoomState(prev => ({
      ...prev,
      currentSong: song,
      roomName: customRoomName || prev.roomName, // ✅ Local update
      position: 0,
      isPlaying: false
    }));
    musicWebSocketService.loadVideo(song, customRoomName); // ✅ Pass to service
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
    musicWebSocketService.passAux();
  }, []);

  const updateRoomName = useCallback((newName: string) => {
    setRoomState(prev => ({ ...prev, roomName: newName }));
    musicWebSocketService.updateRoomName(newName);
  }, []);

  const updateCurrentSongMetadata = useCallback((enrichedSong: Song) => {
    setRoomState(prev => ({
      ...prev,
      currentSong: enrichedSong,  // preserve position & isPlaying
    }));
  }, []);


  return {
    roomState,
    joinSnapshot,
    isConnected,
    isLoading,
    playerRef,
    updateCurrentSongMetadata,
    updateRoomName,
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