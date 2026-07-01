import React, { useRef } from 'react';
import { NavigationContainer, DefaultTheme, CommonActions, useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, DeviceEventEmitter, Modal, TouchableWithoutFeedback, StatusBar, Animated } from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  LoginScreen,
  RegisterScreen,
  OTPVerifyScreen,
  GoogleLoginScreen,
  CallScreen,
  IncomingCallScreen,
  ChatRoomScreen,
  NewChatScreen,
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
} from '../screens';
import { colors, spacing } from '../utils/theme';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import MusicRoomScreen from '../screens/MusicRoomScreen';
import YouTubeDiscoveryScreen from '../screens/YouTubeDiscoveryScreen';
import { useState, useEffect, useLayoutEffect } from 'react';
import { Pressable } from 'react-native';
import { navigationRef } from '../../App';
import changeNavigationBarColor from 'react-native-navigation-bar-color';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// HeaderRightIcons component removed

const MainTabs = () => {
  const statusBtnRef = useRef<View>(null);

  const measureAndEmitStatusTab = () => {
    if (statusBtnRef.current) {
      statusBtnRef.current.measure((x, y, width, height, pageX, pageY) => {
        if (width > 0 && height > 0) {
          DeviceEventEmitter.emit('status_tab_measured', {
            x: pageX, y: pageY, width, height,
          });
        }
      });
    }
  };

  useEffect(() => {
    const t = setTimeout(measureAndEmitStatusTab, 700);
    return () => clearTimeout(t);
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
        tabBarActiveTintColor: '#8100D1',
        tabBarInactiveTintColor: 'gray',
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarStyle: { height: 60, paddingBottom: 6, paddingTop: 4 },
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

  useLayoutEffect(() => {
    let t1: any = null;
    let t2: any = null;
    let t3: any = null;
    let t4: any = null;

    if (musicRoom.roomCode && !musicRoom.isMinimized) {
      // Immediate paint pass
      try { changeNavigationBarColor('#000000', false, false); } catch (_) {}
      
      // Safety paint passes to override active transition layout locks
      t1 = setTimeout(() => { try { changeNavigationBarColor('#000000', false, false); } catch (_) {} }, 50);
      t2 = setTimeout(() => { try { changeNavigationBarColor('#000000', false, false); } catch (_) {} }, 200);
      t3 = setTimeout(() => { try { changeNavigationBarColor('#000000', false, false); } catch (_) {} }, 500);
      t4 = setTimeout(() => { try { changeNavigationBarColor('#000000', false, false); } catch (_) {} }, 800);
    } else {
      try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {}
      t1 = setTimeout(() => { try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {} }, 50);
      t2 = setTimeout(() => { try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {} }, 200);
      t3 = setTimeout(() => { try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {} }, 500);
      t4 = setTimeout(() => { try { changeNavigationBarColor('#FFFFFF', true, false); } catch (_) {} }, 800);
    }

    return () => {
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
      if (t4) clearTimeout(t4);
    };
  }, [musicRoom.roomCode, musicRoom.isMinimized]);

  return (
    <View style={{ flex: 1 }}>
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#FFFFFF' },
        headerStyle: {
          backgroundColor: '#FFFFFF',
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTintColor: '#8100D1',
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 20,
          color: '#8100D1',
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
      <Stack.Screen name="NewChat"      component={NewChatScreen}      options={{ title: 'New Chat' }} />
      <Stack.Screen name="CreateGroup"  component={CreateGroupScreen}  options={{ title: 'New Group' }} />
      <Stack.Screen name="GroupInfo"    component={GroupInfoScreen}    options={{ title: 'Group Info' }} />
      <Stack.Screen name="Profile"      component={ProfileScreen}      options={{ title: 'Profile' }} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: false }} />
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
      <Stack.Screen name="SharedMedia" component={SharedMediaScreen} options={{ title: 'Shared Media' }} />
      <Stack.Screen name="YouTubeDiscovery" component={YouTubeDiscoveryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StatusPrivacy" component={StatusPrivacyScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
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
  const { isAuthenticated, isLoading } = useAuth();
  const fadeRef = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!isLoading) {
      Animated.timing(fadeRef, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [isLoading, isAuthenticated]);

  // ✅ No early return — render inside JSX instead
  return (
    <NavigationContainer ref={setNavigationRef} onReady={onNavigatorReady}>
      <Animated.View style={{ flex: 1, opacity: isLoading ? 0 : fadeRef }}>
        {isLoading ? (
          <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
        ) : isAuthenticated ? (
          <ChatStack logout={() => {}} />
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
