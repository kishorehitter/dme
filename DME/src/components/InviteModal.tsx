import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator, Image
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../services/api';
import { resolveImageUrl } from '../utils/image';

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

  useEffect(() => {
    if (visible) {
      searchFriends('');
    }
  }, [visible]);

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
    if (selectedIds.length === 0) return;
    setSending(true);
    try {
      await api.post('/music/invite/', {
        user_ids: selectedIds,
        room_code: roomCode,
        video_id: videoId
      });
      onClose();
      setSelectedIds([]);
    } catch (e) {
      console.error('Failed to send invites', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
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
                  <View style={styles.avatar}>
                    {item.avatar_sticker ? (
                      <Text style={styles.sticker}>{item.avatar_sticker}</Text>
                    ) : item.profile_picture ? (
                      <Image source={{ uri: resolveImageUrl(item.profile_picture) }} style={styles.img} />
                    ) : (
                      <Icon name="person" size={20} color="#fff" />
                    )}
                  </View>
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
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  container: { height: '80%', backgroundColor: '#111', borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 12, height: 45, marginBottom: 15 },
  input: { flex: 1, color: '#fff', marginLeft: 10 },
  friendItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  img: { width: 40, height: 40, borderRadius: 20 },
  sticker: { fontSize: 18 },
  name: { flex: 1, color: '#fff', fontSize: 16 },
  sendBtn: { backgroundColor: '#8100D1', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});

export default InviteModal;
