import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

export const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

export function fixture(test: TestContext, name = 'checkout-api') {
  const temporary = mkdtempSync(join(tmpdir(), 'coding-activity-test-'));
  test.after(() => rmSync(temporary, { recursive: true, force: true, maxRetries: 4 }));

  const repo = join(temporary, name);
  const data = join(temporary, 'activity-data');
  mkdirSync(repo);
  const env = { ...process.env, CODING_ACTIVITY_DATA_DIR: data };

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Activity Test');
  git('config', 'user.email', 'activity@example.invalid');
  git('config', 'core.autocrlf', 'false');
  git('config', 'commit.gpgsign', 'false');

  const run = (command: string, cwd = repo) => execFileSync(process.execPath, [cli, command], {
    cwd, env, encoding: 'utf8',
  }).trim();

  return { repo, data, env, git, run };
}
