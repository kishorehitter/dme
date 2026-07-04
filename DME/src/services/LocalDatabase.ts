import { open } from 'react-native-nitro-sqlite';
import { Conversation, Message } from '../types';

const DB_NAME = 'dme_offline.sqlite';
const db = open({ name: DB_NAME });

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

      // Create Messages Table
      db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          local_id TEXT PRIMARY KEY,
          id INTEGER UNIQUE,
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
          FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
      `);

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
      const lastMsgStatus = conv.last_message?.status || 
        (conv.last_message?.is_read ? 'read' : (conv.last_message?.delivered_at ? 'delivered' : 'sent'));

      db.execute(
        `INSERT OR REPLACE INTO conversations (
          id, name, is_group, profile_picture, last_message_content, last_message_timestamp, unread_count, updated_at, other_user, last_message_status, last_message_sender_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          conv.id,
          conv.name || null,
          conv.is_group ? 1 : 0,
          conv.profile_picture || null,
          conv.last_message?.content || null,
          conv.last_message?.created_at || null,
          conv.unread_count || 0,
          conv.updated_at || null,
          conv.other_user ? JSON.stringify(conv.other_user) : null,
          lastMsgStatus || 'sent',
          conv.last_message?.sender_id || null,
        ]
      );
    } catch (error) {
      console.error(`❌ Error saving conversation ${conv.id}:`, error);
    }
  },

  /**
   * Bulk saves/updates conversations.
   */
  saveConversations(convs: Conversation[]) {
    try {
      // Use transaction for bulk inserts
      db.transaction((tx) => {
        for (const conv of convs) {
          const lastMsgStatus = conv.last_message?.status || 
            (conv.last_message?.is_read ? 'read' : (conv.last_message?.delivered_at ? 'delivered' : 'sent'));

          tx.execute(
            `INSERT OR REPLACE INTO conversations (
              id, name, is_group, profile_picture, last_message_content, last_message_timestamp, unread_count, updated_at, other_user, last_message_status, last_message_sender_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              conv.id,
              conv.name || null,
              conv.is_group ? 1 : 0,
              conv.profile_picture || null,
              conv.last_message?.content || null,
              conv.last_message?.created_at || null,
              conv.unread_count || 0,
              conv.updated_at || null,
              conv.other_user ? JSON.stringify(conv.other_user) : null,
              lastMsgStatus || 'sent',
              conv.last_message?.sender_id || null,
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
   */
  getConversations(): Conversation[] {
    try {
      const { results } = db.execute(
        'SELECT * FROM conversations ORDER BY updated_at DESC;'
      );
      if (!results) return [];

      return results.map((row) => ({
        id: row.id,
        name: row.name,
        is_group: row.is_group === 1,
        profile_picture: row.profile_picture,
        other_user: row.other_user ? JSON.parse(row.other_user) : null,
        last_message: row.last_message_content
          ? {
              id: 0, // Mocked for UI
              content: row.last_message_content,
              message_type: 'text',
              created_at: row.last_message_timestamp,
              sender_id: row.last_message_sender_id,
              status: row.last_message_status,
            }
          : null,
        unread_count: row.unread_count,
        updated_at: row.updated_at,
      }));
    } catch (error) {
      console.error('❌ Error getting conversations:', error);
      return [];
    }
  },

  // ─── MESSAGES QUERY APIs ────────────────────────────────────────────────────

  /**
   * Saves an optimistically sent message or a newly received message.
   */
  saveMessage(msg: any, localId: string, status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' = 'sent') {
    try {
      db.execute(
        `INSERT OR REPLACE INTO messages (
          local_id, id, conversation_id, user, content, message_type, media_file, created_at, reactions, reply_to, status, is_deleted, edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          localId,
          msg.id || null, // Can be NULL for optimistic messages
          msg.conversation || null,
          msg.sender?.display_name || msg.sender?.email || msg.user || null,
          msg.content || null,
          msg.message_type || 'text',
          msg.media_file || null,
          msg.created_at || null,
          msg.reactions ? JSON.stringify(msg.reactions) : null,
          msg.reply_to ? JSON.stringify(msg.reply_to) : null,
          status,
          0, // is_deleted = 0
          msg.edited_at || null,
        ]
      );
    } catch (error) {
      console.error(`❌ Error saving message (local_id: ${localId}):`, error);
    }
  },

  /**
   * Bulk saves/caches messages from the server for a specific conversation.
   */
  saveMessages(msgs: any[], conversationId: number) {
    try {
      db.transaction((tx) => {
        for (const msg of msgs) {
          // For server-synced messages, local_id can just match the server id.
          const localId = msg.local_id || msg.id.toString();
          tx.execute(
            `INSERT OR REPLACE INTO messages (
              local_id, id, conversation_id, user, content, message_type, media_file, created_at, reactions, reply_to, status, is_deleted, edited_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              localId,
              msg.id,
              conversationId,
              msg.sender?.display_name || msg.sender?.email || msg.user || null,
              msg.content || null,
              msg.message_type || 'text',
              msg.media_file || null,
              msg.created_at || null,
              msg.reactions ? JSON.stringify(msg.reactions) : null,
              msg.reply_to ? JSON.stringify(msg.reply_to) : null,
              msg.is_read ? 'read' : 'sent',
              msg.is_deleted ? 1 : 0,
              msg.edited_at || null,
            ]
          );
        }
      });
    } catch (error) {
      console.error(`❌ Error bulk saving messages for conv ${conversationId}:`, error);
    }
  },

  /**
   * Retrieves messages for a conversation, ordered chronologically.
   */
  getMessages(conversationId: number): any[] {
    try {
      const { results } = db.execute(
        `SELECT * FROM messages 
         WHERE conversation_id = ? AND is_deleted = 0 
         ORDER BY created_at ASC;`,
        [conversationId]
      );
      if (!results) return [];

      return results.map((row) => ({
        local_id: row.local_id,
        id: row.id,
        sender: {
          id: 0, // Not strictly required for bubble rendering if we only need display_name
          display_name: row.user,
          email: row.user,
        },
        user: row.user,
        content: row.content,
        message_type: row.message_type,
        media_file: row.media_file,
        is_read: row.status === 'read',
        delivered_at: null,
        created_at: row.created_at,
        edited_at: row.edited_at,
        status: row.status,
        reply_to: row.reply_to ? JSON.parse(row.reply_to) : null,
        reactions: row.reactions ? JSON.parse(row.reactions) : null,
      }));
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
        [serverId, status, localId]
      );
    } catch (error) {
      console.error(`❌ Error updating message server ID for local_id ${localId}:`, error);
    }
  },

  /**
   * Soft deletes a message locally (marking it as is_deleted).
   */
  softDeleteMessage(localId: string) {
    try {
      db.execute(
        'UPDATE messages SET is_deleted = 1 WHERE local_id = ?;',
        [localId]
      );
    } catch (error) {
      console.error(`❌ Error soft deleting message (local_id: ${localId}):`, error);
    }
  },

  /**
   * Updates message text and edited timestamp locally when edited.
   */
  updateMessageText(localId: string, newText: string, editedAt: string) {
    try {
      db.execute(
        'UPDATE messages SET content = ?, edited_at = ? WHERE local_id = ?;',
        [newText || null, editedAt || null, localId]
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
        return results[0].local_id;
      }
    } catch (error) {
      console.error('❌ Error finding sending message:', error);
    }
    return null;
  },
};

export default localDatabase;
