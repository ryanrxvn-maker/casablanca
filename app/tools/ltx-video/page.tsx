'use client';

import { useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  concatVideosFast,
  extractFrameAt,
  probeVideoMetadata,
} from '@/lib/ffmpeg-worker';
import {
  LTX_DURATIONS,
  LTX_MODES,
  LTX_RESOLUTIONS,
  LTX_STEPS,
} from '@/lib/ltx-video';

/**
 * LTX-Video 2.3 — geração de vídeo unlimited via Hugging Face ZeroGPU.
 *
 * Roda 100% server-side proxy pra Space pública (Lightricks distilled, H200).
 * "12s (2 chunks)" = gera chunk t2v + continua com image-to-video a partir
 * do último frame e concatena (ffmpeg.wasm, sem re-encode).
 */

type GalleryItem = {
  id: string;
  url: string;
  prompt: string;
  meta: string;
};

type StartResp = {
  eventId: string;
  fn: string;
  tokenIndex: number;
  tokenTotal: number;
  error?: string;
  retryable?: boolean;
};

type PollResp =
  | { status: 'done'; videoUrl: string; seed: number | null }
  | { status: 'error'; error: string; retryable: boolean }
  | { status: 'pending' };

const MAX_POLLS = 14; // ~10 min/chunk de teto

export default function LtxVideoPage() {
  const [prompt, setPrompt] = useToolState<string>('ltx:prompt', '');
  const [resId, setResId] = useToolState<string>('ltx:res', LTX_RESOLUTIONS[0].id);
  const [durId, setDurId] = useToolState<string>('ltx:dur', '12s');
  const [stepsId, setStepsId] = useToolState<string>('ltx:steps', '50');

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GalleryItem | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);

  const tokenIdxRef = useRef(0);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Roda 1 chunk (start + poll com rotação de token) e devolve o Blob. */
  async function runChunk(
    body: Record<string, unknown>,
    label: string,
  ): Promise<Blob> {
    const tokenTries = 6;
    for (let attempt = 0; attempt < tokenTries; attempt++) {
      setPhase(`${label} — enviando pra fila...`);
      const sResp = await fetch('/api/ltx-video/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, tokenIndex: tokenIdxRef.current }),
      });
      const s = (await sResp.json()) as StartResp;
      if (s.tokenTotal === 0) {
        throw new Error(
          'Nenhum token Hugging Face configurado. O ZeroGPU exige auth: ' +
            'crie tokens grátis em huggingface.co/settings/tokens e ponha ' +
            'em HF_TOKENS (separados por vírgula) no ambiente. Vários tokens = unlimited.',
        );
      }
      if (!sResp.ok || !s.eventId) {
        if (s.retryable) {
          tokenIdxRef.current++;
          await sleep(1200);
          continue;
        }
        throw new Error(s.error || 'Falha ao enfileirar.');
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        setPhase(`${label} — gerando na H200 (ZeroGPU)...`);
        const pResp = await fetch(
          `/api/ltx-video/result?fn=${encodeURIComponent(s.fn)}` +
            `&eventId=${encodeURIComponent(s.eventId)}` +
            `&tokenIndex=${tokenIdxRef.current}`,
        );
        const p = (await pResp.json()) as PollResp;
        if (p.status === 'done') {
          setPhase(`${label} — baixando vídeo...`);
          const vr = await fetch(p.videoUrl);
          if (!vr.ok) throw new Error('Não consegui baixar o vídeo gerado.');
          return await vr.blob();
        }
        if (p.status === 'error') {
          if (p.retryable) {
            tokenIdxRef.current++;
            await sleep(1200);
            break; // sai do poll, tenta novo token (novo start)
          }
          throw new Error(p.error || 'Erro na geração.');
        }
        // pending -> continua
      }
    }
    throw new Error(
      'Quota ZeroGPU esgotada em todos os tokens. Tente de novo em alguns minutos ou configure HF_TOKENS.',
    );
  }

  async function handleGenerate() {
    const txt = prompt.trim();
    if (!txt || busy) return;

    const res = LTX_RESOLUTIONS.find((r) => r.id === resId) ?? LTX_RESOLUTIONS[0];
    const dur = LTX_DURATIONS.find((d) => d.id === durId) ?? LTX_DURATIONS[0];
    const steps = LTX_STEPS.find((s) => s.id === stepsId) ?? LTX_STEPS[0];

    setBusy(true);
    setError(null);
    setResult(null);
    setPhase('Iniciando...');

    try {
      const baseBody = {
        prompt: txt,
        width: res.width,
        height: res.height,
        duration: dur.seconds,
        improveTexture: steps.improveTexture,
      };

      const parts: Blob[] = [];
      for (let c = 0; c < dur.chunks; c++) {
        const label =
          dur.chunks > 1 ? `Chunk ${c + 1}/${dur.chunks}` : 'Gerando';

        if (c === 0) {
          const blob = await runChunk(
            { ...baseBody, mode: 'text-to-video' },
            label,
          );
          parts.push(blob);
        } else {
          // Continuação: último frame do chunk anterior -> i2v
          setPhase(`${label} — preparando continuação...`);
          const prev = parts[parts.length - 1];
          const meta = await probeVideoMetadata(prev);
          const at = meta ? Math.max(0, meta.durationSec - 0.1) : 3;
          const frame = await extractFrameAt(prev, at, {
            maxWidth: res.width,
          });

          const fd = new FormData();
          fd.append('file', frame, 'frame.jpg');
          fd.append('tokenIndex', String(tokenIdxRef.current));
          const up = await fetch('/api/ltx-video/upload', {
            method: 'POST',
            body: fd,
          });
          const upJson = (await up.json()) as { path?: string; error?: string };
          if (!up.ok || !upJson.path) {
            throw new Error(upJson.error || 'Falha ao subir frame da continuação.');
          }

          const blob = await runChunk(
            {
              ...baseBody,
              mode: 'image-to-video',
              imageFilepath: upJson.path,
              prompt: `${txt}. Continue the motion smoothly, seamless continuation.`,
            },
            label,
          );
          parts.push(blob);
        }
      }

      setPhase(
        parts.length > 1 ? 'Juntando os chunks...' : 'Finalizando...',
      );
      const finalBlob =
        parts.length > 1 ? await concatVideosFast(parts) : parts[0];

      const url = URL.createObjectURL(finalBlob);
      const item: GalleryItem = {
        id: 'g_' + Math.random().toString(36).slice(2, 9),
        url,
        prompt: txt,
        meta: `${res.label} · ${dur.label} · ${steps.label}`,
      };
      setResult(item);
      setGallery((g) => [item, ...g].slice(0, 8));
      setPhase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="LTX-Video 2.3"
      description="12 segundos. Qualidade máxima. H200 80GB via Hugging Face ZeroGPU — geração unlimited, sem gastar crédito."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Prompt</label>
          <textarea
            className="input-field min-h-[96px] resize-y"
            placeholder="A close-up of a young woman in a Tokyo neon alley at night, cinematic, slow dolly forward, soft rain, film grain"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label-field">Modo</label>
            <select
              className="input-field"
              value="fast"
              disabled={busy}
              onChange={() => {}}
            >
              {LTX_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Duração</label>
            <select
              className="input-field"
              value={durId}
              disabled={busy}
              onChange={(e) => setDurId(e.target.value)}
            >
              {LTX_DURATIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Resolução</label>
            <select
              className="input-field"
              value={resId}
              disabled={busy}
              onChange={(e) => setResId(e.target.value)}
            >
              {LTX_RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Steps</label>
            <select
              className="input-field"
              value={stepsId}
              disabled={busy}
              onChange={(e) => setStepsId(e.target.value)}
            >
              {LTX_STEPS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          onClick={handleGenerate}
          disabled={busy || !prompt.trim()}
        >
          {busy ? phase || 'Gerando...' : 'Gerar vídeo'}
        </button>

        {error ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {result ? (
          <div>
            <label className="label-field">Resultado</label>
            <video
              src={result.url}
              controls
              autoPlay
              loop
              className="w-full rounded-[12px] border border-line bg-black"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-text-muted">{result.meta}</span>
              <a
                href={result.url}
                download={`ltx-${result.id}.mp4`}
                className="btn-secondary"
              >
                Baixar MP4
              </a>
            </div>
          </div>
        ) : null}

        <div>
          <h2 className="section-title mb-3 text-lg">Últimas gerações</h2>
          {gallery.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex aspect-video items-center justify-center rounded-[12px] border border-line bg-bg-soft text-xs text-text-dim"
                >
                  (vazio — gere seu primeiro vídeo)
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {gallery.map((g) => (
                <div
                  key={g.id}
                  className="overflow-hidden rounded-[12px] border border-line bg-bg-soft"
                >
                  <video
                    src={g.url}
                    controls
                    loop
                    muted
                    className="aspect-video w-full bg-black"
                  />
                  <div className="px-3 py-2">
                    <p className="line-clamp-2 text-xs text-text-muted">
                      {g.prompt}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-widest text-text-dim">
                      {g.meta}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
