// Light / dark / automatic appearance.
//
// The effective theme is always written to <html data-theme="light|dark"> and the
// stylesheet only keys off that attribute. A tiny inline script in index.html sets it
// before the first paint (no flash); this module takes over afterwards.
const KEY = 'waste.theme';
const system = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

const META_COLOR = { light: '#f5f5f7', dark: '#000000' };

export function getPreference() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export const effectiveTheme = (preference = getPreference()) => (preference === 'auto' ? (system.matches ? 'dark' : 'light') : preference);

function paint() {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
  listeners.forEach((fn) => fn(theme));
}

export function setPreference(preference) {
  try {
    if (preference === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {}
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !calm) document.startViewTransition(paint); // cross-fade between themes
  else paint();
}

// "Automatic" follows the device, live.
system.addEventListener('change', () => {
  if (getPreference() === 'auto') paint();
});

export const onThemeChange = (fn) => listeners.add(fn);
paint();
