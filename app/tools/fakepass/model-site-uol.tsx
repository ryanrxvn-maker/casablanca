'use client';

/**
 * FakePass — SITE · UOL (página de artigo).
 * Masthead claro com logo amarelo "UOL" + nav; artigo com categoria/acento
 * azul UOL, manchete sans bold preta, dek, byline, imagem-hero (com opção de
 * tela verde) e corpo. Recria o LAYOUT do portal; todo texto é placeholder editável.
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

const UOL_BLUE = '#0a5fd6';
const UOL_YELLOW = '#ffcc00';

function UolLogo() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        background: UOL_YELLOW,
        borderRadius: 9,
        color: '#000000',
        fontFamily: SITE_SANS,
        fontWeight: 800,
        fontSize: 17,
        lineHeight: 1,
        letterSpacing: -0.5,
        flexShrink: 0,
      }}
    >
      UOL
    </div>
  );
}

function UolPage({ s }: { s: S }) {
  const { W } = siteMetrics(s.format);
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame format={s.format}>
      <SiteNav
        logo={<UolLogo />}
        items={items}
        bg="#ffffff"
        color="#2a2a2a"
        border="#e2e2e2"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#2a2a2a' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <span style={{ background: UOL_BLUE, color: '#fff', borderRadius: 3, padding: '4px 10px' }}>Entrar</span>
          </span>
        }
      />

      {/* faixa de editorias azul */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 18px', height: 34, background: UOL_BLUE, color: '#ffffff', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {['Últimas', 'Coronavírus', 'Política', 'Loterias', 'Cursos'].map((it, i) => (
          <span key={i}>{it}</span>
        ))}
      </div>

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 26px 0' }}>
        <div style={{ color: UOL_BLUE, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>{s.category}</div>
        <div style={{ fontFamily: SITE_SANS, fontWeight: 800, fontSize: 33, lineHeight: 1.14, letterSpacing: -0.6, color: '#111111' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontSize: 17.5, lineHeight: 1.35, color: '#454545', marginTop: 12, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid #ececec', fontSize: 13, color: '#6a6a6a' }}>
          <span style={{ fontWeight: 700, color: UOL_BLUE }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '16px 26px 0' }}>
        <HeroBox bg={s} w={W - 52} h={heroH} />
        <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 6 }}>Imagem: Divulgação</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 26px 0', fontSize: 17, lineHeight: 1.55, color: '#1f1f1f' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const UOL_SITE: FakeModel<S> = {
  id: 'site-uol',
  label: 'Artigo',
  category: 'sites',
  group: 'UOL',
  hue: 'rgba(10,95,214,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  dims: (s) => siteDims(s.format),
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Economia',
    headline: 'Governo anuncia novo pacote de medidas para o setor',
    standfirst: 'Autoridades se reuniram para tratar da situação enquanto analistas avaliam o provável impacto.',
    author: 'Por Redação',
    time: 'há 2 horas',
    body: 'Segundo fontes, as negociações devem continuar ao longo da semana, com novos anúncios previstos. Observadores afirmam que o desfecho pode orientar a política dos próximos meses.',
    nav: 'Notícias, Economia, Esporte, Entretenimento, Carros, Tecnologia',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Notícias, Economia, Esporte" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <UolPage s={s} />,
};

export default [UOL_SITE];
