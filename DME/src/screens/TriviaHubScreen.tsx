import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Dimensions,
  Modal,
  Animated,
  Easing,
  TextInput,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { pinNavBarColor } from '../utils/navBarPin';
import { getCustomSets } from '../services/CustomTriviaStorage';
import { getAllLocalChallenges, getChallengeExpiryStatus } from '../services/TriviaChallengeService';
import { getFullScoreboardData } from '../services/TriviaScoreDB';
import { TRIVIA_SETS_PER_CATEGORY } from '../utils/triviaSetConfig';
import LottieStickerMessage from '../components/LottieStickerMessage';

const { width } = Dimensions.get('window');

const BookLoadingView = ({ isDark = true, bgColor }: { isDark?: boolean; bgColor?: string }) => {
  return (
    <View style={[styles.loadingContainer, { backgroundColor: bgColor || (isDark ? '#070D1E' : '#F8FAFC') }]}>
      <View style={styles.glowBookWrapper}>
        <LottieStickerMessage
          url="https://fonts.gstatic.com/s/e/notoemoji/latest/1f4da/lottie.json"
          size={100}
          autoPlay={true}
        />
      </View>
    </View>
  );
};

interface TriviaHubScreenProps {
  navigation: any;
}

type HubTab = 'aspirants' | 'contests';

interface StageFeature {
  icon: string;
  label: string;
}

interface StageInfo {
  id: string;
  stepNum: string;
  stepLabel: string;
  title: string;
  subtitle: string;
  features: StageFeature[];
  metric: string;
  icon: string;
  iconColor?: string;
  iconBg?: string;
  iconBorder?: string;
  ctaColors?: string[];        // filled button gradient colours
  ctaOutline?: string;         // if set, render as border-only button with this colour
  actionText: string;
  gradient: string[];
  shadowColor: string;
  infoDetails: string[];
  infoTip: string;
  hasLivePulse?: boolean;
  compact?: boolean;
  onPress: () => void;
}

export const TriviaHubScreen: React.FC<TriviaHubScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const safeTopPadding = (insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44)) + 6;
  const safeBottomPadding = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 24 : 16);
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const [language, setLanguage] = useState<'english' | 'tamil'>('english');
  const [activeTab, setActiveTab] = useState<HubTab>('aspirants');

  // Animated Book Opening Splash (matches YouTube Discovery screen experience)
  const [showSplash, setShowSplash] = useState(true);
  const splashFadeAnim = useRef(new Animated.Value(1)).current;

  const dismissSplash = useCallback(() => {
    Animated.timing(splashFadeAnim, {
      toValue: 0,
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start(() => {
      setShowSplash(false);
    });
  }, [splashFadeAnim]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dismissSplash();
    }, 1200);

    return () => clearTimeout(timer);
  }, [dismissSplash]);

  // Dynamic live stats
  const [customSetsCount, setCustomSetsCount] = useState<number>(0);
  const [activeContestsCount, setActiveContestsCount] = useState<number>(0);
  const [completedContestsCount, setCompletedContestsCount] = useState<number>(0);
  const [hostedContestsCount, setHostedContestsCount] = useState<number>(0);
  const [activeHostedContestsCount, setActiveHostedContestsCount] = useState<number>(0);
  const [pendingContestsCount, setPendingContestsCount] = useState<number>(0);
  const [totalAttempts, setTotalAttempts] = useState<number>(0);
  const [overallAccuracy, setOverallAccuracy] = useState<number>(0);

  // Info Modal State
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [activeInfoData, setActiveInfoData] = useState<{
    title: string;
    subtitle: string;
    details: string[];
    tip?: string;
  } | null>(null);

  // Create Quiz Title Entry Modal State
  const [createQuizModalVisible, setCreateQuizModalVisible] = useState(false);
  const [quizTopicInput, setQuizTopicInput] = useState('');

  const loadLiveStats = async () => {
    try {
      const sets = await getCustomSets();
      setCustomSetsCount(sets.length);

      const allChallenges = await getAllLocalChallenges();
      const list = Object.values(allChallenges);
      const active = list.filter(c => !getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt).isExpired);
      const completed = list.filter(c => getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt).isExpired);
      const myHosted = list.filter(c => String(c.creatorId) === String(user?.id) || String((c as any).createdBy?.id) === String(user?.id));
      const myInvited = list.filter(c => String(c.creatorId) !== String(user?.id) && String((c as any).createdBy?.id) !== String(user?.id));
      const pendingInvited = myInvited.filter(c => {
        const hasPlayed = c.leaderboard && c.leaderboard.some(e => String(e.userId) === String(user?.id));
        const exp = getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt);
        return !hasPlayed && !exp.isExpired;
      });
      const activeHosted = myHosted.filter(c => !getChallengeExpiryStatus(c.createdAt, c.durationHours, c.expiresAt).isExpired);
      setHostedContestsCount(myHosted.length);
      setActiveHostedContestsCount(activeHosted.length);
      setPendingContestsCount(pendingInvited.length);
      setActiveContestsCount(active.length);
      setCompletedContestsCount(completed.length);

      const { summaries, overallAverage } = await getFullScoreboardData(TRIVIA_SETS_PER_CATEGORY);
      let attempts = 0;
      Object.values(summaries || {}).forEach((cat: any) => {
        cat.sets?.forEach((s: any) => {
          if (s.totalAttempts > 0) {
            attempts += s.totalAttempts;
          }
        });
      });
      setTotalAttempts(attempts);
      setOverallAccuracy(overallAverage || 0);
    } catch (e) {
      console.log('Error loading hub stats:', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor(isDark ? '#070D1E' : '#F8FAFC', isDark);
      loadLiveStats();

      const onBackPress = () => {
        if (infoModalVisible) {
          setInfoModalVisible(false);
          return true;
        }
        if (createQuizModalVisible) {
          setCreateQuizModalVisible(false);
          return true;
        }
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('MainTabs');
        }
        return true;
      };

      const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => backSub.remove();
    }, [isDark, infoModalVisible, createQuizModalVisible, navigation])
  );

  const openInfoModal = (info: { title: string; subtitle: string; details: string[]; tip?: string }) => {
    setActiveInfoData(info);
    setInfoModalVisible(true);
  };

  const openGeneralHubInfo = () => {
    openInfoModal({
      title: 'Q-Zone',
      subtitle: language === 'tamil' ? 'கற்றல் & போட்டி வழிகாட்டி' : 'Your Learning & Battle Guide',
      details: [
        language === 'tamil'
          ? '🎯 CrackIt: 3,000+ அரசுத் தேர்வு வினா வங்கி, சுய கற்றல் மற்றும் மாதிரி தேர்வுகள்.'
          : '🎯 CrackIt: Official 3,000+ Question Bank for TNPSC / Competitive Exam Study & Mock Tests.',
        language === 'tamil'
          ? '👥 குழுப் போட்டிகள்: PDF குறிப்புகளை வினாக்களாக மாற்றி, நண்பர்களுடன் 24 மணிநேர நேரலை போட்டிகளில் மோதுங்கள்.'
          : '👥 Group Contests: Custom Quiz Builder (PDFs/Notes) & 24h Multiplayer Competitions with Friends.',
        language === 'tamil'
          ? 'மேலே உள்ள தாவல்களைப் பயன்படுத்தி எப்போது வேண்டுமானாலும் மாறலாம்.'
          : 'Switch between zones anytime using the single-row tabs above.',
      ],
      tip: language === 'tamil'
        ? '💡 குறிப்பு: ஒவ்வொரு படிநிலையிலும் உள்ள (i) குறியீட்டை அழுத்தி கூடுதல் விவரங்களை அறியலாம்.'
        : '💡 Tip: Tap the (i) info icon on any stage card to view rules, scoring, and features.',
    });
  };

  // ZONE 1: CrackIt Stages (Unified Modern Surfaces)
  const aspirantsArenaStages: StageInfo[] = [
    {
      id: 'prepare',
      stepNum: '1',
      stepLabel: language === 'tamil' ? 'படி 1' : 'STEP 1',
      title: language === 'tamil' ? 'தயாராகு' : 'Prepare',
      subtitle: language === 'tamil' ? 'சுய கற்றல் • உடனடி விடைகள்' : 'Untimed Self-Study & Instant Answers',
      features: [
        { icon: 'book-outline', label: language === 'tamil' ? '3,000+ வினாக்கள்' : '3,000+ Questions' },
        { icon: 'grid-outline', label: language === 'tamil' ? '10 பாடங்கள்' : '10 Core Subjects' },
      ],
      metric: language === 'tamil' ? '3,000+ வினாக்கள் • 10 பாடங்கள்' : '3,000+ Questions • 10 Core Subjects',
      icon: 'school',
      iconColor: isDark ? '#F59E0B' : '#D97706',
      iconBg: isDark ? 'rgba(245, 158, 11, 0.16)' : '#FEF3C7',
      iconBorder: isDark ? 'rgba(245, 158, 11, 0.32)' : '#FDE68A',
      ctaColors: ['#F59E0B', '#D97706'],
      actionText: language === 'tamil' ? 'தொடங்கு' : 'Start',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      infoDetails: [
        language === 'tamil'
          ? '3,000+ பாடத்திட்ட வினாக்களை உங்கள் சொந்த வேகத்தில் படித்து உடனடி விடைகளை அறியலாம்.'
          : 'Study 3,000+ syllabus questions topic-by-topic at your own pace with instant explanations.',
        language === 'tamil'
          ? 'நேர வரம்பு இல்லை — ஒவ்வொரு வினாவிற்கும் பிறகு சரியான விடை மற்றும் விளக்கம் தோன்றும்.'
          : 'No timer pressure — answers and detailed explanations reveal after every question.',
        language === 'tamil'
          ? 'பாட வாரியாக (வரலாறு, அறிவியல், கணிதம், அரசியல்) தேர்வு செய்து படிக்கலாம்.'
          : 'Filter by core subjects (Polity, History, Science, Aptitude, Economy, etc.).',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: மாதிரி தேர்வு எழுதும் முன் கருத்துகளைப் புரிந்து கொள்ள சிறந்த வழி.'
        : '💡 Tip: Ideal for initial learning, concept clearing, and revision before taking mock tests.',
      onPress: () => navigation.navigate('TriviaSolo', { mode: 'prepare' }),
    },
    {
      id: 'challenge',
      stepNum: '2',
      stepLabel: language === 'tamil' ? 'படி 2' : 'STEP 2',
      title: language === 'tamil' ? 'பயிற்சி' : 'Practice',
      subtitle: language === 'tamil' ? '15 / 30 / 45 வினாக்கள் மாதிரி தேர்வு' : '15 / 30 / 45 Qs Timed Mock Test',
      features: [
        { icon: 'help-circle-outline', label: language === 'tamil' ? '15 / 30 / 45 வினாக்கள்' : '15 / 30 / 45 Qs' },
        { icon: 'timer-outline', label: language === 'tamil' ? 'நேர வரம்பு' : 'Countdown Timer' },
      ],
      metric: language === 'tamil' ? 'தேர்வு நாள் சூழல் • நேர வரம்பு' : 'Simulate Real Exam Pressure',
      icon: 'flash',
      iconColor: isDark ? '#10B981' : '#059669',
      iconBg: isDark ? 'rgba(16, 185, 129, 0.16)' : '#D1FAE5',
      iconBorder: isDark ? 'rgba(16, 185, 129, 0.32)' : '#A7F3D0',
      ctaColors: ['#10B981', '#059669'],
      actionText: language === 'tamil' ? 'பயிற்சி' : 'Practice',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      infoDetails: [
        language === 'tamil'
          ? '15, 30 அல்லது 45 வினாக்கள் கொண்ட மாதிரி தேர்வு எழுதி வேகத்தையும் துல்லியத்தையும் சோதியுங்கள்.'
          : 'Choose test size: Quick (15 Qs), Standard (30 Qs), or Full Mock (45 Qs).',
        language === 'tamil'
          ? 'நேர வரம்புடன் கூடிய தேர்வு — தேர்வு நாள் சூழலை உருவாக்குகிறது.'
          : 'Real-time countdown timer to build exam-day speed and time management.',
        language === 'tamil'
          ? 'துல்லியத்தின் அடிப்படையில் தரவரிசை தரங்கள் (A+, A, B, C, D) வழங்கப்படும்.'
          : 'Negative marking and performance grading (A+, A, B, C, D) based on accuracy.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: தொடர்ச்சியான மாதிரி தேர்வுகள் தேர்வு பயத்தைப் போக்கி மதிப்பெண்களை உயர்த்தும்.'
        : '💡 Tip: Take timed tests regularly to build exam-day speed and accuracy.',
      onPress: () => navigation.navigate('TriviaSolo', { mode: 'challenge' }),
    },
    {
      id: 'scorecard',
      stepNum: '3',
      stepLabel: language === 'tamil' ? 'படி 3' : 'STEP 3',
      title: language === 'tamil' ? 'முன்னேற்றப் பலகை' : 'Progress Board',
      subtitle: language === 'tamil' ? 'பாடவாரி துல்லியம் & முன்னேற்றம்' : 'Subject Accuracy & Progress Analytics',
      features: [
        { icon: 'analytics-outline', label: language === 'tamil' ? 'துல்லியம்' : 'Accuracy' },
        { icon: 'stats-chart-outline', label: language === 'tamil' ? 'எழுதிய தேர்வுகள்' : 'Tests Taken' },
      ],
      metric: totalAttempts > 0
        ? (language === 'tamil' ? `ஒட்டுமொத்த சராசரி: ${overallAccuracy}% (${totalAttempts} தேர்வுகள்)` : `Overall Mastery: ${overallAccuracy}% (${totalAttempts} Tests)`)
        : (language === 'tamil' ? 'முழுமையான பகுப்பாய்வு பலகை' : 'Comprehensive Score Analytics'),
      icon: 'bar-chart',
      iconColor: isDark ? '#FB7185' : '#E11D48',
      iconBg: isDark ? 'rgba(244, 63, 94, 0.16)' : '#FFE4E6',
      iconBorder: isDark ? 'rgba(244, 63, 94, 0.32)' : '#FECDD3',
      ctaColors: ['#FF3366', '#E11D48'],
      actionText: language === 'tamil' ? 'பார்' : 'View',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      infoDetails: [
        language === 'tamil'
          ? 'பாட வாரியாக உங்கள் மதிப்பெண்கள், துல்லிய விகிதம் மற்றும் பலவீனமான பகுதிகளை அறியலாம்.'
          : 'Track category-wise accuracy, attempts, and best percentages across all 10 subjects.',
        language === 'tamil'
          ? '3,000+ வினா வங்கியில் உங்கள் ஒட்டுமொத்த சராசரி முன்னேற்றத்தைக் கண்காணிக்கலாம்.'
          : 'View your overall average across all 3,000+ syllabus questions.',
        language === 'tamil'
          ? 'பலவீனமான பாடங்களை எளிதில் கண்டறிந்து மீண்டும் பயிற்சி பெறலாம்.'
          : 'Identifies your strongest and weakest subjects for targeted practice.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: அனைத்து பாடங்களிலும் 80%+ துல்லியத்தை எட்டுவதே வெற்றிக்கு வழி.'
        : '💡 Tip: Aim for 80%+ accuracy across all subjects to master the syllabus.',
      onPress: () => navigation.navigate('TriviaScoreboard'),
    },
  ];

  // ZONE 2: Group Contests — 4 cards (Create + My Sets side-by-side, Join + Leaderboard full-width)
  const groupContestCompactStages: StageInfo[] = [
    {
      // ── COMPACT CARD 1: Create Quiz ──
      id: 'create_quiz',
      stepNum: '1',
      stepLabel: '',
      title: language === 'tamil' ? 'போட்டி உருவாக்கு' : 'Create Contest',
      subtitle: language === 'tamil' ? 'PDF & AI மாற்றி' : 'AI PDF & Manual Builder',
      features: [],
      metric: '',
      icon: 'add-circle',
      iconColor: isDark ? '#38BDF8' : '#2563EB',
      iconBg: isDark ? 'rgba(56, 189, 248, 0.16)' : '#EFF6FF',
      iconBorder: isDark ? 'rgba(56, 189, 248, 0.32)' : '#BFDBFE',
      ctaColors: isDark ? ['#0284C7', '#0369A1'] : ['#2563EB', '#1D4ED8'],
      actionText: language === 'tamil' ? 'உருவாக்கு' : 'Create',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      compact: true,
      infoDetails: [
        language === 'tamil'
          ? 'PDF குறிப்புகள் மற்றும் புத்தகங்களை AI மூலம் வினாடி வினாவாக மாற்றலாம்.'
          : 'Convert PDF study materials and notes into interactive contests with AI.',
        language === 'tamil'
          ? 'TXT அல்லது CSV கோப்புகளில் உள்ள வினாத்தாள்களை எளிதில் இறக்குமதி செய்யலாம்.'
          : 'Import question sheets from TXT or CSV formats with 1-tap.',
        language === 'tamil'
          ? 'செயலியிலேயே சொந்த வினாக்களையும் விடைகளையும் கைமுறையாக உருவாக்கலாம்.'
          : 'Create custom questions and multiple choices manually in-app.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: உங்கள் வகுப்பு குறிப்புகளை உடனடியாக பயிற்சி வினாக்களாக மாற்றுங்கள்.'
        : '💡 Tip: Turn your class notes or PDF question papers into custom contests.',
      onPress: () => { setQuizTopicInput(''); setCreateQuizModalVisible(true); },
    },
    {
      // ── COMPACT CARD 2: Contest List (Practice & Host) ──
      id: 'my_sets',
      stepNum: '2',
      stepLabel: '',
      title: language === 'tamil' ? 'போட்டி பட்டியல்' : 'Contest List',
      subtitle: language === 'tamil' ? 'பயிற்சி & போட்டி நடத்து' : 'Practice & Host Contests',
      features: [],
      metric: customSetsCount > 0
        ? (language === 'tamil' ? `${customSetsCount} போட்டிகள்` : `${customSetsCount} Contests`)
        : '',
      icon: 'library',
      iconColor: isDark ? '#FB7185' : '#E11D48',
      iconBg: isDark ? 'rgba(244, 63, 94, 0.16)' : '#FFE4E6',
      iconBorder: isDark ? 'rgba(244, 63, 94, 0.32)' : '#FECDD3',
      ctaColors: ['#F43F5E', '#E11D48'],
      actionText: language === 'tamil' ? 'பார்' : 'View',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      compact: true,
      infoDetails: [
        language === 'tamil'
          ? 'நீங்கள் உருவாக்கிய அனைத்து வினாத் தொகுப்புகளையும் ஒரே இடத்தில் பார்க்கலாம்.'
          : 'View and organize all your created contests in one dedicated screen.',
        language === 'tamil'
          ? 'வினாக்களை எப்போது வேண்டுமானாலும் திருத்தலாம் அல்லது தேவையற்றதை நீக்கலாம்.'
          : 'Edit questions, modify answers, or delete sets anytime.',
        language === 'tamil'
          ? '1-தட்டலில் நண்பர்கள் அல்லது குழு அரட்டைகளுக்கு 24 மணிநேர போட்டியாக அனுப்பலாம்.'
          : 'Launch 24-hour multiplayer contests to friends or group chats with 1-tap.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: போட்டியைத் தொடங்குவதற்கு முன் வினாக்களை சரிபார்த்துக் கொள்ளுங்கள்.'
        : '💡 Tip: Review questions and test them in solo mode before launching to groups.',
      onPress: () => navigation.navigate('CustomTriviaSets'),
    },
  ];

  const groupContestFullStages: StageInfo[] = [
    {
      // ── FULL CARD 3: Hosted ──
      id: 'hosted_contests',
      stepNum: '3',
      stepLabel: language === 'tamil' ? 'படி 3' : 'STAGE 3',
      title: language === 'tamil' ? 'நடத்திய போட்டி' : 'Hosted Contest',
      subtitle: language === 'tamil' ? 'நீங்கள் நடத்திய போட்டிகள் & நேரலை முடிவுகள்' : 'Contests You Created & Live Standings',
      features: [
        { icon: 'megaphone-outline', label: language === 'tamil' ? 'குழு போட்டிகள்' : 'Group Contests' },
        { icon: 'podium-outline', label: language === 'tamil' ? 'நேரலை தரவரிசை' : 'Live Standings' },
      ],
      metric: activeHostedContestsCount > 0
        ? (language === 'tamil' ? `🏆 ${activeHostedContestsCount} நேரலை போட்டிகள்` : `🏆 ${activeHostedContestsCount} Active Contests`)
        : (language === 'tamil' ? 'போட்டிகளை தொடங்குங்கள்' : 'Manage Hosted Contests'),
      icon: 'podium',
      iconColor: isDark ? '#FB923C' : '#EA580C',
      iconBg: isDark ? 'rgba(249, 115, 22, 0.16)' : '#FFEDD5',
      iconBorder: isDark ? 'rgba(249, 115, 22, 0.32)' : '#FED7AA',
      ctaColors: ['#F97316', '#EA580C'],
      actionText: language === 'tamil' ? 'பார்' : 'View',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      hasLivePulse: activeHostedContestsCount > 0,
      infoDetails: [
        language === 'tamil'
          ? 'நீங்கள் பல்வேறு குழுக்களுக்கு நடத்திய அனைத்து போட்டிகளையும் ஒரே இடத்தில் நிர்வகிக்கலாம்.'
          : 'Monitor all contests you created and dispatched to groups in one live dashboard.',
        language === 'tamil'
          ? 'போட்டி நடத்தியவருக்கு பங்கேற்க அனுமதி இல்லை; குழு உறுப்பினர்கள் மட்டுமே விளையாடுவர்.'
          : 'Strict anti-cheat: Hosts cannot participate in their own quizzes to preserve fairness.',
        language === 'tamil'
          ? 'அனைத்து உறுப்பினர்களும் முடித்ததும் அல்லது நேரம் முடிந்ததும் முதல் 3 இடங்களை குழுவிற்கு பகிருங்கள்.'
          : 'Once all members finish or time expires, share the podium (Top 3) directly to the group chat.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: 24 மணி நேரத்திற்குள் பகிராவிட்டால் தானாகவே குழுவிற்கு அனுப்பப்படும்.'
        : '💡 Tip: Results auto-post to the group chat after 24 hours if not shared manually.',
      onPress: () => navigation.navigate('TriviaChallenges', { initialTab: 'hosted' }),
    },
    {
      // ── FULL CARD 4: Invited ──
      id: 'invited_contests',
      stepNum: '4',
      stepLabel: language === 'tamil' ? 'படி 4' : 'STAGE 4',
      title: language === 'tamil' ? 'அழைக்கப்பட்ட போட்டி' : 'Invited Contest',
      subtitle: language === 'tamil' ? 'நிலுவை, நிறைவு & தவறவிட்ட சவால்கள்' : 'Pending, Completed & Missed Challenges',
      features: [
        { icon: 'mail-outline', label: language === 'tamil' ? 'நிலுவை சவால்கள்' : 'Pending Invites' },
        { icon: 'checkmark-circle-outline', label: language === 'tamil' ? 'நிறைவு செய்தவை' : 'Completed Contests' },
      ],
      metric: pendingContestsCount > 0
        ? (language === 'tamil' ? `🔥 ${pendingContestsCount} விளையாட வேண்டியவை` : `🔥 ${pendingContestsCount} Pending Contests`)
        : (language === 'tamil' ? 'அழைப்புகளைக் காண்க' : 'All Contest Invites'),
      icon: 'mail',
      iconColor: isDark ? '#34D399' : '#059669',
      iconBg: isDark ? 'rgba(16, 185, 129, 0.16)' : '#D1FAE5',
      iconBorder: isDark ? 'rgba(16, 185, 129, 0.32)' : '#A7F3D0',
      ctaColors: ['#10B981', '#059669'],
      actionText: language === 'tamil' ? 'திற' : 'Open',
      gradient: isDark ? ['#132238', '#0B1526'] : ['#FFFFFF', '#FFFFFF'],
      shadowColor: isDark ? '#000000' : '#64748B',
      hasLivePulse: pendingContestsCount > 0,
      infoDetails: [
        language === 'tamil'
          ? 'உங்களுக்கு வந்த அனைத்து குழு போட்டி அழைப்புகளையும் 3 பிரிவுகளில் (நிலுவை, நிறைவு, தவறவிட்டவை) பார்க்கலாம்.'
          : 'Organized 3-tab inbox: Pending (active to play), Completed (finished), and Missed (expired).',
        language === 'tamil'
          ? 'போட்டித் தேர்வு முறையில் விடைகள் ரகசியமாக வைக்கப்பட்டு, முடிவுகள் அறிவிக்கப்பட்ட பிறகே வெளியாகும்.'
          : 'Competitive Exam Mode: Answers and scores remain sealed until the host announces results.',
        language === 'tamil'
          ? 'நேரம் முடிவதற்குள் விளையாடி உங்கள் இடத்தைப் பிடியுங்கள்.'
          : 'Play before the timer runs out to register your score on the official scoreboard.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: வினாக்களின் போது விடைகள் காட்டப்படாது; முடிவுகள் வெளியானவுடன் முழு பலகையை பார்க்கலாம்.'
        : '💡 Tip: Scoreboards unlock once results are shared by the host or after 24 hours.',
      onPress: () => navigation.navigate('TriviaChallenges', { initialTab: 'invited' }),
    },
  ];

  const currentStages = activeTab === 'aspirants' ? aspirantsArenaStages : groupContestFullStages;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#070D1E' : '#F8FAFC' }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* ── Compact Header ── */}
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
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('MainTabs');
            }
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="arrow-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerTitleCenter}>
          <Text
            style={[
              styles.headerTitle,
              { color: theme.textPrimary },
              language === 'tamil' && styles.tamilHeaderTitle,
            ]}
            numberOfLines={1}
          >
            {language === 'tamil' ? 'Q-Zone (போட்டி மையம்)' : 'Q-Zone'}
          </Text>
        </View>

        {/* Info & Language Controls */}
        <View style={styles.headerRightControls}>
          <TouchableOpacity
            style={[styles.headerInfoBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
            onPress={openGeneralHubInfo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="information-circle-outline" size={20} color={theme.textPrimary} />
          </TouchableOpacity>

          <View style={[styles.languageToggleBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <TouchableOpacity
              style={[styles.langBtn, language === 'english' && styles.langBtnActive]}
              onPress={() => setLanguage('english')}
            >
              <Text style={[styles.langBtnText, language === 'english' && styles.langBtnTextActive]}>
                EN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'tamil' && styles.langBtnActive]}
              onPress={() => setLanguage('tamil')}
            >
              <Text style={[styles.langBtnText, language === 'tamil' && styles.langBtnTextActive]}>
                த
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Single-Row Top Zone Tabs Switcher (High-Contrast Filled Pill) ── */}
      <View style={[styles.tabBarWrapper, {
        backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
        borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      }]}>
        <View style={[styles.tabBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9' }]}>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => setActiveTab('aspirants')}
            activeOpacity={0.85}
          >
            {activeTab === 'aspirants' ? (
              <LinearGradient
                colors={isDark ? ['#0EA5E9', '#0284C7'] : ['#0284C7', '#0369A1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.tabButtonActiveGradient}
              >
                <Icon
                  name="school"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.tabButtonText, styles.tabButtonTextActive, { color: '#FFFFFF' }]}
                  numberOfLines={1}
                >
                  {language === 'tamil' ? 'CrackIt (தேர்வுகள்)' : 'CrackIt'}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.tabButtonInactiveInner}>
                <Icon
                  name="school"
                  size={15}
                  color={isDark ? '#94A3B8' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.tabButtonText, { color: isDark ? '#94A3B8' : '#64748B' }]}
                  numberOfLines={1}
                >
                  {language === 'tamil' ? 'CrackIt (தேர்வுகள்)' : 'CrackIt'}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => setActiveTab('contests')}
            activeOpacity={0.85}
          >
            {activeTab === 'contests' ? (
              <LinearGradient
                colors={isDark ? ['#0EA5E9', '#0284C7'] : ['#0284C7', '#0369A1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.tabButtonActiveGradient}
              >
                <Icon
                  name="people"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.tabButtonText, styles.tabButtonTextActive, { color: '#FFFFFF' }]}
                  numberOfLines={1}
                >
                  {language === 'tamil' ? 'குழுப் போட்டிகள்' : 'Group Contests'}
                </Text>
                {activeContestsCount > 0 && <View style={styles.tabBadgeDotOnActive} />}
              </LinearGradient>
            ) : (
              <View style={styles.tabButtonInactiveInner}>
                <Icon
                  name="people"
                  size={15}
                  color={isDark ? '#94A3B8' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.tabButtonText, { color: isDark ? '#94A3B8' : '#64748B' }]}
                  numberOfLines={1}
                >
                  {language === 'tamil' ? 'குழுப் போட்டிகள்' : 'Group Contests'}
                </Text>
                {activeContestsCount > 0 && <View style={styles.tabBadgeDot} />}
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main Content: Dynamically Adjusted & Equally Spaced Based on Screen Height ── */}
      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.actionBarsContainer}>
          {/* ── Compact side-by-side cards (Group Contests only: Create + My Sets) ── */}
          {activeTab === 'contests' && (
            <View style={styles.compactRow}>
              {groupContestCompactStages.map((stage) => (
                <TouchableOpacity
                  key={stage.id}
                  style={[
                    styles.compactCard,
                    {
                      borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: isDark ? '#132238' : '#FFFFFF',
                      shadowColor: isDark ? '#000000' : '#64748B',
                    },
                  ]}
                  onPress={stage.onPress}
                  activeOpacity={0.88}
                >
                  <LinearGradient
                    colors={stage.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.compactGradient}
                  >
                    {/* Top row: info icon | icon box | sets badge */}
                    <View style={styles.compactTopRow}>
                      {/* Info icon — left */}
                      <TouchableOpacity
                        style={styles.compactInfoBtn}
                        onPress={() =>
                          openInfoModal({
                            title: stage.title,
                            subtitle: stage.subtitle,
                            details: stage.infoDetails,
                            tip: stage.infoTip,
                          })
                        }
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Icon name="information-circle-outline" size={16} color={isDark ? '#94A3B8' : '#64748B'} />
                      </TouchableOpacity>

                      {/* Icon — center */}
                      <View
                        style={[
                          styles.compactIconBox,
                          { backgroundColor: stage.iconBg, borderColor: stage.iconBorder || stage.iconBg },
                        ]}
                      >
                        <Icon name={stage.icon} size={22} color={stage.iconColor || '#FFFFFF'} />
                      </View>

                      {/* Right: sets count badge (My Sets only) or empty spacer */}
                      {stage.id === 'my_sets' && customSetsCount > 0 ? (
                        <View style={[styles.compactSetsBadge, {
                          backgroundColor: isDark ? 'rgba(244, 63, 94, 0.18)' : '#FFE4E6',
                          borderColor: isDark ? 'rgba(244, 63, 94, 0.35)' : '#FECDD3',
                        }]}>
                          <Text style={[styles.compactSetsBadgeText, { color: isDark ? '#FB7185' : '#E11D48' }]}>{customSetsCount}</Text>
                        </View>
                      ) : (
                        <View style={styles.compactTopRowSpacer} />
                      )}
                    </View>

                    {/* Title + Subtitle */}
                    <Text style={[styles.compactTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]} numberOfLines={1}>
                      {stage.title}
                    </Text>
                    <Text style={[styles.compactSubtitle, { color: isDark ? 'rgba(255, 255, 255, 0.65)' : '#64748B' }]} numberOfLines={2}>
                      {stage.subtitle}
                    </Text>

                    {/* CTA button */}
                    <LinearGradient
                      colors={stage.ctaColors || ['#0EA5E9', '#0284C7']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.compactCtaBtn}
                    >
                      <Text style={styles.compactCtaText}>{stage.actionText}</Text>
                      <Icon name="chevron-forward" size={12} color="#FFFFFF" style={{ marginLeft: 2 }} />
                    </LinearGradient>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── Full-width stage cards ── */}
          {currentStages.map((stage) => (
            <TouchableOpacity
              key={stage.id}
              style={[
                styles.actionBarCard,
                {
                  borderColor: isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(15, 23, 42, 0.08)',
                  backgroundColor: isDark ? '#132238' : '#FFFFFF',
                  shadowColor: isDark ? '#000000' : '#64748B',
                },
              ]}
              onPress={stage.onPress}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={stage.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.actionBarGradient}
              >
                {/* ── ROW 1: Icon + Text block + Info icon ── */}
                <View style={styles.actionBarRow1}>
                  {/* Icon box */}
                  <View
                    style={[
                      styles.actionBarIconBox,
                      stage.iconBg ? { backgroundColor: stage.iconBg, borderColor: stage.iconBorder || stage.iconBg } : null,
                    ]}
                  >
                    <Icon name={stage.icon} size={24} color={stage.iconColor || '#FFFFFF'} />
                  </View>

                  {/* Title + Subtitle */}
                  <View style={styles.actionBarCenter}>
                    <Text style={[styles.actionBarTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]} numberOfLines={1}>
                      {stage.title}
                    </Text>
                    <Text style={[styles.actionBarSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]} numberOfLines={2}>
                      {stage.subtitle}
                    </Text>
                  </View>

                  {/* Info icon — top right */}
                  <TouchableOpacity
                    style={[styles.actionBarInfoBtn, { alignSelf: 'flex-start' }]}
                    onPress={() =>
                      openInfoModal({
                        title: stage.title,
                        subtitle: stage.subtitle,
                        details: stage.infoDetails,
                        tip: stage.infoTip,
                      })
                    }
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Icon name="information-circle-outline" size={19} color={isDark ? '#94A3B8' : '#64748B'} />
                  </TouchableOpacity>
                </View>

                {/* ── ROW 2: Metric text — standalone (Aspirants only) ── */}
                {activeTab === 'aspirants' && (
                  <View style={styles.actionBarMetricRow}>
                    {stage.hasLivePulse && <View style={styles.actionBarPulseDot} />}
                    <Text style={[styles.actionBarMetricText, { color: isDark ? '#94A3B8' : '#64748B' }]} numberOfLines={1}>
                      {stage.metric}
                    </Text>
                  </View>
                )}

                {/* ── ROW 3: Left corner badge + Right CTA button ── */}
                <View style={styles.actionBarRow3}>
                  {/* Left bottom corner badge (Group Contests: Hosted & Invited) */}
                  {activeTab === 'contests' && stage.id === 'hosted_contests' ? (
                    <View
                      style={[
                        styles.bottomCornerBadge,
                        {
                          backgroundColor: activeHostedContestsCount > 0
                            ? (isDark ? 'rgba(249, 115, 22, 0.16)' : '#FFF7ED')
                            : (isDark ? 'rgba(255, 255, 255, 0.05)' : '#F1F5F9'),
                          borderColor: activeHostedContestsCount > 0
                            ? (isDark ? 'rgba(249, 115, 22, 0.35)' : '#FED7AA')
                            : (isDark ? 'rgba(255, 255, 255, 0.08)' : '#E2E8F0'),
                        },
                      ]}
                    >
                      {activeHostedContestsCount > 0 ? (
                        <View style={[styles.bottomCornerBadgeDot, { backgroundColor: '#F97316' }]} />
                      ) : (
                        <Icon name="time-outline" size={12} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginRight: 2 }} />
                      )}
                      <Text
                        style={[
                          styles.bottomCornerBadgeText,
                          {
                            color: activeHostedContestsCount > 0
                              ? (isDark ? '#FB923C' : '#EA580C')
                              : (isDark ? '#94A3B8' : '#64748B'),
                          },
                        ]}
                      >
                        {language === 'tamil'
                          ? `${activeHostedContestsCount} நேரலை`
                          : `${activeHostedContestsCount} Active`}
                      </Text>
                    </View>
                  ) : activeTab === 'contests' && stage.id === 'invited_contests' ? (
                    <View
                      style={[
                        styles.bottomCornerBadge,
                        {
                          backgroundColor: pendingContestsCount > 0
                            ? (isDark ? 'rgba(16, 185, 129, 0.16)' : '#ECFDF5')
                            : (isDark ? 'rgba(255, 255, 255, 0.05)' : '#F1F5F9'),
                          borderColor: pendingContestsCount > 0
                            ? (isDark ? 'rgba(16, 185, 129, 0.35)' : '#A7F3D0')
                            : (isDark ? 'rgba(255, 255, 255, 0.08)' : '#E2E8F0'),
                        },
                      ]}
                    >
                      {pendingContestsCount > 0 ? (
                        <View style={[styles.bottomCornerBadgeDot, { backgroundColor: '#10B981' }]} />
                      ) : (
                        <Icon name="checkmark-circle-outline" size={12} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginRight: 2 }} />
                      )}
                      <Text
                        style={[
                          styles.bottomCornerBadgeText,
                          {
                            color: pendingContestsCount > 0
                              ? (isDark ? '#34D399' : '#059669')
                              : (isDark ? '#94A3B8' : '#64748B'),
                          },
                        ]}
                      >
                        {language === 'tamil'
                          ? `${pendingContestsCount} நிலுவை`
                          : `${pendingContestsCount} Pending`}
                      </Text>
                    </View>
                  ) : (
                    <View />
                  )}

                  {/* Right side: CTA button */}
                  {stage.ctaOutline ? (
                    <TouchableOpacity
                      style={[styles.actionBarCtaBtnOutline, { borderColor: stage.ctaOutline }]}
                      onPress={stage.onPress}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.actionBarCtaText, { color: stage.ctaOutline }]}>{stage.actionText}</Text>
                      <Icon name="chevron-forward" size={13} color={stage.ctaOutline} style={{ marginLeft: 3 }} />
                    </TouchableOpacity>
                  ) : (
                    <LinearGradient
                      colors={stage.ctaColors || ['#0EA5E9', '#0284C7']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.actionBarCtaBtn}
                    >
                      <Text style={styles.actionBarCtaText}>{stage.actionText}</Text>
                      <Icon name="chevron-forward" size={13} color="#FFFFFF" style={{ marginLeft: 3 }} />
                    </LinearGradient>
                  )}
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Bottom Note: Positioned at Bottom Before Navigation ── */}
      <View
        style={[
          styles.bottomNoteWrapper,
          {
            paddingBottom: safeBottomPadding + 6,
            backgroundColor: isDark ? '#070D1E' : '#F8FAFC',
          },
        ]}
      >
        <View
          style={[
            styles.statStrip,
            {
              backgroundColor: isDark ? 'rgba(56, 189, 248, 0.07)' : '#FFFFFF',
              borderColor: isDark ? 'rgba(56, 189, 248, 0.18)' : '#E2E8F0',
            },
          ]}
        >
          <Icon
            name={activeTab === 'aspirants' ? 'ribbon' : 'flame'}
            size={15}
            color={isDark ? '#38BDF8' : '#0284C7'}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.statStripText, { color: isDark ? '#CBD5E1' : '#64748B' }]} numberOfLines={1}>
            {activeTab === 'aspirants'
              ? (language === 'tamil'
                ? `3,000+ வினா வங்கி • 10 பாடங்கள் ${totalAttempts > 0 ? `• ${overallAccuracy}% துல்லியம்` : ''}`
                : `3,000+ Syllabus Questions • 10 Subjects ${totalAttempts > 0 ? `• ${overallAccuracy}% Accuracy` : ''}`)
              : (language === 'tamil'
                ? `${customSetsCount} போட்டிகள் உருவாக்கப்பட்டது • ${activeContestsCount} நேரலை சவால்கள்`
                : `${customSetsCount} Contests Created • ${activeContestsCount} Active 24h Battles`)}
          </Text>
        </View>
      </View>

      {/* ── Modern Bottom Sheet Info Modal ── */}
      <Modal
        visible={infoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.infoModalCard,
              { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  {activeInfoData?.title}
                </Text>
                <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
                  {activeInfoData?.subtitle}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
                onPress={() => setInfoModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={20} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Details List */}
            <View style={styles.modalDetailsBox}>
              {activeInfoData?.details.map((detail, idx) => (
                <View key={idx} style={styles.detailRow}>
                  <Icon name="checkmark-circle" size={16} color="#10B981" style={{ marginTop: 2, marginRight: 8 }} />
                  <Text style={[styles.detailText, { color: theme.textPrimary }]}>
                    {detail.replace(/^•\s*/, '')}
                  </Text>
                </View>
              ))}
            </View>

            {/* Tip Box */}
            {activeInfoData?.tip ? (
              <View style={[styles.tipBox, { backgroundColor: isDark ? 'rgba(245, 158, 10, 0.12)' : '#FEF3C7' }]}>
                <Text style={[styles.tipText, { color: isDark ? '#FCD34D' : '#92400E' }]}>
                  {activeInfoData.tip}
                </Text>
              </View>
            ) : null}

            {/* Dismiss Button */}
            <TouchableOpacity
              style={styles.modalGotItBtn}
              onPress={() => setInfoModalVisible(false)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#2563EB', '#1D4ED8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalGotItGradient}
              >
                <Text style={styles.modalGotItText}>
                  {language === 'tamil' ? 'புரிந்தது' : 'Got it'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Animated Book Opening Splash Overlay (matching YouTube Discovery) ── */}
      {showSplash && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.splashOverlay,
            { opacity: splashFadeAnim, backgroundColor: isDark ? '#070D1E' : '#F8FAFC' },
          ]}
          pointerEvents="none"
        >
          <BookLoadingView isDark={isDark} bgColor={isDark ? '#070D1E' : '#F8FAFC'} />
        </Animated.View>
      )}

      {/* ── Create Quiz — Topic/Title Entry Modal ── */}
      <Modal
        visible={createQuizModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateQuizModalVisible(false)}
      >
        <View style={styles.createQuizOverlay}>
          <View style={[styles.createQuizCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            {/* Header */}
            <View style={styles.createQuizHeader}>
              
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.createQuizTitle, { color: theme.textPrimary }]}>
                  {language === 'tamil' ? 'போட்டி தலைப்பு' : 'Contest Title'}
                </Text>
                <Text style={[styles.createQuizSub, { color: theme.textSecondary }]}>
                  {language === 'tamil' ? 'போட்டியை உருவாக்கும் முன் ஒரு தலைப்பை உள்ளிடவும்' : 'Enter a title before creating your contest'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setCreateQuizModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.createQuizCloseBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Input */}
            <View style={[
              styles.createQuizInputRow,
              {
                backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
                borderColor: quizTopicInput.trim()
                  ? (isDark ? '#94A3B8' : '#64748B')
                  : (isDark ? 'rgba(148,163,184,0.25)' : '#E2E8F0'),
              },
            ]}>
              <Icon name="pencil-outline" size={18} color={isDark ? '#64748B' : '#94A3B8'} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.createQuizInput, { color: theme.textPrimary }]}
                value={quizTopicInput}
                onChangeText={setQuizTopicInput}
                placeholder={language === 'tamil' ? 'எ.கா. அறிவியல் அத்தியாயம் 1' : 'e.g. Science Chapter 1, TNPSC History'}
                placeholderTextColor={isDark ? '#475569' : '#94A3B8'}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (quizTopicInput.trim()) {
                    setCreateQuizModalVisible(false);
                    navigation.navigate('QuizPdfUpload', { prefillTitle: quizTopicInput.trim() });
                  }
                }}
              />
              {quizTopicInput.length > 0 && (
                <TouchableOpacity onPress={() => setQuizTopicInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={18} color={isDark ? '#475569' : '#94A3B8'} />
                </TouchableOpacity>
              )}
            </View>

            {/* Confirm Button */}
            <TouchableOpacity
              style={[
                styles.createQuizConfirmBtn,
                { opacity: quizTopicInput.trim() ? 1 : 0.45 },
              ]}
              disabled={!quizTopicInput.trim()}
              activeOpacity={0.85}
              onPress={() => {
                setCreateQuizModalVisible(false);
                navigation.navigate('QuizPdfUpload', { prefillTitle: quizTopicInput.trim() });
              }}
            >
              <LinearGradient
                colors={quizTopicInput.trim() ? ['#8B5CF6', '#7C3AED'] : ['#64748B', '#475569']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.createQuizConfirmGradient}
              >
                
                <Text style={styles.createQuizConfirmText}>
                  {language === 'tamil' ? 'உறுதிப்படுத்து' : 'Confirm & Continue'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  glowBookWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleCenter: {
    flex: 1,
    paddingHorizontal: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  tamilHeaderTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0,
  },
  headerRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerInfoBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageToggleBox: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 2,
  },
  langBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 14,
  },
  langBtnActive: {
    backgroundColor: '#64748B',
    borderWidth: 1,
    borderColor: '#475569',
  },
  langBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#94A3B8',
  },
  langBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tabBarWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 15,
    padding: 3.5,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  tabButtonActiveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.24,
    shadowRadius: 4,
  },
  tabButtonInactiveInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    fontWeight: '800',
  },
  tabBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    position: 'absolute',
    top: 8,
    left: 8,
  },
  tabBadgeDotOnActive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
    position: 'absolute',
    top: 8,
    left: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  actionBarsContainer: {
    gap: 13,
  },
  // ── Compact side-by-side cards ──
  compactRow: {
    flexDirection: 'row',
    gap: 10,
  },
  compactCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    borderWidth: 1,
  },
  compactGradient: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 8,
  },
  compactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 2,
  },
  compactInfoBtn: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactTopRowSpacer: {
    width: 24,
    height: 24,
  },
  compactSetsBadge: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactSetsBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  compactIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  compactSubtitle: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 14,
  },
  compactCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 4,
    minWidth: 90,
  },
  compactCtaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionBarCard: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    borderWidth: 1,
  },
  actionBarGradient: {
    flexDirection: 'column',
    paddingVertical: 16,
    paddingHorizontal: 15,
    gap: 12,
  },
  actionBarRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBarRow2: {
    paddingLeft: 60,
    marginBottom: 2,
  },
  actionBarRow3: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  bottomCornerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
  },
  bottomCornerBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bottomCornerBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bottomNoteWrapper: {
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statStripText: {
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  actionBarIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.28)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBarCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  actionBarTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,
  },
  actionBarTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  actionBarStepBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 0.8,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  actionBarStepText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  actionBarSubtitle: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 17,
  },
  actionBarMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBarPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  actionBarMetricText: {
    color: '#64748B',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  actionBarRight: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingLeft: 4,
    paddingVertical: 2,
  },
  actionBarInfoBtn: {
    padding: 3,
    alignSelf: 'flex-start',
  },
  actionBarCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    elevation: 2,
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.35,
    shadowRadius: 2.5,
  },
  actionBarCtaBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  actionBarCtaText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    padding: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 2,
  },
  modalSub: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  modalDetailsBox: {
    gap: 10,
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    flex: 1,
  },
  tipBox: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  tipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  modalGotItBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalGotItGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGotItText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  // ── Create Quiz Title Entry Modal ──
  createQuizOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  createQuizCard: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  createQuizHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  createQuizIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createQuizTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  createQuizSub: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },
  createQuizCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createQuizInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  createQuizInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  createQuizConfirmBtn: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  createQuizConfirmGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  createQuizConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});

export default TriviaHubScreen;
