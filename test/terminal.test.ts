import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

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

test('the timer can still stop if the system clock moved backward', (t) => {
  const { repo, env, run } = fixture(t);
  const requestedAt = Date.now();
  run('start');

  const earlierClock = `data:text/javascript,${encodeURIComponent(`Date.now = () => ${requestedAt};`)}`;
  const deferred = execFileSync(process.execPath, ['--import', earlierClock, cli, 'stop'], {
    cwd: repo, env, encoding: 'utf8',
  });
  assert.match(deferred, /Stopped checkout-api\. Elapsed: 0s\./);
  assert.match(run('status'), /No open session/);
});

test('a delayed comparison leaves a replacement session open', async (t) => {
  const { repo, data, env, run } = fixture(t);
  const file = join(repo, 'code.txt');
  const ready = join(data, 'comparison-started');
  const resume = join(data, 'resume-comparison');
  writeFileSync(file, 'original\n');
  run('start');

  const pauseFileRead = `data:text/javascript,${encodeURIComponent(`
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (path === ${JSON.stringify(file)}) {
        fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
        const wakeUp = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 15_000;
        while (!fs.existsSync(${JSON.stringify(resume)})) {
          if (Date.now() > deadline) throw new Error('Timed out waiting for the comparison test.');
          Atomics.wait(wakeUp, 0, 0, 20);
        }
      }
      return read(path, ...args);
    };
    syncBuiltinESMExports();
  `)}`;
  const child = spawn(process.execPath, ['--import', pauseFileRead, cli, 'stop'], {
    cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const closed = once(child, 'close');
  try {
    const deadline = Date.now() + 7000;
    while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline) await wait(20);
    assert.ok(existsSync(ready));
    run('stop');
    run('start');
  } finally {
    writeFileSync(resume, 'resume');
    await closed;
  }
  assert.match(output, /No open session/);
  assert.match(run('status'), /^Elapsed: \d+s$/);
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
