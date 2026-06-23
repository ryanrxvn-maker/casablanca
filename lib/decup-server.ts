/**
 * lib/decup-server.ts — ponte server-side pro worker Modal de decupagem.
 *
 * O worker (modal/decupagem.py) roda ffmpeg NATIVO num container com RAM de
 * verdade — processa vídeo de 1.5GB que o ffmpeg-wasm do navegador não aguenta.
 *
 * Fluxo:
 *  1. /ticket  → emite ticket de upload descartável (HMAC) pro browser subir o
 *                arquivo grande DIRETO no Modal /up (sem tocar a Vercel).
 *  2. /start   → manda o Modal decupar (vídeo já no /up) e devolve job token.
 *  3. /status  → consulta o Modal e devolve a URL de download quando pronto.
 *
 * Segredos (env na Vercel, espelham o secret `casablanca-decup` no Modal):
 *  - DECUP_KEY            — token mestre (só o servidor chama /decupar).
 *  - DECUP_UPLOAD_SECRET  — HMAC dos tickets de upload.
 *  - DECUP_MODAL_BASE     — URL do worker (default abaixo).
 */

import crypto from 'node:crypto';

export const DECUP_BASE =
  process.env.DECUP_MODAL_BASE?.trim() ||
  'https://ryanrxvn-maker--casablanca-decupagem-web.modal.run';

const TICKET_TTL_S = 15 * 60; // 15 min pra começar e concluir o upload

/** Emite um ticket de upload descartável: `<exp>.<hmac>` (mesmo formato do worker). */
export function mintUploadTicket(): { ticket: string; base: string } {
  const secret = process.env.DECUP_UPLOAD_SECRET?.trim() || '';
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  return { ticket: `${exp}.${sig}`, base: DECUP_BASE };
}

export type DecupStatus =
  | { status: 'processing' }
  | { status: 'done'; id: string; original_dur: number; new_dur: number; segments: number; size_mb: number }
  | { status: 'failed'; error: string };

/** Dispara o job no Modal. Retorna o call_id pra acompanhar no /status. */
export async function startDecupar(opts: {
  inputId: string;
  keepSilence: number;
  outputKind: 'video' | 'audio';
}): Promise<{ callId: string }> {
  const key = process.env.DECUP_KEY?.trim() || '';
  const videoUrl = `${DECUP_BASE}/file?id=${encodeURIComponent(opts.inputId)}`;
  const r = await fetch(`${DECUP_BASE}/decupar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Decup-Key': key },
    body: JSON.stringify({
      video_url: videoUrl,
      keep_silence: opts.keepSilence,
      output_kind: opts.outputKind,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.call_id) {
    throw new Error(j?.detail || j?.error || `Modal /decupar HTTP ${r.status}`);
  }
  return { callId: j.call_id as string };
}

/** Consulta o status do job no Modal. */
export async function checkDecupStatus(callId: string): Promise<DecupStatus> {
  const r = await fetch(`${DECUP_BASE}/status?call_id=${encodeURIComponent(callId)}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return { status: 'failed', error: `Modal /status HTTP ${r.status}` };
  return j as DecupStatus;
}

/** Monta a URL de download direto do Modal (Content-Disposition força o nome). */
export function buildDownloadUrl(outputId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'decupado';
  return `${DECUP_BASE}/file?id=${encodeURIComponent(outputId)}&dl=${encodeURIComponent(safe)}`;
}
