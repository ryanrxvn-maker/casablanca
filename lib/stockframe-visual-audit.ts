import type { StockFrameVideo } from './stockframe';

export type StockFrameVisualAudit = {
  title: string;
  beats: string[];
  appeal: number;
  flags: string[];
  stockTitle: string;
  niche: string;
};

let entries: Record<string, StockFrameVisualAudit> = {};
let loadPromise: Promise<void> | undefined;
let searchSeeds: StockFrameVideo[] | undefined;
let version = 0;

/** Muda sempre que as fichas carregam ou são trocadas: invalida placares em cache. */
export function stockFrameVisualAuditVersion(): number {
  return version;
}

/** Loaded only when the user actually runs Smart Stocks, not on Pilot entry. */
export function loadStockFrameVisualAudit(): Promise<void> {
  if (!loadPromise) loadPromise = import('../data/stockframe-visual-audit')
    .then((module) => { entries = module.visualAuditEntries; searchSeeds = undefined; version++; })
    .catch((error) => { loadPromise = undefined; throw error; });
  return loadPromise;
}

/** Synchronous fixture injection keeps the ranking contract easy to test. */
export function installStockFrameVisualAuditForTest(value: Record<string, StockFrameVisualAudit>): void {
  entries = value;
  searchSeeds = undefined;
  version++;
}

/** Only ID-matched scenes that were checked against contact sheets are used. */
export function stockFrameVisualAudit(videoId: string): StockFrameVisualAudit | undefined {
  return entries[videoId];
}

/** Search hints only. Never use these proxies for preview, import or download:
 * the paid account's live API must return the real video first. */
export function stockFrameAuditedSearchSeeds(): StockFrameVideo[] {
  if (searchSeeds) return searchSeeds;
  searchSeeds = Object.entries(entries).filter(([, audit]) => audit.appeal < 3).map(([id, audit]) => ({
    id, title: audit.stockTitle, description: '', tags: [], durationSec: 0,
    width: 0, height: 0, aspectRatio: 'unknown' as const, hasAudio: null,
    origin: 'unknown' as const, downloads: 0, favorite: false, recent: false,
    nicheName: audit.niche, downloadCost: 1, available: true,
    conflictingConcepts: [], matchedConcepts: [],
  }));
  return searchSeeds;
}
