// @ts-check
/* ==== WORK — the proof of work, in one file ===============================
 *
 * Everything the site shows as evidence of building lives in this array,
 * and three surfaces read it, so there is never a second place to update:
 *
 *   - /work, the public proof-of-work page: every `live` item with its links,
 *     then every `in-progress` item with an "In progress" chip and no links.
 *   - the home page's Artifacts ring: every `live` item that has an `image`.
 *   - the flight: a `live` item with `stationId` puts its artifact on that
 *     station (a link button, or its screenshot when it is private); an
 *     `in-progress` item with `stationId` shows only a chip there.
 *
 * `planned` items never render anywhere. They are here so the plan lives next
 * to the thing it becomes: flip `status` to 'in-progress' while you build,
 * then to 'live' with real links, and every surface updates itself.
 *
 * The schema:
 *   id        — stable key, lowercase-and-dashes, unique. Never reuse one.
 *   title     — the item's name. Short; it is a headline.
 *   pillars   — any of Build, Measure, Govern, Enable, Persuade.
 *   summary   — three sentences at most. Shown on /work and as the ring's
 *               caption (clamped to two lines in the small ring).
 *   keyNumber — optional, the one figure worth leading with ('45 → 5 min').
 *               Must agree with public/resume.pdf like every other figure.
 *   links     — [{ label, href }]. A `live` item needs at least one real link
 *               unless it is `private`; an `in-progress` item must have none.
 *   status    — 'live' | 'in-progress' | 'planned'.
 *   stationId — optional id from src/content/stations.js. At most one live
 *               item per station (a station has one artifact slot).
 *   updated   — 'YYYY-MM', when this entry last changed. Never displayed.
 *   private   — optional; true for a live build that is shown but not linked
 *               (behind a sign-in nobody else can pass). Its window says
 *               "private" and the ready check does not ask it for a link.
 *
 * Presentation, for items that appear in the Artifacts ring or the flight:
 *   image     — screenshot under public/artifacts/, 16:10 (960×600 is plenty).
 *   tags      — 1–3 short stack labels.
 *   details   — 2–4 { label, text } rows for the ring's expanded view; labels
 *               16 characters at most.
 *   demo      — true when the screenshot shows invented sample data. Every
 *               surface then says "Demo data".
 *
 * Honesty rule: describe only what exists. Anything still being built is
 * `in-progress` (chip, no links) or `planned` (invisible) — never a live item
 * with a placeholder link. src/content/work.test.ts and `npm run ready` both
 * enforce it.
 * ========================================================================= */

/** @typedef {'Build'|'Measure'|'Govern'|'Enable'|'Persuade'} Pillar */
/** @typedef {'live'|'in-progress'|'planned'} WorkStatus */

/** @typedef {Object} WorkItem
 *  @property {string} id
 *  @property {string} title
 *  @property {Pillar[]} pillars
 *  @property {string} summary
 *  @property {string} [keyNumber]
 *  @property {{ label: string, href: string }[]} links
 *  @property {WorkStatus} status
 *  @property {string} [stationId]
 *  @property {string} updated
 *  @property {boolean} [private]
 *  @property {string} [image]
 *  @property {string[]} [tags]
 *  @property {{ label: string, text: string }[]} [details]
 *  @property {boolean} [demo]
 */

/** @type {WorkItem[]} */
export const work = [
  // -- LIVE -------------------------------------------------------------------

  // The DTC brand: STN 02's Founder line, shown rather than told. The
  // screenshot is the live homepage hero (1280x800, saved at 960x600).
  {
    id: 'zero-to-secure',
    title: 'Zero To Secure',
    pillars: ['Build', 'Persuade'],
    summary:
      'A bootstrapped DTC brand I run solo, with AI agents for organic growth (checked by evals before anything ships) and creator sourcing (nothing sends without my approval).',
    links: [{ label: 'zerotosecure.com', href: 'https://zerotosecure.com/' }],
    status: 'live',
    stationId: 'flight-plan',
    updated: '2026-09',
    image: '/artifacts/zero-to-secure.jpg',
    tags: ['Shopify', 'DTC', 'AI agents'],
    details: [
      { label: 'The brand', text: 'A bootstrapped direct-to-consumer business I run on the side, selling a stainless-steel seed phrase kit to people who hold their own crypto.' },
      { label: 'The build', text: 'Shopify storefront, positioning, and product copy — a technical, high-stakes task explained in calm, plain language.' },
      { label: 'Growth', text: 'An organic-growth agent that writes for search under evals, and a creator-sourcing agent that drafts outreach for my sign-off — both behind a human approval step.' },
    ],
  },

  // The agents behind Zero To Secure, attached to STN 05 (Evals &
  // Guardrails) because the screenshot IS the approval queue. It is the ZTS
  // module of The Pentagon, run locally from its public repo against a fake
  // backend — invented creators, Shorts, runs and AI calls, every request to
  // a real Supabase or model API blocked. Hence demo, and private.
  {
    id: 'zts-operations',
    title: 'ZTS Operations',
    pillars: ['Build', 'Govern'],
    summary:
      'Zero To Secure’s operations module: the creator-outreach and organic-growth agents, with an approval queue between every draft and anything that ships.',
    links: [],
    status: 'live',
    private: true,
    stationId: 'evals',
    updated: '2026-09',
    image: '/artifacts/zts-operations.jpg',
    tags: ['Claude', 'Supabase', 'Shopify'],
    demo: true,
    details: [
      { label: 'What it is', text: 'Zero To Secure’s operations module inside The Pentagon, a private hub that runs several of my tools behind one sign-in.' },
      { label: 'Pipelines', text: 'YouTube creators scored by audience fit with Claude-drafted collab pitches, and a Shorts studio where Claude writes the full production package.' },
      { label: 'Guardrails', text: 'Drafts wait in an approval queue: articles go to the Shopify blog and pitches go out only after I sign off.' },
      { label: 'Observability', text: 'Every AI call logged with tokens, cost, and latency. The window shows demo data, not the live accounts.' },
    ],
  },

  // The daily command center. Owner's screenshot (live Brief, 2026-09-30),
  // cropped past the browser chrome and the sidebar (which carries his
  // email), with calendar entries, notes and other people's names blurred.
  // Off the flight on purpose: one line of proof for an AI-enablement
  // recruiter, not a station.
  {
    id: 'board-room',
    title: 'Board Room',
    pillars: ['Build'],
    summary:
      'My daily command center — markets, finances, ventures, training, and a board of advisor seats, each a Claude persona.',
    links: [],
    status: 'live',
    private: true,
    updated: '2026-09',
    image: '/artifacts/board-room.jpg',
    tags: ['React', 'Supabase', 'Claude'],
    details: [
      { label: 'Daily brief', text: 'The app I open every morning — calendar, notes, markets, the week’s economic releases, crypto news, and ZTS search traffic on one screen.' },
      { label: 'Rooms', text: 'Finances, markets, training, guitar practice, and groceries, plus a board of advisor seats — each a Claude persona grounded in context I keep current.' },
      { label: 'Under the hood', text: 'Mobile-first for iPhone, on React and Supabase with two-factor sign-in. Personal details in the window are blurred.' },
    ],
  },

  // The Chicago River game. Craft, not a pitch — off the flight.
  {
    id: 'river-racer',
    title: 'River Racer',
    pillars: ['Build'],
    summary:
      'A 3D boat race down the real Chicago River — ghost time trials, an architecture tour, and multiplayer.',
    links: [{ label: 'river-racer.netlify.app', href: 'https://river-racer.netlify.app/' }],
    status: 'live',
    updated: '2026-09',
    image: '/artifacts/river-racer.jpg',
    tags: ['three.js', 'Game', 'Multiplayer'],
    details: [
      { label: 'The game', text: 'A browser racing game on the real course of the Chicago River, under its bridges and out to Lake Michigan.' },
      { label: 'Modes', text: 'Single race, championship, time trials against your own recorded ghost, an architecture tour, and live multiplayer.' },
      { label: 'Under the hood', text: 'Plain three.js, no game engine — custom water and reflections, boat physics, AI racers, power-ups, touch controls, and peer-to-peer multiplayer with no server.' },
    ],
  },

  // This site. Listed on /work only (no screenshot, so not in the ring; a
  // ring window pointing at the page you are on reads as a mirror). Add a
  // repo link only once the owner confirms the repo is public with clean
  // history.
  {
    id: 'mission-control',
    title: 'Mission Control',
    pillars: ['Build', 'Persuade'],
    summary:
      'This site: a résumé you pilot through a 3D solar system, built with React, three.js and Supabase. Visits are logged through a deny-all row-level-security gate, and every release runs an end-to-end, accessibility and Lighthouse suite.',
    links: [{ label: 'camcarp.com', href: 'https://camcarp.com/' }],
    status: 'live',
    updated: '2026-09',
  },

  // -- PLANNED (never rendered; flip status to go live) -----------------------

  {
    id: 'invoca-mcp',
    title: 'Invoca MCP server',
    pillars: ['Build'],
    summary: 'An MCP server that gives Claude governed, read-only access to Invoca call data.',
    links: [],
    status: 'planned',
    stationId: 'call-agent',
    updated: '2026-09',
  },
  {
    id: 'call-agent-demo',
    title: 'Problem-led demo video',
    pillars: ['Persuade'],
    summary: 'A short walkthrough that starts from the analyst’s problem and shows the call agent solving it on synthetic data.',
    links: [],
    status: 'planned',
    stationId: 'call-agent',
    updated: '2026-09',
  },
  {
    id: 'eval-pilot-readout',
    title: 'Evaluation pilot readout',
    pillars: ['Measure'],
    summary: 'How the skill evaluations are built and scored, written up on synthetic data.',
    links: [],
    status: 'planned',
    stationId: 'evals',
    updated: '2026-09',
  },
  {
    id: 'ai-trust-package',
    title: 'AI trust package and usage guideline',
    pillars: ['Govern'],
    summary: 'The risk and usage material a healthcare customer needs to approve an AI workflow.',
    links: [],
    status: 'planned',
    stationId: 'evals',
    updated: '2026-09',
  },
  {
    id: 'ai-enablement-playbook',
    title: 'AI enablement playbook',
    pillars: ['Enable'],
    summary: 'The trainings and patterns that got a marketing team building with AI, made reusable.',
    links: [],
    status: 'planned',
    stationId: 'force-multiplier',
    updated: '2026-09',
  },
  {
    id: 'call-measurement-essay',
    title: 'Call-measurement essay',
    pillars: ['Persuade'],
    summary: 'What several enrollment seasons on the buyer’s side taught me about measuring calls.',
    links: [],
    status: 'planned',
    updated: '2026-09',
  },
];
