# Asset pipeline

Three one-off tools, vendored because without them the vendored assets in
`public/` cannot be regenerated or re-checked — and because the failure modes
of asset optimization are *silent*. A broken environment map does not throw;
it hands the scene a black sphere and the whole thing just looks slightly
wrong forever. Each script here exists to make one of those failures loud.

They are not part of `npm run gate` — they run when an asset changes, by hand.

| Script | What it does |
| --- | --- |
| `hdr-resize.mjs` | Radiance `.hdr` reader / box-downsampler / writer in pure Node. Nothing in this toolchain reads RGBE (no imagemagick, no oiiotool; PIL cannot). Handles both scanline encodings, filters in **linear float** — averaging RGBE mantissas across differing exponents is meaningless — and re-emits flat scanlines, which `RGBELoader` reads. |
| `hdr-verify.mjs` | Loads two `.hdr` files through three.js's own `RGBELoader` (the exact consumer `<Environment>` uses) and compares mean linear luminance plus a 16-band latitude profile. The band profile is the point: image-based lighting is directional, so a matching global mean with a scrambled vertical profile would still relight the scene wrongly. |
| `glb-verify.mjs` | Loads a `.glb` through the real production stack (three-stdlib `GLTFLoader` + `MeshoptDecoder`) and prints bbox, the `fitGltfScene` scale it implies, triangle count and animation count. `gltf-transform inspect` reports misleading bounds for quantized files because it reads raw accessor extents without the compensating node transform — the loader is the authority. |

## Regenerating the environment map

```bash
node scripts/assets/hdr-resize.mjs source_1k.hdr public/hdri/dikhololo_night_1k.hdr 256 128
node scripts/assets/hdr-verify.mjs source_1k.hdr public/hdri/dikhololo_night_1k.hdr
```

The shipped map is 256×128. That is not a typo against its `_1k` filename: it
is used for **image-based lighting only, never as a background**
(`src/flight3d/Scene3D.tsx`), and three.js runs it through PMREM, which
prefilters it down to a small cubemap before it lights a single pixel. The
1024×512 source cost 1.7 MB on the wire — 29% of the entire payload, arriving
last on a slow connection, so the shading visibly changed mid-flight — for
resolution that was thrown away before it was ever used.

## Compressing a model

```bash
npx --yes @gltf-transform/cli optimize in.glb out.glb \
  --compress meshopt --no-simplify --no-join --no-flatten --no-palette
node scripts/assets/glb-verify.mjs in.glb out.glb
```

**meshopt, not Draco.** drei's `useGLTF` decodes `EXT_meshopt_compression` with
the decoder already bundled in three-stdlib; Draco fetches its decoder from
gstatic at runtime, which is a third-party request this project otherwise
never makes. The `--no-*` flags keep topology and materials intentional rather
than incidental — `optimize` will happily weld and decimate a model into
something that looks *nearly* the same.

`prune` will not remove unused animation clips, because nothing in the file
says they are unused: that is call-site knowledge. `Dressing.tsx` destructures
only `{ scene }` and never builds an `AnimationMixer`, so the astronaut's 18
Quaternius clips were dead weight and were dropped by hand.
