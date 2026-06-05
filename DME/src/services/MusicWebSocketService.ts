// src/services/MusicWebSocketService.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWebSocketUrl } from '../config/network';

export type MusicWSMessage = {
  type:
    | 'room_state'
    | 'watch_load'
    | 'watch_sync'
    | 'queue_update'
    | 'aux_passed'
    | 'participant_update'
    | 'chat_message'
    | 'connection_established';
  data: any;
};

export type MusicWSCallback = (message: MusicWSMessage) => void;

class MusicWebSocketService {
  private ws: WebSocket | null = null;
  private callbacks: Set<MusicWSCallback> = new Set();
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 3000;
  private currentRoomCode: string | null = null;
  private reconnectTimeoutId: any = null;

  async connect(roomCode: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.currentRoomCode = roomCode;
        this.disconnect();

        const token = await AsyncStorage.getItem('access_token');
        if (!token) {
          reject(new Error('No auth token'));
          return;
        }

        // Same URL pattern as your existing services
        const url = getWebSocketUrl(`music/${roomCode}`, token);
        console.log('🎵 Music WS connecting:', url);

        this.ws = new WebSocket(url);

        let resolved = false;

        this.ws.onopen = () => {
          console.log('🎵 Music WS connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const message: MusicWSMessage = JSON.parse(event.data);
            console.log('🎵 Music WS received:', message.type);
            this.callbacks.forEach(cb => cb(message));
          } catch (e) {
            console.error('Music WS parse error:', e);
          }
        };

        this.ws.onerror = (error) => {
          console.error('🎵 Music WS error:', error);
        };

        this.ws.onclose = (event) => {
          console.log('🎵 Music WS closed:', event.code);
          this.isConnected = false;
          if (!resolved) {
            resolved = true;
            reject(new Error(`WS closed: ${event.code}`));
          } else {
            this.attemptReconnect(roomCode);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(roomCode: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    this.reconnectTimeoutId = setTimeout(() => {
      this.connect(roomCode).catch(console.error);
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  // ── Send Methods ──────────────────────────────────

  loadVideo(video: {
    videoId: string;
    title: string;
    thumbnail: string;
    channelTitle: string;
    duration?: number;
  }) {
    this.send({ type: 'watch_load', video });
  }

  syncPlayback(position: number, isPlaying: boolean) {
    this.send({
      type: 'watch_sync',
      position,
      is_playing: isPlaying,
      host_timestamp: Date.now()
    });
  }

  addToQueue(song: {
    videoId: string;
    title: string;
    thumbnail: string;
    channelTitle: string;
    addedBy: string;
  }) {
    this.send({ type: 'queue_add', song });
  }

  passAux() {
    this.send({ type: 'pass_aux' });
  }

  sendChatMessage(text: string) {
    this.send({ type: 'chat_message', text });
  }

  // ── Core ─────────────────────────────────────────

  private send(data: any) {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('🎵 Music WS not connected, dropping:', data.type);
    }
  }

  onMessage(callback: MusicWSCallback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  disconnect() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // ✅ FIX: Prevent reconnection loop
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.currentRoomCode = null;
    }
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }
}

export const musicWebSocketService = new MusicWebSocketService();
export default musicWebSocketService;