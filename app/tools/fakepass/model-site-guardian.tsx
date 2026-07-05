'use client';

/**
 * FakePass — SITE · The Guardian (página de artigo).
 * Masthead azul-marinho (#052962) com wordmark "The Guardian" em SERIF branco e
 * pill amarelo "Support us"; artigo com categoria azul, manchete em serif bold,
 * dek, byline, imagem-hero (com opção de tela verde) e corpo.
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
  SITE_SERIF,
  type SiteArticle,
} from './site-kit';

type S = SiteArticle & { nav: string };

const GUARDIAN_BLUE = '#052962';
const GUARDIAN_ACCENT = '#c70000';
const GUARDIAN_YELLOW = '#ffe500';

function GuardianWordmark() {
  return (
    <span
      style={{
        fontFamily: SITE_SERIF,
        fontWeight: 700,
        fontSize: 26,
        lineHeight: 1,
        color: '#ffffff',
        letterSpacing: -0.4,
        whiteSpace: 'nowrap',
      }}
    >
      The Guardian
    </span>
  );
}

function GuardianPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      {/* masthead azul-marinho com wordmark + pill amarelo */}
      <SiteNav
        logo={<GuardianWordmark />}
        bg={GUARDIAN_BLUE}
        color="#ffffff"
        border="#0a336f"
        height={64}
        right={
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: GUARDIAN_YELLOW,
              color: '#121212',
              fontWeight: 800,
              fontSize: 13.5,
              borderRadius: 999,
              padding: '7px 16px',
              whiteSpace: 'nowrap',
            }}
          >
            Support us
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        }
      />

      {/* nav clara sobre o azul */}
      <div
        style={{
          background: GUARDIAN_BLUE,
          color: '#ffffff',
          borderBottom: '1px solid #506081',
          padding: '0 18px',
          height: 38,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          fontSize: 14,
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
        <div style={{ color: GUARDIAN_ACCENT, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{s.category}</div>
        <div style={{ fontFamily: SITE_SERIF, fontWeight: 700, fontSize: 38, lineHeight: 1.1, letterSpacing: -0.4, color: '#121212' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontFamily: SITE_SERIF, fontSize: 20, lineHeight: 1.35, color: '#606060', marginTop: 14, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13.5, color: '#707070' }}>
          <span style={{ fontWeight: 700, color: '#121212' }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#767676', marginTop: 6 }}>Image caption</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 26px 0', fontSize: 17, lineHeight: 1.55, color: '#121212' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const GUARDIAN_SITE: FakeModel<S> = {
  id: 'site-guardian',
  label: 'Artigo',
  category: 'sites',
  group: 'The Guardian',
  hue: 'rgba(5,41,98,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'World news',
    headline: 'Ministers pledge new global measures after crisis talks',
    standfirst: 'Leaders gathered to address the developing situation as analysts weigh the likely impact on policy.',
    nav: 'News, Opinion, Sport, Culture, Lifestyle',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="News, Opinion, Sport" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <GuardianPage s={s} />,
};

export default [GUARDIAN_SITE];
