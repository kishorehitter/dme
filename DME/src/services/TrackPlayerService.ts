import TrackPlayer, { PlayerCommand } from '@rntp/player';
import axios from 'axios';
import RNFS from 'react-native-fs';
import api from './api';
import YouTubeDecipherService, { DecipherFormatItem } from './YouTubeDecipherService';

const PIPED_INSTANCES = [
    'https://pipedapi.leptons.xyz',
    'https://api.piped.privacydev.net',
    'https://pipedapi.drgns.space',
    'https://piped-api.lunar.icu',
    'https://api-piped.mha.fi',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.darkness.services',
];

const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.privacydev.net',
    'https://invidious.nerdvpn.de',
    'https://iv.ggtyler.dev',
    'https://yewtu.be',
    'https://invidious.io.lol',
];

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

// ─────────────────────────────────────────────────────────────────────────
// ✅ NEW: Cancellation token / generation counter.
//
// playYouTubeVideo() can take seconds to resolve (backend round-trip or
// racing several Piped/Invidious instances). If the caller navigates away
// (leaves the room, or starts loading a different/same video again) before
// that resolves, the OLD call must never be allowed to call
// TrackPlayer.setMediaItem()/play() — otherwise it clobbers whatever the
// NEW call already set up, or starts playing audio with no screen left to
// stop it.
//
// Each call to playYouTubeVideo() gets the next generation id. Right before
// committing to TrackPlayer, it checks whether it is still the latest
// generation. If not, it bails out silently. cancelCurrentLoad() lets the
// screen explicitly invalidate any in-flight load (e.g. on unmount).
// ─────────────────────────────────────────────────────────────────────────
let loadGeneration = 0;

export const cancelCurrentLoad = () => {
    loadGeneration++;
};

// Custom Promise.any helper for compatibility
const promiseAny = <T>(promises: Promise<T>[]): Promise<T> => {
    return new Promise((resolve, reject) => {
        let rejectionCount = 0;
        const errors: any[] = [];
        if (promises.length === 0) {
            reject(new Error('No promises provided'));
            return;
        }
        promises.forEach((p, idx) => {
            Promise.resolve(p)
                .then(resolve)
                .catch(err => {
                    errors[idx] = err;
                    rejectionCount++;
                    if (rejectionCount === promises.length) {
                        reject(new Error('All promises rejected: ' + errors.map(e => e?.message || e).join(', ')));
                    }
                });
        });
    });
};

const tryPipedInstance = async (instance: string, videoId: string): Promise<{ url: string; duration: number }> => {
    const response = await axios.get(`${instance}/streams/${videoId}`, {
        timeout: 1500,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (response.status === 200 && response.data) {
        const audioStreams = response.data.audioStreams || [];
        if (audioStreams.length > 0) {
            const best = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (best.url) {
                return {
                    url: best.url,
                    duration: response.data.duration || 0,
                };
            }
        }
    }
    throw new Error(`Instance ${instance} returned invalid data`);
};

const tryInvidiousInstance = async (instance: string, videoId: string): Promise<{ url: string; duration: number }> => {
    const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
        timeout: 1500,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (response.status === 200 && response.data) {
        const adaptiveFormats = response.data.adaptiveFormats || [];
        const audioStreams = adaptiveFormats.filter((f: any) => f.type && f.type.startsWith('audio/'));
        if (audioStreams.length > 0) {
            const best = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (best.url) {
                return {
                    url: best.url,
                    duration: response.data.lengthSeconds || 0,
                };
            }
        }
    }
    throw new Error(`Instance ${instance} returned invalid data`);
};

// InnerTube API extraction — tries different YouTube client profiles sequentially using native fetch.
// Returns { url, duration } on success, or { errorMsg } on failure.
const tryInnerTubeExtraction = async (videoId: string): Promise<{ url?: string; duration?: number; errorMsg?: string }> => {
    const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player';
    const API_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

    const clientProfiles = [
        {
            name: 'TVHTML5',
            version: '7.20240916.15.00',
            userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
            extraContext: {}
        },
        {
            name: 'ANDROID',
            version: '19.29.37',
            userAgent: 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
            extraContext: { androidSdkVersion: 34 }
        },
        {
            name: 'ANDROID_TESTSUITE',
            version: '1.9',
            userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
            extraContext: { androidSdkVersion: 30 }
        }
    ];

    const errors: string[] = [];

    for (const client of clientProfiles) {
        console.log(`🎵 [InnerTube] Attempting client profile: ${client.name} (version ${client.version}) for videoId=${videoId}`);
        try {
            const requestBody = {
                context: {
                    client: {
                        clientName: client.name,
                        clientVersion: client.version,
                        hl: 'en',
                        gl: 'US',
                        utcOffsetMinutes: 0,
                        ...client.extraContext
                    },
                },
                videoId: videoId,
                playbackContext: {
                    contentPlaybackContext: {
                        html5Preference: 'HTML5_PREF_WANTS',
                    },
                },
                racyCheckOk: true,
                contentCheckOk: true,
            };

            const response = await fetch(`${INNERTUBE_API_URL}?key=${API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': client.userAgent,
                    'Origin': 'https://www.youtube.com',
                },
                body: JSON.stringify(requestBody),
            });

            if (response.status !== 200) {
                let errText = '';
                try { errText = await response.text(); } catch (_) {}
                const msg = `Status ${response.status}: ${errText.substring(0, 100)}`;
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            const playerResponse = await response.json();

            // Check for playability
            const playabilityStatus = playerResponse.playabilityStatus?.status;
            if (playabilityStatus && playabilityStatus !== 'OK') {
                const reason = playerResponse.playabilityStatus?.reason || '';
                const msg = `Playability: ${playabilityStatus} (${reason})`;
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            const streamingData = playerResponse.streamingData;
            if (!streamingData) {
                const msg = 'Missing streamingData';
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            const adaptiveFormats: any[] = streamingData.adaptiveFormats || [];
            const muxedFormats: any[] = streamingData.formats || [];

            // Filter for audio-only streams
            const audioStreams = adaptiveFormats.filter(
                (f: any) => f.mimeType && f.mimeType.startsWith('audio/')
            );

            let best: any = null;

            if (audioStreams.length > 0) {
                best = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            } else if (muxedFormats.length > 0) {
                best = muxedFormats.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                console.log(`🎵 [InnerTube - ${client.name}] No adaptive audio streams; using muxed format`);
            }

            if (!best) {
                const msg = 'No usable audio formats';
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            let streamUrl: string | null = best.url || null;

            if (!streamUrl && (best.signatureCipher || best.cipher)) {
                const msg = 'signatureCipher present';
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            if (!streamUrl) {
                const msg = 'Stream URL is null';
                console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
                errors.push(`${client.name}: ${msg}`);
                continue;
            }

            const duration = parseInt(playerResponse.videoDetails?.lengthSeconds || '0', 10);
            console.log(`✅ [InnerTube - ${client.name}] Extraction success!`);

            return {
                url: streamUrl,
                duration: duration || 0,
            };
        } catch (e: any) {
            const msg = `Fetch error: ${e?.message || e}`;
            console.warn(`⚠️ [InnerTube - ${client.name}] ${msg}`);
            errors.push(`${client.name}: ${msg}`);
            continue;
        }
    }

    return {
        errorMsg: `InnerTube failed. [${errors.join(' | ')}]`
    };
};

// Resolves stream URL client-side in parallel.
// Returns { url, duration } on success, or throws detailed error on failure.
export const extractStreamUrlClientSide = async (videoId: string): Promise<{ url: string; duration: number }> => {
    // 1. Try InnerTube API first (tries ANDROID_VR, TVHTML5, ANDROID_TESTSUITE sequentially)
    const innerTubeResult = await tryInnerTubeExtraction(videoId);
    if (innerTubeResult && innerTubeResult.url) {
        return {
            url: innerTubeResult.url,
            duration: innerTubeResult.duration || 0,
        };
    }

    const itError = innerTubeResult?.errorMsg || 'InnerTube unknown failure';
    console.log(`🎵 [Client-Side Extraction] InnerTube failed: ${itError}. Falling back to parallel public instances for videoId=${videoId}`);

    const trials: Promise<{ url: string; duration: number }>[] = [];

    // Queue Piped instances
    PIPED_INSTANCES.forEach(instance => {
        trials.push(tryPipedInstance(instance, videoId));
    });

    // Queue Invidious instances
    INVIDIOUS_INSTANCES.forEach(instance => {
        trials.push(tryInvidiousInstance(instance, videoId));
    });

    try {
        const result = await promiseAny(trials);
        console.log('✅ [Client-Side Extraction] Parallel extraction success!');
        return result;
    } catch (e: any) {
        const parallelError = e?.message || e;
        console.warn('❌ [Client-Side Extraction] All parallel public extractors failed:', parallelError);
        throw new Error(`${itError} | Fallbacks failed: ${parallelError}`);
    }
};

export interface ExtractedVideoStream {
    url: string;
    height: number;
    width?: number;
    quality: string;       // e.g. "720p", "360p"
    qualityKey: string;    // e.g. "hd720", "medium", "small", "tiny"
    has_audio: boolean;
    streamType: 'mp4' | 'mpd' | 'm3u8';
    mimeType?: string;
    audio_url?: string | null;
    bitrate?: number;
    initRange?: { start: string; end: string };
    indexRange?: { start: string; end: string };
}

export interface ExtractedVideoResult {
    url: string;
    quality?: string;
    duration?: number;
    title?: string;
    channelTitle?: string;
    streamType: 'mp4' | 'mpd' | 'm3u8';
    streams: ExtractedVideoStream[];
    audioUrl?: string | null;
    dashUrl?: string | null;
    fallbackProgressiveUrl?: string | null;
}

function formatRange(r: any): string | null {
    if (!r) return null;
    if (typeof r === 'string') return r;
    if (typeof r === 'object' && r.start !== undefined && r.end !== undefined) {
        return `${r.start}-${r.end}`;
    }
    return null;
}

export const getEffectiveResolutionHeight = (h: number, w?: number): number => {
    if (w && w > 0 && h > 0) {
        // Cinemascope / widescreen tiers (e.g. 3840x1632 is 4K / 2160p tier, 1920x800 is 1080p tier)
        if (w >= 7680 || h >= 4320) return 4320;
        if (w >= 3840 || h >= 2160) return 2160;
        if (w >= 2560 || h >= 1440) return 1440;
        if (w >= 1920 || h >= 1080) return 1080;
        if (w >= 1280 || h >= 720) return 720;
        if (w >= 854 || h >= 480) return 480;
        if (w >= 640 || h >= 360) return 360;
        if (w >= 426 || h >= 240) return 240;
        return 144;
    }
    if (h >= 4320) return 4320;
    if (h >= 2160) return 2160;
    if (h >= 1440) return 1440;
    if (h >= 1080) return 1080;
    if (h >= 720) return 720;
    if (h >= 480) return 480;
    if (h >= 360) return 360;
    if (h >= 240) return 240;
    return 144;
};

export const heightToQualityKey = (h: number, w?: number): string => {
    const eff = getEffectiveResolutionHeight(h, w);
    if (eff >= 4320) return 'hd4320';
    if (eff >= 2160) return 'hd2160';
    if (eff >= 1440) return 'hd1440';
    if (eff >= 1080) return 'hd1080';
    if (eff >= 720) return 'hd720';
    if (eff >= 480) return 'large';
    if (eff >= 360) return 'medium';
    if (eff >= 240) return 'small';
    return 'tiny';
};

export function buildDashMpdXml(
    videoStreams: ExtractedVideoStream[],
    audioStream: any,
    durationSeconds: number
): string | null {
    const validVideoStreams = videoStreams.filter(f => {
        const initR = formatRange(f.initRange);
        const indexR = formatRange(f.indexRange);
        const isRealUrl = Boolean(f.url && typeof f.url === 'string' && f.url.startsWith('http') && !f.url.includes('[object Object]'));
        const isMp4 = Boolean(!f.mimeType || f.mimeType.startsWith('video/mp4') || f.mimeType.includes('avc1'));
        // Support full HD (1080p) and QHD (1440p) representations in DASH manifest
        const isMaxResolution = (f.height || 0) <= 1440;
        return Boolean(initR && indexR && isRealUrl && isMp4 && isMaxResolution);
    });
    if (validVideoStreams.length === 0) {
        return null;
    }
    const durationStr = `PT${Math.max(1, durationSeconds || 0).toFixed(1)}S`;

    // Sort by height descending: 1440p, 1080p, 720p, 480p, 360p, 240p, 144p
    validVideoStreams.sort((a, b) => (b.height || 0) - (a.height || 0));

    const videoReps = validVideoStreams.map((f, idx) => {
        const height = f.height || 360;
        const width = f.width || Math.round(height * (16 / 9));
        const bitrate = f.bitrate || (height >= 1080 ? 4500000 : height >= 720 ? 2500000 : 1000000);
        const codecs = f.mimeType?.match(/codecs="?([^";,]+)"?/)?.[1] || 'avc1.4d401f';
        const initRange = formatRange(f.initRange);
        const indexRange = formatRange(f.indexRange);
        const safeUrl = (f.url || '').replace(/&/g, '&amp;');
        const fps = (f as any).fps || 30;

        return `      <Representation id="video_${height}p_${idx}" width="${width}" height="${height}" maxPlayoutRate="1" frameRate="${fps}" bandwidth="${bitrate}" codecs="${codecs}">
        <BaseURL>${safeUrl}</BaseURL>
        <SegmentBase indexRange="${indexRange}">
          <Initialization range="${initRange}" />
        </SegmentBase>
      </Representation>`;
    }).join('\n');

    // Build unified audio AdaptationSet for ExoPlayer.
    // Audio stream (typically itag 140, AAC mp4a.40.2) is played simultaneously with video
    // by ExoPlayer's native AudioTrack renderer in perfect lip-sync.
    let audioAdaptationSet = '';
    if (audioStream && audioStream.url && typeof audioStream.url === 'string' && audioStream.url.startsWith('http') && !audioStream.url.includes('[object Object]')) {
        const audioInitRange = formatRange(audioStream.initRange);
        const audioIndexRange = formatRange(audioStream.indexRange);
        const safeAudioUrl = audioStream.url.replace(/&/g, '&amp;');
        const audioBitrate = audioStream.bitrate || 128000;
        const audioCodecs = audioStream.mimeType?.match(/codecs="?([^";,]+)"?/)?.[1] || 'mp4a.40.2';
        const sampleRate = audioStream.audioSampleRate || 44100;
        const channels = audioStream.audioChannels || 2;
        const mimeType = audioStream.mimeType?.split(';')[0]?.trim() || 'audio/mp4';

        if (audioInitRange && audioIndexRange) {
            audioAdaptationSet = `\n    <AdaptationSet id="1" startWithSAP="1" contentType="audio" mimeType="${mimeType}" subsegmentAlignment="true">
      <Representation id="audio_${audioStream.itag || 140}" bandwidth="${audioBitrate}" codecs="${audioCodecs}" audioSamplingRate="${sampleRate}">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${channels}"/>
        <Role schemeIdUri="urn:mpeg:DASH:role:2011" value="main" />
        <BaseURL>${safeAudioUrl}</BaseURL>
        <SegmentBase indexRange="${audioIndexRange}">
          <Initialization range="${audioInitRange}" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>`;
        }
    }

    console.log(`[MPD] Building DASH manifest: ${validVideoStreams.length} video representations (max ${validVideoStreams[0]?.height}p), audio: ${audioAdaptationSet ? 'included (ExoPlayer unified A/V)' : 'none'}`);

    return `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:full:2011" minBufferTime="PT1.5S" type="static" mediaPresentationDuration="${durationStr}">
  <Period>
    <AdaptationSet id="0" contentType="video" mimeType="video/mp4" subsegmentAlignment="true" startWithSAP="1" scanType="progressive">
${videoReps}
    </AdaptationSet>${audioAdaptationSet}
  </Period>
</MPD>`.trim();
}

const tryPipedVideoStreams = async (instance: string, videoId: string): Promise<ExtractedVideoResult> => {
    const res = await axios.get(`${instance}/streams/${videoId}`, {
        timeout: 4000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const videoStreams: any[] = res.data?.videoStreams || [];
    const audioStreams: any[] = res.data?.audioStreams || [];
    const bestAudio = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null;

    const validStreams = videoStreams.filter((s: any) => Boolean(s.url));
    if (validStreams.length === 0) {
        throw new Error('No video streams from Piped');
    }
    const streams: ExtractedVideoStream[] = validStreams.map((s: any) => {
        const height = s.height || parseInt(s.quality, 10) || 360;
        const width = s.width || Math.round(height * (16 / 9));
        const hasAudio = !s.videoOnly;
        return {
            url: s.url,
            height,
            width,
            quality: s.quality || `${height}p`,
            qualityKey: heightToQualityKey(height, width),
            has_audio: hasAudio,
            streamType: 'mp4' as const,
            mimeType: s.mimeType,
            audio_url: hasAudio ? null : (bestAudio?.url || null),
            bitrate: s.bitrate,
            initRange: s.initRange,
            indexRange: s.indexRange,
        };
    });
    const seen = new Set<number>();
    const unique: ExtractedVideoStream[] = [];
    for (const s of streams) {
        if (!seen.has(s.height)) {
            seen.add(s.height);
            unique.push(s);
        }
    }
    unique.sort((a, b) => b.height - a.height);
    const duration = res.data?.duration || 0;
    const mpdXml = buildDashMpdXml(unique, bestAudio, duration);
    let dashMpdUri: string | null = null;
    if (mpdXml) {
        try {
            const manifestPath = `${RNFS.CachesDirectoryPath}/dash_${videoId}.mpd`;
            await RNFS.writeFile(manifestPath, mpdXml, 'utf8');
            dashMpdUri = `file://${manifestPath}`;
        } catch (_) {
            dashMpdUri = 'data:application/dash+xml;charset=utf-8,' + encodeURIComponent(mpdXml);
        }
    }

    return {
        url: dashMpdUri || unique[0].url,
        quality: unique[0].quality,
        duration,
        streamType: dashMpdUri ? 'mpd' : 'mp4',
        streams: unique,
        audioUrl: bestAudio?.url || null,
        dashUrl: dashMpdUri,
    };
};

const tryInvidiousVideoStreams = async (instance: string, videoId: string): Promise<ExtractedVideoResult> => {
    const res = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
        timeout: 4000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const adaptiveFormats: any[] = res.data?.adaptiveFormats || [];
    const formatStreams: any[] = res.data?.formatStreams || [];
    const allFormats = [...adaptiveFormats, ...formatStreams];

    const audioStreams = allFormats.filter((f: any) => f.url && f.type && f.type.startsWith('audio/'));
    const bestAudio = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null;

    const videoOnly = allFormats.filter((f: any) => f.url && (f.type?.startsWith('video/') || f.resolution || f.qualityLabel));
    if (videoOnly.length === 0) {
        throw new Error('No video streams from Invidious');
    }
    const streams: ExtractedVideoStream[] = videoOnly.map((s: any) => {
        const height = s.height || parseInt(s.resolution || s.qualityLabel, 10) || 360;
        const width = s.width || Math.round(height * (16 / 9));
        const hasAudio = Boolean(s.audioQuality || (!s.type?.startsWith('video/') && s.hasAudio));
        return {
            url: s.url,
            height,
            width,
            quality: s.resolution || s.qualityLabel || `${height}p`,
            qualityKey: heightToQualityKey(height, width),
            has_audio: hasAudio,
            streamType: 'mp4' as const,
            mimeType: s.type || s.container,
            audio_url: hasAudio ? null : (bestAudio?.url || null),
            bitrate: s.bitrate,
            initRange: s.initRange,
            indexRange: s.indexRange,
        };
    });
    const seen = new Set<number>();
    const unique: ExtractedVideoStream[] = [];
    for (const s of streams) {
        if (!seen.has(s.height)) {
            seen.add(s.height);
            unique.push(s);
        }
    }
    unique.sort((a, b) => b.height - a.height);
    const duration = res.data?.lengthSeconds || 0;
    const mpdXml = buildDashMpdXml(unique, bestAudio, duration);
    let dashMpdUri: string | null = null;
    if (mpdXml) {
        try {
            const manifestPath = `${RNFS.CachesDirectoryPath}/dash_${videoId}.mpd`;
            await RNFS.writeFile(manifestPath, mpdXml, 'utf8');
            dashMpdUri = `file://${manifestPath}`;
        } catch (_) {
            dashMpdUri = 'data:application/dash+xml;charset=utf-8,' + encodeURIComponent(mpdXml);
        }
    }

    return {
        url: dashMpdUri || unique[0].url,
        quality: unique[0].quality,
        duration,
        streamType: dashMpdUri ? 'mpd' : 'mp4',
        streams: unique,
        audioUrl: bestAudio?.url || null,
        dashUrl: dashMpdUri,
    };
};

// Client-side progressive video extractor (with both audio and video muxed)
export const extractVideoStreamUrlClientSide = async (
    videoId: string
): Promise<ExtractedVideoResult> => {
    // ── STEP 0: Direct mobile watch-page extraction (Rave architecture) ──
    // Fetches m.youtube.com which delivers ALL adaptive formats (144p→4K) with
    // signatureCipher, initRange, and indexRange — essential for building a valid
    // ISO/IEC 23009-1 SegmentBase DASH MPD that ExoPlayer loads natively.
    //
    // Previously used extractVideo() → extractVideoViaWorker(), but the worker
    // only handles 'preprocess'/'decipher' RPCs — it has no 'extractVideo' action.
    // That caused STEP 0 to always fail, so InnerTube fallback formats (no initRange/
    // indexRange) were used, buildDashMpdXml filtered them all out, and DASH never loaded.
    // extractVideoDirect() runs in the RN process with the same IP/UA as the CDN URLs.
    try {
        // Use extractVideo (not extractVideoDirect) so the in-flight deduplication map
        // prevents two parallel callers from firing duplicate watch-page + ANDROID API fetches.
        const workerResult = await YouTubeDecipherService.extractVideo(videoId);
        if (workerResult && workerResult.formats && workerResult.formats.length > 0) {
            const duration = workerResult.duration || 0;
            const allFmts = workerResult.formats;

            // ── Best audio: deciphered MWEB adaptive audio (AAC mp4a) ─────────────
            const audioFmts = allFmts.filter((f: any) =>
                f.url && typeof f.url === 'string' && f.url.startsWith('http') &&
                !f.url.includes('[object Object]') &&
                f.mimeType && f.mimeType.startsWith('audio/')
            );
            const bestAudio = audioFmts.sort((a: any, b: any) => {
                const aIsMp4 = a.mimeType?.includes('mp4a') ? 100000 : 0;
                const bIsMp4 = b.mimeType?.includes('mp4a') ? 100000 : 0;
                return (b.bitrate || 0) + bIsMp4 - ((a.bitrate || 0) + aIsMp4);
            })[0] || null;

            const videoFmts = allFmts.filter((f: any) =>
                f.url && typeof f.url === 'string' && f.url.startsWith('http') &&
                !f.url.includes('[object Object]') &&
                (f.mimeType?.startsWith('video/') || f.height)
            );
            if (videoFmts.length > 0) {
                const streamObjects: ExtractedVideoStream[] = videoFmts.map((f: any) => {
                    const height = f.height || parseInt(f.qualityLabel, 10) || 360;
                    const width = f.width || Math.round(height * (16 / 9));
                    const hasAudio = Boolean(f.audioChannels || f.audioQuality || f.hasAudio);

                    return {
                        url: f.url,
                        height,
                        width,
                        quality: f.qualityLabel || `${height}p`,
                        qualityKey: heightToQualityKey(height, width),
                        has_audio: hasAudio,
                        streamType: 'mp4' as const,
                        mimeType: f.mimeType,
                        audio_url: hasAudio ? null : (bestAudio?.url || null),
                        bitrate: f.bitrate,
                        initRange: f.initRange,
                        indexRange: f.indexRange,
                        itag: f.itag,
                    } as any;
                });

                const dashHeightMap = new Map<number, ExtractedVideoStream>();
                let progressiveMuxed: ExtractedVideoStream | null = null;

                streamObjects.forEach(s => {
                    if (s.has_audio && !progressiveMuxed) {
                        progressiveMuxed = s;
                    }

                    // For DASH: must have valid initRange and indexRange and be MP4 H.264
                    const hasRanges = Boolean(s.initRange && s.indexRange);
                    if (hasRanges && (s.height || 0) <= 1440) {
                        const isMp4 = !s.mimeType || s.mimeType.startsWith('video/mp4') || s.mimeType.includes('avc1');
                        if (isMp4) {
                            const existing = dashHeightMap.get(s.height);
                            const isAvc = Boolean(s.mimeType?.includes('avc1'));
                            const existIsAvc = Boolean(existing?.mimeType?.includes('avc1'));
                            if (!existing) {
                                dashHeightMap.set(s.height, s);
                            } else if (isAvc && !existIsAvc) {
                                dashHeightMap.set(s.height, s);
                            } else if ((isAvc === existIsAvc) && (s.bitrate || 0) > (existing.bitrate || 0)) {
                                dashHeightMap.set(s.height, s);
                            }
                        }
                    }
                });

                const dashStreams = Array.from(dashHeightMap.values()).sort((a, b) => b.height - a.height);

                // uniqueStreams for UI includes all DASH streams plus progressive stream
                const uniqueStreams = [...dashStreams];
                if (progressiveMuxed && !uniqueStreams.some(s => s.has_audio)) {
                    uniqueStreams.push(progressiveMuxed);
                }

                console.log(`✅ [DirectExtract] ${dashStreams.length} DASH qualities (Max: ${dashStreams[0]?.height}p), progressive: ${progressiveMuxed ? (progressiveMuxed as ExtractedVideoStream).height + 'p' : 'none'}`);

                let dashMpdUri: string | null = null;
                try {
                    // Audio is included in the DASH manifest so ExoPlayer handles both video
                    // AND audio through a single unified player using deciphered MWEB streams with PO-token.
                    const mpdXml = buildDashMpdXml(dashStreams, bestAudio, duration);
                    if (mpdXml) {
                        const filePath = `${RNFS.CachesDirectoryPath}/dash_${videoId}.mpd`;
                        await RNFS.writeFile(filePath, mpdXml, 'utf8');
                        dashMpdUri = `file://${filePath}`;
                        console.log(`✅ [DirectExtract] DASH MPD written → ExoPlayer quality switching ready`);
                    } else {
                        console.warn(`⚠️ [DirectExtract] buildDashMpdXml returned null — falling back to progressive.`);
                    }
                } catch (writeErr: any) {
                    console.error('❌ [DirectExtract] DASH MPD file write error:', writeErr?.message || writeErr);
                    try {
                        const mpdXml = buildDashMpdXml(dashStreams, bestAudio, duration);
                        if (mpdXml) {
                            dashMpdUri = 'data:application/dash+xml;charset=utf-8,' + encodeURIComponent(mpdXml);
                            console.log('✅ [DirectExtract] DASH data URI fallback ready');
                        }
                    } catch (fallbackErr: any) {
                        console.error('❌ [DirectExtract] DASH fallback build error:', fallbackErr?.message || fallbackErr);
                    }
                }

                const bestStream = uniqueStreams[0];
                const progUrl = (progressiveMuxed as ExtractedVideoStream | null)?.url || null;
                return {
                    url: dashMpdUri || progUrl || bestStream.url,
                    quality: bestStream.quality,
                    duration,
                    title: workerResult.title,
                    channelTitle: workerResult.channelTitle,
                    streamType: dashMpdUri ? 'mpd' : 'mp4',
                    streams: uniqueStreams,
                    audioUrl: bestAudio?.url || null,
                    dashUrl: dashMpdUri,
                    fallbackProgressiveUrl: workerResult.androidProgressiveUrl || progUrl,
                };
            }
        }
    } catch (workerErr: any) {
        console.warn('⚠️ [DirectExtract] extractVideoDirect failed, proceeding to InnerTube:', workerErr?.message || workerErr);
    }


    const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player';
    const API_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
    const clientProfiles: any[] = [
        {
            name: 'ANDROID_VR',
            version: '1.61.48',
            userAgent: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.19.68.583344686 SamsungBrowser/4.0 Chrome/122.0.6261.136 Mobile VR Safari/537.36',
            extraContext: { deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12' },
            isMobile: true
        },
        {
            name: 'WEB_EMBEDDED_PLAYER',
            version: '1.20240916.01.00',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            extraContext: {},
            thirdParty: { embedUrl: 'https://www.youtube.com' }
        },
        {
            name: 'WEB',
            version: '2.20240916.01.00',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            extraContext: {}
        },
        {
            name: 'MWEB',
            version: '2.20240916.01.00',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
            extraContext: {}
        },
        {
            name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            version: '2.0',
            userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
            extraContext: {},
            thirdParty: { embedUrl: 'https://www.youtube.com' }
        },
        {
            name: 'TVHTML5',
            version: '7.20240916.15.00',
            userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
            extraContext: {}
        },
        {
            name: 'IOS',
            version: '19.29.1',
            userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
            extraContext: { deviceModel: 'iPhone16,2' },
            isMobile: true
        },
        {
            name: 'ANDROID',
            version: '21.02.35',
            userAgent: 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip',
            extraContext: { androidSdkVersion: 30 },
            isMobile: true
        }
    ];

    let innerTubeFallback: ExtractedVideoResult | null = null;

    for (const client of clientProfiles) {
        try {
            const clientObj: any = {
                hl: 'en',
                gl: 'US',
                clientName: client.name,
                clientVersion: client.version,
                ...client.extraContext,
            };
            if (!client.isMobile) {
                clientObj.originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
            }

            const body: any = {
                context: {
                    client: clientObj,
                },
                videoId,
                racyCheckOk: true,
                contentCheckOk: true,
            };

            if (client.thirdParty) {
                body.context.thirdParty = client.thirdParty;
            }

            if (!client.isMobile) {
                body.playbackContext = {
                    contentPlaybackContext: {
                        html5Preference: 'HTML5_PREF_WANTS',
                    },
                };
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': client.userAgent,
            };
            if (!client.isMobile) {
                headers['Origin'] = 'https://www.youtube.com';
                headers['Referer'] = `https://www.youtube.com/watch?v=${videoId}`;
                if (client.name === 'WEB' || client.name === 'WEB_EMBEDDED_PLAYER') {
                    headers['X-YouTube-Client-Name'] = '1';
                    headers['X-YouTube-Client-Version'] = client.version;
                } else if (client.name === 'MWEB') {
                    headers['X-YouTube-Client-Name'] = '2';
                    headers['X-YouTube-Client-Version'] = client.version;
                }
            }

            console.log(`📡 [InnerTube - ${client.name}] Sending request for ${videoId}...`);
            let response = await fetch(`${INNERTUBE_API_URL}?key=${API_KEY}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            if (response.status !== 200) {
                // Try Rave's googleapis endpoint as fallback
                response = await fetch(`https://youtubei.googleapis.com/youtubei/v1/player?key=${API_KEY}&prettyPrint=false`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }
            console.log(`📡 [InnerTube - ${client.name}] Response status: ${response.status}`);

            if (response.status === 200) {
                const playerResponse = await response.json();
                const playability = playerResponse.playabilityStatus?.status || 'UNKNOWN';
                console.log(`📡 [InnerTube - ${client.name}] Playability: ${playability}, streamingData: ${Boolean(playerResponse.streamingData)}, adaptive: ${playerResponse.streamingData?.adaptiveFormats?.length || 0}`);
                const streamingData = playerResponse.streamingData;
                if (streamingData) {
                    const duration = parseInt(playerResponse.videoDetails?.lengthSeconds || '0', 10);
                    const adaptiveFormats: any[] = streamingData.adaptiveFormats || [];
                    const muxedFormats: any[] = streamingData.formats || [];
                    const allRawFormats: any[] = [...adaptiveFormats, ...muxedFormats];

                    // 1. Collect formats requiring Rave signature deciphering or n-parameter transformation
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
                                isCipher,
                            });
                        }
                    }

                    // 2. Perform client-side Rave AST deciphering via background worker
                    if (itemsToDecipher.length > 0) {
                        try {
                            const deciphered = await YouTubeDecipherService.decipherFormats(itemsToDecipher, videoId);
                            for (const dec of deciphered) {
                                const meta = formatMetaMap.get(dec.itag);
                                if (meta && meta.rawUrl) {
                                    try {
                                        const parsed = new URL(meta.rawUrl);
                                        if (dec.newN) {
                                            parsed.searchParams.set('n', dec.newN);
                                        }
                                        if (dec.newSig) {
                                            parsed.searchParams.set(meta.sp || 'sig', dec.newSig);
                                        }
                                        if (meta.isCipher) {
                                            if (dec.newSig) {
                                                meta.url = parsed.toString();
                                            }
                                        } else {
                                            meta.url = parsed.toString();
                                        }
                                    } catch (_) {}
                                }
                            }
                        } catch (decErr: any) {
                            console.warn('⚠️ [YouTubeDecipherService] Decipher warning:', decErr?.message || decErr);
                        }
                    }

                    const validFormats = Array.from(formatMetaMap.values()).filter((f: any) => Boolean(f.url));

                    // 3. Extract best audio stream (M4A / AAC preferred for universal DASH / ExoPlayer compatibility)
                    const audioFormats = validFormats.filter(
                        (f: any) => f.url && f.mimeType && f.mimeType.startsWith('audio/')
                    );
                    const bestAudio = audioFormats.sort((a: any, b: any) => {
                        const aIsMp4 = a.mimeType?.includes('mp4a') ? 100000 : 0;
                        const bIsMp4 = b.mimeType?.includes('mp4a') ? 100000 : 0;
                        return (b.bitrate || 0) + bIsMp4 - ((a.bitrate || 0) + aIsMp4);
                    })[0] || null;

                    // 4. Extract all video formats (both adaptive up to 4K and muxed)
                    const rawVideoList: any[] = validFormats.filter(
                        (f: any) => f.url && (f.mimeType?.startsWith('video/') || f.height)
                    );

                    if (rawVideoList.length > 0) {
                        const streamObjects: ExtractedVideoStream[] = rawVideoList.map((f: any) => {
                            const height = f.height || (parseInt(f.qualityLabel, 10) || 360);
                            const hasAudio = Boolean(f.audioChannels || f.audioQuality || (!f.mimeType?.startsWith('video/') && f.hasAudio));
                            return {
                                url: f.url,
                                height,
                                width: f.width || Math.round(height * (16 / 9)),
                                quality: f.qualityLabel || `${height}p`,
                                qualityKey: heightToQualityKey(height, f.width || Math.round(height * (16 / 9))),
                                has_audio: hasAudio,
                                streamType: 'mp4' as const,
                                mimeType: f.mimeType,
                                audio_url: hasAudio ? null : (bestAudio?.url || null),
                                bitrate: f.bitrate,
                                initRange: f.initRange,
                                indexRange: f.indexRange,
                            };
                        });

                        // Deduplicate by height keeping highest bitrate
                        const heightMap = new Map<number, ExtractedVideoStream>();
                        streamObjects.forEach(s => {
                            const existing = heightMap.get(s.height);
                            if (!existing || (s.bitrate || 0) > (existing.bitrate || 0)) {
                                heightMap.set(s.height, s);
                            }
                        });

                        const uniqueStreams = Array.from(heightMap.values()).sort((a, b) => b.height - a.height);

                        // Build DASH MPD manifest directly to a local cache file (er.md)
                        let dashMpdUri: string | null = null;
                        try {
                            const mpdXml = buildDashMpdXml(uniqueStreams, bestAudio, duration);
                            if (mpdXml) {
                                const manifestPath = `${RNFS.CachesDirectoryPath}/dash_${videoId}.mpd`;
                                await RNFS.writeFile(manifestPath, mpdXml, 'utf8');
                                dashMpdUri = `file://${manifestPath}`;
                            }
                        } catch (mpdErr) {
                            console.warn('⚠️ [InnerTube Video] DASH manifest build failed:', mpdErr);
                        }

                        const bestStream = uniqueStreams[0];
                        // If no DASH manifest, prefer a stream with audio so ExoPlayer does not play silently
                        const streamWithAudio = uniqueStreams.find(s => s.has_audio);
                        const fallbackPlayableUrl = dashMpdUri || (streamWithAudio ? streamWithAudio.url : bestStream.url);

                        const itResult: ExtractedVideoResult = {
                            url: fallbackPlayableUrl,
                            quality: dashMpdUri ? bestStream.quality : (streamWithAudio?.quality || bestStream.quality),
                            duration: duration || 0,
                            streamType: dashMpdUri ? 'mpd' : 'mp4',
                            streams: uniqueStreams,
                            audioUrl: bestAudio?.url || null,
                            dashUrl: dashMpdUri,
                            fallbackProgressiveUrl: streamWithAudio?.url || null,
                        };

                        console.log(`✅ [InnerTube Video - ${client.name}] Found ${uniqueStreams.length} qualities (Max: ${bestStream.height}p, DASH: ${Boolean(dashMpdUri)}, hasAudio: ${Boolean(dashMpdUri || streamWithAudio)})`);
                        if (bestStream.height >= 720 && (dashMpdUri || streamWithAudio)) {
                            return itResult;
                        }
                        innerTubeFallback = itResult;
                    }
                }
            } else {
                console.warn(`⚠️ [InnerTube - ${client.name}] Failed with HTTP ${response.status}`);
            }
        } catch (e: any) {
            console.warn(`⚠️ [InnerTube Video - ${client.name}] Error:`, e?.message || e);
        }
    }

    // Try parallel public Piped / Invidious instances to find additional/higher qualities
    const trials: Promise<ExtractedVideoResult>[] = [];
    PIPED_INSTANCES.forEach(instance => {
        trials.push(tryPipedVideoStreams(instance, videoId));
    });
    INVIDIOUS_INSTANCES.forEach(instance => {
        trials.push(tryInvidiousVideoStreams(instance, videoId));
    });

    try {
        const publicResult = await promiseAny(trials);
        console.log(`✅ [Client-Side Extraction] Public instance extraction success: ${publicResult.quality} (${publicResult.streams.length} qualities)`);

        // If we also had InnerTube streams, merge them seamlessly
        if (innerTubeFallback && innerTubeFallback.streams.length > 0) {
            const mergedMap = new Map<number, ExtractedVideoStream>();
            // Add public streams first
            publicResult.streams.forEach(s => mergedMap.set(s.height, s));
            // Add InnerTube streams if not already present
            innerTubeFallback.streams.forEach(s => {
                if (!mergedMap.has(s.height)) {
                    mergedMap.set(s.height, s);
                }
            });
            const mergedStreams = Array.from(mergedMap.values()).sort((a, b) => b.height - a.height);
            return {
                url: mergedStreams[0].url,
                quality: mergedStreams[0].quality,
                duration: publicResult.duration || innerTubeFallback.duration || 0,
                streamType: 'mp4',
                streams: mergedStreams,
            };
        }

        return publicResult;
    } catch (e: any) {
        // If public extractors failed but InnerTube had a working stream (e.g. 360p), use InnerTube!
        if (innerTubeFallback && innerTubeFallback.url) {
            console.log(`ℹ️ [Client-Side Extraction] Using InnerTube fallback (${innerTubeFallback.quality})`);
            return innerTubeFallback;
        }
        console.warn('❌ [Client-Side Extraction] All video extractors failed:', e?.message || e);
        throw new Error('All video stream extraction methods failed');
    }
};

let isPlayerSetup = false;

export const setupPlayer = () => {
    if (isPlayerSetup) return;
    try {
        // v5: setupPlayer is synchronous — no await needed
        TrackPlayer.setupPlayer({
            android: {
                taskRemovedBehavior: 'stop',
            },
        });

        TrackPlayer.setCommands({
            capabilities: [
                PlayerCommand.PlayPause,
                PlayerCommand.Next,
                PlayerCommand.Previous,
                PlayerCommand.Seek,
                PlayerCommand.Stop,
            ],
        });
        isPlayerSetup = true;
    } catch (e: any) {
        if (e?.message?.includes('already set up') || e?.message?.includes('already initialized')) {
            isPlayerSetup = true;
            return;
        }
        console.warn('Player setup warning:', e?.message || e);
    }
};

export const playYouTubeVideo = async (
    videoId: string,
    title: string,
    artist: string,
    thumbnail: string,
    source?: string,
    onAudioReady?: () => void,
    autoplay: boolean = true
): Promise<boolean> => {
    // ── YouTube: IFrame WebView owns the audio. MusicForegroundService keeps
    //            the process alive. TrackPlayer is NOT used for this path. ──
    if (!source || source === 'youtube') {
        console.log('🎵 [AUDIO] YouTube video — TrackPlayer skipped, IFrame WebView owns audio');
        onAudioReady?.();
        return true;
    }

    // ── Drive: WebView handles its own audio, nothing to do here ──
    if (source === 'drive') {
        console.log('🎵 [AUDIO] Drive video — skipping TrackPlayer, WebView handles audio');
        return true;
    }

    // ✅ NEW: claim a generation token for this specific call.
    // If a newer call starts (or cancelCurrentLoad() is invoked) before we
    // finish resolving the stream URL, `myGeneration` will no longer match
    // `loadGeneration` and we bail out before touching TrackPlayer.
    loadGeneration++;
    const myGeneration = loadGeneration;
    const isStale = () => myGeneration !== loadGeneration;

    let url: string | null = null;
    let duration: number = 0;
    let clientErrorMsg = '';

    const tryBackend = async (clientError?: string) => {
        console.log('🎵 [AUDIO] Trying backend for stream URL extraction...');
        const response = await api.post('/youtube/stream/', { 
            videoId,
            clientError: clientError || ''
        });
        if (!response.data || !response.data.url) {
            throw new Error('No stream URL returned from backend');
        }
        return {
            url: response.data.url,
            duration: response.data.duration || 0,
        };
    };

    const tryClientSide = async () => {
        const clientExtraction = await extractStreamUrlClientSide(videoId);
        if (clientExtraction && clientExtraction.url) {
            return clientExtraction;
        }
        throw new Error('Client-side extraction returned null or invalid data');
    };

    // ── Strategy Selection based on environment ──
    if (isDev) {
        // In local development, backend is extremely fast and unblocked. Try it first.
        try {
            const res = await tryBackend();
            url = res.url;
            duration = res.duration;
            console.log('🎵 [AUDIO] Successfully loaded stream URL from local backend');
        } catch (e: any) {
            console.warn('⚠️ [AUDIO] Local backend stream fetch failed, falling back to client-side...', e?.message || e);
            try {
                const res = await tryClientSide();
                url = res.url;
                duration = res.duration;
            } catch (err: any) {
                console.error('❌ [AUDIO] All resolution methods failed in DEV:', err);
            }
        }
    } else {
        // In production (Render), backend is blocked. Try client-side first.
        try {
            const res = await tryClientSide();
            url = res.url;
            duration = res.duration;
            console.log('🎵 [AUDIO] Successfully loaded stream URL via client-side extraction');
        } catch (e: any) {
            clientErrorMsg = e?.message || String(e);
            console.warn('⚠️ [AUDIO] Client-side extraction failed in PROD, falling back to backend...', clientErrorMsg);
            try {
                const res = await tryBackend(clientErrorMsg);
                url = res.url;
                duration = res.duration;
            } catch (err) {
                console.error('❌ [AUDIO] All resolution methods failed in PROD:', err);
            }
        }
    }

    // ✅ NEW: bail out if a newer load superseded us while we were awaiting
    // network calls above. Do NOT call onAudioReady() here either — that
    // callback belongs to whoever is still actually waiting on us, and
    // that's not us anymore.
    if (isStale()) {
        console.log('🎵 [AUDIO] Discarding stale load result for', videoId, '(superseded)');
        return true;
    }

    if (!url) {
        onAudioReady?.()
        console.warn('🎵 [AUDIO] No stream URL resolved — TrackPlayer will be silent');
        return false;
    }

    try {
        // ✅ NEW: re-check staleness right before committing — setMediaItem/play
        // are the operations that actually clobber state, so this is the last
        // possible moment to skip them.
        if (isStale()) {
            console.log('🎵 [AUDIO] Discarding stale load right before commit for', videoId);
            return true;
        }

        // v5: setMediaItem() replaces the queue atomically (clear + add in one call)
        // All queue/playback APIs are synchronous in v5 — no await
        TrackPlayer.setMediaItem({
            mediaId: videoId,
            url: url,
            title: title,
            artist: artist,
            artworkUrl: thumbnail,
            duration: duration,
        });

        // ✅ FIX: only auto-play if explicitly requested. setMediaItem()
        // already starts buffering in the background regardless — this
        // just controls whether playback begins immediately or waits for
        // the caller (MusicRoomScreen) to confirm the video side is also
        // ready, so both engines start at the same instant instead of
        // audio racing ahead.
        if (autoplay) {
            TrackPlayer.play();
            console.log('🎵 [AUDIO] TrackPlayer playing:', title);
        } else {
            console.log('🎵 [AUDIO] TrackPlayer prepared (autoplay deferred):', title);
        }
        return true;
    } catch (error) {
        console.error('🎵 [AUDIO] TrackPlayer setMediaItem/play error:', error);
        if (!isStale()) {
            onAudioReady?.();
        }
        return false;
    }
};

// ─────────────────────────────────────────────────────────────────────────
// Loads any direct stream URL (e.g. Google Drive CDN) into TrackPlayer
// without any Piped/Invidious extraction. Used by Drive videos so they
// participate in the same rendezvous + DJ sync as YouTube tracks.
// ─────────────────────────────────────────────────────────────────────────
export const playDirectUrl = (
    url: string,
    headers: Record<string, string>,
    title: string,
    artist: string,
    thumbnail: string,
    duration: number,
    autoplay: boolean = false
) => {
    loadGeneration++;
    const myGeneration = loadGeneration;
    console.log('🎵 [DRIVE AUDIO] Loading direct CDN URL into TrackPlayer');
    try {
        if (myGeneration !== loadGeneration) return;
        TrackPlayer.setMediaItem({
            mediaId: url, // use url as id — unique per resolved CDN session
            url,
            headers,
            title,
            artist,
            artworkUrl: thumbnail,
            duration,
        } as any);
        if (autoplay) {
            TrackPlayer.play();
            console.log('🎵 [DRIVE AUDIO] TrackPlayer playing directly:', title);
        } else {
            console.log('🎵 [DRIVE AUDIO] TrackPlayer prepared (autoplay deferred):', title);
        }
    } catch (error) {
        console.error('🎵 [DRIVE AUDIO] TrackPlayer setMediaItem error:', error);
    }
};

// ✅ NEW: the real fix for "notification survives leaving the room while the
// app stays open." Confirmed against the native TrackPlayerModule/
// TrackPlayerPlaybackService source:
//   - TrackPlayer.stop() only calls ExoPlayer.stop() on the active player —
//     halts playback, resets position, but the queue/media item stays set,
//     and Media3's MediaSessionService keeps the foreground notification
//     alive as long as a media item exists in the session.
//   - TrackPlayer.destroy() only releases the JS-side MediaController
//     handle — it never touches the session/service/notification at all.
//   - TrackPlayer.clear() calls clearMediaItems(), which empties the
//     queue. With the queue empty (mediaItemCount === 0), Media3's stock
//     DefaultMediaNotificationProvider (used by this package, unmodified)
//     stops showing the notification — this is the actual lever.
// Call this instead of TrackPlayer.stop()/destroy() whenever leaving the
// room should fully end the session (not just pause it).
export const endSession = () => {
    cancelCurrentLoad();
    try {
        TrackPlayer.pause();
    } catch (_) {}
    try {
        // Empties the queue — this is what actually makes the stock Media3
        // notification provider drop the foreground notification.
        TrackPlayer.clear();
    } catch (_) {}
    try {
        TrackPlayer.stop();
    } catch (_) {}
};

export default {
    setupPlayer,
    playYouTubeVideo,
    playDirectUrl,
    cancelCurrentLoad,
    endSession,
};