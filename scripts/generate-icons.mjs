// Renders the Section Lens icon (rounded-square focus frame + lens dot) to PNG at 16/32/48/128px.
// Pure Node: signed-distance rendering with 4×4 supersampling, encoded with zlib.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const out = resolve(fileURLToPath(import.meta.url), '../../public/icons');
mkdirSync(out, { recursive: true });

const BG = [13, 19, 18];
const RING = [48, 58, 56];
const ACCENT = [158, 217, 99];

// Signed distance to a rounded box centered at (0,0) with half-size b and radius r.
function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// Coverage samples in a 24-unit design space (matches LensIcon.tsx).
function sample(x, y) {
  const cx = x - 12;
  const cy = y - 12;
  const layers = [];
  const outer = sdRoundBox(cx, cy, 11.5, 11.5, 6);
  if (outer <= 0) layers.push(outer > -1 ? RING : BG);
  // Corner brackets: stroke of a rounded box (half-size 6, radius 1.5) masked to the corners.
  const d = Math.abs(sdRoundBox(cx, cy, 6, 6, 1.6)) - 0.95;
  const inCorner = Math.abs(cx) > 2.6 && Math.abs(cy) > 2.6;
  if (d <= 0 && inCorner) layers.push(ACCENT);
  if (Math.hypot(cx, cy) <= 2.6) layers.push(ACCENT);
  return layers.length ? layers[layers.length - 1] : null;
}

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 24;
          const v = ((y + (sy + 0.5) / ss) / size) * 24;
          const c = sample(u, v);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (y * size + x) * 4;
      const n = ss * ss;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(out, `icon-${size}.png`), png(size, render(size)));
}
console.log('Icons written to public/icons');
