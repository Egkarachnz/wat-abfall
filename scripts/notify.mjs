#!/usr/bin/env node
// Sends "put the bins out tonight" to the organisation by e-mail.
// Does nothing when tomorrow has no collection.
//
//   node scripts/notify.mjs [--dry-run] [--today=YYYY-MM-DD]
//
// SMTP settings come from environment variables (GitHub Actions secrets):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
//   MAIL_FROM  sender, e.g. "ตารางเก็บขยะ <noreply@example.org>"
//   MAIL_TO    recipients, comma separated — sent as BCC so nobody sees the others
import nodemailer from 'nodemailer';
import { binInfo, isEnabled, needsBinOut, sortBins } from '../js/bins.js';
import { addDays, longDate, relative } from '../js/dates.js';
import { file, loadConfig, readJson, todayIn } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const todayArg = args.find((a) => a.startsWith('--today='))?.slice('--today='.length);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function groupBins(bins) {
  const map = new Map();
  for (const b of bins) {
    if (!map.has(b.group)) map.set(b.group, { icon: b.icon, th: b.th, items: [] });
    map.get(b.group).items.push(b);
  }
  return [...map.values()];
}

function composeMessage({ config, bins, date, announcements }) {
  const groups = groupBins(bins);
  const label = groups.map((g) => g.th).join(' + ');
  const when = longDate(date);
  const address = `${config.address.strasse} ${config.address.hausnr}, ${config.address.plz} ${config.address.ort}`;
  const out = needsBinOut(bins);
  const rule = out ? 'วางถังที่จุดรับก่อน 06:30 น. ของพรุ่งนี้เช้า' : 'ดูเวลาและจุดรับที่เว็บไซต์ AWB';

  const subject = `${groups.map((g) => g.icon).join('')} ${out ? 'คืนนี้นำถังออก' : 'พรุ่งนี้มีรอบเก็บขยะอันตราย'}: ${label} (${when})`;

  const text = [
    `พรุ่งนี้ ${when} มีเก็บขยะ`,
    '',
    ...groups.flatMap((g) => [`${g.icon} ${g.th}`, ...g.items.map((b) => `   ${b.de}${b.detail ? ` · ${b.detail}` : ''}${b.note ? ` — ${b.note}` : ''}`)]),
    '',
    rule,
    ...(announcements.length ? ['', 'ประกาศ:', ...announcements.map((a) => `- ${[a.title, a.body].filter(Boolean).join(' — ')}`)] : []),
    '',
    `${config.orgName} · ${address}`,
  ].join('\n');

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;line-height:1.5;color:#1f2430">
    <p style="margin:0 0 4px;color:#9a5b00;font-weight:700">${out ? 'คืนนี้ต้องนำถังออก' : 'พรุ่งนี้มีรอบเก็บขยะอันตราย'}</p>
    <h2 style="margin:0 0 12px;font-size:20px">พรุ่งนี้ ${esc(when)}</h2>
    ${groups.map((g) => `<div style="background:#f4f1ea;border-radius:10px;padding:10px 14px;margin:0 0 8px">
        <div style="font-size:17px;font-weight:700">${g.icon} ${esc(g.th)}</div>
        ${g.items.map((b) => `<div style="font-size:14px;color:#5d6573">${esc(b.de)}${b.detail ? ` · ${esc(b.detail)}` : ''}${b.note ? ` — ${esc(b.note)}` : ''}</div>`).join('')}
      </div>`).join('')}
    <p style="margin:12px 0"><strong>${esc(rule)}</strong></p>
    ${announcements.map((a) => `<p style="background:#fdf0d5;border-radius:10px;padding:8px 12px;margin:8px 0"><strong>${esc(a.title ?? '')}</strong> ${esc(a.body ?? '')}</p>`).join('')}
    <p style="font-size:12px;color:#5d6573">${esc(config.orgName)} · ${esc(address)}</p>
  </div>`;

  return { subject, text, html };
}

async function main() {
  const config = await loadConfig();
  const today = todayArg ?? todayIn(config.timezone);
  const tomorrow = addDays(today, 1);
  const collections = await readJson(file('data', 'collections.json'));
  const announcements = (await readJson(file('data', 'announcements.json'), [])).filter(
    (a) => (!a.from || a.from <= today) && (!a.until || a.until >= today),
  );

  const keys = (collections.days[tomorrow] ?? []).filter((k) => isEnabled(config, k));
  if (!keys.length) {
    console.log(`${tomorrow} (${relative(1)}): no collection — nothing to send`);
    return;
  }

  const message = composeMessage({ config, bins: sortBins(keys).map(binInfo), date: tomorrow, announcements });

  if (dryRun) {
    console.log(`DRY RUN — would send for ${tomorrow}\nSubject: ${message.subject}\n\n${message.text}`);
    return;
  }

  const { SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO } = process.env;
  const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const recipients = MAIL_TO.split(',').map((s) => s.trim()).filter(Boolean);
  await transport.sendMail({ from: MAIL_FROM, to: MAIL_FROM, bcc: recipients, ...message });
  console.log(`sent to ${recipients.length} recipient(s): ${message.subject}`);
}

main().catch((err) => {
  console.error(`notify failed: ${err.message}`);
  process.exit(1);
});
