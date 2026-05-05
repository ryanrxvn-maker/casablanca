import { NextResponse } from 'next/server';

/**
 * POST /api/remover-elementos/detect
 *
 * Recebe um frame JPEG (base64) e retorna bounding boxes das regioes
 * de legenda / watermark detectadas via Claude 3.5 Haiku Vision.
 *
 * Coordenadas retornadas em PORCENTAGEM (0-100) da dimensao da imagem.
 * O frontend re-escala pra pixels do video original na hora de aplicar
 * o filtro delogo.
 *
 * Modelo: claude-3-5-haiku-20241022 — mais barato/rapido com vision,
 * suficiente pra essa tarefa de "achar retangulos com texto".
 *
 * Custo aproximado: ~$0.005 por chamada. Frontend manda 3 frames por
 * video → ~$0.015 por video, ~$0.075 por batch de 5.
 *
 * Sem SDK Anthropic — usa fetch direto na Messages API (mesmo padrao
 * do /api/auto-broll/route.ts pra nao adicionar dependencia).
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Region = {
  type: 'subtitle' | 'watermark';
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type Mode = 'smart' | 'subtitle' | 'watermark';

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail
      ? { error: message, detail: detail.slice(0, 500) }
      : { error: message },
    { status },
  );
}

const PROMPT_BY_MODE: Record<Mode, string> = {
  smart:
    'Analise este frame de video e detecte regioes RETANGULARES contendo:\n' +
    '1. Legendas (texto sobreposto ao video, geralmente parte inferior)\n' +
    '2. Marcas d\'agua, logos ou marcas de canal (elementos graficos persistentes)\n\n' +
    'IGNORE textos que fazem parte natural do conteudo filmado (placas de rua, etiquetas em produtos, livros, etc).\n' +
    'IGNORE rostos, mesmo que tenham letras visiveis.\n' +
    'INCLUA somente texto/grafico que claramente foi sobreposto em pos-producao.',
  subtitle:
    'Analise este frame e detecte APENAS regioes de LEGENDA (texto sobreposto ao video, tipicamente bottom).\n' +
    'IGNORE marcas d\'agua, logos e textos que fazem parte do conteudo natural.',
  watermark:
    'Analise este frame e detecte APENAS regioes de MARCA D\'AGUA, LOGO ou marca de canal sobreposta ao video.\n' +
    'IGNORE legendas e textos que fazem parte do conteudo natural.',
};

const RESPONSE_FORMAT =
  '\n\nResponda EXCLUSIVAMENTE com JSON valido neste formato (sem prosa, sem markdown):\n' +
  '{"regions": [{"type": "subtitle"|"watermark", "x": numero, "y": numero, "width": numero, "height": numero, "confidence": numero}]}\n\n' +
  'Coordenadas em PORCENTAGEM da imagem (0-100). x,y sao o canto superior esquerdo.\n' +
  'Confidence de 0 a 1.\n' +
  'Se nao houver nenhuma regiao a remover, retorne: {"regions": []}';

type AnthropicContentBlock = { type: string; text?: string };
type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonError('ANTHROPIC_API_KEY nao configurada.', 500);
    }

    let body: { frame?: string; mode?: Mode };
    try {
      body = await req.json();
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    if (!body.frame || typeof body.frame !== 'string') {
      return jsonError('Campo "frame" (base64 JPEG) ausente ou invalido.', 400);
    }

    const cleanBase64 = body.frame.replace(/^data:image\/[^;]+;base64,/, '');

    if (cleanBase64.length > 4_500_000) {
      return jsonError(
        'Frame muito grande. Reduza a resolucao da extracao (max ~3MB).',
        413,
      );
    }

    const mode: Mode = (body.mode as Mode) || 'smart';
    const prompt =
      (PROMPT_BY_MODE[mode] ?? PROMPT_BY_MODE.smart) + RESPONSE_FORMAT;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: cleanBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      const t = await apiRes.text().catch(() => '');
      return jsonError('Falha na API Anthropic.', 502, t);
    }

    const result = (await apiRes.json().catch(() => null)) as AnthropicResponse | null;
    if (!result || !result.content) {
      return jsonError('Resposta vazia da Anthropic.', 502);
    }

    const textBlock = result.content.find(
      (b: AnthropicContentBlock) => b.type === 'text',
    );
    if (!textBlock || !textBlock.text) {
      return jsonError('IA retornou resposta sem texto.', 502);
    }

    let parsed: { regions: Region[] };
    try {
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');
      parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed.regions)) {
        parsed.regions = [];
      }
    } catch (e) {
      return jsonError(
        'Falha ao parsear regioes da IA.',
        502,
        textBlock.text.slice(0, 200),
      );
    }

    const sanitized: Region[] = parsed.regions
      .filter(
        (r) =>
          r &&
          (r.type === 'subtitle' || r.type === 'watermark') &&
          typeof r.x === 'number' &&
          typeof r.y === 'number' &&
          typeof r.width === 'number' &&
          typeof r.height === 'number' &&
          r.width > 0.5 &&
          r.height > 0.5,
      )
      .map((r) => ({
        type: r.type,
        x: Math.max(0, Math.min(100, r.x)),
        y: Math.max(0, Math.min(100, r.y)),
        width: Math.max(0.5, Math.min(100, r.width)),
        height: Math.max(0.5, Math.min(100, r.height)),
        confidence:
          typeof r.confidence === 'number'
            ? Math.max(0, Math.min(1, r.confidence))
            : 0.7,
      }));

    return NextResponse.json({
      regions: sanitized,
      usage: result.usage,
    });
  } catch (e) {
    console.error('[remover-elementos detect]', e);
    return jsonError(
      'Erro inesperado no servidor.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
