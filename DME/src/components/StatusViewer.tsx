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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  StatusService, Status, StatusViewer as ViewerType, LikedUser, CallLog
} from '../services/StatusService';

const { width: W, height: H } = Dimensions.get('window');
const PHOTO_DURATION = 5000;
// Height of the bottom action bar — tap zones stop above this
const BOTTOM_BAR_HEIGHT = 80;

// ─── Viewer Sheet (owner only) ────────────────────────────────────────────────

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
        setViewers(data.viewers);
        setLikeCount(data.like_count);
        setLikedUsers(data.liked_users);
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

        {/* Tab row: Views LEFT | Likes RIGHT */}
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
                  {item.viewer_avatar ? (
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
                  {/* Heart icon if this viewer also liked */}
                  {item.has_liked && (
                    <Icon name="heart" size={16} color="#ff4d6d" />
                  )}
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
                  {item.avatar ? (
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

// ─── Main component ───────────────────────────────────────────────────────────

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

  // Like
  const [liked,       setLiked]       = useState(false);
  const [likeCount,   setLikeCount]   = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);

  // Reply — input always visible, focused state controls pause
  const [replyText,   setReplyText]   = useState('');
  const [replyFocused,setReplyFocused]= useState(false);
  const [replySending,setReplySending]= useState(false);

  // Save
  const [saving, setSaving] = useState(false);

  const progress  = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const viewedSet = useRef(new Set<number>());
  const replyRef  = useRef<TextInput>(null);

  const current = statuses[index];
  const isVideo = current?.media_type === 'video';
  const isOwner = isOwn;

  // ── Swipe down ────────────────────────────────────────────────────────────
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

  // ── Progress ──────────────────────────────────────────────────────────────
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

  // ── Mark viewed + load like state ────────────────────────────────────────
  useEffect(() => {
    if (!current) return;

    // Mark as viewed
    if (!isOwner && !viewedSet.current.has(current.id)) {
      viewedSet.current.add(current.id);
      StatusService.markViewed(current.id);
    }

    // Use like data already in status object — no extra API calls, no 404s
    if (!isOwner) {
      setLiked((current as any).is_liked ?? false);
      setLikeCount((current as any).like_count ?? 0);
    }
  }, [index, current?.id]);

  // ── Start timer on slide change ───────────────────────────────────────────
  useEffect(() => {
    if (!current || isVideo) return;
    startProgress(PHOTO_DURATION);
    return () => animation.current?.stop();
  }, [index]);

  // Pause progress while reply input is focused
  useEffect(() => {
    if (replyFocused) stopProgress();
    else if (!isVideo) startProgress(PHOTO_DURATION);
  }, [replyFocused]);

  // ── Tap navigation ────────────────────────────────────────────────────────
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

  // ── Delete ────────────────────────────────────────────────────────────────
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

  // ── Like ──────────────────────────────────────────────────────────────────
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

  // ── Reply ─────────────────────────────────────────────────────────────────
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

  // ── Save ──────────────────────────────────────────────────────────────────
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

  if (!current) { navigation.goBack(); return null; }

  const displayName = isOwner ? 'My Status' : current.username;
  // Height of bottom bar including safe area
  const bottomBarH = BOTTOM_BAR_HEIGHT + insets.bottom;

  return (
    <Animated.View
      style={[s.container, { transform: [{ translateY }] }]}
      {...panResponder.panHandlers}
    >
      <StatusBar hidden />

      {/* ── Media ── */}
      {isVideo ? (
        <Video
          source={{ uri: current.media_url || current.media_file }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
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
          source={{ uri: current.media_url || current.media_file }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
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
      <View style={[s.header, { top: insets.top + 22 }]} pointerEvents="box-none">
        <View style={s.headerLeft}>
          {current.user_avatar ? (
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
          {isOwner && (
            <TouchableOpacity onPress={handleDelete} style={s.iconBtn}>
              <Icon name="trash-outline" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.iconBtn}>
            <Icon name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/*
        FIX [1]: tapZones only cover the area ABOVE the bottom bar.
        Bottom is set to bottomBarH so taps on Like/Reply/Save pass through.
        Previously absoluteFillObject covered 100% of screen height.
      */}
      <View style={[s.tapZones, { bottom: bottomBarH }]} pointerEvents="box-none">
        <TouchableWithoutFeedback onPress={() => handleTap('left')}>
          <View style={{ flex: 1 }} />
        </TouchableWithoutFeedback>
        <TouchableWithoutFeedback onPress={() => handleTap('right')}>
          <View style={{ flex: 2 }} />
        </TouchableWithoutFeedback>
      </View>

      {/* ── Caption — FIX [2]: centered ── */}
      {!!current.caption && !replyFocused && (
        <View style={[s.captionWrap, { bottom: bottomBarH + 12 }]} pointerEvents="none">
          <Text style={s.caption}>{current.caption}</Text>
        </View>
      )}

      {/*
        FIX [3]: Bottom bar layout
        OWNER:  [ 👁 N views ]
        VIEWER: [ ❤️ Like ]  [ ___reply input___  ➤ ]  [ 💾 Save ]
                  LEFT            CENTER                   RIGHT
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kvWrapper}
      >
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
          {isOwner ? (
            /* Owner view */
            <TouchableOpacity
              style={s.viewsBtn}
              onPress={() => { stopProgress(); setShowViewers(true); }}
            >
              <Icon name="eye-outline" size={20} color="#fff" />
              <Text style={s.viewsText}>
                {current.view_count} view{current.view_count !== 1 ? 's' : ''}
              </Text>
              <Text style={s.viewsText}>·</Text>
              <Icon name="heart" size={18} color="#ff4d6d" />
              <Text style={s.viewsText}>
                {(current as any).like_count ?? 0}
              </Text>
            </TouchableOpacity>
          ) : (
            /* Viewer row: Like | Reply input + Send | Save */
            <>
              {/* LEFT — Like */}
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
                {likeCount > 0 && <Text style={s.likeCount}>{likeCount}</Text>}
              </TouchableOpacity>

              {/* CENTER — Reply rounded input with send button inside */}
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
                {/* Send button inside the input on the right */}
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

              {/* RIGHT — Save */}
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

      {/* Viewer sheet */}
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
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  topScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 180,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bottomScrim: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 160,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  // Progress
  progressRow: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 4 },
  track:       { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 1, overflow: 'hidden' },
  trackFill:   { height: '100%', backgroundColor: '#fff', borderRadius: 1 },

  // Header
  header:        { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerLeft:    { flexDirection: 'row', alignItems: 'center' },
  avatar:        { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  avatarFallback:{ backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  headerName:    { color: '#fff', fontWeight: '600', fontSize: 14 },
  headerTime:    { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  headerRight:   { flexDirection: 'row', alignItems: 'center' },
  iconBtn:       { padding: 8, marginLeft: 4 },

  // FIX [1]: tap zones stop at bottom bar, not full screen
  tapZones: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row' },

  // FIX [2]: caption centered
  captionWrap: {
    position: 'absolute', left: 20, right: 20,
    alignItems: 'center',
  },
  caption: {
    color: '#fff', fontSize: 16, fontWeight: '500',
    textAlign: 'center',                          // ← centered
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    lineHeight: 22,
  },

  // Bottom bar
  kvWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomBar: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 14,
    paddingTop:     12,
    // FIX [3]: evenly spaced — Like LEFT, input CENTER, Save RIGHT
    justifyContent: 'space-between',
  },

  // Owner
  viewsBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewsText: { color: '#fff', fontSize: 15, fontWeight: '500' },

  // FIX [3]: Like button — LEFT
  likeBtn:   { alignItems: 'center', minWidth: 36 },
  likeCount: { color: '#fff', fontSize: 11, marginTop: 2, textAlign: 'center' },

  // FIX [3] & [4]: Reply input — CENTER, rounded, send inside
  replyWrap: {
    flex: 1,
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius:    24,
    marginHorizontal: 12,
    paddingLeft:     14,
    paddingRight:    6,
    minHeight:       42,
  },
  replyInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 8,
    maxHeight: 80,
  },
  sendBtn: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: '#8100D1',
    justifyContent:  'center',
    alignItems:      'center',
    marginLeft:      6,
  },

  // FIX [3]: Save button — RIGHT
  saveBtn: { alignItems: 'center', minWidth: 36 },
});

export default StatusViewerScreen;