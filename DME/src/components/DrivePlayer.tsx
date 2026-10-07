import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export interface DrivePlayerRef {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  getVolume: () => Promise<number>;
  setRealDuration: (d: number) => void;
}

interface Props {
  fileId: string;
  play: boolean;
  muted?: boolean;
  onReady?: () => void;
  onStateChange?: (state: string) => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onError?: (e: any) => void;
  onStreamResolved?: (cdnUrl: string, cdnHeaders: Record<string, string>) => void;
  onAspectRatio?: (aspectRatio: number) => void;
  isFullscreen?: boolean;
}

const DrivePlayer = forwardRef<DrivePlayerRef, Props>((props, ref) => {
  const { fileId, play, muted = false, onReady, onStateChange, onProgress, onError, onStreamResolved, onAspectRatio, isFullscreen = false } = props;
  const webViewRef = useRef<WebView>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const isReadyRef = useRef(false);

  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

  if (!fileId) {
    return <View style={styles.container} />;
  }

  const initialUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#000; overflow:hidden; }
  #bg-canvas {
    position: absolute;
    top: -15%;
    left: -15%;
    width: 130%;
    height: 130%;
    object-fit: cover;
    background: #000;
    filter: blur(40px) brightness(0.60) saturate(1.5);
    opacity: 0.85;
    z-index: 1;
    transform: translateZ(0);
  }
  #dmevideo {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: transparent;
    z-index: 2;
  }
  video::-webkit-media-controls { display: none !important; }
  video::-webkit-media-controls-enclosure { display: none !important; }
  video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none; }
  #status {
    position:fixed; top:50%; left:50%;
    transform:translate(-50%,-50%);
    color:rgba(255,255,255,0.7);
    font-family:sans-serif; font-size:13px;
    text-align:center; padding:20px;
    max-width:90%;
    z-index: 3;
  }
</style>
</head>
<body>
<div id="status">Loading video...</div>
<canvas id="bg-canvas" width="64" height="36"></canvas>
<video
  id="dmevideo"
  playsinline
  webkit-playsinline
  preload="auto"
  src="${initialUrl}"
  ${muted ? 'muted' : ''}
></video>

<script>
var v = document.getElementById('dmevideo');
var bgCanvas = document.getElementById('bg-canvas');
var bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;
var statusEl = document.getElementById('status');
var ready = false;
var hasAttemptedBypass = false;
var animFrameId = null;

function renderAmbientFrame() {
  if (v && !v.paused && !v.ended && v.readyState >= 2 && bgCtx) {
    try {
      bgCtx.drawImage(v, 0, 0, 64, 36);
    } catch(e) {}
  }
  animFrameId = requestAnimationFrame(renderAmbientFrame);
}

function toRN(obj) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
}

toRN({ type: 'log', msg: 'document.cookie at load: [' + document.cookie + ']' });
toRN({ type: 'log', msg: 'navigator.userAgent: [' + navigator.userAgent + ']' });

function showPlayer() {
  if (v) v.style.display = 'block';
  if (bgCanvas) bgCanvas.style.display = 'block';
  statusEl.style.display = 'none';
  syncFullscreenState();
  if (!animFrameId) {
    renderAmbientFrame();
  }
}

function attemptWarningBypass() {
  if (hasAttemptedBypass) {
    toRN({ type: 'playerError', code: -1, msg: 'Video unplayable even after bypass attempt' });
    return;
  }
  hasAttemptedBypass = true;
  statusEl.innerText = "Bypassing Google Drive scan...";
  statusEl.style.display = 'block';
  v.style.display = 'none';
  if (bgCanvas) bgCanvas.style.display = 'none';

  toRN({ type: 'log', msg: 'document.cookie at bypass time: [' + document.cookie + ']' });

  toRN({ type: 'needsBypass' });
}

function attachEvents() {
  if (!v) return;

  function reportAR() {
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      toRN({ type: 'aspectRatio', aspectRatio: v.videoWidth / v.videoHeight });
    }
  }

  v.addEventListener('loadedmetadata', function() {
    reportAR();
    toRN({ type: 'progress', currentTime: v.currentTime, duration: v.duration || 0 });
  });

  v.addEventListener('canplay', function() {
    reportAR();
    if (!ready) {
      ready = true;
      showPlayer();
      toRN({ type: 'playerReady', duration: v.duration || 0 });
    }
  });

  v.addEventListener('timeupdate', function() {
    toRN({ type: 'progress', currentTime: v.currentTime, duration: v.duration || 0 });
  });

  v.addEventListener('play',    function() { 
    toRN({ type: 'stateChange', state: 'playing' }); 
  });
  v.addEventListener('pause',   function() { 
    if (!v.ended) toRN({ type: 'stateChange', state: 'paused' }); 
  });
  v.addEventListener('ended',   function() { 
    toRN({ type: 'stateChange', state: 'ended' }); 
  });
  v.addEventListener('waiting', function() { 
    toRN({ type: 'stateChange', state: 'buffering' }); 
  });
  v.addEventListener('playing', function() { 
    toRN({ type: 'stateChange', state: 'playing' }); 
  });
  v.addEventListener('error',   function(e) {
    var err = v.error;
    var code = err ? err.code : 0;
    var msg = err ? err.message : 'unknown';
    toRN({ type: 'log', msg: 'HTML5 Video error: code=' + code + ' msg=' + msg });
    
    // Check if Google Drive returned a virus scan warning page
    // (which causes a decode or network error on the video tag)
    if (code === 4 || code === 2) {
      attemptWarningBypass();
    } else {
      toRN({ type: 'playerError', code: code, msg: msg });
    }
  });
}

function syncFullscreenState() {
  if (!v) return;
  if (window.isFullscreen) {
    v.style.objectFit = 'contain';
  } else {
    v.style.objectFit = 'contain';
  }
}
window.syncFullscreenState = syncFullscreenState;

attachEvents();
</script>
</body>
</html>
  `;

  const resolveWarningBypass = async () => {
    try {
      console.log('🔄 [DRIVE BYPASS] Attempting fetch bypass for fileId:', fileId);
      const downloadPageUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const res = await fetch(downloadPageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const htmlText = await res.text();

      // Check for confirm token
      const match = htmlText.match(/href="(\/uc\?export=download[^"]+confirm=([^"&]+)[^"]*)"/) ||
                    htmlText.match(/confirm=([0-9A-Za-z_-]+)/);

      let finalDownloadUrl = '';
      if (match) {
        const confirmToken = match[2] || match[1];
        finalDownloadUrl = `https://drive.google.com/uc?export=download&confirm=${confirmToken}&id=${fileId}`;
        console.log('✅ [DRIVE BYPASS] Extracted confirm token:', confirmToken);
      } else {
        // Look for direct download link or form action
        const formMatch = htmlText.match(/action="([^"]+)"/);
        if (formMatch && formMatch[1].includes('drive.google.com')) {
          finalDownloadUrl = formMatch[1].replace(/&amp;/g, '&');
        }
      }

      if (finalDownloadUrl) {
        console.log('🎬 [DRIVE BYPASS] Loading bypass URL into video tags:', finalDownloadUrl);
        inject(`
          (function() {
            var v = document.getElementById('dmevideo');
            var statusEl = document.getElementById('status');
            if (statusEl) statusEl.innerText = "Loading stream...";
            if (v) {
              v.src = "${finalDownloadUrl}";
              v.load();
              v.play().catch(function(){});
            }
          })();
        `);
      } else {
        console.warn('⚠️ [DRIVE BYPASS] Could not extract bypass token from response');
        // Let user know or report error
        inject(`
          (function() {
            var statusEl = document.getElementById('status');
            if (statusEl) statusEl.innerText = "Video unavailable or restricted.";
          })();
        `);
      }
    } catch (e: any) {
      console.error('❌ [DRIVE BYPASS] Fetch error:', e);
      onError?.(e);
    }
  };

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'log') {
        console.log('🎬 [DRIVE]', msg.msg);
        return;
      }

      console.log('🎬 [DRIVE PLAYER]', msg.type, msg);

      switch (msg.type) {
        case 'playerReady':
          isReadyRef.current = true;
          durationRef.current = msg.duration || 0;
          onReady?.();
          if (play) {
            inject(`(function(){ var v=document.getElementById('dmevideo'); if(v) v.play().catch(function(e){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',msg:'play() post-ready error: '+e.message})); }); })()`);
          }
          break;
        case 'stateChange':
          onStateChange?.(msg.state);
          break;
        case 'aspectRatio':
          if (msg.aspectRatio && typeof onAspectRatio === 'function') {
            onAspectRatio(msg.aspectRatio);
          }
          break;
        case 'progress':
          positionRef.current = msg.currentTime;
          durationRef.current = msg.duration || durationRef.current;
          onProgress?.(msg.currentTime, msg.duration);
          break;
        case 'needsBypass':
          resolveWarningBypass();
          break;
        case 'playerError':
          onError?.(msg.code);
          break;
      }
    } catch (e) {}
  };

  React.useEffect(() => {
    if (!isReadyRef.current) return;
    inject(
      `window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({action:'${play ? 'play' : 'pause'}'})}));`
    );
  }, [play]);

  React.useEffect(() => {
    if (!isReadyRef.current) return;
    inject(
      `window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({action:'${muted ? 'mute' : 'unmute'}'})}));`
    );
  }, [muted]);

  React.useEffect(() => {
    inject(`window.isFullscreen = ${isFullscreen ? 'true' : 'false'}; if (window.syncFullscreenState) window.syncFullscreenState();`);
  }, [isFullscreen]);

  React.useEffect(() => {
    return () => {
      try {
        inject(`
          var v = document.getElementById('dmevideo');
          if (v) { v.muted = true; v.pause(); v.src = ''; }
        `);
      } catch (_) {}
    };
  }, []);

  useImperativeHandle(ref, () => ({
    seekTo: (s) => {
      inject(`
        (function() {
          var v = document.getElementById('dmevideo');
          if (v) v.currentTime = ${s};
        })();
      `);
      positionRef.current = s;
    },
    getCurrentTime:   async () => positionRef.current,
    getDuration:      async () => durationRef.current,
    playVideo:        () => inject(`(function(){ var v=document.getElementById('dmevideo'); if(v) v.play(); })()`),
    pauseVideo:       () => inject(`(function(){ var v=document.getElementById('dmevideo'); if(v) v.pause(); })()`),
    setVolume:        (_v) => {},
    getVolume:        async () => 100,
    setRealDuration:  (d) => { durationRef.current = d; },
  }));

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{
          html,
          baseUrl: 'https://drive.google.com',
        }}
        onMessage={handleMessage}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scalesPageToFit={false}
        scrollEnabled={false}
        bounces={false}
        style={styles.webview}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        injectedJavaScriptBeforeContentLoaded={`
          (function() {
            var block = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); };
            window.addEventListener('visibilitychange', block, true);
            window.addEventListener('webkitvisibilitychange', block, true);
            window.addEventListener('blur', block, true);
            window.addEventListener('focus', block, true);

            Object.defineProperty(document, 'hidden', { value: false, writable: false });
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
            Object.defineProperty(document, 'webkitVisibilityState', { value: 'visible', writable: false });
            Object.defineProperty(document, 'hasFocus', { value: function() { return true; }, writable: false });

            var original = window.addEventListener;
            window.addEventListener = function(type, listener, options) {
              if (['visibilitychange','blur','focusout','pagehide'].includes(type)) return;
              return original.apply(this, arguments);
            };
          })();
          true;
        `}
      />
    </View>
  );
});

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

export default DrivePlayer;