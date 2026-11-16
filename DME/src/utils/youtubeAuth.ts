import AsyncStorage from '@react-native-async-storage/async-storage';

export const YT_GUEST_LOW_QUALITY_KEY = '@yt_guest_low_quality_preferred';

/**
 * Checks whether the user is authenticated in YouTube via WebView cookies.
 * Android OkHttp automatically includes CookieManager cookies in fetch calls.
 * When authenticated, YouTube mobile pages include "LOGGED_IN":true in ytcfg.
 */
export const checkYouTubeAuth = async (): Promise<boolean> => {
  try {
    const res = await fetch('https://m.youtube.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
        'Cache-Control': 'no-cache',
      },
    });
    const html = await res.text();
    // 1. Check ytcfg LOGGED_IN boolean flag
    if (/"LOGGED_IN"\s*:\s*true/i.test(html)) return true;
    // 2. Check tracking params logged_in string flag ("1")
    if (/"logged_in"\s*:\s*"1"/i.test(html)) return true;
    // 3. Check for delegated session or session index
    if (/"DELEGATED_SESSION_ID"/i.test(html) || /"SESSION_INDEX"/i.test(html)) return true;
    return false;
  } catch (error) {
    return false;
  }
};

export const getHasSkippedYtLogin = async (): Promise<boolean> => {
  try {
    const val = await AsyncStorage.getItem(YT_GUEST_LOW_QUALITY_KEY);
    return val === 'true';
  } catch {
    return false;
  }
};

export const setHasSkippedYtLogin = async (skipped: boolean): Promise<void> => {
  try {
    if (skipped) {
      await AsyncStorage.setItem(YT_GUEST_LOW_QUALITY_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(YT_GUEST_LOW_QUALITY_KEY);
    }
  } catch {}
};
