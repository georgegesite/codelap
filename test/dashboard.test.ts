import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli, fixture } from './fixture.ts';

async function withDashboard(
  workspace: ReturnType<typeof fixture>,
  useDashboard: (address: string) => Promise<void>,
): Promise<void> {
  const child = spawn(process.execPath, [cli, 'dashboard', '--no-open'], {
    cwd: workspace.repo, env: workspace.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = '';
      let errors = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk;
        const address = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        if (address) resolve(address);
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk; });
      child.once('error', reject);
      child.once('close', () => reject(new Error(`Dashboard exited: ${errors}`)));
    });
    await useDashboard(address);
  } finally {
    child.kill();
    await closed;
  }
}

function recapAddress(history: string, dashboard: string): URL {
  const path = history.match(/href="(\/sessions\/[a-f0-9-]+)"/)?.[1];
  assert.ok(path);
  return new URL(path, dashboard);
}

test('the dashboard lists saved sessions and shows each changed file in its recap', async (t) => {
  const workspace = fixture(t, 'checkout & payments');
  workspace.run('start');
  writeFileSync(join(workspace.repo, 'checkout & tax.ts'), 'const tax = 0;\n');
  workspace.run('stop');

  await withDashboard(workspace, async (address) => {
    const history = await fetch(address);
    assert.equal(history.status, 200);
    const html = await history.text();
    assert.match(html, /Activity history/);
    assert.match(html, /checkout &amp; payments/);
    const recap = await fetch(recapAddress(html, address));
    assert.equal(recap.status, 200);
    assert.match(await recap.text(), /checkout &amp; tax\.ts/);
  });
});

test('a pure rename and a binary addition appear in the recap without changing the line totals', async (t) => {
  const workspace = fixture(t);
  writeFileSync(join(workspace.repo, 'original.txt'), 'original content\n');
  workspace.run('start');
  renameSync(join(workspace.repo, 'original.txt'), join(workspace.repo, 'renamed.txt'));
  writeFileSync(join(workspace.repo, 'image.bin'), Buffer.from([0, 255, 1, 0]));
  assert.match(workspace.run('stop'), /2 files changed · \+0 lines · −0 lines/);

  await withDashboard(workspace, async (address) => {
    const history = await (await fetch(address)).text();
    const html = await (await fetch(recapAddress(history, address))).text();
    assert.match(html, /original\.txt .*renamed to.*renamed\.txt/);
    assert.match(html, /image\.bin/);
    assert.match(html, /aria-label="Unavailable"/);
  });
});

test('Git attributes identify binary files even when their bytes resemble text', async (t) => {
  const workspace = fixture(t);
  writeFileSync(join(workspace.repo, '.gitattributes'), '*.dat binary\n');
  writeFileSync(join(workspace.repo, 'asset.dat'), 'before\n');
  workspace.run('start');
  writeFileSync(join(workspace.repo, 'asset.dat'), 'after\nalso after\n');
  assert.match(workspace.run('stop'), /1 file changed · \+0 lines · −0 lines/);

  await withDashboard(workspace, async (address) => {
    const history = await (await fetch(address)).text();
    const html = await (await fetch(recapAddress(history, address))).text();
    assert.match(html, /asset\.dat/);
    assert.match(html, /aria-label="Unavailable"/);
  });
});

test('a developer can delete a mistaken recording from its recap', async (t) => {
  const workspace = fixture(t);
  workspace.run('start');
  workspace.run('stop');

  await withDashboard(workspace, async (address) => {
    const history = await (await fetch(address)).text();
    const recap = recapAddress(history, address);
    const html = await (await fetch(recap)).text();
    const action = html.match(/action="([^"]+\/delete)"/)?.[1];
    const token = html.match(/name="token" value="([a-f0-9]+)"/)?.[1];
    assert.ok(action && token);
    const deletion = new URL(action, address);

    const rejected = await fetch(deletion, { method: 'POST', body: new URLSearchParams({ token: 'invalid' }) });
    assert.equal(rejected.status, 403);
    assert.equal((await fetch(recap)).status, 200);

    const response = await fetch(deletion, { method: 'POST', body: new URLSearchParams({ token }) });
    assert.match(await response.text(), /No sessions yet/);
    assert.equal((await fetch(recap)).status, 404);
  });
});

test('a saved recap previews and downloads the same square PNG', async (t) => {
  const label = 'payments-api-with-a-long-repository-name-for-a-shared-session-card';
  const workspace = fixture(t, label);
  workspace.run('start');
  writeFileSync(join(workspace.repo, 'tax.txt'), 'line one\nline two\n');
  workspace.run('stop');

  await withDashboard(workspace, async (address) => {
    const history = await (await fetch(address)).text();
    const html = await (await fetch(recapAddress(history, address))).text();
    const preview = html.match(/src="([^"]+\.png)"/)?.[1];
    const download = html.match(/href="([^"]+\.png\?download=1)"/)?.[1];
    assert.ok(preview && download);

    const response = await fetch(new URL(preview, address));
    assert.equal(response.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);

    const attachment = await fetch(new URL(download, address));
    assert.match(attachment.headers.get('content-disposition') ?? '', /^attachment;.*\.png"$/);
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), png);
  });
});
