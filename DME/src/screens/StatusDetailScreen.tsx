/**
 * StatusDetailScreen.tsx  — My statuses list (fixed & improved)
 *
 * Fixes
 * ─────
 * [4] View count: refreshes after useFocusEffect so counts are always current.
 *     StatusListItem now receives live viewCount from state, not stale prop.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { StatusService, Status } from '../services/StatusService';
import StatusListItem from '../components/StatusListItem';

const StatusDetailScreen: React.FC = () => {
  const { user: currentUser } = useAuth();
  const navigation = useNavigation<any>();

  const [myStatuses,  setMyStatuses]  = useState<Status[]>([]);
  const [viewCounts,  setViewCounts]  = useState<Record<string, number>>({});
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const loadMyStatuses = useCallback(async () => {
    if (!currentUser?.id) return;
    setRefreshing(true);
    try {
      const allStatuses   = await StatusService.getStatuses();
      const userStatuses  = allStatuses
        .filter(s => s.user_id === currentUser.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setMyStatuses(userStatuses);

      // FIX [4]: fetch fresh view counts for every status
      const counts: Record<string, number> = {};
      await Promise.allSettled(
        userStatuses.map(async s => {
          counts[s.id] = await StatusService.getViewCount(s.id);
        }),
      );
      setViewCounts(counts);
    } catch (error) {
      console.error('Failed to load my statuses:', error);
      Alert.alert('Error', 'Failed to load your statuses. Please try again.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [currentUser?.id]);

  useFocusEffect(
    useCallback(() => { loadMyStatuses(); }, [loadMyStatuses]),
  );

  const handleViewViewers = (statusId: string) => {
    navigation.navigate('StatusViewersModal', { statusId });
  };

  const handleDeleteStatus = (statusId: string) => {
    Alert.alert(
      'Delete Status',
      'Are you sure you want to delete this status?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await StatusService.deleteStatus(statusId);
              Alert.alert('Success', 'Status deleted successfully.');
              loadMyStatuses();
            } catch (error) {
              console.error('Failed to delete status:', error);
              Alert.alert('Error', 'Failed to delete status. Please try again.');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#8100D1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {myStatuses.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You haven't posted any statuses yet.</Text>
        </View>
      ) : (
        <FlatList
          data={myStatuses}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <StatusListItem
              status={item}
              // FIX [4]: pass live view count so the component re-renders when
              // counts change, instead of relying on the (possibly stale)
              // item.view_count coming from the server list endpoint.
              viewCount={viewCounts[item.id] ?? item.view_count ?? 0}
              onViewViewers={handleViewViewers}
              onDelete={handleDeleteStatus}
            />
          )}
          refreshing={refreshing}
          onRefresh={loadMyStatuses}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#888' },
});

export default StatusDetailScreen;