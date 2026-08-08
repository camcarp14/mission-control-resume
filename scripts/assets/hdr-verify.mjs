// Independent check of the downsampler: parse BOTH files with three.js's own
// RGBELoader — the exact consumer drei's <Environment> uses — and compare the
// linear radiance each one delivers. If my writer emitted anything RGBELoader
// dislikes, this throws instead of silently handing the scene a black sphere.
import { readFileSync } from 'node:fs';
import { RGBELoader } from '/home/user/hyperscaler/node_modules/three/examples/jsm/loaders/RGBELoader.js';
import * as THREE from '/home/user/hyperscaler/node_modules/three/build/three.module.js';

const loader = new RGBELoader();
loader.setDataType(THREE.FloatType);

const parse = (p) => {
  const b = readFileSync(p);
  const tex = loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { w: tex.width, h: tex.height, data: tex.data };
};

const [aPath, bPath] = process.argv.slice(2);
const A = parse(aPath);
const B = parse(bPath);
console.log(`${aPath}: ${A.w}x${A.h} floats=${A.data.length}`);
console.log(`${bPath}: ${B.w}x${B.h} floats=${B.data.length}`);

// Mean linear luminance is the integral PMREM prefilters into the irradiance
// the materials actually see — the only number that predicts scene exposure.
const stats = (t) => {
  let sum = 0;
  let max = 0;
  const n = t.w * t.h;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * t.data[i * 4] + 0.7152 * t.data[i * 4 + 1] + 0.0722 * t.data[i * 4 + 2];
    sum += l;
    if (l > max) max = l;
  }
  return { mean: sum / n, max };
};
const sa = stats(A);
const sb = stats(B);
console.log(`mean luminance  a=${sa.mean.toFixed(6)}  b=${sb.mean.toFixed(6)}  delta=${((sb.mean / sa.mean - 1) * 100).toFixed(3)}%`);
console.log(`peak luminance  a=${sa.max.toFixed(4)}  b=${sb.max.toFixed(4)}`);

// Per-band comparison: a 16-row latitude profile. IBL is directional, so a
// matching global mean with a scrambled vertical profile would still relight
// the scene wrongly (sky above vs ground below is the whole point of an HDRI).
const bands = (t, k = 16) => {
  const out = [];
  for (let band = 0; band < k; band++) {
    let s = 0;
    let n = 0;
    for (let y = Math.floor((band * t.h) / k); y < Math.floor(((band + 1) * t.h) / k); y++) {
      for (let x = 0; x < t.w; x++) {
        const i = (y * t.w + x) * 4;
        s += 0.2126 * t.data[i] + 0.7152 * t.data[i + 1] + 0.0722 * t.data[i + 2];
        n++;
      }
    }
    out.push(s / n);
  }
  return out;
};
const ba = bands(A);
const bb = bands(B);
let worst = 0;
for (let i = 0; i < ba.length; i++) {
  const d = Math.abs(bb[i] / ba[i] - 1) * 100;
  if (d > worst) worst = d;
  console.log(`  band ${String(i).padStart(2)}  a=${ba[i].toFixed(6)}  b=${bb[i].toFixed(6)}  ${d.toFixed(2)}%`);
}
console.log(`WORST BAND DELTA ${worst.toFixed(2)}%`);
