import RNFS from 'react-native-fs';
import { resolveImageUrl } from './image';

export const getLocalAvatarPath = (userId: number | string): string => {
  return `${RNFS.DocumentDirectoryPath}/user_avatar_${userId}.jpg`;
};

export const getLocalAvatarUri = async (userId: number | string): Promise<string | null> => {
  try {
    if (!userId) return null;
    const dest = getLocalAvatarPath(userId);
    const exists = await RNFS.exists(dest);
    if (exists) {
      return `file://${dest}`;
    }
  } catch (err) {
    // ignore
  }
  return null;
};

export const saveLocalAvatar = async (
  userId: number | string,
  sourceUri: string
): Promise<string | null> => {
  try {
    if (!sourceUri || !userId) return null;
    const dest = getLocalAvatarPath(userId);
    if (await RNFS.exists(dest)) {
      await RNFS.unlink(dest).catch(() => {});
    }

    if (sourceUri.startsWith('content://')) {
      await RNFS.copyFile(sourceUri, dest);
      return `file://${dest}`;
    }

    if (sourceUri.startsWith('file://') || sourceUri.startsWith('/')) {
      const cleanPath = sourceUri.replace('file://', '');
      await RNFS.copyFile(cleanPath, dest);
      return `file://${dest}`;
    }

    if (sourceUri.startsWith('http://') || sourceUri.startsWith('https://')) {
      const res = await RNFS.downloadFile({
        fromUrl: sourceUri,
        toFile: dest,
      }).promise;
      if (res.statusCode === 200) {
        return `file://${dest}`;
      }
    }
  } catch (err) {
    console.warn('[AvatarCache] saveLocalAvatar error:', err);
  }
  return null;
};

export const cacheRemoteAvatar = async (
  userId: number | string,
  remoteUri?: string | null
): Promise<string | null> => {
  try {
    if (!remoteUri || !userId) return null;
    const resolved = resolveImageUrl(remoteUri);
    if (!resolved || (!resolved.startsWith('http://') && !resolved.startsWith('https://'))) {
      return null;
    }
    const dest = getLocalAvatarPath(userId);
    const tempDest = `${dest}.tmp`;
    if (await RNFS.exists(tempDest)) {
      await RNFS.unlink(tempDest).catch(() => {});
    }
    const res = await RNFS.downloadFile({
      fromUrl: resolved,
      toFile: tempDest,
    }).promise;
    if (res.statusCode === 200) {
      if (await RNFS.exists(dest)) {
        await RNFS.unlink(dest).catch(() => {});
      }
      await RNFS.moveFile(tempDest, dest);
      return `file://${dest}`;
    } else {
      if (await RNFS.exists(tempDest)) {
        await RNFS.unlink(tempDest).catch(() => {});
      }
    }
  } catch (err) {
    // Network down / offline — silently skip
  }
  return null;
};

export const removeLocalAvatar = async (userId: number | string): Promise<void> => {
  try {
    if (!userId) return;
    const dest = getLocalAvatarPath(userId);
    if (await RNFS.exists(dest)) {
      await RNFS.unlink(dest).catch(() => {});
    }
  } catch {}
};
