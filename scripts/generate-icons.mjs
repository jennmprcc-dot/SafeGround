/**
 * Regenerate SafeGround brand assets from the owner's real MPRCC logo
 * (/home/team/shared/brand/logo.png — 1950x1297 designed card on #F9F9F9).
 *
 * Usage: bun ./scripts/generate-icons.mjs
 * Outputs (same filenames as before — keep names, they're referenced):
 *   public/logo-header.png   transparent, 220x160 (source aspect)
 *   public/logo-hero.png     transparent, 220x160  (hero uses width 288 → 2x)
 *   public/favicon.png       32x32 square, center crop + balanced padding
 *   public/apple-touch-icon.png 180x180 square (same treatment)
 *   public/icon-192.png      192x192 square
 *   public/icon-512.png      512x512 square
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const SRC = "/home/team/shared/brand/logo.png";
const OUT = "public";
const SPEC = [
  ["logo-header.png", 220, 160, false],
  ["logo-hero.png", 220, 160, false],
  ["favicon.png", 32, 32, true],
  ["apple-touch-icon.png", 180, 180, true],
  ["icon-192.png", 192, 192, true],
  ["icon-512.png", 512, 512, true],
];

const src = readFileSync(SRC);
// Square source: shave-icon-source.mjs centers the mark content inside a
// square card with ~8% padding → /tmp/mprcc-icon-source.png.
const SQUARE_SRC = "/tmp/mprcc-icon-source.png";

const pipeline = sharp(src).removeAlpha().ensureAlpha();
const squareRaw = await sharp(SQUARE_SRC).removeAlpha().ensureAlpha().toBuffer();

let headerOrHero = null;
const results = [];
for (const [name, w, h, square] of SPEC) {
  let buf;
  if (square) {
    buf = await sharp(squareRaw).resize(w, h, { fit: "fill", kernel: "lanczos3" }).toBuffer();
  } else {
    // transparent, source aspect: full card fitted down (alpha keyed off the
    // #F9F9F9 card → transparent bg; the in-margin padding stays, it reads as
    // designed space)
    const resized = await sharp(src).resize(w, h, { fit: "contain", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = resized;
    if (info.channels < 4) throw new Error("expected RGBA from sharp raw");
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.abs(r - 249) + Math.abs(g - 249) + Math.abs(b - 249) < 12) {
        data[i + (info.channels === 4 ? 3 : 0)] = 0;
      }
    }
    buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  }
  await sharp(buf).toFile(`${OUT}/${name}`);
  const meta = await sharp(buf).metadata();
  results.push(`${name}: ${meta.width}x${meta.height}`);
}
console.log(results.join("\n"));

async function keyOutCard(img) {
  // Operate pixel-wise: set alpha 0 where the pixel is the card #F9F9F9 (within
  // tolerance), keep edges (anti-aliased pixels near the mark keep ≥ small alpha).
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.abs(r - 249) + Math.abs(g - 249) + Math.abs(b - 249) < 12) {
      data[i + 3] = 0; // match channels RGBA (ensureAlpha above)
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels } });
}