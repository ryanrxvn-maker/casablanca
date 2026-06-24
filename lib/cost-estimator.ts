/**
 * Estimador de custo por ferramenta de IA.
 *
 * Os valores sao calibrados com base nas tabelas oficiais de Anthropic,
 * AssemblyAI e ElevenLabs (atualizados em maio 2026). Nao e exato — IAs
 * cobram por tokens reais que so se sabe ao final, mas a margem de erro
 * fica em torno de 10-20% pra mais ou pra menos.
 *
 * Cota cambial USD-BRL hardcoded em 5,20. Ajuste manual quando necessario,
 * ou implemente fetch dinamico de exchangerate.host (~1/dia).
 */

export const USD_TO_BRL = 5.2;

export type CostBreakdown = {
  service: string;
  quantity: string;
  usd: number;
};

export type CostEstimate = {
  usd: number;
  brl: number;
  breakdown: CostBreakdown[];
  /** True se algum termo do calculo foi adivinhado (ex: tokens de output). */
  approximate: boolean;
};

const PRICES = {
  // Anthropic — claude-sonnet-4-5: $3/MTok input, $15/MTok output
  claudeSonnetInPerToken: 3 / 1_000_000,
  claudeSonnetOutPerToken: 15 / 1_000_000,
  // claude-3-5-haiku: $0.80/MTok input, $4/MTok output
  claudeHaikuInPerToken: 0.8 / 1_000_000,
  claudeHaikuOutPerToken: 4 / 1_000_000,
  // AssemblyAI Nano transcript: $0.0002/s = $0.72/h.
  // (Standard model: $0.65/h, Nano: $0.42/h. Usamos $0.45/h como meio-termo.)
  assemblyAiPerSec: 0.45 / 3600,
  // ElevenLabs Multilingual V2: ~$0.30/1k chars (Starter plan).
  elevenlabsPerChar: 0.0003,
} as const;

function mkBRL(usd: number): number {
  return Math.max(0, usd) * USD_TO_BRL;
}

// =====================================================================
// Auto B-Roll — Claude Sonnet 4.5
// =====================================================================

export function estimateAutoBroll(copyChars: number): CostEstimate {
  // System prompt + user prompt overhead ~ 800 tokens
  // Cada 4 chars de copy ≈ 1 token (regra grossa)
  const inputTokens = Math.ceil(copyChars / 4) + 800;
  // Saida estruturada — tipicamente 3500-5000 tokens
  const outputTokens = 4000;

  const inputUsd = inputTokens * PRICES.claudeSonnetInPerToken;
  const outputUsd = outputTokens * PRICES.claudeSonnetOutPerToken;
  const usd = inputUsd + outputUsd;

  return {
    usd,
    brl: mkBRL(usd),
    approximate: true,
    breakdown: [
      {
        service: 'Claude Sonnet (input)',
        quantity: `${inputTokens.toLocaleString('pt-BR')} tokens`,
        usd: inputUsd,
      },
      {
        service: 'Claude Sonnet (output)',
        quantity: `~${outputTokens.toLocaleString('pt-BR')} tokens`,
        usd: outputUsd,
      },
    ],
  };
}

// =====================================================================
// Remover Elementos — Claude Haiku Vision
// =====================================================================

export function estimateRemoverElementos(params: {
  numVideos: number;
  framesPerVideo?: number;
}): CostEstimate {
  const frames = params.numVideos * (params.framesPerVideo ?? 3);
  // Cada frame: ~1500 input tokens (image) + 200 (prompt) = 1700 input
  // Output: ~250 tokens (JSON regions)
  const inputTokens = frames * 1700;
  const outputTokens = frames * 250;

  const inputUsd = inputTokens * PRICES.claudeHaikuInPerToken;
  const outputUsd = outputTokens * PRICES.claudeHaikuOutPerToken;
  const usd = inputUsd + outputUsd;

  return {
    usd,
    brl: mkBRL(usd),
    approximate: true,
    breakdown: [
      {
        service: 'Claude Haiku Vision',
        quantity: `${frames} frames (${params.numVideos} vídeo${params.numVideos === 1 ? '' : 's'})`,
        usd,
      },
    ],
  };
}

// =====================================================================
// Decupagem por Copy — AssemblyAI
// =====================================================================

export function estimateDecupagemCopy(durationSec: number): CostEstimate {
  const usd = durationSec * PRICES.assemblyAiPerSec;
  return {
    usd,
    brl: mkBRL(usd),
    approximate: false,
    breakdown: [
      {
        service: 'AssemblyAI (transcricao com timestamps)',
        quantity: `${(durationSec / 60).toFixed(1)} min`,
        usd,
      },
    ],
  };
}

// =====================================================================
// Formatador BRL
// =====================================================================

export function formatBRL(brl: number): string {
  if (brl < 0.01) return 'R$ <0,01';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: brl < 1 ? 3 : 2,
  }).format(brl);
}

export function formatUSD(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  return '$' + usd.toFixed(usd < 1 ? 3 : 2);
}
