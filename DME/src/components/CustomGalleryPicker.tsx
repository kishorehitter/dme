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
  PanResponder,
} from 'react-native';
import {
  CameraRoll,
  PhotoIdentifier,
  GetPhotosParams,
} from '@react-native-camera-roll/camera-roll';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchCamera, CameraOptions } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const NUM_COLS = 3;
const CELL_SIZE = SCREEN_W / NUM_COLS;
const PAGE_SIZE = 60;
const MAX_SELECT = 10;
const THEME = '#4597f5f6';

const SHEET_MAX_HEIGHT = SCREEN_H * 0.9;
const SHEET_MIN_HEIGHT = SCREEN_H * 0.5;
const HIDDEN_OFFSET = SHEET_MAX_HEIGHT;
const MIN_HEIGHT_OFFSET = SHEET_MAX_HEIGHT - SHEET_MIN_HEIGHT;

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const mediaTypeOf = (photo: PhotoIdentifier): string => {
  const { type, uri } = photo.node.image;
  if (type === 'video') return 'video/mp4';
  if (uri?.endsWith('.png')) return 'image/png';
  if (uri?.endsWith('.gif')) return 'image/gif';
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
const AlbumTile: React.FC<{
  album: Album;
  selected: boolean;
  onPress: () => void;
}> = ({ album, selected, onPress }) => {
  const tileWidth = (SCREEN_W - 36) / 2;
  return (
    <TouchableOpacity
      style={[
        albumStyles.tile,
        { width: tileWidth, height: tileWidth },
        selected && { borderColor: THEME, borderWidth: 2.5 }
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {album.coverUri ? (
        <Image source={{ uri: album.coverUri }} style={albumStyles.tileImg} />
      ) : (
        <View style={[albumStyles.tileImg, { backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' }]}>
          <Icon name="images-outline" size={36} color="#999" />
        </View>
      )}

      {/* Dark overlay with white texts at bottom */}
      <View style={albumStyles.tileOverlay}>
        <Text style={albumStyles.tileTitle} numberOfLines={1}>
          {album.title}
        </Text>
        <Text style={albumStyles.tileCount}>
          {album.count} items
        </Text>
      </View>

      {selected && (
        <View style={albumStyles.checkBadge}>
          <Icon name="checkmark" size={12} color="#FFF" />
        </View>
      )}
    </TouchableOpacity>
  );
};

const albumStyles = StyleSheet.create({
  tile: {
    margin: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
    position: 'relative',
    borderColor: '#E5E5E5',
    borderWidth: 1,
  },
  tileImg: {
    width: '100%',
    height: '100%',
  },
  tileOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
    borderTopWidth: 0.5,
    borderTopColor: '#EFEFEF',
  },
  tileTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  tileCount: {
    fontSize: 10,
    color: '#666',
    marginTop: 1,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: THEME,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    elevation: 1,
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export const CustomGalleryPicker: React.FC<Props> = ({
  visible,
  onClose,
  onSelect,
  maxSelect = MAX_SELECT,
  themeColor = THEME,
}) => {
  const insets = useSafeAreaInsets();

  const [permGranted, setPermGranted] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [showAlbums, setShowAlbums] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoIdentifier[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(true);
  const isFetchingRef = useRef(false);
  const [selected, setSelected] = useState<{ [uri: string]: PhotoIdentifier }>({});
  const selectedCount = Object.keys(selected).length;
  const sendBarAnim = useRef(new Animated.Value(0)).current;

  // Sheet height gesture animated value
  const sheetHeight = useRef(new Animated.Value(0)).current;
  const currentPos = useRef<'min' | 'max'>('min');
  const startHeight = useRef(SHEET_MIN_HEIGHT);

  const snapTo = useCallback((position: 'min' | 'max' | 'hidden') => {
    let toValue = SHEET_MIN_HEIGHT;
    if (position === 'max') toValue = SHEET_MAX_HEIGHT;
    if (position === 'hidden') toValue = 0;

    Animated.spring(sheetHeight, {
      toValue,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start(() => {
      if (position === 'hidden') {
        onClose();
      } else {
        currentPos.current = position === 'max' ? 'max' : 'min';
      }
    });
  }, [onClose, sheetHeight]);

  const handleClosePress = useCallback(() => {
    snapTo('hidden');
  }, [snapTo]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        if (currentPos.current === 'max') {
          startHeight.current = SHEET_MAX_HEIGHT;
        } else {
          startHeight.current = SHEET_MIN_HEIGHT;
        }
      },
      onPanResponderMove: (_, gestureState) => {
        // Dragging up (negative dy) increases height, dragging down (positive dy) decreases height
        let newHeight = startHeight.current - gestureState.dy;
        if (newHeight > SHEET_MAX_HEIGHT) {
          const diff = newHeight - SHEET_MAX_HEIGHT;
          newHeight = SHEET_MAX_HEIGHT + diff * 0.25; // Apply rubber band effect
        }
        sheetHeight.setValue(newHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dy, vy } = gestureState;
        const threshold = 100;

        if (currentPos.current === 'min') {
          if (dy < -threshold || vy < -0.4) {
            snapTo('max');
          } else if (dy > threshold || vy > 0.4) {
            snapTo('hidden');
          } else {
            snapTo('min');
          }
        } else {
          // currentPos is 'max'
          if (dy > threshold || vy > 0.4) {
            if (dy > SHEET_MIN_HEIGHT * 0.7) {
              snapTo('hidden');
            } else {
              snapTo('min');
            }
          } else {
            snapTo('max');
          }
        }
      },
    })
  ).current;

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
    (async () => {
      const granted = await checkStoragePerm();
      if (!active) return;
      setPermGranted(granted);
      if (granted) {
        resetAndLoad(null);
        loadAlbums();
      }
    })();

    // Animate open to initial height (50%)
    sheetHeight.setValue(0);
    Animated.spring(sheetHeight, {
      toValue: SHEET_MIN_HEIGHT,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start(() => {
      currentPos.current = 'min';
    });

    return () => {
      active = false;
      setPhotos([]);
      setEndCursor(undefined);
      setHasNextPage(true);
      setSelected({});
      setSelectedAlbum(null);
      setShowAlbums(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Auto-expand sheet when showing albums dropdown
  useEffect(() => {
    if (showAlbums) {
      snapTo('max');
    }
  }, [showAlbums, snapTo]);

  const loadAlbums = useCallback(async () => {
    try {
      const groups = await CameraRoll.getAlbums({ assetType: 'All' });
      const albumsWithCovers: Album[] = await Promise.all(
        groups.map(async (g) => {
          try {
            const res = await CameraRoll.getPhotos({
              first: 1,
              groupTypes: 'Album',
              groupName: g.title,
              assetType: 'All',
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
  }, []);

  const fetchPhotos = useCallback(
    async (cursor?: string, albumName?: string | null) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      setLoadingPhotos(true);

      const params: GetPhotosParams = {
        first: PAGE_SIZE,
        assetType: 'All',
        include: ['filename', 'fileSize', 'imageSize', 'playableDuration'],
        ...(cursor ? { after: cursor } : {}),
        ...(albumName
          ? { groupTypes: 'Album', groupName: albumName }
          : { groupTypes: 'All' }),
      };

      try {
        const result = await CameraRoll.getPhotos(params);
        setPhotos((prev) => (cursor ? [...prev, ...result.edges] : result.edges));
        setEndCursor(result.page_info.end_cursor);
        setHasNextPage(result.page_info.has_next_page);
      } catch (err) {
        console.error('[Gallery] fetchPhotos error:', err);
      } finally {
        setLoadingPhotos(false);
        isFetchingRef.current = false;
      }
    },
    []
  );

  const resetAndLoad = useCallback(
    (albumName: string | null) => {
      setPhotos([]);
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
      onClose();
    } catch (err) {
      console.error('[Gallery] camera error:', err);
    }
  }, [onSelect, onClose]);

  const toggleSelect = useCallback(
    (photo: PhotoIdentifier) => {
      const uri = photo.node.image.uri;
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
    [maxSelect]
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
    onClose();
  }, [selected, onSelect, onClose]);

  const gridData = useMemo(
    () => [{ isCameraCell: true }, ...photos] as any[],
    [photos]
  );

  const renderCell = useCallback(
    ({ item }: { item: any }) => {
      if (item.isCameraCell) {
        return (
          <TouchableOpacity style={styles.cameraCell} onPress={handleCamera} activeOpacity={0.8}>
            <Icon name="camera" size={30} color="#FFF" />
            <Text style={styles.cameraCellText}>Camera</Text>
          </TouchableOpacity>
        );
      }

      const photo: PhotoIdentifier = item;
      const uri = photo.node.image.uri;
      const isVideo = photo.node.type === 'video';
      const dur = photo.node.image.playableDuration;
      const isSelected = !!selected[uri];
      const selIndex = isSelected ? Object.keys(selected).indexOf(uri) + 1 : -1;

      return (
        <TouchableOpacity
          style={styles.cell}
          onPress={() => toggleSelect(photo)}
          activeOpacity={0.85}
        >
          <Image source={{ uri }} style={styles.cellImage} />
          {isSelected && <View style={styles.selectedOverlay} />}
          <View
            style={[
              styles.selectBadge,
              isSelected && { backgroundColor: themeColor, borderColor: themeColor },
            ]}
          >
            {isSelected ? <Text style={styles.selectBadgeText}>{selIndex}</Text> : null}
          </View>
          {isVideo && dur != null && (
            <View style={styles.videoBadge}>
              <Icon name="play-circle" size={14} color="#FFF" style={{ marginRight: 3 }} />
              <Text style={styles.videoDuration}>{fmtDuration(dur)}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selected, handleCamera, toggleSelect, themeColor]
  );

  const albumLabel = selectedAlbum ?? 'All Photos';

  const PermDenied = () => (
    <View style={styles.permDenied}>
      <Icon name="images-outline" size={64} color="#CCC" />
      <Text style={styles.permDeniedTitle}>Gallery Access Required</Text>
      <Text style={styles.permDeniedSub}>
        Allow photo access so you can share images and videos.
      </Text>
      <TouchableOpacity
        style={[styles.permButton, { backgroundColor: themeColor }]}
        onPress={async () => {
          const ok = await checkStoragePerm();
          if (ok) {
            setPermGranted(true);
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
        numColumns={2}
        contentContainerStyle={{ padding: 6 }}
        renderItem={({ item }) => (
          <AlbumTile
            album={item}
            selected={(selectedAlbum === null && item.title === 'All Photos') || selectedAlbum === item.title}
            onPress={() => {
              setShowAlbums(false);
              resetAndLoad(item.title === 'All Photos' ? null : item.title);
            }}
          />
        )}
      />
    );
  };

  const sendBarTranslate = sendBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [80, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClosePress}
    >
      <StatusBar backgroundColor="transparent" barStyle="dark-content" translucent />
      <View style={styles.modalOverlay}>
        {/* Backdrop click to dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={handleClosePress}
        >
          <View style={styles.backdropBackground} />
        </TouchableOpacity>

        {/* Sheet Container */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              height: sheetHeight,
            },
          ]}
        >
          {/* Drag Indicator/Handle Bar */}
          <View style={styles.dragIndicatorArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicatorPill} />
          </View>

          {/* Header */}
          <View style={styles.header} {...panResponder.panHandlers}>
            <TouchableOpacity onPress={handleClosePress} style={styles.headerBtn}>
              <Icon name="close" size={24} color="#333" />
            </TouchableOpacity>

            {/* Album selector dropdown trigger */}
            <TouchableOpacity
              style={styles.albumSelector}
              onPress={() => setShowAlbums((v) => !v)}
              disabled={!permGranted}
            >
              <Text style={styles.albumSelectorText} numberOfLines={1}>
                {albumLabel}
              </Text>
              <Icon
                name={showAlbums ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#333"
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>

            {/* Right: selection count badge */}
            <View style={styles.headerRight}>
              {selectedCount > 0 && (
                <View style={[styles.countBadge, { backgroundColor: themeColor }]}>
                  <Text style={styles.countBadgeText}>{selectedCount}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Album Dropdown */}
          {showAlbums && permGranted && (
            <View style={styles.albumDropdown}>
              <AlbumBrowser />
            </View>
          )}

          {/* Body: permission denied or grid */}
          <View style={{ flex: 1 }}>
            {!permGranted ? (
              <PermDenied />
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
                ListFooterComponent={
                  loadingPhotos ? (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <ActivityIndicator color={themeColor} />
                    </View>
                  ) : null
                }
              />
            )}
          </View>

          {/* Animated Send Bar (slides up when items selected) */}
          <Animated.View
            style={[
              styles.sendBar,
              {
                paddingBottom: insets.bottom + 8,
                transform: [{ translateY: sendBarTranslate }],
                opacity: sendBarAnim,
              },
            ]}
            pointerEvents={selectedCount > 0 ? 'auto' : 'none'}
          >
            <View style={styles.sendBarInner}>
              <Text style={styles.sendBarLabel}>
                {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
              </Text>
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: themeColor }]}
                onPress={handleSend}
                activeOpacity={0.85}
              >
                <Text style={styles.sendBtnText}>Send</Text>
                <Icon name="send" size={16} color="#FFF" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
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
  albumSelector: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  albumSelectorText: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', maxWidth: '75%' },
  headerRight: { width: 40, alignItems: 'flex-end' },
  countBadge: {
    minWidth: 24, height: 24, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  countBadgeText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  // Album dropdown (Full height category overlay below header like WhatsApp)
  albumDropdown: {
    position: 'absolute', top: 66, left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFF', zIndex: 100, elevation: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 6,
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

  // Send bar
  sendBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF', borderTopWidth: 0.5, borderTopColor: '#E5E5E5',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 5,
  },
  sendBarInner: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12,
  },
  sendBarLabel: { color: '#333', fontSize: 15, fontWeight: '500' },
  sendBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22 },
  sendBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

export default CustomGalleryPicker;
