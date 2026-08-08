#!/usr/bin/env node
/* ==== READY CHECK — "is this safe to send to a human?" ======================
 *
 * `npm run gate` proves the SOFTWARE is correct: tests, a11y, breakpoints,
 * bundle budget, gate security. It passes today, and it passed on the day a
 * four-lens audit found the site was shipping a résumé PDF whose visible text
 * reads "Your Name", a contact button pointing at you@example.com, and thirty
 * bullets of [BRACKETED] template copy. Every one of those is invisible to a
 * test suite that only ever asks whether the machinery works.
 *
 * So this is the other gate: the CONTENT one. It is deliberately NOT part of
 * `npm run gate` — it fails loudly right now, by design, and wiring it into
 * CI would only teach everyone to ignore a permanently-red check. Run it in
 * the sixty seconds before the link goes into a LinkedIn DM:
 *
 *     npm run ready
 *
 * Every failure below is something a hiring manager would see. Exit code is
 * 1 while any of them remain, 0 the moment the site is genuinely sendable.
 * ========================================================================= */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));

const results = [];
/** @param {string} name @param {string[]} problems @param {string} fix */
const check = (name, problems, fix) =>
  results.push({ name, problems, fix, ok: problems.length === 0 });

/* Bracketed template slots are the project's own convention for "unwritten"
 * (see the header of src/content/stations.js), which makes them mechanically
 * greppable — the whole reason the convention exists. */
const BRACKET = /\[[^\]\n]{1,60}\]/g;

// ---- 1. Station copy ------------------------------------------------------
{
  const src = read('src/content/stations.js');
  // Only the DATA half matters; the file's long header comment legitimately
  // discusses brackets, and JSDoc uses [optional] property syntax.
  const body = src.slice(src.indexOf('export const stations'));
  const hits = body.match(BRACKET) ?? [];
  const uniq = [...new Set(hits)];
  check(
    'Station copy has no unfilled [BRACKET] slots',
    hits.length
      ? [
          `${hits.length} placeholder slots across the stations ` +
            `(${uniq.length} distinct), e.g. ${uniq.slice(0, 6).join('  ')}`,
        ]
      : [],
    'Write real copy into src/content/stations.js. Where a figure is confidential, ' +
      'use a defensible band ("eight-figure ARR portfolio") rather than deleting the ' +
      'metric — but never ship the bracket.',
  );
}

// ---- 2. Contact + artifact links -----------------------------------------
{
  const src = read('src/content/stations.js');
  const problems = [];
  const bad = [...src.matchAll(/https?:\/\/[^\s'"]*example\.com[^\s'"]*/g)].map((m) => m[0]);
  const mail = [...src.matchAll(/mailto:[^\s'"]+/g)]
    .map((m) => m[0])
    .filter((m) => /example\.com|your|you@/i.test(m));
  if (bad.length) problems.push(`placeholder links: ${[...new Set(bad)].join(', ')}`);
  if (mail.length) problems.push(`placeholder contact: ${[...new Set(mail)].join(', ')}`);
  check(
    'Every link and the contact CTA resolve somewhere real',
    problems,
    'The close (STN 11) is the one link on the site that must never fail. Put the real ' +
      'address in, and give the reader a second route — a LinkedIn URL or a scheduling ' +
      'link — so a dead mail client is not the only way to reach you.',
  );
}

// ---- 3. The résumé PDF ----------------------------------------------------
{
  const problems = [];
  const p = 'public/resume.pdf';
  if (!exists(p)) {
    problems.push('public/resume.pdf is missing entirely');
  } else {
    const bytes = statSync(join(root, p)).size;
    // A one-page typeset résumé does not fit in 20 kB. The scaffold stub is 939 B.
    if (bytes < 20_000) problems.push(`only ${bytes} bytes — that is the scaffold stub, not a résumé`);
    const raw = readFileSync(join(root, p), 'latin1');
    for (const marker of ['Your Name', 'Your Title', 'replace this file']) {
      if (raw.includes(marker)) problems.push(`still contains the text "${marker}"`);
    }
  }
  check(
    'The résumé PDF is the real one',
    problems,
    'This is the highest-probability click on the whole site: the gate offers it ungated ' +
      'and the intro copy steers hurried readers straight to it. Export a one-page PDF with ' +
      'selectable text (not a flattened image) so ATS parsers and Ctrl-F work.',
  );
}

// ---- 4. Artifact images ---------------------------------------------------
{
  const dir = 'public/placeholders';
  const problems = [];
  if (exists(dir)) {
    for (const f of readdirSync(join(root, dir)).filter((f) => f.endsWith('.svg'))) {
      const s = read(join(dir, f));
      if (/PLACEHOLDER|REPLACE —/i.test(s)) problems.push(`${f} announces itself as a placeholder`);
      const hits = s.match(BRACKET) ?? [];
      if (hits.length) problems.push(`${f} has ${hits.length} unfilled figures (${[...new Set(hits)].slice(0, 4).join(' ')})`);
    }
  }
  check(
    'Artifact diagrams carry real figures',
    problems,
    'These render full-width inside the station panels — they are the thing a reader zooms ' +
      'into. Fill the figures, or swap in a sanitized export of the real artifact.',
  );
}

// ---- 5. The dev bypass ----------------------------------------------------
{
  const src = read('src/gate/Gate.tsx');
  const problems = [];
  if (src.includes('DEV_BYPASS_CODE')) {
    // Present is fine; UNGUARDED is not. The guard must make it invisible to
    // anyone who did not deliberately ask for it.
    const guarded = /import\.meta\.env\.DEV/.test(src) && /searchParams|location\.search/i.test(src);
    if (!guarded) {
      problems.push('the "Dev quick start" button renders for every visitor, including recruiters');
    }
  }
  check(
    'No debug affordance on the visitor-facing gate',
    problems,
    'Keep it behind `import.meta.env.DEV || ?dev` so it is there when you want it and ' +
      'invisible on the bare URL.',
  );
}

// ---- 6. The share surface -------------------------------------------------
{
  const html = read('index.html');
  const problems = [];
  if (!/property=["']og:image["']/.test(html)) problems.push('no og:image — LinkedIn and Slack will render a text-only card');
  if (!/rel=["']icon["']/.test(html)) problems.push('no favicon — the browser tab is an anonymous globe');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  if (!/carp/i.test(title)) problems.push(`<title> is "${title}" — a recruiter's bookmark cannot be traced back to you`);
  const canon = html.match(/rel=["']canonical["']\s+href=["']([^"']+)/)?.[1] ?? '';
  if (canon) problems.push(`canonical points at ${canon} — confirm that origin actually serves this app before sharing`);
  check(
    'The link previews as something worth clicking',
    problems.filter((p) => !p.startsWith('canonical')),
    'One image and three tags. Validate with LinkedIn Post Inspector before you send anything.',
  );
  // Canonical is a confirm-this, not a fail-this — reported separately below.
  if (canon) results.at(-1).note = `canonical/og:url = ${canon}`;
}

// ---- Report ---------------------------------------------------------------
const pass = results.filter((r) => r.ok).length;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n${bold('READY CHECK')} ${dim('— would this survive a hiring manager opening it right now?')}\n`);
for (const r of results) {
  console.log(`${r.ok ? green('  PASS') : red('  FAIL')}  ${r.name}`);
  for (const p of r.problems) console.log(`        ${red('·')} ${p}`);
  if (!r.ok) console.log(`        ${dim(r.fix)}`);
  if (r.note) console.log(`        ${dim(r.note)}`);
}

console.log(`\n${bold(`${pass}/${results.length} checks pass`)}`);
if (pass < results.length) {
  console.log(
    dim(
      '\nEverything above is content, not code — no test suite can find it for you, and\n' +
        'each one is visible to the first person you send the link to.\n',
    ),
  );
  console.log(
    dim(
      'Two more things this script cannot see, both one line of SQL in the Supabase editor:\n' +
        "  · rotate the dashboard passcode away from the seeded 'liftoff'\n" +
        '  · deactivate the seeded DEMO-K7M3 access code once real per-company codes exist\n',
    ),
  );
  process.exit(1);
}
console.log(green('\nSendable.\n'));
