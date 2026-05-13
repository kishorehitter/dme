package com.DME;

import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Environment;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class AudioRecorderModule extends ReactContextBaseJavaModule {
    private static final String TAG = "AudioRecorderModule";
    private static final String RECORDINGS_DIR = "VoiceNotes";

    private MediaRecorder mediaRecorder;
    private MediaPlayer mediaPlayer;
    private String currentRecordingPath;
    private boolean isRecording = false;
    private boolean isPlaying = false;
    private long recordingStartTime;

    private final ReactApplicationContext reactContext;

    public AudioRecorderModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "AudioRecorder";
    }

    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("RECORDING_DIR", getRecordingsDirectory().getAbsolutePath());
        return constants;
    }

    private File getRecordingsDirectory() {
        File dir = new File(reactContext.getExternalFilesDir(null), RECORDINGS_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private String generateRecordingFileName() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault());
        String timestamp = sdf.format(new Date());
        return "AUDIO_" + timestamp + ".m4a";
    }

    @ReactMethod
    public void prepareRecording(Callback successCallback, Callback errorCallback) {
        try {
            File recordingsDir = getRecordingsDirectory();
            String fileName = generateRecordingFileName();
            File outputFile = new File(recordingsDir, fileName);
            currentRecordingPath = outputFile.getAbsolutePath();

            mediaRecorder = new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setAudioEncodingBitRate(128000);
            mediaRecorder.setAudioSamplingRate(44100);
            mediaRecorder.setOutputFile(currentRecordingPath);

            mediaRecorder.prepare();
            
            WritableMap params = Arguments.createMap();
            params.putString("path", currentRecordingPath);
            successCallback.invoke(params);
        } catch (IOException e) {
            Log.e(TAG, "Failed to prepare recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Failed to prepare recording: " + e.getMessage());
            }
            releaseMediaRecorder();
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error preparing recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Unexpected error: " + e.getMessage());
            }
            releaseMediaRecorder();
        }
    }

    @ReactMethod
    public void startRecording(Callback successCallback, Callback errorCallback) {
        if (isRecording) {
            Log.w(TAG, "Already recording");
            return;
        }

        if (mediaRecorder == null) {
            // Prepare first if not already prepared
            try {
                File recordingsDir = getRecordingsDirectory();
                String fileName = generateRecordingFileName();
                File outputFile = new File(recordingsDir, fileName);
                currentRecordingPath = outputFile.getAbsolutePath();

                mediaRecorder = new MediaRecorder();
                mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                mediaRecorder.setAudioEncodingBitRate(128000);
                mediaRecorder.setAudioSamplingRate(44100);
                mediaRecorder.setOutputFile(currentRecordingPath);
                mediaRecorder.prepare();
            } catch (Exception e) {
                Log.e(TAG, "Failed to prepare", e);
                if (errorCallback != null) {
                    errorCallback.invoke("Failed to prepare: " + e.getMessage());
                }
                return;
            }
        }

        try {
            mediaRecorder.start();
            isRecording = true;
            recordingStartTime = System.currentTimeMillis();

            Log.d(TAG, "Recording started: " + currentRecordingPath);

            // Send event to JS
            WritableMap params = Arguments.createMap();
            params.putString("path", currentRecordingPath);
            params.putDouble("startTime", recordingStartTime);
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onRecordingStart", params);

            if (successCallback != null) {
                successCallback.invoke();
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to start recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Failed to start recording: " + e.getMessage());
            }
            releaseMediaRecorder();
        }
    }

    @ReactMethod
    public void stopRecording(Callback successCallback, Callback errorCallback) {
        if (!isRecording || mediaRecorder == null) {
            Log.w(TAG, "Not recording");
            if (errorCallback != null) {
                errorCallback.invoke("Not currently recording");
            }
            return;
        }

        try {
            mediaRecorder.stop();
            isRecording = false;

            String finalPath = currentRecordingPath;
            long duration = System.currentTimeMillis() - recordingStartTime;
            Log.d(TAG, "Recording stopped: " + finalPath + ", duration: " + duration + "ms");

            // Send event to JS with file path
            WritableMap params = Arguments.createMap();
            params.putString("path", finalPath);
            params.putString("uri", "file://" + finalPath);
            params.putInt("duration", (int) duration);
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onRecordingStop", params);

            if (successCallback != null) {
                successCallback.invoke(finalPath);
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to stop recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Failed to stop recording: " + e.getMessage());
            }
        } finally {
            releaseMediaRecorder();
        }
    }

    @ReactMethod
    public void cancelRecording(Callback errorCallback) {
        if (!isRecording || mediaRecorder == null) {
            Log.w(TAG, "Not recording");
            if (errorCallback != null) {
                errorCallback.invoke("Not currently recording");
            }
            return;
        }

        try {
            mediaRecorder.reset();
            isRecording = false;

            // Delete the incomplete recording
            if (currentRecordingPath != null) {
                File file = new File(currentRecordingPath);
                if (file.exists()) {
                    file.delete();
                    Log.d(TAG, "Deleted recording: " + currentRecordingPath);
                }
            }

            Log.d(TAG, "Recording cancelled");

            // Send event to JS
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onRecordingCancel", Arguments.createMap());

        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Failed to cancel recording: " + e.getMessage());
            }
        } finally {
            releaseMediaRecorder();
        }
    }

    @ReactMethod
    public void playRecording(String path, Callback successCallback, Callback errorCallback) {
        if (path == null || path.isEmpty()) {
            Log.e(TAG, "Invalid path provided");
            if (errorCallback != null) {
                errorCallback.invoke("Invalid path provided");
            }
            return;
        }

        if (isPlaying) {
            stopPlaying();
        }

        try {
            File file = new File(path);
            if (!file.exists()) {
                Log.e(TAG, "File does not exist: " + path);
                if (errorCallback != null) {
                    errorCallback.invoke("File does not exist: " + path);
                }
                return;
            }

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(path);
            mediaPlayer.prepare();

            final String finalPath = path;
            mediaPlayer.setOnCompletionListener(mp -> {
                Log.d(TAG, "Playback completed: " + finalPath);
                isPlaying = false;

                // Send completion event
                WritableMap params = Arguments.createMap();
                params.putString("path", finalPath);
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit("onPlaybackComplete", params);

                releaseMediaPlayer();
            });

            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                Log.e(TAG, "Playback error: " + what + ", " + extra);
                isPlaying = false;
                releaseMediaPlayer();
                return true;
            });

            mediaPlayer.start();
            isPlaying = true;

            Log.d(TAG, "Playing: " + path);

            // Send event to JS
            WritableMap params = Arguments.createMap();
            params.putString("path", path);
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onPlaybackStart", params);

            if (successCallback != null) {
                successCallback.invoke();
            }

        } catch (IOException e) {
            Log.e(TAG, "Failed to play recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Failed to play recording: " + e.getMessage());
            }
            releaseMediaPlayer();
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error playing recording", e);
            if (errorCallback != null) {
                errorCallback.invoke("Unexpected error: " + e.getMessage());
            }
            releaseMediaPlayer();
        }
    }

    @ReactMethod
    public void stopPlaying() {
        if (!isPlaying || mediaPlayer == null) {
            Log.w(TAG, "Not playing");
            return;
        }

        try {
            mediaPlayer.stop();
            isPlaying = false;
            Log.d(TAG, "Playback stopped");

            // Send event to JS
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onPlaybackStop", Arguments.createMap());

        } catch (Exception e) {
            Log.e(TAG, "Error stopping playback", e);
        } finally {
            releaseMediaPlayer();
        }
    }

    @ReactMethod
    public void isPlaying(Callback callback) {
        callback.invoke(isPlaying);
    }

    @ReactMethod
    public void isRecording(Callback callback) {
        callback.invoke(isRecording);
    }

    @ReactMethod
    public void getPlaybackPosition(Callback callback) {
        if (mediaPlayer != null && isPlaying) {
            callback.invoke(mediaPlayer.getCurrentPosition());
        } else {
            callback.invoke(0);
        }
    }

    @ReactMethod
    public void getPlaybackDuration(Callback callback) {
        if (mediaPlayer != null) {
            callback.invoke(mediaPlayer.getDuration());
        } else {
            callback.invoke(0);
        }
    }

    @ReactMethod
    public void getRecordingDuration(Callback callback) {
        if (isRecording) {
            long duration = System.currentTimeMillis() - recordingStartTime;
            callback.invoke((int) duration);
        } else {
            callback.invoke(0);
        }
    }

    private void releaseMediaRecorder() {
        if (mediaRecorder != null) {
            try {
                mediaRecorder.reset();
                mediaRecorder.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing media recorder", e);
            } finally {
                mediaRecorder = null;
            }
        }
    }

    private void releaseMediaPlayer() {
        if (mediaPlayer != null) {
            try {
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing media player", e);
            } finally {
                mediaPlayer = null;
            }
        }
    }

    @Override
    public void invalidate() {
        releaseMediaRecorder();
        releaseMediaPlayer();
        super.invalidate();
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Required for NativeEventEmitter
    }
}
