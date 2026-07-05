'use client';

/**
 * FakePass — SITE · Reuters (página de artigo).
 * Masthead branco com logo "Reuters" laranja + mark, nav cinza-escuro; artigo
 * com categoria/acento laranja, manchete sans bold preta, dek, byline "By ..."
 * + hora, imagem-hero (com opção de tela verde) e corpo.
 * Recria o LAYOUT do portal; todo texto é placeholder editável.
 */

import { Field, TextField, type FakeModel } from './shared';
import {
  SiteFrame,
  SiteNav,
  HeroBox,
  SiteBgControls,
  ArticleFields,
  siteDims,
  siteMetrics,
  defaultSiteArticle,
  SITE_SANS,
  type SiteArticle,
} from './site-kit';

type S = SiteArticle & { nav: string };

const REUTERS_ORANGE = '#fa6b05';

/** Logo "Reuters" laranja com o mark de barras concêntricas aproximado. */
function ReutersLogo() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* mark: quarto de círculo de barras (aproximação do símbolo Reuters) */}
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        {[9, 6.2, 3.4].map((r, i) => (
          <path
            key={i}
            d={`M 1 21 A ${r + 4} ${r + 4} 0 0 1 ${r + 5} 1`}
            stroke={REUTERS_ORANGE}
            strokeWidth="2.4"
            fill="none"
          />
        ))}
      </svg>
      <span
        style={{
          fontFamily: SITE_SANS,
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: -0.6,
          color: REUTERS_ORANGE,
          lineHeight: 1,
        }}
      >
        Reuters
      </span>
    </span>
  );
}

function ReutersPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      <SiteNav
        logo={<ReutersLogo />}
        items={items}
        bg="#ffffff"
        color="#33373b"
        border="#e2e2e2"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#33373b' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#33373b" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <span
              style={{
                background: REUTERS_ORANGE,
                color: '#fff',
                borderRadius: 2,
                padding: '5px 12px',
                fontWeight: 700,
              }}
            >
              Subscribe
            </span>
          </span>
        }
      />

      {/* corpo do artigo */}
      <div style={{ padding: '22px 26px 0' }}>
        <div style={{ color: REUTERS_ORANGE, fontWeight: 700, fontSize: 13.5, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 10 }}>
          {s.category}
        </div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 35, lineHeight: 1.14, letterSpacing: -0.6, color: '#0a0a0a' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.4, color: '#4a4f54', marginTop: 14, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#6a6f74' }}>
          <span style={{ fontWeight: 700, color: '#0a0a0a' }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#8a8f94', marginTop: 7 }}>Image caption · REUTERS</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 26px 0', fontSize: 16.5, lineHeight: 1.55, color: '#26292c' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const REUTERS_SITE: FakeModel<S> = {
  id: 'site-reuters',
  label: 'Artigo',
  category: 'sites',
  group: 'Reuters',
  hue: 'rgba(250,107,5,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Business',
    headline: 'Global markets steady as investors weigh policy signals',
    standfirst: 'Trading was measured across major indexes as participants awaited fresh guidance from officials.',
    author: 'By Jordan Avery',
    nav: 'Home, World, Business, Markets, Sustainability, Legal, Breakingviews, Technology',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Home, World, Business, Markets" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <ReutersPage s={s} />,
};

export default [REUTERS_SITE];
