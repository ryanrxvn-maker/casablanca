/**
 * POLIMENTO DE TÍTULOS pela IA de texto — o ÚNICO ponto do Auto Cortes que
 * ainda fala com uma API, e mesmo assim opcional.
 *
 * Por quê: o curador local (lib/auto-cortes/curador) escolhe os cortes muito
 * bem, mas escrever título/headline a partir de fala transcrita é o único
 * pedaço em que um modelo de linguagem ganha de regra. Então o modelo recebe
 * SÓ o texto dos cortes já escolhidos — uma chamada de ~1,5 mil tokens por
 * vídeo, contra as ~7 chamadas grandes da análise inteira que existia antes.
 *
 * Regra de ouro: isto NUNCA pode derrubar nada. Falhou, faltou chave, bateu no
 * limite? O texto local continua valendo. Ver `polishTitles` — ela nunca lança.
 */

import type { FinalClip } from './analyze';
import { sanitizeHeadline } from './prompts';
import type { Sentence, Transcript } from './types';

const ENDPOINT = '/api/auto-cortes/analyze';

/** Texto falado dentro do corte, cortado no que basta pro modelo entender. */
function trechoDoCorte(t: Transcript, c: FinalClip, maxPalavras = 110): string {
  const dentro: Sentence[] = (t.sentences ?? []).filter(
    (s) => s.endMs > c.startMs + 200 && s.startMs < c.endMs - 200,
  );
  const texto = dentro.map((s) => s.text.trim()).join(' ');
  const palavras = texto.split(/\s+/);
  return palavras.length <= maxPalavras ? texto : `${palavras.slice(0, maxPalavras).join(' ')}…`;
}

export type PolishedTitle = { i: number; title: string; headline: string };

/**
 * Reescreve título e headline dos cortes. Devolve a lista JÁ MESCLADA: cada
 * corte volta com o texto novo quando o modelo entregou algo válido, e com o
 * texto local quando não entregou.
 */
export async function polishTitles(
  clips: FinalClip[],
  transcript: Transcript,
  opts: { signal?: AbortSignal } = {},
): Promise<{ clips: FinalClip[]; ok: boolean; warning?: string }> {
  if (clips.length === 0) return { clips, ok: false };

  const itens = clips.map((c, i) => ({
    i,
    durationSec: Math.round((c.endMs - c.startMs) / 1000),
    atual: c.plan.headline,
    fala: trechoDoCorte(transcript, c),
  }));

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'titles',
        language: transcript.language || 'pt',
        items: itens,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      return {
        clips,
        ok: false,
        warning: `Os títulos ficaram no texto local (${j?.error ?? `erro ${res.status}`}).`,
      };
    }

    const j = (await res.json()) as { titles?: PolishedTitle[] };
    const porIndice = new Map<number, PolishedTitle>();
    for (const t of j.titles ?? []) {
      if (typeof t?.i === 'number') porIndice.set(t.i, t);
    }
    if (porIndice.size === 0) return { clips, ok: false, warning: 'A IA não devolveu títulos; ficou o texto local.' };

    let trocados = 0;
    const saida = clips.map((c, i) => {
      const t = porIndice.get(i);
      const title = String(t?.title ?? '').trim();
      const headline = sanitizeHeadline(String(t?.headline ?? ''));
      // Só aceita o que é utilizável: senão o local (que já foi auditado) vence.
      if (title.length < 8 || title.length > 90 || headline.split(/\s+/).length < 2) return c;
      trocados++;
      return { ...c, plan: { ...c.plan, title: title.slice(0, 90), headline } };
    });

    return {
      clips: saida,
      ok: trocados > 0,
      warning: trocados === 0 ? 'A IA não melhorou os títulos; ficou o texto local.' : undefined,
    };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    console.warn('[auto-cortes] polimento de títulos falhou — seguindo com o texto local:', e);
    return { clips, ok: false, warning: 'A IA de texto não respondeu; os títulos ficaram no texto local.' };
  }
}
