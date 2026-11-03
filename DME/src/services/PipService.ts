import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

const { PipModule } = NativeModules;

export interface PipEvent {
  isInPictureInPictureMode: boolean;
  isExpanded?: boolean;
}

export const enterSystemPip = async (aspectRatio: [number, number] = [16, 9]): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PipModule?.enterPipMode) return false;
  try {
    return await PipModule.enterPipMode(aspectRatio[0], aspectRatio[1]);
  } catch (e) {
    console.warn('[PipService] enterPipMode failed:', e);
    return false;
  }
};

export const setSystemPipEnabled = (enabled: boolean) => {
  if (Platform.OS === 'android' && PipModule?.setPipEnabled) {
    PipModule.setPipEnabled(enabled);
  }
};

export const setSystemPipMinimized = (minimized: boolean) => {
  if (Platform.OS === 'android' && PipModule?.setPipMinimized) {
    PipModule.setPipMinimized(minimized);
  }
};

export const setSystemPipAspectRatio = (numerator: number, denominator: number) => {
  if (Platform.OS === 'android' && PipModule?.updatePipAspectRatio) {
    const num = Math.round(numerator);
    const den = Math.round(denominator);
    if (num > 0 && den > 0) {
      PipModule.updatePipAspectRatio(num, den);
    }
  }
};

export function getAspectRatioFraction(ar: number | null | undefined): [number, number] {
  if (!ar || isNaN(ar) || ar <= 0) return [16, 9];
  // Common video aspect ratios with 5% tolerance:
  if (Math.abs(ar - 9 / 16) < 0.05 || Math.abs(ar - 0.5625) < 0.05) return [9, 16];
  if (Math.abs(ar - 16 / 9) < 0.05 || Math.abs(ar - 1.7778) < 0.05) return [16, 9];
  if (Math.abs(ar - 4 / 3) < 0.05 || Math.abs(ar - 1.3333) < 0.05) return [4, 3];
  if (Math.abs(ar - 3 / 4) < 0.05 || Math.abs(ar - 0.75) < 0.05) return [3, 4];
  if (Math.abs(ar - 1.0) < 0.05) return [1, 1];
  if (Math.abs(ar - 21 / 9) < 0.08 || Math.abs(ar - 2.333) < 0.08) return [21, 9];
  if (Math.abs(ar - 18 / 9) < 0.05 || Math.abs(ar - 2.0) < 0.05) return [18, 9];

  // Arbitrary aspect ratios: scale and simplify via GCD
  const factor = 1000;
  const num = Math.round(ar * factor);
  const den = factor;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(num, den);
  return [Math.round(num / d), Math.round(den / d)];
}

export const closeSystemPip = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PipModule?.closePip) return false;
  try {
    return await PipModule.closePip();
  } catch (e) {
    console.warn('[PipService] closePip failed:', e);
    return false;
  }
};

export const isSystemPipSupported = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PipModule?.isPipSupported) return false;
  try {
    return await PipModule.isPipSupported();
  } catch {
    return false;
  }
};

export const hasSystemPipPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PipModule?.hasPipPermission) return false;
  try {
    return await PipModule.hasPipPermission();
  } catch {
    return false;
  }
};

export const openSystemPipSettings = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PipModule?.openPipSettings) return false;
  try {
    return await PipModule.openPipSettings();
  } catch {
    return false;
  }
};

export const addPipListener = (callback: (isInPip: boolean, isExpanded?: boolean) => void) => {
  if (Platform.OS !== 'android') {
    return () => {};
  }
  const subscription = DeviceEventEmitter.addListener(
    'onPictureInPictureModeChanged',
    (data: PipEvent) => {
      callback(Boolean(data?.isInPictureInPictureMode), Boolean(data?.isExpanded));
    }
  );
  return () => {
    subscription.remove();
  };
};
