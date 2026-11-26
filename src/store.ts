import type { DatabaseSync } from 'node:sqlite';

import type { SessionRecap, SessionSummary } from './activity.ts';
import { openActivityDatabase } from './database.ts';

const summaryColumns = `
  id, repository_name AS repositoryName, started_at AS startedAt, stopped_at AS stoppedAt,
  files_changed AS filesChanged, lines_added AS linesAdded, lines_removed AS linesRemoved
`;

export class ActivityStore {
  private readonly db: DatabaseSync;

  constructor(dataDirectory?: string) {
    this.db = openActivityDatabase(dataDirectory).db;
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
}
