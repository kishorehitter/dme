/**
 * StatusService.ts
 * All API calls for the WhatsApp/Instagram-style status system.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/network';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LikedUser {
  user_id:   number;
  username:  string;
  avatar:    string | null;
  avatar_sticker?: string | null;
  liked_at:  string;
}

export interface Status {
  id:         number;
  user_id:    number;
  username:   string;
  user_avatar: string | null;
  user_avatar_sticker?: string | null;
  media_url:  string;
  media_file: string;
  media_type: 'photo' | 'video';
  caption:    string | null;
  created_at: string;
  view_count: number;
  is_viewed:  boolean;
}

export interface StatusViewer {
  viewer_id:       number;
  viewer_username: string;
  viewer_avatar:   string | null;
  viewer_avatar_sticker?: string | null;
  viewed_at:       string;
}

/** Statuses grouped by user for the tab screen */
export interface UserStatusGroup {
  user_id:     number;
  username:    string;
  user_avatar: string | null;
  user_avatar_sticker?: string | null;
  statuses:    Status[];
  /** true if ANY status in this group is unseen by the current user */
  has_unseen:  boolean;
  latest_at:   string;
}

export interface CallLog {
  id:                 string;
  other_party:        { id: number; name: string; email: string } | null;
  other_party_avatar: string | null;
  other_party_avatar_sticker?: string | null;
  call_type:          'audio' | 'video';
  status:             'initiated' | 'ringing' | 'accepted' | 'rejected' | 'ended' | 'missed';
  started_at:         string;
  ended_at:           string | null;
  duration:           number | null;
  is_caller:          boolean;
}

// ─── Auth header helper ───────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('access_token');
  return {
    Authorization: `Bearer ${token}`,
  };
}

// ─── StatusService ────────────────────────────────────────────────────────────

export const StatusService = {

  /** Fetch all active statuses (own + others) */
  async getStatuses(): Promise<Status[]> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/chat/statuses/`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : (data.results ?? []);
    } catch (err) {
      console.error('[StatusService] getStatuses error:', err);
      return [];
    }
  },

  /**
   * Upload a new status.
   * @param mediaUri   Local file URI
   * @param caption    Optional caption text
   * @param mediaType  'photo' | 'video'
   */
  async saveStatus(
    mediaUri:  string,
    caption:   string,
    mediaType: 'photo' | 'video',
  ): Promise<Status> {
    const token = await AsyncStorage.getItem('access_token');

    const form = new FormData();
    const filename  = mediaUri.split('/').pop() ?? 'upload';
    const mimeType  = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

    form.append('media_file', {
      uri:  mediaUri,
      name: filename,
      type: mimeType,
    } as any);

    form.append('media_type', mediaType);
    if (caption?.trim()) form.append('caption', caption.trim());

    const res = await fetch(`${API_BASE_URL}/chat/statuses/`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed (${res.status}): ${err}`);
    }

    return res.json();
  },

  /** Delete own status */
  async deleteStatus(statusId: number): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}/chat/statuses/${statusId}/`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Delete failed (${res.status})`);
    }
  },

  /**
   * Mark a status as viewed by the current user.
   * YOUR EXISTING METHOD — aliased as recordView() below so new screens
   * can call either name without breaking anything.
   */
  async markViewed(statusId: number): Promise<void> {
    try {
      const headers = await authHeaders();
      await fetch(`${API_BASE_URL}/chat/statuses/${statusId}/view/`, {
        method: 'POST',
        headers,
      });
    } catch (err) {
      console.warn('[StatusService] markViewed error:', err);
    }
  },

  /**
   * Alias for markViewed — used by StatusViewerScreen.
   * Keeps new screens consistent without renaming your existing method.
   */
  async recordView(statusId: number): Promise<void> {
    return StatusService.markViewed(statusId);
  },

  /**
   * Fetch the live view count for a single status.
   */
  async getViewCount(statusId: number): Promise<number> {    try {
      const viewers = await StatusService.getViewers(statusId);
      return viewers.length;
    } catch {
      return 0;
    }
  },

  /** Get the viewer list for a status (owner only) */
  async getViewers(statusId: number): Promise<{
    viewers: StatusViewer[];
    like_count: number;
    liked_users: LikedUser[];
  }> {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API_BASE_URL}/chat/statuses/${statusId}/viewers/`,
        { headers },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      console.error('[StatusService] getViewers error:', err);
      return { viewers: [], like_count: 0, liked_users: [] };
    }
  },

  // ─── NEW: Like / Unlike ────────────────────────────────────────────────────
  // Backend endpoints needed:
  //   POST   /chat/statuses/<id>/like/    → 204
  //   DELETE /chat/statuses/<id>/like/    → 204
  //   GET    /chat/statuses/<id>/liked/   → { liked: boolean }
  //   GET    /chat/statuses/<id>/like-count/ → { count: number }

  async likeStatus(statusId: number): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}/chat/statuses/${statusId}/like/`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) throw new Error(`Like failed (${res.status})`);
  },

  async unlikeStatus(statusId: number): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}/chat/statuses/${statusId}/like/`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) throw new Error(`Unlike failed (${res.status})`);
  },

  async hasLiked(statusId: number): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API_BASE_URL}/chat/statuses/${statusId}/liked/`,
        { headers },
      );
      if (!res.ok) return false;
      const data = await res.json();
      return data.liked ?? false;
    } catch {
      return false;
    }
  },

  async getLikeCount(statusId: number): Promise<number> {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API_BASE_URL}/chat/statuses/${statusId}/like-count/`,
        { headers },
      );
      if (!res.ok) return 0;
      const data = await res.json();
      return data.count ?? 0;
    } catch {
      return 0;
    }
  },

  // ─── NEW: Reply ────────────────────────────────────────────────────────────
  // Backend endpoint needed:
  //   POST /chat/statuses/<id>/reply/   body: { message: string } → 204
  // Route the message into your existing DM / Message model.

  async replyToStatus(statusId: number, message: string): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(
      `${API_BASE_URL}/chat/statuses/${statusId}/reply/`,
      {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail ?? `Reply failed (${res.status})`);
    }
  },

  /**
   * Group a flat status array by user for the tab screen.
   * Own statuses are separated out before calling this.
   */
  groupByUser(statuses: Status[]): UserStatusGroup[] {
    const map = new Map<number, UserStatusGroup>();

    for (const s of statuses) {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, {
          user_id:     s.user_id,
          username:    s.username,
          user_avatar: s.user_avatar,
          user_avatar_sticker: s.user_avatar_sticker,
          statuses:    [],
          has_unseen:  false,
          latest_at:   s.created_at,
        });
      }
      const group = map.get(s.user_id)!;
      group.statuses.push(s);
      if (!s.is_viewed) group.has_unseen = true;
      if (s.created_at > group.latest_at) group.latest_at = s.created_at;
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;
      return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
    });
  },
};

// ─── CallService ──────────────────────────────────────────────────────────────

export const CallService = {
  async getCallLogs(): Promise<CallLog[]> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/calls/history/`, { headers });
      console.log('[CallService] getCallLogs raw response:', res);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('[CallService] getCallLogs parsed data:', data);
      return Array.isArray(data) ? data : (data.results ?? []);
    } catch (err) {
      console.error('[CallService] getCallLogs error:', err);
      return [];
    }
  },
};