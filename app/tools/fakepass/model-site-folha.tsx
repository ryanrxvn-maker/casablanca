'use client';

/**
 * FakePass — SITE · Folha de S.Paulo (página de artigo).
 * Masthead branco com wordmark serif preto + fina linha; nav sóbrio (Opinião,
 * Política, Mundo, Economia…); artigo com categoria/acento azul, manchete em
 * SERIF bold, dek, byline com autor + local/hora, imagem-hero (com opção de
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
  SITE_SERIF,
  type SiteArticle,
} from './site-kit';

type S = SiteArticle & { nav: string };

/** Acento da Folha: azul institucional. */
const FOLHA_BLUE = '#0a4b8c';

/** Wordmark "Folha de S.Paulo" recriado aproximado em serif preto. */
function FolhaWordmark() {
  return (
    <span
      style={{
        fontFamily: SITE_SERIF,
        fontWeight: 700,
        fontSize: 25,
        lineHeight: 1,
        letterSpacing: -0.4,
        color: '#111111',
        whiteSpace: 'nowrap',
      }}
    >
      Folha de S.Paulo
    </span>
  );
}

function FolhaPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      {/* masthead branco com wordmark serif */}
      <SiteNav
        logo={<FolhaWordmark />}
        bg="#ffffff"
        color="#111111"
        border="#e2e2e2"
        height={58}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: FOLHA_BLUE }}>
            <span>Assine</span>
            <span style={{ border: `1px solid ${FOLHA_BLUE}`, borderRadius: 2, padding: '4px 10px', color: FOLHA_BLUE }}>Entrar</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={FOLHA_BLUE} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          </span>
        }
      />

      {/* fina barra de navegação secundária (editorias) */}
      {items.length ? (
        <div
          style={{
            display: 'flex',
            gap: 18,
            padding: '9px 18px',
            fontFamily: SITE_SANS,
            fontSize: 13,
            fontWeight: 700,
            color: '#333',
            borderBottom: '1px solid #ececec',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {items.map((it, i) => (
            <span key={i} style={i === 0 ? { color: FOLHA_BLUE } : undefined}>{it}</span>
          ))}
        </div>
      ) : null}

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 30px 0' }}>
        <div style={{ fontFamily: SITE_SANS, color: FOLHA_BLUE, fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>
          {s.category}
        </div>
        <div style={{ fontFamily: SITE_SERIF, fontWeight: 700, fontSize: 36, lineHeight: 1.14, letterSpacing: -0.4, color: '#111111' }}>
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontFamily: SITE_SERIF, fontSize: 19, lineHeight: 1.4, color: '#3a3a3a', marginTop: 14, fontWeight: 400 }}>{s.standfirst}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontFamily: SITE_SANS, fontSize: 12.5, color: '#6a6a6a', borderTop: '1px solid #ececec', paddingTop: 12 }}>
          <span style={{ fontWeight: 700, color: '#111111' }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 30px 0' }}>
        <HeroBox bg={s} w={W - 60} h={heroH} />
        <div style={{ fontFamily: SITE_SANS, fontSize: 12, color: '#8a8a8a', marginTop: 7 }}>Legenda da imagem — Divulgação/Folhapress</div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 30px 0', fontFamily: SITE_SERIF, fontSize: 18, lineHeight: 1.55, color: '#222' }}>{s.body}</div>
      ) : null}
    </SiteFrame>
  );
}

const FOLHA_SITE: FakeModel<S> = {
  id: 'site-folha',
  label: 'Artigo',
  category: 'sites',
  group: 'Folha',
  hue: 'rgba(10,75,140,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Mundo',
    headline: 'Governos se reúnem para discutir novas medidas globais',
    standfirst: 'Líderes se reuniram para tratar da situação em desenvolvimento enquanto analistas avaliam o provável impacto.',
    author: 'Por Redação',
    time: 'São Paulo · há 2 horas',
    body: 'Autoridades confirmaram que as conversas devem seguir ao longo da semana, com novos comunicados esperados. Observadores afirmaram que o desfecho pode moldar a política nos próximos meses.',
    nav: 'Opinião, Política, Mundo, Economia, Cotidiano, Esporte, Cultura',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)"><TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Opinião, Política, Mundo" maxLength={120} /></Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <FolhaPage s={s} />,
};

export default [FOLHA_SITE];
