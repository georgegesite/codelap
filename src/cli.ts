#!/usr/bin/env node
import { formatRecordedTime } from './activity.ts';
import { currentRepository } from './repository.ts';
import { ActivityStore } from './store.ts';

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

const usage = 'Usage: coding-activity <start | status | stop | dashboard [--no-open]>';

async function run(args: string[]): Promise<void> {
  const [command] = args;
  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }
  if (command === 'dashboard' && (args.length === 1 || (args.length === 2 && args[1] === '--no-open'))) {
    const { serveDashboard } = await import('./dashboard/server.ts');
    await serveDashboard(args.length === 1);
    return;
  }
  if (!['start', 'status', 'stop'].includes(command) || args.length !== 1) {
    throw new Error(usage);
  }

  const requestedAt = Date.now();
  const repository = currentRepository(process.cwd());
  const store = new ActivityStore();
  try {
    if (command === 'start') {
      const { session, started } = store.start(repository);
      const startTime = new Date(session.startedAt).toISOString();
      console.log(started ? `Started ${repository.name} at ${startTime}.`
        : `${repository.name} already has a session started at ${startTime}.`);
    } else if (command === 'status') {
      const session = store.getOpenSession(repository);
      console.log(session ? `Elapsed: ${formatRecordedTime(session.startedAt, requestedAt)}`
        : `No open session in ${repository.name}.`);
    } else {
      const recap = store.stop(repository, requestedAt);
      if (recap) {
        console.log(`Stopped ${repository.name}. Elapsed: ${formatRecordedTime(recap.startedAt, recap.stoppedAt)}.`);
        console.log(`${count(recap.filesChanged, 'file')} changed · +${count(recap.linesAdded, 'line')} · −${count(recap.linesRemoved, 'line')}`);
      } else {
        console.log(`No open session in ${repository.name}.`);
      }
    }
  } finally {
    store.close();
  }
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
