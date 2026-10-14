// Helpers shared by the Node scripts (fetch-calendar, notify).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { binInfo, isEnabled, needsBinOut, sortBins } from '../js/bins.js';
import { addDays } from '../js/dates.js';

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
const escapeText = (s) => s.replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');

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

// RFC 5545 line folding: max 75 octets per line, never splitting a UTF-8 character.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 74) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = (iso) => iso.replaceAll('-', '');

// One all-day event per collection day, with a reminder at 18:00 the evening before.
export function buildIcs(days, config) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Abfall Koenigsbrunn//TH//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${config.siteTitle} – ${config.orgName}`)}`,
    `X-WR-TIMEZONE:${config.timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const [date, keys] of Object.entries(days)) {
    const bins = sortBins(keys.filter((k) => isEnabled(config, k))).map(binInfo);
    if (!bins.length) continue;
    const labels = [...new Set(bins.map((b) => `${b.icon} ${b.th}`))]; // Tonne + Container share one label
    const summary = `เก็บขยะ: ${labels.join(' + ')}`;
    const description = [
      ...bins.map((b) => `• ${b.th} (${b.de})${b.note ? ` – ${b.note}` : ''}`),
      ...(needsBinOut(bins) ? ['', 'นำถังออกวางก่อน 06:30 น. ของวันเก็บ'] : []),
    ].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${compact(date)}@abfall-koenigsbrunn`,
      `DTSTAMP:${compact(date)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `LOCATION:${escapeText(`${config.address.strasse} ${config.address.hausnr}, ${config.address.plz} ${config.address.ort}`)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText('พรุ่งนี้เก็บขยะ – อย่าลืมนำถังออก')}`,
      'TRIGGER:-PT6H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
