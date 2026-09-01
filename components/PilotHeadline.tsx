'use client';

/**
 * JANELA DA HEADLINE do ClickUp Pilot (01.09).
 *
 * Headline é o texto PARADO por cima do vídeo — a manchete que segura o olho
 * enquanto o avatar fala. Aqui o editor escolhe o modelo, o texto, a altura na
 * tela e ATÉ ONDE da copy ela fica.
 *
 * O detalhe que faz a diferença: a saída dela é puxada pro CORTE mais próximo
 * (lib/pilot-inserts). Texto que some no meio da fala denuncia o automático,
 * porque nada mais na tela muda junto; no corte, a troca de imagem mascara.
 * A janela diz isso na cara do editor, não escondido num comentário.
 *
 * Cada modelo é previsto com o MOTOR REAL (drawHeadline num canvas 9:16), então
 * o card mostra exatamente o que sai no vídeo.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HeadlineCfg } from '@/lib/pilot-inserts';

/* ═══════════════ preview REAL do modelo (motor das headlines) ═══════════ */

function PreviewDaHeadline({
  presetId,
  texto,
  posY,
  ativo,
}: {
  presetId: string;
  texto: string;
  posY: number;
  ativo: boolean;
}) {
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
          /* fallback: o preview ainda mostra painel, cor e posição */
        }
        if (morto) return;
        const c = ref.current;
        if (!c) return;
        const W = 270;
        const H = 480;
        c.width = W;
        c.height = H;
        const g = c.getContext('2d')!;

        // cena fake: o vídeo por baixo
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
        g.arc(W / 2, H * 0.6, 40, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(64,76,96,0.85)';
        g.beginPath();
        g.ellipse(W / 2, H * 0.88, 80, 105, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();

        hl.drawHeadline(
          g,
          {
            id: 'p',
            text: texto || 'SUA MANCHETE AQUI',
            start: 0,
            end: 9999,
            style: { ...hl.HEADLINE_STYLE_DEFAULT, presetId, posY },
          },
          W,
          H,
        );
        if (!morto) setPronto(true);
      } catch (e) {
        console.warn('[PilotHeadline] preview falhou:', e);
        if (!morto) setPronto(true);
      }
    })();
    return () => {
      morto = true;
    };
  }, [presetId, texto, posY]);

  return (
    <span className={'hl-thumb-wrap' + (pronto ? ' is-pronto' : '') + (ativo ? ' is-on' : '')}>
      <canvas ref={ref} className="hl-thumb" aria-hidden />
      {!pronto ? <span className="hl-thumb-skel" aria-hidden /> : null}
    </span>
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
  useEffect(() => setMontado(true), []);
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

  return createPortal(
    <div className="hl-camada" role="dialog" aria-modal="true" aria-label="Headline">
      <div className="hl-veu" onClick={onFechar} aria-hidden />
      <div className="hl-janela">
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
          <span className="hl-switch-txt">
            {cfg.on ? 'Ligada — o AD sai com a manchete' : 'Desligada — clica pra ligar'}
          </span>
        </button>

        <div className={'hl-corpo' + (cfg.on ? '' : ' is-off')}>
          {/* TEXTO */}
          <div className="hl-rotulo">
            Texto
            {!cfg.texto.trim() && auto ? (
              <span className="hl-rotulo-nota">vazio: usa a 1ª frase do hook</span>
            ) : null}
          </div>
          <textarea
            value={cfg.texto}
            onChange={(e) => onMudar({ ...cfg, texto: e.target.value })}
            rows={2}
            placeholder={auto || 'A manchete que segura o olho'}
            className="hl-input"
          />

          {/* MODELOS com preview real */}
          <div className="hl-rotulo mt">Modelo</div>
          <div className="hl-grade">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onMudar({ ...cfg, on: true, presetId: p.id })}
                className={'hl-card' + (cfg.presetId === p.id ? ' is-on' : '')}
              >
                <PreviewDaHeadline
                  presetId={p.id}
                  texto={cfg.texto.trim() || auto}
                  posY={cfg.posY}
                  ativo={cfg.presetId === p.id}
                />
                <span className="hl-card-nome">{p.name}</span>
              </button>
            ))}
          </div>

          {/* POSIÇÃO */}
          <div className="hl-rotulo mt">
            Altura na tela
            <span className="hl-rotulo-nota">{Math.round(cfg.posY * 100)}% do topo</span>
          </div>
          <input
            type="range"
            min={0.08}
            max={0.88}
            step={0.02}
            value={cfg.posY}
            onChange={(e) => onMudar({ ...cfg, posY: parseFloat(e.target.value) })}
            className="hl-slider"
          />

          {/* ATÉ ONDE FICA */}
          <div className="hl-rotulo mt">
            Fica até o fim de
            <span className="hl-rotulo-nota">a saída pula pro corte mais próximo</span>
          </div>
          <div className="hl-partes">
            {comTexto.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onMudar({ ...cfg, on: true, ancoraAte: p.label })}
                className={'hl-parte' + (cfg.ancoraAte === p.label ? ' is-on' : '')}
                title={p.text.slice(0, 90)}
              >
                {p.label}
              </button>
            ))}
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
