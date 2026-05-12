'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ToolShell } from '@/components/ToolShell';
import { listMyVideos, downloadVideoBytes, type HistoryVideo } from '@/lib/heygen-api-direct';
import { detectExtension, type ExtensionStatus } from '@/lib/heygen-extension-bridge';

/**
 * HeyGen History — lista TODOS os videos da conta HeyGen do user.
 * HeyGen retem por 60 dias automaticamente. Filtros: ultimos N dias OR
 * range customizado. Search por nome. Download direto via CDN HeyGen.
 *
 * Persistencia: nada local. Toda info vem ao vivo da API HeyGen via
 * extension (mesma sessao cookies). Reload pagina ou voltar outro dia
 * sempre busca lista atual.
 */

type Period = 'all' | '7d' | '15d' | '30d' | '60d' | 'custom';
type StatusFilter = 'all' | 'completed' | 'pending' | 'failed';

const PAGE_SIZE = 50;

export default function HeyGenHistoryPage() {
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<HistoryVideo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('60d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Detecta extension
  useEffect(() => {
    (async () => {
      const s = await detectExtension();
      setExtStatus(s);
    })();
  }, []);

  // Load primeira pagina ao montar
  useEffect(() => {
    if (extStatus.connected) load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extStatus.connected]);

  async function load(p: number, reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const r = await listMyVideos({ limit: PAGE_SIZE, page: p });
      if (reset) {
        setVideos(r.items);
      } else {
        setVideos((prev) => [...prev, ...r.items]);
      }
      setHasMore(r.hasMore);
      setPage(p);
    } catch (e) {
      setError((e as Error)?.message || 'Erro carregando histórico');
    } finally {
      setLoading(false);
    }
  }

  // Filtros aplicados
  const filteredVideos = useMemo(() => {
    let arr = [...videos];
    // Período
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    if (period === '7d') arr = arr.filter((v) => now - v.createdAt < 7 * DAY);
    else if (period === '15d') arr = arr.filter((v) => now - v.createdAt < 15 * DAY);
    else if (period === '30d') arr = arr.filter((v) => now - v.createdAt < 30 * DAY);
    else if (period === '60d') arr = arr.filter((v) => now - v.createdAt < 60 * DAY);
    else if (period === 'custom') {
      const startTs = customStart ? new Date(customStart).getTime() : 0;
      const endTs = customEnd ? new Date(customEnd).getTime() + DAY : Infinity;
      arr = arr.filter((v) => v.createdAt >= startTs && v.createdAt <= endTs);
    }
    // Status
    if (statusFilter !== 'all') arr = arr.filter((v) => v.status === statusFilter);
    // Search
    if (search.trim()) {
      const s = search.toLowerCase().trim();
      arr = arr.filter((v) => v.name.toLowerCase().includes(s) || v.videoId.toLowerCase().includes(s));
    }
    return arr;
  }, [videos, period, customStart, customEnd, statusFilter, search]);

  async function handleDownload(v: HistoryVideo) {
    if (!v.videoUrl) {
      setError(`Video ${v.videoId} sem URL — talvez ainda processando.`);
      return;
    }
    try {
      const bytes = await downloadVideoBytes(v.videoUrl);
      const blob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${v.name.replace(/[^a-z0-9_-]/gi, '_')}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(`Falha baixando ${v.name}: ${(e as Error)?.message}`);
    }
  }

  function fmtDate(ms: number): string {
    if (!ms) return '?';
    const d = new Date(ms);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDur(sec: number | null): string {
    if (sec == null) return '?';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function statusColor(s: HistoryVideo['status']): string {
    if (s === 'completed') return 'bg-lime/15 text-lime border-lime/40';
    if (s === 'failed') return 'bg-red-500/15 text-red-300 border-red-500/40';
    if (s === 'pending') return 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40';
    return 'bg-bg/40 text-text-muted border-line';
  }

  const completedCount = videos.filter((v) => v.status === 'completed').length;
  const pendingCount = videos.filter((v) => v.status === 'pending').length;
  const failedCount = videos.filter((v) => v.status === 'failed').length;

  return (
    <ToolShell
      title="Histórico HeyGen"
      description="Todos os vídeos que você gerou no HeyGen — retenção de 60 dias pela API. Filtros por período, status e busca por nome."
    >
      {/* Extension status */}
      {!extStatus.connected ? (
        <div className="mb-5 rounded-[12px] border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          ⚠ Extensão DARKO LAB não detectada. Instale e faça login no HeyGen primeiro.
        </div>
      ) : null}

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-[10px] border border-line bg-bg-soft/40 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-text-muted">Total carregado</div>
          <div className="mono text-lg text-white">{videos.length}</div>
        </div>
        <div className="rounded-[10px] border border-lime/40 bg-lime/5 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-lime">Completos</div>
          <div className="mono text-lg text-lime">{completedCount}</div>
        </div>
        <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-cyan-200">Processando</div>
          <div className="mono text-lg text-cyan-200">{pendingCount}</div>
        </div>
        <div className="rounded-[10px] border border-red-500/40 bg-red-500/5 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-red-300">Falhas</div>
          <div className="mono text-lg text-red-300">{failedCount}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 rounded-[12px] border border-line bg-bg-soft/40 p-3">
        <div className="grid gap-3">
          <div>
            <div className="mono mb-1 text-[10px] uppercase tracking-widest text-text-muted">Período</div>
            <div className="flex flex-wrap gap-1">
              {(['all', '7d', '15d', '30d', '60d', 'custom'] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={
                    'mono rounded-md px-3 py-1 text-[10px] uppercase tracking-widest transition ' +
                    (period === p
                      ? 'border border-lime bg-lime/20 text-lime'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                >
                  {p === 'all' ? 'Todos' : p === 'custom' ? 'Personalizado' : `Últimos ${p}`}
                </button>
              ))}
            </div>
            {period === 'custom' ? (
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="input-field max-w-[180px] text-xs"
                />
                <span className="mono text-[10px] text-text-muted">até</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="input-field max-w-[180px] text-xs"
                />
              </div>
            ) : null}
          </div>
          <div>
            <div className="mono mb-1 text-[10px] uppercase tracking-widest text-text-muted">Status</div>
            <div className="flex flex-wrap gap-1">
              {(['all', 'completed', 'pending', 'failed'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={
                    'mono rounded-md px-3 py-1 text-[10px] uppercase tracking-widest transition ' +
                    (statusFilter === s
                      ? 'border border-lime bg-lime/20 text-lime'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                >
                  {s === 'all' ? 'Todos' : s === 'completed' ? 'Completos' : s === 'pending' ? 'Processando' : 'Falhas'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mono mb-1 text-[10px] uppercase tracking-widest text-text-muted">Buscar por nome / video ID</div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ex AD138 OU manualdohomemsolo"
              className="input-field text-sm"
            />
          </div>
        </div>
      </div>

      {/* Resultado */}
      {error ? (
        <div className="mb-3 rounded-[10px] border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
          {filteredVideos.length} de {videos.length} mostrados
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load(1, true)}
            disabled={loading || !extStatus.connected}
            className="mono rounded border border-line-strong px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime disabled:opacity-40"
          >
            {loading && page === 1 ? '⟳ Carregando...' : '⟳ Atualizar'}
          </button>
          {hasMore ? (
            <button
              type="button"
              onClick={() => load(page + 1, false)}
              disabled={loading || !extStatus.connected}
              className="mono rounded border border-lime/40 bg-lime/10 px-3 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20 disabled:opacity-40"
            >
              {loading ? '⟳' : `+ Próxima página`}
            </button>
          ) : null}
        </div>
      </div>

      {/* Lista de videos */}
      {videos.length === 0 && !loading ? (
        <div className="rounded-[10px] border border-line bg-bg-soft/40 p-6 text-center text-[12px] text-text-muted">
          Nenhum vídeo carregado. {extStatus.connected ? 'Clica "Atualizar" pra carregar.' : 'Conecta a extensão primeiro.'}
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredVideos.map((v) => (
            <div key={v.videoId} className="rounded-[10px] border border-line bg-bg-soft/30 p-3 flex items-center gap-3">
              {v.thumbUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={v.thumbUrl}
                  alt={v.name}
                  className="h-16 w-28 shrink-0 rounded object-cover bg-bg"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-16 w-28 shrink-0 rounded bg-bg flex items-center justify-center mono text-[9px] uppercase tracking-widest text-text-muted">
                  sem thumb
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white truncate">{v.name}</span>
                  <span className={`mono rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest ${statusColor(v.status)}`}>
                    {v.status}
                  </span>
                  {v.durationSec != null ? (
                    <span className="mono text-[10px] text-text-muted">{fmtDur(v.durationSec)}</span>
                  ) : null}
                </div>
                <div className="mono mt-0.5 text-[10px] text-text-muted">
                  {fmtDate(v.createdAt)} · {v.videoId}
                </div>
                {v.error ? (
                  <div className="text-[11px] text-red-300 mt-0.5">{v.error}</div>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {v.status === 'completed' && v.videoUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDownload(v)}
                      className="mono rounded border border-lime/60 bg-lime/15 px-3 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30"
                    >
                      ↓ Baixar
                    </button>
                    <a
                      href={v.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono rounded border border-line-strong px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-cyan-500 hover:text-cyan-200 text-center"
                    >
                      ▶ Abrir
                    </a>
                  </>
                ) : v.status === 'pending' ? (
                  <span className="mono rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-200">
                    em fila
                  </span>
                ) : v.status === 'failed' ? (
                  <span className="mono rounded border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-red-300">
                    falhou
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && page === 1 ? (
        <div className="mt-4 text-center text-[11px] text-text-muted">Carregando histórico...</div>
      ) : null}

      <div className="mt-6 rounded-[10px] border border-line bg-bg-soft/40 p-3 text-[11px] text-text-muted">
        💡 HeyGen retém vídeos por <strong className="text-white">60 dias</strong> automaticamente. Após esse prazo eles
        são removidos do servidor. Baixe os que importam.
      </div>
      <div className="mt-2">
        <Link href="/tools" className="mono text-[10px] uppercase tracking-widest text-text-muted hover:text-lime">
          ← Voltar pra ferramentas
        </Link>
      </div>
    </ToolShell>
  );
}
