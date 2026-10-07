import * as Keychain from 'react-native-keychain';

export const BiometricService = {
  /**
   * Checks if device supports biometric authentication (Fingerprint, FaceID, Iris)
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
   * Prompts user for biometrics or screen lock passcode
   */
  async authenticate(
    title = 'Locked Chats',
    subtitle = 'Verify your identity to view locked chats'
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
          description: 'Authenticate with Fingerprint, Face ID, or Screen Lock PIN',
          cancel: 'Cancel',
        },
      });

      return !!result;
    } catch (err: any) {
      console.log('Biometric auth result/cancelled:', err?.message);
      return false;
    }
  },
};

export default BiometricService;
