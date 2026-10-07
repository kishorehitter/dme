import { open } from 'react-native-nitro-sqlite';
import { Conversation, Message } from '../types';

const DB_NAME = 'dme_offline.sqlite';
const db = open({ name: DB_NAME });

// ─── PARAMETER SANITIZATION HELPERS FOR NITRO-SQLITE ────────────────────────
const toPrimitiveString = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    if (val.uri && typeof val.uri === 'string') return val.uri;
    if (val.content && typeof val.content === 'string') return val.content;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
};

const toPrimitiveNumber = (val: any, fallback: number = 0): number => {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num)) return num;
  }
  if (val && typeof val === 'object' && typeof val.id === 'number') {
    return val.id;
  }
  return fallback;
};

const toPrimitiveNullableNumber = (val: any): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num)) return num;
  }
  if (val && typeof val === 'object' && typeof val.id === 'number') {
    return val.id;
  }
  return null;
};

const toPrimitiveJsonString = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    return val;
  }
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
};

export const localDatabase = {
  /**
   * Initializes the SQLite Database.
   * Creates the conversations and messages tables and enables Foreign Keys.
   */
  initDb() {
    try {
      // Enable Foreign Keys for referential integrity
      db.execute('PRAGMA foreign_keys = ON;');

      // Create Conversations Table
      db.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY,
          name TEXT,
          is_group INTEGER DEFAULT 0,
          profile_picture TEXT,
          last_message_content TEXT,
          last_message_timestamp TEXT,
          unread_count INTEGER DEFAULT 0,
          updated_at TEXT,
          other_user TEXT,
          last_message_status TEXT DEFAULT 'sent',
          last_message_sender_id INTEGER
        );
      `);

      // Migration: Add columns to conversations table if they don't exist
      try {
        db.execute('ALTER TABLE conversations ADD COLUMN other_user TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE conversations ADD COLUMN last_message_status TEXT DEFAULT \'sent\';');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE conversations ADD COLUMN last_message_sender_id INTEGER;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE conversations ADD COLUMN is_locked INTEGER DEFAULT 0;');
      } catch (err) {
        // Column already exists, safe to ignore
      }

      // Create Messages Table
      db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          local_id TEXT PRIMARY KEY,
          id INTEGER,
          conversation_id INTEGER,
          user TEXT,
          content TEXT,
          message_type TEXT DEFAULT 'text',
          media_file TEXT,
          created_at TEXT,
          reactions TEXT,
          reply_to TEXT,
          status TEXT DEFAULT 'sent',
          is_deleted INTEGER DEFAULT 0,
          edited_at TEXT,
          sender_id INTEGER,
          sender TEXT,
          media_group_id TEXT,
          media_e2ee TEXT,
          media_file_local TEXT,
          delivered_at TEXT,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
      `);

      // Migration: Add sender_id and sender columns to messages table if they don't exist
      try {
        db.execute('ALTER TABLE messages ADD COLUMN sender_id INTEGER;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE messages ADD COLUMN sender TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE messages ADD COLUMN media_group_id TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE messages ADD COLUMN media_e2ee TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE messages ADD COLUMN media_file_local TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }
      try {
        db.execute('ALTER TABLE messages ADD COLUMN delivered_at TEXT;');
      } catch (err) {
        // Column already exists, safe to ignore
      }

      // Composite index for fast per-conversation message queries (used by getRecentMessages, getMessagesBefore)
      try {
        db.execute(`CREATE INDEX IF NOT EXISTS idx_messages_conv_created 
          ON messages (conversation_id, created_at DESC);`);
      } catch (err) {
        // Index already exists or unsupported — safe to ignore
      }

      console.log('📂 Offline Database initialized successfully.');
    } catch (error) {
      console.error('❌ Failed to initialize offline database:', error);
    }
  },

  // ─── CONVERSATIONS QUERY APIs ──────────────────────────────────────────────

  /**
   * Saves or updates a single conversation in the local database.
   */
  saveConversation(conv: Conversation) {
    try {
      const convId = toPrimitiveNumber(conv?.id, 0);
      if (!convId) return;

      const lastMsg = conv.last_message as any;
      let lastMsgContent: string | null = null;
      let lastMsgCreatedAt: string | null = null;
      let lastMsgSenderId: number | null = null;
      let lastMsgStatus = 'sent';

      if (lastMsg) {
        lastMsgContent = toPrimitiveString(lastMsg.content);
        lastMsgCreatedAt = toPrimitiveString(lastMsg.created_at);
        lastMsgSenderId = toPrimitiveNullableNumber(lastMsg.sender_id ?? lastMsg.sender?.id ?? lastMsg.sender);
        lastMsgStatus = toPrimitiveString(
          lastMsg.status || (lastMsg.is_read ? 'read' : (lastMsg.delivered_at ? 'delivered' : 'sent'))
        ) || 'sent';
      }

      const nameStr = toPrimitiveString(conv.name);
      const picStr = toPrimitiveString(conv.profile_picture);
      const updatedAtStr = toPrimitiveString(conv.updated_at);
      const otherUserStr = toPrimitiveJsonString(conv.other_user);
      const isGroupNum = conv.is_group ? 1 : 0;
      const unreadCountNum = toPrimitiveNumber(conv.unread_count, 0);

      db.execute(
        `INSERT INTO conversations (
          id, name, is_group, profile_picture, last_message_content, last_message_timestamp, unread_count, updated_at, other_user, last_message_status, last_message_sender_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, conversations.name),
          is_group = excluded.is_group,
          profile_picture = COALESCE(excluded.profile_picture, conversations.profile_picture),
          last_message_content = COALESCE(excluded.last_message_content, conversations.last_message_content),
          last_message_timestamp = COALESCE(excluded.last_message_timestamp, conversations.last_message_timestamp),
          unread_count = excluded.unread_count,
          updated_at = COALESCE(excluded.updated_at, conversations.updated_at),
          other_user = COALESCE(excluded.other_user, conversations.other_user),
          last_message_status = COALESCE(excluded.last_message_status, conversations.last_message_status),
          last_message_sender_id = COALESCE(excluded.last_message_sender_id, conversations.last_message_sender_id);`,
        [
          convId,
          nameStr,
          isGroupNum,
          picStr,
          lastMsgContent,
          lastMsgCreatedAt,
          unreadCountNum,
          updatedAtStr,
          otherUserStr,
          lastMsgStatus,
          lastMsgSenderId,
        ]
      );
    } catch (error) {
      console.error(`❌ Error saving conversation ${conv?.id}:`, error);
    }
  },

  /**
   * Bulk saves/updates conversations.
   */
  saveConversations(convs: Conversation[]) {
    try {
      if (!convs || convs.length === 0) {
        db.execute('DELETE FROM messages;');
        db.execute('DELETE FROM conversations;');
        return;
      }

      const validIds = convs.map(c => Number(c.id)).filter(id => !isNaN(id));
      if (validIds.length > 0) {
        const placeholders = validIds.map(() => '?').join(',');
        db.execute(`DELETE FROM conversations WHERE id NOT IN (${placeholders});`, validIds);
      }

      // Use transaction for bulk inserts
      db.transaction(async (tx) => {
        for (const conv of convs) {
          const convId = toPrimitiveNumber(conv?.id, 0);
          if (!convId) continue;

          const lastMsg = conv.last_message as any;
          let lastMsgContent: string | null = null;
          let lastMsgCreatedAt: string | null = null;
          let lastMsgSenderId: number | null = null;
          let lastMsgStatus = 'sent';

          if (lastMsg) {
            lastMsgContent = toPrimitiveString(lastMsg.content);
            lastMsgCreatedAt = toPrimitiveString(lastMsg.created_at);
            lastMsgSenderId = toPrimitiveNullableNumber(lastMsg.sender_id ?? lastMsg.sender?.id ?? lastMsg.sender);
            lastMsgStatus = toPrimitiveString(
              lastMsg.status || (lastMsg.is_read ? 'read' : (lastMsg.delivered_at ? 'delivered' : 'sent'))
            ) || 'sent';
          }

          const nameStr = toPrimitiveString(conv.name);
          const picStr = toPrimitiveString(conv.profile_picture);
          const updatedAtStr = toPrimitiveString(conv.updated_at);
          const otherUserStr = toPrimitiveJsonString(conv.other_user);
          const isGroupNum = conv.is_group ? 1 : 0;
          const unreadCountNum = toPrimitiveNumber(conv.unread_count, 0);

          tx.execute(
            `INSERT INTO conversations (
              id, name, is_group, profile_picture, last_message_content, last_message_timestamp, unread_count, updated_at, other_user, last_message_status, last_message_sender_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = COALESCE(excluded.name, conversations.name),
              is_group = excluded.is_group,
              profile_picture = COALESCE(excluded.profile_picture, conversations.profile_picture),
              last_message_content = COALESCE(excluded.last_message_content, conversations.last_message_content),
              last_message_timestamp = COALESCE(excluded.last_message_timestamp, conversations.last_message_timestamp),
              unread_count = excluded.unread_count,
              updated_at = COALESCE(excluded.updated_at, conversations.updated_at),
              other_user = COALESCE(excluded.other_user, conversations.other_user),
              last_message_status = COALESCE(excluded.last_message_status, conversations.last_message_status),
              last_message_sender_id = COALESCE(excluded.last_message_sender_id, conversations.last_message_sender_id);`,
            [
              convId,
              nameStr,
              isGroupNum,
              picStr,
              lastMsgContent,
              lastMsgCreatedAt,
              unreadCountNum,
              updatedAtStr,
              otherUserStr,
              lastMsgStatus,
              lastMsgSenderId,
            ]
          );
        }
      });
    } catch (error) {
      console.error('❌ Error bulk saving conversations:', error);
    }
  },

  /**
   * Retrieves all conversations from the local database sorted by last active time.
   * By default, filters out locked chats unless includeLocked is true.
   */
  getConversations(includeLocked = false): Conversation[] {
    try {
      const query = includeLocked
        ? 'SELECT * FROM conversations ORDER BY updated_at DESC;'
        : 'SELECT * FROM conversations WHERE is_locked IS NULL OR is_locked = 0 ORDER BY updated_at DESC;';
      const { results } = db.execute(query);
      if (!results) return [];

      return (results as any[]).map((row: any) => ({
        id: Number(row.id),
        name: (row.name as string) || null,
        is_group: row.is_group === 1,
        profile_picture: (row.profile_picture as string) || null,
        other_user: row.other_user ? JSON.parse(String(row.other_user)) : null,
        is_locked: row.is_locked === 1,
        last_message: row.last_message_content
          ? {
              id: 0, // Mocked for UI
              content: String(row.last_message_content),
              message_type: 'text',
              created_at: String(row.last_message_timestamp || ''),
              sender_id: row.last_message_sender_id ? Number(row.last_message_sender_id) : null,
              status: String(row.last_message_status || 'sent'),
            }
          : null,
        unread_count: Number(row.unread_count || 0),
        updated_at: String(row.updated_at || ''),
      })) as Conversation[];
    } catch (error) {
      console.error('❌ Error getting conversations:', error);
      return [];
    }
  },

  /**
   * Retrieves all locked conversations.
   */
  getLockedConversations(): Conversation[] {
    try {
      const { results } = db.execute(
        'SELECT * FROM conversations WHERE is_locked = 1 ORDER BY updated_at DESC;'
      );
      if (!results) return [];

      return (results as any[]).map((row: any) => ({
        id: Number(row.id),
        name: (row.name as string) || null,
        is_group: row.is_group === 1,
        profile_picture: (row.profile_picture as string) || null,
        other_user: row.other_user ? JSON.parse(String(row.other_user)) : null,
        is_locked: true,
        last_message: row.last_message_content
          ? {
              id: 0,
              content: String(row.last_message_content),
              message_type: 'text',
              created_at: String(row.last_message_timestamp || ''),
              sender_id: row.last_message_sender_id ? Number(row.last_message_sender_id) : null,
              status: String(row.last_message_status || 'sent'),
            }
          : null,
        unread_count: Number(row.unread_count || 0),
        updated_at: String(row.updated_at || ''),
      })) as Conversation[];
    } catch (error) {
      console.error('❌ Error getting locked conversations:', error);
      return [];
    }
  },

  /**
   * Sets or unsets lock status for a conversation.
   */
  setChatLocked(conversationId: number, isLocked: boolean) {
    try {
      db.execute(
        'UPDATE conversations SET is_locked = ? WHERE id = ?;',
        [isLocked ? 1 : 0, conversationId]
      );
    } catch (error) {
      console.error(`❌ Error setting locked status for conversation ${conversationId}:`, error);
    }
  },

  /**
   * Retrieves all locked conversation IDs.
   */
  getLockedConversationIds(): number[] {
    try {
      const { results } = db.execute('SELECT id FROM conversations WHERE is_locked = 1;');
      if (!results) return [];
      return results.map((r) => Number(r.id)).filter((id) => !isNaN(id));
    } catch (error) {
      console.error('❌ Error getting locked conversation IDs:', error);
      return [];
    }
  },

  // ─── MESSAGES QUERY APIs ────────────────────────────────────────────────────

  /**
   * Saves an optimistically sent message or a newly received message.
   */
  saveMessage(msg: any, localId: string, status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' = 'sent') {
    try {
      const conversationId = toPrimitiveNullableNumber(msg.conversation);
      if (conversationId) {
        // Ensure conversation exists in conversations table to satisfy FOREIGN KEY constraint
        db.execute(
          'INSERT OR IGNORE INTO conversations (id, name) VALUES (?, ?);',
          [conversationId, toPrimitiveString(msg.sender?.display_name || msg.sender?.email || msg.user || 'Chat')]
        );
      }

      db.execute(
        `INSERT OR REPLACE INTO messages (
          local_id, id, conversation_id, user, content, message_type, media_file, created_at, reactions, reply_to, status, is_deleted, edited_at, sender_id, sender, media_group_id, media_e2ee, media_file_local, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          toPrimitiveString(localId),
          toPrimitiveNullableNumber(msg.id),
          conversationId,
          toPrimitiveString(msg.sender?.display_name || msg.sender?.email || msg.user),
          toPrimitiveString(msg.content),
          toPrimitiveString(msg.message_type || 'text'),
          toPrimitiveString(msg.media_file),
          toPrimitiveString(msg.created_at),
          toPrimitiveJsonString(msg.reactions),
          toPrimitiveJsonString(msg.reply_to),
          toPrimitiveString(status),
          0, // is_deleted = 0
          toPrimitiveString(msg.edited_at),
          toPrimitiveNullableNumber(msg.sender?.id || msg.sender_id || (msg.user_id ? Number(msg.user_id) : null)),
          toPrimitiveJsonString(msg.sender),
          toPrimitiveString(msg.media_group_id),
          toPrimitiveJsonString(msg.media_e2ee),
          toPrimitiveString(msg.media_file_local),
          toPrimitiveString(msg.delivered_at),
        ]
      );
    } catch (error) {
      console.error(`❌ Error saving message (local_id: ${localId}):`, error);
    }
  },

  /**
   * Bulk saves/caches messages from the server for a specific conversation.
   * NOTE: op-sqlite does NOT support async transaction callbacks — they fire-and-forget
   * so tx.execute calls never actually run. Use plain db.execute instead.
   */
  saveMessages(msgs: any[], conversationId: number | string) {
    try {
      const convId = toPrimitiveNumber(conversationId, 0);
      if (!convId) return;

      // Ensure conversation row exists
      db.execute(
        'INSERT OR IGNORE INTO conversations (id, name) VALUES (?, ?);',
        [convId, 'Chat']
      );

      for (const msg of msgs) {
        // Find existing message by server id to preserve local plaintext & file URI
        const existing = this.getMessageById(msg.id);
        const localId = toPrimitiveString(msg.local_id || existing?.local_id || msg.id?.toString());
        if (!localId) continue;

        let contentToSave = toPrimitiveString(msg.content);
        let mediaFileToSave = toPrimitiveString(msg.media_file);
        let mediaE2eeToSave = toPrimitiveJsonString(msg.media_e2ee || existing?.media_e2ee);
        let mediaFileLocalToSave = toPrimitiveString(msg.media_file_local || existing?.media_file_local);

        if (existing) {
          // Preserve decrypted plaintext content if available
          if (
            existing.content &&
            typeof existing.content === 'string' &&
            !existing.content.includes('ciphertext') &&
            !existing.content.includes('ratchetHeader')
          ) {
            contentToSave = existing.content;
          }
          // Preserve local media file path if available
          if (
            existing.media_file &&
            typeof existing.media_file === 'string' &&
            (existing.media_file.startsWith('file://') || existing.media_file.startsWith('/'))
          ) {
            mediaFileToSave = existing.media_file;
          }
        }
        // Preserve more specific message_type (sticker/gif) over server's generic 'image'
        let messageTypeToSave = toPrimitiveString(msg.message_type || 'text');
        if (existing && messageTypeToSave === 'image' &&
            (existing.message_type === 'sticker' || existing.message_type === 'gif')) {
          messageTypeToSave = existing.message_type;
        }
        // Also derive from media_e2ee metadata if available
        const e2eeMeta = msg.media_e2ee || (existing?.media_e2ee);
        if (messageTypeToSave === 'image' && e2eeMeta) {
          if (e2eeMeta.is_gif) messageTypeToSave = 'gif';
          else if (e2eeMeta.is_sticker) messageTypeToSave = 'sticker';
        }

        try {
          db.execute(
            `INSERT OR REPLACE INTO messages (
              local_id, id, conversation_id, user, content, message_type, media_file, created_at, reactions, reply_to, status, is_deleted, edited_at, sender_id, sender, media_group_id, media_e2ee, media_file_local, delivered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              localId,
              toPrimitiveNullableNumber(msg.id),
              convId,
              toPrimitiveString(msg.sender?.display_name || msg.sender?.email || msg.user),
              contentToSave,
              messageTypeToSave,
              mediaFileToSave,
              toPrimitiveString(msg.created_at),
              toPrimitiveJsonString(msg.reactions),
              toPrimitiveJsonString(msg.reply_to),
              msg.is_read ? 'read' : 'sent',
              msg.is_deleted ? 1 : 0,
              toPrimitiveString(msg.edited_at),
              toPrimitiveNullableNumber(msg.sender?.id || msg.sender_id || (msg.user_id ? Number(msg.user_id) : null)),
              toPrimitiveJsonString(msg.sender),
              toPrimitiveString(msg.media_group_id),
              mediaE2eeToSave,
              mediaFileLocalToSave,
              toPrimitiveString(msg.delivered_at || existing?.delivered_at),
            ]
          );
        } catch (rowErr) {
          console.error(`❌ Error saving message id=${msg.id} in bulk save:`, rowErr);
        }
      }
    } catch (error) {
      console.error(`❌ Error bulk saving messages for conv ${conversationId}:`, error);
    }
  },


  /**
   * Retrieves recent messages for instant chat room render (fast indexed query with LIMIT).
   */
  getRecentMessages(conversationId: number | string, limit: number = 30): any[] {
    try {
      const convId = Number(conversationId);
      const { results } = db.execute(
        `SELECT * FROM (
           SELECT * FROM messages 
           WHERE conversation_id = ? AND is_deleted = 0 AND status != 'sending'
           ORDER BY created_at DESC 
           LIMIT ?
         ) ORDER BY created_at ASC;`,
        [convId, limit]
      );
      if (!results) return [];

      const validRows = results.filter((row: any) => {
        if (row.media_file || row.media_e2ee || row.media_file_local) {
          return true;
        }
        if (row.content && typeof row.content === 'string') {
          if (row.content.includes('ratchetHeader') && row.content.includes('ciphertext')) {
            return false;
          }
          if (row.content.includes('Unable to decrypt')) {
            return false;
          }
        }
        return true;
      });

      return validRows.map((row: any) => {
        let senderObj = null;
        if (row.sender) {
          try { senderObj = JSON.parse(String(row.sender)); } catch {}
        }
        if (!senderObj) {
          senderObj = {
            id: row.sender_id ? Number(row.sender_id) : (typeof row.user === 'number' ? row.user : 0),
            display_name: (row.user as string) || 'Unknown',
            email: (row.user as string) || '',
          };
        }
        return {
          local_id: String(row.local_id),
          id: Number(row.id),
          sender: senderObj,
          sender_id: row.sender_id ? Number(row.sender_id) : senderObj.id,
          user: (row.user as string) || '',
          content: (row.content as string) || '',
          message_type: (row.message_type as string) || 'text',
          media_file: (row.media_file as string) || null,
          is_read: row.status === 'read',
          delivered_at: (row.delivered_at as string) || null,
          created_at: String(row.created_at || ''),
          edited_at: (row.edited_at as string) || null,
          status: String(row.status || 'sent'),
          reply_to: row.reply_to ? JSON.parse(String(row.reply_to)) : null,
          reactions: row.reactions ? JSON.parse(String(row.reactions)) : null,
          media_group_id: (row.media_group_id as string) || null,
          media_e2ee: row.media_e2ee ? (typeof row.media_e2ee === 'string' ? JSON.parse(row.media_e2ee) : row.media_e2ee) : null,
          media_file_local: (row.media_file_local as string) || null,
        };
      });
    } catch (error) {
      console.error(`❌ Error getting recent messages for conv ${conversationId}:`, error);
      return [];
    }
  },

  /**
   * Retrieves older messages before a specific message ID (for pagination when scrolling up).
   */
  getMessagesBefore(conversationId: number | string, beforeId: number, limit: number = 30): any[] {
    try {
      const convId = Number(conversationId);
      const { results } = db.execute(
        `SELECT * FROM (
           SELECT * FROM messages 
           WHERE conversation_id = ? AND id < ? AND is_deleted = 0 AND status != 'sending'
           ORDER BY created_at DESC 
           LIMIT ?
         ) ORDER BY created_at ASC;`,
        [convId, beforeId, limit]
      );
      if (!results) return [];

      const validRows = (results as any[]).filter((row: any) => {
        if (row.media_file || row.media_e2ee || row.media_file_local) {
          return true;
        }
        if (row.content && typeof row.content === 'string') {
          if (row.content.includes('ratchetHeader') && row.content.includes('ciphertext')) {
            return false;
          }
          if (row.content.includes('Unable to decrypt')) {
            return false;
          }
        }
        return true;
      });

      return validRows.map((row: any) => {
        let senderObj = null;
        if (row.sender) {
          try { senderObj = JSON.parse(String(row.sender)); } catch {}
        }
        if (!senderObj) {
          senderObj = {
            id: row.sender_id ? Number(row.sender_id) : (typeof row.user === 'number' ? row.user : 0),
            display_name: (row.user as string) || 'Unknown',
            email: (row.user as string) || '',
          };
        }
        return {
          local_id: String(row.local_id),
          id: Number(row.id),
          sender: senderObj,
          sender_id: row.sender_id ? Number(row.sender_id) : senderObj.id,
          user: (row.user as string) || '',
          content: (row.content as string) || '',
          message_type: (row.message_type as string) || 'text',
          media_file: (row.media_file as string) || null,
          is_read: row.status === 'read',
          delivered_at: (row.delivered_at as string) || null,
          created_at: String(row.created_at || ''),
          edited_at: (row.edited_at as string) || null,
          status: String(row.status || 'sent'),
          reply_to: row.reply_to ? JSON.parse(String(row.reply_to)) : null,
          reactions: row.reactions ? JSON.parse(String(row.reactions)) : null,
          media_group_id: (row.media_group_id as string) || null,
          media_e2ee: row.media_e2ee ? (typeof row.media_e2ee === 'string' ? JSON.parse(row.media_e2ee) : row.media_e2ee) : null,
          media_file_local: (row.media_file_local as string) || null,
        };
      });
    } catch (error) {
      console.error(`❌ Error getting older messages for conv ${conversationId}:`, error);
      return [];
    }
  },

  /**
   * Retrieves messages for a conversation, ordered chronologically.
   */
  getMessages(conversationId: number | string): any[] {
    try {
      const convId = Number(conversationId);
      const { results } = db.execute(
        `SELECT * FROM messages 
         WHERE conversation_id = ? AND is_deleted = 0 
         ORDER BY created_at ASC;`,
        [convId]
      );
      if (!results) return [];

      return (results as any[]).map((row: any) => {
        let senderObj = null;
        if (row.sender) {
          try { senderObj = JSON.parse(String(row.sender)); } catch {}
        }
        if (!senderObj) {
          senderObj = {
            id: row.sender_id ? Number(row.sender_id) : (typeof row.user === 'number' ? row.user : 0),
            display_name: (row.user as string) || 'Unknown',
            email: (row.user as string) || '',
          };
        }
        return {
          local_id: String(row.local_id),
          id: Number(row.id),
          sender: senderObj,
          sender_id: row.sender_id ? Number(row.sender_id) : senderObj.id,
          user: (row.user as string) || '',
          content: (row.content as string) || '',
          message_type: (row.message_type as string) || 'text',
          media_file: (row.media_file as string) || null,
          is_read: row.status === 'read',
          delivered_at: (row.delivered_at as string) || null,
          created_at: String(row.created_at || ''),
          edited_at: (row.edited_at as string) || null,
          status: String(row.status || 'sent'),
          reply_to: row.reply_to ? JSON.parse(String(row.reply_to)) : null,
          reactions: row.reactions ? JSON.parse(String(row.reactions)) : null,
          media_group_id: (row.media_group_id as string) || null,
          media_e2ee: row.media_e2ee ? (typeof row.media_e2ee === 'string' ? JSON.parse(row.media_e2ee) : row.media_e2ee) : null,
          media_file_local: (row.media_file_local as string) || null,
        };
      });
    } catch (error) {
      console.error(`❌ Error getting messages for conv ${conversationId}:`, error);
      return [];
    }
  },

  /**
   * Updates an optimistic message's status and server-assigned ID once sent successfully.
   */
  updateMessageServerId(localId: string, serverId: number, status: 'sent' | 'failed' = 'sent') {
    try {
      db.execute(
        'UPDATE messages SET id = ?, status = ? WHERE local_id = ?;',
        [toPrimitiveNumber(serverId), toPrimitiveString(status), toPrimitiveString(localId)]
      );
    } catch (error) {
      console.error(`❌ Error updating message server ID for local_id ${localId}:`, error);
    }
  },

  /**
   * Updates only the status of a message by its local_id.
   */
  updateMessageStatus(localId: string, status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed') {
    try {
      const idStr = toPrimitiveString(localId);
      const idNum = toPrimitiveNullableNumber(localId) ?? -1;
      db.execute(
        'UPDATE messages SET status = ? WHERE local_id = ? OR id = ?;',
        [toPrimitiveString(status), idStr, idNum]
      );
    } catch (error) {
      console.error(`❌ Error updating message status for ${localId}:`, error);
    }
  },

  /**
   * Soft deletes a message locally (marking it as is_deleted).
   */
  softDeleteMessage(idOrLocalId: string | number) {
    try {
      const idStr = toPrimitiveString(idOrLocalId);
      const idNum = toPrimitiveNullableNumber(idOrLocalId) ?? -1;
      db.execute(
        'UPDATE messages SET is_deleted = 1 WHERE local_id = ? OR id = ?;',
        [idStr, idNum]
      );
    } catch (error) {
      console.error(`❌ Error soft deleting message (${idOrLocalId}):`, error);
    }
  },

  deleteMessage(idOrLocalId: string | number) {
    this.softDeleteMessage(idOrLocalId);
  },

  /**
   * Hard deletes a message locally (used for Delete For Me).
   */
  hardDeleteMessage(idOrLocalId: string | number) {
    try {
      const idStr = toPrimitiveString(idOrLocalId);
      const idNum = toPrimitiveNullableNumber(idOrLocalId) ?? -1;
      db.execute(
        'DELETE FROM messages WHERE local_id = ? OR id = ?;',
        [idStr, idNum]
      );
    } catch (error) {
      console.error(`❌ Error hard deleting message (${idOrLocalId}):`, error);
    }
  },

  /**
   * Updates message text and edited timestamp locally when edited.
   */
  updateMessageText(localId: string, newText: string, editedAt: string) {
    try {
      const idStr = toPrimitiveString(localId);
      const idNum = toPrimitiveNullableNumber(localId) ?? -1;
      db.execute(
        'UPDATE messages SET content = ?, edited_at = ? WHERE local_id = ? OR id = ?;',
        [toPrimitiveString(newText), toPrimitiveString(editedAt), idStr, idNum]
      );
    } catch (error) {
      console.error(`❌ Error updating message text (local_id: ${localId}):`, error);
    }
  },

  /**
   * Finds the local_id of an optimistic message that has not yet been confirmed by the server.
   */
  findSendingMessage(content: string, user: string): string | null {
    try {
      const { results } = db.execute(
        `SELECT local_id FROM messages 
         WHERE status = 'sending' AND content = ? AND user = ? 
         LIMIT 1;`,
        [content, user]
      );
      if (results && results.length > 0) {
        return (results[0].local_id as string) || null;
      }
    } catch (error) {
      console.error('❌ Error finding sending message:', error);
    }
    return null;
  },

  /**
   * Finds the oldest pending sending message for the user regardless of content.
   */
  findFirstSendingMessage(user: string): string | null {
    try {
      const { results } = db.execute(
        `SELECT local_id FROM messages 
         WHERE status = 'sending' AND user = ? 
         ORDER BY created_at ASC 
         LIMIT 1;`,
        [user]
      );
      if (results && results.length > 0) {
        return (results[0].local_id as string) || null;
      }
    } catch (error) {
      console.error('❌ Error finding first sending message:', error);
    }
    return null;
  },

  /**
   * Retrieves a single message by its server or local ID.
   */
  getMessageById(id: number | string): any | null {
    try {
      const { results } = db.execute(
        `SELECT * FROM messages WHERE id = ? OR local_id = ? LIMIT 1;`,
        [id, String(id)]
      );
      if (results && results.length > 0) {
        const row: any = results[0];
        let senderObj = null;
        if (row.sender) {
          try { senderObj = JSON.parse(String(row.sender)); } catch {}
        }
        if (!senderObj) {
          senderObj = {
            id: row.sender_id ? Number(row.sender_id) : (typeof row.user === 'number' ? row.user : 0),
            display_name: (row.user as string) || 'Unknown',
            email: (row.user as string) || '',
          };
        }
        return {
          ...row,
          local_id: String(row.local_id),
          id: Number(row.id),
          sender: senderObj,
          reply_to: row.reply_to ? JSON.parse(String(row.reply_to)) : null,
          reactions: row.reactions ? JSON.parse(String(row.reactions)) : null,
          media_e2ee: row.media_e2ee ? (typeof row.media_e2ee === 'string' ? JSON.parse(row.media_e2ee) : row.media_e2ee) : null,
          media_file_local: (row.media_file_local as string) || null,
        };
      }
    } catch (error) {
      console.error('❌ Error getting message by id:', error);
    }
    return null;
  },

  /**
   * Clears all cached messages for a specific conversation.
   */
  clearConversationMessages(conversationId: number | string) {
    try {
      const convId = Number(conversationId);
      db.execute('DELETE FROM messages WHERE conversation_id = ?;', [convId]);
      console.log(`🧹 Cleared messages for conversation ${convId}`);
    } catch (error) {
      console.error(`❌ Failed to clear messages for conversation ${conversationId}:`, error);
    }
  },

  /**
   * Clears all cached conversations and messages from local SQLite storage.
   */
  clearAll() {
    try {
      db.execute('DELETE FROM messages;');
      db.execute('DELETE FROM conversations;');
      console.log('🧹 Offline Database tables cleared.');
    } catch (error) {
      console.error('❌ Failed to clear offline database:', error);
    }
  },
};

export default localDatabase;
