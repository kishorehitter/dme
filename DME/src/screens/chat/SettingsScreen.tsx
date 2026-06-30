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
import { colors, spacing, borderRadius, fontSize } from '../../utils/theme';
import { getApiUrl } from '../../config/network';
import { checkForUpdate } from '../../services/updateChecker';
import { downloadAndInstallAPK } from '../../services/updateDownloader';

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  
  const LAST_SEEN_KEY = `settings_last_seen_${user?.id || 'default'}`;
  const BLOCKED_USERS_KEY = `settings_blocked_users_${user?.id || 'default'}`;

  const [currentView, setCurrentView] = useState<'main' | 'privacy' | 'storage' | 'about' | 'blocklist'>('main');
  
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
        Alert.alert('Up to Date', 'You are on the latest version of DME (1.0.0).');
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
      default: return 'Settings';
    }
  };

  // Render Sub Views
  const renderMainSettings = () => (
    <ScrollView style={styles.scroll}>
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Account & Privacy</Text>
        <TouchableOpacity style={styles.item} onPress={() => setCurrentView('privacy')}>
          <View style={styles.itemLeft}>
            <Icon name="lock-closed-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>Privacy</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Data & Storage</Text>
        <TouchableOpacity style={styles.item} onPress={() => setCurrentView('storage')}>
          <View style={styles.itemLeft}>
            <Icon name="server-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>Storage</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Information</Text>
        <TouchableOpacity style={styles.item} onPress={() => setCurrentView('about')}>
          <View style={styles.itemLeft}>
            <Icon name="information-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>About</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { marginTop: spacing.xl }]}>
        <TouchableOpacity style={[styles.item, styles.logoutItem]} onPress={handleLogoutPress}>
          <View style={styles.itemLeft}>
            <Icon name="log-out-outline" size={22} color="#FF3B30" />
            <Text style={[styles.itemText, { color: '#FF3B30', fontWeight: 'bold' }]}>Logout</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderPrivacySettings = () => (
    <ScrollView style={styles.scroll}>
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Last Seen Settings</Text>
        <TouchableOpacity 
          style={styles.selectableItem} 
          onPress={() => handleLastSeenChange('everyone')}
        >
          <Text style={[styles.itemText, lastSeen === 'everyone' && styles.selectedText]}>Everyone</Text>
          {lastSeen === 'everyone' && <Icon name="checkmark" size={20} color={colors.primary} />}
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.selectableItem} 
          onPress={() => handleLastSeenChange('nobody')}
        >
          <Text style={[styles.itemText, lastSeen === 'nobody' && styles.selectedText]}>Nobody</Text>
          {lastSeen === 'nobody' && <Icon name="checkmark" size={20} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Contacts</Text>
        <TouchableOpacity style={styles.item} onPress={() => setCurrentView('blocklist')}>
          <View style={styles.itemLeft}>
            <Icon name="ban-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>Block List ({blockedUsers.length})</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderBlockList = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.addBlockRow}>
        <TextInput
          style={styles.blockInput}
          placeholder="Search user to block..."
          placeholderTextColor="#999"
          value={blockSearchQuery}
          onChangeText={setBlockSearchQuery}
        />
        {blockSearchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setBlockSearchQuery(''); setBlockSearchResults([]); }} style={{ justifyContent: 'center' }}>
            <Icon name="close-circle" size={20} color="#888" style={{ marginRight: 8 }} />
          </TouchableOpacity>
        )}
      </View>

      {isSearchingUsers ? (
        <ActivityIndicator size="large" color="#8100D1" style={{ marginTop: 24 }} />
      ) : blockSearchQuery.length > 0 ? (
        <FlatList
          data={blockSearchResults}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.scroll}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="search-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No matching users found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.blockListItem}>
              <View style={styles.itemLeft}>
                <Icon name="person-circle-outline" size={32} color="#888" style={{ marginRight: 12 }} />
                <View>
                  <Text style={styles.itemText}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: '#999', marginLeft: 12 }}>@{item.username}</Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.unblockButton, { borderColor: '#FF3B30' }]} 
                onPress={() => handleBlockUserById(item.id, item.name)}
              >
                <Text style={[styles.unblockText, { color: '#FF3B30' }]}>Block</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.scroll}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="shield-checkmark-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No blocked users</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.blockListItem}>
              <View style={styles.itemLeft}>
                <Icon name="person-circle-outline" size={32} color="#888" style={{ marginRight: 12 }} />
                <Text style={styles.itemText}>{item.name}</Text>
              </View>
              <TouchableOpacity 
                style={styles.unblockButton} 
                onPress={() => handleUnblockUser(item.id, item.name)}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );

  const renderStorageSettings = () => (
    <ScrollView style={styles.scroll}>
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Cache Info</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Cached Media Size</Text>
          <Text style={styles.infoValue}>{cacheSize}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Actions</Text>
        <TouchableOpacity style={styles.item} onPress={handleClearCache} disabled={isClearing}>
          <View style={styles.itemLeft}>
            {isClearing ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
            ) : (
              <Icon name="trash-bin-outline" size={22} color="#FF3B30" />
            )}
            <Text style={[styles.itemText, { color: '#FF3B30' }]}>Clear Cached Media</Text>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderAboutSettings = () => (
    <ScrollView style={styles.scroll}>
      <View style={styles.aboutHeader}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.aboutLogo}
        />
        <Text style={styles.aboutTitle}>DME Messenger</Text>
        <Text style={styles.aboutSubtitle}>Version 1.0.0</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>App Updates</Text>
        <TouchableOpacity style={styles.item} onPress={handleCheckUpdate} disabled={isCheckingUpdate}>
          <View style={styles.itemLeft}>
            {isCheckingUpdate ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
            ) : (
              <Icon name="cloud-download-outline" size={22} color={colors.primary} />
            )}
            <Text style={styles.itemText}>Check for update</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Legal</Text>
        <TouchableOpacity 
          style={styles.item} 
          onPress={() => setModalText({
            title: 'Privacy Policy',
            content: 'DME Messenger is dedicated to securing your privacy. End-to-end encryption is used where available to protect personal calls and messages. Storage is kept locally, and cached files are automatically cleared upon request.'
          })}
        >
          <View style={styles.itemLeft}>
            <Icon name="document-text-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>Privacy Policy</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.item} 
          onPress={() => setModalText({
            title: 'Terms of Service',
            content: 'By accessing DME Messenger, you agree to comply with all laws regarding online communications. Spamming, scraping, and abusive behavior will result in account suspension.'
          })}
        >
          <View style={styles.itemLeft}>
            <Icon name="reader-outline" size={22} color={colors.primary} />
            <Text style={styles.itemText}>Terms of Service</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#999" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Icon name="arrow-back" size={24} color="#8100D1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{getTitle()}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Dynamic View rendering */}
      {currentView === 'main' && renderMainSettings()}
      {currentView === 'privacy' && renderPrivacySettings()}
      {currentView === 'blocklist' && renderBlockList()}
      {currentView === 'storage' && renderStorageSettings()}
      {currentView === 'about' && renderAboutSettings()}

      {/* Policy Text Modal */}
      <Modal visible={modalText !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{modalText?.title}</Text>
            <ScrollView style={{ maxHeight: 300, marginBottom: 20 }}>
              <Text style={styles.modalBody}>{modalText?.content}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalText(null)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Downloader progress Modal */}
      <Modal visible={isDownloadingUpdate} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ActivityIndicator size="large" color="#8100D1" style={{ marginBottom: 16 }} />
            <Text style={styles.modalTitle}>Downloading Update</Text>
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 16, textAlign: 'center' }}>
              Please wait while the new version is being downloaded...
            </Text>
            <View style={{
              width: '100%',
              height: 6,
              backgroundColor: '#eee',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 8,
            }}>
              <View style={{
                width: `${downloadProgress}%`,
                height: '100%',
                backgroundColor: '#8100D1',
              }} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#8100D1' }}>
              {downloadProgress}%
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF7FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8100D1',
  },
  scroll: {
    flex: 1,
  },
  section: {
    marginTop: spacing.md,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: '#FAF7FF',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f6f6f6',
  },
  logoutItem: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  selectableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f6f6f6',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
  },
  selectedText: {
    color: '#8100D1',
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  infoLabel: {
    fontSize: 16,
    color: '#333',
  },
  infoValue: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  aboutHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
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
    color: '#333',
  },
  aboutSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  addBlockRow: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  blockInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 15,
    color: '#333',
    marginRight: 12,
  },
  blockButton: {
    backgroundColor: '#8100D1',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  blockButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  blockListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f6f6f6',
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCCCCC',
  },
  unblockText: {
    color: '#666',
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
    color: '#888',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
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
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    textAlign: 'center',
  },
  modalCloseBtn: {
    width: '100%',
    backgroundColor: '#8100D1',
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
