'use client';

/**
 * PREVIEW DEV-ONLY dos pedaços novos do ClickUp Pilot (29.08) — áudio por
 * avatar, indicações do copy e painel de reiniciar enriquecido.
 *
 * Existe pra ENXERGAR o design com dados reais-de-mentira sem precisar de
 * task no ClickUp nem de sessão do HeyGen. Não é linkada de lugar nenhum e
 * fora do dev responde 404.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';
import { RedispatchPanel, type RedispatchPart } from '@/components/RedispatchPanel';

const PARTES: RedispatchPart[] = [
  {
    label: 'HOOK 1',
    text: 'Como transformar um azeite de R$10 no seu próprio remédio de próstata em poucos minutos na sua cozinha.',
    avatarId: 'av1',
    avatarName: 'Confident Business Executive',
    voiceId: 'v1',
    voiceName: 'drromaoyoussef',
    role: 'Doutor',
    username: 'drrobertokalil 1',
    briefingFileId: null,
    indicacoes: ['AVATAR SEGURANDO O AZEITE NA MÃO', 'AMBIENTE DE COZINHA, LUZ QUENTE'],
    indicacoesCopy: [
      { trecho: 'Como transformar um azeite de R$10 no seu próprio remédio de próstata', nota: 'COMENTARIO DE TESTE, CENARIO X' },
    ],
  },
  {
    label: 'BODY 1',
    text: 'A maioria das pessoas usa azeite do jeito errado e joga fora justamente a parte que importa pra próstata.',
    avatarId: 'av1',
    avatarName: 'Confident Business Executive',
    voiceId: 'v1',
    voiceName: 'drromaoyoussef',
    audioKey: 'mock-audio-1',
    audioName: 'ELEVEN_body1.mp3',
    audioMirror: true,
    audioParte: true,
    role: 'Doutor',
    username: 'drrobertokalil 1',
    briefingFileId: null,
  },
  {
    label: 'BODY 2',
    text: 'Preparado assim, o composto que interessa é destruído pelo calor. Esse composto se chama oleocantal.',
    avatarId: 'av1',
    avatarName: 'Confident Business Executive',
    voiceId: 'v1',
    voiceName: 'drromaoyoussef',
    role: 'Doutor',
    username: 'drrobertokalil 1',
    briefingFileId: null,
  },
];

const TRECHOS_MOCK = [
  { tipo: 'trocado' as const, copy: 'menos de 10 reais', audio: 'menos de 20 reais' },
  { tipo: 'trocado' as const, copy: 'diminuir a próstata', audio: 'reduzir a próstata' },
  { tipo: 'faltou-no-audio' as const, copy: 'sem pílula e sem cortes' },
  { tipo: 'sobrou-no-audio' as const, audio: 'olha só' },
];

export default function PilotPreviewDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Conteudo />;
}

function Conteudo() {
  const [mirror, setMirror] = useState(false);
  const [engine, setEngine] = useState<'III' | 'IV' | 'V' | undefined>(undefined);
  const [diffAberto, setDiffAberto] = useState(false);
  const [indAberta, setIndAberta] = useState(false);
  const [indCopyAberta, setIndCopyAberta] = useState(false);
  const [comAudio, setComAudio] = useState(true);
  const motorAudio = engine || 'III';
  const dur = 145;
  const curto = dur <= 30;
  const takeUnicoAudio = motorAudio !== 'III' || curto;
  const partsCount = 7;
  const pct = 92;

  return (
    <main className="mx-auto grid max-w-[760px] gap-8 px-4 py-10">
      <h1 className="text-lg font-bold text-text">DEV · preview Pilot 29.08</h1>

      {/* ══════════ 1. CARD DE ÁUDIO DO AVATAR (mock do slot) ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="mono mb-2 flex items-center gap-2 text-[10px]">
          <span className="rounded-full bg-lime/18 border border-lime/40 px-2 py-[3px] text-lime uppercase tracking-widest font-bold">Doutor</span>
          <span className="text-text-muted">@drrobertokalil 1 · 7 partes</span>
          {/* botão AZUL: comentário no TEXTO (indicação de copy) */}
          <button
            type="button"
            onClick={() => setIndCopyAberta((v) => !v)}
            className={'pilot-ind-btn is-copy ml-auto shrink-0' + (indCopyAberta ? ' is-open' : '')}
            title="Comentário do copy no texto do AD (2) — clica pra ver o trecho e o take"
          >
            <span className="pilot-ind-halo" aria-hidden />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h.01M12 9h.01M16 9h.01" />
            </svg>
            <span className="pilot-ind-count">2</span>
          </button>
          {/* botão 3D de indicação de AVATAR (dourado) */}
          <button
            type="button"
            onClick={() => setIndAberta((v) => !v)}
            className={'pilot-ind-btn shrink-0' + (indAberta ? ' is-open' : '')}
            title="Indicação do copy pra este avatar (2) — clica pra ver"
          >
            <span className="pilot-ind-halo" aria-hidden />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m3 11 14-6v14L3 13v-2z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              <path d="M21 8.5c.7.8.7 5.2 0 6" />
            </svg>
            <span className="pilot-ind-count">2</span>
          </button>
        </div>

        {indCopyAberta ? (
          <div className="mb-2 rounded-[12px] border border-blue-400/40 bg-gradient-to-br from-blue-400/[0.10] via-blue-400/[0.04] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="mono mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-blue-500">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Comentário no texto · copy do Docs
            </div>
            <ul className="grid gap-1.5">
              {[
                { take: 'HOOK 1', trecho: 'Para próstata inchada, não existe nada melhor do que isso daqui.', nota: 'COMENTARIO DE TESTE, CENARIO X' },
                { take: 'BODY 2', trecho: 'Esse composto se chama oleocantal do azeite.', nota: 'Tela dividida aqui — b-roll do azeite escorrendo' },
              ].map((ind, k) => (
                <li key={k} className="rounded-[8px] border border-blue-400/30 bg-bg/60 px-2.5 py-2">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="mono shrink-0 rounded-full border border-blue-400/45 bg-blue-500/15 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-widest text-blue-500">
                      {ind.take}
                    </span>
                    <span className="min-w-0 text-[11px] italic leading-snug text-text-muted">“{ind.trecho}”</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-text">{ind.nota}</div>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 text-[10px] text-text-muted">É o comentário que o copy deixou nesse trecho da fala.</div>
          </div>
        ) : null}
        {indAberta ? (
          <div className="mb-2 rounded-[12px] border border-amber-400/40 bg-gradient-to-br from-amber-400/[0.10] via-amber-400/[0.04] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="mono mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-500">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m3 11 14-6v14L3 13v-2z" />
                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              </svg>
              Indicação do copy · comentário do Docs
            </div>
            <ul className="grid gap-1.5">
              {['AVATAR SEGURANDO O AZEITE NA MÃO', 'AMBIENTE DE COZINHA, LUZ QUENTE'].map((ind, k) => (
                <li key={k} className="rounded-[8px] border border-amber-400/30 bg-bg/60 px-2.5 py-2 text-[12px] leading-relaxed text-text">
                  {ind}
                </li>
              ))}
            </ul>
            <div className="mt-1.5 text-[10px] text-text-muted">
              É o que o copy pediu pra cena — usa pra escolher o avatar/look certo.
            </div>
          </div>
        ) : null}

        <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v4" />
          </svg>
          Áudio do avatar
        </div>

        {!comAudio ? (
          <label
            className="group/upaudio inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-bg-soft/70 px-4 py-2 text-[11.5px] font-semibold text-text transition hover:-translate-y-[1px] hover:border-cyan-500/60 hover:text-cyan-500 active:translate-y-[1px]"
            style={{ fontFamily: 'var(--font-tech)' }}
            onClick={() => setComAudio(true)}
          >
            ⬆ Colocar áudio
          </label>
        ) : (
          <div className="rounded-[14px] border border-line bg-bg-soft/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2.5">
              <span className="dark-island flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: 'linear-gradient(150deg, #22d3ee 0%, #0891b2 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 14px -8px rgba(8,145,178,0.9)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold leading-tight text-text" style={{ fontFamily: 'var(--font-tech)' }}>
                  ELEVEN_voz_sp118_s58_sb75_AD02.mp3
                </div>
                <div className="mt-0.5 text-[10.5px] leading-tight text-text-muted">
                  {Math.round(dur)}s ·{' '}
                  {takeUnicoAudio
                    ? (curto && motorAudio === 'III' ? 'até 30s: vai inteiro, sem dividir' : `Avatar ${motorAudio}: vai inteiro num take único`)
                    : `divido em ${partsCount} takes pelas pausas, sem cortar fala`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {(['III', 'IV', 'V'] as const).map((op) => {
                  const sel = engine === op;
                  const aceso = sel || (!engine && motorAudio === op);
                  return (
                    <button
                      key={op}
                      type="button"
                      onClick={() => setEngine(sel ? undefined : op)}
                      className={
                        'mono rounded-full border px-2 py-[2px] text-[8.5px] font-bold uppercase tracking-widest transition ' +
                        (aceso
                          ? 'border-violet-500/70 bg-violet-600 text-white shadow-[0_2px_8px_-2px_rgba(124,92,246,0.7)]'
                          : 'border-line bg-bg-soft/50 text-text-muted hover:border-violet-400/50')
                      }
                    >
                      {op}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setComAudio(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-text-muted transition hover:rotate-90 hover:border-red-500/60 hover:text-red-500"
                title="Tirar o áudio"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-bold text-red-500">Áudio {pct}% igual à copy</span>
              <button
                type="button"
                onClick={() => setDiffAberto((v) => !v)}
                className={
                  'flex h-7 w-7 items-center justify-center rounded-full border transition hover:-translate-y-[1px] active:translate-y-[1px] ' +
                  (diffAberto
                    ? 'border-red-500/70 bg-red-500 text-white shadow-[0_4px_12px_-4px_rgba(239,68,68,0.7)]'
                    : 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20')
                }
                title="Ver o que está diferente da copy"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
              </button>
              <span className="text-[10.5px] text-text-muted">dá pra disparar mesmo assim</span>
            </div>

            {diffAberto ? (
              <div className="mt-2.5 overflow-hidden rounded-[10px] border border-line">
                <div className="grid grid-cols-2 bg-bg/70 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  <div className="px-3 py-1.5">O que a copy diz</div>
                  <div className="border-l border-line px-3 py-1.5">O que o áudio fala</div>
                </div>
                {TRECHOS_MOCK.map((t, k) => (
                  <div key={k} className="grid grid-cols-2 border-t border-line">
                    <div className="px-3 py-2 text-[12px] leading-relaxed text-text">
                      {t.copy ? t.copy : <span className="italic text-text-muted">— (não está na copy)</span>}
                    </div>
                    <div className="border-l border-line px-3 py-2 text-[12px] font-medium leading-relaxed text-red-500">
                      {t.audio ? t.audio : <span className="italic opacity-70">— (não falou)</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <button
                type="button"
                onClick={() => setMirror((v) => !v)}
                className={
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] transition hover:-translate-y-[1px] active:translate-y-[1px] ' +
                  (mirror ? 'border-cyan-500/60 text-[#04252b]' : 'border-line-strong bg-bg-soft/70 text-text-muted hover:text-text')
                }
                style={
                  mirror
                    ? { fontFamily: 'var(--font-tech)', background: 'linear-gradient(135deg, #67e8f9 0%, #22d3ee 100%)', boxShadow: '0 3px 0 rgba(0,0,0,0.25), 0 0 18px -6px rgba(34,211,238,0.7), inset 0 1px 0 rgba(255,255,255,0.5)' }
                    : { fontFamily: 'var(--font-tech)' }
                }
              >
                Voice Mirror
                <span className={'rounded-full px-1.5 py-[1px] text-[8.5px] tracking-widest ' + (mirror ? 'bg-black/20 text-black/75' : 'bg-bg/60 text-text-muted')}>
                  {mirror ? 'ON' : 'OFF'}
                </span>
              </button>
              <span className="text-[10.5px] text-text-muted">
                {mirror ? 'sai na voz selecionada, com a cadência do arquivo' : 'a voz do take é a do próprio áudio'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ══════════ 2. PAINEL DE REINICIAR (componente REAL) ══════════ */}
      <RedispatchPanel
        taskName="AD02GL - PRPB12"
        adName="AD02GL"
        partesOriginais={PARTES}
        resolverAvatar={() => null}
        onCancel={() => {}}
        onReiniciar={() => {}}
        salvarAudioTake={async () => `mock-${Date.now()}`}
        analisarAudioTake={() => {}}
        audioInfo={{ 'mock-audio-1': { status: 'divergente', resumo: 'Áudio ≠ copy: 2 trechos diferentes (92% igual).' } }}
      />
    </main>
  );
}
