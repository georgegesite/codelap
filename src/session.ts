import type { FileChange, Repository, SessionRecap } from './activity.ts';
import { compareSnapshots } from './changes.ts';
import { currentRepository, savedFiles } from './repository.ts';
import { ActivityStore } from './store.ts';

type SessionOptions = {
  dataDirectory?: string;
  now?: () => number;
  capture?: typeof savedFiles;
};

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
    return this.withRepository(cwd, (repository, store, capture) => {
      const started = store.startSession(repository.root, (save) => {
        for (const file of capture()) save(file);
        return this.now();
      });
      return { repositoryName: repository.name, ...started };
    });
  }

  status(cwd: string) {
    const checkedAt = this.now();
    return this.withRepository(cwd, (repository, store) => {
      const session = store.getOpenSession(repository.root);
      const recording = session && { startedAt: session.startedAt, checkedAt };
      return { repositoryName: repository.name, recording };
    });
  }

  stop(cwd: string): { repositoryName: string; recap?: SessionRecap } {
    const stoppedAt = this.now();
    return this.withRepository(cwd, (repository, store, capture) => {
      const result = { repositoryName: repository.name };
      const open = store.getOpenSession(repository.root);
      if (!open) return result;

      // Compare without the write lock, then verify the same session can still be completed.
      let files: FileChange[];
      try {
        const baseline = store.getBaselineReader(open.id);
        files = compareSnapshots(baseline.paths, baseline.read, capture());
      } catch (error) {
        if (store.getOpenSession(repository.root)?.id !== open.id) return result;
        throw error;
      }

      const recap: SessionRecap = {
        ...open,
        repositoryName: repository.name,
        stoppedAt: Math.max(open.startedAt, stoppedAt),
        filesChanged: files.length,
        linesAdded: files.reduce((total, file) => total + (file.added ?? 0), 0),
        linesRemoved: files.reduce((total, file) => total + (file.removed ?? 0), 0),
        files,
      };
      return store.completeSession(repository.root, recap) ? { ...result, recap } : result;
    });
  }

  private withRepository<T>(
    cwd: string,
    work: (repository: Repository, store: ActivityStore, capture: () => ReturnType<typeof savedFiles>) => T,
  ): T {
    const repository = currentRepository(cwd);
    const store = new ActivityStore(this.dataDirectory);
    try {
      return work(repository, store, () => this.capture(repository, store.snapshotExclusions));
    } finally {
      store.close();
    }
  }
}
