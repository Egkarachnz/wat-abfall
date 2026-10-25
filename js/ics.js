// iCalendar (.ics) output shared by the daily build script (the subscribable feed) and the
// browser ("add this day to my calendar"). No Node-only APIs in here.
import { binInfo, isEnabled, needsBinOut, sortBins } from './bins.js';
import { addDays } from './dates.js';

const encoder = new TextEncoder();

export const escapeText = (s) => s.replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');
const compact = (iso) => iso.replaceAll('-', '');

// RFC 5545 line folding: max 75 octets per line, never splitting a UTF-8 character.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
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

// One all-day VEVENT with a reminder at 18:00 the evening before.
function eventLines(date, bins, config) {
  const labels = [...new Set(bins.map((b) => `${b.icon} ${b.th}`))]; // Tonne + Container share one label
  const description = [
    ...bins.map((b) => `• ${b.th} (${b.de})${b.note ? ` – ${b.note}` : ''}`),
    ...(needsBinOut(bins) ? ['', 'นำถังออกวางก่อน 06:30 น. ของวันเก็บ'] : []),
  ].join('\n');
  const a = config.address;
  return [
    'BEGIN:VEVENT',
    `UID:${compact(date)}@abfall-koenigsbrunn`,
    `DTSTAMP:${compact(date)}T000000Z`,
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
    `SUMMARY:${escapeText(`เก็บขยะ: ${labels.join(' + ')}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(`${a.strasse} ${a.hausnr}, ${a.plz} ${a.ort}`)}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('พรุ่งนี้เก็บขยะ – อย่าลืมนำถังออก')}`,
    'TRIGGER:-PT6H',
    'END:VALARM',
    'END:VEVENT',
  ];
}

const enabledBins = (keys, config) => sortBins(keys.filter((k) => isEnabled(config, k))).map(binInfo);
const finish = (lines) => lines.map(fold).join('\r\n') + '\r\n';
const header = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Abfall Koenigsbrunn//TH//', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

// The subscribable feed: every collection day in `days` ({ 'YYYY-MM-DD': [binKey, …] }).
export function buildIcs(days, config) {
  const lines = [
    ...header,
    `X-WR-CALNAME:${escapeText(`${config.siteTitle} – ${config.orgName}`)}`,
    `X-WR-TIMEZONE:${config.timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const [date, keys] of Object.entries(days)) {
    const bins = enabledBins(keys, config);
    if (bins.length) lines.push(...eventLines(date, bins, config));
  }
  lines.push('END:VCALENDAR');
  return finish(lines);
}

// A one-off file for a single day (what "add to calendar" in the day sheet downloads).
export function buildDayIcs(date, keys, config) {
  const bins = enabledBins(keys, config);
  return finish([...header, ...eventLines(date, bins, config), 'END:VCALENDAR']);
}

// One city event (from the "ข่าว" tab). Times are the city's own wall-clock times, left "floating" so they
// show at the same hour on a phone in Bavaria; an event that runs over several days becomes whole days.
export function buildEventIcs(event, sourceName) {
  const day = (s) => s.slice(0, 10);
  const stamp = (s) => `${compact(day(s))}T${s.slice(11, 13)}${s.slice(14, 16)}00`;
  const multiDay = Boolean(event.end) && day(event.end) !== day(event.start);
  const when = multiDay
    ? [`DTSTART;VALUE=DATE:${compact(day(event.start))}`, `DTEND;VALUE=DATE:${compact(addDays(day(event.end), 1))}`]
    : [`DTSTART:${stamp(event.start)}`, event.end ? `DTEND:${stamp(event.end)}` : 'DURATION:PT1H'];
  const description = [event.summary, `Quelle: ${sourceName}`, event.url].filter(Boolean).join('\n');
  return finish([
    ...header,
    'BEGIN:VEVENT',
    `UID:${event.id.replace(/[^A-Za-z0-9]+/g, '-')}@abfall-koenigsbrunn`,
    `DTSTAMP:${compact(day(event.start))}T000000Z`,
    ...when,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.place ? [`LOCATION:${escapeText(event.place)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${event.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.title)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]);
}
