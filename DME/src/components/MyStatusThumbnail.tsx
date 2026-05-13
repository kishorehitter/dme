import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { Status } from '../services/StatusService';

const THUMBNAIL_SIZE = 60;
const BORDER_WIDTH = 3;
const RADIUS = (THUMBNAIL_SIZE + BORDER_WIDTH) / 2;

interface MyStatusThumbnailProps {
  statuses: Status[];
  username: string;
  onPress: () => void;
  hasUnseenStatuses?: boolean;
}

const MyStatusThumbnail: React.FC<MyStatusThumbnailProps> = ({
  statuses,
  username,
  onPress,
  hasUnseenStatuses = false,
}) => {
  const hasStatuses = statuses && statuses.length > 0;
  const latestStatus = hasStatuses ? statuses[0] : null;

  // FIX [1]: media_url = full https:// URL (works in <Image>)
  //          media_file = Django server path like /media/uploads/x.jpg (does NOT work)
  const thumbnailUri = latestStatus?.media_url || latestStatus?.media_file || null;

  // FIX [2]: use media_type field, not guessing from file extension
  const isVideo = latestStatus?.media_type === 'video';

  // FIX [3]: real view_count from status, not hardcoded 0
  const viewCount = latestStatus?.view_count ?? 0;

  const renderStatusBorder = () => {
    if (!hasStatuses) return null;
    const numSegments = statuses.length;
    const segmentAngle = 360 / numSegments;
    const gapAngle = 5;
    const segmentSweepAngle = segmentAngle - gapAngle;

    return (
      <Svg
        height={THUMBNAIL_SIZE + BORDER_WIDTH * 2}
        width={THUMBNAIL_SIZE + BORDER_WIDTH * 2}
        style={styles.svgBorder}
      >
        {statuses.map((_, index) => {
          const startAngle = index * segmentAngle;
          const endAngle = startAngle + segmentSweepAngle;
          const startRad = (startAngle * Math.PI) / 180;
          const endRad = (endAngle * Math.PI) / 180;
          const x1 = RADIUS + RADIUS * Math.cos(startRad);
          const y1 = RADIUS + RADIUS * Math.sin(startRad);
          const x2 = RADIUS + RADIUS * Math.cos(endRad);
          const y2 = RADIUS + RADIUS * Math.sin(endRad);
          const largeArcFlag = segmentSweepAngle > 180 ? 1 : 0;
          return (
            <Path
              key={index}
              d={`M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${x2} ${y2}`}
              fill="none"
              stroke={hasUnseenStatuses ? '#8100D1' : 'gray'}
              strokeWidth={BORDER_WIDTH}
            />
          );
        })}
      </Svg>
    );
  };

  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <View style={styles.thumbnailWrapper}>
        {renderStatusBorder()}

        {hasStatuses ? (
          <>
            {thumbnailUri ? (
              // FIX [4]: always <Image> even for videos — <Video paused> shows
              // black on Android. Use the media_url directly; iOS shows a poster
              // frame automatically for video URLs.
              <Image
                source={{ uri: thumbnailUri }}
                style={styles.thumbnailImage}
                resizeMode="cover"
                onError={(e) =>
                  console.warn('[Thumbnail] failed to load:', e.nativeEvent.error)
                }
              />
            ) : (
              // FIX [5]: was blank when URL missing — now shows initial
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {username ? username.charAt(0).toUpperCase() : 'U'}
                </Text>
              </View>
            )}

            {isVideo && (
              <View style={styles.playIconOverlay}>
                <Icon name="play" size={14} color="#fff" />
              </View>
            )}

            <View style={styles.viewsOverlay}>
              <Icon name="eye-outline" size={14} color="#fff" />
              <Text style={styles.viewsText}>{viewCount}</Text>
            </View>
          </>
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {username ? username.charAt(0).toUpperCase() : 'U'}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.usernameText}>{username}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 10,
  },
  thumbnailWrapper: {
    width:          THUMBNAIL_SIZE,
    height:         THUMBNAIL_SIZE,
    borderRadius:   THUMBNAIL_SIZE / 2,
    justifyContent: 'center',
    alignItems:     'center',
    overflow:       'hidden',
    position:       'relative',
  },
  svgBorder: {
    position: 'absolute',
    top:      -BORDER_WIDTH,
    left:     -BORDER_WIDTH,
  },
  thumbnailImage: {
    width:        THUMBNAIL_SIZE,
    height:       THUMBNAIL_SIZE,
    borderRadius: THUMBNAIL_SIZE / 2,
  },
  avatarPlaceholder: {
    width:           THUMBNAIL_SIZE,
    height:          THUMBNAIL_SIZE,
    borderRadius:    THUMBNAIL_SIZE / 2,
    backgroundColor: '#8100D1',
    justifyContent:  'center',
    alignItems:      'center',
  },
  avatarText: {
    color:      '#fff',
    fontSize:   24,
    fontWeight: 'bold',
  },
  playIconOverlay: {
    position:        'absolute',
    bottom:          4,
    left:            4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius:    8,
    padding:         3,
  },
  viewsOverlay: {
    position:          'absolute',
    bottom:            4,
    right:             4,
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   'rgba(0,0,0,0.6)',
    borderRadius:      8,
    paddingHorizontal: 4,
    paddingVertical:   2,
  },
  viewsText: {
    color:      '#fff',
    fontSize:   10,
    marginLeft: 2,
  },
  usernameText: {
    fontSize:  12,
    marginTop: 5,
    color:     '#333',
  },
});

export default MyStatusThumbnail;