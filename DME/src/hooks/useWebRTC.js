/**
 * useWebRTC Hook
 * 
 * React hook for WebRTC calling functionality.
 * Provides state management and controls for audio/video calls.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import webrtcService from '../services/webrtcService';
import { useWebSocket } from './useWebSocket'; // Assuming you have this hook

export function useWebRTC() {
  // Call state
  const [callState, setCallState] = useState('idle'); // 'idle', 'initiating', 'ringing', 'connecting', 'connected', 'ended'
  const [callType, setCallType] = useState('audio'); // 'audio' or 'video'
  const [callId, setCallId] = useState(null);
  const [remoteUserId, setRemoteUserId] = useState(null);
  const [callerInfo, setCallerInfo] = useState(null);

  // Media state
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);

  // Error state
  const [error, setError] = useState(null);

  // WebSocket reference for signaling
  const callWebSocketRef = useRef(null);

  /**
   * Initialize local media stream
   */
  const initializeMedia = useCallback(async (type = 'audio') => {
    try {
      setError(null);
      setCallType(type);
      const stream = await webrtcService.initializeLocalStream(type);
      setLocalStream(stream);
      setIsVideoEnabled(type === 'video');
      return stream;
    } catch (err) {
      console.error('[useWebRTC] Error initializing media:', err);
      setError('Failed to access camera/microphone');
      throw err;
    }
  }, []);

  /**
   * Start an outgoing call
   */
  const startCall = useCallback(async (receiverId, type = 'audio') => {
    try {
      setError(null);
      setCallState('initiating');
      setRemoteUserId(receiverId);

      // Initialize media
      await initializeMedia(type);

      // Create caller peer connection
      const peerConnection = await webrtcService.createCallerPeerConnection(Date.now().toString());

      // Set up callbacks
      webrtcService.setCallbacks({
        onIceCandidate: async (candidate) => {
          console.log('[useWebRTC] Sending ICE candidate');
          if (callWebSocketRef.current) {
            callWebSocketRef.current.send({
              type: 'ice_candidate',
              call_id: callId,
              candidate: candidate,
            });
          }
        },
        onTrack: (stream) => {
          console.log('[useWebRTC] Remote track received');
          setRemoteStream(stream);
        },
        onConnectionStateChange: (state) => {
          console.log('[useWebRTC] Connection state:', state);
          if (state === 'connected') {
            setCallState('connected');
          } else if (state === 'disconnected' || state === 'failed') {
            setCallState('ended');
          }
        },
      });

      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Send offer via WebSocket
      if (callWebSocketRef.current) {
        callWebSocketRef.current.send({
          type: 'call_offer',
          receiver_id: receiverId,
          call_type: type,
          call_id: peerConnection.sdpMid || Date.now().toString(),
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        });
      }

      setCallId(peerConnection.sdpMid || Date.now().toString());
      setCallState('ringing');

      return { success: true, callId: peerConnection.sdpMid };
    } catch (err) {
      console.error('[useWebRTC] Error starting call:', err);
      setError('Failed to start call');
      setCallState('ended');
      return { success: false, error: err.message };
    }
  }, [initializeMedia, callId]);

  /**
   * Accept an incoming call
   */
  const acceptCall = useCallback(async (incomingCallData) => {
    try {
      setError(null);
      setCallState('connecting');
      setCallId(incomingCallData.call_id);
      setRemoteUserId(incomingCallData.caller_id);
      setCallerInfo({
        id: incomingCallData.caller_id,
        name: incomingCallData.caller_name,
      });

      // Initialize media based on call type
      const type = incomingCallData.call_type || 'audio';
      await initializeMedia(type);

      // Create receiver peer connection
      const { answer } = await webrtcService.createReceiverPeerConnection(
        incomingCallData.call_id,
        incomingCallData.offer
      );

      // Set up callbacks
      webrtcService.setCallbacks({
        onIceCandidate: async (candidate) => {
          console.log('[useWebRTC] Sending ICE candidate');
          if (callWebSocketRef.current) {
            callWebSocketRef.current.send({
              type: 'ice_candidate',
              call_id: incomingCallData.call_id,
              candidate: candidate,
            });
          }
        },
        onTrack: (stream) => {
          console.log('[useWebRTC] Remote track received');
          setRemoteStream(stream);
        },
        onConnectionStateChange: (state) => {
          console.log('[useWebRTC] Connection state:', state);
          if (state === 'connected') {
            setCallState('connected');
          } else if (state === 'disconnected' || state === 'failed') {
            setCallState('ended');
          }
        },
      });

      // Send answer via WebSocket
      if (callWebSocketRef.current) {
        callWebSocketRef.current.send({
          type: 'call_answer',
          call_id: incomingCallData.call_id,
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
        });
      }

      return { success: true };
    } catch (err) {
      console.error('[useWebRTC] Error accepting call:', err);
      setError('Failed to accept call');
      setCallState('ended');
      return { success: false, error: err.message };
    }
  }, [initializeMedia]);

  /**
   * Reject an incoming call
   */
  const rejectCall = useCallback(async (incomingCallId) => {
    try {
      if (callWebSocketRef.current) {
        callWebSocketRef.current.send({
          type: 'call_reject',
          call_id: incomingCallId,
        });
      }
      setCallState('ended');
      return { success: true };
    } catch (err) {
      console.error('[useWebRTC] Error rejecting call:', err);
      return { success: false, error: err.message };
    }
  }, []);

  /**
   * End the current call
   */
  const endCall = useCallback(async () => {
    try {
      if (callWebSocketRef.current && callId) {
        callWebSocketRef.current.send({
          type: 'call_end',
          call_id: callId,
        });
      }
      await webrtcService.endCall();
      setCallState('ended');
      setLocalStream(null);
      setRemoteStream(null);
      setCallId(null);
      setRemoteUserId(null);
      setCallerInfo(null);
      return { success: true };
    } catch (err) {
      console.error('[useWebRTC] Error ending call:', err);
      return { success: false, error: err.message };
    }
  }, [callId]);

  /**
   * Toggle audio (mute/unmute)
   */
  const toggleAudio = useCallback(() => {
    const newState = webrtcService.toggleAudio();
    setIsAudioEnabled(newState);
    return newState;
  }, []);

  /**
   * Toggle video (camera on/off)
   */
  const toggleVideo = useCallback(() => {
    const newState = webrtcService.toggleVideo();
    setIsVideoEnabled(newState);
    return newState;
  }, []);

  /**
   * Switch camera (front/back)
   */
  const switchCamera = useCallback(async () => {
    const success = await webrtcService.switchCamera();
    if (success) {
      setIsFrontCamera((prev) => !prev);
    }
    return success;
  }, []);

  /**
   * Handle incoming WebSocket messages for call signaling
   */
  const handleSignalingMessage = useCallback(async (message) => {
    console.log('[useWebRTC] Signaling message:', message.type);

    switch (message.type) {
      case 'call_offer':
        // Incoming call - show ringing screen
        setCallState('ringing');
        setCallId(message.call_id);
        setRemoteUserId(message.caller_id);
        setCallerInfo({
          id: message.caller_id,
          name: message.caller_name,
        });
        setCallType(message.call_type);
        // Store offer for when user accepts
        return { type: 'incoming_call', data: message };

      case 'call_answer':
        // Receiver answered - set remote description
        if (callId === message.call_id) {
          await webrtcService.setRemoteDescription(message.answer);
        }
        break;

      case 'ice_candidate':
        // Add ICE candidate
        if (message.candidate) {
          await webrtcService.addIceCandidate(message.candidate);
        }
        break;

      case 'call_rejected':
        // Call was rejected
        setCallState('ended');
        setError('Call was rejected');
        break;

      case 'call_end':
      case 'call_ended':
        // Call ended by other party
        setCallState('ended');
        await webrtcService.endCall();
        break;

      default:
        console.warn('[useWebRTC] Unknown signaling message:', message.type);
    }

    return null;
  }, [callId]);

  /**
   * Set WebSocket connection for signaling
   */
  const setCallWebSocket = useCallback((ws) => {
    callWebSocketRef.current = ws;
  }, []);

  /**
   * Reset call state
   */
  const resetCallState = useCallback(() => {
    setCallState('idle');
    setCallId(null);
    setRemoteUserId(null);
    setCallerInfo(null);
    setLocalStream(null);
    setRemoteStream(null);
    setError(null);
    setIsAudioEnabled(true);
    setIsVideoEnabled(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      webrtcService.endCall();
    };
  }, []);

  return {
    // State
    callState,
    callType,
    callId,
    remoteUserId,
    callerInfo,
    localStream,
    remoteStream,
    isAudioEnabled,
    isVideoEnabled,
    isFrontCamera,
    error,

    // Actions
    initializeMedia,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    switchCamera,
    handleSignalingMessage,
    setCallWebSocket,
    resetCallState,
  };
}

export default useWebRTC;
