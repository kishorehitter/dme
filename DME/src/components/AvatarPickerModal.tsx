import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  StyleSheet,
  Dimensions,
  Animated,
  ScrollView,
  FlatList,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { ALL_PRESET_AVATARS, AVATAR_FILTER_CHIPS, AvatarCategory, PresetAvatar } from '../utils/presetAvatars';
import AvatarWithFallback from './AvatarWithFallback';

export interface AvatarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (stickerId: string) => void;
  currentSticker?: string | null | undefined;
  profilePicture?: string | null | undefined;
  displayName: string;
}

const AVATAR_SHEET_HEIGHT = Dimensions.get('window').height * 0.62;

export const AvatarPickerModal: React.FC<AvatarPickerModalProps> = React.memo(({
  visible,
  onClose,
  onSelect,
  currentSticker,
  profilePicture,
  displayName,
}) => {
  const { theme } = useTheme();
  const translateY = useRef(new Animated.Value(AVATAR_SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const [avatarCategory, setAvatarCategory] = useState<AvatarCategory>('all');

  const filteredAvatars = useMemo(() => {
    if (avatarCategory === 'all') return ALL_PRESET_AVATARS;
    return ALL_PRESET_AVATARS.filter(a => a.category === avatarCategory);
  }, [avatarCategory]);

  useEffect(() => {
    if (!visible) {
      isClosingRef.current = false;
      return;
    }

    isClosingRef.current = false;
    translateY.setValue(AVATAR_SHEET_HEIGHT);
    backdropOpacity.setValue(0);

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        tension: 75,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, translateY, backdropOpacity]);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: AVATAR_SHEET_HEIGHT,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      isClosingRef.current = false;
      onClose();
    });
  }, [onClose, translateY, backdropOpacity]);

  const handleSelect = useCallback((stickerId: string) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: AVATAR_SHEET_HEIGHT,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      isClosingRef.current = false;
      onClose();
      onSelect(stickerId);
    });
  }, [onClose, onSelect, translateY, backdropOpacity]);

  const renderItem = useCallback(({ item }: { item: PresetAvatar }) => {
    const isSelected = currentSticker === item.id;
    const gradientColors = item.gradient || [item.bgColor, item.bgColor];
    return (
      <TouchableOpacity
        style={[
          avatarPickerStyles.stickerItem,
          isSelected && { backgroundColor: theme.primary + '15', borderRadius: 16 },
        ]}
        onPress={() => handleSelect(item.id)}
        activeOpacity={0.7}
      >
        <View style={avatarPickerStyles.stickerWrapperOuter}>
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              avatarPickerStyles.stickerImageWrapper,
              isSelected && { borderColor: theme.primary, borderWidth: 2 },
            ]}
          >
            <Image source={item.image} style={avatarPickerStyles.stickerImage} resizeMode="contain" />
          </LinearGradient>
          {isSelected && (
            <View style={avatarPickerStyles.stickerCheckBadge}>
              <Icon name="checkmark" size={11} color="#FFFFFF" />
            </View>
          )}
        </View>
        <Text
          style={[
            avatarPickerStyles.stickerLabel,
            { color: isSelected ? theme.primary : theme.textSecondary, fontWeight: isSelected ? 'bold' : 'normal' },
          ]}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  }, [currentSticker, theme, handleSelect]);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <View style={avatarPickerStyles.modalContainer}>
        {/* Animated Backdrop: fades in smoothly on open and fades out cleanly on close */}
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={handleClose}
        >
          <Animated.View style={[avatarPickerStyles.backdrop, { opacity: backdropOpacity }]} />
        </TouchableOpacity>

        {/* Sheet container: slides up from bottom */}
        <Animated.View
          style={[
            avatarPickerStyles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              height: AVATAR_SHEET_HEIGHT,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={[avatarPickerStyles.dragHandle, { backgroundColor: theme.border }]} />

          <View style={avatarPickerStyles.header}>
            <Text style={[avatarPickerStyles.title, { color: theme.textPrimary }]}>Choose 3D Avatar</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            <AvatarWithFallback 
              uri={profilePicture} 
              displayName={displayName} 
              sticker={currentSticker}
              style={{ width: 64, height: 64, borderRadius: 32 }} 
            />
            <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 4, fontFamily: 'Kalam-Regular' }}>Current Avatar</Text>
          </View>

          {AVATAR_FILTER_CHIPS.length > 1 && (
            <View style={avatarPickerStyles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={avatarPickerStyles.filterScroll}>
                {AVATAR_FILTER_CHIPS.map(chip => {
                  const isActive = avatarCategory === chip.key;
                  return (
                    <TouchableOpacity
                      key={chip.key}
                      style={[
                        avatarPickerStyles.filterChip,
                        { borderColor: theme.border, backgroundColor: theme.background },
                        isActive && { backgroundColor: theme.primary, borderColor: theme.primary }
                      ]}
                      onPress={() => setAvatarCategory(chip.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[avatarPickerStyles.filterChipText, { color: isActive ? '#FFFFFF' : theme.textSecondary, fontWeight: isActive ? 'bold' : '500' }]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <FlatList
            data={filteredAvatars}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            numColumns={4}
            style={{ flex: 1 }}
            contentContainerStyle={avatarPickerStyles.grid}
          />
        </Animated.View>
      </View>
    </Modal>
  );
});

const avatarPickerStyles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
    zIndex: 10000,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  filterRow: {
    marginBottom: 10,
  },
  filterScroll: {
    paddingHorizontal: 2,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
  },
  grid: {
    justifyContent: 'center',
    paddingVertical: 4,
  },
  stickerItem: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 4,
    marginVertical: 4,
  },
  stickerWrapperOuter: {
    position: 'relative',
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerImageWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  stickerImage: {
    width: 54,
    height: 54,
  },
  stickerCheckBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#10B981',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 4,
    zIndex: 10,
  },
  stickerLabel: {
    fontSize: 11,
    marginTop: 4,
  },
});

export default AvatarPickerModal;
