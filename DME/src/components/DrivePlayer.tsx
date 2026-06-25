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
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  const inject = (js: string) => {
    webViewRef.current?.injectJavaScript(js + '; true;');
  };

  const resolveDriveUrl = async (id: string): Promise<string> => {
    const urls = [
      `https://drive.google.com/uc?export=download&confirm=t&id=${id}`,
      `https://drive.google.com/uc?export=download&confirm=t&id=${id}&authuser=0`,
    ];

    for (let i = 0; i < urls.length; i++) {
      try {
        console.log(`🎬 [DRIVE RESOLVER] Native fetch attempt ${i + 1} for ${id}`);
        const response = await fetch(urls[i], {
          method: 'GET',
        });

        const contentType = response.headers.get('content-type') || '';
        const finalUrl = response.url;

        console.log(`🎬 [DRIVE RESOLVER] Native response: status=${response.status}, contentType=${contentType}, finalUrl=${finalUrl}`);

        if (contentType.includes('video') || contentType.includes('octet-stream')) {
          console.log(`🎬 [DRIVE RESOLVER] SUCCESS: Direct stream resolved: ${finalUrl}`);
          return finalUrl;
        }

        if (contentType.includes('html')) {
          const text = await response.text();
          
          // Check for virus scan warning page
          if (text.includes('virus') || text.includes('download_warning') || text.includes('confirm')) {
            const confirmMatch = text.match(/confirm=([^&"]+)/);
            if (confirmMatch) {
              const confirmToken = confirmMatch[1];
              const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmToken}&id=${id}`;
              console.log(`🎬 [DRIVE RESOLVER] Found confirm token. Fetching confirm URL: ${confirmUrl}`);
              
              const confirmResponse = await fetch(confirmUrl);
              const confirmContentType = confirmResponse.headers.get('content-type') || '';
              if (confirmContentType.includes('video') || confirmContentType.includes('octet-stream')) {
                console.log(`🎬 [DRIVE RESOLVER] SUCCESS via confirm token: ${confirmResponse.url}`);
                return confirmResponse.url;
              }
            }
          }

          // Fallback regex matching in HTML (double-escaped since it's defined inside a standard template literal)
          const mp4Match = text.match(/https?:\/\/[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]+\.mp4[^\s"']*/);
          if (mp4Match) {
            console.log(`🎬 [DRIVE RESOLVER] Found mp4 URL in HTML: ${mp4Match[0]}`);
            return mp4Match[0];
          }

          const googleVideoMatch = text.match(/https?:\/\/[^"' ]*googlevideo[^"' ]*/);
          if (googleVideoMatch) {
            console.log(`🎬 [DRIVE RESOLVER] Found googlevideo URL in HTML: ${googleVideoMatch[0]}`);
            return googleVideoMatch[0];
          }
        }
      } catch (e: any) {
        console.warn(`🎬 [DRIVE RESOLVER] Native fetch attempt ${i} failed:`, e.message);
      }
    }

    // Last resort fallback
    console.log(`🎬 [DRIVE RESOLVER] Native resolution failed. Returning direct link fallback.`);
    return `https://drive.google.com/uc?export=download&confirm=t&id=${id}`;
  };

  React.useEffect(() => {
    if (!fileId) return;
    isReadyRef.current = false;
    setResolvedUrl(null);
    resolveDriveUrl(fileId).then((url) => {
      console.log('🎬 [DRIVE PLAYER] Stream resolved via native resolver:', url);
      setResolvedUrl(url);
      onStreamResolved?.(url, {});
    });
  }, [fileId]);

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
    display: ${resolvedUrl ? 'block' : 'none'};
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
<div id="status">${resolvedUrl ? 'Loading video...' : 'Resolving Google Drive stream...'}</div>
<video
  id="dmevideo"
  playsinline
  webkit-playsinline
  preload="auto"
  src="${resolvedUrl || ''}"
  ${muted ? 'muted' : ''}
></video>

<script>
var v = document.getElementById('dmevideo');
var statusEl = document.getElementById('status');
var ready = false;

function toRN(obj) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
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

attachEvents();

window.addEventListener('message', function(event) {
  try {
    var data = JSON.parse(event.data);
    if (data.action === 'play') {
      v.play().catch(function(){});
    } else if (data.action === 'pause') {
      v.pause();
    } else if (data.action === 'mute') {
      v.muted = true;
    } else if (data.action === 'unmute') {
      v.muted = false;
    }
  } catch(e) {}
});

if (${play ? 'true' : 'false'} && ${resolvedUrl ? 'true' : 'false'}) {
  v.play().catch(function(e) {
    toRN({ type: 'log', msg: 'play() error: ' + e.message });
  });
}
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