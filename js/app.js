import { GROUPS, binInfo, isEnabled, needsBinOut, sortBins } from './bins.js';
import {
  MONTHS, WEEKDAYS, WEEKDAYS_SHORT,
  addDays, daysInMonth, diffDays, longDate, makeIso, parts, relative, shortDate, weekday,
} from './dates.js';
import { groupIcon, uiIcon } from './icons.js';
import { haptic, initPullToRefresh, initSheet, initTabs, installInfo, onInstallChange, promptInstall, toast } from './shell.js';

const BIN_OUT_BY = 6 * 60 + 30; // bins must be at the kerb by 06:30
const COLLECTION_END = 16 * 60 + 30; // AWB's calendar blocks the collection window until 16:30
const UPCOMING_COUNT = 6;
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
  hidden: new Set(), dates: [], heroDates: new Set(), loadedAt: 0, shell: {},
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
const tile = (group, size = '') => `<span class="ico-tile ${size}" data-group="${group}">${groupIcon(group)}</span>`;
const awbLink = (text = 'AWB') => {
  const url = safeUrl(state.config.source.awbUrl);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : '';
};

// One row per waste group: coloured tile, Thai name, German name(s) + size / frequency.
function binRowsHtml(bins) {
  return `<ul class="rows">${groupBins(bins)
    .map((g) => {
      const note = g.items.find((b) => b.note)?.note;
      return `<li class="row" data-group="${g.group}">
        ${tile(g.group)}
        <div class="row-main">
          <p class="row-title">${esc(g.th)}</p>
          ${g.items.map((b) => `<p class="row-sub">${esc(b.de)}${b.detail ? ` · ${esc(b.detail)}` : ''}</p>`).join('')}
          ${note ? `<p class="row-sub row-note">${esc(note)} · ${awbLink()}</p>` : ''}
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

/* ---------- rendering ---------- */
function heroHtml({ action, eyebrow, title, sub, date, bins, more }) {
  return `<div class="hero-card${action ? ' is-action' : ''}">
    <div class="hero-top">
      <p class="hero-eyebrow">${eyebrow}</p>
      <h2 class="hero-title">${title}</h2>
      ${sub ? `<p class="hero-sub">${sub}</p>` : ''}
      ${date ? `<p class="hero-date">${date}</p>` : ''}
    </div>
    ${bins ? binRowsHtml(bins) : ''}
    ${more ? `<p class="hero-more-title">${more.title}</p>${binRowsHtml(more.bins)}` : ''}
  </div>`;
}

function renderHero() {
  const { date: today, minutes } = state.clock;
  const tomorrow = addDays(today, 1);
  const todayBins = binsOn(today);
  const tomorrowBins = binsOn(tomorrow);
  const awb = awbLink('ดูที่ AWB');
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
      sub: !out
        ? 'ดูเวลาและจุดรับที่เว็บไซต์ AWB'
        : minutes < BIN_OUT_BY
          ? 'นำถังไปวางที่จุดรับก่อน 06:30 น.'
          : 'ถังต้องอยู่ที่จุดรับตั้งแต่ 06:30 น. รถอาจมาถึงเมื่อไรก็ได้ในวันนี้',
      date: longDate(today),
      bins: todayBins,
      more: tomorrowBins.length ? { title: `พรุ่งนี้ก็มีเก็บ · ${longDate(tomorrow)}`, bins: tomorrowBins } : null,
    });
  } else if (tomorrowBins.length) {
    state.heroDates.add(tomorrow);
    const out = needsBinOut(tomorrowBins);
    html = heroHtml({
      action: true,
      eyebrow: 'คืนนี้',
      title: out ? 'นำถังออกวาง' : 'พรุ่งนี้มีรอบเก็บขยะอันตราย',
      sub: out ? 'รถมาเก็บพรุ่งนี้เช้า วางถังที่จุดรับก่อน 06:30 น.' : 'ดูเวลาและจุดรับที่เว็บไซต์ AWB',
      date: `พรุ่งนี้ · ${longDate(tomorrow)}`,
      bins: tomorrowBins,
    });
  } else {
    const next = nextDateAfter(today);
    if (next) {
      state.heroDates.add(next);
      const nextBins = binsOn(next);
      html = heroHtml({
        eyebrow: 'ครั้งถัดไป',
        title: relative(diffDays(today, next)),
        sub: needsBinOut(nextBins) ? 'วางถังที่จุดรับก่อน 06:30 น. ของวันเก็บ' : 'ดูเวลาและจุดรับที่เว็บไซต์ AWB',
        date: longDate(next),
        bins: nextBins,
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
        <span class="up-when">วัน${WEEKDAYS[weekday(d)]}ที่ ${day} ${MONTHS[m - 1]} · <strong>${relative(diffDays(today, d))}</strong></span>
        <span class="tags">${groupBins(bins).map((g) => `<span class="tag" data-group="${g.group}">${tile(g.group, 'xs')}${esc(g.th)}</span>`).join('')}</span>
      </span>
      <span class="chev">${uiIcon('chevronRight')}</span>
    </button></li>`);
    if (rows.length === UPCOMING_COUNT) break;
  }
  // Nothing to list and the hero already says "no data": hide the whole section instead of repeating it.
  const section = $('#upcoming').closest('section');
  section.hidden = !rows.length && !state.heroDates.size && !state.hidden.size;
  let html = rows.length
    ? `<ol class="rows">${rows.join('')}</ol>`
    : `<p class="empty">ยังไม่มีกำหนดเก็บเพิ่มเติม${state.hidden.size ? ' (ตอนนี้ซ่อนบางประเภทด้วยตัวกรองในปฏิทิน)' : ''}</p>`;
  const lastYear = state.data.years.at(-1);
  if (rows.length < UPCOMING_COUNT && lastYear) {
    html += `<p class="footnote list-foot">ข้อมูลครอบคลุมถึงสิ้นปี ${lastYear} — ตารางปี ${lastYear + 1} ยังไม่ประกาศ (AWB มักประกาศช่วงพฤศจิกายน) หน้านี้จะอัปเดตเองเมื่อประกาศแล้ว</p>`;
  }
  $('#upcoming').innerHTML = html;
}

function renderChips() {
  const present = new Set();
  for (const d of state.dates) for (const b of binsOn(d)) present.add(b.group);
  $('#chips').innerHTML = Object.keys(GROUPS)
    .filter((g) => present.has(g))
    .map((g) => `<button type="button" class="chip" data-group="${g}" data-chip="${g}" aria-pressed="${!state.hidden.has(g)}">${esc(GROUPS[g].th)}</button>`)
    .join('');
}

function renderCalendar() {
  const { y, m } = state.view;
  const { date: today } = state.clock;
  const years = state.data.years;
  $('#cal-title').textContent = `${MONTHS[m - 1]} ${y}`;
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
}

// Day details live in a bottom sheet, like a native detail view.
function openDay(date, trigger) {
  const bins = binsOn(date);
  const delta = diffDays(state.clock.date, date);
  state.shell.sheet.open({
    title: `${longDate(date)} ${parts(date).y}`,
    meta: delta >= 0 && delta <= 2 ? relative(delta) : '',
    html: bins.length ? `<div class="card">${binRowsHtml(bins)}</div>` : '<p class="empty">ไม่มีการเก็บขยะในวันนี้</p>',
    trigger,
  });
}

function renderAnnouncements() {
  const today = state.clock.date;
  const active = state.announcements.filter((a) => (!a.from || a.from <= today) && (!a.until || a.until >= today));
  $('#announcements').innerHTML = active
    .map((a) => {
      const warning = a.type === 'warning';
      const link = safeUrl(a.link?.url);
      return `<div class="banner${warning ? ' is-warning' : ''}" role="note">
        <span class="ico-tile">${uiIcon(warning ? 'problem' : 'info')}</span>
        <div>
          ${a.title ? `<p class="banner-title">${esc(a.title)}</p>` : ''}
          ${a.body ? `<p class="banner-body">${esc(a.body).replace(/\n/g, '<br>')}</p>` : ''}
          ${link ? `<p class="banner-body"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(a.link.text || 'รายละเอียด')}</a></p>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function renderShare() {
  const ics = new URL('data/calendar.ics', location.href);
  const webcal = ics.href.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const row = ({ tag, attrs, tone, icon, title, sub }) => `<${tag} class="row row-link" ${attrs}>
      <span class="ico-tile" data-tone="${tone}">${uiIcon(icon)}</span>
      <span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>
      <span class="chev">${uiIcon('chevronRight')}</span>
    </${tag}>`;
  $('#share').innerHTML = `<div class="rows">
    ${row({ tag: 'a', attrs: `href="${esc(webcal)}"`, tone: 'green', icon: 'calendar', title: 'เพิ่มใน Apple Calendar / Outlook', sub: 'Subscribe · อัปเดตเอง · เตือน 18:00 น. คืนก่อนวันเก็บ' })}
    ${row({ tag: 'a', attrs: `href="${esc(google)}" target="_blank" rel="noopener"`, tone: 'blue', icon: 'calendar', title: 'เพิ่มใน Google Calendar', sub: 'Google ไม่แสดงเตือนของปฏิทินที่ subscribe' })}
    ${row({ tag: 'a', attrs: `href="${esc(ics.href)}" download="ตารางเก็บขยะ.ics"`, tone: 'gray', icon: 'download', title: 'ดาวน์โหลดไฟล์ .ics', sub: 'นำเข้าครั้งเดียว ไม่อัปเดตอัตโนมัติ' })}
    ${row({ tag: 'button', attrs: 'type="button" id="btn-print"', tone: 'dark', icon: 'printer', title: 'พิมพ์ตารางทั้งปี', sub: 'A4 หน้าเดียว · บันทึกเป็น PDF ได้' })}
  </div>`;
}

function renderAbout() {
  const { config, data } = state;
  const a = config.address;
  const updated = data.fetchedAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.fetchedAt))
    : null;
  const kv = (label, value) => `<li class="row kv"><span>${label}</span><span>${value}</span></li>`;
  $('#about').innerHTML = `<ul class="rows">
    ${kv('ที่อยู่', `${esc(a.strasse)} ${esc(a.hausnr)}<br>${esc(a.plz)} ${esc(a.ort)}`)}
    ${kv('ข้อมูลจาก', awbLink('AWB Landkreis Augsburg') || 'AWB Landkreis Augsburg')}
    ${kv('ปีที่มีข้อมูล', esc(data.years.join(', ') || '–'))}
    ${updated ? kv('ตารางอัปเดตล่าสุด', shortDate(updated)) : ''}
  </ul>`;
  $('#source-note').textContent = 'เว็บนี้จัดทำโดยองค์กรเอง ไม่ใช่เว็บไซต์ทางการของ AWB — หากวันที่ไม่ตรงกัน ให้ยึดตามประกาศของ AWB';
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
      <button type="button" class="row row-link" data-install>
        <span class="ico-tile" data-tone="green">${uiIcon('phone')}</span>
        <span class="row-main"><span class="row-title">เพิ่มไว้ที่หน้าจอโฮม</span><span class="row-sub">เปิดได้ทันทีเหมือนแอป · ใช้งานออฟไลน์ได้</span></span>
        <span class="chev">${uiIcon('chevronRight')}</span>
      </button>
    </div></div>`;

  // a one-time nudge on phones only; the row above is always there
  const nudge = (info.native || info.ios) && matchMedia('(pointer: coarse)').matches && !installDismissed();
  $('#install-banner').innerHTML = nudge
    ? `<div class="install-banner">
        <span class="ico-tile" data-tone="green">${uiIcon('phone')}</span>
        <span class="row-main"><span class="row-title">ติดตั้งเป็นแอป</span><span class="row-sub">เปิดเร็วขึ้น ใช้งานออฟไลน์ได้</span></span>
        <button type="button" class="pill-btn" data-install>ติดตั้ง</button>
        <button type="button" class="icon-btn" data-dismiss-install aria-label="ปิด">${uiIcon('close')}</button>
      </div>`
    : '';
}

async function startInstall(trigger) {
  const info = installInfo();
  if (info.native) {
    if (await promptInstall()) toast('ติดตั้งแล้ว — เปิดจากหน้าจอโฮมได้เลย');
    return;
  }
  const steps = info.ios
    ? `<ol class="steps">
        <li><span>แตะปุ่ม <strong>แชร์</strong> ${uiIcon('share')} ที่แถบล่างของ Safari</span></li>
        <li><span>เลื่อนลงแล้วเลือก <strong>เพิ่มไปยังหน้าจอโฮม</strong> ${uiIcon('plusSquare')}</span></li>
        <li><span>แตะ <strong>เพิ่ม</strong> ที่มุมขวาบน</span></li>
      </ol>
      <p class="footnote">บน iPhone / iPad ต้องเปิดหน้านี้ด้วย Safari</p>`
    : `<ol class="steps">
        <li><span>เปิดเมนูของเบราว์เซอร์ (⋮ หรือ ⋯)</span></li>
        <li><span>เลือก <strong>ติดตั้งแอป</strong> หรือ <strong>เพิ่มไปยังหน้าจอหลัก</strong></span></li>
        <li><span>ยืนยันการติดตั้ง</span></li>
      </ol>`;
  state.shell.sheet.open({ title: 'เพิ่มไว้ที่หน้าจอโฮม', meta: 'เปิดได้เหมือนแอป', html: steps, trigger });
}

function renderPrintSheet() {
  const { config, data } = state;
  const year = state.view.y;
  const present = new Set();
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const items = [];
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = makeIso(year, m, d);
      const bins = binsOn(date);
      if (!bins.length) continue;
      const groups = groupBins(bins);
      groups.forEach((g) => present.add(g.group));
      items.push(`<li><span class="dd">${WEEKDAYS_SHORT[weekday(date)]} ${d}</span><span>${groups.map((g) => `${groupIcon(g.group)} ${esc(GROUPS[g.group].short)}`).join(' · ')}</span></li>`);
    }
    months.push(`<div class="ps-month"><h2>${MONTHS[m - 1]}</h2>${items.length ? `<ul>${items.join('')}</ul>` : '<p>–</p>'}</div>`);
  }
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
    <div class="ps-months">${months.join('')}</div>
    <p class="ps-foot">ข้อมูลจาก AWB Landkreis Augsburg · ${esc(config.source.awbUrl)} · พิมพ์เมื่อ ${shortDate(state.clock.date)}</p>`;
}

function renderAll() {
  renderAnnouncements();
  renderHero();
  renderUpcoming();
  renderChips();
  renderCalendar();
  renderAbout();
  renderPrintSheet();
}

/* ---------- interaction ---------- */
function setView(y, m) {
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  state.view = { y, m };
  const t = parts(state.clock.date);
  state.selected = t.y === y && t.m === m ? state.clock.date : null;
  renderCalendar();
  renderPrintSheet();
}

function bindEvents() {
  $('#prev').addEventListener('click', () => { haptic(5); setView(state.view.y, state.view.m - 1); });
  $('#next').addEventListener('click', () => { haptic(5); setView(state.view.y, state.view.m + 1); });
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
  $('#upcoming').addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (!row) return;
    haptic(6);
    openDay(row.dataset.open, row);
  });
  $('#app').addEventListener('click', (e) => {
    if (e.target.closest('[data-install]')) startInstall(e.target.closest('[data-install]'));
    if (e.target.closest('[data-dismiss-install]')) {
      try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); } catch {}
      renderInstall();
    }
  });
  onInstallChange(renderInstall);
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
  $('#btn-print').addEventListener('click', () => {
    renderPrintSheet();
    window.print();
  });

  // The page can stay open for days: re-render when the date or the "collection is over" phase changes.
  const phase = () => `${state.clock.date}|${state.clock.minutes < COLLECTION_END}|${state.clock.minutes < BIN_OUT_BY}`;
  const refresh = () => {
    const before = phase();
    state.clock = getClock(state.config.timezone);
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
  const a = config.address;
  $('#address').innerHTML = `${uiIcon('pin')}<span>${esc(a.strasse)} ${esc(a.hausnr)}, ${esc(a.plz)} ${esc(a.ort)}</span>`;
  $('#prev').innerHTML = uiIcon('chevronLeft');
  $('#next').innerHTML = uiIcon('chevronRight');
  document.querySelectorAll('.tab').forEach((tab) => { tab.querySelector('.tab-icon').innerHTML = uiIcon(tab.dataset.icon); });
  if (state.clock.forced) {
    $('#debug').innerHTML = `<p class="debug">โหมดทดสอบ: วันที่ ${esc(state.clock.date)} เวลา ${hhmm(state.clock.minutes)} — เอา <code>?today=</code> ออกจาก URL เพื่อกลับเป็นเวลาจริง</p>`;
  }

  renderShare();
  renderInstall();
  renderAll();
  bindEvents();

  state.shell.sheet = initSheet();
  state.shell.tabs = initTabs(location.hash.slice(1) || 'today');
  initPullToRefresh(() => Promise.all([refreshData(), sleep(700)]));
  registerServiceWorker();
}

main().catch((err) => {
  console.error(err);
  $('#app').innerHTML = `<div class="wrap"><div class="banner is-warning" role="alert" style="margin-top:80px"><div><p class="banner-title">โหลดตารางไม่สำเร็จ</p><p class="banner-body">ลองรีเฟรชหน้านี้อีกครั้ง หากยังไม่ได้ผล ให้ดูตารางที่เว็บไซต์ AWB โดยตรง</p></div></div></div>`;
});
