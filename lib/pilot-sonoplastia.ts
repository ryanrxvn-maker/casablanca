/**
 * SONOPLASTIA DO PILOT (08.10) — Smart SFX, trilha sonora e mixer de
 * velocidade na montagem. PURO: nada de DOM, áudio ou IndexedDB aqui (a
 * mixagem de verdade mora em pilot-sonoplastia-run.ts) — testável no harness.
 *
 * Silas: *"os SFX precisam bater perfeitamente com a transição; cuidado que
 * alguns o pico máximo não bate exatamente no começo, então tem que calibrar
 * pra sempre encaixar no tempo certo"*. E: *"o riser metálico sempre termina
 * na transição, e sempre transição com luz, de preferência a vermelha"*.
 *
 * Como o encaixe funciona: cada som do catálogo tem o seu `hitSec` — o instante
 * DENTRO do arquivo em que o ouvido percebe a batida (medido no PCM decodificado
 * em 08.10, ataque a 2ms de resolução: o "Mouse Click" tem 1s de silêncio antes
 * do clique; o "Camera flash" estoura em 0,305s). O planejador põe o arquivo pra
 * começar em `t − hitSec`, então a BATIDA cai exatamente no pico da transição
 * (a borda do insert, onde a imagem troca). O riser é o contrário: ele
 * TERMINA na transição — o `hitSec` dele é o clímax, no fim do arquivo.
 *
 * Os volumes partem do feeling medido nos projetos do Silas (Camera flash 0,12,
 * Riser 0,09, Plim 0,12) e foram equilibrados por LOUDNESS (LUFS momentâneo,
 * ffmpeg ebur128): todo som bate na mesma faixa, uns 15 LU abaixo da voz —
 * pontua o corte, nunca disputa com a fala.
 */

import type { TransicaoNoVideo, TransicaoEfetiva } from './pilot-inserts';

/* ═══════════════════════════════ catálogo ═══════════════════════════════ */

export type SfxId = 'plim-1' | 'plim-15' | 'riser-metalico' | 'camera-flash' | 'mouse-click' | 'boom';

export type SfxDef = {
  id: SfxId;
  nome: string;
  /** caminho público (servido sem login: o middleware libera .mp3) */
  url: string;
  /** nome do arquivo no projeto editável (WAV — sample-exato em qualquer editor) */
  arquivoProjeto: string;
  /**
   * O instante do ARQUIVO que tem que cair no pico da transição.
   *  - `ataque`: a batida (o clique, o flash, o "plim", o boom);
   *  - `final`: o clímax do riser, que é o fim dele.
   */
  hitSec: number;
  encaixe: 'ataque' | 'final';
  /** quanto do arquivo é usado (s) — rabo abaixo de -40 dB fica de fora */
  usoSec: number;
  /** fade de saída no fim do trecho usado (s) — corte seco estala */
  fadeOutSec: number;
  /** ganho linear calibrado (1 = o arquivo como veio) */
  ganho: number;
  descricao: string;
};

export const SFX_CATALOGO: Record<SfxId, SfxDef> = {
  'plim-1': {
    id: 'plim-1', nome: 'Plim 1', url: '/sfx/pilot/plim-1.mp3', arquivoProjeto: 'SFX - Plim 1.wav',
    hitSec: 0.1, encaixe: 'ataque', usoSec: 2.2, fadeOutSec: 0.5, ganho: 0.1,
    descricao: 'Brilho curto e limpo. Pontua o corte sem pesar.',
  },
  'plim-15': {
    id: 'plim-15', nome: 'Plim 15', url: '/sfx/pilot/plim-15.mp3', arquivoProjeto: 'SFX - Plim 15.wav',
    hitSec: 0.248, encaixe: 'ataque', usoSec: 4.5, fadeOutSec: 1.2, ganho: 0.19,
    descricao: 'Plim cristalino com cauda longa. Alterna com o Plim 1.',
  },
  'riser-metalico': {
    id: 'riser-metalico', nome: 'Riser Metálico', url: '/sfx/pilot/riser-metalico.mp3', arquivoProjeto: 'SFX - Riser Metalico.wav',
    hitSec: 1.698, encaixe: 'final', usoSec: 1.707, fadeOutSec: 0.004, ganho: 0.09,
    descricao: 'Sobe por 1,7s e TERMINA no pico da transição de luz.',
  },
  'camera-flash': {
    id: 'camera-flash', nome: 'Camera Flash', url: '/sfx/pilot/camera-flash.mp3', arquivoProjeto: 'SFX - Camera Flash.wav',
    hitSec: 0.305, encaixe: 'ataque', usoSec: 2.6, fadeOutSec: 0.6, ganho: 0.12,
    descricao: 'O disparo do flash do CapCut. Casa com o clarão branco.',
  },
  'mouse-click': {
    id: 'mouse-click', nome: 'Click do Mouse', url: '/sfx/pilot/mouse-click.mp3', arquivoProjeto: 'SFX - Click do Mouse.wav',
    hitSec: 1.047, encaixe: 'ataque', usoSec: 1.4, fadeOutSec: 0.08, ganho: 0.35,
    descricao: 'Clique seco. Bate no olho fechado da piscada.',
  },
  boom: {
    id: 'boom', nome: 'Boom', url: '/sfx/pilot/boom.mp3', arquivoProjeto: 'SFX - Boom.wav',
    hitSec: 0.02, encaixe: 'ataque', usoSec: 4.5, fadeOutSec: 2, ganho: 0.07,
    descricao: 'Impacto grave de suspense. Marca a virada do gancho.',
  },
};

export const SFX_IDS = Object.keys(SFX_CATALOGO) as SfxId[];

/** O que pode ser escolhido pra um ponto: um som, o plim que alterna, ou nada. */
export type SomEscolha = SfxId | 'plim-alternado' | 'nenhum';

export const ESCOLHAS_DE_SOM: readonly SomEscolha[] = ['plim-alternado', ...SFX_IDS, 'nenhum'];

export function nomeDaEscolha(e: SomEscolha): string {
  if (e === 'plim-alternado') return 'Plim 1 / Plim 15';
  if (e === 'nenhum') return 'Sem som';
  return SFX_CATALOGO[e].nome;
}

/* ═══════════════════════════════ config ═════════════════════════════════ */

export type DensidadeSfx = 'pontual' | 'equilibrado' | 'todas';

export type SfxCfg = {
  on: boolean;
  /** qual som cada tipo de transição recebe */
  porTransicao: Record<TransicaoEfetiva, SomEscolha>;
  /** o boom de suspense na virada do gancho pro corpo */
  boomNoGancho: boolean;
  densidade: DensidadeSfx;
  /** volume geral dos SFX, multiplica o calibrado (1 = o feeling do estúdio) */
  volume: number;
  /** ajuste fino por som, multiplica o calibrado (ausente = 1) */
  volumePorSom?: Partial<Record<SfxId, number>>;
  /** edição ponto a ponto: chave da transição (`insert@entrada`) ou 'gancho' → som */
  pontos?: Record<string, SomEscolha>;
};

export const SFX_CFG_DEFAULT: SfxCfg = {
  on: false,
  porTransicao: { escurecer: 'plim-alternado', luz: 'camera-flash', 'luz-vermelha': 'riser-metalico', piscar: 'mouse-click' },
  boomNoGancho: true,
  densidade: 'equilibrado',
  volume: 1,
};

export const SFX_VOLUME_MAX = 2;

function escolhaValida(x: unknown, padrao: SomEscolha): SomEscolha {
  return typeof x === 'string' && (ESCOLHAS_DE_SOM as readonly string[]).includes(x) ? (x as SomEscolha) : padrao;
}

const prender = (v: unknown, min: number, max: number, padrao: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;

/** Config vinda do localStorage (de versão velha, futura ou editada à mão)
 *  sempre vira algo que a montagem consegue usar. */
export function normalizarSfxCfg(x: unknown): SfxCfg {
  const c = (x && typeof x === 'object' ? x : {}) as Partial<SfxCfg>;
  const pt = (c.porTransicao && typeof c.porTransicao === 'object' ? c.porTransicao : {}) as Partial<Record<TransicaoEfetiva, unknown>>;
  const d = SFX_CFG_DEFAULT.porTransicao;
  const vps: Partial<Record<SfxId, number>> = {};
  if (c.volumePorSom && typeof c.volumePorSom === 'object') {
    for (const id of SFX_IDS) {
      const v = (c.volumePorSom as Record<string, unknown>)[id];
      if (typeof v === 'number' && Number.isFinite(v)) vps[id] = Math.min(SFX_VOLUME_MAX, Math.max(0, v));
    }
  }
  const pontos: Record<string, SomEscolha> = {};
  if (c.pontos && typeof c.pontos === 'object') {
    for (const [k, v] of Object.entries(c.pontos)) {
      if (typeof k === 'string' && k.length < 200) pontos[k] = escolhaValida(v, 'nenhum');
    }
  }
  return {
    on: !!c.on,
    porTransicao: {
      escurecer: escolhaValida(pt.escurecer, d.escurecer),
      luz: escolhaValida(pt.luz, d.luz),
      'luz-vermelha': escolhaValida(pt['luz-vermelha'], d['luz-vermelha']),
      piscar: escolhaValida(pt.piscar, d.piscar),
    },
    boomNoGancho: c.boomNoGancho === undefined ? SFX_CFG_DEFAULT.boomNoGancho : !!c.boomNoGancho,
    densidade: c.densidade === 'pontual' || c.densidade === 'todas' ? c.densidade : 'equilibrado',
    volume: prender(c.volume, 0, SFX_VOLUME_MAX, 1),
    ...(Object.keys(vps).length ? { volumePorSom: vps } : {}),
    ...(Object.keys(pontos).length ? { pontos } : {}),
  };
}

/* ═════════════════════════════ Smart SFX ════════════════════════════════ */

/** Um SFX colocado na linha do tempo do vídeo final. */
export type SfxColocado = {
  /** chave do ponto (`insert@entrada`, `insert@saida` ou 'gancho') */
  chave: string;
  sfx: SfxId;
  /** o instante que BATE (pico da transição) — s no vídeo final */
  t: number;
  /** onde o arquivo começa a tocar no vídeo (s, ≥ 0) */
  inicio: number;
  /** de onde no ARQUIVO ele começa (s) — > 0 só quando o começo cairia antes do vídeo */
  deSec: number;
  /** quanto do arquivo toca (s) */
  dur: number;
  /** ganho linear final (calibrado × volume geral × ajuste do som) */
  ganho: number;
  fadeOutSec: number;
  /** o tipo de transição que ele acompanha (ou 'gancho') */
  motivo: TransicaoEfetiva | 'gancho';
};

/** Prioridade quando dois pontos disputam o mesmo instante: o som que tem
 *  imagem casada (riser→luz, clique→piscada) nunca é o que sai. */
const PRIORIDADE: Record<SfxId, number> = {
  'riser-metalico': 5,
  'mouse-click': 4,
  boom: 4,
  'camera-flash': 2,
  'plim-1': 1,
  'plim-15': 1,
};

/** Sons "de assinatura": vêm casados com a imagem — a densidade não os corta. */
const ASSINATURA: ReadonlySet<SfxId> = new Set(['riser-metalico', 'mouse-click', 'boom']);

/** Distância mínima entre duas batidas COMUNS (plim/flash) por densidade. */
export const GAP_POR_DENSIDADE: Record<DensidadeSfx, number> = { pontual: 5, equilibrado: 2.4, todas: 0.6 };
/** Nenhuma batida chega mais perto que isto de outra — nem as de assinatura. */
export const GAP_ABSOLUTO_SEC = 0.45;
/** Batida colada no começo ou no fim do vídeo não toca (som cortado no meio). */
export const MARGEM_DAS_PONTAS_SEC = 0.12;

export type PlanoSfxEntrada = {
  transicoes: TransicaoNoVideo[];
  durSec: number;
  /** onde o gancho acaba (s) — o corte hook→body. null = sem gancho conhecido */
  fimDoGancho?: number | null;
};

/**
 * O PLANO de SFX: que som bate em cada transição, e onde o arquivo começa.
 *
 * Ordem das decisões:
 *  1. cada transição pede o som do seu tipo (`porTransicao`), a não ser que o
 *     editor tenha escolhido outro naquele ponto (`pontos`);
 *  2. o BOOM entra na virada do gancho: em cima da transição que cai nela (e
 *     toma o lugar do som dela) ou, sem transição ali, no próprio corte;
 *  3. disputa por espaço: assinatura primeiro (riser, clique, boom), depois os
 *     comuns respeitando a densidade — o "um a cada tanto" do feeling;
 *  4. dois risers nunca se atropelam: a subida de um não pode começar antes do
 *     clímax do anterior.
 */
export function planejarSfx(cfgBruta: SfxCfg, entrada: PlanoSfxEntrada): SfxColocado[] {
  const cfg = normalizarSfxCfg(cfgBruta);
  if (!cfg.on || !(entrada.durSec > 0)) return [];
  const dur = entrada.durSec;
  type Candidato = { chave: string; t: number; escolha: SomEscolha; motivo: TransicaoEfetiva | 'gancho'; ordem: number };
  const candidatos: Candidato[] = [];
  const dentro = (t: number) => t >= MARGEM_DAS_PONTAS_SEC && t <= dur - MARGEM_DAS_PONTAS_SEC;

  const trans = [...entrada.transicoes].filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  trans.forEach((tr, i) => {
    if (!dentro(tr.t)) return;
    const escolha = cfg.pontos?.[tr.chave] ?? cfg.porTransicao[tr.tipo];
    candidatos.push({ chave: tr.chave, t: tr.t, escolha, motivo: tr.tipo, ordem: i });
  });

  // BOOM no gancho: a transição mais perto da virada (até 0,6s) recebe o boom
  const fg = entrada.fimDoGancho;
  const escolhaGancho = cfg.pontos?.gancho ?? (cfg.boomNoGancho ? 'boom' : 'nenhum');
  if (fg != null && Number.isFinite(fg) && dentro(fg) && escolhaGancho !== 'nenhum') {
    let alvo: Candidato | null = null;
    for (const c of candidatos) {
      if (Math.abs(c.t - fg) <= 0.6 && (!alvo || Math.abs(c.t - fg) < Math.abs(alvo.t - fg))) alvo = c;
    }
    // riser e piscada têm a imagem casada com o som — o boom não rouba deles
    const somDoAlvo = alvo ? alvo.escolha : null;
    if (alvo && somDoAlvo !== 'riser-metalico' && somDoAlvo !== 'mouse-click' && !cfg.pontos?.[alvo.chave]) {
      alvo.escolha = escolhaGancho;
      alvo.motivo = 'gancho';
      alvo.chave = 'gancho';
    } else if (!alvo) {
      candidatos.push({ chave: 'gancho', t: fg, escolha: escolhaGancho, motivo: 'gancho', ordem: -1 });
    }
  }

  // o plim que ALTERNA decide o número só depois da disputa (abaixo): assim
  // os que SOBRAM no vídeo é que alternam 1, 15, 1, 15…
  candidatos.sort((a, b) => a.t - b.t);
  const resolvidos = candidatos.flatMap((c) => {
    if (c.escolha === 'nenhum') return [];
    const alternar = c.escolha === 'plim-alternado';
    const sfx: SfxId = alternar ? 'plim-1' : (c.escolha as SfxId);
    return [{ ...c, sfx, alternar }];
  });

  // disputa por espaço: assinatura primeiro, depois os comuns
  const gap = GAP_POR_DENSIDADE[cfg.densidade];
  const aceitos: Array<(typeof resolvidos)[number]> = [];
  const porPrioridade = [...resolvidos].sort((a, b) => (PRIORIDADE[b.sfx] - PRIORIDADE[a.sfx]) || (a.t - b.t));
  for (const c of porPrioridade) {
    const assinatura = ASSINATURA.has(c.sfx);
    const minimo = assinatura ? GAP_ABSOLUTO_SEC : gap;
    const colide = aceitos.some((o) => {
      if (Math.abs(o.t - c.t) < Math.max(minimo, GAP_ABSOLUTO_SEC)) return true;
      // a subida do riser é dele: batida comum dentro dela embola o som
      if (!assinatura && o.sfx === 'riser-metalico') {
        const subida = SFX_CATALOGO['riser-metalico'].hitSec;
        if (c.t > o.t - subida - 0.15 && c.t < o.t + 0.25) return true;
      }
      if (c.sfx === 'riser-metalico' && !ASSINATURA.has(o.sfx)) {
        const subida = SFX_CATALOGO['riser-metalico'].hitSec;
        if (o.t > c.t - subida - 0.15 && o.t < c.t + 0.25) return true;
      }
      // dois risers: o segundo só sobe depois do clímax do primeiro
      if (c.sfx === 'riser-metalico' && o.sfx === 'riser-metalico') {
        const subida = SFX_CATALOGO['riser-metalico'].hitSec;
        if (Math.abs(o.t - c.t) < subida + 0.3) return true;
      }
      return false;
    });
    if (!colide) aceitos.push(c);
  }

  let plimN = 0;
  return aceitos
    .sort((a, b) => a.t - b.t)
    .map((c) => {
      const sfx: SfxId = c.alternar ? (plimN++ % 2 === 0 ? 'plim-1' : 'plim-15') : c.sfx;
      return colocar(sfx, c.t, c.chave, c.motivo, cfg, dur);
    });
}

/** Põe o arquivo pra BATER em `t` (ataque) ou TERMINAR em `t` (riser). */
export function colocar(
  sfx: SfxId,
  t: number,
  chave: string,
  motivo: SfxColocado['motivo'],
  cfg: Pick<SfxCfg, 'volume' | 'volumePorSom'>,
  durVideo: number,
): SfxColocado {
  const def = SFX_CATALOGO[sfx];
  const inicioIdeal = t - def.hitSec;
  const deSec = inicioIdeal < 0 ? -inicioIdeal : 0;
  const inicio = Math.max(0, inicioIdeal);
  // o som acaba no fim do trecho útil ou no fim do vídeo — o que vier antes
  const dur = Math.max(0, Math.min(def.usoSec - deSec, durVideo - inicio));
  const ajuste = cfg.volumePorSom?.[sfx] ?? 1;
  const ganho = Math.max(0, def.ganho * (cfg.volume ?? 1) * ajuste);
  return {
    chave, sfx, t, inicio, deSec, dur, ganho,
    fadeOutSec: Math.min(def.fadeOutSec, dur / 2),
    motivo,
  };
}

/* ═══════════════════════════════ trilha ═════════════════════════════════ */

export type TrilhaCfg = {
  on: boolean;
  /** id da trilha na biblioteca do navegador (pilot-trilhas-store) */
  trilhaId: string | null;
  /** nome do arquivo, pra tela */
  nome: string;
  /**
   * Volume RELATIVO À VOZ, 0..1. A trilha é medida (LUFS) e nivelada na voz
   * antes; este número é a fração dela que sobra: 0,12 ≈ 18 dB abaixo da
   * fala — o "Lo-Fi a 0,09" dos projetos do Silas.
   */
  volume: number;
};

export const TRILHA_CFG_DEFAULT: TrilhaCfg = { on: false, trilhaId: null, nome: '', volume: 0.12 };
export const TRILHA_VOLUME_MAX = 0.6;

export function normalizarTrilhaCfg(x: unknown): TrilhaCfg {
  const c = (x && typeof x === 'object' ? x : {}) as Partial<TrilhaCfg>;
  return {
    on: !!c.on && typeof c.trilhaId === 'string' && c.trilhaId.length > 0,
    trilhaId: typeof c.trilhaId === 'string' && c.trilhaId ? c.trilhaId : null,
    nome: typeof c.nome === 'string' ? c.nome.slice(0, 200) : '',
    volume: prender(c.volume, 0, TRILHA_VOLUME_MAX, TRILHA_CFG_DEFAULT.volume),
  };
}

/** dB de um volume relativo (0,12 → -18,4 dB). */
export function dbDoVolume(v: number): number {
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

/** Fade de saída da trilha: curto o bastante pra não "morrer cedo". */
export const TRILHA_FADE_OUT_SEC = 1.4;
/** Fade de entrada: só o que tira o estalo do primeiro quadro. */
export const TRILHA_FADE_IN_SEC = 0.04;
/** Emenda quando a trilha é MAIS CURTA que o vídeo e precisa repetir. */
export const TRILHA_CROSSFADE_SEC = 1.2;

export type PedacoDaTrilha = {
  /** onde ele toca no vídeo (s) */
  inicio: number;
  /** de onde no arquivo (s) */
  deSec: number;
  dur: number;
  /** rampa de entrada/saída deste pedaço (s) */
  fadeIn: number;
  fadeOut: number;
};

/**
 * A trilha cortada NO TAMANHO DO VÍDEO. Silas: *"se a trilha tem 3min e o vídeo
 * tem 1min, não pode sobrar 2min só por causa da trilha"*. Mais longa: toca do
 * começo e termina junto com o vídeo, com fade. Mais curta: repete com uma
 * emenda em crossfade até o fim. Nunca passa do último quadro.
 */
export function planoDaTrilha(durVideo: number, durTrilha: number): PedacoDaTrilha[] {
  if (!(durVideo > 0) || !(durTrilha > 0.2)) return [];
  const fadeOutFinal = Math.min(TRILHA_FADE_OUT_SEC, durVideo / 4);
  if (durTrilha >= durVideo - 1e-6) {
    return [{ inicio: 0, deSec: 0, dur: durVideo, fadeIn: TRILHA_FADE_IN_SEC, fadeOut: fadeOutFinal }];
  }
  const xf = Math.min(TRILHA_CROSSFADE_SEC, durTrilha / 3);
  const passo = durTrilha - xf;
  const out: PedacoDaTrilha[] = [];
  for (let inicio = 0, k = 0; inicio < durVideo - 1e-6 && k < 500; inicio += passo, k++) {
    const dur = Math.min(durTrilha, durVideo - inicio);
    const ultimo = inicio + dur >= durVideo - 1e-6;
    out.push({
      inicio,
      deSec: 0,
      dur,
      fadeIn: k === 0 ? TRILHA_FADE_IN_SEC : xf,
      fadeOut: ultimo ? Math.min(fadeOutFinal, dur / 2) : xf,
    });
    if (ultimo) break;
  }
  return out;
}

/**
 * Ganho linear da trilha: nivela a trilha NA VOZ (diferença de LUFS) e aplica
 * o volume relativo. Sem medida confiável, cai num palpite conservador (trilha
 * masterizada típica fica ~4 LU acima de uma voz em -16).
 */
export function ganhoDaTrilha(volume: number, lufsVoz: number | null, lufsTrilha: number | null): number {
  const v = Math.max(0, Math.min(TRILHA_VOLUME_MAX, volume));
  if (v <= 0) return 0;
  const voz = lufsVoz != null && Number.isFinite(lufsVoz) && lufsVoz > -60 ? lufsVoz : -16;
  const tri = lufsTrilha != null && Number.isFinite(lufsTrilha) && lufsTrilha > -60 ? lufsTrilha : -12;
  const nivelar = Math.pow(10, (voz - tri) / 20);
  return Math.min(4, nivelar * v);
}

/* ══════════════════════════ mixer de velocidade ═════════════════════════ */

export type VelocidadeCfg = {
  on: boolean;
  /** multiplicador (0,5 = metade, 1,15 = 15% mais rápido) */
  velocidade: number;
};

/** Mesma régua do Mixer de Velocidade (/tools/acelerador). */
export const VELOCIDADE_MIN = 0.5;
export const VELOCIDADE_MAX = 3;
export const VELOCIDADE_PASSO = 0.05;
export const VELOCIDADE_CFG_DEFAULT: VelocidadeCfg = { on: false, velocidade: 1.1 };
export const VELOCIDADE_PRESETS = [0.75, 0.9, 1.1, 1.15, 1.2, 1.25, 1.5] as const;

export function normalizarVelocidadeCfg(x: unknown): VelocidadeCfg {
  const c = (x && typeof x === 'object' ? x : {}) as Partial<VelocidadeCfg>;
  const bruta = prender(c.velocidade, VELOCIDADE_MIN, VELOCIDADE_MAX, VELOCIDADE_CFG_DEFAULT.velocidade);
  // na grade do slider (0,05) — 1,1499999 vira 1,15
  const velocidade = Math.round(bruta / VELOCIDADE_PASSO) * VELOCIDADE_PASSO;
  return { on: !!c.on, velocidade: Math.round(velocidade * 100) / 100 };
}

/** A velocidade que a montagem aplica (1 = não mexe). */
export function velocidadeEfetiva(cfg: VelocidadeCfg | null | undefined): number {
  if (!cfg?.on) return 1;
  const v = normalizarVelocidadeCfg(cfg).velocidade;
  return Math.abs(v - 1) < 0.001 ? 1 : v;
}

/** As fronteiras dos takes depois de acelerar: o vídeo encolhe por igual. */
export function escalarTempos<T extends number[] | number[][] | null | undefined>(tempos: T, velocidade: number): T {
  if (!tempos || !(velocidade > 0) || Math.abs(velocidade - 1) < 1e-9) return tempos;
  return (tempos as Array<number | number[]>).map((x) => (Array.isArray(x) ? x.map((y) => y / velocidade) : x / velocidade)) as T;
}

/* ═══════════════════════════ o gancho no vídeo ══════════════════════════ */

/**
 * Onde o GANCHO termina no vídeo montado: a soma das partes de HOOK do início
 * (o corte hook→body). Null quando o vídeo não começa por um hook ou falta
 * informação — aí o boom simplesmente não entra.
 */
export function fimDoGanchoNoVideo(partesSec: number[] | null | undefined, labels: string[] | null | undefined): number | null {
  if (!partesSec?.length || !labels?.length || labels.length !== partesSec.length) return null;
  const ehHook = (l: string) => /^(hook|gancho)/i.test(String(l || '').trim());
  if (!ehHook(labels[0])) return null;
  let t = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!ehHook(labels[i])) return i > 0 && t > 0 ? t : null;
    const d = partesSec[i];
    if (!(d > 0) || !Number.isFinite(d)) return null;
    t += d;
  }
  return null; // só hook, sem corpo: não há virada
}

/* ═══════════════════════════ loudness (BS.1770) ══════════════════════════ */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** Os dois filtros da ponderação K (ITU-R BS.1770-4) na taxa do áudio — as
 *  MESMAS fórmulas do libebur128 (a régua do ffmpeg/ebur128), que reproduzem
 *  os coeficientes da norma em 48 kHz e valem em qualquer taxa. */
function filtrosK(taxa: number): [Biquad, Biquad] {
  // 1) prateleira alta (+4 dB acima de ~1,7 kHz): a cabeça como obstáculo
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / taxa);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // 2) passa-altas de ~38 Hz (RLB): grave não "pesa" como o ouvido não pesa
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / taxa);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function filtrar(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

/**
 * LOUDNESS INTEGRADO (LUFS) — BS.1770-4: ponderação K, blocos de 400ms com
 * 75% de sobreposição, porta absoluta em -70 e relativa em -10 LU. É a régua
 * do normalizador do Pilot (a voz sai em -16), então trilha e voz comparadas
 * por ela ficam no mesmo patamar de verdade. Null = silêncio/curto demais.
 */
export function lufsIntegrado(canais: Float32Array[], taxa: number): number | null {
  if (!canais.length || !(taxa > 0)) return null;
  const n = Math.min(...canais.map((c) => c.length));
  const bloco = Math.round(taxa * 0.4);
  const passo = Math.round(taxa * 0.1);
  if (n < bloco) return null;
  const [shelf, hp] = filtrosK(taxa);
  const ponderados = canais.map((c) => filtrar(filtrar(c.subarray(0, n), shelf), hp));
  // energia por bloco (soma dos canais, peso 1 em L/R)
  const energias: number[] = [];
  // soma acumulada dos quadrados pra cada canal — blocos em O(1)
  const acc = ponderados.map((c) => {
    const a = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) a[i + 1] = a[i] + c[i] * c[i];
    return a;
  });
  for (let ini = 0; ini + bloco <= n; ini += passo) {
    let z = 0;
    for (const a of acc) z += (a[ini + bloco] - a[ini]) / bloco;
    energias.push(z);
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z);
  const acimaAbs = energias.filter((z) => z > 0 && lk(z) > -70);
  if (!acimaAbs.length) return null;
  const media = (zs: number[]) => zs.reduce((s, z) => s + z, 0) / zs.length;
  const relativo = lk(media(acimaAbs)) - 10;
  const finais = acimaAbs.filter((z) => lk(z) > relativo);
  if (!finais.length) return null;
  return lk(media(finais));
}

/**
 * LIMITADOR DE PICOS: só abaixa o que passaria do teto, e só ali (ataque de
 * 1,5ms, soltura de 60ms). A voz chega do normalizador quase encostada no
 * teto (-1,5 dBTP); um SFX batendo em cima de uma sílaba forte estourava —
 * abaixar a mixagem INTEIRA por causa de um pico mudaria o volume da fala do
 * AD todo. Devolve a maior redução aplicada, em dB (0 = nada tocado).
 */
export function limitarPicos(canais: Float32Array[], taxa: number, teto = 0.97): number {
  if (!canais.length) return 0;
  const n = Math.min(...canais.map((c) => c.length));
  const sub = Math.max(1, Math.round(taxa * 0.0015)); // blocos de 1,5ms
  const nb = Math.ceil(n / sub);
  const alvo = new Float32Array(nb).fill(1);
  let algum = false;
  for (let b = 0; b < nb; b++) {
    let pico = 0;
    const fim = Math.min(n, (b + 1) * sub);
    for (const c of canais) for (let i = b * sub; i < fim; i++) { const a = Math.abs(c[i]); if (a > pico) pico = a; }
    if (pico > teto) { alvo[b] = teto / pico; algum = true; }
  }
  if (!algum) return 0;
  // ataque: o ganho já está baixo UM bloco antes do pico (sem estalo)
  const g = new Float32Array(nb);
  for (let b = 0; b < nb; b++) g[b] = Math.min(alvo[b], b + 1 < nb ? alvo[b + 1] : 1, b > 0 ? alvo[b - 1] : 1);
  // soltura exponencial
  const rel = Math.exp(-(sub / taxa) / 0.06);
  for (let b = 1; b < nb; b++) g[b] = Math.min(g[b], 1 - (1 - g[b - 1]) * rel);
  let pior = 1;
  for (const c of canais) {
    for (let i = 0; i < n; i++) {
      // interpola o ganho entre o centro dos blocos
      const pos = i / sub - 0.5;
      const b0 = Math.max(0, Math.min(nb - 1, Math.floor(pos)));
      const b1 = Math.min(nb - 1, b0 + 1);
      const f = Math.min(1, Math.max(0, pos - b0));
      const gi = Math.min(g[b0] + (g[b1] - g[b0]) * f, alvo[Math.min(nb - 1, Math.floor(i / sub))]);
      c[i] *= gi;
      if (gi < pior) pior = gi;
    }
  }
  return 20 * Math.log10(pior);
}
