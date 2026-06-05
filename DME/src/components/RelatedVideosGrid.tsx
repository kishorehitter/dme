import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, FlatList } from 'react-native';
import { Song } from '../hooks/useMusicRoom';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 40) / 2;

interface Props {
  videos: Song[];
  onSelect: (song: Song) => void;
}

const RelatedVideosGrid: React.FC<Props> = ({ videos, onSelect }) => {
  // Split into 3 pages of 4 videos each (2x2)
  const pages = [
    videos.slice(0, 4),
    videos.slice(4, 8),
    videos.slice(8, 12),
  ];

  return (
    <View style={styles.container}>
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={pages}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item: pageVideos }) => (
          <View style={styles.page}>
            <View style={styles.grid}>
              {pageVideos.map((video) => (
                <TouchableOpacity key={video.videoId} style={styles.videoItem} onPress={() => onSelect(video)}>
                  <Image source={{ uri: video.thumbnail }} style={styles.thumbnail} />
                  <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 0 },
  page: { width: width },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: 0 },
  videoItem: { width: ITEM_WIDTH, gap: 0 },
  thumbnail: { width: ITEM_WIDTH, height: ITEM_WIDTH * 0.44, borderRadius: 6 },
  videoTitle: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});

export default RelatedVideosGrid;
