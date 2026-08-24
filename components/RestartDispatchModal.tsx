'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * RestartDispatchModal — a mini janela que aparece ao clicar em REINICIAR
 * no card da task (ClickUp Pilot).
 *
 * Uma pergunta só: "Editar antes de reiniciar?".
 *   · SIM  → abre o painel de reorganização DENTRO do card (avatares/vozes
 *            exatamente como foram disparados) e o disparo só sai quando o
 *            user clicar REINICIAR lá.
 *   · NÃO  → reinicia do zero com o MESMO plano de antes (comportamento
 *            antigo do botão, sem o confirm() feio do browser).
 *
 * Quando a task não tem plano editável (Variação de Avatar, Troca de Áudio
 * ou um batch legado sem `replan`), o modal cai no modo simples: só confirma
 * o reinício e explica por que não dá pra editar aqui.
 *
 * Desenho: mesma gramática do RedispatchPanel (duplo bisel, rótulo em
 * sentença, um acento só, curva de mola). Nada de caixa alta espaçada nem
 * travessão.
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
      className="rdm-backdrop fixed inset-0 z-[130] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Reiniciar disparo"
    >
      {/* Casca do duplo bisel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="rdm-shell w-full max-w-[460px] rounded-[20px] p-[5px]"
      >
        <div className="rdm-core rounded-[15px] p-5">
          {/* Cabeçalho */}
          <div className="flex items-start gap-3">
            <span className="rdm-tile dark-island flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h3
                className="text-[15px] font-semibold leading-tight text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
              >
                {podeEditar ? 'Editar antes de reiniciar?' : 'Reiniciar esta task do zero?'}
              </h3>
              <p className="mt-0.5 truncate text-[12px] text-text-muted" title={taskName}>
                {taskName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar (Esc)"
              className="rdm-x flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {/* Explicação */}
          <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
            {podeEditar
              ? 'Abre este disparo do jeito que ele foi feito, com os mesmos avatares, vozes e textos, para você trocar o que quiser antes de gerar de novo.'
              : (motivoSemEdicao
                || 'Essa task não tem plano editável guardado. O reinício refaz o disparo com o que já está salvo.')}
          </p>
          {typeof totalTakes === 'number' && totalTakes > 0 ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-200/90">
              São {totalTakes} take{totalTakes === 1 ? '' : 's'} gerados de novo no HeyGen.
            </p>
          ) : null}

          {/* Ações */}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-1.5">
            <button type="button" onClick={onClose} className="rdm-ghost rounded-full px-3.5 py-2 text-[11.5px]">
              Cancelar
            </button>
            <button type="button" onClick={onReiniciarDireto} className="rdm-ghost rdm-ghost-forte rounded-full px-3.5 py-2 text-[11.5px]">
              {podeEditar ? 'Não, reiniciar' : 'Reiniciar'}
            </button>
            {podeEditar ? (
              <button
                type="button"
                onClick={onEditar}
                autoFocus
                className="btn-primary group/cta !gap-2.5 !rounded-full !py-1.5 !pl-5 !pr-1.5 !text-[12px] !font-semibold"
              >
                Sim, editar
                <span className="rdm-cta-icone flex h-7 w-7 items-center justify-center rounded-full">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/cta:translate-x-[2px]">
                    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </button>
            ) : null}
          </div>
        </div>

      </div>

      <style jsx>{`
        .rdm-shell {
          background: rgba(255, 255, 255, 0.06);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.08),
            0 40px 90px -30px rgba(0, 0, 0, 0.85);
          animation: rdmCard 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        .rdm-core {
          background:
            radial-gradient(120% 90% at 50% -10%, rgba(139, 92, 246, 0.14), transparent 62%),
            rgb(13, 13, 17);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
        }
        :global(html[data-theme='light']) .rdm-shell {
          background: rgba(16, 16, 24, 0.07);
          box-shadow:
            inset 0 0 0 1px rgba(16, 16, 24, 0.08),
            0 40px 90px -34px rgba(16, 16, 24, 0.45);
        }
        :global(html[data-theme='light']) .rdm-core {
          background:
            radial-gradient(120% 90% at 50% -10%, rgba(139, 92, 246, 0.1), transparent 62%),
            rgb(252, 252, 253);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }
        .rdm-tile {
          background: linear-gradient(155deg, #a78bfa 0%, #7c5cf6 60%, #6366f1 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.35),
            0 8px 18px -10px rgba(124, 92, 246, 0.9);
        }
        .rdm-x {
          color: rgb(var(--text-muted));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s;
        }
        :global(html[data-theme='light']) .rdm-x {
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.1);
        }
        .rdm-x:hover {
          transform: rotate(90deg);
          color: rgb(var(--text));
        }
        .rdm-ghost {
          font-family: var(--font-label), var(--font-display), system-ui;
          font-weight: 500;
          color: rgb(var(--text-muted));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s, box-shadow 0.2s;
        }
        :global(html[data-theme='light']) .rdm-ghost {
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.1);
        }
        .rdm-ghost-forte {
          color: rgb(var(--text));
        }
        .rdm-ghost:hover {
          transform: translateY(-1px);
          color: rgb(var(--text));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
        }
        .rdm-cta-icone {
          background: rgba(255, 255, 255, 0.16);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
          transition: background-color 0.3s cubic-bezier(0.32, 0.72, 0, 1);
        }
        :global(.btn-primary:hover:not(:disabled)) .rdm-cta-icone {
          background: rgba(255, 255, 255, 0.26);
        }
        @keyframes rdmCard {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rdm-shell { animation: none; }
        }
        .rdm-backdrop {
          background: rgba(6, 6, 9, 0.82);
          backdrop-filter: blur(10px);
          animation: rdmFundo 0.2s ease-out both;
        }
        :global(html[data-theme='light']) .rdm-backdrop {
          background: rgba(20, 20, 28, 0.42);
        }
        @keyframes rdmFundo {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}
