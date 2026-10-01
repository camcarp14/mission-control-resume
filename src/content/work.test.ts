/* ==== WORK CONTENT + WIRING TEST ========================================= */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { work, type WorkItem } from './work.js';
import { stations } from './stations.js';
import { ringItems, stationWork, workPageGroups } from './workView';

const PILLARS = ['Build', 'Measure', 'Govern', 'Enable', 'Persuade'];
const STATUSES = ['live', 'in-progress', 'planned'];
const stationIds = new Set(stations.map((s) => s.id));
// A link that points nowhere real: '#', empty, or a template domain.
const PLACEHOLDER = /^(#|$)|example\.(com|org)|your-?(site|domain)|placeholder/i;

describe('work.js content contract', () => {
  it('has unique, URL-safe ids', () => {
    const ids = work.map((w) => w.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(new Set(ids).size, 'work ids must be unique').toBe(ids.length);
  });

  it('puts at most one live item on any station', () => {
    const seen = new Map<string, string>();
    for (const w of work) {
      if (w.status !== 'live' || !w.stationId) continue;
      expect(seen.has(w.stationId), `${w.id} and ${seen.get(w.stationId)} both claim ${w.stationId}`).toBe(false);
      seen.set(w.stationId, w.id);
    }
  });

  for (const w of work) {
    describe(`work item ${w.id}`, () => {
      it('has a title, a known status, and 1+ known pillars', () => {
        expect(w.title.trim().length).toBeGreaterThan(0);
        expect(STATUSES).toContain(w.status);
        expect(w.pillars.length).toBeGreaterThan(0);
        for (const p of w.pillars) expect(PILLARS).toContain(p);
      });

      it('keeps the summary to three sentences at most', () => {
        expect(w.summary.trim().length).toBeGreaterThan(0);
        const sentences = w.summary.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
        expect(sentences, 'summary is longer than three sentences').toBeLessThanOrEqual(3);
      });

      it('carries an updated stamp as YYYY-MM', () => {
        expect(w.updated).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      });

      it('points stationId at a station that exists', () => {
        if (w.stationId !== undefined) expect(stationIds.has(w.stationId), `no station ${w.stationId}`).toBe(true);
      });

      it('links honestly for its status', () => {
        if (w.status === 'live' && !w.private) {
          expect(w.links.length, 'a live item needs a real link (or private: true)').toBeGreaterThan(0);
        }
        if (w.status !== 'live') expect(w.links, 'only live items may carry links').toHaveLength(0);
        for (const l of w.links) {
          expect(l.label.trim().length).toBeGreaterThan(0);
          expect(l.href).toMatch(/^https:\/\/\S+$/);
          expect(PLACEHOLDER.test(l.href), `placeholder link ${l.href}`).toBe(false);
        }
      });

      it('points image at a file that exists under public/', () => {
        if (w.image === undefined) return;
        expect(w.image.startsWith('/')).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', w.image.slice(1))), `${w.image} missing`).toBe(true);
      });

      it('keeps tags and expanded-view details within their layouts', () => {
        expect((w.tags ?? []).length).toBeLessThanOrEqual(3);
        if (w.details === undefined) return;
        expect(w.details.length).toBeGreaterThanOrEqual(2);
        expect(w.details.length).toBeLessThanOrEqual(4);
        for (const d of w.details) {
          expect(d.label.trim().length).toBeGreaterThan(0);
          // The label sits in a fixed 7.5rem column; past ~16 characters it wraps.
          expect(d.label.length, `detail label "${d.label}" is too long`).toBeLessThanOrEqual(16);
          expect(d.text.trim().length).toBeGreaterThan(0);
        }
      });
    });
  }
});

/* ---- the wiring, proven on synthetic items ------------------------------- */
const base = {
  pillars: ['Build'] as WorkItem['pillars'],
  summary: 'A thing.',
  updated: '2026-10',
};
const live: WorkItem = { ...base, id: 'a', title: 'Alpha', status: 'live', stationId: 'call-agent', links: [{ label: 'alpha.dev', href: 'https://alpha.dev/' }] };
const priv: WorkItem = { ...base, id: 'p', title: 'Private', status: 'live', private: true, stationId: 'evals', links: [], image: '/artifacts/zts-operations.jpg', demo: true };
const wip: WorkItem = { ...base, id: 'b', title: 'Beta', status: 'in-progress', stationId: 'call-agent', links: [] };
const planned: WorkItem = { ...base, id: 'c', title: 'Gamma', status: 'planned', stationId: 'pipeline', links: [], image: '/artifacts/river-racer.jpg' };

describe('work → surfaces wiring', () => {
  it('a live item with stationId puts its link button on that station', () => {
    const { artifact } = stationWork('call-agent', [live]);
    expect(artifact).toMatchObject({ kind: 'link', href: 'https://alpha.dev/' });
  });

  it('a private live item puts its screenshot (and its demo caption) on the station instead', () => {
    const { artifact } = stationWork('evals', [priv]);
    expect(artifact).toMatchObject({ kind: 'image', src: '/artifacts/zts-operations.jpg' });
    expect(artifact?.caption).toMatch(/demo data/);
  });

  it('flipping the same item from in-progress to live turns the chip into the artifact', () => {
    expect(stationWork('call-agent', [wip])).toEqual({ artifact: null, inProgress: ['Beta'] });
    expect(stationWork('call-agent', [{ ...wip, status: 'live', links: [{ label: 'beta.dev', href: 'https://beta.dev/' }] }]).artifact).toMatchObject({ kind: 'link' });
  });

  it('an in-progress item shows only a chip — no artifact, no links anywhere', () => {
    const r = stationWork('call-agent', [wip]);
    expect(r.artifact).toBeNull();
    expect(r.inProgress).toEqual(['Beta']);
    expect(workPageGroups([wip]).inProgress).toEqual([wip]);
    expect(ringItems([wip])).toEqual([]);
  });

  it('a planned item never renders: not on its station, not on /work, not in the ring', () => {
    expect(stationWork('pipeline', [planned])).toEqual({ artifact: null, inProgress: [] });
    expect(workPageGroups([planned])).toEqual({ live: [], inProgress: [] });
    expect(ringItems([planned])).toEqual([]);
  });

  it('the ring shows live items that have a screenshot, in file order', () => {
    expect(ringItems([live, priv, wip, planned]).map((i) => i.id)).toEqual(['p']);
  });

  it('the real file wires Zero To Secure to Flight Plan and ZTS Operations to Evals', () => {
    expect(stationWork('flight-plan').artifact).toMatchObject({ kind: 'link', href: 'https://zerotosecure.com/' });
    expect(stationWork('evals').artifact).toMatchObject({ kind: 'image', src: '/artifacts/zts-operations.jpg' });
    for (const s of stations) {
      // Planned items point at call-agent, evals and force-multiplier; none may leak.
      expect(stationWork(s.id).inProgress).toEqual([]);
    }
  });
});
