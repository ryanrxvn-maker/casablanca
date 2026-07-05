'use client';

/**
 * FakePass — SITE · AP News (Associated Press) — página de artigo.
 * Masthead branco com logo AP (caixa vermelha "AP" + "Associated Press") e nav
 * preta; artigo minimalista com categoria vermelha, manchete SANS bold, dek,
 * byline, imagem-hero (com opção de tela verde) e corpo.
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

const AP_RED = '#ff322e';

/** Logo AP: caixa vermelha com "AP" branco bold + "Associated Press" ao lado. */
function ApLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 34,
          background: AP_RED,
          color: '#ffffff',
          fontFamily: SITE_SANS,
          fontWeight: 800,
          fontSize: 21,
          lineHeight: 1,
          letterSpacing: 0.5,
        }}
      >
        AP
      </div>
      <span
        style={{
          fontFamily: SITE_SANS,
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: 0.2,
          color: '#111111',
          whiteSpace: 'nowrap',
        }}
      >
        Associated Press
      </span>
    </div>
  );
}

function ApPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      <SiteNav
        logo={<ApLogo />}
        items={items}
        bg="#ffffff"
        color="#111111"
        border="#e2e2e2"
        height={56}
        fontSize={13}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#111111' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <span
              style={{
                background: AP_RED,
                color: '#ffffff',
                borderRadius: 2,
                padding: '5px 12px',
                fontSize: 12.5,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Donate
            </span>
          </span>
        }
      />

      {/* corpo do artigo */}
      <div style={{ padding: '22px 30px 0' }}>
        <div style={{ color: AP_RED, fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>{s.category}</div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 33, lineHeight: 1.14, letterSpacing: -0.4, color: '#111111' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.4, color: '#404040', marginTop: 13, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#6a6a6a' }}>
          <span style={{ fontWeight: 700, color: '#111111', textTransform: 'uppercase', letterSpacing: 0.3 }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 30px 0' }}>
        <HeroBox bg={s} w={W - 60} h={heroH} />
        <div style={{ fontSize: 12, color: '#767676', marginTop: 7, lineHeight: 1.4 }}>Image caption goes here. (AP Photo)</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 30px 0', fontSize: 17, lineHeight: 1.55, color: '#1a1a1a' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const AP_SITE: FakeModel<S> = {
  id: 'site-ap',
  label: 'Artigo',
  category: 'sites',
  group: 'AP News',
  hue: 'rgba(255,50,46,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'World News',
    headline: 'Officials outline new plan as global talks continue this week',
    standfirst: 'Representatives said the measures aim to address the situation, with further details expected in the coming days.',
    author: 'By Jordan Avery',
    nav: 'World, U.S., Politics, Business, Sports, Entertainment, Science, Health',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="World, U.S., Politics" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <ApPage s={s} />,
};

export default [AP_SITE];
