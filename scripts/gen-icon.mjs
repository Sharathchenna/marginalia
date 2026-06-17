// Generates a 1024x1024 source PNG for the app icon (cobalt background with a
// white rounded "page"), then `npm run tauri icon` derives all platform sizes.
// Run: node scripts/gen-icon.mjs   (writes /tmp/marg-icon.png)
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const bg = [0x4b, 0x57, 0xd6]; // cobalt-iris accent
const fg = [0xff, 0xff, 0xff];

// rounded-rect page centered, with two "text" lines
const px = 300,
  py = 230,
  pw = S - 2 * px,
  ph = S - 2 * py,
  r = 70;
function inRounded(x, y) {
  if (x < px || x > px + pw || y < py || y > py + ph) return false;
  const cx = Math.min(Math.max(x, px + r), px + pw - r);
  const cy = Math.min(Math.max(y, py + r), py + ph - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function isLine(x, y) {
  const lx = px + 110,
    lw = pw - 220;
  const l1 = py + 250,
    l2 = py + 400,
    th = 46;
  if (x < lx || x > lx + lw) return false;
  return (y >= l1 && y <= l1 + th) || (y >= l2 && y <= l2 + th * 0.001 + th && y <= l2 + th);
}

const raw = Buffer.alloc(S * (1 + S * 3));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 3)] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    let c = bg;
    if (inRounded(x, y)) c = isLine(x, y) ? bg : fg;
    const o = y * (1 + S * 3) + 1 + x * 3;
    raw[o] = c[0];
    raw[o + 1] = c[1];
    raw[o + 2] = c[2];
  }
}

// ---- minimal PNG encoder ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("/tmp/marg-icon.png", png);
console.log(`Wrote /tmp/marg-icon.png (${S}x${S}, ${png.length} bytes)`);
