'use client';

/**
 * FakePass — NOTÍCIAS · CBS (EUA).
 * Dois templates fiéis às capturas reais:
 *  • NACIONAL (streaming): caixa BRANCA com o olho + "CBS NEWS" no canto
 *    inferior esquerdo, tag vermelha "● LIVE" em cima dela, "cbsnews.com"
 *    discreto e a faixa BRANCA de rodapé com os dois triângulos pretos
 *    ("CBS MORNINGS: STREAMING WEEKDAYS @ 8 AM"). Manchete é OPCIONAL
 *    (vazia = visual limpo de bancada, igual às referências).
 *  • LOCAL · NEW YORK: bloco azul-marinho com o círculo do "2" + olho +
 *    "CBS NEWS / NEW YORK", barra azul com os NOMES dos âncoras, e a faixa
 *    preta de rodapé com temperatura + hora + "HEADLINES" + manchete corrida.
 */

import { Field, TextField, TextArea, FitText, type FakeModel } from './shared';
import {
  NewsStage,
  NewsBgControls,
  newsDims,
  stageMetrics,
  parseItems,
  defaultNewsBg,
  type NewsBg,
} from './news-kit';

/* ─────────────────────────── Olho da CBS ─────────────────────────── */

/** O olho clássico: amêndoa + círculo + pupila. `hole` = cor do fundo onde o
 *  olho está (o anel entre círculo e pupila mostra essa cor). */
function CbsEye({ h, color, hole }: { h: number; color: string; hole: string }) {
  return (
    <svg width={h * 1.62} height={h} viewBox="0 0 100 60" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path d="M50 1.5 C 71.5 1.5 88.5 13.5 98.5 30 C 88.5 46.5 71.5 58.5 50 58.5 C 28.5 58.5 11.5 46.5 1.5 30 C 11.5 13.5 28.5 1.5 50 1.5 Z" fill={color} />
      <circle cx="50" cy="30" r="20.5" fill={hole} />
      <circle cx="50" cy="30" r="13" fill={color} />
    </svg>
  );
}

/** Dois triângulos "▶▶" da faixa de programação (desenhados, sem emoji). */
function PlayChevrons({ k, color }: { k: number; color: string }) {
  const s = 9 * k;
  const tri = (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden style={{ display: 'block' }}>
      <path d="M1 0 L9 5 L1 10 Z" fill={color} />
    </svg>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 * k, flexShrink: 0 }}>
      {tri}
      {tri}
    </span>
  );
}

/* ═════════════════════ CBS NEWS · NACIONAL (streaming) ═════════════════════ */

type SNat = NewsBg & {
  live: string;
  site: string;
  kicker: string;
  headline: string;
  ticker: string;
};

const CBS_RED = '#ea0a2a';

function CbsNatChyron({ s }: { s: SNat }) {
  const { k } = stageMetrics(s.orient);
  const temManchete = s.kicker.trim() !== '' || s.headline.trim() !== '';
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      {/* bloco do logo: LIVE em cima da caixa branca CBS NEWS */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 18 * k, marginBottom: temManchete ? 4 * k : 8 * k }}>
        {s.live.trim() ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5 * k,
              background: CBS_RED,
              color: '#fff',
              fontWeight: 800,
              fontSize: 11.5 * k,
              letterSpacing: 1.2 * k,
              padding: `${3.5 * k}px ${8 * k}px`,
              lineHeight: 1,
            }}
          >
            <span data-fp-anim="livedot" style={{ width: 6.5 * k, height: 6.5 * k, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
            {s.live}
          </span>
        ) : null}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7 * k,
            background: '#ffffff',
            padding: `${6 * k}px ${11 * k}px`,
            lineHeight: 1,
          }}
        >
          <CbsEye h={15 * k} color="#000" hole="#ffffff" />
          <span style={{ color: '#000', fontWeight: 900, fontSize: 15 * k, letterSpacing: 0.4 * k, whiteSpace: 'nowrap' }}>CBS NEWS</span>
        </span>
      </div>

      {/* manchete OPCIONAL (faixa branca com kicker vermelho, estilo streaming) */}
      {temManchete ? (
        <div style={{ background: '#ffffff', padding: `${6 * k}px ${18 * k}px ${7 * k}px`, minHeight: 34 * k, boxSizing: 'border-box' }}>
          {s.kicker.trim() ? (
            <div style={{ color: CBS_RED, fontWeight: 800, fontSize: 11 * k, letterSpacing: 1 * k, textTransform: 'uppercase', lineHeight: 1.2, marginBottom: 2 * k }}>
              {s.kicker}
            </div>
          ) : null}
          {s.headline.trim() ? (
            <FitText maxPx={21 * k} minPx={11 * k} maxHeight={46 * k} style={{ color: '#0a0a0a', fontWeight: 800, lineHeight: 1.08, textTransform: 'uppercase', letterSpacing: -0.2 * k }}>
              {s.headline}
            </FitText>
          ) : null}
        </div>
      ) : null}

      {/* cbsnews.com discreto, colado na faixa */}
      {s.site.trim() ? (
        <div style={{ paddingLeft: 8 * k, marginBottom: 3 * k }}>
          <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 10.5 * k, letterSpacing: 0.3 * k, textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{s.site}</span>
        </div>
      ) : null}

      {/* faixa branca de rodapé: ▶▶ + programação */}
      {s.ticker.trim() ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 * k, height: 24 * k, background: '#ffffff', padding: `0 ${10 * k}px`, overflow: 'hidden' }}>
          <PlayChevrons k={k} color="#000" />
          <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 14 * k, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {parseItems(s.ticker).map((it, i) => (
              <span key={i} style={{ color: '#000', fontWeight: 800, fontSize: 11.5 * k, letterSpacing: 0.5 * k, textTransform: 'uppercase' }}>
                {it}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CBS_NAT: FakeModel<SNat> = {
  id: 'news-cbs',
  label: 'Nacional / Streaming',
  category: 'news',
  group: 'CBS News',
  hue: 'rgba(234,10,42,0.4)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    live: 'LIVE',
    site: 'cbsnews.com',
    kicker: '',
    headline: '',
    ticker: 'CBS MORNINGS: STREAMING WEEKDAYS @ 8 AM',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="LIVE (tag vermelha)"><TextField value={s.live} onChange={(v) => set({ live: v })} placeholder="LIVE" maxLength={12} /></Field>
        <Field label="Site (canto)"><TextField value={s.site} onChange={(v) => set({ site: v })} placeholder="cbsnews.com" maxLength={30} /></Field>
      </div>
      <Field label="Assunto (kicker vermelho)" hint="Opcional — vazio deixa o visual limpo de bancada."><TextField value={s.kicker} onChange={(v) => set({ kicker: v })} placeholder="EYE ON AMERICA" maxLength={48} /></Field>
      <Field label="Manchete" hint="Opcional — aparece na faixa branca acima do rodapé."><TextArea value={s.headline} onChange={(v) => set({ headline: v })} placeholder="Manchete principal" rows={2} maxLength={140} /></Field>
      <Field label="Faixa de rodapé (▶▶)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="CBS MORNINGS: STREAMING WEEKDAYS @ 8 AM" rows={2} maxLength={200} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <CbsNatChyron s={s} />
    </NewsStage>
  ),
};

/* ═════════════════════ CBS NEWS · LOCAL (New York) ═════════════════════ */

type SNy = NewsBg & {
  numero: string;
  cidade: string;
  nomes: string;
  temp: string;
  hora: string;
  tickerLabel: string;
  ticker: string;
};

const NY_NAVY = '#0b1e5b';

function CbsNyChyron({ s }: { s: SNy }) {
  const { k } = stageMetrics(s.orient);
  const nomes = parseItems(s.nomes);
  const tickerItens = parseItems(s.ticker);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      {/* barra dos âncoras: bloco do logo à esquerda + nomes na faixa azul */}
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 40 * k }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7 * k,
            background: NY_NAVY,
            padding: `${5 * k}px ${12 * k}px`,
            flexShrink: 0,
            borderRight: `${1 * k}px solid rgba(255,255,255,0.22)`,
          }}
        >
          {s.numero.trim() ? (
            <span
              style={{
                width: 23 * k,
                height: 23 * k,
                borderRadius: '50%',
                border: `${1.8 * k}px solid #fff`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 900,
                fontSize: 13.5 * k,
                lineHeight: 1,
                flexShrink: 0,
                boxSizing: 'border-box',
              }}
            >
              {s.numero}
            </span>
          ) : null}
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1.5 * k }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4.5 * k }}>
              <CbsEye h={10.5 * k} color="#fff" hole={NY_NAVY} />
              <span style={{ color: '#fff', fontWeight: 900, fontSize: 11.5 * k, letterSpacing: 0.4 * k, whiteSpace: 'nowrap', lineHeight: 1 }}>CBS NEWS</span>
            </span>
            <span style={{ color: '#d9e1fb', fontWeight: 700, fontSize: 8.5 * k, letterSpacing: 2.6 * k, whiteSpace: 'nowrap', lineHeight: 1 }}>{s.cidade}</span>
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            gap: 10 * k,
            background: 'linear-gradient(180deg, #16308f 0%, #0c1f63 100%)',
            padding: `0 ${14 * k}px`,
            overflow: 'hidden',
          }}
        >
          {nomes.map((n, i) => (
            <span key={i} style={{ color: '#fff', fontWeight: 800, fontSize: 14.5 * k, letterSpacing: 1.1 * k, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n}
            </span>
          ))}
        </div>
      </div>

      {/* faixa preta: temperatura + hora + HEADLINES + manchete corrida */}
      <div style={{ display: 'flex', alignItems: 'stretch', height: 25 * k, background: '#0b0c10', overflow: 'hidden' }}>
        {(s.temp.trim() || s.hora.trim()) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, background: '#181a22', padding: `0 ${10 * k}px`, flexShrink: 0 }}>
            {s.temp.trim() ? (
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 11.5 * k, lineHeight: 1 }}>{s.temp}</span>
            ) : null}
            {s.temp.trim() && s.hora.trim() ? (
              <span style={{ width: 1 * k, height: 12 * k, background: 'rgba(255,255,255,0.3)', display: 'inline-block' }} />
            ) : null}
            {s.hora.trim() ? (
              <span data-fp-anim="clock" style={{ color: '#fff', fontWeight: 700, fontSize: 11.5 * k, lineHeight: 1 }}>{s.hora}</span>
            ) : null}
          </div>
        ) : null}
        {s.tickerLabel.trim() ? (
          <div style={{ display: 'flex', alignItems: 'center', background: '#23262f', padding: `0 ${10 * k}px`, flexShrink: 0 }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 10.5 * k, letterSpacing: 1 * k, lineHeight: 1 }}>{s.tickerLabel}</span>
          </div>
        ) : null}
        <div data-fp-anim="ticker" style={{ display: 'flex', alignItems: 'center', gap: 16 * k, flex: 1, minWidth: 0, padding: `0 ${12 * k}px`, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {tickerItens.map((it, i) => (
            <span key={i} style={{ color: '#fff', fontWeight: 700, fontSize: 11 * k, letterSpacing: 0.4 * k, textTransform: 'uppercase' }}>
              {it}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const CBS_NY: FakeModel<SNy> = {
  id: 'news-cbs-ny',
  label: 'Local · New York',
  category: 'news',
  group: 'CBS News',
  hue: 'rgba(22,48,143,0.45)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  anim: true,
  dims: (s) => newsDims(s.orient),
  defaultState: {
    ...defaultNewsBg,
    numero: '2',
    cidade: 'NEW YORK',
    nomes: 'ALICE GAINER | ALLEN DEVLIN',
    temp: '56°',
    hora: '4:59 PM',
    tickerLabel: 'HEADLINES',
    ticker: "DOJ SAYS IT WILL STOP WORK ON $1.8 BILLION 'ANTI-WEAPONIZATION FUND'",
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <NewsBgControls bg={s} set={set} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número do canal"><TextField value={s.numero} onChange={(v) => set({ numero: v })} placeholder="2" maxLength={3} /></Field>
        <Field label="Cidade"><TextField value={s.cidade} onChange={(v) => set({ cidade: v })} placeholder="NEW YORK" maxLength={20} /></Field>
      </div>
      <Field label="Nomes na faixa azul (separe por |)" hint="1 nome = manchete única; 2+ nomes = âncoras lado a lado."><TextField value={s.nomes} onChange={(v) => set({ nomes: v })} placeholder="ALICE GAINER | ALLEN DEVLIN" maxLength={90} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperatura"><TextField value={s.temp} onChange={(v) => set({ temp: v })} placeholder="56°" maxLength={8} /></Field>
        <Field label="Hora"><TextField value={s.hora} onChange={(v) => set({ hora: v })} placeholder="4:59 PM" maxLength={12} /></Field>
      </div>
      <Field label="Etiqueta do rodapé"><TextField value={s.tickerLabel} onChange={(v) => set({ tickerLabel: v })} placeholder="HEADLINES" maxLength={20} /></Field>
      <Field label="Manchete do rodapé (um por linha ou |)"><TextArea value={s.ticker} onChange={(v) => set({ ticker: v })} placeholder="Manchete 1 | Manchete 2" rows={2} maxLength={220} /></Field>
    </div>
  ),
  Preview: ({ s }) => (
    <NewsStage bg={s}>
      <CbsNyChyron s={s} />
    </NewsStage>
  ),
};

export default [CBS_NAT, CBS_NY];
