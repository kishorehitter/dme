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
  KeyboardAvoidingView,
  PermissionsAndroid,
  DeviceEventEmitter,
  Animated,
  Easing,
  BackHandler,
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
  const [setName, setSetName] = useState(route?.params?.prefillTitle || '');

  // Title edit modal
  const [titleEditModalVisible, setTitleEditModalVisible] = useState(false);
  const [titleEditDraft, setTitleEditDraft] = useState('');
  const TITLE_MAX_LENGTH = 50;
  // Format guidance modal
  const [guidanceModalVisible, setGuidanceModalVisible] = useState(false);
  const [guidanceTab, setGuidanceTab] = useState<CreationMode>('pdf');
  const [successQuestions, setSuccessQuestions] = useState<Question[] | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccessModalVisible, setSavedSuccessModalVisible] = useState(false);
  const [savedSetData, setSavedSetData] = useState<any | null>(null);

  // Manual In-App Builder state
  const [manualQuestions, setManualQuestions] = useState<Question[]>([]);

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
    const updated = manualQuestions.filter((_, i) => i !== index);
    setManualQuestions(updated);
    manualQuestionsRef.current = updated;
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

  const handleSetManualCorrect = (qIndex: number, cIndex: number) => {
    const updated = [...manualQuestions];
    updated[qIndex].correctIndex = cIndex;
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

  const handleQuestionFocus = (qIndex: number) => {
    setTimeout(() => {
      const targetY = 170 + qIndex * 370 - 30;
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, targetY),
        animated: true,
      });
    }, 100);
  };

  type VoiceTarget = 'title' | { type: 'question'; qIndex: number } | { type: 'choice'; qIndex: number; cIndex: number };

  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<VoiceTarget | null>(null);
  const [voiceLiveText, setVoiceLiveText] = useState('');
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [isAutoVoiceActive, setIsAutoVoiceActive] = useState(false);
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const voiceTargetRef = useRef(voiceTarget);
  voiceTargetRef.current = voiceTarget;
  const voiceLiveTextRef = useRef(voiceLiveText);
  voiceLiveTextRef.current = voiceLiveText;
  const isAutoVoiceActiveRef = useRef(isAutoVoiceActive);
  isAutoVoiceActiveRef.current = isAutoVoiceActive;
  const manualQuestionsRef = useRef(manualQuestions);
  manualQuestionsRef.current = manualQuestions;
  const setNameRef = useRef(setName);
  setNameRef.current = setName;

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (voiceModalVisible) {
          setVoiceModalVisible(false);
          return true;
        }
        if (guidanceModalVisible) {
          setGuidanceModalVisible(false);
          return true;
        }
        if (titleEditModalVisible) {
          setTitleEditModalVisible(false);
          return true;
        }
        if (savedSuccessModalVisible) {
          setSavedSuccessModalVisible(false);
          return true;
        }
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('TriviaHub');
        }
        return true;
      };

      const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => backSub.remove();
    }, [voiceModalVisible, guidanceModalVisible, titleEditModalVisible, savedSuccessModalVisible, navigation])
  );

  useEffect(() => {
    const subReady = DeviceEventEmitter.addListener('onSpeechReady', () => {
      console.log('Speech recognition ready');
      setIsVoiceListening(true);
    });
    const subStart = DeviceEventEmitter.addListener('onSpeechStart', () => {
      console.log('Speech recognition started');
      setIsVoiceListening(true);
    });
    const subPartial = DeviceEventEmitter.addListener('onSpeechPartialResults', (e: { text?: string }) => {
      if (e?.text) {
        setVoiceLiveText(e.text);
      }
    });
    const subResults = DeviceEventEmitter.addListener('onSpeechResults', (e: { text?: string }) => {
      if (e?.text) {
        setVoiceLiveText(e.text);
      }
      setIsVoiceListening(false);
    });
    const subError = DeviceEventEmitter.addListener('onSpeechError', (e: { code?: number; message?: string }) => {
      console.log('onSpeechError:', e);
      setIsVoiceListening(false);
      if (e?.code === 9) {
        Alert.alert(
          'Microphone Permission Required',
          'Please grant microphone permission to use voice dictation. You can also type directly in the text field.'
        );
      }
    });
    const subEnd = DeviceEventEmitter.addListener('onSpeechEnd', () => {
      console.log('Speech recognition ended');
      setIsVoiceListening(false);
    });

    return () => {
      subReady.remove();
      subStart.remove();
      subPartial.remove();
      subResults.remove();
      subError.remove();
      subEnd.remove();
    };
  }, []);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (voiceModalVisible && isVoiceListening) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(voicePulseAnim, {
            toValue: 1.25,
            duration: 600,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(voicePulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ])
      );
      animation.start();
    } else {
      voicePulseAnim.setValue(1);
    }
    return () => animation?.stop();
  }, [voiceModalVisible, isVoiceListening]);

  const getVoiceTargetTitle = () => {
    if (!voiceTarget) return 'Question Builder';
    if (voiceTarget === 'title') return 'Quiz Title';
    if (voiceTarget.type === 'question') return `Question ${voiceTarget.qIndex + 1}`;
    if (voiceTarget.type === 'choice') {
      const letters = ['A', 'B', 'C', 'D'];
      return `Question ${voiceTarget.qIndex + 1} • Option ${letters[voiceTarget.cIndex]} (${voiceTarget.cIndex + 1}/4)`;
    }
    return 'Question Builder';
  };

  const getNextVoiceTarget = (currentTarget: VoiceTarget): { nextTarget: VoiceTarget; needNewQuestion: boolean } => {
    if (currentTarget === 'title') {
      return { nextTarget: { type: 'question', qIndex: 0 }, needNewQuestion: false };
    }
    if (currentTarget.type === 'question') {
      return { nextTarget: { type: 'choice', qIndex: currentTarget.qIndex, cIndex: 0 }, needNewQuestion: false };
    }
    if (currentTarget.type === 'choice') {
      if (currentTarget.cIndex < 3) {
        return {
          nextTarget: { type: 'choice', qIndex: currentTarget.qIndex, cIndex: currentTarget.cIndex + 1 },
          needNewQuestion: false,
        };
      } else {
        const nextQIndex = currentTarget.qIndex + 1;
        const needNew = nextQIndex >= manualQuestionsRef.current.length;
        return {
          nextTarget: { type: 'question', qIndex: nextQIndex },
          needNewQuestion: needNew,
        };
      }
    }
    return { nextTarget: { type: 'question', qIndex: 0 }, needNewQuestion: false };
  };

  const findResumeTarget = (questions: Question[]): { target: VoiceTarget; needNewQuestion: boolean } => {
    if (!questions || questions.length === 0) {
      return { target: { type: 'question', qIndex: 0 }, needNewQuestion: true };
    }
    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const q = questions[qIdx];
      if (!q.text || !q.text.trim()) {
        return { target: { type: 'question', qIndex: qIdx }, needNewQuestion: false };
      }
      for (let cIdx = 0; cIdx < 4; cIdx++) {
        if (!q.choices?.[cIdx] || !q.choices[cIdx].trim()) {
          return { target: { type: 'choice', qIndex: qIdx, cIndex: cIdx }, needNewQuestion: false };
        }
      }
    }
    return { target: { type: 'question', qIndex: questions.length }, needNewQuestion: true };
  };

  const pruneTrailingEmptyQuestions = (list: Question[]): Question[] => {
    const updated = [...list];
    while (
      updated.length > 0 &&
      !updated[updated.length - 1].text?.trim() &&
      (!updated[updated.length - 1].choices || updated[updated.length - 1].choices.every(c => !c || !c.trim()))
    ) {
      updated.pop();
    }
    return updated;
  };

  const ensureAudioPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const hasPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (hasPerm) return true;
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: 'Microphone Permission',
        message: 'Speech recognition requires microphone access to dictate quiz questions.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      });
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      console.log('Permission check error:', e);
      return false;
    }
  };

  const startSpeechListening = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const granted = await ensureAudioPermission();
      if (!granted) {
        setIsVoiceListening(false);
        Alert.alert(
          'Microphone Permission Required',
          'Please grant microphone permission to use voice dictation. You can also type directly in the text field.'
        );
        return;
      }
      setIsVoiceListening(true);
      if (NativeModules.SpeechRecognition?.startListening) {
        await NativeModules.SpeechRecognition.startListening(null);
      }
    } catch (err: any) {
      console.log('Speech recognition start error:', err);
      setIsVoiceListening(false);
      Alert.alert(
        'Speech Recognition Unavailable',
        err?.message || 'Could not start speech recognition. Please ensure Google Speech Services are enabled.'
      );
    }
  };

  const stopSpeechListening = async () => {
    setIsVoiceListening(false);
    try {
      if (Platform.OS === 'android' && NativeModules.SpeechRecognition?.stopListening) {
        await NativeModules.SpeechRecognition.stopListening();
      }
    } catch (e) {}
  };

  const handleToggleMic = async () => {
    if (isVoiceListening) {
      await stopSpeechListening();
    } else {
      await startSpeechListening();
    }
  };

  const advanceToTarget = async (target: VoiceTarget, needNewQuestion: boolean) => {
    let currentList = manualQuestionsRef.current;
    if (needNewQuestion) {
      const newQuestionItem: Question = { text: '', choices: ['', '', '', ''], correctIndex: 0 };
      currentList = [...currentList, newQuestionItem];
      setManualQuestions(currentList);
      manualQuestionsRef.current = currentList;
    }

    setVoiceTarget(target);

    let initialText = '';
    if (target === 'title') {
      initialText = setNameRef.current || '';
    } else if (target.type === 'question') {
      initialText = currentList[target.qIndex]?.text || '';
    } else if (target.type === 'choice') {
      initialText = currentList[target.qIndex]?.choices?.[target.cIndex] || '';
    }
    setVoiceLiveText(initialText);
    setVoiceModalVisible(true);

    if (target === 'title') {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }

    if (Platform.OS === 'android') {
      try {
        const hasPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (hasPerm) {
          setIsVoiceListening(true);
          setTimeout(async () => {
            try {
              if (NativeModules.SpeechRecognition?.startListening) {
                await NativeModules.SpeechRecognition.startListening(null);
              }
            } catch (err) {
              console.log('Speech recognition start error in wizard:', err);
              setIsVoiceListening(false);
            }
          }, 350);
        } else {
          setIsVoiceListening(false);
        }
      } catch (e) {
        setIsVoiceListening(false);
      }
    }
  };

  const handleStartManualWizard = async () => {
    await ensureAudioPermission();
    const resume = findResumeTarget(manualQuestionsRef.current);
    advanceToTarget(resume.target, resume.needNewQuestion);
  };

  const handleContinueManualWizard = async () => {
    await ensureAudioPermission();
    const resume = findResumeTarget(manualQuestionsRef.current);
    advanceToTarget(resume.target, resume.needNewQuestion);
  };

  const handleEditManualQuestion = async (qIndex: number) => {
    await ensureAudioPermission();
    advanceToTarget({ type: 'question', qIndex }, false);
  };

  const handleStartAutoVoiceFlow = async () => {
    try {
      if (Platform.OS === 'android') {
        const hasPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (!hasPerm) {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
            title: 'Microphone Permission',
            message: 'Voice input requires access to your microphone.',
            buttonPositive: 'Allow',
            buttonNegative: 'Cancel',
          });
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert('Permission Denied', 'Microphone permission is required for Voice Typing.');
            return;
          }
        }
      }

      setIsAutoVoiceActive(true);
      isAutoVoiceActiveRef.current = true;
      const resume = findResumeTarget(manualQuestionsRef.current);
      advanceToTarget(resume.target, resume.needNewQuestion);
    } catch (e: any) {
      console.log('Error starting Voice Typing:', e);
      setIsAutoVoiceActive(false);
      isAutoVoiceActiveRef.current = false;
    }
  };

  const handleStopAutoVoiceFlow = async () => {
    setIsAutoVoiceActive(false);
    isAutoVoiceActiveRef.current = false;
    try {
      if (Platform.OS === 'android' && NativeModules.SpeechRecognition?.cancelListening) {
        await NativeModules.SpeechRecognition.cancelListening();
      }
    } catch (e) {}

    const pruned = pruneTrailingEmptyQuestions(manualQuestionsRef.current);
    setManualQuestions(pruned);
    manualQuestionsRef.current = pruned;

    setVoiceModalVisible(false);
    setIsVoiceListening(false);
    setVoiceTarget(null);
    setVoiceLiveText('');
  };

  const handleSpeechInput = async (target: VoiceTarget) => {
    try {
      if (Platform.OS === 'android') {
        const hasPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (!hasPerm) {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
            title: 'Microphone Permission',
            message: 'Voice input requires access to your microphone.',
            buttonPositive: 'Allow',
            buttonNegative: 'Cancel',
          });
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert('Permission Denied', 'Microphone permission is required to use voice input.');
            return;
          }
        }

        setIsAutoVoiceActive(false);
        isAutoVoiceActiveRef.current = false;
        advanceToTarget(target, false);
      } else {
        advanceToTarget(target, false);
      }
    } catch (err: any) {
      console.log('Speech recognition start error:', err);
      setIsVoiceListening(false);
    }
  };

  const handleFinishVoiceInput = async (textOverride?: string, andClose?: boolean) => {
    const text = (textOverride !== undefined ? textOverride : voiceLiveTextRef.current).trim();
    const target = voiceTargetRef.current;

    if (target) {
      if (target === 'title') {
        if (text) setSetName(text);
      } else if (target.type === 'question') {
        const updated = [...manualQuestionsRef.current];
        if (updated[target.qIndex]) {
          updated[target.qIndex].text = text;
          setManualQuestions(updated);
          manualQuestionsRef.current = updated;
        }
      } else if (target.type === 'choice') {
        const updated = [...manualQuestionsRef.current];
        if (updated[target.qIndex]) {
          const choices = [...updated[target.qIndex].choices];
          choices[target.cIndex] = text;
          updated[target.qIndex].choices = choices;
          setManualQuestions(updated);
          manualQuestionsRef.current = updated;
        }
      }
    }

    try {
      if (Platform.OS === 'android' && NativeModules.SpeechRecognition?.stopListening) {
        await NativeModules.SpeechRecognition.stopListening();
      }
    } catch (e) {}

    if (andClose) {
      const pruned = pruneTrailingEmptyQuestions(manualQuestionsRef.current);
      setManualQuestions(pruned);
      manualQuestionsRef.current = pruned;
      setVoiceModalVisible(false);
      setIsVoiceListening(false);
      setVoiceTarget(null);
      setVoiceLiveText('');
      return;
    }

    if (target) {
      const { nextTarget, needNewQuestion } = getNextVoiceTarget(target);
      advanceToTarget(nextTarget, needNewQuestion);
    } else {
      setVoiceModalVisible(false);
      setIsVoiceListening(false);
      setVoiceTarget(null);
      setVoiceLiveText('');
    }
  };

  const handleCancelVoiceInput = async () => {
    const text = voiceLiveTextRef.current.trim();
    const target = voiceTargetRef.current;

    if (text && target) {
      if (target === 'title') {
        setSetName(text);
      } else if (target.type === 'question') {
        const updated = [...manualQuestionsRef.current];
        if (updated[target.qIndex]) {
          updated[target.qIndex].text = text;
          setManualQuestions(updated);
          manualQuestionsRef.current = updated;
        }
      } else if (target.type === 'choice') {
        const updated = [...manualQuestionsRef.current];
        if (updated[target.qIndex]) {
          const choices = [...updated[target.qIndex].choices];
          choices[target.cIndex] = text;
          updated[target.qIndex].choices = choices;
          setManualQuestions(updated);
          manualQuestionsRef.current = updated;
        }
      }
    }

    try {
      if (Platform.OS === 'android' && NativeModules.SpeechRecognition?.cancelListening) {
        await NativeModules.SpeechRecognition.cancelListening();
      }
    } catch (e) {}

    const pruned = pruneTrailingEmptyQuestions(manualQuestionsRef.current);
    setManualQuestions(pruned);
    manualQuestionsRef.current = pruned;

    setIsAutoVoiceActive(false);
    isAutoVoiceActiveRef.current = false;
    setVoiceModalVisible(false);
    setIsVoiceListening(false);
    setVoiceTarget(null);
    setVoiceLiveText('');
  };

  const handleSaveManualSet = async () => {
    if (isAutoVoiceActiveRef.current) {
      await handleStopAutoVoiceFlow();
    }
    if (!setName.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your custom quiz.');
      return;
    }

    if (manualQuestions.length === 0) {
      Alert.alert('No Questions', 'Please create at least 1 question before saving.');
      return;
    }

    const invalid = manualQuestions.some(
      q => !q.text.trim() || q.choices.some(c => !c.trim())
    );
    if (invalid) {
      Alert.alert('Incomplete Questions', 'Please ensure all questions and 4 options are filled in.');
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
          questionNumber: (e as any).questionNumber || (e.line ? `Line ${e.line}` : 'File'),
          reason: e.message,
          snippet: (e as any).snippet,
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
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('TriviaHub');
            }
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Create Contest</Text>
        <TouchableOpacity
          style={styles.headerInfoBtn}
          onPress={() => {
            setGuidanceTab(activeMode);
            setGuidanceModalVisible(true);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Icon name="information-circle-outline" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* â”€â”€ 3-Way Mode Switcher (PDF / TXT-CSV / Manual) â”€â”€ */}
      <View style={[styles.modeTabBar, { backgroundColor: isDark ? '#071527' : '#F1F5F9' }]}>
        <TouchableOpacity
          style={[styles.modeTabBtn, activeMode === 'pdf' && [styles.modeTabBtnActive, { backgroundColor: isDark ? '#3D4A5C' : '#64748B' }]]}
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
          style={[styles.modeTabBtn, activeMode === 'txt_csv' && [styles.modeTabBtnActive, { backgroundColor: isDark ? '#3D4A5C' : '#64748B' }]]}
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
          style={[styles.modeTabBtn, activeMode === 'manual' && [styles.modeTabBtnActive, { backgroundColor: isDark ? '#3D4A5C' : '#64748B' }]]}
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
        {/* ── Quiz Title Section (below tabs, above content) ── */}
        {(!successQuestions || successQuestions.length === 0) && (
          <View style={styles.quizTitleContainer}>
            <Text style={[styles.titleKeyLabel, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              Title
            </Text>
            <View style={styles.quizTitleRow}>
              <Text style={[styles.quizTitleStripText, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                {setName.trim() || 'Untitled Contest'}
              </Text>
              <TouchableOpacity
                onPress={() => { setTitleEditDraft(setName); setTitleEditModalVisible(true); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.quizTitleEditBtn}
                activeOpacity={0.7}
              >
                <Icon name="create-outline" size={22} color={isDark ? '#94A3B8' : '#475569'} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* â”€â”€ MODE 1: PDF CONVERTER â”€â”€ */}
        {activeMode === 'pdf' && (!successQuestions || successQuestions.length === 0) && (
          <>
            {/* Upload PDF Action Card â€” FIRST */}
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

            {/* Format Guidelines Card â€” below upload */}
            <View style={[styles.card, { backgroundColor: isDark ? '#0B1B2D' : '#F8FAFC', borderColor: theme.border }]}>
              <View style={styles.cardTitleRow}>
                <Icon name="document-text-outline" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Expected PDF Format</Text>
              </View>
              <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                Upload a text-based PDF where each question is numbered, followed by 4 choices (Aâ€“D), and a{' '}
                <Text style={{ fontWeight: 'bold', color: isDark ? '#38BDF8' : '#0F62FE' }}>*</Text> directly before the correct option letter.
              </Text>
              <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                  {`1. What is the capital of France?\nA. London\n*B. Paris\nC. Rome\nD. Berlin`}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* â”€â”€ MODE 2: TXT / CSV IMPORTER â”€â”€ */}
        {activeMode === 'txt_csv' && (!successQuestions || successQuestions.length === 0) && (
          <>
            {/* Upload TXT / CSV Action Card â€” FIRST */}
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

            {/* Format Guidelines Card â€” below upload */}
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
          </>
        )}

        {/* ── MODE 3: MANUAL IN-APP BUILDER ── */}
        {activeMode === 'manual' && (
          <View style={{ gap: 14 }}>
            {/* EMPTY STATE: Guidance + Start Creating Button */}
            {manualQuestions.length === 0 && (
              <>
                <View style={[styles.card, { backgroundColor: isDark ? '#0B1B2D' : '#F8FAFC', borderColor: theme.border }]}>
                  <View style={styles.cardTitleRow}>
                    <Icon name="sparkles" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                    <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Manual Quiz Creation</Text>
                  </View>
                  <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                    Build your quiz step-by-step with voice dictation or typing. Each question has 4 options with one correct answer designated.
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                    <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                      {`1. Question Prompt\n*A. Option A (Correct)\nB. Option B\nC. Option C\nD. Option D`}
                    </Text>
                  </View>
                </View>

                {/* Big Start Creating Button */}
                <TouchableOpacity
                  style={styles.startManualBtn}
                  onPress={handleStartManualWizard}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={isDark ? ['#0284C7', '#0369A1'] : ['#2563EB', '#1D4ED8']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.startManualGradient}
                  >
                    <Icon name="create" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.startManualText}>Start Creating</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {/* ACTIVE STATE: Guidance is HIDDEN, questions list shown with edit & continue */}
            {manualQuestions.length > 0 && (() => {
              const hasIncomplete = manualQuestions.some(
                q => !q.text.trim() || q.choices.some(c => !c.trim())
              );
              return (
                <>
                  <View style={styles.manualHeaderRow}>
                    <Text style={[styles.previewHeading, { color: theme.textPrimary, marginBottom: 0 }]}>
                      Questions Created ({manualQuestions.length})
                    </Text>
                  </View>

                  {/* Questions List */}
                  {manualQuestions.map((q, qIndex) => {
                    const isComplete = q.text.trim() && q.choices.every(c => c && c.trim());
                    return (
                      <View
                        key={qIndex}
                        style={[
                          styles.previewCard,
                          {
                            backgroundColor: isDark ? '#071527' : '#FFFFFF',
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        {/* Card Header Row: Badge, Status, Edit & Trash Buttons */}
                        <View style={styles.manualCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={[styles.manualQBadge, { backgroundColor: isDark ? '#0284C7' : '#2563EB' }]}>
                              <Text style={styles.manualQBadgeText}>Q{qIndex + 1}</Text>
                            </View>
                            {!isComplete && (
                              <View style={styles.incompleteBadge}>
                                <Text style={styles.incompleteBadgeText}>Incomplete</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                            <TouchableOpacity
                              onPress={() => handleEditManualQuestion(qIndex)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Icon name="create-outline" size={22} color={isDark ? '#94A3B8' : '#475569'} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleRemoveManualQuestion(qIndex)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Icon name="trash-outline" size={18} color="#EF4444" />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Question Text with Hanging Indent */}
                        <View style={styles.previewQuestionRow}>
                          <Text style={[styles.previewQuestionNum, { color: theme.textPrimary }]}>
                            {qIndex + 1}.
                          </Text>
                          <Text style={[styles.previewQuestionText, { color: theme.textPrimary }]}>
                            {q.text.trim() || '(No question text entered yet)'}
                          </Text>
                        </View>

                        {/* Choices List with Hanging Indent */}
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
                                  {choice.trim() || `(Option ${letter} empty)`}
                                </Text>
                                {isCorrect && (
                                  <Icon name="checkmark" size={16} color="#22C55E" style={{ marginLeft: 'auto', marginTop: 1 }} />
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}

                  {/* Action Buttons: Continue Creating + Save Quiz Set */}
                  <View style={{ gap: 10, marginTop: 4, marginBottom: 20 }}>
                    {/* Continue Creating Button */}
                    <TouchableOpacity
                      style={[
                        styles.continueCreatingBtn,
                        {
                          borderColor: isDark ? '#0284C7' : '#3B82F6',
                          backgroundColor: isDark ? 'rgba(2,132,199,0.1)' : 'rgba(59,130,246,0.06)',
                        },
                      ]}
                      onPress={handleContinueManualWizard}
                      activeOpacity={0.85}
                    >
                      <Icon name="add-circle-outline" size={20} color={isDark ? '#38BDF8' : '#2563EB'} style={{ marginRight: 6 }} />
                      <Text style={[styles.continueCreatingBtnText, { color: isDark ? '#38BDF8' : '#2563EB' }]}>
                        {hasIncomplete ? 'Continue Creating' : `+ Add Question ${manualQuestions.length + 1}`}
                      </Text>
                    </TouchableOpacity>

                    {/* Save Quiz Set Button */}
                    <TouchableOpacity
                      style={styles.saveManualBtn}
                      onPress={handleSaveManualSet}
                      disabled={saving}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.saveManualGradient}
                      >
                        {saving ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <>
                            <Icon name="bookmark" size={18} color="#FFF" style={{ marginRight: 6 }} />
                            <Text style={styles.saveManualText}>Save Quiz Set ({manualQuestions.length} Qs)</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
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
                {issues.length} Issue{issues.length > 1 ? 's' : ''} Found â€” Fix and Re-upload
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
              <TouchableOpacity
                onPress={resetState}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : '#BBF7D0',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  marginLeft: 8,
                }}
              >
                <Icon name="refresh" size={14} color={isDark ? '#4ADE80' : '#166534'} style={{ marginRight: 4 }} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#4ADE80' : '#166534' }}>
                  Change
                </Text>
              </TouchableOpacity>
            </View>

            {/* Converted Quiz Title — clean layout with 'Title' key above, no background/border */}
            <View style={styles.successTitleContainer}>
              <Text style={[styles.titleKeyLabel, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                Title
              </Text>
              <View style={styles.successTitleRow}>
                <Text
                  style={[
                    styles.successTitleText,
                    { color: theme.textPrimary },
                  ]}
                  numberOfLines={2}
                >
                  {setName.trim() || 'Untitled Contest'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setTitleEditDraft(setName);
                    setTitleEditModalVisible(true);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.successTitleEditBtn}
                  activeOpacity={0.7}
                >
                  <Icon name="create-outline" size={24} color={isDark ? '#94A3B8' : '#475569'} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Questions Preview */}
            <Text style={[styles.previewHeading, { color: theme.textPrimary }]}>Questions Preview</Text>
            {successQuestions.map((q, qIndex) => (
              <View key={qIndex} style={[styles.previewCard, { backgroundColor: isDark ? '#071527' : '#FFFFFF', borderColor: theme.border }]}>
                <View style={styles.previewQuestionRow}>
                  <Text style={[styles.previewQuestionNum, { color: theme.textPrimary }]}>
                    {qIndex + 1}.
                  </Text>
                  <Text style={[styles.previewQuestionText, { color: theme.textPrimary }]}>
                    {q.text}
                  </Text>
                </View>
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
                        {isCorrect && <Icon name="checkmark" size={16} color="#22C55E" style={{ marginLeft: 'auto', marginTop: 1 }} />}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Action Buttons */}
            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: '#10B981', flex: 1 }]}
                onPress={() => handleSaveAndPlay(false)}
                disabled={saving}
                activeOpacity={0.85}
              >
                <View style={styles.gradientBtnInner}>
                  <Icon name="bookmark" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Save to Sets</Text>
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
              Contest Saved! 🎉
            </Text>
            <Text style={[styles.successModalSubText, { color: theme.textSecondary }]}>
              Your contest has been saved to Contest List. Tap View to practice or host it.
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
                    {savedSetData.questionCount} Questions • Saved to Contest List
                  </Text>
                </View>
              </View>
            )}

            {/* Action Buttons Stack */}
            <View style={styles.successBtnStack}>
              {/* View Contest List Button — only action */}
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
                <Icon name="library-outline" size={18} color={theme.textPrimary} style={{ marginRight: 8 }} />
                <Text style={[styles.successCloseBtnText, { color: theme.textPrimary }]}>
                  View Contest List
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* â”€â”€ COMPACT VOICE INPUT MODAL (No Google branding, small & clean) â”€â”€ */}
      <Modal
        visible={voiceModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCancelVoiceInput}
      >
        <KeyboardAvoidingView
          style={styles.voiceModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -80}
        >
          <View
            style={[
              styles.voiceModalBox,
              {
                backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(15, 98, 254, 0.25)',
              },
            ]}
          >
            {/* Header — title + close only */}
            <View style={styles.voiceModalHeader}>
              <Text style={[styles.voiceModalTitle, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>
                {getVoiceTargetTitle()}
              </Text>
              <TouchableOpacity
                onPress={isAutoVoiceActive ? handleStopAutoVoiceFlow : handleCancelVoiceInput}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.voiceCloseBtn}
              >
                <Icon name="close" size={18} color={isDark ? '#94A3B8' : '#64748B'} />
              </TouchableOpacity>
            </View>

            {/* Question preview + Option Checklist when filling choices */}
            {voiceTarget && typeof voiceTarget === 'object' && voiceTarget.type === 'choice' && (() => {
              const q = manualQuestions[voiceTarget.qIndex];
              const labels = ['A', 'B', 'C', 'D'];
              const isLastOption = voiceTarget.cIndex === 3;
              return (
                <View style={styles.voiceChoiceStrip}>
                  {/* Question text preview */}
                  {q?.text ? (
                    <Text
                      style={[styles.voiceQuestionPreview, { color: isDark ? '#BAE6FD' : '#1E40AF' }]}
                      numberOfLines={2}
                    >
                      {q.text}
                    </Text>
                  ) : null}
                  {/* Option rows */}
                  {labels.map((label, idx) => {
                    const isFilled = idx < voiceTarget.cIndex;
                    const isActive = idx === voiceTarget.cIndex;
                    const text = q?.choices?.[idx] || '';
                    const isCorrectAnswer = q?.correctIndex === idx;
                    return (
                      <TouchableOpacity
                        key={label}
                        style={[
                          styles.voiceChoiceRow,
                          isActive && { backgroundColor: isDark ? '#1E3A5F' : '#EFF6FF' },
                        ]}
                        activeOpacity={0.7}
                        onPress={() => {
                          handleSetManualCorrect(voiceTarget.qIndex, idx);
                        }}
                      >
                        <View
                          style={[
                            styles.voiceChoiceCheck,
                            isFilled && {
                              backgroundColor: isCorrectAnswer ? '#10B981' : (isDark ? '#334155' : '#CBD5E1'),
                              borderColor: isCorrectAnswer ? '#10B981' : (isDark ? '#475569' : '#94A3B8'),
                            },
                            isActive && { borderColor: '#16A34A', backgroundColor: isDark ? '#14532D' : '#DCFCE7' },
                          ]}
                        >
                          {isFilled ? (
                            <Icon
                              name={isCorrectAnswer ? 'checkmark-circle' : 'ellipse-outline'}
                              size={10}
                              color={isCorrectAnswer ? '#FFF' : (isDark ? '#64748B' : '#94A3B8')}
                            />
                          ) : isActive ? (
                            <Icon name="mic" size={10} color="#16A34A" />
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.voiceChoiceLabel,
                            { color: isDark ? '#94A3B8' : '#64748B', fontWeight: isActive ? '700' : '400' },
                            isFilled && { opacity: isCorrectAnswer ? 1 : 0.55 },
                            isActive && { color: isDark ? '#BAE6FD' : '#1D4ED8' },
                            isCorrectAnswer && { color: isDark ? '#4ADE80' : '#166534', fontWeight: '700' },
                          ]}
                          numberOfLines={1}
                        >
                          <Text style={{ fontWeight: '700' }}>{label}. </Text>
                          {isFilled ? text : (isActive ? (voiceLiveText || '...') : '')}
                        </Text>
                        {isFilled && isCorrectAnswer && (
                          <Text style={{ fontSize: 9, color: '#10B981', fontWeight: '800', marginLeft: 4 }}>✓</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}

            {/* Pulsing Mic Circle — tap to mute or restart listening */}
            <View style={styles.voiceMicCenterRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleToggleMic}
              >
              <Animated.View
                style={[
                  styles.voicePulseRing,
                  {
                    transform: [{ scale: voicePulseAnim }],
                    backgroundColor: isVoiceListening
                      ? (isDark ? 'rgba(56,189,248,0.15)' : 'rgba(15,98,254,0.12)')
                      : (isDark ? 'rgba(100,116,139,0.15)' : 'rgba(100,116,139,0.10)'),
                  },
                ]}
              >
                <View
                  style={[
                    styles.voiceMicCircle,
                    {
                      backgroundColor: isVoiceListening
                        ? (isDark ? '#0284C7' : '#0F62FE')
                        : (isDark ? '#334155' : '#94A3B8'),
                    },
                  ]}
                >
                  <Icon name={isVoiceListening ? 'mic' : 'mic-off'} size={24} color="#FFFFFF" />
                </View>
              </Animated.View>
              </TouchableOpacity>
            </View>

            {/* Dynamic status note below mic */}
            <Text style={[styles.voiceMicNote, { color: isVoiceListening ? '#10B981' : (isDark ? '#64748B' : '#94A3B8') }]}>
              {isVoiceListening
                ? '🎤 Listening... speak clearly'
                : voiceLiveText.trim()
                  ? '✏️ Tap to edit, or tap mic to speak'
                  : '🔇 Mic paused — tap mic to speak, or type below'}
            </Text>

            {/* Editable transcript — voice auto-types here, user can also type/edit */}
            <TextInput
              style={[
                styles.voiceTextInput,
                {
                  backgroundColor: isDark ? '#071527' : '#F8FAFC',
                  borderColor: isVoiceListening
                    ? (isDark ? '#0284C7' : '#0F62FE')
                    : (isDark ? '#1E293B' : '#E2E8F0'),
                  color: theme.textPrimary,
                },
              ]}
              value={voiceLiveText}
              onChangeText={setVoiceLiveText}
              placeholder={isVoiceListening ? 'Transcribing...' : 'Speak or type here...'}
              placeholderTextColor={isDark ? '#334155' : '#CBD5E1'}
              multiline
              scrollEnabled={false}
              returnKeyType="default"
              blurOnSubmit={false}
              autoCorrect={false}
              autoCapitalize="sentences"
            />

            {/* Action Buttons */}
            <View style={styles.voiceActionRow}>
              {voiceTarget && typeof voiceTarget === 'object' && voiceTarget.type === 'choice' && voiceTarget.cIndex === 3 ? (
                <>
                  {/* Option D: Save & Close Button */}
                  <TouchableOpacity
                    style={[
                      styles.voiceCancelBtn,
                      {
                        backgroundColor: isDark ? '#14532D' : '#DCFCE7',
                        borderColor: isDark ? '#22C55E' : '#86EFAC',
                        borderWidth: 1,
                      },
                      !voiceLiveText.trim() && { opacity: 0.5 },
                    ]}
                    onPress={() => handleFinishVoiceInput(undefined, true)}
                    disabled={!voiceLiveText.trim()}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.voiceCancelText, { color: isDark ? '#4ADE80' : '#166534' }]}>
                      Save & Close
                    </Text>
                  </TouchableOpacity>

                  {/* Option D: + Next Question Button */}
                  <TouchableOpacity
                    style={[
                      styles.voiceDoneBtn,
                      !voiceLiveText.trim() && { opacity: 0.5 },
                    ]}
                    onPress={() => handleFinishVoiceInput(undefined, false)}
                    disabled={!voiceLiveText.trim()}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#16A34A', '#15803D']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.voiceDoneGradient}
                    >
                      <Icon name="add-circle-outline" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={styles.voiceDoneText}>+ Next Question</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Standard Close / Cancel Button */}
                  <TouchableOpacity
                    style={[
                      styles.voiceCancelBtn,
                      {
                        backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
                      },
                    ]}
                    onPress={handleCancelVoiceInput}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.voiceCancelText, { color: theme.textSecondary }]}>
                      Close
                    </Text>
                  </TouchableOpacity>

                  {/* Standard Next Button */}
                  <TouchableOpacity
                    style={[
                      styles.voiceDoneBtn,
                      !voiceLiveText.trim() && { opacity: 0.5 },
                    ]}
                    onPress={() => handleFinishVoiceInput(undefined, false)}
                    disabled={!voiceLiveText.trim()}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#16A34A', '#15803D']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.voiceDoneGradient}
                    >
                      <Text style={styles.voiceDoneText}>
                        {(() => {
                          if (!voiceTarget || typeof voiceTarget !== 'object') return 'Next';
                          if (voiceTarget.type === 'question') return 'Next: Option A';
                          if (voiceTarget.type === 'choice') {
                            if (voiceTarget.cIndex === 0) return 'Next: Option B';
                            if (voiceTarget.cIndex === 1) return 'Next: Option C';
                            if (voiceTarget.cIndex === 2) return 'Next: Option D';
                          }
                          return 'Next';
                        })()}
                      </Text>
                      <Icon name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 4 }} />
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* â”€â”€ Title Edit Modal â”€â”€ */}
      <Modal
        visible={titleEditModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTitleEditModalVisible(false)}
      >
        <View style={styles.titleEditOverlay}>
          <View style={[styles.titleEditCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            {/* Header */}
            <View style={styles.titleEditHeader}>
              <Text style={[styles.titleEditHeading, { color: theme.textPrimary }]}>Edit Contest Title</Text>
              <TouchableOpacity
                onPress={() => setTitleEditModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.titleEditCloseBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Input */}
            <View style={[
              styles.titleEditInputRow,
              {
                backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
                borderColor: titleEditDraft.trim()
                  ? (isDark ? '#94A3B8' : '#475569')
                  : (isDark ? 'rgba(148,163,184,0.25)' : '#E2E8F0'),
              },
            ]}>
              <Icon name="create" size={18} color={isDark ? '#94A3B8' : '#475569'} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.titleEditInput, { color: theme.textPrimary }]}
                value={titleEditDraft}
                onChangeText={(t) => setTitleEditDraft(t.slice(0, TITLE_MAX_LENGTH))}
                placeholder="e.g. Science Chapter 1 Test"
                placeholderTextColor={isDark ? '#475569' : '#94A3B8'}
                autoFocus
                maxLength={TITLE_MAX_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (titleEditDraft.trim()) {
                    setSetName(titleEditDraft.trim());
                    setTitleEditModalVisible(false);
                  }
                }}
              />
              <Text style={{ fontSize: 11, color: isDark ? '#475569' : '#94A3B8', marginLeft: 4 }}>
                {titleEditDraft.length}/{TITLE_MAX_LENGTH}
              </Text>
            </View>

            {/* Save button */}
            <TouchableOpacity
              style={[styles.titleEditSaveBtn, { opacity: titleEditDraft.trim() ? 1 : 0.4 }]}
              disabled={!titleEditDraft.trim()}
              activeOpacity={0.85}
              onPress={() => {
                setSetName(titleEditDraft.trim());
                setTitleEditModalVisible(false);
              }}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.titleEditSaveGradient}
              >
                <Icon name="checkmark" size={17} color="#FFFFFF" style={{ marginRight: 7 }} />
                <Text style={styles.titleEditSaveText}>Save Title</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Format Guidance Modal ── */}
      <Modal
        visible={guidanceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuidanceModalVisible(false)}
      >
        <View style={styles.guidanceModalOverlay}>
          <View style={[styles.guidanceModalCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            {/* Modal Header */}
            <View style={styles.guidanceModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <View style={[styles.guidanceIconCircle, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(15,98,254,0.1)' }]}>
                  <Icon name="information-circle" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                </View>
                <Text style={[styles.guidanceModalHeading, { color: theme.textPrimary }]}>
                  Format Guidance
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setGuidanceModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.guidanceCloseBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' }]}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Mode Switcher Tabs inside Modal */}
            <View style={[styles.guidanceTabBar, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
              <TouchableOpacity
                style={[
                  styles.guidanceTabBtn,
                  guidanceTab === 'pdf' && {
                    backgroundColor: isDark ? '#0284C7' : '#0F62FE',
                  },
                ]}
                onPress={() => setGuidanceTab('pdf')}
              >
                <Text
                  style={[
                    styles.guidanceTabText,
                    { color: guidanceTab === 'pdf' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
                  ]}
                >
                  PDF (AI)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.guidanceTabBtn,
                  guidanceTab === 'txt_csv' && {
                    backgroundColor: isDark ? '#0284C7' : '#0F62FE',
                  },
                ]}
                onPress={() => setGuidanceTab('txt_csv')}
              >
                <Text
                  style={[
                    styles.guidanceTabText,
                    { color: guidanceTab === 'txt_csv' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
                  ]}
                >
                  TXT / CSV
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.guidanceTabBtn,
                  guidanceTab === 'manual' && {
                    backgroundColor: isDark ? '#0284C7' : '#0F62FE',
                  },
                ]}
                onPress={() => setGuidanceTab('manual')}
              >
                <Text
                  style={[
                    styles.guidanceTabText,
                    { color: guidanceTab === 'manual' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#64748B') },
                  ]}
                >
                  Manual
                </Text>
              </TouchableOpacity>
            </View>

            {/* Tab Specific Content */}
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {guidanceTab === 'pdf' && (
                <View style={{ gap: 10 }}>
                  <Text style={[styles.guidanceDescription, { color: theme.textSecondary }]}>
                    Upload a text-based PDF where each question is numbered, followed by 4 choices (A–D), and a * directly before the correct option letter.
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0', marginVertical: 4 }]}>
                    <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                      {`1. What is the capital of France?\nA. London\n*B. Paris\nC. Rome\nD. Berlin`}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: isDark ? '#94A3B8' : '#64748B' }}>
                    • Supports text-based .pdf files up to 10MB{'\n'}
                    • Scanned image PDFs are not supported
                  </Text>
                </View>
              )}

              {guidanceTab === 'txt_csv' && (
                <View style={{ gap: 10 }}>
                  <Text style={[styles.guidanceDescription, { color: theme.textSecondary }]}>
                    Upload a .txt or .csv file formatted as follows:
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.textPrimary, marginTop: 4 }}>
                    TXT Format:
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                    <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                      {`1. Which planet is closest to the Sun?\n*A. Mercury\nB. Venus\nC. Earth\nD. Mars`}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.textPrimary, marginTop: 4 }}>
                    CSV Column Headers:
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: isDark ? '#050F1E' : '#E2E8F0' }]}>
                    <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>
                      {`Question, Choice A, Choice B, Choice C, Choice D, Correct Answer (1-4 or A-D)`}
                    </Text>
                  </View>
                </View>
              )}

              {guidanceTab === 'manual' && (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.guidanceDescription, { color: theme.textSecondary }]}>
                    Build custom quiz sets question by question:
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                    • Type your question or use Voice Typing.
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                    • Enter all 4 options (A, B, C, D).
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                    • Tap the radio circle next to an option to set it as correct answer (turns green).
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                    • Tap "+ Add Question" to add more questions, then tap "Save Quiz Set".
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Got It Button */}
            <TouchableOpacity
              style={[styles.guidanceGotItBtn, { backgroundColor: isDark ? '#0284C7' : '#0F62FE' }]}
              onPress={() => setGuidanceModalVisible(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.guidanceGotItText}>Got it</Text>
            </TouchableOpacity>
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
  headerTitle: { fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  // Quiz title strip (shown below mode tabs, above content)
  titleKeyLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  quizTitleContainer: {
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  quizTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quizTitleStripText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  quizTitleEditBtn: {
    marginLeft: 10,
    padding: 4,
  },
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
    backgroundColor: '#64748B',
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
  manualQuestionInputContainer: {
    position: 'relative',
    justifyContent: 'center',
    marginBottom: 12,
  },
  manualQuestionInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 38,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 52,
  },
  questionMicInsideBtn: {
    position: 'absolute',
    right: 8,
    bottom: 10,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
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
  // Voice Input Modal Styles
  voiceModalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  voiceModalBox: {
    width: '100%',
    maxWidth: 310,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  voiceModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  voiceStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  voiceModalTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  voiceCloseBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceMicCenterRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  voicePulseRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceMicCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  voiceMicNote: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 6,
    fontStyle: 'italic',
  },
  voiceTextInput: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
    textAlignVertical: 'top',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  // Voice Typing Banner Styles
  autoVoiceCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    marginBottom: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  autoVoiceCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  autoVoiceIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoVoiceTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  autoVoiceLiveBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  autoVoiceLiveText: {
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  autoVoiceSub: {
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 15,
  },
  autoVoiceActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoVoiceActionBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  voiceAutoBadge: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  voiceAutoBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
  },

  voiceQuestionPreview: {
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
    paddingHorizontal: 6,
    paddingBottom: 6,
    lineHeight: 17,
  },
  voiceChoiceStrip: {
    marginHorizontal: 4,
    marginBottom: 8,
    borderRadius: 10,
    overflow: 'hidden',
    gap: 2,
  },
  voiceChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 8,
  },
  voiceChoiceCheck: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#64748B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceChoiceLabel: {
    flex: 1,
    fontSize: 12,
  },
  voiceCancelBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceCancelText: {
    fontSize: 13,
    fontWeight: '700',
  },
  voiceDoneBtn: {
    flex: 1.2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  voiceDoneGradient: {
    paddingVertical: 9,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceDoneText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
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
  startManualBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    marginTop: 6,
    marginBottom: 20,
  },
  startManualGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  startManualText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  continueCreatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  continueCreatingBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  manualHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  incompleteBadge: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  incompleteBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  saveManualText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  successTitleContainer: {
    paddingHorizontal: 2,
    marginBottom: 18,
  },
  successTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successTitleText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  successTitleEditBtn: {
    marginLeft: 10,
    padding: 4,
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
  previewQuestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  previewQuestionNum: {
    fontSize: 14,
    fontWeight: '800',
    marginRight: 6,
    lineHeight: 20,
  },
  previewQuestionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  choicesList: { gap: 6 },
  choiceItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceLetter: { fontWeight: '700', marginRight: 8, fontSize: 13, lineHeight: 18 },
  choiceText: { fontSize: 13, flex: 1, lineHeight: 18 },

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
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  successCloseBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // â”€â”€ Title Edit Modal â”€â”€
  titleEditOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  titleEditCard: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  titleEditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleEditHeading: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  titleEditCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleEditInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  titleEditInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  titleEditSaveBtn: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  titleEditSaveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  titleEditSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headerInfoBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  guidanceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  guidanceModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  guidanceModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  guidanceIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guidanceModalHeading: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  guidanceCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guidanceTabBar: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  guidanceTabBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidanceTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  guidanceDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  guidanceGotItBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  guidanceGotItText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
