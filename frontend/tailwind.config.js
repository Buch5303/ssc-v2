/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0a0e1a', panel: '#0f1524', elevated: '#151c2e', card: '#1a2236' },
        border: { DEFAULT: 'rgba(255,255,255,0.06)' },
        cyan: { DEFAULT: '#06b6d4', dim: 'rgba(6,182,212,0.08)' },
        green: { DEFAULT: '#10b981' },
        amber: { DEFAULT: '#f59e0b' },
        red: { DEFAULT: '#ef4444' },
        text: { primary: '#e2e8f0', secondary: '#94a3b8', tertiary: '#4a5568' },
      },
      fontFamily: { mono: ['var(--font-mono)', 'monospace'] },
    },
  },
  plugins: [],
};
