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
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
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
    public static final String EXTRA_IS_DJ = "isDJ";

    private MediaSessionCompat mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // Create MediaSession — this is what powers the
        // lockscreen overlay and Android media controls
        mediaSession = new MediaSessionCompat(this, "MusicRoomSession");
        mediaSession.setActive(true);
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                super.onPlay();
                MusicServiceModule.sendEvent("MEDIA_PLAY");
            }

            @Override
            public void onPause() {
                super.onPause();
                MusicServiceModule.sendEvent("MEDIA_PAUSE");
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;

        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        // Extract track info
        String title = intent.getStringExtra(EXTRA_TITLE);
        String artist = intent.getStringExtra(EXTRA_ARTIST);
        boolean isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true);
        boolean isDJ = intent.getBooleanExtra(EXTRA_IS_DJ, false);

        if (title == null) title = "Music Room";
        if (artist == null) artist = "";

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
            startForeground(1, notification);

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

        // Build and show the notification
        Notification notification = buildNotification(title, artist, isPlaying, isDJ);
        startForeground(1, notification);

        return START_STICKY;
    }

    private Notification buildNotification(String title, String artist, boolean isPlaying, boolean isDJ) {
        Intent openAppIntent = getPackageManager()
            .getLaunchIntentForPackage(getPackageName());
        
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        
        PendingIntent openAppPending = PendingIntent.getActivity(
            this, 0, openAppIntent, flags
        );

        // Load the full-color app icon as the LargeIcon
        Bitmap largeIcon = null;
        try {
            largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        } catch (Exception e) {
            // Ignore if decode fails
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.drawable.ic_notification) // Silhouette icon for status bar
            .setSubText("NOW PLAYING") // Adds the NOW PLAYING text next to the app name in the header
            .setContentIntent(openAppPending)
            .setOngoing(isPlaying)
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
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }
}
