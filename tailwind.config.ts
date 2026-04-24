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
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        tech: ['var(--font-tech)', 'var(--font-display)', 'system-ui'],
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
        'ripple': {
          '0%': {
            transform: 'translate(-50%, -50%) scale(0)',
            opacity: '0.55',
          },
          '100%': {
            transform: 'translate(-50%, -50%) scale(18)',
            opacity: '0',
          },
        },
        'drift': {
          '0%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-6px,0)' },
          '100%': { transform: 'translate3d(0,0,0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-18px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        'ripple': 'ripple 0.6s ease-out forwards',
        'drift': 'drift 8s ease-in-out infinite',
        'slide-in-left': 'slide-in-left 0.55s cubic-bezier(.2,.8,.2,1) both',
        'scale-in': 'scale-in 0.4s ease-out both',
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
      boxShadow: {
        'depth-1':
          '0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 20px -15px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.4)',
        'depth-2':
          '0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 40px -20px rgba(0,0,0,0.9), 0 8px 16px rgba(0,0,0,0.45)',
        'depth-3':
          '0 1px 0 rgba(255,255,255,0.08) inset, 0 40px 80px -30px rgba(0,0,0,0.95), 0 16px 32px rgba(0,0,0,0.5)',
        'lime-glow':
          '0 0 0 1px rgba(200,255,0,0.35), 0 0 40px -5px rgba(200,255,0,0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
