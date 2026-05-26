import React from 'react';
import { NavigationContainer, DefaultTheme, CommonActions, useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, DeviceEventEmitter, Modal } from 'react-native';
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
} from '../screens';
import { colors, spacing } from '../utils/theme';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useState } from 'react';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// HeaderRightIcons component removed

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      headerShown: true, // Disabling tab header to let screens define their own
      tabBarIcon: ({ color, size }) => {
        let iconName = 'chatbubble';
        if (route.name === 'Chats')  iconName = 'chatbubble';
        else if (route.name === 'Status') iconName = 'ellipse-outline';
        else if (route.name === 'Calls')  iconName = 'call';
        return <Icon name={iconName} size={size} color={color} />;
      },
      tabBarActiveTintColor: '#8100D1',
      tabBarInactiveTintColor: 'gray',
      tabBarHideOnKeyboard: true,
    })}
  >
    <Tab.Screen name="Chats"  component={ChatListScreen} />
    <Tab.Screen name="Status" component={StatusTabScreen} />
    <Tab.Screen 
      name="Calls"  
      component={CallLogTabScreen} 
    />
  </Tab.Navigator>
);

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

  return (
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
      <Stack.Screen name="StatusPrivacy" component={StatusPrivacyScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

const AppNavigator: React.FC<any> = ({ setNavigationRef, onNavigatorReady }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;
  return (
    <NavigationContainer ref={setNavigationRef} onReady={onNavigatorReady}>
      {isAuthenticated ? <ChatStack logout={() => {}} /> : <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /><Stack.Screen name="Register" component={RegisterScreen} /><Stack.Screen name="OTP" component={OTPVerifyScreen} /><Stack.Screen name="GoogleLogin" component={GoogleLoginScreen} /></Stack.Navigator>}
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
