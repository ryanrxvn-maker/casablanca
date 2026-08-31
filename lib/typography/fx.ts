/**
 * EFEITOS DA LEGENDA que o user LIGA, DESLIGA e AJUSTA — não só multiplica.
 *
 * Antes, os quatro controles (Traço, Sombra, Brilho, Fumaça) eram só
 * multiplicadores sobre o que o MODELO já trazia. Num modelo sem traço,
 * arrastar o slider de traço não fazia absolutamente nada — o que dá a
 * sensação (correta) de controle quebrado.
 *
 * Aqui cada efeito tem TRÊS estados:
 *
 *   • `auto` — segue o modelo (o multiplicador antigo continua valendo);
 *   • `on`   — o efeito EXISTE mesmo que o modelo não tenha, com os
 *              parâmetros que o user escolheu (tipo, cor, distância...);
 *   • `off`  — o efeito some mesmo que o modelo tenha.
 *
 * `applyFx` é uma função PURA que recebe o preset e devolve outro preset já
 * com os efeitos resolvidos — o resto do engine (que só sabe ler
 * `preset.stroke/shadow/glow/smoke`) não precisa saber que o user existe.
 * Testes: `lib/typography/fx.test.ts`.
 */

import type { PresetColor, TypoPreset } from './engine';

export type FxMode = 'auto' | 'on' | 'off';

/** Sombra: deslocada e borrada, deslocada e dura, ou halo em volta inteira. */
export type ShadowKind = 'suave' | 'dura' | 'contorno';
/** Brilho: do neon discreto ao halo largo, com ou sem pulsação. */
export type GlowKind = 'suave' | 'neon' | 'halo' | 'pulsante';
/** Fumaça: como as nuvens se comportam atrás do texto. */
export type SmokeKind = 'nevoa' | 'subindo' | 'rasteira' | 'poeira';

export type StrokeFx = { mode: FxMode; width: number; color: string };
export type ShadowFx = {
  mode: FxMode;
  kind: ShadowKind;
  color: string;
  /** 0..1 */
  opacity: number;
  /** fração do tamanho da fonte */
  blur: number;
  /** fração do tamanho da fonte */
  dist: number;
  /** graus; 0 = direita, 90 = baixo */
  angle: number;
};
export type GlowFx = {
  mode: FxMode;
  kind: GlowKind;
  /** null = a cor do próprio texto */
  color: string | null;
  /** fração do tamanho da fonte */
  blur: number;
};
export type SmokeFx = { mode: FxMode; kind: SmokeKind; alpha: number };

export type FxState = {
  stroke: StrokeFx;
  shadow: ShadowFx;
  glow: GlowFx;
  smoke: SmokeFx;
};

/**
 * Forma PARCIAL (fundo também) — é o que chega de uma sessão salva antiga ou
 * do `StyleState.fx` do engine, que declara o espelho estrutural.
 */
export type FxPatch = {
  stroke?: Partial<StrokeFx> & { mode: FxMode };
  shadow?: Partial<ShadowFx> & { mode: FxMode };
  glow?: Partial<GlowFx> & { mode: FxMode };
  smoke?: Partial<SmokeFx> & { mode: FxMode };
};

export const FX_DEFAULT: FxState = {
  stroke: { mode: 'auto', width: 0.05, color: '#000000' },
  shadow: { mode: 'auto', kind: 'suave', color: '#000000', opacity: 0.55, blur: 0.14, dist: 0.05, angle: 90 },
  glow: { mode: 'auto', kind: 'suave', color: null, blur: 0.22 },
  smoke: { mode: 'auto', kind: 'nevoa', alpha: 0.35 },
};

/** Cópia profunda dos defaults (nunca devolver a referência compartilhada). */
export function fxDefault(): FxState {
  return {
    stroke: { ...FX_DEFAULT.stroke },
    shadow: { ...FX_DEFAULT.shadow },
    glow: { ...FX_DEFAULT.glow },
    smoke: { ...FX_DEFAULT.smoke },
  };
}

/** Completa um FxState vindo de sessão antiga / parcial. */
export function normalizeFx(fx?: FxPatch | null): FxState {
  const d = fxDefault();
  if (!fx) return d;
  return {
    stroke: { ...d.stroke, ...(fx.stroke ?? {}) },
    shadow: { ...d.shadow, ...(fx.shadow ?? {}) },
    glow: { ...d.glow, ...(fx.glow ?? {}) },
    smoke: { ...d.smoke, ...(fx.smoke ?? {}) },
  };
}

/** O FxState está inteiramente em `auto`? (nada a serializar/aplicar) */
export function fxIsAuto(fx?: FxPatch | null): boolean {
  if (!fx) return true;
  return (
    (fx.stroke?.mode ?? 'auto') === 'auto' &&
    (fx.shadow?.mode ?? 'auto') === 'auto' &&
    (fx.glow?.mode ?? 'auto') === 'auto' &&
    (fx.smoke?.mode ?? 'auto') === 'auto'
  );
}

/* ───────────────────────── o que o MODELO já tem ──────────────────────── */

export type FxPresence = {
  stroke: boolean;
  shadow: boolean;
  glow: boolean;
  smoke: boolean;
};

export function fxPresence(preset: TypoPreset): FxPresence {
  return {
    stroke: !!preset.stroke,
    shadow: !!preset.shadow || !!preset.hardShadow,
    glow: !!preset.glow || !!preset.aura,
    smoke: !!preset.smoke,
  };
}

/** O efeito está ligado AGORA (contando o modelo + o modo escolhido)? */
export function fxIsOn(mode: FxMode, presetHas: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && presetHas);
}

/* ─────────────────── semente a partir do que o modelo tem ─────────────── */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Extrai um hex utilizável de uma cor de preset (token vira null). */
function hexOf(c: PresetColor | string | undefined): string | null {
  if (typeof c !== 'string') return null;
  if (HEX6.test(c)) return c;
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (!m) return null;
  const to2 = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

/** Alpha de uma cor rgba() (1 quando não há). */
function alphaOf(c: string | undefined): number {
  if (typeof c !== 'string') return 1;
  const m = /^rgba\(\s*\d+[,\s]+\d+[,\s]+\d+[,\s/]+([\d.]+)\s*\)$/.exec(c.trim());
  return m ? Math.max(0, Math.min(1, Number(m[1]))) : 1;
}

function withAlpha(hex: string, a: number): string {
  const h = HEX6.test(hex) ? hex : '#000000';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/**
 * Parâmetros iniciais ao LIGAR um efeito: se o modelo já tem aquele efeito, a
 * semente é o valor DELE (ligar e mexer não dá um pulo visual); se não tem,
 * um padrão que aparece de cara.
 */
export function seedFxFromPreset(preset: TypoPreset, which: keyof FxState): FxState[keyof FxState] {
  const d = fxDefault();
  if (which === 'stroke') {
    if (preset.stroke) {
      return {
        mode: 'on',
        width: preset.stroke.width,
        color: hexOf(preset.stroke.color) ?? d.stroke.color,
      } satisfies StrokeFx;
    }
    return { ...d.stroke, mode: 'on' };
  }
  if (which === 'shadow') {
    if (preset.shadow) {
      const dist = Math.hypot(preset.shadow.x, preset.shadow.y);
      const ang = dist > 0 ? (Math.atan2(preset.shadow.y, preset.shadow.x) * 180) / Math.PI : 90;
      return {
        mode: 'on',
        kind: dist > 0.001 ? 'suave' : 'contorno',
        color: hexOf(preset.shadow.color) ?? '#000000',
        opacity: alphaOf(preset.shadow.color),
        blur: preset.shadow.blur,
        dist,
        angle: Math.round(ang),
      } satisfies ShadowFx;
    }
    if (preset.hardShadow) {
      const dist = Math.hypot(preset.hardShadow.x, preset.hardShadow.y);
      const ang = dist > 0 ? (Math.atan2(preset.hardShadow.y, preset.hardShadow.x) * 180) / Math.PI : 45;
      return {
        mode: 'on',
        kind: 'dura',
        color: hexOf(preset.hardShadow.color) ?? '#000000',
        opacity: alphaOf(typeof preset.hardShadow.color === 'string' ? preset.hardShadow.color : undefined),
        blur: 0,
        dist: dist || d.shadow.dist,
        angle: Math.round(ang),
      } satisfies ShadowFx;
    }
    return { ...d.shadow, mode: 'on' };
  }
  if (which === 'glow') {
    if (preset.glow) {
      return {
        mode: 'on',
        kind: preset.aura ? (preset.aura.pulse ? 'pulsante' : 'neon') : 'suave',
        color: hexOf(preset.glow.color),
        blur: preset.glow.blur,
      } satisfies GlowFx;
    }
    return { ...d.glow, mode: 'on' };
  }
  if (preset.smoke) {
    return { mode: 'on', kind: 'nevoa', alpha: preset.smoke.alpha } satisfies SmokeFx;
  }
  return { ...d.smoke, mode: 'on' };
}

/* ──────────────────────────── aplicar no preset ───────────────────────── */

const DEG = Math.PI / 180;

/**
 * Devolve o preset com os efeitos do user resolvidos. Puro: nunca muta o
 * preset recebido, e devolve o MESMO objeto quando não há nada a fazer (o
 * engine compara identidade em cache de layout).
 */
export function applyFx(preset: TypoPreset, fxIn?: FxPatch | null): TypoPreset {
  if (fxIsAuto(fxIn)) return preset;
  const fx = normalizeFx(fxIn);
  const out: TypoPreset = { ...preset };

  // ── traço ──
  if (fx.stroke.mode === 'off') {
    delete out.stroke;
  } else if (fx.stroke.mode === 'on') {
    out.stroke = { color: fx.stroke.color, width: Math.max(0, fx.stroke.width) };
  }

  // ── sombra ──
  if (fx.shadow.mode === 'off') {
    delete out.shadow;
    delete out.hardShadow;
  } else if (fx.shadow.mode === 'on') {
    const col = withAlpha(fx.shadow.color, fx.shadow.opacity);
    if (fx.shadow.kind === 'dura') {
      delete out.shadow;
      out.hardShadow = {
        color: col,
        x: fx.shadow.dist * Math.cos(fx.shadow.angle * DEG),
        y: fx.shadow.dist * Math.sin(fx.shadow.angle * DEG),
      };
    } else if (fx.shadow.kind === 'contorno') {
      delete out.hardShadow;
      out.shadow = { color: col, blur: Math.max(0.02, fx.shadow.blur), x: 0, y: 0 };
    } else {
      delete out.hardShadow;
      out.shadow = {
        color: col,
        blur: Math.max(0, fx.shadow.blur),
        x: fx.shadow.dist * Math.cos(fx.shadow.angle * DEG),
        y: fx.shadow.dist * Math.sin(fx.shadow.angle * DEG),
      };
    }
  }

  // ── brilho ──
  if (fx.glow.mode === 'off') {
    delete out.glow;
    delete out.aura;
  } else if (fx.glow.mode === 'on') {
    const col: PresetColor = (fx.glow.color ?? 'primary') as PresetColor;
    const blur = Math.max(0.02, fx.glow.blur);
    switch (fx.glow.kind) {
      case 'halo':
        out.glow = { color: col, blur: blur * 2.1 };
        delete out.aura;
        break;
      case 'neon':
        out.glow = { color: col, blur };
        out.aura = { color: col, count: 3, width: 0.055, alpha: 0.3 };
        break;
      case 'pulsante':
        out.glow = { color: col, blur: blur * 1.2 };
        out.aura = { color: col, count: 3, width: 0.06, alpha: 0.34, pulse: true };
        break;
      default:
        out.glow = { color: col, blur };
        delete out.aura;
    }
  }

  // ── fumaça ──
  if (fx.smoke.mode === 'off') {
    delete out.smoke;
  } else if (fx.smoke.mode === 'on') {
    out.smoke = { alpha: Math.max(0, fx.smoke.alpha), kind: fx.smoke.kind };
  }

  return out;
}

/**
 * Multiplicadores efetivos. Com o efeito em modo `on`, os números explícitos
 * do painel JÁ são o valor final — deixar o multiplicador antigo por cima
 * faria o slider mentir (100% viraria 55%, por exemplo).
 */
export function fxMultipliers(
  fxIn: FxPatch | null | undefined,
  base: { stroke: number; shadow: number; glow: number; smoke: number },
): { stroke: number; shadow: number; glow: number; smoke: number } {
  if (fxIsAuto(fxIn)) return base;
  const fx = normalizeFx(fxIn);
  return {
    stroke: fx.stroke.mode === 'on' ? 1 : base.stroke,
    shadow: fx.shadow.mode === 'on' ? 1 : base.shadow,
    glow: fx.glow.mode === 'on' ? 1 : base.glow,
    smoke: fx.smoke.mode === 'on' ? 1 : base.smoke,
  };
}
