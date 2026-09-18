'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  HistoryTimeline,
  toolIcon,
  useDisponibilidade,
  useHistoryEvents,
  type FilaAoVivo,
} from './HistoryTimeline';
import { filterHistory, historyToolLabel, type HistoryEvent } from '@/lib/history';
import { travarScrollDaPagina } from '@/lib/trava-scroll';

/**
 * PAINEL DE HISTÓRICO DA FERRAMENTA.
 *
 * Gaveta que abre POR CIMA da própria ferramenta com tudo que ela entregou nos
 * últimos 7 dias — e as ações em cima de cada entrega (baixar · remontar ·
 * debug · remover). É o mesmo motor da página /tools/historico
 * (HistoryTimeline), já filtrado na ferramenta em que o usuário está.
 *
 * O texto aqui é o mínimo: título, dois filtros e a busca. Tudo que dava pra
 * dizer com cor, ícone ou posição não vira frase.
 *
 * Fechar: ESC, clique no fundo ou no ✕. O scroll da página fica travado pelo
 * contador compartilhado (lib/trava-scroll) — nunca pelo jeito ingênuo, que
 * trava a página pra sempre quando duas janelas se cruzam.
 */
export function ToolHistoryPanel({
  tool,
  onClose,
  eventosDeTeste,
  filaDeTeste,
}: {
  tool: string;
  onClose: () => void;
  /** Só a página de preview dev-only passa isto (app/dev/historico-ferramenta). */
  eventosDeTeste?: HistoryEvent[];
  filaDeTeste?: FilaAoVivo;
}) {
  const [query, setQuery] = useState('');
  const [soComArquivo, setSoComArquivo] = useState(false);
  const fecharRef = useRef<HTMLButtonElement>(null);
  // Instante em que a gaveta abriu: um clique rapido demais no fundo, vindo do
  // mesmo gesto que abriu, nao pode fechar o que o usuario acabou de pedir.
  const abertoEm = useRef(Date.now());
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
        if (e.target === e.currentTarget && Date.now() - abertoEm.current > 250) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico — ${label}`}
        className="hist-drawer"
      >
        {/* Cabeçalho */}
        <header className="hist-cabecalho">
          <span className="hist-cabecalho__icone" aria-hidden>
            {toolIcon(tool)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="hist-cabecalho__titulo">{label}</h2>
            <p className="hist-cabecalho__linha">
              <span>Histórico</span>
              <span aria-hidden>·</span>
              <span>7 dias</span>
            </p>
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            title="Fechar"
            className="hist-fechar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {/* Filtros — dois estados num segmento só, e a busca quando faz falta */}
        <div className="hist-filtros">
          <div className="hist-seg" role="group" aria-label="Filtrar registros">
            <button
              type="button"
              onClick={() => setSoComArquivo(false)}
              className={'hist-seg__item' + (!soComArquivo ? ' hist-seg__item--on' : '')}
              aria-pressed={!soComArquivo}
            >
              Tudo <b>{daFerramenta.length}</b>
            </button>
            <button
              type="button"
              onClick={() => setSoComArquivo(true)}
              className={'hist-seg__item' + (soComArquivo ? ' hist-seg__item--on' : '')}
              aria-pressed={soComArquivo}
              title="Só os registros que ainda têm arquivo pra baixar"
            >
              Com arquivo <b>{comArquivo}</b>
            </button>
          </div>
          {daFerramenta.length > 6 ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar no histórico desta ferramenta"
              className="hist-busca"
            />
          ) : null}
        </div>

        {/* Lista */}
        <div className="hist-drawer__body flex-1 overflow-y-auto px-4 py-3.5">
          {visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-16 text-center">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-line-strong bg-bg/50"
                aria-hidden
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-dim))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <p className="text-[13.5px] font-bold text-text" style={{ fontFamily: 'var(--font-tech)' }}>
                {daFerramenta.length === 0 ? 'Nada por aqui ainda' : 'Nenhum resultado'}
              </p>
              <p className="max-w-[280px] text-[12px] leading-relaxed text-text-muted">
                {daFerramenta.length === 0
                  ? 'O que você entregar nesta ferramenta aparece aqui por 7 dias.'
                  : 'Tente outra busca.'}
              </p>
            </div>
          ) : (
            <HistoryTimeline
              events={visiveis}
              disponibilidade={disponibilidade}
              compacto
              mostrarFerramenta={false}
              aoAgir={onClose}
              filaDeTeste={filaDeTeste}
            />
          )}
        </div>

        {/* Rodapé */}
        <footer className="hist-rodape">
          <Link href={`/tools/historico?tool=${encodeURIComponent(tool)}`} onClick={onClose} className="hist-rodape__link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            Histórico geral
          </Link>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
