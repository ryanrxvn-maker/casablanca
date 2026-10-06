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
//
// O padrão pega o emoji INTEIRO (cliente 06.10: "🙏🏻" saía 🙏 + um quadrado de
// pele solto — o modificador de tom não é Extended_Pictographic):
//  • bandeira (par de regional indicators) e keycap (1️⃣ #️⃣);
//  • pictograma + VS16/tom de pele/tags (🏴 da Inglaterra), encadeado por ZWJ
//    (👩🏾‍💻, 🙋🏻‍♀️, 🫱🏻‍🫲🏿);
//  • © ® ™ SEM VS16 ficam como TEXTO (rodapé "© 2025" — no celular também é texto).
// Um grupo de captura só: o motor da live usa o mesmo padrão em exec.
export const EMOJI_RE =
  /(\p{Regional_Indicator}\p{Regional_Indicator}|[#*0-9]️?⃣|(?![©®™](?!️))\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*(?:‍(?:\p{Extended_Pictographic}|\p{Emoji_Component})(?:️|\p{Emoji_Modifier})*)*)/gu;

export type EmojiSet = 'apple' | 'google';

const emojiUrl = (set: EmojiSet, unified: string) =>
  `https://cdn.jsdelivr.net/npm/emoji-datasource-${set}/img/${set}/64/${unified}.png`;

/**
 * URLs candidatas, em ordem. O datasource só tem o arquivo da forma "qualificada"
 * (às vezes sem VS16, às vezes com) e nem todo emoji existe nos dois sets — "♥"
 * sem VS16 não existe no Google, "♀️" sozinho não existe no Apple. Tenta a forma
 * digitada, sem VS16, com VS16 e, por último, o outro set.
 */
export function emojiSrcs(emoji: string, set: EmojiSet = 'apple'): string[] {
  // nome do arquivo = codepoints em hex com 4 dígitos no mínimo ("0031-fe0f-20e3")
  const cps = [...emoji].map((c) => c.codePointAt(0)!);
  const hex = (a: number[]) => a.map((n) => n.toString(16).padStart(4, '0')).join('-');
  const noVs = cps.filter((n) => n !== 0xfe0f);
  const forms = [hex(cps), hex(noVs)];
  if (noVs.length === cps.length && cps.length > 0) forms.push(hex([cps[0], 0xfe0f, ...cps.slice(1)]));
  const uniq = Array.from(new Set(forms));
  const other: EmojiSet = set === 'apple' ? 'google' : 'apple';
  return [...uniq.map((u) => emojiUrl(set, u)), emojiUrl(other, uniq[0])];
}

const EMOJI_IMG_STYLE: CSSProperties = {
  width: '1.15em',
  height: '1.15em',
  display: 'inline-block',
  verticalAlign: '-0.22em',
  objectFit: 'contain',
  margin: '0 0.02em',
};

/** <img> do emoji que cai pra próxima URL candidata se o arquivo não existir;
 *  sem nenhuma, mostra o caractere (melhor que um buraco no print). */
function EmojiImg({ emoji, set }: { emoji: string; set: EmojiSet }) {
  const [i, setI] = useState(0);
  const srcs = emojiSrcs(emoji, set);
  if (i >= srcs.length) return <>{emoji}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- PNG do CDN de emoji, rasterizado pelo html2canvas
    <img
      src={srcs[i]}
      alt={emoji}
      crossOrigin="anonymous"
      draggable={false}
      onError={() => setI((v) => v + 1)}
      style={EMOJI_IMG_STYLE}
    />
  );
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
    // key com o emoji: trocar o emoji remonta o <img> (zera a cadeia de fallback)
    out.push(<EmojiImg key={`e${k}-${set}-${emoji}`} emoji={emoji} set={set} />);
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

/** GIF 1×1 que o html2canvas 1.4.1 usa na sonda de linha de base (SMALL_IMAGE). */
const H2C_PROBE_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Rasteriza um nó do DOM em PNG NÍTIDO e fiel à prévia.
 *
 * Motor: `html2canvas` — RÁPIDO (~3s, previsível) e desenha com a fonte JÁ
 * CARREGADA na página, então a MESMA fonte da prévia (Inter) sai no download. Os
 * motores foreignObject (snapdom/modern-screenshot) sairiam pixel-a-pixel porque
 * quem desenha é o próprio navegador, mas no CACHE FRIO (o 1º export do usuário)
 * levam 40-77s — inviável. O "texto baixo" que o html2canvas tinha era a sonda de
 * linha de base quebrada pelo reset do Tailwind — corrigida na raiz (h2cFix).
 *
 * `targetW` = largura final do PNG; scale = targetW/refW (stageW). Download por
 * Object URL (data URL trunca arquivo grande).
 */
export async function renderNodeToCanvas(
  node: HTMLElement,
  targetW: number,
  refW?: number,
  /** Ajuste extra aplicado ao clone que o html2canvas desenha — usado pelo
   *  export de vídeo pra assar a base com a tinta animada oculta. */
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

  // ── Ellipsis-shim do html2canvas ──
  // O html2canvas NÃO desenha o "…" do `text-overflow: ellipsis`: texto de 1
  // linha que ESTOURA a caixa sai FATIADO no limite (letra cortada ao meio) no
  // PNG, enquanto a prévia termina em reticências — "texto comido" no download.
  // Correção: pro texto PURO (só nós de texto) com nowrap+ellipsis que realmente
  // estoura, achamos AQUI o maior pedaço que cabe com "…" e trocamos o texto SÓ
  // NO CLONE do render. As larguras vêm do PRÓPRIO navegador (Range sobre o texto
  // assentado: já com text-transform, letter-spacing e o arredondamento dele) —
  // a medida por canvas errava a letra do corte (nomes MAIÚSCULOS da CBS NY e da
  // figurinha de localização) e scroll/clientWidth, inteiros, deixavam passar
  // texto que estoura por fração de px (124,92 numa caixa de 124,63).
  const ellipEls: HTMLElement[] = [];
  const computeEllipsisShims = () => {
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const kids = Array.from(el.childNodes);
      if (!kids.length || kids.some((n) => n.nodeType !== 3)) return; // misto (emoji <img> etc.): fora
      const text = el.textContent || '';
      if (!text.trim()) return;
      const cs = getComputedStyle(el);
      if (cs.whiteSpace !== 'nowrap' || cs.textOverflow !== 'ellipsis') return;
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return;
      const avail =
        el.getBoundingClientRect().width -
        (parseFloat(cs.paddingLeft) || 0) -
        (parseFloat(cs.paddingRight) || 0) -
        (parseFloat(cs.borderLeftWidth) || 0) -
        (parseFloat(cs.borderRightWidth) || 0);
      // fronteiras por code point (não fatia emoji/acento), atravessando os nós
      const ends: Array<[Text, number]> = [];
      for (const tn of kids as Text[]) {
        let o = 0;
        for (const ch of Array.from(tn.data)) {
          o += ch.length;
          ends.push([tn, o]);
        }
      }
      const rg = document.createRange();
      const widthTo = (i: number) => {
        rg.setStart(kids[0], 0);
        rg.setEnd(ends[i][0], ends[i][1]);
        return rg.getBoundingClientRect().width;
      };
      if (!(widthTo(ends.length - 1) > avail + 0.01)) return; // cabe: o Chrome não põe "…"
      // largura do "…" na fonte do elemento, SEM letter-spacing (o Chrome não soma
      // espaçamento depois do "…": com ele, "ALLEN DE…" da prévia virava "ALLEN D…")
      const probe = document.createElement('span');
      probe.textContent = '…';
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;letter-spacing:0';
      el.appendChild(probe);
      const ell = probe.getBoundingClientRect().width;
      el.removeChild(probe);
      let lo = 0; // quantos code points cabem antes do "…"
      let hi = ends.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (widthTo(mid - 1) + ell <= avail + 0.01) lo = mid;
        else hi = mid - 1;
      }
      if (lo <= 0 || lo >= ends.length) return;
      // o Chrome NÃO apara o espaço antes do "…" ("aumentando …") — igual aqui
      el.dataset.fpEllip = Array.from(text).slice(0, lo).join('') + '…';
      // largura TRAVADA no clone: caixa que se ajusta ao conteúdo (a pílula da
      // localização) encolhia com o texto mais curto e saía mais estreita
      el.dataset.fpEllipW = String(el.getBoundingClientRect().width);
      ellipEls.push(el);
    });
  };
  // ── Vídeo → snapshot ──
  // O html2canvas NÃO desenha <video> (a área sairia vazia no PNG). Antes de
  // capturar, cada vídeo visível vira um SNAPSHOT do frame atual, já recortado
  // em COVER na proporção da caixa; no clone do render o <video> é trocado
  // por um <img> desse snapshot — o PNG sai idêntico à prévia. Exceção: vídeo
  // marcado com data-fp-vidhole="1" (export de .webm/.mp4) fica como BURACO
  // transparente — o motor de vídeo compõe o frame REAL por baixo da base.
  const vidShims: HTMLElement[] = [];
  const computeVideoShims = () => {
    node.querySelectorAll<HTMLVideoElement>('video').forEach((v) => {
      if (v.dataset.fpVidhole === '1') return;
      const r = v.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
      // 2× da caixa: nítido mesmo no export em alta (limite pra não estourar memória)
      const cw = Math.max(2, Math.min(2048, Math.round(r.width * 2)));
      const ch = Math.max(2, Math.min(2048, Math.round(r.height * 2)));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const cx = c.getContext('2d');
      if (!cx) return;
      const sc = Math.max(cw / v.videoWidth, ch / v.videoHeight);
      const dw = v.videoWidth * sc;
      const dh = v.videoHeight * sc;
      cx.drawImage(v, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      try {
        v.dataset.fpVidsnap = c.toDataURL('image/png');
        vidShims.push(v);
      } catch {}
    });
  };
  const applyVideoShimsInClone = (root: HTMLElement) => {
    root.querySelectorAll<HTMLVideoElement>('video').forEach((v) => {
      const snap = v.dataset?.fpVidsnap;
      if (!snap) return; // sem snapshot (ou buraco de vídeo): h2c não desenha nada mesmo
      const img = v.ownerDocument.createElement('img');
      img.src = snap;
      // snapshot já vem recortado em cover na proporção da caixa → 'fill' basta
      img.style.cssText = v.style.cssText;
      img.style.objectFit = 'fill';
      v.replaceWith(img);
    });
  };

  // Ajustes aplicados SÓ no clone que o html2canvas desenha (a prévia não muda):
  // vídeo→snapshot, reticências, caixa inline atômica e line-clamp.
  const applyCloneShims = (root: HTMLElement) => {
    applyVideoShimsInClone(root);
    root.querySelectorAll<HTMLElement>('[data-fp-ellip]').forEach((el) => {
      el.textContent = el.dataset.fpEllip || el.textContent;
      const w = parseFloat(el.dataset.fpEllipW || '');
      if (w > 0) {
        el.style.boxSizing = 'border-box';
        el.style.width = `${w}px`;
        el.style.minWidth = `${w}px`;
        el.style.maxWidth = `${w}px`;
        el.style.flex = '0 0 auto';
      }
    });
    // ── Caixa inline ATÔMICA pintada como unidade ──
    // O html2canvas não pinta inline-block/inline-flex como unidade (o navegador
    // pinta): os filhos-bloco dela (itens do flex) caem na fase de blocos do
    // contexto e o FUNDO da caixa vem DEPOIS, por cima — o logo "BandNEWS" (caixa
    // azul inline-flex com 2 spans) sumia inteiro no PNG. `position: relative`
    // sem deslocamento (layout idêntico) faz o html2canvas abrir um contexto pra
    // ela: fundo primeiro, conteúdo por cima, como no navegador.
    const cloneWin = root.ownerDocument.defaultView || window;
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (!el.firstElementChild) return;
      const cs = cloneWin.getComputedStyle(el);
      if (!/^inline-(block|flex|grid|table)$/.test(cs.display) || cs.position !== 'static') return;
      const bgm = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const bgAlpha = bgm ? (bgm[1].split(',').length < 4 ? 1 : parseFloat(bgm[1].split(',')[3])) : 0;
      const paints =
        bgAlpha > 0.01 ||
        cs.backgroundImage !== 'none' ||
        cs.boxShadow !== 'none' ||
        ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat((cs as any)[`border${s}Width`]) > 0);
      if (paints) el.style.position = 'relative';
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

  let canvas: HTMLCanvasElement | null = null;
  // ── RAIZ do "texto BAIXO no PNG" (06.10) ──
  // O html2canvas acha a linha de base de cada fonte com uma sonda escondida no
  // <body>: um texto + um GIF de 1px `vertical-align: baseline`. O reset do
  // Tailwind (`img { display: block }`) jogava esse GIF pra LINHA DE BAIXO e a
  // linha de base saía ~0,4em+2px abaixo da real (medido: Inter 13px → 8px,
  // Georgia 36px → 17px) — todo texto do print descia no download. A calibração
  // por sonda que morava aqui (07.07→06.10: 4-5 renders, medição de tinta por
  // fonte) só compensava isso, com viés de alguns px por fonte. Esta regra vale só
  // pro GIF da sonda (pelo src exato) e só durante o export: inline de novo e
  // margin-bottom 1px, que anula o "+2" da conta dele → base EXATA do navegador.
  const h2cFix = document.createElement('style');
  h2cFix.setAttribute('data-fp-h2c-baseline', '');
  h2cFix.textContent = `img[src="${H2C_PROBE_GIF}"]{display:inline!important;margin-bottom:1px!important}`;
  document.head.appendChild(h2cFix);
  try {
    // Espera imagens (emojis do CDN, avatares, fotos) carregarem — senão saem
    // em branco no canvas. Só as que AINDA carregam: uma que já falhou está
    // `complete` e esperar o evento dela travava o download pra sempre. Em
    // rodadas porque o emoji que falha troca de URL (EmojiImg) no próximo render
    // e volta a carregar; teto por rodada pra rede pendurada não travar.
    for (let round = 0; round < 5; round++) {
      const loading = Array.from(node.querySelectorAll('img')).filter((img) => !img.complete);
      if (!loading.length) break;
      await Promise.race([
        Promise.all(
          loading.map(
            (img) =>
              new Promise<void>((res) => {
                img.addEventListener('load', () => res(), { once: true });
                img.addEventListener('error', () => res(), { once: true });
              }),
          ),
        ),
        new Promise((r) => setTimeout(r, 15000)),
      ]);
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 60));

    computeVideoShims();
    computeEllipsisShims();
    computeClampShims();

    // UM render só: com a linha de base certa (h2cFix) o html2canvas já desenha
    // cada texto onde o navegador desenha — a sondagem/compensação vertical que
    // existia aqui (4-5 renders por export) só corrigia a sonda quebrada.
    const { default: html2canvas } = await import('html2canvas');
    canvas = await html2canvas(node, {
      scale: targetW / (refW ?? node.getBoundingClientRect().width),
      backgroundColor: null,
      useCORS: true,
      logging: false,
      imageTimeout: 20000,
      onclone: (_d: Document, root: HTMLElement) => {
        applyCloneShims(root);
        onCloneExtra?.(root);
      },
    });
  } finally {
    ellipEls.forEach((el) => { delete el.dataset.fpEllip; delete el.dataset.fpEllipW; });
    clampEls.forEach((el) => { delete el.dataset.fpClamp; });
    vidShims.forEach((el) => { delete el.dataset.fpVidsnap; });
    if (zoomEl) zoomEl.style.zoom = prevZoom;
    h2cFix.remove();
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
  // downloadBlob = Object URL + captura pro cofre do Histórico geral (o print
  // fica recuperável por 7 dias no /tools/historico).
  const { downloadBlob } = await import('@/lib/audio-engine');
  await downloadBlob(blob, filename, { tool: 'fakepass' });
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

/**
 * Upload de VÍDEO → devolve um Object URL (fica só no navegador; data URL
 * truncaria arquivo grande). O vídeo roda na prévia (mudo, em loop); no PNG sai
 * o frame atual (snapshot no export) e no export de vídeo ele roda de verdade.
 */
export function VideoUpload({
  value,
  onChange,
  label = 'Vídeo',
}: {
  value: string;
  onChange: (objectUrl: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pick = (file?: File | null) => {
    if (!file) return;
    if (value && value.startsWith('blob:')) {
      try { URL.revokeObjectURL(value); } catch {}
    }
    onChange(URL.createObjectURL(file));
  };
  const clear = () => {
    if (value && value.startsWith('blob:')) {
      try { URL.revokeObjectURL(value); } catch {}
    }
    onChange('');
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line-strong bg-bg-soft/60 transition hover:border-violet/55"
      >
        {value ? (
          <video src={value} muted loop autoPlay playsInline className="h-full w-full object-cover" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-muted" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
            <path d="M15.5 10.5 21 7v10l-5.5-3.5" />
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
          <button type="button" onClick={clear} className="text-left text-[11px] text-text-dim hover:text-red-300">
            Remover
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
