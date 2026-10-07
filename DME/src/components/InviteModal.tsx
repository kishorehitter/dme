import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator, ScrollView, Dimensions
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../services/api';
import AvatarWithFallback from './AvatarWithFallback';
import { useTheme } from '../context/ThemeContext';

export interface Participant {
  user_id: number;
  name: string;
  is_dj: boolean;
  avatar?: string;
  avatar_sticker?: string;
}

interface User {
  id: number;
  display_name: string;
  avatar_sticker: string | null;
  profile_picture: string | null;
  username?: string;
}

interface InviteModalProps {
  visible: boolean;
  onClose: () => void;
  roomCode: string;
  videoId?: string;
  participants?: Participant[];
  isDJ?: boolean;
  allowedSpeakers?: number[];
  onToggleMicPermission?: (targetUserId: number, allow: boolean) => void;
}

const InviteModal: React.FC<InviteModalProps> = ({
  visible,
  onClose,
  roomCode,
  videoId,
  participants = [],
  isDJ = false,
  allowedSpeakers = [],
  onToggleMicPermission,
}) => {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = dynamicStyles(theme, insets);
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const pendingRequest = useRef(false);
  const idempotencyKey = useRef<string>('');

  const [allFriends, setAllFriends] = useState<User[]>([]);

  // When visibility changes to true, fetch data
  React.useEffect(() => {
    if (visible) {
      fetchFriends();
      setQuery('');
      pendingRequest.current = false;
      idempotencyKey.current = Math.random().toString(36).substring(2, 15) + Date.now().toString();
    }
  }, [visible]);

  if (!visible) return null;

  const fetchFriends = async () => {
    setLoading(true);
    try {
      const response = await api.get('/chat/friends/');
      setAllFriends(response.data);
      setFriends(response.data);
    } catch (e) {
      console.error('Failed to fetch friends', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setFriends(allFriends);
    } else {
      const lowerQ = q.toLowerCase();
      setFriends(allFriends.filter(f => 
        (f.display_name && f.display_name.toLowerCase().includes(lowerQ)) ||
        (f.username && f.username.toLowerCase().includes(lowerQ))
      ));
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSendInvites = async () => {
    if (selectedIds.length === 0 || pendingRequest.current) return;
    
    pendingRequest.current = true;
    setSending(true);
    try {
      await api.post('/music/invite/', {
        user_ids: selectedIds,
        room_code: roomCode,
        video_id: videoId,
        idempotency_key: idempotencyKey.current
      });
      onClose();
      setSelectedIds([]);
    } catch (e) {
      console.error('❌ [INVITE] Failed:', e);
    } finally {
      setSending(false);
      pendingRequest.current = false;
    }
  };

  const handleToggleSpeaker = (p: Participant) => {
    if (p.is_dj) {
      Toast.show({
        type: 'info',
        text1: 'Leader Access',
        text2: 'The Room Leader has mic access by default.',
      });
      return;
    }

    if (!isDJ) {
      Toast.show({
        type: 'info',
        text1: 'Leader Only',
        text2: 'Only the Room Leader can allow mic access.',
      });
      return;
    }

    const isCurrentlyAllowed = allowedSpeakers.includes(p.user_id);
    if (isCurrentlyAllowed) {
      onToggleMicPermission?.(p.user_id, false);
      Toast.show({
        type: 'info',
        text1: 'Mic Locked',
        text2: `Muted ${p.name}'s mic access.`,
      });
    } else {
      // Leader + others max 4
      if (allowedSpeakers.length >= 4) {
        Toast.show({
          type: 'error',
          text1: 'Speaker Limit Reached',
          text2: 'Maximum 4 speakers allowed at a time (including Leader).',
        });
        return;
      }
      onToggleMicPermission?.(p.user_id, true);
      Toast.show({
        type: 'success',
        text1: 'Mic Unlocked',
        text2: `${p.name} can now use the microphone! 🎙️`,
      });
    }
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Room & Invites</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={24} color={theme.icon} />
          </TouchableOpacity>
        </View>

        {/* ── TOP: Room Participants Horizontal Scroll with Integrated Mic Badges ── */}
        {participants.length > 0 && (
          <View style={styles.participantsSection}>
            <View style={styles.participantsHeaderRow}>
              <Text style={styles.sectionSubtitle}>
                In Room ({participants.length})
              </Text>
              <View style={styles.speakerCountPill}>
                <Icon name="mic" size={11} color="#10B981" />
                <Text style={styles.speakerCountText}>
                  {Math.min(4, Math.max(1, allowedSpeakers.length))}/4 Speakers
                </Text>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.participantsScroll}
            >
              {participants.map((p) => {
                const isAllowed = p.is_dj || allowedSpeakers.includes(p.user_id);
                return (
                  <TouchableOpacity
                    key={p.user_id}
                    style={styles.participantItem}
                    onPress={() => handleToggleSpeaker(p)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.avatarWrapper}>
                      <AvatarWithFallback
                        uri={p.avatar}
                        displayName={p.name}
                        sticker={p.avatar_sticker}
                        style={[
                          styles.participantAvatar,
                          isAllowed && styles.participantAvatarAllowed
                        ]}
                      />
                      {p.is_dj && (
                        <View style={styles.djBadge}>
                          <Icon name="star" size={8} color="#FFD700" />
                        </View>
                      )}
                      {/* Integrated Mic Toggle Badge on Avatar */}
                      <View style={[
                        styles.micBadgeOverlay,
                        isAllowed ? styles.micBadgeOverlayActive : styles.micBadgeOverlayMuted
                      ]}>
                        <Icon
                          name={isAllowed ? 'mic' : 'mic-off'}
                          size={9}
                          color={isAllowed ? '#fff' : 'rgba(255,255,255,0.45)'}
                        />
                      </View>
                    </View>
                    <Text style={styles.participantName} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── BOTTOM: Invite Friends Section ── */}
        <View style={styles.searchBar}>
          <Icon name="search" size={18} color={theme.icon} />
          <TextInput
            style={styles.input}
            placeholder="Search friends to invite..."
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={handleSearch}
          />
        </View>

        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} color="#4597f5f6" />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id.toString()}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.friendItem} 
                onPress={() => toggleSelection(item.id)}
              >
                <AvatarWithFallback 
                  uri={item.profile_picture} 
                  displayName={item.display_name} 
                  sticker={item.avatar_sticker}
                  style={styles.avatar}
                />
                <Text style={styles.name}>{item.display_name}</Text>
                <Icon 
                  name={selectedIds.includes(item.id) ? "checkbox" : "square-outline"} 
                  size={22} 
                  color="#4597f5f6" 
                />
              </TouchableOpacity>
            )}
          />
        )}

        <TouchableOpacity 
          style={[styles.sendBtn, selectedIds.length === 0 && { opacity: 0.5 }]} 
          onPress={handleSendInvites}
          disabled={selectedIds.length === 0 || sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendText}>Send Invitations ({selectedIds.length})</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const dynamicStyles = (theme: import('../utils/theme').ThemeColors, insets: import('react-native-safe-area-context').EdgeInsets) => StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 1000 },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.round(Dimensions.get('window').height * 0.6),
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Math.max(16, insets.bottom + 8),
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: theme.textPrimary, fontSize: 17, fontWeight: 'bold' },
  
  // Compact Participants Section with Zero Unwanted Gaps
  participantsSection: { marginBottom: 8 },
  participantsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sectionSubtitle: { color: theme.textPrimary, fontSize: 12, fontWeight: '600', opacity: 0.85 },
  speakerCountPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  speakerCountText: { color: '#10B981', fontSize: 10, fontWeight: '600' },
  participantsScroll: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  participantItem: { alignItems: 'center', width: 48 },
  avatarWrapper: { position: 'relative', marginBottom: 2 },
  participantAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)' },
  participantAvatarAllowed: { borderColor: '#10B981', borderWidth: 2 },
  djBadge: { position: 'absolute', top: -3, right: -3, backgroundColor: '#1A1A1A', borderRadius: 7, padding: 1.5, borderWidth: 1, borderColor: '#FFD700', zIndex: 2 },
  micBadgeOverlay: { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#1C1C1E', zIndex: 2 },
  micBadgeOverlayActive: { backgroundColor: '#10B981' },
  micBadgeOverlayMuted: { backgroundColor: 'rgba(255,255,255,0.15)' },
  participantName: { color: theme.textPrimary, fontSize: 10, textAlign: 'center', width: 48 },

  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.inputBackground, borderRadius: 10, paddingHorizontal: 10, height: 38, marginBottom: 8 },
  input: { flex: 1, color: theme.textPrimary, marginLeft: 8, fontSize: 13, paddingVertical: 0 },
  friendItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: theme.border },
  avatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10 },
  name: { flex: 1, color: theme.textPrimary, fontSize: 14 },
  sendBtn: { backgroundColor: '#4597f5f6', height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  sendText: { color: '#fff', fontSize: 14, fontWeight: 'bold' }
});

export default InviteModal;


