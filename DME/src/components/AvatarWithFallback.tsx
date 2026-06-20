import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../utils/image';
import { colors } from '../utils/theme';

const getInitials = (name: string) => {
  if (typeof name !== 'string') return null;
  const match = name.trim().match(/[a-zA-Z]/);
  return match ? match[0].toUpperCase() : null;
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

  useEffect(() => { 
    if (uri) console.log('AvatarWithFallback: Loading URI:', resolveImageUrl(uri));
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
    overflow:     'hidden' as const,  // clips image/content to circle shape
    ...style,                         // allow override
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
          style={styles.fill}
          onError={() => setError(true)}
        />
      );
    }

    if (sticker) {
      return (
        <View style={[styles.fill, styles.placeholder]}>
          <Text style={{ fontSize: stickerFontSize }}>{String(sticker)}</Text>
        </View>
      );
    }

    if (isGroup) {
      return (
        <View style={[styles.fill, styles.placeholder]}>
          <Icon name="people" size={derivedIconSize} color={colors.primary} />
        </View>
      );
    }

    const initial = getInitials(displayName);
    if (initial) {
      return (
        <View style={[styles.fill, styles.placeholder, { backgroundColor: colors.primary + '20' }]}>
          <Text style={{ fontSize: derivedFontSize, color: colors.primary, fontWeight: 'bold' }}>
            {initial}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.fill, styles.placeholder]}>
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