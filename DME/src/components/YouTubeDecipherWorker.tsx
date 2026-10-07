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
    // Exact Rave po_token.html behavior: pass ONLY webPoSignalOutput.
    // Leaving contentBinding and signedTimestamp undefined signals WebPO token mint mode.
    return botguard.snapshot({
      webPoSignalOutput: webPoSignalOutput
    });
  }).then(function(botguardResponse) {
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
            : null));

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
          return reject(new Error('PMD:Undefined - webPoSignalOutput is empty'));
        }

        var getMinter = (typeof signals[0] === 'function')
          ? signals[0]
          : (signals.find(function(s) { return typeof s === 'function'; }) || null);

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
      resolve(pot);
    } catch (err) {
      reject(new Error('obtainPoToken error: ' + (err && (err.message || String(err)))));
    }
  });
}

// ── YouTube Player Native Opcode VM & URL Class Engine ──
var _dynamicUrlClass = null;

function runUrlClassTransform(inst) {
  if (!inst) return;
  try {
    var proto = Object.getPrototypeOf(inst);
    var keys = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
    for (var k = 0; k < keys.length; k++) {
      var prop = keys[k];
      if (['constructor', 'set', 'get', 'clone'].indexOf(prop) === -1 && typeof inst[prop] === 'function') {
        try { inst[prop](); } catch(_) {}
        break;
      }
    }
  } catch(_) {}
}

function findUrlClass(playerSource) {
  if (_dynamicUrlClass) return _dynamicUrlClass;
  var target = window._yt_player || window;
  var testSampleUrl = 'https://rr1---sn-test.googlevideo.com/videoplayback?n=v9gO1XF2_jMsdS_K&itag=18';

  // 1. Multi-Pattern AST/Regex extraction from playerSource:
  if (playerSource && typeof playerSource === 'string') {
    var patterns = [
      // Pattern A (exact modern closure): (new g.YI(L, !0)).get("n") or (new g.fk(L, true)).get("n")
      /\\(\\s*new\\s+(?:g|[a-zA-Z0-9$]+)\\.([a-zA-Z0-9$]+)\\s*\\([^,]+,\\s*(?:!0|true|1)\\s*\\)\\s*\\)\\.get\\(\\s*["']n["']\\s*\\)/,
      // Pattern B (permissive arguments): (new g.YI(...)).get("n")
      /\\(\\s*new\\s+(?:g|[a-zA-Z0-9$]+)\\.([a-zA-Z0-9$]+)\\s*\\([^)]*\\)\\s*\\)\\.get\\(\\s*["']n["']\\s*\\)/,
      // Pattern C (unwrapped instantiation): new g.YI(...).get("n")
      /new\\s+(?:g|[a-zA-Z0-9$]+)\\.([a-zA-Z0-9$]+)\\s*\\([^)]*\\)\\.get\\(\\s*["']n["']\\s*\\)/,
      // Pattern D (generic class with .get("n")): ([a-zA-Z0-9$]+)\([^)]*\)\.get("n")
      /([a-zA-Z0-9$]+)\\s*\\([^)]*\\)\\.get\\(\\s*["']n["']\\s*\\)/
    ];

    for (var p = 0; p < patterns.length; p++) {
      var m = playerSource.match(patterns[p]);
      if (m && m[1]) {
        var clsName = m[1];
        var candidate = (typeof target[clsName] === 'function') ? target[clsName] : ((typeof window[clsName] === 'function') ? window[clsName] : null);
        if (candidate) {
          try {
            var testInst = new candidate(testSampleUrl, true);
            testInst.set('n', 'v9gO1XF2_jMsdS_K');
            runUrlClassTransform(testInst);
            var testVal = testInst.get('n');
            if (typeof testVal === 'string' && testVal.length > 0 && testVal !== 'v9gO1XF2_jMsdS_K') {
              console.log('🤖 [findUrlClass] Verified active UrlClass by pattern [' + p + ']:', clsName, 'testVal:', testVal);
              _dynamicUrlClass = candidate;
              return candidate;
            }
          } catch(_) {}
        }
      }
    }
  }

  // 2. Behavioral scan across all classes in target (no regex reliance):
  // Tests EVERY class with prototype.set & prototype.get using a live test token
  for (var k in target) {
    try {
      var v = target[k];
      if (typeof v === 'function' && v.prototype && typeof v.prototype.set === 'function' && typeof v.prototype.get === 'function') {
        var testInst2 = new v(testSampleUrl, true);
        testInst2.set('n', 'v9gO1XF2_jMsdS_K');
        runUrlClassTransform(testInst2);
        var testVal2 = testInst2.get('n');
        if (typeof testVal2 === 'string' && testVal2.length > 0 && testVal2 !== 'v9gO1XF2_jMsdS_K') {
          console.log('🤖 [findUrlClass] Verified active UrlClass by behavioral scan:', k, 'testVal:', testVal2);
          _dynamicUrlClass = v;
          return v;
        }
      }
    } catch(_) {}
  }

  // 3. Behavioral scan across window globals:
  for (var wk in window) {
    try {
      var wv = window[wk];
      if (typeof wv === 'function' && wv.prototype && typeof wv.prototype.set === 'function' && typeof wv.prototype.get === 'function') {
        var testInst3 = new wv(testSampleUrl, true);
        testInst3.set('n', 'v9gO1XF2_jMsdS_K');
        runUrlClassTransform(testInst3);
        var testVal3 = testInst3.get('n');
        if (typeof testVal3 === 'string' && testVal3.length > 0 && testVal3 !== 'v9gO1XF2_jMsdS_K') {
          console.log('🤖 [findUrlClass] Verified active UrlClass on window:', wk, 'testVal:', testVal3);
          _dynamicUrlClass = wv;
          return wv;
        }
      }
    } catch(_) {}
  }

  return null;
}

function preprocessAndEval(playerSource) {
  if (!playerSource || typeof playerSource !== 'string' || playerSource.length < 50000) {
    throw new Error('Invalid playerSource provided to preprocessAndEval');
  }

  var sigPattern = /([a-zA-Z0-9$]+)\\s*&&\\s*\\(\\1=([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),\\1\\)\\),\\s*([a-zA-Z0-9$]+)\\[[a-zA-Z0-9$]+\\[[0-9]+\\]\\]\\(([a-zA-Z0-9$]+),([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),\\1\\)\\)\\)/;
  var m = playerSource.match(sigPattern);
  var sigExpr = m ? (m[10] + '(' + m[11] + ', ' + m[12] + ', ' + m[2] + '(' + m[3] + ', ' + m[4] + ', ' + m[5] + '(' + m[6] + ', ' + m[7] + ', sig)))') : 'null';

  if (!m) {
    var bxjMatch = playerSource.match(/let\\s+([a-zA-Z0-9$]+)=([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),[a-zA-Z0-9$]+\\.s\\)\\);[a-zA-Z0-9$]+\\[[a-zA-Z0-9$]+\\[[0-9]+\\]\\]\\([a-zA-Z0-9$]+,([a-zA-Z0-9$]+)\\(([0-9]+),([0-9]+),\\1\\)\\)/);
    if (bxjMatch) {
      sigExpr = bxjMatch[7] + '(' + bxjMatch[8] + ', ' + bxjMatch[9] + ', ' + bxjMatch[2] + '(' + bxjMatch[3] + ', ' + bxjMatch[4] + ', ' + bxjMatch[5] + '(' + bxjMatch[6] + ', ' + bxjMatch[7] + ', sig)))';
    }
  }

  var injection = '\\ng._yt_sig = function(sig) {\\n  try {\\n    ' + (sigExpr !== 'null' ? 'return ' + sigExpr + ';' : 'return null;') + '\\n  } catch(e) { return null; }\\n};\\n';

  var lastIdx = playerSource.lastIndexOf('})(_yt_player);');
  var modifiedCode;
  if (lastIdx !== -1) {
    modifiedCode = playerSource.slice(0, lastIdx) + injection + playerSource.slice(lastIdx);
  } else {
    modifiedCode = playerSource;
  }

  modifiedCode = modifiedCode.replace(/var\\s+_yt_player\\s*=\\s*\\{\\};?/, 'window._yt_player = window._yt_player || {}; var _yt_player = window._yt_player;');
  try {
    (new Function(modifiedCode))();
  } catch(e) {
    console.warn('[YouTubeDecipherWorker] Player script execution warning:', e);
  }
  _dynamicUrlClass = findUrlClass(playerSource);
}

function decipherBatch(itemsJson) {
  var items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
  var UrlClass = findUrlClass();
  var sigFn = (window._yt_player && typeof window._yt_player._yt_sig === 'function') ? window._yt_player._yt_sig : null;
  var results = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var newN = null;
    var newSig = null;
    var newUrl = null;

    var cleanSig = item.sig || '';
    while (cleanSig.indexOf('%') !== -1) {
      try {
        var next = decodeURIComponent(cleanSig);
        if (next === cleanSig) break;
        cleanSig = next;
      } catch(_) { break; }
    }

    if (item.isCipher && cleanSig && sigFn) {
      try {
        var s = sigFn(cleanSig);
        if (s && typeof s === 'string' && s.length > 10) newSig = s;
      } catch(_) {}
    }

    if (item.n && UrlClass) {
      try {
        var testUrl = item.rawUrl || ('https://rr1---sn-test.googlevideo.com/videoplayback?n=' + encodeURIComponent(item.n));
        var inst = new UrlClass(testUrl, true);
        inst.set('n', item.n);
        runUrlClassTransform(inst);
        var tn = inst.get('n');
        if (tn) newN = tn;
      } catch(_) {}
    }

    if (item.rawUrl) {
      try {
        var u = new URL(item.rawUrl);
        u.searchParams.delete('alr');
        if (newN) u.searchParams.set('n', newN);
        if (newSig && item.isCipher) u.searchParams.set(item.sp || 'sig', newSig);
        newUrl = u.toString();
      } catch(_) {}
    }

    results.push({ itag: item.itag, newN: newN || item.n, newSig: newSig, newUrl: newUrl });
  }
  return JSON.stringify(results);
}

window.YT_PREPROCESS = {
  preprocessAndEval: preprocessAndEval,
  decipher: decipherBatch
};

window.handleHostMessage = function(data) {
  if (!data || !data.action) return;
  var id = data.id;

  if (data.action === 'ping') {
    window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, type: 'pong' }));
  } else if (data.action === 'preprocess') {
    try {
      if (data.code) {
        preprocessAndEval(data.code);
        window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true }));
      } else if (data.playerUrl) {
        fetch(data.playerUrl).then(function(r) { return r.text(); }).then(function(code) {
          preprocessAndEval(code);
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: true }));
        }).catch(function(err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, error: err.message || String(err) }));
        });
      } else {
        throw new Error('preprocess requires code or playerUrl');
      }
    } catch(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, error: err.message || String(err) }));
    }
  } else if (data.action === 'decipher') {
    try {
      var jsonResults = decipherBatch(data.items);
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, results: JSON.parse(jsonResults) }));
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
        const effectiveTimeout = timeoutMs ?? (action === 'runBotGuard' || action === 'obtainPoToken' || action === 'po_token' ? 35000 : action === 'extractVideo' ? 30000 : 15000);
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
