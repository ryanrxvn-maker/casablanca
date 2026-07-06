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
  weight: ['400', '500', '600', '700'],
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

export type ModelCategory = 'story' | 'chat' | 'post' | 'notif' | 'news' | 'sites';

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
const EMOJI_RE =
  /(\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;

export type EmojiSet = 'apple' | 'google';

function toUnified(emoji: string) {
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
    <div ref={ref} style={{ ...style, fontSize: px }}>
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
export async function downloadNodeAsPng(
  node: HTMLElement,
  filename: string,
  targetW: number,
  refW?: number,
) {
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
  const applyCropGuards = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const clips =
        cs.overflowX === 'hidden' ||
        cs.overflowX === 'clip' ||
        cs.overflowY === 'hidden' ||
        cs.overflowY === 'clip';
      if (!clips) return;
      // só elementos com TEXTO direto (não mexe em containers de ícone/foto — avatar
      // redondo, etc. — que cortam de propósito)
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent || '').trim() !== '',
      );
      if (!hasDirectText) return;
      // o texto CABE? (nada a cortar) → seguro remover o clip. Se estoura de verdade,
      // deixa como está (mantém o "…"/clamp).
      const fits =
        el.scrollWidth <= el.clientWidth + 1 &&
        el.scrollHeight <= el.clientHeight + 1;
      if (!fits) return;
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

  let blob: Blob | null = null;
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

    applyCropGuards();

    // ── Compensação do bug de CENTRALIZAÇÃO VERTICAL do html2canvas ──
    // O html2canvas ANCORA o glifo no FUNDO da caixa de conteúdo. Resultado: texto de
    // UMA linha centralizado numa caixa MAIS ALTA que o glifo (via flex
    // `align-items:center` OU `line-height`) sai BAIXO no PNG — no navegador fica no
    // centro. (Bolha de chat NÃO sofre: o texto flui do topo, caixa = conteúdo.)
    // Correção: medimos, por FOLHA de texto, o vão vazio ABAIXO do glifo no navegador
    // (= exatamente o quanto o html2canvas erra pra baixo). No clone do html2canvas
    // (via `onclone`; a PRÉVIA não muda) envolvemos o texto num <span> com
    // `translateY(-vão)`: o transform é PÓS-layout, então sobe o glifo pelo valor
    // exato, imune ao flex-center interno (que "engolia" metade de um padding). O
    // fundo (na caixa-pai) não se mexe. Marcamos aqui com data-attr (inerte: não
    // reflui a prévia) o deslocamento; o onclone aplica no clone.
    const vcompEls: HTMLElement[] = [];
    const all = Array.from(node.querySelectorAll<HTMLElement>('*'));
    // PASSO 1 — mapa das "bandas": elementos flex/grid que CENTRALIZAM o conteúdo (é
    // o que o html2canvas erra, ancorando o glifo no fundo). 1 getComputedStyle por
    // elemento (mesma ordem que o próprio html2canvas já faz). Guardamos a caixa de
    // BORDA (trilho real onde o html2canvas ancora; glifo multi-linha pode passar do
    // content-box).
    // `bands` = flex/grid ROW com align-items:center (centralização VERTICAL de 1
    // linha — o que o html2canvas erra). `stops` = contextos onde NÃO se pode
    // compensar via translateY vertical: flex-COLUNA (texto empilhado, ex.: LIVE+hora
    // — centralizar cada item colapsa a coluna), writing-mode VERTICAL (GloboNews) e
    // qualquer TRANSFORM (skew/rotate — o translateY sairia no eixo errado).
    const bands = new Map<HTMLElement, { top: number; bottom: number }>();
    const stops = new Set<HTMLElement>();
    for (const a of all) {
      const cs = getComputedStyle(a);
      const isFlex = cs.display.includes('flex');
      const isCol = isFlex && (cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse');
      const vertical = cs.writingMode !== 'horizontal-tb';
      const transformed = cs.transform && cs.transform !== 'none';
      if (isCol || vertical || transformed) stops.add(a);
      if (vertical) continue; // banda vertical não conta
      const rowCenter = (isFlex || cs.display.includes('grid')) && !isCol && cs.alignItems === 'center';
      if (!rowCenter) continue;
      const ar = a.getBoundingClientRect();
      bands.set(a, {
        top: ar.top + (parseFloat(cs.borderTopWidth) || 0),
        bottom: ar.bottom - (parseFloat(cs.borderBottomWidth) || 0),
      });
    }
    // PASSO 2 — só FOLHAS de texto que têm banda-ancestral (checagem BARATA via Map,
    // sem getComputedStyle). Só aí medimos o Range (glifo) — assim artigos (muito
    // texto, ZERO banda) não pagam nada. Pega tag, ticker (aninhado) e manchete
    // (multi-linha). Bolha de chat / coluna empilhada / texto vertical → intocados.
    if (bands.size) {
      for (const el of all) {
        const kids = Array.from(el.childNodes);
        if (kids.some((n) => n.nodeType === 1)) continue; // só FOLHAS
        if (!kids.some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
        // barato: tem banda-ancestral SEM cruzar um `stop`? (senão nem mede o Range)
        let reachable = false;
        for (let i = 0, a: HTMLElement | null = el; i < 6 && a; i++, a = a.parentElement) {
          if (i > 0 && stops.has(a)) break; // cruzou coluna/vertical/transform → aborta
          if (bands.has(a)) {
            reachable = true;
            break;
          }
        }
        if (!reachable) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const gr = range.getBoundingClientRect(); // caixa REAL dos glifos
        if (!gr.height) continue;
        // acha a banda mais próxima COM FOLGA (pula o span aninhado apertado do
        // ticker; aborta se cruzar um `stop` antes).
        let band: { top: number; bottom: number } | undefined;
        for (let i = 0, a: HTMLElement | null = el; i < 6 && a; i++, a = a.parentElement) {
          if (i > 0 && stops.has(a)) break;
          const b = bands.get(a);
          if (b && b.bottom - b.top - gr.height > 3) {
            band = b;
            break;
          }
        }
        if (!band) continue;
        const gapAbove = gr.top - band.top;
        const gapBelow = band.bottom - gr.bottom;
        if (gapAbove <= 1 || gapBelow <= 1) continue; // centralizado dos DOIS lados
        // CALIBRAÇÃO do shift (medido empiricamente por varredura de pixel):
        // • 1 linha: o html2canvas ancora o glifo no fundo da caixa → precisa subir
        //   gapBelow; o wrap inline-block entrega ~80% → multiplico por 1.25.
        // • multi-linha (manchete FitText): o html2canvas joga o bloco BEM mais pra
        //   baixo (mistura ancoragem + line-spacing), erro ≈ folga TOTAL, não só
        //   gapBelow → uso (gapAbove+gapBelow) × 1.1.
        const fs = parseFloat(getComputedStyle(el).fontSize) || 14;
        const multiline = gr.height > fs * 1.6;
        const shift = multiline ? (gapAbove + gapBelow) * 0.88 : gapBelow * 1.25;
        el.dataset.fpVshift = String(Math.round(shift * 100) / 100);
        vcompEls.push(el);
      }
    }
    vcompCleanup = () => vcompEls.forEach((el) => delete el.dataset.fpVshift);

    // Largura de referência = a largura de LAYOUT do palco (stageW). Passar refW
    // evita medir o rect visual — o PNG sempre sai na resolução cheia.
    const baseW = refW ?? node.getBoundingClientRect().width;
    const scale = targetW / baseW;

    // MOTOR: html2canvas — RÁPIDO (~3s) e usa a fonte JÁ CARREGADA na página, então
    // a fonte bate com a prévia. Os motores foreignObject (snapdom/modern-screenshot)
    // sairiam PIXEL A PIXEL (o navegador desenha), mas no CACHE FRIO (1º export do
    // user) levam 40-77s — inviável. O html2canvas tem um drift vertical sub-pixel
    // (mitigado pelo crop-guard e line-heights inteiros dos textos-chave).
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, {
      scale,
      backgroundColor: null, // transparente (stickers); modelos opacos pintam o próprio
      useCORS: true, // emojis do CDN
      logging: false,
      imageTimeout: 20000,
      // Aplica a compensação de centralização vertical (ver acima) SÓ no clone que o
      // html2canvas rasteriza — a prévia real fica intocada. Envolve o texto num
      // <span> inline-block com translateY(-vão): sobe SÓ o glifo, o fundo (na
      // caixa-pai) não se mexe.
      onclone: (doc: Document, clonedRoot: HTMLElement) => {
        clonedRoot.querySelectorAll<HTMLElement>('[data-fp-vshift]').forEach((el) => {
          const dy = parseFloat(el.dataset.fpVshift || '');
          if (!Number.isFinite(dy) || dy === 0) return;
          const span = doc.createElement('span');
          span.style.display = 'inline-block';
          span.style.transform = `translateY(${-dy}px)`;
          while (el.firstChild) span.appendChild(el.firstChild);
          el.appendChild(span);
        });
      },
    });
    blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b: Blob | null) => res(b), 'image/png'),
    );
  } finally {
    cropGuards.forEach((restore) => restore());
    if (vcompCleanup) vcompCleanup();
    if (zoomEl) zoomEl.style.zoom = prevZoom;
  }

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
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
      <path
        d="M8 2.2c2.6 0 5 1 6.8 2.7l-1.5 1.6A7.6 7.6 0 0 0 8 4.3 7.6 7.6 0 0 0 2.7 6.5L1.2 4.9A9.8 9.8 0 0 1 8 2.2Z"
        fill={color}
      />
      <path
        d="M8 6.1c1.5 0 2.9.6 3.9 1.6l-1.6 1.6A2.9 2.9 0 0 0 8 8.4c-.9 0-1.7.4-2.3 1L4.1 7.7A5.5 5.5 0 0 1 8 6.1Z"
        fill={color}
      />
      <circle cx="8" cy="10.6" r="1.3" fill={color} />
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
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
              {cfg.network}
            </span>
          ) : null}
          <SignalBars n={cfg.signal} color={color} />
          {cfg.network && ios ? (
            <span style={{ fontSize: fs * 0.82, color, fontWeight: 600 }}>
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
          fontVariantNumeric: 'tabular-nums',
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
