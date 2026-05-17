import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Text, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import RNFS from 'react-native-fs';
import audioRecorder from '../modules/AudioRecorder';

interface AudioPlayerProps {
  mediaUrl: string;
  themeColor?: string;
  messageId: number | string;
  duration?: number;
}

// Global ref to track currently playing audio
let currentlyPlayingAudioRef: { stop: () => void; id?: string } | null = null;

const AudioPlayer: React.FC<AudioPlayerProps> = ({ mediaUrl, themeColor = '#8100D1', messageId, duration = 0 }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioDuration, setAudioDuration] = useState(duration || 30);
  const [currentTime, setCurrentTime] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const trackRef = useRef<View>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopPlayback = () => {
    try {
      audioRecorder.stopPlaying();
    } catch {}
    stopTimer();
  };

  const resetPlayer = () => {
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    setCurrentTime(0);
    progressAnim.setValue(0);
    setIsPlaying(false);
    setIsCompleted(false);
    currentlyPlayingAudioRef = null;
  };

  const handlePress = async () => {
    if (isCompleted) resetPlayer();

    if (isPlaying) {
      stopPlayback();
      setIsPlaying(false);
      return;
    }

    if (currentlyPlayingAudioRef) {
      currentlyPlayingAudioRef.stop();
      currentlyPlayingAudioRef = null;
    }

    setIsLoading(true);
    try {
      const urlParts = mediaUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const local = `${RNFS.CachesDirectoryPath}/vc_${encodeURIComponent(fileName)}`;
      
      if (!(await RNFS.exists(local))) {
        await RNFS.downloadFile({ fromUrl: mediaUrl, toFile: local }).promise;
      }
      
      if (!duration) {
        const stat = await RNFS.stat(local);
        setAudioDuration(Math.ceil(stat.size / 1024 / 2));
      }

      await audioRecorder.playRecording(local);
      setIsLoading(false);
      setIsPlaying(true);
      setIsReady(true);

      currentlyPlayingAudioRef = {
        id: String(messageId),
        stop: () => { stopPlayback(); setIsPlaying(false); setIsCompleted(false); },
      };

      stopTimer();
      timerRef.current = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + 0.1;
          if (next >= audioDuration) {
            stopTimer();
            stopPlayback();
            setIsPlaying(false);
            setIsCompleted(true);
            return audioDuration;
          }
          return next;
        });
      }, 100);
    } catch (err) {
      console.error('Audio play error:', err);
      setIsLoading(false);
    }
  };

  const fmt = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    progressAnim.setValue((currentTime / audioDuration) * 100);
  }, [currentTime]);

  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.btn} onPress={handlePress}>
        {isLoading ? <ActivityIndicator size="small" color="#333" /> : <Icon name={isPlaying ? 'pause' : 'play'} size={14} color="#333" />}
      </TouchableOpacity>
      <View style={styles.info}>
        <View ref={trackRef} style={styles.track}>
          <Animated.View style={[styles.fill, { backgroundColor: themeColor, width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{fmt(currentTime)} / {fmt(audioDuration)}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12, backgroundColor: '#f0f0f0', marginVertical: 4, minWidth: 180 },
  btn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  info: { flex: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#ccc', overflow: 'hidden' },
  fill: { height: '100%' },
  timeRow: { marginTop: 4, alignItems: 'flex-end' },
  time: { fontSize: 10, color: '#666' },
});

export default AudioPlayer;
