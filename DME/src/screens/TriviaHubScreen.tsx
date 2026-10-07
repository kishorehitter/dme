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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';
import { getAllCustomSets } from '../services/CustomTriviaStorage';
import { getAllLocalChallenges, getChallengeExpiryStatus } from '../services/TriviaChallengeService';
import { getFullScoreboardData } from '../services/TriviaScoreDB';
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
  actionText: string;
  gradient: string[];
  shadowColor: string;
  infoDetails: string[];
  infoTip: string;
  hasLivePulse?: boolean;
  onPress: () => void;
}

export const TriviaHubScreen: React.FC<TriviaHubScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const safeTopPadding = (insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44)) + 6;
  const safeBottomPadding = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 24 : 16);
  const { theme, isDark } = useTheme();
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

  const loadLiveStats = async () => {
    try {
      const sets = await getAllCustomSets();
      setCustomSetsCount(sets.length);

      const allChallenges = await getAllLocalChallenges();
      const list = Object.values(allChallenges);
      const active = list.filter(c => !getChallengeExpiryStatus(c.createdAt).isExpired);
      const completed = list.filter(c => getChallengeExpiryStatus(c.createdAt).isExpired);
      setActiveContestsCount(active.length);
      setCompletedContestsCount(completed.length);

      const sbData = await getFullScoreboardData();
      let attempts = 0;
      let totalPctSum = 0;
      sbData.forEach(cat => {
        cat.sets.forEach(s => {
          if (s.totalAttempts > 0) {
            attempts += s.totalAttempts;
            totalPctSum += s.avgPercentage;
          }
        });
      });
      setTotalAttempts(attempts);
      if (attempts > 0) {
        setOverallAccuracy(Math.round(totalPctSum / Math.max(attempts, 1)));
      }
    } catch (e) {
      console.log('Error loading hub stats:', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor(isDark ? '#070D1E' : '#F8FAFC', isDark);
      loadLiveStats();
    }, [isDark])
  );

  const openInfoModal = (info: { title: string; subtitle: string; details: string[]; tip?: string }) => {
    setActiveInfoData(info);
    setInfoModalVisible(true);
  };

  const openGeneralHubInfo = () => {
    openInfoModal({
      title: language === 'tamil' ? 'போட்டி & தேர்வு மையம்' : 'Aspirants & Contests Hub',
      subtitle: language === 'tamil' ? 'கற்றல் & போட்டி வழிகாட்டி' : 'Your Learning & Battle Guide',
      details: [
        language === 'tamil'
          ? '🎯 தேர்வர் களம்: 3,000+ அரசுத் தேர்வு வினா வங்கி, சுய கற்றல் மற்றும் மாதிரி தேர்வுகள்.'
          : '🎯 Aspirants Arena: Official 3,000+ Question Bank for TNPSC / Competitive Exam Study & Mock Tests.',
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

  // ZONE 1: Aspirants Arena Stages (Exactly 2 Key Points Each)
  const aspirantsArenaStages: StageInfo[] = [
    {
      id: 'prepare',
      stepNum: '1',
      stepLabel: language === 'tamil' ? 'படி 1: தயாராகு' : 'STEP 1: PREPARE',
      title: language === 'tamil' ? 'தயாராகு' : 'Prepare',
      subtitle: language === 'tamil' ? 'சுய கற்றல் • உடனடி விடைகள்' : 'Untimed Self-Study & Instant Answers',
      features: [
        { icon: 'book-outline', label: language === 'tamil' ? '3,000+ வினாக்கள்' : '3,000+ Questions' },
        { icon: 'grid-outline', label: language === 'tamil' ? '11 பாடங்கள்' : '11 Core Subjects' },
      ],
      metric: language === 'tamil' ? 'அனைத்து பாடங்களும் உள்ளன' : 'All Syllabus Topics Included',
      icon: 'school',
      actionText: language === 'tamil' ? 'தொடங்கு' : 'Start',
      gradient: ['#38BDF8', '#0EA5E9'],
      shadowColor: '#38BDF8',
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
      stepLabel: language === 'tamil' ? 'படி 2: பயிற்சி' : 'STEP 2: PRACTICE',
      title: language === 'tamil' ? 'பயிற்சி' : 'Practice',
      subtitle: language === 'tamil' ? '15 / 30 / 45 வினாக்கள் மாதிரி தேர்வு' : '15 / 30 / 45 Qs Timed Mock Test',
      features: [
        { icon: 'help-circle-outline', label: language === 'tamil' ? '15 / 30 / 45 வினாக்கள்' : '15 / 30 / 45 Qs' },
        { icon: 'timer-outline', label: language === 'tamil' ? 'நேர வரம்பு' : 'Countdown Timer' },
      ],
      metric: language === 'tamil' ? 'தேர்வு நாள் சூழல்' : 'Simulate Real Exam Pressure',
      icon: 'flash',
      actionText: language === 'tamil' ? 'பயிற்சி' : 'Practice',
      gradient: ['#FBBF24', '#F59E0B'],
      shadowColor: '#FBBF24',
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
      stepLabel: language === 'tamil' ? 'படி 3: முன்னேற்றம்' : 'STEP 3: PROGRESS',
      title: language === 'tamil' ? 'முன்னேற்றம்' : 'Progress',
      subtitle: language === 'tamil' ? 'பாடவாரி துல்லியம் & முன்னேற்றம்' : 'Subject Accuracy & Progress Analytics',
      features: [
        { icon: 'analytics-outline', label: language === 'tamil' ? 'துல்லியம்' : 'Accuracy' },
        { icon: 'stats-chart-outline', label: language === 'tamil' ? 'எழுதிய தேர்வுகள்' : 'Tests Taken' },
      ],
      metric: totalAttempts > 0
        ? (language === 'tamil' ? `ஒட்டுமொத்த சராசரி: ${overallAccuracy}%` : `Overall Mastery: ${overallAccuracy}% (${totalAttempts} Tests)`)
        : (language === 'tamil' ? 'முழுமையான பகுப்பாய்வு பலகை' : 'Comprehensive Score Analytics'),
      icon: 'bar-chart',
      actionText: language === 'tamil' ? 'பார்' : 'View',
      gradient: ['#34D399', '#10B981'],
      shadowColor: '#34D399',
      infoDetails: [
        language === 'tamil'
          ? 'பாட வாரியாக உங்கள் மதிப்பெண்கள், துல்லிய விகிதம் மற்றும் பலவீனமான பகுதிகளை அறியலாம்.'
          : 'Track category-wise accuracy, attempts, and best percentages across all 11 subjects.',
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

  // ZONE 2: Group Contests Stages (4 Clear Stages in 2x2 Grid)
  const groupContestStages: StageInfo[] = [
    {
      id: 'create_quiz',
      stepNum: '1',
      stepLabel: language === 'tamil' ? 'படி 1: உருவாக்கு' : 'STAGE 1: CREATE',
      title: language === 'tamil' ? 'வினா உருவாக்கு' : 'Create Quiz',
      subtitle: language === 'tamil' ? 'PDF, AI & கைமுறை உருவாக்கம்' : 'AI PDF Converter & Manual Builder',
      features: [
        { icon: 'document-text-outline', label: language === 'tamil' ? 'AI PDF மாற்றி' : 'AI PDF Converter' },
        { icon: 'create-outline', label: language === 'tamil' ? 'கைமுறை வினாக்கள்' : 'Manual Builder' },
      ],
      metric: language === 'tamil' ? 'புதிய வினாடி வினா' : 'Build In-App Quizzes',
      icon: 'add-circle',
      actionText: language === 'tamil' ? 'உருவாக்கு' : 'Create',
      gradient: ['#38BDF8', '#0284C7'],
      shadowColor: '#38BDF8',
      infoDetails: [
        language === 'tamil'
          ? 'PDF குறிப்புகள் மற்றும் புத்தகங்களை AI மூலம் வினாடி வினாவாக மாற்றலாம்.'
          : 'Convert PDF study materials and notes into interactive quizzes with AI.',
        language === 'tamil'
          ? 'TXT அல்லது CSV கோப்புகளில் உள்ள வினாத்தாள்களை எளிதில் இறக்குமதி செய்யலாம்.'
          : 'Import question sheets from TXT or CSV formats with 1-tap.',
        language === 'tamil'
          ? 'செயலியிலேயே சொந்த வினாக்களையும் விடைகளையும் கைமுறையாக உருவாக்கலாம்.'
          : 'Create custom questions and multiple choices manually in-app.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: உங்கள் வகுப்பு குறிப்புகளை உடனடியாக பயிற்சி வினாக்களாக மாற்றுங்கள்.'
        : '💡 Tip: Turn your class notes or PDF question papers into custom practice tests.',
      onPress: () => navigation.navigate('QuizPdfUpload'),
    },
    {
      id: 'my_sets',
      stepNum: '2',
      stepLabel: language === 'tamil' ? 'படி 2: தொகுப்புகள்' : 'STAGE 2: MY SETS',
      title: language === 'tamil' ? 'என் வினாத் தொகுப்பு' : 'My Sets',
      subtitle: language === 'tamil' ? 'தொகுப்புகளை நிர்வகி, திருத்து & பகிர்' : 'Manage, Edit, Delete & Launch Battles',
      features: [
        { icon: 'folder-open-outline', label: language === 'tamil' ? 'திருத்து & நீக்கு' : 'Edit & Delete' },
        { icon: 'paper-plane-outline', label: language === 'tamil' ? 'போட்டி அனுப்பு' : 'Launch Contest' },
      ],
      metric: customSetsCount > 0
        ? (language === 'tamil' ? `${customSetsCount} வினாத் தொகுப்புகள்` : `${customSetsCount} Custom Sets Ready`)
        : (language === 'tamil' ? 'தொகுப்புகளை நிர்வகி' : 'Manage Your Sets'),
      icon: 'library',
      actionText: language === 'tamil' ? 'பார்' : 'Manage',
      gradient: ['#34D399', '#059669'],
      shadowColor: '#34D399',
      infoDetails: [
        language === 'tamil'
          ? 'நீங்கள் உருவாக்கிய அனைத்து வினாத் தொகுப்புகளையும் ஒரே இடத்தில் பார்க்கலாம்.'
          : 'View and organize all your custom question sets in one dedicated screen.',
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
    {
      id: 'join_contest',
      stepNum: '3',
      stepLabel: language === 'tamil' ? 'படி 3: பங்கேற்க' : 'STAGE 3: JOIN',
      title: language === 'tamil' ? 'போட்டியில் இணை' : 'Join Contest',
      subtitle: language === 'tamil' ? 'நண்பர்களின் அழைப்புகள் & நேரலை சவால்கள்' : 'Friend Invites & 24h Live Battles',
      features: [
        { icon: 'mail-outline', label: language === 'tamil' ? 'அழைப்புகள்' : 'Group Invites' },
        { icon: 'timer-outline', label: language === 'tamil' ? '48 நொடி டைமர்' : '48s/Q Timer' },
      ],
      metric: activeContestsCount > 0
        ? (language === 'tamil' ? `🔥 ${activeContestsCount} நேரலை சவால்கள்` : `🔥 ${activeContestsCount} Active Battles`)
        : (language === 'tamil' ? 'நண்பர்களுடன் மோது' : 'Play Friend Challenges'),
      icon: 'flame',
      actionText: language === 'tamil' ? 'இணை' : 'Join',
      gradient: ['#A78BFA', '#7C3AED'],
      shadowColor: '#A78BFA',
      hasLivePulse: activeContestsCount > 0,
      infoDetails: [
        language === 'tamil'
          ? 'நண்பர்கள் மற்றும் குழுக்கள் அனுப்பிய அனைத்து சவால்களையும் இங்கே பார்க்கலாம்.'
          : 'Access all contests sent to you by friends or group members in one feed.',
        language === 'tamil'
          ? 'டைனமிக் டைமர்: வினாவுக்கு 48 நொடிகள் என கணக்கிடப்பட்டு சமமான போட்டி உறுதி செய்யப்படுகிறது.'
          : 'Smart dynamic timer: 48 seconds per question ensures equal fairness.',
        language === 'tamil'
          ? '24 மணி நேரத்திற்குள் உங்கள் வசதிக்கேற்ப எந்த நேரத்திலும் விளையாடி முடிக்கலாம்.'
          : 'Participate anytime within the 24-hour contest window at your convenience.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: 24 மணிநேரத்திற்குள் விளையாட தவறினால் போட்டி முடிந்துவிடும்.'
        : '💡 Tip: Complete active contests before the 24-hour timer expires.',
      onPress: () => navigation.navigate('TriviaChallenges', { initialTab: 'my_invites' }),
    },
    {
      id: 'leaderboard',
      stepNum: '4',
      stepLabel: language === 'tamil' ? 'படி 4: தரவரிசை' : 'STAGE 4: RANKING',
      title: language === 'tamil' ? 'லீடர்போர்டு' : 'Leaderboard',
      subtitle: language === 'tamil' ? 'நேரலை தரவரிசை & வெற்றியாளர்கள்' : 'Podium Standings & Champions',
      features: [
        { icon: 'medal-outline', label: language === 'tamil' ? 'பதக்கம் 🥇🥈🥉' : 'Podium 🥇🥈🥉' },
        { icon: 'speedometer-outline', label: language === 'tamil' ? 'டை-பிரேக்கர்' : 'Speed Tie-Breakers' },
      ],
      metric: completedContestsCount > 0
        ? (language === 'tamil' ? `${completedContestsCount} போட்டிகள் நிறைவு` : `${completedContestsCount} Tournaments Over`)
        : (language === 'tamil' ? 'நேரலை போடியம்' : 'Live Podium & Ranks'),
      icon: 'trophy',
      actionText: language === 'tamil' ? 'பார்' : 'View',
      gradient: ['#FBBF24', '#D97706'],
      shadowColor: '#FBBF24',
      infoDetails: [
        language === 'tamil'
          ? 'நேரலை தரவரிசை பலகையில் முதல் 3 இடங்களுக்கு பதக்கங்கள் (🥇, 🥈, 🥉) வழங்கப்படும்.'
          : 'Real-time ranked leaderboard with podium medals (🥇, 🥈, 🥉).',
        language === 'tamil'
          ? 'மதிப்பெண் சமமாக இருந்தால், குறைந்த நேரத்தில் முடித்தவர் முதலிடம் பெறுவார்.'
          : 'Tie-breaker rankings based on completion speed and time taken.',
        language === 'tamil'
          ? 'முடிவடைந்த அனைத்து 24 மணிநேர போட்டிகளின் இறுதி வெற்றியாளர்களைப் பார்க்கலாம்.'
          : 'View final champion standings for all concluded 24-hour tournaments.',
      ],
      infoTip: language === 'tamil'
        ? '💡 குறிப்பு: அதிக துல்லியமும் வேகமான நேரமும் உங்களை போடியத்தில் ஏற்றும்.'
        : '💡 Tip: Higher accuracy and faster completion times place you higher on the podium.',
      onPress: () => navigation.navigate('TriviaChallenges', { initialTab: 'completed' }),
    },
  ];

  const currentStages = activeTab === 'aspirants' ? aspirantsArenaStages : groupContestStages;

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
          onPress={() => navigation.goBack()}
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
            {language === 'tamil' ? 'போட்டி & தேர்வு மையம்' : 'Aspirants & Contests Hub'}
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

          <View style={[styles.languageToggleBox, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
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
                TA
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Single-Row Top Zone Tabs Switcher ── */}
      <View style={[styles.tabBarWrapper, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
        <View style={[styles.tabBar, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'aspirants' && [
                styles.tabButtonActive,
                { backgroundColor: isDark ? '#334155' : '#0F172A' },
              ],
            ]}
            onPress={() => setActiveTab('aspirants')}
            activeOpacity={0.85}
          >
            <Icon
              name="school"
              size={15}
              color={activeTab === 'aspirants' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B')}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.tabButtonText,
                { color: activeTab === 'aspirants' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
                activeTab === 'aspirants' && styles.tabButtonTextActive,
              ]}
              numberOfLines={1}
            >
              {language === 'tamil' ? 'தேர்வர் களம்' : 'Aspirants Arena'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'contests' && [
                styles.tabButtonActive,
                { backgroundColor: isDark ? '#334155' : '#0F172A' },
              ],
            ]}
            onPress={() => setActiveTab('contests')}
            activeOpacity={0.85}
          >
            <Icon
              name="people"
              size={15}
              color={activeTab === 'contests' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B')}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.tabButtonText,
                { color: activeTab === 'contests' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
                activeTab === 'contests' && styles.tabButtonTextActive,
              ]}
              numberOfLines={1}
            >
              {language === 'tamil' ? 'குழுப் போட்டிகள்' : 'Group Contests'}
            </Text>
            {activeContestsCount > 0 && <View style={styles.tabBadgeDot} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main Content: Balanced, Rich, Standard Spacing ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: safeBottomPadding + 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Zone Quick Overview Strip */}
        <View
          style={[
            styles.statStrip,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0',
            },
          ]}
        >
          <Icon
            name={activeTab === 'aspirants' ? 'ribbon' : 'flame'}
            size={15}
            color={isDark ? '#94A3B8' : '#64748B'}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.statStripText, { color: theme.textSecondary }]} numberOfLines={1}>
            {activeTab === 'aspirants'
              ? (language === 'tamil'
                ? `3,000+ வினா வங்கி • 11 பாடங்கள் ${totalAttempts > 0 ? `• ${overallAccuracy}% துல்லியம்` : ''}`
                : `3,000+ Syllabus Questions • 11 Subjects ${totalAttempts > 0 ? `• ${overallAccuracy}% Accuracy` : ''}`)
              : (language === 'tamil'
                ? `${customSetsCount} சொந்த வினாத் தொகுப்புகள் • ${activeContestsCount} நேரலை சவால்கள்`
                : `${customSetsCount} Custom Sets Created • ${activeContestsCount} Active 24h Battles`)}
          </Text>
        </View>

        {/* ── 2x2 Grid for Group Contests & Structured Flow for Aspirants ── */}
        {activeTab === 'contests' ? (
          <View style={styles.gridStagesContainer}>
            {groupContestStages.map((stage) => (
              <TouchableOpacity
                key={stage.id}
                style={[
                  styles.gridStageCard,
                  {
                    shadowColor: stage.shadowColor,
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  },
                ]}
                onPress={stage.onPress}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={stage.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.gridStageGradient}
                >
                  {/* Step Label & Info Button */}
                  <View style={styles.gridStageTopRow}>
                    <View style={styles.gridStepBadge}>
                      <Text style={styles.gridStepBadgeText}>{stage.stepLabel}</Text>
                    </View>

                    <TouchableOpacity
                      style={styles.infoBtn}
                      onPress={() =>
                        openInfoModal({
                          title: stage.title,
                          subtitle: stage.subtitle,
                          details: stage.infoDetails,
                          tip: stage.infoTip,
                        })
                      }
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="information-circle-outline" size={19} color="#334155" />
                    </TouchableOpacity>
                  </View>

                  {/* Icon & Title */}
                  <View style={styles.gridIconAndTitle}>
                    <View style={styles.gridStageIconBox}>
                      <Icon name={stage.icon} size={20} color="#1E293B" />
                    </View>
                    <Text style={styles.gridStageTitle} numberOfLines={1}>
                      {stage.title}
                    </Text>
                  </View>

                  {/* Subtitle */}
                  <Text style={styles.gridStageSubtitle} numberOfLines={2}>
                    {stage.subtitle}
                  </Text>

                  {/* Feature Chips */}
                  <View style={styles.gridFeaturesRow}>
                    {stage.features.map((feat, fIdx) => (
                      <View key={fIdx} style={styles.gridFeatureChip}>
                        <Icon name={feat.icon} size={11} color="#334155" style={{ marginRight: 3 }} />
                        <Text style={styles.gridFeatureChipText} numberOfLines={1}>{feat.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Bottom Footer: Metric + Action Pill */}
                  <View style={styles.gridStageFooter}>
                    <View style={styles.gridActionPill}>
                      <Text style={styles.gridActionPillText}>{stage.actionText}</Text>
                      <Icon name="arrow-forward" size={12} color="#0F172A" style={{ marginLeft: 3 }} />
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.stagesContainer}>
            {aspirantsArenaStages.map((stage, index) => (
              <React.Fragment key={stage.id}>
                <TouchableOpacity
                  style={[
                    styles.stageCard,
                    {
                      shadowColor: stage.shadowColor,
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    },
                  ]}
                  onPress={stage.onPress}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={stage.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.stageGradient}
                  >
                    {/* Top Row: Icon + Big Bold Heading + Info (i) */}
                    <View style={styles.stageTopRow}>
                      <View style={styles.stageTopLeft}>
                        <View style={styles.stageIconBox}>
                          <Icon name={stage.icon} size={18} color="#1E293B" />
                        </View>
                        <Text style={styles.stageTitle} numberOfLines={1}>
                          {stage.title}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.infoBtn}
                        onPress={() =>
                          openInfoModal({
                            title: stage.title,
                            subtitle: stage.subtitle,
                            details: stage.infoDetails,
                            tip: stage.infoTip,
                          })
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="information-circle-outline" size={20} color="#334155" />
                      </TouchableOpacity>
                    </View>

                    {/* Subtitle */}
                    <Text style={styles.stageSubtitle} numberOfLines={1}>
                      {stage.subtitle}
                    </Text>

                    {/* Features Row */}
                    <View style={styles.featuresRow}>
                      {stage.features.map((feat, fIdx) => (
                        <View key={fIdx} style={styles.featureChip}>
                          <Icon name={feat.icon} size={12} color="#334155" style={{ marginRight: 4 }} />
                          <Text style={styles.featureChipText} numberOfLines={1}>{feat.label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Bottom Footer: Metric on left, Action Pill on right */}
                    <View style={styles.stageFooter}>
                      <View style={styles.stageFooterLeft}>
                        {stage.hasLivePulse && <View style={styles.pulseDot} />}
                        <Text style={styles.stageMetricText} numberOfLines={1}>
                          {stage.metric}
                        </Text>
                      </View>

                      <View style={styles.actionPill}>
                        <Text style={styles.actionPillText}>{stage.actionText}</Text>
                        <Icon name="arrow-forward" size={13} color="#0F172A" style={{ marginLeft: 4 }} />
                      </View>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Downward Arrow Icon */}
                {index < aspirantsArenaStages.length - 1 && (
                  <View style={styles.stepConnector}>
                    <View
                      style={[
                        styles.stepArrowCircle,
                        {
                          backgroundColor: isDark ? '#1E293B' : '#E2E8F0',
                          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                        },
                      ]}
                    >
                      <Icon name="arrow-down" size={13} color={isDark ? '#94A3B8' : '#64748B'} />
                    </View>
                  </View>
                )}
              </React.Fragment>
            ))}
          </View>
        )}
      </ScrollView>

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
              <View style={[styles.tipBox, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FEF3C7' }]}>
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  langBtnActive: {
    backgroundColor: '#0F62FE',
  },
  langBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  langBtnTextActive: {
    color: '#FFFFFF',
  },
  tabBarWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 11,
    position: 'relative',
  },
  tabButtonActive: {
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '700',
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
    right: 8,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  statStripText: {
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  stagesContainer: {
    gap: 4,
  },
  gridStagesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    paddingBottom: 20,
  },
  gridStageCard: {
    width: (width - 40) / 2,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    borderWidth: 1,
  },
  gridStageGradient: {
    paddingVertical: 14,
    paddingHorizontal: 13,
    minHeight: 196,
    justifyContent: 'space-between',
  },
  gridStageTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  gridStepBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gridStepBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  gridIconAndTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 5,
  },
  gridStageIconBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridStageTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0F172A',
    flex: 1,
    letterSpacing: -0.2,
  },
  gridStageSubtitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#334155',
    lineHeight: 15.5,
    marginBottom: 7,
  },
  gridFeaturesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 9,
  },
  gridFeatureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gridFeatureChipText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  gridStageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.12)',
  },
  gridActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderRadius: 12,
  },
  gridActionPillText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  stepConnector: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 1,
  },
  stepArrowCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stageCard: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    borderWidth: 1,
  },
  stageGradient: {
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  stageTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stageTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  stageIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBtn: {
    padding: 2,
  },
  stageTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
    flex: 1,
  },
  stageSubtitle: {
    color: '#334155',
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 8,
  },
  featuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
  },
  featureChipText: {
    color: '#1E293B',
    fontSize: 10.5,
    fontWeight: '800',
  },
  stageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.12)',
  },
  stageFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  stageMetricText: {
    color: '#334155',
    fontSize: 10.5,
    fontWeight: '700',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  actionPillText: {
    color: '#0F172A',
    fontSize: 11.5,
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
});

export default TriviaHubScreen;
