// Waste type definitions shared by the web app (browser) and the Node scripts.
// `ctrace` is the exact text AWB's calendar puts after "Abfuhr: " in each ICS event.

// `short` is the compact label used in wide calendar cells and the printed sheet.
export const GROUPS = {
  restmuell: { icon: '🗑️', th: 'ขยะทั่วไป', short: 'ทั่วไป', de: 'Restmüll' },
  bio: { icon: '🍂', th: 'ขยะอินทรีย์ / เศษอาหาร', short: 'อินทรีย์', de: 'Biotonne' },
  papier: { icon: '📄', th: 'กระดาษ', short: 'กระดาษ', de: 'Altpapier' },
  wertstoff: { icon: '♻️', th: 'รีไซเคิล พลาสติก-โลหะ', short: 'รีไซเคิล', de: 'Wertstofftonne' },
  problem: { icon: '⚠️', th: 'ขยะอันตราย', short: 'อันตราย', de: 'Problemabfall' },
  other: { icon: '🗑️', th: 'ขยะ', short: 'อื่นๆ', de: 'Abfall' },
};

export const BINS = {
  'restmuell-tonne': {
    ctrace: 'Restmüll Tonne',
    group: 'restmuell',
    de: 'Restmülltonne',
    detail: 'ถัง 80 / 120 / 240 ลิตร · ทุก 2 สัปดาห์',
  },
  'restmuell-container': {
    ctrace: 'Restmüll Container',
    group: 'restmuell',
    de: 'Restmüllcontainer',
    detail: 'คอนเทนเนอร์ 770 / 1100 ลิตร · ทุกสัปดาห์',
  },
  'restmuell-container-2w': {
    ctrace: 'Restmüll Container 2w',
    group: 'restmuell',
    de: 'Restmüllcontainer (2-wöchentlich)',
    detail: 'คอนเทนเนอร์ 770 / 1100 ลิตร · ทุก 2 สัปดาห์',
  },
  biotonne: {
    ctrace: 'Biotonne',
    group: 'bio',
    de: 'Biotonne',
    detail: 'ทุก 2 สัปดาห์',
  },
  'altpapier-tonne': {
    ctrace: 'Altpapier Tonne',
    group: 'papier',
    de: 'Altpapiertonne',
    detail: 'ถัง 240 ลิตร · ทุก 4 สัปดาห์',
  },
  'altpapier-container': {
    ctrace: 'Altpapier Container',
    group: 'papier',
    de: 'Altpapiercontainer',
    detail: 'คอนเทนเนอร์ 1100 ลิตร · ทุก 2 สัปดาห์',
  },
  wertstoff: {
    ctrace: 'Wertstofftonne / Gelber Container',
    group: 'wertstoff',
    de: 'Wertstofftonne / Gelber Container',
    detail: 'ทุก 2 สัปดาห์',
  },
  problemabfall: {
    ctrace: 'Problemabfallsammlung',
    group: 'problem',
    de: 'Problemabfallsammlung',
    detail: 'รอบพิเศษ',
    note: 'ดูเวลาและจุดรับที่เว็บไซต์ AWB',
    special: true, // not a bin put-out day, so the "bins out by 06:30" rule is not shown for it
  },
};

const BY_CTRACE = new Map(Object.entries(BINS).map(([key, bin]) => [bin.ctrace, key]));

// "Abfuhr: Biotonne" -> "biotonne". Unknown types become "?<raw text>" so a new
// AWB category still shows up instead of silently disappearing.
export function binFromSummary(summary) {
  const raw = summary.replace(/^Abfuhr:\s*/i, '').trim();
  return BY_CTRACE.get(raw) ?? `?${raw}`;
}

export function binInfo(key) {
  const bin = BINS[key];
  if (bin) {
    const group = GROUPS[bin.group];
    return { key, ...bin, th: group.th, short: group.short, icon: group.icon };
  }
  const raw = key.replace(/^\?/, '');
  return { key, group: 'other', th: raw, short: raw, de: raw, icon: GROUPS.other.icon, detail: '' };
}

// config.enabledBins: null / empty = show every type; otherwise only those keys.
export function isEnabled(config, key) {
  const list = config.enabledBins;
  return !Array.isArray(list) || list.length === 0 || list.includes(key);
}

// True when at least one bin must be put out (i.e. the day is not only a special collection).
export const needsBinOut = (bins) => bins.some((b) => !b.special);

const ORDER = Object.keys(BINS);
export function sortBins(keys) {
  const rank = (k) => {
    const i = ORDER.indexOf(k);
    return i === -1 ? ORDER.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
