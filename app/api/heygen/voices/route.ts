import { famousHeyGratis } from '@/lib/famous-hey-trial';
import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { accessTokenDoRefresh } from '@/lib/heygen-image-video';

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
    const gate = await requireTier(famousHeyGratis() ? 'free' : 'admin', {
      unlockTools: ['/tools/famous-hey', '/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;
    /**
     * DUAS CREDENCIAIS pra uma ferramenta so e atrito: o usuario conecta pelo
     * botao, acha que acabou, e o seletor de voz continua vazio pedindo uma
     * API key que ele nem sabia que existia.
     *
     * Entao: tenta a API key; nao havendo, tenta o Bearer do OAuth que ele JA
     * conectou. Se o HeyGen recusar Bearer aqui, o comportamento e o mesmo de
     * antes (erro pedindo a key) — o fallback so pode melhorar, nunca piorar.
     */
    const keyResult = await getUserKey('heygen');
    let auth: Record<string, string> | null =
      'response' in keyResult ? null : { 'X-Api-Key': keyResult.key };

    if (!auth) {
      const rOauth = await getUserKey('heygen_oauth');
      if (!('response' in rOauth)) {
        try {
          const { access } = await accessTokenDoRefresh(rOauth.key);
          auth = { Authorization: `Bearer ${access}` };
        } catch {
          /* OAuth morto tambem: cai no erro de key ausente logo abaixo */
        }
      }
    }
    // Sem API key E sem OAuth: devolve a mesma resposta de credencial ausente
    // que o getUserKey ja monta (mensagem + status corretos).
    if (!auth) {
      return 'response' in keyResult
        ? keyResult.response
        : jsonError('Configure a chave do HeyGen em /configuracoes/api.', 400);
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') ?? '').trim().toLowerCase();
    const lang = (searchParams.get('lang') ?? 'pt').toLowerCase();

    const res = await fetch('https://api.heygen.com/v2/voices', {
      method: 'GET',
      headers: auth,
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
