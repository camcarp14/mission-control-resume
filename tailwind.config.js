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
        sans: ['Inter var', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // Display face for the hero identity + in-scene labels only — vendored
        // OFL font (public/fonts/), fetched lazily on first use post-gate so
        // the entry chunk's FCP budget never pays for it.
        display: ['Space Grotesk', 'Inter var', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Dense by design. Generous space BETWEEN blocks, not inside them.
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.06em' }],
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['12.5px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
      },
      borderRadius: {
        DEFAULT: '3px',
        sm: '2px',
        md: '4px',
      },
    },
  },
  plugins: [],
};
