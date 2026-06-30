// services/updateChecker.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const GITHUB_OWNER = 'kishorehitter';
const GITHUB_REPO = 'DME-releases';
const CURRENT_VERSION = '1.0.0';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const LAST_CHECK_KEY = 'update_last_checked';
const CACHED_RESULT_KEY = 'update_cached_result';

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion?: string;
  downloadUrl?: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    );
    if (!res.ok) return { hasUpdate: false };

    const release = await res.json();
    const latestVersion = release.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
      const apkAsset = release.assets?.find((a: any) => a.name.endsWith('.apk'));
      return {
        hasUpdate: true,
        latestVersion,
        downloadUrl: apkAsset?.browser_download_url ?? release.html_url,
      };
    }
    return { hasUpdate: false };
  } catch (e) {
    console.warn('Update check failed', e);
    return { hasUpdate: false };
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// --- throttled wrapper added below ---
export async function checkForUpdateThrottled(): Promise<UpdateInfo> {
  try {
    const lastChecked = await AsyncStorage.getItem(LAST_CHECK_KEY);
    const now = Date.now();

    if (lastChecked && now - Number(lastChecked) < CHECK_INTERVAL_MS) {
      const cached = await AsyncStorage.getItem(CACHED_RESULT_KEY);
      if (cached) return JSON.parse(cached);
    }

    const result = await checkForUpdate();
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(now));
    await AsyncStorage.setItem(CACHED_RESULT_KEY, JSON.stringify(result));
    return result;
  } catch (e) {
    return checkForUpdate(); // fallback if AsyncStorage fails
  }
}