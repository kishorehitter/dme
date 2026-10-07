/**
 * ChatThemeService.ts
 * Industrial standard chat room theme and wallpaper service.
 * Supports preset palettes, gradient bubbles, and custom photo wallpapers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ChatTheme {
  id: string;
  name: string;
  isDark: boolean;
  background: {
    type: 'solid' | 'gradient' | 'image';
    colors?: string[]; // for LinearGradient background
    solidColor?: string;
    imageUrl?: string;
    overlayDim?: number; // 0 to 0.8 dark tint over custom wallpaper
  };
  myBubble: {
    gradient?: string[]; // LinearGradient colors
    solidColor?: string;
    textColor: string;
    timeColor: string;
  };
  theirBubble: {
    backgroundColor: string;
    textColor: string;
    timeColor: string;
  };
  accentColor: string;
}

const CHAT_THEME_STORAGE_PREFIX = '@dme_chat_theme_';
const GLOBAL_CHAT_THEME_KEY = '@dme_global_chat_theme';

export const CHAT_THEME_PRESETS: ChatTheme[] = [
  {
    id: 'default',
    name: 'Default Classic',
    isDark: true,
    background: {
      type: 'solid',
      solidColor: 'transparent',
    },
    myBubble: {
      solidColor: '#243B53', // Plain Matte Faded Navy Blue
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.75)',
    },
    theirBubble: {
      backgroundColor: '#EAECEF', // Elegant light grayish
      textColor: '#111B21',
      timeColor: '#667781',
    },
    accentColor: '#243B53',
  },
  {
    id: 'instagram_sunset',
    name: 'Instagram Sunset',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#160824', '#0B0410', '#1F0A2E'],
    },
    myBubble: {
      gradient: ['#FA709A', '#FEE140'],
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.85)',
    },
    theirBubble: {
      backgroundColor: '#26123A',
      textColor: '#FBE8FF',
      timeColor: 'rgba(251, 232, 255, 0.5)',
    },
    accentColor: '#FA709A',
  },
  {
    id: 'cyberpunk_neon',
    name: 'Cyberpunk Neon',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#070B14', '#0F172A', '#050811'],
    },
    myBubble: {
      gradient: ['#00F2FE', '#4FACFE'],
      textColor: '#020C1B',
      timeColor: 'rgba(2, 12, 27, 0.65)',
    },
    theirBubble: {
      backgroundColor: '#1E293B',
      textColor: '#E2E8F0',
      timeColor: 'rgba(226, 232, 240, 0.5)',
    },
    accentColor: '#00F2FE',
  },
  {
    id: 'emerald_velvet',
    name: 'Emerald Garden',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#051512', '#0A241F', '#04100E'],
    },
    myBubble: {
      gradient: ['#00C978', '#007F5F'],
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.8)',
    },
    theirBubble: {
      backgroundColor: '#14332B',
      textColor: '#E8F5F1',
      timeColor: 'rgba(232, 245, 241, 0.5)',
    },
    accentColor: '#00C978',
  },
  {
    id: 'lavender_dream',
    name: 'Lavender Dream',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#170F24', '#0E0917', '#221535'],
    },
    myBubble: {
      gradient: ['#B06AB3', '#4568DC'],
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.8)',
    },
    theirBubble: {
      backgroundColor: '#271B3B',
      textColor: '#F5EDFF',
      timeColor: 'rgba(245, 237, 255, 0.5)',
    },
    accentColor: '#B06AB3',
  },
  {
    id: 'midnight_oled',
    name: 'Midnight OLED',
    isDark: true,
    background: {
      type: 'solid',
      solidColor: '#000000',
    },
    myBubble: {
      gradient: ['#2F80ED', '#0056C6'],
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.8)',
    },
    theirBubble: {
      backgroundColor: '#18181B',
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.5)',
    },
    accentColor: '#2F80ED',
  },
  {
    id: 'ocean_abyss',
    name: 'Ocean Abyss',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#031024', '#020B1A', '#061C38'],
    },
    myBubble: {
      gradient: ['#00C9FF', '#92FE9D'],
      textColor: '#011A24',
      timeColor: 'rgba(1, 26, 36, 0.65)',
    },
    theirBubble: {
      backgroundColor: '#0F2644',
      textColor: '#E0F2FE',
      timeColor: 'rgba(224, 242, 254, 0.5)',
    },
    accentColor: '#00C9FF',
  },
  {
    id: 'crimson_flame',
    name: 'Crimson Flame',
    isDark: true,
    background: {
      type: 'gradient',
      colors: ['#1F080C', '#120407', '#2A0B11'],
    },
    myBubble: {
      gradient: ['#FF416C', '#FF4B2B'],
      textColor: '#FFFFFF',
      timeColor: 'rgba(255, 255, 255, 0.85)',
    },
    theirBubble: {
      backgroundColor: '#331219',
      textColor: '#FFE4E8',
      timeColor: 'rgba(255, 228, 232, 0.5)',
    },
    accentColor: '#FF416C',
  },
];

// In-memory synchronous cache for 0ms instant theme rendering
const themeCache = new Map<string, ChatTheme>();

export const ChatThemeService = {
  /**
   * Synchronously gets cached theme for 0ms instant rendering
   */
  getCachedTheme(conversationId?: number | string): ChatTheme {
    if (conversationId && themeCache.has(`conv_${conversationId}`)) {
      return themeCache.get(`conv_${conversationId}`)!;
    }
    if (themeCache.has('global')) {
      return themeCache.get('global')!;
    }
    return CHAT_THEME_PRESETS[0];
  },

  /**
   * Retrieves theme preset by ID
   */
  getPresetById(id: string): ChatTheme {
    const found = CHAT_THEME_PRESETS.find(p => p.id === id);
    return found || CHAT_THEME_PRESETS[0];
  },

  /**
   * Gets effective chat theme for a specific conversation
   */
  async getChatTheme(conversationId?: number | string): Promise<ChatTheme> {
    try {
      if (conversationId) {
        const key = `conv_${conversationId}`;
        if (themeCache.has(key)) {
          return themeCache.get(key)!;
        }
        const stored = await AsyncStorage.getItem(`${CHAT_THEME_STORAGE_PREFIX}${conversationId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          const resolved = parsed.id === 'custom_wallpaper'
            ? (parsed as ChatTheme)
            : this.getPresetById(parsed.id || parsed);
          themeCache.set(key, resolved);
          return resolved;
        }
      }

      // Check global chat theme
      if (themeCache.has('global')) {
        return themeCache.get('global')!;
      }
      const globalStored = await AsyncStorage.getItem(GLOBAL_CHAT_THEME_KEY);
      if (globalStored) {
        const parsed = JSON.parse(globalStored);
        const resolved = parsed.id === 'custom_wallpaper'
          ? (parsed as ChatTheme)
          : this.getPresetById(parsed.id || parsed);
        themeCache.set('global', resolved);
        return resolved;
      }
    } catch (err) {
      console.warn('[ChatThemeService] Error reading theme:', err);
    }
    return CHAT_THEME_PRESETS[0];
  },

  /**
   * Sets chat theme for a specific conversation
   */
  async setChatTheme(theme: ChatTheme, conversationId?: number | string): Promise<void> {
    try {
      if (conversationId) {
        themeCache.set(`conv_${conversationId}`, theme);
        await AsyncStorage.setItem(
          `${CHAT_THEME_STORAGE_PREFIX}${conversationId}`,
          JSON.stringify(theme)
        );
      }
    } catch (err) {
      console.error('[ChatThemeService] Error saving conversation theme:', err);
    }
  },

  /**
   * Sets global chat theme for all conversations
   */
  async setGlobalChatTheme(theme: ChatTheme): Promise<void> {
    try {
      themeCache.set('global', theme);
      await AsyncStorage.setItem(GLOBAL_CHAT_THEME_KEY, JSON.stringify(theme));
    } catch (err) {
      console.error('[ChatThemeService] Error saving global chat theme:', err);
    }
  },

  /**
   * Resets conversation theme back to default
   */
  async resetChatTheme(conversationId?: number | string): Promise<void> {
    try {
      if (conversationId) {
        themeCache.delete(`conv_${conversationId}`);
        await AsyncStorage.removeItem(`${CHAT_THEME_STORAGE_PREFIX}${conversationId}`);
      }
    } catch (err) {
      console.error('[ChatThemeService] Error resetting theme:', err);
    }
  },

  /**
   * Creates a custom wallpaper theme configuration
   */
  createCustomWallpaperTheme(imageUrl: string, dim: number = 0.35): ChatTheme {
    return {
      id: 'custom_wallpaper',
      name: 'Custom Wallpaper',
      isDark: true,
      background: {
        type: 'image',
        imageUrl,
        overlayDim: dim,
      },
      myBubble: {
        gradient: ['#00F2FE', '#4FACFE'],
        textColor: '#FFFFFF',
        timeColor: 'rgba(255, 255, 255, 0.8)',
      },
      theirBubble: {
        backgroundColor: 'rgba(24, 24, 27, 0.85)',
        textColor: '#FFFFFF',
        timeColor: 'rgba(255, 255, 255, 0.5)',
      },
      accentColor: '#38BDF8',
    };
  },
};
