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
  const [showSearch, setShowSearch] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch the full list of friends
      const res = await api.get('/chat/friends/');
      const friendsList = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      setContacts(friendsList);
      
      // If initialSelected is empty, select all friends by default!
      if (initialSelected.length === 0) {
        setSelected(friendsList.map((u: any) => u.id));
      }
    } catch (e) {
      console.error('[VisibilityModal] fetchContacts error:', e);
    } finally {
      setLoading(false);
    }
  }, [initialSelected]);

  useEffect(() => {
    if (visible) {
      setSelected(initialSelected);
      setShowSearch(false);
      setSearchQuery('');
      fetchContacts();
    }
  }, [visible, initialSelected, fetchContacts]);

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
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Icon name="close" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Status Privacy</Text>
          <View style={styles.rightHeaderActions}>
            <TouchableOpacity 
              onPress={() => {
                setShowSearch(prev => !prev);
                if (showSearch) setSearchQuery('');
              }} 
              style={styles.headerBtn}
            >
              <Icon name={showSearch ? "search-outline" : "search"} size={22} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={styles.headerBtn}>
              <Text style={styles.done}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showSearch && (
          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color="#999" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search friends..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoFocus
            />
            {searchQuery !== '' && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close-circle" size={18} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {contacts.length > 0 && (
          <TouchableOpacity style={styles.selectAllBtn} onPress={selectAll}>
            <Text style={styles.selectAllText}>{allSelected ? 'Unselect All' : 'Select All'}</Text>
            <Icon 
              name={allSelected ? "checkbox" : "square-outline"} 
              size={22} 
              color="#4597f5f6" 
            />
          </TouchableOpacity>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color="#4597f5f6" />
        ) : (
          <FlatList
            data={filteredContacts}
            keyExtractor={item => item.id.toString()}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No friends found.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => toggleSelect(item.id)}>
                <AvatarWithFallback 
                  uri={item.profile_picture} 
                  displayName={item.display_name || item.username} 
                  style={{ width: 40, height: 40, borderRadius: 20 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.display_name || item.username}</Text>
                  <Text style={styles.username}>@{item.username}</Text>
                </View>
                <Icon name={selected.includes(item.id) ? "checkbox" : "square-outline"} size={24} color="#4597f5f6" />
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
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    padding: 20, 
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  title: { fontSize: 18, fontWeight: 'bold' },
  done: { color: '#4597f5f6', fontWeight: 'bold' },
  rightHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  headerBtn: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    marginHorizontal: 15,
    marginTop: 15,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15 },
  selectAllBtn: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginBottom: 10
  },
  selectAllText: { color: '#4597f5f6', fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 15 },
  name: { fontSize: 16, fontWeight: '500' },
  username: { fontSize: 12, color: '#666' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { textAlign: 'center', color: '#999', lineHeight: 20 }
});
