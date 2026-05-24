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
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IconSearch,
  IconStepGear,
  IconTakeSplitter,
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
  { id: 'downloader', group: 'Ferramentas', label: 'Downloader', hint: 'Baixa vídeos de qualquer site', href: '/tools/downloader', icon: <IconDownloader size={20} />, keywords: ['youtube', 'tiktok', 'instagram', 'pinterest', 'baixar', 'download'] },
  { id: 'compressor', group: 'Ferramentas', label: 'Compressor', hint: 'Reduz peso do arquivo', href: '/tools/compressor', icon: <IconCompressor size={20} />, keywords: ['comprimir', 'reduzir', 'tamanho'] },
  { id: 'audio-split', group: 'Ferramentas', label: 'Separar áudios', hint: 'Divide pelo silêncio', href: '/tools/audio-split', icon: <IconAudioSplit size={20} />, keywords: ['split', 'dividir', 'separar'] },
  { id: 'acelerador', group: 'Ferramentas', label: 'Mixer de Velocidade', hint: 'Acelera/desacelera sem ficar robótico', href: '/tools/acelerador', icon: <IconAcelerador size={20} />, keywords: ['velocidade', 'speed', 'rápido', 'lento'] },
  { id: 'normalizador', group: 'Ferramentas', label: 'Normalizador', hint: 'Iguala volume de vários arquivos', href: '/tools/normalizador', icon: <IconNormalizador size={20} />, keywords: ['volume', 'loudness', 'lufs', 'normalizar'] },
  { id: 'take-splitter', group: 'Ferramentas', label: 'Separar takes', hint: 'Quebra o vídeo em cada take', href: '/tools/take-splitter', icon: <IconTakeSplitter size={20} />, keywords: ['take', 'cena', 'scene'] },
  { id: 'calculadora', group: 'Ferramentas', label: 'Calculadora', hint: 'Cálculo de preço por minuto', href: '/tools/calculadora', icon: <IconCalculadora size={20} />, keywords: ['valor', 'preço', 'orçamento'] },

  // IA
  { id: 'auto-broll', group: 'IA', label: 'Auto B-roll', hint: 'Insere cortes no ritmo da fala', href: '/tools/auto-broll', icon: <IconAutoBroll size={20} />, keywords: ['broll', 'b-roll', 'magnific'] },
  { id: 'troca-produto', group: 'IA', label: 'Troca de produto', hint: 'Substitui produto do áudio', href: '/tools/troca-produto', icon: <IconTrocaProduto size={20} />, keywords: ['voz', 'clone', 'eleven', 'voiceover'] },
  { id: 'remover', group: 'IA', label: 'Remover Legenda/Marca d’Água', hint: 'Apaga texto e watermark sem borrão', href: '/tools/remover-elementos', icon: <IconRemoverElementos size={20} />, keywords: ['smart remover', 'watermark', 'marca', 'logo', 'inpaint'] },
  { id: 'decupagem-copy', group: 'IA', label: 'Decupagem Inteligente', hint: 'Decupa seguindo sua copy', href: '/tools/decupagem-copy', icon: <IconDecupageCopy size={20} />, keywords: ['smart decup', 'script', 'roteiro'] },
  { id: 'copy-srt', group: 'IA', label: 'Gerador de SRT', hint: 'Legendas no tempo do seu áudio', href: '/tools/copy-srt', icon: <IconCopySRT size={20} />, keywords: ['srt generator', 'legenda', 'subtitle'] },
  { id: 'heygen-auto', group: 'IA', label: 'HeyGen Auto', hint: 'Lipsync automático em lote', href: '/tools/heygen-auto', icon: <IconHeyGenAuto size={20} />, keywords: ['avatar', 'lipsync', 'falar'] },

  // Atalhos
  { id: 'home', group: 'Atalhos', label: 'Início', hint: 'Hub principal', href: '/tools', icon: <IconSearch size={20} />, keywords: ['hub', 'home'] },
  { id: 'pilot', group: 'Atalhos', label: 'ClickUp Pilot', hint: 'Conhecer o Pilot', href: '/pilot', icon: <IconClickUpPilot size={20} />, keywords: ['automação', 'clickup', 'avatar', 'briefing'] },
  { id: 'pilot-tool', group: 'Atalhos', label: 'ClickUp Pilot — iniciar', hint: 'Disparar automação agora', href: '/tools/clickup-pilot', icon: <IconClickUpPilot size={20} />, keywords: ['automatizar', 'rodar'] },
  { id: 'background', group: 'Atalhos', label: 'Tarefas em segundo plano', hint: 'Acompanha jobs rodando', href: '/tools/background', icon: <IconStepGear size={20} />, keywords: ['bg', 'fila', 'job', 'running'] },
  { id: 'history', group: 'Atalhos', label: 'Histórico de avatares', hint: 'Lipsyncs anteriores', href: '/tools/lipsync-history', icon: <IconHeyGenAuto size={20} />, keywords: ['history', 'lipsync', 'avatar'] },

  // Configurações
  { id: 'config', group: 'Configurações', label: 'Configurações', hint: 'Preferências da conta', href: '/configuracoes', icon: <IconStepGear size={20} />, keywords: ['settings', 'preferências'] },
  { id: 'config-api', group: 'Configurações', label: 'Chaves de IA', hint: 'API keys (Groq, Eleven, OpenAI…)', href: '/configuracoes/api', icon: <IconStepGear size={20} />, keywords: ['groq', 'openai', 'eleven', 'anthropic', 'api', 'key'] },
  { id: 'config-pilot', group: 'Configurações', label: 'ClickUp Pilot · ajustes', hint: 'Tokens e workspace', href: '/configuracoes/clickup-pilot', icon: <IconStepGear size={20} />, keywords: ['clickup', 'token'] },

  // Conta
  { id: 'plans', group: 'Conta', label: 'Ver planos', hint: 'Free · Basic · Pro · Admin', href: '/planos', icon: <IconStepGear size={20} />, keywords: ['plan', 'upgrade', 'pro', 'basic'] },
];

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

export function GlobalSearchButton() {
  const [open, setOpen] = useState(false);
  const isMacRef = useRef(false);
  useEffect(() => {
    isMacRef.current = /Mac|iPhone|iPad/i.test(navigator.platform);
  }, []);

  // Atalho global Ctrl/⌘+K
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="topbar-btn topbar-search"
        aria-label="Pesquisar"
        title="Pesquisar (Ctrl+K)"
      >
        <IconSearch size={16} />
        <span
          className="ml-1.5 hidden text-[11.5px] font-semibold tracking-tight text-text-muted md:inline"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Pesquisar
        </span>
        <span
          className="ml-2 hidden rounded-md border border-line-strong bg-bg/40 px-1.5 py-0.5 text-[9.5px] font-bold text-text-dim md:inline"
          style={{ fontFamily: 'var(--font-mono)' }}
          suppressHydrationWarning
        >
          {isMacRef.current ? '⌘K' : 'Ctrl K'}
        </span>
      </button>
      {open ? <SearchModal onClose={() => setOpen(false)} /> : null}
      <style jsx>{`
        .topbar-search {
          display: inline-flex;
          align-items: center;
          padding: 0 10px;
          height: 32px;
          min-width: 36px;
          border-radius: 10px;
          color: rgba(255, 255, 255, 0.78);
          transition: background 200ms ease, color 200ms ease, transform 200ms ease;
        }
        .topbar-search:hover {
          background: rgba(167, 139, 250, 0.1);
          color: #fff;
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

  // Filtra + ordena por score
  const results = useMemo(() => {
    const scored = ENTRIES.map((e) => ({ e, s: score(q, e) }))
      .filter((it) => it.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 24);
    return scored.map((it) => it.e);
  }, [q]);

  // Reset highlight quando muda query
  useEffect(() => setActive(0), [q]);

  // Agrupa por group, preservando ordem
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
    (e: Entry) => {
      onClose();
      router.push(e.href);
    },
    [onClose, router],
  );

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((v) => Math.min(results.length - 1, v + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((v) => Math.max(0, v - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = results[active];
      if (sel) go(sel);
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
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              Nada encontrado pra <span className="text-white">“{q}”</span>.
            </div>
          ) : (
            groups.map(([group, list]) => (
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
                          onClick={() => go(e)}
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
            ))
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
          <span className="hidden md:inline">{results.length} resultados</span>
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

