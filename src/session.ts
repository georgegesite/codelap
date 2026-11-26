import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { FileChange, OpenSession, Repository, SessionRecap } from './activity.ts';
import { compareSnapshots } from './changes.ts';
import { openActivityDatabase } from './database.ts';
import { currentRepository, savedFiles } from './repository.ts';
import type { SavedContent } from './repository.ts';

type SessionOptions = {
  dataDirectory?: string;
  now?: () => number;
  capture?: typeof savedFiles;
};

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function getOpenSession(db: DatabaseSync, repositoryRoot: string): OpenSession | undefined {
  const row = db.prepare(`
    SELECT id, started_at AS startedAt FROM open_sessions WHERE repository_root = ?
  `).get(repositoryRoot) as OpenSession | undefined;
  return row && { ...row };
}

export class CodingSessions {
  private readonly dataDirectory: string | undefined;
  private readonly now: () => number;
  private readonly capture: typeof savedFiles;

  constructor({ dataDirectory, now = Date.now, capture = savedFiles }: SessionOptions = {}) {
    this.dataDirectory = dataDirectory;
    this.now = now;
    this.capture = capture;
  }

  start(cwd: string) {
    return this.withRepository(cwd, (repository, { db, databaseFiles }) => transaction(db, () => {
      const repositoryName = repository.name;
      const open = getOpenSession(db, repository.root);
      if (open) return { repositoryName, session: open, started: false };

      const id = randomUUID();
      const saveFile = db.prepare(`
        INSERT INTO baseline_files (session_id, path, kind, diff_mode, content) VALUES (?, ?, ?, ?, ?)
      `);
      for (const file of this.capture(repository, databaseFiles)) {
        saveFile.run(id, file.path, file.kind, file.diffMode, file.content);
      }

      const session = { id, startedAt: this.now() };
      db.prepare(`
        INSERT INTO open_sessions (repository_root, id, started_at) VALUES (?, ?, ?)
      `).run(repository.root, session.id, session.startedAt);
      return { repositoryName, session, started: true };
    }));
  }

  status(cwd: string) {
    const checkedAt = this.now();
    return this.withRepository(cwd, (repository, { db }) => {
      const session = getOpenSession(db, repository.root);
      const recording = session && { startedAt: session.startedAt, checkedAt };
      return { repositoryName: repository.name, recording };
    });
  }

  stop(cwd: string): { repositoryName: string; recap?: SessionRecap } {
    const stoppedAt = this.now();
    return this.withRepository(cwd, (repository, { db, databaseFiles }) => {
      const result = { repositoryName: repository.name };
      const open = getOpenSession(db, repository.root);
      if (!open) return result;

      // Compare without the write lock, then verify the same session can still be completed.
      let files: FileChange[];
      try {
        files = this.sessionChanges(db, open.id, repository, databaseFiles);
      } catch (error) {
        if (getOpenSession(db, repository.root)?.id !== open.id) return result;
        throw error;
      }

      return transaction(db, () => {
        if (getOpenSession(db, repository.root)?.id !== open.id) return result;
        const recap: SessionRecap = {
          ...open,
          repositoryName: repository.name,
          stoppedAt: Math.max(open.startedAt, stoppedAt),
          filesChanged: files.length,
          linesAdded: files.reduce((total, file) => total + (file.added ?? 0), 0),
          linesRemoved: files.reduce((total, file) => total + (file.removed ?? 0), 0),
          files,
        };
        db.prepare(`
          INSERT INTO session_recaps (
            id, repository_name, started_at, stopped_at, files_changed, lines_added, lines_removed, files
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(recap.id, recap.repositoryName, recap.startedAt, recap.stoppedAt,
          recap.filesChanged, recap.linesAdded, recap.linesRemoved, JSON.stringify(recap.files));
        db.prepare('DELETE FROM open_sessions WHERE repository_root = ?').run(repository.root);
        return { ...result, recap };
      });
    });
  }

  private sessionChanges(
    db: DatabaseSync,
    id: string,
    repository: Repository,
    databaseFiles: ReadonlySet<string>,
  ): FileChange[] {
    const paths = db.prepare('SELECT path FROM baseline_files WHERE session_id = ?').all(id) as { path: string }[];
    const baselineFile = db.prepare(`
      SELECT kind, diff_mode AS diffMode, content FROM baseline_files WHERE session_id = ? AND path = ?
    `);
    return compareSnapshots(paths.map(({ path }) => path), (path) => {
      const row = baselineFile.get(id, path) as (Omit<SavedContent, 'content'> & { content: Uint8Array }) | undefined;
      if (!row) throw new Error(`The starting snapshot is missing ${path}.`);
      return { ...row, content: Buffer.from(row.content.buffer, row.content.byteOffset, row.content.byteLength) };
    }, this.capture(repository, databaseFiles));
  }

  private withRepository<T>(
    cwd: string,
    work: (repository: Repository, database: ReturnType<typeof openActivityDatabase>) => T,
  ): T {
    const repository = currentRepository(cwd);
    const database = openActivityDatabase(this.dataDirectory);
    try {
      return work(repository, database);
    } finally {
      database.db.close();
    }
  }
}
