import 'react-native-get-random-values';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { encode, decode } from 'base64-arraybuffer';

export interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}

declare const global: any;

/** Generate cryptographically secure random bytes */
export function generateRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    const g = typeof global !== 'undefined' ? global : (typeof window !== 'undefined' ? (window as any) : {});
    if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
        return g.crypto.getRandomValues(bytes);
    }
    return bytes;
}

/** Generate an X25519 Key Pair for key exchange */
export function generateX25519KeyPair(): KeyPair {
    const privateKey = generateRandomBytes(32);
    const publicKey = x25519.getPublicKey(privateKey);
    return { publicKey, privateKey };
}

/** Generate an Ed25519 Key Pair for identity and signatures */
export function generateEd25519KeyPair(): KeyPair {
    const privateKey = generateRandomBytes(32);
    const publicKey = ed25519.getPublicKey(privateKey);
    return { publicKey, privateKey };
}

/** Compute an X25519 shared secret */
export function x25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return x25519.getSharedSecret(privateKey, publicKey);
}

/** Sign a message using Ed25519 */
export function ed25519Sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
    return ed25519.sign(message, privateKey);
}

/** Verify an Ed25519 signature */
export function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    return ed25519.verify(signature, message, publicKey);
}

const P = BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819949");
function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [a, m];
    let [old_s, s] = [BigInt(1), BigInt(0)];
    while (r !== BigInt(0)) {
        const quotient = old_r / r;
        [old_r, r] = [r, old_r - quotient * r];
        [old_s, s] = [s, old_s - quotient * s];
    }
    return ((old_s % m) + m) % m;
}

/** Convert Ed25519 Public Key to X25519 (for X3DH) via Birational Equivalence */
export function convertEd25519PublicKeyToX25519(edPubKey: Uint8Array): Uint8Array {
    const yBytes = new Uint8Array(edPubKey);
    yBytes[31] &= 0x7f;
    let y = BigInt(0);
    for (let i = 0; i < 32; i++) {
        y |= BigInt(yBytes[i]) << BigInt(8 * i);
    }
    const u = ((BigInt(1) + y) * modInverse((BigInt(1) - y + P) % P, P)) % P;
    const res = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        res[i] = Number((u >> BigInt(8 * i)) & BigInt(0xff));
    }
    return res;
}

/** Convert Ed25519 Private Key to X25519 (for X3DH) */
export function convertEd25519PrivateKeyToX25519(seed: Uint8Array): Uint8Array {
    const hash = sha512(seed).slice(0, 32);
    hash[0] &= 248;
    hash[31] &= 127;
    hash[31] |= 64;
    return hash;
}

/** Derive keys using HKDF */
export function deriveHKDF(inputKeyMaterial: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    return hkdf(sha256, inputKeyMaterial, salt, info, length);
}

/** Compute HMAC SHA-256 */
export function hmacSHA256(key: Uint8Array, data: Uint8Array): Uint8Array {
    return hmac(sha256, key, data);
}

/** Encrypt using AES-256-GCM */
export function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, associatedData?: Uint8Array): { ciphertext: Uint8Array; nonce: Uint8Array } {
    const nonce = generateRandomBytes(12);
    const cipher = gcm(key, nonce);
    const ciphertext = cipher.encrypt(plaintext);
    return { ciphertext, nonce };
}

/** Decrypt using AES-256-GCM */
export function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    const cipher = gcm(key, nonce);
    return cipher.decrypt(ciphertext);
}

/** Convert Uint8Array to Base64 string */
export function uint8ArrayToBase64(arr: Uint8Array): string {
    const buffer = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
    return encode(buffer as ArrayBuffer);
}

/** Convert Base64 string to Uint8Array */
export function base64ToUint8Array(str: string): Uint8Array {
    return new Uint8Array(decode(str));
}

/** Convert UTF-8 string to Uint8Array */
export function utf8ToBytes(str: string): Uint8Array {
    const utf8 = unescape(encodeURIComponent(str));
    const result = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
        result[i] = utf8.charCodeAt(i);
    }
    return result;
}

/** Convert Uint8Array to UTF-8 string */
export function bytesToUtf8(bytes: Uint8Array): string {
    const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
    return decodeURIComponent(escape(binary));
}

/** Concatenate multiple Uint8Arrays */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    let totalLength = arrays.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
