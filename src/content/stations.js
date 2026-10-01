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
 *   - Every figure must agree with public/resume.pdf, the source of truth.
 *     A figure that is not in the résumé may stay only if it was already
 *     here before the Applied AI repositioning (owner-confirmed), and each
 *     station's comment says where its numbers come from.
 *   - No client names anywhere — not in copy, not in comments. Describe them
 *     ("a Fortune 5 healthcare payer", "a national Medicare marketplace",
 *     "a national retail brand"); `npm run ready` scans for known names.
 *   - Retired ids (never reuse): the-stack (merged into Foundations),
 *     firefight (merged into Pipeline).
 *
 * The schema, in prose:
 *   id      — stable machine key, lowercase, never changes once shipped.
 *   code    — the eyebrow label on the station HUD, 'STN 01'..'STN 11'.
 *   title   — the role, project, or artifact name. Short; it is a headline.
 *   proves  — ONE sentence stating the takeaway a hiring manager should
 *             leave with. Not a description of the thing — the conclusion.
 *   bullets — 2 to 3 outcome bullets, each led by a metric where possible.
 *   artifact — what backs the claim, when the station has its own (the
 *              Docking contact link). Work artifacts do NOT go here: a live
 *              item in src/content/work.js with `stationId` set to a station's
 *              id puts its button (or screenshot) on that station
 *              automatically, and an in-progress one shows only a chip —
 *              one place to update, never two.
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
 *  @property {string} [caption] optional line under an image (e.g. 'demo data')
 *  @property {string} [noun] what the evidence control promises ('a screenshot')
 */

/** @typedef {Object} Station
 *  @property {string} id       stable key — never reuse or reorder-depend
 *  @property {string} code     eyebrow label, e.g. 'STN 04'
 *  @property {string} title    single station name (one word or short phrase)
 *  @property {string} proves   ONE sentence: the takeaway, not the description
 *  @property {string[]} bullets 2–3 outcome bullets, metric-led
 *  @property {StationArtifact} artifact
 *  @property {string} [overview] disclosure-section label; defaults to
 *                                'Overview' (Docking overrides it to 'Contact')
 */

/** The pilot identity shown on the hero — same single-source rule as the stations. */
export const pilot = {
  // Two words on purpose: Hero.tsx stacks each word of the name on its own
  // line, so the full name holds the same width the short handle used to.
  name: 'CAMERON CARPENTER',
  role: 'APPLIED AI \u00b7 PERFORMANCE MARKETING',
  status: 'ALL SYSTEMS GO',
  callsign: 'CC-01',
};

/** @type {Station[]} */
export const stations = [
  // -- STN 01 · LIFTOFF ---------------------------------------------------
  // The thesis, repositioned (Oct 2026) from client leadership to applied AI:
  // the AI work is the lead and the media ownership is why it matters. $75M+,
  // the seven business units and the Fortune 5 payer are all on the résumé
  // (summary + first Ovative bullet). The no-API detail is the résumé's
  // "locked-down enterprise stack" bullet.
  {
    id: 'liftoff',
    code: 'STN 01',
    title: 'Liftoff',
    proves:
      'An applied AI builder with a performance marketer’s sense of the business — $75M+ in media managed since 2023, and AI systems I designed, measured, and got a team using, built inside locked-down enterprise tools.',
    bullets: [
      'Managed $75M+ in media investment since 2023 across healthcare, retail, and logistics as channel lead with manager-level ownership, including seven business units under a Fortune 5 healthcare payer',
      'Design, evaluate, and ship Claude skills and agents that turn raw call and campaign data into client-ready decisions, built on connectors and scheduled exports with no API access',
      'Hands-on Invoca practitioner: call-quality signals drive the bidding, and AI on the call data shows which campaigns produce qualified prospects',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 02 · FLIGHT PLAN -----------------------------------------------
  // Progression, not a job-hop reel: scope outpacing the title. 12+, 175%,
  // AEP and $63B are on the résumé. Zero To Secure's live site is attached
  // from work.js (stationId 'flight-plan'), not here.
  {
    id: 'flight-plan',
    code: 'STN 02',
    title: 'Flight Plan',
    proves:
      'Scope that’s outpaced the title since 2023 — channel lead on enterprise accounts, the team’s go-to on AI, and a company of my own on the side.',
    bullets: [
      'Ovative Group — Senior Analyst, SEM (2023–present): channel lead across a $75M+ portfolio, presenting weekly to 12+ client stakeholders, with results like a 175% year-over-year lift in Medicare enrollments during AEP, and building the AI tools the team uses',
      'Zero To Secure — Founder (2025–present): a bootstrapped DTC brand run solo (Shopify build, SEO, and go-to-market), with AI agents for organic growth and creator outreach',
      'AbbVie — Strategic Initiatives Analyst (2022–23): reporting that gave leadership of the $63B Allergan integration visibility into workstream status and risk',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 03 · CALL INTELLIGENCE ------------------------------------------
  // Was "Integration" (id kept — ids never change). The buyer's side of the
  // problem call-intelligence companies solve. 175%, $5M and $30M+ are the
  // résumé's AEP bullet; the architecture and KPI lines are its Invoca bullet.
  {
    id: 'integration',
    code: 'STN 03',
    title: 'Call Intelligence',
    proves:
      'Healthcare programs moved from raw call volume to qualified outcomes — conversion architecture and Value-Based Bidding built on Invoca call-quality signals, translated into KPIs client leadership acts on.',
    bullets: [
      'Designed conversion-action architecture and Value-Based Bidding around Invoca call-quality and spoken-phrase signals, so campaigns optimize toward qualified prospects rather than raw call volume',
      'Drove a 175% year-over-year increase in enrollments for a national Medicare marketplace during AEP, earning $5M in incremental client investment on $30M+ in AEP spend',
      'Translated the design into revenue-tied KPI hierarchies that non-technical client leadership can act on',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 04 · THE AGENT --------------------------------------------------
  // New (Oct 2026). ~1,000 calls a week and 45 -> 5 minutes are the résumé's
  // call-skill bullet. Planned work items (Invoca MCP server, demo video)
  // attach here via work.js when they go live.
  {
    id: 'call-agent',
    code: 'STN 04',
    title: 'The Agent',
    proves:
      'AI that reads the calls so analysts don’t have to — Claude skills that qualify about 1,000 Invoca calls a week and tie them to the campaigns behind them, cutting each run from 45 minutes to 5.',
    bullets: [
      'Qualify about 1,000 Invoca call records a week, segment them, and tie qualified calls to the specific paid campaigns that drove them',
      'Draft near client-ready insights from the results, cutting each run from 45 minutes to 5 and freeing analyst time for deeper optimization',
      'Built inside a locked-down enterprise stack with no API access, using MCP connectors and scheduled exports',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 05 · EVALS & GUARDRAILS -----------------------------------------
  // New (Oct 2026). No figures. The evaluation layer is the résumé's evals
  // bullet; the human checkpoint is its "human approval step" (Ovative evals
  // bullet and the Zero To Secure line). The ZTS Operations screenshot —
  // those agents, run on demo data — is attached from work.js.
  {
    id: 'evals',
    code: 'STN 05',
    title: 'Evals & Guardrails',
    proves:
      'Measured, not assumed — every skill version is tested against golden datasets before it touches client work, and agents that act have a human checkpoint.',
    bullets: [
      'Built an evaluation layer of golden datasets, grading rubrics, and LLM-as-judge scoring that tests each skill version and catches errors before client delivery',
      'Design approval into agents that act: the creator-outreach agent drafts but never sends without sign-off, and the organic-growth agent is checked for tone and action correctness before anything ships',
      'Client and health data stay inside approved tools and public work uses synthetic data — a degree in risk management and integration-risk reporting at AbbVie shape how I build',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 06 · PIPELINE ---------------------------------------------------
  // Absorbs the retired Diagnostics station (id firefight): its catches are
  // now the "checks that catch broken tracking" clause. 5 analysts, 10
  // accounts, 300+ hours, hours -> ~30 minutes and up to 50% are all on the
  // résumé. The workflow builder stays unnamed, by owner rule.
  {
    id: 'pipeline',
    code: 'STN 06',
    title: 'Pipeline',
    proves:
      'Systems that compound — reporting, pacing, and forecasting built with AI tooling, used by five analysts across ten client accounts and returning 300+ hours a quarter.',
    bullets: [
      'Automated reporting, pacing, and forecasting systems used by 5 analysts across 10 client accounts, saving 300+ hours per quarter, with checks that catch broken tracking before clients see it',
      'Built a visual workflow builder that turns flowcharts into reusable Claude skills and stores the account context agents read from, cutting skill build time from hours to about 30 minutes',
      'Account diagnostic agents built on it cut the time spent diagnosing performance shifts by up to 50%',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 07 · ENABLEMENT -------------------------------------------------
  // AI adoption as a people problem. Two analysts, the junior analyst's first
  // Claude tool, the 13-week curriculum and the AI trainings are the résumé's
  // coaching bullet; the forecasting inputs are owner detail from the brief.
  {
    id: 'force-multiplier',
    code: 'STN 07',
    title: 'Enablement',
    proves:
      'AI adoption is a people problem, so I teach it — the team’s AI trainings, two analysts coached, and a junior analyst who now builds with AI on his own.',
    bullets: [
      'Partnered with a junior analyst to build his first Claude tool, which streamlined daily budget forecasting from historical trends, tactic efficiency, channel mix, and seasonality; he now uses AI in his daily work',
      'Coach and lead two analysts on the healthcare accounts, and author the team’s AI trainings, best practices, and playbooks',
      'Directly managed a summer intern through a self-authored 13-week curriculum that led to a return offer',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 · THE BRIDGE -------------------------------------------------
  // The client-leadership station, copy unchanged in the repositioning. Seven
  // business units and 12+ stakeholders are on the résumé; the launch is the
  // SEM workstream for a new healthcare provider program (anonymized, as on
  // the résumé).
  {
    id: 'the-bridge',
    code: 'STN 08',
    title: 'The Bridge',
    proves:
      'The client relationship is the job — weekly in front of 12+ stakeholders across seven healthcare business units, running the reviews, the partner syncs, and the launches, and pushing back when a request would trade lead quality for a prettier metric.',
    bullets: [
      'Present weekly to 12+ client stakeholders across a Fortune 5 payer’s healthcare portfolio; run quarterly business reviews and strategic roadmaps, and lead syncs with Google, Microsoft, and Invoca partner teams',
      'Led the SEM workstream for a new healthcare provider program from planning through launch — strategy, campaign structure, conversion and bidding approach, build QA, and reporting tied to qualified calls and appointments',
      'Onboarded new retail and healthcare clients and rebuilt alignment on a multi-brand portfolio by educating stakeholders on business-impact measurement and providing informed pushback when a request conflicted with best practice',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 · THE TURNAROUND ---------------------------------------------
  // The retail story, copy unchanged. 5% revenue, 20% ROAS and 13% spend are
  // the résumé's retail bullet; the 33% CPC drop is owner-confirmed and
  // predates the repositioning.
  {
    id: 'the-close',
    code: 'STN 09',
    title: 'The Turnaround',
    proves:
      'Grew a national retail brand’s revenue 5% and its return on ad spend 20% while reducing spend 13% year over year — more revenue and better efficiency on less budget.',
    bullets: [
      'Reduced brand cost-per-click progressively through bid-portfolio management rather than cutting reach — efficiency recovered while volume held',
      'Rebuilt the non-brand program in parallel, nearly doubling its return on ad spend as cost-per-click fell 33%',
      'Redirected the freed budget into higher-incrementality tactics, then led the account’s migration off SA360 to native platform bidding without performance disruption',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 10 · FOUNDATIONS ------------------------------------------------
  // Absorbs the retired The Stack station (id the-stack). Degree and tool list
  // match the résumé's Education and Skills sections. No invented certs.
  {
    id: 'certs-instruments',
    code: 'STN 10',
    title: 'Foundations',
    proves:
      'The toolkit behind the work — a business degree with a risk-management core, the ad and analytics stack I use daily, and the AI stack I build with.',
    bullets: [
      'University of Wisconsin–Madison — BBA, double major in Marketing and Risk Management & Insurance (2023)',
      'Platforms: Google Ads · Microsoft Advertising · SA360 · GA4 · Adobe Analytics · Invoca · Tableau · Shopify · Excel',
      'AI & agents: Claude (Enterprise, Code) · agent skills · MCP · evals (golden datasets, rubrics, LLM-as-judge) · human-in-the-loop design · prompt and context engineering · workflow automation',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 11 · DOCKING ----------------------------------------------------
  // The close — a landing, not a pitch. The disclosure is a CONTACT block
  // (overview: 'Contact'); its "bullets" are ways to reach him. The mailto is
  // the primary button and the plain address is there too, so a dead mail
  // client is never the only route. /work is the proof-of-work page.
  {
    id: 'docking',
    code: 'STN 11',
    title: 'Docking',
    overview: 'Contact',
    proves:
      'Thanks for coming along on the whole flight — if anything here sparked a thought, I’d love to hear from you!',
    bullets: [
      'Email — cam.carp14@gmail.com',
      'LinkedIn — linkedin.com/in/cameroncarpenter1',
      'Based in Chicago · proof of work at camcarp.com/work · the full résumé is one click away in the top bar',
    ],
    artifact: {
      kind: 'link',
      href: 'mailto:cam.carp14@gmail.com',
      label: 'Start the conversation',
    },
  },
];
