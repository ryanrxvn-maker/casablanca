'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';

/**
 * Auto B-Roll — transforma a copy de uma VSL em um pacote de producao:
 *  1. Tabela de cenas em pt-BR (copy -> categoria -> emocao -> duracao)
 *  2. Prompts de video em ingles (3-5s cada)
 *  3. Bloco de consistencia (persona + paleta + padrao de camera)
 *  4. JSON estruturado pra Nano Banana 2
 *
 * Toda a IA vive no endpoint /api/auto-broll (Claude Messages API). Esta
 * page so coleta os inputs, dispara a chamada e renderiza o resultado.
 */

type NanoBananaPrompt = {
  id: string;
  tone: string;
  nano_banana_prompt: string;
  visual_logic: string;
};

type ApiResult = {
  markdown: string;
  nanoBananaJson: NanoBananaPrompt[] | null;
  usage: { input_tokens: number; output_tokens: number } | null;
};

export default function AutoBrollPage() {
  const [targetAudience, setTargetAudience] = useToolState<string>(
    'autoBroll:audience',
    '',
  );
  const [narratorPersona, setNarratorPersona] = useToolState<string>(
    'autoBroll:persona',
    '',
  );
  const [fullCopy, setFullCopy] = useToolState<string>('autoBroll:copy', '');
  const [visualRef, setVisualRef] = useToolState<string>(
    'autoBroll:visualRef',
    '',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'autoBroll:processing',
    false,
  );
  const [result, setResult] = useToolState<ApiResult | null>(
    'autoBroll:result',
    null,
  );
  const [error, setError] = useToolState<string | null>(
    'autoBroll:error',
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleGenerate() {
    if (fullCopy.trim().length < 20) {
      setError('Cole a copy completa da VSL (mínimo 20 caracteres).');
      return;
    }
    setError(null);
    setResult(null);
    setProcessing(true);
    try {
      const res = await fetch('/api/auto-broll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetAudience,
          narratorPersona,
          fullCopy,
          visualReferenceChunk: visualRef,
        }),
      });
      const json = (await res.json()) as ApiResult & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Falha ao gerar.');
      }
      setResult({
        markdown: json.markdown,
        nanoBananaJson: json.nanoBananaJson,
        usage: json.usage,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido.');
    } finally {
      setProcessing(false);
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  }

  function downloadPack() {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'auto-broll-pack.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadNanoBananaJson() {
    if (!result?.nanoBananaJson) return;
    const blob = new Blob(
      [JSON.stringify(result.nanoBananaJson, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nano-banana-prompts.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ToolShell
      title="Auto B-Roll"
      description="Cole a copy da sua VSL e receba tabela de cenas, prompts de vídeo (3–5s) e JSON pronto pro Nano Banana 2."
    >
      <div className="grid gap-5">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="block">
            <span className="label-field">
              Público-alvo
            </span>
            <input
              type="text"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="Ex: Mulheres 35-55, acima do peso, pt-BR"
              className="input-field"
              disabled={processing}
            />
          </label>

          <label className="block">
            <span className="label-field">
              Persona do narrador
            </span>
            <input
              type="text"
              value={narratorPersona}
              onChange={(e) => setNarratorPersona(e.target.value)}
              placeholder="Ex: Médica 40 anos, cabelo castanho, jaleco branco, postura segura"
              className="input-field"
              disabled={processing}
            />
          </label>
        </div>

        <label className="block">
          <span className="label-field">
            Copy completa da VSL
          </span>
          <textarea
            value={fullCopy}
            onChange={(e) => setFullCopy(e.target.value)}
            placeholder="Cole aqui a copy completa (gancho, dor, mecanismo, solução, prova, oferta, fechamento)..."
            rows={10}
            className="input-field resize-y font-mono text-sm"
            disabled={processing}
          />
          <div className="mt-1 text-xs text-text-muted">
            <span className="mono text-lime">{fullCopy.trim().length}</span>{' '}
            caracteres
          </div>
        </label>

        <label className="block">
          <span className="label-field">
            Referência visual (opcional)
          </span>
          <textarea
            value={visualRef}
            onChange={(e) => setVisualRef(e.target.value)}
            placeholder="Descreva em texto o estilo visual que você quer seguir (paleta, luz, câmera, tipo de tomada)..."
            rows={3}
            className="input-field resize-y text-sm"
            disabled={processing}
          />
        </label>

        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={processing || fullCopy.trim().length < 20}
            className="btn-primary"
          >
            {processing ? 'Gerando pacote...' : 'Gerar pacote B-Roll'}
          </button>
          {result && (
            <>
              <button
                type="button"
                onClick={downloadPack}
                className="btn-secondary"
              >
                Baixar markdown
              </button>
              {result.nanoBananaJson && (
                <button
                  type="button"
                  onClick={downloadNanoBananaJson}
                  className="btn-secondary"
                >
                  Baixar JSON Nano Banana
                </button>
              )}
            </>
          )}
        </div>

        {processing && !result && (
          <div className="scan-line tech-frame mt-2 rounded-xl border border-lime/30 bg-bg-soft/40 p-5">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-lime shadow-[0_0_12px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-sm font-medium uppercase tracking-widest text-lime">
                Claude analisando a copy...
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              <div className="shimmer h-3 w-3/4 rounded-full bg-bg" />
              <div className="shimmer h-3 w-11/12 rounded-full bg-bg" />
              <div className="shimmer h-3 w-2/3 rounded-full bg-bg" />
              <div className="shimmer h-3 w-5/6 rounded-full bg-bg" />
            </div>
            <p className="mono mt-4 text-[11px] uppercase tracking-widest text-text-muted">
              gerando tabela de cenas · prompts · JSON nano banana
            </p>
          </div>
        )}

        {result && (
          <div className="mt-2 grid gap-5">
            <section
              className="fade-in-up rounded-xl border border-line bg-bg-soft/40 p-4"
              style={{ animationDelay: '0ms' }}
            >
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                  Pacote completo (markdown)
                </h2>
                <button
                  type="button"
                  onClick={() => copyText(result.markdown, 'md')}
                  className="btn-secondary text-xs"
                >
                  {copiedId === 'md' ? 'Copiado!' : 'Copiar tudo'}
                </button>
              </header>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-black/40 p-3 text-xs leading-relaxed text-white">
                {result.markdown}
              </pre>
            </section>

            {result.nanoBananaJson && Array.isArray(result.nanoBananaJson) && (
              <section
                className="fade-in-up rounded-xl border border-line bg-bg-soft/40 p-4"
                style={{ animationDelay: '120ms' }}
              >
                <header className="mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                    Prompts Nano Banana 2 ({result.nanoBananaJson.length}{' '}
                    cenas)
                  </h2>
                </header>
                <ul className="grid gap-3">
                  {result.nanoBananaJson.map((p, idx) => (
                    <li
                      key={p.id}
                      className="fade-in-up rounded-lg border border-line bg-black/30 p-3"
                      style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-lime-soft px-2 py-0.5 text-xs font-medium text-lime">
                          {p.id}
                        </span>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-text-muted">
                          {p.tone}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(p.nano_banana_prompt, p.id)}
                          className="ml-auto btn-secondary text-xs"
                        >
                          {copiedId === p.id ? 'Copiado!' : 'Copiar prompt'}
                        </button>
                      </div>
                      <p className="text-sm leading-relaxed text-white">
                        {p.nano_banana_prompt}
                      </p>
                      <p className="mt-2 text-xs italic text-text-muted">
                        {p.visual_logic}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.usage && (
              <div className="text-xs text-text-muted">
                Claude usage:{' '}
                <span className="mono text-lime">
                  {result.usage.input_tokens.toLocaleString('pt-BR')}
                </span>{' '}
                in /{' '}
                <span className="mono text-lime">
                  {result.usage.output_tokens.toLocaleString('pt-BR')}
                </span>{' '}
                out tokens
              </div>
            )}
          </div>
        )}
      </div>
    </ToolShell>
  );
}
