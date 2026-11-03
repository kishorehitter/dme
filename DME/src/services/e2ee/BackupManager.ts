import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';
import {
    generateRandomBytes,
    bytesToHex,
    hexToBytes,
    deriveKeyFromPassword,
    aesGcmEncrypt,
    aesGcmDecrypt,
    concatBytes,
    uint8ArrayToBase64,
    base64ToUint8Array,
    utf8ToBytes,
    bytesToUtf8
} from './CryptoUtils';
import * as Keychain from 'react-native-keychain';
import { KeyManager, UserKeyStore, getActiveUserId } from './KeyManager';
import { SessionManager } from './SessionManager';
import localDatabase from '../LocalDatabase';

// Cached master backup key in memory for the active app session, bound to user ID
let cachedMasterBackupKey: { uid: string; key: Uint8Array } | null = null;

const RECOVERY_KEY_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface BackupStatus {
    hasBackup: boolean;
    version: number;
    updatedAt: string | null;
}

export class BackupManager {
    /**
     * Generate a 16-character user-friendly master recovery key (e.g. ABCD-1234-EFGH-5678)
     */
    static generateRecoveryKey(): string {
        const randomBytes = generateRandomBytes(16);
        let result = '';
        for (let i = 0; i < 16; i++) {
            const index = randomBytes[i] % RECOVERY_KEY_CHARS.length;
            result += RECOVERY_KEY_CHARS[index];
            if ((i + 1) % 4 === 0 && i !== 15) {
                result += '-';
            }
        }
        return result;
    }

    /**
     * Helper to encrypt data using AES-256-GCM and return Base64 string with nonce prepended
     */
    private static encryptEnvelope(key: Uint8Array, data: Uint8Array): string {
        const { ciphertext, nonce } = aesGcmEncrypt(key, data);
        const combined = concatBytes(nonce, ciphertext);
        return uint8ArrayToBase64(combined);
    }

    /**
     * Helper to decrypt data envelope from Base64 string (first 12 bytes nonce)
     */
    private static decryptEnvelope(key: Uint8Array, base64Str: string): Uint8Array {
        const combined = base64ToUint8Array(base64Str);
        if (combined.length <= 12) {
            throw new Error('Invalid envelope length');
        }
        const nonce = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        return aesGcmDecrypt(key, nonce, ciphertext);
    }

    /**
     * Check if the authenticated user has an active backup on the Django backend
     */
    static async checkServerBackupStatus(): Promise<BackupStatus> {
        try {
            const response = await api.get('/e2ee/backup/status/');
            return {
                hasBackup: !!response.data.has_backup,
                version: response.data.version || 0,
                updatedAt: response.data.updated_at || null,
            };
        } catch (e: any) {
            console.warn('[BackupManager] Failed to check backup status:', e?.message || e);
            return { hasBackup: false, version: 0, updatedAt: null };
        }
    }

    /**
     * Retrieve the master backup key, falling back to Keychain if not cached in memory for this user
     */
    static async getMasterBackupKey(): Promise<Uint8Array | null> {
        const uid = await getActiveUserId();
        if (cachedMasterBackupKey && cachedMasterBackupKey.uid === uid) {
            return cachedMasterBackupKey.key;
        }
        try {
            const creds = await Keychain.getGenericPassword({ service: `dme_e2ee_master_${uid}` });
            if (creds && creds.password) {
                const key = hexToBytes(creds.password);
                cachedMasterBackupKey = { uid, key };
                return key;
            }
        } catch {}
        return null;
    }

    /**
     * Store master backup key in memory and Keychain bound to active user ID
     */
    static async setMasterBackupKey(key: Uint8Array | null): Promise<void> {
        const uid = await getActiveUserId();
        if (key) {
            cachedMasterBackupKey = { uid, key };
            try {
                await Keychain.setGenericPassword('master_key', bytesToHex(key), { service: `dme_e2ee_master_${uid}` });
            } catch {}
        } else {
            cachedMasterBackupKey = null;
            try {
                await Keychain.resetGenericPassword({ service: `dme_e2ee_master_${uid}` });
            } catch {}
        }
    }

    /**
     * Clear in-memory session master key (e.g. on logout)
     */
    static clearSessionKey(): void {
        cachedMasterBackupKey = null;
    }

    /**
     * Set up E2EE Chat & Keystore Backup with a 6-digit PIN and generate Emergency Recovery Key
     */
    static async setupBackup(pin: string): Promise<{ recoveryKey: string }> {
        if (!pin || pin.length < 4) {
            throw new Error('PIN must be at least 4 digits');
        }

        // 1. Generate master backup key (256-bit AES) & salt
        const masterKey = generateRandomBytes(32);
        const salt = generateRandomBytes(16);
        const recoveryKey = this.generateRecoveryKey();
        const cleanRecoveryKey = recoveryKey.replace(/-/g, '').toUpperCase();

        // 2. Derive key from PIN & key from Recovery Key
        const pinKey = deriveKeyFromPassword(pin, salt);
        const recoveryDerivedKey = deriveKeyFromPassword(cleanRecoveryKey, salt);

        // 3. Encrypt master key with PIN and Recovery Key
        const encBackupKeyPin = this.encryptEnvelope(pinKey, masterKey);
        const encBackupKeyRecovery = this.encryptEnvelope(recoveryDerivedKey, masterKey);

        // 4. Collect local payload (Keystore + Ratchet Sessions + Decrypted SQLite Messages)
        const keystore = await KeyManager.exportKeyStore();
        const sessions = await SessionManager.exportAllSessions();
        const sqliteData = localDatabase.exportAllData();

        console.log('[BackupManager] Setup — conversations:', sqliteData.conversations.length,
            '| messages:', sqliteData.messages.length);

        const payloadObj = {
            keystore,
            sessions,
            sqlite: sqliteData,
            timestamp: new Date().toISOString(),
        };

        const payloadBytes = utf8ToBytes(JSON.stringify(payloadObj));
        const encPayload = this.encryptEnvelope(masterKey, payloadBytes);

        console.log('[BackupManager] Setup — masterKey prefix:', bytesToHex(masterKey.slice(0, 4)));
        console.log('[BackupManager] Setup — salt hex:', bytesToHex(salt));
        console.log('[BackupManager] Setup — payloadBytes length:', payloadBytes.length);
        console.log('[BackupManager] Setup — encPayload length (base64):', encPayload.length);
        console.log('[BackupManager] Setup — encBackupKeyPin length (base64):', encBackupKeyPin.length);

        // LOCAL ROUND-TRIP SELF-TEST: verify encrypt/decrypt cycle works before uploading
        try {
            const testPinKey = deriveKeyFromPassword(pin, salt);
            const testMasterKey = this.decryptEnvelope(testPinKey, encBackupKeyPin);
            const masterKeyOk = testMasterKey.length === masterKey.length &&
                testMasterKey[0] === masterKey[0] && testMasterKey[31] === masterKey[31];
            if (!masterKeyOk) throw new Error('masterKey round-trip mismatch');
            const testPayload = this.decryptEnvelope(testMasterKey, encPayload);
            if (testPayload.length !== payloadBytes.length) {
                throw new Error(`Payload round-trip length mismatch: got ${testPayload.length}, expected ${payloadBytes.length}`);
            }
            console.log('[BackupManager] ✅ Local round-trip self-test PASSED — crypto is working correctly');
        } catch (selfTestErr: any) {
            console.error('[BackupManager] ❌ CRITICAL: Local round-trip self-test FAILED:', selfTestErr?.message);
            throw new Error('CRYPTO_SELF_TEST_FAILED: ' + selfTestErr?.message);
        }

        // 5. Upload to Django backend
        await api.post('/e2ee/backup/upload/', {
            salt: bytesToHex(salt),
            encrypted_backup_key_pin: encBackupKeyPin,
            encrypted_backup_key_recovery: encBackupKeyRecovery,
            encrypted_payload: encPayload,
            version: 1,
        });

        // 6. Cache master key and mark backup enabled locally
        await this.setMasterBackupKey(masterKey);
        await AsyncStorage.setItem('dme_backup_enabled', 'true');
        await AsyncStorage.setItem('dme_backup_salt', bytesToHex(salt));

        console.log('[BackupManager] ✅ Initial backup setup and uploaded successfully');
        return { recoveryKey };
    }

    /**
     * Restore chats & keystore using 6-digit PIN
     */
    static async restoreWithPin(pin: string): Promise<boolean> {
        try {
            const response = await api.get('/e2ee/backup/download/');
            const data = response.data;

            console.log('[BackupManager] Downloaded backup — salt length:', data.salt?.length,
                '| enc_pin_key length:', data.encrypted_backup_key_pin?.length,
                '| enc_payload length:', data.encrypted_payload?.length);

            const salt = hexToBytes(data.salt);
            console.log('[BackupManager] Restore — salt hex:', data.salt);
            const pinKey = deriveKeyFromPassword(pin, salt);

            // Decrypt master backup key with PIN
            let masterKey: Uint8Array;
            try {
                masterKey = this.decryptEnvelope(pinKey, data.encrypted_backup_key_pin);
                console.log('[BackupManager] ✅ Master key decrypted — prefix:', bytesToHex(masterKey.slice(0, 4)));
            } catch (err) {
                console.warn('[BackupManager] PIN decryption failed (wrong PIN):', err);
                throw new Error('INVALID_PIN');
            }

            // Decrypt payload with master key
            let payloadBytes: Uint8Array;
            try {
                payloadBytes = this.decryptEnvelope(masterKey, data.encrypted_payload);
                console.log('[BackupManager] ✅ Payload decrypted successfully, size:', payloadBytes.length);
            } catch (err: any) {
                console.error('[BackupManager] Payload decryption failed — backup may be corrupted or stale:', err?.message);
                throw new Error('CORRUPTED_BACKUP');
            }

            let payload: any;
            try {
                payload = JSON.parse(bytesToUtf8(payloadBytes));
            } catch (err) {
                console.error('[BackupManager] Payload JSON parse failed — data is corrupt');
                throw new Error('CORRUPTED_BACKUP');
            }

            // Restore Keystore
            if (payload.keystore) {
                await KeyManager.importKeyStore(payload.keystore);
                console.log('[BackupManager] ✅ Keystore restored');
            }

            // Restore Sessions
            if (payload.sessions) {
                await SessionManager.importAllSessions(payload.sessions);
                console.log('[BackupManager] ✅ Sessions restored');
            }

            // Restore SQLite Database
            if (payload.sqlite) {
                localDatabase.importAllData(payload.sqlite);
                console.log('[BackupManager] ✅ SQLite data restored');
            }

            // Cache master key & persist enabled state
            await this.setMasterBackupKey(masterKey);
            await AsyncStorage.setItem('dme_backup_enabled', 'true');
            await AsyncStorage.setItem('dme_backup_salt', data.salt);

            console.log('[BackupManager] ✅ Backup successfully restored with PIN');
            return true;
        } catch (e: any) {
            if (e.message === 'INVALID_PIN' || e.message === 'CORRUPTED_BACKUP') throw e;
            console.error('[BackupManager] Restore failed:', e);
            throw e;
        }
    }

    /**
     * Restore chats & keystore using 16-character Emergency Recovery Key and set a new PIN
     */
    static async restoreWithRecoveryKey(recoveryKey: string, newPin: string): Promise<boolean> {
        try {
            const response = await api.get('/e2ee/backup/download/');
            const data = response.data;

            const salt = hexToBytes(data.salt);
            const cleanKey = recoveryKey.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
            const recoveryDerivedKey = deriveKeyFromPassword(cleanKey, salt);

            // Decrypt master backup key
            let masterKey: Uint8Array;
            try {
                masterKey = this.decryptEnvelope(recoveryDerivedKey, data.encrypted_backup_key_recovery);
            } catch (err) {
                console.warn('[BackupManager] Recovery key decryption failed (invalid key)');
                throw new Error('INVALID_RECOVERY_KEY');
            }

            // Decrypt payload
            const payloadBytes = this.decryptEnvelope(masterKey, data.encrypted_payload);
            const payload = JSON.parse(bytesToUtf8(payloadBytes));

            // Restore Keystore
            if (payload.keystore) {
                await KeyManager.importKeyStore(payload.keystore);
            }

            // Restore Sessions
            if (payload.sessions) {
                await SessionManager.importAllSessions(payload.sessions);
            }

            // Restore SQLite Database
            if (payload.sqlite) {
                localDatabase.importAllData(payload.sqlite);
            }

            // Re-encrypt master backup key with the new PIN
            const newPinKey = deriveKeyFromPassword(newPin, salt);
            const newEncBackupKeyPin = this.encryptEnvelope(newPinKey, masterKey);

            // Update on server
            await api.post('/e2ee/backup/upload/', {
                salt: data.salt,
                encrypted_backup_key_pin: newEncBackupKeyPin,
                encrypted_backup_key_recovery: data.encrypted_backup_key_recovery,
                encrypted_payload: data.encrypted_payload,
                version: (data.version || 1) + 1,
            });

            await this.setMasterBackupKey(masterKey);
            await AsyncStorage.setItem('dme_backup_enabled', 'true');
            await AsyncStorage.setItem('dme_backup_salt', data.salt);

            console.log('[BackupManager] ✅ Backup successfully restored and PIN reset via Recovery Key');
            return true;
        } catch (e: any) {
            if (e.message === 'INVALID_RECOVERY_KEY') throw e;
            console.error('[BackupManager] Recovery key restore failed:', e);
            throw e;
        }
    }

    private static autoBackupTimer: any = null;

    /**
     * Debounced auto-backup that defers execution so screen navigation and transitions
     * remain at 60/120 FPS without competing with cryptographic DB exports.
     */
    static scheduleAutoBackup(delayMs: number = 15000): void {
        if (this.autoBackupTimer) {
            clearTimeout(this.autoBackupTimer);
        }
        this.autoBackupTimer = setTimeout(() => {
            this.autoBackupTimer = null;
            this.autoBackup().catch(() => {});
        }, delayMs);
    }

    /**
     * Background / periodic auto-backup to update the encrypted payload on the server
     */
    static async autoBackup(): Promise<void> {
        try {
            const isEnabled = await AsyncStorage.getItem('dme_backup_enabled');
            const masterKey = await this.getMasterBackupKey();
            if (isEnabled !== 'true' || !masterKey) {
                return; // Auto-backup only runs when master key is unlocked or available
            }

            const saltHex = await AsyncStorage.getItem('dme_backup_salt');
            if (!saltHex) return;

            // Fetch existing backup wrapper so we retain PIN and Recovery Key envelopes
            const response = await api.get('/e2ee/backup/download/');
            const data = response.data;

            // Collect updated local data
            const keystore = await KeyManager.exportKeyStore();
            const sessions = await SessionManager.exportAllSessions();
            const sqliteData = localDatabase.exportAllData();

            const payloadObj = {
                keystore,
                sessions,
                sqlite: sqliteData,
                timestamp: new Date().toISOString(),
            };

            const payloadBytes = utf8ToBytes(JSON.stringify(payloadObj));
            const encPayload = this.encryptEnvelope(masterKey, payloadBytes);

            await api.post('/e2ee/backup/upload/', {
                salt: data.salt,
                encrypted_backup_key_pin: data.encrypted_backup_key_pin,
                encrypted_backup_key_recovery: data.encrypted_backup_key_recovery,
                encrypted_payload: encPayload,
                version: (data.version || 1) + 1,
            });

            console.log('[BackupManager] ☁️ Background auto-backup synced successfully');
        } catch (e: any) {
            console.warn('[BackupManager] Auto-backup failed:', e?.message || e);
        }
    }

    /**
     * Reset / delete the server backup
     */
    static async resetBackup(): Promise<void> {
        try {
            await api.post('/e2ee/backup/reset/');
            await this.setMasterBackupKey(null);
            await AsyncStorage.removeItem('dme_backup_enabled');
            await AsyncStorage.removeItem('dme_backup_salt');
            console.log('[BackupManager] Backup reset successfully');
        } catch (e: any) {
            console.error('[BackupManager] Failed to reset backup:', e);
            throw e;
        }
    }
}

export default BackupManager;
