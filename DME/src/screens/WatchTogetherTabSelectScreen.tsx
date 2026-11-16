/**
 * WatchTogetherTabSelectScreen
 * Full-screen tab selector for the Watch Together / YouTube Discovery feature.
 * Navigates to YouTubeDiscovery with the chosen tab.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  NativeModules,
  Animated,
  Easing,
  DeviceEventEmitter,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { pinNavBarColor } from '../utils/navBarPin';
import LottieStickerMessage from '../components/LottieStickerMessage';

type TabType = 'youtube' | 'drive' | 'likes' | 'history';

const TABS: TabType[] = ['youtube', 'drive', 'likes', 'history'];

const TAB_META: Record<TabType, { icon: string; label: string; color: string }> = {
  youtube:  { icon: 'logo-youtube',  label: 'YouTube', color: '#FF3B3B' },
  drive:    { icon: 'logo-google',   label: 'Drive',   color: '#4DA3FF' },
  likes:    { icon: 'heart',         label: 'Favourites',   color: '#FF6EB4' },
  history:  { icon: 'time',          label: 'History', color: '#FFBB45' },
};

const DiscoBallLoadingView = ({ isDark = false, bgColor }: { isDark?: boolean; bgColor?: string }) => {
  return (
    <View style={[styles.loadingContainer, { backgroundColor: bgColor || (isDark ? '#0F0F0F' : '#FFFFFF') }]}>
      <View style={styles.glowBallWrapper}>
        <LottieStickerMessage
          url="https://fonts.gstatic.com/s/e/notoemoji/latest/1faa9/lottie.json"
          size={96}
          autoPlay={true}
        />
      </View>
    </View>
  );
};

export default function WatchTogetherTabSelectScreen({ navigation, route, onSelectTab, onBack, skipSplash = false }: any) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { roomCode } = route?.params || {};

  const bg = isDark ? '#0F0F0F' : '#FFFFFF';
  const headerBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const backIconColor = isDark ? '#E2E8F0' : '#1E293B';
  const titleColor = isDark ? '#F1F5F9' : '#0F172A';

  // Tile colors — solid background same as border, icon differentiates
  const tileBg = isDark ? '#262626' : '#F1F5F9';
  const tileBorder = isDark ? '#262626' : '#F1F5F9';

  // Disco Ball Splash Animation — ONLY show when visiting from ChatListScreen (initial launch without active room),
  // NEVER show when visiting to search from inside MusicRoom.
  const isFromMusicRoom = Boolean(roomCode || onSelectTab || route?.params?.fromMusicRoom || (globalThis as any).activeMusicRoomCode);
  const shouldSkip = Boolean(skipSplash || route?.params?.skipSplash || isFromMusicRoom);

  const [showSplash, setShowSplash] = useState(!shouldSkip);
  const splashFadeAnim = useRef(new Animated.Value(shouldSkip ? 0 : 1)).current;

  const dismissSplash = useCallback(() => {
    Animated.timing(splashFadeAnim, {
      toValue: 0,
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start(() => {
      setShowSplash(false);
    });
  }, [splashFadeAnim]);

  useEffect(() => {
    if (shouldSkip) {
      setShowSplash(false);
      return;
    }
    const timer = setTimeout(() => {
      dismissSplash();
    }, 1100);

    return () => clearTimeout(timer);
  }, [shouldSkip, dismissSplash]);

  const [loadingTab, setLoadingTab] = useState<TabType | null>(null);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      navigation?.goBack?.();
    }
  }, [onBack, navigation]);

  const handleSelect = (tab: TabType) => {
    setLoadingTab(tab);
    if (onSelectTab) {
      setTimeout(() => setLoadingTab(null), 350);
      onSelectTab(tab);
    } else {
      navigation?.navigate?.('YouTubeDiscovery', { initialTab: tab, roomCode });
    }
  };

  // Hardware back press handler
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  // If a video is selected to play now in a room, or room opens, automatically close this screen
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('VIDEO_SELECTED', (data) => {
      if (!data?.isQueueOnly) {
        handleBack();
      }
    });
    const openSub = DeviceEventEmitter.addListener('open_music_room', () => {
      handleBack();
    });
    return () => {
      sub.remove();
      openSub.remove();
    };
  }, [handleBack]);

  useFocusEffect(
    useCallback(() => {
      setLoadingTab(null);
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#00000000', !isDark);
      }
      pinNavBarColor(bg, isDark);
    }, [isDark, bg])
  );

  const safeTopPadding = insets.top || (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={true}
      />

      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: safeTopPadding + 8,
            borderBottomColor: headerBorder,
            backgroundColor: bg,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Icon name="arrow-back" size={22} color={backIconColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: titleColor }]}>
          Watch Together
        </Text>
        {/* Spacer to balance back button */}
        <View style={styles.headerRight} />
      </View>

      {/* ── 2×2 Tab Grid ── */}
      <View style={styles.gridWrapper}>
        <View style={styles.grid}>
          {TABS.map((tab) => {
            const m = TAB_META[tab];
            return (
              <TouchableOpacity
                key={tab}
                activeOpacity={0.78}
                onPress={() => handleSelect(tab)}
                style={[
                  styles.tile,
                  {
                    backgroundColor: tileBg,
                    borderColor: tileBorder,
                  },
                ]}
              >
                <View style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}>
                  {loadingTab === tab ? (
                    <ActivityIndicator size="small" color={m.color} />
                  ) : (
                    <Icon name={m.icon} size={40} color={m.color} />
                  )}
                </View>
                <Text style={[styles.tileLabel, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Disco Ball Splash Intro Overlay ── */}
      {showSplash && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 9999,
              opacity: splashFadeAnim,
              backgroundColor: bg,
            },
          ]}
        >
          <DiscoBallLoadingView isDark={isDark} bgColor={bg} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Splash Loading
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  glowBallWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerRight: {
    width: 38,
  },

  // Grid
  gridWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 56,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 24,
    maxWidth: 340,
    width: '100%',
  },

  // Tile
  tile: {
    width: '44%',
    aspectRatio: 1.05,
    borderRadius: 24,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 18,
    gap: 12,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
