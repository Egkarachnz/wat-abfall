// Cute scenery for the app: a live sky behind the Today header (sun, moon, clouds, rain, snow,
// falling leaves) and a few little critters you can tap. Pure decoration: nothing here is needed
// to read the schedule, and everything is switched off for people who prefer reduced motion.
//
// The sky follows the real weather in Königsbrunn from Open-Meteo (free, no key, no account;
// only the town's coordinates are sent). Offline or blocked, it falls back to day / night + season.
// Debug: add ?sky=rain (clear, partly, cloudy, fog, drizzle, rain, snow, storm) to the URL.
import { haptic } from './shell.js';

const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/* ---------- weather ---------- */
const KINDS = {
  clear: ['แดดจ้า', 'ท้องฟ้าโปร่ง'], // [day, night]
  partly: ['มีเมฆบางส่วน', 'มีเมฆบางส่วน'],
  cloudy: ['ฟ้าครึ้ม', 'ฟ้าครึ้ม'],
  fog: ['หมอกลง', 'หมอกลง'],
  drizzle: ['ฝนปรอย', 'ฝนปรอย'],
  rain: ['ฝนตก', 'ฝนตก'],
  snow: ['หิมะตก', 'หิมะตก'],
  storm: ['พายุฝนฟ้าคะนอง', 'พายุฝนฟ้าคะนอง'],
};

// WMO weather codes as reported by Open-Meteo
function kindFromCode(code) {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'partly';
}

const WEATHER_KEY = 'waste.weather';
const FRESH_MS = 30 * 60 * 1000;
const STALE_MS = 6 * 60 * 60 * 1000;

const readCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_KEY));
    return cached && KINDS[cached.kind] && Date.now() - cached.at < STALE_MS ? cached : null;
  } catch {
    return null;
  }
};
const writeCache = (weather) => {
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify(weather));
  } catch {}
};

async function fetchWeather({ lat, lon }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: lat, longitude: lon, current: 'weather_code,temperature_2m', timezone: 'auto' }).toString();
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(4000) : undefined;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`weather: HTTP ${res.status}`);
  const { current } = await res.json();
  const weather = { at: Date.now(), kind: kindFromCode(current.weather_code), temp: Math.round(current.temperature_2m) };
  writeCache(weather);
  return weather;
}

/* ---------- day or night (works offline; follows the app's clock, so ?today=&time= behaves) ---------- */
function offsetHours(timeZone, iso) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(`${iso}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(name ?? '');
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60) : 0;
  } catch {
    return 1;
  }
}

function isNight(iso, minutes, timeZone, lon) {
  const [y, m, d] = iso.split('-').map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const daylight = 12 + 4.1 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365); // hours of sun at ~48°N
  const noon = 12 - lon / 15 + offsetHours(timeZone, iso); // solar noon on the local clock
  const hour = minutes / 60;
  return hour < noon - daylight / 2 - 0.3 || hour > noon + daylight / 2 + 0.3;
}

// autumn leaves in September – November, blossom petals in March – May
const seasonOf = (iso) => {
  const month = Number(iso.slice(5, 7));
  return month >= 9 && month <= 11 ? 'leaf' : month >= 3 && month <= 5 ? 'petal' : null;
};

/* ---------- the sky ---------- */
const many = (count, make) => Array.from({ length: count }, (_, i) => make(i)).join('');

const rain = (count) => many(count, () =>
  `<i class="particle drop" style="left:${rand(0, 100).toFixed(1)}%;--d:${rand(0.6, 1.0).toFixed(2)}s;--delay:${(-rand(0, 1.5)).toFixed(2)}s;--h:${Math.round(rand(12, 20))}px"></i>`);

const snow = (count) => many(count, () =>
  `<i class="particle flake" style="left:${rand(0, 100).toFixed(1)}%;--s:${Math.round(rand(4, 9))}px;--d:${rand(7, 12).toFixed(1)}s;--delay:${(-rand(0, 12)).toFixed(1)}s;--sway:${Math.round(rand(10, 26))}px"><b></b></i>`);

const LEAF_COLORS = ['#e8833a', '#d9532e', '#f2b541', '#b5651d', '#c9482c'];
const PETAL_COLORS = ['#ffc2d1', '#ffd6e0', '#ffb3c6'];
const drifting = (count, kind) => many(count, () =>
  `<i class="particle ${kind}" style="left:${rand(0, 100).toFixed(1)}%;--s:${Math.round(rand(11, 17))}px;--d:${rand(8, 14).toFixed(1)}s;--delay:${(-rand(0, 14)).toFixed(1)}s;--sway:${Math.round(rand(18, 40))}px;--c:${pick(kind === 'leaf' ? LEAF_COLORS : PETAL_COLORS)}"><b></b></i>`);

const stars = (count) => many(count, () =>
  `<i class="star" style="left:${rand(2, 98).toFixed(1)}%;top:${Math.round(rand(54, 230))}px;--s:${Math.round(rand(2, 4))}px;--delay:${(-rand(0, 4)).toFixed(1)}s"></i>`);

let cloudCount = 0;
const cloud = ({ top, width, speed, delay, tone = '', face = false, opacity = 1 }) => {
  const id = `cloud-fill-${cloudCount++}`;
  return `
  <svg class="cloud ${tone}${face ? ' hero' : ''}" style="top:${top}px;width:${width}px;--speed:${speed}s;--delay:${delay}s;opacity:${opacity}" viewBox="0 0 120 64" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset=".4" style="stop-color:var(--cloud)"/><stop offset="1" style="stop-color:var(--cloud-lo)"/></linearGradient></defs>
    <g fill="url(#${id})"><circle cx="34" cy="40" r="18"/><circle cx="60" cy="30" r="24"/><circle cx="90" cy="40" r="18"/><rect x="18" y="40" width="88" height="18" rx="9"/></g>
    ${face ? '<g class="face"><ellipse cx="51" cy="40" rx="2.6" ry="3.4"/><ellipse cx="71" cy="40" rx="2.6" ry="3.4"/><path d="M57 47q4 4.5 8 0" fill="none"/><ellipse class="cheek" cx="45" cy="47" rx="4" ry="2.4"/><ellipse class="cheek" cx="77" cy="47" rx="4" ry="2.4"/></g>' : ''}
  </svg>`;
};

const sun = (uid) => `
  <div class="sun"><div class="sun-glow"></div>
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs><radialGradient id="sun-fill-${uid}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#ffb400"/></radialGradient></defs>
      <g class="sun-rays">${many(12, (i) => `<rect x="57" y="6" width="6" height="15" rx="3" transform="rotate(${i * 30} 60 60)"/>`)}</g>
      <circle cx="60" cy="60" r="28" fill="url(#sun-fill-${uid})"/>
      <g class="face"><ellipse cx="50" cy="58" rx="3" ry="4"/><ellipse cx="70" cy="58" rx="3" ry="4"/><path d="M53 68q7 7 14 0" fill="none"/><ellipse class="cheek" cx="43" cy="67" rx="5" ry="3"/><ellipse class="cheek" cx="77" cy="67" rx="5" ry="3"/></g>
    </svg>
  </div>`;

const moon = (uid) => `
  <div class="moon">
    <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <defs><mask id="moon-cut-${uid}"><rect width="80" height="80" fill="#fff"/><circle cx="53" cy="30" r="25" fill="#000"/></mask></defs>
      <circle cx="38" cy="42" r="28" class="moon-body" mask="url(#moon-cut-${uid})"/>
      <g class="face"><path d="M18 47q3 3.5 6.5 0" fill="none"/><path d="M25 57q2.6 2.4 5.2 0" fill="none"/><ellipse class="cheek" cx="19" cy="54" rx="3.4" ry="2.2"/></g>
    </svg>
  </div>`;

const bolt = () => '<svg class="bolt" viewBox="0 0 24 40" aria-hidden="true" focusable="false"><path d="M14 0 3 22h7l-3 18L21 16h-8z"/></svg>';

function skyHtml({ kind, night, season, uid }) {
  const wet = kind === 'drizzle' || kind === 'rain' || kind === 'storm';
  const open = kind === 'clear' || kind === 'partly'; // the sun or moon shows
  let html = '';

  if (night && (open || kind === 'cloudy')) html += stars(14) + moon(uid);
  if (!night && open) html += sun(uid);

  switch (kind) {
    case 'clear':
      if (!night) html += cloud({ top: 76, width: 84, speed: 125, delay: -40 }) + cloud({ top: 150, width: 66, speed: 105, delay: -85 });
      break;
    case 'partly':
      html += cloud({ top: 64, width: 96, speed: 95, delay: -30 }) + cloud({ top: 140, width: 74, speed: 130, delay: -70 });
      break;
    case 'cloudy':
      html += cloud({ top: 54, width: 120, speed: 110, delay: -20, tone: 'grey' }) + cloud({ top: 112, width: 90, speed: 85, delay: -60, tone: 'grey' })
        + cloud({ top: 170, width: 110, speed: 140, delay: -90, tone: 'grey' }) + cloud({ top: 30, width: 80, speed: 100, delay: -75, tone: 'grey' });
      break;
    case 'fog':
      html += cloud({ top: 80, width: 110, speed: 140, delay: -40, tone: 'grey', opacity: 0.8 })
        + '<i class="fogband" style="top:70px"></i><i class="fogband b" style="top:130px"></i><i class="fogband" style="top:190px"></i>';
      break;
    case 'drizzle':
    case 'rain':
      html += cloud({ top: 40, width: 130, speed: 160, delay: -45, tone: 'rain', face: true }) + cloud({ top: 120, width: 90, speed: 110, delay: -20, tone: 'grey' })
        + cloud({ top: 20, width: 84, speed: 100, delay: -80, tone: 'grey' }) + rain(kind === 'rain' ? 34 : 14);
      break;
    case 'snow':
      html += cloud({ top: 46, width: 118, speed: 150, delay: -30, tone: 'snow' }) + cloud({ top: 120, width: 84, speed: 105, delay: -70, tone: 'snow' }) + snow(26);
      break;
    case 'storm':
      html += '<i class="flash"></i>' + cloud({ top: 36, width: 138, speed: 170, delay: -60, tone: 'storm', face: true })
        + cloud({ top: 110, width: 96, speed: 100, delay: -30, tone: 'storm' }) + bolt() + rain(46);
      break;
  }

  const calm = !wet && kind !== 'snow' && kind !== 'fog';
  if (season && calm) html += drifting(season === 'leaf' ? 9 : 7, season);
  if (!night && calm) html += `<div class="sky-bird">${birdArt('fly')}</div>`;
  return html;
}

/* ---------- critters ---------- */
// Colours live in css/scene.css, so the art follows the theme. Closed eyes, the sleepy "z"s,
// sunglasses and the scarf are all in the markup and switched on by html[data-night] / html[data-wx].
const eyes = (xs, y, open = true) => open
  ? `<g class="eyes-open">${xs.map((x) => `<ellipse cx="${x}" cy="${y}" rx="2.8" ry="3.6" fill="#33241c"/><circle cx="${x + 0.9}" cy="${y - 1.4}" r="1.1" fill="#fff"/>`).join('')}</g>`
  : `<g class="eyes-closed" fill="none" stroke="#33241c" stroke-width="2" stroke-linecap="round">${xs.map((x) => `<path d="M${x - 3.5} ${y} q3.5 3.6 7 0"/>`).join('')}</g>`;

const SCARF = '<path class="scarf" d="M17 45q15 9 30 0v5q-15 9-30 0z M38 51l5 11-6 1z"/>';
const shades = (y) => `<g class="shades"><rect x="16.5" y="${y}" width="14" height="10" rx="5"/><rect x="33.5" y="${y}" width="14" height="10" rx="5"/><path d="M30 ${y + 3.5}h4" stroke="#26272b" stroke-width="2"/></g>`;

// sitting, seen from the front
const catArt = () => `
  <svg class="pet-art cat" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="tail" d="M46 56c9 0 13-8 9-15" fill="none" stroke="var(--fur)" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="32" cy="48" rx="17" ry="14" fill="var(--fur)"/>
    <ellipse cx="32" cy="52" rx="10" ry="9" fill="var(--belly)"/>
    <ellipse cx="23.5" cy="61" rx="6.5" ry="3.5" fill="var(--belly)"/><ellipse cx="40.5" cy="61" rx="6.5" ry="3.5" fill="var(--belly)"/>
    ${SCARF}
    <g class="head">
      <path class="ear ear-l" d="M15.5 26 17 8.5q.3-1.5 1.8-.7L30 15z" fill="var(--fur)"/>
      <path class="ear ear-r" d="M48.5 26 47 8.5q-.3-1.5-1.8-.7L34 15z" fill="var(--fur)"/>
      <path d="M19.6 20l.2-8 6.2 4.5zM44.4 20l-.2-8L38 16.5z" fill="var(--ear-in)"/>
      <ellipse cx="32" cy="30" rx="19" ry="15.5" fill="var(--fur)"/>
      <path d="M32 15.5v5M27 16.5l1 4.2M37 16.5l-1 4.2" stroke="var(--fur-d)" stroke-width="2" stroke-linecap="round" fill="none"/>
      ${eyes([24.5, 39.5], 30)}${eyes([24.5, 39.5], 30, false)}
      <ellipse cx="19.5" cy="36" rx="3.6" ry="2.4" fill="var(--blush)" opacity=".55"/><ellipse cx="44.5" cy="36" rx="3.6" ry="2.4" fill="var(--blush)" opacity=".55"/>
      <path d="M30.2 35.2h3.6L32 37.4z" fill="#f2828e"/>
      <path d="M32 37.4v1.4m0 0q-2 2-4 .6m4-.6q2 2 4 .6" stroke="#33241c" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M15 35l-7-1.5M15 37.5l-6.5 2.5M49 35l7-1.5M49 37.5l6.5 2.5" stroke="#fff" stroke-width="1.2" opacity=".85" stroke-linecap="round"/>
      ${shades(25)}
    </g>
  </svg>`;

const dogArt = () => `
  <svg class="pet-art dog" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="tail" d="M47 55c8-1 11-9 8-15" fill="none" stroke="var(--fur)" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="32" cy="48" rx="16" ry="14" fill="var(--fur)"/>
    <ellipse cx="32" cy="52" rx="9.5" ry="9" fill="var(--belly)"/>
    <ellipse cx="24" cy="61" rx="6.5" ry="3.5" fill="var(--belly)"/><ellipse cx="40" cy="61" rx="6.5" ry="3.5" fill="var(--belly)"/>
    ${SCARF}
    <g class="head">
      <g transform="rotate(14 14 27)"><ellipse class="ear ear-l" cx="14" cy="27" rx="6.5" ry="12" fill="var(--ear)"/></g>
      <g transform="rotate(-14 50 27)"><ellipse class="ear ear-r" cx="50" cy="27" rx="6.5" ry="12" fill="var(--ear)"/></g>
      <ellipse cx="32" cy="29" rx="18" ry="15" fill="var(--fur)"/>
      <ellipse cx="32" cy="36" rx="10.5" ry="8" fill="var(--belly)"/>
      <circle cx="24.5" cy="20.5" r="2" fill="var(--fur-d)" opacity=".55"/><circle cx="39.5" cy="20.5" r="2" fill="var(--fur-d)" opacity=".55"/>
      ${eyes([24.5, 39.5], 27)}${eyes([24.5, 39.5], 27, false)}
      <ellipse cx="19.5" cy="33" rx="3.4" ry="2.2" fill="var(--blush)" opacity=".5"/><ellipse cx="44.5" cy="33" rx="3.4" ry="2.2" fill="var(--blush)" opacity=".5"/>
      <ellipse cx="32" cy="32.5" rx="4" ry="2.8" fill="#33241c"/><ellipse cx="30.7" cy="31.6" rx="1.2" ry=".7" fill="#fff" opacity=".6"/>
      <path d="M32 35.3v2.2m0 0q-2.8 2.8-5.5.8m5.5-.8q2.8 2.8 5.5.8" stroke="#33241c" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path class="tongue" d="M29.6 39.6h4.8v3.2a2.4 2.4 0 0 1-4.8 0z" fill="#ff7f93"/>
      ${shades(22)}
    </g>
  </svg>`;

// walking, seen from the side and facing right (the page flips it when they head left)
const leg = (x, y, phase, colour, paw) =>
  `<g transform="translate(${x} ${y})"><g class="leg ${phase}"><path d="M0 0v13" stroke="${colour}" stroke-width="6" stroke-linecap="round"/>${paw ? `<ellipse cx="1.2" cy="14.4" rx="4.6" ry="2.7" fill="${paw}"/>` : ''}</g></g>`;

const catWalkArt = () => `
  <svg class="pet-art cat-walk" viewBox="0 0 80 56" aria-hidden="true" focusable="false">
    ${leg(27, 36, 'a', 'var(--fur-d)')}${leg(55, 36, 'b', 'var(--fur-d)')}
    <path class="tail" d="M17 29C5 29 2 15 10 8" fill="none" stroke="var(--fur)" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="38" cy="29" rx="23" ry="12" fill="var(--fur)"/>
    <ellipse cx="40" cy="36" rx="15" ry="5.5" fill="var(--belly)" opacity=".85"/>
    <path d="M27 19v6M35 18v7M43 19v6" stroke="var(--fur-d)" stroke-width="2.2" stroke-linecap="round"/>
    ${leg(21, 37, 'b', 'var(--fur)', 'var(--belly)')}${leg(60, 37, 'a', 'var(--fur)', 'var(--belly)')}
    <path class="scarf" d="M55 31q9 7 19-2v5q-10 9-19 2z M63 35l4 10-5 1z"/>
    <g class="head-walk">
      <path d="M55 14 57 2l7 7z" fill="var(--fur)"/><path d="M65 9 71 2l1.5 12z" fill="var(--fur)"/>
      <path d="M58 11l.8-5 3.4 3.4zM67 10l3-4 .6 5.6z" fill="var(--ear-in)"/>
      <circle cx="64" cy="21" r="12" fill="var(--fur)"/>
      <ellipse cx="68.5" cy="20.5" rx="2.5" ry="3.3" fill="#33241c"/><circle cx="69.3" cy="19.2" r="1" fill="#fff"/>
      <ellipse cx="62.5" cy="27" rx="3" ry="2" fill="var(--blush)" opacity=".5"/>
      <path d="M73.4 23.6l3 .5-1.6 2z" fill="#f2828e"/>
      <path d="M74.6 26q-2 2.2-4.2.8" stroke="#33241c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M71 26l8-2M71 27.5l8 2" stroke="#fff" stroke-width="1.1" opacity=".85" stroke-linecap="round"/>
      <g class="shades"><rect x="62" y="15.5" width="13" height="9" rx="4.5"/><path d="M62 19l-7-1.5" stroke="#26272b" stroke-width="1.8"/></g>
    </g>
  </svg>`;

const dogWalkArt = () => `
  <svg class="pet-art dog-walk" viewBox="0 0 80 56" aria-hidden="true" focusable="false">
    ${leg(27, 36, 'a', 'var(--fur-d)')}${leg(55, 36, 'b', 'var(--fur-d)')}
    <path class="tail" d="M17 25C8 23 5 14 11 7" fill="none" stroke="var(--fur)" stroke-width="6.5" stroke-linecap="round"/>
    <ellipse cx="38" cy="29" rx="22" ry="12" fill="var(--fur)"/>
    <ellipse cx="40" cy="36" rx="14" ry="5.5" fill="var(--belly)" opacity=".9"/>
    <ellipse cx="33" cy="22" rx="12" ry="6" fill="var(--fur-d)" opacity=".45"/>
    ${leg(22, 37, 'b', 'var(--fur)', 'var(--belly)')}${leg(58, 37, 'a', 'var(--fur)', 'var(--belly)')}
    <path class="scarf" d="M54 31q9 7 19-2v5q-10 9-19 2z M62 35l4 10-5 1z"/>
    <g class="head-walk">
      <circle cx="62" cy="20" r="11.5" fill="var(--fur)"/>
      <ellipse cx="71" cy="24.5" rx="8" ry="6" fill="var(--belly)"/>
      <ellipse cx="77.4" cy="21.8" rx="3" ry="2.4" fill="#33241c"/><ellipse cx="76.6" cy="21" rx="1" ry=".6" fill="#fff" opacity=".6"/>
      <ellipse cx="65.5" cy="18" rx="2.4" ry="3.1" fill="#33241c"/><circle cx="66.3" cy="16.8" r="1" fill="#fff"/>
      <ellipse cx="61" cy="26" rx="3" ry="2" fill="var(--blush)" opacity=".5"/>
      <path d="M72 27.5q3 2 6.2 0" stroke="#33241c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path class="tongue" d="M73.8 28.3h4v3.6a2 2 0 0 1-4 0z" fill="#ff7f93"/>
      <g class="shades"><rect x="61" y="14" width="13" height="9" rx="4.5"/><path d="M61 18l-6-1" stroke="#26272b" stroke-width="1.8"/></g>
      <g transform="rotate(18 57 12)"><ellipse class="ear" cx="56" cy="19" rx="5.5" ry="10.5" fill="var(--ear)"/></g>
    </g>
  </svg>`;

function birdArt(mode = 'perch') {
  return `
  <svg class="pet-art bird ${mode}" viewBox="0 0 48 40" aria-hidden="true" focusable="false">
    <g class="bird-body">
      <path class="b-tail" d="M9 22 1 17l2 8-2 4 10-2z" fill="var(--wing)"/>
      <ellipse cx="22" cy="23" rx="14" ry="11" fill="var(--bird)"/>
      <ellipse cx="24" cy="27" rx="9" ry="6.5" fill="var(--belly)"/>
      <circle cx="33" cy="16" r="9" fill="var(--bird)"/>
      <path d="M41 15l6 2.5-6 2.5z" fill="#ff9f43"/>
      <g class="eyes-open"><circle cx="35.5" cy="14.5" r="1.9" fill="#2b2b33"/><circle cx="36.1" cy="13.8" r=".6" fill="#fff"/></g>
      <path class="eyes-closed" d="M33.2 14.8q2.3 2.4 4.6 0" fill="none" stroke="#2b2b33" stroke-width="1.6" stroke-linecap="round"/>
      <ellipse cx="31.5" cy="19.5" rx="2.6" ry="1.6" fill="#ff9aa2" opacity=".6"/>
      <path class="b-wing" d="M14 21q8-11 16 1-8 7-16-1z" fill="var(--wing)"/>
    </g>
    ${mode === 'perch' ? '<path d="M20 33v5M26 33v5" stroke="#ff9f43" stroke-width="1.8" stroke-linecap="round" fill="none"/>' : ''}
  </svg>`;
}

const butterflyArt = () => `
  <svg class="butterfly-art" viewBox="0 0 24 20" aria-hidden="true" focusable="false">
    <g class="wing wl"><ellipse cx="7" cy="7" rx="6.4" ry="5.4" fill="#ff8fb1"/><ellipse cx="8" cy="14" rx="4.4" ry="3.6" fill="#ffd166"/></g>
    <g class="wing wr"><ellipse cx="17" cy="7" rx="6.4" ry="5.4" fill="#ff8fb1"/><ellipse cx="16" cy="14" rx="4.4" ry="3.6" fill="#ffd166"/></g>
    <ellipse cx="12" cy="10" rx="1.3" ry="5.5" fill="#5b4636"/>
    <path d="M12 5q-1-3-3-3.5M12 5q1-3 3-3.5" stroke="#5b4636" stroke-width=".9" fill="none" stroke-linecap="round"/>
  </svg>`;

/* ---------- the garden: grass and flowers along the card edge, a bush, a tree ---------- */
const FLOWERS = ['#ff8fb1', '#ffd23f', '#ffffff', '#b79cff', '#ff9f68'];

const yearSeason = (iso) => {
  const month = Number(iso.slice(5, 7));
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
};

const tuft = (season) => {
  const flower = season === 'spring' || season === 'summer' || (season === 'autumn' && Math.random() < 0.3);
  return `<svg class="tuft" style="left:${rand(1, 94).toFixed(1)}%;--sway-d:${rand(2.5, 4.5).toFixed(1)}s" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
    <path d="M3 14q0-6-2-9M7 14q0-7 0-11M11 14q0-6 2-9" stroke="var(--blade)" stroke-width="1.9" fill="none" stroke-linecap="round"/>
    ${flower ? `<circle cx="7" cy="3" r="2.4" fill="${pick(FLOWERS)}"/><circle cx="7" cy="3" r="0.9" fill="#ffd23f"/>` : ''}
  </svg>`;
};

const treeArt = () => `
  <svg class="tree-art" viewBox="0 0 64 80" aria-hidden="true" focusable="false">
    <rect x="28" y="46" width="9" height="33" rx="4" fill="#9a6b3f"/>
    <path d="M32 66l-9-9" stroke="#9a6b3f" stroke-width="4" stroke-linecap="round"/>
    <g class="canopy">
      <circle cx="32" cy="27" r="21" fill="var(--tree)"/><circle cx="16" cy="39" r="14" fill="var(--tree)"/><circle cx="48" cy="39" r="14" fill="var(--tree)"/>
      <circle cx="24" cy="20" r="9" fill="var(--tree-hi)" opacity=".75"/><circle cx="42" cy="46" r="6" fill="var(--tree-hi)" opacity=".5"/>
      <circle cx="20" cy="38" r="2.4" fill="var(--fruit)"/><circle cx="43" cy="30" r="2.4" fill="var(--fruit)"/><circle cx="33" cy="42" r="2.4" fill="var(--fruit)"/><circle cx="30" cy="16" r="2.4" fill="var(--fruit)"/>
    </g>
  </svg>`;

const firArt = () => `
  <svg class="tree-art" viewBox="0 0 64 80" aria-hidden="true" focusable="false">
    <rect x="29" y="64" width="7" height="15" rx="3" fill="#8a5d36"/>
    <g class="canopy">
      <path d="M32 4 51 30H13z" fill="#4f9470"/><path d="M32 20 55 52H9z" fill="#4a8a69"/><path d="M32 38 60 70H4z" fill="#437f61"/>
      <path d="M32 4l6 8q-6-2-12 0zM32 20l7 9q-7-2-14 0zM32 38l8 10q-8-2-16 0z" fill="#fff"/>
    </g>
  </svg>`;

const bushArt = () => `
  <svg class="bush-art" viewBox="0 0 48 30" aria-hidden="true" focusable="false">
    <ellipse cx="24" cy="22" rx="23" ry="8" fill="var(--bush-d)"/>
    <circle cx="14" cy="17" r="11" fill="var(--bush)"/><circle cx="30" cy="14" r="13" fill="var(--bush)"/><circle cx="39" cy="20" r="8" fill="var(--bush)"/>
    <circle cx="12" cy="14" r="2" fill="var(--flower)"/><circle cx="27" cy="9" r="2" fill="var(--flower)"/><circle cx="36" cy="18" r="2" fill="var(--flower)"/><circle cx="22" cy="20" r="2" fill="var(--flower)"/>
  </svg>`;

// a few leaves or petals that let go of the tree now and then
const fallers = (season) => season === 'autumn' || season === 'spring'
  ? many(3, (i) => `<i class="tleaf ${season === 'autumn' ? 'leaf' : 'petal'}" style="left:${Math.round(rand(8, 44))}px;--d:${rand(5, 8).toFixed(1)}s;--delay:${(-i * 2.2 - rand(0, 1.5)).toFixed(1)}s;--c:${pick(season === 'autumn' ? LEAF_COLORS : PETAL_COLORS)}"><b></b></i>`)
  : '';

function gardenHtml({ season, kind }) {
  const winter = season === 'winter' || kind === 'snow';
  return `<div class="garden" data-season="${winter ? 'winter' : season}">
    ${many(13, () => tuft(winter ? 'winter' : season))}
    <div class="bush">${bushArt()}</div>
    <div class="tree">${winter ? firArt() : treeArt()}${winter ? '' : fallers(season)}</div>
  </div>`;
}

/* ---------- the animals ---------- */
const WHO = {
  cat: { label: 'แมว', says: ['เมี๊ยว~', 'เหมียว!', 'ขอลูบหัวหน่อย~'], poses: () => `<span class="pose sit">${catArt()}</span><span class="pose walk">${catWalkArt()}</span>` },
  dog: { label: 'น้องหมา', says: ['โฮ่ง โฮ่ง!', 'โฮ่ง!', 'ดีใจจัง!'], poses: () => `<span class="pose sit">${dogArt()}</span><span class="pose walk">${dogWalkArt()}</span>` },
  bird: { label: 'นก', says: ['จิ๊บ จิ๊บ', 'จิ๊บ~', 'ติ๊ว ติ๊ว'], poses: () => `<span class="pose sit">${birdArt('perch')}</span><span class="pose fly">${birdArt('fly')}</span>` },
};

// start = where along the yard (0 – 1) it first appears
const walker = (who, { pose = '', start = 0.5 } = {}) => `
  <div class="walker" data-who="${who}" data-state="sit" data-start="${start}"${pose ? ` data-pose="${pose}"` : ''}>
    <button type="button" class="critter" data-who="${who}"${pose ? ` data-pose="${pose}"` : ''} aria-label="${WHO[who].label} แตะเพื่อทักทาย">
      <span class="art"><span class="arc">${WHO[who].poses()}</span></span>
      <span class="say" aria-hidden="true"></span><span class="zzz" aria-hidden="true"><i>z</i><i>z</i></span>
    </button>
  </div>`;

const butterfly = () => `<div class="butterfly" aria-hidden="true"><div class="flutter">${butterflyArt()}</div></div>`;

function renderYards() {
  $('#critters-today').innerHTML = '<div class="garden"></div>' + walker('cat', { start: 0.38 }) + walker('dog', { start: 0.62 }) + butterfly();
  $('#critters-calendar').innerHTML = '<div class="garden"></div>' + walker('bird', { start: 0.5 }) + butterfly();
  $('#critters-more').innerHTML = '<div class="garden"></div>' + walker('cat', { pose: 'sleep', start: 0.45 }) + butterfly();
}

function renderGardens(state) {
  const html = gardenHtml(state);
  document.querySelectorAll('.garden').forEach((el) => {
    el.outerHTML = html;
  });
}

// Tap a critter: it hops and says something (or snores, at night). They also speak up on their own now and then.
function react(el, { buzz = true } = {}) {
  const who = WHO[el.dataset.who];
  const asleep = root.dataset.sleep === '1' || el.dataset.pose === 'sleep';
  const n = Number(el.dataset.n ?? 0);
  el.dataset.n = String(n + 1);
  el.querySelector('.say').textContent = asleep ? '…ฟี้ ฟี้' : who.says[n % who.says.length];
  el.classList.remove('is-hopping');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-hopping', 'is-saying');
  if (buzz) haptic(10);
  clearTimeout(el._sayTimer);
  el._sayTimer = setTimeout(() => el.classList.remove('is-saying'), 1700);
}

document.addEventListener('click', (e) => {
  const critter = e.target.closest('.critter');
  if (critter) return react(critter);
  const bin = e.target.closest('.lineup-item');
  if (bin && !bin.closest('.is-bare')) { // the bins react too
    haptic(6);
    bin.classList.remove('is-bouncing');
    void bin.offsetWidth;
    bin.classList.add('is-bouncing');
  }
});

/* ---------- life: wandering, hopping, flying ---------- */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const resting = (el) => reducedMotion.matches || root.dataset.sleep === '1' || el.dataset.pose === 'sleep';

function mover(walkerEl) {
  const yard = walkerEl.parentElement;
  const arc = walkerEl.querySelector('.arc');
  let x = NaN;
  return {
    get x() { return x; },
    width: () => yard.clientWidth,
    // ms = how long the slide takes (0 = jump straight there)
    place(to, ms = 0, easing = 'linear') {
      walkerEl.style.transitionDuration = `${ms}ms`;
      walkerEl.style.transitionTimingFunction = easing;
      walkerEl.style.setProperty('--x', to.toFixed(1));
      x = to;
      walkerEl.dataset.x = String(Math.round(to));
    },
    face: (dir) => walkerEl.style.setProperty('--dir', String(dir)),
    jump(height, ms) {
      arc.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-height}px)`, offset: 0.5 }, { transform: 'translateY(0)' }], { duration: ms, easing: 'ease-out' });
    },
  };
}

const bounds = (w) => [38, w - 38];

// cat and dog: sit a while, stroll somewhere else, sometimes jump for joy or say hello
async function roam(walkerEl, { speed, other }) {
  const m = mover(walkerEl);
  const button = walkerEl.querySelector('.critter');
  for (;;) {
    const w = m.width();
    if (!w || document.hidden) {
      await sleep(1500);
      continue;
    }
    const [min, max] = bounds(w);
    if (Number.isNaN(m.x) || m.x < min || m.x > max) m.place(clamp(Number.isNaN(m.x) ? w * Number(walkerEl.dataset.start) : m.x, min, max));
    if (resting(walkerEl)) {
      walkerEl.dataset.state = 'sit';
      await sleep(4000);
      continue;
    }
    const mood = Math.random();
    if (mood < 0.2) {
      m.jump(14, 420);
      react(button, { buzz: false });
      await sleep(1100);
    } else if (mood < 0.35) {
      react(button, { buzz: false });
      await sleep(1700);
    }
    let to = rand(min, max);
    for (let i = 0; i < 6; i++) {
      const friend = other?.() ? Number(other().dataset.x) : NaN;
      if (Math.abs(to - m.x) > 60 && (Number.isNaN(friend) || Math.abs(to - friend) > 52)) break;
      to = rand(min, max);
    }
    const ms = (Math.abs(to - m.x) / speed) * 1000;
    m.face(to > m.x ? 1 : -1);
    walkerEl.dataset.state = 'walk';
    m.place(to, ms);
    await sleep(ms + 80);
    walkerEl.dataset.state = 'sit';
    await sleep(rand(2200, 6500));
  }
}

// the bird: a few quick hops along the edge, now and then a short flight, then a rest
async function flit(walkerEl) {
  const m = mover(walkerEl);
  for (;;) {
    const w = m.width();
    if (!w || document.hidden) {
      await sleep(1500);
      continue;
    }
    const [min, max] = bounds(w);
    if (Number.isNaN(m.x) || m.x < min || m.x > max) m.place(clamp(Number.isNaN(m.x) ? w * Number(walkerEl.dataset.start) : m.x, min, max));
    if (resting(walkerEl)) {
      walkerEl.dataset.state = 'sit';
      await sleep(4000);
      continue;
    }
    const roll = Math.random();
    if (roll < 0.6) {
      let dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0, hops = 2 + Math.floor(Math.random() * 3); i < hops; i++) {
        let to = m.x + dir * rand(16, 28);
        if (to < min || to > max) {
          dir = -dir;
          to = m.x + dir * rand(16, 28);
        }
        m.face(dir);
        m.place(clamp(to, min, max), 320, 'ease-out');
        m.jump(11, 320);
        await sleep(430);
      }
    } else if (roll < 0.88) {
      let to = rand(min, max);
      for (let i = 0; i < 6 && Math.abs(to - m.x) < 90; i++) to = rand(min, max);
      const ms = Math.max(900, (Math.abs(to - m.x) / 80) * 1000);
      m.face(to > m.x ? 1 : -1);
      walkerEl.dataset.state = 'fly';
      m.place(to, ms, 'ease-in-out');
      m.jump(34, ms);
      await sleep(ms + 80);
      walkerEl.dataset.state = 'sit';
    }
    await sleep(rand(1800, 5200));
  }
}

// the butterfly drifts around the yard while the sun is out
async function drift(el) {
  const yard = el.parentElement;
  for (;;) {
    const w = yard.clientWidth;
    if (!w || document.hidden || reducedMotion.matches || root.dataset.bfly !== '1') {
      await sleep(2000);
      continue;
    }
    const ms = rand(2400, 3800);
    el.style.transitionDuration = `${ms}ms`;
    el.style.setProperty('--bx', rand(14, w - 14).toFixed(0));
    el.style.setProperty('--by', (-rand(10, 86)).toFixed(0));
    await sleep(ms);
  }
}

function startLife() {
  const find = (yard, who) => document.querySelector(`#${yard} .walker[data-who="${who}"]`);
  const cat = find('critters-today', 'cat');
  const dog = find('critters-today', 'dog');
  const bird = find('critters-calendar', 'bird');
  const nap = find('critters-more', 'cat');
  const run = (promise) => promise.catch((err) => console.warn('critters:', err));
  run(roam(cat, { speed: 26, other: () => dog }));
  run(roam(dog, { speed: 46, other: () => cat }));
  run(flit(bird));
  run(roam(nap, { speed: 20 }));
  document.querySelectorAll('.butterfly').forEach((el) => run(drift(el)));
}

/* ---------- put it together ---------- */
export function initScene({ config, getClock, onChange = () => {} }) {
  const cfg = { enabled: true, lat: 48.27, lon: 10.89, ...(config.weather ?? {}) };
  const forcedKind = new URLSearchParams(location.search).get('sky');
  const forced = KINDS[forcedKind] ? forcedKind : null;
  let weather = forced ? { kind: forced, at: Date.now() } : cfg.enabled === false ? null : readCache();
  let shown = '';
  let gardenKey = '';
  let pending = false;

  function paint() {
    const clock = getClock();
    const night = isNight(clock.date, clock.minutes, config.timezone, cfg.lon);
    const kind = weather?.kind ?? 'clear';
    const season = seasonOf(clock.date);
    const yearly = yearSeason(clock.date);
    root.dataset.night = night ? '1' : '0';
    root.dataset.sleep = clock.minutes >= 22 * 60 || clock.minutes < 6 * 60 ? '1' : '0'; // the animals nap late at night
    root.dataset.wx = kind;
    root.dataset.bfly = !night && ['clear', 'partly', 'cloudy'].includes(kind) && yearly !== 'winter' ? '1' : '0';
    const gKey = `${yearly}|${kind === 'snow'}`;
    if (gKey !== gardenKey) {
      gardenKey = gKey;
      renderGardens({ season: yearly, kind });
    }
    const key = `${kind}|${night}|${season}`;
    if (key === shown) return;
    shown = key;
    // the same sky sits behind the header of every screen
    document.querySelectorAll('.sky').forEach((sky, uid) => {
      sky.dataset.kind = kind;
      sky.dataset.night = night ? '1' : '0';
      sky.innerHTML = `<div class="sky-in">${skyHtml({ kind, night, season, uid })}</div>`;
    });
  }

  async function refresh() {
    if (forced || cfg.enabled === false || pending) return;
    if (weather && Date.now() - weather.at < FRESH_MS) return;
    pending = true;
    try {
      weather = await fetchWeather(cfg);
    } catch {
      // offline, blocked or slow: keep whatever we already have
    }
    pending = false;
    paint();
    onChange();
  }

  renderYards();
  paint();
  startLife();
  refresh();

  return {
    update() {
      paint();
      refresh();
    },
    // e.g. "11° · ฟ้าครึ้ม", or '' when the weather is unknown
    label() {
      if (!weather) return '';
      const text = KINDS[weather.kind][root.dataset.night === '1' ? 1 : 0];
      return weather.temp == null ? text : `${weather.temp}° · ${text}`;
    },
  };
}
