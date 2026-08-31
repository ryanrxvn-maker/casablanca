/**
 * FAXINA (LRU por disparo) do `darkolab-zip-store` — LÓGICA PURA, testável sem IDB.
 *
 * PROBLEMA (medido em produção 2026-07-09): o store guarda montado + takes +
 * partes de TODO disparo e NADA purga. No Chrome — cujo IndexedDB é por-origem e
 * nunca some sozinho — isso vira bola de neve: 223 blobs / 1,58 GB fizeram o BOOT
 * da página levar 70s. O Firefox mascarava (banco separado/limpo por origem).
 * Ver [[project_disco_c_limpeza]] / [[project_entrega_resgate_reload]].
 *
 * REGRA DE OURO (não pode quebrar RETOMAR / resgate de download / isolação):
 *   1. NUNCA remove um disparo em `protect` (ativo/queued/rendering/...).
 *   2. NUNCA remove um disparo tocado nas últimas `minAgeMs` (default 12h) — todo
 *      disparo VIVO é recente, então isto sozinho já blinda o ativo, INCLUSIVE de
 *      outra aba/ferramenta que esta função nem conhece (Hey Auto vs Pilot).
 *   3. Mantém sempre os `keepGroups` disparos MAIS RECENTES inteiros — re-download
 *      + F5 dos que você acabou de fazer continua funcionando.
 *   4. Remove SEMPRE o disparo INTEIRO (todas as chaves daquele taskId de uma vez)
 *      — nunca meia parte, então nunca sobra montado sem takes / parte faltando.
 * Só resta pra remover o que é VELHO, concluído e além da janela — exatamente o
 * lixo que trava o Chrome. Nada de novo/ativo é tocado.
 *
 * INVARIANTES (travadas em zip-store-prune.test.ts):
 *  A. Um disparo em `protect` NUNCA aparece em evictKeys.
 *  B. Um disparo tocado dentro de `minAgeMs` NUNCA aparece em evictKeys.
 *  C. Os `keepGroups` disparos mais recentes NUNCA aparecem em evictKeys.
 *  D. Se um disparo é removido, TODAS as suas chaves saem juntas (grupo inteiro).
 *  E. Todas as chaves de um mesmo taskId caem no MESMO grupo, em qualquer
 *     namespace (batch:/pilot:/va:/troca:white:).
 */

/** Deriva o id do DISPARO (taskId) a partir de uma chave do store. Todas as
 *  chaves de um mesmo disparo — em qualquer namespace — devolvem o MESMO id, pra
 *  que o disparo seja mantido/removido como uma unidade só.
 *
 *  Os regexes ancoram no SUFIXO de artefato conhecido (montado/takes/part/…), não
 *  em split por ':', porque o taskId pode conter ':' (Hey Auto:
 *  `heygenauto:heygen:<ts>:<rand>`). Chave desconhecida vira seu próprio grupo. */
export function zipGroupId(key: string): string {
  let m = /^troca:white:(.+)$/.exec(key);
  if (m) return m[1];
  // `:montado:sig` é a assinatura da montagem — gravada junto do montado e lida
  // pelo card pra detectar montado velho. Sem o `(?::sig)?` ela caía no grupo
  // " misc " e podia ser evictada SEPARADA do montado que assina (achado 31.08).
  m = /^batch:(.+):(?:montado(?::sig)?|takes|camo)$/.exec(key);
  if (m) return m[1];
  // ZIP de b-rolls Magnific do disparo (`magnific:<taskId>:takes`): agrupa com
  // a task dona — como " misc " solto, a faxina varria o pack de b-roll
  // enquanto o disparo seguia vivo (mesmo padrão do bug dos frames de 16/08).
  m = /^magnific:(.+):takes$/.exec(key);
  if (m) return m[1];
  m = /^va:(.+):(?:zip|part(?::.*)?)$/.exec(key);
  if (m) return m[1];
  // Fila do Hey Auto: áudio persistido de item enfileirado (modo audio) —
  // `hgaq:<itemId>:audio:<idx>`. Agrupa pelo itemId pra o item ser mantido/
  // removido como unidade e protegível (via protect) enquanto não entregue.
  m = /^hgaq:(.+):audio:\d+$/.exec(key);
  if (m) return m[1];
  // pilot:<taskId>[:g:<genId>]:(part|leveled|decupado|img):<label|idx>[@k<sec>]
  //
  // ⚠ `img` é o FRAME do modo imagem — insumo do disparo, não resultado dele.
  // Ficou de fora desta lista até 16/08 e caía no grupo " misc <key>": como
  // grupo próprio, competia sozinho pelos keepGroups e a faxina varria os
  // frames enquanto o disparo seguia vivo. Sem o frame, a cena de imagem não
  // tem o que re-disparar e o RETOMAR não fecha o AD nunca.
  // `roleaudio` é o ÁUDIO upado por avatar (insumo, igual ao frame): agrupa
  // com o disparo pra viver e morrer junto dele — nunca como " misc " solto.
  m = /^pilot:(.+?):(?:g:[^:]+:)?(?:part|leveled|decupado|img|roleaudio):/.exec(key);
  if (m) return m[1];
  // Auto B-roll: o MP4 individual de um take é `brollvid:<zipKey>:<idx>` e o
  // ZIP do batch fica na própria zipKey (`broll:<jobId>:<ts>:zip`). Ambos caem
  // no grupo <zipKey> pra o pack ser mantido/removido como unidade — sem isto
  // cada take virava grupo "misc" próprio e a faxina roía os packs antigos
  // aos poucos (preview do histórico ficava cinza take a take).
  m = /^brollvid:(.+):\d+$/.exec(key);
  if (m) return m[1];
  if (key.startsWith('broll:')) return key;
  // FAMOUS HEY: `famousHey:<jobId>:(mp4|img)`. O mp4 e a imagem do mesmo job
  // caem no mesmo grupo pra serem mantidos/removidos como unidade.
  m = /^(famousHey:[^:]+):/.exec(key);
  if (m) return m[1];
  // desconhecida → grupo próprio (só é tocada sob as MESMAS regras: velho + fora da janela)
  return ` misc ${key}`;
}

/**
 * Grupos com CICLO DE VIDA PRÓPRIO — a faxina global nunca os remove.
 *
 * A FAMOUS HEY promete "baixar de novo" pra sempre: o mp4 fica no IndexedDB
 * porque a URL do HeyGen expira em horas. Como chave desconhecida vira grupo
 * próprio, ela caía na regra normal (velho + fora dos keepGroups) e a faxina do
 * boot varria os vídeos depois de 12h — o histórico continuava listando tudo e
 * o botão de baixar não trazia nada, que é pior do que não ter histórico.
 *
 * Isto NÃO deixa o store crescer sem teto: o lib/famous-hey-store.ts guarda no
 * máximo 30 jobs e apaga os blobs dos que saem da lista. Quem cria o namespace
 * é que responde pelo tamanho dele.
 *
 * ⚠ Os bytes continuam contando no total — só a REMOÇÃO é que não os alcança.
 */
export function grupoAutogerido(groupId: string): boolean {
  return groupId.startsWith('famousHey:');
}

export interface ZipMeta {
  key: string;
  /** bytes do registro; opcional — quando ausente a válvula de tamanho vira no-op */
  size?: number;
  /** Date.now() de quando foi gravado */
  createdAt: number;
}

export interface PruneOptions {
  /** taskIds do(s) disparo(s) que NÃO podem ser tocados (ativo/queued/…) */
  protect?: Iterable<string>;
  /** quantos disparos mais recentes manter SEMPRE inteiros (default 12) */
  keepGroups?: number;
  /** janela de proteção por idade em ms — nada tocado dentro dela é removido (default 12h) */
  minAgeMs?: number;
  /** teto de bytes: se o que sobra passar disso, remove os MAIS ANTIGOS não
   *  protegidos/recentes até caber (default 1,2 GB). Só atua se houver `size`. */
  maxBytes?: number;
  /** relógio injetável pra teste */
  now?: number;
}

export interface PrunePlan {
  /** chaves exatas a apagar do store */
  evictKeys: string[];
  stats: {
    groups: number;
    keptGroups: number;
    evictedGroups: number;
    totalBytes: number;
    freedBytes: number;
  };
}

// Padrões calibrados pelo caso real (223 blobs / 1,58 GB → boot de 70s): o boot
// HIDRATA o montado de cada disparo concluído (pra reabilitar o download), então
// quanto menos disparos guardados, mais rápido o arranque. 8 disparos é folgado
// pra re-baixar o que você acabou de fazer; >12h você re-dispara em vez de contar
// com o cache do navegador. maxBytes é o teto duro que segura casos patológicos.
const DEFAULT_KEEP_GROUPS = 8;
const DEFAULT_MIN_AGE_MS = 12 * 60 * 60 * 1000; // 12h
const DEFAULT_MAX_BYTES = 800_000_000; // ~800 MB

/** Decide (SEM tocar em IDB) quais chaves apagar. Puro e determinístico. */
export function planZipEviction(records: ZipMeta[], opts: PruneOptions = {}): PrunePlan {
  const keepGroups = Math.max(0, opts.keepGroups ?? DEFAULT_KEEP_GROUPS);
  const minAgeMs = Math.max(0, opts.minAgeMs ?? DEFAULT_MIN_AGE_MS);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = opts.now ?? Date.now();
  const protect = new Set<string>(opts.protect ? Array.from(opts.protect) : []);

  // 1. agrupa por disparo (taskId)
  const groups = new Map<string, { keys: string[]; size: number; newest: number }>();
  for (const r of records) {
    const g = zipGroupId(r.key);
    let e = groups.get(g);
    if (!e) { e = { keys: [], size: 0, newest: 0 }; groups.set(g, e); }
    e.keys.push(r.key);
    e.size += Math.max(0, r.size || 0);
    e.newest = Math.max(e.newest, r.createdAt || 0);
  }

  const arr = Array.from(groups.entries()).map(([id, e]) => ({ id, ...e }));
  // mais recente primeiro (empate: id estável pra determinismo)
  arr.sort((a, b) => (b.newest - a.newest) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const totalBytes = arr.reduce((s, g) => s + g.size, 0);

  // 2. quem é intocável: protegido OU recente OU entre os keepGroups mais novos
  const pinned = new Set<string>();
  arr.forEach((g, idx) => {
    const isProtected = protect.has(g.id);
    const isRecent = now - g.newest < minAgeMs;
    const isTopN = idx < keepGroups;
    if (isProtected || isRecent || isTopN || grupoAutogerido(g.id)) pinned.add(g.id);
  });

  // Fase 1: remove tudo que NÃO é intocável (velho, concluído, além da janela)
  const evictKeys: string[] = [];
  let freedBytes = 0;
  let evictedGroups = 0;
  const survivors: Array<{ id: string; keys: string[]; size: number; newest: number }> = [];
  for (const g of arr) {
    if (pinned.has(g.id)) { survivors.push(g); continue; }
    for (const k of g.keys) evictKeys.push(k);
    freedBytes += g.size;
    evictedGroups++;
  }

  // Fase 2 (válvula de tamanho): se o que sobrou ainda passa de maxBytes, remove
  // os MAIS ANTIGOS dos sobreviventes que NÃO são protegidos nem recentes — do
  // mais velho pro mais novo. NUNCA toca protegido/recente (a segurança vence o teto).
  let keptBytes = totalBytes - freedBytes;
  if (keptBytes > maxBytes) {
    for (let i = survivors.length - 1; i >= 0 && keptBytes > maxBytes; i--) {
      const g = survivors[i];
      if (protect.has(g.id)) continue;
      if (grupoAutogerido(g.id)) continue;
      if (now - g.newest < minAgeMs) continue;
      for (const k of g.keys) evictKeys.push(k);
      freedBytes += g.size;
      keptBytes -= g.size;
      evictedGroups++;
    }
  }

  return {
    evictKeys,
    stats: {
      groups: arr.length,
      keptGroups: arr.length - evictedGroups,
      evictedGroups,
      totalBytes,
      freedBytes,
    },
  };
}
