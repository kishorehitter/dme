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
} from '../services/TriviaChallengeService';
import { getAllCustomSets, CustomTriviaSet } from '../services/CustomTriviaStorage';
import { chatAPI } from '../services/api';
import localDatabase from '../services/LocalDatabase';

const { width } = Dimensions.get('window');

interface TriviaChallengesScreenProps {
  navigation: any;
  route?: any;
}

type ChallengeTab = 'my_invites' | 'hosted' | 'completed';

export const TriviaChallengesScreen: React.FC<TriviaChallengesScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const safeTopPadding = (insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44)) + 8;
  const safeBottomPadding = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 24 : 16);
  const { theme, isDark } = useTheme();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ChallengeTab>(route?.params?.initialTab || 'my_invites');
  const [challenges, setChallenges] = useState<TriviaChallengePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Leaderboard Modal State
  const [selectedLeaderboardChallenge, setSelectedLeaderboardChallenge] = useState<TriviaChallengePayload | null>(null);
  const [leaderboardModalVisible, setLeaderboardModalVisible] = useState(false);

  // Create Challenge Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [customSets, setCustomSets] = useState<CustomTriviaSet[]>([]);
  const [selectedSetForChallenge, setSelectedSetForChallenge] = useState<CustomTriviaSet | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [sendingChallengeId, setSendingChallengeId] = useState<number | null>(null);

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
      Animated.delay(800),
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

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor(isDark ? '#0B132B' : '#F8FAFC', isDark);
      if (route?.params?.initialTab) {
        setActiveTab(route.params.initialTab);
      }
      loadChallenges(true);
    }, [isDark, route?.params?.initialTab])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadChallenges(true);
  };

  // Filtered lists
  const activeChallenges = challenges.filter(c => !getChallengeExpiryStatus(c.createdAt).isExpired);
  const completedChallenges = challenges.filter(c => getChallengeExpiryStatus(c.createdAt).isExpired);

  // 1. Invites to Play: Active contests where I haven't played yet
  const myInvitedChallenges = activeChallenges.filter(c => {
    const hasPlayed = c.leaderboard && c.leaderboard.some(e => String(e.userId) === String(user?.id));
    return !hasPlayed;
  });

  // 2. Hosted by Me: Active contests created by current user
  const myHostedChallenges = activeChallenges.filter(c => {
    return String(c.creatorId) === String(user?.id) || String((c as any).createdBy?.id) === String(user?.id);
  });

  const getDisplayData = () => {
    switch (activeTab) {
      case 'my_invites':
        return myInvitedChallenges;
      case 'hosted':
        return myHostedChallenges;
      case 'completed':
        return completedChallenges;
      default:
        return myInvitedChallenges;
    }
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

  const handleOpenCreateModal = async () => {
    try {
      const sets = await getAllCustomSets();
      setCustomSets(sets);
      setSelectedSetForChallenge(sets.length > 0 ? sets[0] : null);
      setCreateModalVisible(true);

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
    setSendingChallengeId(conv.id);
    try {
      const payload = createChallengePayload(selectedSetForChallenge, user, conv.id);
      await sendChallengeToConversation(conv.id, payload);
      setCreateModalVisible(false);
      showToast('Group Contest Sent!');
      loadChallenges(false);
    } catch (error) {
      console.error('Error sending challenge:', error);
      showToast('Failed to Send Contest');
    } finally {
      setSendingChallengeId(null);
    }
  };

  const renderChallengeCard = ({ item }: { item: TriviaChallengePayload }) => {
    const expiry = getChallengeExpiryStatus(item.createdAt);
    const top3 = item.leaderboard ? item.leaderboard.slice(0, 3) : [];
    const totalParticipants = item.leaderboard ? item.leaderboard.length : 0;
    const userEntry = item.leaderboard ? item.leaderboard.find(e => String(e.userId) === String(user?.id)) : null;

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
              { backgroundColor: expiry.isExpired ? (isDark ? '#334155' : '#E2E8F0') : 'rgba(99, 102, 241, 0.15)' },
            ]}
          >
            <Icon
              name="trophy"
              size={13}
              color={expiry.isExpired ? (isDark ? '#94A3B8' : '#64748B') : '#6366F1'}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.tournamentBadgeText,
                { color: expiry.isExpired ? (isDark ? '#94A3B8' : '#64748B') : '#6366F1' },
              ]}
            >
              {expiry.isExpired ? 'CONTEST ENDED' : 'GROUP CONTEST'}
            </Text>
          </View>

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
        </View>

        {/* Title & Host */}
        <Text style={[styles.quizTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.hostText, { color: theme.textSecondary }]}>
          Created by <Text style={{ fontWeight: '700', color: isDark ? '#A5B4FC' : '#4F46E5' }}>{item.creatorName}</Text>
        </Text>

        {/* Dynamic Timer & Stats Pill */}
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

        {/* Top 3 Live Podium Preview */}
        {totalParticipants > 0 ? (
          <View style={styles.leaderboardBox}>
            <View style={styles.lbHeaderRow}>
              <Text style={[styles.lbHeaderTitle, { color: theme.textSecondary }]}>
                🏆 TOP PLAYERS ({totalParticipants})
              </Text>
              <TouchableOpacity onPress={() => handleOpenLeaderboard(item)}>
                <Text style={styles.lbViewAllLink}>View All Ranks</Text>
              </TouchableOpacity>
            </View>

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
        ) : (
          <View style={styles.noPlayersBox}>
            <Text style={[styles.noPlayersText, { color: theme.textSecondary }]}>
              🎯 No one has submitted a score yet. Be the first to play!
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.cardActionsRow}>
          {!expiry.isExpired ? (
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => handlePlayChallenge(item)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#4F46E5', '#6366F1', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.playBtnGradient}
              >
                <Icon name={userEntry ? 'refresh' : 'flash'} size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.playBtnText}>
                  {userEntry ? 'Play Again' : 'Join Contest'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.expiredBtn}>
              <Text style={styles.expiredBtnText}>Contest Ended</Text>
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
              Ranks
            </Text>
          </TouchableOpacity>
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
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="arrow-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Group Contests</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            Live Group & Friend Competitions
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.createHeaderBtn, { backgroundColor: '#4F46E5' }]}
          onPress={handleOpenCreateModal}
          activeOpacity={0.85}
        >
          <Icon name="add" size={18} color="#FFFFFF" />
          <Text style={styles.createHeaderBtnText}>New Contest</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Selector */}
      <View style={[styles.tabBar, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'my_invites' && styles.tabBtnActive]}
          onPress={() => setActiveTab('my_invites')}
        >
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'my_invites' ? '#4F46E5' : theme.textSecondary },
              activeTab === 'my_invites' && { fontWeight: '800' },
            ]}
          >
            Invites ({myInvitedChallenges.length})
          </Text>
          {activeTab === 'my_invites' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'hosted' && styles.tabBtnActive]}
          onPress={() => setActiveTab('hosted')}
        >
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'hosted' ? '#4F46E5' : theme.textSecondary },
              activeTab === 'hosted' && { fontWeight: '800' },
            ]}
          >
            Hosted by Me ({myHostedChallenges.length})
          </Text>
          {activeTab === 'hosted' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'completed' && styles.tabBtnActive]}
          onPress={() => setActiveTab('completed')}
        >
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'completed' ? '#4F46E5' : theme.textSecondary },
              activeTab === 'completed' && { fontWeight: '800' },
            ]}
          >
            Leaderboard ({completedChallenges.length})
          </Text>
          {activeTab === 'completed' && <View style={styles.activeTabIndicator} />}
        </TouchableOpacity>
      </View>

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
                <Icon name="trophy-outline" size={48} color="#4F46E5" />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
                {activeTab === 'my_invites'
                  ? 'No Pending Invites'
                  : activeTab === 'hosted'
                  ? 'No Contests Hosted Yet'
                  : 'No Completed Contests'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {activeTab === 'my_invites'
                  ? 'You have played all received contests. Check back when friends invite you!'
                  : activeTab === 'hosted'
                  ? 'Launch your first group contest from any quiz set and invite your friends or study groups!'
                  : 'Contests that pass the 24-hour mark will appear here with final rankings.'}
              </Text>

              <TouchableOpacity
                style={styles.emptyCreateBtn}
                onPress={handleOpenCreateModal}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#4F46E5', '#7C3AED']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.emptyCreateGradient}
                >
                  <Icon name="add-circle-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.emptyCreateBtnText}>Create Group Contest</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* ── FULL LEADERBOARD MODAL ── */}
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
                  Contest Leaderboard
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
              {selectedLeaderboardChallenge?.title} • {selectedLeaderboardChallenge?.leaderboard?.length || 0} Participants
            </Text>

            {(!selectedLeaderboardChallenge?.leaderboard || selectedLeaderboardChallenge.leaderboard.length === 0) ? (
              <View style={styles.modalEmptyBox}>
                <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                  No one has completed this contest yet.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {selectedLeaderboardChallenge.leaderboard.map((entry, idx) => {
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
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}
              onPress={() => setLeaderboardModalVisible(false)}
            >
              <Text style={[styles.modalCloseBtnText, { color: theme.textPrimary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CREATE CHALLENGE MODAL ── */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.createModalCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="flash" size={22} color="#4F46E5" />
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  Create Group Contest
                </Text>
              </View>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <Icon name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: theme.textSecondary, fontSize: 13, marginBottom: 14 }}>
              Select a quiz set and choose a friend or group to contest:
            </Text>

            {/* Step 1: Select Quiz Set */}
            <Text style={[styles.createSectionTitle, { color: theme.textPrimary }]}>
              1. Select Quiz Set ({customSets.length})
            </Text>
            {customSets.length === 0 ? (
              <TouchableOpacity
                style={styles.noSetsBox}
                onPress={() => {
                  setCreateModalVisible(false);
                  navigation.navigate('CustomTriviaSets');
                }}
              >
                <Text style={{ color: '#4F46E5', fontWeight: '700' }}>
                  + Create or Import a Quiz Set in "My Quest"
                </Text>
              </TouchableOpacity>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {customSets.map(set => {
                  const isSelected = selectedSetForChallenge?.id === set.id;
                  return (
                    <TouchableOpacity
                      key={set.id}
                      style={[
                        styles.setSelectChip,
                        {
                          backgroundColor: isSelected ? '#4F46E5' : (isDark ? '#1E293B' : '#F1F5F9'),
                          borderColor: isSelected ? '#4F46E5' : (isDark ? '#334155' : '#E2E8F0'),
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

            {/* Step 2: Select Conversation to Send */}
            <Text style={[styles.createSectionTitle, { color: theme.textPrimary }]}>
              2. Send to Chat or Group
            </Text>
            {loadingConversations ? (
              <ActivityIndicator size="small" color="#4F46E5" style={{ marginVertical: 20 }} />
            ) : conversations.length === 0 ? (
              <Text style={{ color: theme.textSecondary, marginVertical: 14 }}>No active chats found.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                {conversations.map(conv => {
                  const name = conv.name || conv.title || conv.other_user?.name || conv.other_user?.username || conv.user?.name || 'Chat';
                  const isSending = sendingChallengeId === conv.id;

                  return (
                    <TouchableOpacity
                      key={conv.id}
                      style={[
                        styles.convRow,
                        { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' },
                      ]}
                      onPress={() => handleSendChallenge(conv)}
                      disabled={isSending || !selectedSetForChallenge}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.convName, { color: theme.textPrimary }]} numberOfLines={1}>
                          {name}
                        </Text>
                        <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                          {conv.is_group ? '👥 Group Chat' : '👤 Direct Chat'}
                        </Text>
                      </View>

                      {isSending ? (
                        <ActivityIndicator size="small" color="#4F46E5" />
                      ) : (
                        <View style={styles.convSendBadge}>
                          <Icon name="send" size={13} color="#4F46E5" style={{ marginRight: 4 }} />
                          <Text style={styles.convSendText}>Send</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Center Animated Toast ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={styles.toastOverlay} pointerEvents="none">
          <Animated.View style={[styles.toastBox, { opacity: toastOpacity, backgroundColor: isDark ? '#1E293B' : '#0F172A' }]}>
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
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  createHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  createHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 3,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    position: 'relative',
  },
  tabBtnActive: {},
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: '60%',
    backgroundColor: '#4F46E5',
    borderRadius: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  challengeCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tournamentBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  expiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  expiryPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quizTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 2,
  },
  hostText: {
    fontSize: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: '#64748B',
  },
  statDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginHorizontal: 14,
  },
  leaderboardBox: {
    marginBottom: 14,
  },
  lbHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  lbHeaderTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lbViewAllLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
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
    fontSize: 14,
    fontWeight: '800',
    width: 26,
  },
  lbName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  lbScore: {
    fontSize: 13,
    fontWeight: '800',
    marginRight: 6,
  },
  lbTime: {
    fontSize: 11,
  },
  noPlayersBox: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  noPlayersText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  playBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  playBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  playBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  expiredBtn: {
    flex: 1,
    backgroundColor: '#64748B',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  expiredBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  leaderboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  leaderboardBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyCreateBtn: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  emptyCreateGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  emptyCreateBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 20,
    elevation: 16,
  },
  createModalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 20,
    elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  lbModalRank: {
    width: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  lbModalName: {
    fontSize: 14,
    fontWeight: '700',
  },
  lbModalSub: {
    fontSize: 11,
    marginTop: 2,
  },
  lbModalScore: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalCloseBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  createSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  noSetsBox: {
    padding: 12,
    backgroundColor: 'rgba(79, 70, 229, 0.08)',
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  setSelectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 8,
  },
  setSelectChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  convName: {
    fontSize: 14,
    fontWeight: '700',
  },
  convSendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(79, 70, 229, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  convSendText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '800',
  },
  toastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  toastText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default TriviaChallengesScreen;
