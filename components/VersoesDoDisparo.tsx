'use client';

import React from 'react';
import { Btn3D } from './BatchJobCard3D';

/**
 * VersoesDoDisparo — o botão 3D de VERSÕES no card do disparo (29.08).
 *
 * O AD pode sair em até 10 versões (avatar diferente por versão). Antes cada
 * versão aparecia como um CARD separado na fila, e o Silas contava na mão
 * quem era irmão de quem. Agora elas moram num botão só: clica e escolhe a
 * versão — pra BAIXAR, pra ver o PREVIEW, ou só pra saber em que pé está.
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
  onPreview,
  onRenomear,
}: {
  versoes: VersaoNoCard[];
  /** Baixa a entrega daquela versão (null = não há o que baixar ainda). */
  onBaixar?: (v: VersaoNoCard) => void;
  /** Abre/expande o card daquela versão pra ver os takes. */
  onPreview?: (v: VersaoNoCard) => void;
  onRenomear?: (v: VersaoNoCard, nome: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [editando, setEditando] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState('');
  if (versoes.length <= 1) return null;

  return (
    <span className="vd-wrap">
      <Btn3D
        icon={<IconVersoes size={16} />}
        color="violet"
        title={`Versões deste AD (${versoes.length}) — escolha pra baixar ou ver`}
        onClick={() => setAberto((v) => !v)}
      />
      <span className="vd-n" aria-hidden>{versoes.length}</span>

      {aberto ? (
        <>
          <span className="vd-fora" onClick={() => setAberto(false)} aria-hidden />
          <span className="vd-pop">
            <span className="vd-titulo">Versões deste AD</span>
            <span className="vd-lista">
              {versoes.map((v) => {
                const st = selo(v.fase, v.pronta);
                const emEdicao = editando === v.taskId;
                return (
                  <span key={v.taskId} className={'vd-item' + (v.atual ? ' is-atual' : '')}>
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
                      </span>
                    </span>
                    <span className="vd-acoes">
                      {onRenomear && !emEdicao ? (
                        <button
                          type="button"
                          className="vd-mini"
                          title="Renomear esta versão"
                          onClick={() => { setEditando(v.taskId); setRascunho(v.nome); }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                      ) : null}
                      {onPreview ? (
                        <button type="button" className="vd-mini" title="Ver os takes desta versão" onClick={() => { onPreview(v); setAberto(false); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                        </button>
                      ) : null}
                      {onBaixar ? (
                        <button
                          type="button"
                          className={'vd-mini' + (v.pronta ? ' is-ok' : '')}
                          title={v.pronta ? 'Baixar esta versão' : 'Ainda não tem entrega desta versão'}
                          disabled={!v.pronta}
                          onClick={() => { onBaixar(v); setAberto(false); }}
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
        </>
      ) : null}

      <style jsx>{`
        .vd-wrap { position: relative; display: inline-flex; }
        .vd-n {
          position: absolute;
          top: -4px;
          right: -5px;
          z-index: 2;
          min-width: 15px;
          height: 15px;
          padding: 0 3px;
          border-radius: 999px;
          background: #17111f;
          color: #c4b5fd;
          font-family: var(--font-mono), monospace;
          font-size: 9px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 0 1.5px rgba(167, 139, 250, 0.6);
          pointer-events: none;
        }
        .vd-fora { position: fixed; inset: 0; z-index: 40; display: block; }
        .vd-pop {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          z-index: 41;
          display: block;
          width: 320px;
          border-radius: 14px;
          padding: 11px;
          background:
            radial-gradient(120% 100% at 0% 0%, rgba(167, 139, 250, 0.14), transparent 55%),
            linear-gradient(180deg, #14141b 0%, #0e0e14 100%);
          box-shadow:
            inset 0 0 0 1px rgba(167, 139, 250, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 22px 46px -24px rgba(0, 0, 0, 0.95);
          animation: vdEntra 0.2s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        .vd-titulo {
          display: block;
          margin-bottom: 8px;
          font-family: var(--font-tech), system-ui;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #c4b5fd;
        }
        .vd-lista { display: grid; gap: 6px; }
        .vd-item {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 10px;
          padding: 7px 8px;
          background: rgba(255, 255, 255, 0.04);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
        }
        .vd-item.is-atual {
          background: rgba(167, 139, 250, 0.14);
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45);
        }
        .vd-n-badge {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono), monospace;
          font-size: 10px;
          font-weight: 800;
          color: #0d0a16;
          background: linear-gradient(150deg, #c4b5fd, #8b5cf6);
        }
        .vd-txt { display: grid; gap: 1px; min-width: 0; flex: 1; }
        .vd-nome {
          font-family: var(--font-tech), system-ui;
          font-size: 11.5px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.94);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vd-estado {
          font-family: var(--font-mono), monospace;
          font-size: 9.5px;
          letter-spacing: 0.04em;
        }
        .vd-input {
          width: 100%;
          border-radius: 6px;
          padding: 2px 6px;
          font-family: var(--font-tech), system-ui;
          font-size: 11.5px;
          color: #fff;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(167, 139, 250, 0.6);
          outline: none;
        }
        .vd-acoes { display: inline-flex; gap: 4px; flex-shrink: 0; }
        .vd-mini {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 7px;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.07);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
          transition: transform 0.16s cubic-bezier(0.32, 0.72, 0, 1), color 0.16s, background-color 0.16s;
        }
        .vd-mini:hover:not(:disabled) {
          transform: translateY(-1px);
          color: #fff;
          background: rgba(167, 139, 250, 0.3);
        }
        .vd-mini:disabled { opacity: 0.32; cursor: not-allowed; }
        .vd-mini.is-ok { color: #c8e87c; }
        @keyframes vdEntra {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) { .vd-pop { animation: none; } }
      `}</style>
    </span>
  );
}
