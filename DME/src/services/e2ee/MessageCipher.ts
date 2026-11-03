import { SessionManager, EncryptedEnvelope } from './SessionManager';
import { MediaCipher } from './MediaCipher';
import localDatabase from '../LocalDatabase';

export class MessageCipher {
  /**
   * Check if a content string is an encrypted E2EE envelope
   */
  static isEncrypted(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    return (trimmed.includes('"ciphertext"') || trimmed.includes("'ciphertext'")) &&
           (trimmed.includes('"senderIdentityKey"') || trimmed.includes("'senderIdentityKey'"));
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
   * Decrypt a raw message content string from a sender.
   * No permanent in-memory failure cache — allows retry on each call.
   */
  static async decrypt(senderId: string | number, rawContent: string): Promise<string> {
    if (!this.isEncrypted(rawContent)) {
      return rawContent;
    }

    try {
      let contentToParse = rawContent.trim();

      // Defensive unwrapping for Python single-quoted dict wrapper: {'content': '{"senderIdentityKey": ...}'}
      if (contentToParse.startsWith("{'") && contentToParse.includes("'content'")) {
        const match = contentToParse.match(/'content':\s*['"](\{.*?\})['"]/s);
        if (match && match[1]) {
          contentToParse = match[1].replace(/\\"/g, '"');
        }
      }

      // Defensive unwrapping for JSON wrapper: {"content": "{\"senderIdentityKey\": ...}", "message_type": "text"}
      if (contentToParse.includes('"content"') && contentToParse.includes('"senderIdentityKey"')) {
        try {
          const outer = JSON.parse(contentToParse);
          if (outer.content && typeof outer.content === 'string') {
            contentToParse = outer.content;
          }
        } catch {}
      }

      const envelope: EncryptedEnvelope = JSON.parse(contentToParse);
      return await SessionManager.decryptMessage(senderId, envelope);
    } catch (e) {
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

    // Resolve replied message content if encrypted
    if (message.reply_to && message.reply_to.id) {
      if (message.reply_to.content && (this.isEncrypted(message.reply_to.content) || message.reply_to.content.includes('senderIdentityKey'))) {
        try {
          const localReply = localDatabase.getMessageById(message.reply_to.id);
          if (localReply && localReply.content && !this.isEncrypted(localReply.content) && !localReply.content.includes('🔒') && !localReply.content.includes('senderIdentityKey')) {
            message = {
              ...message,
              reply_to: {
                ...message.reply_to,
                content: localReply.content,
                message_type: localReply.message_type || message.reply_to.message_type,
              },
            };
          }
        } catch (_) {}
      }
    }

    // ── Own message (sender side) ──────────────────────────────────────────
    // Retrieve cached plaintext from local SQLite. The WS isOwn handler saves
    // plaintext under the server ID after the echo arrives, so this lookup
    // should always succeed for messages sent this session.
    if (senderId && String(senderId) === String(currentUserId)) {
      const local =
        localDatabase.getMessageById(message.id) ||
        (message.local_id ? localDatabase.getMessageById(message.local_id) : null);

      if (
        local &&
        (local.media_e2ee ||
          (local.content !== null &&
            local.content !== undefined &&
            !this.isEncrypted(local.content) &&
            !local.content.includes('🔒') &&
            !local.content.includes('Unable to decrypt')))
      ) {
        let resolvedContent =
          local.content && !this.isEncrypted(local.content) && !local.content.includes('🔒') && !local.content.includes('Unable to decrypt')
            ? local.content
            : '';
        let mediaE2ee = local.media_e2ee || message.media_e2ee;
        const mediaFileLocal = local.media_file_local || message.media_file_local;
        if (MediaCipher.isMediaEnvelope(resolvedContent)) {
          const parsed = MediaCipher.parseMediaEnvelope(resolvedContent);
          if (parsed) {
            resolvedContent = parsed.caption || '';
            mediaE2ee = parsed;
          }
        }
        return {
          ...message,
          local_id: local.local_id || message.local_id || String(message.id),
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
            local_id: message.local_id || String(message.id),
            content: parsed.caption || '',
            media_e2ee: parsed,
            width: parsed.width || message.width,
            height: parsed.height || message.height,
          };
        }
      }

      // If content is raw ciphertext and not in local SQLite — show placeholder.
      // (The WS isOwn handler should have saved plaintext; this is a last-resort fallback.)
      if (message.content && this.isEncrypted(message.content)) {
        return {
          ...message,
          local_id: message.local_id || String(message.id),
          content: message.media_file ? '' : '🔒 [Encrypted message]',
        };
      }

      return {
        ...message,
        local_id: message.local_id || String(message.id),
      };
    }

    // ── Incoming message (receiver side) ──────────────────────────────────
    if (senderId && message.content && this.isEncrypted(message.content)) {
      // 1. Use local SQLite cache only if the stored content is NOT itself encrypted
      //    (guards against a previous bad-cache entry being re-served)
      const local =
        localDatabase.getMessageById(message.id) ||
        (message.local_id ? localDatabase.getMessageById(message.local_id) : null);

      if (
        local &&
        (local.media_e2ee ||
          (local.content !== null &&
            local.content !== undefined &&
            !this.isEncrypted(local.content) &&
            !local.content.includes('🔒') &&
            !local.content.includes('Unable to decrypt')))
      ) {
        let resolvedContent =
          local.content && !this.isEncrypted(local.content) && !local.content.includes('🔒') && !local.content.includes('Unable to decrypt')
            ? local.content
            : '';
        let mediaE2ee = local.media_e2ee || message.media_e2ee;
        const mediaFileLocal = local.media_file_local || message.media_file_local;
        if (MediaCipher.isMediaEnvelope(resolvedContent)) {
          const parsed = MediaCipher.parseMediaEnvelope(resolvedContent);
          if (parsed) {
            resolvedContent = parsed.caption || '';
            mediaE2ee = parsed;
          }
        }
        return {
          ...message,
          local_id: local.local_id || message.local_id || String(message.id),
          content: resolvedContent,
          media_e2ee: mediaE2ee,
          media_file_local: mediaFileLocal,
          width: mediaE2ee?.width || message.width,
          height: mediaE2ee?.height || message.height,
        };
      }

      // If already known to be undecryptable in local SQLite, do not spam ratchet decrypt errors
      if (local && local.content && local.content.includes('Unable to decrypt')) {
        return {
          ...message,
          local_id: local.local_id || message.local_id || String(message.id),
          content: message.media_file ? '' : local.content,
          media_e2ee: local.media_e2ee || message.media_e2ee || null,
          media_file_local: local.media_file_local || message.media_file_local || null,
        };
      }

      // 2. Decrypt with Double Ratchet
      const decrypted = await this.decrypt(senderId, message.content);
      const decryptionSucceeded = !decrypted.startsWith('🔒');

      // 3. Check if decrypted string is a Media E2EE envelope
      if (MediaCipher.isMediaEnvelope(decrypted)) {
        const parsed = MediaCipher.parseMediaEnvelope(decrypted);
        if (parsed) {
          const res = {
            ...message,
            local_id: message.local_id || String(message.id),
            content: parsed.caption || '',
            media_e2ee: parsed,
            width: parsed.width || message.width,
            height: parsed.height || message.height,
          };
          // Only cache successfully decrypted content so bad cache never blocks retry
          if (decryptionSucceeded) {
            localDatabase.saveMessage(res, message.local_id || String(message.id), 'sent');
          }
          return res;
        }
      }

      const res = {
        ...message,
        local_id: message.local_id || String(message.id),
        content: decrypted,
      };
      // Only cache successfully decrypted content
      if (decryptionSucceeded) {
        localDatabase.saveMessage(res, message.local_id || String(message.id), 'sent');
      }
      return res;
    }

    // ── Unencrypted message ────────────────────────────────────────────────
    const local =
      localDatabase.getMessageById(message.id) ||
      (message.local_id ? localDatabase.getMessageById(message.local_id) : null);
    const mediaFileLocal = local?.media_file_local || message.media_file_local;
    const mediaE2ee = local?.media_e2ee || message.media_e2ee;
    const resolvedContent =
      local?.content && !this.isEncrypted(local.content) ? local.content : message.content;

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
