'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { ToolHero3D } from '@/components/ToolHero3D';
import { CancelButton } from '@/components/CancelButton';
import { CostHint } from '@/components/CostHint';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { estimateDecupagemCopy } from '@/lib/cost-estimator';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  extractAudioForTranscription,
  isCancellationError,
  probeVideoMetadata,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { formatBytes, formatTime } from '@/lib/utils';
import {
  ToolStep,
  ToolDropzone,
  ToolAction,
  ToolChoice,
  ToolResultCard,
  ToolMetric,
} from '@/components/tool-kit';
import { IconCopySRT, IconStepMic, IconStepPlay, IconStepText } from '@/components/ToolIcons';
import type { SubtitleStyle } from '@/lib/srt-builder';

/**
 * Copy → SRT — gera legendas SRT pulando a revisao manual.
 *
 * Voce ja tem o texto da copy. AssemblyAI da timestamps por palavra.
 * O servidor combina os dois e devolve um SRT pronto, com texto exato
 * da copy + tempos do audio real. Importa direto no CapCut/Premiere.
 */

const MAX_FILE_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 60 * 60;
const HUE = 'rgba(167,139,250,0.45)';

export default function CopySrtPage() {
  const [file, setFile] = useToolState<File | null>('copysrt:file', null);
  const [copyText, setCopyText] = useToolState<string>('copysrt:copy', '');
  const [style, setStyle] = useToolState<SubtitleStyle>(
    'copysrt:style',
    'single',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'copysrt:processing',
    false,
  );
  const [stage, setStage] = useToolState<string | null>('copysrt:stage', null);
  const [progress, setProgress] = useToolState<number | null>(
    'copysrt:progress',
    null,
  );
  const [srt, setSrt] = useToolState<string | null>('copysrt:srt', null);
  const [duration, setDuration] = useToolState<number | null>(
    'copysrt:duration',
    null,
  );
  const [error, setError] = useToolState<string | null>('copysrt:error', null);
  const abortRef = useRef<AbortController | null>(null);

  function handleCancel() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

  useEffect(() => {
    if (!file) {
      setDuration(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const meta = await probeVideoMetadata(file);
      if (!cancelled && meta) setDuration(meta.durationSec);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const validation = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      return `Arquivo de ${formatBytes(file.size)} excede o limite de 800MB.`;
    }
    if (duration !== null && duration > MAX_DURATION_SEC) {
      return `Audio de ${Math.round(duration / 60)}min excede o limite de 60min.`;
    }
    return null;
  }, [file, duration]);

  function reset() {
    setSrt(null);
    setStage(null);
    setProgress(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    if (validation) {
      setError(validation);
      return;
    }
    if (!copyText.trim()) {
      setError('Cole o texto da copy.');
      return;
    }
    reset();
    setProcessing(true);
    try {
      setStage('Extraindo audio...');
      setProgress(0.1);
      const audio = await extractAudioForTranscription(file, {
        onStage: (s) => setStage(s),
        onProgress: (p: FFProgress) => setProgress(p.ratio * 0.3),
      });

      if (audio.size > 4_400_000) {
        throw new Error(
          `Audio extraido tem ${formatBytes(audio.size)} — excede o limite (~4.4MB) do servidor. Use audio mais curto.`,
        );
      }

      setStage('Transcrevendo e alinhando a copy...');
      setProgress(0.4);

      const fd = new FormData();
      fd.append('audio', audio, 'audio.opus');
      fd.append('copy', copyText);
      fd.append('provider', 'groq');
      fd.append('style', style);

      abortRef.current = new AbortController();
      const res = await fetch('/api/mind-ads/transcribe-srt', {
        method: 'POST',
        body: fd,
        signal: abortRef.current.signal,
      });

      const text = await res.text();
      let json: { srt?: string; provider?: string; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          /Request Entity Too Large/i.test(text)
            ? 'Audio acima do limite do servidor.'
            : `Resposta nao-JSON (HTTP ${res.status})`,
        );
      }
      if (!res.ok || !json.srt) {
        throw new Error(json.error || 'Falha na geracao do SRT.');
      }

      setSrt(json.srt);
      setStage(null);
      setProgress(null);
    } catch (e) {
      console.error(e);
      if (isCancellationError(e) || (e as Error)?.name === 'AbortError') {
        setStage('Cancelado pelo usuario.');
        setError(null);
      } else {
        setError((e as Error)?.message ?? 'Falha.');
        setStage(null);
      }
      setProgress(null);
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  async function download() {
    if (!srt || !file) return;
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/\s+/g, '_');
    const blob = new Blob([srt], { type: 'application/x-subrip' });
    await downloadBlob(blob, baseName + '.srt');
  }

  const charCount = copyText.trim().length;
  const lineCount = srt
    ? srt.split('\n').filter((l) => /^\d+$/.test(l.trim())).length
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 md:px-8 md:pt-8">
      <ToolHero3D
        eyebrow="LEGENDA · ALINHAMENTO IA"
        eyebrow2="QUEBRA INTELIGENTE · 42/CPS17"
        title="Gerador de SRT"
        subtitle={
          <>
            Manda áudio + sua copy.{' '}
            <span className="font-semibold text-white">Sai legenda alinhada palavra-a-palavra</span>, com quebra inteligente pronta pra qualquer editor.
          </>
        }
        tint="amber"
        pipeline={[
          { icon: '🎙', label: 'Áudio', sub: 'Voz da VSL', tone: 'text-text-muted' },
          { icon: '📝', label: 'Copy', sub: 'O texto exato', tone: 'text-amber-300' },
          { icon: '🧠', label: 'Alinhamento', sub: 'Palavra-a-palavra', tone: 'text-violet' },
          { icon: '📄', label: '.SRT / .VTT', sub: 'Pronto pro editor', tone: 'text-lime' },
        ]}
        stats={[
          { value: '42', label: 'chars / linha' },
          { value: '17', label: 'CPS máx' },
          { value: 'SRT', label: 'Premiere · CapCut · DR' },
        ]}
      />
      <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-7">
      <div className="flex flex-col gap-5">
        <MissingKeyBanner services={['groq']} />

        <ToolStep n={1} icon={<IconStepMic size={18} />} title="Áudio ou vídeo" hint="MP3, WAV, MP4, MOV, WEBM — até 800MB e 60min" hue={HUE}>
          <ToolDropzone
            accept="audio/*,video/mp4,video/webm,video/quicktime,video/x-matroska"
            file={file}
            onFile={(f) => {
              reset();
              setFile(f);
            }}
            disabled={processing}
            hue={HUE}
          />
          {file ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <ToolMetric value={formatBytes(file.size)} label="Tamanho" />
              {duration !== null ? (
                <ToolMetric
                  value={formatTime(duration)}
                  label="Duração"
                  accent="lime"
                />
              ) : null}
              {duration !== null && duration > 0 ? (
                <div className="hidden md:block">
                  <CostHint estimate={estimateDecupagemCopy(duration)} />
                </div>
              ) : null}
            </div>
          ) : null}
          {validation ? (
            <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {validation}
            </div>
          ) : null}
        </ToolStep>

        <ToolStep
          n={2}
          icon={<IconStepText size={18} />}
          title="Texto da copy"
          hint="Será o conteúdo exato do SRT — só os tempos vêm do áudio"
          hue={HUE}
        >
          <textarea
            id="copy"
            value={copyText}
            onChange={(e) => setCopyText(e.target.value)}
            placeholder="Cole aqui o texto da copy. O SRT vai sair com este texto exato + os tempos extraidos do audio."
            rows={9}
            className="input-field resize-y font-mono text-sm"
            disabled={processing}
          />
          <div className="mt-2 flex items-center justify-between">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Caracteres
            </span>
            <span
              className={
                'mono text-[12.5px] ' +
                (charCount > 0 ? 'text-violet' : 'text-text-muted')
              }
            >
              {charCount}
            </span>
          </div>
        </ToolStep>

        <ToolStep n={3} icon={<IconStepPlay size={18} />} title="Gerar SRT" hue={HUE}>
          <div className="mb-4">
            <div
              className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Estilo de quebra
            </div>
            <ToolChoice<SubtitleStyle>
              value={style}
              onChange={setStyle}
              disabled={processing}
              options={[
                { value: 'single', label: '1 linha', sub: 'curta · sem quebra' },
                { value: 'balanced', label: 'Equilibrada', sub: 'blocos médios' },
                { value: 'cinema', label: '2 linhas', sub: 'cinema · broadcast' },
              ]}
            />
            <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
              <span className="font-semibold text-white">1 linha</span> evita a quebra de
              linha e cai melhor nos Modelos/Animações do CapCut. Tempos e texto continuam
              idênticos — muda só o tamanho dos blocos.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {processing ? (
              <CancelButton onClick={handleCancel} label="Cancelar" />
            ) : (
              <ToolAction
                onClick={process}
                disabled={!file || !!validation || !copyText.trim()}
              >
                Gerar SRT
              </ToolAction>
            )}
            <button
              onClick={() => {
                reset();
                setFile(null);
                setCopyText('');
              }}
              className="btn-secondary"
              disabled={processing}
            >
              Limpar
            </button>
          </div>

          {error ? (
            <div
              key={error}
              role="alert"
              className="error-shake mt-4 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
            >
              {error}
            </div>
          ) : null}

          {stage ? (
            <div
              className={
                'mt-4 rounded-[12px] border px-4 py-3 text-xs ' +
                (processing
                  ? 'scan-line border-violet/40 bg-violet/5 text-violet'
                  : 'border-line bg-bg text-text-muted')
              }
            >
              <div className="flex items-center gap-2">
                {processing ? (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
                  </span>
                ) : null}
                <span
                  className="text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {stage}
                </span>
              </div>
              {progress !== null ? (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-violet transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </ToolStep>

        {srt ? (
          <div className="fade-in-up">
            <ToolResultCard
              title="SRT gerado"
              meta={file ? file.name.replace(/\.[^.]+$/, '') + '.srt' : undefined}
              hue={HUE}
            >
              <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">
                <ToolMetric value={String(lineCount)} label="Legendas" accent="violet" />
                <ToolMetric
                  value={formatBytes(new Blob([srt]).size)}
                  label="Tamanho"
                  accent="violet"
                />
                <ToolMetric value=".SRT" label="Formato" accent="violet" />
              </div>
              <pre
                className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-[12px] border border-violet/25 bg-black/40 p-4 text-xs leading-relaxed text-white/90"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {srt}
              </pre>
              <div className="mt-4 flex flex-wrap gap-3">
                <ToolAction onClick={download}>Baixar .SRT</ToolAction>
              </div>

              {/* Guia de importação — o SRT só vira legenda "de verdade"
                  (que aceita Modelos/Animações) quando importado pelo menu
                  de Legendas. Arrastar pra timeline vira texto solto e
                  bloqueia os modelos. É o erro nº1 de quem usa SRT no CapCut. */}
              <div className="mt-5 rounded-[14px] border border-amber-400/30 bg-amber-400/[0.04] p-4">
                <div className="flex items-center gap-2">
                  <span className="text-[15px]" aria-hidden>🎬</span>
                  <h4
                    className="text-[12px] font-bold uppercase tracking-[0.16em] text-amber-200"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Importar no CapCut pra aceitar modelos e animações
                  </h4>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">
                  O arquivo já está no formato certo. O segredo é o{' '}
                  <span className="font-semibold text-white">caminho de importação</span> —
                  pelo menu de Legendas, nunca arrastando pra timeline.
                </p>
                <ol className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-white/85">
                  <li>
                    <span className="mono text-amber-300">1.</span> Abra o projeto com o vídeo na
                    timeline — CapCut <span className="font-semibold">Desktop</span> ou{' '}
                    <span className="font-semibold">Web</span> (capcut.com).
                  </li>
                  <li>
                    <span className="mono text-amber-300">2.</span> Vá em{' '}
                    <span className="font-semibold text-white">Texto → Legendas</span> e clique em{' '}
                    <span className="font-semibold text-white">Importar arquivo</span>.
                  </li>
                  <li>
                    <span className="mono text-amber-300">3.</span> Selecione o{' '}
                    <span className="mono">.srt</span> que você baixou aqui.
                  </li>
                  <li>
                    <span className="mono text-amber-300">4.</span> Vira faixa de legenda nativa —
                    agora <span className="font-semibold text-white">Modelos</span>,{' '}
                    <span className="font-semibold text-white">Estilos</span> e{' '}
                    <span className="font-semibold text-white">Animações</span> aplicam, inclusive o{' '}
                    <span className="font-semibold text-white">&quot;Aplicar a todas&quot;</span>.
                  </li>
                </ol>
                <div className="mt-3 rounded-[10px] border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-red-200">
                  <span className="font-bold">Não</span> arraste o{' '}
                  <span className="mono">.srt</span> pra timeline nem importe como mídia — assim ele
                  vira texto solto e os modelos/animações ficam bloqueados. No{' '}
                  <span className="font-semibold">celular</span> o CapCut não importa legenda; use
                  Desktop ou Web.
                </div>
              </div>
            </ToolResultCard>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
