import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { AudioRecorder } = NativeModules;

export interface RecordingEvent {
  path: string;
  uri: string;
  duration?: number;
  startTime?: number;
}

export interface PlaybackEvent {
  path: string;
}

export type RecordingStatus = 'idle' | 'preparing' | 'recording' | 'paused';
export type PlaybackStatus = 'idle' | 'playing' | 'paused';

class AudioRecorderModule {
  private eventEmitter: NativeEventEmitter;
  private onRecordingStartCallback?: (event: RecordingEvent) => void;
  private onRecordingStopCallback?: (event: RecordingEvent) => void;
  private onRecordingCancelCallback?: () => void;
  private onPlaybackStartCallback?: (event: PlaybackEvent) => void;
  private onPlaybackStopCallback?: () => void;
  private onPlaybackCompleteCallback?: (event: PlaybackEvent) => void;

  constructor() {
    this.eventEmitter = new NativeEventEmitter(AudioRecorder);
  }

  /**
   * Prepare recording (create file, setup recorder) - call on first tap
   */
  prepareRecording(): Promise<{ path: string }> {
    return new Promise((resolve, reject) => {
      if (Platform.OS === 'android') {
        AudioRecorder.prepareRecording(
          (result: { path: string }) => resolve(result),
          (error: string) => reject(new Error(error))
        );
      } else {
        reject(new Error('AudioRecorder is only available on Android'));
      }
    });
  }

  /**
   * Start recording audio
   */
  startRecording(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (Platform.OS === 'android') {
        AudioRecorder.startRecording(
          () => resolve(),
          (error: string) => reject(new Error(error))
        );
      } else {
        reject(new Error('AudioRecorder is only available on Android'));
      }
    });
  }

  /**
   * Stop recording and return the file path
   */
  stopRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (Platform.OS === 'android') {
        AudioRecorder.stopRecording(
          (path: string) => resolve(path),
          (error: string) => reject(new Error(error))
        );
      } else {
        reject(new Error('AudioRecorder is only available on Android'));
      }
    });
  }

  /**
   * Cancel the current recording (deletes the file)
   */
  cancelRecording(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (Platform.OS === 'android') {
        AudioRecorder.cancelRecording((error: string) => {
          if (error) {
            reject(new Error(error));
          } else {
            resolve();
          }
        });
      } else {
        reject(new Error('AudioRecorder is only available on Android'));
      }
    });
  }

  /**
   * Play a recording from the given path
   */
  playRecording(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (Platform.OS === 'android') {
        AudioRecorder.playRecording(
          path,
          () => resolve(),
          (error: string) => reject(new Error(error))
        );
      } else {
        reject(new Error('AudioRecorder is only available on Android'));
      }
    });
  }

  /**
   * Stop playback
   */
  stopPlaying(): Promise<void> {
    return new Promise((resolve) => {
      if (Platform.OS === 'android') {
        AudioRecorder.stopPlaying();
        resolve();
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if currently playing
   */
  async isPlaying(): Promise<boolean> {
    if (Platform.OS === 'android') {
      return new Promise((resolve) => {
        AudioRecorder.isPlaying((playing: boolean) => resolve(playing));
      });
    }
    return false;
  }

  /**
   * Check if currently recording
   */
  async isRecording(): Promise<boolean> {
    if (Platform.OS === 'android') {
      return new Promise((resolve) => {
        AudioRecorder.isRecording((recording: boolean) => resolve(recording));
      });
    }
    return false;
  }

  /**
   * Get current playback position in milliseconds
   */
  async getPlaybackPosition(): Promise<number> {
    if (Platform.OS === 'android') {
      return new Promise((resolve) => {
        AudioRecorder.getPlaybackPosition((position: number) => resolve(position));
      });
    }
    return 0;
  }

  /**
   * Get total playback duration in milliseconds
   */
  async getPlaybackDuration(): Promise<number> {
    if (Platform.OS === 'android') {
      return new Promise((resolve) => {
        AudioRecorder.getPlaybackDuration((duration: number) => resolve(duration));
      });
    }
    return 0;
  }

  /**
   * Get current recording duration in milliseconds
   */
  async getRecordingDuration(): Promise<number> {
    if (Platform.OS === 'android') {
      return new Promise((resolve) => {
        AudioRecorder.getRecordingDuration((duration: number) => resolve(duration));
      });
    }
    return 0;
  }

  /**
   * Get the recordings directory path
   */
  getRecordingsDir(): string {
    return AudioRecorder.RECORDING_DIR || '';
  }

  // Event listeners

  setOnRecordingStart(callback: (event: RecordingEvent) => void) {
    this.onRecordingStartCallback = callback;
    this.eventEmitter.addListener('onRecordingStart', callback);
  }

  setOnRecordingStop(callback: (event: RecordingEvent) => void) {
    this.onRecordingStopCallback = callback;
    this.eventEmitter.addListener('onRecordingStop', callback);
  }

  setOnRecordingCancel(callback: () => void) {
    this.onRecordingCancelCallback = callback;
    this.eventEmitter.addListener('onRecordingCancel', callback);
  }

  setOnPlaybackStart(callback: (event: PlaybackEvent) => void) {
    this.onPlaybackStartCallback = callback;
    this.eventEmitter.addListener('onPlaybackStart', callback);
  }

  setOnPlaybackStop(callback: () => void) {
    this.onPlaybackStopCallback = callback;
    this.eventEmitter.addListener('onPlaybackStop', callback);
  }

  setOnPlaybackComplete(callback: (event: PlaybackEvent) => void) {
    this.onPlaybackCompleteCallback = callback;
    this.eventEmitter.addListener('onPlaybackComplete', callback);
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners() {
    if (this.onRecordingStartCallback) {
      this.eventEmitter.removeAllListeners('onRecordingStart');
    }
    if (this.onRecordingStopCallback) {
      this.eventEmitter.removeAllListeners('onRecordingStop');
    }
    if (this.onRecordingCancelCallback) {
      this.eventEmitter.removeAllListeners('onRecordingCancel');
    }
    if (this.onPlaybackStartCallback) {
      this.eventEmitter.removeAllListeners('onPlaybackStart');
    }
    if (this.onPlaybackStopCallback) {
      this.eventEmitter.removeAllListeners('onPlaybackStop');
    }
    if (this.onPlaybackCompleteCallback) {
      this.eventEmitter.removeAllListeners('onPlaybackComplete');
    }
  }
}

export const audioRecorder = new AudioRecorderModule();
export default audioRecorder;
