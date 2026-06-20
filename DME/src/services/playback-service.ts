import { Event } from '@rntp/player';
import TrackPlayer from '@rntp/player';

// v5: PlaybackService is a factory that returns the event handler.
// All TrackPlayer control APIs (play, pause, clear, skipToNext, skipToPrevious)
// are SYNCHRONOUS in v5 — no await needed.
export const PlaybackService = () => (event: any) => {
    if (event.type === Event.RemotePlay) {
        TrackPlayer.play();
    } else if (event.type === Event.RemotePause) {
        TrackPlayer.pause();
    } else if (event.type === Event.RemoteStop) {
        TrackPlayer.clear();
    } else if (event.type === Event.RemoteNext) {
        TrackPlayer.skipToNext();
    } else if (event.type === Event.RemotePrevious) {
        TrackPlayer.skipToPrevious();
    }
};