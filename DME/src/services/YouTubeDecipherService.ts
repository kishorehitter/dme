/**
 * YouTubeDecipherService.ts
 *
 * Implements Rave Watch Party's YouTube client-side AST decipher architecture.
 * Bridges InnerTube streaming data with the headless Meriyah/YT_PREPROCESS WebView worker
 * to decipher protected signatures and transform throttled 'n' parameters, unlocking
 * genuine 720p, 1080p, 1440p, 4K, and M4A audio streams.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DecipherFormatItem {
    itag: number;
    n: string | null;
    sig: string | null;
    isCipher: boolean;
    sp?: string;
    rawUrl: string;
}

export interface DecipherResultItem {
    itag: number;
    newN: string | null;
    newSig: string | null;
    newUrl?: string | null;
}

type WorkerSendFunction = (action: string, payload?: any, timeoutMs?: number) => Promise<any>;

export const YOUTUBE_MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const YOUTUBE_DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
export const RAVE_IOS_USER_AGENT = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)';
export const RAVE_ANDROID_USER_AGENT = 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip';

const BASE_JS_CACHE_KEY = '@dme_yt_player_base_js_v4';
const BOTGUARD_VM_CACHE_KEY = '@dme_yt_botguard_vm_script_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Known reliable base.js player fallback (modern plasma player)
const FALLBACK_BASE_JS_URL = 'https://www.youtube.com/s/player/ecb23058/player-plasma-es6-en_US.vflset/base.js';

function encodeUtf8(str: string): Uint8Array {
    const utf8: number[] = [];
    for (let i = 0; i < str.length; i++) {
        let charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
            utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
        } else if (charcode < 0xd800 || charcode >= 0xe000) {
            utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
        } else {
            i++;
            charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
            utf8.push(
                0xf0 | (charcode >> 18),
                0x80 | ((charcode >> 12) & 0x3f),
                0x80 | ((charcode >> 6) & 0x3f),
                0x80 | (charcode & 0x3f)
            );
        }
    }
    return new Uint8Array(utf8);
}

function u8ToUrlSafeBase64(u8: Uint8Array): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    const len = u8.length;
    for (let i = 0; i < len; i += 3) {
        const b0 = u8[i];
        const b1 = i + 1 < len ? u8[i + 1] : 0;
        const b2 = i + 2 < len ? u8[i + 2] : 0;
        result += chars[b0 >> 2];
        result += chars[((b0 & 3) << 4) | (b1 >> 4)];
        if (i + 1 < len) result += chars[((b1 & 15) << 2) | (b2 >> 6)];
        if (i + 2 < len) result += chars[b2 & 63];
    }
    return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates an authentic Proof of Origin (PO) token based on BgUtils specification.
 * Satisfies YouTube GVS CDN verification to eliminate the 59-second cutoff.
 */
export function createColdStartToken(contentBinding: string = '', clientState: number = 1): string {
    // Content binding in WebPO is videoId (11 chars) or empty string (unbound).
    // Restrict length to prevent 1-byte packet[1] length overflow (>255 bytes).
    const safeBinding = (contentBinding && contentBinding.length <= 64) ? contentBinding : '';
    const contentBindingBytes = encodeUtf8(safeBinding);
    const timestamp = Math.floor(Date.now() / 1000);
    const randomKeys = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
    const header = randomKeys.concat([
        0, clientState
    ], [
        (timestamp >> 24) & 0xFF,
        (timestamp >> 16) & 0xFF,
        (timestamp >> 8) & 0xFF,
        timestamp & 0xFF
    ]);
    const packet = new Uint8Array(2 + header.length + contentBindingBytes.length);
    packet[0] = 34; // 0x22
    packet[1] = header.length + contentBindingBytes.length;
    packet.set(header, 2);
    packet.set(contentBindingBytes, 2 + header.length);
    const payload = packet.subarray(2);
    const keyLength = randomKeys.length;
    for (let i = keyLength; i < payload.length; i++) {
        payload[i] ^= payload[i % keyLength];
    }
    return u8ToUrlSafeBase64(packet);
}

interface SigTransform {
    type: 'reverse' | 'splice' | 'swap';
    arg?: number;
}

function parseSignatureTransforms(baseJs: string): SigTransform[] | null {
    try {
        if (!baseJs || typeof baseJs !== 'string' || baseJs.length < 1000) return null;

        let body: string | null = null;

        // Pattern 1: Broad match for the unique signature transform block (.split("") ... .join(""))
        // In YouTube player base.js, only the signature decipher function contains a split followed shortly by join
        const splitJoinMatch = baseJs.match(/\.split\(\s*["']{2}\s*\);?([\s\S]{10,600}?)\.join\(\s*["']{2}\s*\)/);
        if (splitJoinMatch && splitJoinMatch[1]) {
            body = splitJoinMatch[1];
        }

        // Pattern 2: Caller setting sig/signature on query object
        // e.g. .set("sig", func(sig)) or .set("signature", func(sig))
        if (!body) {
            const callerMatch = baseJs.match(/\.set\(\s*["'](?:signature|sig)["']\s*,\s*(?:encodeURIComponent\s*\(\s*)?([a-zA-Z0-9$]+)\s*\(/);
            if (callerMatch && callerMatch[1] && callerMatch[1] !== 'encodeURIComponent') {
                const funcName = callerMatch[1];
                const escapedName = funcName.replace(/\$/g, '\\$');
                const targetPattern = new RegExp(`(?:var\\s+|const\\s+|let\\s+|,|^|;)\\s*${escapedName}\\s*=\\s*function\\s*\\(\\s*([a-zA-Z0-9$]+)\\s*\\)\\s*\\{\\s*(?:var\\s+)?([a-zA-Z0-9$]+)\\s*=\\s*\\1\\.split\\(\\s*['"]{2}\\s*\\);?([\\s\\S]+?)(?:return\\s+)?\\2\\.join\\(\\s*['"]{2}\\s*\\);?\\s*\\}`);
                const m = baseJs.match(targetPattern);
                if (m && m[3]) {
                    body = m[3];
                }
            }
        }

        // Pattern 3: Standard function declarations containing split("") and join("")
        if (!body) {
            const funcPatterns = [
                /(?:var\s+|const\s+|let\s+|,|^|;)\s*([a-zA-Z0-9$]+)\s*=\s*function\s*\(\s*([a-zA-Z0-9$]+)\s*\)\s*\{\s*(?:var\s+)?([a-zA-Z0-9$]+)\s*=\s*\2\.split\(\s*['"]{2}\s*\);?([\s\S]+?)(?:return\s+)?\3\.join\(\s*['"]{2}\s*\);?\s*\}/,
                /function\s+([a-zA-Z0-9$]+)\s*\(\s*([a-zA-Z0-9$]+)\s*\)\s*\{\s*(?:var\s+)?([a-zA-Z0-9$]+)\s*=\s*\2\.split\(\s*['"]{2}\s*\);?([\s\S]+?)(?:return\s+)?\3\.join\(\s*['"]{2}\s*\);?\s*\}/,
                /([a-zA-Z0-9$]+)\s*:\s*function\s*\(\s*([a-zA-Z0-9$]+)\s*\)\s*\{\s*(?:var\s+)?([a-zA-Z0-9$]+)\s*=\s*\2\.split\(\s*['"]{2}\s*\);?([\s\S]+?)(?:return\s+)?\3\.join\(\s*['"]{2}\s*\);?\s*\}/,
                /([a-zA-Z0-9$]+)\s*=\s*\(\s*([a-zA-Z0-9$]+)\s*\)\s*=>\s*\{\s*(?:var\s+)?([a-zA-Z0-9$]+)\s*=\s*\2\.split\(\s*['"]{2}\s*\);?([\s\S]+?)(?:return\s+)?\3\.join\(\s*['"]{2}\s*\);?\s*\}/,
            ];
            for (const p of funcPatterns) {
                const m = baseJs.match(p);
                if (m) {
                    body = m[4] || m[3];
                    if (body) break;
                }
            }
        }

        if (!body) return null;

        // Find the helper object name (e.g. "XX.yy(a, 12)" or "XX['yy'](a, 12)")
        const helperNameMatch = body.match(/([a-zA-Z0-9$]+)(?:\.[a-zA-Z0-9$]+|\[['"][a-zA-Z0-9$]+['"]\])\s*\(/);
        if (!helperNameMatch) return null;
        const helperName = helperNameMatch[1];

        const escapedHelper = helperName.replace(/\$/g, '\\$');

        // Use balanced-brace extraction instead of a lazy regex.
        // The lazy regex [\s\S]+? stopped at the FIRST } followed by , or ; which
        // cuts off multi-method helper objects after only the first method body,
        // leaving opMap incomplete and producing wrong (or zero) transforms.
        const helperStartMatch = baseJs.match(
            new RegExp(`(?:var\\s+|const\\s+|let\\s+|[,;])\\s*${escapedHelper}\\s*=\\s*\\{`)
        );
        if (!helperStartMatch || helperStartMatch.index === undefined) return null;
        const braceOpenIdx = baseJs.indexOf('{', helperStartMatch.index + helperStartMatch[0].length - 1);
        if (braceOpenIdx === -1) return null;
        let _depth = 0;
        let braceCloseIdx = -1;
        for (let _ci = braceOpenIdx; _ci < baseJs.length; _ci++) {
            if (baseJs[_ci] === '{') _depth++;
            else if (baseJs[_ci] === '}') {
                _depth--;
                if (_depth === 0) { braceCloseIdx = _ci; break; }
            }
        }
        if (braceCloseIdx === -1) return null;
        const helperBody = baseJs.substring(braceOpenIdx + 1, braceCloseIdx);
        const opMap: Record<string, 'reverse' | 'splice' | 'swap'> = {};

        // Parse methods: supports ES5 "key: function", ES6 "key(a, b)", or arrow "key: (a, b) =>"
        const methodRegex = /([a-zA-Z0-9$]+)\s*(?::\s*function|\s*:\s*\([^)]*\)\s*=>|\s*\([^)]*\)\s*\{)([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = methodRegex.exec(helperBody)) !== null) {
            const methodName = m[1];
            const methodCode = m[2];
            if (methodCode.includes('reverse')) {
                opMap[methodName] = 'reverse';
            } else if (methodCode.includes('splice') || methodCode.includes('slice')) {
                opMap[methodName] = 'splice';
            } else {
                opMap[methodName] = 'swap';
            }
        }

        if (Object.keys(opMap).length === 0) {
            const lines = helperBody.split(/\n|,/);
            for (const line of lines) {
                const km = line.match(/([a-zA-Z0-9$]+)\s*[:(]/);
                if (km) {
                    const k = km[1];
                    if (line.includes('reverse')) opMap[k] = 'reverse';
                    else if (line.includes('splice') || line.includes('slice')) opMap[k] = 'splice';
                    else opMap[k] = 'swap';
                }
            }
        }

        const callRegex = new RegExp(`(?:${escapedHelper}\\.([a-zA-Z0-9$]+)|${escapedHelper}\\[['"]([a-zA-Z0-9$]+)['"]\\])\\s*\\([^,]+(?:,\\s*(\\d+))?\\)`, 'g');
        const transforms: SigTransform[] = [];
        while ((m = callRegex.exec(body)) !== null) {
            const methodName = m[1] || m[2];
            const op = opMap[methodName];
            const arg = m[3] ? parseInt(m[3], 10) : undefined;
            if (op) {
                transforms.push({ type: op, arg });
            }
        }

        return transforms.length > 0 ? transforms : null;
    } catch (_) {
        return null;
    }
}

function applySigTransforms(sig: string, transforms: SigTransform[]): string {
    const chars = sig.split('');
    for (const t of transforms) {
        if (t.type === 'reverse') {
            chars.reverse();
        } else if (t.type === 'splice' && typeof t.arg === 'number') {
            chars.splice(0, t.arg);
        } else if (t.type === 'swap' && typeof t.arg === 'number') {
            const c = chars[0];
            chars[0] = chars[t.arg % chars.length];
            chars[t.arg % chars.length] = c;
        }
    }
    return chars.join('');
}

class YouTubeDecipherService {
    private workerSendFn: WorkerSendFunction | null = null;
    private isWorkerReadyFlag: boolean = false;
    private isPreprocessedFlag: boolean = false;
    private currentPreprocessedPlayerUrl: string | null = null;
    private readyListeners: (() => void)[] = [];
    private memoryCachedBaseJs: string | null = null;
    private memoryCachedPlayerUrl: string | null = null;
    private memoryCachedVmScript: string | null = null;
    private memoryCachedVmScriptUrl: string | null = null;
    private preprocessingPromise: Promise<boolean> | null = null;

    // ── Pure Hermes Signature Transforms Cache ──
    private cachedSigTransforms: SigTransform[] | null = null;
    private cachedSigTransformsPlayerUrl: string | null = null;

    // ── PO-Token cache indexed by visitorData & videoId (BotGuard token, valid ~5h) ──
    private cachedPoTokens: Map<string, { token: string; visitorData: string; expiresAt: number }> = new Map();
    private poTokenPromises: Map<string, Promise<{ po_token: string; visitor_data: string }>> = new Map();
    private cachedIntegrityToken: string | null = null;
    public latestVisitorBoundToken: { token: string; visitorData: string; expiresAt: number } | null = null;

    public registerWorker(sendFn: WorkerSendFunction) {
        this.workerSendFn = sendFn;
        // Do NOT set isWorkerReadyFlag = true here.
        // It becomes true only when notifyWorkerReady() is called after the WebView sends { type: 'ready' }.
        console.log('🤖 [YouTubeDecipherService] Worker bridge registered (awaiting ready handshake)');
    }

    public unregisterWorker() {
        this.workerSendFn = null;
        this.isWorkerReadyFlag = false;
        this.isPreprocessedFlag = false;
        console.log('🤖 [YouTubeDecipherService] Worker bridge unregistered');
    }

    public notifyWorkerReady() {
        this.isWorkerReadyFlag = true;
        console.log('🤖 [YouTubeDecipherService] Worker confirmed ready by WebView handshake');
        this.readyListeners.forEach(l => {
            try { l(); } catch (_) {}
        });
        this.readyListeners = [];

        // Preemptively warm up player base.js and BotGuard PO-token so deciphering is instant on first song
        this.ensurePreprocessed().catch(err => {
            console.warn('⚠️ [YouTubeDecipherService] Preemptive player preprocess warning:', err);
        });
        this.generatePoToken().catch(err => {
            console.warn('⚠️ [YouTubeDecipherService] Preemptive PO-token warmup warning:', err);
        });
    }

    public isWorkerReady(): boolean {
        return this.isWorkerReadyFlag && this.workerSendFn !== null;
    }

    private waitForWorker(timeoutMs: number = 10000): Promise<void> {
        if (this.isWorkerReady()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.readyListeners.indexOf(onReady);
                if (idx !== -1) this.readyListeners.splice(idx, 1);
                reject(new Error(`YouTubeDecipherService: Worker failed to become ready within ${timeoutMs}ms`));
            }, timeoutMs);

            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };
            this.readyListeners.push(onReady);
        });
    }

    /**
     * Retrieves YouTube base.js from memory, AsyncStorage cache, or network.
     */
    public async getOrFetchBaseJs(videoId?: string, playerUrl?: string | null): Promise<string | null> {
        let targetUrl = playerUrl || null;

        if (this.memoryCachedBaseJs && this.memoryCachedBaseJs.length > 50000) {
            if (!targetUrl || this.memoryCachedPlayerUrl === targetUrl) {
                return this.memoryCachedBaseJs;
            }
        }

        try {
            const raw = await AsyncStorage.getItem(BASE_JS_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.code && (!targetUrl || parsed.playerUrl === targetUrl) && Date.now() - (parsed.savedAt || 0) < CACHE_TTL_MS) {
                    console.log(`🤖 [YouTubeDecipherService] Loaded base.js from local cache (${parsed.code.length} bytes, url: ${parsed.playerUrl || 'default'})`);
                    this.memoryCachedBaseJs = parsed.code;
                    this.memoryCachedPlayerUrl = parsed.playerUrl || null;
                    return parsed.code;
                }
            }
        } catch (_) {}

        if (!targetUrl && videoId) {
            try {
                const pageRes = await fetch(`https://m.youtube.com/watch?v=${videoId}`, {
                    headers: {
                        'User-Agent': YOUTUBE_MOBILE_USER_AGENT
                    }
                });
                if (pageRes.ok) {
                    const pageHtml = await pageRes.text();
                    const match = pageHtml.match(/\/s\/player\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\/base\.js/) ||
                                  pageHtml.match(/["'](\/s\/player\/[^"']+\/base\.js)["']/);
                    if (match) {
                        let matchedUrl = match[1] || match[0];
                        if (!matchedUrl.startsWith('http')) {
                            matchedUrl = 'https://www.youtube.com' + (matchedUrl.startsWith('/') ? '' : '/') + matchedUrl;
                        }
                        targetUrl = matchedUrl;
                    }
                }
            } catch (_) {}
        }

        if (!targetUrl) {
            targetUrl = FALLBACK_BASE_JS_URL;
        }

        try {
            console.log(`🤖 [YouTubeDecipherService] Downloading base.js from: ${targetUrl}`);
            const res = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
                }
            });
            if (res.ok) {
                const code = await res.text();
                if (code && code.length > 50000) {
                    console.log(`🤖 [YouTubeDecipherService] Downloaded base.js successfully (${code.length} bytes)`);
                    this.memoryCachedBaseJs = code;
                    this.memoryCachedPlayerUrl = targetUrl;
                    AsyncStorage.setItem(BASE_JS_CACHE_KEY, JSON.stringify({
                        code,
                        playerUrl: targetUrl,
                        savedAt: Date.now(),
                    })).catch(() => {});
                    return code;
                }
            }
        } catch (e: any) {
            console.warn('⚠️ [YouTubeDecipherService] Failed to download base.js:', e?.message || e);
        }

        return this.memoryCachedBaseJs;
    }

    /**
     * Retrieves BotGuard VM script from memory, AsyncStorage cache, or network.
     */
    public async getOrFetchVmScript(scriptUrl: string): Promise<string> {
        if (this.memoryCachedVmScript && this.memoryCachedVmScriptUrl === scriptUrl) {
            return this.memoryCachedVmScript;
        }

        try {
            const raw = await AsyncStorage.getItem(BOTGUARD_VM_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.code && parsed.scriptUrl === scriptUrl && Date.now() - (parsed.savedAt || 0) < CACHE_TTL_MS) {
                    this.memoryCachedVmScript = parsed.code;
                    this.memoryCachedVmScriptUrl = scriptUrl;
                    return parsed.code;
                }
            }
        } catch (_) {}

        console.log(`🤖 [YouTubeDecipherService] Downloading BotGuard VM script from: ${scriptUrl.substring(0, 70)}...`);
        const res = await fetch(scriptUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            }
        });
        if (!res.ok) throw new Error(`Failed to download VM script: HTTP ${res.status}`);
        const code = await res.text();
        this.memoryCachedVmScript = code;
        this.memoryCachedVmScriptUrl = scriptUrl;
        AsyncStorage.setItem(BOTGUARD_VM_CACHE_KEY, JSON.stringify({
            code,
            scriptUrl,
            savedAt: Date.now()
        })).catch(() => {});
        return code;
    }

    /**
     * Ensures player base.js is preprocessed by Meriyah AST in the worker.
     */
    public async ensurePreprocessed(videoId?: string, playerUrl?: string | null): Promise<boolean> {
        const targetUrl = playerUrl || this.memoryCachedPlayerUrl || FALLBACK_BASE_JS_URL;
        if (this.isPreprocessedFlag && this.currentPreprocessedPlayerUrl === targetUrl) return true;
        if (this.preprocessingPromise) return this.preprocessingPromise;

        this.preprocessingPromise = (async () => {
            await this.waitForWorker();
            const baseJs = await this.getOrFetchBaseJs(videoId, playerUrl);
            if (!baseJs) {
                throw new Error('Could not acquire YouTube player base.js');
            }

            if (baseJs && (!this.cachedSigTransforms || this.cachedSigTransformsPlayerUrl !== targetUrl)) {
                try {
                    const parsedSig = parseSignatureTransforms(baseJs);
                    if (parsedSig && parsedSig.length > 0) {
                        this.cachedSigTransforms = parsedSig;
                        this.cachedSigTransformsPlayerUrl = targetUrl;
                        console.log(`🤖 [YouTubeDecipherService] Preemptively parsed ${parsedSig.length} Hermes signature operations`);
                    }
                } catch (_) {}
            }

            console.log('🤖 [YouTubeDecipherService] Sending base.js to Meriyah AST preprocessor worker...');
            const t0 = Date.now();
            const res = await this.workerSendFn!('preprocess', { code: baseJs, playerUrl: targetUrl });
            if (res && res.success) {
                console.log(`✅ [YouTubeDecipherService] AST Preprocessing complete in ${Date.now() - t0}ms`);
                this.isPreprocessedFlag = true;
                this.currentPreprocessedPlayerUrl = targetUrl;
                return true;
            }
            throw new Error(res?.error || 'AST Preprocessing failed');
        })().finally(() => {
            this.preprocessingPromise = null;
        });

        return this.preprocessingPromise;
    }

    /**
     * Deciphers a batch of InnerTube adaptive/muxed formats.
     * Modifies format URLs in place with genuine signature and valid n parameters.
     */
    public async decipherFormats(items: DecipherFormatItem[], videoId?: string, playerUrl?: string | null): Promise<DecipherResultItem[]> {
        if (!items || items.length === 0) return [];

        await this.ensurePreprocessed(videoId, playerUrl);

        const payloadItems = items.map(it => ({
            itag: it.itag,
            n: it.n,
            sig: it.sig,
            isCipher: it.isCipher,
            sp: it.sp,
            rawUrl: it.rawUrl,
        }));

        console.log(`🤖 [YouTubeDecipherService] Deciphering batch of ${items.length} formats...`);
        const t0 = Date.now();
        const res = await this.workerSendFn!('decipher', { items: payloadItems });

        if (res && res.results && Array.isArray(res.results)) {
            console.log(`✅ [YouTubeDecipherService] Batch deciphered in ${Date.now() - t0}ms (${res.results.length} results)`);
            return res.results as DecipherResultItem[];
        }

        throw new Error(res?.error || 'Batch decipher returned empty results');
    }

    /**
     * Extracts YouTube video streaming data and deciphers all adaptive formats
     * inside the first-party WebView worker.
     */
    public async extractVideoViaWorker(videoId: string): Promise<{
        formats: any[];
        duration: number;
        title?: string;
    }> {
        await this.ensurePreprocessed(videoId);
        console.log(`🤖 [YouTubeDecipherService] Extracting video via WebView worker for: ${videoId}...`);
        const t0 = Date.now();
        const res = await this.workerSendFn!('extractVideo', { videoId });
        if (res && res.success && res.formats && Array.isArray(res.formats) && res.formats.length > 0) {
            console.log(`✅ [YouTubeDecipherService] Worker extracted ${res.formats.length} formats in ${Date.now() - t0}ms`);
            return {
                formats: res.formats,
                duration: res.duration || 0,
                title: res.title,
            };
        }
        throw new Error(res?.error || 'Worker video extraction returned no formats');
    }

    private extractionPromises = new Map<string, Promise<any>>();

    private extractBalancedJson(str: string, startIndex: number): string | null {
        let depth = 0;
        let inString = false;
        let escape = false;
        let quoteChar = '';
        for (let i = startIndex; i < str.length; i++) {
            const c = str[i];
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (inString) {
                if (c === quoteChar) inString = false;
                continue;
            }
            if (c === '"' || c === "'") {
                inString = true;
                quoteChar = c;
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return str.substring(startIndex, i + 1);
            }
        }
        return null;
    }

    private parsePlayerResponseFromHtml(html: string): any {
        const marker = 'ytInitialPlayerResponse';
        let pos = 0;
        while ((pos = html.indexOf(marker, pos)) !== -1) {
            const start = html.indexOf('{', pos);
            if (start !== -1 && start - pos < 120) {
                const jsonStr = this.extractBalancedJson(html, start);
                if (jsonStr) {
                    try {
                        const p = JSON.parse(jsonStr);
                        if (p && p.streamingData && (p.streamingData.adaptiveFormats || p.streamingData.formats)) {
                            return p;
                        }
                    } catch (_) {}
                }
            }
            pos += marker.length;
        }
        return null;
    }

    /**
     * Generates an authentic Google-signed Proof of Origin (PO) token using Rave's
     * BotGuard attestation pipeline (ytAtN challenge / att/get -> VM -> GenerateIT -> obtainPoToken).
     * Eliminates HTTP 403 playback cutoffs after 1 minute without requiring YouTube login.
     */
    public async generatePoToken(videoId: string = '', visitorData: string = '', watchPageHtml?: string): Promise<{ po_token: string; visitor_data: string }> {
        const now = Date.now();

        // 1. Return cached authentic visitor-bound token if valid (cached for 5 hours)
        if (visitorData && this.cachedPoTokens.has(visitorData)) {
            const cached = this.cachedPoTokens.get(visitorData)!;
            if (now < cached.expiresAt && cached.token && cached.token.length > 0) {
                console.log(`🔑 [PoToken] Returning cached authentic VISITOR-BOUND PO-Token for visitorData=${visitorData.substring(0, 16)}... (valid for ${Math.round((cached.expiresAt - now) / 60000)}min)`);
                return { po_token: cached.token, visitor_data: cached.visitorData };
            }
        }

        // If no visitorData was passed, but we have a valid latest visitor-bound token, return it
        if (!visitorData && this.latestVisitorBoundToken) {
            const latest = this.latestVisitorBoundToken;
            if (now < latest.expiresAt && latest.token && latest.token.length > 0) {
                console.log(`🔑 [PoToken] Returning active authentic visitor-bound PO-Token (valid for ${Math.round((latest.expiresAt - now) / 60000)}min)`);
                return { po_token: latest.token, visitor_data: latest.visitorData };
            }
        }

        // If videoId is provided and cached specifically for this video, check that
        if (videoId && this.cachedPoTokens.has(videoId)) {
            const cached = this.cachedPoTokens.get(videoId)!;
            if (now < cached.expiresAt && cached.token && cached.token.length > 0 && (!visitorData || cached.visitorData === visitorData)) {
                console.log(`🔑 [PoToken] Returning cached authentic PO-Token for videoId=${videoId} (valid for ${Math.round((cached.expiresAt - now) / 60000)}min)`);
                return { po_token: cached.token, visitor_data: cached.visitorData };
            }
        }

        // 2. In-flight promise deduplication
        const dedupeKey = visitorData || videoId || '_session';
        const inFlight = this.poTokenPromises.get(dedupeKey);
        if (inFlight) return inFlight;

        const promise = (async () => {
            try {
                await this.waitForWorker();

                // 3. Fast-mint attempt if worker is ready, integrityToken is cached, and visitorData is provided:
                if (visitorData && this.cachedIntegrityToken && this.workerSendFn) {
                    try {
                        const fastMint = await this.workerSendFn('obtainPoToken', {
                            integrityToken: this.cachedIntegrityToken,
                            identifier: visitorData
                        }, 3000);
                        if (fastMint && fastMint.poToken && typeof fastMint.poToken === 'string' && fastMint.poToken.length > 0) {
                            const expiresAt = now + (5 * 60 * 60 * 1000);
                            this.cachedPoTokens.set(visitorData, {
                                token: fastMint.poToken,
                                visitorData,
                                expiresAt
                            });
                            if (videoId) {
                                this.cachedPoTokens.set(videoId, {
                                    token: fastMint.poToken,
                                    visitorData,
                                    expiresAt
                                });
                            }
                            this.latestVisitorBoundToken = {
                                token: fastMint.poToken,
                                visitorData,
                                expiresAt
                            };
                            console.log(`⚡ [PoToken] Fast-minted authentic visitor-bound PO-Token in <15ms for visitor_data=${visitorData.substring(0, 16)}... (len: ${fastMint.poToken.length})`);
                            return { po_token: fastMint.poToken, visitor_data: visitorData };
                        }
                    } catch (_) {
                        // Fast mint failed, proceed to full attestation
                    }
                }

                // 4. Extract BotGuard challenge: check page-embedded ytAtN first, then fallback to att/get
                let challengeData: {
                    globalName: string;
                    program: string;
                    interpreterUrl: string;
                    ytcfg?: any;
                } | null = null;

                let ytcfgData: any = null;
                if (watchPageHtml) {
                    const ytcfgMatch = watchPageHtml.match(/ytcfg\.set\s*\(\s*(\{.+?\})\s*\)\s*;/);
                    if (ytcfgMatch && ytcfgMatch[1]) {
                        try {
                            ytcfgData = JSON.parse(ytcfgMatch[1]);
                        } catch (_) {
                            try {
                                ytcfgData = Function("return (" + ytcfgMatch[1] + ");")();
                            } catch (_) {}
                        }
                    }

                    const match = watchPageHtml.match(/(?:window\.)?ytAtN\s*\(\s*\{\s*['"]?R['"]?\s*:\s*['"]((?:[^'"]|\\.)*)['"]/);
                    if (match && match[1]) {
                        try {
                            const jsonStr = Function("return '" + match[1].replace(/'/g, "\\'") + "'")();
                            const parsed = JSON.parse(jsonStr);
                            const bg = parsed.bgChallenge || parsed.challenge?.bgChallenge || parsed.challengeData;
                            if (bg && bg.globalName && bg.program) {
                                let rawUrl = (typeof bg.interpreterUrl === 'string')
                                    ? bg.interpreterUrl
                                    : (bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue || '');
                                if (rawUrl && !rawUrl.startsWith('http')) {
                                    rawUrl = 'https:' + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
                                }
                                challengeData = {
                                    globalName: bg.globalName,
                                    program: bg.program,
                                    interpreterUrl: rawUrl,
                                    ytcfg: ytcfgData,
                                };
                                console.log(`🤖 [PoToken] Extracted page-embedded ytAtN challenge: globalName=${bg.globalName}, programLen=${bg.program.length}`);
                            }
                        } catch (e: any) {
                            console.warn('⚠️ [PoToken] Failed to parse ytAtN embedded challenge:', e?.message || e);
                        }
                    }
                }

                // Fallback: If watch page does not contain window.ytAtN, query YouTube att/get endpoint (Rave architecture)
                let resolvedVisitorData = visitorData;
                if (!challengeData) {
                    const attPayload = {
                        engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
                        context: {
                            user: {
                                lockedSafetyMode: false
                            },
                            request: {
                                internalExperimentFlags: [],
                                useSsl: true
                            },
                            client: {
                                utcOffsetMinutes: 0,
                                hl: 'en-GB',
                                gl: 'GB',
                                clientName: 'WEB',
                                clientScreen: 'WATCH',
                                clientVersion: '2.20250520.04.00',
                                platform: 'DESKTOP',
                                ...(resolvedVisitorData ? { visitorData: resolvedVisitorData } : {})
                            }
                        }
                    };

                    let attData: any = null;
                    try {
                        const attRes = await fetch('https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': YOUTUBE_DESKTOP_USER_AGENT,
                                'Origin': 'https://www.youtube.com',
                                'X-Origin': 'https://www.youtube.com'
                            },
                            body: JSON.stringify(attPayload)
                        });
                        if (attRes.ok) {
                            attData = await attRes.json();
                        } else {
                            console.warn(`⚠️ [PoToken] React Native att/get fetch returned HTTP ${attRes.status}, falling back to WebView worker fetch...`);
                        }
                    } catch (attErr: any) {
                        console.warn('⚠️ [PoToken] React Native att/get fetch error, falling back to WebView worker:', attErr?.message || attErr);
                    }

                    // WebView worker fallback: executes with genuine YouTube browser origin
                    if (!attData && this.workerSendFn) {
                        try {
                            const workerAtt = await this.workerSendFn('fetchAttGet', { body: attPayload });
                            if (workerAtt && workerAtt.success && workerAtt.data) {
                                attData = workerAtt.data;
                            }
                        } catch (wErr: any) {
                            console.warn('⚠️ [PoToken] Worker fetchAttGet failed:', wErr?.message || wErr);
                        }
                    }

                    if (attData) {
                        // Extract genuine visitorData returned directly by YouTube's att/get responseContext
                        if (!resolvedVisitorData && attData.responseContext?.visitorData) {
                            resolvedVisitorData = attData.responseContext.visitorData;
                            console.log(`🤖 [PoToken] Resolved genuine visitorData from att/get: ${resolvedVisitorData.substring(0, 16)}...`);
                        }

                        const bg = attData.bgChallenge || attData.challenge?.bgChallenge || attData.challengeData;
                        if (bg && bg.globalName && bg.program) {
                            let rawUrl = (typeof bg.interpreterUrl === 'string')
                                ? bg.interpreterUrl
                                : (bg.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue || '');
                            if (rawUrl && !rawUrl.startsWith('http')) {
                                rawUrl = 'https:' + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
                            }
                            challengeData = {
                                globalName: bg.globalName,
                                program: bg.program,
                                interpreterUrl: rawUrl,
                                ytcfg: ytcfgData,
                            };
                            console.log(`🤖 [PoToken] Acquired att/get challenge: globalName=${bg.globalName}, programLen=${bg.program.length}`);
                        }
                    }
                }

                if (!challengeData || !challengeData.interpreterUrl) {
                    throw new Error('Could not obtain BotGuard challenge data');
                }

                // 5. Download and cache VM interpreter script
                const interpreterJavascript = await this.getOrFetchVmScript(challengeData.interpreterUrl);

                // 6. Run BotGuard inside WebView worker (exact Rave po_token.html behavior)
                console.log('🤖 [PoToken] Executing BotGuard in background WebView worker...');
                const bgRes = await this.workerSendFn!('runBotGuard', {
                    challengeData: {
                        interpreterJavascript,
                        globalName: challengeData.globalName,
                        program: challengeData.program,
                        ytcfg: challengeData.ytcfg || ytcfgData,
                    }
                });

                if (!bgRes || !bgRes.botguardResponse) {
                    throw new Error(bgRes?.error || 'BotGuard snapshot returned empty response');
                }
                console.log(`🤖 [PoToken] BotGuard snapshot received (len: ${bgRes.botguardResponse.length}), calling GenerateIT...`);

                // 7. Request Integrity Token from Google
                let integrityToken: string = '';
                try {
                    const genRes = await fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json+protobuf',
                            'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
                            'x-user-agent': 'grpc-web-javascript/0.1',
                            'Origin': 'https://www.youtube.com'
                        },
                        body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', bgRes.botguardResponse])
                    });
                    if (genRes.ok) {
                        const genData = await genRes.json();
                        integrityToken = (Array.isArray(genData) ? genData.find((x: any) => typeof x === 'string' && x.length > 20) : null) || genData[0] || '';
                    }
                } catch (_) {}

                if (!integrityToken && this.workerSendFn) {
                    try {
                        const wGen = await this.workerSendFn('fetchGenerateIT', {
                            body: ['O43z0dpjhgX20SCx4KAo', bgRes.botguardResponse]
                        });
                        if (wGen && wGen.success && wGen.data) {
                            const genData = wGen.data;
                            integrityToken = (Array.isArray(genData) ? genData.find((x: any) => typeof x === 'string' && x.length > 20) : null) || genData[0] || '';
                        }
                    } catch (_) {}
                }

                if (!integrityToken || typeof integrityToken !== 'string') {
                    throw new Error('GenerateIT returned no valid integrity token');
                }
                this.cachedIntegrityToken = integrityToken;
                console.log(`🤖 [PoToken] Integrity token acquired: ${integrityToken.substring(0, 25)}..., minting PO-Token for visitor_data=${resolvedVisitorData.substring(0, 16)}...`);

                // 8. Mint authentic PO-Token inside worker via obtainPoToken (pass visitorData or empty string, never videoId)
                let authenticToken = '';
                try {
                    const mintRes = await this.workerSendFn!('obtainPoToken', {
                        integrityToken,
                        identifier: resolvedVisitorData || ''
                    });
                    if (mintRes && mintRes.poToken && typeof mintRes.poToken === 'string' && mintRes.poToken.length > 0) {
                        authenticToken = mintRes.poToken;
                    } else if (mintRes && mintRes.error) {
                        throw new Error(mintRes.error);
                    }
                } catch (mintErr: any) {
                    throw new Error(`obtainPoToken failed: ${mintErr?.message || mintErr}`);
                }

                if (!authenticToken || authenticToken.length === 0) {
                    throw new Error('Could not obtain authentic PO-Token (skipping pot)');
                }

                const expiresAt = now + (5 * 60 * 60 * 1000); // 5 hours

                if (resolvedVisitorData) {
                    this.cachedPoTokens.set(resolvedVisitorData, {
                        token: authenticToken,
                        visitorData: resolvedVisitorData,
                        expiresAt
                    });
                }
                if (videoId) {
                    this.cachedPoTokens.set(videoId, {
                        token: authenticToken,
                        visitorData: resolvedVisitorData,
                        expiresAt
                    });
                }
                this.latestVisitorBoundToken = {
                    token: authenticToken,
                    visitorData: resolvedVisitorData,
                    expiresAt
                };

                console.log(`✅ [PoToken] Successfully acquired authentic Google PO-Token: ${authenticToken.substring(0, 25)}... (len: ${authenticToken.length}, visitor_bound: ${Boolean(resolvedVisitorData)})`);
                return { po_token: authenticToken, visitor_data: resolvedVisitorData };

            } catch (err: any) {
                console.warn('⚠️ [PoToken] BotGuard attestation failed, skipping token (no dummy pot):', err?.message || err);
                return { po_token: '', visitor_data: visitorData };
            }
        })().finally(() => {
            this.poTokenPromises.delete(dedupeKey);
        });

        this.poTokenPromises.set(dedupeKey, promise);
        return promise;
    }

    /**
     * Extracts YouTube video streaming data and deciphers all adaptive formats
     * using the mobile watch page (which delivers signatureCipher for all resolutions 144p to 4K)
     * and the Meriyah AST preprocessor worker.
     */
    public async extractVideoDirect(videoId: string): Promise<{
        formats: any[];
        duration: number;
        title?: string;
        channelTitle?: string;
        androidProgressiveUrl?: string;
        androidAdaptiveFormats?: any[];
    }> {
        console.log(`🤖 [YouTubeDecipherService] Extracting video for: ${videoId}...`);

        // ── Tier 1 (Primary / Rave Architecture): Native InnerTube (IOS + ANDROID) ──
        // IOS client provides direct unthrottled adaptive streams (1080p, 720p, 480p, 360p, 240p, 144p + AAC audio 140)
        // ANDROID client provides unthrottled progressive muxed 360p (itag 18)
        let nativeAdaptive: any[] = [];
        let nativeProgUrl: string | undefined;
        let nativeTitle: string | undefined;
        let nativeAuthor: string | undefined;
        let nativeDuration: number = 0;
        let innertubeVisitorData: string | undefined;

        try {

            // 1. Query IOS client for full DASH MP4 adaptive streams (144p to 1080p)
            try {
                const iosRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
                        'X-YouTube-Client-Name': '5',
                        'X-YouTube-Client-Version': '20.10.4',
                        'X-Goog-Api-Format-Version': '2',
                    },
                    body: JSON.stringify({
                        videoId,
                        context: {
                            client: {
                                clientName: 'IOS',
                                clientVersion: '20.10.4',
                                deviceModel: 'iPhone16,2',
                                userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
                                osName: 'iPhone OS',
                                osVersion: '18.3.2',
                                ...(this.latestVisitorBoundToken?.visitorData ? { visitorData: this.latestVisitorBoundToken.visitorData } : {})
                            }
                        }
                    })
                });

                if (iosRes.ok) {
                    const data = await iosRes.json();
                    if (data?.responseContext?.visitorData) {
                        innertubeVisitorData = data.responseContext.visitorData;
                    }
                    if (data?.playabilityStatus?.status === 'OK') {
                        nativeTitle = data.videoDetails?.title;
                        nativeAuthor = data.videoDetails?.author;
                        nativeDuration = parseInt(data.videoDetails?.lengthSeconds || '0', 10);

                        const adaptive = (data?.streamingData?.adaptiveFormats || [])
                            .filter((f: any) => f.url && typeof f.url === 'string' && f.url.startsWith('http'))
                            .map((f: any) => {
                                let cleanUrl = f.url as string;
                                try {
                                    const u = new URL(cleanUrl);
                                    u.searchParams.delete('alr');
                                    cleanUrl = u.toString();
                                } catch (_) {}
                                return { ...f, url: cleanUrl };
                            });

                        if (adaptive.length > 0) {
                            nativeAdaptive = adaptive;
                            console.log(`✅ [YouTubeDecipherService] IOS InnerTube acquired ${adaptive.length} direct adaptive formats (Max: ${adaptive[0]?.qualityLabel || 'unknown'})`);
                        }
                    }
                }
            } catch (iosErr: any) {
                console.warn('⚠️ [YouTubeDecipherService] IOS InnerTube query warning:', iosErr?.message || iosErr);
            }

            // 2. Query ANDROID client for guaranteed non-throttled itag 18 progressive stream
            try {
                const androidRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip',
                        'X-YouTube-Client-Name': '3',
                        'X-YouTube-Client-Version': '21.02.35',
                        'X-Goog-Api-Format-Version': '2',
                    },
                    body: JSON.stringify({
                        videoId,
                        context: {
                            client: {
                                clientName: 'ANDROID',
                                clientVersion: '21.02.35',
                                androidSdkVersion: 30,
                                userAgent: 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip',
                                osName: 'Android',
                                osVersion: '11',
                                ...(this.latestVisitorBoundToken?.visitorData ? { visitorData: this.latestVisitorBoundToken.visitorData } : {})
                            }
                        }
                    })
                });

                if (androidRes.ok) {
                    const data = await androidRes.json();
                    if (!innertubeVisitorData && data?.responseContext?.visitorData) {
                        innertubeVisitorData = data.responseContext.visitorData;
                    }
                    if (data?.playabilityStatus?.status === 'OK') {
                        if (!nativeTitle) nativeTitle = data.videoDetails?.title;
                        if (!nativeAuthor) nativeAuthor = data.videoDetails?.author;
                        if (!nativeDuration) nativeDuration = parseInt(data.videoDetails?.lengthSeconds || '0', 10);

                        const formats = data?.streamingData?.formats || [];
                        const itag18 = formats.find((f: any) => f.itag === 18 && f.url);
                        if (itag18?.url) {
                            let cleanProgUrl = itag18.url as string;
                            try {
                                const u = new URL(cleanProgUrl);
                                u.searchParams.delete('alr');
                                cleanProgUrl = u.toString();
                            } catch (_) {}
                            nativeProgUrl = cleanProgUrl;
                            console.log('🤖 [YouTubeDecipherService] ANDROID itag 18 acquired — direct progressive ready');
                        }
                    }
                }
            } catch (androidErr: any) {
                console.warn('⚠️ [YouTubeDecipherService] ANDROID InnerTube query warning:', androidErr?.message || androidErr);
            }

            console.log(`✅ [YouTubeDecipherService] Acquired ${nativeAdaptive.length} native adaptive streams from InnerTube (routing to Meriyah AST worker for n-deciphering)`);
        } catch (tier1Err: any) {
            console.warn('⚠️ [YouTubeDecipherService] Tier 1 Native InnerTube warning:', tier1Err?.message || tier1Err);
        }

        // ── Tier 2 (Rave Architecture): MWEB watch page extraction + WebView AST/opcode VM decipher ──
        console.log(`🤖 [YouTubeDecipherService] Proceeding with Rave AST deciphering pipeline for: ${videoId}...`);
        let html: string | null = null;

        // Fetch mobile watch page with Android Chrome UA (fast, lightweight)
        try {
            const mRes = await fetch(`https://m.youtube.com/watch?v=${videoId}&hl=en`, {
                headers: {
                    'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });
            if (mRes.ok) html = await mRes.text();
        } catch (_) {}

        if (!html) {
            try {
                const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9',
                    }
                });
                if (res.ok) html = await res.text();
            } catch (_) {}
        }

        if (!html && nativeAdaptive.length === 0) {
            throw new Error('Failed to fetch watch page HTML and no native formats available');
        }

        const playerResponse = html ? this.parsePlayerResponseFromHtml(html) : null;

        // ── Extract genuine visitorData from InnerTube / watch page HTML / player response ──
        let visitor_data = innertubeVisitorData || '';
        if (!visitor_data && html) {
            const vm = html.match(/"VISITOR_DATA":\s*"([^"]+)"/i) || html.match(/"visitorData":\s*"([^"]+)"/);
            if (vm && vm[1]) {
                visitor_data = vm[1];
            }
        }
        if (!visitor_data && playerResponse?.responseContext?.visitorData) {
            visitor_data = playerResponse.responseContext.visitorData;
        }
        if (!visitor_data && this.latestVisitorBoundToken?.visitorData) {
            visitor_data = this.latestVisitorBoundToken.visitorData;
        }

        // ── Acquire or generate guaranteed PO-Token ──
        let po_token: string = '';
        try {
            const tokenRes = await this.generatePoToken(videoId, visitor_data, html || undefined);
            if (tokenRes && tokenRes.po_token && tokenRes.po_token.length > 0) {
                po_token = tokenRes.po_token;
                if (!visitor_data && tokenRes.visitor_data) {
                    visitor_data = tokenRes.visitor_data;
                }
            }
        } catch (_) {}

        if (po_token && po_token.length > 0) {
            console.log(`🔑 [YouTubeDecipherService] Acquired authentic PO-Token for extraction: ${po_token.substring(0, 16)}... (len: ${po_token.length})`);
        } else {
            po_token = '';
            console.log(`ℹ️ [YouTubeDecipherService] No authentic PO-Token — proceeding with clean deciphered URLs (no dummy pot parameter)`);
        }

        // ── 1. If playerResponse from HTML lacked adaptiveFormats, query InnerTube MWEB ──
        let streamingData = playerResponse?.streamingData;
        if (!streamingData?.adaptiveFormats || streamingData.adaptiveFormats.length === 0) {
            try {
                const mwebRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
                        'X-YouTube-Client-Name': '2',
                        'X-YouTube-Client-Version': '2.20241118.01.00',
                        'X-Goog-Api-Format-Version': '2',
                        'Origin': 'https://m.youtube.com',
                        'Referer': `https://m.youtube.com/watch?v=${videoId}`,
                    },
                    body: JSON.stringify({
                        videoId,
                        context: {
                            client: {
                                clientName: 'MWEB',
                                clientVersion: '2.20241118.01.00',
                                userAgent: YOUTUBE_MOBILE_USER_AGENT,
                                hl: 'en',
                                gl: 'US',
                                ...(visitor_data ? { visitorData: visitor_data } : {})
                            }
                        },
                        ...(po_token ? { serviceIntegrityDimensions: { poToken: po_token } } : {})
                    })
                });
                if (mwebRes.ok) {
                    const mwebData = await mwebRes.json();
                    if (mwebData?.streamingData?.adaptiveFormats && mwebData.streamingData.adaptiveFormats.length > 0) {
                        streamingData = mwebData.streamingData;
                        if (!playerResponse) playerResponse = mwebData;
                        console.log(`✅ [YouTubeDecipherService] Acquired ${streamingData.adaptiveFormats.length} adaptive formats from InnerTube MWEB`);
                    }
                }
            } catch (mwebErr: any) {
                console.warn('⚠️ [YouTubeDecipherService] InnerTube MWEB query warning:', mwebErr?.message || mwebErr);
            }
        }

        const adaptiveFormats: any[] = streamingData?.adaptiveFormats || [];
        const muxedFormats: any[] = streamingData?.formats || [];
        const allRawFormats: any[] = [];

        // 1. Prioritize direct native adaptive formats (IOS InnerTube) with pre-signed direct URLs (144p to 1080p/4K)
        if (nativeAdaptive && nativeAdaptive.length > 0) {
            for (const na of nativeAdaptive) {
                if (na.url && !na.signatureCipher && !na.cipher) {
                    allRawFormats.push(na);
                }
            }
        }

        // 2. Add or supplement MWEB adaptive formats if not already present with a direct URL
        if (adaptiveFormats && adaptiveFormats.length > 0) {
            for (const af of adaptiveFormats) {
                const existingIdx = allRawFormats.findIndex(f => f.itag === af.itag);
                if (existingIdx === -1) {
                    allRawFormats.push(af);
                } else if (!allRawFormats[existingIdx].url && (af.url || af.signatureCipher || af.cipher)) {
                    allRawFormats[existingIdx] = af;
                }
            }
        }

        // 3. Add progressive itag 18
        if (nativeProgUrl && !allRawFormats.some(f => f.itag === 18)) {
            allRawFormats.push({
                itag: 18,
                url: nativeProgUrl,
                mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
                qualityLabel: '360p',
                height: 360,
                width: 640,
                hasAudio: true,
            });
        }

        for (const mf of muxedFormats) {
            if (!allRawFormats.some(f => f.itag === mf.itag)) {
                allRawFormats.push(mf);
            }
        }

        const itemsToDecipher: DecipherFormatItem[] = [];
        const formatMetaMap = new Map<number, any>();

        for (const f of allRawFormats) {
            let rawUrl = f.url;
            let sig: string | null = null;
            let sp = 'sig';
            let isCipher = false;

            if (f.signatureCipher || f.cipher) {
                const cipher = f.signatureCipher || f.cipher;
                const params = new URLSearchParams(cipher);
                rawUrl = params.get('url') || '';
                sig = params.get('s');
                sp = params.get('sp') || 'sig';
                isCipher = true;
            }

            if (rawUrl) {
                let n: string | null = null;
                try {
                    const parsed = new URL(rawUrl);
                    n = parsed.searchParams.get('n');
                } catch (_) {}

                if (isCipher || n) {
                    itemsToDecipher.push({
                        itag: f.itag,
                        n,
                        sig,
                        isCipher,
                        sp,
                        rawUrl,
                    });
                }
                formatMetaMap.set(f.itag, {
                    ...f,
                    url: isCipher ? null : rawUrl,
                    rawUrl,
                    sp,
                    n,
                    sig,
                    isCipher,
                });
            }
        }

        // Extract exact player URL from the watch page HTML
        let playerUrl: string | null = null;
        if (html) {
            const playerMatch = html.match(/\/s\/player\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\/base\.js/) ||
                                html.match(/["'](\/s\/player\/[^"']+\/base\.js)["']/);
            if (playerMatch) {
                const rawPath = playerMatch[1] || playerMatch[0];
                playerUrl = 'https://www.youtube.com' + rawPath;
            }
        }
        if (!playerUrl) {
            playerUrl = FALLBACK_BASE_JS_URL;
        }

        // 1. Direct Hermes Signature Decipher (Zero delay, pure JS fallback)
        //
        // IMPORTANT: Never overwrite a working cached sigTransforms with null.
        // If parseSignatureTransforms fails for a video-specific player URL,
        // keep the existing cached transforms so deciphering still works.
        let sigTransforms: SigTransform[] | null = this.cachedSigTransforms;
        if (!sigTransforms || (playerUrl && this.cachedSigTransformsPlayerUrl !== playerUrl)) {
            try {
                const baseJs = await this.getOrFetchBaseJs(videoId, playerUrl);
                if (baseJs) {
                    const freshTransforms = parseSignatureTransforms(baseJs);
                    if (freshTransforms && freshTransforms.length > 0) {
                        // Fresh parse succeeded — update cache and local variable
                        sigTransforms = freshTransforms;
                        this.cachedSigTransforms = sigTransforms;
                        this.cachedSigTransformsPlayerUrl = playerUrl || FALLBACK_BASE_JS_URL;
                        console.log(`🤖 [YouTubeDecipherService] Parsed ${sigTransforms.length} Hermes signature operations from player`);
                    } else {
                        console.log('🤖 [YouTubeDecipherService] Modern player detected — deciphering via AST/opcode VM worker');
                    }
                }
            } catch (_) {}
        }

        // Pre-apply Hermes signature deciphering to all cipher formats
        if (sigTransforms && sigTransforms.length > 0) {
            for (const [, meta] of formatMetaMap.entries()) {
                if (meta.isCipher && meta.sig && meta.rawUrl) {
                    try {
                        let cleanSig = meta.sig;
                        while (cleanSig.includes('%')) {
                            const next = decodeURIComponent(cleanSig);
                            if (next === cleanSig) break;
                            cleanSig = next;
                        }
                        const decipheredSig = applySigTransforms(cleanSig, sigTransforms);
                        if (decipheredSig) {
                            const parsed = new URL(meta.rawUrl);
                            parsed.searchParams.delete('alr');
                            parsed.searchParams.set(meta.sp || 'sig', decipheredSig);
                            meta.url = parsed.toString();
                        }
                    } catch (_) {}
                }
            }
        }

        let anyNTransformed = false;
        let decipherSuccess = false;
        if (itemsToDecipher.length > 0) {
            try {
                const deciphered = await this.decipherFormats(itemsToDecipher, videoId, playerUrl);
                if (deciphered.length > 0) {
                    const sample = deciphered[0];
                    const sampleMeta = formatMetaMap.get(sample.itag);
                    const isNTransformed = Boolean(sample.newN && sample.newN !== sampleMeta?.n);
                    anyNTransformed = deciphered.some(d => {
                        const m = formatMetaMap.get(d.itag);
                        return Boolean(d.newN && d.newN !== m?.n);
                    });
                    decipherSuccess = anyNTransformed || itemsToDecipher.every(it => !it.n);
                    console.log(`🤖 [YouTubeDecipherService] Decipher Sample (itag ${sample.itag}): newSig=${sample.newSig ? sample.newSig.substring(0, 15) + '...' : 'null'}, newN=${sample.newN || 'null'} (nTransformed: ${isNTransformed})`);
                }
                for (const dec of deciphered) {
                    const meta = formatMetaMap.get(dec.itag);
                    if (meta && meta.rawUrl) {
                        try {
                            const parsed = new URL(meta.rawUrl);
                            parsed.searchParams.delete('alr');
                            if (dec.newN && typeof dec.newN === 'string') {
                                parsed.searchParams.set('n', dec.newN);
                            }
                            if (dec.newSig && typeof dec.newSig === 'string') {
                                // Fully decode the signature — strip any residual URI encoding
                                // so ExoPlayer's OkHttp does not double-encode it in the Range request
                                let cleanSig = dec.newSig;
                                try {
                                    let prev = '';
                                    while (cleanSig !== prev && cleanSig.includes('%')) {
                                        prev = cleanSig;
                                        cleanSig = decodeURIComponent(cleanSig);
                                    }
                                } catch (_) {}
                                parsed.searchParams.set(meta.sp || 'sig', cleanSig);
                            }
                            if (meta.isCipher) {
                                if (dec.newSig) {
                                    meta.url = parsed.toString();
                                } else if (meta.url) {
                                    if (dec.newN && typeof dec.newN === 'string') {
                                        const u = new URL(meta.url);
                                        u.searchParams.set('n', dec.newN);
                                        meta.url = u.toString();
                                    }
                                }
                            } else if (dec.newUrl && typeof dec.newUrl === 'string' && dec.newUrl.startsWith('http')) {
                                meta.url = dec.newUrl;
                            } else {
                                meta.url = parsed.toString();
                            }

                        } catch (_) {}
                    }
                }
            } catch (decErr: any) {
                console.warn('⚠️ [YouTubeDecipherService] decipherFormats warning:', decErr?.message || decErr);
                decipherSuccess = false;
            }
        } else {
            decipherSuccess = true;
        }

        // Sanitize all formats and attach authentic PO-Token only to Web/MWEB formats
        for (const [, meta] of formatMetaMap.entries()) {
            if (meta.url) {
                try {
                    const parsed = new URL(meta.url);
                    parsed.searchParams.delete('alr');
                    const client = parsed.searchParams.get('c');

                    // Attaching a Web PO-Token to IOS or ANDROID streams causes Google CDN to reject the token with HTTP 403.
                    // Web PO-Token is ONLY valid for MWEB / WEB clients (exact Rave architecture).
                    if (po_token && client !== 'IOS' && client !== 'ANDROID') {
                        if (!client) {
                            parsed.searchParams.set('c', 'MWEB');
                        }
                        parsed.searchParams.set('pot', po_token);
                    } else if (!po_token) {
                        parsed.searchParams.delete('pot');
                    }
                    meta.url = parsed.toString();
                } catch (_) {}
            }
        }

        const validFormats = Array.from(formatMetaMap.values()).filter(
            (f: any) => Boolean(f.url) && typeof f.url === 'string' && f.url.startsWith('http') && !f.url.includes('[object Object]')
        );
        const duration = parseInt(playerResponse?.videoDetails?.lengthSeconds || `${nativeDuration || 0}`, 10);

        if (validFormats.length > 0) {
            const sample = validFormats[0];
            console.log(`🤖 [YouTubeDecipherService] Sample resolved URL (itag ${sample.itag}): ${(sample.url || '').substring(0, 80)}...`);
        }

        console.log(`✅ [YouTubeDecipherService] MWEB extraction produced ${validFormats.length} formats (decipherSuccess: ${decipherSuccess})`);

        // Ensure all valid direct formats from nativeAdaptive are merged into finalFormats
        const finalFormatsMap = new Map<number, any>();
        for (const vf of validFormats) {
            finalFormatsMap.set(vf.itag, vf);
        }
        if (nativeAdaptive && nativeAdaptive.length > 0) {
            for (const na of nativeAdaptive) {
                if (na.url && !finalFormatsMap.has(na.itag)) {
                    finalFormatsMap.set(na.itag, na);
                }
            }
        }
        const finalFormats = Array.from(finalFormatsMap.values());
        console.log(`🎬 [YouTubeDecipherService] Final stream selection: ${finalFormats.length} formats (decipherSuccess: ${decipherSuccess}), progressive: ${Boolean(nativeProgUrl)}`);
        let finalProgUrl = nativeProgUrl;
        // Do NOT attach Web PO-token to ANDROID progressive URL (nativeProgUrl is c=ANDROID and plays cleanly without pot)
        if (finalProgUrl) {
            try {
                const u = new URL(finalProgUrl);
                u.searchParams.delete('alr');
                finalProgUrl = u.toString();
            } catch (_) {}
        }

        return {
            formats: finalFormats,
            duration,
            title: playerResponse?.videoDetails?.title || nativeTitle,
            channelTitle: playerResponse?.videoDetails?.author || nativeAuthor,
            // Non-throttled ANDROID progressive URL — fallback when DASH 403s
            androidProgressiveUrl: finalProgUrl,
            // Non-throttled ANDROID adaptive formats
            androidAdaptiveFormats: nativeAdaptive,
        };
    }


    /**
     * Unified extraction entry point with in-flight deduplication.
     */
    public async extractVideo(videoId: string): Promise<{
        formats: any[];
        duration: number;
        title?: string;
        channelTitle?: string;
        androidProgressiveUrl?: string;
        androidAdaptiveFormats?: any[];
    }> {
        if (this.extractionPromises.has(videoId)) {
            return this.extractionPromises.get(videoId)!;
        }

        const promise = this.extractVideoDirect(videoId).finally(() => {
            this.extractionPromises.delete(videoId);
        });

        this.extractionPromises.set(videoId, promise);
        return promise;
    }
}

const instance = new YouTubeDecipherService();
export default instance;
