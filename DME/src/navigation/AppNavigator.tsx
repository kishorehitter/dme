import React from 'react';
import { NavigationContainer, DefaultTheme, CommonActions, useNavigation } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  LoginScreen,
  RegisterScreen,
  OTPVerifyScreen,
  ChatListScreen,
  ChatRoomScreen,
  NewChatScreen,
  CreateGroupScreen,
  GroupInfoScreen,
  ProfileScreen,
  ProfileSetupScreen,
  CallScreen,
  IncomingCallScreen,
  StatusTabScreen,
  CallLogTabScreen,
} from '../screens/index';
import StatusViewer from '../components/StatusViewer';
import StatusEditorScreen from '../screens/StatusEditorScreen';
import GoogleLoginScreen from '../screens/GoogleLoginScreen';
import Icon from 'react-native-vector-icons/Ionicons';
import { colors, spacing } from '../utils/theme';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const MyTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: '#8100D1',
    background: '#FFFFFF',
    card: '#FFFFFF',
    text: '#000000',
    border: '#E0E0E0',
    notification: '#8100D1',
  },
};

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ color, size }) => {
        let iconName = 'chatbubble';
        if (route.name === 'Chats')  iconName = 'chatbubble';
        else if (route.name === 'Status') iconName = 'ellipse-outline';
        else if (route.name === 'Calls')  iconName = 'call';
        return <Icon name={iconName} size={size} color={color} />;
      },
      tabBarActiveTintColor: '#8100D1',
      tabBarInactiveTintColor: 'gray',
    })}
  >
    <Tab.Screen name="Chats"  component={ChatListScreen}  options={{ headerShown: false }} />
    <Tab.Screen name="Status" component={StatusTabScreen} />
    <Tab.Screen name="Calls"  component={CallLogTabScreen} />
  </Tab.Navigator>
);

interface HeaderRightIconsProps {
  logout: () => void;
}

const HeaderRightIcons: React.FC<HeaderRightIconsProps> = ({ logout }) => {
  const navigation = useNavigation<any>();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: spacing.md }}>
      <TouchableOpacity
        onPress={() => navigation.navigate('StatusEditor')}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: '#fff',
          borderWidth: 2,
          borderColor: '#8100D1',
          justifyContent: 'center',
          alignItems: 'center',
          marginRight: 15,
          elevation: 2,
          shadowColor: '#8100D1',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
        }}
      >
        <Icon name="add" size={18} color="#8100D1" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          Alert.alert('Options', undefined, [
            {
              text: 'Profile',
              onPress: () => navigation.navigate('Profile'),
            },
            {
              text: 'Logout',
              style: 'destructive',
              onPress: () => logout(),
            },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
      >
        <Icon name="ellipsis-vertical" size={24} color="#8100D1" />
      </TouchableOpacity>
    </View>
  );
};

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Login"       component={LoginScreen} />
    <Stack.Screen name="Register"    component={RegisterScreen} />
    <Stack.Screen name="OTPVerify"   component={OTPVerifyScreen} />
    <Stack.Screen name="GoogleLogin" component={GoogleLoginScreen} />
  </Stack.Navigator>
);

interface ChatStackProps {
  logout: () => void;
}

const ChatStack: React.FC<ChatStackProps> = ({ logout }) => {
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
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image
                source={require('../assets/logo.png')}
                style={{ width: 40, height: 40, borderRadius: 16, marginRight: 2}}
              />
              <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#8212c7' }}>DME</Text>
            </View>
          ),
          headerRight: () => <HeaderRightIcons logout={handleLogout} />,
        }}
      />
      <Stack.Screen name="ChatRoom"     component={ChatRoomScreen}     options={{ headerShown: false }} />
      <Stack.Screen name="Call"         component={CallScreen}         options={{ headerShown: false }} />
      <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
      <Stack.Screen name="NewChat"      component={NewChatScreen}      options={{ title: 'New Chat' }} />
      <Stack.Screen name="CreateGroup"  component={CreateGroupScreen}  options={{ title: 'New Group' }} />
      <Stack.Screen name="GroupInfo"    component={GroupInfoScreen}    options={{ title: 'Group Info' }} />
      <Stack.Screen name="Profile"      component={ProfileScreen}      options={{ title: 'Profile' }} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StatusViewer" component={StatusViewer}       options={{ headerShown: false }} />
      <Stack.Screen name="StatusEditor" component={StatusEditorScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

interface AppNavigatorProps {
  setNavigationRef: (ref: any) => void;
  onNavigatorReady?: () => void;
}

const AppNavigator: React.FC<AppNavigatorProps> = ({
  setNavigationRef,
  onNavigatorReady,
}) => {
  const { isAuthenticated, isLoading, logout, user } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const navKey = isAuthenticated
    ? user?.is_profile_complete ? 'chat-stack' : 'profile-setup-stack'
    : 'auth-stack';

  return (
    <NavigationContainer
      key={navKey}
      ref={setNavigationRef}
      onReady={onNavigatorReady}
      independent={true}
      theme={MyTheme}
    >
      {isAuthenticated ? (
        user && !user.is_profile_complete ? (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
          </Stack.Navigator>
        ) : (
          <ChatStack logout={logout} />
        )
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
});

export default AppNavigator;