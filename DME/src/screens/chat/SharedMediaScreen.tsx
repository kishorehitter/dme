import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, Text, TouchableOpacity, Image, Linking, Dimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/network';
import { colors, spacing, fontSize, borderRadius } from '../../utils/theme';
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveImageUrl } from '../../utils/image';

const { width } = Dimensions.get('window');
const GRID_SIZE = width / 3;

const TABS = [
  { key: 'image', label: 'Images', icon: 'image-outline' },
  { key: 'video', label: 'Videos', icon: 'videocam-outline' },
  { key: 'audio', label: 'Audio', icon: 'mic-outline' },
  { key: 'document', label: 'Docs', icon: 'document-text-outline' },
];

const SharedMediaScreen: React.FC = () => {
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

  const renderGridItem = ({ item }: { item: any }) => {
    const url = resolveImageUrl(item.media_url || item.media_file);
    return (
      <TouchableOpacity 
        style={styles.gridItem} 
        onPress={() => navigation.navigate('MediaViewer', { mediaUrl: url, mediaType: activeTab })}
      >
        {activeTab === 'image' ? (
          <Image source={{ uri: url }} style={styles.mediaImage} />
        ) : (
          <View style={styles.mediaPlaceholder}>
            <Icon name="play-circle-outline" size={40} color="#fff" style={styles.playIcon} />
            <View style={styles.videoOverlay} />
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
        style={styles.listItem} 
        onPress={() => {
            // Navigate to ChatRoom and jump to this message
            navigation.navigate('ChatRoom', { 
                conversationId: conversationId,
                scrollToMessageId: item.id 
            });
        }}
      >
        <View style={[styles.listIconContainer, activeTab === 'audio' ? styles.audioIconBg : styles.docIconBg]}>
          <Icon name={activeTab === 'audio' ? 'mic' : 'document-text'} size={24} color="#fff" />
        </View>
        <View style={styles.listTextContainer}>
          <Text style={styles.listFileName} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.listDate}>{date}</Text>
        </View>
        <Icon name="chevron-forward" size={20} color="#ccc" />
      </TouchableOpacity>
    );
  };

  const isGridLayout = activeTab === 'image' || activeTab === 'video';

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.activeTab]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Icon name={tab.icon} size={20} color={activeTab === tab.key ? colors.primary : '#888'} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      ) : (
        <FlatList
          key={isGridLayout ? 'grid' : 'list'}
          data={media}
          numColumns={isGridLayout ? 3 : 1}
          keyExtractor={item => item.id.toString()}
          renderItem={isGridLayout ? renderGridItem : renderListItem}
          contentContainerStyle={media.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyView}>
              <Icon name="folder-open-outline" size={64} color="#ddd" />
              <Text style={styles.emptyText}>No {activeTab}s shared yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 12, color: '#888', marginTop: 4 },
  activeTabText: { color: colors.primary, fontWeight: '600' },
  
  // Grid Styles
  gridItem: { width: GRID_SIZE, height: GRID_SIZE, padding: 1 },
  mediaImage: { width: '100%', height: '100%' },
  mediaPlaceholder: { flex: 1, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)' },
  playIcon: { position: 'absolute', zIndex: 1 },

  // List Styles
  listContent: { paddingVertical: spacing.sm },
  listItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: spacing.md, 
    borderBottomWidth: 1, 
    borderBottomColor: '#f5f5f5' 
  },
  listIconContainer: { 
    width: 44, 
    height: 44, 
    borderRadius: 8, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: spacing.md 
  },
  audioIconBg: { backgroundColor: colors.primary },
  docIconBg: { backgroundColor: '#FF9800' },
  listTextContainer: { flex: 1 },
  listFileName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: '500' },
  listDate: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Empty State
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyView: { alignItems: 'center', marginTop: -100 },
  emptyText: { marginTop: 16, fontSize: fontSize.md, color: '#aaa' }
});

export default SharedMediaScreen;