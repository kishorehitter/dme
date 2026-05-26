import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../services/api';
import AvatarWithFallback from './AvatarWithFallback';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (userIds: number[]) => void;
  initialSelected: number[];
}

export const VisibilityModal: React.FC<Props> = ({ visible, onClose, onSelect, initialSelected }) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) fetchContacts();
  }, [visible]);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/chat/conversations/');
      // Extract unique contact user IDs from conversations
      const users: any[] = [];
      res.data.forEach((conv: any) => {
        conv.participants?.forEach((p: any) => {
          if (!users.find(u => u.id === p.user.id)) {
            users.push(p.user);
          }
        });
      });
      setContacts(users.filter(u => u.id !== 0)); // Replace with current user ID check if needed
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleDone = () => {
    console.log('[PrivacyModal] Saving selection:', selected);
    if (typeof onSelect === 'function') {
      onSelect(selected);
    } else {
      console.error('[PrivacyModal] onSelect is not a function');
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
        {loading ? <ActivityIndicator /> : (
          <FlatList
            data={contacts}
            keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => toggleSelect(item.id)}>
                <AvatarWithFallback uri={item.profile_picture} size={40} />
                <Text style={styles.name}>{item.username}</Text>
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
  item: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 15 },
  name: { flex: 1, fontSize: 16 }
});
