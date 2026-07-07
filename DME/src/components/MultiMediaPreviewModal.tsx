import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  ScrollView
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/Ionicons';
import Video from 'react-native-video';
import ViewShot from 'react-native-view-shot';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated';
import { SketchCanvas } from '@terrylinla/react-native-sketch-canvas';

const { width, height } = Dimensions.get('window');

const TEXT_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ffcc00', '#34c759', '#007aff', '#af52de'];
const FONT_SIZES = [16, 22, 28, 36, 48];

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

interface TextOverlay {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  x: number;
  y: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// DraggableOverlay Component
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
  overlay,
  imgW,
  imgH,
  onRemove,
  onEdit,
  onPositionChange,
}) => {
  const translateX = useSharedValue(overlay.x);
  const translateY = useSharedValue(overlay.y);
  const savedX = useSharedValue(overlay.x);
  const savedY = useSharedValue(overlay.y);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const savedRotation = useSharedValue(0);

  const notifyPosition = useCallback(
    (x: number, y: number) => onPositionChange(overlay.id, x, y),
    [overlay.id, onPositionChange]
  );

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
      runOnJS(notifyPosition)(savedX.value, savedY.value);
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const rot = Gesture.Rotation()
    .onUpdate((e) => {
      rotation.value = savedRotation.value + e.rotation;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
    });

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
      <Reanimated.View style={[styles.overlayWrap, { top: imgH / 2, left: imgW / 2 }, animStyle]}>
        <TouchableOpacity
          onLongPress={() => onRemove(overlay.id)}
          onPress={() => onEdit(overlay)}
          activeOpacity={1}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Text style={[styles.overlayText, { color: overlay.color, fontSize: overlay.fontSize }]}>
            {overlay.text}
          </Text>
        </TouchableOpacity>
      </Reanimated.View>
    </GestureDetector>
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
  const [items, setItems] = useState<SelectedMedia[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState(''); // Single caption for the whole bulk file

  // Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<'view' | 'draw' | 'text'>('view');
  const [textColor, setTextColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(28);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [draftText, setDraftText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
  };

  const renderHeaderMiddle = () => {
    if (editMode === 'draw') {
      return (
        <View style={styles.headerMiddleContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            contentContainerStyle={styles.colorRow}
            style={{ flex: 1 }}
          >
            {TEXT_COLORS.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setTextColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  textColor === c && styles.colorDotActive,
                ]}
              />
            ))}
          </ScrollView>
        </View>
      );
    }
    if (editMode === 'text') {
      return (
        <View style={styles.headerMiddleContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            contentContainerStyle={styles.fontSizeRow}
            style={{ flex: 1 }}
          >
            {FONT_SIZES.map(s => (
              <TouchableOpacity
                key={s}
                onPress={() => setFontSize(s)}
                style={[styles.sizeBtn, fontSize === s && styles.sizeBtnActive]}
              >
                <Text
                  style={[
                    styles.sizeBtnText,
                    { fontSize: 9 + (s - 16) / 4 },
                    fontSize === s && { color: '#FFF' },
                  ]}
                >
                  A
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.inlineDivider} />
            {TEXT_COLORS.map(c => (
              <TouchableOpacity
                key={`col-${c}`}
                onPress={() => setTextColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  textColor === c && styles.colorDotActive,
                ]}
              />
            ))}
          </ScrollView>
        </View>
      );
    }
    return <View style={{ flex: 1 }} />;
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
    onClose();
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
  const startEdit = (mode: 'draw' | 'text') => {
    if (!canEdit) return;
    setIsEditing(true);
    setEditMode(mode);
    if (mode === 'text') {
      setDraftText('');
      setEditingId(null);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  };

  const handleUndo = () => {
    if (editMode === 'draw' && sketchRef.current) {
      sketchRef.current.undo();
    }
  };

  const handleRemoveOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  };

  const handleEditOverlay = (overlay: TextOverlay) => {
    setEditingId(overlay.id);
    setDraftText(overlay.text);
    setTextColor(overlay.color);
    setFontSize(overlay.fontSize);
    setEditMode('text');
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handlePositionChange = (id: string, x: number, y: number) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, x, y } : o)));
  };

  const handleTextDone = () => {
    Keyboard.dismiss();
    setEditMode('view');
    if (!draftText.trim()) {
      if (editingId) handleRemoveOverlay(editingId);
      setDraftText('');
      setEditingId(null);
      return;
    }

    if (editingId) {
      setOverlays((prev) =>
        prev.map((o) =>
          o.id === editingId ? { ...o, text: draftText, color: textColor, fontSize } : o
        )
      );
    } else {
      const newOverlay: TextOverlay = {
        id: Date.now().toString(),
        text: draftText,
        color: textColor,
        fontSize,
        x: 0,
        y: 0,
      };
      setOverlays((prev) => [...prev, newOverlay]);
    }
    setDraftText('');
    setEditingId(null);
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

  const renderMediaItem = ({ item }: { item: SelectedMedia }) => {
    const isVideo = item.type?.startsWith('video') || item.uri.endsWith('.mp4') || item.uri.endsWith('.mov');
    if (isVideo) {
      return (
        <View style={styles.mediaWrapper}>
          <Video
            source={{ uri: item.uri }}
            style={styles.fullMedia}
            resizeMode="contain"
            paused={true}
            controls={true}
          />
        </View>
      );
    }
    return (
      <View style={styles.mediaWrapper}>
        <FastImage
          source={{ uri: item.uri }}
          style={styles.fullMedia}
          resizeMode={FastImage.resizeMode.contain}
        />
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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={true}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={true} />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={[styles.container, Platform.OS === 'android' && { paddingTop: StatusBar.currentHeight }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={Platform.OS === 'ios'}
            style={{ flex: 1 }}
          >
            {/* ── HEADER ──────────────────────────────────────────────────── */}
            <View style={styles.header}>
              {isEditing ? (
                <TouchableOpacity onPress={cancelEdits} style={styles.headerBtn}>
                  <Icon name="close" size={24} color="#1A1A1A" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
                  <Icon name="close" size={24} color="#1A1A1A" />
                </TouchableOpacity>
              )}

              {/* Page indicator or Title / Settings selector in header */}
              {isEditing ? (
                renderHeaderMiddle()
              ) : (
                <Text style={styles.headerCount}>
                  {items.length > 1 ? `${activeIndex + 1} / ${items.length}` : 'Preview'}
                </Text>
              )}

              {/* Edit Options Area */}
              <View style={styles.rightCluster}>
                {canEdit && (
                  <>
                    <TouchableOpacity
                      style={[styles.toolBtn, isEditing && editMode === 'draw' && styles.toolBtnActive]}
                      onPress={() => {
                        if (isEditing && editMode === 'draw') {
                          saveEdits();
                        } else {
                          startEdit('draw');
                        }
                      }}
                    >
                      <Icon name="brush-outline" size={18} color={isEditing && editMode === 'draw' ? '#FFF' : '#1A1A1A'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toolBtn, isEditing && editMode === 'text' && styles.toolBtnActive]}
                      onPress={() => {
                        if (isEditing && editMode === 'text') {
                          saveEdits();
                        } else {
                          startEdit('text');
                        }
                      }}
                    >
                      <Icon name="text" size={17} color={isEditing && editMode === 'text' ? '#FFF' : '#1A1A1A'} />
                    </TouchableOpacity>
                  </>
                )}
                {isEditing && (
                  <TouchableOpacity style={styles.toolBtn} onPress={handleUndo}>
                    <Icon name="arrow-undo" size={18} color="#1A1A1A" />
                  </TouchableOpacity>
                )}
                {isEditing && (
                  <TouchableOpacity style={[styles.toolBtn, { backgroundColor: '#E1F5FE' }]} onPress={saveEdits}>
                    <Icon name="checkmark" size={18} color="#0288D1" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* ── MAIN MEDIA AREA ─────────────────────────────────────────── */}
            <View style={styles.canvasContainer}>
              {isEditing ? (
                // Interactive Drawing Canvas for currently swiped image
                <View
                  style={StyleSheet.absoluteFill}
                  onLayout={(e) => {
                    const { width: w, height: h } = e.nativeEvent.layout;
                    setContainerSize({ width: w, height: h });
                  }}
                >
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    {!canRenderCanvas ? (
                      <ActivityIndicator color={themeColor} size="large" />
                    ) : (
                      <ViewShot
                        ref={viewShotRef}
                        style={{ width: imgW, height: imgH }}
                        options={{ format: 'png', quality: 0.95, result: 'tmpfile' }}
                      >
                        {/* Base Image */}
                        <FastImage
                          source={{ uri: currentItem.uri }}
                          style={{ width: imgW, height: imgH }}
                          resizeMode={FastImage.resizeMode.contain}
                        />

                        {/* Overlay capture layer — nested ViewShot exactly like StickerPreviewModal */}
                        <ViewShot
                          ref={overlaysShotRef}
                          style={StyleSheet.absoluteFill}
                          options={{ format: 'png', quality: 1.0 }}
                        >
                          {/* Sketch Canvas */}
                          <SketchCanvas
                            style={{ width: imgW, height: imgH }}
                            strokeColor={textColor}
                            strokeWidth={5}
                            ref={sketchRef}
                            touchEnabled={editMode === 'draw'}
                            onStrokeEnd={() => setHasDrawing(true)}
                          />

                          {/* Text Overlays */}
                          {overlays.map((o) => (
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
                    {overlays.length > 0 && editMode === 'view' && (
                      <Text style={styles.canvasHint}>Drag • Pinch • Rotate | Long-press to remove</Text>
                    )}
                  </View>
                </View>
              ) : (
                // Horizontal Swipable FlatList
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
                />
              )}
            </View>

            {/* ── FOOTER AREA ─────────────────────────────────────────────── */}
            <View style={styles.footer}>
              {/* Thumbnail strip (only when multiple items and NOT currently editing) */}
              {items.length > 1 && !isEditing && (
                <View style={styles.thumbnailContainer}>
                  <FlatList
                    data={items}
                    renderItem={renderThumbnail}
                    keyExtractor={(_, i) => `thumb_${i}`}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.thumbnailList}
                  />
                </View>
              )}

              {/* Combined Input Row (keeps layout size 100% identical to avoid resizing/flicker) */}
              <View style={styles.inputRow}>
                <TextInput
                  ref={isEditing && editMode === 'text' ? inputRef : undefined}
                  style={styles.captionInput}
                  placeholder={isEditing && editMode === 'text' ? "Type text overlay…" : "Add a caption…"}
                  placeholderTextColor="#AAA"
                  value={isEditing && editMode === 'text' ? draftText : caption}
                  onChangeText={isEditing && editMode === 'text' ? setDraftText : setCaption}
                  multiline={isEditing && editMode === 'text' ? false : true}
                  onSubmitEditing={isEditing && editMode === 'text' ? handleTextDone : undefined}
                  returnKeyType={isEditing && editMode === 'text' ? "done" : "default"}
                  autoFocus={isEditing && editMode === 'text'}
                  disabled={isSaving}
                />
                <TouchableOpacity
                  onPress={isEditing && editMode === 'text' ? handleTextDone : handleSend}
                  style={[styles.sendButton, { backgroundColor: themeColor }]}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Icon 
                      name={isEditing && editMode === 'text' ? "checkmark" : "send"} 
                      size={20} 
                      color="#FFF" 
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  headerBtn: {
    padding: 8,
    width: 44,
    alignItems: 'center',
  },
  headerCount: {
    color: '#1A1A1A',
    fontSize: 16,
    fontWeight: '600',
  },
  rightCluster: {
    flexDirection: 'row',
    gap: 8,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolBtnActive: {
    backgroundColor: '#4597f5f6',
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
    borderColor: '#E0E0E0',
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasHint: {
    position: 'absolute',
    bottom: 8,
    textAlign: 'center',
    color: '#888',
    fontSize: 11,
  },
  mediaWrapper: {
    width,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
  },
  fullMedia: {
    width: '100%',
    height: '100%',
  },
  footer: {
    backgroundColor: '#FFFFFF',
    paddingBottom: Platform.OS === 'ios' ? 16 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E0',
  },
  thumbnailContainer: {
    height: 62,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
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
    backgroundColor: '#EEE',
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
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 10,
  },
  captionInput: {
    flex: 1,
    backgroundColor: '#F4F4F4',
    color: '#1A1A1A',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 90,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DEDEDE',
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
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
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 16,
    color: '#000',
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
    borderColor: '#E0E0E0',
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
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  sizeBtnActive: {
    backgroundColor: '#4597f5f6',
  },
  sizeBtnText: {
    color: '#000',
    fontWeight: 'bold',
  },
  headerMiddleContainer: {
    flex: 1,
    height: 38,
    marginHorizontal: 8,
    borderWidth: 1.5,
    borderColor: '#E8DEF8',
    borderRadius: 20,
    backgroundColor: '#F8F0FF',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  inlineDivider: {
    width: 1.5,
    height: 18,
    backgroundColor: '#D1C4E9',
    marginHorizontal: 8,
    alignSelf: 'center',
  },
});
