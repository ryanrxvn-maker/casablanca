'use client';

/**
 * JANELAS da LEGENDA AUTOMÁTICA e da DINÂMICA DE ZOOM (ClickUp Pilot, 31.08).
 *
 * v2 depois do feedback do Silas: as v1 eram popovers pequenos e ilegíveis.
 * Agora são JANELAS centradas com backdrop, tipografia maior e — o principal —
 * o preview de cada template é RENDERIZADO PELO MOTOR REAL das legendas
 * (drawCaptions + presets + fontes de verdade num canvas 9:16), então o que o
 * card mostra é exatamente o que sai no vídeo. O zoom tem uma prévia ANIMADA
 * com a amplitude e o movimento escolhidos, rodando a mesma matemática do
 * render (easing seno, janela ~2,6s).
 *
 * Vivem em portal (o card do Pilot tem transform 3D) e o CSS mora em
 * globals.css (`.lz-*`) — styled-jsx não atravessa portal.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CaptionTemplate } from '@/lib/typography/caption-script';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  ZOOM_AMP,
  type LegendaCfg,
  type ZoomCfg,
  type ZoomModo,
  type ZoomForca,
} from '@/lib/pilot-pos-producao';

const MODOS: Array<{ v: ZoomModo; label: string; dica: string }> = [
  { v: 'in', label: 'Zoom in', dica: 'Cada take empurra pra dentro — o push-in clássico dos criativos.' },
  { v: 'out', label: 'Zoom out', dica: 'Cada take começa fechado no rosto e abre até o quadro inteiro.' },
  { v: 'inout', label: 'In e out', dica: 'Alterna: um take entra, o seguinte abre. Movimento que nunca cansa.' },
];

const FORCAS: Array<{ v: ZoomForca; label: string; pct: string; dica: string }> = [
  { v: 'leve', label: 'Leve', pct: '+4,5%', dica: 'Quase uma respiração — presença sem chamar atenção.' },
  { v: 'medio', label: 'Médio', pct: '+9%', dica: 'O push-in lento do CapCut. O padrão do estúdio.' },
  { v: 'forte', label: 'Forte', pct: '+16%', dica: 'Movimento evidente, pra cena que precisa de energia.' },
  { v: 'smart', label: 'Smart Zoom', pct: '100→135%', dica: 'O feeling do editor: na maioria dos cortes a escala TROCA SECA (100 · 120 · 130), com zoom in suavizado no meio e um ou outro zoom out. Escolhe sozinho a cada corte.' },
];

/* ═══════════════ preview REAL do template (motor das legendas) ═══════════ */

/** Palavras fake com timing válido pro engine. */
function blocoFake(id: string, texto: string) {
  const palavras = texto.split(' ');
  const dur = 3000;
  return {
    id,
    words: palavras.map((t, i) => ({
      text: t,
      start: (i * dur) / palavras.length,
      end: dur,
    })),
    start: 0,
    end: dur,
  };
}

/**
 * Canvas 9:16 com um frame "de vídeo" fake + o HOOK e o BODY do template
 * desenhados pelo drawCaptions — presets, fontes, caixa e destaque reais.
 * O engine desenha UM bloco por instante, então são duas chamadas (uma pro
 * hook, uma pro body) no mesmo canvas.
 */
function PreviewDoTemplate({ tpl }: { tpl: CaptionTemplate }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let morto = false;
    (async () => {
      try {
        const [eng, pres, fonts] = await Promise.all([
          import('@/lib/typography/engine'),
          import('@/lib/typography/presets'),
          import('@/lib/typography/fonts'),
        ]);
        try {
          await fonts.ensureTypoFonts();
        } catch {
          /* cai na fallback — o preview ainda mostra cor/posição/caixa */
        }
        if (morto) return;
        const c = ref.current;
        if (!c) return;
        const W = 300;
        const H = 534;
        c.width = W;
        c.height = H;
        const g = c.getContext('2d')!;

        // ── frame fake de vídeo: cena escura com um "avatar" desfocado ──
        const fundo = g.createLinearGradient(0, 0, 0, H);
        fundo.addColorStop(0, '#232b36');
        fundo.addColorStop(0.55, '#161c25');
        fundo.addColorStop(1, '#0c1016');
        g.fillStyle = fundo;
        g.fillRect(0, 0, W, H);
        // vulto do avatar (cabeça + tronco), só pra ancorar a leitura
        g.save();
        g.filter = 'blur(14px)';
        g.fillStyle = 'rgba(214, 178, 148, 0.5)';
        g.beginPath();
        g.arc(W / 2, H * 0.32, 46, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(64, 76, 96, 0.85)';
        g.beginPath();
        g.ellipse(W / 2, H * 0.62, 92, 120, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        // vinheta
        const vin = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
        vin.addColorStop(0, 'rgba(0,0,0,0)');
        vin.addColorStop(1, 'rgba(0,0,0,0.45)');
        g.fillStyle = vin;
        g.fillRect(0, 0, W, H);

        // ── HOOK e BODY do template, cada um pelo seu estilo ──
        const hookSeg = tpl.segments.find((s) => s.kind === 'hook');
        const bodySeg = [...tpl.segments].reverse().find((s) => s.kind === 'body');
        const desenhar = (texto: string, estilo: Record<string, unknown>, fallback: string) => {
          const b = blocoFake('p', texto);
          const presetId = (estilo?.presetId as string) || fallback;
          const style = {
            ...eng.DEFAULT_STYLE,
            presetId,
            perBlock: { p: estilo },
            highlights: {},
          };
          // t=2900: todas as palavras já entraram (anima por palavra)
          eng.drawCaptions(g, [b] as never, pres.getPreset(presetId), style as never, 2900, W, H);
        };
        if (hookSeg) desenhar('SEU HOOK CHAMANDO ATENÇÃO', hookSeg.style as Record<string, unknown>, 'vermelho-sangue');
        if (bodySeg) desenhar('e o corpo da legenda aqui', bodySeg.style as Record<string, unknown>, 'keynote');
        if (!morto) setPronto(true);
      } catch (e) {
        console.warn('[PilotLegendaZoom] preview do template falhou:', e);
        if (!morto) setPronto(true);
      }
    })();
    return () => {
      morto = true;
    };
  }, [tpl]);

  return (
    <span className={'lz-thumb-wrap' + (pronto ? ' is-pronto' : '')}>
      <canvas ref={ref} className="lz-thumb" aria-hidden />
      {!pronto ? <span className="lz-thumb-skel" aria-hidden /> : null}
    </span>
  );
}

/* ═══════════════════ prévia ANIMADA da dinâmica de zoom ══════════════════ */

function PreviaDoZoom({ modo, forca }: { modo: ZoomModo; forca: ZoomForca }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seloRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const T = 2600; // uma "troca de take" a cada 2,6s
    const amps: [number, number] =
      forca === 'smart' ? [1.2, 1.3] : [ZOOM_AMP[forca], ZOOM_AMP[forca]];
    // SMART: a prévia mostra o ritmo de verdade — seco, seco, in, seco, out…
    // (os mesmos pesos do planejador, só que numa sequência fixa pra ler bem)
    const roteiroSmart: Array<{ tipo: 'seco' | 'in' | 'out'; de: number; para: number }> = [
      { tipo: 'seco', de: 1.0, para: 1.0 },
      { tipo: 'seco', de: 1.2, para: 1.2 },
      { tipo: 'in', de: 1.2, para: 1.32 },
      { tipo: 'seco', de: 1.0, para: 1.0 },
      { tipo: 'in', de: 1.0, para: 1.15 },
      { tipo: 'out', de: 1.15, para: 1.0 },
    ];
    const tick = (agora: number) => {
      const tempo = agora - t0;
      const j = Math.floor(tempo / T);
      const p = (tempo % T) / T;
      const e = -(Math.cos(Math.PI * p) - 1) / 2; // mesmo easing do render
      let s: number;
      let rotulo = '';
      if (forca === 'smart') {
        const passo = roteiroSmart[j % roteiroSmart.length];
        // a rampa resolve em 78% da janela e descansa até o corte (como no render)
        const pr = Math.min(1, p / 0.78);
        const er = -(Math.cos(Math.PI * pr) - 1) / 2;
        s = passo.de + (passo.para - passo.de) * er;
        rotulo = passo.tipo === 'seco' ? 'corte seco' : passo.tipo === 'in' ? 'zoom in' : 'zoom out';
      } else {
        const amp = amps[j % 2];
        if (modo === 'in') s = 1 + (amp - 1) * e;
        else if (modo === 'out') s = amp - (amp - 1) * e;
        else s = j % 2 === 0 ? 1 + (amp - 1) * e : amp - (amp - 1) * e;
      }
      if (ref.current) ref.current.style.transform = `scale(${s.toFixed(4)})`;
      if (seloRef.current) {
        seloRef.current.textContent = rotulo ? `${rotulo} · ×${s.toFixed(2)}` : `×${s.toFixed(3)}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [modo, forca]);

  return (
    <div className="lz-zoom-previa">
      <div className="lz-zoom-frame">
        <div ref={ref} className="lz-zoom-cena">
          {/* cena fake: grade + "avatar" — a grade deixa o crop visível */}
          <span className="lz-zoom-cabeca" aria-hidden />
          <span className="lz-zoom-tronco" aria-hidden />
        </div>
        {/* marcas de canto fixas: mostram o que o crop come */}
        <span className="lz-zoom-canto tl" aria-hidden />
        <span className="lz-zoom-canto tr" aria-hidden />
        <span className="lz-zoom-canto bl" aria-hidden />
        <span className="lz-zoom-canto br" aria-hidden />
        <span ref={seloRef} className="lz-zoom-escala">×1.000</span>
      </div>
      <div className="lz-zoom-previa-info">
        <div className="lz-zoom-previa-titulo">Prévia ao vivo</div>
        <p className="lz-zoom-previa-txt">
          A mesma matemática do render: rampa com easing seno, uma janela por take.
          O reset cai na troca de take — um corte real — então não pisca.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ a janela ════════════════════════════════ */

export function LegendaZoomPopover({
  tipo,
  onFechar,
  legenda,
  zoom,
  templates,
  onLegenda,
  onZoom,
}: {
  tipo: 'legenda' | 'zoom';
  /** mantido por compatibilidade — a janela agora é centrada */
  anchor?: HTMLElement | null;
  onFechar: () => void;
  legenda: LegendaCfg;
  zoom: ZoomCfg;
  templates: CaptionTemplate[];
  onLegenda: (cfg: LegendaCfg, virarPadrao?: boolean) => void;
  onZoom: (cfg: ZoomCfg, virarPadrao?: boolean) => void;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  // trava o scroll da página — a roda do mouse rolava o fundo (02.09)
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  if (!montado) return null;

  const ligado = tipo === 'legenda' ? legenda.on : zoom.on;

  const corpo =
    tipo === 'legenda' ? (
      <>
        <div className={'lz-secao' + (legenda.on ? '' : ' is-off')}>
          <div className="lz-rotulo">Modelo da legenda</div>
          <div className="lz-tpl-grade">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onLegenda({ ...legenda, on: true, templateId: t.id })}
                className={'lz-tpl' + (legenda.templateId === t.id ? ' is-on' : '')}
                aria-pressed={legenda.templateId === t.id}
              >
                <PreviewDoTemplate tpl={t} />
                <span className="lz-tpl-nome">{t.name}</span>
                {t.hint ? <span className="lz-tpl-dica">{t.hint}</span> : null}
                <span className="lz-tpl-check" aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m4.5 12.8 5 5L19.5 6.5" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          {templates.length === 0 ? (
            <div className="lz-vazio">Nenhum modelo — salva um nas Legendas Automáticas.</div>
          ) : null}
        </div>
        <p className="lz-nota">
          O hook recebe a copy do <b>HOOK do doc</b> — a fronteira cai exatamente onde o doc
          diz — e o resto do vídeo vira body. Tudo corrigido palavra a palavra pela copy.
        </p>
      </>
    ) : (
      <>
        <div className={'lz-secao' + (zoom.on ? '' : ' is-off')}>
          <PreviaDoZoom modo={zoom.modo} forca={zoom.forca} />

          <div className={'lz-rotulo' + (zoom.forca === 'smart' ? ' is-mudo' : '')}>
            Movimento
            {zoom.forca === 'smart' ? <span className="lz-rotulo-nota">o Smart Zoom decide a cada corte</span> : null}
          </div>
          <div className={'lz-opcoes' + (zoom.forca === 'smart' ? ' is-mudo' : '')}>
            {MODOS.map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => onZoom({ ...zoom, on: true, modo: m.v })}
                className={'lz-opcao' + (zoom.modo === m.v ? ' is-on' : '')}
                aria-pressed={zoom.modo === m.v}
              >
                <span className="lz-opcao-nome">{m.label}</span>
              </button>
            ))}
          </div>
          {zoom.forca !== 'smart' ? (
            <div className="lz-dica">{MODOS.find((m) => m.v === zoom.modo)?.dica}</div>
          ) : null}

          <div className="lz-rotulo mt">Intensidade</div>
          <div className="lz-opcoes">
            {FORCAS.map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => onZoom({ ...zoom, on: true, forca: f.v })}
                className={'lz-opcao' + (zoom.forca === f.v ? ' is-on' : '')}
                aria-pressed={zoom.forca === f.v}
              >
                <span className="lz-opcao-nome">{f.label}</span>
                <span className="lz-opcao-pct">{f.pct}</span>
              </button>
            ))}
          </div>
          <div className="lz-dica">{FORCAS.find((f) => f.v === zoom.forca)?.dica}</div>
        </div>
      </>
    );

  return createPortal(
    <div className="lz-camada" role="dialog" aria-modal="true" aria-label={tipo === 'legenda' ? 'Legenda automática' : 'Dinâmica de zoom'}>
      <div className="lz-veu" onClick={onFechar} aria-hidden />
      <div className={'lz-janela' + (tipo === 'legenda' ? ' is-legenda' : ' is-zoom')}>
        {/* ── cabeçalho ── */}
        <div className="lz-cab">
          <span className={'lz-cab-tile' + (tipo === 'legenda' ? ' is-ambar' : ' is-violeta')} aria-hidden>
            {tipo === 'legenda' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 15h4M13 15h4M7 11h10" opacity="0.6" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                <circle cx="12" cy="12" r="3.2" opacity="0.7" />
              </svg>
            )}
          </span>
          <span className="lz-cab-textos">
            <span className="lz-titulo">{tipo === 'legenda' ? 'Legenda automática' : 'Dinâmica de zoom'}</span>
            <span className="lz-sub">
              {tipo === 'legenda'
                ? 'Depois de montar e decupar, a legenda entra sozinha — transcrita, corrigida pela copy do doc e no modelo escolhido.'
                : 'Cada take da montagem ganha uma rampa de escala, assada direto no vídeo final.'}
            </span>
          </span>
          <button type="button" className="lz-x" onClick={onFechar} aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* ── switch grande ── */}
        <button
          type="button"
          onClick={() => (tipo === 'legenda' ? onLegenda({ ...legenda, on: !legenda.on }) : onZoom({ ...zoom, on: !zoom.on }))}
          className={'lz-switch' + (ligado ? ' is-on' : '')}
          aria-pressed={ligado}
        >
          <span className="lz-switch-trilho" aria-hidden>
            <span className="lz-switch-bola" />
          </span>
          <span className="lz-switch-txt">
            {ligado
              ? tipo === 'legenda' ? 'Ligada — o AD já sai legendado' : 'Ligada — a montagem sai com o movimento'
              : 'Desligada — clica pra ligar'}
          </span>
        </button>

        <div className="lz-corpo">{corpo}</div>

        {/* MAX QUALITY (03.09) — o render normal é o RÁPIDO. Este botão liga a
          * análise multi-passagem do encoder e o bitrate alto. A RESOLUÇÃO é
          * cheia nos dois modos: o que fazia o render arrastar era uma espera
          * ocupada (ver esperarFilaBaixar), não a qualidade. */}
        {tipo === 'legenda' ? (
          <button
            type="button"
            onClick={() => onLegenda({ ...legenda, qualidadeMax: !legenda.qualidadeMax })}
            className={'lz-maxq' + (legenda.qualidadeMax ? ' is-on' : '')}
            aria-pressed={!!legenda.qualidadeMax}
            title={legenda.qualidadeMax
              ? 'MAX QUALITY ligado: render bem mais LENTO, qualidade máxima'
              : 'Render rápido (padrão): a diferença de qualidade não se enxerga no feed'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {legenda.qualidadeMax ? (
                <>
                  <path d="M12 3l2.4 5.6L20 10l-4.4 3.8L17 20l-5-3-5 3 1.4-6.2L4 10l5.6-1.4z" />
                </>
              ) : (
                <>
                  <path d="M13 2 4.1 13H11l-1 9 8.9-11H12l1-9z" />
                </>
              )}
            </svg>
            <span className="lz-maxq-txt">
              {legenda.qualidadeMax ? 'MAX QUALITY — render lento' : 'RENDER RÁPIDO — recomendado'}
            </span>
            <span className="lz-maxq-pill">{legenda.qualidadeMax ? 'ON' : 'OFF'}</span>
          </button>
        ) : null}

        {/* ── rodapé ── */}
        <div className="lz-rodape">
          <button
            type="button"
            className="lz-padrao"
            onClick={() => (tipo === 'legenda' ? onLegenda(legenda, true) : onZoom(zoom, true))}
            title="Grava esta escolha como padrão da conta — as próximas tasks já vêm assim"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
            usar sempre
          </button>
          <button type="button" className="lz-ok" onClick={onFechar}>
            Pronto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
