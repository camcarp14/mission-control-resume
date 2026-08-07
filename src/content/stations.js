// @ts-check
/* ==== STATIONS — the single source of truth for the mission ==============
 *
 * Every station the visitor pilots past lives in this one array. The whole
 * point of this file is that editing your resume never touches a component:
 * copy, order, and artifacts are data, and the UI renders whatever is here.
 *
 * How to edit:
 *   - Reorder stations by moving entries within the array, then renumber the
 *     `code` fields so they read 'STN 01' through 'STN 11' top to bottom.
 *     The schema test asserts codes are sequential, so a missed renumber
 *     fails CI instead of shipping a scrambled HUD.
 *   - Add a station by copying an entry, giving it a NEW `id` (ids are
 *     stable keys — never reuse one, even for a station you deleted), and
 *     renumbering codes. Remove a station by deleting its entry.
 *   - Swap placeholder copy for real material by filling every [BRACKETED]
 *     slot. The brackets are deliberate: they make unfinished copy easy to
 *     grep for (`grep -n '\[' src/content/stations.js`) and impossible to
 *     mistake for the real thing in review.
 *   - The hero identity (name / role / status chip) is the `pilot` export
 *     just below — edit it in place; the hero renders whatever is here.
 *
 * The schema, in prose:
 *   id      — stable machine key, lowercase, never changes once shipped.
 *   code    — the eyebrow label on the station HUD, 'STN 01'..'STN 11'.
 *   title   — the role, project, or artifact name. Short; it is a headline.
 *   proves  — ONE sentence stating the takeaway a hiring manager should
 *             leave with. Not a description of the thing — the conclusion.
 *   bullets — 2 to 3 outcome bullets, each led by a metric where possible.
 *   artifact — what backs the claim:
 *     kind 'none'  — the copy carries the station alone.
 *     kind 'link'  — needs `href` (live URL) and `label` (button text).
 *     kind 'image' — needs `src` (a path under public/, e.g.
 *                    '/placeholders/stack-map.svg') and `alt`.
 *     kind 'video' — needs `videoSrc` (a ~20-second walkthrough) and
 *                    optionally `poster` for the frame shown before play.
 *
 * The schema test (src/content/stations.test.ts) mechanizes all of the
 * above — count, id uniqueness, code sequence, required artifact fields,
 * and that every image path actually exists under public/. If you edit
 * this file and the tests stay green, the site renders.
 * ========================================================================= */

/** @typedef {Object} StationArtifact
 *  @property {'link'|'image'|'video'|'none'} kind
 *  @property {string} [href]   live artifact URL
 *  @property {string} [label]  link button text
 *  @property {string} [src]    screenshot path (public/)
 *  @property {string} [alt]    screenshot alt text
 *  @property {string} [videoSrc] optional 20-second walkthrough video
 *  @property {string} [poster] video poster frame
 */

/** @typedef {Object} Station
 *  @property {string} id       stable key — never reuse or reorder-depend
 *  @property {string} code     eyebrow label, e.g. 'STN 04'
 *  @property {string} title    role / project / artifact name
 *  @property {string} proves   ONE sentence: the takeaway, not the description
 *  @property {string[]} bullets 2–3 outcome bullets, metric-led
 *  @property {StationArtifact} artifact
 */

/** The pilot identity shown on the hero. EDIT ME — same single-source rule as the stations. */
export const pilot = {
  name: 'CAM CARP', // hero headline — huge display type; edit to your full name
  role: 'SOLUTIONS CONSULTANT · ADTECH',
  status: 'OPEN TO NEW MISSIONS',
  callsign: 'CC-01',
};

/** @type {Station[]} */
export const stations = [
  // -- STN 01 · LIFTOFF ---------------------------------------------------
  // Your positioning statement. Replace the brackets with your real numbers
  // and vendor categories — this is the thesis every later station proves.
  {
    id: 'liftoff',
    code: 'STN 01',
    title: 'Liftoff — The Positioning',
    proves:
      'I am the technical translator between ad platforms and revenue — the person who reads the API spec on Monday and explains it to the buyer who signs on Friday.',
    bullets: [
      '[N] years in programmatic across [DSP / SSP / measurement] vendors — pre-sales, integrations, and the technical side of retention',
      'Technical seat on [$X]M in closed ARR: discovery, proof-of-concept builds, and security reviews that kept deals moving',
      'Equally at home in a request log and a QBR deck — the range the rest of this flight is built to prove',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 02 · FLIGHT PLAN -----------------------------------------------
  // Career timeline, newest first, exactly one metric per role. Resist the
  // urge to list duties — a hiring manager scans this in four seconds.
  {
    id: 'flight-plan',
    code: 'STN 02',
    title: 'Flight Plan — The Timeline',
    proves:
      'A steady climb from support to trusted technical counterpart, with a measurable win at every altitude.',
    bullets: [
      '[Company C] — Senior Solutions Consultant ([YYYY]–now): technical lead on [N] enterprise evaluations with a [X]% win rate when attached',
      '[Company B] — Solutions Engineer ([YYYY]–[YYYY]): cut integration go-live from [X weeks] to [Y days] by [standardizing the onboarding runbook]',
      '[Company A] — Technical Account Manager ([YYYY]–[YYYY]): owned [N] accounts through [a platform migration] at [X]% retention',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 03 · THE STACK -------------------------------------------------
  // Your map of the programmatic ecosystem with your operating zone marked.
  // Replace the placeholder SVG with a real diagram export at 1200x750 —
  // the point is showing you can draw the supply chain from memory.
  {
    id: 'the-stack',
    code: 'STN 03',
    title: 'The Stack — Ecosystem Map',
    proves:
      'I can draw the whole programmatic supply chain from memory — and mark exactly where I add leverage.',
    bullets: [
      'Hands-on across the chain: [DSP] campaign architecture, [SSP] deal troubleshooting, [ad server] trafficking, [CDP] audience plumbing',
      'Clean-room literate: built [a match-rate analysis / conversion lift study] in [ADH / LiveRamp / Habu] for [an enterprise advertiser]',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/stack-map.svg',
      alt: 'Map of the programmatic ecosystem from advertiser to publisher, with my operating zone marked across CDP, DSP, and clean room',
    },
  },

  // -- STN 04 · INTEGRATION -----------------------------------------------
  // Your best API integration story — S2S conversion sync, CRM-to-DSP
  // audience push, a header bidding wrapper debug. Keep the bullets at the
  // request-response level: endpoints, dedupe keys, retry semantics. Point
  // href at the real doc (sanitized) — it is the strongest artifact here.
  {
    id: 'integration',
    code: 'STN 04',
    title: 'Integration — The S2S Conversion Sync',
    proves:
      'When the deal needed a server-to-server conversion sync, I read the spec, wrote the sample requests, and got both engineering teams to yes.',
    bullets: [
      'Scoped the flow: client backend POSTs events to [/v2/conversions], we dedupe on [transaction_id], forward to the DSP inside [X min] at a [Y]% match rate',
      'Wrote the integration doc both sides actually used — auth, retry semantics ([exponential backoff on 5xx only]), and a sandbox with canned responses',
      '[Advertiser] activated [$X]/month in spend within [N weeks] of go-live',
    ],
    artifact: {
      kind: 'link',
      href: 'https://example.com/replace-me',
      label: 'View the integration doc',
    },
  },

  // -- STN 05 · PIPELINE --------------------------------------------------
  // The measurement or reporting pipeline you built or ran, with scale
  // numbers. Replace the placeholder SVG with a real architecture export —
  // event volume and freshness SLA are the two numbers that land.
  {
    id: 'pipeline',
    code: 'STN 05',
    title: 'Pipeline — Events to Answers',
    proves:
      'I have moved billions of ad events from raw logs to a report a marketer can defend in a budget meeting.',
    bullets: [
      '[X]B events/day from [bid logs, impression trackers, conversion pixels] through [Kafka / Kinesis] into [BigQuery / Snowflake]',
      'Cut the duplicate rate from [X]% to [Y]% by [keying dedupe on impression_id plus a timestamp bucket]',
      'Freshness SLA: dashboards within [X min] of event time, with alerting when lag exceeds [Y min]',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/pipeline.svg',
      alt: 'Data pipeline diagram from pixel and server-side event sources through ingest, dedupe, and identity join into the warehouse and reporting',
    },
  },

  // -- STN 06 · THE DASHBOARD ---------------------------------------------
  // A stakeholder dashboard is only as good as the decision it changed —
  // lead with that decision. Replace the placeholder SVG with a real
  // (sanitized) screenshot of the dashboard itself.
  {
    id: 'the-dashboard',
    code: 'STN 06',
    title: 'The Dashboard — Built for a Decision',
    proves:
      'The dashboard mattered because of what it changed — [client] moved [$X] of budget the week it shipped.',
    bullets: [
      'Built for the [VP of Media]: pacing, eCPA, and viewability by [channel and deal ID] on one screen, no export required',
      'Surfaced that [PMP deals] were underdelivering forecast by [X]% — budget reallocated within [one flight cycle]',
      'Adopted by [N] account teams, retiring [a weekly spreadsheet ritual] that cost [X hours/week]',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/dashboard.svg',
      alt: 'Stakeholder dashboard showing spend, eCPA, pacing, and viewability KPIs with delivery trend and spend-by-channel breakdowns',
    },
  },

  // -- STN 07 · THE CLOSE -------------------------------------------------
  // Your flagship pre-sales win, told as discovery, technical validation,
  // objection, signature. One deal, told well, beats five listed.
  {
    id: 'the-close',
    code: 'STN 07',
    title: 'The Close — Flagship Win',
    proves:
      'On a [$X]M [DSP / measurement] deal the technical evaluation WAS the deal — and I ran it end to end.',
    bullets: [
      'Discovery: mapped the client stack in two calls and found the wedge — [their attribution vendor could not read walled-garden data]',
      'Validation: ran a [N]-week POC against live campaigns and beat [the agreed success metric] with margin',
      'Objection: security flagged [data residency]; closed it with [a regional-processing architecture doc] — signature inside [the quarter]',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 · FIREFIGHT -------------------------------------------------
  // A production incident you debugged under pressure. The shape that
  // lands: symptom with dollars at stake, root cause with the proof method,
  // fix with the retention outcome. Tracking outages, discrepancy spikes,
  // and consent-mode breakage all belong here.
  {
    id: 'firefight',
    code: 'STN 08',
    title: 'Firefight — The Incident',
    proves:
      'When [a top account]\'s conversion tracking went dark mid-flight, I found the root cause before the postmortem was even scheduled.',
    bullets: [
      'Symptom: conversions down [X]% overnight with spend unchanged — client threatening to pause [$X]/month',
      'Root cause: [a browser privacy change] silently truncated [the click ID parameter]; proved it by [diffing request logs across browser versions]',
      'Shipped [a first-party redirect fallback] in [X hours]; account retained and renewed at [+Y]%',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 · FORCE MULTIPLIER ------------------------------------------
  // Enablement docs, training, or internal tools — with adoption numbers,
  // because "wrote docs" is a duty and "[N] SEs use it monthly" is a win.
  // Point href at the real hub, a Loom, or a sanitized sample doc.
  {
    id: 'force-multiplier',
    code: 'STN 09',
    title: 'Force Multiplier — Enablement',
    proves:
      'I make the people around me faster — the docs and tools I build outlive every deal they were built for.',
    bullets: [
      'Wrote [the API troubleshooting runbook] now used by [N] SEs — new-hire ramp on [integrations] down from [X weeks] to [Y days]',
      'Built [a tag-validation tool] run [N times/month]; escalations to engineering down [X]%',
      'Ran [monthly enablement] on [programmatic fundamentals]; [N] AEs certified on [the technical demo]',
    ],
    artifact: {
      kind: 'link',
      href: 'https://example.com/replace-me',
      label: 'Browse the enablement hub',
    },
  },

  // -- STN 10 · CERTS & INSTRUMENTS ---------------------------------------
  // Certifications and tool belt. Keep each bullet a compact
  // 'CERT — issuer — year' string; the station renders them as a rack, not
  // prose. Lead with the certs an adtech hiring manager recognizes.
  {
    id: 'certs-instruments',
    code: 'STN 10',
    title: 'Certs & Instruments',
    proves:
      'The paper matches the practice — certified where it counts, current where the industry moves.',
    bullets: [
      '[Display & Video 360 Certification] — Google — [YYYY]',
      '[Edge Academy Executive Certificate] — The Trade Desk — [YYYY]',
      '[Digital Ad Operations Certification] — IAB — [YYYY]',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 11 · DOCKING ---------------------------------------------------
  // The why-me close, written for an adtech SC/SE hiring manager, ending in
  // a contact CTA. Replace the mailto with your real address — this is the
  // one link on the site that must never 404.
  {
    id: 'docking',
    code: 'STN 11',
    title: 'Docking — Why Me, Why Now',
    proves:
      'You need someone who can carry the technical half of the deal on day one — that is the job I have been doing and the job I want.',
    bullets: [
      'Week one: [shadow every active technical evaluation, audit the demo environment, ship one fix to the POC playbook]',
      'The pattern across every station behind you: translate, prove, close — [N] years of making ad infrastructure legible to buyers',
    ],
    artifact: {
      kind: 'link',
      href: 'mailto:you@example.com',
      label: 'Start the conversation',
    },
  },
];
