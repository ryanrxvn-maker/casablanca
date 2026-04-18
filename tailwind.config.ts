import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core palette derived from the Ora-style reference
        bg: {
          DEFAULT: '#0a0a0a',
          soft: '#111111',
          softer: '#151515',
        },
        line: {
          DEFAULT: '#1a1a1a',
          strong: '#222222',
        },
        text: {
          DEFAULT: '#ffffff',
          muted: '#888888',
          dim: '#555555',
        },
        lime: {
          DEFAULT: '#c8ff00',
          soft: 'rgba(200, 255, 0, 0.12)',
        },
      },
      fontFamily: {
        display: ['Outfit', 'system-ui', 'sans-serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
      },
      letterSpacing: {
        brand: '0.25em',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
      },
      backgroundImage: {
        'grid-lines':
          'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
        'radial-lime':
          'radial-gradient(60% 50% at 50% 0%, rgba(200,255,0,0.08) 0%, rgba(200,255,0,0) 70%)',
      },
      backgroundSize: {
        'grid-lines': '48px 48px',
      },
    },
  },
  plugins: [],
};

export default config;
