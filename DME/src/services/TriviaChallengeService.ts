import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatAPI } from './api';
import { CustomTriviaSet } from './CustomTriviaStorage';

export const CHALLENGE_EXPIRY_HOURS = 24;
const CHALLENGES_STORAGE_KEY = '@trivia_active_challenges_v1';

export interface ChallengeLeaderboardEntry {
  userId: number | string;
  userName: string;
  userAvatar?: string;
  score: number;
  totalQuestions: number;
  timeTakenSeconds: number;
  percentage: number;
  submittedAt: string; // ISO
}

export interface TriviaChallengePayload {
  challengeId: string;
  title: string;
  description?: string;
  creatorId: number | string;
  creatorName: string;
  creatorAvatar?: string;
  createdAt: string; // ISO
  expiresAt: string; // ISO (createdAt + 24 hours)
  totalQuestions: number;
  timeLimitSeconds: number;
  graceSeconds: number;
  formattedTime: string;
  questions: any[];
  leaderboard: ChallengeLeaderboardEntry[];
  conversationId?: number;
}

/**
 * Smart Dynamic Quiz Timer Calculation:
 * - 48 seconds per question (minimum 2 minutes).
 * - Grace period = 12 seconds per question.
 */
export function calculateSmartQuizTime(questionCount?: number): {
  totalSeconds: number;
  formattedTime: string;
  graceSeconds: number;
} {
  const safeCount = Math.max(1, Number(questionCount) || 1);
  const totalSeconds = Math.max(120, safeCount * 48);
  const graceSeconds = Math.max(30, safeCount * 12);

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const formattedTime = secs > 0 ? `${mins}m ${secs}s` : `${mins} mins`;

  return { totalSeconds, formattedTime, graceSeconds };
}

/**
 * 24-Hour Expiry Status:
 * Returns whether the challenge has expired and formatted remaining time string.
 */
export function getChallengeExpiryStatus(createdAtIso: string): {
  isExpired: boolean;
  remainingText: string;
  remainingMs: number;
} {
  try {
    const created = new Date(createdAtIso).getTime();
    const expiry = created + CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    const diffMs = expiry - now;

    if (diffMs <= 0 || isNaN(diffMs)) {
      return { isExpired: true, remainingText: 'Expired', remainingMs: 0 };
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return { isExpired: false, remainingText: `${hours}h ${mins}m left`, remainingMs: diffMs };
    }
    return { isExpired: false, remainingText: `${mins}m left`, remainingMs: diffMs };
  } catch {
    return { isExpired: true, remainingText: 'Expired', remainingMs: 0 };
  }
}

/**
 * Build a standard Challenge Payload from a local custom set.
 */
export function createChallengePayload(
  customSet: CustomTriviaSet,
  user: { id?: number | string; username?: string; name?: string; avatar?: string } | null,
  conversationId?: number,
): TriviaChallengePayload {
  const questions = customSet?.questions || [];
  const questionCount = questions.length;
  const timing = calculateSmartQuizTime(questionCount);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000);
  const challengeId = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    challengeId,
    title: customSet?.name || 'Custom Quiz Contest',
    description: `Group Contest with ${questionCount} questions`,
    creatorId: user?.id || 'unknown',
    creatorName: user?.name || user?.username || 'Challenger',
    creatorAvatar: user?.avatar,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    totalQuestions: questionCount,
    timeLimitSeconds: timing.totalSeconds,
    graceSeconds: timing.graceSeconds,
    formattedTime: timing.formattedTime,
    questions,
    leaderboard: [],
    conversationId,
  };
}

/**
 * Retrieve all locally saved challenges.
 */
export async function getAllLocalChallenges(): Promise<Record<string, TriviaChallengePayload>> {
  try {
    const raw = await AsyncStorage.getItem(CHALLENGES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (error) {
    console.error('Error reading local challenges:', error);
    return {};
  }
}

/**
 * Save or update a challenge in local storage.
 */
export async function saveLocalChallenge(challenge: TriviaChallengePayload): Promise<void> {
  try {
    const all = await getAllLocalChallenges();
    all[challenge.challengeId] = challenge;
    await AsyncStorage.setItem(CHALLENGES_STORAGE_KEY, JSON.stringify(all));
  } catch (error) {
    console.error('Error saving local challenge:', error);
  }
}

/**
 * Submit score to a challenge's leaderboard.
 * Sorts leaderboard by:
 * 1. Score DESC (higher score wins)
 * 2. timeTakenSeconds ASC (faster time wins tie-break)
 * Broadcasts score to the group/chat if conversationId is set.
 */
export async function submitChallengeScore(
  challengeId: string,
  entry: ChallengeLeaderboardEntry,
  broadcastToChat: boolean = true,
): Promise<TriviaChallengePayload | null> {
  try {
    const all = await getAllLocalChallenges();
    const challenge = all[challengeId];
    if (!challenge) return null;

    // Filter out previous submission from the same user or replace if higher
    const existingIndex = challenge.leaderboard.findIndex(
      e => String(e.userId) === String(entry.userId),
    );

    if (existingIndex >= 0) {
      const existing = challenge.leaderboard[existingIndex];
      // Only replace if new score is better or same score with faster time
      if (
        entry.score > existing.score ||
        (entry.score === existing.score && entry.timeTakenSeconds < existing.timeTakenSeconds)
      ) {
        challenge.leaderboard[existingIndex] = entry;
      }
    } else {
      challenge.leaderboard.push(entry);
    }

    // Sort leaderboard: Score DESC, then Time ASC
    challenge.leaderboard.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.timeTakenSeconds - b.timeTakenSeconds;
    });

    all[challengeId] = challenge;
    await AsyncStorage.setItem(CHALLENGES_STORAGE_KEY, JSON.stringify(all));

    // Broadcast score submission to the conversation so all participants' leaderboards update!
    if (broadcastToChat && challenge.conversationId) {
      try {
        const broadcastMsg = `${TRIVIA_SCORE_SUBMISSION_PREFIX}${JSON.stringify({
          challengeId,
          entry,
        })}`;
        await chatAPI.sendMessage(Number(challenge.conversationId), broadcastMsg, 'text');
      } catch (broadcastErr) {
        console.error('Error broadcasting challenge score to conversation:', broadcastErr);
      }
    }

    return challenge;
  } catch (error) {
    console.error('Error submitting challenge score:', error);
    return null;
  }
}

export const TRIVIA_CHALLENGE_PREFIX = '[TRIVIA_CHALLENGE]:';
export const TRIVIA_SCORE_SUBMISSION_PREFIX = '[TRIVIA_SCORE_SUBMISSION]:';

/**
 * Check whether a chat message is a Trivia Challenge
 */
export function isTriviaChallengeMessage(message: any): boolean {
  if (!message) return false;
  if (message.message_type === 'trivia_challenge') return true;
  if (typeof message.content === 'string') {
    if (message.content.startsWith(TRIVIA_CHALLENGE_PREFIX)) return true;
    if (message.content.includes('"challengeId"') && message.content.includes('"leaderboard"')) return true;
  }
  return false;
}

/**
 * Check whether a chat message is a Trivia Score Submission
 */
export function isScoreSubmissionMessage(message: any): boolean {
  if (!message) return false;
  if (typeof message.content === 'string') {
    if (message.content.startsWith(TRIVIA_SCORE_SUBMISSION_PREFIX)) return true;
    if (message.content.includes(TRIVIA_SCORE_SUBMISSION_PREFIX)) return true;
    if (message.content.includes('"challengeId"') && message.content.includes('"entry"')) return true;
  }
  return false;
}

/**
 * Safely parse Score Submission from content string
 */
export function getScoreSubmissionFromContent(
  content: string,
): { challengeId: string; entry: ChallengeLeaderboardEntry } | null {
  if (!content || typeof content !== 'string') return null;
  try {
    let raw = content.trim();
    if (raw.startsWith(TRIVIA_SCORE_SUBMISSION_PREFIX)) {
      raw = raw.substring(TRIVIA_SCORE_SUBMISSION_PREFIX.length).trim();
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.challengeId && parsed.entry) {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * Safely parse Trivia Challenge Payload from content string
 */
export function getChallengePayloadFromContent(content: string): TriviaChallengePayload | null {
  if (!content || typeof content !== 'string') return null;
  try {
    let raw = content.trim();
    if (raw.startsWith(TRIVIA_CHALLENGE_PREFIX)) {
      raw = raw.substring(TRIVIA_CHALLENGE_PREFIX.length).trim();
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.challengeId) {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * Sync a challenge or score update from a message
 */
export async function syncChallengeFromMessage(content: string, conversationId?: number): Promise<void> {
  if (!content) return;
  try {
    // 1. Check if it's a Challenge definition
    if (content.startsWith(TRIVIA_CHALLENGE_PREFIX) || (content.includes('"challengeId"') && content.includes('"questions"'))) {
      const payload = getChallengePayloadFromContent(content);
      if (payload) {
        const all = await getAllLocalChallenges();
        const existing = all[payload.challengeId];
        if (existing) {
          // Merge leaderboards preserving all submitted scores
          const combinedLeaderboard = [...(existing.leaderboard || [])];
          (payload.leaderboard || []).forEach(incomingEntry => {
            const idx = combinedLeaderboard.findIndex(e => String(e.userId) === String(incomingEntry.userId));
            if (idx >= 0) {
              if (incomingEntry.score > combinedLeaderboard[idx].score) {
                combinedLeaderboard[idx] = incomingEntry;
              }
            } else {
              combinedLeaderboard.push(incomingEntry);
            }
          });
          combinedLeaderboard.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.timeTakenSeconds - b.timeTakenSeconds));
          all[payload.challengeId] = {
            ...payload,
            conversationId: conversationId || payload.conversationId || existing.conversationId,
            leaderboard: combinedLeaderboard,
          };
        } else {
          all[payload.challengeId] = {
            ...payload,
            conversationId: conversationId || payload.conversationId,
          };
        }
        await AsyncStorage.setItem(CHALLENGES_STORAGE_KEY, JSON.stringify(all));
      }
    }

    // 2. Check if it's a Score Submission
    if (content.startsWith(TRIVIA_SCORE_SUBMISSION_PREFIX)) {
      const scoreData = getScoreSubmissionFromContent(content);
      if (scoreData) {
        await submitChallengeScore(scoreData.challengeId, scoreData.entry, false);
      }
    }
  } catch (err) {
    console.error('Error syncing challenge from message:', err);
  }
}

/**
 * Scan conversations and sync all active challenges and scores
 */
export async function syncChallengesFromAllConversations(): Promise<TriviaChallengePayload[]> {
  try {
    const convsRes = await chatAPI.getConversations();
    const convs = Array.isArray(convsRes)
      ? convsRes
      : Array.isArray(convsRes?.results)
      ? convsRes.results
      : Array.isArray(convsRes?.data)
      ? convsRes.data
      : [];

    for (const conv of convs) {
      if (!conv || !conv.id) continue;
      // If last message has challenge or score info
      if (conv.last_message) {
        const content = typeof conv.last_message === 'string' ? conv.last_message : conv.last_message.content;
        if (content) {
          await syncChallengeFromMessage(content, conv.id);
        }
      }
    }

    const all = await getAllLocalChallenges();
    return Object.values(all);
  } catch (error) {
    console.error('Error syncing challenges from conversations:', error);
    const all = await getAllLocalChallenges();
    return Object.values(all);
  }
}

/**
 * Delete a challenge from local storage.
 */
export async function deleteLocalChallenge(challengeId: string): Promise<void> {
  try {
    const all = await getAllLocalChallenges();
    delete all[challengeId];
    await AsyncStorage.setItem(CHALLENGES_STORAGE_KEY, JSON.stringify(all));
  } catch (error) {
    console.error('Error deleting local challenge:', error);
  }
}

/**
 * Send a challenge message into a conversation (Direct or Group chat).
 * Uses 'text' message_type with prefix to ensure 100% backend compatibility.
 */
export async function sendChallengeToConversation(
  conversationId: number,
  challengePayload: TriviaChallengePayload,
): Promise<any> {
  try {
    // 1. Save locally
    await saveLocalChallenge({ ...challengePayload, conversationId });

    // 2. Send via chat API with standard 'text' message_type and challenge prefix
    const messageContent = `${TRIVIA_CHALLENGE_PREFIX}${JSON.stringify(challengePayload)}`;
    const result = await chatAPI.sendMessage(conversationId, messageContent, 'text');
    return result;
  } catch (error) {
    console.error('Error sending challenge to conversation:', error);
    throw error;
  }
}
