/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Instrument, not dashboard. One accent, reserved for "this number is
    // off-target." Everything else is greyscale — restraint is the whole look.
    extend: {
      colors: {
        ground: '#08090b',
        panel: '#0d0f13',
        raised: '#12151a',
        rule: 'rgba(255,255,255,0.07)',
        'rule-strong': 'rgba(255,255,255,0.14)',
        ink: '#e8e6e1',
        dim: '#8b929c',
        faint: '#737c88', // 4.5:1 on panel — informational text, so AA applies

        accent: '#ff5c37',
        'accent-dim': 'rgba(255,92,55,0.14)',

        // The flight-deck HUD family. The chrome that reads as "instrument
        // glass" — telemetry, rails, hero flourishes — speaks cyan; the
        // original ember accent stays reserved for CTAs and fire.
        hud: '#9adcff',
        cyan: '#4cc9f0',
        'cyan-bright': '#7df9ff',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        // 'Inter var' used to lead both stacks and is loaded NOWHERE —
        // public/fonts/ holds one file and it is SpaceGrotesk.ttf. So on the
        // handful of machines with Inter installed the site silently rendered
        // in a different typeface than the one it was designed and screenshot
        // in, and everywhere else the entry was dead weight in the cascade.
        // The README calls this a "system font stack"; now it is one.
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // Display face for the hero identity + in-scene labels only — vendored
        // OFL font (public/fonts/), fetched lazily on first use post-gate so
        // the entry chunk's FCP budget never pays for it.
        display: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Dense by design. Generous space BETWEEN blocks, not inside them.
        //
        // Authored in rem against the 16px root, and these are the SAME
        // 10/11/12.5/14px they have always been at every viewport under
        // 1920px. The unit is the whole point: polish.css steps the root to
        // 17-19px on displays ≥1920, where a fixed px ramp left the console
        // reading as a small card marooned in a huge frame (screenshot
        // finding at 2560x1200). Line-heights ride along so the vertical
        // rhythm scales with the type instead of stretching against it.
        // Adding a size here means computing it as px/16 — never a bare px.
        '2xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.06em' }],
        xs: ['0.6875rem', { lineHeight: '1rem' }],
        sm: ['0.78125rem', { lineHeight: '1.125rem' }],
        base: ['0.875rem', { lineHeight: '1.25rem' }],
      },
      // The radius ramp, mirroring --r-1/2/3 in polish.css. One material:
      // sm = micro-chrome, DEFAULT = controls, md = containers. See the long
      // note at the top of polish.css for why there is no pill in this list.
      borderRadius: {
        DEFAULT: '3px',
        sm: '2px',
        md: '4px',
      },
    },
  },
  plugins: [],
};
