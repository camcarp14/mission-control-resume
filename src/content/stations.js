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

/** The pilot identity shown on the hero — same single-source rule as the stations. */
export const pilot = {
  // Two words on purpose: Hero.tsx stacks each word of the name on its own
  // line, so the full name holds the same width the short handle used to.
  name: 'CAMERON CARPENTER',
  role: 'REVENUE OPERATIONS \u00b7 PERFORMANCE MARKETING',
  status: 'OPEN TO NEW MISSIONS',
  callsign: 'CC-01',
};

/** @type {Station[]} */
export const stations = [
  // -- STN 01 \u00b7 LIFTOFF ---------------------------------------------------
  // The thesis every later station proves. The $75M figure is the owner's
  // own calculation across his portfolios, stated the way he asked it to be
  // stated; the interview-safe unpacking is "channel lead on teams
  // overseeing $75M."
  {
    id: 'liftoff',
    code: 'STN 01',
    title: 'Liftoff \u2014 The Positioning',
    proves:
      'Revenue operations and performance marketing: $75M+ in media investment managed since 2023, and the forecasting, pacing, and reporting systems that connect it to pipeline and revenue.',
    bullets: [
      'Managed $75M+ in media investment since 2023 across healthcare, retail, and logistics \u2014 six healthcare business units under a Fortune 5 payer, a national retail brand, and a global logistics provider',
      'Owned budget forecasting, pacing models, and weekly performance analysis; presented quarterly business reviews and strategic roadmaps built in partnership with SEO, paid social, video, programmatic, and measurement teams',
      'Built the forecasting, pacing, attribution, and reporting systems that connect advertising, analytics, and CRM data to pipeline and revenue \u2014 with AI tooling applied throughout to expand the scope a single analyst can own',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 02 \u00b7 FLIGHT PLAN -----------------------------------------------
  // Newest first, one headline number per role. The founder line matters as
  // much as its metric-less neighbours: it is the "more than my years" claim
  // made concrete \u2014 a whole company run solo, on the side.
  {
    id: 'flight-plan',
    code: 'STN 02',
    title: 'Flight Plan \u2014 The Timeline',
    proves:
      'Three roles in four years: a $63B enterprise integration, then a multi-account search portfolio, then a company of my own on the side.',
    bullets: [
      'Ovative Group \u2014 Senior Analyst, SEM (2023\u2013now): managed $75M+ in client media investment; drove a 175% YoY increase in enrollments for a national Medicare insurance marketplace during AEP',
      'Zero To Secure \u2014 Founder (2025\u2013now): built a bootstrapped DTC e-commerce brand end to end as a solo operator \u2014 product positioning, custom Shopify development, SEO content, and go-to-market execution',
      'AbbVie \u2014 Strategic Initiatives Analyst (2022\u201323): supported the $63B Allergan integration within a highly matrixed organization, administering a 2,400-user project platform',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 03 \u00b7 THE STACK -------------------------------------------------
  // The ecosystem map with his operating zone marked. The diagram is the
  // real chain he works \u2014 engines, call intelligence, analytics, warehouse \u2014
  // not a borrowed programmatic poster.
  {
    id: 'the-stack',
    code: 'STN 03',
    title: 'The Stack \u2014 Where I Operate',
    proves:
      'I work across the full chain \u2014 ad platforms, call intelligence, analytics, and the reporting warehouse \u2014 with most of my time at the handoff between activation and measurement.',
    bullets: [
      'Hands-on daily across Google Ads, Microsoft Advertising, SA360, GA4, Adobe Analytics, and Invoca \u2014 plus the Apps Script automation that stitches them together',
      'Ran a full SA360 offboarding end to end: unlinked both engines, stripped tracking templates at five levels, preserved UTM continuity, and pinned down billing so no post-migration fees landed',
      'Platform-versus-source-of-truth reconciliation as standard practice \u2014 caught a ~$40K spend understatement in a connector and a GA4 filter gap the platform numbers hid',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/stack-map.svg',
      alt: 'Search and measurement stack map: Google Ads and Microsoft Ads feeding call intelligence, analytics, and the reporting warehouse, with the activation\u2013measurement seam marked as the operating zone.',
    },
  },

  // -- STN 04 \u00b7 INTEGRATION ------------------------------------------------
  // The deepest technical artifact. No public doc exists for client work, so
  // the copy carries the station alone \u2014 better no link than a fake one.
  {
    id: 'integration',
    code: 'STN 04',
    title: 'Integration \u2014 Signals Into Bidding',
    proves:
      'Conversion tracking and bidding architectures designed to optimize toward lead quality rather than raw volume \u2014 then translated into business terms for client leadership.',
    bullets: [
      'Structured the signal architecture \u2014 call-quality conversion data, value-based bidding frameworks, and KPI hierarchies \u2014 tied to downstream pipeline and revenue rather than platform-reported volume',
      'Executed a full pixel cutover on two business days\u2019 notice: migrated conversion actions to call-signal sources across both engines ahead of the client\u2019s site transition, flagging the value-based bidding risk in writing',
      'Ran the test-and-learn program: new ad formats and automation quantified head-to-head against incumbent tactics on spend and ROI, with pilots gated behind conversion-signal readiness',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 05 \u00b7 PIPELINE --------------------------------------------------
  // The automation story. "Backbone" is his named, real system; the 300+
  // hours figure comes straight off the r\u00e9sum\u00e9.
  {
    id: 'pipeline',
    code: 'STN 05',
    title: 'Pipeline \u2014 The Reporting Backbone',
    proves:
      'Reporting, pacing, and forecasting systems built solo with AI tools, adopted by multiple client teams \u2014 saving 300+ hours per quarter.',
    bullets: [
      'Built \u201cBackbone\u201d: a configurable Google Ads script and Sheets system generating account reporting from declarative config \u2014 binding guards that halt on the wrong account, healthcare modes, and automated failure alerting',
      'Wrote a tie-out assertion suite that gates publishing \u2014 it caught a brand-classification defect routing 100% of a client\u2019s spend to non-brand while every additivity check still passed',
      'Built-in data-integrity checks caught broken conversion tracking and understated platform spend before either reached client deliverables or bidding algorithms \u2014 and a dead feed surfaces as a warning, not a $0',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/pipeline.svg',
      alt: 'Backbone reporting pipeline: ad engines flowing through a config-driven script layer and tie-out assertion gates into dashboards and pacing.',
    },
  },

  // -- STN 06 \u00b7 THE DASHBOARD ----------------------------------------------
  // The dashboard matters because of what it changed \u2014 the reinvestment
  // decision is the story, the artifact is the evidence.
  {
    id: 'dashboard',
    code: 'STN 06',
    title: 'The Dashboard \u2014 Built for a Decision',
    proves:
      'One dashboard\u2019s numbers made the case for reinvesting brand savings into Shopping \u2014 the budget moved the same week.',
    bullets: [
      'Designed a multi-client dashboard stack driven by per-client config \u2014 one template serving accounts with fundamentally different structures, including accounts with no brand/non-brand split at all',
      'Unified paid and organic search into a single Holistic Search view, then templatized it for rollout to any client with two variables to change',
      'Traced brand Shopping cannibalization to its query source and negated it, letting the more efficient Brand Text campaign capture the traffic instead',
    ],
    artifact: {
      kind: 'image',
      src: '/placeholders/dashboard.svg',
      alt: 'Multi-client paid search dashboard: spend, ROAS, pacing, and channel mix with the brand-efficiency reinvestment decision annotated.',
    },
  },

  // -- STN 07 \u00b7 THE TURNAROUND ---------------------------------------------
  // The retail story, told discovery \u2192 intervention \u2192 result. Every number
  // here is from the client-facing recap, and the proves line is the
  // r\u00e9sum\u00e9 bullet nearly verbatim.
  {
    id: 'the-close',
    code: 'STN 07',
    title: 'The Turnaround \u2014 Retail Search',
    proves:
      'Reversed declining efficiency on a national retail brand \u2014 spend down 13% year over year, revenue up 5%, ROAS up 20% \u2014 then redirected the savings into more incremental tactics.',
    bullets: [
      'Walked brand CPCs down progressively through bid portfolios rather than cutting reach \u2014 efficiency recovered while coverage held',
      'Traced performance discrepancies to their root causes \u2014 broken conversion tracking, misconfigured signals, understated platform spend \u2014 and resolved them before they reached clients or bidding algorithms',
      'Restructured non-brand post-launch: +86% week-over-week ROAS as CPCs fell 33%, with the recovered budget spread across more incremental tactics in the portfolio',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 \u00b7 FIREFIGHT --------------------------------------------------
  // The incident. Credibility lives here: the silent failure found and
  // traced, and the bidding models protected from the window it corrupted.
  {
    id: 'firefight',
    code: 'STN 08',
    title: 'Firefight \u2014 The Incident',
    proves:
      'A Medicare account\u2019s conversions went to zero mid-migration \u2014 call signals had silently failed to carry over, and the fix landed before the gap poisoned the bidding models.',
    bullets: [
      'Symptom: campaign conversions flat zero after a call-intelligence migration \u2014 doctor-visit call signals silently failing to carry into the new instance',
      'Fix: recreated the conversion actions and applied a data exclusion so the corrupted window could not poison the bidding algorithm',
      'Caught a different class of risk in creative: flagged AI-generated human imagery in live ads as an emerging regulatory exposure, audited the healthcare portfolio, and drove full replacement with sourced assets',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 \u00b7 GROUND CREW --------------------------------------------------
  // The manager-without-the-title station \u2014 the one that answers "more than
  // my years." Operating models, curricula, firm-wide enablement.
  {
    id: 'force-multiplier',
    code: 'STN 09',
    title: 'Ground Crew \u2014 Enablement',
    proves:
      'A go-to resource on lead generation and AI workflows within the SEM team \u2014 trainings, enablement materials, and coaching for junior analysts across several accounts.',
    bullets: [
      'Authored the portfolio RACI and growth plan: named first-pass owners per account, escalation paths, QA gates, and growth expectations by level for a five-person team',
      'Guided a summer intern through a self-authored 13-week curriculum mapped to the firm\u2019s leadership competencies',
      'Authored the lead-generation and AI-workflow trainings, best practices, and enablement materials the broader group works from',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 10 \u00b7 INSTRUMENTS ------------------------------------------------
  // Education and the toolkit. No invented certifications: the r\u00e9sum\u00e9
  // carries none, so this station carries the degree and the stack instead.
  {
    id: 'certs-instruments',
    code: 'STN 10',
    title: 'Instruments \u2014 Education & Stack',
    proves:
      'The toolkit behind the work: a business degree, a platform stack used daily, and the AI tooling that extends what one analyst can cover.',
    bullets: [
      'University of Wisconsin\u2013Madison \u2014 BBA, double major in Marketing and Risk Management & Insurance (2023)',
      'Platforms & tools: Google Ads \u00b7 Microsoft Advertising \u00b7 SA360 \u00b7 GA4 \u00b7 Adobe Analytics \u00b7 Invoca \u00b7 Tableau \u00b7 Shopify \u00b7 Claude Code \u00b7 Excel \u00b7 ClickUp',
      'Revenue ops & media: conversion tracking & attribution \u00b7 reporting & workflow automation \u00b7 forecasting & pacing \u00b7 funnel & cohort analysis \u00b7 experiment design \u00b7 value-based bidding',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 11 \u00b7 DOCKING ----------------------------------------------------
  // The close. This is the one link on the site that must never fail, and
  // the contact line is deliberately ALSO plain text \u2014 a dead mail client
  // must not be the only way to reach him.
  {
    id: 'docking',
    code: 'STN 11',
    title: 'Docking \u2014 Let\u2019s Talk',
    proves:
      'I have been running the plan and the numbers across a portfolio \u2014 I would like to do the same for your team.',
    bullets: [
      'Scope to date: $75M+ in media investment managed, the strategic roadmaps behind each account, and junior analysts coached into named account ownership',
      'Week one: map the live campaigns to their measurement, learn the guardrails, and take something small off the team\u2019s plate',
      'Chicago \u00b7 cam.carp14@gmail.com \u00b7 linkedin.com/in/CameronCarpenter1 \u2014 the PDF above has the rest',
    ],
    artifact: {
      kind: 'link',
      href: 'mailto:cam.carp14@gmail.com',
      label: 'Start the conversation',
    },
  },
];
