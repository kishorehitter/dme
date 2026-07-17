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
  setPlaybackQuality: (quality: string) => void;
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
  onVideoData?:   (title: string, author: string) => void; // ✅ Callback for auto-extracted metadata
  quality?:       string;
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
    onVideoData,
    quality = 'highres',
    style,
  } = props;

  const webViewRef   = useRef<WebView>(null);
  const resolversRef = useRef<Record<string, (val: number) => void>>({});

  // ─── Inject a command into the WebView ─────────────────────────────────────
  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

  // ─── HTML with ad-skip engine ───────────────────────────────────────────────
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { margin:0; padding:0; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    #player { position: absolute; top: 0; left: 0; width:100%; height:100%; }

    /* ── Hide ALL YouTube UI chrome ─────────────────────────────────── */
    .ytp-chrome-top, .ytp-gradient-top, .ytp-title, .ytp-title-channel,
    .ytp-title-text, .ytp-title-beacon, .ytp-chrome-top-buttons,
    .ytp-watermark, .ytp-youtube-button, .ytp-chrome-bottom,
    .ytp-gradient-bottom, .ytp-progress-bar-container, .ytp-progress-bar,
    .ytp-cards-button, .ytp-cards-teaser, .iv-branding, .iv-card,
    .iv-drawer, .iv-message, .ytp-ce-element, .ytp-ce-covering-overlay,
    .ytp-endscreen-element, .ytp-endscreen-content, .ytp-share-button,
    .ytp-overflow-button, .ytp-miniplayer-button, .ytp-size-button,
    .ytp-fullscreen-button, .ytp-copylink-button, .ytp-pause-overlay,
    .ytp-hover-overlay, .ytp-subtitles-button, .ytp-settings-button,
    .ytp-ad-text-overlay, .ytp-ad-badge, .ytp-ad-info-dialog,
    .branding-img, .branding-img-container
    {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  </style>
</head>
<body>
<div id="player"></div>
<script>
  // ── Visibility Spoofing ───────────────────────────────────────────────────
  Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
  Object.defineProperty(document, 'hidden', { value: false, writable: false });

  // ── State ──────────────────────────────────────────────────────────────────
  var player       = null;
  var realDur      = 0;
  var adActive     = false;
  var skipInterval = null;
  var progressInt  = null;
  window.userPaused = false; 
  var selectedQuality = '${quality}';

  function adjustPlayerSize(quality) {
    var p = document.getElementById('player');
    if (!p) return;
    
    var containerWidth = window.innerWidth;
    var containerHeight = window.innerHeight;
    if (!containerWidth || !containerHeight) {
      setTimeout(function() { adjustPlayerSize(quality); }, 100);
      return;
    }
    
    var dpr = window.devicePixelRatio || 1;
    var W, H;
    switch(quality) {
      case 'tiny': // 144p
        W = 160 / dpr; H = 90 / dpr;
        break;
      case 'small': // 240p
        W = 320 / dpr; H = 180 / dpr;
        break;
      case 'medium': // 360p
        W = 480 / dpr; H = 270 / dpr;
        break;
      case 'large': // 480p
        W = 720 / dpr; H = 405 / dpr;
        break;
      case 'hd720': // 720p
        W = 1280 / dpr; H = 720 / dpr;
        break;
      case 'hd1080': // 1080p
      case 'highres': // 4K/highres
        W = 1920 / dpr; H = 1080 / dpr;
        break;
      case 'auto':
      default:
        p.style.width = '100%';
        p.style.height = '100%';
        p.style.transform = 'none';
        return;
    }
    
    var scaleX = containerWidth / W;
    var scaleY = containerHeight / H;
    var scale = Math.min(scaleX, scaleY);
    
    var offsetX = (containerWidth - (W * scale)) / 2;
    var offsetY = (containerHeight - (H * scale)) / 2;
    
    p.style.width = W + 'px';
    p.style.height = H + 'px';
    p.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
    p.style.transformOrigin = 'top left';
    
    if (player && typeof player.setPlaybackQuality === 'function') {
      player.setPlaybackQuality(quality);
    }
  }
  window.adjustPlayerSize = adjustPlayerSize;

  function updatePlayerSizeByState() {
    if (!player) return;
    var state = 'paused';
    try {
      var s = player.getPlayerState();
      if (s === 1) state = 'playing'; // Only 1 = playing (avoid buffering state 3 to prevent giant loading spinners)
    } catch(e) {}
    
    if (state === 'playing') {
      // If we are still waiting for play overlays to fade out, keep it at 1080p viewport
      if (window.playResizeTimeout) {
        adjustPlayerSize('hd1080');
      } else {
        adjustPlayerSize(selectedQuality);
      }
    } else {
      adjustPlayerSize('hd1080'); // small overlays when paused/buffering
    }
  }
  window.updatePlayerSizeByState = updatePlayerSizeByState;

  var resizeTimeout;
  window.addEventListener('resize', function() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updatePlayerSizeByState, 150);
  });

  function toRN(obj) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
  }

  // ── CSS: aggressively hide all YouTube UI chrome ──────────────────────────
  var HIDE_CSS = [
    '.ytp-chrome-top','.ytp-gradient-top','.ytp-title','.ytp-title-channel',
    '.ytp-title-text','.ytp-title-beacon','.ytp-chrome-top-buttons',
    '.ytp-watermark','.ytp-youtube-button',
    '.ytp-chrome-bottom','.ytp-gradient-bottom',
    '.ytp-progress-bar-container','.ytp-progress-bar',
    '.ytp-cards-button','.ytp-cards-teaser',
    '.iv-branding','.iv-card','.iv-drawer','.iv-message',
    '.ytp-ce-element','.ytp-ce-covering-overlay',
    '.ytp-endscreen-element','.ytp-endscreen-content',
    '.ytp-share-button','.ytp-overflow-button',
    '.ytp-miniplayer-button','.ytp-size-button',
    '.ytp-fullscreen-button','.ytp-copylink-button',
    '.ytp-pause-overlay','.ytp-hover-overlay',
    '.ytp-subtitles-button','.ytp-settings-button',
    '.ytp-ad-text-overlay','.ytp-ad-badge','.ytp-ad-info-dialog',
    '.branding-img','.branding-img-container',
  ].join(',');

  function hideYouTubeUI() {
    try {
      var iframes = document.querySelectorAll('iframe');
      iframes.forEach(function(iframe) {
        try {
          var doc = iframe.contentDocument;
          if (!doc) return;
          var existing = doc.getElementById('dme-hide-style');
          if (!existing) {
            var s = doc.createElement('style');
            s.id = 'dme-hide-style';
            s.textContent = HIDE_CSS + '{ display:none!important; opacity:0!important; pointer-events:none!important; }';
            (doc.head || doc.documentElement).appendChild(s);
          }
        } catch(e) {}
      });
      var els = document.querySelectorAll(HIDE_CSS);
      els.forEach(function(el) { el.style.cssText = 'display:none!important;opacity:0!important;pointer-events:none!important;'; });
    } catch(e) {}
  }

  var observer = new MutationObserver(function() { hideYouTubeUI(); });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Ad-skip engine ─────────────────────────────────────────────────────────
  var SKIP_SEL = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container button',
    'button[class*=\"skip\"]',
    '[aria-label=\"Skip ad\"]',
    '[aria-label=\"Skip Ad\"]',
  ];

  function trySkip() {
    for (var i = 0; i < SKIP_SEL.length; i++) {
      var btn = document.querySelector(SKIP_SEL[i]);
      if (btn) {
        var s = window.getComputedStyle(btn);
        if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') {
          btn.click();
          toRN({ type: 'adSkipClicked' });
          return true;
        }
      }
    }
    try {
      var iframes = document.querySelectorAll('iframe');
      iframes.forEach(function(iframe) {
        try {
          var doc = iframe.contentDocument;
          if (!doc) return;
          for (var j = 0; j < SKIP_SEL.length; j++) {
            var b = doc.querySelector(SKIP_SEL[j]);
            if (b) { b.click(); toRN({ type: 'adSkipClicked' }); }
          }
        } catch(e) {}
      });
    } catch(e) {}
    return false;
  }

  function checkAdState() {
    var p = document.querySelector('.html5-video-player');
    var isAd = p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
    if (!isAd && realDur > 0 && player) {
      try {
        var dur = player.getDuration();
        if (dur > 0 && Math.abs(dur - realDur) > 10) isAd = true;
      } catch(e) {}
    }
    if (isAd) {
      if (!adActive) { adActive = true; toRN({ type: 'adStarted' }); }
      trySkip();
    } else {
      if (adActive) { adActive = false; toRN({ type: 'adEnded' }); }
    }
  }

  function startAdEngine() {
    if (skipInterval) clearInterval(skipInterval);
    skipInterval = setInterval(checkAdState, 300);
  }

  function startProgress() {
    if (progressInt) clearInterval(progressInt);
    progressInt = setInterval(function() {
      if (!player) return;
      try {
        var t = player.getCurrentTime();
        var d = player.getDuration();
        if (!isNaN(t) && !isNaN(d)) {
          toRN({ type: 'progress', currentTime: t, duration: d });
        }
      } catch(e) {}
    }, 1000);
  }

  function postVideoData() {
    try {
      if (player && typeof player.getVideoData === 'function') {
        var data = player.getVideoData();
        if (data && data.title) {
          toRN({ type: 'videoData', title: data.title, author: data.author || '' });
        }
      }
    } catch(ex) {}
  }

  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      width:  '100%',
      height: '100%',
      videoId: '${videoId}',
      playerVars: {
        autoplay:       0,
        controls:       0,
        playsinline:    1,
        rel:            0,
        modestbranding: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        fs:             0,
        disablekb:      1,
        origin:         'https://localhost',
        suggestedQuality: '${quality}',
      },
      events: {
        onReady:       function(e) {
          var p = e.target;
          var originalPlay = p.playVideo;
          p.playVideo = function() {
            adjustPlayerSize('hd1080');
            originalPlay.apply(p, arguments);
          };
          var originalPause = p.pauseVideo;
          p.pauseVideo = function() {
            adjustPlayerSize('hd1080');
            originalPause.apply(p, arguments);
          };

          updatePlayerSizeByState();
          toRN({ type: 'playerReady' });
          startAdEngine();
          startProgress();
          postVideoData();
          setTimeout(hideYouTubeUI, 500);
          setTimeout(hideYouTubeUI, 1500);
        },
        onStateChange: function(e) {
          var map = {'-1':'unstarted','0':'ended','1':'playing','2':'paused','3':'buffering','5':'cued'};
          var state = map[String(e.data)] || 'unstarted';
          
          if (state === 'playing') {
            if (window.playResizeTimeout) clearTimeout(window.playResizeTimeout);
            window.playResizeTimeout = setTimeout(function() {
              window.playResizeTimeout = null; // Clear timeout reference
              try {
                if (player && player.getPlayerState() === 1) {
                  adjustPlayerSize(selectedQuality);
                }
              } catch(e) {}
            }, 4500); // 4.5s delay to ensure overlays have fully faded out
          } else {
            if (window.playResizeTimeout) {
              clearTimeout(window.playResizeTimeout);
              window.playResizeTimeout = null;
            }
            adjustPlayerSize('hd1080'); // keep it 1080p viewport when buffering/paused/etc.
          }
          
          toRN({ type: 'stateChange', state: state });
          postVideoData();
          setTimeout(hideYouTubeUI, 200);
        },
        onPlaybackQualityChange: function(e) {
          try {
            var state = player.getPlayerState();
            if (state === 1) {
              toRN({ type: 'playbackQualityChange', quality: e.data });
            }
          } catch(err) {
            toRN({ type: 'playbackQualityChange', quality: e.data });
          }
        },
        onError: function(e) {
          toRN({ type: 'playerError', code: e.data });
        },
      }
    });
    window.player = player;
    adjustPlayerSize('hd1080'); // Tiny on load
  }

  document.addEventListener('message', handleCmd);
  window.addEventListener('message', handleCmd);

  function handleCmd(e) {
    try {
      var cmd = JSON.parse(e.data);
      if (!player) return;
      switch(cmd.action) {
        case 'play':
          window.userPaused = false;
          player.playVideo();
          break;
        case 'pause':
          window.userPaused = true;
          player.pauseVideo();
          break;
        case 'seek':            player.seekTo(cmd.time, true);break;
        case 'mute':            player.mute();                break;
        case 'unmute':          player.unMute();              break;
        case 'volume':          player.setVolume(cmd.value);  break;
        case 'setRealDuration':
          realDur = cmd.duration;
          break;
        case 'getCurrentTime':
          toRN({ type: 'currentTime', id: cmd.id, value: player.getCurrentTime() });
          break;
        case 'getDuration':
          toRN({ type: 'duration', id: cmd.id, value: player.getDuration() });
          break;
      }
    } catch(ex) {}
  }
</script>
</body>
</html>`;

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
        case 'videoData':
          onVideoData?.(msg.title, msg.author);
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
        case 'playbackQualityChange':
          console.log(`📺 [YouTubePlayer] YouTube player successfully switched stream quality to: ${msg.quality}`);
          break;
        case 'duration':
          if (resolversRef.current[msg.id]) {
            resolversRef.current[msg.id](msg.value);
            delete resolversRef.current[msg.id];
          }
          pendingDur.current = false;
          break;
        case 'mediaSessionPlay':
          // WebView's own navigator.mediaSession play handler fired (background-safe)
          // Forward to the same channel as the native notification button
          try {
            const { DeviceEventEmitter } = require('react-native');
            DeviceEventEmitter.emit('WEBVIEW_MEDIA_PLAY');
          } catch (_) {}
          break;
        case 'mediaSessionPause':
          // WebView's own navigator.mediaSession pause handler fired (background-safe)
          try {
            const { DeviceEventEmitter } = require('react-native');
            DeviceEventEmitter.emit('WEBVIEW_MEDIA_PAUSE');
          } catch (_) {}
          break;
      }
    } catch (e) {}
  };

  React.useEffect(() => {
    if (play) inject(`window.userPaused = false; player && player.playVideo()`);
    else      inject(`window.userPaused = true; player && player.pauseVideo()`);
  }, [play]);

  React.useEffect(() => {
    if (muted) inject(`player && player.mute()`);
    else       inject(`player && player.unMute()`);
  }, [muted]);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      inject(`player && player.seekTo(${seconds}, true)`);
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
    playVideo:  () => inject(`window.userPaused = false; player && player.playVideo()`),
    pauseVideo: () => inject(`window.userPaused = true; player && player.pauseVideo()`),
    setVolume:  (v) => inject(`player && player.setVolume(${v})`),
    getVolume:  () => Promise.resolve(100),
    setRealDuration: (d) => {
      inject(`window.postMessage(JSON.stringify({action:'setRealDuration',duration:${d}}),'*')`);
    },
    setPlaybackQuality: (q) => {
      console.log(`⚡ [YouTubePlayer] Requesting quality switch to: ${q}`);
      inject(`
        selectedQuality = '${q}';
        if (window.updatePlayerSizeByState) {
          window.updatePlayerSizeByState();
        }
        if (window.player && window.player.setPlaybackQuality) {
          window.player.setPlaybackQuality('${q}');
        }
      `);
    }
  }), []);

  // ✅ Memoize WebView source to prevent reload flashing when parent component re-renders
  const webViewSource = React.useMemo(() => ({ html, baseUrl: 'https://localhost/' }), [videoId]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={webViewSource}
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
          (function() {
            window.userPaused = false;
            
            // HEARTBEAT — restart playback if it stalls unintentionally.
            // Checks window.userPaused so notification-button pauses are respected.
            setInterval(function() {
              if (!window.userPaused && window.player && window.player.getPlayerState && window.player.getPlayerState() === 2) {
                window.player.playVideo();
              }
            }, 500);

            // MEDIA SESSION (Official lockscreen controls)
            // These handlers fire even in background when the YouTube player
            // holds the OS media session (via its own audio focus).
            // We postMessage back to React Native so the room can be synced.
            if ('mediaSession' in navigator) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: 'Streaming Content',
                artist: 'YouTube Player',
                album: 'App Media'
              });
              navigator.mediaSession.playbackState = 'playing';
              navigator.mediaSession.setActionHandler('play', function() {
                window.userPaused = false;
                if (window.player) window.player.playVideo();
                // Signal React Native — works from background
                try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mediaSessionPlay' })); } catch(e) {}
              });
              navigator.mediaSession.setActionHandler('pause', function() {
                window.userPaused = true;
                if (window.player) window.player.pauseVideo();
                // Signal React Native — works from background
                try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mediaSessionPause' })); } catch(e) {}
              });
            }
          })();
          true;
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
