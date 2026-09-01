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
import { useRef, useState } from 'react';
import { RedispatchPanel, type RedispatchPart } from '@/components/RedispatchPanel';
import { IndicacaoPanel } from '@/components/IndicacaoPanel';
import { resolverLinkIndicacao } from '@/lib/pilot-indicacoes';
import { EditPartModal } from '@/components/EditPartModal';
import { LegendaZoomPopover } from '@/components/PilotLegendaZoom';
import { BUILTIN_TEMPLATES } from '@/lib/typography/caption-script';
import { LEGENDA_CFG_DEFAULT, ZOOM_CFG_DEFAULT, type LegendaCfg, type ZoomCfg } from '@/lib/pilot-pos-producao';
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

/**
 * PROVA E2E da pós-produção: baixa /dev-tiny.mp4 (testsrc2 12s + tom 440Hz),
 * fabrica palavras sintéticas (sem depender do ASR logado), monta o roteiro
 * hook×body no Template 1 e renderiza com plano de zoom FORTE modo in.
 * O que valida: duração preservada, tamanho plausível, legenda desenhada e
 * o crop do zoom visível (as bordas do testsrc2 somem ao longo da janela).
 */
async function rodarProvaE2E(
  setMsg: (m: string | null) => void,
  setUrl: (u: string | null) => void,
) {
  try {
    setUrl(null);
    setMsg('baixando o vídeo de teste…');
    const blob = await fetch('/dev-tiny.mp4').then((r) => r.blob());

    const [{ renderTypographyVideo }, engine, roteiroMod, blocksMod, presets, pos] = await Promise.all([
      import('@/lib/typography/export'),
      import('@/lib/typography/engine'),
      import('@/lib/typography/caption-script'),
      import('@/lib/typography/blocks-edit'),
      import('@/lib/typography/presets'),
      import('@/lib/pilot-pos-producao'),
    ]);

    // palavras sintéticas: 24 palavras em 12s (2/s), hook = 6 primeiras
    const HOOK = 'como transformar um azeite comum barato'.split(' ');
    const BODY = 'a maioria das pessoas usa errado e joga fora a parte que importa de verdade agora'.split(' ');
    const todas = [...HOOK, ...BODY];
    const words = todas.map((t, i) => ({ text: t, start: i * 500, end: i * 500 + 420 }));
    const grupo = await import('@/lib/typography/group');
    let blocks = grupo.groupWords(words, 'rapido');

    const segs = pos.montarRoteiro(roteiroMod.TEMPLATE_1, HOOK.join(' '), BODY.join(' '));
    const aplicado = roteiroMod.applyCaptionScript(blocks, segs, blocksMod.emptyIdentity());
    blocks = aplicado.blocks;
    const style = {
      ...engine.DEFAULT_STYLE,
      presetId: 'keynote',
      perBlock: aplicado.blockStyles,
      highlights: aplicado.highlights,
      wordStyles: aplicado.wordStyles,
    };

    const plano = pos.planejarZoom({ on: true, modo: 'in', forca: 'forte' }, 12, [4, 4, 4]);
    setMsg(`renderizando… (${blocks.length} blocos de legenda, ${plano.length} janelas de zoom)`);

    const t0 = Date.now();
    // FIEL AO PIPELINE: ele roda TUDO dentro do lock exclusivo do ffmpeg, e a
    // pós-produção acontece lá dentro. Sem o `ffmpegJaExclusivo`, o mux de
    // áudio pede o lock de novo e trava pra sempre (deadlock de 31.08).
    const { runFfmpegExclusive } = await import('@/lib/ffmpeg-serial');
    const r = await runFfmpegExclusive(() => renderTypographyVideo({
      file: blob,
      blocks,
      preset: presets.getPreset('keynote'),
      style,
      ffmpegJaExclusivo: true,
      zoom: plano,
      onProgress: (pr) => setMsg(`render COM zoom ${pr.phase} ${(pr.ratio * 100).toFixed(0)}%`),
    }));
    // SEGUNDO render, SEM zoom — é a régua da prova geométrica: no fim da 1ª
    // janela (t=3.8, escala 1.16), o frame COM zoom tem que casar com o crop
    // central 1/1.16 do frame SEM zoom, e não com o frame inteiro.
    const r0 = await renderTypographyVideo({
      file: blob,
      blocks,
      preset: presets.getPreset('keynote'),
      style,
      zoom: [],
      onProgress: (pr) => setMsg(`render SEM zoom ${pr.phase} ${(pr.ratio * 100).toFixed(0)}%`),
    });
    setMsg('comparando frames…');
    // Mede no fim da 1ª rampa, na escala que o PLANO diz — a régua sai do
    // próprio plano, então subir a amplitude não invalida a prova.
    const j0 = plano[0];
    const tAlvo = Math.min((j0?.rampaAte ?? 3.8) - 0.05, 11.5);
    const escalaAlvo = j0?.to ?? 1.16;
    const veredito = await provarZoomGeometrico(r.blob, r0.blob, tAlvo, escalaAlvo);
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    setUrl(URL.createObjectURL(r.blob));
    setMsg(
      `${veredito.ok ? 'PROVA OK' : 'PROVA FALHOU'} em ${seg}s · saída ${(r.blob.size / 1e6).toFixed(2)}MB · ${r.width}x${r.height}@${r.fps} · audioOk=${r.audioOk} · blocos=${blocks.length} · zoom=${plano.length} janelas · ${veredito.detalhe}`,
    );
  } catch (e) {
    setMsg(`PROVA FALHOU: ${(e as Error)?.message || e}`);
  }
}

/** Compara COM-zoom × SEM-zoom: t~0.2 iguais; t=3.8 o COM tem que ser o crop
 *  central ampliado do SEM. Tudo em elementos de blob (decodificam sempre). */
async function provarZoomGeometrico(
  comZoom: Blob,
  semZoom: Blob,
  tAlvo: number,
  escalaAlvo: number,
): Promise<{ ok: boolean; detalhe: string }> {
  const abrir = (b: Blob) =>
    new Promise<HTMLVideoElement>((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 10_000);
      v.onloadeddata = () => { clearTimeout(timer); resolve(v); };
      v.onerror = () => { clearTimeout(timer); reject(new Error('video invalido')); };
      v.src = URL.createObjectURL(b);
    });
  const seek = (v: HTMLVideoElement, t: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 4000);
      const f = () => { clearTimeout(timer); v.removeEventListener('seeked', f); resolve(); };
      v.addEventListener('seeked', f);
      v.currentTime = t;
    });
  const grab = (v: HTMLVideoElement, crop?: number) => {
    const c = document.createElement('canvas');
    c.width = 180; c.height = 320;
    const g = c.getContext('2d')!;
    if (crop && crop > 1) {
      const vw = v.videoWidth, vh = v.videoHeight, sw = vw / crop, sh = vh / crop;
      g.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, 180, 320);
    } else g.drawImage(v, 0, 0, 180, 320);
    return g.getImageData(0, 0, 180, 320).data;
  };
  const sad = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 16) s += Math.abs(a[i] - b[i]);
    return Math.round(s / 1000);
  };
  const vz = await abrir(comZoom);
  const v0 = await abrir(semZoom);
  await seek(vz, 0.2); await seek(v0, 0.2);
  const inicioIgual = sad(grab(vz), grab(v0));
  await seek(vz, tAlvo); await seek(v0, tAlvo);
  const fz = grab(vz);
  const contraInteiro = sad(fz, grab(v0));
  const contraCrop = sad(fz, grab(v0, escalaAlvo));
  const ok = inicioIgual < contraInteiro * 0.5 && contraCrop < contraInteiro * 0.6;
  return {
    ok,
    detalhe:
      `t0.2 dif=${inicioIgual} · t${tAlvo.toFixed(1)} vs inteiro=${contraInteiro} ` +
      `vs crop${escalaAlvo.toFixed(2)}=${contraCrop} (crop tem que ganhar)`,
  };
}

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
  const [lzAberto, setLzAberto] = useState<'legenda' | 'zoom' | null>(null);
  const lzRef = useRef<HTMLElement | null>(null);
  const [lzLegenda, setLzLegenda] = useState<LegendaCfg>({ ...LEGENDA_CFG_DEFAULT, on: true });
  const [lzZoom, setLzZoom] = useState<ZoomCfg>({ ...ZOOM_CFG_DEFAULT, on: true, forca: 'smart' });
  const lzTemplates = BUILTIN_TEMPLATES;
  const [provaMsg, setProvaMsg] = useState<string | null>(null);
  const [provaUrl, setProvaUrl] = useState<string | null>(null);
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

      {/* ══════════ 0.1 PROVA E2E: LEGENDA + ZOOM no render ══════════ */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="label-tech mb-2 text-[9.5px] tracking-[0.18em] text-text-muted">
          Prova E2E — pós-produção (zoom + legenda) em /dev-tiny.mp4
        </div>
        <button
          type="button"
          id="prova-e2e"
          onClick={() => void rodarProvaE2E(setProvaMsg, setProvaUrl)}
          className="trecho-add"
        >
          <span aria-hidden>▶</span>
          rodar prova e2e
        </button>
        {provaMsg ? <div className="mono mt-2 text-[10px] text-text-muted" id="prova-msg">{provaMsg}</div> : null}
        {provaUrl ? (
          <div className="mt-2 flex items-start gap-3">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video id="prova-out" src={provaUrl} controls muted className="h-[320px] rounded-[10px] border border-line" />
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video id="prova-in" src="/dev-tiny.mp4" controls muted className="h-[320px] rounded-[10px] border border-line opacity-70" />
          </div>
        ) : null}
      </section>


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

      {/* ========== 0.15 MINI JANELAS legenda + zoom ========== */}
      <section className="rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3">
        <div className="label-tech mb-2 text-[9.5px] tracking-[0.18em] text-text-muted">Legenda automática + dinâmica de zoom</div>
        <div className="flex gap-2">
          <button type="button" id="lz-abre-legenda" ref={(el) => { lzRef.current = el || lzRef.current; }} onClick={() => setLzAberto('legenda')} className="trecho-add">
            <span aria-hidden>Aa</span> mini janela da legenda
          </button>
          <button type="button" id="lz-abre-zoom" onClick={() => setLzAberto('zoom')} className="trecho-add">
            <span aria-hidden>Z</span> mini janela do zoom
          </button>
        </div>
        {lzAberto ? (
          <LegendaZoomPopover
            tipo={lzAberto}
            anchor={lzRef.current}
            onFechar={() => setLzAberto(null)}
            legenda={lzLegenda}
            zoom={lzZoom}
            templates={lzTemplates}
            onLegenda={(c) => setLzLegenda(c)}
            onZoom={(c) => setLzZoom(c)}
          />
        ) : null}
      </section>

      {/* ========== 0.2 PAINEL DO OLHINHO ========== */}
      <section>
        <div className="olho-painel mt-2 rounded-[10px] p-3">
          <div className="olho-titulo mono mb-2 text-[9px] uppercase tracking-widest">
            preview do texto pro HeyGen (Avatar 2) - editavel
          </div>
          <div className="grid gap-2">
            <div className="olho-card rounded-[8px] p-2">
              <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="olho-label shrink-0 font-bold">BODY 7</span>
                  <span className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-lime/35 bg-lime/10 px-1.5 py-0.5 normal-case tracking-normal text-lime">
                    <span className="truncate text-[9px] font-semibold">@manual2</span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <select className="mono rounded border border-lime/35 bg-bg/70 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-lime focus:outline-none">
                    <option>Avatar 2</option>
                  </select>
                  <span className="text-text-muted">0c - 0p</span>
                  <button type="button" className="olho-x inline-flex h-5 w-5 items-center justify-center rounded-full transition">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              </div>
              <textarea
                defaultValue=""
                rows={3}
                className="olho-input mono w-full resize-y rounded px-2 py-1.5 text-[12px] text-text focus:outline-none"
                placeholder="(vazio - esse part nao vai gerar nada)"
              />
              <div className="olho-revisar is-grave mono mt-1.5 rounded-[6px] px-2 py-1 text-[9.5px] leading-relaxed">
                <span className="font-bold uppercase tracking-widest">revisar a copy</span>
                <div className="mt-0.5"><span className="olho-trecho rounded px-1">tem MUITA</span> nao tira video</div>
              </div>
            </div>
            <div className="olho-card rounded-[8px] p-2">
              <div className="mono mb-1.5 flex items-center gap-2 text-[9px] uppercase tracking-widest">
                <span className="olho-label shrink-0 font-bold">HOOK 1</span>
              </div>
              <textarea
                defaultValue="Como transformar um azeite de R$10 no seu proprio remedio."
                rows={2}
                className="olho-input mono w-full resize-y rounded px-2 py-1.5 text-[12px] text-text focus:outline-none"
              />
              <div className="olho-revisar mono mt-1.5 rounded-[6px] px-2 py-1 text-[9.5px] leading-relaxed">
                <span className="font-bold uppercase tracking-widest">revisar</span>
                <div className="mt-0.5"><span className="olho-trecho rounded px-1">R$10</span> numero por extenso soa melhor no TTS</div>
              </div>
            </div>
          </div>
          <button type="button" className="trecho-add mt-2">
            <span aria-hidden>+</span>
            trecho pra este avatar falar
          </button>
          <div className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted">
            este e o texto EXATO que vai pro avatar.
          </div>
        </div>
      </section>

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
