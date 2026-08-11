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

9. **Measure the flight, not just the gate.** `scripts/e2e/lighthouse.mjs`
   scores 100, and it only ever loads the gate — 253 kB of a ~1.6 MB
   experience. Every asset regression this project has ever had lived on the
   far side of the code prompt, structurally invisible to its own green check.
   Drive `unlock()` from `scripts/e2e/_lib.mjs`, sum response sizes to network
   quiet, and assert a post-unlock transfer budget (~1.6 MB is the number to
   beat today). That converts the whole asset round into a regression test.

10. **Close the double loading screen.** Submitting the gate shows the lazy
    chunk's `SplashSkeleton`, then the boot overlay — two full-screen states
    with different layouts and no shared thread, which wastes the one moment
    the visitor is most invested. Either pass a stage through so the skeleton
    renders the same checklist shell the boot overlay does (one instrument
    filling in, not two screens swapping), or let the gate hold its own submit
    state until the flight module resolves.
