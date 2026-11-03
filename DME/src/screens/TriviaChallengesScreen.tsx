import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
  RefreshControl,
  Dimensions,
  Animated,
  Alert,
  TextInput,
  BackHandler,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { pinNavBarColor } from '../utils/navBarPin';
import {
  TriviaChallengePayload,
  ChallengeLeaderboardEntry,
  getChallengeExpiryStatus,
  getAllLocalChallenges,
  syncChallengesFromAllConversations,
  deleteLocalChallenge,
  createChallengePayload,
  sendChallengeToConversation,
  shareChallengeResultsToGroup,
} from '../services/TriviaChallengeService';
import { getCustomSets, CustomTriviaSet } from '../services/CustomTriviaStorage';
import { chatAPI } from '../services/api';
import localDatabase from '../services/LocalDatabase';

const { width } = Dimensions.get('window');

interface TriviaChallengesScreenProps {
  navigation: any;
  route?: any;
}

type MainTab = 'invited' | 'hosted';
type InvitedSubTab = 'pending' | 'completed' | 'missed';
type HostedSubTab = 'active' | 'expired';

export const TriviaChallengesScreen: React.FC<TriviaChallengesScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const safeTopPadding = (insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44)) + 8;
  const safeBottomPadding = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 24 : 16);
  const { theme, isDark } = useTheme();
  const { user } = useAuth();

  // Dedicated screen mode: 'hosted' vs 'invited' (no tab switching between them)
  const screenMode: 'hosted' | 'invited' =
    route?.params?.initialTab === 'hosted' || route?.params?.mode === 'hosted' ? 'hosted' : 'invited';

  // Sub Tabs for Invited: 'pending' | 'completed' | 'missed'
  const [invitedSubTab, setInvitedSubTab] = useState<InvitedSubTab>('pending');

  // Sub Tabs for Hosted: 'active' | 'expired'
  const [hostedSubTab, setHostedSubTab] = useState<HostedSubTab>('active');

  const [challenges, setChallenges] = useState<TriviaChallengePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharingResultsId, setSharingResultsId] = useState<string | null>(null);

  // Leaderboard / Standings Modal State
  const [selectedLeaderboardChallenge, setSelectedLeaderboardChallenge] = useState<TriviaChallengePayload | null>(null);
  const [leaderboardModalVisible, setLeaderboardModalVisible] = useState(false);

  // Create Challenge Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [customSets, setCustomSets] = useState<CustomTriviaSet[]>([]);
  const [selectedSetForChallenge, setSelectedSetForChallenge] = useState<CustomTriviaSet | null>(null);
  const [selectedDurationHours, setSelectedDurationHours] = useState<number>(4);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [searchChatQuery, setSearchChatQuery] = useState('');
  const [sendingChallengeId, setSendingChallengeId] = useState<number | null>(null);

  // Delete Confirmation Modal State (Buttery Smooth)
  const [challengeToDelete, setChallengeToDelete] = useState<TriviaChallengePayload | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const deleteModalScale = useRef(new Animated.Value(0.88)).current;
  const deleteModalOpacity = useRef(new Animated.Value(0)).current;

  const openDeleteModal = (challenge: TriviaChallengePayload) => {
    setChallengeToDelete(challenge);
    setDeleteModalVisible(true);
    deleteModalScale.setValue(0.88);
    deleteModalOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(deleteModalScale, {
        toValue: 1,
        tension: 65,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(deleteModalOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeDeleteModal = () => {
    Animated.parallel([
      Animated.timing(deleteModalScale, {
        toValue: 0.92,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(deleteModalOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDeleteModalVisible(false);
      setChallengeToDelete(null);
    });
  };

  const confirmDeleteChallenge = async () => {
    if (!challengeToDelete) return;
    const challengeId = challengeToDelete.challengeId;
    closeDeleteModal();
    try {
      await deleteLocalChallenge(challengeId);
      setChallenges(prev => prev.filter(c => c.challengeId !== challengeId));
      showToast('Contest Deleted 🗑️');
    } catch (err) {
      console.error('Error deleting contest:', err);
      showToast('Failed to Delete Contest');
    }
  };

  // Center Animated Toast
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  const loadChallenges = async (syncNetwork: boolean = false) => {
    try {
      if (syncNetwork) {
        const synced = await syncChallengesFromAllConversations();
        setChallenges(synced);
      } else {
        const all = await getAllLocalChallenges();
        setChallenges(Object.values(all));
      }
    } catch (e) {
      console.error('Error loading challenges:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleGoBack = useCallback(() => {
    if (deleteModalVisible) {
      closeDeleteModal();
      return true;
    }
    if (leaderboardModalVisible) {
      setLeaderboardModalVisible(false);
      return true;
    }
    if (createModalVisible) {
      setCreateModalVisible(false);
      return true;
    }

    const state = navigation.getState?.();
    const routes = state?.routes || [];
    const prevRoute = routes.length >= 2 ? routes[routes.length - 2] : null;

    if (prevRoute && prevRoute.name === 'TriviaSolo') {
      navigation.navigate('TriviaHub');
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('TriviaHub');
    }
    return true;
  }, [deleteModalVisible, leaderboardModalVisible, createModalVisible, navigation]);

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor(isDark ? '#0B132B' : '#F8FAFC', isDark);
      // Mode is driven by screenMode
      loadChallenges(true);

      const onBackPress = () => handleGoBack();

      const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => backSub.remove();
    }, [isDark, route?.params?.initialTab, handleGoBack])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadChallenges(true);
  };

  // ── Filtered Contests ──
  // 1. Hosted by Me: Created by current user
  const myHostedChallenges = challenges.filter(c => {
    return String(c.creatorId) === String(user?.id) || String((c as any).createdBy?.id) === String(user?.id);
  });

  // Active Hosted: Expiry time has not passed
  const activeHostedChallenges = myHostedChallenges.filter(c => {
    const exp = getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt);
    return !exp.isExpired;
  });

  // Expired Hosted: Expiry time has passed
  const expiredHostedChallenges = myHostedChallenges.filter(c => {
    const exp = getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt);
    return exp.isExpired;
  });

  // 2. Invited Contests: Created by others
  const myInvitedChallenges = challenges.filter(c => {
    return String(c.creatorId) !== String(user?.id) && String((c as any).createdBy?.id) !== String(user?.id);
  });

  // Pending Invites: User has NOT played, and time is not expired
  const pendingInvited = myInvitedChallenges.filter(c => {
    const hasPlayed = c.leaderboard && c.leaderboard.some(e => String(e.userId) === String(user?.id));
    const exp = getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt);
    return !hasPlayed && !exp.isExpired;
  });

  // Completed Invites: User has played
  const completedInvited = myInvitedChallenges.filter(c => {
    const hasPlayed = c.leaderboard && c.leaderboard.some(e => String(e.userId) === String(user?.id));
    return hasPlayed;
  });

  // Missed Invites: User did NOT play and time is expired
  const missedInvited = myInvitedChallenges.filter(c => {
    const hasPlayed = c.leaderboard && c.leaderboard.some(e => String(e.userId) === String(user?.id));
    const exp = getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt);
    return !hasPlayed && exp.isExpired;
  });

  const getDisplayData = () => {
    if (screenMode === 'hosted') {
      return hostedSubTab === 'active' ? activeHostedChallenges : expiredHostedChallenges;
    }
    if (invitedSubTab === 'pending') return pendingInvited;
    if (invitedSubTab === 'completed') return completedInvited;
    return missedInvited;
  };

  const handlePlayChallenge = (challenge: TriviaChallengePayload) => {
    navigation.navigate('TriviaSolo', {
      challengeData: challenge,
      mode: 'challenge',
    });
  };

  const handleOpenLeaderboard = (challenge: TriviaChallengePayload) => {
    setSelectedLeaderboardChallenge(challenge);
    setLeaderboardModalVisible(true);
  };

  const handleDeleteChallenge = (challenge: TriviaChallengePayload) => {
    openDeleteModal(challenge);
  };

  const handleShareResults = async (challenge: TriviaChallengePayload) => {
    setSharingResultsId(challenge.challengeId);
    try {
      const updated = await shareChallengeResultsToGroup(challenge.challengeId);
      if (updated) {
        setChallenges(prev => prev.map(c => c.challengeId === challenge.challengeId ? updated : c));
        if (selectedLeaderboardChallenge?.challengeId === challenge.challengeId) {
          setSelectedLeaderboardChallenge(updated);
        }
        showToast('Top 3 Shared to Group Chat! 🏆');
      } else {
        showToast('Failed to Share Results');
      }
    } catch (err) {
      console.error('Error sharing results:', err);
      showToast('Failed to Share Results');
    } finally {
      setSharingResultsId(null);
    }
  };

  const handleOpenCreateModal = async () => {
    try {
      const sets = await getCustomSets();
      setCustomSets(sets);
      setSelectedSetForChallenge(sets.length > 0 ? sets[0] : null);
      setCreateModalVisible(true);
      setSearchChatQuery('');

      // Load conversations
      const localConvs = localDatabase.getConversations() || [];
      if (Array.isArray(localConvs) && localConvs.length > 0) {
        setConversations(localConvs);
      }

      setLoadingConversations(true);
      const convs = await chatAPI.getConversations();
      let list: any[] = [];
      if (Array.isArray(convs)) list = convs;
      else if (Array.isArray(convs?.results)) list = convs.results;
      else if (Array.isArray(convs?.data)) list = convs.data;
      else list = localDatabase.getConversations() || [];
      setConversations(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Error opening create challenge modal:', err);
    } finally {
      setLoadingConversations(false);
    }
  };

  const handleSendChallenge = async (conv: any) => {
    if (!selectedSetForChallenge) return;
    const memberCount = Number(conv.participants_count) || (Array.isArray(conv.participants) ? conv.participants.length : 0);
    if (memberCount < 4) {
      Alert.alert(
        'Group Ineligible',
        `This group currently has ${Math.max(0, memberCount - 1)} other members. A contest requires a minimum of 4 total members (at least 3 other participants).`,
      );
      return;
    }

    setSendingChallengeId(conv.id);
    try {
      const eligible = Array.isArray(conv.participants)
        ? conv.participants
            .filter((p: any) => String(p.user?.id || p.id) !== String(user?.id))
            .map((p: any) => ({
              id: p.user?.id || p.id,
              name: p.user?.name || p.user?.username || 'Member',
              username: p.user?.username,
            }))
        : [];

      const payload = createChallengePayload(
        selectedSetForChallenge,
        user,
        conv.id,
        selectedDurationHours,
        conv.name || conv.title || 'Group Chat',
        eligible,
      );
      await sendChallengeToConversation(conv.id, payload);
      setCreateModalVisible(false);
      showToast(`Contest Hosted! (${selectedDurationHours}h window)`);
      loadChallenges(false);
    } catch (error) {
      console.error('Error sending challenge:', error);
      showToast('Failed to Send Contest');
    } finally {
      setSendingChallengeId(null);
    }
  };

  // ── Render Individual Card ──
  const renderChallengeCard = ({ item }: { item: TriviaChallengePayload }) => {
    const expiry = getChallengeExpiryStatus(item.createdAt, item.durationHours, item.expiresAt);
    const top3 = item.leaderboard ? item.leaderboard.slice(0, 3) : [];
    const totalParticipants = item.leaderboard ? item.leaderboard.length : 0;
    const eligibleCount = item.eligibleMembers?.length || totalParticipants;
    const allPlayed = eligibleCount > 0 && totalParticipants >= eligibleCount;
    const isAnnounced = !!item.resultsAnnounced || (Date.now() - new Date(item.createdAt).getTime() >= 24 * 3600 * 1000);
    const readyToShare = !item.resultsAnnounced && (allPlayed || expiry.isExpired);
    const isSharing = sharingResultsId === item.challengeId;

    // ── CASE A: HOSTED VIEW (Host cannot participate) ──
    if (screenMode === 'hosted') {
      return (
        <View
          style={[
            styles.challengeCard,
            {
              backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          {/* Card Header: Status Badge + Expiry Pill (+ Trash Icon if expired) */}
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.tournamentBadge,
                {
                  backgroundColor: item.resultsAnnounced
                    ? 'rgba(16, 185, 129, 0.15)'
                    : readyToShare
                    ? 'rgba(249, 115, 22, 0.15)'
                    : expiry.isExpired
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'rgba(99, 102, 241, 0.15)',
                },
              ]}
            >
              <Icon
                name={
                  item.resultsAnnounced
                    ? 'checkmark-circle'
                    : readyToShare
                    ? 'megaphone'
                    : expiry.isExpired
                    ? 'close-circle'
                    : 'time-outline'
                }
                size={13}
                color={
                  item.resultsAnnounced
                    ? '#10B981'
                    : readyToShare
                    ? '#F97316'
                    : expiry.isExpired
                    ? '#EF4444'
                    : '#6366F1'
                }
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.tournamentBadgeText,
                  {
                    color: item.resultsAnnounced
                      ? '#10B981'
                      : readyToShare
                      ? '#F97316'
                      : expiry.isExpired
                      ? '#EF4444'
                      : '#6366F1',
                  },
                ]}
              >
                {item.resultsAnnounced
                  ? 'RESULTS SHARED TO GROUP'
                  : readyToShare
                  ? 'READY TO SHARE'
                  : expiry.isExpired
                  ? 'EXPIRED'
                  : 'IN PROGRESS'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={[
                  styles.expiryPill,
                  { backgroundColor: expiry.isExpired ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)' },
                ]}
              >
                <Icon
                  name={expiry.isExpired ? 'close-circle' : 'time-outline'}
                  size={13}
                  color={expiry.isExpired ? '#EF4444' : '#10B981'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.expiryPillText, { color: expiry.isExpired ? '#EF4444' : '#10B981' }]}>
                  {expiry.remainingText}
                </Text>
              </View>

              {/* Trash icon in header for expired hosted contests */}
              {expiry.isExpired && (
                <TouchableOpacity
                  style={[
                    styles.headerTrashBtn,
                    { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : '#FEE2E2' },
                  ]}
                  onPress={() => handleDeleteChallenge(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="trash-outline" size={15} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Title & Group */}
          <Text style={[styles.quizTitle, { color: theme.textPrimary }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.hostText, { color: theme.textSecondary }]}>
            Target: <Text style={{ fontWeight: '700', color: isDark ? '#A5B4FC' : '#4F46E5' }}>{item.conversationName || 'Group Chat'}</Text>
          </Text>

          {/* Stats Row */}
          <View style={[styles.statsRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC' }]}>
            <View style={styles.statItem}>
              <Icon name="people-outline" size={15} color="#6366F1" />
              <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                {totalParticipants} <Text style={styles.statLabel}>Played ({eligibleCount} total)</Text>
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Icon name="timer-outline" size={15} color="#F59E0B" />
              <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                {item.durationHours || 4}h <Text style={styles.statLabel}>Window</Text>
              </Text>
            </View>
          </View>

          {/* Early Unlock / Status Indicator */}
          {allPlayed && !item.resultsAnnounced && (
            <View style={styles.earlyUnlockBanner}>
              <Icon name="flash" size={14} color="#10B981" style={{ marginRight: 6 }} />
              <Text style={styles.earlyUnlockText}>
                All members have played! You can share the results now.
              </Text>
            </View>
          )}

          {/* Host Action Buttons: NO PLAY BUTTON */}
          <View style={styles.cardActionsRow}>
            {readyToShare && !item.resultsAnnounced ? (
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => handleShareResults(item)}
                disabled={isSharing}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#F97316', '#EA580C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.playBtnGradient}
                >
                  {isSharing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Icon name="share-social" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.playBtnText}>Share to Group</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            ) : item.resultsAnnounced ? (
              <View style={[styles.expiredBtn, { backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : '#ECFDF5' }]}>
                <Icon name="checkmark-done" size={15} color="#10B981" style={{ marginRight: 5 }} />
                <Text style={[styles.expiredBtnText, { color: '#10B981' }]}>Shared to Chat</Text>
              </View>
            ) : expiry.isExpired ? (
              <View style={styles.expiredBtn}>
                <Text style={styles.expiredBtnText}>Contest Ended</Text>
              </View>
            ) : (
              <View style={styles.expiredBtn}>
                <Text style={styles.expiredBtnText}>Waiting for Players</Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.leaderboardBtn,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#CBD5E1',
                },
              ]}
              onPress={() => handleOpenLeaderboard(item)}
              activeOpacity={0.8}
            >
              <Icon name="bar-chart-outline" size={16} color={theme.textPrimary} style={{ marginRight: 4 }} />
              <Text style={[styles.leaderboardBtnText, { color: theme.textPrimary }]}>
                Standings
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // ── CASE B: INVITED VIEW (Participants) ──
    return (
      <View
        style={[
          styles.challengeCard,
          {
            backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        {/* Card Header: Expiry Pill + Contest Badge */}
        <View style={styles.cardHeaderRow}>
          <View
            style={[
              styles.tournamentBadge,
              {
                backgroundColor: invitedSubTab === 'completed'
                  ? (isAnnounced ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)')
                  : invitedSubTab === 'missed'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : 'rgba(99, 102, 241, 0.15)',
              },
            ]}
          >
            <Icon
              name={
                invitedSubTab === 'completed'
                  ? (isAnnounced ? 'trophy' : 'hourglass-outline')
                  : invitedSubTab === 'missed'
                  ? 'close-circle'
                  : 'flash'
              }
              size={13}
              color={
                invitedSubTab === 'completed'
                  ? (isAnnounced ? '#10B981' : '#F59E0B')
                  : invitedSubTab === 'missed'
                  ? '#EF4444'
                  : '#6366F1'
              }
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.tournamentBadgeText,
                {
                  color:
                    invitedSubTab === 'completed'
                      ? (isAnnounced ? '#10B981' : '#F59E0B')
                      : invitedSubTab === 'missed'
                      ? '#EF4444'
                      : '#6366F1',
                },
              ]}
            >
              {invitedSubTab === 'completed'
                ? (isAnnounced ? 'RESULTS ANNOUNCED' : 'AWAITING RESULTS')
                : invitedSubTab === 'missed'
                ? 'MISSED / EXPIRED'
                : 'GROUP CONTEST INVITE'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={[
                styles.expiryPill,
                { backgroundColor: expiry.isExpired ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)' },
              ]}
            >
              <Icon
                name={expiry.isExpired ? 'close-circle' : 'time-outline'}
                size={13}
                color={expiry.isExpired ? '#EF4444' : '#10B981'}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.expiryPillText, { color: expiry.isExpired ? '#EF4444' : '#10B981' }]}>
                {expiry.remainingText}
              </Text>
            </View>

            {/* Trash icon in header for completed & missed invited contests */}
            {(invitedSubTab === 'completed' || invitedSubTab === 'missed') && (
              <TouchableOpacity
                style={[
                  styles.headerTrashBtn,
                  { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : '#FEE2E2' },
                ]}
                onPress={() => handleDeleteChallenge(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="trash-outline" size={15} color="#EF4444" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Title & Host */}
        <Text style={[styles.quizTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.hostText, { color: theme.textSecondary }]}>
          Hosted by <Text style={{ fontWeight: '700', color: isDark ? '#A5B4FC' : '#4F46E5' }}>{item.creatorName}</Text>
        </Text>

        {/* Stats Row */}
        <View style={[styles.statsRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC' }]}>
          <View style={styles.statItem}>
            <Icon name="help-circle-outline" size={15} color="#6366F1" />
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {item.totalQuestions} <Text style={styles.statLabel}>Questions</Text>
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Icon name="timer-outline" size={15} color="#F59E0B" />
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {item.formattedTime} <Text style={styles.statLabel}>(48s/Q)</Text>
            </Text>
          </View>
        </View>

        {/* Competitive Exam Notice / Results Banner */}
        {invitedSubTab === 'pending' && (
          <View style={styles.examNoticeBanner}>
            <Icon name="shield-checkmark" size={13} color="#6366F1" style={{ marginRight: 6 }} />
            <Text style={styles.examNoticeText}>
              Competitive Exam Mode: Answers and scores remain sealed until announced.
            </Text>
          </View>
        )}

        {invitedSubTab === 'completed' && !isAnnounced && (
          <View style={[styles.examNoticeBanner, { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.25)' }]}>
            <Icon name="hourglass" size={13} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={[styles.examNoticeText, { color: '#D97706' }]}>
              Your answers are submitted! Host will announce results within 24 hours.
            </Text>
          </View>
        )}

        {/* Top 3 Podium (Only visible if announced) */}
        {isAnnounced && top3.length > 0 && (
          <View style={styles.leaderboardBox}>
            <Text style={[styles.lbHeaderTitle, { color: theme.textSecondary, marginBottom: 8 }]}>
              🏆 TOP WINNERS
            </Text>
            {top3.map((entry, idx) => {
              const medals = ['🥇', '🥈', '🥉'];
              const mins = Math.floor(entry.timeTakenSeconds / 60);
              const secs = entry.timeTakenSeconds % 60;
              const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
              const isCurrent = String(entry.userId) === String(user?.id);

              return (
                <View
                  key={idx}
                  style={[
                    styles.lbRow,
                    {
                      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0',
                      backgroundColor: isCurrent ? (isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)') : 'transparent',
                    },
                  ]}
                >
                  <Text style={styles.lbRank}>{medals[idx] || `#${idx + 1}`}</Text>
                  <Text style={[styles.lbName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {entry.userName} {isCurrent && '(You)'}
                  </Text>
                  <Text style={[styles.lbScore, { color: isDark ? '#34D399' : '#059669' }]}>
                    {entry.score}/{entry.totalQuestions}
                  </Text>
                  <Text style={[styles.lbTime, { color: theme.textSecondary }]}>
                    ({timeStr})
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.cardActionsRow}>
          {invitedSubTab === 'pending' ? (
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => handlePlayChallenge(item)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.playBtnGradient}
              >
                <Icon name="play" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.playBtnText}>Participate</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : isAnnounced ? (
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => handleOpenLeaderboard(item)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#4F46E5', '#6366F1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.playBtnGradient}
              >
                <Icon name="trophy" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.playBtnText}>View Scoreboard & Rankings</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.expiredBtn}>
              <Text style={styles.expiredBtnText}>Results Sealed</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const displayData = getDisplayData();

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0B132B' : '#F8FAFC' }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: safeTopPadding,
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
            borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.headerIconBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
          onPress={() => handleGoBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="arrow-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
            {screenMode === 'hosted' ? 'Hosted Contests' : 'Invited Contests'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            {screenMode === 'hosted'
              ? 'Contests you created & live standings'
              : 'Contests sent to you by friends & groups'}
          </Text>
        </View>

        {/* Spacer to keep title centered - NO host button in header */}
        <View style={{ width: 38 }} />
      </View>

      {/* Sub Tabs for Hosted: Active / Expired (Evenly Spaced) */}
      {screenMode === 'hosted' && (
        <View style={[styles.subTabBar, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
          {(['active', 'expired'] as HostedSubTab[]).map(tabKey => {
            const count =
              tabKey === 'active'
                ? activeHostedChallenges.length
                : expiredHostedChallenges.length;
            const label =
              tabKey === 'active'
                ? 'Active'
                : 'Expired';
            const isActive = hostedSubTab === tabKey;

            return (
              <TouchableOpacity
                key={tabKey}
                style={[
                  styles.subTabBtn,
                  isActive && {
                    backgroundColor: isDark ? 'rgba(249, 115, 22, 0.18)' : '#FFF7ED',
                    borderColor: '#F97316',
                  },
                ]}
                onPress={() => setHostedSubTab(tabKey)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.subTabText,
                    {
                      color: isActive ? '#F97316' : theme.textSecondary,
                      fontWeight: isActive ? '800' : '600',
                    },
                  ]}
                >
                  {label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Sub Tabs for Invited: Pending / Completed / Missed (Evenly Spaced) */}
      {screenMode === 'invited' && (
        <View style={[styles.subTabBar, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
          {(['pending', 'completed', 'missed'] as InvitedSubTab[]).map(tabKey => {
            const count =
              tabKey === 'pending'
                ? pendingInvited.length
                : tabKey === 'completed'
                ? completedInvited.length
                : missedInvited.length;
            const label =
              tabKey === 'pending'
                ? 'Pending'
                : tabKey === 'completed'
                ? 'Completed'
                : 'Missed';
            const isActive = invitedSubTab === tabKey;

            return (
              <TouchableOpacity
                key={tabKey}
                style={[
                  styles.subTabBtn,
                  isActive && {
                    backgroundColor: isDark ? 'rgba(16,185,129,0.18)' : '#ECFDF5',
                    borderColor: '#10B981',
                  },
                ]}
                onPress={() => setInvitedSubTab(tabKey)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.subTabText,
                    {
                      color: isActive ? '#10B981' : theme.textSecondary,
                      fontWeight: isActive ? '800' : '600',
                    },
                  ]}
                >
                  {label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Main List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading Contests...</Text>
        </View>
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={item => item.challengeId}
          renderItem={renderChallengeCard}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: safeBottomPadding + 80 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#4F46E5"
              colors={['#4F46E5']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? '#1E293B' : '#EFF6FF' }]}>
                <Icon
                  name={screenMode === 'hosted' ? 'podium-outline' : 'trophy-outline'}
                  size={46}
                  color={screenMode === 'hosted' ? '#F97316' : '#10B981'}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
                {screenMode === 'hosted'
                  ? (hostedSubTab === 'active' ? 'No Active Contests' : 'No Expired Contests')
                  : invitedSubTab === 'pending'
                  ? 'No Pending Invites'
                  : invitedSubTab === 'completed'
                  ? 'No Completed Contests'
                  : 'No Missed Contests'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {screenMode === 'hosted'
                  ? (hostedSubTab === 'active'
                      ? 'You have no running contests right now. Go to Created Quizzes and host a contest!'
                      : 'You have no expired contests.')
                  : invitedSubTab === 'pending'
                  ? 'When friends or group members host a contest, it will show up here.'
                  : invitedSubTab === 'completed'
                  ? 'Contests you finish playing will appear here awaiting results.'
                  : "You haven't missed any contest deadlines."}
              </Text>
            </View>
          }
        />
      )}

      {/* ── LEADERBOARD / STANDINGS MODAL ── */}
      <Modal
        visible={leaderboardModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLeaderboardModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="trophy" size={24} color="#F59E0B" />
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  Contest Standings
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setLeaderboardModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSubTitle, { color: theme.textSecondary }]}>
              {selectedLeaderboardChallenge?.title} • {selectedLeaderboardChallenge?.leaderboard?.length || 0} Submissions
            </Text>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(!selectedLeaderboardChallenge?.leaderboard || selectedLeaderboardChallenge.leaderboard.length === 0) ? (
                <View style={styles.modalEmptyBox}>
                  <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                    No one has submitted answers yet.
                  </Text>
                </View>
              ) : (
                selectedLeaderboardChallenge.leaderboard.map((entry, idx) => {
                  const medals = ['🥇', '🥈', '🥉'];
                  const isTop3 = idx < 3;
                  const mins = Math.floor(entry.timeTakenSeconds / 60);
                  const secs = entry.timeTakenSeconds % 60;
                  const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
                  const isCurrent = String(entry.userId) === String(user?.id);

                  return (
                    <View
                      key={idx}
                      style={[
                        styles.lbModalRow,
                        {
                          backgroundColor: isCurrent
                            ? (isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)')
                            : (isDark ? 'rgba(255,255,255,0.03)' : '#F8FAFC'),
                          borderColor: isCurrent ? '#6366F1' : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.lbModalRank, { fontSize: isTop3 ? 18 : 14, color: theme.textPrimary }]}>
                        {medals[idx] || `#${idx + 1}`}
                      </Text>

                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={[styles.lbModalName, { color: theme.textPrimary }]} numberOfLines={1}>
                          {entry.userName} {isCurrent && '(You)'}
                        </Text>
                        <Text style={[styles.lbModalSub, { color: theme.textSecondary }]}>
                          ⏱ {timeStr} • {entry.percentage}% Accuracy
                        </Text>
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.lbModalScore, { color: '#10B981' }]}>
                          {entry.score}/{entry.totalQuestions}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}

              {/* Unparticipated Members Listing (DNP) */}
              {(() => {
                if (!selectedLeaderboardChallenge) return null;
                const playedIds = new Set(
                  (selectedLeaderboardChallenge.leaderboard || []).map(e => String(e.userId))
                );
                const unplayed = (selectedLeaderboardChallenge.eligibleMembers || []).filter(
                  m => !playedIds.has(String(m.id))
                );
                if (unplayed.length === 0) return null;

                return (
                  <View style={{ marginTop: 14 }}>
                    <Text style={[styles.lbHeaderTitle, { color: theme.textSecondary, marginBottom: 8, fontSize: 11 }]}>
                      DID NOT PLAY ({unplayed.length})
                    </Text>
                    {unplayed.map((m, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.lbModalRow,
                          {
                            backgroundColor: isDark ? 'rgba(239,68,68,0.06)' : '#FEF2F2',
                            borderColor: 'transparent',
                            opacity: 0.8,
                          },
                        ]}
                      >
                        <Text style={[styles.lbModalRank, { fontSize: 13, color: '#EF4444' }]}>-</Text>
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={[styles.lbModalName, { color: theme.textSecondary }]} numberOfLines={1}>
                            {m.name || m.username || 'Member'}
                          </Text>
                          <Text style={[styles.lbModalSub, { color: '#EF4444' }]}>
                            Did not participate
                          </Text>
                        </View>
                        <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#EF4444' }}>DNP</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </ScrollView>

            {/* Share to Group button in modal for host if ready */}
            {selectedLeaderboardChallenge &&
              (String(selectedLeaderboardChallenge.creatorId) === String(user?.id) ||
                String((selectedLeaderboardChallenge as any).createdBy?.id) === String(user?.id)) &&
              !selectedLeaderboardChallenge.resultsAnnounced && (
                <TouchableOpacity
                  style={[styles.playBtn, { marginTop: 12 }]}
                  onPress={() => handleShareResults(selectedLeaderboardChallenge)}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#F97316', '#EA580C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.playBtnGradient}
                  >
                    <Icon name="share-social" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.playBtnText}>Share Top 3 to Group Chat</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0', marginTop: 10 }]}
              onPress={() => setLeaderboardModalVisible(false)}
            >
              <Text style={[styles.modalCloseBtnText, { color: theme.textPrimary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CREATE CHALLENGE MODAL (Host Contest) ── */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="megaphone" size={24} color="#F97316" />
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  Host a Contest
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setCreateModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Step 1: Select Quiz Set */}
            <Text style={[styles.createSectionTitle, { color: theme.textPrimary }]}>
              1. Select a Created Quiz
            </Text>
            {customSets.length === 0 ? (
              <View style={styles.emptySetsNotice}>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                  No created quizzes found. Create a set first in "Created".
                </Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.setPickerRow}>
                {customSets.map(set => {
                  const isSelected = selectedSetForChallenge?.id === set.id;
                  return (
                    <TouchableOpacity
                      key={set.id}
                      style={[
                        styles.setSelectChip,
                        {
                          backgroundColor: isSelected
                            ? '#F97316'
                            : isDark
                            ? 'rgba(255,255,255,0.06)'
                            : '#F1F5F9',
                          borderColor: isSelected ? '#F97316' : 'transparent',
                        },
                      ]}
                      onPress={() => setSelectedSetForChallenge(set)}
                    >
                      <Text style={[styles.setSelectChipText, { color: isSelected ? '#FFFFFF' : theme.textPrimary }]} numberOfLines={1}>
                        {set.name} ({set.questionCount} Qs)
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Step 2: Duration Selector */}
            <Text style={[styles.createSectionTitle, { color: theme.textPrimary, marginTop: 12 }]}>
              2. Participation Duration (Minimum 4 Hours)
            </Text>
            <View style={styles.durationSelectorRow}>
              {[4, 8, 12, 24].map(h => (
                <TouchableOpacity
                  key={h}
                  onPress={() => setSelectedDurationHours(h)}
                  style={[
                    styles.durationOptionBtn,
                    {
                      backgroundColor: selectedDurationHours === h
                        ? (isDark ? 'rgba(245,158,11,0.22)' : '#FEF3C7')
                        : (isDark ? 'rgba(255,255,255,0.04)' : '#F1F5F9'),
                      borderColor: selectedDurationHours === h
                        ? '#F59E0B'
                        : (isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0'),
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Icon
                    name="timer-outline"
                    size={13}
                    color={selectedDurationHours === h ? '#D97706' : (isDark ? '#94A3B8' : '#64748B')}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.durationOptionText,
                      {
                        color: selectedDurationHours === h
                          ? (isDark ? '#FBBF24' : '#B45309')
                          : (isDark ? '#94A3B8' : '#64748B'),
                        fontWeight: selectedDurationHours === h ? '800' : '600',
                      },
                    ]}
                  >
                    {h}h
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Step 3: Select Eligible Group */}
            <Text style={[styles.createSectionTitle, { color: theme.textPrimary, marginTop: 14 }]}>
              3. Send to Group Chat (Minimum 4 Members)
            </Text>
            {loadingConversations ? (
              <ActivityIndicator size="small" color="#F97316" style={{ marginVertical: 20 }} />
            ) : (() => {
              const groupList = conversations
                .filter(c => c && (c.is_group || c.type === 'group'))
                .filter(c => {
                  if (!searchChatQuery.trim()) return true;
                  const q = searchChatQuery.toLowerCase();
                  const name = (c.name || c.title || '').toLowerCase();
                  return name.includes(q);
                });

              if (groupList.length === 0) {
                return (
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center' }}>
                      No group chats found with 4+ members.
                    </Text>
                  </View>
                );
              }

              return (
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {groupList.map(conv => {
                    const name = conv.name || conv.title || 'Group Chat';
                    const memberCount = Number(conv.participants_count) || (Array.isArray(conv.participants) ? conv.participants.length : 0);
                    const isEligible = memberCount >= 4;
                    const otherMembers = Math.max(0, memberCount - 1);
                    const isSending = sendingChallengeId === conv.id;

                    return (
                      <TouchableOpacity
                        key={conv.id}
                        style={[
                          styles.convRow,
                          {
                            borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0',
                            opacity: isEligible ? 1 : 0.48,
                          },
                        ]}
                        onPress={() => isEligible && handleSendChallenge(conv)}
                        disabled={!isEligible || isSending || !selectedSetForChallenge}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.convName, { color: isEligible ? theme.textPrimary : theme.textSecondary }]} numberOfLines={1}>
                            {name}
                          </Text>
                          {isEligible ? (
                            <Text style={{ fontSize: 11, color: '#10B981', fontWeight: '600', marginTop: 2 }}>
                              👥 {memberCount} members • Window: {selectedDurationHours}h
                            </Text>
                          ) : (
                            <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '600', marginTop: 2 }}>
                              ⚠️ Requires at least 3 other members to host a contest (currently {otherMembers} members)
                            </Text>
                          )}
                        </View>

                        {isSending ? (
                          <ActivityIndicator size="small" color="#F97316" />
                        ) : (
                          <View
                            style={[
                              styles.convSendBadge,
                              {
                                backgroundColor: isEligible ? 'rgba(249,115,22,0.12)' : 'rgba(100,116,139,0.12)',
                              },
                            ]}
                          >
                            <Icon name="send" size={13} color={isEligible ? '#F97316' : '#94A3B8'} style={{ marginRight: 4 }} />
                            <Text style={[styles.convSendText, { color: isEligible ? '#F97316' : '#94A3B8' }]}>
                              Send
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Buttery Smooth Delete Confirmation Modal ── */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="none"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.deleteModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={closeDeleteModal}
          />
          <Animated.View
            style={[
              styles.deleteModalCard,
              {
                backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
                opacity: deleteModalOpacity,
                transform: [{ scale: deleteModalScale }],
              },
            ]}
          >
            {/* Trash Icon Circle with soft glow ring */}
            <View
              style={[
                styles.deleteModalIconRing,
                {
                  backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : '#FEE2E2',
                  borderColor: isDark ? 'rgba(239, 68, 68, 0.28)' : '#FECACA',
                },
              ]}
            >
              <Icon name="trash" size={28} color="#EF4444" />
            </View>

            {/* Modal Title */}
            <Text style={[styles.deleteModalTitle, { color: theme.textPrimary }]}>
              Delete Contest?
            </Text>

            {/* Contest Info Pill */}
            {challengeToDelete && (
              <View
                style={[
                  styles.deleteModalQuizPill,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F8FAFC',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#E2E8F0',
                  },
                ]}
              >
                <Icon name="trophy-outline" size={14} color="#F97316" style={{ marginRight: 6 }} />
                <Text
                  style={[styles.deleteModalQuizTitle, { color: theme.textPrimary }]}
                  numberOfLines={1}
                >
                  {challengeToDelete.title}
                </Text>
              </View>
            )}

            {/* Description */}
            <Text style={[styles.deleteModalSubtitle, { color: theme.textSecondary }]}>
              {screenMode === 'hosted'
                ? 'This will remove the contest from your hosted list. Participants will still keep their scores.'
                : 'This will remove this contest from your history. This action cannot be undone.'}
            </Text>

            {/* Action Buttons: Cancel and Delete */}
            <View style={styles.deleteModalActionsRow}>
              <TouchableOpacity
                style={[
                  styles.deleteModalCancelBtn,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F1F5F9',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#CBD5E1',
                  },
                ]}
                onPress={closeDeleteModal}
                activeOpacity={0.75}
              >
                <Text style={[styles.deleteModalCancelText, { color: theme.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteModalConfirmBtn}
                onPress={confirmDeleteChallenge}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#EF4444', '#DC2626']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.deleteModalConfirmGradient}
                >
                  <Icon name="trash-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.deleteModalConfirmText}>Delete</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Center Animated Toast ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={styles.toastOverlay} pointerEvents="none">
          <Animated.View
            style={[
              styles.toastBox,
              {
                opacity: toastOpacity,
                backgroundColor: isDark ? '#1E293B' : '#0F172A',
              },
            ]}
          >
            <Icon
              name={toastMessage.includes('Failed') ? 'close-circle' : 'checkmark-circle'}
              size={22}
              color={toastMessage.includes('Failed') ? '#EF4444' : '#10B981'}
              style={{ marginRight: 8 }}
            />
            <Text style={[styles.toastText, { color: '#FFFFFF' }]}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  createHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 4,
  },
  createHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  topSegmentBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  segmentBtnActive: {
    elevation: 1,
  },
  segmentBtnText: {
    fontSize: 13,
  },
  subTabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    width: '100%',
  },
  subTabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  subTabText: {
    fontSize: 12.5,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    gap: 14,
  },
  challengeCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tournamentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tournamentBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  expiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
  },
  expiryPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quizTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 22,
    marginBottom: 4,
  },
  hostText: {
    fontSize: 12.5,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  statLabel: {
    fontWeight: '400',
    fontSize: 11.5,
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginHorizontal: 8,
  },
  earlyUnlockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 12,
  },
  earlyUnlockText: {
    color: '#10B981',
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
  },
  examNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 12,
  },
  examNoticeText: {
    color: '#6366F1',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  leaderboardBox: {
    marginBottom: 12,
    paddingTop: 4,
  },
  lbHeaderTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderBottomWidth: 0.5,
  },
  lbRank: {
    width: 24,
    fontSize: 13,
    fontWeight: '700',
  },
  lbName: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  lbScore: {
    fontSize: 12.5,
    fontWeight: '800',
    marginRight: 6,
  },
  lbTime: {
    fontSize: 11,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
  },
  playBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  playBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  expiredBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  expiredBtnText: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '700',
  },
  leaderboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  leaderboardBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    borderRadius: 22,
    padding: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  modalSubTitle: {
    fontSize: 12,
    marginBottom: 14,
  },
  modalEmptyBox: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  lbModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
  },
  lbModalRank: {
    width: 28,
    fontWeight: '800',
  },
  lbModalName: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  lbModalSub: {
    fontSize: 11,
    marginTop: 2,
  },
  lbModalScore: {
    fontSize: 14,
    fontWeight: '800',
  },
  modalCloseBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  createSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  emptySetsNotice: {
    paddingVertical: 14,
  },
  setPickerRow: {
    marginBottom: 10,
  },
  setSelectChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
  },
  setSelectChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  durationSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  durationOptionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  durationOptionText: {
    fontSize: 12,
  },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  convName: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  convSendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  convSendText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 8,
  },
  toastText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  headerTrashBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  deleteModalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  deleteModalIconRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalQuizPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '100%',
    marginBottom: 10,
  },
  deleteModalQuizTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  deleteModalSubtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  deleteModalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  deleteModalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteModalCancelText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  deleteModalConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 13,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  deleteModalConfirmGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteModalConfirmText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  deleteContestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  deleteContestBtnText: {
    color: '#EF4444',
    fontSize: 12.5,
    fontWeight: '700',
  },
});

export default TriviaChallengesScreen;
