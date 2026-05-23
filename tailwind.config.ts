import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Tons base — preto profundo com gradiente sutil em cinzas
        bg: {
          DEFAULT: '#070708',
          soft: '#0e0e10',
          softer: '#15151a',
          elev: '#1a1a20',
        },
        line: {
          DEFAULT: '#1c1c22',
          strong: '#24242c',
          glow: '#2e2e38',
        },
        text: {
          DEFAULT: '#ffffff',
          muted: '#8b8b96',
          dim: '#4d4d57',
        },
        // Lime — acento PRIMARIO da marca. Usar com parcimonia: CTA, dots ativos, brand.
        lime: {
          DEFAULT: '#c8ff00',
          soft: 'rgba(200, 255, 0, 0.10)',
        },
        // Violeta — acento SECUNDARIO. Estados AI, premium, "inteligente".
        violet: {
          DEFAULT: '#a78bfa',
          soft: 'rgba(167, 139, 250, 0.12)',
          deep: '#6d4ee8',
        },
        // Ambar — acento TERCIARIO. Pontos, conquistas, warnings suaves.
        amber: {
          DEFAULT: '#f5c842',
          soft: 'rgba(245, 200, 66, 0.12)',
        },
        // Ciano frio — info, processing
        cyan: {
          DEFAULT: '#67e8f9',
          soft: 'rgba(103, 232, 249, 0.10)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        // Tech — headings com identidade. Bricolage Grotesque (geometrica
        // moderna, sem cara de sci-fi generico que o Orbitron tinha).
        tech: ['var(--font-tech)', 'var(--font-display)', 'system-ui'],
        // Serif elegante pra hero/numero grande/acento editorial
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      borderRadius: {
        DEFAULT: '14px',
        lg: '18px',
        xl: '22px',
        '2xl': '28px',
      },
      letterSpacing: {
        brand: '0.22em',
        wide: '0.08em',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
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
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-6px,0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-22px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'float-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'kinetic-in': {
          '0%': { opacity: '0', transform: 'translateY(20px) rotateX(-30deg)' },
          '100%': { opacity: '1', transform: 'translateY(0) rotateX(0)' },
        },
        'sheen': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'tilt-idle': {
          '0%, 100%': { transform: 'perspective(1200px) rotateX(0) rotateY(0)' },
          '50%': { transform: 'perspective(1200px) rotateX(1deg) rotateY(-1.5deg)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.6s cubic-bezier(.2,.8,.2,1) both',
        'fade-in': 'fade-in 0.5s ease-out both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        'ripple': 'ripple 0.6s ease-out forwards',
        'drift': 'drift 8s ease-in-out infinite',
        'slide-in-left': 'slide-in-left 0.6s cubic-bezier(.2,.8,.2,1) both',
        'scale-in': 'scale-in 0.45s cubic-bezier(.2,.8,.2,1) both',
        'float-y': 'float-y 5s ease-in-out infinite',
        'kinetic-in': 'kinetic-in 0.7s cubic-bezier(.2,.8,.2,1) both',
        'sheen': 'sheen 2.4s linear infinite',
        'tilt-idle': 'tilt-idle 9s ease-in-out infinite',
      },
      backgroundImage: {
        'grid-fine':
          'linear-gradient(to right, rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.022) 1px, transparent 1px)',
        'radial-violet':
          'radial-gradient(60% 50% at 50% 0%, rgba(167,139,250,0.10) 0%, rgba(167,139,250,0) 70%)',
        'radial-lime':
          'radial-gradient(60% 50% at 50% 0%, rgba(200,255,0,0.06) 0%, rgba(200,255,0,0) 70%)',
        'mesh':
          'radial-gradient(40% 30% at 12% 0%, rgba(167,139,250,0.08), transparent 70%),radial-gradient(35% 28% at 88% 12%, rgba(103,232,249,0.05), transparent 70%),radial-gradient(50% 40% at 50% 100%, rgba(200,255,0,0.04), transparent 70%)',
      },
      backgroundSize: {
        'grid-fine': '52px 52px',
      },
      boxShadow: {
        'depth-1':
          '0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 24px -16px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.45)',
        'depth-2':
          '0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 48px -22px rgba(0,0,0,0.92), 0 8px 18px rgba(0,0,0,0.5)',
        'depth-3':
          '0 1px 0 rgba(255,255,255,0.08) inset, 0 44px 88px -32px rgba(0,0,0,0.95), 0 18px 36px rgba(0,0,0,0.55)',
        'lime-glow':
          '0 0 0 1px rgba(200,255,0,0.32), 0 0 36px -4px rgba(200,255,0,0.4)',
        'violet-glow':
          '0 0 0 1px rgba(167,139,250,0.32), 0 0 36px -4px rgba(167,139,250,0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
