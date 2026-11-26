import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';

import { formatRecordedTime } from '../activity.ts';
import type { SessionSummary } from '../activity.ts';

const numberFormat = new Intl.NumberFormat('en-US');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function wrap(context: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const { segment } of graphemes.segment(text)) {
    if (line && context.measureText(line + segment).width > maxWidth) {
      const boundary = Math.max(line.lastIndexOf('-'), line.lastIndexOf('_'), line.lastIndexOf('.'), line.lastIndexOf(' ')) + 1;
      const remainder = line.slice(boundary);
      if (boundary && context.measureText(remainder + segment).width <= maxWidth) {
        lines.push(line.slice(0, boundary));
        line = remainder;
      } else {
        lines.push(line);
        line = '';
      }
    }
    line += segment;
  }
  lines.push(line);
  return lines;
}

function repositoryName(context: SKRSContext2D, name: string): void {
  context.fillStyle = '#f2f4ee';
  for (let fontSize = 90; fontSize >= 18; fontSize -= 2) {
    context.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
    const lines = wrap(context, name, 856);
    const lineHeight = Math.ceil(fontSize * 1.12);
    if (lines.length * lineHeight <= 268) {
      lines.forEach((line, index) => context.fillText(line, 112, 166 + index * lineHeight, 856));
      return;
    }
  }
  context.fillText(name, 112, 166, 856);
}

function label(context: SKRSContext2D, text: string, x: number, y: number): void {
  context.font = '600 31px "Segoe UI", sans-serif';
  context.fillStyle = '#b3bfad';
  context.fillText(text, x, y);
}

export async function renderStatsPng(session: SessionSummary): Promise<Buffer> {
  const canvas = createCanvas(1080, 1080);
  const context = canvas.getContext('2d');
  context.textBaseline = 'top';
  context.fillStyle = '#111412';
  context.fillRect(0, 0, 1080, 1080);

  context.beginPath();
  context.roundRect(56, 56, 968, 968, 34);
  context.fillStyle = '#191e19';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#40503b';
  context.stroke();

  label(context, 'Repository', 112, 109);
  repositoryName(context, session.repositoryName);

  context.beginPath();
  context.roundRect(88, 455, 904, 258, 24);
  context.fillStyle = '#263321';
  context.fill();
  label(context, 'Total time', 112, 492);
  context.fillStyle = '#c6ef87';
  context.font = '700 114px "Cascadia Mono", Consolas, monospace';
  context.fillText(formatRecordedTime(session.startedAt, session.stoppedAt), 112, 554, 856);

  context.fillStyle = '#40503b';
  context.fillRect(540, 765, 2, 175);
  label(context, 'Lines added', 112, 770);
  label(context, 'Lines removed', 578, 770);
  context.font = '700 78px "Cascadia Mono", Consolas, monospace';
  context.fillStyle = '#c6ef87';
  context.fillText(`+${numberFormat.format(session.linesAdded)}`, 112, 839, 390);
  context.fillStyle = '#ffa49b';
  context.fillText(`−${numberFormat.format(session.linesRemoved)}`, 578, 839, 390);

  return canvas.encode('png');
}
