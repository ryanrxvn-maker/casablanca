'use client';

/**
 * FakePass — SITE · O Globo (página de artigo).
 * Masthead branco com wordmark "O GLOBO" em serif caixa-alta + nav de editorias;
 * artigo com categoria/acento azul, manchete serif bold, dek, byline com hora e
 * imagem-hero (com opção de tela verde) e corpo. Jornalão clássico.
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

const GLOBO_BLUE = '#0f4c81';

function GloboWordmark() {
  return (
    <span
      style={{
        fontFamily: SITE_SERIF,
        fontWeight: 800,
        fontSize: 26,
        lineHeight: 1,
        letterSpacing: 0.5,
        color: '#111111',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      O GLOBO
    </span>
  );
}

function GloboPage({ s }: { s: S }) {
  const { W } = siteMetrics(s.format);
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame format={s.format}>
      <SiteNav
        logo={<GloboWordmark />}
        items={items}
        bg="#ffffff"
        color="#222222"
        border="#d8d8d8"
        height={58}
        fontSize={13}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ background: GLOBO_BLUE, color: '#fff', borderRadius: 3, padding: '5px 12px' }}>Assine</span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#222" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          </span>
        }
      />

      {/* faixa fina de acento sob o masthead */}
      <div style={{ height: 3, background: GLOBO_BLUE, flexShrink: 0 }} />

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 30px 0' }}>
        <div style={{ color: GLOBO_BLUE, fontWeight: 800, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
          {s.category}
        </div>
        <div style={{ fontFamily: SITE_SERIF, fontWeight: 700, fontSize: 36, lineHeight: 1.14, letterSpacing: -0.3, color: '#111111' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontFamily: SITE_SERIF, fontSize: 19, lineHeight: 1.4, color: '#3a3a3a', marginTop: 14, fontWeight: 400 }}>
            {s.standfirst}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#6a6a6a', borderTop: '1px solid #e6e6e6', paddingTop: 12 }}>
          <span style={{ fontWeight: 700, color: '#111111' }}>{s.author}</span>
          <span>—</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '16px 30px 0' }}>
        <HeroBox bg={s} w={W - 60} h={heroH} />
        <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 6 }}>Legenda da imagem — Foto: Divulgação</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ fontFamily: SITE_SERIF, padding: '16px 30px 0', fontSize: 17.5, lineHeight: 1.55, color: '#1f1f1f' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const OGLOBO_SITE: FakeModel<S> = {
  id: 'site-oglobo',
  label: 'Artigo',
  category: 'sites',
  group: 'O Globo',
  hue: 'rgba(15,76,129,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  dims: (s) => siteDims(s.format),
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Política',
    headline: 'Governo anuncia novas medidas em reunião nesta semana',
    standfirst: 'Lideranças se reuniram para tratar da situação enquanto analistas avaliam os impactos esperados.',
    author: 'Por Redação',
    time: 'há 2 horas',
    body: 'Autoridades confirmaram que as conversas seguem ao longo da semana, com novos anúncios previstos. Observadores afirmam que o resultado pode orientar a política dos próximos meses.',
    nav: 'Política, Economia, Mundo, Rio, Esportes, Cultura',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Política, Economia, Mundo, Rio" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <GloboPage s={s} />,
};

export default [OGLOBO_SITE];
