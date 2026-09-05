'use client';

/**
 * PilotFontesBar — as barras de ação dos modos DOCS e CREATOR do Pilot.
 *
 *  DocsBar    · link do Google Docs ou arquivo (.docx/.txt) → "Carregar tasks";
 *               chips dos docs já importados pra voltar a qualquer um deles.
 *  CreatorBar · "+ Nova task" e o compositor (nome + copy colada).
 *
 * Só apresentação: quem guarda estado e fala com o resto do Pilot é a página.
 * Mesma linguagem do CTA "Carregar tasks" do ClickUp (pílula com brilho), cada
 * modo na sua cor: ciano pro DOCS, âmbar pro CREATOR.
 */

import type { ReactNode } from 'react';

const CTA_BASE =
  'cp-load-cta group relative overflow-hidden rounded-[14px] border px-5 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-black transition-all disabled:opacity-60';

function Brilho() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
    />
  );
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/60 border-t-transparent" />;
}

/* ═══════════════════════════ DOCS ═══════════════════════════ */

export type DocChip = {
  key: string;
  rotulo: string;
  /** Quantas tasks (ADs) esse doc tem. */
  n: number;
  ativo: boolean;
  title?: string;
};

export function DocsBar({
  link,
  onLink,
  onImportarLink,
  onImportarArquivo,
  importando,
  docs,
  onEscolherDoc,
}: {
  link: string;
  onLink: (v: string) => void;
  onImportarLink: () => void;
  onImportarArquivo: (file: File) => void;
  importando: boolean;
  docs: DocChip[];
  onEscolherDoc: (key: string) => void;
}) {
  return (
    <div className="relative grid gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="url"
          value={link}
          onChange={(e) => onLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onImportarLink();
          }}
          placeholder="Cole o link do Google Docs da copy"
          disabled={importando}
          spellCheck={false}
          aria-label="Link do Google Docs"
          className="mono min-w-[240px] flex-1 rounded-[14px] border border-line/70 bg-bg/40 px-4 py-3 text-[12.5px] text-text outline-none transition focus:border-cyan-400/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.15)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onImportarLink}
          disabled={importando || !link.trim()}
          className={CTA_BASE + ' border-cyan-400/60'}
          style={{
            fontFamily: 'var(--font-tech)',
            background: 'linear-gradient(135deg, #7fe4f5 0%, #22d3ee 100%)',
            boxShadow: '0 0 28px -6px rgba(34,211,238,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.2)',
          }}
        >
          <span className="relative z-10 flex items-center gap-2">
            {importando ? (
              <>
                <Spinner />
                Lendo doc…
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
          className={
            'mono inline-flex items-center gap-2 rounded-full border border-line-strong px-3.5 py-2 text-[10px] uppercase tracking-widest text-text-muted transition ' +
            (importando ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-cyan-400 hover:text-cyan-200')
          }
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
          </svg>
          importar arquivo (.docx / .txt)
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="field-label mr-1">Docs importados</span>
          {docs.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => onEscolherDoc(d.key)}
              title={d.title || d.rotulo}
              aria-pressed={d.ativo}
              className={
                'mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] uppercase tracking-[0.12em] transition ' +
                (d.ativo
                  ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100 shadow-[0_0_14px_-6px_rgba(34,211,238,0.7)]'
                  : 'border-line-strong text-text-muted hover:border-cyan-400/60 hover:text-cyan-200')
              }
            >
              {d.rotulo}
              <span className={'tabular-nums ' + (d.ativo ? 'text-cyan-200' : 'text-text-muted')}>· {d.n}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-[12.5px] leading-relaxed text-text-muted">
        Cada heading no padrão <span className="mono text-text">AD12VN - NOME</span> vira uma task, como no ClickUp. O idioma é
        detectado por task: com PL ou HUN no doc, o português é a tradução e a voz sai na outra língua.
      </p>
    </div>
  );
}

/* ═══════════════════════════ CREATOR ═══════════════════════════ */

export type ComposerState = { taskId?: string; nome: string; copy: string };

export function CreatorBar({
  composer,
  onComposer,
  onNova,
  onSalvar,
  onCancelar,
  nomeValido,
  extra,
}: {
  composer: ComposerState | null;
  onComposer: (c: ComposerState) => void;
  onNova: () => void;
  onSalvar: () => void;
  onCancelar: () => void;
  /** O nome começa com AD<n>? (é ele que batiza os arquivos) */
  nomeValido: (nome: string) => boolean;
  /** Espaço opcional ao lado do botão (ex.: contagem). */
  extra?: ReactNode;
}) {
  const ok = composer ? nomeValido(composer.nome) : false;
  return (
    <div className="relative grid gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onNova}
          disabled={!!composer && !composer.taskId}
          className={CTA_BASE + ' border-amber-400/60'}
          style={{
            fontFamily: 'var(--font-tech)',
            background: 'linear-gradient(135deg, #fcd57a 0%, #f0b429 100%)',
            boxShadow: '0 0 28px -6px rgba(251,191,36,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.2)',
          }}
        >
          <span className="relative z-10 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nova task
          </span>
          <Brilho />
        </button>
        <span className="text-[12.5px] leading-relaxed text-text-muted">
          Task do zero: nome e copy colada. O resto é igual ao ClickUp: avatares, versões, decupagem, legendas.
        </span>
        {extra}
      </div>
      {composer ? (
        <div
          className="grid gap-3 rounded-[14px] border border-amber-400/35 p-4"
          style={{
            background: 'linear-gradient(180deg, rgba(251,191,36,0.06), rgba(0,0,0,0.12))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
            <label className="grid gap-1.5">
              <span className="field-label">Nome da task</span>
              <input
                value={composer.nome}
                onChange={(e) => onComposer({ ...composer, nome: e.target.value })}
                spellCheck={false}
                className="mono rounded-[12px] border border-line/70 bg-bg/40 px-3.5 py-2.5 text-[13px] font-semibold text-text outline-none transition focus:border-amber-400/70 focus:shadow-[0_0_0_3px_rgba(251,191,36,0.14)]"
                style={{ fontFamily: 'var(--font-tech)' }}
              />
            </label>
            <span className="text-[12.5px] leading-relaxed text-text-muted">
              Começa com AD e um número: é ele que batiza os arquivos (AD01 vira AD01G1.mp4). Depois do traço, o nome que você quiser.
            </span>
          </div>
          <label className="grid gap-1.5">
            <span className="field-label">Copy</span>
            <textarea
              value={composer.copy}
              onChange={(e) => onComposer({ ...composer, copy: e.target.value })}
              rows={9}
              spellCheck={false}
              placeholder={'Doutor: @nome_do_avatar\n\nHOOK 1\nTexto do gancho...\n\nBODY\nTexto do corpo...'}
              className="mono min-h-[180px] resize-y rounded-[12px] border border-line/70 bg-bg/40 px-3.5 py-3 text-[12.5px] leading-relaxed text-text outline-none transition focus:border-amber-400/70 focus:shadow-[0_0_0_3px_rgba(251,191,36,0.14)]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSalvar}
              disabled={!composer.copy.trim() || !ok}
              className="group relative overflow-hidden rounded-[12px] border border-amber-400/60 px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.16em] text-black transition-all disabled:opacity-50"
              style={{
                fontFamily: 'var(--font-tech)',
                background: 'linear-gradient(135deg, #fcd57a 0%, #f0b429 100%)',
                boxShadow: '0 0 22px -6px rgba(251,191,36,0.5), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.2)',
              }}
            >
              <span className="relative z-10 flex items-center gap-2">
                {composer.taskId ? 'Salvar e analisar de novo' : 'Criar e analisar'}
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </span>
            </button>
            <button
              type="button"
              onClick={onCancelar}
              className="mono rounded-full border border-line-strong px-3.5 py-2 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-red-500/60 hover:text-red-300"
            >
              cancelar
            </button>
            {!ok ? <span className="text-[12px] text-amber-300">O nome precisa começar com AD e um número.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
