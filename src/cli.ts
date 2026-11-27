#!/usr/bin/env node
import { formatRecordedTime } from './activity.ts';
import { CodingSessions } from './session.ts';

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

const usage = 'Usage: codelap <start | status | stop | dashboard [--no-open]>';

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

  const cwd = process.cwd();
  const sessions = new CodingSessions();
  if (command === 'start') {
    const { repositoryName, session, started } = sessions.start(cwd);
    const startTime = new Date(session.startedAt).toISOString();
    console.log(started ? `Started ${repositoryName} at ${startTime}.`
      : `${repositoryName} already has a session started at ${startTime}.`);
  } else if (command === 'status') {
    const { repositoryName, recording } = sessions.status(cwd);
    console.log(recording ? `Elapsed: ${formatRecordedTime(recording.startedAt, recording.checkedAt)}`
      : `No open session in ${repositoryName}.`);
  } else {
    const { repositoryName, recap } = sessions.stop(cwd);
    if (recap) {
      console.log(`Stopped ${repositoryName}. Elapsed: ${formatRecordedTime(recap.startedAt, recap.stoppedAt)}.`);
      console.log(`${count(recap.filesChanged, 'file')} changed · +${count(recap.linesAdded, 'line')} · −${count(recap.linesRemoved, 'line')}`);
    } else {
      console.log(`No open session in ${repositoryName}.`);
    }
  }
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
