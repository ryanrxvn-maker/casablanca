import type { Metadata } from 'next';

import {
  Space_Grotesk,
  JetBrains_Mono,
  Bricolage_Grotesque,
  Instrument_Serif,
} from 'next/font/google';
import { MouseGlow } from '@/components/MouseGlow';
import { RippleRoot } from '@/components/RippleRoot';
import { FloatingOrbs } from '@/components/FloatingOrbs';
import './globals.css';

/**
 * Tipografia DARKO LAB v2 — identidade premium, nada generico.
 *
 *  display  · Space Grotesk        → UI geral (sem custos cognitivos)
 *  mono     · JetBrains Mono       → numeros, timestamps, codigo
 *  tech     · Bricolage Grotesque  → titulos, brand, labels (substitui o Orbitron
 *                                     com cara de "vibe code"; geometria moderna
 *                                     com personalidade marcante).
 *  serif    · Instrument Serif     → acentos editoriais (frases italicas no hero)
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

const tech = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-tech',
  weight: ['500', '700', '800'],
  display: 'swap',
});

const serif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400'],
  style: ['italic', 'normal'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DARKO LAB',
  description: 'Suite criativa pra editores.',
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
      className={`${display.variable} ${mono.variable} ${tech.variable} ${serif.variable}`}
    >
      <body>
        <FloatingOrbs />
        <MouseGlow />
        <RippleRoot />
        {children}
      </body>
    </html>
  );
}
