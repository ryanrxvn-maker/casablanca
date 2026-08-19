import { createHash } from 'crypto';
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
/** O endpoint exige `client_id` — sem ele devolve `invalid_client`, e não
 *  "refresh token inválido", o que manda o diagnóstico pro lado errado.
 *
 *  Este valor NÃO estava no binário como string legível: veio da URL que o
 *  próprio CLI monta em `heygen auth login --oauth` ("Open this URL manually to
 *  continue: .../oauth/authorize?client_id=..."). Palpites tipo `heygen-cli`
 *  são recusados com "The client does not exist on this server". Confirmado
 *  contra /v1/oauth/device_authorization, que devolveu device_code com ele.
 *
 *  É um client PÚBLICO (PKCE) — aparece na barra do navegador durante o login,
 *  não é segredo. O client do refresh tem que ser o MESMO que emitiu o token. */
const OAUTH_CLIENT_ID = 'q2A2QRSke2LrFTPJhoDbHtXh';

/** Cache do access token em memória do processo. Medido: o refresh grant devolve
 *  ~1h de validade (o `expires_at` de 10 dias do arquivo do CLI é do login
 *  inicial, não da renovação). Guardamos 60s de folga. */
/**
 * ⚠ POR CREDENCIAL, NUNCA GLOBAL.
 *
 * Era um único objeto de módulo. Em serverless a MESMA instância atende
 * usuários diferentes, e o cache era devolvido sem olhar de quem era o refresh
 * que entrou: quem chegasse depois recebia o access token de OUTRA CONTA.
 *
 * Medido em 18.08 assim que a janela grátis abriu a ferramenta pra mais de um
 * usuário: a tela do admin passou a relatar a conta HeyGen de outra sessão. E
 * o estrago não parava no diagnóstico — uma geração podia sair (e ser cobrada)
 * na conta HeyGen errada.
 *
 * A chave é o HASH do refresh, não o refresh: chave de cache acaba em log e em
 * mensagem de erro, e credencial não pode ir junto.
 */
const tokenCache = new Map<string, { access: string; expiraEm: number }>();

/** Teto do cache. Sem ele o Map cresce enquanto a instância viver. */
const MAX_CACHE = 50;

function chaveCache(refresh: string): string {
  return createHash('sha256').update(refresh).digest('hex').slice(0, 32);
}

function guardarNoCache(chave: string, access: string, expiraEm: number): void {
  // Ao encher, descarta a entrada mais antiga (Map preserva ordem de inserção).
  if (tokenCache.size >= MAX_CACHE) {
    const primeira = tokenCache.keys().next().value;
    if (primeira) tokenCache.delete(primeira);
  }
  tokenCache.set(chave, { access, expiraEm });
}

export type RefreshResult = {
  access: string;
  /** De ONDE veio o access. Sem isto, "não renovou" era ambíguo: podia ser o
   *  cache da instância quente OU o access gravado no banco — e a diferença é
   *  justamente o que se quer medir quando o token some. */
  origem: 'cache' | 'banco' | 'renovou';
  /** ⚠ O HeyGen ROTACIONA o refresh token: cada renovação devolve um novo e
   *  INVALIDA o anterior. Medido — depois que o app renovou, o CLI que segurava
   *  o token antigo passou a responder "OAuth session expired or rejected" com
   *  o arquivo de credencial intacto. Quem chama TEM que persistir este valor,
   *  senão funciona uma vez e quebra no próximo cold start (o cache acima
   *  esconde o problema enquanto o processo vive).
   *
   *  Vem no formato de GUARDAR (ver empacotarCredencial): traz junto o access
   *  e a validade, pra próxima instância não precisar renovar de novo. */
  novoRefresh: string | null;
};

/**
 * O que fica gravado no campo `heygen_oauth_refresh`.
 *
 * Era só o refresh token, e isso obrigava CADA instância fria a renovar — e
 * cada renovação queima o refresh anterior (rotação com uso ÚNICO). Guardando
 * o access junto, todas as instâncias reusam o mesmo enquanto ele vale (~1h),
 * em vez de cada uma queimar um refresh no cold start.
 *
 * Compatível com o que já está gravado: string pura = refresh sozinho, que é
 * também o que o usuário cola na mão em /configuracoes/api.
 */
type Credencial = {
  refresh: string;
  access?: string;
  /** Quando o ACCESS vence (~1h). */
  exp?: number;
  /**
   * Quando o REFRESH vence (~10 dias no login inicial).
   *
   * Guardado pra responder de uma vez a pergunta que sempre volta: "isso vai
   * expirar de novo?". Se cada rotação trouxer um prazo NOVO, o cron diário
   * empurra o vencimento pra sempre e a resposta é "não". Se vier sempre o
   * mesmo, é reconectar a cada 10 dias. Sem medir, era chute — agora a própria
   * tela mostra a data e o número decide.
   */
  refreshExp?: number;
};

/** Lê a validade do refresh de qualquer um dos nomes que o provedor possa usar.
 *  A lista é ampla de propósito: um nome que não bate vira `undefined`, que é
 *  só "não sei" — nunca um prazo inventado. */
export function lerValidadeDoRefresh(j: Record<string, unknown> | null): number | undefined {
  if (!j) return undefined;
  for (const chave of ['refresh_expires_in', 'refresh_token_expires_in']) {
    const v = Number(j[chave]);
    if (v > 0) return Date.now() + v * 1000;
  }
  for (const chave of ['refresh_expires_at', 'refresh_token_expires_at', 'expires_at']) {
    const v = j[chave];
    if (typeof v === 'string') {
      const t = Date.parse(v);
      // `expires_at` pode ser do ACCESS: só aceita se for prazo longo (>2 dias),
      // senão o app mostraria "vence em 1h" pro refresh e assustaria à toa.
      if (t > Date.now() + 2 * 86400_000) return t;
    } else if (Number(v) > 0) {
      const t = Number(v) * 1000;
      if (t > Date.now() + 2 * 86400_000) return t;
    }
  }
  return undefined;
}

export function lerCredencial(guardado: string): Credencial {
  const s = (guardado || '').trim();
  if (!s.startsWith('{')) return { refresh: s };
  try {
    const j = JSON.parse(s);
    return {
      refresh: String(j.refresh || j.refresh_token || ''),
      access: typeof j.access === 'string' ? j.access : undefined,
      exp: Number(j.exp) > 0 ? Number(j.exp) : undefined,
      refreshExp: Number(j.refreshExp) > 0 ? Number(j.refreshExp) : undefined,
    };
  } catch {
    return { refresh: s };
  }
}

export function empacotarCredencial(c: Credencial): string {
  return JSON.stringify({
    refresh: c.refresh,
    access: c.access,
    exp: c.exp,
    refreshExp: c.refreshExp,
  });
}

/** Quanto o access vale de verdade. Medido: o refresh grant devolve ~1h — o
 *  `expires_at` de 10 dias que aparece no arquivo do CLI é do login inicial,
 *  não da renovação. Confundir os dois faz o app achar que tem folga de dias
 *  quando tem de minutos. */
export const MARGEM_ACCESS_MS = 5 * 60_000;

/**
 * Troca o refresh token por um access token.
 *
 * É isto que faz o modo imagem cobrar do **crédito do plano** em vez do tier de
 * API: a doc da HeyGen separa os dois — "when you authenticate with an API Key
 * you are billed under the API tier" (saldo USD à parte), enquanto o OAuth usa
 * subscription credits. Como o Silas não quer saldo em API, o caminho é este.
 */
/** Qual refresh identifica a entrada do cache depois da troca: o novo quando
 *  houve rotação, senão o que foi usado. */
function refreshFinalDoCache(j: { refresh_token?: unknown }, usado: string): string {
  return typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : usado;
}

export async function accessTokenDoRefresh(
  guardado: string,
  /**
   * Relê a credencial da fonte da verdade (o banco). Serve pro caso de OUTRA
   * instância ter rotacionado enquanto esta segurava o valor antigo: em vez de
   * mandar o usuário refazer o login à toa, tenta uma vez com o token fresco.
   */
  relerDoBanco?: () => Promise<string | null>,
): Promise<RefreshResult> {
  const agora = Date.now();
  const cred = lerCredencial(guardado);
  // A chave sai do REFRESH (estável entre renovações do access) — assim cada
  // conta tem a própria entrada e ninguém pega o token de ninguém.
  const chave = chaveCache(cred.refresh || guardado);

  const emCache = tokenCache.get(chave);
  if (emCache && emCache.expiraEm > agora + 60_000) {
    return { access: emCache.access, novoRefresh: null, origem: 'cache' };
  }

  // ACCESS AINDA VÁLIDO (~1h): usa e não encosta no refresh. É o que impede o
  // token de ser queimado a cada instância fria — a causa de "tenho que fazer
  // login toda vez". Margem de 5min pra não servir token na virada.
  if (cred.access && cred.exp && cred.exp > agora + MARGEM_ACCESS_MS) {
    guardarNoCache(chave, cred.access, cred.exp);
    return { access: cred.access, novoRefresh: null, origem: 'banco' };
  }
  const refreshToken = cred.refresh;

  const trocar = (rt: string) =>
    fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: OAUTH_CLIENT_ID,
      }),
    });

  let usado = refreshToken;
  let r = await trocar(usado);
  let j = await r.json().catch(() => null);

  // invalid_grant = "esse refresh já foi trocado". O HeyGen usa ROTAÇÃO com uso
  // ÚNICO, e em serverless várias instâncias acordam juntas quando o access
  // (~1h) vence: uma troca e as outras chegam com papel velho. Quem perdeu a
  // corrida não pode desistir — a vencedora já gravou um access bom há
  // segundos. Relê com espera crescente antes de dizer que o login morreu.
  if ((!r.ok || !j?.access_token) && relerDoBanco) {
    for (const espera of [0, 1500, 3000]) {
      if (espera) await new Promise((res) => setTimeout(res, espera));
      const frescoRaw = await relerDoBanco().catch(() => null);
      const fresco = frescoRaw ? lerCredencial(frescoRaw) : null;
      // a vencedora deixou um access pronto: usa e nem renova
      if (fresco?.access && fresco.exp && fresco.exp > Date.now() + MARGEM_ACCESS_MS) {
        // chave do refresh FRESCO: a vencedora pode ter rotacionado
        guardarNoCache(chaveCache(fresco.refresh || chave), fresco.access, fresco.exp);
        return { access: fresco.access, novoRefresh: null, origem: 'banco' };
      }
      // ou pelo menos um refresh diferente do que já queimou
      if (fresco?.refresh && fresco.refresh !== usado) {
        usado = fresco.refresh;
        r = await trocar(usado);
        j = await r.json().catch(() => null);
        if (r.ok && j?.access_token) break;
      }
    }
  }

  if (!r.ok || !j?.access_token) {
    throw new Error(
      'Não consegui renovar o OAuth do HeyGen: ' +
        describeError(r.status, j) +
        '. Rode `heygen auth login --oauth` e cole o novo refresh token em /configuracoes/api.',
    );
  }

  const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : 3600_000;
  const exp = agora + ttl;
  guardarNoCache(chaveCache(refreshFinalDoCache(j, usado)), j.access_token, exp);
  const refreshFinal =
    typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : usado;
  // Grava SEMPRE que renovou — mesmo sem rotação do refresh — pra guardar o
  // access novo e as próximas instâncias não precisarem renovar nada.
  return {
    access: j.access_token,
    novoRefresh: empacotarCredencial({
      refresh: refreshFinal,
      access: j.access_token,
      exp,
      // Se a rotação trouxer prazo novo, ele entra; se não trouxer, o
      // anterior é preservado. Preservar importa: apagar viraria "não sei"
      // toda vez que o cron rodasse, e a tela nunca mostraria nada.
      refreshExp: lerValidadeDoRefresh(j) ?? lerCredencial(refreshToken).refreshExp,
    }),
    origem: 'renovou',
  };
}

export type ImageInput =
  | { type: 'url'; url: string }
  | { type: 'asset_id'; asset_id: string }
  | { type: 'base64'; media_type: string; data: string };

export type CreateImageVideoParams = {
  image: ImageInput;
  /** Voz da biblioteca do HeyGen. Obrigatória quando se manda `script` —
   *  aqui não existe avatar de onde herdar voz padrão. Ignorada no caminho
   *  de áudio pronto: lá a voz JÁ está gravada no arquivo. */
  voiceId?: string;
  script?: string;
  /** ÁUDIO PRONTO — a fala vem de um arquivo em vez de TTS.
   *
   *  Mutuamente exclusivo com `script`/`voiceId`: o schema oficial marca
   *  `script` e `audio_*` como alternativas, e mandar os dois faz o HeyGen
   *  recusar em vez de escolher um. Quem chama decide ANTES qual caminho usa.
   *
   *  `audioAssetId` tem precedência sobre `audioUrl` quando os dois vêm — o
   *  asset é do próprio HeyGen e não depende de a URL continuar no ar. */
  audioUrl?: string;
  audioAssetId?: string;
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
  const audio = p.audioAssetId?.trim() || p.audioUrl?.trim() || '';
  const script = p.script?.trim() || '';

  // A fala tem que vir de UMA fonte só. Mandar as duas não faz o HeyGen
  // escolher: faz ele recusar — e o erro cru não diz qual sobrou.
  if (audio && script) {
    throw new Error(
      'Escolha UMA fonte de fala: ou o texto (com voz), ou o áudio pronto. Os dois juntos o HeyGen recusa.',
    );
  }
  if (!audio) {
    if (!p.voiceId) {
      // Sem avatar não há voz padrão pra cair: falha clara em vez de 400 cru.
      throw new Error('Modo imagem exige uma voz escolhida — não existe avatar de onde herdar a voz padrão.');
    }
    if (!script) throw new Error('Modo imagem exige o texto da fala (ou um áudio pronto).');
  }

  const body: Record<string, unknown> = {
    type: 'image',
    image: p.image,
    aspect_ratio: p.aspectRatio || '9:16',
    title: p.title || 'Video por imagem',
  };
  if (audio) {
    // asset_id ganha da url: é do próprio HeyGen e não depende de link externo
    // continuar no ar até a fila chegar na vez dele.
    if (p.audioAssetId?.trim()) body.audio_asset_id = p.audioAssetId.trim();
    else body.audio_url = audio;
  } else {
    body.voice_id = p.voiceId;
    body.script = script;
  }
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
