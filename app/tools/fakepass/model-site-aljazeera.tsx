'use client';

/**
 * FakePass — SITE · Al Jazeera (página de artigo).
 * Masthead branco com wordmark laranja/dourado "aljazeera"; faixa de nav escura
 * (News, Middle East, Features, Economy…); artigo com categoria/acento dourado,
 * manchete sans bold, dek, byline, imagem-hero (opção de tela verde) e corpo.
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

const AJ_GOLD = '#fa9000';
const AJ_ACCENT = '#c9920a';

/** Wordmark aproximado "aljazeera" (minúsculo, dourado). */
function AlJazeeraWordmark() {
  return (
    <span
      style={{
        fontFamily: SITE_SANS,
        fontWeight: 700,
        fontSize: 26,
        lineHeight: 1,
        color: AJ_GOLD,
        letterSpacing: -0.5,
      }}
    >
      aljazeera
    </span>
  );
}

function AlJazeeraPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      {/* masthead branco com wordmark */}
      <SiteNav
        logo={<AlJazeeraWordmark />}
        bg="#ffffff"
        color="#1a1a1a"
        border="#e2e2e2"
        height={58}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#1a1a1a' }}>
            <span>Live</span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          </span>
        }
      />

      {/* faixa de nav escura */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '0 18px',
          height: 40,
          background: '#1a1a1a',
          color: '#ffffff',
          fontSize: 13,
          fontWeight: 700,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {items.map((it, i) => (
          <span key={i}>{it}</span>
        ))}
      </div>

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 26px 0' }}>
        <div style={{ color: AJ_ACCENT, fontWeight: 700, fontSize: 13.5, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
          {s.category}
        </div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 33, lineHeight: 1.14, letterSpacing: -0.5, color: '#1a1a1a' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.4, color: '#4a4a4a', marginTop: 12, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#6a6a6a' }}>
          <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{s.author}</span>
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
        <div style={{ padding: '14px 26px 0', fontSize: 16.5, lineHeight: 1.55, color: '#222' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const ALJAZEERA_SITE: FakeModel<S> = {
  id: 'site-aljazeera',
  label: 'Artigo',
  category: 'sites',
  group: 'Al Jazeera',
  hue: 'rgba(250,144,0,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Middle East',
    headline: 'Regional leaders convene for talks amid rising tensions',
    standfirst: 'Diplomats say the meeting aims to ease pressure as observers watch for a breakthrough.',
    nav: 'News, Middle East, Features, Economy, Opinion, Video, More',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="News, Middle East, Features" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <AlJazeeraPage s={s} />,
};

export default [ALJAZEERA_SITE];
