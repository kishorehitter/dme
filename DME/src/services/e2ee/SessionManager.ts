import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyManager, getActiveUserId } from './KeyManager';
import { X3DH, RecipientKeyBundle } from './X3DH';
import { DoubleRatchet, RatchetState } from './DoubleRatchet';
import { uint8ArrayToBase64, base64ToUint8Array, utf8ToBytes, bytesToUtf8 } from './CryptoUtils';
import api from '../api';

export interface EncryptedEnvelope {
    senderIdentityKey: string;
    senderEphemeralKey?: string;
    usedOneTimePreKeyId?: number;
    usedSignedPreKeyId?: number;
    isInitialMessage: boolean;
    ratchetHeader: {
        dh: string;
        pn: number;
        n: number;
    };
    ciphertext: string;
}

export class SessionManager {
    /** Get an existing session or initiate a new one via X3DH */
    static async getOrCreateSession(userId: string | number): Promise<RatchetState> {
        try {
            const uid = String(userId);
            const existingSession = await this.loadSession(uid);
            if (existingSession) {
                if (existingSession.CKr === null && !existingSession.initialMetadata?.senderEphemeralKey) {
                    console.log('[E2EE] Upgrading legacy session metadata for user', uid);
                } else {
                    return existingSession;
                }
            }

            const response = await api.get(`/e2ee/keys/${uid}/bundle/`);
            const recipientBundleData = response.data;
            
            const recipientBundle: RecipientKeyBundle = {
                identityKey: base64ToUint8Array(recipientBundleData.identity_key),
                signedPreKey: {
                    keyId: recipientBundleData.signed_prekey.key_id,
                    publicKey: base64ToUint8Array(recipientBundleData.signed_prekey.public_key),
                    signature: base64ToUint8Array(recipientBundleData.signed_prekey.signature)
                }
            };

            if (recipientBundleData.one_time_prekey) {
                recipientBundle.oneTimePreKey = {
                    keyId: recipientBundleData.one_time_prekey.key_id,
                    publicKey: base64ToUint8Array(recipientBundleData.one_time_prekey.public_key)
                };
            }

            const identityKeyPair = await KeyManager.getIdentityKeyPair();
            const x3dhResult = await X3DH.initiateSession(identityKeyPair, recipientBundle);
            
            if (!x3dhResult.ephemeralKeyPair) {
                throw new Error("Ephemeral key pair generation failed during X3DH initiation");
            }
            
            let ratchetState = DoubleRatchet.initSender(x3dhResult.sharedSecret, recipientBundle.signedPreKey.publicKey);
            
            ratchetState.initialMetadata = {
                usedOneTimePreKeyId: x3dhResult.usedOneTimePreKeyId,
                usedSignedPreKeyId: recipientBundle.signedPreKey.keyId,
                senderEphemeralKey: uint8ArrayToBase64(x3dhResult.ephemeralKeyPair.publicKey)
            };
            
            await this.saveSession(userId, ratchetState);
            
            return ratchetState;
        } catch (e) {
            console.error("Error creating session:", e);
            throw e;
        }
    }

    /** Encrypt a message string for a specific user */
    static async encryptMessage(userId: string | number, plaintext: string): Promise<EncryptedEnvelope> {
        try {
            const uid = String(userId);
            let state = await this.getOrCreateSession(uid);
            
            const isInitialMessage = !!state.initialMetadata?.senderEphemeralKey || state.CKr === null;
            let senderEphemeralKey: string | undefined;
            let usedOneTimePreKeyId: number | undefined;
            let usedSignedPreKeyId: number | undefined;

            if (state.initialMetadata?.senderEphemeralKey) {
                senderEphemeralKey = state.initialMetadata.senderEphemeralKey;
                usedOneTimePreKeyId = state.initialMetadata.usedOneTimePreKeyId;
                usedSignedPreKeyId = state.initialMetadata.usedSignedPreKeyId;
            }

            const plaintextBytes = utf8ToBytes(plaintext);
            const { state: newState, header, ciphertext } = DoubleRatchet.ratchetEncrypt(state, plaintextBytes);
            newState.initialMetadata = state.initialMetadata;
            
            await this.saveSession(uid, newState);

            const identityKeyPair = await KeyManager.getIdentityKeyPair();

            const envelope: EncryptedEnvelope = {
                senderIdentityKey: uint8ArrayToBase64(identityKeyPair.publicKey),
                senderEphemeralKey,
                usedOneTimePreKeyId,
                usedSignedPreKeyId,
                isInitialMessage: true, // Always allow receiver to self-heal
                ratchetHeader: {
                    dh: uint8ArrayToBase64(header.dh),
                    pn: header.pn,
                    n: header.n
                },
                ciphertext: uint8ArrayToBase64(ciphertext)
            };

            return envelope;
        } catch (e) {
            console.error("Error encrypting message:", e);
            throw e;
        }
    }

    /** Decrypt an incoming message envelope from a user */
    static async decryptMessage(senderId: string | number, envelope: EncryptedEnvelope): Promise<string> {
        try {
            const sid = String(senderId);
            let state = await this.loadSession(sid);

            const initFromEnvelope = async (): Promise<RatchetState | null> => {
                if (!envelope.senderEphemeralKey) return null;
                const identityKeyPair = await KeyManager.getIdentityKeyPair();
                
                let signedPreKeyPair;
                if (envelope.usedSignedPreKeyId !== undefined) {
                    signedPreKeyPair = await KeyManager.getSignedPreKeyPair(envelope.usedSignedPreKeyId);
                } else {
                    signedPreKeyPair = await KeyManager.getSignedPreKeyPair(1);
                }
                
                let oneTimePreKeyPair;
                if (envelope.usedOneTimePreKeyId !== undefined) {
                    try {
                        oneTimePreKeyPair = await KeyManager.getOneTimePreKeyPair(envelope.usedOneTimePreKeyId);
                    } catch (otpkErr) {
                        console.warn('[E2EE] Could not load OTPK:', otpkErr);
                    }
                }

                const sharedSecret = await X3DH.respondToSession(
                    {
                        identityKey: base64ToUint8Array(envelope.senderIdentityKey),
                        ephemeralKey: base64ToUint8Array(envelope.senderEphemeralKey),
                        usedSignedPreKeyId: envelope.usedSignedPreKeyId || 1,
                        usedOneTimePreKeyId: envelope.usedOneTimePreKeyId
                    },
                    identityKeyPair,
                    signedPreKeyPair,
                    oneTimePreKeyPair
                );

                return DoubleRatchet.initReceiver(sharedSecret, signedPreKeyPair);
            };

            if (!state && envelope.senderEphemeralKey) {
                state = await initFromEnvelope();
            }

            if (!state) {
                if (envelope.senderEphemeralKey) {
                    state = await initFromEnvelope();
                }
                if (!state) {
                    throw new Error(`No active session found for sender ${sid} and message lacks ephemeral key`);
                }
            }

            const header = {
                dh: base64ToUint8Array(envelope.ratchetHeader.dh),
                pn: envelope.ratchetHeader.pn,
                n: envelope.ratchetHeader.n
            };

            const ciphertextBytes = base64ToUint8Array(envelope.ciphertext);
            
            try {
                const { state: newState, plaintext } = DoubleRatchet.ratchetDecrypt(state, header, ciphertextBytes);
                await this.saveSession(sid, newState);
                return bytesToUtf8(plaintext);
            } catch (decryptErr) {
                // If decryption failed and message has senderEphemeralKey, session state was likely stale. Re-init and retry!
                if (envelope.senderEphemeralKey) {
                    console.log('[E2EE] Session stale or desynchronized, re-initializing from envelope ephemeral key...');
                    try {
                        const freshState = await initFromEnvelope();
                        if (freshState) {
                            const { state: newState, plaintext } = DoubleRatchet.ratchetDecrypt(freshState, header, ciphertextBytes);
                            await this.saveSession(sid, newState);
                            return bytesToUtf8(plaintext);
                        }
                    } catch (retryErr) {
                        console.warn('[E2EE] Re-init recovery failed:', retryErr);
                    }
                }
                // Do not delete the active user session here! Wiping the session causes all future and subsequent messages to fail.
                console.warn(`[E2EE] Message decryption failed for sender ${sid}`);
                throw decryptErr;
            }
        } catch (e) {
            console.warn("[E2EE] Error decrypting message:", (e as any)?.message || e);
            throw e;
        }
    }

    private static async getStorageKey(userId: string | number): Promise<string> {
        const myId = await getActiveUserId();
        return `dme_session_${myId}_${String(userId)}`;
    }

    /** Check if a session exists for the user */
    static async hasSession(userId: string | number): Promise<boolean> {
        const key = await this.getStorageKey(userId);
        const session = await AsyncStorage.getItem(key);
        return !!session;
    }

    /** Delete the session for the user */
    static async deleteSession(userId: string | number): Promise<void> {
        const key = await this.getStorageKey(userId);
        await AsyncStorage.removeItem(key);
    }

    private static async saveSession(userId: string | number, state: RatchetState): Promise<void> {
        const key = await this.getStorageKey(userId);
        const serialized = DoubleRatchet.serializeState(state);
        await AsyncStorage.setItem(key, serialized);
    }

    private static async loadSession(userId: string | number): Promise<RatchetState | null> {
        const key = await this.getStorageKey(userId);
        const sessionStr = await AsyncStorage.getItem(key);
        if (!sessionStr) return null;
        return DoubleRatchet.deserializeState(sessionStr);
    }

    /** Export all active sessions for current user */
    static async exportAllSessions(): Promise<{ [userId: string]: string }> {
        try {
            const myId = await getActiveUserId();
            const prefix = `dme_session_${myId}_`;
            const allKeys = await AsyncStorage.getAllKeys();
            const sessionKeys = allKeys.filter(k => k.startsWith(prefix));
            const pairs = await AsyncStorage.multiGet(sessionKeys);
            const sessions: { [userId: string]: string } = {};
            for (const [key, val] of pairs) {
                if (val) {
                    const otherUid = key.replace(prefix, '');
                    sessions[otherUid] = val;
                }
            }
            return sessions;
        } catch {
            return {};
        }
    }

    /** Import sessions for current user */
    static async importAllSessions(sessions: { [userId: string]: string }): Promise<void> {
        if (!sessions) return;
        try {
            const myId = await getActiveUserId();
            const prefix = `dme_session_${myId}_`;
            const entries: [string, string][] = Object.entries(sessions).map(([otherUid, val]) => [
                `${prefix}${otherUid}`,
                val
            ]);
            if (entries.length > 0) {
                await AsyncStorage.multiSet(entries);
            }
        } catch (e) {
            console.warn('Failed to import sessions:', e);
        }
    }
}
