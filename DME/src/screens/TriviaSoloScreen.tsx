import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  Platform,
  Dimensions,
  Animated,
  StatusBar,
  ScrollView,
  FlatList,
  BackHandler,
  Modal,
  NativeModules,
  ActivityIndicator,
  Image,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AvatarWithFallback from '../components/AvatarWithFallback';
import { resolveImageUrl } from '../utils/image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import Sound from 'react-native-sound';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, spacing, borderRadius } from '../utils/theme';
import englishQuestions from '../assets/trivia_questions.json';
import tamilQuestions from '../assets/trivia_questions_tamil.json';
import englishCurrentAffairs from '../assets/current_affairs.json';
import tamilCurrentAffairs from '../assets/current_affairs_tamil.json';
import { pinNavBarColor } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import ViewShot from 'react-native-view-shot';
import Toast from 'react-native-toast-message';
import { StatusService } from '../services/StatusService';
import { chatAPI, triviaAPI } from '../services/api';
import { pickNextSet, saveSetScore, getCategorySummary } from '../services/TriviaScoreDB';
import { getSetsForCategory, TRIVIA_SETS_PER_CATEGORY } from '../utils/triviaSetConfig';
import { useAuth } from '../context/AuthContext';

const { width, height: SCREEN_H } = Dimensions.get('window');

// Enable playing sound in silence mode (iOS)
Sound.setCategory('Playback');

const AVATAR_COLORS = [
  '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', 
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50', 
  '#8BC34A', '#FF9800', '#FF5722', '#795548', '#607D8B'
];

const getAvatarColor = (name: string) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

interface Question {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty: string;
  category: string;
  originalIndex?: number;
  isCurrentAffairs?: boolean;
}

// 11 Categories configuration
const CATEGORIES = [
  { id: 'current_affairs', name: 'Current Affairs', nameTa: 'நடப்பு நிகழ்வுகள்', emoji: '🔥', icon: 'newspaper', color: '#FF758F', desc: 'Recent events & news' },
  { id: 'polity', name: 'Polity', nameTa: 'ஆட்சி அமைப்பு', emoji: '🏛️', icon: 'school', color: '#FFB703', desc: 'Constitution & governance' },
  { id: 'history', name: 'History', nameTa: 'வரலாறு', emoji: '📜', icon: 'library', color: '#F77F00', desc: 'Historical events & history' },
  { id: 'geography', name: 'Geography', nameTa: 'புவியியல்', emoji: '🌍', icon: 'earth', color: '#00B4D8', desc: 'Rivers, oceans & terrains' },
  { id: 'science', name: 'Science', nameTa: 'அறிவியல்', emoji: '🔬', icon: 'flask', color: '#4DEEEA', desc: 'Physics, chemistry & biology' },
  { id: 'economy', name: 'Economy', nameTa: 'பொருளாதாரம்', emoji: '💰', icon: 'cash', color: '#70E000', desc: 'Economics & financial facts' },
  { id: 'reasoning', name: 'Reasoning', nameTa: 'மனத்திறன்', emoji: '🧠', icon: 'bulb', color: '#B388FF', desc: 'Logical & analytical puzzles' },
  { id: 'aptitude', name: 'Aptitude', nameTa: 'கணிதத்திறன்', emoji: '➗', icon: 'calculator', color: '#00F5D4', desc: 'Mathematics & aptitude' },
  { id: 'technology', name: 'Technology', nameTa: 'தொழில்நுட்பம்', emoji: '💻', icon: 'laptop', color: '#4597f5', desc: 'Computers, internet & coding' },
  { id: 'literature', name: 'Literature', nameTa: 'தமிழ் மொழி & இலக்கியம்', emoji: '📚', icon: 'book', color: '#E07A5F', desc: 'Tamil language & literature' },
  { id: 'any', name: 'All', nameTa: 'அனைத்தும்', emoji: '🎲', icon: 'shuffle', color: '#8D99AE', desc: 'A random mixture of all categories' },
];

// Helper to get points based on difficulty
const getPointsForDifficulty = (diff: string): number => {
  if (!diff) return 1;
  switch (diff.toLowerCase()) {
    case 'hard': return 3;
    case 'medium': return 2;
    case 'easy':
    default: return 1;
  }
};

// Cache to store prep progress per category (persists during app run time)
const categoryPrepCache: Record<string, {
  viewedSet: Set<number>;
  revealedSet: Set<number>;
  lastIndex: number;
  questions: Question[];
}> = {};

export const TriviaSoloScreen: React.FC<any> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { user } = useAuth();
  // Game states
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [timeLeft, setTimeLeft] = useState(720);
  const [gracePeriodUsed, setGracePeriodUsed] = useState(false);
  const [showGraceModal, setShowGraceModal] = useState(false);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'welcome' | 'categorySelect' | 'prepare' | 'playing' | 'summary'>('categorySelect');
  const [selectedCategory, setSelectedCategory] = useState<string>('any');
  const [language, setLanguage] = useState<'english' | 'tamil'>('english');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [exitModalVisible, setExitModalVisible] = useState(false);
  const [viewedSet, setViewedSet] = useState<Set<number>>(new Set());
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set());
  const [flatListHeight, setFlatListHeight] = useState(SCREEN_H);
  const [initialIndex, setInitialIndex] = useState(0);
  const [activeSetId, setActiveSetId] = useState<string>('');
  const [categoryAvgScore, setCategoryAvgScore] = useState<number>(0);
  const gameStartTimeRef = useRef<number>(Date.now());

  // ── Multi-Set / Question Count feature ────────────────────────────────────
  const [questionCountModal, setQuestionCountModal] = useState(false);
  const [selectedQuestionCount, setSelectedQuestionCount] = useState<15 | 30 | 45>(15);
  // multiSetQuestions holds the full combined question array split by set
  // e.g. [[...15 Qs set1], [...15 Qs set2], [...15 Qs set3]]
  const [multiSetQuestions, setMultiSetQuestions] = useState<Question[][]>([]);
  // which set index (0-based) we are currently playing
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  // Per-set score results stored as we complete each set
  interface SetResult { setId: string; score: number; maxScore: number; correct: number; total: number; }
  const [setResults, setSetResults] = useState<SetResult[]>([]);
  // The set IDs selected for the current multi-set game
  const [activeSetIds, setActiveSetIds] = useState<string[]>([]);
  
  // Challenge Friends Modal
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const [friendsList, setFriendsList] = useState<any[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [challengingFriendId, setChallengingFriendId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentFriendIds, setRecentFriendIds] = useState<number[]>([]);

  // Sharing States
  const viewShotRef = useRef<ViewShot>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareTab, setShareTab] = useState<'chat' | 'status'>('chat');
  const [sharingToFriendId, setSharingToFriendId] = useState<number | null>(null);
  const [statusUploading, setStatusUploading] = useState(false);

  // Category ScrollView ref and offsets for dynamic scrolling
  const categoryScrollViewRef = useRef<ScrollView>(null);
  const tabOffsets = useRef<{[key: string]: number}>({}).current;

  useEffect(() => {
    if (gameState === 'playing' && selectedCategory) {
      const timer = setTimeout(() => {
        const offset = tabOffsets[selectedCategory];
        if (offset !== undefined && categoryScrollViewRef.current) {
          categoryScrollViewRef.current.scrollTo({
            x: Math.max(0, offset - width / 2 + 60),
            animated: true,
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [selectedCategory, gameState]);

  const openShareModal = async () => {
    setShareModalVisible(true);
    setShareTab('chat');
    setIsLoadingFriends(true);
    setSearchQuery('');
    try {
      const data = await chatAPI.getFriends();
      setFriendsList(data);

      const stored = await AsyncStorage.getItem('@trivia_recent_friends');
      if (stored) {
        setRecentFriendIds(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error fetching friends for sharing:', error);
      Toast.show({ type: 'error', text1: 'Failed to load friends' });
    } finally {
      setIsLoadingFriends(false);
    }
  };

  const shareToFriend = async (friendId: number) => {
    if (!viewShotRef.current || !viewShotRef.current.capture) return;
    setSharingToFriendId(friendId);
    try {
      const uri = await viewShotRef.current.capture();
      const conversation = await chatAPI.getOrCreateDirectChat(friendId);
      
      const file = {
        uri: uri,
        type: 'image/jpeg',
        name: `trivia_scorecard_${Date.now()}.jpg`,
      };
      
      await chatAPI.sendMediaMessage(
        conversation.id,
        file,
        'image',
        "Check out my new Trivia Scorecard! ⚔️"
      );

      const newRecent = [friendId, ...recentFriendIds.filter(id => id !== friendId)].slice(0, 10);
      setRecentFriendIds(newRecent);
      await AsyncStorage.setItem('@trivia_recent_friends', JSON.stringify(newRecent));

      Toast.show({
        type: 'success',
        text1: 'Scorecard Shared! 💬',
        text2: 'Sent directly to your chat room.',
      });
      setShareModalVisible(false);
    } catch (error) {
      console.error('Error sharing scorecard to friend:', error);
      Toast.show({ type: 'error', text1: 'Failed to share scorecard' });
    } finally {
      setSharingToFriendId(null);
    }
  };

  const shareToStatus = async () => {
    if (!viewShotRef.current || !viewShotRef.current.capture) return;
    setStatusUploading(true);
    try {
      const uri = await viewShotRef.current.capture();
      await StatusService.saveStatus(uri, "", 'photo', []);
      Toast.show({
        type: 'success',
        text1: 'Status Posted! 📝',
        text2: 'Score shared to your Status!',
      });
      setShareModalVisible(false);
    } catch (e) {
      console.error('Error posting status:', e);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Could not share status.',
      });
    } finally {
      setStatusUploading(false);
    }
  };

  const openChallengeFriends = async () => {
    setFriendsModalVisible(true);
    setIsLoadingFriends(true);
    setSearchQuery('');
    try {
      const data = await chatAPI.getFriends();
      setFriendsList(data);

      const stored = await AsyncStorage.getItem('@trivia_recent_friends');
      if (stored) {
        setRecentFriendIds(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error fetching friends:', error);
      Toast.show({ type: 'error', text1: 'Failed to load friends' });
    } finally {
      setIsLoadingFriends(false);
    }
  };

  const sendChallenge = async (friendId: number) => {
    setChallengingFriendId(friendId);
    const activeCategoryConfig = CATEGORIES.find(c => c.id === selectedCategory) || CATEGORIES[0];
    try {
      await triviaAPI.createChallenge(friendId, activeCategoryConfig.id, activeSetId);

      // Save recent challenged friend
      const newRecent = [friendId, ...recentFriendIds.filter(id => id !== friendId)].slice(0, 10);
      setRecentFriendIds(newRecent);
      await AsyncStorage.setItem('@trivia_recent_friends', JSON.stringify(newRecent));

      Toast.show({
        type: 'success',
        text1: 'Challenge Sent! ⚔️',
        text2: `FCM push notification sent to their device!`,
      });
      setFriendsModalVisible(false);
    } catch (error) {
      console.error('Error sending challenge:', error);
      Toast.show({ type: 'error', text1: 'Failed to send challenge' });
    } finally {
      setChallengingFriendId(null);
    }
  };

  const toggleLanguage = (newLang: 'english' | 'tamil') => {
    if (newLang === language) return;
    setLanguage(newLang);
    const nextTriviaSource = newLang === 'tamil' ? tamilQuestions : englishQuestions;
    const nextCurrentAffairsSource = newLang === 'tamil' ? tamilCurrentAffairs : englishCurrentAffairs;
    
    const updatedQuestions = questions.map((q) => {
      const source = q.isCurrentAffairs ? nextCurrentAffairsSource : nextTriviaSource;
      const newQ = source[q.originalIndex ?? 0];
      return {
        ...newQ,
        originalIndex: q.originalIndex,
        isCurrentAffairs: q.isCurrentAffairs,
      };
    });
    setQuestions(updatedQuestions as Question[]);

    // Update prep cache if it exists
    const targetCategory = selectedCategory;
    if (categoryPrepCache[targetCategory]) {
      categoryPrepCache[targetCategory].questions = updatedQuestions as Question[];
    }
  };

  const switchCategoryDuringGame = (newCategoryId: string) => {
    setSelectedCategory(newCategoryId);

    const sourceQuestions = language === 'tamil' ? tamilQuestions : englishQuestions;
    const currentAffairsSource = language === 'tamil' ? tamilCurrentAffairs : englishCurrentAffairs;

    const questionsWithIndices = (newCategoryId === 'current_affairs' ? currentAffairsSource : sourceQuestions).map((q, idx) => ({
      ...q,
      originalIndex: idx,
      isCurrentAffairs: newCategoryId === 'current_affairs',
    }));

    // 1. Get answered questions so far
    const answeredQuestions = questions.slice(0, currentIndex);
    const answeredIds = new Set(answeredQuestions.map(q => q.id));

    // 2. Count difficulties of answered questions
    let easyCount = 0;
    let mediumCount = 0;
    let hardCount = 0;
    answeredQuestions.forEach((q) => {
      const diff = q.difficulty?.toLowerCase();
      if (diff === 'easy') easyCount++;
      else if (diff === 'medium') mediumCount++;
      else if (diff === 'hard') hardCount++;
    });

    const easyNeeded = Math.max(0, 5 - easyCount);
    const mediumNeeded = Math.max(0, 5 - mediumCount);
    const hardNeeded = Math.max(0, 5 - hardCount);
    const totalNeeded = 15 - currentIndex;

    // 3. Get pool of new category (excluding already answered questions)
    let newCategoryPool = questionsWithIndices.filter(
      (q: any) => !answeredIds.has(q.id) && 
      (newCategoryId === 'any' || newCategoryId === 'current_affairs' || (q.category && q.category.toLowerCase() === newCategoryId.toLowerCase())) &&
      (activeSetId && activeSetId !== 'mixed' ? q.set === activeSetId : true)
    );

    if (newCategoryPool.length === 0) {
      newCategoryPool = [...questionsWithIndices].filter((q: any) => !answeredIds.has(q.id));
    }

    // 4. Fetch the needed difficulties
    const getQs = (pool: any[], diff: string, count: number) => {
      return pool.filter((q: any) => q.difficulty && q.difficulty.toLowerCase() === diff)
                 .sort(() => 0.5 - Math.random())
                 .slice(0, count);
    };

    let newEasy = getQs(newCategoryPool, 'easy', easyNeeded);
    let newMedium = getQs(newCategoryPool, 'medium', mediumNeeded);
    let newHard = getQs(newCategoryPool, 'hard', hardNeeded);

    let newQs = [...newEasy, ...newMedium, ...newHard];

    // If pool was too small, backfill from the rest of the new category pool
    if (newQs.length < totalNeeded) {
      const currentNewIds = new Set(newQs.map(q => q.id));
      const remainingPool = newCategoryPool.filter(q => !currentNewIds.has(q.id));
      const extra = remainingPool.sort(() => 0.5 - Math.random()).slice(0, totalNeeded - newQs.length);
      newQs = [...newQs, ...extra];
    }

    // Shuffle the remaining questions
    newQs = newQs.sort(() => 0.5 - Math.random()).slice(0, totalNeeded);

    // 5. Merge and update questions & selectedIndices
    const updatedQuestions = [...answeredQuestions, ...newQs];
    setQuestions(updatedQuestions as Question[]);
    setSelectedIndices(updatedQuestions.map((q: any) => q.originalIndex));
  };

  // Hardware back button behavior during gameplay
  useEffect(() => {
    if (route.params?.challengeCategory && route.params?.challengeSet) {
      setSelectedCategory(route.params.challengeCategory);
      startNewGame(route.params.challengeCategory, route.params.challengeSet, true);
      // Clear params to prevent re-triggering
      navigation.setParams({ challengeCategory: undefined, challengeSet: undefined });
    }
  }, [route.params?.challengeCategory, route.params?.challengeSet]);

  // Handle deep-link challenge token (one-time link)
  useEffect(() => {
    const token = route.params?.challengeToken;
    if (!token) return;

    // Claim the token immediately
    (async () => {
      try {
        const response = await triviaAPI.claimChallenge(token);
        setSelectedCategory(response.category);
        startNewGame(response.category, response.set_id, true);
        Toast.show({
          type: 'success',
          text1: '⚔️ Challenge Accepted!',
          text2: `From ${response.challenger_name} — Good luck!`,
        });
      } catch (err: any) {
        const msg = err?.response?.data?.error || 'This challenge link is no longer valid.';
        Toast.show({ type: 'error', text1: '⚔️ Challenge Unavailable', text2: msg });
      } finally {
        navigation.setParams({ challengeToken: undefined });
      }
    })();
  }, [route.params?.challengeToken]);

  useEffect(() => {
    const backAction = () => {
      if (gameState === 'playing') {
        setExitModalVisible(true);
        return true;
      }
      if (gameState === 'prepare') {
        setGameState('categorySelect');
        return true;
      }
      if (gameState === 'summary') {
        navigation.navigate('MainTabs');
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [gameState, navigation]);

  // Animation values
  const progressAnim = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const resultsScale = useRef(new Animated.Value(0)).current;
  const optionScales = useRef(Array(4).fill(0).map(() => new Animated.Value(1))).current;

  // Preloaded Sound References
  const correctSoundRef = useRef<Sound | null>(null);
  const incorrectSoundRef = useRef<Sound | null>(null);
  const selectSoundRef = useRef<Sound | null>(null);
  const correctSoundTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load sound effects on mount & style native bottom navigation bar
  useEffect(() => {
    const correctName = Platform.OS === 'android' ? 'correct' : 'correct.mp3';
    const incorrectName = Platform.OS === 'android' ? 'incorrect' : 'incorrect.wav';

    correctSoundRef.current = new Sound(correctName, Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('[Sound] Failed to load correct sound', error);
    });

    incorrectSoundRef.current = new Sound(incorrectName, Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('[Sound] Failed to load incorrect sound', error);
    });

    const selectName = Platform.OS === 'android' ? 'select' : 'select.wav';
    selectSoundRef.current = new Sound(selectName, Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('[Sound] Failed to load select sound', error);
    });

    // Color the native bottom navigation bar to match the bottom gradient color on mount
    pinNavBarColor('#FFFFFF');
    if (Platform.OS === 'android') {
      try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {}
    }

    return () => {
      if (correctSoundTimerRef.current) {
        clearTimeout(correctSoundTimerRef.current);
      }
      if (correctSoundRef.current) correctSoundRef.current.release();
      if (incorrectSoundRef.current) incorrectSoundRef.current.release();
      if (selectSoundRef.current) selectSoundRef.current.release();
      // Restore standard bottom navigation bar color
      pinNavBarColor('#FFFFFF');
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {}
      }
    };
  }, []);

  // Synchronize native bottom navigation bar color with active game state
  useEffect(() => {
    if (gameState === 'prepare') {
      pinNavBarColor('#0A1628');
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor('#0A1628', false, false); } catch (_) {}
        if (NativeModules.SystemBar) {
          try { NativeModules.SystemBar.setNavigationBarColor('#0A1628', false); } catch (_) {}
        }
      }
    } else {
      pinNavBarColor('#FFFFFF');
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {}
        if (NativeModules.SystemBar) {
          try { NativeModules.SystemBar.setNavigationBarColor('#FFFFFF', true); } catch (_) {}
        }
      }
    }
  }, [gameState]);

  useEffect(() => {
    let interval: any;
    if (gameState === 'playing' && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            const answeredCount = Object.keys(userAnswers).length;
            const hasUnanswered = answeredCount < questions.length;
            if (hasUnanswered && !gracePeriodUsed) {
              setGracePeriodUsed(true);
              setShowGraceModal(true);
            } else {
              endGameWithAnswers(userAnswers);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState, timeLeft, userAnswers, gracePeriodUsed, questions.length]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const playCorrectFeedback = () => {
    Vibration.vibrate(80);
    if (correctSoundRef.current) {
      if (correctSoundTimerRef.current) {
        clearTimeout(correctSoundTimerRef.current);
      }
      correctSoundRef.current.setCurrentTime(0);
      correctSoundRef.current.play();

      correctSoundTimerRef.current = setTimeout(() => {
        if (correctSoundRef.current) {
          correctSoundRef.current.stop();
        }
      }, 1750);
    }
  };

  const playIncorrectFeedback = () => {
    Vibration.vibrate([0, 120, 80, 120]);
    if (incorrectSoundRef.current) {
      incorrectSoundRef.current.setCurrentTime(0);
      incorrectSoundRef.current.play();
    }
  };

  const playSelectTone = () => {
    if (selectSoundRef.current) {
      selectSoundRef.current.setCurrentTime(0);
      selectSoundRef.current.play();
    }
  };

  // ── Helper: load 15 questions for a specific set ───────────────────────────
  const loadSetQuestions = (
    targetCategory: string,
    setId: string,
    sourceQuestions: any[],
    currentAffairsSource: any[],
  ): any[] => {
    const sourcePool = targetCategory === 'current_affairs' ? currentAffairsSource : sourceQuestions;
    const allForSet = (sourcePool as any[]).map((q, idx) => ({
      ...q,
      originalIndex: idx,
      isCurrentAffairs: targetCategory === 'current_affairs',
    })).filter((q: any) =>
      q.set === setId &&
      (targetCategory === 'current_affairs' || q.category?.toLowerCase() === targetCategory.toLowerCase())
    );

    let selected = allForSet.sort(() => Math.random() - 0.5).slice(0, 15);

    // Fallback: backfill if fewer than 15
    if (selected.length < 15) {
      const usedIds = new Set(selected.map((q: any) => q.id));
      const extras = (sourcePool as any[]).map((q, idx) => ({
        ...q, originalIndex: idx,
        isCurrentAffairs: targetCategory === 'current_affairs',
      })).filter((q: any) =>
        !usedIds.has(q.id) &&
        (targetCategory === 'current_affairs' || q.category?.toLowerCase() === targetCategory.toLowerCase())
      ).sort(() => Math.random() - 0.5).slice(0, 15 - selected.length);
      selected = [...selected, ...extras];
    }
    return selected;
  };

  // ── Helper: pick N unique sets from cycle (cross-cycle safe) ───────────────
  const pickMultipleSets = async (targetCategory: string, count: number): Promise<string[]> => {
    const availableSets = getSetsForCategory(targetCategory);
    if (availableSets.length === 0) return ['set1'];
    const chosenSets: string[] = [];
    // pick sets one by one; pickNextSet auto-resets cycle when exhausted
    for (let i = 0; i < count; i++) {
      const remaining = availableSets.filter(s => !chosenSets.includes(s));
      let next: string;
      if (remaining.length === 0) {
        // all sets used — pick any random (new cycle will be started by pickNextSet)
        next = availableSets[Math.floor(Math.random() * availableSets.length)];
      } else {
        next = await pickNextSet(targetCategory, availableSets);
        // ensure no duplicates in our selection
        if (chosenSets.includes(next)) {
          const fallback = remaining[0];
          next = fallback;
        }
      }
      chosenSets.push(next);
    }
    return chosenSets;
  };

  const startNewGame = async (categoryId?: any, forceSetId?: string, qCount?: 15 | 30 | 45) => {
    const targetCategory = (typeof categoryId === 'string') ? categoryId : selectedCategory;
    const numSets = (qCount ?? selectedQuestionCount) === 45 ? 3 : (qCount ?? selectedQuestionCount) === 30 ? 2 : 1;
    const totalQuestions = numSets * 15;
    const sourceQuestions = language === 'tamil' ? tamilQuestions : englishQuestions;
    const currentAffairsSource = language === 'tamil' ? tamilCurrentAffairs : englishCurrentAffairs;

    let chosenSets: string[] = [];
    let allSetQuestions: Question[][] = [];

    if (targetCategory === 'any') {
      // Mixed mode — no set structure
      const questionsWithIndices = sourceQuestions.map((q, idx) => ({
        ...q, originalIndex: idx, isCurrentAffairs: false,
      }));
      const shuffled = questionsWithIndices.sort(() => Math.random() - 0.5);
      const chunk = shuffled.slice(0, totalQuestions);
      // split into pseudo-sets of 15 each for display consistency
      for (let i = 0; i < numSets; i++) {
        allSetQuestions.push(chunk.slice(i * 15, (i + 1) * 15) as Question[]);
      }
      chosenSets = Array(numSets).fill('mixed');
    } else if (forceSetId) {
      // Forced single set (challenge mode)
      const qs = loadSetQuestions(targetCategory, forceSetId, sourceQuestions, currentAffairsSource);
      allSetQuestions = [qs as Question[]];
      chosenSets = [forceSetId];
    } else {
      // Pick N unique sets via cycle
      chosenSets = await pickMultipleSets(targetCategory, numSets);
      for (const sid of chosenSets) {
        const qs = loadSetQuestions(targetCategory, sid, sourceQuestions, currentAffairsSource);
        allSetQuestions.push(qs as Question[]);
      }
    }

    // Flatten all chosen sets into a single questions array
    const flatQuestions = allSetQuestions.flat();

    // Dynamic time: 12 min per 15 Qs, grace: 3 min per 15 Qs
    const baseTime = numSets * 720; // 12 min per set

    setActiveSetIds(chosenSets);
    setActiveSetId(chosenSets[0]);
    setMultiSetQuestions(allSetQuestions);
    setCurrentSetIndex(0);
    setSetResults([]);
    gameStartTimeRef.current = Date.now();

    // Load category avg
    if (targetCategory !== 'any') {
      getCategorySummary(targetCategory, getSetsForCategory(targetCategory))
        .then(s => setCategoryAvgScore(s.overallAverage))
        .catch(() => {});
    } else {
      setCategoryAvgScore(0);
    }

    setQuestions(flatQuestions);
    setSelectedIndices(flatQuestions.map((q: any) => q.originalIndex));
    setCurrentIndex(0);
    setUserAnswers({});
    setScore(0);
    setTimeLeft(baseTime);
    setGracePeriodUsed(false);
    setGameState('playing');

    Animated.timing(progressAnim, {
      toValue: 1 / flatQuestions.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };


  // ── Prepare Mode ────────────────────────────────────────────────────────────
  const startPrepare = (categoryId?: any) => {
    const targetCategory = (typeof categoryId === 'string') ? categoryId : selectedCategory;
    const sourceQuestions = language === 'tamil' ? tamilQuestions : englishQuestions;
    const currentAffairsSource = language === 'tamil' ? tamilCurrentAffairs : englishCurrentAffairs;

    const questionsWithIndices = (targetCategory === 'current_affairs' ? currentAffairsSource : sourceQuestions).map((q, idx) => ({ 
      ...q, 
      originalIndex: idx,
      isCurrentAffairs: targetCategory === 'current_affairs'
    }));

    let filtered = [...questionsWithIndices];
    if (targetCategory !== 'any' && targetCategory !== 'current_affairs') {
      filtered = filtered.filter((q: any) => q.category && q.category.toLowerCase() === targetCategory.toLowerCase());
    }
    if (filtered.length === 0) filtered = [...questionsWithIndices];

    const cache = categoryPrepCache[targetCategory];
    if (cache) {
      setQuestions(cache.questions);
      setViewedSet(new Set(cache.viewedSet));
      setRevealedSet(new Set(cache.revealedSet));
      setInitialIndex(cache.lastIndex);
    } else {
      const initialViewed = new Set<number>([0]);
      setQuestions(filtered);
      setViewedSet(initialViewed);
      setRevealedSet(new Set());
      setInitialIndex(0);
      categoryPrepCache[targetCategory] = {
        questions: filtered,
        viewedSet: initialViewed,
        revealedSet: new Set(),
        lastIndex: 0,
      };
    }
    setGameState('prepare');
  };

  const startGameFromPrepare = () => {
    startNewGame();
  };

  const handleScrollEnd = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const index = Math.round(offsetY / (flatListHeight || 1));
    if (index >= 0 && index < questions.length) {
      let changed = false;
      let nextViewed = viewedSet;
      if (!viewedSet.has(index)) {
        nextViewed = new Set(viewedSet);
        nextViewed.add(index);
        setViewedSet(nextViewed);
        changed = true;
      }
      
      const targetCategory = selectedCategory;
      if (!categoryPrepCache[targetCategory]) {
        categoryPrepCache[targetCategory] = {
          questions: questions,
          viewedSet: nextViewed,
          revealedSet: revealedSet,
          lastIndex: index,
        };
      } else {
        categoryPrepCache[targetCategory].lastIndex = index;
        if (changed) {
          categoryPrepCache[targetCategory].viewedSet = nextViewed;
        }
      }
    }
  };

  const toggleRevealAnswer = (index: number) => {
    let nextRevealed = new Set(revealedSet);
    if (nextRevealed.has(index)) {
      nextRevealed.delete(index);
    } else {
      nextRevealed.add(index);
    }
    setRevealedSet(nextRevealed);

    const targetCategory = selectedCategory;
    if (categoryPrepCache[targetCategory]) {
      categoryPrepCache[targetCategory].revealedSet = nextRevealed;
    }
  };

  const animateProgress = (index: number) => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / (questions.length || 15),
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const navigateWithAnimation = (newIndex: number) => {
    Animated.timing(cardScale, {
      toValue: 0.9,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setCurrentIndex(newIndex);
      animateProgress(newIndex);
      Animated.spring(cardScale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }).start();
    });
  };

  const endGameWithAnswers = async (answers = userAnswers) => {
    let finalScore = 0;
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (answers[idx] === q.correctIndex) {
        finalScore += getPointsForDifficulty(q.difficulty);
        correctCount++;
      }
    });

    const timeTaken = Math.round((Date.now() - gameStartTimeRef.current) / 1000);

    // Save each set's score to DB individually
    const numSets = activeSetIds.length;
    for (let s = 0; s < numSets; s++) {
      const setId = activeSetIds[s];
      if (selectedCategory !== 'any' && setId && setId !== 'mixed') {
        const startIndex = s * 15;
        const endIndex = Math.min((s + 1) * 15, questions.length);
        const setQuestions = questions.slice(startIndex, endIndex);

        let setCorrect = 0;
        let setScore = 0;
        setQuestions.forEach((q, subIdx) => {
          const globalIdx = startIndex + subIdx;
          if (answers[globalIdx] === q.correctIndex) {
            setScore += getPointsForDifficulty(q.difficulty);
            setCorrect++;
          }
        });

        const setMaxPossible = setQuestions.reduce((acc, q) => acc + getPointsForDifficulty(q.difficulty), 0);
        const setPct = setMaxPossible > 0 ? Math.round((setScore / setMaxPossible) * 100) : 0;

        await saveSetScore(selectedCategory, setId, {
          date: new Date().toISOString(),
          correctAnswers: setCorrect,
          totalQuestions: setQuestions.length,
          score: setScore,
          maxScore: setMaxPossible,
          percentage: setPct,
          timeTakenSeconds: Math.round(timeTaken / numSets),
        }).catch(() => {});
      }
    }

    setScore(finalScore);

    // Refresh avg
    if (selectedCategory !== 'any') {
      getCategorySummary(selectedCategory, getSetsForCategory(selectedCategory))
        .then(s => setCategoryAvgScore(s.overallAverage))
        .catch(() => {});
    }

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: false,
    }).start(() => {
      setGameState('summary');
      Animated.spring(resultsScale, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }).start(() => {
        pinNavBarColor('#FFFFFF');
      });
    });
  };


  const goToNextWithAnswers = (answers = userAnswers) => {
    let nextIdx = currentIndex + 1;
    while (nextIdx < questions.length && answers[nextIdx] !== undefined) {
      nextIdx++;
    }
    
    if (nextIdx < questions.length) {
      navigateWithAnimation(nextIdx);
    } else {
      let foundUnanswered = -1;
      for (let i = 0; i < questions.length; i++) {
        if (answers[i] === undefined) {
          foundUnanswered = i;
          break;
        }
      }
      
      if (foundUnanswered !== -1 && foundUnanswered !== currentIndex) {
        navigateWithAnimation(foundUnanswered);
      } else if (foundUnanswered === -1) {
        endGameWithAnswers(answers);
      }
    }
  };

  const goToPrev = () => {
    let prevIdx = currentIndex - 1;
    while (prevIdx >= 0 && userAnswers[prevIdx] !== undefined) {
      prevIdx--;
    }
    
    if (prevIdx >= 0) {
      navigateWithAnimation(prevIdx);
    } else {
      let foundUnanswered = -1;
      for (let i = questions.length - 1; i >= 0; i--) {
        if (userAnswers[i] === undefined) {
          foundUnanswered = i;
          break;
        }
      }
      
      if (foundUnanswered !== -1 && foundUnanswered !== currentIndex) {
        navigateWithAnimation(foundUnanswered);
      }
    }
  };

  const handleAnswerSelect = (optionIndex: number) => {
    if (userAnswers[currentIndex] !== undefined) return;

    const newAnswers = { ...userAnswers, [currentIndex]: optionIndex };
    setUserAnswers(newAnswers);

    const currentQuestion = questions[currentIndex];
    const isCorrect = optionIndex === currentQuestion.correctIndex;

    Animated.sequence([
      Animated.timing(optionScales[optionIndex], {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(optionScales[optionIndex], {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();

    if (isCorrect) {
      playCorrectFeedback();
    } else {
      playIncorrectFeedback();
    }

    setTimeout(() => {
      goToNextWithAnswers(newAnswers);
    }, 1000);
  };

  const getScoreRating = (pct: number) => {
    if (pct === 100) return { title: 'Flawless Mind!', subtitle: 'You got everything correct! Perfect score.', icon: 'trophy', emoji: '🏆', color: '#FFD700' };
    if (pct >= 80) return { title: 'Sharp Mind!', subtitle: 'Superb knowledge! You crushed this round.', icon: 'ribbon', emoji: '🎖️', color: '#A0E7E5' };
    if (pct >= 50) return { title: 'Solid Effort!', subtitle: 'Good job! A few more rounds and you will master this.', icon: 'medal', emoji: '🏅', color: '#B9FBC0' };
    return { title: 'Keep Learning!', subtitle: 'Practice makes perfect. Try again to boost your score!', icon: 'book', emoji: '📖', color: '#FFCFD2' };
  };

  const getCorrectAnswersCount = () => {
    let count = 0;
    questions.forEach((q, idx) => {
      if (userAnswers[idx] === q.correctIndex) {
        count += 1;
      }
    });
    return count;
  };

  const getMaxPossiblePoints = () => {
    return questions.reduce((acc, q) => acc + getPointsForDifficulty(q.difficulty), 0);
  };

  const currentQuestion = questions[currentIndex];
  const maxPoints = getMaxPossiblePoints();
  const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
  const rating = getScoreRating(percentage);

  // Helper to fetch the current category config
  const getSelectedCategoryConfig = () => {
    return CATEGORIES.find(c => c.id === selectedCategory) || CATEGORIES[0];
  };

  const activeCategoryConfig = getSelectedCategoryConfig();

  // Filter and sort friends based on search query and recent challenges
  const filteredFriends = friendsList.filter(friend => {
    const name = (friend.display_name || friend.first_name || friend.username || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const sortedFriends = [...filteredFriends].sort((a, b) => {
    const aIndex = recentFriendIds.indexOf(a.id);
    const bIndex = recentFriendIds.indexOf(b.id);
    
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex; // both are recent, sort by recency order
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return 0;
  });

  return (
    <LinearGradient
      colors={['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0)']}
      style={styles.container}
    >
      <StatusBar barStyle="dark-content" translucent={true} backgroundColor="transparent" />
      <SafeAreaView style={styles.safeArea}>
        {gameState === 'summary' && (
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(30, 58, 95, 0.08)',
            backgroundColor: '#ffffff',
          }}>
            <TouchableOpacity onPress={() => navigation.navigate('MainTabs')} style={styles.backButton}>
              <Icon name="arrow-back" size={28} color="#1E3A5F" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, color: '#1E3A5F', fontFamily: 'Kalam-Bold' }}>Result</Text>
            </View>
            <TouchableOpacity
              onPress={() => setGameState('categorySelect')}
              style={{ padding: 4 }}
            >
              <Icon name="refresh" size={26} color="#1E3A5F" />
            </TouchableOpacity>
          </View>
        )}
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            gameState === 'summary' && { justifyContent: 'flex-start', paddingTop: 8, paddingBottom: 16 }
          ]}
          showsVerticalScrollIndicator={gameState !== 'playing'}
          style={styles.scrollView}
          scrollEnabled={gameState !== 'playing'}
        >
          
          {/* WELCOME SCREEN */}
          {gameState === 'welcome' && (
            <View style={styles.welcomeContainer}>
              <View style={styles.iconCircle}>
                <Icon name="game-controller" size={54} color="#1E3A5F" />
              </View>
              <Text style={styles.welcomeTitle}>DME Trivia Solo</Text>
              <Text style={styles.welcomeSubtitle}>
                Test your logic and general knowledge! 10 random questions across multiple categories. Let's see how smart you are.
              </Text>

              <TouchableOpacity style={styles.primaryButton} onPress={() => setGameState('categorySelect')}>
                <LinearGradient
                  colors={['#FF007F', '#4597f5f6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.gradientButton}
                >
                  <Text style={styles.buttonText}>Choose Category</Text>
                  <Icon name="arrow-forward" size={20} color="#FFFDF9" style={{ marginLeft: 8 }} />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.closeTextButton}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.closeText}>Go Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* CATEGORY SELECT SCREEN */}
          {gameState === 'categorySelect' && (
            <View style={styles.categorySelectContainer}>
              {/* Header */}
              <View style={styles.categoryHeaderRow}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                  <Icon name="chevron-back" size={28} color="#1E3A5F" />
                </TouchableOpacity>
                <Text style={styles.categoryHeaderTitle}>Quiz Challenge</Text>
                {/* 📊 Scoreboard button */}
                <TouchableOpacity
                  style={styles.scoreboardBtn}
                  onPress={() => navigation.navigate('TriviaScoreboard')}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 18 }}>📊</Text>
                </TouchableOpacity>
              </View>

              {/* CURRENT AFFAIRS — full-width centred card */}
              {(() => {
                const cat = CATEGORIES.find(c => c.id === 'current_affairs')!;
                const isSelected = selectedCategory === cat.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.currentAffairsCard,
                      isSelected && { borderColor: cat.color, backgroundColor: `${cat.color}18` },
                    ]}
                    onPress={() => {
                      playSelectTone();
                      setSelectedCategory(cat.id);
                    }}
                    activeOpacity={0.8}
                  >
                    {isSelected ? (
                      <>
                        <View style={styles.currentAffairsMid}>
                          <Text style={[styles.currentAffairsDesc, { color: cat.color }]}>
                            {cat.desc}
                          </Text>
                        </View>
                        <View style={[styles.selectIndicator, { backgroundColor: cat.color, position: 'relative', top: 0, right: 0, marginLeft: 8 }]}>
                          <Icon name="checkmark" size={10} color="#FFFDF9" />
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.currentAffairsEmoji}>{cat.emoji}</Text>
                        <View style={styles.currentAffairsMid}>
                          <Text style={styles.currentAffairsName}>
                            {language === 'tamil' && cat.nameTa ? cat.nameTa : cat.name}
                          </Text>
                        </View>
                        <View style={styles.newBatchBadge}>
                          <Text style={styles.newBatchText}>NEW</Text>
                        </View>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })()}

              {/* 2×5 GRID */}
              <View style={styles.categoriesGrid}>
                {CATEGORIES.filter(c => c.id !== 'current_affairs').map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      activeOpacity={0.8}
                      style={[
                        styles.categoryCard,
                        isSelected && { borderColor: cat.color, backgroundColor: `${cat.color}18` },
                      ]}
                      onPress={() => {
                        playSelectTone();
                        setSelectedCategory(cat.id);
                      }}
                    >
                      {isSelected ? (
                        <>
                          <View style={[styles.selectIndicator, { backgroundColor: cat.color }]}>
                            <Icon name="checkmark" size={10} color="#FFFDF9" />
                          </View>
                          <Text style={[styles.categoryDescSelected, { color: cat.color }]} numberOfLines={3}>
                            {cat.desc}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                          <Text style={styles.categoryName}>
                            {language === 'tamil' && cat.nameTa ? cat.nameTa : cat.name}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* PREPARE + CHALLENGE */}
              <View style={styles.bottomButtonsRow}>
                {/* Prepare — outlined */}
                <TouchableOpacity
                  style={[styles.prepareBtn, { borderColor: activeCategoryConfig.color }]}
                  activeOpacity={0.8}
                  onPress={startPrepare}
                >
                  <Icon name="book-outline" size={17} color={activeCategoryConfig.color} />
                  <Text style={[styles.prepareBtnText, { color: activeCategoryConfig.color }]}>Prepare</Text>
                </TouchableOpacity>

                {/* Challenge — gradient */}
                <TouchableOpacity style={styles.challengeBtn} activeOpacity={0.85} onPress={() => setQuestionCountModal(true)}>
                  <LinearGradient
                    colors={[activeCategoryConfig.color, '#4597f5']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.challengeBtnGradient}
                  >
                    <Icon name="flash" size={17} color="#FFFDF9" />
                    <Text style={styles.challengeBtnText}>Challenge</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
              <Text style={styles.feelGoodNote}> *** All the best *** </Text>
            </View>
          )}

          {/* ACTIVE QUIZ SCREEN */}
          {gameState === 'playing' && currentQuestion && (
            <View style={styles.quizContainer}>
              {/* Header: Score, Progress, Category */}
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => setExitModalVisible(true)} style={styles.backButton}>
                  <Icon name="close" size={28} color="#1E3A5F" />
                </TouchableOpacity>
                <View style={styles.progressContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.questionIndexText}>
                      Question {currentIndex + 1} of {questions.length}
                    </Text>
                    {/* Multi-Set indicator Row */}
                    {activeSetIds.length > 0 && activeSetIds[0] !== 'mixed' && (
                      <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: 'rgba(30, 58, 95, 0.05)',
                        borderWidth: 1,
                        borderColor: 'rgba(30, 58, 95, 0.12)',
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}>
                        <Text style={{ fontSize: 11, fontFamily: 'Kalam-Bold', color: '#1E3A5F' }}>Set : </Text>
                        {activeSetIds.map((sid, index) => {
                          const isCurrent = Math.floor(currentIndex / 15) === index;
                          const numStr = sid.replace('set', '');
                          return (
                            <React.Fragment key={index}>
                              {index > 0 && <Text style={{ fontSize: 11, fontFamily: 'Kalam-Bold', color: 'rgba(30,58,95,0.3)' }}>|</Text>}
                              <Text style={{
                                fontSize: 11,
                                fontFamily: 'Kalam-Bold',
                                color: isCurrent ? '#FF007F' : '#1E3A5F',
                                paddingHorizontal: 2,
                              }}>
                                {numStr}
                              </Text>
                            </React.Fragment>
                          );
                        })}
                      </View>
                    )}
                    {activeSetIds.length > 0 && activeSetIds[0] === 'mixed' && (
                      <View style={styles.setIdBadge}>
                        <Text style={styles.setIdBadgeText}>Mixed</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.progressBarBg}>
                    <Animated.View
                      style={[
                        styles.progressBarFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={styles.scoreContainer}>
                  <Text style={styles.scoreText}>
                    <Text style={styles.scoreGreen}>{Object.keys(userAnswers).length}/{questions.length}</Text>
                    <Text style={styles.scoreAns}> Ans</Text>
                  </Text>
                </View>
              </View>
            </View>

            {/* Category Tag, Points Indicator & Timer Row */}
            <View style={styles.categoryAndTimerRow}>
              <View style={styles.headerRowLeft}>
                <View style={styles.gameLanguageToggleContainer}>
                  <TouchableOpacity 
                    style={[styles.gameLanguageButton, language === 'english' && styles.gameLanguageButtonActive]}
                    onPress={() => toggleLanguage('english')}
                  >
                    <Text style={[styles.gameLanguageButtonText, language === 'english' && styles.gameLanguageButtonTextActive]}>EN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.gameLanguageButton, language === 'tamil' && styles.gameLanguageButtonActive]}
                    onPress={() => toggleLanguage('tamil')}
                  >
                    <Text style={[styles.gameLanguageButtonText, language === 'tamil' && styles.gameLanguageButtonTextActive]}>TA</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.headerRowCenter}>
                <View style={styles.pointsCenterBadge}>
                  <Text style={styles.pointsCenterText}>
                    {getPointsForDifficulty(currentQuestion.difficulty)} {getPointsForDifficulty(currentQuestion.difficulty) === 1 ? 'Point' : 'Points'}
                  </Text>
                </View>
              </View>

              <View style={styles.headerRowRight}>
                <View style={styles.timerContainer}>
                  <Icon name="time-outline" size={16} color="#D32F2F" />
                  <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
                </View>
              </View>
            </View>

            {/* Scrollable Category Tabs to toggle category during gameplay */}
            <View style={styles.categoryTabsContainer}>
              <ScrollView
                ref={categoryScrollViewRef}
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryTabsScroll}
              >
                {CATEGORIES.map((cat) => {
                  const isCurrent = selectedCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryTabButton,
                        isCurrent && styles.categoryTabButtonActive,
                      ]}
                      onPress={() => {
                        switchCategoryDuringGame(cat.id);
                      }}
                      onLayout={(event) => {
                        tabOffsets[cat.id] = event.nativeEvent.layout.x;
                      }}
                    >
                      <Text style={[
                        styles.categoryTabText,
                        isCurrent && styles.categoryTabTextActive,
                      ]}>
                        {cat.emoji} {language === 'tamil' && cat.nameTa ? cat.nameTa : cat.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Bordered Container enclosing Question Card & Choices */}
            <View style={styles.mainGameBox}>
              {/* Question Card */}
              <Animated.View style={[styles.card, { transform: [{ scale: cardScale }] }]}>
                <Text style={styles.questionText}>{currentQuestion.text}</Text>
              </Animated.View>

              {/* Choices Grid */}
              <View style={styles.choicesContainer}>
                {currentQuestion.choices.map((choice, index) => {
                  const answeredOption = userAnswers[currentIndex];
                  const isLocked = answeredOption !== undefined;
                  const isSelected = answeredOption === index;
                  const isCorrectOption = index === currentQuestion.correctIndex;
                  const showCorrect = isLocked && isCorrectOption;
                  const showWrong = isLocked && isSelected && !isCorrectOption;

                  let optionBgColor = 'rgba(30, 58, 95, 0.04)';
                  let optionBorderColor = 'rgba(30, 58, 95, 0.12)';
                  let textColor = '#1E3A5F';
                  let circleTextColor = '#1E3A5F';

                  if (showCorrect) {
                    optionBgColor = '#2EC4B6';
                    optionBorderColor = '#2EC4B6';
                    textColor = '#FFFDF9';
                    circleTextColor = '#FFFDF9';
                  } else if (showWrong) {
                    optionBgColor = '#FF3366';
                    optionBorderColor = '#FF3366';
                    textColor = '#FFFDF9';
                    circleTextColor = '#FFFDF9';
                  } else if (isSelected) {
                    optionBgColor = 'rgba(30, 58, 95, 0.12)';
                    optionBorderColor = '#1E3A5F';
                    textColor = '#1E3A5F';
                    circleTextColor = '#1E3A5F';
                  }

                  return (
                    <Animated.View
                      key={index}
                      style={{ transform: [{ scale: optionScales[index] }] }}
                    >
                      <TouchableOpacity
                        disabled={isLocked}
                        style={[
                          styles.choiceButton,
                          {
                            backgroundColor: optionBgColor,
                            borderColor: optionBorderColor,
                          },
                        ]}
                        onPress={() => handleAnswerSelect(index)}
                      >
                        <View style={choiceRowStyle(isSelected || showCorrect || showWrong)}>
                          <View style={[
                            styles.indexCircle,
                            { backgroundColor: isSelected || showCorrect || showWrong ? 'rgba(30,58,95,0.15)' : 'rgba(30,58,95,0.08)' }
                          ]}>
                            <Text style={[styles.indexText, { color: circleTextColor }]}>
                              {String.fromCharCode(65 + index)}
                            </Text>
                          </View>
                          <Text style={[styles.choiceText, { color: textColor }]}>
                            {choice}
                          </Text>
                          {showCorrect && (
                            <Icon name="checkmark-circle" size={24} color="#FFFDF9" style={styles.feedbackIcon} />
                          )}
                          {showWrong && (
                            <Icon name="close-circle" size={24} color="#FFFDF9" style={styles.feedbackIcon} />
                          )}
                        </View>
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </View>
            </View>

            {/* Navigation Buttons */}
            <View style={styles.navigationRow}>
              <TouchableOpacity style={styles.navButton} onPress={() => goToPrev()}>
                <Icon name="chevron-back" size={20} color="#1E3A5F" />
                <Text style={styles.navButtonText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButton} onPress={() => goToNextWithAnswers()}>
                <Text style={styles.navButtonText}>Skip</Text>
                <Icon name="chevron-forward" size={20} color="#1E3A5F" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* RESULTS / SUMMARY SCREEN */}
        {gameState === 'summary' && (
          <Animated.View style={[styles.summaryContainer, { transform: [{ scale: resultsScale }] }]}>

            <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 0.9 }} style={styles.viewShotContainer}>
              <LinearGradient
                colors={['#FFD2E5', '#D2EAFF']} // Beautiful pink and blue linear gradient background
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientContainer}
              >
                <View style={styles.avatarWrapper}>
                  <LinearGradient
                    colors={['#FF007F', '#a200ff']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.gradientBorderCircle}
                  >
                    <View style={styles.profileCircleInner}>
                      {user?.profile_picture ? (
                        <Image source={{ uri: resolveImageUrl(user.profile_picture) }} style={styles.profileCircleImage} />
                      ) : (
                        <View style={[styles.fallbackProfileCircle, { backgroundColor: getAvatarColor(user?.display_name || user?.first_name || 'Guest') }]}>
                          <Text style={styles.fallbackProfileText}>
                            {(user?.display_name || user?.first_name || 'G')[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                  </LinearGradient>
                </View>

                {/* Medal Emoji below Profile */}
                <Text style={{ fontSize: 48, marginVertical: 2, textAlign: 'center' }}>🏅</Text>

                <Text style={styles.summaryTitle}>{rating.emoji} {rating.title}</Text>
                <Text style={styles.summarySubtitle}>{rating.subtitle}</Text>

                {/* Score Ring Display */}
                <View style={styles.scoreDetailsBox}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Player</Text>
                    <Text style={[styles.detailValue, { color: '#1E3A5F', fontWeight: '700' }]}>
                      {user?.display_name || 'Guest'}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Category</Text>
                    <Text style={[styles.detailValue, { color: activeCategoryConfig.color }]}>
                      {activeCategoryConfig.name}
                    </Text>
                  </View>
                  {activeSetIds && activeSetIds.length > 0 && activeSetIds[0] !== 'mixed' && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Set Played</Text>
                      <Text style={[styles.detailValue, { color: activeCategoryConfig.color }]}>
                        {'set' + activeSetIds.map(id => id.replace('set', '')).join('/')}
                      </Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Correct Answers</Text>
                    <Text style={styles.detailValue}>{getCorrectAnswersCount()} / {questions.length}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Unanswered</Text>
                    <Text style={styles.detailValue}>{questions.length - Object.keys(userAnswers).length}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Percentage</Text>
                    <Text style={styles.detailValue}>{percentage}%</Text>
                  </View>
                  <View style={[styles.detailRow, { backgroundColor: '#2EC4B6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }]}>
                    <Text style={[styles.detailLabel, { color: '#fff' }]}>Total Points</Text>
                    <Text style={[styles.detailValue, { color: '#fff', fontSize: 20 }]}>{score} / {maxPoints}</Text>
                  </View>
                </View>
              </LinearGradient>
            </ViewShot>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.challengeButton}
                onPress={openChallengeFriends}
              >
                <Icon name="people" size={20} color="#FFFDF9" />
                <Text style={styles.challengeButtonText}>Challenge</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareButton}
                onPress={openShareModal}
              >
                <Icon name="share-social" size={20} color="#FFFDF9" />
                <Text style={styles.challengeButtonText}>Share</Text>
              </TouchableOpacity>
            </View>

            {/* View full scoreboard */}
            <TouchableOpacity
              style={styles.scoreboardOutlineBtn}
              onPress={() => navigation.navigate('TriviaScoreboard')}
            >
              <Text style={{ fontSize: 16 }}>📊</Text>
              <Text style={styles.scoreboardOutlineBtnText}>View Full Scoreboard</Text>
            </TouchableOpacity>


           </Animated.View>
        )}

        </ScrollView>
      </SafeAreaView>

      {/* ── PREPARE MODE FULL-SCREEN VIEWER ── */}
      {gameState === 'prepare' && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
          <View style={prepStyles.root}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

            {/* Floating header */}
            <View style={[prepStyles.floatingHeader, { paddingTop: (insets.top || StatusBar.currentHeight || 24) + 20 }]}>
              <View style={prepStyles.headerRow}>
                <TouchableOpacity style={prepStyles.headerBackBtn} onPress={() => setGameState('categorySelect')}>
                  <Icon name="arrow-back" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={prepStyles.headerCenter}>
                  <Text style={prepStyles.headerTitle}>📖 Prepare Mode</Text>
                  <Text style={prepStyles.headerSub}>
                    {activeCategoryConfig.emoji} {activeCategoryConfig.name}
                    {questions.length > 0
                      ? `  ·  ${Math.round((viewedSet.size / questions.length) * 100)}% completed`
                      : ''}
                  </Text>
                </View>
                <View style={prepStyles.langToggleContainer}>
                  <TouchableOpacity 
                    style={[prepStyles.langBtn, language === 'english' && prepStyles.langBtnActive]}
                    onPress={() => toggleLanguage('english')}
                  >
                    <Text style={[prepStyles.langBtnTxt, language === 'english' && prepStyles.langBtnTxtActive]}>EN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[prepStyles.langBtn, language === 'tamil' && prepStyles.langBtnActive]}
                    onPress={() => toggleLanguage('tamil')}
                  >
                    <Text style={[prepStyles.langBtnTxt, language === 'tamil' && prepStyles.langBtnTxtActive]}>TA</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {/* Coverage progress bar */}
              {questions.length > 0 && (
                <View style={prepStyles.progressBarBg}>
                  <View
                    style={[
                      prepStyles.progressBarFill,
                      { width: `${Math.round((viewedSet.size / questions.length) * 100)}%` },
                    ]}
                  />
                </View>
              )}
            </View>

          <FlatList
            key={selectedCategory}
            style={{ flex: 1 }}
            onLayout={(e) => setFlatListHeight(e.nativeEvent.layout.height)}
            data={questions}
            keyExtractor={(_, i) => String(i)}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            bounces={false}
            decelerationRate="fast"
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({
              length: flatListHeight,
              offset: flatListHeight * index,
              index,
            })}
            onMomentumScrollEnd={handleScrollEnd}
            renderItem={({ item, index }) => {
              const isAnswerRevealed = revealedSet.has(index);
              return (
                <View style={{ width, height: flatListHeight }}>
                  {/* Dark gradient background per slide */}
                  <LinearGradient
                    colors={['#0A1628', '#102040', '#0A1628']}
                    style={StyleSheet.absoluteFill}
                  />

                  <View style={[
                    prepStyles.slideContent,
                    {
                      paddingTop: insets.top + 88,
                      paddingBottom: Math.max(36, insets.bottom + 12)
                    }
                  ]}>
                    {/* Card — plain border always; green border only on correct choice when viewed */}
                    <View style={prepStyles.card}>
                      {/* Question text */}
                      <Text style={prepStyles.questionText}>{item.text}</Text>
                      <View style={prepStyles.divider} />
                      {/* Choices */}
                      <View style={prepStyles.choicesWrap}>
                        {item.choices.map((choice, ci) => {
                          const isCorrect = isAnswerRevealed && ci === item.correctIndex;
                          return (
                            <View
                              key={ci}
                              style={[prepStyles.choiceItem, isCorrect && prepStyles.choiceCorrect]}
                            >
                              <View style={[prepStyles.choiceLetter, isCorrect && prepStyles.choiceLetterCorrect]}>
                                <Text style={[prepStyles.choiceLetterText, isCorrect && { color: '#fff' }]}>
                                  {String.fromCharCode(65 + ci)}
                                </Text>
                              </View>
                              <Text style={[prepStyles.choiceText, isCorrect && prepStyles.choiceTextCorrect]}>
                                {choice}
                              </Text>
                              {isCorrect && (
                                <Icon name="checkmark-circle" size={16} color="#00C853" style={{ marginLeft: 8 }} />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    {/* Bottom row: swipe hints (left) + View button (right) */}
                    <View style={prepStyles.bottomRow}>
                      <View style={prepStyles.swipeIndicators}>
                        {index > 0 && (
                          <View style={prepStyles.swipeHintRow}>
                            <Icon name="chevron-up" size={14} color="rgba(255,255,255,0.4)" />
                            <Text style={prepStyles.swipeHintText}>Swipe up for prev</Text>
                          </View>
                        )}
                        {index < questions.length - 1 && (
                          <View style={prepStyles.swipeHintRow}>
                            <Icon name="chevron-down" size={14} color="rgba(255,255,255,0.4)" />
                            <Text style={prepStyles.swipeHintText}>Swipe down for next</Text>
                          </View>
                        )}
                      </View>

                      {/* VIEW button — bottom right */}
                      <TouchableOpacity
                        style={[prepStyles.viewBtn, isAnswerRevealed && prepStyles.viewBtnActive]}
                        onPress={() => toggleRevealAnswer(index)}
                      >
                        <Icon
                          name={isAnswerRevealed ? 'eye' : 'eye-outline'}
                          size={18}
                          color={isAnswerRevealed ? '#00C853' : 'rgba(255,255,255,0.85)'}
                        />
                        <Text style={[prepStyles.viewBtnText, isAnswerRevealed && prepStyles.viewBtnTextActive]}>
                          {isAnswerRevealed ? 'Revealed' : 'View Answer'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }}
          />
          </View>
        </View>
      )}

      {/* QUESTION COUNT SELECTION MODAL */}
      <Modal
        visible={questionCountModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setQuestionCountModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 28 }]}>
            <Text style={styles.modalTitle}>Choose Questions</Text>
            <Text style={styles.modalDescription}>
              Select how many questions you want to attempt.{'\n'}
              More questions = more sets played in sequence.
            </Text>

            {/* Toggle Row */}
            <View style={{
              flexDirection: 'row',
              backgroundColor: 'rgba(30,58,95,0.07)',
              borderRadius: 14,
              padding: 4,
              width: '100%',
              marginBottom: 24,
            }}>
              {([15, 30, 45] as const).map(count => {
                const isActive = selectedQuestionCount === count;
                const sets = count === 15 ? 1 : count === 30 ? 2 : 3;
                return (
                  <TouchableOpacity
                    key={count}
                    onPress={() => setSelectedQuestionCount(count)}
                    style={[{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: 'center',
                    }, isActive && { backgroundColor: '#1E3A5F' }]}
                  >
                    <Text style={{ fontSize: 20, fontFamily: 'Kalam-Bold', color: isActive ? '#fff' : '#1E3A5F' }}>
                      {count}
                    </Text>
                    <Text style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,0.7)' : 'rgba(30,58,95,0.5)', fontFamily: 'Kalam-Regular' }}>
                      {sets} Set{sets > 1 ? 's' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setQuestionCountModal(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#1E3A5F' }]}
                onPress={() => {
                  setQuestionCountModal(false);
                  startNewGame(undefined, undefined, selectedQuestionCount);
                }}
              >
                <Text style={{ color: '#fff', fontFamily: 'Kalam-Bold', fontSize: 16 }}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* EXIT CONFIRMATION MODAL */}
      <Modal
        visible={exitModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setExitModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Exit Challenge?</Text>
            <Text style={styles.modalDescription}>
              Are you sure you want to leave the quiz? Your current score and progress will be lost.
            </Text>
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setExitModalVisible(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalExitButton]}
                onPress={() => {
                  setExitModalVisible(false);
                  navigation.goBack();
                }}
              >
                <Text style={styles.modalExitButtonText}>Exit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* GRACE TIME CONFIRMATION MODAL */}
      <Modal
        visible={showGraceModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowGraceModal(false);
          endGameWithAnswers(userAnswers);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Need Grace Time?</Text>
            <Text style={styles.modalDescription}>
              You have unanswered questions left! Would you like a grace period of {Math.round((questions.length / 15) * 3)} minutes to complete them?
            </Text>
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => {
                  setShowGraceModal(false);
                  endGameWithAnswers(userAnswers);
                }}
              >
                <Text style={styles.modalCancelButtonText}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#2EC4B6' }]}
                onPress={() => {
                  setShowGraceModal(false);
                  const numSets = questions.length / 15;
                  const graceTime = numSets * 180;
                  setTimeLeft(graceTime); // Dynamic grace time based on question count
                }}
              >
                <Text style={{ color: '#FFFDF9', fontFamily: 'Kalam-Bold', fontSize: 16 }}>Yes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Challenge Friends Modal */}
      <Modal
        visible={friendsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFriendsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.friendsModalContent]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Challenge Friends</Text>
              <TouchableOpacity onPress={() => setFriendsModalVisible(false)}>
                <Icon name="close" size={24} color="#1E3A5F" />
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchBarContainer}>
              <Icon name="search-outline" size={20} color="rgba(30, 58, 95, 0.4)" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search friends..."
                placeholderTextColor="rgba(30, 58, 95, 0.4)"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Icon name="close-circle" size={18} color="rgba(30, 58, 95, 0.4)" />
                </TouchableOpacity>
              )}
            </View>

            {isLoadingFriends ? (
              <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 40 }} />
            ) : friendsList.length === 0 ? (
              <Text style={styles.noFriendsText}>You don't have any friends yet.</Text>
            ) : sortedFriends.length === 0 ? (
              <Text style={styles.noFriendsText}>No matching friends found.</Text>
            ) : (
              <FlatList
                data={sortedFriends}
                keyExtractor={(item) => item.id.toString()}
                style={styles.friendsList}
                contentContainerStyle={{ paddingBottom: 16 }}
                renderItem={({ item }) => {
                  const isRecent = recentFriendIds.includes(item.id);
                  const displayName = item.display_name || item.first_name || item.username || 'Friend';
                  
                  return (
                    <View style={styles.friendRow}>
                      <AvatarWithFallback
                        uri={item.profile_picture}
                        displayName={displayName}
                        sticker={item.avatar_sticker}
                        style={styles.friendAvatar}
                      />
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName} numberOfLines={1}>
                          {displayName}
                        </Text>
                        {isRecent && (
                          <View style={styles.recentBadge}>
                            <Icon name="time-outline" size={10} color="#1E3A5F" style={{ marginRight: 2 }} />
                            <Text style={styles.recentBadgeText}>Recent</Text>
                          </View>
                        )}
                      </View>
                      <TouchableOpacity
                        style={styles.sendChallengeBtn}
                        onPress={() => sendChallenge(item.id)}
                        disabled={challengingFriendId === item.id}
                      >
                        {challengingFriendId === item.id ? (
                          <ActivityIndicator size="small" color="#FFFDF9" />
                        ) : (
                          <Text style={styles.sendChallengeBtnText}>Send</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Share Modal with Tabs: Direct Chat and Post Status */}
      <Modal
        visible={shareModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShareModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.friendsModalContent]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Scorecard</Text>
              <TouchableOpacity onPress={() => setShareModalVisible(false)}>
                <Icon name="close" size={24} color="#1E3A5F" />
              </TouchableOpacity>
            </View>

            {/* Tab Selector */}
            <View style={styles.shareTabWrapper}>
              <TouchableOpacity
                style={[styles.shareTabBtn, shareTab === 'chat' && styles.shareTabBtnActive]}
                onPress={() => setShareTab('chat')}
              >
                <Icon name="chatbubble-ellipses-outline" size={18} color={shareTab === 'chat' ? '#FFFDF9' : '#1E3A5F'} />
                <Text style={[styles.shareTabBtnText, shareTab === 'chat' && styles.shareTabBtnTextActive]}>
                  Direct Chat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shareTabBtn, shareTab === 'status' && styles.shareTabBtnActive]}
                onPress={() => setShareTab('status')}
              >
                <Icon name="images-outline" size={18} color={shareTab === 'status' ? '#FFFDF9' : '#1E3A5F'} />
                <Text style={[styles.shareTabBtnText, shareTab === 'status' && styles.shareTabBtnTextActive]}>
                  Post Status
                </Text>
              </TouchableOpacity>
            </View>

            {shareTab === 'chat' ? (
              // Tab 1: Direct Chat list (same as challenge layout)
              <>
                <View style={styles.searchBarContainer}>
                  <Icon name="search-outline" size={20} color="rgba(30, 58, 95, 0.4)" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search friends to share..."
                    placeholderTextColor="rgba(30, 58, 95, 0.4)"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <Icon name="close-circle" size={18} color="rgba(30, 58, 95, 0.4)" />
                    </TouchableOpacity>
                  )}
                </View>

                {isLoadingFriends ? (
                  <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 40 }} />
                ) : friendsList.length === 0 ? (
                  <Text style={styles.noFriendsText}>You don't have any friends yet.</Text>
                ) : sortedFriends.length === 0 ? (
                  <Text style={styles.noFriendsText}>No matching friends found.</Text>
                ) : (
                  <FlatList
                    data={sortedFriends}
                    keyExtractor={(item) => item.id.toString()}
                    style={styles.friendsList}
                    contentContainerStyle={{ paddingBottom: 16 }}
                    renderItem={({ item }) => {
                      const isRecent = recentFriendIds.includes(item.id);
                      const displayName = item.display_name || item.first_name || item.username || 'Friend';

                      return (
                        <View style={styles.friendRow}>
                          <AvatarWithFallback
                            uri={item.profile_picture}
                            displayName={displayName}
                            sticker={item.avatar_sticker}
                            style={styles.friendAvatar}
                          />
                          <View style={styles.friendInfo}>
                            <Text style={styles.friendName} numberOfLines={1}>
                              {displayName}
                            </Text>
                            {isRecent && (
                              <View style={styles.recentBadge}>
                                <Icon name="time-outline" size={10} color="#1E3A5F" style={{ marginRight: 2 }} />
                                <Text style={styles.recentBadgeText}>Recent</Text>
                              </View>
                            )}
                          </View>
                          <TouchableOpacity
                            style={[styles.sendChallengeBtn, { backgroundColor: '#4597f5' }]}
                            onPress={() => shareToFriend(item.id)}
                            disabled={sharingToFriendId === item.id}
                          >
                            {sharingToFriendId === item.id ? (
                              <ActivityIndicator size="small" color="#FFFDF9" />
                            ) : (
                              <Text style={styles.sendChallengeBtnText}>Share</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      );
                    }}
                  />
                )}
              </>
            ) : (
              // Tab 2: Upload to Status
              <View style={styles.statusShareContainer}>
                <View style={styles.statusIconWrap}>
                  <Icon name="image-outline" size={48} color="#FF007F" />
                </View>
                <Text style={styles.statusDescription}>
                  Upload your high quality scorecard image to your status stories so all your friends can see it!
                </Text>
                <TouchableOpacity
                  style={styles.statusUploadBtn}
                  onPress={shareToStatus}
                  disabled={statusUploading}
                >
                  <LinearGradient
                    colors={['#FF007F', '#4597f5']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.statusUploadGradient}
                  >
                    {statusUploading ? (
                      <ActivityIndicator size="small" color="#FFFDF9" />
                    ) : (
                      <>
                        <Icon name="cloud-upload-outline" size={20} color="#FFFDF9" style={{ marginRight: 8 }} />
                        <Text style={styles.statusUploadBtnText}>Post to Status</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
};

// Helper for row styles
const choiceRowStyle = (isActive: boolean) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  opacity: isActive ? 1 : 0.85,
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  // Welcome View
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.15)',
  },
  welcomeTitle: {
    fontSize: 34,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 18,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.7)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 40,
    paddingHorizontal: 12,
  },
  primaryButton: {
    width: '100%',
    height: 56,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
    marginBottom: 16,
  },
  gradientButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFDF9',
    fontSize: 20,
    fontFamily: 'Kalam-Bold',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 16,
  },
  primaryButtonHalf: {
    flex: 1,
    height: 48,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 4,
  },
  buttonTextHalf: {
    color: '#FFFDF9',
    fontSize: 15,
    fontFamily: 'Kalam-Bold',
  },
  closeTextButton: {
    paddingVertical: 8,
  },
  closeText: {
    color: 'rgba(30, 58, 95, 0.8)',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
  },

  // Category Selection Screen
  categorySelectContainer: {
    flex: 1,
    paddingHorizontal: 8,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoryHeaderTitle: {
    fontSize: 22,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
  },
  scoreboardBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(30,58,95,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Set ID badge shown during game
  setIdBadge: {
    backgroundColor: 'rgba(69,151,245,0.12)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(69,151,245,0.3)',
  },
  setIdBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4597f5',
    letterSpacing: 0.3,
  },
  // "View Full Scoreboard" button on summary
  scoreboardOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(30,58,95,0.2)',
    marginBottom: 12,
  },
  scoreboardOutlineBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  languageButtonText: {
    color: 'rgba(30, 58, 95, 0.6)',
    fontFamily: 'Kalam-Bold',
    fontSize: 14,
  },
  languageButtonTextActive: {
    color: '#FFFDF9',
  },
  categorySelectTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333333',
    textAlign: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 58, 95, 0.12)',
    paddingBottom: 12,
  },
  categorySelectSubtitle: {
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.7)',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  // Current Affairs full-width card (narrower, centred)
  currentAffairsCard: {
    alignSelf: 'center',
    width: '60%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    borderRadius: borderRadius.lg,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 6,
    gap: 8,
  },
  currentAffairsEmoji: {
    fontSize: 28,
  },
  currentAffairsMid: {
    flex: 1,
  },
  currentAffairsName: {
    fontSize: 18,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
  },
  currentAffairsDesc: {
    fontSize: 18,
    fontFamily: 'Kalam-Bold',
    marginTop: 2,
    textAlign: 'center',
  },
  newBatchBadge: {
    backgroundColor: '#FF007F',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  newBatchText: {
    color: '#FFFDF9',
    fontSize: 9,
    fontWeight: 'bold',
    fontFamily: 'Kalam-Bold',
    letterSpacing: 0.5,
  },
  // 2×5 grid cards
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  categoryCard: {
    width: '48%',
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    paddingHorizontal: 6,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 76,
  },
  categoryEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
    lineHeight: 19,
  },
  categoryDescSelected: {
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    textAlign: 'center',
    marginTop: 3,
    lineHeight: 17,
  },
  categoryIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryDesc: {
    fontSize: 11,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.6)',
    lineHeight: 14,
  },
  selectIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Prepare + Challenge buttons
  prepareBtn: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.xl,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  prepareBtnText: {
    fontSize: 15,
    fontFamily: 'Kalam-Bold',
  },
  challengeBtn: {
    flex: 1,
    height: 48,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
  },
  challengeBtnGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  challengeBtnText: {
    fontSize: 15,
    fontFamily: 'Kalam-Bold',
    color: '#FFFDF9',
  },
  feelGoodNote: {
    textAlign: 'center',
    fontSize: 14,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.6)',
    marginTop: 8,
    marginBottom: 4,
    fontStyle: 'italic',
  },

  // Playing View
  quizContainer: {
    flex: 1,
    paddingHorizontal: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  progressContainer: {
    flex: 1,
    marginHorizontal: 16,
  },
  questionIndexText: {
    color: '#1E3A5F',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    marginBottom: 6,
    textAlign: 'center',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: 'rgba(30, 58, 95, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1E3A5F',
    borderRadius: 4,
  },
  scoreContainer: {
    paddingVertical: 4,
  },
  scoreGreen: {
    color: '#1dc225',
    fontWeight: 'bold',
  },
  scoreAns: {
    color: '#000000',
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timerText: {
    color: '#D32F2F',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
  },
  scoreText: {
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
  },
  categoryAndTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerRowLeft: {
    flex: 3,
    alignItems: 'flex-start',
  },
  headerRowCenter: {
    flex: 4,
    alignItems: 'center',
  },
  headerRowRight: {
    flex: 3,
    alignItems: 'flex-end',
  },
  gameLanguageToggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 110, 255, 0.05)',
    borderRadius: 12,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
  },
  gameLanguageButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  gameLanguageButtonActive: {
    backgroundColor: '#006EFF',
  },
  gameLanguageButtonText: {
    color: 'rgba(30, 58, 95, 0.6)',
    fontFamily: 'Kalam-Bold',
    fontSize: 11,
  },
  gameLanguageButtonTextActive: {
    color: '#FFFDF9',
  },
  categoryTabsContainer: {
    marginVertical: 10,
    height: 40,
  },
  categoryTabsScroll: {
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 8,
  },
  categoryTabButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
  },
  categoryTabButtonActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#1E3A5F',
  },
  categoryTabText: {
    fontSize: 12,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
  },
  categoryTabTextActive: {
    color: '#FFFDF9',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#E8F1F5',
    borderRadius: borderRadius.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#1E3A5F',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    marginBottom: 12,
  },
  modalDescription: {
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.8)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelButton: {
    backgroundColor: 'rgba(30, 58, 95, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.2)',
  },
  modalCancelButtonText: {
    color: '#1E3A5F',
    fontFamily: 'Kalam-Bold',
    fontSize: 16,
  },
  modalExitButton: {
    backgroundColor: '#D32F2F',
  },
  modalExitButtonText: {
    color: '#FFFDF9',
    fontFamily: 'Kalam-Bold',
    fontSize: 16,
  },
  mainGameBox: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.15)',
    paddingTop: 6,
    paddingBottom: 24,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(30, 58, 95, 0.02)',
    marginHorizontal: 0,
    borderRadius: borderRadius.md,
  },
  navigationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 20,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  navButtonText: {
    color: '#1E3A5F',
    fontFamily: 'Kalam-Bold',
    fontSize: 16,
  },
  card: {
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderRadius: borderRadius.lg,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 90,
    justifyContent: 'center',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    marginBottom: 20,
    width: '100%',
  },
  questionText: {
    fontSize: 18,
    color: '#1E3A5F',
    textAlign: 'left',
    lineHeight: 26,
    fontWeight: '600',
  },
  choicesContainer: {
    flex: 1,
    justifyContent: 'space-evenly',
    marginVertical: 10,
  },
  choiceButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: 8,
    minHeight: 40,
    justifyContent: 'center',
    width: '88%',
    alignSelf: 'center',
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indexCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  indexText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  choiceText: {
    fontSize: 16,
    flex: 1,
    fontWeight: '600',
  },
  feedbackIcon: {
    marginLeft: 10,
  },

  // Summary View
  summaryContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  avatarWrapper: {
    position: 'relative',
    width: 98,
    height: 98,
    marginBottom: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crownContainer: {
    position: 'absolute',
    top: -12,
    right: -16,
    zIndex: 100,
    elevation: 100,
    transform: [{ rotate: '45deg' }],
  },
  crownShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  gradientBorderCircle: {
    width: 98,
    height: 98,
    borderRadius: 49,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
  profileCircleInner: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 26,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
    marginBottom: 2,
  },
  summarySubtitle: {
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.75)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  scoreDetailsBox: {
    width: '100%',
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderRadius: borderRadius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    marginBottom: 16,
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  challengeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF007F',
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    gap: 8,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4597f5',
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    gap: 8,
  },
  challengeButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
    fontSize: 16,
  },
  viewShotContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 20,
  },
  gradientContainer: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 6,
    width: '100%',
  },
  profileCircleImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  fallbackProfileCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackProfileText: {
    color: '#FFF',
    fontSize: 36,
    fontFamily: 'Kalam-Bold',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: '#000000',
    fontSize: 17,
    fontFamily: 'Kalam-Bold',
  },
  detailValue: {
    color: '#1E3A5F',
    fontSize: 19,
    fontFamily: 'Kalam-Bold',
  },
  pointsCenterBadge: {
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
  },
  pointsCenterText: {
    color: '#1E3A5F',
    fontSize: 13,
    fontFamily: 'Kalam-Bold',
  },
  friendsModalContent: {
    width: '92%',
    maxHeight: '80%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    width: '100%',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.1)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: '#1E3A5F',
    fontFamily: 'Kalam-Regular',
    fontSize: 15,
    paddingVertical: 0,
  },
  friendsList: {
    width: '100%',
    flexGrow: 0,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 58, 95, 0.08)',
  },
  friendAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  friendInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  friendName: {
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
  },
  recentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  recentBadgeText: {
    fontSize: 9,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
  },
  sendChallengeBtn: {
    backgroundColor: '#FF007F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 80,
  },
  sendChallengeBtnText: {
    color: '#FFFDF9',
    fontFamily: 'Kalam-Bold',
    fontSize: 14,
  },
  noFriendsText: {
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.6)',
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  shareTabWrapper: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  shareTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    gap: 6,
  },
  shareTabBtnActive: {
    backgroundColor: '#1E3A5F',
  },
  shareTabBtnText: {
    fontSize: 14,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
  },
  shareTabBtnTextActive: {
    color: '#FFFDF9',
  },
  statusShareContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 8,
  },
  statusIconWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 0, 127, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 0, 127, 0.2)',
  },
  statusDescription: {
    fontSize: 15,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.7)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  statusUploadBtn: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    overflow: 'hidden',
  },
  statusUploadGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusUploadBtnText: {
    color: '#FFFDF9',
    fontFamily: 'Kalam-Bold',
    fontSize: 16,
  },
});

// ── Prepare Mode Styles ──────────────────────────────────────────────────────
const prepStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#0A1628',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(10,22,40,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  headerBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
    fontFamily: 'Kalam-Regular',
    marginTop: 2,
  },
  langToggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  langBtnActive: {
    backgroundColor: '#4597f5',
  },
  langBtnTxt: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: 'Kalam-Bold',
    fontSize: 12,
  },
  langBtnTxtActive: {
    color: '#fff',
  },
  // Each slide occupies the full window height
  slideContent: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    paddingTop: 96,   // clears the floating header
    paddingBottom: 36,
  },
  qMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  qNumText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontFamily: 'Kalam-Bold',
  },
  diffBadge: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  diffText: {
    fontSize: 11,
    fontFamily: 'Kalam-Bold',
  },
  // The main card — neutral border only; green is on the correct choice row
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
  },
  questionText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Kalam-Bold',
    lineHeight: 26,
    marginBottom: 14,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 14,
  },
  choicesWrap: {
    gap: 10,
  },
  choiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  choiceCorrect: {
    backgroundColor: 'rgba(0,200,83,0.15)',
    borderColor: '#00C853',
  },
  choiceLetter: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  choiceLetterCorrect: {
    backgroundColor: '#00C853',
  },
  choiceLetterText: {
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Kalam-Bold',
    fontSize: 13,
  },
  choiceText: {
    flex: 1,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 15,
    fontFamily: 'Kalam-Regular',
  },
  choiceTextCorrect: {
    color: '#00C853',
    fontFamily: 'Kalam-Bold',
  },
  // Bottom row
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingHorizontal: 2,
  },
  swipeIndicators: {
    gap: 6,
  },
  swipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swipeHintText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    fontFamily: 'Kalam-Regular',
  },
  // View button
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  viewBtnActive: {
    backgroundColor: 'rgba(0,200,83,0.18)',
    borderColor: '#00C853',
  },
  viewBtnText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontFamily: 'Kalam-Bold',
  },
  viewBtnTextActive: {
    color: '#00C853',
  },
  // Coverage progress bar (below header)
  progressBarBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    width: '100%',
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#00C853',
    borderRadius: 2,
  },
});
