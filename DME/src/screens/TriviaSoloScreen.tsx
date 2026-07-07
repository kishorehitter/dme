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

export const TriviaSoloScreen: React.FC<any> = ({ navigation }) => {
  // Game states
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [timeLeft, setTimeLeft] = useState(300);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'welcome' | 'categorySelect' | 'playing' | 'summary'>('welcome');
  const [selectedCategory, setSelectedCategory] = useState<string>('any');
  const [language, setLanguage] = useState<'english' | 'tamil'>('english');

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
    const correctName = Platform.OS === 'android' ? 'correct' : 'correct.wav';
    const incorrectName = Platform.OS === 'android' ? 'incorrect' : 'incorrect.wav';

    correctSoundRef.current = new Sound(correctName, Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('[Sound] Failed to load correct sound', error);
    });

    incorrectSoundRef.current = new Sound(incorrectName, Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('[Sound] Failed to load incorrect sound', error);
    });

    // Color the native bottom navigation bar to match the bottom gradient color on mount
    pinNavBarColor('#4A0E68');

    return () => {
      if (correctSoundRef.current) correctSoundRef.current.release();
      if (incorrectSoundRef.current) incorrectSoundRef.current.release();
      // Restore standard bottom navigation bar color
      pinNavBarColor('#FFFFFF');
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
    let filtered = [...sourceQuestions];
    if (targetCategory !== 'any') {
      filtered = filtered.filter((q: any) => q.category.toLowerCase() === targetCategory.toLowerCase());
    }

    if (filtered.length === 0) {
      filtered = [...sourceQuestions]; // Fallback if no questions matched
    }

    const shuffled = filtered.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(10, shuffled.length));
    setQuestions(selected as Question[]);
    setCurrentIndex(0);
    setUserAnswers({});
    setScore(0);
    setTimeLeft(300);
    setGameState('playing');
    animateProgress(0);
  };

  const animateProgress = (index: number) => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / 10,
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
        finalScore += 1;
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
      }).start();
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

  const currentQuestion = questions[currentIndex];
  const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
  const rating = getScoreRating(percentage);

  // Helper to fetch the current category config
  const getSelectedCategoryConfig = () => {
    return CATEGORIES.find(c => c.id === selectedCategory) || CATEGORIES[0];
  };

  const activeCategoryConfig = getSelectedCategoryConfig();

  return (
    <LinearGradient
      colors={['#1C0024', '#4A0E68']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" translucent={true} backgroundColor="transparent" />
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
                <Icon name="game-controller" size={54} color="#FFFDF9" />
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
                <TouchableOpacity onPress={() => setGameState('welcome')} style={styles.backButton}>
                  <Icon name="chevron-back" size={28} color="#FFFDF9" />
                </TouchableOpacity>
                <View style={styles.languageToggleContainer}>
                  <TouchableOpacity 
                    style={[styles.languageButton, language === 'english' && styles.languageButtonActive]}
                    onPress={() => setLanguage('english')}
                  >
                    <Text style={[styles.languageButtonText, language === 'english' && styles.languageButtonTextActive]}>English</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.languageButton, language === 'tamil' && styles.languageButtonActive]}
                    onPress={() => setLanguage('tamil')}
                  >
                    <Text style={[styles.languageButtonText, language === 'tamil' && styles.languageButtonTextActive]}>தமிழ்</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.categorySelectTitle}>Select Category</Text>

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
                      <View style={[styles.categoryIconContainer, { backgroundColor: isSelected ? cat.color : 'rgba(255, 255, 255, 0.05)' }]}>
                        <Icon name={cat.icon} size={24} color={isSelected ? '#1C0024' : '#FFFDF9'} />
                      </View>
                      <Text style={[styles.categoryName, isSelected && { color: cat.color }]}>
                        {language === 'tamil' && cat.nameTa ? cat.nameTa : cat.name}
                      </Text>
                      {isSelected && (
                        <View style={[styles.selectIndicator, { backgroundColor: cat.color }]}>
                          <Icon name="checkmark" size={10} color="#1C0024" />
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
                <TouchableOpacity onPress={() => setGameState('categorySelect')} style={styles.backButton}>
                  <Icon name="chevron-back" size={28} color="#FFFDF9" />
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
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreText}>{Object.keys(userAnswers).length}/{questions.length} Ans</Text>
                </View>
              </View>
            </View>

            {/* Category Tag & Timer Row */}
            <View style={styles.categoryAndTimerRow}>
              <View style={styles.categoryBadge}>
                <Icon name={activeCategoryConfig.icon} size={14} color={activeCategoryConfig.color} />
                <Text style={[styles.categoryText, { color: activeCategoryConfig.color }]}>
                  {currentQuestion.category.toUpperCase()}
                </Text>
              </View>
              <View style={styles.timerBadge}>
                <Icon name="time-outline" size={14} color="#FFFDF9" />
                <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
              </View>
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

                  let optionBgColor = 'rgba(255, 255, 255, 0.08)';
                  let optionBorderColor = 'rgba(255, 255, 255, 0.12)';
                  let textColor = '#FFFDF9';

                  if (showCorrect) {
                    optionBgColor = '#2EC4B6';
                    optionBorderColor = '#2EC4B6';
                    textColor = '#FFFDF9';
                  } else if (showWrong) {
                    optionBgColor = '#FF3366';
                    optionBorderColor = '#FF3366';
                    textColor = '#FFFDF9';
                  } else if (isSelected) {
                    optionBgColor = 'rgba(129, 0, 209, 0.6)';
                    optionBorderColor = activeCategoryConfig.color;
                    textColor = '#FFFDF9';
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
                            { backgroundColor: isSelected || showCorrect || showWrong ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)' }
                          ]}>
                            <Text style={[styles.indexText, { color: textColor }]}>
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
                <Icon name="chevron-back" size={20} color="#FFFDF9" />
                <Text style={styles.navButtonText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButton} onPress={() => goToNextWithAnswers()}>
                <Text style={styles.navButtonText}>Skip</Text>
                <Icon name="chevron-forward" size={20} color="#FFFDF9" />
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
                <Text style={styles.detailLabel}>Correct Answers</Text>
                <Text style={styles.detailValue}>{score} / {questions.length}</Text>
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
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  welcomeTitle: {
    fontSize: 34,
    fontFamily: 'Kalam-Bold',
    color: '#FFFDF9',
    textAlign: 'center',
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 18,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
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
    shadowColor: '#4597f5f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
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
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
  },

  // Category Selection Screen
  categorySelectContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  languageToggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 4,
  },
  languageButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  languageButtonActive: {
    backgroundColor: '#4597f5f6',
  },
  languageButtonText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: 'Kalam-Bold',
    fontSize: 14,
  },
  languageButtonTextActive: {
    color: '#FFFDF9',
  },
  categorySelectTitle: {
    fontSize: 30,
    fontFamily: 'Kalam-Bold',
    color: '#FFFDF9',
    textAlign: 'center',
    marginBottom: 20,
  },
  categorySelectSubtitle: {
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    color: '#FFFDF9',
    textAlign: 'center',
    marginTop: 4,
  },
  categoryDesc: {
    fontSize: 11,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(255, 255, 255, 0.5)',
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
    paddingHorizontal: 20,
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
    color: '#FFFDF9',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    marginBottom: 6,
    textAlign: 'center',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FF007F',
    borderRadius: 4,
  },
  scoreBadge: {
    backgroundColor: '#2EC4B6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 60, 100, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    gap: 4,
  },
  timerText: {
    color: '#FFFDF9',
    fontSize: 14,
    fontFamily: 'Kalam-Bold',
  },
  scoreText: {
    color: '#FFFDF9',
    fontSize: 14,
    
  },
  categoryAndTimerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  categoryText: {
    fontSize: 12,
    fontFamily: 'Kalam-Bold',
    letterSpacing: 1,
  },
  mainGameBox: {
    flex: 0.8,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginHorizontal: -10,
    borderRadius: borderRadius.sm,
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
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  navButtonText: {
    color: '#FFFDF9',
    fontFamily: 'Kalam-Bold',
    fontSize: 16,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 90,
    justifyContent: 'center',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 28,
    width: '100%',
  },
  questionText: {
    fontSize: 20,
    color: '#FFFDF9',
    textAlign: 'left',
    lineHeight: 26,
    fontWeight: '500',
  },
  choicesContainer: {
    gap: 10,
  },
  choiceButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: 10,
    minHeight: 46,
    justifyContent: 'center',
    width: '92%',
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
    fontSize: 15,
    flex: 1,
  },
  feedbackIcon: {
    marginLeft: 10,
  },

  // Summary View
  summaryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  glowCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#FFFDF9',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  summaryTitle: {
    fontSize: 30,
    fontFamily: 'Kalam-Bold',
    color: '#FFFDF9',
    textAlign: 'center',
    marginBottom: 8,
  },
  summarySubtitle: {
    fontSize: 18,
    fontFamily: 'Kalam-Regular',
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  scoreDetailsBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: borderRadius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 40,
    gap: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 16,
    fontFamily: 'Kalam-Regular',
  },
  detailValue: {
    color: '#FFFDF9',
    fontSize: 18,
    fontFamily: 'Kalam-Bold',
  },
});
