'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  concatVideosFast,
  extractFrameAt,
  probeVideoMetadata,
} from '@/lib/ffmpeg-worker';
import { LTX_DURATIONS, LTX_RESOLUTIONS } from '@/lib/ltx-video';

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
  error?: string;
  kind?: string;
  retrySec?: number | null;
  detail?: string;
};

type PoolStatus = {
  total: number;
  available: number;
  perAccountDay: number;
  usedToday: number;
  estRemainingToday: number;
};

export default function LtxVideoPage() {
  const [prompt, setPrompt] = useToolState<string>('ltx:prompt', '');
  const [resId, setResId] = useToolState<string>('ltx:res', LTX_RESOLUTIONS[0].id);
  const [durId, setDurId] = useToolState<string>('ltx:dur', '6s');

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GalleryItem | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [pool, setPool] = useState<PoolStatus | null>(null);
  // Imagem opcional p/ image-to-video. Quando setada, vira o 1º frame
  // (modo "anime esta imagem"); o prompt vira a descrição do MOVIMENTO.
  const [image, setImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  // Mantém um object URL pro preview da imagem anexada (revoga ao trocar).
  useEffect(() => {
    if (!image) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const refreshPool = useCallback(async () => {
    try {
      const r = await fetch('/api/ltx-video/status');
      if (r.ok) setPool((await r.json()) as PoolStatus);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    refreshPool();
  }, [refreshPool]);

  async function callGenerate(
    fields: Record<string, string>,
    image: Blob | null,
  ): Promise<Blob> {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (image) fd.append('image', image, 'frame.jpg');

    const resp = await fetch('/api/ltx-video/generate', {
      method: 'POST',
      body: fd,
    });
    const j = (await resp.json()) as GenResp;

    if (!resp.ok || !j.videoUrl) {
      if (j.kind === 'config') {
        throw new Error(
          'Nenhum token HF visível NESTA função do servidor. ' +
            'Configure HF_TOKENS no Vercel (escopo Project) e Redeploy. ' +
            (j.detail ? `[diagnóstico: ${j.detail}]` : ''),
        );
      }
      if (j.kind === 'quota') {
        const s = j.retrySec ?? 0;
        const when =
          s > 0
            ? s < 90
              ? ` Tenta de novo em ~${s}s.`
              : ` Tenta de novo em ~${Math.ceil(s / 60)} min.`
            : '';
        throw new Error(
          (j.error || 'Quota ZeroGPU esgotada.') +
            when +
            ' (Conta free zera na virada do dia; PRO/+contas = sem espera.)',
        );
      }
      throw new Error(
        (j.error || 'Falha na geração.') +
          (j.detail ? ` [${j.detail}]` : ''),
      );
    }

    setPhase('Baixando vídeo...');
    const vr = await fetch(j.videoUrl);
    if (!vr.ok) throw new Error('Não consegui baixar o vídeo gerado.');
    return await vr.blob();
  }

  async function handleGenerate() {
    const txt = prompt.trim();
    if (!txt || busy) return;

    const res = LTX_RESOLUTIONS.find((r) => r.id === resId) ?? LTX_RESOLUTIONS[0];
    const dur = LTX_DURATIONS.find((d) => d.id === durId) ?? LTX_DURATIONS[0];

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
        // enhance_prompt fixo em OFF: é o caminho COMPROVADO (gerou MP4
        // real) e o mais rápido — não estoura o teto de 75s da GPU.
        enhance: '0',
      };

      const parts: Blob[] = [];

      for (let c = 0; c < dur.chunks; c++) {
        const label =
          dur.chunks > 1 ? `Chunk ${c + 1}/${dur.chunks}` : 'Gerando';

        if (c === 0) {
          // Chunk 1: t2v puro OU i2v se o user anexou uma imagem
          // (LTX-2.3 aceita imagem como 1º frame nativamente). Se falhar
          // aqui, não há vídeo — erro real pro usuário.
          setPhase(
            `${label} — gerando na H200 (pode levar ~1-2 min)${image ? ' [animando imagem]' : ''}...`,
          );
          parts.push(await callGenerate(baseFields, image));
          continue;
        }

        // Continuação (i2v). Se você pediu 12s, EU ENTREGO 12s ou erro
        // claro — sem entregar 6s mascarando que a continuação falhou.
        // 1 retry rápido cobre blip transitório da Space; falha real
        // surface mensagem honesta pro user.
        setPhase(`${label} — preparando continuação...`);
        const prev = parts[parts.length - 1];
        const meta = await probeVideoMetadata(prev);
        const at = meta ? Math.max(0, meta.durationSec - 0.08) : 3;
        const contImage = await extractFrameAt(prev, at, { maxWidth: res.width });
        const contFields = {
          ...baseFields,
          prompt: `${txt}. Seamless continuation of the previous shot, same scene, smooth continuous motion.`,
        };

        let chunk2Err: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            setPhase(
              `${label} — gerando na H200${attempt > 1 ? ' (tentativa 2)' : ''}...`,
            );
            parts.push(await callGenerate(contFields, contImage));
            chunk2Err = null;
            break;
          } catch (e) {
            chunk2Err = e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2500));
          }
        }
        if (chunk2Err) {
          const msg = chunk2Err instanceof Error ? chunk2Err.message : String(chunk2Err);
          throw new Error(
            `Você pediu ${dur.label}, mas o Chunk ${c + 1}/${dur.chunks} ` +
              `falhou (mesmo após retry). Razão: ${msg}\n` +
              `Geramos só os primeiros ${c * dur.seconds}s — não entreguei o vídeo ` +
              `parcial pra não te enganar. Tente de novo agora ou quando houver mais quota.`,
          );
        }
      }

      if (parts.length === 0) throw new Error('Nenhum chunk gerado.');

      setPhase(parts.length > 1 ? 'Juntando os chunks...' : 'Finalizando...');
      let finalBlob: Blob;
      try {
        finalBlob =
          parts.length > 1 ? await concatVideosFast(parts) : parts[0];
      } catch (concatErr) {
        console.warn('[ltx] concat falhou, entregando o 1º chunk:', concatErr);
        finalBlob = parts[0];
      }

      const url = URL.createObjectURL(finalBlob);
      const item: GalleryItem = {
        id: 'g_' + Math.random().toString(36).slice(2, 9),
        url,
        prompt: txt,
        meta: `${res.label} · ${dur.label}`,
      };
      setResult(item);
      setGallery((g) => [item, ...g].slice(0, 8));
      setPhase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('');
    } finally {
      setBusy(false);
      refreshPool();
    }
  }

  return (
    <ToolShell
      title="LTX-Video 2.3"
      description="Vídeo + áudio sincronizados. H200 80GB via Hugging Face ZeroGPU — geração unlimited com rotação de tokens, sem gastar crédito."
    >
      <div className="flex flex-col gap-6">
        {pool ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-line bg-bg-soft px-4 py-3 text-[11px] uppercase tracking-widest">
            <span className="flex items-center gap-2">
              <span
                className={
                  'inline-block h-2 w-2 rounded-full ' +
                  (pool.estRemainingToday > 0
                    ? 'bg-lime shadow-[0_0_10px_var(--lime)]'
                    : 'bg-red-500')
                }
              />
              <span className="text-white">
                ≈ {pool.estRemainingToday} gerações restantes hoje
              </span>
            </span>
            <span className="text-text-muted">
              {pool.available}/{pool.total} contas com quota
            </span>
            <span className="text-text-dim normal-case tracking-normal">
              {pool.total === 0
                ? 'configure HF_TOKENS'
                : `${pool.usedToday} usadas · ~${pool.perAccountDay}/conta/dia · capacidade ~${pool.total * pool.perAccountDay}/dia`}
            </span>
          </div>
        ) : null}
        <div>
          <label className="label-field">Prompt</label>
          <textarea
            className="input-field min-h-[96px] resize-y"
            placeholder={
              image
                ? 'Descreva o MOVIMENTO (ex: "slow zoom in, soft wind moving the hair, cinematic")'
                : 'A close-up of a young woman in a Tokyo neon alley at night, cinematic, slow dolly forward, soft rain, film grain'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label className="label-field">
            Imagem inicial (opcional — anima a foto)
          </label>
          <FileUpload
            accept="image/png,image/jpeg,image/webp"
            value={image}
            onChange={(f) => setImage(f)}
            hint="Anexe uma imagem pra ela virar o 1º frame do vídeo (image-to-video). Sem imagem = gera só pelo prompt."
          />
          {imagePreviewUrl && image ? (
            <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-bg-soft p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Pré-visualização da imagem que será animada"
                className="h-28 w-auto rounded-[8px] border border-line object-contain bg-black"
              />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate text-white">{image.name}</p>
                <p className="mt-1 text-text-muted">
                  {Math.max(1, Math.round(image.size / 1024))} KB
                </p>
                <p className="mt-1 text-text-dim">
                  Será o 1º frame · descreva o movimento no prompt acima
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => setImage(null)}
                aria-label="Remover imagem"
              >
                Remover
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
