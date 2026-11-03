import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import FastImage from 'react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../utils/image';
import { colors } from '../utils/theme';
import { useTheme } from '../context/ThemeContext';
import { getPresetAvatar, getPresetAvatarItem } from '../utils/presetAvatars';

export const getInitials = (name: string) => {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : trimmed.charAt(0).toUpperCase();
};

// 15 Curated Modern Gradients matching the original 15 avatar color families
export const AVATAR_GRADIENTS: [string, string][] = [
  ['#FB7185', '#E11D48'], // 0: Red / Rose Crimson (original: #F44336)
  ['#F472B6', '#BE185D'], // 1: Pink / Berry (original: #E91E63)
  ['#C084FC', '#7E22CE'], // 2: Purple / Violet (original: #9C27B0)
  ['#A78BFA', '#6D28D9'], // 3: Deep Purple / Indigo Plum (original: #673AB7)
  ['#818CF8', '#4338CA'], // 4: Indigo / Royal (original: #3F51B5)
  ['#60A5FA', '#1D4ED8'], // 5: Blue / Cobalt (original: #2196F3)
  ['#38BDF8', '#0284C7'], // 6: Light Blue / Sky Ocean (original: #03A9F4)
  ['#2DD4BF', '#0F766E'], // 7: Cyan / Deep Teal (original: #00BCD4)
  ['#34D399', '#059669'], // 8: Teal Mint (original: #009688)
  ['#10B981', '#047857'], // 9: Green / Vibrant Emerald to Forest (original: #4CAF50)
  ['#A3E635', '#4D7C0F'], // 10: Lime / Olive (original: #8BC34A)
  ['#FBBF24', '#D97706'], // 11: Amber / Warm Gold (original: #FF9800)
  ['#FB923C', '#C2410C'], // 12: Orange / Sunset (original: #FF5722)
  ['#A8A29E', '#57534E'], // 13: Warm Stone / Earth (original: #795548)
  ['#94A3B8', '#475569'], // 14: Slate / Steel Gray (original: #607D8B)
];

export const getAvatarGradient = (name: string): [string, string] => {
  if (!name) return AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
};

interface AvatarProps {
  uri?:         string | null;
  displayName:  string;
  sticker?:     string | null;
  style?:       any;
  onPress?:     () => void;
  isGroup?:     boolean;
  iconSize?:    number;
  initialSize?: number;
  variant?:     'gradientInitial' | 'silhouette';
}

const AvatarWithFallbackComponent = ({
  uri, displayName, sticker, style, onPress, isGroup, iconSize, initialSize, variant = 'gradientInitial',
}: AvatarProps) => {
  const [error, setError] = useState(false);
  const { theme } = useTheme();

  useEffect(() => { 
    setError(false); 
  }, [uri]);

  // FIX: Extract size from style reliably (supporting array styles via StyleSheet.flatten)
  // The outer container (TouchableOpacity/View) uses `style` for sizing.
  // Inner content fills 100% of that container — don't re-apply style to inner elements.
  const flatStyle       = (StyleSheet.flatten(style) || {}) as any;
  const rawWidth        = flatStyle.width !== undefined ? flatStyle.width : 40;
  const isWidthNum      = typeof rawWidth === 'number';
  const containerWidth  = rawWidth;
  const containerHeight = flatStyle.height !== undefined ? flatStyle.height : (isWidthNum ? rawWidth : '100%');
  const numSize         = isWidthNum ? (rawWidth as number) : (typeof flatStyle.height === 'number' ? flatStyle.height : 40);
  const borderRadius    = flatStyle.borderRadius !== undefined
    ? flatStyle.borderRadius
    : (isWidthNum ? (rawWidth as number) / 2 : 9999);

  // Container style — applied to the outer wrapper only
  const containerStyle = {
    borderWidth:  flatStyle.borderWidth !== undefined ? flatStyle.borderWidth : 1,
    borderColor:  (uri && !error) ? theme.border : 'rgba(255, 255, 255, 0.15)',
    ...flatStyle,
    width:        containerWidth,
    height:       containerHeight,
    borderRadius,
    overflow:     'hidden' as const,
  };

  const derivedIconSize    = iconSize    || numSize * 0.55;
  const derivedFontSize    = initialSize || numSize * 0.44;
  const stickerFontSize    = numSize * 0.52;

  // FIX: Inner content always fills 100% of container — no size re-application
  const renderInner = () => {
    // 1. Profile Picture Image
    const hasValidUri = Boolean(uri && typeof uri === 'string' && uri.trim() !== '' && uri !== 'null' && uri !== 'undefined');
    if (hasValidUri && !error) {
      const resolved = resolveImageUrl(uri);
      if (resolved && (resolved.startsWith('http') || resolved.startsWith('file://'))) {
        return (
          <FastImage
            source={{ uri: resolved, priority: FastImage.priority.high }}
            style={[styles.fill, { borderRadius }]}
            onError={() => setError(true)}
          />
        );
      }
      return (
        <Image
          source={{ uri: resolved }}
          style={[styles.fill, { borderRadius }]}
          onError={() => setError(true)}
        />
      );
    }

    // 2. Picture-Styled Illustrated Preset or Sticker Avatar
    if (sticker) {
      const presetItem = getPresetAvatarItem(sticker);
      if (presetItem) {
        const gradientColors = presetItem.gradient || getAvatarGradient(presetItem.label || 'User');
        return (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.fill, styles.placeholder, { borderRadius, overflow: 'hidden' }]}
          >
            <Image
              source={presetItem.image}
              style={{ width: '96%', height: '96%' }}
              resizeMode="contain"
            />
          </LinearGradient>
        );
      }
      return (
        <View style={[styles.fill, styles.placeholder, { backgroundColor: theme.surface, borderRadius }]}>
          <Text style={{ fontSize: stickerFontSize }}>{String(sticker)}</Text>
        </View>
      );
    }

    const gradientColors = getAvatarGradient(displayName || 'User');

    // 3. Group Chat Fallback
    if (isGroup) {
      return (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, styles.placeholder, { borderRadius }]}
        >
          <Icon name="people" size={Math.round(numSize * 0.55)} color="#FFFFFF" />
        </LinearGradient>
      );
    }

    // 4. Apple Silhouette mode if explicitly requested
    if (variant === 'silhouette') {
      return (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, styles.appleSilhouetteContainer, { borderRadius }]}
        >
          <View style={{ marginTop: numSize * 0.14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person" size={Math.round(numSize * 0.72)} color="#FFFFFF" />
          </View>
        </LinearGradient>
      );
    }

    // 5. Default: Modern Enhanced Color Gradient with Bold White Initial
    const initial = getInitials(displayName);
    if (initial) {
      return (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, styles.placeholder, { borderRadius }]}
        >
          <Text
            style={{
              fontSize: derivedFontSize,
              color: '#FFFFFF',
              fontWeight: '700',
              textShadowColor: 'rgba(0, 0, 0, 0.22)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            }}
          >
            {initial}
          </Text>
        </LinearGradient>
      );
    }

    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fill, styles.placeholder, { borderRadius }]}
      >
        <Icon name="person" size={derivedIconSize} color="#FFFFFF" />
      </LinearGradient>
    );
  };

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} style={containerStyle} activeOpacity={0.8}>
        {renderInner()}
      </TouchableOpacity>
    );
  }

  return (
    <View style={containerStyle}>
      {renderInner()}
    </View>
  );
};

const styles = StyleSheet.create({
  // FIX: fill always 100% of container — container controls the size
  fill: {
    width:  '100%',
    height: '100%',
  },
  placeholder: {
    justifyContent:  'center',
    alignItems:      'center',
  },
  appleSilhouetteContainer: {
    justifyContent: 'flex-start',
    alignItems:      'center',
    overflow:        'hidden',
  },
});

const AvatarWithFallback = React.memo(AvatarWithFallbackComponent);
export default AvatarWithFallback;
