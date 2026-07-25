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
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  DeviceEventEmitter,
  TouchableWithoutFeedback,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { launchCamera } from 'react-native-image-picker';
import { CustomGalleryPicker, GalleryAsset } from '../components/CustomGalleryPicker';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { resolveImageUrl } from '../utils/image';
import AvatarWithFallback from '../components/AvatarWithFallback';
import { MediaPickerModal } from '../components/MediaPickerModal';
import { chatAPI } from '../services/api';
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  const hasStatus = statuses.length > 0;
  const allSeen   = hasStatus && statuses.every(s => s.is_viewed);

  return (
    <View style={styles.statusRow}>
      <TouchableOpacity
        style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}
        onPress={hasStatus ? onView : onAdd}
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrapperMy}>
          {hasStatus && (
            allSeen ? (
              <View style={[styles.statusRingMy, styles.ringViewed]} />
            ) : (
              <LinearGradient
                colors={['#ff4d6d', '#4597f5f6']}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientRingMy}
              >
                <View style={styles.gradientRingInnerMy} />
              </LinearGradient>
            )
          )}
          
          <AvatarWithFallback
            uri={avatar}
            sticker={avatarSticker}
            displayName={username}
            style={styles.avatarMy}
          />

          <TouchableOpacity style={styles.addBadgeMy} onPress={onAdd}>
            <Icon name="add" size={16} color="#fff" />
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  return (
    <TouchableOpacity style={styles.statusRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrapper}>
        {group.has_unseen ? (
          <LinearGradient
            colors={['#ff4d6d', '#4597f5f6']}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientRing54}
          >
            <View style={styles.gradientRingInner54} />
          </LinearGradient>
        ) : (
          <View style={[styles.statusRing, styles.ringViewed]} />
        )}
        <AvatarWithFallback
          uri={group.user_avatar}
          sticker={group.user_avatar_sticker}
          displayName={group.username || 'Unknown User'}
          style={styles.avatar}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{group.username || 'Unknown User'}</Text>
        <Text style={styles.rowSub}>{timeAgo(group.latest_at)}</Text>
      </View>

      <Icon name="chevron-forward" size={18} color={theme.border} />
    </TouchableOpacity>
  );
};

// ─── StatusTabScreen ──────────────────────────────────────────────────────────

export const StatusTabScreen = () => {
  const { theme, isDark } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  const { user: currentUser } = useAuth();
  const navigation = useNavigation<any>();

  const [myStatuses,     setMyStatuses]     = useState<Status[]>([]);
  const [friendGroups,   setFriendGroups]   = useState<UserStatusGroup[]>([]);
  const [refreshing,     setRefreshing]     = useState(false);
  const [menuVisible,    setMenuVisible]    = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);

  const loadStatuses = useCallback(async () => {
    setRefreshing(true);
    try {
      const [all, friends] = await Promise.all([
        StatusService.getStatuses(),
        chatAPI.getFriends().catch(() => []),
      ]);

      const friendsArray = Array.isArray(friends) ? friends : (friends?.results || []);
      const friendIds = new Set<number>(friendsArray.map((f: any) => f.id));

      const mine   = all.filter(s => s.user_id === currentUser?.id);
      const others = all.filter(s => s.user_id !== currentUser?.id && friendIds.has(s.user_id));
      setMyStatuses(mine);
      setFriendGroups(StatusService.groupByUser(others));
    } catch (err) {
      console.error('[Tabs] Error loading statuses:', err);
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

  const openGallery = () => {
    setGalleryVisible(true);
  };

  const handleGallerySelect = (assets: GalleryAsset[]) => {
    setGalleryVisible(false);
    if (!assets || assets.length === 0) return;
    const first = assets[0];
    const pending = assets.slice(1).map(a => ({
      mediaUri:  a.uri,
      mediaType: a.type?.startsWith('video') ? 'video' : 'photo',
    }));
    navigation.navigate('StatusEditor', {
      mediaUri:     first.uri,
      mediaType:    first.type?.startsWith('video') ? 'video' : 'photo',
      source:       'gallery',
      pendingMedia: pending,
    });
  };

  const openCamera = async () => {
    await requestCameraPermission();
    const result = await launchCamera({
      mediaType: 'mixed',
      quality: 0.8,
      saveToPhotos: false,
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
      headerTitleStyle: { color: theme.textPrimary, fontWeight: 'bold', fontSize: 20 },
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => { console.log('Camera button pressed'); setCameraMenuVisible(true); }} style={{ marginRight: 20 }}>
            <Icon name="camera-outline" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ marginRight: 16 }}>
            <Icon name="ellipsis-vertical" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
      ),
      headerStyle: { backgroundColor: theme.surface },
    });
  }, [navigation, theme]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
        <MediaPickerModal
          visible={cameraMenuVisible}
          onClose={() => setCameraMenuVisible(false)}
          top={50}
          right={16}
          onOpenGallery={() => {
            setCameraMenuVisible(false);
            setGalleryVisible(true);
          }}
          onMediaSelected={(assets: any) => {
            const asset = Array.isArray(assets) ? assets[0] : assets;
            if (!asset?.uri) return;
            navigation.navigate('StatusEditor', {
              mediaUri:  asset.uri,
              mediaType: asset.type?.startsWith('video') ? 'video' : 'photo',
              source:    'camera',
            });
          }}
        />
        <CustomGalleryPicker
          visible={galleryVisible}
          onClose={() => setGalleryVisible(false)}
          onSelect={handleGallerySelect}
          maxSelect={10}
          assetType="All"
          maxDuration={61}
          theme="light"
        />
        {/* ... rest of existing code ... */}
      <StatusPopoverMenu 
        visible={menuVisible} 
        onClose={() => setMenuVisible(false)}
        onPrivacySettings={() => {
            navigation.navigate('StatusPrivacy');
        }}      />
      <MyStatusRow
        statuses={myStatuses}
        username={currentUser?.username ?? 'You'}
        avatar={currentUser?.profile_picture ?? null}
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 80 }}
        ListEmptyComponent={
          refreshing ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="person-outline" size={38} color={theme.border} />
              <Text style={styles.emptyText}>No recent updates</Text>
            </View>
          )
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  return (
    <AvatarWithFallback
      uri={avatar}
      sticker={sticker}
      displayName={name}
      style={styles.logAvatarImg}
    />
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={StyleSheet.absoluteFillObject} />
      </TouchableWithoutFeedback>
      <View style={styles.popover}>
        <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onPrivacySettings(); }}>
          <Icon name="lock-closed-outline" size={20} color={theme.textPrimary} />
          <Text style={styles.popoverText}>Status Privacy</Text>
        </TouchableOpacity>
      </View>
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={StyleSheet.absoluteFillObject} />
      </TouchableWithoutFeedback>
      <View style={styles.popover}>
        <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onClearAll(); }}>
          <Icon name="trash-outline" size={20} color={theme.textPrimary} />
          <Text style={styles.popoverText}>Clear all history</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.popoverItem} onPress={() => { onClose(); onSelect(); }}>
          <Icon name="checkbox-outline" size={20} color={theme.textPrimary} />
          <Text style={styles.popoverText}>Select calls</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const CallLogMenuButton = ({ onPress }: { onPress: () => void }) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ marginRight: 16 }}>
      <Icon name="ellipsis-vertical" size={24} color={theme.textPrimary} />
    </TouchableOpacity>
  );
};

export const CallLogTabScreen = () => {
  const { theme, isDark } = useTheme();
  const styles = React.useMemo(() => dynamicStyles(theme), [theme]);
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
        headerStyle: { backgroundColor: theme.surface, elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { color: theme.primary, fontWeight: 'bold' }
      });
    } else {
      navigation.setOptions({
        headerTitle: 'Calls',
        headerLeft: undefined,
        headerRight: () => <CallLogMenuButton onPress={() => setMenuVisible(true)} />,
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: theme.surface, elevation: 2, shadowOpacity: 0.1 },
        headerTitleStyle: { fontWeight: 'bold', fontSize: 20, color: theme.textPrimary }
      });
    }
  }, [navigation, selectionMode, selectedIds, handleBatchDelete, theme, styles]);

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
    if (dir === 'outgoing') return { icon: 'arrow-up-outline',   color: '#25D366', label: 'Outgoing' };
    if (dir === 'missed')   return { icon: 'arrow-down-outline', color: '#FF3B30', label: 'Missed'   };
    return                         { icon: 'arrow-down-outline', color: '#25D366', label: 'Incoming'  };
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 80 }}
        ListEmptyComponent={
          refreshing ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="call-outline" size={38} color={theme.border} />
              <Text style={styles.emptyText}>No call history</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const dir      = getDirection(item);
          const dirConf  = directionConfig(dir);
          const duration = formatDuration(item.duration);
          const isMissed = dir === 'missed';
          const name     = item.other_party?.name ?? 'Unknown';
          const avatar   = item.other_party_avatar ?? null;
          const sticker  = item.other_party_avatar_sticker ?? null;
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
                    color={theme.primary} 
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
                      size={22} color={theme.primary}
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

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  // ── Status rows ────────────────────────────────────────────────────────────
  statusRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.separator,
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
  gradientRing54: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientRingInner54: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.background,
  },
  ringViewed: {
    borderColor: theme.border,
  },
  avatar: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarWrapperMy: {
    width:          74,
    height:         74,
    marginRight:    14,
    justifyContent: 'center',
    alignItems:     'center',
    position:       'relative',
  },
  statusRingMy: {
    position:     'absolute',
    width:        74,
    height:       74,
    borderRadius: 37,
    borderWidth:  RING_WIDTH,
  },
  gradientRingMy: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientRingInnerMy: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.background,
  },
  avatarMy: {
    width:        64,
    height:       64,
    borderRadius: 32,
  },
  avatarFallback: {
    backgroundColor: theme.surface,
    justifyContent:  'center',
    alignItems:      'center',
  },
  avatarInitial: {
    color:      theme.primary,
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
    backgroundColor: theme.primary,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     2,
    borderColor:     theme.background,
  },
  addBadgeMy: {
    position:        'absolute',
    bottom:          1,
    right:           1,
    width:           22,
    height:          22,
    borderRadius:    11,
    backgroundColor: theme.primary,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     2,
    borderColor:     theme.background,
  },
  rowName: {
    fontSize:   15,
    fontWeight: '600',
    color:      theme.textPrimary,
    marginBottom: 2,
  },
  rowSub: {
    fontSize: 12,
    color:    theme.textSecondary,
  },
  viewersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  viewCountText: {
    marginLeft: 4,
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  sectionHeader: {
    fontSize:         12,
    color:            theme.textMuted,
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:  theme.chatBackground,
    textTransform:    'uppercase',
    letterSpacing:    0.5,
  },
  empty: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     0,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 12,
    color:     theme.textSecondary,
    fontSize:  14,
  },

  // ── Call log ───────────────────────────────────────────────────────────────
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.separator,
    backgroundColor: theme.surface,
    gap: 12,
  },
  logAvatarImg: {
    width: 48, height: 48, borderRadius: 24,
  },
  logAvatarFallback: {
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logAvatarInitial: {
    color: theme.primary, fontSize: 18, fontWeight: '600',
  },
  logName: {
    fontSize: 15, fontWeight: '600', color: theme.textPrimary,
  },
  logSub: {
    fontSize: 12, color: theme.textSecondary,
  },
  logTime: {
    fontSize: 11, color: theme.textMuted,
  },
  // Selection mode
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.chatBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  selectionCancel: {
    color: theme.textSecondary,
    fontSize: 16,
  },
  selectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
  },
  selectionDelete: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logItemSelected: {
    backgroundColor: theme.chatBackground,
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
    backgroundColor: theme.surface,
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
    color: theme.textPrimary,
  },
  });
