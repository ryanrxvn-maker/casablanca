/**
 * Runner de jobs HeyGen com paralelismo. Extraido de page.tsx pra evitar
 * ambiguidade SWC (Array<...> em TSX confunde com JSX).
 */
import {
  processJob,
  isQuotaError,
  type EngineKey,
  type ProcessJobInput,
} from './heygen-api-direct';
import { motorEfetivo } from './heygen-motion-motor';

export type RunnerJob = {
  label: string;
  copy?: string;
  audio?: File;
  /** Modo dinamico: avatarId override por parte (cai pra opts.avatarId se ausente) */
  avatarId?: string;
  /** Modo dinamico: voiceId override por parte (cai pra opts.voiceId se ausente) */
  voiceId?: string;
  /** Override de motor por job — vence opts.motor. Permite mix de
   *  III/IV/V dentro do mesmo batch (config 'percent' ou 'individual'). */
  motor?: 'III' | 'IV' | 'V';
  /** Espelhamento de Voz por job (modo audio): re-sintetiza o audio na voz
   *  alvo (voiceId) via STS. Vence opts.voiceMirroring. Usado pela FILA, que
   *  define o flag por parte. */
  voiceMirroring?: boolean;
  /** APPLY CUSTOM MOTION — prompt de movimento desta cena (mexer a gelatina,
   *  espremer o limao, ninar o bebe). Preenchido, o job SOBE de motor
   *  sozinho: o Avatar III ignora motion, entao mandar gesto nele seria
   *  gerar um take parado sem avisar ninguem. Ver motorEfetivo(). */
  motionPrompt?: string | null;
  /** MODO IMAGEM — data URL da imagem a animar. Quando presente, este job NÃO
   *  usa avatar da biblioteca: sobe pela variante `image` do /v3/videos, que
   *  não precisa de `avatar_id`. O `videoId` que volta é pollável e baixável
   *  pelo MESMO pipeline (confirmado: aparece em /v1/project/items com
   *  video_url), então só o submit muda — poll, download e montagem seguem
   *  iguais. Exige `voiceId`: sem avatar não há voz padrão pra herdar. */
  imageDataUrl?: string | null;
};

export type RunnerResult = {
  index: number;
  label: string;
  videoId: string | null;
  error: string | null;
};

export type RunnerOptions = {
  parallel: number;
  mode: 'copy' | 'audio';
  avatarId: string;
  voiceId?: string;
  /** Espelhamento de Voz (modo audio): quando true E houver voiceId, o HeyGen
   *  re-sintetiza o audio enviado na voz alvo (STS / sts_pending) — mesma coisa
   *  do VA no ClickUp Pilot. Sem isso (ou sem voiceId), o audio vai como está
   *  (voz original). Só vale pra mode 'audio'. */
  voiceMirroring?: boolean;
  motor: 'III' | 'IV' | 'V';
  adNameSafe: string;
  isCancelled: () => boolean;
  onProgress: (msg: string) => void;
  onResult: (result: RunnerResult) => void;
};

function motorToEngine(m: 'III' | 'IV' | 'V'): EngineKey {
  if (m === 'III') return 'iii';
  if (m === 'IV') return 'iv';
  return 'v';
}

export async function runHeyGenJobs(
  jobs: RunnerJob[],
  opts: RunnerOptions,
): Promise<RunnerResult[]> {
  const results: RunnerResult[] = new Array(jobs.length);
  let cursor = 0;
  // FAIL-FAST DE COTA (fix 2026-07-03): quando o HeyGen devolve limite DIÁRIO
  // (429/quota — isQuotaError), todos os jobs restantes vão falhar igual. Sem
  // isto, os 3 workers submetiam os N jobs inteiros contra a cota morta (AD45GL:
  // 10 submits em 1s) — barulho, rate-limit e nenhum ganho. Ao detectar cota,
  // pickNext para de entregar jobs; os não-disparados são marcados com o MESMO
  // erro de cota (não podem ficar undefined — o caller faz results.filter(r=>...)).
  let quotaHit = false;
  /**
   * FILA DE UM PRO MODO IMAGEM.
   *
   * O modo imagem é o único caminho que autentica por OAuth, e o HeyGen
   * ROTACIONA o refresh a cada renovação: a primeira chamada troca o token e
   * INVALIDA o anterior. Com os 3 workers submetendo ao mesmo tempo, as outras
   * duas chegam com um refresh já morto — `invalid_grant` — e ainda podem
   * gravar por cima do token bom, deixando a conta sem credencial válida.
   * Isso derrubou AD39/AD43 inteiros no lote WL PL.
   *
   * Serializar SÓ o modo imagem: os takes de avatar continuam 3 em paralelo,
   * porque vão pela extensão e não tocam no OAuth.
   */
  let filaImagem: Promise<unknown> = Promise.resolve();
  function emSerie<T>(fn: () => Promise<T>): Promise<T> {
    const proxima = filaImagem.then(fn, fn);
    filaImagem = proxima.catch(() => {});
    return proxima;
  }

  function pickNext(): number {
    if (opts.isCancelled() || quotaHit) return -1;
    return cursor < jobs.length ? cursor++ : -1;
  }

  async function worker(): Promise<void> {
    while (true) {
      const idx = pickNext();
      if (idx < 0) return;
      const job = jobs[idx];
      const label = job.label;
      try {
        opts.onProgress(`Disparando ${label} (${idx + 1}/${jobs.length})...`);
        // Per-job override (modo dinamico) > opts global > undefined (lookup auto)
        const effectiveAvatarId = job.avatarId || opts.avatarId;
        const effectiveVoiceId = job.voiceId || opts.voiceId;
        const motion = (job.motionPrompt || '').trim();
        // Cena com gesto sobe pro Avatar IV sozinha (o III descarta motion).
        const effectiveMotor = motorEfetivo(job.motor || opts.motor, motion);
        // ESPELHAMENTO DE VOZ (modo audio): liga SÓ quando pedido E há voz alvo.
        // Sem isso o audio vai como está (voz original). Em copy o voiceId é a
        // voz do TTS (sem mirror).
        const mirror =
          opts.mode === 'audio' &&
          !!(job.voiceMirroring ?? opts.voiceMirroring) &&
          !!effectiveVoiceId;
        // ===== MODO IMAGEM: variante `image` do /v3/videos, sem avatar =====
        // Sai por uma rota de servidor porque o /v3 exige X-Api-Key (medido:
        // cookie de sessão devolve 401), e key nunca vai pro browser.
        if (job.imageDataUrl) {
          if (!effectiveVoiceId) {
            throw new Error(
              `${label}: modo imagem exige uma voz escolhida — sem avatar não há voz padrão pra herdar.`,
            );
          }
          opts.onProgress(
            `${label}: modo imagem${motion ? ' + movimento' : ''} — anima a imagem (sem avatar)`,
          );
          const blob = await (await fetch(job.imageDataUrl)).blob();
          const fd = new FormData();
          fd.append('image', blob, 'frame.jpg');
          fd.append('script', job.copy || '');
          fd.append('voiceId', effectiveVoiceId);
          if (motion) fd.append('motionPrompt', motion);
          fd.append('title', `${opts.adNameSafe}_${label}`);
          fd.append('aspectRatio', '9:16');
          // uma de cada vez: a rotação do refresh não tolera concorrência
          const j = await emSerie(async () => {
            const r = await fetch('/api/heygen/image-video', { method: 'POST', body: fd });
            const body = await r.json().catch(() => null);
            if (!r.ok || !body?.videoId) {
              throw new Error(body?.error || `Falha no modo imagem (HTTP ${r.status}).`);
            }
            return body as { videoId: string };
          });
          results[idx] = { index: idx + 1, label, videoId: j.videoId, error: null };
        } else {

        const input: ProcessJobInput = {
          file: opts.mode === 'audio' ? job.audio : undefined,
          text: opts.mode === 'copy' ? job.copy : undefined,
          // copy: voz do TTS; audio: só passa voiceId quando vai espelhar.
          voiceId:
            opts.mode === 'copy'
              ? effectiveVoiceId
              : (mirror ? effectiveVoiceId : undefined),
          voiceMirroring: mirror || undefined,
          title: `${opts.adNameSafe}_${label}`,
          avatarId: effectiveAvatarId,
          engine: motorToEngine(effectiveMotor),
          orientation: 'portrait',
          motionPrompt: motion || undefined,
        };
        if (motion) {
          opts.onProgress(`${label}: movimento ligado — Avatar ${effectiveMotor}`);
        }
        const result = await processJob(input, {
          onProgress: (stage) => opts.onProgress(`${label}: ${stage}`),
        });
        results[idx] = {
          index: idx + 1,
          label,
          videoId: result.videoId,
          error: null,
        };
        }
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        // Cota diária estourada → sinaliza pros outros workers pararem de pegar
        // jobs novos (fail-fast). O erro deste job segue registrado normalmente.
        if (isQuotaError(msg)) quotaHit = true;
        results[idx] = {
          index: idx + 1,
          label,
          videoId: null,
          error: msg,
        };
        console.error(`[HeyGen Runner] Job ${label} falhou:`, e);
      }
      opts.onResult(results[idx]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < opts.parallel; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  // Preenche jobs NÃO-disparados (cortados pelo fail-fast de cota) com o mesmo
  // erro — nunca deixa entrada undefined (o caller faz results.filter(r=>r.error)).
  if (quotaHit) {
    for (let i = 0; i < jobs.length; i++) {
      if (!results[i]) {
        results[i] = { index: i + 1, label: jobs[i].label, videoId: null, error: 'Limite diário do HeyGen atingido (não disparado — cota esgotada)' };
        opts.onResult(results[i]);
      }
    }
  }
  return results;
}
