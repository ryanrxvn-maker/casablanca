'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Btn3D } from './BatchJobCard3D';

/**
 * VersoesDoDisparo — o botão 3D de VERSÕES no card do disparo (29.08).
 *
 * O AD pode sair em até 10 versões (avatar diferente por versão). Antes cada
 * versão ocupava um CARD separado na fila, com o nome repetido e "YouTube"
 * no fim — e o Silas contava na mão quem era irmão de quem. Agora é UM card
 * por AD: clicar numa versão aqui TROCA o que o card mostra (takes, estado,
 * downloads, tudo). O botão também baixa e renomeia sem sair do lugar.
 *
 * Vale em qualquer fase (fila, gerando, pronto): a lista mostra o estado de
 * cada versão. O nome vem pronto — "AD03GL - PRPB12 · YouTube · @avatar" — e
 * é editável (fica salvo por versão).
 */

export type VersaoNoCard = {
  /** taskId REAL daquela versão (a irmã tem id próprio). */
  taskId: string;
  n: number;
  /** Nome mostrado; editável pelo lápis. */
  nome: string;
  /** Fase da versão, pro selo. */
  fase?: string;
  /** Pronta pra baixar? */
  pronta?: boolean;
  /** É a versão que este card representa? */
  atual?: boolean;
  /** Quantos takes prontos / total (só informativo). */
  prontos?: number;
  total?: number;
};

function IconVersoes({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="12" height="14" rx="2.5" />
      <path d="M7 4h11a2 2 0 0 1 2 2v11" />
    </svg>
  );
}

function selo(fase?: string, pronta?: boolean): { txt: string; cor: string } {
  if (pronta || fase === 'done') return { txt: 'pronto', cor: '#c8e87c' };
  if (fase === 'failed') return { txt: 'falhou', cor: '#fca5a5' };
  if (fase === 'queued') return { txt: 'na fila', cor: '#fcd34d' };
  if (fase === 'waiting-heygen') return { txt: 'no HeyGen', cor: '#67e8f9' };
  if (fase) return { txt: 'gerando', cor: '#67e8f9' };
  return { txt: 'não disparada', cor: 'rgba(255,255,255,0.45)' };
}

export function VersoesDoDisparo({
  versoes,
  onBaixar,
  onTrocar,
  onRenomear,
}: {
  versoes: VersaoNoCard[];
  /** Baixa a entrega daquela versão (null = não há o que baixar ainda). */
  onBaixar?: (v: VersaoNoCard) => void;
  /** TROCA a versão que o card está mostrando (o clique na linha). */
  onTrocar?: (v: VersaoNoCard) => void;
  onRenomear?: (v: VersaoNoCard, nome: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [editando, setEditando] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState('');
  // ⚠ O card do disparo tem `transform` (efeito 3D) e isso CRIA stacking
  // context: um popover `position:absolute` dentro dele fica preso e sai
  // cortado embaixo do card seguinte. Por isso ele vai por PORTAL no body,
  // posicionado pelo rect do botão (e reposicionado no scroll/resize).
  const ancoraRef = React.useRef<HTMLSpanElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const medir = React.useCallback(() => {
    const el = ancoraRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const largura = 330;
    // encosta pela direita do botão, sem sair da janela
    const left = Math.max(10, Math.min(window.innerWidth - largura - 10, r.right - largura));
    setPos({ top: r.bottom + 8, left });
  }, []);
  React.useEffect(() => {
    if (!aberto) return;
    medir();
    const on = () => medir();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
    };
  }, [aberto, medir]);
  if (versoes.length <= 1) return null;

  return (
    <span className="vd-wrap" ref={ancoraRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className={'vd-botao' + (aberto ? ' is-open' : '')}
        title={`Versões deste AD (${versoes.length}) — escolha pra baixar ou ver`}
      >
        <span className="vd-halo" aria-hidden />
        <IconVersoes size={17} />
      </button>
      <span className="vd-n" aria-hidden>{versoes.length}</span>

      {aberto && typeof document !== 'undefined' && pos
        ? createPortal(
        <>
          <span className="vd-fora" onClick={() => setAberto(false)} aria-hidden />
          <span className="vd-pop" style={{ top: pos.top, left: pos.left }}>
            <span className="vd-titulo">Versões deste AD</span>
            <span className="vd-lista">
              {versoes.map((v) => {
                const st = selo(v.fase, v.pronta);
                const emEdicao = editando === v.taskId;
                return (
                  <span
                    key={v.taskId}
                    className={'vd-item' + (v.atual ? ' is-atual' : '') + (onTrocar && !emEdicao ? ' is-clicavel' : '')}
                    role={onTrocar && !emEdicao ? 'button' : undefined}
                    tabIndex={onTrocar && !emEdicao ? 0 : undefined}
                    title={v.atual ? 'Esta é a versão que o card está mostrando' : 'Mostrar esta versão no card'}
                    onClick={() => {
                      if (!onTrocar || emEdicao || v.atual) return;
                      onTrocar(v);
                      setAberto(false);
                    }}
                    onKeyDown={(e) => {
                      if (!onTrocar || emEdicao || v.atual) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTrocar(v);
                        setAberto(false);
                      }
                    }}
                  >
                    <span className="vd-n-badge">{v.n}</span>
                    <span className="vd-txt">
                      {emEdicao ? (
                        <input
                          className="vd-input"
                          value={rascunho}
                          autoFocus
                          onChange={(e) => setRascunho(e.target.value)}
                          onBlur={() => { onRenomear?.(v, rascunho.trim() || v.nome); setEditando(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onRenomear?.(v, rascunho.trim() || v.nome); setEditando(null); }
                            if (e.key === 'Escape') setEditando(null);
                          }}
                        />
                      ) : (
                        <span className="vd-nome" title={v.nome}>{v.nome}</span>
                      )}
                      <span className="vd-estado" style={{ color: st.cor }}>
                        {st.txt}
                        {typeof v.prontos === 'number' && typeof v.total === 'number' && v.total > 0 && !v.pronta
                          ? ` · ${v.prontos}/${v.total}`
                          : ''}
                        {v.atual ? <span className="vd-mostrando">mostrando</span> : null}
                      </span>
                    </span>
                    <span className="vd-acoes" onClick={(e) => e.stopPropagation()}>
                      {onRenomear && !emEdicao ? (
                        <button
                          type="button"
                          className="vd-mini"
                          title="Renomear esta versão"
                          onClick={(e) => { e.stopPropagation(); setEditando(v.taskId); setRascunho(v.nome); }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                      ) : null}

                      {onBaixar ? (
                        <button
                          type="button"
                          className={'vd-mini' + (v.pronta ? ' is-ok' : '')}
                          title={v.pronta ? 'Baixar esta versão' : 'Ainda não tem entrega desta versão'}
                          disabled={!v.pronta}
                          onClick={(e) => { e.stopPropagation(); onBaixar(v); setAberto(false); }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4.5 20h15" /></svg>
                        </button>
                      ) : null}
                    </span>
                  </span>
                );
              })}
            </span>
          </span>
        </>,
        document.body,
      ) : null}
</span>
  );
}
