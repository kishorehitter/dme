import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from '../services/api';
import { websocketService } from '../services/websocket';
import fcmService from '../services/fcm';
import { User, AuthTokens, LoginCredentials, RegisterData, OTPVerify } from '../types';
import localDatabase from '../services/LocalDatabase';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  googleLogin: (idToken: string) => Promise<void>;
  register: (data: RegisterData) => Promise<{ message: string; email: string }>;
  verifyOTP: (data: OTPVerify) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  requestOTP: (email: string) => Promise<{ message: string }>;
  updateProfile: (data: Partial<RegisterData>) => Promise<void>;
  refreshUser: () => Promise<void>;
  completeProfileSetup: (formData: FormData) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize FCM on app start
    fcmService.initialize();
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const [userJson, accessToken] = await AsyncStorage.multiGet(['user', 'access_token']);
      
      if (userJson[1] && accessToken[1]) {
        setUser(JSON.parse(userJson[1]));
      }
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (credentials: LoginCredentials) => {
    try {
      const response = await authAPI.login(credentials);
      await AsyncStorage.multiSet([
        ['access_token', response.access_token],
        ['refresh_token', response.refresh_token],
        ['user', JSON.stringify(response.user)],
      ]);
      websocketService.reset(); // Reset WebSocket state for new login
      localDatabase.clearAll(); // Clear old cached data for new session
      setUser(response.user);
      // Re-register FCM device after successful login
      await fcmService.registerDevice();
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.response?.data?.error || 'Login failed');
    }
  };

  const googleLogin = async (idToken: string) => {
    try {
      const response = await authAPI.googleLogin(idToken);
      await AsyncStorage.multiSet([
        ['access_token', response.access_token],
        ['refresh_token', response.refresh_token],
        ['user', JSON.stringify(response.user)],
      ]);
      websocketService.reset(); // Reset WebSocket state for new login
      localDatabase.clearAll(); // Clear old cached data for new session
      setUser(response.user);
      // Re-register FCM device after successful login
      await fcmService.registerDevice();
      return response.user;
    } catch (error: any) {
      console.error('[AuthContext] Google login error:', error);
      console.error('[AuthContext] Error response:', error.response?.data);
      console.error('[AuthContext] Error status:', error.response?.status);
      throw new Error(error.response?.data?.message || error.response?.data?.error || error.message || 'Google login failed');
    }
  };

  const register = async (data: RegisterData): Promise<{ message: string; email: string }> => {
    try {
      const response = await authAPI.register(data);
      return response;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Registration failed');
    }
  };

  const verifyOTP = async (data: OTPVerify) => {
    try {
      const response = await authAPI.verifyOTP(data);
      await AsyncStorage.multiSet([
        ['access_token', response.access_token],
        ['refresh_token', response.refresh_token],
        ['user', JSON.stringify(response.user)],
      ]);
      websocketService.reset(); // Reset WebSocket state for new login
      localDatabase.clearAll(); // Clear old cached data for new session
      setUser(response.user);
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'OTP verification failed');
    }
  };

  const logout = async () => {
    try {
      const refreshToken = await AsyncStorage.getItem('refresh_token');
      if (refreshToken) {
        await authAPI.logout(refreshToken).catch(() => {
          // Ignore backend logout errors - still proceed with local logout
          // Token may already be invalid or blacklisted
        });
      }
    } finally {
      // Unregister FCM device before logging out
      await fcmService.unregisterDevice();
      websocketService.disconnectPermanently(); // Stop WebSocket reconnection
      await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']);
      localDatabase.clearAll(); // Clear old cached data
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await authAPI.deleteAccount();
    } finally {
      // Clean up local session regardless of backend success
      await fcmService.unregisterDevice();
      websocketService.disconnectPermanently();
      await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']);
      localDatabase.clearAll(); // Clear old cached data
      setUser(null);
    }
  };

  const requestOTP = async (email: string): Promise<{ message: string }> => {
    try {
      const response = await authAPI.requestOTP(email);
      return response;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to send OTP');
    }
  };

  const updateProfile = async (data: Partial<RegisterData>) => {
    try {
      const updatedUser = await authAPI.updateProfile(data);
      setUser(updatedUser);
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Profile update failed');
    }
  };

  const refreshUser = async () => {
    try {
      const updatedUser = await authAPI.getProfile();
      setUser(updatedUser);
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const completeProfileSetup = async (formData: FormData) => {
    try {
      const updatedUser = await authAPI.completeProfileSetup(formData);
      setUser(updatedUser);
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    } catch (error: any) {
      let errorMessage = 'Profile setup failed';
      if (error.response?.data) {
        if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (error.response.data.detail) {
          errorMessage = error.response.data.detail;
        } else {
          const keys = Object.keys(error.response.data);
          if (keys.length > 0) {
            const firstError = error.response.data[keys[0]];
            errorMessage = Array.isArray(firstError) ? `${keys[0]}: ${firstError[0]}` : `${keys[0]}: ${firstError}`;
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(errorMessage);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        googleLogin,
        register,
        verifyOTP,
        logout,
        deleteAccount,
        requestOTP,
        updateProfile,
        refreshUser,
        completeProfileSetup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
