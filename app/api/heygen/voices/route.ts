import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';

/**
 * GET /api/heygen/voices?q=
 *
 * Lista vozes disponiveis no HeyGen. Usado pra escolher voz override
 * quando a do avatar nao serve.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function GET(req: Request) {
  try {
    const gate = await requireTier('pro');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').trim().toLowerCase();
    const lang = (searchParams.get('lang') ?? 'pt').toLowerCase();

    const res = await fetch('https://api.heygen.com/v2/voices', {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return jsonError('Falha na HeyGen API ao listar vozes.', 502, t);
    }

    const json = (await res.json().catch(() => null)) as {
      data?: {
        voices?: Array<{
          voice_id: string;
          name: string;
          language?: string;
          gender?: string;
          preview_audio?: string;
          support_pause?: boolean;
          emotion_support?: boolean;
          /** flags possiveis em vozes clonadas/custom (HeyGen varia o shape) */
          is_custom?: boolean;
          is_clone?: boolean;
          voice_type?: string;
        }>;
      };
    } | null;

    const all = json?.data?.voices ?? [];
    const norm = (x?: string) => (x ?? '').toLowerCase();
    // Idioma NUNCA exclui — vozes clonadas/custom costumam vir como
    // "English"/"Multilingual" e eram descartadas pelo filtro pt antigo,
    // sumindo do DARKO LAB. Agora `lang` so afeta a ORDENACAO (preferencia)
    // no modo browse (sem busca). Toda voz da conta HeyGen aparece.
    const isClone = (v: (typeof all)[number]) =>
      v.is_custom === true ||
      v.is_clone === true ||
      /clone|custom/i.test(v.voice_type ?? '');
    const isPreferredLang = (v: (typeof all)[number]) => {
      const l = norm(v.language);
      return (
        lang === 'all' ||
        l.includes(lang) ||
        l.includes('portu') ||
        l.includes('multi')
      );
    };

    // Busca: so por nome/id. SEM filtro de idioma.
    let matched = all.filter(
      (v) => !q || norm(v.name).includes(q) || norm(v.voice_id).includes(q),
    );

    // Modo browse (sem busca): mantem TODAS, mas sobe clonadas + idioma
    // preferido pro topo pra ficar facil de achar.
    if (!q) {
      matched = [...matched].sort((a, b) => {
        const ra = (isClone(a) ? 0 : 1) + (isPreferredLang(a) ? 0 : 2);
        const rb = (isClone(b) ? 0 : 1) + (isPreferredLang(b) ? 0 : 2);
        if (ra !== rb) return ra - rb;
        return norm(a.name).localeCompare(norm(b.name));
      });
    }

    // Cap alto — nenhuma conta HeyGen real chega perto disso. Garante que
    // NENHUMA voz (incluindo clonadas) seja cortada silenciosamente.
    const CAP = 1000;

    return NextResponse.json({
      voices: matched.slice(0, CAP).map((v) => ({
        id: v.voice_id,
        name: v.name,
        gender: v.gender ?? null,
        language: v.language ?? null,
        previewAudio: v.preview_audio ?? null,
        isClone: isClone(v),
      })),
      total: all.length,
      returned: Math.min(matched.length, CAP),
    });
  } catch (e) {
    console.error('[heygen voices]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
