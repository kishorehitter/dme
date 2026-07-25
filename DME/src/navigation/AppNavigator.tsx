import React, { useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, CommonActions, useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, DeviceEventEmitter, Modal, TouchableWithoutFeedback, StatusBar, Animated, Keyboard, Platform, Easing, NativeModules, Dimensions } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  LoginScreen,
  RegisterScreen,
  OTPVerifyScreen,
  GoogleLoginScreen,
  CallScreen,
  IncomingCallScreen,
  ChatRoomScreen,
  FriendListScreen,
  CreateGroupScreen,
  GroupInfoScreen,
  ProfileScreen,
  ProfileSetupScreen,
  StatusViewer,
  StatusEditorScreen,
  MediaViewerScreen,
  SharedMediaScreen,
  ChatListScreen,
  StatusTabScreen,
  CallLogTabScreen,
  StatusPrivacyScreen,
  SettingsScreen,
  TriviaSoloScreen,
  TriviaScoreboardScreen,
} from '../screens';
import { colors, spacing } from '../utils/theme';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import MusicRoomScreen from '../screens/MusicRoomScreen';
import YouTubeDiscoveryScreen from '../screens/YouTubeDiscoveryScreen';
import { useState, useEffect, useLayoutEffect } from 'react';
import { Pressable } from 'react-native';
import { navigationRef } from '../../App';
import { pinNavBarColor } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const customTransitionSpec = {
  open: {
    animation: 'timing' as const,
    config: {
      duration: 380,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    },
  },
  close: {
    animation: 'timing' as const,
    config: {
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    },
  },
};

const centerZoomTransition = {
  gestureEnabled: false,
  transitionSpec: {
    open: {
      animation: 'timing' as const,
      config: {
        duration: 250,
        easing: Easing.bezier(0.2, 0, 0, 1),
      },
    },
    close: {
      animation: 'timing' as const,
      config: {
        duration: 200,
        easing: Easing.bezier(0.2, 0, 0, 1),
      },
    },
  },
  cardStyleInterpolator: ({ current: { progress } }: any) => {
    const opacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });
    const scale = progress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.93, 0.97, 1],
    });
    return {
      cardStyle: {
        opacity,
        transform: [{ scale }],
      },
    };
  },
};

const fastStatusTransition = {
  gestureEnabled: false,
  transitionSpec: {
    open: {
      animation: 'timing' as const,
      config: {
        duration: 90,
        easing: Easing.out(Easing.quad),
      },
    },
    close: {
      animation: 'timing' as const,
      config: {
        duration: 100,
        easing: Easing.out(Easing.quad),
      },
    },
  },
  cardStyleInterpolator: ({ current: { progress } }: any) => {
    const opacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });
    return {
      cardStyle: {
        opacity,
      },
    };
  },
};


// HeaderRightIcons component removed

const MainTabs = () => {
  const insets = useSafeAreaInsets();
  const bottomInsetRef = useRef(insets.bottom);
  if (insets.bottom > 0) {
    bottomInsetRef.current = insets.bottom;
  }
  const safeBottom = bottomInsetRef.current;
  const statusBtnRef = useRef<View>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const { theme, isDark } = useTheme();

  const hideTabBar = (instantly = false) => {
    Animated.timing(translateY, {
      toValue: 80 + safeBottom, // Slide tab bar fully offscreen
      duration: instantly ? 0 : 200,
      useNativeDriver: true,
    }).start();
  };

  const showTabBar = (instantly = false) => {
    Animated.timing(translateY, {
      toValue: 0, // Slide tab bar back into view
      duration: instantly ? 0 : 250,
      useNativeDriver: true,
    }).start();
  };

  const measureAndEmitStatusTab = () => {
    if (!statusBtnRef.current) return;
    let attempts = 0;
    const tryMeasure = () => {
      if (!statusBtnRef.current) return;
      statusBtnRef.current.measure((x, y, width, height, pageX, pageY) => {
        if (width > 0 && height > 0) {
          DeviceEventEmitter.emit('status_tab_measured', {
            x: pageX, y: pageY, width, height,
          });
        } else if (attempts < 10) {
          attempts++;
          setTimeout(tryMeasure, 150);
        }
      });
    };
    tryMeasure();
  };

  useEffect(() => {
    measureAndEmitStatusTab();

    // Listen for custom events from ChatListScreen to control tab bar visibility
    const hideSub = DeviceEventEmitter.addListener('hide_tab_bar_instantly', () => {
      hideTabBar(true);
    });
    const showSub = DeviceEventEmitter.addListener('show_tab_bar_smoothly', () => {
      showTabBar(false);
    });

    // Keyboard hide listener as a fallback to guarantee it always returns smoothly
    const keyboardHideSub = Keyboard.addListener('keyboardDidHide', () => {
      showTabBar(false);
    });

    return () => {
      hideSub.remove();
      showSub.remove();
      keyboardHideSub.remove();
    };
  }, []);

  return (
    <Tab.Navigator
      detachPreviousScreen={false}
      screenOptions={({ route }) => ({
        headerShown: true,
        animation: 'none',
        lazy: false,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarIcon: ({ color, size, focused }) => {
          let iconName = 'chatbubble-outline';
          if (route.name === 'Chats')  iconName = focused ? 'chatbubble' : 'chatbubble-outline';
          else if (route.name === 'Status') iconName = focused ? 'person-circle' : 'person-circle-outline';
          else if (route.name === 'Calls')  iconName = focused ? 'call' : 'call-outline';

          return <Icon name={iconName} size={24} color={color} />;
        },
        tabBarButton: (props) => {
          if (route.name === 'Status') {
            return (
              <Pressable
                {...props}
                android_ripple={{ color: 'transparent' }}
                style={[props.style, { flex: 1 }]}
              >
                {props.children}
                <View
                  ref={statusBtnRef}
                  collapsable={false}
                  onLayout={measureAndEmitStatusTab}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: 32,
                    height: 32,
                    alignSelf: 'center',
                    top: 4,
                  }}
                />
              </Pressable>
            );
          }
          return (
            <Pressable {...props} android_ripple={{ color: 'transparent' }} />
          );
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.iconMuted,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarStyle: { 
          height: 60, 
          paddingBottom: 8, 
          paddingTop: 4,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: theme.tabBar,
          elevation: 8,
          shadowOpacity: 0.1,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.border,
          transform: [{ translateY: translateY }] as any,
        },
        tabBarIconStyle: { marginBottom: 0 },
      })}
    >
      <Tab.Screen name="Chats"  component={ChatListScreen} />
      <Tab.Screen name="Status" component={StatusTabScreen} />
      <Tab.Screen name="Calls"  component={CallLogTabScreen} />
    </Tab.Navigator>
  );
};

const ChatStack: React.FC<any> = ({ logout }) => {
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => { await logout(); },
      },
    ]);
  };

  const { theme, isDark } = useTheme();

  const [musicRoom, setMusicRoom] = useState<{
    roomCode: string | null;
    params: any;
    isMinimized: boolean;
  }>({
    roomCode: null,
    params: null,
    isMinimized: false,
  });

  useEffect(() => {
    const openSub = DeviceEventEmitter.addListener('open_music_room', (data) => {
      setMusicRoom({
        roomCode: data.roomCode,
        params: data,
        isMinimized: false,
      });
    });

    const closeSub = DeviceEventEmitter.addListener('close_music_room', () => {
      setMusicRoom({
        roomCode: null,
        params: null,
        isMinimized: false,
      });
    });

    const minimizeSub = DeviceEventEmitter.addListener('minimize_music_room', (minimized) => {
      setMusicRoom(prev => ({
        ...prev,
        isMinimized: minimized,
      }));
    });

    return () => {
      openSub.remove();
      closeSub.remove();
      minimizeSub.remove();
    };
  }, []);

  useEffect(() => {
    if (musicRoom.roomCode && !musicRoom.isMinimized) {
      pinNavBarColor('#000000');
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
      }
    } else {
      pinNavBarColor('#FFFFFF');
      if (Platform.OS === 'android') {
        try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {}
      }
    }
  }, [musicRoom.roomCode, musicRoom.isMinimized]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: theme.background },
        detachPreviousScreen: false,
        ...TransitionPresets.SlideFromRightIOS,
        transitionSpec: customTransitionSpec,
        headerStyle: {
          backgroundColor: theme.surface,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTintColor: theme.primary,
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 20,
          color: theme.primary,
        },
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="ChatRoom"     component={ChatRoomScreen}     options={{ headerShown: false }} />
      <Stack.Screen name="Call"         component={CallScreen}         options={{ headerShown: false }} />
      <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
      <Stack.Screen name="FriendList"   component={FriendListScreen}   options={{ title: 'My Friends', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint }} />
      <Stack.Screen name="CreateGroup"  component={CreateGroupScreen}  options={{ title: 'New Group', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint }} />
      <Stack.Screen 
        name="GroupInfo"    
        component={GroupInfoScreen}    
        options={{ 
          title: 'Group Info',
          headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' },
          headerTintColor: theme.headerTint,
          headerStyle: { backgroundColor: theme.surface, elevation: 0, shadowOpacity: 0 },
        }} 
      />
      <Stack.Screen name="Profile"      component={ProfileScreen}      options={{ title: 'Profile', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint, headerStyle: { backgroundColor: theme.surface, elevation: 0, shadowOpacity: 0 } }} />
      <Stack.Screen
        name="StatusViewer"
        component={StatusViewer}
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          cardStyle: { backgroundColor: 'transparent' },
          safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
          ...fastStatusTransition,
        }}
      />
      <Stack.Screen
        name="StatusEditor"
        component={StatusEditorScreen}
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          animation: 'none',
          statusBarHidden: true,
        }}
      />
      <Stack.Screen name="MediaViewer" component={MediaViewerScreen} options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="SharedMedia" component={SharedMediaScreen} options={{ title: 'Shared Media', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint, headerStyle: { backgroundColor: theme.surface, elevation: 0, shadowOpacity: 0 } }} />
      <Stack.Screen name="YouTubeDiscovery" component={YouTubeDiscoveryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StatusPrivacy" component={StatusPrivacyScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TriviaSolo" component={TriviaSoloScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TriviaScoreboard" component={TriviaScoreboardScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
      {musicRoom.roomCode && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 9999, backgroundColor: '#000000' },
            musicRoom.isMinimized && {
              position: 'absolute',
              left: -9999,
              width: 0,
              height: 0,
              opacity: 0,
            }
          ]}
          pointerEvents={musicRoom.isMinimized ? 'none' : 'auto'}
        >
          <MusicRoomScreen
            route={{ params: musicRoom.params }}
            navigation={navigationRef}
            isMinimized={musicRoom.isMinimized}
          />
        </View>
      )}
    </View>
  );
};

const AppNavigator: React.FC<any> = ({ setNavigationRef, onNavigatorReady }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { isDark, theme } = useTheme();
  const fadeRef = React.useRef(new Animated.Value(0)).current;

  // Build a navigation theme matching our color palette
  const navTheme = React.useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.background,
      card: theme.surface,
      text: theme.textPrimary,
      border: theme.border,
      primary: theme.primary,
      notification: theme.primary,
    },
  }), [isDark, theme]);

  // Fade in ONLY once: when the app finishes its initial loading check
  React.useEffect(() => {
    if (!isLoading) {
      Animated.timing(fadeRef, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [isLoading]); // ← only on loading change, NOT on auth/user change

  // Pre-configure system bars BEFORE the new screen paints to eliminate the colour flash
  React.useLayoutEffect(() => {
    if (isLoading) return;
    const currentRouteName = navigationRef.current?.getCurrentRoute()?.name;
    if (currentRouteName === 'StatusViewer' || currentRouteName === 'MediaViewer' || currentRouteName === 'FullScreenMediaViewer' || currentRouteName === 'StatusEditor') {
      return;
    }
    if (isAuthenticated) {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(theme.statusBarStyle);
      StatusBar.setBackgroundColor(theme.statusBar);
      pinNavBarColor(theme.navBar);
      try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch (_) {}
    } else {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('light-content');
      StatusBar.setBackgroundColor('#000000');
      pinNavBarColor('#000000');
      try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
    }
  }, [isAuthenticated, isLoading, isDark, theme]);

  return (
    <NavigationContainer
      ref={setNavigationRef}
      theme={navTheme}
      onReady={() => {
        onNavigatorReady?.();
        // Initial configuration for navigation bar
        if (Platform.OS === 'android' && NativeModules.SystemBar) {
          if (!isAuthenticated) {
            pinNavBarColor('#000000');
            try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
            NativeModules.SystemBar.setNavigationBarColor('#000000', true);
          } else {
            pinNavBarColor(theme.navBar);
            try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch (_) {}
            NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
          }
        }
      }}
      onStateChange={() => {
        if (!navigationRef || !navigationRef.current) return;
        const currentRouteName = navigationRef.current.getCurrentRoute()?.name;
        if (!currentRouteName) return;

        if (['Chats', 'Status', 'Calls'].includes(currentRouteName)) {
          if (Platform.OS === 'android' && NativeModules.SystemBar) {
            pinNavBarColor(theme.navBar);
            try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch (_) {}
            NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
          }
        } else if (currentRouteName === 'StatusViewer') {
          if (Platform.OS === 'android') {
            pinNavBarColor('#00000000');
            if (NativeModules.SystemBar) {
              NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
            }
          }
        } else if (['MusicRoom', 'Call', 'IncomingCall', 'MediaViewer', 'FullScreenMediaViewer', 'StatusEditor'].includes(currentRouteName)) {
          if (Platform.OS === 'android' && NativeModules.SystemBar) {
            pinNavBarColor('#000000');
            try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
            NativeModules.SystemBar.setNavigationBarColor('#000000', true);
          }
        } else {
          if (Platform.OS === 'android' && NativeModules.SystemBar) {
            pinNavBarColor(theme.navBar);
            try { changeNavigationBarColor(theme.navBar, !isDark, false); } catch (_) {}
            NativeModules.SystemBar.setNavigationBarColor(theme.navBar, isDark);
          }
        }
      }}
    >
      <Animated.View style={{ flex: 1, opacity: isLoading ? 0 : fadeRef }}>
        {isLoading ? (
          <View style={{ flex: 1, backgroundColor: theme.background }} />
        ) : isAuthenticated ? (
          !user?.is_profile_complete ? (
            <Stack.Navigator key="profile-setup-navigator" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="OnboardingProfileSetup" component={ProfileSetupScreen} />
            </Stack.Navigator>
          ) : (
            <ChatStack key="chat-stack-navigator" logout={() => {}} />
          )
        ) : (
          <Stack.Navigator screenOptions={{
              headerShown: false,
              animation: 'fade',
              animationDuration: 200,
            }}>
            <Stack.Screen name="GoogleLogin" component={GoogleLoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="OTP" component={OTPVerifyScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </Stack.Navigator>
        )}
      </Animated.View>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  popover: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 1000,
  },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  popoverText: { fontSize: 14, color: '#333' },
});

export default AppNavigator;
