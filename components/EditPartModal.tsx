'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * EditPartModal — modal pra re-gerar 1 take especifico do batch HeyGen
 * sem refazer o batch inteiro. User edita o script (e/ou voz) e clica
 * REFRESH; a parte mantem o label (BODY 2 continua BODY 2 na montagem),
 * so o conteudo muda.
 *
 * Apos refresh OK, page.tsx marca a parte como dirty → BatchJobCard3D
 * mostra botao "Atualizar montagem" que re-roda runPostPipeline e gera
 * novo ZIP montado/camuflado.
 */

export type EditPartInput = {
  label: string;
  /** Texto atual (vindo do replan). Editavel. */
  text: string;
  /** Avatar fixo — read-only (mudar avatar quebraria a continuidade visual do AD). */
  avatarName?: string;
  /** Voz atual (id+nome opcional). Editavel se onPickVoice for fornecido. */
  voiceId?: string | null;
  voiceName?: string | null;
};

export function EditPartModal({
  input,
  onClose,
  onRegenerate,
  /** Picker de avatar — page.tsx renderiza CompactAvatarPicker controlado por state externo. */
  avatarPicker,
  /** Picker de voz — page.tsx renderiza CompactVoiceSelector controlado por state externo. */
  voicePicker,
  /** Se true, mostra spinner no botao refresh + bloqueia interacoes. */
  busy = false,
  /** Mensagem opcional de erro vinda do disparo. */
  errorMsg,
}: {
  input: EditPartInput;
  onClose: () => void;
  onRegenerate: (newText: string) => void;
  avatarPicker?: React.ReactNode;
  voicePicker?: React.ReactNode;
  busy?: boolean;
  errorMsg?: string | null;
}) {
  const [text, setText] = useState(input.text);
  const hasChange = text.trim() !== input.text.trim();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  if (typeof window === 'undefined') return null;

  const node = (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      onClick={() => { if (!busy) onClose(); }}
      style={{ animation: 'epmIn 0.2s ease-out' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[560px] rounded-[18px] border border-cyan-400/30 bg-gradient-to-br from-bg-soft/95 via-bg/95 to-bg-soft/95 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_rgba(0,0,0,0.8)]"
        style={{ animation: 'epmCardIn 0.25s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/80">Re-gerar take</div>
            <h3 className="mono mt-0.5 text-[14px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
              <span className="text-lime">{input.label}</span>
            </h3>
            {input.avatarName && !avatarPicker ? (
              <div className="mono mt-0.5 text-[10px] text-text-muted">avatar: <span className="text-white/80">{input.avatarName}</span></div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            aria-label="Fechar (ESC)"
            title="Fechar (ESC)"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/80 transition-all hover:scale-110 hover:border-white/40 hover:bg-white/[0.08] disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Avatar + Voice pickers — lado a lado em wide, empilhado em narrow */}
        {(avatarPicker || voicePicker) ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {avatarPicker ? (
              <div>
                <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">Avatar</div>
                {avatarPicker}
              </div>
            ) : null}
            {voicePicker ? (
              <div>
                <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">Voz</div>
                {voicePicker}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Script editor */}
        <div>
          <div className="mono mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
            <span>Script</span>
            <span className="text-text-muted/60">{text.length} chars</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder="Digite o texto que o avatar vai falar nessa parte…"
            className="mono w-full resize-y rounded-[10px] border border-white/12 bg-bg-soft/60 px-3 py-2.5 text-[12px] leading-relaxed text-white outline-none transition-colors placeholder:text-text-muted/50 hover:border-white/25 focus:border-cyan-400/50 disabled:opacity-50"
            rows={8}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>

        {errorMsg ? (
          <div className="mono mt-3 rounded-[8px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {errorMsg}
          </div>
        ) : null}

        {/* Footer — REFRESH 3D + Cancelar */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            className="mono rounded-full border border-white/15 px-4 py-2 text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:border-white/35 hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          {/* REFRESH 3D — icon-only, lift+glow no hover */}
          <button
            type="button"
            onClick={() => onRegenerate(text.trim())}
            disabled={busy || text.trim().length === 0}
            title={
              busy
                ? 'Re-gerando…'
                : text.trim().length === 0
                ? 'Texto vazio'
                : hasChange
                ? 'Re-gerar essa parte com o novo conteudo'
                : 'Re-gerar essa parte (mesmo conteudo — usa quando algo deu errado)'
            }
            aria-label="Re-gerar"
            className="group relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/55 bg-gradient-to-b from-cyan-400/25 via-cyan-400/10 to-cyan-400/[0.02] text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-3px_rgba(34,211,238,0.55)] transition-all hover:-translate-y-0.5 hover:scale-[1.08] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_14px_30px_-6px_rgba(34,211,238,0.75)] active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:scale-100"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/15 to-transparent" aria-hidden />
            {busy ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="animate-spin" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
              </svg>
            )}
          </button>
        </div>

        <style jsx>{`
          @keyframes epmIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes epmCardIn {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
