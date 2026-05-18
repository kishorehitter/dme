/**
 * StatusViewer.tsx — Final
 *
 * Fixes in this version
 * ─────────────────────
 * [1] Buttons not working — tapZones absoluteFillObject was covering the entire
 *     screen including the bottom bar, swallowing all button taps.
 *     Fixed: tapZones now only covers the media area (above the bottom bar).
 * [2] Caption centered — added textAlign: 'center'
 * [3] Bottom bar layout: Like LEFT · Reply input CENTER (rounded) · Save RIGHT
 *     spaced with justifyContent: 'space-between'
 * [4] Reply input is always visible in bottom bar (not hidden behind a toggle),
 *     tapping it focuses + pauses progress. Send button inside the input.
 * [5] All elements respect safe area insets — nothing hidden under notch or nav bar
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions,
  TouchableWithoutFeedback, TouchableOpacity,
  StatusBar, Animated, FlatList, Modal,
  ActivityIndicator, Alert, Platform,
  PanResponder, TextInput, KeyboardAvoidingView,
  NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../utils/image';
import {
  StatusService, Status, StatusViewer as ViewerType, LikedUser
} from '../services/StatusService';

const { width: W, height: H } = Dimensions.get('window');
const PHOTO_DURATION = 5000;
const BOTTOM_BAR_HEIGHT = 80;

interface ViewerSheetProps {
  statusId:  number;
  viewCount: number;
  visible:   boolean;
  onClose:   () => void;
}

const ViewerSheet: React.FC<ViewerSheetProps> = ({
  statusId, viewCount, visible, onClose,
}) => {
  const [viewers,    setViewers]    = useState<ViewerType[]>([]);
  const [likeCount,  setLikeCount]  = useState(0);
  const [likedUsers, setLikedUsers] = useState<LikedUser[]>([]);
  const [tab,        setTab]        = useState<'views' | 'likes'>('views');
  const [loading,    setLoading]    = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    StatusService.getViewers(statusId)
      .then(data => {
        // Ensure data exists and has the expected properties
        setViewers(data?.viewers || []);
        setLikeCount(data?.like_count || 0);
        setLikedUsers(data?.liked_users || []);
      })
      .catch(err => {
        console.error('[StatusViewer] Error loading viewers:', err);
        setViewers([]);
      })
      .finally(() => setLoading(false));
  }, [visible, statusId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={vs.overlay} />
      </TouchableWithoutFeedback>

      <View style={[vs.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={vs.handle} />

        <View style={vs.tabRow}>
          <TouchableOpacity
            style={[vs.tab, tab === 'views' && vs.tabActive]}
            onPress={() => setTab('views')}
          >
            <Icon name="eye-outline" size={16} color={tab === 'views' ? '#8100D1' : '#888'} />
            <Text style={[vs.tabText, tab === 'views' && vs.tabTextActive]}>
              {viewCount} view{viewCount !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[vs.tab, tab === 'likes' && vs.tabActive]}
            onPress={() => setTab('likes')}
          >
            <Icon name="heart" size={16} color={tab === 'likes' ? '#ff4d6d' : '#888'} />
            <Text style={[vs.tabText, tab === 'likes' && { color: '#ff4d6d' }]}>
              {likeCount} like{likeCount !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#8100D1" style={{ marginTop: 24 }} />
        ) : tab === 'views' ? (
          viewers.length === 0 ? (
            <Text style={vs.empty}>No views yet</Text>
          ) : (
            <FlatList
              data={viewers}
              keyExtractor={v => String(v.viewer_id)}
              renderItem={({ item }) => (
                <View style={vs.row}>
                  {item.viewer_avatar_sticker ? (
                    <View style={[vs.avatar, vs.fallback]}>
                      <Text style={{ fontSize: 24 }}>{item.viewer_avatar_sticker}</Text>
                    </View>
                  ) : item.viewer_avatar ? (
                    <Image source={{ uri: item.viewer_avatar }} style={vs.avatar} />
                  ) : (
                    <View style={[vs.avatar, vs.fallback]}>
                      <Text style={{ color: '#fff', fontWeight: '600' }}>
                        {item.viewer_username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={vs.name}>{item.viewer_username}</Text>
                    <Text style={vs.time}>
                      {new Date(item.viewed_at).toLocaleTimeString([], {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  {item.has_liked && <Icon name="heart" size={16} color="#ff4d6d" />}
                </View>
              )}
            />
          )
        ) : (
          likedUsers.length === 0 ? (
            <Text style={vs.empty}>No likes yet</Text>
          ) : (
            <FlatList
              data={likedUsers}
              keyExtractor={u => String(u.user_id)}
              renderItem={({ item }) => (
                <View style={vs.row}>
                  {item.avatar_sticker ? (
                    <View style={[vs.avatar, vs.fallback]}>
                      <Text style={{ fontSize: 24 }}>{item.avatar_sticker}</Text>
                    </View>
                  ) : item.avatar ? (
                    <Image source={{ uri: item.avatar }} style={vs.avatar} />
                  ) : (
                    <View style={[vs.avatar, vs.fallback]}>
                      <Text style={{ color: '#fff', fontWeight: '600' }}>
                        {item.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={vs.name}>{item.username}</Text>
                    <Text style={vs.time}>
                      {new Date(item.liked_at).toLocaleTimeString([], {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Icon name="heart" size={16} color="#ff4d6d" />
                </View>
              )}
            />
          )
        )}
      </View>
    </Modal>
  );
};

const vs = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#8100D1',
  },
  tabText: {
    fontSize: 14,
    color: '#888',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#8100D1',
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: H * 0.6, backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  handle:  { width: 40, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  title:   { fontSize: 16, fontWeight: '600', textAlign: 'center', paddingBottom: 12, color: '#111' },
  empty:   { textAlign: 'center', color: '#aaa', marginTop: 24, fontSize: 14 },
  row:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  avatar:  { width: 42, height: 42, borderRadius: 21, marginRight: 12 },
  fallback:{ backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  name:    { fontSize: 14, fontWeight: '500', color: '#111' },
  time:    { fontSize: 12, color: '#888', marginTop: 2 },
});

interface RouteParams {
  statuses:      Status[];
  initialIndex:  number;
  currentUserId: number;
  isOwn:         boolean;
}

const StatusViewerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route      = useRoute();
  const insets     = useSafeAreaInsets();

  const { statuses: initialStatuses, initialIndex, isOwn } = route.params as RouteParams;

  const [statuses,      setStatuses]      = useState<Status[]>(initialStatuses);
  const [index,         setIndex]         = useState(initialIndex);
  const [showViewers,   setShowViewers]   = useState(false);
  const [videoDuration, setVideoDuration] = useState(PHOTO_DURATION);
  const [videoPaused,   setVideoPaused]   = useState(false);

  const [liked,       setLiked]       = useState(false);
  const [likeCount,   setLikeCount]   = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);

  const [replyText,   setReplyText]   = useState('');
  const [replyFocused,setReplyFocused]= useState(false);
  const [replySending,setReplySending]= useState(false);

  const [saving, setSaving] = useState(false);

  const progress  = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const viewedSet = useRef(new Set<number>());
  const replyRef  = useRef<TextInput>(null);

  const current = statuses[index];
  const isVideo = current?.media_type === 'video';
  const isOwner = isOwn;

  const translateY   = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !replyFocused && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove:    (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) {
          Animated.timing(translateY, { toValue: H, duration: 200, useNativeDriver: true })
            .start(() => navigation.goBack());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const startProgress = useCallback((duration: number) => {
    progress.setValue(0);
    animation.current?.stop();
    animation.current = Animated.timing(progress, { toValue: 1, duration, useNativeDriver: false });
    animation.current.start(({ finished }) => {
      if (!finished) return;
      setIndex(i => {
        if (i < statuses.length - 1) return i + 1;
        navigation.goBack();
        return i;
      });
    });
  }, [statuses.length, navigation, progress]);

  const stopProgress = useCallback(() => animation.current?.stop(), []);

  useEffect(() => {
    if (!current) return;

    if (!isOwner && !viewedSet.current.has(current.id)) {
      viewedSet.current.add(current.id);
      StatusService.markViewed(current.id);
    }

    if (!isOwner) {
      setLiked((current as any).is_liked ?? false);
      setLikeCount((current as any).like_count ?? 0);
    }
  }, [index, current?.id]);

  useEffect(() => {
    if (!current || isVideo) return;
    startProgress(PHOTO_DURATION);
    return () => animation.current?.stop();
  }, [index]);

  useEffect(() => {
    if (replyFocused) stopProgress();
    else if (!isVideo) startProgress(PHOTO_DURATION);
  }, [replyFocused]);

  const handleTap = (side: 'left' | 'right') => {
    if (replyFocused) {
      replyRef.current?.blur();
      return;
    }
    stopProgress();
    if (side === 'left') {
      setIndex(i => Math.max(0, i - 1));
    } else {
      setIndex(i => {
        if (i < statuses.length - 1) return i + 1;
        navigation.goBack();
        return i;
      });
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Status', 'Remove this status?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await StatusService.deleteStatus(current.id);
            const updated = statuses.filter(s => s.id !== current.id);
            if (updated.length === 0) { navigation.goBack(); return; }
            setStatuses(updated);
            setIndex(i => Math.min(i, updated.length - 1));
          } catch { Alert.alert('Error', 'Could not delete status.'); }
        },
      },
    ]);
  };

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    const was = liked;
    setLiked(!was);
    setLikeCount(c => Math.max(0, c + (was ? -1 : 1)));
    try {
      if (was) await StatusService.unlikeStatus(current.id);
      else     await StatusService.likeStatus(current.id);
    } catch {
      setLiked(was);
      setLikeCount(c => Math.max(0, c + (was ? 1 : -1)));
    } finally {
      setLikeLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      await StatusService.replyToStatus(current.id, replyText.trim());
      setReplyText('');
      replyRef.current?.blur();
      Alert.alert('Sent', `Reply sent to ${current.username}`);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send reply.');
    } finally {
      setReplySending(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const RNFetchBlob    = (await import('rn-fetch-blob')).default;
      const { CameraRoll } = await import('@react-native-camera-roll/camera-roll');
      const { dirs }       = RNFetchBlob.fs;
      const ext            = isVideo ? 'mp4' : 'jpg';
      const dest           = `${dirs.CacheDir}/sv_${current.id}.${ext}`;
      const url            = current.media_url || current.media_file;
      await RNFetchBlob.config({ path: dest }).fetch('GET', url);
      await CameraRoll.saveAsset(`file://${dest}`, { type: isVideo ? 'video' : 'photo' });
      Alert.alert('Saved', 'Saved to your gallery.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Check storage permissions.');
    } finally {
      setSaving(false);
    }
  };

  if (!current) { return null; }

  const displayName = isOwner ? 'My Status' : current.username;
  const bottomBarH = BOTTOM_BAR_HEIGHT + insets.bottom;

  return (
    <View
      style={s.container}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent={false} />

      {/* ── Media ── */}
      {isVideo ? (
        <Video
          source={{ uri: resolveImageUrl(current.media_url || current.media_file) }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          paused={videoPaused || showViewers || replyFocused}
          repeat={false}
          onLoad={({ duration }) => {
            const ms = (duration || 10) * 1000;
            setVideoDuration(ms);
            startProgress(ms);
          }}
          onEnd={() => setIndex(i => {
            if (i < statuses.length - 1) return i + 1;
            navigation.goBack();
            return i;
          })}
        />
      ) : (
        <Image
          source={{ uri: resolveImageUrl(current.media_url || current.media_file) }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          resizeMethod={Platform.OS === 'android' ? 'resize' : 'auto'}
        />
      )}

      {/* ── Scrims ── */}
      <View style={s.topScrim}    pointerEvents="none" />
      <View style={s.bottomScrim} pointerEvents="none" />

      {/* ── Progress bars ── */}
      <View style={[s.progressRow, { top: insets.top + 6 }]} pointerEvents="none">
        {statuses.map((_, i) => (
          <View key={i} style={s.track}>
            <Animated.View style={[s.trackFill, {
              width: i < index ? '100%'
                : i === index
                  ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                  : '0%',
            }]} />
          </View>
        ))}
      </View>

      {/* ── Header ── */}
      <View style={[s.header, { top: insets.top + 6 }]} pointerEvents="box-none">
        <View style={s.headerLeft}>
          {current.user_avatar_sticker ? (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={{ fontSize: 24 }}>{current.user_avatar_sticker}</Text>
            </View>
          ) : current.user_avatar ? (
            <Image source={{ uri: current.user_avatar }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ marginLeft: 8 }}>
            <Text style={s.headerName}>{displayName}</Text>
            <Text style={s.headerTime}>
              {new Date(current.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.iconBtn}>
            <Icon name="close" size={26} color="#fff" style={s.iconShadow} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.tapZones, { bottom: bottomBarH }]} pointerEvents="box-none">
        <TouchableWithoutFeedback onPress={() => handleTap('left')}>
          <View style={{ flex: 1 }} />
        </TouchableWithoutFeedback>
        <TouchableWithoutFeedback onPress={() => handleTap('right')}>
          <View style={{ flex: 2 }} />
        </TouchableWithoutFeedback>
      </View>

      {!!current.caption && !replyFocused && (
        <View style={[s.captionWrap, { bottom: bottomBarH + 12 }]} pointerEvents="none">
          <Text style={s.caption}>{current.caption}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kvWrapper}
      >
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
          {isOwner ? (
            <>
              <TouchableOpacity
                style={s.ownerActionBtn}
                onPress={() => { stopProgress(); setShowViewers(true); }}
              >
                <Icon name="eye-outline" size={26} color="#fff" style={s.iconShadow} />
                <Text style={s.ownerActionText}>{current.view_count}</Text>
              </TouchableOpacity>

              <View style={s.ownerLikesCenter}>
                <Icon name="heart" size={24} color="#ff4d6d" style={s.iconShadow} />
                <Text style={s.ownerActionText}>{(current as any).like_count ?? 0}</Text>
              </View>

              <TouchableOpacity
                style={s.ownerActionBtn}
                onPress={handleDelete}
              >
                <Icon name="trash-outline" size={24} color="#fff" style={s.iconShadow} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={s.likeBtn}
                onPress={handleLike}
                disabled={likeLoading}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon
                  name={liked ? 'heart' : 'heart-outline'}
                  size={28}
                  color={liked ? '#ff4d6d' : '#fff'}
                />
              </TouchableOpacity>

              <View style={s.replyWrap}>
                <TextInput
                  ref={replyRef}
                  style={s.replyInput}
                  placeholder={`Reply to ${current.username}…`}
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={replyText}
                  onChangeText={setReplyText}
                  onFocus={() => setReplyFocused(true)}
                  onBlur={() => setReplyFocused(false)}
                  returnKeyType="send"
                  onSubmitEditing={handleSendReply}
                  maxLength={500}
                  blurOnSubmit={false}
                />
                <TouchableOpacity
                  style={[s.sendBtn, (!replyText.trim() || replySending) && { opacity: 0.4 }]}
                  onPress={handleSendReply}
                  disabled={!replyText.trim() || replySending}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {replySending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Icon name="send" size={16} color="#fff" />
                  }
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.saveBtn}
                onPress={handleSave}
                disabled={saving}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="download-outline" size={26} color="#fff" />
                }
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      {isOwner && (
        <ViewerSheet
          statusId={current.id}
          viewCount={current.view_count}
          visible={showViewers}
          onClose={() => {
            setShowViewers(false);
            startProgress(isVideo ? videoDuration : PHOTO_DURATION);
          }}
        />
      )}
    </View>
  );
};

const s = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#000',
  },
  progressRow: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 4, zIndex: 10 },
  track:       { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 1, overflow: 'hidden' },
  trackFill:   { height: '100%', backgroundColor: '#fff', borderRadius: 1 },
  header:        { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 10 },
  headerLeft:    { flexDirection: 'row', alignItems: 'center' },
  avatar:        { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  avatarFallback:{ backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  headerName:    { color: '#fff', fontWeight: '600', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  headerTime:    { color: 'rgba(255,255,255,0.9)', fontSize: 11, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  headerRight:   { flexDirection: 'row', alignItems: 'center' },
  iconBtn:       { padding: 8, marginLeft: 4 },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  tapZones: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row' },
  captionWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  caption: { color: '#fff', fontSize: 16, fontWeight: '500', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6, lineHeight: 22 },
  kvWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomBar: { flexDirection:  'row', alignItems:     'center', paddingHorizontal: 14, paddingTop:     12, justifyContent: 'space-between' },
  ownerActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  ownerActionText: { color: '#fff', fontSize: 14, marginLeft: 6, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  ownerLikesCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeBtn:   { alignItems: 'center', minWidth: 36 },
  replyWrap: { flex: 1, flexDirection:   'row', alignItems:      'center', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius:    24, marginHorizontal: 12, paddingLeft:     14, paddingRight:    6, minHeight:       42 },
  replyInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 8, maxHeight: 80 },
  sendBtn: { width:           32, height:          32, borderRadius:    16, backgroundColor: '#8100D1', justifyContent:  'center', alignItems:      'center', marginLeft:      6 },
  saveBtn: { alignItems: 'center', minWidth: 36 },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 100, backgroundColor: 'rgba(0,0,0,0.3)' },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.4)' },
});

export default StatusViewerScreen;