'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { CancelButton } from '@/components/CancelButton';
import { Popover } from '@/components/Popover';
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
  captionBBoxAt,
  wordBoxesAt,
  DEFAULT_STYLE,
  IN_ANIM_OPTIONS,
  OUT_ANIM_OPTIONS,
  unsupportedInKinds,
  type AnimKind,
  type OutKind,
  type TypoPreset,
  type Block,
  type StyleState,
  type PerBlockStyle,
  type WordStyle,
  type TWord,
} from '@/lib/typography/engine';
import { TYPO_PRESETS, getPreset } from '@/lib/typography/presets';
import { fxDefault, normalizeFx, type FxState } from '@/lib/typography/fx';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';
import {
  drawHeadlines,
  headlineAtPoint,
  headlinePosBounds,
  headlinesAt,
  layoutHeadline,
  makeHeadline,
  measurerFromCtx,
  HEADLINE_PRESETS,
  type Headline,
} from '@/lib/typography/headline';
import {
  auditarTranscricao,
  resumoAuditoria,
  type AuditResult,
} from '@/lib/typography/asr-audit';
import { PresetGallery } from '@/components/typography/PresetGallery';
import { ColorDot } from '@/components/typography/ColorDot';
import { FxPanel } from '@/components/typography/FxPanel';
import { HeadlinePanel } from '@/components/typography/HeadlinePanel';
import { LangPicker } from '@/components/typography/LangPicker';
import { useTypoFavs } from '@/components/typography/useTypoFavs';
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
  type GroupPace,
} from '@/lib/typography/group';
import {
  emptyIdentity,
  mergeKeepingIdentity,
  pruneIdentity,
  regroupKeepingLocks,
  removeKeepingIdentity,
  splitKeepingIdentity,
  type BlockIdentity,
} from '@/lib/typography/blocks-edit';
import {
  defaultSegments,
  type ApplyResult,
  type CaptionSegment,
} from '@/lib/typography/caption-script';
import { CaptionScriptModal } from '@/components/typography/CaptionScriptModal';
import {
  renderTypographyVideo,
  type RenderProgress,
} from '@/lib/typography/export';
import { correctBlocksByCopy } from '@/lib/typography/copy-fix';

/**
 * TIPOGRAFIA AUTOMÁTICA — sobe o vídeo, a transcrição vira legenda com
 * lettering animado profissional (estilo preset de Premiere), tudo editável
 * no navegador e queimado no vídeo SEM custo de servidor.
 */

const MAX_FILE_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 20 * 60;
const HUE = 'rgba(255,159,10,0.45)';

type Phase = 'idle' | 'transcribing' | 'ready' | 'rendering';
type Language = string; // ISO-639-1 ('pt', 'en'...) ou 'auto'

// botões com relevo 3D (hover levanta, clique afunda) — usado em todo o editor
// mesmo relevo do T3D com o glow âmbar FUNDIDO na mesma sombra — dois
// utilitários shadow-[] no mesmo elemento brigam e um deles vira CSS morto
const T3D_GLOW =
  ' shadow-[0_0_16px_rgba(255,159,10,0.2),0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_0_20px_rgba(255,159,10,0.28),0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] disabled:shadow-none transition-all duration-150 will-change-transform';

const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';
type UpperMode = 'auto' | 'on' | 'off'; // legado (migração de sessões antigas)
type CaseMode = 'auto' | 'upper' | 'lower' | 'original';

type ResultState = {
  url: string;
  size: number;
  width: number;
  height: number;
  audioOk: boolean;
} | null;

/**
 * Handler de identidade ESTÁVEL que sempre enxerga o estado atual — é o que
 * deixa memorizar a galeria/timeline/lista de blocos sem closure velha.
 */
function useEvent<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...a: A) => ref.current(...a), []);
}

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
  wordStyles?: Record<string, Record<number, WordStyle>>;
  lockedBlocks?: string[];
  autoFit?: boolean;
  singleLine?: boolean;
  fx?: FxState;
  headlines?: Headline[];
  bgMode?: 'preset' | 'on' | 'off';
  bgColor?: string | null;
  bgOpacity?: number;
  animIn?: AnimKind | null;
  animOut?: OutKind | null;
  script?: CaptionSegment[];
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

/**
 * Semente do roteiro de legenda (1 hook + 1 body, no Template 1). Criada UMA
 * vez por carregamento: `useToolState` recebe valor, não fábrica, e chamar
 * defaultSegments() a cada render cunharia ids novos sem parar.
 */
let FX_SEED: FxState | null = null;
/** Estado neutro dos efeitos, criado UMA vez (useToolState recebe valor). */
function fxSeed(): FxState {
  if (!FX_SEED) FX_SEED = fxDefault();
  return FX_SEED;
}

let SCRIPT_SEED: CaptionSegment[] | null = null;
function scriptSeed(): CaptionSegment[] {
  if (!SCRIPT_SEED) SCRIPT_SEED = defaultSegments();
  return SCRIPT_SEED;
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
  const [language, setLanguage] = useToolState<Language>('tipografia:lang', 'auto');
  const [highlights, setHighlights] = useToolState<Record<string, number[]>>(
    'tipografia:hl',
    {},
  );
  const [autoEmph, setAutoEmph] = useToolState<boolean>('tipografia:autoemph', true);
  const [fontOv, setFontOv] = useToolState<FontKey | null>('tipografia:fontov', null);
  const [posX, setPosX] = useToolState<number>('tipografia:posx', 0.5);
  const [autoFitG, setAutoFitG] = useToolState<boolean>('tipografia:autofit', true);
  const [singleLineG, setSingleLineG] = useToolState<boolean>('tipografia:singleline', false);
  // efeitos LIGAVEIS (traco/sombra/brilho/fumaca) — ver lib/typography/fx.ts
  const [fxG, setFxG] = useToolState<FxState>('tipografia:fx', fxSeed());
  const [bgModeG, setBgModeG] = useToolState<'preset' | 'on' | 'off'>('tipografia:bgmode', 'preset');
  const [bgColorG, setBgColorG] = useToolState<string | null>('tipografia:bgcolor', null);
  const [bgOpacityG, setBgOpacityG] = useToolState<number>('tipografia:bgopacity', 1);
  const [animInG, setAnimInG] = useToolState<AnimKind | null>('tipografia:animin', null);
  const [animOutG, setAnimOutG] = useToolState<OutKind | null>('tipografia:animout', null);
  // estilos POR PALAVRA (seleção parcial no preview) + blocos BLOQUEADOS
  const [wordStyles, setWordStyles] = useToolState<Record<string, Record<number, WordStyle>>>(
    'tipografia:wordstyles',
    {},
  );
  const [lockedBlocks, setLockedBlocks] = useToolState<string[]>('tipografia:locked', []);
  const [wordSel, setWordSel] = useState<{ blockId: string; a: number; b: number } | null>(null);
  const [selBlockId, setSelBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  // ⭐ ROTEIRO DE LEGENDA (hook × body com letterings diferentes)
  const [scriptSegs, setScriptSegs] = useToolState<CaptionSegment[]>(
    'tipografia:script',
    scriptSeed(),
  );
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptOnTpls, setScriptOnTpls] = useState(false);
  // recado honesto do último "trocar o ritmo" (quantos travados sobreviveram)
  const [regroupInfo, setRegroupInfo] = useState<string | null>(null);
  // ⭐ AUDITORIA da transcrição: o vídeo tinha fala sem legenda?
  // ⭐ HEADLINES: texto PARADO por cima, faixa propria na timeline
  const [headlines, setHeadlines] = useToolState<Headline[]>('tipografia:headlines', []);
  const [selHeadlineId, setSelHeadlineId] = useState<string | null>(null);
  const [audit, setAudit] = useState<{ tom: 'ok' | 'aviso' | 'erro'; texto: string } | null>(null);
  const [auditando, setAuditando] = useState(false);
  /** áudio já extraído desta sessão — a re-conferência não re-extrai */
  const audioRef = useRef<Blob | null>(null);
  // ⭐ favoritos POR CONTA (hook compartilhado com o Auto Cortes)
  const { favs, toggleFav } = useTypoFavs();

  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // override que o bloco JÁ tinha antes do cadeado fechar — soltar o cadeado
  // devolve só ele, em vez de zerar o ajuste manual do user
  const preLockRef = useRef<Record<string, PerBlockStyle>>({});

  // ── Ctrl+Z: histórico de edição (até 40 passos) ──────────────────────────
  type Snapshot = {
    blocks: Block[];
    highlights: Record<string, number[]>;
    blockStyles: Record<string, PerBlockStyle>;
    wordStyles: Record<string, Record<number, WordStyle>>;
    lockedBlocks: string[];
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
    animIn: AnimKind | null;
    animOut: OutKind | null;
  };
  const historyRef = useRef<Snapshot[]>([]);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = {
    blocks,
    highlights,
    blockStyles,
    wordStyles,
    lockedBlocks,
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
    animIn: animInG,
    animOut: animOutG,
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
    setWordStyles(s.wordStyles);
    setLockedBlocks(s.lockedBlocks);
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
    setAnimInG(s.animIn);
    setAnimOutG(s.animOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWordSel(null);
        return;
      }
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
      autoFit: autoFitG,
      singleLine: singleLineG,
      fx: fxG,
      bgMode: bgModeG,
      bgColor: bgColorG,
      bgOpacity: bgOpacityG,
      animIn: animInG,
      animOut: animOutG,
      wordStyles,
      perBlock: blockStyles,
    }),
    [presetId, fontScale, posY, primary, accent, textCase, bold, italic, underlineG, fxStrokeG, fxShadowG, fxGlowG, fxSmokeG, highlights, autoEmph, fontOv, posX, autoFitG, singleLineG, fxG, bgModeG, bgColorG, bgOpacityG, animInG, animOutG, wordStyles, blockStyles],
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
        if (patch.autoFit !== undefined) setAutoFitG(patch.autoFit !== false);
        if (patch.singleLine !== undefined) setSingleLineG(patch.singleLine === true);
        if (patch.fx !== undefined) setFxG(normalizeFx(patch.fx));
        if (patch.bgMode !== undefined) setBgModeG(patch.bgMode ?? 'preset');
        if (patch.bgColor !== undefined) setBgColorG(patch.bgColor ?? null);
        if (patch.bgOpacity !== undefined) setBgOpacityG(patch.bgOpacity ?? 1);
        if (patch.animIn !== undefined) setAnimInG(patch.animIn ?? null);
        if (patch.animOut !== undefined) setAnimOutG(patch.animOut ?? null);
        return;
      }
      setBlockStyles((prev) => ({
        ...prev,
        [editingBlockId]: { ...prev[editingBlockId], ...patch },
      }));
    },
    [editingBlockId, setFontScale, setPrimary, setAccent, setPosX, setPosY, setTextCase, setBold, setItalic, setUnderlineG, setFxStrokeG, setFxShadowG, setFxGlowG, setFxSmokeG, setFontOv, setAutoFitG, setSingleLineG, setFxG, setBgModeG, setBgColorG, setBgOpacityG, setAnimInG, setAnimOutG, setBlockStyles],
  );
  // modelo EFETIVO do que o painel está editando: com um bloco travado (ou em
  // edição só-dele), o modelo do bloco vence o global — os rótulos "do modelo"
  // e a lista de animações indisponíveis têm que falar DESSE modelo
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

  const panelPreset = useMemo(
    () => getPreset(effOf('presetId', presetId) ?? presetId),
    [effOf, presetId],
  );

  // ── seleção PARCIAL (palavras marcadas no preview) ───────────────────────
  // painel aplica cor/caixa/tamanho/fonte/B-U-I SÓ nas palavras marcadas
  const setWordStylePatch = useCallback(
    (patch: WordStyle) => {
      if (!wordSel) return;
      pushHistory();
      const { blockId, a, b } = wordSel;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      setWordStyles((prev) => {
        const forBlock = { ...(prev[blockId] ?? {}) };
        for (let i = lo; i <= hi; i++) {
          forBlock[i] = { ...forBlock[i], ...patch };
        }
        return { ...prev, [blockId]: forBlock };
      });
    },
    [wordSel, pushHistory, setWordStyles],
  );
  const clearWordSelStyles = useCallback(() => {
    if (!wordSel) return;
    pushHistory();
    const { blockId, a, b } = wordSel;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    setWordStyles((prev) => {
      const forBlock = { ...(prev[blockId] ?? {}) };
      for (let i = lo; i <= hi; i++) delete forBlock[i];
      const next = { ...prev };
      if (Object.keys(forBlock).length === 0) delete next[blockId];
      else next[blockId] = forBlock;
      return next;
    });
  }, [wordSel, pushHistory, setWordStyles]);

  // ── BLOQUEADO: congela o visual atual do bloco e sai do "aplicar a todas" ─
  // Congelar = copiar o estilo global EFETIVO pro override do bloco; como o
  // perBlock vence o global no engine, mudanças globais futuras não pegam.
  const toggleLock = useCallback(
    (blockId: string) => {
      pushHistory();
      if (lockedBlocks.includes(blockId)) {
        setLockedBlocks((prev) => prev.filter((id) => id !== blockId));
        // DESCONGELAR de verdade: sem apagar o override, o bloco continuava
        // preso ao estilo congelado pra sempre — o perBlock vence o global, e
        // nenhum "aplicar a todas" conseguia mais alcançá-lo. O cadeado virava
        // via de mão única.
        //
        // ⚠ Mas apagar o override INTEIRO também jogava fora o que o user
        // tinha ajustado NAQUELE bloco antes de fechar o cadeado (o "aplicar
        // a todas" desligado). Guardamos, no congelamento, quais chaves
        // existiam antes — soltar o cadeado devolve exatamente aquelas.
        const antes = preLockRef.current[blockId];
        delete preLockRef.current[blockId];
        setBlockStyles((prev) => {
          if (!prev[blockId]) return prev;
          const { [blockId]: _descartado, ...resto } = prev;
          return antes && Object.keys(antes).length > 0
            ? { ...resto, [blockId]: antes }
            : resto;
        });
        return;
      }
      preLockRef.current[blockId] = { ...(blockStyles[blockId] ?? {}) };
      setBlockStyles((prev) => ({
        ...prev,
        [blockId]: {
          // o MODELO entra no congelamento junto com o resto — sem ele, clicar
          // num card de modelo repintava o bloco travado
          presetId,
          fontScale,
          primary,
          accent,
          posX,
          posY,
          textCase: textCase === 'auto' ? null : textCase,
          bold,
          italic,
          underline: underlineG,
          fontOverride: fontOv,
          fxStroke: fxStrokeG,
          fxShadow: fxShadowG,
          fxGlow: fxGlowG,
          fxSmoke: fxSmokeG,
          autoFit: autoFitG,
          singleLine: singleLineG,
          fx: fxG,
          bgMode: bgModeG,
          bgColor: bgColorG,
          bgOpacity: bgOpacityG,
          animIn: animInG,
          animOut: animOutG,
          // o que o user já tinha ajustado neste bloco continua valendo
          ...prev[blockId],
        },
      }));
      setLockedBlocks((prev) => [...prev, blockId]);
    },
    [pushHistory, lockedBlocks, blockStyles, setLockedBlocks, setBlockStyles, presetId, fontScale, primary, accent, posX, posY, textCase, bold, italic, underlineG, fontOv, fxStrokeG, fxShadowG, fxGlowG, fxSmokeG, autoFitG, singleLineG, fxG, bgModeG, bgColorG, bgOpacityG, animInG, animOutG],
  );

  // ── IDENTIDADE dos blocos (cadeado + os 3 mapas por id) ─────────────────
  // Tudo que morre junto com o bloco quando ele ganha um id novo. Sai daqui
  // pro motor testado e volta inteiro — é o que impede o "trocar o ritmo
  // destrava o cadeado sozinho".
  const identity = useMemo<BlockIdentity>(
    () => ({ locked: lockedBlocks, blockStyles, wordStyles, highlights }),
    [lockedBlocks, blockStyles, wordStyles, highlights],
  );
  const commitBlocks = useCallback(
    (r: { blocks: Block[] } & BlockIdentity) => {
      setBlocks(r.blocks);
      setLockedBlocks(r.locked);
      setBlockStyles(r.blockStyles);
      setWordStyles(r.wordStyles);
      setHighlights(r.highlights);
    },
    [setBlocks, setLockedBlocks, setBlockStyles, setWordStyles, setHighlights],
  );

  // ── handlers ESTÁVEIS pros componentes memorizados (useEvent) ───────────
  const hPickPreset = useEvent((id: string) => {
    pushHistory();
    setPresetId(id);
  });
  const hTimelineSelect = useEvent((id: string) => setSelBlockId(id));
  const hRetime = useEvent(
    (id: string, start: number, end: number, mode: 'move' | 'trim') =>
      retimeBounds(id, start, end, mode),
  );
  const hBlockSelect = useEvent((b: Block) => {
    setSelBlockId(b.id);
    seekTo(b.start);
  });
  const hEditText = useEvent((id: string, text: string) => editBlockText(id, text));
  const hSplit = useEvent((id: string) => doSplit(id));
  const hMerge = useEvent((id: string) => doMerge(id));
  const hDelete = useEvent((id: string) => doDelete(id));
  const hNudge = useEvent((id: string, edge: 'start' | 'end', delta: number) =>
    nudge(id, edge, delta),
  );
  const hToggleWord = useEvent((id: string, wi: number) => toggleHighlight(id, wi));
  const hToggleLock = useEvent((id: string) => toggleLock(id));
  const hRetimeHeadline = useEvent((id: string, start: number, end: number) =>
    setHeadlines((prev) =>
      prev.map((h) => (h.id === id ? { ...h, start, end } : h)),
    ),
  );
  // o chip só depende do processing — nó estável pro memo da galeria
  const galleryExtra = useMemo(
    () => (
      /* Templates + roteiro hook × body: UMA porta só, ao lado dos
         ⭐ Favoritos — a janela traz os trechos dentro */
      <button
        type="button"
        onClick={() => {
          setScriptOnTpls(true);
          setScriptOpen(true);
        }}
        disabled={phase === 'transcribing' || phase === 'rendering'}
        title="Templates de legenda: hook num lettering e body em outro, aplicados de uma vez"
        className="roteiro-chip"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3.4" y="5" width="12.5" height="3.6" rx="1.8" fill="currentColor" />
          <rect x="3.4" y="10.7" width="17.2" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
          <rect x="3.4" y="15.6" width="13.4" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
          <circle cx="19.6" cy="6.8" r="2" fill="currentColor" opacity="0.85" />
        </svg>
        Templates
      </button>
    ),
    [phase],
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
        // sessão salva ANTES desta feature: bloco travado congelou tudo menos
        // a animação. Sem o backfill, mexer na animação global vazaria pra
        // dentro dele — e o cadeado promete o contrário.
        {
          const styles = { ...(saved.blockStyles ?? {}) };
          for (const id of saved.lockedBlocks ?? []) {
            const ov = { ...(styles[id] ?? {}) };
            if (ov.animIn === undefined) ov.animIn = null;
            if (ov.animOut === undefined) ov.animOut = null;
            styles[id] = ov;
          }
          // sessões antigas guardavam cadeado/estilo/destaque de blocos que já
          // não existem (split/merge/excluir nunca limpavam) — a poda entra
          // aqui pra a sessão restaurada não voltar suja
          const podado = pruneIdentity(saved.blocks, {
            locked: saved.lockedBlocks ?? [],
            blockStyles: styles,
            wordStyles: saved.wordStyles ?? {},
            highlights: saved.highlights ?? {},
          });
          setBlockStyles(podado.blockStyles);
          setWordStyles(podado.wordStyles);
          setLockedBlocks(podado.locked);
          setHighlights(podado.highlights);
        }
        if (Array.isArray(saved.script) && saved.script.length > 0) {
          setScriptSegs(saved.script);
        }
        setAutoFitG(saved.autoFit ?? true);
        setSingleLineG(saved.singleLine ?? false);
        setFxG(normalizeFx(saved.fx));
        setHeadlines(Array.isArray(saved.headlines) ? saved.headlines : []);
        setBgModeG(saved.bgMode ?? 'preset');
        setBgColorG(saved.bgColor ?? null);
        setBgOpacityG(saved.bgOpacity ?? 1);
        setAnimInG(saved.animIn ?? null);
        setAnimOutG(saved.animOut ?? null);
        setPace(saved.pace);
        setLanguage(saved.language);
        // highlights já veio podado junto com o resto da identidade acima
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

  // persiste a edição na sessão a cada mudança relevante — com RESPIRO:
  // serializar words+blocks é caro e rodava a CADA tick de slider
  useEffect(() => {
    if (!file || phase !== 'ready' || blocks.length === 0) return;
    const t = setTimeout(() => saveSession(file, {
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
      wordStyles,
      lockedBlocks,
      autoFit: autoFitG,
      singleLine: singleLineG,
      fx: fxG,
      headlines,
      bgMode: bgModeG,
      bgColor: bgColorG,
      bgOpacity: bgOpacityG,
      animIn: animInG,
      animOut: animOutG,
      script: scriptSegs,
    }), 400);
    return () => clearTimeout(t);
  }, [file, phase, words, blocks, presetId, fontScale, posY, primary, accent, pace, language, highlights, autoEmph, fontOv, posX, textCase, bold, italic, blockStyles, wordStyles, lockedBlocks, autoFitG, singleLineG, fxG, headlines, bgModeG, bgColorG, bgOpacityG, animInG, animOutG, scriptSegs]);

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
    // ⚠ os quatro mapas morrem JUNTOS com os blocos. Antes só os destaques
    // eram zerados, e cadeado/estilo de bloco do vídeo anterior ficavam
    // pendurados em ids que não existiam mais.
    setHighlights({});
    setLockedBlocks([]);
    setBlockStyles({});
    setWordStyles({});
    // vídeo novo = copy nova. O visual de cada trecho fica (é o template do
    // lote); só os textos colados vão embora.
    setScriptSegs((prev) => prev.map((sg) => ({ ...sg, text: '', words: null })));
    setPhase('idle');
    setStage(null);
    setProgress(null);
    setError(null);
    setResult(null);
    setRestored(false);
    setSelBlockId(null);
    setActiveBlockId(null);
    setWordSel(null);
    setRegroupInfo(null);
    setAudit(null);
    setHeadlines([]);
    setSelHeadlineId(null);
    audioRef.current = null;
    preLockRef.current = {};
  }

  function handleCancel() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

  /**
   * Manda UMA janela de áudio pro Whisper (a recuperação de um trecho que
   * ficou sem legenda). Mesma rota da transcrição cheia; devolve as palavras
   * com tempo RELATIVO ao recorte — quem desloca é o spliceRecovered.
   */
  const transcreverJanela = useCallback(
    async (wav: Blob, lang: string): Promise<TWord[]> => {
      const fd = new FormData();
      fd.append('audio', wav, 'trecho.wav');
      fd.append('language', lang);
      const res = await fetch('/api/tipografia/transcribe', {
        method: 'POST',
        body: fd,
        signal: abortRef.current?.signal,
      });
      if (!res.ok) throw new Error(`janela ${res.status}`);
      const j = (await res.json()) as { words?: TWord[] };
      return Array.isArray(j.words) ? j.words : [];
    },
    [],
  );

  /** Roda a conferência de novo, sem re-transcrever o vídeo inteiro. */
  const conferirDeNovo = useCallback(async () => {
    const a = audioRef.current;
    if (!a || words.length === 0 || auditando) return;
    setAuditando(true);
    setError(null);
    try {
      const r: AuditResult = await auditarTranscricao(a, words, (duration ?? 0) * 1000, {
        transcreverJanela: (wav) => transcreverJanela(wav, language),
        onStage: (m) => setStage(m),
      });
      if (r.recuperadas > 0) {
        pushHistory();
        setWords(r.words);
        commitBlocks(
          regroupKeepingLocks(r.words, pace, blocks, identity),
        );
      }
      setAudit(resumoAuditoria(r));
    } catch (e) {
      setError(toFriendlyMessage(e, 'Não consegui conferir o áudio agora.'));
    } finally {
      setAuditando(false);
      setStage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, duration, language, auditando, pace, blocks, identity, transcreverJanela]);

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
      audioRef.current = audio;
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

      // ⭐ CONFERE contra o áudio: o Whisper às vezes desiste de um trecho e
      // volta sem palavra nenhuma ali, sem erro. O que tem VOZ e não tem
      // palavra volta pro Whisper recortado; o que é silêncio fica quieto.
      let finais = json.words;
      try {
        const r = await auditarTranscricao(audio, json.words, (duration ?? 0) * 1000, {
          transcreverJanela: (wav) => transcreverJanela(wav, language),
          onStage: (m) => setStage(m),
          onProgress: (p) => setProgress(0.6 + p * 0.35),
          signal: abortRef.current?.signal,
        });
        finais = r.words;
        setAudit(resumoAuditoria(r));
      } catch (e) {
        // a conferência é uma REDE DE SEGURANÇA: se ela falhar, a
        // transcrição original continua valendo (só some o selo)
        console.warn('[tipografia] auditoria não rodou', e);
        setAudit(null);
      }

      setWords(finais);
      setBlocks(groupWords(finais, pace));
      setHighlights({});
      setWordStyles({});
      setLockedBlocks([]);
      setBlockStyles({});
      setWordSel(null);
      setSelBlockId(null);
      setActiveBlockId(null);
      setRegroupInfo(null);
      preLockRef.current = {};
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
        headlines,
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
      logHistory({
        tool: 'tipografia',
        title: `Letterings queimados em ${file.name}`,
        meta: `${blocks.length} blocos · modelo ${preset.name} — o projeto continua editável: reabra a ferramenta e selecione o MESMO arquivo`,
      });
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

  // ⚠ nada de setState dentro do updater de outro setState: em StrictMode o
  // updater roda duas vezes e o efeito colateral saía repetido/fora de hora.
  // O bloco novo é calculado FORA e a identidade é podada de uma vez.
  function editBlockText(id: string, text: string) {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    const nb = retimeBlockText(b, text);
    if (nb.words.length === b.words.length && blockText(nb) === blockText(b)) return;
    pushHistory();
    const nextBlocks = blocks.map((x) => (x.id === id ? nb : x));
    if (nb.words.length !== b.words.length) {
      // o texto mudou de tamanho: destaque e estilo por palavra que apontam
      // pra posição que não existe mais são podados (o resto sobrevive)
      const ident2: BlockIdentity = {
        locked: lockedBlocks,
        blockStyles,
        wordStyles: { ...wordStyles, [id]: {} },
        highlights,
      };
      const podado = pruneIdentity(nextBlocks, ident2);
      setBlocks(nextBlocks);
      setLockedBlocks(podado.locked);
      setBlockStyles(podado.blockStyles);
      setWordStyles(podado.wordStyles);
      setHighlights(podado.highlights);
      setWordSel((w) => (w && w.blockId === id ? null : w));
      return;
    }
    setBlocks(nextBlocks);
  }

  // ⚠ split/merge/excluir cunham um id NOVO. Fazer isso "na mão" jogava fora
  // cadeado, estilo do bloco, destaques e estilos por palavra do bloco antigo
  // — dividir um bloco travado o destravava calado. O motor testado
  // (lib/typography/blocks-edit) carrega a identidade junto e remapeia os
  // índices de palavra. Nada de setState dentro do updater: o resultado é
  // calculado FORA e aplicado de uma vez (updater roda 2x em StrictMode e
  // cunhava ids fantasma na seleção).
  function doSplit(id: string) {
    const r = splitKeepingIdentity(blocks, id, identity);
    if (!r) return;
    pushHistory();
    commitBlocks(r);
    setSelBlockId(r.firstId);
    setWordSel((w) => (w && w.blockId === id ? null : w));
  }

  function doMerge(id: string) {
    const r = mergeKeepingIdentity(blocks, id, identity);
    if (!r) return;
    pushHistory();
    commitBlocks(r);
    setSelBlockId(r.mergedId);
    setWordSel(null);
  }

  function doDelete(id: string) {
    pushHistory();
    commitBlocks(removeKeepingIdentity(blocks, id, identity));
    setSelBlockId((cur) => (cur === id ? null : cur));
    setActiveBlockId((cur) => (cur === id ? null : cur));
    setWordSel((w) => (w && w.blockId === id ? null : w));
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

  // ⭐ trocar o RITMO respeitando o CADEADO (bug relatado em 30.08: marcar o
  // cadeado em algumas partes e mudar o ritmo destravava tudo e aplicava a
  // mudança no vídeo inteiro). Agora só o que NÃO está travado é remontado;
  // o bloco travado atravessa com o mesmo id, as mesmas palavras, o mesmo
  // tempo e o mesmo estilo congelado.
  function regroup(newPace: GroupPace) {
    if (newPace === pace) return;
    pushHistory();
    setPace(newPace);
    if (words.length === 0) return;
    const r = regroupKeepingLocks(words, newPace, blocks, identity);
    commitBlocks(r);
    setWordSel(null);
    setSelBlockId((cur) => (cur && r.blocks.some((b) => b.id === cur) ? cur : null));
    setActiveBlockId((cur) => (cur && r.blocks.some((b) => b.id === cur) ? cur : null));
    setRegroupInfo(
      r.kept > 0
        ? `${r.remade} bloco${r.remade === 1 ? '' : 's'} remontado${r.remade === 1 ? '' : 's'} no ritmo novo · ${r.kept} travado${r.kept === 1 ? '' : 's'} ficou${r.kept === 1 ? '' : 'ram'} intacto${r.kept === 1 ? '' : 's'}`
        : null,
    );
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
        title="Legendas Automáticas"
        eyebrow="Legendas animadas"
        subtitle="Sobe o vídeo e a fala vira legenda animada profissional, no tempo exato do áudio — escolhe o modelo, edita direto no preview e baixa com a legenda queimada."
        hue={HUE}
        icon={<IconTipografia size={30} />}
      />
      <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-6">
      <div className="flex flex-col gap-5">
        {/* Transcrição tem FALLBACK no servidor (Groq primeiro, AssemblyAI
            se ela falhar/faltar): quem tem só uma das duas está pronto —
            declarar o grupo evita o alarme falso que perdeu cliente. */}
        <MissingKeyBanner services={[['groq', 'assemblyai']]} />

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
          <div className="mb-3">
            <LangPicker value={language} onChange={setLanguage} disabled={processing} />
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
                  onSelectBlock={(id) => {
                    setSelBlockId(id);
                    setWordSel((w) => (w && w.blockId !== id ? null : w));
                  }}
                  onEditText={editBlockText}
                  wordSel={wordSel}
                  onWordSel={setWordSel}
                  headlines={headlines}
                  selHeadlineId={selHeadlineId}
                  onSelectHeadline={setSelHeadlineId}
                  onMoveHeadline={(id, x, y) => {
                    pushHistory();
                    setHeadlines((prev) =>
                      prev.map((h) =>
                        h.id === id ? { ...h, style: { ...h.style, posX: x, posY: y } } : h,
                      ),
                    );
                  }}
                />
                <p className="mt-2 text-[10.5px] leading-relaxed text-text-muted">
                  Arrasta a legenda pra posicionar (snap no centro) · clique
                  seleciona e mostra a alça de tamanho · com ela selecionada,
                  clica numa palavra e arrasta pra marcar um trecho (cor,
                  caixa, tamanho e fonte agem só nele) · duplo clique edita o
                  texto ali mesmo
                </p>
              </div>
              <div className="min-w-0 flex flex-col gap-5">
                <PresetGalleryM
                  presetId={presetId}
                  onPick={hPickPreset}
                  favs={favs}
                  onToggleFav={toggleFav}
                  disabled={processing}
                  extra={galleryExtra}
                />
                <FontPicker
                  value={
                    wordSel
                      ? (wordStyles[wordSel.blockId]?.[Math.min(wordSel.a, wordSel.b)]?.font ??
                        (effOf('fontOverride', fontOv) ?? null))
                      : (effOf('fontOverride', fontOv) ?? null)
                  }
                  presetFont={preset.font}
                  onPick={(k) => {
                    if (wordSel) {
                      setWordStylePatch({ font: k });
                      return;
                    }
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
                  onCommit={pushHistory}
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
                  regroupInfo={regroupInfo}
                  defaultPrimary={preset.defaultPrimary}
                  defaultAccent={preset.defaultAccent}
                  autoFit={effOf('autoFit', autoFitG) ?? true}
                  singleLine={effOf('singleLine', singleLineG) ?? false}
                  fx={normalizeFx(effOf('fx', fxG) ?? fxG)}
                  bgMode={effOf('bgMode', bgModeG) ?? 'preset'}
                  bgColor={effOf('bgColor', bgColorG) ?? null}
                  bgOpacity={effOf('bgOpacity', bgOpacityG) ?? 1}
                  animIn={effOf('animIn', animInG) ?? null}
                  animOut={effOf('animOut', animOutG) ?? null}
                  presetInKind={panelPreset.in.kind}
                  presetOutKind={panelPreset.out.kind}
                  previewPreset={panelPreset}
                  unsupportedIn={unsupportedInKinds(panelPreset)}
                  sel={
                    wordSel
                      ? {
                          count: Math.abs(wordSel.b - wordSel.a) + 1,
                          cur:
                            wordStyles[wordSel.blockId]?.[
                              Math.min(wordSel.a, wordSel.b)
                            ] ?? {},
                          set: setWordStylePatch,
                          clear: () => setWordSel(null),
                          reset: () => {
                            clearWordSelStyles();
                            setWordSel(null);
                          },
                        }
                      : null
                  }
                  disabled={processing}
                />
              </div>
            </div>

            <HeadlinePanel
              headlines={headlines}
              selId={selHeadlineId}
              onSelect={setSelHeadlineId}
              onAdd={() => {
                pushHistory();
                const agora = (videoRef.current?.currentTime ?? 0) * 1000;
                const nova = makeHeadline(agora, (duration ?? 4) * 1000 - agora);
                setHeadlines((prev) => [...prev, nova]);
                setSelHeadlineId(nova.id);
              }}
              onRemove={(id) => {
                pushHistory();
                setHeadlines((prev) => prev.filter((h) => h.id !== id));
                setSelHeadlineId((cur) => (cur === id ? null : cur));
              }}
              onPatch={(id, patch) =>
                setHeadlines((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)))
              }
              onCommit={pushHistory}
              onSeek={seekTo}
              currentMs={(videoRef.current?.currentTime ?? 0) * 1000}
              durationMs={(duration ?? 0) * 1000}
              disabled={processing}
            />

            <TimelineM
              blocks={blocks}
              duration={duration ?? 0}
              videoRef={videoRef}
              videoUrl={videoUrl}
              presetCat={preset.cat}
              selId={selBlockId}
              onSelect={hTimelineSelect}
              onRetime={hRetime}
              onDragStart={pushHistory}
              headlines={headlines}
              selHeadlineId={selHeadlineId}
              onSelectHeadline={setSelHeadlineId}
              onRetimeHeadline={hRetimeHeadline}
              disabled={processing}
            />

            <BlockListM
              blocks={blocks}
              selId={selBlockId}
              activeId={activeBlockId}
              highlights={highlights}
              locked={lockedBlocks}
              onSelect={hBlockSelect}
              onEditText={hEditText}
              onSplit={hSplit}
              onMerge={hMerge}
              onDelete={hDelete}
              onNudge={hNudge}
              onToggleWord={hToggleWord}
              onToggleLock={hToggleLock}
              disabled={processing}
            />

            <CaptionScriptModal
              open={scriptOpen}
              onClose={() => setScriptOpen(false)}
              blocks={blocks}
              ident={identity}
              fallbackPresetId={presetId}
              segments={scriptSegs}
              onSegments={setScriptSegs}
              favs={favs}
              onToggleFav={toggleFav}
              startOnTemplates={scriptOnTpls}
              onApply={(r: ApplyResult) => {
                pushHistory();
                commitBlocks(r);
                setWordSel(null);
                setSelBlockId(null);
              }}
            />

            {/* ⭐ o vídeo tinha fala sem legenda? a resposta vem MEDIDA */}
            {audit ? (
              <div
                className={
                  'mt-5 flex flex-wrap items-center gap-3 rounded-[14px] px-4 py-3 text-[12.5px] leading-relaxed ' +
                  (audit.tom === 'ok'
                    ? 'bg-lime/[0.07] text-lime shadow-[inset_0_0_0_1px_rgba(200,232,124,0.32)]'
                    : audit.tom === 'erro'
                      ? 'bg-red-500/[0.07] text-red-300 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.38)]'
                      : 'bg-amber-400/[0.07] text-amber-500 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]')
                }
              >
                <span className="min-w-0 flex-1">{audit.texto}</span>
                <button
                  type="button"
                  onClick={conferirDeNovo}
                  disabled={auditando || processing}
                  className={
                    'shrink-0 rounded-[10px] bg-bg-soft px-3 py-1.5 text-[11.5px] font-bold text-text shadow-[inset_0_0_0_1px_rgb(var(--line-strong))] hover:text-amber-500 disabled:opacity-40' +
                    T3D
                  }
                >
                  {auditando ? 'Conferindo...' : 'Conferir de novo'}
                </button>
              </div>
            ) : null}

            <CopyFixPanel
              disabled={processing}
              onFix={(copyText) => {
                try {
                  const r = correctBlocksByCopy(blocks, copyText);
                  pushHistory();
                  setBlocks(r.blocks);
                  return {
                    ok: true,
                    msg:
                      r.corrected === 0 && r.added === 0
                        ? 'A legenda já estava idêntica à copy — nada pra corrigir.'
                        : `${r.corrected} palavra${r.corrected === 1 ? '' : 's'} corrigida${r.corrected === 1 ? '' : 's'}` +
                          (r.added > 0 ? ` e ${r.added} que o áudio tinha comido devolvida${r.added === 1 ? '' : 's'}` : '') +
                          ' — blocos e tempos intactos (Ctrl+Z desfaz).',
                  };
                } catch (e) {
                  return { ok: false, msg: (e as Error).message };
                }
              }}
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
  wordSel,
  onWordSel,
  headlines,
  selHeadlineId,
  onSelectHeadline,
  onMoveHeadline,
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
  wordSel: { blockId: string; a: number; b: number } | null;
  /** headlines: texto parado, arrastavel INDEPENDENTE da legenda */
  headlines: Headline[];
  selHeadlineId: string | null;
  onSelectHeadline: (id: string | null) => void;
  onMoveHeadline: (id: string, posX: number, posY: number) => void;
  onWordSel: (sel: { blockId: string; a: number; b: number } | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // relógio/barra vivem em refs (escritos pelo rAF) — nao ha estado de tempo
  const [dur, setDur] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // arrasto AO VIVO: posição/tamanho ficam num ref que o rAF lê e o estado
  // do React só é gravado ao SOLTAR. Antes, cada pointermove commitava no
  // estado global e re-renderizava a página inteira (galeria de centenas de
  // canvases, timeline, lista de blocos) — era a lentidão de mover a legenda.
  const dragOvRef = useRef<{ posX: number; posY: number; fontScale: number } | null>(null);
  // drag da legenda: estado vivo pro rAF desenhar as guias sem re-render
  const dragRef = useRef<{
    mode: 'move' | 'scale' | 'wordsel';
    moved: boolean;
    snapX: boolean;
    snapY: boolean;
    dist0: number;
    scale0: number;
    /** âncora da seleção de palavras (modo wordsel) */
    wordAnchor: number;
  } | null>(null);
  // seleção (caixa + alça) e bbox vivos pro rAF
  const selRef = useRef(false);
  const bboxRef = useRef<{ x: number; y: number; w: number; h: number; blockId: string } | null>(null);
  const wordBoxesRef = useRef<{
    blockId: string;
    boxes: Array<{ i: number; x: number; y: number; w: number; h: number }>;
  } | null>(null);
  const dprRef = useRef(1);
  /** último instante em que o hover remediu a caixa (throttle) */
  const hoverMedidoRef = useRef(0);
  const [editing, setEditing] = useState<{
    id: string;
    value: string;
    caret: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const editingRef = useRef<typeof editing>(null);
  editingRef.current = editing;

  // refs pros valores vivos dentro do rAF (evita recriar o loop a cada edição)
  const liveRef = useRef({ blocks, preset, style, fontScale, wordSel, headlines, selHeadlineId });
  liveRef.current = { blocks, preset, style, fontScale, wordSel, headlines, selHeadlineId };
  /** arrasto de HEADLINE: override vivo, igual ao da legenda */
  const hlDragRef = useRef<{ id: string; posX: number; posY: number; moved: boolean } | null>(null);

  // assinatura do último frame desenhado — o rAF pula o trabalho quando nada
  // mudou (ver o guard `dirty` no tick)
  const lastDrawRef = useRef<{
    t: number;
    W: number;
    H: number;
    blocks: Block[];
    preset: ReturnType<typeof getPreset>;
    style: StyleState;
    fontScale: number;
    wordSel: { blockId: string; a: number; b: number } | null;
    headlines: Headline[];
    selHl: string | null;
    hlX?: number;
    hlY?: number;
    sel: boolean;
    ovX?: number;
    ovY?: number;
    ovS?: number;
    snapX?: boolean;
    snapY?: boolean;
  } | null>(null);
  // barra de tempo e relógio: escritos por REF a 60fps. Antes o `value` vinha
  // do estado, atualizado só pelo `timeupdate` (~4Hz) — por isso o polegar
  // "voltava" e só depois pulava quando o user arrastava.
  const rangeRef = useRef<HTMLInputElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const scrubbingRef = useRef(false);

  useEffect(() => {
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
        // ⚡ SÓ REDESENHA QUANDO ALGO MUDOU. Cada frame faz até três passadas
        // de layout de texto (drawCaptions + captionBBoxAt + wordBoxesAt), e
        // antes isso rodava a 60fps mesmo com o vídeo parado e ninguém
        // mexendo — era a lentidão de arrastar e redimensionar a legenda.
        const liveNow = liveRef.current;
        const edNow = editingRef.current;
        const ovNow = dragOvRef.current;
        const dragNow = dragRef.current;
        const tNow = v.currentTime;
        const prevDraw = lastDrawRef.current;
        const dirty =
          !prevDraw ||
          !!edNow || // editando: o caret pisca, precisa de frame vivo
          prevDraw.t !== tNow ||
          prevDraw.W !== W ||
          prevDraw.H !== H ||
          prevDraw.blocks !== liveNow.blocks ||
          prevDraw.preset !== liveNow.preset ||
          prevDraw.style !== liveNow.style ||
          prevDraw.fontScale !== liveNow.fontScale ||
          prevDraw.wordSel !== liveNow.wordSel ||
          prevDraw.headlines !== liveNow.headlines ||
          prevDraw.selHl !== liveNow.selHeadlineId ||
          prevDraw.hlX !== hlDragRef.current?.posX ||
          prevDraw.hlY !== hlDragRef.current?.posY ||
          prevDraw.sel !== selRef.current ||
          prevDraw.ovX !== ovNow?.posX ||
          prevDraw.ovY !== ovNow?.posY ||
          prevDraw.ovS !== ovNow?.fontScale ||
          prevDraw.snapX !== dragNow?.snapX ||
          prevDraw.snapY !== dragNow?.snapY;
        if (dirty) {
          lastDrawRef.current = {
            t: tNow,
            W,
            H,
            blocks: liveNow.blocks,
            preset: liveNow.preset,
            style: liveNow.style,
            fontScale: liveNow.fontScale,
            wordSel: liveNow.wordSel,
            headlines: liveNow.headlines,
            selHl: liveNow.selHeadlineId,
            hlX: hlDragRef.current?.posX,
            hlY: hlDragRef.current?.posY,
            sel: selRef.current,
            ovX: ovNow?.posX,
            ovY: ovNow?.posY,
            ovS: ovNow?.fontScale,
            snapX: dragNow?.snapX,
            snapY: dragNow?.snapY,
          };
        }
        const ctx = dirty ? c.getContext('2d') : null;
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          const { blocks: b0, preset: p, style: sBase, wordSel: wSel } = liveRef.current;
          // arrasto em andamento: o override do ref vence o estado — e vence
          // também o perBlock do bloco em cena (senão o congelado não mexia)
          let s = sBase;
          const ov = dragOvRef.current;
          if (ov) {
            let pb = sBase.perBlock;
            const curBB = bboxRef.current;
            if (curBB && pb && pb[curBB.blockId]) {
              const { posX: _px, posY: _py, fontScale: _pf, ...resto } = pb[curBB.blockId];
              pb = { ...pb, [curBB.blockId]: resto };
            }
            s = { ...sBase, posX: ov.posX, posY: ov.posY, fontScale: ov.fontScale, perBlock: pb };
          }
          // edição AO VIVO: o texto digitado renderiza com o lettering REAL
          // (mesmo engine), atualizando a cada tecla — estilo CapCut
          const ed = editingRef.current;
          const b = ed
            ? b0.map((x) =>
                x.id === ed.id ? retimeBlockText(x, ed.value.trim() || '…') : x,
              )
            : b0;
          drawCaptions(ctx, b, p, s, v.currentTime * 1000, W, H);
          // caret piscando na posição do cursor do input invisível
          if (ed) {
            const wbEd = wordBoxesAt(ctx, b, p, s, v.currentTime * 1000, W, H);
            if (wbEd && wbEd.blockId === ed.id && Math.floor(performance.now() / 530) % 2 === 0) {
              const val = ed.value;
              const caret = Math.max(0, Math.min(ed.caret, val.length));
              const before = val.slice(0, caret).split(' ');
              const wIdx = Math.min(before.length - 1, wbEd.boxes.length - 1);
              const inWord = before[before.length - 1]?.length ?? 0;
              const wordLen = (val.split(' ')[wIdx] ?? '').length;
              const box = wbEd.boxes.find((x) => x.i === wIdx) ?? wbEd.boxes[wbEd.boxes.length - 1];
              if (box) {
                const frac = wordLen > 0 ? Math.min(1, inWord / wordLen) : 1;
                const cxr = box.x + box.w * frac;
                ctx.save();
                ctx.fillStyle = '#fbbf24';
                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = 4;
                ctx.fillRect(cxr, box.y + box.h * 0.06, Math.max(2, 2 * dpr), box.h * 0.88);
                ctx.restore();
              }
            }
          }
          // ── HEADLINES (texto parado) por cima da legenda ──
          {
            const hlDrag = hlDragRef.current;
            const lista = hlDrag
              ? liveNow.headlines.map((h) =>
                  h.id === hlDrag.id
                    ? { ...h, style: { ...h.style, posX: hlDrag.posX, posY: hlDrag.posY } }
                    : h,
                )
              : liveNow.headlines;
            drawHeadlines(ctx, lista, v.currentTime * 1000, W, H);
            // moldura da headline selecionada (so no preview, nunca no export)
            const selHl = lista.find((h) => h.id === liveNow.selHeadlineId);
            if (selHl && headlinesAt([selHl], v.currentTime * 1000).length > 0) {
              const L = layoutHeadline(measurerFromCtx(ctx), selHl, W, H);
              ctx.save();
              ctx.strokeStyle = 'rgba(34,211,238,0.95)';
              ctx.lineWidth = Math.max(1.5, dpr);
              ctx.setLineDash([7 * dpr, 5 * dpr]);
              ctx.strokeRect(L.box.x, L.box.y, L.box.w, L.box.h);
              ctx.restore();
            }
          }
          dprRef.current = dpr;
          // ⚡ a bbox é uma SEGUNDA passada de layout. Só vale a pena no frame
          // quando a caixa de seleção precisa ser DESENHADA; pro hit-test do
          // clique/arrasto ela é calculada na hora do evento (medirBBox).
          if (selRef.current) {
            bboxRef.current = captionBBoxAt(ctx, b, p, s, v.currentTime * 1000, W, H);
            wordBoxesRef.current = wordBoxesAt(ctx, b, p, s, v.currentTime * 1000, W, H);
          } else {
            bboxRef.current = null;
            wordBoxesRef.current = null;
          }
          // realce da seleção de palavras (só preview, nunca no export)
          const wb = wordBoxesRef.current;
          if (wSel && wb && wb.blockId === wSel.blockId) {
            const lo = Math.min(wSel.a, wSel.b);
            const hi = Math.max(wSel.a, wSel.b);
            ctx.save();
            ctx.fillStyle = 'rgba(96,165,250,0.28)';
            ctx.strokeStyle = 'rgba(96,165,250,0.9)';
            ctx.lineWidth = Math.max(1, dpr);
            for (const box of wb.boxes) {
              if (box.i < lo || box.i > hi) continue;
              const px = 4 * dpr;
              ctx.fillRect(box.x - px, box.y, box.w + px * 2, box.h);
              ctx.strokeRect(box.x - px, box.y, box.w + px * 2, box.h);
            }
            ctx.restore();
          }
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
        // barra + relógio direto no DOM: acompanham o vídeo a 60fps sem
        // re-render, e ficam parados enquanto o user arrasta o polegar (senão
        // o vídeo, que chega atrasado, empurraria o polegar de volta)
        if (!scrubbingRef.current) {
          const rg = rangeRef.current;
          const d = v.duration || 0;
          if (rg && d > 0) {
            rg.value = String(v.currentTime);
            rg.style.setProperty('--range-fill', `${(v.currentTime / d) * 100}%`);
          }
          const cl = clockRef.current;
          if (cl && d > 0) cl.textContent = `${formatTime(v.currentTime)} / ${formatTime(d)}`;
        }
      }
    };
    // relógio COMPARTILHADO com prioridade alta: a prévia do vídeo desenha
    // antes da galeria e dos cartões de efeito, e o orçamento por frame
    // impede que eles roubem a thread do <video> (era o "player travado")
    return registerCanvasJob(tick, { fps: 60, prio: 10, el: wrapRef.current });
  }, [videoRef]);

  /**
   * Até onde a legenda pode ir. O engine só exige que sobre uma FATIA do
   * bloco dentro do quadro (FRACAO_VISIVEL); aqui a conta é a mesma, com uma
   * fatia um pouco maior, medida na caixa REAL desenhada. Sendo o limite da
   * UI um pouco mais apertado que o do engine, a legenda acompanha o mouse
   * até o fim sem zona morta (o engine nunca precisa corrigir por cima).
   */
  const limitesArrasto = useCallback(() => {
    const c = canvasRef.current;
    const bb = bboxRef.current ?? null;
    if (!c || !bb || bb.w <= 0 || bb.h <= 0) {
      return { minX: -0.6, maxX: 1.6, minY: -0.6, maxY: 1.6 };
    }
    const W = c.width;
    const H = c.height;
    // A caixa MEDIDA (bb) inclui o fundo/pílula do modelo, então é maior que
    // o bloco de texto que o engine usa na conta dele. Pra o limite da UI
    // ficar SEMPRE dentro do limite do engine (zero zona morta ao arrastar),
    // esta fatia precisa ser >= 0,5 - (0,5 - FRACAO_VISIVEL) * bloco/caixa.
    // Com uma pílula gorda (caixa até 1,5x o bloco) isso dá 0,26 — 0,30 sobra.
    const FATIA = 0.3;
    const restoX = Math.max(10, Math.min(bb.w, W) * FATIA);
    const restoY = Math.max(10, Math.min(bb.h, H) * FATIA);
    return {
      minX: (restoX - bb.w / 2) / W,
      maxX: (W - restoX + bb.w / 2) / W,
      minY: (restoY - bb.h / 2) / H,
      maxY: (H - restoY + bb.h / 2) / H,
    };
  }, []);

  /**
   * Mede a caixa da legenda AGORA (hit-test de clique/arrasto/duplo clique).
   * Fora do frame de desenho, porque medir é caro e só o evento precisa.
   */
  const medirBBox = useCallback(() => {
    const c = canvasRef.current;
    const v = videoRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !v || !ctx) return null;
    const { blocks: b, preset: p, style: s } = liveRef.current;
    bboxRef.current = captionBBoxAt(ctx, b, p, s, v.currentTime * 1000, c.width, c.height);
    return bboxRef.current;
  }, [videoRef]);
  const medirPalavras = useCallback(() => {
    const c = canvasRef.current;
    const v = videoRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !v || !ctx) return null;
    const { blocks: b, preset: p, style: s } = liveRef.current;
    wordBoxesRef.current = wordBoxesAt(ctx, b, p, s, v.currentTime * 1000, c.width, c.height);
    return wordBoxesRef.current;
  }, [videoRef]);

  // bloco ativo (4Hz via timeupdate — não re-renderiza a 60fps)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      // o relógio e a barra são escritos por ref no rAF — aqui só o bloco
      // ativo, que é quem a lista lá embaixo precisa destacar
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
          // a bbox não é mais recalculada todo frame — mede agora, pro clique
          // ── HEADLINE primeiro: ela fica POR CIMA da legenda no desenho,
          // entao tem que ganhar o clique tambem (senao seria impossivel pegar
          // uma headline que cobre a legenda)
          {
            const c = canvasRef.current;
            const v = videoRef.current;
            const cx2 = c?.getContext('2d');
            if (c && v && cx2) {
              const hit = headlineAtPoint(
                measurerFromCtx(cx2),
                liveRef.current.headlines,
                v.currentTime * 1000,
                px,
                py,
                c.width,
                c.height,
              );
              if (hit) {
                onInteractStart();
                onSelectHeadline(hit.headline.id);
                selRef.current = false;
                onWordSel(null);
                hlDragRef.current = {
                  id: hit.headline.id,
                  posX: hit.headline.style.posX,
                  posY: hit.headline.style.posY,
                  moved: false,
                };
                wrap.style.cursor = 'grabbing';
                return;
              }
            }
          }
          const bb = selRef.current ? (bboxRef.current ?? medirBBox()) : medirBBox();
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
            const st0 = liveRef.current.style;
            const pb0 = st0.perBlock?.[bb.blockId];
            dragOvRef.current = {
              posX: pb0?.posX ?? st0.posX ?? 0.5,
              posY: pb0?.posY ?? st0.posY ?? 0.76,
              fontScale: liveRef.current.fontScale,
            };
            dragRef.current = {
              mode: 'scale',
              moved: false,
              snapX: false,
              snapY: false,
              dist0: Math.max(12, Math.hypot(px - cxB, py - cyB)),
              scale0: liveRef.current.fontScale,
              wordAnchor: -1,
            };
            return;
          }
          // legenda JÁ selecionada + clique EM CIMA de uma palavra = seleção
          // parcial (arrasta pra marcar o trecho — estilo CapCut). Clicar no
          // respiro ao redor continua movendo a legenda.
          const wb = selRef.current ? (wordBoxesRef.current ?? medirPalavras()) : null;
          if (selRef.current && wb && bb && wb.blockId === bb.blockId) {
            const hitWord = wb.boxes.find(
              (bx) =>
                px >= bx.x - 4 * dpr &&
                px <= bx.x + bx.w + 4 * dpr &&
                py >= bx.y &&
                py <= bx.y + bx.h,
            );
            if (hitWord) {
              onWordSel({ blockId: wb.blockId, a: hitWord.i, b: hitWord.i });
              dragRef.current = {
                mode: 'wordsel',
                moved: false,
                snapX: false,
                snapY: false,
                dist0: 0,
                scale0: 1,
                wordAnchor: hitWord.i,
              };
              return;
            }
          }
          {
            const st0 = liveRef.current.style;
            const pb0 = bb ? st0.perBlock?.[bb.blockId] : undefined;
            dragOvRef.current = {
              posX: pb0?.posX ?? st0.posX ?? 0.5,
              posY: pb0?.posY ?? st0.posY ?? 0.76,
              fontScale: liveRef.current.fontScale,
            };
          }
          dragRef.current = {
            mode: 'move',
            moved: false,
            snapX: false,
            snapY: false,
            dist0: 0,
            scale0: 1,
            wordAnchor: -1,
          };
        }}
        onPointerMove={(e) => {
          const wrap = wrapRef.current;
          const drag = dragRef.current;
          if (!wrap) return;
          // arrasto de HEADLINE: escreve no ref e o rAF desenha (o estado so
          // recebe no soltar, igual ao arrasto da legenda)
          const hd = hlDragRef.current;
          if (hd) {
            const r = wrap.getBoundingClientRect();
            const c = canvasRef.current;
            const h = liveRef.current.headlines.find((x) => x.id === hd.id);
            if (c && h) {
              const cx2 = c.getContext('2d');
              const L = cx2 ? layoutHeadline(measurerFromCtx(cx2), h, c.width, c.height) : null;
              const lim = L
                ? headlinePosBounds(L.box.w, L.box.h, c.width, c.height)
                : { minX: -0.6, maxX: 1.6, minY: -0.6, maxY: 1.6 };
              const nx = (e.clientX - r.left) / r.width;
              const ny = (e.clientY - r.top) / r.height;
              hd.posX = Math.min(lim.maxX, Math.max(lim.minX, nx));
              hd.posY = Math.min(lim.maxY, Math.max(lim.minY, ny));
              hd.moved = true;
            }
            return;
          }
          if (!drag) {
            // hover: cursor certo em cada zona (alça = redimensionar, palavra
            // do bloco selecionado = texto, legenda = mover) — igual CapCut
            const rect0 = wrap.getBoundingClientRect();
            const dpr0 = dprRef.current;
            const hx = (e.clientX - rect0.left) * dpr0;
            const hy = (e.clientY - rect0.top) * dpr0;
            // hover: medir a cada movimento do mouse seria caro; mede no
            // máximo a cada 120ms e reaproveita entre os movimentos
            const agora = performance.now();
            if (agora - hoverMedidoRef.current > 120) {
              hoverMedidoRef.current = agora;
              medirBBox();
              if (selRef.current) medirPalavras();
            }
            const bb0 = bboxRef.current;
            const wb0 = wordBoxesRef.current;
            const hr = 14 * dpr0;
            const overWord =
              selRef.current &&
              wb0 &&
              bb0 &&
              wb0.blockId === bb0.blockId &&
              wb0.boxes.some(
                (bx) =>
                  hx >= bx.x - 4 * dpr0 &&
                  hx <= bx.x + bx.w + 4 * dpr0 &&
                  hy >= bx.y &&
                  hy <= bx.y + bx.h,
              );
            if (
              bb0 &&
              selRef.current &&
              Math.abs(hx - (bb0.x + bb0.w)) < hr &&
              Math.abs(hy - (bb0.y + bb0.h)) < hr
            ) {
              wrap.style.cursor = 'nwse-resize';
            } else if (overWord) {
              wrap.style.cursor = 'text';
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
          if (drag.mode === 'wordsel') {
            // arrastando a seleção: estende o range até a palavra sob o mouse
            const rectW = wrap.getBoundingClientRect();
            const dprW = dprRef.current;
            const sx = (e.clientX - rectW.left) * dprW;
            const sy = (e.clientY - rectW.top) * dprW;
            const wbW = wordBoxesRef.current ?? medirPalavras();
            if (wbW) {
              let best = -1;
              let bestDist = Infinity;
              for (const bx of wbW.boxes) {
                const inY = sy >= bx.y - bx.h * 0.4 && sy <= bx.y + bx.h * 1.4;
                if (!inY) continue;
                const cxW = bx.x + bx.w / 2;
                const dist = Math.abs(sx - cxW);
                if (dist < bestDist) {
                  bestDist = dist;
                  best = bx.i;
                }
              }
              if (best >= 0) {
                drag.moved = true;
                onWordSel({ blockId: wbW.blockId, a: drag.wordAnchor, b: best });
              }
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
            const bb = bboxRef.current ?? medirBBox();
            const ov = dragOvRef.current;
            if (!bb || !ov) return;
            const dpr = dprRef.current;
            const px = (e.clientX - rect.left) * dpr;
            const py = (e.clientY - rect.top) * dpr;
            const dist = Math.hypot(px - (bb.x + bb.w / 2), py - (bb.y + bb.h / 2));
            // faixa larga: dá pra encolher de verdade (0.15) pra caber num
            // canto e crescer até 6× pra hook gigante
            ov.fontScale = Math.min(6, Math.max(0.15, drag.scale0 * (dist / drag.dist0)));
            return;
          }
          let nx = (e.clientX - rect.left) / rect.width;
          let ny = (e.clientY - rect.top) / rect.height;
          // snap no centro (régua acende sólida quando encaixa)
          drag.snapX = Math.abs(nx - 0.5) < 0.03;
          drag.snapY = Math.abs(ny - 0.5) < 0.03;
          if (drag.snapX) nx = 0.5;
          if (drag.snapY) ny = 0.5;
          const ov = dragOvRef.current;
          if (ov) {
            // O limite NÃO é mais uma fração chutada da tela: vem MEDIDO do
            // engine (captionBBoxAt devolve os mesmos números que o desenho
            // usa). Dá pra pendurar a legenda pra fora do quadro; a única
            // regra é ela nunca sumir inteira. Como é a mesma conta dos dois
            // lados, o texto acompanha o mouse até o fim, sem zona morta.
            if (!bboxRef.current) medirBBox();
            const lim = limitesArrasto();
            ov.posX = Math.min(lim.maxX, Math.max(lim.minX, nx));
            ov.posY = Math.min(lim.maxY, Math.max(lim.minY, ny));
          }
        }}
        onPointerUp={(e) => {
          const hd = hlDragRef.current;
          hlDragRef.current = null;
          if (hd) {
            wrapRef.current?.releasePointerCapture(e.pointerId);
            if (wrapRef.current) wrapRef.current.style.cursor = 'default';
            if (hd.moved) onMoveHeadline(hd.id, hd.posX, hd.posY);
            dragRef.current = null;
            return;
          }
          const drag = dragRef.current;
          dragRef.current = null;
          wrapRef.current?.releasePointerCapture(e.pointerId);
          // fim do arrasto: o override vira UM commit no estado (uma entrada
          // no histórico, um save de sessão — não um por pointermove)
          const ov = dragOvRef.current;
          dragOvRef.current = null;
          if (drag && drag.moved && ov) {
            if (drag.mode === 'scale') onFontScale(ov.fontScale);
            else if (drag.mode === 'move') onPosChange(ov.posX, ov.posY);
          }
          if (!drag || drag.mode === 'wordsel' || drag.moved) return;
          // clique seco: dentro da legenda = selecionar; fora = play/deselect
          const wrap = wrapRef.current;
          const bb = bboxRef.current ?? medirBBox();
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
          onWordSel(null);
          if (selRef.current) {
            selRef.current = false;
          } else {
            togglePlay();
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          dragOvRef.current = null;
          hlDragRef.current = null;
        }}
        onDoubleClick={(e) => {
          const wrap = wrapRef.current;
          const bb = bboxRef.current ?? medirBBox();
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
          onWordSel(null);
          // input INVISÍVEL cobrindo a legenda: o texto digitado renderiza
          // AO VIVO com o lettering real no canvas (o input só captura teclas)
          const txt = blockText(block);
          setEditing({
            id: bb.blockId,
            value: txt,
            caret: txt.length,
            left: bb.x / dpr,
            top: bb.y / dpr,
            width: Math.max(120, bb.w / dpr),
            height: Math.max(36, bb.h / dpr),
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
            onChange={(e) =>
              setEditing({
                ...editing,
                value: e.target.value,
                caret: e.target.selectionStart ?? e.target.value.length,
              })
            }
            onSelect={(e) =>
              setEditing((ed) =>
                ed
                  ? { ...ed, caret: (e.target as HTMLInputElement).selectionStart ?? ed.caret }
                  : ed,
              )
            }
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
            // INVISÍVEL de propósito: só captura teclado/caret — quem mostra o
            // texto é o canvas, com o lettering real do modelo em tempo real
            className="absolute z-30 cursor-text opacity-0 outline-none"
            style={{
              left: editing.left,
              top: editing.top,
              width: editing.width,
              height: editing.height,
              caretColor: 'transparent',
              background: 'transparent',
              color: 'transparent',
            }}
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
          ref={rangeRef}
          type="range"
          min={0}
          max={Math.max(dur, 0.01)}
          step={0.001}
          defaultValue={0}
          // NÃO-CONTROLADO de propósito: quem escreve o `value` é o rAF, a
          // 60fps e sem re-render. Enquanto o polegar está sendo arrastado o
          // rAF não escreve, então ele anda colado no dedo e o vídeo segue.
          onPointerDown={() => {
            scrubbingRef.current = true;
          }}
          onPointerUp={() => {
            scrubbingRef.current = false;
          }}
          onPointerCancel={() => {
            scrubbingRef.current = false;
          }}
          onKeyDown={() => {
            scrubbingRef.current = true;
          }}
          onKeyUp={() => {
            scrubbingRef.current = false;
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            const t = parseFloat(el.value);
            const v = videoRef.current;
            if (v) v.currentTime = t;
            // pinta o preenchimento e o relógio na hora, sem esperar o vídeo
            const d = v?.duration || dur || 0;
            if (d > 0) el.style.setProperty('--range-fill', `${(t / d) * 100}%`);
            const cl = clockRef.current;
            if (cl && d > 0) cl.textContent = `${formatTime(t)} / ${formatTime(d)}`;
          }}
          className="w-full"
          style={{ accentColor: '#fbbf24', ['--range-fill' as string]: '0%' }}
        />
        <span ref={clockRef} className="mono shrink-0 text-[11px] text-text-muted">
          {formatTime(0)} / {formatTime(dur)}
        </span>
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
  headlines,
  selHeadlineId,
  onSelectHeadline,
  onRetimeHeadline,
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
  /** faixa PROPRIA das headlines (texto parado) */
  headlines: Headline[];
  selHeadlineId: string | null;
  onSelectHeadline: (id: string) => void;
  onRetimeHeadline: (id: string, start: number, end: number) => void;
  disabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef(false); // arrastando a agulha (fora dos blocos)
  /** arrasto de uma barra de HEADLINE (mover ou esticar as pontas) */
  const hlDragRef = useRef<{
    id: string;
    mode: 'move' | 'trim-start' | 'trim-end';
    grabMs: number;
    start: number;
    end: number;
  } | null>(null);
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

  // zoom com o SCROLL do mouse (estilo CapCut) — o tempo sob o cursor fica
  // parado no lugar enquanto a régua estica/encolhe
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPps((prev) => {
        const cur = prev || 40;
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        const next = Math.min(400, Math.max(6, cur * factor));
        if (next !== cur) {
          const rect = el.getBoundingClientRect();
          const cursorX = e.clientX - rect.left;
          const t = (el.scrollLeft + cursorX) / cur;
          pendingScrollRef.current = t * next - cursorX;
        }
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useLayoutEffect(() => {
    if (pendingScrollRef.current != null && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, pendingScrollRef.current);
      pendingScrollRef.current = null;
    }
  }, [pps]);

  // playhead + relógio seguem o vídeo sem re-render (via refs)
  const timeReadRef = useRef<HTMLSpanElement | null>(null);
  const lastTimeRef = useRef(-1); // só auto-rola quando o tempo muda
  useEffect(() => {
    const fmtClock = (s: number) =>
      `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
    const tick = () => {
      const v = videoRef.current;
      const ph = playheadRef.current;
      if (v && ph && pps > 0) ph.style.transform = `translateX(${v.currentTime * pps}px)`;
      const tr = timeReadRef.current;
      if (v && tr) tr.textContent = `${fmtClock(v.currentTime)} / ${fmtClock(duration)}`;
      // a faixa ACOMPANHA a agulha, estilo CapCut: se ela encosta na borda da
      // janela (tocando ou sendo arrastada), a timeline rola junto em vez de
      // deixar a agulha sumir. Só reage quando o TEMPO muda — com o vídeo
      // parado, rolar a faixa na mão continua livre.
      const sc = scrollRef.current;
      if (v && sc && pps > 0 && pendingScrollRef.current == null) {
        const t = v.currentTime;
        if (t !== lastTimeRef.current) {
          lastTimeRef.current = t;
          const x = t * pps;
          const vw = sc.clientWidth;
          const margin = Math.min(140, Math.max(40, vw * 0.18));
          if (x < sc.scrollLeft + margin) {
            sc.scrollLeft = Math.max(0, x - margin);
          } else if (x > sc.scrollLeft + vw - margin) {
            sc.scrollLeft = x - vw + margin;
          }
        }
      }
    };
    return registerCanvasJob(tick, { fps: 30, el: scrollRef.current });
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
        <span>Timeline — blocos movem · bordas cortam · agulha navega · scroll do mouse = zoom · faixa de baixo = headlines</span>
        <span className="flex items-center gap-3">
          <span
            ref={timeReadRef}
            className="mono rounded-[8px] border border-line bg-black/40 px-2.5 py-1 text-[13px] normal-case tracking-normal text-amber-200"
          >
            0:00.0
          </span>
          <button
            onClick={() => setPps((v) => Math.max(10, (v || 40) / 1.5))}
            className={'flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-bg-soft text-[13px] text-text-muted hover:border-amber-400/50 hover:text-amber-200' + T3D}
            title="Diminuir zoom"
          >
            −
          </button>
          <button
            onClick={() => setPps((v) => Math.min(400, (v || 40) * 1.5))}
            className={'flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-bg-soft text-[13px] text-text-muted hover:border-amber-400/50 hover:text-amber-200' + T3D}
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
            height: 196,
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
            // ritmo visual: blocos vizinhos alternam um tom, senão a faixa
            // vira uma mancha só e não dá pra contar os blocos de relance
            const alt = bi % 2 === 1;
            const txt = blockText(b);
            return (
              <div
                key={b.id}
                data-block="1"
                title={txt}
                className={
                  'group absolute top-[27px] h-[46px] cursor-grab overflow-hidden rounded-[7px] active:cursor-grabbing ' +
                  (sel ? 'z-10' : 'hover:brightness-[1.18]')
                }
                style={{
                  left,
                  width,
                  transition: 'box-shadow .12s ease, filter .12s ease',
                  backgroundImage: sel
                    ? `linear-gradient(180deg, ${col}b0 0%, ${col}6e 100%)`
                    : `linear-gradient(180deg, ${col}${alt ? '72' : '58'} 0%, ${col}${alt ? '30' : '20'} 100%)`,
                  border: `1px solid ${sel ? '#fbbf24' : `${col}80`}`,
                  boxShadow: sel
                    ? '0 0 0 1px rgba(251,191,36,0.9), 0 4px 18px -6px rgba(251,191,36,0.75)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.14)',
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
                {/* o texto do bloco dentro da barra — é o que faz achar o
                    trecho sem ficar passando o mouse de bloco em bloco */}
                {width > 34 ? (
                  <span
                    className="pointer-events-none absolute inset-0 flex items-center px-[9px] text-[10px] font-semibold leading-none text-white/90"
                    style={{
                      textShadow: '0 1px 2px rgba(0,0,0,0.75)',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      display: 'block',
                      lineHeight: '46px',
                    }}
                  >
                    {txt}
                  </span>
                ) : null}
                {/* alças de corte — discretas até a barra ser apontada, pra
                    faixa não virar um zebrado de tracinhos brancos */}
                <span
                  className="absolute inset-y-[3px] left-[2px] w-[5px] cursor-col-resize rounded-full bg-white/30 opacity-0 transition-opacity group-hover:opacity-100"
                  style={sel ? { opacity: 1 } : undefined}
                />
                <span
                  className="absolute inset-y-[3px] right-[2px] w-[5px] cursor-col-resize rounded-full bg-white/30 opacity-0 transition-opacity group-hover:opacity-100"
                  style={sel ? { opacity: 1 } : undefined}
                />
              </div>
            );
          })}

          {/* filmstrip (só visual — vídeo não é editável) */}
          {thumbs.length > 0 ? (
            <div
              className="pointer-events-none absolute left-0 top-[80px] flex h-[60px] overflow-hidden rounded-[7px]"
              style={{
                width: trackW,
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35), 0 2px 10px -6px rgba(0,0,0,0.9)',
              }}
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

          {/* ── FAIXA DAS HEADLINES (texto parado) ── */}
          <div
            className="pointer-events-none absolute left-0 top-[148px] h-[40px] rounded-[7px]"
            style={{ width: trackW, background: 'rgba(34,211,238,0.05)', boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.16)' }}
          />
          {headlines.map((h) => {
            const left = (h.start / 1000) * effPps;
            const width = Math.max(12, ((h.end - h.start) / 1000) * effPps);
            const sel = h.id === selHeadlineId;
            return (
              <div
                key={h.id}
                data-block="1"
                title={h.text || 'headline sem texto'}
                className={
                  'group absolute top-[150px] h-[36px] cursor-grab overflow-hidden rounded-[7px] active:cursor-grabbing ' +
                  (sel ? 'z-10' : 'hover:brightness-[1.18]')
                }
                style={{
                  left,
                  width,
                  backgroundImage: sel
                    ? 'linear-gradient(180deg, rgba(34,211,238,0.72) 0%, rgba(34,211,238,0.4) 100%)'
                    : 'linear-gradient(180deg, rgba(34,211,238,0.4) 0%, rgba(34,211,238,0.16) 100%)',
                  border: sel ? '1px solid #22d3ee' : '1px solid rgba(34,211,238,0.5)',
                  boxShadow: sel
                    ? '0 0 0 1px rgba(34,211,238,0.9), 0 4px 18px -6px rgba(34,211,238,0.7)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.14)',
                }}
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.stopPropagation();
                  onDragStart();
                  onSelectHeadline(h.id);
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const off = e.clientX - rect.left;
                  const mode: 'move' | 'trim-start' | 'trim-end' =
                    width > 26 && off < 9
                      ? 'trim-start'
                      : width > 26 && off > rect.width - 9
                        ? 'trim-end'
                        : 'move';
                  hlDragRef.current = { id: h.id, mode, grabMs: (off / effPps) * 1000, start: h.start, end: h.end };
                }}
                onPointerMove={(e) => {
                  const d = hlDragRef.current;
                  if (!d || d.id !== h.id) return;
                  const sc = scrollRef.current;
                  if (!sc) return;
                  const xPx = e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft;
                  const tMs = Math.max(0, (xPx / effPps) * 1000);
                  const MIN = 200;
                  if (d.mode === 'move') {
                    const dur = d.end - d.start;
                    const ini = Math.max(0, Math.min(tMs - d.grabMs, duration * 1000 - dur));
                    onRetimeHeadline(h.id, Math.round(ini), Math.round(ini + dur));
                  } else if (d.mode === 'trim-start') {
                    onRetimeHeadline(h.id, Math.round(Math.min(tMs, d.end - MIN)), d.end);
                  } else {
                    onRetimeHeadline(h.id, d.start, Math.round(Math.max(tMs, d.start + MIN)));
                  }
                }}
                onPointerUp={(e) => {
                  hlDragRef.current = null;
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  hlDragRef.current = null;
                }}
              >
                <span className="pointer-events-none absolute inset-0 flex items-center truncate px-2 text-[11px] font-semibold text-white/90">
                  {h.text.replace(/\s+/g, ' ').trim() || 'headline'}
                </span>
                <span className="pointer-events-none absolute inset-y-0 left-0 w-[7px] bg-white/25 opacity-0 group-hover:opacity-100" />
                <span className="pointer-events-none absolute inset-y-0 right-0 w-[7px] bg-white/25 opacity-0 group-hover:opacity-100" />
              </div>
            );
          })}

          {/* playhead — a zona de pega (14px) reenvia o pointer pro track = scrub */}
          <div
            ref={playheadRef}
            className="pointer-events-none absolute top-0 z-20 h-full w-[2px]"
            style={{
              background: 'linear-gradient(180deg,#ff5f57 0%,#ef4444 100%)',
              boxShadow: '0 0 8px rgba(239,68,68,0.85)',
            }}
          >
            {/* cabeça arredondada, no lugar do triangulinho */}
            <div
              className="absolute -left-[6px] -top-[1px] h-[13px] w-[14px] rounded-[4px]"
              style={{
                background: 'linear-gradient(180deg,#ff7b74 0%,#e5342f 100%)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.55)',
              }}
            />
            <div
              className="pointer-events-auto absolute -left-[6px] top-0 h-full w-[14px] cursor-ew-resize"
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

// HSV ↔ hex (pro seletor de tom arrastável estilo CapCut)

/* ───────────────────── Corrigir legenda pela copy ───────────────────── */

function CopyFixPanel({
  onFix,
  disabled,
}: {
  onFix: (copyText: string) => { ok: boolean; msg: string };
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  return (
    <div
      className={
        'mt-5 overflow-hidden rounded-[16px] border transition-colors duration-200 ' +
        (open
          ? 'border-amber-400/40 bg-gradient-to-br from-amber-400/[0.06] via-bg-soft/40 to-bg-soft/20 shadow-[0_0_24px_-8px_rgba(255,159,10,0.25)]'
          : 'border-line bg-gradient-to-br from-bg-soft/55 via-bg-soft/35 to-transparent')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-amber-400/40 bg-amber-400/10 text-amber-400 shadow-[0_0_14px_rgba(255,159,10,0.18)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5L14 2.5z" />
              <path d="M14 2.5v5h5" />
              <path d="m8.8 14.6 2.1 2.1 4.3-4.3" />
            </svg>
          </div>
          <div className="min-w-0">
            <div
              className="text-[11px] font-bold uppercase tracking-[0.18em] text-text"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Corrigir legenda pela copy
            </div>
            <p className="mt-0.5 max-w-[520px] text-[11px] leading-relaxed text-text-muted">
              Cola o texto da copy e a legenda inteira é corrigida por ela — só
              palavras erradas e pontuação. Blocos, tempos e separação ficam
              exatamente como foram gerados.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          className={
            'shrink-0 rounded-[11px] border px-4 py-2.5 text-[11.5px] font-bold ' +
            (open
              ? 'bg-bg-soft border-line text-text-muted hover:text-text' + T3D
              : 'border-amber-400/70 bg-gradient-to-b from-amber-400/25 to-amber-400/10 text-amber-600 dark:text-amber-500 hover:from-amber-400/35 hover:to-amber-400/15' + T3D_GLOW)
          }
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {open ? 'Fechar' : 'Colar copy'}
        </button>
      </div>
      {open ? (
        <div className="border-t border-line/60 bg-black/10 p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Cola aqui o texto exato da copy narrada no vídeo..."
            rows={5}
            disabled={disabled}
            className="w-full rounded-[12px] border border-line bg-black/25 px-3.5 py-3 text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-400/60 focus:shadow-[0_0_0_3px_rgba(255,159,10,0.08)]"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setFeedback(onFix(text))}
              disabled={disabled || text.trim().length < 20}
              className={
                'rounded-[11px] border border-amber-400/70 bg-gradient-to-b from-amber-400/30 to-amber-400/15 px-5 py-2.5 text-[12px] font-bold text-amber-600 dark:text-amber-500 hover:from-amber-400/40 hover:to-amber-400/20 disabled:opacity-40' +
                T3D_GLOW
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Corrigir pela copy →
            </button>
            {feedback ? (
              <span
                className={
                  'rounded-[10px] border px-3 py-1.5 text-[11px] font-semibold ' +
                  (feedback.ok
                    ? 'border-lime/40 bg-lime/10 text-lime'
                    : 'border-red-500/40 bg-red-500/10 text-red-400')
                }
              >
                {feedback.msg}
              </span>
            ) : null}
          </div>
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
  onCommit,
  applyAll,
  setApplyAll,
  editingLabel,
  autoEmph,
  setAutoEmph,
  pace,
  regroup,
  regroupInfo,
  defaultPrimary,
  defaultAccent,
  autoFit,
  singleLine,
  fx,
  bgMode,
  bgColor,
  bgOpacity,
  animIn,
  animOut,
  presetInKind,
  presetOutKind,
  previewPreset,
  unsupportedIn,
  sel,
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
  /** grava um passo no historico antes de mexer (Ctrl+Z) */
  onCommit: () => void;
  applyAll: boolean;
  setApplyAll: (v: boolean) => void;
  editingLabel: string | null;
  autoEmph: boolean;
  setAutoEmph: (v: boolean) => void;
  pace: GroupPace;
  regroup: (p: GroupPace) => void;
  /** recado do último reagrupamento (quantos travados sobreviveram) */
  regroupInfo: string | null;
  defaultPrimary: string;
  defaultAccent: string;
  autoFit: boolean;
  singleLine: boolean;
  /** efeitos ligaveis (traco/sombra/brilho/fumaca) */
  fx: FxState;
  bgMode: 'preset' | 'on' | 'off';
  bgColor: string | null;
  bgOpacity: number;
  animIn: AnimKind | null;
  animOut: OutKind | null;
  presetInKind: AnimKind;
  presetOutKind: OutKind;
  /** modelo EFETIVO do bloco em edição — a demo dos menus de animação usa ele */
  previewPreset: TypoPreset;
  /** entradas que ESTE modelo não executa (o engine ignoraria em silêncio) */
  unsupportedIn: AnimKind[];
  /** seleção PARCIAL ativa: os controles de texto agem só nas palavras marcadas */
  sel: {
    count: number;
    cur: WordStyle;
    set: (patch: WordStyle) => void;
    clear: () => void;
    reset: () => void;
  } | null;
  disabled?: boolean;
}) {
  // com seleção parcial, os controles de TEXTO mostram e gravam o trecho
  const selBold = sel ? (sel.cur.bold ?? bold) : bold;
  const selItalic = sel ? (sel.cur.italic ?? italic) : italic;
  const selUnderline = sel ? (sel.cur.underline ?? underline) : underline;
  const selCase = sel ? (sel.cur.wcase ?? textCase) : textCase;
  const caseBtn = (mode: 'upper' | 'lower' | 'original', label: string, title: string) => (
    <button
      key={mode}
      onClick={() =>
        sel
          ? sel.set({ wcase: selCase === mode ? null : mode })
          : onSet({ textCase: textCase === mode ? null : mode })
      }
      disabled={disabled}
      title={title}
      className={
        'flex h-8 min-w-[38px] items-center justify-center rounded-[9px] border bg-bg-soft px-2 text-[13px] font-bold' + T3D + ' ' +
        (selCase === mode
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

      {sel ? (
        <div className="md:col-span-2 flex flex-wrap items-center gap-2.5 rounded-[10px] border-2 border-blue-500/60 bg-blue-500/10 px-3 py-2">
          <span className="text-[11.5px] font-bold text-blue-600">
            ✂ {sel.count} palavra{sel.count > 1 ? 's' : ''} selecionada
            {sel.count > 1 ? 's' : ''} — Tamanho, cor do Texto, B/U/I, Caixa e
            Fonte agem SÓ nelas
          </span>
          <button
            onClick={sel.clear}
            className={
              'rounded-[8px] border border-blue-500/60 bg-blue-500/15 px-2.5 py-1 text-[10.5px] font-bold text-blue-600 hover:bg-blue-500/25' +
              T3D
            }
          >
            concluir seleção
          </button>
          <button
            onClick={sel.reset}
            className={
              'rounded-[8px] border border-line bg-bg-soft px-2.5 py-1 text-[10.5px] font-semibold text-text-muted hover:text-text' +
              T3D
            }
          >
            remover estilos do trecho
          </button>
        </div>
      ) : null}

      <ToolSlider
        label={sel ? 'Tamanho da seleção' : 'Tamanho'}
        min={0.3}
        max={4}
        step={0.05}
        value={sel ? (sel.cur.scale ?? 1) : fontScale}
        onChange={(v) => (sel ? sel.set({ scale: v }) : onSlide({ fontScale: v }))}
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
            label={sel ? 'Texto (seleção)' : 'Texto'}
            value={sel ? (sel.cur.color ?? primary) : primary}
            fallback={defaultPrimary}
            onPick={(v) => (sel ? sel.set({ color: v }) : onSet({ primary: v }))}
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
            onClick={() => (sel ? sel.set({ bold: !selBold }) : onSet({ bold: !bold }))}
            disabled={disabled}
            title="Negrito"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border bg-bg-soft text-[14px] font-black' + T3D + ' ' +
              (selBold
                ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
          >
            B
          </button>
          <button
            onClick={() =>
              sel ? sel.set({ underline: !selUnderline }) : onSet({ underline: !underline })
            }
            disabled={disabled}
            title="Sublinhado"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border bg-bg-soft text-[14px] font-bold underline' + T3D + ' ' +
              (selUnderline
                ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
          >
            U
          </button>
          <button
            onClick={() => (sel ? sel.set({ italic: !selItalic }) : onSet({ italic: !italic }))}
            disabled={disabled}
            title="Itálico"
            className={
              'flex h-8 w-9 items-center justify-center rounded-[9px] border bg-bg-soft text-[14px] font-bold italic' + T3D + ' ' +
              (selItalic
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
          title="Liga, desliga e ajusta cada efeito — inclusive nos modelos que não trazem o efeito de fábrica"
        >
          Efeitos da legenda
        </div>
        <FxPanel
          preset={previewPreset}
          fx={fx}
          onFx={(patch) => onSet({ fx: { ...fx, ...patch } })}
          fxStroke={fxStroke}
          fxShadow={fxShadow}
          fxGlow={fxGlow}
          fxSmoke={fxSmoke}
          onMultiplier={(patch) => onSlide(patch)}
          onCommit={onCommit}
          defaultPrimary={defaultPrimary}
          disabled={disabled}
        />
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
          title="“Do modelo” usa a animação que o lettering já traz · “Sem animação” faz a legenda aparecer/sumir seca — passa o mouse nas opções pra VER cada uma"
        >
          Animação da legenda
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AnimPicker
            label="Entrada"
            mode="in"
            value={animIn}
            options={IN_ANIM_OPTIONS}
            presetKind={presetInKind}
            unsupported={unsupportedIn}
            previewPreset={previewPreset}
            onPick={(k) => onSet({ animIn: k })}
            disabled={disabled}
          />
          <AnimPicker
            label="Saída"
            mode="out"
            value={animOut}
            options={OUT_ANIM_OPTIONS}
            presetKind={presetOutKind}
            previewPreset={previewPreset}
            onPick={(k) => onSet({ animOut: k })}
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
          title="Ligado: re-organiza as linhas e nunca sai da tela · Livre: quebras congeladas e o texto cresce sem limite"
        >
          Ajuste automático
        </div>
        <div className="flex items-center gap-2">
          {(
            [
              [true, 'Ligado'],
              [false, 'Livre'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={label}
              onClick={() => onSet({ autoFit: v })}
              disabled={disabled}
              className={
                'rounded-[9px] border bg-bg-soft px-3 py-1.5 text-[11px] font-bold' + T3D + ' ' +
                (autoFit === v
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-line text-text-muted hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="mb-1.5 mt-3 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
          title="Ligada: o bloco nunca desce pra uma segunda linha — encolhe pra caber e a frase seguinte entra no PRÓXIMO bloco"
        >
          Linha única
        </div>
        <div className="flex items-center gap-2">
          {(
            [
              [true, 'Ligada'],
              [false, 'Desligada'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={label}
              onClick={() => onSet({ singleLine: v })}
              disabled={disabled}
              title="Ligada: o bloco nunca desce pra uma segunda linha — encolhe pra caber e a frase seguinte entra no PRÓXIMO bloco"
              className={
                'rounded-[9px] border bg-bg-soft px-3 py-1.5 text-[11px] font-bold' + T3D + ' ' +
                (singleLine === v
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-line text-text-muted hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Fundo
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['preset', 'Do modelo'],
              ['on', 'Ligado'],
              ['off', 'Desligado'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => onSet({ bgMode: v })}
              disabled={disabled}
              className={
                'rounded-[9px] border bg-bg-soft px-3 py-1.5 text-[11px] font-bold' + T3D + ' ' +
                (bgMode === v
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-line text-text-muted hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </button>
          ))}
          {bgMode !== 'off' ? (
            <ColorDot
              label="Cor"
              value={bgColor}
              fallback="#111111"
              onPick={(v) => onSet({ bgColor: v })}
              disabled={disabled}
            />
          ) : null}
        </div>
        {bgMode !== 'off' ? (
          <div className="mt-2">
            <ToolSlider
              label="Opacidade do fundo"
              min={0.1}
              max={1}
              step={0.05}
              value={bgOpacity}
              onChange={(v) => onSlide({ bgOpacity: v })}
              display={(v) => `${Math.round(v * 100)}%`}
              disabled={disabled}
            />
          </div>
        ) : null}
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
          title="A palavra forte de cada bloco ganha o tratamento do modelo sozinha"
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
                'rounded-[9px] border bg-bg-soft px-3 py-1.5 text-[11px] font-bold' + T3D + ' ' +
                (autoEmph === v
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-line text-text-muted hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="md:col-span-2">
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
          title="Remonta os blocos a partir da transcrição SEM encostar nos travados (cadeado). Blocos livres perdem edição de texto feita na lista (Ctrl+Z desfaz)"
        >
          Ritmo dos blocos
        </div>
        <ToolChoice
          value={pace}
          onChange={regroup}
          disabled={disabled}
          hue={HUE}
          options={[
            { value: 'palavra', label: 'Palavra', sub: '1 por vez' },
            { value: 'rapido', label: 'Rápido', sub: '1-3 palavras' },
            { value: 'equilibrado', label: 'Equilibrado', sub: '3-5 palavras' },
            { value: 'frases', label: 'Frases', sub: 'blocos longos' },
          ]}
        />
        {regroupInfo ? (
          <div className="mt-2 rounded-[10px] border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-[11px] text-violet-300">
            {regroupInfo}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────── Seletor de animação (entrada/saída) ─────────────────── */

function AnimPicker<K extends string>({
  label,
  mode,
  value,
  options,
  presetKind,
  unsupported,
  previewPreset,
  onPick,
  disabled,
}: {
  label: string;
  /** entrada ou saída — muda o que a demo do menu mostra */
  mode: 'in' | 'out';
  value: K | null;
  options: Array<{ kind: K; label: string }>;
  /** kind que o modelo atual já traz — vira o rótulo do "Do modelo" */
  presetKind: K;
  /** kinds que ESTE modelo não executa — ficam visíveis, porém travados */
  unsupported?: K[];
  /** modelo usado na DEMO ao vivo (passa o mouse na opção pra ver) */
  previewPreset: TypoPreset;
  onPick: (v: K | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // menu por PORTAL (components/Popover): o card do passo tem overflow-hidden
  // E ganha transform no hover — os dois cortam/deslocam popover ancorado
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const labelOf = (k: K) => options.find((o) => o.kind === k)?.label ?? k;
  const isCustom = value !== null;
  const blocked = new Set(unsupported ?? []);
  // demo ao vivo: a opção sob o mouse (ou a escolhida) roda em loop no canvas
  const [hoverKind, setHoverKind] = useState<K | null>(null);
  const demoKind = hoverKind ?? value ?? presetKind;
  return (
    <div className="min-w-0">
      <div
        className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {label}
      </div>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={
          'flex w-full items-center justify-between gap-3 rounded-[12px] border px-3.5 py-2.5 text-[12.5px] font-semibold' + T3D + ' ' +
          (isCustom
            ? 'border-amber-400/60 bg-amber-400/10 text-amber-600'
            : 'bg-bg-soft border-line text-text hover:border-amber-400/50')
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isCustom ? 'text-amber-400' : 'text-text-muted'}
            aria-hidden
          >
            <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />
          </svg>
          <span className="truncate">
            {value === null ? `Do modelo · ${labelOf(presetKind)}` : labelOf(value)}
          </span>
          {isCustom && blocked.has(value) ? (
            <span
              className="mono shrink-0 rounded-[6px] border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-text-muted"
              title="Este modelo não executa a animação escolhida — ele usa a dele"
            >
              n/d
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-text-muted">▾</span>
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={closeMenu} width={272}>
        <div className="overflow-hidden rounded-[14px] border border-line-strong bg-bg-elev shadow-2xl">
          {open ? (
            <AnimDemo mode={mode} kind={demoKind} preset={previewPreset} label={labelOf(demoKind)} />
          ) : null}
          <button
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            onMouseEnter={() => setHoverKind(presetKind)}
            onMouseLeave={() => setHoverKind(null)}
            className={
              'flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left text-[12.5px] font-bold transition-colors ' +
              (value === null
                ? 'bg-amber-400/15 text-amber-600'
                : 'text-text hover:bg-black/5')
            }
          >
            ✨ Do modelo ({labelOf(presetKind)})
          </button>
          <div className="max-h-[236px] overflow-y-auto py-1">
            {options.map((o) => {
              const off = blocked.has(o.kind);
              return (
                <button
                  key={o.kind}
                  onClick={() => {
                    if (off) return;
                    onPick(o.kind);
                    setOpen(false);
                  }}
                  disabled={off}
                  onMouseEnter={() => {
                    if (!off) setHoverKind(o.kind);
                  }}
                  onMouseLeave={() => setHoverKind(null)}
                  title={off ? 'Este modelo não executa esta animação' : undefined}
                  className={
                    'flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[12.5px] font-semibold transition-colors ' +
                    (off
                      ? 'cursor-not-allowed text-text-muted/45'
                      : value === o.kind
                        ? 'bg-amber-400/15 text-amber-600'
                        : 'text-text-muted hover:bg-black/5 hover:text-text')
                  }
                >
                  <span className={off ? 'line-through decoration-1' : undefined}>{o.label}</span>
                  {off ? (
                    <span className="mono shrink-0 text-[9.5px] uppercase tracking-wider opacity-60">
                      n/d neste modelo
                    </span>
                  ) : o.kind === presetKind ? (
                    <span className="mono shrink-0 text-[9.5px] uppercase tracking-wider opacity-50">
                      do modelo
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}

/**
 * DEMO ao vivo do menu de animação: roda em loop a opção sob o mouse com o
 * MESMO drawCaptions do preview/export — ver a animação, não ler o nome.
 * Entrada: o bloco nasce no começo do loop. Saída: o bloco morre antes do fim
 * do loop, então a animação de saída é o que aparece.
 */
function AnimDemo({
  mode,
  kind,
  preset,
  label,
}: {
  mode: 'in' | 'out';
  kind: string;
  preset: TypoPreset;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const liveDemo = useRef({ mode, kind, preset });
  liveDemo.current = { mode, kind, preset };
  // reinicia o loop quando troca a opção (a animação recomeça do zero)
  const t0Ref = useRef(performance.now());
  useEffect(() => {
    t0Ref.current = performance.now();
  }, [kind, mode]);

  useEffect(() => {
    void ensureTypoFonts();
    const tick = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const { mode: m, kind: k, preset: p } = liveDemo.current;
        const LOOP = 2100;
        // saída: o bloco acaba aos 1400ms e o resto do loop é respiro — a
        // animação de saída roda ali; entrada: o bloco vive o loop inteiro
        const end = m === 'out' ? 1400 : LOOP - 250;
        const bloco: Block = {
          id: 'animdemo',
          words: [
            { text: 'Sua', start: 0, end: 300 },
            { text: 'legenda', start: 300, end: 650 },
            { text: 'aqui', start: 650, end: 950 },
          ],
          start: 0,
          end,
        };
        const st: StyleState = {
          presetId: p.id,
          fontScale: 1,
          posY: 0.55,
          posX: 0.5,
          primary: null,
          accent: null,
          uppercase: null,
          highlights: {},
          autoEmphasis: true,
          animIn: m === 'in' ? (k as AnimKind) : null,
          animOut: m === 'out' ? (k as OutKind) : null,
        };
        ctx.clearRect(0, 0, c.width, c.height);
        const t = (performance.now() - t0Ref.current) % LOOP;
        drawCaptions(ctx, [bloco], p, st, t, c.width, c.height);
      }
    };
    return registerCanvasJob(tick, { fps: 24, el: ref.current });
  }, []);

  return (
    <div className="relative border-b border-line">
      <canvas
        ref={ref}
        width={520}
        height={200}
        className="block w-full"
        style={{
          aspectRatio: '520 / 200',
          background: 'linear-gradient(150deg, #17181d 0%, #101116 55%, #191a20 100%)',
        }}
      />
      <span className="mono pointer-events-none absolute bottom-1.5 right-2 rounded-[6px] bg-black/55 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/75">
        {label}
      </span>
    </div>
  );
}

/* ───────────────────────── Lista de blocos ───────────────────────── */

function BlockList({
  blocks,
  selId,
  activeId,
  highlights,
  locked,
  onSelect,
  onEditText,
  onSplit,
  onMerge,
  onDelete,
  onNudge,
  onToggleWord,
  onToggleLock,
  disabled,
}: {
  blocks: Block[];
  selId: string | null;
  activeId: string | null;
  highlights: Record<string, number[]>;
  locked: string[];
  onSelect: (b: Block) => void;
  onEditText: (id: string, text: string) => void;
  onSplit: (id: string) => void;
  onMerge: (id: string) => void;
  onDelete: (id: string) => void;
  onNudge: (id: string, edge: 'start' | 'end', delta: number) => void;
  onToggleWord: (id: string, wordIdx: number) => void;
  onToggleLock: (id: string) => void;
  disabled?: boolean;
}) {
  const lockedSet = new Set(locked);
  return (
    <div className="mt-5">
      <div
        className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span>Blocos de legenda — {blocks.length}</span>
        <span className="flex items-center gap-1.5 normal-case tracking-normal font-normal">
          clica na palavra pra pintar de destaque ·
          <span className="inline-flex items-center text-violet-400">
            <IconPadlock locked size={11} />
          </span>
          congela o bloco: nem o “aplicar a todas”, nem trocar o ritmo, nem
          dividir ou juntar mexem no visual dele
        </span>
      </div>
      <div className="max-h-[280px] overflow-y-auto rounded-[14px] border border-line">
        {blocks.map((b, i) => {
          const sel = b.id === selId;
          const isActive = b.id === activeId;
          const hl = new Set(highlights[b.id] ?? []);
          const isLocked = lockedSet.has(b.id);
          return (
            <div
              key={b.id}
              className={
                'border-b border-line/60 px-3 py-2 transition-colors last:border-b-0 ' +
                (sel
                  ? 'bg-amber-400/[0.07]'
                  : isActive
                    ? 'bg-lime/[0.05]'
                    : isLocked
                      ? 'bg-violet-500/[0.04]'
                      : 'hover:bg-white/[0.02]') +
                (isLocked ? ' shadow-[inset_2.5px_0_0_rgba(167,139,250,0.55)]' : '')
              }
              style={{ contentVisibility: 'auto' } as CSSProperties}
            >
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => onSelect(b)}
                  className={
                    'mono shrink-0 rounded-full border bg-bg-soft px-2.5 py-1 text-[10.5px]' + T3D + ' ' +
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
                  <button
                    type="button"
                    onClick={() => onToggleLock(b.id)}
                    title={
                      isLocked
                        ? 'Desbloquear: volta a receber o "aplicar a todas" (e devolve o ajuste que este bloco tinha antes do cadeado)'
                        : 'Bloquear: congela o visual atual. Nem o "aplicar a todas", nem trocar o ritmo, nem dividir/juntar mexem mais neste bloco'
                    }
                    disabled={disabled}
                    className={
                      'flex h-8 w-8 items-center justify-center rounded-[9px] border disabled:opacity-30 ' +
                      (isLocked
                        ? 'border-violet-400/80 bg-violet-500/20 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.5),inset_0_0_10px_rgba(167,139,250,0.14),0_2px_0_rgba(0,0,0,0.16)] transition-all duration-150 hover:bg-violet-500/30'
                        : 'bg-bg-soft border-line text-text-muted hover:border-violet-400/60 hover:text-violet-300' + T3D)
                    }
                  >
                    <IconPadlock locked={isLocked} />
                  </button>
                  <RowBtn title="Dividir bloco" onClick={() => onSplit(b.id)} disabled={disabled || b.words.length < 2}>
                    <IconScissors />
                  </RowBtn>
                  <RowBtn title="Juntar com o próximo" onClick={() => onMerge(b.id)} disabled={disabled || i === blocks.length - 1}>
                    <IconMergeDown />
                  </RowBtn>
                  <RowBtn title="Excluir bloco" onClick={() => onDelete(b.id)} disabled={disabled} danger>
                    <IconClose />
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
        'flex h-8 w-8 items-center justify-center rounded-[9px] border bg-bg-soft text-[13px] disabled:opacity-30' + T3D + ' ' +
        (danger
          ? 'border-line text-text-muted hover:border-red-500/50 hover:text-red-300'
          : 'border-line text-text-muted hover:border-amber-400/50 hover:text-amber-200')
      }
    >
      {children}
    </button>
  );
}

/* ─── ícones DIGITAIS dos botões de bloco (stroke herda a cor do botão) ─── */

function IconPadlock({ locked, size = 14 }: { locked: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="10"
        rx="2.6"
        fill={locked ? 'currentColor' : 'none'}
        fillOpacity={locked ? 0.18 : 0}
      />
      {locked ? (
        <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" />
      ) : (
        // aberto: a haste levanta e solta do corpo
        <path d="M8 10.5V6.9a4 4 0 0 1 7.8-1.2" />
      )}
      <path d="M12 14.4v2.4" />
    </svg>
  );
}

function IconScissors() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="2.7" />
      <circle cx="6" cy="18" r="2.7" />
      <path d="M8.2 7.7 20 19.2M8.2 16.3 20 4.8" />
    </svg>
  );
}

function IconMergeDown() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v10.8" />
      <path d="m7.6 10 4.4 4.3L16.4 10" />
      <path d="M5 20.5h14" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </svg>
  );
}

/**
 * ⚡ Versões memorizadas dos blocos PESADOS da página. Mexer num slider ou
 * arrastar a legenda muda estado global — sem memo, a galeria (centenas de
 * canvases), a timeline (thumbs) e a lista de blocos re-renderizavam a CADA
 * tick. Todos os handlers passados a eles são useEvent (identidade estável).
 */
const PresetGalleryM = memo(PresetGallery);
const TimelineM = memo(Timeline);
const BlockListM = memo(BlockList);
