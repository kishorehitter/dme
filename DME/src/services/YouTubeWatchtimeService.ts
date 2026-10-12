/**
 * YouTubeWatchtimeService
 * 
 * Standard YouTube Player Playback & Watchtime Heartbeat Client (Rave architecture).
 * Manages authentic Client Playback Nonces (cpn) and keeps YouTube GVS
 * stream token leases alive past 60 seconds by reporting playback progress
 * with matching client identity (MWEB) and authentic PO-token (&pot=) to
 * YouTube's standard stats endpoints (/api/stats/playback & /api/stats/watchtime).
 */

const CPN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const MWEB_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const MWEB_CLIENT_VERSION = '2.20241118.01.00';
const STATS_BASE_URL = 'https://m.youtube.com/api/stats';

export class YouTubeWatchtimeService {
    private static instance: YouTubeWatchtimeService | null = null;

    private activeVideoId: string = '';
    private activeCpn: string = '';
    private activePoToken: string = '';
    private duration: number = 0;
    private currentPosition: number = 0;
    private isPlaying: boolean = false;
    private sessionStartTime: number = 0;
    private lastPingTime: number = 0;
    private lastPingPosition: number = 0;
    private sequenceNumber: number = 0;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private firstHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
    private cpnCache = new Map<string, string>();

    public static getInstance(): YouTubeWatchtimeService {
        if (!YouTubeWatchtimeService.instance) {
            YouTubeWatchtimeService.instance = new YouTubeWatchtimeService();
        }
        return YouTubeWatchtimeService.instance;
    }

    /**
     * Sets or updates the active BotGuard PO-token for watchtime beacons.
     */
    public setPoToken(token: string): void {
        if (token && typeof token === 'string' && token.length > 0) {
            this.activePoToken = token;
            console.log(`⏱️ [YouTubeWatchtime] PO-Token registered for watchtime: ${token.substring(0, 16)}... (len: ${token.length})`);
        }
    }

    /**
     * Gets the active BotGuard PO-token.
     */
    public getActivePoToken(): string {
        return this.activePoToken;
    }

    /**
     * Generates an authentic 16-character alphanumeric Client Playback Nonce (CPN).
     */
    public generateCPN(): string {
        let cpn = '';
        for (let i = 0; i < 16; i++) {
            const idx = Math.floor(Math.random() * CPN_CHARS.length);
            cpn += CPN_CHARS[idx];
        }
        return cpn;
    }

    /**
     * Gets or creates an active CPN for a video.
     */
    public getOrCreateCPN(videoId: string): string {
        if (!videoId) return this.generateCPN();
        if (this.cpnCache.has(videoId)) {
            return this.cpnCache.get(videoId)!;
        }
        const newCpn = this.generateCPN();
        this.cpnCache.set(videoId, newCpn);
        return newCpn;
    }

    /**
     * Appends &cpn=<nonce> to a googlevideo stream URL if not already present.
     */
    public attachCpnToUrl(url: string, videoId: string): string {
        if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
        if (url.includes('&cpn=') || url.includes('?cpn=')) return url;
        const cpn = this.getOrCreateCPN(videoId);
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}cpn=${cpn}`;
    }

    /**
     * Starts a playback tracking session when a video begins loading/playing.
     * Fires the initial /api/stats/playback endpoint and schedules recurring
     * /api/stats/watchtime heartbeats every 10s to keep the GVS lease permanently alive.
     */
    public async startSession(videoId: string, durationSeconds: number = 0, poToken?: string): Promise<string> {
        if (!videoId) return '';

        if (poToken) {
            this.setPoToken(poToken);
        } else if (!this.activePoToken) {
            try {
                const YouTubeDecipherService = require('./YouTubeDecipherService').default;
                const latestToken = YouTubeDecipherService.getLatestPoToken(videoId);
                if (latestToken) {
                    this.setPoToken(latestToken);
                }
            } catch (_) {}
        }

        // If already tracking this video with the same CPN, update duration & ensure heartbeat is active
        if (this.activeVideoId === videoId && this.activeCpn) {
            this.duration = durationSeconds || this.duration;
            this.isPlaying = true;
            if (!this.heartbeatInterval) {
                this.scheduleHeartbeats();
            }
            return this.activeCpn;
        }

        this.stopSession();

        this.activeVideoId = videoId;
        this.activeCpn = this.getOrCreateCPN(videoId);
        this.duration = Math.max(0, durationSeconds || 0);
        this.currentPosition = 0;
        this.isPlaying = true;
        this.sessionStartTime = Date.now();
        this.lastPingTime = Date.now();
        this.lastPingPosition = 0;
        this.sequenceNumber = 0;

        console.log(`⏱️ [YouTubeWatchtime] Starting MWEB session for ${videoId} with CPN: ${this.activeCpn}, pot: ${this.activePoToken ? this.activePoToken.substring(0, 16) + '...' : 'none'}`);

        // Fire initial playback stats ping
        await this.sendPlaybackPing();

        // Schedule heartbeats: first at 5s, then every 10s
        this.scheduleHeartbeats();

        return this.activeCpn;
    }

    /**
     * Schedules periodic heartbeats to maintain GVS lease buffer.
     */
    private scheduleHeartbeats(): void {
        if (this.firstHeartbeatTimeout) {
            clearTimeout(this.firstHeartbeatTimeout);
            this.firstHeartbeatTimeout = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Initial watchtime ping at 5 seconds
        this.firstHeartbeatTimeout = setTimeout(() => {
            if (this.isPlaying && this.activeVideoId) {
                this.sendWatchtimeHeartbeat('playing');
            }
        }, 5000);

        // Continuous heartbeats every 10 seconds (well within GVS 60s lease window)
        this.heartbeatInterval = setInterval(() => {
            if (this.isPlaying && this.activeVideoId) {
                this.sendWatchtimeHeartbeat('playing');
            }
        }, 10000);
    }

    /**
     * Sends the initial playback start beacon (/api/stats/playback).
     */
    private async sendPlaybackPing(): Promise<void> {
        if (!this.activeVideoId || !this.activeCpn) return;

        try {
            const params = new URLSearchParams({
                ns: 'yt',
                el: 'detailpage',
                cpn: this.activeCpn,
                docid: this.activeVideoId,
                ver: '2',
                cmt: '0.000',
                plid: this.activeCpn,
                fs: '0',
                rt: '0',
                lact: '500',
                c: 'MWEB',
                cver: MWEB_CLIENT_VERSION,
                cplayer: 'UNIPLAYER',
                cbrand: 'google',
                cmodel: 'android',
                cplatform: 'MOBILE',
                ...(this.duration > 0 ? { len: Math.round(this.duration).toString() } : {}),
                ...(this.activePoToken ? { pot: this.activePoToken } : {}),
            });

            const url = `${STATS_BASE_URL}/playback?${params.toString()}`;
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': MWEB_USER_AGENT,
                    'Origin': 'https://m.youtube.com',
                    'Referer': `https://m.youtube.com/watch?v=${this.activeVideoId}`,
                },
            });

            console.log(`⏱️ [YouTubeWatchtime] Playback ping sent (c=MWEB, cpn=${this.activeCpn}, pot=${Boolean(this.activePoToken)}) → HTTP ${res.status}`);
        } catch (err: any) {
            console.warn('⚠️ [YouTubeWatchtime] Playback ping warning:', err?.message || err);
        }
    }

    /**
     * Reports current playback progress and sends periodic watchtime heartbeats.
     */
    public updateProgress(currentTime: number, isPlaying: boolean): void {
        this.currentPosition = currentTime;
        this.isPlaying = isPlaying;

        const now = Date.now();
        const timeSinceLastPing = (now - this.lastPingTime) / 1000;

        // If playing and more than 10 seconds elapsed since last ping, send heartbeat
        if (isPlaying && timeSinceLastPing >= 10) {
            this.sendWatchtimeHeartbeat('playing');
        }
    }

    /**
     * Sends the periodic watchtime heartbeat (/api/stats/watchtime) to keep GVS CDN lease valid.
     */
    public async sendWatchtimeHeartbeat(state: 'playing' | 'paused'): Promise<void> {
        if (!this.activeVideoId || !this.activeCpn) return;

        const now = Date.now();
        const elapsedRealTime = Math.max(0, Math.round((now - this.sessionStartTime) / 1000));
        const cmt = Math.max(0, this.currentPosition).toFixed(3);
        const seq = ++this.sequenceNumber;

        this.lastPingTime = now;
        this.lastPingPosition = this.currentPosition;

        try {
            const params = new URLSearchParams({
                ns: 'yt',
                el: 'detailpage',
                cpn: this.activeCpn,
                docid: this.activeVideoId,
                ver: '2',
                cmt,
                plid: this.activeCpn,
                state,
                fs: '0',
                rt: elapsedRealTime.toString(),
                seq: seq.toString(),
                c: 'MWEB',
                cver: MWEB_CLIENT_VERSION,
                cplayer: 'UNIPLAYER',
                cbrand: 'google',
                cmodel: 'android',
                cplatform: 'MOBILE',
                ...(this.duration > 0 ? { len: Math.round(this.duration).toString() } : {}),
                ...(this.activePoToken ? { pot: this.activePoToken } : {}),
            });

            const url = `${STATS_BASE_URL}/watchtime?${params.toString()}`;
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': MWEB_USER_AGENT,
                    'Origin': 'https://m.youtube.com',
                    'Referer': `https://m.youtube.com/watch?v=${this.activeVideoId}`,
                },
            });

            console.log(`⏱️ [YouTubeWatchtime] Watchtime heartbeat (cmt=${cmt}s, rt=${elapsedRealTime}s, seq=${seq}, pot=${Boolean(this.activePoToken)}) → HTTP ${res.status}`);
        } catch (err: any) {
            console.warn('⚠️ [YouTubeWatchtime] Watchtime heartbeat warning:', err?.message || err);
        }
    }

    /**
     * Ends active playback session and clears heartbeat timers.
     */
    public stopSession(): void {
        if (this.firstHeartbeatTimeout) {
            clearTimeout(this.firstHeartbeatTimeout);
            this.firstHeartbeatTimeout = null;
        }

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.activeVideoId && this.activeCpn) {
            console.log(`⏱️ [YouTubeWatchtime] Stopped session for ${this.activeVideoId}`);
        }

        this.activeVideoId = '';
        this.activeCpn = '';
        this.isPlaying = false;
    }
}

export const youtubeWatchtimeService = YouTubeWatchtimeService.getInstance();
