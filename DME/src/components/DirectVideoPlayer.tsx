import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import Video, {
  VideoRef,
  SelectedVideoTrackType,
  OnLoadData,
  OnProgressData,
  OnBufferData,
} from 'react-native-video';
import { YOUTUBE_MOBILE_USER_AGENT, RAVE_IOS_USER_AGENT, RAVE_ANDROID_USER_AGENT } from '../services/YouTubeDecipherService';

export interface DirectVideoPlayerRef {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (volume: number) => void;
  getVolume: () => Promise<number>;
  setRealDuration?: (duration: number) => void;
  setPlaybackQuality?: (quality: string) => void;
  fastForwardAd?: () => void;
}

export interface StreamInfo {
  height: number;
  width: number;
  quality: string;
  label: string;
  url: string;
  has_audio: boolean;
  vcodec: string;
  acodec: string | null;
  ext: string;
}

interface Props {
  videoUri: string;
  audioUri?: string | null;
  streamType?: 'mpd' | 'mp4' | 'm3u8';
  play: boolean;
  quality?: string;
  muted?: boolean;
  volume?: number;
  initialPosition?: number;
  onReady?: () => void;
  onStateChange?: (state: 'unstarted' | 'buffering' | 'playing' | 'paused' | 'ended') => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onLoad?: (duration: number) => void;
  fallbackUri?: string | null;
  onEnd?: () => void;
  onError?: (error: any) => void;
  aspectRatio?: number;
  onAspectRatio?: (aspectRatio: number) => void;
  onExactResolution?: (resolution: string) => void;
  onQualitiesAvailable?: (qualities: string[]) => void;
  onQualityFallback?: (quality: string) => void;
  isFullscreen?: boolean;
  style?: any;
}

const DirectVideoPlayer = forwardRef<DirectVideoPlayerRef, Props>((props, ref) => {
  const {
    videoUri,
    fallbackUri,
    streamType = 'mpd',
    play,
    quality,
    muted = false,
    volume = 1,
    initialPosition = 0,
    onReady,
    onStateChange,
    onProgress,
    onLoad,
    onEnd,
    onError,
    onAspectRatio,
    onExactResolution,
    onQualitiesAvailable,
    onQualityFallback,
    isFullscreen = false,
    style,
  } = props;

  const videoRef = useRef<VideoRef>(null);
  const positionRef = useRef(initialPosition || 0);
  const durationRef = useRef(0);
  const isReadyRef = useRef(false);
  const tracksRef = useRef<any[]>([]);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isPaused, setIsPaused] = useState(!play);
  const [currentVol, setCurrentVol] = useState(volume);
  const [selectedVideoTrack, setSelectedVideoTrack] = useState<{
    type: SelectedVideoTrackType;
    value?: number;
  }>({
    type: SelectedVideoTrackType.AUTO,
  });

  const [playableSource, setPlayableSource] = useState<{
    uri: string;
    type?: string;
    headers?: Record<string, string>;
    startPosition?: number;
  } | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const recoveryAttemptsRef = useRef(0);
  const lastRecoveryTimeRef = useRef(0);
  // When true, handleLoad will NOT re-apply the last quality — avoids re-triggering
  // the same quality that caused the recovery in the first place.
  const isRecoveringRef = useRef(false);
  // Captured position at the moment an error fires — immune to stale progress=0
  // events that ExoPlayer emits during early load of the recovered player.
  const recoveryPositionRef = useRef<number>(0);

  useEffect(() => {
    setIsPaused(!play);
  }, [play]);

  useEffect(() => {
    setCurrentVol(volume);
  }, [volume]);

  // Track initialPosition only for the very first load of a new videoUri
  const initialPositionAppliedRef = useRef(false);
  const lastVideoUriRef = useRef<string | null>(null);

  // Resolve source: videoUri is already a file:// path (dash_<videoId>.mpd) written by TrackPlayerService.
  // No MPD rewriting needed here — just set the source directly.
  useEffect(() => {
    if (!videoUri) {
      setPlayableSource(null);
      positionRef.current = 0;
      durationRef.current = 0;
      isRecoveringRef.current = false;
      recoveryAttemptsRef.current = 0;
      initialPositionAppliedRef.current = false;
      lastVideoUriRef.current = null;
      return;
    }

    const isNewVideo = lastVideoUriRef.current !== videoUri;
    lastVideoUriRef.current = videoUri;

    if (isNewVideo) {
      positionRef.current = (initialPosition && initialPosition > 0) ? initialPosition : 0;
      durationRef.current = 0;
      isRecoveringRef.current = false;
      recoveryAttemptsRef.current = 0;
      initialPositionAppliedRef.current = false;
      blockedQualityHeightsRef.current.clear();
    }

    const isMpd =
      streamType === 'mpd' ||
      videoUri.startsWith('data:application/dash+xml') ||
      videoUri.includes('<MPD') ||
      videoUri.includes('<?xml') ||
      videoUri.endsWith('.mpd');

    setPlayableSource({
      uri: videoUri,
      type: isMpd ? 'mpd' : (streamType || 'mp4'),
      headers: {
        'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Accept-Encoding': 'gzip, identity',
      },
    });
  }, [videoUri, streamType]);

  // Mirror selectedVideoTrack into a ref so applyQuality can read the current value
  // without taking it as a useCallback dependency (which causes the infinite loop:
  // setSelectedVideoTrack → applyQuality recreated → useEffect fires → setSelectedVideoTrack → ∞)
  const selectedVideoTrackRef = useRef<{ type: SelectedVideoTrackType; value?: number }>({
    type: SelectedVideoTrackType.AUTO,
  });
  const videoUriRef = useRef(videoUri);
  videoUriRef.current = videoUri;
  const streamTypeRef = useRef(streamType);
  streamTypeRef.current = streamType;

  const setSelectedVideoTrackSafe = useCallback((next: { type: SelectedVideoTrackType; value?: number }) => {
    selectedVideoTrackRef.current = next;
    setSelectedVideoTrack(next);
  }, []);

  const onExactResolutionRef = useRef(onExactResolution);
  const qualityDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the last manual quality switch — used to detect 403s caused by quality switching
  const qualitySwitchTimeRef = useRef<number>(0);
  // Set of quality heights that have been blocked due to 403 (CDN rejects them for this session)
  const blockedQualityHeightsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    onExactResolutionRef.current = onExactResolution;
  }, [onExactResolution]);

  useEffect(() => {
    return () => {
      if (qualityDebounceTimer.current) {
        clearTimeout(qualityDebounceTimer.current);
      }
    };
  }, []);

  const applyQuality = useCallback((q?: string) => {
    if (qualityDebounceTimer.current) {
      clearTimeout(qualityDebounceTimer.current);
    }

    qualityDebounceTimer.current = setTimeout(() => {
      console.log(`📺 [DirectVideoPlayer] Applying quality: ${q}`);

      if (!q || q === 'auto') {
        setSelectedVideoTrackSafe({ type: SelectedVideoTrackType.AUTO });
        onExactResolutionRef.current?.('Auto');
        return;
      }
      const qMap: Record<string, number> = {
        hd1440: 1440,
        hd1080: 1080,
        hd720: 720,
        large: 480,
        medium: 360,
        small: 240,
        tiny: 144,
      };
      // Support full resolutions up to 1440p / 1080p (Rave architecture with native OkHttp headers)
      const rawHeight = qMap[q] || parseInt(q.replace(/\D/g, ''), 10);
      const requestedHeight = Math.min(1440, rawHeight || 0);
      if (requestedHeight > 0) {
        let bestTrackHeight = requestedHeight;
        const tracks = tracksRef.current;
        if (tracks && tracks.length > 0) {
          const exact = tracks.find((t: any) => t.height === requestedHeight);
          if (exact) {
            bestTrackHeight = exact.height;
          } else {
            const sorted = [...tracks].filter((t: any) => t.height && t.height <= 1440).sort((a: any, b: any) => b.height - a.height);
            const closest = sorted.find((t: any) => t.height <= requestedHeight) || sorted[sorted.length - 1];
            if (closest) bestTrackHeight = closest.height;
          }
        }

        // If user explicitly chose this quality, unblock it so user intent is honored
        if (q && q !== 'auto') {
          blockedQualityHeightsRef.current.delete(bestTrackHeight);
        }

        console.log(`📺 [DirectVideoPlayer] Quality ${q} → targetTrackHeight: ${bestTrackHeight}`);
        // Use ref for redundancy guard — avoids taking selectedVideoTrack as a dep
        const cur = selectedVideoTrackRef.current;
        if (cur.type === SelectedVideoTrackType.RESOLUTION && cur.value === bestTrackHeight) {
          return; // already at this resolution, no-op
        }
        // Record time of this quality switch so handleError can identify switch-caused 403s
        qualitySwitchTimeRef.current = Date.now();
        setSelectedVideoTrackSafe({
          type: SelectedVideoTrackType.RESOLUTION,
          value: bestTrackHeight,
        });
        onExactResolutionRef.current?.(`${bestTrackHeight}p`);
      }
    }, 800);
  }, [setSelectedVideoTrackSafe]); // ← stable dependency array, zero loops

  useEffect(() => {
    if (quality) {
      applyQuality(quality);
    }
  }, [quality, applyQuality]);

  const handleLoad = useCallback((data: OnLoadData) => {
    // Reset recovery counter every time ExoPlayer successfully loads.
    recoveryAttemptsRef.current = 0;

    isReadyRef.current = true;
    durationRef.current = data.duration || 0;
    setIsBuffering(false);
    onLoad?.(data.duration || 0);
    onReady?.();

    if (data.naturalSize?.width && data.naturalSize?.height) {
      const ar = data.naturalSize.width / data.naturalSize.height;
      if (ar > 0 && isFinite(ar)) {
        onAspectRatio?.(ar);
      }
    }

    if (data.videoTracks && data.videoTracks.length > 0) {
      tracksRef.current = data.videoTracks;
      const qualities = data.videoTracks
        .map((t: any) => (t.height ? `${t.height}p` : null))
        .filter(Boolean) as string[];
      if (qualities.length > 0) {
        onQualitiesAvailable?.(qualities);
      }
      // Do NOT re-apply quality if we just recovered — that quality caused
      // the error and would immediately trigger another 403.
      if (!isRecoveringRef.current && quality && quality !== 'auto') {
        applyQuality(quality);
      }
    }

    // During recovery: use the position captured at error time (recoveryPositionRef),
    // not positionRef which may have been overwritten by stale progress=0 events.
    // For a fresh load: use initialPosition prop first, then positionRef.
    const targetSeek = isRecoveringRef.current
      ? recoveryPositionRef.current
      : ((initialPosition && initialPosition > 0 && !initialPositionAppliedRef.current) ? initialPosition : positionRef.current);

    initialPositionAppliedRef.current = true;

    if (targetSeek > 0) {
      videoRef.current?.seek(targetSeek);
      // Update positionRef so subsequent progress events use the correct baseline.
      positionRef.current = targetSeek;
    }

    // Clear recovery flag AFTER seek — this unblocks handleProgress tracking.
    isRecoveringRef.current = false;
    recoveryAttemptsRef.current = 0;
  }, [initialPosition, onLoad, onReady, onAspectRatio, onQualitiesAvailable, quality, applyQuality]);

  const handleProgress = useCallback((data: OnProgressData) => {
    // During recovery the newly-mounted ExoPlayer fires progress=0 before the seek
    // completes. Updating positionRef here would overwrite the captured recovery
    // position and cause the fallback to seek back to 0 on the next error.
    if (!isRecoveringRef.current) {
      positionRef.current = data.currentTime;
    }
    durationRef.current = data.seekableDuration || durationRef.current;
    onProgress?.(data.currentTime, durationRef.current);
  }, [onProgress]);

  const handleBuffer = useCallback((data: OnBufferData) => {
    setIsBuffering(data.isBuffering);
    onStateChange?.(data.isBuffering ? 'buffering' : (play ? 'playing' : 'paused'));
  }, [play, onStateChange]);


  const handleError = useCallback((err: any) => {
    const errorCode: string = err?.error?.errorCode || err?.errorCode || '';
    const is403 = errorCode === '22004' ||
      (err?.error?.errorStackTrace || '').includes('Response code: 403') ||
      (err?.error?.errorString || '').includes('ERROR_CODE_IO_BAD_HTTP_STATUS');

    console.warn(`[DirectVideoPlayer] Native ExoPlayer error (${errorCode}${is403 ? ', 403' : ''}):`, err?.error?.errorString || errorCode);
    setIsBuffering(false);

    // Cancel any pending quality-switch debounce immediately
    if (qualityDebounceTimer.current) {
      clearTimeout(qualityDebounceTimer.current);
      qualityDebounceTimer.current = null;
    }

    // Step 1: If player was locked to a specific track resolution, revert to AUTO
    // within the active ExoPlayer session. This seamlessly drops bitrate without reloading.
    if (selectedVideoTrackRef.current.type !== SelectedVideoTrackType.AUTO) {
      const failedHeight = selectedVideoTrackRef.current.value;
      if (failedHeight) {
        blockedQualityHeightsRef.current.add(failedHeight);
      }
      console.warn(`[DirectVideoPlayer] Error on fixed track (${failedHeight || 'unknown'}p) — adding to blocked list and reverting to AUTO`);
      setSelectedVideoTrackSafe({ type: SelectedVideoTrackType.AUTO });
      onExactResolutionRef.current?.('Auto');
      onQualityFallback?.('auto');

      // CRITICAL FIX: ExoPlayer is in error state (STATE_IDLE).
      // Simply updating the React state does NOT make native ExoPlayer restart playback.
      // We must seek to the current position so ExoPlayer re-prepares and resumes on the AUTO track!
      const currentPos = positionRef.current;
      if (videoRef.current && currentPos > 0) {
        videoRef.current.seek(currentPos);
      }
      return;
    }

    // Step 2a: 403 CDN throttle or stream failure on DASH
    // Seamlessly switch to the unthrottled progressive stream without disrupting the user!
    if (is403) {
      if (fallbackUri && playableSource?.uri !== fallbackUri) {
        console.log(`🎬 [DirectVideoPlayer] 403 on DASH — seamlessly switching to fallback progressive URL at pos ${positionRef.current.toFixed(1)}s`);
        setPlayableSource({
          uri: fallbackUri,
          type: 'mp4',
          startPosition: positionRef.current,
          headers: {
            'User-Agent': RAVE_ANDROID_USER_AGENT,
          },
        });
        return;
      }
      console.warn('[DirectVideoPlayer] 403 CDN throttle at AUTO track — escalating immediately for re-extraction');
      onError?.(err);
      return;
    }

    // Step 2b: Non-403 error — attempt in-stream seek recovery (2 attempts max)
    const now = Date.now();
    if (now - lastRecoveryTimeRef.current > 15000) {
      recoveryAttemptsRef.current = 0;
    }
    lastRecoveryTimeRef.current = now;

    if (recoveryAttemptsRef.current < 2) {
      recoveryAttemptsRef.current++;
      const capturedPos = positionRef.current;
      recoveryPositionRef.current = capturedPos;
      isRecoveringRef.current = true;

      console.warn(
        `[DirectVideoPlayer] Attempting in-stream seek recovery at pos: ${capturedPos.toFixed(2)}s (attempt ${recoveryAttemptsRef.current})`
      );

      if (videoRef.current && capturedPos > 0) {
        videoRef.current.seek(capturedPos);
      }
      return;
    }

    if (fallbackUri && playableSource?.uri !== fallbackUri) {
      console.log(`🎬 [DirectVideoPlayer] Recovery attempts exhausted on DASH — switching to fallback progressive stream at pos ${positionRef.current.toFixed(1)}s`);
      setPlayableSource({
        uri: fallbackUri,
        type: 'mp4',
        startPosition: positionRef.current,
        headers: {
          'User-Agent': RAVE_ANDROID_USER_AGENT,
        },
      });
      return;
    }

    console.warn('[DirectVideoPlayer] Recovery attempts exhausted — escalating to parent onError');
    onError?.(err);
  }, [fallbackUri, playableSource, setSelectedVideoTrackSafe, onError, onQualityFallback]);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number, _allowSeekAhead?: boolean) => {
      positionRef.current = seconds;
      videoRef.current?.seek(seconds);
    },
    getCurrentTime: async () => positionRef.current,
    getDuration: async () => durationRef.current,
    playVideo: () => {
      setIsPaused(false);
    },
    pauseVideo: () => {
      setIsPaused(true);
    },
    setVolume: (vol: number) => {
      const v = Math.max(0, Math.min(1, vol));
      setCurrentVol(v);
      videoRef.current?.setVolume(v);
    },
    getVolume: async () => currentVol,
    setRealDuration: (d: number) => {
      durationRef.current = d;
    },
    setPlaybackQuality: (q: string) => {
      applyQuality(q);
    },
    fastForwardAd: () => {},
  }));

  if (!playableSource) {
    return <View style={[styles.container, style]} />;
  }

  return (
    <View style={[styles.container, style]}>
      <Video
        key={`exo_${playerKey}`}
        ref={videoRef}
        source={playableSource}
        selectedVideoTrack={selectedVideoTrack}
        bufferConfig={{
          minBufferMs: 5000,
          maxBufferMs: 20000,
          bufferForPlaybackMs: 1000,
          bufferForPlaybackAfterRebufferMs: 2000,
          backBufferDurationMs: 5000,
        }}
        paused={isPaused}
        muted={muted}
        volume={currentVol}
        playInBackground={true}
        playWhenInactive={true}
        preventsDisplaySleepDuringVideoPlayback={true}
        resizeMode={isFullscreen ? 'cover' : 'contain'}
        style={styles.video}
        progressUpdateInterval={250}
        onLoad={handleLoad}
        onProgress={handleProgress}
        onBuffer={handleBuffer}
        onEnd={onEnd}
        onError={handleError}
      />
      {isBuffering && (
        <View style={styles.loaderOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      )}
    </View>
  );
});

DirectVideoPlayer.displayName = 'DirectVideoPlayer';
export default DirectVideoPlayer;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000044',
  },
});
