# If I had one more day

Ranked by expected payoff for the actual goal — getting an adtech SC/SE hiring
panel to remember this candidate.

> **First, a 30-second edit:** the hero headline reads whatever
> `pilot.name` says in `src/content/stations.js` (currently the
> handle-derived placeholder `CAM CARP`, callsign `CC-01` — the callsign is
> also painted on the rocket's hull livery in `src/flight3d/Rocket3D.tsx`).
> Set your real name, role line, and status chip there.

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

5. **An OG/social card + `/preview` route.** Codes get pasted into Slack; right
   now the unfurl is generic. A dark telemetry OG image (the Saturn station
   frames beautifully) would make the link itself look designed.

6. **Real device pass.** The e2e frame checks run under CPU throttle and
   software rasterization as proxies; the WebGL voyage deserves an hour on an
   actual mid-range Android (Moto G class) with Chrome remote profiling —
   adaptive DPR via drei's PerformanceMonitor is the ready lever if a real
   device dips below 60.

7. **Texture compression pass.** The CC BY 4.0 textures ship as source webp
   (~1.8 MB streamed post-gate). KTX2/basis versions with a JS decoder fallback
   would roughly halve GPU memory and decode time on mobile — worth it the day
   the analytics show phone-heavy traffic.

8. **Sound design, opt-in only.** A single sub-100ms thrust tick on advance,
   off by default behind an explicit toggle (never autoplay — that's in the
   anti-goals). The 3D voyage makes the case stronger; the restraint rule
   stays.
