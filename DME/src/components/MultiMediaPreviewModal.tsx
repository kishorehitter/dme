import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Dimensions,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  NativeModules,
  BackHandler,
  TouchableWithoutFeedback,
  Pressable,
} from 'react-native';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { pinNavBarColor } from '../utils/navBarPin';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import Video from 'react-native-video';
import ViewShot from 'react-native-view-shot';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, Easing, runOnJS, interpolate, Extrapolation } from 'react-native-reanimated';
import { SketchCanvas } from '@terrylinla/react-native-sketch-canvas';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';

const { width, height } = Dimensions.get('screen');

const TEXT_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ffcc00', '#34c759', '#007aff', '#af52de'];
const FONT_SIZES = [16, 22, 28, 36, 48];

const FONT_STYLES = [
  { id: 'sans',   label: 'Sans',   fontFamily: undefined,         fontWeight: 'bold' as const },
  { id: 'serif',  label: 'Serif',  fontFamily: 'serif',           fontWeight: 'normal' as const },
  { id: 'mono',   label: 'Mono',   fontFamily: 'monospace',       fontWeight: 'normal' as const },
  { id: 'script', label: 'Script', fontFamily: 'cursive',         fontWeight: 'normal' as const },
  { id: 'bold',   label: 'Bold',   fontFamily: undefined,         fontWeight: '900' as const },
];

export interface SelectedMedia {
  uri: string;
  type: string;
  fileName?: string;
  caption?: string;
}

interface MultiMediaPreviewModalProps {
  visible: boolean;
  mediaItems: SelectedMedia[];
  onClose: () => void;
  onSend: (items: SelectedMedia[]) => void;
  themeColor?: string;
}

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

interface Size {
  width: number;
  height: number;
}

function computeContainSize(image: Size, container: Size): Size {
  if (image.width === 0 || image.height === 0) return { width: 0, height: 0 };
  const ia = image.width / image.height;
  const ca = container.width / container.height;
  return ia > ca
    ? { width: container.width, height: container.width / ia }
    : { width: container.height * ia, height: container.height };
}

const getOverlayTextStyle = (color: string, fontIndex: number, textBgStyle: string) => {
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
};

const getOverlayContainerStyle = (textBgStyle: string) => {
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
};

// ─────────────────────────────────────────────────────────────────────────────
// DraggableOverlay Component
// Rendered as static Text inside GestureDetector so gestures NEVER trigger clipboard tooltips!
// ─────────────────────────────────────────────────────────────────────────────
interface DraggableOverlayProps {
  overlay: TextOverlay;
  onRemove: (id: string) => void;
  onEdit: (overlay: TextOverlay) => void;
  onUpdateTransform: (id: string, x: number, y: number, scale: number, rotation: number) => void;
}

const DraggableOverlay: React.FC<DraggableOverlayProps> = ({
  overlay,
  onRemove,
  onEdit,
  onUpdateTransform,
}) => {
  const translateX = useSharedValue(overlay.x);
  const translateY = useSharedValue(overlay.y);
  const savedX = useSharedValue(overlay.x);
  const savedY = useSharedValue(overlay.y);
  const scale = useSharedValue(overlay.scale || 1);
  const savedScale = useSharedValue(overlay.scale || 1);
  const rotation = useSharedValue(overlay.rotation || 0);
  const savedRotation = useSharedValue(overlay.rotation || 0);

  useEffect(() => {
    translateX.value = overlay.x;
    savedX.value = overlay.x;
    translateY.value = overlay.y;
    savedY.value = overlay.y;
    scale.value = overlay.scale || 1;
    savedScale.value = overlay.scale || 1;
    rotation.value = overlay.rotation || 0;
    savedRotation.value = overlay.rotation || 0;
  }, [overlay.x, overlay.y, overlay.scale, overlay.rotation]);

  const notifyTransform = useCallback(
    (x: number, y: number, s: number, r: number) => onUpdateTransform(overlay.id, x, y, s, r),
    [overlay.id, onUpdateTransform]
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
      runOnJS(notifyTransform)(savedX.value, savedY.value, scale.value, rotation.value);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.3, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(notifyTransform)(translateX.value, translateY.value, scale.value, rotation.value);
    });

  const rot = Gesture.Rotation()
    .onStart(() => {
      savedRotation.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = savedRotation.value + e.rotation;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
      runOnJS(notifyTransform)(translateX.value, translateY.value, scale.value, rotation.value);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(onEdit)(overlay);
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotateZ: `${(rotation.value * 180) / Math.PI}deg` },
    ],
  }));

  const composedGesture = Gesture.Simultaneous(pan, pinch, rot, doubleTap);

  return (
    <GestureDetector gesture={composedGesture}>
      <Reanimated.View
        style={[
          {
            position: 'absolute',
            top: '42%',
            alignSelf: 'center',
            zIndex: 90,
            padding: 24,
            minWidth: 120,
            minHeight: 70,
            justifyContent: 'center',
            alignItems: 'center',
          },
          animStyle,
        ]}
      >
        <View style={getOverlayContainerStyle(overlay.textBgStyle)}>
          <Text style={getOverlayTextStyle(overlay.color, overlay.fontIndex, overlay.textBgStyle)}>
            {overlay.text}
          </Text>
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
};

const PreviewVideoPlayer = ({ uri, isActive }: { uri: string; isActive: boolean }) => {
  const { theme } = useTheme();
  const styles = dynamicStyles(theme);
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setPaused(true);
    }
  }, [isActive]);

  const handlePlayPause = () => {
    setPaused(prev => !prev);
  };

  const onLoad = (data: any) => {
    setDuration(data.duration || 0);
  };

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.fullMedia}>
      <Video
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        paused={paused}
        controls={false}
        onLoad={onLoad}
        repeat
      />
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={handlePlayPause}
      >
        {paused && (
          <View style={styles.playOverlayButton}>
            <Icon name="play" size={32} color="#FFF" style={{ marginLeft: 3 }} />
          </View>
        )}
        {duration > 0 && (
          <View style={styles.durationOverlay}>
            <Text style={styles.durationText}>{formatDuration(duration)}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export const MultiMediaPreviewModal: React.FC<MultiMediaPreviewModalProps> = ({
  visible,
  mediaItems,
  onClose,
  onSend,
  themeColor = '#4597f5f6',
}) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(insets.top, StatusBar.currentHeight || 0, 24);
  const getNavBarHeight = () => {
    if (Platform.OS === 'ios') return insets.bottom;
    const screenHeight = Dimensions.get('screen').height;
    const windowHeight = Dimensions.get('window').height;
    const statusBarHeight = StatusBar.currentHeight || 24;
    const diff = screenHeight - windowHeight - statusBarHeight;
    return diff > 0 ? diff : 0;
  };
  const safeBottom = Math.max(getNavBarHeight(), insets.bottom, 16);
  const styles = dynamicStyles(theme, safeBottom);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightValue = useSharedValue(0);

  const animatedBottomContainerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: -keyboardHeightValue.value }],
    };
  });

  useEffect(() => {
    const handleShow = (e: any) => {
      const h = e.endCoordinates ? e.endCoordinates.height : 0;
      if (h > 0) {
        const duration = e.duration && e.duration > 0 ? e.duration : 180;
        keyboardHeightValue.value = withTiming(h, {
          duration,
          easing: Easing.bezier(0.2, 0, 0.2, 1),
        });
      }
    };

    const handleHide = (e: any) => {
      const duration = e && e.duration && e.duration > 0 ? e.duration : 180;
      keyboardHeightValue.value = withTiming(0, {
        duration,
        easing: Easing.bezier(0.2, 0, 0.2, 1),
      });
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, handleShow);
    const hideSub = Keyboard.addListener(hideEvent, handleHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible && Platform.OS === 'android') {
      pinNavBarColor('#00000000');
      try {
        if (NativeModules.SystemBar?.setNavigationBarColor) {
          NativeModules.SystemBar.setNavigationBarColor('#00000000', false);
        } else if (changeNavigationBarColor) {
          changeNavigationBarColor('#00000000', false, false);
        }
      } catch (e) {}

      const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isTextMode) {
          // exitTextMode is defined later, call via inline equivalent
          setIsTextMode(false);
          setIsEditingOverlayText(false);
          setDraftText('');
          setEditingId(null);
          Keyboard.dismiss();
        } else if (isEditing) {
          cancelEdits();
        } else {
          onClose();
        }
        return true;
      });
      return () => {
        backSub.remove();
        const navColor = theme?.navBar || theme?.background || '#FFFFFF';
        pinNavBarColor(navColor);
        try { changeNavigationBarColor(navColor, !isDark, false); } catch (_) {}
      };
    }
  }, [visible, isEditing, isTextMode, onClose]);



  const [items, setItems] = useState<SelectedMedia[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState('');
  useEffect(() => {
    if (visible) {
      setItems(mediaItems);
      setActiveIndex(0);
      setCaption('');
      resetEditStates();
      if (Platform.OS === 'android' && NativeModules.SystemBar?.setNavigationBarColor) {
        try {
          NativeModules.SystemBar.setNavigationBarColor('#00000000', false);
        } catch (e) {}
      }
    }
  }, [visible, mediaItems]);

  // Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<'view' | 'draw' | 'text'>('view');
  const [editorMode, setEditorMode] = useState<'text' | 'sketch'>('text');
  const isSketch = editorMode === 'sketch';
  const [textColor, setTextColor] = useState('#ffffff');
  const [strokeColor, setStrokeColor] = useState('#ffff00');
  const [fontIndex, setFontIndex] = useState(0);
  const [textBgStyle, setTextBgStyle] = useState<'none' | 'fill' | 'outline'>('none');
  const [isEditingOverlayText, setIsEditingOverlayText] = useState(false);
  const [isEraser, setIsEraser] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [draftText, setDraftText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [overlayText, setOverlayText] = useState('');
  const overlayInputRef = useRef<TextInput>(null);
  // Hidden input that keeps keyboard mounted after tick is pressed
  const keyboardKeeperRef = useRef<TextInput>(null);
  // Whether we are in "text mode" (keyboard should stay up)
  const [isTextMode, setIsTextMode] = useState(false);

  // Media rect aspect ratio containment — 100% full edge-to-edge
  const [mediaRect, setMediaRect] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0, y: 0, w: width, h: height
  });

  const computeContainRect = useCallback((natW: number, natH: number) => {
    const usableHeight = height;
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
  }, [width, height]);

  useEffect(() => {
    const item = items[activeIndex];
    if (!item || !item.uri) {
      setMediaRect({ x: 0, y: 0, w: width, h: height });
      return;
    }
    if (item.type?.startsWith('video') || item.uri.endsWith('.mp4') || item.uri.endsWith('.mov')) {
      setMediaRect({ x: 0, y: 0, w: width, h: height });
      return;
    }
    Image.getSize(
      item.uri,
      (imgW, imgH) => computeContainRect(imgW, imgH),
      () => setMediaRect({ x: 0, y: 0, w: width, h: height })
    );
  }, [activeIndex, items, width, height, computeContainRect]);

  const getTextStyle = () => {
    const font = FONT_STYLES[fontIndex || 0];
    const isLightBg = textBgStyle === 'solid_white';
    return {
      color: isLightBg ? '#000000' : textColor,
      fontFamily: font.fontFamily,
      fontWeight: (font.fontWeight ?? 'normal') as any,
      fontSize: 24,
      textAlign: 'center' as const,
      includeFontPadding: false,
      padding: 0,
      margin: 0,
      textShadowColor: textBgStyle === 'none' ? 'rgba(0,0,0,0.75)' : undefined,
      textShadowOffset: textBgStyle === 'none' ? { width: 0, height: 1 } : undefined,
      textShadowRadius: textBgStyle === 'none' ? 4 : undefined,
    };
  };

  const getTextContainerStyle = () => {
    const base = { alignSelf: 'center' as const };
    switch (textBgStyle) {
      case 'solid_white':
        return { ...base, backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 };
      case 'solid_black':
        return { ...base, backgroundColor: '#000000', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 };
      case 'translucent_dark':
        return { ...base, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 };
      default:
        return { ...base, backgroundColor: 'transparent', paddingHorizontal: 6, paddingVertical: 2 };
    }
  };

  const cycleBgStyle = () => {
    setTextBgStyle((prev: any) => {
      if (prev === 'none') return 'solid_white';
      if (prev === 'solid_white') return 'solid_black';
      if (prev === 'solid_black') return 'translucent_dark';
      return 'none';
    });
    // Keep keyboard alive
    setTimeout(() => {
      if (isEditingOverlayText) overlayInputRef.current?.focus();
      else keyboardKeeperRef.current?.focus();
    }, 30);
  };

  const cycleFontStyle = () => {
    setFontIndex((prev) => (prev + 1) % FONT_STYLES.length);
    // Keep keyboard alive
    setTimeout(() => {
      if (isEditingOverlayText) overlayInputRef.current?.focus();
      else keyboardKeeperRef.current?.focus();
    }, 30);
  };

  // Layout measurements for Ar containment
  const [containerSize, setContainerSize] = useState<Size>({ width: 1, height: 1 });
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [sizeReady, setSizeReady] = useState(false);

  const viewShotRef = useRef<ViewShot>(null);
  const overlaysShotRef = useRef<ViewShot>(null);
  const sketchRef = useRef<SketchCanvas>(null);
  const inputRef = useRef<TextInput>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      setItems(mediaItems);
      setActiveIndex(0);
      setCaption('');
      setIsEditing(false);
      resetEditStates();
    }
  }, [visible, mediaItems]);

  const resetEditStates = () => {
    setEditMode('view');
    setOverlays([]);
    setDraftText('');
    setEditingId(null);
    setHasDrawing(false);
    setSizeReady(false);
    setNaturalSize(null);
    setIsTextMode(false);
    setIsEditingOverlayText(false);
    Keyboard.dismiss();
  };



  const currentItem = items[activeIndex];
  const isCurrentVideo = currentItem?.type?.startsWith('video') || currentItem?.uri.endsWith('.mp4') || currentItem?.uri.endsWith('.mov');
  const canEdit = !isCurrentVideo;

  // Resolve natural image size when editing starts or swiped item changes
  useEffect(() => {
    if (!isEditing || !currentItem || isCurrentVideo) return;
    setSizeReady(false);
    setNaturalSize(null);
    Image.getSize(
      currentItem.uri,
      (w, h) => {
        setNaturalSize({ width: w, height: h });
        setSizeReady(true);
      },
      (err) => {
        console.warn('Image size load failed:', err);
        setNaturalSize({ width: width, height: height * 0.5 });
        setSizeReady(true);
      }
    );
  }, [isEditing, activeIndex, currentItem, isCurrentVideo]);

  const handleSend = async () => {
    // Exit text mode and dismiss keyboard before sending
    if (isTextMode) {
      setIsTextMode(false);
      setIsEditingOverlayText(false);
      setDraftText('');
      setEditingId(null);
      Keyboard.dismiss();
      await new Promise(r => setTimeout(r, 80));
    }
    let finalItems = [...items];

    // If the user is still in edit mode (drew or added text but didn't tap checkmark),
    // capture the canvas right now and bake it into the item before sending.
    if (isEditing && (hasDrawing || overlays.length > 0)) {
      try {
        await new Promise((r) => setTimeout(r, 150));
        const uri = await viewShotRef.current?.capture?.();
        if (uri) {
          finalItems = finalItems.map((item, idx) =>
            idx === activeIndex
              ? { ...item, uri, type: 'image/png', fileName: `edited_${Date.now()}.png` }
              : item
          );
        }
      } catch (err) {
        console.error('Auto-capture before send failed:', err);
      }
    }

    const sendableItems = finalItems.map((item, index) => ({
      ...item,
      caption: index === 0 ? caption : '',
    }));
    onSend(sendableItems);
  };

  const handleMomentumScrollEnd = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    if (index >= 0 && index < items.length) {
      setActiveIndex(index);
    }
  };

  const selectIndex = (index: number) => {
    setActiveIndex(index);
    flatListRef.current?.scrollToIndex({ index, animated: true });
  };

  // ── EDITING UTILITIES ──────────────────────────────────────────────────────
  const startNewTextOverlay = () => {
    if (!canEdit) return;
    setIsEditing(true);
    setEditMode('text');
    setEditingId(null);
    setDraftText('');
    setTextColor('#ffffff');
    setFontIndex(0);
    setTextBgStyle('none');
    setIsEditingOverlayText(true);
    setIsTextMode(true);
    setTimeout(() => overlayInputRef.current?.focus(), 100);
  };

  const handleEditOverlay = (overlay: TextOverlay) => {
    setIsEditing(true);
    setEditMode('text');
    setEditingId(overlay.id);
    setDraftText(overlay.text);
    setTextColor(overlay.color);
    setFontIndex(overlay.fontIndex || 0);
    setTextBgStyle(overlay.textBgStyle || 'none');
    setIsEditingOverlayText(true);
    setIsTextMode(true);
    setTimeout(() => overlayInputRef.current?.focus(), 100);
  };

  const handleUpdateOverlayTransform = (id: string, x: number, y: number, scale: number, rotation: number) => {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, x, y, scale, rotation } : o))
    );
  };

  const handleRemoveOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  };

  const commitTextOverlay = () => {
    Keyboard.dismiss();
    setIsEditingOverlayText(false);
    setIsTextMode(false);
    if (draftText.trim()) {
      if (editingId) {
        setOverlays((prev) =>
          prev.map((o) =>
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
        setOverlays((prev) => [...prev, newOverlay]);
      }
    } else if (editingId) {
      handleRemoveOverlay(editingId);
    }
    setDraftText('');
    setEditingId(null);
  };

  const exitTextMode = () => {
    setIsTextMode(false);
    setIsEditingOverlayText(false);
    setDraftText('');
    setEditingId(null);
    Keyboard.dismiss();
  };

  // Saves drawing/text edits, updates items list, and returns to swipe preview
  const saveEdits = async () => {
    setIsSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 200)); // Allow layouts to settle
      const uri = await viewShotRef.current?.capture?.();
      if (uri) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === activeIndex
              ? {
                  ...item,
                  uri,
                  type: 'image/png',
                  fileName: `edited_${Date.now()}.png`,
                }
              : item
          )
        );
      }
      setIsEditing(false);
      resetEditStates();
    } catch (err) {
      console.error('Failed to capture canvas edits:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdits = () => {
    setIsEditing(false);
    resetEditStates();
  };

  const renderMediaItem = ({ item, index }: { item: SelectedMedia; index: number }) => {
    const isVideo = item.type?.startsWith('video') || item.uri.endsWith('.mp4') || item.uri.endsWith('.mov');
    const isActive = index === activeIndex;
    if (isVideo) {
      return (
        <View style={styles.mediaWrapper}>
          <View style={[styles.mediaLayer, { left: mediaRect.x, top: mediaRect.y, width: mediaRect.w, height: mediaRect.h }]}>
            <PreviewVideoPlayer uri={item.uri} isActive={isActive} />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.mediaWrapper}>
        <View style={[styles.mediaLayer, { left: mediaRect.x, top: mediaRect.y, width: mediaRect.w, height: mediaRect.h }]}>
          <FastImage
            source={{ uri: item.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode={FastImage.resizeMode.contain}
          />
        </View>
      </View>
    );
  };

  const renderThumbnail = ({ item, index }: { item: SelectedMedia; index: number }) => {
    const isVideo = item.type?.startsWith('video') || item.uri.endsWith('.mp4') || item.uri.endsWith('.mov');
    const isActive = index === activeIndex;
    return (
      <TouchableOpacity
        onPress={() => !isEditing && selectIndex(index)}
        style={[
          styles.thumbnailWrapper,
          isActive && { borderColor: themeColor, borderWidth: 2.5 },
        ]}
        disabled={isEditing}
      >
        <Image source={{ uri: item.uri }} style={styles.thumbnail} />
        {isVideo && (
          <View style={styles.playIconOverlay}>
            <Icon name="play" size={12} color="#FFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const canRenderCanvas = sizeReady && naturalSize && containerSize.width > 1;
  const { width: imgW, height: imgH } = canRenderCanvas
    ? computeContainSize(naturalSize!, containerSize)
    : { width: 0, height: 0 };

  if (!visible || items.length === 0) return null;

  return (
    <Reanimated.View style={[StyleSheet.absoluteFill, { zIndex: 99999, backgroundColor: '#000000' }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} animated={true} />
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000000' }}>
        <TouchableWithoutFeedback
          onPress={() => {
            if (isEditingOverlayText || isTextMode) {
              commitTextOverlay();
            }
          }}
        >
          <View style={styles.container}>
            {/* ── MAIN MEDIA AREA (Non-shrinking full screen canvas) ── */}
            <View style={styles.canvasContainer}>
              {/* Base ViewShot layer — stays mounted at all times to prevent blinks/flashes */}
              <ViewShot
                ref={viewShotRef}
                style={[
                  styles.mediaLayer,
                  { left: mediaRect.x, top: mediaRect.y, width: mediaRect.w, height: mediaRect.h },
                ]}
                options={{ format: 'png', quality: 0.95, result: 'tmpfile' }}
              >
                {/* Base Image or Video */}
                {currentItem?.type?.startsWith('video') || currentItem?.uri.endsWith('.mp4') || currentItem?.uri.endsWith('.mov') ? (
                  <PreviewVideoPlayer uri={currentItem.uri} isActive={visible} />
                ) : (
                  <FastImage
                    source={{ uri: currentItem.uri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode={FastImage.resizeMode.contain}
                  />
                )}

                {/* Render committed Multi-Text Overlays */}
                {overlays.map((ov) => {
                  if (isEditingOverlayText && editingId === ov.id) return null;
                  return (
                    <DraggableOverlay
                      key={ov.id}
                      overlay={ov}
                      onRemove={handleRemoveOverlay}
                      onEdit={handleEditOverlay}
                      onUpdateTransform={handleUpdateOverlayTransform}
                    />
                  );
                })}

                {/* Centered TextInput modal for typing active draft */}
                {isEditingOverlayText && (
                  <>
                    <Pressable
                      style={[StyleSheet.absoluteFillObject, { zIndex: 100 }]}
                      onPress={commitTextOverlay}
                    />
                    <View style={[{ position: 'absolute', top: '42%', alignSelf: 'center', zIndex: 110 }, getOverlayContainerStyle(textBgStyle)]}>
                      <TextInput
                        ref={overlayInputRef}
                        style={[
                          getOverlayTextStyle(textColor, fontIndex, textBgStyle),
                          {
                            minWidth: 60,
                            maxWidth: width * 0.85,
                            textAlign: 'center',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                          }
                        ]}
                        value={draftText}
                        onChangeText={setDraftText}
                        onSubmitEditing={commitTextOverlay}
                        placeholder="Type text…"
                        placeholderTextColor="rgba(255,255,255,0.6)"
                        multiline
                        autoFocus
                        blurOnSubmit
                        returnKeyType="done"
                        contextMenuHidden={true}
                      />
                    </View>
                  </>
                )}

                {/* Overlay capture layer */}
                <ViewShot
                  ref={overlaysShotRef}
                  style={StyleSheet.absoluteFill}
                  options={{ format: 'png', quality: 1.0 }}
                >
                  {/* Sketch Canvas */}
                  <SketchCanvas
                    style={StyleSheet.absoluteFill}
                    strokeColor={isEraser ? '#00000000' : strokeColor}
                    strokeWidth={isEraser ? 25 : 5}
                    ref={sketchRef}
                    touchEnabled={isEditing && editMode === 'draw'}
                    onStrokeEnd={() => {
                      setHasDrawing(true);
                      setStrokeCount((c) => c + 1);
                    }}
                  />
                </ViewShot>
              </ViewShot>

              {/* Horizontal Swipable FlatList overlay — shown only when multiple items exist and not editing */}
              {items.length > 1 && !isEditing && (
                <FlatList
                  ref={flatListRef}
                  data={items}
                  renderItem={renderMediaItem}
                  keyExtractor={(_, i) => i.toString()}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={handleMomentumScrollEnd}
                  getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                  style={StyleSheet.absoluteFill}
                />
              )}
            </View>

            {/* ── TOP SCRIM & HEADER BAR ── */}
            <LinearGradient
              colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.28)', 'transparent']}
              style={[styles.topScrim, { height: safeTop + 100 }]}
              pointerEvents="none"
            />
            <View style={[styles.header, { paddingTop: safeTop + 8 }]}>
              <TouchableOpacity style={styles.topBtn} onPress={isEditing ? cancelEdits : onClose}>
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Edit Options Area — 100% Identical 5 Icons to StatusEditor */}
              <View style={styles.topActions}>
                {currentItem?.type !== 'video' && !currentItem?.type?.startsWith('video') && (
                  <>
                    {/* 1. T Font Icon — Floating Text Overlay */}
                    <TouchableOpacity
                      style={[styles.topBtn, (isEditing && editMode === 'text' && isEditingOverlayText) && styles.topBtnActive]}
                      onPress={() => {
                        if (isEditingOverlayText) {
                          commitTextOverlay();
                          startNewTextOverlay();
                        } else {
                          startNewTextOverlay();
                        }
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' }}>T</Text>
                    </TouchableOpacity>



                    {/* 2. Pencil Icon — Sketch Mode Toggle */}
                    <TouchableOpacity
                      style={[styles.topBtn, (isEditing && editMode === 'draw' && !isEraser) && styles.topBtnActive]}
                      onPress={() => {
                        if (isEditingOverlayText) {
                          commitTextOverlay();
                        }
                        if (!isEditing) {
                          setIsEditing(true);
                          setEditMode('draw');
                          setIsEraser(false);
                        } else if (editMode !== 'draw') {
                          setEditMode('draw');
                          setIsEraser(false);
                        } else if (isEraser) {
                          setIsEraser(false);
                        } else {
                          saveEdits();
                        }
                      }}
                    >
                      <Icon name={isEditing && editMode === 'draw' && !isEraser ? 'pencil' : 'pencil-outline'} size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  </>
                )}

                {currentItem?.type !== 'video' && !currentItem?.type?.startsWith('video') && editMode !== 'draw' && (
                  <>
                    {/* 3. Text Background Fill Style */}
                    <TouchableOpacity style={styles.topBtn} onPress={cycleBgStyle}>
                      <Icon name="color-fill-outline" size={20} color="#FFFFFF" />
                    </TouchableOpacity>

                    {/* 4. Font Style Toggle */}
                    <TouchableOpacity style={styles.topBtn} onPress={cycleFontStyle}>
                      <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }}>
                        {FONT_STYLES[fontIndex].label[0]}
                      </Text>
                    </TouchableOpacity>

                    {/* 5. Color Swatch Indicator */}
                    <TouchableOpacity
                      style={styles.topBtn}
                      onPress={() => {
                        setShowColorPicker(v => !v);
                        // Keep focus on overlay input so keyboard stays up
                        if (isEditingOverlayText) {
                          setTimeout(() => overlayInputRef.current?.focus(), 50);
                        }
                      }}
                    >
                      <View style={[styles.colorIndicator, { backgroundColor: textColor }]} />
                    </TouchableOpacity>
                  </>
                )}

                {isEditing && editMode === 'draw' && (
                  <>
                    {/* Eraser — mutually exclusive with pencil */}
                    <TouchableOpacity
                      style={[styles.topBtn, isEraser && styles.topBtnActive]}
                      onPress={() => setIsEraser(true)}
                    >
                      <Icon name="color-wand-outline" size={20} color="#FFFFFF" />
                    </TouchableOpacity>

                    {/* Undo */}
                    <TouchableOpacity
                      style={[styles.topBtn, strokeCount === 0 && { opacity: 0.4 }]}
                      onPress={() => {
                        sketchRef.current?.undo();
                        setStrokeCount(c => Math.max(0, c - 1));
                      }}
                      disabled={strokeCount === 0}
                    >
                      <Icon name="arrow-undo" size={20} color="#FFFFFF" />
                    </TouchableOpacity>

                    {/* Clear */}
                    <TouchableOpacity
                      style={[styles.topBtn, strokeCount === 0 && { opacity: 0.4 }]}
                      onPress={() => {
                        sketchRef.current?.clear();
                        setStrokeCount(0);
                      }}
                      disabled={strokeCount === 0}
                    >
                      <Icon name="trash-outline" size={20} color="#FFFFFF" />
                    </TouchableOpacity>

                    {/* Color Swatch Indicator for Sketch */}
                    <TouchableOpacity style={styles.topBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                      <View style={[styles.colorIndicator, { backgroundColor: strokeColor }]} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* ── Color Swatches Strip ── */}
            {showColorPicker && (
              <View style={[styles.colorPickerStrip, { top: safeTop + 60 }]}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
                  keyboardShouldPersistTaps="always"
                >
                  {TEXT_COLORS.map(c => {
                    const activeColor = editMode === 'draw' ? strokeColor : textColor;
                    const isSelected = activeColor === c;
                    const isLightColor = c === '#ffffff' || c === '#ffff00' || c === '#00ffff';
                    const indicatorColor = isLightColor ? '#000000' : '#FFFFFF';

                    return (
                      <TouchableOpacity
                        key={c}
                        onPressIn={() => {
                          if (editMode === 'draw') {
                            setStrokeColor(c);
                          } else {
                            setTextColor(c);
                            // Keep keyboard mounted — refocus active input
                            if (isEditingOverlayText) {
                              overlayInputRef.current?.focus();
                            } else {
                              keyboardKeeperRef.current?.focus();
                            }
                          }
                        }}
                        style={[
                          styles.colorSwatch,
                          {
                            backgroundColor: c,
                            borderColor: isSelected ? indicatorColor : 'rgba(255,255,255,0.4)',
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

            {/* Invisible keyboard keeper — keeps keyboard mounted after tick */}
            {isTextMode && !isEditingOverlayText && (
              <TextInput
                ref={keyboardKeeperRef}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1, bottom: 0 }}
                value=""
                onChangeText={() => {}}
                showSoftInputOnFocus
                caretHidden
              />
            )}

            {/* ── Industrial Standard Animated Keyboard Avoidance Layout (StatusEditor) ── */}
            <Reanimated.View
              style={[styles.bottomContainerFlex, animatedBottomContainerStyle]}
              pointerEvents="box-none"
            >
              <View
                style={[
                  styles.bottomSectionInner,
                  { paddingBottom: safeBottom > 0 ? safeBottom : 12 }
                ]}
              >
                {/* Multi-Media Thumbnail Switcher */}
                {items.length > 1 && (
                  <View style={styles.thumbnailContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailList}>
                      {items.map((item, idx) => (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => selectIndex(idx)}
                          style={[styles.thumbnailWrapper, idx === activeIndex && { borderColor: themeColor, borderWidth: 2.5 }]}
                        >
                          <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                          {(item.type?.startsWith('video') || item.uri.endsWith('.mp4') || item.uri.endsWith('.mov')) && (
                            <View style={styles.playIconOverlay}>
                              <Icon name="play" size={12} color="#FFF" />
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Bottom Caption Input & Actions */}
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.captionInput}
                    placeholder="Add a caption…"
                    placeholderTextColor="rgba(255,255,255,0.7)"
                    value={caption}
                    onChangeText={setCaption}
                    multiline
                    disabled={isSaving}
                  />
                  <TouchableOpacity
                    onPress={handleSend}
                    style={[styles.sendButton, { backgroundColor: themeColor }]}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Icon name="send" size={20} color="#FFF" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </Reanimated.View>
          </View>
        </TouchableWithoutFeedback>
      </GestureHandlerRootView>
    </Reanimated.View>
  );
};

const dynamicStyles = (theme: import('../utils/theme').ThemeColors, safeBottom: number = 0) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topScrim: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 40,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 40,
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
  },
  headerCount: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBtnActive: {
    backgroundColor: '#4597f5f6',
  },
  colorPickerStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 160,
    height: 44,
    justifyContent: 'center',
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  toolSelectorRow: {
    flex: 1,
    marginHorizontal: 16,
    justifyContent: 'center',
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  canvasContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width,
    height,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  canvasHint: {
    position: 'absolute',
    bottom: 8,
    textAlign: 'center',
    color: theme.textMuted,
    fontSize: 11,
  },
  mediaLayer: {
    position: 'absolute',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  mediaWrapper: {
    width,
    height,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  fullMedia: {
    width: '100%',
    height: '100%',
  },
  bottomContainerFlex: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  bottomSectionInner: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingTop: 8,
  },
  thumbnailContainer: {
    height: 62,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  thumbnailList: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  thumbnailWrapper: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.border,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  playIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  captionInput: {
    flex: 1,
    backgroundColor: 'rgba(30, 30, 30, 0.85)',
    color: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    maxHeight: 100,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4597f5f6',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  // Text Overlay Editing styles
  overlayWrap: {
    position: 'absolute',
    transform: [{ translateX: -50 }, { translateY: -20 }],
    padding: 16,
  },
  overlayText: {
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
    textAlign: 'center',
    minWidth: 40,
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  textModeInput: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.inputBackground,
    paddingHorizontal: 16,
    color: theme.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  doneBtn: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    alignSelf: 'center',
  },
  colorDotActive: {
    borderColor: '#4597f5f6',
    transform: [{ scale: 1.2 }],
  },
  fontSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 6,
  },
  sizeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  sizeBtnActive: {
    backgroundColor: '#4597f5f6',
  },
  sizeBtnText: {
    color: theme.textPrimary,
    fontWeight: 'bold',
  },
  headerMiddleContainer: {
    flex: 1,
    height: 38,
    marginHorizontal: 8,
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: 20,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    paddingVertical: 2,
  },
  inlineDivider: {
    width: 1.5,
    height: 18,
    backgroundColor: theme.border,
    marginHorizontal: 8,
    alignSelf: 'center',
  },
  playOverlayButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -32,
    marginLeft: -32,
  },
  durationOverlay: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  durationText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
