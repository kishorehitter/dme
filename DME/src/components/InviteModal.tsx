import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../services/api';
import AvatarWithFallback from './AvatarWithFallback';

interface User {
  id: number;
  display_name: string;
  avatar_sticker: string | null;
  profile_picture: string | null;
}

interface InviteModalProps {
  visible: boolean;
  onClose: () => void;
  roomCode: string;
  videoId?: string;
}

const InviteModal: React.FC<InviteModalProps> = ({ visible, onClose, roomCode, videoId }) => {
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const pendingRequest = useRef(false);
  const idempotencyKey = useRef<string>('');

  // When visibility changes to true, fetch data
  React.useEffect(() => {
    if (visible) {
      searchFriends('');
      pendingRequest.current = false;
      idempotencyKey.current = Math.random().toString(36).substring(2, 15) + Date.now().toString();
    }
  }, [visible]);

  if (!visible) return null;

  const searchFriends = async (q: string) => {
    setLoading(true);
    try {
      const response = await api.get(`/chat/users/search/?q=${q}`);
      setFriends(response.data);
    } catch (e) {
      console.error('Failed to search friends', e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSendInvites = async () => {
    if (selectedIds.length === 0 || pendingRequest.current) return;
    
    pendingRequest.current = true;
    setSending(true);
    try {
      await api.post('/music/invite/', {
        user_ids: selectedIds,
        room_code: roomCode,
        video_id: videoId,
        idempotency_key: idempotencyKey.current
      });
      onClose();
      setSelectedIds([]);
    } catch (e) {
      console.error('❌ [INVITE] Failed:', e);
    } finally {
      setSending(false);
      pendingRequest.current = false;
    }
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Invite Friends</Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Icon name="search" size={20} color="#888" />
          <TextInput
            style={styles.input}
            placeholder="Search friends..."
            placeholderTextColor="#666"
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              searchFriends(text);
            }}
          />
        </View>

        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} color="#8100D1" />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.friendItem} 
                onPress={() => toggleSelection(item.id)}
              >
                <AvatarWithFallback 
                  uri={item.profile_picture} 
                  displayName={item.display_name} 
                  sticker={item.avatar_sticker}
                  style={styles.avatar}
                />
                <Text style={styles.name}>{item.display_name}</Text>
                <Icon 
                  name={selectedIds.includes(item.id) ? "checkbox" : "square-outline"} 
                  size={24} 
                  color="#8100D1" 
                />
              </TouchableOpacity>
            )}
          />
        )}

        <TouchableOpacity 
          style={[styles.sendBtn, selectedIds.length === 0 && { opacity: 0.5 }]} 
          onPress={handleSendInvites}
          disabled={selectedIds.length === 0 || sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendText}>Send Invitations ({selectedIds.length})</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000 },
  container: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', backgroundColor: '#000000', borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 12, height: 45, marginBottom: 15 },
  input: { flex: 1, color: '#fff', marginLeft: 10 },
  friendItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  name: { flex: 1, color: '#fff', fontSize: 16 },
  sendBtn: { backgroundColor: '#8100D1', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});

export default InviteModal;
