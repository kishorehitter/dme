import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  NativeModules,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
  Modal,
  BackHandler,
} from 'react-native';
import Video from 'react-native-video';
import ImageViewer from 'react-native-image-zoom-viewer';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RNFetchBlob from 'rn-fetch-blob';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { pinNavBarColor } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useTheme } from '../context/ThemeContext';

const saveAsset = CameraRoll.saveAsset || CameraRoll.save;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');

export interface MediaItem {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  id?: string | number;
  caption?: string;
}

export interface MediaViewerModalProps {
  visible: boolean;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaList?: MediaItem[];
  initialIndex?: number;
  onClose: () => void;
}

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
  visible,
  mediaUrl,
  mediaType,
  mediaList,
  initialIndex = 0,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const themeRef = useRef(theme);
  const isDarkRef = useRef(isDark);
  themeRef.current = theme;
  isDarkRef.current = isDark;

  const list = mediaList || (mediaUrl && mediaType ? [{ mediaUrl, mediaType }] : []);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setVideoLoaded(false);
      setPaused(false);
      setDuration(0);
      setCurrentTime(0);
    }
  }, [visible, initialIndex, mediaUrl]);

  useEffect(() => {
    if (!visible) return;

    if (Platform.OS === 'android') {
      pinNavBarColor('#00000000');
      try { changeNavigationBarColor('#00000000', true, false); } catch (_) {}
      if (NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
      }
    }

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => {
      backHandler.remove();
      if (Platform.OS === 'android') {
        const navColor = themeRef.current?.navBar || '#FFFFFF';
        const dark = isDarkRef.current ?? false;
        pinNavBarColor(navColor);
        try { changeNavigationBarColor(navColor, !dark, false); } catch (_) {}
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setNavigationBarColor(navColor, dark);
        }
      }
    };
  }, [visible, onClose]);

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

  if (!visible || list.length === 0) return null;

  const renderMediaContent = () => {
    return (
      <FlatList
        data={list}
        renderItem={({ item, index: i }) => {
          const isCurrent = i === currentIndex;
          if (item.mediaType === 'video') {
            return (
              <View style={styles.mediaItemContainer}>
                <Video
                  source={{ uri: item.mediaUrl }}
                  style={[styles.media, { opacity: isCurrent && videoLoaded ? 1 : 0 }]}
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
          length: SCREEN_W,
          offset: SCREEN_W * index,
          index,
        })}
        onMomentumScrollEnd={(event) => {
          const offsetX = event.nativeEvent.contentOffset.x;
          const index = Math.round(offsetX / SCREEN_W);
          if (index >= 0 && index < list.length) {
            setCurrentIndex(index);
          }
        }}
        style={styles.mediaList}
      />
    );
  };

  return (
    <View style={styles.overlayContainer}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

      {renderMediaContent()}

      {/* Top Action Bar */}
      <View style={[styles.topBar, { top: insets.top > 0 ? insets.top + 8 : 20 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="close" size={28} color="#ffffff" />
        </TouchableOpacity>

        {list.length > 1 && (
          <Text style={styles.headerCount}>{`${currentIndex + 1} / ${list.length}`}</Text>
        )}

        <TouchableOpacity style={styles.iconBtn} onPress={handleSave} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <Icon name="download-outline" size={26} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* Video Controls Bar */}
      {activeType === 'video' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom > 0 ? insets.bottom + 12 : 20 }]}>
          <TouchableOpacity onPress={() => setPaused(!paused)} style={styles.playPauseBtn}>
            <Icon name={paused ? 'play' : 'pause'} size={28} color="#ffffff" />
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
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: '#000000',
    zIndex: 99999,
    elevation: 99999,
  },
  media: { width: '100%', height: '100%' },
  mediaList: { flex: 1 },
  mediaItemContainer: { width: SCREEN_W, height: SCREEN_H, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justify: 'space-between',
    zIndex: 999,
    alignItems: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 999,
  },
  iconBtn: { padding: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 22 },
  playPauseBtn: { padding: 8 },
  progressContainer: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 14, borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: '#4597f5f6', borderRadius: 2 },
  timeText: { color: '#ffffff', fontSize: 13, minWidth: 60, textAlign: 'right' },
  headerCount: { color: '#ffffff', fontSize: 16, fontWeight: '600', alignSelf: 'center' },
});

export default MediaViewerModal;
