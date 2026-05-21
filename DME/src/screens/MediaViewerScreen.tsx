import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Dimensions, Platform, NativeModules, Alert, ActivityIndicator } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import RNFetchBlob from 'rn-fetch-blob';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// Note: CameraRoll is often imported differently depending on the version.
// Trying to access the save method directly if available.
const saveAsset = CameraRoll.saveAsset || CameraRoll.save;


const { SystemBar } = NativeModules;
const { width, height } = Dimensions.get('window');

const MediaViewerScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { mediaUrl, mediaType } = route.params as { mediaUrl: string; mediaType: 'image' | 'video' };
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Helper to format time (e.g., 0:00)
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleClose = () => navigation.goBack();

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { dirs } = RNFetchBlob.fs;
      const ext = mediaType === 'video' ? 'mp4' : 'jpg';
      const dest = `${dirs.CacheDir}/mv_${Date.now()}.${ext}`;
      await RNFetchBlob.config({ path: dest }).fetch('GET', mediaUrl);
      await saveAsset(`file://${dest}`, { type: mediaType });
      Alert.alert('Saved', 'Saved to gallery.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Permission or storage error.');
    } finally {
      setSaving(false);
    }
  };

  useLayoutEffect(() => {
    if (Platform.OS === 'android' && NativeModules.SystemBar) {
      NativeModules.SystemBar.setNavigationBarColor('#000000', true);
      return () => {
        NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', false);
      };
    }
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {mediaType === 'video' ? (
        <Video
          source={{ uri: mediaUrl }}
          style={styles.media}
          controls={false}
          resizeMode="contain"
          paused={paused}
          onLoad={(data) => setDuration(data.duration)}
          onProgress={(data) => setCurrentTime(data.currentTime)}
          repeat
        />
      ) : (
        <ImageViewer
          imageUrls={[{ url: mediaUrl }]}
          enableSwipeDown
          onSwipeDown={handleClose}
          style={styles.media}
          renderIndicator={() => null}
        />
      )}
      
      {/* Custom Action Bar */}
      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <Icon name="close" size={30} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.iconBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Icon name="download-outline" size={30} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Video Controls Overlay */}
      {mediaType === 'video' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity onPress={() => setPaused(!paused)} style={styles.playPauseBtn}>
            <Icon name={paused ? 'play' : 'pause'} size={30} color="#fff" />
          </TouchableOpacity>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${(currentTime / duration) * 100}%` }]} />
          </View>
          <Text style={styles.timeText}>{formatTime(currentTime)} / {formatTime(duration)}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width, height },
  topBar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10 },
  iconBtn: { padding: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 25 },
  playPauseBtn: { padding: 10 },
  progressContainer: { flex: 1, height: 4, backgroundColor: '#444', marginHorizontal: 15, borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: '#8100D1', borderRadius: 2 },
  timeText: { color: '#fff', fontSize: 12, minWidth: 60, textAlign: 'right' },
});

export default MediaViewerScreen;
