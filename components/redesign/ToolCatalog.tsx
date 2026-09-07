'use client';
import Link from 'next/link';
import { useState } from 'react';
import { IconDecupagem, IconFakePass, IconTipografia, IconLipsync, IconCopySRT, IconCamuflagem, IconCompressor, IconDownloader, IconNormalizador, IconAcelerador, IconAudioSplit } from '@/components/ToolIcons';

export const CATALOG = [
  { name: 'FakePrint', description: 'Manchetes, conversas e posts prontos para o seu criativo.', path: 'fakepass', category: 'Criar', free: true, Icon: IconFakePass },
  { name: 'Legendas Automáticas', description: 'Sua fala em legendas animadas, com centenas de modelos.', path: 'tipografia', category: 'Criar', free: true, Icon: IconTipografia },
  { name: 'Decupagem', description: 'Remova silêncios e ajuste o ritmo dos seus vídeos.', path: 'decupagem', category: 'Editar', free: true, Icon: IconDecupagem },
  { name: 'Lipsync Video to Video', description: 'Sincronize a fala do seu avatar com um novo áudio.', path: 'lipsync', category: 'Criar', free: false, Icon: IconLipsync },
  { name: 'Gerador de SRT', description: 'Alinhe a sua copy ao áudio, palavra por palavra.', path: 'copy-srt', category: 'Criar', free: false, Icon: IconCopySRT },
  { name: 'Camuflagem', description: 'Combine duas trilhas e confira o resultado por plataforma.', path: 'camuflagem', category: 'Editar', free: false, Icon: IconCamuflagem },
  { name: 'Compressor', description: 'Ajuste o peso do vídeo para a sua entrega.', path: 'compressor', category: 'Preparar', free: true, Icon: IconCompressor },
  { name: 'Downloader', description: 'Reúna vídeos, áudios e imagens para editar.', path: 'downloader', category: 'Preparar', free: true, Icon: IconDownloader },
  { name: 'Normalizador', description: 'Equilibre o volume dos seus arquivos de áudio.', path: 'normalizador', category: 'Editar', free: true, Icon: IconNormalizador },
  { name: 'Mixer de Velocidade', description: 'Acelere ou desacelere com controle sobre a voz.', path: 'acelerador', category: 'Editar', free: false, Icon: IconAcelerador },
  { name: 'Dividir áudios', description: 'Separe trechos nas pausas, sem interromper a fala.', path: 'audio-split', category: 'Preparar', free: false, Icon: IconAudioSplit },
];
export function ToolCatalog() {
  const [filter, setFilter] = useState('Todas');
  const filtered = CATALOG.filter(tool => filter === 'Todas' || tool.category === filter);
  return <><div className="ae-filters" role="group" aria-label="Filtrar ferramentas">{['Todas', 'Criar', 'Editar', 'Preparar'].map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="ae-tool-catalog">{filtered.map(tool => <Link href={`/register?next=/tools/${tool.path}`} className="ae-catalog-item" key={tool.path}><span className="ae-tool-icon"><tool.Icon size={30} /></span><span><span className="ae-catalog-name">{tool.name}</span><span className="ae-catalog-description">{tool.description}</span></span><span className="ae-catalog-meta"><span>{tool.free ? 'Grátis' : 'Premium'}</span><span aria-hidden>↗</span></span></Link>)}</div><p className="ae-catalog-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'ferramenta' : 'ferramentas'} · Histórico de entregas incluído</p></>;
}
