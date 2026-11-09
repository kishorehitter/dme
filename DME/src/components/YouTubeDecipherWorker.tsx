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

      if (pot && (pot.length < 80 || pot.length > 350)) {

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

  } else if (data.action === 'detectAspectRatio') {

    var vId = data.videoId;

    var passedSpec = data.storyboardSpec;

    if (!vId) {

      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: false, error: 'No videoId' }));

      return;

    }



    function snapToCinematicAR(rawAr) {
      if (!rawAr || isNaN(rawAr)) return { ar: 16 / 9, vertPct: 0 };
      var standards = [
        { ar: 1.85, tol: 0.05 },
        { ar: 2.00, tol: 0.06 },
        { ar: 2.20, tol: 0.06 },
        { ar: 2.35, tol: 0.05 },
        { ar: 2.39, tol: 0.07 },
        { ar: 2.55, tol: 0.08 },
        { ar: 2.76, tol: 0.08 }
      ];
      for (var i = 0; i < standards.length; i++) {
        if (Math.abs(rawAr - standards[i].ar) <= standards[i].tol) {
          var sAr = standards[i].ar;
          var vertPct = Math.max(0, (1 - (1.77778 / sAr)) * 0.5);
          return { ar: sAr, vertPct: vertPct };
        }
      }
      if (rawAr > 1.80 && rawAr <= 3.2) {
        var vp = Math.max(0, (1 - (1.77778 / rawAr)) * 0.5);
        return { ar: rawAr, vertPct: Math.min(0.26, vp) };
      }
      return { ar: rawAr, vertPct: 0 };
    }

    function scanThumb(thumbUrl, fallbackUrl) {
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
            if (x < 0 || x >= W || y < 0 || y >= H) return false;
            var idx = (y * W + x) * 4;
            var r = imgData[idx];
            var g = imgData[idx + 1];
            var b = imgData[idx + 2];
            var lum = 0.299 * r + 0.587 * g + 0.114 * b;
            return lum < 32 && r < 45 && g < 45 && b < 45;
          }

          var maxCropH = Math.floor(H * 0.26);
          var scanStartX = Math.floor(W * 0.15);
          var scanEndX = Math.floor(W * 0.85);

          // 1. Scan Top & Bottom Letterbox Bars (Cinema / Widescreen)
          var topBar = 0;
          while (topBar < maxCropH) {
            var darkCols = 0;
            var totalCols = 0;
            for (var x = scanStartX; x < scanEndX; x += 3) {
              if (isPixelDark(x, topBar)) darkCols++;
              totalCols++;
            }
            if (totalCols > 0 && (darkCols / totalCols) >= 0.88) topBar++;
            else break;
          }

          var bottomBar = 0;
          while (bottomBar < maxCropH) {
            var darkCols = 0;
            var totalCols = 0;
            for (var x = scanStartX; x < scanEndX; x += 3) {
              if (isPixelDark(x, H - 1 - bottomBar)) darkCols++;
              totalCols++;
            }
            if (totalCols > 0 && (darkCols / totalCols) >= 0.88) bottomBar++;
            else break;
          }

          var letterboxH = 0;
          var symTol = Math.max(3, Math.round(H * 0.08));
          if (topBar >= Math.round(H * 0.04) && bottomBar >= Math.round(H * 0.04)) {
            if (Math.abs(topBar - bottomBar) <= symTol) {
              letterboxH = Math.min(topBar, bottomBar);
            } else {
              var minB = Math.min(topBar, bottomBar);
              if (minB >= Math.round(H * 0.04)) letterboxH = minB;
            }
          } else if (topBar >= Math.round(H * 0.04) && bottomBar < Math.round(H * 0.04)) {
            letterboxH = topBar;
          } else if (bottomBar >= Math.round(H * 0.04) && topBar < Math.round(H * 0.04)) {
            letterboxH = bottomBar;
          }

          if (letterboxH >= Math.round(H * 0.04)) {
            var activeH = H - (letterboxH * 2);
            var rawAr = (img.naturalWidth / img.naturalHeight) * (H / activeH);
            var snapped = snapToCinematicAR(rawAr);
            if (snapped.ar >= 1.82 && snapped.ar <= 3.2) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                id: id,
                success: true,
                aspectRatio: snapped.ar,
                verticalPercent: snapped.vertPct,
                source: 'thumb'
              }));
              return;
            }
          }

          // 2. Scan Left & Right Pillarbox Bars (Tall / 4:3 / Narrow)
          var maxCropW = Math.floor(W * 0.28);
          var scanStartY = Math.floor(H * 0.15);
          var scanEndY = Math.floor(H * 0.85);

          var leftBar = 0;
          while (leftBar < maxCropW) {
            var darkRows = 0;
            var totalRows = 0;
            for (var y = scanStartY; y < scanEndY; y += 3) {
              if (isPixelDark(leftBar, y)) darkRows++;
              totalRows++;
            }
            if (totalRows > 0 && (darkRows / totalRows) >= 0.88) leftBar++;
            else break;
          }

          var rightBar = 0;
          while (rightBar < maxCropW) {
            var darkRows = 0;
            var totalRows = 0;
            for (var y = scanStartY; y < scanEndY; y += 3) {
              if (isPixelDark(W - 1 - rightBar, y)) darkRows++;
              totalRows++;
            }
            if (totalRows > 0 && (darkRows / totalRows) >= 0.88) rightBar++;
            else break;
          }

          var pSymTol = Math.max(3, Math.round(W * 0.08));
          var pillarboxW = 0;
          if (Math.abs(leftBar - rightBar) <= pSymTol) {
            pillarboxW = Math.min(leftBar, rightBar);
          }

          if (pillarboxW >= Math.round(W * 0.04)) {
            var activeW = W - (pillarboxW * 2);
            var contentAR = (img.naturalWidth / img.naturalHeight) * (activeW / W);
            if (Math.abs(contentAR - 1.333) <= 0.08) contentAR = 4 / 3;
            else if (Math.abs(contentAR - 1.0) <= 0.06) contentAR = 1.0;
            if (contentAR >= 0.5 && contentAR <= 1.7) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                id: id,
                success: true,
                aspectRatio: contentAR,
                verticalPercent: 0,
                source: 'thumb'
              }));
              return;
            }
          }

          var naturalAR = img.naturalWidth / img.naturalHeight;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            id: id,
            success: true,
            aspectRatio: naturalAR,
            verticalPercent: 0,
            source: 'thumb'
          }));
        } catch(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: false, error: e && e.message }));
        }
      };
      img.onerror = function() {
        if (fallbackUrl) {
          scanThumb(fallbackUrl, null);
        } else {
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, success: false, error: 'Thumbnail load failed' }));
        }
      };
      img.src = thumbUrl;
    }

    // -- Rave BBD (Black Bar Detection) on real video frames via Storyboard Tiles --

    function analyzeBBDStoryboards(imgData, totalW, totalH, frameW, frameH, cols, rows, numFrames) {
      function isDark(canvasX, canvasY) {
        if (canvasX < 0 || canvasX >= totalW || canvasY < 0 || canvasY >= totalH) return false;
        var idx = (canvasY * totalW + canvasX) * 4;
        var r = imgData[idx];
        var g = imgData[idx + 1];
        var b = imgData[idx + 2];
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum < 32 && r < 45 && g < 45 && b < 45;
      }

      var frameResults = [];
      var totalFramesAvailable = Math.min(cols * rows, numFrames || (cols * rows));
      // Sample 10 frames evenly across the middle 70% of video (15% to 87%)
      // Completely bypasses studio logos, intro cards, black fade-ins, and end credits!
      var samplePcts = [0.15, 0.23, 0.31, 0.39, 0.47, 0.55, 0.63, 0.71, 0.79, 0.87];
      for (var s = 0; s < samplePcts.length; s++) {
        var f = Math.floor(totalFramesAvailable * samplePcts[s]);
        if (f < 0 || f >= totalFramesAvailable) continue;
        var col = f % cols;
        var row = Math.floor(f / cols);
        var ox = col * frameW;
        var oy = row * frameH;

        // 1. Skip all-black / intro fade-in frames
        var centerDark = 0;
        var centerTotal = 0;
        for (var cy = oy + Math.floor(frameH * 0.25); cy < oy + Math.floor(frameH * 0.75); cy += 4) {
          for (var cx = ox + Math.floor(frameW * 0.25); cx < ox + Math.floor(frameW * 0.75); cx += 4) {
            if (isDark(cx, cy)) centerDark++;
            centerTotal++;
          }
        }
        if (centerTotal > 0 && (centerDark / centerTotal) > 0.90) {
          continue;
        }

        // 2. Count black rows from top (capped at MAX_CROP 26%)
        var maxCropH = Math.floor(frameH * 0.26);
        var scanStartX = ox + Math.floor(frameW * 0.15);
        var scanEndX = ox + Math.floor(frameW * 0.85);

        var top = 0;
        while (top < maxCropH) {
          var dark = 0;
          var total = 0;
          var y = oy + top;
          for (var x = scanStartX; x < scanEndX; x += 3) {
            if (isDark(x, y)) dark++;
            total++;
          }
          if (total > 0 && (dark / total) >= 0.88) top++;
          else break;
        }

        // 3. Count black rows from bottom (capped at MAX_CROP 26%)
        var bottom = 0;
        while (bottom < maxCropH) {
          var dark = 0;
          var total = 0;
          var y = oy + frameH - 1 - bottom;
          for (var x = scanStartX; x < scanEndX; x += 3) {
            if (isDark(x, y)) dark++;
            total++;
          }
          if (total > 0 && (dark / total) >= 0.88) bottom++;
          else break;
        }

        // 4. Robust letterbox bar calculation with subtitle/watermark tolerance
        var letterboxH = 0;
        var symTolerance = Math.max(3, Math.round(frameH * 0.08));

        if (top >= Math.round(frameH * 0.04) && bottom >= Math.round(frameH * 0.04)) {
          if (Math.abs(top - bottom) <= symTolerance) {
            letterboxH = Math.min(top, bottom);
          } else {
            var minBar = Math.min(top, bottom);
            if (minBar >= Math.round(frameH * 0.04)) {
              letterboxH = minBar;
            }
          }
        } else if (top >= Math.round(frameH * 0.04) && bottom < Math.round(frameH * 0.04)) {
          // Bottom bar contaminated by subtitles/lyrics, top is clean
          letterboxH = top;
        } else if (bottom >= Math.round(frameH * 0.04) && top < Math.round(frameH * 0.04)) {
          // Top bar contaminated by title banner, bottom is clean
          letterboxH = bottom;
        }

        // 5. Pillarbox check (only if no letterbox)
        var pillarboxW = 0;
        if (letterboxH < Math.round(frameH * 0.04)) {
          var maxCropW = Math.floor(frameW * 0.28);
          var scanStartY = oy + Math.floor(frameH * 0.15);
          var scanEndY = oy + Math.floor(frameH * 0.85);

          var left = 0;
          while (left < maxCropW) {
            var pDark = 0;
            var pTotal = 0;
            var px = ox + left;
            for (var py = scanStartY; py < scanEndY; py += 3) {
              if (isDark(px, py)) pDark++;
              pTotal++;
            }
            if (pTotal > 0 && (pDark / pTotal) >= 0.88) left++;
            else break;
          }
          var right = 0;
          while (right < maxCropW) {
            var pDark = 0;
            var pTotal = 0;
            var px = ox + frameW - 1 - right;
            for (var py = scanStartY; py < scanEndY; py += 3) {
              if (isDark(px, py)) pDark++;
              pTotal++;
            }
            if (pTotal > 0 && (pDark / pTotal) >= 0.88) right++;
            else break;
          }
          var pSymTol = Math.max(3, Math.round(frameW * 0.08));
          if (Math.abs(left - right) <= pSymTol) {
            pillarboxW = Math.min(left, right);
          }
        }

        var ar = frameW / frameH;
        var vertPct = 0;

        if (letterboxH >= Math.round(frameH * 0.04)) {
          var activeH = frameH - (letterboxH * 2);
          var rawAr = frameW / activeH;
          var snapped = snapToCinematicAR(rawAr);
          ar = snapped.ar;
          vertPct = snapped.vertPct;
        } else if (pillarboxW >= Math.round(frameW * 0.04)) {
          var activeW = frameW - (pillarboxW * 2);
          ar = activeW / frameH;
          if (Math.abs(ar - 1.333) <= 0.08) ar = 4 / 3;
          else if (Math.abs(ar - 1.0) <= 0.06) ar = 1.0;
        }

        frameResults.push({ ar: ar, vertPct: vertPct });
      }

      if (frameResults.length === 0) return null;

      // Filter to widescreen letterboxed frames
      var letterboxed = frameResults.filter(function(r) { return r.vertPct > 0; });

      // If at least 2 frames (or >= 25% of valid frames) detected widescreen letterbox:
      if (letterboxed.length >= 2 || (letterboxed.length >= 1 && frameResults.length <= 3)) {
        // Sort by aspect ratio and pick the median to eliminate outlier frames
        letterboxed.sort(function(a, b) { return a.ar - b.ar; });
        var mid = Math.floor(letterboxed.length / 2);
        return letterboxed[mid];
      }

      // Otherwise default to native 16:9 full frame
      return { ar: frameW / frameH, vertPct: 0 };
    }



    function parseStoryboardSpec(spec) {

      if (!spec) return null;

      var parts = spec.split('|');

      var baseUrl = parts[0];

      for (var i = parts.length - 1; i >= 1; i--) {

        var p = parts[i].split('#');

        if (p.length >= 8) {

          var w = parseInt(p[0], 10);

          var h = parseInt(p[1], 10);

          if (w <= 160) {

            var count = parseInt(p[2], 10);

            var cols = parseInt(p[3], 10);

            var rows = parseInt(p[4], 10);

            var template = p[6];

            var sigh = p[7];

            var lvlIdx = i - 1;

            var fileName = template.replace('$M', '0');

            var tileUrl = baseUrl.replace('$L', String(lvlIdx)).replace('$N', fileName) + '&sigh=' + sigh;

            return {

              tileUrl: tileUrl,

              frameW: w,

              frameH: h,

              cols: cols,

              rows: rows,

              totalFrames: Math.min(cols * rows, count)

            };

          }

        }

      }

      return null;

    }



    function scanStoryboardTile(sbInfo) {

      var img = new Image();

      img.crossOrigin = 'Anonymous';

      img.onload = function() {

        try {

          var totalW = img.naturalWidth || (sbInfo.cols * sbInfo.frameW);

          var totalH = img.naturalHeight || (sbInfo.rows * sbInfo.frameH);

          var cvs = document.createElement('canvas');

          cvs.width = totalW;

          cvs.height = totalH;

          var ctx = cvs.getContext('2d');

          ctx.drawImage(img, 0, 0, totalW, totalH);

          var imgData = ctx.getImageData(0, 0, totalW, totalH).data;



          var result = analyzeBBDStoryboards(imgData, totalW, totalH, sbInfo.frameW, sbInfo.frameH, sbInfo.cols, sbInfo.rows, sbInfo.totalFrames);

          if (result && result.ar && result.ar >= 0.4 && result.ar <= 3.5) {

            window.ReactNativeWebView.postMessage(JSON.stringify({

              id: id,

              success: true,

              aspectRatio: result.ar,

              verticalPercent: result.vertPct || 0,

              source: 'storyboard-bbd'

            }));

            return;

          }

          scanThumb('https://i.ytimg.com/vi/' + vId + '/mqdefault.jpg', 'https://i.ytimg.com/vi/' + vId + '/hqdefault.jpg');

        } catch(e) {

          scanThumb('https://i.ytimg.com/vi/' + vId + '/mqdefault.jpg', 'https://i.ytimg.com/vi/' + vId + '/hqdefault.jpg');

        }

      };

      img.onerror = function() {

        scanThumb('https://i.ytimg.com/vi/' + vId + '/mqdefault.jpg', 'https://i.ytimg.com/vi/' + vId + '/hqdefault.jpg');

      };

      img.src = sbInfo.tileUrl;

    }



    function fetchStoryboardSpec(videoId) {

      return fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {

        method: 'POST',

        headers: {

          'Content-Type': 'application/json',

          'User-Agent': 'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',

          'X-YouTube-Client-Name': '5',

          'X-YouTube-Client-Version': '21.02.3',

          'X-Goog-Api-Format-Version': '2'

        },

        body: JSON.stringify({

          videoId: videoId,

          context: {

            client: {

              clientName: 'IOS',

              clientVersion: '21.02.3',

              deviceMake: 'Apple',

              deviceModel: 'iPhone16,2',

              osName: 'iOS',

              osVersion: '18.3.2.22D82'

            }

          }

        })

      }).then(function(r) {

        if (!r.ok) return null;

        return r.json();

      }).then(function(res) {

        if (res && res.storyboards && res.storyboards.playerStoryboardSpecRenderer && res.storyboards.playerStoryboardSpecRenderer.spec) {

          return res.storyboards.playerStoryboardSpecRenderer.spec;

        }

        return null;

      }).catch(function() {

        return null;

      });

    }



    if (passedSpec) {

      var sb = parseStoryboardSpec(passedSpec);

      if (sb) {

        scanStoryboardTile(sb);

        return;

      }

    }



    fetchStoryboardSpec(vId).then(function(spec) {

      if (spec) {

        var sb = parseStoryboardSpec(spec);

        if (sb) {

          scanStoryboardTile(sb);

          return;

        }

      }

      scanThumb('https://i.ytimg.com/vi/' + vId + '/mqdefault.jpg', 'https://i.ytimg.com/vi/' + vId + '/hqdefault.jpg');

    }).catch(function() {

      scanThumb('https://i.ytimg.com/vi/' + vId + '/mqdefault.jpg', 'https://i.ytimg.com/vi/' + vId + '/hqdefault.jpg');

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

