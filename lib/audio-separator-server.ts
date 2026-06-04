/**
 * SERVER-ONLY. Separação de áudio via Replicate Demucs v4 (Meta).
 *
 * Por que Replicate e NÃO HuggingFace Space:
 *   A Space gratuita gradio/audio-separation-mdx está FORA DO AR ("Space
 *   metadata could not be loaded"). Spaces grátis caem direto. O Replicate
 *   é pago mas tem confiabilidade industrial — é o mesmo motor que o
 *   /api/voice-isolate-pro já usa em produção nesta conta.
 *
 * Modelo: Demucs htdemucs (hybrid transformer) — gold standard de music
 * source separation. Devolve 4 trilhas: vocals, drums, bass, other.
 * Os "alvos" que o usuário vê (voz / trilha / SFX) são montados no client
 * a partir dessas 4 (ver lib/audio-separator.ts).
 *
 * Input: uma URL pública do áudio (o client subiu direto pro Supabase). O
 * Replicate baixa dessa URL — nada de arquivo grande passando pela Vercel.
 *
 * Output: { vocals, drums, bass, other } com URLs replicate.delivery.
 */

import Replicate from 'replicate';
import type { RawStem } from './audio-separator';

// Modelo Demucs no Replicate. Mesmo default e env do voice-isolate-pro pra
// compartilhar a configuração que já funciona nesta conta. cjwbw/demucs é o
// mais estabelecido (~30k+ runs).
const DEMUCS_MODEL = (process.env.REPLICATE_DEMUCS_MODEL ||
  'cjwbw/demucs') as `${string}/${string}`;

export type SeparateInput = {
  /** URL pública do áudio (Supabase) que o Replicate vai baixar. */
  audioUrl: string;
};

export type SeparateResult =
  | { ok: true; stems: Record<RawStem, string> }
  | {
      ok: false;
      error: string;
      kind: 'quota' | 'runtime' | 'config' | 'network';
    };

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e).slice(0, 400);
  } catch {
    return String(e);
  }
}

function classify(msg: string): 'quota' | 'runtime' | 'config' | 'network' {
  const m = msg.toLowerCase();
  if (
    m.includes('quota') ||
    m.includes('exceeded') ||
    m.includes('rate limit') ||
    m.includes('insufficient credit') ||
    m.includes('billing')
  )
    return 'quota';
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout'))
    return 'network';
  return 'runtime';
}

/** Extrai uma URL http de FileData / string / objeto com .url(). */
function extractUrl(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof (o as { url?: unknown }).url === 'function') {
      try {
        const u = (o as { url: () => string }).url();
        return typeof u === 'string' && u.startsWith('http') ? u : null;
      } catch {
        return null;
      }
    }
    if (typeof o.url === 'string' && o.url.startsWith('http')) return o.url;
    if (typeof o.path === 'string' && o.path.startsWith('http')) return o.path;
  }
  return null;
}

/**
 * Casa o output do Demucs nas 4 trilhas. O formato varia por fork do modelo:
 *   - dict  { vocals, drums, bass, other }            (ryan5453, lucataco)
 *   - array [drums, bass, other, vocals]              (cjwbw — ordem fixa)
 *   - array de FileData com nome do stem no path/url
 */
function pickStems(data: unknown): Partial<Record<RawStem, string>> {
  const out: Partial<Record<RawStem, string>> = {};

  // 1) Dict nomeado — o caso mais limpo.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    for (const stem of ['vocals', 'drums', 'bass', 'other'] as RawStem[]) {
      const u = extractUrl(o[stem]);
      if (u) out[stem] = u;
    }
    // Aliases comuns: "accompaniment"/"no_vocals" ~ other quando 2-stem.
    if (!out.other) {
      const alt = extractUrl(o.accompaniment ?? o.no_vocals ?? o.instrumental);
      if (alt) out.other = alt;
    }
    if (Object.keys(out).length) return out;
  }

  // 2) Array — tenta casar pelo nome no URL primeiro; senão cai na ordem
  //    convencional do cjwbw/demucs: [drums, bass, other, vocals].
  if (Array.isArray(data)) {
    const urls = data.map(extractUrl).filter(Boolean) as string[];
    let matchedByName = false;
    for (const u of urls) {
      const low = u.toLowerCase();
      if (/vocal/.test(low)) {
        out.vocals = u;
        matchedByName = true;
      } else if (/drum/.test(low)) {
        out.drums = u;
        matchedByName = true;
      } else if (/bass/.test(low)) {
        out.bass = u;
        matchedByName = true;
      } else if (/other|no_?vocal|accompan|instrument/.test(low)) {
        out.other = u;
        matchedByName = true;
      }
    }
    if (!matchedByName && urls.length >= 4) {
      // ordem fixa cjwbw: drums, bass, other, vocals
      out.drums = urls[0];
      out.bass = urls[1];
      out.other = urls[2];
      out.vocals = urls[3];
    }
    return out;
  }

  // 3) String única — não dá pra mapear 4 trilhas, devolve vazio.
  return out;
}

/**
 * Roda a separação. Resolve a version hash atual do modelo (Replicate exige
 * version explícita pra modelos user-contributed) e chama o Demucs.
 */
export async function separateStems(
  input: SeparateInput,
): Promise<SeparateResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      kind: 'config',
      error:
        'REPLICATE_API_TOKEN não configurada no servidor. Configure pra usar o Separador.',
    };
  }

  const replicate = new Replicate({ auth: token });
  const [owner, name] = DEMUCS_MODEL.split('/');

  // Resolve a version hash atual.
  let versionId: string | null = null;
  try {
    const info = await replicate.models.get(owner, name);
    versionId =
      (info as { latest_version?: { id?: string } })?.latest_version?.id ||
      null;
  } catch (e) {
    const msg = errText(e);
    return {
      ok: false,
      kind: classify(msg),
      error: `Modelo ${DEMUCS_MODEL} não encontrado no Replicate: ${msg}`,
    };
  }
  if (!versionId) {
    return {
      ok: false,
      kind: 'config',
      error: `${DEMUCS_MODEL} sem versão publicada no Replicate.`,
    };
  }

  try {
    const versioned =
      `${DEMUCS_MODEL}:${versionId}` as `${string}/${string}:${string}`;
    const output = (await replicate.run(versioned, {
      input: {
        // nomes de campo variam por fork — manda os mais comuns
        audio: input.audioUrl,
        audio_file: input.audioUrl,
        // separação COMPLETA (4 trilhas): OMITIMOS `stem`. Passar `stem`
        // ISOLA uma trilha só, e o enum não aceita "none" (422). Sem o
        // campo, o Demucs separa em vocals/drums/bass/other (default).
        model: 'htdemucs',
        model_name: 'htdemucs',
        output_format: 'mp3',
        mp3: true,
        wav: false,
        mp3_bitrate: 320,
        shifts: 1,
        overlap: 0.25,
        clip_mode: 'rescale',
      },
    })) as unknown;

    const picked = pickStems(output);
    // Mínimo aceitável: voz + pelo menos uma trilha instrumental.
    if (!picked.vocals || (!picked.other && !picked.drums && !picked.bass)) {
      return {
        ok: false,
        kind: 'runtime',
        error: `Demucs rodou mas não consegui mapear as trilhas. Saída: ${JSON.stringify(
          output,
        ).slice(0, 500)}`,
      };
    }

    const stems: Record<RawStem, string> = {
      vocals: picked.vocals,
      drums: picked.drums || '',
      bass: picked.bass || '',
      other: picked.other || '',
    };
    return { ok: true, stems };
  } catch (e) {
    const msg = errText(e);
    return { ok: false, kind: classify(msg), error: `Demucs falhou: ${msg}` };
  }
}
