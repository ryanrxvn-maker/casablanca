'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * RestartDispatchModal — a mini janela que aparece ao clicar em REINICIAR
 * no card da task (ClickUp Pilot).
 *
 * Uma pergunta só: "Editar antes de reiniciar?".
 *   • SIM  → abre o painel de reorganização DENTRO do card (avatares/vozes
 *            exatamente como foram disparados) e o disparo só sai quando o
 *            user clicar REINICIAR lá.
 *   • NÃO  → reinicia do zero com o MESMO plano de antes (comportamento
 *            antigo do botão, sem o confirm() feio do browser).
 *
 * Quando a task não tem plano editável (Variação de Avatar, Troca de Áudio
 * ou um batch legado sem `replan`), o modal cai no modo simples: só confirma
 * o reinício e explica por que não dá pra editar aqui.
 */
export function RestartDispatchModal({
  taskName,
  totalTakes,
  podeEditar,
  motivoSemEdicao,
  onEditar,
  onReiniciarDireto,
  onClose,
}: {
  taskName: string;
  /** Quantos takes o disparo tem (mostrado pra dimensionar o custo). */
  totalTakes?: number;
  /** false = VA / troca / sem plano salvo → só oferece reiniciar direto. */
  podeEditar: boolean;
  motivoSemEdicao?: string | null;
  onEditar: () => void;
  onReiniciarDireto: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  const node = (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      onClick={onClose}
      style={{ animation: 'rdmIn 0.18s ease-out' }}
      role="dialog"
      aria-modal="true"
      aria-label="Reiniciar disparo"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[480px] rounded-[18px] border border-violet-400/40 bg-gradient-to-br from-bg-soft/95 via-bg/95 to-bg-soft/95 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_rgba(0,0,0,0.8)]"
        style={{ animation: 'rdmCardIn 0.22s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="label-tech text-[9px] uppercase tracking-[0.18em] text-violet-300/85">
              Reiniciar disparo
            </div>
            <h3
              className="mono mt-0.5 truncate text-[14px] font-bold text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
              title={taskName}
            >
              {taskName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar (ESC)"
            title="Fechar (ESC)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/80 transition-all hover:scale-110 hover:border-white/40 hover:bg-white/[0.08]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Pergunta */}
        <p className="text-[13px] leading-relaxed text-white">
          {podeEditar ? 'Editar antes de reiniciar?' : 'Reiniciar essa task do zero?'}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
          {podeEditar
            ? 'Abre este disparo do jeito que ele foi feito — mesmos avatares, mesmas vozes, mesmos textos — pra você trocar o que quiser antes de gerar de novo.'
            : (motivoSemEdicao
              || 'Essa task não tem plano editável guardado — o reinício refaz o disparo com o que já está salvo.')}
          {typeof totalTakes === 'number' && totalTakes > 0 ? (
            <>
              {' '}
              <span className="text-amber-200">
                São {totalTakes} take{totalTakes === 1 ? '' : 's'} gerados de novo no HeyGen.
              </span>
            </>
          ) : null}
        </p>

        {/* Ações */}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="label-tech rounded-full border border-white/15 px-4 py-2 text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:border-white/35 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onReiniciarDireto}
            className="label-tech rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/85 transition-all hover:-translate-y-[1px] hover:border-white/40 hover:bg-white/[0.1] active:translate-y-0"
          >
            {podeEditar ? 'Não, reiniciar' : 'Reiniciar'}
          </button>
          {podeEditar ? (
            <button
              type="button"
              onClick={onEditar}
              autoFocus
              /* Mesmo roxo do site (btn-primary) — legível nos dois temas. */
              className="btn-primary label-tech !px-5 !py-2 !text-[10px] font-extrabold uppercase tracking-[0.16em]"
            >
              Sim, editar
            </button>
          ) : null}
        </div>

        <style jsx>{`
          @keyframes rdmIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes rdmCardIn {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
