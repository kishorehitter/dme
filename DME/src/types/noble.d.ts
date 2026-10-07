declare module '@noble/curves/ed25519.js' {
  export const ed25519: {
    getPublicKey: (privateKey: Uint8Array) => Uint8Array;
    sign: (message: Uint8Array, privateKey: Uint8Array) => Uint8Array;
    verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;
  };
  export const x25519: {
    getPublicKey: (privateKey: Uint8Array) => Uint8Array;
    getSharedSecret: (privateKey: Uint8Array, publicKey: Uint8Array) => Uint8Array;
  };
}

declare module '@noble/curves/ed25519' {
  export const ed25519: {
    getPublicKey: (privateKey: Uint8Array) => Uint8Array;
    sign: (message: Uint8Array, privateKey: Uint8Array) => Uint8Array;
    verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;
  };
  export const x25519: {
    getPublicKey: (privateKey: Uint8Array) => Uint8Array;
    getSharedSecret: (privateKey: Uint8Array, publicKey: Uint8Array) => Uint8Array;
  };
}

declare module '@noble/ciphers/aes.js' {
  export const gcm: (key: Uint8Array, nonce: Uint8Array) => {
    encrypt: (plaintext: Uint8Array, associatedData?: Uint8Array) => Uint8Array;
    decrypt: (ciphertext: Uint8Array, associatedData?: Uint8Array) => Uint8Array;
  };
}

declare module '@noble/ciphers/aes' {
  export const gcm: (key: Uint8Array, nonce: Uint8Array) => {
    encrypt: (plaintext: Uint8Array, associatedData?: Uint8Array) => Uint8Array;
    decrypt: (ciphertext: Uint8Array, associatedData?: Uint8Array) => Uint8Array;
  };
}

declare module '@noble/hashes/hkdf.js' {
  export const hkdf: (hash: any, ikm: Uint8Array, salt: Uint8Array | string, info: Uint8Array | string, length: number) => Uint8Array;
}

declare module '@noble/hashes/hkdf' {
  export const hkdf: (hash: any, ikm: Uint8Array, salt: Uint8Array | string, info: Uint8Array | string, length: number) => Uint8Array;
}

declare module '@noble/hashes/sha2.js' {
  export const sha256: any;
  export const sha512: (message: Uint8Array) => Uint8Array;
}

declare module '@noble/hashes/sha2' {
  export const sha256: any;
  export const sha512: (message: Uint8Array) => Uint8Array;
}

declare module '@noble/hashes/hmac.js' {
  export const hmac: (hash: any, key: Uint8Array, data: Uint8Array) => Uint8Array;
}

declare module '@noble/hashes/hmac' {
  export const hmac: (hash: any, key: Uint8Array, data: Uint8Array) => Uint8Array;
}
