package com.DME;

import android.content.Intent;
import android.os.Build;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class MusicServiceModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;
    private static ReactApplicationContext reactContextStatic = null;

    public MusicServiceModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        reactContextStatic = reactContext;
    }

    public static void sendEvent(String eventName) {
        sendEvent(eventName, null);
    }

    public static void sendEvent(String eventName, com.facebook.react.bridge.WritableMap params) {
        if (reactContextStatic != null) {
            try {
                reactContextStatic
                    .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
            } catch (Exception e) {
                // Context might be invalid/destroyed
            }
        }
    }

    @Override
    public String getName() {
        return "MusicService";
    }

    @ReactMethod
    public void startService(String title, String artist, String thumbnail, boolean isPlaying, boolean isDJ) {
        Intent intent = new Intent(reactContext, MusicForegroundService.class);
        intent.setAction(MusicForegroundService.ACTION_START);
        intent.putExtra(MusicForegroundService.EXTRA_TITLE, title);
        intent.putExtra(MusicForegroundService.EXTRA_ARTIST, artist);
        intent.putExtra("thumbnail", thumbnail);
        intent.putExtra(MusicForegroundService.EXTRA_IS_PLAYING, isPlaying);
        intent.putExtra("isDJ", isDJ);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("MusicServiceModule", "Error with foreground service intent: " + e.getMessage());
        }
    }

    @ReactMethod
    public void updatePlaybackState(String title, String artist, String thumbnail, boolean isPlaying, boolean isDJ) {
        startService(title, artist, thumbnail, isPlaying, isDJ);
    }

    @ReactMethod
    public void updatePosition(String title, String artist, String thumbnail, double position, double duration, boolean isDJ, boolean isPlaying) {
        Intent intent = new Intent(reactContext, MusicForegroundService.class);
        intent.setAction(MusicForegroundService.ACTION_UPDATE_POSITION);
        intent.putExtra(MusicForegroundService.EXTRA_TITLE, title);
        intent.putExtra(MusicForegroundService.EXTRA_ARTIST, artist);
        intent.putExtra("thumbnail", thumbnail);
        intent.putExtra("position", (long)(position * 1000));
        intent.putExtra("duration", (long)(duration * 1000));
        intent.putExtra("isDJ", isDJ);
        intent.putExtra(MusicForegroundService.EXTRA_IS_PLAYING, isPlaying);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("MusicServiceModule", "Error with foreground service intent: " + e.getMessage());
        }
    }

    @ReactMethod
    public void stopService() {
        Intent intent = new Intent(reactContext, MusicForegroundService.class);
        intent.setAction(MusicForegroundService.ACTION_STOP);
        reactContext.startService(intent);
    }
}
