import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusService, StatusViewer } from '../services/StatusService';

const StatusViewersModal = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { statusId } = route.params;
  const [viewers, setViewers] = useState<StatusViewer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchViewers = async () => {
      const data = await StatusService.getViewers(statusId);
      setViewers(data);
      setLoading(false);
    };
    fetchViewers();
  }, [statusId]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Viewers ({viewers.length})</Text>
      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(item) => String(item.viewer_id)}
          renderItem={({ item }) => (
            <View style={styles.viewerItem}>
              {item.viewer_avatar ? (
                <Image source={{ uri: item.viewer_avatar }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder} />
              )}
              <View>
                <Text style={styles.username}>{item.viewer_username}</Text>
                <Text style={styles.time}>{new Date(item.viewed_at).toLocaleTimeString()}</Text>
              </View>
            </View>
          )}
        />
      )}
      <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.closeText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  viewerItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ccc', marginRight: 10 },
  username: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 12, color: '#888' },
  closeBtn: { marginTop: 20, padding: 10, backgroundColor: '#8100D1', borderRadius: 5, alignItems: 'center' },
  closeText: { color: '#fff', fontWeight: 'bold' },
});

export default StatusViewersModal;
