'use client';

/**
 * MINI JANELAS da LEGENDA AUTOMÁTICA e da DINÂMICA DE ZOOM (ClickUp Pilot,
 * 30.08) — os dois popovers que abrem nos botões ao lado da tesoura.
 *
 * Desenho: a mesma gramática do popover de versões (`.vp-pop`) — casca escura
 * com hairline, título em label-tech, um acento só. Cada janela termina no
 * botão "usar sempre", que grava a escolha como PADRÃO da conta (é o
 * pré-configurar que o Silas pediu: liga uma vez, vale pras próximas tasks).
 *
 * Ficam em componente próprio porque o card do Pilot tem `transform` (o tilt
 * 3D) e isso cria contexto de empilhamento — igual ao popover de versões, o
 * conteúdo é posicionado com `fixed` a partir do retângulo do botão, e o CSS
 * mora em globals.css (styled-jsx não atravessa portal).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CaptionTemplate } from '@/lib/typography/caption-script';
import type { LegendaCfg, ZoomCfg, ZoomModo, ZoomForca } from '@/lib/pilot-pos-producao';

const MODOS: Array<{ v: ZoomModo; label: string; dica: string }> = [
  { v: 'in', label: 'Zoom in', dica: 'Cada take empurra pra dentro (push-in clássico).' },
  { v: 'out', label: 'Zoom out', dica: 'Cada take começa fechado e abre.' },
  { v: 'inout', label: 'In e out', dica: 'Alterna: um take entra, o seguinte abre.' },
];

const FORCAS: Array<{ v: ZoomForca; label: string; dica: string }> = [
  { v: 'leve', label: 'Leve', dica: '+4,5% — quase respiração.' },
  { v: 'medio', label: 'Médio', dica: '+9% — o push-in do CapCut.' },
  { v: 'forte', label: 'Forte', dica: '+16% — movimento evidente.' },
  { v: 'misto', label: 'Misto', dica: 'Alterna leve e forte entre os takes.' },
];

/** Posiciona o painel embaixo do botão, sem sair da tela. */
function usePos(anchor: HTMLElement | null, aberto: boolean) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!aberto || !anchor) return;
    const calc = () => {
      const r = anchor.getBoundingClientRect();
      const largura = 288;
      const left = Math.max(8, Math.min(window.innerWidth - largura - 8, r.right - largura));
      setPos({ top: r.bottom + 8, left });
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, [anchor, aberto]);
  return pos;
}

export function LegendaZoomPopover({
  tipo,
  anchor,
  onFechar,
  legenda,
  zoom,
  templates,
  onLegenda,
  onZoom,
}: {
  tipo: 'legenda' | 'zoom';
  anchor: HTMLElement | null;
  onFechar: () => void;
  legenda: LegendaCfg;
  zoom: ZoomCfg;
  templates: CaptionTemplate[];
  onLegenda: (cfg: LegendaCfg, virarPadrao?: boolean) => void;
  onZoom: (cfg: ZoomCfg, virarPadrao?: boolean) => void;
}) {
  const pos = usePos(anchor, true);
  const [montado, setMontado] = useState(false);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  if (!montado || !pos) return null;

  const corpo =
    tipo === 'legenda' ? (
      <>
        <div className="lz-titulo">Legenda automática</div>
        <p className="lz-texto">
          Depois de montar (e decupar), a legenda entra sozinha: transcreve o vídeo, corrige
          pela copy do doc e aplica o modelo. O hook vem da copy do hook — a fronteira cai
          exatamente onde o doc diz.
        </p>
        <button
          type="button"
          onClick={() => onLegenda({ ...legenda, on: !legenda.on })}
          className={'lz-switch' + (legenda.on ? ' is-on' : '')}
          aria-pressed={legenda.on}
        >
          <span className="lz-switch-bola" aria-hidden />
          {legenda.on ? 'Ligada' : 'Desligada'}
        </button>

        <div className={'lz-lista' + (legenda.on ? '' : ' is-off')}>
          <div className="lz-rotulo">Modelo</div>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onLegenda({ ...legenda, on: true, templateId: t.id })}
              className={'lz-item' + (legenda.templateId === t.id ? ' is-on' : '')}
            >
              <span className="lz-item-nome">{t.name}</span>
              {t.hint ? <span className="lz-item-dica">{t.hint}</span> : null}
            </button>
          ))}
          {templates.length === 0 ? (
            <div className="lz-vazio">Nenhum modelo — salva um nas Legendas Automáticas.</div>
          ) : null}
        </div>

        <button type="button" className="lz-padrao" onClick={() => onLegenda(legenda, true)}>
          usar sempre
        </button>
      </>
    ) : (
      <>
        <div className="lz-titulo">Dinâmica de zoom</div>
        <p className="lz-texto">
          Na montagem, cada take ganha uma rampa de escala. O reset cai na troca de take —
          onde já existe um corte — então o movimento não pisca.
        </p>
        <button
          type="button"
          onClick={() => onZoom({ ...zoom, on: !zoom.on })}
          className={'lz-switch' + (zoom.on ? ' is-on' : '')}
          aria-pressed={zoom.on}
        >
          <span className="lz-switch-bola" aria-hidden />
          {zoom.on ? 'Ligada' : 'Desligada'}
        </button>

        <div className={'lz-lista' + (zoom.on ? '' : ' is-off')}>
          <div className="lz-rotulo">Movimento</div>
          <div className="lz-grade">
            {MODOS.map((m) => (
              <button
                key={m.v}
                type="button"
                title={m.dica}
                onClick={() => onZoom({ ...zoom, on: true, modo: m.v })}
                className={'lz-chip' + (zoom.modo === m.v ? ' is-on' : '')}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="lz-rotulo mt">Intensidade</div>
          <div className="lz-grade">
            {FORCAS.map((f) => (
              <button
                key={f.v}
                type="button"
                title={f.dica}
                onClick={() => onZoom({ ...zoom, on: true, forca: f.v })}
                className={'lz-chip' + (zoom.forca === f.v ? ' is-on' : '')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="lz-dica">{FORCAS.find((f) => f.v === zoom.forca)?.dica}</div>
        </div>

        <button type="button" className="lz-padrao" onClick={() => onZoom(zoom, true)}>
          usar sempre
        </button>
      </>
    );

  return createPortal(
    <>
      <div className="lz-fora" onClick={onFechar} aria-hidden />
      <div
        ref={caixaRef}
        className="lz-pop"
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-label={tipo === 'legenda' ? 'Legenda automática' : 'Dinâmica de zoom'}
      >
        {corpo}
      </div>
    </>,
    document.body,
  );
}
