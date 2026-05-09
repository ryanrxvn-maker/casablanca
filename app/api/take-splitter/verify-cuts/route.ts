import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/take-splitter/verify-cuts
 *
 * Recebe candidatos de cortes (cada um com 1 frame ANTES e 1 frame DEPOIS
 * do timestamp). Manda em batch pra Claude Haiku Vision e retorna
 * verificacao por candidato: e corte real ou falso positivo do scdet?
 *
 * Body: {
 *   candidates: Array<{
 *     time: number;          // segundos
 *     frameBefore: string;   // base64 JPEG
 *     frameAfter: string;
 *   }>
 * }
 *
 * Output: {
 *   verified: Array<{
 *     time: number;
 *     isRealCut: boolean;
 *     reason?: string;
 *   }>
 * }
 *
 * Custo: Haiku 4.5 vision ~$1/M input. Cada candidato = 2 imagens ≈ 3K
 * tokens = $0.003. Pra 30 candidatos: ~$0.09. Batch de 5 candidatos
 * por chamada Anthropic reduz pra 6 chamadas.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

type Candidate = {
  time: number;
  frameBefore: string;
  frameAfter: string;
};

const BATCH_SIZE = 5;

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

const SYSTEM_PROMPT = `You are a senior video editor analyzing scene cut detection results from an FFmpeg scene-change algorithm. The algorithm sometimes produces FALSE POSITIVES (e.g. flashes, fast camera movements, lighting changes within the same scene).

Given pairs of frames (frame BEFORE and frame AFTER each candidate cut timestamp), classify each candidate as:
  - REAL_CUT: distinct scenes (different location, different shot composition, different subject, hard cut)
  - FALSE_POSITIVE: same scene continuing (motion, flash, lighting change, fast pan, transition fade)

Be CONSERVATIVE — when in doubt, mark as REAL_CUT (better to keep an extra cut than miss a real one).

Return ONLY a JSON object:
{
  "verifications": [
    { "time": <number>, "isRealCut": true|false, "reason": "<short>" }
  ]
}`;

export async function POST(req: Request) {
  try {
    const keyResult = await getUserKey('anthropic');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let body: { candidates?: Candidate[] };
    try {
      body = await req.json();
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const candidates = body.candidates ?? [];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return jsonError('candidates obrigatorio (array).', 400);
    }
    if (candidates.length > 200) {
      return jsonError('Max 200 candidatos por chamada.', 400);
    }

    const verified: Array<{
      time: number;
      isRealCut: boolean;
      reason?: string;
    }> = [];

    // Processa em batches paralelos (max 4 simultaneos pra nao estourar
    // rate-limit da Anthropic Tier 1)
    const batches: Candidate[][] = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(candidates.slice(i, i + BATCH_SIZE));
    }

    const POOL = 4;
    let cursor = 0;
    let firstError: Error | null = null;

    async function processBatch(batch: Candidate[]) {
      const content: Array<
        | { type: 'text'; text: string }
        | {
            type: 'image';
            source: { type: 'base64'; media_type: string; data: string };
          }
      > = [
        {
          type: 'text',
          text:
            `Analyze ${batch.length} candidate cuts. For each, I send the frame BEFORE then the frame AFTER. ` +
            `Times: ${batch.map((c) => c.time.toFixed(2)).join(', ')}s.\n\n` +
            `Return verification as JSON.`,
        },
      ];

      for (const c of batch) {
        content.push(
          {
            type: 'text',
            text: `Cut at ${c.time.toFixed(2)}s — frame BEFORE:`,
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: c.frameBefore.replace(/^data:image\/jpeg;base64,/, ''),
            },
          },
          {
            type: 'text',
            text: `frame AFTER:`,
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: c.frameAfter.replace(/^data:image\/jpeg;base64,/, ''),
            },
          },
        );
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content }],
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Haiku ${res.status}: ${t.slice(0, 200)}`);
      }

      const json = (await res.json().catch(() => null)) as {
        content?: Array<{ type: string; text?: string }>;
      } | null;

      const text =
        json?.content
          ?.filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('\n')
          .trim() ?? '';

      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Haiku nao retornou JSON.');
      const parsed = JSON.parse(m[0]) as {
        verifications?: Array<{
          time: number;
          isRealCut: boolean;
          reason?: string;
        }>;
      };
      if (!Array.isArray(parsed.verifications)) {
        throw new Error('verifications missing/invalid');
      }
      return parsed.verifications;
    }

    await new Promise<void>((resolve) => {
      let inFlight = 0;
      const dispatch = () => {
        if (firstError && inFlight === 0) {
          resolve();
          return;
        }
        while (inFlight < POOL && cursor < batches.length) {
          const batch = batches[cursor++];
          inFlight++;
          processBatch(batch)
            .then((verifs) => {
              verified.push(...verifs);
            })
            .catch((e) => {
              if (!firstError) firstError = e as Error;
            })
            .finally(() => {
              inFlight--;
              if (cursor >= batches.length && inFlight === 0) resolve();
              else dispatch();
            });
        }
        if (cursor >= batches.length && inFlight === 0) resolve();
      };
      dispatch();
    });

    if (firstError) {
      return jsonError(
        'Falha ao verificar cuts com IA.',
        502,
        (firstError as Error).message,
      );
    }

    // Ordena por time e dedup (Haiku as vezes repete)
    verified.sort((a, b) => a.time - b.time);
    const dedup = new Map<string, typeof verified[number]>();
    for (const v of verified) {
      const k = v.time.toFixed(2);
      if (!dedup.has(k)) dedup.set(k, v);
    }

    return NextResponse.json({
      verified: Array.from(dedup.values()),
      total: candidates.length,
      kept: Array.from(dedup.values()).filter((v) => v.isRealCut).length,
    });
  } catch (e) {
    console.error('[take-splitter verify-cuts]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
