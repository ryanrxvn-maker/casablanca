import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encryptSecret, lastFour } from '@/lib/secrets';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import {
  createImageVideo,
  getImageVideoStatus,
  accessTokenDoRefresh,
  type ImageInput,
} from '@/lib/heygen-image-video';

/**
 * MODO IMAGEM — dispara um take animando uma imagem, sem avatar na biblioteca.
 *
 * POST /api/heygen/image-video   → cria o vídeo, devolve { videoId }
 * GET  /api/heygen/image-video?videoId=...  → status + url quando pronto
 *
 * Por que é rota de SERVIDOR e não vai pela extensão como TODO o resto: medido,
 * a api2 (onde a extensão autentica) NÃO tem endpoint de animar imagem — 404 em
 * /v3/videos, /v1/talking_photo e /v2/photo_avatar/*; o único submit de lá exige
 * `avatar_id`. E a API pública recusa cookie de sessão (401). Não é escolha de
 * arquitetura: a variante só existe fora do alcance da extensão.
 *
 * Autentica por **OAuth (Bearer)**, não por API key: a key cobra do tier de API
 * (saldo USD à parte) e o OAuth cobra do crédito do plano. Guardamos o refresh
 * token; o access renova sozinho.
 *
 * ⚠ Isto vale SÓ pro modo imagem. O disparo normal do Pilot/Hey Auto continua
 * inteiro na extensão, como sempre — nada daquele caminho foi tocado.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = new Set(['image/jpeg', 'image/png', 'image/webp']);

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Persiste o refresh token rotacionado.
 *
 * O HeyGen invalida o refresh anterior a cada renovação. Sem gravar o novo, o
 * modo imagem funcionaria UMA vez e quebraria no próximo cold start — e o
 * cache em memória esconderia o problema enquanto o processo vivesse, o que é
 * o pior tipo de bug: some no teste e volta em produção.
 *
 * Falha aqui NÃO derruba o disparo em andamento (o access token já é válido);
 * só registra, porque a próxima renovação é que vai sofrer.
 */
/**
 * Relê o refresh token gravado AGORA.
 *
 * Serverless: duas instâncias podem entrar na renovação com o mesmo token; a
 * primeira rotaciona e invalida o da segunda. Sem esta releitura, a segunda
 * devolvia "invalid_grant" e mandava refazer o login — com o token bom já
 * gravado no banco. Ver [[project_heygen_oauth_no_app]].
 */
async function relerRefreshDoBanco(): Promise<string | null> {
  const r = await getUserKey('heygen_oauth');
  return 'response' in r ? null : r.key;
}

async function guardarRefreshRotacionado(novo: string) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('user_api_keys').upsert(
      {
        user_id: user.id,
        heygen_oauth_refresh: encryptSecret(novo),
        heygen_oauth_last4: lastFour(novo),
      },
      { onConflict: 'user_id' },
    );
  } catch (e) {
    console.error('[image-video] falhei ao gravar o refresh rotacionado:', e);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen_oauth');
    if ('response' in keyResult) return keyResult.response;
    const { access: accessToken, novoRefresh } = await accessTokenDoRefresh(keyResult.key, relerRefreshDoBanco);
    if (novoRefresh) await guardarRefreshRotacionado(novoRefresh);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Falha ao ler o upload (limite ~4MB por request no Vercel).', 400);
    }

    const script = String(form.get('script') || '').trim();
    const voiceId = String(form.get('voiceId') || '').trim();
    const motionPrompt = String(form.get('motionPrompt') || '').trim();
    const title = String(form.get('title') || '').trim();
    const aspectRatio = String(form.get('aspectRatio') || '9:16');
    const imageUrl = String(form.get('imageUrl') || '').trim();
    const file = form.get('image');

    if (!script) return jsonError('Falta o texto da fala.', 400);
    if (!voiceId) {
      return jsonError(
        'Escolha uma voz. No modo imagem não existe avatar de onde herdar a voz padrão.',
        400,
      );
    }

    let image: ImageInput;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) {
        return jsonError(`Imagem muito grande (${(file.size / 1e6).toFixed(1)}MB). Máximo 8MB.`, 400);
      }
      const tipo = file.type || 'image/jpeg';
      if (!TIPOS_OK.has(tipo)) {
        return jsonError(`Formato não suportado (${tipo}). Use JPEG, PNG ou WebP.`, 400);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      image = { type: 'base64', media_type: tipo, data: bytes.toString('base64') };
    } else if (imageUrl) {
      if (!/^https:\/\//i.test(imageUrl)) {
        return jsonError('A URL da imagem precisa ser HTTPS pública.', 400);
      }
      image = { type: 'url', url: imageUrl };
    } else {
      return jsonError('Suba uma imagem (ou informe uma URL HTTPS).', 400);
    }

    const { videoId } = await createImageVideo(accessToken, {
      image,
      voiceId,
      script,
      motionPrompt: motionPrompt || null,
      title: title || 'Video por imagem',
      aspectRatio: aspectRatio as '9:16',
    });
    return NextResponse.json({ videoId });
  } catch (e) {
    return jsonError((e as Error)?.message || 'Erro inesperado no modo imagem.');
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('heygen_oauth');
    if ('response' in keyResult) return keyResult.response;

    const videoId = new URL(req.url).searchParams.get('videoId');
    if (!videoId) return jsonError('Falta videoId.', 400);

    const { access: accessToken, novoRefresh } = await accessTokenDoRefresh(keyResult.key, relerRefreshDoBanco);
    if (novoRefresh) await guardarRefreshRotacionado(novoRefresh);
    const st = await getImageVideoStatus(accessToken, videoId);
    return NextResponse.json(st);
  } catch (e) {
    return jsonError((e as Error)?.message || 'Erro ao consultar o vídeo.');
  }
}
