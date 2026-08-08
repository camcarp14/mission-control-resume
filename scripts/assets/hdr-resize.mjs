// Radiance .hdr (RGBE) reader/box-downsampler/writer in pure Node.
//
// No imagemagick / oiiotool / PIL path exists in this container for Radiance,
// so this is the tool. It reads both scanline encodings the format allows
// (adaptive per-component RLE, and flat 4-bytes-per-pixel), box-filters in
// LINEAR float — never in RGBE bytes, which are a shared-exponent encoding
// where averaging the mantissas across differing exponents is meaningless —
// and re-emits FLAT scanlines. three.js's RGBELoader reads flat happily; the
// RLE writer would only buy back a few kB on a file this small.
//
// Usage: node hdr-resize.mjs <in.hdr> <out.hdr> <outWidth> <outHeight>
import { readFileSync, writeFileSync } from 'node:fs';

/* ---- read ---------------------------------------------------------------- */

function readHDR(buf) {
  // Header is ASCII lines terminated by a blank line, then one resolution line.
  let p = 0;
  const line = () => {
    const s = p;
    while (buf[p] !== 0x0a) p++;
    const out = buf.toString('latin1', s, p);
    p++;
    return out;
  };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error(`not a Radiance file: ${magic}`);
  let format = '';
  for (;;) {
    const l = line();
    if (l === '') break;
    if (l.startsWith('FORMAT=')) format = l.slice(7);
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`unsupported FORMAT=${format}`);
  const res = line();
  const m = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(res);
  if (!m) throw new Error(`unsupported resolution line: ${res}`);
  const height = Number(m[1]);
  const width = Number(m[2]);

  const rgbe = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    const adaptive =
      width >= 8 && width < 0x8000 &&
      buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === width;
    if (adaptive) {
      p += 4;
      // Components are stored PLANAR here: all R, then all G, B, E.
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = buf[p++];
          if (n > 128) {
            const v = buf[p++];
            n -= 128;
            for (let i = 0; i < n; i++) rgbe[row + (x++) * 4 + c] = v;
          } else {
            for (let i = 0; i < n; i++) rgbe[row + (x++) * 4 + c] = buf[p++];
          }
        }
        if (x !== width) throw new Error(`scanline ${y} component ${c} overran (${x}/${width})`);
      }
    } else {
      // Flat, with the pre-1991 "old RLE" escape: an (1,1,1,n) pixel repeats
      // the previous pixel n<<(8*shift) times.
      let x = 0;
      let shift = 0;
      while (x < width) {
        const r = buf[p], g = buf[p + 1], b = buf[p + 2], e = buf[p + 3];
        p += 4;
        if (r === 1 && g === 1 && b === 1 && x > 0) {
          const n = e << (shift * 8);
          const prev = row + (x - 1) * 4;
          for (let i = 0; i < n && x < width; i++) {
            rgbe.copy(rgbe, row + (x++) * 4, prev, prev + 4);
          }
          shift++;
        } else {
          rgbe[row + x * 4] = r;
          rgbe[row + x * 4 + 1] = g;
          rgbe[row + x * 4 + 2] = b;
          rgbe[row + x * 4 + 3] = e;
          x++;
          shift = 0;
        }
      }
    }
  }
  return { width, height, rgbe };
}

/* ---- RGBE <-> linear float ---------------------------------------------- */

// Radiance's own colr_color(): the +0.5 recovers the mantissa's bucket centre
// rather than its floor, which matters most in the dark values that dominate
// a night sky.
function toFloat(rgbe, i, out) {
  const e = rgbe[i + 3];
  if (e === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  const f = Math.pow(2, e - (128 + 8));
  out[0] = (rgbe[i] + 0.5) * f;
  out[1] = (rgbe[i + 1] + 0.5) * f;
  out[2] = (rgbe[i + 2] + 0.5) * f;
}

function fromFloat(r, g, b, dst, i) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) { dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; dst[i + 3] = 0; return; }
  // frexp by hand: v = m * 2^e, m in [0.5, 1).
  let e = Math.ceil(Math.log2(v));
  if (Math.pow(2, e - 1) >= v) e -= 1;
  if (Math.pow(2, e) < v) e += 1;
  const scale = Math.pow(2, -e) * 256;
  dst[i] = Math.min(255, Math.max(0, Math.floor(r * scale)));
  dst[i + 1] = Math.min(255, Math.max(0, Math.floor(g * scale)));
  dst[i + 2] = Math.min(255, Math.max(0, Math.floor(b * scale)));
  dst[i + 3] = e + 128;
}

/* ---- resize -------------------------------------------------------------- */

function boxDown(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const px = [0, 0, 0];
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.min(sh, Math.floor((y + 1) * fy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.min(sw, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          toFloat(src, (sy * sw + sx) * 4, px);
          r += px[0]; g += px[1]; b += px[2];
          n++;
        }
      }
      fromFloat(r / n, g / n, b / n, out, (y * dw + x) * 4);
    }
  }
  return out;
}

/* ---- write --------------------------------------------------------------- */

function writeHDR(path, w, h, rgbe) {
  const header = Buffer.from(
    `#?RADIANCE\n# Downsampled for image-based lighting only (see Scene3D).\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`,
    'latin1',
  );
  writeFileSync(path, Buffer.concat([header, rgbe]));
}

/* ---- main ---------------------------------------------------------------- */

const [inPath, outPath, wArg, hArg] = process.argv.slice(2);
const src = readHDR(readFileSync(inPath));
console.log(`read ${inPath}: ${src.width}x${src.height}`);
const dw = Number(wArg);
const dh = Number(hArg);
const out = boxDown(src.rgbe, src.width, src.height, dw, dh);
writeHDR(outPath, dw, dh, out);
console.log(`wrote ${outPath}: ${dw}x${dh}`);

// Prove the round trip: mean linear luminance of source vs result. Image-based
// lighting is an integral over the sphere, so this number IS the thing PMREM
// eventually hands the materials — if it moves, the scene's exposure moves.
const lum = (buf, n) => {
  const px = [0, 0, 0];
  let s = 0;
  for (let i = 0; i < n; i++) {
    toFloat(buf, i * 4, px);
    s += 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
  }
  return s / n;
};
const a = lum(src.rgbe, src.width * src.height);
const b = lum(out, dw * dh);
console.log(`mean luminance: src=${a.toFixed(6)} dst=${b.toFixed(6)} delta=${((b / a - 1) * 100).toFixed(3)}%`);
