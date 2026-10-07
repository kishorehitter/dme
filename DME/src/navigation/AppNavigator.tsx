import React, { useRef, useCallback, useState, useEffect } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, CommonActions, useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, DeviceEventEmitter, Modal, TouchableWithoutFeedback, StatusBar, Animated, Keyboard, Platform, Easing, NativeModules, Dimensions, PanResponder } from 'react-native';
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
  TriviaHubScreen,
  TriviaSoloScreen,
  TriviaScoreboardScreen,
  CustomTriviaSetsScreen,
  QuizPdfUploadScreen,
  TriviaChallengesScreen,
} from '../screens';
import { colors, spacing } from '../utils/theme';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import MusicRoomScreen from '../screens/MusicRoomScreen';
import YouTubeDiscoveryScreen from '../screens/YouTubeDiscoveryScreen';
import MultiMediaPreviewScreen from '../screens/MultiMediaPreviewScreen';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable } from 'react-native';
import { navigationRef } from '../../App';
import { pinNavBarColor, setWindowBackground } from '../utils/navBarPin';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();






// HeaderRightIcons component removed

const TAB_ORDER = ['Chats', 'Status', 'Calls'] as const;

interface SwipeableTabWrapperProps {
  currentTab: 'Chats' | 'Status' | 'Calls';
  navigation: any;
  children: React.ReactNode;
}

const SwipeableTabWrapper: React.FC<SwipeableTabWrapperProps> = ({ currentTab, navigation, children }) => {
  const isNavigating = useRef(false);

  const handleSwipe = useCallback((gestureState: any) => {
    if (isNavigating.current) return;
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    const SWIPE_DIST = 22;
    const SWIPE_VEL = 0.2;

    const isSwipeLeft = gestureState.dx < -SWIPE_DIST || gestureState.vx < -SWIPE_VEL;
    const isSwipeRight = gestureState.dx > SWIPE_DIST || gestureState.vx > SWIPE_VEL;

    if (isSwipeLeft && currentIndex < TAB_ORDER.length - 1) {
      isNavigating.current = true;
      navigation.navigate(TAB_ORDER[currentIndex + 1]);
      setTimeout(() => { isNavigating.current = false; }, 260);
    } else if (isSwipeRight && currentIndex > 0) {
      isNavigating.current = true;
      navigation.navigate(TAB_ORDER[currentIndex - 1]);
      setTimeout(() => { isNavigating.current = false; }, 260);
    }
  }, [currentTab, navigation]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return (
          (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.vx) > 0.15) &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3
        );
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.vx) > 0.15) &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3
        );
      },
      onPanResponderMove: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > 22 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3) {
          handleSwipe(gestureState);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        handleSwipe(gestureState);
      },
      onPanResponderTerminate: (_, gestureState) => {
        handleSwipe(gestureState);
      },
    })
  ).current;

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      {children}
    </View>
  );
};

const SwipeableChatList = (props: any) => (
  <SwipeableTabWrapper currentTab="Chats" navigation={props.navigation}>
    <ChatListScreen {...props} />
  </SwipeableTabWrapper>
);

const SwipeableStatusTab = (props: any) => (
  <SwipeableTabWrapper currentTab="Status" navigation={props.navigation}>
    <StatusTabScreen {...props} />
  </SwipeableTabWrapper>
);

const SwipeableCallLogTab = (props: any) => (
  <SwipeableTabWrapper currentTab="Calls" navigation={props.navigation}>
    <CallLogTabScreen {...props} />
  </SwipeableTabWrapper>
);

const MainTabs = () => {
  const statusBtnRef = useRef<View>(null);
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [musicRoomActive, setMusicRoomActive] = useState(() => !!(global as any).activeMusicRoomCode);

  useEffect(() => {
    const openSub = DeviceEventEmitter.addListener('open_music_room', () => setMusicRoomActive(true));
    const closeSub = DeviceEventEmitter.addListener('close_music_room', () => setMusicRoomActive(false));
    const minimizeSub = DeviceEventEmitter.addListener('minimize_music_room', (minimized: boolean) => setMusicRoomActive(!minimized));
    return () => {
      openSub.remove();
      closeSub.remove();
      minimizeSub.remove();
    };
  }, []);

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
  }, []);

  useFocusEffect(
    useCallback(() => {
      if ((global as any).activeMusicRoomCode) return;
      pinNavBarColor('#00000000', isDark);
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
      }
    }, [theme.surface, isDark])
  );

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

          return (
            <View style={[
              styles.tabPill,
              focused && {
                backgroundColor: isDark ? 'rgba(56, 189, 248, 0.18)' : '#D6E4FF',
              }
            ]}>
              <Icon
                name={iconName}
                size={22}
                color={
                  focused
                    ? (isDark ? '#38BDF8' : '#163B70')
                    : (isDark ? '#94A3B8' : '#4B5563')
                }
              />
            </View>
          );
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
        tabBarActiveTintColor: isDark ? '#F1F5F9' : '#111827',
        tabBarInactiveTintColor: isDark ? '#94A3B8' : '#64748B',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: musicRoomActive
          ? { display: 'none' }
          : {
              height: 64 + (insets.bottom || 48),
              paddingBottom: 6 + (insets.bottom || 48),
              paddingTop: 6,
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.surface,
              elevation: 0,
              shadowOpacity: 0,
              borderTopWidth: 0,
            },
        tabBarIconStyle: { marginBottom: 0 },
      })}
    >
      <Tab.Screen name="Chats"  component={SwipeableChatList} />
      <Tab.Screen name="Status" component={SwipeableStatusTab} />
      <Tab.Screen name="Calls"  component={SwipeableCallLogTab} />
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
      (global as any).activeMusicRoomCode = data.roomCode;
      setWindowBackground('#000000');
      pinNavBarColor('#00000000', true);
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setWindowBackground('#000000');
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
        NativeModules.SystemBar.setFitsSystemWindows(false);
      }
      setMusicRoom({
        roomCode: data.roomCode,
        params: data,
        isMinimized: false,
      });
    });

    const closeSub = DeviceEventEmitter.addListener('close_music_room', () => {
      (global as any).activeMusicRoomCode = null;
      setMusicRoom({
        roomCode: null,
        params: null,
        isMinimized: false,
      });
      setTimeout(() => {
        if (!(global as any).activeMusicRoomCode) {
          setWindowBackground(theme.background);
          pinNavBarColor('#00000000', isDark);
        }
      }, 200);
    });

    const minimizeSub = DeviceEventEmitter.addListener('minimize_music_room', (minimized) => {
      setMusicRoom(prev => ({
        ...prev,
        isMinimized: minimized,
      }));
      if (minimized) {
        // Delay restoring light theme nav bar until the dark overlay is fully minimized
        setTimeout(() => {
          setWindowBackground(theme.background);
          pinNavBarColor('#00000000', isDark);
        }, 200);
      } else {
        setWindowBackground('#000000');
        pinNavBarColor('#00000000', true);
      }
    });

    return () => {
      openSub.remove();
      closeSub.remove();
      minimizeSub.remove();
    };
  }, [theme.surface, isDark]);



  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: theme.background },
        headerStyle: {
          backgroundColor: theme.surface,
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
        options={{ headerShown: false, animation: 'none' }}
      />
      <Stack.Screen 
        name="ChatRoom"     
        component={ChatRoomScreen}     
        options={{ 
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 10,
        }} 
      />
      <Stack.Screen name="Call"         component={CallScreen}         options={{ headerShown: false }} />
      <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
      <Stack.Screen name="FriendList"   component={FriendListScreen}   options={{ title: 'My Friends', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint, animation: 'slide_from_right', animationDuration: 130 }} />
      <Stack.Screen name="CreateGroup"  component={CreateGroupScreen}  options={{ title: 'New Group', headerTitleStyle: { color: theme.headerTint, fontWeight: 'bold' }, headerTintColor: theme.headerTint, animation: 'slide_from_right', animationDuration: 130 }} />
      <Stack.Screen 
        name="GroupInfo"    
        component={GroupInfoScreen}    
        options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 130 }} 
      />
      <Stack.Screen 
        name="Profile"      
        component={ProfileScreen}      
        options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 130 }} 
      />
      <Stack.Screen
        name="StatusViewer"
        component={StatusViewer}
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="StatusEditor"
        component={StatusEditorScreen}
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
        }}
      />
      <Stack.Screen 
        name="MediaViewer" 
        component={MediaViewerScreen} 
        options={{ 
          headerShown: false, 
          animation: 'fade',
          contentStyle: { backgroundColor: '#000000' },
        }} 
      />
      <Stack.Screen 
        name="YouTubeDiscovery" 
        component={YouTubeDiscoveryScreen} 
        options={{ 
          headerShown: false,
          animation: 'none',
          contentStyle: { backgroundColor: '#020912' },
        }} 
      />
      <Stack.Screen
        name="TriviaHub"
        component={TriviaHubScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#0B132B' },
        }}
      />
      <Stack.Screen
        name="TriviaSolo"
        component={TriviaSoloScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="TriviaScoreboard"
        component={TriviaScoreboardScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F8F9FA' },
        }}
      />
      <Stack.Screen
        name="CustomTriviaSets"
        component={CustomTriviaSetsScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      />
      <Stack.Screen
        name="QuizPdfUpload"
        component={QuizPdfUploadScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      />
      <Stack.Screen
        name="TriviaChallenges"
        component={TriviaChallengesScreen}
        options={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#0B132B' },
        }}
      />
      <Stack.Screen
        name="MultiMediaPreview"
        component={MultiMediaPreviewScreen}
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
        }}
      />
    </Stack.Navigator>
      {musicRoom.roomCode && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 9999, backgroundColor: 'transparent' },
            musicRoom.isMinimized && {
              position: 'absolute',
              top: -9999,
              left: -9999,
              width: Dimensions.get('window').width,
              height: Dimensions.get('window').height,
              opacity: 0,
            }
          ]}
          pointerEvents={musicRoom.isMinimized ? 'none' : 'auto'}
        >
          <MusicRoomScreen
            key={musicRoom.roomCode}
            route={{ params: musicRoom.params }}
            navigation={navigationRef}
            isMinimized={musicRoom.isMinimized}
          />
        </View>
      )}
    </View>
  );
};

const AppNavigator: React.FC<any> = ({ setNavigationRef, onNavigatorReady, isSplashFinished }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { isDark, theme } = useTheme();
  const fadeRef = React.useRef(new Animated.Value(0)).current;
  const lastAppliedModeRef = React.useRef<string | null>(null);

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
      StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', isDark);
        NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
        pinNavBarColor('#00000000', isDark);
      }
    } else {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('light-content');
      StatusBar.setBackgroundColor('transparent');
      if (Platform.OS === 'android' && NativeModules.SystemBar) {
        NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
        NativeModules.SystemBar.setStatusBarColor('#00000000', true);
        pinNavBarColor('#00000000', true);
      }
    }
  }, [isAuthenticated, isLoading, isDark, theme]);

  return (
    <NavigationContainer
      ref={setNavigationRef}
      theme={navTheme}
      onReady={() => {
        onNavigatorReady?.();
      }}
      onStateChange={() => {
        if (!navigationRef || !navigationRef.current) return;
        const currentRouteName = navigationRef.current.getCurrentRoute()?.name;
        if (!currentRouteName) return;

        const isBlackMode = ['StatusViewer', 'StatusEditor', 'MediaViewer', 'FullScreenMediaViewer', 'GoogleLogin', 'MusicRoom'].includes(currentRouteName) || (global as any).activeMusicRoomCode;
        const isAuthMode = ['Login', 'Register', 'OTP'].includes(currentRouteName);
        const mode = isBlackMode ? 'black' : isAuthMode ? 'auth' : `normal_${isDark}`;

        if (lastAppliedModeRef.current === mode) {
          return; // Skip redundant synchronous native bridge calls during transitions between normal screens
        }
        lastAppliedModeRef.current = mode;

        if (Platform.OS === 'android' && NativeModules.SystemBar) {
          if (isBlackMode) {
            NativeModules.SystemBar.setWindowBackground('#000000');
            NativeModules.SystemBar.setNavigationBarColor('#00000000', true);
            NativeModules.SystemBar.setStatusBarColor('#00000000', true);
            NativeModules.SystemBar.setFitsSystemWindows(false);
            pinNavBarColor('#00000000', true);
          } else if (isAuthMode) {
            NativeModules.SystemBar.setNavigationBarColor('#00000000', false);
            NativeModules.SystemBar.setStatusBarColor('#00000000', false);
            pinNavBarColor('#00000000', false);
          } else {
            NativeModules.SystemBar.setWindowBackground(theme.background);
            NativeModules.SystemBar.setNavigationBarColor('#00000000', isDark);
            NativeModules.SystemBar.setStatusBarColor('#00000000', isDark);
            pinNavBarColor('#00000000', isDark);
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
  tabPill: {
    width: 60,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
});

export default AppNavigator;
