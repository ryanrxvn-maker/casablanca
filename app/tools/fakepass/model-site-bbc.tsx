'use client';

/**
 * FakePass — SITE · BBC News (página de artigo).
 * Masthead preto com blocos BBC + nav; artigo com categoria vermelha, manchete
 * bold, dek, byline, imagem-hero (com opção de tela verde) e corpo.
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

function BbcBlocks() {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {['B', 'B', 'C'].map((c, i) => (
        <span
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            background: '#ffffff',
            color: '#000',
            fontWeight: 800,
            fontSize: 18,
            lineHeight: 1,
            letterSpacing: -0.5,
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function BbcPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      <SiteNav
        logo={<BbcBlocks />}
        items={items}
        bg="#141414"
        color="#ffffff"
        border="#3a3a3a"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ border: '1px solid #ffffff', borderRadius: 2, padding: '3px 8px' }}>Sign in</span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          </span>
        }
      />

      {/* corpo do artigo */}
      <div style={{ padding: '20px 26px 0' }}>
        <div style={{ color: '#b80000', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{s.category}</div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 34, lineHeight: 1.12, letterSpacing: -0.5, color: '#141414' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.35, color: '#3a3a3a', marginTop: 12, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: '#5a5a5a' }}>
          <span style={{ fontWeight: 700, color: '#141414' }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '16px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#767676', marginTop: 6 }}>Image caption</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '14px 26px 0', fontSize: 16.5, lineHeight: 1.5, color: '#222' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const BBC_SITE: FakeModel<S> = {
  id: 'site-bbc',
  label: 'Artigo',
  category: 'sites',
  group: 'BBC',
  hue: 'rgba(184,0,0,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'World',
    headline: 'Governments meet to discuss new global measures',
    nav: 'Home, News, Sport, Business, Innovation, Culture, Travel',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Home, News, Sport" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <BbcPage s={s} />,
};

export default [BBC_SITE];
