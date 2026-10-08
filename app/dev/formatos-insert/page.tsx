'use client';

/**
 * BANCADA DEV-ONLY dos FORMATOS DO INSERT (07.10) — roda a pós-produção REAL
 * (detector de rosto, recorte do fundo do React, render WebCodecs) num avatar
 * de verdade com b-roll de verdade, um formato por janela, e devolve um
 * quadro do meio de cada janela + o pico da transição vermelha. É a prova
 * visual de que tela dividida, mescla, linha e React saem certos no vídeo
 * final. Fora do dev, 404.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';
import type { Insert, LayoutInsert, TipoTransicao } from '@/lib/pilot-inserts';

type Caso = { nome: string; layout: LayoutInsert; transicao: TipoTransicao; broll: 1 | 2 };
const CASOS: Caso[] = [
  { nome: 'Tela cheia + luz vermelha', layout: { tipo: 'cheia' }, transicao: 'luz-vermelha', broll: 1 },
  { nome: 'Dividida', layout: { tipo: 'faixas', avatar: 'cima' }, transicao: 'nenhuma', broll: 2 },
  { nome: 'Arredondada', layout: { tipo: 'cards', avatar: 'cima' }, transicao: 'nenhuma', broll: 1 },
  { nome: 'Com linha verde', layout: { tipo: 'linha', avatar: 'cima', cor: '#22e06b' }, transicao: 'nenhuma', broll: 2 },
  { nome: 'Mescla', layout: { tipo: 'mescla', avatar: 'cima' }, transicao: 'nenhuma', broll: 1 },
  { nome: 'React direita', layout: { tipo: 'react', lado: 'direita' }, transicao: 'nenhuma', broll: 2 },
  { nome: 'React esquerda', layout: { tipo: 'react', lado: 'esquerda' }, transicao: 'nenhuma', broll: 1 },
];
const PALAVRAS_POR_CASO = 7;
const VAO = 3;

async function quadroEm(video: HTMLVideoElement, t: number, w: number, h: number): Promise<HTMLCanvasElement> {
  await new Promise<void>((res) => {
    let ok = false;
    const fim = () => { if (ok) return; ok = true; video.removeEventListener('seeked', fim); clearTimeout(tm); res(); };
    const tm = setTimeout(fim, 3000);
    video.addEventListener('seeked', fim);
    video.currentTime = t;
  });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return c;
}

export default function FormatosInsertDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [estado, setEstado] = useState('pronto');
  const [folha, setFolha] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState('/dev-formatos-avatar.mp4?v=parte1');

  async function rodar() {
    setFolha(null);
    setAvisos([]);
    const logs: string[] = [];
    const logOriginal = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); logOriginal(...args); };
    // A bancada roda DESLOGADA: o /ffmpeg/worker.js cai no redirect do login e
    // o ASR ficaria pendurado. Aqui ele falha na hora e a pós-produção usa a
    // estimativa pela copy (o caminho de sempre quando o ASR falha).
    const WorkerOriginal = window.Worker;
    window.Worker = function WorkerDaBancada(this: unknown, url: string | URL, opts?: WorkerOptions) {
      if (String(url).includes('/ffmpeg/')) throw new Error('bancada: ffmpeg indisponível sem login');
      return new WorkerOriginal(url, opts);
    } as unknown as typeof Worker;
    try {
      setEstado('baixando mídias');
      const [avatar, b1, b2] = await Promise.all([
        fetch(avatarUrl).then((r) => r.blob()),
        fetch('/dev-formatos-broll.mp4').then((r) => r.blob()),
        fetch('/dev-formatos-broll2.mp4').then((r) => r.blob()),
      ]);
      const ins = await import('@/lib/pilot-inserts');
      const { montarPosProducao } = await import('@/lib/pilot-pos-producao-run');
      const total = CASOS.length * (PALAVRAS_POR_CASO + VAO);
      const texto = Array.from({ length: total }, (_, i) => `palavra${i + 1}`).join(' ');
      const partes = [{ label: 'HOOK 1', text: texto }];
      const inserts: Insert[] = CASOS.map((caso, i) => ({
        ...ins.insertPadrao(`dev${i}`, 'HOOK 1', { key: `broll${caso.broll}`, nome: caso.nome, tipo: 'video', w: 1080, h: 1920 }),
        palavraDe: i * (PALAVRAS_POR_CASO + VAO),
        palavraAte: i * (PALAVRAS_POR_CASO + VAO) + PALAVRAS_POR_CASO - 1,
        layout: caso.layout,
        transicao: caso.transicao,
      }));
      const dur = await new Promise<number>((res) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => res(v.duration || 0);
        v.onerror = () => res(0);
        v.src = URL.createObjectURL(avatar);
      });
      const t0 = performance.now();
      const r = await montarPosProducao(avatar, { filename: 'dev-formatos.mp4', partesSec: [dur] }, {
        legenda: { on: false, templateId: 'x' },
        zoom: { on: false, modo: 'in', forca: 'medio' },
        partes,
        idioma: 'pt',
        templates: [],
        inserts,
        lerMidia: async (key) => (key === 'broll1' ? b1 : key === 'broll2' ? b2 : null),
        onEtapa: (m) => setEstado(m),
      });
      const seg = ((performance.now() - t0) / 1000).toFixed(1);
      setAvisos(r.avisos);
      if (!r.blob) { setEstado(`FALHOU (${seg}s): ${r.avisos.join(' | ')}`); return; }
      // janelas reais que o render usou (log da pós-produção)
      const linha = logs.find((l) => l.includes('dev-formatos.mp4:') && l.includes('insert(s)')) || '';
      const janelas = [...linha.matchAll(/(\d+(?:\.\d+)?)→(\d+(?:\.\d+)?)s/g)].map((m) => ({ start: parseFloat(m[1]), end: parseFloat(m[2]) }));
      const rostos = logs.find((l) => l.includes('rosto do avatar')) || 'sem log de rosto';
      const recorte = logs.find((l) => l.includes('[avatar-recorte] segmentador')) || 'recortador não carregou';
      setEstado(`render ok em ${seg}s · ${janelas.length} janelas · ${rostos} · ${recorte}`);

      const out = document.createElement('video');
      out.muted = true;
      out.preload = 'auto';
      out.src = URL.createObjectURL(r.blob);
      await new Promise<void>((res, rej) => { out.onloadeddata = () => res(); out.onerror = () => rej(new Error('saída não abriu')); });
      const QH = 480;
      const QW = Math.round(QH * (out.videoWidth || 1080) / (out.videoHeight || 1920));
      const quadros: Array<{ nome: string; c: HTMLCanvasElement }> = [];
      for (let i = 0; i < CASOS.length && i < janelas.length; i++) {
        const j = janelas[i];
        quadros.push({ nome: CASOS[i].nome, c: await quadroEm(out, (j.start + j.end) / 2, QW, QH) });
      }
      if (janelas[0]) quadros.push({ nome: 'Pico da luz vermelha', c: await quadroEm(out, janelas[0].start + 0.01, QW, QH) });
      // DETALHE em resolução cheia: o canto do React (borda do recorte)
      const iReact = CASOS.findIndex((c) => c.layout.tipo === 'react');
      if (janelas[iReact]) {
        const OW = out.videoWidth || 1080;
        const OH = out.videoHeight || 1920;
        const cheio = await quadroEm(out, (janelas[iReact].start + janelas[iReact].end) / 2, OW, OH);
        const det = document.createElement('canvas');
        det.width = Math.round(OW * 0.55);
        det.height = Math.round(OH * 0.45);
        det.getContext('2d')!.drawImage(cheio, OW - det.width, OH - det.height, det.width, det.height, 0, 0, det.width, det.height);
        (window as unknown as { __detalheReact?: string }).__detalheReact = det.toDataURL('image/jpeg', 0.92);
        (window as unknown as { __quadroReact?: string }).__quadroReact = cheio.toDataURL('image/jpeg', 0.9);
      }
      // folha de contato
      const col = 4;
      const lin = Math.ceil(quadros.length / col);
      const folhaC = document.createElement('canvas');
      folhaC.width = col * (QW + 12) + 12;
      folhaC.height = lin * (QH + 40) + 12;
      const g = folhaC.getContext('2d')!;
      g.fillStyle = '#111';
      g.fillRect(0, 0, folhaC.width, folhaC.height);
      g.font = 'bold 15px system-ui, sans-serif';
      quadros.forEach((q, k) => {
        const x = 12 + (k % col) * (QW + 12);
        const y = 12 + Math.floor(k / col) * (QH + 40);
        g.fillStyle = '#fff';
        g.fillText(q.nome, x, y + 16);
        g.drawImage(q.c, x, y + 26);
      });
      const url = folhaC.toDataURL('image/jpeg', 0.9);
      (window as unknown as { __folhaFormatos?: string }).__folhaFormatos = url;
      setFolha(url);
    } catch (e) {
      setEstado(`ERRO: ${(e as Error)?.message || e}`);
    } finally {
      console.log = logOriginal;
      window.Worker = WorkerOriginal;
    }
  }

  return (
    <main style={{ padding: 24, color: '#eee', background: '#0b0b0f', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Bancada — formatos do insert (render real)</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>Avatar: <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} style={{ width: 360, background: '#222', color: '#eee' }} /></p>
      <button type="button" onClick={() => void rodar()} style={{ padding: '8px 16px', background: '#7c3aed', borderRadius: 8, fontWeight: 700 }} data-rodar="1">Rodar prova</button>
      <p data-estado="1" style={{ marginTop: 12, fontSize: 13 }}>{estado}</p>
      {avisos.length ? <ul data-avisos="1" style={{ fontSize: 12, color: '#fbbf24' }}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {folha ? <img src={folha} alt="folha" style={{ maxWidth: '100%' }} data-folha="1" /> : null}
    </main>
  );
}
