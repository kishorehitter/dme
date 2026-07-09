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
  BackHandler,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Sound from 'react-native-sound';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { colors, spacing, borderRadius } from '../utils/theme';
import englishQuestions from '../assets/trivia_questions.json';
import tamilQuestions from '../assets/trivia_questions_tamil.json';
import { pinNavBarColor } from '../utils/navBarPin';

const { width } = Dimensions.get('window');

// Enable playing sound in silence mode (iOS)
Sound.setCategory('Playback');

interface Question {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty: string;
  category: string;
  originalIndex?: number;
}

// 8 Categories configuration
const CATEGORIES = [
  { id: 'any', name: 'Any Mix', nameTa: 'அனைத்தும்', emoji: '🎲', icon: 'shuffle', color: '#B388FF', desc: 'A random mixture of all categories' },
  { id: 'science', name: 'Science', nameTa: 'அறிவியல்', emoji: '🔬', icon: 'flask', color: '#4DEEEA', desc: 'Physics, chemistry & biology' },
  { id: 'health', name: 'Health', nameTa: 'உடல்நலம்', emoji: '🩺', icon: 'medical', color: '#FF758F', desc: 'Body, nutrition & medical facts' },
  { id: 'space', name: 'Space', nameTa: 'விண்வெளி', emoji: '🚀', icon: 'planet', color: '#70E000', desc: 'Planets, stars & cosmic wonders' },
  { id: 'places', name: 'Places', nameTa: 'இடங்கள்', emoji: '🗺️', icon: 'map', color: '#FFB703', desc: 'Famous landmarks & countries' },
  { id: 'sports', name: 'Sports', nameTa: 'விளையாட்டு', emoji: '⚽', icon: 'football', color: '#00F5D4', desc: 'Athletes, records & rules' },
  { id: 'geography', name: 'Geography', nameTa: 'புவியியல்', emoji: '🌍', icon: 'earth', color: '#00B4D8', desc: 'Rivers, oceans & terrains' },
  { id: 'history', name: 'History', nameTa: 'வரலாறு', emoji: '🏛️', icon: 'library', color: '#F77F00', desc: 'Ancient civilizations & events' },
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

export const TriviaSoloScreen: React.FC<any> = ({ navigation }) => {
  // Game states
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [timeLeft, setTimeLeft] = useState(360);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'welcome' | 'categorySelect' | 'playing' | 'summary'>('categorySelect');
  const [selectedCategory, setSelectedCategory] = useState<string>('any');
  const [language, setLanguage] = useState<'english' | 'tamil'>('english');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [exitModalVisible, setExitModalVisible] = useState(false);

  const toggleLanguage = (newLang: 'english' | 'tamil') => {
    if (newLang === language) return;
    setLanguage(newLang);
    const nextSource = newLang === 'tamil' ? tamilQuestions : englishQuestions;
    const updatedQuestions = selectedIndices.map((origIdx) => {
      const newQ = nextSource[origIdx];
      return {
        ...newQ,
        originalIndex: origIdx,
      };
    });
    setQuestions(updatedQuestions as Question[]);
  };

  const switchCategoryDuringGame = (newCategoryId: string) => {
    setSelectedCategory(newCategoryId);

    const sourceQuestions = language === 'tamil' ? tamilQuestions : englishQuestions;
    const questionsWithIndices = sourceQuestions.map((q, idx) => ({
      ...q,
      originalIndex: idx,
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
      (newCategoryId === 'any' || (q.category && q.category.toLowerCase() === newCategoryId.toLowerCase()))
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
    const backAction = () => {
      if (gameState === 'playing') {
        setExitModalVisible(true);
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [gameState]);

  // Animation values
  const progressAnim = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const resultsScale = useRef(new Animated.Value(0)).current;
  const optionScales = useRef(Array(4).fill(0).map(() => new Animated.Value(1))).current;

  // Preloaded Sound References
  const correctSoundRef = useRef<Sound | null>(null);
  const incorrectSoundRef = useRef<Sound | null>(null);

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

    // Color the native bottom navigation bar to match the bottom gradient color on mount
    pinNavBarColor('rgba(255, 255, 255, 0)');

    return () => {
      if (correctSoundRef.current) correctSoundRef.current.release();
      if (incorrectSoundRef.current) incorrectSoundRef.current.release();
      // Restore standard bottom navigation bar color
      pinNavBarColor('rgba(255, 255, 255, 0)');
    };
  }, []);

  useEffect(() => {
    let interval: any;
    if (gameState === 'playing' && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            endGameWithAnswers(userAnswers);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState, timeLeft, userAnswers]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const playCorrectFeedback = () => {
    Vibration.vibrate(80);
    if (correctSoundRef.current) {
      correctSoundRef.current.setCurrentTime(0);
      correctSoundRef.current.play();
    }
  };

  const playIncorrectFeedback = () => {
    Vibration.vibrate([0, 120, 80, 120]);
    if (incorrectSoundRef.current) {
      incorrectSoundRef.current.setCurrentTime(0);
      incorrectSoundRef.current.play();
    }
  };

  const startNewGame = (categoryId?: any) => {
    const targetCategory = (typeof categoryId === 'string') ? categoryId : selectedCategory;
    const sourceQuestions = language === 'tamil' ? tamilQuestions : englishQuestions;
    
    // Create mapping containing original index to switch language dynamically
    const questionsWithIndices = sourceQuestions.map((q, idx) => ({
      ...q,
      originalIndex: idx,
    }));

    let filtered = [...questionsWithIndices];
    if (targetCategory !== 'any') {
      filtered = filtered.filter((q: any) => q.category && targetCategory && q.category.toLowerCase() === targetCategory.toLowerCase());
    }

    if (filtered.length === 0) {
      filtered = [...questionsWithIndices]; // Fallback
    }

    // Filter questions by difficulty (with safe checks)
    const easyQs = filtered.filter((q: any) => q.difficulty && q.difficulty.toLowerCase() === 'easy');
    const mediumQs = filtered.filter((q: any) => q.difficulty && q.difficulty.toLowerCase() === 'medium');
    const hardQs = filtered.filter((q: any) => q.difficulty && q.difficulty.toLowerCase() === 'hard');

    // Shuffle and pick 5 of each
    const selectedEasy = easyQs.sort(() => 0.5 - Math.random()).slice(0, 5);
    const selectedMedium = mediumQs.sort(() => 0.5 - Math.random()).slice(0, 5);
    const selectedHard = hardQs.sort(() => 0.5 - Math.random()).slice(0, 5);

    let selected = [...selectedEasy, ...selectedMedium, ...selectedHard];

    // If we have fewer than 15 questions, backfill from the general pool
    if (selected.length < 15) {
      const currentIds = new Set(selected.map((q: any) => q.id));
      const remaining = filtered.filter((q: any) => !currentIds.has(q.id));
      const extra = remaining.sort(() => 0.5 - Math.random()).slice(0, 15 - selected.length);
      selected = [...selected, ...extra];
    }

    // Shuffle the final list of 15 questions
    selected = selected.sort(() => 0.5 - Math.random()).slice(0, 15);

    setQuestions(selected as Question[]);
    setSelectedIndices(selected.map((q: any) => q.originalIndex));
    setCurrentIndex(0);
    setUserAnswers({});
    setScore(0);
    setTimeLeft(360);
    setGameState('playing');
    
    // Animate progress using selected length
    Animated.timing(progressAnim, {
      toValue: 1 / selected.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
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

  const endGameWithAnswers = (answers = userAnswers) => {
    let finalScore = 0;
    questions.forEach((q, idx) => {
      if (answers[idx] === q.correctIndex) {
        finalScore += getPointsForDifficulty(q.difficulty);
      }
    });
    setScore(finalScore);
    
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
         pinNavBarColor('rgba(255, 255, 255, 0)');
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
    if (pct === 100) return { title: 'Flawless Mind!', subtitle: 'You got everything correct! Perfect score.', icon: 'trophy', color: '#FFD700' };
    if (pct >= 80) return { title: 'Sharp Mind!', subtitle: 'Superb knowledge! You crushed this round.', icon: 'ribbon', color: '#A0E7E5' };
    if (pct >= 50) return { title: 'Solid Effort!', subtitle: 'Good job! A few more rounds and you will master this.', icon: 'medal', color: '#B9FBC0' };
    return { title: 'Keep Learning!', subtitle: 'Practice makes perfect. Try again to boost your score!', icon: 'book', color: '#FFCFD2' };
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

  return (
    <LinearGradient
      colors={['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0)']}
      style={styles.container}
    >
      <StatusBar barStyle="dark-content" translucent={true} backgroundColor="transparent" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          style={styles.scrollView}
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
              <View style={styles.categoryHeaderRow}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                  <Icon name="chevron-back" size={28} color="#1E3A5F" />
                </TouchableOpacity>
                <Text style={styles.categoryHeaderTitle}>Quiz Challenge</Text>
                <View style={{ width: 28 }} />
              </View>

              <Text style={styles.categorySelectTitle}>Choose Category</Text>

              <View style={styles.categoriesGrid}>
                {CATEGORIES.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryCard,
                        isSelected && { borderColor: cat.color, backgroundColor: 'rgba(255, 255, 255, 0.08)' }
                      ]}
                      onPress={() => setSelectedCategory(cat.id)}
                    >
                      <View style={[styles.categoryIconContainer, { backgroundColor: isSelected ? cat.color : 'rgba(30, 58, 95, 0.06)' }]}>
                        <Icon name={cat.icon} size={24} color={isSelected ? '#FFFDF9' : '#1E3A5F'} />
                      </View>
                      <Text style={[styles.categoryName, isSelected && { color: cat.color }]}>
                        {language === 'tamil' && cat.nameTa ? cat.nameTa : cat.name}
                      </Text>
                      {isSelected && (
                        <View style={[styles.selectIndicator, { backgroundColor: cat.color }]}>
                          <Icon name="checkmark" size={10} color="#FFFDF9" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity style={styles.primaryButton} onPress={startNewGame}>
                <LinearGradient
                  colors={[activeCategoryConfig.color, '#4597f5f6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.gradientButton}
                >
                  <Text style={styles.buttonText}>Start Challenge</Text>
                  <Icon name="play" size={20} color="#FFFDF9" style={{ marginLeft: 8 }} />
                </LinearGradient>
              </TouchableOpacity>
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
                  <Text style={styles.questionIndexText}>
                    Question {currentIndex + 1} of {questions.length}
                  </Text>
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
            <View style={styles.glowCircle}>
              <Icon name={rating.icon} size={60} color={rating.color} />
            </View>

            <Text style={styles.summaryTitle}>{rating.title}</Text>
            <Text style={styles.summarySubtitle}>{rating.subtitle}</Text>

            {/* Score Ring Display */}
            <View style={styles.scoreDetailsBox}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Category</Text>
                <Text style={[styles.detailValue, { color: activeCategoryConfig.color }]}>
                  {activeCategoryConfig.name}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Total Points</Text>
                <Text style={styles.detailValue}>{score} / {maxPoints} pts</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Correct Answers</Text>
                <Text style={styles.detailValue}>{getCorrectAnswersCount()} / {questions.length}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Unanswered</Text>
                <Text style={styles.detailValue}>{questions.length - Object.keys(userAnswers).length}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Accuracy</Text>
                <Text style={styles.detailValue}>{percentage}%</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={() => setGameState('categorySelect')}>
              <LinearGradient
                colors={['#FF007F', '#4597f5f6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientButton}
              >
                <Text style={styles.buttonText}>Choose Category</Text>
                <Icon name="refresh" size={20} color="#FFFDF9" style={{ marginLeft: 8 }} />
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeTextButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.closeText}>Back to Chat</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        </ScrollView>
      </SafeAreaView>

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
  closeTextButton: {
    paddingVertical: 12,
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
    marginBottom: 18,
  },
  categoryHeaderTitle: {
    fontSize: 24,
    fontFamily: 'Kalam-Bold',
    color: '#006eff',
    textAlign: 'center',
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
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 12,
    gap: 10,
    marginTop: 10,
  },
  categoryCard: {
    width: '48%',
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  categoryIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 18,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
    marginTop: 4,
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
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.15)',
    paddingTop: 6,
    paddingBottom: 24,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(30, 58, 95, 0.02)',
    marginHorizontal: 0,
    borderRadius: borderRadius.md,
    height: 500,
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
    gap: 12,
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  glowCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(30, 58, 95, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(30, 58, 95, 0.15)',
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  summaryTitle: {
    fontSize: 30,
    fontFamily: 'Kalam-Bold',
    color: '#1E3A5F',
    textAlign: 'center',
    marginBottom: 8,
  },
  summarySubtitle: {
    fontSize: 18,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(30, 58, 95, 0.75)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  scoreDetailsBox: {
    width: '100%',
    backgroundColor: 'rgba(30, 58, 95, 0.04)',
    borderRadius: borderRadius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(30, 58, 95, 0.12)',
    marginBottom: 40,
    gap: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: 'rgba(30, 58, 95, 0.65)',
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
  },
  detailValue: {
    color: '#1E3A5F',
    fontSize: 18,
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
});
