import AsyncStorage from '@react-native-async-storage/async-storage';
import { Question } from '../utils/customQuestionParser';

export interface CustomTriviaSet {
  id: string;              // "custom_1692345678"
  name: string;            // User-defined name e.g. "My History Quiz"
  createdAt: string;       // ISO date string
  questionCount: number;   // Total questions count
  questions: Question[];   // Parsed question items
}

const STORAGE_KEY = 'custom_trivia_sets_v1';

/**
 * Retrieve all saved custom question sets from AsyncStorage.
 */
export async function getCustomSets(): Promise<CustomTriviaSet[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading custom trivia sets:', error);
    return [];
  }
}

/**
 * Save a new custom trivia set.
 */
export async function saveCustomSet(name: string, questions: Question[]): Promise<CustomTriviaSet> {
  try {
    const existing = await getCustomSets();
    const setId = `custom_${Date.now()}`;
    
    // Tag questions with set ID
    const taggedQuestions = questions.map(q => ({
      ...q,
      category: 'custom',
      set: setId,
    }));

    const newSet: CustomTriviaSet = {
      id: setId,
      name: name.trim() || 'Custom Quiz Set',
      createdAt: new Date().toISOString(),
      questionCount: taggedQuestions.length,
      questions: taggedQuestions,
    };

    const updated = [newSet, ...existing];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return newSet;
  } catch (error) {
    console.error('Error saving custom trivia set:', error);
    throw error;
  }
}

/**
 * Delete a custom trivia set by ID.
 */
export async function deleteCustomSet(setId: string): Promise<void> {
  try {
    const existing = await getCustomSets();
    const filtered = existing.filter(s => s.id !== setId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting custom trivia set:', error);
    throw error;
  }
}

/**
 * Update an existing custom trivia set by ID.
 */
export async function updateCustomSet(
  setId: string,
  name: string,
  questions: Question[],
): Promise<CustomTriviaSet> {
  try {
    const existing = await getCustomSets();
    const targetIndex = existing.findIndex(s => s.id === setId);
    if (targetIndex === -1) {
      throw new Error(`Quiz set with ID ${setId} not found`);
    }

    const taggedQuestions = questions.map(q => ({
      ...q,
      category: 'custom',
      set: setId,
    }));

    const updatedSet: CustomTriviaSet = {
      ...existing[targetIndex],
      name: name.trim() || 'Custom Quiz Set',
      questionCount: taggedQuestions.length,
      questions: taggedQuestions,
    };

    existing[targetIndex] = updatedSet;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    return updatedSet;
  } catch (error) {
    console.error('Error updating custom trivia set:', error);
    throw error;
  }
}

/**
 * Get a specific custom set by ID.
 */
export async function getCustomSetById(setId: string): Promise<CustomTriviaSet | null> {
  const allSets = await getCustomSets();
  return allSets.find(s => s.id === setId) || null;
}
