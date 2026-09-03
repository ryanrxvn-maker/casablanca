'use client';

/**
 * JANELA DA HEADLINE do ClickUp Pilot (01.09 · controles 02.09 · v3 02.09).
 *
 * O PALCO é o controle principal: arrasta a manchete no preview do motor REAL
 * (drawHeadline num canvas 9:16) — o que se vê aqui é o que sai no MP4. A
 * proporção do palco é medida por ResizeObserver: CSS puro com aspect-ratio
 * esticava o quadro na coluna estreita e o preview mentia sobre a quebra.
 *
 * Todo ajuste fino aceita "padrão" (null = o que o MODELO manda). Sem esse
 * estado, mexer numa coisa só apagaria a identidade do preset.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HEADLINE_LIMITES, normalizarHeadlineCfg, type HeadlineCfg } from '@/lib/pilot-inserts';

type Alinhamento = 'left' | 'center' | 'right';

/** Cena falsa por baixo — dá contraste real pro painel e pra cor. */
function cenaDeFundo(g: CanvasRenderingContext2D, W: number, H: number) {
  const fundo = g.createLinearGradient(0, 0, 0, H);
  fundo.addColorStop(0, '#232b36');
  fundo.addColorStop(0.55, '#161c25');
  fundo.addColorStop(1, '#0c1016');
  g.fillStyle = fundo;
  g.fillRect(0, 0, W, H);
  g.save();
  g.filter = 'blur(12px)';
  g.fillStyle = 'rgba(214,178,148,0.5)';
  g.beginPath();
  g.arc(W / 2, H * 0.6, W * 0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(64,76,96,0.85)';
  g.beginPath();
  g.ellipse(W / 2, H * 0.88, W * 0.3, H * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** O estilo que vai pro motor — o MESMO que a pós-produção monta. */
export function estiloDaHeadlineCfg(base: Record<string, unknown>, cfg: HeadlineCfg) {
  const c = normalizarHeadlineCfg(cfg);
  return {
    ...base,
    presetId: c.presetId,
    posX: c.posX ?? 0.5,
    posY: c.posY,
    fontScale: c.fontScale ?? 1,
    width: c.width ?? 0.9,
    align: c.align ?? null,
    uppercase: c.uppercase ?? null,
    panel: c.panel ?? null,
    panelOpacity: c.panelOpacity ?? null,
    color: c.color ?? null,
    panelColor: c.panelColor ?? null,
    font: c.font ?? null,
    bold: c.bold ?? null,
    italic: c.italic ?? null,
    underline: c.underline ?? null,
    stroke: c.stroke ?? null,
    strokeColor: c.strokeColor ?? null,
    shadowForca: c.shadowForca ?? null,
    glow: c.glow ?? null,
    glowColor: c.glowColor ?? null,
  };
}

/* ═════════════ PALCO: preview 9:16 de verdade, com arrasto ══════════════ */

function PalcoDaHeadline({
  cfg,
  texto,
  onMover,
}: {
  cfg: HeadlineCfg;
  texto: string;
  onMover: (posX: number, posY: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [pronto, setPronto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  // 9:16 SEMPRE: mede a área disponível e escolhe a MAIOR caixa 9:16 que
  // cabe. CSS com aspect-ratio + max-width quebrava a proporção na coluna
  // estreita — e um preview fora de 9:16 mente sobre a quebra de linha.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 20) || !(r.height > 20)) return;
      const h = Math.min(r.height, (r.width * 16) / 9);
      const w = (h * 9) / 16;
      setBox((prev) => (Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let morto = false;
    const desenhar = async () => {
      try {
        const [hl, fonts] = await Promise.all([
          import('@/lib/typography/headline'),
          import('@/lib/typography/fonts'),
        ]);
        try {
          await fonts.ensureTypoFonts();
        } catch {
          /* sem as fontes o preview ainda mostra painel, cor e posição */
        }
        if (morto) return;
        const c = ref.current;
        if (!c) return;
        const W = 360;
        const H = 640;
        if (c.width !== W) {
          c.width = W;
          c.height = H;
        }
        const g = c.getContext('2d')!;
        cenaDeFundo(g, W, H);
        hl.drawHeadline(
          g,
          {
            id: 'palco',
            text: texto || 'SUA MANCHETE AQUI',
            start: 0,
            end: 9999,
            style: estiloDaHeadlineCfg(hl.HEADLINE_STYLE_DEFAULT as never, cfg) as never,
          },
          W,
          H,
        );
        if (!morto) setPronto(true);
      } catch (e) {
        console.warn('[PilotHeadline] palco falhou:', e);
        if (!morto) setPronto(true);
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => void desenhar());
    return () => {
      morto = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cfg, texto]);

  const daPonta = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = caixaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const lim = HEADLINE_LIMITES.pos;
      const x = Math.min(lim.max, Math.max(lim.min, (e.clientX - r.left) / r.width));
      const y = Math.min(lim.max, Math.max(lim.min, (e.clientY - r.top) / r.height));
      onMover(x, y);
    },
    [onMover],
  );

  return (
    <div className="hl-palco">
      <div ref={areaRef} className="hl-palco-area">
        <div
          ref={caixaRef}
          className={'hl-palco-quadro' + (arrastando ? ' is-arrastando' : '')}
          style={box.w > 0 ? { width: box.w, height: box.h } : undefined}
          onPointerDown={(e) => {
            try {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            } catch {
              /* ponteiro já solto: o arrasto segue pelos onPointerMove */
            }
            setArrastando(true);
            daPonta(e);
          }}
          onPointerMove={(e) => {
            if (arrastando) daPonta(e);
          }}
          onPointerUp={() => setArrastando(false)}
          onPointerCancel={() => setArrastando(false)}
          title="Arrasta pra posicionar a manchete"
        >
          <canvas ref={ref} className="hl-palco-canvas" aria-hidden />
          {!pronto ? <span className="hl-palco-skel" aria-hidden /> : null}
          <span
            className="hl-mira"
            style={{ left: `${(cfg.posX ?? 0.5) * 100}%`, top: `${cfg.posY * 100}%` }}
            aria-hidden
          />
          <span className="hl-palco-dica" aria-hidden>
            arrasta pra posicionar
          </span>
        </div>
      </div>
      <div className="hl-palco-coord">
        <span>x {Math.round((cfg.posX ?? 0.5) * 100)}%</span>
        <span>y {Math.round(cfg.posY * 100)}%</span>
        <button type="button" className="hl-mini" onClick={() => onMover(0.5, 0.24)} title="Volta pro alto e ao centro">
          centralizar
        </button>
      </div>
    </div>
  );
}

/* ═══════════════ miniatura de MODELO (a paleta de estilos) ══════════════ */

function MiniModelo({ presetId, texto, ativo }: { presetId: string; texto: string; ativo: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    let morto = false;
    (async () => {
      try {
        const [hl, fonts] = await Promise.all([
          import('@/lib/typography/headline'),
          import('@/lib/typography/fonts'),
        ]);
        try {
          await fonts.ensureTypoFonts();
        } catch {
          /* ok */
        }
        if (morto) return;
        const c = ref.current;
        if (!c) return;
        const W = 150;
        const H = 266;
        c.width = W;
        c.height = H;
        const g = c.getContext('2d')!;
        cenaDeFundo(g, W, H);
        hl.drawHeadline(
          g,
          {
            id: 'm',
            text: texto || 'SUA MANCHETE AQUI',
            start: 0,
            end: 9999,
            style: { ...hl.HEADLINE_STYLE_DEFAULT, presetId, posY: 0.34 },
          },
          W,
          H,
        );
        if (!morto) setPronto(true);
      } catch {
        if (!morto) setPronto(true);
      }
    })();
    return () => {
      morto = true;
    };
  }, [presetId, texto]);
  return (
    <span className={'hl-thumb-wrap' + (pronto ? ' is-pronto' : '') + (ativo ? ' is-on' : '')}>
      <canvas ref={ref} className="hl-thumb" aria-hidden />
      {!pronto ? <span className="hl-thumb-skel" aria-hidden /> : null}
    </span>
  );
}

/* ══════════════════════ peças de controle reusadas ══════════════════════ */

function Regua({
  rotulo,
  valor,
  mostra,
  min,
  max,
  passo,
  onMudar,
  aoZerar,
}: {
  rotulo: string;
  /** o número exibido no chip (ex.: "70%") */
  mostra: string;
  valor: number;
  min: number;
  max: number;
  passo: number;
  onMudar: (v: number) => void;
  aoZerar?: () => void;
}) {
  return (
    <>
      <div className="hl-rotulo mt">
        {rotulo}
        <span className="hl-valor">{mostra}</span>
        {aoZerar ? (
          <button type="button" className="hl-zerar" onClick={aoZerar} title="Volta ao padrão do modelo" aria-label="Voltar ao padrão">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
        ) : null}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(e) => onMudar(parseFloat(e.target.value))}
        className="hl-slider"
      />
    </>
  );
}

function Segmentado<T extends string | boolean | null>({
  rotulo,
  opcoes,
  valor,
  onMudar,
}: {
  rotulo: string;
  opcoes: Array<{ v: T; txt?: string; icone?: ReactNode; title?: string }>;
  valor: T;
  onMudar: (v: T) => void;
}) {
  return (
    <>
      <div className="hl-rotulo mt">{rotulo}</div>
      <div className="hl-seg">
        {opcoes.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            title={o.title}
            className={'hl-seg-item' + (valor === o.v ? ' is-on' : '')}
            onClick={() => onMudar(o.v)}
          >
            {o.icone ?? o.txt}
          </button>
        ))}
      </div>
    </>
  );
}

/** Paleta + cor livre. O input nativo dá o quadrado de tom, a barra de matiz
 *  e o CONTA-GOTAS do Chrome — e por ser overlay nativo fica acima de
 *  qualquer portal, coisa que um popover custom não garante aqui. */
function Cores({
  rotulo,
  valor,
  onMudar,
}: {
  rotulo: string;
  valor: string | null;
  onMudar: (v: string | null) => void;
}) {
  const SW = [
    '#ffffff', '#0b0d12', '#fbbf24', '#ff9f0a', '#e8192c', '#f472b6',
    '#22d3ee', '#31c4ff', '#4ade80', '#2edb84', '#a78bfa', '#7c5cff',
  ];
  const custom = valor !== null && !SW.includes(valor);
  return (
    <>
      <div className="hl-rotulo mt">{rotulo}</div>
      <div className="hl-cores">
        <button
          type="button"
          title="padrão do modelo"
          className={'hl-cor is-auto' + (valor === null ? ' is-on' : '')}
          onClick={() => onMudar(null)}
        >
          A
        </button>
        {SW.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={'hl-cor' + (valor === c ? ' is-on' : '')}
            style={{ background: c }}
            onClick={() => onMudar(c)}
          />
        ))}
        <label
          className={'hl-cor is-livre' + (custom ? ' is-on' : '')}
          title="Cor livre — abre o seletor com conta-gotas"
          style={custom && valor ? { background: valor } : undefined}
        >
          <input
            type="color"
            value={valor && /^#[0-9a-f]{6}$/i.test(valor) ? valor : '#ffffff'}
            onChange={(e) => onMudar(e.target.value)}
            className="hl-cor-input"
          />
          {!custom ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m2 22 1-5L16 4l4 4L7 21l-5 1z" />
              <path d="m14 6 4 4" />
            </svg>
          ) : null}
        </label>
      </div>
    </>
  );
}

/* ═════════════════════════════ a janela ═════════════════════════════════ */

export function PilotHeadlineModal({
  cfg,
  partes,
  onFechar,
  onMudar,
}: {
  cfg: HeadlineCfg;
  /** a copy já dividida — pra escolher até onde a headline fica */
  partes: Array<{ label: string; text: string }>;
  onFechar: () => void;
  onMudar: (c: HeadlineCfg, virarPadrao?: boolean) => void;
}) {
  const [montado, setMontado] = useState(false);
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [fontes, setFontes] = useState<Array<{ k: string; label: string }>>([]);
  useEffect(() => setMontado(true), []);
  // trava o scroll da página — a roda do mouse rolava o fundo (02.09)
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = antes;
    };
  }, []);
  useEffect(() => {
    void import('@/lib/typography/headline').then((m) =>
      setPresets(m.HEADLINE_PRESETS.map((p) => ({ id: p.id, name: p.name }))),
    );
    void import('@/lib/typography/fonts').then((m) =>
      setFontes(Object.entries(m.TYPO_FONTS).map(([k, f]) => ({ k, label: (f as { label: string }).label }))),
    );
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  if (!montado) return null;
  const comTexto = partes.filter((p) => (p.text || '').trim());
  const hook = comTexto.find((p) => /^(hook|gancho)/i.test(p.label));
  const auto = hook ? (hook.text.split(/(?<=[.!?])\s+/)[0] || hook.text).trim().slice(0, 120) : '';
  const textoVivo = cfg.texto.trim() || auto;
  const mudar = (p: Partial<HeadlineCfg>) => onMudar({ ...cfg, ...p });

  return createPortal(
    <div className="hl-camada" role="dialog" aria-modal="true" aria-label="Headline">
      <div className="hl-veu" onClick={onFechar} aria-hidden />
      <div className="hl-janela is-larga">
        <div className="hl-cab">
          <span className="hl-tile" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 11h11M4 16h7" />
            </svg>
          </span>
          <span className="hl-cab-textos">
            <span className="hl-titulo">Headline</span>
          </span>
          <button type="button" className="hl-x" onClick={onFechar} aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onMudar({ ...cfg, on: !cfg.on })}
          className={'hl-switch' + (cfg.on ? ' is-on' : '')}
          aria-pressed={cfg.on}
        >
          <span className="hl-switch-trilho" aria-hidden>
            <span className="hl-switch-bola" />
          </span>
          <span className="hl-switch-txt">{cfg.on ? 'Ligada — o AD sai com a manchete' : 'Desligada — clica pra ligar'}</span>
        </button>

        <div className={'hl-duas' + (cfg.on ? '' : ' is-off')}>
          {/* ── COLUNA 1: o palco ── */}
          <PalcoDaHeadline cfg={cfg} texto={textoVivo} onMover={(posX, posY) => mudar({ on: true, posX, posY })} />

          {/* ── COLUNA 2: os controles ── */}
          <div className="hl-controles">
            <div className="hl-rotulo">
              Texto
              {!cfg.texto.trim() && auto ? <span className="hl-rotulo-nota">vazio: usa a 1ª frase do hook</span> : null}
            </div>
            <textarea
              value={cfg.texto}
              onChange={(e) => mudar({ texto: e.target.value })}
              rows={2}
              placeholder={auto || 'A manchete que segura o olho'}
              className="hl-input"
            />

            <div className="hl-rotulo mt">
              Modelo
              <span className="hl-rotulo-nota">{presets.find((p) => p.id === cfg.presetId)?.name || ''}</span>
            </div>
            <div className="hl-tira">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => mudar({ on: true, presetId: p.id })}
                  className={'hl-card' + (cfg.presetId === p.id ? ' is-on' : '')}
                  title={p.name}
                >
                  <MiniModelo presetId={p.id} texto={textoVivo} ativo={cfg.presetId === p.id} />
                  <span className="hl-card-nome">{p.name}</span>
                </button>
              ))}
            </div>

            {/* FONTE + B/I/U numa linha só, como num editor de texto */}
            <div className="hl-rotulo mt">Fonte</div>
            <div className="hl-linha-fonte">
              <select
                value={cfg.font ?? ''}
                onChange={(e) => mudar({ on: true, font: e.target.value || null })}
                className="hl-select"
                title="Fonte da headline"
              >
                <option value="">padrão do modelo</option>
                {fontes.map((f) => (
                  <option key={f.k} value={f.k}>{f.label}</option>
                ))}
              </select>
              <button
                type="button"
                className={'hl-biu font-black' + (cfg.bold ? ' is-on' : '')}
                onClick={() => mudar({ on: true, bold: !cfg.bold })}
                title="Negrito"
              >
                B
              </button>
              <button
                type="button"
                className={'hl-biu italic' + (cfg.italic ? ' is-on' : '')}
                onClick={() => mudar({ on: true, italic: !cfg.italic })}
                title="Itálico"
              >
                I
              </button>
              <button
                type="button"
                className={'hl-biu underline' + (cfg.underline ? ' is-on' : '')}
                onClick={() => mudar({ on: true, underline: !cfg.underline })}
                title="Sublinhado"
              >
                S
              </button>
            </div>

            <Regua
              rotulo="Tamanho"
              mostra={`${Math.round((cfg.fontScale ?? 1) * 100)}%`}
              valor={cfg.fontScale ?? 1}
              min={HEADLINE_LIMITES.fontScale.min}
              max={HEADLINE_LIMITES.fontScale.max}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, fontScale: v })}
              aoZerar={(cfg.fontScale ?? 1) !== 1 ? () => mudar({ fontScale: 1 }) : undefined}
            />

            <Regua
              rotulo="Largura do bloco"
              mostra={`${Math.round((cfg.width ?? 0.9) * 100)}%`}
              valor={cfg.width ?? 0.9}
              min={HEADLINE_LIMITES.width.min}
              max={HEADLINE_LIMITES.width.max}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, width: v })}
              aoZerar={(cfg.width ?? 0.9) !== 0.9 ? () => mudar({ width: 0.9 }) : undefined}
            />

            <Segmentado<Alinhamento | null>
              rotulo="Alinhamento"
              opcoes={[
                { v: null, txt: 'padrão' },
                { v: 'left', title: 'à esquerda', icone: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h13" /></svg>
                ) },
                { v: 'center', title: 'centralizado', icone: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M7 12h10M5.5 18h13" /></svg>
                ) },
                { v: 'right', title: 'à direita', icone: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M10 12h10M7 18h13" /></svg>
                ) },
              ]}
              valor={(cfg.align ?? null) as Alinhamento | null}
              onMudar={(v) => mudar({ on: true, align: v })}
            />

            <Segmentado<boolean | null>
              rotulo="Caixa"
              opcoes={[
                { v: null, txt: 'padrão' },
                { v: true, txt: 'AA', title: 'tudo em maiúscula' },
                { v: false, txt: 'Aa', title: 'como escrito' },
              ]}
              valor={cfg.uppercase ?? null}
              onMudar={(v) => mudar({ on: true, uppercase: v })}
            />

            <Segmentado<'solido' | 'faixa' | 'nenhum' | null>
              rotulo="Fundo"
              opcoes={[
                { v: null, txt: 'padrão' },
                { v: 'solido', txt: 'sólido' },
                { v: 'faixa', txt: 'faixa' },
                { v: 'nenhum', txt: 'nenhum' },
              ]}
              valor={cfg.panel ?? null}
              onMudar={(v) => mudar({ on: true, panel: v })}
            />

            {(cfg.panel ?? null) !== 'nenhum' ? (
              <>
                <Regua
                  rotulo="Opacidade do fundo"
                  mostra={cfg.panelOpacity == null ? 'padrão' : `${Math.round(cfg.panelOpacity * 100)}%`}
                  valor={cfg.panelOpacity ?? 0.85}
                  min={0}
                  max={1}
                  passo={0.05}
                  onMudar={(v) => mudar({ on: true, panelOpacity: v })}
                  aoZerar={cfg.panelOpacity != null ? () => mudar({ panelOpacity: null }) : undefined}
                />
                <Cores rotulo="Cor do fundo" valor={cfg.panelColor ?? null} onMudar={(v) => mudar({ on: true, panelColor: v })} />
              </>
            ) : null}

            <Cores rotulo="Cor do texto" valor={cfg.color ?? null} onMudar={(v) => mudar({ on: true, color: v })} />

            <Regua
              rotulo="Traço (contorno)"
              mostra={(cfg.stroke ?? 0) > 0 ? `${Math.round((cfg.stroke ?? 0) * 100)}%` : 'off'}
              valor={cfg.stroke ?? 0}
              min={0}
              max={1}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, stroke: v })}
              aoZerar={(cfg.stroke ?? 0) > 0 ? () => mudar({ stroke: null, strokeColor: null }) : undefined}
            />
            {(cfg.stroke ?? 0) > 0 ? (
              <Cores rotulo="Cor do traço" valor={cfg.strokeColor ?? null} onMudar={(v) => mudar({ strokeColor: v })} />
            ) : null}

            <Regua
              rotulo="Sombra"
              mostra={cfg.shadowForca == null ? 'padrão' : cfg.shadowForca > 0 ? `${Math.round(cfg.shadowForca * 100)}%` : 'off'}
              valor={cfg.shadowForca ?? 0}
              min={0}
              max={1}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, shadowForca: v })}
              aoZerar={cfg.shadowForca != null ? () => mudar({ shadowForca: null }) : undefined}
            />

            <Regua
              rotulo="Brilho"
              mostra={(cfg.glow ?? 0) > 0 ? `${Math.round((cfg.glow ?? 0) * 100)}%` : 'off'}
              valor={cfg.glow ?? 0}
              min={0}
              max={1}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, glow: v })}
              aoZerar={(cfg.glow ?? 0) > 0 ? () => mudar({ glow: null, glowColor: null }) : undefined}
            />
            {(cfg.glow ?? 0) > 0 ? (
              <Cores rotulo="Cor do brilho" valor={cfg.glowColor ?? null} onMudar={(v) => mudar({ glowColor: v })} />
            ) : null}

            <div className="hl-rotulo mt">Fica até o fim de</div>
            <div className="hl-partes">
              {comTexto.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => mudar({ on: true, ancoraAte: p.label })}
                  className={'hl-parte' + (cfg.ancoraAte === p.label ? ' is-on' : '')}
                  title={p.text.slice(0, 90)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="hl-nota-fim">a saída pula pro corte mais próximo — o corte mascara o sumiço</div>
          </div>
        </div>

        <div className="hl-rodape">
          <button
            type="button"
            className="hl-padrao"
            onClick={() => onMudar(cfg, true)}
            title="Grava como padrão da conta — as próximas tasks já vêm assim"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
            usar sempre
          </button>
          <button type="button" className="hl-ok" onClick={onFechar}>
            Pronto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
