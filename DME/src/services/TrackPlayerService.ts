import TrackPlayer, { PlayerCommand } from '@rntp/player';
import axios from 'axios';
import api from './api';

const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.projectsegfau.lt',
    'https://piped.video/api',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.darkness.services',
];

const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.io.lol',
    'https://invidious.privacydev.net',
    'https://iv.ggtyler.dev',
    'https://yewtu.be',
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

// ─────────────────────────────────────────────────────────────────────────────
// InnerTube API extraction — uses YouTube's own internal API with the
// "android" client type. This is the same API yt-dlp uses internally.
//
// Why this works:
//   • The `android` client (ANDROID_TESTSUITE specifically) returns
//     plain, non-ciphered audio stream URLs — no JS decipher needed.
//   • It's an authenticated-app API: YouTube doesn't bot-block it by IP
//     the same way it blocks web scraping from datacenter IPs.
//   • Running from the user's phone (residential IP) makes it even more
//     reliable since it looks exactly like the official YouTube Android app.
//
// Why the old HTML scraping approach failed:
//   • axios on Android is not a browser — YouTube serves a bot/consent page.
//   • Even if ytInitialPlayerResponse was found, most streams use
//     signatureCipher, which requires executing YouTube's obfuscated JS.
//   • Raw cipher URLs are rejected with 403 by YouTube's CDN.
// ─────────────────────────────────────────────────────────────────────────────
const tryInnerTubeExtraction = async (videoId: string): Promise<{ url: string; duration: number } | null> => {
    console.log(`🎵 [InnerTube] Attempting InnerTube API fetch for videoId=${videoId}`);
    try {
        // InnerTube API endpoint — same one YouTube's Android app uses
        const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player';

        // Use ANDROID_TESTSUITE client: returns direct (non-ciphered) stream URLs.
        // clientVersion must match a real version YouTube accepts.
        const requestBody = {
            context: {
                client: {
                    clientName: 'ANDROID_TESTSUITE',
                    clientVersion: '1.9',
                    androidSdkVersion: 30,
                    hl: 'en',
                    gl: 'US',
                    utcOffsetMinutes: 0,
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

        let response;
        try {
            response = await axios.post(
                `${INNERTUBE_API_URL}?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w`,
                requestBody,
                {
                    timeout: 8000,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
                        'X-YouTube-Client-Name': '30',
                        'X-YouTube-Client-Version': '17.31.35',
                        'Origin': 'https://www.youtube.com',
                    },
                }
            );
        } catch (postError: any) {
            const status = postError?.response?.status;
            const statusText = postError?.response?.statusText;
            const errorData = postError?.response?.data;
            console.error(`❌ [InnerTube] Request post failed. Status: ${status} (${statusText}). Data:`, JSON.stringify(errorData));
            throw new Error(`InnerTube post error (status: ${status}): ${postError.message}`);
        }

        if (response.status !== 200 || !response.data) {
            console.error(`❌ [InnerTube] Invalid response status: ${response.status}`);
            throw new Error(`InnerTube returned status ${response.status}`);
        }

        const playerResponse = response.data;

        // Check for playability
        const playabilityStatus = playerResponse.playabilityStatus?.status;
        if (playabilityStatus && playabilityStatus !== 'OK') {
            const reason = playerResponse.playabilityStatus?.reason || '';
            console.error(`❌ [InnerTube] Playability check failed: ${playabilityStatus} — Reason: ${reason}`);
            throw new Error(`Video not playable: ${playabilityStatus} — ${reason}`);
        }

        const streamingData = playerResponse.streamingData;
        if (!streamingData) {
            console.error('❌ [InnerTube] Missing streamingData in response JSON structure.');
            throw new Error('No streamingData in InnerTube response');
        }

        // Prefer adaptiveFormats (higher quality separate audio track)
        // Fall back to formats (muxed) which always have audio
        const adaptiveFormats: any[] = streamingData.adaptiveFormats || [];
        const muxedFormats: any[] = streamingData.formats || [];

        // Filter for audio-only streams from adaptive formats
        const audioStreams = adaptiveFormats.filter(
            (f: any) => f.mimeType && f.mimeType.startsWith('audio/')
        );

        let best: any = null;

        if (audioStreams.length > 0) {
            // Sort by bitrate descending — pick highest quality audio
            best = audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        } else if (muxedFormats.length > 0) {
            // Fall back to a muxed format — audio is included but video quality is lower
            best = muxedFormats.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            console.log('🎵 [InnerTube] No adaptive audio-only streams; using muxed format');
        }

        if (!best) {
            console.error('❌ [InnerTube] Neither adaptive audio nor muxed streams were found.');
            throw new Error('No usable stream found in InnerTube response');
        }

        // With ANDROID_TESTSUITE client, URLs should be direct (no signatureCipher).
        // But handle the cipher case defensively just in case.
        let streamUrl: string | null = best.url || null;

        if (!streamUrl && (best.signatureCipher || best.cipher)) {
            // signatureCipher present — we cannot decode without YouTube's JS.
            // This shouldn't happen with ANDROID_TESTSUITE, but log it clearly.
            console.warn('⚠️ [InnerTube] Unexpected signatureCipher encountered — client version might be too old or blocked.');
            throw new Error('signatureCipher present — cannot decode without JS execution');
        }

        if (!streamUrl) {
            console.error('❌ [InnerTube] Stream URL resolved to null, even though stream format was found.');
            throw new Error('Stream URL is null after InnerTube response parsing');
        }

        const duration = parseInt(playerResponse.videoDetails?.lengthSeconds || '0', 10);
        console.log(`✅ [InnerTube] Extraction success! mimeType=${best.mimeType}, bitrate=${best.bitrate}`);

        return {
            url: streamUrl,
            duration: duration || 0,
        };
    } catch (e: any) {
        console.warn('⚠️ [InnerTube] Failed:', e?.message || e);
        return null;
    }
};

// Resolves stream URL client-side in parallel
const extractStreamUrlClientSide = async (videoId: string): Promise<{ url: string; duration: number } | null> => {
    // 1. Try InnerTube API first — uses YouTube's own internal Android API.
    //    Returns plain (non-ciphered) URLs directly from the user's residential IP.
    const innerTubeResult = await tryInnerTubeExtraction(videoId);
    if (innerTubeResult && innerTubeResult.url) {
        return innerTubeResult;
    }

    console.log(`🎵 [Client-Side Extraction] InnerTube failed, falling back to parallel public instances for videoId=${videoId}`);

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
        console.warn('❌ [Client-Side Extraction] All parallel public extractors failed:', e.message || e);
        return null;
    }
};

export const setupPlayer = () => {
    try {
        // v5: setupPlayer is synchronous — no await needed
        //
        // ✅ FIX (notification surviving app close/swipe-away): confirmed
        // against the real native source (TrackPlayerPlaybackService.kt /
        // PlayerConfig.kt). By default, Android's onTaskRemoved() only
        // tears down the service if playback isn't actively playing or the
        // queue is empty — if you're mid-playback when the task is removed,
        // it deliberately keeps running (so audio survives app-switching,
        // which is correct for podcast/music apps but not for this music
        // room's "leave = end the whole session" requirement). Setting
        // android.taskRemovedBehavior: 'stop' makes onTaskRemoved
        // unconditionally call stopForTaskRemoved() → clearMediaItems() +
        // pauseAllPlayersAndStopSelf(), which is what actually removes the
        // foreground notification when the app's task is killed/swiped away.
        TrackPlayer.setupPlayer({
            android: {
                taskRemovedBehavior: 'stop',
            },
        });

        // v5 uses setCommands() instead of updateOptions()
        // PlayerCommand replaces the old Capability enum
        TrackPlayer.setCommands({
            capabilities: [
                PlayerCommand.PlayPause,
                PlayerCommand.Next,
                PlayerCommand.Previous,
                PlayerCommand.Seek,
                PlayerCommand.Stop,
            ],
        });
    } catch (e) {
        // Already setup — this is expected on fast refresh / re-render
        console.log('Player already setup or error:', e);
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

    const tryBackend = async () => {
        console.log('🎵 [AUDIO] Trying backend for stream URL extraction...');
        const response = await api.post('/youtube/stream/', { videoId });
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
        throw new Error('Client-side extraction failed');
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
            } catch (err) {
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
            console.warn('⚠️ [AUDIO] Client-side extraction failed in PROD, falling back to backend...', e?.message || e);
            try {
                const res = await tryBackend();
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
        });
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