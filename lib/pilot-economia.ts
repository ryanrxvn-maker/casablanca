/**
 * MODO ECONOMIA do Pilot — plano de cenas pro HeyGen Studio.
 *
 * No disparo normal cada take vira uma geração pela API (Quick Create) e
 * CONSOME crédito da conta. No modo economia o disparo vai pelo Studio
 * (app.heygen.com/create-v4): o AD inteiro vira um projeto com uma CENA por
 * take, e cada cena é renderizada pelo botão "Render Scene" — que no Avatar III
 * não cobra. Os vídeos das cenas voltam pela extensão e o Pilot monta como
 * sempre: pro usuário o resultado é o mesmo, só não saiu crédito.
 *
 * Esta lib é PURA (roda em teste, sem navegador). Ela responde três coisas:
 *
 *   1. QUAIS takes podem ir pelo modo economia (e por que os outros não podem);
 *   2. COMO agrupá-los em projetos do Studio — um projeto por AVATAR, porque o
 *      editor nasce amarrado a um look pela URL e todas as cenas herdam ele;
 *   3. O QUE fica travado: Avatar III sempre, gesto nunca.
 *
 * ⚠ A trava do gesto não é cosmética. No disparo normal, `motorEfetivo` sobe a
 * cena pra Avatar IV sozinha quando existe `motionPrompt` — e Avatar IV COBRA.
 * Por isso o gesto é REMOVIDO aqui, na origem, e não só escondido na tela.
 */

/** O motor é sempre este no modo economia. IV e V cobram. */
export const MOTOR_ECONOMIA = 'III' as const;

/** Take do plano do Pilot, na parte que interessa pro modo economia. */
export type ParteDoPlano = {
  label: string;
  text?: string | null;
  avatarId?: string | null;
  /** grupo do avatar — a URL do editor Studio usa os dois */
  groupId?: string | null;
  avatarName?: string | null;
  voiceId?: string | null;
  voiceName?: string | null;
  /** gesto: no modo economia é sempre descartado (subiria pro Avatar IV) */
  motionPrompt?: string | null;
  /** motor pedido na cena; no modo economia vira sempre III */
  engine?: string | null;
  /** modo imagem: cena sem avatar da biblioteca */
  imageDataUrl?: string | null;
  imageKey?: string | null;
  /** áudio upado pra esta parte */
  audioKey?: string | null;
};

/** Uma cena do projeto Studio. `idx` é a posição no plano original — é por ele
 *  que o resultado volta alinhado 1:1 com `plan.parts`. */
export type CenaEconomia = {
  idx: number;
  label: string;
  texto: string;
};

/** Um projeto do Studio: um avatar, N cenas, na ordem do plano. */
export type ProjetoEconomia = {
  avatarId: string;
  groupId: string | null;
  avatarName: string | null;
  voiceId: string | null;
  voiceName: string | null;
  cenas: CenaEconomia[];
};

export type MotivoRecusa =
  | 'sem-texto'
  | 'modo-imagem'
  | 'audio-upado'
  | 'sem-avatar';

export type RecusaEconomia = {
  idx: number;
  label: string;
  motivo: MotivoRecusa;
};

export type AvisoEconomia = {
  idx: number;
  label: string;
  aviso: 'gesto-removido' | 'motor-rebaixado';
  detalhe: string;
};

export type PlanoEconomia = {
  projetos: ProjetoEconomia[];
  /** takes que NÃO podem ir pelo modo economia */
  recusas: RecusaEconomia[];
  /** o que foi ajustado à força pra não cobrar */
  avisos: AvisoEconomia[];
};

export type OpcoesEconomia = {
  /** Teto de cenas por projeto do Studio. 0 ou ausente = sem teto (o AD inteiro
   *  num projeto só). Existe porque um projeto gigante pode pesar o editor;
   *  o valor certo depende de medição ao vivo. */
  maxCenasPorProjeto?: number;
  /**
   * Índice de cada parte NO PLANO do Pilot, quando `partes` não é o plano
   * inteiro. O chamador costuma enviar só um subconjunto (no dedup do
   * DR MILLION as falas que a task irmã já está gerando ficam de fora), e aí a
   * posição no array enviado NÃO é o índice do plano.
   *
   * ⚠ Sem isto a cena voltaria casada com o take ERRADO: a montagem sairia
   * completa, o card diria PRONTO e a fala estaria trocada.
   */
  indicesDoPlano?: number[];
};

const MOTIVO_TEXTO: Record<MotivoRecusa, string> = {
  'sem-texto': 'sem texto pra falar',
  'modo-imagem': 'modo imagem (a cena não tem avatar da biblioteca)',
  'audio-upado': 'áudio upado (o modo economia fala por texto)',
  'sem-avatar': 'sem avatar escolhido',
};

export function motivoLegivel(m: MotivoRecusa): string {
  return MOTIVO_TEXTO[m];
}

/** O take pode ir pelo Studio? Devolve o motivo quando não. */
export function recusaDaParte(p: ParteDoPlano): MotivoRecusa | null {
  if (p.imageDataUrl || p.imageKey) return 'modo-imagem';
  if (p.audioKey) return 'audio-upado';
  if (!p.avatarId) return 'sem-avatar';
  if (!(p.text || '').trim()) return 'sem-texto';
  return null;
}

/** Um AD inteiro pode ir pelo modo economia? (Todos os takes precisam poder —
 *  meio a meio significaria metade do AD cobrando, o que não é economia.) */
export function podeEconomia(partes: ParteDoPlano[]): boolean {
  return partes.length > 0 && partes.every((p) => recusaDaParte(p) === null);
}

/**
 * Plano de cenas: agrupa os takes por AVATAR (o editor Studio nasce amarrado a
 * um look), preservando a ordem do plano dentro de cada grupo. Takes que não
 * podem ir aparecem em `recusas`; gesto e motor pago viram `avisos` e são
 * removidos, nunca enviados.
 */
export function planejarEconomia(partes: ParteDoPlano[], opts: OpcoesEconomia = {}): PlanoEconomia {
  const recusas: RecusaEconomia[] = [];
  const avisos: AvisoEconomia[] = [];
  // Ordem de chegada dos avatares: o primeiro take de cada avatar define a
  // posição do projeto. Sem isto, dois avatares alternados embaralhariam a fila.
  const ordem: string[] = [];
  const porAvatar = new Map<string, ProjetoEconomia>();
  // Posição no array enviado → índice no plano do Pilot.
  const noPlano = (pos: number) => opts.indicesDoPlano?.[pos] ?? pos;

  partes.forEach((p, pos) => {
    const idx = noPlano(pos);
    const motivo = recusaDaParte(p);
    if (motivo) {
      recusas.push({ idx, label: p.label, motivo });
      return;
    }
    if ((p.motionPrompt || '').trim()) {
      avisos.push({
        idx,
        label: p.label,
        aviso: 'gesto-removido',
        detalhe: 'o gesto sobe a cena pro Avatar IV, que cobra — no modo economia ele não vai',
      });
    }
    const motor = String(p.engine || '').toUpperCase();
    if (motor === 'IV' || motor === 'V') {
      avisos.push({
        idx,
        label: p.label,
        aviso: 'motor-rebaixado',
        detalhe: `Avatar ${motor} cobra — esta cena vai em Avatar ${MOTOR_ECONOMIA}`,
      });
    }
    const chave = p.avatarId as string;
    let proj = porAvatar.get(chave);
    if (!proj) {
      proj = {
        avatarId: chave,
        groupId: p.groupId ?? null,
        avatarName: p.avatarName ?? null,
        voiceId: p.voiceId ?? null,
        voiceName: p.voiceName ?? null,
        cenas: [],
      };
      porAvatar.set(chave, proj);
      ordem.push(chave);
    }
    // groupId/voz podem só aparecer num take posterior do mesmo avatar.
    if (!proj.groupId && p.groupId) proj.groupId = p.groupId;
    if (!proj.voiceId && p.voiceId) proj.voiceId = p.voiceId;
    if (!proj.voiceName && p.voiceName) proj.voiceName = p.voiceName;
    proj.cenas.push({ idx, label: p.label, texto: (p.text || '').trim() });
  });

  const cheios = ordem.map((k) => porAvatar.get(k)!).filter((p) => p.cenas.length > 0);
  const teto = opts.maxCenasPorProjeto && opts.maxCenasPorProjeto > 0 ? opts.maxCenasPorProjeto : 0;
  const projetos = teto ? cheios.flatMap((p) => fatiar(p, teto)) : cheios;
  return { projetos, recusas, avisos };
}

function fatiar(proj: ProjetoEconomia, teto: number): ProjetoEconomia[] {
  const out: ProjetoEconomia[] = [];
  for (let i = 0; i < proj.cenas.length; i += teto) {
    out.push({ ...proj, cenas: proj.cenas.slice(i, i + teto) });
  }
  return out;
}

/** Quantas cenas o plano tem no total (cada uma é um Render Scene). */
export function totalDeCenas(plano: PlanoEconomia): number {
  return plano.projetos.reduce((n, p) => n + p.cenas.length, 0);
}

/** Uma linha pro card: "2 projetos · 9 cenas · Avatar III, sem gesto". */
export function resumoDoPlano(plano: PlanoEconomia): string {
  const cenas = totalDeCenas(plano);
  const projs = plano.projetos.length;
  if (cenas === 0) return 'nenhuma cena pode ir pelo modo economia';
  const partes = [
    `${projs} projeto${projs === 1 ? '' : 's'} no Studio`,
    `${cenas} cena${cenas === 1 ? '' : 's'}`,
    `Avatar ${MOTOR_ECONOMIA}, sem gesto`,
  ];
  return partes.join(' · ');
}

/**
 * Resultado de uma cena renderizada, como a extensão devolve.
 * `videoUrl` é o MP4 da cena; `videoId` existe quando dá pra identificar o
 * render na conta (serve pro poll/resgate do pipeline de sempre).
 */
export type ResultadoCena = {
  idx: number;
  videoId?: string | null;
  videoUrl?: string | null;
  error?: string | null;
};

export type ResultadoRunner = {
  /** 1-based na lista ENVIADA — mesmo contrato do runHeyGenJobs. */
  index: number;
  label: string;
  videoId: string | null;
  error: string | null;
};

/* ─────────── id sintético ───────────
 * O pipeline do Pilot é todo ancorado em `videoId`: ele filtra
 * `results.filter(r => r.videoId)`, faz poll com essa lista e baixa por
 * `finalStatuses[videoId].videoUrl`. Uma cena que renderiza e devolve só a
 * URL (o caso mais provável do Render Scene) NÃO tem id pollável — e passaria
 * pelo filtro como se nunca tivesse disparado, calada.
 *
 * Então a cena com URL ganha um id SINTÉTICO e o chamador pré-preenche o mapa
 * de status como 'completed'. O poll não tem o que esperar e o download acha a
 * URL no lugar de sempre: o resto do pipeline não sabe a diferença. */
export const ID_SINTETICO_PREFIXO = 'eco:';

export function idSinteticoDaCena(idx: number): string {
  return `${ID_SINTETICO_PREFIXO}${idx}`;
}

export function ehIdSintetico(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(ID_SINTETICO_PREFIXO);
}

/** O id que representa a cena no pipeline: o do HeyGen quando existe, senão o
 *  sintético (que só vale porque vem acompanhado da URL). */
export function idDaCena(c: ResultadoCena): string | null {
  if (c.videoId) return c.videoId;
  if (c.videoUrl) return idSinteticoDaCena(c.idx);
  return null;
}

export type StatusDaCena = { videoId: string; status: 'completed'; videoUrl: string };

/** Mapa pronto pra entrar em `finalStatuses`: toda cena que voltou com URL já
 *  nasce 'completed', então o poll pula e o download acontece direto. */
export function statusDasCenas(cenas: ResultadoCena[]): Record<string, StatusDaCena> {
  const out: Record<string, StatusDaCena> = {};
  for (const c of cenas) {
    if (c.error || !c.videoUrl) continue;
    const id = idDaCena(c);
    if (!id) continue;
    out[id] = { videoId: id, status: 'completed', videoUrl: c.videoUrl };
  }
  return out;
}

/**
 * Adapta os resultados das cenas pro MESMO contrato que `runHeyGenJobs`
 * devolve, alinhado 1:1 com a lista de takes enviada. É o que faz o resto do
 * pipeline (poll, download, auto-cura, montagem) seguir sem saber que o
 * disparo veio do Studio.
 *
 * `enviados` são os índices do plano que foram pro modo economia, na ordem em
 * que o Pilot os enviou. Cena sem resultado vira erro explícito — nunca sumida.
 */
export function resultadosParaRunner(
  enviados: number[],
  partes: ParteDoPlano[],
  cenas: ResultadoCena[],
  /** Motivo pelo qual o Studio parou, quando houve um. Vira o erro das cenas
   *  que NÃO voltaram — senão o card mostrava só "a cena não voltou do
   *  Studio", que é o sintoma, e o motivo de verdade ("New HeyGen plans are
   *  here", "Outra geracao em andamento") ficava só no console do F12. */
  motivoGeral?: string | null,
): ResultadoRunner[] {
  const porIdx = new Map<number, ResultadoCena>();
  for (const c of cenas) porIdx.set(c.idx, c);
  return enviados.map((idx, i) => {
    const c = porIdx.get(idx);
    const label = partes[idx]?.label ?? `take ${idx + 1}`;
    if (!c) {
      const motivo = (motivoGeral || '').trim();
      return {
        index: i + 1,
        label,
        videoId: null,
        error: motivo ? `a cena não voltou do Studio: ${motivo}` : 'a cena não voltou do Studio',
      };
    }
    if (c.error) return { index: i + 1, label, videoId: null, error: c.error };
    const id = idDaCena(c);
    if (!id) {
      return { index: i + 1, label, videoId: null, error: 'a cena renderizou mas o vídeo não foi capturado' };
    }
    // Cena só com URL entra com id sintético — sem isso ela sumiria do
    // `results.filter(r => r.videoId)` do Pilot sem erro nenhum.
    return { index: i + 1, label, videoId: id, error: null };
  });
}

/** O que o modo economia trava na tela e no disparo. */
export function travasDoModoEconomia(): {
  motor: typeof MOTOR_ECONOMIA;
  gestoBloqueado: true;
  motoresBloqueados: readonly ['IV', 'V'];
  porque: string;
} {
  return {
    motor: MOTOR_ECONOMIA,
    gestoBloqueado: true,
    motoresBloqueados: ['IV', 'V'] as const,
    porque: 'só o Avatar III renderiza cena sem cobrar; gesto sobe pro Avatar IV, que cobra',
  };
}
