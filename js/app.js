// © 2026 Phramaha Egkarach. All rights reserved. Not licensed for copying or reuse; see LICENSE.
import { GROUPS, binInfo, isEnabled, needsBinOut, sortBins } from './bins.js';
import {
  MONTHS, MONTHS_SHORT, WEEKDAYS, WEEKDAYS_SHORT,
  addDays, daysInMonth, diffDays, longDate, makeIso, parts, relative, shortDate, weekday,
} from './dates.js';
import { buildDayIcs } from './ics.js';
import { groupGlyph, groupIcon, uiIcon } from './icons.js';
import { pathsOf, pdfFromCanvas, renderSheet } from './pdf.js';
import { initScene } from './scene.js';
import { effectiveTheme, getPreference, getTextSize, onThemeChange, setPreference, setTextSize } from './prefs.js';
import { haptic, initPullToRefresh, initSheet, initTabs, installInfo, onInstallChange, promptInstall, toast } from './shell.js';

const BIN_OUT_BY = 6 * 60 + 30; // bins must be at the kerb by 06:30
const COLLECTION_END = 16 * 60 + 30; // AWB's calendar blocks the collection window until 16:30
const UPCOMING_COUNT = 4;
const STORAGE_KEY = 'waste.hiddenGroups';
const INSTALL_DISMISSED_KEY = 'waste.installDismissedAt';
const STALE_AFTER_MS = 30 * 60 * 1000; // re-check the schedule when the app returns after half an hour

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);

/* ---------- clock: always the configured timezone (Europe/Berlin), never the viewer's ---------- */
function getClock(timeZone) {
  const q = new URLSearchParams(location.search);
  const forcedDate = /^\d{4}-\d{2}-\d{2}$/.test(q.get('today') ?? '') ? q.get('today') : null;
  const forcedTime = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') ?? '');
  if (forcedDate || forcedTime) {
    const real = realClock(timeZone);
    return {
      date: forcedDate ?? real.date,
      minutes: forcedTime ? Number(forcedTime[1]) * 60 + Number(forcedTime[2]) : forcedDate ? 12 * 60 : real.minutes,
      forced: true,
    };
  }
  return { ...realClock(timeZone), forced: false };
}

function realClock(timeZone) {
  const f = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${f.year}-${f.month}-${f.day}`, minutes: Number(f.hour) * 60 + Number(f.minute) };
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/* ---------- state ---------- */
const state = {
  config: null, data: null, announcements: [], clock: null, view: null, selected: null,
  hidden: new Set(), dates: [], heroDates: new Set(), loadedAt: 0, shell: {}, scene: null, pdf: null, guide: { os: 'android', browser: 'chrome' },
};

function loadHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}
function saveHidden() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.hidden]));
  } catch {}
}

/* ---------- data access ---------- */
function binsOn(date, { filtered = false } = {}) {
  const keys = (state.data.days[date] ?? []).filter((k) => isEnabled(state.config, k));
  const list = sortBins(keys).map(binInfo);
  return filtered ? list.filter((b) => !state.hidden.has(b.group)) : list;
}

function groupBins(bins) {
  const map = new Map();
  for (const b of bins) {
    if (!map.has(b.group)) map.set(b.group, { group: b.group, th: b.th, items: [] });
    map.get(b.group).items.push(b);
  }
  return [...map.values()];
}

function nextDateAfter(date) {
  return state.dates.find((d) => d > date && binsOn(d).length > 0) ?? null;
}

/* ---------- shared markup ---------- */
const chev = () => `<span class="chev">${uiIcon('chevronRight', 'bold')}</span>`;
const tile = (group) => `<span class="ico-tile" data-group="${group}">${groupIcon(group)}</span>`;
const awbLink = (text = 'AWB') => {
  const url = safeUrl(state.config.source.awbUrl);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : '';
};

// A settings-style row: coloured tile, title, optional one-line subtitle, optional chevron.
// `tag` is 'a' or 'button' (never a block element inside, so it stays valid HTML).
function actionRow({ tag = 'button', attrs = '', tone, icon, title, sub = '', arrow = true }) {
  return `<${tag} class="row row-link" ${tag === 'button' ? 'type="button"' : ''} ${attrs}>
    <span class="ico-tile" data-tone="${tone}">${uiIcon(icon, 'fill')}</span>
    <span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>
    ${arrow ? chev() : ''}
  </${tag}>`;
}

// One row per waste group. Compact by default (Thai + German name); `detailed` adds size / frequency.
function binRowsHtml(bins, { detailed = false } = {}) {
  return `<ul class="rows">${groupBins(bins)
    .map((g) => {
      const note = g.items.find((b) => b.note)?.note;
      const subs = detailed
        ? g.items.map((b) => `${esc(b.de)}${b.detail ? ` · ${esc(b.detail)}` : ''}`)
        : [esc([...new Set(g.items.map((b) => b.de))].join(' · '))];
      return `<li class="row" data-group="${g.group}">
        ${tile(g.group)}
        <div class="row-main">
          <p class="row-title">${esc(g.th)}</p>
          ${subs.map((s) => `<p class="row-sub">${s}</p>`).join('')}
          ${note ? `<p class="row-sub row-note">${esc(note)} · ${awbLink()}</p>` : ''}
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

// A friendly wheelie bin in its group's colour, with the group's glyph on the front.
// Colours come from CSS (--g / --g-fg set by [data-group]), so it follows light and dark mode.
function binArt(group) {
  return `<svg class="bin-art" viewBox="0 0 72 86" aria-hidden="true" focusable="false">
    <ellipse class="bin-shadow" cx="36" cy="82" rx="27" ry="4"/>
    <circle class="bin-wheel" cx="22" cy="77" r="5"/><circle class="bin-wheel" cx="50" cy="77" r="5"/>
    <path class="bin-body" d="M12 25h48l-5 49.5q-.4 3.5-3.9 3.5H20.9q-3.5 0-3.9-3.5z"/>
    <path class="bin-shine" d="M14.6 29h6.4l2.2 41h-3.9z"/>
    <rect class="bin-lid" x="7" y="13" width="58" height="14" rx="6.5"/>
    <rect class="bin-handle" x="25" y="6" width="22" height="9" rx="4.5"/>
    <g class="bin-face"><g class="bin-eyes"><ellipse cx="28.5" cy="38.5" rx="2.4" ry="3.1"/><ellipse cx="43.5" cy="38.5" rx="2.4" ry="3.1"/></g><path d="M31.5 44.5q4.5 4.2 9 0"/><ellipse class="blush" cx="23.2" cy="44" rx="3.3" ry="2"/><ellipse class="blush" cx="48.8" cy="44" rx="3.3" ry="2"/></g>
    <svg class="bin-glyph" x="26" y="52" width="20" height="20" viewBox="0 0 256 256" fill="currentColor">${groupGlyph(group)}</svg>
  </svg>`;
}

// The bins to put out, standing in a row. `bare` = pictures only (decorative), `onCard` = for a light background.
function lineupHtml(bins, { bare = false, onCard = false } = {}) {
  const items = groupBins(bins)
    .map((g, i) => `<li class="lineup-item" data-group="${g.group}" style="--i:${i}">${binArt(g.group)}${
      bare ? '' : `<span class="lineup-name">${esc(GROUPS[g.group].short)}</span><span class="lineup-de">${esc(GROUPS[g.group].de)}</span>`
    }</li>`)
    .join('');
  return `<ul class="lineup${bare ? ' is-bare' : ''}${onCard ? ' on-card' : ''}"${bare ? ' aria-hidden="true"' : ''}>${items}</ul>`;
}

const greeting = (minutes) =>
  minutes >= 5 * 60 && minutes < 11 * 60 ? 'สวัสดีตอนเช้า'
    : minutes >= 11 * 60 && minutes < 16 * 60 ? 'สวัสดีตอนบ่าย'
      : minutes >= 16 * 60 && minutes < 19 * 60 ? 'สวัสดีตอนเย็น'
        : 'สวัสดีตอนค่ำ';

// "Good evening · 11° · ฟ้าครึ้ม": the weather part appears once the sky knows it
function renderGreeting() {
  $('#greeting').textContent = [greeting(state.clock.minutes), state.scene?.label()].filter(Boolean).join(' · ');
}

/* ---------- rendering: Today ---------- */
function heroHtml({ action, eyebrow, title, sub, date, bins, more, shareDate, detailDate }) {
  const note = bins?.find((b) => b.note)?.note;
  return `<div class="hero-card${action ? ' is-action' : ''}">
    <div class="hero-top">
      <div class="hero-head">
        <p class="hero-eyebrow">${eyebrow}</p>
        ${shareDate ? `<button type="button" class="hero-share" data-share-date="${shareDate}" aria-label="แชร์วันเก็บนี้">${uiIcon('share')}</button>` : ''}
      </div>
      <h2 class="hero-title">${title}</h2>
      ${sub ? `<p class="hero-sub">${sub}</p>` : ''}
      ${date ? `<p class="hero-date">${date}</p>` : ''}
      ${bins ? lineupHtml(bins, { onCard: !action }) : ''}
      ${note ? `<p class="hero-note">${esc(note)} · ${awbLink()}</p>` : ''}
    </div>
    ${detailDate ? `<button type="button" class="row row-link row-all hero-detail" data-open="${detailDate}"><span class="row-main"><span class="row-title">ดูรายละเอียด</span></span>${chev()}</button>` : ''}
    ${more ? `<div class="hero-more"><p class="hero-more-title">${more.title}</p>${lineupHtml(more.bins, { onCard: true })}</div>` : ''}
  </div>`;
}

function renderHero() {
  const { date: today, minutes } = state.clock;
  const tomorrow = addDays(today, 1);
  const todayBins = binsOn(today);
  const tomorrowBins = binsOn(tomorrow);
  const awb = awbLink('ดูที่ AWB');
  const seeAwb = 'ดูเวลาและจุดรับที่เว็บไซต์ AWB';
  let html;
  state.heroDates = new Set(); // the list below skips what the hero card already shows

  if (todayBins.length && minutes < COLLECTION_END) {
    state.heroDates.add(today);
    if (tomorrowBins.length) state.heroDates.add(tomorrow);
    const out = needsBinOut(todayBins);
    html = heroHtml({
      action: true,
      eyebrow: 'วันนี้',
      title: out ? 'วันเก็บขยะ' : 'รอบเก็บขยะอันตราย',
      sub: !out ? seeAwb : minutes < BIN_OUT_BY ? 'วางที่จุดรับก่อน 06:30 น.' : 'ถังต้องอยู่ที่จุดรับแล้ว · รถอาจมาเมื่อไรก็ได้',
      date: longDate(today),
      bins: todayBins,
      shareDate: today,
      detailDate: today,
      more: tomorrowBins.length ? { title: `พรุ่งนี้ก็มีเก็บ · ${longDate(tomorrow)}`, bins: tomorrowBins } : null,
    });
  } else if (tomorrowBins.length) {
    state.heroDates.add(tomorrow);
    const out = needsBinOut(tomorrowBins);
    html = heroHtml({
      action: true,
      eyebrow: 'คืนนี้',
      title: out ? 'นำถังออกวาง' : 'พรุ่งนี้มีรอบเก็บขยะอันตราย',
      sub: out ? 'วางที่จุดรับก่อน 06:30 น. พรุ่งนี้เช้า' : seeAwb,
      date: `พรุ่งนี้ · ${longDate(tomorrow)}`,
      bins: tomorrowBins,
      shareDate: tomorrow,
      detailDate: tomorrow,
    });
  } else {
    const next = nextDateAfter(today);
    if (next) {
      state.heroDates.add(next);
      const nextBins = binsOn(next);
      html = heroHtml({
        eyebrow: 'ครั้งถัดไป',
        title: relative(diffDays(today, next)),
        sub: needsBinOut(nextBins) ? 'วางที่จุดรับก่อน 06:30 น. ของวันเก็บ' : seeAwb,
        date: longDate(next),
        bins: nextBins,
        shareDate: next,
        detailDate: next,
      });
    } else {
      html = heroHtml({
        eyebrow: 'ยังไม่มีข้อมูล',
        title: 'ยังไม่มีกำหนดเก็บ',
        sub: `ตารางปีถัดไปยังไม่ประกาศ — AWB มักประกาศช่วงพฤศจิกายน${awb ? ` · ${awb}` : ''}`,
      });
    }
  }
  $('#hero').innerHTML = html;
}

// The next seven days at a glance, one coloured dot per kind of waste.
function renderWeek() {
  const { date: today } = state.clock;
  $('#week-section').hidden = !state.dates.length;
  $('#week').innerHTML = `<div class="week">${Array.from({ length: 7 }, (_, i) => addDays(today, i))
    .map((d) => {
      const groups = groupBins(binsOn(d, { filtered: true }));
      const label = `${longDate(d)}${groups.length ? `: ${groups.map((g) => g.th).join(', ')}` : ': ไม่มีเก็บขยะ'}`;
      const inner = `<span class="wk-name">${WEEKDAYS_SHORT[weekday(d)]}</span><span class="wk-num">${parts(d).d}</span>
        <span class="wk-dots" aria-hidden="true">${groups.map((g) => `<i data-group="${g.group}"></i>`).join('')}</span>`;
      const cls = `wk${groups.length ? ' has' : ''}${d === today ? ' is-today' : ''}`;
      return groups.length
        ? `<button type="button" class="${cls}" data-open="${d}" aria-label="${esc(label)}">${inner}</button>`
        : `<div class="${cls}" role="img" aria-label="${esc(label)}">${inner}</div>`;
    })
    .join('')}</div>`;
}

function renderUpcoming() {
  const { date: today } = state.clock;
  const rows = [];
  for (const d of state.dates) {
    if (d <= today || state.heroDates.has(d)) continue; // today is either in the hero or already collected
    const bins = binsOn(d, { filtered: true });
    if (!bins.length) continue;
    const { d: day, m } = parts(d);
    // phrasing content only inside <button>, so spans rather than div / p / ul
    rows.push(`<li class="row-wrap"><button type="button" class="row row-link up-row" data-open="${d}">
      <span class="date-icon" aria-hidden="true"><span class="wd">${WEEKDAYS_SHORT[weekday(d)]}</span><span class="dn">${day}</span></span>
      <span class="row-main">
        <span class="up-top"><span class="up-when">วัน${WEEKDAYS[weekday(d)]} ${day} ${MONTHS_SHORT[m - 1]}</span><span class="up-rel">${relative(diffDays(today, d))}</span></span>
        <span class="up-tags">${groupBins(bins).map((g) => `<span class="tag" data-group="${g.group}">${esc(GROUPS[g.group].short)}</span>`).join('')}</span>
      </span>${chev()}
    </button></li>`);
    if (rows.length === UPCOMING_COUNT) break;
  }
  // Nothing to list and the hero already says "no data": hide the whole section instead of repeating it.
  const section = $('#upcoming').closest('section');
  section.hidden = !rows.length && !state.heroDates.size && !state.hidden.size;
  let html;
  if (rows.length) {
    rows.push(`<li class="row-wrap row-wrap-all"><button type="button" class="row row-link row-all" data-goto="calendar">
      <span class="row-main"><span class="row-title">ดูทั้งหมดในปฏิทิน</span></span>${chev()}
    </button></li>`);
    html = `<ol class="rows">${rows.join('')}</ol>`;
  } else {
    html = `<p class="empty">ยังไม่มีกำหนดเก็บเพิ่มเติม${state.hidden.size ? ' (ตอนนี้ซ่อนบางประเภทด้วยตัวกรองในปฏิทิน)' : ''}</p>`;
  }
  const lastYear = state.data.years.at(-1);
  if (rows.length - 1 < UPCOMING_COUNT && lastYear) {
    html += `<p class="footnote list-foot">ข้อมูลครอบคลุมถึงสิ้นปี ${lastYear} — ตารางปี ${lastYear + 1} ยังไม่ประกาศ (AWB มักประกาศช่วงพฤศจิกายน) หน้านี้จะอัปเดตเองเมื่อประกาศแล้ว</p>`;
  }
  $('#upcoming').innerHTML = html;
}

function renderAnnouncements() {
  const today = state.clock.date;
  const active = state.announcements.filter((a) => (!a.from || a.from <= today) && (!a.until || a.until >= today));
  $('#announcements').innerHTML = active
    .map((a) => {
      const warning = a.type === 'warning';
      const link = safeUrl(a.link?.url);
      return `<div class="banner${warning ? ' is-warning' : ''}" role="note">
        <span class="ico-tile">${uiIcon(warning ? 'problem' : 'info', 'fill')}</span>
        <div>
          ${a.title ? `<p class="banner-title">${esc(a.title)}</p>` : ''}
          ${a.body ? `<p class="banner-body">${esc(a.body).replace(/\n/g, '<br>')}</p>` : ''}
          ${link ? `<p class="banner-body"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(a.link.text || 'รายละเอียด')}</a></p>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

/* ---------- rendering: Calendar ---------- */
function renderChips() {
  const present = new Set();
  for (const d of state.dates) for (const b of binsOn(d)) present.add(b.group);
  $('#chips').innerHTML = Object.keys(GROUPS)
    .filter((g) => present.has(g))
    .map((g) => `<button type="button" class="chip" data-group="${g}" data-chip="${g}" aria-label="${esc(GROUPS[g].th)}" aria-pressed="${!state.hidden.has(g)}"><span class="chip-ico">${groupIcon(g)}</span>${esc(GROUPS[g].short)}</button>`)
    .join('');
}

function renderCalendar() {
  const { y, m } = state.view;
  const { date: today } = state.clock;
  const years = state.data.years;
  const t = parts(today);
  $('#cal-title').textContent = `${MONTHS[m - 1]} ${y}`;
  $('#goto-today').hidden = t.y === y && t.m === m; // only shown when you've wandered off
  $('#prev').disabled = !years.length || makeIso(y, m, 1) <= makeIso(years[0], 1, 1);
  $('#next').disabled = !years.length || y * 12 + m >= (years.at(-1) + 1) * 12 + 12;

  $('#cal-notice').innerHTML = years.includes(y)
    ? ''
    : `<p class="cal-notice">${uiIcon('info')}<span>ตารางปี ${y} ยังไม่ประกาศ — AWB มักประกาศช่วงพฤศจิกายน หน้านี้จะแสดงข้อมูลให้เองเมื่อประกาศแล้ว</span></p>`;

  const lead = (weekday(makeIso(y, m, 1)) + 6) % 7; // weeks start on Monday, as in Germany
  const cells = Array.from({ length: lead }, () => '<span class="day blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const date = makeIso(y, m, day);
    const groups = groupBins(binsOn(date, { filtered: true }));
    const label = `${day} ${MONTHS[m - 1]}${groups.length ? `: ${groups.map((g) => g.th).join(', ')}` : ': ไม่มีเก็บขยะ'}`;
    cells.push(`<button type="button" class="day${groups.length ? ' has' : ''}${date === today ? ' is-today' : ''}${date === state.selected ? ' is-selected' : ''}" data-date="${date}" aria-label="${esc(label)}" aria-pressed="${date === state.selected}">
      <span class="num">${day}</span>
      <span class="dots" aria-hidden="true">${groups.map((g) => `<i data-group="${g.group}"></i>`).join('')}</span>
    </button>`);
  }
  $('#grid').innerHTML = cells.join('');
  renderMonthSummary();
}

// "This month": how many times each kind of waste is collected, with the bins drawn again.
function renderMonthSummary() {
  const { y, m } = state.view;
  const counts = new Map();
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    for (const g of groupBins(binsOn(makeIso(y, m, day)))) counts.set(g.group, (counts.get(g.group) ?? 0) + 1);
  }
  const section = $('#month-summary');
  section.hidden = counts.size === 0;
  if (!counts.size) return;
  $('#h-month').textContent = `สรุปเดือน${MONTHS[m - 1]}`;
  $('#month-summary-card').innerHTML = `<ul class="lineup on-card">${Object.keys(GROUPS)
    .filter((g) => counts.has(g))
    .map((g, i) => `<li class="lineup-item" data-group="${g}" style="--i:${i}">${binArt(g)}<span class="lineup-name">${counts.get(g)} ครั้ง</span><span class="lineup-de">${esc(GROUPS[g].short)}</span></li>`)
    .join('')}</ul>`;
}

// Day details live in a bottom sheet, like a native detail view.
function openDay(date, trigger) {
  const bins = binsOn(date);
  const delta = diffDays(state.clock.date, date);
  const actions = bins.length
    ? `<div class="card"><div class="rows">
        ${actionRow({ attrs: `data-share-date="${date}"`, tone: 'blue', icon: 'share', title: 'แชร์วันเก็บนี้', arrow: false })}
        ${actionRow({ attrs: `data-add-date="${date}"`, tone: 'green', icon: 'calendarPlus', title: 'เพิ่มลงปฏิทิน', arrow: false })}
      </div></div>`
    : '';
  state.shell.sheet.open({
    title: `${longDate(date)} ${parts(date).y}`,
    meta: delta >= 0 && delta <= 2 ? relative(delta) : '',
    html: bins.length ? `<div class="sheet-bins">${lineupHtml(bins, { bare: true, onCard: true })}</div><div class="card">${binRowsHtml(bins, { detailed: true })}</div>${actions}` : '<p class="empty">ไม่มีการเก็บขยะในวันนี้</p>',
    trigger,
  });
}

/* ---------- share & add to calendar ---------- */
const appUrl = () => new URL('.', location.href).href; // the app's folder, without debug query strings

function summaryText(date) {
  const delta = diffDays(state.clock.date, date);
  const when = delta === 0 ? 'วันนี้' : delta === 1 ? 'พรุ่งนี้' : '';
  const bins = binsOn(date);
  const rule = needsBinOut(bins) ? 'วางถังที่จุดรับก่อน 06:30 น.' : 'ดูเวลาและจุดรับที่เว็บไซต์ AWB';
  return `${when ? `${when} ` : ''}${longDate(date)} เก็บ: ${groupBins(bins).map((g) => g.th).join(', ')}\n${rule}`;
}

// Native share sheet where there is one (LINE, Messages, …), otherwise copy to the clipboard.
async function share(text) {
  const { siteTitle, orgName } = state.config;
  const url = appUrl();
  try {
    if (navigator.share) {
      await navigator.share({ title: `${siteTitle} · ${orgName}`, text, url });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // the user closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('คัดลอกข้อความแล้ว — วางส่งต่อได้เลย');
  } catch {
    toast('แชร์ไม่ได้บนอุปกรณ์นี้');
  }
}

const shareDay = (date) => share(summaryText(date));
function shareApp() {
  const target = [...state.heroDates].sort()[0] ?? nextDateAfter(state.clock.date);
  return share(`${state.config.siteTitle} · ${state.config.orgName}${target ? `\n${summaryText(target)}` : ''}`);
}

// One event with the 18:00 evening-before reminder; iOS opens its "add event" screen, others download it.
function addDayToCalendar(date) {
  const ics = buildDayIcs(date, state.data.days[date] ?? [], state.config);
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `waste-${date}.ics` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('เพิ่มวันนี้ลงปฏิทินแล้ว — ตรวจดูในแอปปฏิทิน');
}

/* ---------- rendering: More ---------- */
const THEME_OPTIONS = [
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
  { value: 'auto', label: 'อัตโนมัติ' },
];
const TEXT_OPTIONS = [
  { value: 'normal', label: 'ปกติ' },
  { value: 'large', label: 'ใหญ่' },
  { value: 'xlarge', label: 'ใหญ่มาก' },
];

// Mini phone mock-ups; "automatic" shows both, split diagonally.
function themePreview(value) {
  const mock = (kind, extra = '') => `<span class="pv ${extra}" data-k="${kind}"><i></i><i></i><i></i><i></i></span>`;
  return `<span class="theme-preview">${value === 'auto' ? mock('light') + mock('dark', 'is-half') : mock(value)}</span>`;
}

function renderAppearance() {
  const theme = getPreference();
  const size = getTextSize();
  $('#appearance').innerHTML = `
    <div class="setting">
      <div class="setting-label"><span class="ico-tile" data-tone="dark">${uiIcon('moon', 'fill')}</span><span id="theme-label">โหมดสี</span></div>
      <div class="theme-picker" role="radiogroup" aria-labelledby="theme-label">${THEME_OPTIONS.map(
        ({ value, label }) => `<button type="button" class="theme-opt" role="radio" aria-checked="${value === theme}" data-theme-opt="${value}">
          ${themePreview(value)}<span>${label}</span><span class="theme-check">${uiIcon('check', 'bold')}</span>
        </button>`,
      ).join('')}</div>
    </div>
    <div class="setting">
      <div class="setting-label"><span class="ico-tile" data-tone="indigo">${uiIcon('textSize', 'fill')}</span><span id="size-label">ขนาดตัวอักษร</span></div>
      <div class="seg" role="radiogroup" aria-labelledby="size-label">${TEXT_OPTIONS.map(
        ({ value, label }) => `<button type="button" role="radio" aria-checked="${value === size}" data-size-opt="${value}">${label}</button>`,
      ).join('')}</div>
    </div>`;
}

// The round button in the navigation bar flips between light and dark in one tap.
function renderThemeToggle() {
  const dark = effectiveTheme() === 'dark';
  const button = $('#theme-toggle');
  button.innerHTML = uiIcon(dark ? 'sun' : 'moon', 'fill');
  button.setAttribute('aria-label', dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
}

function renderShare() {
  const ics = new URL('data/calendar.ics', location.href);
  const webcal = ics.href.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  $('#share').innerHTML = `<div class="rows">
    ${actionRow({ attrs: 'data-share-app', tone: 'blue', icon: 'share', title: 'แชร์ตารางนี้', sub: 'ส่งลิงก์และวันเก็บถัดไปให้เพื่อน' })}
    ${actionRow({ tag: 'a', attrs: `href="${esc(webcal)}"`, tone: 'green', icon: 'calendar', title: 'Apple / Outlook', sub: 'ติดตามอัตโนมัติ · เตือน 18:00 น.' })}
    ${actionRow({ tag: 'a', attrs: `href="${esc(google)}" target="_blank" rel="noopener"`, tone: 'blue', icon: 'calendar', title: 'Google Calendar', sub: 'ติดตามอัตโนมัติ · ไม่มีเตือน' })}
    ${actionRow({ tag: 'a', attrs: `href="${esc(ics.href)}" download="ตารางเก็บขยะ.ics"`, tone: 'gray', icon: 'download', title: 'ดาวน์โหลดไฟล์ .ics', sub: 'นำเข้าครั้งเดียว' })}
    ${actionRow({ attrs: 'id="btn-print"', tone: 'dark', icon: 'printer', title: 'พิมพ์ตารางทั้งปี', sub: 'A4 หน้าเดียว · บันทึกเป็น PDF ได้' })}
    ${actionRow({ attrs: 'data-pdf', tone: 'blue', icon: 'share', title: 'ส่งตารางทั้งปีเป็น PDF', sub: 'แชร์ผ่าน LINE หรือสั่งพิมพ์ได้ทุกเครื่อง' })}
  </div>`;
}

// Settings-style header: the app icon, who it is for and where.
function renderProfile() {
  const { config } = state;
  const a = config.address;
  $('#profile').innerHTML = `<div class="profile-row">
    <img class="profile-icon" src="icons/icon-192.png" alt="" width="64" height="64">
    <div class="row-main">
      <p class="profile-name">${esc(config.orgName)}</p>
      <p class="row-sub">${esc(a.strasse)} ${esc(a.hausnr)} · ${esc(a.plz)} ${esc(a.ort)}</p>
    </div>
  </div>`;
}

function renderAbout() {
  const { config, data } = state;
  const updated = data.fetchedAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.fetchedAt))
    : null;
  const kv = (label, value) => `<li class="row kv"><span>${label}</span><span>${value}</span></li>`;
  $('#about').innerHTML = `<ul class="rows">
    ${kv('ข้อมูลจาก', awbLink('AWB Landkreis Augsburg') || 'AWB Landkreis Augsburg')}
    ${kv('ปีที่มีข้อมูล', esc(data.years.join(', ') || '–'))}
    ${updated ? kv('ตารางอัปเดตล่าสุด', shortDate(updated)) : ''}
    ${config.credits?.developer ? kv('พัฒนาโดย', esc(config.credits.developer)) : ''}
  </ul>`;
  $('#source-note').textContent = 'เว็บนี้จัดทำขึ้นเอง ไม่ใช่เว็บไซต์ทางการของ AWB — หากวันที่ไม่ตรงกัน ให้ยึดตามประกาศของ AWB';
}

/* ---------- install ("Add to Home Screen") ---------- */
const installDismissed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(INSTALL_DISMISSED_KEY)) < 30 * 86400000;
  } catch {
    return false;
  }
};

function renderInstall() {
  const info = installInfo();
  if (info.standalone) {
    $('#install').innerHTML = '';
    $('#install-banner').innerHTML = '';
    return;
  }
  $('#install').innerHTML = `<h2 class="section-title">ติดตั้งเป็นแอป</h2>
    <div class="card"><div class="rows">
      ${actionRow({ attrs: 'data-install', tone: 'green', icon: 'phone', title: 'เพิ่มไว้ที่หน้าจอโฮม', sub: 'เปิดเร็ว ใช้ออฟไลน์ได้' })}
      ${actionRow({ attrs: 'data-install-guide', tone: 'gray', icon: 'info', title: 'วิธีติดตั้งทีละขั้น', sub: 'Android และ iPhone' })}
    </div></div>`;

  // a one-time nudge on phones only; the row above is always there
  const nudge = (info.native || info.ios || info.android) && matchMedia('(pointer: coarse)').matches && !installDismissed();
  $('#install-banner').innerHTML = nudge
    ? `<div class="install-banner">
        <span class="ico-tile" data-tone="green">${uiIcon('phone', 'fill')}</span>
        <span class="row-main"><span class="row-title">ติดตั้งเป็นแอป</span><span class="row-sub">เปิดเร็ว ใช้ออฟไลน์ได้</span></span>
        <button type="button" class="pill-btn" data-install>ติดตั้ง</button>
        <button type="button" class="icon-btn" data-dismiss-install aria-label="ปิด">${uiIcon('close', 'bold')}</button>
      </div>`
    : '';
}

// Where to tap, per browser. Button names vary a little with the phone's language and version.
const ANDROID_STEPS = {
  chrome: [
    `แตะเมนูสามจุด ${uiIcon('moreVertical')} ที่มุมขวาบนของ Chrome`,
    'เลือก <strong>ติดตั้งแอป</strong> (บางรุ่นเขียนว่า <strong>เพิ่มไปยังหน้าจอหลัก</strong> แล้วเลือก "ติดตั้ง")',
    'แตะ <strong>ติดตั้ง</strong> เพื่อยืนยัน',
  ],
  samsung: [
    `แตะเมนูสามขีด ${uiIcon('menuLines')} ที่มุมขวาล่างของ Samsung Internet`,
    'เลือก <strong>เพิ่มหน้านี้ไปยัง</strong> แล้วเลือก <strong>หน้าจอหลัก</strong>',
    'แตะ <strong>เพิ่ม</strong> เพื่อยืนยัน',
  ],
  firefox: [
    `แตะเมนูสามจุด ${uiIcon('moreVertical')} ที่มุมขวาบนของ Firefox`,
    'เลือก <strong>ติดตั้ง</strong>',
    'แตะ <strong>เพิ่มไปยังหน้าจอโฮม</strong> เพื่อยืนยัน',
  ],
};
const IOS_STEPS = [
  `แตะปุ่ม <strong>แชร์</strong> ${uiIcon('share')} ที่แถบล่างของ Safari`,
  `เลื่อนลงแล้วเลือก <strong>เพิ่มไปยังหน้าจอโฮม</strong> ${uiIcon('plusSquare')}`,
  'แตะ <strong>เพิ่ม</strong> ที่มุมขวาบน',
];
const ANDROID_BROWSERS = [['chrome', 'Chrome'], ['samsung', 'Samsung'], ['firefox', 'Firefox']];

const segment = (label, attr, current, options) =>
  `<div class="seg guide-seg" role="radiogroup" aria-label="${label}">${options
    .map(([value, text]) => `<button type="button" role="radio" aria-checked="${value === current}" ${attr}="${value}">${text}</button>`)
    .join('')}</div>`;

const stepsHtml = (steps) => `<ol class="steps">${steps.map((step) => `<li><span>${step}</span></li>`).join('')}</ol>`;

function installGuideHtml({ os, browser }) {
  const osPicker = segment('ระบบของเครื่อง', 'data-guide-os', os, [['android', 'Android'], ['ios', 'iPhone / iPad']]);
  if (os === 'ios') {
    return `${osPicker}${stepsHtml(IOS_STEPS)}<p class="footnote">บน iPhone / iPad ต้องเปิดหน้านี้ด้วย Safari</p>`;
  }
  const oneTap = browser === 'chrome' && installInfo().native
    ? '<button type="button" class="pill-btn guide-go" data-install-now>ติดตั้งเลย</button>'
    : '';
  return `${osPicker}${segment('เบราว์เซอร์', 'data-guide-browser', browser, ANDROID_BROWSERS)}
    ${oneTap}${stepsHtml(ANDROID_STEPS[browser])}
    <div class="card guide-tips"><ul class="tips">
      <li>เสร็จแล้วจะมีไอคอน "เก็บเพชรพลอย" ที่หน้าจอโฮมและในลิ้นชักแอป เปิดได้เต็มจอเหมือนแอปทั่วไป</li>
      <li>กดค้างที่ไอคอนจะมีทางลัด "ปฏิทิน"</li>
      <li>ถอนการติดตั้งได้เหมือนแอปอื่น: กดค้างที่ไอคอน แล้วเลือก "ถอนการติดตั้ง"</li>
      <li>ไม่เห็นปุ่ม "ติดตั้งแอป" ให้ลองเปิดเว็บนี้ด้วย Chrome</li>
    </ul></div>`;
}

function openInstallGuide(trigger) {
  const info = installInfo();
  state.guide = { os: info.ios ? 'ios' : 'android', browser: info.browser };
  state.shell.sheet.open({ title: 'ติดตั้งเป็นแอป', meta: 'เปิดได้เหมือนแอป ใช้ออฟไลน์ได้', html: installGuideHtml(state.guide), trigger });
}

// the pickers inside the sheet redraw it in place
function updateInstallGuide(change, focusSelector) {
  state.guide = { ...state.guide, ...change };
  $('#sheet-body').innerHTML = installGuideHtml(state.guide);
  $(focusSelector)?.focus({ preventScroll: true });
}

async function startInstall(trigger) {
  if (installInfo().native) {
    if (await promptInstall()) toast('ติดตั้งแล้ว — เปิดจากหน้าจอโฮมได้เลย');
    return;
  }
  openInstallGuide(trigger);
}

/* ---------- print sheet ---------- */
// the whole year by month: feeds both the printed page and the PDF
function yearData(year) {
  const present = new Set();
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const days = [];
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = makeIso(year, m, d);
      const bins = binsOn(date);
      if (!bins.length) continue;
      const groups = groupBins(bins).map((g) => g.group);
      groups.forEach((g) => present.add(g));
      days.push({ label: `${WEEKDAYS_SHORT[weekday(date)]} ${d}`, groups });
    }
    months.push({ name: MONTHS[m - 1], days });
  }
  return { year, months, present };
}

function renderPrintSheet() {
  const { config, data } = state;
  const { year, months, present } = yearData(state.view.y);
  const monthsHtml = months.map(({ name, days }) => {
    const items = days.map(({ label, groups }) =>
      `<li><span class="dd">${label}</span><span>${groups.map((g) => `${groupIcon(g)} ${esc(GROUPS[g].short)}`).join(' · ')}</span></li>`);
    return `<div class="ps-month"><h2>${name}</h2>${items.length ? `<ul>${items.join('')}</ul>` : '<p>–</p>'}</div>`;
  });
  const legend = Object.keys(GROUPS)
    .filter((g) => present.has(g))
    .map((g) => `<span>${groupIcon(g)} <strong>${esc(GROUPS[g].short)}</strong> = ${esc(GROUPS[g].th)} (${esc(GROUPS[g].de)})</span>`)
    .join('');
  const a = config.address;
  $('#print-sheet').innerHTML = `
    <div class="ps-head">
      <div><h1>${esc(config.siteTitle)} ${year}</h1><p>${esc(config.orgName)} · ${esc(a.strasse)} ${esc(a.hausnr)}, ${esc(a.plz)} ${esc(a.ort)}</p></div>
      <p>วางถังที่จุดรับก่อน 06:30 น. ของวันเก็บ</p>
    </div>
    <div class="ps-legend">${legend}</div>
    ${data.years.includes(year) ? '' : `<p>ตารางปี ${year} ยังไม่ประกาศ</p>`}
    <div class="ps-months">${monthsHtml.join('')}</div>
    <p class="ps-foot">ข้อมูลจาก AWB Landkreis Augsburg · ${esc(config.source.awbUrl)} · พิมพ์เมื่อ ${shortDate(state.clock.date)}</p>`;
}

/* ---------- the year as a PDF (window.print() does nothing in an installed iPhone app) ---------- */
const PDF_COLORS = { restmuell: '#48484a', bio: '#8a5a2b', papier: '#0a60d6', wertstoff: '#b88600', problem: '#d92d20', other: '#48484a' };

function pdfSheetData() {
  const { config, data } = state;
  const { year, months, present } = yearData(state.view.y);
  const item = (g) => ({ text: GROUPS[g].short, color: PDF_COLORS[g] ?? PDF_COLORS.other, paths: pathsOf(groupGlyph(g)) });
  const a = config.address;
  return {
    title: `${config.siteTitle} ${year}`,
    subtitle: `${config.orgName} · ${a.strasse} ${a.hausnr}, ${a.plz} ${a.ort}`,
    note: 'วางถังที่จุดรับก่อน 06:30 น. ของวันเก็บ',
    months: months.map((m) => ({ name: m.name, days: m.days.map((d) => ({ label: d.label, items: d.groups.map(item) })) })),
    legend: Object.keys(GROUPS).filter((g) => present.has(g)).map((g) => ({ ...item(g), text: `${GROUPS[g].short} = ${GROUPS[g].th} (${GROUPS[g].de})` })),
    missing: data.years.includes(year) ? '' : `ตารางปี ${year} ยังไม่ประกาศ`,
    footer: `ข้อมูลจาก AWB Landkreis Augsburg · ${config.source.awbUrl} · สร้างเมื่อ ${shortDate(state.clock.date)}`,
  };
}

// Draw the page, wrap it in a PDF and show a preview. Sharing happens on a second tap, so the
// phone's share sheet is opened straight from a button press (browsers insist on that).
async function openYearPdf(trigger) {
  toast('กำลังสร้าง PDF…');
  try {
    const sheet = renderSheet(pdfSheetData());
    const bytes = await pdfFromCanvas(sheet);
    const year = state.view.y;
    state.pdf = { file: new File([bytes], `waste-schedule-${year}.pdf`, { type: 'application/pdf' }), year };
    const ios = installInfo().ios;
    state.shell.sheet.open({
      title: `ตารางปี ${year}`,
      meta: 'PDF · A4 หน้าเดียว',
      html: `<img class="pdf-preview" src="${sheet.toDataURL('image/jpeg', 0.8)}" alt="ตัวอย่างตารางทั้งปี ${year}">
        <div class="card"><div class="rows">
          ${actionRow({ attrs: 'data-pdf-share', tone: 'blue', icon: 'share', title: 'แชร์ / พิมพ์', sub: ios ? 'เลือก "พิมพ์" ในเมนูที่ขึ้นมา' : 'ส่งผ่าน LINE หรือเลือกพิมพ์', arrow: false })}
          ${actionRow({ attrs: 'data-pdf-save', tone: 'green', icon: 'download', title: 'บันทึกไฟล์ PDF', arrow: false })}
          ${ios ? '' : actionRow({ attrs: 'data-pdf-print', tone: 'dark', icon: 'printer', title: 'สั่งพิมพ์ทันที', sub: 'ถ้าเครื่องรองรับ', arrow: false })}
        </div></div>`,
      trigger,
    });
  } catch (err) {
    console.warn('pdf:', err);
    toast('สร้าง PDF ไม่สำเร็จ — ลองเปิดเว็บในเบราว์เซอร์แล้วพิมพ์อีกครั้ง');
  }
}

function savePdf() {
  const url = URL.createObjectURL(state.pdf.file);
  const link = Object.assign(document.createElement('a'), { href: url, download: state.pdf.file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('บันทึกไฟล์แล้ว — ดูในโฟลเดอร์ดาวน์โหลด');
}

async function sharePdf() {
  const { file, year } = state.pdf ?? {};
  if (!file) return;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${state.config.siteTitle} ${year}` });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // the user closed the share sheet
  }
  savePdf(); // this device cannot share files: save it instead
}

function renderAll() {
  renderGreeting();
  renderAnnouncements();
  renderHero();
  renderWeek();
  renderUpcoming();
  renderChips();
  renderCalendar();
  renderAbout();
  renderPrintSheet();
}

/* ---------- interaction ---------- */
// `dir` = -1 / 1: the grid slides in from that side, like paging a paper calendar.
function setView(y, m, dir = 0) {
  const before = state.view.y * 12 + state.view.m;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  state.view = { y, m };
  const t = parts(state.clock.date);
  state.selected = t.y === y && t.m === m ? state.clock.date : null;
  renderCalendar();
  renderPrintSheet();
  const way = dir || Math.sign(y * 12 + m - before);
  if (way) {
    const grid = $('#grid');
    grid.classList.remove('from-left', 'from-right');
    void grid.offsetWidth; // restart the animation
    grid.classList.add(way > 0 ? 'from-right' : 'from-left');
  }
}

function bindEvents() {
  $('#prev').addEventListener('click', () => { haptic(5); setView(state.view.y, state.view.m - 1, -1); });
  $('#next').addEventListener('click', () => { haptic(5); setView(state.view.y, state.view.m + 1, 1); });
  $('#goto-today').addEventListener('click', () => {
    const t = parts(state.clock.date);
    setView(t.y, t.m);
  });
  $('#grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    haptic(6);
    state.selected = cell.dataset.date;
    renderCalendar();
    openDay(state.selected, $('#grid .is-selected'));
  });
  // swipe the grid left / right to change month, like the Calendar app
  let touch = null;
  $('#grid').addEventListener('touchstart', (e) => { touch = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }; }, { passive: true });
  $('#grid').addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
      const button = dx < 0 ? $('#next') : $('#prev');
      if (!button.disabled) button.click();
    }
  });
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const g = chip.dataset.chip;
    if (state.hidden.has(g)) state.hidden.delete(g);
    else state.hidden.add(g);
    saveHidden();
    renderChips();
    renderUpcoming();
    renderCalendar();
    $(`[data-chip="${g}"]`)?.focus();
  });

  // one delegated handler for the buttons that appear on several screens and in the sheet
  document.addEventListener('click', (e) => {
    const hit = (selector) => e.target.closest(selector);
    if (hit('[data-open]')) {
      haptic(6);
      openDay(hit('[data-open]').dataset.open, hit('[data-open]'));
    } else if (hit('[data-share-date]')) shareDay(hit('[data-share-date]').dataset.shareDate);
    else if (hit('[data-add-date]')) addDayToCalendar(hit('[data-add-date]').dataset.addDate);
    else if (hit('[data-share-app]')) shareApp();
    else if (hit('[data-goto]')) state.shell.tabs.show(hit('[data-goto]').dataset.goto);
    else if (hit('[data-pdf-share]')) sharePdf();
    else if (hit('[data-pdf-save]')) savePdf();
    else if (hit('[data-pdf-print]')) {
      renderPrintSheet();
      window.print();
    } else if (hit('[data-pdf]')) openYearPdf(hit('[data-pdf]'));
    else if (hit('[data-install-guide]')) openInstallGuide(hit('[data-install-guide]'));
    else if (hit('[data-install]')) startInstall(hit('[data-install]'));
    else if (hit('[data-install-now]')) promptInstall().then((done) => done && (state.shell.sheet.close(), toast('ติดตั้งแล้ว — เปิดจากหน้าจอโฮมได้เลย')));
    else if (hit('[data-guide-os]')) {
      const os = hit('[data-guide-os]').dataset.guideOs;
      updateInstallGuide({ os }, `[data-guide-os="${os}"]`);
    } else if (hit('[data-guide-browser]')) {
      const browser = hit('[data-guide-browser]').dataset.guideBrowser;
      updateInstallGuide({ browser }, `[data-guide-browser="${browser}"]`);
    }
    else if (hit('[data-dismiss-install]')) {
      try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); } catch {}
      renderInstall();
    }
  });
  onInstallChange(renderInstall);
  $('#btn-print').addEventListener('click', (e) => {
    // window.print() is a dead button in an app installed to the home screen: hand over a PDF instead
    if (installInfo().standalone) return openYearPdf(e.currentTarget);
    renderPrintSheet();
    window.print();
  });

  // appearance: quick toggle in the navigation bar + the pickers on the More screen
  $('#theme-toggle').addEventListener('click', () => {
    haptic(8);
    setPreference(effectiveTheme() === 'dark' ? 'light' : 'dark');
    renderAppearance();
  });
  $('#appearance').addEventListener('click', (e) => {
    const theme = e.target.closest('[data-theme-opt]');
    const size = e.target.closest('[data-size-opt]');
    if (theme) setPreference(theme.dataset.themeOpt);
    else if (size) setTextSize(size.dataset.sizeOpt);
    else return;
    haptic(6);
    renderAppearance();
    $(`[data-theme-opt="${theme?.dataset.themeOpt}"], [data-size-opt="${size?.dataset.sizeOpt}"]`)?.focus();
  });
  onThemeChange(() => {
    renderThemeToggle();
    renderAppearance();
  });

  // The page can stay open for days: re-render when the date or the "collection is over" phase changes.
  const phase = () => `${state.clock.date}|${state.clock.minutes < COLLECTION_END}|${state.clock.minutes < BIN_OUT_BY}`;
  const refresh = () => {
    const before = phase();
    state.clock = getClock(state.config.timezone);
    renderGreeting();
    state.scene?.update();
    if (phase() !== before) {
      const t = parts(state.clock.date);
      state.view = { y: t.y, m: t.m };
      state.selected = state.clock.date;
      renderAll();
    }
  };
  setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    if (Date.now() - state.loadedAt > STALE_AFTER_MS) refreshData({ silent: true });
  });
  window.addEventListener('online', () => refreshData({ silent: true }));
  window.addEventListener('offline', () => toast('ออฟไลน์ — แสดงข้อมูลที่บันทึกไว้'));
}

/* ---------- boot ---------- */
async function loadJson(url, optional = false) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

async function fetchAll() {
  const [config, data, announcements] = await Promise.all([
    loadJson('config.json'),
    loadJson('data/collections.json'),
    loadJson('data/announcements.json', true),
  ]);
  return { config, data, announcements: Array.isArray(announcements) ? announcements : [] };
}

function applyData({ config, data, announcements }) {
  state.config = config;
  state.data = data;
  state.announcements = announcements;
  state.dates = Object.keys(data.days).sort();
}

// Used by pull-to-refresh, "back online" and "app returned after a while".
async function refreshData({ silent = false } = {}) {
  if (!navigator.onLine) {
    if (!silent) toast('ออฟไลน์อยู่ — แสดงข้อมูลที่บันทึกไว้');
    return;
  }
  try {
    const next = await fetchAll();
    const same = ['config', 'data', 'announcements'].every((k) => JSON.stringify(next[k]) === JSON.stringify(state[k]));
    state.loadedAt = Date.now();
    if (!same) {
      applyData(next);
      renderAll();
    }
    if (!silent) toast(same ? 'ตารางเป็นเวอร์ชันล่าสุดแล้ว' : 'อัปเดตตารางแล้ว');
  } catch {
    if (!silent) toast('อัปเดตไม่สำเร็จ — ใช้ข้อมูลที่บันทึกไว้');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Offline support and instant start once installed (see sw.js).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker:', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function main() {
  applyData(await fetchAll());
  const { config } = state;
  state.loadedAt = Date.now();
  state.hidden = loadHidden();
  state.clock = getClock(config.timezone);

  const t = parts(state.clock.date);
  state.view = { y: t.y, m: t.m };
  state.selected = state.clock.date;

  document.title = `${config.siteTitle} · ${config.orgName}`;
  $('#title').textContent = config.siteTitle;
  $('#org').textContent = config.orgName;
  $('#prev').innerHTML = uiIcon('chevronLeft', 'bold');
  $('#next').innerHTML = uiIcon('chevronRight', 'bold');
  if (state.clock.forced) {
    $('#debug').innerHTML = `<p class="debug">โหมดทดสอบ: วันที่ ${esc(state.clock.date)} เวลา ${hhmm(state.clock.minutes)} — เอา <code>?today=</code> ออกจาก URL เพื่อกลับเป็นเวลาจริง</p>`;
  }

  // a short entrance (cards rise in, bins pop up) on the first paint only; see "intro" in the CSS
  document.body.classList.add('intro');
  setTimeout(() => document.body.classList.remove('intro'), 1600);

  renderThemeToggle();
  renderProfile();
  renderAppearance();
  renderShare();
  renderInstall();
  renderAll();
  bindEvents();

  state.scene = initScene({ config, getClock: () => state.clock, onChange: renderGreeting });
  renderGreeting();
  state.shell.sheet = initSheet();
  state.shell.tabs = initTabs(location.hash.slice(1) || 'today');
  initPullToRefresh(() => Promise.all([refreshData(), sleep(700)]));
  registerServiceWorker();
}

main().catch((err) => {
  console.error(err);
  $('#app').innerHTML = `<div class="wrap"><div class="banner is-warning" role="alert" style="margin-top:80px"><div><p class="banner-title">โหลดตารางไม่สำเร็จ</p><p class="banner-body">ลองรีเฟรชหน้านี้อีกครั้ง หากยังไม่ได้ผล ให้ดูตารางที่เว็บไซต์ AWB โดยตรง</p></div></div></div>`;
});
