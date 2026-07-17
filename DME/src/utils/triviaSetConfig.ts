/**
 * triviaSetConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central config: maps every category → its available set IDs.
 * Derived from the actual question JSON files.
 *
 * Update this file if you add new sets to the JSON assets.
 */

// All 20 standard sets
const STANDARD_SETS = [
  'set1','set2','set3','set4','set5',
  'set6','set7','set8','set9','set10',
  'set11','set12','set13','set14','set15',
  'set16','set17','set18','set19','set20',
];

/**
 * Maps category ID → array of available set IDs.
 * Used by:
 *  - TriviaScoreDB.pickNextSet() (cycle management)
 *  - TriviaScoreboardScreen (table rows)
 *  - TriviaSoloScreen (challenge mode set loading)
 */
export const TRIVIA_SETS_PER_CATEGORY: Record<string, string[]> = {
  current_affairs: STANDARD_SETS,
  polity:          STANDARD_SETS,
  history:         STANDARD_SETS,
  geography:       STANDARD_SETS,
  science:         STANDARD_SETS,
  economy:         STANDARD_SETS,
  reasoning:       STANDARD_SETS,
  aptitude:        STANDARD_SETS,
  technology:      STANDARD_SETS,
  literature:      STANDARD_SETS,
  // 'any' is a meta-category — no fixed sets
};

/**
 * Returns a numerically sorted list of set IDs for a category.
 * e.g. ['set1','set2',...,'set20']
 */
export function getSetsForCategory(category: string): string[] {
  const sets = TRIVIA_SETS_PER_CATEGORY[category] ?? [];
  return [...sets].sort((a, b) => {
    const na = parseInt(a.replace('set', ''), 10);
    const nb = parseInt(b.replace('set', ''), 10);
    return na - nb;
  });
}

/**
 * Given a set of question objects, return all unique set IDs present.
 */
export function extractSetIds(questions: Array<{ set?: string }>): string[] {
  const ids = new Set<string>();
  questions.forEach(q => { if (q.set) ids.add(q.set); });
  return [...ids].sort((a, b) => {
    const na = parseInt(a.replace('set', ''), 10);
    const nb = parseInt(b.replace('set', ''), 10);
    return na - nb;
  });
}
