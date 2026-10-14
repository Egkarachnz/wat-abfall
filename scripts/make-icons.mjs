#!/usr/bin/env node
// Draws the app icon (white bin on a green gradient) and writes the PNG sizes the
// web app manifest and iOS need. Pure Node, no dependencies:
//
//   node scripts/make-icons.mjs
//
// The bin is the same Feather "trash-2" outline used inside the app, so the
// home-screen icon matches the UI.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { file } from './lib.mjs';

/* ---------- glyph geometry on a 24x24 grid ---------- */
const segments = [];
const polyline = (pts) => pts.slice(1).forEach((p, i) => segments.push([...pts[i], ...p]));
const arc = (cx, cy, r, from, to, steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

polyline([[3, 6], [21, 6]]); // lid
polyline([[19, 6], [18, 20], ...arc(16, 20, 2, 0, 90), [8, 22], ...arc(8, 20, 2, 90, 180), [5, 6]]); // body
polyline([[9, 6], [9, 4], ...arc(10, 4, 1, 180, 270, 5), [14, 3], ...arc(14, 4, 1, 270, 360, 5), [15, 6]]); // handle
polyline([[10, 11], [10, 17]]);
polyline([[14, 11], [14, 17]]);

const GLYPH_CENTER = [12, 12.5];
const HALF_STROKE = 1;

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inGlyph = (gx, gy) => {
  if (gx < 1.5 || gx > 22.5 || gy < 1.5 || gy > 23.5) return false; // bounding box shortcut
  return segments.some((s) => distToSegment(gx, gy, s) <= HALF_STROKE);
};

/* ---------- rasteriser (4x4 supersampling) ---------- */
function render(size, { rounded, glyphScale }) {
  const k = size * glyphScale; // pixels per glyph unit
  const radius = rounded ? size * 0.22 : 0;
  const top = [46, 158, 75];
  const bottom = [22, 104, 44];
  const out = Buffer.alloc(size * size * 4);
  const N = 4;

  const insideShape = (x, y) => {
    if (!rounded) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return Math.hypot(x - cx, y - cy) <= radius;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = px + (sx + 0.5) / N;
          const y = py + (sy + 0.5) / N;
          if (!insideShape(x, y)) continue;
          a += 1;
          if (inGlyph(GLYPH_CENTER[0] + (x - size / 2) / k, GLYPH_CENTER[1] + (y - size / 2) / k)) {
            r += 255; g += 255; b += 255;
          } else {
            const t = y / size;
            r += top[0] + (bottom[0] - top[0]) * t;
            g += top[1] + (bottom[1] - top[1]) * t;
            b += top[2] + (bottom[2] - top[2]) * t;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (N * N)) * 255);
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
  { name: 'apple-touch-icon.png', size: 180, rounded: false, glyphScale: 0.021 },
  { name: 'icon-192.png', size: 192, rounded: true, glyphScale: 0.021 },
  { name: 'icon-512.png', size: 512, rounded: true, glyphScale: 0.021 },
  // Maskable: full-bleed with the glyph kept inside the central safe zone.
  { name: 'icon-maskable-512.png', size: 512, rounded: false, glyphScale: 0.018 },
];

await mkdir(file('icons'), { recursive: true });
for (const { name, size, rounded, glyphScale } of ICONS) {
  await writeFile(file('icons', name), encodePng(size, render(size, { rounded, glyphScale })));
  console.log(`icons/${name} (${size}x${size})`);
}
