/**
 * ThemeContext.tsx
 * Provides dynamic dark/light mode switching like WhatsApp.
 * 
 * Supports three modes:
 *   - 'light'  — always light
 *   - 'dark'   — always dark
 *   - 'system' — follows the device's system setting (default)
 * 
 * The user's preference is persisted via AsyncStorage.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme, Appearance, StatusBar, Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme, ThemeColors } from '../utils/theme';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** The active resolved theme: 'light' | 'dark' */
  isDark: boolean;
  /** The user's preference: 'light' | 'dark' | 'system' */
  themeMode: ThemeMode;
  /** Switch the theme mode */
  setThemeMode: (mode: ThemeMode) => void;
  /** Toggle between light and dark (ignores system) */
  toggleTheme: () => void;
  /** The full color palette for the active theme */
  theme: ThemeColors;
}

const THEME_STORAGE_KEY = '@dme_theme_mode';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ─── Provider ───────────────────────────────────────────────────────────────────

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted preference on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemeModeState(stored);
        }
      } catch (e) {
        console.warn('[ThemeContext] Failed to load theme preference:', e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Persist preference when it changes
  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (e) {
      console.warn('[ThemeContext] Failed to save theme preference:', e);
    }
  }, []);

  // Resolve the actual theme
  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return systemScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemScheme]);

  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

  const toggleTheme = useCallback(() => {
    setThemeMode(isDark ? 'light' : 'dark');
  }, [isDark, setThemeMode]);

  // Update StatusBar when theme changes - disabled here to let AppNavigator handle it without race conditions
  useEffect(() => {
    // Handled by AppNavigator central configuration to avoid startup flash during splash screen
  }, [isDark, isLoaded]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      themeMode,
      setThemeMode,
      toggleTheme,
      theme,
    }),
    [isDark, themeMode, setThemeMode, toggleTheme, theme],
  );

  // Don't render children until the stored preference is loaded to avoid flash
  if (!isLoaded) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

export default ThemeContext;
