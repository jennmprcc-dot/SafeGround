/**
 * Branding pass: shave the real MPRCC logo card for icons.
 *
 * The source card (1950x1297) has asymmetric inner margins: the mark text block
 * sits with ~240px bottom padding and less elsewhere. A plain center crop of
 * the full square gives content biased high. This script:
 *   1. decodes the PNG,
 *   2. measures the content bbox (non-#F9F9F9 / low-alpha),
 *   3. crops the square so the *content* is centered within the crop,
 *      preserving ~8% padding all around (so the small mark never touches the
 *      icon edge),
 *   4. writes /tmp/mprcc-icon-source.png (1552x1552).
 * 5. Note: the source has the near-square content bbox 1070x1052 centered at
 *    (443,106)+; we rebuild the square crop to center content.
 */
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/home/team/shared/brand/logo.png";
const OUT = "/tmp/mprcc-icon-source.png";
const PAD = 0.08; // padding as fraction of crop size around content

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bpp = 3, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; bpp = colorType === 6 ? 4 : 3; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride), off = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[off++];
    const line = raw.subarray(off, off + stride); off += stride;
    const out = Buffer.from(line);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (f) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; break; }
      }
      out[x] = v;
    }
    for (let x = 0; x < stride; x++) px[y * stride + x] = out[x];
    prev = out;
  }
  return { w, h, bpp, px };
}

const { w, h, bpp, px } = decodePNG(readFileSync(SRC));
const BG = 249;
const isContent = (x, y) => {
  const o = (y * w + x) * bpp;
  const al = bpp === 4 ? px[o + 3] : 255;
  if (al < 220) return true;
  return Math.abs(px[o] - BG) + Math.abs(px[o + 1] - BG) + Math.abs(px[o + 2] - BG) > 40;
};
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isContent(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
const cw = maxX - minX + 1, chh = maxY - minY + 1;
const size = Math.round(Math.max(cw, chh) * (1 + 2 * PAD));
const cropX = Math.round(minX - (size - cw) / 2);
const cropY = Math.round(minY - (size - chh) / 2);
// Clamp crop to source bounds (pad by repeating edge card color if needed — but
// source has ≥400px margins, so clamp should be a no-op here).
console.log(`content bbox ${cw}x${chh} at ${minX},${minY}; crop square ${size} at ${cropX},${cropY}`);

// Assemble output as RGBA (bpp 4 or promote), crop region.
const outSize = size;
const outPx = Buffer.alloc(outSize * outSize * 4);
for (let y = 0; y < outSize; y++) {
  const sy = cropY + y;
  for (let x = 0; x < outSize; x++) {
    const sx = cropX + x;
    const o = (y * outSize + x) * 4;
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) { outPx[o] = BG; outPx[o + 1] = BG; outPx[o + 2] = BG; outPx[o + 3] = 255; continue; }
    const so = (sy * w + sx) * bpp;
    outPx[o] = px[so]; outPx[o + 1] = px[so + 1]; outPx[o + 2] = px[so + 2];
    outPx[o + 3] = bpp === 4 ? px[so + 3] : 255;
  }
}
// Encode PNG (RGBA, filter 0 rows).
function encodePNG(w2, h2, rgba) {
  const stride = w2 * 4;
  const raw = Buffer.alloc(h2 * (stride + 1));
  for (let y = 0; y < h2; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const idat = deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w2, 0); ihdr.writeUInt32BE(h2, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const CRC_TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

writeFileSync(OUT, encodePNG(outSize, outSize, outPx));
console.log(`wrote ${OUT} (${outSize}x${outSize})`);