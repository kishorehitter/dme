// WebSocket service for real-time chat
// Note: react-native-websocket package usage

import AsyncStorage from '@react-native-async-storage/async-storage';
import { WS_BASE_URL, getWebSocketUrl } from '../config/network';

export type WebSocketMessage = {
  type:
    | 'message'
    | 'typing'
    | 'read_receipt'
    | 'delivered'
    | 'reaction'
    | 'connection_established';
  data: any;
};

export type WebSocketCallback = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 5000; // 5 seconds base delay
  private messageQueue: any[] = [];
  private callbacks: Set<WebSocketCallback> = new Set();
  private isConnected = false;
  private isLoggedOut = false;
  private currentConversationId: number | string | null = null;
  private reconnectTimeoutId: any = null;

  // Update this IP to match your API_BASE_URL
  private async getWebSocketURL(
    conversationId: number | string,
  ): Promise<string> {
    // For Android emulator: ws://10.0.2.2:8000/ws/chat/{id}/
    // For iOS simulator: ws://localhost:8000/ws/chat/{id}/
    // Token is passed in query param for authentication
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
        this.disconnect();

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
          // Don't reject immediately - wait for onclose to determine actual state
          // WebSocket can fire errors for transient issues but still connect
        };

        this.ws.onclose = event => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.isConnected = false;

          // If we never resolved/rejected, do so now
          if (!hasResolved && !hasRejected) {
            hasRejected = true;
            reject(
              new Error(
                `WebSocket closed before connecting (code: ${event.code})`,
              ),
            );
          } else {
            // Only attempt reconnect if we were previously connected
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
    // For chat list, we don't connect to a specific conversation
    // Instead, we rely on the chat room connections to broadcast events
    // This method is a placeholder for future global WebSocket connection
    console.log('📋 Chat list WebSocket listener active');
  }

  private attemptReconnect(conversationId: number | string) {
    // Don't reconnect if logged out
    if (this.isLoggedOut) {
      console.log('WebSocket reconnection skipped - user logged out');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      // Exponential backoff: 5s, 10s, 15s
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(
        `Reconnecting in ${delay}ms... Attempt ${this.reconnectAttempts}`,
      );

      this.reconnectTimeoutId = setTimeout(async () => {
        // Check if still logged in before reconnecting
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

  disconnect() {
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
   * Permanently disconnect WebSocket (e.g., on logout)
   */
  disconnectPermanently() {
    this.isLoggedOut = true;
    this.maxReconnectAttempts = 0; // Prevent any reconnection
    this.disconnect();
    this.callbacks.clear();
    this.messageQueue = [];
  }

  /**
   * Reset logout state for new login
   */
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
    const message = {
      type: 'typing',
      is_typing: isTyping,
    };

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify(message));
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

  /**
   * Note: delivered events are sent by backend when receiver fetches messages
   * This is just for type completeness
   */
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
