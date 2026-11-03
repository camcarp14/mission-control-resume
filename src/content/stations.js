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
  role: 'SOLUTIONS CONSULTANT \u00b7 APPLIED AI',
  status: 'ALL SYSTEMS GO',
  callsign: 'CC-01',
};

/** @type {Station[]} */
export const stations = [
  // -- STN 01 · LIFTOFF ---------------------------------------------------
  // The call-qualification skills run for one client; the 5-analyst / 10+
  // account rollout was the reporting, pacing and forecasting automations
  // (owner correction, Oct 2026) — keep the two apart in every line.
  // The thesis, re-aligned (Nov 2026) to the résumé's summary: a client-facing
  // consultant who leads discovery, then builds and deploys the technical solution. ~1,000
  // calls, 5 analysts, 10+ accounts, nine accounts, seven business units, 12+
  // stakeholders, the Fortune 5 payer, 20 accounts and $75M+ are all on the
  // résumé. The 20 accounts (owner, Nov 2026) and $75M+ are career-to-date, so
  // don't tie them to the nine current accounts.
  {
    id: 'liftoff',
    code: 'STN 01',
    title: 'Liftoff',
    proves:
      'A client-facing consultant who leads discovery, answers objections, then builds and deploys the technical solution, across 20 accounts and $75M+ in media since 2023.',
    bullets: [
      'Channel lead and day-to-day client contact for nine accounts, including seven healthcare business units under a Fortune 5 payer, presenting weekly to 12+ client stakeholders',
      'Built production conversation-intelligence workflows: Claude skills that categorize ~1,000 calls a week for one client, backed by golden datasets, LLM-as-judge scoring, and human review',
      'Deployed AI automations to 5 analysts across 10+ accounts, saving 300+ hours a quarter',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 02 · FLIGHT PLAN -----------------------------------------------
  // Progression, not a job-hop reel: scope outpacing the title. Nine
  // accounts, 12+, 175%, AEP and $63B are on the résumé. Zero To Secure's
  // live site is attached from work.js (stationId 'flight-plan'), not here.
  {
    id: 'flight-plan',
    code: 'STN 02',
    title: 'Flight Plan',
    proves:
      'Scope that’s outpaced the title since 2023 — channel lead across 20 accounts, an AI leader on the team, and a company of my own on the side.',
    bullets: [
      'Ovative Group — Analyst, then Senior Analyst, SEM (2023–present, promoted 2025): channel lead for nine accounts, presenting weekly to 12+ client stakeholders, with results like a 175% year-over-year lift in Medicare enrollments during AEP, and building the AI tools the team uses',
      'Zero To Secure — Founder (2025–present): a bootstrapped DTC brand run solo (Shopify build, SEO, and go-to-market), with AI agents for organic growth and creator outreach',
      'AbbVie — Strategic Initiatives Analyst (2022–23): reporting that gave leadership of the $63B Allergan integration visibility into workstream status and risk',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 03 · THE BRIDGE -------------------------------------------------
  // The client-leadership station, moved up (Nov 2026) so the flight follows
  // the résumé: client work first, then the AI systems. Strategy and roadmaps,
  // weekly stakeholders, QBRs, discovery, objections, incremental budget, the
  // provider launch, and the tracking and beta work are all on the résumé.
  {
    id: 'the-bridge',
    code: 'STN 03',
    title: 'The Bridge',
    proves:
      'The client relationship is the job: discovery on new accounts, weekly time with 12+ stakeholders, and data-backed pushback when a request would trade lead quality for a prettier metric.',
    bullets: [
      'Set client roadmaps, walked clients through strategy and test proposals to win buy-in, then ran execution, delegating across analysts and owning the outcomes, including the SEM launch for a new healthcare provider, from strategy through build QA and reporting on qualified calls and appointments',
      'Led new-account discovery, ran quarterly business reviews and lunch-and-learns that build program buy-in, handled objections with data-backed rebuttals, and pitched incremental budget to decision-makers',
      'Set up Invoca for clients with its reps, added spoken-phrase tracking, and piloted Google betas alongside Google and Microsoft reps',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 04 · CLIENT RESULTS ------------------------------------------
  // Was "Integration", then "Call Intelligence" (id kept — ids never change).
  // Renamed for any solutions role, to match the résumé. 175%, $5M, $35M and the
  // forecast line are the résumé's AEP bullet; the forecast was a different
  // AEP from the 175% year, so never join them. Value-Based Bidding and the
  // CMS-approved copy are its bidding bullet (the KPI detail is from the
  // master résumé).
  {
    id: 'integration',
    code: 'STN 04',
    title: 'Client Results',
    proves:
      'A 175% enrollment lift that earned $5M in incremental investment, and healthcare programs moved from raw call volume to qualified outcomes.',
    bullets: [
      'Drove a 175% year-over-year enrollment increase for a national Medicare marketplace during the Annual Enrollment Period (AEP). Results earned $5M in incremental investment, bringing AEP spend to $35M. Owned the full forecast and budget plan in other AEPs',
      'Designed Value-Based Bidding around Invoca call-quality and spoken-phrase signals, moving healthcare programs from raw call volume to qualified outcomes with revenue-tied KPIs for non-technical client leaders',
      'Kept AEP campaigns compliant with CMS-approved copy',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 05 · THE TURNAROUND ---------------------------------------------
  // The retail story, copy unchanged. A past account (owner, Nov 2026), so keep
  // it in the past tense; the nine current accounts are seven healthcare
  // business units and two logistics accounts. 5% revenue, 20% ROAS and 13% spend are
  // the résumé's retail bullet; the 33% CPC drop is owner-confirmed and
  // predates the repositioning.
  {
    id: 'the-close',
    code: 'STN 05',
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

  // -- STN 06 · THE AGENT --------------------------------------------------
  // New (Oct 2026). ~1,000 calls a week and 45 -> 5 minutes are the résumé's
  // call-skill bullet. The bullets follow the owner's account (Nov 2026):
  // Invoca spoken phrase, its exports and tracking data, paired with Google
  // and Microsoft Ads data over MCP. The call analytics MCP server project
  // shows here (work.js) but is personal work, not a rebuild of this; the
  // demo video stays planned.
  {
    id: 'call-agent',
    code: 'STN 06',
    title: 'The Agent',
    proves:
      'Replaced manual call categorization for one client with Claude skills, cutting each run from 45 minutes to 5 across about 1,000 calls a week.',
    bullets: [
      'Set up Invoca spoken-phrase tracking, then built Claude skills that pair its exports and tracking data with Google Ads and Microsoft Ads data through MCP connectors, inside a locked-down enterprise stack with no API access',
      'Categorize about 1,000 calls a week and tie qualified calls to the paid campaigns behind them, work that was manual and slow because Invoca data wasn’t 1:1 clean',
      'Draft near client-ready insights from the results, cutting each run from 45 minutes to 5 and freeing analyst time for deeper optimization',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 07 · EVALS & GUARDRAILS -----------------------------------------
  // New (Oct 2026). No figures. The evaluation layer is the résumé's evals
  // bullet; the human checkpoint is its "human approval step" (Ovative evals
  // bullet and the Zero To Secure line). The ZTS Operations screenshot —
  // those agents, run on demo data — is attached from work.js, and the
  // Medicare evaluation pipeline project shows here with its dates.
  {
    id: 'evals',
    code: 'STN 07',
    title: 'Evals & Guardrails',
    proves:
      'Every skill version is tested against golden datasets before it touches client work, and any agent that takes action needs human approval.',
    bullets: [
      'Built an evaluation layer of golden datasets, grading rubrics, and LLM-as-judge scoring that tests each skill version and catches errors before client delivery',
      'Design approval into agents that act: the creator-outreach agent drafts but never sends without sign-off, and the organic-growth agent is checked for tone and action correctness before anything ships',
      'Client and health data stay inside approved tools and public work uses synthetic data — a degree in risk management and integration-risk reporting at AbbVie shape how I build',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 · PIPELINE ---------------------------------------------------
  // Absorbs the retired Diagnostics station (id firefight): its catches are
  // now the "checks that catch broken tracking" clause. 5 analysts, 10+
  // accounts, 300+ hours and hours -> ~30 minutes are on the résumé; up to
  // 50% is owner-confirmed, predates the repositioning, and is on the master
  // résumé. The workflow builder stays unnamed, by owner rule.
  {
    id: 'pipeline',
    code: 'STN 08',
    title: 'Pipeline',
    proves:
      'Reporting, pacing, and forecasting automations rolled out to 5 analysts across 10+ accounts, saving 300+ hours a quarter.',
    bullets: [
      'Led the rollout of AI automations for reporting, pacing, and forecasting to 5 analysts across 10+ accounts, saving 300+ hours a quarter, with checks that catch broken tracking before clients see it',
      'Built a visual workflow tool that turns flowcharts into reusable Claude skills and stores the account context agents read from, cutting skill build time from hours to about 30 minutes',
      'Account diagnostic agents built on it cut the time spent diagnosing performance shifts by up to 50%',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 · ENABLEMENT -------------------------------------------------
  // AI adoption as a people problem. The insight tool (a direct report and
  // three analysts, weekly use, review time down 50%) and the 13-week
  // curriculum are the résumé's coaching bullet (owner-stated, Oct 2026); the
  // team guides and the junior analyst's first Claude tool and its
  // forecasting inputs are owner detail (master résumé). No formal AI
  // trainings are claimed: he shares what he learns with the team, he did
  // not author trainings (owner correction, Oct 2026). Team shape (owner,
  // Nov 2026): the direct report is the former intern, now an analyst; the
  // three other analysts are coached and partnered with on accounts.
  {
    id: 'force-multiplier',
    code: 'STN 09',
    title: 'Enablement',
    proves:
      'AI adoption is a people problem, so I build for it: a tool that critiques my analysts’ reasoning, a junior analyst who now builds with AI on his own, and what I learn shared with the wider team.',
    bullets: [
      'Built Claude review tools that critique my analysts’ draft reasoning and push them to explain the why behind the numbers, using account data pulled through MCP connectors; used weekly, they cut my review time 50%',
      'Partnered with a junior analyst to build his first Claude tool, which streamlined daily budget forecasting from historical trends, tactic efficiency, channel mix, and seasonality; he now uses AI in his daily work',
      'Turned a summer intern into a full-time analyst and direct report with a self-authored 13-week curriculum that earned a return offer, coach three more analysts on shared accounts with ongoing feedback and guidance, and write the team’s guides on running analyses and building reports',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 10 · FOUNDATIONS ------------------------------------------------
  // Absorbs the retired The Stack station (id the-stack). Degree, client skills
  // and tool list match the résumé's Education and Skills. No invented certs.
  // Python, SQL and webhooks/APIs are on by the owner's call (Oct 2026): he
  // is comfortable being tested on them.
  {
    id: 'certs-instruments',
    code: 'STN 10',
    title: 'Foundations',
    proves:
      'The toolkit behind the work: a business degree with a risk-management core, the client skills and platforms I use daily, and the AI and web stack I build with.',
    bullets: [
      'University of Wisconsin–Madison — BBA, double major in Marketing and Risk Management & Insurance (2023)',
      'Client: discovery · objection handling · QBRs · roadmap execution · project management · client enablement. Platforms: Google Ads · Microsoft Advertising · SA360 · GA4 · Adobe Analytics · Google Tag Manager · Offline Conversion Imports · Looker Studio · BigQuery · Tableau · Invoca · Shopify',
      'AI & build: Claude (Enterprise, Code) · agent skills · MCP · evals (golden datasets, LLM-as-judge) · RAG · human-in-the-loop design · Python · SQL · JavaScript · React · Supabase · Netlify · Git and GitHub · webhooks and APIs',
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
