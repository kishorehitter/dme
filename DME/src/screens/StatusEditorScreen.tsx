import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Image,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  NativeModules,
  Keyboard,
  BackHandler,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { SketchCanvas } from '@terrylinla/react-native-sketch-canvas';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { pinNavBarColor } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { VisibilityModal } from '../components/VisibilityModal';

const MAX_VIDEO_SECONDS = 30;

async function compressAndTrimVideo(uri: string): Promise<string> {
  try {
    const RNFS = require('react-native-fs');
    const { FFmpegKit, ReturnCode } = await import('ffmpeg-kit-react-native');
    const cleanPath = uri.replace('file://', '');
    const outPath    = `${RNFS.CachesDirectoryPath}/status_${Date.now()}.mp4`;
    const cmd = `-i "${cleanPath}" -t ${MAX_VIDEO_SECONDS} -vcodec libx264 -crf 28 -preset ultrafast -acodec aac -b:a 96k "${outPath}" -y`;
    const session = await FFmpegKit.execute(cmd);
    const code = await session.getReturnCode();
    return ReturnCode.isSuccess(code) ? `file://${outPath}` : uri;
  } catch { return uri; }
}

const TEXT_COLORS = [
  '#FFFFFF', '#000000', '#FFD700', '#FF3B30',
  '#34C759', '#007AFF', '#AF52DE', '#FF9500',
];

const STROKE_COLORS = [
  '#FFFFFF', '#FF3B30', '#FFD700', '#34C759',
  '#007AFF', '#AF52DE', '#FF9500', '#000000',
  '#00FFFF', '#FF69B4',
];

const STROKE_WIDTHS = [4, 8, 14, 22];

const FONT_STYLES: Array<{ label: string; fontFamily?: string; fontWeight?: 'normal' | 'bold' }> = [
  { label: 'Standard' },
  { label: 'Serif', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  { label: 'Mono', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  { label: 'Bold', fontWeight: 'bold' },
];

const BG_STYLES: Array<'none' | 'translucent_dark' | 'solid_white' | 'solid_black'> = [
  'none', 'translucent_dark', 'solid_white', 'solid_black',
];

// ─────────────────────────────────────────────────────────────────────────────
// TextOverlay Type
// ─────────────────────────────────────────────────────────────────────────────
export interface TextOverlay {
  id: string;
  text: string;
  color: string;
  fontIndex: number;
  textBgStyle: 'none' | 'solid_white' | 'solid_black' | 'translucent_dark';
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

function getOverlayTextStyle(color: string, fontIndex: number, textBgStyle: string) {
  const font = FONT_STYLES[fontIndex || 0] || FONT_STYLES[0];
  const isLightBg = textBgStyle === 'solid_white';
  return {
    color: isLightBg ? '#000000' : color,
    fontFamily: font.fontFamily,
    fontWeight: (font.fontWeight ?? 'bold') as any,
    fontSize: 24,
    textAlign: 'center' as const,
    includeFontPadding: false,
    padding: 0,
    margin: 0,
    textShadowColor: textBgStyle === 'none' ? 'rgba(0,0,0,0.75)' : undefined,
    textShadowOffset: textBgStyle === 'none' ? { width: 0, height: 1 } : undefined,
    textShadowRadius: textBgStyle === 'none' ? 4 : undefined,
  };
}

function getOverlayContainerStyle(textBgStyle: string) {
  const base = {
    alignSelf: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };
  switch (textBgStyle) {
    case 'solid_white':
      return { ...base, backgroundColor: '#FFFFFF', borderRadius: 8 };
    case 'solid_black':
      return { ...base, backgroundColor: '#000000', borderRadius: 8 };
    case 'translucent_dark':
      return { ...base, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8 };
    default:
      return { ...base, backgroundColor: 'transparent' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// DraggableOverlay
// When isBeingEdited: dims to 0.38 opacity + shows live draft text at its original
// position. No separate ghost or centre copy — this IS the only visible text.
// ─────────────────────────────────────────────────────────────────────────────
interface DraggableOverlayProps {
  overlay: TextOverlay;
  onRemove: (id: string) => void;
  onEdit: (overlay: TextOverlay) => void;
  onUpdateTransform: (id: string, x: number, y: number, scale: number, rotation: number) => void;
  isBeingEdited?: boolean;
  liveDraft?: string;
  liveColor?: string;
  liveFontIndex?: number;
  liveTextBgStyle?: TextOverlay['textBgStyle'];
  inputRef?: React.RefObject<any>;
  onChangeText?: (text: string) => void;
  onSubmitEditing?: () => void;
  mediaRect: { x: number; y: number; w: number; h: number };
  screenWidth: number;
  screenHeight: number;
}

const DraggableOverlay: React.FC<DraggableOverlayProps> = ({
  overlay, onRemove, onEdit, onUpdateTransform,
  isBeingEdited = false, liveDraft, liveColor, liveFontIndex, liveTextBgStyle,
  inputRef, onChangeText, onSubmitEditing, mediaRect, screenWidth, screenHeight,
}) => {
  const translateX     = useSharedValue(overlay.x);
  const translateY     = useSharedValue(overlay.y);
  const savedX         = useSharedValue(overlay.x);
  const savedY         = useSharedValue(overlay.y);
  const scale          = useSharedValue(overlay.scale || 1);
  const savedScale     = useSharedValue(overlay.scale || 1);
  const rotation       = useSharedValue(overlay.rotation || 0);
  const savedRotation  = useSharedValue(overlay.rotation || 0);
  const opacityAnim    = useSharedValue(1);

  // Dynamic box dimensions for accurate bounds clamping
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 100, h: 50 });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) {
      setBoxSize({ w, h });
    }
  }, []);

  useEffect(() => {
    translateX.value    = overlay.x;
    savedX.value        = overlay.x;
    translateY.value    = overlay.y;
    savedY.value        = overlay.y;
    scale.value         = overlay.scale || 1;
    savedScale.value    = overlay.scale || 1;
    rotation.value      = overlay.rotation || 0;
    savedRotation.value = overlay.rotation || 0;
  }, [overlay.x, overlay.y, overlay.scale, overlay.rotation]);

  useEffect(() => {
    opacityAnim.value = withTiming(1, { duration: 180 });
  }, [isBeingEdited]);

  const notifyTransform = useCallback(
    (x: number, y: number, s: number, r: number) => onUpdateTransform(overlay.id, x, y, s, r),
    [overlay.id, onUpdateTransform]
  );

  const pan = Gesture.Pan()
    .enabled(!isBeingEdited)
    .onStart(() => { savedX.value = translateX.value; savedY.value = translateY.value; })
    .onUpdate((e) => {
      let newX = savedX.value + e.translationX;
      let newY = savedY.value + e.translationY;
      if (mediaRect && mediaRect.w > 0 && mediaRect.h > 0) {
        const halfW = (boxSize.w / 2) * scale.value;
        const halfH = (boxSize.h / 2) * scale.value;

        const initialCenterX = screenWidth / 2;
        const initialCenterY = (screenHeight * 0.42) + (boxSize.h / 2);

        let minX = (mediaRect.x + halfW) - initialCenterX;
        let maxX = (mediaRect.x + mediaRect.w - halfW) - initialCenterX;
        if (minX > maxX) minX = maxX = (mediaRect.x + mediaRect.w / 2) - initialCenterX;

        let minY = (mediaRect.y + halfH) - initialCenterY;
        let maxY = (mediaRect.y + mediaRect.h - halfH) - initialCenterY;
        if (minY > maxY) minY = maxY = (mediaRect.y + mediaRect.h / 2) - initialCenterY;

        newX = Math.max(minX, Math.min(maxX, newX));
        newY = Math.max(minY, Math.min(maxY, newY));
      }
      translateX.value = newX;
      translateY.value = newY;
    })
    .onEnd(() => {
      savedX.value = translateX.value; savedY.value = translateY.value;
      runOnJS(notifyTransform)(savedX.value, savedY.value, scale.value, rotation.value);
    });

  const pinch = Gesture.Pinch()
    .enabled(!isBeingEdited)
    .onStart(() => { savedScale.value = scale.value; })
    .onUpdate((e) => { scale.value = Math.max(0.3, Math.min(4, savedScale.value * e.scale)); })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(notifyTransform)(translateX.value, translateY.value, scale.value, rotation.value);
    });

  const rot = Gesture.Rotation()
    .enabled(!isBeingEdited)
    .onStart(() => { savedRotation.value = rotation.value; })
    .onUpdate((e) => { rotation.value = savedRotation.value + e.rotation; })
    .onEnd(() => {
      savedRotation.value = rotation.value;
      runOnJS(notifyTransform)(translateX.value, translateY.value, scale.value, rotation.value);
    });

  const doubleTap = Gesture.Tap()
    .enabled(!isBeingEdited)
    .numberOfTaps(2)
    .onEnd(() => { runOnJS(onEdit)(overlay); });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotateZ: `${(rotation.value * 180) / Math.PI}deg` },
    ],
    opacity: opacityAnim.value,
  }));

  // Show live draft while being edited; otherwise show committed text
  const displayText     = isBeingEdited ? (liveDraft    ?? overlay.text)        : overlay.text;
  const displayColor    = isBeingEdited ? (liveColor    ?? overlay.color)       : overlay.color;
  const displayFont     = isBeingEdited ? (liveFontIndex ?? overlay.fontIndex)  : overlay.fontIndex;
  const displayBgStyle  = isBeingEdited ? (liveTextBgStyle ?? overlay.textBgStyle) : overlay.textBgStyle;

  // Manage selection state so Android natively highlights/blinks cursor at text position
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);

  useEffect(() => {
    if (isBeingEdited) {
      setSelection({ start: displayText.length, end: displayText.length });
      const timer = setTimeout(() => {
        inputRef?.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSelection(undefined);
    }
  }, [isBeingEdited]);

  const cursorColor = displayBgStyle === 'solid' ? '#007AFF' : (displayColor.toLowerCase() === '#ffffff' ? '#007AFF' : '#FFFFFF');

  const content = (
    <Animated.View
      style={[
        { position: 'absolute', top: '42%', alignSelf: 'center', zIndex: isBeingEdited ? 200 : 90, padding: 12, justifyContent: 'center', alignItems: 'center' },
        animStyle
      ]}
      onLayout={handleLayout}
    >
      <View style={getOverlayContainerStyle(displayBgStyle)}>
        {isBeingEdited ? (
          <TextInput
            ref={inputRef}
            style={[
              getOverlayTextStyle(displayColor, displayFont, displayBgStyle),
              { paddingHorizontal: 8, paddingVertical: 4, minWidth: 40, textAlign: 'center' },
            ]}
            value={displayText}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmitEditing}
            autoFocus
            multiline
            caretHidden={false}
            blurOnSubmit={false}
            cursorColor={cursorColor}
            selectionColor={`${cursorColor}66`}
            selection={selection}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          />
        ) : (
          <Text style={getOverlayTextStyle(displayColor, displayFont, displayBgStyle)}>
            {displayText}
          </Text>
        )}
      </View>
    </Animated.View>
  );

  if (isBeingEdited) {
    return content;
  }

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, rot, doubleTap)}>
      {content}
    </GestureDetector>
  );
};



// ─────────────────────────────────────────────────────────────────────────────
// Main Types
// ─────────────────────────────────────────────────────────────────────────────
interface PendingMediaItem {
  mediaUri: string;
  mediaType: 'photo' | 'video';
}

interface RouteParams {
  mediaUri?: string;
  mediaType?: 'photo' | 'video';
  source?: 'camera' | 'gallery';
  pendingMedia?: PendingMediaItem[];
  restrictedTo?: number[];
  _storyIndex?: number;
  _storyTotal?: number;
}

export interface StatusEditItem {
  id: string;
  mediaUri: string;
  mediaType: 'photo' | 'video';
  caption: string;
  overlays: TextOverlay[];
  // single-text legacy fields removed — now all text is in overlays[]
}

type EditorMode = 'text' | 'sketch';

// ─────────────────────────────────────────────────────────────────────────────
// StatusEditorScreen
// ─────────────────────────────────────────────────────────────────────────────
const StatusEditorScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('screen');
  const { theme, isDark } = useTheme();
  const params = (route.params as RouteParams) ?? {};

  const safeTop = Math.max(insets.top, StatusBar.currentHeight || 0, 24);
  // Edge-to-edge: media fills the full screen — nav bar is transparent
  const safeBottom = 0;

  const pendingMedia: PendingMediaItem[] = params.pendingMedia ?? [];

  const makeItem = (id: string, mediaUri: string, mediaType: 'photo' | 'video'): StatusEditItem => ({
    id,
    mediaUri,
    mediaType,
    caption: '',
    overlays: [],
  });

  const [items, setItems] = useState<StatusEditItem[]>(() => {
    const list: StatusEditItem[] = [];
    if (params.mediaUri) {
      list.push(makeItem('initial', params.mediaUri, params.mediaType ?? 'photo'));
    }
    pendingMedia.forEach((pm, idx) => {
      list.push(makeItem(`pending_${idx}`, pm.mediaUri, pm.mediaType));
    });
    return list;
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const currentItem = items[activeIndex] ?? items[0];

  const updateItem = useCallback((updates: Partial<StatusEditItem>) => {
    setItems(prev => prev.map((item, idx) => idx === activeIndex ? { ...item, ...updates } : item));
  }, [activeIndex]);

  // ── Per-item overlays ──────────────────────────────────────────────────────
  // Active text-editing state (not stored in items until commit)
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [draftText, setDraftText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isTextMode, setIsTextMode] = useState(false);
  const [isEditingOverlayText, setIsEditingOverlayText] = useState(false);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [fontIndex, setFontIndex] = useState(0);
  const [textBgStyle, setTextBgStyle] = useState<'none' | 'solid_white' | 'solid_black' | 'translucent_dark'>('none');

  const overlayInputRef = useRef<TextInput>(null);

  // Sync overlays when switching active items
  useEffect(() => {
    setOverlays(currentItem?.overlays ?? []);
    setIsTextMode(false);
    setIsEditingOverlayText(false);
    setDraftText('');
    setEditingId(null);
  }, [activeIndex]);

  // Persist overlays back to items when they change
  useEffect(() => {
    if (currentItem) {
      updateItem({ overlays });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);

  // ── Text overlay actions ───────────────────────────────────────────────────
  const startNewTextOverlay = useCallback(() => {
    if (currentItem?.mediaType === 'video') return;
    // If currently editing, commit first
    if (isEditingOverlayText && draftText.trim()) {
      commitTextOverlay(false);
    }
    setEditingId(null);
    setDraftText('');
    setTextColor('#FFFFFF');
    setFontIndex(0);
    setTextBgStyle('none');
    setIsEditingOverlayText(true);
    setIsTextMode(true);
    setTimeout(() => overlayInputRef.current?.focus(), 80);
  }, [currentItem?.mediaType, isEditingOverlayText, draftText]);

  const handleEditOverlay = useCallback((overlay: TextOverlay) => {
    setEditingId(overlay.id);
    setDraftText(overlay.text);
    setTextColor(overlay.color);
    setFontIndex(overlay.fontIndex || 0);
    setTextBgStyle(overlay.textBgStyle || 'none');
    setIsEditingOverlayText(true);
    setIsTextMode(true);
    setTimeout(() => overlayInputRef.current?.focus(), 80);
  }, []);

  const commitTextOverlay = useCallback((dismissKb = true) => {
    if (dismissKb) Keyboard.dismiss();
    setIsEditingOverlayText(false);
    setIsTextMode(false);
    if (draftText.trim()) {
      if (editingId) {
        setOverlays(prev =>
          prev.map(o =>
            o.id === editingId
              ? { ...o, text: draftText, color: textColor, fontIndex, textBgStyle }
              : o
          )
        );
      } else {
        const newOverlay: TextOverlay = {
          id: Date.now().toString(),
          text: draftText,
          color: textColor,
          fontIndex,
          textBgStyle,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
        };
        setOverlays(prev => [...prev, newOverlay]);
      }
    } else if (editingId) {
      setOverlays(prev => prev.filter(o => o.id !== editingId));
    }
    setDraftText('');
    setEditingId(null);
  }, [draftText, editingId, textColor, fontIndex, textBgStyle]);

  const handleUpdateOverlayTransform = useCallback((id: string, x: number, y: number, sc: number, rot: number) => {
    setOverlays(prev => prev.map(o => (o.id === id ? { ...o, x, y, scale: sc, rotation: rot } : o)));
  }, []);

  const handleRemoveOverlay = useCallback((id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  // ── Other editing state ────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState<EditorMode>('text');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isEraser, setIsEraser] = useState(false);
  const [strokeColor, setStrokeColor] = useState(STROKE_COLORS[1]);
  const [strokeWidthIdx, setStrokeWidthIdx] = useState(1);
  const [strokeCount, setStrokeCount] = useState(0);
  const isSketch = editorMode === 'sketch';

  const [restrictedTo, setRestrictedTo] = useState<number[]>(params.restrictedTo ?? []);
  const [modalVisible, setModalVisible] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  // captureReady gates the baked overlays inside ViewShot — they are invisible
  // during normal interaction (to avoid duplicate ghosts during drag) and only
  // shown for the single frame when captureRef is called.
  const [captureReady, setCaptureReady] = useState(false);

  const sketchRef = useRef<any>(null);
  const viewShotRef = useRef<any>(null);
  const cancelUploadRef = useRef<boolean>(false);

  const [mediaRect, setMediaRect] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0, y: 0, w: width, h: height - safeBottom
  });

  const computeContainRect = useCallback((natW: number, natH: number) => {
    const usableHeight = height - safeBottom;
    if (natW <= 0 || natH <= 0) {
      setMediaRect({ x: 0, y: 0, w: width, h: usableHeight });
      return;
    }
    const mediaAspect = natW / natH;
    const screenAspect = width / usableHeight;
    let displayW: number, displayH: number, displayX: number, displayY: number;
    if (mediaAspect > screenAspect) {
      displayW = width;
      displayH = width / mediaAspect;
      displayX = 0;
      displayY = (usableHeight - displayH) / 2;
    } else {
      displayH = usableHeight;
      displayW = usableHeight * mediaAspect;
      displayX = (width - displayW) / 2;
      displayY = 0;
    }
    setMediaRect({ x: displayX, y: displayY, w: displayW, h: displayH });
  }, [width, height, safeBottom]);

  useEffect(() => {
    const uri = currentItem?.mediaUri;
    if (!uri) {
      setMediaRect({ x: 0, y: 0, w: width, h: height - safeBottom });
      return;
    }
    if (currentItem?.mediaType === 'video') {
      setMediaRect({ x: 0, y: 0, w: width, h: height - safeBottom });
      return;
    }
    Image.getSize(
      uri,
      (imgW, imgH) => computeContainRect(imgW, imgH),
      () => setMediaRect({ x: 0, y: 0, w: width, h: height - safeBottom })
    );
  }, [currentItem?.mediaUri, width, height, safeBottom, computeContainRect]);

  const onVideoLoad = useCallback((data: any) => {
    const natW = data?.naturalSize?.width ?? 0;
    const natH = data?.naturalSize?.height ?? 0;
    computeContainRect(natW, natH);
  }, [computeContainRect]);

  useEffect(() => {
    if (!params.restrictedTo) {
      fetchPrivacyDefaults();
    }
  }, [params.restrictedTo]);

  // Force edge-to-edge transparent nav + status bar while this screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS === 'android') {
        pinNavBarColor('#00000000');
        try { changeNavigationBarColor('#00000000', true, false); } catch (_) {}
        if (NativeModules.SystemBar) {
          NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
          NativeModules.SystemBar.setStatusBarColor('#00000000', true);
        }
      }
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('light-content');
      StatusBar.setBackgroundColor('transparent');
      return () => {};
    }, [])
  );

  const fetchPrivacyDefaults = async () => {
    try {
      const res = await api.get('/chat/privacy/status/');
      if (res.data?.restricted_to) setRestrictedTo(res.data.restricted_to);
    } catch (e) {
      console.log('[StatusEditor] Failed to fetch privacy defaults:', e);
    }
  };

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightValue = useSharedValue(0);

  useEffect(() => {
    const handleShow = (e: any) => {
      const h = e.endCoordinates ? e.endCoordinates.height : 0;
      if (h > 0) {
        setKeyboardHeight(h);
        const totalOffset = h + (safeBottom > 0 ? safeBottom : 0);
        const duration = e.duration && e.duration > 0 ? e.duration : 220;
        keyboardHeightValue.value = withTiming(totalOffset, {
          duration,
          easing: Easing.out(Easing.quad),
        });
      }
    };

    const handleHide = (e: any) => {
      setKeyboardHeight(0);
      const duration = e && e.duration && e.duration > 0 ? e.duration : 200;
      keyboardHeightValue.value = withTiming(0, {
        duration,
        easing: Easing.out(Easing.quad),
      });
    };

    const willShowSub = Keyboard.addListener('keyboardWillShow', handleShow);
    const didShowSub = Keyboard.addListener('keyboardDidShow', handleShow);
    const willHideSub = Keyboard.addListener('keyboardWillHide', handleHide);
    const didHideSub = Keyboard.addListener('keyboardDidHide', handleHide);

    return () => {
      willShowSub.remove();
      didShowSub.remove();
      willHideSub.remove();
      didHideSub.remove();
    };
  }, []);

  useEffect(() => {
    const onBackPress = () => {
      if (isEditingOverlayText) {
        commitTextOverlay(true);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isEditingOverlayText, commitTextOverlay]);

  const animatedBottomContainerStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: -keyboardHeightValue.value }
      ],
      opacity: withTiming(isTextMode ? 0 : 1, { duration: 150 }),
    };
  });

  const cycleBgStyle = () => {
    setTextBgStyle(prev => {
      const idx = BG_STYLES.indexOf(prev);
      return BG_STYLES[(idx + 1) % BG_STYLES.length];
    });
    setTimeout(() => overlayInputRef.current?.focus(), 30);
  };

  const cycleFontStyle = () => {
    setFontIndex(prev => (prev + 1) % FONT_STYLES.length);
    setTimeout(() => overlayInputRef.current?.focus(), 30);
  };

  const handleUpload = async () => {
    if (items.length === 0) return;
    Keyboard.dismiss();
    cancelUploadRef.current = false;
    setIsCapturing(true);

    const queue: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let finalUri = item.mediaUri;

      try {
        if (item.mediaType === 'video') {
          finalUri = await compressAndTrimVideo(item.mediaUri);
        } else {
          // 1. Show baked overlays inside ViewShot
          setCaptureReady(true);
          // 2. Wait one frame so React flushes the render before capture
          await new Promise(r => setTimeout(r, 80));
          const snapshotUri = await captureRef(viewShotRef, {
            format: 'jpg',
            quality: 0.92,
          });
          // 3. Hide baked overlays again immediately
          setCaptureReady(false);
          finalUri = snapshotUri;
        }
      } catch (err) {
        console.log('[StatusEditorScreen] Capture error:', err);
      }

      queue.push({
        mediaUri: finalUri,
        mediaType: item.mediaType,
        caption: item.caption,
        restrictedTo: restrictedTo,
      });
      if (cancelUploadRef.current) return;
    }

    if (cancelUploadRef.current) return;
    setIsCapturing(false);

    setTimeout(() => {
      navigation.replace('StatusViewer', {
        uploadQueue: queue,
        isOwn: true,
      });
    }, 150);
  };

  const currentOverlays = overlays;
  const hasOverlays = currentOverlays.length > 0;

  return (
    <GestureHandlerRootView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} animated={true} />

      <LinearGradient
        colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.28)', 'transparent']}
        style={[s.topScrim, { height: safeTop + 110 }]}
        pointerEvents="none"
      />

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.62)']}
        style={[s.bottomScrim, { height: safeBottom + 120 }]}
        pointerEvents="none"
      />

      {/* ── Top Header Bar ── */}
      <View style={[s.topBar, { paddingTop: safeTop + 8 }]}>
        <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()}>
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={s.topActions}>
          {currentItem?.mediaType !== 'video' && (
            <>
              {/* T Button — starts new text overlay */}
              <TouchableOpacity
                style={[s.topBtn, (isTextMode || hasOverlays) && s.topBtnActive]}
                onPress={startNewTextOverlay}
              >
                <Text style={s.fontToggleText}>T</Text>
              </TouchableOpacity>

              {/* Show text-editing controls when in text mode */}
              {isTextMode ? (
                <>
                  <TouchableOpacity style={s.topBtn} onPress={cycleBgStyle}>
                    <Icon name="color-fill-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.topBtn} onPress={cycleFontStyle}>
                    <Text style={s.fontToggleText}>
                      {FONT_STYLES[fontIndex].label[0]}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.topBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                    <View style={[s.colorIndicator, { backgroundColor: textColor }]} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Mode toggle: text / sketch */}
                  <TouchableOpacity
                    style={[s.topBtn, isSketch && s.topBtnActive]}
                    onPress={() => {
                      setEditorMode(isSketch ? 'text' : 'sketch');
                      setShowColorPicker(false);
                    }}
                  >
                    <Icon name={isSketch ? 'pencil' : 'pencil-outline'} size={22} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {currentItem?.mediaType !== 'video' && !isSketch && !isTextMode && (
            <>
              <TouchableOpacity style={s.topBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                <View style={[s.colorIndicator, { backgroundColor: '#FFF' }]} />
              </TouchableOpacity>
            </>
          )}

          {isSketch && (
            <>
              <TouchableOpacity
                style={[s.topBtn, isEraser && s.topBtnActive]}
                onPress={() => setIsEraser(!isEraser)}
              >
                <Icon name="browsers-outline" size={22} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.topBtn, strokeCount === 0 && s.topBtnDisabled]}
                onPress={() => {
                  sketchRef.current?.undo();
                  setStrokeCount(c => Math.max(0, c - 1));
                }}
                disabled={strokeCount === 0}
              >
                <Icon name="arrow-undo" size={22} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.topBtn, strokeCount === 0 && s.topBtnDisabled]}
                onPress={() => {
                  sketchRef.current?.clear();
                  setStrokeCount(0);
                }}
                disabled={strokeCount === 0}
              >
                <Icon name="trash-outline" size={22} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={s.topBtn}
                onPress={() => setStrokeWidthIdx(i => (i + 1) % STROKE_WIDTHS.length)}
              >
                <View style={{
                  width: STROKE_WIDTHS[strokeWidthIdx],
                  height: STROKE_WIDTHS[strokeWidthIdx],
                  borderRadius: STROKE_WIDTHS[strokeWidthIdx] / 2,
                  backgroundColor: strokeColor,
                  maxWidth: 22, maxHeight: 22,
                }} />
              </TouchableOpacity>

              <TouchableOpacity style={s.topBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                <View style={[s.colorIndicator, { backgroundColor: strokeColor }]} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* ── Colour Swatches Strip ── */}
      {showColorPicker && currentItem?.mediaType !== 'video' && (
        <View style={[s.colorPickerStrip, { top: safeTop + 60 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}>
            {(isSketch ? STROKE_COLORS : TEXT_COLORS).map(c => {
              const isSelected = (isSketch ? strokeColor : textColor) === c;
              const isLightColor = c === '#FFFFFF' || c === '#FFFF00' || c === '#00FFFF' || c === '#FFEB3B' || c === '#FFC107';
              const indicatorColor = isLightColor ? '#000000' : '#FFFFFF';

              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => {
                    if (isSketch) {
                      setStrokeColor(c);
                    } else {
                      setTextColor(c);
                      // Refocus immediately — no delay so the color applies on first tap
                      overlayInputRef.current?.focus();
                    }
                  }}
                  style={[
                    s.colorSwatch,
                    {
                      backgroundColor: c,
                      borderColor: isSelected
                        ? indicatorColor
                        : (c.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.4)'),
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  {isSelected && (
                    <Icon name="checkmark" size={16} color={indicatorColor} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Media Bounding Box overlay black bars */}
      {mediaRect.x > 0 && (
        <>
          <View style={[s.blackBar, { left: 0, width: mediaRect.x }]} />
          <View style={[s.blackBar, { right: 0, width: mediaRect.x }]} />
        </>
      )}

      {/* ── Media + Sketch + Overlays composite layer (captured by ViewShot) ── */}
      <ViewShot
        ref={viewShotRef}
        style={[
          s.mediaLayer,
          { left: mediaRect.x, top: mediaRect.y, width: mediaRect.w, height: mediaRect.h },
        ]}
        options={{ format: 'jpg', quality: 0.92 }}
        pointerEvents="none"
      >
        {currentItem?.mediaType === 'video' ? (
          <Video
            source={{ uri: currentItem.mediaUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            repeat
            onLoad={onVideoLoad}
          />
        ) : (
          <Image
            source={{ uri: currentItem.mediaUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        )}

        <SketchCanvas
          ref={sketchRef}
          style={StyleSheet.absoluteFill}
          strokeColor={isEraser ? '#00000000' : strokeColor}
          strokeWidth={STROKE_WIDTHS[strokeWidthIdx]}
          touchEnabled={isSketch && !isTextMode}
          onPathsChange={(count) => setStrokeCount(count)}
        />

        {/* Baked overlays — ONLY shown during captureRef (captureReady=true).
             Hidden during normal use to prevent duplicate ghost during drag. */}
        {captureReady && currentItem?.mediaType !== 'video' && currentOverlays.map(overlay => (
          <View
            key={overlay.id}
            style={[
              {
                position: 'absolute',
                top: '42%',
                alignSelf: 'center',
                zIndex: 90,
                padding: 24,
                justifyContent: 'center',
                alignItems: 'center',
              },
              {
                transform: [
                  { translateX: overlay.x },
                  { translateY: overlay.y },
                  { scale: overlay.scale },
                  { rotateZ: `${(overlay.rotation * 180) / Math.PI}deg` },
                ],
              }
            ]}
            pointerEvents="none"
          >
            <View style={getOverlayContainerStyle(overlay.textBgStyle)}>
              <Text style={getOverlayTextStyle(overlay.color, overlay.fontIndex, overlay.textBgStyle)}>
                {overlay.text}
              </Text>
            </View>
          </View>
        ))}
      </ViewShot>

      {/* ── Full-screen backdrop: tapping outside while typing commits text ── */}
      {isTextMode && (
        <Pressable
          style={s.backdropPressable}
          onPress={() => commitTextOverlay(true)}
        />
      )}

      {/* ── Draggable overlays: bounded inside mediaRect ── */}
      {currentItem?.mediaType !== 'video' && currentOverlays.map(overlay => (
        <DraggableOverlay
          key={overlay.id}
          overlay={overlay}
          onRemove={handleRemoveOverlay}
          onEdit={handleEditOverlay}
          onUpdateTransform={handleUpdateOverlayTransform}
          isBeingEdited={isEditingOverlayText && editingId === overlay.id}
          liveDraft={draftText}
          liveColor={textColor}
          liveFontIndex={fontIndex}
          liveTextBgStyle={textBgStyle}
          inputRef={editingId === overlay.id ? overlayInputRef : undefined}
          onChangeText={editingId === overlay.id ? setDraftText : undefined}
          onSubmitEditing={editingId === overlay.id ? () => commitTextOverlay(true) : undefined}
          mediaRect={mediaRect}
          screenWidth={width}
          screenHeight={height}
        />
      ))}

      {/* ── Text input layer ──
           NEW text  → show centre editing box (no overlay exists yet)
           EDITING existing → TextInput is rendered directly inside DraggableOverlay */}
      {isEditingOverlayText && !editingId && (
        <View style={s.textInputOverlayLayer} pointerEvents="box-none">
          <View style={s.editingBox}>
            <TextInput
              ref={overlayInputRef}
              style={[getOverlayTextStyle(textColor, fontIndex, 'none'), { minWidth: 40, maxWidth: width * 0.85, textAlign: 'center', padding: 0, margin: 0 }]}
              value={draftText}
              onChangeText={setDraftText}
              onSubmitEditing={() => commitTextOverlay(true)}
              placeholder="Type text…"
              placeholderTextColor="rgba(255,255,255,0.5)"
              multiline
              autoFocus
              blurOnSubmit={false}
              returnKeyType="done"
            />
          </View>
        </View>
      )}

      {/* ── Animated bottom toolbar ── */}
      <Animated.View
        style={[s.bottomContainerFlex, animatedBottomContainerStyle]}
        pointerEvents={isTextMode ? 'none' : 'box-none'}
      >
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View
          style={[
            s.bottomSectionInner,
            { paddingBottom: Math.max(insets.bottom + 20, 28) }
          ]}
        >
          {/* Multi-Media Thumbnail Switcher */}
          {items.length > 1 && (
            <View style={s.thumbStripContainerRelative}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
                {items.map((item, idx) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => setActiveIndex(idx)}
                    style={[s.thumbBox, idx === activeIndex && s.thumbBoxActive]}
                  >
                    <Image source={{ uri: item.mediaUri }} style={s.thumbImg} />
                    {item.mediaType === 'video' && (
                      <View style={s.videoBadge}>
                        <Icon name="videocam" size={10} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Bottom Caption Input & Actions */}
          <View style={s.bottomBarAbsolute}>
            <TouchableOpacity style={s.privacyBtn} onPress={() => setModalVisible(true)}>
              <Icon name={restrictedTo.length > 0 ? 'eye-off' : 'eye'} size={22} color="#fff" />
            </TouchableOpacity>

            <TextInput
              style={s.captionInput}
              placeholder="Add a caption…"
              placeholderTextColor="rgba(255,255,255,0.7)"
              value={currentItem?.caption ?? ''}
              onChangeText={v => updateItem({ caption: v })}
            />

            <TouchableOpacity style={s.sendBtn} onPress={handleUpload} disabled={isCapturing}>
              {isCapturing
                ? <ActivityIndicator size="small" color="#4597f5f6" />
                : <Icon name="send" size={24} color="#4597f5f6" />}
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* ── Minimal Spinner & Cancel Button ── */}
      {isCapturing && (
        <View style={s.minimalUploadContainer}>
          <ActivityIndicator size="large" color="#E0E0E0" />
          <TouchableOpacity
            onPress={() => {
              cancelUploadRef.current = true;
              setIsCapturing(false);
            }}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            style={{
              marginTop: 16,
              backgroundColor: 'rgba(255, 69, 58, 0.15)',
              borderWidth: 1,
              borderColor: 'rgb(255, 69, 58)',
              borderRadius: 20,
              paddingVertical: 8,
              paddingHorizontal: 24,
              alignItems: 'center',
            }}
          >
            <Text style={s.minimalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <VisibilityModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSelect={setRestrictedTo}
        initialSelected={restrictedTo}
      />
    </GestureHandlerRootView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topScrim: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 50,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 50,
  },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 1000,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  topBtnDisabled: { opacity: 0.35 },
  fontToggleText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  colorIndicator: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#ffffff',
  },
  colorPickerStrip: {
    position: 'absolute',
    left: 0, right: 0,
    zIndex: 1001,
    paddingVertical: 6,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropPressable: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 80,
  },
  textInputOverlayLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 300,
  },
  // WhatsApp-style editing box: solid dark translucent container wrapping tightly around text
  // Invisible TextInput used when editing existing overlay — keyboard only,
  // the DraggableOverlay at its position shows the dim live text instead.
  hiddenKeyboardInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    bottom: 0,
  },
  editingBox: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaLayer: {
    position: 'absolute',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  blackBar: {
    position: 'absolute',
    top: 0, bottom: 0,
    backgroundColor: '#000',
    zIndex: 5,
  },
  minimalUploadContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 2000,
  },
  minimalCancelText: {
    color: '#FF453A',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  thumbStripContainerRelative: {
    width: '100%',
    marginBottom: 8,
  },
  thumbBox: {
    width: 44, height: 44,
    borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  thumbBoxActive: {
    borderColor: '#4597f5f6',
    transform: [{ scale: 1.1 }],
  },
  thumbImg: { width: '100%', height: '100%' },
  videoBadge: {
    position: 'absolute', bottom: 2, right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4, padding: 2,
  },
  bottomContainerFlex: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  bottomSectionInner: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
    paddingTop: 8,
  },
  bottomBarAbsolute: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'transparent',
  },
  captionInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(50,50,50,0.65)',
    borderRadius: 22,
    marginHorizontal: 10,
  },
  sendBtn: {
    backgroundColor: 'rgba(50,50,50,0.65)',
    borderRadius: 22,
    width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  privacyBtn: {
    backgroundColor: 'rgba(50,50,50,0.65)',
    borderRadius: 22,
    width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
});

export default StatusEditorScreen;
