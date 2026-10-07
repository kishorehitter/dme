import {
    KeyPair,
    generateX25519KeyPair,
    x25519SharedSecret,
    deriveHKDF,
    hmacSHA256,
    aesGcmEncrypt,
    aesGcmDecrypt,
    concatBytes,
    uint8ArrayToBase64,
    base64ToUint8Array,
    utf8ToBytes
} from './CryptoUtils';

export interface RatchetState {
    DHs: KeyPair;
    DHr: Uint8Array | null;
    RK: Uint8Array;
    CKs: Uint8Array | null;
    CKr: Uint8Array | null;
    Ns: number;
    Nr: number;
    PN: number;
    MKSKIPPED: Map<string, Uint8Array>;
    initialMetadata?: any; // To store some ephemeral values if needed
}

export interface RatchetHeader {
    dh: Uint8Array;
    pn: number;
    n: number;
}

const MAX_SKIP = 100;
const INFO_RATCHET = utf8ToBytes('DME_RATCHET');

export class DoubleRatchet {
    /** Initialize a Double Ratchet session as the sender */
    static initSender(sharedSecret: Uint8Array, recipientDHPublicKey: Uint8Array): RatchetState {
        try {
            const DHs = generateX25519KeyPair();
            const DHr = recipientDHPublicKey;
            const dhOutput = x25519SharedSecret(DHs.privateKey, DHr);
            const kdfResult = deriveHKDF(dhOutput, sharedSecret, INFO_RATCHET, 64);
            const RK = kdfResult.slice(0, 32);
            const CKs = kdfResult.slice(32, 64);
            return {
                DHs,
                DHr,
                RK,
                CKs,
                CKr: null,
                Ns: 0,
                Nr: 0,
                PN: 0,
                MKSKIPPED: new Map()
            };
        } catch (e) {
            console.error("Error initializing sender ratchet:", e);
            throw e;
        }
    }

    /** Initialize a Double Ratchet session as the receiver */
    static initReceiver(sharedSecret: Uint8Array, selfDHKeyPair: KeyPair): RatchetState {
        return {
            DHs: selfDHKeyPair,
            DHr: null,
            RK: sharedSecret,
            CKs: null,
            CKr: null,
            Ns: 0,
            Nr: 0,
            PN: 0,
            MKSKIPPED: new Map()
        };
    }

    /** Encrypt a message using the ratchet state */
    static ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): { state: RatchetState; header: RatchetHeader; ciphertext: Uint8Array } {
        try {
            if (!state.CKs) throw new Error("Sending chain is not initialized");
            
            const messageKey = hmacSHA256(state.CKs, new Uint8Array([0x01]));
            state.CKs = hmacSHA256(state.CKs, new Uint8Array([0x02]));
            
            const header: RatchetHeader = {
                dh: state.DHs.publicKey,
                pn: state.PN,
                n: state.Ns
            };
            state.Ns += 1;
            
            const { ciphertext, nonce } = aesGcmEncrypt(messageKey, plaintext);
            
            return { state, header, ciphertext: concatBytes(nonce, ciphertext) };
        } catch (e) {
            console.error("Error encrypting with ratchet:", e);
            throw e;
        }
    }

    /** Decrypt a message using the ratchet state */
    static ratchetDecrypt(state: RatchetState, header: RatchetHeader, ciphertextWithNonce: Uint8Array): { state: RatchetState; plaintext: Uint8Array } {
        try {
            const mkKey = `${uint8ArrayToBase64(header.dh)}_${header.n}`;
            let mk = state.MKSKIPPED.get(mkKey);
            
            if (mk) {
                state.MKSKIPPED.delete(mkKey);
                const plaintext = this.decryptWithMK(mk, ciphertextWithNonce);
                return { state, plaintext };
            }

            if (!state.DHr || uint8ArrayToBase64(header.dh) !== uint8ArrayToBase64(state.DHr)) {
                if (state.DHr) {
                    this.skipMessageKeys(state, header.pn);
                }
                this.dhRatchet(state, header);
            }
            this.skipMessageKeys(state, header.n);
            
            if (!state.CKr) throw new Error("Receiving chain not initialized");
            
            const messageKey = hmacSHA256(state.CKr, new Uint8Array([0x01]));
            state.CKr = hmacSHA256(state.CKr, new Uint8Array([0x02]));
            state.Nr += 1;
            
            const plaintext = this.decryptWithMK(messageKey, ciphertextWithNonce);
            return { state, plaintext };
        } catch (e) {
            console.warn("[E2EE] Ratchet decryption error:", (e as any)?.message || e);
            throw e;
        }
    }

    private static dhRatchet(state: RatchetState, header: RatchetHeader) {
        state.PN = state.Ns;
        state.Ns = 0;
        state.Nr = 0;
        state.DHr = header.dh;
        
        let dhOutput = x25519SharedSecret(state.DHs.privateKey, state.DHr);
        let kdfResult = deriveHKDF(dhOutput, state.RK, INFO_RATCHET, 64);
        state.RK = kdfResult.slice(0, 32);
        state.CKr = kdfResult.slice(32, 64);
        
        state.DHs = generateX25519KeyPair();
        dhOutput = x25519SharedSecret(state.DHs.privateKey, state.DHr);
        kdfResult = deriveHKDF(dhOutput, state.RK, INFO_RATCHET, 64);
        state.RK = kdfResult.slice(0, 32);
        state.CKs = kdfResult.slice(32, 64);
    }

    private static skipMessageKeys(state: RatchetState, until: number) {
        if (!state.CKr) return;
        if (state.Nr + MAX_SKIP < until) {
            throw new Error("Too many skipped messages");
        }
        while (state.Nr < until) {
            const mk = hmacSHA256(state.CKr, new Uint8Array([0x01]));
            state.CKr = hmacSHA256(state.CKr, new Uint8Array([0x02]));
            if (state.DHr) {
                state.MKSKIPPED.set(`${uint8ArrayToBase64(state.DHr)}_${state.Nr}`, mk);
            }
            state.Nr += 1;
        }
    }

    private static decryptWithMK(mk: Uint8Array, ciphertextWithNonce: Uint8Array): Uint8Array {
        const nonce = ciphertextWithNonce.slice(0, 12);
        const ciphertext = ciphertextWithNonce.slice(12);
        return aesGcmDecrypt(mk, nonce, ciphertext);
    }
    
    /** Serialize ratchet state to JSON */
    static serializeState(state: RatchetState): string {
        const serialized = {
            DHs: {
                publicKey: uint8ArrayToBase64(state.DHs.publicKey),
                privateKey: uint8ArrayToBase64(state.DHs.privateKey)
            },
            DHr: state.DHr ? uint8ArrayToBase64(state.DHr) : null,
            RK: uint8ArrayToBase64(state.RK),
            CKs: state.CKs ? uint8ArrayToBase64(state.CKs) : null,
            CKr: state.CKr ? uint8ArrayToBase64(state.CKr) : null,
            Ns: state.Ns,
            Nr: state.Nr,
            PN: state.PN,
            MKSKIPPED: Array.from(state.MKSKIPPED.entries()).map(([k, v]) => [k, uint8ArrayToBase64(v)]),
            initialMetadata: state.initialMetadata || null
        };
        return JSON.stringify(serialized);
    }

    /** Deserialize ratchet state from JSON */
    static deserializeState(json: string): RatchetState {
        const parsed = JSON.parse(json);
        return {
            DHs: {
                publicKey: base64ToUint8Array(parsed.DHs.publicKey),
                privateKey: base64ToUint8Array(parsed.DHs.privateKey)
            },
            DHr: parsed.DHr ? base64ToUint8Array(parsed.DHr) : null,
            RK: base64ToUint8Array(parsed.RK),
            CKs: parsed.CKs ? base64ToUint8Array(parsed.CKs) : null,
            CKr: parsed.CKr ? base64ToUint8Array(parsed.CKr) : null,
            Ns: parsed.Ns,
            Nr: parsed.Nr,
            PN: parsed.PN,
            MKSKIPPED: new Map(parsed.MKSKIPPED.map(([k, v]: [string, string]) => [k, base64ToUint8Array(v)])),
            initialMetadata: parsed.initialMetadata
        };
    }
}
