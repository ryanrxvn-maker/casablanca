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

export default function ProjetoEditavelDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [avatar, setAvatar] = useState<File | null>(null);
  const [broll, setBroll] = useState<File | null>(null);
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

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1>Projeto editável — bancada</h1>
      <p><label>avatar <input data-testid="avatar" type="file" accept="video/*" onChange={(e) => setAvatar(e.target.files?.[0] || null)} /></label></p>
      <p><label>b-roll <input data-testid="broll" type="file" accept="video/*" onChange={(e) => setBroll(e.target.files?.[0] || null)} /></label></p>
      <button type="button" data-testid="rodar" onClick={() => void rodar()} disabled={!avatar || !broll}>Exportar projeto de teste</button>
      <p data-testid="estado">{estado}</p>
    </main>
  );
}
