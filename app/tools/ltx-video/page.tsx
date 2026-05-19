'use client';

import { useState } from 'react';
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
 * LTX-Video 2.3 — geração de vídeo (com áudio) via Hugging Face ZeroGPU.
 *
 * Proxy server-side autenticado pra Space Lightricks/LTX-2-3 (H200).
 * "12s (2 chunks)" = gera 6s, extrai o último frame, continua com
 * image-to-video e concatena (ffmpeg.wasm, sem re-encode).
 */

type GalleryItem = {
  id: string;
  url: string;
  prompt: string;
  meta: string;
};

type GenResp = {
  videoUrl?: string;
  seed?: number | null;
  tokenIndex?: number;
  error?: string;
  kind?: string;
  tokenTotal?: number;
};

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

  async function callGenerate(
    fields: Record<string, string>,
    image: Blob | null,
    startToken: number,
  ): Promise<{ blob: Blob; tokenIndex: number }> {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('startToken', String(startToken));
    if (image) fd.append('image', image, 'frame.jpg');

    const resp = await fetch('/api/ltx-video/generate', {
      method: 'POST',
      body: fd,
    });
    const j = (await resp.json()) as GenResp;

    if (!resp.ok || !j.videoUrl) {
      if (j.kind === 'config' || j.tokenTotal === 0) {
        throw new Error(
          'Nenhum token Hugging Face configurado no servidor. ' +
            'Crie tokens grátis em huggingface.co/settings/tokens e ponha ' +
            'em HF_TOKENS (vários, de contas diferentes = mais quota).',
        );
      }
      if (j.kind === 'quota') {
        throw new Error(
          'Quota ZeroGPU esgotada em TODOS os tokens. ' +
            (j.error || '') +
            ' — adicione mais tokens (contas HF diferentes) ou use conta PRO.',
        );
      }
      throw new Error(j.error || 'Falha na geração.');
    }

    setPhase('Baixando vídeo...');
    const vr = await fetch(j.videoUrl);
    if (!vr.ok) throw new Error('Não consegui baixar o vídeo gerado.');
    return { blob: await vr.blob(), tokenIndex: j.tokenIndex ?? startToken };
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
    setPhase('Conectando na H200 (ZeroGPU)...');

    try {
      const baseFields = {
        prompt: txt,
        duration: String(dur.seconds),
        width: String(res.width),
        height: String(res.height),
        enhance: steps.enhance ? '1' : '0',
      };

      const parts: Blob[] = [];
      let tok = 0;

      for (let c = 0; c < dur.chunks; c++) {
        const label =
          dur.chunks > 1 ? `Chunk ${c + 1}/${dur.chunks}` : 'Gerando';
        let image: Blob | null = null;
        let fields = baseFields;

        if (c > 0) {
          setPhase(`${label} — preparando continuação...`);
          const prev = parts[parts.length - 1];
          const meta = await probeVideoMetadata(prev);
          const at = meta ? Math.max(0, meta.durationSec - 0.08) : 3;
          image = await extractFrameAt(prev, at, { maxWidth: res.width });
          fields = {
            ...baseFields,
            prompt: `${txt}. Seamless continuation of the previous shot, same scene, smooth continuous motion.`,
          };
        }

        setPhase(`${label} — gerando na H200 (pode levar ~1-2 min)...`);
        const { blob, tokenIndex } = await callGenerate(fields, image, tok);
        tok = tokenIndex; // próximo chunk começa no token que funcionou
        parts.push(blob);
      }

      setPhase(parts.length > 1 ? 'Juntando os chunks...' : 'Finalizando...');
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
      description="Vídeo + áudio sincronizados. H200 80GB via Hugging Face ZeroGPU — geração unlimited com rotação de tokens, sem gastar crédito."
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
            <select className="input-field" value="fast" disabled>
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
