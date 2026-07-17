import { Event } from '@rntp/player';
import TrackPlayer from '@rntp/player';
import { musicWebSocketService } from './MusicWebSocketService';

// v5: PlaybackService is a factory that returns the event handler.
// All TrackPlayer control APIs (play, pause, clear, skipToNext, skipToPrevious)
// are SYNCHRONOUS in v5 — no await needed for the calls themselves.
//
// ✅ FIX: Android's headless task runner (AppRegistry.registerHeadlessTask →
// AppRegistryImpl.startHeadlessTask) ALWAYS calls `.then()` on whatever the
// task function returns — that's how it knows when the headless task is
// done so it can release the wake lock / let the JS VM be torn down.
//
// We now also synchronize remote controls (lock screen / notification) with the
// Watch Together room state if the current user is the room DJ.
export const PlaybackService = () => async (event: any) => {
    const roomState = musicWebSocketService.getLastRoomState();
    const isDJ = roomState?.isDJ || false;

    if (event.type === Event.RemotePlay) {
        TrackPlayer.play();
        if (isDJ) {
            const progress = TrackPlayer.getProgress();
            const pos = progress ? progress.position : 0;
            musicWebSocketService.syncPlayback(pos, true);
        }
    } else if (event.type === Event.RemotePause) {
        TrackPlayer.pause();
        if (isDJ) {
            const progress = TrackPlayer.getProgress();
            const pos = progress ? progress.position : 0;
            musicWebSocketService.syncPlayback(pos, false);
        }
    } else if (event.type === Event.RemoteStop) {
        TrackPlayer.clear();
    } else if (event.type === Event.RemoteNext) {
        if (isDJ) {
            musicWebSocketService.passAux();
        } else {
            TrackPlayer.skipToNext();
        }
    } else if (event.type === Event.RemotePrevious) {
        TrackPlayer.skipToPrevious();
    }
};