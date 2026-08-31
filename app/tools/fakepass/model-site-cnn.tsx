'use client';

/**
 * FakePass — SITE · CNN (página de artigo).
 * Masthead branco com logo CNN (caixa vermelha, "CNN" branco italic bold) + nav
 * preta; artigo com categoria vermelha, manchete sans bold preta grande, dek,
 * byline (autor + "Updated hh:mm"), imagem-hero (com opção de tela verde) e corpo.
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

function CnnLogo() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#cc0000',
        color: '#ffffff',
        fontFamily: SITE_SANS,
        fontWeight: 800,
        fontStyle: 'italic',
        fontSize: 22,
        lineHeight: 1,
        letterSpacing: -1,
        padding: '7px 9px 8px',
      }}
    >
      CNN
    </span>
  );
}

function CnnPage({ s }: { s: S }) {
  const { W } = siteMetrics(s.format);
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame format={s.format}>
      <SiteNav
        logo={<CnnLogo />}
        items={items}
        bg="#ffffff"
        color="#0c0c0c"
        border="#e0e0e0"
        fontSize={13}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#0c0c0c' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0c0c0c" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <span style={{ background: '#cc0000', color: '#fff', borderRadius: 2, padding: '4px 9px' }}>Sign in</span>
          </span>
        }
      />

      {/* corpo do artigo */}
      <div style={{ padding: '22px 26px 0' }}>
        <div style={{ color: '#cc0000', fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 }}>{s.category}</div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 38, lineHeight: 1.1, letterSpacing: -0.8, color: '#0c0c0c' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.4, color: '#404040', marginTop: 14, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 12.5, color: '#6a6a6a' }}>
          <span style={{ fontWeight: 700, color: '#0c0c0c' }}>{s.author}</span>
          <span>•</span>
          <span>{`Updated ${s.time}`}</span>
        </div>
      </div>

      {/* separador */}
      <div style={{ margin: '18px 26px 0', borderTop: '1px solid #e0e0e0' }} />

      {/* imagem-hero */}
      <div style={{ padding: '16px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#767676', marginTop: 6 }}>Image caption</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 26px 0', fontSize: 16.5, lineHeight: 1.55, color: '#1a1a1a' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const CNN_SITE: FakeModel<S> = {
  id: 'site-cnn',
  label: 'Artigo',
  category: 'sites',
  group: 'CNN',
  hue: 'rgba(204,0,0,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  dims: (s) => siteDims(s.format),
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'World',
    headline: 'Officials announce sweeping new measures amid mounting pressure',
    standfirst: 'The decision follows weeks of negotiations, with further details expected in the coming days.',
    author: 'By Jordan Avery, CNN',
    time: '9:41 AM EDT, Sat July 5, 2026',
    nav: 'World, US, Politics, Business, Health, Entertainment, Tech, Style',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="World, US, Politics, Business" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <CnnPage s={s} />,
};

export default [CNN_SITE];
