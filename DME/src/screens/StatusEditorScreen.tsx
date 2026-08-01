import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  View,
  Image,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
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
  withSpring,
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
  overlayText: string;
  textColor: string;
  textBgStyle: 'none' | 'translucent_dark' | 'solid_white' | 'solid_black';
  fontIndex: number;
  translationX: number;
  translationY: number;
  scale: number;
  rotation: number;
}

type EditorMode = 'text' | 'sketch';

const StatusEditorScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('screen');
  const { theme, isDark } = useTheme();
  const params = (route.params as RouteParams) ?? {};

  const safeTop = Math.max(insets.top, StatusBar.currentHeight || 0, 24);
  const getNavBarHeight = () => {
    if (Platform.OS === 'ios') return insets.bottom;
    const screenHeight = Dimensions.get('screen').height;
    const windowHeight = Dimensions.get('window').height;
    const statusBarHeight = StatusBar.currentHeight || 24;
    const diff = screenHeight - windowHeight - statusBarHeight;
    return diff > 0 ? diff : 0;
  };
  const safeBottom = Math.max(getNavBarHeight(), insets.bottom, 0);

  const pendingMedia: PendingMediaItem[] = params.pendingMedia ?? [];
  const storyIndex = params._storyIndex ?? 1;
  const storyTotal = params._storyTotal ?? (1 + pendingMedia.length);

  const [items, setItems] = useState<StatusEditItem[]>(() => {
    const list: StatusEditItem[] = [];
    if (params.mediaUri) {
      list.push({
        id: 'initial',
        mediaUri: params.mediaUri,
        mediaType: params.mediaType ?? 'photo',
        caption: '',
        overlayText: '',
        textColor: '#FFFFFF',
        textBgStyle: 'none',
        fontIndex: 0,
        translationX: 0,
        translationY: 0,
        scale: 1,
        rotation: 0,
      });
    }
    pendingMedia.forEach((pm, idx) => {
      list.push({
        id: `pending_${idx}`,
        mediaUri: pm.mediaUri,
        mediaType: pm.mediaType,
        caption: '',
        overlayText: '',
        textColor: '#FFFFFF',
        textBgStyle: 'none',
        fontIndex: 0,
        translationX: 0,
        translationY: 0,
        scale: 1,
        rotation: 0,
      });
    });
    return list;
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const currentItem = items[activeIndex] ?? items[0];

  const updateItem = (updates: Partial<StatusEditItem>) => {
    setItems(prev => prev.map((item, idx) => idx === activeIndex ? { ...item, ...updates } : item));
  };

  const [editorMode, setEditorMode] = useState<EditorMode>('text');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isEditingOverlayText, setIsEditingOverlayText] = useState(false);
  const [isEraser, setIsEraser] = useState(false);
  const [strokeColor, setStrokeColor] = useState(STROKE_COLORS[1]);
  const [strokeWidthIdx, setStrokeWidthIdx] = useState(1);
  const [strokeCount, setStrokeCount] = useState(0);

  const [restrictedTo, setRestrictedTo] = useState<number[]>(params.restrictedTo ?? []);
  const [modalVisible, setModalVisible] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const sketchRef = useRef<any>(null);
  const viewShotRef = useRef<any>(null);
  const overlayInputRef = useRef<TextInput>(null);
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

  // Native navigation bar is transparent globally via MainActivity.kt

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

  const openOverlayEditor = useCallback(() => {
    setIsEditingOverlayText(true);
    setTimeout(() => overlayInputRef.current?.focus(), 80);
  }, []);

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
        setIsEditingOverlayText(false);
        Keyboard.dismiss();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isEditingOverlayText]);

  const animatedBottomContainerStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: -keyboardHeightValue.value }
      ],
      opacity: withTiming(isEditingOverlayText ? 0 : 1, { duration: 150 }),
    };
  });

  const translationX = useSharedValue(currentItem?.translationX ?? 0);
  const translationY = useSharedValue(currentItem?.translationY ?? 0);
  const baseTransX = useSharedValue(translationX.value);
  const baseTransY = useSharedValue(translationY.value);
  const scale = useSharedValue(currentItem?.scale ?? 1);
  const baseScale = useSharedValue(1);
  const rotation = useSharedValue(currentItem?.rotation ?? 0);
  const baseRotation = useSharedValue(0);

  useEffect(() => {
    if (currentItem) {
      translationX.value = currentItem.translationX;
      translationY.value = currentItem.translationY;
      scale.value = currentItem.scale;
      rotation.value = currentItem.rotation;
    }
  }, [activeIndex]);

  const composedGesture = Gesture.Simultaneous(
    Gesture.Pan()
      .onStart(() => {
        baseTransX.value = translationX.value;
        baseTransY.value = translationY.value;
      })
      .onUpdate((e) => {
        translationX.value = baseTransX.value + e.translationX;
        translationY.value = baseTransY.value + e.translationY;
      })
      .onEnd(() => {
        runOnJS(updateItem)({ translationX: translationX.value, translationY: translationY.value });
      }),
    Gesture.Pinch()
      .onStart(() => {
        baseScale.value = scale.value;
      })
      .onUpdate((e) => {
        scale.value = baseScale.value * e.scale;
      })
      .onEnd(() => {
        runOnJS(updateItem)({ scale: scale.value });
      }),
    Gesture.Rotation()
      .onStart(() => {
        baseRotation.value = rotation.value;
      })
      .onUpdate((e) => {
        rotation.value = baseRotation.value + e.rotation;
      })
      .onEnd(() => {
        runOnJS(updateItem)({ rotation: rotation.value });
      })
  );

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translationX.value },
        { translateY: translationY.value },
        { scale: scale.value },
        { rotateZ: `${(rotation.value * 180) / Math.PI}deg` },
      ],
    };
  });

  const isSketch = editorMode === 'sketch';

  const cycleBgStyle = () => {
    if (!currentItem) return;
    const next = BG_STYLES[(BG_STYLES.indexOf(currentItem.textBgStyle) + 1) % BG_STYLES.length];
    updateItem({ textBgStyle: next });
  };

  const cycleFontStyle = () => {
    if (!currentItem) return;
    updateItem({ fontIndex: (currentItem.fontIndex + 1) % FONT_STYLES.length });
  };

  const getTextContainerStyle = () => {
    const base = { alignSelf: 'center' as const };
    switch (currentItem?.textBgStyle ?? 'none') {
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

  const getTextStyle = () => {
    const font = FONT_STYLES[currentItem?.fontIndex ?? 0];
    return {
      color: currentItem?.textColor ?? '#FFFFFF',
      fontFamily: font.fontFamily,
      fontWeight: font.fontWeight ?? 'normal' as const,
      fontSize: 24,
      textAlign: 'center' as const,
      includeFontPadding: false,
      padding: 0,
      margin: 0,
      textShadowColor: currentItem?.textBgStyle === 'none' ? 'rgba(0,0,0,0.75)' : undefined,
      textShadowOffset: currentItem?.textBgStyle === 'none' ? { width: 0, height: 1 } : undefined,
      textShadowRadius: currentItem?.textBgStyle === 'none' ? 4 : undefined,
    };
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
          const snapshotUri = await captureRef(viewShotRef, {
            format: 'jpg',
            quality: 0.92,
          });
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
        translationX: item.translationX,
        translationY: item.translationY,
        scale: item.scale,
        rotation: item.rotation,
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
              {/* T Font Icon — Floating Text Overlay */}
              <TouchableOpacity
                style={[s.topBtn, (isEditingOverlayText || !!currentItem?.overlayText) && s.topBtnActive]}
                onPress={() => {
                  if (isEditingOverlayText) {
                    setIsEditingOverlayText(false);
                    Keyboard.dismiss();
                  } else if (currentItem?.overlayText) {
                    setIsEditingOverlayText(true);
                    setTimeout(() => overlayInputRef.current?.focus(), 80);
                  } else {
                    setEditorMode('text');
                    setIsEditingOverlayText(true);
                    setTimeout(() => overlayInputRef.current?.focus(), 80);
                  }
                }}
              >
                <Text style={s.fontToggleText}>T</Text>
              </TouchableOpacity>

              {/* Mode toggle: text / sketch */}
              <TouchableOpacity
                style={[s.topBtn, isSketch && s.topBtnActive]}
                onPress={() => {
                  setEditorMode(isSketch ? 'text' : 'sketch');
                  setIsEditingOverlayText(false);
                  setShowColorPicker(false);
                }}
              >
                <Icon name={isSketch ? 'pencil' : 'pencil-outline'} size={22} color="#fff" />
              </TouchableOpacity>
            </>
          )}

          {currentItem?.mediaType !== 'video' && !isSketch && (
            <>
              <TouchableOpacity style={s.topBtn} onPress={cycleBgStyle}>
                <Icon name="color-fill-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={s.topBtn} onPress={cycleFontStyle}>
                <Text style={s.fontToggleText}>
                  {FONT_STYLES[currentItem?.fontIndex ?? 0].label[0]}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.topBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                <View style={[s.colorIndicator, { backgroundColor: currentItem?.textColor ?? '#FFF' }]} />
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

      {/* ── Colour Swatches Strip (image-only) ── */}
      {showColorPicker && currentItem?.mediaType !== 'video' && (
        <View style={[s.colorPickerStrip, { top: safeTop + 60 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}>
            {(isSketch ? STROKE_COLORS : TEXT_COLORS).map(c => {
              const isSelected = (isSketch ? strokeColor : currentItem?.textColor) === c;
              const isLightColor = c === '#FFFFFF' || c === '#FFFF00' || c === '#00FFFF' || c === '#FFEB3B' || c === '#FFC107';
              const indicatorColor = isLightColor ? '#000000' : '#FFFFFF';

              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => {
                    if (isSketch) setStrokeColor(c);
                    else updateItem({ textColor: c });
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

      {/* ── Media + Sketch composite layer (captured by ViewShot) ── */}
      <TouchableWithoutFeedback
        onPress={() => {
          if (isEditingOverlayText) {
            setIsEditingOverlayText(false);
            Keyboard.dismiss();
          }
        }}
      >
        <ViewShot
          ref={viewShotRef}
          style={[
            s.mediaLayer,
            { left: mediaRect.x, top: mediaRect.y, width: mediaRect.w, height: mediaRect.h },
          ]}
          options={{ format: 'jpg', quality: 0.92 }}
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
            touchEnabled={isSketch}
            onPathsChange={(count) => setStrokeCount(count)}
          />

          {/* Baked text overlay — rendered inside ViewShot when not actively typing */}
          {currentItem?.mediaType !== 'video' && !!currentItem?.overlayText && !isEditingOverlayText && (
            <Animated.View
              style={[
                getTextContainerStyle(),
                animatedStyle,
                { position: 'absolute', top: '45%', alignSelf: 'center' }
              ]}
              pointerEvents="none"
            >
              <Text style={getTextStyle()}>{currentItem.overlayText}</Text>
            </Animated.View>
          )}
        </ViewShot>
      </TouchableWithoutFeedback>

      {/* ── Gesture layer for overlay text (image-only) ── */}
      {currentItem?.mediaType !== 'video' && (!!currentItem?.overlayText || isEditingOverlayText) && (
        <GestureDetector
          gesture={Gesture.Simultaneous(
            composedGesture,
            Gesture.Tap().onEnd(() => {
              runOnJS(openOverlayEditor)();
            })
          )}
        >
          <View style={s.fullScreenGestureLayer} pointerEvents={isSketch ? "none" : "box-only"}>
            {isEditingOverlayText && (
              <Animated.View style={[getTextContainerStyle(), animatedStyle, { position: 'absolute', top: '45%', alignSelf: 'center' }]}>
                <TextInput
                  ref={overlayInputRef}
                  style={[
                    getTextStyle(),
                    {
                      minWidth: 40,
                      maxWidth: width * 0.85,
                      textAlign: 'center',
                      padding: 0,
                      margin: 0,
                    }
                  ]}
                  value={currentItem?.overlayText ?? ''}
                  onChangeText={t => updateItem({ overlayText: t })}
                  onSubmitEditing={() => {
                    setIsEditingOverlayText(false);
                    Keyboard.dismiss();
                  }}
                  placeholder="Type text…"
                  placeholderTextColor={`${(currentItem?.textColor ?? '#FFFFFF')}88`}
                  multiline
                  autoFocus
                  blurOnSubmit
                  returnKeyType="done"
                />
              </Animated.View>
            )}
          </View>
        </GestureDetector>
      )}

      {/* ── Industrial Standard Animated Keyboard Avoidance Layout ── */}
      <Animated.View
        style={[s.bottomContainerFlex, animatedBottomContainerStyle]}
        pointerEvents={isEditingOverlayText ? "none" : "box-none"}
      >
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View
          style={[
            s.bottomSectionInner,
            { paddingBottom: keyboardHeight > 0 ? 8 : (safeBottom > 0 ? safeBottom : 12) }
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
    backgroundColor: 'rgba(0,0,0,0.55)',
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
  fullScreenGestureLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
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
