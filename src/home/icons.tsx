import type { ReactNode } from 'react';

/* ---- section icons ---------------------------------------------------------
   One family: 24-unit grid, 1.5 stroke, round joins, currentColor (the tile
   colours them in the HUD's cyan). Drawn here rather than pulled from an icon
   package — three glyphs do not justify a dependency in the entry chunk. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A page with a folded corner and lines of text. */
export function IconArticles() {
  return (
    <Glyph>
      <path d="M6.5 3h7.5l4.5 4.5V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4.5h4.5" />
      <path d="M9 12h6M9 15.5h6M9 9h2.5" />
    </Glyph>
  );
}

/** Two stacked windows — the ring's cards, in miniature. */
export function IconArtifacts() {
  return (
    <Glyph>
      <rect x="3" y="8" width="13.5" height="12" rx="1.5" />
      <path d="M3 11.5h13.5" />
      <path d="M7.5 8V5.5A1.5 1.5 0 0 1 9 4h10.5A1.5 1.5 0 0 1 21 5.5V14a1.5 1.5 0 0 1-1.5 1.5h-3" />
      <path d="M7.5 7.5H21" />
    </Glyph>
  );
}

/** An upright rocket: hull, porthole, fins, flame. */
export function IconRocket() {
  return (
    <Glyph>
      <path d="M12 2.5c2.9 1.9 4.5 5.2 4.5 9.2V16h-9v-4.3c0-4 1.6-7.3 4.5-9.2z" />
      <circle cx="12" cy="9.5" r="1.75" />
      <path d="M7.5 12.5 5 15v3.5l2.5-1.5M16.5 12.5 19 15v3.5L16.5 17" />
      <path d="M10.5 18.5c0 1 .6 2 1.5 3 .9-1 1.5-2 1.5-3" />
    </Glyph>
  );
}
