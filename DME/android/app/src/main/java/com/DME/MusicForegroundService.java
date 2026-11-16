package com.DME;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.content.pm.ServiceInfo;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.graphics.Color;
import android.os.PowerManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyManager;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import java.io.InputStream;
import java.net.URL;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

public class MusicForegroundService extends Service {

    public static final String CHANNEL_ID = "music_room_channel";
    public static final String ACTION_START = "ACTION_START";
    public static final String ACTION_STOP = "ACTION_STOP";
    public static final String ACTION_PLAY = "ACTION_PLAY";
    public static final String ACTION_PAUSE = "ACTION_PAUSE";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_IS_PLAYING = "isPlaying";
    public static final String ACTION_UPDATE_POSITION = "ACTION_UPDATE_POSITION";
    public static final String EXTRA_IS_DJ = "isDJ";

    public static MusicForegroundService instance = null;

    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock = null;
    private AudioManager audioManager = null;
    private AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = null;
    private AudioFocusRequest audioFocusRequest = null;
    private boolean hasAudioFocus = false;
    private TelephonyManager telephonyManager = null;
    private PhoneStateListener phoneStateListener = null;

    private final Handler callCheckHandler = new Handler(Looper.getMainLooper());
    private boolean lastWasCall = false;
    private final Runnable callCheckRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (audioManager == null) {
                    audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                }
                if (audioManager != null) {
                    int mode = audioManager.getMode();
                    boolean isCall = (mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_RINGTONE);
                    if (isCall != lastWasCall) {
                        lastWasCall = isCall;
                        if (isCall) {
                            com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(true);
                        } else if (hasAudioFocus) {
                            com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
                        }
                        WritableMap params = Arguments.createMap();
                        params.putBoolean("isCall", isCall);
                        MusicServiceModule.sendEvent("PHONE_CALL_STATE", params);
                    }
                }
            } catch (Exception ignored) {}
            callCheckHandler.postDelayed(this, 500);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();

        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DME:MusicForegroundService");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}

        setupAudioFocus();
        setupPhoneCallListener();

        // Create MediaSession — this is what powers the
        // lockscreen overlay and Android media controls
        mediaSession = new MediaSessionCompat(this, "MusicRoomSession");
        mediaSession.setActive(true);
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                super.onPlay();
                requestAudioFocusInternal();
                com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
                WritableMap params = Arguments.createMap();
                params.putBoolean("interrupted", false);
                MusicServiceModule.sendEvent("EXTERNAL_AUDIO_INTERRUPTION", params);
            }

            @Override
            public void onPause() {
                super.onPause();
                // External media focus loss (other app media or call).
                // DO NOT pause the watch party! Mute audio locally while video keeps playing.
                com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(true);
                WritableMap params = Arguments.createMap();
                params.putBoolean("interrupted", true);
                MusicServiceModule.sendEvent("EXTERNAL_AUDIO_INTERRUPTION", params);
            }
        });
    }

    private void setupAudioFocus() {
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null) return;

        audioFocusChangeListener = new AudioManager.OnAudioFocusChangeListener() {
            @Override
            public void onAudioFocusChange(int focusChange) {
                WritableMap params = Arguments.createMap();
                switch (focusChange) {
                    case AudioManager.AUDIOFOCUS_LOSS:
                        hasAudioFocus = false;
                        com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(true);
                        params.putBoolean("interrupted", true);
                        params.putString("reason", "loss");
                        MusicServiceModule.sendEvent("EXTERNAL_AUDIO_INTERRUPTION", params);
                        break;
                    case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                    case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                        hasAudioFocus = false;
                        com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(true);
                        params.putBoolean("interrupted", true);
                        params.putString("reason", "transient_loss");
                        MusicServiceModule.sendEvent("EXTERNAL_AUDIO_INTERRUPTION", params);
                        break;
                    case AudioManager.AUDIOFOCUS_GAIN:
                        hasAudioFocus = true;
                        com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
                        params.putBoolean("interrupted", false);
                        params.putString("reason", "gain");
                        MusicServiceModule.sendEvent("EXTERNAL_AUDIO_INTERRUPTION", params);
                        break;
                }
            }
        };

        requestAudioFocusInternal();
    }

    public void requestAudioFocusInternal() {
        if (audioManager == null || audioFocusChangeListener == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(playbackAttributes)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener(audioFocusChangeListener)
                        .build();
                int res = audioManager.requestAudioFocus(audioFocusRequest);
                hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
            } else {
                int res = audioManager.requestAudioFocus(audioFocusChangeListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
                hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
            }
        } catch (Exception ignored) {}
    }

    public void abandonAudioFocusInternal() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else if (audioFocusChangeListener != null) {
                audioManager.abandonAudioFocus(audioFocusChangeListener);
            }
            hasAudioFocus = false;
        } catch (Exception ignored) {}
    }

    private void setupPhoneCallListener() {
        try {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            callCheckHandler.post(callCheckRunnable);
        } catch (Exception ignored) {}

        try {
            telephonyManager = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
            if (telephonyManager != null) {
                phoneStateListener = new PhoneStateListener() {
                    @Override
                    public void onCallStateChanged(int state, String phoneNumber) {
                        super.onCallStateChanged(state, phoneNumber);
                        boolean isCall = (state == TelephonyManager.CALL_STATE_RINGING ||
                                          state == TelephonyManager.CALL_STATE_OFFHOOK);
                        if (isCall != lastWasCall) {
                            lastWasCall = isCall;
                            if (isCall) {
                                com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(true);
                            } else if (hasAudioFocus) {
                                com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
                            }
                            WritableMap params = Arguments.createMap();
                            params.putBoolean("isCall", isCall);
                            MusicServiceModule.sendEvent("PHONE_CALL_STATE", params);
                        }
                    }
                };
                telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE);
            }
        } catch (Exception ignored) {}
    }

    private void cleanupPhoneCallListener() {
        callCheckHandler.removeCallbacks(callCheckRunnable);
        try {
            if (telephonyManager != null && phoneStateListener != null) {
                telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_NONE);
            }
        } catch (Exception ignored) {}
    }

    private Bitmap downloadedThumbnail = null;
    private String currentThumbnailUrl = "";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;

        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            abandonAudioFocusInternal();
            cleanupPhoneCallListener();
            com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
            if (wakeLock != null && wakeLock.isHeld()) {
                try { wakeLock.release(); } catch (Exception ignored) {}
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(120 * 60 * 1000L); // 2 hours max
            } catch (Exception ignored) {}
        }

        // Extract track info
        final String title = intent.getStringExtra(EXTRA_TITLE);
        final String artist = intent.getStringExtra(EXTRA_ARTIST);
        final boolean isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true);
        final boolean isDJ = intent.getBooleanExtra(EXTRA_IS_DJ, false);
        final String thumbnail = intent.getStringExtra("thumbnail");

        if (title == null) {
            return START_STICKY; // Guard against incomplete intents
        }

        // Handle position update (live seek bar) — no rebuild of full notification, just update MediaSession state
        if (ACTION_UPDATE_POSITION.equals(action)) {
            final long posMsU = intent.getLongExtra("position", 0);
            final long durMsU = intent.getLongExtra("duration", 0);
            final boolean isDJU = intent.getBooleanExtra("isDJ", false);
            if (durMsU > 0) {
                // Update metadata with real duration so the bar renders
                MediaMetadataCompat.Builder mb = new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title != null ? title : "")
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist != null ? artist : "")
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durMsU);
                if (downloadedThumbnail != null) {
                    mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, downloadedThumbnail);
                    mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, downloadedThumbnail);
                }
                mediaSession.setMetadata(mb.build());
                // Update position — ACTION_SEEK_TO intentionally NOT included so user can't seek from outside
                long actions = isDJU ? (
                    PlaybackStateCompat.ACTION_PLAY |
                    PlaybackStateCompat.ACTION_PAUSE |
                    PlaybackStateCompat.ACTION_PLAY_PAUSE |
                    PlaybackStateCompat.ACTION_STOP
                ) : 0;
                final boolean isPlayingU = intent.getBooleanExtra(EXTRA_IS_PLAYING, true);
                mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setActions(actions)
                    .setState(
                        isPlayingU ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        posMsU,
                        isPlayingU ? 1.0f : 0.0f
                    )
                    .build());
            }
            return START_STICKY;
        }

        // Handle Play/Pause actions
        if (ACTION_PLAY.equals(action) || ACTION_PAUSE.equals(action)) {
            boolean play = ACTION_PLAY.equals(action);
            
            // Re-update the playback state in MediaSession
            mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(isDJ ? (
                    PlaybackStateCompat.ACTION_PLAY |
                    PlaybackStateCompat.ACTION_PAUSE |
                    PlaybackStateCompat.ACTION_PLAY_PAUSE |
                    PlaybackStateCompat.ACTION_STOP
                ) : 0)
                .setState(
                    play ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                    1.0f
                )
                .build());

            // Update the notification layout to show new icon and correct state
            Notification notification = buildNotification(title, artist, play, isDJ);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(1, notification);
            }

            MusicServiceModule.sendEvent(play ? "NOTIFICATION_PLAY" : "NOTIFICATION_PAUSE");
            MusicServiceModule.sendEvent(play ? "MEDIA_PLAY" : "MEDIA_PAUSE");
            return START_STICKY;
        }

        // Update MediaSession metadata (set duration to -1 to completely hide the seekbar/progress line)
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, -1L) // -1 tells Android it's a "live" stream with no progress bar
            .build());

        // Update playback state
        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(isDJ ? (
                PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_STOP
            ) : 0)
            .setState(
                isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f
            )
            .build());

        // Trigger dynamic download if thumbnail URL changed
        if (thumbnail != null && !thumbnail.isEmpty() && !thumbnail.equals(currentThumbnailUrl)) {
            currentThumbnailUrl = thumbnail;
            downloadedThumbnail = null; // Clear cached image
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        URL url = new URL(thumbnail);
                        InputStream in = url.openStream();
                        Bitmap bmp = BitmapFactory.decodeStream(in);
                        if (bmp != null) {
                            downloadedThumbnail = bmp;
                            // Re-build and trigger notification update with new large icon
                            Notification updateNotif = buildNotification(title, artist, isPlaying, isDJ);
                            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                            if (manager != null) {
                                manager.notify(1, updateNotif);
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }).start();
        }

        // Build and show the notification immediately (falls back to app icon if thumbnail not downloaded yet)
        Notification notification = buildNotification(title, artist, isPlaying, isDJ);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(1, notification);
            }

        return START_STICKY;
    }

    private Notification buildNotification(String title, String artist, boolean isPlaying, boolean isDJ) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openAppIntent.setAction("OPEN_MUSIC_ROOM");
        openAppIntent.putExtra("MAXIMIZE_MUSIC_ROOM", true);
        
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        
        PendingIntent openAppPending = PendingIntent.getActivity(
            this, 1001, openAppIntent, flags
        );

        // Load the full-color app icon as the LargeIcon or use downloaded thumbnail
        Bitmap largeIcon = null;
        if (downloadedThumbnail != null) {
            largeIcon = downloadedThumbnail;
        } else {
            try {
                largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
            } catch (Exception e) {
                // Ignore if decode fails
            }
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText("youtelite") // Explicitly show App Name next to small icon
            .setSmallIcon(R.drawable.ic_notification) // Silhouette icon for status bar
            .setContentIntent(openAppPending)
            .setOngoing(isPlaying)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (isDJ) {
            Intent actionIntent = new Intent(this, MusicForegroundService.class);
            actionIntent.setAction(isPlaying ? ACTION_PAUSE : ACTION_PLAY);
            actionIntent.putExtra(EXTRA_TITLE, title);
            actionIntent.putExtra(EXTRA_ARTIST, artist);
            actionIntent.putExtra(EXTRA_IS_DJ, isDJ);
            
            int actionFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                actionFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            
            PendingIntent actionPending = PendingIntent.getService(
                this,
                isPlaying ? 2 : 3, // Prevent PendingIntent caching/mixups
                actionIntent,
                actionFlags
            );

            NotificationCompat.Action playPauseAction = new NotificationCompat.Action.Builder(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                actionPending
            ).build();

            builder.addAction(playPauseAction)
                   .setStyle(new MediaStyle()
                       .setMediaSession(mediaSession.getSessionToken())
                       .setShowActionsInCompactView(0));
        } else {
            builder.setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken()));
        }

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Room Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows currently playing track");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        instance = null;
        abandonAudioFocusInternal();
        cleanupPhoneCallListener();
        com.DME.shaders.DualSurfaceVideoView.setGlobalInterruptionMuted(false);
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }
}
