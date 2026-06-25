import { Event } from '@rntp/player';
import TrackPlayer from '@rntp/player';

// v5: PlaybackService is a factory that returns the event handler.
// All TrackPlayer control APIs (play, pause, clear, skipToNext, skipToPrevious)
// are SYNCHRONOUS in v5 — no await needed for the calls themselves.
//
// ✅ FIX: Android's headless task runner (AppRegistry.registerHeadlessTask →
// AppRegistryImpl.startHeadlessTask) ALWAYS calls `.then()` on whatever the
// task function returns — that's how it knows when the headless task is
// done so it can release the wake lock / let the JS VM be torn down. The
// previous handler had no return statement, so it implicitly returned
// `undefined` on every invocation. As long as this never actually ran as a
// real headless task (e.g. only foreground remote-control events arrived
// via addEventListener instead), that's harmless. But the moment Android
// invokes it as a genuine headless task — e.g. right as the app transitions
// from background to foreground, as seen in the logs right after
// "dj_background" / "DJ returned to foreground" — `startHeadlessTask` calls
// `.then()` on `undefined` and throws:
//   TypeError: Cannot read property 'then' of undefined
// This is a fatal, uncaught exception on the JS thread, which can abort
// whatever else was queued at that moment — including, we suspect, the
// TrackPlayer.destroy() call this screen schedules on unmount, which would
// explain why the background notification has been surviving room close.
//
// The fix: always return a Promise, even though every individual
// TrackPlayer call here is synchronous. We don't need to await anything —
// we just need the function to resolve once the synchronous work is done.
export const PlaybackService = () => async (event: any) => {
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
    // Implicit return of an async function is already a resolved Promise —
    // no explicit `return` needed, but stated here for clarity: this
    // function's return value is ALWAYS a Promise now, satisfying
    // startHeadlessTask's `.then()` call no matter which branch (or no
    // branch) above ran.
};