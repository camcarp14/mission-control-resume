# Mission Control — a résumé you pilot

A gated, single-page interactive resume: the visitor flies an SVG rocket along a
continuous path past eleven stations, each one a real career artifact. Advance is
deliberate — spacebar, arrow keys, click, swipe, or the on-screen button — never
free scroll. A Supabase-backed gate attributes every visit to a per-company access
code and logs how far each visitor flew; a passcode-protected `/dashboard` shows
you the logbook.

Built with Vite + React + Tailwind + Framer Motion + Supabase, deployed on
Netlify. No CDN dependencies in the core render; system font stack; dark only.

## Quickstart

```bash
npm install
npm run dev
```

That's it — with no `.env` at all, dev boots into **offline preview** mode: the
gate accepts any code, logs nothing, and says so on a badge. The full flight,
static mode, reduced motion, and mobile layout all work offline. (A *production*
build with missing env fails closed: config error screen, gate shut.)

## Wiring up Supabase (the gate + logbook)

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

The schema is deny-all: RLS is enabled and *forced* on every table with zero
policies, and the only doors are four `security definer` RPCs with explicit
grants. Direct table reads with the anon key return permission-denied — if they
ever return an empty success instead, that's a leak; `/api/env-check` probes for
exactly that.

## Minting access codes

One code per company, so the dashboard attributes views:

```sql
insert into access_codes (code, company, note)
values ('ACME-K7M3', 'Acme Corp', 'shared with J. Doe 2026-08-12');
```

Format advice: `COMPANY-XXXX` with four characters of entropy. Redemption is
case- and whitespace-insensitive. Kill a code anytime with
`update access_codes set active = false where code = 'ACME-K7M3';` — its rows and
attribution stay in the logbook.

There's in-database rate limiting (per-IP and global, per minute) in front of
code redemption and the dashboard passcode check, so codes can't be sprayed.

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
wired to that path from the gate, every station, and the static page.

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
npm test              # engine math, stations schema, polish invariants (fast)
npm run gate          # + typecheck, Netlify-identical function bundles, build, secret sweep
npm run e2e           # the browser bar: frames, axe+keyboard, breakpoints,
                      #   gate-breach, reduced-motion, pdf, lighthouse
RUN_E2E=1 npm run gate  # everything
```

The e2e suite runs a real production build against a mocked Supabase wire
(Playwright route interception — no test hooks compiled into the app). The
frame check runs under 4× CPU throttle, which **approximates** a mid-range
phone; the Lighthouse check asserts performance ≥ 90 with FCP and LCP under
1.5s on simulated 4G (FMP is deprecated; FCP/LCP are the modern equivalents).
`scripts/e2e/gate-breach.mjs` additionally probes a *live* Supabase (direct
REST reads must come back permission-denied) whenever real env vars are
present — and says loudly that it skipped otherwise.

## What the gate is, honestly

The gate is **attribution and access control, not DRM**. No URL and no persisted
client state unlocks the experience without a server-validated token
(sessionStorage is re-validated on every cold load, and the flight/content
chunk isn't even fetched until a code redeems). A technical visitor who has
already redeemed a code can read the JS bundle — it contains nothing that isn't
on the PDF you're handing out anyway. Visit tokens only authorize updating that
visit's own progress row, so replay is harmless by construction.

## Escape hatches (deliberate, load-bearing)

- **Download PDF** — visible at the gate, at every station, and in static mode.
- **Skip the flight** — collapses the whole thing into a clean scrollable page
  with identical content, one toggle, reversible.
- **`prefers-reduced-motion`** — fully honored: cross-fades instead of flight,
  parallax and idle animation off, every control identical.
- **No email required** — the field exists and is labeled optional; the gate
  never demands it.
