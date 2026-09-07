'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolHero, ToolStep, ToolChoice, ToolSlider, ToolAction, ToolDropzone } from '@/components/tool-kit';
import { IconStepFiles, IconStepSliders, IconStepFormat } from '@/components/ToolIcons';
import { BatchFileUpload } from '@/components/BatchFileUpload';

/** Isolated, local UI review. It never calls an API or processes a file. */
export function ControlsPreview() {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState('wav');
  const [quality, setQuality] = useState(80);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const tryAction = () => {
    setLoading(true); setMessage('');
    timer.current = setTimeout(() => { setLoading(false); setMessage('Estado de conclusão exibido. Nenhum arquivo foi processado.'); }, 1600);
  };
  return <div className="ae-tool-shell ae-controls-preview">
    <ToolHero title="Botões e estados" eyebrow="PRÉVIA DE INTERFACE" subtitle="Experimente os controles e a seleção de arquivos. Esta tela serve apenas para revisar a interface." icon={<IconStepSliders size={38} />} />
    <ToolStep n={1} title="Ações e feedback" hint="Estados normal, secundário, indisponível e em andamento.">
      <div className="ae-control-examples"><ToolAction loading={loading} onClick={tryAction}>Experimentar botão</ToolAction><ToolAction variant="secondary" onClick={()=>setMessage('Ação secundária acionada.')}>Ação secundária</ToolAction><ToolAction disabled>Indisponível</ToolAction></div>
      {message && <p className="ae-control-feedback" role="status">{message}</p>}
    </ToolStep>
    <ToolStep n={2} title="Escolhas e ajustes" icon={<IconStepFormat size={18} />}>
      <ToolChoice value={format} onChange={setFormat} options={[{value:'wav',label:'WAV',sub:'Sem compressão'},{value:'mp3',label:'MP3',sub:'Arquivo compacto'},{value:'m4a',label:'M4A',sub:'Boa compatibilidade'}]} />
      <div className="ae-control-slider"><ToolSlider label="Qualidade" min={10} max={100} value={quality} onChange={setQuality} display={v=>v+'%'} /></div>
    </ToolStep>
    <ToolStep n={3} title="Selecionar, trocar e remover" hint="Cancelar a troca mantém o arquivo anterior." icon={<IconStepFiles size={18} />}>
      <ToolDropzone accept="audio/*,video/*" file={file} onFile={setFile} hint="Áudio ou vídeo. O arquivo permanece neste navegador." />
    </ToolStep>
    <ToolStep n={4} title="Arquivos em lote" hint="A seleção também funciona pelo teclado." icon={<IconStepFiles size={18} />}>
      <BatchFileUpload value={files} onChange={setFiles} accept="audio/*,video/*" max={3} hint="Áudio ou vídeo" />
    </ToolStep>
  </div>;
}
