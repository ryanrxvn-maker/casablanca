'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * JANELA DE CLONAGEM do botão-ícone do slot de voz (Pilot, 24.09).
 *
 * Existe pra responder UMA pergunta antes do clique: em QUAL conta do HeyGen a
 * voz vai nascer. Clone é privado da conta — se nasce na conta errada, o
 * disparo dá "Voice not found". Por isso a conta, o plano, o total de vozes
 * clonadas e o caminho (servidor/API oficial × sessão do navegador) ficam à
 * vista, e o mesmo quadro acompanha o progresso e o erro.
 */

export type RotaClone = {
  via: 'servidor' | 'navegador';
  conta: string | null;
  plano: string | null;
  clones: number | null;
  /** Por que foi por este caminho (quando as contas diferem). */
  motivo: string | null;
};

export type EstadoClone =
  | { fase: 'pronto' }
  | { fase: 'rodando'; percent: number; message: string }
  | { fase: 'ok'; nome: string }
  | { fase: 'erro'; message: string };

const W = 340;

function planoBonito(p: string | null): string | null {
  if (!p) return null;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

export function VoiceCloneJanela({
  anchor,
  rota,
  estado,
  onEscolher,
  onClose,
}: {
  anchor: DOMRect;
  rota: RotaClone | 'carregando' | { erro: string };
  estado: EstadoClone;
  onEscolher: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = popRef.current?.offsetHeight || 300;
    let top = anchor.bottom + 10;
    if (top + h > vh - 12) top = Math.max(12, anchor.top - h - 10);
    let left = anchor.right - W;
    if (left < 12) left = 12;
    if (left + W > vw - 12) left = vw - W - 12;
    setPos({ top, left });
  }, [anchor, rota, estado]);

  // onClose muda a cada render da página; o ref evita re-assinar os listeners.
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharRef.current(); };
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      fecharRef.current();
    };
    document.addEventListener('keydown', onKey);
    const id = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  const carregando = rota === 'carregando';
  const erroRota = typeof rota === 'object' && 'erro' in rota ? rota.erro : null;
  const r = typeof rota === 'object' && !('erro' in rota) ? rota : null;
  const rodando = estado.fase === 'rodando';
  const pct = rodando ? Math.max(3, Math.min(100, Math.round(estado.percent))) : 0;

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Clonar voz"
      className="vcj"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: W }}
    >
      <div className="vcj-head">
        <span className="vcj-ico" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="2.5" y="9.5" width="2.6" height="5" rx="1.3" />
            <rect x="7" y="5.5" width="2.6" height="13" rx="1.3" />
            <rect x="11.5" y="2.5" width="2.6" height="19" rx="1.3" />
            <rect x="16" y="6.5" width="2.6" height="11" rx="1.3" />
            <rect x="20.5" y="10" width="2.6" height="4" rx="1.3" />
          </svg>
        </span>
        <span className="vcj-title">Clonar voz</span>
        <button type="button" className="vcj-x" onClick={onClose} aria-label="Fechar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div className="vcj-conta">
        <div className="vcj-label">Conta do HeyGen onde a voz vai nascer</div>
        {carregando ? (
          <div className="vcj-skel" aria-busy="true"><span /><span /></div>
        ) : erroRota ? (
          <div className="vcj-erro">{erroRota}</div>
        ) : r ? (
          <>
            <div className="vcj-email-row">
              <span className="vcj-avatar" aria-hidden>{(r.conta || '?').charAt(0).toUpperCase()}</span>
              <span className="vcj-email" title={r.conta || ''}>{r.conta || 'conta desconhecida'}</span>
            </div>
            <div className="vcj-chips">
              {planoBonito(r.plano) ? <span className="vcj-chip">Plano {planoBonito(r.plano)}</span> : null}
              {r.clones != null ? <span className="vcj-chip">{r.clones} vozes clonadas</span> : null}
              <span className={'vcj-chip ' + (r.via === 'servidor' ? 'is-srv' : 'is-nav')}>
                {r.via === 'servidor' ? 'API oficial · servidor' : 'Sessão do navegador'}
              </span>
            </div>
            {r.motivo ? <p className="vcj-nota">{r.motivo}</p> : null}
          </>
        ) : null}
      </div>

      {estado.fase === 'rodando' ? (
        <div className="vcj-prog">
          <div className="vcj-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="vcj-prog-txt"><span>{estado.message || 'Clonando...'}</span><b>{pct}%</b></div>
        </div>
      ) : estado.fase === 'ok' ? (
        <div className="vcj-ok">Voz <b>{estado.nome}</b> clonada e aplicada neste avatar.</div>
      ) : estado.fase === 'erro' ? (
        <div className="vcj-erro">{estado.message}</div>
      ) : null}

      <button
        type="button"
        className="vcj-cta"
        onClick={onEscolher}
        disabled={carregando || !!erroRota || rodando}
      >
        {rodando ? 'Clonando…' : estado.fase === 'erro' ? 'Tentar com outro arquivo' : 'Escolher áudio ou vídeo'}
      </button>
    </div>,
    document.body,
  );
}
