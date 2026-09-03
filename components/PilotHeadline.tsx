'use client';

/**
 * JANELA DA HEADLINE do ClickUp Pilot (01.09 · controles em 02.09).
 *
 * Headline é o texto PARADO por cima do vídeo — a manchete que segura o olho
 * enquanto o avatar fala.
 *
 * A saída dela é puxada pro CORTE mais próximo (lib/pilot-inserts). Texto que
 * some no meio da fala denuncia o automático, porque nada mais na tela muda
 * junto; no corte, a troca de imagem mascara.
 *
 * 02.09 — Silas: *"aqui eu escolho a headline, mas não escolho a posição,
 * tamanho, nem nada"*. O motor (`drawHeadline`) sempre soube posicionar,
 * dimensionar, alinhar e pintar; a janela é que só mandava modelo e altura.
 * Agora ela manda tudo, e o PALCO é o controle principal: arrasta a manchete
 * onde ela tem que ficar, no preview do motor REAL — o que se vê aqui é o que
 * sai no MP4.
 *
 * Todo ajuste fino aceita "do modelo" (null). Sem esse estado, mexer numa
 * coisa só apagaria a identidade do preset — foi assim que a cartela de
 * citação, que é centralizada, passou a sair à esquerda.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
function estiloDaCfg(base: Record<string, unknown>, cfg: HeadlineCfg) {
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
  };
}

/* ═════════════ PALCO: preview grande, com arrasto pra posicionar ═════════ */

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
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [pronto, setPronto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const rafRef = useRef<number | null>(null);

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
            style: estiloDaCfg(hl.HEADLINE_STYLE_DEFAULT as never, cfg) as never,
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
    // rAF: o arrasto redesenha a cada movimento do dedo; sem isto a janela
    // engasgava enfileirando desenhos que já nasciam velhos.
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
      <div
        ref={caixaRef}
        className={'hl-palco-quadro' + (arrastando ? ' is-arrastando' : '')}
        onPointerDown={(e) => {
          try {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          } catch {
            /* ponteiro já solto: o arrasto segue pelos onPointerMove mesmo */
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
        {/* mira: mostra o CENTRO do bloco, que é o que posX/posY controlam */}
        <span
          className="hl-mira"
          style={{ left: `${(cfg.posX ?? 0.5) * 100}%`, top: `${cfg.posY * 100}%` }}
          aria-hidden
        />
        <span className="hl-palco-dica" aria-hidden>
          arrasta pra posicionar
        </span>
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
        // A miniatura mostra o MODELO puro (posição neutra): ela é escolha de
        // ESTILO, não de posição — quem posiciona é o palco.
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
  nota,
  valor,
  min,
  max,
  passo,
  onMudar,
  aoZerar,
}: {
  rotulo: string;
  nota: string;
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
        <span className="hl-rotulo-nota">{nota}</span>
        {aoZerar ? (
          <button type="button" className="hl-zerar" onClick={aoZerar} title="Volta ao padrão">
            padrão
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
  nota,
  opcoes,
  valor,
  onMudar,
}: {
  rotulo: string;
  nota?: string;
  opcoes: Array<{ v: T; txt: string; title?: string }>;
  valor: T;
  onMudar: (v: T) => void;
}) {
  return (
    <>
      <div className="hl-rotulo mt">
        {rotulo}
        {nota ? <span className="hl-rotulo-nota">{nota}</span> : null}
      </div>
      <div className="hl-seg">
        {opcoes.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            title={o.title}
            className={'hl-seg-item' + (valor === o.v ? ' is-on' : '')}
            onClick={() => onMudar(o.v)}
          >
            {o.txt}
          </button>
        ))}
      </div>
    </>
  );
}

/** Cores do texto. "do modelo" é a primeira — é o estado que preserva o preset. */
const CORES: Array<{ v: string | null; nome: string }> = [
  { v: null, nome: 'do modelo' },
  { v: '#ffffff', nome: 'branco' },
  { v: '#0b0d12', nome: 'preto' },
  { v: '#fbbf24', nome: 'âmbar' },
  { v: '#22d3ee', nome: 'ciano' },
  { v: '#4ade80', nome: 'verde' },
  { v: '#f87171', nome: 'vermelho' },
];

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
            <span className="hl-sub">
              Texto parado por cima do vídeo. A saída dela cai num corte — é o corte que mascara o sumiço.
            </span>
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

            <Regua
              rotulo="Tamanho"
              nota={`${Math.round((cfg.fontScale ?? 1) * 100)}%`}
              valor={cfg.fontScale ?? 1}
              min={HEADLINE_LIMITES.fontScale.min}
              max={HEADLINE_LIMITES.fontScale.max}
              passo={0.05}
              onMudar={(v) => mudar({ on: true, fontScale: v })}
              aoZerar={(cfg.fontScale ?? 1) !== 1 ? () => mudar({ fontScale: 1 }) : undefined}
            />

            <Regua
              rotulo="Largura do bloco"
              nota={`${Math.round((cfg.width ?? 0.9) * 100)}% da tela — daqui sai a quebra de linha`}
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
                { v: null, txt: 'do modelo' },
                { v: 'left', txt: '⟨', title: 'à esquerda' },
                { v: 'center', txt: '≡', title: 'centralizado' },
                { v: 'right', txt: '⟩', title: 'à direita' },
              ]}
              valor={(cfg.align ?? null) as Alinhamento | null}
              onMudar={(v) => mudar({ on: true, align: v })}
            />

            <Segmentado<boolean | null>
              rotulo="Caixa"
              opcoes={[
                { v: null, txt: 'do modelo' },
                { v: true, txt: 'MAIÚSCULA' },
                { v: false, txt: 'como escrito' },
              ]}
              valor={cfg.uppercase ?? null}
              onMudar={(v) => mudar({ on: true, uppercase: v })}
            />

            <Segmentado<'solido' | 'faixa' | 'nenhum' | null>
              rotulo="Fundo"
              nota="a caixa atrás do texto"
              opcoes={[
                { v: null, txt: 'do modelo' },
                { v: 'solido', txt: 'sólido' },
                { v: 'faixa', txt: 'faixa' },
                { v: 'nenhum', txt: 'nenhum' },
              ]}
              valor={cfg.panel ?? null}
              onMudar={(v) => mudar({ on: true, panel: v })}
            />

            {(cfg.panel ?? null) !== 'nenhum' ? (
              <Regua
                rotulo="Opacidade do fundo"
                nota={cfg.panelOpacity == null ? 'do modelo' : `${Math.round(cfg.panelOpacity * 100)}%`}
                valor={cfg.panelOpacity ?? 0.85}
                min={0}
                max={1}
                passo={0.05}
                onMudar={(v) => mudar({ on: true, panelOpacity: v })}
                aoZerar={cfg.panelOpacity != null ? () => mudar({ panelOpacity: null }) : undefined}
              />
            ) : null}

            <div className="hl-rotulo mt">
              Cor do texto
              <span className="hl-rotulo-nota">{CORES.find((c) => c.v === (cfg.color ?? null))?.nome || 'personalizada'}</span>
            </div>
            <div className="hl-cores">
              {CORES.map((c) => (
                <button
                  key={c.nome}
                  type="button"
                  title={c.nome}
                  className={'hl-cor' + ((cfg.color ?? null) === c.v ? ' is-on' : '') + (c.v === null ? ' is-auto' : '')}
                  style={c.v ? { background: c.v } : undefined}
                  onClick={() => mudar({ on: true, color: c.v })}
                >
                  {c.v === null ? 'A' : ''}
                </button>
              ))}
            </div>

            <div className="hl-rotulo mt">
              Fica até o fim de
              <span className="hl-rotulo-nota">a saída pula pro corte mais próximo</span>
            </div>
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
