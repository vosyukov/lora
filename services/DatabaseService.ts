import * as SQLite from 'expo-sqlite';
import type { Message, MessageStatus, MessageType, LocationData } from '../types';

const DATABASE_NAME = 'meshtastic.db';
const SCHEMA_VERSION = 1;

// Database row types
interface MessageRow {
  id: string;
  packet_id: number | null;
  from_node: number;
  to_node: number;
  text: string;
  timestamp: number;
  is_outgoing: number;
  channel: number | null;
  status: string | null;
  type: string | null;
  location_lat: number | null;
  location_lon: number | null;
  location_alt: number | null;
  location_time: number | null;
}

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initDatabase();
    return this.initPromise;
  }

  private async initDatabase(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // Enable WAL mode for better performance
    await this.db.execAsync('PRAGMA journal_mode = WAL;');

    // Check current schema version
    const versionResult = await this.db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version;'
    );
    const currentVersion = versionResult?.user_version ?? 0;

    if (currentVersion < SCHEMA_VERSION) {
      await this.migrate(currentVersion);
    }
  }

  private async migrate(fromVersion: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Version 0 -> 1: Initial schema
    if (fromVersion < 1) {
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          packet_id INTEGER,
          from_node INTEGER NOT NULL,
          to_node INTEGER NOT NULL,
          text TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          is_outgoing INTEGER NOT NULL DEFAULT 0,
          channel INTEGER,
          status TEXT,
          type TEXT DEFAULT 'text',
          location_lat REAL,
          location_lon REAL,
          location_alt REAL,
          location_time INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_from_to ON messages(from_node, to_node);
        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
        CREATE INDEX IF NOT EXISTS idx_messages_packet_id ON messages(packet_id);
      `);
    }

    // Update schema version
    await this.db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  // Messages
  async addMessage(message: Message): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check for duplicates
    const existing = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages
       WHERE from_node = ? AND to_node = ? AND text = ?
       AND ABS(timestamp - ?) < 5000`,
      [message.from, message.to, message.text, message.timestamp]
    );

    if (existing && existing.count > 0) {
      return; // Duplicate, skip
    }

    await this.db.runAsync(
      `INSERT INTO messages (
        id, packet_id, from_node, to_node, text, timestamp,
        is_outgoing, channel, status, type,
        location_lat, location_lon, location_alt, location_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.packetId ?? null,
        message.from,
        message.to,
        message.text,
        message.timestamp,
        message.isOutgoing ? 1 : 0,
        message.channel ?? null,
        message.status ?? null,
        message.type ?? 'text',
        message.location?.latitude ?? null,
        message.location?.longitude ?? null,
        message.location?.altitude ?? null,
        message.location?.time ?? null,
      ]
    );
  }

  async getMessages(limit: number = 500): Promise<Message[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.getAllAsync<MessageRow>(
      'SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );

    return rows.map(this.rowToMessage).reverse();
  }

  async getMessagesByChat(nodeNum: number, myNodeNum: number, limit: number = 100): Promise<Message[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.getAllAsync<MessageRow>(
      `SELECT * FROM messages
       WHERE (from_node = ? AND to_node = ?) OR (from_node = ? AND to_node = ?)
       ORDER BY timestamp DESC LIMIT ?`,
      [nodeNum, myNodeNum, myNodeNum, nodeNum, limit]
    );

    return rows.map(this.rowToMessage).reverse();
  }

  async getMessagesByChannel(channel: number, limit: number = 100): Promise<Message[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.getAllAsync<MessageRow>(
      'SELECT * FROM messages WHERE channel = ? ORDER BY timestamp DESC LIMIT ?',
      [channel, limit]
    );

    return rows.map(this.rowToMessage).reverse();
  }

  async updateMessageStatus(packetId: number, status: MessageStatus): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE messages SET status = ? WHERE packet_id = ?',
      [status, packetId]
    );
  }

  async deleteOldMessages(keepCount: number): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `DELETE FROM messages WHERE id NOT IN (
        SELECT id FROM messages ORDER BY timestamp DESC LIMIT ?
      )`,
      [keepCount]
    );
  }

  async getMessageCount(): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM messages'
    );
    return result?.count ?? 0;
  }

  // Bulk import for migration
  async importMessages(messages: Message[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Use transaction for bulk insert
    await this.db.withTransactionAsync(async () => {
      for (const message of messages) {
        await this.db!.runAsync(
          `INSERT OR IGNORE INTO messages (
            id, packet_id, from_node, to_node, text, timestamp,
            is_outgoing, channel, status, type,
            location_lat, location_lon, location_alt, location_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id,
            message.packetId ?? null,
            message.from,
            message.to,
            message.text,
            message.timestamp,
            message.isOutgoing ? 1 : 0,
            message.channel ?? null,
            message.status ?? null,
            message.type ?? 'text',
            message.location?.latitude ?? null,
            message.location?.longitude ?? null,
            message.location?.altitude ?? null,
            message.location?.time ?? null,
          ]
        );
      }
    });
  }

  private rowToMessage(row: MessageRow): Message {
    const message: Message = {
      id: row.id,
      from: row.from_node,
      to: row.to_node,
      text: row.text,
      timestamp: row.timestamp,
      isOutgoing: row.is_outgoing === 1,
    };

    if (row.packet_id !== null) {
      message.packetId = row.packet_id;
    }
    if (row.channel !== null) {
      message.channel = row.channel;
    }
    if (row.status !== null) {
      message.status = row.status as MessageStatus;
    }
    if (row.type !== null) {
      message.type = row.type as MessageType;
    }
    if (row.location_lat !== null && row.location_lon !== null) {
      const location: LocationData = {
        latitude: row.location_lat,
        longitude: row.location_lon,
      };
      if (row.location_alt !== null) {
        location.altitude = row.location_alt;
      }
      if (row.location_time !== null) {
        location.time = row.location_time;
      }
      message.location = location;
    }

    return message;
  }
}

export const databaseService = new DatabaseService();
