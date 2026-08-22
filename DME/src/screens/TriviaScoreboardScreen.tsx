/**
 * TriviaScoreboardScreen.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full offline scoreboard for the Trivia Challenge.
 *
 * Features:
 * - 0ms Instant mount with zero flicker & zero transition freeze
 * - Synchronous memory cache & stable layout skeleton from Frame 0
 * - Non-blocking native interactions
 * - Glassmorphic header, summary bar, and performance grade badges
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
  InteractionManager,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  getFullScoreboardData,
  getCachedScoreboardDataSync,
  clearAllScores,
  CategorySummary,
  SetSummary,
} from '../services/TriviaScoreDB';
import { TRIVIA_SETS_PER_CATEGORY } from '../utils/triviaSetConfig';
import { pinNavBarColor } from '../utils/navBarPin';

// ─── Category display config ──────────────────────────────────────────────────
const CAT_CONFIG: Record<string, { name: string; emoji: string; color: string }> = {
  current_affairs: { name: 'Current Affairs', emoji: '🔥', color: '#FF758F' },
  polity:          { name: 'Polity',          emoji: '🏛️', color: '#FFB703' },
  history:         { name: 'History',         emoji: '📜', color: '#F77F00' },
  geography:       { name: 'Geography',       emoji: '🌍', color: '#00B4D8' },
  science:         { name: 'Science',         emoji: '🔬', color: '#4DEEEA' },
  economy:         { name: 'Economy',         emoji: '💰', color: '#70E000' },
  reasoning:       { name: 'Reasoning',       emoji: '🧠', color: '#B388FF' },
  aptitude:        { name: 'Aptitude',        emoji: '➗', color: '#00F5D4' },
  technology:      { name: 'Technology',      emoji: '💻', color: '#4597f5' },
  literature:      { name: 'Literature',      emoji: '📚', color: '#E07A5F' },
  any:             { name: 'All Mix',         emoji: '🎲', color: '#8D99AE' },
};

const CATEGORY_ORDER = [
  'current_affairs','polity','history','geography','science',
  'economy','reasoning','aptitude','technology','literature','any',
];

// ─── Grade helper ─────────────────────────────────────────────────────────────
function grade(pct: number): { label: string; color: string } {
  if (pct === 0)   return { label: '—',  color: '#999' };
  if (pct >= 90)   return { label: 'A+', color: '#00C853' };
  if (pct >= 75)   return { label: 'A',  color: '#4CAF50' };
  if (pct >= 60)   return { label: 'B',  color: '#FFB703' };
  if (pct >= 40)   return { label: 'C',  color: '#FF9800' };
  return             { label: 'D',  color: '#FF3366' };
}

// ─── Row component ────────────────────────────────────────────────────────────
const SetRow = ({
  summary,
  catColor,
  index,
}: {
  summary: SetSummary;
  catColor: string;
  index: number;
}) => {
  const setNum = summary.setId.replace('set', '');
  const bg = index % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
  const g = grade(summary.avgPercentage);
  const hasData = summary.totalAttempts > 0;

  return (
    <View style={[rowStyles.row, { backgroundColor: bg }]}>
      {/* Set number */}
      <View style={[rowStyles.setCell, { borderLeftWidth: 3, borderLeftColor: hasData ? catColor : '#E0E0E0' }]}>
        <Text style={rowStyles.setNum}>Set {setNum}</Text>
      </View>

      {/* Attempts */}
      <View style={rowStyles.cell}>
        <Text style={[rowStyles.cellText, !hasData && rowStyles.dimText]}>
          {hasData ? summary.totalAttempts : '—'}
        </Text>
      </View>

      {/* Best */}
      <View style={rowStyles.cell}>
        <Text style={[rowStyles.cellText, hasData && { color: '#00C853', fontWeight: '700' }]}>
          {hasData ? `${summary.bestPercentage}%` : '—'}
        </Text>
      </View>

      {/* Latest */}
      <View style={rowStyles.cell}>
        <Text style={[rowStyles.cellText, !hasData && rowStyles.dimText]}>
          {hasData ? `${summary.latestPercentage}%` : '—'}
        </Text>
      </View>

      {/* Avg + Grade */}
      <View style={[rowStyles.cell, rowStyles.avgCell]}>
        {hasData ? (
          <View style={[rowStyles.gradeBadge, { backgroundColor: `${g.color}20` }]}>
            <Text style={[rowStyles.gradeText, { color: g.color }]}>{g.label}</Text>
            <Text style={[rowStyles.avgPct, { color: g.color }]}>{summary.avgPercentage}%</Text>
          </View>
        ) : (
          <Text style={rowStyles.dimText}>—</Text>
        )}
      </View>
    </View>
  );
};

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  setCell: {
    width: 60,
    paddingVertical: 8,
    paddingLeft: 10,
    justifyContent: 'center',
  },
  setNum: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  cell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  avgCell: {
    flex: 1.3,
  },
  cellText: {
    fontSize: 12,
    color: '#444',
    textAlign: 'center',
  },
  dimText: {
    color: '#CCC',
    fontSize: 12,
    textAlign: 'center',
  },
  gradeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  gradeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  avgPct: {
    fontSize: 11,
    fontWeight: '600',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export const TriviaScoreboardScreen: React.FC<any> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const safeTopPadding = (insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44)) + 8;
  const safeBottomPadding = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 24 : 16);
  const [activeCategory, setActiveCategory] = useState<string>('polity');

  // Synchronously initialize from memory cache if available
  const initialCached = getCachedScoreboardDataSync(TRIVIA_SETS_PER_CATEGORY);
  const [allSummaries, setAllSummaries] = useState<Record<string, CategorySummary>>(
    initialCached?.summaries || {}
  );
  const [overallAvg, setOverallAvg] = useState<number>(initialCached?.overallAverage || 0);

  const loadData = useCallback(async () => {
    try {
      const { summaries, overallAverage } = await getFullScoreboardData(TRIVIA_SETS_PER_CATEGORY);
      setAllSummaries(summaries);
      setOverallAvg(overallAverage);
    } catch (e) {
      console.error('Failed to load scoreboard data:', e);
    }
  }, []);

  useEffect(() => {
    // Defer any native system bar operations until transition finishes
    const interactionPromise = InteractionManager.runAfterInteractions(() => {
      pinNavBarColor('#F8F9FA', false);
      loadData();
    });
    const timer = setTimeout(() => {
      loadData();
    }, 100);

    return () => {
      interactionPromise.cancel();
      clearTimeout(timer);
    };
  }, [loadData]);

  const handleClearScores = () => {
    Alert.alert(
      'Clear All Scores',
      'Are you sure? This will permanently delete all your trivia scores and history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearAllScores();
            await loadData();
          },
        },
      ],
    );
  };

  // Safe fallback if category has not loaded yet so layout never jumps/flickers
  const setsForActiveCat = TRIVIA_SETS_PER_CATEGORY[activeCategory] || [];
  const categorySummary: CategorySummary = allSummaries[activeCategory] || {
    category: activeCategory,
    sets: setsForActiveCat.map(setId => ({
      category: activeCategory,
      setId,
      attempts: [],
      bestPercentage: 0,
      latestPercentage: 0,
      avgPercentage: 0,
      totalAttempts: 0,
    })),
    overallAverage: 0,
    setsCompleted: 0,
    totalSets: setsForActiveCat.length,
  };

  const catConf = CAT_CONFIG[activeCategory] ?? { name: activeCategory, emoji: '📝', color: '#4597f5' };
  const overallGrade = grade(overallAvg);

  return (
    <View style={sb.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Header gradient ── */}
      <LinearGradient
        colors={['#1E3A5F', '#0A1628']}
        style={[
          sb.header,
          {
            paddingTop: safeTopPadding,
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
          },
        ]}
      >
        <TouchableOpacity style={sb.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Icon name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={sb.headerCenter}>
          <Text style={sb.headerTitle}>📊 Progress</Text>
          <Text style={sb.headerSub}>Track your mastery across all sets</Text>
        </View>

        {/* Overall average badge */}
        <View style={[sb.overallBadge, { borderColor: overallGrade.color }]}>
          <Text style={[sb.overallPct, { color: overallGrade.color }]}>{overallAvg}%</Text>
          <Text style={sb.overallLabel}>Overall</Text>
        </View>
      </LinearGradient>

      {/* ── Category tabs ── */}
      <View style={sb.tabsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={sb.tabsScroll}
        >
          {CATEGORY_ORDER.filter(c => TRIVIA_SETS_PER_CATEGORY[c]?.length > 0).map(catId => {
            const conf = CAT_CONFIG[catId] ?? { name: catId, emoji: '📝', color: '#4597f5' };
            const isActive = catId === activeCategory;
            return (
              <TouchableOpacity
                key={catId}
                onPress={() => setActiveCategory(catId)}
                style={[
                  sb.tab,
                  isActive && { backgroundColor: conf.color, borderColor: conf.color },
                ]}
                activeOpacity={0.8}
              >
                <Text style={[sb.tabEmoji]}>{conf.emoji}</Text>
                <Text style={[sb.tabText, isActive && { color: '#fff', fontWeight: '700' }]} numberOfLines={1}>
                  {conf.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Table area (Always stable, no layout jumps or flickers) ── */}
      <View style={sb.tableWrapper}>
        <ScrollView style={sb.tableScroll} showsVerticalScrollIndicator={false}>

          {/* Category summary bar */}
          <View style={[sb.catSummaryBar, { borderLeftColor: catConf.color }]}>
            <Text style={sb.catSummaryTitle}>
              {catConf.emoji}  {catConf.name}
            </Text>
            <View style={sb.catSummaryStats}>
              <View style={sb.statChip}>
                <Text style={sb.statChipValue}>{categorySummary.setsCompleted}/{categorySummary.totalSets}</Text>
                <Text style={sb.statChipLabel}>Sets Played</Text>
              </View>
              <View style={[sb.statChip, { backgroundColor: `${catConf.color}15` }]}>
                <Text style={[sb.statChipValue, { color: catConf.color }]}>
                  {categorySummary.overallAverage}%
                </Text>
                <Text style={sb.statChipLabel}>Category Avg</Text>
              </View>
              <View style={sb.statChip}>
                <Text style={[sb.statChipValue, { color: overallGrade.color }]}>{overallAvg}%</Text>
                <Text style={sb.statChipLabel}>Overall Avg</Text>
              </View>
            </View>
          </View>

          {/* Table header */}
          <View style={sb.tableHeader}>
            <View style={{ width: 60 }}>
              <Text style={sb.headerCell}>Set</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sb.headerCell, { textAlign: 'center' }]}>Tries</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sb.headerCell, { textAlign: 'center' }]}>Best</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sb.headerCell, { textAlign: 'center' }]}>Last</Text>
            </View>
            <View style={{ flex: 1.3 }}>
              <Text style={[sb.headerCell, { textAlign: 'center' }]}>Avg</Text>
            </View>
          </View>

          {/* Set rows */}
          {(categorySummary.sets ?? []).map((setSum, idx) => (
            <SetRow
              key={setSum.setId}
              summary={setSum}
              catColor={catConf.color}
              index={idx}
            />
          ))}

          {/* No data note */}
          {categorySummary.setsCompleted === 0 && (
            <View style={sb.emptyBox}>
              <Text style={sb.emptyEmoji}>🎯</Text>
              <Text style={sb.emptyText}>No scores yet for {catConf.name}.</Text>
              <Text style={sb.emptySubText}>Go to Challenge mode and play a round!</Text>
            </View>
          )}

          {/* Clear scores button */}
          <TouchableOpacity style={sb.clearBtn} onPress={handleClearScores} activeOpacity={0.8}>
            <Icon name="trash-outline" size={15} color="#FF3366" />
            <Text style={sb.clearBtnText}>Clear All Scores</Text>
          </TouchableOpacity>

          <View style={{ height: safeBottomPadding + 28 }} />
        </ScrollView>
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const sb = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 },
  overallBadge: {
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 60,
  },
  overallPct: { fontSize: 16, fontWeight: '900' },
  overallLabel: { fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Tabs
  tabsWrapper: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  tabsScroll: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    gap: 4,
  },
  tabEmoji: { fontSize: 14 },
  tabText: { fontSize: 12, color: '#555', fontWeight: '500' },

  // Table
  tableWrapper: { flex: 1 },
  tableScroll: { flex: 1 },

  // Category summary bar
  catSummaryBar: {
    margin: 12,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  catSummaryTitle: { fontSize: 15, fontWeight: '700', color: '#1E3A5F', marginBottom: 10 },
  catSummaryStats: { flexDirection: 'row', gap: 8 },
  statChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingVertical: 8,
  },
  statChipValue: { fontSize: 16, fontWeight: '800', color: '#1E3A5F' },
  statChipLabel: { fontSize: 9, color: '#999', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  // Table
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E3A5F',
    marginHorizontal: 12,
    borderRadius: 8,
    paddingVertical: 8,
    paddingLeft: 10,
    marginBottom: 0,
  },
  headerCell: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#333', textAlign: 'center' },
  emptySubText: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 6 },

  // Clear button
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 24,
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FF336620',
    backgroundColor: '#FFF0F3',
  },
  clearBtnText: { color: '#FF3366', fontSize: 13, fontWeight: '600' },
});

export default TriviaScoreboardScreen;
