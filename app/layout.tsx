import type { Metadata } from 'next';

import localFont from 'next/font/local';
import { MouseGlow } from '@/components/MouseGlow';
import { RippleRoot } from '@/components/RippleRoot';
import { FloatingOrbs } from '@/components/FloatingOrbs';
import { WhatsAppFab } from '@/components/WhatsAppFab';
import { ThemeManager } from '@/components/ThemeManager';
import { ChunkGuard } from '@/components/ChunkGuard';
import './globals.css';
import './button-refinements.css';

// Original typefaces, served locally for consistent previews and builds.
const display = localFont({ src: '../public/fonts/site-space-grotesk.woff2', variable: '--font-display', weight: '300 700', display: 'swap' });
const mono = localFont({ src: '../public/fonts/site-jetbrains-mono.woff2', variable: '--font-mono', weight: '100 800', display: 'swap', preload: false });
const tech = localFont({ src: '../public/fonts/site-bricolage-grotesque.woff2', variable: '--font-tech', weight: '200 800', display: 'swap', preload: false });
const serif = localFont({ src: [{path:'../public/fonts/site-instrument-serif.woff2',style:'normal',weight:'400'},{path:'../public/fonts/site-instrument-serif-italic.woff2',style:'italic',weight:'400'}], variable: '--font-serif', display: 'swap', preload: false });
const label = localFont({ src: '../public/fonts/site-inter.woff2', variable: '--font-label', weight: '100 900', display: 'swap', preload: false });

const SITE_URL = 'https://www.darkoautoedit.com';
const SITE_DESC =
  'Decupagem automática, camuflagem de áudio com selo por plataforma, 41 modelos de print de notícia, lipsync e legenda alinhada à copy — ferramentas de edição de vídeo direto no navegador.';

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
    'camuflagem de áudio',
    'print de telejornal',
    'manchete de jornal para vídeo',
    'gerador de print falso para criativo',
    'lipsync video to video',
    'editor de vídeo automático',
    'automação UGC',
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
        'Camuflagem de áudio com verificação por plataforma',
        'FakePrint — prints de telejornal, site de notícia e redes sociais',
        'Lipsync Video to Video',
        'Legendas (SRT) alinhadas à copy',
        'Compressão e ajuste de velocidade em lote',
      ],
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'BRL',
        lowPrice: '0',
        highPrice: '57',
        offerCount: 2,
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'BRL' },
          { '@type': 'Offer', name: 'Premium', price: '57', priceCurrency: 'BRL' },
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
      className={`${display.variable} ${mono.variable} ${tech.variable} ${serif.variable} ${label.variable}`}
    >
      <body className="ae-refined-controls">
        {/* Anti-flash: aplica o tema salvo ANTES da pintura, mas SÓ dentro da
            conta (app). Landing e páginas públicas ficam sempre dark. /planos
            só fica claro se aberto via upgrade (?upgrade). Default = dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=location.pathname,s=location.search;var app=(p==='/tools'||p.indexOf('/tools/')===0||p.indexOf('/configuracoes')===0||p.indexOf('/admin')===0||((p==='/planos'||p.indexOf('/planos')===0)&&s.indexOf('upgrade')>-1));if(app&&localStorage.getItem('theme')==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          // JSON estático do app (sem input de usuário) — seguro.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <ChunkGuard />
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
