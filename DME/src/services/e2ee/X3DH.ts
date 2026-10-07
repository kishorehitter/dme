import {
    x25519SharedSecret,
    deriveHKDF,
    concatBytes,
    KeyPair,
    convertEd25519PublicKeyToX25519,
    convertEd25519PrivateKeyToX25519,
    generateX25519KeyPair,
    utf8ToBytes
} from './CryptoUtils';

export interface RecipientKeyBundle {
    identityKey: Uint8Array; // Ed25519 public key
    signedPreKey: {
        keyId: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
    };
    oneTimePreKey?: {
        keyId: number;
        publicKey: Uint8Array;
    };
}

export interface InitialSessionHeaders {
    identityKey: Uint8Array;
    ephemeralKey: Uint8Array;
    usedSignedPreKeyId: number;
    usedOneTimePreKeyId?: number;
}

export interface SessionResult {
    sharedSecret: Uint8Array;
    ephemeralKeyPair?: KeyPair;
    usedOneTimePreKeyId?: number;
}

const INFO_X3DH = utf8ToBytes('DME_X3DH');

export class X3DH {
    /** Initiate a session (Alice's side) */
    static async initiateSession(
        identityKeyPair: KeyPair,
        recipientBundle: RecipientKeyBundle
    ): Promise<SessionResult> {
        try {
            const ephemeralKeyPair = generateX25519KeyPair();
            
            const identityKeyA_privX = convertEd25519PrivateKeyToX25519(identityKeyPair.privateKey);
            const identityKeyB_pubX = convertEd25519PublicKeyToX25519(recipientBundle.identityKey);
            
            const DH1 = x25519SharedSecret(identityKeyA_privX, recipientBundle.signedPreKey.publicKey);
            const DH2 = x25519SharedSecret(ephemeralKeyPair.privateKey, identityKeyB_pubX);
            const DH3 = x25519SharedSecret(ephemeralKeyPair.privateKey, recipientBundle.signedPreKey.publicKey);
            
            let sharedSecretInput: Uint8Array;
            let usedOneTimePreKeyId: number | undefined;

            if (recipientBundle.oneTimePreKey) {
                const DH4 = x25519SharedSecret(ephemeralKeyPair.privateKey, recipientBundle.oneTimePreKey.publicKey);
                sharedSecretInput = concatBytes(DH1, DH2, DH3, DH4);
                usedOneTimePreKeyId = recipientBundle.oneTimePreKey.keyId;
            } else {
                sharedSecretInput = concatBytes(DH1, DH2, DH3);
            }

            const sharedSecret = deriveHKDF(
                sharedSecretInput,
                new Uint8Array(32),
                INFO_X3DH,
                32
            );

            return {
                sharedSecret,
                ephemeralKeyPair,
                usedOneTimePreKeyId
            };
        } catch (e) {
            console.error("Error initiating X3DH session:", e);
            throw e;
        }
    }

    /** Respond to a session initiation (Bob's side) */
    static async respondToSession(
        headers: InitialSessionHeaders,
        identityKeyPair: KeyPair,
        signedPreKeyPair: KeyPair,
        oneTimePreKeyPair?: KeyPair
    ): Promise<Uint8Array> {
        try {
            const identityKeyB_privX = convertEd25519PrivateKeyToX25519(identityKeyPair.privateKey);
            const identityKeyA_pubX = convertEd25519PublicKeyToX25519(headers.identityKey);
            
            const DH1 = x25519SharedSecret(signedPreKeyPair.privateKey, identityKeyA_pubX);
            const DH2 = x25519SharedSecret(identityKeyB_privX, headers.ephemeralKey);
            const DH3 = x25519SharedSecret(signedPreKeyPair.privateKey, headers.ephemeralKey);
            
            let sharedSecretInput: Uint8Array;

            if (oneTimePreKeyPair && headers.usedOneTimePreKeyId !== undefined) {
                const DH4 = x25519SharedSecret(oneTimePreKeyPair.privateKey, headers.ephemeralKey);
                sharedSecretInput = concatBytes(DH1, DH2, DH3, DH4);
            } else {
                sharedSecretInput = concatBytes(DH1, DH2, DH3);
            }

            const sharedSecret = deriveHKDF(
                sharedSecretInput,
                new Uint8Array(32),
                INFO_X3DH,
                32
            );

            return sharedSecret;
        } catch (e) {
            console.error("Error responding to X3DH session:", e);
            throw e;
        }
    }
}
