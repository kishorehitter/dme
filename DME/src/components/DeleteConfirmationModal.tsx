import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

interface DeleteConfirmationModalProps {
  visible: boolean;
  onClose: () => void;
  onDeleteForMe: () => void;
  onUnsendForEveryone?: () => void;
  allCanUnsend: boolean;
  selectedCount: number;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  visible,
  onClose,
  onDeleteForMe,
  onUnsendForEveryone,
  allCanUnsend,
  selectedCount,
}) => {
  const { theme } = useTheme();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={s.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[s.dialog, { backgroundColor: theme.surface }]}>
          <View style={s.iconCircle}>
            <Icon name="trash" size={28} color="#FF4444" />
          </View>

          <Text style={[s.title, { color: theme.textPrimary }]}>
            {selectedCount > 1 ? `Delete ${selectedCount} Messages?` : 'Delete Message?'}
          </Text>

          {!allCanUnsend && (
            <Text style={[s.subtitle, { color: theme.textMuted }]}>
              Messages older than 24 hours or received from others will only be deleted for you.
            </Text>
          )}

          <View style={s.actionsContainer}>
            {allCanUnsend && onUnsendForEveryone && (
              <TouchableOpacity
                style={[s.button, s.unsendButton]}
                onPress={() => {
                  onClose();
                  onUnsendForEveryone();
                }}
                activeOpacity={0.8}
              >
                <Text style={s.unsendButtonText}>Unsend for everyone</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[s.button, s.deleteForMeButton, { backgroundColor: allCanUnsend ? theme.surfaceAlt : '#FF4444' }]}
              onPress={() => {
                onClose();
                onDeleteForMe();
              }}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  s.deleteForMeButtonText,
                  { color: allCanUnsend ? theme.textPrimary : '#FFFFFF' },
                ]}
              >
                Delete for me
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.button, s.cancelButton, { borderColor: theme.border }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[s.cancelButtonText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  actionsContainer: {
    width: '100%',
    marginTop: 8,
    gap: 10,
  },
  button: {
    width: '100%',
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unsendButton: {
    backgroundColor: '#FF4444',
  },
  unsendButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteForMeButton: {
    // dynamic bg
  },
  deleteForMeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default DeleteConfirmationModal;
