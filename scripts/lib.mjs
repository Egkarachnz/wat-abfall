// Helpers shared by the Node scripts (fetch-calendar, notify).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export { buildIcs } from '../js/ics.js'; // kept here so existing scripts keep importing it from lib.mjs

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const file = (...parts) => path.join(ROOT, ...parts);

export async function readJson(p, fallback = undefined) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

export const loadConfig = () => readJson(file('config.json'));

// Writes only when the content differs, so daily runs don't create noisy commits.
export async function writeIfChanged(p, text) {
  let current = null;
  try {
    current = await readFile(p, 'utf8');
  } catch {}
  if (current === text) return false;
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text);
  return true;
}

// "Today" in the configured timezone as YYYY-MM-DD (never the runner's local date).
export function todayIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const unescapeText = (s) => s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// -> [{ date: 'YYYY-MM-DD', summary }]
export function parseIcs(text) {
  const unfolded = text.replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '');
  const events = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const start = /^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/m.exec(body);
    const summary = /^SUMMARY:(.*)$/m.exec(body);
    if (!start || !summary) continue;
    events.push({ date: `${start[1]}-${start[2]}-${start[3]}`, summary: unescapeText(summary[1].trim()) });
  }
  return events;
}
