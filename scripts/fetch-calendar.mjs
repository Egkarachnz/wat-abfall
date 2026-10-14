#!/usr/bin/env node
// Pulls the collection calendar for the configured address from AWB Landkreis Augsburg
// (C-Trace) and writes data/collections.json + data/calendar.ics.
//
// The C-Trace ICS URL contains a session id that is handed out via a redirect from
// /Abfallkalender, so this runs on a schedule instead of in the browser.
//
//   node scripts/fetch-calendar.mjs
import { binFromSummary, sortBins } from '../js/bins.js';
import { buildIcs, file, loadConfig, parseIcs, readJson, todayIn, writeIfChanged } from './lib.mjs';

const ABFALL_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // every "Check_N" category on AWB's form

async function getSessionId(base) {
  const res = await fetch(`${base}/Abfallkalender`, { redirect: 'manual' });
  const location = res.headers.get('location');
  // "/augsburglandkreis/(S(abc123))/Abfallkalender" -> "(S(abc123))"
  return location ? location.split('/')[2] : '';
}

async function fetchYear(config, year) {
  const { base } = config.source;
  const { gemeinde, ort, strasse, hausnr } = config.address;
  const session = await getSessionId(base);
  const params = new URLSearchParams({
    Gemeinde: gemeinde,
    Ort: ort,
    Strasse: strasse,
    Hausnr: hausnr,
    Jahr: String(year),
    Abfall: `${ABFALL_IDS.join('|')}|`,
  });
  const res = await fetch(`${base}/${session}/abfallkalender/cal?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('response is not an ICS file');
  const events = parseIcs(text);
  if (!events.length) throw new Error('calendar has no events');
  return events;
}

async function withRetry(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function toDays(events, year) {
  const days = {};
  for (const { date, summary } of events) {
    if (!date.startsWith(`${year}-`)) continue;
    (days[date] ??= new Set()).add(binFromSummary(summary));
  }
  return days;
}

async function main() {
  const config = await loadConfig();
  const thisYear = Number(todayIn(config.timezone).slice(0, 4));
  const previous = await readJson(file('data', 'collections.json'), { days: {} });

  // Keep what we already have for this year onwards, then overwrite with fresh data.
  const merged = {};
  for (const [date, bins] of Object.entries(previous.days ?? {})) {
    if (Number(date.slice(0, 4)) >= thisYear) merged[date] = bins;
  }

  // The current year must work; if not, fail loudly and leave the old data in place.
  const current = toDays(await withRetry(() => fetchYear(config, thisYear)), thisYear);
  for (const date of Object.keys(merged)) if (date.startsWith(`${thisYear}-`)) delete merged[date];
  Object.assign(merged, Object.fromEntries(Object.entries(current).map(([d, s]) => [d, [...s]])));

  // Next year is only published around November; HTTP 500 before that is expected.
  try {
    const next = toDays(await fetchYear(config, thisYear + 1), thisYear + 1);
    for (const date of Object.keys(merged)) if (date.startsWith(`${thisYear + 1}-`)) delete merged[date];
    Object.assign(merged, Object.fromEntries(Object.entries(next).map(([d, s]) => [d, [...s]])));
    console.log(`${thisYear + 1}: ${Object.keys(next).length} collection days`);
  } catch (err) {
    console.log(`${thisYear + 1}: not published yet (${err.message})`);
  }

  const days = Object.fromEntries(
    Object.keys(merged)
      .sort()
      .map((d) => [d, sortBins(new Set(merged[d]))]),
  );
  const years = [...new Set(Object.keys(days).map((d) => Number(d.slice(0, 4))))].sort();
  const unknown = [...new Set(Object.values(days).flat().filter((k) => k.startsWith('?')))];
  if (unknown.length) console.warn(`WARNING unknown categories: ${unknown.join(', ')}`);

  // fetchedAt only moves when the schedule itself changes, so it doubles as "last updated".
  const same = JSON.stringify({ years: previous.years, days: previous.days }) === JSON.stringify({ years, days });
  const output = { fetchedAt: same && previous.fetchedAt ? previous.fetchedAt : new Date().toISOString(), years, days };
  const wroteJson = await writeIfChanged(file('data', 'collections.json'), JSON.stringify(output, null, 2) + '\n');
  const wroteIcs = await writeIfChanged(file('data', 'calendar.ics'), buildIcs(days, config));

  const total = Object.keys(days).length;
  console.log(`${thisYear}: ${Object.keys(current).length} collection days (${total} stored, years ${years.join(', ')})`);
  console.log(`collections.json ${wroteJson ? 'updated' : 'unchanged'}, calendar.ics ${wroteIcs ? 'updated' : 'unchanged'}`);
}

main().catch((err) => {
  console.error(`fetch failed: ${err.message}`);
  process.exit(1);
});
