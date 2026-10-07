import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { chatAPI } from '../services/api';
import AvatarWithFallback from './AvatarWithFallback';
import { useTheme } from '../context/ThemeContext';
import Toast from 'react-native-toast-message';

interface ForwardMessageModalProps {
  visible: boolean;
  onClose: () => void;
  messagesToForward: any[];
  onForwardComplete?: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  visible,
  onClose,
  messagesToForward,
  onForwardComplete,
}) => {
  const { theme } = useTheme();
  const [conversations, setConversations] = useState<any[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedConvIds, setSelectedConvIds] = useState<number[]>([]);
  const [forwarding, setForwarding] = useState(false);

  useEffect(() => {
    if (visible) {
      loadConversations();
      setSelectedConvIds([]);
      setSearchQuery('');
    }
  }, [visible]);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const data = await chatAPI.getConversations();
      const list = Array.isArray(data) ? data : data?.results || [];
      setConversations(list);
      setFilteredConversations(list);
    } catch (err) {
      console.error('Failed to load conversations for forward:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setFilteredConversations(conversations);
      return;
    }
    const q = text.toLowerCase();
    const filtered = conversations.filter(c => {
      const name = (c.name || c.other_user?.display_name || c.other_user?.first_name || '').toLowerCase();
      return name.includes(q);
    });
    setFilteredConversations(filtered);
  };

  const toggleSelect = (convId: number) => {
    setSelectedConvIds(prev =>
      prev.includes(convId) ? prev.filter(id => id !== convId) : [...prev, convId]
    );
  };

  const handleSendForward = async () => {
    if (selectedConvIds.length === 0 || messagesToForward.length === 0 || forwarding) return;
    setForwarding(true);

    try {
      for (const convId of selectedConvIds) {
        for (const msg of messagesToForward) {
          const content = msg.content || '';
          const msgType = msg.message_type || 'text';
          if (content.trim() || msg.media_file) {
            await chatAPI.sendMessage(convId, content, msgType);
          }
        }
      }

      Toast.show({
        type: 'success',
        text1: `Forwarded to ${selectedConvIds.length} chat${selectedConvIds.length > 1 ? 's' : ''}`,
        position: 'bottom',
      });

      onForwardComplete?.();
      onClose();
    } catch (err) {
      console.error('Error forwarding messages:', err);
      Toast.show({
        type: 'error',
        text1: 'Failed to forward messages',
        position: 'bottom',
      });
    } finally {
      setForwarding(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.modalContainer, { backgroundColor: theme.surface }]}>
          {/* Header */}
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={onClose} style={s.closeButton}>
              <Icon name="close" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={[s.title, { color: theme.textPrimary }]}>Forward Message</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Search Bar */}
          <View style={[s.searchContainer, { backgroundColor: theme.surfaceAlt }]}>
            <Icon name="search-outline" size={18} color={theme.textMuted} style={s.searchIcon} />
            <TextInput
              style={[s.searchInput, { color: theme.textPrimary }]}
              placeholder="Search conversations..."
              placeholderTextColor={theme.textMuted}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => handleSearch('')}>
                <Icon name="close-circle" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Chat List */}
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          ) : (
            <FlatList
              data={filteredConversations}
              keyExtractor={item => item.id.toString()}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
              renderItem={({ item }) => {
                const isSelected = selectedConvIds.includes(item.id);
                const title = item.is_group
                  ? item.name || 'Group Chat'
                  : item.other_user?.display_name || item.other_user?.first_name || item.name || 'User';
                const avatar = item.is_group ? item.profile_picture : item.other_user?.profile_picture;

                return (
                  <TouchableOpacity
                    style={[
                      s.chatRow,
                      { borderBottomColor: theme.border },
                      isSelected && { backgroundColor: theme.primary + '15' },
                    ]}
                    onPress={() => toggleSelect(item.id)}
                    activeOpacity={0.7}
                  >
                    <AvatarWithFallback
                      uri={avatar}
                      displayName={title}
                      style={s.avatar}
                    />
                    <View style={s.chatInfo}>
                      <Text style={[s.chatName, { color: theme.textPrimary }]} numberOfLines={1}>
                        {title}
                      </Text>
                      <Text style={[s.lastMsg, { color: theme.textMuted }]} numberOfLines={1}>
                        {item.last_message?.content || (item.is_group ? 'Group' : 'Tap to select')}
                      </Text>
                    </View>
                    <View
                      style={[
                        s.checkbox,
                        { borderColor: isSelected ? theme.primary : theme.border },
                        isSelected && { backgroundColor: theme.primary },
                      ]}
                    >
                      {isSelected && <Icon name="checkmark" size={16} color="#FFFFFF" />}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={s.center}>
                  <Text style={{ color: theme.textMuted, marginTop: 32 }}>No chats found</Text>
                </View>
              }
            />
          )}

          {/* Footer Action Button */}
          {selectedConvIds.length > 0 && (
            <View style={[s.footer, { borderTopColor: theme.border, backgroundColor: theme.surface }]}>
              <TouchableOpacity
                style={[s.sendButton, { backgroundColor: theme.primary }]}
                onPress={handleSendForward}
                disabled={forwarding}
                activeOpacity={0.8}
              >
                {forwarding ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="arrow-redo" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={s.sendButtonText}>
                      Forward to {selectedConvIds.length} {selectedConvIds.length === 1 ? 'chat' : 'chats'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    maxHeight: '80%',
    minHeight: '50%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    padding: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  chatInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  lastMsg: {
    fontSize: 13,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    flexDirection: 'row',
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});

export default ForwardMessageModal;
