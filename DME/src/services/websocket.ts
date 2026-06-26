// WebSocket service for real-time chat
// Note: react-native-websocket package usage

import AsyncStorage from '@react-native-async-storage/async-storage';
import { WS_BASE_URL, getWebSocketUrl } from '../config/network';
import api from './api';

export type WebSocketMessage = {
  type:
    | 'message'
    | 'typing'
    | 'read_receipt'
    | 'delivered'
    | 'reaction'
    | 'new_message_summary'
    | 'connection_established';
  data: any;
};

export type WebSocketCallback = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private notificationWs: WebSocket | null = null; // Independent global stream
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 5000;
  private messageQueue: any[] = [];
  private callbacks: Set<WebSocketCallback> = new Set();
  private isConnected = false; // Only for room WS
  private isNotifConnected = false; // For notification WS
  private isLoggedOut = false;
  private currentConversationId: number | string | null = null;
  private reconnectTimeoutId: any = null;
  private lastTypingState: boolean | null = null;

  /**
   * Connect to global notification stream (persistent)
   */
  async connectToNotifications(retries = 3): Promise<void> {
    if (this.isNotifConnected) return; // Already connected
    
    return new Promise(async (resolve, reject) => {
      try {
        const token = await AsyncStorage.getItem('access_token');
        if (token) {
          try {
            await api.get('/accounts/profile/');
          } catch (err) {
            console.warn('WS pre-connect notifications token refresh failed/skipped:', err);
          }
        }
        
        const updatedToken = await AsyncStorage.getItem('access_token');
        
        // Retry logic if token is temporarily missing
        if (!updatedToken && retries > 0) {
            setTimeout(() => this.connectToNotifications(retries - 1).then(resolve).catch(reject), 500);
            return;
        }

        if (!updatedToken) throw new Error('No token');
        
        const url = getWebSocketUrl('notifications', updatedToken);
        console.log('Connecting to Notification WS:', url);
        
        this.notificationWs = new WebSocket(url);
        this.isNotifConnected = true;
        
        this.notificationWs.onmessage = event => {
          try {
            console.log('Notification WS message:', event.data);
            const message: WebSocketMessage = JSON.parse(event.data);
            this.callbacks.forEach(callback => callback(message));
          } catch (e) { console.error('WS parsing error:', e); }
        };

        this.notificationWs.onerror = e => console.error('Notification WS error:', e);
        this.notificationWs.onclose = () => {
             console.log('Notification WS closed, attempting reconnect...');
             this.isNotifConnected = false;
             setTimeout(() => this.connectToNotifications(), 5000);
        };
        
        resolve();
      } catch (e) { reject(e); }
    });
  }

  // Update this IP to match your API_BASE_URL
  private async getWebSocketURL(
    conversationId: number | string,
  ): Promise<string> {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) {
        this.isLoggedOut = true;
        return '';
      }
      return getWebSocketUrl(`chat/${conversationId}`, token);
    } catch (error) {
      console.error('Error getting auth token:', error);
      this.isLoggedOut = true;
      return '';
    }
  }

  async connect(conversationId: number | string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.isLoggedOut = false;
        this.currentConversationId = conversationId;
        this.disconnectRoom();

        try {
          await api.get('/accounts/profile/');
        } catch (err) {
          console.warn('WS pre-connect room token refresh failed/skipped:', err);
        }

        const url = await this.getWebSocketURL(conversationId);
        if (!url) {
          console.log('WebSocket connection skipped - no token');
          reject(new Error('No auth token'));
          return;
        }

        console.log('Connecting to WebSocket:', url);
        this.ws = new WebSocket(url);

        let hasResolved = false;
        let hasRejected = false;

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Send queued messages
          this.messageQueue.forEach(msg => {
            this.ws?.send(JSON.stringify(msg));
          });
          this.messageQueue = [];

          if (!hasResolved && !hasRejected) {
            hasResolved = true;
            resolve();
          }
        };

        this.ws.onmessage = event => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.callbacks.forEach(callback => callback(message));
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onerror = error => {
          console.error('WebSocket error:', error);
        };

        this.ws.onclose = event => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.isConnected = false;

          if (!hasResolved && !hasRejected) {
            hasRejected = true;
            reject(
              new Error(
                `WebSocket closed before connecting (code: ${event.code})`,
              ),
            );
          } else {
            this.attemptReconnect(conversationId);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to WebSocket for chat list updates (not tied to a specific conversation)
   * This is used to listen for read_receipt events globally
   */
  connectToChatList(): void {
    console.log('📋 Chat list WebSocket listener active');
  }

  private attemptReconnect(conversationId: number | string) {
    if (this.isLoggedOut) {
      console.log('WebSocket reconnection skipped - user logged out');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(
        `Reconnecting in ${delay}ms... Attempt ${this.reconnectAttempts}`,
      );

      this.reconnectTimeoutId = setTimeout(async () => {
        const token = await AsyncStorage.getItem('access_token');
        if (!token) {
          this.isLoggedOut = true;
          console.log('WebSocket reconnection cancelled - no token');
          return;
        }
        this.connect(conversationId).catch(console.error);
      }, delay);
    } else {
      console.log('Max WebSocket reconnect attempts reached');
    }
  }

  /**
   * Disconnect the current ROOM connection only
   */
  disconnectRoom() {
    this.lastTypingState = null; // ← reset so next session starts fresh

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.currentConversationId = null;
    }
  }

  /**
   * Permanently disconnect BOTH WebSockets (e.g., on logout)
   */
  disconnectPermanently() {
    this.isLoggedOut = true;
    this.maxReconnectAttempts = 0; 
    
    this.disconnectRoom();
    
    if (this.notificationWs) {
        this.notificationWs.close();
        this.notificationWs = null;
        this.isNotifConnected = false;
    }
    
    this.callbacks.clear();
    this.messageQueue = [];
  }

  reset() {
    this.isLoggedOut = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  sendMessage(content: string, replyToId?: number, duration?: number) {
    const message: any = {
      type: 'message',
      content,
      message_type: 'text',
    };

    if (replyToId) {
      message.reply_to = replyToId;
    }

    if (duration) {
      message.duration = duration;
    }

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  sendTyping(isTyping: boolean) {
    if (this.lastTypingState === isTyping) return; // ← skip if unchanged
    this.lastTypingState = isTyping;

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({ type: 'typing', is_typing: isTyping }));
    }
  }

  sendReadReceipt(messageIds: number[]) {
    const message = {
      type: 'read',
      message_ids: messageIds,
    };

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendDelivered(messageIds: number[]) {
    const message = {
      type: 'delivered',
      message_ids: messageIds,
    };

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendReaction(messageId: number, emoji: string) {
    const message = {
      type: 'reaction',
      message_id: messageId,
      emoji,
    };

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(callback: WebSocketCallback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }
}

export const websocketService = new WebSocketService();
export default websocketService;
