import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // All colors reference CSS variables — set per-tenant in [slug]/layout.tsx
        coffee: {
          dark:   'var(--color-ink)',          // very dark — text, headers
          brand:  'var(--color-brand)',        // primary — CTA, loyalty card bg
          medium: 'var(--color-brand-dark)',   // secondary text, hover states
          light:  'var(--color-ink-light)',    // subtle text, icons
          cream:  'var(--color-surface)',      // main background
          pale:   'var(--color-surface-dark)', // card surfaces, borders
        },
      },
      fontFamily: {
        display: ['Domus', '"Playfair Display"', 'Georgia', 'serif'],
        body: ['Domus', 'system-ui', 'sans-serif'],
        sans: ['Domus', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        decorative: ['Rye', '"Playfair Display"', 'serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'dot-pop': 'dotPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'count-up': 'countUp 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        dotPop: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '60%': { transform: 'scale(1.25)', opacity: '1' },
          '100%': { transform: 'scale(1.1)', opacity: '1' },
        },
        countUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};

export default config;
