package com.DME;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONObject;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * PoTokenModule.java
 *
 * Direct Native Android port of Rave Watch Party's WebPoTokenGenerator / SimplePoTokenProvider.
 * Creates an off-screen Android WebKit WebView with a native "@JavascriptInterface PoTokenWebView",
 * runs BotGuard challenge attestation on "https://www.youtube.com", acquires the Google Integrity Token
 * from GenerateIT, and mints authentic WebPO tokens (&pot=) directly on the device.
 */
public class PoTokenModule extends ReactContextBaseJavaModule {
    private static final String TAG = "PoTokenModule";
    private static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    private static final String GOOGLE_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
    private static final String REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

    /**
     * Most recently minted PO-Token, cached statically so MainApplication's OkHttp interceptor
     * can defensively inject it onto ExoPlayer DASH chunk requests that are missing the pot param.
     */
    public static volatile String cachedPoToken = null;

    private static final String PO_TOKEN_HTML = "<!DOCTYPE html>\n" +
        "<html>\n" +
        "<head>\n" +
        "<script src=\"https://www.youtube.com/s/player/meriyah.umd.min.js?v=20261012\"></script>\n" +
        "<script src=\"https://www.youtube.com/s/player/youtubejs.extractor.js?v=20261012\"></script>\n" +
        "<script>\n" +
        "function loadBotGuard(challengeData) {\n" +
        "  this.vm = this[challengeData.globalName];\n" +
        "  this.program = challengeData.program;\n" +
        "  this.vmFunctions = {};\n" +
        "  this.syncSnapshotFunction = null;\n" +
        "  if (!this.vm) throw new Error('[BotGuardClient]: VM not found in global');\n" +
        "  if (!this.vm.a) throw new Error('[BotGuardClient]: Could not load program');\n" +
        "  var vmFunctionsCallback = function(asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) {\n" +
        "    this.vmFunctions = {\n" +
        "      asyncSnapshotFunction: asyncSnapshotFunction,\n" +
        "      shutdownFunction: shutdownFunction,\n" +
        "      passEventFunction: passEventFunction,\n" +
        "      checkCameraFunction: checkCameraFunction\n" +
        "    };\n" +
        "  };\n" +
        "  this.syncSnapshotFunction = this.vm.a(this.program, vmFunctionsCallback, true, this.userInteractionElement, function() {}, [ [], [] ])[0];\n" +
        "  return new Promise(function(resolve, reject) {\n" +
        "    var i = 0;\n" +
        "    var refreshIntervalId = setInterval(function() {\n" +
        "      if (!!this.vmFunctions.asyncSnapshotFunction) {\n" +
        "        resolve(this);\n" +
        "        clearInterval(refreshIntervalId);\n" +
        "      }\n" +
        "      if (i >= 10000) {\n" +
        "        reject('asyncSnapshotFunction is null even after 10 seconds');\n" +
        "        clearInterval(refreshIntervalId);\n" +
        "      }\n" +
        "      i += 1;\n" +
        "    }, 1);\n" +
        "  });\n" +
        "}\n" +
        "function snapshot(args) {\n" +
        "  return new Promise(function(resolve, reject) {\n" +
        "    if (!this.vmFunctions.asyncSnapshotFunction)\n" +
        "      return reject(new Error('[BotGuardClient]: Async snapshot function not found'));\n" +
        "    this.vmFunctions.asyncSnapshotFunction(function(response) { resolve(response); }, [\n" +
        "      args.contentBinding,\n" +
        "      args.signedTimestamp,\n" +
        "      args.webPoSignalOutput,\n" +
        "      args.skipPrivacyBuffer\n" +
        "    ]);\n" +
        "  });\n" +
        "}\n" +
        "function runBotGuard(challengeData) {\n" +
        "  var interpreterJavascript = challengeData.interpreterJavascript;\n" +
        "  if (interpreterJavascript) {\n" +
        "    new Function(interpreterJavascript)();\n" +
        "  } else throw new Error('Could not load VM');\n" +
        "  var webPoSignalOutput = [];\n" +
        "  return loadBotGuard({\n" +
        "    globalName: challengeData.globalName,\n" +
        "    globalObj: this,\n" +
        "    program: challengeData.program\n" +
        "  }).then(function(botguard) {\n" +
        "    return botguard.snapshot({ webPoSignalOutput: webPoSignalOutput });\n" +
        "  }).then(function(botguardResponse) {\n" +
        "    return { webPoSignalOutput: webPoSignalOutput, botguardResponse: botguardResponse };\n" +
        "  });\n" +
        "}\n" +
        "window.__mintCallback = window.__mintCallback || null;\n" +
        "window.__mintCallbackToken = window.__mintCallbackToken || null;\n" +
        "function base64ToU8(base64) {\n" +
        "  if (base64 instanceof Uint8Array) return base64;\n" +
        "  var binary = atob(String(base64).replace(/-/g, '+').replace(/_/g, '/'));\n" +
        "  var u8 = new Uint8Array(binary.length);\n" +
        "  for (var i = 0; i < binary.length; i++) {\n" +
        "    u8[i] = binary.charCodeAt(i);\n" +
        "  }\n" +
        "  return u8;\n" +
        "}\n" +
        "function stringToU8(str) {\n" +
        "  if (str instanceof Uint8Array) return str;\n" +
        "  if (!str) return new Uint8Array(0);\n" +
        "  if (typeof TextEncoder !== 'undefined') {\n" +
        "    return new TextEncoder().encode(str);\n" +
        "  }\n" +
        "  var u8 = new Uint8Array(str.length);\n" +
        "  for (var i = 0; i < str.length; i++) {\n" +
        "    u8[i] = str.charCodeAt(i) & 0xff;\n" +
        "  }\n" +
        "  return u8;\n" +
        "}\n" +
        "function obtainPoToken(webPoSignalOutput, integrityToken, identifier) {\n" +
        "  var getMinter = webPoSignalOutput ? webPoSignalOutput[0] : null;\n" +
        "  if (!getMinter) throw new Error('PMD:Undefined');\n" +
        "  var tokenU8 = (integrityToken instanceof Uint8Array) ? integrityToken : base64ToU8(integrityToken);\n" +
        "  var idU8 = (identifier instanceof Uint8Array) ? identifier : stringToU8(identifier);\n" +
        "  var tokenKey = tokenU8.length + ':' + tokenU8[0] + ':' + tokenU8[tokenU8.length - 1];\n" +
        "  if (!window.__mintCallback || window.__mintCallbackToken !== tokenKey) {\n" +
        "    window.__mintCallback = getMinter(tokenU8);\n" +
        "    window.__mintCallbackToken = tokenKey;\n" +
        "  }\n" +
        "  var mintCallback = window.__mintCallback;\n" +
        "  if (!(mintCallback instanceof Function)) throw new Error('APF:Failed');\n" +
        "  var result = mintCallback(idU8);\n" +
        "  if (!result) throw new Error('YNJ:Undefined');\n" +
        "  if (!(result instanceof Uint8Array)) throw new Error('ODM:Invalid');\n" +
        "  return result;\n" +
        "}\n" +
        "</script>\n" +
        "</head>\n" +
        "<body></body>\n" +
        "</html>";

    private final ReactApplicationContext mContext;
    private final OkHttpClient mHttpClient;
    private WebView mWebView;
    private boolean mIsWebViewLoaded = false;
    private boolean mIsAttestationInProgress = false;

    private String mIntegrityToken = null;
    private long mExpirationInstant = 0; // Epoch millis
    private volatile String mYtcfgJson = null;

    private final Map<String, String> mCachedTokens = new ConcurrentHashMap<>();
    private final Map<String, List<Promise>> mPendingPromises = new HashMap<>();

    private volatile String mPreparedPlayerUrl = null;
    private volatile boolean mIsPlayerPrepared = false;
    private volatile String mPreparedUrlClass = null;
    private volatile String mPreparedDecipherFn = null;

    public PoTokenModule(ReactApplicationContext context) {
        super(context);
        this.mContext = context;
        this.mHttpClient = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();

        // Initialize WebView eagerly on UI thread
        new Handler(Looper.getMainLooper()).post(this::initWebViewOnMainThread);
    }

    @Override
    public String getName() {
        return "PoTokenModule";
    }

    private final List<Promise> mPlayerPreparePromises = new ArrayList<>();

    private void initWebViewOnMainThread() {
        try {
            if (mWebView != null) return;
            Log.i(TAG, "Initializing native PoToken WebView...");
            mWebView = new WebView(mContext);
            mWebView.clearCache(true);
            WebSettings settings = mWebView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setUserAgentString(DESKTOP_UA);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

            mWebView.setWebViewClient(new WebViewClient() {
                private WebResourceResponse createJsResponse(java.io.InputStream is) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                    headers.put("Access-Control-Allow-Headers", "*");
                    headers.put("Cache-Control", "no-cache, no-store, must-revalidate");
                    headers.put("Pragma", "no-cache");
                    headers.put("Expires", "0");
                    return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK", headers, is);
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (uri != null && uri.getPath() != null) {
                        String path = uri.getPath();
                        if (path.contains("meriyah.umd.min.js")) {
                            try {
                                Log.i(TAG, "⚡ Serving meriyah asset freshly from APK assets");
                                return createJsResponse(mContext.getAssets().open("meriyah.umd.min.js"));
                            } catch (Exception e) {
                                Log.e(TAG, "Error serving meriyah asset: " + e.getMessage());
                            }
                        }
                        if (path.contains("youtubejs.extractor.js")) {
                            try {
                                Log.i(TAG, "⚡ Serving freshly intercepted youtubejs.extractor asset from APK assets");
                                return createJsResponse(mContext.getAssets().open("youtubejs.extractor.js"));
                            } catch (Exception e) {
                                Log.e(TAG, "Error serving youtubejs.extractor asset: " + e.getMessage());
                            }
                        }
                        if (path.contains("injected_base.js")) {
                            try {
                                File localFile = new File(mContext.getFilesDir(), "injected_base.js");
                                if (localFile.exists()) {
                                    Log.i(TAG, "Serving intercepted player JS (" + localFile.length() + " bytes) with CORS headers");
                                    return createJsResponse(new FileInputStream(localFile));
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error serving intercepted player JS: " + e.getMessage(), e);
                            }
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }
            });

            mWebView.addJavascriptInterface(new PoTokenInterface(), "PoTokenWebView");

            // ── Strip YouTube account cookies before BotGuard loads ──────────────────
            // If the user is logged in to YouTube in the Discovery WebView, the shared
            // Android CookieManager holds account cookies (SAPISID, SID, LOGIN_INFO…).
            // BotGuard sees those cookies and produces an 811-char account-bound token
            // instead of the normal 127-char visitor-bound token.  The CDN then requires
            // matching account cookies on every chunk request – which ExoPlayer/OkHttp
            // never sends – causing HTTP 403 at ~60 s.
            // Solution: clear only the YouTube auth cookies here so BotGuard always runs
            // as an anonymous visitor.  The Discovery WebView is a separate instance and
            // is completely unaffected by this call.
            clearYouTubeAuthCookies();

            mWebView.loadDataWithBaseURL("https://www.youtube.com", PO_TOKEN_HTML, "text/html", "UTF-8", null);
            mIsWebViewLoaded = true;
            Log.i(TAG, "Native PoToken WebView initialized successfully with base URL https://www.youtube.com");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize native PoToken WebView: " + e.getMessage(), e);
        }
    }

    /**
     * Strips YouTube account-identifying cookies from Android's shared CookieManager so that
     * the PoToken BotGuard WebView always generates an anonymous visitor-bound token (~127 chars).
     *
     * Cookies cleared: SAPISID, __Secure-1PAPISID, __Secure-3PAPISID,
     *                  SSID, HSID, SID, __Secure-1PSID, __Secure-3PSID,
     *                  LOGIN_INFO, PREF, YSC (session-bound).
     *
     * The Discovery WebView (separate instance) is NOT affected – it retains its own
     * in-memory cookie state and will keep the user logged in for browsing.
     */
    private void clearYouTubeAuthCookies() {
        try {
            CookieManager cm = CookieManager.getInstance();
            String[] ytDomains = {
                "https://www.youtube.com",
                "https://youtube.com",
                "https://m.youtube.com",
                "https://accounts.google.com"
            };
            // Auth cookies that cause account-bound token generation
            String[] authCookies = {
                "SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID",
                "SSID", "HSID",
                "SID", "__Secure-1PSID", "__Secure-3PSID",
                "LOGIN_INFO", "YSC"
            };
            for (String domain : ytDomains) {
                for (String name : authCookies) {
                    // Setting max-age=0 / expires=past effectively deletes the cookie
                    cm.setCookie(domain, name + "=; Max-Age=0; Path=/; Secure");
                }
            }
            cm.flush();
            Log.i(TAG, "✅ Cleared YouTube auth cookies — PoToken WebView will run as anonymous visitor");
        } catch (Exception e) {
            Log.w(TAG, "clearYouTubeAuthCookies: " + e.getMessage());
        }
    }

    public class PoTokenInterface {
        @JavascriptInterface
        public void onPlayerPreparedResult(boolean ready, String clsName) {
            Log.i(TAG, "onPlayerPreparedResult: ready=" + ready + ", clsName=" + clsName);
            mIsPlayerPrepared = ready;
            if (clsName != null && !clsName.isEmpty()) {
                mPreparedUrlClass = clsName;
            }
            synchronized (mPlayerPreparePromises) {
                for (Promise p : mPlayerPreparePromises) {
                    p.resolve(ready);
                }
                mPlayerPreparePromises.clear();
            }
        }

        @JavascriptInterface
        public void onRunBotguardResult(String botguardResponse) {
            Log.d(TAG, "BotGuard snapshot ok (" + (botguardResponse != null ? botguardResponse.length() : 0) + "ch) - calling GenerateIT");
            callGenerateIT(botguardResponse);
        }

        @JavascriptInterface
        public void onObtainPoTokenResult(String identifier, String poTokenU8String) {
            try {
                String[] parts = poTokenU8String.split(",");
                byte[] bytes = new byte[parts.length];
                for (int i = 0; i < parts.length; i++) {
                    bytes[i] = (byte) Integer.parseInt(parts[i].trim());
                }
                String poToken = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                Log.d(TAG, "Successfully minted PO-token for [" + identifier + "]: " + poToken);
                onTokenSuccess(identifier, poToken);
            } catch (Exception e) {
                Log.e(TAG, "Failed to encode poTokenU8: " + e.getMessage(), e);
                onTokenError(identifier, "Encode error: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void onObtainPoTokenError(String identifier, String error) {
            Log.e(TAG, "onObtainPoTokenError for [" + identifier + "]: " + error);
            onTokenError(identifier, error);
        }

        @JavascriptInterface
        public void onJsInitializationError(String error) {
            Log.e(TAG, "onJsInitializationError: " + error);
            onGlobalError(error);
        }
    }

    @ReactMethod
    public void setYtConfig(String ytcfgJson) {
        if (ytcfgJson != null && !ytcfgJson.isEmpty()) {
            this.mYtcfgJson = ytcfgJson;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (mWebView != null) {
                    try {
                        mWebView.evaluateJavascript("try { window.yt = Object.assign(window.yt || {}, { config_: " + ytcfgJson + " }); } catch(e) {}", null);
                        Log.d(TAG, "Seeded ytcfg into native WebView for EVENT_ID binding");
                    } catch (Exception e) {
                        Log.w(TAG, "Failed to seed ytcfg: " + e.getMessage());
                    }
                }
            });
        }
    }

    @ReactMethod
    public void setCachedPoToken(String token) {
        if (token != null && !token.isEmpty()) {
            cachedPoToken = token;
            mCachedTokens.put("_latest", token);
            Log.d(TAG, "Cached PO-token updated from JS: " + token.substring(0, Math.min(16, token.length())) + "...");
        }
    }

    private String unquoteJsResult(String value) {
        if (value == null) return null;
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
            value = value.substring(1, value.length() - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\");
        }
        return value;
    }

    @ReactMethod
    public void preparePlayer(String playerUrl, Promise promise) {
        if (playerUrl == null || playerUrl.isEmpty()) {
            promise.reject("INVALID_URL", "playerUrl is empty");
            return;
        }

        if (mIsPlayerPrepared && playerUrl.equals(mPreparedPlayerUrl)) {
            Log.i(TAG, "Player already prepared natively: " + playerUrl);
            promise.resolve(true);
            return;
        }

        synchronized (mPlayerPreparePromises) {
            mPlayerPreparePromises.add(promise);
            if (mPlayerPreparePromises.size() > 1) {
                // Another thread is already preparing the player, await result
                return;
            }
        }

        new Thread(() -> {
            try {
                Log.i(TAG, "Fetching player JS for native preparation: " + playerUrl);
                Request req = new Request.Builder()
                    .url(playerUrl)
                    .header("User-Agent", DESKTOP_UA)
                    .build();
                Response resp = mHttpClient.newCall(req).execute();
                if (!resp.isSuccessful()) {
                    synchronized (mPlayerPreparePromises) {
                        for (Promise p : mPlayerPreparePromises) {
                            p.reject("HTTP_ERR", "Failed to fetch player: " + resp.code());
                        }
                        mPlayerPreparePromises.clear();
                    }
                    return;
                }
                String code = resp.body().string();
                mPreparedPlayerUrl = playerUrl;

                // Save player JS locally to avoid Binder IPC limits and load via intercepted fetch
                File localFile = new File(mContext.getFilesDir(), "injected_base.js");
                try (FileOutputStream fos = new FileOutputStream(localFile)) {
                    fos.write(code.getBytes(StandardCharsets.UTF_8));
                }
                Log.i(TAG, "Saved player JS to " + localFile.getAbsolutePath() + " (" + localFile.length() + " bytes)");

                new Handler(Looper.getMainLooper()).post(() -> {
                    if (mWebView == null) {
                        synchronized (mPlayerPreparePromises) {
                            for (Promise p : mPlayerPreparePromises) {
                                p.reject("WEBVIEW_NULL", "Native WebView is null");
                            }
                            mPlayerPreparePromises.clear();
                        }
                        return;
                    }
                    String loadScript = "(function() {\n" +
                        "  function doPreprocess(playerSource, retries) {\n" +
                        "    if (!window.YT_PREPROCESS || typeof window.YT_PREPROCESS.preprocessAndEval !== 'function') {\n" +
                        "      if (retries > 0) {\n" +
                        "        setTimeout(function() { doPreprocess(playerSource, retries - 1); }, 150);\n" +
                        "        return;\n" +
                        "      }\n" +
                        "      PoTokenWebView.onPlayerPreparedResult(false, 'YT_PREPROCESS not available in WebView');\n" +
                        "      return;\n" +
                        "    }\n" +
                        "    try {\n" +
                        "      window.YT_PREPROCESS.preprocessAndEval(playerSource);\n" +
                        "      var ready = Boolean(window._yt_result && typeof window._yt_result.n === 'function');\n" +
                        "      PoTokenWebView.onPlayerPreparedResult(ready, ready ? 'rave_meriyah_ready' : 'missing_n_function');\n" +
                        "    } catch(err) {\n" +
                        "      PoTokenWebView.onPlayerPreparedResult(false, 'preprocess_err: ' + String(err));\n" +
                        "    }\n" +
                        "  }\n" +
                        "  function loadViaXhr() {\n" +
                        "    var xhr = new XMLHttpRequest();\n" +
                        "    xhr.open('GET', 'https://www.youtube.com/s/player/injected_base.js?t=' + Date.now(), true);\n" +
                        "    xhr.onload = function() {\n" +
                        "      if (xhr.status === 200 && xhr.responseText && xhr.responseText.length > 1000) {\n" +
                        "        doPreprocess(xhr.responseText, 20);\n" +
                        "      } else {\n" +
                        "        loadViaFetch();\n" +
                        "      }\n" +
                        "    };\n" +
                        "    xhr.onerror = function() { loadViaFetch(); };\n" +
                        "    xhr.send();\n" +
                        "  }\n" +
                        "  function loadViaFetch() {\n" +
                        "    fetch('https://www.youtube.com/s/player/injected_base.js?t=' + Date.now())\n" +
                        "      .then(function(r) { return r.text(); })\n" +
                        "      .then(function(src) { doPreprocess(src, 20); })\n" +
                        "      .catch(function(err) { PoTokenWebView.onPlayerPreparedResult(false, 'load_error: ' + String(err)); });\n" +
                        "  }\n" +
                        "  loadViaXhr();\n" +
                        "})();";
                    mWebView.evaluateJavascript(loadScript, null);
                });
            } catch (Exception e) {
                Log.e(TAG, "preparePlayer failed: " + e.getMessage(), e);
                synchronized (mPlayerPreparePromises) {
                    for (Promise p : mPlayerPreparePromises) {
                        p.reject("PREPARE_ERR", e.getMessage());
                    }
                    mPlayerPreparePromises.clear();
                }
            }
        }).start();
    }

    @ReactMethod
    public void decipherFormats(ReadableArray items, Promise promise) {
        if (items == null || items.size() == 0) {
            promise.resolve(Arguments.createArray());
            return;
        }
        try {
            JSONArray jsonItems = new JSONArray();
            for (int i = 0; i < items.size(); i++) {
                ReadableMap map = items.getMap(i);
                JSONObject obj = new JSONObject();
                obj.put("itag", map.hasKey("itag") ? map.getInt("itag") : 0);
                obj.put("url", map.hasKey("url") ? map.getString("url") : (map.hasKey("rawUrl") ? map.getString("rawUrl") : ""));
                obj.put("rawUrl", map.hasKey("rawUrl") ? map.getString("rawUrl") : (map.hasKey("url") ? map.getString("url") : ""));
                obj.put("n", map.hasKey("n") ? map.getString("n") : JSONObject.NULL);
                obj.put("sig", map.hasKey("sig") ? map.getString("sig") : JSONObject.NULL);
                obj.put("sp", map.hasKey("sp") ? map.getString("sp") : "sig");
                obj.put("isCipher", map.hasKey("isCipher") && map.getBoolean("isCipher"));
                jsonItems.put(obj);
            }

            String itemsJson = jsonItems.toString();

            String script = "(function() {\n" +
                "  try {\n" +
                "    if (!window.YT_PREPROCESS || typeof window.YT_PREPROCESS.decipher !== 'function') {\n" +
                "      return JSON.stringify({ error: 'YT_PREPROCESS.decipher not ready' });\n" +
                "    }\n" +
                "    return window.YT_PREPROCESS.decipher(" + JSONObject.quote(itemsJson) + ");\n" +
                "  } catch(err) {\n" +
                "    return JSON.stringify({ error: String(err) });\n" +
                "  }\n" +
                "})();";

            new Handler(Looper.getMainLooper()).post(() -> {
                if (mWebView == null) {
                    promise.reject("WEBVIEW_NULL", "Native WebView is null");
                    return;
                }
                mWebView.evaluateJavascript(script, rawVal -> {
                    try {
                        String unquoted = unquoteJsResult(rawVal);
                        if (unquoted == null || unquoted.isEmpty() || "null".equals(unquoted)) {
                            promise.reject("DECIPHER_ERR", "evaluateJavascript returned null");
                            return;
                        }
                        if (unquoted.trim().startsWith("{")) {
                            JSONObject errObj = new JSONObject(unquoted);
                            if (errObj.has("error")) {
                                promise.reject("JS_ERR", errObj.getString("error"));
                                return;
                            }
                        }
                        JSONArray arr = new JSONArray(unquoted);
                        WritableArray outArray = Arguments.createArray();
                        for (int j = 0; j < arr.length(); j++) {
                            JSONObject r = arr.getJSONObject(j);
                            WritableMap map = Arguments.createMap();
                            int itag = r.getInt("itag");
                            map.putInt("itag", itag);
                            String newN = (r.has("newN") && !r.isNull("newN")) ? r.getString("newN") : null;
                            String newSig = (r.has("newSig") && !r.isNull("newSig")) ? r.getString("newSig") : null;
                            if (newN != null) {
                                map.putString("newN", newN);
                            } else {
                                map.putNull("newN");
                            }
                            if (newSig != null) {
                                map.putString("newSig", newSig);
                            } else {
                                map.putNull("newSig");
                            }
                            outArray.pushMap(map);

                            String rawN = (j < jsonItems.length()) ? jsonItems.getJSONObject(j).optString("n") : null;
                            if (j == 0 || itag == 140 || itag == 137 || itag == 136 || itag == 299) {
                                boolean isTransformed = (newN != null && rawN != null && !rawN.isEmpty() && !newN.equals(rawN));
                                Log.i(TAG, "⚡ [MeriyahDecipher] itag=" + itag + ": rawN=" + rawN + " -> newN=" + newN + " (isTransformed=" + isTransformed + ", newSig=" + (newSig != null ? newSig.substring(0, Math.min(10, newSig.length())) + "..." : "null") + ")");
                            }
                        }
                        String sampleLog = (arr.length() > 0) ? "sample itag=" + arr.getJSONObject(0).optInt("itag") + ", newN=" + arr.getJSONObject(0).optString("newN") : "empty";
                        Log.i(TAG, "Deciphered " + outArray.size() + " formats via Rave Meriyah extractor (" + sampleLog + ")");
                        promise.resolve(outArray);
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to parse decipher result: " + e.getMessage() + ", rawVal: " + rawVal, e);
                        promise.reject("PARSE_ERR", e.getMessage());
                    }
                });
            });
        } catch (Exception e) {
            Log.e(TAG, "decipherFormats error: " + e.getMessage(), e);
            promise.reject("DECIPHER_ERR", e.getMessage());
        }
    }

    @ReactMethod
    public void fetchMobileWatchPageHtml(String videoId, Promise promise) {
        if (videoId == null || videoId.isEmpty()) {
            promise.reject("INVALID_ID", "videoId is empty");
            return;
        }
        new Thread(() -> {
            try {
                String url = "https://m.youtube.com/watch?v=" + videoId + "&hl=en";
                Request req = new Request.Builder()
                    .url(url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .build();
                Response resp = mHttpClient.newCall(req).execute();
                if (!resp.isSuccessful()) {
                    promise.reject("HTTP_ERR", "Watch page fetch failed: " + resp.code());
                    return;
                }
                String body = resp.body().string();
                Log.i(TAG, "fetchMobileWatchPageHtml succeeded: " + body.length() + " bytes");
                promise.resolve(body);
            } catch (Exception e) {
                Log.e(TAG, "fetchMobileWatchPageHtml failed: " + e.getMessage(), e);
                promise.reject("FETCH_ERR", e.getMessage());
            }
        }).start();
    }

    @ReactMethod
    public void extractWatchPageData(String videoId, Promise promise) {
        if (videoId == null || videoId.isEmpty()) {
            promise.reject("INVALID_ID", "videoId is empty");
            return;
        }
        new Thread(() -> {
            try {
                String url = "https://m.youtube.com/watch?v=" + videoId + "&hl=en";
                Request req = new Request.Builder()
                    .url(url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .build();
                Response resp = mHttpClient.newCall(req).execute();
                if (!resp.isSuccessful()) {
                    promise.reject("HTTP_ERR", "Watch page fetch failed: " + resp.code());
                    return;
                }
                String html = resp.body().string();
                Log.i(TAG, "extractWatchPageData fetched HTML: " + html.length() + " bytes");

                // 1. Extract player base.js URL
                String playerUrl = null;
                Matcher playerMatcher = Pattern.compile("(/s/player/[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*/base\\.js)").matcher(html);
                if (playerMatcher.find()) {
                    playerUrl = "https://www.youtube.com" + playerMatcher.group(1);
                    Log.i(TAG, "extractWatchPageData found player URL: " + playerUrl);
                }

                // 2. Extract ytcfg and seed to WebView for EVENT_ID binding
                Matcher ytcfgMatcher = Pattern.compile("ytcfg\\.set\\s*\\(\\s*(\\{.+?\\})\\s*\\)\\s*;").matcher(html);
                if (ytcfgMatcher.find()) {
                    String ytcfg = ytcfgMatcher.group(1);
                    mYtcfgJson = ytcfg;
                    new Handler(Looper.getMainLooper()).post(() -> {
                        if (mWebView != null) {
                            try {
                                mWebView.evaluateJavascript("try { window.yt = Object.assign(window.yt || {}, { config_: " + ytcfg + " }); } catch(e) {}", null);
                            } catch (Exception ignored) {}
                        }
                    });
                }

                // 3. Extract visitorData
                String visitorData = null;
                Matcher visitorMatcher = Pattern.compile("\"(?:VISITOR_DATA|visitorData)\":\\s*\"([^\"]+)\"").matcher(html);
                if (visitorMatcher.find()) {
                    visitorData = visitorMatcher.group(1);
                }

                // 3b. Extract STS (signatureTimestamp)
                String sts = null;
                Matcher stsMatcher = Pattern.compile("\"STS\":\\s*(\\d+)").matcher(html);
                if (stsMatcher.find()) {
                    sts = stsMatcher.group(1);
                    Log.i(TAG, "extractWatchPageData found STS: " + sts);
                }

                // 4. Extract ytInitialPlayerResponse occurrences
                // Pick the occurrence that contains "adaptiveFormats" and has the largest format count
                String bestPlayerResponseJson = null;
                int maxFormats = 0;
                String marker = "ytInitialPlayerResponse";
                int pos = 0;
                while ((pos = html.indexOf(marker, pos)) != -1) {
                    int start = html.indexOf('{', pos);
                    if (start != -1 && (start - pos) < 120) {
                        String jsonStr = extractBalancedJson(html, start);
                        if (jsonStr != null) {
                            try {
                                JSONObject p = new JSONObject(jsonStr);
                                if (p.has("streamingData")) {
                                    JSONObject sd = p.getJSONObject("streamingData");
                                    int count = (sd.has("adaptiveFormats") ? sd.getJSONArray("adaptiveFormats").length() : 0)
                                              + (sd.has("formats") ? sd.getJSONArray("formats").length() : 0);
                                    if (count > maxFormats) {
                                        maxFormats = count;
                                        bestPlayerResponseJson = p.toString();
                                    }
                                }
                            } catch (Exception ignored) {}
                        }
                    }
                    pos += marker.length();
                }

                String streamingDataJson = "";
                if (bestPlayerResponseJson != null && maxFormats > 0) {
                    try {
                        JSONObject bp = new JSONObject(bestPlayerResponseJson);
                        if (bp.has("streamingData")) {
                            streamingDataJson = bp.getJSONObject("streamingData").toString();
                        }
                    } catch (Exception ignored) {}
                }

                WritableMap map = Arguments.createMap();
                map.putString("playerResponseJson", bestPlayerResponseJson != null ? bestPlayerResponseJson : "");
                map.putString("streamingDataJson", streamingDataJson);
                map.putString("playerUrl", playerUrl != null ? playerUrl : "");
                map.putString("visitorData", visitorData != null ? visitorData : "");
                map.putString("sts", sts != null ? sts : "");
                map.putInt("formatCount", maxFormats);
                Log.i(TAG, "extractWatchPageData resolved: maxFormats=" + maxFormats + ", playerUrl=" + playerUrl + ", sts=" + sts);
                promise.resolve(map);

            } catch (Exception e) {
                Log.e(TAG, "extractWatchPageData failed: " + e.getMessage(), e);
                promise.reject("EXTRACT_ERR", e.getMessage());
            }
        }).start();
    }

    private String extractBalancedJson(String str, int startIndex) {
        int depth = 0;
        boolean inString = false;
        boolean escape = false;
        char quoteChar = 0;
        for (int i = startIndex; i < str.length(); i++) {
            char c = str.charAt(i);
            if (escape) { escape = false; continue; }
            if (c == '\\') { escape = true; continue; }
            if (inString) {
                if (c == quoteChar) inString = false;
                continue;
            }
            if (c == '"' || c == '\'') {
                inString = true;
                quoteChar = c;
                continue;
            }
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) return str.substring(startIndex, i + 1);
            }
        }
        return null;
    }

    @ReactMethod
    public void getPoToken(String identifier, Promise promise) {
        final String safeId = (identifier != null) ? identifier : "";
        long now = System.currentTimeMillis();

        // 1. Check cached token for this specific identifier
        if (mCachedTokens.containsKey(safeId) && now < mExpirationInstant) {
            promise.resolve(mCachedTokens.get(safeId));
            return;
        }

        synchronized (mPendingPromises) {
            List<Promise> list = mPendingPromises.get(safeId);
            if (list == null) {
                list = new ArrayList<>();
                mPendingPromises.put(safeId, list);
            }
            list.add(promise);
        }

        // 2. If we already have a valid integrity token, mint directly in WebView
        if (mIntegrityToken != null && now < mExpirationInstant) {
            mintTokenInWebView(safeId);
            return;
        }

        // 3. Otherwise start full attestation cycle (only once concurrently)
        if (!mIsAttestationInProgress) {
            mIsAttestationInProgress = true;
            startAttestationCycle();
        }
    }

    private void startAttestationCycle() {
        Log.d(TAG, "Starting BotGuard attestation cycle via att/get...");
        try {
            JSONObject contextClient = new JSONObject();
            contextClient.put("clientName", "WEB");
            contextClient.put("clientVersion", "2.20250520.04.00");
            contextClient.put("hl", "en-GB");
            contextClient.put("gl", "GB");
            contextClient.put("platform", "DESKTOP");
            contextClient.put("clientScreen", "WATCH");
            contextClient.put("utcOffsetMinutes", 0);

            JSONObject contextRequest = new JSONObject();
            contextRequest.put("useSsl", true);
            contextRequest.put("internalExperimentFlags", new JSONArray());

            JSONObject contextUser = new JSONObject();
            contextUser.put("lockedSafetyMode", false);

            JSONObject contextObj = new JSONObject();
            contextObj.put("client", contextClient);
            contextObj.put("request", contextRequest);
            contextObj.put("user", contextUser);

            JSONObject payload = new JSONObject();
            payload.put("context", contextObj);
            payload.put("engagementType", "ENGAGEMENT_TYPE_UNBOUND");

            RequestBody body = RequestBody.create(MediaType.parse("application/json"), payload.toString());
            Request request = new Request.Builder()
                .url("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false")
                .addHeader("User-Agent", DESKTOP_UA)
                .addHeader("Content-Type", "application/json")
                .addHeader("Origin", "https://www.youtube.com")
                .addHeader("X-Origin", "https://www.youtube.com")
                .post(body)
                .build();

            mHttpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "att/get network failure: " + e.getMessage(), e);
                    onGlobalError("att/get failed: " + e.getMessage());
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (!response.isSuccessful()) {
                        String errBody = response.body() != null ? response.body().string() : "";
                        Log.e(TAG, "att/get returned HTTP " + response.code() + ": " + errBody);
                        onGlobalError("att/get HTTP " + response.code() + ": " + errBody);
                        return;
                    }
                    try {
                        String respStr = response.body().string();
                        JSONObject json = new JSONObject(respStr);
                        JSONObject bg = null;
                        if (json.has("bgChallenge")) {
                            bg = json.getJSONObject("bgChallenge");
                        } else if (json.has("challenge")) {
                            JSONObject ch = json.getJSONObject("challenge");
                            if (ch.has("bgChallenge")) bg = ch.getJSONObject("bgChallenge");
                            else bg = ch;
                        } else if (json.has("challengeData")) {
                            bg = json.getJSONObject("challengeData");
                        }

                        if (bg == null) {
                            throw new Exception("No challenge object found in att/get response: " + respStr.substring(0, Math.min(respStr.length(), 200)));
                        }

                        String interpUrl = "";
                        if (bg.has("interpreterUrl")) {
                            Object interp = bg.get("interpreterUrl");
                            if (interp instanceof String) {
                                interpUrl = (String) interp;
                            } else if (interp instanceof JSONObject) {
                                JSONObject interpObj = (JSONObject) interp;
                                if (interpObj.has("privateDoNotAccessOrElseTrustedResourceUrlWrappedValue")) {
                                    interpUrl = interpObj.getString("privateDoNotAccessOrElseTrustedResourceUrlWrappedValue");
                                }
                            }
                        }
                        if (interpUrl.startsWith("//")) interpUrl = "https:" + interpUrl;
                        String program = bg.optString("program", "");
                        String globalName = bg.optString("globalName", "");

                        fetchInterpreterScript(interpUrl, program, globalName);
                    } catch (Exception e) {
                        Log.e(TAG, "Error parsing att/get challenge: " + e.getMessage(), e);
                        onGlobalError("Parse challenge error: " + e.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error building att/get request: " + e.getMessage(), e);
            onGlobalError("Build att/get error: " + e.getMessage());
        }
    }

    private void fetchInterpreterScript(String interpUrl, String program, String globalName) {
        Log.d(TAG, "Fetching BotGuard interpreter JS from " + interpUrl);
        Request request = new Request.Builder()
            .url(interpUrl)
            .addHeader("User-Agent", DESKTOP_UA)
            .get()
            .build();

        mHttpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.e(TAG, "Failed to download interpreter JS: " + e.getMessage(), e);
                onGlobalError("Download interpreter JS failed: " + e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    onGlobalError("Interpreter JS HTTP " + response.code());
                    return;
                }
                try {
                    String interpJs = response.body().string();
                    Log.d(TAG, "Interpreter JS downloaded (" + interpJs.length() + " bytes). Running BotGuard in WebView...");
                    executeRunBotguardInWebView(interpJs, program, globalName);
                } catch (Exception e) {
                    onGlobalError("Read interpreter JS error: " + e.getMessage());
                }
            }
        });
    }

    private void executeRunBotguardInWebView(String interpJs, String program, String globalName) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                JSONObject data = new JSONObject();
                data.put("interpreterJavascript", interpJs);
                data.put("program", program);
                data.put("globalName", globalName);

                String ytcfgPrefix = "";
                if (mYtcfgJson != null && !mYtcfgJson.isEmpty()) {
                    ytcfgPrefix = "  try { window.yt = Object.assign(window.yt || {}, { config_: " + mYtcfgJson + " }); } catch(_) {}\n";
                }

                String script = "try {\n" +
                    ytcfgPrefix +
                    "  var challengeData = " + data.toString() + ";\n" +
                    "  runBotGuard(challengeData).then(function(result) {\n" +
                    "    window.webPoSignalOutput = result.webPoSignalOutput;\n" +
                    "    PoTokenWebView.onRunBotguardResult(result.botguardResponse);\n" +
                    "  }, function(error) {\n" +
                    "    PoTokenWebView.onJsInitializationError(error + '\\n' + error.stack);\n" +
                    "  });\n" +
                    "} catch(error) {\n" +
                    "  PoTokenWebView.onJsInitializationError(error + '\\n' + error.stack);\n" +
                    "}\n";

                mWebView.evaluateJavascript(script, null);
            } catch (Exception e) {
                onGlobalError("executeRunBotguard error: " + e.getMessage());
            }
        });
    }

    private void callGenerateIT(String botguardResponse) {
        try {
            JSONArray bodyArray = new JSONArray();
            bodyArray.put(REQUEST_KEY);
            bodyArray.put(botguardResponse);

            RequestBody body = RequestBody.create(MediaType.parse("application/json+protobuf"), bodyArray.toString());
            Request request = new Request.Builder()
                .url("https://www.youtube.com/api/jnn/v1/GenerateIT")
                .addHeader("User-Agent", DESKTOP_UA)
                .addHeader("Content-Type", "application/json+protobuf")
                .addHeader("Accept", "application/json+protobuf")
                .addHeader("x-goog-api-key", GOOGLE_API_KEY)
                .addHeader("x-user-agent", "grpc-web-javascript/0.1")
                .post(body)
                .build();

            mHttpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "GenerateIT network failure: " + e.getMessage(), e);
                    onGlobalError("GenerateIT failed: " + e.getMessage());
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (!response.isSuccessful()) {
                        String err = response.body() != null ? response.body().string() : "";
                        Log.e(TAG, "GenerateIT HTTP " + response.code() + ": " + err);
                        onGlobalError("GenerateIT HTTP " + response.code() + ": " + err);
                        return;
                    }
                    try {
                        String bodyStr = response.body().string();
                        JSONArray jsonArr = new JSONArray(bodyStr);
                        mIntegrityToken = jsonArr.getString(0);
                        long ttl = jsonArr.optLong(1, 21600);
                        mExpirationInstant = System.currentTimeMillis() + (ttl - 600) * 1000L;
                        mIsAttestationInProgress = false;

                        Log.d(TAG, "Integrity token acquired, ttl=" + ttl + "s");

                        byte[] integrityBytes = Base64.decode(mIntegrityToken, Base64.DEFAULT);
                        StringBuilder sb = new StringBuilder("window.integrityToken = new Uint8Array([");
                        for (int i = 0; i < integrityBytes.length; i++) {
                            if (i > 0) sb.append(",");
                            sb.append(integrityBytes[i] & 0xFF);
                        }
                        sb.append("]);");
                        final String setTokenJs = sb.toString();

                        new Handler(Looper.getMainLooper()).post(() -> {
                            mWebView.evaluateJavascript(setTokenJs, null);
                            // Process all queued token requests
                            flushAllPendingRequests();
                        });
                    } catch (Exception e) {
                        Log.e(TAG, "GenerateIT parse error: " + e.getMessage(), e);
                        onGlobalError("GenerateIT parse error: " + e.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            onGlobalError("callGenerateIT error: " + e.getMessage());
        }
    }

    private void flushAllPendingRequests() {
        List<String> ids;
        synchronized (mPendingPromises) {
            ids = new ArrayList<>(mPendingPromises.keySet());
        }
        for (String id : ids) {
            mintTokenInWebView(id);
        }
    }

    private void mintTokenInWebView(String identifier) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                String script = "try {\n" +
                    "  var u8Id = stringToU8(" + JSONObject.quote(identifier) + ");\n" +
                    "  var poTokenU8 = obtainPoToken(window.webPoSignalOutput, window.integrityToken, u8Id);\n" +
                    "  var poTokenU8String = '';\n" +
                    "  for (var i = 0; i < poTokenU8.length; i++) {\n" +
                    "    if (i !== 0) poTokenU8String += ',';\n" +
                    "    poTokenU8String += poTokenU8[i];\n" +
                    "  }\n" +
                    "  PoTokenWebView.onObtainPoTokenResult(" + JSONObject.quote(identifier) + ", poTokenU8String);\n" +
                    "} catch (error) {\n" +
                    "  PoTokenWebView.onObtainPoTokenError(" + JSONObject.quote(identifier) + ", error + '\\n' + error.stack);\n" +
                    "}";

                mWebView.evaluateJavascript(script, null);
            } catch (Exception e) {
                onTokenError(identifier, "evaluateJavascript error: " + e.getMessage());
            }
        });
    }

    private void onTokenSuccess(String identifier, String token) {
        mCachedTokens.put(identifier, token);
        // Update static cache so OkHttp interceptor can defensively inject pot
        // onto ExoPlayer chunk requests that are missing the param.
        cachedPoToken = token;
        List<Promise> promises;
        synchronized (mPendingPromises) {
            promises = mPendingPromises.remove(identifier);
        }
        if (promises != null) {
            for (Promise p : promises) {
                p.resolve(token);
            }
        }
    }

    private void onTokenError(String identifier, String error) {
        List<Promise> promises;
        synchronized (mPendingPromises) {
            promises = mPendingPromises.remove(identifier);
        }
        if (promises != null) {
            for (Promise p : promises) {
                p.reject("PO_TOKEN_ERROR", error);
            }
        }
    }

    private void onGlobalError(String error) {
        mIsAttestationInProgress = false;
        Map<String, List<Promise>> toFail;
        synchronized (mPendingPromises) {
            toFail = new HashMap<>(mPendingPromises);
            mPendingPromises.clear();
        }
        for (Map.Entry<String, List<Promise>> entry : toFail.entrySet()) {
            for (Promise p : entry.getValue()) {
                p.reject("BOTGUARD_INIT_ERROR", error);
            }
        }
    }
}
