/**
 * Tabs.tsx
 * StatusTabScreen  — WhatsApp/Instagram-style status list
 * CallLogTabScreen — Call history list
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useAuth } from '../context/AuthContext';
import {
  StatusService,
  CallService,
  Status,
  UserStatusGroup,
  CallLog,
} from '../services/StatusService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 12)  return `${hrs}h ago`;
  return 'today';
}

// ─── My Status Row ────────────────────────────────────────────────────────────

interface MyStatusRowProps {
  statuses:    Status[];
  username:    string;
  avatar:      string | null;
  avatarSticker: string | null;
  onView:      () => void;
  onAdd:       () => void;
  onViewViewers: () => void;
}

const MyStatusRow: React.FC<MyStatusRowProps> = ({
  statuses, username, avatar, avatarSticker, onView, onAdd, onViewViewers,
}) => {
  const hasStatus = statuses.length > 0;
  const allSeen   = hasStatus && statuses.every(s => s.is_viewed);
  const [imgError, setImgError] = useState(false);


  return (
    <View style={styles.statusRow}>
      <TouchableOpacity
        style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}
        onPress={hasStatus ? onView : onAdd}
        activeOpacity={0.7}
      >
        {/* Avatar with ring */}
        <View style={styles.avatarWrapper}>
          {hasStatus && (
            <View style={[
              styles.statusRing,
              allSeen ? styles.ringViewed : styles.ringUnseen,
            ]} />
          )}
          
          {avatarSticker ? (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.stickerAvatar}>{avatarSticker}</Text>
            </View>
          ) : (avatar && !imgError) ? (
            <Image 
              source={{ uri: avatar }} 
              style={styles.avatar} 
              onError={() => setImgError(true)}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Icon name="person" size={24} color="#fff" />
            </View>
          )}

          {/* Add / plus badge */}
          <TouchableOpacity style={styles.addBadge} onPress={onAdd}>
            <Icon name="add" size={14} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.rowName}>My Status</Text>
          <Text style={styles.rowSub}>
            {hasStatus
              ? `${statuses.length} update${statuses.length > 1 ? 's' : ''} · ${timeAgo(statuses[0].created_at)}`
              : 'Tap to add status'}
          </Text>
        </View>
      </TouchableOpacity>


    </View>
  );
};

// ─── Friend Status Row ────────────────────────────────────────────────────────

interface FriendStatusRowProps {
  group:   UserStatusGroup;
  onPress: () => void;
}

const FriendStatusRow: React.FC<FriendStatusRowProps> = ({ group, onPress }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <TouchableOpacity style={styles.statusRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrapper}>
        {/* Purple glowing ring for unseen, grey for seen */}
        <View style={[
          styles.statusRing,
          group.has_unseen ? styles.ringUnseen : styles.ringViewed,
        ]} />
        {group.user_avatar_sticker ? (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.stickerAvatar}>{group.user_avatar_sticker}</Text>
          </View>
        ) : (group.user_avatar && !imgError) ? (
          <Image 
            source={{ uri: group.user_avatar }} 
            style={styles.avatar} 
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(group.username || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{group.username || 'Unknown User'}</Text>
        <Text style={styles.rowSub}>{timeAgo(group.latest_at)}</Text>
      </View>

      <Icon name="chevron-forward" size={18} color="#ccc" />
    </TouchableOpacity>
  );
};

// ─── StatusTabScreen ──────────────────────────────────────────────────────────

export const StatusTabScreen = () => {
  const { user: currentUser } = useAuth();
  const navigation = useNavigation<any>();

  const [myStatuses,     setMyStatuses]     = useState<Status[]>([]);
  const [friendGroups,   setFriendGroups]   = useState<UserStatusGroup[]>([]);
  const [refreshing,     setRefreshing]     = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadStatuses = useCallback(async () => {
    setRefreshing(true);
    try {
      const all = await StatusService.getStatuses();
      const mine   = all.filter(s => s.user_id === currentUser?.id);
      const others = all.filter(s => s.user_id !== currentUser?.id);
      setMyStatuses(mine);
      setFriendGroups(StatusService.groupByUser(others));
    } finally {
      setRefreshing(false);
    }
  }, [currentUser?.id]);

  useFocusEffect(useCallback(() => { loadStatuses(); }, [loadStatuses]));

  // ── Camera / Gallery picker ───────────────────────────────────────────────

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    // Only request READ_MEDIA_IMAGES / READ_MEDIA_VIDEO on API 33+
    // Do NOT request CAMERA here — react-native-image-picker manages it internally
    try {
      if (Platform.Version >= 33) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);
        return Object.values(granted).every(
          v => v === PermissionsAndroid.RESULTS.GRANTED,
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch {
      return true; // let the picker handle it
    }
  };

  const openPicker = async () => {
    await requestCameraPermission();

    Alert.alert('Add Status', 'Choose source', [
      {
        text: '📷 Camera',
        onPress: async () => {
          // If CAMERA is in manifest, we MUST request it ourselves before launchCamera
          if (Platform.OS === 'android') {
            const cameraGranted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.CAMERA,
            );
            if (cameraGranted !== PermissionsAndroid.RESULTS.GRANTED) {
              Alert.alert('Permission Denied', 'Camera permission is required to take photos/videos.');
              return;
            }
          }

          // Do NOT pass mediaType: 'mixed' with camera on Android — causes the
          // "library does not require CAMERA permission" manifest error.
          // Instead ask which they want first.
          Alert.alert('Camera', 'What do you want to capture?', [
            {
              text: '🖼 Photo',
              onPress: async () => {
                const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
                handlePickerResult(result);
              },
            },
            {
              text: '🎥 Video',
              onPress: async () => {
                const result = await launchCamera({
                  mediaType:    'video',
                  videoQuality: 'medium',
                  durationLimit: 30,    // max 30s from camera
                });
                handlePickerResult(result);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ]);
        },
      },
      {
        text: '🖼️ Gallery',
        onPress: async () => {
          const result = await launchImageLibrary({
            mediaType: 'mixed',
            quality:   0.8,
          });
          handlePickerResult(result);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handlePickerResult = (result: any) => {
    if (result.didCancel || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    navigation.navigate('StatusEditor', {
      mediaUri:  asset.uri,
      mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
    });
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const viewMyStatuses = () => {
    if (myStatuses.length === 0) { openPicker(); return; }
    navigation.navigate('StatusViewer', {
      statuses:      myStatuses,
      initialIndex:  0,
      currentUserId: currentUser?.id,
      isOwn:         true,
    });
  };

  const viewFriendStatuses = (group: UserStatusGroup) => {
    navigation.navigate('StatusViewer', {
      statuses:      group.statuses,
      initialIndex:  0,
      currentUserId: currentUser?.id,
      isOwn:         false,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* My status */}
      <MyStatusRow
        statuses={myStatuses}
        username={currentUser?.username ?? 'You'}
        avatar={currentUser?.profile_picture 
          ? (currentUser.profile_picture.includes('?') 
              ? currentUser.profile_picture 
              : `${currentUser.profile_picture}?t=${Date.now()}`)
          : null}
        avatarSticker={currentUser?.avatar_sticker ?? null}
        onView={viewMyStatuses}
        onAdd={openPicker}
        onViewViewers={() => {
           // Viewers are now handled inside StatusViewer via ViewerSheet
        }}
      />
      {/* Divider */}
      {friendGroups.length > 0 && (
        <Text style={styles.sectionHeader}>Recent updates</Text>
      )}

      {/* Friends */}
      <FlatList
        data={friendGroups}
        keyExtractor={item => String(item.user_id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadStatuses} />
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={styles.empty}>
              <Icon name="ellipse-outline" size={48} color="#ddd" />
              <Text style={styles.emptyText}>No recent updates</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <FriendStatusRow
            group={item}
            onPress={() => viewFriendStatuses(item)}
          />
        )}
      />
    </View>
  );
};

// ─── CallLogTabScreen ─────────────────────────────────────────────────────────

export const CallLogTabScreen = () => {
  const navigation  = useNavigation<any>();
  const [logs,       setLogs]       = useState<CallLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadLogs = useCallback(async () => {
    setRefreshing(true);
    try { setLogs(await CallService.getCallLogs()); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (iso: string): string => {
    const date = new Date(iso);
    const now  = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();
    if (isToday)     return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isYesterday) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getDirection = (item: CallLog): 'outgoing' | 'missed' | 'incoming' => {
    if (item.is_caller)          return 'outgoing';
    if (item.status === 'missed' || item.status === 'rejected') return 'missed';
    return 'incoming';
  };

  const directionConfig = (dir: 'outgoing' | 'missed' | 'incoming') => {
    if (dir === 'outgoing') return { icon: 'arrow-up-outline',   color: '#4CAF50', label: 'Outgoing' };
    if (dir === 'missed')   return { icon: 'arrow-down-outline', color: '#F44336', label: 'Missed'   };
    return                         { icon: 'arrow-down-outline', color: '#4CAF50', label: 'Incoming'  };
  };

  return (
    <FlatList
      data={logs}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={{ paddingBottom: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadLogs} />}
      ListEmptyComponent={
        !refreshing ? (
          <View style={styles.empty}>
            <Icon name="call-outline" size={48} color="#ddd" />
            <Text style={styles.emptyText}>No call history</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const dir      = getDirection(item);
        const dirConf  = directionConfig(dir);
        const duration = formatDuration(item.duration);
        const isMissed = dir === 'missed';
        const name     = item.other_party?.name ?? 'Unknown';
        const avatar   = item.other_party_avatar;
        const sticker  = item.other_party_avatar_sticker;
        const userId   = item.other_party?.id;

        return (
          <TouchableOpacity
            style={styles.logItem}
            activeOpacity={0.7}
            onPress={() =>
              Alert.alert(
                name,
                `${dirConf.label} ${item.call_type} call\n${formatTime(item.started_at)}${duration ? `\nDuration: ${duration}` : ''}`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: `Call back`,
                    onPress: () => navigation.navigate('Call', {
                      remoteUserId: userId,      // ← CallScreen expects remoteUserId
                      remoteUserName: name,      // ← may also need this
                      callType: item.call_type,
                      incomingCall: false,
                    })
                  }
                ]
              )
            }
          >
            {/* Avatar */}
            <View>
              {sticker ? (
                <View style={[styles.logAvatarImg, styles.logAvatarFallback]}>
                  <Text style={{ fontSize: 24 }}>{sticker}</Text>
                </View>
              ) : avatar ? (
                <Image source={{ uri: avatar }} style={styles.logAvatarImg} />
              ) : (
                <View style={[styles.logAvatarImg, styles.logAvatarFallback]}>
                  <Text style={styles.logAvatarInitial}>
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {/* Info */}
            <View style={{ flex: 1 }}>
              <Text style={[styles.logName, isMissed && { color: '#F44336' }]}>
                {name}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 4 }}>
                <Icon name={dirConf.icon} size={13} color={dirConf.color} />
                <Text style={[styles.logSub, { color: dirConf.color }]}>
                  {dirConf.label}
                </Text>
                <Icon
                  name={item.call_type === 'video' ? 'videocam-outline' : 'call-outline'}
                  size={12} color="#aaa"
                />
                <Text style={styles.logSub}>{item.call_type}</Text>
                {!!duration && <Text style={styles.logSub}>· {duration}</Text>}
              </View>
            </View>

            {/* Right: time + call button */}
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <Text style={styles.logTime}>{formatTime(item.started_at)}</Text>
              <TouchableOpacity
                onPress={() => {
                  navigation.navigate('Call', {
                    remoteUserId: userId,
                    remoteUserName: name,
                    callType: item.call_type,
                    incomingCall: false,
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon
                  name={item.call_type === 'video' ? 'videocam' : 'call'}
                  size={22} color="#8100D1"
                />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE  = 54;
const RING_WIDTH   = 3;
const RING_GAP     = 2;
const RING_SIZE    = AVATAR_SIZE + (RING_WIDTH + RING_GAP) * 2;

const styles = StyleSheet.create({
  // ── Status rows ────────────────────────────────────────────────────────────
  statusRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  avatarWrapper: {
    width:          RING_SIZE,
    height:         RING_SIZE,
    marginRight:    14,
    justifyContent: 'center',
    alignItems:     'center',
  },
  statusRing: {
    position:     'absolute',
    width:        RING_SIZE,
    height:       RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth:  RING_WIDTH,
  },
  ringUnseen: {
    borderColor:    '#8100D1',
    // Glow effect via shadow
    shadowColor:    '#8100D1',
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.8,
    shadowRadius:   6,
    elevation:      6,
  },
  ringViewed: {
    borderColor: '#C0C0C0',
  },
  avatar: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    backgroundColor: '#8100D1',
    justifyContent:  'center',
    alignItems:      'center',
  },
  avatarInitial: {
    color:      '#fff',
    fontSize:   20,
    fontWeight: '600',
  },
  stickerAvatar: {
    fontSize: 28,
  },
  addBadge: {
    position:        'absolute',
    bottom:          0,
    right:           0,
    width:           20,
    height:          20,
    borderRadius:    10,
    backgroundColor: '#8100D1',
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     2,
    borderColor:     '#fff',
  },
  rowName: {
    fontSize:   15,
    fontWeight: '600',
    color:      '#111',
    marginBottom: 2,
  },
  rowSub: {
    fontSize: 12,
    color:    '#888',
  },
  viewersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  viewCountText: {
    marginLeft: 4,
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  sectionHeader: {
    fontSize:         12,
    color:            '#999',
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:  '#f8f8f8',
    textTransform:    'uppercase',
    letterSpacing:    0.5,
  },
  empty: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     60,
  },
  emptyText: {
    marginTop: 12,
    color:     '#bbb',
    fontSize:  14,
  },

  // ── Call log ───────────────────────────────────────────────────────────────
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
    gap: 12,
  },
  logAvatarImg: {
    width: 48, height: 48, borderRadius: 24,
  },
  logAvatarFallback: {
    backgroundColor: '#8100D1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logAvatarInitial: {
    color: '#fff', fontSize: 18, fontWeight: '600',
  },
  logName: {
    fontSize: 15, fontWeight: '600', color: '#111',
  },
  logSub: {
    fontSize: 12, color: '#888',
  },
  logTime: {
    fontSize: 11, color: '#aaa',
  },
});