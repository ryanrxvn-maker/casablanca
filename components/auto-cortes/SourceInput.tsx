'use client';

/**
 * AUTO CORTES — passo 1: a FONTE.
 *
 * Campo único no estilo Opus Clip: o mesmo retângulo aceita um link colado
 * (YouTube / Drive) OU um arquivo solto/escolhido. Quem decide é o conteúdo,
 * não um seletor de modo — colar um link limpa o arquivo e vice-versa.
 *
 * O chip de status da extensão/Motor usa o MESMO protocolo do Downloader
 * (`DL_PING`/`DL_PONG` via `pingExtension`) e o MESMO cache de 10 min em
 * localStorage: sem isso a página abre "desconectada" por 2 s toda vez e o
 * cliente acha que quebrou.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { pingExtension, versionAtLeast } from '@/lib/auto-cortes/ext-bridge';
import { resolveSourceKind } from '@/lib/auto-cortes/ingest';
import { AUTO_CORTES_MIN_EXT_VERSION, LIMITS, type SourceKind } from '@/lib/auto-cortes/types';
import { formatBytes } from '@/lib/utils';
import { AC_HUE, Chip, ErrorNote, T3D } from './ui';

const EXT_CACHE_KEY = 'auto-cortes:ext-cache';
const EXT_CACHE_TTL_MS = 10 * 60 * 1000;
const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv';

type ExtState = { connected: boolean; version: string; engine: boolean };
const EXT_UNKNOWN: ExtState = { connected: false, version: '', engine: false };

function loadCachedExt(): ExtState {
  try {
    const raw = localStorage.getItem(EXT_CACHE_KEY);
    if (!raw) return EXT_UNKNOWN;
    const v = JSON.parse(raw) as ExtState & { ts?: number };
    if (!v || typeof v.ts !== 'number' || Date.now() - v.ts > EXT_CACHE_TTL_MS) return EXT_UNKNOWN;
    return { connected: !!v.connected, version: String(v.version || ''), engine: !!v.engine };
  } catch {
    return EXT_UNKNOWN;
  }
}

function saveCachedExt(v: ExtState) {
  try {
    localStorage.setItem(EXT_CACHE_KEY, JSON.stringify({ ...v, ts: Date.now() }));
  } catch {
    /* storage cheio — o chip só perde o atalho */
  }
}

export type SourceInputProps = {
  url: string;
  onUrl: (v: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  /**
   * Projeto restaurado do IDB cuja fonte era UPLOAD: o navegador não guarda o
   * arquivo, então o cliente precisa reapontar o mesmo. `onAttach` é o
   * `attachFile` do pipeline (ele confere a assinatura).
   */
  needsFile?: {
    name: string;
    sizeBytes: number;
    onAttach: (f: File) => { ok: true } | { ok: false; reason: string };
  } | null;
};

export function SourceInput({
  url,
  onUrl,
  file,
  onFile,
  disabled,
  needsFile,
}: SourceInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reattachRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [ext, setExt] = useState<ExtState>(EXT_UNKNOWN);

  // cache primeiro (chip já nasce certo), ping depois
  useEffect(() => {
    setExt(loadCachedExt());
    let alive = true;
    void (async () => {
      const pong = await pingExtension(2500);
      if (!alive) return;
      const next: ExtState = pong
        ? { connected: true, version: pong.version, engine: pong.engine }
        : EXT_UNKNOWN;
      setExt(next);
      if (pong) saveCachedExt(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const kind: SourceKind | null = url.trim() ? resolveSourceKind(url) : null;
  const extOk = ext.connected && versionAtLeast(ext.version, AUTO_CORTES_MIN_EXT_VERSION);
  const motorOk = extOk && ext.engine;

  const takeFile = useCallback(
    (f: File | null) => {
      setLocalError(null);
      if (!f) {
        onFile(null);
        return;
      }
      if (f.size > LIMITS.maxInputBytes) {
        setLocalError(
          `Esse arquivo tem ${formatBytes(f.size)} e o limite é ${formatBytes(LIMITS.maxInputBytes)}. Comprime ele antes (ferramenta Compressor) ou manda um trecho.`,
        );
        return;
      }
      onUrl('');
      onFile(f);
    },
    [onFile, onUrl],
  );

  // ── caixa de "selecione o MESMO arquivo" (após F5 com upload) ────────────
  if (needsFile) {
    return (
      <div className="space-y-3">
        <div
          className="rounded-[16px] border border-yellow-500/45 bg-yellow-500/[0.07] px-4 py-4"
          role="status"
        >
          <div
            className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-yellow-300"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Selecione o MESMO arquivo pra continuar
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-muted">
            O projeto voltou inteiro (transcrição, análise e cortes já feitos), mas o navegador
            não guarda o vídeo depois de um F5. Aponte novamente{' '}
            <span className="font-semibold text-text">{needsFile.name}</span>{' '}
            <span className="mono text-[11px] text-text-dim">
              ({formatBytes(needsFile.sizeBytes)})
            </span>{' '}
            e o trabalho segue de onde parou.
          </p>
          <input
            ref={reattachRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const r = needsFile.onAttach(f);
              setLocalError(r.ok ? null : r.reason);
            }}
          />
          <button
            type="button"
            onClick={() => reattachRef.current?.click()}
            className={'btn-primary mt-3 !py-2 text-[13px]' + T3D}
          >
            Escolher o arquivo
          </button>
        </div>
        <ErrorNote>{localError}</ErrorNote>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {motorOk ? (
          <Chip tone="ok" title={`Extensão ${ext.version} + Motor local pareados`}>
            Motor conectado
          </Chip>
        ) : extOk ? (
          <Chip tone="warn" title="A extensão está aqui, mas o Motor local não respondeu">
            Motor desligado — link do YouTube precisa dele
          </Chip>
        ) : (
          <Chip tone="warn">Extensão 1.8.0 necessária pra link</Chip>
        )}
        {!motorOk ? (
          <Link
            href="/tools/downloader"
            className="text-[11.5px] font-semibold text-violet underline underline-offset-2 hover:text-text"
          >
            Como instalar →
          </Link>
        ) : null}
        <span className="text-[11.5px] text-text-dim">
          Arquivo do computador funciona sempre, sem extensão.
        </span>
      </div>

      <div
        className={
          'relative overflow-hidden rounded-[16px] border-2 border-dashed transition-all duration-300 ' +
          (dragging
            ? 'border-pink-400/70 bg-pink-400/[0.07]'
            : file
              ? 'border-pink-400/50 bg-pink-400/[0.04]'
              : 'border-line-strong bg-bg/40 hover:border-pink-400/45')
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          takeFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-40 blur-3xl"
          style={{ background: AC_HUE }}
        />
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            takeFile(f);
          }}
        />

        {file ? (
          <div className="relative flex items-center gap-3 px-4 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-pink-400/45 bg-pink-400/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f9a8d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                <path d="M10 9.5l5 2.5-5 2.5z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-text">{file.name}</div>
              <div className="mono text-[11px] text-text-muted">{formatBytes(file.size)}</div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => takeFile(null)}
              className="shrink-0 rounded-full border border-red-500/40 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/10 active:scale-[0.95] disabled:opacity-40"
            >
              Trocar
            </button>
          </div>
        ) : (
          <div className="relative flex flex-col gap-3 px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <input
                type="url"
                inputMode="url"
                value={url}
                disabled={disabled}
                placeholder="Cole o link do YouTube ou do Google Drive…"
                onChange={(e) => {
                  setLocalError(null);
                  onUrl(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-[12px] border border-line bg-bg-soft px-3.5 py-3 text-[13.5px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-pink-400/60 disabled:opacity-50"
              />
              <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-text-dim sm:block" style={{ fontFamily: 'var(--font-tech)' }}>
                ou
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className={
                  'shrink-0 rounded-[12px] border border-pink-400/45 bg-pink-400/10 px-4 py-3 text-[12.5px] font-bold text-pink-200 disabled:opacity-40' +
                  T3D
                }
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Escolher arquivo
              </button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-text-dim">
              Arraste o vídeo pra cá — mp4, mov, webm ou mkv, até{' '}
              {formatBytes(LIMITS.maxInputBytes)} e {Math.round(LIMITS.maxDurationSec / 3600)} h.
              Nenhum byte do vídeo sai do seu computador.
            </p>
          </div>
        )}
      </div>

      {url.trim() && !kind ? (
        <ErrorNote>
          Isso não parece um link de vídeo. Cole o endereço de um vídeo do YouTube ou de um arquivo
          do Google Drive — ou clique em “Escolher arquivo”.
        </ErrorNote>
      ) : null}

      {kind === 'youtube' && !motorOk ? (
        <ErrorNote>
          Link do YouTube precisa da extensão 1.8.0 com o Motor ligado — é o mesmo requisito do
          Downloader. Instale pela página do Downloader ou suba o arquivo aqui.
        </ErrorNote>
      ) : null}

      {kind === 'drive' && !extOk ? (
        <p className="text-[11.5px] leading-relaxed text-text-muted">
          Sem a extensão o Drive ainda funciona pelo servidor, mas só até{' '}
          {formatBytes(LIMITS.driveServerFallbackMaxBytes)} e se o arquivo for público.
        </p>
      ) : null}

      {kind === 'url' ? (
        <p className="text-[11.5px] leading-relaxed text-text-muted">
          Esse link não é YouTube nem Drive: vamos tentar baixar direto pela extensão. Se falhar,
          baixe o arquivo e suba aqui.
        </p>
      ) : null}

      <ErrorNote>{localError}</ErrorNote>
    </div>
  );
}
