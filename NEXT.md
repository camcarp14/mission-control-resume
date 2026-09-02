# If I had one more day

Ranked by expected payoff for the actual goal — getting an adtech SC/SE hiring
panel to remember this candidate.

> ~~First, a 30-second edit: set your real name~~ — done: the site carries
> Cameron Carpenter end to end (hero, metadata, JSON-LD, the og card, the
> résumé PDF). The `CC-01` callsign painted on the hull livery survives the
> rename by luck of the initials.

1. **Session replay on the dashboard.** The logbook shows furthest-station; the
   better signal is *dwell per station*. Log `(visit_id, station, ms)` beacons
   into a `station_dwell` table (sendBeacon on `pagehide` so the last station
   isn't lost) and render a per-visit sparkline. "They spent 90 seconds on the
   FIREFIGHT station" is a conversation opener in the interview itself.

2. **A real 20-second walkthrough video for two stations.** The slot exists in
   the schema; nothing sells "I demo software for a living" like a tight,
   narrated 20 seconds over the real dashboard artifact. Two good videos beat
   eleven mediocre ones.

3. **Mobile body framing.** The voyage's celestial bodies are composed for the
   desktop frame (planet left, panel right); at 390px the planet is often
   mostly off-frame. A per-breakpoint gaze bias in `engine/space.ts` (pull the
   camera target toward the body under 768px) would give phones the same
   postcard shots. One constant, big payoff.

4. **Per-code theming of the DOCKING station.** The final station's close could
   read differently per access code ("Why me, for *Acme* specifically") — one
   optional `closing` field on `access_codes`, fetched at redemption, injected
   into station 11 while the sun fills the frame. Personalization at the exact
   moment they're deciding whether to reply.

5. **A `/preview` route.** ~~An OG/social card~~ — done: `public/og.jpg` is a
   real posed frame of the Navy Pier finale with the wordmark composited over
   the night sky, and the tab marks ship alongside it. What is still missing is
   a *no-code* surface to unfurl into: a public `/preview` page carrying the
   pitch and the PDF, so a forwarded link lands somewhere rather than on a code
   prompt.

6. **Real device pass.** The e2e frame checks run under CPU throttle and
   software rasterization as proxies; the WebGL voyage deserves an hour on an
   actual mid-range Android (Moto G class) with Chrome remote profiling —
   adaptive DPR via drei's PerformanceMonitor is the ready lever if a real
   device dips below 60.

7. **KTX2/basis textures.** The dimension pass is done (media is 1.28 MB, down
   from 4.34 MB), but the planet maps still ship as WebP, which the GPU cannot
   read directly — every one is decoded to raw RGBA on the main thread and
   uploaded uncompressed. KTX2/basis with a JS decoder fallback would cut VRAM
   and upload time on exactly the mid-range phones this is most viewed on.
   Do it in the same change as the rename below, since both touch every path.

   **Rename the textures while you are there.** Seven of eleven filenames
   misstate their own resolution — `4k_earth_clouds.webp` is 1024×512,
   `6k_stars_milky_way.webp` is 4096×2048, `2k_moon.webp` is 512×256. It is
   cosmetic until someone reads a filename and skips the file it names, which
   is precisely what happened before the audit. Content-hashed names would also
   let `/textures/*` move from the 30-day header to a genuinely `immutable`
   one — see the tradeoff written into `netlify.toml`.

8. **Sound design, opt-in only.** A single sub-100ms thrust tick on advance,
   off by default behind an explicit toggle (never autoplay — that's in the
   anti-goals). The 3D voyage makes the case stronger; the restraint rule
   stays.

9. ~~**Measure the flight, not just the gate.**~~ — done, and the number was
   worse than this entry guessed: `scripts/e2e/budget.mjs` measured **2.66 MB**
   after the click, not 1.6. It asserts a cold ceiling and a warm one, because
   the same round found the whole of that transfer sitting on the critical path
   and moved it off (see 10). One warning for whoever writes the next check
   here: **a registered Playwright route turns the browser's HTTP cache off**,
   so every other script in `scripts/e2e/` is structurally blind to caching —
   `budget.mjs` serves its Supabase stub as real same-origin HTTP instead.

10. ~~**Close the double loading screen.**~~ — closed from both ends. The two
    screens became one instrument first (`PreflightConsole` in
    `src/ui/primitives.tsx`, rendered from both sides of the chunk boundary so
    only a row changes across the seam), and then `src/lib/warm.ts` removed
    most of the wait itself: the flight chunk and its media are pulled at idle
    while the splash is being read, so a visitor who spends a few seconds there
    presses the button and transfers **nothing**. What is left to spend on this
    moment is the SCENE BUILD — shader compiles and geometry upload, which the
    warm-up cannot touch and the boot overlay honestly reports.

11. **The flight chunk is still 1.31 MB (381 kB gzipped).** The warm-up takes
    it off the click for anyone who pauses at the splash; the visitor who
    presses the button on arrival still waits for it, and it is the single
    largest thing this site downloads. Two things are true about it and only
    one of them is a lever:

    - Chunking is NOT the lever. It deliberately has no named chunk — naming
      one hoisted it into the entry preload twice, at ~1.4s of FCP each, and
      vite.config.ts tells both stories at length. Splitting it further would
      move bytes around, not remove them.
    - `three`'s own minified build is ~750 kB of the 1.31 MB, so **most of
      this is three.js and always will be**. What is worth an actual
      measurement before anyone reaches for a config knob is the rest: drei is
      pulled into six modules for exactly five helpers (`Billboard`,
      `Environment`, `PerformanceMonitor`, `useProgress`, `useTexture`), and
      `Effects.tsx` imports the postprocessing pipeline for a bloom and a
      vignette. Both are ESM and should tree-shake; nobody has checked whether
      they do. `rollup-plugin-visualizer` against the real build would answer
      it in ten minutes and would say whether there is anything here at all —
      the honest possibility is that the answer is "no, it's three.js", and
      that is worth knowing before optimising on a hunch.
