import { localizeSmartSegments, planSmartStockSegments } from './stockframe-smart';
import { translateStockFrameCopy } from './stockframe-translate';

async function main() {
  const original = planSmartStockSegments([{ label: 'BODY', text: 'My knee hurts when I walk. Now I can climb stairs again.' }], { coverage: 100, pace: 'fast' });
  let translatedCalls = 0;
  const surface = {
    LanguageDetector: {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: .99 }] }),
    },
    Translator: {
      availability: async () => 'available',
      create: async () => ({ translate: async (text: string) => { translatedCalls++;
        return text.includes('hurts') ? 'Meu joelho dói quando caminho.' : 'Agora consigo subir escadas novamente.'; } }),
    },
  };
  const result = await translateStockFrameCopy(original, undefined, surface);
  if (!result.translated || result.language !== 'en' || result.texts.length !== original.length || translatedCalls < original.length) {
    throw new Error('A tradução local não cobriu os segmentos de teste.');
  }
  const localized = localizeSmartSegments(original, result.texts, result.contexts);
  if (!localized.every((segment, index) => segment.text === original[index].text && segment.wordFrom === original[index].wordFrom
      && segment.wordTo === original[index].wordTo && segment.semanticText === result.texts[index])) {
    throw new Error('A tradução alterou a copy exibida ou os índices de montagem.');
  }
  const unavailable = await translateStockFrameCopy(original, undefined, {});
  if (unavailable.translated || unavailable.texts[0] !== original[0].text) throw new Error('Fallback sem API local falhou.');
  const uncertain = await translateStockFrameCopy(original, undefined, {
    LanguageDetector: { availability: async () => 'available', create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: .2 }] }) },
    Translator: surface.Translator,
  });
  if (uncertain.translated) throw new Error('Idioma incerto não pode ser traduzido como se fosse certo.');
  const portuguese = planSmartStockSegments([{ label: 'BODY', text: 'Você não precisa mais sentir dor. Isso aqui é uma solução para você e sua família.' }], { coverage: 100, pace: 'fast' });
  const unchanged = await translateStockFrameCopy(portuguese, undefined, {});
  if (unchanged.language !== 'pt' || unchanged.translated) throw new Error('Copy em português não precisa esperar pacote de tradução.');
  console.log('StockFrame translation: local PT normalization, immutable word ranges and safe fallback OK.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
