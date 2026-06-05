import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../../services/api';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import { useAuth } from '../../context/AuthContext';

export const StatusPrivacyScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user: currentUser } = useAuth();
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Parallel fetch: contacts and current privacy settings
      const [contactRes, privacyRes] = await Promise.all([
        api.get('/chat/contacts/'),
        api.get('/chat/privacy/status/')
      ]);

      setContacts(contactRes.data || []);

      // Set initially selected from backend
      if (privacyRes.data?.restricted_to) {
        setSelected(privacyRes.data.restricted_to);
      }
    } catch (e) {
      console.error('[StatusPrivacyScreen] Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selected.length === contacts.length && contacts.length > 0) {
      setSelected([]); // Deselect all if all are already selected
    } else {
      setSelected(contacts.map(u => u.id));
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await api.post('/chat/privacy/status/', { restricted_to: selected });
      navigation.goBack();
    } catch (e) {
      console.error('[StatusPrivacyScreen] Save error:', e);
      Alert.alert('Error', 'Failed to save privacy settings');
    } finally {
      setSaving(false);
    }
  };

  const allSelected = contacts.length > 0 && selected.length === contacts.length;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Status Privacy</Text>
        <TouchableOpacity onPress={onSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#8100D1" /> : <Text style={styles.done}>Done</Text>}
        </TouchableOpacity>
      </View>
      
      <View style={styles.topActions}>
        <Text style={styles.desc}>Only share status updates with:</Text>
        {contacts.length > 0 && (
          <TouchableOpacity style={styles.selectAllBtn} onPress={selectAll}>
            <Text style={styles.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {loading ? <ActivityIndicator style={{marginTop: 40}} color="#8100D1" /> : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id.toString()}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="people-outline" size={48} color="#ddd" />
              <Text style={styles.emptyText}>No contacts found to set privacy.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => toggleSelect(item.id)}>
              <AvatarWithFallback 
                uri={item.profile_picture} 
                sticker={item.avatar_sticker}
                displayName={item.display_name || item.username}
                style={{ width: 40, height: 40, borderRadius: 20 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.display_name || item.username}</Text>
                <Text style={{ fontSize: 12, color: '#666' }}>@{item.username}</Text>
              </View>
              <Icon 
                name={selected.includes(item.id) ? "checkbox" : "square-outline"} 
                size={24} 
                color="#8100D1" 
              />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', padding: 20, justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: 'bold' },
  done: { color: '#8100D1', fontWeight: 'bold', fontSize: 16 },
  topActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f9f9f9' },
  desc: { padding: 15, color: '#666', fontSize: 14, flex: 1 },
  selectAllBtn: { padding: 15 },
  selectAllText: { color: '#8100D1', fontWeight: '600', fontSize: 14 },
  list: { flex: 1 },
  listContent: { paddingBottom: 20 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, gap: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  name: { fontSize: 16, fontWeight: '500' },
  emptyContainer: { padding: 60, alignItems: 'center', justifyContent: 'center' },
  emptyText: { marginTop: 10, color: '#999', textAlign: 'center', fontSize: 14 }
});