'use client';

import {
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
import { createClient } from '@/lib/supabase/client';
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
  drawPresetDemo,
  captionBBoxAt,
  wordBoxesAt,
  DEFAULT_STYLE,
  IN_ANIM_OPTIONS,
  OUT_ANIM_OPTIONS,
  unsupportedInKinds,
  type AnimKind,
  type OutKind,
  type Block,
  type StyleState,
  type PerBlockStyle,
  type WordStyle,
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

// idiomas do Whisper (Groq) — os mais usados primeiro, resto alfabético
const LANGS: Array<{ code: string; label: string }> = [
  { code: 'pt-br', label: 'Português (Brasil)' },
  { code: 'pt', label: 'Português (Portugal)' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'pl', label: 'Polonês' },
  { code: 'cs', label: 'Tcheco' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ar', label: 'Árabe' },
  { code: 'bg', label: 'Búlgaro' },
  { code: 'zh', label: 'Chinês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'hr', label: 'Croata' },
  { code: 'da', label: 'Dinamarquês' },
  { code: 'sk', label: 'Eslovaco' },
  { code: 'sl', label: 'Esloveno' },
  { code: 'fi', label: 'Finlandês' },
  { code: 'el', label: 'Grego' },
  { code: 'he', label: 'Hebraico' },
  { code: 'hi', label: 'Hindi' },
  { code: 'nl', label: 'Holandês' },
  { code: 'hu', label: 'Húngaro' },
  { code: 'id', label: 'Indonésio' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ms', label: 'Malaio' },
  { code: 'no', label: 'Norueguês' },
  { code: 'ro', label: 'Romeno' },
  { code: 'ru', label: 'Russo' },
  { code: 'sr', label: 'Sérvio' },
  { code: 'sv', label: 'Sueco' },
  { code: 'th', label: 'Tailandês' },
  { code: 'tl', label: 'Tagalo (Filipinas)' },
  { code: 'tr', label: 'Turco' },
  { code: 'uk', label: 'Ucraniano' },
  { code: 'ur', label: 'Urdu' },
  { code: 'vi', label: 'Vietnamita' },
];

function langLabel(code: Language): string {
  if (code === 'auto') return 'Identificar automaticamente';
  return LANGS.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

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
  bgMode?: 'preset' | 'on' | 'off';
  bgColor?: string | null;
  bgOpacity?: number;
  animIn?: AnimKind | null;
  animOut?: OutKind | null;
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
  const [language, setLanguage] = useToolState<Language>('tipografia:lang', 'auto');
  const [highlights, setHighlights] = useToolState<Record<string, number[]>>(
    'tipografia:hl',
    {},
  );
  const [autoEmph, setAutoEmph] = useToolState<boolean>('tipografia:autoemph', true);
  const [fontOv, setFontOv] = useToolState<FontKey | null>('tipografia:fontov', null);
  const [posX, setPosX] = useToolState<number>('tipografia:posx', 0.5);
  const [autoFitG, setAutoFitG] = useToolState<boolean>('tipografia:autofit', true);
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
  // ⭐ favoritos POR CONTA: a verdade mora no banco (user_tool_prefs, RLS);
  // localStorage é cache instantâneo + fallback enquanto a migração 031 não
  // roda / sem internet
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem('tipografia:favs');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setFavs(arr.filter((x) => typeof x === 'string'));
      }
    } catch {
      /* sem cache local */
    }
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid || cancelled) return;
        const { data, error } = await supabase
          .from('user_tool_prefs')
          .select('tipografia_favs')
          .eq('user_id', uid)
          .maybeSingle();
        if (error || cancelled) return; // tabela ainda não migrada → local segura
        if (data && Array.isArray(data.tipografia_favs)) {
          const server = (data.tipografia_favs as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          );
          setFavs(server);
          try {
            localStorage.setItem('tipografia:favs', JSON.stringify(server));
          } catch {
            /* cache local é best-effort */
          }
        }
      } catch {
        /* offline — o cache local vale */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem('tipografia:favs', JSON.stringify(next));
      } catch {
        /* storage cheio — segue só em memória */
      }
      void (async () => {
        try {
          const supabase = createClient();
          const { data: u } = await supabase.auth.getUser();
          const uid = u.user?.id;
          if (!uid) return;
          await supabase.from('user_tool_prefs').upsert({
            user_id: uid,
            tipografia_favs: next,
            updated_at: new Date().toISOString(),
          });
        } catch {
          /* servidor indisponível — localStorage segurou */
        }
      })();
      return next;
    });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
      bgMode: bgModeG,
      bgColor: bgColorG,
      bgOpacity: bgOpacityG,
      animIn: animInG,
      animOut: animOutG,
      wordStyles,
      perBlock: blockStyles,
    }),
    [presetId, fontScale, posY, primary, accent, textCase, bold, italic, underlineG, fxStrokeG, fxShadowG, fxGlowG, fxSmokeG, highlights, autoEmph, fontOv, posX, autoFitG, bgModeG, bgColorG, bgOpacityG, animInG, animOutG, wordStyles, blockStyles],
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
    [editingBlockId, setFontScale, setPrimary, setAccent, setPosX, setPosY, setTextCase, setBold, setItalic, setUnderlineG, setFxStrokeG, setFxShadowG, setFxGlowG, setFxSmokeG, setFontOv, setAutoFitG, setBgModeG, setBgColorG, setBgOpacityG, setAnimInG, setAnimOutG, setBlockStyles],
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
        setBlockStyles((prev) => {
          if (!prev[blockId]) return prev;
          const { [blockId]: _descartado, ...resto } = prev;
          return resto;
        });
        return;
      }
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
    [pushHistory, lockedBlocks, setLockedBlocks, setBlockStyles, presetId, fontScale, primary, accent, posX, posY, textCase, bold, italic, underlineG, fontOv, fxStrokeG, fxShadowG, fxGlowG, fxSmokeG, autoFitG, bgModeG, bgColorG, bgOpacityG, animInG, animOutG],
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
          setBlockStyles(styles);
        }
        setWordStyles(saved.wordStyles ?? {});
        setLockedBlocks(saved.lockedBlocks ?? []);
        setAutoFitG(saved.autoFit ?? true);
        setBgModeG(saved.bgMode ?? 'preset');
        setBgColorG(saved.bgColor ?? null);
        setBgOpacityG(saved.bgOpacity ?? 1);
        setAnimInG(saved.animIn ?? null);
        setAnimOutG(saved.animOut ?? null);
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
      wordStyles,
      lockedBlocks,
      autoFit: autoFitG,
      bgMode: bgModeG,
      bgColor: bgColorG,
      bgOpacity: bgOpacityG,
      animIn: animInG,
      animOut: animOutG,
    });
  }, [file, phase, words, blocks, presetId, fontScale, posY, primary, accent, pace, language, highlights, autoEmph, fontOv, posX, textCase, bold, italic, blockStyles, wordStyles, lockedBlocks, autoFitG, bgModeG, bgColorG, bgOpacityG, animInG, animOutG]);

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
      setWordStyles({});
      setLockedBlocks([]);
      setBlockStyles({});
      setWordSel(null);
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
        // texto mudou de tamanho → os índices dos estilos por palavra já eram
        setWordStyles((prev) => {
          if (!prev[b.id]) return prev;
          const next = { ...prev };
          delete next[b.id];
          return next;
        });
        setWordSel((w) => (w && w.blockId === b.id ? null : w));
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
      // ids de bloco novos → estilos por palavra/bloqueios antigos não apontam
      // mais pra nada (mesma regra já avisada na UI pro texto editado)
      setWordStyles({});
      setLockedBlocks([]);
      setBlockStyles({});
      setWordSel(null);
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
        title="Legendas Automáticas"
        eyebrow="Legendas animadas"
        subtitle="Sobe o vídeo e a fala vira legenda animada profissional, no tempo exato do áudio — escolhe o modelo, edita direto no preview e baixa com a legenda queimada."
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
                <PresetGallery
                  presetId={presetId}
                  onPick={(id) => {
                    pushHistory();
                    setPresetId(id);
                  }}
                  favs={favs}
                  onToggleFav={toggleFav}
                  disabled={processing}
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
                  autoFit={effOf('autoFit', autoFitG) ?? true}
                  bgMode={effOf('bgMode', bgModeG) ?? 'preset'}
                  bgColor={effOf('bgColor', bgColorG) ?? null}
                  bgOpacity={effOf('bgOpacity', bgOpacityG) ?? 1}
                  animIn={effOf('animIn', animInG) ?? null}
                  animOut={effOf('animOut', animOutG) ?? null}
                  presetInKind={panelPreset.in.kind}
                  presetOutKind={panelPreset.out.kind}
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
              locked={lockedBlocks}
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
              onToggleLock={toggleLock}
              disabled={processing}
            />

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
  onWordSel: (sel: { blockId: string; a: number; b: number } | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
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
  const liveRef = useRef({ blocks, preset, style, fontScale, wordSel });
  liveRef.current = { blocks, preset, style, fontScale, wordSel };

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
          const { blocks: b0, preset: p, style: s, wordSel: wSel } = liveRef.current;
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
          dprRef.current = dpr;
          // bbox viva pro hit-test (clicar/arrastar/alça/duplo clique)
          bboxRef.current = captionBBoxAt(ctx, b, p, s, v.currentTime * 1000, W, H);
          // caixas por PALAVRA vivas (seleção parcial estilo CapCut)
          wordBoxesRef.current = selRef.current
            ? wordBoxesAt(ctx, b, p, s, v.currentTime * 1000, W, H)
            : null;
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
              wordAnchor: -1,
            };
            return;
          }
          // legenda JÁ selecionada + clique EM CIMA de uma palavra = seleção
          // parcial (arrasta pra marcar o trecho — estilo CapCut). Clicar no
          // respiro ao redor continua movendo a legenda.
          const wb = wordBoxesRef.current;
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
          if (!drag) {
            // hover: cursor certo em cada zona (alça = redimensionar, palavra
            // do bloco selecionado = texto, legenda = mover) — igual CapCut
            const rect0 = wrap.getBoundingClientRect();
            const dpr0 = dprRef.current;
            const hx = (e.clientX - rect0.left) * dpr0;
            const hy = (e.clientY - rect0.top) * dpr0;
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
            const wbW = wordBoxesRef.current;
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
            const bb = bboxRef.current;
            if (!bb) return;
            const dpr = dprRef.current;
            const px = (e.clientX - rect.left) * dpr;
            const py = (e.clientY - rect.top) * dpr;
            const dist = Math.hypot(px - (bb.x + bb.w / 2), py - (bb.y + bb.h / 2));
            onFontScale(
              Math.min(4, Math.max(0.3, drag.scale0 * (dist / drag.dist0))),
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
          if (!drag || drag.mode === 'wordsel' || drag.moved) return;
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
          onWordSel(null);
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

const FAV_CAT = '⭐ Favoritos';

function PresetGallery({
  presetId,
  onPick,
  favs,
  onToggleFav,
  disabled,
}: {
  presetId: string;
  onPick: (id: string) => void;
  favs: string[];
  onToggleFav: (id: string) => void;
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
  const favSet = useMemo(() => new Set(favs), [favs]);
  const list = useMemo(
    () =>
      cat === FAV_CAT
        ? TYPO_PRESETS.filter((p) => favSet.has(p.id))
        : TYPO_PRESETS.filter((p) => p.cat === cat),
    [cat, favSet],
  );

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
        // TODA demo mostra "SUA LEGENDA AQUI" (lineAccent quebra em 2 linhas
        // sozinho pro efeito de linha colorida aparecer)
        drawPresetDemo(ctx, preset, now, c.width, c.height);
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
        <button
          onClick={() => setCat(FAV_CAT)}
          className={
            'rounded-full border px-3 py-1 text-[11px] font-bold transition-colors' +
            T3D +
            ' ' +
            (cat === FAV_CAT
              ? 'border-violet/70 bg-violet/20 text-violet'
              : 'border-violet/35 bg-violet/5 text-violet/80 hover:border-violet/60 hover:text-violet')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
          title="Seus modelos favoritos (estrela roxa nos cards)"
        >
          ⭐ Favoritos
          <span className="ml-1 opacity-70">{favs.length}</span>
        </button>
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
      {cat === FAV_CAT && list.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-violet/40 bg-violet/5 px-4 py-8 text-center text-[12.5px] text-text-muted">
          Nenhum favorito ainda — clica na <span className="text-violet">estrela roxa</span> de
          qualquer modelo pra ele aparecer aqui.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {list.map((preset) => {
          const active = preset.id === presetId;
          const isFav = favSet.has(preset.id);
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
                'group relative overflow-hidden rounded-[12px] border text-left transition-all duration-200 active:scale-[0.97] ' +
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
              {/* estrela roxa de favoritar (não seleciona o modelo) */}
              <span
                role="button"
                tabIndex={-1}
                title={isFav ? 'Tirar dos favoritos' : 'Favoritar'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFav(preset.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={
                  'absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200 hover:scale-110 ' +
                  (isFav
                    ? 'border-violet/70 bg-violet/25 opacity-100'
                    : 'border-white/20 bg-black/45 opacity-0 group-hover:opacity-100')
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={isFav ? '#a78bfa' : 'none'}
                  stroke={isFav ? '#a78bfa' : 'rgba(255,255,255,0.85)'}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z" />
                </svg>
              </span>
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span
                  className={
                    'text-[11px] font-bold ' + (active ? 'text-amber-200' : 'text-text-muted group-hover:text-text')
                  }
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {preset.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {isFav ? (
                    <span className="text-[10px] text-violet" aria-hidden>
                      ★
                    </span>
                  ) : null}
                  {active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
                  ) : null}
                </span>
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
        <span>Timeline — blocos movem · bordas cortam · agulha navega · scroll do mouse = zoom</span>
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
            height: 150,
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
                  'absolute top-[27px] h-[44px] cursor-grab overflow-hidden rounded-[8px] border-2 transition-shadow active:cursor-grabbing ' +
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
                {/* alças de corte — o cursor de corte (↔) avisa que ali corta */}
                <span className="absolute inset-y-0 left-0 w-[7px] cursor-col-resize rounded-l-[6px] bg-white/50" />
                <span className="absolute inset-y-0 right-0 w-[7px] cursor-col-resize rounded-r-[6px] bg-white/50" />
              </div>
            );
          })}

          {/* filmstrip (só visual — vídeo não é editável) */}
          {thumbs.length > 0 ? (
            <div
              className="pointer-events-none absolute left-0 top-[76px] flex h-[64px] overflow-hidden rounded-[8px] border border-line/60"
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

// HSV ↔ hex (pro seletor de tom arrastável estilo CapCut)
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

const SWATCHES = [
  '#ffffff', '#d9dbe0', '#8a8f99', '#3a3d45', '#0f0f10', '#000000',
  '#ffd60a', '#ffb300', '#ff9f0a', '#ff6b00', '#e8b04c', '#b8860b',
  '#ff2d55', '#e8192c', '#b00020', '#ff5db1', '#f472b6', '#ffb3c6',
  '#a78bfa', '#7c5cff', '#5b2fd6', '#c9bcf2', '#31c4ff', '#22d3ee',
  '#0aa2c0', '#bde0fe', '#2eff4f', '#2edb84', '#0f9d58', '#c8e87c',
  '#d4fc79', '#f5f0e1', '#ffdab9', '#8b5a2b', '#5c3a21', '#2b1d0e',
];

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

/* ───────────────────────── Seletor de idioma ───────────────────────── */

function LangPicker({
  value,
  onChange,
  disabled,
}: {
  value: Language;
  onChange: (v: Language) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // menu por PORTAL (components/Popover): o card do passo tem overflow-hidden
  // E ganha transform no hover — os dois cortam/deslocam popover ancorado
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const list = q.trim()
    ? LANGS.filter((l) => l.label.toLowerCase().includes(q.trim().toLowerCase()))
    : LANGS;
  return (
    <div className="inline-block">
      <div
        className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Idioma da fala
      </div>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={
          'flex min-w-[260px] items-center justify-between gap-3 rounded-[12px] border border-line bg-bg-soft px-3.5 py-2.5 text-[13px] font-semibold text-text hover:border-amber-400/50' +
          T3D
        }
      >
        <span className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-muted" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M3.5 12h17M12 3.2c2.6 2.4 3.9 5.4 3.9 8.8s-1.3 6.4-3.9 8.8c-2.6-2.4-3.9-5.4-3.9-8.8S9.4 5.6 12 3.2z" />
          </svg>
          {langLabel(value)}
        </span>
        <span className="text-text-muted">▾</span>
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={closeMenu} width={300}>
        <div className="overflow-hidden rounded-[14px] border border-line-strong bg-bg-elev shadow-2xl">
          <button
            onClick={() => {
              onChange('auto');
              setOpen(false);
            }}
            className={
              'flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left text-[12.5px] font-bold transition-colors ' +
              (value === 'auto'
                ? 'bg-amber-400/15 text-amber-600'
                : 'text-text hover:bg-black/5')
            }
          >
            ✨ Identificar automaticamente
          </button>
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar idioma..."
              className="w-full rounded-[9px] border border-line bg-bg px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-amber-400/50"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {list.map((l) => (
              <button
                key={l.code}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                  setQ('');
                }}
                className={
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-[12.5px] font-semibold transition-colors ' +
                  (value === l.code
                    ? 'bg-amber-400/15 text-amber-600'
                    : 'text-text-muted hover:bg-black/5 hover:text-text')
                }
              >
                {l.label}
                <span className="mono text-[10px] uppercase opacity-50">{l.code}</span>
              </button>
            ))}
            {list.length === 0 ? (
              <div className="px-3.5 py-3 text-[12px] text-text-muted">
                Nenhum idioma com esse nome.
              </div>
            ) : null}
          </div>
        </div>
      </Popover>
    </div>
  );
}

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
  // seletor de TOM arrastável (CapCut): quadrado saturação×brilho + barra de matiz
  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>({ h: 45, s: 1, v: 1 });
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  // gatilho + menu por PORTAL (o card do passo corta/desloca popover ancorado)
  const dotBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeDot = useCallback(() => setOpen(false), []);
  const openPicker = () => {
    if (!open) {
      const fromCur = hexToHsv(cur);
      if (fromCur) setHsv(fromCur);
    }
    setOpen((v) => !v);
  };
  const dragSv = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const next = { ...hsv, s, v };
    setHsv(next);
    onPick(hsvToHex(next.h, next.s, next.v));
  };
  const dragHue = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    const next = { ...hsv, h };
    setHsv(next);
    onPick(hsvToHex(next.h, next.s, next.v));
  };
  return (
    <div className="relative">
      <button
        ref={dotBtnRef}
        onClick={openPicker}
        disabled={disabled}
        className={
          'flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft px-2.5 py-1.5 hover:border-amber-400/50' +
          T3D
        }
      >
        <span
          className="h-5 w-5 rounded-[6px] border border-white/25 shadow-inner"
          style={{ background: cur }}
        />
        <span className="text-[11px] font-semibold text-text-muted">{label}</span>
      </button>
      <Popover open={open} anchorRef={dotBtnRef} onClose={closeDot} width={248}>
        <div className="rounded-[16px] border border-line-strong bg-bg-elev p-3 shadow-2xl">
          {/* topo: cor atual grande + hex + conta-gotas (só ícone) */}
          <div className="mb-2.5 flex items-center gap-2">
            <span
              className="h-8 w-8 shrink-0 rounded-[9px] border border-white/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.35)]"
              style={{ background: cur }}
            />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                const v = e.target.value.trim();
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                  onPick(v.startsWith('#') ? v : '#' + v);
                }
              }}
              placeholder={cur}
              className="mono w-full min-w-0 rounded-[8px] border border-line bg-black/25 px-2 py-1.5 text-[11px] text-text outline-none focus:border-amber-400/50"
            />
            {typeof window !== 'undefined' && 'EyeDropper' in window ? (
              <button
                title="Pegar cor da tela — clica em qualquer pixel do preview"
                onClick={async () => {
                  try {
                    const picker = new (
                      window as unknown as {
                        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
                      }
                    ).EyeDropper();
                    const r = await picker.open();
                    if (r?.sRGBHex) {
                      onPick(r.sRGBHex);
                      const fromPick = hexToHsv(r.sRGBHex);
                      if (fromPick) setHsv(fromPick);
                    }
                  } catch {
                    /* user cancelou o conta-gotas */
                  }
                }}
                className={
                  'flex h-8 w-9 shrink-0 items-center justify-center rounded-[9px] border border-line bg-bg-soft text-text hover:border-amber-400/60 hover:text-amber-400' +
                  T3D
                }
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="m2 22 1-1h3l9-9M3 21v-3l9-9m0 0 3.5-3.5M15 6l3 3m-3-3 2.3-2.3a2.4 2.4 0 0 1 3.4 3.4L18 9" />
                </svg>
              </button>
            ) : null}
          </div>

          {/* quadrado de TOM (saturação × brilho) — arrasta igual CapCut */}
          <div
            ref={svRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragSv(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) dragSv(e);
            }}
            className="relative h-[130px] w-full cursor-crosshair touch-none rounded-[10px] border border-white/15"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv.h, 1, 1)})`,
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.6)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: hsvToHex(hsv.h, hsv.s, hsv.v),
              }}
            />
          </div>
          {/* barra de matiz */}
          <div
            ref={hueRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragHue(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) dragHue(e);
            }}
            className="relative mt-2 h-[14px] w-full cursor-pointer touch-none rounded-full border border-white/15"
            style={{
              background:
                'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.6)]"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex(hsv.h, 1, 1) }}
            />
          </div>

          {/* paleta rápida */}
          <div className="mt-2.5 grid grid-cols-9 gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onPick(c);
                  const fromSw = hexToHsv(c);
                  if (fromSw) setHsv(fromSw);
                }}
                className={
                  'h-[19px] w-[19px] rounded-[5px] border transition-transform hover:scale-125 ' +
                  (cur.toLowerCase() === c ? 'border-amber-400' : 'border-white/15')
                }
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className={
                'w-full rounded-[8px] border border-line bg-bg-soft px-2 py-1.5 text-[10.5px] font-semibold text-text-muted hover:text-text' +
                T3D
              }
            >
              Padrão do modelo
            </button>
            <button
              onClick={() => setOpen(false)}
              className={
                'shrink-0 rounded-[8px] border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-[10.5px] font-bold text-amber-600' +
                T3D
              }
            >
              OK
            </button>
          </div>
        </div>
      </Popover>
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
  autoFit,
  bgMode,
  bgColor,
  bgOpacity,
  animIn,
  animOut,
  presetInKind,
  presetOutKind,
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
  applyAll: boolean;
  setApplyAll: (v: boolean) => void;
  editingLabel: string | null;
  autoEmph: boolean;
  setAutoEmph: (v: boolean) => void;
  pace: GroupPace;
  regroup: (p: GroupPace) => void;
  defaultPrimary: string;
  defaultAccent: string;
  autoFit: boolean;
  bgMode: 'preset' | 'on' | 'off';
  bgColor: string | null;
  bgOpacity: number;
  animIn: AnimKind | null;
  animOut: OutKind | null;
  presetInKind: AnimKind;
  presetOutKind: OutKind;
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
          Animação da legenda
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AnimPicker
            label="Entrada"
            value={animIn}
            options={IN_ANIM_OPTIONS}
            presetKind={presetInKind}
            unsupported={unsupportedIn}
            onPick={(k) => onSet({ animIn: k })}
            disabled={disabled}
          />
          <AnimPicker
            label="Saída"
            value={animOut}
            options={OUT_ANIM_OPTIONS}
            presetKind={presetOutKind}
            onPick={(k) => onSet({ animOut: k })}
            disabled={disabled}
          />
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          “Do modelo” usa a animação que o lettering já traz · “Sem animação”
          faz a legenda aparecer/sumir seca, sem efeito
        </p>
      </div>

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
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
        <p className="mt-1 text-[10px] text-text-muted">
          ligado: re-organiza as linhas e nunca sai da tela · livre: quebras
          congeladas e o texto cresce sem limite
        </p>
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
        ) : (
          <p className="mt-1 text-[10px] text-text-muted">
            caixa e barra do modelo somem (o texto continua com os efeitos)
          </p>
        )}
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
            { value: 'palavra', label: 'Palavra', sub: '1 por vez' },
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

/* ─────────────────── Seletor de animação (entrada/saída) ─────────────────── */

function AnimPicker<K extends string>({
  label,
  value,
  options,
  presetKind,
  unsupported,
  onPick,
  disabled,
}: {
  label: string;
  value: K | null;
  options: Array<{ kind: K; label: string }>;
  /** kind que o modelo atual já traz — vira o rótulo do "Do modelo" */
  presetKind: K;
  /** kinds que ESTE modelo não executa — ficam visíveis, porém travados */
  unsupported?: K[];
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
      <Popover open={open} anchorRef={btnRef} onClose={closeMenu} width={250}>
        <div className="overflow-hidden rounded-[14px] border border-line-strong bg-bg-elev shadow-2xl">
          <button
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className={
              'flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left text-[12.5px] font-bold transition-colors ' +
              (value === null
                ? 'bg-amber-400/15 text-amber-600'
                : 'text-text hover:bg-black/5')
            }
          >
            ✨ Do modelo ({labelOf(presetKind)})
          </button>
          <div className="max-h-[260px] overflow-y-auto py-1">
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
          congela o bloco (o “aplicar a todas” não pega nele)
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
                        ? 'Desbloquear (volta a receber o "aplicar a todas")'
                        : 'Bloquear: congela o visual atual — o "aplicar a todas" não pega mais neste bloco'
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
