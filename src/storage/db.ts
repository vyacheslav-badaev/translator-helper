import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import type { TranscriptSegment } from '../types/segment';

export interface SessionData {
  id: string;
  timestamp: number;
  title: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: TranscriptSegment[];
}

interface TranslationDB extends DBSchema {
  sessions: {
    key: string;
    value: SessionData;
    indexes: { 'by-time': number };
  };
}

const DB_NAME = 'translation-history';
const STORE_NAME = 'sessions';

let dbInstance: Awaited<ReturnType<typeof openDB<TranslationDB>>> | null = null;

async function getDB() {
  if (!dbInstance) {
    dbInstance = await openDB<TranslationDB>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by-time', 'timestamp');
        }
      }
    });
  }
  return dbInstance;
}

export async function saveSession(session: SessionData) {
  const db = await getDB();
  await db.put(STORE_NAME, session);

  // Enforce max 20 sessions limit
  const keys = await db.getAllKeysFromIndex(STORE_NAME, 'by-time');
  if (keys.length > 20) {
    // Delete the oldest ones (lowest timestamp)
    const keysToDelete = keys.slice(0, keys.length - 20);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const key of keysToDelete) {
      void tx.store.delete(key);
    }
    await tx.done;
  }
}

export async function getSessions(): Promise<SessionData[]> {
  const db = await getDB();
  const sessions = await db.getAllFromIndex(STORE_NAME, 'by-time');
  // Reverse to show newest first
  return sessions.reverse();
}

export async function deleteSession(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}
