// src/hooks/useMusicRoom.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import musicWebSocketService from '../services/MusicWebSocketService';

export interface Participant {
  user_id: number;
  name: string;
  is_dj: boolean;
  avatar?: string;
}

export interface Song {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  addedBy: string;
}

export interface RoomState {
  roomCode: string;
  isDJ: boolean;
  currentSong: Song | null;
  position: number;
  isPlaying: boolean;
  queue: Song[];
  participants: Participant[];
}

export const useMusicRoom = (roomCode: string, userId: number) => {
  const [roomState, setRoomState] = useState<RoomState>({
    roomCode,
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
            currentSong: message.data.current_video,
            position: message.data.position,
            isPlaying: message.data.is_playing,
            queue: message.data.queue,
            participants: message.data.participants
          }));
          // Seek to current position if song playing
          if (message.data.current_video && message.data.position > 0) {
            playerRef.current?.seekTo(message.data.position, true);
          }
          break;

        case 'watch_load':
          setRoomState(prev => ({
            ...prev,
            currentSong: message.data.video,
            position: 0,
            isPlaying: true
          }));
          break;

        case 'watch_sync':
          const { position, is_playing, host_timestamp } = message.data;
          // Compensate network delay
          const delay = host_timestamp ? (Date.now() - host_timestamp) / 1000 : 0;
          const syncPos = position + Math.max(0, delay);

          setRoomState(prev => ({
            ...prev,
            position: syncPos,
            isPlaying: is_playing
          }));

          // Only seek/play if listener (not DJ) and position diff > 2s
          if (!currentState.isDJ && playerRef.current) {
            const currentTime = await playerRef.current.getCurrentTime();
            if (Math.abs(currentTime - syncPos) > 2.5) {
                playerRef.current.seekTo(syncPos, true);
            }
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
      }
    });

    return () => {
      unsubscribe();
      musicWebSocketService.disconnect();
    };
  }, [roomCode]);

  // DJ Controls
  const loadSong = useCallback((song: Song) => {
    setRoomState(prev => ({
      ...prev,
      currentSong: song,
      position: 0,
      isPlaying: false
    }));
    musicWebSocketService.loadVideo(song);
  }, []);

  const syncPlay = useCallback((position: number) => {
    setRoomState(prev => ({ ...prev, isPlaying: true, position }));
    musicWebSocketService.syncPlayback(position, true);
  }, []);

  const syncPause = useCallback((position: number) => {
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

  const updateCurrentSongMetadata = useCallback((enrichedSong: Song) => {
    setRoomState(prev => ({
      ...prev,
      currentSong: enrichedSong,  // preserve position & isPlaying
    }));
  }, []);


  return {
    roomState,
    isConnected,
    isLoading,
    playerRef,
    updateCurrentSongMetadata,
    loadSong,
    syncPlay,
    syncPause,
    syncSeek,
    updateLocalPosition,
    addToQueue,
    passAux,
    
  };
};