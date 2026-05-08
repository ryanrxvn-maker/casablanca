'use client';

/**
 * Botão Cancelar — usado em todas as tools que tem fluxo de processing.
 * Mata o FFmpeg WASM worker em andamento (via cancelFFmpeg) e/ou aborta
 * fetch ativos (via AbortController).
 */
export function CancelButton({
  onClick,
  disabled,
  label = 'Cancelar',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-red-500/40 bg-red-500/5 px-5 py-3 text-sm font-medium text-red-300 transition-all duration-200 hover:-translate-y-[1px] hover:border-red-500/70 hover:bg-red-500/10 hover:shadow-[0_0_18px_-4px_rgba(248,113,113,0.5)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden
      >
        <path
          d="M3 3l8 8M11 3l-8 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {label}
    </button>
  );
}
