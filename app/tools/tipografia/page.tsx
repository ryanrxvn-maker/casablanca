'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import { logHistory } from '@/lib/history';
import { toFriendlyMessage, FriendlyError } from '@/lib/friendly-error';
import { downloadBlob } from '@/lib/audio-engine';
import { formatBytes, formatTime } from '@/lib/utils';
import {
  cancelFFmpeg,
  extractAudioForTranscription,
  isCancellationError,
  probeVideoMetadata,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import {
  ToolHero,
  ToolStep,
  ToolDropzone,
  ToolAction,
  ToolChoice,
  ToolSlider,
  ToolResultCard,
  ToolMetric,
} from '@/components/tool-kit';
import {
  IconTipografia,
  IconStepMic,
  IconStepText,
  IconStepPlay,
} from '@/components/ToolIcons';
import {
  drawCaptions,
  drawPresetDemo,
  captionBBoxAt,
  DEFAULT_STYLE,
  type Block,
  type StyleState,
  type PerBlockStyle,
  type TWord,
} from '@/lib/typography/engine';
import { TYPO_PRESETS, TYPO_CATEGORIES, getPreset } from '@/lib/typography/presets';
import {
  ensureTypoFonts,
  TYPO_FONTS,
  FONT_GROUPS,
  type FontKey,
} from '@/lib/typography/fonts';
import {
  groupWords,
  blockText,
  retimeBlockText,
  splitBlock,
  mergeBlocks,
  type GroupPace,
} from '@/lib/typography/group';
import {
  renderTypographyVideo,
  type RenderProgress,
} from '@/lib/typography/export';

/**
 * TIPOGRAFIA AUTOMÁTICA — sobe o vídeo, a transcrição vira legenda com
 * lettering animado profissional (estilo preset de Premiere), tudo editável
 * no navegador e queimado no vídeo SEM custo de servidor.
 */

const MAX_FILE_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 20 * 60;
const HUE = 'rgba(255,159,10,0.45)';

type Phase = 'idle' | 'transcribing' | 'ready' | 'rendering';
type Language = 'pt' | 'en' | 'es' | 'auto';
type UpperMode = 'auto' | 'on' | 'off'; // legado (migração de sessões antigas)
type CaseMode = 'auto' | 'upper' | 'lower' | 'original';

type ResultState = {
  url: string;
  size: number;
  width: number;
  height: number;
  audioOk: boolean;
} | null;

function sigOf(file: File): string {
  return `tipografia:v1:${file.name}:${file.size}`;
}

type SavedSession = {
  words: TWord[];
  blocks: Block[];
  presetId: string;
  fontScale: number;
  posY: number;
  primary: string | null;
  accent: string | null;
  upper: UpperMode;
  pace: GroupPace;
  language: Language;
  highlights: Record<string, number[]>;
  autoEmph?: boolean;
  fontOv?: FontKey | null;
  posX?: number;
  textCase?: CaseMode;
  bold?: boolean;
  italic?: boolean;
  blockStyles?: Record<string, PerBlockStyle>;
};

function saveSession(file: File, s: SavedSession) {
  try {
    sessionStorage.setItem(sigOf(file), JSON.stringify(s));
  } catch {
    /* storage cheio — segue sem persistir */
  }
}

function loadSession(file: File): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(sigOf(file));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!Array.isArray(parsed.blocks) || !Array.isArray(parsed.words)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function TipografiaPage() {
  // Liberada pra TODOS os tiers (incl. free) — o middleware só exige login.
  return <TipografiaInner />;
}

function TipografiaInner() {
  const [file, setFile] = useToolState<File | null>('tipografia:file', null);
  const [duration, setDuration] = useToolState<number | null>('tipografia:dur', null);
  const [words, setWords] = useToolState<TWord[]>('tipografia:words', []);
  const [blocks, setBlocks] = useToolState<Block[]>('tipografia:blocks', []);
  const [phase, setPhase] = useToolState<Phase>('tipografia:phase', 'idle');
  const [stage, setStage] = useToolState<string | null>('tipografia:stage', null);
  const [progress, setProgress] = useToolState<number | null>('tipografia:progress', null);
  const [error, setError] = useToolState<string | null>('tipografia:error', null);
  const [result, setResult] = useToolState<ResultState>('tipografia:result', null);
  const [restored, setRestored] = useState(false);

  // estilo
  const [presetId, setPresetId] = useToolState<string>('tipografia:preset', TYPO_PRESETS[0].id);
  const [fontScale, setFontScale] = useToolState<number>('tipografia:scale', 1);
  const [posY, setPosY] = useToolState<number>('tipografia:posy', DEFAULT_STYLE.posY);
  const [primary, setPrimary] = useToolState<string | null>('tipografia:cor1', null);
  const [accent, setAccent] = useToolState<string | null>('tipografia:cor2', null);
  const [textCase, setTextCase] = useToolState<CaseMode>('tipografia:case', 'auto');
  const [bold, setBold] = useToolState<boolean>('tipografia:bold', false);
  const [italic, setItalic] = useToolState<boolean>('tipografia:italic', false);
  const [underlineG, setUnderlineG] = useToolState<boolean>('tipografia:underline', false);
  const [fxStrokeG, setFxStrokeG] = useToolState<number>('tipografia:fxstroke', 1);
  const [fxShadowG, setFxShadowG] = useToolState<number>('tipografia:fxshadow', 1);
  const [fxGlowG, setFxGlowG] = useToolState<number>('tipografia:fxglow', 1);
  const [fxSmokeG, setFxSmokeG] = useToolState<number>('tipografia:fxsmoke', 1);
  const [applyAll, setApplyAll] = useToolState<boolean>('tipografia:applyall', true);
  const [blockStyles, setBlockStyles] = useToolState<Record<string, PerBlockStyle>>(
    'tipografia:blockstyles',
    {},
  );
  const [pace, setPace] = useToolState<GroupPace>('tipografia:pace', 'equilibrado');
  const [language, setLanguage] = useToolState<Language>('tipografia:lang', 'pt');
  const [highlights, setHighlights] = useToolState<Record<string, number[]>>(
    'tipografia:hl',
    {},
  );
  const [autoEmph, setAutoEmph] = useToolState<boolean>('tipografia:autoemph', true);
  const [fontOv, setFontOv] = useToolState<FontKey | null>('tipografia:fontov', null);
  const [posX, setPosX] = useToolState<number>('tipografia:posx', 0.5);
  const [selBlockId, setSelBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ── Ctrl+Z: histórico de edição (até 40 passos) ──────────────────────────
  type Snapshot = {
    blocks: Block[];
    highlights: Record<string, number[]>;
    blockStyles: Record<string, PerBlockStyle>;
    presetId: string;
    fontScale: number;
    posX: number;
    posY: number;
    primary: string | null;
    accent: string | null;
    textCase: CaseMode;
    bold: boolean;
    italic: boolean;
    fontOv: FontKey | null;
  };
  const historyRef = useRef<Snapshot[]>([]);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = {
    blocks,
    highlights,
    blockStyles,
    presetId,
    fontScale,
    posX,
    posY,
    primary,
    accent,
    textCase,
    bold,
    italic,
    fontOv,
  };
  const pushHistory = useCallback(() => {
    const s = snapRef.current;
    if (!s) return;
    historyRef.current.push(s);
    if (historyRef.current.length > 40) historyRef.current.shift();
  }, []);
  const undo = useCallback(() => {
    const s = historyRef.current.pop();
    if (!s) return;
    setBlocks(s.blocks);
    setHighlights(s.highlights);
    setBlockStyles(s.blockStyles);
    setPresetId(s.presetId);
    setFontScale(s.fontScale);
    setPosX(s.posX);
    setPosY(s.posY);
    setPrimary(s.primary);
    setAccent(s.accent);
    setTextCase(s.textCase);
    setBold(s.bold);
    setItalic(s.italic);
    setFontOv(s.fontOv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const style = useMemo<StyleState>(
    () => ({
      presetId,
      fontScale,
      posY,
      primary,
      accent,
      uppercase: null,
      textCase: textCase === 'auto' ? null : textCase,
      bold,
      italic,
      underline: underlineG,
      fxStroke: fxStrokeG,
      fxShadow: fxShadowG,
      fxGlow: fxGlowG,
      fxSmoke: fxSmokeG,
      highlights,
      autoEmphasis: autoEmph,
      fontOverride: fontOv,
      posX,
      perBlock: blockStyles,
    }),
    [presetId, fontScale, posY, primary, accent, textCase, bold, italic, underlineG, fxStrokeG, fxShadowG, fxGlowG, fxSmokeG, highlights, autoEmph, fontOv, posX, blockStyles],
  );

  // ── "Aplicar a todas" × edição por bloco ─────────────────────────────────
  // ligado: mexeu, mexeu em todas (estados globais). desligado + bloco
  // selecionado: o ajuste vira override SÓ daquele bloco (perBlock do engine).
  const editingBlockId = !applyAll && selBlockId ? selBlockId : null;
  const smartSet = useCallback(
    (patch: PerBlockStyle) => {
      if (!editingBlockId) {
        if (patch.fontScale !== undefined) setFontScale(patch.fontScale);
        if (patch.primary !== undefined) setPrimary(patch.primary);
        if (patch.accent !== undefined) setAccent(patch.accent);
        if (patch.posX !== undefined) setPosX(patch.posX);
        if (patch.posY !== undefined) setPosY(patch.posY);
        if (patch.textCase !== undefined) setTextCase(patch.textCase ?? 'auto');
        if (patch.bold !== undefined) setBold(patch.bold);
        if (patch.italic !== undefined) setItalic(patch.italic);
        if (patch.underline !== undefined) setUnderlineG(patch.underline);
        if (patch.fxStroke !== undefined) setFxStrokeG(patch.fxStroke);
        if (patch.fxShadow !== undefined) setFxShadowG(patch.fxShadow);
        if (patch.fxGlow !== undefined) setFxGlowG(patch.fxGlow);
        if (patch.fxSmoke !== undefined) setFxSmokeG(patch.fxSmoke);
        if (patch.fontOverride !== undefined) setFontOv(patch.fontOverride ?? null);
        return;
      }
      setBlockStyles((prev) => ({
        ...prev,
        [editingBlockId]: { ...prev[editingBlockId], ...patch },
      }));
    },
    [editingBlockId, setFontScale, setPrimary, setAccent, setPosX, setPosY, setTextCase, setBold, setItalic, setUnderlineG, setFxStrokeG, setFxShadowG, setFxGlowG, setFxSmokeG, setFontOv, setBlockStyles],
  );
  const effOf = useCallback(
    <K extends keyof PerBlockStyle>(k: K, global: PerBlockStyle[K]): PerBlockStyle[K] => {
      if (editingBlockId) {
        const ov = blockStyles[editingBlockId];
        if (ov && ov[k] !== undefined) return ov[k];
      }
      return global;
    },
    [editingBlockId, blockStyles],
  );

  const videoUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // fontes pro preview (o export garante de novo por conta própria)
  useEffect(() => {
    if (phase === 'ready') void ensureTypoFonts();
  }, [phase]);

  // metadados + restauração de sessão anterior (F5 não perde a edição)
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
    if (blocks.length === 0) {
      const saved = loadSession(file);
      if (saved) {
        setWords(saved.words);
        setBlocks(saved.blocks);
        setPresetId(saved.presetId);
        setFontScale(saved.fontScale);
        setPosY(saved.posY);
        setPrimary(saved.primary);
        setAccent(saved.accent);
        // migração de sessões antigas (upper) → textCase novo
        setTextCase(
          saved.textCase ??
            (saved.upper === 'on' ? 'upper' : saved.upper === 'off' ? 'original' : 'auto'),
        );
        setBold(saved.bold ?? false);
        setItalic(saved.italic ?? false);
        setBlockStyles(saved.blockStyles ?? {});
        setPace(saved.pace);
        setLanguage(saved.language);
        setHighlights(saved.highlights ?? {});
        setAutoEmph(saved.autoEmph ?? true);
        setFontOv(saved.fontOv ?? null);
        setPosX(saved.posX ?? 0.5);
        setPhase('ready');
        setRestored(true);
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // persiste a edição na sessão a cada mudança relevante
  useEffect(() => {
    if (!file || phase !== 'ready' || blocks.length === 0) return;
    saveSession(file, {
      words,
      blocks,
      presetId,
      fontScale,
      posY,
      primary,
      accent,
      upper: 'auto',
      pace,
      language,
      highlights,
      autoEmph,
      fontOv,
      posX,
      textCase,
      bold,
      italic,
      blockStyles,
    });
  }, [file, phase, words, blocks, presetId, fontScale, posY, primary, accent, pace, language, highlights, autoEmph, fontOv, posX, textCase, bold, italic, blockStyles]);

  const validation = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      return `Arquivo de ${formatBytes(file.size)} excede o limite de 800MB.`;
    }
    if (duration !== null && duration > MAX_DURATION_SEC) {
      return `Vídeo de ${Math.round(duration / 60)}min excede o limite de 20min desta ferramenta.`;
    }
    return null;
  }, [file, duration]);

  function resetAll() {
    setWords([]);
    setBlocks([]);
    setHighlights({});
    setPhase('idle');
    setStage(null);
    setProgress(null);
    setError(null);
    setResult(null);
    setRestored(false);
    setSelBlockId(null);
  }

  function handleCancel() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

  // ── transcrição ──
  async function transcribe() {
    if (!file) return;
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setResult(null);
    setPhase('transcribing');
    try {
      setStage('Extraindo áudio do vídeo...');
      setProgress(0.05);
      const audio = await extractAudioForTranscription(
        file,
        {
          onStage: (s) => setStage(s),
          onProgress: (p: FFProgress) => setProgress(p.ratio * 0.45),
        },
        duration ?? undefined,
      );
      if (audio.size > 4_400_000) {
        throw new FriendlyError(
          `O áudio ficou grande demais pra enviar (${formatBytes(audio.size)}). Usa um vídeo mais curto e tenta de novo.`,
        );
      }

      setStage('Transcrevendo palavra por palavra...');
      setProgress(0.55);
      const fd = new FormData();
      fd.append('audio', audio, 'audio.opus');
      fd.append('language', language);
      abortRef.current = new AbortController();
      const res = await fetch('/api/tipografia/transcribe', {
        method: 'POST',
        body: fd,
        signal: abortRef.current.signal,
      });
      const text = await res.text();
      let json: { words?: TWord[]; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        throw new FriendlyError(
          /Request Entity Too Large/i.test(text)
            ? 'O áudio ficou grande demais pra enviar. Usa um vídeo mais curto e tenta de novo.'
            : 'O servidor não respondeu como esperado. Tenta de novo em instantes.',
        );
      }
      if (!res.ok || !json.words || json.words.length === 0) {
        throw new FriendlyError(json.error || 'Não consegui transcrever agora. Tenta de novo em instantes.');
      }

      setWords(json.words);
      setBlocks(groupWords(json.words, pace));
      setHighlights({});
      setStage(null);
      setProgress(null);
      setPhase('ready');
      setRestored(false);
    } catch (e) {
      console.error(e);
      if (isCancellationError(e) || (e as Error)?.name === 'AbortError') {
        setStage('Cancelado por você.');
        setError(null);
      } else {
        setError(toFriendlyMessage(e, 'Não consegui transcrever agora. Tenta de novo em instantes.'));
        setStage(null);
      }
      setProgress(null);
      setPhase('idle');
    } finally {
      abortRef.current = null;
    }
  }

  // ── render final ──
  async function renderFinal() {
    if (!file || blocks.length === 0) return;
    setError(null);
    setResult(null);
    setPhase('rendering');
    abortRef.current = new AbortController();
    try {
      const out = await renderTypographyVideo({
        file,
        blocks,
        preset,
        style,
        signal: abortRef.current.signal,
        onProgress: (p: RenderProgress) => {
          if (p.phase === 'fontes') {
            setStage('Carregando fontes...');
            setProgress(0.02);
          } else if (p.phase === 'frames') {
            setStage(
              `Renderizando letterings — frame ${p.frame ?? 0}/${p.totalFrames ?? 0}`,
            );
            setProgress(0.03 + p.ratio * 0.82);
          } else if (p.phase === 'audio') {
            setStage('Devolvendo o áudio original...');
            setProgress(0.85 + p.ratio * 0.14);
          } else {
            setStage('Finalizando o MP4...');
            setProgress(1);
          }
        },
      });
      const url = URL.createObjectURL(out.blob);
      setResult({
        url,
        size: out.blob.size,
        width: out.width,
        height: out.height,
        audioOk: out.audioOk,
      });
      logHistory({ tool: 'tipografia', title: `Letterings queimados em ${file.name}` });
      // FLUXO: renderizou = baixou. O download começa sozinho; o card ainda
      // tem "Baixar de novo" caso o navegador segure o primeiro.
      try {
        const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
        await downloadBlob(out.blob, `${base}_letterings.mp4`);
      } catch {
        /* botão do card cobre */
      }
      setStage(null);
      setProgress(null);
      setPhase('ready');
    } catch (e) {
      console.error(e);
      if (isCancellationError(e) || (e as Error)?.name === 'AbortError') {
        setStage('Cancelado por você.');
        setError(null);
      } else {
        setError(toFriendlyMessage(e, 'O render falhou no meio. Tenta de novo — se repetir, fecha outras abas pesadas.'));
        setStage(null);
      }
      setProgress(null);
      setPhase('ready');
    } finally {
      abortRef.current = null;
    }
  }

  async function downloadMp4() {
    if (!result || !file) return;
    const res = await fetch(result.url);
    const blob = await res.blob();
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
    await downloadBlob(blob, `${base}_letterings.mp4`);
  }

  // ── edição de blocos ──
  const updateBlock = useCallback(
    (id: string, fn: (b: Block) => Block | null) => {
      setBlocks((prev) => {
        const out: Block[] = [];
        for (const b of prev) {
          if (b.id !== id) {
            out.push(b);
            continue;
          }
          const nb = fn(b);
          if (nb) out.push(nb);
        }
        return out;
      });
    },
    [setBlocks],
  );

  function editBlockText(id: string, text: string) {
    pushHistory();
    updateBlock(id, (b) => {
      const nb = retimeBlockText(b, text);
      if (nb.id === b.id && nb.words.length !== b.words.length) {
        setHighlights((h) => {
          const cur = h[b.id];
          if (!cur) return h;
          return { ...h, [b.id]: cur.filter((i) => i < nb.words.length) };
        });
      }
      return nb;
    });
  }

  function doSplit(id: string) {
    pushHistory();
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const pair = splitBlock(prev[idx]);
      if (!pair) return prev;
      const next = [...prev];
      next.splice(idx, 1, pair[0], pair[1]);
      setSelBlockId(pair[0].id);
      return next;
    });
  }

  function doMerge(id: string) {
    pushHistory();
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const merged = mergeBlocks(prev[idx], prev[idx + 1]);
      const next = [...prev];
      next.splice(idx, 2, merged);
      setSelBlockId(merged.id);
      return next;
    });
  }

  function nudge(id: string, edge: 'start' | 'end', delta: number) {
    pushHistory();
    updateBlock(id, (b) => {
      if (edge === 'start') {
        const start = Math.max(0, Math.min(b.start + delta, b.end - 120));
        return { ...b, start };
      }
      const end = Math.max(b.start + 120, b.end + delta);
      return { ...b, end };
    });
  }

  // mover/cortar pela TIMELINE: move desloca o bloco inteiro (palavras junto,
  // pro karaokê não descolar); trim só mexe a janela de exibição
  function retimeBounds(id: string, start: number, end: number, mode: 'move' | 'trim') {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const b = prev[idx];
      const minStart = idx > 0 ? prev[idx - 1].end + 20 : 0;
      const maxEnd = idx < prev.length - 1 ? prev[idx + 1].start - 20 : Number.MAX_SAFE_INTEGER;
      if (mode === 'move') {
        const len = b.end - b.start;
        let s = Math.max(minStart, Math.min(start, maxEnd - len));
        if (!isFinite(s) || s < 0) s = 0;
        const delta = Math.round(s - b.start);
        if (delta === 0) return prev;
        const words = b.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta }));
        const next = [...prev];
        next[idx] = { ...b, start: b.start + delta, end: b.end + delta, words };
        return next;
      }
      const s = Math.max(minStart, Math.min(start, end - 120));
      const e = Math.min(maxEnd, Math.max(end, s + 120));
      if (e - s < 120) return prev;
      const next = [...prev];
      next[idx] = { ...b, start: Math.round(s), end: Math.round(e) };
      return next;
    });
  }

  function toggleHighlight(blockId: string, wordIdx: number) {
    pushHistory();
    setHighlights((h) => {
      const cur = new Set(h[blockId] ?? []);
      if (cur.has(wordIdx)) cur.delete(wordIdx);
      else cur.add(wordIdx);
      return { ...h, [blockId]: Array.from(cur).sort((a, b) => a - b) };
    });
  }

  function regroup(newPace: GroupPace) {
    pushHistory();
    setPace(newPace);
    if (words.length > 0) {
      setBlocks(groupWords(words, newPace));
      setHighlights({});
    }
  }

  function seekTo(ms: number) {
    const v = videoRef.current;
    if (v) v.currentTime = ms / 1000 + 0.02;
  }

  const processing = phase === 'transcribing' || phase === 'rendering';
  const totalWords = words.length;

  return (
    <div className="mx-auto w-full max-w-[1920px] px-5 pt-6 md:px-8">
      <ToolHero
        title="Tipografia Automática"
        eyebrow="Letterings animados"
        subtitle="Sobe o vídeo e a fala vira lettering animado profissional, no tempo exato do áudio — escolhe o modelo, edita direto no preview e baixa com a legenda queimada."
        hue={HUE}
        icon={<IconTipografia size={30} />}
      />
      <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-6">
      <div className="flex flex-col gap-5">
        <MissingKeyBanner services={['groq']} />

        {/* ── Passos 1 e 2 lado a lado (economia vertical) ── */}
        <div className="grid gap-5 lg:grid-cols-2">
        <ToolStep
          n={1}
          icon={<IconStepMic size={18} />}
          title="Vídeo"
          hint="MP4, MOV ou WEBM — até 800MB e 20min"
          hue={HUE}
        >
          <ToolDropzone
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            file={file}
            onFile={(f) => {
              resetAll();
              setFile(f);
            }}
            disabled={processing}
            hue={HUE}
          />
          {file ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <ToolMetric value={formatBytes(file.size)} label="Tamanho" />
              {duration !== null ? (
                <ToolMetric value={formatTime(duration)} label="Duração" accent="lime" />
              ) : null}
              {totalWords > 0 ? (
                <ToolMetric value={String(totalWords)} label="Palavras" accent="violet" />
              ) : null}
            </div>
          ) : null}
          {validation ? (
            <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {validation}
            </div>
          ) : null}
        </ToolStep>

        {/* ── Passo 2: transcrição ── */}
        <ToolStep
          n={2}
          icon={<IconStepText size={18} />}
          title="Legendas automáticas"
          hint="Transcreve a fala palavra por palavra e monta os blocos no ritmo certo"
          hue={HUE}
        >
          <div className="mb-3 max-w-[420px]">
            <ToolChoice
              value={language}
              onChange={(v) => setLanguage(v)}
              disabled={processing}
              hue={HUE}
              options={[
                { value: 'pt', label: 'Português' },
                { value: 'en', label: 'Inglês' },
                { value: 'es', label: 'Espanhol' },
                { value: 'auto', label: 'Detectar', sub: 'auto' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {phase === 'transcribing' ? (
              <CancelButton onClick={handleCancel} label="Cancelar" />
            ) : (
              <ToolAction
                onClick={transcribe}
                disabled={!file || !!validation || processing}
              >
                {blocks.length > 0 ? 'Transcrever de novo' : 'Gerar legendas'}
              </ToolAction>
            )}
            {restored ? (
              <span className="rounded-[10px] border border-lime/30 bg-lime/10 px-3 py-1.5 text-[11px] font-semibold text-lime">
                Edição anterior restaurada
              </span>
            ) : null}
          </div>
        </ToolStep>
        </div>

        {/* ── Passo 3: editor ── */}
        {blocks.length > 0 && videoUrl ? (
          <ToolStep
            n={3}
            icon={<IconStepText size={18} />}
            title="Modelo e edição"
            hint="Clica no modelo pra ver ao vivo — o preview é exatamente o que sai no MP4"
            hue={HUE}
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(380px,500px)_minmax(0,1fr)]">
              <div className="min-w-0">
                <PreviewPane
                  videoUrl={videoUrl}
                  videoRef={videoRef}
                  blocks={blocks}
                  preset={preset}
                  style={style}
                  fontScale={effOf('fontScale', fontScale) ?? fontScale}
                  onFontScale={(v) => smartSet({ fontScale: v })}
                  onTimeBlock={setActiveBlockId}
                  onPosChange={(x, y) => smartSet({ posX: x, posY: y })}
                  onInteractStart={pushHistory}
                  onSelectBlock={(id) => setSelBlockId(id)}
                  onEditText={editBlockText}
                />
                <p className="mt-2 text-[10.5px] leading-relaxed text-text-muted">
                  Arrasta a legenda pra posicionar (snap no centro) · clique
                  seleciona e mostra a alça de tamanho · duplo clique edita o
                  texto ali mesmo
                </p>
              </div>
              <div className="min-w-0 flex flex-col gap-5">
                <PresetGallery
                  presetId={presetId}
                  onPick={(id) => {
                    pushHistory();
                    setPresetId(id);
                  }}
                  disabled={processing}
                />
                <FontPicker
                  value={effOf('fontOverride', fontOv) ?? null}
                  presetFont={preset.font}
                  onPick={(k) => {
                    pushHistory();
                    smartSet({ fontOverride: k });
                  }}
                  disabled={processing}
                />
                <StylePanel
                  fontScale={effOf('fontScale', fontScale) ?? fontScale}
                  posY={effOf('posY', posY) ?? posY}
                  primary={effOf('primary', primary) ?? null}
                  accent={effOf('accent', accent) ?? null}
                  textCase={(effOf('textCase', textCase === 'auto' ? null : textCase) ?? null) as CaseMode | null}
                  bold={effOf('bold', bold) ?? false}
                  italic={effOf('italic', italic) ?? false}
                  underline={effOf('underline', underlineG) ?? false}
                  fxStroke={effOf('fxStroke', fxStrokeG) ?? 1}
                  fxShadow={effOf('fxShadow', fxShadowG) ?? 1}
                  fxGlow={effOf('fxGlow', fxGlowG) ?? 1}
                  fxSmoke={effOf('fxSmoke', fxSmokeG) ?? 1}
                  onSlide={smartSet}
                  onSet={(patch) => {
                    pushHistory();
                    smartSet(patch);
                  }}
                  applyAll={applyAll}
                  setApplyAll={setApplyAll}
                  editingLabel={
                    editingBlockId
                      ? blockText(blocks.find((b) => b.id === editingBlockId) ?? blocks[0]).slice(0, 28)
                      : null
                  }
                  autoEmph={autoEmph}
                  setAutoEmph={setAutoEmph}
                  pace={pace}
                  regroup={regroup}
                  defaultPrimary={preset.defaultPrimary}
                  defaultAccent={preset.defaultAccent}
                  disabled={processing}
                />
              </div>
            </div>

            <Timeline
              blocks={blocks}
              duration={duration ?? 0}
              videoRef={videoRef}
              videoUrl={videoUrl}
              presetCat={preset.cat}
              selId={selBlockId}
              onSelect={(id) => setSelBlockId(id)}
              onRetime={retimeBounds}
              onDragStart={pushHistory}
              disabled={processing}
            />

            <BlockList
              blocks={blocks}
              selId={selBlockId}
              activeId={activeBlockId}
              highlights={highlights}
              onSelect={(b) => {
                setSelBlockId(b.id);
                seekTo(b.start);
              }}
              onEditText={editBlockText}
              onSplit={doSplit}
              onMerge={doMerge}
              onDelete={(id) => {
                pushHistory();
                updateBlock(id, () => null);
              }}
              onNudge={nudge}
              onToggleWord={toggleHighlight}
              disabled={processing}
            />
          </ToolStep>
        ) : null}

        {/* ── Passo 4: render ── */}
        {blocks.length > 0 ? (
          <ToolStep n={4} icon={<IconStepPlay size={18} />} title="Gerar vídeo final" hue={HUE}>
            <div className="flex flex-wrap gap-3">
              {phase === 'rendering' ? (
                <CancelButton onClick={handleCancel} label="Cancelar render" />
              ) : (
                <ToolAction onClick={renderFinal} disabled={processing || !file}>
                  Renderizar vídeo
                </ToolAction>
              )}
            </div>
            <p className="mt-2 text-[11.5px] text-text-muted">
              O render roda no seu navegador, acelerado por hardware — quando
              terminar, o download começa sozinho. Deixa a aba aberta até o fim.
            </p>
          </ToolStep>
        ) : null}

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {stage ? (
          <div
            className={
              'rounded-[12px] border px-4 py-3 text-xs ' +
              (processing
                ? 'scan-line border-amber-400/40 bg-amber-400/5 text-amber-200'
                : 'border-line bg-bg text-text-muted')
            }
          >
            <div className="flex items-center gap-2">
              {processing ? (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
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
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="fade-in-up">
            <ToolResultCard
              title="Vídeo com letterings"
              meta={file ? file.name.replace(/\.[^.]+$/, '') + '_letterings.mp4' : undefined}
              hue={HUE}
            >
              <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <ToolMetric value={formatBytes(result.size)} label="Tamanho" accent="lime" />
                <ToolMetric value={`${result.width}×${result.height}`} label="Resolução" />
                <ToolMetric value={String(blocks.length)} label="Blocos" accent="violet" />
                <ToolMetric value={preset.name} label="Modelo" />
              </div>
              {!result.audioOk ? (
                <div className="mb-4 rounded-[10px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  O vídeo original não tinha trilha de áudio (ou a extração falhou) — o
                  MP4 saiu sem som.
                </div>
              ) : null}
              <video
                src={result.url}
                controls
                playsInline
                className="max-h-[420px] w-full rounded-[12px] border border-line bg-black"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ToolAction onClick={downloadMp4}>Baixar de novo</ToolAction>
                <span className="text-[11px] text-text-muted">
                  O download começou sozinho — se o navegador segurou, usa o botão.
                </span>
              </div>
            </ToolResultCard>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Preview ───────────────────────── */

function PreviewPane({
  videoUrl,
  videoRef,
  blocks,
  preset,
  style,
  fontScale,
  onFontScale,
  onTimeBlock,
  onPosChange,
  onInteractStart,
  onSelectBlock,
  onEditText,
}: {
  videoUrl: string;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  blocks: Block[];
  preset: ReturnType<typeof getPreset>;
  style: StyleState;
  fontScale: number;
  onFontScale: (v: number) => void;
  onTimeBlock: (id: string | null) => void;
  onPosChange: (x: number, y: number) => void;
  onInteractStart: () => void;
  onSelectBlock: (id: string) => void;
  onEditText: (id: string, text: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // drag da legenda: estado vivo pro rAF desenhar as guias sem re-render
  const dragRef = useRef<{
    mode: 'move' | 'scale';
    moved: boolean;
    snapX: boolean;
    snapY: boolean;
    dist0: number;
    scale0: number;
  } | null>(null);
  // seleção (caixa + alça) e bbox vivos pro rAF
  const selRef = useRef(false);
  const bboxRef = useRef<{ x: number; y: number; w: number; h: number; blockId: string } | null>(null);
  const dprRef = useRef(1);
  const [editing, setEditing] = useState<{
    id: string;
    value: string;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  // refs pros valores vivos dentro do rAF (evita recriar o loop a cada edição)
  const liveRef = useRef({ blocks, preset, style, fontScale });
  liveRef.current = { blocks, preset, style, fontScale };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (v && c && wrap && v.videoWidth > 0) {
        const cssW = wrap.clientWidth;
        const cssH = (cssW * v.videoHeight) / v.videoWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = Math.round(cssW * dpr);
        const H = Math.round(cssH * dpr);
        if (c.width !== W || c.height !== H) {
          c.width = W;
          c.height = H;
        }
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          const { blocks: b, preset: p, style: s } = liveRef.current;
          drawCaptions(ctx, b, p, s, v.currentTime * 1000, W, H);
          dprRef.current = dpr;
          // bbox viva pro hit-test (clicar/arrastar/alça/duplo clique)
          bboxRef.current = captionBBoxAt(ctx, b, p, s, v.currentTime * 1000, W, H);
          // caixa de seleção estilo CapCut (só preview, nunca no export)
          const bb = bboxRef.current;
          if (selRef.current && bb) {
            ctx.save();
            ctx.strokeStyle = 'rgba(251,191,36,0.95)';
            ctx.lineWidth = Math.max(1.5, dpr);
            ctx.setLineDash([7 * dpr, 5 * dpr]);
            ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
            ctx.setLineDash([]);
            // alça de redimensionar (canto inferior direito)
            const hs = 9 * dpr;
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = '#1a1a1a';
            ctx.fillRect(bb.x + bb.w - hs / 2, bb.y + bb.h - hs / 2, hs, hs);
            ctx.strokeRect(bb.x + bb.w - hs / 2, bb.y + bb.h - hs / 2, hs, hs);
            ctx.restore();
          }
          // réguas de centralização (só no preview, nunca no export)
          const drag = dragRef.current;
          if (drag && drag.mode === 'move' && drag.moved) {
            ctx.save();
            ctx.lineWidth = Math.max(1, dpr);
            ctx.setLineDash(drag.snapX ? [] : [6 * dpr, 6 * dpr]);
            ctx.strokeStyle = drag.snapX ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.45)';
            ctx.beginPath();
            ctx.moveTo(W / 2, 0);
            ctx.lineTo(W / 2, H);
            ctx.stroke();
            ctx.setLineDash(drag.snapY ? [] : [6 * dpr, 6 * dpr]);
            ctx.strokeStyle = drag.snapY ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.45)';
            ctx.beginPath();
            ctx.moveTo(0, H / 2);
            ctx.lineTo(W, H / 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  // bloco ativo (4Hz via timeupdate — não re-renderiza a 60fps)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCur(v.currentTime);
      const t = v.currentTime * 1000;
      const b = liveRef.current.blocks.find((x) => t >= x.start && t < x.end);
      onTimeBlock(b?.id ?? null);
    };
    const onMeta = () => {
      setDur(v.duration || 0);
      setDims({ w: v.videoWidth, h: v.videoHeight });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [videoRef, onTimeBlock]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="min-w-0">
      <div
        ref={wrapRef}
        className="relative w-full touch-none overflow-hidden rounded-[14px] border border-line bg-black"
        style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : { minHeight: 220 }}
        onPointerDown={(e) => {
          const wrap = wrapRef.current;
          if (!wrap || editing) return;
          wrap.setPointerCapture(e.pointerId);
          const rect = wrap.getBoundingClientRect();
          const dpr = dprRef.current;
          const px = (e.clientX - rect.left) * dpr;
          const py = (e.clientY - rect.top) * dpr;
          const bb = bboxRef.current;
          const handleR = 14 * dpr;
          const onHandle =
            !!bb &&
            selRef.current &&
            Math.abs(px - (bb.x + bb.w)) < handleR &&
            Math.abs(py - (bb.y + bb.h)) < handleR;
          if (onHandle && bb) {
            onInteractStart();
            wrap.style.cursor = 'nwse-resize';
            const cxB = bb.x + bb.w / 2;
            const cyB = bb.y + bb.h / 2;
            dragRef.current = {
              mode: 'scale',
              moved: false,
              snapX: false,
              snapY: false,
              dist0: Math.max(12, Math.hypot(px - cxB, py - cyB)),
              scale0: liveRef.current.fontScale,
            };
          } else {
            dragRef.current = {
              mode: 'move',
              moved: false,
              snapX: false,
              snapY: false,
              dist0: 0,
              scale0: 1,
            };
          }
        }}
        onPointerMove={(e) => {
          const wrap = wrapRef.current;
          const drag = dragRef.current;
          if (!wrap) return;
          if (!drag) {
            // hover: cursor certo em cada zona (alça = redimensionar,
            // legenda = mover, resto = padrão) — igual CapCut
            const rect0 = wrap.getBoundingClientRect();
            const dpr0 = dprRef.current;
            const hx = (e.clientX - rect0.left) * dpr0;
            const hy = (e.clientY - rect0.top) * dpr0;
            const bb0 = bboxRef.current;
            const hr = 14 * dpr0;
            if (
              bb0 &&
              selRef.current &&
              Math.abs(hx - (bb0.x + bb0.w)) < hr &&
              Math.abs(hy - (bb0.y + bb0.h)) < hr
            ) {
              wrap.style.cursor = 'nwse-resize';
            } else if (
              bb0 &&
              hx >= bb0.x &&
              hx <= bb0.x + bb0.w &&
              hy >= bb0.y &&
              hy <= bb0.y + bb0.h
            ) {
              wrap.style.cursor = 'move';
            } else {
              wrap.style.cursor = 'default';
            }
            return;
          }
          const rect = wrap.getBoundingClientRect();
          if (!drag.moved && Math.abs(e.movementX) + Math.abs(e.movementY) > 1) {
            drag.moved = true;
            if (drag.mode === 'move') {
              onInteractStart();
              wrap.style.cursor = 'grabbing';
            }
          }
          if (!drag.moved) return;
          if (drag.mode === 'scale') {
            const bb = bboxRef.current;
            if (!bb) return;
            const dpr = dprRef.current;
            const px = (e.clientX - rect.left) * dpr;
            const py = (e.clientY - rect.top) * dpr;
            const dist = Math.hypot(px - (bb.x + bb.w / 2), py - (bb.y + bb.h / 2));
            onFontScale(
              Math.min(2, Math.max(0.45, drag.scale0 * (dist / drag.dist0))),
            );
            return;
          }
          let nx = (e.clientX - rect.left) / rect.width;
          let ny = (e.clientY - rect.top) / rect.height;
          // snap no centro (régua acende sólida quando encaixa)
          drag.snapX = Math.abs(nx - 0.5) < 0.03;
          drag.snapY = Math.abs(ny - 0.5) < 0.03;
          if (drag.snapX) nx = 0.5;
          if (drag.snapY) ny = 0.5;
          onPosChange(
            Math.min(0.95, Math.max(0.05, nx)),
            Math.min(0.95, Math.max(0.05, ny)),
          );
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          dragRef.current = null;
          wrapRef.current?.releasePointerCapture(e.pointerId);
          if (!drag || drag.moved) return;
          // clique seco: dentro da legenda = selecionar; fora = play/deselect
          const wrap = wrapRef.current;
          const bb = bboxRef.current;
          if (wrap && bb) {
            const rect = wrap.getBoundingClientRect();
            const dpr = dprRef.current;
            const px = (e.clientX - rect.left) * dpr;
            const py = (e.clientY - rect.top) * dpr;
            const inside =
              px >= bb.x && px <= bb.x + bb.w && py >= bb.y && py <= bb.y + bb.h;
            if (inside) {
              selRef.current = true;
              onSelectBlock(bb.blockId);
              return;
            }
          }
          if (selRef.current) {
            selRef.current = false;
          } else {
            togglePlay();
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onDoubleClick={(e) => {
          const wrap = wrapRef.current;
          const bb = bboxRef.current;
          const v = videoRef.current;
          if (!wrap || !bb || !v) return;
          const rect = wrap.getBoundingClientRect();
          const dpr = dprRef.current;
          const px = (e.clientX - rect.left) * dpr;
          const py = (e.clientY - rect.top) * dpr;
          if (px < bb.x || px > bb.x + bb.w || py < bb.y || py > bb.y + bb.h) return;
          v.pause();
          const block = liveRef.current.blocks.find((x) => x.id === bb.blockId);
          if (!block) return;
          selRef.current = true;
          setEditing({
            id: bb.blockId,
            value: blockText(block),
            left: bb.x / dpr,
            top: bb.y / dpr,
            width: Math.max(160, bb.w / dpr),
          });
        }}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {editing ? (
          <input
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = editing.value.trim();
                if (v) onEditText(editing.id, v);
                setEditing(null);
              } else if (e.key === 'Escape') {
                setEditing(null);
              }
            }}
            onBlur={() => {
              const v = editing.value.trim();
              if (v) onEditText(editing.id, v);
              setEditing(null);
            }}
            className="absolute z-30 rounded-[8px] border border-amber-400/80 bg-black/85 px-2 py-1.5 text-center text-[14px] font-semibold text-white outline-none shadow-[0_0_18px_-4px_rgba(251,191,36,0.7)]"
            style={{ left: editing.left, top: editing.top, width: editing.width }}
          />
        ) : null}
        {!playing && !editing ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5z" fill="#fff" />
              </svg>
            </span>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <button
          onClick={togglePlay}
          className="btn-icon shrink-0"
          aria-label={playing ? 'Pausar' : 'Tocar'}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(dur, 0.01)}
          step={0.01}
          value={cur}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = parseFloat(e.target.value);
          }}
          className="w-full"
          style={{
            accentColor: '#fbbf24',
            ['--range-fill' as string]: `${dur > 0 ? (cur / dur) * 100 : 0}%`,
          }}
        />
        <span className="mono shrink-0 text-[11px] text-text-muted">
          {formatTime(cur)} / {formatTime(dur)}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── Galeria de modelos ───────────────────────── */

function PresetGallery({
  presetId,
  onPick,
  disabled,
}: {
  presetId: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [cat, setCat] = useState<string>(TYPO_CATEGORIES[0]);
  const canvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  // só os cards VISÍVEIS na rolagem animam (IntersectionObserver)
  const visRef = useRef(new Set<string>());
  const ioRef = useRef<IntersectionObserver | null>(null);
  // canvases que já receberam AO MENOS um frame (WeakSet: card remontado volta virgem)
  const drawnRef = useRef(new WeakSet<HTMLCanvasElement>());
  const fontsReadyRef = useRef(false);
  const list = useMemo(() => TYPO_PRESETS.filter((p) => p.cat === cat), [cat]);

  useEffect(() => {
    visRef.current.clear();
    if (scrollBoxRef.current) scrollBoxRef.current.scrollTop = 0;
  }, [cat]);

  // Observer criado SOB DEMANDA: os refs dos cards disparam ANTES dos
  // useEffect no primeiro mount — criar o IO num effect deixava a galeria
  // inteira sem observação (cards pretos até um clique re-renderizar).
  const obtainIO = useCallback(() => {
    if (!ioRef.current && typeof IntersectionObserver !== 'undefined') {
      ioRef.current = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const id = (en.target as HTMLElement).dataset.pid;
            if (!id) continue;
            if (en.isIntersecting) visRef.current.add(id);
            else visRef.current.delete(id);
          }
        },
        // root = viewport: o IO já clipa pelo scroll-box ancestral
        { rootMargin: '160px' },
      );
    }
    return ioRef.current;
  }, []);

  useEffect(() => () => ioRef.current?.disconnect(), []);

  useEffect(() => {
    void ensureTypoFonts().then(() => {
      fontsReadyRef.current = true;
    });
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now() - t0;
      // cards fora da viewport ganham 1 frame estático (nunca preto ao rolar);
      // no máx 3 por tick e só com fontes prontas pra não carimbar fallback
      let prepaint = 3;
      for (const preset of list) {
        const c = canvasesRef.current.get(preset.id);
        if (!c) continue;
        const vis = ioRef.current ? visRef.current.has(preset.id) : true;
        if (!vis) {
          if (!fontsReadyRef.current || prepaint <= 0 || drawnRef.current.has(c))
            continue;
          prepaint--;
        }
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, c.width, c.height);
        // presets de linha colorida precisam de 2+ linhas pra demo mostrar o efeito
        const demoText = preset.lineAccent
          ? 'SABE QUE NÃO É MAIS UM CURSO DE COPY'
          : 'SUA LEGENDA AQUI';
        drawPresetDemo(ctx, preset, now, c.width, c.height, demoText);
        drawnRef.current.add(c);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [list]);

  return (
    <div>
      <div
        className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Modelos — {TYPO_PRESETS.length} letterings
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TYPO_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ' +
              (c === cat
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {c}
            <span className="ml-1 opacity-60">
              {TYPO_PRESETS.filter((p) => p.cat === c).length}
            </span>
          </button>
        ))}
      </div>
      <div
        ref={scrollBoxRef}
        className="max-h-[560px] overflow-y-auto pr-1.5"
      >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {list.map((preset) => {
          const active = preset.id === presetId;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              data-pid={preset.id}
              ref={(el) => {
                if (el) obtainIO()?.observe(el);
              }}
              onClick={() => onPick(preset.id)}
              className={
                'group overflow-hidden rounded-[12px] border text-left transition-all duration-200 active:scale-[0.97] ' +
                (active
                  ? 'border-amber-400/70 shadow-[0_0_20px_-6px_rgba(255,159,10,0.5)]'
                  : 'border-line-strong hover:-translate-y-[1px] hover:border-amber-400/40')
              }
            >
              <canvas
                width={520}
                height={240}
                ref={(el) => {
                  if (el) canvasesRef.current.set(preset.id, el);
                  else canvasesRef.current.delete(preset.id);
                }}
                className="block aspect-[520/240] w-full"
                style={{
                  background:
                    'linear-gradient(145deg, #17181d 0%, #101116 55%, #191a20 100%)',
                }}
              />
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span
                  className={
                    'text-[11px] font-bold ' + (active ? 'text-amber-200' : 'text-text-muted group-hover:text-text')
                  }
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {preset.name}
                </span>
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Timeline ───────────────────────── */

// cada bloco de legenda ganha uma cor própria (identificação instantânea)
const TL_PALETTE = ['#a78bfa', '#22d3ee', '#f472b6', '#ffd60a', '#2eff4f', '#ff9f0a', '#ff5d7e', '#4f7dff'];

// cor por CATEGORIA do modelo (Karaokê = uma cor, Viral = outra...)
const CAT_COLORS: Record<string, string> = {
  Viral: '#f472b6',
  Premium: '#e8b04c',
  Cor: '#ff9f0a',
  Impacto: '#ff5d7e',
  'Karaokê': '#22d3ee',
  Glitch: '#a78bfa',
  Destaque: '#ffd60a',
  Minimal: '#9aa5b1',
  Bounce: '#2edb84',
  Máquina: '#4ade80',
  Foco: '#bde0fe',
  Reveal: '#c9bcf2',
  Neon: '#31c4ff',
  Kinetic: '#ff8a5c',
  Editorial: '#e8dcc0',
  Cartoon: '#f9a8d4',
  Estilo: '#dda15e',
};

function Timeline({
  blocks,
  duration,
  videoRef,
  videoUrl,
  presetCat,
  selId,
  onSelect,
  onRetime,
  onDragStart,
  disabled,
}: {
  blocks: Block[];
  duration: number;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  presetCat: string;
  selId: string | null;
  onSelect: (id: string) => void;
  onRetime: (id: string, start: number, end: number, mode: 'move' | 'trim') => void;
  onDragStart: () => void;
  disabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef(false); // arrastando a agulha (fora dos blocos)
  const [pps, setPps] = useState(0); // px por segundo (0 = ainda não ajustou)
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'trim-start' | 'trim-end';
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

  // filmstrip estilo CapCut: thumbs geradas 1x por vídeo (só visual/seek —
  // o vídeo NÃO é editável, só as legendas)
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    if (!videoUrl || duration <= 0) return;
    let cancelled = false;
    (async () => {
      const N = Math.max(16, Math.min(72, Math.round(duration / 2)));
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = videoUrl;
      await new Promise<void>((res) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => res();
      });
      if (!v.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 54;
      const cctx = c.getContext('2d');
      if (!cctx) return;
      const out: string[] = [];
      for (let i = 0; i < N; i++) {
        if (cancelled) return;
        const t = ((i + 0.5) * duration) / N;
        await new Promise<void>((res) => {
          const timer = setTimeout(res, 1500);
          v.onseeked = () => {
            clearTimeout(timer);
            res();
          };
          v.currentTime = Math.min(t, duration - 0.05);
        });
        cctx.drawImage(v, 0, 0, 96, 54);
        out.push(c.toDataURL('image/jpeg', 0.5));
      }
      if (!cancelled) setThumbs(out);
      v.removeAttribute('src');
      v.load();
    })();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, duration]);

  // zoom inicial: caber o vídeo inteiro na faixa
  useEffect(() => {
    if (pps === 0 && duration > 0 && scrollRef.current) {
      const w = scrollRef.current.clientWidth;
      setPps(Math.min(120, Math.max(14, (w - 20) / duration)));
    }
  }, [duration, pps]);

  // playhead + relógio seguem o vídeo sem re-render (via refs)
  const timeReadRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const fmtClock = (s: number) =>
      `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
    const tick = () => {
      const v = videoRef.current;
      const ph = playheadRef.current;
      if (v && ph && pps > 0) ph.style.transform = `translateX(${v.currentTime * pps}px)`;
      const tr = timeReadRef.current;
      if (v && tr) tr.textContent = `${fmtClock(v.currentTime)} / ${fmtClock(duration)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, pps, duration]);

  if (duration <= 0) return null;
  const effPps = pps || 40;
  const trackW = Math.max(200, duration * effPps);

  // régua: passo escolhido pra no máx ~240 ticks
  const stepOptions = [1, 2, 5, 10, 30, 60];
  const step = stepOptions.find((s) => duration / s <= 240) ?? 120;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="mt-5">
      <div
        className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span>Timeline — blocos movem · bordas cortam · arrasta a agulha pra navegar</span>
        <span className="flex items-center gap-3">
          <span
            ref={timeReadRef}
            className="mono rounded-[8px] border border-line bg-black/40 px-2.5 py-1 text-[13px] normal-case tracking-normal text-amber-200"
          >
            0:00.0
          </span>
          <button
            onClick={() => setPps((v) => Math.max(10, (v || 40) / 1.5))}
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[13px] text-text-muted transition-colors hover:border-amber-400/50 hover:text-amber-200"
            title="Diminuir zoom"
          >
            −
          </button>
          <button
            onClick={() => setPps((v) => Math.min(240, (v || 40) * 1.5))}
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[13px] text-text-muted transition-colors hover:border-amber-400/50 hover:text-amber-200"
            title="Aumentar zoom"
          >
            +
          </button>
        </span>
      </div>
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-[14px] border border-line bg-black/30"
      >
        <div
          className="relative select-none"
          style={{
            width: trackW,
            height: 122,
            backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) ${effPps}px, transparent ${effPps}px, transparent ${effPps * 2}px)`,
          }}
          onPointerDown={(e) => {
            // clique/arrasto fora dos blocos = scrub da agulha (estilo CapCut)
            if (disabled) return;
            const target = e.target as HTMLElement;
            if (target.dataset.block) return;
            const el = e.currentTarget as HTMLElement;
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              /* browsers antigos seguem só com o clique */
            }
            scrubRef.current = true;
            const rect = el.getBoundingClientRect();
            const v = videoRef.current;
            if (v) {
              v.pause();
              v.currentTime = Math.min(
                Math.max(0, (e.clientX - rect.left) / effPps),
                Math.max(0, duration - 0.03),
              );
            }
          }}
          onPointerMove={(e) => {
            if (!scrubRef.current) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const v = videoRef.current;
            if (v)
              v.currentTime = Math.min(
                Math.max(0, (e.clientX - rect.left) / effPps),
                Math.max(0, duration - 0.03),
              );
          }}
          onPointerUp={(e) => {
            if (!scrubRef.current) return;
            scrubRef.current = false;
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* já solto */
            }
          }}
          onPointerCancel={() => {
            scrubRef.current = false;
          }}
        >
          {/* régua */}
          <div className="absolute inset-x-0 top-0 h-[22px] border-b border-line/60 bg-black/40">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-line/50"
                style={{ left: t * effPps }}
              >
                {t % (step * 5) === 0 ? (
                  <span className="mono absolute left-1.5 top-[3px] text-[10px] text-text-muted">
                    {fmt(t)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {/* blocos */}
          {blocks.map((b, bi) => {
            const left = (b.start / 1000) * effPps;
            const width = Math.max(10, ((b.end - b.start) / 1000) * effPps);
            const sel = b.id === selId;
            const col = CAT_COLORS[presetCat] ?? TL_PALETTE[0];
            void bi;
            return (
              <div
                key={b.id}
                data-block="1"
                title={blockText(b)}
                className={
                  'absolute top-[27px] h-[36px] cursor-grab overflow-hidden rounded-[8px] border-2 transition-shadow active:cursor-grabbing ' +
                  (sel ? 'z-10' : 'hover:brightness-125')
                }
                style={{
                  left,
                  width,
                  backgroundImage: `linear-gradient(180deg, ${col}59 0%, ${col}24 100%)`,
                  borderColor: sel ? '#fbbf24' : `${col}aa`,
                  boxShadow: sel ? '0 0 18px -4px rgba(251,191,36,0.7)' : undefined,
                }}
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.stopPropagation();
                  onDragStart();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const off = e.clientX - rect.left;
                  const mode: 'move' | 'trim-start' | 'trim-end' =
                    width > 26 && off < 9
                      ? 'trim-start'
                      : width > 26 && off > rect.width - 9
                        ? 'trim-end'
                        : 'move';
                  dragRef.current = {
                    id: b.id,
                    mode,
                    startX: e.clientX,
                    origStart: b.start,
                    origEnd: b.end,
                  };
                  onSelect(b.id);
                }}
                onPointerMove={(e) => {
                  const drag = dragRef.current;
                  if (!drag || drag.id !== b.id) return;
                  // snap de 50ms = precisão previsível
                  const deltaMs =
                    Math.round((((e.clientX - drag.startX) / effPps) * 1000) / 50) * 50;
                  let ns = drag.origStart;
                  let ne = drag.origEnd;
                  if (drag.mode === 'move') {
                    ns = drag.origStart + deltaMs;
                    ne = drag.origEnd + deltaMs;
                    onRetime(b.id, ns, ne, 'move');
                  } else if (drag.mode === 'trim-start') {
                    ns = drag.origStart + deltaMs;
                    onRetime(b.id, ns, ne, 'trim');
                  } else {
                    ne = drag.origEnd + deltaMs;
                    onRetime(b.id, ns, ne, 'trim');
                  }
                  const tip = tooltipRef.current;
                  if (tip) {
                    tip.style.display = 'block';
                    tip.style.left = `${e.clientX + 14}px`;
                    tip.style.top = `${e.clientY - 34}px`;
                    tip.textContent = `${(ns / 1000).toFixed(2)}s → ${(ne / 1000).toFixed(2)}s`;
                  }
                }}
                onPointerUp={(e) => {
                  dragRef.current = null;
                  if (tooltipRef.current) tooltipRef.current.style.display = 'none';
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                  if (tooltipRef.current) tooltipRef.current.style.display = 'none';
                }}
              >
                {/* alças de corte — barras limpas, só cor (hover mostra o texto) */}
                <span className="pointer-events-none absolute inset-y-0 left-0 w-[5px] rounded-l-[6px] bg-white/50" />
                <span className="pointer-events-none absolute inset-y-0 right-0 w-[5px] rounded-r-[6px] bg-white/50" />
              </div>
            );
          })}

          {/* filmstrip (só visual — vídeo não é editável) */}
          {thumbs.length > 0 ? (
            <div
              className="pointer-events-none absolute left-0 top-[68px] flex h-[48px] overflow-hidden rounded-[8px] border border-line/60"
              style={{ width: trackW }}
            >
              {thumbs.map((t, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={t}
                  alt=""
                  className="h-full object-cover"
                  style={{ width: trackW / thumbs.length }}
                  draggable={false}
                />
              ))}
            </div>
          ) : null}

          {/* playhead — a zona de pega (12px) reenvia o pointer pro track = scrub */}
          <div
            ref={playheadRef}
            className="pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]"
          >
            <div className="absolute -left-[4px] top-0 h-0 w-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-red-500" />
            <div
              className="pointer-events-auto absolute -left-[5px] top-0 h-full w-[12px] cursor-ew-resize"
              title="Arrasta pra navegar"
            />
          </div>
        </div>
      </div>
      {/* tooltip de precisão durante o arrasto */}
      <div
        ref={tooltipRef}
        className="mono pointer-events-none fixed z-50 hidden rounded-[7px] border border-amber-400/60 bg-black/90 px-2 py-1 text-[11px] text-amber-200 shadow-lg"
        style={{ display: 'none' }}
      />
    </div>
  );
}

/* ───────────────────────── Seletor de fontes ───────────────────────── */

function FontPicker({
  value,
  presetFont,
  onPick,
  disabled,
}: {
  value: FontKey | null;
  presetFont: FontKey;
  onPick: (v: FontKey | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = value ?? presetFont;
  const activeFont = TYPO_FONTS[active];
  return (
    <div className="rounded-[14px] border border-line bg-bg-soft/40 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Fonte — {Object.keys(TYPO_FONTS).length} disponíveis
        </div>
        <div className="flex items-center gap-2">
          {value ? (
            <button
              onClick={() => onPick(null)}
              disabled={disabled}
              className="text-[11px] font-semibold text-amber-300 hover:underline"
            >
              Padrão do modelo
            </button>
          ) : null}
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-text transition-colors hover:border-amber-400/50"
            style={{
              fontFamily: `${activeFont.family}, sans-serif`,
              fontWeight: activeFont.weight,
              fontStyle: activeFont.italic ? 'italic' : 'normal',
            }}
          >
            {activeFont.label} {open ? '▴' : '▾'}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-3 max-h-[260px] overflow-y-auto pr-1">
          {FONT_GROUPS.map((group) => {
            const keys = (Object.keys(TYPO_FONTS) as FontKey[]).filter(
              (k) => TYPO_FONTS[k].group === group,
            );
            if (keys.length === 0) return null;
            return (
              <div key={group} className="mb-2.5">
                <div
                  className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {group}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {keys.map((k) => {
                    const f = TYPO_FONTS[k];
                    const isActive = k === active;
                    return (
                      <button
                        key={k}
                        onClick={() => onPick(k === presetFont ? null : k)}
                        disabled={disabled}
                        className={
                          'rounded-[9px] border px-2.5 py-1 text-[14px] leading-tight transition-colors ' +
                          (isActive
                            ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                            : 'border-line text-text hover:border-amber-400/40')
                        }
                        style={{
                          fontFamily: `${f.family}, sans-serif`,
                          fontWeight: f.weight,
                          fontStyle: f.italic ? 'italic' : 'normal',
                        }}
                        title={f.label}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Painel de ajustes ───────────────────────── */

const SWATCHES = [
  '#ffffff', '#0f0f10', '#ffd60a', '#ff9f0a', '#ff2d55', '#e8192c',
  '#f472b6', '#ff5db1', '#a78bfa', '#7c5cff', '#22d3ee', '#31c4ff',
  '#2eff4f', '#c8e87c', '#e8b04c', '#bde0fe',
];

function ColorDot({
  label,
  value,
  fallback,
  onPick,
  disabled,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onPick: (v: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState('');
  const cur = value ?? fallback;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-1.5 transition-colors hover:border-amber-400/50"
      >
        <span
          className="h-5 w-5 rounded-[6px] border border-white/25 shadow-inner"
          style={{ background: cur }}
        />
        <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[196px] rounded-[14px] border border-line-strong bg-bg-elev p-3 shadow-2xl">
          <div className="grid grid-cols-6 gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={
                  'h-6 w-6 rounded-[7px] border transition-transform hover:scale-110 ' +
                  (cur.toLowerCase() === c ? 'border-amber-400' : 'border-white/15')
                }
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              placeholder={cur}
              className="mono w-full rounded-[8px] border border-line bg-black/30 px-2 py-1 text-[11px] text-text outline-none focus:border-amber-400/50"
            />
            <button
              onClick={() => {
                const v = hex.trim();
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                  onPick(v.startsWith('#') ? v : '#' + v);
                  setOpen(false);
                  setHex('');
                }
              }}
              className="rounded-[8px] border border-amber-400/50 px-2 py-1 text-[11px] font-bold text-amber-200"
            >
              OK
            </button>
          </div>
          <button
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="mt-2 w-full rounded-[8px] border border-line px-2 py-1 text-[10.5px] text-text-muted hover:text-text"
          >
            Padrão do modelo
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StylePanel({
  fontScale,
  posY,
  primary,
  accent,
  textCase,
  bold,
  italic,
  underline,
  fxStroke,
  fxShadow,
  fxGlow,
  fxSmoke,
  onSlide,
  onSet,
  applyAll,
  setApplyAll,
  editingLabel,
  autoEmph,
  setAutoEmph,
  pace,
  regroup,
  defaultPrimary,
  defaultAccent,
  disabled,
}: {
  fontScale: number;
  posY: number;
  primary: string | null;
  accent: string | null;
  textCase: CaseMode | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fxStroke: number;
  fxShadow: number;
  fxGlow: number;
  fxSmoke: number;
  onSlide: (patch: PerBlockStyle) => void;
  onSet: (patch: PerBlockStyle) => void;
  applyAll: boolean;
  setApplyAll: (v: boolean) => void;
  editingLabel: string | null;
  autoEmph: boolean;
  setAutoEmph: (v: boolean) => void;
  pace: GroupPace;
  regroup: (p: GroupPace) => void;
  defaultPrimary: string;
  defaultAccent: string;
  disabled?: boolean;
}) {
  const caseBtn = (mode: 'upper' | 'lower' | 'original', label: string, title: string) => (
    <button
      key={mode}
      onClick={() => onSet({ textCase: textCase === mode ? null : mode })}
      disabled={disabled}
      title={title}
      className={
        'flex h-8 min-w-[38px] items-center justify-center rounded-[9px] border px-2 text-[13px] font-bold transition-colors ' +
        (textCase === mode
          ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
          : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
      }
    >
      {label}
    </button>
  );
  return (
    <div className="grid gap-4 rounded-[14px] border border-line bg-bg-soft/40 p-4 md:grid-cols-2">
      {/* aplicar a todas × só o bloco selecionado */}
      <div className="md:col-span-2 flex flex-wrap items-center gap-3 rounded-[10px] border border-line/70 bg-black/20 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text">
          <input
            type="checkbox"
            checked={applyAll}
            onChange={(e) => setApplyAll(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 accent-amber-400"
          />
          Aplicar a todas as legendas
        </label>
        {!applyAll ? (
          editingLabel ? (
            <span className="rounded-[8px] border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-200">
              editando só: “{editingLabel}”
            </span>
          ) : (
            <span className="text-[10.5px] text-text-muted">
              seleciona um bloco (clique na legenda ou na timeline) pra editar só ele
            </span>
          )
        ) : null}
      </div>

      <ToolSlider
        label="Tamanho"
        min={0.45}
        max={2}
        step={0.05}
        value={fontScale}
        onChange={(v) => onSlide({ fontScale: v })}
        display={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
      />
      <ToolSlider
        label="Altura na tela"
        min={0.08}
        max={0.94}
        step={0.01}
        value={posY}
        onChange={(v) => onSlide({ posY: v })}
        display={(v) => `${Math.round(v * 100)}%`}
        disabled={disabled}
      />

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Cores
        </div>
        <div className="flex items-center gap-2">
          <ColorDot
            label="Texto"
            value={primary}
            fallback={defaultPrimary}
            onPick={(v) => onSet({ primary: v })}
            disabled={disabled}
          />
          <ColorDot
            label="Destaque"
            value={accent}
            fallback={defaultAccent}
            onPick={(v) => onSet({ accent: v })}
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Padrão
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => onSet({ bold: !bold })}
            disabled={disabled}
            title="Negrito"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border text-[14px] font-black transition-colors ' +
              (bold
                ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
          >
            B
          </button>
          <button
            onClick={() => onSet({ underline: !underline })}
            disabled={disabled}
            title="Sublinhado"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border text-[14px] font-bold underline transition-colors ' +
              (underline
                ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
          >
            U
          </button>
          <button
            onClick={() => onSet({ italic: !italic })}
            disabled={disabled}
            title="Itálico"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border text-[14px] font-bold italic transition-colors ' +
              (italic
                ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
          >
            I
          </button>
        </div>
        <div
          className="mb-1.5 mt-3 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Caixa
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {caseBtn('upper', 'TT', 'Tudo maiúsculo')}
          {caseBtn('lower', 'tt', 'Tudo minúsculo')}
          {caseBtn('original', 'Tt', 'Como foi falado')}
        </div>
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Efeitos do modelo
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ToolSlider
            label="Traço"
            min={0}
            max={2}
            step={0.05}
            value={fxStroke}
            onChange={(v) => onSlide({ fxStroke: v })}
            display={(v) => `${Math.round(v * 100)}%`}
            disabled={disabled}
          />
          <ToolSlider
            label="Sombra"
            min={0}
            max={2}
            step={0.05}
            value={fxShadow}
            onChange={(v) => onSlide({ fxShadow: v })}
            display={(v) => `${Math.round(v * 100)}%`}
            disabled={disabled}
          />
          <ToolSlider
            label="Brilho"
            min={0}
            max={2}
            step={0.05}
            value={fxGlow}
            onChange={(v) => onSlide({ fxGlow: v })}
            display={(v) => `${Math.round(v * 100)}%`}
            disabled={disabled}
          />
          <ToolSlider
            label="Fumaça"
            min={0}
            max={2}
            step={0.05}
            value={fxSmoke}
            onChange={(v) => onSlide({ fxSmoke: v })}
            display={(v) => `${Math.round(v * 100)}%`}
            disabled={disabled}
          />
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          intensidade sobre o que o modelo já tem (100% = padrão · 0% desliga) — só age nos modelos que têm o efeito
        </p>
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Destaque automático
        </div>
        <div className="flex items-center gap-2.5">
          {(
            [
              [true, 'Ligado'],
              [false, 'Desligado'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={label}
              onClick={() => setAutoEmph(v)}
              disabled={disabled}
              className={
                'rounded-[9px] border px-3 py-1.5 text-[11px] font-bold transition-colors ' +
                (autoEmph === v
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-line text-text-muted hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </button>
          ))}
          <span className="text-[10.5px] text-text-muted">
            a palavra forte de cada bloco ganha o tratamento do modelo sozinha
          </span>
        </div>
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Ritmo dos blocos
        </div>
        <ToolChoice
          value={pace}
          onChange={regroup}
          disabled={disabled}
          hue={HUE}
          options={[
            { value: 'rapido', label: 'Rápido', sub: '1-3 palavras' },
            { value: 'equilibrado', label: 'Equilibrado', sub: '3-5 palavras' },
            { value: 'frases', label: 'Frases', sub: 'blocos longos' },
          ]}
        />
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Trocar o ritmo remonta os blocos a partir da transcrição — edições de texto
          feitas na lista abaixo são perdidas (Ctrl+Z desfaz).
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── Lista de blocos ───────────────────────── */

function BlockList({
  blocks,
  selId,
  activeId,
  highlights,
  onSelect,
  onEditText,
  onSplit,
  onMerge,
  onDelete,
  onNudge,
  onToggleWord,
  disabled,
}: {
  blocks: Block[];
  selId: string | null;
  activeId: string | null;
  highlights: Record<string, number[]>;
  onSelect: (b: Block) => void;
  onEditText: (id: string, text: string) => void;
  onSplit: (id: string) => void;
  onMerge: (id: string) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, edge: 'start' | 'end', delta: number) => void;
  onToggleWord: (id: string, wordIdx: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5">
      <div
        className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span>Blocos de legenda — {blocks.length}</span>
        <span className="normal-case tracking-normal font-normal">
          clica na palavra pra pintar de destaque
        </span>
      </div>
      <div className="max-h-[280px] overflow-y-auto rounded-[14px] border border-line">
        {blocks.map((b, i) => {
          const sel = b.id === selId;
          const isActive = b.id === activeId;
          const hl = new Set(highlights[b.id] ?? []);
          return (
            <div
              key={b.id}
              className={
                'border-b border-line/60 px-3 py-2 transition-colors last:border-b-0 ' +
                (sel
                  ? 'bg-amber-400/[0.07]'
                  : isActive
                    ? 'bg-lime/[0.05]'
                    : 'hover:bg-white/[0.02]')
              }
              style={{ contentVisibility: 'auto' } as CSSProperties}
            >
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => onSelect(b)}
                  className={
                    'mono shrink-0 rounded-[7px] border px-2 py-1 text-[10.5px] transition-colors ' +
                    (isActive
                      ? 'border-lime/50 text-lime'
                      : 'border-line text-text-muted hover:border-amber-400/50 hover:text-amber-200')
                  }
                  title="Ir pra este ponto do vídeo"
                >
                  {formatTime(b.start / 1000)}
                </button>
                <input
                  defaultValue={blockText(b)}
                  key={b.id + ':' + blockText(b)}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== blockText(b)) onEditText(b.id, v);
                  }}
                  disabled={disabled}
                  className="w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-[13px] text-text outline-none transition-colors focus:border-amber-400/40 focus:bg-black/20"
                />
                <div className="flex shrink-0 items-center gap-1">
                  <RowBtn title="Dividir bloco" onClick={() => onSplit(b.id)} disabled={disabled || b.words.length < 2}>
                    ✂
                  </RowBtn>
                  <RowBtn title="Juntar com o próximo" onClick={() => onMerge(b.id)} disabled={disabled || i === blocks.length - 1}>
                    ⇣
                  </RowBtn>
                  <RowBtn title="Excluir bloco" onClick={() => onDelete(b.id)} disabled={disabled} danger>
                    ✕
                  </RowBtn>
                </div>
              </div>
              {sel ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1">
                  {b.words.map((w, wi) => (
                    <button
                      key={wi}
                      onClick={() => onToggleWord(b.id, wi)}
                      disabled={disabled}
                      className={
                        'rounded-[7px] border px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
                        (hl.has(wi)
                          ? 'border-amber-400/70 bg-amber-400/20 text-amber-200'
                          : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
                      }
                    >
                      {w.text}
                    </button>
                  ))}
                  <span className="mx-2 h-4 w-px bg-line" />
                  <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                    início
                  </span>
                  <RowBtn title="-0,1s no início" onClick={() => onNudge(b.id, 'start', -100)} disabled={disabled}>
                    −
                  </RowBtn>
                  <RowBtn title="+0,1s no início" onClick={() => onNudge(b.id, 'start', 100)} disabled={disabled}>
                    +
                  </RowBtn>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                    fim
                  </span>
                  <RowBtn title="-0,1s no fim" onClick={() => onNudge(b.id, 'end', -100)} disabled={disabled}>
                    −
                  </RowBtn>
                  <RowBtn title="+0,1s no fim" onClick={() => onNudge(b.id, 'end', 100)} disabled={disabled}>
                    +
                  </RowBtn>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={
        'flex h-6 w-6 items-center justify-center rounded-[7px] border text-[11px] transition-colors disabled:opacity-30 ' +
        (danger
          ? 'border-line text-text-muted hover:border-red-500/50 hover:text-red-300'
          : 'border-line text-text-muted hover:border-amber-400/50 hover:text-amber-200')
      }
    >
      {children}
    </button>
  );
}
