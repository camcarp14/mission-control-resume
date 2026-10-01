/**
 * /work's words, in a dependency-free module so vite.config.ts can read the
 * same strings the page renders when it prerenders work/index.html — the
 * shell and the page can never say different things.
 */
export const WORK_POSITIONING =
  'Applied AI builder with a performance marketer’s sense of the business, in regulated healthcare.';

export const WORK_META = {
  title: 'Proof of work — Cameron Carpenter',
  description:
    'Proof of work from Cameron Carpenter, an applied AI builder with a performance marketer’s sense of the business: what each build does, where to see it, and what is still in progress.',
  url: 'https://camcarp.com/work',
} as const;
