// Appearance preferences: colour theme (light / dark / automatic) and text size.
//
// Both are written to <html> as data attributes (data-theme, data-text-size) and the
// stylesheet only keys off those. A tiny inline script in index.html sets them before the
// first paint (no flash); this module takes over afterwards.
const THEME_KEY = 'waste.theme';
const TEXT_KEY = 'waste.textSize';
const system = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

const META_COLOR = { light: '#f5f5f7', dark: '#000000' };
export const TEXT_SIZES = ['normal', 'large', 'xlarge'];

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

/* ---------- theme ---------- */
export function getPreference() {
  const stored = read(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export const effectiveTheme = (preference = getPreference()) => (preference === 'auto' ? (system.matches ? 'dark' : 'light') : preference);

function paint() {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
  listeners.forEach((fn) => fn(theme));
}

export function setPreference(preference) {
  write(THEME_KEY, preference === 'auto' ? null : preference);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !calm) {
    // cross-fade between themes; a transition that gets skipped (tab hidden, a second tap) is not an error
    const transition = document.startViewTransition(paint);
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } else paint();
}

// "Automatic" follows the device, live.
system.addEventListener('change', () => {
  if (getPreference() === 'auto') paint();
});

export const onThemeChange = (fn) => listeners.add(fn);

/* ---------- text size ---------- */
export function getTextSize() {
  const stored = read(TEXT_KEY);
  return TEXT_SIZES.includes(stored) ? stored : 'normal';
}

function paintTextSize() {
  const size = getTextSize();
  if (size === 'normal') delete document.documentElement.dataset.textSize;
  else document.documentElement.dataset.textSize = size;
}

export function setTextSize(size) {
  write(TEXT_KEY, size === 'normal' ? null : size);
  paintTextSize();
}

paint();
paintTextSize();
