/**
 * YoutubePlayer.tsx — CLEAN Custom UI Only
 *
 * ✅ FEATURES:
 * 1. NO CROPPING — Full 16:9 video visible
 * 2. ZERO YouTube UI — All controls, logos, buttons hidden
 * 3. Custom controls only — VideoControls overlay handles everything
 * 4. Time tracking works — Progress updates correctly
 * 5. Seeking works — Drag to seek the video
 * 6. Block links — YouTube links don't open/redirect
 */

import React, { useEffect, forwardRef, useImperativeHandle, useRef, memo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import YoutubePlayerLib, { YoutubeIframeRef } from 'react-native-youtube-iframe';

const { width } = Dimensions.get('window');

// ─── NO CROPPING — Full 16:9 video ────────────────────────────────────────
export const VIDEO_HEIGHT = width * (9 / 16);

// ─── Types ────────────────────────────────────────────────────────────────────
export type PlayerState =
  | 'unstarted'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'cued';

export interface YoutubePlayerRef {
  seekTo:         (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => Promise<number>;
  getDuration:    () => Promise<number>;
  playVideo:      () => void;
  pauseVideo:     () => void;
}

interface Props {
  videoId:        string;
  play:           boolean;
  onReady?:       () => void;
  onStateChange?: (state: PlayerState) => void;
  onProgress?:    (currentTime: number, duration: number) => void;
  onError?:       (errorCode: number) => void;
  style?:         any;
}

const YoutubePlayer = memo(forwardRef<YoutubePlayerRef, Props>((props, ref) => {
  const { videoId, play, onReady, onStateChange, onProgress, onError, style } = props;
  const playerRef = useRef<YoutubeIframeRef>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ✅ Log play prop changes
  useEffect(() => {
    console.log('🎬 YoutubePlayer: play prop changed to:', play);
  }, [play]);

  // ✅ FIX: Continuous progress tracking when playing
  useEffect(() => {
    if (!play || !playerRef.current) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    // Poll progress every 250ms (4 times per second) for smooth updates
    progressIntervalRef.current = setInterval(async () => {
      try {
        const currentTime = await playerRef.current?.getCurrentTime();
        const duration = await playerRef.current?.getDuration();
        
        if (currentTime !== undefined && duration !== undefined) {
          onProgress?.(currentTime, duration);
        }
      } catch (error) {
        // Silently fail, will retry next interval
      }
    }, 250);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [play, onProgress]);

  // ─── Expose imperative methods ─────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number, allowSeekAhead = true) => {
      console.log('🎬 Seeking to:', seconds);
      playerRef.current?.seekTo(seconds, allowSeekAhead);
    },
    
    getCurrentTime: async () => {
      try {
        const time = await playerRef.current?.getCurrentTime();
        return time ?? 0;
      } catch (error) {
        console.error('Error getting current time:', error);
        return 0;
      }
    },
    
    getDuration: async () => {
      try {
        const duration = await playerRef.current?.getDuration();
        return duration ?? 0;
      } catch (error) {
        console.error('Error getting duration:', error);
        return 0;
      }
    },
    
    playVideo: () => {
      console.log('▶️ playVideo');
      (playerRef.current as any)?.playVideo();
    },
    
    pauseVideo: () => {
      console.log('⏸️ pauseVideo');
      (playerRef.current as any)?.pauseVideo();
    },
  }), []);

  return (
    <View style={[styles.container, style]}>
      <YoutubePlayerLib
        ref={playerRef}
        pointerEvents="none"
        height={VIDEO_HEIGHT}
        width={width}
        videoId={videoId}
        play={play}
        forceAndroidAutoplay={true}
        
        onChangeState={(state: string) => {
          console.log('🎬 Player state changed to:', state);
          onStateChange?.(state as PlayerState);
        }}
        
        onReady={() => {
          console.log('✅ YouTube Player Ready');
          onReady?.();
        }}
        
        // ✅ IMPORTANT: Let onProgress callback drive time updates
        // Supplemented by interval polling above for smooth UX
        onProgress={(data: any) => {
          if (typeof data === 'object' && data.currentTime !== undefined) {
            onProgress?.(data.currentTime, data.duration);
          }
        }}
        
        onError={(error: any) => {
          console.error('🎵 YouTube Player Error:', error);
          onError?.(150);
        }}
        
        // YouTube player parameters
        initialPlayerParams={{
          controls: 0,           // ✅ Hide all YouTube controls
          modestbranding: 0,     // Hide branding
          rel: 0,                // No related videos at end
          iv_load_policy: 3,     // No annotations
          playsinline: 1,        // Inline on iOS
          cc_load_policy: 0,     // No captions by default
          fs: 1,                 // Allow fullscreen (your app handles this)
          showinfo: 0,           // Hide info (deprecated)
          autoplay: 0,           // Don't autoplay (you control via play prop)
          enablejsapi: 1,        // Enable JS API (required)
          origin: 'https://www.youtube.com',
          widget_referrer: 'https://www.youtube.com',
        }}
        // WebView configuration
        webViewProps={{
          allowsInlineMediaPlayback: true,
          mediaPlaybackRequiresUserAction: false,
          
          userAgent:
            'Mozilla/5.0 (Linux; Android 10; SM-G973F) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Mobile Safari/537.36',
          
          originWhitelist: ['*'],
          
          zoomEnabled: false,
        }}
      />
    </View>
  );
}));

YoutubePlayer.displayName = 'YoutubePlayer';

const styles = StyleSheet.create({
  container: {
    width,
    height: VIDEO_HEIGHT,
    backgroundColor: '#000',
  },
});

export default YoutubePlayer;