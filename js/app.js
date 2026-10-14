import { GROUPS, binInfo, isEnabled, needsBinOut, sortBins } from './bins.js';
import {
  MONTHS, WEEKDAYS, WEEKDAYS_SHORT,
  addDays, daysInMonth, diffDays, longDate, makeIso, parts, relative, shortDate, weekday,
} from './dates.js';
import { groupIcon, uiIcon } from './icons.js';

const BIN_OUT_BY = 6 * 60 + 30; // bins must be at the kerb by 06:30
const COLLECTION_END = 16 * 60 + 30; // AWB's calendar blocks the collection window until 16:30
const UPCOMING_COUNT = 6;
const STORAGE_KEY = 'waste.hiddenGroups';

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
const state = { config: null, data: null, announcements: [], clock: null, view: null, selected: null, hidden: new Set(), dates: [], heroDates: new Set() };

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
    rows.push(`<li class="row up-row">
      <div class="date-icon" aria-hidden="true"><span class="wd">${WEEKDAYS_SHORT[weekday(d)]}</span><span class="dn">${day}</span></div>
      <div class="row-main">
        <p class="up-when">วัน${WEEKDAYS[weekday(d)]}ที่ ${day} ${MONTHS[m - 1]} · <strong>${relative(diffDays(today, d))}</strong></p>
        <ul class="tags">${groupBins(bins).map((g) => `<li class="tag" data-group="${g.group}">${tile(g.group, 'xs')}${esc(g.th)}</li>`).join('')}</ul>
      </div>
    </li>`);
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

function renderDetail() {
  const el = $('#detail');
  const sel = state.selected;
  if (!sel) {
    el.innerHTML = '<p class="empty">แตะที่วันที่ในปฏิทินเพื่อดูรายละเอียด</p>';
    return;
  }
  const bins = binsOn(sel);
  const delta = diffDays(state.clock.date, sel);
  const head = `<div class="detail-head"><h3>${longDate(sel)} ${parts(sel).y}</h3>${delta >= 0 && delta <= 2 ? `<span>${relative(delta)}</span>` : ''}</div>`;
  el.innerHTML = bins.length ? `${head}${binRowsHtml(bins)}` : `${head}<p class="empty">ไม่มีการเก็บขยะในวันนี้</p>`;
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

function renderFooter() {
  const { config, data } = state;
  const updated = data.fetchedAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.fetchedAt))
    : null;
  $('#source').innerHTML = `ข้อมูลจาก ${awbLink('Abfallwirtschaftsbetrieb Landkreis Augsburg (AWB)') || 'AWB Landkreis Augsburg'} · ครอบคลุมปี ${data.years.join(', ') || '–'}${updated ? ` · ตารางอัปเดตล่าสุด ${shortDate(updated)}` : ''}`;
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
  renderDetail();
  renderFooter();
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
  renderDetail();
  renderPrintSheet();
}

function bindEvents() {
  $('#prev').addEventListener('click', () => setView(state.view.y, state.view.m - 1));
  $('#next').addEventListener('click', () => setView(state.view.y, state.view.m + 1));
  $('#goto-today').addEventListener('click', () => {
    const t = parts(state.clock.date);
    setView(t.y, t.m);
  });
  $('#grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    state.selected = cell.dataset.date;
    renderCalendar();
    renderDetail();
    $('#grid').querySelector('.is-selected')?.focus({ preventScroll: true });
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
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

  // condensed title in the navigation bar once the large title scrolls away
  if ('IntersectionObserver' in window) {
    const navbar = $('#navbar');
    new IntersectionObserver(([entry]) => navbar.classList.toggle('is-visible', !entry.isIntersecting), { rootMargin: '-44px 0px 0px 0px' }).observe($('#title'));
  }
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

async function main() {
  const [config, data, announcements] = await Promise.all([
    loadJson('config.json'),
    loadJson('data/collections.json'),
    loadJson('data/announcements.json', true),
  ]);
  state.config = config;
  state.data = data;
  state.announcements = Array.isArray(announcements) ? announcements : [];
  state.dates = Object.keys(data.days).sort();
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
  if (state.clock.forced) {
    $('#debug').innerHTML = `<p class="debug">โหมดทดสอบ: วันที่ ${esc(state.clock.date)} เวลา ${hhmm(state.clock.minutes)} — เอา <code>?today=</code> ออกจาก URL เพื่อกลับเป็นเวลาจริง</p>`;
  }

  renderShare();
  renderAll();
  bindEvents();
}

main().catch((err) => {
  console.error(err);
  $('#app').innerHTML = `<div class="banner is-warning" role="alert"><div><p class="banner-title">โหลดตารางไม่สำเร็จ</p><p class="banner-body">ลองรีเฟรชหน้านี้อีกครั้ง หากยังไม่ได้ผล ให้ดูตารางที่เว็บไซต์ AWB โดยตรง</p></div></div>`;
});
