import { SessionManager, EncryptedEnvelope } from './SessionManager';
import { MediaCipher } from './MediaCipher';
import localDatabase from '../LocalDatabase';

const failedDecryptionKeys = new Set<string>();

export class MessageCipher {
  /**
   * Check if a content string is an encrypted E2EE envelope
   */
  static isEncrypted(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    return trimmed.includes('"ciphertext"') && trimmed.includes('"senderIdentityKey"');
  }

  /**
   * Encrypt a plaintext string for a recipient
   */
  static async encrypt(recipientId: string | number, plaintext: string): Promise<string> {
    try {
      const envelope = await SessionManager.encryptMessage(recipientId, plaintext);
      return JSON.stringify(envelope);
    } catch (e) {
      console.error('[E2EE] Failed to encrypt message for recipient', recipientId, e);
      throw e;
    }
  }

  static async encryptMessage(recipientId: string | number, plaintext: string): Promise<string> {
    return MessageCipher.encrypt(recipientId, plaintext);
  }

  static async decryptMessage(senderId: string | number, rawContent: string): Promise<string> {
    return MessageCipher.decrypt(senderId, rawContent);
  }

  /**
   * Decrypt a raw message content string from a sender
   */
  static async decrypt(senderId: string | number, rawContent: string): Promise<string> {
    if (!this.isEncrypted(rawContent)) {
      return rawContent;
    }

    const cacheKey = `${senderId}_${rawContent.slice(0, 100)}`;
    if (failedDecryptionKeys.has(cacheKey)) {
      return '🔒 [Unable to decrypt message]';
    }

    try {
      const envelope: EncryptedEnvelope = JSON.parse(rawContent);
      return await SessionManager.decryptMessage(senderId, envelope);
    } catch (e) {
      failedDecryptionKeys.add(cacheKey);
      console.warn(`[E2EE] Failed to decrypt message from sender ${senderId}:`, (e as any)?.message || e);
      return '🔒 [Unable to decrypt message]';
    }
  }

  /**
   * Process a single incoming message, decrypting content if needed
   */
  static async processIncomingMessage(currentUserId: string | number, message: any): Promise<any> {
    if (!message) return message;
    const senderId = message.sender?.id ?? message.sender_id;
    
    // If it's our own message, retrieve the cached plaintext and media from local SQLite
    if (senderId && String(senderId) === String(currentUserId)) {
      const local = localDatabase.getMessageById(message.id) || (message.local_id ? localDatabase.getMessageById(message.local_id) : null);
      if (local && (local.media_e2ee || (local.content !== null && local.content !== undefined && !this.isEncrypted(local.content)))) {
        let resolvedContent = (local.content && !this.isEncrypted(local.content)) ? local.content : '';
        let mediaE2ee = local.media_e2ee || message.media_e2ee;
        let mediaFileLocal = local.media_file_local || message.media_file_local;
        if (MediaCipher.isMediaEnvelope(resolvedContent)) {
          const parsed = MediaCipher.parseMediaEnvelope(resolvedContent);
          if (parsed) {
            resolvedContent = parsed.caption || '';
            mediaE2ee = parsed;
          }
        }
        return {
          ...message,
          content: resolvedContent,
          media_e2ee: mediaE2ee,
          media_file_local: mediaFileLocal,
          width: mediaE2ee?.width || message.width,
          height: mediaE2ee?.height || message.height,
        };
      }
      // Check if message content is a media envelope JSON
      if (message.content && MediaCipher.isMediaEnvelope(message.content)) {
        const parsed = MediaCipher.parseMediaEnvelope(message.content);
        if (parsed) {
          return {
            ...message,
            content: parsed.caption || '',
            media_e2ee: parsed,
            width: parsed.width || message.width,
            height: parsed.height || message.height,
          };
        }
      }
      // If content is raw ciphertext and not in local SQLite
      if (message.content && this.isEncrypted(message.content)) {
        return {
          ...message,
          content: message.media_file ? '' : '🔒 [Encrypted message]',
        };
      }
      return message;
    }

    if (senderId && message.content && this.isEncrypted(message.content)) {
      // 1. Check if this message was already decrypted and cached in local SQLite
      const local = localDatabase.getMessageById(message.id) || (message.local_id ? localDatabase.getMessageById(message.local_id) : null);
      if (local && (local.media_e2ee || (local.content !== null && local.content !== undefined && !this.isEncrypted(local.content)))) {
        let resolvedContent = (local.content && !this.isEncrypted(local.content)) ? local.content : '';
        let mediaE2ee = local.media_e2ee || message.media_e2ee;
        let mediaFileLocal = local.media_file_local || message.media_file_local;
        if (MediaCipher.isMediaEnvelope(resolvedContent)) {
          const parsed = MediaCipher.parseMediaEnvelope(resolvedContent);
          if (parsed) {
            resolvedContent = parsed.caption || '';
            mediaE2ee = parsed;
          }
        }
        return {
          ...message,
          content: resolvedContent,
          media_e2ee: mediaE2ee,
          media_file_local: mediaFileLocal,
          width: mediaE2ee?.width || message.width,
          height: mediaE2ee?.height || message.height,
        };
      }

      // 2. Decrypt with Double Ratchet
      const decrypted = await this.decrypt(senderId, message.content);
      
      // 3. Check if decrypted string is a Media E2EE envelope
      if (MediaCipher.isMediaEnvelope(decrypted)) {
        const parsed = MediaCipher.parseMediaEnvelope(decrypted);
        if (parsed) {
          const res = {
            ...message,
            content: parsed.caption || '',
            media_e2ee: parsed,
            width: parsed.width || message.width,
            height: parsed.height || message.height,
          };
          // Immediately cache decrypted message in local SQLite so ratchet is never called again
          localDatabase.saveMessage(res, message.local_id || String(message.id), 'sent');
          return res;
        }
      }

      const res = { ...message, content: decrypted };
      localDatabase.saveMessage(res, message.local_id || String(message.id), 'sent');
      return res;
    }

    const local = localDatabase.getMessageById(message.id) || (message.local_id ? localDatabase.getMessageById(message.local_id) : null);
    let mediaFileLocal = local?.media_file_local || message.media_file_local;
    let mediaE2ee = local?.media_e2ee || message.media_e2ee;
    let resolvedContent = (local?.content && !this.isEncrypted(local.content)) ? local.content : message.content;

    // Direct check if unencrypted content contains media envelope
    if (resolvedContent && MediaCipher.isMediaEnvelope(resolvedContent)) {
      const parsed = MediaCipher.parseMediaEnvelope(resolvedContent);
      if (parsed) {
        return {
          ...message,
          content: parsed.caption || '',
          media_e2ee: parsed,
          media_file_local: mediaFileLocal,
          width: parsed.width || message.width,
          height: parsed.height || message.height,
        };
      }
    }

    return {
      ...message,
      content: resolvedContent,
      media_e2ee: mediaE2ee,
      media_file_local: mediaFileLocal,
      width: mediaE2ee?.width || message.width,
      height: mediaE2ee?.height || message.height,
    };
  }

  /**
   * Process an array of messages sequentially, decrypting in strict ratchet order
   */
  static async processMessageList(currentUserId: string | number, messages: any[]): Promise<any[]> {
    if (!Array.isArray(messages)) return [];
    const results: any[] = [];
    for (const m of messages) {
      results.push(await this.processIncomingMessage(currentUserId, m));
    }
    return results;
  }
}

export default MessageCipher;
