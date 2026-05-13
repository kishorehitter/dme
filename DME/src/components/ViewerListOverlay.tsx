import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, Dimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { StatusViewer } from '../services/StatusService';

const { width } = Dimensions.get('window');

interface ViewerListOverlayProps {
  viewers: StatusViewer[];
  onClose: () => void;
  loading: boolean;
}

const ViewerListOverlay: React.FC<ViewerListOverlayProps> = ({
  viewers,
  onClose,
  loading,
}) => {
  // FIX [3]: use insets so header and list clear the notch / status bar
  const insets = useSafeAreaInsets();

  return (
    <TouchableOpacity
      style={styles.overlayBackground}
      onPress={onClose}
      activeOpacity={1}
    >
      {/*
        FIX [1]: stop tap-through to the overlay background.
        Without this, tapping anywhere on the panel (not just the bg)
        triggers onClose because the TouchableOpacity wraps everything.
      */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => {}} // absorb tap — do NOT propagate to parent
        style={[
          styles.overlayContent,
          { paddingTop: insets.top + 12 }, // FIX [3]
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            Viewers {viewers.length > 0 ? `(${viewers.length})` : ''}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : viewers.length === 0 ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.emptyText}>No viewers yet.</Text>
          </View>
        ) : (
          <FlatList
            data={viewers}
            keyExtractor={item => item.viewer_id.toString()}
            // FIX [2]: add bottom inset so last row isn't hidden under nav bar
            contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
            renderItem={({ item }) => (
              <View style={styles.viewerItem}>
                {item.viewer_avatar ? (
                  <Image
                    source={{ uri: item.viewer_avatar }}
                    style={styles.viewerAvatar}
                  />
                ) : (
                  <View style={styles.viewerAvatarFallback}>
                    <Icon name="person" size={20} color="#fff" />
                  </View>
                )}
                <Text style={styles.viewerName}>{item.viewer_username}</Text>
                <Text style={styles.viewedAt}>
                  {new Date(item.viewed_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}
          />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  overlayBackground: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  overlayContent: {
    width: width * 0.7,
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 15,
    // FIX [3]: paddingTop is set dynamically via insets above
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#ccc',
    fontSize: 16,
  },
  viewerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  viewerAvatar: {
    width: 40, height: 40, borderRadius: 20, marginRight: 10,
  },
  viewerAvatarFallback: {
    width: 40, height: 40, borderRadius: 20, marginRight: 10,
    backgroundColor: '#8100D1',
    justifyContent: 'center', alignItems: 'center',
  },
  viewerName: {
    color: '#fff', fontSize: 16, flex: 1,
  },
  viewedAt: {
    color: '#ccc', fontSize: 12,
  },
});

export default ViewerListOverlay;