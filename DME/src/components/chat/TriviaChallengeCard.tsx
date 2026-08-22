import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../context/ThemeContext';
import {
  TriviaChallengePayload,
  getChallengeExpiryStatus,
  getAllLocalChallenges,
  getChallengePayloadFromContent,
} from '../../services/TriviaChallengeService';

const { width } = Dimensions.get('window');

interface TriviaChallengeCardProps {
  content: string; // JSON string of TriviaChallengePayload
  isMe: boolean;
  navigation: any;
  onPlayPress?: (payload: TriviaChallengePayload) => void;
}

export const TriviaChallengeCard: React.FC<TriviaChallengeCardProps> = ({
  content,
  isMe,
  navigation,
  onPlayPress,
}) => {
  const { theme, isDark } = useTheme();
  const [payload, setPayload] = useState<TriviaChallengePayload | null>(null);
  const [expiryStatus, setExpiryStatus] = useState<{ isExpired: boolean; remainingText: string }>({
    isExpired: false,
    remainingText: '24h left',
  });
  const [leaderboardModalVisible, setLeaderboardModalVisible] = useState(false);

  useEffect(() => {
    try {
      const parsed = typeof content === 'object' && content !== null
        ? (content as TriviaChallengePayload)
        : getChallengePayloadFromContent(content);

      if (parsed) {
        setPayload(parsed);
        setExpiryStatus(getChallengeExpiryStatus(parsed.createdAt));

        // Refresh live leaderboard from local storage if updated
        getAllLocalChallenges().then(all => {
          if (all[parsed.challengeId]) {
            setPayload(all[parsed.challengeId]);
          }
        });
      }
    } catch (e) {
      console.error('Failed to parse trivia challenge payload:', e);
    }
  }, [content]);

  // Periodic tick for remaining countdown
  useEffect(() => {
    if (!payload) return;
    const interval = setInterval(() => {
      setExpiryStatus(getChallengeExpiryStatus(payload.createdAt));
    }, 60000); // every minute
    return () => clearInterval(interval);
  }, [payload]);

  if (!payload) {
    return (
      <View style={[styles.fallbackCard, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>⚔️ Trivia Challenge</Text>
      </View>
    );
  }

  const handlePlay = () => {
    if (expiryStatus.isExpired) return;
    if (onPlayPress) {
      onPlayPress(payload);
    } else {
      navigation.navigate('TriviaSolo', {
        challengeData: payload,
        mode: 'challenge',
      });
    }
  };

  const top3 = payload.leaderboard ? payload.leaderboard.slice(0, 3) : [];
  const totalPlayed = payload.leaderboard?.length || 0;

  return (
    <View style={styles.cardContainer}>
      <LinearGradient
        colors={
          expiryStatus.isExpired
            ? isDark
              ? ['#334155', '#1E293B']
              : ['#E2E8F0', '#CBD5E1']
            : isDark
            ? ['#1E1B4B', '#0F172A', '#1E293B']
            : ['#EEF2FF', '#FFFFFF', '#F8FAFC']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.card,
          {
            borderColor: expiryStatus.isExpired
              ? 'rgba(148, 163, 184, 0.3)'
              : isDark
              ? 'rgba(99, 102, 241, 0.4)'
              : '#E0E7FF',
          },
        ]}
      >
        {/* Top Header Row */}
        <View style={styles.topHeader}>
          <View style={styles.badgeRow}>
            <LinearGradient
              colors={expiryStatus.isExpired ? ['#64748B', '#475569'] : ['#4F46E5', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.tournamentBadge}
            >
              <Icon name="trophy" size={12} color="#FFFFFF" />
              <Text style={styles.tournamentBadgeText}>
                {expiryStatus.isExpired ? 'CHALLENGE ENDED' : '24-HOUR CHALLENGE'}
              </Text>
            </LinearGradient>

            <View
              style={[
                styles.expiryPill,
                {
                  backgroundColor: expiryStatus.isExpired
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(16, 185, 129, 0.15)',
                },
              ]}
            >
              <Icon
                name={expiryStatus.isExpired ? 'close-circle' : 'time-outline'}
                size={12}
                color={expiryStatus.isExpired ? '#EF4444' : '#10B981'}
              />
              <Text
                style={[
                  styles.expiryPillText,
                  { color: expiryStatus.isExpired ? '#EF4444' : '#10B981' },
                ]}
              >
                {expiryStatus.remainingText}
              </Text>
            </View>
          </View>
        </View>

        {/* Quiz Title & Host */}
        <Text style={[styles.quizTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {payload.title}
        </Text>
        <Text style={[styles.hostText, { color: theme.textSecondary }]}>
          Hosted by <Text style={{ fontWeight: '700', color: isDark ? '#A5B4FC' : '#4F46E5' }}>{payload.creatorName}</Text>
        </Text>

        {/* Dynamic Timing & Question Stats */}
        <View style={[styles.statsRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
          <View style={styles.statItem}>
            <Icon name="help-circle-outline" size={15} color="#6366F1" />
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {payload.totalQuestions} <Text style={styles.statLabel}>Questions</Text>
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Icon name="timer-outline" size={15} color="#F59E0B" />
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {payload.formattedTime} <Text style={styles.statLabel}>(48s/Q)</Text>
            </Text>
          </View>
        </View>

        {/* Leaderboard Snippet */}
        {top3.length > 0 ? (
          <View style={styles.leaderboardBox}>
            <View style={styles.lbHeaderRow}>
              <Text style={[styles.lbTitle, { color: theme.textSecondary }]}>
                🏆 TOP PLAYERS ({totalPlayed})
              </Text>
              <TouchableOpacity onPress={() => setLeaderboardModalVisible(true)}>
                <Text style={styles.lbViewAllLink}>View All</Text>
              </TouchableOpacity>
            </View>

            {top3.map((entry, idx) => {
              const medals = ['🥇', '🥈', '🥉'];
              const mins = Math.floor(entry.timeTakenSeconds / 60);
              const secs = entry.timeTakenSeconds % 60;
              const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

              return (
                <View
                  key={idx}
                  style={[
                    styles.lbRow,
                    { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' },
                  ]}
                >
                  <Text style={styles.lbRank}>{medals[idx] || `#${idx + 1}`}</Text>
                  <Text
                    style={[styles.lbName, { color: theme.textPrimary }]}
                    numberOfLines={1}
                  >
                    {entry.userName}
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
              🎯 No one has completed this challenge yet. Be the first!
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          {!expiryStatus.isExpired ? (
            <TouchableOpacity
              style={styles.playBtn}
              onPress={handlePlay}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#4F46E5', '#6366F1', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.playBtnGradient}
              >
                <Icon name="flash" size={16} color="#FFFFFF" />
                <Text style={styles.playBtnText}>Play Challenge</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.expiredBtn}>
              <Text style={styles.expiredBtnText}>Challenge Closed</Text>
            </View>
          )}

          {totalPlayed > 0 && (
            <TouchableOpacity
              style={[
                styles.leaderboardBtn,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#CBD5E1',
                },
              ]}
              onPress={() => setLeaderboardModalVisible(true)}
              activeOpacity={0.8}
            >
              <Icon name="bar-chart-outline" size={16} color={theme.textPrimary} />
              <Text style={[styles.leaderboardBtnText, { color: theme.textPrimary }]}>
                Ranks
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {/* Full Leaderboard Modal */}
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
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <Icon name="trophy" size={22} color="#F59E0B" />
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  Challenge Leaderboard
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
              {payload.title} • {totalPlayed} Participants
            </Text>

            {/* Leaderboard Table */}
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {payload.leaderboard?.map((entry, idx) => {
                const medals = ['🥇', '🥈', '🥉'];
                const mins = Math.floor(entry.timeTakenSeconds / 60);
                const secs = entry.timeTakenSeconds % 60;
                const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

                return (
                  <View
                    key={idx}
                    style={[
                      styles.modalLbRow,
                      {
                        backgroundColor:
                          idx === 0
                            ? isDark
                              ? 'rgba(245, 158, 11, 0.12)'
                              : '#FEF3C7'
                            : isDark
                            ? 'rgba(255,255,255,0.04)'
                            : '#F8FAFC',
                        borderColor:
                          idx === 0
                            ? '#F59E0B'
                            : isDark
                            ? 'rgba(255,255,255,0.06)'
                            : '#E2E8F0',
                      },
                    ]}
                  >
                    <Text style={styles.modalRankText}>
                      {medals[idx] || `#${idx + 1}`}
                    </Text>

                    <View style={styles.modalPlayerInfo}>
                      <Text
                        style={[styles.modalPlayerName, { color: theme.textPrimary }]}
                        numberOfLines={1}
                      >
                        {entry.userName}
                      </Text>
                      <Text style={[styles.modalPlayerTime, { color: theme.textSecondary }]}>
                        Time: {timeStr}
                      </Text>
                    </View>

                    <View style={styles.modalScoreBox}>
                      <Text style={[styles.modalScoreText, { color: '#6366F1' }]}>
                        {entry.score}/{entry.totalQuestions}
                      </Text>
                      <Text style={[styles.modalPercentText, { color: theme.textSecondary }]}>
                        {entry.percentage}%
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: '#4F46E5' }]}
              onPress={() => setLeaderboardModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: Math.min(width * 0.85, 330),
    marginVertical: 4,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  fallbackCard: {
    padding: 14,
    borderRadius: 12,
  },
  topHeader: {
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tournamentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  tournamentBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  expiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  expiryPillText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  quizTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 2,
  },
  hostText: {
    fontSize: 11.5,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 10,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    color: '#64748B',
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  leaderboardBox: {
    marginBottom: 12,
  },
  lbHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  lbTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lbViewAllLink: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366F1',
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
  },
  lbRank: {
    fontSize: 13,
    width: 22,
  },
  lbName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  lbScore: {
    fontSize: 12,
    fontWeight: '800',
    marginHorizontal: 4,
  },
  lbTime: {
    fontSize: 10.5,
  },
  noPlayersBox: {
    paddingVertical: 8,
    marginBottom: 10,
  },
  noPlayersText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    gap: 6,
  },
  playBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  expiredBtn: {
    flex: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  expiredBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  leaderboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  leaderboardBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 22,
    padding: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubTitle: {
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 16,
  },
  modalScroll: {
    maxHeight: 320,
  },
  modalLbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  modalRankText: {
    fontSize: 16,
    fontWeight: '800',
    width: 32,
  },
  modalPlayerInfo: {
    flex: 1,
  },
  modalPlayerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalPlayerTime: {
    fontSize: 11,
    marginTop: 2,
  },
  modalScoreBox: {
    alignItems: 'flex-end',
  },
  modalScoreText: {
    fontSize: 15,
    fontWeight: '900',
  },
  modalPercentText: {
    fontSize: 11,
  },
  modalCloseBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});

export default TriviaChallengeCard;
