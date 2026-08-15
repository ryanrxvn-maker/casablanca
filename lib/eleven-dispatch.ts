/**
 * Disparo de VOZ (ElevenLabs) de um AD do DR MILLION.
 *
 * ─────────────────────── o problema que isso resolve ───────────────────────
 * No DR MILLION um AD tem UM corpo e VARIOS ganchos: AD07G1GL, AD07G2GL,
 * AD07G3GL sao a mesma peça, muda so o hook. A entrega e um MP3 por gancho:
 *
 *     hook 1 + body        hook 2 + body        hook 3 + body
 *
 * O jeito ingenuo geraria o corpo TRES vezes. O corpo e a parte longa da
 * copy, entao isso triplicaria o gasto de caracteres do plano pra entregar
 * exatamente o mesmo audio. Aqui o corpo e gerado UMA vez e emendado nos tres
 * — mesmo som, um terco do custo.
 *
 * O planejamento e PURO de proposito (nada de rede/DOM): e a peça que decide
 * onde o dinheiro do user vai, entao ela e testavel isoladamente
 * ([[eleven-dispatch.test]]).
 */

import type { ElevenVoiceSettings } from './elevenlabs-api-direct';
import { elevenDeliverableName } from './eleven-pilot-config';

/* ═════════════════════════ Entrada do plano ═════════════════════════ */

export type ElevenHookInput = {
  /** Task do ClickUp desse gancho (cada hook e uma task propria). */
  taskId: string;
  /** Codigo do AD do gancho — vira o nome do arquivo (AD07G1GL). */
  adId: string;
  text: string;
  /** O user escolhe quais ganchos entram neste disparo. */
  selected: boolean;
};

export type ElevenPlanInput = {
  /** Grupo do AD (AD07) — dono do corpo. */
  groupId: string;
  bodyText: string;
  hooks: ElevenHookInput[];
};

/* ═════════════════════════ Saida do plano ═════════════════════════ */

/** Id reservado do corpo. Nao colide com codigo de AD (que sempre tem digito). */
export const BODY_ID = '__BODY__';

export type ElevenGenJob = {
  /** 'body' | 'hook' */
  kind: 'body' | 'hook';
  /** BODY_ID pro corpo; o codigo do AD pro gancho. */
  id: string;
  text: string;
  /** So em gancho: a task de origem. */
  taskId?: string;
  /** Ganchos com texto identico a este (reusam a MESMA geracao). */
  alsoServes?: string[];
};

export type ElevenAssembly = {
  /** Nome do MP3 entregue (AD07G1GL.mp3). */
  filename: string;
  adId: string;
  taskId: string | null;
  /** Ids das geracoes, NA ORDEM da emenda (gancho e depois corpo). */
  pieces: string[];
};

export type ElevenPlan = {
  groupId: string;
  /** O que precisa ser gerado — cada item, UMA vez. */
  jobs: ElevenGenJob[];
  /** O que sai no fim, montado a partir dos jobs. */
  assemblies: ElevenAssembly[];
  /** Caracteres que este plano manda pro ElevenLabs. */
  charsToGenerate: number;
  /** O que custaria gerando o corpo pra cada gancho. */
  charsNaive: number;
  /** Economia (charsNaive - charsToGenerate). */
  charsSaved: number;
  /** Avisos pra tela — nunca joga trabalho fora em silencio. */
  issues: string[];
};

/** Normaliza pra comparar textos de gancho (espaco/caixa nao fazem gancho
 *  diferente — e gerar dois audios identicos e credito no lixo). */
function normalizeText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Monta o plano do disparo.
 *
 * Garantias (as que importam pro bolso e pra entrega):
 *   1. O corpo aparece em `jobs` NO MAXIMO uma vez.
 *   2. Ganchos com o mesmo texto viram UMA geracao (reusada nos dois).
 *   3. Todo gancho marcado com texto vira exatamente um arquivo final.
 *   4. Gancho sem texto nao vira arquivo — e entra em `issues`, visivel.
 */
export function planElevenDispatch(input: ElevenPlanInput): ElevenPlan {
  const issues: string[] = [];
  const bodyText = (input.bodyText || '').trim();

  const escolhidos = (input.hooks || []).filter((h) => h.selected);
  const comTexto: ElevenHookInput[] = [];
  for (const h of escolhidos) {
    if (!(h.text || '').trim()) {
      issues.push(`${h.adId}: o gancho está vazio no doc — não entra no disparo.`);
      continue;
    }
    comTexto.push(h);
  }

  const jobs: ElevenGenJob[] = [];
  const assemblies: ElevenAssembly[] = [];

  // ── Corpo: uma geracao, muitos usos ──
  const temBody = bodyText.length > 0;
  if (temBody) jobs.push({ kind: 'body', id: BODY_ID, text: bodyText });

  // ── Ganchos: dedup por texto ──
  const donoPorTexto = new Map<string, ElevenGenJob>();
  for (const h of comTexto) {
    const chave = normalizeText(h.text);
    const dono = donoPorTexto.get(chave);
    if (dono) {
      // Mesmo gancho escrito em duas tasks: gera 1x, entrega 2 arquivos.
      dono.alsoServes = [...(dono.alsoServes || []), h.adId];
    } else {
      const job: ElevenGenJob = {
        kind: 'hook',
        id: h.adId,
        text: h.text.trim(),
        taskId: h.taskId,
      };
      donoPorTexto.set(chave, job);
      jobs.push(job);
    }
    assemblies.push({
      filename: elevenDeliverableName(h.adId),
      adId: h.adId,
      taskId: h.taskId,
      pieces: temBody ? [donoPorTexto.get(chave)!.id, BODY_ID] : [donoPorTexto.get(chave)!.id],
    });
  }

  // ── So corpo (nenhum gancho marcado): ainda assim entrega o corpo ──
  if (assemblies.length === 0 && temBody) {
    assemblies.push({
      filename: elevenDeliverableName(input.groupId),
      adId: input.groupId,
      taskId: null,
      pieces: [BODY_ID],
    });
  }

  if (assemblies.length === 0) {
    issues.push('Nada pra gerar: nenhum gancho marcado e o corpo está vazio.');
  }

  const charsBody = temBody ? bodyText.length : 0;
  const charsHooks = jobs
    .filter((j) => j.kind === 'hook')
    .reduce((acc, j) => acc + j.text.length, 0);
  const charsToGenerate = charsBody + charsHooks;

  // Ingenuo = o corpo repetido em cada arquivo final + os ganchos escritos.
  const arquivosComBody = assemblies.filter((a) => a.pieces.includes(BODY_ID)).length;
  const charsHooksIngenuo = comTexto.reduce((acc, h) => acc + h.text.trim().length, 0);
  const charsNaive = charsBody * arquivosComBody + charsHooksIngenuo;

  return {
    groupId: input.groupId,
    jobs,
    assemblies,
    charsToGenerate,
    charsNaive,
    charsSaved: Math.max(0, charsNaive - charsToGenerate),
    issues,
  };
}

/* ═════════════════════════ Execucao ═════════════════════════ */

export type ElevenRunOptions = {
  voiceId: string;
  modelId: string;
  settings: ElevenVoiceSettings;
  languageCode?: string | null;
  onProgress?: (info: {
    /** Geracoes concluidas / total. */
    feitas: number;
    total: number;
    etapa: string;
  }) => void;
  isCancelled?: () => boolean;
  /** Injetado nos testes; em produção usa a lib real. */
  deps?: {
    generate: (args: {
      text: string;
      voiceId: string;
      modelId: string;
      settings: ElevenVoiceSettings;
      languageCode?: string | null;
      isCancelled?: () => boolean;
    }) => Promise<{ blob: Blob; chars: number }>;
    concat: (parts: Blob[]) => Promise<Blob>;
  };
};

export type ElevenDeliverable = {
  filename: string;
  adId: string;
  taskId: string | null;
  blob: Blob;
};

export type ElevenRunResult = {
  deliverables: ElevenDeliverable[];
  charsUsed: number;
  charsSaved: number;
  /** Falhas por arquivo — o resto da entrega continua valendo. */
  failures: Array<{ adId: string; error: string }>;
};

/**
 * Executa o plano: gera cada job UMA vez e emenda as entregas.
 *
 * Se um gancho falha, so o arquivo DELE cai — os outros continuam. Se o
 * CORPO falha, ai sim nada monta (todo arquivo depende dele), e o erro sobe
 * inteiro em vez de entregar tres audios so com o gancho.
 */
export async function runElevenDispatch(
  plan: ElevenPlan,
  opts: ElevenRunOptions,
): Promise<ElevenRunResult> {
  const deps =
    opts.deps ??
    ({
      generate: async (args) => {
        const { generateElevenSpeech } = await import('./elevenlabs-api-direct');
        const r = await generateElevenSpeech({
          text: args.text,
          voiceId: args.voiceId,
          modelId: args.modelId,
          settings: args.settings,
          languageCode: args.languageCode,
          isCancelled: args.isCancelled,
        });
        return { blob: r.blob, chars: r.chars };
      },
      concat: async (parts) => {
        const { concatElevenAudios } = await import('./elevenlabs-api-direct');
        return concatElevenAudios(parts);
      },
    } satisfies NonNullable<ElevenRunOptions['deps']>);

  const gerados = new Map<string, Blob>();
  const failures: Array<{ adId: string; error: string }> = [];
  let charsUsed = 0;

  const total = plan.jobs.length;
  let feitas = 0;

  // ── 1. Gera cada job UMA vez (corpo primeiro: se ele morrer, para logo) ──
  const ordenados = [...plan.jobs].sort((a, b) => (a.kind === 'body' ? -1 : b.kind === 'body' ? 1 : 0));
  for (const job of ordenados) {
    if (opts.isCancelled?.()) throw new Error('Cancelado pelo usuário.');
    const rotulo = job.kind === 'body' ? 'corpo' : job.id;
    opts.onProgress?.({ feitas, total, etapa: `Gerando ${rotulo}…` });
    try {
      const r = await deps.generate({
        text: job.text,
        voiceId: opts.voiceId,
        modelId: opts.modelId,
        settings: opts.settings,
        languageCode: opts.languageCode ?? null,
        isCancelled: opts.isCancelled,
      });
      gerados.set(job.id, r.blob);
      charsUsed += r.chars;
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (job.kind === 'body') {
        // Sem corpo nao existe entrega — falhar aqui e mais honesto que
        // entregar N audios truncados no gancho.
        throw new Error(`O corpo não foi gerado (${msg}). Nenhum áudio foi montado.`);
      }
      failures.push({ adId: job.id, error: msg });
      for (const extra of job.alsoServes || []) failures.push({ adId: extra, error: msg });
    }
    feitas++;
    opts.onProgress?.({ feitas, total, etapa: `Gerado ${rotulo}.` });
  }

  // ── 2. Monta as entregas (emenda, sem gerar nada de novo) ──
  const deliverables: ElevenDeliverable[] = [];
  for (const asm of plan.assemblies) {
    if (opts.isCancelled?.()) throw new Error('Cancelado pelo usuário.');
    const partes: Blob[] = [];
    let faltou = false;
    for (const pid of asm.pieces) {
      const b = gerados.get(pid);
      if (!b) {
        faltou = true;
        break;
      }
      partes.push(b);
    }
    if (faltou) {
      if (!failures.some((f) => f.adId === asm.adId)) {
        failures.push({ adId: asm.adId, error: 'faltou um pedaço da geração' });
      }
      continue;
    }
    opts.onProgress?.({ feitas: total, total, etapa: `Montando ${asm.filename}…` });
    try {
      const blob = partes.length === 1 ? partes[0] : await deps.concat(partes);
      deliverables.push({ filename: asm.filename, adId: asm.adId, taskId: asm.taskId, blob });
    } catch (e) {
      failures.push({ adId: asm.adId, error: 'falha ao juntar hook + corpo: ' + ((e as Error)?.message || String(e)) });
    }
  }

  return { deliverables, charsUsed, charsSaved: plan.charsSaved, failures };
}
