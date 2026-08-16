'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logHistory } from '@/lib/history';
import { toFriendlyMessage } from '@/lib/friendly-error';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  getClickUpToken,
  setClickUpToken,
  listTeams,
  listTasks,
  getTask,
  getTaskComments,
  getCurrentUser,
  extractDocLinks,
  extractDriveFileIdFromText,
  type ClickUpTeam,
  type ClickUpTask,
  type ClickUpUser,
} from '@/lib/clickup-client';
import {
  parseAdSection,
  parseDarkoBriefing,
  extractVariantToken,
  matchAvatar,
  normAvatarKey,
  isVATask,
  isTrocaAudioTask,
  parseVABriefing,
  sanitizeSpokenCopy,
  extractAvaNumsFromTaskName,
  extractYouTubeId,
  youTubeThumb,
  findAdSection,
  type ParsedAdSection,
  type ParsedDarkoBriefing,
  type ParsedVABriefing,
} from '@/lib/copy-parser';
import { alignEditedToWords } from '@/lib/edited-text-align';
import { newPilotGenId, pilotGenPrefix, pilotPartKey } from '@/lib/pilot-gen-isolation';
import { splitCopyIntoParts, cloneVoiceViaExtension, detectExtension } from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerResult } from '@/lib/heygen-job-runner';
import {
  pollVideosUntilReady,
  downloadVideoBytes,
  isQuotaError,
  deleteVideo,
  isSyntheticPollError,
  classifyForRedispatch,
  getVideosStatus,
  type VideoStatus,
} from '@/lib/heygen-api-direct';
import { getHeyGenHealth } from '@/lib/heygen-health';
import { isChunkLoadError, reloadOnceForChunk } from '@/lib/chunk-guard';
import {
  getLibrarySnapshot,
  reloadLibrary,
  subscribeLibrary,
} from '@/lib/heygen-library-cache';
import { useTier, tierCanAutomate } from '@/lib/use-tier';
import Link from 'next/link';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { CompactVoiceSelector } from '@/components/CompactVoiceSelector';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { BatchJobCard3D } from '@/components/BatchJobCard3D';
import { EditPartModal } from '@/components/EditPartModal';
import {
  PilotBtn3D,
  IconScissors as PilotIconScissors,
  IconCamuflagem,
  IconDoc as PilotIconDoc,
  IconPlay as PilotIconPlay,
  IconX as PilotIconX,
  IconUpload as PilotIconUpload,
  IconBroll as PilotIconBroll,
  IconDownload as PilotIconDownload,
} from '@/components/PilotCardActions';
import { MotorConfigPicker, MotorSlotPicker } from '@/components/MotorConfigPicker';
import { defaultMotorConfig, resolveMotors, estimateSecondsFromText, type MotorConfig, type Motor } from '@/lib/motor-config';
import type { AvatarOption } from '@/components/HeyGenAvatarPicker';
import { recallByVoiceName, rememberPairing, normalizeVoiceName, recallAvatarVoice, rememberAvatarVoice } from '@/lib/voice-avatar-memory';
import { Toggle3D } from '@/components/Toggle3D';
import { ToggleRound3D, WirelessIcon, ScissorsIcon, ReviewEyeIcon } from '@/components/ToggleRound3D';
import { IconClickUpPilot } from '@/components/ToolIcons';
import { TierGate } from '@/components/TierGate';
import {
  getPilotTeam,
  setPilotTeam,
  getPilotEditor,
  setPilotEditor,
  getPilotEditorForTeam,
  getPilotEditorForTeamStrict,
  setPilotEditorForTeam,
  resolveStatusExtras,
  mergeStatuses,
  shortWorkspaceLabel,
  workspaceAccent,
  sortWorkspacesForSwitch,
  setPilotTeamNames,
} from '@/lib/clickup-pilot-config';
import { WorkspaceSwitch3D } from '@/components/WorkspaceSwitch3D';
import {
  isDrMillionFormat,
  parseDrMillionBriefing,
  idiomasDisponiveis,
  conferirCoberturaDaCopy,
  adGroupOf,
  type DrMillionLang,
} from '@/lib/drmillion-parser';
import { LangSwitch3D } from '@/components/LangSwitch3D';
import { planejarDisparo, montarResultados, chaveConteudo } from '@/lib/pilot-dedup';
import { takeUnicoPorLook } from '@/lib/heygen-motion-motor';
import { runPostPipeline } from '@/lib/clickup-pilot-pipeline';
import { runFfmpegExclusive as runFfmpegSerial } from '@/lib/ffmpeg-serial';
import { sleepUnthrottled } from '@/lib/unthrottled-clock';
import { acquireKeepAlive, releaseKeepAlive } from '@/lib/tab-keepalive';
import { parseMagnificPrompts } from '@/lib/magnific-pipeline';
import { runMagnificPipelineV2 } from '@/lib/magnific-pipeline-v2';
import { abortAllMagnific } from '@/lib/magnific-extension-bridge';
import {
  saveMagnificQueue,
  restoreMagnificQueue,
  pickNextMagnificJob,
  loadMagnificJsonMap,
  saveMagnificJsonMap,
  tryAcquireMagnificJob,
  pulseHeartbeat,
  thisTabId,
  isMagnificJobAlive,
  HEARTBEAT_INTERVAL_MS,
  MAGNIFIC_QUEUE_KEY,
  type MagnificQueue,
} from '@/lib/magnific-queue-runner';
import {
  readJobCommands,
  clearJobCommand,
  pruneStaleJobCommands,
  type JobCommand,
} from '@/lib/job-commands';

/** Dispara o download de um blob pro disco do user AGORA (Object URL — nunca
 *  base64, ver [[project_downloadblob_objecturl]]). Usado como RESGATE quando a
 *  persistência durável (IndexedDB) da entrega falha: os bytes vão pro disco na
 *  hora em vez de sumirem no próximo reload. */
function rescueDownloadToDisk(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'entrega.zip';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoga depois — o browser precisa da URL viva durante o download.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 60_000);
  } catch (e) {
    console.error('[pilot] rescueDownloadToDisk falhou:', e);
  }
}

/** Persiste uma ENTREGA final (montado/camo/va zip) no IndexedDB com GARANTIA:
 *  se o IDB falhar (travado por outra aba, quota, etc), NÃO perde o arquivo —
 *  baixa pro disco na hora. Retorna { persisted, rescued } pra que o caller
 *  possa avisar o user honestamente (nunca marca "PRONTO" mudo). Ver
 *  [[feedback_blindagem_fluxos]]: sempre terminar+entregar, nenhum botão morto. */
async function persistDeliverableOrRescue(
  key: string,
  blob: Blob,
  filename: string,
): Promise<{ persisted: boolean; rescued: boolean }> {
  try {
    const { saveZip } = await import('@/lib/zip-store');
    await saveZip(key, blob, filename);
    return { persisted: true, rescued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // O guard "zip suspeito de vazio" (<1KB) é uma RECUSA intencional do
    // zip-store (montagem falhou, só _ERRO.txt/_DIAGNOSTICO.txt) — NÃO é falha
    // de IDB. Não resgata lixo pro disco; preserva o artefato bom anterior.
    if (/suspeito de vazio/i.test(msg)) return { persisted: false, rescued: false };
    console.warn(`[pilot] persist '${key}' falhou no IDB — resgatando via download:`, e);
    rescueDownloadToDisk(blob, filename);
    return { persisted: false, rescued: true };
  }
}

/** ANTI-MEMÓRIA DE MODERAÇÃO (fix 2026-07-12): EXCLUI do HeyGen os vídeos com
 *  falha REAL (ex: texto negado pela moderação) ANTES de re-disparar as mesmas
 *  partes. Com o registro negado vivo no histórico, o HeyGen "lembra" e nega o
 *  MESMO texto de novo — por isso o Retomar nunca passava; excluindo e
 *  disparando de novo (como o user faz na mão), o mesmo texto PASSA. Falha
 *  SINTÉTICA do nosso poll (zombie/timeout) NÃO exclui: o vídeo ainda pode
 *  completar no servidor e ser resgatado por título. Best-effort com teto de
 *  tempo — se a exclusão falhar, o re-disparo segue exatamente como antes. */
async function purgeRejectedVideosBeforeRedispatch(
  entries: Array<{ videoId?: string | null; error?: string | null }>,
  ctx: string,
): Promise<void> {
  const real = entries.filter((e) => e.videoId && !isSyntheticPollError(e.error));
  if (real.length === 0) return;
  console.log(`[${ctx}] excluindo ${real.length} vídeo(s) negado(s) no HeyGen antes do re-disparo (anti-memória de moderação):`, real.map((e) => e.videoId));
  try {
    await Promise.race([
      Promise.allSettled(real.map((e) => deleteVideo(e.videoId!))),
      new Promise((r) => setTimeout(r, 25_000)),
    ]);
  } catch { /* best-effort — nunca bloqueia o re-disparo */ }
}

/** Veredito do porteiro traduzido pra índices de parte do plano. */
type RedispatchPlan = {
  /** Liberados: nunca dispararam OU o HeyGen recusou de verdade. */
  redispatch: number[];
  /** PROIBIDOS: o HeyGen ainda está renderizando esses. */
  waiting: Array<{ idx: number; videoId: string }>;
  /** Já ficaram prontos — só baixar, cota zero. */
  rescue: Array<{ idx: number; videoId: string; videoUrl: string }>;
  /** Falhas REAIS a excluir antes de re-submeter (anti-memória de moderação). */
  rejected: Array<{ videoId?: string | null; error?: string | null }>;
};

/**
 * PORTEIRO DO RE-DISPARO (fix 2026-08-14) — o remédio pro caso que o user
 * pegou no AD70GL: o HeyGen degradou pra ~2h por parte, o nosso poll cansou,
 * marcou 'falha' e a auto-cura re-disparou take que estava VIVO renderizando.
 * Cada parte lenta comeu dois pedaços da cota diária e o disparo ainda saiu
 * incompleto.
 *
 * Regra: nenhum re-disparo sem status FRESCO na hora. Quem está pendente vira
 * espera (não falha), quem já ficou pronto é resgatado de graça, e só quem o
 * HeyGen realmente recusou — ou nunca chegou a disparar — vai pro submit.
 */
async function planRedispatch(
  idxs: number[],
  describe: (i: number) => { videoId?: string | null; title: string; error?: string | null },
  ctx: string,
): Promise<RedispatchPlan> {
  const plan: RedispatchPlan = { redispatch: [], waiting: [], rescue: [], rejected: [] };
  if (idxs.length === 0) return plan;
  const verdicts = await classifyForRedispatch(idxs.map((i) => describe(i)));
  idxs.forEach((idx, k) => {
    const v = verdicts[k];
    if (!v) { plan.redispatch.push(idx); return; }
    if (v.action === 'rescue') {
      plan.rescue.push({ idx, videoId: v.videoId, videoUrl: v.videoUrl });
    } else if (v.action === 'wait') {
      plan.waiting.push({ idx, videoId: v.videoId });
    } else {
      plan.redispatch.push(idx);
      if (v.rejectedVideoId) plan.rejected.push({ videoId: v.rejectedVideoId, error: describe(idx).error });
    }
  });
  console.log(
    `[${ctx}] porteiro do re-disparo: ${plan.redispatch.length} liberada(s), ` +
    `${plan.waiting.length} ainda renderizando (NÃO re-disparo), ${plan.rescue.length} resgatada(s) pronta(s)`,
  );
  return plan;
}

/**
 * ClickUp Pilot — cerebro de automacao
 *
 * Fluxo:
 * 1. User configura token ClickUp (uma vez)
 * 2. Pick editor + status (default: 'EDITAR VIDEO', 'EDITANDO VIDEO', 'REVISAO VIDEO')
 * 3. Load tasks → cards listados
 * 4. Click task → fetch detail + extrair link de doc
 * 5. User cola conteudo do doc (textarea) — parser identifica avatares + partes
 * 6. Match avatares com HeyGen library
 * 7. Dispara via HeyGen Auto Dynamic com motor III
 */

// IMPORTANTE: ClickUp API e case-sensitive nos status. Os status reais vem
// lowercase com acento ('editando vídeo'). Lowercase aqui = match direto.
// Default mostra so tasks pra editar/editando — revisao = video pronto,
// implementar = pre-edit, ambos nao precisam do Pilot. User pode customizar
// em /configuracoes se time usa nomes diferentes.
const DEFAULT_EDIT_STATUSES = [
  'editar video',
  'editar vídeo',
  'editando video',
  'editando vídeo',
];
const STATUS_FILTER_KEY = 'darkolab:clickup-pilot:statuses';

// Status de REVISÃO — entram na listagem SÓ quando o toggle 3D (olho) tá ON.
// Todas as variantes acento/sem-acento porque o match da API é exato;
// variante que não existe no workspace simplesmente não casa com nada.
const REVIEW_STATUSES = [
  'revisao video',
  'revisao vídeo',
  'revisão video',
  'revisão vídeo',
];
const INCLUDE_REVIEW_KEY = 'darkolab:clickup-pilot:includeReview';
const DISPATCHED_KEY = 'darkolab:clickup-pilot:dispatched';

/** Carrega map de tasks ja disparadas: {taskId: timestamp} */
function getDispatchedMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DISPATCHED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function getDispatchedAt(taskId: string): number | null {
  return getDispatchedMap()[taskId] ?? null;
}
function markDispatched(taskId: string) {
  if (typeof window === 'undefined') return;
  const m = getDispatchedMap();
  m[taskId] = Date.now();
  localStorage.setItem(DISPATCHED_KEY, JSON.stringify(m));
}

/** Limite global de lipsyncs HeyGen rodando em paralelo. Trava dura
 *  contra clique multiplo (Retomar/Debug em varias tasks ao mesmo tempo)
 *  E contra reload-storm (3+ batches restaurados como queued). Quem
 *  passar do limite vira phase='queued' e o promoter inicia quando
 *  liberar vaga. NAO mexer pra cima sem revisar throttling HeyGen. */
const MAX_HEYGEN_PARALLEL = 2;

/** SERIALIZA o pós-processo de vídeo (decupagem/regulagem/montagem). O
 *  ffmpeg-wasm é um SINGLETON compartilhado no navegador (lib/ffmpeg-worker.ts
 *  getFFmpeg) — com 2 tasks rodando em paralelo (MAX_HEYGEN_PARALLEL), os 2
 *  pós-processos usariam o MESMO ffmpeg ao mesmo tempo e se ATROPELAM (escrevem
 *  no mesmo FS virtual, um chama freeFFmpeg enquanto o outro processa) → 1 task
 *  conclui e as outras falham na decupagem/regulagem ("1 PRONTO, resto
 *  INCOMPLETO"). Esta fila garante 1 montagem por vez. O HeyGen continua
 *  paralelo (gated por MAX_HEYGEN_PARALLEL) — só a parte ffmpeg serializa. */
/** Serializa o pós-processo de vídeo na MESMA fila global de ffmpeg do app
 *  (lib/ffmpeg-serial) — agora compartilhada com o concat do VA. O ffmpeg-wasm é
 *  SINGLETON; rodar 2 ops ao mesmo tempo fazia uma matar a instância da outra
 *  ("called FFmpeg.terminate()" → AD com 1/2 avatares). `runFfmpegSerial` é o
 *  alias local pra `runFfmpegExclusive`: 1 operação ffmpeg por vez, app inteiro. */
// Task dona ATUAL do ffmpeg-wasm singleton — setada DENTRO do lock serial (quando a
// op de fato EXECUTA), nunca ao só enfileirar. O Pausar (pausarTaskBatch) usa isto
// pra só matar o exec (cancelFFmpeg é GLOBAL) quando a task pausada é a que ESTÁ
// montando — nunca a que apenas espera na fila (senão pausar a que espera matava o
// exec da que trabalha). Módulo-level porque o singleton ffmpeg é global ao app.
// Fallback do gate: se estiver null (caminho sem dono conhecido), o Pausar CAI no
// comportamento atual (cancelFFmpeg) pra não regredir. Ver rank 5 da auditoria.
let _ffmpegOwnerTaskId: string | null = null;

function runPostPipelineSerial(
  args: Parameters<typeof runPostPipeline>[0],
  ownerTaskId?: string,
): ReturnType<typeof runPostPipeline> {
  return runFfmpegSerial(async () => {
    if (ownerTaskId) _ffmpegOwnerTaskId = ownerTaskId;
    try {
      return await runPostPipeline(args);
    } finally {
      if (ownerTaskId && _ffmpegOwnerTaskId === ownerTaskId) _ffmpegOwnerTaskId = null;
    }
  });
}

/** Hooks de cache de clips intermediários (leveled/decupado) por parte, em
 *  IndexedDB. Acelera RETOMAR/Atualizar montagem: o pipeline reusa o que já foi
 *  nivelado/decupado em vez de refazer tudo no ffmpeg-wasm (era o que fazia o
 *  RETOMAR levar ~100min). Chave: pilot:<taskId>:<kind>:<label>.
 *
 *  FIDELIDADE DA INTENSIDADE: o clip 'decupado' depende do keepSilence usado no
 *  corte. O 'leveled' NÃO (nivelamento é igual pra qualquer intensidade). Por
 *  isso a chave do 'decupado' carrega a intensidade (`@k<sec>`): mudar a
 *  intensidade = chave diferente = recorta de verdade no novo valor (não reusa
 *  o corte antigo); voltar pra intensidade anterior reusa o que já existe. */
function makeClipCacheHooks(taskId: string, keepSilenceSec: number = 0.12, genId?: string | null) {
  const kTag = (Math.round(keepSilenceSec * 100) / 100).toFixed(2);
  const pfx = pilotGenPrefix(taskId, genId);
  // Intensidade vai no FIM da chave do 'decupado' (`...:<label>@k<sec>`) pra que
  // a invalidação por parte (deletePrefix `...:decupado:<label>@k`) atinja todas
  // as intensidades daquela parte sem tocar nas outras partes.
  const keyFor = (kind: 'leveled' | 'decupado', label: string) =>
    kind === 'decupado'
      ? `${pfx}decupado:${label}@k${kTag}`
      : `${pfx}${kind}:${label}`;
  return {
    loadCachedClip: async (kind: 'leveled' | 'decupado', label: string): Promise<Blob | null> => {
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        return await loadBlob(keyFor(kind, label), 'video/mp4');
      } catch { return null; }
    },
    saveCachedClip: async (kind: 'leveled' | 'decupado', label: string, blob: Blob): Promise<void> => {
      try {
        const { saveBlob } = await import('@/lib/zip-store');
        await saveBlob(keyFor(kind, label), blob, 'video/mp4');
      } catch {}
    },
  };
}

/** Phases consideradas "ocupando slot" — soma destas vs MAX define se
 *  ha vaga pra disparar mais uma. 'queued'/'done'/'failed' NAO ocupam. */
const ACTIVE_BATCH_PHASES: ReadonlyArray<BatchTaskState['phase']> = [
  'dispatching', 'rendering', 'downloading', 'post',
];

/** Persist batchStates entre reloads. zipBlobUrl nao sobrevive
 *  (Blob fica na memoria, e revogado no fechamento) — entao salva
 *  tudo menos isso. Permite retomar polling/download apos reload. */
const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';
function persistBatchStates(states: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(states)) {
      const { zipBlobUrl, montadoZipUrl, camufladoZipUrl, ...rest } = v as {
        zipBlobUrl?: string;
        montadoZipUrl?: string;
        camufladoZipUrl?: string;
        [key: string]: unknown;
      };
      sanitized[k] = rest;
    }
    // PRESERVA as entradas do Hey Auto ('heygenauto:*'): elas vivem na MESMA
    // chave mas são geridas/exibidas SÓ pelo Hey Auto. Sem isso, o persist do
    // Pilot apagaria a fila do Hey Auto (cada tool tem a sua lista própria).
    try {
      const existing = JSON.parse(localStorage.getItem(BATCH_STATE_KEY) || '{}') as Record<string, unknown>;
      for (const [k, v] of Object.entries(existing)) {
        if (k.startsWith('heygenauto:') && !(k in sanitized)) sanitized[k] = v;
      }
    } catch {}
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(sanitized));
  } catch {}
}
function loadPersistedBatchStates(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Le o `replan` persistido de uma task direto do localStorage —
 *  fonte autoritativa pra re-disparar mesmo apos reload/navegacao
 *  (quando taskAnalyses esta vazio e o estado React ainda nao
 *  reidratou). */
function loadPersistedReplan(taskId: string): {
  taskName: string;
  baseAdId: string;
  parts: Array<{ label: string; text: string; avatarId: string | null; voiceId: string | null; motionPrompt?: string | null; imageKey?: string | null; engine?: 'III' | 'IV' | 'V' }>;
} | null {
  try {
    const all = loadPersistedBatchStates() as Record<string, { replan?: any }>;
    return all?.[taskId]?.replan ?? null;
  } catch {
    return null;
  }
}

/** ============= VA RESUME SNAPSHOT (sobrevive restart do PC) =============
 *  O pipeline VA re-roda do ZERO no resume (não tem resume parcial de videoIds)
 *  e depende de MUITO estado em memória que NÃO sobrevive reload: vaBriefing
 *  (taskAnalyses), escolhas de avatar/voz (vaAvatarChoice/vaVoiceChoice), adUrl,
 *  transcript/roleText (multi-papel) e o roteamento text-engine. Sem isso, ao
 *  reabrir o navegador o runVAPipelineForTask morria em "briefing nao sobrevive
 *  reload" → FALHOU sem retomar (user reportou 2026-06-23: reiniciou o PC).
 *
 *  Solução: no DISPARO, gravamos um SNAPSHOT com TUDO que o runner precisa
 *  (capturado no ponto-em-que-disparou = correto), por task, no localStorage.
 *  No mount, reidratamos esse estado ANTES do promoter retomar — o runner fica
 *  INTOCADO, só passa a achar seus inputs. 1 chave por task (fácil de podar). */
const VA_RESUME_PREFIX = 'darkolab:clickup-pilot:va-resume:';
type VAResumeSnapshot = {
  vaBriefing: any;
  taskName: string;
  baseAdId: string;
  docUrl?: string | null;
  taskUrl?: string | null;
  adUrl?: string | null;            // vaAdUrl[taskId] (fallback de driveId)
  usesTextEngine?: boolean;          // congela o roteamento (tasks[] some no restart)
  avatarChoices?: Record<string, unknown>;  // chaves vaRoleKey desta task
  voiceChoices?: Record<string, unknown>;
  motionPrompts?: Record<string, unknown>;  // APPLY CUSTOM MOTION (liga Avatar IV)
  transcript?: unknown;              // vaTranscript[fileId] (multi-papel)
  roleTexts?: Record<string, string>;       // vaRoleText[`${fileId}:${ri}`]
  fileId?: string | null;            // linkAdFileId (chave do transcript/roleText)
};
function persistVAResumeSnapshot(taskId: string, snap: VAResumeSnapshot) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(VA_RESUME_PREFIX + taskId, JSON.stringify(snap)); } catch { /* quota: resume sem snapshot, igual antes */ }
}
function loadVAResumeSnapshot(taskId: string): VAResumeSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VA_RESUME_PREFIX + taskId);
    return raw ? (JSON.parse(raw) as VAResumeSnapshot) : null;
  } catch { return null; }
}
function clearVAResumeSnapshot(taskId: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(VA_RESUME_PREFIX + taskId); } catch { /* ignora */ }
}

/** Hash curto/estável (djb2) de uma string → chave de cache. Usado pra cachear
 *  partes renderizadas da VA-texto por conteúdo: se texto/avatar/voz não mudaram,
 *  o RETOMAR reusa a parte do IDB em vez de re-gerar no HeyGen. */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** ============= CANAL (plataforma/distribuicao) =============
 *  Le o custom field "CANAL" da task do ClickUp (dropdown) e resolve
 *  label + cor. Cor primaria = a propria cor da opcao no ClickUp (match
 *  EXATO com o board). Fallback = cor de marca por nome conhecido (KWAI
 *  laranja, META azul, YOUTUBE/TIKTOK vermelho, etc).
 *  100% READ-ONLY: so leitura do que ja vem na listagem, nao escreve nada
 *  no ClickUp (respeita o GET-only do proxy). */
const CHANNEL_BRAND_COLORS: Record<string, string> = {
  kwai: '#FF6E00',
  meta: '#0866FF',
  facebook: '#0866FF',
  fb: '#0866FF',
  instagram: '#E1306C',
  insta: '#E1306C',
  ig: '#E1306C',
  youtube: '#FF0000',
  yt: '#FF0000',
  tiktok: '#FF2D55',
  tt: '#FF2D55',
  google: '#4285F4',
  ads: '#4285F4',
  taboola: '#0A66C2',
};

/** Cor de texto legivel sobre um fundo solido (preto em cores claras,
 *  branco em cores escuras/saturadas). */
function channelTextColor(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1a1a1a' : '#ffffff';
}

/** Resolve o(s) canal(is) de uma task. Retorna [] se nao houver campo CANAL
 *  preenchido. Suporta drop_down (value = orderindex/id) e labels (multi). */
function resolveChannels(task: ClickUpTask): Array<{ label: string; color: string }> {
  const fields = task.custom_fields || [];
  const f = fields.find((x) => /\b(canal|channel|plataforma|platform)\b/i.test(x.name || '')) as any;
  if (!f) return [];
  const val = f.value;
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return [];
  const options: any[] = (f.type_config && (f.type_config.options || f.type_config.labels)) || [];

  const labelFor = (raw: any): { label: string; color: string } | null => {
    let name: string | null = null;
    let optColor: string | null = null;
    // raw pode ser orderindex (num), id (string), ou ja o nome
    if (options.length) {
      const opt = options.find(
        (o) =>
          String(o.orderindex) === String(raw) ||
          String(o.id) === String(raw) ||
          o.name === raw ||
          o.label === raw,
      );
      if (opt) {
        name = opt.name || opt.label || null;
        optColor = opt.color || null;
      }
    }
    if (!name) {
      if (typeof raw === 'string') name = raw;
      else if (raw && typeof raw === 'object') name = raw.name || raw.label || null;
    }
    if (!name) return null;
    const key = name.trim().toLowerCase();
    const color = optColor || CHANNEL_BRAND_COLORS[key] || '#8a8a8a';
    return { label: name.trim().toUpperCase(), color };
  };

  const raws = Array.isArray(val) ? val : [val];
  return raws.map(labelFor).filter((x): x is { label: string; color: string } => !!x);
}

/** Canais ORGANICOS (KWAI/YouTube/TikTok). VA com esses canais NAO usa o
 *  pipeline de lipsync no AD original — gera cada parte (hook+body) por
 *  TEXTO via HeyGen text-to-avatar (igual task normal), 1 video por AVA.
 *  META (e VA sem canal) continuam no lipsync. Retorna os labels organicos
 *  achados na task (vazio = nenhum → mantem o motor lipsync de sempre). */
const ORGANIC_CHANNEL_RE = /\b(kwai|you\s?tube|tik\s?tok)\b/i;
function organicChannelLabels(task: ClickUpTask | undefined | null): string[] {
  if (!task) return [];
  return resolveChannels(task)
    .map((c) => c.label)
    .filter((l) => ORGANIC_CHANNEL_RE.test(l));
}

type DispatchPlan = {
  adName: string;
  parts: Array<{
    label: string;
    text: string;
    avatarId: string | null;
    avatarName: string | null;
    avatarThumb?: string | null;
    matchedBy?: string;
    /** Apply Custom Motion herdado do slot dono da parte. */
    motionPrompt?: string | null;
    /** Modo imagem: data URL da imagem que o HeyGen vai animar (sem avatar). */
    imageDataUrl?: string | null;
    /** Chave IDB da mesma imagem — é o que sobrevive ao F5. */
    imageKey?: string | null;
    /** Motor escolhido na mão pra esta cena (ausente = automático). */
    engine?: 'III' | 'IV' | 'V';
  }>;
  unmatchedAvatars: string[];
};

type BatchTaskState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  /** EMPRESA dona do disparo (workspace do ClickUp). Existe pra fila de uma
   *  empresa não aparecer enquanto você trabalha na outra. Ausente = batch
   *  antigo (criado antes da troca de workspace existir): o backfill resolve
   *  pelo `team_id` da própria task, e até lá ele continua visível — sumir
   *  disparo em andamento seria pior que mostrar demais. */
  teamId?: string;
  /** ISOLAÇÃO POR GERAÇÃO (fix 2026-07-08): id único do disparo/re-disparo DO
   *  ZERO que produziu os videoIds atuais. Namespaceia os artefatos por-parte
   *  no IDB (`pilot:<taskId>:g:<genId>:...`) pra que um RETOMAR NUNCA hidrate um
   *  take de uma geração anterior (avatar antigo) → nunca embaralha avatares.
   *  Sobrevive F5 (campo simples, não é stripado no persist). Ausente em batches
   *  legados → cai na chave antiga (sem regressão). */
  genId?: string;
  /** 'troca' = pipeline de TROCA DE ÁUDIO (sem HeyGen). Ausente = fluxo normal. */
  kind?: 'troca';
  /** TROCA: dados serializaveis pra RETOMAR sobreviver reload. O novo WHITE
   *  fica no IndexedDB (chave `troca:white:<taskId>`); aqui guardamos o que
   *  e serializavel pra reconstruir tudo sem a analise em memoria. */
  trocaDriveId?: string;
  trocaFolderId?: string;
  /** URL da pasta de OUTPUT no Drive (LINK PASTA DRIVE) — botao "abrir pasta"
   *  no card da troca, no lugar do botao de Docs (troca nao tem doc). */
  trocaOutputFolderUrl?: string;
  trocaVolume?: number;
  trocaWhiteMime?: string;
  /** TROCA: confianca da verificacao (correlacao na soma mono de plataforma).
   *  whiteScore alto + blackScore baixo = a IA escuta o novo WHITE. */
  trocaWhiteScore?: number;
  trocaBlackScore?: number;
  /** queued | dispatching | rendering | downloading | post (concat+decupagem+camo) | done | failed
   *  waiting-heygen = takes ainda RENDERIZANDO no HeyGen (plataforma lenta). NÃO
   *  é falha e NÃO re-dispara — o watcher retoma sozinho quando ficarem prontos. */
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed' | 'waiting-heygen';
  /** Per-part status durante dispatch (parteN: error|null) */
  parts: Array<{ label: string; videoId: string | null; videoStatus?: VideoStatus['status']; videoUrl?: string | null; error?: string | null; renamedTo: string }>;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  /** ZIP 1 — takes individuais (sempre gerado) */
  zipBlobUrl?: string;
  zipFilename?: string;
  /** ZIP 2 — versoes montadas HOOK[N]+BODY decupadas (gerado se decupagem OK) */
  montadoZipUrl?: string;
  montadoZipName?: string;
  /** ZIP 3 — versoes montadas + camuflagem (gerado se modo camuflagem ON) */
  camufladoZipUrl?: string;
  camufladoZipName?: string;
  /** Stats numericas do pipeline pos-prod — usado pra detectar "parcial".
   *  Quando phase='done' mas algum count !== expected, UI esconde TODOS os
   *  botoes de download (takes/montados/camuflados) e exibe "⚠ parcial",
   *  forçando user a Retomar pra completar. Sem este flag, a antiga logica
   *  marcava 'pronto' mesmo com 12 de 16 partes (falso positivo). */
  pipeStats?: {
    expectedMontagens: number;
    okMontagens: number;
    /** Montagens que sairam INCOMPLETAS (faltou parte esperada = "faltando
     *  texto"). > 0 → nunca 100% pronto, download fica travado. */
    incompleteMontagens?: number;
    okDecupados: number;
    okCamuflados: number;
    expectedDecupagem: boolean;
    expectedCamuflagem: boolean;
  };
  /** ENTREGA de verdade (fix 2026-07-03): true só quando a montagem final saiu
   *  (okMontagens === esperado, >0). Sobrevive ao persist (é campo simples).
   *  Um 'done' com deliveryOk:false = "takes prontos mas vídeo não montou" →
   *  a auto-cura re-tenta e o card não mente "Pronto". Ausente em batches
   *  antigos (undefined) → tratado como legado, não força aviso. */
  deliveryOk?: boolean;
  /** ESPERANDO O HEYGEN (fix 2026-08-14): videoIds que continuam RENDERIZANDO
   *  lá quando o run terminou. Não são falha — o watcher re-checa em silêncio e
   *  chama o RETOMAR sozinho quando ficam prontos, sem gastar cota nenhuma. */
  waitingVideoIds?: string[];
  /** Instante da última re-checagem do watcher (evita martelar a API). */
  waitingCheckedAt?: number;
  /** VA: quantos avatares saíram montados vs esperados. BLINDAGEM: o card só
   *  mostra "PRONTO" verde quando okAvas === expectedAvas. Se faltou avatar
   *  (ex: 1/2 — mount morreu, cota, etc.), o card vira AVISO (não verde) com a
   *  contagem, em vez de mentir "pronto" e o user descobrir só ao baixar 1. O
   *  download do que existe segue liberado; failedAvas guia o RETOMAR. */
  vaStats?: {
    okAvas: number;
    expectedAvas: number;
    failedAvas?: string[];
  };
  /** Plano serializavel pra RE-DISPARAR sem depender de taskAnalyses
   *  (que NAO sobrevive reload/navegacao). Sem isto, Retomar/Debug de
   *  uma task que falhou com 0 videoIds (ex: cota HeyGen) nao fazia
   *  nada. Persistido junto do batch. */
  replan?: {
    taskName: string;
    baseAdId: string;
    parts: Array<{ label: string; text: string; avatarId: string | null; voiceId: string | null; motionPrompt?: string | null; imageKey?: string | null; engine?: 'III' | 'IV' | 'V' }>;
  };
  /** Parts re-geradas via EditPartModal — labels que ficaram "dirty" depois
   *  do montadoZipUrl ter sido gerado. Quando array > 0, UI mostra botao
   *  "Atualizar montagem" que re-roda runPostPipeline. Persiste no
   *  localStorage pra sobreviver reload. */
  dirtyParts?: string[];
  /** Doc URL (Google Docs) da task — pra botao "abrir doc" no card. */
  docUrl?: string;
  /** ClickUp task URL — fallback se docUrl nao foi capturado. */
  taskUrl?: string;
  /** VARIACAO DE AVATAR: marca que essa task roda o pipeline VA (Demucs +
   *  split + lipsync por avatar) em vez do HeyGen Auto normal. Sobrevive
   *  reload (persistido) — usado pra rotear o disparo/resume pro runner VA
   *  e pra mostrar o botao extra "baixar AD original" no card. */
  isVA?: boolean;
  /** VA: URL de download do AD original (Drive). Mostra botao extra no card. */
  adOriginalUrl?: string;
  /** CANAL(is) de distribuicao (KWAI/META/YT/TIKTOK...) snapshot do custom
   *  field da task no momento do disparo. Persistido pra sobreviver reload
   *  (o board pode nao ter recarregado ainda). Render usa este snapshot e,
   *  na ausencia, cai no resolveChannels(task) ao vivo. */
  channels?: Array<{ label: string; color: string }>;
};

type RoleSlot = {
  /** "Doutor", "Mulher", etc — role do briefing */
  role: string;
  /** "@binhoted1" — username bruto do briefing */
  username: string;
  /** Drive file ID do video referenciado no briefing (preview do avatar
   *  que o copy quer). Permite mostrar thumb pra user identificar quem e. */
  briefingFileId: string | null;
  /** URL do YouTube quando o avatar foi referenciado por smart-chip/link de
   *  YouTube (criativo "sem edição" + clone de voz) em vez de @file.mp4. */
  youtubeUrl?: string | null;
  /** Thumb do YouTube (img.youtube.com) — mostra o video de referência mesmo
   *  sem arquivo no Drive. */
  youtubeThumb?: string | null;
  /** Avatar declarado por IMAGEM EMBUTIDA (print colado no doc). Vale a data
   *  URL/src do print — mostrada como thumb de referência. Igual ao YouTube:
   *  fica PENDENTE (nao casa com a biblioteca; user escolhe vendo o print). */
  imageThumb?: string | null;
  /** Avatar HeyGen escolhido (null = pendente, user precisa selecionar) */
  avatarId: string | null;
  avatarName: string | null;
  avatarThumb: string | null;
  avatarVoiceId: string | null;
  /** Se != null, sobrescreve avatarVoiceId — voz custom escolhida pelo user */
  voiceOverride: { id: string; name: string } | null;
  /** Como matchamos: 'voice_name_exact' | 'voice_name_fuzzy' | 'name_contains' | 'name_tokens' | 'manual' | 'visual' | null */
  matchedBy: string | null;
  /** Slot criado NA MÃO pelo usuário (o doc não trazia "Avatar: @fulano").
   *  Caso típico do DR MILLION: a copy vem sem avatar porque o avatar é o do
   *  anúncio que está sendo modelado. Só slots manuais ligam a UI de repartir
   *  a copy entre avatares — no B2C, onde o parser acha os roles, a tela
   *  continua exatamente como era. */
  manual?: boolean;
  /** APPLY CUSTOM MOTION — prompt de movimento desta cena. No DR MILLION cada
   *  cena do AD é um avatar (foto) próprio, então o movimento é por slot:
   *  AD37_2 mexe a gelatina, AD37_1 e AD37_3 só falam. Preenchido, a cena sobe
   *  pro Avatar IV (o III descarta motion); vazio, segue no III. */
  motionPrompt?: string | null;
  /** MODO IMAGEM — em vez de escolher avatar da biblioteca, sobe a imagem
   *  (frame inicial da cena) e o HeyGen anima ela pela variante `image` do
   *  /v3/videos, que não precisa de `avatar_id`. Serve pro avatar que não
   *  existe na biblioteca — inclusive rosto que a moderação reprovou, caso em
   *  que o caminho normal morre no 0x0 / "missing image dimensions".
   *  Cada slot tem a SUA imagem, então dá pra ter vários avatares por AD e
   *  juntar depois normalmente. */
  /** MOTOR DESTA CENA, escolhido na mão. Ausente = automático (III, ou IV se
   *  tiver movimento). Existe porque nem toda decisão de motor vem do gesto:
   *  às vezes você quer o V numa cena de rosto, ou o IV numa parada. A escolha
   *  não fura a regra do movimento — cena com gesto marcada como III sobe pro
   *  IV no runner de qualquer jeito, senão o take voltaria parado. */
  engine?: 'III' | 'IV' | 'V';
  imageMode?: boolean;
  /** Data URL da imagem — vive em memória (taskAnalyses) e vai pro runner.
   *  NÃO entra no replan: base64 de imagem no localStorage estoura a quota e
   *  derruba a persistência de TODAS as tasks. Os bytes vão pro IndexedDB. */
  imageDataUrl?: string | null;
  /** Chave dos bytes no IndexedDB (`pilot:<taskId>:img:<slot>`). É isso que
   *  entra no replan — string curta — pra o RETOMAR pós-F5 reachar a imagem. */
  imageKey?: string | null;
  imageName?: string | null;
};

type TaskAnalysis = {
  taskId: string;
  taskName: string;
  status: 'pending' | 'analyzing' | 'ready' | 'partial' | 'error';
  baseAdId?: string;
  hookCount?: number;
  bodyPartsCount?: number;
  totalParts?: number;
  /** Copy no formato DR MILLION (bilíngue PT/PL, body do grupo). Liga o
   *  seletor de idioma na tela — no B2C fica sempre undefined. */
  drMillion?: boolean;
  /** Quais idiomas ESTE ad realmente tem no doc. */
  drLangs?: { pt: boolean; pl: boolean };
  /** Linhas da copy do idioma escolhido que NÃO entraram em nenhum take.
   *  Vazio = a copy saiu inteira. Ver conferirCoberturaDaCopy. */
  copyFaltando?: string[];
  /** Cada avatar do briefing — usuario controla individualmente */
  roleSlots: RoleSlot[];
  /** Body splits + hooks que viram partes (sem avatar — populado a partir de roleSlots) */
  partTemplates: Array<{ label: string; text: string; matchByRole: string | null; speaker?: string | null }>;
  /** Body cru do parser (antes do split) — fonte pro botao "copiar body" */
  bodyRaw?: string;
  error?: string;
  /** Quando disparou pra HeyGen (timestamp) — null se ainda nao */
  dispatchedAt?: number | null;
  /** Se essa task e sibling G1/G2 que compartilhou analise com primary,
   *  guarda ID do primary. UI mostra como "↔ compartilhada com AD144G1GL" */
  sharedWithPrimaryId?: string;
  /** Tasks Variacao de Avatar: pipeline diferente (lipsync por audio do
   *  AD original, N avatares de variacao). Quando presente, UI renderiza
   *  alternativa em vez do fluxo normal. */
  vaBriefing?: ParsedVABriefing;
  /** Tasks TROCA DE ÁUDIO: variacao do audio WHITE. Sem doc de copy — so o
   *  link do criativo original no Drive + um novo WHITE upado. Quando
   *  presente, UI renderiza o painel de troca de audio. */
  trocaBriefing?: {
    baseAdId: string;
    driveId: string | null;
    driveUrl: string | null;
    /** Pasta do Drive (quando a task so referencia a PASTA do criativo, sem
     *  o link do arquivo). No disparo, listamos a pasta e pegamos o video. */
    driveFolderId: string | null;
    driveFolderUrl: string | null;
  };
  /** Google Docs URL extraido do custom field "DOC DA COPY" ou da descricao
   *  da task. Persistido pra mostrar botao "abrir doc" sem ter que ir
   *  manualmente no ClickUp puxar o link. */
  docUrl?: string;
  /** Ancora de heading do Google Docs (#heading=h.xxxx) da seção EXATA do AD
   *  dessa task — extraída do export HTML pela extensão. Anexada ao docUrl no
   *  botão "abrir doc" pra abrir o Google Docs já na copy do AD (sem rolar). */
  docHeadingId?: string;
  /** ClickUp URL direto da task (atalho — vem do feed da listagem). */
  taskUrl?: string;
};

/**
 * Extrai SO o body falado — delega pro sanitizador AUTORITATIVO do parser
 * (lib/copy-parser:sanitizeSpokenCopy), MESMA logica usada no disparo.
 * Fonte unica de verdade: o que o botao "copiar body" mostra e exatamente
 * o que e enviado pro HeyGen.
 */
function extractSpokenBody(raw: string): string {
  return sanitizeSpokenCopy(raw);
}

/**
 * Tela de bloqueio mostrada pra contas free/basic que tentam acessar
 * o ClickUp Pilot via URL direta. Server-side já redireciona no
 * middleware; isso é o último escudo + UX educativa.
 */
function ClickUpPilotLocked({ tier }: { tier: 'free' | 'basic' | 'pro' | 'admin' }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-12 md:px-8">
      <ToolShell
        title="Disponível só no Pro"
        eyebrow="CLICKUP PILOT · BLOQUEADO"
        description="A automação do Pilot é um recurso premium. Faça upgrade pra liberar e começar a entregar 5× mais."
      >
        <div className="flex flex-col items-center gap-6 py-6 text-center">
          <span
            className="flex h-20 w-20 items-center justify-center rounded-full border border-violet/40 bg-violet/10"
            style={{ boxShadow: '0 0 32px -6px rgba(167,139,250,0.6)' }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
          </span>
          <div>
            <h3
              className="text-[24px] font-extrabold tracking-tight text-white md:text-[28px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Sua conta é <span className="text-violet">{tier.toUpperCase()}</span>.
            </h3>
            <p className="mt-2 max-w-[480px] text-[14.5px] leading-relaxed text-text-muted">
              O ClickUp Pilot dispara automação em massa no HeyGen — disponível
              só no plano <span className="font-bold text-white">Pro</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/planos?upgrade=1"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13.5px] font-bold text-black"
              style={{
                background: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 14px 36px -8px rgba(200,232,124,0.55)',
              }}
            >
              Ver planos
              <span>→</span>
            </Link>
            <Link
              href="/pilot"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-6 py-3 text-[13.5px] font-bold text-white transition hover:-translate-y-[1px] hover:border-white/40"
            >
              Conhecer o Pilot
            </Link>
          </div>
        </div>
      </ToolShell>
    </div>
  );
}

export default function ClickUpPilotPage() {
  return (
    <TierGate require="admin" toolName="ClickUp Pilot" toolPath="/tools/clickup-pilot">
      <ClickUpPilotInner />
    </TierGate>
  );
}

function ClickUpPilotInner() {
  const router = useRouter();
  const tier = useTier();

  // ─── BLOQUEIO: só Pro/Admin podem usar ───
  // Free e Basic veem tela de upgrade. Middleware também bloqueia o
  // acesso direto via URL — esse é o último escudo client-side.
  if (tier && !tierCanAutomate(tier)) {
    return <ClickUpPilotLocked tier={tier} />;
  }

  /* ========== Token ========== */
  const [tokenInput, setTokenInput] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [showTokenSetup, setShowTokenSetup] = useState(false);

  /* ========== Anthropic key (pra IA Search visual) ==========
   *  Pre-flight: verifica se user configurou a chave. Se nao, IA Search
   *  fica desativado com link direto pra /configuracoes/api. */
  const [hasAnthropic, setHasAnthropic] = useState<boolean | null>(null);

  /* ========== Modos (toggles 3D antes de analisar) ========== */
  /** IA Search ON: roda visual match automatico em todo slot pendente apos analyze */
  const [iaSearchMode, setIaSearchMode] = useToolState<boolean>('clickup-pilot:iaSearchMode', false);
  /** Camuflagem ON: gera 3a pasta zip com versoes montadas+camufladas no audio */
  const [camuflagemMode, setCamuflagemMode] = useToolState<boolean>('clickup-pilot:camuflagemMode', false);
  // PER-TASK camuflagem — sobrescreve o global por task quando setado.
  // Se a task nao tem entry aqui, fallback pro global. Permite ligar
  // camuflagem so em algumas tasks + upload de white audio especifico.
  type TaskCamuflagem = { enabled: boolean; white: File | null; volume: number };
  const [taskCamuflagem, setTaskCamuflagem] = useState<Record<string, TaskCamuflagem>>({});
  function getTaskCamuflagem(taskId: string): { camuflagem: boolean; whiteAudio: File | null; camuflagemVolume: number } {
    const t = taskCamuflagem[taskId];
    if (t && t.enabled !== undefined) {
      return { camuflagem: t.enabled, whiteAudio: t.enabled ? (t.white || null) : null, camuflagemVolume: t.volume };
    }
    return { camuflagem: camuflagemMode, whiteAudio: camuflagemMode ? camuflagemWhite : null, camuflagemVolume };
  }
  function toggleTaskCamuflagem(taskId: string) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: false, white: null, volume: camuflagemVolume };
      return { ...prev, [taskId]: { ...cur, enabled: !cur.enabled } };
    });
  }
  function setTaskCamuflagemWhite(taskId: string, file: File | null) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: true, white: null, volume: camuflagemVolume };
      return { ...prev, [taskId]: { ...cur, white: file } };
    });
  }
  function setTaskCamuflagemVolume(taskId: string, vol: number) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: true, white: null, volume: vol };
      return { ...prev, [taskId]: { ...cur, volume: vol } };
    });
  }
  /** Audio WHITE pra camuflagem (file blob nao persiste — volta toda sessao) */
  const [camuflagemWhite, setCamuflagemWhite] = useState<File | null>(null);
  const [camuflagemVolume, setCamuflagemVolume] = useToolState<number>('clickup-pilot:camuflagemVolume', 30);
  /** Only Magnific: pula HeyGen, dispara so B-Rolls Magnific (Nano Banana + Kling 2.5).
   *  Tasks viram pacote ZIP de take1.mp4...takeN.mp4 sem avatar. */
  const [onlyMagnificMode, setOnlyMagnificMode] = useToolState<boolean>('clickup-pilot:onlyMagnific', false);
  /** More Magnific: alem do HeyGen normal, gera B-Rolls extras Magnific pra complementar.
   *  Adiciona pasta /broll/ no ZIP final com takes Kling 2.5. */
  const [moreMagnificMode, setMoreMagnificMode] = useToolState<boolean>('clickup-pilot:moreMagnific', false);


  /** JSON de B-rolls colado por task (caixa "+" inline). Persistido em
   *  localStorage (sobrevive reload), separado por taskId. */
  const [taskMagnificJson, setTaskMagnificJsonState] = useState<Record<string, string>>({});
  /** Quais tasks estao com a caixa "+" aberta (UI efemera, nao persiste). */
  const [magnificEditorOpen, setMagnificEditorOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTaskMagnificJsonState(loadMagnificJsonMap());
  }, []);
  const setTaskMagnificJson = (taskId: string, json: string) => {
    setTaskMagnificJsonState((prev) => {
      const next = { ...prev, [taskId]: json };
      saveMagnificJsonMap(next);
      return next;
    });
  };

  /** Fila SERIAL de jobs Magnific (espelha o padrao dos batches HeyGen).
   *  1 ativo por vez sempre. Persiste reload via localStorage. */
  const [magnificQueue, setMagnificQueueState] = useState<MagnificQueue>({});
  const magnificProcessingRef = useRef(false);
  // Ultimos driveLinks (Drive + YouTube) do doc buscado — usados pelo runParser
  // (fluxo manual single-task) pra identificar avatar por smart-chip de YouTube.
  const lastDocLinksRef = useRef<Array<{ text: string; fileId: string | null; url?: string | null }>>([]);
  const [magnificTick, setMagnificTick] = useState(0);
  const magnificCancelRef = useRef<Record<string, boolean>>({});
  /** AbortController do job Magnific rodando agora (pra Pausar/Debug
   *  interromperem o pipeline em vez de so esperar). */
  const magnificAbortRef = useRef<AbortController | null>(null);
  /** taskId do job Magnific ativo + quando comecou (watchdog anti-loop). */
  const magnificActiveRef = useRef<{ taskId: string; startedAt: number } | null>(null);
  /** Intencao de parada por job: distingue Pausar x Debug x Watchdog do
   *  fim normal — pro processor nao sobrescrever o status errado. */
  const magnificStopIntentRef = useRef<Record<string, 'paused' | 'debug' | 'watchdog' | null>>({});

  useEffect(() => {
    setMagnificQueueState(restoreMagnificQueue());
  }, []);
  useEffect(() => {
    saveMagnificQueue(magnificQueue);
  }, [magnificQueue]);

  /**
   * Cross-tab sync: quando OUTRA aba muda magnificQueue no localStorage
   * (enqueue novo job, recebe heartbeat, finish), repuxa pra cá. Sem isso
   * a UI da aba B mostraria fila stale e tomaria decisões erradas.
   *
   * Importante: NÃO chama setMagnificTick aqui — só re-hidrata o state.
   * O processor decide sozinho via tryAcquireMagnificJob cross-tab.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== MAGNIFIC_QUEUE_KEY) return;
      try {
        const next = ev.newValue ? (JSON.parse(ev.newValue) as MagnificQueue) : {};
        setMagnificQueueState(next);
      } catch {
        /* JSON ruim — ignora */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Patch atomico de 1 job na fila (sempre via setState pra persistir). */
  const patchMagnificJob = (taskId: string, patch: Partial<MagnificQueue[string]>) => {
    setMagnificQueueState((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      return { ...prev, [taskId]: { ...cur, ...patch } };
    });
  };

  useEffect(() => {
    const t = getClickUpToken();
    setHasToken(!!t);
    if (!t) setShowTokenSetup(true);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/user/secrets')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setHasAnthropic(!!j?.anthropic?.configured); })
      .catch(() => { if (alive) setHasAnthropic(false); });
    return () => { alive = false; };
  }, []);

  function saveToken() {
    if (!tokenInput.trim()) return;
    setClickUpToken(tokenInput.trim());
    setHasToken(true);
    setShowTokenSetup(false);
    setTokenInput('');
    setError(null);
  }
  function clearToken() {
    setClickUpToken(null);
    setHasToken(false);
    setShowTokenSetup(true);
    setTeams([]);
    setSelectedTeam(null);
    setSelectedEditor(null);
    setTasks([]);
    setSelectedTask(null);
  }

  /* ========== Teams + members ==========
   *  Workspace + Editor agora persistem em localStorage via clickup-pilot-config
   *  pra sincronizar com /configuracoes/clickup-pilot. */
  const [teams, setTeams] = useState<ClickUpTeam[]>([]);
  const [selectedTeam, setSelectedTeamState] = useState<string | null>(null);
  const [selectedEditor, setSelectedEditorState] = useState<string | null>(null);
  const setSelectedTeam = (v: string | null) => { setSelectedTeamState(v); setPilotTeam(v); };
  const setSelectedEditor = (v: string | null) => { setSelectedEditorState(v); setPilotEditor(v); };
  useEffect(() => {
    setSelectedTeamState(getPilotTeam());
    setSelectedEditorState(getPilotEditor());
  }, []);
  const [loadingTeams, setLoadingTeams] = useState(false);
  // User autenticado (auto-fetch via /v2/user). Critico pra workspaces com
  // permissao limitada que nao retornam membros — usamos esse ID como editor.
  const [authUser, setAuthUser] = useState<ClickUpUser | null>(null);

  async function loadTeams() {
    if (!hasToken) return;
    setLoadingTeams(true);
    setError(null);
    try {
      // Carrega user E teams em paralelo
      const [me, ts] = await Promise.all([
        getCurrentUser().catch(() => null),
        listTeams(),
      ]);
      if (me) setAuthUser(me);
      setTeams(ts);
      // Guarda id→nome pra outras telas (histórico) rotularem a empresa —
      // só o Pilot chama listTeams().
      setPilotTeamNames(Object.fromEntries(ts.map((t) => [t.id, t.name])));
      // Auto-pick: prefere team com nome que contem 'B2c' OU o que tem mais
      // membros visiveis OU o primeiro
      if (ts.length > 0 && (!selectedTeam || !ts.find(t => t.id === selectedTeam))) {
        const b2c = ts.find(t => /b2c/i.test(t.name || ''));
        const byMembers = [...ts].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0))[0];
        const picked = b2c || byMembers || ts[0];
        setSelectedTeam(picked.id);
      }
      // Auto-pick editor handled in separate useEffect (avoid race with state)
    } catch (e) {
      setError(toFriendlyMessage(e, 'Não consegui conectar no seu ClickUp agora. Confira o token e tenta de novo.'));
    } finally {
      setLoadingTeams(false);
    }
  }
  useEffect(() => { if (hasToken) loadTeams(); /* eslint-disable-next-line */ }, [hasToken]);

  // Quando authUser carrega + nao tem editor selecionado: auto-pick o user
  useEffect(() => {
    if (authUser && !selectedEditor) {
      setSelectedEditor(String(authUser.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // Migra filter velho UPPERCASE pra novo lowercase (API e case-sensitive)
  useEffect(() => {
    if (statusFilter && /[A-Z]/.test(statusFilter) && !/[a-z]/.test(statusFilter)) {
      // Filter atual e tudo uppercase — substitui pelo default lowercase
      setStatusFilter(DEFAULT_EDIT_STATUSES.join(','));
    }
    // eslint-disable-next-line
  }, []);

  const currentTeam = useMemo(() => teams.find((t) => t.id === selectedTeam) || null, [teams, selectedTeam]);
  const editors: ClickUpUser[] = useMemo(() => {
    const fromTeam = (currentTeam?.members || []).map((m) => m.user);
    // Garante que o auth user esta na lista mesmo se workspace nao retornar
    // membros (workspaces grandes podem nao expor membros pra tokens limitados)
    if (authUser && !fromTeam.find((u) => u.id === authUser.id)) {
      fromTeam.push(authUser);
    }
    return fromTeam.sort((a, b) => a.username.localeCompare(b.username));
  }, [currentTeam, authUser]);

  /* ========== Tasks ========== */
  // Status filter agora vive em localStorage (compartilhado com /configuracoes
  // onde o user edita). Default reset garante que filter velho uppercase
  // saia automaticamente.
  const [statusFilter, setStatusFilterRaw] = useState(DEFAULT_EDIT_STATUSES.join(','));

  // Filtros de data + prioridade (client-side, aplicados depois de listTasks)
  type DateFilter = 'all' | 'today' | 'tomorrow' | 'yesterday' | 'overdue' | 'next7' | 'specific';
  type PriorityFilter = 'all' | 'urgent' | 'high';
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  // Data específica (YYYY-MM-DD) — usada quando dateFilter === 'specific'
  const [specificDate, setSpecificDate] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(STATUS_FILTER_KEY);
    if (stored && /[a-z]/.test(stored)) {
      setStatusFilterRaw(stored);
    } else {
      // Sem nada salvo OU filter velho UPPERCASE — usa default e salva
      localStorage.setItem(STATUS_FILTER_KEY, DEFAULT_EDIT_STATUSES.join(','));
    }
  }, []);
  function setStatusFilter(v: string) {
    setStatusFilterRaw(v);
    if (typeof window !== 'undefined') localStorage.setItem(STATUS_FILTER_KEY, v);
  }

  // Toggle 3D "incluir tasks em REVISÃO" — soma REVIEW_STATUSES ao filtro na
  // hora de listar, SEM tocar no statusFilter salvo (o filtro custom do user
  // em /configuracoes continua intacto). Persiste em localStorage.
  const [includeReview, setIncludeReviewRaw] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setIncludeReviewRaw(localStorage.getItem(INCLUDE_REVIEW_KEY) === '1'); } catch {}
  }, []);
  function setIncludeReview(v: boolean) {
    setIncludeReviewRaw(v);
    try { localStorage.setItem(INCLUDE_REVIEW_KEY, v ? '1' : '0'); } catch {}
  }
  const [tasks, setTasks] = useState<ClickUpTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  /* ========== Modo BATCH (selecao multipla + analise previa) ========== */
  const [bulkMode, setBulkMode] = useToolState<boolean>('clickup:bulkMode', false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [taskAnalyses, setTaskAnalyses] = useState<Record<string, TaskAnalysis>>({});
  /** Espelho pra leitura SÍNCRONA dentro da análise (que roda fora do ciclo
   *  de render) — usado pra não perder o avatar escolhido na mão ao reanalisar. */
  const taskAnalysesRef = useRef<Record<string, TaskAnalysis>>({});
  taskAnalysesRef.current = taskAnalyses;

  // Motor config por task (III/IV/V — global, %, individual)
  const [motorConfigs, setMotorConfigs] = useState<Record<string, MotorConfig>>({});
  const getMotorConfig = (taskId: string): MotorConfig => motorConfigs[taskId] || defaultMotorConfig();
  const setMotorConfigForTask = (taskId: string, cfg: MotorConfig) => {
    setMotorConfigs((prev) => ({ ...prev, [taskId]: cfg }));
  };

  // Avatar First — toggle per slot (key = `${taskId}:${slotIdx}`)
  const [avatarFirstEnabled, setAvatarFirstEnabled] = useState<Record<string, boolean>>({});
  const isAvatarFirstEnabled = (taskId: string, sIdx: number) => !!avatarFirstEnabled[`${taskId}:${sIdx}`];
  const setAvatarFirstFor = (taskId: string, sIdx: number, enabled: boolean) => {
    setAvatarFirstEnabled((prev) => ({ ...prev, [`${taskId}:${sIdx}`]: enabled }));
  };

  // Decupagem — toggle por task. Default OFF: AD vem montado SEM cortar
  // silencios. ON = roda stage 2 do pipeline (detectSilences + cutVideoSegments).
  // Persiste em localStorage pra escolha sobreviver reload.
  const DECUPAGEM_KEY = 'darkolab:clickup-pilot:decupagem';
  const [decupagemEnabled, setDecupagemEnabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(DECUPAGEM_KEY) || '{}'); } catch { return {}; }
  });
  const isDecupagemEnabled = (taskId: string) => !!decupagemEnabled[taskId];
  const setDecupagemFor = (taskId: string, enabled: boolean) => {
    setDecupagemEnabled((prev) => {
      const next = { ...prev, [taskId]: enabled };
      try { localStorage.setItem(DECUPAGEM_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // INTENSIDADE da decupagem (keepSilence em segundos) — por task, persistida.
  // É o MESMO parâmetro da ferramenta /decupagem: quanto de silêncio manter nas
  // bordas da fala. Menor = corte mais agressivo. O valor escolhido é repassado
  // FIELMENTE pro pipeline (keepSilenceSec → computeSpeechSegments): se o user
  // põe 0.05, o corte usa 0.05. Default 0.12 = comportamento histórico (pausa
  // natural entre takes, feedback 12/05/2026) — não muda nada de quem não toca.
  const DECUP_INTENSITY_KEY = 'darkolab:clickup-pilot:decupIntensity';
  const DEFAULT_KEEP_SILENCE = 0.12;
  const [decupIntensity, setDecupIntensity] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(DECUP_INTENSITY_KEY) || '{}'); } catch { return {}; }
  });
  const getDecupIntensity = (taskId: string) => {
    const v = decupIntensity[taskId];
    return typeof v === 'number' && isFinite(v) ? v : DEFAULT_KEEP_SILENCE;
  };
  const setDecupIntensityFor = (taskId: string, sec: number) => {
    // Clamp pros mesmos limites da ferramenta /decupagem (0.01..0.50s).
    const clamped = Math.min(0.5, Math.max(0.01, Math.round(sec * 100) / 100));
    setDecupIntensity((prev) => {
      const next = { ...prev, [taskId]: clamped };
      try { localStorage.setItem(DECUP_INTENSITY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Popover de intensidade aberto por task (UI).
  const [decupPopoverOpen, setDecupPopoverOpen] = useState<Record<string, boolean>>({});

  const [analyzing, setAnalyzing] = useState(false);

  function toggleTaskSelected(id: string) {
    setSelectedTaskIds((prev) => {
      const n = new Set(prev);
      // Auto-toggle siblings G1/G2/etc do mesmo grupo: se marca G1,
      // tambem marca todas Gs. Evita confusao de "esqueci G2"
      // (todas Gs compartilham o mesmo doc, so analisamos 1x mesmo).
      const siblings = getSiblingTaskIds(id);
      const isCurrentlySelected = n.has(id);
      const newlySelected: string[] = [];
      for (const sid of siblings) {
        if (isCurrentlySelected) {
          n.delete(sid);
        } else if (!n.has(sid)) {
          n.add(sid);
          newlySelected.push(sid);
        }
      }
      // Auto-analyze: se selecionou tasks novas E ja ha outras tasks analisadas
      // (ou ja existe taskAnalyses pra alguma da selecao), dispara analyze
      // automaticamente das novas. Evita user ter que clicar "Analisar (N)"
      // a cada nova task que adiciona.
      if (!isCurrentlySelected && newlySelected.length > 0 && Object.keys(taskAnalyses).length > 0) {
        // Defer setTimeout pra esperar setSelectedTaskIds aplicar
        setTimeout(() => {
          const unanalyzed = newlySelected.filter((id) => !taskAnalyses[id]);
          if (unanalyzed.length > 0 && !analyzing) {
            analyzeSelected();
          }
        }, 100);
      }
      return n;
    });
  }

  /** Remove uma task individual do batch state (estado analisado).
   *  Usado pelo botao X em cada card da previsibilidade — user pode
   *  limpar uma sem ter que "Limpar tudo". */
  function removeTaskFromAnalysis(taskId: string) {
    // Remove tambem TODAS siblings (G1/G2 etc) que compartilharam analise
    // com essa task primary OU eram primary dela
    setTaskAnalyses((prev) => {
      const next = { ...prev };
      // Acha siblings ligados: a propria + as que compartilham com ela
      const toDelete = new Set<string>([taskId]);
      const target = prev[taskId];
      if (target?.sharedWithPrimaryId) {
        // Essa e sibling — remove o primary tambem
        toDelete.add(target.sharedWithPrimaryId);
      }
      for (const a of Object.values(prev)) {
        if (a.sharedWithPrimaryId && toDelete.has(a.sharedWithPrimaryId)) {
          toDelete.add(a.taskId);
        }
      }
      for (const id of toDelete) delete next[id];
      return next;
    });
    setSelectedTaskIds((prev) => {
      const n = new Set(prev);
      // Mesma logica de siblings — desmarca todos do grupo
      const target = taskAnalyses[taskId];
      const toRemove = new Set<string>([taskId]);
      if (target?.sharedWithPrimaryId) toRemove.add(target.sharedWithPrimaryId);
      for (const a of Object.values(taskAnalyses)) {
        if (a.sharedWithPrimaryId && toRemove.has(a.sharedWithPrimaryId)) {
          toRemove.add(a.taskId);
        }
      }
      for (const id of toRemove) n.delete(id);
      return n;
    });
  }
  function selectAllTasks() {
    setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  }
  function clearSelected() {
    setSelectedTaskIds(new Set());
    setTaskAnalyses({});
  }

  /** Extrai a "chave base" da task name pra detectar siblings G1/G2/etc.
   *  Ex: "AD15VN - PRPB06 - G1" → "AD15VN - PRPB06"
   *      "AD15VN - PRPB06 - G2" → "AD15VN - PRPB06"  (mesma chave = sibling)
   *      "AD144GL - VFPB04"      → "AD144GL - VFPB04" (sem sufixo G)
   *  Tasks com mesma chave compartilham o MESMO doc → analisar 1x evita
   *  dispatch duplicado.
   */
  function extractBaseTaskKey(taskName: string): string {
    // Tira sufixo " - G<N>" (case insensitive, com espacos variando)
    return taskName.replace(/\s*[-–—]\s*G\d+\s*$/i, '').trim();
  }

  /** Mapa baseKey → tasks que compartilham (computed) */
  const taskSiblingGroups = useMemo(() => {
    const groups = new Map<string, ClickUpTask[]>();
    for (const t of tasks) {
      const key = extractBaseTaskKey(t.name);
      const arr = groups.get(key) || [];
      arr.push(t);
      groups.set(key, arr);
    }
    return groups;
  }, [tasks]);

  /** Retorna os IDs de TODAS tasks no mesmo grupo G1/G2/G3 da task dada
   *  (inclui a propria). Quando tasks compartilham doc, processamos 1x e
   *  marcamos todas como dispatched. */
  function getSiblingTaskIds(taskId: string): string[] {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return [taskId];
    const key = extractBaseTaskKey(t.name);
    const siblings = taskSiblingGroups.get(key) || [t];
    return siblings.map((s) => s.id);
  }

  /** @param includeReviewOverride passa o valor NOVO do toggle de revisão na
   *  recarga imediata pós-toggle (setState é assíncrono — sem isso a primeira
   *  recarga usaria o valor antigo). Sem argumento, usa o estado atual. */
  async function loadTasks(
    includeReviewOverride?: boolean,
    /** Troca de workspace: o state ainda não propagou quando chamamos daqui,
     *  então o alvo vem explícito. Sem isso a primeira carga após a troca
     *  buscaria as tasks da empresa ANTERIOR. */
    target?: { teamId?: string | null; editorId?: string | null },
  ): Promise<boolean> {
    const teamId = target?.teamId ?? selectedTeam;
    const editorId = target?.editorId ?? selectedEditor;
    if (!teamId || !editorId) {
      setError('Escolhe team + editor primeiro.');
      return false;
    }
    setLoadingTasks(true);
    setError(null);
    try {
      const withReview = typeof includeReviewOverride === 'boolean' ? includeReviewOverride : includeReview;
      const base = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
      // Extras do workspace ativo (ex.: "refação vídeo" no DR MILLION).
      // No B2C a lista é vazia → `statuses` sai idêntico ao de sempre.
      const teamName = teams.find((t) => t.id === teamId)?.name;
      const statuses = mergeStatuses(base, resolveStatusExtras(teamId, teamName));
      if (withReview) {
        const seen = new Set(statuses.map((s) => s.toLowerCase()));
        for (const st of REVIEW_STATUSES) if (!seen.has(st)) statuses.push(st);
      }
      const r = await listTasks(teamId, {
        assigneeIds: [editorId],
        statuses,
        page: 0,
        subtasks: false,
      });
      setTasks(r.tasks);
      if (r.tasks.length === 0) {
        // Tenta sem filtro de status — talvez o editor tenha tasks mas com
        // status fora dos defaults
        const r2 = await listTasks(teamId, {
          assigneeIds: [editorId],
          page: 0,
          subtasks: false,
        });
        if (r2.tasks.length > 0) {
          // Coleta status existentes pra mostrar pro user
          const statusCounts = new Map<string, number>();
          for (const t of r2.tasks) {
            const s = t.status?.status || '?';
            statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
          }
          const breakdown = Array.from(statusCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => `${s} (${c})`)
            .join(', ');
          setError(
            `0 tasks com filtros atuais, mas o editor TEM ${r2.tasks.length} tasks sem filtro. Status disponiveis: ${breakdown}. Edita o filtro acima OU usa esses status.`,
          );
        } else {
          setError(`Editor sem tasks neste workspace. Confira se selecionou o workspace certo (atual: ${teamName ?? currentTeam?.name}).`);
        }
      }
      return true;
    } catch (e) {
      setError(toFriendlyMessage(e, 'Não consegui listar suas tasks agora. Tenta de novo em instantes.'));
      return false;
    } finally {
      setLoadingTasks(false);
    }
  }

  /* ========== Troca de EMPRESA (workspace) ==========
   *  Você atende duas empresas com o mesmo login do ClickUp. Trocar aqui
   *  muda de onde as tasks vêm, sem passar por /configuracoes.
   *
   *  Cuidados que este fluxo respeita:
   *   • A FILA em produção (batchStates) NÃO é tocada — ela é por taskId e o
   *     painel dela vive dentro do bloco de tasks, então a lista é
   *     SUBSTITUÍDA (nunca esvaziada antes) pra fila não sumir da tela.
   *   • A task aberta é fechada: é de outra empresa, seria pedir confusão.
   *   • Editor: cada workspace lembra o seu. Se o editor salvo não existir
   *     no destino, cai pra você mesmo (authUser) em vez de listar 0 tasks.
   *   • Se a carga falhar, a lista é limpa — melhor vazio do que mostrar
   *     task da empresa errada. */
  const [switchingTeam, setSwitchingTeam] = useState(false);

  /** Reservas de geração por CONTEÚDO (texto+avatar+voz) — DR MILLION.
   *  Hooks irmãos do mesmo AD dividem o corpo; a primeira task que precisa de
   *  uma fala reserva a chave e as outras esperam o mesmo vídeo em vez de
   *  gerar de novo no HeyGen. Vive na sessão (não persiste): depois de um F5
   *  o RETOMAR regenera normal, que é o comportamento seguro. */
  const drDedupRef = useRef<
    Map<string, { promise: Promise<string | null>; resolve: (v: string | null) => void }>
  >(new Map());

  /* ========== Idioma da copy (DR MILLION) ==========
   *  O DR MILLION dispara em POLONÊS — o português vem no doc só pra guiar.
   *  Por isso o default é 'pl'. O seletor troca quando você quiser conferir
   *  ou disparar em português. Vale só pros docs bilíngues; o B2C não passa
   *  por aqui. `ref` porque analyzeSelected lê fora do ciclo de render. */
  const DR_LANG_KEY = 'darkolab:clickup-pilot:dr-lang';
  const [drLang, setDrLangState] = useState<DrMillionLang>('pl');
  const drLangRef = useRef<DrMillionLang>('pl');
  drLangRef.current = drLang;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const salvo = localStorage.getItem(DR_LANG_KEY);
    if (salvo === 'pt' || salvo === 'pl') setDrLangState(salvo);
  }, []);
  function setDrLang(v: DrMillionLang) {
    setDrLangState(v);
    try {
      localStorage.setItem(DR_LANG_KEY, v);
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }

  /** Mostra o seletor de idioma quando a empresa ativa é a do doc bilíngue
   *  (DR MILLION) ou quando alguma análise já veio bilíngue. No B2C, nunca. */
  const mostrarSeletorIdioma = useMemo(() => {
    const nome = teams.find((t) => t.id === selectedTeam)?.name || '';
    if (/mil+i?on/i.test(nome)) return true;
    return Object.values(taskAnalyses).some((a) => a?.drMillion);
  }, [teams, selectedTeam, taskAnalyses]);

  /** Idiomas presentes nos ADs analisados — o que faltar aparece travado.
   *  Sem análise ainda, deixa os dois livres. */
  const idiomasDaSelecao = useMemo(() => {
    const analisadas = Object.values(taskAnalyses).filter((a) => a?.drMillion && a.drLangs);
    if (!analisadas.length) return { pt: true, pl: true };
    return {
      pt: analisadas.some((a) => a.drLangs!.pt),
      pl: analisadas.some((a) => a.drLangs!.pl),
    };
  }, [taskAnalyses]);

  function resolveEditorForTeam(teamId: string): string | null {
    // ESTRITO de propósito: sem escolha própria pra essa empresa, o certo é
    // "minhas tasks" (authUser) — nunca herdar o editor da outra empresa.
    const saved = getPilotEditorForTeamStrict(teamId);
    const team = teams.find((t) => t.id === teamId);
    const members = team?.members || [];
    // Sem membros visíveis (o B2C responde assim) não dá pra validar —
    // confia no salvo, e cai pro authUser quando não houver nada.
    if (saved && (members.length === 0 || members.some((m) => String(m.user?.id) === String(saved)))) {
      return saved;
    }
    if (authUser) return String(authUser.id);
    return getPilotEditorForTeam(teamId);
  }

  async function switchWorkspace(teamId: string) {
    if (!teamId || teamId === selectedTeam || switchingTeam || loadingTasks) return;
    // Carimba a escolha da empresa que está saindo, pra ela voltar exatamente
    // como estava (inclusive se o editor era outra pessoa).
    if (selectedTeam && selectedEditor) {
      setPilotEditorForTeam(selectedTeam, selectedEditor);
    }
    const editor = resolveEditorForTeam(teamId);
    // A empresa de DESTINO tem fila? Se tem, a lista é só substituída (nunca
    // esvaziada): o painel "Tasks em produção" mora dentro do bloco
    // `tasks.length > 0` e sumiria no meio dos disparos DELA. Se não tem, dá
    // pra esvaziar — nada da empresa anterior fica na tela enquanto carrega.
    const filaAtiva = Object.values(batchStatesRef.current || {}).some(
      (b) => b && (!b.teamId || b.teamId === teamId),
    );
    setSwitchingTeam(true);
    setSelectedTeam(teamId);
    setSelectedEditor(editor);
    setPilotEditorForTeam(teamId, editor);
    // Fecha o que era da empresa anterior (a FILA continua intacta).
    setSelectedTask(null);
    setTaskDetail(null);
    setError(null);
    if (!filaAtiva) setTasks([]);
    try {
      const ok = await loadTasks(undefined, { teamId, editorId: editor });
      // Falhou (rede/token): não deixa a lista da empresa anterior no ar
      // fingindo ser a nova. Com fila ativa, mantém pra não matar o painel —
      // o erro fica visível logo acima.
      if (!ok && !filaAtiva) setTasks([]);
    } finally {
      setSwitchingTeam(false);
    }
  }

  /* ========== Task detail + doc parser ========== */
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<ClickUpTask | null>(null);
  const [docContent, setDocContent] = useState('');
  const [parsed, setParsed] = useState<ParsedAdSection | null>(null);
  const [briefing, setBriefing] = useState<ParsedDarkoBriefing | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fetchingDoc, setFetchingDoc] = useState(false);

  async function openTask(t: ClickUpTask) {
    setSelectedTask(t);
    setTaskDetail(null);
    setDocContent('');
    setParsed(null);
    setParseError(null);
    try {
      const d = await getTask(t.id);
      setTaskDetail(d);
    } catch (e) {
      setError(toFriendlyMessage(e, 'Não consegui abrir essa task agora. Tenta de novo em instantes.'));
    }
  }

  /**
   * Tenta extensao (le doc com sessao Google logada — funciona pra docs
   * privados que voce tem acesso). Fallback: server fetch (so docs publicos).
   * Retorna tambem driveLinks: links pra videos em Drive citados no doc
   * (necessarios pra visual match de avatares).
   */
  function fetchDocViaExtensionOnce(url: string): Promise<{ ok: boolean; text?: string; error?: string; driveLinks?: Array<{ text: string; fileId: string | null; url?: string | null }>; headings?: Array<{ id: string; text: string }>; transient?: boolean }> {
    return new Promise((resolve) => {
      const requestId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // Timeout em DOIS estagios (extensao v4.16.2+ manda HG_DOC_ACK assim
      // que o background aceita o job):
      //  - sem ACK e sem resultado em 30s → extensao morta/surda → erro
      //    transient (retry + instrucao de F5). Bridge v4.16.2+ com contexto
      //    invalidado responde erro INSTANTANEO, nem chega aqui.
      //  - com ACK → background esta lendo (export 2x12s + fallback tab
      //    ~21s ≈ 45s no pior caso) → janela total de 90s. Antes a page
      //    desistia em 30s enquanto o doc chegava logo depois.
      let acked = false;
      let done = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finish = (r: { ok: boolean; text?: string; error?: string; driveLinks?: Array<{ text: string; fileId: string | null; url?: string | null }>; headings?: Array<{ id: string; text: string }>; transient?: boolean }) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', handler);
        timers.forEach(clearTimeout);
        resolve(r);
      };
      const handler = (ev: MessageEvent) => {
        if (ev.data?.source !== 'darkolab-ext' || ev.data?.requestId !== requestId) return;
        if (ev.data?.type === 'HG_DOC_ACK') { acked = true; return; }
        if (ev.data?.type === 'HG_DOC_RESULT') {
          const error = ev.data.error ? String(ev.data.error) : undefined;
          finish({
            ok: !!ev.data.ok,
            text: ev.data.text,
            error,
            driveLinks: ev.data.driveLinks,
            headings: ev.data.headings,
            // permissao/inexistente nao melhora com retry; resto sim
            transient: !ev.data.ok && !!error && !/permiss|nao existe|não existe|privado/i.test(error),
          });
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ source: 'darkolab', type: 'HG_FETCH_DOC', requestId, url }, '*');
      timers.push(setTimeout(() => {
        if (!acked) finish({ ok: false, transient: true, error: 'Extensao nao respondeu em 30s — recarregue esta pagina (F5). Se persistir, baixe a extensao atual em /api/extension/download e recarregue em chrome://extensions.' });
      }, 30000));
      timers.push(setTimeout(() => {
        finish({ ok: false, transient: true, error: 'Timeout 110s lendo o doc (Google lento ou doc gigante) — tente analisar de novo.' });
      }, 110000));
    });
  }

  /** Doc fetch com retry automatico: ate 3 tentativas pra erro transient
   *  (timeout, glitch de rede, service worker dormindo). Erro definitivo
   *  (sem permissao / doc nao existe) falha direto sem retry. */
  async function fetchDocViaExtension(url: string): Promise<{ ok: boolean; text?: string; error?: string; driveLinks?: Array<{ text: string; fileId: string | null; url?: string | null }>; headings?: Array<{ id: string; text: string }> }> {
    let last: { ok: boolean; text?: string; error?: string; driveLinks?: Array<{ text: string; fileId: string | null; url?: string | null }>; headings?: Array<{ id: string; text: string }>; transient?: boolean } = { ok: false, error: 'sem tentativa' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = await fetchDocViaExtensionOnce(url);
      if (last.ok || !last.transient) return last;
      console.warn(`[doc-fetch] tentativa ${attempt}/3 falhou (${last.error}) — retry em 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    return last;
  }

  /** Normaliza string pra match flexivel: remove acentos, espacos, pontuacao,
   *  case insensitive. 'Dr. Marco Túlio' → 'drmarcotulio' */
  function normalizeForMatch(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacriticos
      .toLowerCase()
      .replace(/\.(mp4|mov)$/i, '')
      .replace(/[^\w]/g, ''); // strip espacos, pontos, hifens, etc
  }

  /** Acha o id de heading (#heading=h.xxxx) da seção do AD dentro da lista de
   *  headings que a extensão extraiu do export do doc. Casa a 1a linha (o
   *  heading) da seção do AD — a MESMA que o parser usa — com a lista. Retorna
   *  null se não achar → link fica sem âncora (comportamento antigo, sem regressão). */
  function findDocHeadingId(
    docText: string,
    baseAdId: string | null,
    variant: string | null | undefined,
    headings: Array<{ id: string; text: string }> | undefined,
  ): string | null {
    if (!baseAdId || !headings || headings.length === 0) return null;
    const section = findAdSection(docText, baseAdId, variant);
    const firstLine = (section ? section.split(/\r?\n/)[0] : '').trim();
    const target = normalizeForMatch(firstLine);
    if (target.length < 4) return null;
    // 1) match exato normalizado
    let hit = headings.find((h) => normalizeForMatch(h.text) === target);
    // 2) prefixo nos dois sentidos (texto do export pode diferir levemente)
    if (!hit) hit = headings.find((h) => {
      const n = normalizeForMatch(h.text);
      return n.length >= 4 && (n.startsWith(target) || target.startsWith(n));
    });
    return hit ? hit.id : null;
  }

  /** Monta o link do doc apontando DIRETO pra copy do AD (#heading=...),
   *  preservando a aba (?tab=) que já vem no docUrl do ClickUp. Sem headingId
   *  retorna o docUrl puro. */
  function docDeepLink(docUrl?: string, headingId?: string): string | undefined {
    if (!docUrl || !headingId) return docUrl;
    return `${docUrl.split('#')[0]}#heading=${headingId}`;
  }

  /** Resolve username pra Drive file ID pesquisando driveLinks por match de texto.
   *  Estrategias (em ordem):
   *   1. Match exato normalizado: 'omédicodoshomens' → driveLink text inclui 'omedicodoshomens'
   *   2. Nucleus match (strip digitos finais): 'manualdohomemsolo2' → 'manualdohomemsolo'
   *   3. Inverso: o text do link inclui o username normalizado
   *
   *  '@marcella.malvar2' procura link cujo texto contem 'marcellamalvar2'.
   *  'Dr. Marco Túlio' procura 'drmarcotulio'.
   *  'omédicodoshomens' procura 'omedicodoshomens'. */
  function resolveVideoFileId(username: string, driveLinks: Array<{ text: string; fileId: string | null; url?: string | null }> | undefined): string | null {
    // So links de DRIVE (com fileId) sao candidatos. driveLinks agora tambem
    // carrega links de YouTube (fileId null) — sem este filtro, um link de
    // YouTube cujo titulo casa o username retornaria null e SOMBREARIA o .mp4
    // real do Drive que vem depois no array (avatar perdia thumb + "Baixar").
    const links = (driveLinks || []).filter((l) => l.fileId);
    if (links.length === 0) return null;
    const u = normalizeForMatch(username.replace(/^@/, ''));
    if (u.length < 3) return null;
    const uNoTrailDigits = u.replace(/\d+$/, ''); // 'manualdohomemsolo2' → 'manualdohomemsolo'

    // 1. Match direto: text normalizado contem username
    for (const link of links) {
      const t = normalizeForMatch(link.text);
      if (t.includes(u)) return link.fileId;
    }
    // 2. Match por nucleus (sem digitos finais nem extensao)
    if (uNoTrailDigits.length >= 4) {
      for (const link of links) {
        const t = normalizeForMatch(link.text).replace(/\d+$/, '');
        // GUARD: link 100% numerico (talking-photo "7508...mp4") vira "" aqui;
        // sem isto, `uNoTrailDigits.includes("")` casava QUALQUER username e
        // retornava o fileId errado (bug da thumb do depoimento no avatar YT).
        if (t.length < 4) continue;
        if (t === uNoTrailDigits || t.includes(uNoTrailDigits) || uNoTrailDigits.includes(t)) {
          return link.fileId;
        }
      }
    }
    // 3. Match por TOKENS (resolve nomes com acento/espaco/ponto tipo
    //    "@Dr. Marco Túlio.mp4"): quebra o username em palavras (sem
    //    acento), exige que todos os tokens >=3 chars apareçam no texto
    //    normalizado do link. "dr marco tulio" casa com link cujo texto
    //    normalizado contem "marco" e "tulio".
    const tokens = username
      .replace(/^@/, '')
      .replace(/\.(mp4|mov)$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tk) => tk.length >= 3);
    if (tokens.length > 0) {
      for (const link of links) {
        const t = normalizeForMatch(link.text);
        if (tokens.every((tk) => t.includes(tk))) return link.fileId;
      }
    }
    return null;
  }

  /** Acha um link de YouTube cujo texto casa o `username` — cobre o chip
   *  ".mp4" que na verdade aponta pra YouTube (editor renomeia o chip pra
   *  "<handle>.mp4" mas o href e do YouTube). So roda como FALLBACK quando nao
   *  ha arquivo de Drive. Retorna {url, thumb} ou null. */
  function resolveYouTubeFromLinks(
    username: string,
    driveLinks: Array<{ text: string; fileId: string | null; url?: string | null }> | undefined,
  ): { url: string; thumb: string } | null {
    if (!driveLinks || driveLinks.length === 0) return null;
    const u = normalizeForMatch(username.replace(/^@/, ''));
    if (u.length < 3) return null;
    for (const link of driveLinks) {
      if (!link.url) continue;
      const id = extractYouTubeId(link.url);
      if (!id) continue;
      const t = normalizeForMatch(link.text);
      if (t && (t.includes(u) || u.includes(t))) {
        return { url: `https://www.youtube.com/watch?v=${id}`, thumb: youTubeThumb(id) };
      }
    }
    return null;
  }

  /** Visual match via Claude vision API (~5s, $0.005). Retorna avatar matched ou null */
  async function visualMatchAvatar(
    refImageUrl: string,
    candidates: Array<{ id: string; name: string; groupName?: string; thumbUrl: string }>,
  ): Promise<{ id: string; name: string; groupName?: string; confidence: string; reason: string } | null> {
    try {
      const r = await fetch('/api/avatar-visual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceImageUrl: refImageUrl, candidates }),
      });
      const j = await r.json();
      if (!j.ok || !j.matched) return null;
      return { ...j.matched, confidence: j.confidence, reason: j.reason };
    } catch {
      return null;
    }
  }

  /** Analisa N tasks em paralelo (max 3): pega doc, parsea, monta plano. */
  async function analyzeSelected() {
    if (selectedTaskIds.size === 0) {
      setError('Selecione pelo menos uma task primeiro.');
      return;
    }
    setError(null);
    setAnalyzing(true);
    // PREFLIGHT: a leitura do doc depende do bridge da extensao injetado
    // NESTE dominio. Extensoes antigas (<4.15.2) so injetam em *.vercel.app,
    // entao em darkoautoedit.com o bridge nao carrega e o HG_FETCH_DOC cai no
    // vazio ate o timeout de 30s — hang silencioso por task. Detecta antes
    // (700ms) e falha rapido com instrucao de reinstalar.
    // v4.16.2+: bridge manda HG_DOC_ACK (page espera ate 90s com ACK) e
    // responde erro instantaneo se o contexto da extensao foi invalidado
    // (extensao atualizada com a page aberta — antes era hang de 30s,
    // porque o HG_PING do preflight e respondido pelo bridge SEM tocar o
    // background, entao o preflight passava mesmo com a extensao quebrada).
    const MIN_EXT_VERSION = '4.16.2';
    const ext = await detectExtension();
    const cmpVer = (a: string, b: string) => {
      const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
      const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
      }
      return 0;
    };
    if (!ext.connected) {
      setAnalyzing(false);
      setError(
        `Extensao Auto Edit nao detectada neste dominio (darkoautoedit.com). ` +
          `Se voce instalou uma versao antiga, ela so funciona no dominio vercel.app. ` +
          `Baixe a versao atual em /api/extension/download, recarregue em chrome://extensions e atualize esta pagina (F5).`,
      );
      return;
    }
    if (ext.version && ext.version !== '?' && cmpVer(ext.version, MIN_EXT_VERSION) < 0) {
      setAnalyzing(false);
      setError(
        `Extensao desatualizada (v${ext.version}). A leitura de docs exige v${MIN_EXT_VERSION}+. ` +
          `Baixe a versao atual em /api/extension/download e recarregue em chrome://extensions.`,
      );
      return;
    }
    // Force reload library — pega avatares recem criados (user pode ter
    // acabado de criar voice clones alinhadas com nomes do briefing)
    await reloadLibrary(true);
    // Carrega lista de vozes HeyGen pra resolver auto @username -> voiceId
    // (caso o copy diga @x.mp4 e exista voz "@x" no HeyGen mesmo sem
    //  pareamento previo de memoria — voz vai como override no slot)
    let voiceLibrary: Array<{ id: string; name: string }> = [];
    try {
      // CONTA ATIVA (sessão), NÃO API key do servidor: as vozes custom
      // (@username/clones) vêm da biblioteca de avatares recém-recarregada
      // (reloadLibrary(true) acima); stock vem da sessão. Antes usava
      // /api/heygen/voices (API key fixa) → casava @username com voiceId da
      // CONTA ERRADA quando o user trocava de conta no HeyGen.
      const seenV = new Set<string>();
      const snapV = getLibrarySnapshot();
      // Voz nativa @username de Avatar IV vem com voiceName=null no look — resolve o
      // nome real via getVoiceName() em vez de descartar (senão o @username do
      // briefing não casava com a voz, ex: @drrafaelsiqueira1).
      const needNameV: { id: string; fallback: string }[] = [];
      for (const g of snapV.groups) {
        for (const l of g.looks) {
          const vid = (l as any).voiceId as string | undefined;
          if (!vid || seenV.has(vid)) continue;
          seenV.add(vid);
          const vn = (l as any).voiceName as string | undefined;
          if (vn) voiceLibrary.push({ id: vid, name: vn });
          else needNameV.push({ id: vid, fallback: g.name || `Voz ${vid.slice(0, 8)}` });
        }
      }
      const { listStockVoices, listMyClonedVoices, getVoiceName } = await import('@/lib/heygen-api-direct');
      if (needNameV.length) {
        const resolvedV = await Promise.all(
          needNameV.map(async (x) => ({ id: x.id, name: (await getVoiceName(x.id)) || x.fallback })),
        );
        for (const r of resolvedV) voiceLibrary.push({ id: r.id, name: r.name });
      }
      // Vozes CLONADAS do user (voice_clone/voice.list) — clone referenciado por
      // @nome no briefing (ex: @tony) que não está anexado a nenhum avatar só casa
      // se vier daqui; /v1/voice.list (stock) não traz o grosso dos clones.
      for (const v of await listMyClonedVoices()) {
        if (!seenV.has(v.id)) { seenV.add(v.id); voiceLibrary.push({ id: v.id, name: v.name }); }
      }
      for (const v of await listStockVoices()) {
        if (!seenV.has(v.id)) { seenV.add(v.id); voiceLibrary.push({ id: v.id, name: v.name }); }
      }
    } catch {}
    const voiceByNorm = new Map<string, { id: string; name: string }>();
    for (const v of voiceLibrary) {
      voiceByNorm.set(normalizeVoiceName(v.name), { id: v.id, name: v.name });
    }
    const allSelected = tasks.filter((t) => selectedTaskIds.has(t.id));
    // DEDUP G1/G2: tasks com mesmo baseTaskKey compartilham o doc.
    // So precisamos analisar uma — as siblings copiam o resultado.
    const seenKeys = new Set<string>();
    const targets: typeof allSelected = [];
    const siblingMap = new Map<string, string[]>(); // primary task id → all sibling ids
    for (const t of allSelected) {
      const key = extractBaseTaskKey(t.name);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        targets.push(t);
        // Inclui todas as Gs do mesmo key que estao selecionadas
        const siblings = allSelected.filter((s) => extractBaseTaskKey(s.name) === key).map((s) => s.id);
        siblingMap.set(t.id, siblings);
      }
    }
    // AVATAR ESCOLHIDO NA MÃO: guarda ANTES do reset abaixo, que troca o
    // estado inteiro por análises zeradas. Sem isto, reanalisar (o que
    // acontece ao trocar o idioma no DR MILLION) jogava fora o avatar que
    // você acabou de escolher — e lá ele é obrigatório, porque o doc não traz.
    const manuaisAntes = new Map<string, RoleSlot[]>();
    for (const t of allSelected) {
      const anteriores = (taskAnalysesRef.current[t.id]?.roleSlots || []).filter((s) => s.manual);
      if (anteriores.length) manuaisAntes.set(t.id, anteriores);
    }
    // Init status pendente pra TODAS (inclui siblings nao-primary pra UI mostrar consistente)
    setTaskAnalyses(() => {
      const init: Record<string, TaskAnalysis> = {};
      for (const t of allSelected) {
        init[t.id] = { taskId: t.id, taskName: t.name, status: 'pending', roleSlots: [], partTemplates: [] };
      }
      return init;
    });

    const PARALLEL = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const idx = cursor++;
        const task = targets[idx];
        setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'analyzing' } }));
        try {
          // 1. Pega detalhes da task → encontra doc URL no custom field "DOC DA COPY"
          const det = await getTask(task.id);

          // === TROCA DE ÁUDIO: pipeline proprio, SEM doc de copy ===
          // Essas tasks so tem o link do criativo original no Drive (em
          // comentario / custom field / descricao) + um novo WHITE que o user
          // upa antes de disparar. Detectado ANTES da exigencia de doc.
          if (isTrocaAudioTask(task.name)) {
            // FONTE DO CRIATIVO = COMENTARIO (Activity). O campo "LINK PASTA
            // DRIVE" e a pasta de OUTPUT (onde o user sobe o resultado), entao
            // NUNCA usamos ele como fonte de download. So link de ARQUIVO
            // (/file/d/) do comentario/descricao conta.
            let driveId: string | null = null;
            let driveUrl: string | null = null;
            const grab = (text: string | undefined | null) => {
              const t = text || '';
              const id = extractDriveFileIdFromText(t);
              if (id && !driveId) {
                driveId = id;
                driveUrl = t.match(/https?:\/\/\S+/)?.[0] || null;
              }
            };
            let commentCount = 0;
            // 1) COMENTARIOS — fonte canonica ("Fazer a troca do audio: <link>").
            try {
              const comments = await getTaskComments(task.id);
              commentCount = comments.length;
              for (const c of comments) {
                grab(c.comment_text);
                if (driveId) break;
              }
            } catch (e) {
              console.warn('[troca] getTaskComments falhou:', e);
            }
            // 2) Descricao (fallback) — tambem so pega link de ARQUIVO.
            if (!driveId) grab(det.description || det.text_content);

            // PASTA (LINK PASTA DRIVE) — APENAS atalho "abrir pasta" pra quando
            // a task nao tem comentario com o link. NUNCA e fonte de download.
            let driveFolderUrl: string | null = null;
            const grabFolder = (t: string | undefined | null) => {
              if (driveFolderUrl) return;
              const m = (t || '').match(/https?:\/\/\S*\/drive\/folders\/[a-zA-Z0-9_-]+\S*/);
              if (m) driveFolderUrl = m[0];
            };
            for (const f of det.custom_fields || []) {
              if (typeof f.value === 'string') grabFolder(f.value);
            }
            grabFolder(det.description || det.text_content);

            console.info(
              `[troca] "${task.name}": ${commentCount} comentario(s), arquivo=${driveId || 'NAO DETECTADO (link fica no comentario)'}, pasta=${driveFolderUrl || 'nao'}`,
            );

            const baseAdIdM = task.name.match(/AD\d+[A-Z0-9]*/i);
            const baseAdId = baseAdIdM ? baseAdIdM[0].toUpperCase() : task.name;
            setTaskAnalyses((prev) => ({
              ...prev,
              [task.id]: {
                ...prev[task.id],
                status: 'ready',
                baseAdId,
                taskUrl: (det as any).url || (task as any).url || undefined,
                trocaBriefing: { baseAdId, driveId, driveUrl, driveFolderId: null, driveFolderUrl },
                roleSlots: [],
                partTemplates: [],
              },
            }));
            if (driveUrl) {
              setTrocaAdUrl((prev) => ({ ...prev, [task.id]: prev[task.id] || driveUrl! }));
            }
            continue;
          }

          const docField = (det.custom_fields || ([] as any[])).find((f: any) => /DOC DA COPY/i.test(f.name || ''));
          const docUrl = docField?.value || extractDocLinks(det.description || det.text_content)[0];
          // Persiste docUrl + taskUrl pra UI poder abrir direto sem ter q ir no ClickUp.
          setTaskAnalyses((prev) => ({
            ...prev,
            [task.id]: { ...prev[task.id], docUrl: docUrl || undefined, taskUrl: (det as any).url || (task as any).url || undefined },
          }));
          if (!docUrl) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Task sem link de copy: preencha o campo "DOC DA COPY" ou cole o link do doc na descrição.' } }));
            continue;
          }
          // 2. Fetch doc via extensao (sessao Google logada) + Drive links pros videos
          const docR = await fetchDocViaExtension(docUrl);
          if (!docR.ok || !docR.text) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: `Doc fetch: ${docR.error || 'sem texto'}` } }));
            continue;
          }
          // 2.2 DEEP-LINK: âncora de heading da seção EXATA do AD → o botão
          // "abrir doc" abre o Google Docs já na copy desse AD (sem rolar/buscar).
          // Best-effort: sem heading achado, o botão usa o docUrl normal (a aba
          // que já vem do ClickUp é preservada). Headings só vêm pelo export_html.
          {
            const adForHeading = (task.name.match(/\b(AD\d+[A-Z0-9]*)/i) || [])[1]?.toUpperCase() || null;
            const headingId = findDocHeadingId(docR.text, adForHeading, extractVariantToken(task.name), docR.headings);
            if (headingId) {
              setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], docHeadingId: headingId } }));
            }
          }
          // 2.5 VARIACAO DE AVATAR: detector + parser dedicado
          // Tasks 'VA - ...' OU docs com 'Variação de avatar' tem pipeline
          // diferente (lipsync por audio do AD original, N avatares).
          // CRITICAL: o check do doc tem que ser ESCOPADO na secao do AD em
          // questao — antes checava docR.text inteiro, e docs com multiplos
          // ADs (alguns VA, outros nao) marcavam o AD errado como VA falso.
          // Ex: AD05VN-VRWA01 nao e VA, mas o doc tinha AD09 (VA) que vazava
          // o trigger pro AD05.
          // AD ID em QUALQUER posicao (tasks VA tem prefixo: 'VA01 e 02 -
          // AD19G1GL - PRPB06') e com digitos no sufixo ([A-Z0-9]*): a regex
          // antiga ^(AD\d+[A-Z]+)\b exigia AD no inicio E nem casava
          // 'AD19G1GL' (o '1' depois do 'G' quebrava [A-Z]+\b).
          const baseAdIdMatch = task.name.match(/\b(AD\d+[A-Z0-9]*)/i);
          const baseAdIdForVaCheck = baseAdIdMatch ? baseAdIdMatch[1].toUpperCase() : null;
          const sectionForVaCheck = baseAdIdForVaCheck
            ? (findAdSection(docR.text, baseAdIdForVaCheck) || '')
            : '';
          // Detector VA ESTRITO — só conta se "Variação de avatar" aparece
          // como HEADING de seção (não texto narrativo nas Instruções).
          //
          // FALSO POSITIVO que dava antes (user reportou 2026-05-27):
          //   "Instruções para edição: Esse criativo é uma variação de
          //   avatar do AD119G1. Só altera o avatar..."
          // → texto descritivo, NÃO é VA real. Mas regex pegava igual.
          //
          // VA REAL aparece como:
          //   "AD07G1VN-PRPB06 - Variação de avatar - SILAS"  (heading com -)
          //   "Variação de Avatar"                              (linha isolada)
          //   "Variação de avatar:" / "Variação de avatar -"   (label/separador)
          function hasVaHeaderInSection(section: string): boolean {
            const lines = section.split(/\r?\n/);
            for (const line of lines) {
              const t = line.trim();
              if (!t) continue;
              // Padrão 1: heading "AD... - Variação de avatar..."
              if (/^[A-Z0-9]+(?:[-\s][A-Z0-9]+)*\s*[-–—]\s*varia[cç][aã]o\s+de\s+avatar\b/i.test(t)) return true;
              // Padrão 2: linha começando com "Variação de avatar" (curta, tipo heading)
              if (/^varia[cç][aã]o\s+de\s+avatar\s*[-–—:]?/i.test(t) && t.length < 80) return true;
            }
            return false;
          }
          if (isVATask(task.name) || hasVaHeaderInSection(sectionForVaCheck)) {
            // Extrai quais AVAs estao indicados na NOMENCLATURA da task
            // (ex 'VA - AD03G1VN - ... - AVA05 e 06 - Silas' → [5, 6]).
            // Se task indicar AVAs especificas, parser SO retorna esses
            // (mesmo que doc tenha mais).
            const taskAvaNums = extractAvaNumsFromTaskName(task.name);
            const vaBriefing = parseVABriefing(docR.text, task.name, docR.driveLinks || [], taskAvaNums);
            if (vaBriefing) {
              // MATCH AGGRESSIVO de avatar fileId via driveLinks.
              // Caso parseVABriefing nao tenha resolvido (text dos links nao
              // bate exato), tenta:
              //  1. Match parcial: filename contem username OU username contem filename
              //  2. Match por nucleus (strip digitos e mp4)
              const allLinks = docR.driveLinks || [];
              for (const av of vaBriefing.avatares) {
                if (av.fileId) continue;
                const target = av.username.toLowerCase().replace(/\.(mp4|mov)$/i, '');
                const targetCore = target.replace(/\d+$/, ''); // 'manualdohomemsolo2' → 'manualdohomemsolo'
                // 1. Match direto: text contem target
                let match = allLinks.find((d: any) => {
                  const t = (d.text || '').toLowerCase();
                  return t.includes(target);
                });
                // 2. Match nucleus
                if (!match && targetCore.length > 4) {
                  match = allLinks.find((d: any) => {
                    const t = (d.text || '').toLowerCase().replace(/\.(mp4|mov)$/i, '').replace(/\d+$/, '');
                    return t === targetCore || t.includes(targetCore) || targetCore.includes(t);
                  });
                }
                if (match) {
                  av.fileId = match.fileId;
                  console.log(`[clickup-pilot] VA: resolved avatar ${av.avaCode} (@${av.username}) → ${match.fileId} via aggressive match`);
                }
              }
              // AUTO-RESOLVE DRIVE ID DO AD ORIGINAL via pasta CRIATIVOS
              // Quando o parser nao achou linkAdFileId mas tem linkAdFilename,
              // procura pasta CRIATIVOS (link no topo do doc) + lista files +
              // match por nome. Critico pra pipeline VA funcionar.
              if (!vaBriefing.linkAdFileId && vaBriefing.linkAdFilename && docR.driveLinks?.length) {
                // Normaliza removendo acentos/cedilha/case + extensao
                // (pra match robusto entre filename do doc e nome no Drive)
                const normName = (s: string) => (s || '')
                  .normalize('NFD')
                  .replace(/[̀-ͯ]/g, '')
                  .toLowerCase()
                  .replace(/\.(mp4|mov)$/i, '')
                  .trim();
                const target = normName(vaBriefing.linkAdFilename);
                // Extrai AD ID prefix: "AD02G1VN-PRPB05" do filename
                // (mais unico que filename inteiro — basta isso pra achar)
                const adIdMatch = target.match(/^(ad\d+[a-z0-9]*-[a-z]+\d+)/i);
                const adIdPrefix = adIdMatch ? adIdMatch[1].toLowerCase() : null;
                // Match super flexivel: confere nome OU AD ID prefix
                const fuzzyMatch = (candidateName: string) => {
                  const fn = normName(candidateName);
                  if (!fn) return false;
                  if (fn === target || fn.includes(target) || target.includes(fn)) return true;
                  if (adIdPrefix && fn.includes(adIdPrefix)) return true;
                  return false;
                };
                console.log(`[clickup-pilot] VA AD detection: target="${target}" adIdPrefix="${adIdPrefix}" driveLinks=${docR.driveLinks.length}`);

                // 1) Match direto nos driveLinks do doc (link em qualquer parte do doc)
                {
                  const direct = docR.driveLinks.find((d: any) => fuzzyMatch(d.text));
                  if (direct) {
                    vaBriefing.linkAdFileId = direct.fileId;
                    console.log(`[clickup-pilot] VA: direct match in driveLinks "${direct.text}" → ${direct.fileId}`);
                  } else {
                    console.log(`[clickup-pilot] VA: nenhum driveLink direto bateu. Lista:`, docR.driveLinks.map((d:any)=>d.text).slice(0,12));
                  }
                }

                // 2) Fallback: lista pasta CRIATIVOS + match por nome flexivel
                if (!vaBriefing.linkAdFileId) {
                  const criativosFolder = docR.driveLinks.find((d: any) =>
                    /criativos|criativo|videos|drive criativos/i.test(d.text || '')) ||
                    docR.driveLinks.find((d: any) => (d as any).isFolder);
                  if (criativosFolder && criativosFolder.fileId) {
                    console.log(`[clickup-pilot] VA: tentando pasta "${criativosFolder.text}" (${criativosFolder.fileId})`);
                    try {
                      const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
                      const folderRes = await listDriveFolderViaExtension(criativosFolder.fileId);
                      if (folderRes.ok) {
                        const match = folderRes.files.find((f) => fuzzyMatch(f.name));
                        if (match) {
                          vaBriefing.linkAdFileId = match.fileId;
                          console.log(`[clickup-pilot] VA: matched in folder "${match.name}" → ${match.fileId}`);
                        } else {
                          console.warn(`[clickup-pilot] VA: target nao achou na pasta (${folderRes.files.length} files):`, folderRes.files.slice(0, 8).map(f => f.name));
                        }
                      } else {
                        console.warn(`[clickup-pilot] VA: list folder falhou: ${folderRes.error}`);
                      }
                    } catch (e) {
                      console.warn(`[clickup-pilot] VA: auto-resolve threw:`, e);
                    }
                  }
                }

                // 3) Ultimo recurso: lista TODAS as pastas Drive do doc
                if (!vaBriefing.linkAdFileId) {
                  try {
                    const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
                    const folderLinks = (docR.driveLinks || []).filter((d: any) =>
                      d.fileId && d.fileId.length > 15);
                    for (const fl of folderLinks) {
                      if (!fl.fileId) continue;
                      const folderRes = await listDriveFolderViaExtension(fl.fileId);
                      if (!folderRes.ok || !folderRes.files?.length) continue;
                      const match = folderRes.files.find((f) => fuzzyMatch(f.name));
                      if (match) {
                        vaBriefing.linkAdFileId = match.fileId;
                        console.log(`[clickup-pilot] VA: matched via folder "${fl.text}": ${match.name} → ${match.fileId}`);
                        break;
                      }
                    }
                  } catch (e) {
                    console.warn(`[clickup-pilot] VA: fallback folder scan threw:`, e);
                  }
                }

                // 4) Persiste candidatos pra UI mostrar (one-click pick)
                if (!vaBriefing.linkAdFileId) {
                  (vaBriefing as any).candidateLinks = (docR.driveLinks || [])
                    .filter((d: any) => d.fileId && d.fileId.length > 15)
                    .map((d: any) => ({ text: d.text, fileId: d.fileId, isFolder: d.isFolder }));
                  console.log(`[clickup-pilot] VA: candidates expostos na UI:`, ((vaBriefing as any).candidateLinks || []).length);
                }
              }
              const siblings = siblingMap.get(task.id) || [task.id];
              setTaskAnalyses((prev) => {
                const next = { ...prev };
                for (const sid of siblings) {
                  next[sid] = {
                    ...prev[sid],
                    status: 'partial',  // VA precisa escolher avatares HeyGen antes de disparar
                    baseAdId: vaBriefing.baseAdId,
                    vaBriefing,
                    dispatchedAt: getDispatchedAt(sid),
                  };
                }
                return next;
              });
              continue;
            }
            // parseVABriefing falhou. DECISAO de roteamento:
            //  - Se o DOC tem header VA real ("Variação de avatar" na secao),
            //    e bug de parse VA de verdade → erro estruturado (NAO re-rota
            //    pro motor normal, senao geraria com engine errado).
            //  - Se a deteccao VA veio SO do NOME da task (isVATask) e o doc e
            //    uma copy NORMAL (formato GANCHO/BODY, ex AD39G1VN-VRWA02 — sem
            //    "Variação de avatar"), CAI no parser normal abaixo em vez de
            //    errar. Sem isso o hook sumia atoa numa task "VA - AD39..." cujo
            //    doc e copy comum (parseDarkoBriefing extrai hook+body certo).
            if (hasVaHeaderInSection(sectionForVaCheck)) {
              setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Task parece VA mas parser falhou em extrair avatares/hook/body' } }));
              continue;
            }
            // senao: NAO da continue — escapa do bloco VA e cai no fluxo normal.
          }
          // 3. Parse: encontra base AD ID + briefing (fluxo normal nao-VA)
          // AD ID em qualquer posicao + sufixo alfanumerico completo: a regex
          // antiga ^(AD\d+[A-Z]+)\b exigia AD no inicio do nome E falhava em
          // codigos com digito no sufixo (ex 'AD19G1GL': o '1' apos o 'G'
          // quebrava [A-Z]+\b e a task caia em 'Nome da task nao tem AD ID').
          const baseMatch = task.name.match(/\b(AD\d+[A-Z0-9]*)/i);
          const baseAdId = baseMatch ? baseMatch[1].toUpperCase() : null;
          if (!baseAdId) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Nome da task nao tem AD ID (ex AD139GL)' } }));
            continue;
          }
          // Token de variante (F2/P1/AVA05): isola a secao da variante quando o
          // doc tem varias variantes do mesmo AD — senao avatares/copy de
          // variantes diferentes vazam (bug AD14GL: F2 e P1 mostravam os mesmos
          // 2 avatares).
          const variantToken = extractVariantToken(task.name);
          // driveLinks agora carrega tambem links de YouTube (url, fileId null)
          // — passa pro parser pra ele identificar avatar por smart-chip de
          // YouTube ("Doutora: 🎥 O IMPACTO DO ESTRESSE...") e montar a thumb.
          // DR MILLION: doc bilíngue PT/PL, com o "Body" DEPOIS dos hooks e
          // compartilhado pelo grupo (AD07G1/G2/G3 → mesmo corpo). O parser
          // padrão fecha a seção no próximo heading e por isso não achava o
          // corpo, além de ler os dois idiomas grudados. Só entra aqui quando
          // o doc TEM essa estrutura — doc do B2C nunca tem, então o fluxo de
          // sempre segue idêntico.
          const ehDrMillion = isDrMillionFormat(docR.text, baseAdId);
          const briefing = ehDrMillion
            ? parseDrMillionBriefing(docR.text, baseAdId, drLangRef.current)
            : parseDarkoBriefing(docR.text, baseAdId, variantToken, docR.driveLinks || []);
          if (ehDrMillion) {
            const langs = idiomasDisponiveis(docR.text, baseAdId);
            setTaskAnalyses((prev) => ({
              ...prev,
              [task.id]: { ...prev[task.id], drMillion: true, drLangs: langs },
            }));
          }
          if (!briefing || (briefing.hooks.length === 0 && !briefing.body)) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: `Parser nao achou hooks nem body pra ${baseAdId} no doc` } }));
            continue;
          }
          // 3.5. Resolve Drive file IDs pros avatares (pra visual match futuro).
          // Preserva o videoFileId/youtubeUrl que o parser ja resolveu por link.
          for (const av of briefing.avatars) {
            // Avatar de YouTube NAO tem arquivo no Drive — o username e o video
            // ID e casaria links numericos por acaso (thumb errada). Pula.
            // Avatar por IMAGEM embutida tambem nao tem arquivo nem username.
            if (av.youtubeUrl || av.imageUrl) continue;
            const fid = av.videoFileId || resolveVideoFileId(av.username, docR.driveLinks);
            if (fid) { av.videoFileId = fid; continue; }
            // SEM arquivo de Drive: o chip ".mp4" pode na verdade apontar pra um
            // link de YouTube (o editor renomeia o chip pra "<handle>.mp4" mas o
            // href e do YouTube). Acha o link de YT cujo texto casa o username e
            // anexa youtube+thumb — senao o avatar ficaria "sem link"/sem thumb.
            const yt = resolveYouTubeFromLinks(av.username, docR.driveLinks);
            if (yt) { av.youtubeUrl = yt.url; av.thumbUrl = yt.thumb; }
          }
          // 4. Monta roleSlots — UM por avatar do briefing, mesmo se sem match
          //    Order de prioridade pra fechar o slot:
          //    a) matchAvatar score >= 30 (voice_name_exact / name match / fuzzy)
          //    b) memoria voice↔avatar (user ja pareou voz `@x` com avatar Y antes)
          //    c) voiceLibrary lookup: voz `@x` existe no HeyGen mas user nao pareou
          //       ainda — usa como voiceOverride pro slot (avatar ainda pendente)
          //    d) pendente sem voz
          // AVATAR ESCOLHIDO NA MÃO SOBREVIVE À RE-ANÁLISE.
          // Re-analisar recria a análise do zero. Sem isto, trocar o idioma
          // (que reanalisa pra copy vir em PL/PT) apagava o avatar que você
          // acabou de escolher — e o DR MILLION SEMPRE depende desse avatar
          // manual, porque o doc não traz nenhum. Só repõe quando o parser
          // não achou avatar sozinho; no B2C, onde ele acha, nada muda.
          const slotsManuaisAnteriores = manuaisAntes.get(task.id) || [];
          const roleSlots: RoleSlot[] = [];
          for (const av of briefing.avatars) {
            const briefingFileId = av.videoFileId || null;
            // Avatar por link de YouTube (smart-chip "🎥 título") — mostra a
            // thumb do vídeo de referência mesmo sem arquivo no Drive.
            const youtubeUrl = av.youtubeUrl || null;
            // Thumb de referência do briefing: YouTube OU imagem embutida (print
            // colado no doc). Ambas mostram quem o copy quer, sem arquivo Drive.
            const imageThumb = av.imageUrl || null;
            const youtubeThumb = av.thumbUrl || imageThumb || null;
            // Avatar de YouTube (username = video ID) OU por IMAGEM (sem username):
            // NAO casa com a biblioteca (matchAvatar casaria errado por substring,
            // e imagem nem tem username) nem voz por nome — fica PENDENTE pro user
            // escolher o avatar vendo a referência.
            const noAutoMatch = youtubeUrl || imageThumb;
            const m = noAutoMatch ? null : matchAvatar(av.username, avatarCandidates);
            // Voz auto-resolvida da biblioteca por nome (independente de match de avatar)
            const voiceFromLib = noAutoMatch ? null : (voiceByNorm.get(normalizeVoiceName(av.username)) || null);
            if (m && m.score >= 30) {
              const candFull = avatarCandidates.find(c => c.id === m.id);
              // MEMORIA AVATAR→VOZ: se ja escolhi voz pra esse avatar antes,
              // ela volta automatica (prioridade sobre voz por nome).
              const avMem = recallAvatarVoice(m.id);
              roleSlots.push({
                role: av.role,
                username: av.username,
                briefingFileId,
                youtubeUrl,
                youtubeThumb,
                imageThumb,
                avatarId: m.id,
                avatarName: m.name,
                avatarThumb: candFull?.thumb || null,
                avatarVoiceId: candFull?.voiceId || null,
                voiceOverride: avMem
                  ? { id: avMem.voiceId, name: avMem.voiceName }
                  : (!candFull?.voiceId && voiceFromLib ? voiceFromLib : null),
                matchedBy: m.matchedBy || 'fuzzy',
              });
              continue;
            }
            // (b) Tenta memoria: copy diz @x.mp4 → busca memoria pra voz "x"
            const recalled = recallByVoiceName(av.username);
            if (recalled) {
              // Confirma que avatar ainda existe na biblioteca
              const candFull = avatarCandidates.find(c => c.id === recalled.avatarId);
              if (candFull) {
                const avMem = recallAvatarVoice(recalled.avatarId);
                roleSlots.push({
                  role: av.role,
                  username: av.username,
                  briefingFileId,
                  youtubeUrl,
                  youtubeThumb,
                  imageThumb,
                  avatarId: recalled.avatarId,
                  avatarName: recalled.avatarName,
                  avatarThumb: candFull.thumb || null,
                  avatarVoiceId: recalled.voiceId,
                  voiceOverride: avMem ? { id: avMem.voiceId, name: avMem.voiceName } : null,
                  matchedBy: 'memory',
                });
                continue;
              }
            }
            // (c)/(d) Pendente de avatar — mas se voz "@x" existe na lib,
            //          ja pre-seleciona como override (user so precisa achar avatar)
            roleSlots.push({
              role: av.role,
              username: av.username,
              briefingFileId,
              youtubeUrl,
              youtubeThumb,
              imageThumb,
              avatarId: null,
              avatarName: null,
              avatarThumb: null,
              avatarVoiceId: null,
              voiceOverride: voiceFromLib,
              matchedBy: null,
            });
          }
          // Parser não achou avatar nenhum e você já tinha escolhido um na
          // mão? Ele volta — com avatar e voz. É o que faz trocar de idioma
          // no DR MILLION não jogar sua escolha fora.
          if (roleSlots.length === 0 && slotsManuaisAnteriores.length > 0) {
            roleSlots.push(...slotsManuaisAnteriores);
          }
          // partTemplates: cada parte tem um 'matchByRole' — qual role preencher
          // na hora de gerar o plan final.
          //
          // Estrategia (em ordem de prioridade):
          //   1. detectedRole do parser (linha "Mulher:"/"Homem:"/"Voz do Homem:" do briefing
          //      — descartada do texto pra TTS, mas preservada como metadata)
          //   2. Label da parte contem nome do role (ex BODY HOMEM)
          //   3. Primeiras 2 linhas do texto mencionam o role (legacy)
          //   4. Primeiro role do briefing (fallback fraco)
          const firstRole = roleSlots[0]?.role.toLowerCase() || null;
          function pickRoleForText(text: string, label: string, detectedRole: string | null, username: string | null = null): string | null {
            // 0) username do segmento (chip/filename do avatar no body) —
            //    autoritativo: casa direto com o slot do avatar declarado.
            if (username) {
              const uk = normAvatarKey(username);
              if (uk) {
                for (const slot of roleSlots) {
                  if (normAvatarKey(slot.username) === uk) return slot.role.toLowerCase();
                }
              }
            }
            if (detectedRole) {
              const dr = detectedRole.toLowerCase().trim();
              // Match exato primeiro
              for (const slot of roleSlots) {
                if (slot.role.toLowerCase().trim() === dr) return slot.role.toLowerCase();
              }
              // Fuzzy: detectedRole contem ou e contido por slot.role
              // (ex "Voz do Homem" vs "Voz do Homem", "Homem" vs "Homem")
              for (const slot of roleSlots) {
                const sl = slot.role.toLowerCase().trim();
                if (sl.includes(dr) || dr.includes(sl)) return slot.role.toLowerCase();
              }
            }
            const ll = label.toLowerCase();
            for (const slot of roleSlots) {
              if (ll.includes(slot.role.toLowerCase())) return slot.role.toLowerCase();
            }
            const fl = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
            for (const slot of roleSlots) {
              if (fl.includes(slot.role.toLowerCase())) return slot.role.toLowerCase();
            }
            return firstRole;
          }
          const partTemplates: TaskAnalysis['partTemplates'] = [];
          for (const h of briefing.hooks) {
            partTemplates.push({ label: h.label, text: h.text, matchByRole: pickRoleForText(h.text, h.label, h.role) });
          }
          // Body segmentado por SPEAKER (cada role vira sub-bloco). Dentro
          // de cada segmento, split por tempo (~20s) preservando o role.
          // CRITICAL: split nao MUDA speaker — cada part herda o role do
          // segmento de origem, NUNCA cruza com texto de outro speaker.
          const segs = briefing.bodySegments && briefing.bodySegments.length > 0
            ? briefing.bodySegments
            : (briefing.body ? [{ role: briefing.bodyRole, text: briefing.body }] : []);
          let bodyIdx = 0;
          const totalSegs = segs.length;
          for (let si = 0; si < segs.length; si++) {
            const seg = segs[si];
            const segParts = splitCopyIntoParts(seg.text, { targetSec: 20, minSec: 10, maxSec: 35 });
            for (let pi = 0; pi < segParts.length; pi++) {
              bodyIdx++;
              // Label: BODY (1 part total), BODY N (multi parts mesmo speaker),
              // BODY S.P (multi speakers — S=segment idx, P=part idx)
              const label = (totalSegs === 1 && segParts.length === 1)
                ? 'BODY'
                : (totalSegs === 1)
                  ? `BODY ${pi + 1}`
                  : (segParts.length === 1)
                    ? `BODY ${si + 1}`
                    : `BODY ${si + 1}.${pi + 1}`;
              partTemplates.push({
                label,
                text: segParts[pi],
                matchByRole: pickRoleForText(segParts[pi], label, seg.role, (seg as any).username ?? null),
                // De QUEM é essa fala — o "Carregar plano" usa pra dar cada
                // bloco à cena da pessoa certa (ver repartirPorFalante).
                speaker: seg.role ?? null,
              });
            }
          }
          const bodyPartsCount = bodyIdx;
          // REDE DE SEGURANÇA: a copy do idioma escolhido saiu inteira nos
          // takes? Os filtros do parser tiram o que não é fala, e um filtro
          // errado comeria copy sem que contagem, avatar ou voz denunciassem.
          // Se faltar, a task mostra o trecho perdido em vermelho.
          const copyFaltando = ehDrMillion
            ? conferirCoberturaDaCopy(docR.text, baseAdId, drLangRef.current, partTemplates.map((p) => p.text)).faltando
            : [];
          const allHaveAvatar = roleSlots.every(slotPronto);
          // Propaga o mesmo resultado pra TODAS siblings G1/G2 do grupo
          // (compartilham o doc — ja analisamos uma vez).
          const siblings = siblingMap.get(task.id) || [task.id];
          setTaskAnalyses((prev) => {
            const next = { ...prev };
            for (const sid of siblings) {
              next[sid] = {
                ...prev[sid],
                // Only Magnific nao gera lipsync — avatares sao irrelevantes,
                // basta a copy do doc. Marca ready mesmo sem avatar.
                status: onlyMagnificMode || allHaveAvatar ? 'ready' : 'partial',
                baseAdId,
                hookCount: briefing.hooks.length,
                bodyPartsCount,
                totalParts: partTemplates.length,
                roleSlots,
                partTemplates,
                copyFaltando,
                bodyRaw: briefing.body || undefined,
                dispatchedAt: getDispatchedAt(sid),
                // Marca siblings como "compartilhada com primary"
                sharedWithPrimaryId: sid === task.id ? undefined : task.id,
              };
            }
            return next;
          });
        } catch (e) {
          // Erro propaga pra todos siblings tambem
          const siblings = siblingMap.get(task.id) || [task.id];
          setTaskAnalyses((prev) => {
            const next = { ...prev };
            for (const sid of siblings) {
              next[sid] = { ...prev[sid], status: 'error', error: (e as Error)?.message || 'erro' };
            }
            return next;
          });
        }
      }
    }
    const workers = Array.from({ length: PARALLEL }, () => worker());
    await Promise.all(workers);

    // DR MILLION: os hooks do mesmo AD viram UM card só.
    // Eles são o mesmo anúncio — muda só o gancho — e ver um card por hook
    // levava a escolher avatar diferente em cada um, o que além de confundir
    // MATA o reuso do corpo (a chave inclui avatar+voz). As tasks continuam
    // existindo e sendo disparadas uma a uma, com o nome de arquivo de cada
    // uma; some apenas o card repetido. Mesmo mecanismo que o B2C já usa pra
    // agrupar G1+G2 (sharedWithPrimaryId) — aqui só ensinamos a enxergar o
    // padrão do DR MILLION, onde a variante vive DENTRO do código (AD07G1GL).
    setTaskAnalyses((prev) => {
      const next = { ...prev };
      const liderDoGrupo = new Map<string, string>();
      let mudou = false;
      for (const t of allSelected) {
        const a = next[t.id];
        if (!a?.drMillion || a.status === 'error') continue;
        const grupo = adGroupOf(a.baseAdId || a.taskName);
        if (!grupo) continue;
        const lider = liderDoGrupo.get(grupo);
        if (!lider) {
          liderDoGrupo.set(grupo, t.id);
          if (a.sharedWithPrimaryId) { next[t.id] = { ...a, sharedWithPrimaryId: undefined }; mudou = true; }
        } else if (a.sharedWithPrimaryId !== lider) {
          next[t.id] = { ...a, sharedWithPrimaryId: lider };
          mudou = true;
        }
      }
      return mudou ? next : prev;
    });

    setAnalyzing(false);
  }

  /** Batch state — tasks rodando em background (dispatch + poll + download + zip) */
  const [batchStates, setBatchStates] = useState<Record<string, BatchTaskState>>({});
  const batchCancelRef = useRef<Record<string, boolean>>({});
  /** Espelho de batchStates pra leitura SINCRONA fora do ciclo de render
   *  (watchdog/promoter por interval). Sem isso o watchdog leria closure
   *  velho e nunca veria tasks novas na fila. */
  const batchStatesRef = useRef<Record<string, BatchTaskState>>({});
  batchStatesRef.current = batchStates;

  /** Semafaro de slots HeyGen (in-memory). Cresce quando um wrapper
   *  gated PEGA o slot (acquireSlot ok) e decresce no finally. Sempre
   *  reflete o numero REAL de runs ativos nesta aba — independente do
   *  batchStates (que pode estar com phase 'queued' por race). */
  const heygenSlotsRef = useRef<number>(0);
  /** Dedup de wrappers gated por taskId. Se ja ha um wrapper esperando
   *  vaga pra essa task, segundo clique e no-op (idempotente). */
  const heygenPendingRef = useRef<Record<string, 'run' | 'resume'>>({});
  // rank 17: se o user clica Retomar enquanto o run ANTERIOR ainda está encerrando
  // (heygenPendingRef preso), o clique era descartado em silêncio (Retomar "não fazia
  // nada"). Aqui guardamos a intenção; o finally do run que está saindo re-dispara.
  const pendingRetomarRef = useRef<Record<string, 'run' | 'resume'>>({});
  // Guard de reentrância do pipeline de TROCA: com queuedRecoverable, o Retomar/Debug
  // de uma troca ainda enfileirada na fila serial pode ser clicado enquanto o loop
  // ainda vai chegar nela → 2 runs concorrentes do MESMO taskId. Este ref impede.
  const runningTrocaRef = useRef<Record<string, boolean>>({});
  // AUTO-CURA de "done mas INCOMPLETO": a montagem (ffmpeg-wasm no navegador) falha de
  // forma INTERMITENTE — a task chega em 'done' mas o gate segura como incompleta
  // (okMontagens<esperado). Antes o user clicava Retomar 3x na mão ("morre no done").
  // Aqui re-tentamos AUTOMÁTICO até 2x: o resume reaproveita o cache do IDB (partes que
  // já deram certo) e refaz só o que faltou, então cada tentativa tende a passar. Cap
  // rígido por task; se esgotar (falha determinística), para e deixa pro user decidir.
  const autoResumeCountRef = useRef<Record<string, number>>({});
  // Timestamp da última auto-tentativa por task (fix 2026-07-03): habilita o
  // RE-ARME por tempo — em vez de estacionar pra sempre após 2 tentativas, dá
  // novas chances espaçadas (backoff) até um teto maior. Assim uma causa
  // AMBIENTAL transitória (IDB travado por outra aba que depois solta) se cura
  // sozinha, sem o user clicar. Causa determinística ainda para (teto global).
  const autoResumeLastRef = useRef<Record<string, number>>({});
  // TICKER do backoff (fix 2026-07-03): o nowTick só vive com task RODANDO — uma
  // 'done' incompleta parada sozinha não o manteria, e o tail com backoff nunca
  // re-avaliaria. Este pulso de 20s vive ENQUANTO houver 'done' não-entregue
  // (fora cota) → garante que a re-tentativa espaçada dispara mesmo com a aba
  // ociosa. Para sozinho quando nada mais precisa curar (sem re-render à toa).
  const [healTick, setHealTick] = useState(0);
  useEffect(() => {
    const hasHealPending = Object.values(batchStates).some((b) =>
      b.phase === 'done' && b.kind !== 'troca' && !b.isVA && b.deliveryOk !== true
      && !/limite di[aá]rio|daily limit|quota|usage.*exceeded/i.test(b.message || ''));
    if (!hasHealPending) return;
    const id = setInterval(() => setHealTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, [batchStates]);
  useEffect(() => {
    const now = Date.now();
    for (const b of Object.values(batchStates)) {
      if (b.phase !== 'done' || b.kind === 'troca' || b.isVA) continue; // VA/troca têm completion própria
      const ps = b.pipeStats;
      // COTA: 'done' esperando reset diário do HeyGen NÃO é curável agora (a cota
      // segue morta) — só o RETOMAR manual/restore pós-reset re-dispara. Pula.
      const isQuotaWait = /limite di[aá]rio|daily limit|daily quota|quota|usage.*exceeded/i.test(b.message || '');
      if (isQuotaWait) continue;
      // ELEGÍVEL pra cura = 'done' que NÃO entregou de verdade. Dois casos:
      //  (a) tem pipeStats mas pipeOk=false (montagem/decup/camo incompleta);
      //  (b) NÃO tem pipeStats — gate incompleto (não-cota) ou 'pipeline FATAL'
      //      (antes ERAM invisíveis à auto-cura → estacionavam). deliveryOk===true
      //      nunca cai aqui (entrega confirmada).
      let needsHeal: boolean;
      if (ps) {
        const pipeOk = ps.expectedMontagens > 0
          && ps.okMontagens === ps.expectedMontagens
          && (!ps.expectedDecupagem || ps.okDecupados === ps.expectedMontagens)
          && (!ps.expectedCamuflagem || ps.okCamuflados === ps.expectedMontagens);
        if (pipeOk) { if (autoResumeCountRef.current[b.taskId]) autoResumeCountRef.current[b.taskId] = 0; continue; }
        needsHeal = true;
      } else {
        needsHeal = b.deliveryOk !== true; // sem pipeStats: cura salvo se já confirmada
      }
      if (!needsHeal) continue;
      if (heygenPendingRef.current[b.taskId]) continue;       // já rodando/enfileirado
      const n = autoResumeCountRef.current[b.taskId] || 0;
      const FAST_TRIES = 2;   // 1ªs tentativas imediatas (reaproveitam cache IDB, tendem a passar)
      const MAX_TRIES = 6;    // teto global — causa determinística não loopa infinito
      if (n >= MAX_TRIES) continue;
      // Após as tentativas rápidas, ESPAÇA com backoff (5min, 10, 20, 40… teto 30min).
      if (n >= FAST_TRIES) {
        const last = autoResumeLastRef.current[b.taskId] || 0;
        const wait = Math.min(30 * 60_000, 5 * 60_000 * Math.pow(2, n - FAST_TRIES));
        if (now - last < wait) continue;
      }
      autoResumeCountRef.current[b.taskId] = n + 1;
      autoResumeLastRef.current[b.taskId] = now;
      console.warn(`[auto-cura] ${b.taskId}: 'done' incompleto → auto-Retomar (${n + 1}/${MAX_TRIES}${n >= FAST_TRIES ? ', backoff' : ''}, reaproveita cache IDB)`);
      retomarTaskBatch(b.taskId);
    }
    // healTick força re-avaliação periódica pro backoff disparar com aba ociosa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStates, healTick]);

  /** Restore persisted batch states no mount. Tudo que estava ATIVO
   *  (dispatching/rendering/downloading/post) OU ja em 'queued' antes
   *  do reload volta como 'queued' — o promoter useEffect re-dispara
   *  ate MAX_HEYGEN_PARALLEL automaticamente. Sem clique manual.
   *
   *  Por que NAO 'failed': videos podem ja ter sido submitted no HeyGen
   *  (videoIds salvos em parts[]) — re-poll vai pegar eles prontos em
   *  segundos. Marcar failed forcaria user a clicar Retomar em cada um.
   *
   *  'done'/'failed' antigos sao preservados como estavam — user decide
   *  se Retomar ou nao. */
  useEffect(() => {
    const persisted = loadPersistedBatchStates() as Record<string, BatchTaskState>;
    if (Object.keys(persisted).length === 0) return;
    const restored: Record<string, BatchTaskState> = {};
    let interruptedCount = 0;
    const doneTaskIds: string[] = [];
    for (const [taskId, state] of Object.entries(persisted)) {
      // Fila do Hey Auto vive na mesma chave — o Pilot NÃO exibe nem processa
      // os disparos do Hey Auto ('heygenauto:*'). Cada tool tem sua lista.
      if (taskId.startsWith('heygenauto:')) continue;
      const wasInterrupted = state.phase !== 'done' && state.phase !== 'failed';
      if (wasInterrupted && state.kind === 'troca') {
        // TROCA: o WHITE foi salvo no IndexedDB + driveId no proprio state —
        // retomar reconstroi tudo. So nao auto-roda (evita FFmpeg a cada F5).
        restored[taskId] = {
          ...state,
          phase: 'failed',
          message: 'Recarregou a página — áudio preservado. Clique em Retomar pra concluir.',
          finishedAt: Date.now(),
        };
      } else if (wasInterrupted) {
        interruptedCount++;
        restored[taskId] = {
          ...state,
          phase: 'queued',
          message: '⏳ Re-iniciando apos reload — checkpoint preservado, retomando do ponto certo...',
          finishedAt: undefined,
        };
      } else {
        restored[taskId] = state;
        if (state.phase === 'done') doneTaskIds.push(taskId);
      }
    }
    setBatchStates(restored);
    if (interruptedCount > 0) {
      console.info(`[batch restore] ${interruptedCount} batch(es) interrompidos — re-enfileirados pro promoter.`);
    }

    // REIDRATAÇÃO VA (sobrevive RELOAD/RESTART do PC): pra CADA task VA que tem
    // snapshot persistido (do disparo), repõe o estado que o runner precisa
    // (vaBriefing em taskAnalyses + escolhas avatar/voz + adUrl + transcript/
    // roleText + roteamento). Cobre TODAS as fases — não só as reenfileiradas:
    // uma VA 'done'/'failed' também precisa do briefing de volta pra o RETOMAR
    // funcionar (sem isto, RETOMAR após um hard-refresh morria em "briefing nao
    // sobrevive reload", justamente quando o user atualiza a página pra pegar
    // código novo). Roda no MESMO tick do setBatchStates → quando o RETOMAR/
    // promoter chama runVAPipelineForTask, tudo já está no lugar. Sem snapshot
    // (task antiga) → comportamento de antes. NÃO auto-dispara: o dispatch exige
    // seleção do user; aqui só repomos o que sumiu pra o RETOMAR não falhar.
    {
      const taPatch: Record<string, any> = {};
      const avChoices: Record<string, unknown> = {};
      const voChoices: Record<string, unknown> = {};
      const moPrompts: Record<string, unknown> = {};
      const adUrls: Record<string, string> = {};
      const transcripts: Record<string, unknown> = {};
      const rTexts: Record<string, string> = {};
      const teOverride: Record<string, boolean> = {};
      let vaRehydrated = 0;
      for (const [taskId, st] of Object.entries(restored)) {
        if (!st.isVA) continue;
        const snap = loadVAResumeSnapshot(taskId);
        if (!snap?.vaBriefing) continue;
        taPatch[taskId] = {
          taskId, taskName: snap.taskName, baseAdId: snap.baseAdId,
          docUrl: snap.docUrl ?? undefined, taskUrl: snap.taskUrl ?? undefined,
          status: 'partial', vaBriefing: snap.vaBriefing,
        };
        Object.assign(avChoices, snap.avatarChoices || {});
        Object.assign(voChoices, snap.voiceChoices || {});
        Object.assign(moPrompts, snap.motionPrompts || {});
        if (snap.adUrl) adUrls[taskId] = snap.adUrl;
        if (snap.fileId && snap.transcript) transcripts[snap.fileId] = snap.transcript;
        Object.assign(rTexts, snap.roleTexts || {});
        if (typeof snap.usesTextEngine === 'boolean') teOverride[taskId] = snap.usesTextEngine;
        vaRehydrated++;
      }
      if (vaRehydrated > 0) {
        // prev tem prioridade: nunca sobrescreve uma análise/escolha FRESCA que o
        // user fez depois (merge é só pro estado que sumiu no restart).
        setTaskAnalyses((prev) => ({ ...taPatch, ...prev }) as typeof prev);
        setVaAvatarChoice((prev) => ({ ...(avChoices as typeof prev), ...prev }));
        setVaVoiceChoice((prev) => ({ ...(voChoices as typeof prev), ...prev }));
        setVaMotionPrompt((prev) => ({ ...(moPrompts as typeof prev), ...prev }));
        setVaAdUrl((prev) => ({ ...adUrls, ...prev }));
        setVaTranscript((prev) => ({ ...(transcripts as typeof prev), ...prev }));
        setVaRoleText((prev) => ({ ...rTexts, ...prev }));
        setVaTextEngineOverride((prev) => ({ ...teOverride, ...prev }));
        console.info(`[batch restore] ${vaRehydrated} task(s) VA reidratada(s) do snapshot — resume após restart OK.`);
      }
    }

    // REIDRATAÇÃO TROCA (rank 18 + rank 9): o pipeline da troca já sobrevive ao F5
    // (lê driveId/volume do batchState persistido + WHITE do IDB), MAS o painel de
    // config da troca lê a.trocaBriefing de taskAnalyses (que some no reload) → o user
    // não conseguia reajustar volume/link antes de Retomar. Repõe um taskAnalyses
    // mínimo com o trocaBriefing reconstruído dos campos persistidos. E torna a
    // mensagem do card HONESTA: se o WHITE não está no IDB, pede pra re-subir em vez
    // de prometer "áudio preservado" (que era mentira quando o upload não persistiu).
    {
      const taPatchTroca: Record<string, any> = {};
      for (const [taskId, st] of Object.entries(restored)) {
        if (st.kind !== 'troca') continue;
        taPatchTroca[taskId] = {
          taskId, taskName: st.taskName, baseAdId: st.baseAdId,
          taskUrl: st.taskUrl ?? undefined, status: 'partial',
          trocaBriefing: {
            baseAdId: st.baseAdId,
            driveId: st.trocaDriveId,
            driveFolderUrl: st.trocaOutputFolderUrl,
          },
        };
      }
      if (Object.keys(taPatchTroca).length > 0) {
        // prev tem prioridade (não sobrescreve análise fresca do user).
        setTaskAnalyses((prev) => ({ ...taPatchTroca, ...prev }) as typeof prev);
      }
      // Mensagem honesta: checa o WHITE no IDB (async) e corrige o card das trocas
      // interrompidas que NÃO têm mais o áudio.
      void (async () => {
        try {
          const { loadBlob } = await import('@/lib/zip-store');
          for (const [taskId, st] of Object.entries(restored)) {
            if (st.kind !== 'troca' || st.phase !== 'failed') continue;
            let w: Blob | null = null;
            try { w = await loadBlob('troca:white:' + taskId, st.trocaWhiteMime || 'audio/wav'); } catch {}
            if (!w) {
              setBatchStates((prev) => {
                const cur = prev[taskId];
                if (!cur || cur.phase !== 'failed') return prev;
                return { ...prev, [taskId]: { ...cur, message: 'Recarregou a página — re-suba o áudio WHITE dessa task e clique Retomar.' } };
              });
            }
          }
        } catch { /* best-effort */ }
      })();
    }

    // HIDRATAÇÃO BLOB URLs (fix 2026-05-30):
    // persistBatchStates DESCARTA zipBlobUrl/montadoZipUrl/camufladoZipUrl
    // (Blob URLs nao sobrevivem reload). Apos restaurar, os ZIPs reais
    // estao em IndexedDB sob as chaves batch:{taskId}:{takes,montado,camo}.
    // Carrega esses blobs + cria novas URLs, patcha no state. Sem isso,
    // batch 'done' apos reload nao mostra botoes de download.
    if (doneTaskIds.length > 0) {
      void (async () => {
        try {
          const { loadZip } = await import('@/lib/zip-store');
          // RETRY (fix 2026-07-03): o IDB pode estar TRAVADO por outra aba no
          // 1º instante do load — loadZip volta null/lança e, sem re-tentar, a
          // URL blob ficava pra sempre sem hidratar → task PRONTA sem botão de
          // download (bug AD44GL). Re-tenta poucas vezes com gap curto; só paga
          // o custo a chave que de fato falhou (o caso normal acerta de 1ª).
          // O botão de download AINDA funciona sem isto (loadDeliverables lê o
          // IDB no clique) — este retry é pra o botão/preview voltarem sozinhos.
          const loadZipRetry = async (key: string, tries = 3) => {
            for (let i = 1; i <= tries; i++) {
              try {
                const z = await loadZip(key);
                if (z) return z;
              } catch (e) { if (i === tries) console.warn('[batch restore]', key, e); }
              if (i < tries) await new Promise((r) => setTimeout(r, 300 * i));
            }
            return null;
          };
          for (const taskId of doneTaskIds) {
            const updates: Partial<BatchTaskState> = {};
            const t = await loadZipRetry(`batch:${taskId}:takes`);
            if (t) { updates.zipBlobUrl = t.blobUrl; updates.zipFilename = t.filename; }
            const m = await loadZipRetry(`batch:${taskId}:montado`);
            if (m) { updates.montadoZipUrl = m.blobUrl; updates.montadoZipName = m.filename; }
            // VA (texto E lipsync) salva o resultado em `va:<taskId>:zip` (chave
            // diferente do batch normal). Sem re-hidratar isso, uma VA PRONTA
            // perdia o montadoZipUrl no F5 → o card caía em "INCOMPLETO" (o
            // pipeOk da VA é phase==='done' && !!montadoZipUrl). Fallback só se o
            // batch:montado não veio (não sobrescreve o normal).
            if (!updates.montadoZipUrl) {
              const v = await loadZipRetry(`va:${taskId}:zip`);
              if (v) { updates.montadoZipUrl = v.blobUrl; updates.montadoZipName = v.filename; }
            }
            const c = await loadZipRetry(`batch:${taskId}:camo`);
            if (c) { updates.camufladoZipUrl = c.blobUrl; updates.camufladoZipName = c.filename; }
            if (Object.keys(updates).length === 0) continue;
            setBatchStates((prev) => {
              const cur = prev[taskId];
              if (!cur) return prev;
              return { ...prev, [taskId]: { ...cur, ...updates } as BatchTaskState };
            });
          }
        } catch (e) {
          console.warn('[batch restore] hidratacao blob URLs falhou:', e);
        }
      })();
    }
  }, []);

  /** FAXINA do IndexedDB (LRU por disparo) — sem isto o `darkolab-zip-store`
   *  cresce sem teto e trava o Chrome com o tempo (medido: 223 blobs / 1,58 GB →
   *  boot de 70s; o Firefox mascarava por ter banco separado por origem). Roda UMA
   *  vez, ~10s após montar (fora do caminho crítico do boot/entrega). Protege o
   *  disparo ATIVO (qualquer phase != done/failed) + tudo recente/últimos N — só
   *  remove disparo VELHO e concluído. Ver [[project_disco_c_limpeza]] /
   *  lib/zip-store-prune.ts. */
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        try {
          const persisted = loadPersistedBatchStates() as Record<string, BatchTaskState>;
          const protect = Object.entries(persisted)
            .filter(([, s]) => s.phase !== 'done' && s.phase !== 'failed')
            .map(([id]) => id);
          const { pruneZipStore } = await import('@/lib/zip-store');
          const r = await pruneZipStore({ protect });
          if (r && r.evicted > 0) {
            console.info(
              `[zip-store] faxina: ${r.evicted} blob(s) de disparo antigo removidos ` +
              `(~${(r.freedBytes / 1048576).toFixed(0)} MB liberados), ${r.keptGroups} disparo(s) preservados.`,
            );
          }
        } catch (e) {
          console.warn('[zip-store] faxina ignorada:', e);
        }
      })();
    }, 10_000);
    return () => clearTimeout(t);
  }, []);

  /** Persist batchStates a cada mudanca pra sobreviver reload. */
  useEffect(() => {
    persistBatchStates(batchStates);
  }, [batchStates]);

  /** Backfill da EMPRESA (workspace) nos cards da fila.
   *
   *  Cada card mostra um disparo, e disparo de uma empresa não pode aparecer
   *  enquanto você trabalha na outra. Batches antigos não guardavam de quem
   *  eram, então perguntamos ao ClickUp — GET /task/{id} devolve `team_id` —
   *  uma vez por task, e carimbamos.
   *
   *  Enquanto não resolve, o card CONTINUA visível: sumir com um disparo em
   *  andamento é bem pior do que mostrá-lo na empresa errada por um instante.
   *  O ref de tentativas evita repetir request pra task que falhou/não
   *  respondeu (o effect roda a cada mudança de batchStates). */
  const teamBackfillTriedRef = useRef<Set<string>>(new Set());
  /** Trava de execução única. O effect depende de `batchStates`, e carimbar
   *  MUDA batchStates — sem esta trava (e com um cleanup abortando o loop) a
   *  rotina se cancelava na primeira volta e, como as tasks já estavam
   *  marcadas como tentadas, nunca mais voltava. */
  const teamBackfillRunningRef = useRef(false);
  useEffect(() => {
    if (!hasToken || teamBackfillRunningRef.current) return;
    const pendente = (b: BatchTaskState | undefined) =>
      !!b &&
      !!b.taskId &&
      !b.teamId &&
      !b.taskId.startsWith('heygenauto:') &&
      !teamBackfillTriedRef.current.has(b.taskId);
    if (!Object.values(batchStatesRef.current).some(pendente)) return;
    teamBackfillRunningRef.current = true;
    void (async () => {
      try {
        // Relê o ref a cada volta (não uma lista congelada): batches que
        // chegarem no meio do caminho entram nesta mesma passada.
        for (let i = 0; i < 40; i++) {
          const alvo = Object.values(batchStatesRef.current).find(pendente);
          if (!alvo) break;
          teamBackfillTriedRef.current.add(alvo.taskId);
          try {
            const det = await getTask(alvo.taskId);
            const tid = det?.team_id ? String(det.team_id) : null;
            if (!tid) continue;
            setBatchStates((prev) =>
              prev[alvo.taskId] && !prev[alvo.taskId].teamId
                ? { ...prev, [alvo.taskId]: { ...prev[alvo.taskId], teamId: tid } }
                : prev,
            );
          } catch {
            /* sem carimbo: o card segue visível em qualquer empresa */
          }
        }
      } finally {
        teamBackfillRunningRef.current = false;
      }
    })();
  }, [batchStates, hasToken]);

  /** Fila da EMPRESA ativa — é ela que vai pra tela. Batch ainda sem carimbo
   *  entra também (ver backfill acima). A EXECUÇÃO não é filtrada: disparo do
   *  B2C continua rodando enquanto você olha o DR MILLION, só não aparece. */
  const batchStatesDaEmpresa = useMemo(() => {
    const out: Record<string, BatchTaskState> = {};
    for (const [id, b] of Object.entries(batchStates)) {
      if (!b.teamId || !selectedTeam || b.teamId === selectedTeam) out[id] = b;
    }
    return out;
  }, [batchStates, selectedTeam]);

  /** Disparos rodando NAS OUTRAS empresas — some da lista, mas você precisa
   *  saber que continuam de pé. Vira um aviso discreto no painel. */
  const batchesEmOutrasEmpresas = useMemo(() => {
    if (!selectedTeam) return [] as BatchTaskState[];
    return Object.values(batchStates).filter(
      (b) => b.teamId && b.teamId !== selectedTeam && b.phase !== 'done' && b.phase !== 'failed',
    );
  }, [batchStates, selectedTeam]);

  /** Backfill do snapshot de CANAL nos cards da fila quando o board carrega.
   *  Cards criados antes do board (ou de versoes antigas) ficam sem
   *  `channels`; aqui preenchemos uma vez por task, persistindo no batch.
   *  Guard de igualdade evita loop de render. */
  useEffect(() => {
    if (!tasks.length) return;
    setBatchStates((prev) => {
      let changed = false;
      const next: Record<string, BatchTaskState> = {};
      for (const [id, b] of Object.entries(prev)) {
        if (b.channels && b.channels.length) { next[id] = b; continue; }
        const task = tasks.find((t) => t.id === id);
        const ch = task ? resolveChannels(task) : [];
        if (ch.length > 0) { next[id] = { ...b, channels: ch }; changed = true; }
        else { next[id] = b; }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  /** Escuta flags de cancelamento vindos da pagina /tools/background.
   *  Quando user clica "Cancelar" la, gravamos taskId em
   *  localStorage['darkolab:clickup-pilot:cancel'] — aqui pegamos pelo
   *  storage event (entre abas) ou pelo polling abaixo. */
  useEffect(() => {
    const CANCEL_KEY = 'darkolab:clickup-pilot:cancel';
    const consumeCancels = () => {
      try {
        const raw = localStorage.getItem(CANCEL_KEY);
        if (!raw) return;
        const map = JSON.parse(raw) as Record<string, number>;
        const ids = Object.keys(map);
        if (ids.length === 0) return;
        for (const id of ids) {
          if (!batchCancelRef.current[id]) {
            batchCancelRef.current[id] = true;
            setBatchStates((prev) => {
              const cur = prev[id];
              if (!cur) return prev;
              if (cur.phase === 'done' || cur.phase === 'failed') return prev;
              return { ...prev, [id]: { ...cur, phase: 'failed', message: 'Cancelado pelo user (background page)', finishedAt: Date.now() } };
            });
          }
        }
        // Limpa o flag depois de processar
        localStorage.setItem(CANCEL_KEY, '{}');
      } catch {}
    };
    consumeCancels();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CANCEL_KEY) consumeCancels();
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(consumeCancels, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  /** Tick a cada 1s pra atualizar elapsed time nas batches rodando.
   *  So roda quando ha batch nao finalizada — evita re-render constante. */
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const hasRunning = Object.values(batchStates).some((b) => b.phase !== 'done' && b.phase !== 'failed');
    if (!hasRunning) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [batchStates]);

  /** Renomeia label do parser pra naming Portuguese pedido pelo user:
   *  HOOK 1 → GANCHO1.mp4, HOOK 2 → GANCHO2.mp4
   *  BODY → PARTE.mp4, BODY 1 → PARTE1.mp4 */
  function labelToFilename(label: string): string {
    const up = label.toUpperCase().trim();
    let m = up.match(/^HOOK\s*(\d+)?$/);
    if (m) return `GANCHO${m[1] || '1'}.mp4`;
    m = up.match(/^GANCHO\s*(\d+)?$/);
    if (m) return `GANCHO${m[1] || '1'}.mp4`;
    m = up.match(/^BODY\s*(\d+)?$/);
    if (m) return `PARTE${m[1] || ''}.mp4`;
    m = up.match(/^PARTE\s*(\d+)?$/);
    if (m) return `PARTE${m[1] || ''}.mp4`;
    // Fallback: sanitize label
    return up.replace(/[^A-Z0-9]/g, '_') + '.mp4';
  }

  /** Roda 1 task end-to-end em background:
   *  1. Dispatch via runHeyGenJobs (TTS + upload + submit por parte)
   *  2. Poll videos until ready
   *  3. Download MP4 + zipar com nomes GANCHO/PARTE
   *  4. Salva blob URL no state pra download manual depois */
  async function runTaskInBackground(taskId: string) {
    const a = taskAnalyses[taskId];
    // VARIACAO DE AVATAR: roteia pro runner VA (pipeline proprio que tambem
    // escreve batchStates). Detecta por taskAnalyses OU pela flag isVA no
    // batchStates (sobrevive reload). Sem essa guarda, runTaskInBackground
    // tentaria buildPlan(VA) e falharia.
    if (a?.vaBriefing || batchStates[taskId]?.isVA) {
      await runVAPipelineForTask(taskId);
      return;
    }
    // Resolve o plano: 1o de taskAnalyses (sessao com a task analisada);
    // senao do `replan` persistido (sobrevive reload/navegacao) — e isso
    // que faz Retomar/Debug funcionarem em task que falhou com 0 videoIds.
    let plan = a ? buildPlan(a) : null;
    let rTaskName: string;
    let rBaseAdId: string;
    let replan: BatchTaskState['replan'];
    if (a && plan) {
      rTaskName = a.taskName;
      rBaseAdId = a.baseAdId || a.taskName;
      replan = {
        taskName: rTaskName,
        baseAdId: rBaseAdId,
        parts: plan.parts.map((p: any) => ({
          label: p.label,
          text: p.text,
          avatarId: p.avatarId ?? null,
          voiceId: p.voiceId ?? null,
          motionPrompt: p.motionPrompt ?? null,
          // só a CHAVE: base64 aqui estouraria a quota do localStorage.
          imageKey: p.imageKey ?? null,
          engine: p.engine,
        })),
      };
    } else {
      const saved = batchStates[taskId]?.replan || loadPersistedReplan(taskId);
      if (!saved || !saved.parts?.length) {
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...(prev[taskId] || { taskId, taskName: taskId, baseAdId: taskId, parts: [], startedAt: Date.now() }),
            phase: 'failed',
            message: 'Sem plano salvo pra re-disparar. Abra essa task no ClickUp Pilot e analise de novo.',
            finishedAt: Date.now(),
          } as BatchTaskState,
        }));
        return;
      }
      rTaskName = saved.taskName;
      rBaseAdId = saved.baseAdId;
      replan = saved;
      plan = {
        adName: rBaseAdId.replace(/[^a-z0-9_-]/gi, '_'),
        parts: saved.parts.map((p) => ({
          label: p.label,
          text: p.text,
          avatarId: p.avatarId,
          avatarName: null,
          avatarThumb: null,
          voiceId: p.voiceId,
          // Sem isto o RETOMAR pós-F5 re-disparava a cena SEM o gesto.
          motionPrompt: p.motionPrompt ?? null,
          // dataUrl não sobrevive ao reload; os bytes vêm do IDB por esta chave.
          imageKey: p.imageKey ?? null,
          engine: p.engine,
        })),
        unmatchedAvatars: [],
      } as any;
    }
    if (!plan) return;
    const partsLen = plan.parts.length;
    const adNameClean = (rBaseAdId).replace(/[^A-Z0-9]/gi, '_');

    // Re-run da mesma task: revoga blob URLs antigos pra nao vazar memoria
    for (const url of [batchStates[taskId]?.zipBlobUrl, batchStates[taskId]?.montadoZipUrl, batchStates[taskId]?.camufladoZipUrl]) {
      if (url) { try { URL.revokeObjectURL(url); } catch {} }
    }
    // Limpa flag de cancel de runs anteriores
    batchCancelRef.current[taskId] = false;

    // ═══ ISOLAÇÃO POR GERAÇÃO (fix 2026-07-08) ═══════════════════════════════
    // Disparo/re-disparo DO ZERO = geração NOVA. Cunha um genId único e LIMPA do
    // IDB TODOS os artefatos por-parte (blobs de take + clips leveled/decupado)
    // de gerações anteriores DESTA task. Sem isso, um RETOMAR após F5 podia ler
    // take de avatar antigo sob a chave compartilhada → montagem embaralhada
    // (caso AD13). A geração nova grava tudo sob `pilot:<taskId>:g:<genId>:...`,
    // então nunca mais mistura. Ver [[project_disparo_genid_isolacao]].
    const genId = newPilotGenId();
    try {
      const { deletePrefix } = await import('@/lib/zip-store');
      const purged = await deletePrefix(`pilot:${taskId}:`);
      if (purged > 0) console.log(`[clickup-pilot] geração nova ${genId} (task=${taskId}): limpei ${purged} artefato(s) por-parte de gerações anteriores (isolação de avatar)`);
    } catch (e) { console.warn('[clickup-pilot] purge de geração anterior falhou (segue mesmo assim — a geração nova escreve em namespace próprio):', e); }

    const aForUrl = taskAnalyses[taskId];
    setBatchStates((prev) => ({
      ...prev,
      [taskId]: {
        taskId, taskName: rTaskName, baseAdId: rBaseAdId,
        genId,
        phase: 'dispatching',
        parts: plan!.parts.map((p: any) => ({ label: p.label, videoId: null, renamedTo: labelToFilename(p.label) })),
        startedAt: Date.now(),
        message: 'TTS + upload + submit por parte...',
        replan,
        // Preserva docUrl/taskUrl se ja existiam (re-run) OU pega da analise
        docUrl: prev[taskId]?.docUrl || aForUrl?.docUrl,
        taskUrl: prev[taskId]?.taskUrl || aForUrl?.taskUrl,
      },
    }));

    try {
      // 1. Dispatch via runHeyGenJobs (re-usa toda logica do HeyGen Auto runner)
      // MOTOR: resolve per-part baseado em motorConfig (global/percent/individual)
      const motorCfg = getMotorConfig(taskId);
      const motorsPerPart = resolveMotors(motorCfg, plan.parts.length, {
        slotIds: plan.parts.map((p: any) => `${p.label}`),
        seed: taskId,
      });
      console.log(`[clickup-pilot] motor config (${motorCfg.kind}): ${motorsPerPart.join(', ')}`);
      // LOG CRITICO: avatar mapping por task. Permite o user verificar em
      // DevTools que cada AD pegou o avatar certo. Se 2 ADs distintos
      // estiverem usando o MESMO avatarId pro mesmo role, e bug — abrir
      // issue ou re-analisar. Esse log salvou ja o caso AD144/AD145 onde
      // o user reclamou de avatar trocado.
      console.log(
        `[clickup-pilot] DISPATCH task=${taskId} ad=${rBaseAdId} name=${rTaskName}\n` +
        plan.parts.map((p: any, i: number) =>
          `  part ${i + 1} [${p.label}] avatar=${p.avatarId} (${p.avatarName || '?'}) voice=${p.voiceId || 'default'}${p.motionPrompt ? ' motion=ON (Avatar IV)' : ''} text="${(p.text || '').slice(0, 60).replace(/\n/g, ' ')}..."`
        ).join('\n')
      );
      // Sanity check: se algum part vai SEM avatar, aborta antes de torrar
      // chamadas TTS em vao.
      // MODO IMAGEM nao tem avatarId por definicao — a imagem ENTRA no lugar do
      // avatar (variante `image` do /v3, que nem aceita avatar_id). Sem esta
      // excecao a task inteira falhava aqui: foi o que derrubou o AD43 do WL PL,
      // 100% modo imagem, antes de disparar um take sequer.
      const missingAv = plan.parts.findIndex(
        (p: any) => !p.avatarId && !p.imageDataUrl && !p.imageKey,
      );
      if (missingAv >= 0) {
        const errMsg = `Part ${missingAv + 1} (${plan.parts[missingAv].label}) sem avatarId nem imagem. NUNCA dispara sem avatar — refaz a analise.`;
        console.error(`[clickup-pilot] ${errMsg}`);
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: errMsg, finishedAt: Date.now() } }));
        return;
      }
      // ══ REUSO DO BODY ENTRE HOOKS IRMÃOS (só DR MILLION) ══
      // AD07G1/G2/G3 são 3 tasks com hooks diferentes e o MESMO corpo. Sem
      // isto, disparar as três geraria o corpo 3x — e o corpo tem ~20 takes,
      // então seriam ~60 gerações no HeyGen em vez de ~20 + 3 hooks.
      //
      // O dedup é por CONTEÚDO (texto+avatar+voz), não por "grupo": mesma
      // fala, mesmo avatar e mesma voz = mesmo vídeo, então dá pra reusar com
      // segurança. Como rodam até 2 tasks em paralelo, a primeira que pede
      // uma fala RESERVA a chave com uma promessa; as irmãs esperam essa
      // promessa em vez de disparar de novo.
      //
      // B2C: dedupOn=false → minhasIdx vira [0,1,2,...] e todo o resto abaixo
      // se comporta exatamente como antes (resultsFull === results).
      const dedupOn = !!a?.drMillion;
      const plano = planejarDisparo(plan.parts as any, {
        ativo: dedupOn,
        reservadas: new Set(drDedupRef.current.keys()),
      });
      const minhasIdx = plano.minhasIdx;
      // Falas que outra task já está gerando → espero a promessa dela.
      const herdadas = new Map<number, Promise<string | null>>();
      for (const i of plano.herdadasIdx) {
        const dono = drDedupRef.current.get(chaveConteudo(plan.parts[i] as any));
        if (dono) herdadas.set(i, dono.promise);
        else minhasIdx.push(i); // sumiu do mapa (F5/limpeza) → gera normal
      }
      minhasIdx.sort((x, y) => x - y);
      // Falas que EU vou gerar e as irmãs vão esperar.
      const minhasReservas = new Map<number, (v: string | null) => void>();
      for (const [i, k] of plano.novasChaves) {
        let resolver: (v: string | null) => void = () => {};
        const promise = new Promise<string | null>((res) => { resolver = res; });
        drDedupRef.current.set(k, { promise, resolve: resolver });
        minhasReservas.set(i, resolver);
      }
      if (herdadas.size > 0) {
        setBatchStates((prev) => prev[taskId] ? {
          ...prev,
          [taskId]: { ...prev[taskId], message: `Reaproveitando ${herdadas.size} take(s) do corpo já gerado…` },
        } : prev);
      }

      // Pós-F5 a data URL não existe mais — só a chave. Rebusca os bytes no
      // IndexedDB, senão o RETOMAR mandaria a cena de imagem sem imagem.
      const imagensPorChave = new Map<string, string>();
      for (const i of minhasIdx) {
        const p: any = plan.parts[i];
        if (!p.imageKey || p.imageDataUrl || imagensPorChave.has(p.imageKey)) continue;
        try {
          const { loadBlob } = await import('@/lib/zip-store');
          const blob = await loadBlob(p.imageKey, 'image/jpeg');
          if (blob) {
            imagensPorChave.set(p.imageKey, await new Promise<string>((res, rej) => {
              const fr = new FileReader();
              fr.onload = () => res(String(fr.result || ''));
              fr.onerror = () => rej(new Error('falha lendo a imagem do IDB'));
              fr.readAsDataURL(blob);
            }));
          }
        } catch (e) {
          console.warn(`[clickup-pilot] imagem ${p.imageKey} não voltou do IDB:`, e);
        }
      }
      const jobs = minhasIdx.map((i) => {
        const p: any = plan.parts[i];
        return {
          label: p.label,
          copy: p.text,
          avatarId: p.avatarId!,
          voiceId: p.voiceId,
          // Cena com gesto: o runner sobe pro Avatar IV sozinho (motorEfetivo).
          motionPrompt: p.motionPrompt || undefined,
          // Modo imagem: sem avatar — o runner sobe pela variante `image`.
          imageDataUrl: p.imageDataUrl || (p.imageKey ? imagensPorChave.get(p.imageKey) : undefined) || undefined,
          // motor escolhido na cena vence o motorConfig global
          motor: p.engine || motorsPerPart[i],
        };
      });
      // Cena de imagem cuja imagem não voltou do IDB: falha AGORA, com nome, em
      // vez de gerar um take mudo que só apareceria na revisão do montado.
      const semImagem = minhasIdx.filter((i) => {
        const p: any = plan.parts[i];
        return !p.avatarId && !jobs[minhasIdx.indexOf(i)].imageDataUrl;
      });
      if (semImagem.length) {
        const errMsg = `Cena(s) em modo imagem sem a imagem: ${semImagem.map((i) => plan!.parts[i].label).join(', ')}. Suba o frame de novo no plano e dispare.`;
        console.error(`[clickup-pilot] ${errMsg}`);
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: errMsg, finishedAt: Date.now() } }));
        return;
      }
      const resultsEnviados = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode: 'copy',
        avatarId: plan!.parts[0]?.avatarId || '',
        voiceId: undefined,
        motor: motorCfg.kind === 'global' ? motorCfg.motor : 'III', // fallback global; per-job vence
        adNameSafe: adNameClean,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onProgress: () => {},
        onResult: (r) => {
          // r.index é 1-based na lista ENVIADA; traduz pro índice da part.
          // Sem dedup, minhasIdx[i] === i (comportamento de sempre).
          const orig = minhasIdx[r.index - 1];
          if (orig === undefined) return;
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p, i) => i === orig ? { ...p, videoId: r.videoId, error: r.error } : p);
            return { ...prev, [taskId]: { ...s, parts: newParts } };
          });
        },
      });

      // Libera as reservas: quem esperava por estas falas recebe o videoId
      // (ou null, e aí a irmã mostra a parte como faltando — o RETOMAR
      // re-dispara). O finally garante que ninguém fica esperando pra sempre.
      const resolvidas = new Set<number>();
      for (const r of resultsEnviados) {
        const orig = minhasIdx[r.index - 1];
        if (orig === undefined) continue;
        const res = minhasReservas.get(orig);
        if (res) { res(r.videoId || null); resolvidas.add(orig); }
      }
      for (const [i, res] of minhasReservas) {
        if (!resolvidas.has(i)) res(null); // job que nem voltou
      }

      // Espera o corpo que a task irmã está gerando. Teto de 25min pra nunca
      // travar a fila se a dona morrer no meio.
      const herdados = new Map<number, string | null>();
      if (herdadas.size > 0) {
        await Promise.all(
          [...herdadas].map(async ([i, pr]) => {
            const v = await Promise.race([
              pr,
              new Promise<null>((res) => setTimeout(() => res(null), 25 * 60 * 1000)),
            ]);
            herdados.set(i, v);
            if (v) {
              setBatchStates((prev) => {
                const s = prev[taskId];
                if (!s) return prev;
                const newParts = s.parts.map((p, idx) => idx === i ? { ...p, videoId: v, error: undefined } : p);
                return { ...prev, [taskId]: { ...s, parts: newParts } };
              });
            }
          }),
        );
      }

      // Resultado alinhado 1:1 com plan.parts — é o que todo o resto (falhas,
      // download, zip, montagem) consome. SEM dedup devolve exatamente o mesmo
      // array de antes, então o B2C não muda em nada.
      const results = montarResultados(
        plan.parts.length,
        minhasIdx,
        resultsEnviados as any,
        herdados,
        dedupOn,
      ) as typeof resultsEnviados;

      const failed = results.filter((r) => r.error);
      const validIds = results.filter((r) => r.videoId).map((r) => r.videoId!);
      if (validIds.length === 0) {
        // MENSAGEM HONESTA (fix 2026-07-03): quando TUDO falhou por LIMITE DIÁRIO
        // do HeyGen (isQuotaError), não é bug do fluxo — é cota externa. Em vez do
        // alarmante "Todos disparos falharam: ...(status 429)", explica que é o
        // limite e que o RETOMAR (após o reset ~24h) re-dispara sozinho. O replan
        // já foi persistido no enfileirar → RETOMAR funciona sem reabrir a task.
        const allQuota = failed.length > 0 && failed.every((r) => isQuotaError(r.error || ''));
        const msg = allQuota
          ? `⏳ Limite diário do HeyGen atingido — nenhum take disparou. Não é erro do fluxo: a cota diária zerou. Clica RETOMAR após o reset (~24h) que eu re-disparo tudo sozinho.`
          : `Todos disparos falharam: ${failed[0]?.error || '?'}`;
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: msg, finishedAt: Date.now() } }));
        return;
      }

      // Marca a task primary + TODAS siblings G1/G2 do mesmo grupo como
      // disparadas (compartilham o mesmo conteudo)
      for (const sid of getSiblingTaskIds(taskId)) markDispatched(sid);

      // 2. Poll status ate todos prontos (ou alguns falharem)
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'rendering', message: `Aguardando renderizacao no HeyGen (${validIds.length} videos)...` } }));
      let renderHealthNote = '';
      const finalStatuses = await pollVideosUntilReady(validIds, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        // Teto em plataforma SAUDÁVEL. Quando o monitor acusa lentidão, o poll
        // estica sozinho (até 4h) em vez de cunhar falso negativo — era isso que
        // fazia a auto-cura re-disparar take que estava só demorando.
        maxPendingMsPerId: 15 * 60 * 1000,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onHealth: (h) => { renderHealthNote = h.state === 'ok' ? '' : ` — ${h.reason}`; },
        onStatus: (st) => {
          const done = Object.values(st).filter((s) => s.status === 'completed').length;
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p) => {
              const ps = p.videoId ? st[p.videoId] : null;
              return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
            });
            return { ...prev, [taskId]: { ...s, parts: newParts, message: `Renderizando: ${done}/${validIds.length} prontos${renderHealthNote}` } };
          });
        },
      });

      // 3. Download em paralelo (3 simultaneos) + coleta blobs em memoria pra
      //    pipeline pos-producao (concat + decupagem + camuflagem).
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Baixando ${validIds.length} videos...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // expected:true = parte COM conteúdo (texto não-vazio) → DEVE virar blob.
      // Parte intencionalmente vazia (sem texto) fica expected:false e pode
      // faltar sem marcar a montagem como incompleta.
      const partBlobs: Array<{ label: string; blob: Blob | null; expected?: boolean }> = plan.parts.map((p: any) => ({ label: p.label, blob: null, expected: !!(p.text && String(p.text).trim()) }));
      let downloaded = 0;
      const downloadOne = async (i: number) => {
        if (batchCancelRef.current[taskId]) return;
        const r = results[i];
        const part = plan.parts[i];
        const fname = labelToFilename(part.label);
        const fnameBase = fname.replace('.mp4', '');
        if (!r.videoId) {
          zip.file(`${fnameBase}_NAO_DISPAROU.txt`, `Erro no dispatch: ${r.error || 'sem detalhes'}`);
          return;
        }
        const status = finalStatuses[r.videoId];
        if (status?.status !== 'completed' || !status.videoUrl) {
          // 'stalled' não é "não renderizou" — é "ainda renderizando lá".
          zip.file(
            status?.status === 'stalled' ? `${fnameBase}_AINDA_RENDERIZANDO.txt` : `${fnameBase}_NAO_RENDERIZOU.txt`,
            `Status: ${status?.status || '?'}\n${status?.error || ''}`,
          );
          return;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(fname, bytes);
          const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
          partBlobs[i] = { label: part.label, blob: partBlob };
          // PERSIST IDB pra RETOMAR — cada parte gravada AGORA, na hora do download.
          // Resume hidrata daqui sem precisar re-baixar do HeyGen (URLs expiram).
          try {
            const { saveBlob } = await import('@/lib/zip-store');
            await saveBlob(pilotPartKey(taskId, genId, part.label), partBlob, 'video/mp4');
          } catch (e) { console.warn('[pilot] persist part blob falhou:', e); }
          downloaded++;
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Baixando: ${downloaded}/${validIds.length}` } }));
        } catch (e) {
          zip.file(`${fnameBase}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message));
        }
      };
      const queue = results.map((_, i) => i);
      const DL_PARALLEL = 3;
      const dlWorkers: Promise<void>[] = [];
      for (let w = 0; w < DL_PARALLEL; w++) {
        dlWorkers.push((async () => {
          while (queue.length > 0) {
            const idx = queue.shift()!;
            await downloadOne(idx);
          }
        })());
      }
      await Promise.all(dlWorkers);

      // ═══ AUTO-CURA IN-RUN (fix 2026-06-21) ═══════════════════════════════
      // GARANTIA de montagem COMPLETA sem precisar clicar RETOMAR. Depois do
      // 1o download, se sobrou alguma parte ESPERADA (tem texto) ainda SEM blob,
      // o run conserta sozinho ANTES de montar:
      //   (a) re-download barato — parte renderizou (status completed+url) mas o
      //       download falhou; tenta de novo (downloadVideoBytes ja tem 4 retries).
      //   (b) re-dispatch — parte sem videoId (dispatch falhou de vez) OU render
      //       'failed'/zombie; re-submete no HeyGen + re-polla + re-baixa.
      // Bounded em 2 rodadas de re-dispatch pra nao loopar infinito. Se ainda
      // assim faltar (quota real/limite), a montagem sai flagada INCOMPLETA como
      // antes (sem regressao) — mas agora isso vira excecao, nao regra.
      const expectedMissing = () =>
        partBlobs.map((pb, i) => ({ pb, i }))
          .filter(({ pb }) => pb.expected && !pb.blob)
          .map(({ i }) => i);

      /** Takes que o HeyGen ainda está renderizando quando o run acaba. Não são
       *  falha: o batch fecha em 'waiting-heygen' e o watcher retoma sozinho. */
      let stillRenderingIds: string[] = [];
      let healMissing = expectedMissing();
      if (healMissing.length > 0 && !batchCancelRef.current[taskId]) {
        console.warn(`[clickup-pilot] AUTO-CURA: ${healMissing.length} parte(s) esperada(s) sem blob:`, healMissing.map((i) => plan!.parts[i].label));

        // (a) re-download das que JA renderizaram mas o download falhou
        const redownloadFirst = healMissing.filter((i) => {
          const vid = results[i]?.videoId;
          const st = vid ? finalStatuses[vid] : null;
          return st?.status === 'completed' && !!st.videoUrl;
        });
        if (redownloadFirst.length > 0) {
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Re-baixando ${redownloadFirst.length} take(s) que falharam no download...` } }));
          for (const i of redownloadFirst) {
            if (batchCancelRef.current[taskId]) break;
            const vid = results[i].videoId!;
            const url = finalStatuses[vid]?.videoUrl;
            if (!url) continue;
            try {
              const bytes = await downloadVideoBytes(url);
              const part = plan!.parts[i];
              zip.file(labelToFilename(part.label), bytes);
              const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
              partBlobs[i] = { label: part.label, blob: partBlob, expected: partBlobs[i].expected };
              try {
                const { saveBlob } = await import('@/lib/zip-store');
                await saveBlob(pilotPartKey(taskId, genId, part.label), partBlob, 'video/mp4');
              } catch {}
            } catch (e) { console.warn(`[clickup-pilot] auto-cura re-download ${plan!.parts[i].label} falhou:`, (e as Error)?.message); }
          }
        }

        // (b) re-dispatch das que nao tem video bom — SEMPRE atrás do porteiro
        const MAX_HEAL_ROUNDS = 2;
        for (let round = 1; round <= MAX_HEAL_ROUNDS; round++) {
          if (batchCancelRef.current[taskId]) break;
          healMissing = expectedMissing();
          if (healMissing.length === 0) break;

          const candidateIdxs = healMissing.filter((i) => {
            // COTA (fix 2026-07-03): não re-dispara parte que falhou por LIMITE
            // DIÁRIO — a cota continua morta, só queimaria as 2 rodadas em segundos
            // (AD47GL). O gate de completude abaixo já monta a msg ⏳ certa.
            if (isQuotaError(results[i]?.error || '')) return false;
            // Cena em MODO IMAGEM não tem avatarId — sem esta segunda condição
            // ela nunca era curada e a task fechava incompleta pra sempre.
            const p: any = plan!.parts[i];
            return !!p.avatarId || !!p.imageDataUrl || !!p.imageKey;
          });
          if (candidateIdxs.length === 0) break;

          // ═══ PORTEIRO (fix 2026-08-14) ═══════════════════════════════════
          // Antes de gastar UM take de cota, confere o estado REAL de cada
          // render agora. Pendente = ainda vivo (proibido re-disparar); pronto =
          // resgata de graça; só falha REAL do HeyGen vira novo submit.
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Conferindo no HeyGen o que realmente falhou (${candidateIdxs.length} take(s))...` } }));
          const gate = await planRedispatch(
            candidateIdxs,
            (i) => ({
              videoId: results[i]?.videoId,
              title: `${adNameClean}_${plan!.parts[i].label}`,
              error: (results[i]?.videoId ? finalStatuses[results[i].videoId!]?.error : null) || results[i]?.error,
            }),
            'clickup-pilot auto-cura',
          );

          // RESGATE: renderizou enquanto a gente desistia de esperar. Baixa e
          // pronto — zero cota queimada.
          if (gate.rescue.length > 0) {
            setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `${gate.rescue.length} take(s) ficaram prontos no HeyGen — baixando sem re-gerar...` } }));
            for (const r of gate.rescue) {
              if (batchCancelRef.current[taskId]) break;
              try {
                const bytes = await downloadVideoBytes(r.videoUrl);
                const part = plan!.parts[r.idx];
                zip.file(labelToFilename(part.label), bytes);
                const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
                partBlobs[r.idx] = { label: part.label, blob: partBlob, expected: partBlobs[r.idx].expected };
                results[r.idx] = { ...results[r.idx], videoId: r.videoId, error: null };
                finalStatuses[r.videoId] = { videoId: r.videoId, status: 'completed', videoUrl: r.videoUrl };
                setBatchStates((prev) => {
                  const s = prev[taskId];
                  if (!s) return prev;
                  const newParts = s.parts.map((p, i) => i === r.idx ? { ...p, videoId: r.videoId, videoStatus: 'completed' as const, videoUrl: r.videoUrl, error: undefined } : p);
                  return { ...prev, [taskId]: { ...s, parts: newParts } };
                });
                try {
                  const { saveBlob } = await import('@/lib/zip-store');
                  await saveBlob(pilotPartKey(taskId, genId, part.label), partBlob, 'video/mp4');
                } catch {}
              } catch (e) { console.warn(`[clickup-pilot] resgate de ${plan!.parts[r.idx].label} falhou:`, (e as Error)?.message); }
            }
          }

          // AINDA RENDERIZANDO: guarda pra fechar depois. NUNCA re-dispara.
          stillRenderingIds = gate.waiting.map((w) => w.videoId);
          if (gate.waiting.length > 0) {
            console.warn(
              `[clickup-pilot] ${gate.waiting.length} take(s) AINDA renderizando no HeyGen — re-disparo BLOQUEADO (evita gastar cota à toa):`,
              gate.waiting.map((w) => plan!.parts[w.idx].label),
            );
            setBatchStates((prev) => {
              const s = prev[taskId];
              if (!s) return prev;
              const newParts = s.parts.map((p, i) =>
                gate.waiting.some((w) => w.idx === i)
                  ? { ...p, videoStatus: 'stalled' as const, error: 'O HeyGen ainda está renderizando esse take — não re-disparei pra não gastar cota à toa.' }
                  : p,
              );
              return { ...prev, [taskId]: { ...s, parts: newParts } };
            });
          }

          const redispatchIdxs = gate.redispatch;
          if (redispatchIdxs.length === 0) break;

          console.warn(`[clickup-pilot] AUTO-CURA rodada ${round}/${MAX_HEAL_ROUNDS}: re-disparando ${redispatchIdxs.length} parte(s) com falha REAL:`, redispatchIdxs.map((i) => plan!.parts[i].label));
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'dispatching', message: `Auto-cura: re-disparando ${redispatchIdxs.length} take(s) que o HeyGen recusou (rodada ${round}/${MAX_HEAL_ROUNDS})...` } }));

          // EXCLUI os vídeos NEGADOS antes do re-disparo — sem isso o HeyGen
          // "lembra" do registro negado e nega o MESMO texto de novo (loop).
          await purgeRejectedVideosBeforeRedispatch(gate.rejected, 'clickup-pilot auto-cura');

          const healJobs = redispatchIdxs.map((i) => {
            const p = plan!.parts[i] as any; // plan parts carregam voiceId em runtime (mesmo padrao do dispatch original)
            return {
              label: p.label, copy: p.text, avatarId: p.avatarId!, voiceId: p.voiceId || undefined,
              // A cura tem que re-disparar a cena de imagem COM a imagem e o
              // gesto — senão volta um take de avatar vazio no lugar dela.
              imageDataUrl: p.imageDataUrl || (p.imageKey ? imagensPorChave.get(p.imageKey) : undefined) || undefined,
              motionPrompt: p.motionPrompt || undefined,
              motor: p.engine || motorsPerPart[i],
            };
          });

          let healResults: Awaited<ReturnType<typeof runHeyGenJobs>>;
          try {
            healResults = await runHeyGenJobs(healJobs, {
              parallel: 3, mode: 'copy', avatarId: healJobs[0].avatarId, voiceId: undefined,
              motor: 'III', adNameSafe: adNameClean,
              isCancelled: () => !!batchCancelRef.current[taskId],
              onProgress: () => {},
              onResult: (r) => {
                const stateIdx = redispatchIdxs[r.index - 1];
                if (r.videoId) results[stateIdx] = { ...results[stateIdx], videoId: r.videoId, error: null };
                setBatchStates((prev) => {
                  const s = prev[taskId];
                  if (!s) return prev;
                  const newParts = s.parts.map((p, i) => i === stateIdx ? { ...p, videoId: r.videoId, error: r.error || undefined } : p);
                  return { ...prev, [taskId]: { ...s, parts: newParts } };
                });
              },
            });
          } catch (e) { console.error(`[clickup-pilot] auto-cura re-dispatch rodada ${round} crashou:`, e); break; }

          const healIds = healResults.filter((r) => r.videoId).map((r) => r.videoId!);
          if (healIds.length === 0) break;

          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'rendering', message: `Auto-cura: renderizando ${healIds.length} re-disparada(s) (rodada ${round})...` } }));
          const healStatuses = await pollVideosUntilReady(healIds, {
            intervalMs: 8000, timeoutMs: 20 * 60 * 1000, maxPendingMsPerId: 12 * 60 * 1000,
            isCancelled: () => !!batchCancelRef.current[taskId],
            onStatus: (st) => {
              const done = Object.values(st).filter((s) => s.status === 'completed').length;
              setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Auto-cura re-render: ${done}/${healIds.length} prontos (rodada ${round})` } }));
            },
          });
          Object.assign(finalStatuses, healStatuses);

          // baixa as re-disparadas que ficaram prontas
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Auto-cura: baixando re-disparadas (rodada ${round})...` } }));
          for (const i of redispatchIdxs) {
            if (batchCancelRef.current[taskId]) break;
            const vid = results[i]?.videoId;
            const st = vid ? finalStatuses[vid] : null;
            if (st?.status !== 'completed' || !st.videoUrl) continue;
            try {
              const bytes = await downloadVideoBytes(st.videoUrl);
              const part = plan!.parts[i];
              zip.file(labelToFilename(part.label), bytes);
              const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
              partBlobs[i] = { label: part.label, blob: partBlob, expected: partBlobs[i].expected };
              try {
                const { saveBlob } = await import('@/lib/zip-store');
                await saveBlob(pilotPartKey(taskId, genId, part.label), partBlob, 'video/mp4');
              } catch {}
            } catch (e) { console.warn(`[clickup-pilot] auto-cura download ${plan!.parts[i].label} falhou:`, (e as Error)?.message); }
          }
        }

        const stillMissing = expectedMissing();
        if (stillMissing.length === 0) {
          console.log('[clickup-pilot] AUTO-CURA: todas as partes esperadas completas ✓');
        } else {
          console.error(`[clickup-pilot] AUTO-CURA esgotou: ${stillMissing.length} parte(s) ainda sem video (${stillMissing.map((i) => plan!.parts[i].label).join(', ')}). Montagem vai sair INCOMPLETA — provavel quota/limite HeyGen.`);
        }
      }

      // ZIP 1 — takes individuais
      const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const takesFilename = `${adNameClean}_takes.zip`;
      const takesUrl = URL.createObjectURL(takesBlob);
      // Persiste em IndexedDB pra sobreviver reload
      try {
        const { saveZip } = await import('@/lib/zip-store');
        await saveZip(`batch:${taskId}:takes`, takesBlob, takesFilename);
      } catch (e) {
        console.warn('[batch] falha salvando ZIP takes em IndexedDB:', e);
      }

      // GATE DE COMPLETUDE (fix 2026-06-26): NUNCA montar com partes ESPERADAS
      // faltando. Montar parcial = vídeo truncado + barra "MONTANDO" enganosa. O
      // certo é completar TODAS as partes antes de montar. Se ainda faltam (típico:
      // 429 limite diário do HeyGen), para em INCOMPLETO e deixa o user RETOMAR.
      {
        const miss = expectedMissing();
        if (miss.length > 0) {
          setBatchStates((prev) => {
            const cur = prev[taskId];
            const labels = miss.map((i) => cur?.parts?.[i]?.label || plan!.parts[i]?.label).filter(Boolean);
            const is429 = miss.some((i) => /429|daily limit|exceeded the maximum|quota/i.test(cur?.parts?.[i]?.error || ''));
            // ESPERANDO ≠ FALHOU (fix 2026-08-14): se o que falta é take que o
            // HeyGen AINDA está renderizando, o batch não fecha como incompleto —
            // fica em 'waiting-heygen' e o watcher retoma sozinho quando ficar
            // pronto. Nada de cota gasta, nada de card vermelho mentindo "falha".
            if (stillRenderingIds.length > 0 && !is429) {
              const h = getHeyGenHealth();
              return {
                ...prev,
                [taskId]: {
                  ...cur,
                  phase: 'waiting-heygen',
                  message: `⏳ ${stillRenderingIds.length} take(s) ainda renderizando no HeyGen (${labels.join(', ')}). ${h.state === 'ok' ? 'Não é falha' : h.reason} — não re-disparei nada. Eu re-checo sozinho e fecho quando ficarem prontos.`,
                  waitingVideoIds: stillRenderingIds,
                  waitingCheckedAt: Date.now(),
                  finishedAt: undefined,
                  zipBlobUrl: takesUrl,
                  zipFilename: takesFilename,
                  montadoZipUrl: undefined,
                  montadoZipName: undefined,
                  pipeStats: undefined,
                },
              };
            }
            const msg = is429
              ? `⏳ Limite diário do HeyGen — faltam ${miss.length} parte(s). NÃO montei (evita vídeo incompleto). Retome após o reset (~24h): ${labels.join(', ')}`
              : `Incompleto — faltam ${miss.length} parte(s) que o HeyGen não gerou (${labels.join(', ')}). NÃO montei. Clica RETOMAR pra tentar essas.`;
            return { ...prev, [taskId]: { ...cur, phase: 'done', message: msg, finishedAt: Date.now(), zipBlobUrl: takesUrl, zipFilename: takesFilename, montadoZipUrl: undefined, montadoZipName: undefined, pipeStats: undefined } };
          });
          return;
        }
      }

      // === Stage 4: PIPELINE pos-producao (concat + decupagem [+ camuflagem]) ===
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'post',
          message: 'Montando + decupando' + (camuflagemMode ? ' + camuflando...' : '...'),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
        },
      }));

      let pipeRes: Awaited<ReturnType<typeof runPostPipeline>>;
      try {
        const _tc = getTaskCamuflagem(taskId);
        pipeRes = await runPostPipelineSerial({
          baseAdId: rBaseAdId,
          parts: partBlobs,
          decupagem: isDecupagemEnabled(taskId),
          keepSilenceSec: getDecupIntensity(taskId),
          camuflagem: _tc.camuflagem,
          whiteAudio: _tc.whiteAudio,
          camuflagemVolume: _tc.camuflagemVolume,
          // Fresh dispatch: NÃO lê cache (conteúdo novo) mas ESCREVE (popula
          // pro próximo RETOMAR pular nivelamento/decupagem).
          readClipCache: false,
          ...makeClipCacheHooks(taskId, getDecupIntensity(taskId), genId),
          onProgress: (p) => {
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
            }));
          },
        }, taskId);
      } catch (e) {
        // Pipeline jogou — quase nunca deve acontecer (catch interno em cada stage)
        console.error('[clickup-pilot] pipeline threw:', e);
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...prev[taskId],
            phase: 'done',
            message: `Takes OK · pipeline FATAL: ${(e as Error)?.message || 'erro desconhecido'} (ver console F12)`,
            // fix 2026-07-03: FATAL não entregou → deliveryOk:false + limpa
            // pipeStats stale pra a auto-cura ENXERGAR (antes ficava invisível).
            deliveryOk: false,
            pipeStats: undefined,
            finishedAt: Date.now(),
          },
        }));
        return;
      }
      const assembled = pipeRes.items;

      // ZIP 2 — versoes montadas + decupadas. SEMPRE cria, mesmo quando
      // assembled.length === 0 (nesse caso vai so com _DIAGNOSTICO.txt
      // explicando porque nada foi montado). Garante que o user sempre
      // tem botao pra clicar + entende o que aconteceu.
      let montadoUrl: string | undefined;
      let montadoName: string | undefined;
      // GARANTIA (fix 2026-07-07): true se a persistência durável da entrega
      // falhou e tivemos que RESGATAR baixando pro disco na hora. Vira aviso
      // honesto no card — nunca um "PRONTO" mudo que perde o arquivo no F5.
      let deliveryRescued = false;
      {
        const zipMont = new JSZip();
        for (const item of assembled) {
          if (item.decupado) {
            zipMont.file(item.filename, item.decupado);
          } else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
            // Decupagem falhou mas tem montagem — entrega o montado raw + nota
            const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
            zipMont.file(baseName, item.rawAssembled);
            zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro desconhecido');
          } else {
            zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
              `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
          }
        }
        zipMont.file('_DIAGNOSTICO.txt',
`Pipeline pos-producao - relatorio
==================================
${pipeRes.diagnostics.summary}

Total de partes recebidas: ${pipeRes.diagnostics.totalParts}
Hooks identificados (label HOOK ou GANCHO): ${pipeRes.diagnostics.hooksFound}
Bodies identificados (label BODY ou PARTE): ${pipeRes.diagnostics.bodiesFound}
Labels nao reconhecidas: ${pipeRes.diagnostics.unrecognizedLabels.join(', ') || 'nenhuma'}

Items finais: ${assembled.length}
${assembled.map(it => `- ${it.filename}: assemble=${it.errors?.assemble ? 'ERRO ('+it.errors.assemble+')' : 'OK'} | decupagem=${it.errors?.decupagem ? 'ERRO ('+it.errors.decupagem+')' : (it.decupado ? 'OK ('+(it.decupado.size/(1024*1024)).toFixed(1)+'MB)' : '?')}${camuflagemMode ? ' | camuflagem=' + (it.errors?.camuflagem ? 'ERRO ('+it.errors.camuflagem+')' : (it.camuflado ? 'OK' : '?')) : ''}`).join('\n')}

Se a pasta estiver vazia ou so com _DIAGNOSTICO.txt, ABRA O CONSOLE DO BROWSER (F12)
pra ver os erros detalhados [clickup-pilot-pipeline].`);
        const blob2 = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
        // GUARD (fix 2026-07-03): só persiste o montado se tiver VÍDEO real dentro.
        // Um zip só com _ERRO.txt/_DIAGNOSTICO.txt (montagem falhou) NÃO pode
        // sobrescrever um montado BOM salvo antes (auto-cura destrutiva). Sem
        // vídeo, mantém o artefato anterior no IDB e não oferece download novo.
        const temVideo = assembled.some((it) => it.decupado || (it.rawAssembled && it.rawAssembled.size > 0 && !it.errors?.assemble));
        if (temVideo) {
          montadoUrl = URL.createObjectURL(blob2);
          const rMont = await persistDeliverableOrRescue(`batch:${taskId}:montado`, blob2, montadoName);
          if (rMont.rescued) deliveryRescued = true;
        } else {
          montadoName = undefined; // sem vídeo → não anuncia entrega falsa
        }
      }

      // ZIP 3 — versoes camufladas. Cria sempre que modo ON (mesmo se 0
      // assembled — entrega so o diagnostico explicando porque).
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) {
            zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          } else {
            zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || item.errors?.assemble || 'falha sem detalhes');
          }
        }
        zipCamu.file('_DIAGNOSTICO.txt',
`Camuflagem - relatorio
======================
${pipeRes.diagnostics.summary}
WHITE audio: ${camuflagemWhite?.name || '(NAO SELECIONADO — adicione na ferramenta)'}
Volume: ${camuflagemVolume}%

${assembled.length === 0 ? 'Pipeline nao produziu nenhuma montagem (ver _DIAGNOSTICO.txt do zip de montados pra detalhes)' : assembled.map(it => `- ${it.filename}: ${it.camuflado ? 'OK' : 'ERRO ('+(it.errors?.camuflagem || 'sem detalhes')+')'}`).join('\n')}`);
        const blob3 = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(blob3);
        // GUARD (mesma política do montado, fix 2026-07-03): só PERSISTE o zip
        // camuflado se tiver camuflado REAL dentro. Um zip só de
        // _CAMUFLAGEM_ERRO.txt não pode sobrescrever no IDB um camuflado BOM de
        // tentativa anterior — após F5 é o IDB que re-hidrata o download.
        if (assembled.some((it) => !!it.camuflado)) {
          const rCamo = await persistDeliverableOrRescue(`batch:${taskId}:camo`, blob3, camuName);
          if (rCamo.rescued) deliveryRescued = true;
        }
      }

      const totalSize = takesBlob.size + (montadoUrl ? assembled.reduce((n, it) => n + (it.decupado?.size || it.rawAssembled?.size || 0), 0) : 0);
      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        // Montagem INCOMPLETA (faltou parte esperada) NÃO conta como ok →
        // trava o "100% pronto" e o download limpo (o user NUNCA recebe
        // "faltando texto" como se estivesse pronto).
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0 && !it.missingParts?.length).length,
        incompleteMontagens: assembled.filter((it) => !!it.missingParts?.length).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };
      // HONESTIDADE (fix 2026-07-03): só diz "Pronto" quando ENTREGOU de verdade
      // — montagem real (okMontagens === esperado, >0). Antes a msg "Pronto: ..."
      // saía incondicional mesmo com okMontagens=0 (montagem falhou no ffmpeg),
      // e o card ficava verde. Agora, sem entrega, a msg avisa e deliveryOk:false
      // deixa o rastro pra auto-cura/card (sobrevive ao persist).
      const entregou = pipeStats.expectedMontagens > 0 && pipeStats.okMontagens === pipeStats.expectedMontagens;
      const doneMsg = entregou
        ? (deliveryRescued
            ? `Pronto e BAIXADO automaticamente pro seu PC (não deu pra salvar no cache do navegador — feche abas extras do Pilot). Confira a pasta Downloads. · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`
            : `Pronto: ${downloaded} takes · ${pipeRes.diagnostics.summary} · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`)
        : `⚠ Montagem falhou (${pipeStats.okMontagens}/${pipeStats.expectedMontagens}) — takes prontos, mas o vídeo final não montou. Clica RETOMAR. [${pipeRes.diagnostics.summary}]`;
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: doneMsg,
          deliveryOk: entregou,
          finishedAt: Date.now(),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
        },
      }));
      if (entregou) {
        logHistory({
          tool: 'clickup-pilot',
          title: `${adNameClean} entregue`,
          meta: `${downloaded} takes · ${(totalSize / 1048576).toFixed(1)}MB`,
        });
      }
    } catch (e) {
      if (isChunkLoadError(e)) {
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: '⚠ Saiu uma versão nova do app durante o processamento — recarregando pra atualizar. Seus takes estão salvos; depois clique Retomar.', finishedAt: Date.now() } }));
        reloadOnceForChunk();
        return;
      }
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: (e as Error)?.message || 'erro', finishedAt: Date.now() } }));
    }
  }

  /** Retoma batch que foi interrompida por reload da pagina. Usa videoIds
   *  ja persistidos pra re-poll status no HeyGen + re-baixar + zipar. Pula
   *  TTS+upload+submit que ja foram feitos. */
  async function resumeTaskBatch(taskId: string) {
    const state = batchStates[taskId];
    if (!state) return;
    // VA: resume = re-rodar o pipeline VA (nao tem resume parcial de
    // videoIds como a task normal). Roteia pro runner VA.
    if (state.isVA || taskAnalyses[taskId]?.vaBriefing) {
      await runVAPipelineForTask(taskId);
      return;
    }
    // ISOLAÇÃO POR GERAÇÃO: o resume SÓ enxerga os takes/clips desta MESMA
    // geração (o genId que o disparo do zero gravou no state, sobrevive F5). Se
    // uma parte não estiver cacheada sob este genId (ex: save falhou / F5 antes
    // de baixá-la), ela some do cache e é re-baixada do HeyGen pelo videoId ATUAL
    // — jamais puxa o take de uma geração anterior (avatar antigo).
    let genId = state.genId;
    const validParts = state.parts.filter((p) => p.videoId);
    if (validParts.length === 0) {
      setError('Não achei os vídeos desse disparo pra retomar — essa task precisa ser disparada do zero.');
      return;
    }
    batchCancelRef.current[taskId] = false;

    // ═══ UPGRADE RETROATIVO DE BATCH LEGADO (fix 2026-07-08 #2) ══════════════
    // Batch criado ANTES da isolação por geração não tem genId. O cache por-parte
    // dele pode estar CONTAMINADO com takes de gerações anteriores (avatares
    // antigos) sob a chave compartilhada `pilot:<taskId>:part:<label>` — foi
    // EXATAMENTE o que fez o RETOMAR do AD13 continuar embaralhando mesmo após o
    // fix #1. NÃO dá pra confiar nesse cache. Mas os videoIds no state são SEMPRE
    // do ÚLTIMO disparo (avatar CERTO) — a contaminação nunca esteve neles. Então:
    // cunha um genId agora, PURGA o cache velho e força re-download do HeyGen sob
    // o namespace novo. A partir daqui o batch fica isolado (RETOMARs futuros já
    // são limpos). Ver [[project_disparo_genid_isolacao]].
    if (!genId) {
      genId = newPilotGenId();
      try {
        const { deletePrefix } = await import('@/lib/zip-store');
        const purged = await deletePrefix(`pilot:${taskId}:`);
        console.warn(`[pilot resume] batch LEGADO sem genId — purguei ${purged} artefato(s) por-parte possivelmente contaminado(s) e vou RE-BAIXAR do HeyGen pelos videoIds atuais (avatar certo) sob genId ${genId}`);
      } catch (e) { console.warn('[pilot resume] purge do cache legado falhou (segue re-baixando do HeyGen mesmo assim):', e); }
      // Grava o genId no state pra sobreviver F5 e blindar os próximos RETOMAR.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, genId } };
      });
    }
    const adNameClean = state.baseAdId.replace(/[^A-Z0-9]/gi, '_');
    const validIds = validParts.map((p) => p.videoId!);

    try {
      // === PRÉ-HIDRATAÇÃO do IDB (fix 2026-05-28) ===
      // ANTES de re-pollar/re-baixar do HeyGen, verifica quantas parts já
      // estão no cache local. Se TODAS as parts COM videoId já têm blob no
      // IDB, pula poll + download (HeyGen URLs já podem ter expirado, e não
      // faz sentido re-baixar o que já temos). Vai direto pra montagem.
      //
      // User reportou (2026-05-28): batch com 9/9 renderizados + 1 parte
      // vazia ficava travando no RETOMAR. Causa: pollVideosUntilReady +
      // re-download desnecessário + montagem abortava por causa da parte vazia.
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'downloading', message: 'Verificando cache local...', finishedAt: undefined },
      }));
      const { loadBlob } = await import('@/lib/zip-store');
      let cachedCount = 0;
      for (const p of validParts) {
        try {
          const b = await loadBlob(pilotPartKey(taskId, genId, p.label), 'video/mp4');
          if (b && b.size > 1024) cachedCount++;
        } catch {}
      }
      const allCached = cachedCount >= validParts.length;
      console.log(`[pilot resume] cache: ${cachedCount}/${validParts.length} parts no IDB. allCached=${allCached}`);

      // Só polla HeyGen se NÃO temos tudo em cache. Se já temos, finalStatuses
      // fica vazio (download loop vai pular tudo e usar só o cache).
      let finalStatuses: Awaited<ReturnType<typeof pollVideosUntilReady>> = {};
      // Set de indices que JA TÊM BLOB no IDB — usado pra excluir do re-dispatch
      // de zombie (se ja tem cache, parte ja terminou antes; status 'failed'
      // novo eh ruido, nao precisa re-disparar).
      const cachedIdxs = new Set<number>();
      for (let i = 0; i < state.parts.length; i++) {
        const p = state.parts[i];
        if (!p.videoId) continue;
        try {
          const { loadBlob } = await import('@/lib/zip-store');
          const b = await loadBlob(pilotPartKey(taskId, genId, p.label), 'video/mp4');
          if (b && b.size > 1024) cachedIdxs.add(i);
        } catch {}
      }

      // ── PARTES NUNCA DISPARADAS (fix 2026-06-08 — AD31GL ficou 8/9) ──
      // Parte com replan dispatchavel (texto + avatar) mas SEM videoId: o
      // dispatch falhou de vez (cota/limite HeyGen, erro antes do submit), entao
      // ela nunca entrou no poll nem no cache. Diferente de "zombie" (TEM videoId
      // mas o render travou). Antes, o RETOMAR so re-checava os videoIds salvos
      // e remontava sem essa parte → "Incompleto — clica Retomar" eterno, sem
      // jeito de fechar. Agora detectamos e re-disparamos no mesmo loop abaixo.
      // Parte VAZIA legitima ("(vazio)") tem text vazio → NUNCA entra aqui.
      const hasUndispatched = !!state.replan?.parts?.length && state.parts.some((p, i) => {
        if (cachedIdxs.has(i) || p.videoId) return false;
        const rp: any = state.replan!.parts[i];
        // Cena de imagem entra aqui também: sem isso o RETOMAR nem via que
        // faltava a parte, e a task ficava incompleta em silêncio.
        return !!rp && (rp.text || '').trim().length > 0 && (!!rp.avatarId || !!rp.imageKey);
      });

      /** Takes que o HeyGen ainda está renderizando quando o RETOMAR acaba —
       *  não são falha; o batch fecha em 'waiting-heygen' e o watcher retoma. */
      let resumeStillRenderingIds: string[] = [];

      // Entra no bloco se faltam renders (nao-cacheados) OU ha partes nunca
      // disparadas. So `!allCached` nao basta: a parte que nunca disparou nao
      // conta em validParts, entao allCached pode ser `true` faltando 1 corte.
      if (!allCached || hasUndispatched) {
        // So re-polla os videoIds salvos se realmente faltam renders. Se ja
        // esta tudo em cache (allCached) e o unico pendente e' re-dispatch,
        // pula o poll e vai direto pro loop de re-dispatch abaixo.
        if (!allCached && validIds.length > 0) {
          setBatchStates((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], phase: 'rendering', message: `Re-checando ${validIds.length} videos no HeyGen (${cachedCount} já em cache)...` },
          }));
          let resumeHealthNote = '';
          finalStatuses = await pollVideosUntilReady(validIds, {
            intervalMs: 8000,
            timeoutMs: 30 * 60 * 1000,
            // Teto em plataforma saudável — estica sozinho quando o monitor de
            // saúde acusa lentidão, em vez de cunhar falso negativo.
            maxPendingMsPerId: 15 * 60 * 1000,
            isCancelled: () => !!batchCancelRef.current[taskId],
            onHealth: (h) => { resumeHealthNote = h.state === 'ok' ? '' : ` — ${h.reason}`; },
            onStatus: (st) => {
              const done = Object.values(st).filter((s) => s.status === 'completed').length;
              setBatchStates((prev) => {
                const s = prev[taskId];
                if (!s) return prev;
                const newParts = s.parts.map((p) => {
                  const ps = p.videoId ? st[p.videoId] : null;
                  return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
                });
                return { ...prev, [taskId]: { ...s, parts: newParts, message: `Renderizando: ${done}/${validIds.length} prontos${resumeHealthNote}` } };
              });
            },
          });
        }

        // ═══ RE-DISPATCH DE FALHA REAL + NUNCA-DISPARADAS (fix 2026-05-30 / 2026-06-08) ═══
        // Só re-dispara o que o PORTEIRO liberar (fix 2026-08-14): o que ainda
        // está renderizando no HeyGen fica esperando, o que já ficou pronto é
        // resgatado de graça, e só falha REAL do HeyGen vira submit novo.
        const MAX_REDISPATCH_ROUNDS = 2;
        for (let round = 1; round <= MAX_REDISPATCH_ROUNDS; round++) {
          if (batchCancelRef.current[taskId]) break;
          if (!state.replan?.parts?.length) break;

          // Candidatas: parte sem blob cacheado cujo replan diz que deveria
          // gerar (texto + avatar). Parte VAZIA legitima ("(vazio)") tem text
          // vazio → fica de fora. 'stalled' NÃO é motivo de re-disparo por si só
          // — quem decide é o porteiro, com status fresco.
          const candidateIdxs: number[] = [];
          for (let i = 0; i < state.parts.length; i++) {
            if (cachedIdxs.has(i)) continue;
            const rp: any = state.replan.parts[i];
            if (!rp || !(rp.text || '').trim()) continue;
            if (!rp.avatarId && !rp.imageKey) continue; // nem avatar nem imagem: não dá
            const p = state.parts[i];
            const st = p.videoId ? finalStatuses[p.videoId] : null;
            const hasGoodVideo = st?.status === 'completed' && !!st.videoUrl;
            if (!hasGoodVideo) candidateIdxs.push(i);
          }
          if (candidateIdxs.length === 0) break;

          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Conferindo no HeyGen o que realmente falhou (${candidateIdxs.length} take(s))...` } }));
          const gate = await planRedispatch(
            candidateIdxs,
            (i) => {
              const p = state.parts[i];
              const st = p.videoId ? finalStatuses[p.videoId] : null;
              return { videoId: p.videoId, title: `${adNameClean}_${p.label}`, error: st?.error || p.error };
            },
            'pilot resume',
          );

          // RESGATE: ficou pronto no HeyGen. Só alimenta finalStatuses — o loop
          // de download logo abaixo baixa normalmente, sem gastar cota.
          for (const r of gate.rescue) {
            finalStatuses[r.videoId] = { videoId: r.videoId, status: 'completed', videoUrl: r.videoUrl };
            state.parts[r.idx] = { ...state.parts[r.idx], videoId: r.videoId };
            setBatchStates((prev) => {
              const s = prev[taskId];
              if (!s) return prev;
              const newParts = s.parts.map((p, i) => i === r.idx ? { ...p, videoId: r.videoId, videoStatus: 'completed' as const, videoUrl: r.videoUrl, error: undefined } : p);
              return { ...prev, [taskId]: { ...s, parts: newParts } };
            });
          }
          if (gate.rescue.length > 0) {
            console.log(`[pilot resume] ${gate.rescue.length} take(s) resgatado(s) prontos do HeyGen — nenhuma cota gasta`);
          }

          // AINDA RENDERIZANDO: proibido re-disparar. Registra pro fecho honesto.
          resumeStillRenderingIds = gate.waiting.map((w) => w.videoId);
          if (gate.waiting.length > 0) {
            console.warn(
              `[pilot resume] ${gate.waiting.length} take(s) AINDA renderizando no HeyGen — re-disparo BLOQUEADO:`,
              gate.waiting.map((w) => state.parts[w.idx].label),
            );
            setBatchStates((prev) => {
              const s = prev[taskId];
              if (!s) return prev;
              const newParts = s.parts.map((p, i) =>
                gate.waiting.some((w) => w.idx === i)
                  ? { ...p, videoStatus: 'stalled' as const, error: 'O HeyGen ainda está renderizando esse take — não re-disparei pra não gastar cota à toa.' }
                  : p,
              );
              return { ...prev, [taskId]: { ...s, parts: newParts } };
            });
          }

          const zombieIdxs = gate.redispatch;
          if (zombieIdxs.length === 0) break;

          console.warn(`[pilot resume] round ${round}: re-disparando ${zombieIdxs.length} parte(s) com falha REAL:`, zombieIdxs.map((i) => state.parts[i].label));
          setBatchStates((prev) => ({
            ...prev,
            [taskId]: {
              ...prev[taskId],
              phase: 'dispatching',
              message: `Re-disparando ${zombieIdxs.length} take(s) que o HeyGen recusou (rodada ${round}/${MAX_REDISPATCH_ROUNDS})...`,
            },
          }));

          // EXCLUI os vídeos NEGADOS antes do re-disparo (anti-memória de
          // moderação): re-submeter o MESMO texto com o registro negado vivo
          // era negado de novo — RETOMAR ficava em loop de FALHA eterno.
          await purgeRejectedVideosBeforeRedispatch(gate.rejected, 'pilot resume');

          // Pós-F5 só a CHAVE sobrevive (base64 estouraria o localStorage) —
          // os bytes voltam do IndexedDB aqui.
          const imgsResume = new Map<string, string>();
          for (const i of zombieIdxs) {
            const rp: any = state.replan!.parts[i];
            if (!rp?.imageKey || imgsResume.has(rp.imageKey)) continue;
            try {
              const { loadBlob } = await import('@/lib/zip-store');
              const blob = await loadBlob(rp.imageKey, 'image/jpeg');
              if (blob) {
                imgsResume.set(rp.imageKey, await new Promise<string>((res, rej) => {
                  const fr = new FileReader();
                  fr.onload = () => res(String(fr.result || ''));
                  fr.onerror = () => rej(new Error('falha lendo a imagem do IDB'));
                  fr.readAsDataURL(blob);
                }));
              }
            } catch (e) {
              console.warn(`[pilot resume] imagem ${rp.imageKey} não voltou do IDB:`, e);
            }
          }
          const jobsToRedispatch = zombieIdxs.map((i) => {
            const rp: any = state.replan!.parts[i];
            return {
              label: rp.label,
              copy: rp.text,
              avatarId: rp.avatarId || '',
              voiceId: rp.voiceId || undefined,
              // Sem isto o RETOMAR re-disparava a cena de imagem como take vazio
              // — e o filtro abaixo a descartava calado, deixando o AD sem a
              // parte pra sempre.
              imageDataUrl: rp.imageDataUrl || (rp.imageKey ? imgsResume.get(rp.imageKey) : undefined) || undefined,
              motionPrompt: rp.motionPrompt || undefined,
              motor: rp.engine || ('III' as const),
            };
          });
          // Sem avatar E sem imagem não dá pra disparar. Mas descartar calado
          // faz o RETOMAR "rodar" e não fazer nada — foi assim que a faxina do
          // IndexedDB comendo o frame passou despercebida por horas. Fala qual
          // cena e por quê.
          const semInsumo = jobsToRedispatch.filter((j) => !j.avatarId && !j.imageDataUrl);
          const prontos = jobsToRedispatch.filter((j) => j.avatarId || j.imageDataUrl);
          if (semInsumo.length) {
            const quais = semInsumo.map((j) => j.label).join(', ');
            console.error(`[pilot resume] sem imagem no IDB pra re-disparar: ${quais}`);
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: {
                ...prev[taskId],
                message: `Cena(s) em modo imagem sem o frame guardado: ${quais}. Reaplica o plano com os frames e dispara de novo.`,
              },
            }));
          }
          if (prontos.length === 0) break;
          jobsToRedispatch.length = 0;
          jobsToRedispatch.push(...prontos);

          let newResults: Awaited<ReturnType<typeof runHeyGenJobs>>;
          try {
            newResults = await runHeyGenJobs(jobsToRedispatch, {
              parallel: 3,
              mode: 'copy',
              avatarId: jobsToRedispatch[0].avatarId,
              voiceId: undefined,
              motor: 'III',
              adNameSafe: adNameClean,
              isCancelled: () => !!batchCancelRef.current[taskId],
              onProgress: () => {},
              onResult: (r) => {
                // r.index eh 1-based dentro do array de jobs; mapeia pro state idx
                const stateIdx = zombieIdxs[r.index - 1];
                setBatchStates((prev) => {
                  const s = prev[taskId];
                  if (!s) return prev;
                  const newParts = s.parts.map((p, i) => i === stateIdx ? { ...p, videoId: r.videoId, error: r.error || undefined } : p);
                  return { ...prev, [taskId]: { ...s, parts: newParts } };
                });
              },
            });
          } catch (e) {
            console.error(`[pilot resume] re-dispatch round ${round} crashou:`, e);
            break;
          }

          // Atualiza state.parts referencia local (pra proxima iteracao do loop)
          for (let k = 0; k < newResults.length; k++) {
            const r = newResults[k];
            const stateIdx = zombieIdxs[k];
            if (r.videoId) state.parts[stateIdx] = { ...state.parts[stateIdx], videoId: r.videoId };
          }

          // Polla as NOVAS videoIds (zombie detection 15min, timeout 20min — mais
          // curto que o original pq RETOMAR ja consumiu paciencia do user)
          const newIds = newResults.filter((r) => r.videoId).map((r) => r.videoId!);
          if (newIds.length === 0) break;

          setBatchStates((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], phase: 'rendering', message: `Renderizando ${newIds.length} re-disparadas (rodada ${round})...` },
          }));
          const newStatuses = await pollVideosUntilReady(newIds, {
            intervalMs: 8000,
            timeoutMs: 20 * 60 * 1000,
            maxPendingMsPerId: 12 * 60 * 1000, // menor: ja eh 2a tentativa
            isCancelled: () => !!batchCancelRef.current[taskId],
            onStatus: (st) => {
              const done = Object.values(st).filter((s) => s.status === 'completed').length;
              setBatchStates((prev) => {
                const s = prev[taskId];
                if (!s) return prev;
                const newParts = s.parts.map((p) => {
                  const ps = p.videoId ? st[p.videoId] : null;
                  return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
                });
                return { ...prev, [taskId]: { ...s, parts: newParts, message: `Re-render: ${done}/${newIds.length} prontos (rodada ${round})` } };
              });
            },
          });
          // Merge no finalStatuses — proxima iteracao vai ver os NOVOS videoIds
          Object.assign(finalStatuses, newStatuses);
        }
      } else {
        console.log('[pilot resume] tudo em cache — pulando poll do HeyGen, indo direto pra montagem');
      }

      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Hidratando blobs do cache local...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // expected:true = parte COM conteúdo (texto no plano) → DEVE virar blob.
      // CRÍTICO: usa o TEXTO do replan, NÃO o videoId. Se o dispatch falhou e a
      // parte ficou sem videoId mas TINHA texto, ela continua "esperada" → cai
      // no gate de incompleta. Marcar por videoId deixava a montagem sair
      // "faltando texto" como se fosse 100%. Sem replan (batch antigo) → !!videoId.
      const expectedByText = (i: number, p: { videoId: string | null }) => {
        const t = state.replan?.parts?.[i]?.text;
        return t != null ? !!String(t).trim() : !!p.videoId;
      };
      const partBlobs: Array<{ label: string; blob: Blob | null; expected?: boolean }> =
        state.parts.map((p, i) => ({ label: p.label, blob: null, expected: expectedByText(i, p) }));

      // === HIDRATAÇÃO RETOMAR (fix 2026-05-27) ===
      // Antes de re-baixar do HeyGen, tenta hidratar cada parte do IndexedDB
      // (foram salvas no primeiro download via saveBlob). HeyGen URLs expiram
      // após 24-72h — sem cache local, RETOMAR ficaria sem como reconstruir.
      let hydrated = 0;
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        for (let i = 0; i < state.parts.length; i++) {
          const p = state.parts[i];
          // CRITICAL (fix 2026-05-28): SÓ hidrata partes que TÊM videoId.
          // Partes vazias (BODY vazia "(esse part nao gera nada)") têm
          // videoId=null e NUNCA deveriam ter blob — mas execuções antigas
          // podem ter deixado lixo no IDB (ex: BODY 1 com 308KB corrompido).
          // Incluir esse lixo na montagem fazia a DECUPAGEM travar ao tentar
          // decodar o áudio inválido. Pulamos = montagem limpa só com partes reais.
          if (!p.videoId) {
            console.log(`[pilot resume] pulando parte sem videoId (vazia): ${p.label}`);
            continue;
          }
          try {
            const blob = await loadBlob(pilotPartKey(taskId, genId, p.label), 'video/mp4');
            if (blob && blob.size > 1024) {
              partBlobs[i] = { label: p.label, blob };
              zip.file(p.renamedTo, new Uint8Array(await blob.arrayBuffer()));
              hydrated++;
            }
          } catch (e) { console.warn(`[pilot resume] hidratacao da parte ${p.label} falhou:`, e); }
        }
      } catch (e) { console.warn('[pilot resume] loadBlob global falhou:', e); }

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          message: hydrated > 0
            ? `Cache: ${hydrated}/${state.parts.length} parts hidratadas. Baixando faltantes...`
            : `Baixando ${validIds.length} videos do HeyGen...`,
        },
      }));

      let downloaded = hydrated;
      const downloadOne = async (idx: number) => {
        if (batchCancelRef.current[taskId]) return;
        // SKIP se já hidratou do IDB
        if (partBlobs[idx]?.blob) return;
        const part = state.parts[idx];
        if (!part.videoId) {
          zip.file(`${part.renamedTo.replace('.mp4', '')}_NAO_DISPAROU.txt`, `Erro: ${part.error || 'sem videoId'}`);
          return;
        }
        const status = finalStatuses[part.videoId];
        if (status?.status !== 'completed' || !status.videoUrl) {
          const base = part.renamedTo.replace('.mp4', '');
          zip.file(
            status?.status === 'stalled' ? `${base}_AINDA_RENDERIZANDO.txt` : `${base}_NAO_RENDERIZOU.txt`,
            `Status: ${status?.status || '?'}\n${status?.error || ''}`,
          );
          return;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(part.renamedTo, bytes);
          const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
          partBlobs[idx] = { label: part.label, blob: partBlob };
          // Persist no IDB pra próximo RETOMAR
          try {
            const { saveBlob } = await import('@/lib/zip-store');
            await saveBlob(pilotPartKey(taskId, genId, part.label), partBlob, 'video/mp4');
          } catch {}
          downloaded++;
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Baixando: ${downloaded}/${validIds.length}` } }));
        } catch (e) {
          zip.file(`${part.renamedTo.replace('.mp4', '')}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message));
        }
      };
      const queue = state.parts.map((_, i) => i);
      const dlWorkers: Promise<void>[] = [];
      for (let w = 0; w < 3; w++) {
        dlWorkers.push((async () => {
          while (queue.length > 0) {
            const idx = queue.shift()!;
            await downloadOne(idx);
          }
        })());
      }
      await Promise.all(dlWorkers);

      // ZIP 1 — takes individuais
      const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const takesFilename = `${adNameClean}_takes.zip`;
      const takesUrl = URL.createObjectURL(takesBlob);
      try {
        const { saveZip } = await import('@/lib/zip-store');
        await saveZip(`batch:${taskId}:takes`, takesBlob, takesFilename);
      } catch (e) {
        console.warn('[batch resume] falha salvando ZIP takes em IndexedDB:', e);
      }

      // GATE DE COMPLETUDE (fix 2026-06-26): igual ao disparo inicial — não montar
      // com partes ESPERADAS faltando (ex 429 limite diário). Para em INCOMPLETO e
      // deixa o user RETOMAR quando o HeyGen liberar (em vez de montar truncado).
      {
        const miss = partBlobs
          .map((pb, i) => ({ pb, i }))
          .filter(({ pb }) => pb.expected && (!pb.blob || pb.blob.size <= 1024))
          .map(({ i }) => i);
        if (miss.length > 0) {
          setBatchStates((prev) => {
            const cur = prev[taskId];
            const labels = miss.map((i) => cur?.parts?.[i]?.label || state.parts[i]?.label).filter(Boolean);
            const is429 = miss.some((i) => /429|daily limit|exceeded the maximum|quota/i.test(cur?.parts?.[i]?.error || state.parts[i]?.error || ''));
            // ESPERANDO ≠ FALHOU: o que o HeyGen ainda está renderizando não
            // fecha o batch como incompleto — o watcher re-checa e retoma.
            if (resumeStillRenderingIds.length > 0 && !is429) {
              const h = getHeyGenHealth();
              return {
                ...prev,
                [taskId]: {
                  ...cur,
                  phase: 'waiting-heygen',
                  message: `⏳ ${resumeStillRenderingIds.length} take(s) ainda renderizando no HeyGen (${labels.join(', ')}). ${h.state === 'ok' ? 'Não é falha' : h.reason} — não re-disparei nada. Eu re-checo sozinho e fecho quando ficarem prontos.`,
                  waitingVideoIds: resumeStillRenderingIds,
                  waitingCheckedAt: Date.now(),
                  finishedAt: undefined,
                  zipBlobUrl: takesUrl,
                  zipFilename: takesFilename,
                  montadoZipUrl: undefined,
                  montadoZipName: undefined,
                  pipeStats: undefined,
                },
              };
            }
            const msg = is429
              ? `⏳ Limite diário do HeyGen — faltam ${miss.length} parte(s). NÃO montei (evita vídeo incompleto). Retome após o reset (~24h): ${labels.join(', ')}`
              : `Incompleto — faltam ${miss.length} parte(s) que o HeyGen não gerou (${labels.join(', ')}). NÃO montei. Clica RETOMAR pra tentar essas.`;
            return { ...prev, [taskId]: { ...cur, phase: 'done', message: msg, finishedAt: Date.now(), zipBlobUrl: takesUrl, zipFilename: takesFilename, montadoZipUrl: undefined, montadoZipName: undefined, pipeStats: undefined } };
          });
          return;
        }
      }

      // === PIPELINE pos-producao (concat + decupagem [+ camuflagem]) ===
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'post',
          message: 'Montando + decupando' + (camuflagemMode ? ' + camuflando...' : '...'),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
        },
      }));

      let pipeRes: Awaited<ReturnType<typeof runPostPipeline>>;
      try {
        const _tc = getTaskCamuflagem(taskId);
        pipeRes = await runPostPipelineSerial({
          baseAdId: state.baseAdId,
          parts: partBlobs,
          decupagem: isDecupagemEnabled(taskId),
          keepSilenceSec: getDecupIntensity(taskId),
          camuflagem: _tc.camuflagem,
          whiteAudio: _tc.whiteAudio,
          camuflagemVolume: _tc.camuflagemVolume,
          // RETOMAR: mesmo conteúdo → LÊ o cache (pula nivelamento/decupagem já
          // feitos). Era isso que fazia o RETOMAR refazer tudo e levar ~100min.
          readClipCache: true,
          ...makeClipCacheHooks(taskId, getDecupIntensity(taskId), genId),
          onProgress: (p) => {
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
            }));
          },
        }, taskId);
      } catch (e) {
        console.error('[clickup-pilot resume] pipeline threw:', e);
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...prev[taskId],
            phase: 'done',
            message: `Takes OK · pipeline FATAL: ${(e as Error)?.message || 'erro desconhecido'} (ver console F12)`,
            // fix 2026-07-03: CRÍTICO no resume — o spread herdava pipeStats BOM
            // de uma tentativa anterior e a auto-cura via pipeOk=true e NÃO curava.
            // deliveryOk:false + pipeStats:undefined tornam a falha visível.
            deliveryOk: false,
            pipeStats: undefined,
            finishedAt: Date.now(),
          },
        }));
        return;
      }
      const assembled = pipeRes.items;

      // ZIP 2 — versoes montadas + decupadas (sempre cria, mesmo com 0
      // assembled — entrega _DIAGNOSTICO.txt explicando o motivo)
      let montadoUrl: string | undefined;
      let montadoName: string | undefined;
      let deliveryRescued = false; // fix 2026-07-07: resgatou a entrega via download?
      {
        const zipMont = new JSZip();
        for (const item of assembled) {
          if (item.decupado) {
            zipMont.file(item.filename, item.decupado);
          } else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
            const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
            zipMont.file(baseName, item.rawAssembled);
            zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro desconhecido');
          } else {
            zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
              `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
          }
        }
        zipMont.file('_DIAGNOSTICO.txt',
`Pipeline pos-producao - relatorio (RETOMAR)
============================================
${pipeRes.diagnostics.summary}

Total de partes recebidas: ${pipeRes.diagnostics.totalParts}
Hooks identificados (label HOOK ou GANCHO): ${pipeRes.diagnostics.hooksFound}
Bodies identificados (label BODY ou PARTE): ${pipeRes.diagnostics.bodiesFound}
Labels nao reconhecidas: ${pipeRes.diagnostics.unrecognizedLabels.join(', ') || 'nenhuma'}

Items finais: ${assembled.length}
${assembled.map(it => `- ${it.filename}: assemble=${it.errors?.assemble ? 'ERRO ('+it.errors.assemble+')' : 'OK'} | decupagem=${it.errors?.decupagem ? 'ERRO ('+it.errors.decupagem+')' : (it.decupado ? 'OK ('+(it.decupado.size/(1024*1024)).toFixed(1)+'MB)' : '?')}${camuflagemMode ? ' | camuflagem=' + (it.errors?.camuflagem ? 'ERRO ('+it.errors.camuflagem+')' : (it.camuflado ? 'OK' : '?')) : ''}`).join('\n')}

Se a pasta estiver vazia ou so com _DIAGNOSTICO.txt, ABRA O CONSOLE DO BROWSER (F12)
pra ver os erros detalhados [clickup-pilot-pipeline].`);
        const blob2 = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
        // GUARD (fix 2026-07-03): no RETOMAR isto é CRÍTICO — um resume que
        // re-falha a montagem NÃO pode sobrescrever o montado BOM da tentativa
        // anterior com um zip só-de-erro. Só persiste/anuncia se tiver vídeo real.
        const temVideo = assembled.some((it) => it.decupado || (it.rawAssembled && it.rawAssembled.size > 0 && !it.errors?.assemble));
        if (temVideo) {
          montadoUrl = URL.createObjectURL(blob2);
          const rMont = await persistDeliverableOrRescue(`batch:${taskId}:montado`, blob2, montadoName);
          if (rMont.rescued) deliveryRescued = true;
        } else {
          montadoName = undefined;
        }
      }

      // ZIP 3 — versoes camufladas (so se modo ON)
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) {
            zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          } else {
            zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || item.errors?.assemble || 'falha sem detalhes');
          }
        }
        zipCamu.file('_DIAGNOSTICO.txt',
`Camuflagem - relatorio (RETOMAR)
=================================
${pipeRes.diagnostics.summary}
WHITE audio: ${camuflagemWhite?.name || '(NAO SELECIONADO — adicione na ferramenta)'}
Volume: ${camuflagemVolume}%

${assembled.length === 0 ? 'Pipeline nao produziu nenhuma montagem (ver _DIAGNOSTICO.txt do zip de montados pra detalhes)' : assembled.map(it => `- ${it.filename}: ${it.camuflado ? 'OK' : 'ERRO ('+(it.errors?.camuflagem || 'sem detalhes')+')'}`).join('\n')}`);
        const blob3 = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(blob3);
        // GUARD (mesma política do montado, fix 2026-07-03): só PERSISTE o zip
        // camuflado se tiver camuflado REAL dentro. Um zip só de
        // _CAMUFLAGEM_ERRO.txt não pode sobrescrever no IDB um camuflado BOM de
        // tentativa anterior — após F5 é o IDB que re-hidrata o download.
        if (assembled.some((it) => !!it.camuflado)) {
          const rCamo = await persistDeliverableOrRescue(`batch:${taskId}:camo`, blob3, camuName);
          if (rCamo.rescued) deliveryRescued = true;
        }
      }

      const totalSize = takesBlob.size + (montadoUrl ? assembled.reduce((n, it) => n + (it.decupado?.size || it.rawAssembled?.size || 0), 0) : 0);
      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        // Montagem INCOMPLETA (faltou parte esperada) NÃO conta como ok →
        // trava o "100% pronto" e o download limpo (o user NUNCA recebe
        // "faltando texto" como se estivesse pronto).
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0 && !it.missingParts?.length).length,
        incompleteMontagens: assembled.filter((it) => !!it.missingParts?.length).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };
      // HONESTIDADE (fix 2026-07-03): mesmo gate do run fresh — RETOMAR que não
      // remonta o vídeo não pode re-declarar "Pronto". deliveryOk:false mantém a
      // task elegível pra auto-cura em vez de estacionar verde+incompleta.
      const entregou = pipeStats.expectedMontagens > 0 && pipeStats.okMontagens === pipeStats.expectedMontagens;
      const doneMsg = entregou
        ? (deliveryRescued
            ? `Pronto e BAIXADO automaticamente pro seu PC (não deu pra salvar no cache do navegador — feche abas extras do Pilot). Confira a pasta Downloads. · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`
            : `Pronto: ${downloaded} takes · ${pipeRes.diagnostics.summary} · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`)
        : `⚠ Montagem falhou (${pipeStats.okMontagens}/${pipeStats.expectedMontagens}) — takes prontos, mas o vídeo final não montou. Clica RETOMAR. [${pipeRes.diagnostics.summary}]`;
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: doneMsg,
          deliveryOk: entregou,
          finishedAt: Date.now(),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
        },
      }));
      if (entregou) {
        logHistory({
          tool: 'clickup-pilot',
          title: `${adNameClean} entregue`,
          meta: `${downloaded} takes · ${(totalSize / 1048576).toFixed(1)}MB`,
        });
      }
    } catch (e) {
      if (isChunkLoadError(e)) {
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: '⚠ Saiu uma versão nova do app — recarregando pra atualizar. Seus takes estão salvos; depois clique Retomar.', finishedAt: Date.now() } }));
        reloadOnceForChunk();
        return;
      }
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: `Retomar falhou: ${(e as Error)?.message || 'erro'}`, finishedAt: Date.now() } }));
    }
  }

  /**
   * Enfileira o job Magnific de UMA task. Defesa anti-duplicata:
   *   - Se já existe job VIVO (running com heartbeat recente) pra essa task,
   *     NÃO mexe (deixa rodando — clique duplo do user é no-op)
   *   - Se existe queued/paused/failed/done, atualiza com novo JSON
   *
   *  gated=true (MORE): só roda depois do HeyGen daquela task concluir.
   *  gated=false (ONLY): elegível imediatamente.
   *  Retorna false se task não tem JSON ou JSON inválido.
   */
  function enqueueMagnificForTask(taskId: string, gated: boolean): boolean {
    const a = taskAnalyses[taskId];
    if (!a || a.vaBriefing) return false; // VA nunca vai pra Magnific
    const raw = (taskMagnificJson[taskId] || '').trim();
    if (!raw) return false;
    const takes = parseMagnificPrompts(raw);
    if (takes.length === 0) return false;

    // Defesa: clique duplo / disparo redundante (ClickUp Pilot acionando 2x
    // a mesma task) NÃO interrompe job vivo. Idempotente: já está rodando = OK.
    const existing = magnificQueue[taskId];
    if (existing && isMagnificJobAlive(existing)) {
      console.info('[magnific] enqueue ignorado — job já rodando:', taskId);
      return true;
    }

    const adName = (a.baseAdId || a.taskName).replace(/[^a-z0-9_-]/gi, '_');
    magnificCancelRef.current[taskId] = false;
    setMagnificQueueState((prev) => ({
      ...prev,
      [taskId]: {
        taskId,
        adName,
        takesJson: raw,
        takeCount: takes.length,
        status: 'queued',
        gateOnHeyGen: gated,
        message: gated
          ? `Aguardando HeyGen da task concluir (${takes.length} takes na fila)...`
          : `Na fila Magnific (${takes.length} takes)...`,
        enqueuedAt: Date.now(),
        // Limpa qualquer owner/heartbeat antigo (job freshly queued)
        lastHeartbeatAt: undefined,
        ownerTabId: undefined,
        startedAt: undefined,
        finishedAt: undefined,
      },
    }));
    setMagnificTick((t) => t + 1);
    return true;
  }

  /** Inicia batch. Comportamento depende dos toggles:
   *  - Nenhum: HeyGen Auto paralelo (max 2) — fluxo classico INALTERADO.
   *  - MORE: HeyGen Auto paralelo COMO HOJE + enfileira Magnific gated
   *    por task (so dispara apos o HeyGen daquela task concluir).
   *  - ONLY: pula HeyGen, so enfileira Magnific (fila serial). */
  async function startBatch() {
    if (onlyMagnificMode) {
      // ONLY: pula HeyGen totalmente. So Magnific serial pras tasks normais
      // (ready|partial, nao-VA) que tem JSON colado. B-rolls nao precisam
      // de avatar, entao 'partial' tambem vale.
      const cands = Array.from(selectedTaskIds).filter((id) => {
        const a = taskAnalyses[id];
        return a && !a.vaBriefing && (a.status === 'ready' || a.status === 'partial');
      });
      const withJson = cands.filter((id) => (taskMagnificJson[id] || '').trim());
      const missing = cands.filter((id) => !(taskMagnificJson[id] || '').trim());
      if (withJson.length === 0) {
        setError('Cole o JSON de B-rolls nas tasks (botão "+") antes de iniciar o Only Magnific.');
        return;
      }
      setError(
        missing.length > 0
          ? `${missing.length} task(s) sem JSON foram puladas. Cole o JSON no botao "+" delas.`
          : null,
      );
      for (const id of withJson) enqueueMagnificForTask(id, false);
      // Desmarca tasks que foram pra fila — somem da lista de revisão e
      // o usuário não confunde "essa eu já disparei?". O job continua
      // visível e controlável no painel "Fila Magnific" abaixo.
      // Mantém as tasks que ficaram pra trás (sem JSON) selecionadas pra
      // o user saber que ainda tem trabalho a fazer nelas.
      if (withJson.length > 0) {
        setSelectedTaskIds((prev) => {
          const next = new Set(prev);
          for (const id of withJson) next.delete(id);
          return next;
        });
      }
      return;
    }

    if (moreMagnificMode) {
      // MORE: HeyGen Auto roda pra TODAS as tasks ready (igual ao fluxo
      // classico). Magnific gated SO pras tasks ready com JSON — o gate
      // destrava quando o HeyGen DAQUELA task conclui, entao so faz sentido
      // pra tasks que de fato vao rodar HeyGen (ready). Task 'partial' com
      // JSON: nao roda HeyGen, entao seria job preso — pulada (use Only).
      const ready = Array.from(selectedTaskIds).filter((id) => taskAnalyses[id]?.status === 'ready');
      const withJson = ready.filter(
        (id) => !taskAnalyses[id]?.vaBriefing && (taskMagnificJson[id] || '').trim(),
      );
      for (const id of withJson) enqueueMagnificForTask(id, true);
      if (ready.length === 0) {
        setError('Nenhuma task ready selecionada. Confira que avatares + voz estao OK.');
        return;
      }
      setError(
        withJson.length === 0
          ? 'Nenhuma task ready com JSON de B-rolls — rodando so HeyGen. Cole o JSON no botao "+" pra gerar B-rolls.'
          : null,
      );
      // Marca TODAS como 'queued' imediatamente (skeleton de batchStates)
      // e dispara via runHeyGenGated — o semafaro global de MAX_HEYGEN_PARALLEL
      // garante max 2 simultaneos, mesmo com Retomar/Debug em flight de runs
      // anteriores. O promoter cobre tasks que ficarem na fila se houver
      // crash/reload no meio.
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of ready) {
          const a = taskAnalyses[id];
          if (!a) continue;
          const baseAdId = a.baseAdId || a.taskName;
          next[id] = {
            ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now(), phase: 'queued' as const }),
            phase: 'queued',
            message: 'Na fila — aguardando vaga...',
            finishedAt: undefined,
          } as BatchTaskState;
        }
        return next;
      });
      for (const taskId of ready) {
        void runHeyGenGated(taskId, 'run');
      }
      return;
    }

    // === Fluxo classico (nenhum toggle) ===
    // SEPARA por tipo. CADA tipo tem seu proprio criterio de "pronto":
    //  - VA: status nasce 'partial' por design; o que importa e ter TODOS os
    //    avatares escolhidos (vaAvatarChoice). Entao dispara por isso, nao por
    //    status — senao VA nunca entra no START.
    //  - TROCA: precisa do WHITE upado + uma fonte (arquivo OU pasta colada).
    //  - Normais: status 'ready' (avatares + voz OK).
    const selected = Array.from(selectedTaskIds);
    const vaTasks = selected.filter(isVaDispatchable);
    const trocaTasks = selected.filter(isTrocaDispatchable);
    const normalTasks = selected.filter(
      (id) =>
        taskAnalyses[id]?.status === 'ready' &&
        !taskAnalyses[id]?.vaBriefing &&
        !taskAnalyses[id]?.trocaBriefing,
    );

    if (vaTasks.length === 0 && trocaTasks.length === 0 && normalTasks.length === 0) {
      // Mensagem util: diz exatamente o que falta por tipo selecionado.
      const selVA = selected.some((id) => taskAnalyses[id]?.vaBriefing);
      const selTroca = selected.some((id) => taskAnalyses[id]?.trocaBriefing);
      setError(
        selVA
          ? 'VA: escolha o avatar HeyGen de TODOS os avatares antes de disparar.'
          : selTroca
            ? 'Troca de áudio: suba o novo WHITE e confirme o link do criativo (arquivo ou pasta).'
            : 'Nenhuma task pronta. Confira avatares + voz.',
      );
      return;
    }
    setError(null);

    // 1. Normais via HeyGen Auto gated
    setBatchStates((prev) => {
      const next = { ...prev };
      for (const id of normalTasks) {
        const a = taskAnalyses[id];
        if (!a) continue;
        const baseAdId = a.baseAdId || a.taskName;
        // BLINDAGEM F5 (perda de plano): persiste o PLANO (replan) JÁ ao enfileirar.
        // Antes o replan só nascia em runTaskInBackground, ao PEGAR VAGA. Uma task
        // parada em 'queued' (esperando 1 das 2 vagas do HeyGen) que sofria um
        // simples F5 perdia o plano — taskAnalyses NÃO sobrevive reload — e aí
        // Retomar/Debug morriam em "Sem plano salvo, analise de novo" (user reportou
        // 2026-07-01: 4 tasks viraram vermelhas só por atualizar a página). Agora o
        // replan entra no state → persistBatchStates grava no localStorage no ATO do
        // enfileiramento → sobrevive reload → a task até AUTO-RETOMA (o promoter
        // reencontra o plano), sem nem precisar clicar Retomar.
        const qplan = buildPlan(a);
        const qreplan: BatchTaskState['replan'] = qplan ? {
          taskName: a.taskName,
          baseAdId,
          parts: qplan.parts.map((p: any) => ({
            label: p.label,
            text: p.text,
            avatarId: p.avatarId ?? null,
            voiceId: p.voiceId ?? null,
            motionPrompt: p.motionPrompt ?? null,
            imageKey: p.imageKey ?? null,
            engine: p.engine,
          })),
        } : undefined;
        next[id] = {
          ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now(), phase: 'queued' as const }),
          phase: 'queued',
          message: 'Na fila — aguardando vaga...',
          // não sobrescreve um replan já bom se buildPlan falhar por algum motivo
          replan: qreplan || next[id]?.replan,
          finishedAt: undefined,
        } as BatchTaskState;
      }
      return next;
    });
    for (const taskId of normalTasks) {
      void runHeyGenGated(taskId, 'run');
    }

    // 2. VA: AGORA entra na MESMA fila (gated por MAX_HEYGEN_PARALLEL), com
    //    card + previews iguais aos normais. Sem disparo separado, sem botao
    //    "Iniciar Pipeline VA". START dispara tudo junto.
    const vaReady: string[] = [];
    const vaBlocked: string[] = [];
    for (const id of vaTasks) {
      if (vaReadinessIssues(id).length === 0) vaReady.push(id);
      else vaBlocked.push(`${taskAnalyses[id]?.taskName || id} (${vaReadinessIssues(id).join(', ')})`);
    }
    if (vaBlocked.length > 0) {
      setError(`VA pulado por falta de config: ${vaBlocked.join(' · ')}. Escolha avatar + voz + AD original e dispare de novo.`);
    }
    if (vaReady.length > 0) {
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of vaReady) {
          const a = taskAnalyses[id];
          if (!a?.vaBriefing) continue;
          const driveId = a.vaBriefing.linkAdFileId || extractDriveFileId(vaAdUrl[id] || '');
          next[id] = {
            ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId: a.vaBriefing.baseAdId, parts: [], startedAt: Date.now() }),
            phase: 'queued',
            isVA: true,
            adOriginalUrl: driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : undefined,
            message: 'Na fila — aguardando vaga...',
            finishedAt: undefined,
          } as BatchTaskState;
        }
        return next;
      });
      // BLINDAGEM F5 (VA): persiste o snapshot de resume JÁ no enqueue — não só
      // quando pega vaga (o runner re-grava com dados frescos em ~L6004). Sem isto,
      // uma VA parada em 'queued' (esperando vaga) que sofre F5 perdia o vaBriefing
      // inteiro (taskAnalyses não sobrevive reload) → "briefing nao sobrevive reload"
      // → failed sem recuperação. Espelha EXATAMENTE o objeto do runner. Best-effort.
      for (const id of vaReady) {
        try {
          const a = taskAnalyses[id];
          const va = a?.vaBriefing;
          if (!va) continue;
          const fileId = va.linkAdFileId || extractDriveFileId(vaAdUrl[id] || '') || null;
          const pick = (obj: Record<string, unknown>, pref: string) =>
            Object.fromEntries(Object.entries(obj).filter(([k]) => k.startsWith(pref)));
          persistVAResumeSnapshot(id, {
            vaBriefing: { ...va, candidateLinks: undefined },
            taskName: a.taskName,
            baseAdId: va.baseAdId,
            docUrl: batchStates[id]?.docUrl || a.docUrl || null,
            taskUrl: batchStates[id]?.taskUrl || a.taskUrl || null,
            adUrl: vaAdUrl[id] || null,
            usesTextEngine: vaUsesTextEngine(id),
            avatarChoices: pick(vaAvatarChoice as Record<string, unknown>, `${id}:`),
            voiceChoices: pick(vaVoiceChoice as Record<string, unknown>, `${id}:`),
            motionPrompts: pick(vaMotionPrompt as Record<string, unknown>, `${id}:`),
            fileId,
            transcript: fileId ? vaTranscript[fileId] : undefined,
            roleTexts: fileId
              ? Object.fromEntries(Object.entries(vaRoleText).filter(([k]) => k.startsWith(`${fileId}:`)))
              : {},
          });
        } catch { /* best-effort */ }
      }
      for (const taskId of vaReady) {
        void runHeyGenGated(taskId, 'run');
      }
    }

    // 3. TROCA DE ÁUDIO: pipeline proprio (download + descamufla + recamufla).
    //    Roda na mesma fila (batchStates) com card + download iguais.
    if (trocaTasks.length > 0) {
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of trocaTasks) {
          const aa = taskAnalyses[id];
          if (!aa) continue;
          const baseAdId = aa.trocaBriefing?.baseAdId || aa.baseAdId || aa.taskName;
          next[id] = {
            ...(next[id] || { taskId: id, taskName: aa.taskName, baseAdId, parts: [], startedAt: Date.now() }),
            kind: 'troca',
            taskName: aa.taskName,
            baseAdId,
            phase: 'queued',
            message: 'Na fila — troca de áudio...',
            finishedAt: undefined,
            taskUrl: next[id]?.taskUrl || aa.taskUrl,
            trocaOutputFolderUrl: aa.trocaBriefing?.driveFolderUrl || next[id]?.trocaOutputFolderUrl,
          } as BatchTaskState;
        }
        return next;
      });
      // Serial: FFmpeg-wasm e single-instance — processa uma troca de cada vez
      // pra nao corromper mux concorrente. As outras ficam 'queued' no card.
      void (async () => {
        for (const taskId of trocaTasks) {
          if (batchCancelRef.current[taskId]) continue;
          try {
            await runTrocaAudioPipelineForTask(taskId);
          } catch (e) {
            // ISOLA a falha por item: uma troca que estoura no SETUP (antes do
            // try/catch interno do runner) não pode abortar a IIFE e deixar TODAS as
            // trocas seguintes presas em 'queued' com Retomar E Debug desabilitados.
            // Marca 'failed' recuperável e segue pra próxima.
            console.error('[troca] runner lançou fora do try interno:', e);
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: {
                ...(prev[taskId] || { taskId, taskName: taskId, baseAdId: taskId, parts: [], startedAt: Date.now() }),
                kind: 'troca',
                phase: 'failed',
                message: 'Falha ao iniciar a troca — clique Retomar',
                finishedAt: Date.now(),
              } as BatchTaskState,
            }));
          }
        }
      })();
    }
  }

  /** Ungate: quando o HeyGen Auto de uma task (MORE) conclui, libera o job
   *  Magnific gated daquela task pro processor serial. */
  useEffect(() => {
    const toUngate = Object.entries(magnificQueue).filter(
      ([taskId, job]) =>
        job.gateOnHeyGen && job.status === 'queued' && batchStates[taskId]?.phase === 'done',
    );
    if (toUngate.length === 0) return;
    // Functional update — nao clobbar patches concorrentes do processor.
    setMagnificQueueState((prev) => {
      const next = { ...prev };
      for (const [taskId] of toUngate) {
        const cur = next[taskId];
        if (!cur || !cur.gateOnHeyGen || cur.status !== 'queued') continue;
        next[taskId] = {
          ...cur,
          gateOnHeyGen: false,
          message: `HeyGen concluido — na fila Magnific (${cur.takeCount} takes)...`,
        };
      }
      return next;
    });
    setMagnificTick((t) => t + 1);
  }, [batchStates, magnificQueue]);

  /**
   * Processor SERIAL — defesa em 4 camadas contra duplo disparo:
   *   1. ref-guard local (magnificProcessingRef) — sincrono, mesma aba
   *   2. pickNextMagnificJob — ignora qualquer job 'running' vivo
   *   3. tryAcquireMagnificJob — re-lê localStorage AGORA (não state) e
   *      adquire lock cross-tab via ownerTabId + heartbeat
   *   4. heartbeat ticker — escreve a cada 5s; outras abas veem que está vivo
   *
   * Se 2 abas chamam ao mesmo tempo, só uma ganha o tryAcquire. A outra
   * cai no early-return e tenta depois. NUNCA dispara 2 jobs simultâneos.
   */
  useEffect(() => {
    if (magnificProcessingRef.current) return;
    const job = pickNextMagnificJob(magnificQueue);
    if (!job) return;

    // Camada 3: lock cross-tab via localStorage (último a escrever vence,
    // mas o re-check de "alguém vivo" dentro do tryAcquire filtra a corrida).
    if (!tryAcquireMagnificJob(job.taskId)) {
      // Outra aba pegou o job antes de nós. Re-tenta após heartbeat stale —
      // se a outra aba morreu, conseguimos depois.
      return;
    }

    magnificProcessingRef.current = true;
    const taskId = job.taskId;
    const ac = new AbortController();
    magnificAbortRef.current = ac;
    magnificActiveRef.current = { taskId, startedAt: Date.now() };
    magnificStopIntentRef.current[taskId] = null;
    magnificCancelRef.current[taskId] = false;

    // Camada 4: heartbeat ticker — escreve a cada 5s. Se a aba travar
    // ou fechar, em 30s outras abas consideram órfão e pegam o job.
    const heartbeatTimer = setInterval(() => {
      const ok = pulseHeartbeat(taskId);
      if (!ok) {
        // Perdemos o ownership (outra aba assumiu) — aborta este pipeline
        // pra não duplicar trabalho. O cleanup do finally roda normal.
        console.warn('[magnific] heartbeat negado — outra aba assumiu o job', taskId);
        try { ac.abort(); } catch {}
        clearInterval(heartbeatTimer);
      }
    }, HEARTBEAT_INTERVAL_MS);

    (async () => {
      patchMagnificJob(taskId, {
        status: 'running',
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        ownerTabId: thisTabId(),
        message: 'Disparando pipeline Magnific...',
        percent: 0,
      });
      // Resolve o status final respeitando intencao do user (pausar/debug)
      // ou watchdog — nunca sobrescreve com 'failed'/'done' indevido.
      const settle = (
        normal: () => void,
      ) => {
        const intent = magnificStopIntentRef.current[taskId];
        if (intent === 'paused') {
          patchMagnificJob(taskId, { status: 'paused', message: '⏸ Pausado pelo user — clique Retomar', finishedAt: Date.now() });
        } else if (intent === 'debug') {
          // Debug handler ja re-enfileira (status 'queued') — nao mexe aqui.
        } else if (intent === 'watchdog') {
          patchMagnificJob(taskId, { status: 'failed', message: '⚠ Travou (loop infinito?) — clique 🐞 Debug pra recriar o space', finishedAt: Date.now() });
        } else {
          normal();
        }
      };
      try {
        const takes = parseMagnificPrompts(job.takesJson);
        if (takes.length === 0) {
          patchMagnificJob(taskId, {
            status: 'failed',
            message: 'JSON sem takes validos.',
            finishedAt: Date.now(),
          });
          return;
        }
        // SEMPRE V2 — API direta server-side (10x mais rápido, sem extension).
        const res = await runMagnificPipelineV2(
          { spaceName: job.adName, takes },
          {
            signal: ac.signal,
            onProgress: (p) => {
              if (magnificCancelRef.current[taskId]) return;
              patchMagnificJob(taskId, {
                phase: p.phase,
                percent: p.percent,
                message: p.message
                  ? `${p.message} (${p.ready}/${p.total})`
                  : `${p.ready}/${p.total} takes`,
                totalCount: p.total,
                successCount: p.ready,
              });
            },
          },
        );
        settle(() => {
          if (res.ok && res.complete && res.zipBlob) {
            const zipKey = `magnific:${taskId}:takes`;
            const zipName = res.zipName || `${job.adName}_brolls.zip`;
            void (async () => {
              try {
                const { saveZip } = await import('@/lib/zip-store');
                await saveZip(zipKey, res.zipBlob!, zipName);
              } catch (e) {
                console.warn('[magnific-queue] falha salvando ZIP em IndexedDB:', e);
              }
            })();
            patchMagnificJob(taskId, {
              status: 'done',
              zipKey,
              zipName,
              successCount: res.successCount,
              totalCount: res.takes.length,
              percent: 100,
              message: `Pronto: ${res.successCount}/${res.takes.length} takes · ${zipName}`,
              finishedAt: Date.now(),
            });
          } else {
            patchMagnificJob(taskId, {
              status: 'failed',
              message: `Magnific incompleto: ${res.successCount}/${res.takes.length} takes${
                res.missingIdxs?.length ? ` (faltou ${res.missingIdxs.join(', ')})` : ''
              }`,
              finishedAt: Date.now(),
            });
          }
        });
      } catch (e) {
        settle(() => {
          patchMagnificJob(taskId, {
            status: 'failed',
            message: (e as Error)?.message || 'erro no pipeline Magnific',
            finishedAt: Date.now(),
          });
        });
      } finally {
        // Para de bater heartbeat IMEDIATAMENTE — outras abas podem assumir.
        clearInterval(heartbeatTimer);
        // So libera o guard se AINDA somos o job ativo (watchdog pode ter
        // ja liberado + iniciado outro — nao podemos roubar o guard dele).
        if (magnificActiveRef.current?.taskId === taskId) {
          magnificActiveRef.current = null;
          magnificAbortRef.current = null;
          magnificProcessingRef.current = false;
          setMagnificTick((t) => t + 1);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magnificQueue, magnificTick]);

  /**
   * Watchdog anti-loop. Calcula timeout DINAMICAMENTE pela qtd de takes:
   *   - 60s por take + 4min de setup, mínimo 8min, máximo 32min
   *   - Ex: 5 takes = 9min; 20 takes = 24min; 40 takes = 32min (cap)
   *
   * Mais generoso pra jobs grandes legítimos, mais agressivo pra jobs
   * pequenos que ficaram presos. Quando estoura, aborta + recarrega aba
   * Magnific + libera fila pro próximo.
   */
  useEffect(() => {
    const id = setInterval(() => {
      const act = magnificActiveRef.current;
      if (!act) return;
      const job = magnificQueue[act.taskId];
      const takes = job?.takeCount ?? 5;
      const dynamicTimeoutMs = Math.max(
        8 * 60 * 1000,
        Math.min(32 * 60 * 1000, takes * 60_000 + 4 * 60_000),
      );
      if (Date.now() - act.startedAt < dynamicTimeoutMs) return;
      const taskId = act.taskId;
      if (magnificStopIntentRef.current[taskId]) return; // ja tratado
      console.warn(
        '[magnific-watchdog] job travado',
        taskId,
        `(${takes} takes, limite ${(dynamicTimeoutMs / 60_000).toFixed(0)}min)`,
      );
      magnificStopIntentRef.current[taskId] = 'watchdog';
      magnificCancelRef.current[taskId] = true;
      try { magnificAbortRef.current?.abort(); } catch {}
      // CRÍTICO: mata o pipeline ÓRFÃO na extensão e recarrega a aba
      // Magnific. Sem isso o job zumbi segue vivo e o PRÓXIMO job
      // dispara na MESMA aba = ">1 ao mesmo tempo" + cascata. Próximo
      // sempre roda numa aba limpa.
      try { abortAllMagnific(); } catch {}
      patchMagnificJob(taskId, {
        status: 'failed',
        message: `⚠ Travou (>${(dynamicTimeoutMs / 60_000).toFixed(0)}min) — clique 🐞 Debug pra recriar o space`,
        finishedAt: Date.now(),
        // Limpa heartbeat e owner — fila destravada pra outras abas se houver
        lastHeartbeatAt: undefined,
        ownerTabId: undefined,
      });
      // Libera o guard SEM esperar a promise (pode nunca resolver).
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
      setMagnificTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [magnificQueue]);

  function cancelTaskBatch(taskId: string) {
    batchCancelRef.current[taskId] = true;
  }

  /** Wrapper gated: pega vaga no semafaro (MAX_HEYGEN_PARALLEL) ou marca
   *  a task como 'queued' e poll-aguarda. O promoter useEffect ja monitora
   *  e dispara automaticamente — esta funcao e' o caminho pros call-sites
   *  manuais (Retomar/Debug/dispatchTask/startBatch). Idempotente: 2o
   *  clique enquanto pendente e' no-op (heygenPendingRef dedup).
   *
   *  kind='run'    → runTaskInBackground (dispatch+poll+download+post)
   *  kind='resume' → resumeTaskBatch (so re-poll+download+post, requer videoIds)
   */
  async function runHeyGenGated(taskId: string, kind: 'run' | 'resume') {
    if (heygenPendingRef.current[taskId]) {
      // Já há wrapper vivo. NÃO descarta o clique em silêncio (era o "Retomar não faz
      // nada" durante um Pausar→Retomar rápido, com o run anterior ainda encerrando):
      // registra a intenção; o finally do run que está saindo re-dispara assim que o
      // pending liberar. Não empilha (sobrescreve com o último kind pedido).
      pendingRetomarRef.current[taskId] = kind;
      return;
    }
    heygenPendingRef.current[taskId] = kind;
    try {
      // ESPERA VAGA — checa a cada 1s. batchCancelRef true sai sem rodar.
      while (heygenSlotsRef.current >= MAX_HEYGEN_PARALLEL) {
        if (batchCancelRef.current[taskId]) {
          // User cancelou enquanto estava na fila — marca failed e sai.
          setBatchStates((prev) => {
            const cur = prev[taskId];
            if (!cur) return prev;
            return { ...prev, [taskId]: { ...cur, phase: 'failed', message: 'Cancelado na fila', finishedAt: Date.now() } };
          });
          return;
        }
        // Garante que UI mostra 'queued' enquanto espera vaga. Patch raso —
        // nao toca em parts/replan/etc (esses ja foram preservados pelo
        // ultimo setBatchStates de quem criou o queued, OU pelo restore).
        setBatchStates((prev) => {
          const cur = prev[taskId];
          if (cur && cur.phase === 'queued') return prev; // ja marcado
          if (!cur) return prev; // sem entrada — promoter cria, nao aqui
          return { ...prev, [taskId]: { ...cur, phase: 'queued', message: `Aguardando vaga (${heygenSlotsRef.current}/${MAX_HEYGEN_PARALLEL} ocupados)...`, finishedAt: undefined } };
        });
        await sleepUnthrottled(1000); // não-estrangulado: a fila escoa mesmo com a aba em segundo plano
      }
      heygenSlotsRef.current++;
      acquireKeepAlive(); // mantém a aba viva (anti-freeze) por TODO o run desta task (dispatch→render→download→montagem)
      // Marca fase ATIVA imediatamente ao pegar o slot — fecha o gap entre
      // acquire e o runTaskInBackground setar 'dispatching'. Sem isso, o
      // watchdog poderia ver counter>active nesse intervalo e "curar" cedo
      // demais. (run/resume sobrescrevem a fase logo em seguida.)
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur || cur.phase !== 'queued') return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'dispatching', message: 'Pegando vaga...', finishedAt: undefined } };
      });
      try {
        // batchCancelRef pode ter sido setado entre espera e o try — re-checa.
        if (batchCancelRef.current[taskId]) return;
        batchCancelRef.current[taskId] = false;
        if (kind === 'resume') {
          await resumeTaskBatch(taskId);
        } else {
          await runTaskInBackground(taskId);
        }
      } catch (err) {
        // GARANTIA: o run NUNCA pode estourar uma excecao sem marcar a task
        // como terminal. runTaskInBackground/runVAPipelineForTask tem try/catch
        // INTERNO, mas o SETUP deles (buildPlan, acesso ao vaBriefing, asserts
        // `!`) roda ANTES desse try interno — se estourar ali, o erro subia ate
        // aqui sem ninguem marcar failed, e a task ficava ORFA em 'dispatching'
        // mostrando "Pegando vaga..." pra sempre (bug 2026-06-16: 1 task ok, as
        // outras 2 presas infinito; e como o slot e liberado no finally, um 3o
        // disparo entrava — parecendo furar o limite de 2). Aqui fechamos isso:
        // qualquer throw vira 'failed' com erro claro + botao Retomar.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[runHeyGenGated] ${taskId} estourou:`, err);
        // CHUNK: deploy novo invalidou os chunks → recarrega (estado persiste,
        // Retomar reaproveita). Guard geral que cobre run + resume.
        const chunkMsg = isChunkLoadError(err)
          ? '⚠ Saiu uma versão nova do app durante o processamento — recarregando pra atualizar. Seus takes estão salvos; depois clique Retomar.'
          : null;
        setBatchStates((prev) => {
          const cur = prev[taskId];
          if (!cur || cur.phase === 'done') return prev;
          return { ...prev, [taskId]: { ...cur, phase: 'failed', message: chunkMsg || `Falhou no disparo: ${msg}`, finishedAt: Date.now() } };
        });
        if (chunkMsg) reloadOnceForChunk();
      } finally {
        heygenSlotsRef.current = Math.max(0, heygenSlotsRef.current - 1);
        releaseKeepAlive();
      }
    } finally {
      delete heygenPendingRef.current[taskId];
      // rank 17: consome uma intenção de Retomar que chegou enquanto ESTE run ainda
      // segurava o pending (Pausar→Retomar rápido). Re-dispara no próximo tick, mas SÓ
      // se a task não concluiu (não re-roda um 'done', não gasta cota) e não voltou a
      // uma fase ativa. O guard heygenPendingRef (agora livre) dedupa o resto.
      const pend = pendingRetomarRef.current[taskId];
      if (pend) {
        delete pendingRetomarRef.current[taskId];
        const ph = batchStatesRef.current[taskId]?.phase;
        if (ph !== 'done' && !ACTIVE_BATCH_PHASES.includes(ph as BatchTaskState['phase'])) {
          setTimeout(() => { void runHeyGenGated(taskId, pend); }, 0);
        }
      }
    }
  }

  /** Conta slots REALMENTE ocupados a partir do batchStates (fonte da
   *  verdade que sobrevive reload/unmount), nao do contador em memoria.
   *  Uma task so ocupa slot quando esta numa fase ATIVA (dispatching..post).
   *  'queued' = esperando (nao ocupa); 'done'/'failed' = liberou. */
  function countActiveSlots(): number {
    return Object.values(batchStatesRef.current).filter(
      (b) => b.kind !== 'troca' && ACTIVE_BATCH_PHASES.includes(b.phase),
    ).length;
  }

  /** Debounce de leak: quantos ticks seguidos o contador ficou ACIMA do
   *  real. So cura apos 2 ticks (>~6s) pra nao confundir com o gap curtissimo
   *  entre acquire (slot++) e a fase virar 'dispatching'. */
  const slotLeakTicksRef = useRef(0);

  /** Ticks seguidos que cada task ficou ÓRFÃ (fase ativa porém sem wrapper
   *  rodando = heygenPendingRef ausente). Cura após 2 ticks pra não pegar o
   *  gap curtíssimo entre promover e o wrapper marcar a fase. */
  const orphanTicksRef = useRef<Record<string, number>>({});

  /** PROMOTER — FIFO (startedAt asc, sem furar fila): promove tasks 'queued'
   *  enquanto houver vaga real. Idempotente (heygenPendingRef dedup +
   *  runHeyGenGated). Chamado pelo effect on-change E pelo watchdog. */
  function promoteQueuedTasks() {
    if (heygenSlotsRef.current >= MAX_HEYGEN_PARALLEL) return;
    const queued = Object.values(batchStatesRef.current)
      // TROCA DE ÁUDIO roda fora do HeyGen — promoter NUNCA toca nelas.
      .filter((b) => b.phase === 'queued' && b.kind !== 'troca' && !heygenPendingRef.current[b.taskId])
      .sort((a, b) => a.startedAt - b.startedAt);
    if (queued.length === 0) return;
    const freeSlots = MAX_HEYGEN_PARALLEL - heygenSlotsRef.current;
    for (let i = 0; i < Math.min(freeSlots, queued.length); i++) {
      const b = queued[i];
      const kind: 'run' | 'resume' = b.parts.some((p) => p.videoId) ? 'resume' : 'run';
      void runHeyGenGated(b.taskId, kind);
    }
  }

  // Ref sempre com a versao MAIS RECENTE do promoter — o watchdog ([] deps)
  // precisa chamar closures atuais (taskAnalyses/runTaskInBackground frescos),
  // nao as do primeiro render.
  const promoterRef = useRef(promoteQueuedTasks);
  promoterRef.current = promoteQueuedTasks;

  // Promoter on-change: roda quando batchStates muda (run terminou → libera
  // slot → promove proxima).
  useEffect(() => {
    promoteQueuedTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStates]);

  /** WATCHER DE ESPERA DO HEYGEN (fix 2026-08-14).
   *
   *  Batch em 'waiting-heygen' = os takes que faltam AINDA estão renderizando lá
   *  (dia de instabilidade — o user pegou ~2h por parte). Não é falha, não gasta
   *  slot e ninguém re-dispara. Este watcher só fica cutucando o status a cada
   *  2min (GET leve, custo zero de cota) e, no instante em que os renders
   *  terminam, chama o RETOMAR sozinho — que resgata os vídeos prontos e fecha a
   *  montagem. O user não precisa ficar vigiando nem clicar em nada.
   *
   *  Se o HeyGen der falha REAL em algum, o RETOMAR também roda: aí o porteiro
   *  libera o re-disparo daquele take específico, que é o comportamento certo. */
  useEffect(() => {
    const CHECK_EVERY_MS = 2 * 60 * 1000;
    let busy = false;
    const id = setInterval(() => {
      if (busy) return;
      const waiting = Object.values(batchStatesRef.current).filter(
        (b) => b.phase === 'waiting-heygen' && (b.waitingVideoIds?.length || 0) > 0 && !heygenPendingRef.current[b.taskId],
      );
      if (waiting.length === 0) return;
      const due = waiting.filter((b) => Date.now() - (b.waitingCheckedAt || 0) >= CHECK_EVERY_MS);
      if (due.length === 0) return;
      busy = true;
      void (async () => {
        try {
          for (const b of due) {
            const ids = b.waitingVideoIds || [];
            let statuses: Record<string, VideoStatus>;
            try {
              statuses = await getVideosStatus(ids);
            } catch (e) {
              console.warn(`[waiting-heygen] re-check de ${b.taskId} falhou (tento no próximo tick):`, e);
              continue;
            }
            const done = ids.filter((i) => statuses[i]?.status === 'completed').length;
            const failed = ids.filter((i) => statuses[i]?.status === 'failed').length;
            const settled = done + failed >= ids.length;
            setBatchStates((prev) => {
              const cur = prev[b.taskId];
              if (!cur || cur.phase !== 'waiting-heygen') return prev;
              return {
                ...prev,
                [b.taskId]: {
                  ...cur,
                  waitingCheckedAt: Date.now(),
                  message: settled
                    ? `✓ O HeyGen terminou — retomando pra baixar e montar (nenhum take re-gerado).`
                    : `⏳ ${done}/${ids.length} take(s) prontos no HeyGen. Continuo esperando sem re-disparar — fecho sozinho quando terminarem.`,
                },
              };
            });
            if (settled) {
              console.log(`[waiting-heygen] ${b.taskId}: HeyGen concluiu (${done} pronto(s), ${failed} recusado(s)) — retomando automaticamente`);
              void runHeyGenGated(b.taskId, 'resume');
            }
          }
        } finally {
          busy = false;
        }
      })();
    }, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** WATCHDOG (a cada 3s) — GARANTIA de que a fila NUNCA congela:
   *
   *  1) AUTO-CURA do contador: o `heygenSlotsRef` e in-memory e pode VAZAR
   *     (ex: navegar pra outra aba/reload mata o wrapper antes do finally que
   *     decrementa; no remount o contador volta a 0 mas um run antigo pode ter
   *     deixado o numero torto). Se o contador ficar ACIMA do nº real de tasks
   *     em fase ativa por 2 ticks seguidos, reseta pro valor real. Sem isso,
   *     um contador preso em MAX deixava tasks 'queued' eternamente (bug
   *     reportado: A1 ficou em "aguardando vaga" com os 2 anteriores ja
   *     PRONTOS).
   *  2) RE-PROMOVE: mesmo que o effect on-change tenha perdido um evento,
   *     o watchdog promove FIFO toda vez que sobra vaga. */
  useEffect(() => {
    const id = setInterval(() => {
      const active = countActiveSlots();
      if (heygenSlotsRef.current > active) {
        slotLeakTicksRef.current += 1;
        if (slotLeakTicksRef.current >= 2) {
          console.warn(`[promoter] contador de slots curado: ${heygenSlotsRef.current} → ${active} (vazou; nenhum run ativo a mais).`);
          heygenSlotsRef.current = active;
          slotLeakTicksRef.current = 0;
        }
      } else {
        slotLeakTicksRef.current = 0;
      }

      // 3) AUTO-CURA DE ÓRFÃS: task PRESA em 'dispatching' (o "Pegando vaga...")
      //    porém SEM wrapper rodando (heygenPendingRef ausente) = o run saiu/
      //    estourou sem marcar terminal → ficaria assim pra sempre, ocupando
      //    slot fantasma e bloqueando a fila. O catch do runHeyGenGated já fecha
      //    o caminho conhecido; isto é a rede de segurança pra QUALQUER caminho
      //    futuro. ESCOPO em 'dispatching' de propósito: é a fase exata do bug,
      //    ANTES de qualquer mount/Magnific (rendering/post), então NUNCA marca
      //    por engano uma task que segue trabalhando num passo posterior.
      //    TROCA tem pipeline próprio (sem heygenPendingRef) → já não cai aqui.
      const orphanIds = new Set<string>();
      for (const b of Object.values(batchStatesRef.current)) {
        if (b.kind === 'troca') continue;
        if (b.phase !== 'dispatching') continue;
        if (heygenPendingRef.current[b.taskId]) continue; // wrapper vivo — ok
        orphanIds.add(b.taskId);
        orphanTicksRef.current[b.taskId] = (orphanTicksRef.current[b.taskId] || 0) + 1;
        if (orphanTicksRef.current[b.taskId] >= 2) {
          console.warn(`[promoter] task órfã curada (ativa sem wrapper): ${b.taskId} → failed`);
          delete orphanTicksRef.current[b.taskId];
          setBatchStates((prev) => {
            const cur = prev[b.taskId];
            // re-checa: se avançou de 'dispatching' nesse meio-tempo, está
            // progredindo — não marca falha.
            if (!cur || cur.phase !== 'dispatching') return prev;
            return { ...prev, [b.taskId]: { ...cur, phase: 'failed', message: 'Disparo travou (nenhum processo ativo) — clique Retomar pra re-disparar.', finishedAt: Date.now() } };
          });
        }
      }
      // zera o contador de quem deixou de ser órfã (voltou a rodar / terminou)
      for (const id of Object.keys(orphanTicksRef.current)) {
        if (!orphanIds.has(id)) delete orphanTicksRef.current[id];
      }

      promoterRef.current();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** RETOMAR (HeyGen lipsync) — funciona INDEPENDENTE da situacao:
   *  - tem videoIds disparados → re-checa status no HeyGen + re-baixa (rapido)
   *  - 0 disparados (ex: bloqueio/quota, erro antes do dispatch) → re-roda do
   *    zero (TTS+upload+submit+poll+zip). Garante botao util sempre.
   *  Gated por MAX_HEYGEN_PARALLEL — se 2 ja rodando, vira 'queued'. */
  function retomarTaskBatch(taskId: string) {
    // TROCA DE ÁUDIO: re-roda o pipeline proprio (nao tem HeyGen pra retomar).
    if (batchStates[taskId]?.kind === 'troca' || taskAnalyses[taskId]?.trocaBriefing) {
      void runTrocaAudioPipelineForTask(taskId);
      return;
    }
    // s pode estar ausente no estado React logo apos navegar pro motor
    // (restore ainda nao reidratou) — caimos no localStorage autoritativo.
    const s = batchStates[taskId];
    const persisted = !s ? (loadPersistedBatchStates() as Record<string, BatchTaskState>)[taskId] : null;
    const eff = s || persisted;
    const replan = eff?.replan || loadPersistedReplan(taskId);
    const hasResumableParts = !!eff?.parts?.some((p) => p.videoId);

    // GARANTIA: Retomar NUNCA fica mudo. Se nao da pra reconstruir (sem plano
    // salvo E sem partes ja disparadas), mostra um erro claro e acionavel em
    // vez de "nao acontecer nada". (Caso tipico: plano nao sobreviveu reload.)
    if (!replan && !hasResumableParts) {
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(eff || { taskId, taskName: taskId, baseAdId: taskId, parts: [], startedAt: Date.now() }),
          phase: 'failed',
          message:
            'Não dá pra retomar automaticamente (o plano não sobreviveu). Reabra a task na lista acima, clique em Start pra analisar e dispare de novo.',
          finishedAt: Date.now(),
        } as BatchTaskState,
      }));
      return;
    }

    // Sem entrada no state, mas com replan salvo: cria stub 'queued'.
    if (!eff && replan) {
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          taskId,
          taskName: replan.taskName,
          baseAdId: replan.baseAdId,
          phase: 'queued',
          parts: [],
          startedAt: Date.now(),
          message: 'Na fila — aguardando vaga...',
          replan,
        },
      }));
      void runHeyGenGated(taskId, 'run');
      return;
    }

    batchCancelRef.current[taskId] = false;
    const kind: 'run' | 'resume' = hasResumableParts ? 'resume' : 'run';
    // Marca 'queued' imediato pra UI esconder botoes — runHeyGenGated
    // ajusta a mensagem assim que o loop de espera comeca, ou pula direto
    // pro run/resume se ha vaga livre. Garante replan no state pra runTaskInBackground.
    setBatchStates((prev) => {
      const cur = prev[taskId] || eff;
      if (!cur) return prev;
      // Nao sobrescreve um state que ja esta rodando.
      if (ACTIVE_BATCH_PHASES.includes(cur.phase as BatchTaskState['phase'])) return prev;
      return { ...prev, [taskId]: { ...cur, replan: cur.replan || replan || undefined, phase: 'queued', message: 'Na fila — aguardando vaga...', finishedAt: undefined } };
    });
    void runHeyGenGated(taskId, kind);
  }

  // ═══════════════════ EDIT PART (re-gerar 1 take) ═══════════════════
  //
  // User clica EDIT em 1 card de preview → abre modal → edita texto →
  // REFRESH dispara so essa parte (mesmo label) via processJob → poll →
  // download → salva blob no IDB. Marca a parte como "dirty" pra que o
  // BatchJobCard3D mostre botao "Atualizar montagem" depois.

  const [editingPart, setEditingPart] = useState<
    | { taskId: string; partIdx: number; label: string; currentText: string }
    | null
  >(null);
  // Avatar/voice escolhidos no modal (controlados — pickers leem desses states).
  // Resetados ao abrir; lidos no regenerateSinglePart.
  const [editAvatar, setEditAvatar] = useState<AvatarOption | null>(null);
  const [editVoice, setEditVoice] = useState<{ id: string; name: string } | null>(null);
  const [regeneratingPart, setRegeneratingPart] = useState<{ taskId: string; label: string } | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [rebuildingTaskId, setRebuildingTaskId] = useState<string | null>(null);

  /** Procura AvatarOption completo na library cache pelo avatarId.
   *  Retorna null se nao achar (library nao carregada ou avatar deletado). */
  function findAvatarOptionById(avatarId: string | null | undefined): AvatarOption | null {
    if (!avatarId) return null;
    const snap = getLibrarySnapshot();
    for (const g of snap.groups) {
      for (const look of g.looks) {
        if (look.id === avatarId) {
          return {
            id: look.id,
            name: look.name || g.name,
            thumb: look.thumb || g.thumb || null,
            videoPreview: (look as any).videoPreview || null,
            type: g.type,
            version: g.version,
            groupId: g.id,
            groupName: g.name,
          } as AvatarOption;
        }
      }
    }
    return null;
  }

  function openEditPart(taskId: string, partIdx: number) {
    const b = batchStates[taskId];
    if (!b) return;
    const part = b.parts[partIdx];
    if (!part) return;
    const replanPart = b.replan?.parts[partIdx];
    setRegenError(null);
    // Pre-popula avatar + voice com o que ja esta usando
    const currentAvatar = findAvatarOptionById(replanPart?.avatarId);
    setEditAvatar(currentAvatar);
    setEditVoice(replanPart?.voiceId ? { id: replanPart.voiceId, name: '' } : null);
    setEditingPart({
      taskId,
      partIdx,
      label: part.label,
      currentText: replanPart?.text || '',
    });
    // Garante library carregada (no-op se ja em cache)
    void reloadLibrary(false);
  }

  async function regenerateSinglePart(newText: string) {
    if (!editingPart) return;
    const { taskId, partIdx, label } = editingPart;
    const b = batchStates[taskId];
    const genId = b?.genId; // isolação por geração: grava/invalida na geração atual
    const replanPart = b?.replan?.parts[partIdx];
    if (!b || !replanPart) {
      setRegenError('Sem dados de replan — refaz a analise da task.');
      return;
    }
    // Avatar pode vir do picker (editAvatar) OU do replan antigo. Cena em MODO
    // IMAGEM não tem avatar nenhum — a imagem faz esse papel —, então só é erro
    // quando não há NEM avatar NEM imagem guardada.
    const imageKeyDaParte = (replanPart as any).imageKey || null;
    const effectiveAvatarId = editAvatar?.id || replanPart.avatarId;
    if (!effectiveAvatarId && !imageKeyDaParte) {
      setRegenError('Escolha um avatar — sem avatar nao da pra disparar.');
      return;
    }
    // Voz pode vir do picker (editVoice) OU do replan antigo. Null = voz padrao do avatar.
    const effectiveVoiceId = editVoice?.id || replanPart.voiceId || null;
    if (newText.trim().length === 0) {
      setRegenError('Texto vazio — preenche o script.');
      return;
    }
    // Captura o vídeo NEGADO (se a parte falhou) ANTES do reset de state — vai
    // ser excluído do HeyGen antes do novo submit (anti-memória de moderação).
    const prevPart = b.parts[partIdx];
    const rejectedVideoId = prevPart?.videoStatus === 'failed' ? (prevPart.videoId || null) : null;
    setRegeneratingPart({ taskId, label });
    setRegenError(null);
    // FECHA O MODAL NA HORA: a re-geração (dispatch + poll de até 25min + download)
    // roda em BACKGROUND — o card já mostra o progresso da parte (isRegenThis) e, se
    // falhar (ex: HeyGen rejeitou o texto por moderação), o erro aparece NO CARD, não
    // num modal travado na frente do user. Tudo que o resto precisa (taskId/partIdx/
    // label/avatar/voz) já foi capturado acima. (User reportou 2026-07-01: modal preso.)
    setEditingPart(null);

    try {
      // 1) Atualiza replan local com novo texto + novo avatar + nova voz
      //    (persiste no localStorage automaticamente via useEffect persistBatchStates).
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur || !cur.replan) return prev;
        const newReplanParts = cur.replan.parts.map((p, i) => i === partIdx
          ? { ...p, text: newText, avatarId: effectiveAvatarId || null, voiceId: effectiveVoiceId }
          : p);
        return {
          ...prev,
          [taskId]: {
            ...cur,
            replan: { ...cur.replan, parts: newReplanParts },
            // Reseta status visual da parte pra pending enquanto re-gera
            parts: cur.parts.map((p, i) => i === partIdx
              ? { ...p, videoStatus: 'pending' as const, videoUrl: null, error: null }
              : p),
          },
        };
      });

      // 1.5) EXCLUI o vídeo negado do HeyGen antes do novo submit. Sem isso,
      //      re-gerar o MESMO texto era negado de novo (o HeyGen "lembra" do
      //      registro negado vivo no histórico). Best-effort: não bloqueia.
      if (rejectedVideoId) {
        await purgeRejectedVideosBeforeRedispatch([{ videoId: rejectedVideoId, error: prevPart?.error }], 'edit-part');
      }

      // 2) Dispara com novo texto + (talvez) novo avatar + (talvez) nova voz
      const adNameSafe = b.baseAdId.replace(/[^A-Z0-9]/gi, '_');
      let job: { videoId: string | null };
      if (!effectiveAvatarId && imageKeyDaParte) {
        // MODO IMAGEM: sem avatar, a imagem é o sujeito. Mesmo caminho do
        // disparo (runHeyGenJobs → /api/heygen/image-video), senão editar o
        // texto de uma cena de imagem era impossível.
        const { loadBlob } = await import('@/lib/zip-store');
        const blob = await loadBlob(imageKeyDaParte, 'image/jpeg');
        if (!blob) throw new Error('A imagem dessa cena não está mais guardada — reaplica o plano com o frame.');
        if (!effectiveVoiceId) throw new Error('Modo imagem exige uma voz escolhida (sem avatar não há voz padrão).');
        const fd = new FormData();
        fd.append('image', blob, 'frame.jpg');
        fd.append('script', newText);
        fd.append('voiceId', effectiveVoiceId);
        const motionDaParte = (replanPart as any).motionPrompt;
        if (motionDaParte) fd.append('motionPrompt', String(motionDaParte));
        fd.append('title', `${adNameSafe}_${label}_edit`);
        fd.append('aspectRatio', '9:16');
        const r = await fetch('/api/heygen/image-video', { method: 'POST', body: fd });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.videoId) throw new Error(j?.error || `Falha no modo imagem (HTTP ${r.status}).`);
        job = { videoId: j.videoId };
      } else {
        const { processJob } = await import('@/lib/heygen-api-direct');
        job = await processJob({
          text: newText,
          voiceId: effectiveVoiceId || undefined,
          title: `${adNameSafe}_${label}_edit`,
          avatarId: effectiveAvatarId!,
          engine: 'iii',
          orientation: 'portrait',
        });
      }
      if (!job.videoId) throw new Error('O disparo nao retornou videoId.');

      // 3) Atualiza state com novo videoId (overwrite o antigo)
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        const newParts = cur.parts.map((p, i) => i === partIdx
          ? { ...p, videoId: job.videoId, videoStatus: 'pending' as const, videoUrl: null, error: null }
          : p);
        return { ...prev, [taskId]: { ...cur, parts: newParts } };
      });

      // 4) Poll ate completar (zombie kill 15min pra evitar hang)
      const statuses = await pollVideosUntilReady([job.videoId], {
        intervalMs: 8000,
        timeoutMs: 25 * 60 * 1000,
        maxPendingMsPerId: 15 * 60 * 1000,
      });
      const st = statuses[job.videoId];
      if (!st || st.status !== 'completed' || !st.videoUrl) {
        throw new Error(`Re-render falhou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
      }

      // 5) Baixa o MP4 + salva blob no IDB (substitui o antigo). RETOMAR
      //    futuro vai hidratar essa parte do IDB sem re-baixar.
      const bytes = await downloadVideoBytes(st.videoUrl);
      const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
      try {
        const { saveBlob, deleteZip, deletePrefix } = await import('@/lib/zip-store');
        await saveBlob(pilotPartKey(taskId, genId, label), partBlob, 'video/mp4');
        // Parte MUDOU → invalida os clips derivados (leveled/decupado) dela, pra
        // o rebuild ("Atualizar montagem") recomputar SÓ essa parte e não reusar
        // cache stale. As outras partes seguem cacheadas (rebuild rápido). O
        // decupado é por intensidade (`...:<label>@k<sec>`) → deletePrefix limpa
        // TODAS as intensidades dessa parte de uma vez.
        await deleteZip(`${pilotGenPrefix(taskId, genId)}leveled:${label}`).catch(() => {});
        await deletePrefix(`${pilotGenPrefix(taskId, genId)}decupado:${label}@k`).catch(() => {});
        await deleteZip(`${pilotGenPrefix(taskId, genId)}decupado:${label}`).catch(() => {}); // legado (chave antiga sem intensidade)
      } catch (e) { console.warn('[edit-part] save blob IDB falhou:', e); }

      // 6) Atualiza state final com URL pronta + marca como dirty (montagem
      //    fica desatualizada ate user clicar "Atualizar montagem")
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        const newParts = cur.parts.map((p, i) => i === partIdx
          ? { ...p, videoUrl: st.videoUrl, videoStatus: 'completed' as const }
          : p);
        const dirty = new Set(cur.dirtyParts || []);
        dirty.add(label);
        return { ...prev, [taskId]: { ...cur, parts: newParts, dirtyParts: Array.from(dirty) } };
      });

      // (modal já foi fechado no início — a re-geração rodou em background)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRegenError(msg); // caso o modal tenha sido reaberto no meio-tempo
      // Modal já fechado → mostra o erro NO CARD: a parte volta a 'failed' com a
      // mensagem, e o user pode clicar EDIT de novo pra ajustar o texto (ex: o HeyGen
      // rejeitou por moderação) ou subir um áudio no lugar — sem ficar preso na tela.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return {
          ...prev,
          [taskId]: {
            ...cur,
            // "Ainda renderizando" NÃO vira falha: o HeyGen está lento, o render
            // segue vivo e o card mostra âmbar em vez do ⚠ vermelho.
            parts: cur.parts.map((p, i) => i === partIdx
              ? isSyntheticPollError(msg)
                ? { ...p, videoStatus: 'stalled' as const, error: msg }
                : { ...p, videoStatus: 'failed' as const, error: `Re-gerar falhou: ${msg}` }
              : p),
          },
        };
      });
    } finally {
      setRegeneratingPart(null);
    }
  }

  /** Contorna a falha de UMA parte subindo um ÁUDIO no lugar do texto: faz upload
   *  do áudio pro HeyGen e o avatar dá lipsync nele (audio_type 'uploaded'),
   *  pulando o TTS que quebrou. Espelha regenerateSinglePart (mesma máquina
   *  provada: dispara → poll → baixa → salva blob no IDB → marca dirty), mas a
   *  fonte é o áudio do user, não o script. NÃO mexe no texto do replan (o áudio
   *  manda no MP4 final); se ESTE disparo falhar, a parte volta a 'failed' com o
   *  erro no card e o RETOMAR ainda pode tentar pelo texto. */
  async function regenerateSinglePartFromAudio(taskId: string, partIdx: number, file: File) {
    const b = batchStates[taskId];
    const genId = b?.genId; // isolação por geração: grava/invalida na geração atual
    const part = b?.parts[partIdx];
    const replanPart = b?.replan?.parts[partIdx];
    if (!b || !part || !replanPart) {
      setError('Sem dados de replan dessa parte — refaz a análise da task.');
      return;
    }
    const label = part.label;
    const effectiveAvatarId = replanPart.avatarId;
    if (!effectiveAvatarId) {
      setError(`Parte ${label}: sem avatar no plano — não dá pra disparar com áudio.`);
      return;
    }
    if (!file || file.size < 1024) {
      setError(`Áudio inválido pra parte ${label}.`);
      return;
    }
    // Captura o vídeo NEGADO pra excluir do HeyGen antes do novo submit
    // (anti-memória de moderação — mesma blindagem do regenerateSinglePart).
    const rejectedVideoId = part.videoStatus === 'failed' ? (part.videoId || null) : null;
    const rejectedError = part.error;

    // Marca a parte como "re-gerando agora" (overlay no card) + reseta erro.
    setRegeneratingPart({ taskId, label });
    setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      return {
        ...prev,
        [taskId]: {
          ...cur,
          parts: cur.parts.map((p, i) => i === partIdx
            ? { ...p, videoStatus: 'pending' as const, videoUrl: null, error: null }
            : p),
        },
      };
    });

    try {
      // EXCLUI o vídeo negado antes do novo submit (anti-memória de moderação).
      if (rejectedVideoId) {
        await purgeRejectedVideosBeforeRedispatch([{ videoId: rejectedVideoId, error: rejectedError }], 'edit-part-audio');
      }
      const { processJob } = await import('@/lib/heygen-api-direct');
      const adNameSafe = b.baseAdId.replace(/[^A-Z0-9]/gi, '_');
      // MODO ÁUDIO: processJob com `file` → uploadAudio + createVideo
      // (audio_type 'uploaded'); o avatar faz lipsync no áudio enviado.
      const job = await processJob({
        file,
        title: `${adNameSafe}_${label}_audio`,
        avatarId: effectiveAvatarId,
        engine: 'iii',
        orientation: 'portrait',
      });
      if (!job.videoId) throw new Error('processJob (áudio) não retornou videoId.');

      // Guarda o videoId novo (overwrite o que falhou).
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return {
          ...prev,
          [taskId]: {
            ...cur,
            parts: cur.parts.map((p, i) => i === partIdx
              ? { ...p, videoId: job.videoId, videoStatus: 'pending' as const, videoUrl: null, error: null }
              : p),
          },
        };
      });

      const statuses = await pollVideosUntilReady([job.videoId], {
        intervalMs: 8000,
        timeoutMs: 25 * 60 * 1000,
        maxPendingMsPerId: 15 * 60 * 1000,
      });
      const st = statuses[job.videoId];
      if (!st || st.status !== 'completed' || !st.videoUrl) {
        throw new Error(`Render do áudio falhou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
      }

      // Baixa o MP4 + salva no IDB (substitui o antigo). Invalida clips derivados
      // (leveled/decupado, todas as intensidades) pra montagem recomputar SÓ ela.
      const bytes = await downloadVideoBytes(st.videoUrl);
      const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
      try {
        const { saveBlob, deleteZip, deletePrefix } = await import('@/lib/zip-store');
        await saveBlob(pilotPartKey(taskId, genId, label), partBlob, 'video/mp4');
        await deleteZip(`${pilotGenPrefix(taskId, genId)}leveled:${label}`).catch(() => {});
        await deletePrefix(`${pilotGenPrefix(taskId, genId)}decupado:${label}@k`).catch(() => {});
        await deleteZip(`${pilotGenPrefix(taskId, genId)}decupado:${label}`).catch(() => {});
      } catch (e) { console.warn('[edit-part-audio] save blob IDB falhou:', e); }

      // Marca completa + dirty → aparece "Atualizar montagem" pra fechar o AD.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        const dirty = new Set(cur.dirtyParts || []);
        dirty.add(label);
        return {
          ...prev,
          [taskId]: {
            ...cur,
            parts: cur.parts.map((p, i) => i === partIdx
              ? { ...p, videoUrl: st.videoUrl, videoStatus: 'completed' as const, error: null }
              : p),
            dirtyParts: Array.from(dirty),
          },
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Volta a parte pra 'failed' com o erro no card (não trava em "pending").
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return {
          ...prev,
          [taskId]: {
            ...cur,
            parts: cur.parts.map((p, i) => i === partIdx
              ? isSyntheticPollError(msg)
                ? { ...p, videoStatus: 'stalled' as const, error: msg }
                : { ...p, videoStatus: 'failed' as const, error: `áudio: ${msg}` }
              : p),
          },
        };
      });
      setError(`Parte ${label} (áudio): ${msg}`);
    } finally {
      setRegeneratingPart(null);
    }
  }

  // ═══════════════════ REBUILD MONTAGE (refazer ZIPs) ═══════════════════
  //
  // Apos editar 1+ takes, user clica "Atualizar montagem" — re-roda
  // runPostPipeline com TODOS os blobs do IDB (fresh) e gera novos
  // montadoZipUrl/camufladoZipUrl. dirtyParts limpa pra zerar o flag.

  async function rebuildMontage(taskId: string) {
    const b = batchStates[taskId];
    if (!b) return;
    const genId = b.genId; // isolação por geração: hidrata só os takes DESTA geração
    setRebuildingTaskId(taskId);
    try {
      const { loadBlob } = await import('@/lib/zip-store');
      // Hidrata blobs do IDB (todos, fresh — incluindo os editados)
      // expected:true = parte COM conteúdo (texto no plano) → DEVE ter blob.
      // Texto do replan, NÃO videoId: parte com texto que falhou dispatch segue
      // esperada → gate de incompleta (não sai "faltando texto" como 100%).
      // Sem replan (batch antigo) → !!videoId.
      const rbExpected = (i: number, p: { videoId: string | null }) => {
        const t = b.replan?.parts?.[i]?.text;
        return t != null ? !!String(t).trim() : !!p.videoId;
      };
      const partBlobs: Array<{ label: string; blob: Blob | null; expected?: boolean }> = await Promise.all(
        b.parts.map(async (p, i) => {
          const expected = rbExpected(i, p);
          if (!p.videoId) return { label: p.label, blob: null, expected };
          try {
            const blob = await loadBlob(pilotPartKey(taskId, genId, p.label), 'video/mp4');
            return { label: p.label, blob: blob && blob.size > 1024 ? blob : null, expected };
          } catch { return { label: p.label, blob: null, expected }; }
        }),
      );

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'post', message: 'Re-montando com parts editadas...', finishedAt: undefined },
      }));

      const _tc = getTaskCamuflagem(taskId);
      const pipeRes = await runPostPipelineSerial({
        baseAdId: b.baseAdId,
        parts: partBlobs,
        decupagem: isDecupagemEnabled(taskId),
        keepSilenceSec: getDecupIntensity(taskId),
        camuflagem: _tc.camuflagem,
        whiteAudio: _tc.whiteAudio,
        camuflagemVolume: _tc.camuflagemVolume,
        // Atualizar montagem: reusa cache das partes NÃO editadas; as editadas
        // tiveram o cache invalidado na hora da edição (regen) → recomputam só elas.
        readClipCache: true,
        ...makeClipCacheHooks(taskId, getDecupIntensity(taskId), genId),
        onProgress: (p) => {
          setBatchStates((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
          }));
        },
      }, taskId);

      // Reconstroi os ZIPs (montado + camo) — mesmo pattern do resumeTaskBatch
      const JSZip = (await import('jszip')).default;
      const assembled = pipeRes.items;
      const adNameClean = b.baseAdId.replace(/[^A-Z0-9]/gi, '_');

      // ZIP montado
      const zipMont = new JSZip();
      for (const item of assembled) {
        if (item.decupado) zipMont.file(item.filename, item.decupado);
        else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
          const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
          zipMont.file(baseName, item.rawAssembled);
          zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro');
        } else {
          zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
            `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
        }
      }
      zipMont.file('_DIAGNOSTICO.txt', `Re-montagem apos edicao de parts\n${pipeRes.diagnostics.summary}\n`);
      const montBlob = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
      const montadoUrl = URL.createObjectURL(montBlob);
      await persistDeliverableOrRescue(`batch:${taskId}:montado`, montBlob, montadoName);

      // ZIP camo (se modo ON)
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          else zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || 'falha');
        }
        const camuBlob = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(camuBlob);
        // GUARD: zip só de erro NÃO sobrescreve camuflado BOM no IDB (o F5
        // re-hidrata o download de lá) — mesma política do montado.
        if (assembled.some((it) => !!it.camuflado)) {
          await persistDeliverableOrRescue(`batch:${taskId}:camo`, camuBlob, camuName);
        }
      }

      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        // Montagem INCOMPLETA (faltou parte esperada) NÃO conta como ok →
        // trava o "100% pronto" e o download limpo (o user NUNCA recebe
        // "faltando texto" como se estivesse pronto).
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0 && !it.missingParts?.length).length,
        incompleteMontagens: assembled.filter((it) => !!it.missingParts?.length).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };

      // Revoga URLs antigas antes de substituir (memoria)
      for (const url of [b.montadoZipUrl, b.camufladoZipUrl]) {
        if (url) { try { URL.revokeObjectURL(url); } catch {} }
      }

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: `Re-montado · ${pipeRes.diagnostics.summary}`,
          finishedAt: Date.now(),
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
          dirtyParts: [], // limpa flag — montagem ta fresh
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'done', message: `Re-montagem falhou: ${msg}`, finishedAt: Date.now() },
      }));
    } finally {
      setRebuildingTaskId(null);
    }
  }

  /** PAUSAR (HeyGen lipsync) — aborta o processamento atual dessa task.
   *  O run em andamento detecta o cancel e encerra; depois o botao RETOMAR
   *  re-checa/baixa o que ja renderizou ou re-roda do zero. */
  function pausarTaskBatch(taskId: string) {
    batchCancelRef.current[taskId] = true;
    // MONTAGEM (phase 'post' = ffmpeg-wasm client-side): o flag de cancel NÃO é
    // checado DENTRO de um exec travado → sem isto o pause não solta a montagem.
    // Mata o worker na hora: o pipeline cai no catch/retry e ENCERRA o run, o que
    // libera o heygenPendingRef → o Retomar seguinte funciona (antes ficava no-op
    // porque o run antigo seguia "vivo" pendurado). cancelFFmpeg é GLOBAL, então
    // só dispara quando ESTA task está de fato montando; uma op saudável
    // concorrente no máximo sofre 1 retry (a MESMA recuperação já usada pros hangs
    // intermitentes do wasm) — não quebra nada que já funciona.
    if (batchStatesRef.current[taskId]?.phase === 'post'
        && (_ffmpegOwnerTaskId === taskId || _ffmpegOwnerTaskId === null)) {
      // Só mata o ffmpeg quando ESTA task é a que está de fato montando (dona do
      // singleton) OU quando o dono é desconhecido (null → fallback ao comportamento
      // atual, pra não regredir o pause). Com 2 montagens em 'post' ao mesmo tempo,
      // pausar a que só ESPERA na fila serial não pode matar o exec da que TRABALHA.
      // Import DINÂMICO (não puxa o wasm pro bundle). Fire-and-forget: o setState de
      // 'failed' abaixo roda já.
      void import('@/lib/ffmpeg-worker')
        .then(({ cancelFFmpeg }) => { try { cancelFFmpeg(); } catch { /* ignora */ } })
        .catch(() => { /* ignora */ });
    }
    setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur || cur.phase === 'done' || cur.phase === 'failed') return prev;
      // CRÍTICO: SAI das fases ativas (phase→'failed') pra isRunning virar false e
      // o botão Retomar HABILITAR. Antes só trocava a message e mantinha a phase
      // ('post'/'rendering'/...), então o card seguia "rodando" e o Retomar ficava
      // desabilitado pra sempre (user reportou 2026-07-01: "clico e nem libera o
      // retomar"). O Retomar reconstrói do cache (IDB), sem re-render no HeyGen.
      return { ...prev, [taskId]: { ...cur, phase: 'failed', message: '⏸ Pausado pelo user — clique Retomar', finishedAt: Date.now() } };
    });
  }

  /** DEBUG (HeyGen lipsync) — reserva pra casos de bug: reinicia o processo
   *  de gerar os lips DESSA task do ZERO (re-dispatch completo). Aborta o
   *  run atual e recomeca limpo. Gated por MAX_HEYGEN_PARALLEL. */
  function debugTaskBatch(taskId: string, skipConfirm = false) {
    // TROCA DE ÁUDIO: re-roda o pipeline proprio do zero (sem HeyGen).
    if (batchStates[taskId]?.kind === 'troca' || taskAnalyses[taskId]?.trocaBriefing) {
      if (!skipConfirm && !confirm('Refazer a troca de áudio dessa task do zero?')) return;
      void runTrocaAudioPipelineForTask(taskId);
      return;
    }
    if (!skipConfirm && !confirm('DEBUG: reiniciar a geracao de LIPS dessa task do zero?\n\nVai re-disparar TODAS as partes no HeyGen (cria videos novos).')) return;
    batchCancelRef.current[taskId] = true;
    // Pequeno delay deixa o run atual (se houver) abortar antes do restart.
    setTimeout(() => {
      batchCancelRef.current[taskId] = false;
      // Marca queued pra UI; runHeyGenGated promove direto se ha vaga.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'queued', message: 'Debug — recriando do zero (aguardando vaga)...', finishedAt: undefined } };
      });
      void runHeyGenGated(taskId, 'run');
    }, 300);
  }

  /** Baixa o ZIP de takes Magnific do IndexedDB (Blob URL nao sobrevive
   *  reload — sempre reconstruimos on-demand do zip-store). */
  async function downloadMagnificZip(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job?.zipKey) return;
    try {
      const { loadZip } = await import('@/lib/zip-store');
      const rec = await loadZip(job.zipKey);
      if (!rec) {
        setError('Esse pacote de B-rolls não está mais salvo no navegador. Gere de novo pela task.');
        return;
      }
      const a = document.createElement('a');
      a.href = rec.blobUrl;
      a.download = rec.filename || job.zipName || `${job.adName}_brolls.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(rec.blobUrl); } catch {} }, 60000);
    } catch (e) {
      setError('Falha baixando ZIP Magnific: ' + ((e as Error)?.message || 'erro'));
    }
  }

  function removeMagnificJob(taskId: string) {
    magnificCancelRef.current[taskId] = true;
    if (magnificActiveRef.current?.taskId === taskId) {
      magnificStopIntentRef.current[taskId] = 'paused';
      try { magnificAbortRef.current?.abort(); } catch {}
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
    }
    setMagnificQueueState((prev) => {
      const { [taskId]: _, ...rest } = prev;
      return rest;
    });
    setMagnificTick((t) => t + 1);
  }

  /** Helper: se `taskId` for o job Magnific ativo, aborta e LIBERA a fila
   *  (intent define como o processor vai assentar o status). */
  function stopActiveMagnificIfCurrent(taskId: string, intent: 'paused' | 'debug') {
    magnificStopIntentRef.current[taskId] = intent;
    magnificCancelRef.current[taskId] = true;
    if (magnificActiveRef.current?.taskId === taskId) {
      try { magnificAbortRef.current?.abort(); } catch {}
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
    }
  }

  /** PAUSAR (Magnific) — para o job (rodando ou na fila). Outro job so
   *  inicia se este estiver pausado/finalizado (regra serial mantida). */
  function pauseMagnificJob(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job || job.status === 'done') return;
    stopActiveMagnificIfCurrent(taskId, 'paused');
    patchMagnificJob(taskId, {
      status: 'paused',
      message: '⏸ Pausado pelo user — clique Retomar',
      finishedAt: Date.now(),
    });
    setMagnificTick((t) => t + 1);
  }

  /** RETOMAR (Magnific) — volta o job pra fila. So roda quando nenhum
   *  outro estiver rodando (pickNextMagnificJob garante serial 1/vez). */
  function resumeMagnificJob(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job || job.status === 'running' || job.status === 'done') return;
    magnificStopIntentRef.current[taskId] = null;
    magnificCancelRef.current[taskId] = false;
    patchMagnificJob(taskId, {
      status: 'queued',
      gateOnHeyGen: false,
      message: `Na fila Magnific (${job.takeCount} takes) — aguardando vez...`,
      finishedAt: undefined,
      percent: 0,
    });
    setMagnificTick((t) => t + 1);
  }

  /** DEBUG (Magnific) — reserva p/ bugs (ex: loop infinito no generate
   *  image). Aborta o run atual e RE-ENFILEIRA do zero; ao rodar de novo
   *  o runMagnificPipeline cria um SPACE NOVO (nunca reusa existingSpaceId
   *  aqui), saindo do estado bugado. */
  function debugMagnificJob(taskId: string, skipConfirm = false) {
    const job = magnificQueue[taskId];
    if (!job) return;
    if (!skipConfirm && !confirm('DEBUG: reiniciar a geracao de takes dessa task do ZERO?\n\nAborta o processo atual e cria um SPACE NOVO no Magnific (sai de loop/bug).')) return;
    stopActiveMagnificIfCurrent(taskId, 'debug');
    // Re-enfileira limpo. O processor pega quando nenhum outro estiver
    // rodando; runMagnificPipeline cria space novo automaticamente.
    setTimeout(() => {
      magnificStopIntentRef.current[taskId] = null;
      magnificCancelRef.current[taskId] = false;
      patchMagnificJob(taskId, {
        status: 'queued',
        gateOnHeyGen: false,
        message: '🐞 Debug — recriando do zero (space novo)...',
        zipKey: undefined,
        zipName: undefined,
        percent: 0,
        successCount: undefined,
        finishedAt: undefined,
      });
      setMagnificTick((t) => t + 1);
    }, 300);
  }

  /** Handler dos comandos vindos de outras telas (lipsync-history,
   *  heygen-auto, auto-broll) via command-bus. Ref atualizada a cada
   *  render pra sempre fechar sobre o estado/funcoes ATUAIS (sem stale
   *  closure no setInterval). */
  const jobCmdHandlerRef = useRef<(c: JobCommand) => void>(() => {});
  jobCmdHandlerRef.current = (c: JobCommand) => {
    try {
      if (c.scope === 'heygen') {
        if (c.action === 'retomar') retomarTaskBatch(c.taskId);
        else if (c.action === 'pausar') pausarTaskBatch(c.taskId);
        else if (c.action === 'debug') debugTaskBatch(c.taskId, true);
      } else {
        if (c.action === 'retomar') resumeMagnificJob(c.taskId);
        else if (c.action === 'pausar') pauseMagnificJob(c.taskId);
        else if (c.action === 'debug') debugMagnificJob(c.taskId, true);
      }
    } catch (e) {
      console.error('[job-commands] falha executando', c, e);
    }
  };

  /** Consumidor do command-bus: o motor real (este componente) executa
   *  Retomar/Pausar/Debug pedidos de qualquer tela. Mount + poll 1.5s +
   *  storage event (cross-aba imediato). */
  useEffect(() => {
    const consume = () => {
      const cmds = readJobCommands();
      if (cmds.length === 0) return;
      for (const c of cmds) {
        jobCmdHandlerRef.current(c);
        clearJobCommand(c.id);
      }
    };
    pruneStaleJobCommands();
    consume();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'darkolab:clickup-pilot:commands') consume();
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(consume, 1500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  function downloadZip(taskId: string) {
    const s = batchStates[taskId];
    if (!s?.zipBlobUrl || !s.zipFilename) return;
    const a = document.createElement('a');
    a.href = s.zipBlobUrl;
    a.download = s.zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** Cache de resultados visual match (key = briefingFileId) — evita
   *  re-spend API se o user re-analisa ou roda batch IA Search */
  const visualCacheRef = useRef<Record<string, { matched: { id: string; name: string; groupName?: string } | null; confidence: string; reason: string }>>({});

  /** Roda visual match (Claude vision) pra UM slot. Compara thumb do briefing
   *  com todas as thumbs da biblioteca HeyGen, pega o melhor visual match. */
  const [visualMatching, setVisualMatching] = useState<Record<string, boolean>>({});
  async function runVisualMatchForSlot(taskId: string, roleIdx: number) {
    const a = taskAnalyses[taskId];
    const slot = a?.roleSlots?.[roleIdx];
    if (!slot?.briefingFileId) {
      setError('O briefing não tem vídeo anexado — a busca visual precisa de uma imagem de referência.');
      setErrorAction(null);
      return;
    }
    if (hasAnthropic === false) {
      setError('Configure sua chave Anthropic (Claude) pra usar IA Search visual.');
      setErrorAction({ label: 'Configurar chave', href: '/configuracoes/api' });
      return;
    }
    const key = `${taskId}:${roleIdx}`;
    setVisualMatching((p) => ({ ...p, [key]: true }));
    clearError();
    try {
      // Cache check primeiro — evita re-spend API se ja rodou pra esse fileId
      const cached = visualCacheRef.current[slot.briefingFileId];
      let result = cached;
      if (!result) {
        const refUrl = `https://drive.google.com/thumbnail?id=${slot.briefingFileId}&sz=w400`;
        const cands = avatarCandidates
          .filter((c) => c.thumb)
          .slice(0, 20)
          .map((c) => ({ id: c.id, name: c.name, groupName: c.groupName, thumbUrl: c.thumb! }));
        if (cands.length === 0) {
          setError('Biblioteca vazia ou sem thumbs.');
          setErrorAction(null);
          return;
        }
        const r = await fetch('/api/avatar-visual-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceImageUrl: refUrl, candidates: cands }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          // missingKey marca chave Anthropic nao configurada — oferece link direto
          if (j?.missingKey === 'anthropic') {
            setHasAnthropic(false);
            setError('Configure sua chave Anthropic (Claude) pra usar IA Search visual.');
            setErrorAction({ label: 'Configurar chave', href: '/configuracoes/api' });
            return;
          }
          setError(`A busca visual falhou: ${j?.error || 'tenta de novo em instantes.'}`);
          setErrorAction(null);
          return;
        }
        result = { matched: j.matched, confidence: j.confidence, reason: j.reason };
        visualCacheRef.current[slot.briefingFileId] = result;
      }
      if (!result.matched) {
        setError(`IA Search: Claude nao identificou match visual confiavel. Confianca: ${result.confidence}. ${result.reason || ''}`);
        setErrorAction(null);
        return;
      }
      const candFull = avatarCandidates.find((c) => c.id === result.matched!.id);
      updateRoleSlot(taskId, roleIdx, {
        avatarId: result.matched.id,
        avatarName: result.matched.name,
        avatarThumb: candFull?.thumb || null,
        avatarVoiceId: candFull?.voiceId || null,
        matchedBy: `visual (${result.confidence})`,
      });
    } catch (e) {
      setError(`IA Search erro: ${(e as Error)?.message}`);
      setErrorAction(null);
    } finally {
      setVisualMatching((p) => ({ ...p, [key]: false }));
    }
  }

  /** Roda IA Search em todos os slots pendentes da task em sequencia */
  async function runVisualMatchAllPendingForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a?.roleSlots) return;
    const pendingIdxs = a.roleSlots.map((s, i) => s.avatarId === null && s.briefingFileId ? i : -1).filter(i => i >= 0);
    if (pendingIdxs.length === 0) return;
    for (const idx of pendingIdxs) {
      await runVisualMatchForSlot(taskId, idx);
    }
  }

  /** Atualiza UM roleSlot da task. Usado quando user troca avatar OU voz.
   *  Side-effect: salva memoria voice↔avatar quando ambos estao definidos +
   *  matchedBy nao e 'memory' (evita loop de re-salvar a mesma memoria). */
  function updateRoleSlot(taskId: string, roleIdx: number, patch: Partial<RoleSlot>) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.roleSlots) return prev;
      const prevSlot = a.roleSlots[roleIdx];
      const newSlots = a.roleSlots.map((s, i) => i === roleIdx ? { ...s, ...patch } : s);
      // MEMORIA AVATAR → VOZ: se o user trocou o AVATAR (e nao mexeu na voz
      // no mesmo patch) e ja existe voz lembrada pra esse avatar, ja traz
      // a voz de volta automaticamente (pode trocar depois normalmente).
      const avatarChanged =
        'avatarId' in patch && patch.avatarId && patch.avatarId !== prevSlot?.avatarId;
      if (avatarChanged && !('voiceOverride' in patch)) {
        const mem = recallAvatarVoice(patch.avatarId!);
        if (mem) {
          newSlots[roleIdx] = {
            ...newSlots[roleIdx],
            voiceOverride: { id: mem.voiceId, name: mem.voiceName },
          };
        }
      }
      const allHaveAvatar = newSlots.every(slotPronto);
      const updated = newSlots[roleIdx];
      // Salva memoria: voz usada (override OU padrao do avatar) → avatarId
      const effectiveVoiceId = updated.voiceOverride?.id || updated.avatarVoiceId;
      const effectiveVoiceName = updated.voiceOverride?.name || normalizeVoiceName(updated.username);
      if (updated.avatarId && updated.avatarName && effectiveVoiceId && effectiveVoiceName && updated.matchedBy !== 'memory') {
        rememberPairing({
          voiceName: effectiveVoiceName,
          voiceId: effectiveVoiceId,
          avatarId: updated.avatarId,
          avatarName: updated.avatarName,
        });
      }
      // Memoria direta avatar → voz escolhida (override). Atualiza sempre
      // que houver avatar + voz override definidos.
      if (updated.avatarId && updated.voiceOverride?.id) {
        rememberAvatarVoice(updated.avatarId, updated.voiceOverride.id, updated.voiceOverride.name || '');
      }
      return { ...prev, [taskId]: { ...a, roleSlots: newSlots, status: allHaveAvatar ? 'ready' : 'partial' } };
    });
    // DR MILLION: hooks do mesmo AD são o MESMO anúncio, só muda o gancho —
    // então o avatar vale pro grupo inteiro. Propaga aqui, senão você
    // reescolheria avatar+voz task por task E, pior, o corpo deixaria de ser
    // reaproveitado: a chave do reuso inclui avatar e voz, então avatar
    // diferente entre irmãos faz o HeyGen gerar tudo de novo.
    if ('avatarId' in patch && patch.avatarId) {
      propagarAvatarNoGrupo(taskId, roleIdx);
    }
  }

  /** Copia o avatar+voz escolhido pros hooks irmãos que ainda não têm.
   *  Só DR MILLION, só sobrescreve quem está SEM avatar (escolha manual
   *  em outro hook nunca é derrubada). */
  function propagarAvatarNoGrupo(taskIdOrigem: string, roleIdx: number) {
    setTaskAnalyses((prev) => {
      const origem = prev[taskIdOrigem];
      if (!origem?.drMillion) return prev;
      const slot = origem.roleSlots?.[roleIdx];
      if (!slot?.avatarId) return prev;
      const grupo = adGroupOf(origem.baseAdId || origem.taskName);
      if (!grupo) return prev;
      const next = { ...prev };
      let mudou = false;
      for (const [tid, alvo] of Object.entries(prev)) {
        if (tid === taskIdOrigem || !alvo?.drMillion) continue;
        if (adGroupOf(alvo.baseAdId || alvo.taskName) !== grupo) continue;
        const slots = alvo.roleSlots || [];
        if (slots.some((s) => s.avatarId)) continue; // já tem escolha própria
        const herdado: RoleSlot = {
          ...slot,
          role: slots[0]?.role || 'Avatar 1',
          username: slots[0]?.username || 'manual1',
          manual: true,
          matchedBy: 'grupo',
        };
        next[tid] = {
          ...alvo,
          roleSlots: slots.length ? slots.map((s, i) => (i === 0 ? herdado : s)) : [herdado],
          status: 'ready',
        };
        mudou = true;
      }
      return mudou ? next : prev;
    });
  }

  /** Adiciona slot vazio pro user escolher manualmente avatar + voz.
   *  Critico quando parser nao detectou avatar no briefing — user nunca
   *  fica travado, sempre pode adicionar manualmente. */
  function addManualRoleSlot(taskId: string) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a) return prev;
      const slots = a.roleSlots || [];
      // Role único mesmo depois de remover/adicionar (não reaproveita nome de
      // slot que saiu — senão as parts atribuídas ao antigo grudavam no novo).
      let n = slots.length + 1;
      const usados = new Set(slots.map((s) => s.role.toLowerCase()));
      while (usados.has(`avatar ${n}`)) n++;
      const role = `Avatar ${n}`;
      // DR MILLION: se um hook irmão do mesmo AD já tem avatar escolhido, o
      // novo slot já nasce com ele — é o mesmo anúncio, só muda o gancho.
      // Também é o que mantém o corpo reaproveitado (a chave do reuso inclui
      // avatar e voz).
      const grupoAtual = a.drMillion ? adGroupOf(a.baseAdId || a.taskName) : null;
      const doIrmao = grupoAtual
        ? Object.values(prev).find(
            (o) =>
              o?.drMillion &&
              o.taskId !== taskId &&
              adGroupOf(o.baseAdId || o.taskName) === grupoAtual &&
              (o.roleSlots || []).some((s) => s.avatarId),
          )?.roleSlots?.find((s) => s.avatarId) ?? null
        : null;
      const newSlot: RoleSlot = {
        role,
        username: `manual${n}`,
        briefingFileId: null,
        avatarId: doIrmao?.avatarId ?? null,
        avatarName: doIrmao?.avatarName ?? null,
        avatarThumb: doIrmao?.avatarThumb ?? null,
        avatarVoiceId: doIrmao?.avatarVoiceId ?? null,
        voiceOverride: doIrmao?.voiceOverride ?? null,
        matchedBy: doIrmao ? 'grupo' : null,
        manual: true,
      };
      return {
        ...prev,
        [taskId]: {
          ...a,
          roleSlots: [...slots, newSlot],
          // Herdou avatar do irmão já entra pronta pra disparar; sem avatar
          // continua 'partial' (falta você escolher).
          status: [...slots, newSlot].every(slotPronto) ? 'ready' : 'partial',
        },
      };
    });
  }

  /** Edita o texto de uma part especifica (preview/correcao manual antes
   *  do dispatch). User abre o preview por avatar, ve EXATAMENTE o que vai
   *  pro HeyGen, e se tiver leak (indicativo de cor vermelha que escapou
   *  do parser), edita direto aqui. Mutacao explicita — substitui o texto
   *  e mantem label + matchByRole. */
  function updatePartTemplateText(taskId: string, partIdx: number, newText: string) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.partTemplates) return prev;
      const newParts = a.partTemplates.map((p, i) => i === partIdx ? { ...p, text: newText } : p);
      return { ...prev, [taskId]: { ...a, partTemplates: newParts } };
    });
  }

  /** Remove uma PART inteira (card) do que vai pro HeyGen. Usado pra tirar
   *  cards que sao lixo de producao que escapou do parser (ex "CRIATIVOS",
   *  "Os criativos sao para META..."). Recalcula as contagens de hook/body
   *  pro header ("N takes (X hook + Y body)") ficar correto. O disparo le de
   *  partTemplates, entao remover aqui = nao gera esse take. */
  function removePartTemplate(taskId: string, partIdx: number) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.partTemplates) return prev;
      const newParts = a.partTemplates.filter((_, i) => i !== partIdx);
      const hookCount = newParts.filter((p) => /^(hook|gancho)/i.test(p.label)).length;
      const bodyPartsCount = newParts.length - hookCount;
      return {
        ...prev,
        [taskId]: { ...a, partTemplates: newParts, totalParts: newParts.length, hookCount, bodyPartsCount },
      };
    });
  }

  /** QUEM FALA CADA PART — fonte única, a MESMA regra do buildPlan.
   *
   *  buildPlan resolve `slotsByRole[pt.matchByRole] || firstSlot`: part sem
   *  role (ou com role que não existe mais) é falada pelo PRIMEIRO avatar.
   *  O preview filtrava só por igualdade de role e por isso mentia justamente
   *  no caso do DR MILLION — dizia "nenhuma parte atribuída" enquanto o
   *  disparo mandava a copy inteira pro avatar 1. Agora os dois leem daqui.
   *
   *  Devolve o índice do slot dono de cada part (-1 = sem slot nenhum). */
  function ownerSlotIdx(a: TaskAnalysis, pt: { matchByRole?: string | null }): number {
    const slots = a.roleSlots || [];
    if (!slots.length) return -1;
    if (pt.matchByRole) {
      const i = slots.findIndex((s) => s.role.toLowerCase() === pt.matchByRole);
      if (i >= 0) return i;
    }
    return 0; // fallback do buildPlan: primeiro avatar fala o resto
  }

  /** Atribui uma part a um avatar (só faz sentido com 2+ slots). Grava o role
   *  em matchByRole — mesmo campo que o parser usa, então o disparo respeita
   *  sem nenhuma regra extra. */
  function assignPartToRole(taskId: string, partIdx: number, role: string) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.partTemplates) return prev;
      const parts = a.partTemplates.map((p, i) =>
        i === partIdx ? { ...p, matchByRole: role.toLowerCase() } : p,
      );
      return { ...prev, [taskId]: { ...a, partTemplates: parts } };
    });
  }

  /** Map { "taskId:roleIdx" → boolean } pra controlar qual slot esta com
   *  preview aberto. UI efemera, nao persiste. */
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});

  /** Remove um slot manual/auto-detectado */
  function removeRoleSlot(taskId: string, roleIdx: number) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.roleSlots) return prev;
      const newSlots = a.roleSlots.filter((_, i) => i !== roleIdx);
      const allHaveAvatar = newSlots.length > 0 && newSlots.every(slotPronto);
      return {
        ...prev,
        [taskId]: {
          ...a,
          roleSlots: newSlots,
          status: newSlots.length === 0 ? 'partial' : allHaveAvatar ? 'ready' : 'partial',
        },
      };
    });
  }

  /* ═══════════ CARREGAR PLANO (DR MILLION) ═══════════
   *
   * Montar 47 cenas na mão é inviável e ERRA: cada cena é um slot com avatar,
   * voz, movimento e (às vezes) modo imagem, e os rótulos do seletor se repetem
   * o suficiente pra clicar no lugar errado — foi assim que AD45/AD47/AD53
   * saíram cruzados numa tentativa manual. Aqui a montagem vem de DADOS.
   *
   * O plano é `{ "AD37": [cena, cena, ...], ... }` gerado fora (frames.json +
   * auditoria dos avatares + vozes clonadas). Cada cena vira UM slot. */
  type CenaDoPlano = {
    cena: string;
    n: number;
    titulo?: string;
    avatarNome?: string | null;
    avatarId?: string | null;
    modoImagem?: boolean;
    voiceId?: string | null;
    vozNome?: string | null;
    motionPrompt?: string | null;
    /** Quem fala nesta cena, com o NOME do rótulo do doc ("Marek Skoczylas").
     *  Só nos ADs em diálogo. Com isto o corte segue o roteiro em vez de
     *  dividir por igual — senão a Agnieszka recita a fala do médico. */
    falante?: string | null;
    /** Trecho da copy onde ESTA cena começa (corte editorial: a fala casa com
     *  o que o frame mostra). Não vale na cena 1, que sempre começa no início. */
    ancora?: string | null;
  };

  const [planoTexto, setPlanoTexto] = useState('');
  const [planoImagens, setPlanoImagens] = useState<Record<string, string>>({});
  const [planoAberto, setPlanoAberto] = useState(false);
  const [planoRelato, setPlanoRelato] = useState<string[] | null>(null);

  /** Reparte as parts de uma task entre as cenas, na ordem.
   *  O hook fica na cena 1 e o corpo é dividido por igual entre as cenas —
   *  ponto de partida revisável, não palpite disfarçado de certeza: você abre
   *  o 👁 de cada cena e ajusta o corte antes de disparar. */
  function repartirPartes(total: number, cenas: number): number[] {
    const dono = new Array(total).fill(0);
    if (cenas <= 1 || total === 0) return dono;
    const corpo = Math.max(0, total - 1); // parte 0 = hook, fica na cena 1
    const porCena = Math.ceil(corpo / cenas);
    for (let i = 1; i < total; i++) dono[i] = Math.min(cenas - 1, Math.floor((i - 1) / porCena));
    return dono;
  }

  /** Reparte seguindo QUEM FALA, quando o plano declara o falante de cada cena.
   *  Anda pelas partes na ordem do roteiro e só avança de cena quando a fala
   *  muda de dono — o vídeo é a concatenação das cenas, então a ordem tem que
   *  ser respeitada. Devolve null quando a sequência de cenas não comporta a
   *  sequência de falas (ex.: a pessoa volta a falar e não há cena pra ela):
   *  aí o chamador cai no corte por igual e AVISA, em vez de montar errado. */
  function repartirPorFalante(
    partes: Array<{ speaker?: string | null }>,
    cenas: CenaDoPlano[],
  ): number[] | null {
    const mesma = (a?: string | null, b?: string | null) =>
      !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    const dono: number[] = [];
    let atual = 0;
    for (const p of partes) {
      if (!p.speaker) { dono.push(atual); continue; } // hook e afins: cena corrente
      // Falante sem NENHUMA cena = fala que o plano deixou de fora de propósito
      // (ex.: os frames de dupla do AD67). Marca -1: o take não é gerado, e o
      // relatório diz quantos sairam — descarte declarado, não silencioso.
      if (!cenas.some((c) => mesma(c.falante, p.speaker))) { dono.push(-1); continue; }
      if (mesma(cenas[atual]?.falante, p.speaker)) { dono.push(atual); continue; }
      const prox = cenas.findIndex((c, i) => i > atual && mesma(c.falante, p.speaker));
      if (prox < 0) return null; // a pessoa volta a falar e não há cena: não force
      atual = prox;
      dono.push(atual);
    }
    return dono;
  }

  /** Reparte por ÂNCORA: cada cena declara o trecho da copy onde ela começa,
   *  então o corte segue o que o frame mostra em vez de cair no meio por
   *  aritmética. Devolve null se alguma âncora não for achada — melhor cair no
   *  corte por igual com aviso do que fingir que casou. */
  function repartirPorAncora(
    partes: Array<{ text: string }>,
    cenas: CenaDoPlano[],
  ): number[] | null {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const inicio: number[] = [0];
    for (let ci = 1; ci < cenas.length; ci++) {
      const alvo = norm(cenas[ci].ancora || '');
      if (!alvo) return null;
      const de = inicio[ci - 1] + 1; // cada cena tem que ficar com pelo menos 1 take
      const j = partes.findIndex((p, i) => i >= de && norm(p.text).includes(alvo));
      if (j < 0) return null;
      inicio.push(j);
    }
    return partes.map((_, i) => {
      let dono = 0;
      for (let ci = 0; ci < inicio.length; ci++) if (i >= inicio[ci]) dono = ci;
      return dono;
    });
  }

  function aplicarPlano() {
    let plano: Record<string, CenaDoPlano[]>;
    try {
      plano = JSON.parse(planoTexto);
    } catch (e) {
      setError('Plano inválido (não é JSON): ' + (e as Error).message);
      return;
    }
    const relato: string[] = [];
    setTaskAnalyses((prev) => {
      const next = { ...prev };
      for (const [ad, cenas] of Object.entries(plano)) {
        if (!Array.isArray(cenas) || cenas.length === 0) continue;
        // casa o AD com a task analisada (nome tipo "AD37 - GL - COD WL PL")
        const alvo = Object.values(next).find((a) =>
          new RegExp(`\\b${ad}\\b`).test(a?.baseAdId || a?.taskName || ''),
        );
        if (!alvo) { relato.push(`⚠ ${ad}: nenhuma task analisada com esse nome`); continue; }

        const ordenadas = [...cenas].sort((x, y) => (x.n || 0) - (y.n || 0));
        const slots: RoleSlot[] = ordenadas.map((c, i) => ({
          role: `Cena ${c.n ?? i + 1}`,
          username: c.cena,
          briefingFileId: null,
          avatarId: c.modoImagem ? null : c.avatarId || null,
          avatarName: c.modoImagem ? null : c.avatarNome || null,
          avatarThumb: null,
          avatarVoiceId: null,
          voiceOverride: c.voiceId ? { id: c.voiceId, name: c.vozNome || c.cena } : null,
          matchedBy: 'plano',
          manual: true,
          motionPrompt: c.motionPrompt || null,
          engine: (c as { motor?: 'III' | 'IV' | 'V' }).motor,
          imageMode: !!c.modoImagem,
          imageDataUrl: c.modoImagem ? planoImagens[c.cena] || null : null,
          // A chave é o que sobrevive ao F5 (os bytes vão pro IDB logo abaixo).
          // Sem ela, recarregar a página perdia os frames e o RETOMAR não tinha
          // como re-disparar a cena de imagem.
          imageKey: c.modoImagem && planoImagens[c.cena] ? `pilot:${alvo.taskId}:img:${i}` : null,
          imageName: c.modoImagem ? `${c.cena}.jpg` : null,
        }));
        // Grava os bytes das imagens no IndexedDB — fora do setState, porque é
        // assíncrono e o localStorage não aguenta base64.
        for (const [i, c] of ordenadas.entries()) {
          const dataUrl = c.modoImagem ? planoImagens[c.cena] : null;
          if (!dataUrl) continue;
          void (async () => {
            try {
              const { saveBlob } = await import('@/lib/zip-store');
              const blob = await (await fetch(dataUrl)).blob();
              await saveBlob(`pilot:${alvo.taskId}:img:${i}`, blob, blob.type || 'image/jpeg');
            } catch (e) {
              console.warn(`[clickup-pilot] frame de ${c.cena} não foi pro IDB (F5 perderia):`, e);
            }
          })();
        }

        // reparte as parts entre as cenas (matchByRole é o que o disparo lê)
        const partes = alvo.partTemplates || [];
        // Ordem de preferência: quem fala (diálogo) → âncora (corte editorial)
        // → por igual. Sempre que o declarado não fecha, avisa e cai no de
        // baixo: nunca monta errado calado.
        const querFalante = ordenadas.every((c) => c.falante);
        const querAncora = !querFalante && ordenadas.slice(1).every((c) => c.ancora);
        const porFalante = querFalante ? repartirPorFalante(partes, ordenadas) : null;
        const porAncora = querAncora ? repartirPorAncora(partes, ordenadas) : null;
        if (querFalante && !porFalante) {
          relato.push(`⚠ ${ad}: as cenas não cobrem a ordem das falas — corte por igual, CONFIRA no 👁`);
        }
        if (querAncora && !porAncora) {
          relato.push(`⚠ ${ad}: âncora do plano não bateu com nenhum take — corte por igual, CONFIRA no 👁`);
        }
        const donos = porFalante || porAncora || repartirPartes(partes.length, slots.length);
        const novasPartes = partes
          .map((p, i) => ({ p, dono: donos[i] }))
          .filter((x) => x.dono >= 0)
          .map((x) => ({ ...x.p, matchByRole: slots[x.dono].role.toLowerCase() }));
        const descartados = partes.length - novasPartes.length;

        const faltamImagens = slots.filter((s) => s.imageMode && !s.imageDataUrl).map((s) => s.username);
        next[alvo.taskId] = {
          ...alvo,
          roleSlots: slots,
          partTemplates: novasPartes,
          totalParts: novasPartes.length,
          status: slots.every(slotPronto) ? 'ready' : 'partial',
        };
        const criterio = porFalante ? ' POR FALANTE' : porAncora ? ' POR ÂNCORA' : '';
        const semTake = slots.filter((s) => !novasPartes.some((p) => p.matchByRole === s.role.toLowerCase()));
        // CUSTO ANTES DE CLICAR. Cena fora do III vira UM take (take único por
        // look) e cobra ~6; o III cobra ~1 por pedaço. Sem esta conta, a
        // diferença entre um lote de 90 e um de 350 créditos só aparecia na
        // fatura. Estimativa, não promessa — por isso o "~".
        const custo = slots.reduce((tot, s) => {
          const unico = takeUnicoPorLook({ engine: s.engine, motionPrompt: s.motionPrompt, imageMode: s.imageMode });
          const meus = novasPartes.filter((p) => p.matchByRole === s.role.toLowerCase()).length;
          if (!meus) return tot;
          return tot + (unico ? 6 : meus);
        }, 0);
        const cenasCaras = slots.filter((s) =>
          takeUnicoPorLook({ engine: s.engine, motionPrompt: s.motionPrompt, imageMode: s.imageMode }),
        ).length;
        relato.push(
          `${ad}: ${slots.length} cenas · ${novasPartes.length} takes repartidos${criterio}` +
            ` · ~${custo} créditos` +
            (cenasCaras ? ` (${cenasCaras} cena(s) IV/imagem = 1 take inteiro cada)` : '') +
            (descartados ? ` · ${descartados} take(s) DESCARTADO(s) (falante sem cena)` : '') +
            (slots.some((s) => s.motionPrompt) ? ` · ${slots.filter((s) => s.motionPrompt).length} c/ movimento` : '') +
            (semTake.length ? ` · ⚠ sem fala: ${semTake.map((s) => s.username).join(', ')}` : '') +
            (faltamImagens.length ? ` · ⚠ falta a imagem de ${faltamImagens.join(', ')}` : ''),
        );
      }
      return next;
    });
    setPlanoRelato(relato);
    setError(null);
  }

  /** MODO IMAGEM — recebe o arquivo, guarda a data URL em memória (pro disparo
   *  desta sessão) e grava os BYTES no IndexedDB (pro RETOMAR pós-F5). O
   *  localStorage nunca vê a imagem: base64 lá estoura a quota e derruba a
   *  persistência de todas as tasks. Ver [[feedback_blindagem_fluxos]]. */
  async function subirImagemDoSlot(taskId: string, roleIdx: number, file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError(`Formato não suportado (${file.type || '?'}). Use JPEG, PNG ou WebP.`);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(`Imagem muito grande (${(file.size / 1e6).toFixed(1)}MB). Máximo 8MB.`);
      return;
    }
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(new Error('Falha ao ler a imagem.'));
      fr.readAsDataURL(file);
    });
    const imageKey = `pilot:${taskId}:img:${roleIdx}`;
    try {
      const { saveBlob } = await import('@/lib/zip-store');
      await saveBlob(imageKey, file, file.type);
    } catch (e) {
      // Não trava o disparo desta sessão — só avisa que um F5 perderia a imagem.
      console.warn('[clickup-pilot] imagem não foi pro IDB (F5 perderia):', e);
    }
    updateRoleSlot(taskId, roleIdx, {
      imageDataUrl: dataUrl,
      imageKey,
      imageName: file.name,
    });
    setError(null);
  }

  /** Slot pronto pra disparar: avatar escolhido OU, no modo imagem, imagem
   *  subida (a imagem substitui o avatar — não existe avatarId nesse caminho). */
  function slotPronto(s: RoleSlot): boolean {
    // Modo imagem exige a voz TAMBÉM: sem avatar não há voz padrão pra herdar,
    // e o /v3 recusa `script` sem `voice_id`. Sem esta checagem a task ficaria
    // 'ready' e só quebraria no disparo.
    if (s.imageMode) return !!(s.imageDataUrl && s.voiceOverride?.id);
    return !!s.avatarId;
  }

  /** Constroi DispatchPlan a partir dos roleSlots + partTemplates da task */
  function buildPlan(a: TaskAnalysis): DispatchPlan | null {
    if (!a.roleSlots || !a.partTemplates) return null;
    const slotsByRole: Record<string, RoleSlot> = {};
    for (const s of a.roleSlots) slotsByRole[s.role.toLowerCase()] = s;
    const firstSlot = a.roleSlots[0];
    const adName = (a.baseAdId || a.taskName).replace(/[^a-z0-9_-]/gi, '_');
    const parts = a.partTemplates.map((pt) => {
      const slot = (pt.matchByRole && slotsByRole[pt.matchByRole]) || firstSlot;
      return {
        label: pt.label,
        text: pt.text,
        avatarId: slot?.avatarId || null,
        avatarName: slot?.avatarName || null,
        avatarThumb: slot?.avatarThumb || null,
        matchedBy: slot?.matchedBy || undefined,
        // voiceId: override > avatar default
        voiceId: slot?.voiceOverride?.id || slot?.avatarVoiceId || null,
        // Movimento é do AVATAR da cena, então cada parte herda o do seu slot.
        motionPrompt: (slot?.motionPrompt || '').trim() || null,
        imageDataUrl: slot?.imageMode ? (slot.imageDataUrl || null) : null,
        imageKey: slot?.imageMode ? (slot.imageKey || null) : null,
        engine: slot?.engine,
        _slotRole: slot?.role?.toLowerCase() || '',
        _imageMode: !!slot?.imageMode,
        // Cena que NÃO roda no Avatar III: motion sobe pro IV sozinho
        // (motorEfetivo), e IV/V escolhido na mão manda direto.
        _takeUnico: takeUnicoPorLook({
          engine: (slot?.engine as 'III' | 'IV' | 'V') || 'III',
          motionPrompt: (slot?.motionPrompt || '').trim() || null,
          imageMode: !!slot?.imageMode,
        }),
      };
    });
    // TAKE ÚNICO por slot quando a cena NÃO é Avatar III.
    //
    // Dois motivos, e os dois custam:
    //  • DINHEIRO — o IV/V e o modo imagem cobram POR GERAÇÃO (~6 créditos cada,
    //    contra 1 do III). Picotar o corpo em 5 takes multiplica isso por 5 pelo
    //    mesmo look. Medido no lote WL PL: as 8 cenas com movimento dariam 27
    //    takes picotadas e dão 8 inteiras — 114 créditos de diferença.
    //  • QUALIDADE — o gesto é pedido por geração, então cada pedaço REFAZ o
    //    movimento do zero. Picotado, o avatar mexe a colher a cada corte.
    // O III continua picotado como sempre: lá o take é barato e o corte curto
    // ajuda a montagem.
    const colapsado: typeof parts = [];
    const jaFeito = new Set<string>();
    for (const p of parts as any[]) {
      const takeUnico = p._takeUnico;
      if (!takeUnico) { colapsado.push(p); continue; }
      if (jaFeito.has(p._slotRole)) continue;
      jaFeito.add(p._slotRole);
      const irmas = (parts as any[]).filter(
        (q) => q._takeUnico && q._slotRole === p._slotRole,
      );
      colapsado.push({
        ...p,
        label: irmas.length > 1 ? `${p.label}+${irmas.length - 1}` : p.label,
        text: irmas.map((q) => String(q.text || '').trim()).filter(Boolean).join('\n\n'),
      } as any);
    }
    for (const p of colapsado as any[]) { delete p._slotRole; delete p._imageMode; delete p._takeUnico; }
    // Slot em modo imagem não precisa de avatarId — a imagem substitui.
    const unmatchedAvatars = a.roleSlots
      .filter((s) => !s.avatarId && !(s.imageMode && s.imageDataUrl))
      .map((s) => `${s.role}: @${s.username}`);
    return { adName, parts: colapsado as any, unmatchedAvatars };
  }

  /** Dispara UMA task pra HeyGen Auto Dynamic */
  function dispatchTaskToHeyGen(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a) return;
    // ROUTER VA — se task eh VA briefing, roteia pro pipeline correto
    // automaticamente. User pediu: "VA NAO DEVE RODAR PIPELINE SEPARADO,
    // DEVE IR PRA MESMA FILA E DISPARAR NO START TAMBEM".
    if (a.vaBriefing) {
      const issues = vaReadinessIssues(taskId);
      if (issues.length > 0) {
        setError(`VA incompleto — falta: ${issues.join(', ')}.`);
        return;
      }
      const driveId = a.vaBriefing.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '');
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName: a.taskName, baseAdId: a.vaBriefing!.baseAdId, parts: [], startedAt: Date.now() }),
          phase: 'queued', isVA: true,
          adOriginalUrl: driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : undefined,
          message: 'Na fila — aguardando vaga...', finishedAt: undefined,
        } as BatchTaskState,
      }));
      void runHeyGenGated(taskId, 'run');
      return;
    }
    const plan = buildPlan(a);
    if (!plan || plan.parts.some((p: any) => !p.avatarId && !p.imageDataUrl)) {
      setError(`Tem avatar sem selecionar. Click no slot e escolhe.`);
      return;
    }
    const handoff = {
      adName: plan.adName,
      motor: 'III',
      mode: 'copy',
      dynamic: true,
      partTexts: plan.parts.map((p: any) => p.text),
      partLabels: plan.parts.map((p: any) => p.label),
      partAvatarIds: plan.parts.map((p: any) => p.avatarId),
      partVoiceIds: plan.parts.map((p: any) => p.voiceId), // NOVO: voz por parte
      // Apply Custom Motion por parte. O `motor: 'III'` acima continua sendo o
      // default do disparo: quem tem gesto sobe pro IV sozinho no runner.
      partMotionPrompts: plan.parts.map((p: any) => p.motionPrompt || null),
      copy: plan.parts.map((p: any) => p.text).join('\n\n'),
    };
    sessionStorage.setItem('darkolab:heygen-auto:handoff', JSON.stringify(handoff));
    // Marca task + siblings G1/G2 como disparadas (compartilham conteudo)
    const siblings = getSiblingTaskIds(taskId);
    for (const sid of siblings) markDispatched(sid);
    setTaskAnalyses(prev => {
      const next = { ...prev };
      for (const sid of siblings) {
        if (next[sid]) next[sid] = { ...next[sid], dispatchedAt: Date.now() };
      }
      return next;
    });
    router.push('/tools/heygen-auto?from=clickup-pilot');
  }

  /** Dispara SO o Auto B-roll (Magnific) dessa task — standalone, ungated.
   *  Acionado pelo botão 3D ✨ (IconBroll) no card. Roda invisivel via
   *  extensao/bridge (fila serial 1 por vez). Não roda HeyGen junto: pra
   *  disparar HeyGen, usa o ▶ play. Os dois são independentes — user pode
   *  rodar só B-rolls, só HeyGen, ou ambos (clica os dois). */
  function dispatchTaskToMagnific(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a || a.vaBriefing) return;
    if (!(taskMagnificJson[taskId] || '').trim()) {
      setMagnificEditorOpen((p) => ({ ...p, [taskId]: true }));
      setError('Cole o JSON de B-rolls dessa task na caixa abaixo antes de disparar.');
      return;
    }
    if (!enqueueMagnificForTask(taskId, false)) {
      setError('JSON de B-rolls invalido — nenhum take detectado.');
      return;
    }
    setError(null);
    for (const sid of getSiblingTaskIds(taskId)) markDispatched(sid);
  }

  /** Copia SO o body falado dessa task pro clipboard — sem hooks, sem a
   *  seção de variações (Guia/AD0x), sem "Tela dividida"/"Take logo" e sem
   *  links. Fonte: bodyRaw do parser (ou bodyText da VA), passado pelo
   *  extractSpokenBody. Util pro user gerar os prompts de B-roll. */
  const [copiedBodyTask, setCopiedBodyTask] = useState<string | null>(null);
  async function copyTaskBody(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a) return;
    const src =
      a.vaBriefing?.bodyText ||
      a.bodyRaw ||
      (a.partTemplates || [])
        .filter((p) => /^(BODY|PARTE)\b/i.test(p.label.trim()))
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join('\n\n');
    const body = extractSpokenBody(src);
    if (!body) {
      setError('Essa task nao tem body identificado na copy (so hooks?).');
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setError(null);
      setCopiedBodyTask(taskId);
      setTimeout(() => setCopiedBodyTask((cur) => (cur === taskId ? null : cur)), 1800);
    } catch {
      setError('Nao consegui copiar pro clipboard (permissao do browser).');
    }
  }

  /** Identificador curto da task pro bloco de body (ex:
   *  "AD13VN - PRPB06 - G1" -> "AD13VN-PRPB06"). Remove sufixo G final. */
  function taskBodyId(a: TaskAnalysis): string {
    let n = (a.taskName || a.baseAdId || a.taskId).trim();
    n = n.replace(/\s*[-–—]\s*G\d+\s*$/i, '');
    n = n.replace(/\s*[-–—]\s*/g, '-').replace(/\s+/g, ' ').trim();
    return n || a.baseAdId || a.taskId;
  }

  /** Copia o body de TODAS as tasks selecionadas, identificado, num bloco
   *  so. NUNCA inclui Variacao de Avatar (a.vaBriefing). Dedup siblings
   *  G1/G2 (mesmo id apos remover sufixo G). Formato:
   *    AD33VN-PRPB05
   *    <body>
   *
   *    AD34VN-PRPB05
   *    <body>
   */
  const [copiedAllBodies, setCopiedAllBodies] = useState(false);
  async function copyAllSelectedBodies() {
    const seen = new Set<string>();
    const blocks: string[] = [];
    let skippedVA = 0;
    for (const id of selectedTaskIds) {
      const a = taskAnalyses[id];
      if (!a) continue;
      if (a.vaBriefing) { skippedVA++; continue; } // VA nunca entra
      const ident = taskBodyId(a);
      if (seen.has(ident)) continue; // dedup G1/G2 (mesmo conteudo)
      const src =
        a.bodyRaw ||
        (a.partTemplates || [])
          .filter((p) => /^(BODY|PARTE)\b/i.test(p.label.trim()))
          .map((p) => p.text.trim())
          .filter(Boolean)
          .join('\n\n');
      const body = extractSpokenBody(src);
      if (!body) continue;
      seen.add(ident);
      blocks.push(`${ident}\n${body}`);
    }
    if (blocks.length === 0) {
      setError(
        skippedVA > 0
          ? 'Nenhuma task normal selecionada com body (so VA, que nao copia).'
          : 'Nenhuma task selecionada com body identificado.',
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      setError(null);
      setCopiedAllBodies(true);
      setTimeout(() => setCopiedAllBodies(false), 2000);
    } catch {
      setError('Nao consegui copiar pro clipboard (permissao do browser).');
    }
  }

  async function autoFetchDoc(url: string) {
    setFetchingDoc(true);
    setParseError(null);
    try {
      // 1. Tenta via extensao (sessao Google logada — funciona pra doc privado)
      const extR = await fetchDocViaExtension(url);
      if (extR.ok && extR.text) {
        lastDocLinksRef.current = extR.driveLinks || [];
        setDocContent(extR.text);
        setTimeout(() => runParser(extR.text || ''), 100);
        return;
      }
      // 2. Fallback: server proxy (so docs publicos)
      const r = await fetch(`/api/docs/fetch?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!j.ok) {
        setParseError(
          `Doc privado e extensao nao leu (${extR.error || 'erro'}). Servidor tambem falhou: ${j.error}. Cola manualmente abaixo.`,
        );
        return;
      }
      setDocContent(j.text || '');
      setTimeout(() => runParser(j.text || ''), 100);
    } catch (e) {
      setParseError(`Falha: ${(e as Error)?.message}`);
    } finally {
      setFetchingDoc(false);
    }
  }

  function runParser(textOverride?: string) {
    setParseError(null);
    setParsed(null);
    setBriefing(null);
    const text = textOverride ?? docContent;
    if (!text.trim()) {
      setParseError('Cola o conteudo do doc OU usa o botao "Buscar doc automatico".');
      return;
    }
    if (!selectedTask) return;
    // Identifica AD ID base a partir do nome da task: ex "AD139GL - VFPB04"
    // Pega so a parte AD<num><letras> (sem o -VFPB04) pra match dos siblings
    const taskName = selectedTask.name;
    const baseMatch = taskName.match(/^(AD\d+[A-Z]+)\b/i);
    const baseAdId = baseMatch ? baseMatch[1].toUpperCase() : null;
    const fullAdMatch = taskName.match(/AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i);
    const fullAdId = fullAdMatch ? fullAdMatch[0].toUpperCase() : taskName.toUpperCase().trim();

    // Parser 1 (legacy): secao base com avatares + parts auto-detectadas
    const result = parseAdSection(text, fullAdId) || parseAdSection(text, fullAdId.split(/\s|-/)[0]);
    if (result) setParsed(result);

    // Parser 2 (novo): briefing DARKO LAB com convencao G[N] = Hook[N].
    // Passa os links do doc pra identificar avatar por smart-chip de YouTube.
    if (baseAdId) {
      const b = parseDarkoBriefing(text, baseAdId, extractVariantToken(taskName), lastDocLinksRef.current);
      if (b && (b.hooks.length > 0 || b.body)) {
        setBriefing(b);
        return;
      }
    }
    if (!result) {
      setParseError(`Nao achei secao "${fullAdId}" no doc. Confere se a copy ta colada/buscada certo.`);
    }
  }

  /* ========== HeyGen library (cache singleton) ========== */
  const [librarySnap, setLibrarySnap] = useState(() => getLibrarySnapshot());
  useEffect(() => {
    const unsub = subscribeLibrary(() => setLibrarySnap({ ...getLibrarySnapshot() }));
    if (librarySnap.groups.length === 0 && !librarySnap.loading) {
      reloadLibrary(false);
    }
    return unsub;
    // eslint-disable-next-line
  }, []);

  // Flat avatar candidates pra matcher (incluindo voice_name, voiceId, thumb)
  const avatarCandidates = useMemo(() => {
    const flat: Array<{ id: string; name: string; groupName: string; voiceName?: string | null; voiceId?: string | null; thumb?: string | null }> = [];
    for (const g of librarySnap.groups) {
      for (const l of g.looks) {
        flat.push({
          id: l.id,
          name: l.name,
          groupName: g.name,
          voiceName: (l as any).voiceName ?? null,
          voiceId: (l as any).voiceId ?? null,
          thumb: l.thumb ?? null,
        });
      }
    }
    return flat;
  }, [librarySnap.groups]);

  /* ========== Plano de dispatch ========== */
  const dispatchPlan: DispatchPlan | null = useMemo(() => {
    if (!selectedTask) return null;
    // Avatares: prefere os do briefing (mais completos), fallback parsed
    const avatarsSource = briefing?.avatars || parsed?.avatars || [];
    const adNameSource = briefing?.baseAdId || parsed?.adId || selectedTask.name;
    const adName = adNameSource.replace(/[^a-z0-9_-]/gi, '_');
    const matchedByRole: Record<string, { id: string; name: string }> = {};
    const matchedByUsername: Record<string, { id: string; name: string }> = {};
    const unmatchedAvatars: string[] = [];
    for (const av of avatarsSource) {
      const m = matchAvatar(av.username, avatarCandidates);
      if (m && m.score >= 30) {
        const matched = { id: m.id, name: m.name };
        matchedByRole[av.role.toLowerCase()] = matched;
        const uk = normAvatarKey(av.username);
        if (uk) matchedByUsername[uk] = matched;
      } else {
        unmatchedAvatars.push(`${av.role}: @${av.username}`);
      }
    }
    const firstMatched = Object.values(matchedByRole)[0] || null;
    function pickAvatarForText(text: string, label: string, detectedRole: string | null = null, username: string | null = null): { id: string; name: string } | null {
      // Prioridade 0: username do segmento (chip/filename do avatar no body) —
      // autoritativo, vence role/label/fallback.
      if (username) {
        const uk = normAvatarKey(username);
        if (uk && matchedByUsername[uk]) return matchedByUsername[uk];
      }
      // Prioridade 1: role detectado pelo parser (linha "Mulher:"/"Homem:"/etc
      // do briefing, descartada do texto). Match exato primeiro, depois fuzzy.
      if (detectedRole) {
        const dr = detectedRole.toLowerCase().trim();
        if (matchedByRole[dr]) return matchedByRole[dr];
        for (const role of Object.keys(matchedByRole)) {
          if (role === dr || role.includes(dr) || dr.includes(role)) return matchedByRole[role];
        }
      }
      const labelLower = label.toLowerCase();
      for (const role of Object.keys(matchedByRole)) {
        if (labelLower.includes(role.toLowerCase())) return matchedByRole[role];
      }
      const firstLines = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
      for (const role of Object.keys(matchedByRole)) {
        if (firstLines.includes(role.toLowerCase())) return matchedByRole[role];
      }
      return firstMatched;
    }

    // Plano modo NOVO: briefing DARKO LAB com G[N] = Hook[N]
    if (briefing && (briefing.hooks.length > 0 || briefing.body)) {
      const planParts: DispatchPlan['parts'] = [];
      for (const h of briefing.hooks) {
        const av = pickAvatarForText(h.text, h.label, h.role);
        planParts.push({
          label: h.label,
          text: h.text,
          avatarId: av?.id || null,
          avatarName: av?.name || null,
        });
      }
      // Body: itera POR SPEAKER (bodySegments). Cada segmento mantem seu role
      // — split por tempo NUNCA cruza speaker. Quando body tem 1 unico
      // speaker, bodySegments tem 1 entry.
      const bodySegs = briefing.bodySegments && briefing.bodySegments.length > 0
        ? briefing.bodySegments
        : (briefing.body ? [{ role: briefing.bodyRole, text: briefing.body }] : []);
      const totalSegs = bodySegs.length;
      for (let si = 0; si < bodySegs.length; si++) {
        const seg = bodySegs[si];
        const segParts = splitCopyIntoParts(seg.text, { targetSec: 20, minSec: 10, maxSec: 35 });
        for (let pi = 0; pi < segParts.length; pi++) {
          const label = (totalSegs === 1 && segParts.length === 1)
            ? 'BODY'
            : (totalSegs === 1)
              ? `BODY ${pi + 1}`
              : (segParts.length === 1)
                ? `BODY ${si + 1}`
                : `BODY ${si + 1}.${pi + 1}`;
          const av = pickAvatarForText(segParts[pi], label, seg.role, (seg as any).username ?? null);
          planParts.push({
            label,
            text: segParts[pi],
            avatarId: av?.id || null,
            avatarName: av?.name || null,
          });
        }
      }
      return { adName, parts: planParts, unmatchedAvatars };
    }

    // Fallback: parser legado (parts auto-detectadas)
    if (!parsed) return null;
    const parts = parsed.parts.map((p) => {
      const av = pickAvatarForText(p.text, p.label);
      return {
        label: p.label,
        text: p.text,
        avatarId: av?.id || null,
        avatarName: av?.name || null,
      };
    });
    return { adName, parts, unmatchedAvatars };
  }, [briefing, parsed, selectedTask, avatarCandidates]);

  function dispatchToHeyGenAuto() {
    if (!dispatchPlan || dispatchPlan.parts.length === 0) {
      setError('Sem plano de dispatch valido.');
      return;
    }
    if (dispatchPlan.unmatchedAvatars.length > 0 && dispatchPlan.parts.some((p) => !p.avatarId)) {
      setError(
        `Alguns avatares nao foram encontrados no HeyGen: ${dispatchPlan.unmatchedAvatars.join(', ')}. Cria eles primeiro OU edita manualmente no Hey Auto.`,
      );
      return;
    }
    const handoff = {
      adName: dispatchPlan.adName,
      motor: 'III',
      mode: 'copy',
      dynamic: true,
      // Passa partes EXATAS do parser (texto + label + avatar). HeyGen Auto
      // usa direto, sem re-split. Isso garante que mapping avatar↔parte
      // sobreviva e que HOOK 1, HOOK 2, BODY virem partes separadas como
      // o parser identificou.
      partTexts: dispatchPlan.parts.map((p) => p.text),
      partLabels: dispatchPlan.parts.map((p) => p.label),
      partAvatarIds: dispatchPlan.parts.map((p) => p.avatarId),
      // Tambem manda copy concat como fallback
      copy: dispatchPlan.parts.map((p) => p.text).join('\n\n'),
    };
    sessionStorage.setItem('darkolab:heygen-auto:handoff', JSON.stringify(handoff));
    router.push('/tools/heygen-auto?from=clickup-pilot');
  }

  /* ========== UI ========== */
  const [error, setError] = useState<string | null>(null);
  /** Acao opcional ao lado do erro (ex: "Configurar chave" → /configuracoes/api) */
  const [errorAction, setErrorAction] = useState<{ label: string; href: string } | null>(null);
  function clearError() { setError(null); setErrorAction(null); }

  /** Estado por slot do clone de voz em andamento.
   *  Key: `${taskId}:${sIdx}` → { stage, percent, message } */
  const [cloningVoice, setCloningVoice] = useState<Record<string, { stage: string; percent: number; message: string }>>({});

  /** VA: avatar HeyGen escolhido por avaCode pra cada task VA.
   *  Key: `${taskId}:${avaCode}` → AvatarOption */
  const [vaAvatarChoice, setVaAvatarChoice] = useState<Record<string, AvatarOption | null>>({});
  /** VA: congela o roteamento text-engine vs lipsync no DISPARO (key: taskId →
   *  bool). No resume após restart, `tasks[]` está vazio até "Carregar tasks",
   *  então organicChannelLabels mentiria; o override do snapshot preserva a
   *  decisão original. Só usado no resume reidratado. */
  const [vaTextEngineOverride, setVaTextEngineOverride] = useState<Record<string, boolean>>({});
  /** VA: URL/Drive ID do AD original (input manual quando parser nao detecta).
   *  Key: taskId → string */
  const [vaAdUrl, setVaAdUrl] = useState<Record<string, string>>({});
  /** VA: painel "trocar AD" aberto manualmente MESMO com AD ja detectado.
   *  Caso real: o AD que o copy apontou vem com AUDIO CAMUFLADO (fase
   *  invertida) que nao roda no lipsync — o user troca pelo link de um AD
   *  com audio LIMPO. Key: taskId → boolean */
  const [vaAdOverrideOpen, setVaAdOverrideOpen] = useState<Record<string, boolean>>({});
  /** VA: marca que o AD original foi TROCADO manualmente (chip na UI).
   *  Key: taskId → boolean */
  const [vaAdSwapped, setVaAdSwapped] = useState<Record<string, boolean>>({});
  /** VA: aplica a TROCA do AD original. Escreve o fileId colado direto em
   *  vaBriefing.linkAdFileId — IGUAL ao botao de candidato do doc (mesma
   *  garantia) — pra que TUDO (preview 👁, transcricao, diarizacao e
   *  disparo) passe a usar o AD limpo. NAO toca no pipeline de disparo (ele
   *  ja le linkAdFileId primeiro), so substitui a fonte. */
  function applyVaAdSwap(taskId: string) {
    const fileId = extractDriveFileId(vaAdUrl[taskId] || '');
    if (!fileId) return;
    setTaskAnalyses((prev) => {
      const cur = prev[taskId];
      if (!cur?.vaBriefing) return prev;
      return {
        ...prev,
        [taskId]: {
          ...cur,
          vaBriefing: { ...cur.vaBriefing, linkAdFileId: fileId, linkAdFilename: 'AD trocado manualmente' },
        } as any,
      };
    });
    setVaAdSwapped((prev) => ({ ...prev, [taskId]: true }));
    setVaAdOverrideOpen((prev) => ({ ...prev, [taskId]: false }));
  }
  // VA: estado do pipeline AGORA vive em batchStates (mesma fila/card das
  // tasks normais). Removido o vaPipelineState separado.
  /** VA: SMART MODE per task — detecta face no AD original e troca apenas
   *  segmentos com avatar visivel (b-rolls intactos). Key: taskId → boolean */
  /** VA (Studio): voz custom por avatar. Key: `${taskId}:${avaCode}` →
   *  {id,name} ou null = usar a voz do proprio avatar (Mirror voice). */
  const [vaVoiceChoice, setVaVoiceChoice] = useState<Record<string, { id: string; name: string } | null>>({});
  /** VA: APPLY CUSTOM MOTION — prompt de movimento por avatar/papel (o campo do
   *  HeyGen). Preenchido = a cena vai no **Avatar IV** (o III nao tem motion);
   *  vazio = Avatar III normal. Mesma key das outras escolhas (vaRoleKey). */
  const [vaMotionPrompt, setVaMotionPrompt] = useState<Record<string, string>>({});
  /** VA MULTI-LOCUTOR: inverte o mapeamento locutor↔papel de uma variacao
   *  (caso a heuristica 'quem fala mais = principal' erre).
   *  Key: `${taskId}:${avaCode}` → true = invertido. */
  /** VA: painel 👁 de preview aberto por variacao. VA fala o AUDIO do AD
   *  original (nao tem texto editavel como task normal) — o preview baixa
   *  o AD via extensao e toca num <video> local.
   *  Key: `${taskId}:${avaCode}` → true = aberto. */
  const [vaPreviewOpen, setVaPreviewOpen] = useState<Record<string, boolean>>({});
  /** VA 👁: midia do preview por Drive fileId (compartilhado entre AVAs da
   *  mesma task — baixa 1x). iframe do Drive NAO funciona pra arquivo
   *  privado (Chrome bloqueia cookie de terceiros → 'doc quebrado'), entao
   *  baixamos via extensao (fila+streaming) e tocamos blob local. */
  const [vaPreviewMedia, setVaPreviewMedia] = useState<Record<string, { status: 'loading' | 'ready' | 'error'; url?: string; error?: string; note?: string }>>({});
  const vaPreviewMediaRef = useRef<Record<string, boolean>>({});
  /** Blob do AD baixado (cache por fileId) — compartilhado entre o 👁 video
   *  e o 👁 de transcricao (baixa UMA vez por task). */
  const vaAdBlobRef = useRef<Record<string, Blob>>({});
  /** Cache do texto da "Link da Copy" por docId (roteiro do principal) —
   *  compartilhado entre prévia 👁 e disparo (busca 1x). */
  const vaCopyTextRef = useRef<Record<string, string>>({});
  /** Constrói os SEGMENTOS finais (start/end/rank) ALINHANDO o TEXTO EDITADO
   *  de cada papel de volta aos words (timestamps) do transcript — a fonte
   *  de verdade do roteamento. O que o user digitou/recortou no textarea de
   *  cada papel define EXATAMENTE qual trecho do áudio aquele avatar fala.
   *  Cortes no meio dos gaps = zero vazamento. preview == disparo. */
  function buildVaSegments(fileId: string, rolesCount: number): Array<{ start: number; end: number; rank: number }> | null {
    const tr = vaTranscript[fileId];
    if (!tr || tr.status !== 'ready' || !tr.words?.length) return null;
    const roleTexts: string[] = [];
    for (let rr = 0; rr < rolesCount; rr++) {
      roleTexts.push(vaRoleText[`${fileId}:${rr}`] ?? '');
    }
    // se nenhum textarea tem conteúdo (ainda não inicializou), não há base
    if (roleTexts.every((t) => !t.trim())) return null;
    const { segments } = alignEditedToWords(tr.words, roleTexts, tr.durSec || 0);
    return segments.length ? segments : null;
  }
  /** Baixa o AD do Drive (fila+streaming) e devolve o Blob, cacheado. */
  async function fetchAdBlob(fileId: string, onNote: (note: string) => void): Promise<Blob> {
    const cached = vaAdBlobRef.current[fileId];
    if (cached) return cached;
    const { downloadDriveFileViaExtension } = await import('@/lib/heygen-extension-bridge');
    const dl = await downloadDriveFileViaExtension(fileId, {
      onProgress: (rec, tot) => onNote(`Baixando o AD... ${(rec / 1048576).toFixed(1)}MB${tot ? ` / ${(tot / 1048576).toFixed(1)}MB` : ''}`),
    });
    if (!dl.ok) throw new Error(dl.error);
    const blob = new Blob([dl.bytes as BlobPart], { type: 'video/mp4' });
    vaAdBlobRef.current[fileId] = blob;
    return blob;
  }
  async function ensureVaPreviewMedia(fileId: string) {
    if (vaPreviewMediaRef.current[fileId]) return; // ja baixando/baixado
    vaPreviewMediaRef.current[fileId] = true;
    setVaPreviewMedia((p) => ({ ...p, [fileId]: { status: 'loading', note: 'Baixando o AD original do Drive...' } }));
    try {
      const blob = await fetchAdBlob(fileId, (note) =>
        setVaPreviewMedia((p) => ({ ...p, [fileId]: { status: 'loading', note } })),
      );
      const url = URL.createObjectURL(blob);
      setVaPreviewMedia((p) => ({ ...p, [fileId]: { status: 'ready', url } }));
    } catch (e) {
      vaPreviewMediaRef.current[fileId] = false;
      setVaPreviewMedia((p) => ({ ...p, [fileId]: { status: 'error', error: (e as Error)?.message || 'falha no download' } }));
    }
  }

  /* ===== 👁 TRANSCRIÇÃO POR PAPEL (previsibilidade do que cada avatar fala) =====
   * Diariza+transcreve o AD UMA vez por task (cache por fileId) e cada
   * papel mostra SO as falas do locutor mapeado nele (mesma heuristica do
   * pipeline: quem mais fala = principal; respeita o ⇄ inverter).
   * NOTA: a previa roda no audio CRU do AD (com trilha) pra ser rapida;
   * no disparo a diarizacao roda de novo na voz isolada (mais precisa). */
  type VaUtterance = { speaker: string; startMs: number; endMs: number; text: string };
  type VaWord = { text: string; startMs: number; endMs: number };
  const [vaTranscript, setVaTranscript] = useState<Record<string, {
    status: 'loading' | 'ready' | 'error';
    note?: string;
    error?: string;
    utterances?: VaUtterance[];
    /** words com timestamp — base do alinhamento texto-editado → tempo */
    words?: VaWord[];
    /** duração do AD (s) pra estender bordas dos segmentos */
    durSec?: number;
    rankBySpeaker?: Record<string, number>;
    /** rank auto por utterance (índice = ordem cronológica de utterances) */
    autoRanks?: number[];
    speakerCount?: number;
    /** Como os locutores foram separados ('tom de voz · 112Hz vs 204Hz' | 'AssemblyAI...') */
    method?: string;
  }>>({});
  const vaTranscriptRef = useRef<Record<string, boolean>>({});
  /** Painel de transcricao aberto por PAPEL. Key: `${taskId}:${avaCode}#${roleIdx}` */
  const [vaTranscriptOpen, setVaTranscriptOpen] = useState<Record<string, boolean>>({});
  /** TEXTO EDITÁVEL por papel — a fonte de verdade do roteamento (o user
   *  recorta/cola/digita). Key: `${fileId}:${roleIdx}`. Pré-preenchido com
   *  a atribuição auto; o disparo alinha de volta aos words (timestamps). */
  const [vaRoleText, setVaRoleText] = useState<Record<string, string>>({});
  const vaRoleTextInit = useRef<Record<string, boolean>>({});
  async function ensureVaTranscript(fileId: string, rolesCount: number, copyDocId?: string | null) {
    if (vaTranscriptRef.current[fileId]) return;
    vaTranscriptRef.current[fileId] = true;
    const patch = (v: (typeof vaTranscript)[string]) => setVaTranscript((p) => ({ ...p, [fileId]: v }));
    patch({ status: 'loading', note: 'Preparando...' });
    try {
      // COPY-ANCHOR: busca o roteiro do principal (ground truth) se houver.
      let copyTextForPreview: string | null = null;
      if (rolesCount === 2 && copyDocId) {
        if (vaCopyTextRef.current[copyDocId]) {
          copyTextForPreview = vaCopyTextRef.current[copyDocId];
        } else {
          patch({ status: 'loading', note: 'Lendo o roteiro da copy...' });
          try {
            const cr = await fetchDocViaExtension(`https://docs.google.com/document/d/${copyDocId}/edit`);
            if (cr.ok && cr.text) { vaCopyTextRef.current[copyDocId] = cr.text; copyTextForPreview = cr.text; }
          } catch { /* segue sem copy */ }
        }
      }
      const blob = await fetchAdBlob(fileId, (note) => patch({ status: 'loading', note }));
      patch({ status: 'loading', note: 'Extraindo áudio...' });
      const { extractAudio, extractAudioForDiarization } = await import('@/lib/ffmpeg-worker');
      const rawWav = await extractAudio(blob);
      // FILTRO DE VOZ local (bandpass, segundos): trilha sonora confunde o
      // separador de locutores — sem isso a previa rotulava trechos do
      // Doutor como a mulher (user reportou 2026-06-11). O disparo usa
      // Demucs (ainda melhor); aqui o bandpass mantem a previa rapida.
      patch({ status: 'loading', note: 'Filtrando a voz (tirando trilha)...' });
      let voiceWav: Blob = rawWav;
      try {
        const { isolateVoice } = await import('@/lib/voice-isolator');
        const iso = await isolateVoice(rawWav, { mode: 'bandpass', format: 'wav' });
        if (iso && iso.size > 1024) voiceWav = iso;
      } catch { /* segue com audio cru */ }
      // 48k 'audio' (NAO o opus 12k voip da transcricao): diarizacao
      // depende do TIMBRE — compressao agressiva apagava as caracteristicas
      // da voz e o speaker_labels errava.
      const compressed = await extractAudioForDiarization(voiceWav);
      patch({ status: 'loading', note: 'Transcrevendo + separando locutores (AssemblyAI, ~30-60s)...' });
      const fd = new FormData();
      fd.append('audio', new File([compressed], 'voz.ogg', { type: 'audio/ogg' }));
      fd.append('languageCode', 'pt');
      if (rolesCount >= 2) fd.append('speakersExpected', String(rolesCount));
      const r = await fetch('/api/va/diarize', { method: 'POST', body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `diarize HTTP ${r.status}`);
      let utterances: VaUtterance[] = (j.utterances || []).map((u: VaUtterance) => ({
        speaker: String(u.speaker),
        startMs: Number(u.startMs) || 0,
        endMs: Number(u.endMs) || 0,
        text: String(u.text || ''),
      })).sort((a: VaUtterance, b: VaUtterance) => a.startMs - b.startMs);
      const words: VaWord[] = (j.words || []).map((w: VaWord) => ({
        text: String(w.text || ''),
        startMs: Number(w.startMs) || 0,
        endMs: Number(w.endMs) || 0,
      })).filter((w: VaWord) => w.text);
      const durSec = Math.max(
        words.length ? words[words.length - 1].endMs / 1000 : 0,
        utterances.length ? utterances[utterances.length - 1].endMs / 1000 : 0,
      );
      // === RESOLVER UNICO (copy > pitch > AssemblyAI) — igual ao disparo ===
      // 1. COPY-ANCHOR: roteiro do principal (ground truth). 2. PITCH/F0.
      // 3. speaker_labels. Mesma funcao do pipeline -> previa = disparo.
      let method = 'AssemblyAI';
      if (rolesCount === 2 && utterances.length > 0) {
        try {
          patch({ status: 'loading', note: 'Separando os locutores (roteiro + tom de voz)...' });
          let channelData: Float32Array | null = null;
          let sampleRate: number | null = null;
          try {
            const { decodeAudioRobust } = await import('@/lib/audio-engine');
            const buf = await decodeAudioRobust(voiceWav);
            channelData = buf.getChannelData(0);
            sampleRate = buf.sampleRate;
          } catch { /* sem pitch — copy/AAI assumem */ }
          const { resolveVaSpeakers } = await import('@/lib/resolve-va-speakers');
          const resolved = resolveVaSpeakers({
            utterances: utterances.map((u) => ({ speaker: u.speaker, start: u.startMs / 1000, end: u.endMs / 1000, text: u.text })),
            expectedSpeakers: 2,
            channelData,
            sampleRate,
            copyText: copyTextForPreview || null,
          });
          utterances = utterances.map((u, i) => ({ ...u, speaker: `P${resolved.ranks[i] ?? 0}` }));
          method = resolved.method;
        } catch { /* mantem labels AssemblyAI */ }
      }
      // Rank por tempo de fala (mesma heuristica do pipeline)
      const talk = new Map<string, number>();
      for (const u of utterances) talk.set(u.speaker, (talk.get(u.speaker) || 0) + (u.endMs - u.startMs));
      const ranked = Array.from(talk.entries()).sort((a, b) => b[1] - a[1]).map(([s]) => s);
      const rankBySpeaker: Record<string, number> = {};
      ranked.forEach((s, i) => { rankBySpeaker[s] = i; });
      // rank auto por utterance (cronológico) — usado pra pré-preencher os
      // textareas de cada papel
      const autoRanks = utterances.map((u) => Math.min(rankBySpeaker[u.speaker] ?? 0, rolesCount - 1));
      // PRÉ-PREENCHE os textareas por papel com a atribuição auto (1x).
      // Se auto não separou (tudo rank 0), o principal recebe tudo e o user
      // recorta o depoimento — o texto é a fonte de verdade do roteamento.
      for (let rr = 0; rr < rolesCount; rr++) {
        const key = `${fileId}:${rr}`;
        if (vaRoleTextInit.current[key]) continue;
        vaRoleTextInit.current[key] = true;
        const txt = utterances.filter((_, i) => autoRanks[i] === rr).map((u) => u.text).join(' ').trim();
        setVaRoleText((prev) => (prev[key] !== undefined ? prev : { ...prev, [key]: txt }));
      }
      patch({ status: 'ready', utterances, words, durSec, rankBySpeaker, autoRanks, speakerCount: ranked.length, method });
    } catch (e) {
      vaTranscriptRef.current[fileId] = false;
      patch({ status: 'error', error: (e as Error)?.message || 'falha na transcrição' });
    }
  }
  const fmtMsClock = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /** Papeis de uma variacao VA: doc novo traz roles[] (Doutor + Depoimento
   *  Mulher etc); legado/1 papel vira papel unico sintetico. */
  function vaRolesOf(av: { username: string; fileId: string | null; roles?: Array<{ role: string; username: string; fileId: string | null; isDepoimento: boolean }> }) {
    if (av.roles && av.roles.length > 0) return av.roles;
    return [{ role: 'Avatar', username: av.username, fileId: av.fileId, isDepoimento: false }];
  }
  /** Key de escolha por papel. Papel 0 (principal) usa a key legada
   *  `${taskId}:${avaCode}` — preserva escolhas ja feitas; papeis extras
   *  ganham sufixo `#<idx>`. */
  function vaRoleKey(taskId: string, avaCode: string, roleIdx: number) {
    return roleIdx === 0 ? `${taskId}:${avaCode}` : `${taskId}:${avaCode}#${roleIdx}`;
  }

  /** TROCA DE ÁUDIO: novo WHITE upado pelo user por task. Key: taskId → File */
  const [trocaWhite, setTrocaWhite] = useState<Record<string, File | null>>({});
  /** TROCA DE ÁUDIO: intensidade da camuflagem do novo WHITE (5-100). */
  const [trocaVolume, setTrocaVolume] = useState<Record<string, number>>({});
  /** TROCA DE ÁUDIO: URL/Drive ID do AD original (input manual fallback). */
  const [trocaAdUrl, setTrocaAdUrl] = useState<Record<string, string>>({});
  /** TROCA DE ÁUDIO: prova por transcricao do resultado (o que a IA le).
   *  Key: taskId → { loading?, text?, err? } */
  const [trocaProof, setTrocaProof] = useState<Record<string, { loading?: boolean; text?: string; err?: string }>>({});
  /** TROCA DE ÁUDIO: feedback visual de drag-and-drop no upload do WHITE. */
  const [trocaDragOver, setTrocaDragOver] = useState<Record<string, boolean>>({});

  /** Extrai Drive file ID de uma URL Drive (varios formatos suportados) */
  function extractDriveFileId(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    // ID puro (25-50 chars alfanum-_)
    if (/^[a-zA-Z0-9_-]{20,60}$/.test(trimmed)) return trimmed;
    // URL formats: /file/d/<ID>/  /open?id=<ID>  /uc?id=<ID>
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
      /[?&]id=([a-zA-Z0-9_-]{20,60})/,
      /\/d\/([a-zA-Z0-9_-]{20,60})/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /** Extrai o ID de uma PASTA do Drive (/drive/folders/<ID>). null se nao for
   *  link de pasta. Usado pra aceitar link de pasta colado manualmente. */
  function extractDriveFolderId(input: string): string | null {
    if (!input) return null;
    const m = input.match(/\/folders\/([a-zA-Z0-9_-]{20,60})/);
    return m ? m[1] : null;
  }

  // ===== CRITERIO UNICO DE "PRONTO PRA DISPARAR" =====
  // Usado no START, no botao "Iniciar N" e nos contadores — pra UI e dispatch
  // SEMPRE baterem. VA: status nasce 'partial' por design; o que vale e ter
  // todos os avatares escolhidos. TROCA: WHITE upado + fonte (arquivo/pasta).
  /** True se o briefing VA tem copy FALADA (hook/body) no doc. Formato novo
   *  de doc VA (2026-06) costuma vir SEM copy — so 'Link do AD' + avatares,
   *  porque o audio espelha o AD original. */
  function vaHasSpokenCopy(va: ParsedVABriefing | undefined | null): boolean {
    if (!va) return false;
    return !!(extractSpokenBody(va.hookText || '').trim() || extractSpokenBody(va.bodyText || '').trim());
  }
  /** Motor TEXTO so quando canal organico (KWAI/YT/TikTok) E o doc tem copy
   *  falada. Sem copy no doc, o disparo e SEMPRE lipsync no AD original
   *  (igual VA normal) — mesmo com label de canal organico na task. Antes,
   *  canal organico + doc sem copy caia no motor texto e morria em
   *  'briefing sem hook nem body falado' (user reportou 2026-06-10). */
  function vaUsesTextEngine(taskId: string): boolean {
    // RESUME após restart: usa a decisão CONGELADA no disparo (tasks[] pode estar
    // vazio agora → organicChannelLabels mentiria). Override só existe em resume.
    if (taskId in vaTextEngineOverride) return vaTextEngineOverride[taskId];
    const a = taskAnalyses[taskId];
    if (!vaHasSpokenCopy(a?.vaBriefing)) return false;
    return organicChannelLabels(tasks.find((t) => t.id === taskId)).length > 0;
  }
  function isVaDispatchable(id: string): boolean {
    const a = taskAnalyses[id];
    if (!a?.vaBriefing) return false;
    return (
      a.vaBriefing.avatares.length > 0 &&
      // TODOS os papeis de TODAS as variacoes precisam de avatar escolhido
      // (multi-locutor: Doutor E Depoimento, cada um com seu avatar HeyGen)
      a.vaBriefing.avatares.every((av) =>
        vaRolesOf(av).every((_, ri) => vaAvatarChoice[vaRoleKey(id, av.avaCode, ri)]?.id),
      )
    );
  }
  function isTrocaDispatchable(id: string): boolean {
    const a = taskAnalyses[id];
    if (!a?.trocaBriefing) return false;
    const hasWhite = !!trocaWhite[id];
    const src =
      a.trocaBriefing.driveId ||
      extractDriveFileId(trocaAdUrl[id] || '') ||
      extractDriveFolderId(trocaAdUrl[id] || '');
    return hasWhite && !!src;
  }
  function isTaskDispatchable(id: string): boolean {
    const a = taskAnalyses[id];
    if (!a) return false;
    if (a.vaBriefing) return isVaDispatchable(id);
    if (a.trocaBriefing) return isTrocaDispatchable(id);
    return a.status === 'ready';
  }

  /** Roda o pipeline VA pra uma task — orquestra download AD → split audio
   *  → dispatch HeyGen audio mode por avatar → mount → ZIP final. */
  /** Pré-cheque de prontidão do VA (avatar+voz+Drive). Retorna lista de
   *  pendências pra UI listar antes de enfileirar. Vazio = pronto. */
  function vaReadinessIssues(taskId: string): string[] {
    const a = taskAnalyses[taskId];
    const va = a?.vaBriefing;
    if (!va) return ['não é VA'];
    const issues: string[] = [];
    // Canal organico (KWAI/YT/TikTok) COM copy no doc: motor TEXTO — nao
    // baixa o AD original e usa a voz default do avatar. Doc sem copy
    // (formato novo) = lipsync sempre, entao exige AD + voz normalmente.
    const textEngine = vaUsesTextEngine(taskId);
    if (!textEngine) {
      const driveId = va.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '');
      if (!driveId) issues.push('AD original (Drive)');
    }
    const maxRoles = Math.max(...va.avatares.map((av) => vaRolesOf(av).length));
    for (const av of va.avatares) {
      const roles = vaRolesOf(av);
      for (let ri = 0; ri < roles.length; ri++) {
        const label = roles.length > 1 ? `${av.avaCode}·${roles[ri].role}` : av.avaCode;
        if (!vaAvatarChoice[vaRoleKey(taskId, av.avaCode, ri)]?.id) issues.push(`avatar ${label}`);
        // Voz é OBRIGATÓRIA no lipsync — sem voiceId o Espelhamento cai na voz
        // original do AD (o bug que o user reclamava). No motor TEXTO a voz é
        // opcional (cai na voz default do avatar, igual task normal).
        if (!textEngine && !vaVoiceChoice[vaRoleKey(taskId, av.avaCode, ri)]?.id) issues.push(`voz ${label}`);
      }
    }
    // MULTI-PAPEL: exige o 👁 confirmado (segmentos prontos) antes de
    // disparar — a GARANTIA de que o disparo bate com o que o user viu.
    // Auto sozinho não é 100% (voz IA), então o user confirma 1x por task.
    if (!textEngine && maxRoles >= 2 && va.linkAdFileId) {
      const segs = buildVaSegments(va.linkAdFileId, maxRoles);
      if (!segs) issues.push('confirmar 👁 (quem fala cada trecho)');
    }
    return issues;
  }

  /** Runner VA — AGORA escreve em batchStates (igual task normal): mesma
   *  fila (runHeyGenGated/PROMOTER), mesmo card (BatchJobCard3D) e mesmos
   *  previews de lipsync ao vivo. Disparado pelo START / promoter, nunca
   *  mais por botao "Iniciar Pipeline VA" por task. */
  async function runVAPipelineForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a?.vaBriefing) {
      // Reload sem taskAnalyses: nao da pra reconstruir o briefing VA.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'failed', message: 'VA: reabra a task no ClickUp Pilot e analise de novo (briefing nao sobrevive reload).', finishedAt: Date.now() } };
      });
      return;
    }
    const va = a.vaBriefing;
    const baseAdId = va.baseAdId;
    const adNameClean = baseAdId.replace(/\s+/g, '');

    // SNAPSHOT DE RESUME (sobrevive restart do PC): grava AGORA, no disparo,
    // TUDO que este runner precisa — capturado no ponto-em-que-disparou. Assim,
    // se o navegador fechar no meio, o resume reidrata isto e re-roda do certo
    // (em vez de morrer em "briefing nao sobrevive reload"). Best-effort.
    try {
      const tid = `${taskId}:`;
      const fileId = va.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '') || null;
      const pick = (obj: Record<string, unknown>, pref: string) =>
        Object.fromEntries(Object.entries(obj).filter(([k]) => k.startsWith(pref)));
      const roleTexts = fileId
        ? Object.fromEntries(Object.entries(vaRoleText).filter(([k]) => k.startsWith(`${fileId}:`)))
        : {};
      persistVAResumeSnapshot(taskId, {
        // briefing slim (sem candidateLinks — bloat e nao usado pelo runner)
        vaBriefing: { ...va, candidateLinks: undefined },
        taskName: a.taskName,
        baseAdId,
        docUrl: batchStates[taskId]?.docUrl || a.docUrl || null,
        taskUrl: batchStates[taskId]?.taskUrl || a.taskUrl || null,
        adUrl: vaAdUrl[taskId] || null,
        usesTextEngine: vaUsesTextEngine(taskId),  // congela o roteamento (tasks[] some no restart)
        avatarChoices: pick(vaAvatarChoice as Record<string, unknown>, tid),
        voiceChoices: pick(vaVoiceChoice as Record<string, unknown>, tid),
        motionPrompts: pick(vaMotionPrompt as Record<string, unknown>, tid),
        fileId,
        transcript: fileId ? vaTranscript[fileId] : undefined,
        roleTexts,
      });
    } catch { /* best-effort */ }

    // ROUTER MOTOR — VA com canal organico (KWAI/YT/TikTok) E copy no doc
    // NAO faz lipsync no AD original: gera cada parte (hook+body) por TEXTO
    // (text-to-avatar), 1 video por AVA, na MESMA fila/cards/ZIP. META, VA
    // sem canal E doc SEM copy (formato novo: so 'Link do AD' + avatares)
    // seguem no pipeline de lipsync abaixo — intocado.
    if (vaUsesTextEngine(taskId)) {
      await runVATextEngineForTask(taskId);
      return;
    }

    // Validacao — marca failed no card (em vez de so setError, que o user
    // nao associa ao card rodando).
    const issues = vaReadinessIssues(taskId);
    if (issues.length > 0) {
      const msg = `VA incompleto — falta: ${issues.join(', ')}. Configure na task e dispare de novo.`;
      setError(msg);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now() }),
          phase: 'failed', isVA: true, message: msg, finishedAt: Date.now(),
        } as BatchTaskState,
      }));
      return;
    }
    const driveId = va.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '')!;
    const adOriginalUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
    const vaStartedAt = batchStates[taskId]?.startedAt || Date.now();

    // Helpers de escrita no batchStates
    const patchVA = (patch: Partial<BatchTaskState>) => setBatchStates((prev) => {
      const base: BatchTaskState = prev[taskId] || { taskId, taskName: a.taskName, baseAdId, parts: [], startedAt: vaStartedAt, phase: 'dispatching' };
      return { ...prev, [taskId]: { ...base, ...patch } };
    });
    // Cria/atualiza um "take" (parte) por label — alimenta os previews.
    const upsertPart = (label: string, patch: Partial<BatchTaskState['parts'][number]>) => setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      const idx = cur.parts.findIndex((p) => p.label === label);
      const parts = idx === -1
        ? [...cur.parts, { label, videoId: null, renamedTo: `${label}.mp4`, ...patch }]
        : cur.parts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...prev, [taskId]: { ...cur, parts } };
    });
    const vaPhaseFromStage = (stage: string): BatchTaskState['phase'] =>
      /mount|assemble|zip/i.test(stage) ? 'post'
      : /dispatch/i.test(stage) ? 'rendering'
      : 'dispatching';

    batchCancelRef.current[taskId] = false;
    patchVA({
      phase: 'dispatching', isVA: true, adOriginalUrl,
      docUrl: batchStates[taskId]?.docUrl || a.docUrl,
      taskUrl: batchStates[taskId]?.taskUrl || a.taskUrl,
      message: 'Baixando AD original do Drive...', finishedAt: undefined,
    });

    try {
      // 1. Download AD via extension — progresso real no card (chunks em
      // stream, extension v4.16.3+; fila global serializa VAs concorrentes)
      const { downloadDriveFileViaExtension } = await import('@/lib/heygen-extension-bridge');
      const fmtMB = (n: number) => (n / 1048576).toFixed(1);
      const dl = await downloadDriveFileViaExtension(driveId, {
        onProgress: (rec, tot) => patchVA({
          message: `Baixando AD original do Drive... ${fmtMB(rec)}MB${tot ? ` / ${fmtMB(tot)}MB` : ''}`,
        }),
      });
      if (!dl.ok) throw new Error('Drive download: ' + dl.error);
      patchVA({ phase: 'dispatching', message: `Baixado ${(dl.size / (1024 * 1024)).toFixed(1)}MB. Extraindo voz + split...` });

      // 2. Pipeline (extract audio + split + dispatch + mount)
      const { runVAPipeline } = await import('@/lib/va-pipeline');
      const { downloadVideoBytes } = await import('@/lib/heygen-api-direct');

      // MULTI-LOCUTOR: cada variacao leva os avatares de TODOS os papeis
      // (roleAvatars[0] = principal). 2+ papeis + diarize → pipeline corta
      // nos turnos de fala e roteia cada trecho pro avatar/voz do papel.
      const avatares = va.avatares.map((av) => {
        const roles = vaRolesOf(av);
        const roleAvatars = roles.map((r, ri) => {
          const c = vaAvatarChoice[vaRoleKey(taskId, av.avaCode, ri)]!;
          return {
            roleLabel: r.role,
            isDepoimento: r.isDepoimento,
            avatarId: c.id,
            avatarName: c.name,
            voiceId: vaVoiceChoice[vaRoleKey(taskId, av.avaCode, ri)]?.id || null,
          };
        });
        return {
          avaCode: av.avaCode,
          avatarId: roleAvatars[0].avatarId,
          avatarName: roleAvatars[0].avatarName,
          roleAvatars,
          swapSpeakers: false,
        };
      });
      const voiceByAva: Record<string, string | null> = {};
      for (const av of va.avatares) {
        voiceByAva[av.avaCode] = vaVoiceChoice[`${taskId}:${av.avaCode}`]?.id || null;
      }
      const maxRoles = Math.max(...va.avatares.map((av) => vaRolesOf(av).length));

      // SEGMENTOS CONFIRMADOS NO PREVIEW (a garantia): se o user abriu o 👁
      // e (talvez) corrigiu quem fala cada trecho, o disparo usa EXATAMENTE
      // isso. Por fileId do AD (transcript compartilhado entre AVA01/02).
      let precomputedSegments: Array<{ start: number; end: number; rank: number }> | null = null;
      if (maxRoles >= 2 && va.linkAdFileId) {
        precomputedSegments = buildVaSegments(va.linkAdFileId, maxRoles);
      }

      // COPY-ANCHOR: busca o roteiro do principal (se o doc tem "Link da
      // Copy") ANTES de disparar — orienta a separacao automatica (so usada
      // se NAO houver segmentos confirmados no preview).
      if (maxRoles >= 2 && !precomputedSegments && va.linkCopyDocId && !vaCopyTextRef.current[va.linkCopyDocId]) {
        patchVA({ message: 'Lendo o roteiro da copy (pra separar os locutores)...' });
        try {
          const cr = await fetchDocViaExtension(`https://docs.google.com/document/d/${va.linkCopyDocId}/edit`);
          if (cr.ok && cr.text) vaCopyTextRef.current[va.linkCopyDocId] = cr.text;
        } catch { /* segue sem copy — pitch assume */ }
      }

      const pipeRes = await runVAPipeline({
        baseAdId: adNameClean,
        adVideoBytes: dl.bytes,
        avatares,
        smartMode: false,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onProgress: (p) => {
          patchVA({ phase: vaPhaseFromStage(p.stage), message: p.message });
        },
        // MULTI-LOCUTOR: diarizacao via AssemblyAI (so chamada pelo pipeline
        // quando alguma variacao tem 2+ papeis). Comprime a voz isolada em
        // opus 12k mono (~90KB/min — folga no limite 4.5MB do Vercel).
        diarize: maxRoles >= 2 ? async (audioBlob: Blob) => {
          // 48k 'audio' preserva o timbre (12k voip fazia o speaker_labels
          // confundir os locutores). Input aqui ja e a voz isolada (Demucs).
          const { extractAudioForDiarization } = await import('@/lib/ffmpeg-worker');
          const compressed = await extractAudioForDiarization(audioBlob);
          const fd = new FormData();
          fd.append('audio', new File([compressed], 'voz.ogg', { type: 'audio/ogg' }));
          fd.append('languageCode', 'pt');
          fd.append('speakersExpected', String(maxRoles));
          const r = await fetch('/api/va/diarize', { method: 'POST', body: fd });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || `diarize HTTP ${r.status}`);
          return (j.utterances || []).map((u: { speaker: string; startMs: number; endMs: number; text?: string }) => ({
            speaker: String(u.speaker),
            start: u.startMs / 1000,
            end: u.endMs / 1000,
            text: String(u.text || ''),
          }));
        } : undefined,
        // COPY-ANCHOR: roteiro do principal (orienta a separacao automatica)
        copyText: vaCopyTextRef.current[va.linkCopyDocId || ''] || null,
        // SEGMENTOS CONFIRMADOS no preview — quando presentes, o disparo usa
        // exatamente isso (preview == disparo, zero vazamento).
        precomputedSegments,
        // === Espelhamento de Voz REAL (sts_pending) — fix 2026-06-03 ===
        // processJob({voiceMirroring:true, voiceId}) agora monta o body
        // nativo (audio_type sts_pending + source_audio_url + voice_id):
        // avatar fala com a VOZ ESCOLHIDA mantendo o timing do AD original.
        dispatchAudioTake: async ({ avatarId, audioBytes, audioFilename, label, voiceId: roleVoiceId }) => {
          if (batchCancelRef.current[taskId]) throw new Error('cancelado');
          upsertPart(label, { videoId: null, videoStatus: 'pending', error: null });
          const { processJob } = await import('@/lib/heygen-api-direct');
          const file = new File([audioBytes as BlobPart], audioFilename || `${label}.wav`, { type: 'audio/wav' });
          // MULTI-LOCUTOR: voz vem do papel resolvido pelo pipeline; fallback
          // legado = lookup por avatarId (extensoes do fluxo classico)
          const avFromId = va.avatares.find((x) => vaAvatarChoice[`${taskId}:${x.avaCode}`]?.id === avatarId);
          const voiceId = roleVoiceId !== undefined && roleVoiceId !== null
            ? roleVoiceId
            : (avFromId ? voiceByAva[avFromId.avaCode] : null);
          // APPLY CUSTOM MOTION: mesma regra da rota de texto — prompt preenchido
          // sobe pro Avatar IV, que e o unico que aceita motion.
          const motionPrompt = avFromId ? (vaMotionPrompt[`${taskId}:${avFromId.avaCode}`] || '').trim() : '';
          console.log(`[VA dispatch ${label}] avatarId=${avatarId} voiceId=${voiceId || '(default)'}${motionPrompt ? ' motion=ON (Avatar IV)' : ''}`);
          let job;
          try {
            job = await processJob({
              file, avatarId,
              title: `${adNameClean}_${label}`,
              engine: motionPrompt ? 'iv' : 'iii', orientation: 'portrait',
              motionPrompt: motionPrompt || undefined,
              voiceMirroring: true,
              voiceId: voiceId || undefined,
            }, { onProgress: (stage: string) => console.log(`[VA dispatch ${label}] ${stage}`) });
          } catch (e) {
            upsertPart(label, { error: (e as Error)?.message || 'falha no dispatch' });
            throw e;
          }
          if (!job.videoId) {
            upsertPart(label, { error: 'processJob nao retornou videoId' });
            throw new Error('processJob nao retornou videoId.');
          }
          upsertPart(label, { videoId: job.videoId, videoStatus: 'pending' });
          const statuses = await pollVideosUntilReady([job.videoId], { intervalMs: 8000, timeoutMs: 30 * 60 * 1000 });
          const st = statuses[job.videoId];
          if (!st || st.status !== 'completed' || !st.videoUrl) {
            upsertPart(label, { videoStatus: st?.status, error: st?.error || 'nao renderizou' });
            throw new Error(`Video ${label} nao renderizou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
          }
          upsertPart(label, { videoStatus: 'completed', videoUrl: st.videoUrl });
          const bytes = await downloadVideoBytes(st.videoUrl);
          return new Blob([bytes as BlobPart], { type: 'video/mp4' });
        },
      });

      // 3. Monta ZIP final
      patchVA({ phase: 'post', message: 'Zipando vídeos finais...' });
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const item of pipeRes.items) {
        if (item.blob) zip.file(item.filename, item.blob);
        else zip.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`, item.error || 'falha sem detalhes');
      }
      zip.file('_DIAGNOSTICO.txt',
`Pipeline VA - relatorio
========================
${pipeRes.summary}
Audio segments: ${pipeRes.audioSegmentCount}

Items:
${pipeRes.items.map(i => `- ${i.filename}: ${i.blob ? 'OK' : 'ERRO ('+(i.error || 'sem detalhes')+')'}`).join('\n')}
`);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const zipName = `${adNameClean}_VA.zip`;
      const zipUrl = URL.createObjectURL(zipBlob);
      await persistDeliverableOrRescue(`va:${taskId}:zip`, zipBlob, zipName);

      // ZIP do VA entra no slot "montado" → botao de download unico do card
      // funciona igual task normal.
      const okAvas = pipeRes.items.filter((it: any) => it.blob).length;
      const expectedAvas = pipeRes.items.length;
      const failedAvas = pipeRes.items
        .map((it: any, i: number) => (it.blob ? null : (va.avatares[i]?.avaCode || `AVA${i + 1}`)))
        .filter(Boolean) as string[];
      const vaPartial = okAvas < expectedAvas;
      patchVA({
        phase: 'done',
        message: vaPartial
          ? `⚠ INCOMPLETO: ${okAvas}/${expectedAvas} avatares — falta ${failedAvas.join('/')}. Clica RETOMAR pra gerar o que faltou.`
          : `Pronto: ${pipeRes.summary}`,
        // BLINDAGEM: o card lê isto pra NÃO mostrar verde quando faltou avatar.
        vaStats: { okAvas, expectedAvas, failedAvas },
        montadoZipUrl: zipUrl, montadoZipName: zipName,
        finishedAt: Date.now(),
      });
      if (!vaPartial) {
        logHistory({
          tool: 'clickup-pilot',
          title: `${adNameClean} (VA) entregue`,
          meta: `${okAvas} avatares`,
        });
      }
      const siblings = getSiblingTaskIds(taskId);
      for (const sid of siblings) markDispatched(sid);
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId,
          avatares: pipeRes.items.map((it: any, i: number) => ({
            avaCode: va.avatares[i]?.avaCode || `AVA${i+1}`,
            username: va.avatares[i]?.username || '?',
            status: it.blob ? 'done' : 'failed',
          })),
          startedAt: vaStartedAt, finishedAt: Date.now(), zipName,
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    } catch (e) {
      if (isChunkLoadError(e)) {
        patchVA({ phase: 'failed', message: '⚠ Saiu uma versão nova do app durante o processamento — recarregando pra atualizar. Seus takes estão salvos; depois clique Retomar.', finishedAt: Date.now() });
        reloadOnceForChunk();
        return;
      }
      patchVA({ phase: 'failed', message: (e as Error)?.message || String(e), finishedAt: Date.now() });
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId,
          avatares: va.avatares.map((av: any) => ({ avaCode: av.avaCode, username: av.username, status: 'failed' })),
          startedAt: vaStartedAt, finishedAt: Date.now(),
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    }
  }

  /** Motor TEXTO do VA — usado quando a task tem canal organico (KWAI/YT/
   *  TikTok). Em vez de baixar o AD original e fazer lipsync, gera cada
   *  parte falada (HOOK + BODY split ~20s) por TEXTO via HeyGen text-to-
   *  avatar (mesma primitiva processJob{text} da task normal), concatena as
   *  partes e produz 1 video por AVA. Roda na MESMA fila gated, escreve nos
   *  mesmos batchStates/cards e gera o mesmo ZIP final ({adId}-AVAxx.mp4). */
  async function runVATextEngineForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a?.vaBriefing) {
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'failed', message: 'VA: reabra a task no ClickUp Pilot e analise de novo (briefing nao sobrevive reload).', finishedAt: Date.now() } };
      });
      return;
    }
    const va = a.vaBriefing;
    const baseAdId = va.baseAdId;
    const adNameClean = baseAdId.replace(/\s+/g, '');
    const channelLabels = organicChannelLabels(tasks.find((t) => t.id === taskId));
    const vaStartedAt = batchStates[taskId]?.startedAt || Date.now();

    const patchVA = (patch: Partial<BatchTaskState>) => setBatchStates((prev) => {
      const base: BatchTaskState = prev[taskId] || { taskId, taskName: a.taskName, baseAdId, parts: [], startedAt: vaStartedAt, phase: 'dispatching' };
      return { ...prev, [taskId]: { ...base, ...patch } };
    });
    const upsertPart = (label: string, patch: Partial<BatchTaskState['parts'][number]>) => setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      const idx = cur.parts.findIndex((p) => p.label === label);
      const parts = idx === -1
        ? [...cur.parts, { label, videoId: null, renamedTo: `${label}.mp4`, ...patch }]
        : cur.parts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...prev, [taskId]: { ...cur, parts } };
    });

    // Readiness — motor texto so precisa do avatar por AVA (voz opcional,
    // cai na default do avatar). Sem AD original.
    const missing: string[] = [];
    for (const av of va.avatares) {
      if (!vaAvatarChoice[`${taskId}:${av.avaCode}`]?.id) missing.push(`avatar ${av.avaCode}`);
    }
    if (missing.length > 0) {
      const msg = `VA (texto) incompleto — falta: ${missing.join(', ')}. Configure na task e dispare de novo.`;
      setError(msg);
      patchVA({ phase: 'failed', isVA: true, message: msg, finishedAt: Date.now() });
      return;
    }

    // Partes faladas: HOOK (se houver) + BODY split ~20s (igual task normal).
    const hookText = extractSpokenBody(va.hookText || '').trim();
    const bodyText = extractSpokenBody(va.bodyText || '').trim();
    const partPlan: Array<{ label: string; text: string }> = [];
    if (hookText) partPlan.push({ label: 'HOOK', text: hookText });
    if (bodyText) {
      const bodyParts = splitCopyIntoParts(bodyText, { targetSec: 20, minSec: 10, maxSec: 35 });
      bodyParts.forEach((t, i) => partPlan.push({ label: bodyParts.length === 1 ? 'BODY' : `BODY ${i + 1}`, text: t }));
    }
    if (partPlan.length === 0) {
      patchVA({ phase: 'failed', isVA: true, message: 'VA (texto): briefing sem hook nem body falado.', finishedAt: Date.now() });
      return;
    }

    batchCancelRef.current[taskId] = false;
    patchVA({
      phase: 'dispatching', isVA: true,
      docUrl: batchStates[taskId]?.docUrl || a.docUrl,
      taskUrl: batchStates[taskId]?.taskUrl || a.taskUrl,
      message: `Gerando por texto (canal ${channelLabels.join('/') || 'organico'})...`,
      finishedAt: undefined,
    });

    try {
      const { processJob, downloadVideoBytes, isQuotaError, isSpaceMismatchError, findCompletedVideosByName } = await import('@/lib/heygen-api-direct');
      const { concatAvatarParts, concatVideosFast, normalizeForConcat, cancelFFmpeg } = await import('@/lib/ffmpeg-worker');
      // MONTAGEM À PROVA DE OOM (fix 2026-07-04): as partes de UM avatar (mesmo
      // HeyGen, mesmo codec) concatenam com -c:v copy (rápido, baixa memória).
      // O concatAvatarParts MONOLÍTICO (re-encode de tudo num filter_complex só)
      // ESTOURA a memória do ffmpeg-wasm em vídeo grande (ex 132MB, 9 partes) →
      // o watchdog matava o exec ("called FFmpeg.terminate()") e o avatar falhava
      // (era o "AVA02 falha na montagem sempre"). Mesma estratégia do pipeline
      // normal (concatRobust): fast-copy → normaliza-cada+fast → monolítico.
      // concatVideosFast/normalizeForConcat já validam a saída (assertValidMp4).
      const mountAvatarParts = async (parts: Blob[]): Promise<Blob> => {
        if (parts.length === 1) return parts[0];
        try {
          return await concatVideosFast(parts); // -c:v copy — leve, sem OOM
        } catch {
          const normalized: Blob[] = [];
          let allNorm = true;
          for (const p of parts) {
            try { normalized.push(await normalizeForConcat(p)); }
            catch { normalized.push(p); allNorm = false; }
          }
          // fast-concat SÓ é seguro se TODAS normalizaram (senão -c copy dropa
          // vídeo divergente → desync). Se alguma falhou, vai pro monolítico.
          if (allNorm) {
            try { return await concatVideosFast(normalized); }
            catch { return await concatAvatarParts(normalized); }
          }
          return await concatAvatarParts(normalized);
        }
      };
      const items: Array<{ avaCode: string; filename: string; blob: Blob | null; error?: string }> = [];

      // RECUPERAÇÃO: lista as partes JÁ RENDERIZADAS deste AD no HeyGen (de runs
      // anteriores). No RETOMAR, partes que ficaram prontas no HeyGen mas o app
      // não capturou (poll estourou / cota voltou DEPOIS do vídeo pronto) são
      // REUSADAS daqui — sem re-gerar, sem gastar cota. 1 query (não por parte).
      let heygenDone = new Map<string, string>();
      try {
        patchVA({ phase: 'rendering', message: 'Checando partes já prontas no HeyGen...' });
        heygenDone = await findCompletedVideosByName(adNameClean);
        if (heygenDone.size > 0) console.log(`[VA-texto] ${heygenDone.size} parte(s) já prontas no HeyGen — vão ser reusadas sem re-gerar`);
      } catch { /* best-effort → render normal */ }

      // ═══ FASE 1 — gera/recupera as partes de TODOS os avatares ANTES de montar
      // qualquer um (a montagem fica na FASE 2). Antes era por-avatar (montava o
      // AVA01 inteiro pra SÓ DEPOIS tentar o AVA02). Agora o AVA02 é tentado ANTES
      // de montar, e o montar só roda no fim — com tudo que deu pra gerar/recuperar
      // já em mãos. (User: "recuperar os mp4 de todas as partes antes de montar".)
      const pendingMontagem: Array<{ avaCode: string; filename: string; partBlobs: Blob[]; avError: string | null }> = [];
      for (const av of va.avatares) {
        if (batchCancelRef.current[taskId]) throw new Error('cancelado');
        const choice = vaAvatarChoice[`${taskId}:${av.avaCode}`]!;
        const voiceId = vaVoiceChoice[`${taskId}:${av.avaCode}`]?.id || undefined;
        // APPLY CUSTOM MOTION: prompt preenchido => a cena precisa de movimento
        // (mexer a gelatina, espremer o limao...) e so o Avatar IV/V faz isso.
        // Vazio => Avatar III, que e mais barato e nao inventa gesto.
        const motionPrompt = (vaMotionPrompt[`${taskId}:${av.avaCode}`] || '').trim();
        const engineKey: 'iii' | 'iv' = motionPrompt ? 'iv' : 'iii';
        const filename = `${adNameClean}-${av.avaCode}.mp4`;
        const partBlobs: Blob[] = [];
        let avError: string | null = null;
        try {
          for (const part of partPlan) {
            if (batchCancelRef.current[taskId]) throw new Error('cancelado');
            const label = `${av.avaCode}·${part.label}`;
            // IDENTIDADE DA PARTE POR CONTEÚDO (avatar+voz+texto). Esse hash entra
            // em 3 lugares: (1) chave do cache IDB, (2) chave de RECUPERAÇÃO do
            // HeyGen, (3) TÍTULO do vídeo no HeyGen. Assim, reuso (cache ou HeyGen)
            // só acontece pra MESMO avatar/voz/texto. Disparo com AVATAR DIFERENTE
            // = hash diferente = título diferente = NÃO casa com o antigo = gera o
            // novo. Cada disparo fica isolado, sem misturar avatares de runs antigas.
            // motionPrompt entra no hash: mudar o movimento tem que gerar de novo,
            // senao o cache/recuperacao devolve o video ANTIGO sem o gesto.
            const partHash = shortHash(`${part.text}|${choice.id}|${voiceId || ''}|${motionPrompt}`);
            const heygenTitle = `${adNameClean}_${av.avaCode}_${part.label}_${partHash}`;
            const partCacheKey = `va:${taskId}:part:${label}@${partHash}`;
            let partBytes: Uint8Array | null = null;
            try {
              const { loadBlob } = await import('@/lib/zip-store');
              const cached = await loadBlob(partCacheKey, 'video/mp4');
              if (cached && cached.size > 1024) {
                partBytes = new Uint8Array(await cached.arrayBuffer());
                // videoId sentinela + object URL → a parte reusada aparece no
                // preview e conta no "Takes (x/y)" (senão pareceria que sumiu).
                const url = URL.createObjectURL(cached);
                upsertPart(label, { videoId: `cached:${label}`, videoStatus: 'completed', videoUrl: url, error: null });
                patchVA({ phase: 'rendering', message: `${av.avaCode}: ${part.label} reusado (já gerado, sem re-gerar)` });
              }
            } catch { /* cache miss/erro → tenta HeyGen/renderiza */ }

            // 2) RECUPERAÇÃO do HeyGen: a parte já renderizou antes (MESMO
            // avatar/voz/texto) mas não foi capturada? Reusa o vídeo pronto
            // (baixa, sem re-gerar = sem cota). Casa pelo TÍTULO COM HASH → nunca
            // pega vídeo de um avatar diferente de outro disparo.
            if (!partBytes) {
              const doneUrl = heygenDone.get(heygenTitle);
              if (doneUrl) {
                try {
                  patchVA({ phase: 'rendering', message: `${av.avaCode}: ${part.label} recuperado do HeyGen (já estava pronto)` });
                  partBytes = await downloadVideoBytes(doneUrl);
                  upsertPart(label, { videoId: `heygen:${label}`, videoStatus: 'completed', videoUrl: doneUrl, error: null });
                  try {
                    const { saveBlob } = await import('@/lib/zip-store');
                    await saveBlob(partCacheKey, new Blob([partBytes as BlobPart], { type: 'video/mp4' }), 'video/mp4');
                  } catch { /* best-effort */ }
                } catch { partBytes = null; /* download falhou → renderiza */ }
              }
            }

            if (!partBytes) {
              upsertPart(label, { videoId: null, videoStatus: 'pending', error: null });
              // ASSERTIVIDADE: o render HeyGen zombia/falha de forma INTERMITENTE.
              // Antes, 1 parte que falhava matava o AVATAR inteiro (= "1/2 AVAs",
              // user reportou 2026-06-23). Agora RE-DISPARA a parte até 3x (cada
              // tentativa = novo videoId) antes de desistir — transiente se cura
              // sozinho, sem o user ter que clicar Retomar.
              let lastErr = '';
              for (let attempt = 1; attempt <= 3 && !partBytes; attempt++) {
                if (batchCancelRef.current[taskId]) throw new Error('cancelado');
                patchVA({ phase: 'rendering', message: `${av.avaCode}: gerando ${part.label} por texto${attempt > 1 ? ` (tentativa ${attempt})` : ''}...` });
                try {
                  const job = await processJob({
                    text: part.text,
                    avatarId: choice.id,
                    voiceId,
                    title: heygenTitle,
                    engine: engineKey, orientation: 'portrait',
                    motionPrompt: motionPrompt || undefined,
                  }, { onProgress: (stage: string) => console.log(`[VA-texto ${label} t${attempt}] ${stage}`) });
                  if (!job.videoId) throw new Error('processJob nao retornou videoId');
                  upsertPart(label, { videoId: job.videoId, videoStatus: 'pending', error: null });
                  const statuses = await pollVideosUntilReady([job.videoId], { intervalMs: 8000, timeoutMs: 30 * 60 * 1000, maxPendingMsPerId: 15 * 60 * 1000 });
                  const st = statuses[job.videoId];
                  if (!st || st.status !== 'completed' || !st.videoUrl) {
                    throw new Error(`nao renderizou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
                  }
                  upsertPart(label, { videoStatus: 'completed', videoUrl: st.videoUrl, error: null });
                  partBytes = await downloadVideoBytes(st.videoUrl);
                } catch (e) {
                  lastErr = (e as Error)?.message || 'falha';
                  upsertPart(label, { error: lastErr });
                  // TERMINAL (re-tentar NÃO cura → PARA na hora, sem gastar as 3
                  // tentativas nem o tempo do user):
                  //  - COTA/limite diário do HeyGen (só reset/outra conta resolve)
                  //  - AVATAR/LOOK de OUTRO workspace que o ativo (404 look not
                  //    found / not accessible in space) — Retomar inteligente: não
                  //    insiste num avatar impossível de gerar no space atual.
                  if (isQuotaError(lastErr) || isSpaceMismatchError(lastErr)) break;
                  if (attempt < 3) console.warn(`[VA-texto ${label}] t${attempt} falhou (${lastErr}) — re-dispara`);
                }
              }
              if (!partBytes) throw new Error(`${label} falhou após 3 tentativas: ${lastErr}`);
              // SALVA no cache → próximo RETOMAR pula o HeyGen pra esta parte.
              try {
                const { saveBlob } = await import('@/lib/zip-store');
                await saveBlob(partCacheKey, new Blob([partBytes as BlobPart], { type: 'video/mp4' }), 'video/mp4');
              } catch { /* best-effort */ }
            }
            partBlobs.push(new Blob([partBytes as BlobPart], { type: 'video/mp4' }));
          }
        } catch (e) {
          if ((e as Error)?.message === 'cancelado') throw e;
          avError = (e as Error)?.message || 'falha';
        }
        // FASE 1: só ACUMULA — a montagem acontece na FASE 2 (abaixo), depois de
        // TODOS os avatares terem sido gerados/recuperados.
        pendingMontagem.push({ avaCode: av.avaCode, filename, partBlobs, avError });
      }

      // ═══ FASE 2 — MONTA cada avatar (só agora, com tudo já gerado/recuperado) ═══
      for (const { avaCode, filename, partBlobs, avError } of pendingMontagem) {
        if (batchCancelRef.current[taskId]) throw new Error('cancelado');
        if (avError || partBlobs.length === 0) {
          items.push({ avaCode, filename, blob: null, error: avError || 'sem partes geradas' });
          continue;
        }
        // Concatena as partes (HOOK+BODY...) → 1 video por AVA. RETRY+RESET: o
        // concat (ffmpeg-wasm) trava de forma intermitente — antes a task ficava
        // presa em "montando vídeo final" pra sempre (user reportou 2026-06-23).
        // Agora 3 tentativas matando o worker entre elas (instância limpa).
        patchVA({ phase: 'post', message: `${avaCode}: montando vídeo final...` });
        try {
          let mounted: Blob | null = null;
          if (partBlobs.length === 1) {
            mounted = partBlobs[0];
          } else {
            // SERIAL: o concat (+ os cancelFFmpeg entre tentativas) roda dentro de
            // UM slot da fila de ffmpeg → nenhuma outra task toca a instância
            // enquanto isso, então NADA termina o nosso concat no meio (era o que
            // dava "called FFmpeg.terminate()" e perdia o avatar). 1 op por vez.
            mounted = await runFfmpegSerial(async () => {
              _ffmpegOwnerTaskId = taskId; // rank 5: dona atual do singleton
              try {
                // FRESH START (fix 2026-07-04): instância LIMPA antes de montar
                // ESTE avatar — o anterior (ex AVA01 132MB) deixa a instância
                // pesada e o AVA02 herdava o estado → travava. cancelFFmpeg zera
                // e o getFFmpeg reinicializa fresco na 1ª chamada. Dentro do slot
                // serial → não atropela ffmpeg de outra task.
                try { cancelFFmpeg(); } catch { /* ignora */ }
                let m: Blob | null = null;
                let lastErr: unknown = null;
                for (let attempt = 1; attempt <= 3 && !m; attempt++) {
                  try {
                    m = await Promise.race([
                      mountAvatarParts(partBlobs),
                      new Promise<Blob>((_, rej) => setTimeout(() => rej(new Error('concat timeout 600s')), 600_000)),
                    ]);
                  } catch (e) {
                    lastErr = e;
                    try { cancelFFmpeg(); } catch { /* ignora */ }
                    if (attempt < 3) console.warn(`[VA-texto ${avaCode}] montagem t${attempt} falhou (${(e as Error)?.message?.slice(0, 70)}) — reset+retry`);
                  }
                }
                if (!m) throw lastErr instanceof Error ? lastErr : new Error('concat esgotou 3 tentativas');
                return m;
              } finally {
                if (_ffmpegOwnerTaskId === taskId) _ffmpegOwnerTaskId = null;
              }
            });
          }
          items.push({ avaCode, filename, blob: mounted });
        } catch (e) {
          items.push({ avaCode, filename, blob: null, error: 'mount: ' + ((e as Error)?.message || '?') });
        }
      }

      // ZIP final — mesma estrutura do VA lipsync (download unico do card).
      patchVA({ phase: 'post', message: 'Zipando vídeos finais...' });
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const item of items) {
        if (item.blob) zip.file(item.filename, item.blob);
        else zip.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`, item.error || 'falha sem detalhes');
      }
      const okCount = items.filter((i) => i.blob).length;
      // COTA: se alguma falha foi limite diário do HeyGen, sinaliza CLARO no card
      // (não é bug nem "retomar resolve" — é a conta no teto diário).
      const hitQuota = items.some((i) => !i.blob && isQuotaError(i.error || ''));
      // WORKSPACE: avatar que falhou é de outro space → Retomar NÃO resolve
      // sozinho (precisa trocar o workspace ativo / juntar os avatares).
      const hitSpaceMismatch = items.some((i) => !i.blob && isSpaceMismatchError(i.error || ''));
      zip.file('_DIAGNOSTICO.txt',
`Pipeline VA (motor TEXTO — canal ${channelLabels.join('/') || 'organico'}) - relatorio
============================================================
AVAs: ${items.length} · OK: ${okCount} · Falhas: ${items.length - okCount}
Partes por AVA (geradas por texto): ${partPlan.map((p) => p.label).join(', ')}

Items:
${items.map((i) => `- ${i.filename}: ${i.blob ? 'OK' : 'ERRO (' + (i.error || 'sem detalhes') + ')'}`).join('\n')}
`);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const zipName = `${adNameClean}_VA.zip`;
      const zipUrl = URL.createObjectURL(zipBlob);
      await persistDeliverableOrRescue(`va:${taskId}:zip`, zipBlob, zipName);

      const failedAvas = items.filter((i) => !i.blob).map((i) => i.avaCode);
      const partial = okCount < items.length;
      patchVA({
        phase: 'done',
        message: okCount === 0 && hitQuota
          ? `⚠ HeyGen no LIMITE DIÁRIO de geração — aguarde o reset (~24h) ou troque de conta. NÃO é bug; re-disparar agora vai falhar igual.`
          : partial
            ? `⚠ INCOMPLETO: ${okCount}/${items.length} avatares — falta ${failedAvas.join('/')}.${
                hitSpaceMismatch
                  ? ` ${failedAvas.join('/')} é de OUTRO workspace do HeyGen — deixe ATIVO o workspace dele (ou junte os avatares no mesmo space), Recarregue a biblioteca e Retomar. (Retomar sem trocar vai falhar igual.)`
                  : hitQuota
                    ? ' Bateu no LIMITE DIÁRIO do HeyGen (espere o reset).'
                    : ' Clica RETOMAR pra gerar o que faltou.'
              }`
            : `Pronto (texto): ${okCount}/${items.length} AVA${items.length === 1 ? '' : 's'}`,
        // BLINDAGEM: o card lê isto pra NÃO mostrar verde quando faltou avatar.
        vaStats: { okAvas: okCount, expectedAvas: items.length, failedAvas },
        montadoZipUrl: zipUrl, montadoZipName: zipName,
        finishedAt: Date.now(),
      });
      const siblings = getSiblingTaskIds(taskId);
      for (const sid of siblings) markDispatched(sid);
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId, engine: 'texto', channels: channelLabels,
          avatares: items.map((it, i) => ({ avaCode: it.avaCode, username: va.avatares[i]?.username || '?', status: it.blob ? 'done' : 'failed' })),
          startedAt: vaStartedAt, finishedAt: Date.now(), zipName,
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    } catch (e) {
      if ((e as Error)?.message === 'cancelado') {
        patchVA({ phase: 'failed', message: 'Cancelado.', finishedAt: Date.now() });
        return;
      }
      // CHUNK: deploy novo invalidou os chunks da página aberta → recarrega pra
      // pegar a versão nova (takes salvos; Retomar reaproveita). Ver [[chunk-guard]].
      if (isChunkLoadError(e)) {
        patchVA({ phase: 'failed', message: '⚠ Saiu uma versão nova do app durante o processamento — recarregando pra atualizar. Seus takes estão salvos; depois clique Retomar.', finishedAt: Date.now() });
        reloadOnceForChunk();
        return;
      }
      patchVA({ phase: 'failed', message: (e as Error)?.message || String(e), finishedAt: Date.now() });
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId, engine: 'texto',
          avatares: va.avatares.map((av: any) => ({ avaCode: av.avaCode, username: av.username, status: 'failed' })),
          startedAt: vaStartedAt, finishedAt: Date.now(),
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    }
  }

  // ═══════════════════ TROCA DE ÁUDIO (variacao do WHITE) ═══════════════════
  // Baixa o criativo original do Drive → descamufla (tira o WHITE antigo via
  // L-R) → recamufla o mesmo BLACK com o novo WHITE upado → muxa no video.
  // Roda na MESMA fila (batchStates + BatchJobCard3D) das outras tasks, com o
  // mesmo botao de download no fim. Sem HeyGen.
  async function runTrocaAudioPipelineForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    const troca = a?.trocaBriefing;
    const taskName = a?.taskName || batchStates[taskId]?.taskName || taskId;
    const baseAdId = troca?.baseAdId || a?.baseAdId || batchStates[taskId]?.baseAdId || taskName;
    const adNameClean = baseAdId.replace(/[^A-Z0-9]/gi, '_');

    const fail = (message: string) => {
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, parts: [], startedAt: Date.now() }),
          kind: 'troca',
          phase: 'failed',
          message,
          finishedAt: Date.now(),
        } as BatchTaskState,
      }));
    };

    // Resolve Drive ID: briefing parseado > input manual > estado persistido
    // (sobrevive reload, pois batchState e serializado). Se nao houver link de
    // ARQUIVO, mas houver link de PASTA, resolvemos o video listando a pasta.
    const persisted = batchStates[taskId];
    let driveId =
      troca?.driveId || extractDriveFileId(trocaAdUrl[taskId] || '') || persisted?.trocaDriveId || null;
    // Link de PASTA colado manualmente (ou persistido): resolvido no disparo.
    const folderId = extractDriveFolderId(trocaAdUrl[taskId] || '') || persisted?.trocaFolderId || null;
    // Pasta de OUTPUT (LINK PASTA DRIVE) — pro botao "abrir pasta" do card.
    const outputFolderUrl = troca?.driveFolderUrl || persisted?.trocaOutputFolderUrl || undefined;
    const volume = Math.max(5, Math.min(100, trocaVolume[taskId] ?? persisted?.trocaVolume ?? 30));

    // Resolve o novo WHITE: estado em memoria OU IndexedDB (retomar pos-reload).
    let white: Blob | null = trocaWhite[taskId] || null;
    const whiteMime = (white as File | null)?.type || persisted?.trocaWhiteMime || 'audio/wav';
    if (!white) {
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        white = await loadBlob('troca:white:' + taskId, whiteMime);
      } catch {}
    }

    if (!driveId && !folderId) {
      fail('Sem link do criativo. O link fica no COMENTÁRIO da task — ou cola a URL do vídeo (ou da pasta) no painel.');
      return;
    }
    if (!white) {
      fail('Suba o novo áudio WHITE dessa task antes de disparar.');
      return;
    }

    // Persiste o WHITE + dados serializaveis pra RETOMAR sobreviver reload.
    try {
      const { saveBlob } = await import('@/lib/zip-store');
      await saveBlob('troca:white:' + taskId, white, whiteMime);
    } catch (e) {
      console.warn('[troca-audio] persist white IDB:', e);
    }

    batchCancelRef.current[taskId] = false;
    const startedAt = Date.now();
    const renamedTo = `${adNameClean}_TROCA.mp4`;
    const setStage = (phase: BatchTaskState['phase'], message: string, done = false) => {
      // GUARD anti-cancel: depois que o user Pausa (batchCancelRef=true + phase→'failed'),
      // o onProgress do download e os estágios da troca NÃO podem reescrever a fase de
      // volta pra 'downloading'/'post' — era isso que "des-pausava" e re-desabilitava o
      // Retomar durante o download. batchCancelRef é a fonte de verdade do cancel.
      if (batchCancelRef.current[taskId]) return;
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, startedAt }),
          kind: 'troca',
          taskName,
          baseAdId,
          phase,
          message,
          parts: [{
            label: 'Troca de áudio',
            videoId: 'troca',
            videoStatus: done ? 'completed' : 'processing',
            renamedTo,
          }],
          startedAt: prev[taskId]?.startedAt || startedAt,
          taskUrl: prev[taskId]?.taskUrl || a?.taskUrl,
          trocaDriveId: driveId || undefined,
          trocaFolderId: folderId || undefined,
          trocaOutputFolderUrl: outputFolderUrl,
          trocaVolume: volume,
          trocaWhiteMime: whiteMime,
        } as BatchTaskState,
      }));
    };

    // GUARD DE REENTRÂNCIA: se ESTA troca já está rodando (ex: o loop serial disparou
    // E o user clicou Retomar/Debug no card 'queued' — liberado pelo queuedRecoverable),
    // ignora o disparo extra. Sem isto, rodavam 2 pipelines do MESMO taskId em paralelo
    // (2x download do Drive + colisão no _ffmpegOwnerTaskId + Object URL órfão). Setado
    // aqui (após a validação barata de driveId/WHITE) e limpo no finally do try abaixo.
    if (runningTrocaRef.current[taskId]) {
      console.warn('[troca] já rodando, ignora disparo extra:', taskId);
      return;
    }
    runningTrocaRef.current[taskId] = true;

    setStage('downloading', driveId ? 'Baixando o criativo original do Drive...' : 'Procurando o vídeo na pasta do Drive...');

    try {
      // 0. Link de PASTA colado: lista (recursivo) e escolhe o video. Entra nas
      // subpastas preferindo "COM EDIÇÃO/FINAL", pula "ÁUDIO TROCADO/COMPLIANCE",
      // casa pelo nome do AD. (Requer a extensao v4.16.0+.)
      if (!driveId && folderId) {
        const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
        const adKey = baseAdId.toUpperCase();
        const isVideo = (n: string) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(n) || /\bAD\d/i.test(n);
        let listCalls = 0;
        const findVideo = async (
          fid: string,
          depth: number,
        ): Promise<{ fileId: string; name: string } | null> => {
          if (listCalls >= 12 || batchCancelRef.current[taskId]) return null;
          listCalls++;
          const lf = await listDriveFolderViaExtension(fid);
          if (!lf.ok) return null;
          const vids = lf.files.filter((f) => !f.isFolder && isVideo(f.name));
          const byName = vids.find((f) => f.name.toUpperCase().includes(adKey));
          if (byName) return byName;
          if (vids[0]) return vids[0];
          if (depth <= 0) return null;
          const score = (n: string) => {
            const u = n.toUpperCase();
            if (/TROCAD|COMPLI|OUTPUT|SA[IÍ]DA|RAW|BRUTO|ANTIG/.test(u)) return -1;
            if (/EDI[ÇC]|FINAL|PRONTO|COM\s*EDI/.test(u)) return 2;
            return 1;
          };
          const subs = lf.files
            .filter((f) => f.isFolder)
            .map((f) => ({ f, s: score(f.name) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.f);
          for (const sub of subs) {
            const found = await findVideo(sub.fileId, depth - 1);
            if (found) return found;
          }
          return null;
        };
        const pick = await findVideo(folderId, 2);
        if (!pick) throw new Error('Não achei o vídeo na pasta. Abra a pasta, copie o link do VÍDEO (file/d/...) e cole no painel. (Confira que a extensão está na v4.16.0+.)');
        driveId = pick.fileId;
        setStage('downloading', `Vídeo encontrado (${pick.name}). Baixando...`);
      }
      if (!driveId) throw new Error('Não foi possível resolver o vídeo do criativo.');

      // 1. Download do AD original (link do COMENTARIO/manual) via extension.
      const { downloadDriveFileViaExtension } = await import('@/lib/heygen-extension-bridge');
      const dl = await downloadDriveFileViaExtension(driveId, {
        onProgress: (rec, tot) => setStage('downloading', `Baixando o criativo... ${(rec / 1048576).toFixed(1)}MB${tot ? ` / ${(tot / 1048576).toFixed(1)}MB` : ''}`),
      });
      if (!dl.ok) throw new Error('Drive download: ' + dl.error);
      const adBlob = new Blob([dl.bytes as BlobPart], { type: 'video/mp4' });

      // 2+3+4. TUDO que toca o ffmpeg-wasm singleton (descamufla + recamufla + mux +
      // verify) roda dentro do MESMO lock serial (runFfmpegSerial) da montagem normal.
      // Sem isto, uma troca concorrente com uma montagem 'post' colidia no singleton
      // (o cancelFFmpeg de retry de uma matava o exec da outra: "FFmpeg.terminate()" —
      // o bug histórico que o ffmpeg-serial existe pra eliminar). O keep-alive segura a
      // aba viva no processamento pesado (anti-freeze em segundo plano). O owner marca
      // esta task como dona atual do singleton (o Pausar não mata o exec de OUTRA task).
      setStage('post', 'Tirando o áudio WHITE antigo...');
      const { descamuflar, camuflar, verifyCamouflage } = await import('@/lib/camuflagem');
      const { muxAudioIntoVideo } = await import('@/lib/ffmpeg-worker');
      const { acquireKeepAlive, releaseKeepAlive } = await import('@/lib/tab-keepalive');

      let finalBlob: Blob | null = null;
      let platformOk = false;
      let platformWhite: number | undefined;
      let platformBlack: number | undefined;
      acquireKeepAlive();
      try {
        const res = await runFfmpegSerial(async () => {
          _ffmpegOwnerTaskId = taskId;
          try {
            // Descamufla: recupera o BLACK (audio publico) tirando o WHITE antigo.
            const { wav: blackWav } = await descamuflar({ file: adBlob, layer: 'public' });
            // GARANTIA: recamufla com o novo WHITE, muxa e VERIFICA sobre o MP4 REAL
            // que os downmixes de plataforma (soma/média L+R) escutam o NOVO white; se
            // o AAC degradar a fase, sobe o ganho e re-tenta até passar ou bater o teto.
            let blob: Blob | null = null;
            let ok = false;
            let whiteScore: number | undefined;
            let blackScore: number | undefined;
            let gainBoost = 1;
            const MAX_ATTEMPTS = 3;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
              if (batchCancelRef.current[taskId]) throw new Error('Cancelado pelo usuario.');
              setStage('post', attempt === 1 ? 'Embutindo o novo áudio WHITE...' : `Reforçando o WHITE (tentativa ${attempt}/${MAX_ATTEMPTS})...`);
              const camWav = await camuflar({ black: blackWav, white, volumePercent: volume, gainBoost });
              setStage('post', 'Montando o vídeo final...');
              const muxed = await muxAudioIntoVideo(adBlob, camWav, { onStage: (s) => setStage('post', s) }, true);
              blob = muxed;
              setStage('post', 'Verificando o que a IA escuta...');
              try {
                const v = await verifyCamouflage({ result: muxed, white, black: blackWav });
                const rel = v.downmixes.filter((d) => d.kind === 'sum' || d.kind === 'avg');
                ok = rel.length > 0 && rel.every((d) => d.hears === 'white');
                whiteScore = rel.length ? Math.min(...rel.map((d) => d.whiteScore)) : undefined;
                blackScore = rel.length ? Math.max(...rel.map((d) => d.blackScore)) : undefined;
              } catch {
                ok = true; // verify falhou tecnicamente — não bloqueia a entrega
              }
              if (ok) break;
              gainBoost *= 1.8;
            }
            return { blob, ok, whiteScore, blackScore };
          } finally {
            if (_ffmpegOwnerTaskId === taskId) _ffmpegOwnerTaskId = null;
          }
        });
        finalBlob = res.blob;
        platformOk = res.ok;
        platformWhite = res.whiteScore;
        platformBlack = res.blackScore;
      } finally {
        releaseKeepAlive();
      }
      if (!finalBlob) throw new Error('Falha ao montar o vídeo final.');
      const sizeMb = (finalBlob.size / (1024 * 1024)).toFixed(1);

      const url = URL.createObjectURL(finalBlob);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, startedAt }),
          kind: 'troca',
          taskName,
          baseAdId,
          phase: 'done',
          message: platformOk
            ? `✓ Garantido: TikTok/Kwai/YouTube escutam o novo WHITE (${sizeMb}MB).`
            : `⚠ Áudio trocado (${sizeMb}MB), mas a verificação não confirmou o WHITE na soma mono — aumente a intensidade e refaça.`,
          parts: [{ label: 'Troca de áudio', videoId: 'troca', videoStatus: 'completed', renamedTo }],
          startedAt: prev[taskId]?.startedAt || startedAt,
          finishedAt: Date.now(),
          camufladoZipUrl: url,
          camufladoZipName: renamedTo,
          taskUrl: prev[taskId]?.taskUrl || a?.taskUrl,
          trocaDriveId: driveId || undefined,
          trocaFolderId: folderId || undefined,
          trocaOutputFolderUrl: outputFolderUrl,
          trocaVolume: volume,
          trocaWhiteMime: whiteMime,
          trocaWhiteScore: platformWhite,
          trocaBlackScore: platformBlack,
          // Satisfaz o allOk do card (mostra "Pronto" + botao Baixar unico).
          pipeStats: {
            expectedMontagens: 1,
            okMontagens: 1,
            okDecupados: 0,
            okCamuflados: 1,
            expectedDecupagem: false,
            expectedCamuflagem: true,
          },
        } as BatchTaskState,
      }));
      markDispatched(taskId);
    } catch (e) {
      console.error('[troca-audio]', e);
      fail((e as Error)?.message || String(e));
    } finally {
      runningTrocaRef.current[taskId] = false; // libera a reentrância (sucesso, erro ou cancel)
    }
  }

  /** PROVA da troca: transcreve o que TikTok/Kwai/YouTube escutariam (soma
   *  mono L+R do MP4 real) via AssemblyAI. Tem que vir o roteiro do NOVO
   *  WHITE — prova empirica de que a troca segurou. */
  async function transcribeTrocaResult(taskId: string, blobUrl: string) {
    if (!blobUrl || trocaProof[taskId]?.loading) return;
    setTrocaProof((prev) => ({ ...prev, [taskId]: { loading: true } }));
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      const { buildPlatformMonoWav } = await import('@/lib/camuflagem');
      const { wav } = await buildPlatformMonoWav(blob);
      const fd = new FormData();
      fd.append('audio', wav, 'platform-mono.wav');
      fd.append('languageCode', 'pt');
      const r = await fetch('/api/camuflagem/transcribe', { method: 'POST', body: fd });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error((data && data.error) || `Falha na transcricao (HTTP ${r.status}).`);
      setTrocaProof((prev) => ({ ...prev, [taskId]: { text: (data.text as string) || '(silêncio / nada reconhecido)' } }));
    } catch (e) {
      setTrocaProof((prev) => ({ ...prev, [taskId]: { err: (e as Error)?.message || 'Falha na transcricao.' } }));
    }
  }

  /** Dispara clone de voz pro slot. Aceita audio (mp3/wav) ou video.
   *  No ready: seta voiceOverride no slot e adiciona voz na library cache. */
  async function handleCloneVoiceForSlot(
    taskId: string,
    sIdx: number,
    file: File,
    opts?: {
      model?: 'V3' | 'V2' | 'multilingual';
      language?: 'pt' | 'en' | 'es' | 'auto';
      trimToSeconds?: number;
      removeBackgroundNoise?: boolean;
      removeBackgroundMusic?: boolean;
    },
  ) {
    const key = `${taskId}:${sIdx}`;
    setCloningVoice((prev) => ({ ...prev, [key]: { stage: 'starting', percent: 0, message: 'Iniciando...' } }));
    // Retry ate 2x em falhas transientes (rede, timeout)
    const MAX_ATTEMPTS = 2;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await cloneVoiceViaExtension(file, {
          removeBackgroundNoise: opts?.removeBackgroundNoise ?? true,
          removeBackgroundMusic: opts?.removeBackgroundMusic ?? true,
          model: opts?.model ?? 'V3',
          language: opts?.language && opts.language !== 'auto' ? opts.language : null,
          trimToSeconds: opts?.trimToSeconds ?? 90,
          onProgress: (stage, percent, message) => {
            setCloningVoice((prev) => ({
              ...prev,
              [key]: {
                stage,
                percent: percent ?? prev[key]?.percent ?? 0,
                message: (attempt > 1 ? `(tentativa ${attempt}) ` : '') + (message || ''),
              },
            }));
          },
        });
        if (!res.ok) {
          lastError = res.error;
          // Falhas que valem retry: rede, timeout, HTTP 5xx
          if (attempt < MAX_ATTEMPTS && /timeout|network|HTTP 5|fetch|nao respondeu/i.test(res.error)) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          setError(`Falha ao clonar voz: ${res.error}`);
          setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
          return;
        }
        // SUCESSO — auto-select da voz no slot
        updateRoleSlot(taskId, sIdx, { voiceOverride: { id: res.voiceId, name: res.voiceName } });
        // Recarrega biblioteca pra voz nova aparecer no picker
        reloadLibrary().catch(() => {});
        setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
        return;
      } catch (e) {
        lastError = (e as Error)?.message || String(e);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
    }
    setError(`Falha ao clonar voz apos ${MAX_ATTEMPTS} tentativas: ${lastError}`);
    setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
  }

  return (
    <>
      <ToolShell
        title="ClickUp Pilot"
        eyebrow="AUTOMAÇÃO · ORQUESTRADOR"
        description="O cérebro do estúdio. Conecta no ClickUp, lê cada task e dispara avatares, B-rolls, decupagem e camuflagem — tudo em fila, sem você abrir uma aba sequer."
        hue="rgba(200,232,124,0.45)"
        icon={<IconClickUpPilot size={56} />}
      >
          {/* Command Center — chip de status + métricas ao vivo */}
          {(() => {
            const setupOK = hasToken && selectedTeam && selectedEditor;
            const editorName = editors.find(u => String(u.id) === selectedEditor)?.username || authUser?.username || '?';
            return (
              <div
                className="cp-command-center mb-5 relative overflow-hidden rounded-[18px] border p-4 md:p-5"
                style={{
                  borderColor: setupOK ? 'rgba(200,232,124,0.35)' : 'rgba(232,121,249,0.35)',
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-50 blur-3xl"
                  style={{
                    background: setupOK ? 'rgba(200,232,124,0.45)' : 'rgba(232,121,249,0.45)',
                  }}
                />
                <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={
                        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border ' +
                        (setupOK ? 'border-lime/60 bg-lime/10' : 'border-fuchsia-500/60 bg-fuchsia-500/10')
                      }
                      style={{
                        boxShadow: setupOK
                          ? '0 0 22px -6px rgba(200,232,124,0.55), inset 0 1px 0 rgba(255,255,255,0.1)'
                          : '0 0 22px -6px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.1)',
                      }}
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span
                          className={
                            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ' +
                            (setupOK ? 'bg-lime' : 'bg-fuchsia-400')
                          }
                        />
                        <span
                          className={
                            'relative inline-flex h-2.5 w-2.5 rounded-full ' +
                            (setupOK ? 'bg-lime' : 'bg-fuchsia-400')
                          }
                          style={{
                            boxShadow: setupOK
                              ? '0 0 10px rgba(200,232,124,0.9)'
                              : '0 0 10px rgba(232,121,249,0.9)',
                          }}
                        />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div
                        className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-text-muted"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        {setupOK ? 'Pilot Online' : 'Pilot Offline'}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[16px] font-bold tracking-tight text-white"
                        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
                      >
                        {setupOK ? (currentTeam?.name || '—') : 'Configure pra começar'}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">
                        {setupOK ? (
                          <>
                            Editor:{' '}
                            <span className="mono text-white">{editorName}</span>
                            {tasks.length > 0 ? (
                              <>
                                {' · '}
                                <span className="mono text-lime">{tasks.length}</span> tasks
                                {selectedTaskIds.size > 0 ? (
                                  <>
                                    {' · '}
                                    <span className="mono text-lime">{selectedTaskIds.size}</span> sel
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>{!hasToken ? 'Cole o token ClickUp pra autenticar' : 'Falta workspace ou editor'}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href="/configuracoes/clickup-pilot"
                      className={
                        'group inline-flex items-center gap-2 rounded-[12px] border px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition-all ' +
                        (setupOK
                          ? 'border-line-strong text-text-muted hover:border-lime hover:text-lime'
                          : 'border-fuchsia-500/65 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25')
                      }
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {setupOK ? 'Configurar' : 'Configurar agora'}
                      <span className="transition-transform group-hover:translate-x-1">→</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* (Token UI movido pra /configuracoes/clickup-pilot) */}

          {error ? (
            <div className="mb-4 error-shake flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              <span className="flex-1">{error}</span>
              {errorAction ? (
                <a
                  href={errorAction.href}
                  className="label-tech shrink-0 rounded border border-lime/60 bg-lime/15 px-3 py-1 text-[10px] tracking-widest text-lime hover:bg-lime/25"
                >
                  {errorAction.label} →
                </a>
              ) : null}
              <button
                type="button"
                onClick={clearError}
                className="mono shrink-0 rounded border border-line-strong px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60"
                aria-label="Fechar erro"
              >
                ✕
              </button>
            </div>
          ) : null}

          {hasToken && selectedTeam && selectedEditor ? (
            <div className="grid gap-6">
              {/* Modos + Carregar tasks (UI principal enxuta) */}
              <section
                className="cp-modes-bar relative overflow-hidden rounded-[18px] border border-line/60 p-4 md:p-5"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-35 blur-3xl"
                  style={{ background: 'rgba(167,139,250,0.45)' }}
                />
                {/* PAINEL "Modos de Geração" REMOVIDO (user pediu):
                 *  - Camuflagem agora eh PER-TASK (botao 3D na action bar do card)
                 *  - Only Magnific / More Magnific descontinuados (auto-broll
                 *    tem ferramenta propria + botao JSON inline em cada task)
                 *  Estados onlyMagnificMode/moreMagnificMode permanecem em
                 *  useToolState (sempre false agora) por compat com handlers
                 *  que checavam — sem UI exposta. */}
                {/* Seletor de EMPRESA — só aparece quando o token enxerga
                 *  mais de um workspace. Trocar aqui recarrega as tasks da
                 *  outra empresa na hora. */}
                {teams.length > 1 ? (
                  <div className="relative mb-3.5 flex flex-wrap items-center gap-3">
                    <WorkspaceSwitch3D
                      options={sortWorkspacesForSwitch(teams).map((t) => ({
                        id: t.id,
                        label: shortWorkspaceLabel(t.name),
                        fullName: t.name,
                        accent: workspaceAccent(t.name),
                      }))}
                      value={selectedTeam}
                      onChange={(id) => void switchWorkspace(id)}
                      busy={switchingTeam}
                      disabled={loadingTasks && !switchingTeam}
                    />
                    {switchingTeam ? (
                      <span className="mono text-[10px] uppercase tracking-widest text-violet-300">
                        trocando…
                      </span>
                    ) : null}
                    {/* IDIOMA — só pra empresa com copy bilíngue (DR MILLION).
                     *  Trocar re-analisa as tasks marcadas, porque a copy sai
                     *  do doc já no idioma escolhido. */}
                    {mostrarSeletorIdioma ? (
                      <>
                        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
                        <LangSwitch3D
                          value={drLang}
                          disabled={analyzing || switchingTeam}
                          disponivel={idiomasDaSelecao}
                          onChange={(v) => {
                            setDrLang(v);
                            // Re-analisa o que estiver marcado pra copy vir no
                            // idioma novo (o texto é extraído do doc no parse).
                            if (selectedTaskIds.size > 0) void analyzeSelected();
                          }}
                        />
                        {analyzing ? (
                          <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                            relendo copy…
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => loadTasks()}
                    disabled={loadingTasks}
                    className="cp-load-cta group relative overflow-hidden rounded-[14px] border border-lime/60 px-5 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-black transition-all disabled:opacity-70"
                    style={{
                      fontFamily: 'var(--font-tech)',
                      background:
                        'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
                      boxShadow:
                        '0 0 28px -6px rgba(200,232,124,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.2)',
                    }}
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      {loadingTasks ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/60 border-t-transparent" />
                          Carregando…
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-9-9" />
                            <path d="M21 3v6h-6" />
                          </svg>
                          Carregar tasks
                          <span className="transition-transform group-hover:translate-x-1">→</span>
                        </>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    />
                  </button>
                  {/* Toggle 3D (olho) — incluir tasks em REVISÃO na listagem.
                   *  Ícone sem texto (pedido do user). Ao alternar, recarrega
                   *  as tasks NA HORA com o valor novo (override explícito —
                   *  setState é assíncrono). */}
                  <ToggleRound3D
                    on={includeReview}
                    onChange={(next) => {
                      setIncludeReview(next);
                      void loadTasks(next);
                    }}
                    icon={<ReviewEyeIcon className="h-full w-full" />}
                    title={includeReview ? 'Lendo tasks em REVISÃO também — clique pra voltar ao filtro normal' : 'Incluir tasks em REVISÃO na listagem'}
                    variant="cyan"
                    size="md"
                    disabled={loadingTasks}
                  />
                  <a
                    href="/configuracoes/clickup-pilot"
                    className="mono inline-flex items-center gap-2 rounded-full border border-line-strong px-3.5 py-1.5 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime"
                  >
                    Configurar workspace, editor e filtros
                    <span>→</span>
                  </a>
                </div>
              </section>

              {/* Lista de tasks */}
              {tasks.length > 0 ? (
                <section>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2
                        className="text-[20px] font-extrabold tracking-tight text-white"
                        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
                      >
                        Tasks
                      </h2>
                      <span
                        className="mono rounded-full border border-lime/45 bg-lime/10 px-2.5 py-0.5 text-[11px] font-bold text-lime"
                        style={{ boxShadow: '0 0 12px -4px rgba(200,232,124,0.45)' }}
                      >
                        {tasks.length}
                      </span>
                    </div>
                    {/* Modo BATCH removido — click 1x na task analisa direto.
                     *  Estado bulkMode mantido por compat com handlers existentes
                     *  mas UI nao expoe mais o toggle. */}
                  </div>
                  {/* Filtros premium — Período + Prioridade + Data específica */}
                  <div
                    className="cp-filters-bar mb-4 relative overflow-hidden rounded-[16px] border border-line/60 p-4"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                    }}
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full opacity-40 blur-3xl"
                      style={{ background: 'rgba(200,232,124,0.35)' }}
                    />
                    <div className="relative">
                      <div className="mb-3 flex items-center gap-2">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Período
                        </span>
                        <span className="h-px flex-1 bg-gradient-to-r from-lime/30 via-line to-transparent" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { id: 'all' as const, label: 'Todas' },
                          { id: 'yesterday' as const, label: 'Ontem' },
                          { id: 'today' as const, label: 'Hoje' },
                          { id: 'tomorrow' as const, label: 'Amanhã' },
                          { id: 'overdue' as const, label: 'Atrasadas' },
                          { id: 'next7' as const, label: 'Próximos 7 dias' },
                          { id: 'specific' as const, label: 'Data específica' },
                        ]).map((f) => {
                          const active = dateFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setDateFilter(f.id)}
                              className={
                                'group relative overflow-hidden rounded-[12px] border px-4 py-2.5 transition-all duration-200 ' +
                                (active
                                  ? 'border-lime/65 bg-lime/12'
                                  : 'border-line-strong bg-bg/40 hover:border-lime/45 hover:-translate-y-[1px]')
                              }
                              style={
                                active
                                  ? { boxShadow: '0 0 22px -6px rgba(200,232,124,0.55)' }
                                  : undefined
                              }
                            >
                              <span
                                className="text-[12px] font-bold tracking-tight text-white"
                                style={{ fontFamily: 'var(--font-tech)' }}
                              >
                                {f.label}
                              </span>
                              {active ? (
                                <span
                                  aria-hidden
                                  className="absolute right-2 top-2 inline-block h-1.5 w-1.5 rounded-full bg-lime"
                                  style={{ boxShadow: '0 0 8px rgba(200,232,124,0.9)' }}
                                />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>

                      {/* Date picker — aparece só se 'specific' selecionado */}
                      {dateFilter === 'specific' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-lime/40 bg-lime/5 px-3 py-2.5">
                          <span
                            className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-lime"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            Escolher data
                          </span>
                          <input
                            type="date"
                            value={specificDate}
                            onChange={(e) => setSpecificDate(e.target.value)}
                            className="rounded-[8px] border border-lime/40 bg-black/40 px-3 py-1.5 text-[12px] text-white mono outline-none focus:border-lime/70"
                            style={{ colorScheme: 'dark' }}
                          />
                          {specificDate ? (
                            <button
                              type="button"
                              onClick={() => setSpecificDate('')}
                              className="mono rounded-full border border-line-strong px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                            >
                              ✕ limpar
                            </button>
                          ) : (
                            <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                              ↑ escolha pra filtrar
                            </span>
                          )}
                          <div className="ml-auto flex flex-wrap gap-1.5">
                            {(() => {
                              const fmt = (d: Date) => d.toISOString().slice(0, 10);
                              const today = new Date();
                              const presets = [-2, -3, -7, -14].map((delta) => {
                                const d = new Date(today);
                                d.setDate(today.getDate() + delta);
                                return { date: fmt(d), label: `${Math.abs(delta)}d atrás` };
                              });
                              return presets.map((p) => (
                                <button
                                  key={p.date}
                                  type="button"
                                  onClick={() => setSpecificDate(p.date)}
                                  className={
                                    'mono rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest transition ' +
                                    (specificDate === p.date
                                      ? 'border-lime bg-lime/15 text-lime'
                                      : 'border-line-strong text-text-muted hover:border-lime hover:text-lime')
                                  }
                                >
                                  {p.label}
                                </button>
                              ));
                            })()}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 mb-3 flex items-center gap-2">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-fuchsia-300"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Prioridade
                        </span>
                        <span className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 via-line to-transparent" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { id: 'all' as const, label: 'Todas', dot: 'rgba(148,163,184,0.7)' },
                          { id: 'urgent' as const, label: 'Urgente', dot: '#ef4444' },
                          { id: 'high' as const, label: 'Alta', dot: '#f97316' },
                        ]).map((f) => {
                          const active = priorityFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setPriorityFilter(f.id)}
                              className={
                                'group flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-all ' +
                                (active
                                  ? 'border-fuchsia-500/65 bg-fuchsia-500/15 text-fuchsia-100'
                                  : 'border-line-strong text-text-muted hover:border-fuchsia-500/45 hover:text-white')
                              }
                              style={
                                active
                                  ? { boxShadow: '0 0 18px -6px rgba(236,72,153,0.55)', fontFamily: 'var(--font-tech)' }
                                  : { fontFamily: 'var(--font-tech)' }
                              }
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  background: f.dot,
                                  boxShadow: active ? `0 0 8px ${f.dot}` : undefined,
                                }}
                              />
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <ul className="grid gap-2">
                    {tasks
                      .filter((t) => {
                        // Aplica filtros client-side
                        if (priorityFilter !== 'all' && t.priority?.priority !== priorityFilter) return false;
                        if (dateFilter !== 'all') {
                          const due = t.due_date ? Number(t.due_date) : 0;
                          if (!due) return dateFilter === 'overdue' ? false : false; // sem due_date nao se enquadra
                          const now = Date.now();
                          const DAY = 24 * 60 * 60 * 1000;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const tomorrow = today.getTime() + DAY;
                          const yesterday = today.getTime() - DAY;
                          if (dateFilter === 'today') {
                            if (due < today.getTime() || due >= tomorrow) return false;
                          } else if (dateFilter === 'tomorrow') {
                            if (due < tomorrow || due >= tomorrow + DAY) return false;
                          } else if (dateFilter === 'yesterday') {
                            if (due < yesterday || due >= today.getTime()) return false;
                          } else if (dateFilter === 'overdue') {
                            if (due >= today.getTime()) return false;
                          } else if (dateFilter === 'next7') {
                            if (due < now || due > now + 7 * DAY) return false;
                          } else if (dateFilter === 'specific') {
                            // Sem data escolhida: não filtra (mostra tudo até user escolher)
                            if (!specificDate) return true;
                            const parsed = new Date(specificDate + 'T00:00:00');
                            if (isNaN(parsed.getTime())) return true;
                            const start = parsed.getTime();
                            const end = start + DAY;
                            if (due < start || due >= end) return false;
                          }
                        }
                        return true;
                      })
                      // ESPELHO DO CLICKUP: ordena por data de vencimento
                      // ascendente (mais atrasada/antiga primeiro), igual o
                      // board do user ("Data de vencimento ↑"). Sort estavel
                      // (V8) preserva a ordem da API nos empates de data.
                      // Tasks sem due_date vao pro fim, como no ClickUp.
                      .sort((a, b) => {
                        const da = a.due_date ? Number(a.due_date) : null;
                        const db = b.due_date ? Number(b.due_date) : null;
                        if (da == null && db == null) return 0;
                        if (da == null) return 1;
                        if (db == null) return -1;
                        return da - db;
                      })
                      .map((t) => {
                      const isChecked = selectedTaskIds.has(t.id);
                      const isOpen = isChecked; // visual highlight = selecionado
                      const baseKey = extractBaseTaskKey(t.name);
                      const siblingsAll = taskSiblingGroups.get(baseKey) || [t];
                      const hasSiblings = siblingsAll.length > 1;
                      const gSuffix = t.name.match(/\s*[-–—]\s*(G\d+)\s*$/i)?.[1] || null;
                      return (
                        <li key={t.id} className="flex items-center gap-2">
                          {/* Tesoura (decupagem) NAO aparece aqui na lista pre-analise —
                              so no painel de analise pra disparo. */}
                          <button
                            type="button"
                            onClick={() => toggleTaskSelected(t.id)}
                            className={
                              'group/task flex-1 rounded-[12px] border bg-gradient-to-br px-3.5 py-2.5 text-left transition-all duration-200 ' +
                              (isChecked
                                ? 'border-lime/75 from-lime/15 via-lime/[0.06] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_22px_-8px_rgba(200,232,124,0.55)]'
                                : 'border-white/8 from-white/[0.04] via-white/[0.015] to-transparent hover:border-lime/45 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_8px_20px_-10px_rgba(200,232,124,0.35)]')
                            }
                          >
                            <div className="flex items-center justify-between gap-3">
                              {/* LADO ESQUERDO: checkmark + nome + pills de meta */}
                              <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
                                {/* CHECKMARK animado — feedback visual de selecao */}
                                <span
                                  className={
                                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ' +
                                    (isChecked
                                      ? 'border-lime bg-lime text-black shadow-[0_0_10px_rgba(200,232,124,0.6)]'
                                      : 'border-white/25 bg-transparent text-transparent group-hover/task:border-lime/60')
                                  }
                                  aria-hidden
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m5 13 4 4L19 7" />
                                  </svg>
                                </span>
                                <span
                                  className="mono text-[13px] font-semibold text-white dark:text-white text-foreground truncate"
                                  style={{ fontFamily: 'var(--font-tech)' }}
                                >
                                  {t.name}
                                </span>
                                {/* === BADGES separados por significado ===
                                    User: "ICONE É APENAS PRA INFORMAR QUE É URGENTE / ICONE AMARELO
                                    É ALTA / ICONE VERMELHO URGENCIA / ISSO É SEPARADO DO NUMERO
                                    QUE INFORMA OS DIAS ATRASADOS".

                                    REGRA SEPARACAO:
                                    - ICONE = prioridade (urgent vermelho / alta amarelo)
                                    - NUMERO = dias (atrasada vermelho / hoje ambar / futuro)
                                    - SIBLINGS = grupo de Gs (violet, ao lado)
                                */}
                                {/* SIBLINGS (Gs do mesmo grupo) */}
                                {hasSiblings && gSuffix ? (
                                  <span
                                    className="inline-flex h-6 items-center gap-1 rounded-md border border-violet-500/55 bg-violet-500/12 px-1.5 text-violet-600 dark:text-violet-300"
                                    title={`Grupo: ${siblingsAll.map(s => s.name.match(/G\d+\s*$/i)?.[0] || '?').filter(Boolean).join(' + ')}`}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                    </svg>
                                    <span className="text-[11.5px] font-bold leading-none tabular-nums">{siblingsAll.length}</span>
                                  </span>
                                ) : null}
                                {/* ICONE PRIORIDADE — bg mais saturado + border + shadow pra
                                 *  saltar em light/dark. Icone 15px (era 13). */}
                                {t.priority?.priority === 'urgent' ? (
                                  <span
                                    title="Prioridade urgente"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-red-500/85 bg-red-500/25 text-red-700 shadow-[0_1px_3px_rgba(239,68,68,0.18)]"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 2.2c-.6 0-1.2.3-1.5.9L1 19.5c-.6 1 .2 2.3 1.4 2.3h19.2c1.2 0 2-1.3 1.4-2.3L13.5 3.1c-.3-.6-.9-.9-1.5-.9z" />
                                      <path d="M11 9h2v6h-2zM11 16.5h2V19h-2z" fill="#fff" />
                                    </svg>
                                  </span>
                                ) : t.priority?.priority === 'high' ? (
                                  <span
                                    title="Prioridade alta"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-amber-500/90 bg-amber-500/28 text-amber-700 shadow-[0_1px_3px_rgba(245,158,11,0.2)]"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 2.2c-.6 0-1.2.3-1.5.9L1 19.5c-.6 1 .2 2.3 1.4 2.3h19.2c1.2 0 2-1.3 1.4-2.3L13.5 3.1c-.3-.6-.9-.9-1.5-.9z" />
                                      <path d="M11 9h2v6h-2zM11 16.5h2V19h-2z" fill="#fff" />
                                    </svg>
                                  </span>
                                ) : null}
                                {/* NUMERO DIAS — separado do icone, com bg colorido por estado */}
                                {(() => {
                                  const due = t.due_date ? Number(t.due_date) : 0;
                                  if (!due) return null;
                                  const now = Date.now();
                                  const DAY = 24 * 60 * 60 * 1000;
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  const tomorrow = today.getTime() + DAY;
                                  const dueDate = new Date(due);

                                  // ATRASADA — sempre mostra, eh critico
                                  if (due < today.getTime()) {
                                    const daysAgo = Math.max(1, Math.floor((today.getTime() - due) / DAY));
                                    return (
                                      <span
                                        title={`Atrasada ${daysAgo} dia${daysAgo === 1 ? '' : 's'}`}
                                        className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-md border border-red-500/85 bg-red-500/25 px-2 text-[13px] font-extrabold tabular-nums text-red-700 shadow-[0_1px_3px_rgba(239,68,68,0.18)]"
                                      >
                                        {daysAgo}
                                      </span>
                                    );
                                  }
                                  // HOJE — sempre mostra, eh critico
                                  if (due < tomorrow) {
                                    return (
                                      <span
                                        title="Vence hoje"
                                        className="inline-flex h-6 items-center justify-center rounded-md border border-amber-500/90 bg-amber-500/28 px-2.5 text-[10.5px] font-extrabold uppercase tracking-wider text-amber-800 shadow-[0_1px_3px_rgba(245,158,11,0.2)]"
                                      >
                                        Hoje
                                      </span>
                                    );
                                  }
                                  // FUTURO — NAO mostra nada (user pediu: so atrasadas/hoje
                                  // entram nas pills. Prioridade urgente/alta sao mostradas
                                  // pelo icone separado, independente do prazo).
                                  return null;
                                })()}
                                {/* CANAL — plataforma de distribuicao (KWAI/META/YT/TIKTOK...).
                                    Chip solido com a cor da opcao do ClickUp (match exato com
                                    o board). Read-only: vem do custom field CANAL da task. */}
                                {resolveChannels(t).map((ch, i) => (
                                  <span
                                    key={`${ch.label}-${i}`}
                                    title={`Canal: ${ch.label}`}
                                    className="inline-flex h-6 items-center rounded-md px-2 text-[10.5px] font-extrabold uppercase leading-none tracking-wider shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
                                    style={{
                                      backgroundColor: ch.color,
                                      color: channelTextColor(ch.color),
                                      border: `1px solid ${ch.color}`,
                                    }}
                                  >
                                    {ch.label}
                                  </span>
                                ))}
                              </div>
                              {/* LADO DIREITO: status pill maior + chevron */}
                              <div className="flex shrink-0 items-center gap-2">
                                <span
                                  className="mono rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                                  style={{
                                    backgroundColor: (t.status?.color || '#888') + '24',
                                    color: t.status?.color || '#888',
                                    border: `1px solid ${(t.status?.color || '#888')}55`,
                                  }}
                                >
                                  {t.status?.status}
                                </span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/30 transition-transform group-hover/task:translate-x-0.5 group-hover/task:text-lime">
                                  <path d="m9 18 6-6-6-6" />
                                </svg>
                              </div>
                            </div>
                            {/* SUBTITLE REMOVIDO pelo user (folder/list info era ruido). */}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Bottom action bar — aparece quando ha pelo menos 1 selecionada.
                   *  START = analyzeSelected (puxa doc, parseia copy, prepara
                   *  dispatch view com avatares). User trabalha em batch sempre. */}
                  {selectedTaskIds.size > 0 ? (
                    <div
                      className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-lime/55 bg-gradient-to-br from-lime/15 via-lime/[0.06] to-transparent p-3.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_42px_-12px_rgba(200,232,124,0.45)]"
                    >
                      <span
                        className="mono inline-flex items-center gap-2 text-[12px] font-bold tracking-tight text-foreground"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-lime text-black shadow-[0_0_12px_rgba(200,232,124,0.7)]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        </span>
                        {selectedTaskIds.size} task{selectedTaskIds.size === 1 ? '' : 's'} selecionada{selectedTaskIds.size === 1 ? '' : 's'}
                        {(() => {
                          const ready = Array.from(selectedTaskIds).filter(isTaskDispatchable).length;
                          return ready > 0 ? (
                            <span className="mono ml-1 rounded-full bg-lime/25 px-2 py-[2px] text-[10px] text-lime border border-lime/45">
                              {ready} pronta{ready === 1 ? '' : 's'}
                            </span>
                          ) : null;
                        })()}
                      </span>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={clearSelected}
                          className="mono rounded-full border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-red-500/60 hover:text-red-300"
                        >
                          Limpar
                        </button>
                        <button
                          type="button"
                          onClick={analyzeSelected}
                          disabled={analyzing}
                          className="mono group relative inline-flex items-center gap-2 rounded-full border border-lime bg-lime px-5 py-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-black shadow-[0_6px_22px_-4px_rgba(200,232,124,0.65),inset_0_1px_0_rgba(255,255,255,0.4)] transition-all hover:scale-[1.03] hover:shadow-[0_10px_30px_-4px_rgba(200,232,124,0.85),inset_0_1px_0_rgba(255,255,255,0.55)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          {analyzing ? (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                              </svg>
                              Analisando…
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              Start ({selectedTaskIds.size})
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Painel batch — tasks rodando ou completas */}
                  {Object.keys(batchStatesDaEmpresa).length > 0 ? (
                    <div className="mt-4 rounded-[18px] border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/[0.06] via-fuchsia-500/[0.02] to-transparent p-4 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_36px_-18px_rgba(217,70,239,0.35)]">
                      <div className="label-tech mb-3 flex items-center justify-between text-[10px] tracking-widest text-fuchsia-200">
                        <span className="inline-flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-60 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-300" />
                          </span>
                          Tasks em produção · {Object.keys(batchStatesDaEmpresa).length}
                        </span>
                        {batchesEmOutrasEmpresas.length ? (
                          <span
                            className="mono normal-case tracking-normal text-[10px] text-text-muted"
                            title={batchesEmOutrasEmpresas.map((b) => b.taskName).join('\n')}
                          >
                            + {batchesEmOutrasEmpresas.length} rodando em outra empresa
                          </span>
                        ) : null}
                      </div>
                      <ul className="grid gap-3">
                        {Object.values(batchStatesDaEmpresa).sort((a, b) => b.startedAt - a.startedAt).map((b) => {
                          const partsDispatched = b.parts.filter(p => p.videoId).length;
                          const partsRendered = b.parts.filter(p => p.videoStatus === 'completed').length;
                          // "Tudo OK" = todas partes COM CONTEÚDO dispararam + renderizaram E
                          //  pipeline produziu o esperado.
                          //
                          // CRITICAL (fix 2026-05-28 v2): partes VAZIAS (BODY vazia
                          //  "(esse part nao gera nada)") têm videoId=null E um error
                          //  específico: "processJob: precisa de `file` OU `text`" —
                          //  porque não há texto pra disparar. Essas NÃO contam como
                          //  faltantes (são intencionalmente vazias).
                          //
                          //  Distinção:
                          //   - Parte VAZIA: sem videoId + error de "precisa de file/text"
                          //     OU sem error nenhum → IGNORA
                          //   - Parte que FALHOU de verdade (network, NSFW, etc): sem
                          //     videoId + error REAL → conta como faltante
                          const isEmptyPart = (p: any) => !p.videoId && (
                            !p.error ||
                            /precisa de\s*[`'"]?(file|text|audio|texto)|vazio|sem (texto|conte)|empty|nao vai gerar/i.test(String(p.error))
                          );
                          const expectableParts = b.parts.filter(p => !isEmptyPart(p));
                          const dispatchOk = expectableParts.length > 0 && expectableParts.every(p => !!p.videoId);
                          const renderOk = expectableParts.filter(p => p.videoId).every(p => !p.videoStatus || p.videoStatus === 'completed');
                          const pipeOk = b.pipeStats
                            ? (
                                b.pipeStats.expectedMontagens > 0
                                && b.pipeStats.okMontagens === b.pipeStats.expectedMontagens
                                // NENHUMA montagem incompleta (faltando texto):
                                && !b.pipeStats.incompleteMontagens
                                && (!b.pipeStats.expectedDecupagem || b.pipeStats.okDecupados === b.pipeStats.expectedMontagens)
                                && (!b.pipeStats.expectedCamuflagem || b.pipeStats.okCamuflados === b.pipeStats.expectedMontagens)
                              )
                            // montadoZipName SOBREVIVE o reload (o persist só
                            // descarta as URLs blob); usar ele aqui evita a VA
                            // PRONTA piscar "INCOMPLETO" enquanto a re-hidratação
                            // assíncrona do montadoZipUrl (do IDB) não termina.
                            : (b.phase === 'done' && (!!b.montadoZipUrl || !!b.montadoZipName));
                          // BLINDAGEM VA: o pipeOk da VA só checa "o zip existe" —
                          // NÃO sabe se vieram os 2 avatares. Sem isto, uma VA 1/2
                          // mostrava PRONTO verde e o user só descobria ao baixar 1.
                          // vaStats (okAvas/expectedAvas) é a verdade: se faltou
                          // avatar, NÃO é "tudo OK" → card vira AVISO. Download segue
                          // liberado (montagemContentOk só exige o zip).
                          const vaOk = !b.isVA || !b.vaStats || (b.vaStats.expectedAvas > 0 && b.vaStats.okAvas >= b.vaStats.expectedAvas);
                          const allOk = dispatchOk && renderOk && pipeOk && vaOk;
                          const isPartialDone = b.phase === 'done' && !allOk;
                          // CONTEÚDO do montado completo = todas as partes/texto
                          // presentes. Decupagem e camuflagem são pós-processos
                          // OPCIONAIS: se falharem, o montado ainda tem TODO o
                          // texto + áudio nivelado (não é "zoada"), então o
                          // download NÃO trava — só o aviso aparece. Travava
                          // vídeo bom de vez quando a decupagem (passo frágil)
                          // falhava de forma determinística e o Retomar re-falhava.
                          const montagemContentOk = b.pipeStats
                            ? (
                                b.pipeStats.expectedMontagens > 0
                                && b.pipeStats.okMontagens === b.pipeStats.expectedMontagens
                                && !b.pipeStats.incompleteMontagens
                              )
                            // montadoZipName SOBREVIVE o reload (o persist só
                            // descarta as URLs blob); usar ele aqui evita a VA
                            // PRONTA piscar "INCOMPLETO" enquanto a re-hidratação
                            // assíncrona do montadoZipUrl (do IDB) não termina.
                            : (b.phase === 'done' && (!!b.montadoZipUrl || !!b.montadoZipName));
                          // Só trava download quando FALTA conteúdo (parte/texto/
                          // render), nunca por pós-processo opcional. Troca tem
                          // fluxo próprio (prova/transcrição) → nunca trava aqui.
                          // VA: a entrega é POR AVATAR. Se uma parte falhou (ex:
                          // cota do HeyGen) o avatar dela não monta, mas os OUTROS
                          // avatares completos SÃO entregáveis. Então pra VA trava
                          // só quando NENHUM avatar saiu (okAvas===0 / zip sem mp4);
                          // com ≥1 avatar, libera o download do que existe (o aviso
                          // vaStats já deixa claro "x/y"). Normal segue como antes.
                          const downloadBlocked =
                            b.phase === 'done' && b.kind !== 'troca'
                            && (b.isVA
                                ? !(b.vaStats ? b.vaStats.okAvas > 0 : (!!b.montadoZipUrl || !!b.montadoZipName))
                                : !(dispatchOk && renderOk && montagemContentOk));
                          const elapsedMs = (b.finishedAt || nowTick) - b.startedAt;
                          const running = ['dispatching', 'rendering', 'downloading', 'post'].includes(b.phase);
                          const queued = b.phase === 'queued';

                          // TROCA DE ÁUDIO: card sem grid de takes — mostra a
                          // PROVA por transcricao (o que a IA le no MP4 real).
                          const trocaProofNode = b.kind === 'troca' ? (
                            <div className="rounded-[10px] border border-teal-500/40 bg-teal-500/5 p-3">
                              <div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-teal-200">
                                🎧 Prova — o que a IA escuta (soma mono do MP4 real)
                              </div>
                              {b.phase === 'done' && b.camufladoZipUrl ? (
                                <>
                                  {/* Player inline — assiste/ouve o resultado antes de baixar */}
                                  <video
                                    src={b.camufladoZipUrl}
                                    controls
                                    className="mb-2 w-full rounded-[10px] border border-teal-500/30 bg-black"
                                  />
                                  {/* Confianca da verificacao (correlacao na soma mono) */}
                                  {typeof b.trocaWhiteScore === 'number' && typeof b.trocaBlackScore === 'number' ? (
                                    <div className="mono mb-2 flex flex-wrap items-center gap-2 text-[10px]">
                                      <span className="text-text-muted">Confiança:</span>
                                      <span className="rounded border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-lime">WHITE {b.trocaWhiteScore.toFixed(2)}</span>
                                      <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-300">BLACK {b.trocaBlackScore.toFixed(2)}</span>
                                      <span className="text-text-muted/70">(WHITE alto + BLACK baixo = a IA lê o novo áudio)</span>
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => transcribeTrocaResult(b.taskId, b.camufladoZipUrl!)}
                                    disabled={trocaProof[b.taskId]?.loading}
                                    className="mono inline-flex items-center gap-2 rounded-[8px] border border-teal-400/50 bg-teal-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-teal-100 transition hover:bg-teal-500/20 disabled:cursor-wait disabled:opacity-60"
                                  >
                                    {trocaProof[b.taskId]?.loading ? (
                                      <>
                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-300 border-t-transparent" />
                                        Ouvindo como a IA...
                                      </>
                                    ) : (
                                      <>🎧 Transcrever o que a IA lê</>
                                    )}
                                  </button>
                                  {trocaProof[b.taskId]?.err ? (
                                    <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                                      {trocaProof[b.taskId]?.err}
                                    </div>
                                  ) : null}
                                  {trocaProof[b.taskId]?.text ? (
                                    <div className="mt-2 rounded-[8px] border border-teal-500/30 bg-bg-soft/50 px-3 py-2">
                                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white">
                                        {trocaProof[b.taskId]?.text}
                                      </p>
                                      <p className="mt-2 text-[10px] text-text-muted">
                                        Tem que bater com o roteiro do <strong className="text-teal-200">novo WHITE</strong>. Se vier o áudio antigo, aumente a intensidade e refaça.
                                      </p>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="text-[11px] text-text-muted">A prova fica disponível quando a troca terminar.</div>
                              )}
                            </div>
                          ) : null;

                          // Preview slot — so renderiza se ja tem video disparado
                          const previewsNode = b.kind === 'troca' ? trocaProofNode : b.parts.some((p) => p.videoId) ? (() => {
                            // Mapeia idx do filtered → idx no array original (pra EDIT funcionar)
                            const validIdxsFiltered: number[] = [];
                            const previews: LipsyncTake[] = b.parts
                              .map((p, originalIdx) => ({ p, originalIdx }))
                              .filter(({ p }) => !!p.videoId)
                              .map(({ p, originalIdx }) => {
                                validIdxsFiltered.push(originalIdx);
                                return {
                                  label: p.label,
                                  status: p.videoStatus || 'processing',
                                  videoUrl: p.videoUrl ?? null,
                                  error: p.error ?? null,
                                };
                              });
                            const donePv = previews.filter((p) => p.status === 'completed').length;
                            const pct = previews.length > 0 ? Math.round((100 * donePv) / previews.length) : 0;
                            const canEdit = !!b.replan?.parts?.length; // so habilita se temos plan
                            return (
                              <>
                                <div className="mono mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
                                  <span>Takes ({donePv}/{previews.length} prontos)</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                  {previews.map((t, ti) => {
                                    const originalIdx = validIdxsFiltered[ti];
                                    const isRegenThis = regeneratingPart?.taskId === b.taskId && regeneratingPart?.label === t.label;
                                    return (
                                      <LipsyncPreviewCard
                                        key={ti}
                                        take={t}
                                        position={ti + 1}
                                        total={previews.length}
                                        percent={pct}
                                        fileBase={b.baseAdId || b.taskName}
                                        isRegenerating={isRegenThis}
                                        // Editar texto: nos prontos (trocar script/voz) E nos que
                                        // FALHARAM (contornar a falha do HeyGen re-gerando a parte).
                                        onEdit={canEdit && (t.status === 'completed' || t.status === 'failed') ? () => openEditPart(b.taskId, originalIdx) : undefined}
                                        // Usar áudio: saída pra parte que FALHOU (sobe um áudio e o
                                        // avatar dá lipsync, pulando o TTS quebrado) e também pra que
                                        // está AGUARDANDO o HeyGen — aí é escolha EXPLÍCITA do user
                                        // de não esperar o render lento. O sistema sozinho nunca
                                        // re-dispara um take que ainda está gerando.
                                        onUploadAudio={canEdit && (t.status === 'failed' || t.status === 'stalled') ? (file) => void regenerateSinglePartFromAudio(b.taskId, originalIdx, file) : undefined}
                                      />
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })() : null;

                          // Canais (KWAI/META/YT/TIKTOK...) pro chip no card da
                          // fila: usa o snapshot do disparo; se ausente (ex card
                          // antigo), resolve ao vivo do board.
                          const taskForChannels = tasks.find((t) => t.id === b.taskId);
                          const channels = b.channels && b.channels.length
                            ? b.channels
                            : (taskForChannels ? resolveChannels(taskForChannels) : []);

                          return (
                            <BatchJobCard3D
                              key={b.taskId}
                              taskId={b.taskId}
                              taskName={b.taskName}
                              channels={channels}
                              phase={b.phase as any}
                              partsTotal={b.parts.length}
                              partsDispatched={partsDispatched}
                              partsRendered={partsRendered}
                              message={b.message}
                              elapsedMs={elapsedMs}
                              allOk={allOk}
                              isPartialDone={isPartialDone}
                              // Trava download só quando FALTA conteúdo (parte/
                              // texto/render). Pós-processo opcional (decupagem/
                              // camuflagem) que falhou NÃO trava o montado válido.
                              downloadBlocked={downloadBlocked}
                              takesUrl={b.zipBlobUrl}
                              takesFilename={b.zipFilename}
                              montadoUrl={b.montadoZipUrl}
                              montadoFilename={b.montadoZipName}
                              camufladoUrl={b.camufladoZipUrl}
                              camufladoFilename={b.camufladoZipName}
                              // GARANTIA DE ENTREGA (fix 2026-07-03): as URLs blob
                              // acima são efêmeras. Quando a task está PRONTA mas o
                              // reload/persist descartou a URL e a re-hidratação do
                              // IDB falhou (IDB travado por outra aba), o botão de
                              // download sumia (bug AD44GL). Este loader lê os ZIPs
                              // DIRETO do IndexedDB por taskId no clique → a entrega
                              // nunca depende da URL viva. Só passa quando a task
                              // TEM entrega completa (não mostra botão em incompleta).
                              loadDeliverables={
                                b.phase === 'done'
                                && (montagemContentOk || b.kind === 'troca' || !!b.camufladoZipName || !!b.camufladoZipUrl)
                                  ? async () => {
                                      const { loadZip } = await import('@/lib/zip-store');
                                      const keys = b.isVA
                                        ? [`va:${b.taskId}:zip`]
                                        : [`batch:${b.taskId}:montado`, `batch:${b.taskId}:camo`];
                                      const out: Array<{ url: string; name?: string; revoke?: boolean }> = [];
                                      for (const k of keys) {
                                        try {
                                          const z = await loadZip(k);
                                          if (z?.blobUrl) out.push({ url: z.blobUrl, name: z.filename, revoke: true });
                                        } catch (e) { console.warn('[pilot] loadDeliverables', k, e); }
                                      }
                                      return out;
                                    }
                                  : undefined
                              }
                              isRunning={running}
                              isQueued={queued}
                              // TROCA em 'queued' tem driver próprio (não é dirigida pelo promoter):
                              // libera Retomar/Debug pra nunca ficar sem botão útil se o loop serial cair.
                              queuedRecoverable={b.kind === 'troca'}
                              onRetomar={() => retomarTaskBatch(b.taskId)}
                              onPausar={() => pausarTaskBatch(b.taskId)}
                              onDebug={() => debugTaskBatch(b.taskId)}
                              onRemove={() => {
                                if (queued) batchCancelRef.current[b.taskId] = true;
                                for (const url of [b.zipBlobUrl, b.montadoZipUrl, b.camufladoZipUrl]) {
                                  if (url) { try { URL.revokeObjectURL(url); } catch {} }
                                }
                                // TROCA: limpa o WHITE persistido no IndexedDB.
                                if (b.kind === 'troca') {
                                  void import('@/lib/zip-store')
                                    .then((m) => m.deletePrefix('troca:white:' + b.taskId))
                                    .catch(() => {});
                                }
                                // VA: limpa o cache de partes renderizadas + o zip
                                // do IDB (evita acúmulo ao remover a task).
                                if (b.isVA) {
                                  void import('@/lib/zip-store')
                                    .then((m) => Promise.all([
                                      m.deletePrefix('va:' + b.taskId + ':part:'),
                                      m.deletePrefix('va:' + b.taskId + ':zip'),
                                    ]))
                                    .catch(() => {});
                                }
                                setBatchStates((prev) => {
                                  const { [b.taskId]: _, ...rest } = prev;
                                  return rest;
                                });
                              }}
                              dirtyPartsCount={(b.dirtyParts || []).length}
                              onRebuild={() => void rebuildMontage(b.taskId)}
                              isRebuilding={rebuildingTaskId === b.taskId}
                              docUrl={b.kind === 'troca' ? undefined : (b.docUrl || taskAnalyses[b.taskId]?.docUrl)}
                              taskUrl={b.taskUrl || taskAnalyses[b.taskId]?.taskUrl}
                              folderUrl={b.kind === 'troca' ? (b.trocaOutputFolderUrl || taskAnalyses[b.taskId]?.trocaBriefing?.driveFolderUrl || undefined) : undefined}
                              resolveDocUrl={b.kind === 'troca' ? undefined : async () => {
                                // Lazy fetch: pega o docUrl ao vivo do ClickUp.
                                // Usado quando o batch antigo nao tem docUrl em cache.
                                // Apos resolver, persiste no state pra futuras chamadas.
                                try {
                                  const det = await getTask(b.taskId);
                                  const docField = (det.custom_fields || ([] as any[])).find((f: any) => /DOC DA COPY/i.test(f.name || ''));
                                  const found: string | undefined =
                                    docField?.value || extractDocLinks(det.description || det.text_content)[0];
                                  if (found) {
                                    // Persiste pra proximas chamadas (sobrevive reload via persistBatchStates)
                                    setBatchStates((prev) => {
                                      const cur = prev[b.taskId];
                                      if (!cur) return prev;
                                      return { ...prev, [b.taskId]: { ...cur, docUrl: found, taskUrl: cur.taskUrl || (det as any).url } };
                                    });
                                    return found;
                                  }
                                  return null;
                                } catch (e) {
                                  console.warn('[resolveDocUrl] getTask falhou:', e);
                                  return null;
                                }
                              }}
                              extraActions={b.isVA && b.adOriginalUrl ? (
                                <a
                                  href={b.adOriginalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Baixar AD original (Drive)"
                                  aria-label="Baixar AD original"
                                  className="group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/55 bg-gradient-to-b from-cyan-400/25 via-cyan-400/10 to-cyan-400/[0.02] text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(34,211,238,0.45)] hover:-translate-y-0.5 hover:scale-[1.08] hover:border-cyan-400/80 active:translate-y-0 active:scale-95 transition-[transform,box-shadow]"
                                >
                                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                                  <span className="relative text-[13px]">🎬</span>
                                </a>
                              ) : undefined}
                            >
                              {previewsNode}
                            </BatchJobCard3D>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {/* Painel fila Magnific — serial, 1 por vez (espelha batches HeyGen) */}
                  {Object.keys(magnificQueue).length > 0 ? (
                    <div className="mt-4 rounded-[12px] border border-lime/40 bg-lime/5 p-3">
                      <div className="mono mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-lime">
                        <span>🍌 Fila Magnific B-Rolls ({Object.keys(magnificQueue).length}) · serial 1/vez</span>
                        {Object.values(magnificQueue).some((j) => j.status === 'done' || j.status === 'failed') ? (
                          <button
                            type="button"
                            onClick={() => setMagnificQueueState((prev) => {
                              const next: MagnificQueue = {};
                              for (const [k, v] of Object.entries(prev)) {
                                if (v.status !== 'done' && v.status !== 'failed') next[k] = v;
                              }
                              return next;
                            })}
                            className="rounded border border-line-strong px-2 py-0.5 text-text-muted hover:border-red-500/60 hover:text-red-300"
                          >
                            limpar concluidos/falhas
                          </button>
                        ) : null}
                      </div>
                      {/* activeJobTaskId é calculado dentro do map (linha
                          abaixo) pra ser sempre consistente com o snapshot
                          atual da fila. Regra: só a task EM PROCESSO aceita
                          comandos; outras na fila ficam aguardando vez. */}
                      {(() => {
                        // Snapshot único do running atual — usado em todos os jobs do map
                        const activeJobTaskId = Object.values(magnificQueue).find((x) => x.status === 'running')?.taskId;
                        const sortedJobs = Object.values(magnificQueue).sort((a, b) => b.enqueuedAt - a.enqueuedAt);
                        return (
                      <ul className="grid gap-2">
                        {sortedJobs.map((j) => {
                          const isActive = j.status === 'running';
                          const isOtherRunning = !!activeJobTaskId && activeJobTaskId !== j.taskId;
                          // Bloqueia interações com tasks na fila enquanto OUTRA está rodando.
                          // Mantém terminais (done/failed) interativas — usuário baixa/remove à vontade.
                          const blockedByQueue =
                            isOtherRunning && (j.status === 'queued' || j.status === 'paused');
                          const stLabel = ({
                            queued: j.gateOnHeyGen
                              ? '⏳ aguardando HeyGen'
                              : blockedByQueue
                                ? '⏳ aguardando vez na fila'
                                : '⏳ na fila',
                            running: '⚙ gerando B-rolls',
                            paused: blockedByQueue ? '⏸ pausado · aguardando vez' : '⏸ pausado',
                            done: '✅ pronto',
                            failed: '✗ falhou',
                          } as Record<typeof j.status, string>)[j.status];
                          const stColor = j.status === 'done' ? 'text-lime border-lime/40 bg-lime/10'
                            : j.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                            : j.status === 'running' ? 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10'
                            : j.status === 'paused' ? 'text-yellow-200 border-yellow-500/40 bg-yellow-500/10'
                            : 'text-text-muted border-line-strong bg-bg-soft/40';
                          const pct = j.status === 'done' ? 100 : j.status === 'failed' ? 0 : (j.percent || (j.status === 'running' ? 5 : 0));
                          const jobRunning = j.status === 'running';
                          // Tooltip explicativo quando botão está bloqueado pela fila
                          const blockedReason = blockedByQueue
                            ? 'Bloqueado: aguardando a task em processo terminar (fila serial).'
                            : null;
                          return (
                            <li
                              key={j.taskId}
                              className={`rounded-[10px] border ${stColor} p-2 transition-opacity ${
                                blockedByQueue ? 'opacity-60' : ''
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span className="mono">
                                  <strong className="text-white">{j.adName}</strong>
                                  <span className="ml-2">{stLabel}</span>
                                  <span className="ml-2 text-text-muted">· {j.takeCount} take{j.takeCount === 1 ? '' : 's'}</span>
                                  {isActive ? (
                                    <span
                                      className="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan-400/60 bg-cyan-500/15 px-1.5 py-0 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-200"
                                      style={{ fontFamily: 'var(--font-tech)' }}
                                      title="Esta task está em processo agora — só ela aceita comandos"
                                    >
                                      <span className="inline-block h-1 w-1 animate-pulse-soft rounded-full bg-cyan-300" />
                                      EM PROCESSO
                                    </span>
                                  ) : null}
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {j.status === 'done' && j.zipKey ? (
                                    <button
                                      type="button"
                                      onClick={() => downloadMagnificZip(j.taskId)}
                                      className="mono rounded border border-lime bg-lime/20 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30"
                                      title="Baixa o ZIP de takes B-roll dessa task"
                                    >
                                      ⬇ takes
                                    </button>
                                  ) : null}
                                  {/* PAUSAR / RETOMAR / DEBUG — quando outra task está
                                   *  rodando, estes botões ficam BLOQUEADOS pra
                                   *  tasks da fila/pausadas (regra serial estrita).
                                   *  Só a task EM PROCESSO controla seus botões. */}
                                  <button
                                    type="button"
                                    onClick={() => pauseMagnificJob(j.taskId)}
                                    disabled={blockedByQueue || j.status === 'paused' || j.status === 'done'}
                                    className="mono rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'Para o job (rodando ou na fila). Libera a vez pra outro.'}
                                  >
                                    ⏸ Pausar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => resumeMagnificJob(j.taskId)}
                                    disabled={blockedByQueue || jobRunning || j.status === 'done'}
                                    className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'Volta o job pra fila — roda quando nenhum outro estiver rodando (serial 1/vez)'}
                                  >
                                    🔄 Retomar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => debugMagnificJob(j.taskId)}
                                    disabled={blockedByQueue}
                                    className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'DEBUG (reserva p/ bugs/loop): aborta e recria do ZERO num space novo'}
                                  >
                                    🐞 Debug
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeMagnificJob(j.taskId)}
                                    className="mono rounded border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                    title="Remove esse job da fila (sempre disponível pra liberar espaço)"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                              {j.status !== 'failed' ? (
                                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-soft/60">
                                  <div
                                    className={`h-full ${j.status === 'done' ? 'bg-lime' : 'bg-cyan-400'} transition-all duration-300`}
                                    style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                                  />
                                </div>
                              ) : null}
                              {j.message ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">{j.message}</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                        );
                      })()}
                    </div>
                  ) : null}

                  {/* Preview previsibilidade — antes de iniciar */}
                  {Object.keys(taskAnalyses).length > 0 ? (
                    <div className="mt-4">
                      <div className="section-eyebrow mb-3 text-[11px]">
                        Análise <span className="ml-1 font-semibold tracking-[0.14em] text-text-dim">— o que vai ser disparado</span>
                      </div>
                      <ul className="grid gap-2">
                        {Object.values(taskAnalyses)
                          // Filtra siblings G2/G3 que ja foram analisadas como parte do
                          // primary (G1) — assim aparece UM card so por base task (G1+G2 = 1 card)
                          .filter((a) => !a.sharedWithPrimaryId)
                          .map((a) => {
                          const sym = a.status === 'ready' ? '✓' : a.status === 'partial' ? '⚠' : a.status === 'error' ? '✗' : a.status === 'analyzing' ? '◷' : '·';
                          const color = a.status === 'ready' ? 'border-lime/40 bg-lime/5' :
                                         a.status === 'partial' ? 'border-yellow-500/40 bg-yellow-500/5' :
                                         a.status === 'error' ? 'border-red-500/40 bg-red-500/5' :
                                         'border-line bg-bg-soft/30';
                          // Acha os siblings que compartilham essa analise (G2, G3, etc)
                          const sharedSiblings = Object.values(taskAnalyses).filter(
                            (s) => s.sharedWithPrimaryId === a.taskId
                          );
                          // Extrai a parte G1/G2/etc do nome de cada sibling pra mostrar agrupado
                          const allGSuffixes = [a, ...sharedSiblings].map((s) => {
                            // B2C: sufixo " - G1" no FIM do nome da task
                            const fim = s.taskName.match(/G(\d+)\s*$/i);
                            if (fim) return `G${fim[1]}`;
                            // DR MILLION: a variante vive DENTRO do código (AD07G1GL → G1)
                            const dentro = (s.baseAdId || s.taskName).match(/^AD\d+(G\d+)/i);
                            return dentro ? dentro[1].toUpperCase() : null;
                          }).filter(Boolean);
                          const displayName = sharedSiblings.length === 0
                            ? a.taskName
                            : a.drMillion
                              ? `${adGroupOf(a.baseAdId || a.taskName) || a.taskName} · ${1 + sharedSiblings.length} hooks`
                              : a.taskName.replace(/\s*[-–—]\s*G\d+\s*$/i, '').trim();
                          return (
                            <li key={a.taskId} className={`rounded-[10px] border ${color} p-3 text-[11px]`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="mono text-xs text-white flex items-center gap-2 flex-wrap">
                                  {sym} {displayName}
                                  {sharedSiblings.length > 0 ? (
                                    <span
                                      className="mono rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200"
                                      title={a.drMillion
                                        ? `Mesmo anúncio, ${1 + sharedSiblings.length} ganchos: ${[a, ...sharedSiblings].map((s) => s.taskName).join(' · ')}\nO corpo é gerado UMA vez e usado nos ${1 + sharedSiblings.length} vídeos. Cada um sai com o nome da sua task.`
                                        : 'Task agrupada — G1 + G2 sao a mesma task no ClickUp, gerada 1x com 2 hooks + 1 body'}
                                    >
                                      {allGSuffixes.join(' + ')} · {a.drMillion ? `${1 + sharedSiblings.length} vídeos` : '1 task'}
                                    </span>
                                  ) : null}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeTaskFromAnalysis(a.taskId)}
                                  className="mono shrink-0 rounded-md border border-red-500/50 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/25 hover:border-red-500"
                                  title="Remove esta task da previsibilidade (também desmarca da seleção). Pode adicionar de novo depois."
                                >
                                  × Remover
                                </button>
                              </div>

                              {/* MOTOR CONFIG — Avatar III/IV/V picker.
                                  ESCONDIDO quando ONLY MAGNIFIC tá ligado:
                                  esse modo pula HeyGen totalmente (só dispara
                                  Auto B-rolls), então não há avatar pra
                                  escolher. Limpa a UI e elimina dúvida. */}
                              {!onlyMagnificMode && !a.trocaBriefing && (a.status === 'ready' || a.status === 'partial') ? (
                                <div className="mt-2">
                                  <MotorConfigPicker
                                    config={getMotorConfig(a.taskId)}
                                    setConfig={(cfg) => setMotorConfigForTask(a.taskId, cfg)}
                                    takeCount={(a.partTemplates?.length || 0) || (a.totalParts || 0) || (a.roleSlots?.length || 0)}
                                    slotIds={(a.partTemplates || []).map((p: any, i: number) => p.label || `t${i}`)}
                                    // Calcula duracoes reais lendo a copy de cada parte (palavras / 150 wpm)
                                    takeSeconds={(a.partTemplates || []).map((p: any) => estimateSecondsFromText(p.text || ''))}
                                  />
                                </div>
                              ) : null}

                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span></span>
                                {a.vaBriefing ? (
                                  // ═══ VA ACTION BAR 3D — espelha o design das tasks normais.
                                  //  Sem botao de disparo aqui de proposito: VA roda na MESMA
                                  //  fila e dispara pelo START global. Aqui so atalhos (Doc + AD). ═══
                                  (() => {
                                    const adFileId = a.vaBriefing!.linkAdFileId;
                                    const isTextEngine = vaUsesTextEngine(a.taskId);
                                    return (
                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        <span
                                          className={
                                            'mono rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest ' +
                                            (isTextEngine
                                              ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200'
                                              : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200')
                                          }
                                          title={isTextEngine
                                            ? `Variação de Avatar (motor TEXTO — canal ${organicChannelLabels(tasks.find((x) => x.id === a.taskId)).join('/')}): cada avatar gera o hook+body por texto`
                                            : 'Variação de Avatar — cada avatar fala com o áudio do AD original'}
                                        >
                                          {isTextEngine ? 'VA·TEXTO' : 'VA'} · {a.vaBriefing!.avatares.length} avatar{a.vaBriefing!.avatares.length === 1 ? '' : 'es'}
                                        </span>
                                        {(a.docUrl || a.taskUrl) ? (
                                          <PilotBtn3D
                                            icon={<PilotIconDoc size={16} />}
                                            color="cyan"
                                            title={a.docUrl ? (a.docHeadingId ? 'Abrir doc direto na copy do AD' : 'Abrir doc da copy') : 'Abrir task no ClickUp'}
                                            href={docDeepLink(a.docUrl, a.docHeadingId) || a.taskUrl}
                                          />
                                        ) : null}
                                        {adFileId ? (
                                          <PilotBtn3D
                                            icon={<PilotIconDownload size={16} />}
                                            color="cyan"
                                            title="Baixar AD original (Drive)"
                                            href={`https://drive.google.com/uc?export=download&id=${adFileId}`}
                                          />
                                        ) : null}
                                      </div>
                                    );
                                  })()
                                ) : !a.trocaBriefing && (a.status === 'ready' || a.status === 'partial') ? (
                                  // ═══ ACTION BAR 3D — botoes icon-only ═══
                                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                    {/* Tesoura (decupagem) toggle + INTENSIDADE.
                                        Tesoura liga/desliga (igual antes). Quando
                                        ON, aparece o chip com o valor do corte —
                                        clica e abre o slider (mesmo parâmetro da
                                        ferramenta /decupagem). O valor é fiel: o
                                        que está aqui é o keepSilence do corte. */}
                                    <div className="relative inline-flex items-center gap-1">
                                      <PilotBtn3D
                                        icon={<PilotIconScissors size={16} />}
                                        color={isDecupagemEnabled(a.taskId) ? 'lime' : 'neutral'}
                                        active={isDecupagemEnabled(a.taskId)}
                                        title={isDecupagemEnabled(a.taskId) ? 'Decupagem ON' : 'Decupagem OFF'}
                                        onClick={() => setDecupagemFor(a.taskId, !isDecupagemEnabled(a.taskId))}
                                      />
                                      {isDecupagemEnabled(a.taskId) ? (
                                        <button
                                          type="button"
                                          onClick={() => setDecupPopoverOpen((p) => ({ ...p, [a.taskId]: !p[a.taskId] }))}
                                          title="Intensidade do corte — quanto de silêncio manter nas bordas da fala. Menor = mais agressivo. O valor é fiel ao corte."
                                          aria-expanded={!!decupPopoverOpen[a.taskId]}
                                          className="mono shrink-0 rounded-full border border-lime/45 bg-lime/10 px-2 py-1 text-[10px] font-bold leading-none text-lime transition hover:bg-lime/20"
                                        >
                                          {getDecupIntensity(a.taskId).toFixed(2)}s
                                        </button>
                                      ) : null}
                                      {isDecupagemEnabled(a.taskId) && decupPopoverOpen[a.taskId] ? (
                                        <>
                                          {/* clique-fora fecha */}
                                          <div
                                            className="fixed inset-0 z-30"
                                            onClick={() => setDecupPopoverOpen((p) => ({ ...p, [a.taskId]: false }))}
                                            aria-hidden
                                          />
                                          <div className="absolute left-0 top-full z-40 mt-2 w-[264px] rounded-[14px] border border-lime/30 bg-bg/95 p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur">
                                            <div className="mb-2.5 flex items-center justify-between">
                                              <span className="label-tech text-[10px] uppercase tracking-[0.16em] text-lime">
                                                Intensidade do corte
                                              </span>
                                              <span className="mono text-[12.5px] font-bold text-lime">
                                                {getDecupIntensity(a.taskId).toFixed(2)}s
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min={0.01}
                                              max={0.5}
                                              step={0.01}
                                              value={getDecupIntensity(a.taskId)}
                                              onChange={(e) => setDecupIntensityFor(a.taskId, parseFloat(e.target.value))}
                                              className="w-full accent-lime"
                                            />
                                            <div className="mt-1 flex justify-between text-[9px] text-text-muted">
                                              <span>agressivo</span>
                                              <span>fala respira</span>
                                            </div>
                                            <p className="mt-2.5 text-[10px] leading-snug text-text-muted">
                                              Silêncio mantido nas bordas de cada fala. O valor é aplicado <span className="text-lime">fielmente</span> no corte (vale pro disparo e pro RETOMAR).
                                            </p>
                                          </div>
                                        </>
                                      ) : null}
                                    </div>
                                    {/* Camuflagem toggle (per-task) */}
                                    <PilotBtn3D
                                      icon={<IconCamuflagem size={16} />}
                                      color={(taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? 'fuchsia' : 'neutral'}
                                      active={taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode}
                                      title={(taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? 'Camuflagem ON' : 'Camuflagem OFF — clica pra ativar'}
                                      onClick={() => toggleTaskCamuflagem(a.taskId)}
                                    />
                                    {/* Auto B-roll JSON — abre caixa pra colar JSON e disparar Magnific dessa task */}
                                    <PilotBtn3D
                                      icon={<PilotIconBroll size={16} />}
                                      color={(taskMagnificJson[a.taskId] || '').trim() ? 'violet' : 'neutral'}
                                      active={!!magnificEditorOpen[a.taskId]}
                                      title={
                                        (taskMagnificJson[a.taskId] || '').trim()
                                          ? 'Auto B-roll · JSON colado (clica pra editar/disparar)'
                                          : 'Auto B-roll · clica pra colar o JSON dos prompts dessa task'
                                      }
                                      onClick={() => setMagnificEditorOpen((p) => ({ ...p, [a.taskId]: !p[a.taskId] }))}
                                    />
                                    {/* Doc button */}
                                    {(a.docUrl || a.taskUrl) ? (
                                      <PilotBtn3D
                                        icon={<PilotIconDoc size={16} />}
                                        color="cyan"
                                        title={a.docUrl ? (a.docHeadingId ? 'Abrir doc direto na copy do AD' : 'Abrir doc da copy (Google Docs)') : 'Abrir task no ClickUp'}
                                        href={docDeepLink(a.docUrl, a.docHeadingId) || a.taskUrl}
                                      />
                                    ) : null}
                                    {/* Disparar HeyGen */}
                                    <PilotBtn3D
                                      icon={<PilotIconPlay size={18} />}
                                      color="lime"
                                      title={a.status === 'partial' ? 'Tem avatar pendente abaixo' : 'Disparar — gerar videos HeyGen'}
                                      disabled={a.status === 'partial'}
                                      onClick={() => dispatchTaskToHeyGen(a.taskId)}
                                      pulse={a.status === 'ready'}
                                    />
                                  </div>
                                ) : null}
                              </div>

                              {/* CAMUFLAGEM PANEL INLINE — so aparece quando toggle ON */}
                              {!onlyMagnificMode && !a.trocaBriefing && (taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? (
                                <div className="mt-2 rounded-[12px] border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/[0.08] via-fuchsia-500/[0.03] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                  <div className="mono mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
                                      Camuflagem · esta task
                                    </span>
                                    <span className="text-fuchsia-300/70">
                                      {(taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume)}%
                                    </span>
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-center">
                                    {/* Upload white audio */}
                                    <label className="mono group/upload inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-[11px] text-fuchsia-100 transition hover:bg-fuchsia-500/20 hover:border-fuchsia-500/60">
                                      <PilotIconUpload size={14} />
                                      <span className="truncate flex-1">
                                        {taskCamuflagem[a.taskId]?.white?.name || camuflagemWhite?.name || 'Clica pra upar audio WHITE'}
                                      </span>
                                      <input
                                        type="file"
                                        accept="audio/*,video/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0] || null;
                                          if (f) setTaskCamuflagemWhite(a.taskId, f);
                                        }}
                                      />
                                    </label>
                                    {(taskCamuflagem[a.taskId]?.white) ? (
                                      <button
                                        type="button"
                                        onClick={() => setTaskCamuflagemWhite(a.taskId, null)}
                                        className="mono rounded-md border border-text-muted/30 px-2 py-1 text-[10px] text-text-muted hover:border-red-500/50 hover:text-red-300"
                                        title="Remover white audio (volta pro global)"
                                      >
                                        ×
                                      </button>
                                    ) : null}
                                  </div>
                                  {/* Volume slider */}
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className="label-tech text-[9px] tracking-widest text-fuchsia-300/80 shrink-0">Volume</span>
                                    <input
                                      type="range"
                                      min={5}
                                      max={100}
                                      value={taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume}
                                      onChange={(e) => setTaskCamuflagemVolume(a.taskId, Number(e.target.value))}
                                      className="flex-1 accent-fuchsia-400 cursor-pointer"
                                    />
                                    <span className="mono text-[10px] font-bold tabular-nums text-fuchsia-200 w-10 text-right">
                                      {taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume}%
                                    </span>
                                  </div>
                                </div>
                              ) : null}
                              {/* CAIXA INLINE de JSON Auto B-roll (Magnific) por task — abre/fecha pelo botão 3D ✨ */}
                              {!a.vaBriefing && !a.trocaBriefing && magnificEditorOpen[a.taskId] ? (
                                <div className="mt-2 rounded-[12px] border border-violet-400/45 bg-gradient-to-br from-violet-500/[0.08] via-violet-500/[0.03] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                  <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-violet-200">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                                      Auto B-roll · esta task
                                    </span>
                                    {(() => {
                                      const raw = (taskMagnificJson[a.taskId] || '').trim();
                                      const n = raw ? parseMagnificPrompts(raw).length : 0;
                                      return raw ? (
                                        <span className={n > 0 ? 'text-lime' : 'text-red-300'}>
                                          {n > 0 ? `${n} take${n === 1 ? '' : 's'} detectado${n === 1 ? '' : 's'}` : 'JSON invalido'}
                                        </span>
                                      ) : (
                                        <span className="text-text-muted">vazio</span>
                                      );
                                    })()}
                                  </div>
                                  <textarea
                                    value={taskMagnificJson[a.taskId] || ''}
                                    onChange={(e) => setTaskMagnificJson(a.taskId, e.target.value)}
                                    rows={6}
                                    placeholder='Cole aqui o JSON de B-rolls (ex: [{ "imagePrompt": "...", "videoPrompt": "..." }, ...])'
                                    className="input-field resize-y font-mono text-[11px]"
                                  />
                                  <div className="mono mt-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[9px] uppercase tracking-widest text-text-muted">
                                      Fica salvo nessa task · Magnific roda invisivel (extensao, serial 1 por vez)
                                    </span>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => copyTaskBody(a.taskId)}
                                        className="mono rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20"
                                        title="Copia o body falado dessa task (sem hooks/links) — útil pra gerar os prompts no GPT"
                                      >
                                        {copiedBodyTask === a.taskId ? '✓ copiado' : '⧉ body'}
                                      </button>
                                      {taskMagnificJson[a.taskId] ? (
                                        <button
                                          type="button"
                                          onClick={() => setTaskMagnificJson(a.taskId, '')}
                                          className="mono rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                          title="Limpa o JSON dessa task"
                                        >
                                          × limpar
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        onClick={() => dispatchTaskToMagnific(a.taskId)}
                                        disabled={!(taskMagnificJson[a.taskId] || '').trim() || parseMagnificPrompts((taskMagnificJson[a.taskId] || '').trim()).length === 0}
                                        className="mono rounded-md border border-violet-400/60 bg-gradient-to-b from-violet-500/25 via-violet-500/15 to-violet-500/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_-4px_rgba(167,139,250,0.4)] transition hover:bg-violet-500/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_20px_-6px_rgba(167,139,250,0.6)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30 disabled:shadow-none"
                                        title="Dispara só Auto B-roll (Magnific) dessa task — independente do HeyGen"
                                      >
                                        ✨ Disparar B-rolls
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              {/* RENDER TROCA DE ÁUDIO — pipeline proprio (sem HeyGen) */}
                              {a.trocaBriefing ? (() => {
                                const detectedDriveId = a.trocaBriefing!.driveId || extractDriveFileId(trocaAdUrl[a.taskId] || '');
                                const pastedFolderId = extractDriveFolderId(trocaAdUrl[a.taskId] || '');
                                const folderUrl = a.trocaBriefing!.driveFolderUrl;
                                const hasSource = !!detectedDriveId || !!pastedFolderId;
                                const whiteFile = trocaWhite[a.taskId] || null;
                                const vol = trocaVolume[a.taskId] ?? 30;
                                return (
                                <div className="mt-1 grid gap-2">
                                  <div className="rounded-[10px] border border-teal-500/40 bg-teal-500/5 p-3">
                                    <div className="mono mb-2 text-[10px] uppercase tracking-widest text-teal-200">
                                      🔄 Troca de Áudio · {a.trocaBriefing!.baseAdId}
                                    </div>
                                    <div className="text-[11px] text-text-muted">
                                      Baixa o criativo original do Drive, tira o áudio WHITE antigo (descamuflagem) e embute o novo WHITE que você subir. O áudio público continua igual.
                                    </div>
                                    {/* Link do criativo original */}
                                    <div className="mt-2">
                                      <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">Criativo original (Drive)</div>
                                      {detectedDriveId ? (
                                        <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                          <span className="rounded border border-lime/40 bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">✓ Vídeo detectado: {detectedDriveId}</span>
                                        </div>
                                      ) : pastedFolderId ? (
                                        <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                          <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200">📁 Pasta colada — acho o vídeo automaticamente no disparo</span>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="mono text-[9px] uppercase tracking-widest text-yellow-300">⚠ Sem comentário com o link — abra a pasta, copie o link do vídeo (ou da pasta) e cole abaixo</span>
                                          {folderUrl ? (
                                            <a
                                              href={folderUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="mono rounded border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/20"
                                              title="Abre a pasta do criativo no Drive (LINK PASTA DRIVE)"
                                            >
                                              📁 Abrir pasta do Drive ↗
                                            </a>
                                          ) : null}
                                        </div>
                                      )}
                                      <input
                                        type="text"
                                        value={trocaAdUrl[a.taskId] || ''}
                                        onChange={(e) => setTrocaAdUrl((prev) => ({ ...prev, [a.taskId]: e.target.value }))}
                                        placeholder="Cola o link do vídeo (file/d/...) OU da pasta (drive/folders/...)"
                                        className="mono mt-1.5 w-full rounded-[8px] border border-line bg-bg/60 px-2.5 py-1.5 text-[11px] text-white placeholder:text-text-muted/60 focus:border-teal-400/60 focus:outline-none"
                                      />
                                    </div>
                                    {/* Upload do novo WHITE */}
                                    <div className="mt-3">
                                      <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">Novo áudio WHITE (IA)</div>
                                      <label
                                        onDragOver={(e) => { e.preventDefault(); if (!trocaDragOver[a.taskId]) setTrocaDragOver((p) => ({ ...p, [a.taskId]: true })); }}
                                        onDragLeave={(e) => { e.preventDefault(); setTrocaDragOver((p) => ({ ...p, [a.taskId]: false })); }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          setTrocaDragOver((p) => ({ ...p, [a.taskId]: false }));
                                          const f = e.dataTransfer?.files?.[0] || null;
                                          if (f) {
                                            setTrocaWhite((prev) => ({ ...prev, [a.taskId]: f }));
                                            // BLINDAGEM F5: grava o WHITE no IDB JÁ no upload (não só quando o
                                            // runner roda). Sem isto, trocas em fila perdiam o áudio no reload e o
                                            // Retomar falhava com "Suba o novo áudio WHITE". Best-effort.
                                            void import('@/lib/zip-store').then(({ saveBlob }) => saveBlob('troca:white:' + a.taskId, f, f.type || 'audio/wav')).catch(() => {});
                                          }
                                        }}
                                        className={'mono flex cursor-pointer items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-[11px] transition ' + (trocaDragOver[a.taskId] ? 'border-teal-300 bg-teal-500/20 text-teal-100 ring-2 ring-teal-400/50' : whiteFile ? 'border-teal-400/60 bg-teal-500/10 text-teal-100' : 'border-line border-dashed bg-bg/60 text-text-muted hover:border-teal-400/40')}>
                                        <span className="truncate">{trocaDragOver[a.taskId] ? '⬇ Solte o áudio aqui' : whiteFile ? `🎵 ${whiteFile.name}` : 'Clica ou ARRASTA o áudio WHITE (.mp3/.wav/vídeo)'}</span>
                                        <span className="shrink-0 rounded border border-teal-400/40 bg-teal-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-teal-200">{whiteFile ? 'trocar' : 'upar'}</span>
                                        <input
                                          type="file"
                                          accept="audio/*,video/mp4,video/webm,video/quicktime"
                                          className="hidden"
                                          onChange={(e) => {
                                            const f = e.target.files?.[0] || null;
                                            setTrocaWhite((prev) => ({ ...prev, [a.taskId]: f }));
                                            // BLINDAGEM F5: grava o WHITE no IDB já no upload (ver comentário no drop).
                                            if (f) void import('@/lib/zip-store').then(({ saveBlob }) => saveBlob('troca:white:' + a.taskId, f, f.type || 'audio/wav')).catch(() => {});
                                          }}
                                        />
                                      </label>
                                      {whiteFile ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setTrocaWhite((prev) => ({ ...prev, [a.taskId]: null }));
                                            // some do IDB também, senão um F5 revivia o WHITE removido
                                            void import('@/lib/zip-store').then(({ deletePrefix }) => deletePrefix('troca:white:' + a.taskId)).catch(() => {});
                                          }}
                                          className="mono mt-1 text-[9px] uppercase tracking-widest text-text-muted hover:text-red-300"
                                        >
                                          remover
                                        </button>
                                      ) : null}
                                    </div>
                                    {/* Intensidade */}
                                    <div className="mt-3">
                                      <div className="mono mb-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
                                        <span>Intensidade do WHITE</span>
                                        <span className="text-teal-200">{vol}%</span>
                                      </div>
                                      <input
                                        type="range"
                                        min={5}
                                        max={100}
                                        step={1}
                                        value={vol}
                                        onChange={(e) => setTrocaVolume((prev) => ({ ...prev, [a.taskId]: Math.round(Number(e.target.value)) }))}
                                        className="w-full accent-teal-400"
                                      />
                                    </div>
                                  </div>
                                  <div className={'rounded-[10px] border p-3 text-[11px] ' + (whiteFile && hasSource ? 'border-lime/40 bg-lime/5 text-lime' : 'border-yellow-500/40 bg-yellow-500/5 text-yellow-200')}>
                                    {whiteFile && hasSource
                                      ? '✓ Pronto pra disparar — marque junto das outras e clique em Iniciar. O resultado aparece com botão de download no card.'
                                      : '⚠ Suba o novo WHITE' + (hasSource ? '' : ' e confirme o link do criativo (fica no comentário)') + ' pra essa task entrar no disparo.'}
                                  </div>
                                </div>
                                );
                              })() : a.vaBriefing ? (
                                <div className="mt-2 grid gap-2.5">
                                  {/* Resumo enxuto — contagem + AD original, sem ruído técnico.
                                      Download do AD (+ via extensão) vive na action bar 3D do header. */}
                                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="text-text-muted">
                                      <strong className="text-cyan-200">{a.vaBriefing.avatares.length}</strong> avatar{a.vaBriefing.avatares.length === 1 ? '' : 'es'} · <strong className="text-cyan-200">{a.vaBriefing.avatares.length + (a.vaBriefing.depoimentoText ? 1 : 0)}</strong> vídeo{(a.vaBriefing.avatares.length + (a.vaBriefing.depoimentoText ? 1 : 0)) === 1 ? '' : 's'}
                                    </span>
                                    {vaUsesTextEngine(a.taskId) ? (
                                      <span
                                        className="mono inline-flex items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] text-fuchsia-200"
                                        title="Canal orgânico — gera cada parte (hook+body) por texto, sem AD original"
                                      >
                                        Motor TEXTO · {organicChannelLabels(tasks.find((x) => x.id === a.taskId)).join('/')}
                                      </span>
                                    ) : (
                                      <>
                                        {a.vaBriefing.linkAdFilename ? (
                                          <span
                                            className="mono inline-flex max-w-[260px] items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200"
                                            title={a.vaBriefing.linkAdFilename}
                                          >
                                            <span className="truncate">{a.vaBriefing.linkAdFilename}</span>
                                          </span>
                                        ) : null}
                                        {!a.vaBriefing.linkAdFileId ? (
                                          <span className="mono rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">AD não detectado</span>
                                        ) : null}
                                        {vaAdSwapped[a.taskId] ? (
                                          <span className="mono rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] text-lime">✓ AD trocado manual</span>
                                        ) : null}
                                        {/* TROCAR AD — só faz sentido quando JÁ existe AD detectado.
                                          * O AD do copy às vezes vem com áudio CAMUFLADO (fase
                                          * invertida) que não roda no lipsync; abre o painel pra
                                          * colar o link de um AD com áudio LIMPO. Quando NÃO há AD
                                          * detectado o painel já aparece sozinho (não precisa toggle). */}
                                        {a.vaBriefing.linkAdFileId ? (
                                          <button
                                            type="button"
                                            onClick={() => setVaAdOverrideOpen((prev) => ({ ...prev, [a.taskId]: !prev[a.taskId] }))}
                                            disabled={ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued'}
                                            className="mono inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200 transition hover:border-amber-300 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                                            title="AD com áudio CAMUFLADO (fase invertida) não funciona no lipsync — clica pra colar o link de um AD com áudio LIMPO"
                                          >
                                            🔁 {vaAdOverrideOpen[a.taskId] ? 'fechar' : 'trocar AD'}
                                          </button>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                  {/* Avatares */}
                                  <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
                                    Avatares
                                  </div>
                                  {a.vaBriefing.avatares.map((av) => {
                                    const roles = vaRolesOf(av);
                                    const multiRole = roles.length >= 2;
                                    // Motor texto (canal organico + copy no doc): voz opcional (default do avatar).
                                    const avaTextEngine = vaUsesTextEngine(a.taskId);
                                    const avaReady = roles.every((_, ri) => {
                                      const k = vaRoleKey(a.taskId, av.avaCode, ri);
                                      return !!vaAvatarChoice[k] && (!!vaVoiceChoice[k] || avaTextEngine);
                                    });
                                    const anyAvatarMissing = roles.some((_, ri) => !vaAvatarChoice[vaRoleKey(a.taskId, av.avaCode, ri)]);
                                    const pickersLocked = ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued';
                                    const swapKey = `${a.taskId}:${av.avaCode}`;
                                    return (
                                      <div key={av.avaCode} className="rounded-[12px] border border-white/8 bg-white/[0.02] p-2.5 transition-colors hover:border-cyan-400/30">
                                        <div className="flex items-center gap-2">
                                          <span className="mono text-[11px] font-bold tracking-wide text-cyan-200">{av.avaCode}</span>
                                          {avaReady ? (
                                            <span className="mono rounded-full border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-lime">✓ pronto</span>
                                          ) : (
                                            <span className="mono rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-200">{anyAvatarMissing ? 'falta avatar' : 'falta voz'}</span>
                                          )}
                                          {multiRole ? (
                                            <span
                                              className="mono rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-fuchsia-200"
                                              title="AD original tem 2+ avatares: a gente identifica quem fala em cada trecho e manda cada um pro lipsync com o avatar do papel certo"
                                            >
                                              {roles.length} locutores · diarização auto
                                            </span>
                                          ) : null}
                                          {/* 👁 PREVIEW — VA fala o áudio do AD original (não tem
                                            * texto editável como task normal). O olhinho abre o
                                            * player do Drive do AD pra ouvir o que vai ser falado. */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const opening = !vaPreviewOpen[swapKey];
                                              setVaPreviewOpen((prev) => ({ ...prev, [swapKey]: opening }));
                                              // dispara o download do AD na abertura (cache por fileId)
                                              if (opening && a.vaBriefing!.linkAdFileId) ensureVaPreviewMedia(a.vaBriefing!.linkAdFileId);
                                            }}
                                            className={
                                              'ml-auto rounded-full border px-2 py-0.5 text-[11px] shadow-[0_2px_0_rgba(0,0,0,0.4),0_0_8px_rgba(34,211,238,0.3)] active:translate-y-[1px] transition ' +
                                              (vaPreviewOpen[swapKey]
                                                ? 'border-cyan-400/70 bg-cyan-500/25 text-cyan-100'
                                                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/25')
                                            }
                                            title="Preview do que esse avatar vai falar — toca o AD original (o lipsync usa exatamente esse áudio)"
                                          >
                                            👁
                                          </button>
                                        </div>
                                        {/* PAINEL 👁 — player do AD original (Drive, sessão do user).
                                          * Multi-locutor: explica o roteamento por papel; os cortes
                                          * exatos só existem na hora do disparo (diarização). */}
                                        {vaPreviewOpen[swapKey] ? (
                                          <div className="mt-2 rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-3">
                                            <div className="label-tech mb-2 text-[9px] uppercase tracking-widest text-cyan-200">
                                              O que vai ser falado — áudio do AD original{multiRole ? ' · roteado por locutor' : ' · integral'}
                                            </div>
                                            {multiRole ? (
                                              <div className="mb-2 grid gap-1">
                                                <div className="mono text-[9px] text-text-muted/70">
                                                  Confira o vídeo e, no 👁 roxo de cada papel, deixe SÓ o texto que aquele avatar fala. O disparo respeita exatamente isso.
                                                </div>
                                              </div>
                                            ) : null}
                                            {a.vaBriefing!.linkAdFileId ? (() => {
                                              // Player LOCAL: iframe do Drive quebra pra arquivo privado
                                              // (cookie de terceiros bloqueado). Baixamos via extensao
                                              // (fila+streaming, cache por fileId) e tocamos blob.
                                              const media = vaPreviewMedia[a.vaBriefing!.linkAdFileId!];
                                              if (media?.status === 'ready' && media.url) {
                                                return (
                                                  /* eslint-disable-next-line jsx-a11y/media-has-caption */
                                                  <video
                                                    src={media.url}
                                                    controls
                                                    playsInline
                                                    preload="metadata"
                                                    className="max-h-[360px] w-full rounded-[8px] border border-white/10 bg-black"
                                                  />
                                                );
                                              }
                                              if (media?.status === 'error') {
                                                return (
                                                  <div className="rounded-[8px] border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-300">
                                                    ⚠ Falha ao baixar o AD pro preview: {media.error}
                                                    <button
                                                      type="button"
                                                      onClick={() => ensureVaPreviewMedia(a.vaBriefing!.linkAdFileId!)}
                                                      className="mono ml-2 rounded-full border border-red-400/50 px-2 py-0.5 text-[9px] uppercase tracking-widest hover:bg-red-500/15"
                                                    >
                                                      tentar de novo
                                                    </button>
                                                    <a
                                                      href={`https://drive.google.com/file/d/${a.vaBriefing!.linkAdFileId}/view`}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="mono ml-2 rounded-full border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:text-cyan-200"
                                                    >
                                                      abrir no Drive ↗
                                                    </a>
                                                  </div>
                                                );
                                              }
                                              return (
                                                <div className="flex h-[80px] items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-black/40">
                                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-300/70 border-t-transparent" />
                                                  <span className="mono text-[10px] text-cyan-200">{media?.note || 'Preparando preview...'}</span>
                                                </div>
                                              );
                                            })() : (
                                              <div className="rounded-[8px] border border-yellow-500/40 bg-yellow-500/5 p-2 text-[11px] text-yellow-200">
                                                ⚠ AD original ainda não resolvido — escolhe o arquivo no aviso &quot;Escolhe o AD original&quot; abaixo pra liberar o preview.
                                              </div>
                                            )}
                                          </div>
                                        ) : null}
                                        <div className="mt-2 grid gap-2">
                                          {roles.map((role, ri) => {
                                            const choiceKey = vaRoleKey(a.taskId, av.avaCode, ri);
                                            const chosen = vaAvatarChoice[choiceKey] || null;
                                            const voiceChosen = vaVoiceChoice[choiceKey] || null;
                                            const thumbUrl = role.fileId
                                              ? `https://drive.google.com/thumbnail?id=${role.fileId}&sz=w200`
                                              : (ri === 0 ? av.thumbUrl || null : null);
                                            return (
                                              <div key={ri} className={multiRole ? 'rounded-[10px] border border-white/6 bg-white/[0.015] p-2' : ''}>
                                                <div className="flex items-center gap-2.5">
                                                  {thumbUrl ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img src={thumbUrl} alt={role.username} className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/10" referrerPolicy="no-referrer" />
                                                  ) : (
                                                    <div className="h-11 w-11 shrink-0 rounded-full bg-cyan-500/10 flex items-center justify-center mono text-[10px] font-bold text-cyan-300 ring-1 ring-cyan-400/20">{av.avaCode.replace(/^AVA/i, '')}</div>
                                                  )}
                                                  <div className="flex-1 min-w-0">
                                                    {multiRole ? (
                                                      <div className="mono text-[9px] font-bold uppercase tracking-widest text-fuchsia-200">
                                                        {role.role}{role.isDepoimento ? ' · trecho menor' : ' · fala principal'}
                                                      </div>
                                                    ) : null}
                                                    <div className="truncate text-[11px] text-text-muted">@{role.username}</div>
                                                  </div>
                                                  {/* 👁 ROXO: transcrição do que ESTE papel vai falar.
                                                    * Diariza+transcreve o AD 1x por task; cada papel
                                                    * filtra só as falas do locutor mapeado nele. */}
                                                  {(() => {
                                                    const trKey = `${a.taskId}:${av.avaCode}#${ri}`;
                                                    const trFileId = a.vaBriefing!.linkAdFileId;
                                                    return (
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          const opening = !vaTranscriptOpen[trKey];
                                                          setVaTranscriptOpen((prev) => ({ ...prev, [trKey]: opening }));
                                                          if (opening && trFileId) ensureVaTranscript(trFileId, roles.length, a.vaBriefing!.linkCopyDocId);
                                                        }}
                                                        className={
                                                          'shrink-0 rounded-full border px-2 py-0.5 text-[11px] shadow-[0_2px_0_rgba(0,0,0,0.4),0_0_8px_rgba(217,70,239,0.3)] active:translate-y-[1px] transition ' +
                                                          (vaTranscriptOpen[trKey]
                                                            ? 'border-fuchsia-400/70 bg-fuchsia-500/25 text-fuchsia-100'
                                                            : 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/25')
                                                        }
                                                        title={`Transcrição do que ${multiRole ? `o papel ${role.role}` : 'esse avatar'} vai falar (diarização + transcrição do AD original)`}
                                                      >
                                                        👁
                                                      </button>
                                                    );
                                                  })()}
                                                  {role.fileId ? (
                                                    <PilotBtn3D
                                                      icon={<PilotIconDownload size={14} />}
                                                      color="cyan"
                                                      size={30}
                                                      title="Baixar o clipe de referência desse avatar"
                                                      href={`https://drive.google.com/uc?export=download&id=${role.fileId}`}
                                                    />
                                                  ) : (ri === 0 && av.youtubeUrl) ? (
                                                    <a
                                                      href={av.youtubeUrl}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      title="Abrir o vídeo do YouTube (referência pra clonar a voz)"
                                                      className="mono inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                                                    >
                                                      ▶ YouTube
                                                    </a>
                                                  ) : null}
                                                </div>
                                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                  <div>
                                                    <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">Avatar HeyGen{multiRole ? ` · ${role.role}` : ''}</div>
                                                    <CompactAvatarPicker
                                                      selected={chosen}
                                                      setSelected={(newAv) => setVaAvatarChoice((prev) => ({ ...prev, [choiceKey]: newAv }))}
                                                      disabled={pickersLocked}
                                                      label={`Avatar · ${av.avaCode}${multiRole ? `·${role.role}` : ''}`}
                                                    />
                                                  </div>
                                                  <div>
                                                    <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">Voz{avaTextEngine ? ' (opcional)' : ''}</div>
                                                    <CompactVoiceSelector
                                                      selected={voiceChosen}
                                                      setSelected={(v) => setVaVoiceChoice((prev) => ({ ...prev, [choiceKey]: v }))}
                                                    />
                                                  </div>
                                                </div>
                                                {/* APPLY CUSTOM MOTION — o campo de movimento do HeyGen.
                                                    Preenchido = a cena vai no Avatar IV (o III nao aceita
                                                    motion). Vazio = Avatar III, mais barato. */}
                                                {(() => {
                                                  const motion = vaMotionPrompt[choiceKey] || '';
                                                  const on = !!motion.trim();
                                                  return (
                                                    <div className="mt-2">
                                                      <div className="mb-1 flex items-center gap-2">
                                                        <div className="label-tech text-[9px] uppercase tracking-widest text-text-muted">
                                                          Apply Custom Motion
                                                        </div>
                                                        <span
                                                          className={
                                                            'mono rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-widest ' +
                                                            (on
                                                              ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                                                              : 'border-white/10 bg-white/5 text-text-muted')
                                                          }
                                                          title={on
                                                            ? 'Com prompt de movimento a cena sobe pro Avatar IV — e o unico que anima o gesto'
                                                            : 'Sem prompt a cena vai no Avatar III (mais barato, sem gesto inventado)'}
                                                        >
                                                          {on ? 'Avatar IV' : 'Avatar III'}
                                                        </span>
                                                      </div>
                                                      <textarea
                                                        value={motion}
                                                        onChange={(e) => setVaMotionPrompt((prev) => ({ ...prev, [choiceKey]: e.target.value }))}
                                                        disabled={pickersLocked}
                                                        rows={2}
                                                        placeholder="ex.: mexe a gelatina 2x no comeco, apoia a colher e segue falando com as maos soltas"
                                                        className="w-full resize-y rounded-[8px] border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] leading-snug text-text placeholder:text-text-muted/60 focus:border-violet-400/50 focus:outline-none disabled:opacity-50"
                                                      />
                                                      <div className="mt-1 text-[9.5px] leading-tight text-text-muted">
                                                        So pra cena com acao (mexer, despejar, espremer, ninar). Em acao curta,
                                                        peca o gesto <b>uma vez no comeco</b> e a fala solta depois — senao o avatar
                                                        repete o movimento o video inteiro.
                                                      </div>
                                                    </div>
                                                  );
                                                })()}
                                                {/* PAINEL 👁 ROXO — transcrição SÓ das falas deste papel */}
                                                {vaTranscriptOpen[`${a.taskId}:${av.avaCode}#${ri}`] ? (() => {
                                                  const trFileId = a.vaBriefing!.linkAdFileId;
                                                  if (!trFileId) {
                                                    return (
                                                      <div className="mt-2 rounded-[8px] border border-yellow-500/40 bg-yellow-500/5 p-2 text-[11px] text-yellow-200">
                                                        ⚠ AD original não resolvido — escolhe o arquivo no aviso abaixo pra liberar a transcrição.
                                                      </div>
                                                    );
                                                  }
                                                  const tr = vaTranscript[trFileId];
                                                  if (!tr || tr.status === 'loading') {
                                                    return (
                                                      <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5">
                                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-fuchsia-300/70 border-t-transparent" />
                                                        <span className="mono text-[10px] text-fuchsia-200">{tr?.note || 'Preparando transcrição...'}</span>
                                                      </div>
                                                    );
                                                  }
                                                  if (tr.status === 'error') {
                                                    return (
                                                      <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-300">
                                                        ⚠ Transcrição falhou: {tr.error}
                                                        <button
                                                          type="button"
                                                          onClick={() => ensureVaTranscript(trFileId, roles.length, a.vaBriefing!.linkCopyDocId)}
                                                          className="mono ml-2 rounded-full border border-red-400/50 px-2 py-0.5 text-[9px] uppercase tracking-widest hover:bg-red-500/15"
                                                        >
                                                          tentar de novo
                                                        </button>
                                                      </div>
                                                    );
                                                  }
                                                  // ready: TEXTAREA EDITÁVEL por papel. O texto é a FONTE DE
                                                  // VERDADE do roteamento — o user recorta/cola/digita pra dizer
                                                  // exatamente o que ESTE avatar fala. No disparo, o texto é
                                                  // alinhado de volta aos words (timestamps) → o avatar lip-synca
                                                  // SÓ esses trechos do AD original. Zero vazamento, 100% respeitado.
                                                  const rtKey = `${trFileId}:${ri}`;
                                                  const roleText = vaRoleText[rtKey] ?? '';
                                                  // diagnóstico: quantos segundos do AD este papel cobre (alinhado)
                                                  let coverSec = 0;
                                                  if (tr.words?.length && roleText.trim()) {
                                                    const allTexts = roles.map((_, rr) => vaRoleText[`${trFileId}:${rr}`] ?? '');
                                                    const { segments } = alignEditedToWords(tr.words, allTexts, tr.durSec || 0);
                                                    coverSec = segments.filter((s) => s.rank === ri).reduce((a, s) => a + (s.end - s.start), 0);
                                                  }
                                                  return (
                                                    <div className="mt-2 rounded-[8px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-2.5">
                                                      <div className="mono mb-1.5 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-widest text-fuchsia-200">
                                                        <span>O que {multiRole ? role.role : 'esse avatar'} vai falar</span>
                                                        <span className="text-text-muted normal-case tracking-normal">
                                                          {tr.method || 'prévia'}{coverSec > 0 ? ` · cobre ~${coverSec.toFixed(0)}s do AD` : ''}
                                                        </span>
                                                      </div>
                                                      {multiRole ? (
                                                        <div className="mono mb-1.5 rounded border border-cyan-500/40 bg-cyan-500/5 px-2 py-1 text-[9px] text-cyan-200">
                                                          ✏️ EDITÁVEL: deixe aqui SÓ o que o <strong>{role.role}</strong> fala. Recorte/cole entre os papéis. O disparo casa esse texto com o áudio e lip-synca exatamente esses trechos com este avatar.
                                                        </div>
                                                      ) : null}
                                                      <textarea
                                                        value={roleText}
                                                        onChange={(e) => setVaRoleText((prev) => ({ ...prev, [rtKey]: e.target.value }))}
                                                        spellCheck={false}
                                                        rows={Math.min(14, Math.max(4, Math.ceil(roleText.length / 60)))}
                                                        placeholder={multiRole ? `Cole aqui as falas do ${role.role}...` : 'Transcrição...'}
                                                        className="w-full resize-y rounded-[8px] border border-white/12 bg-bg/70 p-2 text-[12px] leading-relaxed text-white/90 outline-none focus:border-fuchsia-400/60"
                                                      />
                                                      {multiRole ? (
                                                        <div className="mono mt-1 flex items-center gap-2 text-[9px] text-text-muted">
                                                          <button
                                                            type="button"
                                                            onClick={() => {
                                                              // restaura a atribuição auto deste papel
                                                              const tt = (tr.utterances || []).filter((_, i) => (tr.autoRanks?.[i] ?? 0) === ri).map((u) => u.text).join(' ').trim();
                                                              setVaRoleText((prev) => ({ ...prev, [rtKey]: tt }));
                                                            }}
                                                            className="rounded-full border border-line-strong px-2 py-0.5 uppercase tracking-widest hover:border-fuchsia-400/60 hover:text-fuchsia-200"
                                                          >
                                                            ↺ restaurar auto
                                                          </button>
                                                          <span>· o texto NÃO vira legenda — só define quem fala o quê</span>
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  );
                                                })() : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {/* AD original nao detectado: lista candidatos (1-click) + input
                                      manual. NAO aparece no motor texto (canal organico nao usa AD). */}
                                  {!vaUsesTextEngine(a.taskId) && (!a.vaBriefing.linkAdFileId || vaAdOverrideOpen[a.taskId]) ? (
                                    <div className="rounded-[10px] border border-yellow-500/40 bg-yellow-500/5 p-3">
                                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-yellow-200">
                                        {a.vaBriefing.linkAdFileId ? '🔁 Trocar AD original (áudio camuflado)' : 'Escolhe o AD original'}
                                      </div>
                                      {a.vaBriefing.linkAdFileId ? (
                                        <div className="mb-2 text-[10px] leading-snug text-amber-200/80">
                                          O AD que o copy apontou pode vir com <strong>áudio camuflado</strong> (fase invertida) que não funciona no lipsync. Cola o link de um AD com <strong>áudio limpo</strong> e clica em aplicar — passa a valer pro preview, transcrição e disparo.
                                        </div>
                                      ) : null}
                                      {(a.vaBriefing as any).candidateLinks && (a.vaBriefing as any).candidateLinks.length > 0 ? (
                                        <div className="mb-2">
                                          <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                                            Links detectados no doc — clica no AD correto:
                                          </div>
                                          <div className="flex flex-col gap-1">
                                            {(a.vaBriefing as any).candidateLinks.map((c: any, ci: number) => (
                                              <button
                                                key={ci}
                                                type="button"
                                                onClick={() => {
                                                  setVaAdUrl((prev) => ({ ...prev, [a.taskId]: `https://drive.google.com/file/d/${c.fileId}/view` }));
                                                  // Tambem grava no briefing pra UI atualizar
                                                  setTaskAnalyses((prev) => {
                                                    const next = { ...prev };
                                                    if (next[a.taskId]?.vaBriefing) {
                                                      next[a.taskId] = { ...next[a.taskId], vaBriefing: { ...next[a.taskId].vaBriefing!, linkAdFileId: c.fileId } } as any;
                                                    }
                                                    return next;
                                                  });
                                                }}
                                                className="mono text-left rounded border border-line-strong bg-bg/40 px-2 py-1 text-[10px] hover:border-lime hover:bg-lime/10 flex items-center gap-2"
                                                title={c.fileId}
                                              >
                                                <span className={c.isFolder ? 'text-yellow-300' : 'text-cyan-200'}>{c.isFolder ? '📁' : '📄'}</span>
                                                <span className="truncate">{c.text || '(sem texto)'}</span>
                                                <span className="ml-auto text-text-muted">usar como AD →</span>
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                      <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                                        Ou cola a URL do Drive:
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="https://drive.google.com/file/d/XXX/view"
                                        value={vaAdUrl[a.taskId] || ''}
                                        onChange={(e) => setVaAdUrl((prev) => ({ ...prev, [a.taskId]: e.target.value }))}
                                        className="input-field font-mono text-xs"
                                        disabled={ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued'}
                                      />
                                      {vaAdUrl[a.taskId] && extractDriveFileId(vaAdUrl[a.taskId]) ? (
                                        <div className="mono mt-1 text-[9px] uppercase tracking-widest text-lime">✓ Drive ID extraido: {extractDriveFileId(vaAdUrl[a.taskId])}</div>
                                      ) : vaAdUrl[a.taskId] ? (
                                        <div className="mono mt-1 text-[9px] uppercase tracking-widest text-red-300">✗ URL invalida — formato esperado: drive.google.com/file/d/XXX/view</div>
                                      ) : null}
                                      {/* APLICAR — grava o fileId em linkAdFileId pra que preview,
                                        * transcrição, diarização E disparo usem o AD limpo. Sem
                                        * clicar aqui, um AD JÁ detectado continua valendo. */}
                                      {extractDriveFileId(vaAdUrl[a.taskId] || '') ? (
                                        <button
                                          type="button"
                                          onClick={() => applyVaAdSwap(a.taskId)}
                                          disabled={ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued'}
                                          className="mono mt-2 w-full rounded border border-lime/50 bg-lime/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-lime transition hover:bg-lime/20 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          ✓ Aplicar troca do AD
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {/* SEM BOTAO "Iniciar Pipeline VA" — VA agora dispara
                                   *  pelo START global e roda na MESMA fila das tasks
                                   *  normais. O progresso + previews de lipsync + download
                                   *  aparecem no card do painel "Tasks em produção" (igual
                                   *  task normal). Aqui so fica a config (avatar/voz/AD). */}
                                  {(() => {
                                    const issues = vaReadinessIssues(a.taskId);
                                    const st = batchStates[a.taskId];
                                    const inQueueOrRunning = !!st && (st.phase === 'queued' || ACTIVE_BATCH_PHASES.includes(st.phase as BatchTaskState['phase']));
                                    if (inQueueOrRunning) {
                                      return (
                                        <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-2.5 mono text-[10px] uppercase tracking-widest text-cyan-200">
                                          📹 Na fila / rodando — acompanhe o card em "Tasks em produção" ↓
                                        </div>
                                      );
                                    }
                                    // Falta avatar/voz/AD: NAO mostra banner — cada linha de
                                    // avatar ja sinaliza (badge 'falta avatar'/'falta voz') e o
                                    // chip 'AD não detectado' cobre o AD. Banner era ruido.
                                    if (issues.length > 0) return null;
                                    return (
                                      <div className="rounded-[10px] border border-lime/40 bg-lime/5 p-2.5 mono text-[10px] uppercase tracking-widest text-lime">
                                        ✓ Pronto — clica START (embaixo) pra disparar junto das outras · {a.vaBriefing.avatares.length} avatar{a.vaBriefing.avatares.length === 1 ? '' : 'es'}
                                      </div>
                                    );
                                  })()}
                                  {/* Hook + body preview */}
                                  {a.vaBriefing.hookText ? (
                                    <details className="rounded-[10px] border border-line bg-bg/40 p-2">
                                      <summary className="label-tech cursor-pointer text-[10px] uppercase tracking-widest text-lime">Gancho</summary>
                                      <div className="mt-1.5 text-[11px] text-text-muted whitespace-pre-wrap">{a.vaBriefing.hookText.slice(0, 400)}{a.vaBriefing.hookText.length > 400 ? '…' : ''}</div>
                                    </details>
                                  ) : null}
                                  {a.vaBriefing.bodyText ? (
                                    <details className="rounded-[10px] border border-line bg-bg/40 p-2">
                                      <summary className="label-tech cursor-pointer text-[10px] uppercase tracking-widest text-fuchsia-300">Corpo</summary>
                                      <div className="mt-1.5 text-[11px] text-text-muted whitespace-pre-wrap">{a.vaBriefing.bodyText}</div>
                                    </details>
                                  ) : null}
                                  {/* Depoimento opcional */}
                                  {a.vaBriefing.depoimentoText ? (
                                    <div className="rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-2">
                                      <div className="label-tech mb-1 text-[10px] tracking-widest text-fuchsia-200 flex items-center gap-2">
                                        <span>🎭 Depoimento com avatar</span>
                                        {a.vaBriefing.depoimentoUsername ? <span className="rounded border border-fuchsia-500/40 px-1.5 py-0.5">@{a.vaBriefing.depoimentoUsername}</span> : null}
                                      </div>
                                      <div className="text-[11px] text-text-muted line-clamp-3">{a.vaBriefing.depoimentoText.slice(0, 280)}{a.vaBriefing.depoimentoText.length > 280 ? '…' : ''}</div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : a.status === 'ready' || a.status === 'partial' ? (
                                <div className="mt-1 grid gap-1 text-text-muted">
                                  <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                    {a.drMillion && sharedSiblings.length > 0 ? (
                                      <span title="Cada gancho vira um vídeo; o corpo é gerado uma vez só e entra nos três.">
                                        {1 + sharedSiblings.length} ganchos + {a.bodyPartsCount} take{(a.bodyPartsCount ?? 0) === 1 ? '' : 's'} de corpo
                                        <span className="text-lime"> · corpo gerado 1x</span>
                                        {onlyMagnificMode ? ' — só copy (B-Rolls)' : ' — Avatar III'}
                                      </span>
                                    ) : (
                                    <span>{a.totalParts} takes ({a.hookCount} hook{(a.hookCount ?? 0) === 1 ? '' : 's'} + {a.bodyPartsCount} body split{(a.bodyPartsCount ?? 0) === 1 ? '' : 's'}){onlyMagnificMode ? ' — só copy (B-Rolls)' : ' — Avatar III'}</span>
                                    )}
                                  </div>
                                  {/* A copy saiu INTEIRA? Um filtro do parser comendo fala
                                   *  não aparece na contagem nem no avatar — só lendo. Aqui
                                   *  o que ficou de fora aparece sozinho, antes do disparo. */}
                                  {a.copyFaltando && a.copyFaltando.length > 0 ? (
                                    <div className="mt-1.5 rounded-[10px] border border-red-500/45 bg-red-500/10 px-3 py-2 text-[10.5px] leading-relaxed text-red-200">
                                      <div className="mono text-[9.5px] uppercase tracking-widest">
                                        ⚠ {a.copyFaltando.length} trecho(s) da copy NÃO entraram em nenhum take
                                      </div>
                                      {a.copyFaltando.slice(0, 3).map((l, i) => (
                                        <div key={i} className="mt-1 opacity-90">“{l.slice(0, 120)}”</div>
                                      ))}
                                      {a.copyFaltando.length > 3 ? (
                                        <div className="mt-1 opacity-70">…e mais {a.copyFaltando.length - 3}</div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {/* Only Magnific: nao gera lipsync — avatares ignorados,
                                   *  so a copy do doc importa. RoleSlots escondidos. */}
                                  {onlyMagnificMode ? (
                                    <div className="mt-1.5 rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2 mono text-[10px] uppercase tracking-widest text-lime">
                                      🍌 Only Magnific — avatares ignorados, so a copy do doc e usada (sem HeyGen)
                                    </div>
                                  ) : (
                                  <div className="mt-1.5 grid gap-2">
                                    <div className="label-tech text-[9.5px] tracking-[0.18em] text-text-muted">
                                      Avatares ({a.roleSlots.length}) — selecione cada um e a voz
                                    </div>
                                    {a.roleSlots.length === 0 ? (
                                      <div className="rounded-[10px] border border-yellow-500/40 bg-yellow-500/5 p-3 text-[11px]">
                                        <div className="mono text-[9px] uppercase tracking-widest text-yellow-200">
                                          ⚠ Nenhum avatar identificado automaticamente
                                        </div>
                                        <div className="mt-1 text-text-muted">
                                          O parser nao achou linha &quot;Avatar:&quot; com @username no doc.
                                          Clica abaixo pra adicionar manualmente e escolher avatar + voz.
                                        </div>
                                      </div>
                                    ) : null}
                                    {a.roleSlots.map((slot, sIdx) => {
                                      const partsCount = (a.partTemplates || []).filter(p => p.matchByRole === slot.role.toLowerCase()).length;
                                      const candFull = slot.avatarId ? avatarCandidates.find(c => c.id === slot.avatarId) : null;
                                      const selected: AvatarOption | null = candFull ? {
                                        id: candFull.id,
                                        name: candFull.name,
                                        thumb: candFull.thumb || null,
                                        videoPreview: null,
                                        type: 'photo',
                                        version: 'III',
                                        groupName: candFull.groupName,
                                        voiceId: candFull.voiceId,
                                        voiceName: candFull.voiceName,
                                      } : null;
                                      const noVoice = slot.imageMode
                                        ? !slot.voiceOverride   // modo imagem: sem avatar, a voz TEM que ser escolhida
                                        : slot.avatarId && !slot.avatarVoiceId && !slot.voiceOverride;
                                      const effectiveVoiceLabel = slot.voiceOverride?.name || (slot.avatarVoiceId ? 'voz padrao do avatar' : noVoice ? 'sem voz' : '?');
                                      const visualKey = `${a.taskId}:${sIdx}`;
                                      const isVisualSearching = visualMatching[visualKey];
                                      // Thumb do briefing: arquivo do Drive OU, quando o avatar
                                      // veio de um smart-chip de YouTube, a thumb do vídeo (assim
                                      // o avatar de link aparece igual aos de arquivo).
                                      const briefingThumbUrl = slot.briefingFileId
                                        ? `https://drive.google.com/thumbnail?id=${slot.briefingFileId}&sz=w200`
                                        : (slot.youtubeThumb || slot.imageThumb || null);
                                      // Rotulo da referência: imagem do doc (print) / YouTube / @username
                                      const refLabel = slot.imageThumb
                                        ? 'imagem do doc'
                                        : (slot.youtubeUrl ? 'ref. YouTube' : `@${slot.username}`);
                                      const refTitle = slot.imageThumb
                                        ? `${slot.role} · imagem do doc`
                                        : (slot.youtubeUrl ? `${slot.role} · YouTube` : `@${slot.username}.mp4`);
                                      return (
                                        <div key={sIdx} className="hover-lift rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_14px_-6px_rgba(0,0,0,0.4)]">
                                          <div className="mono flex flex-wrap items-center gap-2 text-[10px]">
                                            <span className="rounded-full bg-lime/18 border border-lime/40 px-2 py-[3px] text-lime uppercase tracking-widest font-bold">{slot.role}</span>
                                            <span className="text-white/70">{refLabel}</span>
                                            <span className="text-text-muted">· {partsCount} parte{partsCount === 1 ? '' : 's'}</span>
                                            {!slot.matchedBy ? (
                                              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/15 px-2 py-[2px] text-[9px] font-bold uppercase tracking-widest text-red-300">
                                                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                                                Pendente
                                              </span>
                                            ) : slot.matchedBy === 'grupo' ? (
                                              <span
                                                className="ml-1 inline-flex items-center gap-1 rounded-full border border-violet-400/50 bg-violet-500/15 px-2 py-[2px] text-[9px] font-bold uppercase tracking-widest text-violet-200"
                                                title="Mesmo avatar dos outros hooks deste AD — é o que permite reaproveitar o corpo já gerado. Trocar aqui vale só pra este hook."
                                              >
                                                mesmo avatar do AD
                                              </span>
                                            ) : null}
                                            {/* BOTAO 3D: preview da copy que vai pro HeyGen deste avatar.
                                              * Icone-only — abre/fecha painel com textarea editavel das parts
                                              * onde matchByRole === slot.role.toLowerCase(). Permite confirmar
                                              * o que cada avatar vai falar ANTES de disparar. Critico pra pegar
                                              * leaks de indicativo (texto vermelho) que escapou do parser. */}
                                            <button
                                              type="button"
                                              onClick={() => setPreviewOpen((prev) => ({ ...prev, [`${a.taskId}:${sIdx}`]: !prev[`${a.taskId}:${sIdx}`] }))}
                                              className="ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/25 shadow-[0_2px_0_rgba(0,0,0,0.4),0_0_8px_rgba(34,211,238,0.3)] active:translate-y-[1px] active:shadow-[0_1px_0_rgba(0,0,0,0.4)]"
                                              title="Preview do texto que esse avatar vai falar no HeyGen (editavel — corrige se tiver leak de indicativo)"
                                            >
                                              👁
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => removeRoleSlot(a.taskId, sIdx)}
                                              className="rounded-full px-1.5 py-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-300"
                                              title="Remover este slot"
                                            >
                                              ×
                                            </button>
                                          </div>
                                          {/* PAINEL DE PREVIEW POR AVATAR — editavel.
                                            * Mostra TODAS as parts (HOOK/BODY) que matcham por role do slot.
                                            * Cada part tem um textarea independente — user pode ajustar
                                            * o texto exato que vai pro HeyGen antes de disparar.
                                            * Diff visual: texto identico ao que sera enviado, 1:1. */}
                                          {previewOpen[`${a.taskId}:${sIdx}`] ? (
                                            <div className="mt-2 rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-3">
                                              <div className="mono mb-2 text-[9px] uppercase tracking-widest text-cyan-200">
                                                preview do texto pro HeyGen ({slot.role}) — editavel
                                              </div>
                                              {(() => {
                                                // MESMA regra do disparo (ownerSlotIdx): inclui as
                                                // parts órfãs que caem no 1º avatar. Sem isso o
                                                // preview dizia "nenhuma parte" e o HeyGen recebia
                                                // a copy inteira mesmo assim.
                                                const matched = (a.partTemplates || [])
                                                  .map((pt, idx) => ({ pt, idx }))
                                                  .filter(({ pt }) => ownerSlotIdx(a, pt) === sIdx);
                                                if (matched.length === 0) {
                                                  return (
                                                    <div className="rounded-[8px] border border-yellow-500/40 bg-yellow-500/5 p-2 text-[11px] text-yellow-200">
                                                      ⚠ Nenhuma parte foi atribuida a este avatar.
                                                      Ou o parser nao detectou speaker corretamente, ou outro avatar pegou tudo.
                                                    </div>
                                                  );
                                                }
                                                return (
                                                  <div className="grid gap-2">
                                                    {matched.map(({ pt, idx }) => (
                                                      <div key={idx} className="rounded-[8px] border border-line bg-bg/60 p-2">
                                                        <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest">
                                                          <div className="flex min-w-0 items-center gap-2">
                                                            <span className="shrink-0 font-bold text-cyan-300">{pt.label}</span>
                                                            {/* QUEM FALA esse trecho — chip com thumb + avatar/role */}
                                                            <span
                                                              className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-lime/35 bg-lime/10 px-1.5 py-0.5 normal-case tracking-normal text-lime"
                                                              title={`Quem fala: ${slot.role}${selected ? ' → ' + selected.name : ' (avatar ainda não escolhido)'}`}
                                                            >
                                                              {(selected?.thumb || briefingThumbUrl) ? (
                                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                                <img src={(selected?.thumb || briefingThumbUrl)!} alt={slot.role} className="h-4 w-4 rounded-full object-cover" referrerPolicy="no-referrer" />
                                                              ) : (
                                                                <span aria-hidden>🎤</span>
                                                              )}
                                                              <span className="truncate text-[9px] font-semibold">{selected ? selected.name : refLabel}</span>
                                                            </span>
                                                          </div>
                                                          <div className="flex shrink-0 items-center gap-1.5">
                                                            {/* TROCAR QUEM FALA — só com avatar adicionado
                                                              * na mão E 2+ avatares. No B2C (roles vindos do
                                                              * parser) nada disso aparece. */}
                                                            {(a.roleSlots || []).length > 1 &&
                                                            (a.roleSlots || []).some((s) => s.manual) ? (
                                                              <select
                                                                value={slot.role.toLowerCase()}
                                                                onChange={(e) => assignPartToRole(a.taskId, idx, e.target.value)}
                                                                title="Quem fala esse trecho"
                                                                className="mono rounded border border-lime/35 bg-bg/70 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-lime focus:border-lime focus:outline-none"
                                                              >
                                                                {(a.roleSlots || []).map((s) => (
                                                                  <option key={s.role} value={s.role.toLowerCase()}>
                                                                    {s.avatarName || s.role}
                                                                  </option>
                                                                ))}
                                                              </select>
                                                            ) : null}
                                                            <span className="text-text-muted">{pt.text.length}c · {pt.text.split(/\s+/).filter(Boolean).length}p</span>
                                                            {/* EXCLUIR esse card/trecho — nao vai gerar take */}
                                                            <button
                                                              type="button"
                                                              onClick={() => removePartTemplate(a.taskId, idx)}
                                                              title="Excluir esse trecho — não vira take no HeyGen (use pra tirar lixo de produção que sobrou)"
                                                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10 text-red-300 transition hover:border-red-400/70 hover:bg-red-500/25"
                                                            >
                                                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                                                            </button>
                                                          </div>
                                                        </div>
                                                        <textarea
                                                          value={pt.text}
                                                          onChange={(e) => updatePartTemplateText(a.taskId, idx, e.target.value)}
                                                          className="mono w-full resize-y rounded border border-line-strong bg-bg/40 px-2 py-1.5 text-[12px] text-text focus:border-cyan-500/60 focus:outline-none"
                                                          rows={Math.max(3, Math.min(12, pt.text.split('\n').length + 1))}
                                                          spellCheck={false}
                                                          placeholder="(vazio — esse part nao vai gerar nada)"
                                                        />
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()}
                                              <div className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted">
                                                este é o texto EXATO que vai pro avatar — o que você editar aqui é o que dispara.
                                                edita pra corrigir leak, ou × pra remover o trecho inteiro.
                                              </div>
                                            </div>
                                          ) : null}
                                          {/* ═══ PREVIEW AVATAR (thumb maior + info clean) ═══ */}
                                          <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                            <div className="relative shrink-0">
                                              {briefingThumbUrl ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                  src={briefingThumbUrl}
                                                  alt={slot.username}
                                                  className="h-20 w-20 rounded-[12px] object-cover ring-2 ring-white/10 shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
                                                  referrerPolicy="no-referrer"
                                                  loading="lazy"
                                                  decoding="async"
                                                />
                                              ) : (
                                                <div className="flex h-20 w-20 items-center justify-center rounded-[12px] border border-white/12 bg-white/[0.05] text-white/40">
                                                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="12" cy="8" r="4" />
                                                    <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                                                  </svg>
                                                </div>
                                              )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="mono text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/85">
                                                Briefing
                                              </div>
                                              <div className="mt-0.5 text-[13px] font-semibold text-foreground truncate" style={{ fontFamily: 'var(--font-tech)' }}>
                                                {refTitle}
                                              </div>
                                              {slot.briefingFileId ? (
                                                <a
                                                  href={`https://drive.google.com/uc?export=download&id=${slot.briefingFileId}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-lime/45 bg-lime/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-lime hover:bg-lime/22 hover:border-lime/65 transition"
                                                  title="Baixar arquivo do copywriter no Drive"
                                                >
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                                  </svg>
                                                  Baixar
                                                </a>
                                              ) : slot.youtubeUrl ? (
                                                <a
                                                  href={slot.youtubeUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-500/45 bg-red-500/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/22 hover:border-red-500/65 transition"
                                                  title="Abrir o vídeo do YouTube (referência pra clonar a voz)"
                                                >
                                                  ▶ YouTube
                                                </a>
                                              ) : slot.imageThumb ? (
                                                <a
                                                  href={slot.imageThumb}
                                                  download={`print-${slot.role.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.${slot.imageThumb.startsWith('data:image/png') ? 'png' : slot.imageThumb.startsWith('data:image/webp') ? 'webp' : 'jpg'}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-fuchsia-400/45 bg-fuchsia-500/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/22 hover:border-fuchsia-400/65 transition"
                                                  title="Baixar o print do avatar colado no doc — use de referência pra escolher o avatar da biblioteca"
                                                >
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                                  </svg>
                                                  🖼 Baixar print
                                                </a>
                                              ) : (
                                                <span className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] px-2 py-1 text-[9.5px] uppercase tracking-widest text-text-muted">
                                                  sem link
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          {/* ═══ SELETORES (Avatar + Voz) — grid limpo ═══ */}
                                          <div className="mt-2.5 grid gap-2">
                                            {/* BOTÃO 3D — MODO IMAGEM. Liga quando o avatar não existe
                                              * na biblioteca (inclusive rosto que a moderação reprovou,
                                              * caso em que o caminho normal morre no 0x0). Aí em vez de
                                              * escolher avatar, sobe a imagem: o HeyGen anima ela pela
                                              * variante `image`, que dispensa avatar_id. Cada slot tem a
                                              * SUA imagem, então N avatares por AD continuam valendo e a
                                              * montagem junta igual. */}
                                            <button
                                              type="button"
                                              onClick={() => updateRoleSlot(a.taskId, sIdx, { imageMode: !slot.imageMode })}
                                              className="group relative inline-flex items-center gap-2 self-start rounded-[12px] border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all duration-200 hover:-translate-y-[1px] active:translate-y-[1px]"
                                              style={
                                                slot.imageMode
                                                  ? {
                                                      fontFamily: 'var(--font-tech)',
                                                      color: '#12040f',
                                                      borderColor: 'rgba(232,121,249,0.55)',
                                                      background: 'linear-gradient(135deg, #f0abfc 0%, #e879f9 100%)',
                                                      boxShadow:
                                                        '0 3px 0 rgba(0,0,0,0.35), 0 0 20px -6px rgba(232,121,249,0.7), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.2)',
                                                    }
                                                  : {
                                                      fontFamily: 'var(--font-tech)',
                                                      color: 'rgba(255,255,255,0.55)',
                                                      borderColor: 'rgba(255,255,255,0.12)',
                                                      background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
                                                      boxShadow: '0 2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
                                                    }
                                              }
                                              title={
                                                slot.imageMode
                                                  ? 'Ligado: sobe a imagem e o HeyGen anima ela (sem avatar da biblioteca). A fala desta cena sai num take único.'
                                                  : 'Ligue quando o avatar não existir na biblioteca — aí você sobe a imagem em vez de escolher avatar.'
                                              }
                                            >
                                              <span className="text-[12px] leading-none">🖼</span>
                                              Modo imagem
                                              <span
                                                className={
                                                  'rounded-full px-1.5 py-[1px] text-[8.5px] tracking-widest ' +
                                                  (slot.imageMode ? 'bg-black/25 text-black/80' : 'bg-white/8 text-text-muted')
                                                }
                                              >
                                                {slot.imageMode ? 'ON' : 'OFF'}
                                              </span>
                                            </button>
                                            {slot.imageMode ? (
                                              <div className="rounded-[12px] border border-fuchsia-400/35 bg-fuchsia-500/[0.07] p-2.5">
                                                <div className="label-tech mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-fuchsia-200">
                                                  Imagem desta cena (frame inicial)
                                                </div>
                                                <div className="flex items-start gap-2.5">
                                                  {slot.imageDataUrl ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                      src={slot.imageDataUrl}
                                                      alt={slot.imageName || 'frame'}
                                                      className="h-[74px] w-[42px] shrink-0 rounded-[6px] border border-white/15 object-cover"
                                                    />
                                                  ) : null}
                                                  <div className="min-w-0 flex-1">
                                                    <input
                                                      type="file"
                                                      accept="image/jpeg,image/png,image/webp"
                                                      onChange={(e) => {
                                                        const f = e.target.files?.[0];
                                                        if (f) void subirImagemDoSlot(a.taskId, sIdx, f);
                                                        e.target.value = '';
                                                      }}
                                                      className="block w-full text-[10.5px] text-text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-fuchsia-400/45 file:bg-fuchsia-500/12 file:px-2.5 file:py-1 file:text-[9.5px] file:font-bold file:uppercase file:tracking-widest file:text-fuchsia-200 hover:file:bg-fuchsia-500/22"
                                                    />
                                                    <div className="mt-1 text-[9.5px] leading-tight text-text-muted">
                                                      {slot.imageName ? (
                                                        <span className="text-fuchsia-200">{slot.imageName}</span>
                                                      ) : (
                                                        'JPEG, PNG ou WebP · até 8MB · 9:16'
                                                      )}
                                                      {' · '}a fala desta cena sai em <b>take único</b> (sem picotar)
                                                      {' · '}roda no <b>Avatar IV</b> (essa variante não aceita III)
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            ) : (
                                            <div>
                                              <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                  <circle cx="12" cy="8" r="4" />
                                                  <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                                                </svg>
                                                Avatar HeyGen
                                              </div>
                                              <div className="max-w-[420px]">
                                                <CompactAvatarPicker
                                                  selected={selected}
                                                  setSelected={(newAv) => updateRoleSlot(a.taskId, sIdx, {
                                                    avatarId: newAv?.id || null,
                                                    avatarName: newAv?.name || null,
                                                    avatarThumb: newAv?.thumb || null,
                                                    avatarVoiceId: (newAv as any)?.voiceId || null,
                                                    matchedBy: 'manual',
                                                  })}
                                                  disabled={false}
                                                  label={`Avatar pra ${slot.role}`}
                                                />
                                              </div>
                                            </div>
                                            )}
                                            {slot.avatarId || slot.imageMode ? (
                                              <div>
                                                <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                                                  </svg>
                                                  Voz
                                                  <span className={`ml-auto normal-case tracking-normal ${slot.voiceOverride ? 'text-lime' : noVoice ? 'text-red-300' : 'text-text-muted/70'}`}>
                                                    {effectiveVoiceLabel}
                                                  </span>
                                                  {noVoice && !slot.voiceOverride ? (
                                                    <span className="rounded-full border border-red-400/50 bg-red-500/15 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-widest text-red-300">
                                                      ⚠ escolha
                                                    </span>
                                                  ) : null}
                                                </div>
                                                <CompactVoiceSelector
                                                  selected={slot.voiceOverride}
                                                  setSelected={(v) => updateRoleSlot(a.taskId, sIdx, { voiceOverride: v })}
                                                />
                                              </div>
                                            ) : null}
                                            {/* APPLY CUSTOM MOTION — o campo de movimento do HeyGen.
                                                No DR MILLION cada cena do AD é um avatar próprio, então
                                                o gesto é por avatar: preenchido, ESTA cena sobe pro
                                                Avatar IV (o III descarta motion); vazio, segue no III,
                                                que é mais barato e não inventa gesto. */}
                                            {slot.avatarId || slot.imageMode ? (() => {
                                              const motion = slot.motionPrompt || '';
                                              const on = !!motion.trim();
                                              return (
                                                <div>
                                                  <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                      <path d="M13 2L4.09 12.97a1 1 0 0 0 .77 1.64H11l-1 7.39 8.91-10.97a1 1 0 0 0-.77-1.64H12l1-7.39z" />
                                                    </svg>
                                                    Apply Custom Motion
                                                    {/* MOTOR DESTA CENA. "auto" = III, ou IV se tiver
                                                      * gesto. Escolher na mão vence — mas cena com
                                                      * gesto nunca desce pro III (o runner sobe), senão
                                                      * o take voltaria parado. */}
                                                    <div className="ml-auto flex items-center gap-1">
                                                      {(['auto', 'III', 'IV', 'V'] as const).map((op) => {
                                                        const sel = (slot.engine || 'auto') === op;
                                                        // o que sai de fato quando está em auto
                                                        const efetivo = slot.engine || (on ? 'IV' : 'III');
                                                        const subiu = op === 'auto' && on;
                                                        return (
                                                          <button
                                                            key={op}
                                                            type="button"
                                                            onClick={() => updateRoleSlot(a.taskId, sIdx, {
                                                              engine: op === 'auto' ? undefined : op,
                                                            })}
                                                            className={
                                                              'mono rounded-full border px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-widest transition ' +
                                                              (sel
                                                                ? 'border-violet-400/60 bg-violet-500/25 text-violet-100'
                                                                : 'border-white/10 bg-white/5 text-text-muted hover:border-violet-400/40')
                                                            }
                                                            title={
                                                              op === 'auto'
                                                                ? `Automático: ${efetivo} (sem gesto = III; com gesto sobe pro IV)`
                                                                : op === 'III'
                                                                  ? 'Avatar III — mais barato, NÃO anima gesto'
                                                                  : `Avatar ${op} — anima o movimento`
                                                            }
                                                          >
                                                            {op === 'auto' ? (subiu ? 'auto·IV' : 'auto·III') : op}
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                  <textarea
                                                    value={motion}
                                                    onChange={(e) => updateRoleSlot(a.taskId, sIdx, { motionPrompt: e.target.value })}
                                                    rows={2}
                                                    placeholder="ex.: mexe a gelatina 2x no comeco, apoia a colher e segue falando com as maos soltas"
                                                    className="w-full resize-y rounded-[8px] border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] leading-snug text-text placeholder:text-text-muted/60 focus:border-violet-400/50 focus:outline-none"
                                                  />
                                                  <div className="mt-1 text-[9.5px] leading-tight text-text-muted">
                                                    So pra cena com acao (mexer, despejar, espremer, ninar). Em acao curta,
                                                    peca o gesto <b>uma vez no comeco</b> e a fala solta depois — senao o avatar
                                                    repete o movimento o video inteiro.
                                                  </div>
                                                </div>
                                              );
                                            })() : null}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* ADICIONAR AVATAR NA MÃO.
                                      *  Já existiu e foi removido porque avatar manual ficava ÓRFÃO
                                      *  ("nunca vai bater com texto nenhum"): as parts do doc não
                                      *  tinham role pra casar com ele. A causa era o preview filtrar
                                      *  só por role igual — o disparo (buildPlan) SEMPRE mandou o
                                      *  órfão pro 1º avatar. Agora os dois leem de ownerSlotIdx,
                                      *  então: 1 avatar = fala a copy inteira; 2+ = cada trecho ganha
                                      *  seletor de quem fala. Volta a fazer sentido — e é o caso
                                      *  normal do DR MILLION, onde o avatar não vem no doc porque é
                                      *  o do anúncio que está sendo modelado. */}
                                    <button
                                      type="button"
                                      onClick={() => addManualRoleSlot(a.taskId)}
                                      className="group relative mt-1 inline-flex items-center gap-2 self-start rounded-[12px] border border-lime/55 px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-black transition-all duration-200 hover:-translate-y-[1px] active:translate-y-[1px]"
                                      style={{
                                        fontFamily: 'var(--font-tech)',
                                        background: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
                                        boxShadow:
                                          '0 3px 0 rgba(0,0,0,0.35), 0 0 20px -6px rgba(200,232,124,0.65), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.2)',
                                      }}
                                      title={
                                        a.roleSlots.length === 0
                                          ? 'Adiciona um avatar na mão — ele fala a copy inteira'
                                          : 'Adiciona outro avatar — aí você escolhe o que cada um fala'
                                      }
                                    >
                                      <span className="text-[13px] leading-none">+</span>
                                      {a.roleSlots.length === 0
                                        ? 'Adicionar avatar'
                                        : 'Adicionar outro avatar'}
                                    </button>
                                    {a.roleSlots.length === 1 && a.roleSlots[0]?.manual ? (
                                      <div className="mono text-[9.5px] uppercase tracking-widest text-lime/80">
                                        ✓ esse avatar fala a copy inteira ({(a.partTemplates || []).length} trechos)
                                      </div>
                                    ) : null}
                                    {a.roleSlots.length > 1 && a.roleSlots.some((s) => s.manual) ? (
                                      <div className="mono text-[9.5px] normal-case tracking-normal text-text-muted">
                                        Abra o 👁 de cada avatar pra escolher, trecho a trecho, quem fala o quê.
                                      </div>
                                    ) : null}
                                  </div>
                                  )}
                                </div>
                              ) : null}
                              {a.status === 'error' ? (
                                <div className="mt-1 text-red-300">{a.error}</div>
                              ) : null}
                              {a.status === 'analyzing' ? (
                                <div className="mt-1 text-text-muted">analisando...</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {/* ═══ CARREGAR PLANO — monta as cenas por DADOS ═══
                        * Existe porque montar 47 cenas clicando erra: os rótulos
                        * do seletor se repetem e já cruzaram avatar entre ADs. */}
                      <div className="mt-3 rounded-[14px] border border-cyan-500/35 bg-cyan-500/[0.06] p-3">
                        <button
                          type="button"
                          onClick={() => setPlanoAberto((v) => !v)}
                          className="mono flex w-full items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200"
                        >
                          <span className="text-[13px] leading-none">{planoAberto ? '▾' : '▸'}</span>
                          Carregar plano de cenas
                          <span className="ml-auto normal-case tracking-normal text-text-muted">
                            monta avatar + voz + movimento de uma vez
                          </span>
                        </button>
                        {planoAberto ? (
                          <div className="mt-2.5 grid gap-2">
                            <textarea
                              value={planoTexto}
                              onChange={(e) => setPlanoTexto(e.target.value)}
                              rows={5}
                              placeholder='Cole o JSON do plano — {"AD37":[{"cena":"AD37_1","n":1,"avatarId":"...","voiceId":"...","motionPrompt":null,"modoImagem":false}, ...]}'
                              className="w-full resize-y rounded-[8px] border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-[10.5px] leading-snug text-text placeholder:text-text-muted/60 focus:border-cyan-400/50 focus:outline-none"
                            />
                            <div>
                              <div className="label-tech mb-1 text-[9px] uppercase tracking-[0.16em] text-text-muted">
                                Frames das cenas em modo imagem (opcional — só as bloqueadas)
                              </div>
                              <input
                                type="file"
                                multiple
                                accept="image/jpeg,image/png,image/webp"
                                onChange={async (e) => {
                                  const fs = Array.from(e.target.files || []);
                                  const novo: Record<string, string> = {};
                                  for (const f of fs) {
                                    // casa pelo nome do arquivo: AD39_1.jpg -> cena AD39_1
                                    const cena = f.name.replace(/\.[^.]+$/, '');
                                    novo[cena] = await new Promise<string>((res) => {
                                      const fr = new FileReader();
                                      fr.onload = () => res(String(fr.result || ''));
                                      fr.readAsDataURL(f);
                                    });
                                  }
                                  setPlanoImagens((p) => ({ ...p, ...novo }));
                                  e.target.value = '';
                                }}
                                className="block w-full text-[10.5px] text-text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-cyan-500/45 file:bg-cyan-500/12 file:px-2.5 file:py-1 file:text-[9.5px] file:font-bold file:uppercase file:tracking-widest file:text-cyan-200"
                              />
                              {Object.keys(planoImagens).length > 0 ? (
                                <div className="mono mt-1 text-[9.5px] text-cyan-200">
                                  {Object.keys(planoImagens).length} frame(s): {Object.keys(planoImagens).sort().join(', ')}
                                </div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={aplicarPlano}
                              disabled={!planoTexto.trim()}
                              className="mono self-start rounded-full border border-cyan-500/50 bg-cyan-500/15 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-40"
                            >
                              Aplicar plano
                            </button>
                            {planoRelato ? (
                              <div className="rounded-[8px] border border-line bg-bg/60 p-2 text-[10.5px] leading-relaxed text-text-muted">
                                {planoRelato.map((l, i) => (
                                  <div key={i} className={/⚠/.test(l) ? 'text-yellow-200' : ''}>{l}</div>
                                ))}
                              </div>
                            ) : null}
                            <div className="text-[9.5px] leading-tight text-text-muted">
                              Reparte os takes entre as cenas na ordem (hook na cena 1) — é um
                              ponto de partida: abra o 👁 de cada cena pra ajustar o corte antes de disparar.
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* Start batch — abaixo da lista, mais perto das tasks ready (CTA principal).
                       *  Usa selectedTaskIds porque startBatch filtra por isso — UI tem que bater. */}
                      {(() => {
                        const selected = Array.from(selectedTaskIds);
                        // Criterio UNICO: bate com o startBatch (VA por avatares,
                        // troca por WHITE+fonte, normais por status).
                        const readyIds = selected.filter(isTaskDispatchable);
                        const partialIds = selected.filter(
                          (id) => !isTaskDispatchable(id) && (taskAnalyses[id]?.status === 'ready' || taskAnalyses[id]?.status === 'partial'),
                        );
                        if (readyIds.length === 0 && partialIds.length === 0) return null;
                        return (
                          <div className="sticky bottom-2 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-lime/40 bg-bg/95 p-3 shadow-[0_0_30px_-10px_rgba(200,232,124,0.4)] backdrop-blur">
                            <span className="mono text-[11px] text-text-muted">
                              {readyIds.length > 0 ? (
                                <span className="text-lime">✓ {readyIds.length} ready</span>
                              ) : null}
                              {readyIds.length > 0 && partialIds.length > 0 ? <span className="text-text-muted"> · </span> : null}
                              {partialIds.length > 0 ? (
                                <span className="text-yellow-300">⚠ {partialIds.length} pendente{partialIds.length === 1 ? '' : 's'} (resolva acima pra incluir)</span>
                              ) : null}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={copyAllSelectedBodies}
                                className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-[11px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20"
                                title="Copia o body de TODAS as tasks selecionadas, identificado por AD. Nunca inclui Variacao de Avatar."
                              >
                                {copiedAllBodies ? '✓ bodies copiados' : '⧉ Copiar todos os bodies'}
                              </button>
                              <button
                                type="button"
                                onClick={startBatch}
                                disabled={readyIds.length === 0}
                                className="btn-primary disabled:opacity-40"
                                title={readyIds.length === 0 ? 'Nenhuma task ready ainda' : 'Roda em background: TTS + upload + submit + poll + zip'}
                              >
                                ▶ Iniciar {readyIds.length} task{readyIds.length === 1 ? '' : 's'} em background
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Detalhe da task selecionada (so em modo single, nao bulk) */}
              {!bulkMode && selectedTask ? (
                <section className="rounded-[12px] border border-line bg-bg-soft/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="mono text-sm uppercase tracking-widest text-lime">
                      {selectedTask.name}
                    </h3>
                    <a
                      href={selectedTask.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                    >
                      Abrir no ClickUp ↗
                    </a>
                  </div>

                  {/* Doc links da description */}
                  {(() => {
                    const links = extractDocLinks(taskDetail?.description || taskDetail?.text_content);
                    if (links.length === 0) return (
                      <div className="text-[11px] text-text-muted">
                        {taskDetail ? 'Nenhum link de doc detectado na descricao da task.' : 'Carregando descricao...'}
                      </div>
                    );
                    return (
                      <div className="mb-3">
                        <div className="label-tech mb-1 text-[10px] uppercase tracking-widest text-text-muted">
                          Docs encontrados:
                        </div>
                        <ul className="grid gap-1.5">
                          {links.map((u) => {
                            const isGdocs = /docs\.google\.com/.test(u);
                            return (
                              <li key={u} className="flex flex-wrap items-center gap-2 text-[11px]">
                                <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-lime hover:underline">
                                  {u.length > 80 ? u.slice(0, 80) + '…' : u}
                                </a>
                                {isGdocs ? (
                                  <button
                                    type="button"
                                    onClick={() => autoFetchDoc(u)}
                                    disabled={fetchingDoc}
                                    className="mono shrink-0 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:border-fuchsia-500 hover:bg-fuchsia-500/20 disabled:opacity-50"
                                    title="A gente só lê o doc, nunca edita. Ele precisa estar como 'Qualquer pessoa com o link pode ver'."
                                  >
                                    {fetchingDoc ? 'Buscando...' : '⬇ Buscar automatico'}
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                        <div className="label-tech mt-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                          Auto-fetch funciona se doc estiver com sharing 'qualquer pessoa com link pode ver'. Senao, cola manualmente abaixo.
                        </div>
                      </div>
                    );
                  })()}

                  <div className="mb-2 label-tech text-[10px] uppercase tracking-widest text-text-muted">
                    OU cola aqui o conteudo (Ctrl+A → Ctrl+C no Google Docs)
                  </div>
                  <textarea
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    rows={8}
                    placeholder="Briefing completo do doc Google. A gente acha a seção desse AD pelo nome."
                    className="input-field resize-y font-mono text-xs"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runParser()}
                      disabled={!docContent.trim()}
                      className="btn-primary"
                    >
                      Parsear copy
                    </button>
                    {docContent.length > 0 ? (
                      <span className="mono self-center text-[10px] text-text-muted">
                        {docContent.length} chars carregados
                      </span>
                    ) : null}
                  </div>

                  {parseError ? (
                    <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                      {parseError}
                    </div>
                  ) : null}

                  {briefing ? (
                    <div className="mt-4 rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-3">
                      <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200">
                        ✓ Briefing DARKO LAB: {briefing.baseAdId} ({briefing.gSiblings.length} G siblings)
                      </div>
                      <div className="mt-2 grid gap-2">
                        <div className="text-[11px]">
                          <strong className="text-white">Avatares ({briefing.avatars.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {briefing.avatars.map((a) => {
                              const m = matchAvatar(a.username, avatarCandidates);
                              const ok = m && m.score >= 30;
                              return (
                                <li key={a.username} className="mono text-[11px]">
                                  {ok ? (
                                    <span className="text-lime">✓ {a.role}: @{a.username} → {m.name} ({m.groupName})</span>
                                  ) : (
                                    <span className="text-red-300">✗ {a.role}: @{a.username} — pendente</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        <div className="text-[11px]">
                          <strong className="text-white">Hooks ({briefing.hooks.length} {briefing.hooks.length === 1 ? 'hook' : 'hooks'}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {briefing.hooks.map((h, i) => (
                              <li key={i} className="rounded border border-line bg-bg/40 px-2 py-1">
                                <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200 flex items-center gap-2">
                                  <span>{h.label} (de G{h.sourceG})</span>
                                  {h.role ? (
                                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200">fala: {h.role}</span>
                                  ) : (
                                    <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-yellow-200">sem role</span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-text-muted line-clamp-2">{h.text.slice(0, 200)}{h.text.length > 200 ? '…' : ''}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {briefing.body ? (
                          <div className="text-[11px]">
                            <strong className="text-white flex items-center gap-2">
                              <span>Body (split em ~20s no Avatar III):</span>
                              {briefing.bodyRole ? (
                                <span className="mono rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200">fala: {briefing.bodyRole}</span>
                              ) : (
                                <span className="mono rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-200">sem role</span>
                              )}
                            </strong>
                            <div className="mt-1 rounded border border-line bg-bg/40 px-2 py-1">
                              <div className="text-text-muted line-clamp-3">{briefing.body.slice(0, 280)}{briefing.body.length > 280 ? '…' : ''}</div>
                              <div className="mono mt-1 text-[10px] text-text-muted">
                                {briefing.body.length} chars — split estimado em {splitCopyIntoParts(briefing.body, {targetSec: 20, minSec: 10, maxSec: 35}).length} takes
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-text-muted">
                            ⚠ Sem body neste briefing — so hooks viram lipsync.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {parsed && !briefing ? (
                    <div className="mt-4 rounded-[10px] border border-lime/30 bg-lime/5 p-3">
                      <div className="mono text-[10px] uppercase tracking-widest text-lime">
                        ✓ Parsed (legacy): {parsed.adId}
                      </div>

                      <div className="mt-3 grid gap-2">
                        <div className="text-[11px]">
                          <strong className="text-white">Avatares detectados ({parsed.avatars.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {parsed.avatars.map((a) => {
                              const m = matchAvatar(a.username, avatarCandidates);
                              const matched = m && m.score >= 30;
                              return (
                                <li key={a.username} className="mono text-[11px]">
                                  {matched ? (
                                    <span className="text-lime">✓ {a.role}: @{a.username} → {m.name} ({m.groupName})</span>
                                  ) : (
                                    <span className="text-red-300">✗ {a.role}: @{a.username} — sem match no HeyGen (avatar pendente)</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        <div className="text-[11px]">
                          <strong className="text-white">Partes detectadas ({parsed.parts.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {parsed.parts.map((p, i) => (
                              <li key={i} className="rounded border border-line bg-bg/40 px-2 py-1">
                                <div className="mono text-[10px] uppercase tracking-widest text-lime">{p.label}</div>
                                <div className="mt-0.5 text-text-muted line-clamp-2">{p.text.slice(0, 200)}{p.text.length > 200 ? '…' : ''}</div>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {dispatchPlan ? (
                          <div className="text-[11px]">
                            <strong className="text-white">Plano de dispatch:</strong>
                            <ul className="mt-1 grid gap-1">
                              {dispatchPlan.parts.map((p, i) => (
                                <li key={i} className="mono">
                                  parte{i + 1} ({p.label}) → {p.avatarName || <span className="text-red-300">SEM AVATAR</span>}
                                </li>
                              ))}
                            </ul>
                            {dispatchPlan.unmatchedAvatars.length > 0 ? (
                              <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                                ⚠ Avatares pendentes (criar no HeyGen primeiro): {dispatchPlan.unmatchedAvatars.join(', ')}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={dispatchToHeyGenAuto}
                              disabled={dispatchPlan.parts.some((p) => !p.avatarId)}
                              className="btn-primary mt-3"
                              title={dispatchPlan.parts.some((p) => !p.avatarId)
                                ? 'Resolva os avatares pendentes primeiro'
                                : 'Abre Hey Auto Dynamic com tudo pre-preenchido'}
                            >
                              ▶ Disparar via Hey Auto Dynamic (motor III)
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
      </ToolShell>
      {/* Modal pra editar 1 take e re-gerar so essa parte */}
      {editingPart ? (
        <EditPartModal
          input={{
            label: editingPart.label,
            text: editingPart.currentText,
            avatarName: editAvatar?.name,
            voiceId: editVoice?.id ?? null,
            voiceName: editVoice?.name ?? null,
          }}
          busy={!!regeneratingPart}
          errorMsg={regenError}
          onClose={() => {
            // Fechar SEMPRE liberado — a re-geração roda em BACKGROUND (o card mostra o
            // progresso da parte). Antes, enquanto 'busy', o fechar era no-op e o modal
            // ficava PRESO na tela até o poll de 25min terminar (user reportou 2026-07-01).
            setEditingPart(null);
            setEditAvatar(null);
            setEditVoice(null);
            setRegenError(null);
          }}
          onRegenerate={(newText) => void regenerateSinglePart(newText)}
          avatarPicker={
            <CompactAvatarPicker
              selected={editAvatar}
              setSelected={(a) => setEditAvatar(a)}
              disabled={!!regeneratingPart}
              label={`Avatar pra ${editingPart.label}`}
            />
          }
          voicePicker={
            <CompactVoiceSelector
              selected={editVoice}
              setSelected={(v) => setEditVoice(v)}
            />
          }
        />
      ) : null}
    </>
  );
}
