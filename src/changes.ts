import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { diffArrays } from 'diff';

import type { FileChange } from './activity.ts';
import type { SavedContent, SavedFile } from './repository.ts';

function lineText(file: SavedContent | undefined): string | null {
  if (!file) return '';
  if (file.diffMode === 'binary') return null;
  const { content } = file;
  if (content.length >= 2 && content.length % 2 === 0) {
    if (content.readUInt16LE(0) === 0xfeff) return content.toString('utf16le', 2);
    if (content.readUInt16BE(0) === 0xfeff) {
      return Buffer.from(content.subarray(2)).swap16().toString('utf16le');
    }
  }
  return file.diffMode === 'auto' && content.includes(0) ? null : content.toString('latin1');
}

function orderedUniqueMatches(oldLines: string[], newLines: string[]): number {
  const positions = new Map(newLines.map((line, index) => [line, index]));
  // For unique lines, the common subsequence is the longest increasing series
  // of their positions in the new file. Keep the smallest end for each length.
  const endings: number[] = [];
  for (const line of oldLines) {
    const position = positions.get(line);
    if (position === undefined) continue;
    let lower = 0;
    let upper = endings.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (endings[middle] < position) lower = middle + 1;
      else upper = middle;
    }
    endings[lower] = position;
  }
  return endings.length;
}

function unchangedLines(oldLines: string[], newLines: string[]): number {
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  if (oldSet.size === oldLines.length && newSet.size === newLines.length) {
    return orderedUniqueMatches(oldLines, newLines);
  }

  // Lines absent from the other file already count as changes.
  const oldShared = oldLines.filter((line) => newSet.has(line));
  const newShared = newLines.filter((line) => oldSet.has(line));
  return diffArrays(oldShared, newShared).reduce((total, part) => (
    part.added || part.removed ? total : total + part.count
  ), 0);
}

function changedFile(path: string, before?: SavedContent, after?: SavedContent): FileChange {
  const oldText = lineText(before);
  const newText = lineText(after);
  if (oldText === null || newText === null) return { path, added: null, removed: null };

  const oldLines = oldText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const newLines = newText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const common = unchangedLines(oldLines, newLines);
  return { path, added: newLines.length - common, removed: oldLines.length - common };
}

type Candidates = Map<string, FileChange[]>;

function addCandidate(candidates: Candidates, file: SavedContent, change: FileChange): void {
  const key = `${file.kind}:${createHash('sha256').update(file.content).digest('hex')}`;
  const group = candidates.get(key);
  if (group) group.push(change);
  else candidates.set(key, [change]);
}

function uniquePaths(files: Iterable<FileChange>, keyFor: (path: string) => string): Map<string, FileChange | undefined> {
  const names = new Map<string, FileChange | undefined>();
  for (const file of files) {
    const name = keyFor(file.path);
    names.set(name, names.has(name) ? undefined : file);
  }
  return names;
}

function matchRenames(arrivals: FileChange[], departures: FileChange[], changes: FileChange[]): void {
  const unmatchedArrivals = new Set(arrivals);
  const unmatchedDepartures = new Set(departures);
  const match = (arrival: FileChange, departure: FileChange) => {
    changes.push({ path: arrival.path, previousPath: departure.path, added: 0, removed: 0 });
    unmatchedArrivals.delete(arrival);
    unmatchedDepartures.delete(departure);
  };

  const matchBy = (keyFor: (path: string) => string) => {
    const oldNames = uniquePaths(unmatchedDepartures, keyFor);
    for (const [name, arrival] of uniquePaths(unmatchedArrivals, keyFor)) {
      const departure = oldNames.get(name);
      if (arrival && departure) match(arrival, departure);
    }
  };
  if (arrivals.length > 1 || departures.length > 1) {
    matchBy((path) => path.toLowerCase());
    matchBy(posix.basename);
  }

  if (unmatchedArrivals.size === 1 && unmatchedDepartures.size === 1) {
    const [arrival] = unmatchedArrivals;
    const [departure] = unmatchedDepartures;
    match(arrival, departure);
  }
  for (const arrival of unmatchedArrivals) changes.push(arrival);
  for (const departure of unmatchedDepartures) changes.push(departure);
}

export function compareSnapshots(
  baselinePaths: Iterable<string>,
  readBaseline: (path: string) => SavedContent,
  endingFiles: Iterable<SavedFile>,
): FileChange[] {
  const missing = new Set(baselinePaths);
  const changes: FileChange[] = [];
  const added: Candidates = new Map();
  const removed: Candidates = new Map();

  for (const file of endingFiles) {
    if (!missing.delete(file.path)) {
      addCandidate(added, file, changedFile(file.path, undefined, file));
      continue;
    }
    const before = readBaseline(file.path);
    if (before.kind !== file.kind || !before.content.equals(file.content)) {
      changes.push(changedFile(file.path, before, file));
    }
  }
  for (const path of missing) {
    const before = readBaseline(path);
    addCandidate(removed, before, changedFile(path, before));
  }

  for (const [key, arrivals] of added) {
    const departures = removed.get(key);
    if (departures) {
      matchRenames(arrivals, departures, changes);
      removed.delete(key);
    } else {
      for (const arrival of arrivals) changes.push(arrival);
    }
  }
  for (const departures of removed.values()) {
    for (const departure of departures) changes.push(departure);
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
