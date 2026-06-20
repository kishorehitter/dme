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
}

const DrivePlayer = forwardRef<DrivePlayerRef, Props>((props, ref) => {
  const { fileId, play, muted = false, onReady, onStateChange, onProgress, onError } = props;
  const webViewRef = useRef<WebView>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const isReadyRef = useRef(false);

  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

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
    display:none;
  }
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
<div id="status">Connecting to Google Drive...</div>
<video
  id="dmevideo"
  playsinline
  webkit-playsinline
  preload="auto"
  ${muted ? 'muted' : ''}
></video>

<script>
var v = document.getElementById('dmevideo');
var statusEl = document.getElementById('status');
var ready = false;

function toRN(obj) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
}

function setStatus(msg) {
  statusEl.textContent = msg;
  toRN({ type: 'log', msg: msg });
}

function showPlayer() {
  v.style.display = 'block';
  statusEl.style.display = 'none';
}

function attachEvents() {
  v.addEventListener('loadedmetadata', function() {
    if (!ready) {
      ready = true;
      showPlayer();
      toRN({ type: 'playerReady', duration: v.duration || 0 });
    }
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
    var code = v.error ? v.error.code : -1;
    var msg  = v.error ? v.error.message : 'unknown';
    toRN({ type: 'playerError', code: code, msg: msg });
  });
}

async function resolveAndPlay() {
  var urls = [
    'https://drive.google.com/uc?export=download&confirm=t&id=${fileId}',
    'https://drive.google.com/uc?export=download&confirm=t&id=${fileId}&authuser=0',
  ];

  for (var i = 0; i < urls.length; i++) {
    try {
      setStatus('Trying stream ' + (i + 1) + ' of ' + urls.length + '...');

      var resp = await fetch(urls[i], {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
      });

      var ct = resp.headers.get('content-type') || 'none';
      var finalUrl = resp.url;

      // Log all headers for diagnosis
      var allHeaders = {};
      resp.headers.forEach(function(val, key) { allHeaders[key] = val; });

      toRN({
        type: 'log',
        msg: 'Attempt ' + i + ': status=' + resp.status +
             ' ct=' + ct +
             ' finalUrl=' + finalUrl.substring(0, 120)
      });
      toRN({
        type: 'log',
        msg: 'Headers: ' + JSON.stringify(allHeaders).substring(0, 300)
      });

      // ✅ Got a real video stream
      if (ct.indexOf('video') !== -1 || ct.indexOf('octet-stream') !== -1) {
        toRN({ type: 'log', msg: 'SUCCESS — video stream found, playing: ' + finalUrl.substring(0, 120) });
        attachEvents();
        v.src = finalUrl;
        v.load();
        if (${play ? 'true' : 'false'}) {
          v.play().catch(function(e) {
            toRN({ type: 'log', msg: 'play() error: ' + e.message });
          });
        }
        return;
      }

      // Got HTML — log body for diagnosis
      if (ct.indexOf('html') !== -1) {
        var text = await resp.text();
        toRN({ type: 'log', msg: 'HTML response (first 400 chars): ' + text.substring(0, 400) });

        // Check if it's a login/auth page
        if (text.indexOf('accounts.google.com') !== -1 ||
            text.indexOf('signin') !== -1 ||
            text.indexOf('ServiceLogin') !== -1) {
          toRN({ type: 'log', msg: 'DIAGNOSIS: Got Google login page — cookies not shared' });
          setStatus('Authentication required');
          continue;
        }

        // Check if it's a virus scan warning page
        if (text.indexOf('virus') !== -1 ||
            text.indexOf('download_warning') !== -1 ||
            text.indexOf('confirm') !== -1) {
          toRN({ type: 'log', msg: 'DIAGNOSIS: Got virus warning page — extracting confirm token' });

          // Try to extract confirm token and retry
          var confirmMatch = text.match(/confirm=([^&"]+)/);
          if (confirmMatch) {
            var confirmToken = confirmMatch[1];
            toRN({ type: 'log', msg: 'Found confirm token: ' + confirmToken });

            var confirmUrl = 'https://drive.google.com/uc?export=download&confirm=' +
                             confirmToken + '&id=${fileId}';
            try {
              var confirmResp = await fetch(confirmUrl, {
                credentials: 'include',
                redirect: 'follow',
              });
              var confirmCt = confirmResp.headers.get('content-type') || 'none';
              toRN({ type: 'log', msg: 'Confirm attempt: ct=' + confirmCt + ' url=' + confirmResp.url.substring(0,120) });

              if (confirmCt.indexOf('video') !== -1 || confirmCt.indexOf('octet-stream') !== -1) {
                toRN({ type: 'log', msg: 'SUCCESS via confirm token!' });
                attachEvents();
                v.src = confirmResp.url;
                v.load();
                if (${play ? 'true' : 'false'}) v.play().catch(function(){});
                return;
              }
            } catch(ce) {
              toRN({ type: 'log', msg: 'Confirm fetch failed: ' + ce.message });
            }
          }
        }

        // Try to find any video URL in the HTML
        var mp4Match = text.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
        if (mp4Match) {
          toRN({ type: 'log', msg: 'Found mp4 URL in HTML: ' + mp4Match[0].substring(0, 120) });
          attachEvents();
          v.src = mp4Match[0];
          v.load();
          if (${play ? 'true' : 'false'}) v.play().catch(function(){});
          return;
        }

        var googleVideoMatch = text.match(/https?:\/\/[^"' ]*googlevideo[^"' ]*/);
        if (googleVideoMatch) {
          toRN({ type: 'log', msg: 'Found googlevideo URL: ' + googleVideoMatch[0].substring(0, 120) });
          attachEvents();
          v.src = googleVideoMatch[0];
          v.load();
          if (${play ? 'true' : 'false'}) v.play().catch(function(){});
          return;
        }
      }

    } catch(e) {
      toRN({ type: 'log', msg: 'Attempt ' + i + ' exception: ' + e.message });
    }
  }

  // ✅ Last resort: set src directly — let browser handle auth natively
  toRN({ type: 'log', msg: 'All fetch attempts failed — trying direct src assignment' });
  setStatus('Loading...');
  attachEvents();
  v.src = 'https://drive.google.com/uc?export=download&confirm=t&id=${fileId}';
  v.load();
  if (${play ? 'true' : 'false'}) {
    v.play().catch(function(e) {
      toRN({ type: 'log', msg: 'Direct play() failed: ' + e.message });
    });
  }
}

resolveAndPlay();
</script>
</body>
</html>`;

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
          break;
        case 'stateChange':
          onStateChange?.(msg.state);
          break;
        case 'progress':
          positionRef.current = msg.currentTime;
          durationRef.current = msg.duration || durationRef.current;
          onProgress?.(msg.currentTime, msg.duration);
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
          if (v) v.currentTime = ${0};
        })();
      `.replace('${0}', s.toString()));
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
          // ✅ CRITICAL: sets origin to drive.google.com
          // so fetch() sends the Google session cookies
          // that were set when user browsed Drive in YouTubeDiscoveryScreen
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