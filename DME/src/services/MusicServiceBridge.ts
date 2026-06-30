/**
 * MusicServiceBridge.ts
 *
 * Thin wrapper around the native `MusicService` NativeModule.
 * This is the ONLY way YouTube tracks keep the process alive and show a
 * lockscreen / status-bar media notification.
 *
 * Architecture (YouTube path):
 *   YouTube IFrame (WebView) — owns the actual audio output
 *   MusicForegroundService  — keeps Android from killing the process + shows
 *                             the media notification / lockscreen overlay
 *   TrackPlayer             — NOT used for YouTube (only for Drive)
 *
 * Usage:
 *   startMusicService(title, artist)         → when a YouTube track starts
 *   updateMusicService(title, artist, bool)  → on play / pause
 *   stopMusicService()                       → when leaving the room
 */

import { NativeModules } from 'react-native';

const { MusicService } = NativeModules;

/**
 * Start the foreground service and show the media notification.
 * Call this as soon as a YouTube track begins playing.
 */
export const startMusicService = (
  title: string,
  artist: string,
  thumbnail: string,
  isDJ: boolean
): void => {
  try {
    MusicService?.startService(title, artist, thumbnail, true, isDJ);
  } catch (e) {
    console.warn('[MusicServiceBridge] startService error:', e);
  }
};

/**
 * Update the notification + MediaSession playback state.
 * Call this whenever the room's isPlaying toggles.
 */
export const updateMusicService = (
  title: string,
  artist: string,
  thumbnail: string,
  isPlaying: boolean,
  isDJ: boolean
): void => {
  try {
    MusicService?.updatePlaybackState(title, artist, thumbnail, isPlaying, isDJ);
  } catch (e) {
    console.warn('[MusicServiceBridge] updatePlaybackState error:', e);
  }
};

/**
 * Stop the foreground service and dismiss the notification.
 * Call this when the user leaves the music room.
 */
export const stopMusicService = (): void => {
  try {
    MusicService?.stopService();
  } catch (e) {
    console.warn('[MusicServiceBridge] stopService error:', e);
  }
};
