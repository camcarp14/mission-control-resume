/**
 * /work's words, in a dependency-free module so vite.config.ts can read the
 * same strings the page renders when it prerenders work/index.html — the
 * shell and the page can never say different things.
 */
export const WORK_POSITIONING =
  'Client-facing solutions consultant who leads discovery with enterprise stakeholders then builds and deploys the technical solution behind the recommendation.';

export const WORK_META = {
  title: 'Proof of work — Cameron Carpenter',
  description:
    'Proof of work from Cameron Carpenter, a client-facing solutions consultant who builds with AI: what each build does and where to see it.',
  url: 'https://camcarp.com/work',
} as const;
