import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, Text, TouchableOpacity, Image, Linking, Dimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/network';
import { colors, spacing, fontSize, borderRadius } from '../../utils/theme';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../../utils/image';
import { useTheme } from '../../context/ThemeContext';

const { width } = Dimensions.get('window');
const GRID_SIZE = width / 3;

const TABS = [
  { key: 'image', label: 'Images', icon: 'image-outline' },
  { key: 'video', label: 'Videos', icon: 'videocam-outline' },
  { key: 'audio', label: 'Audio', icon: 'mic-outline' },
  { key: 'document', label: 'Docs', icon: 'document-text-outline' },
];

const SharedMediaScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { conversationId, otherUserId } = route.params as { conversationId: number, otherUserId: number };
  
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  const [media, setMedia] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchMedia = useCallback(async () => {
    if (!conversationId) {
      console.warn('DEBUG: No conversationId provided to SharedMediaScreen');
      return;
    }

    setIsLoading(true);
    try {
      const token = await AsyncStorage.getItem('access_token');
      // Show all media in the conversation (standard behavior)
      // Removed sender_id filter to ensure the screen isn't empty if the other user hasn't sent media yet
      let url = getApiUrl(`chat/conversations/${conversationId}/media/?type=${activeTab}`);
      
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      
      if (response.ok) {
        const results = await response.json();
        setMedia(results);
      } else {
        console.error('DEBUG: Fetch failed with status:', response.status);
      }
    } catch (err) {
      console.error('DEBUG: Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, activeTab]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const renderGridItem = ({ item, index }: { item: any; index: number }) => {
    const url = resolveImageUrl(item.media_url || item.media_file);
    const mediaList = media.map(m => ({
      mediaUrl: resolveImageUrl(m.media_url || m.media_file),
      mediaType: activeTab as 'image' | 'video',
      id: m.id,
      caption: m.content || '',
    }));
    return (
      <TouchableOpacity 
        style={s.gridItem} 
        onPress={() => navigation.navigate('MediaViewer', { 
          mediaUrl: url, 
          mediaType: activeTab,
          mediaList,
          initialIndex: index,
        })}
      >
        {activeTab === 'image' ? (
          <Image source={{ uri: url }} style={s.mediaImage} />
        ) : (
          <View style={s.mediaPlaceholder}>
            <Icon name="play-circle-outline" size={40} color="#fff" style={s.playIcon} />
            <View style={s.videoOverlay} />
            {/* If we had thumbnails, we'd show them here */}
            <Icon name="videocam" size={30} color="#ccc" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderListItem = ({ item }: { item: any }) => {
    const url = resolveImageUrl(item.media_url || item.media_file);
    const date = new Date(item.created_at).toLocaleDateString();
    const fileName = item.media_file ? item.media_file.split('/').pop() : 'Media File';

    return (
      <TouchableOpacity 
        style={s.listItem} 
        onPress={() => {
            // Navigate to ChatRoom and jump to this message
            navigation.navigate('ChatRoom', { 
                conversationId: conversationId,
                scrollToMessageId: item.id 
            });
        }}
      >
        <View style={[s.listIconContainer, activeTab === 'audio' ? s.audioIconBg : s.docIconBg]}>
          <Icon name={activeTab === 'audio' ? 'mic' : 'document-text'} size={24} color="#fff" />
        </View>
        <View style={s.listTextContainer}>
          <Text style={s.listFileName} numberOfLines={1}>{fileName}</Text>
          <Text style={s.listDate}>{date}</Text>
        </View>
        <Icon name="chevron-forward" size={20} color="#ccc" />
      </TouchableOpacity>
    );
  };

  const isGridLayout = activeTab === 'image' || activeTab === 'video';

  return (
    <View style={s.container}>
      <View style={s.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, activeTab === tab.key && s.activeTab]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Icon name={tab.icon} size={20} color={activeTab === tab.key ? theme.primary : theme.textSecondary} />
            <Text style={[s.tabText, activeTab === tab.key && s.activeTabText]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={theme.primary} />
      ) : (
        <FlatList
          key={isGridLayout ? 'grid' : 'list'}
          data={media}
          numColumns={isGridLayout ? 3 : 1}
          keyExtractor={item => item.id.toString()}
          renderItem={isGridLayout ? ({ item, index }) => renderGridItem({ item, index }) : renderListItem}
          contentContainerStyle={media.length === 0 ? s.emptyContainer : s.listContent}
          ListEmptyComponent={
            <View style={s.emptyView}>
              <Icon name="folder-open-outline" size={64} color="#ddd" />
              <Text style={s.emptyText}>No {activeTab}s shared yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: theme.primary },
  tabText: { fontSize: 12, color: theme.textSecondary, marginTop: 4 },
  activeTabText: { color: theme.primary, fontWeight: '600' },
  
  // Grid Styles
  gridItem: { width: GRID_SIZE, height: GRID_SIZE, padding: 1 },
  mediaImage: { width: '100%', height: '100%' },
  mediaPlaceholder: { flex: 1, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)' },
  playIcon: { position: 'absolute', zIndex: 1 },

  // List Styles
  listContent: { paddingVertical: spacing.sm },
  listItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: spacing.md, 
    borderBottomWidth: 1, 
    borderBottomColor: theme.border 
  },
  listIconContainer: { 
    width: 44, 
    height: 44, 
    borderRadius: 8, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: spacing.md 
  },
  audioIconBg: { backgroundColor: theme.primary },
  docIconBg: { backgroundColor: '#FF9800' },
  listTextContainer: { flex: 1 },
  listFileName: { fontSize: fontSize.md, color: theme.textPrimary, fontWeight: '500' },
  listDate: { fontSize: fontSize.sm, color: theme.textSecondary, marginTop: 2 },

  // Empty State
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyView: { alignItems: 'center', marginTop: -100 },
  emptyText: { marginTop: 16, fontSize: fontSize.md, color: theme.textSecondary }
});

export default SharedMediaScreen;