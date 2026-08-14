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
  role: 'REVENUE OPERATIONS \u00b7 PERFORMANCE MARKETING',
  status: 'ALL SYSTEMS GO',
  callsign: 'CC-01',
};

/** @type {Station[]} */
export const stations = [
  // -- STN 01 \u00b7 LIFTOFF ---------------------------------------------------
  // The thesis every later station proves. The $75M figure is the owner's
  // own calculation across his portfolios, stated the way he asked it to be
  // stated; the interview-safe unpacking is "channel lead on teams
  // overseeing $75M." Titles are single names now (owner's call): the panel
  // header and the 3D signage both show this one word/phrase.
  {
    id: 'liftoff',
    code: 'STN 01',
    title: 'Liftoff',
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
  // Progression, not a job-hop reel (owner's note): the proves leads with
  // compounding responsibility and does NOT open on the $63B deal size. The
  // Medicare figure is reframed as one campaign RESULT of the Ovative role,
  // not a standalone headline that reads like it was the whole job.
  {
    id: 'flight-plan',
    code: 'STN 02',
    title: 'Flight Plan',
    proves:
      'One role since 2023 with steadily more to own \u2014 alongside a company I founded on the side and an enterprise-integration role before it.',
    bullets: [
      'Ovative Group \u2014 Senior Analyst, SEM (2023\u2013present): own budget, pacing, and reporting across a $75M+ media-investment portfolio, with results like a 175% year-over-year lift in Medicare enrollments from restructured paid-search campaigns',
      'Zero To Secure \u2014 Founder (2025\u2013present): built and run a bootstrapped DTC e-commerce brand end to end on the side \u2014 positioning, custom Shopify build, SEO content, and go-to-market',
      'AbbVie \u2014 Strategic Initiatives Analyst (2022\u201323): supported the $63B Allergan integration inside a highly matrixed organization, administering a 2,400-user project platform',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 03 \u00b7 THE STACK -------------------------------------------------
  // Where he operates, told as the two halves of the seam \u2014 the
  // revenue-operations list and the media list, straight off the r\u00e9sum\u00e9\u2019s
  // skills taxonomy. No diagram: the copy is the map.
  {
    id: 'the-stack',
    code: 'STN 03',
    title: 'The Stack',
    proves:
      'I work across the full chain \u2014 ad platforms, call intelligence, analytics, and the reporting warehouse \u2014 with most of my time at the handoff between activation and measurement.',
    bullets: [
      'Hands-on daily across Google Ads, Microsoft Advertising, SA360, GA4, Adobe Analytics, and Invoca, together with the Apps Script automation that connects them',
      'The revenue-operations half: conversion tracking and attribution, reporting and workflow automation, forecasting and pacing, funnel and cohort analysis, and data integrity and QA',
      'The media half: media planning and investment, budget management, audience segmentation and targeting, experiment design, value-based bidding, and cross-channel strategy',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 04 \u00b7 INTEGRATION ------------------------------------------------
  // The technical-depth station. b2 was a too-niche pixel-cutover war story
  // (owner's note); it now reads as fast, clean execution under change. b3 is
  // reframed around owning experimentation end to end rather than a specific
  // test-gating mechanism.
  {
    id: 'integration',
    code: 'STN 04',
    title: 'Integration',
    proves:
      'Conversion tracking and bidding architectures designed to optimize toward lead quality rather than raw volume \u2014 then translated into business terms for client leadership.',
    bullets: [
      'Structured the signal architecture \u2014 call-quality conversion data, value-based bidding frameworks, and KPI hierarchies \u2014 tied to downstream pipeline and revenue rather than platform-reported volume',
      'Strong execution when conditions change fast \u2014 when a client\u2019s priorities or platforms shift on short notice, I re-plan quickly and deliver cleanly without losing measurement continuity',
      'Drive experimentation end to end \u2014 hypothesis, test design, and the measurement that decides whether a new format or automation scales or gets cut',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 05 \u00b7 PIPELINE --------------------------------------------------
  // The automation/reporting story. The 300+ hours is the OWNER'S TEAM only
  // (his note) \u2014 scoped that way here \u2014 with the spread to other teams framed
  // as adoption, not "the whole business runs on it". STN 06 builds ON this;
  // keep 05 about the machinery and 06 about the analysis layer.
  {
    id: 'pipeline',
    code: 'STN 05',
    title: 'Pipeline',
    proves:
      'Reporting, pacing, and forecasting systems built independently with AI tooling \u2014 cutting my team\u2019s quarterly reporting time by 300+ hours, with several models since adopted by other client teams.',
    bullets: [
      'Automated multi-source reporting across Google Ads, Microsoft Advertising, and internal sources \u2014 15+ KPIs consolidated into client-ready deliverables, with the time once spent assembling them redirected to analysis',
      'Pacing and forecasting models that started on my accounts and were picked up by other teams \u2014 spend tracked against plan with early risk flags that catch budget issues before month-end',
      'Data-integrity checks built into the systems themselves \u2014 a broken tag or an understated spend is stopped before it reaches a deliverable or a bidding model',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 06 \u00b7 THE DASHBOARD ----------------------------------------------
  // Builds ON STN 05 (owner's note): 05 is the reporting/automation machinery,
  // 06 is the ANALYSIS layer on top \u2014 dashboards that help teams read
  // performance and decide. Kept general, not over-specific; the reinvestment
  // is evidence, not the whole story. Diagram stays pulled (kind: 'none').
  {
    id: 'dashboard',
    code: 'STN 06',
    title: 'The Dashboard',
    proves:
      'Dashboards that turn scattered platform data into the single view a team actually makes decisions from \u2014 the analysis layer on top of the reporting.',
    bullets: [
      'Build dashboards that consolidate performance into one clear view, so client and internal teams spend their time interpreting results rather than assembling them',
      'Unified paid and organic search into a single full-funnel view and templatized it for reuse across accounts',
      'Focus each dashboard on the decisions it needs to support \u2014 where budget is working, where it isn\u2019t, and what to do next \u2014 so teams can act on it directly',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 07 \u00b7 THE TURNAROUND ---------------------------------------------
  // The retail story. Owner's note: LEAD with the efficiency and revenue
  // gains, then the spend cut (stronger order), and drop phrasing that leans
  // on context the reader doesn't have (no "week-over-week" against an unseen
  // baseline). Every figure is real; the framing is self-contained.
  {
    id: 'the-close',
    code: 'STN 07',
    title: 'The Turnaround',
    proves:
      'Grew a national retail brand\u2019s revenue 5% and its return on ad spend 20% while reducing spend 13% year over year \u2014 more revenue and better efficiency on less budget.',
    bullets: [
      'Reduced brand cost-per-click progressively through bid-portfolio management rather than cutting reach \u2014 efficiency recovered while volume held',
      'Rebuilt the non-brand program in parallel, nearly doubling its return on ad spend as cost-per-click fell 33%',
      'Redirected the freed budget into higher-incrementality tactics, turning an efficiency fix into portfolio-level growth',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 08 \u00b7 FIREFIGHT --------------------------------------------------
  // Reframed (owner's note) from a single Medicare incident to the ROUTINE:
  // he is the person who finds what's quietly broken in an account before it
  // does damage. Two concrete, self-driven catches carry it (non-brand
  // misclassification, ~$40K connector understatement) \u2014 no borrowed story.
  {
    id: 'firefight',
    code: 'STN 08',
    title: 'Firefight',
    proves:
      'A habit of finding what\u2019s quietly broken \u2014 anomalies, tracking gaps, and inconsistencies caught in routine account checks before they reach a client or skew a bidding model.',
    bullets: [
      'Routinely audit accounts for the failures that don\u2019t announce themselves \u2014 misfiring conversion tags, understated spend, feeds that break without erroring \u2014 and resolve them before they surface downstream',
      'Treat measurement as something to verify rather than assume \u2014 cross-checking conversion tracking, spend, and data feeds so the numbers a client sees are ones I trust',
      'Find issues in a routine pass instead of a fire drill \u2014 the kind that would otherwise surface as a bad report or a mis-steered bidding model, caught upstream',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 09 \u00b7 GROUND CREW --------------------------------------------------
  // The leader/coach station. Owner's note: the RACI callout is gone (not
  // impressive), and this reads as more of a leader than before \u2014 developing
  // analysts into owners, mentoring, and owning the team's standards.
  {
    id: 'force-multiplier',
    code: 'STN 09',
    title: 'Ground Crew',
    proves:
      'I put real time into the people around me \u2014 coaching junior analysts toward account ownership, mentoring new talent, and helping shape how the team approaches lead generation and AI.',
    bullets: [
      'Coached junior analysts across multiple accounts, several of whom have grown into named account ownership',
      'Mentored a summer intern end to end through a self-authored 13-week curriculum mapped to the firm\u2019s leadership competencies',
      'A go-to resource on lead generation and AI workflows within the team \u2014 authored the trainings, best practices, and playbooks the broader group uses',
    ],
    artifact: { kind: 'none' },
  },

  // -- STN 10 \u00b7 INSTRUMENTS ------------------------------------------------
  // Education and the toolkit. No invented certifications: the r\u00e9sum\u00e9
  // carries none, so this station carries the degree and the stack instead.
  {
    id: 'certs-instruments',
    code: 'STN 10',
    title: 'Instruments',
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
  // The close \u2014 a landing, not a pitch. The disclosure section is a CONTACT
  // block here (overview: 'Contact'), and its "bullets" are the ways to reach
  // him rather than achievements. The mailto stays as the primary button; the
  // plain-text address is there too, so a dead mail client is never the only
  // route.
  {
    id: 'docking',
    code: 'STN 11',
    title: 'Docking',
    overview: 'Contact',
    proves:
      'Thanks for coming along on the whole flight \u2014 if anything here sparked a thought, I\u2019d genuinely love to hear from you.',
    bullets: [
      'Email \u2014 cam.carp14@gmail.com',
      'LinkedIn \u2014 linkedin.com/in/CameronCarpenter1',
      'Based in Chicago \u00b7 the full r\u00e9sum\u00e9 is one click away in the top bar',
    ],
    artifact: {
      kind: 'link',
      href: 'mailto:cam.carp14@gmail.com',
      label: 'Start the conversation',
    },
  },
];
