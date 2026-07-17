import React, { useRef } from 'react';
import { NavigationContainer, DefaultTheme, CommonActions, useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, DeviceEventEmitter, Modal, TouchableWithoutFeedback, StatusBar, Animated, Keyboard, Platform, Easing } from 'react-native';
import { useAuth } from '../context/AuthContext';
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

// HeaderRightIcons component removed

const MainTabs = () => {
  const statusBtnRef = useRef<View>(null);
  const translateY = useRef(new Animated.Value(0)).current;

  const hideTabBar = (instantly = false) => {
    Animated.timing(translateY, {
      toValue: 80, // Slide tab bar fully offscreen (height is 60)
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
        tabBarActiveTintColor: '#4597f5f6',
        tabBarInactiveTintColor: 'gray',
        tabBarLabelStyle: { fontSize: 12 },
        tabBarStyle: { 
          height: 60, 
          paddingBottom: 6, 
          paddingTop: 4,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          elevation: 8,
          shadowOpacity: 0.1,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#DDD',
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
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#FFFFFF' },
        detachPreviousScreen: false,
        ...TransitionPresets.SlideFromRightIOS,
        transitionSpec: customTransitionSpec,
        headerStyle: {
          backgroundColor: '#FFFFFF',
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTintColor: '#4597f5f6',
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 20,
          color: '#4597f5f6',
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
      <Stack.Screen name="FriendList"   component={FriendListScreen}   options={{ title: 'My Friends', headerTitleStyle: { color: '#000000', fontWeight: 'bold' }, headerTintColor: '#000000' }} />
      <Stack.Screen name="CreateGroup"  component={CreateGroupScreen}  options={{ title: 'New Group', headerTitleStyle: { color: '#000000', fontWeight: 'bold' }, headerTintColor: '#000000' }} />
      <Stack.Screen 
        name="GroupInfo"    
        component={GroupInfoScreen}    
        options={{ 
          title: 'Group Info',
          headerTitleStyle: { color: '#000000', fontWeight: 'bold' },
          headerTintColor: '#000000'
        }} 
      />
      <Stack.Screen name="Profile"      component={ProfileScreen}      options={{ title: 'Profile', headerTitleStyle: { color: '#000000', fontWeight: 'bold' }, headerTintColor: '#000000' }} />
      <Stack.Screen
        name="StatusViewer"
        component={StatusViewer}
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          animation: 'none',
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
      <Stack.Screen name="SharedMedia" component={SharedMediaScreen} options={{ title: 'Shared Media', headerTitleStyle: { color: '#000000', fontWeight: 'bold' }, headerTintColor: '#000000' }} />
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
  const fadeRef = React.useRef(new Animated.Value(0)).current;

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
    if (isAuthenticated) {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('dark-content');
      StatusBar.setBackgroundColor('#ffffff');
      pinNavBarColor('#ffffff');
      try { changeNavigationBarColor('#ffffff', true, false); } catch (_) {}
    } else {
      StatusBar.setTranslucent(true);
      StatusBar.setBarStyle('light-content');
      StatusBar.setBackgroundColor('#000000');
      pinNavBarColor('#000000');
      try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
    }
  }, [isAuthenticated, isLoading]);

  return (
    <NavigationContainer ref={setNavigationRef} onReady={onNavigatorReady}>
      <Animated.View style={{ flex: 1, opacity: isLoading ? 0 : fadeRef }}>
        {isLoading ? (
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
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
