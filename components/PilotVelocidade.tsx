'use client';

/**
 * MIXER DE VELOCIDADE do Pilot (08.10) — a janela do botão do velocímetro.
 *
 * Silas: *"usa a ferramenta de mixer de velocidade do próprio Auto Edit: na
 * montagem ele acelera o vídeo final montado do jeito que a pessoa calibrou,
 * ou desacelera se for o caso"*. A régua é a MESMA do /tools/acelerador
 * (0,5x a 3x, passo 0,05) e o motor também (setpts + atempo: muda a
 * velocidade sem mudar o tom da voz). A prévia toca a voz do próprio AD na
 * velocidade escolhida — o navegador também preserva o tom no playbackRate.
 *
 * Portal + CSS em globals.css (`.vl-*`, casca `.lz-*` das janelas irmãs).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  VELOCIDADE_MAX,
  VELOCIDADE_MIN,
  VELOCIDADE_PASSO,
  VELOCIDADE_PRESETS,
  normalizarVelocidadeCfg,
  type VelocidadeCfg,
} from '@/lib/pilot-sonoplastia';

const fmt = (v: number) => `${v.toFixed(2).replace('.', ',')}x`;
const fmtSeg = (s: number) => `${s.toFixed(1).replace('.', ',')}s`;

function rotuloDoModo(v: number): string {
  if (Math.abs(v - 1) < 0.001) return 'Velocidade original';
  const pct = Math.round(Math.abs(v - 1) * 100);
  return v > 1 ? `${pct}% mais rápido` : `${pct}% mais lento`;
}

export function PilotVelocidadeModal({
  cfg,
  onMudar,
  onFechar,
  amostra,
}: {
  cfg: VelocidadeCfg;
  onMudar: (cfg: VelocidadeCfg, virarPadrao?: boolean) => void;
  onFechar: () => void;
  /** a voz do AD já montado (o avatar limpo do projeto) — null = ainda não montou */
  amostra?: () => Promise<Blob | null>;
}) {
  const [montado, setMontado] = useState(false);
  const c = normalizarVelocidadeCfg(cfg);
  const [durAmostra, setDurAmostra] = useState<number | null>(null);
  const [temAmostra, setTemAmostra] = useState<boolean | null>(null);
  const [tocando, setTocando] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const trilhoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMontado(true), []);
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  // a amostra (voz do AD) é carregada uma vez, sob demanda do componente
  useEffect(() => {
    let vivo = true;
    (async () => {
      const b = amostra ? await amostra().catch(() => null) : null;
      if (!vivo) return;
      if (!b) { setTemAmostra(false); return; }
      const url = URL.createObjectURL(b);
      urlRef.current = url;
      const a = new Audio();
      a.preload = 'metadata';
      a.src = url;
      (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      a.onloadedmetadata = () => { if (vivo && Number.isFinite(a.duration)) setDurAmostra(a.duration); };
      a.onended = () => setTocando(false);
      a.onpause = () => setTocando(false);
      a.onplay = () => setTocando(true);
      audioRef.current = a;
      setTemAmostra(true);
    })();
    return () => {
      vivo = false;
      const a = audioRef.current;
      if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [amostra]);

  // a velocidade muda AO VIVO enquanto toca
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = c.on ? c.velocidade : 1;
  }, [c.on, c.velocidade]);

  if (!montado) return null;

  const mudarVel = (v: number) => {
    const n = normalizarVelocidadeCfg({ on: true, velocidade: v });
    onMudar({ ...n, on: true });
  };
  const pct = ((c.velocidade - VELOCIDADE_MIN) / (VELOCIDADE_MAX - VELOCIDADE_MIN)) * 100;
  const pctUm = ((1 - VELOCIDADE_MIN) / (VELOCIDADE_MAX - VELOCIDADE_MIN)) * 100;

  const tocar = () => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    a.playbackRate = c.on ? c.velocidade : 1;
    if (a.currentTime > 9 || a.ended) a.currentTime = 0;
    void a.play().catch(() => setTocando(false));
  };

  return createPortal(
    <div className="lz-camada" role="dialog" aria-modal="true" aria-label="Mixer de velocidade">
      <div className="lz-veu" onClick={onFechar} aria-hidden />
      <div className="lz-janela vl-janela">
        <div className="lz-cab">
          <span className="lz-cab-tile vl-tile" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.2 17.5a9 9 0 1 1 15.6 0" />
              <path d="M12 13.2 16.4 8.6" />
              <circle cx="12" cy="13.6" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="lz-cab-textos">
            <span className="lz-titulo">Mixer de velocidade</span>
            <span className="lz-sub">O AD montado sai na velocidade que você calibrar, com o mesmo motor do Mixer de Velocidade: a voz muda o ritmo e mantém o tom.</span>
          </span>
          <button type="button" className="lz-x" onClick={onFechar} aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onMudar({ ...c, on: !c.on })}
          className={'lz-switch' + (c.on ? ' is-on' : '')}
          aria-pressed={c.on}
        >
          <span className="lz-switch-trilho" aria-hidden><span className="lz-switch-bola" /></span>
          <span className="lz-switch-txt">{c.on ? `Ligado: o AD sai em ${fmt(c.velocidade)}` : 'Desligado: o AD sai na velocidade original'}</span>
        </button>

        <div className="lz-corpo">
          <div className={'vl-casca' + (c.on ? '' : ' is-off')}>
            <div className="vl-nucleo">
              <div className="vl-leitura">
                <span className="vl-numero" aria-live="polite">{fmt(c.velocidade)}</span>
                <span className="vl-modo">{rotuloDoModo(c.velocidade)}</span>
                {durAmostra ? (
                  <span className="vl-duracao">
                    {fmtSeg(durAmostra)}
                    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M1 5h11M8.5 1.5 12 5l-3.5 3.5" /></svg>
                    <b>{fmtSeg(durAmostra / (c.on ? c.velocidade : 1))}</b>
                  </span>
                ) : null}
              </div>

              <div className="vl-regua" ref={trilhoRef}>
                <span className="vl-trilho" aria-hidden>
                  <span className="vl-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, pct / 100)).toFixed(4)})` }} />
                  <span className="vl-marca-um" style={{ left: `${pctUm}%` }} />
                </span>
                <input
                  type="range"
                  className="vl-range"
                  min={VELOCIDADE_MIN}
                  max={VELOCIDADE_MAX}
                  step={VELOCIDADE_PASSO}
                  value={c.velocidade}
                  onChange={(e) => mudarVel(parseFloat(e.target.value))}
                  aria-label="Velocidade"
                />
                <span className="vl-extremos" aria-hidden>
                  <span>0,5x</span>
                  <span style={{ left: `${pctUm}%` }} className="vl-um">1x</span>
                  <span>3x</span>
                </span>
              </div>

              <div className="vl-presets" role="group" aria-label="Velocidades prontas">
                {VELOCIDADE_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={'vl-preset' + (c.on && Math.abs(c.velocidade - v) < 0.001 ? ' is-on' : '')}
                    onClick={() => mudarVel(v)}
                  >
                    {fmt(v)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="vl-previa">
            <button type="button" className={'vl-play' + (tocando ? ' is-tocando' : '')} onClick={tocar} disabled={!temAmostra} aria-label={tocando ? 'Pausar prévia' : 'Ouvir na velocidade'}>
              <span className="vl-play-circ" aria-hidden>
                {tocando ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
                )}
              </span>
              <span className="vl-play-txt">
                <b>{tocando ? 'Tocando' : 'Ouvir nessa velocidade'}</b>
                <small>{temAmostra === false ? 'Monte o AD uma vez pra ouvir com a voz dele' : temAmostra ? 'A voz do próprio AD, já montado' : 'carregando a voz do AD'}</small>
              </span>
            </button>
          </div>

          <p className="lz-nota">
            Entra <b>antes</b> da legenda, dos inserts e dos SFX: a transcrição já ouve a fala no ritmo novo, então tudo continua batendo. O projeto do CapCut e do Premiere vem com o avatar já nessa velocidade.
          </p>
        </div>

        <div className="lz-rodape">
          <button type="button" className="lz-padrao" onClick={() => onMudar(c, true)} title="Grava como padrão da conta: as próximas tasks já vêm assim">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            usar sempre
          </button>
          <button type="button" className="lz-ok" onClick={onFechar}>Pronto</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
