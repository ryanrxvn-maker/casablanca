import { NextResponse } from 'next/server';

/**
 * POST /api/auto-broll
 *
 * Recebe a copy de uma VSL + contexto (persona do narrador, audiencia,
 * estilo visual de referencia) e devolve um pacote COMPLETO pronto pra
 * producao: tabela de cenas em pt-BR, prompts de video em ingles,
 * bloco de consistencia e um array JSON com prompts "Nano Banana 2"
 * estruturados por tom emocional.
 *
 * O unico LLM aqui e Claude via Messages API (fetch direto — sem SDK
 * adicional). Nenhuma imagem/video e gerado nesse endpoint: ele devolve
 * PROMPTS de alta fidelidade que o usuario alimenta nas APIs de geracao
 * (Nano Banana / Kling) externamente.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  targetAudience: string;
  narratorPersona: string;
  fullCopy: string;
  visualReferenceChunk?: string;
};

const SYSTEM_PROMPT = `You are a Senior Creative Director specialized in direct-response VSL production and AI video prompt engineering (Nano Banana 2, Kling 2.5, Runway, Sora).

Your job: analyze the provided inputs and deliver a production-ready deliverable that is immediately usable to shoot a VSL with AI-generated B-roll.

PACING RULE — MANDATORY
- Every video prompt MUST be designed for a clip of 3 to 5 seconds maximum.
- No scene exceeds 5 seconds.
- If a copy line is long, split it into sequential clips (4a, 4b, 4c…), each 3–5s with visible action.
- No static shots or silent pauses longer than 3s.

VISUAL NARRATIVE FLUIDITY
- Pain scenes: realistic, raw, high-contrast lighting, handheld feel, muted palette.
- Solution / Mechanism: clean, bright, botanical or product-centric, natural window light.
- Authority / Transformation: cinematic, golden hour, aspirational, slow motion optional.
- Keep the narrator persona physically consistent across ALL lifestyle/avatar clips (same face, hair, skin, build).

OUTPUT FORMAT — STRICT
Deliver EXACTLY this structure, in this order, with these exact markdown headings:

## 1. Tabela de cenas (pt-BR)
A markdown table with columns: # | Linha da copy | Categoria | Emoção | Duração (s) | Descrição visual

## 2. Video prompts (English)
For each scene (numbered to match the table, using 4a/4b/4c if splits were needed):
**Scene [N] — [CATEGORY: PAIN / SOLUTION / AUTHORITY]**
- Subject: ...
- Action (beginning → middle → end): ...
- Camera: [shot type + movement]
- Environment: [location + lighting + color palette]
- Emotion/expression: ...
- Suggested duration: [X seconds]
- Style: [realistic / cinematic / slow motion]

## 3. Consistency block (pt-BR)
- **Persona fixa do narrador**: (descrição física reutilizável em todos os prompts de avatar)
- **Paleta dominante por categoria**: dor / solução / autoridade
- **Padrão de câmera por categoria**: dor / solução / autoridade

## 4. Nano Banana 2 JSON
A fenced \`\`\`json ... \`\`\` block containing a JSON array. Each element:
{
  "id": "Scene ID matching the table",
  "tone": "Pain | Mechanism | Solution | Transformation | Authority",
  "nano_banana_prompt": "Hyper-descriptive English prompt: Subject + Precise Action + Environmental Texture + Lighting Type + Camera Lens/Angle. Ultra-realistic, NOT AI-looking.",
  "visual_logic": "Why this specific style for this line (1 sentence)"
}

HARD CONSTRAINTS
- All video prompts MUST feel ultra-realistic, not AI-generated.
- Every prompt MUST specify lens/angle + lighting + micro-action.
- The persona's physical traits (age, hair, skin, build) must be identical across all avatar scenes even when lighting changes.
- Maximum 5 seconds per clip.
- No filler prose. No apologies. No meta-commentary. Deliver the four sections and stop.`;

function buildUserPrompt(b: Body): string {
  return `<target_audience>
${b.targetAudience.trim() || '(not provided — infer a reasonable default and flag it in the consistency block)'}
</target_audience>

<narrator_persona>
${b.narratorPersona.trim() || '(not provided — infer a fitting persona and flag it)'}
</narrator_persona>

<full_copy>
${b.fullCopy.trim()}
</full_copy>

<visual_reference_chunk>
${(b.visualReferenceChunk ?? '').trim() || '(none provided — pick a consistent visual style and state it in the consistency block)'}
</visual_reference_chunk>

Deliver the scene table and consistency block in Portuguese (pt-BR). Deliver the video prompts in English. Deliver the Nano Banana JSON strictly as specified. Follow the 3–5s pacing rule strictly.`;
}

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonError(
        'ANTHROPIC_API_KEY não configurada. Adicione no .env.local e redeploy.',
        500,
      );
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e) {
      return jsonError(
        'Body JSON inválido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    if (!body.fullCopy || body.fullCopy.trim().length < 20) {
      return jsonError(
        'Envie a copy completa da VSL (mínimo 20 caracteres).',
        400,
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
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildUserPrompt(body),
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return jsonError('Falha ao chamar Claude API.', 502, text);
    }

    const json = (await res.json().catch(() => null)) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    } | null;

    if (!json) {
      return jsonError('Resposta inválida da Claude API.', 502);
    }

    const text =
      json.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n\n') ?? '';

    let nanoBananaJson: unknown = null;
    const fence = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (fence) {
      try {
        nanoBananaJson = JSON.parse(fence[1]);
      } catch {
        nanoBananaJson = null;
      }
    }

    return NextResponse.json({
      markdown: text,
      nanoBananaJson,
      usage: json.usage ?? null,
    });
  } catch (e) {
    console.error('[auto-broll route]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
