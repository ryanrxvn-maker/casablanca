import { famousHeyGratis } from '@/lib/famous-hey-trial';
import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { accessTokenDoRefresh } from '@/lib/heygen-image-video';

/**
 * POST /api/heygen/audio-asset — sobe um áudio pro HeyGen e devolve a URL.
 *
 * Existe porque o modo imagem aceita `audio_url`, mas a URL precisa ser pública
 * e o arquivo do usuário está no disco dele. O asset do próprio HeyGen resolve
 * sem depender de hospedagem externa (que expiraria antes da fila chegar na vez).
 *
 * ⚠ REQUEST SEPARADO de propósito. Imagem e áudio no mesmo multipart estouram o
 * teto de ~4,5MB do Vercel quando os dois são grandes — e o erro que aparece é
 * "Failed to parse body", que não diz qual dos dois passou do limite. Separando,
 * cada um tem o teto inteiro pra si e a mensagem de erro aponta o culpado.
 *
 * Autentica com o MESMO Bearer da geração (não com a API key): assim o asset
 * nasce na conta que vai gerar o vídeo. Cai pra API key só se o OAuth recusar o
 * upload — o CDN devolvido é público, então funciona nos dois casos.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Extensão → mime. O upload do HeyGen decide o tipo pelo `Content-Type`, e
 *  mandar `application/octet-stream` faz ele aceitar e devolver um asset que o
 *  /v3/videos depois recusa — falha tardia e sem explicação. */
const MIMES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

function jsonError(message: string, status = 500, detalhe?: string) {
  return NextResponse.json(
    detalhe ? { error: message, detalhe: detalhe.slice(0, 400) } : { error: message },
    { status },
  );
}

async function subir(headers: Record<string, string>, bytes: Uint8Array, mime: string) {
  const r = await fetch('https://upload.heygen.com/v1/asset', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': mime },
    body: bytes as unknown as BodyInit,
  });
  const texto = await r.text().catch(() => '');
  if (!r.ok) return { url: '', assetId: '', erro: texto || `HTTP ${r.status}` };
  let j: { data?: { url?: string; file_url?: string; id?: string; asset_id?: string } } | null = null;
  try {
    j = JSON.parse(texto);
  } catch {
    return { url: '', assetId: '', erro: 'resposta do upload não era JSON' };
  }
  return {
    url: j?.data?.url ?? j?.data?.file_url ?? '',
    assetId: j?.data?.id ?? j?.data?.asset_id ?? '',
    erro: '',
  };
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier(famousHeyGratis() ? 'free' : 'admin', {
      unlockTools: ['/tools/famous-hey', '/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Falha ao ler o áudio (limite ~4MB por envio).', 413);
    }

    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return jsonError('Nenhum áudio recebido.', 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return jsonError(
        `Áudio muito grande (${(audio.size / 1e6).toFixed(1)}MB). O limite é 4MB — ` +
          'exporte em MP3 128kbps, que cobre uns 4 minutos de fala.',
        413,
      );
    }

    const ext = (audio.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
    const mime = MIMES[ext] ?? (audio.type?.startsWith('audio/') ? audio.type : '');
    if (!mime) {
      return jsonError(
        `Formato de áudio não reconhecido (${audio.name || 'sem nome'}). Use MP3, WAV, M4A ou OGG.`,
        400,
      );
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());

    /**
     * ORDEM: API KEY PRIMEIRO.
     *
     * O upload.heygen.com é o endpoint de API key — é assim que a clonagem de
     * voz sobe áudio há meses. O Bearer aqui é a aposta, não o caminho certo,
     * então ele vira o SEGUNDO.
     *
     * E as duas tentativas são independentes de propósito: antes, um OAuth
     * morto fazia `accessTokenDoRefresh` lançar e o catch de fora respondia 500
     * — a API key, que resolveria, nunca chegava a ser testada.
     */
    const tentativas: Array<{ nome: string; headers: Record<string, string> }> = [];

    const rk = await getUserKey('heygen');
    if (!('response' in rk)) {
      tentativas.push({ nome: 'API key', headers: { 'X-Api-Key': rk.key } });
    }

    const rOauth = await getUserKey('heygen_oauth');
    if (!('response' in rOauth)) {
      try {
        const { access } = await accessTokenDoRefresh(rOauth.key);
        tentativas.push({ nome: 'conta conectada', headers: { Authorization: `Bearer ${access}` } });
      } catch {
        /* OAuth morto não impede a API key de tentar */
      }
    }

    if (tentativas.length === 0) {
      return jsonError(
        'Pra usar áudio você precisa conectar sua conta do HeyGen (ou colar a chave em Configurações).',
        400,
      );
    }

    let r = { url: '', assetId: '', erro: '' };
    const falhas: string[] = [];
    for (const t of tentativas) {
      r = await subir(t.headers, bytes, mime);
      if (r.url || r.assetId) break;
      falhas.push(`${t.nome}: ${r.erro.slice(0, 160)}`);
    }

    if (!r.url && !r.assetId) {
      // O motivo REAL vai junto. "O HeyGen recusou" sozinho não dizia nada — nem
      // pro usuário, nem pra mim quando ele mandava o print.
      console.error('[audio-asset] upload falhou:', falhas.join(' | '));
      return jsonError(
        `Não consegui subir o áudio pro HeyGen. ${falhas.join(' · ')}`,
        502,
        falhas.join(' | '),
      );
    }
    return NextResponse.json({ url: r.url || null, assetId: r.assetId || null });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Erro inesperado ao subir o áudio.');
  }
}
