import React, { forwardRef, useImperativeHandle, useRef, memo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');
export const VIDEO_HEIGHT = width * (9 / 16);

export type PlayerState = 'unstarted' | 'buffering' | 'playing' | 'paused' | 'ended' | 'cued';

export interface YoutubePlayerRef {
  seekTo:          (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime:  () => Promise<number>;
  getDuration:     () => Promise<number>;
  playVideo:       () => void;
  pauseVideo:      () => void;
  setVolume:       (volume: number) => void;
  getVolume:       () => Promise<number>;
  setRealDuration: (duration: number) => void;
}

interface Props {
  videoId:        string;
  play:           boolean;
  muted?:         boolean;
  onReady?:       () => void;
  onStateChange?: (state: PlayerState) => void;
  onProgress?:    (currentTime: number, duration: number) => void;
  onAdStarted?:   () => void;
  onAdEnded?:     () => void;
  onError?:       (error: any) => void;
  style?:         any;
}

// ─── Pending guards — prevent stacked async calls ────────────────────────────
const pendingCT  = { current: false };
const pendingDur = { current: false };

const YoutubePlayer = memo(forwardRef<YoutubePlayerRef, Props>((props, ref) => {
  const {
    videoId, play, muted = false,
    onReady, onStateChange, onProgress,
    onAdStarted, onAdEnded, onError,
    style,
  } = props;

  const webViewRef   = useRef<WebView>(null);
  const resolversRef = useRef<Record<string, (val: number) => void>>({});

  // ─── Inject a command into the WebView ─────────────────────────────────────
  // ─── Native m.youtube.com Scraper ──────────────────────────────────────────
  // Instead of the IFrame API (which blocks VEVO/copyrighted videos with Error 150),
  // we load the real mobile site and control the <video> element directly.
  
  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

  const INJECTED_JS = `
    (function() {
      if (window.rnytInjected) return;
      window.rnytInjected = true;

      window.userPaused = false;
      var video = null;
      var adInterval = null;
      var stateInterval = null;
      var lastState = 'unstarted';

      function toRN(obj) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
      }

      function findVideo() {
        if (!video) {
          video = document.querySelector('video');
          if (video) {
            setupVideoListeners();
            toRN({ type: 'playerReady' });
          }
        }
      }

      function setupVideoListeners() {
        video.addEventListener('play', () => {
          if (lastState !== 'playing') { lastState = 'playing'; toRN({ type: 'stateChange', state: 'playing' }); }
        });
        video.addEventListener('pause', () => {
          if (lastState !== 'paused' && !video.ended) { lastState = 'paused'; toRN({ type: 'stateChange', state: 'paused' }); }
        });
        video.addEventListener('ended', () => {
          lastState = 'ended'; toRN({ type: 'stateChange', state: 'ended' });
        });
        video.addEventListener('timeupdate', () => {
          toRN({ type: 'progress', currentTime: video.currentTime, duration: video.duration });
        });
        video.addEventListener('error', () => {
          toRN({ type: 'playerError', code: 150 });
        });
      }

      // Hide all YouTube UI, leave only the video element
      function hideUI() {
        var style = document.createElement('style');
        style.innerHTML = \`
          body { background: #000 !important; overflow: hidden !important; }
          ytm-app, ytm-header-bar, ytm-mobile-topbar-renderer, 
          ytm-item-section-renderer, ytm-engagement-panel,
          .player-controls-bottom, .player-controls-top,
          .ytp-chrome-top, .ytp-chrome-bottom, .ytp-watermark,
          ytm-related-chip-cloud-renderer {
            display: none !important; opacity: 0 !important; visibility: hidden !important;
          }
          /* Make video full screen */
          .html5-video-container { width: 100vw !important; height: 100vh !important; }
          video { width: 100vw !important; height: 100vh !important; object-fit: contain !important; }
        \`;
        document.head.appendChild(style);
      }

      // Auto-skip ads
      function handleAds() {
        var skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
        if (skipBtn) {
          skipBtn.click();
          toRN({ type: 'adSkipClicked' });
        }
      }

      setInterval(() => {
        findVideo();
        hideUI();
        handleAds();
        
        // Enforce user paused state
        if (video) {
          if (window.userPaused && !video.paused) video.pause();
          if (!window.userPaused && video.paused) video.play().catch(e=>{});
        }
      }, 500);

      // Handle commands from React Native
      window.addEventListener('message', function(e) {
        try {
          var cmd = JSON.parse(e.data);
          if (!video) return;
          switch(cmd.action) {
            case 'play':
              window.userPaused = false;
              video.play().catch(err=>{});
              break;
            case 'pause':
              window.userPaused = true;
              video.pause();
              break;
            case 'seek':
              video.currentTime = cmd.time;
              break;
            case 'mute':
              video.muted = true;
              break;
            case 'unmute':
              video.muted = false;
              break;
            case 'volume':
              video.volume = cmd.value / 100;
              break;
            case 'getCurrentTime':
              toRN({ type: 'currentTime', id: cmd.id, value: video.currentTime });
              break;
            case 'getDuration':
              toRN({ type: 'duration', id: cmd.id, value: video.duration });
              break;
          }
        } catch(ex) {}
      });
    })();
    true;
  `;

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      switch (msg.type) {
        case 'playerReady':
          pendingCT.current  = false;
          pendingDur.current = false;
          onReady?.();
          if (play)  inject(`window.userPaused = false; player && player.playVideo()`);
          if (muted) inject(`player && player.mute()`);
          break;
        case 'stateChange':
          onStateChange?.(msg.state as PlayerState);
          break;
        case 'progress':
          onProgress?.(msg.currentTime, msg.duration);
          break;
        case 'adStarted': onAdStarted?.(); break;
        case 'adEnded':   onAdEnded?.();   break;
        case 'playerError': onError?.(msg.code); break;
        case 'currentTime':
          if (resolversRef.current[msg.id]) {
            resolversRef.current[msg.id](msg.value);
            delete resolversRef.current[msg.id];
          }
          pendingCT.current = false;
          break;
        case 'duration':
          if (resolversRef.current[msg.id]) {
            resolversRef.current[msg.id](msg.value);
            delete resolversRef.current[msg.id];
          }
          pendingDur.current = false;
          break;
      }
    } catch (e) {}
  };

  React.useEffect(() => {
    if (play) inject(`window.userPaused = false; if(document.querySelector('video')){document.querySelector('video').play().catch(e=>{});}`);
    else      inject(`window.userPaused = true; if(document.querySelector('video'))document.querySelector('video').pause()`);
  }, [play]);

  React.useEffect(() => {
    if (muted) inject(`if(document.querySelector('video'))document.querySelector('video').muted = true`);
    else       inject(`if(document.querySelector('video'))document.querySelector('video').muted = false`);
  }, [muted]);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      inject(`if(document.querySelector('video'))document.querySelector('video').currentTime = ${seconds}`);
    },
    getCurrentTime: () => new Promise((resolve) => {
      if (pendingCT.current) { resolve(0); return; }
      pendingCT.current = true;
      const id = 'ct_' + Date.now();
      resolversRef.current[id] = resolve;
      inject(`window.postMessage(JSON.stringify({action:'getCurrentTime',id:'${id}'}),'*')`);
      setTimeout(() => {
        if (resolversRef.current[id]) {
          delete resolversRef.current[id];
          pendingCT.current = false;
          resolve(0);
        }
      }, 2000);
    }),
    getDuration: () => new Promise((resolve) => {
      if (pendingDur.current) { resolve(0); return; }
      pendingDur.current = true;
      const id = 'dur_' + Date.now();
      resolversRef.current[id] = resolve;
      inject(`window.postMessage(JSON.stringify({action:'getDuration',id:'${id}'}),'*')`);
      setTimeout(() => {
        if (resolversRef.current[id]) {
          delete resolversRef.current[id];
          pendingDur.current = false;
          resolve(0);
        }
      }, 2000);
    }),
    playVideo:  () => inject(`window.userPaused = false; if(document.querySelector('video')){document.querySelector('video').play().catch(e=>{});}`),
    pauseVideo: () => inject(`window.userPaused = true; if(document.querySelector('video'))document.querySelector('video').pause()`),
    setVolume:  (v) => inject(`if(document.querySelector('video'))document.querySelector('video').volume = ${v}/100`),
    getVolume:  () => Promise.resolve(100),
    setRealDuration: (d) => {
      inject(`window.postMessage(JSON.stringify({action:'setRealDuration',duration:${d}}),'*')`);
    },
  }), []);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ uri: `https://m.youtube.com/watch?v=${videoId}` }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsBackgroundMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        thirdPartyCookiesEnabled
        mixedContentMode="always"
        scrollEnabled={false}
        bounces={false}
        style={styles.webview}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        injectedJavaScriptBeforeContentLoaded={`
          (function() {
            // 1. BLIND YouTube Detection
            var block = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); };
            window.addEventListener('visibilitychange', block, true);
            window.addEventListener('webkitvisibilitychange', block, true);
            window.addEventListener('blur', block, true);
            window.addEventListener('focus', block, true);

            // 2. LOCK Properties Early
            Object.defineProperty(document, 'hidden', { value: false, writable: false });
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
            Object.defineProperty(document, 'webkitVisibilityState', { value: 'visible', writable: false });
            Object.defineProperty(document, 'hasFocus', { value: function() { return true; }, writable: false });

            // 3. PROXY addEventListener (Total Stealth)
            var original = window.addEventListener;
            window.addEventListener = function(type, listener, options) {
              if (['visibilitychange','blur','focusout','pagehide'].includes(type)) return;
              return original.apply(this, arguments);
            };
          })();
          true;
        `}
        injectedJavaScript={`
          // MEDIA SESSION (Official lockscreen controls)
          if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: 'Streaming Content',
              artist: 'YouTube Player',
              album: 'App Media'
            });
            navigator.mediaSession.playbackState = 'playing';
            navigator.mediaSession.setActionHandler('play', function() { window.userPaused=false; if(document.querySelector('video')){document.querySelector('video').play();} });
            navigator.mediaSession.setActionHandler('pause', function() { window.userPaused=true; if(document.querySelector('video'))document.querySelector('video').pause(); });
          }
          
          ${INJECTED_JS}
        `}
      />
    </View>
  );
}));

YoutubePlayer.displayName = 'YoutubePlayer';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webview:   { flex: 1, backgroundColor: '#000' },
});

export default YoutubePlayer;
