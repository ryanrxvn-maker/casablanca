/**
 * Reuso de takes por CONTEÚDO entre tasks — usado só no DR MILLION.
 *
 * Lá, AD07G1GL / AD07G2GL / AD07G3GL são três tasks com hooks diferentes e o
 * MESMO corpo. Disparar as três geraria o corpo três vezes; como o corpo tem
 * ~20 takes, seriam ~60 gerações no HeyGen em vez de ~20 + 3 hooks.
 *
 * A chave é o conteúdo (texto + avatar + voz): mesma fala, mesmo avatar e
 * mesma voz produzem o mesmo vídeo, então dá pra reaproveitar. Como duas
 * tasks podem rodar em paralelo, a primeira que precisa de uma fala RESERVA
 * a chave com uma promessa e as irmãs esperam por ela.
 *
 * A parte perigosa é o índice: só as falas não-reservadas vão pro HeyGen, e o
 * resultado precisa voltar alinhado 1:1 com as partes originais — senão o
 * vídeo de um take entra no lugar de outro. Por isso essas duas funções são
 * puras e testadas.
 */

export type ParteDedup = {
  text?: string | null;
  avatarId?: string | null;
  voiceId?: string | null;
};

export type ResultadoDisparo = {
  /** 1-based na lista ENVIADA ao HeyGen. */
  index: number;
  videoId?: string | null;
  error?: string;
};

/** Chave de conteúdo. Texto vazio nunca casa (parte vazia não vira take). */
export function chaveConteudo(p: ParteDedup): string {
  return `${p.avatarId || ''}|${p.voiceId || ''}|${String(p.text || '').trim()}`;
}

/**
 * Decide o que ESTA task dispara e o que ela herda de uma irmã.
 *
 * @param reservadas chaves já reservadas por outra task (a task não precisa
 *                   saber quem reservou — só que alguém vai gerar).
 * @returns minhasIdx  índices (na ordem original) que vão pro HeyGen
 *          herdadasIdx índices que esperam a irmã
 *          novasChaves chaves que ESTA task passa a reservar, por índice
 */
export function planejarDisparo(
  partes: ParteDedup[],
  opts: { ativo: boolean; reservadas: Set<string> },
): { minhasIdx: number[]; herdadasIdx: number[]; novasChaves: Map<number, string> } {
  const minhasIdx: number[] = [];
  const herdadasIdx: number[] = [];
  const novasChaves = new Map<number, string>();

  if (!opts.ativo) {
    partes.forEach((_, i) => minhasIdx.push(i));
    return { minhasIdx, herdadasIdx, novasChaves };
  }

  // Dentro da MESMA task duas partes idênticas continuam sendo geradas
  // separadamente (não é o caso do DR MILLION e evita surpresa na montagem).
  const reservadasLocal = new Set(opts.reservadas);
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    const txt = String(p.text || '').trim();
    if (!txt) { minhasIdx.push(i); continue; }
    const k = chaveConteudo(p);
    if (reservadasLocal.has(k)) { herdadasIdx.push(i); continue; }
    reservadasLocal.add(k);
    novasChaves.set(i, k);
    minhasIdx.push(i);
  }
  return { minhasIdx, herdadasIdx, novasChaves };
}

/**
 * Remonta o resultado alinhado 1:1 com as partes originais.
 * Sem dedup devolve a MESMA lista recebida (o B2C não muda em nada).
 */
export function montarResultados(
  totalPartes: number,
  minhasIdx: number[],
  enviados: ResultadoDisparo[],
  herdados: Map<number, string | null>,
  ativo: boolean,
): ResultadoDisparo[] {
  if (!ativo) return enviados;
  const out: ResultadoDisparo[] = [];
  for (let i = 0; i < totalPartes; i++) {
    if (herdados.has(i)) {
      const v = herdados.get(i) || null;
      out.push({
        index: i + 1,
        videoId: v,
        ...(v ? {} : { error: 'Corpo compartilhado não gerou — use RETOMAR' }),
      });
      continue;
    }
    const pos = minhasIdx.indexOf(i);
    const r = pos >= 0 ? enviados.find((x) => x.index === pos + 1) : undefined;
    out.push(r ? { ...r, index: i + 1 } : { index: i + 1, videoId: null, error: 'Sem resultado do disparo' });
  }
  return out;
}
