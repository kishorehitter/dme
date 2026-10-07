import { DeviceEventEmitter } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AuthTokens,
  AuthResponse,
  LoginCredentials,
  RegisterData,
  OTPRequest,
  OTPVerify,
} from '../types';
import { API_BASE_URL } from '../config/network';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

console.log('DEBUG: api instance initialized:', !!api);

// Request interceptor...
api.interceptors.request.use(
  async config => {
    console.log('DEBUG: api request config:', config.url);
    const token = await AsyncStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    console.error('DEBUG: api request error:', error);
    return Promise.reject(error);
  },
);


// Response interceptor to handle token refresh
api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await AsyncStorage.getItem('refresh_token');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(
          `${API_BASE_URL}/accounts/token/refresh/`,
          {
            refresh: refreshToken,
          },
        );

        const { access, refresh } = response.data;
        await AsyncStorage.setItem('access_token', access);
        
        // Save the new refresh token if the server returned one (token rotation)
        if (refresh) {
          await AsyncStorage.setItem('refresh_token', refresh);
        }

        originalRequest.headers.Authorization = `Bearer ${access}`;
        return api(originalRequest);
      } catch (refreshError: any) {
        const status = refreshError.response?.status;
        // Only wipe credentials if the server returned a 400 or 401 (explicit token expiration or invalidation).
        // Do not wipe on network issues (e.g. timeout, no response) or server errors (5xx) to prevent auto-logout.
        if (status === 400 || status === 401) {
          console.warn('[api.ts] Refresh token is invalid or expired. Wiping credentials and logging out.');
          await AsyncStorage.multiRemove([
            'access_token',
            'refresh_token',
            'user',
          ]);
          DeviceEventEmitter.emit('force_logout');
        } else {
          console.log('[api.ts] Token refresh failed due to network or server error. Retaining credentials.', refreshError.message || refreshError);
        }
        throw refreshError;
      }
    }

    return Promise.reject(error);
  },
);

// Auth API
export const authAPI = {
  register: async (
    data: RegisterData,
  ): Promise<{ message: string; email: string }> => {
    const response = await api.post('/accounts/register/', data);
    return response.data;
  },

  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await api.post('/accounts/login/', credentials);
    return response.data;
  },

  googleLogin: async (idToken: string): Promise<AuthResponse> => {
    const response = await api.post('/accounts/google/', { id_token: idToken });
    return response.data;
  },

  logout: async (refreshToken: string): Promise<{ message: string }> => {
    const response = await api.post('/accounts/logout/', {
      refresh_token: refreshToken,
    });
    return response.data;
  },

  deleteAccount: async (): Promise<{ message: string }> => {
    const response = await api.delete('/accounts/delete-account/');
    return response.data;
  },

  requestOTP: async (email: string): Promise<{ message: string }> => {
    const response = await api.post('/accounts/request-otp/', { email });
    return response.data;
  },

  verifyOTP: async (data: OTPVerify): Promise<AuthResponse> => {
    const response = await api.post('/accounts/verify-otp/', data);
    return response.data;
  },

  getProfile: async () => {
    const response = await api.get('/accounts/profile/');
    return response.data;
  },

  updateProfile: async (data: Partial<RegisterData>): Promise<any> => {
    const response = await api.patch('/accounts/profile/update/', data);
    return response.data;
  },

  checkUsername: async (username: string): Promise<{ available: boolean }> => {
    const response = await api.post('/accounts/username/check/', { username });
    return response.data;
  },

  completeProfileSetup: async (data: any): Promise<any> => {
    // Ensure 'Content-Type' is set to 'multipart/form-data' for FormData
    const response = await api.patch('/accounts/profile/setup/', data, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
    return response.data;
  },

  getUserProfile: async (userId: number): Promise<any> => {
    const response = await api.get(`/accounts/users/${userId}/`);
    return response.data;
  },
};

// Chat API
export const chatAPI = {
  getConversations: async () => {
    const response = await api.get('/chat/conversations/');
    return response.data;
  },

  getConversation: async (id: number) => {
    const response = await api.get(`/chat/conversations/${id}/detail/`);
    return response.data;
  },

  createConversation: async (data: any) => {
    const isFormData = data instanceof FormData;
    const response = await api.post('/chat/conversations/', data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {},
    });
    return response.data;
  },

  updateConversationProfile: async (id: number, data: FormData) => {
    const response = await api.patch(`/chat/conversations/${id}/update-profile/`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  removeConversationProfile: async (id: number) => {
    const response = await api.patch(`/chat/conversations/${id}/update-profile/`, {
      profile_picture: null,
    });
    return response.data;
  },

  getMessages: async (conversationId: number) => {
    const response = await api.get(
      `/chat/conversations/${conversationId}/messages/`,
    );
    return response.data;
  },

  sendMessage: async (
    conversationId: number,
    content: string,
    messageType: string = 'text',
  ) => {
    const response = await api.post(
      `/chat/conversations/${conversationId}/messages/`,
      {
        content,
        message_type: messageType,
      },
    );
    return response.data;
  },

  sendMediaMessage: async (
    conversationId: number,
    file: any,
    messageType: 'audio' | 'image' | 'document' | 'video',
    content?: string,
  ) => {
    const formData = new FormData();
    formData.append('message_type', messageType);
    formData.append('media_file', {
      uri: file.uri,
      type: file.type || 'application/octet-stream',
      name: file.name || `file_${Date.now()}`,
    } as any);
    if (content) {
      formData.append('content', content);
    }

    const response = await api.post(
      `/chat/conversations/${conversationId}/messages/`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );
    return response.data;
  },

  approveMessageRequest: async (conversationId: number) => {
    const response = await api.post(`/chat/message-requests/${conversationId}/approve/`);
    return response.data;
  },

  rejectMessageRequest: async (conversationId: number) => {
    const response = await api.post(`/chat/message-requests/${conversationId}/reject/`);
    return response.data;
  },

  markAsRead: async (conversationId: number) => {
    const response = await api.post(
      `/chat/conversations/${conversationId}/mark-read/`,
    );
    return response.data;
  },

  markConversationAsRead: async (conversationId: number) => {
    const response = await api.post(
      `/chat/conversations/${conversationId}/mark-read/`,
    );
    return response.data;
  },

  clearChat: async (conversationId: number) => {
    const response = await api.post(
      `/chat/conversations/${conversationId}/clear/`,
    );
    return response.data;
  },

  deleteConversation: async (conversationId: number) => {
    const response = await api.delete(
      `/chat/conversations/${conversationId}/delete/`,
    );
    return response.data;
  },

  deleteAllConversations: async () => {
    const response = await api.post('/chat/conversations/delete_all/');
    return response.data;
  },


  searchUsers: async (query: string) => {
    const response = await api.get(`/chat/users/search/?q=${query}`);
    return response.data;
  },

  getOrCreateDirectChat: async (userId: number) => {
    const response = await api.get(`/chat/users/${userId}/chat/`);
    return response.data;
  },

  updateConversation: async (id: number, data: { name?: string; description?: string }) => {
    const response = await api.patch(`/chat/conversations/${id}/`, data);
    return response.data;
  },

  addParticipant: async (conversationId: number, userIds: number[]) => {
    const response = await api.post(`/chat/conversations/${conversationId}/add-participants/`, { user_ids: userIds });
    return response.data;
  },

  removeParticipant: async (conversationId: number, userId: number) => {
    const response = await api.post(`/chat/conversations/${conversationId}/remove-participant/`, { user_id: userId });
    return response.data;
  },

  editMessage: async (messageId: number, content: string) => {
    const response = await api.put(`/chat/messages/${messageId}/edit/`, {
      content,
    });
    return response.data;
  },

  deleteMessage: async (messageId: number, forEveryone: boolean = true) => {
    const response = await api.delete(`/chat/messages/${messageId}/delete/?for_everyone=${forEveryone}`);
    return response.data;
  },

  getMessage: async (messageId: number) => {
    const response = await api.get(
      `/chat/conversations/0/messages/${messageId}/`,
    );
    return response.data;
  },

  // ── Friend Requests ────────────────────────────────────────────────────────
  getFriendRequests: async () => {
    const response = await api.get('/chat/friends/requests/');
    return response.data;
  },

  sendFriendRequest: async (userId: number) => {
    const response = await api.post('/chat/friends/requests/', { user_id: userId });
    return response.data;
  },

  acceptFriendRequest: async (requestId: number) => {
    const response = await api.post(`/chat/friends/requests/${requestId}/accept/`);
    return response.data;
  },

  rejectFriendRequest: async (requestId: number) => {
    const response = await api.post(`/chat/friends/requests/${requestId}/reject/`);
    return response.data;
  },

  cancelFriendRequest: async (requestId: number) => {
    const response = await api.delete(`/chat/friends/requests/${requestId}/`);
    return response.data;
  },

  // Cancel a friend request when you only know the target user's ID (not the requestId)
  cancelFriendRequestByUserId: async (userId: number) => {
    const response = await api.delete(`/chat/friends/requests/${userId}/`);
    return response.data;
  },

  getFriends: async () => {
    const response = await api.get('/chat/friends/');
    return response.data;
  },

  unfriend: async (userId: number) => {
    const response = await api.delete(`/chat/friends/${userId}/`);
    return response.data;
  },

  // ── Message Requests ───────────────────────────────────────────────────────
  getMessageRequests: async () => {
    const response = await api.get('/chat/message-requests/');
    return response.data;
  },

  acceptMessageRequest: async (requestId: number) => {
    const response = await api.post(`/chat/message-requests/${requestId}/accept/`);
    return response.data;
  },

  rejectMessageRequestById: async (requestId: number) => {
    const response = await api.post(`/chat/message-requests/${requestId}/reject/`);
    return response.data;
  },
};


// FCM API
export const fcmAPI = {
  registerDevice: async (
    deviceId: string,
    token: string,
    platform: 'android' | 'ios' | 'web',
  ) => {
    const response = await api.post('/fcm/register/', {
      device_id: deviceId,
      registration_token: token,
      platform,
    });
    return response.data;
  },

  getDevices: async () => {
    const response = await api.get('/fcm/list/');
    return response.data;
  },

  removeDevice: async (deviceId: string) => {
    const response = await api.post('/fcm/remove/', { device_id: deviceId });
    return response.data;
  },

  testNotification: async (title: string, body: string) => {
    const response = await api.post('/fcm/test/', { title, body });
    return response.data;
  },
};

// Music API
export const musicAPI = {
  searchYouTube: async (query: string, maxResults: number = 15) => {
    const response = await api.post('/music/youtube/search/', { query, maxResults });
    return response.data;
  },
  getRelatedVideos: async (videoId: string) => {
    const response = await api.post('/music/youtube/related/', { videoId });
    return response.data;
  },
  recordWatchHistory: async (video: { video_id: string; title: string; thumbnail?: string; channel_title?: string; source?: string }) => {
    const response = await api.post('/music/history/', video);
    return response.data;
  },
  getWatchHistory: async () => {
    const response = await api.get('/music/history/');
    return response.data;
  },
  deleteHistoryItem: async (videoId: string, source: string = 'youtube') => {
    const response = await api.delete(`/music/history/?video_id=${videoId}&source=${source}`);
    return response.data;
  },
  clearHistory: async () => {
    const response = await api.delete('/music/history/');
    return response.data;
  },
  getLikes: async () => {
    const response = await api.get('/music/likes/');
    return response.data;
  },
  toggleLike: async (video: { video_id: string; title: string; thumbnail?: string; channel_title?: string; source?: string }) => {
    const response = await api.post('/music/likes/toggle/', video);
    return response.data;
  },
  removeLike: async (videoId: string, source: string = 'youtube') => {
    const response = await api.delete(`/music/likes/?video_id=${videoId}&source=${source}`);
    return response.data;
  },
  // ── Direct stream URL extraction (yt-dlp backend) ─────────────────────────
  // Returns available quality levels with direct googlevideo.com URLs.
  // Falls back gracefully — caller must handle errors.
  getStreams: async (videoId: string): Promise<{
    video_id: string;
    title: string;
    duration: number;
    streams: Array<{
      height: number;
      width: number;
      quality: string;
      label: string;
      url: string;
      has_audio: boolean;
      vcodec: string;
      acodec: string | null;
      ext: string;
    }>;
    dash_url: string | null;
    best_audio: { url: string; acodec: string; abr: number; ext: string } | null;
  }> => {
    const response = await api.get(`/music/youtube/stream/${videoId}/`);
    return response.data;
  },
  getYoutubeStream: async (videoId: string) => {
    return musicAPI.getStreams(videoId);
  },
};

// Calls API
export const callsAPI = {
  initiateCall: async (receiverId: number, callType: 'audio' | 'video' = 'audio', offerSdp?: string) => {
    const response = await api.post('/calls/initiate/', {
      receiver_id: receiverId,
      call_type: callType,
      offer_sdp: offerSdp,
    });
    return response.data;
  },

  initiateGroupCall: async (conversationId: number, callType: 'audio' | 'video' = 'audio') => {
    const response = await api.post('/calls/group/initiate/', {
      conversation_id: conversationId,
      call_type: callType,
    });
    return response.data;
  },

  joinGroupCall: async (callId: number) => {
    const response = await api.post(`/calls/group/${callId}/join/`);
    return response.data;
  },

  inviteToGroupCall: async (receiverId: number, roomName: string, callId: number, callType: 'audio' | 'video') => {
    const response = await api.post('/calls/group/invite/', {
      receiver_id: receiverId,
      room_name: roomName,
      call_id: callId,
      call_type: callType,
    });
    return response.data;
  },

  endCall: async (callId: number) => {
    const response = await api.post('/calls/end/', { call_id: callId });
    return response.data;
  },

  getHistory: async () => {
    const response = await api.get('/calls/history/');
    return response.data;
  },
};

export const triviaAPI = {
  /** Creates a one-time challenge link and sends it as a chat message to the friend */
  createChallenge: async (friendId: number, categoryId: string, setId: string) => {
    const response = await api.post('/trivia/challenge/create/', {
      friend_id: friendId,
      category: categoryId,
      set_id: setId,
    });
    return response.data;
  },

  /** Claims a challenge token — marks it used and returns category + set_id */
  claimChallenge: async (token: string) => {
    const response = await api.post('/trivia/challenge/claim/', { token });
    return response.data as { category: string; set_id: string; challenger_name: string };
  },

  /** Legacy: send FCM-only challenge (kept as fallback, not used in UI) */
  sendChallenge: async (friendId: number, categoryId: string, setId: string) => {
    const response = await api.post('/fcm/trivia/challenge/', {
      friend_id: friendId,
      category: categoryId,
      set_id: setId,
    });
    return response.data;
  },
};

export default api;
