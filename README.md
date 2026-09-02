# Mission Control — a résumé you pilot

A single-page interactive resume: the visitor pilots a rocket through a
WebGL solar system — Earth departure, Jupiter, Saturn's rings, an ember nebula,
docking at the sun, then the flight home — with a career artifact stationed at
every body. Advance is deliberate — spacebar, arrow keys, click, swipe, or the
on-screen button — never free scroll. A Supabase-backed sign-in records who came
and how far they flew; a passcode-protected `/dashboard` shows you the logbook.

Built with Vite + React 19 + Tailwind + Framer Motion + three.js
(react-three-fiber, drei, postprocessing) + Supabase, deployed on Netlify. No CDN
dependencies in the core render; system font stack; dark only. Everything the
visitor can read lives in the DOM — the canvas is aria-hidden scenery, so
keyboard order, focus, and screen-reader flow are identical with WebGL on or
off. Fallback ladder: WebGL + motion → full voyage · reduced-motion → still
solar backdrop with cross-fading panels · no WebGL → cross-fading panels.

## Quickstart

```bash
npm install
npm run dev
```

That's it — with no `.env` at all, dev boots into **offline preview** mode: the
sign-in opens, logs nothing, and says so on a badge. The full flight, static
mode, reduced motion, and mobile layout all work offline. (A *production* build
with missing env fails closed: config error screen, door shut.)

## Wiring up Supabase (the sign-in + logbook)

1. Create a Supabase project (free tier is fine).
2. Open the SQL editor, paste **all of** `supabase/migrations/0001_resume_gate.sql`,
   run it. It is idempotent — safe to re-run whole.
3. Copy `.env.example` to `.env` and fill in:
   - `VITE_SUPABASE_URL` — your project URL
   - `VITE_SUPABASE_ANON_KEY` — the anon key (role claim must decode to `anon`)
4. **Change the dashboard passcode** (it ships as `liftoff`):

```sql
update gate_config set dashboard_passcode_hash = extensions.crypt('your-new-passcode', extensions.gen_salt('bf'));
```

Both migrations, in order. **0002 is the one that matters for how this reads
today**: it retires the per-company access code and replaces `redeem_access_code`
with `begin_visit`, an open front door that takes an optional name and company.
The logbook still records who came and how far they flew; it just no longer asks
for a ticket. `access_codes` and `redeem_access_code` survive in the schema —
history, and a one-line re-grant away if codes ever come back — but nothing in
the UI reaches them, and 0002 revokes anon's right to execute the old function.

The schema is deny-all: RLS is enabled and *forced* on every table with zero
policies, and the only doors are `security definer` RPCs with explicit grants.
Direct table reads with the anon key return permission-denied — if they ever
return an empty success instead, that's a leak; `/api/env-check` probes for
exactly that.

There's in-database rate limiting (per-IP and global, per minute) in front of
`begin_visit` and the dashboard passcode check, so neither can be sprayed.

## Adding / editing stations — one file

Everything the stations say lives in **`src/content/stations.js`** and nowhere
else. Add, remove, reorder, or rewrite stations by editing that single file; the
components render whatever is there. The file's header comment is the manual.
Two tests keep this honest:

- `src/content/stations.test.ts` validates the schema (count, ids, codes,
  bullet counts, artifact fields, that referenced screenshots exist under
  `public/`).
- `src/ui/polish.test.ts` fails if a station literal ever leaks into a
  component.

Screenshots go in `public/` (1200×750 works well — see `public/placeholders/`),
and the walkthrough-video slot takes a `videoSrc` + optional `poster` per
station. Replace `public/resume.pdf` with your real PDF — the download button is
wired to that path from the sign-in, every station, and the static page.

## Deploying to Netlify

1. Push this repo to GitHub and "Import from Git" in Netlify. `netlify.toml`
   already carries the build command, SPA fallback, immutable asset caching,
   and security headers.
2. Set two environment variables in Site settings → Environment:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   (Optionally `SUPABASE_SERVICE_ROLE_KEY` — used only by the `/api/env-check`
   diagnostic's deeper probes; the app itself never needs it.)
3. Deploy. Then open `/api/env-check` on the live site — it tells you in one
   JSON payload whether the env is consistent and RLS is actually denying.

## Verification

```bash
npm test              # engine math, stations schema, warm-up + polish invariants (fast)
npm run gate          # + typecheck, Netlify-identical function bundles, build, secret sweep
npm run e2e           # the browser bar: frames, axe+keyboard, breakpoints, budget,
                      #   gate-breach, reduced-motion, pdf, lighthouse
RUN_E2E=1 npm run gate  # everything
npm run ready         # the CONTENT gate — run this before sending anyone the link
```

The e2e suite runs a real production build against a mocked Supabase wire
(Playwright route interception — no test hooks compiled into the app).
`budget.mjs` is the one exception and the reason is worth knowing before you
write another check here: **a registered Playwright route turns the browser's
HTTP cache off**, so under interception a working prefetch is indistinguishable
from no prefetch at all. That script therefore serves its Supabase stub as real
same-origin HTTP and intercepts nothing. The
frame check runs under 4× CPU throttle, which **approximates** a mid-range
phone; the Lighthouse check asserts performance ≥ 90 with FCP and LCP under
1.5s on simulated 4G (FMP is deprecated; FCP/LCP are the modern equivalents).
`scripts/e2e/gate-breach.mjs` additionally probes a *live* Supabase (direct
REST reads must come back permission-denied) whenever real env vars are
present — and says loudly that it skipped otherwise.

### `npm run ready` — the other kind of correct

Everything above proves the *software* works. All of it passed green on the day
an audit found the site was serving a résumé PDF whose visible text reads "Your
Name", a contact button pointing at `you@example.com`, and thirty bullets of
`[BRACKETED]` template copy. No test suite can catch that; every one of them is
the first thing a hiring manager would see.

`npm run ready` is that second gate. It fails on unfilled bracket slots,
placeholder links and contact addresses, a stub `resume.pdf`, artifact diagrams
with unfilled figures, a debug affordance rendering on the visitor-facing splash,
and a missing share surface (og:image / favicon / a `<title>` carrying your
name). It is deliberately **not** part of `npm run gate`: it is red until the
content is written, and a permanently-red CI check is a check everyone learns to
ignore. Run it in the sixty seconds before the link goes into a DM.

## What the gate is, honestly

The splash is **attribution, not access control**. There is no access code: both
fields are optional and "Begin the flight" opens on a blank form. What the
server still owns is the session — no URL and no persisted client state renders
the flight without a server-minted token, and sessionStorage is re-validated on
every cold load, so a forged devtools entry buys a re-gate rather than a resume.
Visit tokens only authorize updating that visit's own progress row, so replay is
harmless by construction. The JS bundle contains nothing that isn't on the PDF
you're handing out anyway.

Because the door is open, the splash spends the time you take to read it:
`src/lib/warm.ts` pulls the Supabase SDK, the flight chunk and the scene's media
at idle, in the order the button will need them. Measured on a production build,
that moves **2.66 MB off the click** — a visitor who reads the splash for a few
seconds presses the button and transfers nothing at all. It skips itself
entirely on `saveData`, `2g` and `slow-2g`. `npm run e2e` asserts both numbers
(`scripts/e2e/budget.mjs`), and `gate-breach.mjs` asserts the constraint that
makes it safe: the flight chunk is reachable only through a runtime `import()`,
never the entry's static preload graph.

## Assets & credits

- **Planet, moon, and sun textures + Milky Way panorama** — [Solar System
  Scope](https://www.solarsystemscope.com/textures/), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Vendored under
  `public/textures/`.
- **Models** — none. The project used to vendor two
  [Quaternius](https://quaternius.com) (CC0) models; the last of them, a
  tumbling astronaut near the outpost, was cut on the owner's call, and
  `public/models/` went with it.
- **HDRI lighting** — "Dikhololo Night" from [Poly Haven](https://polyhaven.com)
  (CC0), used for image-based lighting only, never as a backdrop. Vendored
  under `public/hdri/` at 256×128: three.js prefilters it through PMREM before
  it lights anything, so the 1k source was 1.7 MB of resolution thrown away
  before use. See `scripts/assets/`.
- **Display typeface** — [Space Grotesk](https://github.com/floriankarsten/space-grotesk)
  by Florian Karsten, licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org). Vendored under
  `public/fonts/` as a 27 KB WOFF2 subset (Latin-1 plus the punctuation and
  arrows the copy actually uses, wght 300–700 axis intact) and loaded lazily
  after the gate — the entry chunk stays on the system stack.
- Everything else on screen — the crew shuttle, asteroid fields, nebula, relay
  outpost, satellite, star cluster, dust, the Chicago skyline, the HUD — is
  generated procedurally in this repo's code. Textures, one HDRI and one
  typeface are the only things it downloads.

## Escape hatches (deliberate, load-bearing)

- **Download PDF** — visible at the splash, at every station, and in static mode.
- **Skip the flight** — collapses the whole thing into a clean scrollable page
  with identical content, one toggle, reversible.
- **`prefers-reduced-motion`** — fully honored: cross-fades instead of flight,
  parallax and idle animation off, every control identical.
- **No email required** — the field exists and is labeled optional; the gate
  never demands it.
