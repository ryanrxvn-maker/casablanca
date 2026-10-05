import type { StockFrameFeelingNiche } from '../data/stockframe-feeling';

export type { StockFrameFeelingNiche };

let entries: Record<string, StockFrameFeelingNiche> = {};
let loadPromise: Promise<void> | undefined;

/** Feeling do Silas (fala → cena que ele usou), carregado só quando o Smart
 * Stocks roda — nunca na abertura do Pilot. Falha de chunk não trava a busca. */
export function loadStockFrameFeeling(): Promise<void> {
  if (!loadPromise) loadPromise = import('../data/stockframe-feeling')
    .then((module) => { entries = module.stockFrameFeeling; })
    .catch((error) => { loadPromise = undefined; throw error; });
  return loadPromise;
}

/** Injeção síncrona para os testes do ranking. */
export function installStockFrameFeelingForTest(value: Record<string, StockFrameFeelingNiche>): void {
  entries = value;
}

export function stockFrameFeelingNiche(niche: string): StockFrameFeelingNiche | undefined {
  return entries[niche];
}
