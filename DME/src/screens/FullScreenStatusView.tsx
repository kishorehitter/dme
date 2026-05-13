/**
 * FullScreenStatusView.tsx  — Fixed & Enhanced
 *
 * Changes from your original
 * ──────────────────────────
 * [1] Missing Platform import added (caused crash on Android header padding)
 * [2] Video support added — original only rendered <Image>, videos showed blank
 * [3] Eye count shows real view_count from status, not viewers.length
 *     (viewers.length starts at 0 until the overlay is opened — wrong UX)
 * [4] recordView() called on mount so THIS user's view is counted immediately
 * [5] Caption overlay added — was completely missing
 * [6] resizeMode changed to 'cover' for true full-screen WhatsApp feel
 * [7] Safe Area handling fixed — removed SafeAreaView wrapper since StatusBar
 *     is hidden; use insets instead so content isn't clipped on notch devices
 * [8] Viewer count refreshes after recordView so the number is always fresh
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Platform,           // FIX [1]: was imported in styles but not in imports
  StatusBar,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context'; // FIX [7]
import Video from 'react-native-video';                              // FIX [2]
import Icon from 'react-native-vector-icons/Ionicons';
import { Status, StatusService, StatusViewer } from '../services/StatusService';
import ViewerListOverlay from '../components/ViewerListOverlay';

const { width, height } = Dimensions.get('window');

interface RouteParams {
  status: Status;
}

const FullScreenStatusView = () => {
  const navigation = useNavigation<any>();
  const route      = useRoute();
  const insets     = useSafeAreaInsets();           // FIX [7]
  const { status } = route.params as RouteParams;

  const [showViewers,    setShowViewers]    = useState(false);
  const [viewers,        setViewers]        = useState<StatusViewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  // FIX [3]: track real view count separately from viewers array length
  const [viewCount,      setViewCount]      = useState<number>(status.view_count ?? 0);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });

    // FIX [4]: record this user's view immediately on open, then refresh count
    const recordAndRefresh = async () => {
      try {
        await StatusService.recordView(status.id);
        const fresh = await StatusService.getViewCount(status.id);
        setViewCount(fresh);                        // FIX [3] + [8]
      } catch {
        // non-fatal — don't block UI
      }
    };
    recordAndRefresh();
  }, [navigation, status.id]);

  const toggleViewers = async () => {
    if (!showViewers && viewers.length === 0) {
      setLoadingViewers(true);
      try {
        const fetchedViewers = await StatusService.getViewers(status.id);
        setViewers(fetchedViewers);
        // Also sync count with actual list length once loaded
        setViewCount(fetchedViewers.length);
      } catch (error) {
        console.error('Failed to fetch viewers:', error);
      } finally {
        setLoadingViewers(false);
      }
    }
    setShowViewers(prev => !prev);
  };

  const isVideo = status.media_type === 'video';  // FIX [2]

  return (
    // FIX [7]: plain View instead of SafeAreaView — StatusBar is hidden,
    // use insets manually so we control exactly what's padded
    <View style={styles.container}>
      <StatusBar hidden />

      {/* FIX [2]: render Video or Image based on media_type */}
      {isVideo ? (
        <Video
          key={status.id}
          source={{ uri: status.media_url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"       // FIX [6]
          repeat
          controls={false}
        />
      ) : (
        <Image
          source={{ uri: status.media_url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"       // FIX [6]: was 'contain', left black bars
        />
      )}

      {/* Gradient scrims for readability */}
      <View style={styles.topScrim}    pointerEvents="none" />
      <View style={styles.bottomScrim} pointerEvents="none" />

      {/* Header — FIX [7]: top padding uses insets.top not Platform hack */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.username}>{status.username}</Text>
        <Text style={styles.time}>
          {new Date(status.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* FIX [5]: caption overlay — was completely absent in original */}
      {!!status.caption && (
        <View style={styles.captionOverlay} pointerEvents="none">
          <Text style={styles.captionText}>{status.caption}</Text>
        </View>
      )}

      {/* Eye icon — FIX [3]: shows viewCount state, not viewers.length */}
      <TouchableOpacity
        onPress={toggleViewers}
        style={[styles.eyeIcon, { bottom: insets.bottom + 20 }]}  // FIX [7]
      >
        <Icon name="eye" size={24} color="#fff" />
        {loadingViewers ? (
          <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 5 }} />
        ) : (
          <Text style={styles.eyeCount}>{viewCount}</Text>   // FIX [3]
        )}
      </TouchableOpacity>

      {showViewers && (
        <ViewerListOverlay
          viewers={viewers}
          onClose={() => setShowViewers(false)}
          loading={loadingViewers}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  // FIX [6]: fill whole screen
  media: {
    width,
    height,
    resizeMode: 'cover',
  },
  // Scrims instead of single semi-transparent header bg
  topScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 140,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bottomScrim: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  header: {
    position: 'absolute',
    top: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 10,
    // FIX [1]: Platform is now properly imported; but insets.top handles this better (see above)
  },
  backButton: {
    padding: 5,
  },
  username: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  time: {
    color: '#ccc',
    fontSize: 14,
    marginLeft: 10,
  },
  // FIX [5]: caption overlay styles
  captionOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  captionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  eyeIcon: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
  },
  eyeCount: {
    color: '#fff',
    marginLeft: 5,
    fontSize: 16,
  },
});

export default FullScreenStatusView;