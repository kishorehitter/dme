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
}

const DrivePlayer = forwardRef<DrivePlayerRef, Props>((props, ref) => {
  const { fileId, play, muted = false, onReady, onStateChange, onProgress, onError, onStreamResolved } = props;
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
  #dmevideo {
    width:100%; height:100%;
    object-fit:contain; background:#000;
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
  }
</style>
</head>
<body>
<div id="status">Loading video...</div>
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
var statusEl = document.getElementById('status');
var ready = false;
var hasAttemptedBypass = false;

function toRN(obj) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
}

function showPlayer() {
  if (v) v.style.display = 'block';
  statusEl.style.display = 'none';
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

  toRN({ type: 'needsBypass' });
}

function attachEvents() {
  if (!v) return;

  v.addEventListener('loadedmetadata', function() {
    toRN({ type: 'progress', currentTime: v.currentTime, duration: v.duration || 0 });
  });

  v.addEventListener('canplay', function() {
    if (!ready) {
      ready = true;
      showPlayer();
      toRN({ type: 'playerReady', duration: v.duration || 0 });
    }
  });

  v.addEventListener('timeupdate', function() {
    toRN({ type: 'progress', currentTime: v.currentTime, duration: v.duration || 0 });
  });

  v.addEventListener('play',    function() { toRN({ type: 'stateChange', state: 'playing' }); });
  v.addEventListener('pause',   function() { if (!v.ended) toRN({ type: 'stateChange', state: 'paused' }); });
  v.addEventListener('ended',   function() { toRN({ type: 'stateChange', state: 'ended' }); });
  v.addEventListener('waiting', function() { toRN({ type: 'stateChange', state: 'buffering' }); });
  v.addEventListener('playing', function() { toRN({ type: 'stateChange', state: 'playing' }); });

  v.addEventListener('error', function() {
    // If the video tag throws an error, it's likely because Google Drive fed it the HTML virus warning page.
    // We catch this and attempt the token bypass!
    attemptWarningBypass();
  });
}

attachEvents();

window.addEventListener('message', function(event) {
  if (!v) return;
  try {
    var data = JSON.parse(event.data);
    if (data.action === 'play') {
      v.play().catch(function(e) {
        toRN({ type: 'log', msg: 'play() msg error: ' + e.message });
      });
    } else if (data.action === 'pause') {
      v.pause();
    } else if (data.action === 'mute') {
      v.muted = true;
    } else if (data.action === 'unmute') {
      v.muted = false;
    }
  } catch(e) {}
});

// Initial playback is handled via the injected messages.
</script>
</body>
</html>`;

  const resolveWarningBypass = async () => {
    try {
      console.log('🎬 [DRIVE RESOLVER] React Native intercepting warning page to bypass CORS...');
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
      const text = await res.text();
      const match = text.match(/confirm=([^&"]+)/);
      
      if (match) {
        const token = match[1];
        const bypassUrl = `https://drive.google.com/uc?export=download&confirm=${token}&id=${fileId}`;
        console.log('🎬 [DRIVE RESOLVER] Native bypass token extracted successfully!');
        
        inject(`
          var v = document.getElementById('dmevideo');
          var statusEl = document.getElementById('status');
          if (v && statusEl) {
            statusEl.innerText = "Stream secured, buffering...";
            v.src = "${bypassUrl}";
            v.load();
            v.play().catch(function(e){});
          }
        `);
      } else {
        console.warn('🎬 [DRIVE RESOLVER] Could not find confirm token natively.');
        onError?.(-1);
      }
    } catch (e) {
      console.error('🎬 [DRIVE RESOLVER] Native fetch failed:', e);
      onError?.(-1);
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
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        userAgent="Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        style={styles.webview}
        onShouldStartLoadWithRequest={() => true}
      />
    </View>
  );
});

DrivePlayer.displayName = 'DrivePlayer';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webview:   { flex: 1, backgroundColor: '#000' },
});

export default DrivePlayer;