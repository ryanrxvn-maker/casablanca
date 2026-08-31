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
import { IndicacaoPanel } from '@/components/IndicacaoPanel';
import { resolverLinkIndicacao } from '@/lib/pilot-indicacoes';
import { EditPartModal } from '@/components/EditPartModal';
import { MotorConfigPicker } from '@/components/MotorConfigPicker';
import type { Motor, MotorConfig } from '@/lib/motor-config';
import { FrameDaVersao } from '@/components/FrameDaVersao';
import { VersoesDoDisparo, type VersaoNoCard } from '@/components/VersoesDoDisparo';
import { MAX_VERSOES, mapearVersoesDoDoc } from '@/lib/versoes-ad';

const FRAME_FAKE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#3b1d5e"/><circle cx="45" cy="58" r="22" fill="#c4b5fd"/><rect x="18" y="88" width="54" height="60" rx="14" fill="#a78bfa"/></svg>');

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
    indicacoes: [
      { nota: 'AVATAR SEGURANDO O AZEITE NA MÃO', links: [resolverLinkIndicacao('https://youtu.be/dQw4w9WgXcQ')] },
      { nota: 'AMBIENTE DE COZINHA, LUZ QUENTE', links: [resolverLinkIndicacao('https://www.tiktok.com/@fulano/video/7300000000')] },
    ],
    indicacoesCopy: [
      { trecho: 'Como transformar um azeite de R$10 no seu próprio remédio de próstata', nota: 'COMENTARIO DE TESTE, CENARIO X' },
    ],
  },
  {
    label: 'BODY 1',
    text: 'A maioria das pessoas usa azeite do jeito errado e joga fora justamente a parte que importa pra próstata.',
    motionPrompt: 'despeja o azeite na colher no comeco e segue falando',
    avatarId: 'av1',
    avatarName: 'Confident Business Executive',
    voiceId: 'v1',
    voiceName: 'drromaoyoussef',
    audioKey: 'mock-audio-1',
    audioName: 'ELEVEN_body1.mp3',
    audioMirror: true,
    audioParte: true,
    indicacoesCopy: [{ trecho: 'A maioria das pessoas usa azeite do jeito errado.', nota: 'Tela dividida aqui — b-roll do azeite escorrendo', links: [resolverLinkIndicacao('https://drive.google.com/file/d/1eyJoDa-rfD8IsnPM__qCBjfUc8hzdDhn/view')] }],
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
  const [verPicker, setVerPicker] = useState(false);
  const [totalVersoes, setTotalVersoes] = useState(3);
  const mapaDemo = mapearVersoesDoDoc(
    ['Meta Ads:', 'Doutor: drrobertokalil 1.mp4', 'Youtube Ads / Kwai Ads:', 'Doutor: joshuagonzalezmd.mp4'].join(String.fromCharCode(10)),
  );
  const [versoesDemo, setVersoesDemo] = useState<VersaoNoCard[]>([
    { taskId: 't1', n: 1, nome: 'AD03GL - PRPB12 · META · @drrobertokalil', fase: 'done', pronta: true, atual: true, prontos: 8, total: 8 },
    { taskId: 't1-yt', n: 2, nome: 'AD03GL - PRPB12 · YouTube · @joshuagonzalezmd', fase: 'rendering', prontos: 5, total: 8 },
    { taskId: 't1-v3', n: 3, nome: 'AD03GL - PRPB12 · Avatar 3 · @tiagorochaog', fase: 'queued', prontos: 0, total: 8 },
  ]);
  const [modalAberto, setModalAberto] = useState(false);
  const [motorCfg, setMotorCfg] = useState<MotorConfig>({ kind: 'individual', perSlot: {} });
  const [slotsDemo, setSlotsDemo] = useState([
    { id: '0', nome: 'Confident Business Executive', thumb: null as string | null, motor: 'III' as Motor, motionPrompt: null as string | null, imageMode: false },
    { id: '1', nome: 'Dra. Marina', thumb: null as string | null, motor: 'IV' as Motor, motionPrompt: 'mexe a gelatina', imageMode: false },
  ]);
  const [frameYt, setFrameYt] = useState<string | null>(FRAME_FAKE);
  const [gestoDemo, setGestoDemo] = useState('mexe a gelatina 2x no começo e segue falando');
  const motorAudio: 'III' | 'IV' | 'V' = (engine || 'III') === 'III' && gestoDemo ? 'IV' : (engine || 'III');
  const dur = 145;
  const curto = dur <= 30;
  const takeUnicoAudio = motorAudio !== 'III' || curto;
  const partsCount = 7;
  const pct = 92;

  return (
    <main className="mx-auto grid max-w-[760px] gap-8 px-4 py-10">
      <h1 className="text-lg font-bold text-text">DEV · preview Pilot 29.08</h1>

      {/* ══════════ 0. VERSOES (1..10) ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label-tech text-[9.5px] tracking-[0.18em] text-text-muted">
            Avatares (1) — selecione cada um e a voz
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setVerPicker((v) => !v)}
              className="group inline-flex items-center gap-2 rounded-[12px] border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all duration-200 hover:-translate-y-[1px] active:translate-y-[1px]"
              style={
                totalVersoes > 1
                  ? { fontFamily: 'var(--font-tech)', color: '#1a0505', borderColor: 'rgba(255,0,0,0.5)', background: 'linear-gradient(135deg, #ff6b6b 0%, #ff0000 100%)', boxShadow: '0 3px 0 rgba(0,0,0,0.35), 0 0 20px -6px rgba(255,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2)' }
                  : { fontFamily: 'var(--font-tech)', color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.12)', background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)', boxShadow: '0 2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)' }
              }
            >
              <span className="text-[12px] leading-none">+</span>
              versões
              <span className={'rounded-full px-1.5 py-[1px] text-[8.5px] tracking-widest ' + (totalVersoes > 1 ? 'bg-black/25 text-black/80' : 'bg-white/8 text-text-muted')}>
                {totalVersoes}
              </span>
            </button>
            {verPicker ? (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setVerPicker(false)} aria-hidden />
                <div className="vp-pop absolute right-0 top-full z-40 mt-2">
                  <div className="vp-titulo">Quantas versões deste AD</div>
                  <div className="vp-grade">
                    {Array.from({ length: MAX_VERSOES }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" onClick={() => setTotalVersoes(n)} className={'vp-num' + (n === totalVersoes ? ' is-on' : '')}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="vp-doc">
                    <span className="vp-doc-tag">indicador do docs</span>
                    <span className="vp-doc-txt">{mapaDemo.motivo}</span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-text-muted">botão de versões do card do disparo:</span>
          <VersoesDoDisparo
            versoes={versoesDemo}
            onBaixar={() => {}}
            onTrocar={(v) => setVersoesDemo((prev) => prev.map((x) => ({ ...x, atual: x.taskId === v.taskId })))}
            onRenomear={(v, nome) => setVersoesDemo((prev) => prev.map((x) => (x.taskId === v.taskId ? { ...x, nome } : x)))}
          />
        </div>
      </section>


      {/* ══════════ 0.45 EDITAR TAKE (caixa do gesto acesa) ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="rounded-[10px] border border-line px-3 py-1.5 text-[11px] text-text hover:border-white/30"
        >
          abrir o modal de editar take
        </button>
      </section>
      {modalAberto ? (
        <EditPartModal
          input={{
            label: 'BODY 1',
            text: 'A maioria das pessoas usa azeite do jeito errado.',
            avatarName: 'Confident Business Executive',
            voiceId: 'v1',
            voiceName: 'drromaoyoussef',
            engine: 'III',
            motionPrompt: 'despeja o azeite na colher no comeco e segue falando',
          }}
          onClose={() => setModalAberto(false)}
          onRegenerate={() => setModalAberto(false)}
        />
      ) : null}

      {/* ══════════ 0.3 MOTOR POR AVATAR (lista ao vivo) ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="label-tech mb-2 text-[9.5px] tracking-[0.18em] text-text-muted">Motor — modo &ldquo;Por avatar&rdquo;</div>
        <MotorConfigPicker
          config={motorCfg}
          setConfig={setMotorCfg}
          takeCount={8}
          avatarSlots={slotsDemo}
          setAvatarMotor={(id, m) => setSlotsDemo((prev) => prev.map((x) => (x.id === id ? { ...x, motor: m } : x)))}
        />
        <button
          type="button"
          onClick={() =>
            setSlotsDemo((prev) => [
              ...prev,
              { id: String(prev.length), nome: `Avatar ${prev.length + 1}`, thumb: null, motor: 'III' as const, motionPrompt: null, imageMode: false },
            ])
          }
          className="trecho-add mt-2"
        >
          <span aria-hidden>+</span>
          adicionar avatar (testa o ao vivo)
        </button>
      </section>

      {/* ══════════ 0.35 CARD DO PLANO DE CENAS ══════════ */}
      <div className="plano-shell rounded-[18px] p-[5px]">
        <div className="plano-core group/plano rounded-[13px] p-3">
          <div className="flex w-full items-center gap-3 text-left">
            <span className="plano-tile dark-island flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-tight text-text" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}>
                Carregar plano de cenas
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-text-muted">
                Monta avatar, voz e movimento de todas as cenas de uma vez.
              </span>
            </span>
            <span className="plano-marca hidden shrink-0 sm:inline-flex">3 cenas</span>
            <span className="plano-chevron flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </div>
          <div className="plano-corpo relative mt-3 grid gap-2">
            <textarea
              defaultValue={'{"AD37":[{"cena":"AD37_1","n":1,"avatarId":"abc"}]}'}
              rows={4}
              className="plano-input w-full resize-y rounded-[10px] px-3 py-2.5 font-mono text-[11px] leading-snug text-text outline-none"
            />
            <div>
              <div className="label-tech mb-1 text-[9px] uppercase tracking-[0.16em] text-text-muted">
                Frames das cenas em modo imagem (opcional — só as bloqueadas)
              </div>
              <input type="file" multiple className="plano-file block w-full text-[10.5px] text-text-muted" />
              <div className="mono plano-acento mt-1 text-[9.5px]">2 frame(s): AD37_1, AD37_2</div>
            </div>
            <button type="button" className="plano-cta dark-island inline-flex justify-self-start self-start items-center gap-2.5 rounded-full py-1.5 pl-5 pr-1.5 text-[12px] font-semibold text-white">
              Aplicar plano
              <span className="plano-cta-icone flex h-7 w-7 items-center justify-center rounded-full">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </span>
            </button>
            <div className="plano-relato rounded-[8px] p-2 text-[10.5px] leading-relaxed text-text-muted">
              <div>AD37_1 → HOOK 1</div>
              <div className="text-yellow-200">⚠ AD37_3 sem avatar</div>
            </div>
            <div className="text-[11px] leading-snug text-text-muted">
              Reparte os takes entre as cenas na ordem (hook na cena 1).
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ 0.4 FRAME POR VERSAO (modo imagem) ══════════ */}
      <section className="grid gap-2.5 rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="label-tech text-[9.5px] tracking-[0.18em] text-text-muted">
          Modo imagem — o que “+ versões” mostra
        </div>
        <FrameDaVersao
          titulo="Frame da versão YouTube"
          imageDataUrl={frameYt}
          imageName={frameYt ? 'AD37_youtube.png' : null}
          onArquivo={() => setFrameYt(FRAME_FAKE)}
          onLimpar={() => setFrameYt(null)}
        />
        <FrameDaVersao
          titulo="Frame da versão"
          nome="Versão 3"
          onRenomear={() => {}}
          imageDataUrl={null}
          imageName={null}
          onArquivo={() => setFrameYt(FRAME_FAKE)}
          onLimpar={() => {}}
        />
      </section>

      {/* ══════════ 0.5 APPLY CUSTOM MOTION (caixa acesa) ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
          Apply Custom Motion
          <div className="ml-auto flex items-center gap-1">
            {(['III', 'IV', 'V'] as const).map((op) => {
              const efetivo: 'III' | 'IV' | 'V' = gestoDemo.trim() ? 'IV' : 'III';
              const aceso = efetivo === op;
              return (
                <span key={op} className={'mono rounded-full border px-2 py-[2px] text-[8.5px] font-bold uppercase tracking-widest ' + (aceso ? 'border-violet-500/70 bg-violet-600 text-white shadow-[0_2px_8px_-2px_rgba(124,92,246,0.7)]' : 'border-line bg-bg-soft/50 text-text-muted')}>
                  {op}
                </span>
              );
            })}
          </div>
        </div>
        <div className={'gesto-caixa' + (gestoDemo.trim() ? ' is-on' : '')}>
          <textarea
            value={gestoDemo}
            onChange={(e) => setGestoDemo(e.target.value)}
            rows={2}
            placeholder="ex.: mexe a gelatina 2x no comeco, apoia a colher e segue falando com as maos soltas"
            className="gesto-input"
          />
          {gestoDemo.trim() ? (
            <span className="gesto-selo" aria-hidden>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 4.1 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4 8.9-10.97a1 1 0 0 0-.77-1.63H12l1-7.4z" />
              </svg>
              gesto ativo · sai no IV
            </span>
          ) : null}
        </div>
      </section>

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
          <IndicacaoPanel
            tipo="copy"
            itens={[
              { take: 'HOOK 1', trecho: 'Para próstata inchada, não existe nada melhor do que isso daqui.', nota: 'COMENTARIO DE TESTE, CENARIO X' },
              { take: 'BODY 2', trecho: 'Esse composto se chama oleocantal do azeite.', nota: 'Tela dividida aqui — b-roll do azeite escorrendo', links: [resolverLinkIndicacao('https://drive.google.com/file/d/1eyJoDa-rfD8IsnPM__qCBjfUc8hzdDhn/view')] },
            ]}
          />
        ) : null}
        {indAberta ? (
          <IndicacaoPanel
            tipo="avatar"
            itens={[
              { nota: 'AVATAR SEGURANDO O AZEITE NA MÃO', links: [resolverLinkIndicacao('https://youtu.be/dQw4w9WgXcQ'), resolverLinkIndicacao('https://www.tiktok.com/@fulano/video/7300000000')] },
              { nota: 'AMBIENTE DE COZINHA, LUZ QUENTE', links: [resolverLinkIndicacao('https://www.instagram.com/reel/Cxyz123/')] },
            ]}
          />
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
        indicacoesAvatar={[
          { nota: 'AVATAR SEGURANDO O AZEITE NA MÃO', links: [resolverLinkIndicacao('https://youtu.be/dQw4w9WgXcQ')] },
        ]}
        indicacoesCopy={[
          { take: 'HOOK 1', trecho: 'Para próstata inchada, não existe nada melhor do que isso daqui.', nota: 'COMENTARIO DE TESTE, CENARIO X' },
          { take: 'BODY 2', trecho: 'Esse composto se chama oleocantal do azeite.', nota: 'Tela dividida aqui', links: [resolverLinkIndicacao('https://drive.google.com/file/d/1eyJoDa-rfD8IsnPM__qCBjfUc8hzdDhn/view')] },
        ]}
        salvarAudioTake={async () => `mock-${Date.now()}`}
        analisarAudioTake={() => {}}
        audioInfo={{ 'mock-audio-1': { status: 'divergente', resumo: 'Áudio ≠ copy: 2 trechos diferentes (92% igual).' } }}
      />
    </main>
  );
}
