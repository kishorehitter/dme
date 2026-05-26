/**
 * Tabs.tsx
 * StatusTabScreen  — WhatsApp/Instagram-style status list
 * CallLogTabScreen — Call history list
 */

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  RefreshControl,
  Platform,
  PermissionsAndroid,
  DeviceEventEmitter,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useAuth } from '../context/AuthContext';
import { resolveImageUrl } from '../utils/image';
import { MediaPickerModal } from '../components/MediaPickerModal';
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
              source={{ uri: resolveImageUrl(avatar) }} 
              style={styles.avatar} 
              onError={() => setImgError(true)}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Icon name="person" size={24} color="#fff" />
            </View>
          )}

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
            source={{ uri: resolveImageUrl(group.user_avatar) }} 
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
  const [menuVisible,    setMenuVisible]    = useState(false);

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

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
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
      return true;
    }
  };

  const openGallery = async () => {
    await requestCameraPermission();
    const result = await launchImageLibrary({
      mediaType: 'mixed',
      quality: 0.8,
    });
    handlePickerResult(result);
  };

  const openCamera = async () => {
    await requestCameraPermission();
    const result = await launchCamera({
      mediaType: 'mixed',
      quality: 0.8,
    });
    handlePickerResult(result);
  };

  const handlePickerResult = (result: any) => {
    if (result.didCancel || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    navigation.navigate('StatusEditor', {
      mediaUri:  asset.uri,
      mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
      source: 'camera',
    });
  };

  const viewMyStatuses = () => {
    if (myStatuses.length === 0) { openGallery(); return; }
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



// ... inside Tabs component ...
  const [cameraMenuVisible, setCameraMenuVisible] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Status',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => { console.log('Camera button pressed'); setCameraMenuVisible(true); }} style={{ marginRight: 20 }}>
            <Icon name="camera-outline" size={24} color="#8100D1" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ marginRight: 16 }}>
            <Icon name="ellipsis-vertical" size={24} color="#8100D1" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <MediaPickerModal 
          visible={cameraMenuVisible} 
          onClose={() => setCameraMenuVisible(false)}
          top={50}
          right={16}
          onMediaSelected={(asset, type) => {
              navigation.navigate('StatusEditor', {
                mediaUri: asset.uri,
                mediaType: type === 'image' ? 'photo' : 'video',
                source: 'camera',
              });
          }}
        />
        {/* ... rest of existing code ... */}
      <StatusPopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
        onPrivacySettings={() => {
            navigation.navigate('StatusPrivacy', { 
                initialSelected: [],
                onSelect: (ids: number[]) => { console.log('Privacy selected:', ids); }
            });
        }}
      />
      <MyStatusRow
        statuses={myStatuses}
        username={currentUser?.username ?? 'You'}
        avatar={currentUser?.profile_picture}
        avatarSticker={currentUser?.avatar_sticker ?? null}
        onView={viewMyStatuses}
        onAdd={openGallery}
        onViewViewers={() => {}}
      />
      {friendGroups.length > 0 && (
        <Text style={styles.sectionHeader}>Recent updates</Text>
      )}
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

// ─── Call log ───────────────────────────────────────────────────────────────

const CallLogItemAvatar = ({ avatar, sticker, name }: { avatar: string | null, sticker: string | null, name: string }) => {
  const [error, setError] = useState(false);
  const resolvedUrl = resolveImageUrl(avatar);

  if (sticker) {
    return (
      <View style={[styles.logAvatarImg, styles.logAvatarFallback]}>
        <Text style={{ fontSize: 24 }}>{sticker}</Text>
      </View>
    );
  }

  if (resolvedUrl && !error) {
    return (
      <Image 
        source={{ uri: resolvedUrl }} 
        style={styles.logAvatarImg} 
        onError={() => setError(true)}
      />
    );
  }

  return (
    <View style={[styles.logAvatarImg, styles.logAvatarFallback]}>
      <Text style={styles.logAvatarInitial}>
        {(name || 'U').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
};

const StatusPopoverMenu = ({ 
  visible, 
  onClose, 
  onPrivacySettings 
}: { 
  visible: boolean, 
  onClose: () => void, 
  onPrivacySettings: () => void 
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}>
        <View style={styles.popover}>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onPrivacySettings(); }}>
            <Icon name="lock-closed-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Status Privacy</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const CallLogPopoverMenu = ({ 
  visible, 
  onClose, 
  onClearAll, 
  onSelect 
}: { 
  visible: boolean, 
  onClose: () => void, 
  onClearAll: () => void, 
  onSelect: () => void 
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1}>
        <View style={styles.popover}>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onClearAll(); }}>
            <Icon name="trash-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Clear all history</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onSelect(); }}>
            <Icon name="checkbox-outline" size={20} color="#333" />
            <Text style={styles.popoverText}>Select calls</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const CallLogMenuButton = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={{ marginRight: 16 }}>
    <Icon name="ellipsis-vertical" size={24} color="#8100D1" />
  </TouchableOpacity>
);

export const CallLogTabScreen = () => {
  const navigation  = useNavigation<any>();
  const [logs,       setLogs]       = useState<CallLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);

  const loadLogs = useCallback(async () => {
    setRefreshing(true);
    try { setLogs(await CallService.getCallLogs()); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.length === 0) return;
    Alert.alert(
      'Delete Selected',
      `Are you sure you want to delete ${selectedIds.length} call records?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await CallService.clearCallLogs(selectedIds);
              setSelectionMode(false);
              setSelectedIds([]);
              loadLogs();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete selected logs');
            }
          } 
        },
      ]
    );
  }, [selectedIds, loadLogs]);

  useEffect(() => {
    const sub1 = DeviceEventEmitter.addListener('call_logs_cleared', () => {
      loadLogs();
      setSelectionMode(false);
      setSelectedIds([]);
    });
    const sub2 = DeviceEventEmitter.addListener('toggle_call_log_selection_mode', () => {
      setSelectionMode(prev => !prev);
      setSelectedIds([]);
    });
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [loadLogs]);

  useLayoutEffect(() => {
    if (selectionMode) {
      navigation.setOptions({
        headerTitle: `${selectedIds.length} Selected`,
        headerLeft: () => (
          <TouchableOpacity 
            onPress={() => {
              setSelectionMode(false);
              setSelectedIds([]);
            }}
            style={{ marginLeft: 16 }}
          >
            <Text style={styles.selectionCancel}>Cancel</Text>
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity 
            onPress={handleBatchDelete} 
            disabled={selectedIds.length === 0}
            style={{ marginRight: 16 }}
          >
            <Text style={[styles.selectionDelete, selectedIds.length === 0 && { opacity: 0.5 }]}>Delete</Text>
          </TouchableOpacity>
        ),
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: '#F8F0FF', elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { color: '#8100D1', fontWeight: 'bold' }
      });
    } else {
      navigation.setOptions({
        headerTitle: 'Calls',
        headerLeft: undefined,
        headerRight: () => <CallLogMenuButton onPress={() => setMenuVisible(true)} />,
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: '#fff', elevation: 2, shadowOpacity: 0.1 },
        headerTitleStyle: { fontWeight: 'bold', fontSize: 20, color: '#8100D1' }
      });
    }
  }, [navigation, selectionMode, selectedIds, handleBatchDelete]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

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
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <CallLogPopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
        onClearAll={() => {
           Alert.alert(
            'Clear Call Log',
            'Are you sure you want to clear all call history?',
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Clear', 
                style: 'destructive', 
                onPress: async () => {
                  try {
                    await CallService.clearCallLogs();
                    DeviceEventEmitter.emit('call_logs_cleared');
                  } catch (error) {
                    Alert.alert('Error', 'Failed to clear call logs');
                  }
                } 
              },
            ]
          );
        }}
        onSelect={() => DeviceEventEmitter.emit('toggle_call_log_selection_mode')}
      />
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
          const isSelected = selectedIds.includes(item.id);

          return (
            <TouchableOpacity
              style={[styles.logItem, isSelected && styles.logItemSelected]}
              activeOpacity={0.7}
              onPress={() => {
                if (selectionMode) {
                  toggleSelection(item.id);
                } else {
                  const dateObj = new Date(item.started_at);
                  const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  
                  Alert.alert(
                    name,
                    `${dirConf.label} ${item.call_type} call\n${dateStr} at ${timeStr}${duration ? `\nDuration: ${duration}` : ''}`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: `Call back`,
                        onPress: () => navigation.navigate('Call', {
                          remoteUserId: userId,
                          remoteUserName: name,
                          callType: item.call_type,
                          incomingCall: false,
                        })
                      }
                    ]
                  );
                }
              }}
              onLongPress={() => {
                if (!selectionMode) {
                  setSelectionMode(true);
                  toggleSelection(item.id);
                }
              }}
            >
              {selectionMode && (
                <View style={styles.checkboxContainer}>
                  <Icon 
                    name={isSelected ? "checkbox" : "square-outline"} 
                    size={22} 
                    color="#8100D1" 
                  />
                </View>
              )}

              {/* Avatar */}
              <CallLogItemAvatar avatar={avatar} sticker={sticker} name={name} />

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
              {!selectionMode && (
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
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
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
    backgroundColor: '#E8DEF8',
    justifyContent:  'center',
    alignItems:      'center',
  },
  avatarInitial: {
    color:      '#8100D1',
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
    backgroundColor: '#E8DEF8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logAvatarInitial: {
    color: '#8100D1', fontSize: 18, fontWeight: '600',
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
  // Selection mode
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8F0FF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8DEF8',
  },
  selectionCancel: {
    color: '#666',
    fontSize: 16,
  },
  selectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8100D1',
  },
  selectionDelete: {
    color: '#F44336',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logItemSelected: {
    backgroundColor: '#F8F0FF',
  },
  checkboxContainer: {
    marginRight: -4,
  },
  // Popover menu
  popover: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 1000,
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  popoverText: {
    fontSize: 14,
    color: '#333',
  },
  });
