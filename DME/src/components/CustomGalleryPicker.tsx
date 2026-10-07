/**
 * CustomGalleryPicker.tsx
 * WhatsApp-style in-app gallery picker using @react-native-camera-roll/camera-roll
 *
 * Features:
 *  - Album/bucket browser (WhatsApp Images, Camera, Screenshots, ...)
 *  - Infinite-scroll photo+video grid with multi-select (up to 10)
 *  - Thumbnail video duration badge
 *  - Camera capture shortcut (first cell)
 *  - Selected count badge + animated bottom send bar
 *  - Permission handling with settings redirect
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  Platform,
  Alert,
  Animated,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CameraRoll,
  PhotoIdentifier,
  GetPhotosParams,
} from '@react-native-camera-roll/camera-roll';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchCamera, CameraOptions } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const NUM_COLS = 4;
const CELL_SIZE = SCREEN_W / NUM_COLS;
const PAGE_SIZE = 60;
const MAX_SELECT = 10;
const THEME = '#4597f5f6';

const SHEET_MAX_HEIGHT = SCREEN_H * 0.9;
const SHEET_HEIGHT = SCREEN_H * 0.62;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GalleryAsset {
  uri: string;
  type: string;
  fileName: string;
  duration?: number;
  width?: number;
  height?: number;
}

interface Album {
  title: string;
  count: number;
  coverUri: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (assets: GalleryAsset[]) => void;
  maxSelect?: number;
  themeColor?: string;
  theme?: 'light' | 'dark';
  assetType?: 'All' | 'Photos' | 'Videos';
  restoreNavBarColor?: string;
  maxDuration?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const mediaTypeOf = (photo: PhotoIdentifier): string => {
  const uri = photo.node.image.uri;
  const typeLower = photo.node.type?.toLowerCase();
  const isVideo = typeLower === 'video' || typeLower?.includes('video') || (photo.node.image.playableDuration != null && photo.node.image.playableDuration > 0) || uri?.toLowerCase()?.endsWith('.mp4') || uri?.toLowerCase()?.endsWith('.mov') || uri?.toLowerCase()?.endsWith('.mkv');
  if (isVideo) return 'video/mp4';
  if (uri?.toLowerCase()?.endsWith('.png')) return 'image/png';
  if (uri?.toLowerCase()?.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
};

// ─── Permission helpers ───────────────────────────────────────────────────────

const checkStoragePerm = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    const perm = PERMISSIONS.IOS.PHOTO_LIBRARY;
    let status = await check(perm);
    if (status === RESULTS.DENIED) status = await request(perm);
    return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  }

  const sdkVersion = parseInt(Platform.Version as string, 10);
  if (sdkVersion >= 33) {
    const imgPerm = PERMISSIONS.ANDROID.READ_MEDIA_IMAGES;
    const vidPerm = PERMISSIONS.ANDROID.READ_MEDIA_VIDEO;
    let img = await check(imgPerm);
    let vid = await check(vidPerm);
    if (img === RESULTS.DENIED) img = await request(imgPerm);
    if (vid === RESULTS.DENIED) vid = await request(vidPerm);
    return (
      (img === RESULTS.GRANTED || img === RESULTS.LIMITED) &&
      (vid === RESULTS.GRANTED || vid === RESULTS.LIMITED)
    );
  } else {
    const perm = PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
    let status = await check(perm);
    if (status === RESULTS.DENIED) status = await request(perm);
    return status === RESULTS.GRANTED;
  }
};

const checkCameraPerm = async (): Promise<boolean> => {
  const perm = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
  let status = await check(perm);
  if (status === RESULTS.DENIED) status = await request(perm);
  return status === RESULTS.GRANTED;
};

// ─── Album tile component (Grid style select category) ────────────────────────
const AlbumRow: React.FC<{
  album: Album;
  selected: boolean;
  onPress: () => void;
  theme?: 'light' | 'dark';
}> = ({ album, selected, onPress, theme: propTheme = 'light' }) => {
  const { isDark } = useTheme();
  const isDarkTheme = isDark || propTheme === 'dark';
  return (
    <TouchableOpacity
      style={[
        albumStyles.row,
        isDark && { backgroundColor: '#1E1E1E', borderBottomColor: '#2A2A2A' },
        selected && { backgroundColor: isDark ? '#2A2A2A' : '#EEEEEE' }
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {album.coverUri ? (
        <Image source={{ uri: album.coverUri }} style={albumStyles.rowImg} />
      ) : (
        <View style={[albumStyles.rowImg, { backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0', justifyContent: 'center', alignItems: 'center' }]}>
          <Icon name="images-outline" size={24} color={isDark ? '#888' : '#999'} />
        </View>
      )}

      <View style={albumStyles.rowInfo}>
        <Text style={[albumStyles.rowTitle, isDark && { color: '#FFF' }]} numberOfLines={1}>
          {album.title}
        </Text>
        <Text style={[albumStyles.rowCount, isDark && { color: '#AAA' }]}>
          {album.count} items
        </Text>
      </View>

      <Icon name="chevron-forward-outline" size={16} color={isDark ? '#888' : '#BBB'} style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
};

const albumStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EFEFEF',
    backgroundColor: '#FFF',
  },
  rowImg: {
    width: 50,
    height: 50,
    borderRadius: 6,
    backgroundColor: '#FAFAFA',
  },
  rowInfo: {
    marginLeft: 12,
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  rowCount: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  checkBadgeInline: {
    marginRight: 4,
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export const CustomGalleryPicker: React.FC<Props> = ({
  visible,
  onClose,
  onSelect,
  maxSelect = MAX_SELECT,
  themeColor = THEME,
  theme: propTheme = 'light',
  assetType = 'All',
  restoreNavBarColor = '#01000000',
  maxDuration,
}) => {
  const { theme, isDark } = useTheme();
  const styles = dynamicStyles(theme);
  const insets = useSafeAreaInsets();

  const [permGranted, setPermGranted] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [activeTab, setActiveTab] = useState<'photos' | 'folders'>('photos');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoIdentifier[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(true);
  const isFetchingRef = useRef(false);
  const photosRef = useRef<PhotoIdentifier[]>([]);
  const currentAlbumRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<{ [uri: string]: PhotoIdentifier }>({});
  const selectedCount = Object.keys(selected).length;
  const sendBarAnim = useRef(new Animated.Value(0)).current;

  // Modern UI transitions: translateY and backdropOpacity (hardware accelerated)
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const skipRestoreRef = useRef(false);

  const handleClosePress = useCallback(() => {

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      })
    ]).start(() => {
      onClose();
    });
  }, [onClose, translateY, backdropOpacity, restoreNavBarColor]);

  useEffect(() => {
    Animated.timing(sendBarAnim, {
      toValue: selectedCount > 0 ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [selectedCount, sendBarAnim]);



  useEffect(() => {
    if (!visible) return;
    let active = true;

    // Reset tab to photos immediately when opening to avoid stale state from previous opens
    setActiveTab('photos');

    // Reset animated values for smooth opening
    translateY.setValue(SHEET_HEIGHT);
    backdropOpacity.setValue(0);

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        tension: 75,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(() => {
      if (!active) return;

      // Only request permissions and load files AFTER animation completes to avoid thread overload/lag
      (async () => {
        const granted = await checkStoragePerm();
        if (!active) return;
        setPermGranted(granted ? 'granted' : 'denied');
        if (granted) {
          resetAndLoad(null);
          loadAlbums();
        }
      })();
    });

    return () => {
      active = false;
      setSelected({});
      // Do NOT reset activeTab here to prevent visual layout jump/flicker while closing the modal
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loadAlbums, resetAndLoad]);

  const loadAlbums = useCallback(async () => {
    try {
      const groups = await CameraRoll.getAlbums({ assetType });
      const albumsWithCovers: Album[] = await Promise.all(
        groups.map(async (g) => {
          try {
            const res = await CameraRoll.getPhotos({
              first: 1,
              ...(Platform.OS === 'ios' ? { groupTypes: 'Album' } : {}),
              groupName: g.title,
              assetType,
            });
            return {
              title: g.title,
              count: g.count,
              coverUri: res.edges[0]?.node.image.uri ?? null,
            };
          } catch {
            return { title: g.title, count: g.count, coverUri: null };
          }
        })
      );
      setAlbums(albumsWithCovers);
    } catch (err) {
      console.error('[Gallery] loadAlbums error:', err);
    }
  }, [assetType]);

  const fetchPhotos = useCallback(
    async (cursor?: string, albumName?: string | null) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      
      if (!cursor && photosRef.current.length === 0) {
        setLoadingPhotos(true);
      } else if (cursor) {
        setLoadingPhotos(true);
      }

      const params: GetPhotosParams = {
        first: PAGE_SIZE,
        assetType,
        include: ['filename', 'fileSize', 'imageSize', 'playableDuration'],
        ...(cursor ? { after: cursor } : {}),
        ...(Platform.OS === 'ios'
          ? (albumName
            ? { groupTypes: 'Album', groupName: albumName }
            : { groupTypes: 'All' })
          : (albumName ? { groupName: albumName } : {})),
      };

      try {
        const result = await CameraRoll.getPhotos(params);
        const filteredEdges = result.edges.filter(edge => {
          // 1. Filter out videos over 10 minutes (600 seconds)
          const duration = edge.node.image.playableDuration;
          if (duration != null && duration > 0) {
            if (duration > 600) return false;
            if (maxDuration != null && duration >= maxDuration) return false;
          }
          // 2. Filter out media files larger than 100MB (104,857,600 bytes)
          const fileSize = edge.node.image.fileSize;
          if (fileSize != null && fileSize > 104857600) return false;

          return true;
        });

        setPhotos((prev) => {
          const next = cursor ? [...prev, ...filteredEdges] : filteredEdges;
          photosRef.current = next;
          return next;
        });
        setEndCursor(result.page_info.end_cursor);
        setHasNextPage(result.page_info.has_next_page);
      } catch (err) {
        console.error('[Gallery] fetchPhotos error:', err);
      } finally {
        setLoadingPhotos(false);
        isFetchingRef.current = false;
      }
    },
    [assetType, maxDuration]
  );

  const resetAndLoad = useCallback(
    (albumName: string | null) => {
      if (currentAlbumRef.current !== albumName) {
        setPhotos([]);
        photosRef.current = [];
        currentAlbumRef.current = albumName;
      }
      setEndCursor(undefined);
      setHasNextPage(true);
      setSelectedAlbum(albumName);
      fetchPhotos(undefined, albumName);
    },
    [fetchPhotos]
  );

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingRef.current) return;
    fetchPhotos(endCursor, selectedAlbum);
  }, [hasNextPage, endCursor, selectedAlbum, fetchPhotos]);

  const handleCamera = useCallback(async () => {
    const ok = await checkCameraPerm();
    if (!ok) {
      Alert.alert('Camera Permission', 'Allow camera access in Settings.', [
        { text: 'Cancel' },
        { text: 'Open Settings', onPress: openSettings },
      ]);
      return;
    }
    const opts: CameraOptions = {
      mediaType: 'photo',
      quality: 0.9,
      saveToPhotos: false,
    };
    try {
      const res = await launchCamera(opts);
      if (res.didCancel || res.errorCode || !res.assets?.length) return;
      const asset = res.assets[0];
      const out: GalleryAsset = {
        uri: asset.uri!,
        type: asset.type || 'image/jpeg',
        fileName: asset.fileName || `photo_${Date.now()}.jpg`,
      };
      onSelect([out]);
      handleClosePress();
    } catch (err) {
      console.error('[Gallery] camera error:', err);
    }
  }, [onSelect, handleClosePress]);

  const toggleSelect = useCallback(
    (photo: PhotoIdentifier) => {
      const uri = photo.node.image.uri;
      if (maxSelect === 1) {
        const out: GalleryAsset = {
          uri,
          type: mediaTypeOf(photo),
          fileName: photo.node.image.filename || `media_${Date.now()}`,
          duration: photo.node.image.playableDuration ?? undefined,
          width: photo.node.image.width,
          height: photo.node.image.height,
        };
        onSelect([out]);
        handleClosePress();
        return;
      }
      setSelected((prev) => {
        if (prev[uri]) {
          const next = { ...prev };
          delete next[uri];
          return next;
        }
        if (Object.keys(prev).length >= maxSelect) {
          Alert.alert(`Max ${maxSelect} items`, `You can select up to ${maxSelect} items at once.`);
          return prev;
        }
        return { ...prev, [uri]: photo };
      });
    },
    [maxSelect, onSelect, handleClosePress]
  );

  const handleSend = useCallback(() => {
    const assets: GalleryAsset[] = Object.values(selected).map((photo) => ({
      uri: photo.node.image.uri,
      type: mediaTypeOf(photo),
      fileName: photo.node.image.filename || `media_${Date.now()}`,
      duration: photo.node.image.playableDuration ?? undefined,
      width: photo.node.image.width,
      height: photo.node.image.height,
    }));
    onSelect(assets);
    handleClosePress();
  }, [selected, onSelect, handleClosePress]);

  const gridData = useMemo(
    () => [{ isCameraCell: true }, ...photos] as any[],
    [photos]
  );


  const renderCell = useCallback(
    ({ item }: { item: any }) => {
      if (item.isCameraCell) {
        return (
          <TouchableOpacity
            style={[styles.cameraCell, isDark && { backgroundColor: '#2A2A2A', borderColor: '#1E1E1E' }]}
            onPress={handleCamera}
            activeOpacity={0.8}
          >
            <Icon name="camera" size={30} color={isDark ? '#AAA' : '#666'} />
            <Text style={[styles.cameraCellText, isDark && { color: '#AAA' }]}>Camera</Text>
          </TouchableOpacity>
        );
      }

      const photo: PhotoIdentifier = item;
      const uri = photo.node.image.uri;
      const typeLower = photo.node.type?.toLowerCase();
      const isVideo = typeLower === 'video' || typeLower?.includes('video') || (photo.node.image.playableDuration != null && photo.node.image.playableDuration > 0) || uri?.toLowerCase()?.endsWith('.mp4') || uri?.toLowerCase()?.endsWith('.mov') || uri?.toLowerCase()?.endsWith('.mkv');
      const dur = photo.node.image.playableDuration;
      const isSelected = !!selected[uri];
      const selIndex = isSelected ? Object.keys(selected).indexOf(uri) + 1 : -1;

      return (
        <TouchableOpacity
          style={[styles.cell, isDark && { borderColor: '#1E1E1E' }]}
          onPress={() => toggleSelect(photo)}
          activeOpacity={0.85}
        >
          <Image source={{ uri }} style={styles.cellImage} />
          {isSelected && <View style={styles.selectedOverlay} />}
          {maxSelect > 1 && (
            <View
              style={[
                styles.selectBadge,
                isSelected && { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.75)', borderColor: '#FFFFFF' },
              ]}
            >
              {isSelected ? <Text style={styles.selectBadgeText}>{selIndex}</Text> : null}
            </View>
          )}
          {isVideo && dur != null && (
            <View style={styles.videoBadge}>
              <Icon name="play-circle" size={14} color="#FFF" style={{ marginRight: 3 }} />
              <Text style={styles.videoDuration}>{fmtDuration(dur)}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selected, handleCamera, toggleSelect, themeColor, maxSelect, isDark]
  );

  const albumLabel = selectedAlbum ?? 'All Photos';

  const PermDenied = () => (
    <View style={[styles.permDenied, isDark && { backgroundColor: '#1E1E1E' }]}>
      <Icon name="images-outline" size={64} color={isDark ? '#444' : '#CCC'} />
      <Text style={[styles.permDeniedTitle, isDark && { color: '#FFF' }]}>Gallery Access Required</Text>
      <Text style={[styles.permDeniedSub, isDark && { color: '#AAA' }]}>
        Allow photo access so you can share images and videos.
      </Text>
      <TouchableOpacity
        style={[styles.permButton, { backgroundColor: themeColor }]}
        onPress={async () => {
          const ok = await checkStoragePerm();
          if (ok) {
            setPermGranted('granted');
            resetAndLoad(null);
            loadAlbums();
          } else {
            openSettings();
          }
        }}
      >
        <Text style={styles.permButtonText}>Allow Access</Text>
      </TouchableOpacity>
    </View>
  );

  const AlbumBrowser = () => {
    const allPhotosAlbum = useMemo(() => ({
      title: 'All Photos',
      count: photos.length,
      coverUri: photos[0]?.node.image.uri ?? null,
    }), [photos]);

    const allAlbums = useMemo(() => [allPhotosAlbum, ...albums], [allPhotosAlbum, albums]);

    return (
      <FlatList
        data={allAlbums}
        keyExtractor={(a) => a.title}
        renderItem={({ item }) => (
          <AlbumRow
            album={item}
            selected={(selectedAlbum === null && item.title === 'All Photos') || selectedAlbum === item.title}
            onPress={() => {
              setActiveTab('photos');
              resetAndLoad(item.title === 'All Photos' ? null : item.title);
            }}
            theme={theme}
          />
        )}
      />
    );
  };



  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClosePress}
    >
      <StatusBar backgroundColor="transparent" barStyle={isDark ? "light-content" : "dark-content"} translucent />
      <View style={styles.modalOverlay}>
        {/* Backdrop click to dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={handleClosePress}
        >
          <Animated.View style={[styles.backdropBackground, { opacity: backdropOpacity }]} />
        </TouchableOpacity>

        {/* Sheet Container */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              height: SHEET_HEIGHT,
              transform: [{ translateY }],
            },
            isDark && { backgroundColor: '#1E1E1E' }
          ]}
        >
          {/* Drag Indicator/Handle Bar (Visual only) */}
          <View style={[styles.dragIndicatorArea, isDark && { backgroundColor: '#1E1E1E' }]}>
            <View style={[styles.dragIndicatorPill, isDark && { backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
          </View>

          {/* Header */}
          <View style={[styles.header, isDark && { backgroundColor: '#1E1E1E', borderBottomColor: '#2A2A2A' }]}>
            <TouchableOpacity onPress={handleClosePress} style={styles.headerBtn}>
              <Icon name="close" size={24} color={isDark ? '#FFF' : '#333'} />
            </TouchableOpacity>

            {/* Tab selector */}
            <View style={[styles.tabContainer, isDark && { backgroundColor: '#2A2A2A' }]}>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  activeTab === 'photos' && (isDark ? { backgroundColor: '#1E1E1E' } : styles.tabButtonActive)
                ]}
                onPress={() => setActiveTab('photos')}
                disabled={permGranted !== 'granted'}
              >
                <Text 
                  style={[
                    styles.tabText,
                    activeTab === 'photos' && { color: isDark ? '#FFFFFF' : '#000000', fontWeight: 'bold' },
                    isDark && activeTab !== 'photos' && { color: '#888888' }
                  ]} 
                  numberOfLines={1}
                >
                  {albumLabel}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  activeTab === 'folders' && (isDark ? { backgroundColor: '#1E1E1E' } : styles.tabButtonActive)
                ]}
                onPress={() => setActiveTab('folders')}
                disabled={permGranted !== 'granted'}
              >
                <Text 
                  style={[
                    styles.tabText,
                    activeTab === 'folders' && { color: isDark ? '#FFFFFF' : '#000000', fontWeight: 'bold' },
                    isDark && activeTab !== 'folders' && { color: '#888888' }
                  ]}
                >
                  Folder
                </Text>
              </TouchableOpacity>
            </View>

            {/* Right: tick button / confirm selection */}
            <View style={styles.headerRight}>
              {selectedCount > 0 && (
                <TouchableOpacity
                  onPress={handleSend}
                  style={[styles.tickButton, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.8)' }]}
                  activeOpacity={0.8}
                >
                  <Icon name="checkmark" size={18} color="#FFF" />
                  <View style={[styles.tickBadge, { backgroundColor: isDark ? '#FFFFFF' : '#000000', borderColor: isDark ? '#1E1E1E' : '#FFFFFF' }]}>
                    <Text style={[styles.tickBadgeText, { color: isDark ? '#000000' : '#FFFFFF' }]}>{selectedCount}</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Body: permission denied, folders grid, or photos grid */}
          <View style={[{ flex: 1 }, isDark && { backgroundColor: '#1E1E1E' }]}>
            {permGranted === 'checking' ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#CCCCCC" />
              </View>
            ) : permGranted === 'denied' ? (
              <PermDenied />
            ) : activeTab === 'folders' ? (
              <AlbumBrowser />
            ) : loadingPhotos && photos.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#CCCCCC" />
              </View>
            ) : (
              <FlatList
                data={gridData}
                keyExtractor={(item, idx) =>
                  item.isCameraCell ? 'camera' : item.node?.image?.uri ?? String(idx)
                }
                numColumns={NUM_COLS}
                renderItem={renderCell}
                onEndReached={loadMore}
                onEndReachedThreshold={0.4}
                removeClippedSubviews
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 12 }}
                ListFooterComponent={
                  loadingPhotos && photos.length > 0 ? (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <ActivityIndicator color={themeColor} />
                    </View>
                  ) : null
                }
              />
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  dragIndicatorArea: {
    width: '100%',
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  dragIndicatorPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },

  // Header
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 0.5,
    borderBottomColor: '#EFEFEF',
  },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerRight: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  tickButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  tickBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  tickBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },

  // Tabs style
  tabContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555555',
  },

  // Grid cell
  cell: {
    width: CELL_SIZE, height: CELL_SIZE,
    borderWidth: 0.5, borderColor: '#FFF',
    position: 'relative', overflow: 'hidden',
  },
  cellImage: { width: CELL_SIZE, height: CELL_SIZE },
  selectedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  selectBadge: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#FFF',
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  selectBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  videoBadge: {
    position: 'absolute', bottom: 4, left: 4,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
  },
  videoDuration: { color: '#FFF', fontSize: 11, fontWeight: '600' },

  // Camera shortcut cell
  cameraCell: {
    width: CELL_SIZE, height: CELL_SIZE,
    backgroundColor: '#F5F5F5', borderWidth: 0.5, borderColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
  },
  cameraCellText: { color: '#666', fontSize: 12, marginTop: 6 },

  // Permission denied
  permDenied: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  permDeniedTitle: { color: '#333', fontSize: 20, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  permDeniedSub: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  permButton: { marginTop: 28, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24 },
  permButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },


});

export default CustomGalleryPicker;
