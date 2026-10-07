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
  initialPosition?: number;
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
  onExactResolution?: (resolution: string) => void;
  style?:         any;
  onQualitiesAvailable?: (qualities: string[]) => void;
  isFullscreen?:  boolean;
}

// ─── Pending guards — prevent stacked async calls ────────────────────────────
const pendingCT  = { current: false };
const pendingDur = { current: false };

const formatQualityLabel = (q: string): string => {
  switch (q) {
    case 'auto': return 'Auto';
    case 'hd4320': return '4320p';
    case 'highres':
    case 'hd2160': return '2160p';
    case 'hd1440': return '1440p';
    case 'hd1080': return '1080p';
    case 'hd720': return '720p';
    case 'large': return '480p';
    case 'medium': return '360p';
    case 'small': return '240p';
    case 'tiny': return '144p';
    default:
      if (/^\d+$/.test(q)) return `${q}p`;
      if (/^\d+p$/i.test(q)) return q.toLowerCase();
      return q;
  }
};

const YoutubePlayer = memo(forwardRef<YoutubePlayerRef, Props>((props, ref) => {
  const {
    videoId, play, muted = false,
    initialPosition = 0,
    onReady, onStateChange, onProgress,
    onAdStarted, onAdEnded, onError,
    onVideoData,
    aspectRatio = 1.7777,
    onAspectRatio,
    quality = 'highres',
    onQualityChange,
    onExactResolution,
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
  var selectedQuality = '${quality || "auto"}';
  var lastAntiDrift = 0;
  window.videoAR = ${aspectRatio || 1.7777};

  // ── Downlink Bitrate Profiles for ABR Hijacking ───────────────────────────
  var DOWNLINK_MAP = {
    'tiny':    { downlink: 0.25,  effectiveType: '2g', saveData: true  }, // 144p
    'small':   { downlink: 0.50,  effectiveType: '2g', saveData: true  }, // 240p
    'medium':  { downlink: 0.95,  effectiveType: '3g', saveData: false }, // 360p
    'large':   { downlink: 1.80,  effectiveType: '3g', saveData: false }, // 480p
    'hd720':   { downlink: 7.00,  effectiveType: '4g', saveData: false }, // 720p
    'hd1080':  { downlink: 18.00, effectiveType: '4g', saveData: false }, // 1080p
    'hd1440':  { downlink: 45.00, effectiveType: '4g', saveData: false }, // 1440p
    'hd2160':  { downlink: 80.00, effectiveType: '4g', saveData: false }, // 2160p
    'highres': { downlink: 80.00, effectiveType: '4g', saveData: false }, // 4K
    'hd4320':  { downlink: 150.0, effectiveType: '4g', saveData: false }, // 8K
    'auto':    { downlink: 100.0, effectiveType: '4g', saveData: false }, // Auto
    'default': { downlink: 100.0, effectiveType: '4g', saveData: false }
  };

  function normalizeQualityKey(q) {
    if (!q) return 'default';
    var k = String(q).trim().toLowerCase();
    if (k === 'auto' || k === 'default') return 'default';
    if (k === '144' || k === '144p') return 'tiny';
    if (k === '240' || k === '240p') return 'small';
    if (k === '360' || k === '360p') return 'medium';
    if (k === '480' || k === '480p') return 'large';
    if (k === '720' || k === '720p') return 'hd720';
    if (k === '1080' || k === '1080p') return 'hd1080';
    if (k === '1440' || k === '1440p') return 'hd1440';
    if (k === '2160' || k === '2160p') return 'hd2160';
    if (k === '4320' || k === '4320p') return 'hd4320';
    return k;
  }

  function saveQualityPref(q) {
    try {
      if (q && q !== 'auto' && q !== 'default') {
        var payload = JSON.stringify({ data: q, expiration: Date.now() + 2592000000, creation: Date.now() });
        localStorage.setItem('yt-player-quality', payload);
        localStorage.setItem('yt-player-sticky-quality', payload);
        localStorage.setItem('yt-player-playback-quality', q);
      } else {
        localStorage.removeItem('yt-player-quality');
        localStorage.removeItem('yt-player-sticky-quality');
        localStorage.removeItem('yt-player-playback-quality');
      }
    } catch(e) {}
  }

  function setQualityViaMenu(doc, q) {
    if (!doc) return false;
    var labelMap = {
      'tiny': '144p',
      'small': '240p',
      'medium': '360p',
      'large': '480p',
      'hd720': '720p',
      'hd1080': '1080p',
      'hd1440': '1440p',
      'hd2160': '2160p',
      'highres': '2160p',
      'auto': 'Auto',
      'default': 'Auto'
    };
    var targetLabel = labelMap[q] || q;

    try {
      var mp = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');
      if (mp) {
        if (typeof mp.setPlaybackQualityRange === 'function') {
          if (q === 'auto' || q === 'default') {
            mp.setPlaybackQualityRange('small', 'highres');
          } else {
            mp.setPlaybackQualityRange(q, q);
          }
        }
        if (typeof mp.setPlaybackQuality === 'function') {
          mp.setPlaybackQuality(q);
        }
      }

      var settingsBtn = doc.querySelector('.ytp-settings-button');
      if (!settingsBtn) return false;

      var menu = doc.querySelector('.ytp-settings-menu') || doc.querySelector('.ytp-panel-menu');
      if (!menu || menu.offsetParent === null) {
        settingsBtn.click();
      }

      setTimeout(function() {
        try {
          var items = doc.querySelectorAll('.ytp-menuitem');
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var text = item.textContent || '';
            if (text.indexOf('Quality') !== -1 || text.indexOf('quality') !== -1 || text.indexOf('Auto') !== -1 || /\d+p/.test(text)) {
              item.click();
              break;
            }
          }
          setTimeout(function() {
            try {
              var qItems = doc.querySelectorAll('.ytp-menuitem');
              for (var j = 0; j < qItems.length; j++) {
                var qItem = qItems[j];
                var qText = (qItem.textContent || '').trim();
                if (qText.indexOf(targetLabel) !== -1 || (targetLabel === 'Auto' && qText.indexOf('Auto') !== -1)) {
                  qItem.click();
                  break;
                }
              }
            } catch(_) {}
            try {
              var openMenu = doc.querySelector('.ytp-settings-menu');
              if (openMenu && openMenu.offsetParent !== null) {
                settingsBtn.click();
              }
            } catch(_) {}
          }, 40);
        } catch(_) {}
      }, 40);

      return true;
    } catch(e) {
      return false;
    }
  }

  function applyQuality(q, isUserAction) {
    var rawQ = q || 'auto';
    selectedQuality = rawQ;
    var targetQ = normalizeQualityKey(rawQ);

    // 1. Throttle / Spoof Downlink & fire connection change to steer YouTube ABR
    var netProfile = DOWNLINK_MAP[targetQ] || DOWNLINK_MAP['default'];
    window.__netDownlink = netProfile.downlink;
    window.__netType = netProfile.effectiveType;
    window.__saveData = netProfile.saveData;
    if (typeof window.__dispatchNetChange === 'function') {
      window.__dispatchNetChange();
    }

    // 2. Persist to localStorage sticky keys
    saveQualityPref(targetQ);

    var switchedViaDOM = false;
    var hasInnerDoc = false;
    var hasMoviePlayer = false;

    // 3. Direct DOM Access to player (same-origin child iframe or top document)
    try {
      var docList = [];
      var iframeEl = document.querySelector('iframe');
      if (iframeEl) {
        try {
          var innerDoc = iframeEl.contentDocument || (iframeEl.contentWindow && iframeEl.contentWindow.document);
          if (innerDoc) {
            hasInnerDoc = true;
            docList.push(innerDoc);
          }
        } catch(_) {}
      }
      docList.push(document);

      for (var i = 0; i < docList.length; i++) {
        var targetDoc = docList[i];
        var mp = targetDoc.getElementById('movie_player') || targetDoc.querySelector('.html5-video-player');
        if (mp) {
          hasMoviePlayer = true;
          try {
            if (typeof mp.setPlaybackQualityRange === 'function') {
              if (targetQ === 'default') mp.setPlaybackQualityRange('small', 'highres');
              else mp.setPlaybackQualityRange(targetQ, targetQ);
              switchedViaDOM = true;
            }
          } catch(e) {}
          try {
            if (typeof mp.setPlaybackQuality === 'function') {
              mp.setPlaybackQuality(targetQ);
              switchedViaDOM = true;
            }
          } catch(e) {}
        }
        if (setQualityViaMenu(targetDoc, targetQ)) {
          switchedViaDOM = true;
        }
      }
    } catch(e) {}

    // 4. Clamping on public player instance
    if (player) {
      try {
        if (typeof player.setPlaybackQualityRange === 'function') {
          if (targetQ === 'default') {
            player.setPlaybackQualityRange('small', 'highres');
          } else {
            player.setPlaybackQualityRange(targetQ, targetQ);
          }
        }
      } catch(e) {}

      try {
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(targetQ);
        }
      } catch(e) {}
    }

    // 5. Send postMessage directly to child iframe window
    try {
      var iframe = document.querySelector('iframe');
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

    // 6. Set quality on player if available (without reloading video)
    if (player && typeof player.setPlaybackQuality === 'function') {
      try {
        player.setPlaybackQuality(targetQ);
      } catch(e) {}
    }

    // 7. Adjust viewport dimensions to steer YouTube internal ABR engine
    adjustPlayerSize(targetQ);

    // 8. Diagnostic reporting
    toRN({
      type: 'qualityDebug',
      targetQuality: targetQ,
      switchedViaDOM: switchedViaDOM,
      hasInnerDoc: hasInnerDoc,
      hasMoviePlayer: hasMoviePlayer,
      currentQuality: (player && typeof player.getPlaybackQuality === 'function') ? player.getPlaybackQuality() : 'unknown',
      availableQualities: (player && typeof player.getAvailableQualityLevels === 'function') ? player.getAvailableQualityLevels() : []
    });
  }
  window.applyQuality = applyQuality;

  // Apply initial quality configuration right away (sets downlink spoofing & localStorage before player initializes)
  applyQuality(selectedQuality, false);

  var Q_WIDTHS = {
    tiny: 256,
    small: 426,
    medium: 640,
    large: 854,
    hd720: 1280,
    hd1080: 1920,
    hd1440: 2560,
    hd2160: 3840,
    highres: 3840,
    default: 1920,
    auto: 1920
  };

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
    var targetQ = quality || selectedQuality || 'auto';
    var W = Q_WIDTHS[targetQ] || 1920;
    var H = Math.round(W / ar);
    
    var scaleX = containerWidth / W;
    var scaleY = containerHeight / H;
    var scale = (window.isFullscreen || ar < 1.0) ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    
    var offsetX = (containerWidth - (W * scale)) / 2;
    var offsetY = (containerHeight - (H * scale)) / 2;
    
    p.style.width = W + 'px';
    p.style.height = H + 'px';
    p.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
    p.style.transformOrigin = 'top left';
  }
  window.adjustPlayerSize = adjustPlayerSize;

  function updatePlayerSizeByState() {
    if (!player) return;
    adjustPlayerSize(selectedQuality);
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
          if (isMaxRes) {
            toRN({ type: 'qualitiesAvailable', qualities: ['auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'] });
          } else {
            toRN({ type: 'qualitiesAvailable', qualities: ['auto', 'hd720', 'large', 'medium', 'small', 'tiny'] });
          }
        } catch(e) {}
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
        if (isMaxRes) {
          checkThumb('https://i.ytimg.com/vi/' + vId + '/sddefault.jpg', false);
        } else {
          try {
            toRN({ type: 'qualitiesAvailable', qualities: ['auto', 'large', 'medium', 'small', 'tiny'] });
          } catch(e) {}
        }
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
      Object.defineProperty(window, 'devicePixelRatio', { value: 3.0, writable: true });
      Object.defineProperty(screen, 'width', { value: 1920, writable: true });
      Object.defineProperty(screen, 'height', { value: 1080, writable: true });
      Object.defineProperty(screen, 'availWidth', { value: 1920, writable: true });
      Object.defineProperty(screen, 'availHeight', { value: 1080, writable: true });
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
        origin:         'https://lonelycpp.github.io',
        widget_referrer:'https://lonelycpp.github.io',
        suggestedQuality: normalizeQualityKey('${quality || "hd1080"}'),
      },
      events: {
        onReady:       function(e) {
          var p = e.target;
          if (window.lastPlayerPosition && window.lastPlayerPosition > 1) {
            try { p.seekTo(window.lastPlayerPosition, true); } catch(err) {}
          } else if (${initialPosition || 0} > 1) {
            try { p.seekTo(${initialPosition || 0}, true); } catch(err) {}
          }
          var originalPlay = p.playVideo;
          p.playVideo = function() {
            adjustPlayerSize(selectedQuality);
            originalPlay.apply(p, arguments);
          };
          var originalPause = p.pauseVideo;
          p.pauseVideo = function() {
            adjustPlayerSize(selectedQuality);
            originalPause.apply(p, arguments);
          };

          updatePlayerSizeByState();
          applyQuality(selectedQuality, false);
          var qualities = [];
          if (p && typeof p.getAvailableQualityLevels === 'function') {
            qualities = p.getAvailableQualityLevels() || [];
          }
          if (!qualities || qualities.length === 0) {
            qualities = ['auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
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
            adjustPlayerSize(selectedQuality);
          }
          
          var qualities = [];
          if (player && typeof player.getAvailableQualityLevels === 'function') {
            qualities = player.getAvailableQualityLevels() || [];
          }
          
          if (qualities && qualities.length > 0) {
            toRN({ type: 'stateChange', state: state, qualities: qualities });
          } else {
            toRN({ type: 'stateChange', state: state });
          }
          postVideoData();
          setTimeout(hideYouTubeUI, 200);
        },
        onPlaybackQualityChange: function(e) {
          var newQ = e.data;
          var qualities = [];
          if (player && typeof player.getAvailableQualityLevels === 'function') {
            qualities = player.getAvailableQualityLevels() || [];
          }
          if (qualities && qualities.length > 0) {
            toRN({ type: 'playbackQualityChange', quality: newQ, qualities: qualities });
          } else {
            toRN({ type: 'playbackQualityChange', quality: newQ });
          }

          // Anti-drift watchdog: prevent YouTube ABR from bouncing away from user selection
          if (selectedQuality && selectedQuality !== 'auto') {
            var targetQ = normalizeQualityKey(selectedQuality);
            var now = Date.now();
            if (newQ !== targetQ && newQ !== selectedQuality) {
              if (now - lastAntiDrift > 2000) {
                lastAntiDrift = now;
                if (window.__dispatchNetChange) window.__dispatchNetChange();
                try {
                  if (player && typeof player.setPlaybackQualityRange === 'function') {
                    player.setPlaybackQualityRange(targetQ, targetQ);
                  }
                } catch(err) {}
                try {
                  if (player && typeof player.setPlaybackQuality === 'function') {
                    player.setPlaybackQuality(targetQ);
                  }
                } catch(err) {}
              }
            }
          }
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
        case 'setPlaybackQuality':
          applyQuality(cmd.quality, true);
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
          if (msg.qualities && msg.qualities.length > 0) {
            console.log(`🎥 [YouTubePlayer] Available qualities for this video:`, JSON.stringify(msg.qualities));
            onQualitiesAvailable?.(msg.qualities);
          }
          if (play)  inject(`window.userPaused = false; player && player.playVideo()`);
          if (muted) inject(`player && player.mute()`);
          break;
        case 'qualitiesAvailable':
          if (msg.qualities && msg.qualities.length > 0) {
            console.log(`🎥 [YouTubePlayer] Available qualities for this video:`, JSON.stringify(msg.qualities));
            onQualitiesAvailable?.(msg.qualities);
          }
          break;
        case 'stateChange':
          onStateChange?.(msg.state as PlayerState);
          if (msg.qualities && msg.qualities.length > 0) {
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
        case 'qualityDebug':
          console.log(`🔬 [QUALITY_DEBUG]`, JSON.stringify(msg));
          break;
        case 'dataTransferStats':
          console.log(`📊 [DATA TRANSFER] Total: ${msg.totalMB} MB | Live Rate: ${msg.speedKBps} KB/s | Resolution: ${msg.quality} (${msg.chunks} segments)`);
          break;
        case 'playbackQualityChange':
          console.log(`📺 [YouTubePlayer] YouTube player switched stream quality to: ${msg.quality}`);
          onQualityChange?.(msg.quality);
          if (onExactResolution && msg.quality) {
            onExactResolution(formatQualityLabel(msg.quality));
          }
          if (msg.qualities && msg.qualities.length > 0) {
            onQualitiesAvailable?.(msg.qualities);
          }
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

  React.useEffect(() => {
    if (quality) {
      inject(`if (typeof window.applyQuality === 'function') { window.applyQuality('${quality}', true); }`);
    }
  }, [quality]);

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
      inject(`if (typeof window.applyQuality === 'function') { window.applyQuality('${q}', true); }`);
    }
  }), []);

  // ✅ Memoize WebView source to prevent reload flashing when parent component re-renders
  const webViewSource = React.useMemo(() => ({ html, baseUrl: 'https://www.youtube.com' }), [videoId]);

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
            // 0. Display & Quality Metrics Spoofing (FHD 1080p Profile)
            try {
              Object.defineProperty(window, 'devicePixelRatio', { get: function() { return 3.0; }, configurable: true });
              Object.defineProperty(screen, 'width', { get: function() { return 1920; }, configurable: true });
              Object.defineProperty(screen, 'height', { get: function() { return 1080; }, configurable: true });
              Object.defineProperty(screen, 'availWidth', { get: function() { return 1920; }, configurable: true });
              Object.defineProperty(screen, 'availHeight', { get: function() { return 1080; }, configurable: true });
            } catch(e) {}

            // Pre-seed sticky quality in youtube.com domain storage
            try {
              var qVal = '${quality || "hd1080"}';
              if (qVal === 'auto' || qVal === 'default') qVal = 'hd1080';
              var exp = Date.now() + 2592000000;
              localStorage.setItem('yt-player-sticky-quality', JSON.stringify({ data: qVal, expiration: exp, creation: Date.now() }));
              localStorage.setItem('yt-player-quality', JSON.stringify({ data: JSON.stringify({ quality: qVal, previousQuality: 'auto' }), expiration: exp, creation: Date.now() }));
            } catch(e) {}

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
            window.__netDownlink = 50.0;
            window.__netType = '4g';
            window.__saveData = false;
            var netListeners = [];
            var _onchange = null;

            var netConn = {
              get downlink() { return window.__netDownlink || 25.0; },
              get effectiveType() { return window.__netType || '4g'; },
              get rtt() { return (window.__netDownlink && window.__netDownlink < 1.0) ? 350 : 50; },
              get saveData() { return !!window.__saveData; },
              get onchange() { return _onchange; },
              set onchange(fn) { _onchange = fn; },
              addEventListener: function(type, fn) {
                if (type === 'change' && typeof fn === 'function') {
                  netListeners.push(fn);
                }
              },
              removeEventListener: function(type, fn) {
                if (type === 'change') {
                  netListeners = netListeners.filter(function(l) { return l !== fn; });
                }
              },
              dispatchEvent: function(e) {
                if (typeof _onchange === 'function') {
                  try { _onchange.call(netConn, e); } catch(_) {}
                }
                for (var i = 0; i < netListeners.length; i++) {
                  try { netListeners[i].call(netConn, e); } catch(_) {}
                }
                return true;
              }
            };

            window.__dispatchNetChange = function() {
              try {
                var evt = new Event('change');
                netConn.dispatchEvent(evt);
              } catch(e) {
                try {
                  var evt2 = document.createEvent('Event');
                  evt2.initEvent('change', false, false);
                  netConn.dispatchEvent(evt2);
                } catch(_) {}
              }
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
