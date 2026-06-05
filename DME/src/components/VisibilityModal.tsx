import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../services/api';
import AvatarWithFallback from './AvatarWithFallback';
import { useAuth } from '../context/AuthContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (userIds: number[]) => void;
  initialSelected: number[];
}

export const VisibilityModal: React.FC<Props> = ({ visible, onClose, onSelect, initialSelected }) => {
  const { user: currentUser } = useAuth();
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch the full list of contacts
      const res = await api.get('/chat/contacts/');
      setContacts(res.data || []);
    } catch (e) {
      console.error('[VisibilityModal] fetchContacts error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchContacts();
    }
  }, [visible, fetchContacts]);

  // Filter contacts locally based on search query
  const filteredContacts = contacts.filter(u => 
    (u.display_name?.toLowerCase() || u.username.toLowerCase()).includes(searchQuery.toLowerCase())
  );

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selected.length === contacts.length && contacts.length > 0) {
      setSelected([]); 
    } else {
      setSelected(contacts.map(u => u.id));
    }
  };

  const allSelected = contacts.length > 0 && selected.length === contacts.length;

  const handleDone = () => {
    if (typeof onSelect === 'function') {
      onSelect(selected);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Icon name="close" size={24} /></TouchableOpacity>
          <Text style={styles.title}>Status Privacy</Text>
          <TouchableOpacity onPress={handleDone}><Text style={styles.done}>Done</Text></TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color="#999" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search contacts..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={18} color="#999" />
            </TouchableOpacity>
          )}
        </View>

        {contacts.length > 0 && (
          <TouchableOpacity style={styles.selectAllBtn} onPress={selectAll}>
            <Icon 
              name={allSelected ? "checkbox" : "square-outline"} 
              size={22} 
              color="#8100D1" 
            />
            <Text style={styles.selectAllText}>{allSelected ? ' Deselect All' : ' Select All'}</Text>
          </TouchableOpacity>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color="#8100D1" />
        ) : (
          <FlatList
            data={filteredContacts}
            keyExtractor={item => item.id.toString()}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No contacts found.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => toggleSelect(item.id)}>
                <AvatarWithFallback 
                  uri={item.profile_picture} 
                  displayName={item.display_name || item.username} 
                  size={40} 
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.display_name || item.username}</Text>
                  <Text style={styles.username}>@{item.username}</Text>
                </View>
                <Icon name={selected.includes(item.id) ? "checkbox" : "square-outline"} size={24} color="#8100D1" />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', marginTop: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold' },
  done: { color: '#8100D1', fontWeight: 'bold' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    marginHorizontal: 15,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15 },
  selectAllBtn: { paddingHorizontal: 20, marginBottom: 10 },
  selectAllText: { color: '#8100D1', fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 15 },
  name: { fontSize: 16, fontWeight: '500' },
  username: { fontSize: 12, color: '#666' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { textAlign: 'center', color: '#999', lineHeight: 20 }
});
