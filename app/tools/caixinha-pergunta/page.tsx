'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Inter } from 'next/font/google';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { ToolStep } from '@/components/tool-kit';

/**
 * Caixinha de Pergunta — recria o sticker de perguntas do Instagram (o formato
 * de "pergunta recebida": faixa escura com o prompt em cima + a pergunta no
 * corpo branco) como uma IMAGEM pronta pra postar.
 *
 * Fidelidade: a fonte do sticker do Instagram é a fonte do sistema (SF Pro no
 * iPhone). A melhor réplica web CONSISTENTE (o export tem que sair igual em
 * qualquer máquina) é a Inter em peso regular — desenhada espelhando SF Pro.
 * Carregamos ela LOCAL nesta ferramenta (sem tocar na tipografia global do app)
 * e aplicamos só dentro da caixinha. Os textos são editáveis; a fonte fica
 * travada pra sempre bater com o Instagram.
 *
 * O export usa html2canvas com `scale` = ALVO / largura-do-palco → PNG nítido
 * em 1080px. O download vai por Object URL (nunca base64 — data URL trunca
 * arquivo grande e sai "corrompido").
 */

// Inter LOCAL — só desta ferramenta. Peso 400 (regular) é o do sticker real.
const igFont = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const HUE = 'rgba(74,160,230,0.42)';

// Largura do palco no preview (px). O export multiplica por SCALE pra chegar a
// 1080px. Tudo dentro da caixinha é dimensionado em cima desta base.
const STAGE_W = 340;
const EXPORT_W = 1080;
const SCALE = EXPORT_W / STAGE_W;

type Formato = { id: string; label: string; ratio: number };
const FORMATOS: Formato[] = [
  { id: 'story', label: 'Story 9:16', ratio: 16 / 9 },
  { id: 'quadrado', label: 'Quadrado 1:1', ratio: 1 },
  { id: 'retrato', label: 'Feed 4:5', ratio: 5 / 4 },
];

type Fundo = { id: string; label: string; css: string; solid?: string };
// `css` é o que pinta o palco (cor OU gradiente). `solid` alimenta o color
// picker quando o fundo é uma cor chapada.
const FUNDOS: Fundo[] = [
  { id: 'azul', label: 'Azul', css: '#4aa0e6', solid: '#4aa0e6' },
  { id: 'insta', label: 'Instagram', css: 'linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)' },
  { id: 'pordosol', label: 'Pôr do sol', css: 'linear-gradient(160deg,#f6d365 0%,#fda085 100%)' },
  { id: 'roxo', label: 'Roxo', css: '#7b4de0', solid: '#7b4de0' },
  { id: 'verde', label: 'Verde', css: '#22b573', solid: '#22b573' },
  { id: 'preto', label: 'Preto', css: '#101010', solid: '#101010' },
  { id: 'grafite', label: 'Grafite', css: 'linear-gradient(160deg,#3a3a3f 0%,#141416 100%)' },
];

export default function CaixinhaPerguntaPage() {
  const [header, setHeader] = useToolState<string>(
    'caixinha:header',
    'Faça uma pergunta',
  );
  const [pergunta, setPergunta] = useToolState<string>(
    'caixinha:pergunta',
    'Drop ainda vai valer a pena com essas taxas?',
  );
  const [bg, setBg] = useToolState<string>('caixinha:bg', FUNDOS[0].css);
  const [formatoId, setFormatoId] = useToolState<string>(
    'caixinha:formato',
    'story',
  );

  const [gerando, setGerando] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const formato = FORMATOS.find((f) => f.id === formatoId) ?? FORMATOS[0];
  const stageH = Math.round(STAGE_W * formato.ratio);
  // O fundo atual é uma cor chapada? (habilita o color picker refletindo a cor)
  const fundoAtual = FUNDOS.find((f) => f.css === bg);
  const corSolida = fundoAtual?.solid ?? (bg.startsWith('#') ? bg : '#4aa0e6');
  const isGradiente = bg.startsWith('linear-gradient');

  const exportarPNG = async () => {
    const node = stageRef.current;
    if (!node || gerando) return;
    setGerando(true);
    try {
      // Fontes carregadas (Inter local) antes de rasterizar — senão o texto
      // sai na fonte de fallback e o PNG não bate com o preview.
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 60));

      const { default: html2canvas } = await import('html2canvas');
      const canvas: HTMLCanvasElement = await html2canvas(node, {
        scale: SCALE,
        backgroundColor: null,
        useCORS: true,
        logging: false,
      });

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b: Blob | null) => resolve(b), 'image/png'),
      );
      if (!blob) throw new Error('toBlob vazio');

      // Object URL (NUNCA base64/data URL — trunca e corrompe). Revoga depois.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `caixinha-pergunta-${formato.id}.png`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('[caixinha-pergunta] falha ao exportar', err);
      alert('Não consegui gerar a imagem agora. Tenta de novo em instantes.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <ToolShell
      title="Caixinha de Pergunta"
      eyebrow="CONTEÚDO"
      description="A caixinha de perguntas do Instagram, do seu jeito. Escreve os textos, escolhe o fundo e baixa a imagem pronta."
      hue={HUE}
      icon={<IconCaixinha size={56} />}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* ─────────── Controles ─────────── */}
        <div className="flex flex-col gap-5">
          <ToolStep title="Textos" hint="Os dois textos da caixinha — na fonte do Instagram" hue={HUE} icon={<IconText size={18} />}>
            <label className="block">
              <span className="label-tech">Pergunta do topo</span>
              <input
                type="text"
                className="input-field mt-2"
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                placeholder="Faça uma pergunta"
                maxLength={80}
              />
            </label>

            <label className="mt-4 block">
              <span className="label-tech">A pergunta / mensagem</span>
              <textarea
                className="input-field mt-2 min-h-[92px] resize-y leading-relaxed"
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                placeholder="Escreve aqui a pergunta que aparece na caixinha…"
                maxLength={280}
                rows={3}
              />
              <span className="mt-1 block text-right text-[11px] text-text-dim">
                {pergunta.length}/280
              </span>
            </label>
          </ToolStep>

          <ToolStep title="Fundo" hint="A cor por trás da caixinha" hue={HUE} icon={<IconPaint size={18} />}>
            <div className="flex flex-wrap gap-2.5">
              {FUNDOS.map((f) => {
                const active = bg === f.css;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setBg(f.css)}
                    title={f.label}
                    aria-label={`Fundo ${f.label}`}
                    aria-pressed={active}
                    className={
                      'h-11 w-11 rounded-full border-2 transition-all duration-200 active:scale-95 ' +
                      (active
                        ? 'border-white ring-2 ring-violet/70'
                        : 'border-white/25 hover:border-white/60')
                    }
                    style={{ background: f.css }}
                  />
                );
              })}
            </div>

            {/* Color picker pra cor chapada custom */}
            <div className="mt-4 flex items-center gap-3">
              <label className="relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white/25 transition hover:border-white/60" title="Cor personalizada">
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: isGradiente ? 'conic-gradient(from 0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : corSolida }}
                />
                <input
                  type="color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={corSolida}
                  onChange={(e) => setBg(e.target.value)}
                />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="relative drop-shadow">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
              </label>
              <div className="text-[12px] leading-snug text-text-muted">
                <span className="block font-semibold text-white">Cor personalizada</span>
                Toca no círculo e escolhe qualquer cor.
              </div>
            </div>
          </ToolStep>

          <ToolStep title="Formato" hint="Proporção da imagem final" hue={HUE} icon={<IconFrame size={18} />}>
            <div className="flex flex-wrap gap-2">
              {FORMATOS.map((f) => {
                const active = f.id === formatoId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormatoId(f.id)}
                    className={
                      'rounded-full border px-4 py-2 text-[12.5px] font-semibold transition-all duration-200 active:scale-[0.97] ' +
                      (active
                        ? 'border-violet/65 bg-violet/15 text-white'
                        : 'border-line-strong text-text-muted hover:border-violet hover:text-white')
                    }
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </ToolStep>
        </div>

        {/* ─────────── Preview + Export ─────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[20px] border border-line/60 bg-bg-soft/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-tech">Prévia</span>
              <span className="text-[11px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                {EXPORT_W}×{Math.round(EXPORT_W * formato.ratio)}
              </span>
            </div>

            <div className="flex justify-center overflow-x-auto">
              {/* O PALCO — é exatamente o que vira PNG. Dimensões fixas em px
                  pra o export ser determinístico (scale cuida da resolução). */}
              <div
                ref={stageRef}
                style={{
                  width: STAGE_W,
                  height: stageH,
                  background: bg,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto',
                  overflow: 'hidden',
                }}
              >
                <QuestionSticker header={header} pergunta={pergunta} />
              </div>
            </div>

            <button
              type="button"
              onClick={exportarPNG}
              disabled={gerando}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] border border-white/15 px-5 py-3.5 text-[14px] font-bold text-white transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                fontFamily: 'var(--font-tech)',
                background: 'linear-gradient(180deg,#4aa0e6 0%,#2f7fd0 100%)',
                boxShadow: '0 8px 22px -8px rgba(74,160,230,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              {gerando ? (
                <>
                  <svg className="animate-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 3a9 9 0 1 0 9 9" />
                  </svg>
                  Gerando…
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                  Baixar PNG
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-text-muted">
              Imagem em alta ({EXPORT_W}px) — pronta pro story ou feed.
            </p>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ───────────────────── A caixinha (fiel ao Instagram) ───────────────────── */
/**
 * Sticker de perguntas do Instagram. Um card branco arredondado com:
 *   • header escuro (#262626) — o prompt, texto branco menor
 *   • corpo branco — a pergunta, texto cinza-escuro maior
 * Cantos: o overflow:hidden do card faz o header herdar os cantos de cima e o
 * corpo os de baixo (igual ao original).
 */
// useLayoutEffect no client (mede antes da pintura, sem flash), useEffect no
// SSR (evita warning). O componente é 'use client', mas o Next pré-renderiza.
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Texto auto-ajustável — igual ao Instagram: começa no tamanho MÁXIMO e reduz a
 * fonte (até um mínimo) conforme o texto cresce, pra caber na altura-alvo sem
 * estourar a proporção da caixinha. Mede o scrollHeight real (funciona em
 * qualquer idioma/quebra) e o tamanho final é o que o export rasteriza.
 */
function FitText({
  children,
  maxPx,
  minPx,
  maxHeight,
  style,
}: {
  children: string;
  maxPx: number;
  minPx: number;
  maxHeight: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [px, setPx] = useState(maxPx);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    let guard = 0;
    // Reduz 1px por vez até o conteúdo caber na altura-alvo (ou bater no mínimo).
    while (size > minPx && el.scrollHeight > maxHeight && guard < 48) {
      size -= 1;
      el.style.fontSize = `${size}px`;
      guard += 1;
    }
    setPx(size);
  }, [children, maxPx, minPx, maxHeight]);
  return (
    <div ref={ref} style={{ ...style, fontSize: px }}>
      {children || ' '}
    </div>
  );
}

function QuestionSticker({ header, pergunta }: { header: string; pergunta: string }) {
  return (
    <div
      className={igFont.className}
      style={{
        // Caixinha LARGA (retangular, como no Instagram) — 80% do palco. Estreita
        // demais deixava o texto em 3 linhas e a caixinha ficava quadrada.
        width: STAGE_W * 0.8,
        // Cantos SUTIS — arredondamento leve, não pill (o do Instagram é discreto).
        borderRadius: 11,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        // Anti-serrilhado do texto na rasterização
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Header escuro — o prompt */}
      <FitText
        maxPx={15}
        minPx={11}
        maxHeight={STAGE_W * 0.2}
        style={{
          background: '#262626',
          color: '#ffffff',
          padding: '13px 20px',
          textAlign: 'center',
          fontWeight: 400,
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {header}
      </FitText>

      {/* Corpo branco — a pergunta */}
      <FitText
        maxPx={21}
        minPx={13}
        maxHeight={STAGE_W * 0.5}
        style={{
          background: '#ffffff',
          color: '#454545',
          padding: '24px 22px',
          textAlign: 'center',
          fontWeight: 400,
          lineHeight: 1.32,
          letterSpacing: '-0.015em',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {pergunta}
      </FitText>
    </div>
  );
}

/* ───────────────────────────── Ícones locais ───────────────────────────── */

function IconText({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V5h16v2M9 19h6M12 5v14" />
    </svg>
  );
}

function IconPaint({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a5 5 0 0 0-5 5c0 1.5 1 2 1 3a2 2 0 0 1-2 2 3 3 0 0 0 0 6h1a8 8 0 0 0 8-8V7a5 5 0 0 0-3-5z" />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </svg>
  );
}

function IconFrame({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16M9 3v18" opacity="0.5" />
    </svg>
  );
}

// Ícone grande do hero (balão de pergunta) — gradiente azul.
function IconCaixinha({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="cx-hero" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67b8ff" />
          <stop offset="100%" stopColor="#2f7fd0" />
        </linearGradient>
      </defs>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H13l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8z"
        fill="none"
        stroke="url(#cx-hero)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 8.6a2.6 2.6 0 0 1 5 .9c0 1.7-2.4 2-2.4 3.4"
        fill="none"
        stroke="url(#cx-hero)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="0.5" fill="url(#cx-hero)" stroke="url(#cx-hero)" strokeWidth="0.9" />
    </svg>
  );
}
