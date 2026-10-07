import RNFS from 'react-native-fs';
import { encode, decode } from 'base64-arraybuffer';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  generateRandomBytes,
  aesGcmEncrypt,
  aesGcmDecrypt,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from './CryptoUtils';

export interface EncryptedMediaResult {
  encryptedUri: string;
  mediaKey: string;
  nonce: string;
  fileHash: string;
  mimeType: string;
  fileName: string;
  originalSize: number;
}

export interface MediaE2EEMetadata {
  is_media_encrypted: true;
  media_key: string;
  nonce: string;
  file_hash: string;
  mime_type: string;
  file_name: string;
  file_size?: number;
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
  is_sticker?: boolean;
  is_gif?: boolean;
}

export class MediaCipher {
  /**
   * Check if a text content string contains an encrypted media metadata envelope
   */
  static isMediaEnvelope(content: string | any): boolean {
    if (!content) return false;
    if (typeof content === 'object') {
      return content.is_media_encrypted === true && Boolean(content.media_key);
    }
    if (typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    return trimmed.includes('"is_media_encrypted":true') && trimmed.includes('"media_key"');
  }

  /**
   * Parse a decrypted JSON string into a MediaE2EEMetadata object
   */
  static parseMediaEnvelope(content: string | any): MediaE2EEMetadata | null {
    if (!content) return null;
    if (typeof content === 'object' && content.is_media_encrypted) {
      return content as MediaE2EEMetadata;
    }
    if (typeof content !== 'string') return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.is_media_encrypted === true && parsed.media_key) {
        return parsed as MediaE2EEMetadata;
      }
    } catch {
      // Not valid JSON or not an encrypted media envelope
    }
    return null;
  }

  // In-memory cache for ultra-fast 0ms synchronous local URI lookups
  static memoryCache = new Map<string, string>();

  /**
   * Get the local path where a decrypted media file should be cached
   */
  static getDecryptedCachePath(fileHash: string, extension: string = 'jpg'): string {
    const safeHash = (fileHash || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 32);
    const safeExt = (extension || 'jpg').replace(/^\./, '').replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
    return `${RNFS.CachesDirectoryPath}/media_dec_${safeHash}.${safeExt}`;
  }

  /**
   * Synchronous check if a decrypted file URI is cached in memory
   */
  static getDecryptedLocalUriSync(fileHash: string, extension: string = 'jpg'): string | null {
    if (!fileHash) return null;
    const cacheKey = `${fileHash}_${extension}`;
    if (this.memoryCache.has(cacheKey)) {
      return this.memoryCache.get(cacheKey)!;
    }
    const path = this.getDecryptedCachePath(fileHash, extension);
    const fileUri = `file://${path}`;
    return fileUri;
  }

  /**
   * Check if a decrypted file already exists locally in cache
   */
  static async getDecryptedLocalUriIfExists(fileHash: string, extension: string = 'jpg'): Promise<string | null> {
    try {
      if (!fileHash) return null;
      const cacheKey = `${fileHash}_${extension}`;
      if (this.memoryCache.has(cacheKey)) {
        return this.memoryCache.get(cacheKey)!;
      }
      const path = this.getDecryptedCachePath(fileHash, extension);
      const exists = await RNFS.exists(path);
      if (exists) {
        const fileUri = `file://${path}`;
        this.memoryCache.set(cacheKey, fileUri);
        return fileUri;
      }
    } catch {
      // Ignore cache check failure
    }
    return null;
  }

  /**
   * Encrypt a local media file (Image, Video, Audio, Document) using AES-256-GCM.
   * Produces an encrypted .enc file in the cache directory.
   */
  static async encryptMediaFile(
    localUri: string,
    mimeType: string = 'application/octet-stream',
    fileName: string = 'media.bin'
  ): Promise<EncryptedMediaResult> {
    try {
      let sourcePath = localUri.replace(/^file:\/\//, '');

      // If Android content URI, copy to temporary cache file first
      if (localUri.startsWith('content://')) {
        const tempCopyPath = `${RNFS.CachesDirectoryPath}/temp_raw_${Date.now()}_${fileName}`;
        await RNFS.copyFile(localUri, tempCopyPath);
        sourcePath = tempCopyPath;
      }

      // 1. Read plaintext file as Base64 and convert to Uint8Array
      const fileBase64 = await RNFS.readFile(sourcePath, 'base64');
      const plaintext = new Uint8Array(decode(fileBase64));
      const originalSize = plaintext.length;

      // 2. Generate random 256-bit AES symmetric key
      const key = generateRandomBytes(32);

      // 3. Encrypt using AES-256-GCM
      const { ciphertext, nonce } = aesGcmEncrypt(key, plaintext);

      // 4. Compute SHA-256 hash of ciphertext for integrity verification
      const hashBytes = sha256(ciphertext);
      const fileHash = uint8ArrayToBase64(hashBytes);

      // 5. Write ciphertext to temporary .enc file
      const safeHash = fileHash.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 16);
      const encFileName = `enc_${Date.now()}_${safeHash}.enc`;
      const encPath = `${RNFS.CachesDirectoryPath}/${encFileName}`;
      const ciphertextBase64 = encode(ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer);
      await RNFS.writeFile(encPath, ciphertextBase64, 'base64');

      // Cleanup content URI temp copy if created
      if (localUri.startsWith('content://') && sourcePath.includes('temp_raw_')) {
        await RNFS.unlink(sourcePath).catch(() => {});
      }

      return {
        encryptedUri: `file://${encPath}`,
        mediaKey: uint8ArrayToBase64(key),
        nonce: uint8ArrayToBase64(nonce),
        fileHash,
        mimeType,
        fileName: encFileName,
        originalSize,
      };
    } catch (error) {
      console.error('[MediaCipher] Error encrypting media file:', error);
      throw error;
    }
  }

  /**
   * Decrypt an encrypted media file from a local path or remote URL.
   * Writes the decrypted plaintext to the cache directory and returns the local file URI.
   */
  static async decryptMediaFile(
    encryptedUrlOrUri: string,
    mediaKey: string,
    nonce: string,
    fileHash: string,
    extension: string = 'jpg'
  ): Promise<string> {
    try {
      const destPath = this.getDecryptedCachePath(fileHash, extension);

      // 1. Return immediately if already cached
      if (await RNFS.exists(destPath)) {
        return `file://${destPath}`;
      }

      let encSourcePath = encryptedUrlOrUri.replace(/^file:\/\//, '');
      let isDownloadedTemp = false;

      // 2. If it is a remote HTTP URL, download the .enc file first
      if (encryptedUrlOrUri.startsWith('http://') || encryptedUrlOrUri.startsWith('https://')) {
        const safeHash = (fileHash || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 16);
        const tempEncPath = `${RNFS.CachesDirectoryPath}/dl_${Date.now()}_${safeHash}.enc`;
        const downloadRes = await RNFS.downloadFile({
          fromUrl: encryptedUrlOrUri,
          toFile: tempEncPath,
        }).promise;

        if (downloadRes.statusCode !== 200) {
          throw new Error(`Download failed with status ${downloadRes.statusCode}`);
        }
        encSourcePath = tempEncPath;
        isDownloadedTemp = true;
      }

      // 3. Read ciphertext bytes
      const encBase64 = await RNFS.readFile(encSourcePath, 'base64');
      const ciphertext = new Uint8Array(decode(encBase64));

      // 4. Decrypt using AES-256-GCM
      const keyBytes = base64ToUint8Array(mediaKey);
      const nonceBytes = base64ToUint8Array(nonce);
      const decryptedBytes = aesGcmDecrypt(keyBytes, nonceBytes, ciphertext);

      // 5. Write decrypted plaintext to cache destination
      const decryptedBase64 = encode(decryptedBytes.buffer.slice(decryptedBytes.byteOffset, decryptedBytes.byteOffset + decryptedBytes.byteLength) as ArrayBuffer);
      await RNFS.writeFile(destPath, decryptedBase64, 'base64');

      // 6. Cleanup temporary download file
      if (isDownloadedTemp) {
        await RNFS.unlink(encSourcePath).catch(() => {});
      }

      const finalUri = `file://${destPath}`;
      const cacheKey = `${fileHash}_${extension}`;
      this.memoryCache.set(cacheKey, finalUri);
      return finalUri;
    } catch (error) {
      console.error('[MediaCipher] Error decrypting media file:', error);
      throw error;
    }
  }
}

export default MediaCipher;
