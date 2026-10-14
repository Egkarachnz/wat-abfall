// Date helpers shared by the web app and the Node scripts.
// Dates are ISO strings ('YYYY-MM-DD'); arithmetic runs in UTC so DST never shifts a day.

export const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export const toUtc = (d) => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
export const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => fromUtc(toUtc(d) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
export const weekday = (d) => new Date(toUtc(d)).getUTCDay(); // 0 = Sunday

export const parts = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, d: day };
};
export const makeIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const longDate = (d) => `วัน${WEEKDAYS[weekday(d)]}ที่ ${parts(d).d} ${MONTHS[parts(d).m - 1]}`;
export const shortDate = (d) => `${parts(d).d} ${MONTHS_SHORT[parts(d).m - 1]} ${parts(d).y}`;
export const relative = (n) => (n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : n === 2 ? 'มะรืนนี้' : `อีก ${n} วัน`);
