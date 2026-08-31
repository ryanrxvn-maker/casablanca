/**
 * VERSÕES DO AD (1 a 10) — a generalização do "2 versões" (29.08).
 *
 * O que muda: antes o AD tinha no máximo DUAS versões, fixas — META e
 * YouTube ([[versao-canal.ts]], que continua valendo byte a byte pro caminho
 * antigo). Agora ele pode ter até 10, cada uma com o seu avatar por papel.
 *
 * INVARIANTES (travadas em versoes-ad.test.ts):
 *  1. A versão 1 é a de HOJE: mesmo nome de arquivo, mesma chave, mesmo
 *     taskId. Ninguém que já funciona é desfeito.
 *  2. Versão N>1 nunca colide com a 1 — nem em nome, nem em chave, nem em id
 *     de task. A versão 2 mantém o sufixo `-yt`/`_YOUTUBE` histórico quando
 *     é a versão de YouTube (compatibilidade com o que já foi entregue).
 *  3. Versão sem avatar próprio em papel nenhum NÃO gera de novo: ela é a
 *     mesma entrega da versão 1 (a diferença mora na edição).
 *
 * MAPEAMENTO AUTOMÁTICO (a parte que o Silas pediu): o doc separa as versões
 * por um RÓTULO DE BLOCO — "Meta Ads:", "Youtube Ads / Kwai Ads:", "Avatar
 * 1:", "Versão 2:" — e cada bloco repete os papéis com o seu avatar. Se o
 * avatar for o MESMO em todos os blocos, é UMA versão só (não adianta gerar
 * duas vezes o mesmo vídeo). Se diferir em algum papel, viram versões.
 */

export const MAX_VERSOES = 10;

/** Escolha de avatar de um papel numa versão.
 *
 *  MODO IMAGEM (30.08): a cena não tem avatar — quem fala é o FRAME que o
 *  HeyGen anima. Então a versão troca a IMAGEM, não o avatar: `imageKey` é a
 *  chave dos bytes no IndexedDB (o que sobrevive ao F5) e `imageDataUrl` é o
 *  cache em memória pra prévia. Versão sem imagem própria herda a da 1. */
export type EscolhaAvatarVersao = {
  avatarId?: string | null;
  avatarName?: string | null;
  avatarThumb?: string | null;
  avatarVoiceId?: string | null;
  voiceOverride?: { id: string; name: string } | null;
  /** MODO IMAGEM: o frame DESTA versão. */
  imageKey?: string | null;
  imageDataUrl?: string | null;
  imageName?: string | null;
};

export type VersaoAd = {
  /** 1..10 — a 1 é a versão original (META). */
  n: number;
  /** Nome editável. Padrão vem do mapeamento (META, YouTube, Avatar 2...). */
  nome: string;
  /** Rótulo cru que veio do doc ("Youtube Ads / Kwai Ads"), quando veio. */
  rotuloDoDoc?: string | null;
  /** Avatar por papel (chave = role em minúsculas). Vazio = herda a versão 1. */
  porPapel: Record<string, EscolhaAvatarVersao>;
};

/* ═══════════════ Identidade: nome de arquivo, chave e task ═══════════════ */

/** Sufixo do arquivo entregue. Versão 1 = SEM sufixo (o nome de hoje). */
export function sufixoVersao(v: VersaoAd | number, nomeVersao?: string): string {
  const n = typeof v === 'number' ? v : v.n;
  if (n <= 1) return '';
  const nome = (typeof v === 'number' ? nomeVersao : v.nome) || '';
  // A versão 2 chamada "YouTube" mantém o sufixo histórico — os arquivos já
  // entregues, a skill de entrega e o Drive esperam `_YOUTUBE`.
  if (n === 2 && /youtube/i.test(nome)) return '_YOUTUBE';
  return `_V${n}`;
}

/** `AD06G1GL.mp4` + versão 3 → `AD06G1GL_V3.mp4`. */
export function nomeComVersao(filename: string, v: VersaoAd | number, nomeVersao?: string): string {
  const sufixo = sufixoVersao(v, nomeVersao);
  if (!sufixo) return filename;
  const ponto = filename.lastIndexOf('.');
  if (ponto <= 0) return filename + sufixo;
  return filename.slice(0, ponto) + sufixo + filename.slice(ponto);
}

/** Segmento de id/chave da versão. Versão 1 = vazio (id/chave de hoje). */
function segmentoVersao(v: VersaoAd | number, nomeVersao?: string): string {
  const n = typeof v === 'number' ? v : v.n;
  if (n <= 1) return '';
  const nome = (typeof v === 'number' ? nomeVersao : v.nome) || '';
  if (n === 2 && /youtube/i.test(nome)) return 'yt';
  return `v${n}`;
}

/** Id da task daquela versão. Versão 1 devolve o id original, intocado.
 *  Separador `-` (não `:`) pelo mesmo motivo do canal: as chaves do IDB são
 *  purgadas por prefixo `pilot:<taskId>:` e um `:` deixaria a irmã DENTRO do
 *  prefixo da mãe. */
export function taskIdDaVersao(taskId: string, v: VersaoAd | number, nomeVersao?: string): string {
  const seg = segmentoVersao(v, nomeVersao);
  return seg ? `${taskId}-${seg}` : taskId;
}

/** Qual versão é esta task? (pelo sufixo do id) */
export function versaoDoTaskId(taskId: string): number {
  if (/-yt$/.test(taskId)) return 2;
  const m = /-v(\d{1,2})$/.exec(taskId);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2 && n <= MAX_VERSOES) return n;
  }
  return 1;
}

/** Id da task MÃE (versão 1). */
export function taskIdBaseDaVersao(taskId: string): string {
  return taskId.replace(/-(?:yt|v\d{1,2})$/, '');
}

/** Chave de entrega no IDB. Versão 1 = a chave de hoje. */
export function chaveEntregaVersao(chaveBase: string, v: VersaoAd | number, nomeVersao?: string): string {
  const seg = segmentoVersao(v, nomeVersao);
  if (!seg) return chaveBase;
  const corte = chaveBase.lastIndexOf(':');
  if (corte < 0) return `${chaveBase}:${seg}`;
  return `${chaveBase.slice(0, corte)}:${seg}${chaveBase.slice(corte)}`;
}

/* ═══════════════ Custo: esta versão gera de novo? ═══════════════ */

/** Avatar efetivo de um papel nesta versão (cai na versão 1 quando a versão
 *  não escolheu nada pra ele). */
export function avatarDaVersao(
  base: EscolhaAvatarVersao,
  versao: VersaoAd | null | undefined,
  role: string,
): EscolhaAvatarVersao {
  const esc = versao?.porPapel?.[role.toLowerCase()];
  // Nem avatar nem imagem própria: a versão é a 1 (custo zero).
  if (!esc || (!esc.avatarId && !esc.imageKey && !esc.imageDataUrl)) return base;
  // MODO IMAGEM: a imagem da versão substitui o frame, e o resto (voz) segue
  // o da versão 1 quando ela não escolheu.
  if (!esc.avatarId && (esc.imageKey || esc.imageDataUrl)) {
    return {
      ...base,
      imageKey: esc.imageKey ?? base.imageKey ?? null,
      imageDataUrl: esc.imageDataUrl ?? base.imageDataUrl ?? null,
      imageName: esc.imageName ?? base.imageName ?? null,
      avatarVoiceId: esc.avatarVoiceId ?? base.avatarVoiceId ?? null,
      voiceOverride: esc.voiceOverride ?? base.voiceOverride ?? null,
    };
  }
  // A versão escolheu um AVATAR DA BIBLIOTECA. Se a base é MODO IMAGEM (tem
  // frame), o avatar é OUTRA pessoa por definição — herdar a voz clonada da
  // foto entregaria o take com a voz errada. Nesse caso a voz é a da própria
  // versão (se escolhida) ou a do avatar; NUNCA a da base.
  const baseEhImagem = !!(base.imageKey || base.imageDataUrl);
  return {
    avatarId: esc.avatarId,
    avatarName: esc.avatarName ?? base.avatarName ?? null,
    avatarThumb: esc.avatarThumb ?? base.avatarThumb ?? null,
    avatarVoiceId: esc.avatarVoiceId ?? (baseEhImagem ? null : base.avatarVoiceId ?? null),
    voiceOverride: esc.voiceOverride ?? (baseEhImagem ? null : base.voiceOverride ?? null),
    imageKey: null,
    imageDataUrl: null,
    imageName: null,
  };
}

/** Esta versão precisa GERAR de novo no HeyGen? Só quando algum papel tem
 *  avatar diferente do da versão 1 — é a pergunta que decide o custo. */
export function versaoGeraDeNovo(
  papeisBase: Array<{ role: string; avatarId?: string | null; imageKey?: string | null }>,
  versao: VersaoAd,
): boolean {
  if (versao.n <= 1) return true; // a 1 é o disparo original
  return papeisBase.some((p) => {
    const esc = versao.porPapel?.[p.role.toLowerCase()];
    if (!esc) return false;
    // MODO IMAGEM: frame diferente do da versão 1 = geração nova.
    if (esc.imageKey && esc.imageKey !== (p.imageKey || null)) return true;
    return !!esc.avatarId && esc.avatarId !== (p.avatarId || null);
  });
}

/* ═══════════════ Mapeamento automático a partir do doc ═══════════════ */

/** Rótulos que ABREM um bloco de versão no doc. */
const ROTULO_VERSAO_RE = new RegExp(
  '^\\s*(?:' +
    // "Meta Ads:", "Meta:", "Facebook Ads:"
    '(meta(?:\\s*ads)?|facebook(?:\\s*ads)?)' +
    // "Youtube Ads / Kwai Ads:", "YouTube:", "Kwai:", "TikTok Ads:"
    '|((?:you\\s*tube|yt|kwai|tik\\s*tok)(?:\\s*ads)?(?:\\s*[/e|]\\s*(?:you\\s*tube|yt|kwai|tik\\s*tok)(?:\\s*ads)?)*)' +
    // "Avatar 1:", "Avatar 2:", "Versão 3:", "Versao 3:", "V2:"
    '|(?:avatar|vers[aã]o|v)\\s*(\\d{1,2})' +
  ')\\s*:\\s*$',
  'i',
);

export type PapelDoDoc = { role: string; username: string };

export type BlocoDeVersao = {
  rotulo: string;
  /** Nome sugerido pra versão (META, YouTube, Avatar 2...). */
  nome: string;
  papeis: PapelDoDoc[];
};

/** Nome padrão de uma versão a partir do rótulo do doc. */
function nomeDoRotulo(rotulo: string, indice: number): string {
  const r = rotulo.toLowerCase();
  if (/meta|facebook/.test(r)) return 'META';
  if (/you\s*tube|yt/.test(r)) return /kwai/.test(r) ? 'YouTube / Kwai' : 'YouTube';
  if (/kwai/.test(r)) return 'Kwai';
  if (/tik\s*tok/.test(r)) return 'TikTok';
  const m = /(\d{1,2})/.exec(r);
  if (m) return `Avatar ${m[1]}`;
  return `Versão ${indice + 1}`;
}

/** Linha "Doutor: @fulano.mp4" → papel + username (sem o @ e sem extensão). */
function papelDaLinha(linha: string): PapelDoDoc | null {
  const m = /^\s*([\p{L}\s]{2,30}?)\s*:\s*@?\s*([^\s].*?)\s*$/u.exec(linha);
  if (!m) return null;
  const role = m[1].trim();
  let username = m[2].trim();
  if (!username || /^https?:/i.test(username)) return null;
  username = username.replace(/\.(mp4|mov|webm)$/i, '').replace(/^@/, '').trim();
  if (!username || username.length > 80) return null;
  return { role, username };
}

/** Normaliza username pra comparar (mesma régua do resto do Pilot). */
function normUser(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(mp4|mov)$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Lê a seção do AD e devolve os BLOCOS de versão encontrados.
 *
 * Só considera bloco o rótulo seguido de pelo menos uma linha "Papel: avatar".
 * Sem rótulo nenhum (o caso normal), devolve [] — e aí o AD tem uma versão.
 */
export function blocosDeVersaoDoDoc(secaoDoAd: string): BlocoDeVersao[] {
  const linhas = String(secaoDoAd || '').split(/\r?\n/);
  const blocos: BlocoDeVersao[] = [];
  let atual: BlocoDeVersao | null = null;
  for (const bruta of linhas) {
    const linha = bruta.replace(/\s*\[[a-z]{1,3}\]/gi, '').trim();
    if (!linha) continue;
    const rot = ROTULO_VERSAO_RE.exec(linha);
    if (rot) {
      const rotulo = linha.replace(/:\s*$/, '').trim();
      atual = { rotulo, nome: nomeDoRotulo(rotulo, blocos.length), papeis: [] };
      blocos.push(atual);
      continue;
    }
    if (!atual) continue;
    const p = papelDaLinha(linha);
    if (p) atual.papeis.push(p);
  }
  return blocos.filter((b) => b.papeis.length > 0);
}

export type MapeamentoVersoes = {
  /** Quantas versões o doc REALMENTE pede (1 quando os avatares são iguais). */
  total: number;
  /** Uma entrada por versão sugerida, na ordem do doc. */
  versoes: Array<{ nome: string; rotuloDoDoc: string | null; papeis: PapelDoDoc[] }>;
  /** Por que deu esse número — frase curta pra tela. */
  motivo: string;
};

/**
 * O MAPEAMENTO AUTOMÁTICO. Regras (pedido do Silas, 29.08):
 *  · Sem blocos rotulados → 1 versão.
 *  · Blocos rotulados com os MESMOS avatares em todos → 1 versão ("o avatar
 *    é o mesmo nos dois canais, então é a mesma geração").
 *  · Algum papel com avatar diferente → uma versão por bloco (até 10).
 */
export function mapearVersoesDoDoc(secaoDoAd: string): MapeamentoVersoes {
  const blocos = blocosDeVersaoDoDoc(secaoDoAd);
  if (blocos.length <= 1) {
    return {
      total: 1,
      versoes: blocos.length === 1
        ? [{ nome: blocos[0].nome, rotuloDoDoc: blocos[0].rotulo, papeis: blocos[0].papeis }]
        : [],
      motivo: 'O doc pede uma versão só.',
    };
  }
  // Assinatura de cada bloco: papel→username normalizado.
  const assinatura = (b: BlocoDeVersao) =>
    b.papeis
      .map((p) => `${normUser(p.role)}=${normUser(p.username)}`)
      .sort()
      .join('|');
  const primeira = assinatura(blocos[0]);
  const todasIguais = blocos.every((b) => assinatura(b) === primeira);
  if (todasIguais) {
    return {
      total: 1,
      versoes: [{ nome: blocos[0].nome, rotuloDoDoc: blocos[0].rotulo, papeis: blocos[0].papeis }],
      motivo: `O doc mostra ${blocos.length} blocos, mas com o MESMO avatar em todos: é uma geração só (a diferença fica na edição).`,
    };
  }
  const versoes = blocos.slice(0, MAX_VERSOES).map((b) => ({
    nome: b.nome,
    rotuloDoDoc: b.rotulo,
    papeis: b.papeis,
  }));
  return {
    total: versoes.length,
    versoes,
    motivo: `O doc pede ${versoes.length} versões: ${versoes.map((v) => v.nome).join(', ')} (avatares diferentes entre elas).`,
  };
}

/** Nome padrão de uma versão pra UI/lista: "AD02GL · YouTube · @fulano". */
export function rotuloDaVersao(
  taskName: string,
  versao: { nome: string; porPapel?: Record<string, EscolhaAvatarVersao> } | null | undefined,
  avatarPrincipal?: string | null,
): string {
  const partes = [taskName];
  if (versao?.nome) partes.push(versao.nome);
  const av = avatarPrincipal
    || (versao?.porPapel ? Object.values(versao.porPapel).find((e) => e?.avatarName)?.avatarName : null);
  if (av) partes.push(String(av).startsWith('@') ? String(av) : `@${av}`);
  return partes.join(' · ');
}
