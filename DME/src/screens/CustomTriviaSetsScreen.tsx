import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  NativeModules,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';
import { parseQuestionFile, ParseError, Question } from '../utils/customQuestionParser';
import {
  getCustomSets,
  saveCustomSet,
  updateCustomSet,
  deleteCustomSet,
  CustomTriviaSet,
} from '../services/CustomTriviaStorage';
import { useAuth } from '../context/AuthContext';
import { chatAPI } from '../services/api';
import localDatabase from '../services/LocalDatabase';
import {
  calculateSmartQuizTime,
  createChallengePayload,
  sendChallengeToConversation,
  TriviaChallengePayload,
} from '../services/TriviaChallengeService';

interface CustomTriviaSetsScreenProps {
  navigation: any;
}

export const CustomTriviaSetsScreen: React.FC<CustomTriviaSetsScreenProps> = ({ navigation }) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [sets, setSets] = useState<CustomTriviaSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);

  // File Preview / Save Modal state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [setName, setSetName] = useState('');
  const [parsedQuestions, setParsedQuestions] = useState<Question[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);

  // In-App Manual Creator / Editor Modal state
  const [manualCreatorVisible, setManualCreatorVisible] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editingLoadingId, setEditingLoadingId] = useState<string | null>(null);
  const [manualSetName, setManualSetName] = useState('');
  const [manualQuestions, setManualQuestions] = useState<Question[]>([
    { text: '', choices: ['', '', '', ''], correctIndex: 0 },
  ]);

  // Template Help Modal state
  const [helpVisible, setHelpVisible] = useState(false);

  // Modern Delete Confirmation Modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [setToDelete, setSetToDelete] = useState<CustomTriviaSet | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modern Saved Success Modal state
  const [savedSuccessModalVisible, setSavedSuccessModalVisible] = useState(false);
  const [savedModalMode, setSavedModalMode] = useState<'saved' | 'updated'>('saved');
  const [savedSetData, setSavedSetData] = useState<CustomTriviaSet | null>(null);

  // 24-Hour Group / Friend Challenge Modal state
  const { user } = useAuth();
  const [challengeModalVisible, setChallengeModalVisible] = useState(false);
  const [selectedSetForChallenge, setSelectedSetForChallenge] = useState<CustomTriviaSet | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [searchChatQuery, setSearchChatQuery] = useState('');
  const [sendingChallengeId, setSendingChallengeId] = useState<number | null>(null);

  // ── Center-screen custom fade toast (Friend Request Style) ──
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  const handleOpenChallengeModal = async (set: CustomTriviaSet) => {
    setSelectedSetForChallenge(set);
    setChallengeModalVisible(true);
    setSearchChatQuery('');

    // 1. Immediately populate from local database cache
    try {
      const localConvs = localDatabase.getConversations() || [];
      if (Array.isArray(localConvs) && localConvs.length > 0) {
        setConversations(localConvs);
      }
    } catch (_) {}

    // 2. Fetch latest from API
    setLoadingConversations(true);
    try {
      const convs = await chatAPI.getConversations();
      let list: any[] = [];
      if (Array.isArray(convs)) {
        list = convs;
      } else if (Array.isArray(convs?.results)) {
        list = convs.results;
      } else if (Array.isArray(convs?.data)) {
        list = convs.data;
      } else {
        list = localDatabase.getConversations() || [];
      }
      setConversations(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('Failed to load conversations:', e);
      // Keep local DB conversations if network fails
      const fallback = localDatabase.getConversations() || [];
      setConversations(Array.isArray(fallback) ? fallback : []);
    } finally {
      setLoadingConversations(false);
    }
  };

  const handleSendChallenge = async (conv: any) => {
    if (!selectedSetForChallenge) return;
    setSendingChallengeId(conv.id);
    try {
      const payload = createChallengePayload(selectedSetForChallenge, user, conv.id);
      await sendChallengeToConversation(conv.id, payload);
      setChallengeModalVisible(false);
      showToast('24h Challenge Sent');
    } catch (error) {
      console.error('Error sending challenge:', error);
      showToast('Failed to Send Challenge');
    } finally {
      setSendingChallengeId(null);
    }
  };

  useEffect(() => {
    loadSets();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadSets();
      pinNavBarColor(theme.background, isDark);
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      try {
        if (Platform.OS === 'android' && NativeModules.SystemBar?.setStatusBarColor) {
          NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
        }
      } catch (_) {}
    }, [theme.background, isDark])
  );

  const loadSets = async () => {
    setLoading(true);
    const data = await getCustomSets();
    setSets(data);
    setLoading(false);
  };

  const handlePickFile = async () => {
    try {
      setParsing(true);
      const res = await pick({
        type: [types.plainText, types.csv],
        allowMultiSelection: false,
      });

      if (res && res.length > 0) {
        const file = res[0];
        const fileUri = file.uri;
        const fileName = file.name || 'custom_quiz.txt';
        const fileExt = (fileName.split('.').pop() || 'txt').toLowerCase();

        let fileContent = '';
        let readPath = fileUri;

        // If Android content:// URI, copy to local cache directory first!
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

        // Read file based on extension
        const isBinary = ['pdf', 'docx', 'doc'].includes(fileExt.toLowerCase());
        try {
          fileContent = await RNFS.readFile(readPath, isBinary ? 'ascii' : 'utf8');
        } catch {
          fileContent = await RNFS.readFile(readPath, isBinary ? 'utf8' : 'ascii');
        }

        const result = parseQuestionFile(fileContent, fileExt);

        const defaultName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        setSetName(defaultName);
        setParsedQuestions(result.questions);
        setParseErrors(result.errors);
        setPreviewVisible(true);
      }
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
        // User returned without uploading anything - do nothing silently
        return;
      }
      Alert.alert('Error Reading File', err?.message || 'Failed to select and read file.');
    } finally {
      setParsing(false);
    }
  };

  const handleSaveSet = async () => {
    if (!setName.trim()) {
      Alert.alert('Missing Name', 'Please enter a name for your question set.');
      return;
    }
    if (parsedQuestions.length === 0) {
      Alert.alert('No Questions', 'There are no valid questions to save.');
      return;
    }

    try {
      const newSet = await saveCustomSet(setName.trim(), parsedQuestions);
      setPreviewVisible(false);
      await loadSets();
      setSavedModalMode('saved');
      setSavedSetData(newSet);
      setSavedSuccessModalVisible(true);
    } catch {
      Alert.alert('Error', 'Failed to save question set to storage.');
    }
  };

  // In-App Manual Creator / Editor handlers
  const handleOpenNewCreator = () => {
    setEditingSetId(null);
    setManualSetName('');
    setManualQuestions([{ text: '', choices: ['', '', '', ''], correctIndex: 0 }]);
    setManualCreatorVisible(true);
  };

  const handleEditSet = (item: CustomTriviaSet) => {
    setEditingLoadingId(item.id);
    setTimeout(() => {
      setEditingSetId(item.id);
      setManualSetName(item.name);
      const clonedQuestions: Question[] = item.questions.map(q => ({
        text: q.text,
        choices: [...q.choices],
        correctIndex: q.correctIndex,
      }));
      setManualQuestions(
        clonedQuestions.length > 0
          ? clonedQuestions
          : [{ text: '', choices: ['', '', '', ''], correctIndex: 0 }]
      );
      setManualCreatorVisible(true);
      setEditingLoadingId(null);
    }, 40);
  };

  const handleAddManualQuestion = () => {
    setManualQuestions([
      ...manualQuestions,
      { text: '', choices: ['', '', '', ''], correctIndex: 0 },
    ]);
  };

  const handleDeleteManualQuestion = (index: number) => {
    if (manualQuestions.length <= 1) return;
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
    updated[qIndex].choices[cIndex] = text;
    setManualQuestions(updated);
  };

  const handleSetManualCorrect = (qIndex: number, cIndex: number) => {
    const updated = [...manualQuestions];
    updated[qIndex].correctIndex = cIndex;
    setManualQuestions(updated);
  };

  const handleSaveManualSet = async () => {
    if (!manualSetName.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your custom quiz.');
      return;
    }

    const invalid = manualQuestions.some(
      q => !q.text.trim() || q.choices.some(c => !c.trim())
    );
    if (invalid) {
      Alert.alert('Incomplete Form', 'Please ensure all question prompts and 4 options are filled.');
      return;
    }

    const isUpdate = Boolean(editingSetId);

    try {
      let resultData: CustomTriviaSet;
      if (editingSetId) {
        resultData = await updateCustomSet(editingSetId, manualSetName.trim(), manualQuestions);
      } else {
        resultData = await saveCustomSet(manualSetName.trim(), manualQuestions);
      }
      setManualCreatorVisible(false);
      setEditingSetId(null);
      setManualSetName('');
      setManualQuestions([{ text: '', choices: ['', '', '', ''], correctIndex: 0 }]);
      await loadSets();
      setSavedModalMode(isUpdate ? 'updated' : 'saved');
      setSavedSetData(resultData);
      setSavedSuccessModalVisible(true);
    } catch {
      Alert.alert('Error', isUpdate ? 'Failed to update quiz set.' : 'Failed to save manual quiz.');
    }
  };

  const handleDeleteSet = (item: CustomTriviaSet) => {
    setSetToDelete(item);
    setDeleteModalVisible(true);
  };

  const handleConfirmDelete = async () => {
    if (!setToDelete) return;
    try {
      setIsDeleting(true);
      await deleteCustomSet(setToDelete.id);
      setDeleteModalVisible(false);
      setSetToDelete(null);
      await loadSets();
    } catch {
      Alert.alert('Error', 'Failed to delete quiz set.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePlaySet = (item: CustomTriviaSet) => {
    navigation.navigate('TriviaSolo', {
      customQuestions: item.questions,
      customSetName: item.name,
      customCategoryId: 'custom',
    });
  };

  const renderSetCard = ({ item, index }: { item: CustomTriviaSet; index: number }) => (
    <View style={styles.cardWrapperRow}>
      {/* Outside Number Counter (Left Side) */}
      <View style={styles.outsideCounterCol}>
        <View
          style={[
            styles.outsideCounterBadge,
            {
              backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
              borderColor: isDark ? '#0284C7' : '#3B82F6',
            },
          ]}
        >
          <Text style={[styles.outsideCounterText, { color: isDark ? '#38BDF8' : '#0F62FE' }]}>
            {index + 1}
          </Text>
        </View>
      </View>

      {/* Main Card Container */}
      <View
        style={[
          styles.cardContainer,
          {
            backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.cardFileIconBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#1E293B' }]}>
              <Icon name="document-text" size={18} color="#FFFFFF" />
            </View>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <View style={styles.cardActionIconsRow}>
            <TouchableOpacity
              onPress={() => handleEditSet(item)}
              disabled={editingLoadingId === item.id}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.cardActionIconBtn, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : '#EFF6FF' }]}
            >
              {editingLoadingId === item.id ? (
                <ActivityIndicator size="small" color={isDark ? '#38BDF8' : '#0F62FE'} />
              ) : (
                <Icon name="pencil" size={16} color={isDark ? '#38BDF8' : '#0F62FE'} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeleteSet(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.cardActionIconBtn, { backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : '#FEF2F2' }]}
            >
              <Icon name="trash-outline" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.cardSubText, { color: theme.textSecondary }]}>
          {item.questionCount} Questions • Created {new Date(item.createdAt).toLocaleDateString()}
        </Text>

        <View style={styles.cardButtonsRow}>
          <TouchableOpacity style={styles.playButtonHalf} onPress={() => handlePlaySet(item)} activeOpacity={0.85}>
            <LinearGradient colors={['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.playGradient}>
              <Icon name="play" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
              <Text style={styles.playButtonText}>Practice</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.challengeButtonHalf} onPress={() => handleOpenChallengeModal(item)} activeOpacity={0.85}>
            <LinearGradient colors={['#4F46E5', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.playGradient}>
              <Icon name="trophy" size={15} color="#FFFFFF" style={{ marginRight: 4 }} />
              <Text style={styles.playButtonText}>Host</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === 'android' ? 10 : 6),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            backgroundColor: theme.surface,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>My Sets</Text>
          {sets.length > 0 && (
            <View style={[styles.headerCountBadge, { backgroundColor: isDark ? 'rgba(56,189,248,0.18)' : '#DBEAFE' }]}>
              <Text style={[styles.headerCountText, { color: isDark ? '#38BDF8' : '#1D4ED8' }]}>{sets.length}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity
            style={[styles.helpButton, { marginRight: 0 }]}
            onPress={() => navigation.navigate('TriviaChallenges')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="trophy-outline" size={22} color="#8B5CF6" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.helpButton} onPress={() => setHelpVisible(true)}>
            <Icon name="help-circle-outline" size={24} color={isDark ? '#38BDF8' : '#0F62FE'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main List of Created Sets (Dedicated Stage 2) */}
      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#0F62FE" />
        </View>
      ) : sets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(56,189,248,0.12)' : '#EFF6FF' }]}>
            <Icon name="library-outline" size={54} color={isDark ? '#38BDF8' : '#0F62FE'} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No Created Sets Yet</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Create your first quiz using AI PDF converter, TXT/CSV import, or manual builder!
          </Text>
          <TouchableOpacity
            style={styles.emptyCreateBtn}
            onPress={() => navigation.navigate('QuizPdfUpload')}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#0F62FE', '#0052CC']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.emptyCreateBtnGradient}
            >
              <Icon name="add-circle" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.emptyCreateBtnText}>Create Quiz Set</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sets}
          keyExtractor={item => item.id}
          renderItem={renderSetCard}
          contentContainerStyle={[styles.listPadding, { paddingBottom: insets.bottom + 32, paddingTop: 16 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* IN-APP MANUAL CREATOR / EDITOR MODAL */}
      <Modal visible={manualCreatorVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF', borderColor: theme.border }]}>
            <View style={styles.modernModalHeader}>
              <View style={styles.modernModalHeaderLeft}>
                <View style={[styles.modernModalIconBox, { backgroundColor: isDark ? 'rgba(0,110,255,0.15)' : 'rgba(0,110,255,0.1)' }]}>
                  <Icon name="create" size={20} color="#006EFF" />
                </View>
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                  {editingSetId ? 'Edit Quiz Set' : 'Create Quiz in App'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setManualCreatorVisible(false)}
                style={[styles.modalCloseCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textPrimary }]}>Quiz Title</Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: isDark ? '#071527' : '#F8FAFC',
                  color: theme.textPrimary,
                  borderColor: theme.border,
                },
              ]}
              value={manualSetName}
              onChangeText={setManualSetName}
              placeholder="e.g. History Chapter 1 Test"
              placeholderTextColor={theme.placeholder}
            />

            <ScrollView style={{ maxHeight: 350 }} showsVerticalScrollIndicator={false}>
              {manualQuestions.map((q, qIdx) => (
                <View
                  key={qIdx}
                  style={[
                    styles.manualQCard,
                    {
                      backgroundColor: isDark ? '#071527' : '#F8FAFC',
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    },
                  ]}
                >
                  <View style={styles.manualQHeaderRow}>
                    <View style={styles.qNumBadge}>
                      <Text style={styles.qNumBadgeText}>Question {qIdx + 1}</Text>
                    </View>
                    {manualQuestions.length > 1 && (
                      <TouchableOpacity
                        onPress={() => handleDeleteManualQuestion(qIdx)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ marginLeft: 'auto', padding: 4 }}
                      >
                        <Icon name="trash-outline" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                        color: theme.textPrimary,
                        borderColor: theme.border,
                      },
                    ]}
                    value={q.text}
                    onChangeText={t => handleUpdateManualQuestionText(qIdx, t)}
                    placeholder="Enter question prompt..."
                    placeholderTextColor={theme.placeholder}
                  />

                  <Text style={[styles.inputLabel, { marginTop: 4, color: theme.textSecondary }]}>
                    Options (Tap radio to mark correct):
                  </Text>
                  {q.choices.map((c, cIdx) => (
                    <View key={cIdx} style={styles.choiceRow}>
                      <TouchableOpacity
                        style={[
                          styles.radioCircle,
                          { borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' },
                          q.correctIndex === cIdx && styles.radioCircleSelected,
                        ]}
                        onPress={() => handleSetManualCorrect(qIdx, cIdx)}
                      >
                        {q.correctIndex === cIdx && <View style={styles.radioInner} />}
                      </TouchableOpacity>
                      <TextInput
                        style={[
                          styles.textInput,
                          {
                            flex: 1,
                            marginBottom: 0,
                            backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                            color: theme.textPrimary,
                            borderColor: q.correctIndex === cIdx ? '#10B981' : theme.border,
                          },
                        ]}
                        value={c}
                        onChangeText={t => handleUpdateManualChoice(qIdx, cIdx, t)}
                        placeholder={`Option ${String.fromCharCode(65 + cIdx)}`}
                        placeholderTextColor={theme.placeholder}
                      />
                    </View>
                  ))}
                </View>
              ))}

              <TouchableOpacity style={styles.addMoreBtn} onPress={handleAddManualQuestion} activeOpacity={0.8}>
                <Icon name="add-circle" size={20} color="#006EFF" style={{ marginRight: 6 }} />
                <Text style={[styles.addMoreText, { color: '#006EFF' }]}>+ Add Next Question</Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={[styles.modalButtonRow, { marginTop: 14 }]}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}
                onPress={() => setManualCreatorVisible(false)}
              >
                <Text style={[styles.modalCancelText, { color: theme.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveManualSet} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#006EFF', '#0043CE']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.modalSaveGradient}
                >
                  <Icon name="save-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.modalSaveText}>
                    {editingSetId ? 'Update Quiz' : 'Save Quiz'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PREVIEW & CONFIRM MODAL */}
      <Modal visible={previewVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF', borderColor: theme.border }]}>
            <View style={styles.modernModalHeader}>
              <View style={styles.modernModalHeaderLeft}>
                <View style={[styles.modernModalIconBox, { backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)' }]}>
                  <Icon name="document-text" size={20} color="#10B981" />
                </View>
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Preview & Save Quiz</Text>
              </View>
              <TouchableOpacity
                onPress={() => setPreviewVisible(false)}
                style={[styles.modalCloseCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Highlighted Title Input in Preview Modal */}
            <View
              style={[
                styles.highlightedTitleCard,
                {
                  backgroundColor: isDark ? '#081C38' : '#EFF6FF',
                  borderColor: isDark ? '#0284C7' : '#3B82F6',
                  marginBottom: 14,
                },
              ]}
            >
              <View style={styles.titleCardHeaderRow}>
                <View style={styles.titleCardLeft}>
                  <View style={[styles.titleIconBadge, { backgroundColor: isDark ? '#0284C7' : '#2563EB' }]}>
                    <Icon name="bookmark" size={16} color="#FFF" />
                  </View>
                  <Text style={[styles.titleCardHeading, { color: theme.textPrimary, fontSize: 15 }]}>Quiz Set Name</Text>
                </View>
                <View style={[styles.titleStatusBadge, { backgroundColor: isDark ? 'rgba(56,189,248,0.2)' : '#DBEAFE' }]}>
                  <Text style={[styles.titleStatusBadgeText, { color: isDark ? '#38BDF8' : '#1D4ED8' }]}>
                    {setName.trim() ? '✓ Named' : 'Required'}
                  </Text>
                </View>
              </View>

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
                  size={16}
                  color={setName.trim() ? (isDark ? '#38BDF8' : '#2563EB') : (isDark ? '#64748B' : '#94A3B8')}
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  style={[styles.highlightedInput, { color: theme.textPrimary }]}
                  value={setName}
                  onChangeText={setSetName}
                  placeholder="e.g. My Science Practice Set"
                  placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
                />
                {setName.trim().length > 0 && (
                  <TouchableOpacity onPress={() => setSetName('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="close-circle" size={16} color={isDark ? '#64748B' : '#94A3B8'} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {parseErrors.length > 0 ? (
              <View style={[styles.errorBox, { backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2', borderColor: 'rgba(239,68,68,0.3)' }]}>
                <Text style={styles.errorBoxTitle}>⚠️ Formatting Errors Found ({parseErrors.length}):</Text>
                <ScrollView style={{ maxHeight: 120 }}>
                  {parseErrors.map((err, i) => (
                    <Text key={i} style={styles.errorText}>
                      • Line {err.line}: {err.message}
                    </Text>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={[styles.previewSubTitle, { color: theme.textSecondary }]}>
              Parsed Questions ({parsedQuestions.length}):
            </Text>

            <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
              {parsedQuestions.map((q, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.previewQuestionItem,
                    {
                      backgroundColor: isDark ? '#071527' : '#F8FAFC',
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    },
                  ]}
                >
                  <Text style={[styles.previewQText, { color: theme.textPrimary }]}>
                    {idx + 1}. {q.text}
                  </Text>
                  {q.choices.map((c, cIdx) => (
                    <View
                      key={cIdx}
                      style={[
                        styles.previewChoiceRow,
                        cIdx === q.correctIndex && { backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.previewChoiceText,
                          { color: cIdx === q.correctIndex ? '#10B981' : theme.textSecondary },
                          cIdx === q.correctIndex && { fontWeight: '700' },
                        ]}
                      >
                        {String.fromCharCode(65 + cIdx)}. {c} {cIdx === q.correctIndex ? '✓' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>

            <View style={[styles.modalButtonRow, { marginTop: 14 }]}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }]}
                onPress={() => setPreviewVisible(false)}
              >
                <Text style={[styles.modalCancelText, { color: theme.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, parsedQuestions.length === 0 && { opacity: 0.5 }]}
                disabled={parsedQuestions.length === 0}
                onPress={handleSaveSet}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#10B981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.modalSaveGradient}
                >
                  <Icon name="checkmark" size={18} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.modalSaveText}>Save Quiz Set</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TEMPLATE FORMAT HELP MODAL */}
      <Modal visible={helpVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF', borderColor: theme.border }]}>
            <View style={styles.modernModalHeader}>
              <View style={styles.modernModalHeaderLeft}>
                <View style={[styles.modernModalIconBox, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(15,98,254,0.1)' }]}>
                  <Icon name="help-circle" size={20} color={isDark ? '#38BDF8' : '#0F62FE'} />
                </View>
                <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>File Format Guide</Text>
              </View>
              <TouchableOpacity
                onPress={() => setHelpVisible(false)}
                style={[styles.modalCloseCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.helpHeading, { color: isDark ? '#38BDF8' : '#0F62FE' }]}>📄 Word (.docx) & Text (.txt) Format</Text>
              <Text style={[styles.helpText, { color: theme.textSecondary }]}>
                Format questions sequentially with 4 choices (a–d) and an asterisk (*) for the correct answer:
              </Text>
              <View style={[styles.codeBlock, { backgroundColor: isDark ? '#071527' : '#F1F5F9', borderColor: theme.border }]}>
                <Text style={[styles.codeText, { color: isDark ? '#93C5FD' : '#1E293B' }]}>{`1. Who discovered gravity?
a) Albert Einstein
b) Isaac Newton *
c) Galileo Galilei
d) Nikola Tesla

2. Capital of France?
a) London
b) Berlin
*c) Paris
d) Rome`}</Text>
              </View>
              <Text style={[styles.helpNote, { color: theme.textSecondary }]}>
                • Mark the correct answer with an asterisk (*) directly before or after the option.
              </Text>

              <Text style={[styles.helpHeading, { marginTop: 16, color: isDark ? '#38BDF8' : '#0F62FE' }]}>📊 CSV Format (.csv)</Text>
              <Text style={[styles.helpText, { color: theme.textSecondary }]}>
                Columns: Question, Option A, Option B, Option C, Option D, Correct Option (A/B/C/D)
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseBtnFull, { backgroundColor: isDark ? '#1E293B' : '#E2E8F0', marginTop: 14 }]}
              onPress={() => setHelpVisible(false)}
            >
              <Text style={[styles.modalCloseBtnFullText, { color: theme.textPrimary }]}>Got It!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODERN DELETE CONFIRMATION MODAL */}
      <Modal
        visible={deleteModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!isDeleting) {
            setDeleteModalVisible(false);
            setSetToDelete(null);
          }
        }}
      >
        <View style={styles.deleteModalOverlay}>
          <View
            style={[
              styles.deleteModalCard,
              {
                backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            {/* Trash Icon Glow */}
            <View style={styles.deleteIconCircle}>
              <Icon name="trash-outline" size={32} color="#EF4444" />
            </View>

            {/* Title & Description */}
            <Text style={[styles.deleteModalTitle, { color: theme.textPrimary }]}>
              Delete Quiz Set?
            </Text>
            <Text style={[styles.deleteModalSubText, { color: theme.textSecondary }]}>
              Are you sure you want to delete this custom quiz? This action cannot be undone.
            </Text>

            {/* Quiz Preview Snippet */}
            {setToDelete && (
              <View
                style={[
                  styles.deleteSetSnippet,
                  {
                    backgroundColor: isDark ? '#071527' : '#F8FAFC',
                    borderColor: isDark ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.2)',
                  },
                ]}
              >
                <Icon name="document-text" size={24} color="#EF4444" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.deleteSnippetName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {setToDelete.name}
                  </Text>
                  <Text style={[styles.deleteSnippetCount, { color: theme.textSecondary }]}>
                    {setToDelete.questionCount} Questions
                  </Text>
                </View>
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.deleteBtnRow}>
              <TouchableOpacity
                style={[
                  styles.deleteCancelBtn,
                  {
                    backgroundColor: isDark ? '#1E293B' : '#E2E8F0',
                  },
                ]}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setSetToDelete(null);
                }}
                disabled={isDeleting}
                activeOpacity={0.8}
              >
                <Text style={[styles.deleteCancelBtnText, { color: theme.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteConfirmBtn}
                onPress={handleConfirmDelete}
                disabled={isDeleting}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#EF4444', '#DC2626']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.deleteConfirmGradient}
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Icon name="trash" size={18} color="#FFF" style={{ marginRight: 6 }} />
                      <Text style={styles.deleteConfirmBtnText}>Delete</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODERN SAVED SUCCESS MODAL */}
      <Modal
        visible={savedSuccessModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSavedSuccessModalVisible(false)}
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
              {savedModalMode === 'updated' ? 'Quiz Updated! 🎉' : 'Quiz Saved! 🎉'}
            </Text>
            <Text style={[styles.successModalSubText, { color: theme.textSecondary }]}>
              {savedModalMode === 'updated'
                ? 'Your custom trivia set has been updated and is ready to play.'
                : 'Your custom trivia set has been saved to your library and is ready to play.'}
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
                    handlePlaySet(savedSetData);
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

      {/* 24-HOUR CHALLENGE TO CHAT MODAL */}
      <Modal visible={challengeModalVisible} animationType="slide" transparent={true} onRequestClose={() => setChallengeModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.challengeModalCard, { backgroundColor: isDark ? '#0F172A' : '#FFFFFF', borderColor: isDark ? 'rgba(99,102,241,0.3)' : '#E0E7FF' }]}>
            {/* Header */}
            <View style={styles.challengeModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.challengeModalIconBox}>
                  <Icon name="trophy" size={20} color="#FFFFFF" />
                </View>
                <View>
                  <Text style={[styles.challengeModalTitle, { color: theme.textPrimary }]}>Start Group Contest</Text>
                  <Text style={[styles.challengeModalSub, { color: theme.textSecondary }]}>Live leaderboard competition</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setChallengeModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Quiz Info & Dynamic Timing Card */}
            {selectedSetForChallenge && (() => {
              const timing = calculateSmartQuizTime(selectedSetForChallenge.questionCount);
              return (
                <LinearGradient
                  colors={isDark ? ['#1E1B4B', '#1E293B'] : ['#EEF2FF', '#F8FAFC']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.challengeQuizCard}
                >
                  <Text style={[styles.challengeQuizName, { color: theme.textPrimary }]} numberOfLines={1}>
                    {selectedSetForChallenge.name}
                  </Text>
                  <View style={styles.challengeQuizMetricsRow}>
                    <View style={styles.challengeMetricPill}>
                      <Icon name="help-circle" size={13} color="#6366F1" />
                      <Text style={[styles.challengeMetricText, { color: theme.textPrimary }]}>
                        {selectedSetForChallenge.questionCount} Qs
                      </Text>
                    </View>
                    <View style={styles.challengeMetricPill}>
                      <Icon name="timer" size={13} color="#F59E0B" />
                      <Text style={[styles.challengeMetricText, { color: theme.textPrimary }]}>
                        {timing.formattedTime} (48s/Q)
                      </Text>
                    </View>
                    <View style={styles.challengeMetricPill}>
                      <Icon name="time" size={13} color="#10B981" />
                      <Text style={[styles.challengeMetricText, { color: theme.textPrimary }]}>
                        24h Expiry
                      </Text>
                    </View>
                  </View>
                </LinearGradient>
              );
            })()}

            {/* Search chats */}
            <View style={[styles.challengeSearchBox, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
              <Icon name="search" size={18} color="#64748B" />
              <TextInput
                style={[styles.challengeSearchInput, { color: theme.textPrimary }]}
                placeholder="Search friends or groups..."
                placeholderTextColor="#64748B"
                value={searchChatQuery}
                onChangeText={setSearchChatQuery}
              />
              {searchChatQuery ? (
                <TouchableOpacity onPress={() => setSearchChatQuery('')}>
                  <Icon name="close-circle" size={16} color="#64748B" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Conversations List */}
            <Text style={[styles.challengeSectionTitle, { color: theme.textSecondary }]}>SELECT A CHAT OR GROUP</Text>

            {loadingConversations ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#4F46E5" />
                <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8 }}>Loading chats...</Text>
              </View>
            ) : (
              <ScrollView style={styles.challengeChatList} showsVerticalScrollIndicator={false}>
                {(Array.isArray(conversations) ? conversations : [])
                  .filter(c => {
                    if (!c) return false;
                    if (!searchChatQuery.trim()) return true;
                    const query = searchChatQuery.toLowerCase();
                    const name = (c.name || c.title || c.user?.name || c.user?.username || c.other_user?.name || c.other_user?.username || '').toLowerCase();
                    return name.includes(query);
                  })
                  .map(conv => {
                    const isGroup = conv.is_group || conv.type === 'group';
                    const convName = conv.name || conv.title || conv.other_user?.name || conv.other_user?.username || conv.user?.name || conv.user?.username || (isGroup ? 'Group Chat' : 'Friend');
                    const isSending = sendingChallengeId === conv.id;

                    return (
                      <TouchableOpacity
                        key={conv.id}
                        style={[styles.challengeChatRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9' }]}
                        onPress={() => handleSendChallenge(conv)}
                        disabled={!!sendingChallengeId}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.challengeAvatarBox, { backgroundColor: isGroup ? '#F59E0B' : '#4F46E5' }]}>
                          <Icon name={isGroup ? 'people' : 'person'} size={18} color="#FFFFFF" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[styles.challengeChatName, { color: theme.textPrimary }]} numberOfLines={1}>
                            {convName}
                          </Text>
                          <Text style={[styles.challengeChatType, { color: theme.textSecondary }]}>
                            {isGroup ? '👥 Group Chat' : '👤 Direct Message'}
                          </Text>
                        </View>
                        {isSending ? (
                          <ActivityIndicator size="small" color="#4F46E5" />
                        ) : (
                          <View style={styles.challengeSendBadge}>
                            <Icon name="send" size={14} color="#4F46E5" />
                            <Text style={styles.challengeSendText}>Send</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Center-screen fade toast (Friend Request Style) ── */}
      <Modal visible={toastVisible} transparent animationType="none" statusBarTranslucent>
        <View style={styles.toastOverlay} pointerEvents="none">
          <Animated.View style={[styles.toastBox, { opacity: toastOpacity, backgroundColor: isDark ? '#1E293B' : '#0F172A' }]}>
            <Icon
              name={toastMessage.includes('Failed') ? 'close-circle' : 'checkmark-circle'}
              size={22}
              color={toastMessage.includes('Failed') ? '#EF4444' : '#10B981'}
              style={{ marginRight: 8 }}
            />
            <Text style={[styles.toastText, { color: '#FFFFFF' }]}>{toastMessage}</Text>
          </Animated.View>
        </View>
      </Modal>

      {/* LOADING OVERLAY WHEN OPENING LARGE QUIZ SET */}
      {editingLoadingId && (
        <View style={styles.loadingOverlay}>
          <View
            style={[
              styles.loadingDialogCard,
              {
                backgroundColor: isDark ? '#0B1B2D' : '#FFFFFF',
                borderColor: isDark ? 'rgba(56,189,248,0.3)' : 'rgba(15,98,254,0.2)',
              },
            ]}
          >
            <View style={[styles.loadingIconCircle, { backgroundColor: isDark ? 'rgba(56,189,248,0.15)' : '#EFF6FF' }]}>
              <ActivityIndicator size="large" color={isDark ? '#38BDF8' : '#0F62FE'} />
            </View>
            <Text style={[styles.loadingDialogTitle, { color: theme.textPrimary }]}>Loading Quiz Editor...</Text>
            <Text style={[styles.loadingDialogSub, { color: theme.textSecondary }]}>
              Preparing questions & choices
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#161726',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1E2038',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    padding: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Kalam-Bold',
    color: '#FFF',
  },
  headerCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  headerCountText: {
    fontSize: 12,
    fontWeight: '800',
  },
  helpButton: {
    padding: 4,
  },
  createInAppHeroBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  createInAppHeroGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  createInAppHeroIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  createInAppHeroTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  createInAppHeroSubtitle: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  topActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pdfColBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  uploadColBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  colBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyCreateBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#0F62FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  emptyCreateBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 14,
  },
  emptyCreateBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  listPadding: {
    padding: 16,
  },
  cardWrapperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  outsideCounterCol: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  outsideCounterBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  outsideCounterText: {
    fontSize: 13,
    fontWeight: '800',
  },
  cardContainer: {
    flex: 1,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardActionIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardActionIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFileIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },
  cardSubText: {
    fontSize: 13,
    marginVertical: 8,
  },
  playButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 6,
    elevation: 3,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  playGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  cardButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  playButtonHalf: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  challengeButtonHalf: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  challengeModalCard: {
    width: '100%',
    maxHeight: '85%',
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 20,
    elevation: 8,
  },
  challengeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  challengeModalIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeModalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  challengeModalSub: {
    fontSize: 11.5,
    marginTop: 2,
  },
  challengeQuizCard: {
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  challengeQuizName: {
    fontSize: 14.5,
    fontWeight: '800',
    marginBottom: 8,
  },
  challengeQuizMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  challengeMetricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  challengeMetricText: {
    fontSize: 11,
    fontWeight: '700',
  },
  challengeSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 12,
    gap: 8,
  },
  challengeSearchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  challengeSectionTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  challengeChatList: {
    maxHeight: 220,
  },
  challengeChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  challengeAvatarBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeChatName: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  challengeChatType: {
    fontSize: 11,
    marginTop: 2,
  },
  challengeSendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(79, 70, 229, 0.12)',
    gap: 4,
  },
  challengeSendText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#4F46E5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxHeight: '88%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  modernModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modernModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modernModalIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  manualQCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  manualQHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  qNumBadge: {
    backgroundColor: '#006EFF',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  qNumBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: '#10B981',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,110,255,0.3)',
    borderStyle: 'dashed',
    marginBottom: 10,
  },
  addMoreText: {
    fontWeight: '700',
    fontSize: 14,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorBoxTitle: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginBottom: 2,
  },
  previewSubTitle: {
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 8,
  },
  previewScroll: {
    maxHeight: 250,
    borderRadius: 14,
    padding: 4,
    marginBottom: 10,
  },
  previewQuestionItem: {
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  previewQText: {
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 6,
  },
  previewChoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  previewChoiceText: {
    fontSize: 13,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalSaveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  modalSaveText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  modalCloseBtnFull: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnFullText: {
    fontSize: 15,
    fontWeight: '700',
  },
  helpHeading: {
    color: '#FF6B6B',
    fontSize: 16,
    fontFamily: 'Kalam-Bold',
    marginBottom: 4,
  },
  helpText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginBottom: 8,
  },
  codeBlock: {
    backgroundColor: '#161726',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  codeText: {
    color: '#4DEEEA',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  helpNote: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    lineHeight: 18,
  },

  /* Highlighted Title Card Styles */
  highlightedTitleCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    marginBottom: 14,
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
    marginBottom: 10,
  },
  titleCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  titleIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleCardHeading: {
    fontSize: 15,
    fontWeight: '700',
  },
  titleStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
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
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  highlightedInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
  },

  /* Modern Delete Confirmation Modal Styles */
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deleteModalCard: {
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
  deleteIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalSubText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  deleteSetSnippet: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  deleteSnippetName: {
    fontSize: 15,
    fontWeight: '700',
  },
  deleteSnippetCount: {
    fontSize: 12,
    marginTop: 2,
  },
  deleteBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  deleteCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  deleteConfirmBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  deleteConfirmGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  deleteConfirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },

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

  /* Loading Dialog Overlay Styles */
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    padding: 24,
  },
  loadingDialogCard: {
    width: '85%',
    maxWidth: 320,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  loadingIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingDialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  loadingDialogSub: {
    fontSize: 13,
    textAlign: 'center',
  },
  toastOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  toastText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default CustomTriviaSetsScreen;
