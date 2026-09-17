'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  HistoryTimeline,
  fmtBytes,
  toolIcon,
  useDisponibilidade,
  useHistoryEvents,
} from './HistoryTimeline';
import { filterHistory, historyToolLabel, type HistoryEvent } from '@/lib/history';
import { travarScrollDaPagina } from '@/lib/trava-scroll';

/**
 * PAINEL DE HISTÓRICO DA FERRAMENTA.
 *
 * Gaveta que abre POR CIMA da própria ferramenta com tudo que aquela
 * ferramenta entregou nos últimos 7 dias — e o botão pra baixar de novo. É o
 * mesmo motor da página /tools/historico (HistoryTimeline), só que já filtrado
 * na ferramenta em que o usuário está: ninguém precisa sair do fluxo, procurar
 * numa lista geral e voltar.
 *
 * Fechar: ESC, clique no fundo ou no ✕. O scroll da página fica travado pelo
 * contador compartilhado (lib/trava-scroll) — nunca pelo jeito ingênuo, que
 * trava a página pra sempre quando duas janelas se cruzam.
 */
export function ToolHistoryPanel({
  tool,
  onClose,
  eventosDeTeste,
}: {
  tool: string;
  onClose: () => void;
  /** Só a página de preview dev-only passa isto (app/dev/historico-ferramenta). */
  eventosDeTeste?: HistoryEvent[];
}) {
  const [query, setQuery] = useState('');
  const [soComArquivo, setSoComArquivo] = useState(false);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const reais = useHistoryEvents();
  const todos = eventosDeTeste ?? reais;
  const disponibilidade = useDisponibilidade(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const destravar = travarScrollDaPagina();
    fecharRef.current?.focus();
    // Poda em ocioso: abrir o histórico é a hora natural de limpar o que
    // passou dos 7 dias, e nunca no caminho quente de uma ferramenta rodando.
    void import('@/lib/history-vault').then((v) => v.scheduleVaultPrune()).catch(() => {});
    return () => {
      document.removeEventListener('keydown', onKey);
      destravar();
    };
  }, [onClose]);

  const daFerramenta = useMemo(() => filterHistory(todos, { tool }), [todos, tool]);
  const visiveis = useMemo(
    () => filterHistory(daFerramenta, { query, soRecuperaveis: soComArquivo }),
    [daFerramenta, query, soComArquivo],
  );
  const comArquivo = useMemo(
    () => daFerramenta.filter((e) => (e.ref?.length ?? 0) > 0).length,
    [daFerramenta],
  );

  const label = historyToolLabel(tool);

  return createPortal(
    <div
      className="hist-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico — ${label}`}
        className="hist-drawer"
      >
        {/* Cabeçalho */}
        <header className="flex items-start gap-3 border-b border-line/60 px-5 py-4">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border border-line-strong bg-bg/50"
            aria-hidden
          >
            {toolIcon(tool)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet"
              style={{ fontFamily: 'var(--font-label)' }}
            >
              Histórico da ferramenta
            </p>
            <h2
              className="truncate text-[19px] font-bold leading-tight text-text"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
              Tudo que você fez aqui nos últimos 7 dias — e o que dá pra baixar de novo.
            </p>
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-text-muted transition hover:border-violet/50 hover:text-text"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {/* Resumo + filtros */}
        <div className="flex flex-col gap-2.5 border-b border-line/60 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSoComArquivo(false)}
              className={chipCls(!soComArquivo)}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {`Tudo · ${daFerramenta.length}`}
            </button>
            <button
              type="button"
              onClick={() => setSoComArquivo(true)}
              className={chipCls(soComArquivo)}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {`Com arquivo · ${comArquivo}`}
            </button>
            {disponibilidade.vaultInfo ? (
              <span className="mono ml-auto text-[10px] text-text-dim">
                {`cofre ${fmtBytes(disponibilidade.vaultInfo.bytes)}`}
              </span>
            ) : null}
          </div>
          {daFerramenta.length > 4 ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por arquivo ou detalhe…"
              aria-label="Buscar no histórico desta ferramenta"
              className="input-field !py-2 !text-[12.5px]"
            />
          ) : null}
        </div>

        {/* Lista */}
        <div className="hist-drawer__body flex-1 overflow-y-auto px-5 py-4">
          {visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-14 text-center">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-line-strong bg-bg/50"
                aria-hidden
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgb(var(--text-dim))"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <p
                className="text-[14px] font-bold text-text"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {daFerramenta.length === 0 ? 'Nada por aqui ainda' : 'Nenhum resultado'}
              </p>
              <p className="max-w-[300px] text-[12.5px] leading-relaxed text-text-muted">
                {daFerramenta.length === 0
                  ? 'Assim que você entregar algo nesta ferramenta, aparece aqui — com o botão pra baixar de novo por 7 dias.'
                  : 'Tente outra busca ou volte pra "Tudo".'}
              </p>
            </div>
          ) : (
            <HistoryTimeline
              events={visiveis}
              disponibilidade={disponibilidade}
              compacto
              mostrarFerramenta={false}
            />
          )}
        </div>

        {/* Rodapé */}
        <footer className="flex items-center justify-between gap-3 border-t border-line/60 px-5 py-3">
          <p className="text-[10.5px] leading-snug text-text-dim">
            Os registros somem depois de 7 dias.
          </p>
          <Link
            href="/tools/historico"
            onClick={onClose}
            className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-[11px] font-bold text-text-muted transition hover:border-violet/45 hover:text-text"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Histórico geral
          </Link>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function chipCls(active: boolean): string {
  return (
    'rounded-full border px-3 py-1 text-[11px] font-bold transition-all duration-200 active:scale-[0.96] ' +
    (active
      ? 'border-violet/60 bg-violet/15 text-text'
      : 'border-line-strong text-text-muted hover:border-violet/40 hover:text-text')
  );
}
