'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  filtrarPorOrigemEData,
  origemDoEvento,
  type JanelaDeDias,
  type OrigemDoDisparo,
} from '@/lib/history-acoes';
import type { HistoryEvent } from '@/lib/history';

/**
 * FILTRO DO HISTÓRICO: por DATA e por ORIGEM do disparo.
 *
 * Duas perguntas que o dono faz o tempo todo olhando a lista: "o que eu fiz
 * hoje?" e "o que saiu do Creator?". O resto (ferramenta e busca) já tem
 * filtro próprio.
 *
 * A régua dos contadores é cruzada de propósito: a contagem de cada origem
 * respeita a data escolhida e vice-versa. Assim o número no chip é o número de
 * linhas que vão aparecer se clicar nele, nunca uma promessa que a tela quebra.
 *
 * Os chips de origem só aparecem quando há MAIS DE UMA origem na lista. Numa
 * ferramenta que não é o Pilot (compressor, legenda) eles seriam três botões
 * mortos, e botão morto é pior que botão ausente.
 */
export type FiltroOrigemData = {
  origem: OrigemDoDisparo | null;
  dias: JanelaDeDias | null;
  eventos: HistoryEvent[];
  ativo: boolean;
  porOrigem: Record<OrigemDoDisparo, number>;
  porData: { hoje: number; ontem: number };
  mostrarOrigem: boolean;
  escolherOrigem: (o: OrigemDoDisparo) => void;
  escolherDias: (d: JanelaDeDias | null) => void;
  limpar: () => void;
};

export function useFiltroDeOrigemEData(base: HistoryEvent[]): FiltroOrigemData {
  const [origem, setOrigem] = useState<OrigemDoDisparo | null>(null);
  const [dias, setDias] = useState<JanelaDeDias | null>(null);

  const eventos = useMemo(
    () => filtrarPorOrigemEData(base, { origem, dias }),
    [base, origem, dias],
  );

  // Contagem de origem dentro da DATA escolhida (e não da lista inteira).
  const porOrigem = useMemo(() => {
    const conta: Record<OrigemDoDisparo, number> = { clickup: 0, creator: 0, docs: 0 };
    for (const e of filtrarPorOrigemEData(base, { dias })) {
      const o = origemDoEvento(e);
      if (o) conta[o] += 1;
    }
    return conta;
  }, [base, dias]);

  // Contagem de data dentro da ORIGEM escolhida.
  const porData = useMemo(() => {
    const naOrigem = filtrarPorOrigemEData(base, { origem });
    return {
      hoje: filtrarPorOrigemEData(naOrigem, { dias: 0 }).length,
      ontem: filtrarPorOrigemEData(naOrigem, { dias: 1 }).length,
    };
  }, [base, origem]);

  // Só vale mostrar quando há de fato mais de uma procedência na lista.
  const mostrarOrigem = useMemo(() => {
    const vistas = new Set<OrigemDoDisparo>();
    for (const e of base) {
      const o = origemDoEvento(e);
      if (o) vistas.add(o);
      if (vistas.size > 1) return true;
    }
    return false;
  }, [base]);

  const escolherOrigem = useCallback((o: OrigemDoDisparo) => {
    // Clicar de novo no chip aceso tira o filtro: não precisa de um "Tudo".
    setOrigem((atual) => (atual === o ? null : o));
  }, []);

  const limpar = useCallback(() => {
    setOrigem(null);
    setDias(null);
  }, []);

  return {
    origem,
    dias,
    eventos,
    ativo: origem !== null || dias !== null,
    porOrigem,
    porData,
    mostrarOrigem,
    escolherOrigem,
    escolherDias: setDias,
    limpar,
  };
}

const NOME_DA_ORIGEM: Record<OrigemDoDisparo, string> = {
  clickup: 'Pilot',
  creator: 'Creator',
  docs: 'Docs',
};

const ORDEM: OrigemDoDisparo[] = ['clickup', 'creator', 'docs'];

export function FiltrosDeOrigemEData({
  origem,
  dias,
  porOrigem,
  porData,
  mostrarOrigem,
  escolherOrigem,
  escolherDias,
  solto,
}: FiltroOrigemData & { /** Fora da gaveta: sem a moldura de linha do painel. */ solto?: boolean }) {
  // Sem nenhum registro de hoje nem de ontem, o grupo de data seria decorativo.
  const mostrarData = porData.hoje > 0 || porData.ontem > 0;
  if (!mostrarData && !mostrarOrigem) return null;

  return (
    <div
      className={'hist-filtros2' + (solto ? ' hist-filtros2--solto' : '')}
      role="group"
      aria-label="Filtrar por data e origem"
    >
      {mostrarData ? (
        <div className="hist-seg" role="group" aria-label="Filtrar por data">
          <button
            type="button"
            onClick={() => escolherDias(null)}
            aria-pressed={dias === null}
            className={'hist-seg__item' + (dias === null ? ' hist-seg__item--on' : '')}
          >
            7 dias
          </button>
          <button
            type="button"
            onClick={() => escolherDias(0)}
            aria-pressed={dias === 0}
            className={'hist-seg__item' + (dias === 0 ? ' hist-seg__item--on' : '')}
          >
            Hoje <b>{porData.hoje}</b>
          </button>
          <button
            type="button"
            onClick={() => escolherDias(1)}
            aria-pressed={dias === 1}
            className={'hist-seg__item' + (dias === 1 ? ' hist-seg__item--on' : '')}
          >
            Ontem <b>{porData.ontem}</b>
          </button>
        </div>
      ) : null}

      {mostrarOrigem ? (
        <div className="hist-fchips" role="group" aria-label="Filtrar pela origem do disparo">
          {ORDEM.filter((o) => porOrigem[o] > 0 || origem === o).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => escolherOrigem(o)}
              aria-pressed={origem === o}
              title={
                origem === o
                  ? 'Clique de novo pra tirar o filtro'
                  : `Só o que veio do ${NOME_DA_ORIGEM[o]}`
              }
              className={'hist-fchip' + (origem === o ? ' hist-fchip--on' : '')}
            >
              {NOME_DA_ORIGEM[o]} <b>{porOrigem[o]}</b>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
