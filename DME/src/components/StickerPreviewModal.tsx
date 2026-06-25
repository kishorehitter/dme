import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, Dimensions, Keyboard, ScrollView, ActivityIndicator, Platform, Image
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import { SketchCanvas } from '@terrylinla/react-native-sketch-canvas';
import ViewShot from 'react-native-view-shot';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import RNFS from 'react-native-fs';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

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
const StickerPreviewModal: React.FC<Props> = ({ visible, mediaUri, mimeType, onClose, onSend, restoreNavBarColor = '#FFFFFF' }) => {
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

  const viewShotRef     = useRef<ViewShot>(null);
  const overlaysShotRef = useRef<ViewShot>(null);
  const sketchRef       = useRef<SketchCanvas>(null);
  const inputRef        = useRef<TextInput>(null);

  useEffect(() => {
    if (visible && Platform.OS === 'android') {
      try { changeNavigationBarColor('#111111', false); } catch {}
    }
    if (!visible) {
      if (Platform.OS === 'android') {
        const isLight = restoreNavBarColor.toUpperCase() !== '#000000' && restoreNavBarColor.toUpperCase() !== '#111111';
        try { changeNavigationBarColor(restoreNavBarColor, isLight); } catch {}
      }
      resetState();
    }
  }, [visible]);

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
  }, []);

  const handleClose = () => { resetState(); onClose(); };

  // ── SEND ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    Keyboard.dismiss();
    setMode('view');
    setDraftText('');
    setEditingId(null);
    setIsSending(true);
    try {
      const gif = isGif(mimeType, mediaUri);
      // It's a sticker if it has no overlays and no drawing
      const isSticker = overlays.length === 0 && !hasDrawing;

      if (isSticker) {
        onSend(mediaUri, mimeType, '', true);
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
      await processGifWithFFmpeg();
    } catch (e) {
      console.error('Send failed', e);
    } finally {
      setIsSending(false);
    }
  };

  // ── FFmpeg ────────────────────────────────────────────────────────────────
  const processGifWithFFmpeg = async () => {
    const ts = Date.now();
    const outPath = `${RNFS.CachesDirectoryPath}/edited_${ts}.gif`;
    let inputUri: string;
    let tempInputPath: string | null = null;
    if (mediaUri.startsWith('content://')) {
      tempInputPath = `${RNFS.CachesDirectoryPath}/input_${ts}.gif`;
      await RNFS.copyFile(mediaUri, tempInputPath);
      inputUri = tempInputPath;
    } else {
      inputUri = mediaUri.replace('file://', '');
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
    if (draftText.trim()) {
      if (editingId) {
        setOverlays(prev => prev.map(o =>
          o.id === editingId ? { ...o, text: draftText, color: textColor, fontSize } : o,
        ));
      } else {
        setOverlays(prev => [...prev, {
          id: Date.now().toString(),
          text: draftText, color: textColor, fontSize,
          x: 0, y: 0,
        }]);
      }
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
      setDraftText(''); setEditingId(null); setMode('view');
    } else {
      setDraftText(''); setEditingId(null); setMode('text');
    }
  };

  if (!visible) return null;

  // ─── Header middle slot content ──────────────────────────────────────────
  const headerMiddle = () => {
    if (mode === 'draw') {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ms.colorRow}
          style={{ flex: 1 }}
        >
          {TEXT_COLORS.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => setTextColor(c)}
              style={[ms.colorDot, { backgroundColor: c }, textColor === c && ms.colorDotActive]}
            />
          ))}
        </ScrollView>
      );
    }
    if (mode === 'text') {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ms.fontSizeRow}
          style={{ flex: 1 }}
        >
          {FONT_SIZES.map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => setFontSize(s)}
              style={[ms.sizeBtn, fontSize === s && ms.sizeBtnActive]}
            >
              <Text style={[ms.sizeBtnText, { fontSize: 9 + (s - 16) / 4 }]}>A</Text>
            </TouchableOpacity>
          ))}
          {/* Color row below font sizes — stacked inside middle slot */}
          {TEXT_COLORS.map(c => (
            <TouchableOpacity
              key={`col-${c}`}
              onPress={() => setTextColor(c)}
              style={[ms.colorDot, { backgroundColor: c, marginLeft: 4 }, textColor === c && ms.colorDotActive]}
            />
          ))}
        </ScrollView>
      );
    }
    // view mode — empty middle
    return <View style={{ flex: 1 }} />;
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={ms.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} />
          <View style={ms.bottomSheet}>

            {/* ══════════════════════════════════════════
                HEADER — close | [middle slot] | sketch text undo
            ══════════════════════════════════════════ */}
            <View style={ms.topBar}>
              {/* Close */}
              <TouchableOpacity onPress={handleClose} style={ms.iconBtn}>
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>

              {/* Middle slot — fills all available space */}
              {headerMiddle()}

              {/* Right cluster: sketch · text · undo */}
              <View style={ms.rightCluster}>
                <TouchableOpacity
                  style={[ms.iconBtn, mode === 'draw' && ms.activeIconBtn]}
                  onPress={toggleDraw}
                >
                  <Icon name="brush-outline" size={18} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ms.iconBtn, mode === 'text' && ms.activeIconBtn]}
                  onPress={toggleText}
                >
                  <Icon name="text" size={17} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={ms.iconBtn} onPress={handleUndo}>
                  <Icon name="arrow-undo" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
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
                <ActivityIndicator color="#8100D1" size="large" />
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

                    {/* Text overlays */}
                    {overlays.map(o => (
                      <DraggableOverlay
                        key={o.id}
                        overlay={o}
                        imgW={imgW}
                        imgH={imgH}
                        onRemove={handleRemoveOverlay}
                        onEdit={handleEditOverlay}
                        onPositionChange={handlePositionChange}
                      />
                    ))}
                  </ViewShot>
                </ViewShot>
              )}

              {overlays.length > 0 && mode === 'view' && (
                <Text style={ms.hint}>Drag • Pinch • Rotate  |  Long-press to remove</Text>
              )}
            </View>

            {/* ══════════════════════════════════════════
                BOTTOM BAR
                — text mode:  [  Type here...  ] [Done]
                — otherwise:  [        Send        ]
            ══════════════════════════════════════════ */}
            <View style={ms.bottomBar}>
              {mode === 'text' ? (
                <View style={ms.textInputRow}>
                  <TextInput
                    ref={inputRef}
                    style={ms.textInput}
                    value={draftText}
                    onChangeText={setDraftText}
                    autoFocus
                    multiline={false}
                    placeholder="Type here..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    textAlign="left"
                    underlineColorAndroid="transparent"
                    returnKeyType="done"
                    onSubmitEditing={handleDone}
                    // text color preview matches chosen color
                    selectionColor={textColor}
                  />
                  <TouchableOpacity onPress={handleDone} style={ms.doneBtn}>
                    <Text style={ms.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={ms.sendBtn} onPress={handleSend} disabled={isSending}>
                  {isSending ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={[ms.sendBtnText, { marginLeft: 10 }]}>
                        {isGif(mimeType, mediaUri) ? 'Processing GIF…' : 'Sending…'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={ms.sendBtnText}>Send</Text>
                      <Icon name="send" size={18} color="#fff" style={{ marginLeft: 8 }} />
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

          </View>
        </View>
      </GestureHandlerRootView>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const ms = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  bottomSheet:  {
    height: height * 0.62,
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    // fixed height → media area never resizes when toolbar changes
  },

  // ── Header ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 6,
    // no fixed height — grows if font-size row needs two lines (we keep it single-row via ScrollView)
  },
  rightCluster: { flexDirection: 'row', gap: 6 },

  iconBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' },
  activeIconBtn: { backgroundColor: '#8100D1' },

  colorRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 8 },
  colorDot:    { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: '#fff', transform: [{ scale: 1.15 }] },

  fontSizeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 6 },
  sizeBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  sizeBtnActive: { backgroundColor: '#8100D1' },
  sizeBtnText: { color: '#fff', fontWeight: 'bold' },

  // ── Media ──
  mediaContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0d0d0d',
    justifyContent: 'center',
    alignItems: 'center',
  },

  overlayWrap: {
    position: 'absolute',
    // top/left set dynamically to imgH/2 and imgW/2 so translate(0,0) = center
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

  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 10 },

  // ── Bottom bar ──
  bottomBar: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#0d0d0d' },

  // Send button
  sendBtn:     { flexDirection: 'row', height: 48, borderRadius: 24, backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Text-mode row: [input .....] [Done]
  textInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  textInput: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 18,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  doneBtn:     { height: 48, paddingHorizontal: 20, borderRadius: 24, backgroundColor: '#8100D1', justifyContent: 'center', alignItems: 'center' },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default StickerPreviewModal;