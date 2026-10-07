import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';
import {
    generateEd25519KeyPair,
    generateX25519KeyPair,
    ed25519Sign,
    uint8ArrayToBase64,
    base64ToUint8Array,
    KeyPair
} from './CryptoUtils';

export interface SignedPreKey {
    keyId: number;
    publicKey: Uint8Array;
    signature: Uint8Array;
}

export interface OneTimePreKey {
    keyId: number;
    publicKey: Uint8Array;
}

export interface KeyBundle {
    identityKey: string;
    signedPreKey: {
        keyId: number;
        publicKey: string;
        signature: string;
    };
    oneTimePreKeys: {
        keyId: number;
        publicKey: string;
    }[];
}

export async function getActiveUserId(): Promise<string> {
    try {
        const userStr = await AsyncStorage.getItem('user');
        if (userStr) {
            const u = JSON.parse(userStr);
            if (u?.id) return String(u.id);
        }
    } catch {}
    return 'default';
}

interface UserKeyStore {
    identityKey?: { publicKey: string; privateKey: string };
    signedPreKeys: { [keyId: string]: { publicKey: string; privateKey: string; signature?: string } };
    oneTimePreKeys: { [keyId: string]: { publicKey: string; privateKey: string } };
}

async function loadUserKeyStore(uid: string): Promise<UserKeyStore> {
    try {
        const raw = await AsyncStorage.getItem(`dme_keystore_${uid}`);
        if (raw) return JSON.parse(raw);
    } catch {}
    return { signedPreKeys: {}, oneTimePreKeys: {} };
}

async function saveUserKeyStore(uid: string, store: UserKeyStore): Promise<void> {
    await AsyncStorage.setItem(`dme_keystore_${uid}`, JSON.stringify(store));
}

export class KeyManager {
    /** Generate Ed25519 identity key pair and store securely */
    static async generateAndStoreIdentityKeyPair(): Promise<Uint8Array> {
        const uid = await getActiveUserId();
        const keyPair = generateEd25519KeyPair();
        const pubB64 = uint8ArrayToBase64(keyPair.publicKey);
        const privB64 = uint8ArrayToBase64(keyPair.privateKey);

        const store = await loadUserKeyStore(uid);
        store.identityKey = { publicKey: pubB64, privateKey: privB64 };
        await saveUserKeyStore(uid, store);

        try {
            await Keychain.setGenericPassword('identity', JSON.stringify(store.identityKey), { service: `dme_e2ee_${uid}_identity` });
        } catch {}

        return keyPair.publicKey;
    }

    /** Generate X25519 key pair, sign with identity key, and store securely */
    static async generateAndStoreSignedPreKey(identityPrivateKey: Uint8Array, keyId: number = 1): Promise<SignedPreKey> {
        const uid = await getActiveUserId();
        const keyPair = generateX25519KeyPair();
        const signature = ed25519Sign(identityPrivateKey, keyPair.publicKey);
        const pubB64 = uint8ArrayToBase64(keyPair.publicKey);
        const privB64 = uint8ArrayToBase64(keyPair.privateKey);
        const sigB64 = uint8ArrayToBase64(signature);

        const store = await loadUserKeyStore(uid);
        store.signedPreKeys[String(keyId)] = { publicKey: pubB64, privateKey: privB64, signature: sigB64 };
        await saveUserKeyStore(uid, store);

        try {
            await Keychain.setGenericPassword('signed_prekey', JSON.stringify({ publicKey: pubB64, privateKey: privB64 }), { service: `dme_e2ee_${uid}_spk_${keyId}` });
        } catch {}

        return { keyId, publicKey: keyPair.publicKey, signature };
    }

    /** Generate batch of X25519 one-time prekeys and store securely */
    static async generateOneTimePreKeys(startId: number, count: number): Promise<OneTimePreKey[]> {
        const uid = await getActiveUserId();
        const keys: OneTimePreKey[] = [];
        const store = await loadUserKeyStore(uid);

        for (let i = 0; i < count; i++) {
            const keyId = startId + i;
            const keyPair = generateX25519KeyPair();
            const pubB64 = uint8ArrayToBase64(keyPair.publicKey);
            const privB64 = uint8ArrayToBase64(keyPair.privateKey);

            store.oneTimePreKeys[String(keyId)] = { publicKey: pubB64, privateKey: privB64 };
            keys.push({ keyId, publicKey: keyPair.publicKey });
        }

        await saveUserKeyStore(uid, store);
        return keys;
    }

    /** Retrieve identity key pair from secure storage */
    static async getIdentityKeyPair(): Promise<KeyPair> {
        const uid = await getActiveUserId();
        const store = await loadUserKeyStore(uid);
        if (store.identityKey) {
            return {
                publicKey: base64ToUint8Array(store.identityKey.publicKey),
                privateKey: base64ToUint8Array(store.identityKey.privateKey)
            };
        }
        const creds = await Keychain.getGenericPassword({ service: `dme_e2ee_${uid}_identity` });
        if (creds) {
            const parsed = JSON.parse(creds.password);
            return {
                publicKey: base64ToUint8Array(parsed.publicKey),
                privateKey: base64ToUint8Array(parsed.privateKey)
            };
        }
        throw new Error('Identity key not found');
    }

    /** Retrieve signed prekey pair from secure storage */
    static async getSignedPreKeyPair(keyId: number): Promise<KeyPair> {
        const uid = await getActiveUserId();
        const store = await loadUserKeyStore(uid);
        const entry = store.signedPreKeys[String(keyId)] || store.signedPreKeys['1'];
        if (entry) {
            return {
                publicKey: base64ToUint8Array(entry.publicKey),
                privateKey: base64ToUint8Array(entry.privateKey)
            };
        }
        let creds = await Keychain.getGenericPassword({ service: `dme_e2ee_${uid}_spk_${keyId}` });
        if (!creds && keyId !== 1) {
            creds = await Keychain.getGenericPassword({ service: `dme_e2ee_${uid}_spk_1` });
        }
        if (creds) {
            const parsed = JSON.parse(creds.password);
            return {
                publicKey: base64ToUint8Array(parsed.publicKey),
                privateKey: base64ToUint8Array(parsed.privateKey)
            };
        }
        throw new Error(`Signed prekey ${keyId} not found`);
    }

    /** Retrieve one-time prekey pair from secure storage */
    static async getOneTimePreKeyPair(keyId: number): Promise<KeyPair> {
        const uid = await getActiveUserId();
        const store = await loadUserKeyStore(uid);
        const entry = store.oneTimePreKeys[String(keyId)];
        if (entry) {
            return {
                publicKey: base64ToUint8Array(entry.publicKey),
                privateKey: base64ToUint8Array(entry.privateKey)
            };
        }
        const service = `dme_e2ee_${uid}_otpk_${keyId}`;
        const creds = await Keychain.getGenericPassword({ service });
        if (creds) {
            const parsed = JSON.parse(creds.password);
            return {
                publicKey: base64ToUint8Array(parsed.publicKey),
                privateKey: base64ToUint8Array(parsed.privateKey)
            };
        }
        throw new Error(`One-time prekey ${keyId} not found`);
    }

    /** Check if identity key exists */
    static async hasIdentityKey(): Promise<boolean> {
        const uid = await getActiveUserId();
        const store = await loadUserKeyStore(uid);
        if (store.identityKey) return true;
        const creds = await Keychain.getGenericPassword({ service: `dme_e2ee_${uid}_identity` });
        return !!creds;
    }

    /** Check if signed prekey exists */
    static async hasSignedPreKey(keyId: number = 1): Promise<boolean> {
        try {
            const uid = await getActiveUserId();
            const store = await loadUserKeyStore(uid);
            if (store.signedPreKeys[String(keyId)] || store.signedPreKeys['1']) return true;
            const creds = await Keychain.getGenericPassword({ service: `dme_e2ee_${uid}_spk_${keyId}` });
            return !!creds;
        } catch {
            return false;
        }
    }

    /** Generate all keys and upload to server */
    static async uploadKeyBundle(): Promise<void> {
        try {
            let identityKeyPair: KeyPair;
            if (await this.hasIdentityKey()) {
                identityKeyPair = await this.getIdentityKeyPair();
            } else {
                await this.generateAndStoreIdentityKeyPair();
                identityKeyPair = await this.getIdentityKeyPair();
            }

            let spk: SignedPreKey;
            if (await this.hasSignedPreKey(1)) {
                const existingSpk = await this.getSignedPreKeyPair(1);
                const sig = ed25519Sign(identityKeyPair.privateKey, existingSpk.publicKey);
                spk = { keyId: 1, publicKey: existingSpk.publicKey, signature: sig };
            } else {
                spk = await this.generateAndStoreSignedPreKey(identityKeyPair.privateKey, 1);
            }

            const startId = Date.now();
            const otpks = await this.generateOneTimePreKeys(startId, 100);

            const bundle = {
                identity_key: {
                    public_key: uint8ArrayToBase64(identityKeyPair.publicKey)
                },
                signed_prekey: {
                    key_id: spk.keyId,
                    public_key: uint8ArrayToBase64(spk.publicKey),
                    signature: uint8ArrayToBase64(spk.signature)
                },
                one_time_prekeys: otpks.map(k => ({
                    key_id: k.keyId,
                    public_key: uint8ArrayToBase64(k.publicKey)
                }))
            };

            await api.post('/e2ee/keys/upload/', bundle);
            console.log('[E2EE] Successfully uploaded key bundle to server');
        } catch (e) {
            console.error('Error uploading key bundle:', e);
            throw e;
        }
    }

    /** Check count on server, generate more if below threshold */
    static async replenishOneTimePreKeys(): Promise<void> {
        try {
            const response = await api.get('/e2ee/keys/status/');
            const count = response.data.one_time_prekeys_remaining ?? 0;
            if (count < 25) {
                const startId = Date.now();
                const newKeys = await this.generateOneTimePreKeys(startId, 100 - count);
                await api.post('/e2ee/keys/replenish/', newKeys.map(k => ({
                    key_id: k.keyId,
                    public_key: uint8ArrayToBase64(k.publicKey)
                })));
                console.log(`[E2EE] Replenished ${100 - count} one-time prekeys`);
            }
        } catch (e) {
            console.error('Failed to replenish one-time prekeys:', e);
        }
    }

    /** Ensure user keys are generated locally and synced to server */
    static async ensureKeysSetup(): Promise<void> {
        try {
            const hasLocalIdentity = await this.hasIdentityKey();
            const hasLocalSigned = await this.hasSignedPreKey(1);
            const statusRes = await api.get('/e2ee/keys/status/');
            const serverHasKeys = !!(statusRes.data.has_identity_key && statusRes.data.has_signed_prekey);

            // If either local device or server is missing keys (e.g. fresh install / app reinstall), re-upload clean bundle
            if (!hasLocalIdentity || !hasLocalSigned || !serverHasKeys) {
                console.log('[E2EE] Keys missing locally or on server, uploading fresh bundle...');
                await this.uploadKeyBundle();
            } else if (statusRes.data.one_time_prekeys_remaining < 25) {
                console.log('[E2EE] One-time prekeys low, replenishing...');
                await this.replenishOneTimePreKeys();
            }
        } catch (e: any) {
            console.warn('[E2EE] Key status check failed:', e?.message || e);
            try {
                if (!(await this.hasIdentityKey())) {
                    await this.uploadKeyBundle();
                }
            } catch (err) {
                console.error('[E2EE] Failed to ensure key bundle upload:', err);
            }
        }
    }
}
