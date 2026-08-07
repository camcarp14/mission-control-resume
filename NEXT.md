# If I had one more day

Ranked by expected payoff for the actual goal — getting an adtech SC/SE hiring
panel to remember this candidate.

1. **Session replay on the dashboard.** The logbook shows furthest-station; the
   better signal is *dwell per station*. Log `(visit_id, station, ms)` beacons
   into a `station_dwell` table (sendBeacon on `pagehide` so the last station
   isn't lost) and render a per-visit sparkline. "They spent 90 seconds on the
   FIREFIGHT station" is a conversation opener in the interview itself.

2. **A real 20-second walkthrough video for two stations.** The slot exists in
   the schema; nothing sells "I demo software for a living" like a tight,
   narrated 20 seconds over the real dashboard artifact. Two good videos beat
   eleven mediocre ones.

3. **Per-code theming of the DOCKING station.** The final station's close could
   read differently per access code ("Why me, for *Acme* specifically") — one
   optional `closing` field on `access_codes`, fetched at redemption, injected
   into station 11. Personalization at the exact moment they're deciding
   whether to reply.

4. **An OG/social card + `/preview` route.** Codes get pasted into Slack;
   right now the unfurl is generic. A dark telemetry OG image and a no-gate
   preview of station 1 (content already public on the PDF) would make the
   link itself look designed.

5. **Dwell-aware rate limiting + code expiry.** `expires_at` on access_codes
   and an `attempts` column surfaced on the dashboard, so a leaked code ages
   out gracefully instead of needing manual deactivation.

6. **Sound design, opt-in only.** A single sub-100ms thrust tick on advance,
   off by default behind an explicit toggle (never autoplay — that's in the
   anti-goals). Done tastefully it deepens the "mass" illusion; done lazily it
   gets the tab closed. Hence: day two, not day one.

7. **Real device pass.** The frame check runs under 4× CPU throttle as a
   mid-range-phone proxy; an hour with an actual mid-range Android (Moto G
   class) via `adb` + Chrome remote profiling would either confirm 60fps or
   find the one compositor surprise emulation always hides.
