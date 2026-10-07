// src/hooks/useMusicVoiceChat.ts
//
// React hook that wraps MusicVoiceChatService.
// Exposes: isMicOn, toggleMic, voiceParticipants.
// All WebRTC peer lifecycle is handled inside the service;
// this hook only bridges state to React.

import { useState, useEffect, useCallback, useRef } from 'react';
import { PermissionsAndroid, Platform, Alert } from 'react-native';
import { VoiceParticipant, musicVoiceChatService } from '../services/MusicVoiceChatService';
import { Participant } from './useMusicRoom';

export function useMusicVoiceChat(
  myUserId: number,
  participants: Participant[],
) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<number, VoiceParticipant>>(new Map());
  const prevParticipantIdsRef = useRef<Set<number>>(new Set());

  // Init service on mount, destroy on unmount
  useEffect(() => {
    if (!myUserId) return;
    musicVoiceChatService.init(myUserId);

    const unsub = musicVoiceChatService.onStateChange((p) => {
      setVoiceParticipants(p);
    });

    return () => {
      unsub();
      musicVoiceChatService.destroy();
    };
  }, [myUserId]);

  // When a new participant joins while mic is on, connect to them
  useEffect(() => {
    if (!isMicOn) return;
    const currentIds = new Set(participants.map((p) => p.user_id));
    for (const id of currentIds) {
      if (!prevParticipantIdsRef.current.has(id) && id !== myUserId) {
        musicVoiceChatService.connectToNewParticipant(id);
      }
    }
    // Remove peers who left
    for (const id of prevParticipantIdsRef.current) {
      if (!currentIds.has(id)) {
        musicVoiceChatService.removeParticipant(id);
      }
    }
    prevParticipantIdsRef.current = currentIds;
  }, [participants, isMicOn, myUserId]);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'Allow access to your microphone to voice chat in this Music Room.',
          buttonNeutral: 'Ask Later',
          buttonNegative: 'Deny',
          buttonPositive: 'Allow',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const toggleMic = useCallback(async () => {
    if (isMicOn) {
      musicVoiceChatService.disableMic();
      setIsMicOn(false);
      return;
    }

    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      Alert.alert(
        'Microphone Denied',
        'Please enable microphone access in your device settings to use voice chat.',
      );
      return;
    }

    try {
      const participantIds = participants.map((p) => p.user_id);
      prevParticipantIdsRef.current = new Set(participantIds);
      await musicVoiceChatService.enableMic(participantIds);
      setIsMicOn(true);
    } catch (e) {
      console.error('[useMusicVoiceChat] enableMic error:', e);
      Alert.alert('Voice Chat Error', 'Could not start microphone. Please try again.');
    }
  }, [isMicOn, participants, requestMicPermission]);

  return { isMicOn, toggleMic, voiceParticipants };
}
