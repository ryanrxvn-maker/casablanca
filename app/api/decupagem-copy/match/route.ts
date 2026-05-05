import { NextResponse } from 'next/server';

/**
 * POST /api/decupagem-copy/match
 *
 * Recebe (multipart):
 *   - audio: arquivo OPUS (extraido client-side a 12kbps mono)
 *   - copy: texto da copy/script
 *
 * Pipeline:
 *   1. Upload audio → AssemblyAI
 *   2. Cria transcript com word-level timestamps (language pt)
 *   3. Polling ate completar
 *   4. Algoritmo de matching: pra cada frase da copy, acha o melhor
 *      span no transcript baseado em completude + fluencia + ausencia
 *      de fillers + pausas limpas nos boundaries
 *   5. Retorna lista de cuts em ORDEM da copy
 *
 * Custo aproximado: AssemblyAI cobra ~$0.40/h de audio. Pra 40min: ~$0.27.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AAI_BASE = 'https://api.assemblyai.com/v2';

type Word = {
  text: string;
  start: number;
  end: number;
  confidence: number;
};

type TranscriptPoll = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: Word[];
  error?: string;
};

type Cut = {
  startMs: number;
  endMs: number;
  copyPhrase: string;
  transcriptText: string;
  score: number;
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail
      ? { error: message, detail: detail.slice(0, 500) }
      : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      return jsonError('ASSEMBLYAI_API_KEY nao configurada.', 500);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return jsonError(
        'Falha ao ler upload. O audio pode estar acima do limite (~4MB no Vercel).',
        413,
        e instanceof Error ? e.message : String(e),
      );
    }

    const audio = form.get('audio');
    const copyText = String(form.get('copy') ?? '').trim();

    if (!(audio instanceof File)) {
      return jsonError('Audio ausente no campo "audio".', 400);
    }
    if (!copyText) {
      return jsonError('Copy ausente no campo "copy".', 400);
    }
    if (copyText.length > 50000) {
      return jsonError('Copy muito grande (max 50000 caracteres).', 400);
    }

    // 1. Upload audio para AssemblyAI
    const audioBytes = new Uint8Array(await audio.arrayBuffer());
    const uploadRes = await fetch(`${AAI_BASE}/upload`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      body: audioBytes,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      return jsonError('Falha no upload AssemblyAI.', 502, t);
    }
    const uploadJson = (await uploadRes.json().catch(() => null)) as
      | { upload_url: string }
      | null;
    if (!uploadJson?.upload_url) {
      return jsonError('AssemblyAI retornou upload sem URL.', 502);
    }

    // 2. Cria transcript
    const trRes = await fetch(`${AAI_BASE}/transcript`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadJson.upload_url,
        language_code: 'pt',
        punctuate: true,
        format_text: true,
      }),
    });
    if (!trRes.ok) {
      const t = await trRes.text().catch(() => '');
      return jsonError('Falha ao criar transcricao.', 502, t);
    }
    const created = (await trRes.json().catch(() => null)) as
      | { id: string }
      | null;
    if (!created?.id) {
      return jsonError('AssemblyAI nao retornou transcript id.', 502);
    }

    // 3. Polling
    const deadline = Date.now() + 4 * 60 * 1000;
    let words: Word[] = [];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
        headers: { authorization: apiKey },
      });
      const body = (await poll.json().catch(() => null)) as TranscriptPoll | null;
      if (!body) {
        return jsonError('Resposta invalida do AssemblyAI.', 502);
      }
      if (body.status === 'completed') {
        words = body.words ?? [];
        break;
      }
      if (body.status === 'error') {
        return jsonError(body.error ?? 'Erro na transcricao.', 502);
      }
    }
    if (words.length === 0) {
      return jsonError(
        'Timeout ou transcricao vazia. Verifique se o audio tem fala em portugues.',
        504,
      );
    }

    // 4. Match copy → cuts
    const cuts = matchCopyToWords(copyText, words);
    if (cuts.length === 0) {
      return jsonError(
        'Nao consegui alinhar nenhuma frase da copy com o que foi falado. Confira se a copy realmente corresponde a este video.',
        422,
      );
    }

    return NextResponse.json({
      cuts,
      transcriptPreview: words
        .map((w) => w.text)
        .join(' ')
        .slice(0, 500),
    });
  } catch (e) {
    console.error('[decupagem-copy match]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ---------- Matcher ------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function splitIntoPhrases(copy: string): string[] {
  return copy
    .split(/[.!?\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
}

const FILLERS = new Set([
  'uh', 'ah', 'eh', 'oh', 'hum', 'tipo', 'tipow',
  'entao', 'sabe', 'aham', 'ne', 'tipoassim', 'pois',
]);

/**
 * Pra cada frase da copy:
 *  - Tokeniza
 *  - Encontra todos os spans candidatos no transcript (sliding window
 *    permitindo ate 4 palavras "extra" entre matches → cobre stutters,
 *    fillers, repeticoes intermediarias)
 *  - Score: completude (0.55) + fluencia (0.15) + sem-fillers (0.15) +
 *    boundary limpo (0.15)
 *  - Pega o melhor com score >= 0.5
 *
 * Mantem ordem da copy mesmo se o transcript tiver as frases em outra
 * ordem ou repetidas.
 */
function matchCopyToWords(copy: string, words: Word[]): Cut[] {
  if (words.length === 0) return [];
  const phrases = splitIntoPhrases(copy);
  const tokens = words.map((w) => tokenize(w.text)[0] ?? '');

  const cuts: Cut[] = [];

  for (const phrase of phrases) {
    const expected = tokenize(phrase);
    if (expected.length === 0) continue;

    let bestScore = 0;
    let bestStart = -1;
    let bestEnd = -1;

    for (let start = 0; start < tokens.length; start++) {
      if (tokens[start] !== expected[0]) continue;

      // Sliding match: pra cada palavra esperada, busca a proxima ocorrencia
      // dentro de uma janela de "maxSkip" palavras de transcript. Isso permite
      // que stutters/fillers entre os matches nao quebrem a deteccao.
      let matched = 1;
      let lastIdx = start;
      let exp_i = 1;
      const maxSkip = 4;

      for (let i = start + 1; i < tokens.length && exp_i < expected.length; i++) {
        if (i - lastIdx > maxSkip) break;
        if (tokens[i] === expected[exp_i]) {
          matched++;
          lastIdx = i;
          exp_i++;
        }
      }

      const completeness = matched / expected.length;
      if (completeness < 0.6) continue;

      const span = words.slice(start, lastIdx + 1);
      const spanTokens = tokens.slice(start, lastIdx + 1);

      // Fluencia: variancia das duracoes de palavra. Voz fluente tem
      // duracoes consistentes (sem grandes pausas internas).
      const durs = span.map((w) => w.end - w.start);
      const meanDur = durs.reduce((a, b) => a + b, 0) / durs.length;
      const varDur =
        durs.reduce((a, b) => a + (b - meanDur) ** 2, 0) / durs.length;
      const fluency =
        meanDur > 0 ? Math.max(0, 1 - Math.sqrt(varDur) / meanDur) : 0;

      // Sem fillers: penaliza spans com muito "uh/ah/tipo/entao"
      const fillerCount = spanTokens.filter((t) => FILLERS.has(t)).length;
      const noFillers = 1 - fillerCount / spanTokens.length;

      // Boundary: gap antes/depois do span — quanto mais "silencio" nas
      // bordas, mais limpo o cut.
      const gapBefore =
        start > 0 ? span[0].start - words[start - 1].end : 1500;
      const gapAfter =
        lastIdx < words.length - 1
          ? words[lastIdx + 1].start - span[span.length - 1].end
          : 1500;
      const boundary = Math.min(1, (gapBefore + gapAfter) / 1500);

      const score =
        completeness * 0.55 +
        fluency * 0.15 +
        noFillers * 0.15 +
        boundary * 0.15;

      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = lastIdx;
      }
    }

    if (bestStart >= 0 && bestScore >= 0.5) {
      const span = words.slice(bestStart, bestEnd + 1);
      cuts.push({
        startMs: span[0].start,
        endMs: span[span.length - 1].end,
        copyPhrase: phrase,
        transcriptText: span.map((w) => w.text).join(' '),
        score: bestScore,
      });
    }
  }

  return cuts;
}
