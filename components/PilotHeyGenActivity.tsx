'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BatchJobCard3D } from '@/components/BatchJobCard3D';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { logHistory, readHistory, type FileRef, type HistoryEvent } from '@/lib/history';
import { createRecordWriter } from '@/lib/durable-records';
import type { HistoryVideo } from '@/lib/heygen-api-direct';

// The 30 ready cards recorded immediately before START on 29 Sep 2026.
// HeyGen omits the PR code from its titles, so both copy and count matter.
export const PILOT_RECOVERY_TASKS = [
  ['AD65VN - PRWA10', 9], ['AD64VN - PRWA10', 9], ['AD63VN - PRWA10', 8],
  ['AD62VN - PRWA10', 9], ['AD61VN - PRWA10', 9], ['AD60VN - PRWA10', 8],
  ['AD59VN - PRWA10', 10], ['AD58VN - PRWA10', 5], ['AD56VN - PRWA10', 9],
  ['AD63VN - PRPB09', 12], ['AD59VN - PRPB09', 8], ['AD56VN - PRPB09', 5],
  ['AD54VN - PRPB09', 12], ['AD53VN - PRPB09', 8], ['AD52VN - PRPB09', 7],
  ['AD51VN - PRPB09', 10], ['AD50VN - PRPB09', 8], ['AD49VN - PRPB09', 8],
  ['AD48VN - PRPB09', 8], ['AD47VN - PRPB09', 6], ['AD46VN - PRPB09', 8],
  ['AD45VN - PRPB09', 7], ['AD44VN - PRPB09', 7], ['AD55VN - PRWA10', 7],
  ['AD54VN - PRWA10', 8], ['AD53VN - PRWA10', 11], ['AD52VN - PRWA10', 10],
  ['AD51VN - PRWA10', 8], ['AD48VN - PRWA10', 7], ['AD47VN - PRWA10', 15],
] as const;

const STARTED = Date.parse('2026-09-29T20:22:00Z');
const TITLE = /^(AD\d+VN)_(HOOK|BODY)\s+(\d+)$/i;
const taskKey = (name: string) => `pilot-recovery-20260929:${name.replace(/[^A-Z0-9]+/gi, '_')}`;
const dispatchId = (name: string) => `dispatch:${taskKey(name)}:${STARTED}`;
const labelsFor = (count: number) => ['HOOK 1', ...Array.from({ length: count - 1 }, (_, i) => `BODY ${i + 1}`)];
const labelOf = (video: HistoryVideo) => {
  const m = video.name.match(TITLE);
  return m ? `${m[2].toUpperCase()} ${m[3]}` : '';
};

function matchVideos(videos: HistoryVideo[], history: HistoryEvent[]): Map<string, HistoryVideo[]> {
  const matched = new Map<string, HistoryVideo[]>();
  const assigned = new Set<string>();
  for (const [name] of PILOT_RECOVERY_TASKS) {
    const ids = history.filter(e => e.tool === 'clickup-pilot' && e.title === `${name} entregue` && e.t >= STARTED)
      .flatMap(e => e.ref || []).filter((r): r is Extract<FileRef, { via: 'heygen' }> => r.via === 'heygen')
      .flatMap(r => r.parts.map(p => p.videoId));
    const takes = videos.filter(v => ids.includes(v.videoId));
    if (takes.length) {
      matched.set(name, takes);
      for (const take of takes) assigned.add(take.videoId);
    }
  }
  const byAd = new Map<string, HistoryVideo[]>();
  for (const video of videos) {
    const ad = video.name.match(TITLE)?.[1]?.toUpperCase();
    if (ad && video.createdAt >= STARTED && !assigned.has(video.videoId)) byAd.set(ad, [...(byAd.get(ad) || []), video]);
  }
  for (const [ad, all] of byAd) {
    const chunks: HistoryVideo[][] = [];
    for (const video of all.sort((a, b) => a.createdAt - b.createdAt)) {
      if (labelOf(video) === 'HOOK 1' || chunks.length === 0) chunks.push([]);
      chunks[chunks.length - 1].push(video);
    }
    const candidates = PILOT_RECOVERY_TASKS.filter(([name]) => name.startsWith(`${ad} - `));
    const available = new Set(candidates.map(([name]) => name).filter(name => !matched.has(name)));
    // Exact matches first. A partial second copy gets only the remaining slot.
    chunks.sort((a, b) => b.length - a.length);
    for (const chunk of chunks) {
      const unique = new Map<string, HistoryVideo>();
      for (const v of chunk) unique.set(labelOf(v), v);
      const count = unique.size;
      const options = candidates.filter(([name]) => available.has(name));
      const target = options.find(([, n]) => n === count)
        || options.filter(([, n]) => n >= count).sort((a, b) => a[1] - b[1])[0];
      if (target) {
        available.delete(target[0]);
        matched.set(target[0], [...unique.values()]);
      }
    }
  }
  return matched;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function ensureRecoveryHistory() {
  const writer = createRecordWriter('history');
  const existing = writer.hydrate<HistoryEvent>();
  const additions: Record<string, HistoryEvent> = {};
  PILOT_RECOVERY_TASKS.forEach(([name, count], index) => {
    const id = dispatchId(name);
    if (existing[id]) return;
    additions[id] = {
      id, t: STARTED + index, tool: 'clickup-pilot', title: name,
      kind: 'dispatch', meta: `Fila YouTube de 29/09 · ${count} takes planejados`,
      channels: [{ label: 'YOUTUBE', color: '#ff3333' }],
    };
  });
  if (Object.keys(additions).length) await writer.save({ ...existing, ...additions });
}

/** Rendered inside the Pilot's existing Tasks em produção list. Recovery
 * only reads existing IDs; it never submits or regenerates a HeyGen take. */
export function PilotHeyGenActivity({ active }: { active: boolean }) {
  const [videos, setVideos] = useState<HistoryVideo[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [availableZips, setAvailableZips] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, string>>({});
  const busyRef = useRef(new Set<string>());
  const badZipRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!active) return;
    try {
      const { listMyVideos } = await import('@/lib/heygen-api-direct');
      const found = new Map<string, HistoryVideo>();
      const seenRaw = new Set<string>();
      for (let page = 1; page <= 30; page++) {
        // HeyGen rejects limits above 100 on some accounts. A rejected page
        // previously made every recovered card look like it had zero takes.
        const result = await listMyVideos({ limit: 100, page });
        let addedRaw = 0;
        for (const v of result.items) {
          if (!seenRaw.has(v.videoId)) { addedRaw++; seenRaw.add(v.videoId); }
          if (!TITLE.test(v.name) || v.createdAt < STARTED) continue;
          found.set(v.videoId, v);
        }
        if (!result.hasMore || !addedRaw) break;
      }
      setVideos([...found.values()]);
    } catch (e) { console.warn('[Pilot recovery] HeyGen read failed', e); }
    const events = readHistory();
    setHistory(events);
    const keys: string[] = [];
    for (const event of events) for (const ref of event.ref || []) {
      if (!PILOT_RECOVERY_TASKS.some(([name]) => event.title === `${name} entregue`)) continue;
      if (ref.via !== 'zip' || ref.label !== 'Montado') continue;
      keys.push(ref.key);
    }
    try {
      const { zipKeysExistentes } = await import('@/lib/zip-store');
      const found = await zipKeysExistentes(keys);
      for (const key of badZipRef.current) found.delete(key);
      setAvailableZips(found);
    } catch { setAvailableZips(new Set()); }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void ensureRecoveryHistory().catch(e => console.warn('[Pilot recovery] History save failed', e))
      .then(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onHistory = () => setHistory(readHistory());
    window.addEventListener('autoedit:history', onHistory);
    return () => { window.clearInterval(timer); window.removeEventListener('autoedit:history', onHistory); };
  }, [active, refresh]);

  const matched = useMemo(() => matchVideos(videos, history), [videos, history]);

  const assemble = useCallback(async (name: string, takes: HistoryVideo[], count: number) => {
    if (busyRef.current.has(name)) return;
    const labels = labelsFor(count);
    const byLabel = new Map(takes.map(v => [labelOf(v), v]));
    if (!labels.every(label => byLabel.get(label)?.status === 'completed')) { await refresh(); return; }
    busyRef.current.add(name);
    const progress = (message: string) => setBusy(prev => ({ ...prev, [name]: message }));
    try {
      progress('Baixando takes existentes do HeyGen…');
      const [{ getVideosStatus, downloadVideoBytes }, { runPostPipeline }, { saveZip }, { default: JSZip }] = await Promise.all([
        import('@/lib/heygen-api-direct'), import('@/lib/clickup-pilot-pipeline'),
        import('@/lib/zip-store'), import('jszip'),
      ]);
      const ids = labels.map(label => byLabel.get(label)!.videoId);
      const statuses = await getVideosStatus(ids);
      const parts: Array<{ label: string; blob: Blob; expected: true }> = [];
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const take = byLabel.get(label)!;
        const status = statuses[take.videoId];
        if (status?.status !== 'completed' || !(status.videoUrl || take.videoUrl)) throw new Error(`${label} ainda não tem MP4 disponível`);
        progress(`Baixando ${i + 1}/${labels.length} · ${label}`);
        const bytes = await downloadVideoBytes(status.videoUrl || take.videoUrl!);
        parts.push({ label, blob: new Blob([bytes as BlobPart], { type: 'video/mp4' }), expected: true });
      }
      progress('Montando o vídeo…');
      const ad = name.match(/^AD\d+VN/i)![0];
      const output = await runPostPipeline({
        baseAdId: ad, parts, decupagem: false, nivelarVoz: true,
        camuflagem: false, formato: '9:16',
        onProgress: p => progress(`${p.stage} ${p.doneCount}/${p.totalCount}`),
      });
      const item = output.items[0];
      const mp4 = item?.rawAssembled;
      if (!mp4 || mp4.size < 1024 || item.errors?.assemble || item.missingParts?.length) {
        throw new Error(item?.errors?.assemble || 'montagem não gerou o MP4 completo');
      }
      const filename = `${ad}G1VN_${name.endsWith('PRWA10') ? 'PRWA10' : 'PRPB09'}.mp4`;
      const zipName = filename.replace(/\.mp4$/i, '.zip');
      const zip = new JSZip();
      zip.file(filename, mp4);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const key = `batch:${taskKey(name)}:montado`;
      await saveZip(key, zipBlob, zipName);
      badZipRef.current.delete(key);
      const ref: FileRef = { via: 'zip', key, name: zipName, label: 'Montado', taskId: taskKey(name) };
      logHistory({ tool: 'clickup-pilot', title: `${name} entregue`, meta: `${count} takes`, ref: [ref], channels: [{ label: 'YOUTUBE', color: '#ff3333' }] });
      setHistory(readHistory());
      setAvailableZips(prev => new Set(prev).add(key));
      downloadBlob(mp4, filename);
    } catch (e) {
      progress(`Falha na montagem: ${(e as Error)?.message || String(e)}`);
      return;
    } finally {
      busyRef.current.delete(name);
      setBusy(prev => {
        if (prev[name]?.startsWith('Falha')) return prev;
        const next = { ...prev }; delete next[name]; return next;
      });
    }
  }, [refresh]);

  const downloadMounted = useCallback(async (
    name: string, ref: Extract<FileRef, { via: 'zip' }>, takes: HistoryVideo[], count: number,
  ) => {
    if (busyRef.current.has(name)) return;
    busyRef.current.add(name);
    setBusy(prev => ({ ...prev, [name]: 'Lendo vídeo montado…' }));
    let loaded = false;
    try {
      const [{ loadZip }, { lerEntradasDoZip, abrirEntrada }] = await Promise.all([
        import('@/lib/zip-store'), import('@/lib/zip-entries'),
      ]);
      const saved = await loadZip(ref.key);
      if (saved) {
        try {
          const entries = await lerEntradasDoZip(saved.blob);
          const videos = entries?.filter(e => /\.mp4$/i.test(e.nome) && !e.nome.startsWith('__MACOSX/')) || [];
          if (videos.length === 1) {
            const blob = await new Response(await abrirEntrada(saved.blob, videos[0])).blob();
            if (blob.size > 1024) {
              downloadBlob(blob, videos[0].nome.split('/').pop() || `${name}.mp4`);
              loaded = true;
            }
          }
        } finally { URL.revokeObjectURL(saved.blobUrl); }
      }
    } catch (e) { console.warn('[Pilot recovery] stored montado unavailable', e); }
    finally {
      busyRef.current.delete(name);
      setBusy(prev => { const next = { ...prev }; delete next[name]; return next; });
    }
    if (loaded) return;
    badZipRef.current.add(ref.key);
    setAvailableZips(prev => { const next = new Set(prev); next.delete(ref.key); return next; });
    if (labelsFor(count).every(label => takes.some(v => labelOf(v) === label && v.status === 'completed'))) {
      await assemble(name, takes, count);
    } else {
      setBusy(prev => ({ ...prev, [name]: 'Arquivo local indisponível; conferindo takes no HeyGen' }));
      await refresh();
    }
  }, [assemble, refresh]);

  if (!active) return null;
  return <>
    {PILOT_RECOVERY_TASKS.map(([name, count]) => {
      const takes = matched.get(name) || [];
      const byLabel = new Map(takes.map(v => [labelOf(v), v]));
      const labels = labelsFor(count);
      const dispatched = labels.filter(label => byLabel.has(label)).length;
      const rendered = labels.filter(label => byLabel.get(label)?.status === 'completed').length;
      const complete = rendered === count;
      const mounted = history.filter(e => e.tool === 'clickup-pilot' && e.title === `${name} entregue` && e.t >= STARTED)
        .flatMap(e => e.ref || []).find((ref): ref is Extract<FileRef, { via: 'zip' }> => ref.via === 'zip' && ref.label === 'Montado' && availableZips.has(ref.key));
      const progress = busy[name];
      const phase = mounted ? 'done' : progress ? 'post' : dispatched === 0 ? 'queued'
        : complete ? 'post' : 'rendering';
      return <BatchJobCard3D
        key={name} taskId={taskKey(name)} taskName={name}
        channels={[{ label: 'YOUTUBE', color: '#ff3333' }]}
        phase={phase} partsTotal={count} hooksTotal={1}
        partsDispatched={dispatched} partsRendered={rendered}
        message={progress || (mounted ? 'Montado salvo' : dispatched ? `${dispatched}/${count} takes confirmados no HeyGen` : '')}
        statusLabel={mounted ? 'Pronto' : progress ? 'Montando' : dispatched === 0 ? 'Em fila'
          : complete ? 'Montando' : 'Renderizando'}
        suppressBanner resumeTitle={complete && !mounted ? 'Montar vídeo' : 'Atualizar status do HeyGen'}
        elapsedMs={Date.now() - STARTED} allOk={!!mounted}
        isPartialDone={false} downloadBlocked={!mounted && !complete}
        montadoFilename={mounted?.name}
        onDownload={mounted ? () => void downloadMounted(name, mounted, takes, count)
          : complete ? () => void assemble(name, takes, count) : undefined}
        onRetomar={() => complete && !mounted ? void assemble(name, takes, count) : void refresh()}
        isRunning={phase === 'rendering' || phase === 'post'} isQueued={phase === 'queued'} queuedRecoverable
      >
        {dispatched > 0 ? <>
          <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">Takes ({rendered}/{dispatched} prontos)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {labels.flatMap((label, index) => {
              const take = byLabel.get(label);
              if (!take) return [];
              const preview: LipsyncTake = {
                label, status: take.status === 'unknown' ? 'processing' : take.status,
                videoUrl: take.videoUrl, error: take.error || null,
              };
              return <LipsyncPreviewCard key={take.videoId} take={preview} position={index + 1}
                total={count} percent={Math.round(rendered / count * 100)} fileBase={name.match(/^AD\d+VN/)?.[0] || name}
                formato="9:16" />;
            })}
          </div>
        </> : null}
      </BatchJobCard3D>;
    })}
  </>;
}
