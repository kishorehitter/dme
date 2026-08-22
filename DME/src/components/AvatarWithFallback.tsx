import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../utils/image';
import { colors } from '../utils/theme';
import { useTheme } from '../context/ThemeContext';

const getInitials = (name: string) => {
  if (typeof name !== 'string') return null;
  const match = name.trim().match(/[a-zA-Z]/);
  return match ? match[0].toUpperCase() : null;
};

const AVATAR_COLORS = [
  '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', 
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50', 
  '#8BC34A', '#FF9800', '#FF5722', '#795548', '#607D8B'
];

const getAvatarColor = (name: string) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
}

const AvatarWithFallback = ({
  uri, displayName, sticker, style, onPress, isGroup, iconSize, initialSize,
}: AvatarProps) => {
  const [error, setError] = useState(false);
  const { theme } = useTheme();

  useEffect(() => { 
    setError(false); 
  }, [uri]);

  // FIX: Extract size from style reliably
  // The outer container (TouchableOpacity/View) uses `style` for sizing.
  // Inner content fills 100% of that container — don't re-apply style to inner elements.
  const containerWidth  = style?.width  || 40;
  const containerHeight = style?.height || containerWidth;
  const borderRadius    = style?.borderRadius || containerWidth / 2;

  // Container style — applied to the outer wrapper only
  const containerStyle = {
    width:        containerWidth,
    height:       containerHeight,
    borderRadius,
    overflow:     'hidden' as const,
    borderWidth:  1,
    borderColor:  theme.border,
    ...style,
  };

  const derivedIconSize    = iconSize    || containerWidth * 0.55;
  const derivedFontSize    = initialSize || containerWidth * 0.42;
  const stickerFontSize    = containerWidth * 0.52;

  // FIX: Inner content always fills 100% of container — no size re-application
  const renderInner = () => {
    if (uri && !error) {
      return (
        <Image
          source={{ uri: resolveImageUrl(uri) }}
          style={[styles.fill, { borderRadius }]}
          onError={() => setError(true)}
        />
      );
    }

    if (sticker) {
      return (
        <View style={[styles.fill, styles.placeholder, { backgroundColor: theme.surface, borderRadius }]}>
          <Text style={{ fontSize: stickerFontSize }}>{String(sticker)}</Text>
        </View>
      );
    }

    if (isGroup) {
      return (
        <View style={[styles.fill, styles.placeholder, { borderRadius }]}>
          <Icon name="people" size={derivedIconSize} color="#bebebe" />
        </View>
      );
    }

    const initial = getInitials(displayName);
    if (initial) {
      const bgColor = getAvatarColor(displayName);
      return (
        <View style={[styles.fill, styles.placeholder, { backgroundColor: bgColor, borderRadius }]}>
          <Text style={{ fontSize: derivedFontSize, color: '#FFFFFF', fontWeight: 'bold' }}>
            {initial}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.fill, styles.placeholder, { borderRadius }]}>
        <Icon name="person" size={derivedIconSize} color={colors.primary} />
      </View>
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
});

export default AvatarWithFallback;