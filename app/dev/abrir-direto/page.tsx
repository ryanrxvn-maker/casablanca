'use client';

/**
 * BANCADA do "abrir direto no editor" (08.10) — só em dev.
 * Monta um AD real pela MESMA pós-produção do Pilot (legenda, inserts com
 * título do catálogo, SFX, trilha) e abre a JANELA de verdade do Projeto
 * editável. Com o app Auto Edit Abrir instalado, o clique em CapCut chama o
 * app pelo link e o pacote baixa — o teste de ponta a ponta do PC do cliente.
 */

import { useState } from 'react';
import { PilotProjetoExportModal } from '@/components/PilotProjetoExport';

const TASK = 'dev-abrir-direto';
const FILENAME = 'ZZ ABRIR DIRETO G1.mp4';

export default function BancadaAbrirDireto() {
  const [avatar, setAvatar] = useState<File | null>(null);
  const [broll, setBroll] = useState<File | null>(null);
  const [broll169, setBroll169] = useState<File | null>(null);
  const [palavras, setPalavras] = useState<File | null>(null);
  const [trilhaArq, setTrilhaArq] = useState<File | null>(null);
  const [estado, setEstado] = useState('');
  const [pronto, setPronto] = useState(false);
  const [janela, setJanela] = useState(false);
  const [ultimo, setUltimo] = useState('');
  const [render, setRender] = useState<Blob | null>(null);
  const [resumo, setResumo] = useState('');
  /** só pra fotografar a janela: o "exportar" finge um pacote */
  const [janelaVisual, setJanelaVisual] = useState(false);
  const smart = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('smart') !== '0';

  const titulos = new Map([
    ['a1', 'CEREBRO REAL SAUDAVEL (2)'],
    ['a2', 'VELHA COM SAUDE'],
    ['a3', 'APLICANDO CANETINHA'],
  ]);

  async function montar() {
    if (!avatar || !broll || !broll169 || !palavras || !trilhaArq) return;
    setEstado('montando');
    const fetchOriginal = window.fetch;
    try {
      const words = JSON.parse(await palavras.text()) as Array<{ text: string; start: number; end: number }>;
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/tipografia/transcribe')) {
          return new Response(JSON.stringify({ words }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return fetchOriginal(input, init);
      }) as typeof fetch;
      const [{ saveBlob, loadBlob, deletePrefix }, projeto, pos, caption, trilhas] = await Promise.all([
        import('@/lib/zip-store'), import('@/lib/pilot-projeto'), import('@/lib/pilot-pos-producao-run'),
        import('@/lib/typography/caption-script'), import('@/lib/pilot-trilhas-store'),
      ]);
      await deletePrefix(projeto.prefixoDoProjeto(TASK));
      await saveBlob('dev-abrir:brollv', broll, broll.type || 'video/mp4');
      await saveBlob('dev-abrir:broll169', broll169, broll169.type || 'video/mp4');
      const tri = await trilhas.salvarTrilha(trilhaArq);
      const hook = words.slice(0, 23).map((w) => w.text).join(' ');
      const body = words.slice(23).map((w) => w.text).join(' ');
      const comum = { focoAvatarY: 0.34, midiaTipo: 'video' as const, source: 'stockframe' as const };
      const inserts: import('@/lib/pilot-inserts').Insert[] = [
        { ...comum, id: 'a1', ancora: 'HOOK 1', palavraDe: 4, palavraAte: 14, layout: { tipo: 'cheia' }, transicao: 'luz-vermelha',
          midiaKey: 'dev-abrir:broll169', midiaNome: 'StockFrame_MEM_46DQV.mp4', midiaW: 1920, midiaH: 1080,
          stockFrame: { videoId: 'v1', code: 'MEM-46DQV', title: titulos.get('a1')! } },
        { ...comum, id: 'a2', ancora: 'BODY 1', palavraDe: 2, palavraAte: 8, layout: { tipo: 'cards', avatar: 'baixo' }, transicao: 'piscar',
          midiaKey: 'dev-abrir:brollv', midiaNome: 'StockFrame_PER_WP83D.mp4', midiaW: 720, midiaH: 1280, recorteDe: 1,
          stockFrame: { videoId: 'v2', code: 'PER-WP83D', title: titulos.get('a2')! } },
        { ...comum, id: 'a3', ancora: 'BODY 1', palavraDe: 14, palavraAte: 19, layout: { tipo: 'faixas', avatar: 'cima' }, transicao: 'luz',
          midiaKey: 'dev-abrir:brollv', midiaNome: 'StockFrame_EMA_X1.mp4', midiaW: 720, midiaH: 1280, recorteDe: 4,
          stockFrame: { videoId: 'v3', code: 'EMA-X1', title: titulos.get('a3')! } },
      ];
      const r = await pos.montarPosProducao(avatar, { filename: FILENAME, partesSec: [6.05, 7.95], partLabels: ['HOOK 1', 'BODY 1'] }, {
        legenda: { on: true, templateId: caption.BUILTIN_TEMPLATES[0].id, smartPosition: smart },
        zoom: { on: false, modo: 'in', forca: 'medio' },
        partes: [{ label: 'HOOK 1', text: hook }, { label: 'BODY 1', text: body }],
        idioma: 'pt',
        templates: caption.BUILTIN_TEMPLATES,
        ffmpegJaExclusivo: false,
        inserts,
        lerMidia: (key) => loadBlob(key),
        sfx: { on: true, porTransicao: { escurecer: 'plim-alternado', luz: 'camera-flash', 'luz-vermelha': 'riser-metalico', piscar: 'mouse-click' }, boomNoGancho: true, densidade: 'equilibrado', volume: 1 },
        trilha: { on: true, trilhaId: tri.id, nome: tri.nome, volume: 0.12 },
        lerTrilha: async (id) => {
          const b = await trilhas.lerTrilha(id);
          const m = trilhas.trilhaPorId(id);
          return b ? { blob: b, nome: m?.nome || 'trilha', lufs: m?.lufs ?? null } : null;
        },
        guardarProjeto: async (roteiro, avatarLimpo) => {
          const ch = projeto.chavesDoProjeto(TASK, FILENAME);
          await saveBlob(ch.base, avatarLimpo, avatarLimpo.type || 'video/mp4');
          await saveBlob(ch.roteiro, new Blob([JSON.stringify({ ...roteiro, genId: 'dev' })], { type: 'application/json' }), 'application/json');
        },
        onEtapa: setEstado,
      });
      if (!r.blob) throw new Error(`render não saiu: ${r.avisos.join(' | ')}`);
      setRender(r.blob);
      // RESUMO pro teste: cada janela dividida × blocos de legenda que atravessam a borda
      const ch = projeto.chavesDoProjeto(TASK, FILENAME);
      const rot = JSON.parse(await (await loadBlob(ch.roteiro, 'application/json'))!.text()) as import('@/lib/pilot-projeto').RoteiroEdicao;
      const bl = rot.legenda?.blocks || [];
      const divididas = rot.inserts.filter((i) => i.layout.tipo !== 'cheia');
      const atravessa = divididas.flatMap((j) => [j.start, j.end]).flatMap((borda) => bl.filter((b) => b.start < borda * 1000 - 1e-6 && b.end > borda * 1000 + 1e-6).map((b) => `${b.words.map((w) => w.text).join(' ')}@${borda.toFixed(3)}`));
      const encavalados = bl.filter((b, i) => i > 0 && bl[i - 1].end > b.start + 1e-6).length;
      setResumo(JSON.stringify({ smart, divididas: divididas.map((j) => [j.start, j.end, j.layout.tipo]), blocos: bl.length, atravessa, encavalados,
        blocosPerto: divididas.flatMap((j) => bl.filter((b) => Math.abs(b.end / 1000 - j.end) < 1.2 || Math.abs(b.start / 1000 - j.end) < 1.2).map((b) => [b.start, b.end, b.words.map((w) => w.text).join(' ')])) }));
      setPronto(true);
      setEstado(`montado: ${(r.blob.size / 1e6).toFixed(1)}MB · sfx ${r.sonoplastia?.sfx} · trilha ${r.sonoplastia?.trilha}`);
    } catch (e) {
      setEstado(`erro: ${(e as Error)?.message || e}`);
    } finally {
      window.fetch = fetchOriginal;
    }
  }

  async function exportar(alvo: 'capcut' | 'premiere', onEtapa: (m: string) => void, opts?: { job?: string }) {
    const [run, trilhas] = await Promise.all([import('@/lib/pilot-projeto-run'), import('@/lib/pilot-trilhas-store')]);
    const projetos = await run.projetosDaTask(TASK, 'dev');
    const r = await run.exportarProjetosEditaveis({
      projetos, nomeBase: 'ZZ ABRIR DIRETO', destino: null, alvo, lerTrilha: trilhas.lerTrilha, onEtapa,
      infoDosTakes: (id) => ({ titulo: titulos.get(id) || null }), job: opts?.job,
    });
    if (!r.zip) throw new Error('sem zip');
    const url = URL.createObjectURL(r.zip.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.zip.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    setUltimo(`${r.zip.nome} · job ${opts?.job || '-'}`);
    return { arquivo: r.zip.nome, avisos: r.avisos };
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1>Abrir direto no editor — bancada</h1>
      <p><label>avatar <input data-testid="avatar" type="file" accept="video/*" onChange={(e) => setAvatar(e.target.files?.[0] || null)} /></label></p>
      <p><label>b-roll <input data-testid="broll" type="file" accept="video/*" onChange={(e) => setBroll(e.target.files?.[0] || null)} /></label></p>
      <p><label>b-roll 16:9 <input data-testid="broll169" type="file" accept="video/*" onChange={(e) => setBroll169(e.target.files?.[0] || null)} /></label></p>
      <p><label>palavras <input data-testid="palavras" type="file" accept="application/json" onChange={(e) => setPalavras(e.target.files?.[0] || null)} /></label></p>
      <p><label>trilha <input data-testid="trilha" type="file" accept="audio/*" onChange={(e) => setTrilhaArq(e.target.files?.[0] || null)} /></label></p>
      <button type="button" data-testid="montar" onClick={() => void montar()} disabled={!avatar || !broll || !broll169 || !palavras || !trilhaArq}>Montar AD real</button>{' '}
      <button type="button" data-testid="projeto" onClick={() => setJanela(true)} disabled={!pronto}>Projeto editável</button>{' '}
      <button type="button" data-testid="baixar-render" disabled={!render} onClick={() => {
        if (!render) return;
        const a = document.createElement('a'); a.href = URL.createObjectURL(render); a.download = `RENDER - ZZ ABRIR DIRETO${smart ? '' : ' - SMART OFF'}.mp4`; a.click();
      }}>Baixar render</button>{' '}
      <button type="button" data-testid="janela-visual" onClick={() => setJanelaVisual(true)}>Janela (visual)</button>
      <p data-testid="resumo" style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{resumo}</p>
      <p data-testid="estado">{estado}</p>
      <p data-testid="ultimo">{ultimo}</p>
      {janela ? <PilotProjetoExportModal nomeAd="ZZ ABRIR DIRETO" onFechar={() => setJanela(false)} exportar={exportar} /> : null}
      {janelaVisual ? (
        <PilotProjetoExportModal nomeAd="AD01 - CREATOR" onFechar={() => setJanelaVisual(false)}
          exportar={async (_alvo, onEtapa) => { onEtapa('desenhando a legenda'); await new Promise((r) => setTimeout(r, 900)); return { arquivo: 'AD01 - CREATOR - CAPCUT.zip', avisos: ['o b-roll usa cards com cantos arredondados — no editor os cantos ficam retos.'] }; }} />
      ) : null}
    </main>
  );
}
