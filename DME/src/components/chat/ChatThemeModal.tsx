/**
 * ChatThemeModal.tsx
 * Industrial standard Instagram/Telegram style theme and wallpaper picker.
 * Compact half-screen height with instant auto-apply and tick badge indicator.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  ChatTheme,
  CHAT_THEME_PRESETS,
  ChatThemeService,
} from '../../services/theme/ChatThemeService';
import { useTheme } from '../../context/ThemeContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 44) / 2;
const HALF_SCREEN_HEIGHT = Math.min(Math.round(SCREEN_HEIGHT * 0.52), 430);

interface ChatThemeModalProps {
  visible: boolean;
  onClose: () => void;
  currentTheme: ChatTheme;
  conversationId?: number | string;
  onSelectTheme: (theme: ChatTheme) => void;
}

export const ChatThemeModal: React.FC<ChatThemeModalProps> = ({
  visible,
  onClose,
  currentTheme,
  conversationId,
  onSelectTheme,
}) => {
  const { isDark } = useTheme();
  const [selectedThemeId, setSelectedThemeId] = useState<string>(currentTheme.id);

  const handleSelectPreset = async (preset: ChatTheme) => {
    setSelectedThemeId(preset.id);
    onSelectTheme(preset);
    await ChatThemeService.setChatTheme(preset, conversationId);
    // Instant auto-close on click
    onClose();
  };

  const handlePickFromGallery = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.85,
        selectionLimit: 1,
      });

      if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
        const uri = result.assets[0].uri;
        const customTheme = ChatThemeService.createCustomWallpaperTheme(uri, 0.35);
        setSelectedThemeId(customTheme.id);
        onSelectTheme(customTheme);
        await ChatThemeService.setChatTheme(customTheme, conversationId);
        onClose();
      }
    } catch (err) {
      console.warn('[ChatThemeModal] Error picking wallpaper image:', err);
      Alert.alert('Error', 'Could not select wallpaper image.');
    }
  };

  const handleResetToDefault = async () => {
    const defaultPreset = CHAT_THEME_PRESETS[0];
    setSelectedThemeId(defaultPreset.id);
    onSelectTheme(defaultPreset);
    await ChatThemeService.resetChatTheme(conversationId);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          style={[
            s.modalContainer,
            { backgroundColor: isDark ? '#161922' : '#FFFFFF' },
          ]}
        >
          {/* Header Bar */}
          <View style={s.modalHeader}>
            <View style={s.dragHandle} />
            <View style={s.headerRow}>
              <Text style={[s.modalTitle, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                Chat Theme & Wallpaper
              </Text>
              <TouchableOpacity
                style={s.closeButton}
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Icon name="close" size={20} color={isDark ? '#9CA3AF' : '#4B5563'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick Actions (Custom Photo & Reset) */}
          <View style={s.quickActionsRow}>
            <TouchableOpacity
              style={[
                s.actionPill,
                { backgroundColor: isDark ? '#232733' : '#F3F4F6' },
              ]}
              onPress={handlePickFromGallery}
              activeOpacity={0.7}
            >
              <Icon name="image-outline" size={16} color="#0F62FE" />
              <Text style={[s.actionPillText, { color: isDark ? '#FFFFFF' : '#111827' }]}>
                Custom Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.actionPill,
                { backgroundColor: isDark ? '#232733' : '#F3F4F6' },
              ]}
              onPress={handleResetToDefault}
              activeOpacity={0.7}
            >
              <Icon name="refresh-outline" size={16} color="#EF4444" />
              <Text style={[s.actionPillText, { color: '#EF4444' }]}>
                Reset Default
              </Text>
            </TouchableOpacity>
          </View>

          {/* Preset Theme Cards Grid (Shows 2 rows initially) */}
          <ScrollView
            contentContainerStyle={s.cardsGrid}
            showsVerticalScrollIndicator={false}
          >
            {CHAT_THEME_PRESETS.map((preset) => {
              const isSelected = selectedThemeId === preset.id;
              return (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    s.themeCard,
                    isSelected && { borderColor: '#10B981', borderWidth: 2 },
                  ]}
                  onPress={() => handleSelectPreset(preset)}
                  activeOpacity={0.8}
                >
                  {/* Card Background Layer */}
                  <View style={s.cardBackgroundPreview}>
                    {preset.background.type === 'gradient' && preset.background.colors ? (
                      <LinearGradient
                        colors={preset.background.colors}
                        style={StyleSheet.absoluteFill}
                      />
                    ) : (
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          {
                            backgroundColor:
                              preset.background.solidColor === 'transparent'
                                ? isDark
                                  ? '#0B0F19'
                                  : '#F2F2F7'
                                : preset.background.solidColor,
                          },
                        ]}
                      />
                    )}

                    {/* Mini Chat Bubbles Preview */}
                    <View style={s.miniBubblesContainer}>
                      {/* Received Bubble */}
                      <View
                        style={[
                          s.miniTheirBubble,
                          { backgroundColor: preset.theirBubble.backgroundColor },
                        ]}
                      >
                        <View style={[s.miniLine, { width: 30, backgroundColor: preset.theirBubble.textColor, opacity: 0.7 }]} />
                      </View>

                      {/* Sent Bubble */}
                      {preset.myBubble.gradient ? (
                        <LinearGradient
                          colors={preset.myBubble.gradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={s.miniMyBubble}
                        >
                          <View style={[s.miniLine, { width: 38, backgroundColor: preset.myBubble.textColor, opacity: 0.9 }]} />
                        </LinearGradient>
                      ) : (
                        <View
                          style={[
                            s.miniMyBubble,
                            { backgroundColor: preset.myBubble.solidColor || '#0F62FE' },
                          ]}
                        >
                          <View style={[s.miniLine, { width: 38, backgroundColor: preset.myBubble.textColor, opacity: 0.9 }]} />
                        </View>
                      )}
                    </View>

                    {/* Floating Tick / Checkmark Badge on Active Theme */}
                    {isSelected && (
                      <View style={s.selectedCheckBadge}>
                        <Icon name="checkmark" size={13} color="#FFFFFF" />
                      </View>
                    )}
                  </View>

                  {/* Card Title */}
                  <View
                    style={[
                      s.cardFooter,
                      { backgroundColor: isDark ? '#1C202C' : '#FFFFFF' },
                    ]}
                  >
                    <Text
                      style={[
                        s.cardTitle,
                        { color: isDark ? '#FFFFFF' : '#111827' },
                        isSelected && { color: '#10B981', fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      {preset.name}
                    </Text>
                    {isSelected && (
                      <Icon name="checkmark-circle" size={16} color="#10B981" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: HALF_SCREEN_HEIGHT,
    paddingBottom: Platform.OS === 'android' ? 10 : 24,
  },
  modalHeader: {
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150, 150, 150, 0.4)',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalTitle: {
    fontSize: 16.5,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 12,
  },
  actionPillText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  themeCard: {
    width: CARD_WIDTH,
    height: 118,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  cardBackgroundPreview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  miniBubblesContainer: {
    width: '80%',
    gap: 5,
  },
  miniTheirBubble: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderTopLeftRadius: 2,
  },
  miniMyBubble: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderBottomRightRadius: 2,
  },
  miniLine: {
    height: 4,
    borderRadius: 2,
  },
  selectedCheckBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
});
