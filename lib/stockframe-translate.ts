import type { SmartStockSegment } from './stockframe-smart';

type Detector = { detect: (text: string) => Promise<{ detectedLanguage: string; confidence: number }[]>; destroy?: () => void };
type Translator = { translate: (text: string) => Promise<string>; destroy?: () => void };
type BrowserTranslation = {
  LanguageDetector?: { availability: () => Promise<string>; create: () => Promise<Detector> };
  Translator?: { availability: (pair: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
    create: (pair: { sourceLanguage: string; targetLanguage: string; monitor?: (monitor: { addEventListener: (type: string, listener: (event: { loaded?: number }) => void) => void }) => void }) => Promise<Translator> };
};

export type StockFrameTranslation = {
  language: string;
  translated: boolean;
  texts: string[];
  contexts: string[];
  note?: string;
};

const translationCache = new Map<string, StockFrameTranslation>();

function clearlyPortuguese(text: string): boolean {
  const sample = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (sample.match(/\b(?:voce|nao|uma|com|pra|tambem|entao|aqui|isso|sao|estou|tenho|ficou)\b/g) || []).length >= 4;
}

/** Chrome's on-device language packs are optional. Never change word indices:
 * translations are used only for search/ranking, not the displayed copy. */
export async function translateStockFrameCopy(segments: SmartStockSegment[],
  onProgress?: (message: string) => void, surface: BrowserTranslation = globalThis as BrowserTranslation): Promise<StockFrameTranslation> {
  const original = { language: 'unknown', translated: false, texts: segments.map((segment) => segment.text),
    contexts: segments.map((segment) => segment.contextText || segment.text) };
  const sample = original.texts.join(' ').slice(0, 4000);
  const cacheKey = JSON.stringify(segments.map((segment) => [segment.text, segment.contextText || '']));
  const useCache = surface === globalThis;
  if (useCache && translationCache.has(cacheKey)) return translationCache.get(cacheKey)!;
  if (clearlyPortuguese(sample)) return { ...original, language: 'pt' };
  if (!segments.length || !surface.LanguageDetector || !surface.Translator) {
    return { ...original, note: 'Tradução local indisponível neste navegador; busca multilíngue original mantida.' };
  }
  let detector: Detector | undefined;
  let translator: Translator | undefined;
  try {
    const detectionAvailability = await surface.LanguageDetector.availability();
    if (detectionAvailability === 'unavailable') return { ...original, note: 'Detecção local indisponível; busca original mantida.' };
    onProgress?.('Detectando o idioma da copy no dispositivo…');
    detector = await surface.LanguageDetector.create();
    const detected = (await detector.detect(sample))[0];
    const language = detected?.detectedLanguage?.split('-')[0]?.toLowerCase() || 'unknown';
    if (!/^[a-z]{2,3}$/.test(language) || (detected?.confidence || 0) < .55) {
      return { ...original, note: 'Idioma não identificado com confiança; busca original mantida.' };
    }
    if (language === 'pt') return { ...original, language: 'pt' };
    const pair = { sourceLanguage: language, targetLanguage: 'pt' };
    if (await surface.Translator.availability(pair) === 'unavailable') {
      return { ...original, language, note: `Pacote local ${language}→pt indisponível; busca original mantida.` };
    }
    onProgress?.(`Preparando tradução local ${language.toUpperCase()} → PT…`);
    translator = await surface.Translator.create({ ...pair, monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        if (typeof event.loaded === 'number') onProgress?.(`Preparando idioma ${language.toUpperCase()} no Chrome… ${Math.round(event.loaded * 100)}%`);
      });
    } });
    const memo = new Map<string, string>();
    const translate = async (value: string) => {
      if (!value.trim()) return value;
      const cached = memo.get(value);
      if (cached !== undefined) return cached;
      const translated = (await translator!.translate(value)).trim();
      if (!translated) throw new Error('A tradução local devolveu texto vazio.');
      memo.set(value, translated);
      return translated;
    };
    const texts: string[] = [];
    const contexts: string[] = [];
    for (let index = 0; index < segments.length; index++) {
      texts.push(await translate(segments[index].text));
      contexts.push(await translate(segments[index].contextText || segments[index].text));
      onProgress?.(`Interpretando a copy no idioma do catálogo… ${index + 1}/${segments.length}`);
    }
    const result = { language, translated: true, texts, contexts };
    if (useCache) {
      translationCache.set(cacheKey, result);
      if (translationCache.size > 5) {
        const oldestKey = translationCache.keys().next().value;
        if (oldestKey !== undefined) translationCache.delete(oldestKey);
      }
    }
    return result;
  } catch {
    return { ...original, note: 'Tradução local não concluiu; busca original mantida.' };
  } finally {
    translator?.destroy?.();
    detector?.destroy?.();
  }
}
