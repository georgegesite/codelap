import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli, fixture } from './fixture.ts';

test('an open session survives separate terminal invocations and keeps its original start', (t) => {
  const { repo, run } = fixture(t);
  const folder = join(repo, 'src');
  mkdirSync(folder);

  const started = run('start', folder);
  const timestamp = started.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0];
  assert.match(started, /Started checkout-api/);
  assert.ok(timestamp);
  assert.match(run('status'), /^Elapsed: \d+s$/);
  assert.ok(run('start').includes(timestamp));
  assert.match(run('stop', folder), /Stopped checkout-api/);
  assert.match(run('status'), /No open session/);
});

test('stop counts only the saved changes after start, including a commit and an untracked file', (t) => {
  const { repo, git, run } = fixture(t);
  const file = join(repo, 'code.txt');
  const reverted = join(repo, 'reverted.txt');
  writeFileSync(join(repo, '.gitignore'), '*.log\n');
  writeFileSync(file, 'original\nreplace me\n');
  writeFileSync(reverted, 'original\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Seed');

  writeFileSync(file, 'original\nreplace me\nprevious work\n');
  run('start');
  writeFileSync(file, 'original\nupdated\nprevious work\nnew work\n');
  git('add', 'code.txt');
  git('commit', '--quiet', '-m', 'Coding session');
  writeFileSync(reverted, 'temporary edit\n');
  writeFileSync(reverted, 'original\n');
  writeFileSync(join(repo, 'new file.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'ignored.log'), 'ignored\n');

  assert.match(run('stop'), /2 files changed · \+4 lines · −1 line/);
});

test('switching branches leaves the original comparison baseline in place', (t) => {
  const { repo, git, run } = fixture(t);
  const file = join(repo, 'code.txt');
  writeFileSync(file, 'shared line\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Seed');
  git('switch', '--quiet', '-c', 'feature');
  writeFileSync(file, 'shared line\nfeature line\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Feature');
  git('switch', '--quiet', 'main');

  run('start');
  git('switch', '--quiet', 'feature');
  assert.match(run('stop'), /1 file changed · \+1 line · −0 lines/);
});

test('changing just the case of a tracked filename counts as a pure rename', (t) => {
  const { repo, git, run } = fixture(t);
  writeFileSync(join(repo, 'original.txt'), 'line one\n');
  git('add', 'original.txt');

  run('start');
  renameSync(join(repo, 'original.txt'), join(repo, 'ORIGINAL.txt'));
  assert.match(run('stop'), /1 file changed · \+0 lines · −0 lines/);
});

test('a directory move pairs identical files by their filenames', (t) => {
  const { repo, git, run } = fixture(t);
  mkdirSync(join(repo, 'before'));
  writeFileSync(join(repo, 'before/first.txt'), 'same content\n');
  writeFileSync(join(repo, 'before/second.txt'), 'same content\n');
  git('add', 'before');

  run('start');
  git('mv', 'before', 'after');
  assert.match(run('stop'), /2 files changed · \+0 lines · −0 lines/);
});

test('case-only renames remain identifiable when the files have identical contents', (t) => {
  const { repo, git, run } = fixture(t);
  for (const name of ['first.txt', 'second.txt']) writeFileSync(join(repo, name), 'same content\n');
  git('add', 'first.txt', 'second.txt');
  run('start');
  for (const name of ['first.txt', 'second.txt']) renameSync(join(repo, name), join(repo, name.toUpperCase()));
  assert.match(run('stop'), /2 files changed · \+0 lines · −0 lines/);
});

test('a large generated rewrite saves complete line counts within the command timeout', (t) => {
  const { repo, env, run } = fixture(t);
  const file = join(repo, 'generated.csv');
  const rows = (prefix: string) => 'row,value\n' + Array.from({ length: 10_000 }, (_, row) => `${row},${prefix}\n`).join('');
  writeFileSync(file, rows('old'));
  run('start');
  writeFileSync(file, rows('new'));

  const result = execFileSync(process.execPath, [cli, 'stop'], { cwd: repo, env, encoding: 'utf8', timeout: 10_000 });
  assert.match(result, /1 file changed · \+10000 lines · −10000 lines/);
});

test('resorting a large file with unique lines saves the exact line counts', (t) => {
  const { repo, env, run } = fixture(t);
  const file = join(repo, 'generated.csv');
  const rows = Array.from({ length: 10_000 }, (_, row) => `${row},value\n`);
  writeFileSync(file, rows.join(''));
  run('start');
  writeFileSync(file, rows.reverse().join(''));

  const result = execFileSync(process.execPath, [cli, 'stop'], { cwd: repo, env, encoding: 'utf8', timeout: 10_000 });
  assert.match(result, /1 file changed · \+9999 lines · −9999 lines/);
});
