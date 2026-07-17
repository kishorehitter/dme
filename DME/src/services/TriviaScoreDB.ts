/**
 * TriviaScoreDB.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Offline-only AsyncStorage database for tracking trivia set scores.
 *
 * Schema (stored as JSON in AsyncStorage):
 *
 *   Key: "trivia_score_db"
 *   Value: TriviaScoreDB
 *
 * TriviaScoreDB = {
 *   sets: {
 *     "<category>/<setId>": SetRecord[]   // array of attempt records
 *   },
 *   cycleState: {
 *     "<category>": {
 *       usedSets: string[]   // set IDs already played in current cycle
 *       totalSetsInCycle: number
 *     }
 *   }
 * }
 *
 * SetRecord = { date, correctAnswers, totalQuestions, score, maxScore, percentage }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DB_KEY = 'trivia_score_db_v1';

export interface SetRecord {
  date: string;           // ISO string
  correctAnswers: number;
  totalQuestions: number;
  score: number;          // raw points earned
  maxScore: number;       // max possible points
  percentage: number;     // 0-100
  timeTakenSeconds?: number;
}

export interface SetSummary {
  category: string;
  setId: string;
  attempts: SetRecord[];
  bestPercentage: number;   // best score %
  latestPercentage: number; // last attempt %
  avgPercentage: number;    // overall average
  totalAttempts: number;
}

export interface CategorySummary {
  category: string;
  sets: SetSummary[];
  overallAverage: number;   // average across all attempted sets
  setsCompleted: number;    // sets with at least 1 attempt
  totalSets: number;
}

interface CycleState {
  usedSets: string[];
  totalSetsInCycle: number;
}

interface DBData {
  sets: Record<string, SetRecord[]>; // key = "category/setId"
  cycleState: Record<string, CycleState>; // key = category
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptyDB = (): DBData => ({ sets: {}, cycleState: {} });

async function loadDB(): Promise<DBData> {
  try {
    const raw = await AsyncStorage.getItem(DB_KEY);
    if (!raw) return emptyDB();
    return JSON.parse(raw) as DBData;
  } catch {
    return emptyDB();
  }
}

async function saveDB(db: DBData): Promise<void> {
  await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pick the next set to play for a given category.
 * - Uses a cycle: each set is played once before any repeats.
 * - When all sets have been played, the cycle resets.
 * - Returns the chosen setId.
 *
 * @param category - category id e.g. "polity"
 * @param allSetsInCategory - all available set ids for this category e.g. ["set1","set2",...]
 */
export async function pickNextSet(
  category: string,
  allSetsInCategory: string[],
): Promise<string> {
  if (allSetsInCategory.length === 0) return 'set1';

  const db = await loadDB();

  let cycleState = db.cycleState[category] ?? { usedSets: [], totalSetsInCycle: allSetsInCategory.length };

  // Reset cycle if all sets are used
  if (cycleState.usedSets.length >= allSetsInCategory.length) {
    cycleState = { usedSets: [], totalSetsInCycle: allSetsInCategory.length };
  }

  // Available sets = all sets minus already used ones this cycle
  const available = allSetsInCategory.filter(s => !cycleState.usedSets.includes(s));

  // Shuffle and pick one
  const shuffled = available.sort(() => Math.random() - 0.5);
  const chosen = shuffled[0];

  // Mark it as used
  cycleState.usedSets.push(chosen);

  db.cycleState[category] = cycleState;
  await saveDB(db);

  return chosen;
}

/**
 * Save a completed attempt for a set.
 */
export async function saveSetScore(
  category: string,
  setId: string,
  record: SetRecord,
): Promise<void> {
  const db = await loadDB();
  const key = `${category}/${setId}`;
  if (!db.sets[key]) db.sets[key] = [];
  db.sets[key].push(record);
  await saveDB(db);
}

/**
 * Get all records for a specific set.
 */
export async function getSetRecords(
  category: string,
  setId: string,
): Promise<SetRecord[]> {
  const db = await loadDB();
  return db.sets[`${category}/${setId}`] ?? [];
}

/**
 * Get full summary for a category — all sets with their scores.
 */
export async function getCategorySummary(
  category: string,
  allSetsInCategory: string[],
): Promise<CategorySummary> {
  const db = await loadDB();
  let overallSum = 0;
  let attemptedCount = 0;

  const sets: SetSummary[] = allSetsInCategory.map(setId => {
    const records = db.sets[`${category}/${setId}`] ?? [];
    const totalAttempts = records.length;
    const pcts = records.map(r => r.percentage);
    const bestPercentage = pcts.length > 0 ? Math.max(...pcts) : 0;
    const latestPercentage = pcts.length > 0 ? pcts[pcts.length - 1] : 0;
    const avgPercentage = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;

    if (totalAttempts > 0) {
      overallSum += avgPercentage;
      attemptedCount++;
    }

    return {
      category,
      setId,
      attempts: records,
      bestPercentage,
      latestPercentage,
      avgPercentage,
      totalAttempts,
    };
  });

  return {
    category,
    sets,
    overallAverage: attemptedCount > 0 ? Math.round(overallSum / attemptedCount) : 0,
    setsCompleted: attemptedCount,
    totalSets: allSetsInCategory.length,
  };
}

/**
 * Get all category summaries (for the full scoreboard).
 */
export async function getAllCategorySummaries(
  setsPerCategory: Record<string, string[]>,
): Promise<CategorySummary[]> {
  const results: CategorySummary[] = [];
  for (const [cat, sets] of Object.entries(setsPerCategory)) {
    results.push(await getCategorySummary(cat, sets));
  }
  return results;
}

/**
 * Get the current cycle state for a category.
 * Used to show "X of Y sets played in current cycle"
 */
export async function getCycleState(category: string): Promise<CycleState | null> {
  const db = await loadDB();
  return db.cycleState[category] ?? null;
}

/**
 * Compute overall average % across ALL categories and sets.
 */
export async function getOverallAverage(
  setsPerCategory: Record<string, string[]>,
): Promise<number> {
  const summaries = await getAllCategorySummaries(setsPerCategory);
  const attempted = summaries.filter(s => s.setsCompleted > 0);
  if (attempted.length === 0) return 0;
  const sum = attempted.reduce((a, s) => a + s.overallAverage, 0);
  return Math.round(sum / attempted.length);
}

/**
 * Wipe all score data (for testing).
 */
export async function clearAllScores(): Promise<void> {
  await AsyncStorage.removeItem(DB_KEY);
}
