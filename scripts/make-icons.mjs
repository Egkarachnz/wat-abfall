#!/usr/bin/env node
// Draws the app icon — a solid white bin with a soft shadow on a green gradient, the way
// iOS home-screen icons are built — and writes the PNG sizes the web app manifest and iOS
// need. Pure Node, no dependencies:
//
//   node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { file } from './lib.mjs';

/* ---------- shapes: signed distance fields on a 100x100 canvas (negative = inside) ---------- */
const roundBox = (px, py, cx, cy, hx, hy, r) => {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function polygon(px, py, v) {
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const ex = v[j][0] - v[i][0];
    const ey = v[j][1] - v[i][1];
    const wx = px - v[i][0];
    const wy = py - v[i][1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2);
    const c1 = py >= v[i][1];
    const c2 = py < v[j][1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Body: a trapezoid that is slightly wider at the top, rounded by shrinking it and growing the distance back.
const BODY = [[33.4, 42], [66.6, 42], [63.4, 76], [36.6, 76]];
const BODY_ROUND = 4;

// The bin: handle + lid + body, with two grooves cut out of the body.
function bin(x, y) {
  const handle = roundBox(x, y, 50, 20.5, 8, 3.5, 3.2);
  const lid = roundBox(x, y, 50, 30.5, 27, 4.5, 4.5);
  const body = polygon(x, y, BODY) - BODY_ROUND;
  const grooves = Math.min(roundBox(x, y, 42.5, 59, 2.8, 10, 2.8), roundBox(x, y, 57.5, 59, 2.8, 10, 2.8));
  return Math.max(Math.min(handle, lid, body), -grooves);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- rasteriser (analytic anti-aliasing) ---------- */
function render(size, { rounded, glyphScale }) {
  const k = size / 100; // pixels per canvas unit
  const out = Buffer.alloc(size * size * 4);
  const cornerR = 22.37; // iOS "squircle-ish" corner radius, as a percentage of the icon

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / k;
      const y = (py + 0.5) / k;

      // background: diagonal green gradient with a soft highlight at the top left
      const g = Math.min(1, Math.max(0, (x * 0.35 + y * 0.65) / 100));
      let r = 62 + (18 - 62) * g;
      let gr = 208 + (112 - 208) * g;
      let b = 100 + (46 - 100) * g;
      const glow = 1 - smooth(0, 70, Math.hypot(x - 18, y - 8));
      r += (255 - r) * glow * 0.22;
      gr += (255 - gr) * glow * 0.22;
      b += (255 - b) * glow * 0.22;

      // the glyph is sampled in its own space so it can be scaled for the maskable safe zone
      const sx = 50 + (x - 50) / glyphScale;
      const sy = 49 + (y - 50) / glyphScale - 1.5;
      const inside = -bin(sx, sy) * k * glyphScale; // pixels inside the glyph edge (negative = outside)
      const shadowDist = bin(sx, sy - 2.4) * glyphScale; // same shape pushed down; canvas units, negative = inside
      const shadow = 0.28 * (1 - smooth(-1.5, 4.5, shadowDist)); // fades out softly beyond the edge

      r *= 1 - shadow;
      gr *= 1 - shadow;
      b *= 1 - shadow;
      const cover = Math.min(1, Math.max(0, inside + 0.5));
      r += (255 - r) * cover;
      gr += (255 - gr) * cover;
      b += (255 - b) * cover;

      // rounded outline for the transparent-corner variants
      let alpha = 1;
      if (rounded) {
        const rad = (cornerR / 100) * size;
        const cx = Math.min(Math.max(px + 0.5, rad), size - rad);
        const cy = Math.min(Math.max(py + 0.5, rad), size - rad);
        alpha = Math.min(1, Math.max(0, rad - Math.hypot(px + 0.5 - cx, py + 0.5 - cy) + 0.5));
      }

      const i = (py * size + px) * 4;
      out[i] = Math.round(r);
      out[i + 1] = Math.round(gr);
      out[i + 2] = Math.round(b);
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/* ---------- PNG encoder ---------- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- outputs ---------- */
const ICONS = [
  // iOS applies its own rounded mask, so the Apple icon is a full-bleed square.
  { name: 'apple-touch-icon.png', size: 180, rounded: false, glyphScale: 1 },
  { name: 'icon-192.png', size: 192, rounded: true, glyphScale: 1 },
  { name: 'icon-512.png', size: 512, rounded: true, glyphScale: 1 },
  // Maskable: full-bleed with the glyph kept inside the central safe zone.
  { name: 'icon-maskable-512.png', size: 512, rounded: false, glyphScale: 0.88 },
];

await mkdir(file('icons'), { recursive: true });
for (const { name, size, rounded, glyphScale } of ICONS) {
  await writeFile(file('icons', name), encodePng(size, render(size, { rounded, glyphScale })));
  console.log(`icons/${name} (${size}x${size})`);
}
