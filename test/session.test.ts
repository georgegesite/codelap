import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { savedFiles } from '../src/repository.ts';
import { CodingSessions } from '../src/session.ts';
import { ActivityStore } from '../src/store.ts';
import { fixture } from './fixture.ts';

test('a failed stop leaves the original Coding Session available for retry', (t) => {
  const { repo, data } = fixture(t);
  const file = join(repo, 'code.txt');
  writeFileSync(file, 'original\n');
  const sessions = new CodingSessions({ dataDirectory: data });
  const { session } = sessions.start(repo);
  writeFileSync(file, 'original\nnew work\n');

  const failure = new Error('Could not finish reading the Session Repository.');
  const interrupted = new CodingSessions({
    dataDirectory: data,
    *capture(repository, excluded) {
      yield* savedFiles(repository, excluded);
      throw failure;
    },
  });
  const history = new ActivityStore(data);
  try {
    assert.throws(() => interrupted.stop(repo), (error) => error === failure);
    assert.deepEqual(history.listSessions(), []);
    assert.deepEqual(sessions.start(repo), { repositoryName: 'checkout-api', session, started: false });

    const { recap } = sessions.stop(repo);
    assert.ok(recap);
    assert.equal(recap.id, session.id);
    assert.deepEqual(recap.files, [{ path: 'code.txt', added: 1, removed: 0 }]);
    assert.deepEqual(history.getRecap(session.id), recap);
    assert.equal(sessions.status(repo).recording, undefined);
  } finally {
    history.close();
  }
});

for (const replaceBeforeReading of [true, false]) {
  const timing = replaceBeforeReading ? 'while comparison is reading the baseline' : 'after comparison has read the baseline';
  test(`a stale stop preserves a replacement Coding Session ${timing}`, (t) => {
    const { repo, data, run } = fixture(t);
    const file = join(repo, 'code.txt');
    writeFileSync(file, 'original\n');
    const sessions = new CodingSessions({ dataDirectory: data });
    const { session: original } = sessions.start(repo);
    writeFileSync(file, 'original\nfirst session\n');

    const replaceSession = () => {
      run('stop');
      run('start');
    };
    const delayed = new CodingSessions({
      dataDirectory: data,
      *capture(repository, excluded) {
        if (replaceBeforeReading) replaceSession();
        yield* savedFiles(repository, excluded);
        if (!replaceBeforeReading) replaceSession();
      },
    });
    const history = new ActivityStore(data);
    try {
      assert.equal(delayed.stop(repo).recap, undefined);
      assert.deepEqual(history.listSessions().map(({ id }) => id), [original.id]);
      const { session: replacement, started } = sessions.start(repo);
      assert.equal(started, false);
      assert.notEqual(replacement.id, original.id);

      writeFileSync(file, 'original\nfirst session\nsecond session\n');
      const { recap } = sessions.stop(repo);
      assert.equal(recap?.id, replacement.id);
      assert.deepEqual(recap?.files, [{ path: 'code.txt', added: 1, removed: 0 }]);
    } finally {
      history.close();
    }
  });
}

test('a failure releasing the baseline rolls back the Recap and permits retry', (t) => {
  const { repo, data } = fixture(t);
  const file = join(repo, 'code.txt');
  writeFileSync(file, 'original\n');
  const sessions = new CodingSessions({ dataDirectory: data });
  const { session } = sessions.start(repo);
  writeFileSync(file, 'original\nnew work\n');

  const database = new DatabaseSync(join(data, 'activity.sqlite'));
  const history = new ActivityStore(data);
  try {
    database.exec(`
      CREATE TRIGGER fail_baseline_release BEFORE DELETE ON baseline_files
      BEGIN
        SELECT RAISE(ABORT, 'Baseline release interrupted');
      END;
    `);
    assert.throws(() => sessions.stop(repo), /Baseline release interrupted/);
    assert.deepEqual(history.listSessions(), []);
    assert.deepEqual(sessions.start(repo).session, session);

    database.exec('DROP TRIGGER fail_baseline_release');
    const { recap } = sessions.stop(repo);
    assert.equal(recap?.id, session.id);
    assert.deepEqual(recap?.files, [{ path: 'code.txt', added: 1, removed: 0 }]);
    assert.deepEqual(history.getRecap(session.id), recap);
  } finally {
    history.close();
    database.close();
  }
});

test('Recorded Time starts after baseline capture and ends when stop is requested', (t) => {
  const { repo, data } = fixture(t);
  let now = 1000;
  const sessions = new CodingSessions({
    dataDirectory: data,
    now: () => now,
    *capture(repository, excluded) {
      yield* savedFiles(repository, excluded);
      now += 2000;
    },
  });

  const { session } = sessions.start(repo);
  assert.equal(session.startedAt, 3000);
  now = 8000;
  assert.deepEqual(sessions.status(repo).recording, { startedAt: 3000, checkedAt: 8000 });
  assert.equal(sessions.stop(repo).recap?.stoppedAt, 8000);
});

test('Recorded Time stays at zero if the clock moves backward', (t) => {
  const { repo, data } = fixture(t);
  let now = 1000;
  const sessions = new CodingSessions({ dataDirectory: data, now: () => now });
  const { session } = sessions.start(repo);
  now = 0;
  assert.equal(sessions.stop(repo).recap?.stoppedAt, session.startedAt);
  assert.equal(sessions.status(repo).recording, undefined);
});
