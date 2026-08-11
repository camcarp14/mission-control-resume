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
  role: 'PERFORMANCE MEDIA LEADER',
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
      'I turn media investment into measured customer growth \u2014 strategy and execution as one job, in categories where compliance is not optional.',
    bullets: [
      'Direct paid media strategy, planning, and investment across a portfolio representing $75M+ in client media spend \u2014 six healthcare business units under a Fortune 5 payer, a national retail brand, and a global logistics provider',
      'Deep in regulated healthcare marketing: Medicare patient acquisition, qualified-outcome measurement, and compliant creative governance',
      'Equally at home in a brand plan and a conversion-action matrix \u2014 the range the rest of this flight is built to prove',
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
      'Three seats in four years, each with a bigger blast radius: a $63B enterprise integration, then a multi-account search portfolio, then a company of my own on the side.',
    bullets: [
      'Ovative Group \u2014 Senior Analyst, SEM (2023\u2013now): direct paid media strategy and investment across a $75M+ portfolio; drove a 175% YoY increase in Medicare enrollments during AEP',
      'Zero To Secure \u2014 Founder (2025\u2013now): bootstrapped a DTC brand end to end \u2014 positioning, Shopify build, SEO, and AI-assisted operations as a solo operator',
      'AbbVie \u2014 Strategic Initiatives Analyst (2022\u201323): supported the $63B Allergan integration, managing a 2,400-user project platform',
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
      'I work the full chain from auction to warehouse, and I live at the seam where activation meets measurement \u2014 the place where most accounts quietly break.',
    bullets: [
      'Hands-on daily across Google Ads, Microsoft Ads, SA360, GA4, Adobe, and Invoca \u2014 plus the SQL, Python, and Apps Script that stitch them together',
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
      'When calls, pixels, and platforms disagree, I design the architecture that makes them one system the bidding algorithm can trust.',
    bullets: [
      'Designed the Invoca spoken-phrase conversion architecture for two Medicare accounts \u2014 phrase buckets and a conversion-action matrix that let bidding optimize toward call quality instead of raw call volume',
      'Executed a full pixel cutover on two business days\u2019 notice: migrated conversion actions to call-signal sources across both engines ahead of the client\u2019s site transition, flagging the value-based bidding risk in writing',
      'Ran a disciplined test-and-learn program on platform AI \u2014 quantified emerging AI-driven ad formats head-to-head against incumbent tactics on spend and ROI, and gated automation pilots behind conversion-signal readiness',
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
      'I moved three client portfolios from hand-built reporting to governed automation \u2014 and gave a quarter of reporting time back to the team, 300+ hours at a stroke.',
    bullets: [
      'Built \u201cBackbone\u201d: a configurable Google Ads script and Sheets system generating account reporting from declarative config \u2014 binding guards that halt on the wrong account, healthcare modes, and automated failure alerting',
      'Wrote a tie-out assertion suite that gates publishing \u2014 it caught a brand-classification defect routing 100% of a client\u2019s spend to non-brand while every additivity check still passed',
      'Built structured, versioned account briefs designed for an AI to read \u2014 each statement carrying its implication, confidence, and source \u2014 so analysis starts from maintained truth instead of a re-explained account; the guardrails are engineered so an invented number cannot ship',
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
      'The dashboard mattered because of what it changed: brand savings were reinvested into Shopping the week the numbers made the case.',
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
  // The flagship win, told discovery \u2192 intervention \u2192 result. Every number
  // here is from the client-facing recap: this is the station a hiring
  // panel quotes back.
  {
    id: 'the-close',
    code: 'STN 07',
    title: 'The Turnaround \u2014 Flagship Win',
    proves:
      'A national retail brand\u2019s paid program was bleeding efficiency \u2014 I rebuilt it so spend went down while revenue went up.',
    bullets: [
      'Launched brand bid portfolios and walked CPCs down progressively: spend \u221213% year over year while revenue rose 5% ($1.32M vs $1.26M) and ROAS improved from $7.30 to $8.80',
      'Reframed the savings as portfolio strategy, not a line item \u2014 budget reinvested into Shopping as the more incremental tactic while organic absorbed displaced brand traffic at no cost',
      'Restructured non-brand and right-sized targets post-launch: +86% week-over-week ROAS as CPCs fell 33% and conversion rate rose 17%',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 \u00b7 FIREFIGHT --------------------------------------------------
  // The incident. SC credibility lives here: the person who finds the silent
  // failure before the postmortem is scheduled.
  {
    id: 'firefight',
    code: 'STN 08',
    title: 'Firefight \u2014 The Incident',
    proves:
      'When a Medicare account\u2019s conversions went to zero mid-migration, I found the root cause before the postmortem was even scheduled.',
    bullets: [
      'Symptom: campaign conversions flat zero after a call-intelligence migration \u2014 doctor-visit call signals silently failing to carry into the new instance',
      'Fix: recreated the conversion actions and applied a data exclusion so the corrupted window could not poison the bidding algorithm',
      'Caught a different class of risk in creative: flagged AI-generated human imagery in live ads as an emerging regulatory exposure, audited the healthcare portfolio, and drove full replacement with sourced assets',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 \u00b7 FORCE MULTIPLIER -------------------------------------------
  // The manager-without-the-title station \u2014 the one that answers "more than
  // my years." Operating models, curricula, firm-wide enablement.
  {
    id: 'force-multiplier',
    code: 'STN 09',
    title: 'Force Multiplier \u2014 Enablement',
    proves:
      'I make the people around me faster \u2014 operating models, curricula, and tooling that outlive every account they were built for.',
    bullets: [
      'Authored the portfolio RACI and growth plan: named first-pass owners per account, escalation paths, QA gates, and growth expectations by level for a five-person team',
      'Managed a summer intern end to end \u2014 wrote a 13-week curriculum mapped to the firm\u2019s leadership competencies, built to grow judgment rather than task completion',
      'Built the search sections of a firm-wide Holistic Search 101 training deck used well beyond my own account teams',
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
      'The toolkit under the flight deck: a business degree, an operator\u2019s platform stack, and the code to automate both.',
    bullets: [
      'University of Wisconsin\u2013Madison \u2014 BBA, double major in Marketing and Risk Management & Insurance (2023)',
      'Platforms: Google Ads \u00b7 Microsoft Ads \u00b7 SA360 \u00b7 GA4 \u00b7 Adobe \u00b7 Invoca \u00b7 Tableau \u00b7 ClickUp',
      'Media & analytics: media planning & investment \u00b7 budget & pacing \u00b7 test-and-learn design \u00b7 value-based bidding \u00b7 SQL \u00b7 Python \u00b7 AI workflow engineering',
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
    title: 'Docking \u2014 Why Me, Why Now',
    proves:
      'You need someone who can own a brand\u2019s plan and its numbers on day one \u2014 I have been running that job across a portfolio, and I want the seat.',
    bullets: [
      'Manager-level scope already: strategy and investment across a $75M+ portfolio, an operating model I authored, and talent I developed into named account ownership',
      'Week one: map every live campaign to its measurement, sit with the compliance reviewers, and ship one improvement to the brand playbook',
      'Chicago \u00b7 cam.carp14@gmail.com \u00b7 linkedin.com/in/CameronCarpenter1 \u2014 the PDF above has the rest',
    ],
    artifact: {
      kind: 'link',
      href: 'mailto:cam.carp14@gmail.com',
      label: 'Start the conversation',
    },
  },
];
