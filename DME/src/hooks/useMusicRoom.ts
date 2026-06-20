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

export interface RoomState {
  roomCode: string;
  roomName?: string; // ✅ Made optional
  isDJ: boolean;
  currentSong: Song | null;
  position: number;
  isPlaying: boolean;
  queue: Song[];
  participants: Participant[];
}

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
            queue: message.data.queue,
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

          // Only seek/play if listener (not DJ) and position diff > 2s
          if (!currentState.isDJ && playerRef.current) {
            // ✅ Expert Fix: Guard every sync seek
            if (!isPlayerReadyRef?.current) return;
            
            // ✅ 100% Solution: Block sync seeks if an ad is playing!
            if (isAdPlayingRef?.current) {
               console.log('🚫 [SYNC] Blocked: Ad is playing');
               return;
            }
            
            // ✅ Expert Fix: 3-second cooldown after ready
            if (playerReadyTimeRef && (Date.now() - playerReadyTimeRef.current < 3000)) {
               console.log('⏳ [SYNC] Skipping: In post-ready cooldown');
               return;
            }

            const currentTime = await playerRef.current.getCurrentTime();
            if (Math.abs(currentTime - syncPos) > 1.2) {
                playerRef.current.seekTo(syncPos, true);
            }
          }
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
            queue: message.data.queue
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
    passAux,
  };
};