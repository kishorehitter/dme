import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import localDatabase from './LocalDatabase';

const PIN_SERVICE_PREFIX = 'dme_chat_pin_';
const LOCKED_CHATS_PREFIX = '@dme_locked_chats_';
const LOCKED_CHATS_V2_PREFIX = '@dme_locked_chats_v2_';

export const BiometricService = {
  /**
   * Checks if device supports biometric authentication (Fingerprint)
   */
  async getSupportedBiometry(): Promise<string | null> {
    try {
      const type = await Keychain.getSupportedBiometryType();
      return type;
    } catch {
      return null;
    }
  },

  /**
   * Checks if a 4-digit PIN has been set for the user
   */
  async hasPin(userId?: number | string): Promise<boolean> {
    try {
      const uId = userId || 'default';
      const key = `${LOCKED_CHATS_PREFIX}pin_${uId}`;
      const pin = await AsyncStorage.getItem(key);
      if (pin && pin.length === 4) return true;

      // Fallback check Keychain
      const service = `${PIN_SERVICE_PREFIX}${uId}`;
      const creds = await Keychain.getGenericPassword({ service });
      return !!creds && creds.password.length === 4;
    } catch {
      return false;
    }
  },

  /**
   * Sets or updates the 4-digit PIN for the user
   */
  async setPin(userId: number | string | undefined, pin: string): Promise<boolean> {
    try {
      if (!pin || pin.length !== 4) return false;
      const uId = userId || 'default';
      const key = `${LOCKED_CHATS_PREFIX}pin_${uId}`;
      await AsyncStorage.setItem(key, pin);

      const service = `${PIN_SERVICE_PREFIX}${uId}`;
      await Keychain.setGenericPassword('chat_pin', pin, { service }).catch(() => {});
      return true;
    } catch (err) {
      console.error('Error saving 4-digit chat PIN:', err);
      return false;
    }
  },

  /**
   * Verifies the input 4-digit PIN against the user's stored PIN
   */
  async verifyPin(userId: number | string | undefined, inputPin: string): Promise<boolean> {
    try {
      if (!inputPin || inputPin.length !== 4) return false;
      const uId = userId || 'default';
      const key = `${LOCKED_CHATS_PREFIX}pin_${uId}`;
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        return stored === inputPin;
      }

      // Check Keychain fallback
      const service = `${PIN_SERVICE_PREFIX}${uId}`;
      const creds = await Keychain.getGenericPassword({ service });
      if (creds && creds.password) {
        await AsyncStorage.setItem(key, creds.password).catch(() => {});
        return creds.password === inputPin;
      }
      return false;
    } catch {
      return false;
    }
  },

  /**
   * Retrieves all locked conversation IDs for the user from persistent AsyncStorage and syncs SQLite.
   * Survives logouts, app restarts, and cache clears.
   */
  async getPersistedLockedChatIds(userId?: number | string): Promise<number[]> {
    try {
      const uId = userId || 'default';

      // If user has not set a 4-digit PIN, they have no locked chats configured - ensure clean slate
      const pinExists = await this.hasPin(userId);
      if (!pinExists) {
        await AsyncStorage.removeItem(`${LOCKED_CHATS_V2_PREFIX}${uId}`).catch(() => {});
        await AsyncStorage.removeItem(`${LOCKED_CHATS_PREFIX}${uId}`).catch(() => {});
        localDatabase.syncLockedConversations([]);
        return [];
      }

      const key = `${LOCKED_CHATS_V2_PREFIX}${uId}`;
      const stored = await AsyncStorage.getItem(key);
      let ids: number[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            ids = parsed;
          }
        } catch {}
      }

      const cleanIds = Array.from(new Set(ids)).map(Number).filter(id => !isNaN(id) && id > 0);
      localDatabase.syncLockedConversations(cleanIds);
      return cleanIds;
    } catch {
      return [];
    }
  },

  /**
   * Saves updated locked conversation IDs to persistent AsyncStorage and syncs SQLite.
   */
  async setPersistedLockedChatIds(userId: number | string | undefined, ids: number[]): Promise<void> {
    try {
      const uId = userId || 'default';
      const key = `${LOCKED_CHATS_V2_PREFIX}${uId}`;
      const cleanIds = Array.from(new Set(ids)).map(Number).filter(id => !isNaN(id) && id > 0);
      await AsyncStorage.setItem(key, JSON.stringify(cleanIds));
      localDatabase.syncLockedConversations(cleanIds);
    } catch (err) {
      console.error('Error saving persisted locked chat IDs:', err);
      localDatabase.syncLockedConversations(ids);
    }
  },

  /**
   * Fingerprint biometric authentication (No Face ID mentions)
   */
  async authenticateBiometric(
    title = 'Locked Chats',
    subtitle = 'Scan your fingerprint to unlock'
  ): Promise<boolean> {
    try {
      const hasVault = await Keychain.hasGenericPassword({ service: 'yesenta_chat_vault' });
      if (!hasVault) {
        await Keychain.setGenericPassword('vault_user', 'vault_secured', {
          service: 'yesenta_chat_vault',
          accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }

      const result = await Keychain.getGenericPassword({
        service: 'yesenta_chat_vault',
        authenticationPrompt: {
          title,
          subtitle,
          description: 'Authenticate with fingerprint to proceed',
          cancel: 'Cancel',
        },
      });

      return !!result;
    } catch (err: any) {
      console.log('Biometric auth result/cancelled:', err?.message);
      return false;
    }
  },

  /**
   * Legacy method wrapper pointing to fingerprint auth
   */
  async authenticate(
    title = 'Locked Chats',
    subtitle = 'Verify your identity to view locked chats'
  ): Promise<boolean> {
    return this.authenticateBiometric(title, subtitle);
  },
};

export default BiometricService;
