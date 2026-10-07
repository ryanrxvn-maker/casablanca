/**
 * Avisos de CHAVE (BYOK) que o cliente lê — um lugar só, pra todos falarem a
 * mesma língua e nenhum mentir.
 *
 * Regras (pedido do Silas, 07.10):
 *  - nunca técnico: nada de status HTTP, nome de variável, rota ou inglês cru;
 *  - nunca mentiroso: só afirma o que o erro PROVA. Sem prova (falha de rede,
 *    5xx, timeout) a mensagem diz que não conseguiu, sem culpar a chave;
 *  - sempre diz O QUE FAZER e ONDE (o menu se chama "Chaves de IA").
 *
 * ⚠ As mensagens evitam de propósito as palavras-gatilho do
 * `toFriendlyMessage` ("recusad", "denied", "limite diário", "timeout",
 * "extensão", "não conectad"…): se alguma tela passar o texto por ele sem
 * `FriendlyError`, ele não troca o aviso por um diagnóstico errado.
 */

export type KeyService =
  | 'anthropic'
  | 'assemblyai'
  | 'elevenlabs'
  | 'heygen'
  | 'heygen_oauth'
  | 'replicate'
  | 'groq';

/** Onde o cliente cola as chaves — igual ao menu de Configurações. */
export const ONDE_COLAR = 'Configurações › Chaves de IA';

/** "do Groq", "da AssemblyAI"… (com o artigo certo). */
export const DA_CHAVE: Record<KeyService, string> = {
  anthropic: 'da Anthropic',
  assemblyai: 'da AssemblyAI',
  elevenlabs: 'da ElevenLabs',
  heygen: 'do HeyGen',
  heygen_oauth: 'do HeyGen',
  replicate: 'da Replicate',
  groq: 'do Groq',
};

/** Artigo do serviço: "o Groq", "a AssemblyAI". */
export const ARTIGO: Record<KeyService, 'o' | 'a'> = {
  anthropic: 'a',
  assemblyai: 'a',
  elevenlabs: 'a',
  heygen: 'o',
  heygen_oauth: 'o',
  replicate: 'a',
  groq: 'o',
};

/** Nome do serviço como aparece no card de Chaves de IA. */
export const NOME_SERVICO: Record<KeyService, string> = {
  anthropic: 'Anthropic',
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  heygen_oauth: 'HeyGen',
  replicate: 'Replicate',
  groq: 'Groq',
};

/**
 * Serviços com card em Configurações › Chaves de IA. Anthropic, ElevenLabs e
 * Replicate saíram da tela (commit 1d8d3e15): mandar o cliente "colar lá" seria
 * um aviso sem saída, então pra eles o aviso diz a verdade e aponta o suporte.
 */
export const TEM_CARD: ReadonlySet<KeyService> = new Set<KeyService>([
  'assemblyai',
  'groq',
  'heygen',
  'heygen_oauth',
]);

/** Aviso de chave que falta (o getUserKey devolve isso com `missingKey`). */
export function avisoChaveFaltando(service: KeyService): string {
  if (service === 'heygen_oauth') {
    return `Falta conectar sua conta do HeyGen. Em ${ONDE_COLAR}, clique em "Conectar HeyGen agora" e tente de novo.`;
  }
  if (!TEM_CARD.has(service)) {
    return `Esta função usa uma chave ${DA_CHAVE[service]}, que ainda não está salva na sua conta. Fale com o suporte pra liberar.`;
  }
  return `Falta a sua chave ${DA_CHAVE[service]}. Cole a chave em ${ONDE_COLAR} e tente de novo.`;
}

/** A chave salva não pôde ser lida (cifrada com outra senha / corrompida). */
export function avisoChaveIlegivel(service: KeyService): string {
  if (!TEM_CARD.has(service)) {
    return `Não deu pra ler a chave ${DA_CHAVE[service]} salva na sua conta. Fale com o suporte pra salvar de novo.`;
  }
  if (service === 'heygen_oauth') {
    return `Não deu pra ler a conexão com o HeyGen salva aqui. Em ${ONDE_COLAR}, clique em "Conectar HeyGen agora" e tente outra vez.`;
  }
  return `Não deu pra ler a sua chave ${DA_CHAVE[service]} salva aqui. Cole ela de novo em ${ONDE_COLAR} e tente outra vez.`;
}

/** O serviço recusou a chave salva (401). Pra quem não tem card, o suporte. */
export function avisoChaveNaoAceita(service: KeyService): string {
  const nome = NOME_SERVICO[service];
  const O = ARTIGO[service].toUpperCase();
  const doSite = ARTIGO[service] === 'a' ? 'da' : 'do';
  if (!TEM_CARD.has(service)) {
    return `${O} ${nome} não aceitou a chave salva na sua conta. Fale com o suporte pra trocar.`;
  }
  return `${O} ${nome} não aceitou a sua chave. Confira se ela foi colada inteira em ${ONDE_COLAR}, ou crie uma nova no site ${doSite} ${nome}.`;
}

export type FalhaDeChave =
  | 'sem-chave'
  | 'chave-invalida'
  | 'limite'
  | 'sem-credito'
  /** O serviço respondeu certo, só que sem nenhuma palavra (áudio sem fala). */
  | 'sem-fala'
  | 'outra';

/**
 * Classifica o erro CRU de um serviço. Só responde algo diferente de 'outra'
 * quando o próprio erro prova a causa (status ou texto do provedor).
 * 403 sozinho NÃO prova chave ruim (o Groq usa 403 pra região/organização):
 * só conta como chave inválida com 401 ou com o texto do provedor dizendo.
 */
export function classificarFalhaDeChave(raw: string): FalhaDeChave {
  const m = raw.toLowerCase();
  if (/(key ausente|key nao configurada|chave n[aã]o configurada|missingkey|falta a sua chave)/.test(m)) {
    return 'sem-chave';
  }
  if (
    /(\b401\b|invalid[ _-]?api[ _-]?key|incorrect api key|unauthori[sz]ed|authentication error|api token (?:is )?(?:missing|invalid)|invalid (?:auth(?:entication)? )?token)/.test(m)
  ) {
    return 'chave-invalida';
  }
  if (/(\b429\b|rate.?limit|too many requests)/.test(m)) return 'limite';
  if (/(\b402\b|insufficient|account balance|top up|out of credits?|no credits? (?:left|remaining)|payment required)/.test(m)) {
    return 'sem-credito';
  }
  if (/(sem palavras|transcri[cç][aã]o vazia|retornou vazi|does not appear to contain audio|no spoken audio)/.test(m)) {
    return 'sem-fala';
  }
  return 'outra';
}

/** Áudio sem voz: não é erro de ninguém, e o aviso diz isso. */
export const AVISO_SEM_FALA =
  'Não encontrei fala nesse áudio. Confira se o vídeo tem voz e tente de novo.';

/**
 * Explica, em português de gente, por que a TRANSCRIÇÃO falhou.
 *
 * @param errors  `errors` do `transcribeAudio` ("groq: Groq 401: …",
 *                "assemblyai: AAI key ausente.") ou erros soltos. Vazio =
 *                os serviços rodaram e não acharam fala.
 * @param aceitas chaves que servem pra essa ferramenta, na ordem de uso.
 * @param generico texto quando o erro não prova nada sobre a chave.
 */
export function explicarFalhaTranscricao(
  errors: string[],
  aceitas: Array<'groq' | 'assemblyai'>,
  generico = 'Não consegui transcrever o áudio agora. Tente de novo em instantes.',
): string {
  // Ninguém falhou e mesmo assim não veio palavra: os serviços rodaram certo
  // e o áudio não tem fala.
  if (errors.length === 0) return AVISO_SEM_FALA;

  const porServico = new Map<'groq' | 'assemblyai', FalhaDeChave>();
  for (const s of aceitas) {
    const e = errors.find((x) => x.toLowerCase().startsWith(`${s}:`));
    if (e) porServico.set(s, classificarFalhaDeChave(e));
  }
  // Erros sem prefixo de serviço (rotas que tentam um provedor só).
  if (porServico.size === 0 && aceitas.length === 1 && errors.length > 0) {
    porServico.set(aceitas[0], classificarFalhaDeChave(errors.join(' | ')));
  }

  const nenhumaChave = aceitas.every((s) => porServico.get(s) === 'sem-chave');
  if (nenhumaChave) {
    if (aceitas.length === 1) return avisoChaveFaltando(aceitas[0]);
    return `Falta uma chave de transcrição. Cole a do Groq ou a da AssemblyAI (basta uma) em ${ONDE_COLAR} e tente de novo.`;
  }

  // Problema de CHAVE (o cliente consegue resolver) ganha de falha genérica,
  // na ordem em que a ferramenta usa as chaves.
  for (const s of aceitas) {
    const f = porServico.get(s);
    if (f !== 'chave-invalida' && f !== 'limite' && f !== 'sem-credito') continue;
    if (f === 'chave-invalida') return avisoChaveNaoAceita(s);
    const nome = NOME_SERVICO[s];
    const art = ARTIGO[s];
    const no = art === 'a' ? 'na' : 'no';
    const doSite = art === 'a' ? 'da' : 'do';
    if (f === 'limite') {
      return `Sua conta ${no} ${nome} atingiu o limite de uso do plano por enquanto. Espere um pouco e tente de novo.`;
    }
    return `Sua conta ${no} ${nome} está sem crédito pra transcrever. Adicione saldo no site ${doSite} ${nome}${aceitas.length > 1 ? ' ou use a outra chave de transcrição' : ''}.`;
  }

  // Algum serviço respondeu certo e não achou palavra nenhuma: áudio sem fala.
  // (No transcribeAudio, serviço SEM erro listado = rodou e voltou vazio.)
  const prefixados = errors.some((x) => /^(groq|assemblyai):/i.test(x));
  const rodouVazio = prefixados && aceitas.some((s) => !porServico.has(s));
  if (rodouVazio || aceitas.some((s) => porServico.get(s) === 'sem-fala')) {
    return AVISO_SEM_FALA;
  }
  return generico;
}
