#!/usr/bin/env node
// © 2026 Phramaha Egkarach. All rights reserved. Not licensed for copying or reuse; see LICENSE.
// Fetches the city news and events of Königsbrunn and Augsburg from the cities' own public
// feeds and writes data/news.json for the "ข่าว" tab.
//
//   node scripts/fetch-news.mjs
//
// What is kept: the headline, a short plain-text summary (no images, no full text), the link to
// the original and who published it. Both cities allow reprinting and evaluating their press
// releases with the source named (see the Impressum of koenigsbrunn.de and augsburg.de).
// If a feed fails the previous items of that source are kept, so one bad day never empties the tab.
import { pathToFileURL } from 'node:url';
import { file, loadConfig, readJson, writeIfChanged } from './lib.mjs';

const USER_AGENT = 'wat-abfall (+https://github.com/Egkarachnz/wat-abfall)';
const ALLOWED_HOSTS = ['koenigsbrunn.de', 'augsburg.de'];
const NEWS_PER_SOURCE = 15;
const EVENTS_MAX = 12;
const SUMMARY_MAX = 300;

export const SOURCES = {
  koenigsbrunn: {
    name: 'Stadt Königsbrunn',
    site: 'https://www.koenigsbrunn.de',
    news: 'https://www.koenigsbrunn.de/nachrichten/rss',
    events: 'https://www.koenigsbrunn.de/veranstaltungen/rss',
    newsPage: 'https://www.koenigsbrunn.de/nachrichten',
    eventsPage: 'https://www.koenigsbrunn.de/veranstaltungen',
  },
  augsburg: {
    name: 'Stadt Augsburg',
    site: 'https://www.augsburg.de',
    news: 'https://www.augsburg.de/aktuelles-aus-der-stadt/feed.rss',
    newsPage: 'https://www.augsburg.de/aktuelles-aus-der-stadt',
    eventsPage: 'https://www.augsburg.de/veranstaltungen', // no feed for events: the app only links to this page
  },
};

/* ---------- small helpers ---------- */
async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// Only https links on the cities' own domains ever reach the app.
export function allowedUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });

const stripTags = (s) => s.replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '');
const squash = (s) => s.replace(/[\s ]+/g, ' ').trim();

// an element's inner text, whether it came as CDATA (HTML) or as escaped text
function textOf(raw) {
  if (raw == null) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return squash(decode(stripTags(cdata ? cdata[1] : decode(raw))));
}

const tag = (block, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1] ?? null;

function shorten(text, max = SUMMARY_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const toIso = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/* ---------- Atom and RSS ---------- */
// -> [{ id, title, link, published, teaser, body, category }]
export function parseFeed(xml, base) {
  const items = [];
  for (const m of xml.matchAll(/<(entry|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const atom = m[1].toLowerCase() === 'entry';
    const b = m[2];
    const links = [...b.matchAll(/<link\b([^>]*?)\/?>/gi)].map((l) => l[1]);
    const alt = links.find((a) => /rel="alternate"/i.test(a)) ?? links.find((a) => /href=/i.test(a));
    const rawLink = atom ? /href="([^"]+)"/i.exec(alt ?? '')?.[1] : tag(b, 'link');
    const link = allowedUrl(decode(textOf(rawLink ?? '')), base);
    const published = toIso(atom ? textOf(tag(b, 'published') ?? tag(b, 'updated')) : textOf(tag(b, 'pubDate')));
    if (!link || !published) continue;
    items.push({
      id: textOf(atom ? tag(b, 'id') : tag(b, 'guid')) || link,
      title: textOf(tag(b, 'title')),
      link,
      published,
      teaser: textOf(atom ? tag(b, 'summary') : tag(b, 'description')),
      body: textOf(atom ? tag(b, 'content') : tag(b, 'content:encoded')),
      category: textOf(/<category\b[^>]*\bterm="([^"]*)"/i.exec(b)?.[1] ?? tag(b, 'category') ?? ''),
    });
  }
  return items.sort((a, z) => z.published.localeCompare(a.published));
}

// TYPO3 splits "Headline … | teaser" over title and summary: "Bürgerversammlung: Mi, 28. Oktober 2026 ..." + "... um 19:00 Uhr"
function mergeTitle(title, teaser) {
  const ellipsis = /\s*(\.\.\.|…)\s*$/;
  if (ellipsis.test(title) && /^\s*(\.\.\.|…)/.test(teaser)) {
    return { title: squash(`${title.replace(ellipsis, '')} ${teaser.replace(/^\s*(\.\.\.|…)\s*/, '')}`), teaser: '' };
  }
  return { title: title.replace(ellipsis, '…').trim(), teaser };
}

function toNews(item, source) {
  const merged = mergeTitle(item.title, item.teaser);
  let body = item.body;
  if (item.teaser && body.startsWith(item.teaser)) body = body.slice(item.teaser.length).trim(); // the lead is repeated at the top of the body
  const summary = shorten([merged.teaser, body].filter(Boolean).join(' '));
  return { id: `${source}:${item.id.replace(/^https?:\/\/[^/]+\//, '')}`, source, title: merged.title, summary, url: item.link, published: item.published };
}

/* ---------- Königsbrunn events ---------- */
const MONTHS = { jan: 1, feb: 2, mär: 3, mar: 3, mrz: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };
const pad = (n) => String(n).padStart(2, '0');

// "Do, 01 Okt 2026 08:00:00" -> "2026-10-01T08:00"
function germanDateTime(s) {
  const m = /(\d{1,2})\s+([A-Za-zäÄ]{3})[a-z.]*\s+(\d{4})\s+(\d{1,2}):(\d{2})/.exec(s);
  const month = m && MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${pad(month)}-${pad(m[1])}T${pad(m[4])}:${m[5]}` : null;
}

// "Start: …, Ende: … | description"
function parseEventSummary(text) {
  const [times, ...rest] = text.split(' | ');
  const start = /Start:\s*([^,]*,[^,]*?)(?:,\s*Ende:|$)/.exec(times)?.[1];
  const end = /Ende:\s*(.*)$/.exec(times)?.[1];
  const from = start && germanDateTime(start);
  return from ? { start: from, end: (end && germanDateTime(end)) || null, description: rest.join(' | ') } : null;
}

// The city's own iCal export has the places; its link carries a cache hash, so read it from the page each time.
async function eventPlaces() {
  const html = await get(SOURCES.koenigsbrunn.eventsPage);
  const href = /href="([^"]*action%5D=ical[^"]*)"/i.exec(html)?.[1];
  const url = href && allowedUrl(decode(href), SOURCES.koenigsbrunn.site);
  if (!url) throw new Error('no iCal link on the events page');
  const ics = (await get(url)).replace(/\r?\n[ \t]/g, '');
  const places = new Map();
  for (const block of ics.split('BEGIN:VEVENT').slice(1)) {
    const start = /^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/m.exec(block);
    const summary = /^SUMMARY:(.*)$/m.exec(block)?.[1];
    const place = /^LOCATION:(.*)$/m.exec(block)?.[1];
    const clean = (v) => squash(decode(v.replace(/\\([,;])/g, '$1')));
    if (start && summary && place) places.set(`${clean(summary)}|${start[1]}-${start[2]}-${start[3]}T${start[4]}:${start[5]}`, clean(place));
  }
  return places;
}

async function fetchEvents() {
  const entries = parseFeed(await get(SOURCES.koenigsbrunn.events), SOURCES.koenigsbrunn.site);
  const places = await eventPlaces().catch((err) => {
    console.warn(`events: no places (${err.message})`);
    return new Map();
  });
  const events = [];
  for (const item of entries) {
    const when = parseEventSummary(item.teaser);
    if (!when) {
      console.warn(`events: skipped "${item.title}" (could not read the date)`);
      continue;
    }
    const merged = mergeTitle(item.title, when.description);
    events.push({
      id: `koenigsbrunn:${item.id.replace(/^https?:\/\/[^/]+\//, '')}`,
      source: 'koenigsbrunn',
      title: merged.title,
      start: when.start,
      end: when.end,
      place: places.get(`${item.title}|${when.start}`) ?? '', // matched on the title as the feed has it
      summary: shorten(merged.teaser),
      category: item.category,
      url: item.link,
    });
  }
  return events;
}

/* ---------- main ---------- */
const berlinNow = (timezone) => new Date().toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T').slice(0, 16);

async function main() {
  const config = await loadConfig();
  const target = file('data', 'news.json');
  const previous = await readJson(target, { news: [], events: [] });
  const stale = [];
  let attempts = 0;
  let failures = 0;

  async function attempt(label, work, fallback) {
    attempts++;
    try {
      return await work();
    } catch (err) {
      console.warn(`${label}: ${err.message} — keeping the previous items`);
      stale.push(label);
      failures++;
      return fallback;
    }
  }

  const news = [];
  for (const [key, source] of Object.entries(SOURCES)) {
    if (!source.news) continue;
    news.push(
      ...(await attempt(
        `${key}.news`,
        async () => parseFeed(await get(source.news), source.site).slice(0, NEWS_PER_SOURCE).map((item) => toNews(item, key)),
        previous.news.filter((n) => n.source === key),
      )),
    );
  }
  news.sort((a, z) => z.published.localeCompare(a.published));

  const now = berlinNow(config.timezone);
  const events = (await attempt('koenigsbrunn.events', fetchEvents, previous.events.filter((e) => e.source === 'koenigsbrunn')))
    .filter((e) => (e.end ?? e.start) >= now) // still to come, or still running
    .sort((a, z) => a.start.localeCompare(z.start))
    .slice(0, EVENTS_MAX);

  if (failures === attempts) throw new Error('every source failed');

  const sources = Object.fromEntries(Object.entries(SOURCES).map(([key, s]) => [key, { name: s.name, site: s.site, news: s.newsPage, events: s.eventsPage }]));
  const content = { sources, stale, news, events };
  // keep the old timestamp when nothing changed, so a quiet day makes no commit
  const same = JSON.stringify({ sources: previous.sources, stale: previous.stale, news: previous.news, events: previous.events }) === JSON.stringify(content);
  const out = { fetchedAt: same ? previous.fetchedAt : new Date().toISOString(), ...content };
  const changed = await writeIfChanged(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`news.json: ${news.length} news, ${events.length} events${stale.length ? `, stale: ${stale.join(', ')}` : ''}${changed ? ' (updated)' : ' (unchanged)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
