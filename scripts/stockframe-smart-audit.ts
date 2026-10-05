/**
 * Auditoria offline do Smart Stocks contra o CATÁLOGO REAL do StockFrame.
 *
 * Roda o mesmo caminho do PilotStockFrame (plano → ranking → alternativas →
 * atribuição sem repetir cena) sobre um dump local do catálogo + as fichas
 * visuais, e imprime trecho por trecho o take escolhido, o porquê e as
 * alternativas. Reprova (exit 1) se houver cena repetida, take que congelaria
 * ou trecho sem alternativa. Não é parte do npm test: depende do dump local.
 *
 * Uso (pelo runner): node scripts/audit-stockframe-smart.mjs <copy.json> [30|60|100] [adaptive|fast|long]
 *   STOCKFRAME_CATALOG=<catalogo.json>   (padrão: ../../../.stockframe-catalogo/catalogo.json da pasta principal)
 *   DEBUG_SEG=3,11 DEBUG_TITLE="industria"   detalha candidatos e o motivo de recusa de um título
 */
import fs from 'node:fs';
import {
  chooseCampaignRecipeTheme, chooseSmartStockAssignments, explainSmartStockScore, fillSmartStockAlternatives,
  inferStockFrameNiche, measureSmartStockCoverage, planSmartStockSegments, rankStockFrameGenericFallback,
  rankStockFrameVideos, selectedSmartCandidate, stockFrameSameVisual, stockFrameUsableSeconds,
  absorbUnfilledSmartSegments, type SmartCoverage, type SmartPace, type StockFrameCopyPart,
} from '../lib/stockframe-smart';
import { installStockFrameVisualAuditForTest, stockFrameVisualAudit } from '../lib/stockframe-visual-audit';
import { visualAuditEntries } from '../data/stockframe-visual-audit';
import type { StockFrameNiche, StockFrameVideo } from '../lib/stockframe';

type DumpVideo = { id: string; code?: string; title: string; description?: string; tags?: string[]; nicho: string; nicheId: string;
  subcategoryId?: string; subpasta?: string; dur?: number; aspect?: string; w?: number; h?: number };

installStockFrameVisualAuditForTest(visualAuditEntries);
const [copyFile, coverageArg = '60', paceArg = 'adaptive'] = process.argv.slice(2);
if (!copyFile) { console.error('Informe o JSON da copy: [{ "label": "HOOK", "text": "..." }, ...]'); process.exit(2); }
const catalogPath = process.env.STOCKFRAME_CATALOG || 'D:/Área de Trabalho/CASABLANCA/.stockframe-catalogo/catalogo.json';
const dump = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as DumpVideo[];
const catalog: StockFrameVideo[] = dump.map((item) => ({
  id: item.id, code: item.code, title: item.title, description: item.description || '', tags: item.tags || [],
  durationSec: Number(item.dur) || 0, width: item.w || 0, height: item.h || 0,
  aspectRatio: item.aspect === '9:16' ? '9:16' : item.aspect === '16:9' ? '16:9' : 'other',
  hasAudio: null, origin: 'unknown', downloads: 0, favorite: false, recent: false,
  nicheId: item.nicheId, nicheName: item.nicho, subcategoryId: item.subcategoryId || undefined, subcategoryName: item.subpasta || undefined,
  downloadCost: 1, available: true, conflictingConcepts: [], matchedConcepts: [],
}));
const niches: StockFrameNiche[] = [...new Map(dump.map((item): [string, StockFrameNiche] => [item.nicheId, { id: item.nicheId, name: item.nicho }])).values()];
const parts = JSON.parse(fs.readFileSync(copyFile, 'utf8')) as StockFrameCopyPart[];
const coverage = Number(coverageArg) as SmartCoverage;
const pace = paceArg as SmartPace;

const niche = inferStockFrameNiche(parts, niches);
const campaignText = parts.map((part) => part.text).join(' ');
const pack = niche ? catalog.filter((video) => video.nicheId === niche.id) : [];
// O pool é o catálogo inteiro: limite superior do que a busca remota traria.
let segments = planSmartStockSegments(parts, { coverage, pace }).map((segment) => ({ ...segment, campaignText, campaignNicheId: niche?.id,
  candidates: rankStockFrameVideos({ ...segment, campaignText, campaignNicheId: niche?.id }, catalog, 24, coverage === 100) }));
const theme = chooseCampaignRecipeTheme(segments);
if (theme.length) segments = segments.map((segment) => ({ ...segment, campaignIngredients: theme,
  candidates: rankStockFrameVideos({ ...segment, campaignIngredients: theme }, catalog, 24, coverage === 100) }));
segments = segments.map((segment) => segment.candidates.length ? segment : { ...segment, candidates: rankStockFrameGenericFallback(segment, catalog, 12) });
segments = fillSmartStockAlternatives(segments, { pool: catalog, pack, minimum: 8 });
let chosen = chooseSmartStockAssignments(segments, true);
if (coverage === 100) chosen = absorbUnfilledSmartSegments(parts, chosen);
chosen = fillSmartStockAlternatives(chosen, { pool: catalog, pack, minimum: 6 });

let repeats = 0; let frozen = 0; let fewAlternatives = 0; let empty = 0;
console.log(`nicho=${niche?.name || '-'} receita=${theme.join('+') || '-'} trechos=${chosen.length} cobertura=${measureSmartStockCoverage(parts, chosen).percent}%`);
for (const [index, segment] of chosen.entries()) {
  const candidate = selectedSmartCandidate(segment);
  const others = chosen.filter((other) => other.id !== segment.id).flatMap((other) => {
    const picked = selectedSmartCandidate(other);
    return picked ? [picked.video] : [];
  });
  const alternatives = segment.candidates.filter((item) => item.video.id !== segment.selectedVideoId && !others.some((video) => stockFrameSameVisual(video, item.video)));
  let flags = '';
  if (!candidate) empty++;
  if (alternatives.length < 3) { fewAlternatives++; flags += ' !!POUCAS-ALTERNATIVAS'; }
  if (candidate) {
    if (chosen.slice(0, index).some((other) => {
      const picked = selectedSmartCandidate(other);
      return picked && stockFrameSameVisual(picked.video, candidate.video);
    })) { repeats++; flags += ' !!REPETE'; }
    const usable = stockFrameUsableSeconds(candidate.video);
    if (usable > 0 && usable / .75 + .2 < segment.targetSeconds) { frozen++; flags += ' !!CONGELA'; }
  }
  const audit = candidate ? stockFrameVisualAudit(candidate.video.id) : undefined;
  console.log(`${String(index + 1).padStart(2)} ${segment.anchor} ~${segment.targetSeconds}s [${segment.visualBeat}] "${segment.text}"`);
  console.log(`    -> ${candidate ? `${candidate.video.title} (${candidate.video.nicheName}, ${candidate.video.durationSec.toFixed(1)}s, ${candidate.score})${candidate.genericFallback ? ' ·reserva' : ''}` : '(avatar)'}${flags}`);
  if (audit) console.log(`       ficha: ${audit.title}`);
  if (candidate) console.log(`       porque: ${candidate.reasons.slice(0, 5).join(' · ')}`);
  console.log(`       alternativas (${alternatives.length}): ${alternatives.slice(0, 5).map((item) => item.video.title).join(' | ')}`);
}
console.log(`\nRESUMO repetidos=${repeats} congela=${frozen} poucas_alternativas=${fewAlternatives} sem_take=${empty} takes=${chosen.filter((segment) => segment.selectedVideoId).length}`);

for (const number of (process.env.DEBUG_SEG || '').split(',').filter(Boolean).map(Number)) {
  const segment = chosen[number - 1];
  if (!segment) continue;
  console.log(`\nDEBUG #${number} "${segment.text}" sentido=${segment.narrativeDirection} beat=${segment.visualBeat} conceitos=${segment.concepts.join(',')}`);
  for (const item of segment.candidates.slice(0, 14)) console.log(`   ${item.score.toFixed(1).padStart(6)} ${item.video.title} [${item.video.nicheName}] :: ${item.reasons.join(' · ')}`);
  const wanted = (process.env.DEBUG_TITLE || '').toLowerCase();
  if (wanted) for (const video of catalog.filter((item) => item.title.toLowerCase().includes(wanted)).slice(0, 5)) {
    const result = explainSmartStockScore(segment, video, 'generic');
    console.log(`   ?? ${video.title}: ${result.score} ${result.reasons.join(' · ')}`);
  }
}
if (repeats || frozen || fewAlternatives) process.exit(1);
