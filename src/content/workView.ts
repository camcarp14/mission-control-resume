import { work, type WorkItem } from './work.js';
import type { StationArtifact } from './stations.js';

/**
 * The read side of work.js — the only code that decides what a work item
 * looks like on each surface. Pure functions over an item list (defaulting
 * to the real one) so src/content/work.test.ts can prove the wiring with
 * synthetic items: live + stationId puts the artifact on the station,
 * in-progress shows a chip, planned never appears anywhere.
 */

/** The primary outbound link of an item, if it has one. */
export function primaryLink(item: WorkItem): { label: string; href: string } | undefined {
  return item.links[0];
}

/** Home page Artifacts ring: live items with a screenshot, in file order. */
export function ringItems(items: WorkItem[] = work): WorkItem[] {
  return items.filter((i) => i.status === 'live' && Boolean(i.image));
}

/** /work: live items, then in-progress ones. Planned items are absent. */
export function workPageGroups(items: WorkItem[] = work): {
  live: WorkItem[];
  inProgress: WorkItem[];
} {
  return {
    live: items.filter((i) => i.status === 'live'),
    inProgress: items.filter((i) => i.status === 'in-progress'),
  };
}

/** What a station shows from work.js: at most one artifact (from its live
 *  item) and an "In progress" chip per in-progress item pointed at it. */
export function stationWork(
  stationId: string,
  items: WorkItem[] = work,
): { artifact: StationArtifact | null; inProgress: string[] } {
  const live = items.find((i) => i.status === 'live' && i.stationId === stationId);
  const inProgress = items
    .filter((i) => i.status === 'in-progress' && i.stationId === stationId)
    .map((i) => i.title);
  return { artifact: live ? toArtifact(live) : null, inProgress };
}

/** A linked item becomes the station's button; a private one, its screenshot. */
function toArtifact(item: WorkItem): StationArtifact | null {
  const link = primaryLink(item);
  if (link && !item.private) {
    return { kind: 'link', href: link.href, label: `Visit ${item.title}`, noun: 'a live site' };
  }
  if (item.image) {
    return {
      kind: 'image',
      src: item.image,
      alt: `${item.title} — screenshot${item.demo ? ' on demo data' : ''}`,
      caption: `${item.title}${item.demo ? ' · demo data' : ''}`,
      noun: 'a screenshot',
    };
  }
  return null;
}
