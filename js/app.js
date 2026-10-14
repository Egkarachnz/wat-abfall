import { GROUPS, binInfo, isEnabled, needsBinOut, sortBins } from './bins.js';
import {
  MONTHS, MONTHS_SHORT, WEEKDAYS, WEEKDAYS_SHORT,
  addDays, daysInMonth, diffDays, longDate, makeIso, parts, relative, shortDate, weekday,
} from './dates.js';

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
const state = { config: null, data: null, announcements: [], clock: null, view: null, selected: null, hidden: new Set(), dates: [] };

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
    if (!map.has(b.group)) map.set(b.group, { group: b.group, icon: b.icon, th: b.th, items: [] });
    map.get(b.group).items.push(b);
  }
  return [...map.values()];
}

function nextDateAfter(date, { filtered = false } = {}) {
  return state.dates.find((d) => d > date && binsOn(d, { filtered }).length > 0) ?? null;
}

/* ---------- rendering ---------- */
function tilesHtml(bins) {
  const awb = safeUrl(state.config.source.awbUrl);
  return `<ul class="tiles">${groupBins(bins)
    .map((g) => {
      const note = g.items.find((b) => b.note)?.note;
      return `<li class="tile" data-group="${g.group}">
        <span class="tile-icon" aria-hidden="true">${g.icon}</span>
        <span class="tile-text">
          <strong>${esc(g.th)}</strong>
          ${g.items.map((b) => `<span class="de">${esc(b.de)}${b.detail ? ` · ${esc(b.detail)}` : ''}</span>`).join('')}
          ${note ? `<span class="note">${esc(note)}${awb ? ` · <a href="${esc(awb)}" target="_blank" rel="noopener">AWB</a>` : ''}</span>` : ''}
        </span>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderHero() {
  const { date: today, minutes } = state.clock;
  const tomorrow = addDays(today, 1);
  const todayBins = binsOn(today);
  const tomorrowBins = binsOn(tomorrow);
  let html;

  if (todayBins.length && minutes < COLLECTION_END) {
    const out = needsBinOut(todayBins);
    html = `<span class="pill">${out ? 'วันนี้เก็บขยะ' : 'วันนี้มีรอบเก็บขยะอันตราย'}</span>
      <p class="hero-day">${longDate(today)}</p>
      <p class="hero-sub">${!out ? 'ดูเวลาและจุดรับที่เว็บไซต์ AWB' : minutes < BIN_OUT_BY ? 'นำถังไปวางที่จุดรับก่อน 06:30 น.' : 'ถังต้องอยู่ที่จุดรับตั้งแต่ 06:30 น. — รถอาจมาถึงเมื่อไรก็ได้ในวันนี้'}</p>
      ${tilesHtml(todayBins)}
      ${tomorrowBins.length ? `<div class="hero-extra"><strong>พรุ่งนี้ก็มีเก็บ (${longDate(tomorrow)})</strong>${tilesHtml(tomorrowBins)}</div>` : ''}`;
  } else if (tomorrowBins.length) {
    const out = needsBinOut(tomorrowBins);
    html = `<span class="pill">${out ? 'คืนนี้ต้องนำถังออก' : 'พรุ่งนี้มีรอบเก็บขยะอันตราย'}</span>
      <p class="hero-day">${out ? 'เก็บพรุ่งนี้' : 'พรุ่งนี้'} · ${longDate(tomorrow)}</p>
      <p class="hero-sub">${out ? 'วางถังที่จุดรับก่อน 06:30 น. ของพรุ่งนี้เช้า' : 'ดูเวลาและจุดรับที่เว็บไซต์ AWB'}</p>
      ${tilesHtml(tomorrowBins)}`;
  } else {
    const next = nextDateAfter(today);
    if (next) {
      const nextBins = binsOn(next);
      html = `<span class="pill calm">ครั้งถัดไป</span>
        <p class="hero-day">${longDate(next)}</p>
        <p class="hero-sub">${relative(diffDays(today, next))}${needsBinOut(nextBins) ? ' · วางถังก่อน 06:30 น.' : ''}</p>
        ${tilesHtml(nextBins)}`;
    } else {
      const awb = safeUrl(state.config.source.awbUrl);
      html = `<span class="pill calm">ยังไม่มีข้อมูล</span>
        <p class="hero-day">ยังไม่มีกำหนดเก็บขยะหลังจากวันนี้</p>
        <p class="hero-sub">ตารางปีถัดไปยังไม่ประกาศ — AWB มักประกาศช่วงพฤศจิกายน${awb ? ` · <a href="${esc(awb)}" target="_blank" rel="noopener">ดูที่ AWB</a>` : ''}</p>`;
    }
  }
  $('#hero').innerHTML = html;
}

function badgesHtml(bins) {
  return `<div class="badges">${groupBins(bins)
    .map((g) => `<span class="badge" data-group="${g.group}"><span aria-hidden="true">${g.icon}</span>${esc(g.th)}</span>`)
    .join('')}</div>`;
}

function renderUpcoming() {
  const { date: today, minutes } = state.clock;
  const from = binsOn(today, { filtered: true }).length && minutes < COLLECTION_END ? addDays(today, -1) : today;
  const rows = [];
  for (const d of state.dates) {
    if (d <= from) continue;
    const bins = binsOn(d, { filtered: true });
    if (!bins.length) continue;
    rows.push(`<li class="up-row">
      <div class="up-date"><span class="num">${parts(d).d}</span><span class="mon">${MONTHS_SHORT[parts(d).m - 1]}</span></div>
      <div><p class="up-when">วัน${WEEKDAYS[weekday(d)]} · <span class="rel">${relative(diffDays(today, d))}</span></p>${badgesHtml(bins)}</div>
    </li>`);
    if (rows.length === UPCOMING_COUNT) break;
  }
  let html = rows.length
    ? `<ol class="upcoming">${rows.join('')}</ol>`
    : `<p class="empty">ยังไม่มีกำหนดเก็บถัดไป${state.hidden.size ? ' (ตอนนี้ซ่อนบางประเภทด้วยตัวกรองในปฏิทิน)' : ''}</p>`;
  const lastYear = state.data.years.at(-1);
  if (rows.length < UPCOMING_COUNT && lastYear) {
    html += `<p class="list-note">ข้อมูลครอบคลุมถึงสิ้นปี ${lastYear} — ตารางปี ${lastYear + 1} ยังไม่ประกาศ (AWB มักประกาศช่วงพฤศจิกายน) หน้านี้จะอัปเดตเองเมื่อประกาศแล้ว</p>`;
  }
  $('#upcoming').innerHTML = html;
}

function renderChips() {
  const present = new Set();
  for (const d of state.dates) for (const b of binsOn(d)) present.add(b.group);
  $('#chips').innerHTML = Object.keys(GROUPS)
    .filter((g) => present.has(g))
    .map((g) => {
      const on = !state.hidden.has(g);
      return `<button type="button" class="chip" data-group="${g}" data-chip="${g}" aria-pressed="${on}"><span aria-hidden="true">${GROUPS[g].icon}</span>${esc(GROUPS[g].th)}</button>`;
    })
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
    : `<p class="notice">ตารางปี ${y} ยังไม่ประกาศ — AWB มักประกาศช่วงพฤศจิกายน หน้านี้จะแสดงข้อมูลให้เองเมื่อประกาศแล้ว</p>`;

  const lead = (weekday(makeIso(y, m, 1)) + 6) % 7; // weeks start on Monday, as in Germany
  const cells = Array.from({ length: lead }, () => '<span class="cell blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const date = makeIso(y, m, day);
    const bins = binsOn(date, { filtered: true });
    const groups = groupBins(bins);
    const label = `${day} ${MONTHS[m - 1]}${groups.length ? `: ${groups.map((g) => g.th).join(', ')}` : ': ไม่มีเก็บขยะ'}`;
    cells.push(`<button type="button" class="cell${bins.length ? ' has' : ''}${date === today ? ' is-today' : ''}${date === state.selected ? ' is-selected' : ''}" data-date="${date}" aria-label="${esc(label)}" aria-pressed="${date === state.selected}">
      <span class="d">${day}</span>
      <span class="marks">${groups.map((g) => `<span class="mk" data-group="${g.group}"><span aria-hidden="true">${g.icon}</span><span class="mk-label">${esc(GROUPS[g.group].short)}</span></span>`).join('')}</span>
    </button>`);
  }
  $('#grid').innerHTML = cells.join('');
}

function renderDetail() {
  const el = $('#detail');
  const sel = state.selected;
  if (!sel) {
    el.innerHTML = '<p class="muted">แตะที่วันที่ในปฏิทินเพื่อดูรายละเอียด</p>';
    return;
  }
  const bins = binsOn(sel);
  const rel = relative(diffDays(state.clock.date, sel));
  const head = `<h3>${longDate(sel)} ${parts(sel).y}${diffDays(state.clock.date, sel) >= 0 && diffDays(state.clock.date, sel) <= 2 ? ` · ${rel}` : ''}</h3>`;
  el.innerHTML = bins.length ? `${head}${tilesHtml(bins)}` : `${head}<p class="empty">ไม่มีการเก็บขยะในวันนี้</p>`;
}

function renderAnnouncements() {
  const today = state.clock.date;
  const active = state.announcements.filter((a) => (!a.from || a.from <= today) && (!a.until || a.until >= today));
  $('#announcements').innerHTML = active
    .map((a) => {
      const link = safeUrl(a.link?.url);
      return `<div class="announcement ${a.type === 'warning' ? 'warning' : 'info'}" role="note">
        ${a.title ? `<strong>${esc(a.title)}</strong>` : ''}
        ${a.body ? `<span>${esc(a.body).replace(/\n/g, '<br>')}</span>` : ''}
        ${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(a.link.text || 'รายละเอียด')}</a>` : ''}
      </div>`;
    })
    .join('');
}

function renderShare() {
  const ics = new URL('data/calendar.ics', location.href);
  const webcal = ics.href.replace(/^https?:/, 'webcal:');
  $('#btn-webcal').href = webcal;
  $('#btn-google').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  $('#btn-ics').href = ics.href;
}

function renderFooter() {
  const { config, data } = state;
  const awb = safeUrl(config.source.awbUrl);
  const updated = data.fetchedAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.fetchedAt))
    : null;
  $('#source').innerHTML = `ข้อมูลจาก ${awb ? `<a href="${esc(awb)}" target="_blank" rel="noopener">` : ''}Abfallwirtschaftsbetrieb Landkreis Augsburg (AWB)${awb ? '</a>' : ''} · ครอบคลุมปี ${data.years.join(', ') || '–'}${updated ? ` · ตารางอัปเดตล่าสุด ${shortDate(updated)}` : ''}`;
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
      items.push(`<li><span class="dd">${WEEKDAYS_SHORT[weekday(date)]} ${d}</span><span>${groups.map((g) => `${g.icon} ${esc(GROUPS[g.group].short)}`).join(' · ')}</span></li>`);
    }
    months.push(`<div class="ps-month"><h2>${MONTHS[m - 1]}</h2>${items.length ? `<ul>${items.join('')}</ul>` : '<p>–</p>'}</div>`);
  }
  const legend = Object.keys(GROUPS)
    .filter((g) => present.has(g))
    .map((g) => `<span>${GROUPS[g].icon} <strong>${esc(GROUPS[g].short)}</strong> = ${esc(GROUPS[g].th)} (${esc(GROUPS[g].de)})</span>`)
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
  $('#address').textContent = `${a.strasse} ${a.hausnr}, ${a.plz} ${a.ort}`;
  if (state.clock.forced) {
    $('#debug').innerHTML = `<p class="notice">โหมดทดสอบ: วันที่ ${esc(state.clock.date)} เวลา ${hhmm(state.clock.minutes)} (เอา <code>?today=</code> ออกจาก URL เพื่อกลับเป็นเวลาจริง)</p>`;
  }

  renderShare();
  renderAll();
  bindEvents();
}

main().catch((err) => {
  console.error(err);
  $('#app').innerHTML = `<div class="notice" role="alert"><strong>โหลดตารางไม่สำเร็จ</strong><br>ลองรีเฟรชหน้านี้อีกครั้ง หากยังไม่ได้ผล ให้ดูตารางที่เว็บไซต์ AWB โดยตรง</div>`;
});
