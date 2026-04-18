#!/usr/bin/env node
/**
 * Generates placeholder branded assets for the demo APK.
 * Run once before building: node generate-assets.js
 * No npm dependencies — uses only Node.js built-ins.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── CRC32 ───────────────────────────────────────────────────────────────────

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

// ─── Minimal PNG writer ───────────────────────────────────────────────────────

function createPNG(width, height, drawFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  // compression, filter, interlace = 0

  const stride = 1 + width * 3; // filter byte + RGB per row
  const raw = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = drawFn(x, y, width, height);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

// Draw pixel with antialiased circle test
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) <= r;
}

// "R" letter as a bitmap mask (11×14 grid, scaled to size)
const R_BITMAP = [
  [1,1,1,1,1,0,0],
  [1,0,0,0,0,1,0],
  [1,0,0,0,0,1,0],
  [1,1,1,1,1,0,0],
  [1,0,0,1,0,0,0],
  [1,0,0,0,1,0,0],
  [1,0,0,0,0,1,0],
];

function drawIcon(x, y, w, h) {
  const BG  = [15, 23, 42];    // #0f172a
  const ACC = [59, 130, 246];  // #3b82f6

  const cx = w / 2, cy = h / 2;

  // Rounded square background (corners clipped)
  const pad = w * 0.06;
  const radius = w * 0.22;
  const lx = pad, rx = w - pad, ty = pad, by = h - pad;

  function inRoundRect(px, py) {
    if (px < lx || px > rx || py < ty || py > by) return false;
    if (px < lx + radius && py < ty + radius) return inCircle(px, py, lx + radius, ty + radius, radius);
    if (px > rx - radius && py < ty + radius) return inCircle(px, py, rx - radius, ty + radius, radius);
    if (px < lx + radius && py > by - radius) return inCircle(px, py, lx + radius, by - radius, radius);
    if (px > rx - radius && py > by - radius) return inCircle(px, py, rx - radius, by - radius, radius);
    return true;
  }

  if (!inRoundRect(x, y)) return BG;

  // Draw "R" letter in center
  const rows = R_BITMAP.length, cols = R_BITMAP[0].length;
  const cellW = w * 0.07, cellH = h * 0.09;
  const startX = cx - (cols * cellW) / 2;
  const startY = cy - (rows * cellH) / 2;

  const col = Math.floor((x - startX) / cellW);
  const row = Math.floor((y - startY) / cellH);

  if (row >= 0 && row < rows && col >= 0 && col < cols && R_BITMAP[row][col]) {
    return [255, 255, 255];
  }

  // Accent circle behind the letter
  if (inCircle(x, y, cx, cy, w * 0.28)) return ACC;

  return BG;
}

function drawSplash(x, y, w, h) {
  return [15, 23, 42]; // #0f172a solid
}

// ─── Generate ─────────────────────────────────────────────────────────────────

const dir = path.join(__dirname, 'assets');
fs.mkdirSync(dir, { recursive: true });

console.log('Generating assets...');

const icon = createPNG(1024, 1024, drawIcon);
fs.writeFileSync(path.join(dir, 'icon.png'), icon);
fs.writeFileSync(path.join(dir, 'adaptive-icon.png'), icon);
console.log('  icon.png ✓');
console.log('  adaptive-icon.png ✓');

const splash = createPNG(1284, 2778, drawSplash);
fs.writeFileSync(path.join(dir, 'splash.png'), splash);
console.log('  splash.png ✓');

console.log('\nDone. Run: npx expo run:android --variant release');
