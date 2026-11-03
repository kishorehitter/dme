import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, AppState, NativeModules, Platform, Dimensions } from 'react-native';
import DualSurfacePlayer, { DualSurfacePlayerRef } from './DualSurfacePlayer';
import Video, {
  VideoRef,
  SelectedVideoTrackType,
  OnLoadData,
  OnProgressData,
  OnBufferData,
} from 'react-native-video';
import { YOUTUBE_DESKTOP_USER_AGENT, RAVE_IOS_USER_AGENT, RAVE_ANDROID_USER_AGENT } from '../services/YouTubeDecipherService';

export interface DirectVideoPlayerRef {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo?: () => void;
  setVolume: (volume: number) => void;
  getVolume: () => Promise<number>;
  setRealDuration?: (duration: number) => void;
  setPlaybackQuality?: (quality: string) => void;
  setPlaybackRate?: (rate: number) => void;
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
  videoId?: string;
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
  resizeMode?: 'contain' | 'cover';
  headers?: Record<string, string>;
  style?: any;
  bleedEnabled?: boolean;
  bleedDarkness?: number;
  bbdCropPercent?: number;
  blurSigma?: number;
  contentRect?: { x: number; y: number; width: number; height: number };
}

const getVideoIdFromUri = (uri: string | null | undefined): string | null => {
  if (!uri) return null;
  const match = uri.match(/dash_([a-zA-Z0-9_-]+?)(?:_\d+)?\.mpd/);
  return match ? match[1] : null;
};

const DirectVideoPlayer = forwardRef<DirectVideoPlayerRef, Props>((props, ref) => {
  const {
    videoId,
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
    resizeMode,
    headers,
    style,
    bleedEnabled = false,
    bleedDarkness = 0.55,
    bbdCropPercent = 0.0,
    blurSigma = 48.0,
    contentRect,
  } = props;

  const videoRef = useRef<VideoRef>(null);
  const dualSurfaceRef = useRef<DualSurfacePlayerRef>(null);
  const useDualSurface = Platform.OS === 'android';
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

  const isMpdInitial = videoUri ? (
    streamType === 'mpd' ||
    videoUri.startsWith('data:application/dash+xml') ||
    videoUri.includes('<MPD') ||
    videoUri.includes('<?xml') ||
    videoUri.endsWith('.mpd')
  ) : false;

  const [playableSource, setPlayableSource] = useState<{
    uri: string;
    type?: string;
    headers?: Record<string, string>;
    startPosition?: number;
  } | null>(() => videoUri ? ({
    uri: videoUri,
    type: isMpdInitial ? 'mpd' : (streamType || 'mp4'),
    headers: headers,
    startPosition: (initialPosition && initialPosition > 0) ? initialPosition : 0,
  }) : null);
  const [playerKey, setPlayerKey] = useState(0);
  const recoveryAttemptsRef = useRef(0);
  const lastRecoveryTimeRef = useRef(0);
  const hasReportedReadyRef = useRef(false);

  const markReadyToDisplay = useCallback(() => {
    if (!hasReportedReadyRef.current) {
      hasReportedReadyRef.current = true;
      setIsBuffering(false);
      onReady?.();
    }
  }, [onReady]);

  const handleReadyForDisplay = useCallback(() => {
    markReadyToDisplay();
  }, [markReadyToDisplay]);
  // When true, handleLoad will NOT re-apply the last quality — avoids re-triggering
  // the same quality that caused the recovery in the first place.
  const isRecoveringRef = useRef(false);
  // Captured position at the moment an error fires — immune to stale progress=0
  // events that ExoPlayer emits during early load of the recovered player.
  const recoveryPositionRef = useRef<number>(0);

  useEffect(() => {
    setIsPaused(!play);
    try {
      if (play) {
        (videoRef.current as any)?.resume?.();
      } else {
        (videoRef.current as any)?.pause?.();
      }
    } catch (_) {}
  }, [play]);

  useEffect(() => {
    setCurrentVol(volume);
  }, [volume]);

  // Track initialPosition only for the very first load of a new videoUri
  const initialPositionAppliedRef = useRef(false);
  const lastVideoUriRef = useRef<string | null>(null);
  const lastLoadedTrackIdRef = useRef<string | undefined>(videoId);

  useEffect(() => {
    if (videoId && lastLoadedTrackIdRef.current && lastLoadedTrackIdRef.current !== videoId) {
      setPlayableSource(null);
      if (dualSurfaceRef.current) {
        try {
          dualSurfaceRef.current.pauseVideo?.();
          dualSurfaceRef.current.stopVideo?.();
        } catch (_) {}
      }
      hasReportedReadyRef.current = false;
      isReadyRef.current = false;
      setIsBuffering(true);
      positionRef.current = 0;
      durationRef.current = 0;
    }
  }, [videoId]);

  // Resolve source: videoUri is already a file:// path (dash_<videoId>_<ts>.mpd) written by TrackPlayerService.
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
      lastLoadedTrackIdRef.current = undefined;
      return;
    }

    const prevUri = lastVideoUriRef.current;
    const isNewUri = prevUri !== videoUri;
    lastVideoUriRef.current = videoUri;

    const prevUriTrackId = getVideoIdFromUri(prevUri);
    const curUriTrackId = getVideoIdFromUri(videoUri);
    const prevTrackId = lastLoadedTrackIdRef.current || prevUriTrackId;
    const curTrackId = videoId || curUriTrackId;

    const isDifferentVideo = Boolean(
      (prevTrackId && curTrackId && prevTrackId !== curTrackId) ||
      (prevUriTrackId && curUriTrackId && prevUriTrackId !== curUriTrackId)
    );

    const isMpd =
      streamType === 'mpd' ||
      videoUri.startsWith('data:application/dash+xml') ||
      videoUri.includes('<MPD') ||
      videoUri.includes('<?xml') ||
      videoUri.endsWith('.mpd');

    const isM3u8 =
      streamType === 'm3u8' ||
      videoUri.endsWith('.m3u8') ||
      videoUri.includes('m3u8') ||
      videoUri.includes('hls_variant') ||
      videoUri.includes('hls');

    if (isNewUri) {
      lastLoadedTrackIdRef.current = curTrackId || undefined;

      const prevIsMpd = prevUri
        ? (prevUri.endsWith('.mpd') || prevUri.startsWith('data:application/dash+xml') || prevUri.includes('<MPD'))
        : false;

      // Rescrape ONLY when:
      // 1. Same video (NOT different video)
      // 2. Both previous and current URIs are DASH MPDs
      // 3. We are in an active in-stream error recovery state (isRecoveringRef.current === true)
      // Natural queue advancement or track changes are NEVER a rescrape!
      const isRescrape = !isDifferentVideo && prevIsMpd && isMpd && isRecoveringRef.current && Boolean(curTrackId && prevTrackId && curTrackId === prevTrackId);

      if (isRescrape) {
        // Rave rescrape: preserve current playback position so ExoPlayer resumes seamlessly on 403 recovery
        console.log(`🔄 [DirectVideoPlayer] DASH rescrape for recovery detected for ${curTrackId} — preserving pos ${positionRef.current.toFixed(1)}s`);
        isRecoveringRef.current = false;
        recoveryAttemptsRef.current = 0;
        blockedQualityHeightsRef.current.clear();
        if (play) {
          setIsPaused(false);
        }
      } else {
        // Genuinely new video (e.g. next in queue)
        console.log(`🎬 [DirectVideoPlayer] New video track: ${curTrackId || videoUri.slice(-25)} (prev: ${prevTrackId || 'none'}) — starting from 0s`);
        hasReportedReadyRef.current = false;
        isReadyRef.current = false;
        positionRef.current = 0;
        durationRef.current = 0;
        isRecoveringRef.current = false;
        recoveryAttemptsRef.current = 0;
        // Only allow initialPosition on the very first track load (e.g. joining an ongoing room).
        // For queue tracks (prevUri exists) or live streams (isM3u8), mark as already applied so next song ALWAYS starts at 0s!
        initialPositionAppliedRef.current = (prevUri || isM3u8) ? true : false;
        blockedQualityHeightsRef.current.clear();
        if (play) {
          setIsPaused(false);
          try {
            (videoRef.current as any)?.resume?.();
          } catch (_) {}
        }
      }
    }

    const nextSource = {
      uri: videoUri,
      type: isMpd ? 'mpd' : (isM3u8 ? 'm3u8' : (streamType || 'mp4')),
      headers: headers,
      requestHeaders: headers ? Object.entries(headers).map(([key, value]) => ({ key, value })) : [],
      startPosition: (isNewUri && !isM3u8) ? positionRef.current : undefined,
    };

    setPlayableSource(nextSource);

    // Directly command ExoPlayer to load the new source immediately.
    // When the phone screen is locked or app is in background, React Native pauses
    // JSX prop commits (<Video source={...} />). Calling the NativeModule directly
    // bypasses the paused React UI queue and immediately starts the next track!
    try {
      NativeModules.VideoManager?.setSourceDirect?.(nextSource);
    } catch (_) {}
  }, [videoUri, streamType, headers]);


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
        if (useDualSurface) {
          dualSurfaceRef.current?.setPlaybackQuality?.('auto');
        }
        return;
      }
      const qMap: Record<string, number> = {
        hd2160: 2160,
        highres: 2160,
        hd1440: 1440,
        hd1080: 1080,
        hd720: 720,
        large: 480,
        medium: 360,
        small: 240,
        tiny: 144,
      };
      // Support full resolutions up to 2160p / 1440p / 1080p (Rave architecture with native OkHttp headers)
      const rawHeight = qMap[q] || parseInt(q.replace(/\D/g, ''), 10);
      const requestedHeight = Math.min(2160, rawHeight || 0);
      if (requestedHeight > 0) {
        let bestTrackHeight = requestedHeight;
        const tracks = tracksRef.current;
        if (tracks && tracks.length > 0) {
          const exact = tracks.find((t: any) => t.height === requestedHeight);
          if (exact) {
            bestTrackHeight = exact.height;
          } else {
            const sorted = [...tracks].filter((t: any) => t.height && t.height <= 2160).sort((a: any, b: any) => b.height - a.height);
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
        if (useDualSurface) {
          dualSurfaceRef.current?.setPlaybackQuality?.(q);
        }
      }
    }, 800);
  }, [setSelectedVideoTrackSafe, useDualSurface]); // ← stable dependency array, zero loops

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
    if (play) {
      setIsPaused(false);
      try {
        (videoRef.current as any)?.resume?.();
      } catch (_) {}
    }
    onLoad?.(data.duration || 0);

    if (!hasReportedReadyRef.current) {
      if (AppState.currentState !== 'active') {
        // In background / screen locked: no display surface exists so onReadyForDisplay
        // never fires, and Android OS throttles/freezes JS setTimeout timers.
        // We MUST mark ready immediately so playback starts uninterrupted!
        markReadyToDisplay();
      } else {
        setTimeout(() => {
          markReadyToDisplay();
        }, 1500);
      }
    }

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
  }, [initialPosition, onLoad, onReady, onAspectRatio, onQualitiesAvailable, quality, applyQuality, play]);

  const handleProgress = useCallback((data: OnProgressData) => {
    if (!isReadyRef.current) return;
    if (!hasReportedReadyRef.current && data.currentTime > 0) {
      markReadyToDisplay();
    }
    // During recovery the newly-mounted ExoPlayer fires progress=0 before the seek
    // completes. Updating positionRef here would overwrite the captured recovery
    // position and cause the fallback to seek back to 0 on the next error.
    if (!isRecoveringRef.current) {
      positionRef.current = data.currentTime;
    }
    durationRef.current = data.seekableDuration || durationRef.current;
    onProgress?.(data.currentTime, durationRef.current);
  }, [onProgress, markReadyToDisplay]);

  const handleBuffer = useCallback((data: OnBufferData) => {
    setIsBuffering(data.isBuffering);
    onStateChange?.(data.isBuffering ? 'buffering' : (play ? 'playing' : 'paused'));
  }, [play, onStateChange]);

  const handleBandwidthUpdate = useCallback((data: any) => {
    if (data?.height && selectedVideoTrackRef.current.type === SelectedVideoTrackType.AUTO) {
      const h = Math.round(data.height);
      onExactResolutionRef.current?.(`${h}p`);
    }
  }, []);

  const handleEnd = useCallback(() => {
    // Only report ended if the player actually completed loading and playing
    if (!isReadyRef.current) {
      console.log('🛡️ [DirectVideoPlayer] Suppressing ghost onEnd before player is ready');
      return;
    }
    onStateChange?.('ended');
    onEnd?.();
  }, [onStateChange, onEnd]);


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

    // Step 1: If player was locked to a specific track resolution, revert to AUTO in-place
    if (selectedVideoTrackRef.current.type !== SelectedVideoTrackType.AUTO) {
      const failedHeight = selectedVideoTrackRef.current.value;
      if (failedHeight) {
        blockedQualityHeightsRef.current.add(failedHeight);
      }
      console.warn(`[DirectVideoPlayer] Error on fixed track (${failedHeight || 'unknown'}p) — reverting in-place to AUTO track`);
      setSelectedVideoTrackSafe({ type: SelectedVideoTrackType.AUTO });
      onExactResolutionRef.current?.('Auto');
      onQualityFallback?.('auto');

      // Seek to current position to make ExoPlayer resume on AUTO track without reloading player
      const currentPos = positionRef.current;
      if (videoRef.current && currentPos > 0) {
        videoRef.current.seek(currentPos);
      }
      return;
    }

    // Attempt in-stream seek recovery (up to 3 attempts)
    const now = Date.now();
    if (now - lastRecoveryTimeRef.current > 15000) {
      recoveryAttemptsRef.current = 0;
    }
    lastRecoveryTimeRef.current = now;

    if (recoveryAttemptsRef.current < 3) {
      recoveryAttemptsRef.current++;
      const capturedPos = positionRef.current;
      recoveryPositionRef.current = capturedPos;
      isRecoveringRef.current = true;

      console.warn(
        `[DirectVideoPlayer] In-stream seek recovery at pos: ${capturedPos.toFixed(2)}s (attempt ${recoveryAttemptsRef.current})`
      );

      if (videoRef.current && capturedPos > 0) {
        videoRef.current.seek(capturedPos);
      }
      return;
    }

    // Step 4: If in-stream recovery is exhausted, notify parent to refresh DASH manifest
    console.warn('[DirectVideoPlayer] In-stream recovery exhausted — triggering DASH manifest refresh');
    onError?.(err);
  }, [setSelectedVideoTrackSafe, onError, onQualityFallback]);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number, _allowSeekAhead?: boolean) => {
      positionRef.current = seconds;
      if (useDualSurface) {
        dualSurfaceRef.current?.seekTo(seconds);
      } else {
        videoRef.current?.seek(seconds);
      }
    },
    getCurrentTime: async () => {
      if (useDualSurface && dualSurfaceRef.current) {
        return await dualSurfaceRef.current.getCurrentTime();
      }
      return positionRef.current;
    },
    getDuration: async () => {
      if (useDualSurface && dualSurfaceRef.current) {
        return await dualSurfaceRef.current.getDuration();
      }
      return durationRef.current;
    },
    playVideo: () => {
      setIsPaused(false);
      if (useDualSurface) {
        dualSurfaceRef.current?.playVideo();
      } else {
        try {
          (videoRef.current as any)?.resume?.();
        } catch (_) {}
      }
    },
    pauseVideo: () => {
      setIsPaused(true);
      if (useDualSurface) {
        dualSurfaceRef.current?.pauseVideo();
      } else {
        try {
          (videoRef.current as any)?.pause?.();
        } catch (_) {}
      }
    },
    stopVideo: () => {
      setIsPaused(true);
      if (useDualSurface) {
        dualSurfaceRef.current?.stopVideo?.();
      } else {
        try {
          (videoRef.current as any)?.pause?.();
        } catch (_) {}
      }
    },
    setVolume: (vol: number) => {
      const v = Math.max(0, Math.min(1, vol));
      setCurrentVol(v);
      if (useDualSurface) {
        dualSurfaceRef.current?.setVolume(v);
      } else {
        videoRef.current?.setVolume(v);
      }
    },
    getVolume: async () => currentVol,
    setRealDuration: (d: number) => {
      durationRef.current = d;
    },
    setPlaybackQuality: (q: string) => {
      applyQuality(q);
      if (useDualSurface) {
        dualSurfaceRef.current?.setPlaybackQuality?.(q);
      }
    },
    setPlaybackRate: (rate: number) => {
      if (useDualSurface) {
        dualSurfaceRef.current?.setPlaybackRate?.(rate);
      }
    },
    fastForwardAd: () => {},
  }));

  if (!playableSource && !useDualSurface) {
    return <View style={[styles.container, isFullscreen && { backgroundColor: '#000' }, style]} />;
  }

  return (
    <View style={[styles.container, isFullscreen && { backgroundColor: '#000' }, style]}>
      {useDualSurface ? (
        <DualSurfacePlayer
          ref={dualSurfaceRef}
          videoId={videoId}
          videoUri={playableSource?.uri || ''}
          headers={playableSource?.headers}
          play={Boolean(playableSource && !isPaused)}
          quality={quality}
          muted={muted}
          volume={currentVol}
          initialPosition={playableSource?.startPosition || 0}
          bleedEnabled={bleedEnabled}
          bleedDarkness={bleedDarkness}
          bbdCropPercent={bbdCropPercent}
          blurSigma={blurSigma}
          contentRect={contentRect}
          style={styles.video}
          onReady={(dur) => {
            if (!playableSource?.uri) return;
            isReadyRef.current = true;
            durationRef.current = dur;
            setIsBuffering(false);
            markReadyToDisplay();
            onLoad?.(dur);
          }}
          onProgress={(currentTime, dur) => {
            if (!playableSource?.uri) return;
            isReadyRef.current = true;
            positionRef.current = currentTime;
            if (dur > 0) durationRef.current = dur;
            if (!hasReportedReadyRef.current && currentTime > 0) {
              markReadyToDisplay();
            }
            onProgress?.(currentTime, dur);
          }}
          onBuffer={(buf) => {
            setIsBuffering(buf);
          }}
          onEnd={handleEnd}
          onError={handleError}
          onAspectRatio={(ar) => {
            onAspectRatio?.(ar);
          }}
          onExactResolution={onExactResolution}
          onQualitiesAvailable={onQualitiesAvailable}
        />
      ) : playableSource ? (
        <Video
          key={`exo_${playerKey}`}
          ref={videoRef}
          source={playableSource}
          selectedVideoTrack={selectedVideoTrack}
          viewType={1}
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
          resizeMode={resizeMode || 'contain'}
          style={styles.video}
          progressUpdateInterval={250}
          onLoad={handleLoad}
          onProgress={handleProgress}
          onBuffer={handleBuffer}
          onBandwidthUpdate={handleBandwidthUpdate}
          onReadyForDisplay={handleReadyForDisplay}
          onEnd={handleEnd}
          onError={handleError}
        />
      ) : null}
      {isBuffering && !bleedEnabled && !contentRect && (
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
    backgroundColor: 'transparent',
    overflow: 'visible',
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
