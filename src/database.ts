import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openActivityDatabase(dataDirectory = process.env.CODING_ACTIVITY_DATA_DIR) {
  const defaultDirectory = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'CodingActivity')
    : join(homedir(), '.coding-activity');
  const directory = resolve(dataDirectory || defaultDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = join(realpathSync.native(directory), 'activity.sqlite');
  const databaseFiles = new Set(['', '-journal', '-wal', '-shm'].map((suffix) => database + suffix));
  const db = new DatabaseSync(database, { timeout: 5000 });

  try {
    db.exec(`
      PRAGMA secure_delete = ON;

      CREATE TABLE IF NOT EXISTS open_sessions (
        repository_root TEXT PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        started_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS baseline_files (
        session_id TEXT NOT NULL REFERENCES open_sessions (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
        diff_mode TEXT NOT NULL CHECK (diff_mode IN ('auto', 'text', 'binary')),
        content BLOB NOT NULL,
        PRIMARY KEY (session_id, path)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS session_recaps (
        id TEXT PRIMARY KEY,
        repository_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        stopped_at INTEGER NOT NULL,
        files_changed INTEGER NOT NULL,
        lines_added INTEGER NOT NULL,
        lines_removed INTEGER NOT NULL,
        files TEXT NOT NULL
      ) STRICT;
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  return { db, databaseFiles };
}
