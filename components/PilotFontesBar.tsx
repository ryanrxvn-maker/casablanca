'use client';

/**
 * PilotFontesBar — a AÇÃO de cada modo do Pilot, logo abaixo do trilho.
 *
 *  CreatorBar · o "+" grande: cada clique cria uma task do zero e abre o card
 *               de análise (avatares primeiro, copy depois, pelo olhinho).
 *  DocsBar    · link do Google Docs ou arquivo (.docx/.txt, também arrastando)
 *               → "Carregar tasks"; chips dos docs já importados.
 *
 * Só apresentação: quem guarda estado e fala com o resto do Pilot é a página.
 * Sem frases: ícone, campo, botão. Cada modo na sua cor (âmbar, ciano).
 */

import { useState, type DragEvent } from 'react';

function Brilho() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
    />
  );
}

/* ═══════════════════════════ CREATOR ═══════════════════════════ */

export function CreatorBar({
  onNova,
  disabled = false,
  criando = false,
}: {
  onNova: () => void;
  disabled?: boolean;
  /** Task sendo criada/aberta agora (trava o clique duplo). */
  criando?: boolean;
}) {
  const travado = disabled || criando;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onNova}
        disabled={travado}
        title="Nova task"
        aria-label="Nova task"
        className="pfb-plus group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] text-black disabled:opacity-60"
        style={{
          background: 'linear-gradient(135deg, #fcd57a 0%, #f0b429 100%)',
          boxShadow:
            '0 0 34px -8px rgba(251,191,36,0.75), inset 0 0 0 1px rgba(255,255,255,0.28), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.22)',
        }}
      >
        {criando ? (
          <span className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-black/55 border-t-transparent" />
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="relative z-10">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        <Brilho />
      </button>
      <span
        className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Nova task
      </span>
      <style jsx>{`
        .pfb-plus {
          transition:
            transform 220ms cubic-bezier(0.32, 0.72, 0, 1),
            box-shadow 220ms ease;
        }
        .pfb-plus:not(:disabled):hover {
          transform: translateY(-2px);
          box-shadow:
            0 0 44px -8px rgba(251, 191, 36, 0.85),
            inset 0 0 0 1px rgba(255, 255, 255, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.45),
            inset 0 -2px 0 rgba(0, 0, 0, 0.22) !important;
        }
        .pfb-plus:not(:disabled):active {
          transform: translateY(1px) scale(0.97);
          transition-duration: 80ms;
        }
        .pfb-plus:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pfb-plus,
          .pfb-plus:not(:disabled):hover,
          .pfb-plus:not(:disabled):active {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════ DOCS ═══════════════════════════ */

export type DocChip = {
  key: string;
  rotulo: string;
  /** Quantas tasks (ADs) esse doc tem. */
  n: number;
  ativo: boolean;
  title?: string;
  /** "05/09" ou similar; vai na linha de apoio do cartão */
  quando?: string;
  /** link | arquivo */
  origem?: 'link' | 'arquivo' | 'colado';
};

const ACEITA = /\.(docx|txt|md)$/i;

export function DocsBar({
  link,
  onLink,
  onImportarLink,
  onImportarArquivo,
  importando,
  docs,
  onEscolherDoc,
  onRemoverDoc,
}: {
  link: string;
  onLink: (v: string) => void;
  onImportarLink: () => void;
  onImportarArquivo: (file: File) => void;
  importando: boolean;
  docs: DocChip[];
  onEscolherDoc: (key: string) => void;
  /** Tira o doc importado (e as tasks dele) — só deste navegador. */
  onRemoverDoc?: (key: string) => void;
}) {
  const [arrastando, setArrastando] = useState(false);

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    if (importando) return;
    const f = Array.from(e.dataTransfer.files || []).find((x) => ACEITA.test(x.name));
    if (f) onImportarArquivo(f);
  }

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!arrastando) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className="pfb-drop flex flex-wrap items-center gap-2.5 rounded-[14px] p-1.5"
        style={{
          boxShadow: arrastando
            ? 'inset 0 0 0 2px rgba(34,211,238,0.75), 0 0 40px -12px rgba(34,211,238,0.6)'
            : 'inset 0 0 0 1px rgba(34,211,238,0)',
          background: arrastando ? 'rgba(34,211,238,0.06)' : 'transparent',
          transition: 'box-shadow 200ms ease, background 200ms ease',
        }}
      >
        <label className="relative flex min-w-[220px] flex-1 items-center">
          <span className="pointer-events-none absolute left-4 text-cyan-300/80" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
              <path d="M9 13h6M9 17h6" />
            </svg>
          </span>
          <input
            type="url"
            value={link}
            onChange={(e) => onLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onImportarLink();
            }}
            placeholder="Link do Google Docs"
            disabled={importando}
            spellCheck={false}
            aria-label="Link do Google Docs"
            className="mono w-full rounded-[12px] bg-bg/40 py-3 pl-11 pr-4 text-[12.5px] text-text outline-none transition disabled:opacity-60"
            style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.7)' }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(34,211,238,0.7), 0 0 0 3px rgba(34,211,238,0.14)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgb(var(--line) / 0.7)';
            }}
          />
        </label>
        <button
          type="button"
          onClick={onImportarLink}
          disabled={importando || !link.trim()}
          className="cp-load-cta group relative h-12 overflow-hidden rounded-[12px] px-5 text-[12.5px] font-bold uppercase tracking-[0.16em] text-black transition-all disabled:opacity-50"
          style={{
            fontFamily: 'var(--font-tech)',
            background: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)',
            boxShadow: '0 0 28px -6px rgba(34,211,238,0.55), inset 0 0 0 1px rgba(255,255,255,0.28), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2)',
          }}
        >
          <span className="relative z-10 flex items-center gap-2">
            {importando ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/60 border-t-transparent" />
                Lendo…
              </>
            ) : (
              <>
                Carregar tasks
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </>
            )}
          </span>
          <Brilho />
        </button>
        <label
          title="Importar arquivo (.docx ou .txt). Também dá pra arrastar o arquivo aqui."
          className={
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-text-muted transition ' +
            (importando ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:text-cyan-200')
          }
          style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.7)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
          </svg>
          <input
            type="file"
            accept=".docx,.txt,.md,text/plain"
            className="hidden"
            disabled={importando}
            aria-label="Importar arquivo do doc"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onImportarArquivo(f);
            }}
          />
        </label>
      </div>
      {docs.length > 0 ? (
        <div className="grid gap-2 px-1.5 sm:grid-cols-2">
          {docs.map((d) => (
            <div
              key={d.key}
              role="button"
              tabIndex={0}
              aria-pressed={d.ativo}
              onClick={() => onEscolherDoc(d.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEscolherDoc(d.key);
                }
              }}
              title={d.title || d.rotulo}
              className={
                'pfb-doc group relative flex cursor-pointer items-center gap-3 rounded-[14px] p-2.5 pr-2 text-left outline-none transition ' +
                (d.ativo ? 'is-on' : '')
              }
              style={{
                background: d.ativo
                  ? 'linear-gradient(180deg, rgba(34,211,238,0.14), rgba(34,211,238,0.04)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.12)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                boxShadow: d.ativo
                  ? 'inset 0 0 0 1px rgba(34,211,238,0.6), inset 0 1px 0 rgba(255,255,255,0.08), 0 14px 30px -20px rgba(34,211,238,0.7)'
                  : 'inset 0 0 0 1px rgb(var(--line) / 0.7), inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              {/* tile do doc: acende em ciano quando é o ativo */}
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
                style={
                  d.ativo
                    ? {
                        color: '#04121a',
                        background: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)',
                        boxShadow: '0 0 20px -6px rgba(34,211,238,0.75), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.2)',
                      }
                    : { color: 'rgb(var(--text) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.8)' }
                }
                aria-hidden
              >
                {d.origem === 'arquivo' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                    <path d="M9 13h6M9 17h6" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={'block truncate text-[13px] font-bold ' + (d.ativo ? 'text-white' : 'text-text')}
                  style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
                >
                  {d.rotulo}
                </span>
                <span className="mono mt-0.5 block text-[10.5px] uppercase tracking-[0.1em] text-text-muted">
                  {d.quando ? `${d.quando} · ` : ''}
                  <b className={'tabular-nums ' + (d.ativo ? 'text-cyan-200' : 'text-text')}>{d.n}</b> task{d.n === 1 ? '' : 's'}
                  {d.ativo ? <span className="text-cyan-300"> · na tela</span> : null}
                </span>
              </span>
              {onRemoverDoc ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoverDoc(d.key);
                  }}
                  title="Remover este doc e as tasks dele (só deste navegador)"
                  aria-label="Remover doc"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-text-muted transition hover:text-red-300"
                  style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--line) / 0.7)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <style jsx>{`
        .pfb-doc {
          transition:
            transform 220ms cubic-bezier(0.32, 0.72, 0, 1),
            box-shadow 220ms ease;
        }
        .pfb-doc:hover {
          transform: translateY(-1px);
        }
        .pfb-doc:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.55);
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pfb-doc,
          .pfb-doc:hover {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
