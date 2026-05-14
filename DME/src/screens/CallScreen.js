/**
 * CallScreen - Using LiveKit for both 1-to-1 and group calls
 * 
 * ✅ FIXED:
 * - Shows "Calling..." while waiting, "Connected" after answer
 * - Caller's callback screen stays open for 30s after timeout
 * - Receiver screen closes immediately on missed call
 * - Timer increments correctly
 */

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform,
  Alert, Image, StatusBar, ScrollView, BackHandler,
  DeviceEventEmitter,
} from 'react-native';
import {
  LiveKitRoom, useTracks, VideoTrack, useRoomContext,
  useParticipants,
} from '@livekit/react-native';
import { Track, RoomEvent } from 'livekit-client';
import InCallManager from 'react-native-incall-manager';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useCall } from '../context/CallContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import fcmService from '../services/fcm';
import Icon from 'react-native-vector-icons/Ionicons';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { getWebSocketUrl, API_BASE_URL } from '../config/network';

const { width, height } = Dimensions.get('window');
const PERM_CACHE_KEY = 'call_permissions_granted';
const CALL_TIMEOUT_MS = 30 * 1000;

async function ensureCallPermissions(callType) {
  try {
    const cached = await AsyncStorage.getItem(PERM_CACHE_KEY);
    if (cached === 'true') return true;
    if (Platform.OS === 'android') {
      const micResult = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
      if (micResult !== RESULTS.GRANTED) return false;
      if (callType === 'video') {
        const camResult = await request(PERMISSIONS.ANDROID.CAMERA);
        if (camResult !== RESULTS.GRANTED) return false;
      }
    } else if (Platform.OS === 'ios') {
      const micResult = await request(PERMISSIONS.IOS.MICROPHONE);
      if (micResult !== RESULTS.GRANTED) return false;
      if (callType === 'video') {
        const camResult = await request(PERMISSIONS.IOS.CAMERA);
        if (camResult !== RESULTS.GRANTED) return false;
      }
    }
    await AsyncStorage.setItem(PERM_CACHE_KEY, 'true');
    return true;
  } catch (e) {
    console.warn('[Call] Permission check error:', e);
    return true;
  }
}

async function fetchUserProfile(userId) {
  if (!userId) return null;
  try {
    const token = await AsyncStorage.getItem('access_token');
    if (!token) return null;
    const res = await fetch(`${API_BASE_URL}/accounts/users/${userId}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile_picture || null;
  } catch (e) {
    console.warn('[Call] fetchUserProfile error:', e);
    return null;
  }
}

const RoomCapture = ({ onRoom }) => {
  const room = useRoomContext();
  const capturedRef = useRef(false);
  useEffect(() => {
    if (room && !capturedRef.current) {
      capturedRef.current = true;
      onRoom(room);
    }
  }, [room, onRoom]);
  return null;
};

const AvatarView = ({ participant }) => {
  const [avatar, setAvatar] = useState(null);
  useEffect(() => {
    // Identity is often the user ID
    fetchUserProfile(participant.identity).then(setAvatar);
  }, [participant.identity]);

  return avatar ? (
    <Image source={{ uri: avatar }} style={styles.groupAudioAvatar} />
  ) : (
    <View style={styles.groupAudioAvatar}><Icon name="person" size={28} color="#fff" /></View>
  );
};

const GroupAudioView = () => {
  const participants = useParticipants();
  const room = useRoomContext();
  
  // Sort participants: Active speakers first
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.isSpeaking && !b.isSpeaking) return -1;
    if (!a.isSpeaking && b.isSpeaking) return 1;
    return 0;
  });

  return (
    <ScrollView contentContainerStyle={styles.groupAudioContainer}>
      {sortedParticipants.length === 0 ? (
        <View style={styles.groupAudioWaiting}>
          <Icon name="people-outline" size={48} color="rgba(255,255,255,0.3)" />
          <Text style={styles.groupAudioWaitingText}>Waiting for others…</Text>
        </View>
      ) : (
        sortedParticipants.map((p, index) => {
          const key = (p.sid && p.sid !== '') ? p.sid : `p-${index}`;
          const isLocal = room?.localParticipant?.sid
            ? p.sid === room.localParticipant.sid
            : p.isLocal;
          const name = p.name || p.identity || 'User';
          
          return (
            <View key={key} style={[styles.groupAudioCard, p.isSpeaking && styles.activeSpeakerBorder]}>
              <AvatarView participant={p} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.groupAudioName}>{name}{isLocal ? ' (You)' : ''}</Text>
                {p.isSpeaking && <Text style={styles.speakingStatus}>Speaking...</Text>}
                <Text style={styles.groupAudioStatus}>{isLocal ? 'You' : 'In call'}</Text>
              </View>
              <Icon
                name={p.isMicrophoneEnabled ? 'mic' : 'mic-off'}
                size={18}
                color={p.isMicrophoneEnabled ? '#34C759' : '#FF3B30'}
              />
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

const GroupVideoGrid = () => {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const validTracks = tracks.filter(
    t => t.source === Track.Source.Camera || t.source === Track.Source.ScreenShare
  );

  if (validTracks.length === 0) {
    return (
      <View style={styles.gridPlaceholder}>
        <Icon name="people-outline" size={48} color="rgba(255,255,255,0.3)" />
        <Text style={styles.placeholderText}>Waiting for participants…</Text>
      </View>
    );
  }

  // Identify the speaker: Active speaker or first track if none
  const activeSpeaker = validTracks.find(t => t.participant?.isSpeaking) || validTracks[0];
  const others = validTracks.filter(t => t !== activeSpeaker);

  return (
    <View style={{ flex: 1 }}>
      {/* Primary Speaker Focus */}
      <View style={{ flex: 1 }}>
        <VideoTrack trackRef={activeSpeaker} style={styles.video} />
        <View style={styles.participantNameBadge}>
          <Text style={styles.participantNameText}>
            {activeSpeaker.participant?.name || activeSpeaker.participant?.identity || 'Speaker'}
          </Text>
        </View>
      </View>

      {/* Scrollable Gallery for others */}
      {others.length > 0 && (
        <ScrollView 
          horizontal 
          style={{ height: 150, paddingHorizontal: 10, marginTop: 10 }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {others.map((track, idx) => {
            const key = [track.publication?.sid, track.participant?.sid, idx].filter(Boolean).join('-') || `track-${idx}`;
            return (
              <View key={key} style={{ width: 100, height: 140, marginRight: 10, backgroundColor: '#333', borderRadius: 8, overflow: 'hidden' }}>
                <VideoTrack trackRef={track} style={styles.video} />
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const GroupCallView = ({ callType }) => {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return;
    const handleConnected = () => {
      try {
        InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
        InCallManager.setSpeakerphoneOn(true);
      } catch (e) {}
    };
    room.on(RoomEvent.Connected, handleConnected);
    return () => room.off(RoomEvent.Connected, handleConnected);
  }, [room, callType]);
  return callType === 'video' ? <GroupVideoGrid /> : <GroupAudioView />;
};

const AudioParticipantView = ({ onPartnerJoined, remoteUserName, remoteUserPic, partnerJoined, isCallingState }) => {
  const tracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }]);
  const room = useRoomContext();
  const hasNotifiedRef = useRef(false);
  
  const remoteTracks = useMemo(
    () => tracks.filter(t => t.participant && !t.participant.isLocal),
    [tracks]
  );

  useEffect(() => {
    if (remoteTracks.length > 0 && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      console.log('[Audio] Remote tracks detected, calling onPartnerJoined');
      onPartnerJoined();
    }
  }, [remoteTracks.length, onPartnerJoined]);

  useEffect(() => {
    if (!room) return;
    const handleConnected = () => {
      try {
        InCallManager.start({ media: 'audio' });
        InCallManager.setSpeakerphoneOn(true);
      } catch (e) {}
    };
    room.on(RoomEvent.Connected, handleConnected);
    return () => room.off(RoomEvent.Connected, handleConnected);
  }, [room]);

  return (
    <View style={styles.audioCallContainer}>
      <View style={styles.audioAvatarContainer}>
        {remoteUserPic ? (
          <Image source={{ uri: remoteUserPic }} style={styles.largeProfilePic} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Icon name="person" size={100} color="#9CA3AF" />
          </View>
        )}
        <Text style={styles.audioRemoteName}>{remoteUserName}</Text>
        <Text style={styles.audioCallStatus}>
          {partnerJoined ? 'Connected' : (isCallingState ? 'Calling...' : 'Connecting...')}
        </Text>
        {partnerJoined && (
          <View style={styles.audioWave}>
            {[...Array(5)].map((_, i) => (
              <View key={i} style={[styles.audioWaveDot, { opacity: 1 - Math.abs(i - 2) * 0.2 }]} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const VideoParticipantView = ({ onPartnerJoined, remoteUserName, remoteUserPic, callType, isCallingState }) => {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const room = useRoomContext();
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);
  const [localBig, setLocalBig] = useState(false);
  const hasNotifiedRef = useRef(false);

  const remoteTracks = useMemo(
    () => tracks.filter(t => t.participant && !t.participant.isLocal), [tracks]
  );
  const localTracks = useMemo(
    () => tracks.filter(t => t.participant && t.participant.isLocal), [tracks]
  );
  const remoteVideoTrack = useMemo(
    () => remoteTracks.find(t => t.source === Track.Source.Camera || t.source === Track.Source.ScreenShare),
    [remoteTracks]
  );
  const localVideoTrack = useMemo(
    () => localTracks.find(t => t.source === Track.Source.Camera), [localTracks]
  );

  useEffect(() => {
    if (remoteVideoTrack && !remoteVideoReady && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      setRemoteVideoReady(true);
      onPartnerJoined();
    }
  }, [remoteVideoTrack, remoteVideoReady, onPartnerJoined]);

  useEffect(() => {
    if (!room) return;
    const handleConnected = () => {
      try {
        InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
        InCallManager.setSpeakerphoneOn(true);
      } catch (e) {}
    };
    room.on(RoomEvent.Connected, handleConnected);
    return () => room.off(RoomEvent.Connected, handleConnected);
  }, [room, callType]);

  const toggleLayout = () => setLocalBig(prev => !prev);

  if (!remoteVideoReady) {
    return (
      <View style={styles.fullScreenContainer}>
        {localVideoTrack ? (
          <VideoTrack trackRef={localVideoTrack} style={styles.fullScreenVideo} />
        ) : (
          <View style={styles.fullScreenPlaceholder}>
            <View style={styles.avatarPlaceholder}>
              <Icon name="person" size={80} color="#9CA3AF" />
            </View>
          </View>
        )}
        <View style={styles.callingOverlay}>
          <Text style={styles.callingName}>{remoteUserName}</Text>
          <Text style={styles.callingSubtext}>
            {isCallingState ? 'Calling…' : 'Connecting…'}
          </Text>
        </View>
      </View>
    );
  }

  const fullTrack = localBig ? localVideoTrack : remoteVideoTrack;
  const miniTrack = localBig ? remoteVideoTrack : localVideoTrack;
  const fullPlaceholderPic = localBig ? null : remoteUserPic;
  const fullPlaceholderName = localBig ? 'You' : remoteUserName;

  return (
    <View style={styles.fullScreenContainer}>
      {fullTrack ? (
        <VideoTrack trackRef={fullTrack} style={styles.fullScreenVideo} />
      ) : (
        <View style={styles.fullScreenPlaceholder}>
          {fullPlaceholderPic ? (
            <Image source={{ uri: fullPlaceholderPic }} style={styles.largeProfilePic} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Icon name="person" size={80} color="#9CA3AF" />
            </View>
          )}
          <Text style={styles.placeholderText}>{fullPlaceholderName}</Text>
        </View>
      )}
      {localVideoTrack && remoteVideoTrack && (
        <TouchableOpacity style={styles.miniVideoContainer} onPress={toggleLayout}>
          {miniTrack ? (
            <VideoTrack trackRef={miniTrack} style={styles.miniVideo} />
          ) : (
            <View style={styles.miniPlaceholder}>
              <Icon name="person" size={30} color="#9CA3AF" />
            </View>
          )}
          <View style={styles.miniSwapHint}>
            <Icon name="swap-horizontal" size={12} color="rgba(255,255,255,0.8)" />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const CallScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params || {};
  const { 
    callState, startCall, endCall: endCallGlobal, updateDuration, 
    minimizeCall, maximizeCall, startTimer, stopTimer, setLiveKitConfig: setLiveKitConfigGlobal,
    updateCallParams
  } = useCall();

  const callType = params.callType || params.call_type || 'audio';
  const isGroupCall = params.isGroupCall || params.is_group_call || false;
  const conversationId = params.conversationId || params.conversation_id || (isGroupCall ? null : undefined);
  const receiverId = params.receiverId || params.remoteUserId || params.caller_id;
  const remoteUserName = params.remoteUserName || params.caller_name || 'User';
  
  const [remoteUserPic, setRemoteUserPic] = useState(params.remoteUserPic || null);
  
  // ✅ Initialize config from params immediately to avoid 'Connecting' screen and redundant updates
  const [liveKitConfig, setLiveKitConfig] = useState(() => {
    if (params.token && params.serverUrl) {
      return { token: params.token, serverUrl: params.serverUrl };
    }
    return null;
  });
  
  const [error, setError] = useState(null);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [partnerJoined, setPartnerJoined] = useState(false);
  const partnerJoinedRef = useRef(false);
  const setPartnerJoinedWithRef = (val) => {
    partnerJoinedRef.current = val;
    setPartnerJoined(val);
  };

  const [callMissed, setCallMissed] = useState(false);
  const callMissedRef = useRef(false);
  const setCallMissedWithRef = (val) => {
    callMissedRef.current = val;
    setCallMissed(val);
  };
  const [isCallingState, setIsCallingState] = useState(false);
  const [isFocused, setIsFocused] = useState(true);

  const currentCallIdRef = useRef(params.callId || params.call_id || null);

  // ✅ Keep ref synced with params
  useEffect(() => {
    if (params.callId || params.call_id) {
      currentCallIdRef.current = String(params.callId || params.call_id);
    }
  }, [params.callId, params.call_id]);

  const isEndingRef = useRef(false);
  const wsRef = useRef(null);
  const roomRef = useRef(null);
  const timeoutRef = useRef(null);
  const callerMissedTimeoutRef = useRef(null);
  const hasAnsweredRef = useRef(false);
  const isCallerRef = useRef(!params.callId && !params.call_id);
  
  const durationRef = useRef(0);
  useEffect(() => {
    const safeDuration = typeof callState.duration === 'number' ? callState.duration : 0;
    durationRef.current = safeDuration;
  }, [callState.duration]);

  useEffect(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []);

  useEffect(() => {
    const onBackPress = () => {
      // ✅ Block hardware back button if call is still connecting or ongoing
      // Only allow minimize if already fully joined and no error
      if (partnerJoinedRef.current && !callMissedRef.current && !error) {
        handleMinimize();
        return true;
      }
      console.log('[Call] Back button pressed - blocked (connecting/other state)');
      return true; // Block default back action
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [error]);

  const handleMinimize = () => {
    minimizeCall();
    navigation.goBack();
  };

  useEffect(() => {
    const participant = roomRef.current?.localParticipant;
    if (!participant) return;
    participant.setMicrophoneEnabled(!isMicMuted).catch(e => console.warn('[Call] Mic sync error:', e));
  }, [isMicMuted]);

  useEffect(() => {
    if (callType !== 'video') return;
    const participant = roomRef.current?.localParticipant;
    if (!participant) return;
    participant.setCameraEnabled(!isCameraOff).catch(e => console.warn('[Call] Camera sync error:', e));
  }, [isCameraOff, callType]);

  useEffect(() => {
    const uid = receiverId || params.caller_id;
    if (uid && !remoteUserPic && !isGroupCall) {
      fetchUserProfile(uid).then(pic => pic && setRemoteUserPic(pic));
    }
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('call_ended_globally', () => {
      if (!isEndingRef.current) handleEndCall(false);
    });
    return () => sub.remove();
  }, [handleEndCall]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('incoming_call', () => {
      console.log('[Call] New incoming call detected, checking if current UI should close');
      // If we are showing the "No answer" (missed) UI, close it automatically
      // so the user can see the new incoming call screen.
      if (callMissedRef.current && !isEndingRef.current) {
        console.log('[Call] Closing missed call UI to make way for new incoming call');
        handleEndCall(true); 
      }
    });
    return () => sub.remove();
  }, [handleEndCall]);

  useEffect(() => {
    if (params.isFromOverlay) {
      console.log('[Call] Returning from overlay, restoring state');
      
      const config = (params.token && params.serverUrl) 
        ? { token: params.token, serverUrl: params.serverUrl } 
        : (callState.liveKitConfig || null);

      if (config) {
        setLiveKitConfig(config);
      }
      
      if (params.callId) currentCallIdRef.current = String(params.callId);
      if (params.call_id) currentCallIdRef.current = String(params.call_id);
      
      // ✅ Force partnerJoined to be true so the UI skips 'Connecting...'
      setPartnerJoinedWithRef(true);
      
      // ✅ Explicitly set state to ensure 'Active' view is rendered immediately
      hasAnsweredRef.current = true;
      setRemoteUserPic(params.remoteUserPic || null);
      
      console.log('[Call] UI forced to Active state from overlay');
      
      // Use requestAnimationFrame to ensure the UI has registered the state change
      requestAnimationFrame(() => {
        const safeDuration = typeof callState.duration === 'number' ? callState.duration : 0;
        if (safeDuration >= 0) {
          setLocalDuration(safeDuration);
          startTimer();
        }
        
        if (currentCallIdRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
          setupSignaling(currentCallIdRef.current);
        }
      });
      
      return;
    }

    console.log('[Call] Initializing call with params:', { callType, isGroupCall, conversationId, receiverId, callId: currentCallIdRef.current });
    fcmService.setIsInCall(true);
    
    // Sync context with initial params
    startCall(params, liveKitConfig);
    
    if (liveKitConfig) {
      console.log('[Call] Already have token, skipping full initializeCall');
      // Still ensure signaling is up and context is aware
      if (currentCallIdRef.current) {
        setupSignaling(currentCallIdRef.current);
        updateCallParams({ ...params, callId: currentCallIdRef.current, ...liveKitConfig });
      }
    } else {
      initializeCall();
    }
    
    return () => {
      if (!callState.isMinimized && !callMissed) {
        cleanup();
        if (callerMissedTimeoutRef.current) {
          clearTimeout(callerMissedTimeoutRef.current);
          callerMissedTimeoutRef.current = null;
        }
      }
    };
  }, []);

  const setupSignaling = useCallback(async (callId) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) return;
      
      const endpoint = `call/${callId}`;
      const wsUrl = getWebSocketUrl(endpoint, token);
      
      console.log('[Call] Connecting signaling WS:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[Call] Signaling WS connected');
        if (callId) {
          ws.send(JSON.stringify({ type: 'call_joined', call_id: callId }));
        }
      };
      
      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          console.log('[Call] WS message received:', data.type);
          
          if (data.type === 'call_end') {
            const activeId = currentCallIdRef.current ? String(currentCallIdRef.current) : '';
            const msgId = data.call_id ? String(data.call_id) : '';
            
            console.log('[Call] WS message received: call_end', { msgId, activeId });
            
            if (msgId === activeId && !isEndingRef.current && !callMissedRef.current) {
              handleEndCall(true);
            }
          }
          
          if (data.type === 'call_rejected') {
            const activeId = currentCallIdRef.current ? String(currentCallIdRef.current) : '';
            const msgId = data.call_id ? String(data.call_id) : '';
            
            if (msgId && msgId === activeId && !isEndingRef.current) {
              console.log('[Call] Call rejected by peer');
              if (isCallerRef.current) {
                handleCallerMissed();
              } else {
                handleEndCall(true);
              }
            }
          }
          
          if (data.type === 'call_accepted' && isCallerRef.current) {
            console.log('[Call] Call accepted by peer');
            hasAnsweredRef.current = true;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }
        } catch (err) {
          console.warn('[Call] WS message parse error:', err);
        }
      };
      
      ws.onclose = () => {
        console.log('[Call] Signaling WS closed');
        wsRef.current = null;
      };
      
      ws.onerror = err => {
        console.error('[Call] WS error:', err);
      };
    } catch (err) {
      console.error('[Call] Error setting up signaling:', err);
    }
  }, []);

  const handleEndCall = async (navigateBack = true) => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    
    // ✅ Robustly recover call_id
    const callId = currentCallIdRef.current || params.callId || params.call_id;
    console.log('[Call] Ending call, recovered call_id:', callId);
    
    // 1. WebSocket signal cleanup (Must happen BEFORE local cleanup/tear-down)
    if (wsRef.current && callId) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          const endMessage = {
            type: 'call_end',
            call_id: String(callId),
            ended_by: 'local',
            timestamp: new Date().toISOString(),
          };
          console.log('[Call] Sending call_end signal to peer');
          wsRef.current.send(JSON.stringify(endMessage));
          // Wait briefly to allow the signal to flush
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (e) {
        console.warn('[Call] Failed to send WS signal:', e);
      }
    }

    // 2. Notify Backend API (Source of Truth)
    if (callId) {
      try {
        await api.post('/calls/end/', { call_id: parseInt(callId, 10) });
        console.log('[Call] Backend notified of call end');
      } catch (e) {
        console.warn('[Call] Backend end notification failed:', e);
      }
    }
    
    cleanup();
    fcmService.setIsInCall(false);
    if (callId) fcmService.markCallHandled(String(callId), 'incoming_call');
    endCallGlobal();
    
    if (navigateBack && isFocused) {
      // Use setImmediate to ensure navigation happens after all state updates
      setImmediate(() => {
        if (navigation.isFocused()) {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.reset({ index: 0, routes: [{ name: 'MainTabs', params: { screen: 'Chats' } }] });
        }
      });
    }
  };

  const [localDuration, setLocalDuration] = useState(0);
  
  useEffect(() => {
    if (callState.duration !== localDuration) {
      setLocalDuration(callState.duration);
    }
  }, [callState.duration]);

  const formatDuration = (secs) => {
    if (typeof secs !== 'number' || isNaN(secs) || secs < 0) {
      return '00:00';
    }
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handlePartnerJoined = useCallback(() => {
    console.log('[Call] Partner joined, clearing timeout and starting timer');
    hasAnsweredRef.current = true;
    setIsCallingState(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!partnerJoinedRef.current) {
      startTimer();
      setPartnerJoinedWithRef(true);
    }
  }, [startTimer]);

  const cleanup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
    }
    if (roomRef.current) {
      try { roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    try { InCallManager.stop(); } catch (_) {}
  };

  const handleCallerMissed = useCallback(async () => {
    console.log('[Call] Caller timeout: showing missed state');
    setCallMissedWithRef(true);
    setIsCallingState(false);
    fcmService.setIsInCall(false);

    if (currentCallIdRef.current && isCallerRef.current) {
      try {
        await api.post('/calls/end/', {
          call_id: parseInt(currentCallIdRef.current, 10),
          was_missed: true
        });
        console.log('[Call] Notified backend of caller timeout (missed)');
      } catch (e) {
        console.warn('[Call] Failed to notify backend of timeout:', e);
      }
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    if (roomRef.current) {
      try { roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
    }
    
    try { InCallManager.stop(); } catch (_) {}
    
    if (callerMissedTimeoutRef.current) {
      clearTimeout(callerMissedTimeoutRef.current);
    }
    
    // ✅ Keep screen open for 30 seconds for "Call again" option
    callerMissedTimeoutRef.current = setTimeout(() => {
      console.log('[Call] Callback screen auto-closing after 30s');
      // Only close if we haven't already started a new call or closed manually
      if (isFocused && !isEndingRef.current && callMissedRef.current) {
        handleEndCall(true);
      }
    }, 30_000);
  }, [isFocused, handleEndCall]);

  const initializeCall = async () => {
    fcmService.setIsInCall(true);
    setCallMissedWithRef(false);
    setError(null);
    setPartnerJoinedWithRef(false);
    setLocalDuration(0);
    updateDuration(0);
    setIsCallingState(false);
    hasAnsweredRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (callerMissedTimeoutRef.current) clearTimeout(callerMissedTimeoutRef.current);
    isEndingRef.current = false;

    if (params.token && params.serverUrl) {
      console.log('[Call] Using pre-fetched token');
      if (params.callId) currentCallIdRef.current = String(params.callId);
      if (params.call_id) currentCallIdRef.current = String(params.call_id);
      isCallerRef.current = false;
      const config = { token: params.token, serverUrl: params.serverUrl };
      setLiveKitConfig(config);
      setLiveKitConfigGlobal(config);
      await setupSignaling(currentCallIdRef.current);
      return;
    }

    try {
      const hasPermission = await ensureCallPermissions(callType);
      if (!hasPermission) {
        Alert.alert('Permission Required', callType === 'video' ? 'Microphone and Camera are required' : 'Microphone is required', 
          [{ text: 'OK', onPress: () => handleEndCall() }]);
        return;
      }

      let token, serverUrl;
      let finalCallId = currentCallIdRef.current;

      if (isGroupCall) {
        if (params.initiating) {
          const res = await api.post('/calls/group/initiate/', { conversation_id: conversationId, call_type: callType });
          token = res.data.token; serverUrl = res.data.server_url; finalCallId = res.data.call_id;
          isCallerRef.current = true;
        } else {
          const res = await api.post('/calls/livekit/token/', { conversation_id: conversationId, call_type: callType });
          token = res.data.token; serverUrl = res.data.server_url;
          isCallerRef.current = false;
        }
      } else {
        if (params.token && params.serverUrl) {
          token = params.token; serverUrl = params.serverUrl; finalCallId = finalCallId || params.callId;
          isCallerRef.current = false;
        } else if (!finalCallId && receiverId) {
          const res = await api.post('/calls/initiate/', { receiver_id: receiverId, call_type: callType });
          token = res.data.token; serverUrl = res.data.server_url; finalCallId = res.data.call_id;
          isCallerRef.current = true;
        } else {
          const res = await api.post('/calls/livekit/token/', { call_id: finalCallId, receiver_id: receiverId, call_type: callType });
          token = res.data.token; serverUrl = res.data.server_url;
          isCallerRef.current = false;
        }
      }

      if (!token || !serverUrl) throw new Error('No token or server URL');
      if (finalCallId) {
        currentCallIdRef.current = String(finalCallId);
        updateCallParams({ ...params, callId: finalCallId });
      }

      if (isCallerRef.current && !isGroupCall) {
        setIsCallingState(true);
      }

      if (finalCallId && !isGroupCall && isCallerRef.current) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          console.log('[Call] Timeout: no answer after 30 seconds');
          if (!hasAnsweredRef.current && !isEndingRef.current) {
            if (isCallerRef.current) {
              handleCallerMissed();
            }
          }
        }, CALL_TIMEOUT_MS);
      }

      console.log('[Call] Got LiveKit config');
      const config = { token, serverUrl };
      setLiveKitConfig(config);
      setLiveKitConfigGlobal(config);
      updateCallParams({ ...params, callId: currentCallIdRef.current, ...config });
      await setupSignaling(currentCallIdRef.current);
    } catch (err) {
      console.error('[Call] Init error:', err);
      Toast.show({
        type: 'error',
        text1: 'Connection lost',
        position: 'bottom',
      });
      handleEndCall();
    }
  };

  const handleCallAgain = () => {
    console.log('[Call] Initiating Call Again');
    if (callerMissedTimeoutRef.current) {
      clearTimeout(callerMissedTimeoutRef.current);
      callerMissedTimeoutRef.current = null;
    }
    
    cleanup();
    
    // ✅ Reset all critical state flags for a fresh start
    isEndingRef.current = false;
    hasAnsweredRef.current = false;
    currentCallIdRef.current = null;
    isCallerRef.current = true;
    
    partnerJoinedRef.current = false;
    callMissedRef.current = false;
    
    setLiveKitConfig(null);
    setLiveKitConfigGlobal(null);
    setCallMissed(false);
    setError(null);
    setPartnerJoined(false);
    setLocalDuration(0);
    updateDuration(0);
    setIsCallingState(true);
    
    // Defer the actual call initialization to allow state to settle
    setImmediate(() => {
      initializeCall();
    });
  };

  const onRoomConnected = useCallback((room) => {
    roomRef.current = room;
    console.log('[Call] Room captured, setting up initial state');
    
    try {
      room.localParticipant.setMicrophoneEnabled(true);
      if (callType === 'video') room.localParticipant.setCameraEnabled(true);
    } catch (e) {}

    if (isGroupCall && !partnerJoined) {
      console.log('[Call] Group call joined, starting timer');
      startTimer();
      setPartnerJoined(true);
    }
    
    if (!isGroupCall && partnerJoined && !callState.isTimerRunning) {
      console.log('[Call] Restoring 1-to-1 timer after overlay, duration:', localDuration);
      startTimer();
    }
  }, [isGroupCall, partnerJoined, callType, localDuration, callState.isTimerRunning, startTimer]);

  if (callMissed && isCallerRef.current) {
    return (
      <View style={styles.missedContainer}>
        <Icon name="call-outline" size={80} color="#FF3B30" />
        <Text style={styles.missedTitle}>No answer</Text>
        <Text style={styles.missedSubtitle}>
          {remoteUserName} didn't answer the call.
        </Text>
        <TouchableOpacity style={styles.callAgainButton} onPress={handleCallAgain}>
          <Icon name="call" size={24} color="#fff" />
          <Text style={styles.callAgainText}>Call again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.goBackButton} onPress={() => handleEndCall(true)}>
          <Text style={styles.goBackText}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.autoCloseHint}>
          Screen will close in 30s
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.endCallBtn} onPress={() => handleEndCall(false)}>
          <Text style={styles.endCallBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ✅ Removed conditional 'Restoring/Connecting' screen to force active UI
  // The UI will now immediately render the container with the LiveKitRoom.

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <TouchableOpacity style={styles.backButton} onPress={handleMinimize}>
        <Icon name="chevron-down" size={30} color="#fff" />
      </TouchableOpacity>

      <LiveKitRoom
        serverUrl={liveKitConfig?.serverUrl || 'https://dummy.url'}
        token={liveKitConfig?.token || 'dummy_token'}
        connect={!!liveKitConfig}
        audio={true}
        video={callType === 'video'}
        onDisconnected={() => {
          console.log('[Call] LiveKitRoom onDisconnected');
          // ✅ Use Refs to ensure we have the latest state in this long-lived callback
          if (!isEndingRef.current && partnerJoinedRef.current && !callMissedRef.current) {
            handleEndCall();
          }
        }}
        onError={err => {
          const msg = err?.message || '';
          if (msg.includes('Client initiated disconnect')) return;
          if (msg.includes('NegotiationError')) return;
          if (msg.includes('cancelled')) return;
          
          Toast.show({
            type: 'error',
            text1: 'Connection lost',
            position: 'bottom',
          });
          handleEndCall();
        }}
      >
        <RoomCapture onRoom={onRoomConnected} />
        {isGroupCall ? (
          <GroupCallView callType={callType} />
        ) : callType === 'video' ? (
          <VideoParticipantView
            onPartnerJoined={handlePartnerJoined}
            remoteUserName={remoteUserName}
            remoteUserPic={remoteUserPic}
            callType={callType}
            isCallingState={isCallingState}
          />
        ) : (
          <AudioParticipantView
            onPartnerJoined={handlePartnerJoined}
            remoteUserName={remoteUserName}
            remoteUserPic={remoteUserPic}
            partnerJoined={partnerJoined}
            isCallingState={isCallingState}
          />
        )}
      </LiveKitRoom>

      <View style={styles.topBar}>
        {partnerJoined && (
          <Text style={styles.statusText}>
            {formatDuration(localDuration)}
          </Text>
        )}
        <Text style={styles.callTypeLabel}>
          {isGroupCall ? 'Group ' : ''}{callType === 'video' ? 'Video' : 'Audio'} Call
        </Text>
      </View>

      {!callMissed && (
        <View style={styles.controlsContainer}>
          <TouchableOpacity
            style={[styles.controlButton, isSpeakerOn && styles.controlButtonActive]}
            onPress={() => {
              const next = !isSpeakerOn;
              setIsSpeakerOn(next);
              try { InCallManager.setSpeakerphoneOn(next); } catch (_) {}
            }}>
            <Icon name={isSpeakerOn ? 'volume-high' : 'volume-mute'} size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlButton, isMicMuted && styles.controlButtonMuted]}
            onPress={() => setIsMicMuted(prev => !prev)}>
            <Icon name={isMicMuted ? 'mic-off' : 'mic'} size={22} color="#fff" />
          </TouchableOpacity>

          {callType === 'video' && (
            <TouchableOpacity
              style={[styles.controlButton, isCameraOff && styles.controlButtonMuted]}
              onPress={() => setIsCameraOff(prev => !prev)}>
              <Icon name={isCameraOff ? 'videocam-off' : 'videocam'} size={24} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Add Participant Button */}
          <TouchableOpacity 
            style={styles.controlButton} 
            onPress={() => navigation.navigate('NewChat', { 
              conversationId: conversationId, 
              receiverId: receiverId,
              isAdding: true, 
              isInvitingToCall: true,
              roomName: roomRef.current?.name || params.room_id || params.roomName,
              callId: currentCallIdRef.current,
              callType: callType
            })}>
            <Icon name="person-add" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.endCallBtn} onPress={() => handleEndCall()}>
            <Icon name="call" size={22} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  backButton: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 16, zIndex: 40, padding: 8 },
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 52 : 28, left: 0, right: 0, alignItems: 'center', zIndex: 30, paddingHorizontal: 20 },
  statusText: { fontSize: 18, color: '#fff', fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  callTypeLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  controlsContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, zIndex: 30, paddingBottom: Platform.OS === 'ios' ? 40 : 30, paddingTop: 20, paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.55)' },
  controlButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80,80,90,0.85)', width: 58, height: 58, borderRadius: 29, gap: 2 },
  controlButtonActive: { backgroundColor: '#34C759' },
  controlButtonMuted: { backgroundColor: '#FF3B30' },
  endCallBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF3B30', width: 58, height: 58, borderRadius: 29, gap: 2 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  loadingText: { color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '500' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 30 },
  errorText: { color: '#FF3B30', fontSize: 16, marginBottom: 24, textAlign: 'center' },
  missedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 30 },
  missedTitle: { color: '#fff', fontSize: 28, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  missedSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, textAlign: 'center', marginBottom: 40 },
  callAgainButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#34C759', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 40, gap: 12, marginBottom: 16 },
  callAgainText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  goBackButton: { paddingVertical: 12 },
  goBackText: { color: '#007AFF', fontSize: 16, fontWeight: '500' },
  autoCloseHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 16,
    fontStyle: 'italic',
  },
  fullScreenContainer: { flex: 1, width: '100%', height: '100%', backgroundColor: '#111' },
  fullScreenVideo: { flex: 1, width: '100%', height: '100%' },
  fullScreenPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1C1C1E' },
  callingOverlay: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  callingName: { color: '#fff', fontSize: 20, fontWeight: '600', textShadowRadius: 4 },
  callingSubtext: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 2 },
  miniVideoContainer: { position: 'absolute', top: Platform.OS === 'ios' ? 90 : 60, right: 16, width: 100, height: 148, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: '#000', zIndex: 25, elevation: 8 },
  miniVideo: { width: '100%', height: '100%' },
  miniPlaceholder: { flex: 1, backgroundColor: '#2C2C2E', justifyContent: 'center', alignItems: 'center' },
  miniSwapHint: { position: 'absolute', bottom: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: 3 },
  audioCallContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1C1C1E' },
  audioAvatarContainer: { alignItems: 'center' },
  largeProfilePic: { width: 140, height: 140, borderRadius: 70, marginBottom: 20, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  avatarPlaceholder: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#2C2C2E', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)' },
  audioRemoteName: { color: '#fff', fontSize: 26, fontWeight: '700', marginBottom: 6 },
  audioCallStatus: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: 20 },
  audioWave: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  audioWaveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34C759' },
  placeholderText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 12 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#111' },
  groupTile: { width: width / 2, height: height / 3, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#333', position: 'relative' },
  video: { flex: 1, width: '100%', height: '100%' },
  participantNameBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  participantNameText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  gridPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1C1C1E' },
  groupAudioContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  groupAudioCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, marginVertical: 8, width: '80%' },
  groupAudioAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  groupAudioName: { color: '#fff', fontSize: 18, fontWeight: '500' },
  groupAudioAvatarLocal: { backgroundColor: '#8100D1' },
  groupAudioStatus: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  activeSpeakerBorder: { borderWidth: 2, borderColor: '#34C759', borderRadius: 12 },
  speakingStatus: { color: '#34C759', fontSize: 11, fontWeight: 'bold' },
  groupAudioWaiting: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  groupAudioWaitingText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, textAlign: 'center' },
});

export default CallScreen;