'use client';

/**
 * FakePass — módulo compartilhado (fundação).
 *
 * Tudo que é comum a todos os modelos de print/sticker vive aqui:
 *  • tipos do sistema modular de modelos
 *  • FitText — auto-ajuste de fonte (mesmo motor da caixinha de pergunta)
 *  • downloadNodeAsPng — export nítido via html2canvas + Object URL
 *  • StatusBar — barra de status realista de celular (iPhone / Android)
 *  • primitivos de controle (Field, TextField, Toggle, RangeField, etc.)
 *
 * Cada MODELO (sticker, chat, post…) é um objeto FakeModel registrado em
 * models.tsx e consumido pelo shell em page.tsx.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Inter } from 'next/font/google';
import { EmojiPickerButton } from './emoji-picker';

// Fonte base dos prints — Inter (réplica fiel do SF Pro do iOS/Instagram),
// carregada local. Em Apple o sistema entrega SF Pro nativo pela stack abaixo.
export const uiFont = Inter({
  subsets: ['latin'],
  // o 800 é usado pelos selos LIVE/AO VIVO das lives (desenhados em canvas)
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-fp',
});
// A Inter (réplica fiel do SF Pro do iPhone/Instagram) vem PRIMEIRO — em Apple o
// próprio -apple-system entrega SF Pro nativo; nas demais plataformas a Inter
// mantém o mesmo desenho. O export é html2canvas, que desenha com a fonte JÁ
// CARREGADA na página, então a MESMA fonte da prévia sai no download.
export const FONT_STACK =
  "var(--font-fp), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* ────────────────────────────── Tipos ────────────────────────────── */

export type PhoneOS = 'ios' | 'android';

export type StatusCfg = {
  os: PhoneOS;
  time: string;
  carrier: string;
  battery: number; // 0-100
  charging: boolean;
  signal: number; // 0-4
  wifi: boolean;
  network: string; // '4G' | '5G' | 'LTE' | ''
  airplane: boolean;
};

export const defaultStatus: StatusCfg = {
  os: 'ios',
  time: '9:41',
  carrier: 'Vivo',
  battery: 82,
  charging: false,
  signal: 4,
  wifi: true,
  network: '5G',
  airplane: false,
};

export type ModelCategory = 'story' | 'chat' | 'post' | 'notif' | 'live' | 'meet' | 'news' | 'sites';

/** Dimensões do palco (usadas pelo shell pra escalar preview e exportar). */
export type StageDims = { stageW: number; ratio: number; exportW: number };

export type FakeModel<S = any> = {
  id: string;
  label: string;
  category: ModelCategory;
  hue: string;
  /** Largura do PALCO em px no preview (o export escala a partir daí). */
  stageW: number;
  /** altura/largura do palco. */
  ratio: number;
  /** Largura final do PNG exportado. */
  exportW: number;
  /** Mostra a barra de status do celular no topo do palco? */
  usesPhone: boolean;
  /** Sub-grupo dentro da categoria (ex.: nome da emissora nas Notícias). */
  group?: string;
  /** Tem relógio/ticker/bolinha animáveis ([data-fp-anim] no Preview)?
   *  → o shell mostra "Exportar vídeo (.webm)" (motor em video-export.ts). */
  anim?: boolean;
  /** Texto de apoio do export de vídeo (o que se mexe neste modelo). */
  vidHint?: string;
  /** Dimensões DINÂMICAS: quando presente, o shell usa isto no lugar de
   *  stageW/ratio/exportW fixos (ex.: alternar 16:9 ↔ 9:16 pelo estado). */
  dims?: (s: S) => StageDims;
  defaultState: S;
  Controls: (p: { s: S; set: (patch: Partial<S>) => void }) => ReactNode;
  /** Renderiza o conteúdo do print. `status` só vem quando usesPhone. */
  Preview: (p: { s: S; status: StatusCfg }) => ReactNode;
};

/* ─────────────────────────── FitText ─────────────────────────── */

/* ─────────────────────── Emojis (Apple / Google) ─────────────────────── */
// Emojis do texto viram <img> do CDN: Apple por padrão (= iPhone) e Google
// quando o celular está em Android. Assim o print sai com o emoji CERTO em
// qualquer máquina, e o html2canvas rasteriza as imagens (CORS liberado no
// jsdelivr). O nome do arquivo é o codepoint em hex (com hífen p/ sequências).
export const EMOJI_RE =
  /(\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;

export type EmojiSet = 'apple' | 'google';

export function toUnified(emoji: string) {
  return [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join('-');
}

/** String → nodes, trocando cada emoji por <img> Apple/Google. */
export function emojify(text: string, set: EmojiSet = 'apple'): ReactNode {
  if (!text) return text;
  const re = new RegExp(EMOJI_RE);
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    if (m.index > last) out.push(text.slice(last, m.index));
    const emoji = m[0];
    out.push(
      <img
        key={`e${k}`}
        src={`https://cdn.jsdelivr.net/npm/emoji-datasource-${set}/img/${set}/64/${toUnified(emoji)}.png`}
        alt={emoji}
        crossOrigin="anonymous"
        draggable={false}
        style={{ width: '1.15em', height: '1.15em', display: 'inline-block', verticalAlign: '-0.22em', objectFit: 'contain', margin: '0 0.02em' }}
      />,
    );
    k += 1;
    last = m.index + emoji.length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texto com emojis renderizados (Apple padrão; Google se set='google'). */
export function Emo({ t, set = 'apple' }: { t: string; set?: EmojiSet }) {
  return <>{emojify(t, set)}</>;
}

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Texto que encolhe a fonte (do máximo ao mínimo) até caber na altura-alvo —
 * igual ao Instagram. Mede o scrollHeight real; o tamanho final é o que o
 * export rasteriza.
 */
export function FitText({
  children,
  maxPx,
  minPx,
  maxHeight,
  style,
}: {
  children: ReactNode;
  maxPx: number;
  minPx: number;
  maxHeight: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(maxPx);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    let guard = 0;
    while (size > minPx && el.scrollHeight > maxHeight && guard < 48) {
      size -= 1;
      el.style.fontSize = `${size}px`;
      guard += 1;
    }
    setPx(size);
  }, [children, maxPx, minPx, maxHeight]);
  return (
    <div ref={ref} data-fp-fit="" style={{ ...style, fontSize: px }}>
      {children || ' '}
    </div>
  );
}

/* ───────────────────────── Export (PNG) ───────────────────────── */

/**
 * Rasteriza um nó do DOM em PNG NÍTIDO e fiel à prévia.
 *
 * Motor: `html2canvas` — RÁPIDO (~3s, previsível) e desenha com a fonte JÁ
 * CARREGADA na página, então a MESMA fonte da prévia (Inter) sai no download. Os
 * motores foreignObject (snapdom/modern-screenshot) sairiam pixel-a-pixel porque
 * quem desenha é o próprio navegador, mas no CACHE FRIO (o 1º export do usuário)
 * levam 40-77s — inviável. O html2canvas tem um pequeno drift vertical sub-pixel,
 * mitigado pelo crop-guard (abaixo) e por line-heights explícitos nos textos-chave.
 *
 * `targetW` = largura final do PNG; scale = targetW/refW (stageW). Download por
 * Object URL (data URL trunca arquivo grande).
 */
export async function renderNodeToCanvas(
  node: HTMLElement,
  targetW: number,
  refW?: number,
  /** Ajuste extra aplicado a CADA clone (todos os renders, sondas e final) —
   *  usado pelo export de vídeo pra assar a base com a tinta animada oculta. */
  onCloneExtra?: (root: HTMLElement) => void,
): Promise<HTMLCanvasElement> {
  // Fontes prontas ANTES de capturar: se a Inter não terminou de carregar, o
  // texto sai numa fonte de fallback com métrica diferente = desalinhado.
  if (document.fonts?.ready) await document.fonts.ready;

  // A prévia é encolhida com CSS `zoom` num wrapper [data-fp-zoom]. Durante a
  // captura, zeramos esse zoom (→ 1) pra o nó voltar ao tamanho natural (stageW):
  // o PNG sai SEMPRE na resolução cheia e imune a qualquer medição dentro de um
  // ancestral escalado. Restauramos no finally.
  const zoomEl = node.closest('[data-fp-zoom]') as HTMLElement | null;
  const prevZoom = zoomEl ? zoomEl.style.zoom : '';
  if (zoomEl) zoomEl.style.zoom = '1';

  // ── Crop-guard do html2canvas ──
  // O html2canvas erra a posição vertical do texto por ~1-2px na hora de desenhar;
  // em texto com `overflow:hidden`/`clip` isso corta as letras no PNG (topo do nome
  // do header/@usuário/chyron; base da última linha do line-clamp). A correção mais
  // ROBUSTA: pro texto que CABE (não estoura a caixa), simplesmente REMOVEMOS o clip
  // (`overflow: visible`) durante a captura — como não há nada pra cortar, o
  // resultado é IDÊNTICO à prévia, só que sem o corte-fantasma do html2canvas. Pro
  // texto que REALMENTE estoura (nome enorme etc.), deixamos o clip (mantém o "…";
  // caso raro). NÃO mexemos em padding/margin — o html2canvas não honra margem
  // negativa direito e isso desalinhava o texto. Restauramos no finally.
  const cropGuards: Array<() => void> = [];
  // ── Gap-shim do html2canvas ──
  // O html2canvas 1.4.1 IGNORA `gap`/`column-gap`/`row-gap` de flex → os filhos saem
  // GRUDADOS no PNG (ex.: os itens do menu dos sites viram "g1GloboPolítica…"), enquanto
  // na prévia o navegador respeita o gap. Correção: em cada flex COM gap, ZERAMOS o gap e
  // passamos o MESMO espaçamento pra MARGEM dos filhos (margin-right em linha,
  // margin-bottom em coluna) — que o html2canvas honra. O navegador renderiza igualzinho
  // (margem = gap), então prévia e download batem. Desfazemos tudo no finally.
  const gapShims: Array<() => void> = [];
  const applyGapShims = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display !== 'flex' && cs.display !== 'inline-flex') return;
      // space-between/around DISTRIBUI a folga: aí a margem duplicaria o espaçamento.
      // -reverse inverteria o lado da margem — casos raros aqui, então pulamos.
      if (cs.justifyContent.startsWith('space-')) return;
      if (cs.flexDirection.endsWith('reverse')) return;
      const col = cs.flexDirection === 'column';
      const gap = parseFloat(col ? cs.rowGap : cs.columnGap) || 0;
      if (gap <= 0) return;
      const kids = Array.from(el.children).filter(
        (k) => getComputedStyle(k as HTMLElement).display !== 'none',
      ) as HTMLElement[];
      if (kids.length < 2) return;
      const est = el.style;
      const prevG = { g: est.gap, cg: est.columnGap, rg: est.rowGap };
      if (col) est.rowGap = '0px';
      else est.columnGap = '0px';
      gapShims.push(() => { est.gap = prevG.g; est.columnGap = prevG.cg; est.rowGap = prevG.rg; });
      const prop = col ? 'marginBottom' : 'marginRight';
      kids.forEach((kid, i) => {
        if (i === kids.length - 1) return; // último não recebe (não altera a largura total)
        const cur = parseFloat(getComputedStyle(kid)[prop as any]) || 0;
        const prev = kid.style[prop as any];
        (kid.style as any)[prop] = `${cur + gap}px`;
        gapShims.push(() => { (kid.style as any)[prop] = prev; });
      });
    });
  };
  // Text-nodes SOLTOS de containers MISTOS (elemento + texto, ex.: "● LIVE") não são
  // folhas puras, então a coleta de alvos os pularia. Aqui os envolvemos num <span>
  // inline (layout-neutro) pra virarem folhas compensáveis; desfazemos no finally.
  const textUnwrap: Array<() => void> = [];
  const wrapMixedText = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const kids = Array.from(el.childNodes);
      if (!kids.some((n) => n.nodeType === 1)) return; // folha pura: já é tratada
      if (getComputedStyle(el).writingMode !== 'horizontal-tb') return;
      for (const n of kids) {
        if (n.nodeType !== 3 || !(n.textContent || '').trim()) continue;
        // Texto que ATRAVESSA linhas não vira chip: o html2canvas EMBARALHA
        // <span> inline multi-linha (linhas desenhadas umas sobre as outras).
        // O chip compensável ("● LIVE") é de 1 linha por natureza; fluxo que
        // quebra é tratado pelo flow-block (alvo no PAI, sem wrap).
        const rg = el.ownerDocument.createRange();
        rg.selectNodeContents(n);
        if (rg.getClientRects().length > 1) continue;
        const span = el.ownerDocument.createElement('span');
        el.replaceChild(span, n);
        span.appendChild(n);
        textUnwrap.push(() => {
          if (span.parentNode === el) el.replaceChild(n, span);
        });
      }
    });
  };
  // ── Ellipsis-shim do html2canvas ──
  // O html2canvas NÃO desenha o "…" do `text-overflow: ellipsis`: texto de 1
  // linha que ESTOURA a caixa sai FATIADO no limite (letra cortada ao meio) no
  // PNG, enquanto a prévia termina em reticências — "texto comido" no download.
  // Correção: pro texto PURO (sem filhos-elemento) com nowrap+ellipsis que
  // realmente estoura, calculamos AQUI a substring que cabe com "…" (medida com
  // a MESMA fonte via canvas) e trocamos o texto SÓ NO CLONE de cada render —
  // o PNG sai com as mesmas reticências da prévia e nenhuma letra fatiada.
  const ellipEls: HTMLElement[] = [];
  const computeEllipsisShims = () => {
    const meas = document.createElement('canvas').getContext('2d');
    if (!meas) return;
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const kids = Array.from(el.childNodes);
      if (kids.some((n) => n.nodeType === 1)) return; // misto (emoji <img> etc.): fora
      const text = el.textContent || '';
      if (!text.trim()) return;
      const cs = getComputedStyle(el);
      if (cs.whiteSpace !== 'nowrap' || cs.textOverflow !== 'ellipsis') return;
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      meas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if (cs.letterSpacing !== 'normal') (meas as any).letterSpacing = cs.letterSpacing;
      const avail =
        el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const chars = Array.from(text); // por code point (não fatia emoji/acento)
      let lo = 0;
      let hi = chars.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const w = meas.measureText(chars.slice(0, mid).join('').replace(/\s+$/, '') + '…').width;
        if (w <= avail) lo = mid;
        else hi = mid - 1;
      }
      if (lo <= 0 || lo >= chars.length) return;
      el.dataset.fpEllip = chars.slice(0, lo).join('').replace(/\s+$/, '') + '…';
      ellipEls.push(el);
    });
  };
  const applyEllipsisInClone = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('[data-fp-ellip]').forEach((el) => {
      el.textContent = el.dataset.fpEllip || el.textContent;
    });
    // ── Line-clamp → caixa dura ──
    // O html2canvas NÃO entende `display:-webkit-box` + `-webkit-line-clamp`
    // (embaralha as linhas quando o texto estoura o clamp). No clone o bloco
    // vira block comum com a MESMA altura visível do DOM: as linhas quebram
    // igual (mesma formatação inline) e o corte fica na mesma posição — só o
    // "…" da última linha não sai (aceito).
    root.querySelectorAll<HTMLElement>('[data-fp-clamp]').forEach((el) => {
      el.style.display = 'block';
      (el.style as any).webkitLineClamp = 'unset';
      (el.style as any).webkitBoxOrient = 'unset';
      el.style.overflow = 'hidden';
      el.style.maxHeight = `${el.dataset.fpClamp}px`;
    });
  };
  const clampEls: HTMLElement[] = [];
  const computeClampShims = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (!cs.webkitLineClamp || cs.webkitLineClamp === 'none') return;
      if (!cs.display.includes('box')) return;
      el.dataset.fpClamp = String(el.clientHeight);
      clampEls.push(el);
    });
  };

  const applyCropGuards = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const clips =
        cs.overflowX === 'hidden' ||
        cs.overflowX === 'clip' ||
        cs.overflowY === 'hidden' ||
        cs.overflowY === 'clip';
      if (!clips) return;
      // O conteúdo CABE no layout? (scroll<=client) → o clip não corta NADA de layout.
      // Mesmo assim o html2canvas pode comer TINTA: a compensação vertical empurra o
      // glifo pra CIMA e, num container overflow:hidden de line-box justa (ex.: a faixa
      // de itens do menu dos sites), o TOPO das letras/acentos sai da caixa e é CORTADO
      // no PNG — "palavra comida" que não existe na prévia (que não tem a compensação).
      // Como cabe, overflow:visible é visualmente idêntico à prévia, só que sem o corte
      // do topo do glifo. Se ESTOURA de verdade (line-clamp/"…"/nome enorme), mantém o
      // clip. Vale pra QUALQUER container (texto direto OU filhos), não só folhas.
      const fits =
        el.scrollWidth <= el.clientWidth + 1 &&
        el.scrollHeight <= el.clientHeight + 1;
      if (!fits) return;
      // Máscara DELIBERADA de forma (avatar redondo, pílula, thumb arredondado) usa
      // border-radius grande pra recortar as QUINAS de uma mídia/fundo — desfazer o clip
      // revelaria os cantos. border-radius desprezível (≤2px) = clip incidental → seguro.
      const br = Math.max(
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderTopRightRadius) || 0,
        parseFloat(cs.borderBottomLeftRadius) || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
      );
      if (br > 2) return;
      const st = el.style;
      const prev = { o: st.overflow, ox: st.overflowX, oy: st.overflowY };
      st.overflow = 'visible';
      st.overflowX = 'visible';
      st.overflowY = 'visible';
      cropGuards.push(() => {
        st.overflow = prev.o;
        st.overflowX = prev.ox;
        st.overflowY = prev.oy;
      });
    });
  };

  let canvas: HTMLCanvasElement | null = null;
  let vcompCleanup: (() => void) | null = null;
  try {
    // Espera imagens (emojis do CDN, avatares, fotos) carregarem — senão saem
    // em branco no canvas.
    await Promise.all(
      Array.from(node.querySelectorAll('img')).map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener('load', () => res(), { once: true });
              img.addEventListener('error', () => res(), { once: true });
            }),
      ),
    );
    await new Promise((r) => setTimeout(r, 60));

    computeEllipsisShims();
    computeClampShims();
    applyCropGuards();
    applyGapShims();
    wrapMixedText();

    // ── Compensação do bug de CENTRALIZAÇÃO VERTICAL do html2canvas ──
    // O html2canvas desenha TEXTO verticalmente centralizado BAIXO demais (ancora o
    // glifo perto do fundo da caixa): chip de 1 linha centralizado por flex
    // `align-items:center` OU manchete multi-linha (FitText) sai deslocado pra baixo
    // no PNG — no navegador fica no centro. (Bolha de chat NÃO sofre: flui do topo.)
    // O erro é grande (medido: +6 a +13px) e cresce com a fonte, então NÃO dá pra
    // acertar por fórmula.
    //
    // Correção por CALIBRAÇÃO MEDIDA (zero número mágico): 2 renders de sondagem —
    // A (cru) e B (mesma árvore com a TINTA escondida, `color:transparent`). O DIFF
    // A−B ISOLA a tinta de cada alvo e CANCELA os fundos, inclusive uma banda de MESMA
    // cor que o texto (ex.: ticker preto embaixo de manchete preta — que enganava o
    // scan antigo). Medimos onde a tinta de CADA alvo caiu vs onde o navegador a
    // centraliza, gravamos o erro exato em data-fp-vcal, e o render FINAL sobe o glifo
    // por translateY(−erro), só no clone (a prévia não muda). Texto que o html2canvas
    // já acerta mede ~0 → não é tocado (auto-limitado). Em fonte maiúscula o
    // centro-da-tinta ≈ centro-do-range (δ≈0 pela métrica da Inter), então alvejar o
    // centro do range casa com a prévia.
    const baseW = refW ?? node.getBoundingClientRect().width;
    const scale = targetW / baseW;
    const nodeRect = node.getBoundingClientRect();

    // ALVOS = folhas de texto horizontais e não-transformadas. `stops` = contextos
    // onde o translateY vertical não vale (writing-mode VERTICAL ou TRANSFORM — eixo
    // errado). Coluna flex NÃO é stop: o wrap num <span> inline-block move só o glifo,
    // não colapsa a coluna. `mode` decide como o render final sobe o glifo:
    //  • 'fit'    → manchete FitText: translateY DIRETO (sem fundo, não re-quebra);
    //  • 'block'  → multi-linha comum: <span> display:block (preserva a quebra);
    //  • 'inline' → chip de 1 linha: <span> inline-block (fundo/pílula fica no lugar).
    // `suspicious` (multi-linha, banda align-center, ou line-box folgado) decide se
    // vale a pena pagar a sondagem; medimos TODOS os alvos, mas texto que o html2canvas
    // já acerta mede ~0 e não é tocado.
    type VMode = 'fit' | 'block' | 'inline';
    type VTarget = { el: HTMLElement; cx0: number; cx1: number; cy: number; half: number; up: number; down: number; multi: boolean; mode: VMode };
    const targets: VTarget[] = [];
    // pais de FLUXO INLINE MISTO multi-linha — compensados como BLOCO (ver abaixo)
    const flowParents = new Set<HTMLElement>();
    const flowTargets: VTarget[] = [];
    let anySuspicious = false;
    const allEls = Array.from(node.querySelectorAll<HTMLElement>('*'));
    const bands = new Set<HTMLElement>();
    const stops = new Set<HTMLElement>();
    // Um transform SÓ atrapalha a compensação vertical se mexe no eixo Y do glifo —
    // rotação, skewY ou flip (matriz com b≠0 ou d≠1). skewX/translate/scaleX preservam
    // o eixo vertical: o translateY(−erro) continua subindo reto (num par
    // skewX(-θ)/skewX(θ) — banner paralelogramo — os cisalhamentos ainda se cancelam).
    const axisUnsafeTf = (tf: string): boolean => {
      if (!tf || tf === 'none') return false;
      const mm = /matrix\(([^)]+)\)/.exec(tf);
      if (!mm) return true; // matrix3d/desconhecido → não arrisca
      const p = mm[1].split(',').map((v) => parseFloat(v));
      return Math.abs(p[1]) > 0.02 || Math.abs(p[3] - 1) > 0.02;
    };
    for (const a of allEls) {
      const cs = getComputedStyle(a);
      const isFlex = cs.display.includes('flex');
      const isCol = isFlex && (cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse');
      const vertical = cs.writingMode !== 'horizontal-tb';
      if (vertical || axisUnsafeTf(cs.transform)) stops.add(a);
      if (vertical) continue;
      if ((isFlex || cs.display.includes('grid')) && !isCol && cs.alignItems === 'center') bands.add(a);
    }
    for (const el of allEls) {
      const kids = Array.from(el.childNodes);
      if (kids.some((n) => n.nodeType === 1)) continue; // só FOLHAS
      if (!kids.some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.writingMode !== 'horizontal-tb') continue;
      if (axisUnsafeTf(cs.transform)) continue;
      // dentro de um stop (vertical/rotação/skewY)? → eixo errado, pula.
      let inStop = false;
      for (let a: HTMLElement | null = el.parentElement; a && a !== node.parentElement; a = a.parentElement) {
        if (stops.has(a)) { inStop = true; break; }
      }
      if (inStop) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const gr = range.getBoundingClientRect();
      if (!gr.height || gr.width < 3) continue;
      const fs = parseFloat(cs.fontSize) || 14;
      // FLUXO INLINE MISTO que quebra em VÁRIAS linhas (comentário do IG com @menção/
      // #hashtag/emoji no meio; legenda de post): o pai tem 2+ pedaços de texto inline
      // FLUINDO e quebrando de linha. Deslocar cada pedaço por conta própria (cada um com
      // erro medido diferente) EMBARALHA o texto no PNG. A peça NÃO vira alvo — em vez
      // disso o PAI vira um alvo de BLOCO (flow-block, abaixo): o html2canvas desenha o
      // fluxo inteiro ~8px BAIXO como unidade (medido no bloco de Comentários — o corpo
      // descia e "colava" na linha do Responder), então medimos a tinta do BLOCO inteiro
      // com um render de sonda DEDICADO (sem paridade compartilhada — foi a poluição que
      // inviabilizou compensar por peça) e subimos o PAI inteiro: nada embaralha.
      const par = el.parentElement;
      if (par) {
        let inlinePieces = 0;
        for (const n of Array.from(par.childNodes)) {
          if (n.nodeType === 3) { if ((n.textContent || '').trim()) inlinePieces++; }
          else if (n.nodeType === 1) {
            const dd = getComputedStyle(n as HTMLElement).display;
            if (dd.startsWith('inline') && (n.textContent || '').trim()) inlinePieces++;
          }
        }
        if (inlinePieces >= 2) {
          const plh = parseFloat(getComputedStyle(par).lineHeight) || fs * 1.35;
          if (par.getBoundingClientRect().height > plh * 1.6) { flowParents.add(par); continue; }
        }
      }
      const multi = gr.height > fs * 1.6;
      // MULTI-LINHA: medir o ENVELOPE do bloco falha quando a ÚLTIMA linha é
      // CURTA ("… MAS NÃO\nSÃO!"): a tinta dela não vence o threshold por linha
      // (5% da largura do bloco) e a sonda só enxerga a linha 1 — cujo centro
      // DESLOCADO cai em cima do centro do bloco → erro medido ≈ 0 e a manchete
      // sai ~8-10px BAIXA no PNG (cortada pelo ticker; bug real da CNN 16.07).
      // Correção: mirar a LINHA MAIS LARGA do bloco (rects do range) e medi-la
      // como um chip (banda de tinta mais próxima). O h2c desloca o bloco
      // INTEIRO por igual (medido: linha 1 +28px, linha 2 +27px de export),
      // então o erro de UMA linha vale pro bloco todo.
      let mr = gr;
      if (multi) {
        const lrs = Array.from(range.getClientRects()).filter((r) => r.height > 2 && r.width > 3);
        if (lrs.length) mr = lrs.reduce((a, b) => (b.width > a.width ? b : a));
      }
      const fit = el.hasAttribute('data-fp-fit');
      let band = false;
      for (let i = 0, a: HTMLElement | null = el; i < 6 && a; i++, a = a.parentElement) {
        if (bands.has(a) && a.getBoundingClientRect().height - gr.height > 3) { band = true; break; }
      }
      const slack = gr.height > fs * 1.2; // line-box mais alto que o glifo → centraliza
      const suspicious = multi || band || slack;
      if (suspicious) anySuspicious = true;
      const mode: VMode = fit ? 'fit' : multi ? 'block' : 'inline';
      // Janela de medição ASSIMÉTRICA: o erro do html2canvas é sempre pra BAIXO, então
      // sobra pouca margem pra cima (evita capturar a tinta do alvo de cima) e mais
      // pra baixo (cobre o deslocamento). Multi-linha mira a LINHA-ALVO (mr);
      // chip de 1 linha usa ±22 (não alcança vizinho empilhado ~24px).
      const half = mr.height / 2;
      targets.push({
        el,
        cx0: (mr.left - nodeRect.left) * scale,
        cx1: (mr.right - nodeRect.left) * scale,
        cy: ((mr.top + mr.bottom) / 2 - nodeRect.top) * scale,
        half: half * scale,
        up: Math.round((multi ? half + 6 : 22) * scale),
        down: Math.round((multi ? half + 22 : 22) * scale),
        multi,
        mode,
      });
    }

    // ALVOS DE BLOCO (flow-block): o pai do fluxo misto vira UM alvo — a tinta do
    // bloco inteiro é medida contra um render que esconde SÓ os flow-blocks (tudo o
    // mais aparece nos dois renders e se CANCELA no diff, inclusive a linha do
    // username logo acima — a poluição que estragava a medição por peça). O erro vale
    // pro bloco todo, então subir o PAI preserva quebra, espaçamento e emojis.
    for (const par of flowParents) {
      // ANINHADO: se um pai de fluxo está DENTRO de outro (legenda inteira +
      // span interno da legenda), só o MAIS EXTERNO vira alvo — dois translateY
      // COMPÕEM no clone e o texto interno deslocaria 2× (sobreposição).
      let nested = false;
      for (const other of flowParents) {
        if (other !== par && other.contains(par)) { nested = true; break; }
      }
      if (nested) continue;
      const csP = getComputedStyle(par);
      if (csP.writingMode !== 'horizontal-tb' || axisUnsafeTf(csP.transform)) continue;
      let inStop = false;
      for (let a: HTMLElement | null = par.parentElement; a && a !== node.parentElement; a = a.parentElement) {
        if (stops.has(a)) { inStop = true; break; }
      }
      if (inStop) continue;
      const range = document.createRange();
      range.selectNodeContents(par);
      const gr = range.getBoundingClientRect();
      if (!gr.height || gr.width < 3) continue;
      // conteúdo CLIPADO (o texto estoura o palco OU QUALQUER ancestral com
      // overflow que corte): a tinta visível não representa o range inteiro →
      // a medição sairia errada e o deslocamento embaralharia (foi o caso da
      // legenda do IG Post estressada, clipada pelo card interno). Fica como
      // está — o clip é o MESMO da prévia.
      let clipped = gr.bottom > nodeRect.bottom - 2 || gr.top < nodeRect.top + 2;
      if (!clipped) {
        for (let a: HTMLElement | null = par; a && a !== node.parentElement; a = a.parentElement) {
          const csA = getComputedStyle(a);
          if (/hidden|clip|auto|scroll/.test(csA.overflowY) || /hidden|clip|auto|scroll/.test(csA.overflowX)) {
            const ar = a.getBoundingClientRect();
            if (gr.bottom > ar.bottom + 1 || gr.top < ar.top - 1) { clipped = true; break; }
          }
        }
      }
      if (clipped) continue;
      par.dataset.fpFlow = '1';
      const half = gr.height / 2;
      flowTargets.push({
        el: par,
        cx0: (gr.left - nodeRect.left) * scale,
        cx1: (gr.right - nodeRect.left) * scale,
        cy: ((gr.top + gr.bottom) / 2 - nodeRect.top) * scale,
        half: half * scale,
        up: Math.round((half + 6) * scale),
        down: Math.round((half + 22) * scale),
        multi: true,
        mode: 'fit',
      });
    }

    // Aperta a janela de cada alvo nos VIZINHOS que sobrepõem em X (empilhados):
    // a tinta de um não pode invadir a caixa do outro (ex.: sub-linha logo abaixo da
    // manchete; "bem"/"estar" empilhados de um logo). Como o erro é pra baixo, deixo
    // pouca folga pra CIMA (perto do vizinho de cima) e cubro o deslocamento pra baixo.
    const allTargets = [...targets, ...flowTargets];
    for (const t of allTargets) {
      let above = -Infinity;
      let below = Infinity;
      for (const o of allTargets) {
        if (o === t) continue;
        if (o.cx1 <= t.cx0 + 2 || o.cx0 >= t.cx1 - 2) continue; // sem sobreposição em X
        if (o.cy < t.cy) above = Math.max(above, o.cy + o.half * 0.5);
        else if (o.cy > t.cy) below = Math.min(below, o.cy - o.half * 0.5);
      }
      const m = 3 * scale;
      if (above > -Infinity) t.up = Math.min(t.up, Math.max(4 * scale, t.cy - above - m));
      if (below < Infinity) t.down = Math.min(t.down, Math.max(t.half + 4 * scale, below - t.cy - m));
    }

    vcompCleanup = () => [...targets, ...flowTargets].forEach((t) => {
      delete t.el.dataset.fpVcal;
      delete t.el.dataset.fpVmode;
      delete t.el.dataset.fpCal0;
      delete t.el.dataset.fpCal1;
      delete t.el.dataset.fpBg;
      delete t.el.dataset.fpPt;
      delete t.el.dataset.fpPb;
      delete t.el.dataset.fpFlow;
    });

    // MOTOR: html2canvas — RÁPIDO e usa a fonte JÁ CARREGADA na página, então a fonte
    // bate com a prévia. Os motores foreignObject (snapdom) sairiam pixel-a-pixel mas
    // no cache frio levam 40-77s — inviável. O erro de centralização é corrigido pela
    // calibração medida abaixo.
    const { default: html2canvas } = await import('html2canvas');
    const h2cOpts = {
      scale,
      backgroundColor: null as string | null,
      useCORS: true,
      logging: false,
      imageTimeout: 20000,
    };

    // SONDAGEM (só se há alvo SUSPEITO). XADREZ por cy: ordenamos os alvos pela altura
    // e damos PARIDADE alternada (0,1,0,1…). Renders:
    //  • rawCanvas = tudo visível (posição CRUA do html2canvas);
    //  • hid0/hid1 = escondem a tinta dos alvos de paridade 0 / 1.
    // Cada alvo é medido contra o render que esconde a SUA paridade → ele aparece no
    // diff, mas os VIZINHOS verticais (paridade oposta) ficam visíveis e CANCELAM. Isola
    // até alvos empilhados e de tinta contígua (ex.: "bem"/"estar" de um logo; sub-linha
    // colada na manchete) que uma janela não separaria. Sequencial (o html2canvas clona
    // o nó num iframe — evita corrida entre clones simultâneos).
    const needLeafProbe = targets.length > 0 && anySuspicious;
    if (needLeafProbe || flowTargets.length) {
      const byCy = [...targets].sort((a, b) => a.cy - b.cy);
      const par = new Map<VTarget, number>();
      byCy.forEach((t, i) => par.set(t, i % 2));
      targets.forEach((t) => { t.el.dataset[par.get(t) === 0 ? 'fpCal0' : 'fpCal1'] = '1'; });
      const hideSel = (sel: string) => (_doc: Document, root: HTMLElement) => {
        root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
          el.style.color = 'transparent';
          el.style.textShadow = 'none';
          el.style.setProperty('-webkit-text-fill-color', 'transparent');
        });
      };
      const rawCanvas = await html2canvas(node, {
        ...h2cOpts,
        onclone: (_d: Document, root: HTMLElement) => { applyEllipsisInClone(root); onCloneExtra?.(root); },
      });
      const hid0Canvas = needLeafProbe ? await html2canvas(node, {
        ...h2cOpts,
        onclone: (d: Document, root: HTMLElement) => { applyEllipsisInClone(root); onCloneExtra?.(root); hideSel('[data-fp-cal0]')(d, root); },
      }) : null;
      const hid1Canvas = needLeafProbe ? await html2canvas(node, {
        ...h2cOpts,
        onclone: (d: Document, root: HTMLElement) => { applyEllipsisInClone(root); onCloneExtra?.(root); hideSel('[data-fp-cal1]')(d, root); },
      }) : null;
      // render dedicado dos FLOW-BLOCKS: esconde só eles (e seus pedaços coloridos);
      // todo o resto aparece igual nos dois renders e se cancela no diff.
      const hidFlowCanvas = flowTargets.length ? await html2canvas(node, {
        ...h2cOpts,
        onclone: (d: Document, root: HTMLElement) => { applyEllipsisInClone(root); onCloneExtra?.(root); hideSel('[data-fp-flow], [data-fp-flow] *')(d, root); },
      }) : null;
      targets.forEach((t) => { delete t.el.dataset.fpCal0; delete t.el.dataset.fpCal1; });
      const ra = rawCanvas.getContext('2d');
      const c0 = hid0Canvas ? hid0Canvas.getContext('2d') : null;
      const c1 = hid1Canvas ? hid1Canvas.getContext('2d') : null;
      const cf = hidFlowCanvas ? hidFlowCanvas.getContext('2d') : null;
      if (ra && c0 && c1) {
        const CW = rawCanvas.width;
        const CH = rawCanvas.height;
        for (const t of targets) {
          const hb = par.get(t) === 0 ? c0 : c1;
          const x0 = Math.max(0, Math.round(t.cx0 + 1));
          const x1 = Math.min(CW, Math.round(t.cx1 - 1));
          if (x1 - x0 < 3) continue;
          const y0 = Math.max(0, Math.round(t.cy - t.up));
          const y1 = Math.min(CH, Math.round(t.cy + t.down));
          if (y1 - y0 < 3) continue;
          const cols = x1 - x0;
          const rows = y1 - y0;
          const A = ra.getImageData(x0, y0, cols, rows).data;
          const B = hb.getImageData(x0, y0, cols, rows).data;
          const thr = Math.max(2, cols * 0.05);
          // hit[y] = a linha y tem tinta (A difere de B = fundo)?
          const on: boolean[] = new Array(rows);
          for (let y = 0; y < rows; y++) {
            let cnt = 0;
            for (let x = 0; x < cols; x++) {
              const i = (y * cols + x) * 4;
              const d = Math.max(
                Math.abs(A[i] - B[i]),
                Math.abs(A[i + 1] - B[i + 1]),
                Math.abs(A[i + 2] - B[i + 2]),
              );
              if (d > 40) cnt++;
            }
            on[y] = cnt >= thr;
          }
          // BANDA contígua de tinta mais PERTO do centro esperado (a própria tinta
          // do alvo — todos deslocam pra baixo de forma parecida, então a própria
          // fica mais perto que qualquer vizinha). Vale pro CHIP de 1 linha E pra
          // LINHA-ALVO do multi-linha (a linha mais larga do bloco): as OUTRAS
          // linhas do mesmo bloco viram bandas separadas (têm vão de tinta entre
          // linhas) e mais distantes do centro esperado — não poluem.
          let mid: number | null = null;
          {
            // 1) coleta as bandas contíguas de tinta
            const bandList: Array<[number, number]> = [];
            let s = -1;
            for (let y = 0; y <= rows; y++) {
              const hit = y < rows && on[y];
              if (hit && s < 0) s = y;
              if (!hit && s >= 0) { bandList.push([y0 + s, y0 + y - 1]); s = -1; }
            }
            // 2) FUNDE bandas separadas por vão MINÚSCULO (≤2px CSS): anti-aliasing
            //    parte a tinta de um glifo em lasquinhas ("Economia" media [139,141]+
            //    [143,157]) e a lasquinha de cima ganhava por proximidade → correção
            //    saía pela METADE e o item afundava vs os vizinhos (bug da Folha).
            //    Linhas de texto DISTINTAS têm vão real ≥5px CSS — não fundem.
            const gapMax = Math.max(2, Math.round(2 * scale));
            const merged: Array<[number, number]> = [];
            for (const b of bandList) {
              const last = merged[merged.length - 1];
              if (last && b[0] - last[1] - 1 <= gapMax) last[1] = b[1];
              else merged.push([b[0], b[1]]);
            }
            // 3) banda mais próxima do centro esperado, com viés pra BAIXO:
            //    o erro do h2c é SEMPRE pra baixo, então banda bem ACIMA do centro
            //    é vizinho/linha-de-cima deslocada — nunca o alvo (aceitá-la
            //    inverteria a correção e afundaria o texto).
            let best: { mid: number; dist: number } | null = null;
            for (const [b0, b1] of merged) {
              const m = (b0 + b1) / 2;
              const dist = Math.abs(m - t.cy);
              if (m >= t.cy - 5 * scale && (!best || dist < best.dist)) best = { mid: m, dist };
            }
            if (best) mid = best.mid;
          }
          if (mid == null) continue;
          const err = (mid - t.cy) / scale; // + = html2canvas baixo demais
          // Cap de 16px (blindagem anti-embaralho): TODOS os erros REAIS já
          // medidos ficam em 6-13px; acima de 16px é janela poluída (com texto
          // fora do limite da UI, p.ex.) e a correção deslocaria ~1 linha.
          if (Math.abs(err) > 0.3 && Math.abs(err) <= 16) {
            t.el.dataset.fpVcal = String(Math.round(err * 100) / 100);
            t.el.dataset.fpVmode = t.mode;
            // Elemento com FUNDO PRÓPRIO (caixa da caixinha "Faça uma pergunta", balão
            // multi-linha)? Guardamos o padding: no render final subimos o TEXTO
            // redistribuindo o padding (caixa+fundo ficam), em vez de mover o elemento
            // inteiro (que deslocaria o fundo e, num overflow:hidden, encurtaria a caixa).
            const csb = getComputedStyle(t.el);
            const bgc = csb.backgroundColor;
            const bm = bgc.match(/rgba?\(([^)]+)\)/);
            const bgOpaque = !!bgc && bgc !== 'transparent' && (!bm || bm[1].split(',').length < 4 || parseFloat(bm[1].split(',')[3]) > 0.05);
            const bgImg = csb.backgroundImage && csb.backgroundImage !== 'none';
            if (bgOpaque || bgImg) {
              t.el.dataset.fpBg = '1';
              t.el.dataset.fpPt = String(parseFloat(csb.paddingTop) || 0);
              t.el.dataset.fpPb = String(parseFloat(csb.paddingBottom) || 0);
            }
          }
        }
      }

      // FLOW-BLOCKS: mede a caixa de tinta do bloco INTEIRO (1ª→última linha) contra
      // o render que esconde só os flow-blocks; o erro sobe o PAI como unidade.
      if (ra && cf) {
        const CW = rawCanvas.width;
        const CH = rawCanvas.height;
        for (const t of flowTargets) {
          const x0 = Math.max(0, Math.round(t.cx0 + 1));
          const x1 = Math.min(CW, Math.round(t.cx1 - 1));
          if (x1 - x0 < 3) continue;
          const y0 = Math.max(0, Math.round(t.cy - t.up));
          const y1 = Math.min(CH, Math.round(t.cy + t.down));
          if (y1 - y0 < 3) continue;
          const cols = x1 - x0;
          const rows = y1 - y0;
          const A = ra.getImageData(x0, y0, cols, rows).data;
          const B = cf.getImageData(x0, y0, cols, rows).data;
          // 3% (não 5%): a última linha do fluxo costuma ser curta em relação à
          // largura do bloco e ainda precisa contar como tinta.
          const thr = Math.max(2, cols * 0.03);
          let minY = -1;
          let maxY = -1;
          for (let y = 0; y < rows; y++) {
            let cnt = 0;
            for (let x = 0; x < cols; x++) {
              const i = (y * cols + x) * 4;
              const d = Math.max(
                Math.abs(A[i] - B[i]),
                Math.abs(A[i + 1] - B[i + 1]),
                Math.abs(A[i + 2] - B[i + 2]),
              );
              if (d > 40) cnt++;
            }
            if (cnt >= thr) {
              if (minY < 0) minY = y;
              maxY = y;
            }
          }
          if (minY < 0) continue;
          // SANIDADE da medição (blindagem anti-embaralho): a caixa de tinta
          // medida tem que ter ~a altura do range do bloco — muito menor/maior
          // significa tinta parcial (clip/vizinho poluindo) e a correção sairia
          // errada. E o erro REAL do html2canvas em fluxo é ~7-9px; acima de
          // 12px é medição podre (deslocaria ~1 linha e EMBARALHARIA) → pula.
          const inkH = maxY - minY;
          const rangeH = t.half * 2;
          if (inkH < rangeH * 0.55 || inkH > rangeH * 1.3) continue;
          const err = (y0 + (minY + maxY) / 2 - t.cy) / scale; // + = fluxo baixo demais
          // Piso de 2.5px: a assimetria natural ascendente/descendente da tinta multi-
          // linha (~1-2px) não é erro do html2canvas — só o desvio GRANDE do fluxo
          // (medido ~8px no bloco de Comentários) merece correção.
          if (Math.abs(err) > 2.5 && Math.abs(err) <= 12) {
            // FUNDO próprio no bloco de fluxo: mover o pai deslocaria o fundo (e o
            // contra-shift das imagens não cobre isso) — caso raro, fica como está.
            const csb = getComputedStyle(t.el);
            const bgc = csb.backgroundColor;
            const bm = bgc.match(/rgba?\(([^)]+)\)/);
            const bgOpaque = !!bgc && bgc !== 'transparent' && (!bm || bm[1].split(',').length < 4 || parseFloat(bm[1].split(',')[3]) > 0.05);
            const bgImg = csb.backgroundImage && csb.backgroundImage !== 'none';
            if (bgOpaque || bgImg) continue;
            t.el.dataset.fpVcal = String(Math.round(err * 100) / 100);
            t.el.dataset.fpVmode = 'fit';
          }
        }
      }
    }

    // RENDER FINAL — sobe o glifo de cada alvo por translateY(−erro), só no clone
    // (a prévia não muda). Por modo:
    //  • 'fit'    → translateY DIRETO no FitText (sem fundo próprio, não re-quebra);
    //  • 'block'  → <span> display:block com translateY (multi-linha comum: preserva
    //               a quebra e mantém o fundo do pai);
    //  • 'inline' → <span> inline-block com translateY (chip 1 linha: pílula/fundo
    //               próprio fica onde o html2canvas já acerta, sobe só o glifo).
    canvas = await html2canvas(node, {
      ...h2cOpts,
      onclone: (doc: Document, root: HTMLElement) => {
        applyEllipsisInClone(root);
        onCloneExtra?.(root);
        root.querySelectorAll<HTMLElement>('[data-fp-vcal]').forEach((el) => {
          const dy = parseFloat(el.dataset.fpVcal || '');
          if (!Number.isFinite(dy) || dy === 0) return;
          const mode = el.dataset.fpVmode || 'inline';
          // FLOW-BLOCK (fluxo inline misto multi-linha): o TEXTO do fluxo é que sai
          // baixo — as IMAGENS (emojis) o html2canvas já posiciona certo. Sobe o PAI
          // inteiro (texto+quebra preservados) e CONTRA-DESLOCA as imagens de volta.
          if (el.dataset.fpFlow === '1') {
            el.style.transform = `translateY(${-dy}px)`;
            el.querySelectorAll<HTMLElement>('img, svg').forEach((im) => {
              im.style.transform = `translateY(${dy}px)`;
            });
            return;
          }
          if (mode === 'fit' || mode === 'block') {
            // ELEMENTO COM FUNDO PRÓPRIO (caixa da caixinha "Faça uma pergunta"/caixa
            // branca, balão multi-linha): NÃO move o elemento (deslocaria o fundo — que o
            // html2canvas já desenha certo — e num overflow:hidden o corte ENCURTA a
            // caixa; foi o bug da Caixinha). REDISTRIBUI o padding vertical: sobe o TEXTO
            // `dy` mantendo a MESMA altura de caixa e o fundo no lugar. Sem re-quebra
            // (padding não muda a largura). Só quando dy>0 (subir) e o paddingTop absorve.
            if (el.dataset.fpBg === '1' && dy > 0) {
              const pt = parseFloat(el.dataset.fpPt || '0');
              const pb = parseFloat(el.dataset.fpPb || '0');
              const shift = Math.min(pt, dy);
              el.style.paddingTop = `${pt - shift}px`;
              el.style.paddingBottom = `${pb + shift}px`;
              // resto raríssimo (dy > paddingTop) → o pouco que sobra via translateY
              if (dy - shift > 0.3) el.style.transform = `translateY(${-(dy - shift)}px)`;
              return;
            }
            // sem fundo próprio (manchete de telejornal etc.) → translateY DIRETO no
            // elemento: não re-quebra o texto e não há fundo pra deslocar.
            el.style.transform = `translateY(${-dy}px)`;
            return;
          }
          // chip de 1 linha (tag/LIVE/hora) → envolve só o TEXTO num <span> inline-block
          // e sobe o glifo; a pílula/fundo do elemento fica onde o html2canvas já acerta.
          const span = doc.createElement('span');
          span.style.display = 'inline-block';
          span.style.transform = `translateY(${-dy}px)`;
          while (el.firstChild) span.appendChild(el.firstChild);
          el.appendChild(span);
        });
      },
    });
  } finally {
    cropGuards.forEach((restore) => restore());
    gapShims.forEach((restore) => restore());
    if (vcompCleanup) vcompCleanup();
    textUnwrap.forEach((restore) => restore());
    ellipEls.forEach((el) => { delete el.dataset.fpEllip; });
    clampEls.forEach((el) => { delete el.dataset.fpClamp; });
    if (zoomEl) zoomEl.style.zoom = prevZoom;
  }

  if (!canvas) throw new Error('export vazio');
  return canvas;
}

/**
 * Rasteriza um nó em PNG e dispara o download. Fino wrapper sobre
 * `renderNodeToCanvas`; usa Object URL (data URL trunca arquivo grande).
 */
export async function downloadNodeAsPng(
  node: HTMLElement,
  filename: string,
  targetW: number,
  refW?: number,
) {
  const canvas = await renderNodeToCanvas(node, targetW, refW);
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b: Blob | null) => res(b), 'image/png'),
  );
  if (!blob) throw new Error('export vazio');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ─────────────────────── Ícones da StatusBar ─────────────────────── */

function SignalBars({ n, color }: { n: number; color: string }) {
  // 4 barras crescentes; as (n) primeiras acesas.
  const hs = [4, 7, 10, 13];
  return (
    <svg width="17" height="13" viewBox="0 0 17 13" fill="none" aria-hidden>
      {hs.map((h, i) => (
        <rect
          key={i}
          x={i * 4.3}
          y={13 - h}
          width="3"
          height={h}
          rx="0.8"
          fill={color}
          opacity={i < n ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

function WifiGlyph({ color }: { color: string }) {
  // A TINTA (arcos+ponto) precisa ficar CENTRADA no viewBox: os arcos originais
  // ocupavam y2.2–11.9 (centro 7.05) e o flex `align-items:center` alinha a CAIXA,
  // então o wifi saía ~1px ABAIXO do eixo do sinal/bateria (medido no PNG). O
  // transform recentra a tinta em y=6 e amplia 13% pra casar com a altura dos
  // ícones vizinhos, igual ao iOS.
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
      <g transform="translate(8 6) scale(1.13) translate(-8 -7.05)">
        <path
          d="M8 2.2c2.6 0 5 1 6.8 2.7l-1.5 1.6A7.6 7.6 0 0 0 8 4.3 7.6 7.6 0 0 0 2.7 6.5L1.2 4.9A9.8 9.8 0 0 1 8 2.2Z"
          fill={color}
        />
        <path
          d="M8 6.1c1.5 0 2.9.6 3.9 1.6l-1.6 1.6A2.9 2.9 0 0 0 8 8.4c-.9 0-1.7.4-2.3 1L4.1 7.7A5.5 5.5 0 0 1 8 6.1Z"
          fill={color}
        />
        <circle cx="8" cy="10.6" r="1.3" fill={color} />
      </g>
    </svg>
  );
}

function BatteryGlyph({
  level,
  charging,
  color,
}: {
  level: number;
  charging: boolean;
  color: string;
}) {
  const lvl = Math.max(0, Math.min(100, level));
  const w = (lvl / 100) * 18;
  const fill = lvl <= 20 ? '#ff453a' : color;
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="22"
        height="12"
        rx="3"
        stroke={color}
        strokeOpacity="0.4"
      />
      <rect x="2" y="2" width={w} height="9" rx="1.6" fill={fill} />
      <rect x="24" y="4" width="2.2" height="5" rx="1.1" fill={color} opacity="0.5" />
      {charging ? (
        <path d="M12 2l-3 5h2.2l-.6 4 3.4-5.4h-2.3L12 2z" fill="#34c759" />
      ) : null}
    </svg>
  );
}

/* ─────────────────────────── StatusBar ─────────────────────────── */

/**
 * Barra de status realista. `tone` = cor do texto/ícones (dark p/ fundo claro,
 * light p/ fundo escuro). Altura ~44px (iOS) / ~28px (Android), escalável via
 * `scale` (o palco é fixo, mas modelos maiores podem crescer a barra).
 */
export function StatusBar({
  cfg,
  tone = 'dark',
  scale = 1,
  leftOverride,
}: {
  cfg: StatusCfg;
  tone?: 'dark' | 'light';
  scale?: number;
  /** Sobrescreve o texto à esquerda (ex.: operadora no lockscreen, onde a hora
   *  já aparece no relógio grande). */
  leftOverride?: string;
}) {
  const color = tone === 'light' ? '#ffffff' : '#000000';
  const ios = cfg.os === 'ios';
  const h = (ios ? 44 : 28) * scale;
  const fs = (ios ? 15 : 13) * scale;

  const right = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 * scale }}>
      {cfg.airplane ? (
        <span style={{ fontSize: fs, color }}>✈</span>
      ) : (
        <>
          {cfg.network && !ios ? (
            // top 0.07em: a tinta do "5G" (maiúsculas, sem descendente) fica alta
            // dentro da line-box; o nudge desce o glifo pro eixo óptico dos ícones
            // (medido no PNG: 5G ficava ~1px acima do centro do sinal/bateria).
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600, position: 'relative', top: '0.07em' }}>
              {cfg.network}
            </span>
          ) : null}
          <SignalBars n={cfg.signal} color={color} />
          {cfg.network && ios ? (
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600, position: 'relative', top: '0.07em' }}>
              {cfg.network}
            </span>
          ) : null}
          {cfg.wifi ? <WifiGlyph color={color} /> : null}
        </>
      )}
      {!ios ? (
        <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
          {Math.round(cfg.battery)}%
        </span>
      ) : null}
      <BatteryGlyph level={cfg.battery} charging={cfg.charging} color={color} />
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: h,
        padding: `0 ${(ios ? 26 : 16) * scale}px`,
        color,
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        flexShrink: 0,
        // line-height 1 (o palco é line-height:0): dá ALTURA ao texto (hora, 5G, %)
        // pra centralizar com os ícones. A barra tem altura FIXA, então isso NÃO
        // empurra o conteúdo abaixo — zero drift no download.
        lineHeight: 1,
      }}
    >
      <div
        style={{
          fontSize: fs,
          fontWeight: ios ? 600 : 500,
          letterSpacing: ios ? '0.01em' : 0,
          /* tabular-nums REMOVIDO: h2c posiciona segmentos com métrica tabular do DOM mas desenha proporcional → vão no meio do texto (11 :20) */
        }}
      >
        {leftOverride !== undefined ? leftOverride : ios ? cfg.time : `${cfg.carrier ? cfg.carrier + '  ' : ''}${cfg.time}`}
      </div>
      {right}
    </div>
  );
}

/* ─────────────────────── Controles (primitivos) ─────────────────────── */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
};

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-text-muted" style={{ ...LBL, fontFamily: 'var(--font-tech)' }}>
        {label}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-text-dim">{hint}</p> : null}
    </label>
  );
}

/** Botãozinho 😊 que abre o seletor de emoji e insere no fim do valor. */
function EmojiInsert({ value, onChange, top }: { value: string; onChange: (v: string) => void; top?: boolean }) {
  return (
    <span className={'absolute right-1.5 ' + (top ? 'top-1.5' : 'top-1/2 -translate-y-1/2')}>
      <EmojiPickerButton align="right" onPick={(e) => onChange(value + e)} className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim transition hover:bg-white/10 hover:text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>
      </EmojiPickerButton>
    </span>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength,
  withEmoji,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  withEmoji?: boolean;
}) {
  const input = (
    <input
      type="text"
      className={'input-field' + (withEmoji ? ' !pr-9' : '')}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (!withEmoji) return input;
  return (
    <div className="relative">
      {input}
      <EmojiInsert value={value} onChange={onChange} />
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 3,
  withEmoji,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  withEmoji?: boolean;
}) {
  const area = (
    <textarea
      className={'input-field resize-y leading-relaxed' + (withEmoji ? ' !pr-9' : '')}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (!withEmoji) return area;
  return (
    <div className="relative">
      {area}
      <EmojiInsert value={value} onChange={onChange} top />
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between rounded-[12px] border border-line-strong bg-bg-soft/40 px-3.5 py-2.5 text-left transition hover:border-violet/40"
    >
      <span className="text-[13px] font-semibold text-white">{label}</span>
      <span
        className={
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ' +
          (on ? 'bg-violet' : 'bg-line-strong')
        }
      >
        <span
          className="inline-block rounded-full bg-white shadow transition-transform duration-200"
          style={{ height: 18, width: 18, transform: on ? 'translateX(22px)' : 'translateX(3px)' }}
        />
      </span>
    </button>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-text-muted" style={{ ...LBL, fontFamily: 'var(--font-tech)' }}>
          {label}
        </span>
        <span className="text-[12px] font-semibold text-white" style={{ fontFamily: 'var(--font-mono)' }}>
          {display ? display(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              'rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200 active:scale-[0.97] ' +
              (active
                ? 'border-violet/65 bg-violet/15 text-white'
                : 'border-line-strong text-text-muted hover:border-violet hover:text-white')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Swatches({
  value,
  colors,
  onChange,
}: {
  value: string;
  colors: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={
              'h-9 w-9 rounded-full border-2 transition-all duration-200 active:scale-95 ' +
              (active ? 'border-white ring-2 ring-violet/70' : 'border-white/25 hover:border-white/60')
            }
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}

/**
 * Upload de imagem → devolve um data URL (fica só no navegador). html2canvas
 * rasteriza data URLs sem problema de CORS.
 */
export function ImageUpload({
  value,
  onChange,
  label = 'Imagem',
  round,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
  round?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pick = (file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={
          'relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-line-strong bg-bg-soft/60 transition hover:border-violet/55 ' +
          (round ? 'rounded-full' : 'rounded-[12px]')
        }
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-muted" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        )}
      </button>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-text-muted transition hover:border-violet/55 hover:text-white"
        >
          {value ? 'Trocar' : `Enviar ${label.toLowerCase()}`}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-left text-[11px] text-text-dim hover:text-red-300"
          >
            Remover
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
