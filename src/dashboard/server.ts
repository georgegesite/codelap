import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ActivityStore } from '../store.ts';
import { renderStatsPng } from './card.ts';
import { historyPage, missingPage, recapPage } from './pages.ts';

const host = '127.0.0.1';

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { 'Content-Type': type });
  response.end(body);
}

async function readDeleteToken(request: IncomingMessage): Promise<string | null> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return null;
  let body = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024) return null;
  }
  return new URLSearchParams(body).get('token');
}

export async function serveDashboard(openBrowser: boolean): Promise<void> {
  const stylesheet = readFileSync(new URL('../../assets/dashboard.css', import.meta.url), 'utf8');
  const store = new ActivityStore();
  const deleteToken = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    const authority = `${host}:${(server.address() as AddressInfo).port}`;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    if (request.headers.host !== authority) {
      send(response, 403, 'text/plain; charset=utf-8', 'Open the dashboard using the address printed in the terminal.');
      return;
    }

    try {
      const { pathname, searchParams } = new URL(request.url ?? '/', `http://${authority}`);
      if (request.method === 'GET' && pathname === '/') {
        send(response, 200, 'text/html; charset=utf-8', historyPage(store.listSessions()));
      } else if (request.method === 'GET' && pathname === '/dashboard.css') {
        send(response, 200, 'text/css; charset=utf-8', stylesheet);
      } else {
        const route = /^\/sessions\/([a-f0-9-]{36})(?:\/(delete|card\.png))?$/.exec(pathname);
        const id = route?.[1];
        const action = route?.[2];
        if (id && action === 'delete' && request.method === 'POST') {
          if (await readDeleteToken(request) !== deleteToken) {
            send(response, 403, 'text/plain; charset=utf-8', 'Reopen the recap to delete this session.');
            return;
          }
          if (store.deleteRecap(id)) {
            response.writeHead(303, { Location: '/' }).end();
            return;
          }
        }
        const recap = id && action !== 'delete' && request.method === 'GET' ? store.getRecap(id) : undefined;
        if (recap && action === 'card.png') {
          const png = await renderStatsPng(recap);
          if (searchParams.get('download') === '1') {
            const label = recap.repositoryName.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60);
            const filename = `activity-${label}-${recap.id.slice(0, 8)}.png`;
            response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          }
          send(response, 200, 'image/png', png);
        } else {
          send(response, recap ? 200 : 404, 'text/html; charset=utf-8', recap ? recapPage(recap, deleteToken) : missingPage());
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      send(response, 500, 'text/plain; charset=utf-8', 'Could not read the local activity history.');
    }
  });

  server.once('close', () => store.close());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = `http://${host}:${(server.address() as AddressInfo).port}/`;
  console.log(`Dashboard: ${address}`);
  console.log('Press Ctrl+C to close the dashboard.');

  if (openBrowser) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', address] : [address];
    const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.error('Open the dashboard address in your browser.'));
    browser.unref();
  }
}
