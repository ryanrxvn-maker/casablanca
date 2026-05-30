'use client';

/**
 * GlobalSearch — busca rápida estilo Spotlight/Cmd-K.
 *
 *  ▸ Botão na TopBar abre um modal flutuante centralizado.
 *  ▸ Atalho global Ctrl/⌘ + K (igual ao Linear/Notion/Vercel).
 *  ▸ Indexa ferramentas, atalhos do app, configurações e ações comuns.
 *  ▸ Navegação por teclado: ↑ ↓ Enter, Esc fecha.
 *  ▸ Pontuação: prefix match > substring match > fuzzy.
 *
 * Sem dependência externa — fuzzy próprio bem leve.
 */

import { useRouter } from 'next/navigation';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCamuflagem,
  IconCalculadora,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconNormalizador,
  IconRemoverElementos,
  IconSeparadorAudio,
  IconSearch,
  IconStepGear,
  IconTrocaProduto,
} from './ToolIcons';

type Entry = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  /** Palavras-chave extras (não exibidas) — ajudam o match */
  keywords?: string[];
  icon: ReactNode;
  /** Categoria pra exibir em grupos */
  group: 'Ferramentas' | 'IA' | 'Atalhos' | 'Configurações' | 'Conta';
};

/** Banco fixo — sempre em sincronia com o resto do app. */
const ENTRIES: Entry[] = [
  // Ferramentas Base
  { id: 'decupagem', group: 'Ferramentas', label: 'Decupagem', hint: 'Corta silêncios de vídeo/áudio', href: '/tools/decupagem', icon: <IconDecupagem size={20} />, keywords: ['silencio', 'silêncio', 'cortar', 'pausa'] },
  { id: 'camuflagem', group: 'Ferramentas', label: 'Camuflagem', hint: 'Disfarça áudio dos detectores', href: '/tools/camuflagem', icon: <IconCamuflagem size={20} />, keywords: ['anti detector', 'meta', 'ia', 'whisper'] },
  { id: 'downloader', group: 'Ferramentas', label: 'Downloader', hint: 'Baixa de YouTube, TikTok, Insta e Pinterest', href: '/tools/downloader', icon: <IconDownloader size={20} />, keywords: ['youtube', 'tiktok', 'instagram', 'pinterest', 'baixar', 'download'] },
  { id: 'compressor', group: 'Ferramentas', label: 'Compressor', hint: 'Reduz peso do arquivo', href: '/tools/compressor', icon: <IconCompressor size={20} />, keywords: ['comprimir', 'reduzir', 'tamanho'] },
  { id: 'audio-split', group: 'Ferramentas', label: 'Dividir áudios', hint: 'Divide pelo silêncio', href: '/tools/audio-split', icon: <IconAudioSplit size={20} />, keywords: ['split', 'dividir', 'separar'] },
  { id: 'acelerador', group: 'Ferramentas', label: 'Mixer de Velocidade', hint: 'Acelera/desacelera sem ficar robótico', href: '/tools/acelerador', icon: <IconAcelerador size={20} />, keywords: ['velocidade', 'speed', 'rápido', 'lento'] },
  { id: 'normalizador', group: 'Ferramentas', label: 'Normalizador', hint: 'Iguala volume de vários arquivos', href: '/tools/normalizador', icon: <IconNormalizador size={20} />, keywords: ['volume', 'loudness', 'lufs', 'normalizar'] },
  { id: 'separador-audio', group: 'IA', label: 'Separador de Áudio', hint: 'Separa voz, instrumental e SFX', href: '/tools/separador-audio', icon: <IconSeparadorAudio size={20} />, keywords: ['stem', 'spleeter', 'demucs', 'voz', 'instrumental', 'sfx', 'karaoke'] },
  { id: 'calculadora', group: 'Ferramentas', label: 'Calculadora', hint: 'Cálculo de preço por minuto', href: '/tools/calculadora', icon: <IconCalculadora size={20} />, keywords: ['valor', 'preço', 'orçamento'] },

  // IA
  { id: 'auto-broll', group: 'IA', label: 'Auto B-roll', hint: 'Gera B-rolls em massa pelo JSON', href: '/tools/auto-broll', icon: <IconAutoBroll size={20} />, keywords: ['broll', 'b-roll', 'magnific'] },
  { id: 'troca-produto', group: 'IA', label: 'Troca de produto', hint: 'Substitui produto do áudio', href: '/tools/troca-produto', icon: <IconTrocaProduto size={20} />, keywords: ['voz', 'clone', 'eleven', 'voiceover'] },
  { id: 'remover', group: 'IA', label: 'Remover Legenda/Marca d’Água', hint: 'Remove legenda e marca d’água', href: '/tools/remover-elementos', icon: <IconRemoverElementos size={20} />, keywords: ['smart remover', 'watermark', 'marca', 'logo', 'inpaint'] },
  { id: 'decupagem-copy', group: 'IA', label: 'Decupagem Inteligente', hint: 'Decupa seguindo sua copy', href: '/tools/decupagem-copy', icon: <IconDecupageCopy size={20} />, keywords: ['smart decup', 'script', 'roteiro'] },
  { id: 'copy-srt', group: 'IA', label: 'Gerador de SRT', hint: 'Legendas no tempo do seu áudio', href: '/tools/copy-srt', icon: <IconCopySRT size={20} />, keywords: ['srt generator', 'legenda', 'subtitle'] },
  { id: 'heygen-auto', group: 'IA', label: 'HeyGen Auto', hint: 'Lipsync automático em lote', href: '/tools/heygen-auto', icon: <IconHeyGenAuto size={20} />, keywords: ['avatar', 'lipsync', 'falar'] },

  // Atalhos
  { id: 'home', group: 'Atalhos', label: 'Início', hint: 'Hub principal', href: '/tools', icon: <IconSearch size={20} />, keywords: ['hub', 'home'] },
  // pilot-tool é renderizado como destaque (FEATURED) — não duplicar nos atalhos.
  // Mantemos o id e as keywords aqui pra o scoring funcionar igual ao resto da app.
  { id: 'pilot-tool', group: 'Atalhos', label: 'ClickUp Pilot', hint: 'Disparar automação agora', href: '/tools/clickup-pilot', icon: <IconClickUpPilot size={20} />, keywords: ['automatizar', 'rodar', 'automação', 'clickup', 'avatar', 'briefing', 'pilot'] },
  { id: 'background', group: 'Atalhos', label: 'Tarefas em segundo plano', hint: 'Acompanha jobs rodando', href: '/tools/background', icon: <IconStepGear size={20} />, keywords: ['bg', 'fila', 'job', 'running'] },
  { id: 'history', group: 'Atalhos', label: 'Histórico de avatares', hint: 'Lipsyncs anteriores', href: '/tools/lipsync-history', icon: <IconHeyGenAuto size={20} />, keywords: ['history', 'lipsync', 'avatar'] },

  // Configurações
  { id: 'config', group: 'Configurações', label: 'Configurações', hint: 'Preferências da conta', href: '/configuracoes', icon: <IconStepGear size={20} />, keywords: ['settings', 'preferências'] },
  { id: 'config-api', group: 'Configurações', label: 'Chaves de IA', hint: 'Suas chaves de integração', href: '/configuracoes/api', icon: <IconStepGear size={20} />, keywords: ['groq', 'openai', 'eleven', 'anthropic', 'api', 'key'] },
  { id: 'config-pilot', group: 'Configurações', label: 'ClickUp Pilot · ajustes', hint: 'Tokens e workspace', href: '/configuracoes/clickup-pilot', icon: <IconStepGear size={20} />, keywords: ['clickup', 'token'] },

  // Conta
  { id: 'plans', group: 'Conta', label: 'Ver planos', hint: 'Free · Basic · Pro · Admin', href: '/planos?upgrade=1', icon: <IconStepGear size={20} />, keywords: ['plan', 'upgrade', 'pro', 'basic'] },
];

/**
 * Destaques — sempre no topo da pesquisa em cards 3D premium.
 *
 *  ▸ ClickUp Pilot · HeyGen Auto · Auto B-roll são os 3 carros-chefe
 *    do app. Quando o modal abre, eles aparecem em uma grid premium
 *    acima da lista normal.
 *  ▸ Cada um tem paleta própria (violeta, teal, ambar) — coerente
 *    com a identidade dos ícones e da landing.
 *  ▸ Quando o usuário digita, o destaque continua no topo SE bater
 *    com a query; caso contrário some (mantém o foco do search).
 */
type FeaturedDef = {
  id: string;
  label: string;
  hint: string;
  href: string;
  Icon: (p: { size?: number; strokeWidth?: number; className?: string }) => React.JSX.Element;
  /** Cor primária — usada no gradient do ícone e da borda conic. */
  primary: string;
  /** Cor secundária — segunda parada do gradient. */
  secondary: string;
  /** RGB sem alfa, pra montar rgba() no glow/box-shadow dinâmico. */
  glowRgb: string;
};

const FEATURED: FeaturedDef[] = [
  {
    id: 'pilot-tool',
    label: 'ClickUp Pilot',
    hint: 'Automação visual',
    href: '/tools/clickup-pilot',
    Icon: IconClickUpPilot,
    primary: '#c084fc',
    secondary: '#6d4ee8',
    glowRgb: '167, 139, 250',
  },
  {
    id: 'heygen-auto',
    label: 'HeyGen Auto',
    hint: 'Lipsync em lote',
    href: '/tools/heygen-auto',
    Icon: IconHeyGenAuto,
    primary: '#5eead4',
    secondary: '#06b6d4',
    glowRgb: '45, 212, 191',
  },
  {
    id: 'auto-broll',
    label: 'Auto B-roll',
    hint: 'B-rolls em massa pelo JSON',
    href: '/tools/auto-broll',
    Icon: IconAutoBroll,
    primary: '#f0abfc',
    secondary: '#a78bfa',
    glowRgb: '240, 171, 252',
  },
];

const FEATURED_ID_SET = new Set(FEATURED.map((f) => f.id));

/** Score 0-100. Quanto maior, mais relevante. 0 = não aparece. */
function score(q: string, e: Entry): number {
  const query = q.toLowerCase().trim();
  if (!query) return 1; // sem query: tudo passa com peso baixo
  const haystack = [e.label, e.hint || '', ...(e.keywords || [])]
    .join(' ')
    .toLowerCase();
  const label = e.label.toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 90;
  if (label.includes(query)) return 70;
  if (haystack.includes(query)) return 55;
  // fuzzy simples: todos os chars da query aparecem em ordem
  let i = 0;
  for (const ch of haystack) {
    if (ch === query[i]) i++;
    if (i === query.length) break;
  }
  if (i === query.length) return 30;
  return 0;
}

/**
 * Botão "Pesquisar" — pílula 3D estilo CTA da landing /planos.
 *
 *  ▸ Tilt 3D suave conforme o mouse (rotateX/Y baseado em posição relativa)
 *  ▸ Spotlight radial que segue o cursor (--gx/--gy)
 *  ▸ Sheen sweep diagonal no hover (faixa branca desliza de -120% a +120%)
 *  ▸ Glow violet ambiente que intensifica no hover
 *  ▸ Press effect com scale + lift inverso no :active
 *  ▸ Sem "Ctrl K" visível — atalho continua ativo (Cmd/Ctrl+K, "/")
 *
 * Vive solto na TopBar (fora do .topbar-cluster) pra ter espaço pra
 * respirar a pílula maior.
 */
export function GlobalSearchButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Atalho global Ctrl/⌘+K (e "/" pra quem prefere). Mantido mesmo
  // sem o chip visível: poder pra power-users sem poluir a UI.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmd = e.metaKey || e.ctrlKey;
      if (isCmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === '/' && !isInputFocused()) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleMove = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    const rotY = (px - 0.5) * 12;
    const rotX = -(py - 0.5) * 10;
    el.style.setProperty('--rx', `${rotX.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${rotY.toFixed(2)}deg`);
  };

  const handleLeave = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  };

  return (
    <>
      <div className="search-perspective">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen(true)}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          className="search-btn group"
          aria-label="Pesquisar"
          title="Pesquisar"
        >
          {/* CAMADA 0 — base com gradient sutil + glow ambient (sempre on) */}
          <span aria-hidden className="search-ambient" />

          {/* CAMADA 1 — borda cônica animada (conic gradient gira no hover) */}
          <span aria-hidden className="search-conic" />

          {/* CAMADA 2 — spotlight radial que segue o mouse */}
          <span aria-hidden className="search-spotlight" />

          {/* CAMADA 3 — sheen diagonal (faixa branca) */}
          <span aria-hidden className="search-sheen" />

          {/* CAMADA 4 — conteúdo (ícone + texto) */}
          <span className="search-icon">
            <IconSearch size={15} />
          </span>
          <span
            className="search-label"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Pesquisar
          </span>
        </button>
      </div>
      {open ? <SearchModal onClose={() => setOpen(false)} /> : null}

      <style jsx>{`
        .search-perspective {
          perspective: 800px;
          display: inline-block;
        }

        .search-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 36px;
          padding: 0 16px 0 13px;
          border-radius: 9999px;
          border: 1px solid rgba(167, 139, 250, 0.32);
          color: rgb(var(--text));
          background:
            linear-gradient(
              135deg,
              rgba(167, 139, 250, 0.18) 0%,
              rgba(45, 212, 191, 0.06) 60%,
              rgb(var(--bg-soft) / 0.9) 100%
            );
          overflow: hidden;
          cursor: pointer;
          isolation: isolate;
          transform-style: preserve-3d;
          transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))
            translateY(0px);
          transition:
            transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1),
            border-color 280ms ease,
            box-shadow 320ms ease;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            inset 0 -1px 0 rgba(0, 0, 0, 0.4),
            0 6px 18px -8px rgba(167, 139, 250, 0.35),
            0 1px 0 rgba(0, 0, 0, 0.45);
        }

        .search-btn:hover {
          border-color: rgba(167, 139, 250, 0.6);
          transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))
            translateY(-1.5px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.12),
            inset 0 -1px 0 rgba(0, 0, 0, 0.45),
            0 14px 30px -10px rgba(167, 139, 250, 0.55),
            0 0 28px -6px rgba(94, 234, 212, 0.4),
            0 1px 0 rgba(0, 0, 0, 0.45);
        }

        /* PRESS — afunda + scale + reset do tilt (sensação de clique físico) */
        .search-btn:active {
          transform: rotateX(0deg) rotateY(0deg) translateY(0px) scale(0.96);
          transition-duration: 80ms;
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.45),
            inset 0 0 0 1px rgba(167, 139, 250, 0.35),
            0 2px 8px -2px rgba(167, 139, 250, 0.4);
        }

        /* CAMADA 0 — ambient pulse (sempre on, intensifica no hover) */
        .search-ambient {
          position: absolute;
          inset: -10px;
          z-index: -2;
          border-radius: 9999px;
          background: radial-gradient(
            50% 80% at 50% 50%,
            rgba(167, 139, 250, 0.28),
            transparent 70%
          );
          opacity: var(--search-glow, 0.35);
          filter: blur(8px);
          transition: opacity 400ms ease;
          animation: search-ambient-pulse 3.4s ease-in-out infinite;
          pointer-events: none;
        }
        .search-btn:hover .search-ambient {
          opacity: 0.85;
        }
        @keyframes search-ambient-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.04); }
        }

        /* CAMADA 1 — conic border que gira no hover (efeito "rim light") */
        .search-conic {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          padding: 1px;
          background: conic-gradient(
            from var(--angle, 0deg),
            transparent 0%,
            rgba(167, 139, 250, 0.7) 25%,
            transparent 50%,
            rgba(94, 234, 212, 0.7) 75%,
            transparent 100%
          );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 400ms ease;
          animation: search-conic-spin 4s linear infinite paused;
          pointer-events: none;
        }
        .search-btn:hover .search-conic {
          opacity: 1;
          animation-play-state: running;
        }
        @keyframes search-conic-spin {
          to { --angle: 360deg; }
        }

        /* CAMADA 2 — spotlight radial que segue o cursor */
        .search-spotlight {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: radial-gradient(
            120px circle at var(--gx, 50%) var(--gy, 50%),
            rgba(255, 255, 255, 0.16),
            transparent 60%
          );
          opacity: 0;
          transition: opacity 280ms ease;
          pointer-events: none;
        }
        .search-btn:hover .search-spotlight {
          opacity: 1;
        }

        /* CAMADA 3 — sheen sweep no hover (mesmo padrão dos CTAs da landing) */
        .search-sheen {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: linear-gradient(
            115deg,
            transparent 30%,
            rgba(255, 255, 255, 0.32) 50%,
            transparent 70%
          );
          transform: translateX(-120%);
          transition: transform 800ms cubic-bezier(0.2, 0.9, 0.3, 1);
          pointer-events: none;
        }
        .search-btn:hover .search-sheen {
          transform: translateX(120%);
        }

        /* CAMADA 4 — ícone com glow próprio */
        .search-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #c084fc, #6d4ee8);
          color: var(--card-deep);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            0 4px 10px -2px rgba(167, 139, 250, 0.6);
          transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .search-btn:hover .search-icon {
          transform: rotate(-8deg) scale(1.08);
        }

        /* Texto — quase invisível em mobile (só ícone) */
        .search-label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -0.005em;
          color: rgb(var(--text));
          line-height: 1;
          white-space: nowrap;
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
        }
        @media (max-width: 640px) {
          .search-btn { padding: 0 10px; gap: 0; }
          .search-label { display: none; }
        }
      `}</style>
    </>
  );
}

function isInputFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Foca o input ao abrir
  useEffect(() => {
    inputRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Destaques sempre no topo. Sem query → todos. Com query → só os
  // que batem (consistência com o resto da lista; evita ruído visual
  // quando o usuário busca algo específico tipo "compressor").
  const featuredVisible = useMemo(() => {
    if (!q.trim()) return FEATURED;
    return FEATURED.filter((f) => {
      const e = ENTRIES.find((x) => x.id === f.id);
      return e ? score(q, e) > 0 : false;
    });
  }, [q]);

  // Resultados regulares — exclui IDs que já estão nos destaques
  // pra não duplicar entre os cards 3D e a lista de baixo.
  const results = useMemo(() => {
    const scored = ENTRIES
      .filter((e) => !FEATURED_ID_SET.has(e.id))
      .map((e) => ({ e, s: score(q, e) }))
      .filter((it) => it.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 24);
    return scored.map((it) => it.e);
  }, [q]);

  // Lista única pra keyboard nav: destaques primeiro, depois o resto.
  // Ordem aqui = ordem visual → setActive(idx) corresponde 1:1.
  type NavItem =
    | { kind: 'featured'; def: FeaturedDef }
    | { kind: 'regular'; entry: Entry };
  const navList = useMemo<NavItem[]>(
    () => [
      ...featuredVisible.map((def) => ({ kind: 'featured' as const, def })),
      ...results.map((entry) => ({ kind: 'regular' as const, entry })),
    ],
    [featuredVisible, results],
  );

  // Reset highlight quando muda query
  useEffect(() => setActive(0), [q]);

  // Agrupa regulares por group, preservando ordem
  const groups = useMemo(() => {
    const map = new Map<Entry['group'], Entry[]>();
    for (const r of results) {
      const arr = map.get(r.group) || [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return Array.from(map.entries());
  }, [results]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((v) => Math.min(navList.length - 1, v + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((v) => Math.max(0, v - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = navList[active];
      if (!sel) return;
      go(sel.kind === 'featured' ? sel.def.href : sel.entry.href);
    }
  }

  // Map index global -> tracking visual
  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]"
      onClick={onClose}
      style={{
        background: 'rgba(5,5,8,0.72)',
        backdropFilter: 'blur(8px) saturate(140%)',
        WebkitBackdropFilter: 'blur(8px) saturate(140%)',
        animation: 'gs-fade-in 180ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        className="w-full max-w-[640px] overflow-hidden rounded-[20px] border border-line/70 bg-bg-soft/95 shadow-2xl backdrop-blur-2xl"
        style={{
          animation: 'gs-pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          boxShadow:
            '0 32px 64px -16px rgba(0,0,0,0.7), 0 0 64px -16px rgba(167,139,250,0.32)',
        }}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3.5">
          <span className="text-violet">
            <IconSearch size={18} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar ferramenta, configuração, atalho…"
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line-strong bg-bg/40 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted transition hover:border-violet/50 hover:text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ESC
          </button>
        </div>

        {/* Lista */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {navList.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              Nada encontrado pra <span className="text-white">“{q}”</span>.
            </div>
          ) : (
            <>
              {featuredVisible.length > 0 ? (
                <div className="mb-3 px-1 pt-1">
                  <div className="mb-2 flex items-center gap-2 px-2">
                    <span
                      className="featured-section-title"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Destaques
                    </span>
                    <span aria-hidden className="featured-section-line" />
                    <span
                      aria-hidden
                      className="featured-section-pulse"
                      title="ferramentas estrela"
                    />
                  </div>
                  <div className="featured-grid">
                    {featuredVisible.map((def) => {
                      const idx = runningIdx++;
                      const isActive = idx === active;
                      return (
                        <FeaturedCard
                          key={def.id}
                          def={def}
                          active={isActive}
                          onFocusActive={() => setActive(idx)}
                          onActivate={() => go(def.href)}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {groups.map(([group, list]) => (
              <div key={group} className="mb-2">
                <div
                  className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.22em] text-text-dim"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {group}
                </div>
                <ul>
                  {list.map((e) => {
                    const idx = runningIdx++;
                    const isActive = idx === active;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(e.href)}
                          className={
                            'group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ' +
                            (isActive
                              ? 'bg-violet/15 text-white'
                              : 'text-text-muted hover:bg-bg/60 hover:text-white')
                          }
                        >
                          <span
                            className={
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition ' +
                              (isActive
                                ? 'border-violet/40 bg-black/40'
                                : 'border-white/8 bg-black/25')
                            }
                          >
                            {e.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-[13.5px] font-bold tracking-tight text-white"
                              style={{ fontFamily: 'var(--font-tech)' }}
                            >
                              {e.label}
                            </div>
                            {e.hint ? (
                              <div className="mt-0.5 truncate text-[11.5px] text-text-muted">
                                {e.hint}
                              </div>
                            ) : null}
                          </div>
                          <span
                            className={
                              'shrink-0 text-[16px] transition ' +
                              (isActive
                                ? 'translate-x-0 text-violet'
                                : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100')
                            }
                          >
                            →
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            </>
          )}
        </div>

        {/* Rodapé com atalhos */}
        <div
          className="flex items-center justify-between gap-3 border-t border-line/70 bg-bg/40 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <div className="flex items-center gap-3">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navegar</span>
            <Kbd>↵</Kbd>
            <span>abrir</span>
            <Kbd>esc</Kbd>
            <span>fechar</span>
          </div>
          <span className="hidden md:inline">{navList.length} resultados</span>
        </div>
      </div>

      <style jsx global>{`
        @keyframes gs-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes gs-pop-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* Sem @property o browser não sabe interpolar a var como ângulo
           — declarar permite a borda conic girar suave em vez de saltar. */
        @property --fc-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
        /* Cabeçalho da seção Destaques + grid */
        .featured-section-title {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          background: linear-gradient(
            90deg,
            #ffffff 0%,
            rgba(255, 255, 255, 0.55) 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .featured-section-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(
            to right,
            rgba(167, 139, 250, 0.55),
            rgba(45, 212, 191, 0.4),
            rgba(240, 171, 252, 0.32),
            transparent
          );
        }
        .featured-section-pulse {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #a78bfa, #5eead4);
          box-shadow: 0 0 10px rgba(167, 139, 250, 0.8);
          animation: featured-pulse 2.4s ease-in-out infinite;
        }
        @keyframes featured-pulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50%      { transform: scale(1.35); opacity: 1; }
        }
        /* Stack vertical full-width — cada destaque ganha o palco inteiro
           pra ser realmente chamativo (vs grid compacto de 3 colunas). */
        .featured-grid {
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 0 2px;
        }
      `}</style>
    </div>
  );
}

/**
 * FeaturedCard — card 3D premium pros 3 destaques (Pilot/HeyGen/Auto B-roll).
 *
 *  ▸ Tilt 3D real conforme o mouse (rotateX/Y proporcional à posição).
 *  ▸ Borda conic em gradient violeta→teal/ambar girando sempre, mais
 *    rápida no hover (efeito "rim light" premium).
 *  ▸ Spotlight radial seguindo o cursor (--gx/--gy CSS vars).
 *  ▸ Sheen diagonal que varre no hover (mesmo padrão dos CTAs da landing).
 *  ▸ Ambient glow colorido pulsando atrás (intensifica no hover/active).
 *  ▸ Estrela cintilante no canto — assinatura "destaque".
 *  ▸ Ícone elevado em translateZ no hover (saliência 3D real).
 *  ▸ Active state quando teclado navega até ele.
 */
function FeaturedCard({
  def,
  active,
  onFocusActive,
  onActivate,
}: {
  def: FeaturedDef;
  active: boolean;
  onFocusActive: () => void;
  onActivate: () => void;
}) {
  const Icon = def.Icon;

  const handleMove = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    // Amplitude maior que o botão da TopBar pra dar peso 3D ao card.
    const rotY = (px - 0.5) * 16;
    const rotX = -(py - 0.5) * 12;
    el.style.setProperty('--rx', `${rotX.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${rotY.toFixed(2)}deg`);
  };

  const handleLeave = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
    e.currentTarget.style.setProperty('--gx', '50%');
    e.currentTarget.style.setProperty('--gy', '50%');
  };

  return (
    <div className="fc-perspective">
      <button
        type="button"
        className={'fc-card' + (active ? ' is-active' : '')}
        onClick={onActivate}
        onMouseEnter={onFocusActive}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        aria-label={`${def.label} — ${def.hint}`}
        style={
          {
            '--fc-primary': def.primary,
            '--fc-secondary': def.secondary,
            '--fc-glow': def.glowRgb,
          } as React.CSSProperties
        }
      >
        {/* CAMADA 0 — ambient glow colorido pulsando atrás */}
        <span aria-hidden className="fc-ambient" />
        {/* CAMADA 1 — borda conic girando (rim light) */}
        <span aria-hidden className="fc-conic" />
        {/* CAMADA 2 — spotlight radial seguindo o cursor */}
        <span aria-hidden className="fc-spotlight" />
        {/* CAMADA 3 — textura grid sutil pra profundidade */}
        <span aria-hidden className="fc-grid-tex" />
        {/* CAMADA 4 — sheen diagonal no hover */}
        <span aria-hidden className="fc-sheen" />

        {/* ÍCONE — gradient pill grande à esquerda */}
        <span className="fc-icon">
          <Icon size={26} strokeWidth={1.7} />
        </span>

        {/* TEXTO — label + hint (sem badge, já é destaque pelo próprio card) */}
        <div className="fc-text">
          <span className="fc-label" style={{ fontFamily: 'var(--font-tech)' }}>
            {def.label}
          </span>
          <div className="fc-hint">{def.hint}</div>
        </div>

        {/* SETA — indicador animado à direita */}
        <span aria-hidden className="fc-arrow">→</span>
      </button>

      <style jsx>{`
        .fc-perspective {
          perspective: 1100px;
          display: block;
          width: 100%;
        }

        /* Card largão horizontal — ícone esq, texto centro, seta dir.
           min-height generoso pra ter peso visual (vs lista compacta). */
        .fc-card {
          position: relative;
          width: 100%;
          min-height: 82px;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 14px;
          padding: 14px 16px 14px 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background:
            linear-gradient(
              122deg,
              rgba(var(--fc-glow), 0.28) 0%,
              rgba(var(--fc-glow), 0.08) 28%,
              rgba(13, 13, 20, 0.82) 60%,
              rgba(8, 8, 12, 0.92) 100%
            );
          overflow: hidden;
          cursor: pointer;
          isolation: isolate;
          text-align: left;
          color: #fff;
          transform-style: preserve-3d;
          transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))
            translateZ(0);
          transition:
            transform 340ms cubic-bezier(0.2, 0.9, 0.3, 1),
            border-color 380ms ease,
            box-shadow 420ms ease;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            inset 0 -1px 0 rgba(0, 0, 0, 0.55),
            0 10px 28px -14px rgba(var(--fc-glow), 0.45),
            0 1px 0 rgba(0, 0, 0, 0.6);
        }

        .fc-card:hover,
        .fc-card.is-active {
          border-color: rgba(var(--fc-glow), 0.6);
          transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))
            translateZ(10px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            inset 0 -1px 0 rgba(0, 0, 0, 0.55),
            0 26px 52px -14px rgba(var(--fc-glow), 0.65),
            0 0 48px -8px rgba(var(--fc-glow), 0.55),
            0 1px 0 rgba(0, 0, 0, 0.6);
        }

        .fc-card:focus-visible {
          outline: none;
          border-color: rgba(var(--fc-glow), 0.75);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            0 0 0 2px rgba(var(--fc-glow), 0.45),
            0 26px 52px -14px rgba(var(--fc-glow), 0.7),
            0 0 48px -8px rgba(var(--fc-glow), 0.6);
        }

        .fc-card:active {
          transform: rotateX(0deg) rotateY(0deg) scale(0.985);
          transition-duration: 110ms;
        }

        /* CAMADA 0 — ambient glow pulsando */
        .fc-ambient {
          position: absolute;
          inset: -18px;
          z-index: -2;
          border-radius: 24px;
          background: radial-gradient(
            55% 70% at 30% 25%,
            rgba(var(--fc-glow), 0.42),
            transparent 70%
          );
          opacity: 0.42;
          filter: blur(14px);
          transition: opacity 480ms ease;
          animation: fc-ambient-pulse 4s ease-in-out infinite;
          pointer-events: none;
        }
        .fc-card:hover .fc-ambient,
        .fc-card.is-active .fc-ambient {
          opacity: 1;
        }
        @keyframes fc-ambient-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%      { transform: scale(1.08); opacity: 0.62; }
        }

        /* CAMADA 1 — conic border que gira sempre, mais rápida no hover */
        .fc-conic {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          padding: 1px;
          background: conic-gradient(
            from var(--fc-angle, 0deg),
            transparent 0%,
            var(--fc-primary, #a78bfa) 18%,
            transparent 38%,
            var(--fc-secondary, #c084fc) 62%,
            transparent 90%
          );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0.55;
          transition: opacity 420ms ease;
          animation: fc-conic-spin 6s linear infinite;
          pointer-events: none;
        }
        .fc-card:hover .fc-conic,
        .fc-card.is-active .fc-conic {
          opacity: 1;
          animation-duration: 2.4s;
        }
        @keyframes fc-conic-spin {
          to { --fc-angle: 360deg; }
        }

        /* CAMADA 2 — spotlight radial seguindo cursor (maior pra card largão) */
        .fc-spotlight {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background: radial-gradient(
            240px circle at var(--gx, 50%) var(--gy, 50%),
            rgba(255, 255, 255, 0.2),
            transparent 60%
          );
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
        }
        .fc-card:hover .fc-spotlight {
          opacity: 1;
        }

        /* CAMADA 3 — grid texture sutil (mais visível no topo) */
        .fc-grid-tex {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background-image:
            linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
          background-size: 18px 18px;
          opacity: 0.5;
          mask-image: radial-gradient(120% 95% at 25% 0%, #000 0%, transparent 65%);
          -webkit-mask-image: radial-gradient(120% 95% at 25% 0%, #000 0%, transparent 65%);
          pointer-events: none;
        }

        /* CAMADA 4 — sheen diagonal no hover */
        .fc-sheen {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background: linear-gradient(
            115deg,
            transparent 30%,
            rgba(255, 255, 255, 0.32) 50%,
            transparent 70%
          );
          transform: translateX(-130%);
          transition: transform 950ms cubic-bezier(0.2, 0.9, 0.3, 1);
          pointer-events: none;
        }
        .fc-card:hover .fc-sheen {
          transform: translateX(130%);
        }

        /* Ícone — gradient pill grande (48px) com elevação 3D real no hover.
           Maior que o card antigo de grid 3-col pra puxar atenção em layout
           full-width. shadow colorido vaza pra fora do card no hover. */
        .fc-icon {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: linear-gradient(
            135deg,
            var(--fc-primary, #a78bfa),
            var(--fc-secondary, #c084fc)
          );
          color: var(--card-deep);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.45),
            inset 0 -1px 0 rgba(0, 0, 0, 0.3),
            0 14px 28px -8px rgba(var(--fc-glow), 0.7);
          transition:
            transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 360ms ease;
          position: relative;
          z-index: 1;
          transform: translateZ(0);
        }
        .fc-card:hover .fc-icon,
        .fc-card.is-active .fc-icon {
          transform: rotate(-6deg) scale(1.08) translateZ(18px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.55),
            inset 0 -1px 0 rgba(0, 0, 0, 0.35),
            0 22px 38px -8px rgba(var(--fc-glow), 0.85);
        }

        /* Bloco de texto — centro do card, ocupa o espaço sobrando */
        .fc-text {
          position: relative;
          z-index: 1;
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
        }
        .fc-label {
          font-size: 15.5px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: #fff;
          line-height: 1.1;
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 1;
          min-width: 0;
        }
        .fc-hint {
          font-size: 11.5px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.65);
          letter-spacing: 0.005em;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Seta — indicador no canto direito que desliza no hover */
        .fc-arrow {
          flex-shrink: 0;
          position: relative;
          z-index: 1;
          font-size: 18px;
          line-height: 1;
          color: rgba(255, 255, 255, 0.32);
          font-family: var(--font-mono, ui-monospace);
          transition:
            transform 360ms cubic-bezier(0.2, 0.9, 0.3, 1),
            color 320ms ease,
            text-shadow 320ms ease;
          transform: translateZ(0);
        }
        .fc-card:hover .fc-arrow,
        .fc-card.is-active .fc-arrow {
          color: var(--fc-primary, #a78bfa);
          transform: translateX(5px) translateZ(8px);
          text-shadow: 0 0 14px rgba(var(--fc-glow), 0.85);
        }

        /* Responsivo — em telas estreitas o card encolhe mas mantém impacto */
        @media (max-width: 520px) {
          .fc-card { min-height: 74px; padding: 12px 13px 12px 12px; gap: 12px; }
          .fc-icon { width: 42px; height: 42px; border-radius: 12px; }
          .fc-label { font-size: 14px; }
          .fc-hint { font-size: 11px; }
          .fc-arrow { font-size: 16px; }
        }

        /* Respeitar prefers-reduced-motion — sem giros nem pulse */
        @media (prefers-reduced-motion: reduce) {
          .fc-card { transition-duration: 0ms; }
          .fc-conic, .fc-ambient, .fc-star { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="rounded-md border border-line-strong bg-bg/40 px-1.5 py-0.5 text-[10px] font-bold text-text-muted"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </kbd>
  );
}

