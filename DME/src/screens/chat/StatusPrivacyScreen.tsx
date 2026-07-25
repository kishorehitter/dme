import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import api from '../../services/api';
import AvatarWithFallback from '../../components/AvatarWithFallback';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export const StatusPrivacyScreen = () => {
  const { theme, isDark } = useTheme();
  const s = React.useMemo(() => dynamicStyles(theme), [theme]);
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
      // Parallel fetch: friends and current privacy settings
      const [friendRes, privacyRes] = await Promise.all([
        api.get('/chat/friends/'),
        api.get('/chat/privacy/status/')
      ]);

      const friendsList = Array.isArray(friendRes.data) ? friendRes.data : (friendRes.data?.results || []);
      setContacts(friendsList);

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
    <SafeAreaView style={s.container} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="close" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={s.title}>Status Privacy</Text>
        <TouchableOpacity onPress={onSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={theme.primary} /> : <Text style={s.done}>Done</Text>}
        </TouchableOpacity>
      </View>
      
      <View style={s.topActions}>
        <Text style={s.desc}>Only share status updates with:</Text>
        {contacts.length > 0 && (
          <TouchableOpacity style={s.selectAllBtn} onPress={selectAll}>
            <Text style={s.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {loading ? <ActivityIndicator style={{marginTop: 40}} color={theme.primary} /> : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id.toString()}
          style={s.list}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Icon name="people-outline" size={48} color="#ddd" />
              <Text style={s.emptyText}>No friends found to set privacy.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.item} onPress={() => toggleSelect(item.id)}>
              <AvatarWithFallback 
                uri={item.profile_picture} 
                sticker={item.avatar_sticker}
                displayName={item.display_name || item.username}
                style={{ width: 40, height: 40, borderRadius: 20 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.display_name || item.username}</Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>@{item.username}</Text>
              </View>
              <Icon 
                name={selected.includes(item.id) ? "checkbox" : "square-outline"} 
                size={24} 
                color={theme.primary} 
              />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const dynamicStyles = (theme: import('../../utils/theme').ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: { flexDirection: 'row', padding: 20, justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { fontSize: 18, fontWeight: 'bold', color: theme.textPrimary },
  done: { color: theme.primary, fontWeight: 'bold', fontSize: 16 },
  topActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border },
  desc: { padding: 15, color: theme.textSecondary, fontSize: 14, flex: 1 },
  selectAllBtn: { padding: 15 },
  selectAllText: { color: theme.primary, fontWeight: '600', fontSize: 14 },
  list: { flex: 1 },
  listContent: { paddingBottom: 20 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, gap: 15, borderBottomWidth: 1, borderBottomColor: theme.border },
  name: { fontSize: 16, fontWeight: '500', color: theme.textPrimary },
  emptyContainer: { padding: 60, alignItems: 'center', justifyContent: 'center' },
  emptyText: { marginTop: 10, color: theme.textSecondary, textAlign: 'center', fontSize: 14 }
});