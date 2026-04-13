/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ibm-sans)', 'IBM Plex Sans', 'sans-serif'],
        mono: ['var(--font-ibm-mono)', 'IBM Plex Mono', 'monospace'],
      },
      colors: {
        brand: {
          blue:  '#1E6FCC',
          blue2: '#2E8BE8',
          red:   '#CC2020',
        },
      },
    },
  },
  plugins: [],
};
