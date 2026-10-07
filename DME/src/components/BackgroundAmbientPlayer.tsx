import React, { memo, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Image, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export type RoomTheme = 'cinema' | 'rave' | 'dark' | 'light';

interface BackgroundAmbientPlayerProps {
  videoId?: string | null;
  thumbnailUrl?: string | null;
  isPlayerReady?: boolean;
  isPlaying?: boolean;
  currentTime?: number;
  fullscreen?: boolean;
  isMinimized?: boolean;
  theme?: RoomTheme;
}

const BackgroundAmbientPlayer: React.FC<BackgroundAmbientPlayerProps> = memo(({
  videoId,
  thumbnailUrl,
  isPlayerReady = false,
  isPlaying = false,
  currentTime = 0,
  fullscreen = false,
  isMinimized = false,
  theme = 'cinema',
}) => {
  const webViewRef = useRef<WebView>(null);
  const currentVideoIdRef = useRef<string | null>(videoId || null);
  const currentTimeRef = useRef<number>(currentTime || 0);
  currentTimeRef.current = currentTime || 0;
  const lastSyncTimeRef = useRef<number>(0);

  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

  useEffect(() => {
    if (!videoId) return;
    if (currentVideoIdRef.current !== videoId) {
      currentVideoIdRef.current = videoId;
      const startSec = Number((currentTimeRef.current || 0).toFixed(2));
      const shouldPlayNow = Boolean(isPlaying && isPlayerReady);
      inject(`
        if (typeof player !== 'undefined' && player && typeof player.loadVideoById === 'function') {
          player.loadVideoById({ 
            videoId: '${videoId}', 
            startSeconds: ${startSec},
            suggestedQuality: 'small' 
          });
          player.mute();
          player.setVolume(0);
          if (${shouldPlayNow ? 'true' : 'false'}) {
            player.playVideo();
          } else {
            player.pauseVideo();
          }
        }
      `);
    }
  }, [videoId]);

  useEffect(() => {
    const shouldPlay = Boolean(isPlaying && isPlayerReady);
    const cur = Number((currentTimeRef.current || 0).toFixed(2));
    inject(`
      if (typeof window.syncPosition === 'function') {
        window.syncPosition(${cur}, ${shouldPlay ? 'true' : 'false'}, true);
      } else if (typeof player !== 'undefined' && player) {
        if (${shouldPlay ? 'true' : 'false'}) {
          player.mute();
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      }
    `);
  }, [isPlaying, isPlayerReady]);

  // Periodic position sync
  useEffect(() => {
    if (typeof currentTime !== 'number' || isNaN(currentTime)) return;
    const now = Date.now();
    if (now - lastSyncTimeRef.current >= 500) {
      lastSyncTimeRef.current = now;
      inject(`
        if (typeof window.syncPosition === 'function') {
          window.syncPosition(${currentTime}, ${isPlaying ? 'true' : 'false'}, false);
        }
      `);
    }
  }, [currentTime, isPlaying]);

  const html = useMemo(() => `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }

  /* ── 1. Fullscreen Edge-to-Edge Blurred Video (Extended offscreen to kill dark blur borders) ── */
  #video-container {
    position: absolute;
    top: -10vh;
    left: -10vw;
    width: 120vw;
    height: 120vh;
    overflow: hidden;
    filter: blur(50px) brightness(1.08) saturate(1.3) contrast(1.02);
    -webkit-filter: blur(50px) brightness(1.08) saturate(1.3) contrast(1.02);
    transform: translateZ(0);
    will-change: transform;
    pointer-events: none;
  }

  /* ── 2. Full-Frame 16:9 Iframe with Full Video Color Mapping (No Zoom-Crop) ── */
  #player {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 115vw;
    height: 64.69vw;
    transform: translate(-50%, -50%) scale(1.0, 2.5);
    transform-origin: center center;
    pointer-events: none;
  }

  #player iframe {
    width: 100%;
    height: 100%;
    border: none;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="video-container">
  <div id="player"></div>
</div>
<script>
  function fitBleed() {
    try {
      var w = window.innerWidth || document.documentElement.clientWidth || 360;
      var h = window.innerHeight || document.documentElement.clientHeight || 740;
      var p = document.getElementById('player');
      if (!p) return;
      var baseW = w * 1.15;
      var baseH = baseW * (9 / 16);
      var scaleY = (h * 1.15) / baseH;
      p.style.width = baseW + 'px';
      p.style.height = baseH + 'px';
      p.style.transform = 'translate(-50%, -50%) scale(1.0, ' + scaleY.toFixed(3) + ')';
    } catch(_) {}
  }
  window.addEventListener('resize', fitBleed);
  window.addEventListener('load', fitBleed);
  fitBleed();
  setTimeout(fitBleed, 250);
  setTimeout(fitBleed, 1000);

  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  var player = null;
  var currentVid = '${videoId || ''}';
  var lastSeekTarget = -1;
  var lastSeekTime = 0;
  var isSeeking = false;

  window.targetPosition = ${Number((currentTime || 0).toFixed(2))};
  window.targetReceivedAt = Date.now();
  window.isTargetPlaying = ${Boolean(isPlaying && isPlayerReady) ? 'true' : 'false'};

  window.syncPosition = function(targetTime, shouldPlay, force) {
    window.targetPosition = targetTime;
    window.targetReceivedAt = Date.now();
    window.isTargetPlaying = shouldPlay;

    if (!player || typeof player.getCurrentTime !== 'function') return;

    try {
      var pState = player.getPlayerState ? player.getPlayerState() : -1;
      if (shouldPlay) {
        if (pState === 2 || pState === 0 || pState === -1) {
          player.playVideo();
        }
      } else {
        if (pState === 1 || pState === 3) {
          player.pauseVideo();
        }
      }

      var now = Date.now();
      var myTime = player.getCurrentTime();
      if (isNaN(myTime) || myTime < 0) return;

      var drift = myTime - targetTime;

      if (force || Math.abs(drift) > 1.8 || Math.abs(targetTime - lastSeekTarget) > 0.4) {
        if (now - lastSeekTime > 300 || Math.abs(targetTime - lastSeekTarget) > 0.4) {
          lastSeekTarget = targetTime;
          lastSeekTime = now;
          isSeeking = true;
          player.seekTo(targetTime + (shouldPlay ? 0.30 : 0), true);
          if (player.getPlaybackRate() !== 1) player.setPlaybackRate(1);
          setTimeout(function() { isSeeking = false; }, 300);
          return;
        }
      }
    } catch(_) {}
  };

  setInterval(function() {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    if (isSeeking) return;

    try {
      var now = Date.now();
      var elapsed = window.isTargetPlaying ? (now - window.targetReceivedAt) / 1000 : 0;
      var expectedTime = window.targetPosition + elapsed;

      var myTime = player.getCurrentTime();
      if (isNaN(myTime) || myTime < 0) return;

      var drift = myTime - expectedTime;

      if (Math.abs(drift) > 2.0 && (now - lastSeekTime > 500)) {
        lastSeekTime = now;
        isSeeking = true;
        player.seekTo(expectedTime + (window.isTargetPlaying ? 0.35 : 0), true);
        if (player.getPlaybackRate() !== 1) player.setPlaybackRate(1);
        setTimeout(function() { isSeeking = false; }, 350);
        return;
      }

      var currentRate = player.getPlaybackRate ? player.getPlaybackRate() : 1;
      if (drift < -0.35) {
        if (currentRate !== 1.5) player.setPlaybackRate(1.5);
      } else if (drift < -0.03) {
        if (currentRate !== 1.25) player.setPlaybackRate(1.25);
      } else if (drift > 0.35) {
        if (currentRate !== 0.5) player.setPlaybackRate(0.5);
      } else if (drift > 0.03) {
        if (currentRate !== 0.75) player.setPlaybackRate(0.75);
      } else {
        if (currentRate !== 1) player.setPlaybackRate(1);
      }

      try {
        var v = document.querySelector('video');
        if (!v) {
          var ifr = document.querySelector('iframe');
          if (ifr && ifr.contentDocument) v = ifr.contentDocument.querySelector('video');
        }
        if (v) {
          v.muted = true;
          var vDrift = v.currentTime - expectedTime;
          if (Math.abs(vDrift) > 0.02) {
            var vRate = 1.0 - (vDrift * 3.0);
            if (vRate < 0.5) vRate = 0.5;
            if (vRate > 2.0) vRate = 2.0;
            v.playbackRate = vRate;
          } else if (v.playbackRate !== 1.0) {
            v.playbackRate = 1.0;
          }
        }
      } catch(_) {}
    } catch(_) {}
  }, 40);

  function onYouTubeIframeAPIReady() {
    if (!currentVid) return;
    fitBleed();
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      videoId: currentVid,
      playerVars: {
        autoplay:       1,
        controls:       0,
        playsinline:    1,
        rel:            0,
        modestbranding: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        fs:             0,
        disablekb:      1,
        enablejsapi:    1,
        mute:           1,
        origin:         'https://lonelycpp.github.io',
        widget_referrer:'https://lonelycpp.github.io',
      },
      events: {
        onReady: function(e) {
          fitBleed();
          e.target.mute();
          e.target.setVolume(0);
          try { e.target.setPlaybackQuality('small'); } catch(_) {}
          if (window.isTargetPlaying) {
            e.target.playVideo();
            var elapsed = (Date.now() - window.targetReceivedAt) / 1000;
            e.target.seekTo(window.targetPosition + elapsed, true);
          }
        },
        onStateChange: function(e) {
          if (e.data === 1 || e.data === 3) {
            fitBleed();
            e.target.mute();
            e.target.setVolume(0);
          }
        }
      }
    });
  }
</script>
</body>
</html>
  `, [videoId]);

  const webViewSource = useMemo(() => ({
    html,
    baseUrl: 'https://lonelycpp.github.io',
  }), [html]);

  // Only render in 'rave' mode when not fullscreen/minimized and we have a video or thumbnail
  if ((!videoId && !thumbnailUrl) || isMinimized || fullscreen || theme !== 'rave') {
    return null;
  }

  const showThumbnailBleed = !isPlayerReady && Boolean(thumbnailUrl);

  return (
    <View style={styles.container} pointerEvents="none">
      {videoId ? (
        <WebView
          ref={webViewRef}
          source={webViewSource}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsBackgroundMediaPlayback={false}
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          scrollEnabled={false}
          bounces={false}
          style={styles.webview}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScriptForMainFrameOnly={false}
          injectedJavaScriptBeforeContentLoaded={`
            (function() {
              try {
                var isAdUrl = function(url) {
                  if (!url || typeof url !== 'string') return false;
                  return (
                    url.indexOf('/pagead/') !== -1 ||
                    url.indexOf('doubleclick.net') !== -1 ||
                    url.indexOf('/api/stats/ads') !== -1 ||
                    url.indexOf('ad_break') !== -1 ||
                    url.indexOf('ptracking') !== -1 ||
                    url.indexOf('googleads.g.doubleclick.net') !== -1 ||
                    url.indexOf('youtube.com/pagead') !== -1
                  );
                };
                var origFetch = window.fetch;
                if (origFetch) {
                  window.fetch = function(input, init) {
                    var url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
                    if (isAdUrl(url)) {
                      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    }
                    return origFetch.apply(this, arguments);
                  };
                }
              } catch(_) {}

              function killAds() {
                try {
                  var mp = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                  var isAd = false;
                  if (mp && (mp.className.indexOf('ad-showing') !== -1 || mp.className.indexOf('ad-interrupting') !== -1)) isAd = true;
                  if (!isAd && document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay')) isAd = true;
                  if (isAd) {
                    if (mp && typeof mp.skipAd === 'function') { try { mp.skipAd(); } catch(_) {} }
                    var vids = document.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      var v = vids[i];
                      v.muted = true;
                      v.playbackRate = 16.0;
                      if (isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration + 0.5;
                    }
                    var skipBtns = document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip"]');
                    for (var b = 0; b < skipBtns.length; b++) { try { skipBtns[b].click(); } catch(_) {} }
                  }
                } catch(_) {}
              }
              setInterval(killAds, 50);

              var block = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); };
              window.addEventListener('visibilitychange', block, true);
              window.addEventListener('webkitvisibilitychange', block, true);
              window.addEventListener('blur', block, true);
              window.addEventListener('focus', block, true);

              Object.defineProperty(document, 'hidden', { value: false, writable: false });
              Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
              Object.defineProperty(document, 'webkitVisibilityState', { value: 'visible', writable: false });
              Object.defineProperty(document, 'hasFocus', { value: function() { return true; }, writable: false });
            })();
            true;
          `}
        />
      ) : null}

      {/* Blurred Thumbnail Bleed Overlay (Shown while main video is in loading/thumbnail state) */}
      {showThumbnailBleed && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: thumbnailUrl! }}
            style={styles.thumbnailBleed}
            blurRadius={Platform.OS === 'android' ? 25 : 35}
            resizeMode="cover"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.35)' }]} />
        </View>
      )}
    </View>
  );
});

BackgroundAmbientPlayer.displayName = 'BackgroundAmbientPlayer';
export default BackgroundAmbientPlayer;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    overflow: 'hidden',
    zIndex: 0,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
    opacity: 1.0,
  },
  thumbnailBleed: {
    width: '125%',
    height: '125%',
    position: 'absolute',
    top: '-12.5%',
    left: '-12.5%',
  },
});
