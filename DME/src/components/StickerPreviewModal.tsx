import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, Dimensions, Keyboard, ScrollView, ActivityIndicator, Platform, Image,
  BackHandler
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { SketchCanvas } from '@terrylinla/react-native-sketch-canvas';
import ViewShot from 'react-native-view-shot';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, runOnJS, withTiming, Easing } from 'react-native-reanimated';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import RNFS from 'react-native-fs';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

interface TextOverlay {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  x: number;
  y: number;
}

interface Props {
  visible: boolean;
  mediaUri: string;
  mimeType: string;
  onClose: () => void;
  onSend: (uri: string, mimeType: string, caption: string, isSticker?: boolean) => void;
  /** Nav bar color to restore on close. Defaults to '#FFFFFF' (light screens). */
  restoreNavBarColor?: string;
  theme?: 'light' | 'dark';
}

const TEXT_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ffcc00', '#34c759', '#007aff', '#af52de'];
const FONT_SIZES  = [16, 22, 28, 36, 48];

const isGif = (mimeType: string, uri: string) =>
  mimeType === 'image/gif' || uri.toLowerCase().endsWith('.gif');

interface Size { width: number; height: number }

function computeContainSize(image: Size, container: Size): Size {
  if (image.width === 0 || image.height === 0) return { width: 0, height: 0 };
  const ia = image.width / image.height;
  const ca = container.width / container.height;
  return ia > ca
    ? { width: container.width, height: container.width / ia }
    : { width: container.height * ia, height: container.height };
}

// ─────────────────────────────────────────────────────────────────────────────
// DraggableOverlay
// ─────────────────────────────────────────────────────────────────────────────
interface DraggableOverlayProps {
  overlay: TextOverlay;
  imgW: number;
  imgH: number;
  onRemove: (id: string) => void;
  onEdit: (overlay: TextOverlay) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
}

const DraggableOverlay: React.FC<DraggableOverlayProps> = ({
  overlay, imgW, imgH, onRemove, onEdit, onPositionChange,
}) => {
  const { theme, isDark } = useTheme();
  const ms = dynamicStyles(theme, isDark);
  const translateX    = useSharedValue(overlay.x);
  const translateY    = useSharedValue(overlay.y);
  const savedX        = useSharedValue(overlay.x);
  const savedY        = useSharedValue(overlay.y);
  const scale         = useSharedValue(1);
  const savedScale    = useSharedValue(1);
  const rotation      = useSharedValue(0);
  const savedRotation = useSharedValue(0);

  const notifyPosition = useCallback(
    (x: number, y: number) => onPositionChange(overlay.id, x, y),
    [overlay.id, onPositionChange],
  );

  const pan = Gesture.Pan()
    .onUpdate(e => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
      runOnJS(notifyPosition)(savedX.value, savedY.value);
    });

  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = savedScale.value * e.scale; })
    .onEnd(()   => { savedScale.value = scale.value; });

  const rot = Gesture.Rotation()
    .onUpdate(e => { rotation.value = savedRotation.value + e.rotation; })
    .onEnd(()   => { savedRotation.value = rotation.value; });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotation.value}rad` },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, rot)}>
      <Reanimated.View
        style={[
          ms.overlayWrap,
          { top: imgH / 2, left: imgW / 2 },
          animStyle,
        ]}
      >
        <TouchableOpacity
          onLongPress={() => onRemove(overlay.id)}
          onPress={() => onEdit(overlay)}
          activeOpacity={1}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Text style={[ms.overlayText, { color: overlay.color, fontSize: overlay.fontSize }]}>
            {overlay.text}
          </Text>
        </TouchableOpacity>
      </Reanimated.View>
    </GestureDetector>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const StickerPreviewModal: React.FC<Props> = ({ visible, mediaUri, mimeType, onClose, onSend, restoreNavBarColor = '#FFFFFF', theme: propTheme = 'light' }) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const ms = dynamicStyles(theme, isDark);
  const iconColor = theme.icon;

  // 'view' | 'draw' | 'text'
  const [mode,       setMode]       = useState<'view' | 'text' | 'draw'>('view');
  const [textColor,  setTextColor]  = useState('#ffffff');
  const [fontSize,   setFontSize]   = useState(28);
  const [overlays,   setOverlays]   = useState<TextOverlay[]>([]);
  const [draftText,  setDraftText]  = useState('');
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [isSending,  setIsSending]  = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);

  // container size (measured after layout)
  const [containerSize,    setContainerSize]    = useState<Size>({ width: 1, height: 1 });
  // natural image size — starts null until resolved
  const [naturalSize,      setNaturalSize]      = useState<Size | null>(null);
  const [sizeReady,        setSizeReady]        = useState(false);

  const keyboardHeightValue = useSharedValue(0);

  const viewShotRef     = useRef<ViewShot>(null);
  const overlaysShotRef = useRef<ViewShot>(null);
  const sketchRef       = useRef<SketchCanvas>(null);
  const inputRef        = useRef<TextInput>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      const h = e?.endCoordinates?.height || 0;
      const duration = Platform.OS === 'ios' ? (e?.duration || 250) : 200;
      keyboardHeightValue.value = withTiming(h, {
        duration,
        easing: Easing.bezier(0.2, 0, 0.2, 1),
      });
    };
    const onHide = (e: any) => {
      const duration = Platform.OS === 'ios' ? (e?.duration || 250) : 200;
      keyboardHeightValue.value = withTiming(0, {
        duration,
        easing: Easing.bezier(0.2, 0, 0.2, 1),
      });
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);

    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardHeightValue.value }],
  }));

  useEffect(() => {
    if (visible && Platform.OS === 'android') {
      try {
        const barColor = isDark ? '#111111' : '#ffffff';
        const isLight = !isDark;
        changeNavigationBarColor(barColor, isLight);
      } catch {}
    }
    if (!visible) {
      if (Platform.OS === 'android') {
        const col = restoreNavBarColor || '#ffffff';
        const isLight = col.toUpperCase() !== '#000000' && col.toUpperCase() !== '#111111' && col.toUpperCase() !== '#020912' && col.toUpperCase() !== '#050f1e';
        try { changeNavigationBarColor(col, isLight); } catch {}
      }
      resetState();
    }
  }, [visible, isDark, restoreNavBarColor]);

  // Focus input when entering text mode
  useEffect(() => {
    if (mode === 'text') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [mode]);

  // Android Back button handling
  useEffect(() => {
    if (!visible) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'text') {
        handleDone();
        return true;
      }
      if (mode === 'draw') {
        setMode('view');
        return true;
      }
      handleClose();
      return true;
    });
    return () => backSub.remove();
  }, [visible, mode, draftText, editingId, textColor, fontSize]);

  // Resolve natural image dimensions as soon as mediaUri is known
  useEffect(() => {
    if (!visible || !mediaUri) return;
    setSizeReady(false);
    setNaturalSize(null);
    Image.getSize(
      mediaUri,
      (w, h) => { setNaturalSize({ width: w, height: h }); setSizeReady(true); },
      ()      => { setNaturalSize(null);                    setSizeReady(true); }, // fallback — show anyway
    );
  }, [visible, mediaUri]);

  const renderedSize: Size =
    naturalSize && naturalSize.width > 0 && containerSize.width > 1
      ? computeContainSize(naturalSize, containerSize)
      : { width: containerSize.width, height: containerSize.height };

  // Show media only once we have container measurements AND natural size resolved
  const canRender = sizeReady && containerSize.width > 1 && renderedSize.width > 0;

  const imgW = canRender ? renderedSize.width  : 0;
  const imgH = canRender ? renderedSize.height : 0;

  const resetState = useCallback(() => {
    setMode('view');
    setOverlays([]);
    setDraftText('');
    setFontSize(28);
    setEditingId(null);
    setHasDrawing(false);
    setNaturalSize(null);
    setSizeReady(false);
    keyboardHeightValue.value = 0;
  }, []);

  const handleClose = () => {
    Keyboard.dismiss();
    resetState();
    onClose();
  };

  const handleBackdropPress = () => {
    if (mode === 'text') {
      handleDone();
    } else if (mode === 'draw') {
      setMode('view');
    } else {
      handleClose();
    }
  };

  // ── SEND ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    Keyboard.dismiss();
    let currentOverlays = overlays;
    const trimmed = draftText.trim();
    if (trimmed) {
      if (editingId) {
        currentOverlays = overlays.map(o =>
          o.id === editingId ? { ...o, text: trimmed, color: textColor, fontSize } : o,
        );
      } else {
        currentOverlays = [
          ...overlays,
          {
            id: Date.now().toString(),
            text: trimmed,
            color: textColor,
            fontSize,
            x: 0,
            y: 0,
          },
        ];
      }
      setOverlays(currentOverlays);
    }
    setMode('view');
    setDraftText('');
    setEditingId(null);
    setIsSending(true);
    try {
      let resolvedUri = mediaUri;
      if (resolvedUri.startsWith('content://')) {
        try {
          const ts = Date.now();
          const ext = isGif(mimeType, mediaUri) ? 'gif' : 'png';
          const cachedPath = `${RNFS.CachesDirectoryPath}/sticker_${ts}.${ext}`;
          await RNFS.copyFile(mediaUri, cachedPath);
          resolvedUri = `file://${cachedPath}`;
        } catch (copyErr) {
          console.warn('[StickerPreviewModal] Fallback copy failed:', copyErr);
        }
      }

      const gif = isGif(mimeType, resolvedUri);
      // It's a sticker if it has no overlays and no drawing
      const isSticker = currentOverlays.length === 0 && !hasDrawing;

      if (isSticker) {
        onSend(resolvedUri, mimeType, '', true);
        resetState();
        return;
      }
      if (!gif) {
        await new Promise(r => setTimeout(r, 200));
        const uri = await viewShotRef.current?.capture?.();
        if (uri) onSend(uri, 'image/png', '', false);
        resetState();
        return;
      }
      await processGifWithFFmpeg(resolvedUri);
    } catch (e) {
      console.error('Send failed', e);
    } finally {
      setIsSending(false);
    }
  };

  // ── FFmpeg ────────────────────────────────────────────────────────────────
  const processGifWithFFmpeg = async (sourceUri: string = mediaUri) => {
    const ts = Date.now();
    const outPath = `${RNFS.CachesDirectoryPath}/edited_${ts}.gif`;
    let inputUri: string;
    let tempInputPath: string | null = null;
    if (sourceUri.startsWith('content://')) {
      try {
        tempInputPath = `${RNFS.CachesDirectoryPath}/input_${ts}.gif`;
        await RNFS.copyFile(sourceUri, tempInputPath);
        inputUri = tempInputPath;
      } catch (err) {
        inputUri = sourceUri;
      }
    } else {
      inputUri = sourceUri.replace('file://', '');
    }
    let overlayPngPath: string | null = null;
    if (overlays.length > 0 || hasDrawing) {
      try {
        const raw = await overlaysShotRef.current?.capture?.();
        if (raw) {
          overlayPngPath = `${RNFS.CachesDirectoryPath}/overlay_${ts}.png`;
          const src = raw.startsWith('file://') ? raw.slice(7) : raw;
          await RNFS.copyFile(src, overlayPngPath);
        }
      } catch (e) { console.warn('Overlay capture failed:', e); }
    }
    const filterComplex = overlayPngPath
      ? `[0:v]scale=w=200:h=500:force_original_aspect_ratio=decrease[g];[1:v][g]scale2ref=w=iw:h=ih[ov][m];[m][ov]overlay=0:0[c];[c]split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=bayer[out]`
      : `[0:v]scale=w=200:h=500:force_original_aspect_ratio=decrease,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=bayer[out]`;
    const cmd = `-i "${inputUri}"${overlayPngPath ? ` -i "${overlayPngPath}"` : ''} -filter_complex "${filterComplex}" -map "[out]" -y "${outPath}"`;
    const session = await FFmpegKit.execute(cmd);
    const code    = await session.getReturnCode();
    if (ReturnCode.isSuccess(code)) {
      onSend(`file://${outPath}`, 'image/gif', '');
    } else {
      const logs = await session.getAllLogsAsString();
      console.error('[FFmpeg] Failed:', logs);
      onSend(mediaUri, mimeType, '');
    }
    resetState();
    if (overlayPngPath) { try { await RNFS.unlink(overlayPngPath); } catch {} }
    if (tempInputPath)  { try { await RNFS.unlink(tempInputPath);  } catch {} }
  };

  const handleUndo = () => {
    if (mode === 'draw') sketchRef.current?.undo();
    else if (overlays.length > 0) setOverlays(prev => prev.slice(0, -1));
  };

  const handleDone = () => {
    Keyboard.dismiss();
    const trimmed = draftText.trim();
    if (trimmed) {
      if (editingId) {
        setOverlays(prev => prev.map(o =>
          o.id === editingId ? { ...o, text: trimmed, color: textColor, fontSize } : o,
        ));
      } else {
        setOverlays(prev => [...prev, {
          id: Date.now().toString(),
          text: trimmed,
          color: textColor,
          fontSize,
          x: 0,
          y: 0,
        }]);
      }
    } else if (editingId) {
      setOverlays(prev => prev.filter(o => o.id !== editingId));
    }
    setDraftText('');
    setEditingId(null);
    setMode('view');
  };

  const handleRemoveOverlay  = useCallback((id: string) => setOverlays(prev => prev.filter(o => o.id !== id)), []);
  const handlePositionChange = useCallback((id: string, x: number, y: number) =>
    setOverlays(prev => prev.map(o => o.id === id ? { ...o, x, y } : o)), []);
  const handleEditOverlay    = useCallback((ov: TextOverlay) => {
    setDraftText(ov.text);
    setTextColor(ov.color);
    setFontSize(ov.fontSize);
    setEditingId(ov.id);
    setMode('text');
  }, []);

  const toggleDraw = () => {
    setMode(prev => prev === 'draw' ? 'view' : 'draw');
    setDraftText(''); setEditingId(null);
  };
  const toggleText = () => {
    if (mode === 'text') {
      handleDone();
    } else {
      setDraftText(''); setEditingId(null); setMode('text');
    }
  };

  if (!visible) return null;

  // ─── Header middle slot content ──────────────────────────────────────────
  const headerMiddle = () => {
    if (mode === 'draw') {
      return (
        <View style={ms.pickerContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ms.colorRow}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="always"
          >
            {TEXT_COLORS.map(c => {
              const isSelected = textColor === c;
              const isLightColor = c === '#ffffff' || c === '#ffcc00' || c === '#ffff00' || c === '#00ffff';
              const indicatorColor = isLightColor ? '#000000' : '#FFFFFF';

              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setTextColor(c)}
                  style={[
                    ms.colorDot,
                    {
                      backgroundColor: c,
                      borderColor: isSelected
                        ? (isLightColor ? '#000000' : '#FFFFFF')
                        : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'),
                      borderWidth: isSelected ? 2.5 : 1,
                    },
                    isSelected && ms.colorDotActive,
                  ]}
                  activeOpacity={0.8}
                >
                  {isSelected && (
                    <Icon name="checkmark" size={15} color={indicatorColor} style={{ fontWeight: '900' }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      );
    }
    if (mode === 'text') {
      return (
        <View style={ms.pickerContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ms.textToolsRow}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="always"
          >
            {FONT_SIZES.map(s => (
              <TouchableOpacity
                key={`size-${s}`}
                onPress={() => {
                  setFontSize(s);
                  inputRef.current?.focus();
                }}
                style={[ms.sizeBtn, fontSize === s && ms.sizeBtnActive]}
                activeOpacity={0.8}
              >
                <Text style={[ms.sizeBtnText, { fontSize: 10 + (s - 16) / 5 }, fontSize === s && { color: '#fff' }]}>
                  A
                </Text>
              </TouchableOpacity>
            ))}
            <View style={ms.toolDivider} />
            {TEXT_COLORS.map(c => {
              const isSelected = textColor === c;
              const isLightColor = c === '#ffffff' || c === '#ffcc00' || c === '#ffff00' || c === '#00ffff';
              const indicatorColor = isLightColor ? '#000000' : '#FFFFFF';

              return (
                <TouchableOpacity
                  key={`col-${c}`}
                  onPress={() => {
                    setTextColor(c);
                    inputRef.current?.focus();
                  }}
                  style={[
                    ms.colorDot,
                    {
                      backgroundColor: c,
                      borderColor: isSelected
                        ? (isLightColor ? '#000000' : '#FFFFFF')
                        : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'),
                      borderWidth: isSelected ? 2.5 : 1,
                    },
                    isSelected && ms.colorDotActive,
                  ]}
                  activeOpacity={0.8}
                >
                  {isSelected && (
                    <Icon name="checkmark" size={15} color={indicatorColor} style={{ fontWeight: '900' }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      );
    }
    // view mode — empty spacer
    return <View style={{ flex: 1 }} />;
  };

  const renderRightCluster = () => {
    if (mode === 'text') {
      return (
        <TouchableOpacity onPress={handleDone} style={ms.headerDoneBtn}>
          <Text style={ms.headerDoneBtnText}>Done</Text>
          <Icon name="checkmark" size={15} color="#fff" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      );
    }
    if (mode === 'draw') {
      return (
        <View style={ms.rightCluster}>
          <TouchableOpacity
            style={[ms.iconBtn, !hasDrawing && { opacity: 0.4 }]}
            onPress={handleUndo}
            disabled={!hasDrawing}
          >
            <Icon name="arrow-undo" size={18} color={iconColor} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('view')} style={ms.headerDoneBtn}>
            <Text style={ms.headerDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // mode === 'view'
    return (
      <View style={ms.rightCluster}>
        <TouchableOpacity
          style={[ms.iconBtn, mode === 'draw' && ms.activeIconBtn]}
          onPress={toggleDraw}
        >
          <Icon name="brush-outline" size={18} color={mode === 'draw' ? '#fff' : iconColor} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[ms.iconBtn, mode === 'text' && ms.activeIconBtn]}
          onPress={toggleText}
        >
          <Icon name="text" size={17} color={mode === 'text' ? '#fff' : iconColor} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[ms.iconBtn, overlays.length === 0 && !hasDrawing && { opacity: 0.4 }]}
          onPress={handleUndo}
          disabled={overlays.length === 0 && !hasDrawing}
        >
          <Icon name="arrow-undo" size={18} color={iconColor} />
        </TouchableOpacity>
        <TouchableOpacity
          style={ms.headerSendBtn}
          onPress={handleSend}
          disabled={isSending}
          activeOpacity={0.85}
        >
          {isSending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={ms.headerSendBtnText}>Send</Text>
              <Icon name="send" size={13} color="#fff" style={{ marginLeft: 5 }} />
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const modalHeight = Math.min(height * 0.48, 420);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={ms.backdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleBackdropPress}
          />
          <Reanimated.View
            style={[
              ms.bottomSheet,
              {
                height: modalHeight,
                paddingBottom: Math.max(insets.bottom, 10),
              },
              animatedSheetStyle,
            ]}
          >
            {/* ══════════════════════════════════════════
                HEADER — close | [middle slot] | right cluster with Send
            ══════════════════════════════════════════ */}
            <View style={ms.topBar}>
              {/* Close */}
              <TouchableOpacity onPress={handleClose} style={ms.iconBtn}>
                <Icon name="close" size={22} color={iconColor} />
              </TouchableOpacity>

              {/* Middle slot */}
              {headerMiddle()}

              {/* Right cluster */}
              {renderRightCluster()}
            </View>

            {/* ══════════════════════════════════════════
                MEDIA AREA — fixed, never resizes
            ══════════════════════════════════════════ */}
            <View
              style={ms.mediaContainer}
              onLayout={e => {
                const { width: w, height: h } = e.nativeEvent.layout;
                setContainerSize({ width: w, height: h });
              }}
            >
              {!canRender ? (
                // Hold space with spinner until dimensions resolved — prevents blur/wrong-AR flash
                <ActivityIndicator color="#4597f5f6" size="large" />
              ) : (
                <ViewShot
                  ref={viewShotRef}
                  style={{ width: imgW, height: imgH }}
                  options={{ format: 'png', quality: 0.95, result: 'tmpfile' }}
                >
                  {/* Background media */}
                  <FastImage
                    source={{ uri: mediaUri, priority: FastImage.priority.high }}
                    style={{ width: imgW, height: imgH }}
                    resizeMode={FastImage.resizeMode.contain}
                  />

                  {/* Overlay capture layer */}
                  <ViewShot
                    ref={overlaysShotRef}
                    style={StyleSheet.absoluteFill}
                    options={{ format: 'png', quality: 1.0 }}
                  >
                    {/* Drawing canvas — explicit dims to match capture coords */}
                    <SketchCanvas
                      style={{ width: imgW, height: imgH }}
                      strokeColor={textColor}
                      strokeWidth={5}
                      ref={sketchRef}
                      touchEnabled={mode === 'draw'}
                      onStrokeEnd={() => setHasDrawing(true)}
                    />

                    {/* Text overlays (hide the one currently being edited) */}
                    {overlays.map(o => {
                      if (mode === 'text' && editingId === o.id) return null;
                      return (
                        <DraggableOverlay
                          key={o.id}
                          overlay={o}
                          imgW={imgW}
                          imgH={imgH}
                          onRemove={handleRemoveOverlay}
                          onEdit={handleEditOverlay}
                          onPositionChange={handlePositionChange}
                        />
                      );
                    })}
                  </ViewShot>
                </ViewShot>
              )}

              {/* Live TextInput rendered directly over the sticker or GIF */}
              {mode === 'text' && (
                <View style={[StyleSheet.absoluteFill, ms.textEditorOverlay]} pointerEvents="box-none">
                  <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={handleDone}
                  />
                  <View
                    style={[
                      ms.activeInputWrapper,
                      {
                        width: imgW > 0 ? imgW : '90%',
                        height: imgH > 0 ? imgH : '90%',
                      },
                    ]}
                    pointerEvents="box-none"
                  >
                    <TextInput
                      ref={inputRef}
                      style={[
                        ms.overlayText,
                        ms.activeTextInput,
                        {
                          color: textColor,
                          fontSize: fontSize,
                        },
                      ]}
                      value={draftText}
                      onChangeText={setDraftText}
                      autoFocus
                      multiline
                      placeholder="Type text…"
                      placeholderTextColor="rgba(255,255,255,0.6)"
                      textAlign="center"
                      underlineColorAndroid="transparent"
                      returnKeyType="done"
                      blurOnSubmit={true}
                      onSubmitEditing={handleDone}
                      selectionColor={textColor}
                    />
                  </View>
                </View>
              )}

              {overlays.length > 0 && mode === 'view' && (
                <Text style={ms.hint}>Drag • Pinch • Rotate  |  Long-press to remove</Text>
              )}
            </View>

          </Reanimated.View>
        </View>
      </GestureHandlerRootView>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const dynamicStyles = (theme: import('../utils/theme').ThemeColors, isDark: boolean = false) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },

  // ── Header ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 6,
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIconBtn: {
    backgroundColor: isDark ? '#1E293B' : '#0F172A',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(59, 130, 246, 0.35)' : 'transparent',
  },

  headerSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F62FE',
    marginLeft: 2,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  headerSendBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },

  headerDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F62FE',
    marginLeft: 2,
  },
  headerDoneBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },

  pickerContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    marginHorizontal: 4,
    height: 38,
  },

  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    gap: 8,
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  colorDotActive: {
    transform: [{ scale: 1.12 }],
    elevation: 5,
    shadowOpacity: 0.4,
  },

  textToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    gap: 6,
  },
  fontSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    gap: 6,
  },
  sizeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
  },
  sizeBtnActive: {
    backgroundColor: '#0F62FE',
    borderColor: '#0F62FE',
  },
  sizeBtnText: {
    color: theme.textPrimary,
    fontWeight: 'bold',
  },
  toolDivider: {
    width: 1,
    height: 18,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)',
    marginHorizontal: 4,
  },

  // ── Media ──
  mediaContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
  },

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

  textEditorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  activeInputWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeTextInput: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 60,
    maxWidth: '92%',
    alignSelf: 'center',
  },

  hint: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: theme.textMuted,
    fontSize: 10,
  },
});

export default StickerPreviewModal;