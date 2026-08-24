// Generates build/icon.ico (+ build/icon.png) with no external image tooling.
// Draws a "Hello Mister" retro-console badge (dark squircle + teal gamepad) at 4x
// supersample, then area-downsamples to each icon size and packs a PNG-in-ICO file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const SS = 4; // supersample factor for smooth edges
const BASE = 256;
const N = BASE * SS; // work canvas edge

// --- colors ---
const BG_TOP = [22, 30, 50];
const BG_BOTTOM = [9, 13, 22];
const ACCENT = [52, 224, 201]; // retro teal
const CUTOUT = [11, 15, 25];

// RGBA work canvas (opaque draws; outside the badge stays transparent)
const buf = new Uint8ClampedArray(N * N * 4);

function put(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

// rounded-rect membership test, coords in BASE (256) units
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const dx = Math.min(px - x, x + w - px);
  const dy = Math.min(py - y, y + h - py);
  if (dx > r || dy > r) return true;
  const cx = px < x + r ? x + r : x + w - r;
  const cy = py < y + r ? y + r : y + h - r;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function fillRoundRect(x, y, w, h, r, color) {
  const x0 = Math.floor(x * SS), x1 = Math.ceil((x + w) * SS);
  const y0 = Math.floor(y * SS), y1 = Math.ceil((y + h) * SS);
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      if (inRoundRect(sx / SS, sy / SS, x, y, w, h, r)) put(sx, sy, color);
    }
  }
}

function fillCircle(cx, cy, rad, color) {
  const x0 = Math.floor((cx - rad) * SS), x1 = Math.ceil((cx + rad) * SS);
  const y0 = Math.floor((cy - rad) * SS), y1 = Math.ceil((cy + rad) * SS);
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      if ((sx / SS - cx) ** 2 + (sy / SS - cy) ** 2 <= rad * rad) put(sx, sy, color);
    }
  }
}

// 1) badge background with vertical gradient
for (let sy = 0; sy < N; sy++) {
  const t = sy / (N - 1);
  const col = [0, 1, 2].map((k) => Math.round(BG_TOP[k] + (BG_BOTTOM[k] - BG_TOP[k]) * t));
  for (let sx = 0; sx < N; sx++) {
    if (inRoundRect(sx / SS, sy / SS, 10, 10, 236, 236, 54)) put(sx, sy, col);
  }
}
// subtle inner accent hairline
for (let sy = 0; sy < N; sy++) {
  for (let sx = 0; sx < N; sx++) {
    const x = sx / SS, y = sy / SS;
    if (inRoundRect(x, y, 10, 10, 236, 236, 54) && !inRoundRect(x, y, 13, 13, 230, 230, 51)) {
      put(sx, sy, ACCENT, 90);
    }
  }
}

// 2) gamepad body
fillRoundRect(44, 96, 168, 72, 34, ACCENT);
// left d-pad (cutout)
fillRoundRect(72, 116, 46, 16, 4, CUTOUT); // horizontal bar
fillRoundRect(87, 101, 16, 46, 4, CUTOUT); // vertical bar
// right action buttons (cutout)
fillCircle(168, 122, 11, CUTOUT);
fillCircle(190, 140, 11, CUTOUT);
fillCircle(168, 146, 11, CUTOUT);

// --- area downsample from work canvas to size S ---
function downsample(S) {
  const out = Buffer.alloc(S * S * 4);
  const block = N / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let by = 0; by < block; by++) {
        for (let bx = 0; bx < block; bx++) {
          const sx = Math.floor(x * block + bx);
          const sy = Math.floor(y * block + by);
          const i = (sy * N + sx) * 4;
          const pa = buf[i + 3];
          r += buf[i] * pa; g += buf[i + 1] * pa; b += buf[i + 2] * pa;
          a += pa; count++;
        }
      }
      const o = (y * S + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / count);
    }
  }
  return out;
}

// --- PNG encode ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf2) {
  let c = 0xffffffff;
  for (let i = 0; i < buf2.length; i++) c = CRC_TABLE[(c ^ buf2[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(S, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- ICO assemble (PNG-compressed entries) ---
function buildIco(sizes) {
  const pngs = sizes.map((S) => ({ S, png: encodePng(S, downsample(S)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { S, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = S >= 256 ? 0 : S; e[1] = S >= 256 ? 0 : S; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length; entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

const outDir = path.join(process.cwd(), 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco([256, 64, 48, 32, 16]));
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePng(256, downsample(256)));
console.log('Wrote build/icon.ico and build/icon.png');
