import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono, Orbitron } from 'next/font/google';
import { MouseGlow } from '@/components/MouseGlow';
import { RippleRoot } from '@/components/RippleRoot';
import './globals.css';

/**
 * Fonts carregadas via next/font (zero FOUC, self-host automatico).
 * - display: Space Grotesk  -> UI geral
 * - mono:    JetBrains Mono -> numeros, timestamps, codigo
 * - tech:    Orbitron       -> tabs, labels maiusculas, estilo hardware UI
 */
const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '700'],
  display: 'swap',
});

const tech = Orbitron({
  subsets: ['latin'],
  variable: '--font-tech',
  weight: ['500', '700', '900'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CASABLANCA — Ferramentas para editores',
  description:
    'Plataforma de ferramentas para editores de video e criadores: decupagem, camuflagem, compressao e portfolio profissional.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${display.variable} ${mono.variable} ${tech.variable}`}
    >
      <body>
        <MouseGlow />
        <RippleRoot />
        {children}
      </body>
    </html>
  );
}
