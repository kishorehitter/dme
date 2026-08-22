import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  TextInput,
  Modal,
  Platform,
  NativeModules,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';
import { getApiUrl } from '../config/network';
import { saveCustomSet } from '../services/CustomTriviaStorage';
import { parseQuestionFile, ParseError, Question } from '../utils/customQuestionParser';

interface ValidationIssue {
  questionNumber: string | number | null;
  reason: string;
  snippet?: string;
}

interface QuizPdfUploadScreenProps {
  navigation: any;
  route?: any;
}

type CreationMode = 'pdf' | 'txt_csv' | 'manual';

export const QuizPdfUploadScreen: React.FC<QuizPdfUploadScreenProps> = ({ navigation, route }) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      pinNavBarColor(theme.background, isDark);
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
      }
    }, [theme.background, isDark])
  );

  const [activeMode, setActiveMode] = useState<CreationMode>(route?.params?.initialMode || 'pdf');
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [setName, setSetName] = useState('');
  const [successQuestions, setSuccessQuestions] = useState<Question[] | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccessModalVisible, setSavedSuccessModalVisible] = useState(false);
  const [savedSetData, setSavedSetData] = useState<any | null>(null);

  // Manual In-App Builder state
  const [manualQuestions, setManualQuestions] = useState<Question[]>([
    { text: '', choices: ['', '', '', ''], correctIndex: 0 },
  ]);

  const resetState = () => {
    setSuccessQuestions(null);
    setIssues(null);
    setGenericError(null);
    setSelectedFileName(null);
  };

  const handleAddManualQuestion = () => {
    setManualQuestions([
      ...manualQuestions,
      { text: '', choices: ['', '', '', ''], correctIndex: 0 },
    ]);
  };

  const handleRemoveManualQuestion = (index: number) => {
    if (manualQuestions.length <= 1) {
      Alert.alert('Cannot Remove', 'Your quiz must have at least 1 question.');
      return;
    }
    const updated = manualQuestions.filter((_, i) => i !== index);
    setManualQuestions(updated);
  };

  const handleUpdateManualQuestionText = (index: number, text: string) => {
    const updated = [...manualQuestions];
    updated[index].text = text;
    setManualQuestions(updated);
  };

  const handleUpdateManualChoice = (qIndex: number, cIndex: number, text: string) => {
    const updated = [...manualQuestions];
    const choices = [...updated[qIndex].choices];
    choices[cIndex] = text;
    updated[qIndex].choices = choices;
    setManualQuestions(updated);
  };

  const handleChoiceFocus = (qIndex: number, cIndex: number) => {
    setTimeout(() => {
      const targetY = 170 + qIndex * 370 + 130 + cIndex * 46 - 150;
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, targetY),
        animated: true,
      });
    }, 100);
  };

  const handleSpeechInput = async (
    target: 'title' | { type: 'question'; qIndex: number } | { type: 'choice'; qIndex: number; cIndex: number }
  ) => {
    try {
      if (Platform.OS === 'android' && NativeModules.SpeechRecognition?.startSpeechRecognition) {
        let prompt = 'Speak to write...';
        if (target === 'title') prompt = 'Speak quiz title...';
        else if (target.type === 'question') prompt = `Speak question ${target.qIndex + 1}...`;
        else if (target.type === 'choice') prompt = 'Speak option...';

        const resultText: string = await NativeModules.SpeechRecognition.startSpeechRecognition(prompt);
        if (resultText && typeof resultText === 'string' && resultText.trim().length > 0) {
          if (target === 'title') {
            setSetName(prev => (prev ? `${prev} ${resultText.trim()}` : resultText.trim()));
          } else if (target.type === 'question') {
            const updated = [...manualQuestions];
            const current = updated[target.qIndex].text;
            updated[target.qIndex].text = current ? `${current} ${resultText.trim()}` : resultText.trim();
            setManualQuestions(updated);
          } else if (target.type === 'choice') {
            const updated = [...manualQuestions];
            const choices = [...updated[target.qIndex].choices];
            const current = choices[target.cIndex];
            choices[target.cIndex] = current ? `${current} ${resultText.trim()}` : resultText.trim();
            updated[target.qIndex].choices = choices;
            setManualQuestions(updated);
          }
        }
      } else {
        Alert.alert('Voice Input', 'Speech recognition is supported on Android devices with Google Speech services.');
      }
    } catch (err: any) {
      console.log('Speech recognition error/cancel:', err);
    }
  };

  const handleSaveManualSet = async () => {
    if (!setName.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your custom quiz.');
      return;
    }

    const invalid = manualQuestions.some(
      q => !q.text.trim() || q.choices.some(c => !c.trim())
    );
    if (invalid) {
      Alert.alert('Incomplete Form', 'Please ensure all questions and 4 options are filled in.');
      return;
    }

    try {
      setSaving(true);
      const newSet = await saveCustomSet(setName.trim(), manualQuestions);
      setSavedSetData(newSet);
      setSavedSuccessModalVisible(true);
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save manual quiz.');
    } finally {
      setSaving(false);
    }
  };

  const handlePickAndParseTxtCsv = async () => {
    resetState();
    try {
      setParsing(true);
      const res = await pick({
        type: [types.plainText, types.csv],
        allowMultiSelection: false,
      });

      if (!res || res.length === 0) return;

      const file = res[0];
      const fileUri = file.uri;
      const fileName = file.name || 'questions.txt';
      const fileExt = (fileName.split('.').pop() || 'txt').toLowerCase();
      setSelectedFileName(fileName);

      let fileContent = '';
      let readPath = fileUri;

      if (fileUri.startsWith('content://')) {
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = `${RNFS.CachesDirectoryPath}/${safeName}`;
        try {
          if (await RNFS.exists(destPath)) {
            await RNFS.unlink(destPath);
          }
          await RNFS.copyFile(fileUri, destPath);
          readPath = destPath;
        } catch (copyErr) {
          console.log('Copy file error, using original URI:', copyErr);
        }
      }

      fileContent = await RNFS.readFile(readPath, 'utf8');
      const result = parseQuestionFile(fileContent, fileExt);

      if (!setName.trim()) {
        const defaultName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        setSetName(defaultName);
      }

      if (result.errors && result.errors.length > 0) {
        const formattedIssues: ValidationIssue[] = result.errors.map(e => ({
          questionNumber: e.questionNumber || 'File',
          reason: e.message,
          snippet: e.snippet,
        }));
        setIssues(formattedIssues);
        setGenericError('Some questions in your file could not be parsed.');
      }

      if (result.questions && result.questions.length > 0) {
        setSuccessQuestions(result.questions);
      } else if (!result.errors || result.errors.length === 0) {
        setGenericError('No questions found in this file. Please check the format.');
      }
    } catch (err: any) {
      if (
        (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) ||
        err?.code === 'OPERATION_CANCELED' ||
        err?.code === 'DOCUMENT_PICKER_CANCELED' ||
        err?.message?.toLowerCase().includes('cancel')
      ) {
        return;
      }
      console.error('[TxtCsvParse] Error:', err);
      setGenericError(err?.message || 'Failed to read the file.');
    } finally {
      setParsing(false);
    }
  };

  const handlePickAndConvertPdf = async () => {
    resetState();

    try {
      const res = await pick({
        type: [types.pdf],
        allowMultiSelection: false,
      });

      if (!res || res.length === 0) return;

      const file = res[0];
      const fileUri = file.uri;
      const fileName = file.name || 'quiz.pdf';
      setSelectedFileName(fileName);

      setLoading(true);

      // Handle Android content URI by ensuring a safe local file path
      let uploadUri = fileUri;
      if (Platform.OS === 'android' && fileUri.startsWith('content://')) {
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = `${RNFS.CachesDirectoryPath}/${safeName}`;
        try {
          if (await RNFS.exists(destPath)) {
            await RNFS.unlink(destPath);
          }
          await RNFS.copyFile(fileUri, destPath);
          uploadUri = `file://${destPath}`;
        } catch (copyErr) {
          console.log('[QuizPdfUpload] Copy to cache note:', copyErr);
        }
      }

      const formData = new FormData();
      formData.append('file', {
        uri: uploadUri,
        type: 'application/pdf',
        name: fileName,
      } as any);
      formData.append('category', 'general');
      formData.append('difficulty', 'medium');

      const apiUrl = getApiUrl('trivia/convert-quiz/');
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json();

      if (response.status === 422) {
        // PDF has fixable structural/formatting issues
        setIssues(data.issues || []);
        setGenericError(data.error || 'Some questions could not be parsed.');
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || `Server error (${response.status})`);
      }

      // If user hasn't typed a title yet, default to sanitized filename
      if (!setName.trim()) {
        const defaultName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        setSetName(defaultName);
      }
      setSuccessQuestions(data.questions || []);
    } catch (err: any) {
      if (
        (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) ||
        err?.code === 'OPERATION_CANCELED' ||
        err?.code === 'DOCUMENT_PICKER_CANCELED' ||
        err?.code === 'ERR_DOCUMENT_PICKER_CANCELED' ||
        err?.code === 'DOCUMENT_PICKER_CANCELLED' ||
        err?.message?.toLowerCase().includes('cancel') ||
        err?.message?.toLowerCase().includes('canceled') ||
        err?.message?.toLowerCase().includes('cancelled') ||
        err?.message?.toLowerCase().includes('user dismiss')
      ) {
        return; // User cancelled without selecting a file - return silently, no alert or modal
      }
      console.error('[QuizPdfUpload] Error:', err);
      setGenericError(err?.message || 'Failed to convert the PDF.');
      Alert.alert('Conversion Failed', err?.message || 'Please ensure your PDF is text-based and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndPlay = async (autoPlay: boolean) => {
    if (!successQuestions || successQuestions.length === 0) return;
    if (!setName.trim()) {
      Alert.alert('Missing Name', 'Please enter a name for your quiz set.');
      return;
    }

    try {
      setSaving(true);
      const newSet = await saveCustomSet(setName.trim(), successQuestions);

      if (autoPlay) {
        navigation.navigate('TriviaSolo', {
          customQuestions: newSet.questions,
          customSetName: newSet.name,
          customCategoryId: 'custom',
        });
      } else {
        setSavedSetData(newSet);
        setSavedSuccessModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save the quiz set.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.background} />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === 'android' ? 10 : 6),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            borderBottomColor: theme.border,
            backgroundColor: theme.surface,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Create Quiz & Contest</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── 3-Way Mode Switcher (PDF / TXT-CSV / Manual) ── */}
      <View style={[styles.modeTabBar, { backgroundColor: isDark ? '#071527' : '#F1F5F9' }]}>
        <TouchableOpacity
          style={[styles.modeTabBtn, activeMode === 'pdf' && styles.modeTabBtnActive]}
          onPress={() => {
            setActiveMode('pdf');
            resetState();
          }}
        >
          <Icon
            name="document-text"
            size={16}
            color={activeMode === 'pdf' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B')}
            style={{ marginRight: 5 }}
          />
          <Text
            style={[
              styles.modeTabBtnText,
              { color: activeMode === 'pdf' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
              activeMode === 'pdf' && { fontWeight: '800' },
            ]}
          >
            PDF (AI)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeTabBtn, activeMode === 'txt_csv' && styles.modeTabBtnActive]}
          onPress={() => {
            setActiveMode('txt_csv');
            resetState();
          }}
        >
          <Icon
            name="cloud-upload"
            size={16}
            color={activeMode === 'txt_csv' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B')}
            style={{ marginRight: 5 }}
          />
          <Text
            style={[
              styles.modeTabBtnText,
              { color: activeMode === 'txt_csv' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
              activeMode === 'txt_csv' && { fontWeight: '800' },
            ]}
          >
            TXT / CSV
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeTabBtn, activeMode === 'manual' && styles.modeTabBtnActive]}
          onPress={() => {
            setActiveMode('manual');
            resetState();
          }}
        >
          <Icon
            name="create"
            size={16}
            color={activeMode === 'manual' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B')}
            style={{ marginRight: 5 }}
          />
          <Text
            style={[
              styles.modeTabBtnText,
              { color: activeMode === 'manual' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
              activeMode === 'manual' && { fontWeight: '800' },
            ]}
          >
            Manual
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + (keyboardHeight > 0 ? keyboardHeight + 16 : 40),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Highlighted Custom Quiz Title Card */}
        <View
          style={[
            styles.highlightedTitleCard,
            {
              backgroundColor: isDark ? '#081C38' : '#EFF6FF',
              borderColor: isDark ? '#0284C7' : '#3B82F6',
            },
          ]}
        >
          {/* Header Row with Badge */}
          <View style={styles.titleCardHeaderRow}>
            <View style={styles.titleCardLeft}>
              <View style={[styles.titleIconBadge, { backgroundColor: isDark ? '#0284C7' : '#2563EB' }]}>
                <Icon name="bookmark" size={18} color="#FFF" />
              </View>
              <View>
                <Text style={[styles.titleCardHeading, { color: theme.textPrimary }]}>Quiz Title</Text>
                <Text style={[styles.titleCardSub, { color: isDark ? '#93C5FD' : '#2563EB' }]}>
                  Give your quiz a custom name
                </Text>
              </View>
            </View>
            <View style={[styles.titleStatusBadge, { backgroundColor: isDark ? 'rgba(56,189,248,0.2)' : '#DBEAFE' }]}>
              <Text style={[styles.titleStatusBadgeText, { color: isDark ? '#38BDF8' : '#1D4ED8' }]}>
                {setName.trim() ? '✓ Named' : (activeMode === 'manual' ? 'Required' : 'Optional')}
              </Text>
            </View>
          </View>

          {/* Highlighted Input Box */}
          <View
            style={[
              styles.highlightedInputWrapper,
              {
                backgroundColor: isDark ? '#041024' : '#FFFFFF',
                borderColor: setName.trim()
                  ? (isDark ? '#38BDF8' : '#2563EB')
                  : (isDark ? 'rgba(56,189,248,0.3)' : '#BFDBFE'),
              },
            ]}
          >
            <Icon
              name="pencil-outline"
              size={18}
              color={setName.trim() ? (isDark ? '#38BDF8' : '#2563EB') : (isDark ? '#64748B' : '#94A3B8')}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={[styles.highlightedInput, { color: theme.textPrimary }]}
              value={setName}
              onChangeText={setSetName}
              placeholder="e.g. Science Chapter 1 Test"
              placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
            />
            <TouchableOpacity
              onPress={() => handleSpeechInput('title')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingHorizontal: 6 }}
            >
              <Icon name="mic" size={19} color={isDark ? '#38BDF8' : '#2563EB'} />
            </TouchableOpacity>
            {setName.trim().length > 0 && (
              <TouchableOpacity onPress={() => setSetName('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={18} color={isDark ? '#64748B' : '#94A3B8'} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.titleCardFooterHint, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            {activeMode === 'manual'
              ? '💡 Required title for this in-app quiz set.'
              : '💡 Leave blank to auto-use your file name.'}
          </Text>
        </View>

        {/* ── MODE 1: PDF CONVERTER ── */}
        {activeMode === 'pdf' && (
          <>
            {/* Format Guidelines Card */}
            <View style={[styles.card, { backgroundColor: isDark ? '#0B1B2D' : '#F8FAFC', borderColor: theme.border }]}>
              <View style={styles.cardTitleRow}>
                <Icon name="document-text-outline" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Expected PDF Format</Text>
              </View>
              <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                Upload a text-based PDF where each question is numbered, followed by 4 choices (A–D), and a{' '}
                <Text style={{ fontWeight: 'bold', color: isDark ? '#38BDF8' : '#0F62FE' }}>*</Text> directly before the correct option letter.
              </Text>

              <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                  {`1. What is the capital of France?\nA. London\n*B. Paris\nC. Rome\nD. Berlin`}
                </Text>
              </View>
            </View>

            {/* Upload PDF Action Card */}
            <TouchableOpacity
              style={[styles.uploadBox, { borderColor: isDark ? 'rgba(56,189,248,0.4)' : 'rgba(15,98,254,0.3)', backgroundColor: isDark ? '#071527' : '#F0F6FF' }]}
              onPress={handlePickAndConvertPdf}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color={isDark ? '#38BDF8' : '#0F62FE'} />
                  <Text style={[styles.loadingText, { color: theme.textPrimary }]}>Extracting & validating PDF...</Text>
                  <Text style={[styles.loadingSubText, { color: theme.textSecondary }]}>Checking questions, options & answer markers</Text>
                </View>
              ) : (
                <View style={styles.uploadInner}>
                  <View style={[styles.uploadIconCircle, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(15,98,254,0.1)' }]}>
                    <Icon name="cloud-upload-outline" size={36} color={isDark ? '#38BDF8' : '#0F62FE'} />
                  </View>
                  <Text style={[styles.uploadTitle, { color: theme.textPrimary }]}>
                    {selectedFileName ? selectedFileName : 'Tap to Choose Quiz PDF'}
                  </Text>
                  <Text style={[styles.uploadSub, { color: theme.textSecondary }]}>
                    Supports text-based .pdf files up to 10MB
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── MODE 2: TXT / CSV IMPORTER ── */}
        {activeMode === 'txt_csv' && (
          <>
            {/* Format Guidelines Card */}
            <View style={[styles.card, { backgroundColor: isDark ? '#0B1B2D' : '#F8FAFC', borderColor: theme.border }]}>
              <View style={styles.cardTitleRow}>
                <Icon name="document-outline" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Expected TXT / CSV Format</Text>
              </View>
              <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                Upload a <Text style={{ fontWeight: 'bold', color: isDark ? '#38BDF8' : '#0F62FE' }}>.txt</Text> or <Text style={{ fontWeight: 'bold', color: isDark ? '#38BDF8' : '#0F62FE' }}>.csv</Text> file. For TXT, mark the correct answer with an asterisk (*). For CSV, provide columns: Question, Choice A, Choice B, Choice C, Choice D, Correct Answer (1-4 or A-D).
              </Text>

              <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                  {`1. Which planet is closest to the Sun?\n*A. Mercury\nB. Venus\nC. Earth\nD. Mars`}
                </Text>
              </View>
            </View>

            {/* Upload TXT / CSV Action Card */}
            <TouchableOpacity
              style={[styles.uploadBox, { borderColor: isDark ? 'rgba(56,189,248,0.4)' : 'rgba(15,98,254,0.3)', backgroundColor: isDark ? '#071527' : '#F0F6FF' }]}
              onPress={handlePickAndParseTxtCsv}
              disabled={parsing}
              activeOpacity={0.8}
            >
              {parsing ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color={isDark ? '#38BDF8' : '#0F62FE'} />
                  <Text style={[styles.loadingText, { color: theme.textPrimary }]}>Parsing TXT / CSV file...</Text>
                </View>
              ) : (
                <View style={styles.uploadInner}>
                  <View style={[styles.uploadIconCircle, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(15,98,254,0.1)' }]}>
                    <Icon name="document-text-outline" size={36} color={isDark ? '#38BDF8' : '#0F62FE'} />
                  </View>
                  <Text style={[styles.uploadTitle, { color: theme.textPrimary }]}>
                    {selectedFileName ? selectedFileName : 'Tap to Choose TXT or CSV File'}
                  </Text>
                  <Text style={[styles.uploadSub, { color: theme.textSecondary }]}>
                    Supports structured .txt and .csv files
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── MODE 3: MANUAL IN-APP BUILDER ── */}
        {activeMode === 'manual' && (
          <View style={{ gap: 14 }}>
            {manualQuestions.map((q, qIndex) => (
              <View
                key={qIndex}
                style={[
                  styles.manualQuestionCard,
                  {
                    backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                  },
                ]}
              >
                <View style={styles.manualCardHeader}>
                  <View style={[styles.manualQBadge, { backgroundColor: isDark ? '#0284C7' : '#2563EB' }]}>
                    <Text style={styles.manualQBadgeText}>Q{qIndex + 1}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => handleSpeechInput({ type: 'question', qIndex })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={[styles.questionMicBtn, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : '#EFF6FF' }]}
                    >
                      <Icon name="mic" size={16} color={isDark ? '#38BDF8' : '#2563EB'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemoveManualQuestion(qIndex)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                <TextInput
                  style={[
                    styles.manualQuestionInput,
                    {
                      backgroundColor: isDark ? '#071527' : '#F8FAFC',
                      color: theme.textPrimary,
                      borderColor: theme.border,
                    },
                  ]}
                  placeholder={`Enter question ${qIndex + 1}...`}
                  placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
                  value={q.text}
                  onChangeText={(txt) => handleUpdateManualQuestionText(qIndex, txt)}
                  onFocus={() => handleQuestionFocus(qIndex)}
                  multiline
                />

                <Text style={[styles.manualChoiceLabel, { color: theme.textSecondary }]}>
                  Options (Tap circle to set correct answer):
                </Text>

                {q.choices.map((choice, cIndex) => {
                  const isCorrect = q.correctIndex === cIndex;
                  const optLetters = ['A', 'B', 'C', 'D'];
                  return (
                    <View key={cIndex} style={styles.manualChoiceRow}>
                      <TouchableOpacity
                        style={[
                          styles.manualRadioCircle,
                          {
                            borderColor: isCorrect ? '#10B981' : (isDark ? '#64748B' : '#94A3B8'),
                            backgroundColor: isCorrect ? '#10B981' : 'transparent',
                          },
                        ]}
                        onPress={() => handleSetManualCorrect(qIndex, cIndex)}
                      >
                        {isCorrect ? (
                          <Icon name="checkmark" size={12} color="#FFF" />
                        ) : (
                          <Text style={{ fontSize: 10, fontWeight: '700', color: isDark ? '#94A3B8' : '#64748B' }}>
                            {optLetters[cIndex]}
                          </Text>
                        )}
                      </TouchableOpacity>

                      <View style={styles.manualChoiceInputContainer}>
                        <TextInput
                          style={[
                            styles.manualChoiceInput,
                            {
                              backgroundColor: isDark ? '#071527' : '#F8FAFC',
                              color: theme.textPrimary,
                              borderColor: isCorrect ? '#10B981' : theme.border,
                            },
                          ]}
                          placeholder={`Option ${optLetters[cIndex]}`}
                          placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
                          value={choice}
                          onChangeText={(txt) => handleUpdateManualChoice(qIndex, cIndex, txt)}
                          onFocus={() => handleChoiceFocus(qIndex, cIndex)}
                        />
                        <TouchableOpacity
                          style={styles.choiceMicInsideBtn}
                          onPress={() => handleSpeechInput({ type: 'choice', qIndex, cIndex })}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Icon name="mic-outline" size={17} color={isDark ? '#38BDF8' : '#2563EB'} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}

            {/* Add Question Button */}
            <TouchableOpacity
              style={[styles.addQuestionBtn, { borderColor: isDark ? '#0284C7' : '#3B82F6' }]}
              onPress={handleAddManualQuestion}
            >
              <Icon name="add" size={20} color={isDark ? '#38BDF8' : '#2563EB'} style={{ marginRight: 6 }} />
              <Text style={[styles.addQuestionBtnText, { color: isDark ? '#38BDF8' : '#2563EB' }]}>
                Add Another Question
              </Text>
            </TouchableOpacity>

            {/* Save Manual Quiz Button */}
            <TouchableOpacity
              style={styles.saveManualBtn}
              onPress={handleSaveManualSet}
              disabled={saving}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#0F62FE', '#0052CC']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveManualGradient}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Icon name="save-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.saveManualText}>Save Quiz Set ({manualQuestions.length} Qs)</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Generic Error Banner */}
        {genericError && !issues && (
          <View style={styles.errorBanner}>
            <Icon name="alert-circle" size={20} color="#EF4444" style={{ marginRight: 8 }} />
            <Text style={styles.errorBannerText}>{genericError}</Text>
          </View>
        )}

        {/* 422 Issues Breakdown List */}
        {issues && issues.length > 0 && (
          <View style={styles.issuesContainer}>
            <View style={styles.issuesHeader}>
              <Icon name="warning" size={20} color="#F59E0B" style={{ marginRight: 8 }} />
              <Text style={styles.issuesTitle}>
                {issues.length} Issue{issues.length > 1 ? 's' : ''} Found — Fix and Re-upload
              </Text>
            </View>
            <Text style={[styles.issuesSub, { color: theme.textSecondary }]}>
              {genericError || 'The following questions in your PDF need corrections:'}
            </Text>

            {issues.map((issue, idx) => (
              <View key={idx} style={[styles.issueCard, { backgroundColor: isDark ? '#1C150A' : '#FFFBEB', borderColor: isDark ? '#78350F' : '#FCD34D' }]}>
                <View style={styles.issueTopRow}>
                  <View style={styles.issueBadge}>
                    <Text style={styles.issueBadgeText}>
                      {issue.questionNumber ? `Q${issue.questionNumber}` : 'Format'}
                    </Text>
                  </View>
                  {issue.snippet ? (
                    <Text style={[styles.issueSnippet, { color: isDark ? '#FDE68A' : '#92400E' }]} numberOfLines={1}>
                      "{issue.snippet}"
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.issueReason, { color: isDark ? '#FCD34D' : '#78350F' }]}>
                  {issue.reason}
                </Text>
              </View>
            ))}

            <TouchableOpacity style={styles.retryButton} onPress={handlePickAndConvertPdf}>
              <Icon name="refresh" size={18} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.retryButtonText}>Choose Fixed PDF</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 200 Success State & Questions Preview */}
        {successQuestions && successQuestions.length > 0 && (
          <View style={styles.successContainer}>
            <View style={[styles.successBanner, { backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : '#DCFCE7', borderColor: isDark ? '#22C55E' : '#86EFAC' }]}>
              <Icon name="checkmark-circle" size={24} color="#22C55E" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.successTitle, { color: isDark ? '#4ADE80' : '#166534' }]}>
                  {successQuestions.length} Questions Converted!
                </Text>
                <Text style={[styles.successSub, { color: isDark ? '#86EFAC' : '#15803D' }]}>
                  All questions, choices, and answer keys are fully verified.
                </Text>
              </View>
            </View>

            {/* Highlighted Editable Quiz Title */}
            <View
              style={[
                styles.highlightedTitleCard,
                {
                  backgroundColor: isDark ? '#081C38' : '#EFF6FF',
                  borderColor: isDark ? '#0284C7' : '#3B82F6',
                  marginBottom: 18,
                },
              ]}
            >
              <View style={styles.titleCardHeaderRow}>
                <View style={styles.titleCardLeft}>
                  <View style={[styles.titleIconBadge, { backgroundColor: isDark ? '#0284C7' : '#2563EB' }]}>
                    <Icon name="bookmark" size={18} color="#FFF" />
                  </View>
                  <View>
                    <Text style={[styles.titleCardHeading, { color: theme.textPrimary }]}>Quiz Set Name</Text>
                    <Text style={[styles.titleCardSub, { color: isDark ? '#93C5FD' : '#2563EB' }]}>
                      Review or edit title before saving
                    </Text>
                  </View>
                </View>
                <View style={[styles.titleStatusBadge, { backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : '#DCFCE7' }]}>
                  <Text style={[styles.titleStatusBadgeText, { color: isDark ? '#4ADE80' : '#166534' }]}>
                    Ready
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.highlightedInputWrapper,
                  {
                    backgroundColor: isDark ? '#041024' : '#FFFFFF',
                    borderColor: isDark ? '#38BDF8' : '#2563EB',
                  },
                ]}
              >
                <Icon name="pencil" size={18} color={isDark ? '#38BDF8' : '#2563EB'} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.highlightedInput, { color: theme.textPrimary }]}
                  value={setName}
                  onChangeText={setSetName}
                  placeholder="Enter a name for this quiz set"
                  placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
                />
                {setName.trim().length > 0 && (
                  <TouchableOpacity onPress={() => setSetName('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="close-circle" size={18} color={isDark ? '#64748B' : '#94A3B8'} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Questions Preview */}
            <Text style={[styles.previewHeading, { color: theme.textPrimary }]}>Questions Preview</Text>
            {successQuestions.map((q, qIndex) => (
              <View key={qIndex} style={[styles.previewCard, { backgroundColor: isDark ? '#071527' : '#FFFFFF', borderColor: theme.border }]}>
                <Text style={[styles.previewQuestionText, { color: theme.textPrimary }]}>
                  {qIndex + 1}. {q.text}
                </Text>
                <View style={styles.choicesList}>
                  {q.choices.map((choice, cIndex) => {
                    const isCorrect = cIndex === q.correctIndex;
                    const letter = String.fromCharCode(65 + cIndex);
                    return (
                      <View
                        key={cIndex}
                        style={[
                          styles.choiceItem,
                          isCorrect && {
                            backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : '#DCFCE7',
                            borderColor: isDark ? '#22C55E' : '#86EFAC',
                          },
                        ]}
                      >
                        <Text style={[styles.choiceLetter, { color: isCorrect ? '#22C55E' : theme.textSecondary }]}>
                          {letter}.
                        </Text>
                        <Text style={[styles.choiceText, { color: isCorrect ? (isDark ? '#4ADE80' : '#166534') : theme.textSecondary }]}>
                          {choice}
                        </Text>
                        {isCorrect && <Icon name="checkmark" size={16} color="#22C55E" style={{ marginLeft: 'auto' }} />}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Action Buttons */}
            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                style={[styles.saveButton, styles.primaryPlayBtn]}
                onPress={() => handleSaveAndPlay(true)}
                disabled={saving}
              >
                <LinearGradient
                  colors={['#10B981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientBtnInner}
                >
                  <Icon name="play" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.actionBtnText}>Save & Play Now</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}
                onPress={() => handleSaveAndPlay(false)}
                disabled={saving}
              >
                <View style={styles.gradientBtnInner}>
                  <Icon name="bookmark-outline" size={20} color={theme.textPrimary} style={{ marginRight: 8 }} />
                  <Text style={[styles.actionBtnText, { color: theme.textPrimary }]}>Save to Sets</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* MODERN SAVED SUCCESS MODAL */}
      <Modal
        visible={savedSuccessModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setSavedSuccessModalVisible(false);
          navigation.navigate('CustomTriviaSets');
        }}
      >
        <View style={styles.successModalOverlay}>
          <View
            style={[
              styles.successModalCard,
              {
                backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            {/* Celebration Icon Glow */}
            <View style={styles.successIconCircle}>
              <Icon name="checkmark-circle" size={44} color="#10B981" />
            </View>

            {/* Title & Subtitle */}
            <Text style={[styles.successModalTitle, { color: theme.textPrimary }]}>
              PDF Quiz Saved! 🎉
            </Text>
            <Text style={[styles.successModalSubText, { color: theme.textSecondary }]}>
              Your questions have been converted and saved to your Custom Quizzes.
            </Text>

            {/* Quiz Info Pill Card */}
            {savedSetData && (
              <View
                style={[
                  styles.savedSetInfoCard,
                  {
                    backgroundColor: isDark ? '#071527' : '#F1F5F9',
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.25)',
                  },
                ]}
              >
                <View style={styles.savedIconBox}>
                  <Icon name="document-text" size={24} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.savedSetName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {savedSetData.name}
                  </Text>
                  <Text style={[styles.savedSetDetails, { color: theme.textSecondary }]}>
                    {savedSetData.questionCount} Questions • Ready to Play
                  </Text>
                </View>
              </View>
            )}

            {/* Action Buttons Stack */}
            <View style={styles.successBtnStack}>
              {/* Play Now Button */}
              <TouchableOpacity
                style={styles.successPlayBtn}
                onPress={() => {
                  setSavedSuccessModalVisible(false);
                  if (savedSetData) {
                    navigation.navigate('TriviaSolo', {
                      customQuestions: savedSetData.questions,
                      customSetName: savedSetData.name,
                      customCategoryId: 'custom',
                    });
                  }
                }}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#10B981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.successPlayGradient}
                >
                  <Icon name="play" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.successPlayBtnText}>Play Quiz Now</Text>
                </LinearGradient>
              </TouchableOpacity>

              {/* View Sets Button */}
              <TouchableOpacity
                style={[
                  styles.successCloseBtn,
                  {
                    backgroundColor: isDark ? '#1E293B' : '#E2E8F0',
                  },
                ]}
                onPress={() => {
                  setSavedSuccessModalVisible(false);
                  navigation.navigate('CustomTriviaSets');
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.successCloseBtnText, { color: theme.textPrimary }]}>
                  View All Quizzes
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 16 },

  modeTabBar: {
    flexDirection: 'row',
    padding: 4,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    gap: 6,
  },
  modeTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 11,
  },
  modeTabBtnActive: {
    backgroundColor: '#0F62FE',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  modeTabBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },

  card: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  manualQuestionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  manualCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  manualQBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualQBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  manualQuestionInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 50,
    marginBottom: 12,
  },
  manualChoiceLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 8,
  },
  manualChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  questionMicBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualChoiceInputContainer: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  choiceMicInsideBtn: {
    position: 'absolute',
    right: 8,
    height: 28,
    width: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualRadioCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualChoiceInput: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 34,
    paddingVertical: 8,
    fontSize: 13.5,
  },
  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginBottom: 10,
  },
  addQuestionBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  saveManualBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    marginBottom: 20,
  },
  saveManualGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  saveManualText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  highlightedTitleCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  titleCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  titleIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleCardHeading: {
    fontSize: 16,
    fontWeight: '700',
  },
  titleCardSub: {
    fontSize: 12,
    marginTop: 1,
  },
  titleStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  titleStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  highlightedInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 6,
  },
  highlightedInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 8,
  },
  titleCardFooterHint: {
    fontSize: 11,
    marginTop: 4,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardHeading: { fontSize: 15, fontWeight: '700' },
  cardDescription: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  codeBox: {
    padding: 12,
    borderRadius: 8,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },

  uploadBox: {
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  uploadInner: { alignItems: 'center' },
  uploadIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  uploadTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  uploadSub: { fontSize: 13, textAlign: 'center' },
  loadingBox: { alignItems: 'center', paddingVertical: 12 },
  loadingText: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  loadingSubText: { fontSize: 12, marginTop: 4 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorBannerText: { color: '#991B1B', fontSize: 13, flex: 1, fontWeight: '500' },

  issuesContainer: { marginTop: 8, marginBottom: 16 },
  issuesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  issuesTitle: { fontSize: 16, fontWeight: '700', color: '#D97706' },
  issuesSub: { fontSize: 13, marginBottom: 12 },
  issueCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  issueTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  issueBadge: {
    backgroundColor: '#D97706',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  issueBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  issueSnippet: { fontSize: 13, fontWeight: '600', flex: 1 },
  issueReason: { fontSize: 13, lineHeight: 18 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F62FE',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryButtonText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  successContainer: { marginTop: 8 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  successTitle: { fontSize: 15, fontWeight: '700' },
  successSub: { fontSize: 12, marginTop: 2 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  previewHeading: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  previewCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  previewQuestionText: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  choicesList: { gap: 6 },
  choiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceLetter: { fontWeight: '700', marginRight: 6, fontSize: 13 },
  choiceText: { fontSize: 13, flex: 1 },

  actionButtonsRow: { gap: 10, marginTop: 16 },
  saveButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  primaryPlayBtn: {
    elevation: 3,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  gradientBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  actionBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  /* Modern Saved Success Modal Styles */
  successModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  successModalSubText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  savedSetInfoCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 22,
  },
  savedIconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  savedSetName: {
    fontSize: 15,
    fontWeight: '700',
  },
  savedSetDetails: {
    fontSize: 12,
    marginTop: 2,
  },
  successBtnStack: {
    width: '100%',
    gap: 10,
  },
  successPlayBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  successPlayGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  successPlayBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  successCloseBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCloseBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
