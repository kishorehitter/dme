/**
 * StatusService.ts
 * All API calls for the WhatsApp/Instagram-style status system.
 */

import api from './api';

// ─── Types ────────────────────────────────────────────────────────────────────
// ... (rest of the types) ...

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

// ─── StatusService ────────────────────────────────────────────────────────────

export const StatusService = {

  /** Fetch all active statuses (own + others) */
  async getStatuses(): Promise<Status[]> {
    try {
      const res = await api.get('/chat/statuses/');
      const data = res.data;
      return Array.isArray(data) ? data : (data.results ?? []);
    } catch (err) {
      console.error('[StatusService] getStatuses error:', err);
      return [];
    }
  },

  async getViewers(statusId: number): Promise<StatusViewer[]> {
    try {
      const res = await api.get(`/chat/statuses/${statusId}/viewers/`);
      return res.data;
    } catch {
      return [];
    }
  },

  async saveStatus(
    mediaUri:  string,
    caption:   string,
    mediaType: 'photo' | 'video',
    restrictedTo?: number[], // Array of user IDs
  ): Promise<Status> {
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
    
    // Add restricted users as JSON string
    if (restrictedTo && restrictedTo.length > 0) {
      form.append('restricted_to', JSON.stringify(restrictedTo));
    }

    const res = await api.post('/chat/statuses/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  /** Delete own status */
  async deleteStatus(statusId: number): Promise<void> {
    await api.delete(`/chat/statuses/${statusId}/`);
  },

  /**
   * Mark a status as viewed by the current user.
   */
  async markViewed(statusId: number): Promise<void> {
    try {
      await api.post(`/chat/statuses/${statusId}/view/`);
    } catch (err) {
      console.warn('[StatusService] markViewed error:', err);
    }
  },

  /**
   * Alias for markViewed — used by StatusViewerScreen.
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

  /** Get the viewer list and like list for a status (owner only) */
  async getInteractions(statusId: number): Promise<{
    viewers: StatusViewer[];
    likes: LikedUser[];
  }> {
    try {
      const [viewersRes, likesRes] = await Promise.all([
        api.get(`/chat/statuses/${statusId}/viewers/`),
        api.get(`/chat/statuses/${statusId}/likes/`)
      ]);

      return { viewers: viewersRes.data, likes: likesRes.data };
    } catch (err) {
      console.error('[StatusService] getInteractions error:', err);
      return { viewers: [], likes: [] };
    }
  },

  async likeStatus(statusId: number): Promise<void> {
    await api.post(`/chat/statuses/${statusId}/like/`);
  },

  async unlikeStatus(statusId: number): Promise<void> {
    await api.delete(`/chat/statuses/${statusId}/like/`);
  },

  async hasLiked(statusId: number): Promise<boolean> {
    try {
      const res = await api.get(`/chat/statuses/${statusId}/liked/`);
      return res.data.liked ?? false;
    } catch {
      return false;
    }
  },

  async getLikeCount(statusId: number): Promise<number> {
    try {
      const res = await api.get(`/chat/statuses/${statusId}/like-count/`);
      return res.data.count ?? 0;
    } catch {
      return 0;
    }
  },

  async replyToStatus(statusId: number, message: string): Promise<void> {
    await api.post(`/chat/statuses/${statusId}/reply/`, { message });
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
      const res = await api.get('/calls/history/');
      const data = res.data;
      return Array.isArray(data) ? data : (data.results ?? []);
    } catch (err) {
      console.error('[CallService] getCallLogs error:', err);
      return [];
    }
  },

  async clearCallLogs(callIds: string[] = []): Promise<void> {
    const isBatchDelete = callIds.length > 0;
    
    await api.delete('/calls/history/', {
      data: {
        call_ids: callIds,
        clear_all: !isBatchDelete 
      }
    });
  },
};