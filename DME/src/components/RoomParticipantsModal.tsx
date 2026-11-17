import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Dimensions
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvatarWithFallback from './AvatarWithFallback';
import { useTheme } from '../context/ThemeContext';
import { Participant } from './InviteModal';

interface RoomParticipantsModalProps {
  visible: boolean;
  onClose: () => void;
  participants: Participant[];
  isDJ?: boolean;
  currentUserId?: number;
  allowedSpeakers?: number[];
  voiceParticipants?: Set<number>;
  isMicOn?: boolean;
  onToggleMicPermission?: (targetUserId: number, allow: boolean) => void;
  onSwitchDJ?: (targetUserId: number, targetName: string) => void;
  onOpenInvite?: () => void;
  onAvatarPress?: (avatar?: string, sticker?: string, name?: string) => void;
}

const RoomParticipantsModal: React.FC<RoomParticipantsModalProps> = ({
  visible,
  onClose,
  participants = [],
  isDJ = false,
  currentUserId,
  allowedSpeakers = [],
  voiceParticipants = new Set(),
  isMicOn = false,
  onToggleMicPermission,
  onSwitchDJ,
  onOpenInvite,
  onAvatarPress,
}) => {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const styles = dynamicStyles(theme, insets, isDark);
  const [transferTarget, setTransferTarget] = useState<Participant | null>(null);

  if (!visible) return null;

  const handleSwitchDJ = (p: Participant) => {
    setTransferTarget(p);
  };

  const handleToggleSpeaker = (p: Participant) => {
    if (p.is_dj) {
      Toast.show({
        type: 'info',
        text1: 'Room Leader',
        text2: 'The Room Leader has permanent microphone access.',
      });
      return;
    }

    if (!isDJ) {
      Toast.show({
        type: 'info',
        text1: 'Leader Only',
        text2: 'Only the Room Leader can grant or revoke microphone access.',
      });
      return;
    }

    const isCurrentlyAllowed = allowedSpeakers.includes(p.user_id);
    if (isCurrentlyAllowed) {
      onToggleMicPermission?.(p.user_id, false);
      Toast.show({
        type: 'info',
        text1: 'Mic Revoked',
        text2: `Muted ${p.name}'s microphone access.`,
      });
    } else {
      if (allowedSpeakers.length >= 4) {
        Toast.show({
          type: 'error',
          text1: 'Speaker Limit Reached',
          text2: 'Maximum 4 speakers allowed at a time.',
        });
        return;
      }
      onToggleMicPermission?.(p.user_id, true);
      Toast.show({
        type: 'success',
        text1: 'Mic Granted',
        text2: `${p.name} can now use the microphone! 🎙️`,
      });
    }
  };

  // Sort participants: DJ first, then speakers, then listeners
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.is_dj) return -1;
    if (b.is_dj) return 1;
    const aAllowed = allowedSpeakers.includes(a.user_id);
    const bAllowed = allowedSpeakers.includes(b.user_id);
    if (aAllowed && !bAllowed) return -1;
    if (!aAllowed && bAllowed) return 1;
    return a.name.localeCompare(b.name);
  });

  const allowedCount = Math.min(4, Math.max(1, allowedSpeakers.length));

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title}>In Room ({participants.length})</Text>
            <View style={styles.speakerCountPill}>
              <Icon name="mic" size={11} color="#10B981" />
              <Text style={styles.speakerCountText}>{allowedCount}/4 Speakers</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={24} color={theme.icon} />
          </TouchableOpacity>
        </View>

        {/* Participants List */}
        <FlatList
          data={sortedParticipants}
          keyExtractor={(item) => `room-participant-${item.user_id}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 4 }}
          renderItem={({ item }) => {
            const isSpeaker = item.is_dj || allowedSpeakers.includes(item.user_id);
            const isSpeakingNow = item.user_id === currentUserId ? isMicOn : voiceParticipants.has(item.user_id);

            return (
              <View style={styles.participantRow}>
                <TouchableOpacity
                  style={styles.avatarContainer}
                  onPress={() => onAvatarPress?.(item.avatar, item.avatar_sticker, item.name)}
                  activeOpacity={0.8}
                >
                  <AvatarWithFallback
                    uri={item.avatar}
                    displayName={item.name}
                    sticker={item.avatar_sticker}
                    style={[
                      styles.avatar,
                      isSpeakingNow && styles.avatarSpeaking,
                    ]}
                  />
                  {item.is_dj && (
                    <View style={styles.crownEmojiContainer}>
                      <Text style={styles.crownEmojiText}>👑</Text>
                    </View>
                  )}
                  {isSpeakingNow && (
                    <View style={styles.speakingIndicatorDot} />
                  )}
                </TouchableOpacity>

                <View style={styles.infoCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name} {item.user_id === currentUserId ? '(You)' : ''}
                    </Text>
                  </View>
                  <Text style={styles.roleText}>
                    {item.is_dj
                      ? 'Room Leader'
                      : isSpeakingNow
                      ? '🎙️ Speaking now'
                      : isSpeaker
                      ? '🎙️ Speaker'
                      : '🎧 Listener'}
                  </Text>
                </View>

                {/* DJ Controls / Mic Status */}
                {isDJ && !item.is_dj ? (
                  <View style={styles.actionBtnGroup}>
                    <TouchableOpacity
                      style={styles.makeDjBtn}
                      onPress={() => handleSwitchDJ(item)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcon name="crown" size={13} color="#FACC15" />
                      <Text style={styles.makeDjText}>Make Leader</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.micActionBtn,
                        isSpeaker ? styles.micActionBtnActive : styles.micActionBtnMuted,
                      ]}
                      onPress={() => handleToggleSpeaker(item)}
                      activeOpacity={0.7}
                    >
                      <Icon
                        name={isSpeaker ? 'mic' : 'mic-off'}
                        size={14}
                        color={isSpeaker ? (isDark ? '#10B981' : '#047857') : (isDark ? 'rgba(255,255,255,0.45)' : '#475569')}
                      />
                      <Text
                        style={[
                          styles.micActionText,
                          { color: isSpeaker ? (isDark ? '#10B981' : '#047857') : (isDark ? 'rgba(255,255,255,0.45)' : '#475569') },
                        ]}
                      >
                        {isSpeaker ? 'Allowed' : 'Muted'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : item.is_dj ? (
                  <View style={styles.djBadgePill}>
                    <Text style={styles.djBadgePillText}>Leader</Text>
                  </View>
                ) : (
                  <View style={styles.statusPill}>
                    <Icon
                      name={isSpeaker ? (isSpeakingNow ? 'volume-high' : 'mic') : 'headset-outline'}
                      size={14}
                      color={isSpeakingNow ? '#10B981' : isSpeaker ? (isDark ? '#4597f5' : '#2563EB') : (isDark ? 'rgba(255,255,255,0.35)' : '#64748B')}
                    />
                  </View>
                )}
              </View>
            );
          }}
        />

        {/* Invite Friends Button at bottom */}
        {onOpenInvite && (
          <TouchableOpacity
            style={styles.inviteFriendsBtn}
            onPress={() => {
              onClose();
              onOpenInvite();
            }}
            activeOpacity={0.8}
          >
            <Icon name="person-add" size={17} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.inviteFriendsText}>Invite Friends to Room</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Leader Transfer Custom Modal */}
      {transferTarget && (
        <View style={styles.confirmModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setTransferTarget(null)}
          />
          <View style={styles.confirmCard}>
            {/* Top Close "X" Button */}
            <TouchableOpacity
              onPress={() => setTransferTarget(null)}
              style={styles.confirmCloseBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close" size={16} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'} />
            </TouchableOpacity>

            {/* Glowing Golden Emblem */}
            <View style={styles.crownEmblemWrap}>
              <MaterialCommunityIcon name="crown" size={28} color="#FACC15" />
            </View>

            <Text style={styles.confirmTitle}>
              Transfer Leader Role
            </Text>

            {/* Target User Info Capsule */}
            <View style={styles.targetUserRow}>
              <AvatarWithFallback
                uri={transferTarget.avatar}
                displayName={transferTarget.name}
                sticker={transferTarget.avatar_sticker}
                style={styles.targetUserAvatar}
              />
              <Text style={styles.targetUserName} numberOfLines={1}>
                {transferTarget.name}
              </Text>
            </View>

            <Text style={styles.confirmMessage}>
              Make {transferTarget.name} the Leader? They will take over full playback and queue controls for the room.
            </Text>

            {/* Action Buttons */}
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setTransferTarget(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelBtnText}>No</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.transferBtn}
                onPress={() => {
                  const target = transferTarget;
                  setTransferTarget(null);
                  onSwitchDJ?.(target.user_id, target.name);
                }}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcon name="crown" size={15} color="#000" style={{ marginRight: 5 }} />
                <Text style={styles.transferBtnText}>Make Leader</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const dynamicStyles = (
  theme: import('../utils/theme').ThemeColors,
  insets: import('react-native-safe-area-context').EdgeInsets,
  isDark: boolean = true
) => StyleSheet.create({
  confirmModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  confirmCard: {
    width: '85%',
    maxWidth: 310,
    borderRadius: 22,
    backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(234, 179, 8, 0.45)',
    padding: 22,
    alignItems: 'center',
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 20,
  },
  confirmCloseBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  crownEmblemWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(234, 179, 8, 0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(234, 179, 8, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmTitle: {
    color: isDark ? '#FFFFFF' : '#0F172A',
    fontSize: 17.5,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  targetUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.35)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 10,
    gap: 8,
  },
  targetUserAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  targetUserName: {
    color: '#FACC15',
    fontSize: 13,
    fontWeight: '700',
    maxWidth: 160,
  },
  confirmMessage: {
    color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(15, 23, 42, 0.7)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
    borderRadius: 14,
    paddingVertical: 12,
  },
  cancelBtnText: {
    color: isDark ? '#E2E8F0' : '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  transferBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAB308',
    borderRadius: 14,
    paddingVertical: 12,
    shadowColor: '#EAB308',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  transferBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 1000 },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.round(Dimensions.get('window').height * 0.55),
    backgroundColor: isDark ? (theme.surface || '#1C1C1E') : '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Math.max(16, insets.bottom + 8),
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: isDark ? 0.35 : 0.12,
    shadowRadius: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: isDark ? '#FFFFFF' : '#0F172A',
    fontSize: 16.5,
    fontWeight: 'bold',
  },
  speakerCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  speakerCountText: {
    color: isDark ? '#10B981' : '#059669',
    fontSize: 10,
    fontWeight: '600',
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  avatarSpeaking: {
    borderColor: '#10B981',
    borderWidth: 2,
  },
  crownEmojiContainer: {
    position: 'absolute',
    top: -15,
    right: -2,
    zIndex: 10,
    transform: [{ rotate: '15deg' }],
  },
  crownEmojiText: {
    fontSize: 18,
    includeFontPadding: false,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  speakingIndicatorDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#10B981',
    borderWidth: 1.5,
    borderColor: isDark ? '#1C1C1E' : '#FFFFFF',
    zIndex: 2,
  },
  infoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    color: isDark ? '#FFFFFF' : '#0F172A',
    fontSize: 13.5,
    fontWeight: '600',
  },
  roleText: {
    color: isDark ? 'rgba(255,255,255,0.45)' : '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  actionBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  makeDjBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(234, 179, 8, 0.12)' : 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(234, 179, 8, 0.35)' : 'rgba(202, 138, 4, 0.40)',
  },
  makeDjText: {
    color: isDark ? '#FACC15' : '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  djBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
    backgroundColor: isDark ? '#FFFFFF' : '#0F172A',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2.5,
    elevation: 2,
  },
  djBadgePillText: {
    color: isDark ? '#0F172A' : '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  micActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 14,
    borderWidth: 1,
  },
  micActionBtnActive: {
    backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.14)',
    borderColor: isDark ? 'rgba(16,185,129,0.35)' : 'rgba(16,185,129,0.45)',
  },
  micActionBtnMuted: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(100, 116, 139, 0.10)',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(100, 116, 139, 0.28)',
  },
  micActionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: isDark ? 0 : 0.5,
    borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.08)',
  },
  inviteFriendsBtn: {
    backgroundColor: '#4597f5f6',
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  inviteFriendsText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: 'bold',
  },
});

export default RoomParticipantsModal;
