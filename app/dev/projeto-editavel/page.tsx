'use client';

/**
 * BANCADA DEV-ONLY do PROJETO EDITÁVEL (05.10) — grava no IndexedDB um
 * roteiro igual ao que a pós-produção guarda (avatar + b-roll + legenda +
 * headline + zoom + transição) e roda o exportador do navegador de ponta a
 * ponta, baixando o .zip. Usada pelo teste de navegador; fora do dev, 404.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';

const TASK = 'dev-projeto-editavel';
const TASK_REAL = 'dev-projeto-real';

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ProjetoEditavelDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [avatar, setAvatar] = useState<File | null>(null);
  const [broll, setBroll] = useState<File | null>(null);
  const [broll169, setBroll169] = useState<File | null>(null);
  const [palavras, setPalavras] = useState<File | null>(null);
  const [trilhaArq, setTrilhaArq] = useState<File | null>(null);
  const [estado, setEstado] = useState('aguardando arquivos');

  async function rodar() {
    if (!avatar || !broll) return;
    setEstado('gravando roteiro');
    try {
      const [{ saveBlob, deletePrefix }, projeto, run, grupo, engine, headline] = await Promise.all([
        import('@/lib/zip-store'), import('@/lib/pilot-projeto'), import('@/lib/pilot-projeto-run'),
        import('@/lib/typography/group'), import('@/lib/typography/engine'), import('@/lib/typography/headline'),
      ]);
      await deletePrefix(projeto.prefixoDoProjeto(TASK));
      const falas = 'Se você tem mais de cinquenta anos e levanta de madrugada pra urinar presta atenção nesse vídeo'.split(' ');
      const palavras = falas.map((text, i) => ({ text, start: 300 + i * 380, end: 300 + i * 380 + 330 }));
      const blocks = grupo.groupWords(palavras, 'rapido');
      await saveBlob('dev-projeto:broll', broll, broll.type || 'video/mp4');
      const roteiro: import('@/lib/pilot-projeto').RoteiroEdicao = {
        versao: 1, genId: 'dev', filename: 'AD99G1VN - TESTE.mp4', criadoEm: Date.now(), durSec: 12,
        inserts: [{ id: 'i1', nome: 'B-ROLL TESTE', tipo: 'video', midiaKey: 'dev-projeto:broll', start: 2, end: 6, deSec: 0, naturalSec: 2.5,
          velocidade: 0.75, congelaApos: 2.5 / 0.75, layout: { tipo: 'cheia' }, transicao: 'escurecer', audio: false, volume: 0.5, focoAvatarY: 0.34, w: 0, h: 0 },
        { id: 'i2', nome: 'SPLIT', tipo: 'video', midiaKey: 'dev-projeto:broll', start: 8, end: 10, deSec: 0.5, naturalSec: 4,
          velocidade: 1, congelaApos: 0, layout: { tipo: 'cards', avatar: 'baixo' }, transicao: 'luz', audio: true, volume: 0.3, focoAvatarY: 0.34, w: 0, h: 0 }],
        legenda: { blocks, style: { ...engine.DEFAULT_STYLE, presetId: 'keynote' } },
        zoom: [{ start: 0, end: 2, from: 1, to: 1.1 }, { start: 6, end: 12, from: 1.06, to: 1, rampaAte: 7.5 }],
        headlines: [{ id: 'hl', text: 'PRÓSTATA: O ERRO QUE TODO HOMEM COMETE', start: 0, end: 2000, style: { ...headline.HEADLINE_STYLE_DEFAULT } }],
      };
      const ch = projeto.chavesDoProjeto(TASK, roteiro.filename);
      await saveBlob(ch.base, avatar, avatar.type || 'video/mp4');
      await saveBlob(ch.roteiro, new Blob([JSON.stringify(roteiro)], { type: 'application/json' }), 'application/json');
      const projetos = await run.projetosDaTask(TASK, 'dev');
      const r = await run.exportarProjetosEditaveis({ projetos, nomeBase: 'AD99 TESTE', destino: null, onEtapa: setEstado });
      if (!r.zip) throw new Error('sem zip');
      const url = URL.createObjectURL(r.zip.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.zip.nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setEstado(`pronto: ${r.pastas.join(', ')} · ${(r.zip.blob.size / 1e6).toFixed(1)}MB · avisos: ${r.avisos.join(' | ') || 'nenhum'}`);
    } catch (e) {
      setEstado(`erro: ${(e as Error)?.message || e}`);
    }
  }

  /** PÓS-PRODUÇÃO REAL: roda `montarPosProducao` (o mesmo do Pilot) com
   *  legenda + zoom + headline + 3 inserts, deixa o `guardarProjeto` gravar o
   *  projeto e baixa o RENDER e o PROJETO — pra comparar quadro a quadro o que
   *  foi queimado com o que o CapCut monta. O ASR vem de um JSON (sem login). */
  async function rodarReal() {
    if (!avatar || !broll || !broll169 || !palavras) return;
    setEstado('preparando pós-produção real');
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
      const [{ saveBlob, loadBlob, deletePrefix }, projeto, run, pos, ins, caption] = await Promise.all([
        import('@/lib/zip-store'), import('@/lib/pilot-projeto'), import('@/lib/pilot-projeto-run'),
        import('@/lib/pilot-pos-producao-run'), import('@/lib/pilot-inserts'),
        import('@/lib/typography/caption-script'),
      ]);
      await deletePrefix(projeto.prefixoDoProjeto(TASK_REAL));
      await saveBlob('dev-real:brollv', broll, broll.type || 'video/mp4');
      await saveBlob('dev-real:broll169', broll169, broll169.type || 'video/mp4');
      const hook = words.slice(0, 23).map((w) => w.text).join(' ');
      const body = words.slice(23).map((w) => w.text).join(' ');
      const comum = { focoAvatarY: 0.34, midiaTipo: 'video' as const };
      const inserts: import('@/lib/pilot-inserts').Insert[] = [
        { ...comum, id: 'r1', ancora: 'HOOK 1', palavraDe: 4, palavraAte: 22, layout: { tipo: 'cheia' }, transicao: 'escurecer',
          midiaKey: 'dev-real:broll169', midiaNome: 'BARRAS 16x9', midiaW: 1920, midiaH: 1080 },
        { ...comum, id: 'r2', ancora: 'BODY 1', palavraDe: 2, palavraAte: 8, layout: { tipo: 'cards', avatar: 'baixo' }, transicao: 'luz',
          midiaKey: 'dev-real:brollv', midiaNome: 'PROSTATA 3D', midiaW: 720, midiaH: 1280, recorteDe: 1, audio: true, volume: 0.3 },
        { ...comum, id: 'r3', ancora: 'BODY 1', palavraDe: 14, palavraAte: 19, layout: { tipo: 'faixas', avatar: 'cima' }, transicao: 'misto',
          midiaKey: 'dev-real:brollv', midiaNome: 'PROSTATA 3D B', midiaW: 720, midiaH: 1280, recorteDe: 4 },
      ];
      const filename = 'AD98G1VN - REAL.mp4';
      const r = await pos.montarPosProducao(avatar, { filename, partesSec: [6.05, 7.95] }, {
        legenda: { on: true, templateId: caption.BUILTIN_TEMPLATES[0].id },
        zoom: { on: true, modo: 'inout', forca: 'medio' },
        partes: [{ label: 'HOOK 1', text: hook }, { label: 'BODY 1', text: body }],
        idioma: 'pt',
        templates: caption.BUILTIN_TEMPLATES,
        ffmpegJaExclusivo: false,
        inserts,
        headline: { ...ins.HEADLINE_CFG_DEFAULT, on: true, texto: 'PRÓSTATA: O ERRO QUE TODO HOMEM COMETE', ancoraDe: '', ancoraAte: 'BODY 1' },
        lerMidia: (key) => loadBlob(key),
        guardarProjeto: async (roteiro, avatarLimpo) => {
          const ch = projeto.chavesDoProjeto(TASK_REAL, filename);
          await saveBlob(ch.base, avatarLimpo, avatarLimpo.type || 'video/mp4');
          await saveBlob(ch.roteiro, new Blob([JSON.stringify({ ...roteiro, genId: 'dev' })], { type: 'application/json' }), 'application/json');
        },
        onEtapa: setEstado,
      });
      if (!r.blob) throw new Error(`render não saiu: ${r.avisos.join(' | ')}`);
      baixar(r.blob, 'RENDER - AD98G1VN - REAL.mp4');
      const projetos = await run.projetosDaTask(TASK_REAL, 'dev');
      const p = await run.exportarProjetosEditaveis({ projetos, nomeBase: 'AD98 REAL', destino: null, onEtapa: setEstado });
      if (!p.zip) throw new Error('sem zip do projeto');
      baixar(p.zip.blob, p.zip.nome);
      setEstado(`pronto-real: render ${(r.blob.size / 1e6).toFixed(1)}MB · ${p.pastas.join(', ')} · avisos render: ${r.avisos.join(' | ') || 'nenhum'} · avisos projeto: ${p.avisos.join(' | ') || 'nenhum'}`);
    } catch (e) {
      setEstado(`erro-real: ${(e as Error)?.message || e}`);
    } finally {
      window.fetch = fetchOriginal;
    }
  }

  /** SONOPLASTIA REAL (08.10): velocidade 1,15x + Smart SFX + trilha + Smart
   *  Position + luz vermelha / piscar / luz em tela dividida, pelo MESMO
   *  montarPosProducao do Pilot. Baixa o render, o avatar limpo (pra isolar o
   *  áudio novo), o roteiro e os pacotes do CapCut e do Premiere. */
  async function rodarSom() {
    if (!avatar || !broll || !broll169 || !palavras || !trilhaArq) return;
    setEstado('preparando sonoplastia real');
    const fetchOriginal = window.fetch;
    const VEL = 1.15;
    try {
      const words = JSON.parse(await palavras.text()) as Array<{ text: string; start: number; end: number }>;
      // o ASR real ouve o vídeo JÁ acelerado: o mock devolve as palavras no tempo novo
      const acelerado = words.map((w) => ({ ...w, start: w.start / VEL, end: w.end / VEL }));
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/tipografia/transcribe')) {
          return new Response(JSON.stringify({ words: acelerado }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return fetchOriginal(input, init);
      }) as typeof fetch;
      const [{ saveBlob, loadBlob, deletePrefix }, projeto, run, pos, caption, trilhas] = await Promise.all([
        import('@/lib/zip-store'), import('@/lib/pilot-projeto'), import('@/lib/pilot-projeto-run'),
        import('@/lib/pilot-pos-producao-run'), import('@/lib/typography/caption-script'), import('@/lib/pilot-trilhas-store'),
      ]);
      const TASK_SOM = 'dev-projeto-som';
      await deletePrefix(projeto.prefixoDoProjeto(TASK_SOM));
      await saveBlob('dev-som:brollv', broll, broll.type || 'video/mp4');
      await saveBlob('dev-som:broll169', broll169, broll169.type || 'video/mp4');
      setEstado('medindo a trilha');
      const tri = await trilhas.salvarTrilha(trilhaArq);
      const hook = words.slice(0, 23).map((w) => w.text).join(' ');
      const body = words.slice(23).map((w) => w.text).join(' ');
      const comum = { focoAvatarY: 0.34, midiaTipo: 'video' as const };
      const inserts: import('@/lib/pilot-inserts').Insert[] = [
        { ...comum, id: 's1', ancora: 'HOOK 1', palavraDe: 4, palavraAte: 14, layout: { tipo: 'cheia' }, transicao: 'luz-vermelha',
          midiaKey: 'dev-som:broll169', midiaNome: 'BARRAS 16x9', midiaW: 1920, midiaH: 1080 },
        { ...comum, id: 's2', ancora: 'BODY 1', palavraDe: 2, palavraAte: 8, layout: { tipo: 'cards', avatar: 'baixo' }, transicao: 'piscar',
          midiaKey: 'dev-som:brollv', midiaNome: 'PROSTATA 3D', midiaW: 720, midiaH: 1280, recorteDe: 1 },
        { ...comum, id: 's3', ancora: 'BODY 1', palavraDe: 14, palavraAte: 19, layout: { tipo: 'faixas', avatar: 'cima' }, transicao: 'luz',
          midiaKey: 'dev-som:brollv', midiaNome: 'PROSTATA 3D B', midiaW: 720, midiaH: 1280, recorteDe: 4 },
      ];
      const filename = 'AD97G1VN - SOM.mp4';
      let roteiroGuardado: unknown = null;
      const r = await pos.montarPosProducao(avatar, { filename, partesSec: [6.05, 7.95], partLabels: ['HOOK 1', 'BODY 1'] }, {
        legenda: { on: true, templateId: caption.BUILTIN_TEMPLATES[0].id, smartPosition: true },
        zoom: { on: false, modo: 'in', forca: 'medio' },
        partes: [{ label: 'HOOK 1', text: hook }, { label: 'BODY 1', text: body }],
        idioma: 'pt',
        templates: caption.BUILTIN_TEMPLATES,
        ffmpegJaExclusivo: false,
        inserts,
        lerMidia: (key) => loadBlob(key),
        velocidade: { on: true, velocidade: VEL },
        sfx: { on: true, porTransicao: { escurecer: 'plim-alternado', luz: 'camera-flash', 'luz-vermelha': 'riser-metalico', piscar: 'mouse-click' }, boomNoGancho: true, densidade: 'todas', volume: 1 },
        trilha: { on: true, trilhaId: tri.id, nome: tri.nome, volume: 0.12 },
        lerTrilha: async (id) => {
          const b = await trilhas.lerTrilha(id);
          const m = trilhas.trilhaPorId(id);
          return b ? { blob: b, nome: m?.nome || 'trilha', lufs: m?.lufs ?? null } : null;
        },
        guardarProjeto: async (roteiro, avatarLimpo) => {
          roteiroGuardado = roteiro;
          const ch = projeto.chavesDoProjeto(TASK_SOM, filename);
          await saveBlob(ch.base, avatarLimpo, avatarLimpo.type || 'video/mp4');
          await saveBlob(ch.roteiro, new Blob([JSON.stringify({ ...roteiro, genId: 'dev' })], { type: 'application/json' }), 'application/json');
        },
        onEtapa: setEstado,
      });
      if (!r.blob) throw new Error(`render não saiu: ${r.avisos.join(' | ')}`);
      baixar(r.blob, 'RENDER - AD97G1VN - SOM.mp4');
      const ch = projeto.chavesDoProjeto(TASK_SOM, filename);
      const base = await loadBlob(ch.base);
      if (base) baixar(base, 'BASE - AD97G1VN - SOM.mp4');
      baixar(new Blob([JSON.stringify({ roteiro: roteiroGuardado, avisos: r.avisos, sonoplastia: r.sonoplastia, velocidade: r.velocidade, aplicouVisual: r.aplicouVisual }, null, 1)], { type: 'application/json' }), 'ROTEIRO - AD97G1VN - SOM.json');
      const projetos = await run.projetosDaTask(TASK_SOM, 'dev');
      const avisosPacote: string[] = [];
      for (const alvo of ['capcut', 'premiere'] as const) {
        const p = await run.exportarProjetosEditaveis({ projetos, nomeBase: 'AD97 SOM', destino: null, alvo, lerTrilha: trilhas.lerTrilha, onEtapa: setEstado });
        if (!p.zip) throw new Error(`sem zip ${alvo}`);
        baixar(p.zip.blob, p.zip.nome);
        avisosPacote.push(...p.avisos);
      }
      setEstado(`pronto-som: render ${(r.blob.size / 1e6).toFixed(1)}MB · sfx ${r.sonoplastia?.sfx} · trilha ${r.sonoplastia?.trilha} · vel ${r.velocidade} · avisos: ${r.avisos.join(' | ') || 'nenhum'} · pacote: ${avisosPacote.join(' | ') || 'nenhum'}`);
    } catch (e) {
      setEstado(`erro-som: ${(e as Error)?.message || e}`);
    } finally {
      window.fetch = fetchOriginal;
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1>Projeto editável — bancada</h1>
      <p><label>avatar <input data-testid="avatar" type="file" accept="video/*" onChange={(e) => setAvatar(e.target.files?.[0] || null)} /></label></p>
      <p><label>b-roll <input data-testid="broll" type="file" accept="video/*" onChange={(e) => setBroll(e.target.files?.[0] || null)} /></label></p>
      <p><label>b-roll 16:9 <input data-testid="broll169" type="file" accept="video/*" onChange={(e) => setBroll169(e.target.files?.[0] || null)} /></label></p>
      <p><label>palavras do ASR (.json) <input data-testid="palavras" type="file" accept="application/json" onChange={(e) => setPalavras(e.target.files?.[0] || null)} /></label></p>
      <button type="button" data-testid="rodar" onClick={() => void rodar()} disabled={!avatar || !broll}>Exportar projeto de teste</button>{' '}
      <p><label>trilha <input data-testid="trilha" type="file" accept="audio/*" onChange={(e) => setTrilhaArq(e.target.files?.[0] || null)} /></label></p>
      <button type="button" data-testid="rodar-real" onClick={() => void rodarReal()} disabled={!avatar || !broll || !broll169 || !palavras}>Pós-produção real + projeto</button>{' '}
      <button type="button" data-testid="rodar-som" onClick={() => void rodarSom()} disabled={!avatar || !broll || !broll169 || !palavras || !trilhaArq}>Sonoplastia real (SFX + trilha + velocidade + smart)</button>
      <p data-testid="estado">{estado}</p>
    </main>
  );
}
