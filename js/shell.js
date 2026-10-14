// App chrome: tab navigation, bottom sheet, toast, pull-to-refresh, install helpers.
// Nothing in here knows about waste data — js/app.js decides what goes inside.

const $ = (selector) => document.querySelector(selector);

// Android vibrates; iOS ignores it silently.
export const haptic = (ms = 8) => {
  try {
    if (navigator.userActivation?.hasBeenActive === false) return; // browsers refuse (and log) vibration before a tap
    navigator.vibrate?.(ms);
  } catch {}
};

/* ---------- toast ---------- */
let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

/* ---------- tabs ---------- */
const TABS = ['today', 'calendar', 'more'];

export function initTabs(initial) {
  const scrolls = {};
  const navbar = $('#navbar');
  const navTitle = $('#navbar-title');
  let current = null;
  let observer = null;

  // The condensed title in the navigation bar follows the active screen's large title.
  function watchTitle(screen) {
    observer?.disconnect();
    const heading = screen.querySelector('h1');
    navTitle.textContent = heading.textContent;
    navbar.classList.remove('is-visible');
    if (!('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(([entry]) => navbar.classList.toggle('is-visible', !entry.isIntersecting), {
      rootMargin: '-52px 0px 0px 0px', // height of the navigation bar
    });
    observer.observe(heading);
  }

  function show(name) {
    if (!TABS.includes(name)) name = 'today';
    if (name === current) {
      window.scrollTo({ top: 0, behavior: 'smooth' }); // tapping the active tab scrolls to top, like iOS
      return;
    }
    if (current) scrolls[current] = window.scrollY;
    for (const tab of TABS) {
      const screen = $(`#screen-${tab}`);
      screen.hidden = tab !== name;
      const button = document.querySelector(`[data-tab="${tab}"]`);
      if (tab === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    current = name;
    const screen = $(`#screen-${name}`);
    screen.classList.remove('is-entering');
    void screen.offsetWidth; // restart the animation
    screen.classList.add('is-entering');
    window.scrollTo(0, scrolls[name] ?? 0);
    watchTitle(screen);
    if (!history.state?.sheet) history.replaceState(history.state, '', `#${name}`);
  }

  $('#tabbar').addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button) return;
    haptic(6);
    show(button.dataset.tab);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  show(initial);
  return { show, current: () => current, refreshTitle: () => watchTitle($(`#screen-${current}`)) };
}

/* ---------- bottom sheet ---------- */
export function initSheet() {
  const sheet = $('#sheet');
  const backdrop = $('#sheet-backdrop');
  let isOpen = false;
  let opener = null;

  // A stale { sheet: true } entry can survive a reload; drop it so Back doesn't get stuck.
  if (history.state?.sheet) history.replaceState(null, '', location.href);

  function open({ title, meta = '', html, trigger }) {
    $('#sheet-title').textContent = title;
    $('#sheet-meta').textContent = meta;
    $('#sheet-body').innerHTML = html;
    $('#sheet-body').scrollTop = 0;
    opener = trigger ?? document.activeElement;
    isOpen = true;
    sheet.classList.add('is-open');
    backdrop.classList.add('is-open');
    document.body.classList.add('sheet-open');
    // Android's Back button (and the iOS edge swipe) close the sheet instead of leaving the app.
    if (!history.state?.sheet) history.pushState({ sheet: true }, '', location.href);
    requestAnimationFrame(() => $('#sheet-done').focus({ preventScroll: true }));
  }

  function hide() {
    if (!isOpen) return;
    isOpen = false;
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    opener?.focus?.({ preventScroll: true });
    opener = null;
  }

  function close() {
    if (!isOpen) return;
    if (history.state?.sheet) history.back(); // popstate below does the hiding
    else hide();
  }

  window.addEventListener('popstate', () => isOpen && hide());
  backdrop.addEventListener('click', close);
  $('#sheet-done').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      // keep keyboard focus inside the dialog
      const focusable = [...sheet.querySelectorAll('a[href], button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // drag the header down to dismiss
  let drag = null;
  const grab = $('#sheet-grab');
  grab.addEventListener('touchstart', (e) => {
    drag = { y: e.touches[0].clientY, at: Date.now(), dy: 0 };
    sheet.classList.add('is-dragging');
  }, { passive: true });
  grab.addEventListener('touchmove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
    sheet.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });
  const endDrag = () => {
    if (!drag) return;
    const { dy, at } = drag;
    drag = null;
    sheet.classList.remove('is-dragging');
    sheet.style.transform = '';
    if (dy > 100 || dy / (Date.now() - at) > 0.6) close();
  };
  grab.addEventListener('touchend', endDrag);
  grab.addEventListener('touchcancel', endDrag);

  return { open, close, isOpen: () => isOpen };
}

/* ---------- pull to refresh ---------- */
export function initPullToRefresh(onRefresh) {
  const ptr = $('#ptr');
  const THRESHOLD = 56;
  const MAX = 90;
  let startY = null;
  let dist = 0;
  let busy = false;

  const place = (d, loading = false) => {
    ptr.style.transform = `translateY(${d - 56}px)`;
    ptr.style.opacity = String(Math.min(1, d / 36));
    ptr.firstElementChild.style.transform = loading ? '' : `rotate(${d * 5}deg)`;
  };
  const reset = () => {
    ptr.classList.remove('is-pulling', 'is-loading');
    ptr.style.transform = '';
    ptr.style.opacity = '';
    ptr.firstElementChild.style.transform = '';
  };

  document.addEventListener('touchstart', (e) => {
    const blocked = busy || window.scrollY > 0 || e.touches.length !== 1 || document.body.classList.contains('sheet-open');
    startY = blocked ? null : e.touches[0].clientY;
    dist = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) {
      if (dist) reset();
      startY = null; // this gesture is a normal scroll
      dist = 0;
      return;
    }
    dist = Math.min(MAX, dy * 0.45); // resistance, like the native control
    ptr.classList.add('is-pulling');
    place(dist);
  }, { passive: true });

  const release = async () => {
    if (startY === null) return;
    const pulled = dist;
    startY = null;
    dist = 0;
    if (pulled < THRESHOLD * 0.8) {
      reset();
      return;
    }
    busy = true;
    haptic(10);
    ptr.classList.remove('is-pulling');
    ptr.classList.add('is-loading');
    place(THRESHOLD, true);
    try {
      await onRefresh();
    } finally {
      busy = false;
      reset();
    }
  };
  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
}

/* ---------- install ("Add to Home Screen") ---------- */
let deferredPrompt = null;
const listeners = new Set();

export const onInstallChange = (fn) => listeners.add(fn);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own button instead of the mini-infobar
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
});

export function installInfo() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return { standalone, ios, native: Boolean(deferredPrompt) };
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  return outcome === 'accepted';
}
