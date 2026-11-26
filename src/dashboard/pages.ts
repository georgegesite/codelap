import { formatRecordedTime } from '../activity.ts';
import type { FileChange, SessionRecap, SessionSummary } from '../activity.ts';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const numberFormat = new Intl.NumberFormat('en-US');

function htmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function sessionTime(startedAt: number): string {
  const date = new Date(startedAt);
  return `<time datetime="${date.toISOString()}">${htmlText(dateFormat.format(date))}</time>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlText(title)} | Coding Activity</title>
    <link rel="stylesheet" href="/dashboard.css">
  </head>
  <body>
    <header class="masthead">
      <div class="shell masthead-inner">
        <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">›_</span>Coding Activity</a>
        <span class="local-label">On this device</span>
      </div>
    </header>
    <main class="shell main-content">${body}</main>
  </body>
</html>`;
}

function historyRow(session: SessionSummary): string {
  return `<tr>
    <th scope="row"><a class="repo-link" href="/sessions/${session.id}">${htmlText(session.repositoryName)}</a></th>
    <td class="date-cell">${sessionTime(session.startedAt)}</td>
    <td class="numeric">${formatRecordedTime(session.startedAt, session.stoppedAt)}</td>
    <td class="numeric">${numberFormat.format(session.filesChanged)}</td>
    <td class="numeric positive">+${numberFormat.format(session.linesAdded)}</td>
    <td class="numeric negative">−${numberFormat.format(session.linesRemoved)}</td>
  </tr>`;
}

export function historyPage(sessions: SessionSummary[]): string {
  const label = sessions.length === 1 ? '1 session' : `${numberFormat.format(sessions.length)} sessions`;
  return layout('Activity history', `
    <div class="page-heading">
      <h1>Activity history</h1>
      <p class="subheading">${label}</p>
    </div>
    ${sessions.length ? `<section class="panel table-scroll" aria-label="Recorded sessions" tabindex="0">
      <table class="history-table">
        <thead><tr>
          <th scope="col">Repository</th><th scope="col">Started</th><th scope="col" class="numeric">Time</th>
          <th scope="col" class="numeric">Files changed</th><th scope="col" class="numeric">Lines added</th>
          <th scope="col" class="numeric">Lines removed</th>
        </tr></thead>
        <tbody>${sessions.map(historyRow).join('')}</tbody>
      </table>
    </section>` : `<section class="panel empty-state">
      <h2>No sessions yet</h2>
      <p>Run <code>coding-activity start</code> in a Git repository. When you finish, run <code>coding-activity stop</code> to save the session here.</p>
    </section>`}
  `);
}

function filePath(path: string): string {
  return htmlText(path).replaceAll('/', '/<wbr>');
}

function fileRow(file: FileChange): string {
  return `<tr>
    <th scope="row" class="file-path">${file.previousPath ? `<span class="previous-path">${filePath(file.previousPath)} <span aria-hidden="true">→</span><span class="sr-only">renamed to</span></span>` : ''}<span>${filePath(file.path)}</span></th>
    <td class="numeric positive">${file.added === null ? '<span aria-label="Unavailable">—</span>' : `+${numberFormat.format(file.added)}`}</td>
    <td class="numeric negative">${file.removed === null ? '<span aria-label="Unavailable">—</span>' : `−${numberFormat.format(file.removed)}`}</td>
  </tr>`;
}

export function recapPage(session: SessionRecap, deleteToken: string): string {
  const card = `/sessions/${session.id}/card.png`;
  return layout(session.repositoryName, `
    <a class="back-link" href="/"><span aria-hidden="true">←</span> Activity history</a>
    <div class="page-heading recap-heading">
      <h1>${htmlText(session.repositoryName)}</h1>
      <p class="subheading">Started ${sessionTime(session.startedAt)}</p>
    </div>
    <dl class="metrics" aria-label="Session totals">
      <div class="metric primary"><dt>Total time</dt><dd>${formatRecordedTime(session.startedAt, session.stoppedAt)}</dd></div>
      <div class="metric"><dt>Files changed</dt><dd>${numberFormat.format(session.filesChanged)}</dd></div>
      <div class="metric"><dt>Lines added</dt><dd class="positive">+${numberFormat.format(session.linesAdded)}</dd></div>
      <div class="metric"><dt>Lines removed</dt><dd class="negative">−${numberFormat.format(session.linesRemoved)}</dd></div>
    </dl>
    <div class="recap-content">
      <section class="panel files-panel" aria-labelledby="files-heading">
        <h2 id="files-heading">Files changed</h2>
        ${session.files.length ? `<table class="file-table">
          <thead><tr><th scope="col">Path</th><th scope="col" class="numeric">Added</th><th scope="col" class="numeric">Removed</th></tr></thead>
          <tbody>${session.files.map(fileRow).join('')}</tbody>
        </table>` : '<p class="panel-message">The saved files were the same at start and stop.</p>'}
      </section>
      <section class="panel card-panel" aria-labelledby="card-heading">
        <h2 id="card-heading">Stats PNG</h2>
        <img class="card-preview" src="${card}" alt="Stats card for ${htmlText(session.repositoryName)}" width="1080" height="1080">
        <a class="button download" href="${card}?download=1"><span aria-hidden="true">↓</span> Download PNG</a>
      </section>
    </div>
    <details class="delete-session">
      <summary>Delete session</summary>
      <form method="post" action="/sessions/${session.id}/delete">
        <input type="hidden" name="token" value="${deleteToken}">
        <p>Remove this session from your activity history?</p>
        <button type="submit" class="button destructive">Delete session</button>
      </form>
    </details>
  `);
}

export function missingPage(): string {
  return layout('Session unavailable', `
    <a class="back-link" href="/">← Activity history</a>
    <div class="page-heading"><h1>Session unavailable</h1></div>
    <p class="subheading">This activity is no longer in your history.</p>
  `);
}
