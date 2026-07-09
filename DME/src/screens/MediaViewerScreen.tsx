import React, { useLayoutEffect, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Dimensions, Platform, NativeModules, Alert, ActivityIndicator, FlatList } from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import RNFetchBlob from 'rn-fetch-blob';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// Note: CameraRoll is often imported differently depending on the version.
// Trying to access the save method directly if available.
const saveAsset = CameraRoll.saveAsset || CameraRoll.save;
import { pinNavBarColor } from '../utils/navBarPin';


const { SystemBar } = NativeModules;
const { width, height } = Dimensions.get('window');

interface MediaItem {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  id?: string | number;
  caption?: string;
}

const MediaViewerScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  
  const { mediaUrl, mediaType, mediaList, initialIndex } = route.params as { 
    mediaUrl?: string; 
    mediaType?: 'image' | 'video'; 
    mediaList?: MediaItem[];
    initialIndex?: number;
  };

  const list = mediaList || (mediaUrl && mediaType ? [{ mediaUrl, mediaType }] : []);
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);

  const activeItem = list[currentIndex] || { mediaUrl: '', mediaType: 'image' };
  const activeUrl = activeItem.mediaUrl;
  const activeType = activeItem.mediaType;

  // Reset video loaded and playback status when swiping to a different media item
  useEffect(() => {
    setVideoLoaded(false);
    setPaused(false);
    setDuration(0);
    setCurrentTime(0);
  }, [currentIndex]);

  // Helper to format time (e.g., 0:00)
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleClose = () => navigation.goBack();

  const handleSave = async () => {
    if (saving || !activeUrl) return;
    setSaving(true);
    try {
      const { dirs } = RNFetchBlob.fs;
      const ext = activeType === 'video' ? 'mp4' : 'jpg';
      const dest = `${dirs.CacheDir}/mv_${Date.now()}.${ext}`;
      await RNFetchBlob.config({ path: dest }).fetch('GET', activeUrl);
      await saveAsset(`file://${dest}`, { type: activeType });
      Alert.alert('Saved', 'Saved to gallery.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Permission or storage error.');
    } finally {
      setSaving(false);
    }
  };

  useLayoutEffect(() => {
    if (Platform.OS === 'android') {
      pinNavBarColor('#000000');
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#000000', true);
      }
      return () => {
        pinNavBarColor('#FFFFFF');
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', false);
        }
      };
    }
  }, []);

  const isAllImages = list.every(item => item.mediaType === 'image');

  const renderMediaContent = () => {
    if (list.length === 0) return null;

    if (isAllImages) {
      // If it's 100% images, ImageViewer handles horizontal swiping natively with high performance
      return (
        <ImageViewer
          imageUrls={list.map(item => ({ url: item.mediaUrl }))}
          index={currentIndex}
          onChange={(index) => setCurrentIndex(index ?? 0)}
          enableSwipeDown
          onSwipeDown={handleClose}
          style={styles.media}
          renderIndicator={() => null}
          enablePreload={true}
          renderImage={(props) => (
            <FastImage
              source={props.source}
              style={props.style}
              resizeMode={FastImage.resizeMode.contain}
            />
          )}
        />
      );
    }

    // If there is any video, use FlatList horizontal pagination
    return (
      <FlatList
        data={list}
        renderItem={({ item, index }) => {
          const isCurrent = index === currentIndex;
          if (item.mediaType === 'video') {
            return (
              <View style={styles.mediaItemContainer}>
                <Video
                  source={{ uri: item.mediaUrl }}
                  style={[styles.media, { opacity: (isCurrent && videoLoaded) ? 1 : 0 }]}
                  controls={false}
                  resizeMode="contain"
                  paused={!isCurrent || paused}
                  onLoad={(data) => {
                    if (isCurrent) {
                      setDuration(data.duration);
                      setVideoLoaded(true);
                    }
                  }}
                  onProgress={(data) => {
                    if (isCurrent) {
                      setCurrentTime(data.currentTime);
                    }
                  }}
                  repeat
                />
                {(!videoLoaded || !isCurrent) && (
                  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size="large" color="#ffffff" />
                  </View>
                )}
              </View>
            );
          } else {
            return (
              <View style={styles.mediaItemContainer}>
                <FastImage
                  source={{ uri: item.mediaUrl }}
                  style={styles.media}
                  resizeMode={FastImage.resizeMode.contain}
                />
              </View>
            );
          }
        }}
        keyExtractor={(item, index) => `${item.mediaUrl}_${index}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex || 0}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        onMomentumScrollEnd={(event) => {
          const offsetX = event.nativeEvent.contentOffset.x;
          const index = Math.round(offsetX / width);
          if (index >= 0 && index < list.length) {
            setCurrentIndex(index);
          }
        }}
        style={styles.mediaList}
      />
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {renderMediaContent()}
      
      {/* Custom Action Bar */}
      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <Icon name="close" size={30} color="#fff" />
        </TouchableOpacity>
        
        {list.length > 1 && (
          <Text style={styles.headerCount}>{`${currentIndex + 1} / ${list.length}`}</Text>
        )}
        
        <TouchableOpacity style={styles.iconBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Icon name="download-outline" size={30} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Video Controls Overlay */}
      {activeType === 'video' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity onPress={() => setPaused(!paused)} style={styles.playPauseBtn}>
            <Icon name={paused ? 'play' : 'pause'} size={30} color="#fff" />
          </TouchableOpacity>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${(currentTime / (duration || 1)) * 100}%` }]} />
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
  mediaList: { flex: 1 },
  mediaItemContainer: { width, height, justifyContent: 'center', alignItems: 'center' },
  topBar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10, alignItems: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10 },
  iconBtn: { padding: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 25 },
  playPauseBtn: { padding: 10 },
  progressContainer: { flex: 1, height: 4, backgroundColor: '#444', marginHorizontal: 15, borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: '#4597f5f6', borderRadius: 2 },
  timeText: { color: '#fff', fontSize: 12, minWidth: 60, textAlign: 'right' },
  headerCount: { color: '#fff', fontSize: 16, fontWeight: '600', alignSelf: 'center' },
});

export default MediaViewerScreen;
