/**
 * MODO IMAGEM — anima uma imagem solta no HeyGen, sem criar avatar.
 *
 * `POST /v3/videos` é união discriminada por `type`. A variante `image`
 * (*CreateVideoFromImage*) anima uma imagem qualquer — `required: [type, image]`,
 * **sem `avatar_id`**. Serve quando o avatar não existe na biblioteca: rosto
 * sintético que a moderação de likeness reprovou por engano, frame avulso, teste
 * rápido. Sem objeto de avatar não há identidade pra processar, então também não
 * há o 0x0 / `missing image dimensions` que trava o caminho normal.
 *
 * Diferenças que o chamador PRECISA saber (não são detalhe):
 *
 * 1. **Não tem campo `engine`.** Só a variante `avatar` tem. Aqui o servidor
 *    escolhe, e como a variante aceita `motion_prompt` (que o Avatar III não
 *    suporta) ela roda em IV+. Ou seja: não dá pra pedir III, e toda cena paga a
 *    faixa mais cara — inclusive as que só falam pra câmera.
 * 2. **Autentica por OAuth (Bearer), de propósito.** A doc de pricing separa os
 *    tiers: "when you authenticate with an API Key you are billed under the API
 *    tier" (saldo USD à parte, top-up mín. $5), enquanto o OAuth usa
 *    subscription credits. Como a regra aqui é nunca pôr dinheiro em saldo de
 *    API, este caminho vai de Bearer. O `refresh_token` renova sozinho.
 * 3. **Take único.** Sem avatar persistente, cada geração re-envia a imagem. Por
 *    isso o modo gera a copy inteira de uma vez em vez de picotar em ~20s —
 *    menos corte, menos overhead e menos re-upload.
 */

const API_BASE = 'https://api.heygen.com';
/** Endpoint de renovação do OAuth (extraído do binário do CLI oficial). Note
 *  que ele mora na **api2** — mesmo host da extensão — enquanto a geração em si
 *  mora na api.heygen.com. */
const OAUTH_TOKEN_URL = 'https://api2.heygen.com/v1/oauth/token';

/** Cache do access token em memória do processo. `expires_in` costuma ser ~10
 *  dias, então isto poupa uma ida ao HeyGen por disparo sem risco de servir
 *  token vencido (guardamos 60s de folga). */
let tokenCache: { access: string; expiraEm: number } | null = null;

/**
 * Troca o refresh token por um access token.
 *
 * É isto que faz o modo imagem cobrar do **crédito do plano** em vez do tier de
 * API: a doc da HeyGen separa os dois — "when you authenticate with an API Key
 * you are billed under the API tier" (saldo USD à parte), enquanto o OAuth usa
 * subscription credits. Como o Silas não quer saldo em API, o caminho é este.
 */
export async function accessTokenDoRefresh(refreshToken: string): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiraEm > agora + 60_000) return tokenCache.access;

  const r = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(
      'Não consegui renovar o OAuth do HeyGen: ' +
        describeError(r.status, j) +
        '. Rode `heygen auth login --oauth` e cole o novo refresh token em /configuracoes/api.',
    );
  }
  const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : 3600_000;
  tokenCache = { access: j.access_token, expiraEm: agora + ttl };
  return j.access_token;
}

export type ImageInput =
  | { type: 'url'; url: string }
  | { type: 'asset_id'; asset_id: string }
  | { type: 'base64'; media_type: string; data: string };

export type CreateImageVideoParams = {
  image: ImageInput;
  /** Voz da biblioteca do HeyGen. Obrigatória quando se manda `script` —
   *  aqui não existe avatar de onde herdar voz padrão. */
  voiceId: string;
  script: string;
  /** Apply Custom Motion. A variante `image` aceita (confirmado no schema). */
  motionPrompt?: string | null;
  title?: string;
  aspectRatio?: '16:9' | '9:16' | '4:5' | '5:4' | '1:1' | 'auto';
  resolution?: '720p' | '1080p' | '4k';
  /** 'high' | 'medium' | 'low' — default do HeyGen é 'low'. */
  expressiveness?: 'high' | 'medium' | 'low';
};

export type ImageVideoStatus = {
  status: 'processing' | 'pending' | 'completed' | 'failed' | string;
  videoUrl: string | null;
  duration: number | null;
  error: string | null;
};

/** Bearer do OAuth — NÃO `X-Api-Key`. A escolha é de cobrança: key cai no tier
 *  de API (saldo USD à parte) e bearer cai no crédito do plano. */
function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

/** Erro da API em texto legível — sem isto o usuário via "[object Object]". */
function describeError(status: number, body: any): string {
  const e = body?.error;
  const msg =
    (typeof e === 'string' ? e : e?.message) ||
    body?.message ||
    (typeof body === 'string' ? body : '') ||
    'sem detalhe';
  const code = e?.code ? ` [${e.code}]` : '';
  return `${msg}${code} (HTTP ${status})`;
}

export async function createImageVideo(
  accessToken: string,
  p: CreateImageVideoParams,
): Promise<{ videoId: string }> {
  if (!p.voiceId) {
    // Sem avatar não há voz padrão pra cair: falha clara em vez de 400 cru.
    throw new Error('Modo imagem exige uma voz escolhida — não existe avatar de onde herdar a voz padrão.');
  }
  if (!p.script?.trim()) throw new Error('Modo imagem exige o texto da fala.');

  const body: Record<string, unknown> = {
    type: 'image',
    image: p.image,
    voice_id: p.voiceId,
    script: p.script,
    aspect_ratio: p.aspectRatio || '9:16',
    title: p.title || 'Video por imagem',
  };
  if (p.resolution) body.resolution = p.resolution;
  if (p.expressiveness) body.expressiveness = p.expressiveness;
  // NÃO existe `engine` nesta variante — mandar seria ignorado em silêncio e
  // daria a falsa impressão de ter escolhido o motor. Ver cabeçalho.
  const motion = (p.motionPrompt || '').trim();
  if (motion) body.motion_prompt = motion;

  const r = await fetch(`${API_BASE}/v3/videos`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error('Falha ao criar vídeo por imagem: ' + describeError(r.status, json));

  const videoId = json?.data?.video_id || json?.data?.id || json?.video_id;
  if (!videoId) throw new Error('A API aceitou mas não devolveu video_id: ' + JSON.stringify(json).slice(0, 300));
  return { videoId };
}

export async function getImageVideoStatus(
  accessToken: string,
  videoId: string,
): Promise<ImageVideoStatus> {
  const r = await fetch(`${API_BASE}/v3/videos/${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers: headers(accessToken),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error('Falha ao consultar o vídeo: ' + describeError(r.status, json));
  const d = json?.data || json || {};
  return {
    status: d.status || 'processing',
    videoUrl: d.video_url || null,
    duration: typeof d.duration === 'number' ? d.duration : null,
    error: d.error ? (typeof d.error === 'string' ? d.error : JSON.stringify(d.error)) : null,
  };
}
