import React, { useLayoutEffect, useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Dimensions, Platform, 
  NativeModules, Alert, ActivityIndicator, FlatList 
} from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import RNFetchBlob from 'rn-fetch-blob';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

const saveAsset = CameraRoll.saveAsset || CameraRoll.save;

const { width: W, height: H } = Dimensions.get('screen');

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
  const safeTop = insets.top > 0 ? insets.top : (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 20);
  const safeBottom = Math.max(insets.bottom, 0);

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

  useEffect(() => {
    setVideoLoaded(false);
    setPaused(false);
    setDuration(0);
    setCurrentTime(0);
  }, [currentIndex]);

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
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
      }
    }
  }, []);

  const isAllImages = list.every(item => item.mediaType === 'image');

  const renderMediaContent = () => {
    if (list.length === 0) return null;

    if (isAllImages) {
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
          length: W,
          offset: W * index,
          index,
        })}
        onMomentumScrollEnd={(event) => {
          const offsetX = event.nativeEvent.contentOffset.x;
          const index = Math.round(offsetX / W);
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
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} animated={true} />
      
      {renderMediaContent()}
      
      {/* Top Scrim */}
      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.3)', 'transparent']}
        style={[styles.topScrim, { height: safeTop + 90 }]}
        pointerEvents="none"
      />

      {/* Custom Action Bar */}
      <View style={[styles.topBar, { top: safeTop + 10 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <Icon name="close" size={26} color="#fff" />
        </TouchableOpacity>
        
        {list.length > 1 && (
          <Text style={styles.headerCount}>{`${currentIndex + 1} / ${list.length}`}</Text>
        )}
        
        <TouchableOpacity style={styles.iconBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Icon name="download-outline" size={24} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Video Controls Overlay */}
      {activeType === 'video' && (
        <>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.65)']}
            style={[styles.bottomScrim, { height: safeBottom + 90 }]}
            pointerEvents="none"
          />
          <View style={[styles.bottomBar, { paddingBottom: safeBottom + 12 }]}>
            <TouchableOpacity onPress={() => setPaused(!paused)} style={styles.playPauseBtn}>
              <Icon name={paused ? 'play' : 'pause'} size={26} color="#fff" />
            </TouchableOpacity>
            <View style={styles.progressContainer}>
              <View style={[styles.progressBar, { width: `${(currentTime / (duration || 1)) * 100}%` }]} />
            </View>
            <Text style={styles.timeText}>{formatTime(currentTime)} / {formatTime(duration)}</Text>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  media: { width: W, height: H },
  mediaList: { flex: 1 },
  mediaItemContainer: { width: W, height: H, justifyContent: 'center', alignItems: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10, alignItems: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, zIndex: 10 },
  iconBtn: { padding: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 20 },
  playPauseBtn: { padding: 8 },
  progressContainer: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 12, borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: '#4597f5f6', borderRadius: 2 },
  timeText: { color: '#fff', fontSize: 12, minWidth: 60, textAlign: 'right' },
  headerCount: { color: '#fff', fontSize: 16, fontWeight: '600', alignSelf: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});

export default MediaViewerScreen;
