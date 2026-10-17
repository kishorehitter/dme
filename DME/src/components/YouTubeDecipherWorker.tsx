/**
 * YouTubeDecipherWorker.tsx
 *
 * Headless, zero-layout background WebView worker.
 * Houses Meriyah UMD AST parser, Rave's AST player preprocessor,
 * and BotGuard WebPO token generation.
 * Runs independently without affecting UI or user experience.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import YouTubeDecipherService from '../services/YouTubeDecipherService';
import { MERIYAH_CODE, EXTRACTOR_CODE } from '../services/YouTubeExtractorBundle';

// ── Static HTML Bundle defined OUTSIDE component so it is never recreated on re-renders ──
const HTML_BUNDLE = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
window.__earlyErrors = [];
window.onerror = function(msg, url, line) {
  try {
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'workerError', error: msg + ' (line ' + line + ')' }));
    } else {
      window.__earlyErrors.push(msg + ' (line ' + line + ')');
    }
  } catch(_) {}
};
</script>
<script>
${MERIYAH_CODE}
</script>
<script>
${EXTRACTOR_CODE}
</script>
<script>

// ── BotGuard & WebPO Implementation ──
function base64ToU8(base64) {
  if (!base64) return new Uint8Array(0);
  var clean = String(base64).split('-').join('+').split('_').join('/').split('.').join('=');
  while (clean.length % 4 !== 0) {
    clean += '=';
  }
  var binary = atob(clean);
  var u8 = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

function u8ToBase64(u8, base64url) {
  if (!u8 || u8.length === 0) return '';
  var binary = '';
  for (var i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  var result = btoa(binary);
  if (base64url) {
    return result.split('+').join('-').split('/').join('_').replace(/=+$/, '');
  }
  return result;
}

function stringToU8(str) {
  if (!str) return new Uint8Array(0);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  var u8 = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    u8[i] = str.charCodeAt(i) & 0xff;
  }
  return u8;
}

function loadBotGuard(challengeData) {
  var globalObj = window;
  var vm = globalObj[challengeData.globalName];
  var program = challengeData.program;
  var vmFunctions = {};

  if (!vm) throw new Error('[BotGuardClient]: VM not found in global (' + challengeData.globalName + ')');
  if (!vm.a) throw new Error('[BotGuardClient]: Could not load program');

  var vmFunctionsCallback = function(asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) {
    vmFunctions.asyncSnapshotFunction = asyncSnapshotFunction;
    vmFunctions.shutdownFunction = shutdownFunction;
    vmFunctions.passEventFunction = passEventFunction;
    vmFunctions.checkCameraFunction = checkCameraFunction;
  };

  // Exact Rave po_token.html line 34:
  // this.syncSnapshotFunction = this.vm.a(this.program, vmFunctionsCallback, true, this.userInteractionElement, function () {/** no-op */ }, [ [], [] ])[0]
  // MUST pass [ [], [] ] — never pass webPoSignalOutput here!
  var syncSnapshot = null;
  try {
    syncSnapshot = vm.a(program, vmFunctionsCallback, true, undefined, function() {}, [ [], [] ]);
  } catch(e) {
    throw new Error('[BotGuardClient]: Could not load program: ' + (e && (e.message || String(e))));
  }
  if (syncSnapshot && typeof syncSnapshot[0] === 'function') {
    window.__syncSnapshotFunction = syncSnapshot[0];
    window.__getMinter = syncSnapshot[0];
  }

  return new Promise(function(resolve, reject) {
    var i = 0;
    var refreshIntervalId = setInterval(function() {
      if (vmFunctions.asyncSnapshotFunction) {
        clearInterval(refreshIntervalId);
        resolve({
          vmFunctions: vmFunctions,
          syncSnapshotFunction: syncSnapshot ? syncSnapshot[0] : null,
          snapshot: function(args) {
            return new Promise(function(res, rej) {
              if (!vmFunctions.asyncSnapshotFunction) {
                return rej(new Error('[BotGuardClient]: Async snapshot function not found'));
              }
              // STRICTLY 4 arguments matching Rave's po_token.html:
              // [ args.contentBinding, args.signedTimestamp, args.webPoSignalOutput, args.skipPrivacyBuffer ]
              // For authentic WebPO token attestation, contentBinding and signedTimestamp MUST be undefined.
              vmFunctions.asyncSnapshotFunction(function(response) { res(response); }, [
                args.contentBinding,
                args.signedTimestamp,
                args.webPoSignalOutput,
                args.skipPrivacyBuffer
              ]);
            });
          }
        });
      }
      if (i >= 5000) {
        clearInterval(refreshIntervalId);
        reject(new Error('[BotGuardClient]: asyncSnapshotFunction timed out after 5s'));
      }
      i++;
    }, 2);
  });
}

function extractVisitorIdFromProtobuf(visitorData) {
  if (!visitorData || typeof visitorData !== 'string') return '';
  if (visitorData.length <= 24) return visitorData;
  try {
    var b64 = decodeURIComponent(visitorData).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    if (bin.charCodeAt(0) === 0x0a) {
      var len = bin.charCodeAt(1);
      if (len > 0 && len <= 32 && bin.length >= 2 + len) {
        return bin.substring(2, 2 + len);
      }
    }
  } catch (_) {}
  return '';
}

function createColdStartToken(contentBinding, clientState) {
  var cleanBinding = extractVisitorIdFromProtobuf(contentBinding);
  var contentBindingBytes = stringToU8(cleanBinding || '');
  var timestamp = Math.floor(Date.now() / 1000);
  var randomKeys = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
  var header = randomKeys.concat([
    0, (clientState || 1)
  ], [
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF
  ]);
  var packet = new Uint8Array(2 + header.length + contentBindingBytes.length);
  packet[0] = 34;
  packet[1] = header.length + contentBindingBytes.length;
  for (var h = 0; h < header.length; h++) packet[2 + h] = header[h];
  for (var c = 0; c < contentBindingBytes.length; c++) packet[2 + header.length + c] = contentBindingBytes[c];
  var payload = packet.subarray(2);
  var keyLength = randomKeys.length;
  for (var i = keyLength; i < payload.length; i++) {
    payload[i] ^= payload[i % keyLength];
  }
  return u8ToBase64(packet, true);
}

function runBotGuard(challengeData) {
  var interpreterJavascript = challengeData.interpreterJavascript;
  if (interpreterJavascript) {
    new Function(interpreterJavascript)();
  } else {
    throw new Error('Could not load VM');
  }

  // Seed window.yt.config_ exactly matching Rave (dumped_potoken_classes.txt lines 7116, 7305)
  if (challengeData.ytcfg) {
    try {
      window.yt = Object.assign(window.yt || {}, { config_: challengeData.ytcfg });
    } catch(_) {}
  } else if (!window.yt || !window.yt.config_) {
    window.yt = Object.assign(window.yt || {}, { config_: {} });
  }

  var webPoSignalOutput = [];
  window.webPoSignalOutput = webPoSignalOutput;
  window.__webPoSignalOutput = webPoSignalOutput;

  return loadBotGuard({
    globalName: challengeData.globalName,
    program: challengeData.program
  }).then(function(botguard) {
    if (botguard.syncSnapshotFunction && typeof botguard.syncSnapshotFunction === 'function') {
      window.__syncSnapshotFunction = botguard.syncSnapshotFunction;
      window.__getMinter = botguard.syncSnapshotFunction;
    }
    // Exact Rave po_token.html behavior: pass ONLY webPoSignalOutput.
    // Leaving contentBinding and signedTimestamp undefined signals WebPO token mint mode.
    return botguard.snapshot({
      webPoSignalOutput: webPoSignalOutput
    });
  }).then(function(botguardResponse) {
    if (webPoSignalOutput.length === 0 && window.__getMinter) {
      webPoSignalOutput.push(window.__getMinter);
    }
    return { webPoSignalOutput: webPoSignalOutput, botguardResponse: botguardResponse };
  });
}

var __mintCallback = null;
var __mintCallbackToken = null;

function obtainPoToken(webPoSignalOutput, integrityToken, identifier) {
  return new Promise(function(resolve, reject) {
    try {
      var signals = (Array.isArray(webPoSignalOutput) && webPoSignalOutput.length > 0)
        ? webPoSignalOutput
        : ((window.webPoSignalOutput && Array.isArray(window.webPoSignalOutput) && window.webPoSignalOutput.length > 0)
          ? window.webPoSignalOutput
          : ((window.__webPoSignalOutput && Array.isArray(window.__webPoSignalOutput) && window.__webPoSignalOutput.length > 0)
            ? window.__webPoSignalOutput
            : (window.__getMinter ? [window.__getMinter] : null)));

      if (!integrityToken) {
        return reject(new Error('No integrityToken provided to obtainPoToken'));
      }

      // Convert integrityToken from Base64 string to Uint8Array (exact Rave JavaScriptUtilKt.base64ToU8)
      var u8IntegrityToken = (integrityToken instanceof Uint8Array)
        ? integrityToken
        : base64ToU8(String(integrityToken));

      var tokenKey = (typeof integrityToken === 'string')
        ? integrityToken
        : u8ToBase64(u8IntegrityToken, false);

      var mintCallback = window.__mintCallback || __mintCallback;
      var mintCallbackToken = window.__mintCallbackToken || __mintCallbackToken;

      if (!mintCallback || mintCallbackToken !== tokenKey) {
        if (!signals || signals.length === 0) {
          if (window.__getMinter && typeof window.__getMinter === 'function') {
            signals = [window.__getMinter];
          } else {
            return reject(new Error('PMD:Undefined - webPoSignalOutput is empty'));
          }
        }

        var getMinter = (typeof signals[0] === 'function')
          ? signals[0]
          : (signals.find(function(s) { return typeof s === 'function'; }) || (typeof window.__getMinter === 'function' ? window.__getMinter : null));

        if (!getMinter || typeof getMinter !== 'function') {
          return reject(new Error('PMD:Undefined - getMinter function not found in webPoSignalOutput (len=' + signals.length + ')'));
        }

        var cb = null;
        try { cb = getMinter(u8IntegrityToken); } catch(_) {}
        if (typeof cb !== 'function') {
          try { cb = getMinter(integrityToken); } catch(_) {}
        }
        if (typeof cb === 'function') {
          mintCallback = cb;
          mintCallbackToken = tokenKey;
          window.__mintCallback = cb;
          window.__mintCallbackToken = tokenKey;
          __mintCallback = cb;
          __mintCallbackToken = tokenKey;
        }
      }

      if (!mintCallback || typeof mintCallback !== 'function') {
        return reject(new Error('APF:Failed - getMinter did not return a function, got ' + typeof mintCallback));
      }

      // Convert identifier to Uint8Array (exact Rave JavaScriptUtilKt.stringToU8)
      var idStr = (identifier !== undefined && identifier !== null) ? String(identifier) : '';
      if (idStr.length > 24) {
        idStr = extractVisitorIdFromProtobuf(idStr);
      }
      var u8Identifier = stringToU8(idStr);

      var result = null;
      try {
        result = mintCallback(u8Identifier);
      } catch(e2) {}
      if (!result) {
        try {
          result = mintCallback(idStr);
        } catch(_) {}
      }

      if (!result) {
        return reject(new Error('YNJ:Undefined - mintCallback returned ' + result));
      }

      if (!(result instanceof Uint8Array)) {
        if (Array.isArray(result)) {
          result = new Uint8Array(result);
        } else {
          return reject(new Error('ODM:Invalid - mintCallback did not return Uint8Array, got ' + typeof result));
        }
      }

      var pot = u8ToBase64(result, true);
      if (pot && (pot.length < 100 || pot.length > 150)) {
        return reject(new Error('PO-Token length invalid: ' + pot.length + ' (expected 100-150 chars)'));
      }
      resolve(pot);
    } catch (err) {
      reject(new Error('obtainPoToken error: ' + (err && (err.message || String(err)))));
    }
  });
}

window.handleHostMessage = function(data) {
  if (!data || !data.action) return;
  var id = data.id;

  if (data.action === 'ping') {
    window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, type: 'pong' }));
  } else if (data.action === 'preprocess') {
    try {
      if (!window.YT_PREPROCESS || typeof window.YT_PREPROCESS.preprocessAndEval !== 'function') {
        throw new Error('YT_PREPROCESS.preprocessAndEval not available');
      }
      if (data.code) {
        window.YT_PREPROCESS.preprocessAndEval(data.code);
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true }));
      } else if (data.playerUrl) {
        fetch(data.playerUrl).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching player');
          return r.text();
        }).then(function(code) {
          window.YT_PREPROCESS.preprocessAndEval(code);
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true }));
        }).catch(function(err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, error: err.message || String(err) }));
        });
      } else {
        throw new Error('preprocess requires playerUrl or code');
      }
    } catch(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, error: err.message || String(err) }));
    }
  } else if (data.action === 'decipher') {
    try {
      if (!window.YT_PREPROCESS || typeof window.YT_PREPROCESS.decipher !== 'function') {
        throw new Error('YT_PREPROCESS.decipher not available');
      }
      var items = typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
      var rawResults = window.YT_PREPROCESS.decipher(items);
      var parsedRes = typeof rawResults === 'string' ? JSON.parse(rawResults) : rawResults;
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, results: parsedRes }));
    } catch(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, error: err.message || String(err) }));
    }
  } else if (data.action === 'runBotGuard') {
    try {
      runBotGuard(data.challengeData).then(function(result) {
        window.__webPoSignalOutput = result.webPoSignalOutput;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: id,
          success: true,
          botguardResponse: result.botguardResponse
        }));
      }).catch(function(err) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: id,
          error: err ? (err.message || String(err)) : 'runBotGuard error'
        }));
      });
    } catch(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id,
        error: err ? (err.message || String(err)) : 'runBotGuard sync error'
      }));
    }
  } else if (data.action === 'obtainPoToken') {
    obtainPoToken(window.__webPoSignalOutput, data.integrityToken, data.identifier).then(function(poToken) {
      if (poToken && typeof poToken === 'string' && poToken.length > 0) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: id,
          success: true,
          poToken: poToken
        }));
      } else {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: id,
          success: false,
          error: 'obtainPoToken returned empty or non-string token (len=' + (poToken ? poToken.length : 0) + ')',
          poToken: null
        }));
      }
    }).catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id,
        success: false,
        error: err && (err.message || String(err)),
        poToken: null
      }));
    });
  } else if (data.action === 'createColdStartToken') {
    try {
      var tok = createColdStartToken(data.identifier || '', data.clientState || 1);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id,
        success: true,
        poToken: tok
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id,
        success: false,
        error: err && (err.message || String(err)),
        poToken: null
      }));
    }
  } else if (data.action === 'fetchAttGet') {
    fetch('https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.body)
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t); });
      }
      return r.json();
    }).then(function(json) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true, data: json }));
    }).catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: false, error: err && (err.message || String(err)) }));
    });
  } else if (data.action === 'fetchGenerateIT') {
    fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1'
      },
      body: JSON.stringify(data.body)
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t); });
      }
      return r.json();
    }).then(function(json) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true, data: json }));
    }).catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: false, error: err && (err.message || String(err)) }));
    });
  }
};

(function() {
  function pingReady() {
    if (window.__readyAck) return;
    var hasBridge = typeof window.ReactNativeWebView !== 'undefined' && typeof window.ReactNativeWebView.postMessage === 'function';
    var hasHostMsg = typeof window.handleHostMessage === 'function';
    var hasPreprocess = window.YT_PREPROCESS && typeof window.YT_PREPROCESS.preprocessAndEval === 'function';

    if (hasBridge && hasHostMsg && hasPreprocess) {
      try {
        if (window.__earlyErrors && window.__earlyErrors.length > 0) {
          while (window.__earlyErrors.length > 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'workerError', error: window.__earlyErrors.shift() }));
          }
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
      } catch(_) {}
    }
  }

  pingReady();
  var interval = setInterval(pingReady, 100);
  setTimeout(function() { clearInterval(interval); }, 10000);
})();
</script>
</head>
<body></body>
</html>`;

// Static reference so React Native WebView NEVER reloads on parent component re-renders
const WEBVIEW_SOURCE = { html: HTML_BUNDLE, baseUrl: 'https://www.youtube.com' };

const YouTubeDecipherWorker: React.FC = () => {
    const webViewRef = useRef<WebView>(null);
    const pendingRequests = useRef<Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>>(new Map());

    const sendToWorker = useCallback((action: string, payload: any = {}, timeoutMs?: number): Promise<any> => {
        const effectiveTimeout = timeoutMs ?? (action === 'runBotGuard' || action === 'obtainPoToken' || action === 'po_token' || action === 'preprocess' ? 35000 : action === 'extractVideo' ? 30000 : 15000);
        return new Promise((resolve, reject) => {
            const id = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            pendingRequests.current.set(id, { resolve, reject });

            const payloadStr = JSON.stringify({ id, action, ...payload });
            // Poll up to 5000ms if handleHostMessage is still initializing
            const js = `
                (function() {
                    var tries = 0;
                    function attempt() {
                        if (typeof window.handleHostMessage === 'function') {
                            try {
                                window.handleHostMessage(${payloadStr});
                            } catch(e) {
                                window.ReactNativeWebView.postMessage(JSON.stringify({ id: '${id}', error: e?.message || String(e) }));
                            }
                        } else if (tries < 50) {
                            tries++;
                            setTimeout(attempt, 100);
                        } else {
                            window.ReactNativeWebView.postMessage(JSON.stringify({ id: '${id}', error: 'handleHostMessage not ready after 5000ms' }));
                        }
                    }
                    attempt();
                })();
                true;
            `;
            webViewRef.current?.injectJavaScript(js);

            setTimeout(() => {
                if (pendingRequests.current.has(id)) {
                    pendingRequests.current.delete(id);
                    reject(new Error(`[YouTubeDecipherWorker] Action '${action}' timed out after ${effectiveTimeout}ms`));
                }
            }, effectiveTimeout);
        });
    }, []);

    useEffect(() => {
        YouTubeDecipherService.registerWorker(sendToWorker);
        return () => {
            YouTubeDecipherService.unregisterWorker();
        };
    }, [sendToWorker]);

    const triggerVerification = useCallback(() => {
        if (YouTubeDecipherService.isWorkerReady()) return;
        webViewRef.current?.injectJavaScript(`
            (function() {
                var hasBridge = typeof window.ReactNativeWebView !== 'undefined' && typeof window.ReactNativeWebView.postMessage === 'function';
                var hasHostMsg = typeof window.handleHostMessage === 'function';
                var hasPreprocess = window.YT_PREPROCESS && typeof window.YT_PREPROCESS.preprocessAndEval === 'function';
                if (hasBridge && hasHostMsg && hasPreprocess) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
                }
            })();
            true;
        `);
    }, []);

    // Periodic check until verified (every 300ms up to 10s)
    useEffect(() => {
        let attempts = 0;
        const pingInterval = setInterval(() => {
            attempts++;
            if (YouTubeDecipherService.isWorkerReady() || attempts > 35) {
                clearInterval(pingInterval);
                return;
            }
            triggerVerification();
        }, 300);
        return () => clearInterval(pingInterval);
    }, [triggerVerification]);

    const handleMessage = (event: WebViewMessageEvent) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (!data) return;

            if (data.type === 'ready') {
                console.log('🤖 [YouTubeDecipherWorker] WebView worker initialized & ready');
                YouTubeDecipherService.notifyWorkerReady();
                webViewRef.current?.injectJavaScript(`
                    window.__readyAck = true;
                    true;
                `);
                return;
            }

            if (data.type === 'workerError') {
                console.warn('⚠️ [YouTubeDecipherWorker] Internal WebView error:', data.error);
                return;
            }

            if (data.id && pendingRequests.current.has(data.id)) {
                const { resolve, reject } = pendingRequests.current.get(data.id)!;
                pendingRequests.current.delete(data.id);
                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data);
                }
            }
        } catch (err) {
            console.warn('⚠️ [YouTubeDecipherWorker] Message parse error:', err);
        }
    };

    return (
        <View style={styles.hidden} pointerEvents="none">
            <WebView
                ref={webViewRef}
                style={styles.webview}
                source={WEBVIEW_SOURCE}
                onMessage={handleMessage}
                onLoadEnd={() => {
                    console.log('🤖 [YouTubeDecipherWorker] WebView onLoadEnd fired');
                    triggerVerification();
                }}
                onError={(e) => {
                    console.warn('⚠️ [YouTubeDecipherWorker] WebView load error:', e?.nativeEvent?.description);
                }}
                onHttpError={(e) => {
                    console.warn('⚠️ [YouTubeDecipherWorker] WebView HTTP error:', e?.nativeEvent?.statusCode);
                }}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                originWhitelist={['*']}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    hidden: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 200,
        height: 200,
        opacity: 0.01,
        overflow: 'hidden',
    },
    webview: {
        width: 200,
        height: 200,
    },
});

export default React.memo(YouTubeDecipherWorker);
