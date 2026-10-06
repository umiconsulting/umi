/** @type {import('tailwindcss').Config} */
// Design tokens from packages/tokens (committed dist/, no workspace dependency —
// Vercel's app-scoped npm build resolves it via this relative path).
const tokens = require('../../packages/tokens/dist/landing.cjs');

module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: tokens.colors,
      fontFamily: tokens.fontFamily,
      letterSpacing: tokens.letterSpacing,
    },
  },
  plugins: [],
};
