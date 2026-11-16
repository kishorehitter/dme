import React, { forwardRef, useImperativeHandle, useRef, useEffect, useCallback } from 'react';
import {
  requireNativeComponent,
  UIManager,
  findNodeHandle,
  ViewStyle,
  StyleProp,
  NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';

const NativeDualSurfaceVideoView: any =
  (global as any).__NativeDualSurfaceVideoView ||
  ((global as any).__NativeDualSurfaceVideoView = requireNativeComponent<any>('DualSurfaceVideoView'));

export interface DualSurfacePlayerRef {
  seekTo: (seconds: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (volume: number) => void;
  setPlaybackQuality: (quality: string) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
}

export interface DualSurfacePlayerProps {
  videoId?: string | null;
  videoUri: string;
  headers?: Record<string, string>;
  play: boolean;
  quality?: string;
  muted?: boolean;
  volume?: number;
  initialPosition?: number;
  roomTheme?: string;
  bleedEnabled?: boolean;
  isTransparentBackground?: boolean;
  bleedDarkness?: number;
  bbdCropPercent?: number; // e.g. 0.122 for Narivetta
  bbdHorizCropPercent?: number;
  displayMode?: number; // 0 = Rave Dynamic, 1 = Zoom to Fill
  blurSigma?: number;
  contentRect?: { x: number; y: number; width: number; height: number };
  onReady?: (duration: number) => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
  onBuffer?: (isBuffering: boolean) => void;
  onAspectRatio?: (aspectRatio: number, width?: number, height?: number) => void;
  onBlackBarDetected?: (aspectRatio: number, verticalPercent: number, horizontalPercent: number) => void;
  onExactResolution?: (resolution: string) => void;
  onQualitiesAvailable?: (qualities: string[]) => void;
  style?: StyleProp<ViewStyle>;
}

const DualSurfacePlayer = forwardRef<DualSurfacePlayerRef, DualSurfacePlayerProps>((props, ref) => {
  const {
    videoUri,
    headers,
    play,
    quality = 'auto',
    muted = false,
    volume = 1.0,
    initialPosition = 0,
    bleedEnabled = true,
    isTransparentBackground = false,
    bleedDarkness = 0.60,
    bbdCropPercent = 0.0,
    bbdHorizCropPercent = 0.0,
    displayMode = 0,
    blurSigma = 48.0,
    contentRect,
    onReady,
    onProgress,
    onEnd,
    onError,
    onBuffer,
    onAspectRatio,
    onBlackBarDetected,
    onExactResolution,
    onQualitiesAvailable,
    style,
  } = props;

  const nativeRef = useRef<any>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const initialSeekDoneRef = useRef(false);
  const hasFiredReadyRef = useRef(false);
  const lastVideoUriRef = useRef<string>(videoUri);

  useEffect(() => {
    if (videoUri !== lastVideoUriRef.current) {
      lastVideoUriRef.current = videoUri;
      hasFiredReadyRef.current = false;
      initialSeekDoneRef.current = false;
      currentTimeRef.current = 0;
      durationRef.current = 0;
    }
  }, [videoUri]);

  const dispatch = useCallback((commandName: string, args: any[] = []) => {
    const node = findNodeHandle(nativeRef.current);
    if (!node) return;
    try {
      const config = UIManager.getViewManagerConfig
        ? UIManager.getViewManagerConfig('DualSurfaceVideoView')
        : (UIManager as any)['DualSurfaceVideoView'];
      const commandId = config?.Commands?.[commandName] ?? commandName;
      UIManager.dispatchViewManagerCommand(node, commandId, args);
    } catch (e) {
      console.warn('[DualSurfacePlayer] dispatch error:', e);
    }
  }, []);

  useEffect(() => {
    if (videoUri) {
      dispatch(play ? 'play' : 'pause');
    } else {
      dispatch('stop');
    }
  }, [play, videoUri, dispatch]);

  useEffect(() => {
    dispatch('setVolume', [muted ? 0 : volume]);
  }, [muted, volume, dispatch]);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number) => {
      currentTimeRef.current = seconds;
      dispatch('seekTo', [seconds]);
    },
    playVideo: () => {
      dispatch('play');
    },
    pauseVideo: () => {
      dispatch('pause');
    },
    stopVideo: () => {
      dispatch('stop');
    },
    setVolume: (vol: number) => {
      dispatch('setVolume', [vol]);
    },
    setPlaybackQuality: (q: string) => {
      dispatch('setQuality', [q]);
    },
    setPlaybackRate: (rate: number) => {
      dispatch('setPlaybackRate', [rate]);
    },
    getCurrentTime: async () => currentTimeRef.current,
    getDuration: async () => durationRef.current,
  }), [dispatch]);

  const handleReady = useCallback((event: NativeSyntheticEvent<{ duration: number; isLive?: boolean }>) => {
    const dur = event.nativeEvent?.duration || 0;
    const isLive = Boolean(event.nativeEvent?.isLive || dur <= 0);
    durationRef.current = dur;
    if (initialPosition > 0 && !initialSeekDoneRef.current && !isLive) {
      initialSeekDoneRef.current = true;
      dispatch('seekTo', [initialPosition]);
    }
    if (!hasFiredReadyRef.current) {
      hasFiredReadyRef.current = true;
      onReady?.(dur);
    }
  }, [dispatch, initialPosition, onReady]);

  const handleProgress = useCallback((event: NativeSyntheticEvent<{ currentTime: number; duration: number; isLive?: boolean }>) => {
    const { currentTime, duration, isLive } = event.nativeEvent;
    currentTimeRef.current = currentTime;
    if (duration > 0) durationRef.current = duration;
    if (!hasFiredReadyRef.current && (currentTime > 0 || isLive)) {
      hasFiredReadyRef.current = true;
      onReady?.(duration || 0);
    }
    onProgress?.(currentTime, duration);
  }, [onProgress, onReady]);

  const handleBuffer = useCallback((event: NativeSyntheticEvent<{ isBuffering: boolean }>) => {
    onBuffer?.(event.nativeEvent.isBuffering);
  }, [onBuffer]);

  const handleEnd = useCallback(() => {
    onEnd?.();
  }, [onEnd]);

  const handleError = useCallback((event: NativeSyntheticEvent<{ error: string; errorCode: number }>) => {
    onError?.(event.nativeEvent);
  }, [onError]);

  const handleAspectRatio = useCallback((event: NativeSyntheticEvent<{ aspectRatio: number; width: number; height: number }>) => {
    const { aspectRatio, width, height } = event.nativeEvent;
    onAspectRatio?.(aspectRatio, width, height);
  }, [onAspectRatio]);

  const handleBlackBarDetected = useCallback((event: NativeSyntheticEvent<{ aspectRatio: number; verticalPercent: number; horizontalPercent?: number }>) => {
    const { aspectRatio, verticalPercent, horizontalPercent = 0.0 } = event.nativeEvent;
    onBlackBarDetected?.(aspectRatio, verticalPercent, horizontalPercent);
  }, [onBlackBarDetected]);

  const handleExactResolution = useCallback((event: NativeSyntheticEvent<{ resolution: string }>) => {
    onExactResolution?.(event.nativeEvent.resolution);
  }, [onExactResolution]);

  const handleQualitiesAvailable = useCallback((event: NativeSyntheticEvent<{ qualities: string[] }>) => {
    onQualitiesAvailable?.(event.nativeEvent.qualities);
  }, [onQualitiesAvailable]);

  const nativeSource = React.useMemo(() => {
    if (!videoUri) return null;
    return {
      uri: videoUri,
      headers: headers || undefined,
    };
  }, [videoUri, headers]);

  return (
    <NativeDualSurfaceVideoView
      ref={nativeRef}
      style={[styles.container, style]}
      source={nativeSource}
      roomTheme={props.roomTheme}
      play={play}
      quality={quality}
      muted={muted}
      volume={volume}
      bleedEnabled={bleedEnabled}
      isTransparentBackground={isTransparentBackground}
      bleedDarkness={bleedDarkness}
      bbdCropPercent={bbdCropPercent}
      bbdHorizCropPercent={bbdHorizCropPercent}
      displayMode={displayMode}
      blurSigma={blurSigma}
      contentRect={contentRect}
      onReady={handleReady}
      onProgress={handleProgress}
      onBuffer={handleBuffer}
      onEnd={handleEnd}
      onError={handleError}
      onAspectRatio={handleAspectRatio}
      onBlackBarDetected={handleBlackBarDetected}
      onExactResolution={handleExactResolution}
      onQualitiesAvailable={handleQualitiesAvailable}
    />
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
});

export default DualSurfacePlayer;
