import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Switch,
  FlatList,
  TextInput,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeMode } from '../../context/ThemeContext';
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { getApiUrl } from '../../config/network';
import { checkForUpdate } from '../../services/updateChecker';
import { downloadAndInstallAPK } from '../../services/updateDownloader';
import DeviceInfo from 'react-native-device-info';

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { theme, isDark, themeMode, setThemeMode } = useTheme();
  
  const LAST_SEEN_KEY = `settings_last_seen_${user?.id || 'default'}`;
  const BLOCKED_USERS_KEY = `settings_blocked_users_${user?.id || 'default'}`;

  const [currentView, setCurrentView] = useState<'main' | 'privacy' | 'storage' | 'about' | 'blocklist' | 'appearance'>('main');
  
  // Privacy States
  const [lastSeen, setLastSeen] = useState<'everyone' | 'nobody'>('everyone');
  const [blockedUsers, setBlockedUsers] = useState<{ id: string; name: string }[]>([]);
  const [blockSearchQuery, setBlockSearchQuery] = useState('');
  const [blockSearchResults, setBlockSearchResults] = useState<{ id: string; name: string; username: string }[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  
  // Storage States
  const [cacheSize, setCacheSize] = useState('0 KB');
  const [isClearing, setIsClearing] = useState(false);
  
  // Update States
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // About Modal States
  const [modalText, setModalText] = useState<{ title: string; content: string } | null>(null);

  // Load Settings
  useEffect(() => {
    if (user?.id) {
      loadSettings();
    }
    calculateCacheSize();
  }, [user?.id]);

  const loadSettings = async () => {
    try {
      const storedLastSeen = await AsyncStorage.getItem(LAST_SEEN_KEY);
      if (storedLastSeen) {
        setLastSeen(storedLastSeen as 'everyone' | 'nobody');
      }

      // Sync settings from server dynamically
      const profile = await authAPI.getProfile();
      if (profile && profile.last_seen_privacy) {
        setLastSeen(profile.last_seen_privacy);
        await AsyncStorage.setItem(LAST_SEEN_KEY, profile.last_seen_privacy);
      }

      const storedBlocked = await AsyncStorage.getItem(BLOCKED_USERS_KEY);
      if (storedBlocked) {
        setBlockedUsers(JSON.parse(storedBlocked));
      } else {
        setBlockedUsers([]);
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  };

  const handleLastSeenChange = async (value: 'everyone' | 'nobody') => {
    try {
      setLastSeen(value);
      await AsyncStorage.setItem(LAST_SEEN_KEY, value);
      // Update setting on Django backend dynamically!
      await authAPI.updateProfile({ last_seen_privacy: value } as any);
    } catch (e) {
      console.warn('Failed to save last seen privacy setting to backend', e);
    }
  };

  // Block List Logic
  useEffect(() => {
    if (blockSearchQuery.trim().length > 0) {
      const delayDebounce = setTimeout(() => {
        performUserSearch(blockSearchQuery);
      }, 500);
      return () => clearTimeout(delayDebounce);
    } else {
      setBlockSearchResults([]);
    }
  }, [blockSearchQuery]);

  const performUserSearch = async (query: string) => {
    try {
      setIsSearchingUsers(true);
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`chat/users/search/?q=${encodeURIComponent(query)}`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        const formatted = data.map((u: any) => ({
          id: u.id.toString(),
          name: u.display_name || u.username || u.email || 'User',
          username: u.username,
        }));
        setBlockSearchResults(formatted);
      }
    } catch (e) {
      console.warn('Search users to block failed', e);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  const handleBlockUserById = async (userId: string, name: string) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const response = await fetch(
        getApiUrl(`accounts/users/${userId}/block/`),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ blocked: true }),
        }
      );

      if (response.ok) {
        const updatedList = [...blockedUsers];
        if (!updatedList.some(u => u.id === userId)) {
          updatedList.push({ id: userId, name });
        }
        setBlockedUsers(updatedList);
        await AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(updatedList));
        setBlockSearchQuery('');
        setBlockSearchResults([]);
        Alert.alert('Blocked', `${name} has been blocked.`);
      } else {
        Alert.alert('Error', 'Failed to block user on the server.');
      }
    } catch (e) {
      console.warn(e);
      Alert.alert('Error', 'Failed to block user.');
    }
  };

  const handleUnblockUser = async (id: string, name: string) => {
    Alert.alert('Unblock User', `Are you sure you want to unblock ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          try {
            const token = await AsyncStorage.getItem('access_token');
            const response = await fetch(
              getApiUrl(`accounts/users/${id}/block/`),
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ blocked: false }),
              }
            );

            if (response.ok) {
              const updatedList = blockedUsers.filter(u => u.id !== id);
              setBlockedUsers(updatedList);
              await AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(updatedList));
              Alert.alert('Unblocked', `${name} has been unblocked.`);
            } else {
              Alert.alert('Error', 'Failed to unblock user on the server.');
            }
          } catch (e) {
            console.warn(e);
            Alert.alert('Error', 'Failed to unblock user.');
          }
        },
      },
    ]);
  };

  const getDirSize = async (dirPath: string): Promise<number> => {
    let totalSize = 0;
    try {
      const files = await RNFS.readDir(dirPath);
      for (const file of files) {
        if (file.isFile()) {
          totalSize += Number(file.size || 0);
        } else if (file.isDirectory()) {
          totalSize += await getDirSize(file.path);
        }
      }
    } catch (e) {
      // ignore read errors on protected system files
    }
    return totalSize;
  };

  // Storage Logic
  const calculateCacheSize = async () => {
    try {
      const cachePath = RNFS.CachesDirectoryPath;
      const exists = await RNFS.exists(cachePath);
      if (!exists) {
        setCacheSize('0 KB');
        return;
      }
      const size = await getDirSize(cachePath);
      if (size === 0) {
        setCacheSize('0 KB');
      } else if (size < 1024 * 1024) {
        setCacheSize((size / 1024).toFixed(1) + ' KB');
      } else {
        setCacheSize((size / (1024 * 1024)).toFixed(1) + ' MB');
      }
    } catch (e) {
      setCacheSize('0 KB');
    }
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'Are you sure you want to clear all cached media?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsClearing(true);
            const cachePath = RNFS.CachesDirectoryPath;
            const exists = await RNFS.exists(cachePath);
            if (exists) {
              const files = await RNFS.readDir(cachePath);
              for (const file of files) {
                // Avoid deleting system files if any, delete downloads/media files
                await RNFS.unlink(file.path).catch(() => {});
              }
            }
            await calculateCacheSize();
            Alert.alert('Cleared', 'Cached media files deleted successfully.');
          } catch (e) {
            Alert.alert('Error', 'Failed to clear cache.');
          } finally {
            setIsClearing(false);
          }
        },
      },
    ]);
  };

  // Update Check Logic
  const handleCheckUpdate = async () => {
    try {
      setIsCheckingUpdate(true);
      const update = await checkForUpdate();
      setIsCheckingUpdate(false);
      
      if (update.hasUpdate && update.downloadUrl) {
        Alert.alert(
          'Update Available',
          `A new version (${update.latestVersion}) is available. Would you like to download and install it now?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Install',
              onPress: () => startAppDownload(update.downloadUrl!),
            },
          ]
        );
      } else {
        Alert.alert('Up to Date', `You are on the latest version of DME (${DeviceInfo.getVersion()}).`);
      }
    } catch (e) {
      setIsCheckingUpdate(false);
      Alert.alert('Error', 'Failed to check for updates.');
    }
  };

  const startAppDownload = async (url: string) => {
    try {
      setIsDownloadingUpdate(true);
      setDownloadProgress(0);
      await downloadAndInstallAPK(url, (received, total) => {
        if (total > 0) {
          setDownloadProgress(Math.round((received / total) * 100));
        }
      });
    } catch (error) {
      Alert.alert('Download Failed', 'Failed to download the update package.');
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  const handleLogoutPress = () => {
    Alert.alert('Logout', 'Are you sure you want to logout of your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  // Nav Header helpers
  const goBack = () => {
    if (currentView === 'main') {
      navigation.goBack();
    } else if (currentView === 'blocklist') {
      setCurrentView('privacy');
    } else {
      setCurrentView('main');
    }
  };

  const getTitle = () => {
    switch (currentView) {
      case 'privacy': return 'Privacy Settings';
      case 'storage': return 'Storage & Cache';
      case 'about': return 'About DME';
      case 'blocklist': return 'Block List';
      case 'appearance': return 'Appearance';
      default: return 'Settings';
    }
  };

  // ─── Appearance (Dark Mode) View ──────────────────────────────────────────────
  const renderAppearanceSettings = () => {
    const options: { label: string; value: ThemeMode; icon: string; description: string }[] = [
      { label: 'Light', value: 'light', icon: 'sunny-outline', description: 'Always use light theme' },
      { label: 'Dark', value: 'dark', icon: 'moon-outline', description: 'Always use dark theme' },
      { label: 'System default', value: 'system', icon: 'phone-portrait-outline', description: 'Follow device theme setting' },
    ];

    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={[dynamicStyles(theme).section, { marginTop: spacing.md }]}>
          <Text style={dynamicStyles(theme).sectionHeader}>Theme</Text>
          {options.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={dynamicStyles(theme).selectableItem}
              onPress={() => setThemeMode(opt.value)}
            >
              <View style={dynamicStyles(theme).itemLeft}>
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: isDark ? '#2a3942' : '#f0f0f0',
                  alignItems: 'center', justifyContent: 'center', marginRight: 4,
                }}>
                  <Icon name={opt.icon} size={22} color={theme.primary} />
                </View>
                <View style={{ marginLeft: 8 }}>
                  <Text style={dynamicStyles(theme).itemText}>{opt.label}</Text>
                  <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 1 }}>{opt.description}</Text>
                </View>
              </View>
              {themeMode === opt.value && (
                <Icon name="checkmark-circle" size={22} color={theme.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Live preview card */}
        <View style={[dynamicStyles(theme).section, { marginTop: spacing.md }]}>
          <Text style={dynamicStyles(theme).sectionHeader}>Preview</Text>
          <View style={[dynamicStyles(theme).item, { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={[
                { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, maxWidth: '70%' },
                { backgroundColor: theme.theirMessage },
              ]}>
                <Text style={{ color: theme.textPrimary, fontSize: 14 }}>Hey! 👋 Looks nice!</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', width: '100%' }}>
              <View style={[
                { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, maxWidth: '70%' },
                { backgroundColor: theme.myMessage },
              ]}>
                <Text style={{ color: isDark ? '#e9edef' : '#1a1a1a', fontSize: 14 }}>Dark mode activated 🌙</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  // Render Sub Views
  const renderMainSettings = () => (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Account & Privacy</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={() => setCurrentView('privacy')}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="lock-closed-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Privacy</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Appearance</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={() => setCurrentView('appearance')}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name={isDark ? 'moon' : 'sunny'} size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Dark Mode</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, color: theme.textMuted, textTransform: 'capitalize' }}>
              {themeMode === 'system' ? 'System' : themeMode === 'dark' ? 'Dark' : 'Light'}
            </Text>
            <Icon name="chevron-forward" size={18} color={theme.textMuted} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Data & Storage</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={() => setCurrentView('storage')}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="server-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Storage</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Information</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={() => setCurrentView('about')}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="information-circle-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>About</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={[dynamicStyles(theme).section, { marginTop: spacing.xl }]}>
        <TouchableOpacity style={[dynamicStyles(theme).item, dynamicStyles(theme).logoutItem]} onPress={handleLogoutPress}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="log-out-outline" size={22} color="#FF3B30" />
            <Text style={[dynamicStyles(theme).itemText, { color: '#FF3B30', fontWeight: 'bold' }]}>Logout</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderPrivacySettings = () => (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Last Seen Settings</Text>
        <TouchableOpacity 
          style={dynamicStyles(theme).selectableItem} 
          onPress={() => handleLastSeenChange('everyone')}
        >
          <Text style={[dynamicStyles(theme).itemText, lastSeen === 'everyone' && { color: theme.primary, fontWeight: '600' }]}>Everyone</Text>
          {lastSeen === 'everyone' && <Icon name="checkmark" size={20} color={theme.primary} />}
        </TouchableOpacity>
        <TouchableOpacity 
          style={dynamicStyles(theme).selectableItem} 
          onPress={() => handleLastSeenChange('nobody')}
        >
          <Text style={[dynamicStyles(theme).itemText, lastSeen === 'nobody' && { color: theme.primary, fontWeight: '600' }]}>Nobody</Text>
          {lastSeen === 'nobody' && <Icon name="checkmark" size={20} color={theme.primary} />}
        </TouchableOpacity>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Contacts</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={() => setCurrentView('blocklist')}>
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="ban-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Block List ({blockedUsers.length})</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderBlockList = () => (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[dynamicStyles(theme).addBlockRow]}>
        <TextInput
          style={[dynamicStyles(theme).blockInput]}
          placeholder="Search user to block..."
          placeholderTextColor={theme.placeholder}
          value={blockSearchQuery}
          onChangeText={setBlockSearchQuery}
        />
        {blockSearchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setBlockSearchQuery(''); setBlockSearchResults([]); }} style={{ justifyContent: 'center' }}>
            <Icon name="close-circle" size={20} color={theme.textMuted} style={{ marginRight: 8 }} />
          </TouchableOpacity>
        )}
      </View>

      {isSearchingUsers ? (
        <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 24 }} />
      ) : blockSearchQuery.length > 0 ? (
        <FlatList
          data={blockSearchResults}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md }}
          ListEmptyComponent={
            <View style={dynamicStyles(theme).emptyContainer}>
              <Icon name="search-outline" size={48} color={theme.border} />
              <Text style={dynamicStyles(theme).emptyText}>No matching users found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={dynamicStyles(theme).blockListItem}>
              <View style={dynamicStyles(theme).itemLeft}>
                <Icon name="person-circle-outline" size={32} color={theme.icon} style={{ marginRight: 12 }} />
                <View>
                  <Text style={dynamicStyles(theme).itemText}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: theme.textMuted, marginLeft: 12 }}>@{item.username}</Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[dynamicStyles(theme).unblockButton, { borderColor: '#FF3B30' }]} 
                onPress={() => handleBlockUserById(item.id, item.name)}
              >
                <Text style={[dynamicStyles(theme).unblockText, { color: '#FF3B30' }]}>Block</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md }}
          ListEmptyComponent={
            <View style={dynamicStyles(theme).emptyContainer}>
              <Icon name="shield-checkmark-outline" size={48} color={theme.border} />
              <Text style={dynamicStyles(theme).emptyText}>No blocked users</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={dynamicStyles(theme).blockListItem}>
              <View style={dynamicStyles(theme).itemLeft}>
                <Icon name="person-circle-outline" size={32} color={theme.icon} style={{ marginRight: 12 }} />
                <Text style={dynamicStyles(theme).itemText}>{item.name}</Text>
              </View>
              <TouchableOpacity 
                style={dynamicStyles(theme).unblockButton} 
                onPress={() => handleUnblockUser(item.id, item.name)}
              >
                <Text style={dynamicStyles(theme).unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );

  const renderStorageSettings = () => (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Cache Info</Text>
        <View style={[dynamicStyles(theme).item, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <Text style={dynamicStyles(theme).itemText}>Cached Media Size</Text>
          <Text style={{ fontSize: 16, color: theme.textSecondary, fontWeight: '500' }}>{cacheSize}</Text>
        </View>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Actions</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={handleClearCache} disabled={isClearing}>
          <View style={dynamicStyles(theme).itemLeft}>
            {isClearing ? (
              <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 10 }} />
            ) : (
              <Icon name="trash-bin-outline" size={22} color="#FF3B30" />
            )}
            <Text style={[dynamicStyles(theme).itemText, { color: '#FF3B30' }]}>Clear Cached Media</Text>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderAboutSettings = () => (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[dynamicStyles(theme).aboutHeader]}>
        <Image
          source={require('../../assets/logo.png')}
          style={dynamicStyles(theme).aboutLogo}
        />
        <Text style={dynamicStyles(theme).aboutTitle}>DME Messenger</Text>
        <Text style={dynamicStyles(theme).aboutSubtitle}>Version {DeviceInfo.getVersion()}</Text>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>App Updates</Text>
        <TouchableOpacity style={dynamicStyles(theme).item} onPress={handleCheckUpdate} disabled={isCheckingUpdate}>
          <View style={dynamicStyles(theme).itemLeft}>
            {isCheckingUpdate ? (
              <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 10 }} />
            ) : (
              <Icon name="cloud-download-outline" size={22} color={theme.primary} />
            )}
            <Text style={dynamicStyles(theme).itemText}>Check for update</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={dynamicStyles(theme).section}>
        <Text style={dynamicStyles(theme).sectionHeader}>Legal</Text>
        <TouchableOpacity 
          style={dynamicStyles(theme).item} 
          onPress={() => setModalText({
            title: 'Privacy Policy',
            content: 'DME Messenger is dedicated to securing your privacy. End-to-end encryption is used where available to protect personal calls and messages. Storage is kept locally, and cached files are automatically cleared upon request.'
          })}
        >
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="document-text-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Privacy Policy</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={dynamicStyles(theme).item} 
          onPress={() => setModalText({
            title: 'Terms of Service',
            content: 'By accessing DME Messenger, you agree to comply with all laws regarding online communications. Spamming, scraping, and abusive behavior will result in account suspension.'
          })}
        >
          <View style={dynamicStyles(theme).itemLeft}>
            <Icon name="reader-outline" size={22} color={theme.primary} />
            <Text style={dynamicStyles(theme).itemText}>Terms of Service</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <View style={[dynamicStyles(theme).container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={dynamicStyles(theme).header}>
        <TouchableOpacity style={dynamicStyles(theme).backButton} onPress={goBack}>
          <Icon name="arrow-back" size={24} color={theme.headerTint} />
        </TouchableOpacity>
        <Text style={dynamicStyles(theme).headerTitle}>{getTitle()}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Dynamic View rendering */}
      {currentView === 'main' && renderMainSettings()}
      {currentView === 'privacy' && renderPrivacySettings()}
      {currentView === 'blocklist' && renderBlockList()}
      {currentView === 'storage' && renderStorageSettings()}
      {currentView === 'about' && renderAboutSettings()}
      {currentView === 'appearance' && renderAppearanceSettings()}

      {/* Policy Text Modal */}
      <Modal visible={modalText !== null} transparent animationType="fade">
        <View style={dynamicStyles(theme).modalOverlay}>
          <View style={dynamicStyles(theme).modalContent}>
            <Text style={dynamicStyles(theme).modalTitle}>{modalText?.title}</Text>
            <ScrollView style={{ maxHeight: 300, marginBottom: 20 }}>
              <Text style={dynamicStyles(theme).modalBody}>{modalText?.content}</Text>
            </ScrollView>
            <TouchableOpacity style={dynamicStyles(theme).modalCloseBtn} onPress={() => setModalText(null)}>
              <Text style={dynamicStyles(theme).modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Downloader progress Modal */}
      <Modal visible={isDownloadingUpdate} transparent animationType="fade">
        <View style={dynamicStyles(theme).modalOverlay}>
          <View style={dynamicStyles(theme).modalContent}>
            <ActivityIndicator size="large" color={theme.primary} style={{ marginBottom: 16 }} />
            <Text style={dynamicStyles(theme).modalTitle}>Downloading Update</Text>
            <Text style={{ fontSize: 14, color: theme.textSecondary, marginBottom: 16, textAlign: 'center' }}>
              Please wait while the new version is being downloaded...
            </Text>
            <View style={{
              width: '100%',
              height: 6,
              backgroundColor: theme.border,
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 8,
            }}>
              <View style={{
                width: `${downloadProgress}%`,
                height: '100%',
                backgroundColor: theme.primary,
              }} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.primary }}>
              {downloadProgress}%
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// Dynamic styles factory — called inside components with the live theme
const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  section: {
    marginTop: spacing.md,
    backgroundColor: theme.surface,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: theme.background,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  logoutItem: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.borderLight,
  },
  selectableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemText: {
    fontSize: 16,
    color: theme.textPrimary,
    marginLeft: 12,
  },
  aboutHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },
  aboutLogo: {
    width: 70,
    height: 70,
    borderRadius: 20,
    marginBottom: 12,
  },
  aboutTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  aboutSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 4,
  },
  addBlockRow: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },
  blockInput: {
    flex: 1,
    backgroundColor: theme.inputBackground,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 15,
    color: theme.inputText,
    marginRight: 12,
  },
  blockListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  unblockText: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: theme.modalBackground,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
  },
  modalCloseBtn: {
    width: '100%',
    backgroundColor: theme.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});

// Keep a static StyleSheet for scroll (flex: 1 only, no color)
const styles = StyleSheet.create({
  scroll: { flex: 1 },
});
