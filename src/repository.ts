import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Repository } from './activity.ts';

type DiffMode = 'auto' | 'text' | 'binary';
export type SavedContent = { kind: 'file' | 'link'; diffMode: DiffMode; content: Buffer };
export type SavedFile = SavedContent & { path: string };

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
}

export function currentRepository(cwd: string): Repository {
  let path: string;
  try {
    path = git(cwd, ['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Git is required. Install Git and put it on PATH.');
    }
    throw new Error('Run this command inside a Git working tree.');
  }
  const root = realpathSync.native(path);
  return { root, name: basename(root) || root };
}

export function* savedFiles(repository: Repository, excluded: ReadonlySet<string>): Iterable<SavedFile> {
  const listed = git(repository.root, [
    'ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z',
  ]);
  const entries = new Map<string, { absolute: string; kind: SavedContent['kind'] }>();
  for (const listedPath of new Set(listed.split('\0'))) {
    if (!listedPath) continue;
    const absolute = resolve(repository.root, listedPath);
    const fromRoot = relative(repository.root, absolute);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Git returned a path outside the working tree: ${listedPath}`);
    }
    if (excluded.has(absolute)) continue;

    try {
      const parent = dirname(absolute);
      const canonicalParent = realpathSync.native(parent);
      if (relative(parent, canonicalParent)) continue;
      const entry = lstatSync(absolute);
      if (!entry.isSymbolicLink() && !entry.isFile()) continue;

      // The index can keep the previous spelling of a case-only rename on Windows.
      const canonical = entry.isSymbolicLink()
        ? join(canonicalParent, linkName(absolute, canonicalParent))
        : realpathSync.native(absolute);
      if (relative(canonicalParent, dirname(canonical)) || excluded.has(canonical)) continue;

      const path = relative(repository.root, canonical).split(sep).join('/');
      entries.set(path, { absolute: canonical, kind: entry.isSymbolicLink() ? 'link' : 'file' });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const diffModes = readDiffModes(repository.root, [...entries.keys()]);
  for (const [path, entry] of entries) {
    try {
      // A working-tree path can be replaced between enumeration and reading.
      const expected = entry.kind === 'link' ? dirname(entry.absolute) : entry.absolute;
      if (relative(expected, realpathSync.native(expected))) continue;
      const content = entry.kind === 'link'
        ? readlinkSync(entry.absolute, { encoding: 'buffer' })
        : readFileSync(entry.absolute);
      yield { path, kind: entry.kind, content, diffMode: diffModes.get(path) ?? 'auto' };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function customDiffModes(root: string): Map<string, DiffMode> {
  const modes = new Map<string, DiffMode>();
  try {
    const config = git(root, ['config', '--type=bool', '--null', '--get-regexp', '^diff\\..+\\.binary$']);
    for (const entry of config.split('\0')) {
      const match = /^diff\.(.+)\.binary\n(true|false)$/.exec(entry);
      if (match) modes.set(match[1], match[2] === 'true' ? 'binary' : 'text');
    }
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
  }
  return modes;
}

function readDiffModes(root: string, paths: string[]): Map<string, DiffMode> {
  const modes = new Map<string, DiffMode>();
  if (paths.length === 0) return modes;

  const fields = git(root, ['check-attr', '-z', '--stdin', 'diff'], paths.join('\0') + '\0').split('\0');
  let drivers: Map<string, DiffMode> | undefined;
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index];
    const mode = fields[index + 2];
    if (mode === 'unset') modes.set(path, 'binary');
    else if (mode === 'set') modes.set(path, 'text');
    else if (mode !== 'unspecified') {
      drivers ??= customDiffModes(root);
      const driver = drivers.get(mode);
      if (driver) modes.set(path, driver);
    }
  }
  return modes;
}

function linkName(absolute: string, parent: string): string {
  const name = basename(absolute);
  if (process.platform !== 'win32') return name;
  const entries = readdirSync(parent);
  return entries.find((entry) => entry === name)
    ?? entries.find((entry) => entry.toLowerCase() === name.toLowerCase())
    ?? name;
}
