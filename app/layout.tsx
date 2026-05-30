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
import { WhatsAppFab } from '@/components/WhatsAppFab';
import { ThemeManager } from '@/components/ThemeManager';
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

const SITE_URL = 'https://www.darkoautoedit.com';
const SITE_DESC =
  'Automatize decupagem, B-roll, lipsync e legendas. Ligue a fila e vá dormir — o estúdio entrega. Ferramentas de edição de vídeo no automático, direto no navegador.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Auto Edit — Automação de edição de vídeo com IA',
    template: '%s · Auto Edit',
  },
  description: SITE_DESC,
  keywords: [
    'automação de edição de vídeo',
    'decupagem automática',
    'gerar b-roll com IA',
    'lipsync em lote',
    'remover legenda de vídeo',
    'editor de vídeo automático',
    'automação UGC',
    'HeyGen em lote',
    'gerador de legenda SRT',
    'compressor de vídeo online',
    'editar vídeo com IA',
    'Auto Edit',
  ],
  applicationName: 'Auto Edit',
  authors: [{ name: 'Auto Edit' }],
  creator: 'Auto Edit',
  publisher: 'Auto Edit',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: SITE_URL,
    siteName: 'Auto Edit',
    title: 'Auto Edit — Automação de edição de vídeo com IA',
    description: SITE_DESC,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auto Edit — Automação de edição de vídeo com IA',
    description: SITE_DESC,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/auto-edit-logo@128.png', sizes: '128x128', type: 'image/png' },
    ],
    apple: [{ url: '/auto-edit-logo@256.png', sizes: '256x256' }],
  },
  // Verificação do Google Search Console — método "tag HTML".
  // Cole o código em GOOGLE_SITE_VERIFICATION na Vercel e redeploy; se vazio,
  // o Next simplesmente omite a meta tag. (O método por DNS no Cloudflare é
  // ainda mais rápido e não precisa de código.)
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  // Marker pra extensão Freepik Sync auto-detectar este domínio.
  other: {
    'auto-edit-app': 'true',
  },
};

/** JSON-LD (structured data) pra rich results no Google + citação em IA. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'Auto Edit',
      alternateName: 'Darko Auto Edit',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/auto-edit-logo@256.png`,
        width: 256,
        height: 256,
      },
      description: SITE_DESC,
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        url: 'https://wa.me/5534991262437',
        availableLanguage: ['Portuguese'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'Auto Edit',
      description: SITE_DESC,
      inLanguage: 'pt-BR',
      publisher: { '@id': `${SITE_URL}/#org` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#app`,
      name: 'Auto Edit',
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: 'Video Editing Automation',
      operatingSystem: 'Web',
      url: SITE_URL,
      image: `${SITE_URL}/opengraph-image`,
      screenshot: `${SITE_URL}/opengraph-image`,
      description: SITE_DESC,
      inLanguage: 'pt-BR',
      publisher: { '@id': `${SITE_URL}/#org` },
      featureList: [
        'Decupagem automática de vídeo',
        'Geração de B-roll com IA',
        'Lipsync em lote',
        'Remover legenda gravada e marca d’água',
        'Legendas automáticas',
        'Troca de produto no áudio sem regravar',
      ],
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'BRL',
        lowPrice: '0',
        highPrice: '116',
        offerCount: 3,
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'BRL' },
          { '@type': 'Offer', name: 'Basic', price: '57', priceCurrency: 'BRL' },
          { '@type': 'Offer', name: 'Pro', price: '116', priceCurrency: 'BRL' },
        ],
      },
    },
  ],
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
        {/* Anti-flash: aplica o tema salvo ANTES da pintura, mas SÓ dentro da
            conta (app). Landing e páginas públicas ficam sempre dark. /planos
            só fica claro se aberto via upgrade (?upgrade). Default = dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=location.pathname,s=location.search;var forceDark=p.indexOf('/admin/dashboard')===0;var app=(p==='/tools'||p.indexOf('/tools/')===0||p.indexOf('/configuracoes')===0||p.indexOf('/admin')===0||((p==='/planos'||p.indexOf('/planos')===0)&&s.indexOf('upgrade')>-1));if(app&&!forceDark&&localStorage.getItem('theme')==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          // JSON estático do app (sem input de usuário) — seguro.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <ThemeManager />
        <FloatingOrbs />
        <MouseGlow />
        <RippleRoot />
        {children}
        <WhatsAppFab />
      </body>
    </html>
  );
}
