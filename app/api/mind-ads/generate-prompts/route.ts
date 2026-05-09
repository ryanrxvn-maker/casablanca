import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';

/**
 * POST /api/mind-ads/generate-prompts
 *
 * Recebe a copy completa + nicho. Devolve, via Claude:
 *   - Lista de takes (segmentos da copy) com tipo (avatar | broll)
 *   - Pra cada take broll: prompt Nano Banana Pro + animacao Wan 2.1
 *   - Numeros sequenciais (take 1, 2, 3...)
 *
 * O front usa esse JSON pra orquestrar a geracao de imagens/animacoes
 * no Replicate em paralelo, depois monta o video final.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

type Body = {
  copy: string;
  niche: string;
  hookVariants?: string[];
};

const SYSTEM_PROMPT = `You are a Senior Creative Director specialized in direct-response VSL ad production. Given a copy in Portuguese, segment it into TAKES.

Each take is one of:
  - "avatar": the AI avatar speaks this segment to camera
  - "broll": a generated b-roll image animated illustrates this segment while the avatar voiceover continues

Decision rules:
  - "Hook" / opening question → avatar (face engaging the viewer)
  - Emotional / abstract claims ("feel free again", "transform your body") → broll
  - Hard data / proof / numbers → broll (chart-like or product shot)
  - Direct CTA ("buy now", "click here") → avatar
  - Problem description → broll (illustrate the pain)
  - Solution mechanism → mix (avatar intro + broll proof)

Output format: JSON array of takes in COPY ORDER:
{
  "takes": [
    {
      "n": 1,
      "type": "avatar" | "broll",
      "copyText": "exact substring of original copy",
      "broll": {
        "imagePrompt": "Nano Banana Pro english prompt — photoreal, cinematic, specific",
        "animationPrompt": "Wan 2.1 english prompt — slow camera move, subtle motion"
      } // only when type === "broll"
    }
  ]
}

Constraints:
  - copyText fields concatenated MUST equal the input copy exactly
  - Image prompts in English, photo-realistic, lens type, lighting, color palette
  - Animation prompts subtle (slow zoom, parallax, atmosphere) — never erratic motion`;

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const keyResult = await getUserKey('anthropic');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const copy = String(body.copy ?? '').trim();
    const niche = String(body.niche ?? '').trim();
    if (copy.length < 50) {
      return jsonError('Copy muito curta (minimo 50 caracteres).', 400);
    }
    if (!niche) {
      return jsonError('Nicho obrigatorio.', 400);
    }

    const userMessage =
      `Niche: ${niche}\n\n` +
      (body.hookVariants && body.hookVariants.length > 0
        ? `Hook variants alternativas (use a melhor pra o primeiro take):\n${body.hookVariants.map((h) => '- ' + h).join('\n')}\n\n`
        : '') +
      `Copy completa:\n<copy>\n${copy}\n</copy>\n\n` +
      'Segment into takes. Return ONLY the JSON object — no prose, no markdown fence.';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na Claude API.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    } | null;

    if (!json) return jsonError('Resposta invalida da Claude.', 502);

    const text =
      json.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim() ?? '';

    let takes;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      takes = JSON.parse(match[0]).takes;
      if (!Array.isArray(takes)) throw new Error('takes is not array');
    } catch (e) {
      return jsonError(
        'Falha ao parsear takes.',
        502,
        text.slice(0, 200),
      );
    }

    return NextResponse.json({
      takes,
      usage: json.usage ?? null,
    });
  } catch (e) {
    console.error('[mind-ads generate-prompts]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
