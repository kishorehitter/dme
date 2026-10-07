// src/utils/navBarPin.ts
import { NativeModules, Platform } from 'react-native';
const { NavBarPin, SystemBar } = NativeModules;

export const pinNavBarColor = (color: string, lightIcons: boolean = true) => {
  console.log('[SystemBarNav] pinNavBarColor -> color:', color, 'lightIcons:', lightIcons);
  try { NavBarPin?.setColor(color); } catch (_) {}
  try {
    if (Platform.OS === 'android' && SystemBar?.setNavigationBarColor) {
      SystemBar.setNavigationBarColor(color, lightIcons);
    }
  } catch (_) {}
};

export const clearNavBarPin = () => {
  console.log('[SystemBarNav] clearNavBarPin called');
  try { NavBarPin?.clear(); } catch (_) {}
};

/**
 * Sets the native Android window background (DecorView background color).
 * This is what Android shows through a transparent navigation bar when no
 * React Native View renders in that area. Use '#0D0D0D' for Music Room,
 * restore to '#020912' when exiting.
 */
export const setWindowBackground = (color: string) => {
  try {
    if (Platform.OS === 'android' && SystemBar?.setWindowBackground) {
      SystemBar.setWindowBackground(color);
    }
  } catch (_) {}
};

/**
 * Toggles Android Immersive Sticky Mode (hides navigation bar and status bar).
 * When active, swiping from top/bottom edge temporarily reveals navigation controls
 * as transient floating bars that auto-hide without resizing the layout.
 */
export const setImmersiveMode = (enabled: boolean) => {
  try {
    if (Platform.OS === 'android' && SystemBar?.setImmersiveMode) {
      SystemBar.setImmersiveMode(enabled);
    }
  } catch (_) {}
};