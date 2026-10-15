// © 2026 Phramaha Egkarach. All rights reserved. Not licensed for copying or reuse; see LICENSE.
// The whole-year schedule as a one-page A4 PDF, made in the browser with no library.
//
// Why: window.print() does nothing in an app installed to the iPhone home screen (and printing
// is patchy elsewhere). A PDF can always be shared, saved or printed through the phone's own
// share sheet. The page is drawn on a canvas and wrapped in a minimal PDF as one JPEG picture, so
// Thai text needs no embedded font (the price: the text in the PDF cannot be selected).

const W = 1240; // A4 at 150 dpi
const H = 1754;
const MARGIN = 64;
const PAGE = { w: 595.28, h: 841.89 }; // A4 in PDF points
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Leelawadee UI", "Noto Sans Thai", "Thonburi", Roboto, "Helvetica Neue", sans-serif';
const INK = '#1d1d1f';
const GREY = '#5a5a5f';

const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

// Phosphor icons are 256-unit paths; the markup string holds one or more <path d="…">
export const pathsOf = (markup) => [...markup.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);

function drawGlyph(ctx, paths, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 256, size / 256);
  ctx.fillStyle = color;
  for (const d of paths) ctx.fill(new Path2D(d));
  ctx.restore();
}

// split a day's items into lines no wider than maxW
function flow(ctx, items, fs, maxW) {
  const icon = fs * 1.05;
  const gap = fs * 0.75;
  const lines = [[]];
  let x = 0;
  ctx.font = font(fs, 500);
  for (const item of items) {
    const w = icon + fs * 0.3 + ctx.measureText(item.text).width;
    if (x > 0 && x + gap + w > maxW) {
      lines.push([]);
      x = 0;
    }
    const at = x ? x + gap : 0;
    lines.at(-1).push({ ...item, x: at, w });
    x = at + w;
  }
  return lines;
}

function layoutMonth(ctx, month, fs, colW) {
  const pad = fs * 0.7;
  const labelW = fs * 3.3;
  const lineH = fs * 1.6;
  const rows = month.days.map((day) => {
    const lines = flow(ctx, day.items, fs, colW - 2 * pad - labelW);
    return { label: day.label, lines, h: Math.max(1, lines.length) * lineH };
  });
  const titleH = fs * 2.1;
  const body = rows.length ? rows.reduce((sum, r) => sum + r.h, 0) : lineH;
  return { name: month.name, rows, pad, labelW, lineH, titleH, h: titleH + body + pad * 1.2 };
}

/**
 * data = { title, subtitle, note, months: [{ name, days: [{ label, items: [{ text, color, paths }] }] }],
 *          legend: [{ text, color, paths }], missing, footer }
 */
export function renderSheet(data) {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // header
  ctx.fillStyle = INK;
  ctx.font = font(50, 700);
  ctx.fillText(data.title, MARGIN, MARGIN + 48);
  ctx.font = font(24, 400);
  ctx.fillStyle = GREY;
  ctx.fillText(data.subtitle, MARGIN, MARGIN + 88);
  ctx.textAlign = 'right';
  ctx.fillText(data.note, W - MARGIN, MARGIN + 88);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.fillRect(MARGIN, MARGIN + 108, W - 2 * MARGIN, 3);

  // legend (wraps)
  let y = MARGIN + 150;
  const legendFs = 21;
  ctx.font = font(legendFs, 400);
  let x = MARGIN;
  for (const item of data.legend) {
    const w = legendFs * 1.3 + ctx.measureText(item.text).width;
    if (x + w > W - MARGIN) {
      x = MARGIN;
      y += legendFs * 1.8;
    }
    drawGlyph(ctx, item.paths, x, y - legendFs * 0.9, legendFs * 1.1, item.color);
    ctx.fillStyle = INK;
    ctx.fillText(item.text, x + legendFs * 1.35, y);
    x += w + 28;
  }
  y += legendFs * 1.2;

  if (data.missing) {
    ctx.fillStyle = INK;
    ctx.font = font(30, 600);
    ctx.fillText(data.missing, MARGIN, y + 50);
    y += 80;
  }

  // 3 x 4 months, with the largest type that still fits on one page
  const gap = 20;
  const colW = (W - 2 * MARGIN - 2 * gap) / 3;
  const top = y + 16;
  const bottom = H - MARGIN - 36;
  let chosen = null;
  for (let fs = 30; fs >= 13; fs -= 0.5) {
    const boxes = data.months.map((month) => layoutMonth(ctx, month, fs, colW));
    const rowH = [0, 1, 2, 3].map((r) => Math.max(...boxes.slice(r * 3, r * 3 + 3).map((b) => b.h)));
    const total = rowH.reduce((a, b) => a + b, 0) + gap * 3;
    chosen = { fs, boxes, rowH };
    if (total <= bottom - top) break;
  }
  const { fs, boxes, rowH } = chosen;
  const extra = Math.max(0, (bottom - top - rowH.reduce((a, b) => a + b, 0) - gap * 3) / 4); // spread leftover height

  let boxY = top;
  for (let r = 0; r < 4; r++) {
    const h = rowH[r] + extra;
    for (let c = 0; c < 3; c++) {
      const box = boxes[r * 3 + c];
      const bx = MARGIN + c * (colW + gap);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, boxY, colW, h, 10);
      else ctx.rect(bx, boxY, colW, h);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = font(fs * 1.2, 700);
      ctx.fillText(box.name, bx + box.pad, boxY + box.titleH * 0.72);
      ctx.fillRect(bx + box.pad, boxY + box.titleH * 0.95, colW - 2 * box.pad, 1.5);
      let ry = boxY + box.titleH;
      if (!box.rows.length) {
        ctx.font = font(fs, 400);
        ctx.fillStyle = GREY;
        ctx.fillText('–', bx + box.pad, ry + box.lineH * 0.8);
      }
      for (const row of box.rows) {
        ctx.font = font(fs, 700);
        ctx.fillStyle = INK;
        ctx.fillText(row.label, bx + box.pad, ry + box.lineH * 0.8);
        row.lines.forEach((line, i) => {
          const ly = ry + i * box.lineH;
          for (const item of line) {
            const ix = bx + box.pad + box.labelW + item.x;
            drawGlyph(ctx, item.paths, ix, ly + box.lineH * 0.8 - fs * 0.92, fs * 1.05, item.color);
            ctx.font = font(fs, 500);
            ctx.fillStyle = INK;
            ctx.fillText(item.text, ix + fs * 1.35, ly + box.lineH * 0.8);
          }
        });
        ry += row.h;
        ctx.fillStyle = '#c9c9ce';
        ctx.fillRect(bx + box.pad, ry - 1, colW - 2 * box.pad, 1);
      }
    }
    boxY += h + gap;
  }

  ctx.font = font(19, 400);
  ctx.fillStyle = GREY;
  ctx.fillText(data.footer, MARGIN, H - MARGIN + 6);
  return canvas;
}

/* ---------- a one-page PDF around one JPEG ---------- */
export function buildPdf(jpeg, width, height) {
  const text = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? text.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const draw = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));

export async function pdfFromCanvas(canvas) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  return buildPdf(new Uint8Array(await blob.arrayBuffer()), canvas.width, canvas.height);
}
