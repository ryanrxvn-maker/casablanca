'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { GUIDE_PATHS } from '@/components/tool-guides/routes';
import { countByTool, historyToolForPath } from '@/lib/history';
import { useHistoryEvents } from '@/components/history/HistoryTimeline';

/**
 * BOTÃO DE HISTÓRICO DA FERRAMENTA — um por ferramenta, sem exceção.
 *
 * Fica fixo no canto superior direito (abaixo do "Como usar" quando a
 * ferramenta tem guia) e abre a gaveta com TUDO que aquela ferramenta entregou
 * nos últimos 7 dias, com o botão de baixar de novo.
 *
 * Mora no layout de /tools de propósito: a ferramenta sai da rota do pathname,
 * então qualquer página de ferramenta — inclusive as que vierem depois — ganha
 * o botão sem precisar lembrar de plugar nada. Quem decide se a rota tem
 * histórico é historyToolForPath() (lib/history-tools.ts), testado no node.
 *
 * O painel é lazy: nenhum byte dele entra no bundle da ferramenta até o clique.
 */
const ToolHistoryPanel = dynamic(
  () => import('@/components/history/ToolHistoryPanel').then((m) => m.ToolHistoryPanel),
  { ssr: false },
);

export function ToolHistoryFab() {
  const pathname = usePathname();
  const tool = useMemo(() => historyToolForPath(pathname), [pathname]);
  // Rota que não é ferramenta (o próprio histórico geral, o console interno,
  // pontos, calculadora) não monta NADA — nem o botão, nem a leitura do
  // histórico que o selo precisa.
  if (!tool) return null;
  return <Fab tool={tool} pathname={pathname} />;
}

function Fab({ tool, pathname }: { tool: string; pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const [montado, setMontado] = useState(false);
  // Atraso BEM maior que o do painel: aqui só o contador do selo depende
  // disso, e ler o histórico varre o armazenamento da conta inteiro. Num
  // disparo grande do Pilot as gravações são constantes — a cada 5s custa
  // nada, a cada tiro pesaria na ferramenta que está trabalhando.
  const events = useHistoryEvents(5000);

  const total = useMemo(() => countByTool(events).get(tool) ?? 0, [events, tool]);

  useEffect(() => {
    const t = setTimeout(() => setMontado(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Trocou de ferramenta: fecha (o painel é sempre da ferramenta atual).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const temGuia = !!pathname && GUIDE_PATHS.has(pathname);

  return (
    <>
      <div
        className={
          'hist-fab fixed right-7 z-[53] flex flex-col items-center gap-1.5 transition-opacity duration-500 ' +
          (temGuia ? 'top-[206px]' : 'top-[92px]') +
          (montado ? ' opacity-100' : ' opacity-0')
        }
      >
        <button
          type="button"
          className="hist-fab__btn"
          aria-label={`Histórico desta ferramenta${total > 0 ? ` (${total} registros)` : ''}`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M3 12a9 9 0 1 0 3-6.7"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3 4v4h4"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 8v4l3 2"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {total > 0 ? (
            <span className="hist-fab__dot" aria-hidden>
              {total > 99 ? '99+' : total}
            </span>
          ) : null}
        </button>
        <span className="hist-fab__label" aria-hidden>
          Histórico
        </span>
      </div>

      {open ? <ToolHistoryPanel tool={tool} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
