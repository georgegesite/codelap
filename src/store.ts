import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { OpenSession, SessionRecap, SessionSummary } from './activity.ts';
import type { SavedContent, SavedFile } from './repository.ts';

const schema = `
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
`;

const summaryColumns = `
  id, repository_name AS repositoryName, started_at AS startedAt, stopped_at AS stoppedAt,
  files_changed AS filesChanged, lines_added AS linesAdded, lines_removed AS linesRemoved
`;

export class ActivityStore {
  readonly snapshotExclusions: ReadonlySet<string>;
  private readonly db: DatabaseSync;

  constructor(dataDirectory = process.env.CODING_ACTIVITY_DATA_DIR) {
    const defaultDirectory = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'CodingActivity')
      : join(homedir(), '.coding-activity');
    const directory = resolve(dataDirectory || defaultDirectory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = join(realpathSync.native(directory), 'activity.sqlite');
    this.snapshotExclusions = new Set(['', '-journal', '-wal', '-shm'].map((suffix) => database + suffix));
    this.db = new DatabaseSync(database, { timeout: 5000 });
    try {
      this.db.exec(schema);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  getOpenSession(repositoryRoot: string): OpenSession | undefined {
    const row = this.db.prepare(`
      SELECT id, started_at AS startedAt FROM open_sessions WHERE repository_root = ?
    `).get(repositoryRoot) as OpenSession | undefined;
    return row && { ...row };
  }

  startSession(
    repositoryRoot: string,
    writeBaseline: (save: (file: SavedFile) => void) => number,
  ): { session: OpenSession; started: boolean } {
    return this.transaction(() => {
      const open = this.getOpenSession(repositoryRoot);
      if (open) return { session: open, started: false };

      const id = randomUUID();
      const saveFile = this.db.prepare(`
        INSERT INTO baseline_files (session_id, path, kind, diff_mode, content) VALUES (?, ?, ?, ?, ?)
      `);
      const startedAt = writeBaseline((file) => {
        saveFile.run(id, file.path, file.kind, file.diffMode, file.content);
      });

      const session = { id, startedAt };
      this.db.prepare(`
        INSERT INTO open_sessions (repository_root, id, started_at) VALUES (?, ?, ?)
      `).run(repositoryRoot, session.id, session.startedAt);
      return { session, started: true };
    });
  }

  // Baseline contents are read on demand while this store is open.
  getBaselineReader(id: string) {
    const paths = this.db.prepare('SELECT path FROM baseline_files WHERE session_id = ?').all(id) as { path: string }[];
    const baselineFile = this.db.prepare(`
      SELECT kind, diff_mode AS diffMode, content FROM baseline_files WHERE session_id = ? AND path = ?
    `);
    return {
      paths: paths.map(({ path }) => path),
      read(path: string): SavedContent {
        const row = baselineFile.get(id, path) as (Omit<SavedContent, 'content'> & { content: Uint8Array }) | undefined;
        if (!row) throw new Error(`The starting snapshot is missing ${path}.`);
        return { ...row, content: Buffer.from(row.content.buffer, row.content.byteOffset, row.content.byteLength) };
      },
    };
  }

  completeSession(repositoryRoot: string, recap: SessionRecap): boolean {
    return this.transaction(() => {
      if (this.getOpenSession(repositoryRoot)?.id !== recap.id) return false;

      this.db.prepare(`
        INSERT INTO session_recaps (
          id, repository_name, started_at, stopped_at, files_changed, lines_added, lines_removed, files
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(recap.id, recap.repositoryName, recap.startedAt, recap.stoppedAt,
        recap.filesChanged, recap.linesAdded, recap.linesRemoved, JSON.stringify(recap.files));
      this.db.prepare('DELETE FROM open_sessions WHERE repository_root = ?').run(repositoryRoot);
      return true;
    });
  }

  listSessions(): SessionSummary[] {
    return this.db.prepare(`
      SELECT ${summaryColumns} FROM session_recaps ORDER BY started_at DESC, id DESC
    `).all() as SessionSummary[];
  }

  getRecap(id: string): SessionRecap | undefined {
    const row = this.db.prepare(`SELECT ${summaryColumns}, files FROM session_recaps WHERE id = ?`)
      .get(id) as (SessionSummary & { files: string }) | undefined;
    return row ? { ...row, files: JSON.parse(row.files) as SessionRecap['files'] } : undefined;
  }

  deleteRecap(id: string): boolean {
    return Boolean(this.db.prepare('DELETE FROM session_recaps WHERE id = ?').run(id).changes);
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
