import AsyncStorage from '@react-native-async-storage/async-storage';
import { Song } from '../hooks/useMusicRoom';
import { Image } from 'react-native';

const STORAGE_KEY = '@dme_discovery_home_videos';

class DiscoveryFeedService {
  private static instance: DiscoveryFeedService;
  private homeVideos: Map<string, Song> = new Map();
  private isLoadedFromDisk = false;

  private constructor() {
    this.loadFromDisk();
  }

  public static getInstance(): DiscoveryFeedService {
    if (!DiscoveryFeedService.instance) {
      DiscoveryFeedService.instance = new DiscoveryFeedService();
    }
    return DiscoveryFeedService.instance;
  }

  private async loadFromDisk() {
    if (this.isLoadedFromDisk) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Song[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.videoId) {
              this.homeVideos.set(item.videoId, item);
            }
          }
        }
      }
    } catch (_) {}
    this.isLoadedFromDisk = true;
  }

  private async saveToDisk() {
    try {
      const list = Array.from(this.homeVideos.values()).slice(0, 100);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  /**
   * Ingest fresh video cards harvested from YouTube Home / Search
   */
  public addVideos(newVideos: Song[]): void {
    if (!Array.isArray(newVideos) || newVideos.length === 0) return;

    let addedCount = 0;
    for (const v of newVideos) {
      if (v && v.videoId && !this.homeVideos.has(v.videoId)) {
        const cleanSong: Song = {
          videoId: v.videoId,
          title: v.title || 'YouTube Video',
          channelTitle: v.channelTitle || 'YouTube',
          thumbnail: v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
          addedBy: v.addedBy || 'YouTube',
          source: 'youtube',
        };
        this.homeVideos.set(v.videoId, cleanSong);
        addedCount++;
        // Pre-cache thumbnail into device memory / disk cache
        if (cleanSong.thumbnail) {
          Image.prefetch(cleanSong.thumbnail).catch(() => {});
        }
      }
    }

    if (addedCount > 0) {
      this.saveToDisk();
    }
  }

  /**
   * Get all harvested home videos
   */
  public getVideos(): Song[] {
    return Array.from(this.homeVideos.values());
  }

  /**
   * Smart Recommendation Algorithm:
   * 1. Same channel/artist videos (from home, likes, history)
   * 2. User's liked videos
   * 3. User's watch history
   * 4. YouTube Home screen videos
   */
  public buildSmartRelated(params: {
    currentSong?: Song | null;
    likes?: any[];
    history?: any[];
    queuedIds?: Set<string>;
    limit?: number;
  }): Song[] {
    const { currentSong, likes = [], history = [], queuedIds = new Set(), limit = 20 } = params;
    const currentVideoId = currentSong?.videoId || '';
    const currentChannel = (currentSong?.channelTitle || '').toLowerCase().trim();

    const seenIds = new Set<string>();
    if (currentVideoId) {
      seenIds.add(currentVideoId);
    }
    for (const qId of queuedIds) {
      seenIds.add(qId);
    }

    const sameChannelVideos: Song[] = [];
    const likedVideos: Song[] = [];
    const historyVideos: Song[] = [];
    const homeVideos: Song[] = [];

    // Helper to format item into standard Song
    const toSong = (item: any): Song | null => {
      if (!item) return null;
      const vId = item.videoId || item.video_id;
      if (!vId || seenIds.has(vId)) return null;
      return {
        videoId: vId,
        title: item.title || 'YouTube Video',
        channelTitle: item.channelTitle || item.channel_title || 'YouTube',
        thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
        addedBy: item.addedBy || 'YouTube',
        source: item.source || 'youtube',
      };
    };

    // 1. Process Liked Videos
    for (const raw of likes) {
      const s = toSong(raw);
      if (s) {
        if (currentChannel && s.channelTitle && s.channelTitle.toLowerCase().trim() === currentChannel) {
          sameChannelVideos.push(s);
          seenIds.add(s.videoId);
        } else {
          likedVideos.push(s);
          seenIds.add(s.videoId);
        }
      }
    }

    // 2. Process Watch History
    for (const raw of history) {
      const s = toSong(raw);
      if (s) {
        if (currentChannel && s.channelTitle && s.channelTitle.toLowerCase().trim() === currentChannel) {
          sameChannelVideos.push(s);
          seenIds.add(s.videoId);
        } else {
          historyVideos.push(s);
          seenIds.add(s.videoId);
        }
      }
    }

    // 3. Process Harvested Home Videos
    for (const raw of this.homeVideos.values()) {
      const s = toSong(raw);
      if (s) {
        if (currentChannel && s.channelTitle && s.channelTitle.toLowerCase().trim() === currentChannel) {
          sameChannelVideos.push(s);
          seenIds.add(s.videoId);
        } else {
          homeVideos.push(s);
          seenIds.add(s.videoId);
        }
      }
    }

    // Combine in prioritized order: Same Channel -> Liked -> History -> Home Feed
    const combined: Song[] = [
      ...sameChannelVideos,
      ...likedVideos,
      ...historyVideos,
      ...homeVideos,
    ];

    // If still under limit (e.g. brand new user with empty feed/history), fill from popular music videos
    if (combined.length < limit) {
      for (const fb of DEFAULT_FALLBACK_VIDEOS) {
        const s = toSong(fb);
        if (s) {
          combined.push(s);
          seenIds.add(s.videoId);
          if (combined.length >= limit) break;
        }
      }
    }

    // Pre-cache all selected thumbnails for instant display
    combined.slice(0, limit).forEach(s => {
      if (s.thumbnail) {
        Image.prefetch(s.thumbnail).catch(() => {});
      }
    });

    return combined.slice(0, limit);
  }
}

const DEFAULT_FALLBACK_VIDEOS: Song[] = [
  { videoId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channelTitle: 'Luis Fonsi', thumbnail: 'https://img.youtube.com/vi/kJQP7kiw5Fk/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channelTitle: 'Ed Sheeran', thumbnail: 'https://img.youtube.com/vi/JGwWNGJdvx8/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'OPf0YbXqDm0', title: 'Mark Ronson - Uptown Funk ft. Bruno Mars', channelTitle: 'Mark Ronson', thumbnail: 'https://img.youtube.com/vi/OPf0YbXqDm0/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'RgKAFK5djSk', title: 'Wiz Khalifa - See You Again ft. Charlie Puth', channelTitle: 'Wiz Khalifa', thumbnail: 'https://img.youtube.com/vi/RgKAFK5djSk/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: '09R8_2nJazc', title: 'Maroon 5 - Sugar', channelTitle: 'Maroon 5', thumbnail: 'https://img.youtube.com/vi/09R8_2nJazc/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'hT_nvWreIhg', title: 'OneRepublic - Counting Stars', channelTitle: 'OneRepublic', thumbnail: 'https://img.youtube.com/vi/hT_nvWreIhg/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'CevxZvSJLk8', title: 'Katy Perry - Roar', channelTitle: 'Katy Perry', thumbnail: 'https://img.youtube.com/vi/CevxZvSJLk8/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'YQHsXMglC9A', title: 'Adele - Hello', channelTitle: 'Adele', thumbnail: 'https://img.youtube.com/vi/YQHsXMglC9A/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: '2Vv-BfVoq4g', title: 'Ed Sheeran - Perfect', channelTitle: 'Ed Sheeran', thumbnail: 'https://img.youtube.com/vi/2Vv-BfVoq4g/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'k4V3Mo61fJM', title: 'Imagine Dragons - Bad Liar', channelTitle: 'Imagine Dragons', thumbnail: 'https://img.youtube.com/vi/k4V3Mo61fJM/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'papuvlVeZg8', title: 'Clean Bandit - Rockabye ft. Sean Paul & Anne-Marie', channelTitle: 'Clean Bandit', thumbnail: 'https://img.youtube.com/vi/papuvlVeZg8/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'nfWlot6h_JM', title: 'Taylor Swift - Shake It Off', channelTitle: 'Taylor Swift', thumbnail: 'https://img.youtube.com/vi/nfWlot6h_JM/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'DyDfgMOUjCI', title: 'Billie Eilish - bad guy', channelTitle: 'Billie Eilish', thumbnail: 'https://img.youtube.com/vi/DyDfgMOUjCI/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'I_2D8Eo15wE', title: 'The Weeknd - Blinding Lights', channelTitle: 'The Weeknd', thumbnail: 'https://img.youtube.com/vi/I_2D8Eo15wE/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
  { videoId: 'gNi_6U5Pm_o', title: 'Post Malone, Swae Lee - Sunflower', channelTitle: 'Post Malone', thumbnail: 'https://img.youtube.com/vi/gNi_6U5Pm_o/hqdefault.jpg', addedBy: 'YouTube', source: 'youtube' },
];

export default DiscoveryFeedService.getInstance();
