'use client';

/**
 * FakePass — SITE · g1 (Globo) — página de artigo.
 * Masthead branco com a caixinha vermelha "g1" + nav cinza; artigo com
 * categoria/acento vermelho, manchete SANS bold preta, byline "Por … — Cidade"
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

const G1_RED = '#c4170c';

/** Caixinha vermelha arredondada com "g1" branco bold minúsculo. */
function G1Logo() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 38,
        height: 30,
        background: G1_RED,
        borderRadius: 6,
        color: '#ffffff',
        fontFamily: SITE_SANS,
        fontWeight: 800,
        fontSize: 20,
        lineHeight: 1,
        letterSpacing: -1,
        flexShrink: 0,
      }}
    >
      g1
    </div>
  );
}

function G1Page({ s }: { s: S }) {
  const { W } = siteMetrics(s.format);
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame format={s.format}>
      <SiteNav
        logo={<G1Logo />}
        items={items}
        bg="#ffffff"
        color="#565656"
        border="#e0e0e0"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#565656" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#ffffff',
                background: G1_RED,
                borderRadius: 3,
                padding: '5px 12px',
              }}
            >
              Entrar
            </span>
          </span>
        }
      />

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 26px 0' }}>
        <div style={{ color: G1_RED, fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
          {s.category}
        </div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 34, lineHeight: 1.14, letterSpacing: -0.4, color: '#111111' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 18, lineHeight: 1.4, color: '#4a4a4a', marginTop: 12, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#767676' }}>
          <span style={{ fontWeight: 700, color: '#333333' }}>{s.author}</span>
          <span>—</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 6 }}>Legenda da foto — Reprodução</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 26px 0', fontSize: 17, lineHeight: 1.55, color: '#222' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const G1_SITE: FakeModel<S> = {
  id: 'site-g1',
  label: 'Artigo',
  category: 'sites',
  group: 'G1',
  hue: 'rgba(196,23,12,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  dims: (s) => siteDims(s.format),
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Economia',
    headline: 'Governo anuncia novas medidas para a economia nesta semana',
    standfirst: 'Autoridades detalharam o pacote em coletiva; analistas avaliam os possíveis efeitos nos próximos meses.',
    author: 'Por Redação',
    time: 'há 2 horas',
    body: 'Segundo comunicado oficial, as discussões seguem ao longo da semana, com novos anúncios previstos. Especialistas afirmam que o resultado pode influenciar as decisões dos próximos meses.',
    nav: 'g1, Globo, Política, Economia, Mundo, Tecnologia, Esporte',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="g1, Globo, Política, Economia" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <G1Page s={s} />,
};

export default [G1_SITE];
