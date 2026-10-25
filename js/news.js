// © 2026 Phramaha Egkarach. All rights reserved. Not licensed for copying or reuse; see LICENSE.
// The "ข่าว" tab: news and events of Königsbrunn and Augsburg, read from data/news.json (made by
// scripts/fetch-news.mjs). The list shows the German headline and a short summary; tapping an item
// opens a sheet with the text and clear choices: read it in Thai (Google Translate's page for the
// same article), read the German original, add to calendar, share.
import { MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, diffDays, longDate, parts, weekday } from './dates.js';
import { buildEventIcs } from './ics.js';
import { uiIcon } from './icons.js';
import { haptic, toast } from './shell.js';

const TRUSTED_HOSTS = ['koenigsbrunn.de', 'augsburg.de', 'landkreis-augsburg.de'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// only the cities' own https pages are ever linked from the feed data
function trusted(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && TRUSTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? u.href : null;
  } catch {
    return null;
  }
}

// Google Translate's website translation: www.koenigsbrunn.de -> www-koenigsbrunn-de.translate.goog (German -> Thai)
export function thaiUrl(raw) {
  const u = new URL(raw);
  const host = `${u.hostname.replace(/-/g, '--').replace(/\./g, '-')}.translate.goog`;
  const query = new URLSearchParams(u.search);
  for (const [key, value] of Object.entries({ _x_tr_sl: 'de', _x_tr_tl: 'th', _x_tr_hl: 'th', _x_tr_pto: 'wapp' })) query.set(key, value);
  return `https://${host}${u.pathname}?${query}`;
}

// where "see more" goes, per tab (no feed exists for these, so they are plain links)
const MORE = {
  news: [
    { url: 'https://www.koenigsbrunn.de/nachrichten', title: 'ข่าวทั้งหมดของ Königsbrunn' },
    { url: 'https://www.augsburg.de/aktuelles-aus-der-stadt', title: 'ข่าวทั้งหมดของ Augsburg' },
    { url: 'https://www.landkreis-augsburg.de/news/', title: 'ข่าวของ Landkreis Augsburg' },
  ],
  events: [
    { url: 'https://www.koenigsbrunn.de/veranstaltungen', title: 'กิจกรรมทั้งหมดของ Königsbrunn' },
    { url: 'https://www.augsburg.de/veranstaltungen', title: 'กิจกรรมในเมือง Augsburg' },
    { url: 'https://www.landkreis-augsburg.de/politik-landkreis/veranstaltungskalender-1/', title: 'กิจกรรมของ Landkreis Augsburg' },
  ],
};

// A topic per story, guessed from German keywords (headline first, then the summary), so each row
// gets a coloured icon and a Thai label: a reader who can't read German still sees what it is about.
// First match wins, so the narrow topics come before the broad ones. Colours live in the CSS ([data-topic]).
const TOPICS = [
  { key: 'safety', icon: 'tSafety', th: 'ความปลอดภัย', re: /feuerwehr|polizei|sicherheit|unfall|warn|notfall|rettung|\bbrand/ },
  { key: 'health', icon: 'tHealth', th: 'สุขภาพ', re: /gesundheit|herz|medizin|ärzt|arzt|kranken|pflege|impf|blutspende|vorsorge|klinik|corona/ },
  { key: 'traffic', icon: 'tTraffic', th: 'การจราจร', re: /verkehr|stra(ß|ss)e|baustelle|bauarbeit|sperrung|gesperrt|radweg|gehweg|ampel|parken|umleitung|brücke|\bbus|tram|öpnv|\bbahn/ },
  { key: 'faith', icon: 'tFaith', th: 'ศาสนา', re: /religion|kirche|frieden|glaube|gottesdienst/ },
  { key: 'culture', icon: 'tCulture', th: 'วัฒนธรรม', re: /konzert|musik|theater|kultur|museum|ausstellung|kunst|lesung|\bfilm|kino|chor|orchester|bibliothek/ },
  { key: 'sport', icon: 'tSport', th: 'กีฬา', re: /sport|fu(ß|ss)ball|turnier|marathon|schwimm|eislauf|fitness/ },
  { key: 'festival', icon: 'tFestival', th: 'งานเทศกาล', re: /fest(e|es)?\b|festival|kirchweih|dult|plärrer|markt|feier|advent|weihnacht|ostern|fasching|jubiläum/ },
  { key: 'learning', icon: 'tLearning', th: 'การศึกษา', re: /schule|schüler|kinder|kita|jugend|bildung|ferien|familie|vhs|kurs|studium/ },
  { key: 'nature', icon: 'tNature', th: 'สิ่งแวดล้อม', re: /umwelt|klima|natur|bäume|\bbaum\b|garten|wald|energie|solar|abfall|müll|recycling|wasser|grünfläche/ },
  { key: 'economy', icon: 'tEconomy', th: 'เศรษฐกิจ', re: /wirtschaft|unternehm|gründer|handel|\bjobs?\b|ausbildung|förderung/ },
  { key: 'social', icon: 'tSocial', th: 'สังคม', re: /senior|sozial|ehrenamt|spende|hilfe|integration|inklusion|frauen|migration|nachbarschaft/ },
  { key: 'civic', icon: 'tCivic', th: 'ข่าวเมือง', re: /bürger|stadtrat|(?<!aus)wahl|bürgermeister|sitzung|rathaus|versammlung|haushalt|verwaltung|formular|ausweis|bürgerbüro|online-dienst/ },
];
const GENERAL = { key: 'general', icon: 'news', th: 'ข่าวทั่วไป' };
const topicOf = (item) => {
  for (const text of [item.title, item.summary ?? '']) {
    const hit = TOPICS.find((t) => t.re.test(text.toLowerCase()));
    if (hit) return hit;
  }
  return GENERAL;
};

const chev = `<span class="chev">${uiIcon('chevronRight', 'bold')}</span>`;

// a settings-style row for the detail sheet: coloured tile, title, optional subtitle
function sheetRow({ tag = 'a', attrs = '', tone, icon, title, sub = '' }) {
  const button = tag === 'button' ? ' type="button"' : '';
  return `<${tag} class="row row-link"${button} ${attrs}>
    <span class="ico-tile" data-tone="${tone}">${uiIcon(icon, 'fill')}</span>
    <span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>${chev}
  </${tag}>`;
}
const outbound = (href, attrs = '') => `href="${esc(href)}" target="_blank" rel="noopener noreferrer" ${attrs}`;

export function initNews({ timezone, getToday, sheet }) {
  const root = document.querySelector('#news');
  const view = { kind: 'news', source: 'all' };
  let data = null;
  let failed = false;
  let current = null; // the item whose sheet is open

  const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const localTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const dayLabel = (date) => `${parts(date).d} ${MONTHS_SHORT[parts(date).m - 1]}`;
  const sourceName = (key) => data.sources[key]?.name ?? key;
  const daysAgo = (iso) => diffDays(localDate(iso), getToday());

  // a coloured source pill, then "14:28 น." for today and yesterday or "20 ต.ค." for older items
  const newsMeta = (item, withTopic = true) => {
    const ago = daysAgo(item.published);
    return `<b class="news-src" data-src="${esc(item.source)}">${esc(sourceName(item.source).replace(/^Stadt /, ''))}</b><span class="news-when">${ago <= 1 ? `${localTime(item.published)} น.` : dayLabel(localDate(item.published))}${withTopic ? ` · ${topicOf(item).th}` : ''}</span>`;
  };

  function timeLabel(event) {
    const start = event.start.slice(0, 10);
    const end = event.end?.slice(0, 10);
    if (end && end !== start) return `${dayLabel(start)} – ${dayLabel(end)}`;
    const time = (s) => s.slice(11, 16);
    return `${time(event.start)}${event.end ? `–${time(event.end)}` : ''} น.`;
  }

  // every event is in Königsbrunn, so the postcode and town are noise on a small screen (the calendar file keeps them)
  const shortPlace = (place) => place.replace(/,?\s*(86343\s+)?Königsbrunn\s*$/i, '');

  /* ---------- the list ---------- */
  // the newest story gets a cover in its topic's colour; the rest a small icon tile
  function newsItem(item, lead) {
    if (!trusted(item.url)) return '';
    const topic = topicOf(item);
    const visual = lead
      ? `<span class="news-cover" data-topic="${topic.key}" aria-hidden="true"><span class="news-cover-ico">${uiIcon(topic.icon, 'fill')}</span><span class="news-cover-label">${uiIcon(topic.icon, 'fill')}${topic.th}</span><span class="news-cover-badge">ข่าวล่าสุด</span></span>`
      : `<span class="topic-tile" data-topic="${topic.key}" aria-hidden="true">${uiIcon(topic.icon, 'fill')}</span>`;
    return `<li class="news-item${lead ? ' is-lead' : ''}">
      <button type="button" class="row row-link news-row" data-news-open="${esc(item.id)}">
        ${visual}
        <span class="row-main">
          <span class="news-meta">${newsMeta(item, !lead)}</span>
          <span class="news-title" lang="de">${esc(item.title)}</span>
          ${item.summary ? `<span class="news-sum" lang="de">${esc(item.summary)}</span>` : ''}
        </span>${chev}
      </button>
    </li>`;
  }

  function eventItem(event) {
    if (!trusted(event.url)) return '';
    const start = event.start.slice(0, 10);
    // title first, then when, then where: the description is in the sheet
    return `<li class="news-item is-event">
      <button type="button" class="row row-link news-row" data-news-open="${esc(event.id)}">
        <span class="date-icon" aria-hidden="true"><span class="wd">${WEEKDAYS_SHORT[weekday(start)]}</span><span class="dn">${parts(start).d}</span></span>
        <span class="row-main">
          <span class="news-title" lang="de">${esc(event.title)}</span>
          <span class="news-meta">${esc(timeLabel(event))}</span>
          ${event.place ? `<span class="news-sum" lang="de">${esc(shortPlace(event.place))}</span>` : ''}
        </span>${chev}
      </button>
    </li>`;
  }

  // news by day, events by month ("running now" first), like the headings in Apple's own apps
  function groupNews(items) {
    const groups = [];
    for (const item of items) {
      const ago = daysAgo(item.published);
      const label = ago <= 0 ? 'วันนี้' : ago === 1 ? 'เมื่อวาน' : ago < 7 ? '7 วันที่ผ่านมา' : 'ก่อนหน้านี้';
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1).items.push(item);
    }
    return groups;
  }

  function groupEvents(items) {
    const today = getToday();
    const groups = [];
    for (const event of items) {
      const running = event.start.slice(0, 10) <= today;
      const { y, m } = parts(event.start.slice(0, 10));
      const label = running ? 'กำลังจัดอยู่' : `${MONTHS[m - 1]} ${y}`;
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1).items.push(event);
    }
    return groups;
  }

  function render() {
    if (!data) {
      root.innerHTML = `<p class="empty">${failed ? 'โหลดข่าวไม่สำเร็จ — ลองดึงหน้าจอลงเพื่ออัปเดต หรือเปิดเว็บไซต์ของเมืองโดยตรง' : 'กำลังโหลดข่าว…'}</p>`;
      return;
    }
    const isNews = view.kind === 'news';
    const all = isNews ? data.news : data.events;
    const keys = Object.keys(data.sources).filter((k) => all.some((i) => i.source === k));
    if (view.source !== 'all' && !keys.includes(view.source)) view.source = 'all';
    const items = all.filter((i) => view.source === 'all' || i.source === view.source);
    const pills = keys.length > 1
      ? `<div class="src-chips" role="radiogroup" aria-label="แหล่งข่าว">${[['all', 'ทั้งหมด'], ...keys.map((k) => [k, sourceName(k).replace(/^Stadt /, '')])]
          .map(([k, text]) => `<button type="button" class="src-chip" role="radio" aria-checked="${view.source === k}" data-news-source="${esc(k)}">${esc(text)}</button>`)
          .join('')}</div>`
      : '';
    const groups = (isNews ? groupNews : groupEvents)(items);
    let first = true;
    const sections = groups
      .map(({ label, items: rows }) => {
        const html = rows.map((item) => (isNews ? newsItem(item, first && rows[0] === item) : eventItem(item))).join('');
        first = false;
        return `<section class="news-group"><h2 class="section-title">${esc(label)}</h2><div class="card"><ul class="rows">${html}</ul></div></section>`;
      })
      .join('');
    const updated = data.fetchedAt ? dayLabel(localDate(data.fetchedAt)) : '';
    root.innerHTML = `
      <div class="news-controls">
        <div class="seg news-seg" role="radiogroup" aria-label="ประเภท">
          <button type="button" role="radio" aria-checked="${isNews}" data-news-kind="news">${uiIcon('news', isNews ? 'fill' : 'regular')}ข่าว</button>
          <button type="button" role="radio" aria-checked="${!isNews}" data-news-kind="events">${uiIcon('calendar', isNews ? 'regular' : 'fill')}กิจกรรม</button>
        </div>
        ${pills}
      </div>
      ${sections || `<div class="card"><p class="empty">${isNews ? 'ยังไม่มีข่าว' : 'ยังไม่มีกิจกรรมที่กำลังจะถึง'}</p></div>`}
      <h2 class="section-title">ดูเพิ่มที่เว็บไซต์ของเมือง</h2>
      <div class="card"><div class="rows">${MORE[view.kind]
        .map((o) => sheetRow({ attrs: outbound(o.url), tone: 'gray', icon: 'external', title: esc(o.title) }))
        .join('')}</div></div>
      <p class="footnote news-note">แสดงเฉพาะหัวข้อและสรุปสั้น แตะที่รายการเพื่ออ่านต่อหรือแปลเป็นไทย${updated ? ` · อัปเดตล่าสุด ${updated}` : ''}${data.stale?.length ? ' · บางแหล่งอัปเดตไม่ได้ชั่วคราว' : ''}</p>`;
  }

  /* ---------- the sheet ---------- */
  function openItem(id, trigger) {
    const item = [...data.news, ...data.events].find((i) => i.id === id);
    const original = item && trusted(item.url);
    if (!original) return;
    current = item;
    const isEvent = Boolean(item.start);
    const host = new URL(original).hostname.replace(/^www\./, '');
    const meta = isEvent ? longDate(item.start.slice(0, 10)) : `${longDate(localDate(item.published))} · ${localTime(item.published)} น.`;
    const details = isEvent
      ? `<div class="card"><ul class="rows">
          <li class="row kv"><span>วันที่</span><span>${esc(timeLabel(item))}</span></li>
          ${item.place ? `<li class="row kv"><span>สถานที่</span><span lang="de">${esc(item.place)}</span></li>` : ''}
        </ul></div>`
      : '';
    sheet.open({
      title: sourceName(item.source),
      meta,
      trigger,
      html: `
        <div class="card news-read">
          <p class="news-topic-chip" data-topic="${topicOf(item).key}">${uiIcon(topicOf(item).icon, 'fill')}${topicOf(item).th}</p>
          <h3 class="news-headline" lang="de">${esc(item.title)}</h3>
          ${item.summary ? `<p class="news-body" lang="de">${esc(item.summary)}</p>` : ''}
        </div>
        ${details}
        <div class="card"><div class="rows">
          ${sheetRow({ attrs: outbound(thaiUrl(original)), tone: 'blue', icon: 'translate', title: 'อ่านเป็นภาษาไทย', sub: 'แปลโดย Google · อาจคลาดเคลื่อน' })}
          ${sheetRow({ attrs: outbound(original), tone: 'gray', icon: 'external', title: 'อ่านต้นฉบับ (เยอรมัน)', sub: esc(host) })}
          ${isEvent ? sheetRow({ tag: 'button', attrs: 'data-news-add', tone: 'green', icon: 'calendarPlus', title: 'เพิ่มลงปฏิทิน' }) : ''}
          ${sheetRow({ tag: 'button', attrs: 'data-news-share', tone: 'indigo', icon: 'share', title: 'แชร์ลิงก์' })}
        </div></div>
        <p class="footnote">ที่มา: <span lang="de">${esc(sourceName(item.source))}</span> · แสดงเฉพาะสรุปสั้น ฉบับเต็มอยู่ที่เว็บไซต์ของเมือง หากคำแปลไม่ตรงกับต้นฉบับ ให้ยึดตามภาษาเยอรมัน</p>`,
    });
  }

  function addToCalendar() {
    if (!current?.start) return;
    const ics = buildEventIcs(current, sourceName(current.source));
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `event-${current.start.slice(0, 10)}.ics` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('เพิ่มกิจกรรมลงปฏิทินแล้ว — ตรวจดูในแอปปฏิทิน');
  }

  async function share() {
    const original = current && trusted(current.url);
    if (!original) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.title, url: original });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return; // the user closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(`${current.title}\n${original}`);
      toast('คัดลอกลิงก์แล้ว — วางส่งต่อได้เลย');
    } catch {
      toast('แชร์ไม่ได้บนอุปกรณ์นี้');
    }
  }

  document.querySelector('#sheet-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-news-add]')) addToCalendar();
    else if (e.target.closest('[data-news-share]')) share();
  });

  root.addEventListener('click', (e) => {
    const hit = (selector) => e.target.closest(selector);
    let focus = null;
    if (hit('[data-news-open]')) {
      haptic(6);
      openItem(hit('[data-news-open]').dataset.newsOpen, hit('[data-news-open]'));
      return;
    }
    if (hit('[data-news-kind]')) {
      view.kind = hit('[data-news-kind]').dataset.newsKind;
      view.source = 'all';
      focus = `[data-news-kind="${view.kind}"]`;
    } else if (hit('[data-news-source]')) {
      view.source = hit('[data-news-source]').dataset.newsSource;
      focus = `[data-news-source="${view.source}"]`;
    } else {
      return;
    }
    haptic(5);
    render();
    root.querySelector(focus)?.focus({ preventScroll: true });
  });

  async function load() {
    try {
      const res = await fetch('data/news.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`news.json: HTTP ${res.status}`);
      const next = await res.json();
      failed = false;
      if (JSON.stringify(next) !== JSON.stringify(data)) {
        data = next;
        render();
      }
    } catch {
      failed = !data;
      if (failed) render();
    }
  }

  render();
  load();
  return { refresh: load };
}
