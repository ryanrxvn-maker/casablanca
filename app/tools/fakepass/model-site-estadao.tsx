'use client';

/**
 * FakePass — SITE · Estadão (O Estado de S. Paulo) — página de artigo.
 * Masthead branco com wordmark "Estadão" azul-marinho + nav; artigo com
 * categoria/acento azul-marinho, manchete em SERIF bold, dek, byline (autor +
 * hora), imagem-hero (com opção de tela verde) e corpo.
 * Recria o LAYOUT do portal; todo texto é placeholder editável (mockup/paródia).
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

const ESTADAO_BLUE = '#0a2b5e';

/** Wordmark "Estadão" recriado aproximado em azul-marinho. */
function EstadaoWordmark() {
  return (
    <span
      style={{
        fontFamily: SITE_SERIF,
        fontWeight: 800,
        fontSize: 27,
        lineHeight: 1,
        letterSpacing: -0.6,
        color: ESTADAO_BLUE,
      }}
    >
      Estad
      <span style={{ position: 'relative' }}>
        a
        {/* til aproximado do "ã" */}
        <span
          style={{
            position: 'absolute',
            top: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 15,
            lineHeight: 1,
          }}
        >
          ˜
        </span>
      </span>
      o
    </span>
  );
}

function EstadaoPage({ s }: { s: S }) {
  const { W } = siteMetrics();
  const heroH = Math.round(W * 0.5);
  const items = s.nav.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <SiteFrame>
      <SiteNav
        logo={<EstadaoWordmark />}
        items={items}
        bg="#ffffff"
        color="#1b2733"
        border="#e2e2e2"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
            <span
              style={{
                background: ESTADAO_BLUE,
                color: '#fff',
                borderRadius: 3,
                padding: '5px 12px',
              }}
            >
              Assine
            </span>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={ESTADAO_BLUE} strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
          </span>
        }
      />

      {/* cabeçalho do artigo */}
      <div style={{ padding: '22px 28px 0' }}>
        <div
          style={{
            color: ESTADAO_BLUE,
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          {s.category}
        </div>
        <div
          style={{
            fontFamily: SITE_SERIF,
            fontWeight: 700,
            fontSize: 36,
            lineHeight: 1.14,
            letterSpacing: -0.4,
            color: '#111820',
          }}
        >
          {s.headline}
        </div>
        {s.standfirst.trim() ? (
          <div style={{ fontFamily: SITE_SERIF, fontSize: 19, lineHeight: 1.4, color: '#3d4650', marginTop: 14, fontWeight: 400 }}>
            {s.standfirst}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid #ececec',
            fontSize: 13,
            color: '#6a7480',
          }}
        >
          <span style={{ fontWeight: 700, color: '#1b2733' }}>{s.author}</span>
          <span>•</span>
          <span>{s.time}</span>
        </div>
      </div>

      {/* imagem-hero */}
      <div style={{ padding: '18px 28px 0' }}>
        <HeroBox bg={s} w={W - 56} h={heroH} />
        <div style={{ fontSize: 12, color: '#8a929b', marginTop: 6, lineHeight: 1.35 }}>
          Legenda da imagem — Foto: Divulgação
        </div>
      </div>

      {/* corpo */}
      {s.body.trim() ? (
        <div style={{ padding: '16px 28px 0', fontFamily: SITE_SERIF, fontSize: 17.5, lineHeight: 1.6, color: '#26303a' }}>
          {s.body}
        </div>
      ) : null}
    </SiteFrame>
  );
}

const ESTADAO_SITE: FakeModel<S> = {
  id: 'site-estadao',
  label: 'Artigo',
  category: 'sites',
  group: 'Estadão',
  hue: 'rgba(10,43,94,0.4)',
  stageW: siteDims().stageW,
  ratio: siteDims().ratio,
  exportW: siteDims().exportW,
  usesPhone: false,
  defaultState: {
    ...defaultSiteArticle,
    category: 'Política',
    headline: 'Governo anuncia novo pacote de medidas para a economia',
    standfirst: 'Proposta será enviada ao Congresso nesta semana; analistas divergem sobre os efeitos no mercado.',
    author: 'Por Redação',
    time: 'há 2 horas',
    body: 'O anúncio ocorreu durante coletiva na manhã desta quinta-feira. Segundo fontes, as negociações devem continuar ao longo dos próximos dias, com novos detalhes ainda a serem divulgados.',
    nav: 'Política, Economia, Internacional, Esportes, Cultura, Opinião',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <SiteBgControls bg={s} set={set} />
      <Field label="Itens do menu (vírgula)">
        <TextField value={s.nav} onChange={(v) => set({ nav: v })} placeholder="Política, Economia, Esportes" maxLength={120} />
      </Field>
      <ArticleFields s={s} set={set} />
    </div>
  ),
  Preview: ({ s }) => <EstadaoPage s={s} />,
};

export default [ESTADAO_SITE];
