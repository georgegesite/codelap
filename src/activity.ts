export type Repository = { root: string; name: string };

export type OpenSession = { id: string; startedAt: number };

export type FileChange = {
  path: string;
  previousPath?: string;
  added: number | null;
  removed: number | null;
};

export type SessionSummary = OpenSession & {
  repositoryName: string;
  stoppedAt: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
};

export type SessionRecap = SessionSummary & { files: FileChange[] };

export function formatRecordedTime(startedAt: number, endedAt: number): string {
  const elapsed = Math.floor(Math.max(0, endedAt - startedAt) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor(elapsed / 60) % 60;
  const seconds = elapsed % 60;
  return [hours && `${hours}h`, (hours || minutes) && `${minutes}m`, `${seconds}s`]
    .filter(Boolean).join(' ');
}
