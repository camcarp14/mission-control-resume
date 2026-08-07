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
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter var', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
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
