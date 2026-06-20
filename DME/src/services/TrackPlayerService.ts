import TrackPlayer, { PlayerCommand } from '@rntp/player';
import api from './api';

export const setupPlayer = () => {
    try {
        // v5: setupPlayer is synchronous — no await needed
        TrackPlayer.setupPlayer();

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
    source?: string
) => {
    // ── Drive: WebView handles its own audio, nothing to do here ──
    if (source === 'drive') {
        console.log('🎵 [AUDIO] Drive video — skipping TrackPlayer, WebView handles audio');
        return;
    }

    // ── YouTube: fetch stream URL from backend, hand to TrackPlayer ──
    try {
        const response = await api.post('/youtube/stream/', { videoId });
        const { url, duration } = response.data;

        if (!url) {
            console.warn('🎵 [AUDIO] No stream URL returned — TrackPlayer will be silent');
            return;
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

        TrackPlayer.play();
        console.log('🎵 [AUDIO] TrackPlayer playing:', title);
    } catch (error) {
        console.error('🎵 [AUDIO] Stream fetch failed (bot detection?):', error);
    }
};

export default {
    setupPlayer,
    playYouTubeVideo,
};
