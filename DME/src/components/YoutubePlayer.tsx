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
  aspectRatio?:   number;
  onAspectRatio?: (aspectRatio: number) => void;
  quality?:       string;
  onQualityChange?: (quality: string) => void;
  style?:         any;
  onQualitiesAvailable?: (qualities: string[]) => void;
  isFullscreen?:  boolean;
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
    aspectRatio = 1.7777,
    onAspectRatio,
    quality = 'highres',
    onQualityChange,
    style,
    onQualitiesAvailable,
    isFullscreen = false,
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
  window.videoAR = ${aspectRatio || 1.7777};

  function adjustPlayerSize(quality) {
    var p = document.getElementById('player');
    if (!p) return;
    
    var containerWidth = window.innerWidth;
    var containerHeight = window.innerHeight;
    if (!containerWidth || !containerHeight) {
      setTimeout(function() { adjustPlayerSize(quality); }, 100);
      return;
    }
    
    var ar = window.videoAR || ${aspectRatio || 1.7777};
    var W, H;
    switch(quality) {
      case 'tiny': // 144p
        W = 160;
        break;
      case 'small': // 240p
        W = 320;
        break;
      case 'medium': // 360p
        W = 480;
        break;
      case 'large': // 480p
        W = 720;
        break;
      case 'hd720': // 720p
        W = 1280;
        break;
      case 'hd1080': // 1080p
      case 'highres': // 4K/highres
        W = 1920;
        break;
      case 'auto':
      default:
        p.style.width = '100%';
        p.style.height = '100%';
        p.style.transform = 'none';
        return;
    }
    H = Math.round(W / ar);
    
    var scaleX = containerWidth / W;
    var scaleY = containerHeight / H;
    var scale = (window.isFullscreen || ar < 1.0) ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    
    var offsetX = (containerWidth - (W * scale)) / 2;
    var offsetY = (containerHeight - (H * scale)) / 2;
    
    p.style.width = W + 'px';
    p.style.height = H + 'px';
    p.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
    p.style.transformOrigin = 'top left';
    
    if (player && typeof player.setPlaybackQuality === 'function') {
      try {
        var targetQ = quality === 'auto' ? 'default' : quality;
        player.setPlaybackQuality(targetQ);
      } catch(e) {}
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
    'button[class*="skip"]',
    '[aria-label="Skip ad"]',
    '[aria-label="Skip Ad"]',
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
          if (t > 0) window.lastPlayerPosition = t;
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

  function detectLetterbox(vId) {
    if (!vId) return;
    function checkThumb(url, isMaxRes) {
      var img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = function() {
        try {
          var W = 160;
          var H = Math.round(W * (img.naturalHeight / img.naturalWidth));
          if (!H || H <= 0) H = 90;
          var cvs = document.createElement('canvas');
          cvs.width = W; cvs.height = H;
          var ctx = cvs.getContext('2d');
          ctx.drawImage(img, 0, 0, W, H);
          var imgData = ctx.getImageData(0, 0, W, H).data;
          
          function isPixelDark(x, y) {
            var idx = (y * W + x) * 4;
            return imgData[idx] < 30 && imgData[idx+1] < 30 && imgData[idx+2] < 30;
          }
          
          // 1. Scan Top & Bottom Letterbox Bars (Cinema / Widescreen)
          var topBar = 0;
          while (topBar < H / 2.8) {
            var darkCols = 0;
            for (var x = 16; x < W - 16; x += 4) {
              if (isPixelDark(x, topBar)) darkCols++;
            }
            if (darkCols / ((W - 32) / 4) > 0.85) topBar++;
            else break;
          }
          
          var bottomBar = 0;
          while (bottomBar < H / 2.8) {
            var darkCols = 0;
            for (var x = 16; x < W - 16; x += 4) {
              if (isPixelDark(x, H - 1 - bottomBar)) darkCols++;
            }
            if (darkCols / ((W - 32) / 4) > 0.85) bottomBar++;
            else break;
          }
          
          var letterboxH = Math.min(topBar, bottomBar);
          if (letterboxH >= Math.round(H * 0.04)) {
            var activeH = H - (letterboxH * 2);
            var contentAR = (img.naturalWidth / img.naturalHeight) * (H / activeH);
            if (contentAR >= 1.85 && contentAR <= 3.2) {
              toRN({ type: 'aspectRatio', aspectRatio: contentAR });
              return;
            }
          }
          
          // 2. Scan Left & Right Pillarbox Bars (Tall / 4:3 / Narrow)
          var leftBar = 0;
          while (leftBar < W / 3) {
            var darkRows = 0;
            for (var y = 10; y < H - 10; y += 4) {
              if (isPixelDark(leftBar, y)) darkRows++;
            }
            if (darkRows / ((H - 20) / 4) > 0.85) leftBar++;
            else break;
          }
          
          var rightBar = 0;
          while (rightBar < W / 3) {
            var darkRows = 0;
            for (var y = 10; y < H - 10; y += 4) {
              if (isPixelDark(W - 1 - rightBar, y)) darkRows++;
            }
            if (darkRows / ((H - 20) / 4) > 0.85) rightBar++;
            else break;
          }
          
          var pillarboxW = Math.min(leftBar, rightBar);
          if (pillarboxW >= Math.round(W * 0.04)) {
            var activeW = W - (pillarboxW * 2);
            var contentAR = (img.naturalWidth / img.naturalHeight) * (activeW / W);
            if (contentAR >= 0.5 && contentAR <= 1.7) {
              toRN({ type: 'aspectRatio', aspectRatio: contentAR });
              return;
            }
          }
        } catch(e) {}
      };
      img.onerror = function() {
        if (isMaxRes) checkThumb('https://i.ytimg.com/vi/' + vId + '/sddefault.jpg', false);
      };
      img.src = url;
    }
    checkThumb('https://i.ytimg.com/vi/' + vId + '/maxresdefault.jpg', true);
  }
  detectLetterbox('${videoId}');

  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  function onYouTubeIframeAPIReady() {
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: false });
    } catch(e) {}
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
          if (window.lastPlayerPosition && window.lastPlayerPosition > 1) {
            try { p.seekTo(window.lastPlayerPosition, true); } catch(err) {}
          }
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
          var qualities = [];
          if (p && typeof p.getAvailableQualityLevels === 'function') {
            qualities = p.getAvailableQualityLevels();
          }
          toRN({ type: 'playerReady', qualities: qualities });
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
          
          var qualities = [];
          if (player && typeof player.getAvailableQualityLevels === 'function') {
            qualities = player.getAvailableQualityLevels();
          }
          
          toRN({ type: 'stateChange', state: state, qualities: qualities });
          postVideoData();
          setTimeout(hideYouTubeUI, 200);
        },
        onPlaybackQualityChange: function(e) {
          toRN({ type: 'playbackQualityChange', quality: e.data });
        },
        onError: function(e) {
          toRN({ type: 'playerError', code: e.data });
        },
      }
    });
    window.player = player;
    adjustPlayerSize(selectedQuality); // Use target quality from the very start

    // ── Real-time Data Transfer Monitor ────────────────────────────────────────
    var lastBytes = 0;
    var lastTime = Date.now();
    setInterval(function() {
      try {
        if (!window.performance || !window.performance.getEntriesByType) return;
        var resources = window.performance.getEntriesByType('resource');
        var totalBytes = 0;
        var videoChunks = 0;
        
        for (var i = 0; i < resources.length; i++) {
          var r = resources[i];
          if (r.name && (r.name.indexOf('googlevideo.com') !== -1 || r.name.indexOf('videoplayback') !== -1)) {
            videoChunks++;
            var sz = r.transferSize || r.encodedBodySize || r.decodedBodySize || 0;
            totalBytes += sz;
          }
        }
        
        var now = Date.now();
        var elapsedSec = Math.max(1, (now - lastTime) / 1000);
        var bytesDiff = Math.max(0, totalBytes - lastBytes);
        var speedKBps = Math.round((bytesDiff / 1024) / elapsedSec);
        
        lastBytes = totalBytes;
        lastTime = now;
        
        if (totalBytes > 0) {
          var totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
          toRN({
            type: 'dataTransferStats',
            totalMB: totalMB,
            speedKBps: speedKBps,
            chunks: videoChunks,
            quality: (player && player.getPlaybackQuality) ? player.getPlaybackQuality() : selectedQuality
          });
        }
      } catch(e) {}
    }, 3000);
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
          if (msg.qualities) {
            onQualitiesAvailable?.(msg.qualities);
          }
          if (play)  inject(`window.userPaused = false; player && player.playVideo()`);
          if (muted) inject(`player && player.mute()`);
          break;
        case 'stateChange':
          onStateChange?.(msg.state as PlayerState);
          if (msg.qualities) {
            onQualitiesAvailable?.(msg.qualities);
          }
          break;
        case 'progress':
          onProgress?.(msg.currentTime, msg.duration);
          break;
        case 'aspectRatio':
          if (msg.aspectRatio && typeof onAspectRatio === 'function') {
            onAspectRatio(msg.aspectRatio);
          }
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
        case 'qualityDiagnostic':
          console.log(`🔬 [QUALITY_DIAGNOSTIC] Requested: ${msg.target} | Active Quality: ${msg.current} | Available Levels: ${JSON.stringify(msg.available)}`);
          break;
        case 'dataTransferStats':
          console.log(`📊 [DATA TRANSFER] Total: ${msg.totalMB} MB | Live Rate: ${msg.speedKBps} KB/s | Resolution: ${msg.quality} (${msg.chunks} segments)`);
          break;
        case 'playbackQualityChange':
          console.log(`📺 [YouTubePlayer] YouTube player switched stream quality to: ${msg.quality}`);
          onQualityChange?.(msg.quality);
          break;
        case 'duration':
          if (resolversRef.current[msg.id]) {
            resolversRef.current[msg.id](msg.value);
            delete resolversRef.current[msg.id];
          }
          pendingDur.current = false;
          break;
        case 'mediaSessionPlay':
          try {
            const { DeviceEventEmitter } = require('react-native');
            DeviceEventEmitter.emit('WEBVIEW_MEDIA_PLAY');
          } catch (_) {}
          break;
        case 'mediaSessionPause':
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

  React.useEffect(() => {
    inject(`window.isFullscreen = ${isFullscreen ? 'true' : 'false'}; if (window.updatePlayerSizeByState) window.updatePlayerSizeByState();`);
  }, [isFullscreen]);

  React.useEffect(() => {
    return () => {
      try {
        inject(`
          if (window.player) {
            try { window.player.mute(); } catch(_) {}
            try { window.player.stopVideo(); } catch(_) {}
          }
        `);
      } catch (_) {}
    };
  }, []);

  React.useEffect(() => {
    if (aspectRatio) {
      inject(`window.videoAR = ${aspectRatio}; if (window.updatePlayerSizeByState) window.updatePlayerSizeByState();`);
    }
  }, [aspectRatio]);

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
        (function() {
          selectedQuality = '${q}';
          var targetQ = '${q}' === 'auto' ? 'default' : '${q}';

          if (window.playResizeTimeout) {
            clearTimeout(window.playResizeTimeout);
            window.playResizeTimeout = null;
          }

          if (typeof adjustPlayerSize === 'function') {
            adjustPlayerSize(selectedQuality);
          }

          if (window.player) {
            try {
              if (typeof window.player.setPlaybackQualityRange === 'function') {
                if (targetQ === 'default') {
                  window.player.setPlaybackQualityRange('small', 'highres');
                } else {
                  window.player.setPlaybackQualityRange(targetQ, targetQ);
                }
              }
            } catch(e) {}

            try {
              if (typeof window.player.setPlaybackQuality === 'function') {
                window.player.setPlaybackQuality(targetQ);
              }
            } catch(e) {}
          }

          try {
            var iframe = document.getElementById('player') || document.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage(JSON.stringify({
                event: 'command',
                func: 'setPlaybackQuality',
                args: [targetQ]
              }), '*');

              if (targetQ !== 'default') {
                iframe.contentWindow.postMessage(JSON.stringify({
                  event: 'command',
                  func: 'setPlaybackQualityRange',
                  args: [targetQ, targetQ]
                }), '*');
              }
            }
          } catch(e) {}
        })();
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

            // 4. DYNAMIC NETWORK INFORMATION PROXY (Quality / Bitrate Controller)
            window.__netDownlink = 25.0;
            window.__netType = '4g';
            window.__saveData = false;

            var netConn = {
              get downlink() { return window.__netDownlink || 25.0; },
              get effectiveType() { return window.__netType || '4g'; },
              get rtt() { return 80; },
              get saveData() { return window.__saveData || false; },
              addEventListener: function() {},
              removeEventListener: function() {},
            };
            try {
              Object.defineProperty(navigator, 'connection', {
                get: function() { return netConn; },
                configurable: true
              });
            } catch(e) {}
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
            }, 3000);
          })();
          true;
        `}
      />
    </View>
  );
}));

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default YoutubePlayer;
