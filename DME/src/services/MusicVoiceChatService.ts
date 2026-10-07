// src/services/MusicVoiceChatService.ts
//
// WebRTC P2P mesh voice chat for MusicRoom with Deterministic Signaling.
// Exactly one offer is initiated per peer pair (lower userId initiates).
// Signaling travels over the existing MusicWebSocketService.
// No LiveKit or external audio SDK is used — audio only.

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from '@livekit/react-native-webrtc';
import musicWebSocketService from './MusicWebSocketService';

// ── ICE Config ────────────────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export type VoiceParticipant = {
  userId: number;
  isSpeaking: boolean;
  stream: MediaStream | null;
};

type StateListener = (participants: Map<number, VoiceParticipant>) => void;

class MusicVoiceChatService {
  private myUserId: number = 0;
  private localStream: MediaStream | null = null;
  private peers: Map<number, RTCPeerConnection> = new Map();
  private remoteStreams: Map<number, MediaStream> = new Map();
  private voiceParticipants: Map<number, VoiceParticipant> = new Map();
  private isMicActive: boolean = false;
  private wsUnsubscribe: (() => void) | null = null;
  private stateListeners: Set<StateListener> = new Set();
  private pendingIceCandidates: Map<number, RTCIceCandidateInit[]> = new Map();

  init(myUserId: number) {
    this.myUserId = myUserId;
    this.wsUnsubscribe?.();
    this.wsUnsubscribe = musicWebSocketService.onMessage(async (msg) => {
      if (msg.type === 'webrtc_offer') await this.handleOffer(msg.data);
      else if (msg.type === 'webrtc_answer') await this.handleAnswer(msg.data);
      else if (msg.type === 'webrtc_ice') await this.handleIce(msg.data);
      else if (msg.type === 'webrtc_request_offer') await this.handleRequestOffer(msg.data);
    });
  }

  async enableMic(participantUserIds: number[]): Promise<void> {
    if (this.isMicActive) return;
    this.localStream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    } as any);
    this.isMicActive = true;

    const others = participantUserIds.filter((id) => id !== this.myUserId);
    for (const remoteId of others) {
      if (this.myUserId < remoteId) {
        // Lower ID initiates the offer directly
        this.createOfferFor(remoteId);
      } else {
        // Higher ID requests an offer from the lower ID peer
        musicWebSocketService.sendWebRTCRequestOffer(remoteId);
      }
    }
  }

  disableMic() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.isMicActive = false;
    this.peers.forEach((pc) => {
      try { pc.close(); } catch (_) {}
    });
    this.peers.clear();
    this.remoteStreams.clear();
    this.pendingIceCandidates.clear();
    this.voiceParticipants.clear();
    this.notifyListeners();
  }

  async connectToNewParticipant(userId: number): Promise<void> {
    if (!this.isMicActive || userId === this.myUserId) return;
    if (this.myUserId < userId) {
      this.createOfferFor(userId);
    } else {
      musicWebSocketService.sendWebRTCRequestOffer(userId);
    }
  }

  removeParticipant(userId: number) {
    const pc = this.peers.get(userId);
    if (pc) {
      try { pc.close(); } catch (_) {}
    }
    this.peers.delete(userId);
    this.remoteStreams.delete(userId);
    this.pendingIceCandidates.delete(userId);
    this.voiceParticipants.delete(userId);
    this.notifyListeners();
  }

  isMicOn(): boolean { return this.isMicActive; }

  getVoiceParticipants(): Map<number, VoiceParticipant> { return this.voiceParticipants; }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  destroy() {
    this.disableMic();
    this.wsUnsubscribe?.();
    this.wsUnsubscribe = null;
    this.stateListeners.clear();
  }

  private getOrCreatePeer(remoteUserId: number, forceNew: boolean = false): RTCPeerConnection {
    const existing = this.peers.get(remoteUserId);
    if (!forceNew && existing && existing.signalingState !== 'closed') {
      return existing;
    }

    if (existing) {
      try { existing.close(); } catch (_) {}
      this.peers.delete(remoteUserId);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS } as any);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          (pc as any).addTrack(track, this.localStream!);
        } catch (_) {}
      });
    } else {
      try {
        (pc as any).addTransceiver('audio', { direction: 'sendrecv' });
      } catch (_) {}
    }

    (pc as any).ontrack = (event: any) => {
      console.log('🎙️ [VoiceChat] Remote audio track received from user:', remoteUserId);
      const stream: MediaStream = event.streams?.[0] ?? new MediaStream([event.track]);
      this.remoteStreams.set(remoteUserId, stream);
      this.updateVoiceParticipant(remoteUserId, { stream });
    };

    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        const c = typeof event.candidate.toJSON === 'function'
          ? event.candidate.toJSON()
          : {
              candidate: event.candidate.candidate,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sdpMid: event.candidate.sdpMid,
            };
        musicWebSocketService.sendWebRTCIce(remoteUserId, c);
      }
    };

    (pc as any).onconnectionstatechange = () => {
      const state = (pc as any).connectionState;
      console.log(`🎙️ [VoiceChat] Peer ${remoteUserId} connection state:`, state);
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.removeParticipant(remoteUserId);
      }
    };

    this.peers.set(remoteUserId, pc);
    return pc;
  }

  private async handleRequestOffer(data: { from_user_id: number }) {
    const { from_user_id } = data;
    console.log('🎙️ [VoiceChat] Offer requested by user:', from_user_id);
    await this.createOfferFor(from_user_id);
  }

  private async createOfferFor(remoteUserId: number): Promise<void> {
    try {
      console.log('🎙️ [VoiceChat] Creating offer for user:', remoteUserId);
      const pc = this.getOrCreatePeer(remoteUserId, true);

      const offer = await (pc as any).createOffer({ offerToReceiveAudio: true });
      await (pc as any).setLocalDescription(offer);
      const payload = typeof offer.toJSON === 'function'
        ? offer.toJSON()
        : { type: offer.type, sdp: offer.sdp };
      musicWebSocketService.sendWebRTCOffer(remoteUserId, payload);
      console.log('🎙️ [VoiceChat] Offer sent to user:', remoteUserId);
    } catch (e) {
      console.error('❌ [VoiceChat] createOfferFor error:', remoteUserId, e);
    }
  }

  private async handleOffer(data: { from_user_id: number; payload: any }) {
    try {
      const { from_user_id, payload } = data;
      console.log('🎙️ [VoiceChat] Received offer from user:', from_user_id);
      
      const pc = this.getOrCreatePeer(from_user_id, true);
      await (pc as any).setRemoteDescription(new RTCSessionDescription(payload));

      const pending = this.pendingIceCandidates.get(from_user_id) ?? [];
      for (const c of pending) {
        await (pc as any).addIceCandidate(new RTCIceCandidate(c));
      }
      this.pendingIceCandidates.delete(from_user_id);

      const answer = await (pc as any).createAnswer();
      await (pc as any).setLocalDescription(answer);
      const answerPayload = typeof answer.toJSON === 'function'
        ? answer.toJSON()
        : { type: answer.type, sdp: answer.sdp };
      musicWebSocketService.sendWebRTCAnswer(from_user_id, answerPayload);
      console.log('🎙️ [VoiceChat] Answer sent to user:', from_user_id);
    } catch (e) {
      console.error('❌ [VoiceChat] handleOffer error:', e);
    }
  }

  private async handleAnswer(data: { from_user_id: number; payload: any }) {
    try {
      const { from_user_id, payload } = data;
      console.log('🎙️ [VoiceChat] Received answer from user:', from_user_id);
      const pc = this.peers.get(from_user_id);
      if (!pc) return;

      const state = (pc as any).signalingState;
      if (state && state !== 'have-local-offer') {
        console.log(`🎙️ [VoiceChat] Skipping answer from ${from_user_id}, state is already: ${state}`);
        return;
      }

      await (pc as any).setRemoteDescription(new RTCSessionDescription(payload));
      console.log('🎙️ [VoiceChat] Remote description set for answer from user:', from_user_id);

      const pending = this.pendingIceCandidates.get(from_user_id) ?? [];
      for (const c of pending) {
        await (pc as any).addIceCandidate(new RTCIceCandidate(c));
      }
      this.pendingIceCandidates.delete(from_user_id);
    } catch (e: any) {
      if (e?.message?.includes('Called in wrong state') || e?.message?.includes('stable')) {
        console.log(`🎙️ [VoiceChat] Peer ${data.from_user_id} is already connected (stable).`);
      } else {
        console.error('❌ [VoiceChat] handleAnswer error:', e);
      }
    }
  }

  private async handleIce(data: { from_user_id: number; payload: any }) {
    try {
      const { from_user_id, payload } = data;
      const pc = this.peers.get(from_user_id);
      if (!pc) return;
      if (!(pc as any).remoteDescription?.type) {
        const queue = this.pendingIceCandidates.get(from_user_id) ?? [];
        queue.push(payload);
        this.pendingIceCandidates.set(from_user_id, queue);
        return;
      }
      await (pc as any).addIceCandidate(new RTCIceCandidate(payload));
    } catch (e) {
      console.error('❌ [VoiceChat] handleIce error:', e);
    }
  }

  private updateVoiceParticipant(userId: number, partial: Partial<VoiceParticipant>) {
    const existing = this.voiceParticipants.get(userId) ?? { userId, isSpeaking: false, stream: null };
    this.voiceParticipants.set(userId, { ...existing, ...partial });
    this.notifyListeners();
  }

  private notifyListeners() {
    this.stateListeners.forEach((l) => l(new Map(this.voiceParticipants)));
  }
}

export const musicVoiceChatService = new MusicVoiceChatService();
export default musicVoiceChatService;

