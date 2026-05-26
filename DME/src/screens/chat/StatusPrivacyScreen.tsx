import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
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
  const [selected, setSelected] = useState<number[]>(route.params?.initialSelected ?? []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const res = await api.get('/chat/conversations/');
      const data = res.data.results || (Array.isArray(res.data) ? res.data : []);

      const users: any[] = [];
      data.forEach((conv: any) => {
        if (conv.other_user && conv.other_user.id) {
          if (!users.find(u => u.id === conv.other_user.id)) {
            users.push(conv.other_user);
          }
        }
      });
      setContacts(users);
    } catch (e) {
      console.error('Failed to fetch contacts:', e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const onSave = () => {
    if (route.params?.onSelect) {
        route.params.onSelect(selected);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icon name="close" size={24} color="#333" /></TouchableOpacity>
        <Text style={styles.title}>Status Privacy</Text>
        <TouchableOpacity onPress={onSave}><Text style={styles.done}>Done</Text></TouchableOpacity>
      </View>
      <Text style={styles.desc}>Only share status updates with these people:</Text>
      
      {loading ? <ActivityIndicator style={{marginTop: 20}}/> : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id.toString()}
          style={styles.list}
          contentContainerStyle={styles.listContent}
// ...
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => toggleSelect(item.id)}>
              <AvatarWithFallback 
                uri={item.profile_picture} 
                sticker={item.avatar_sticker}
                displayName={item.display_name || item.username}
                style={{ width: 40, height: 40, borderRadius: 20 }}
                initialSize={20}
                iconSize={24}
              />
              <Text style={styles.name}>{item.display_name || item.username}</Text>
              <Icon 
                name={selected.includes(item.id) ? "checkbox" : "square-outline"} 
                size={24} 
                color="#8100D1" 
              />
            </TouchableOpacity>
          )}
// ...
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
  desc: { padding: 20, color: '#666', fontSize: 14 },
  list: { flex: 1 },
  listContent: { paddingBottom: 20 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, gap: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  name: { fontSize: 16, flex: 1 }
});
