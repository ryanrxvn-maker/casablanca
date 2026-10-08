'use client';

/**
 * BANCADA DEV-ONLY das janelas novas do Pilot (08.10): Mixer de velocidade,
 * SFX e trilha (com a trilha dentro), Projeto editável (CapCut × Premiere) e o
 * Smart Position da janela de legenda — os componentes REAIS, com dados de
 * mentira, pra conferir o visual sem login. Fora do dev, 404.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';
import {
  PilotBtn3D, IconLegenda, IconZoomDinamica, IconInserts, IconHeadline, IconNivelar, IconScissors, IconVelocidade, IconSonoplastia,
} from '@/components/PilotCardActions';
import { PilotVelocidadeModal } from '@/components/PilotVelocidade';
import { PilotSonoplastiaModal, type RoteiroDeSom } from '@/components/PilotSonoplastia';
import { PilotProjetoExportModal } from '@/components/PilotProjetoExport';
import { LegendaZoomPopover } from '@/components/PilotLegendaZoom';
import { SeletorDeTransicao } from '@/components/InsertFormato';
import { SFX_CFG_DEFAULT, TRILHA_CFG_DEFAULT, VELOCIDADE_CFG_DEFAULT, type SfxCfg, type TrilhaCfg, type VelocidadeCfg } from '@/lib/pilot-sonoplastia';
import { LEGENDA_CFG_DEFAULT, ZOOM_CFG_DEFAULT, type LegendaCfg } from '@/lib/pilot-pos-producao';
import { BUILTIN_TEMPLATES } from '@/lib/typography/caption-script';
import type { TipoTransicao } from '@/lib/pilot-inserts';

const ROTEIRO: RoteiroDeSom = {
  filename: 'AD97G1VN - SOM.mp4',
  durSec: 42,
  fimDoGancho: 5.26,
  transicoes: [
    { t: 0.82, tipo: 'luz-vermelha', insertId: 's1', borda: 'entrada', chave: 's1@entrada' },
    { t: 3.48, tipo: 'luz-vermelha', insertId: 's1', borda: 'saida', chave: 's1@saida' },
    { t: 5.95, tipo: 'piscar', insertId: 's2', borda: 'entrada', chave: 's2@entrada' },
    { t: 7.32, tipo: 'piscar', insertId: 's2', borda: 'saida', chave: 's2@saida' },
    { t: 9.27, tipo: 'luz', insertId: 's3', borda: 'entrada', chave: 's3@entrada' },
    { t: 11.41, tipo: 'luz', insertId: 's3', borda: 'saida', chave: 's3@saida' },
    { t: 16.2, tipo: 'escurecer', insertId: 's4', borda: 'entrada', chave: 's4@entrada' },
    { t: 19.9, tipo: 'escurecer', insertId: 's4', borda: 'saida', chave: 's4@saida' },
    { t: 25.4, tipo: 'escurecer', insertId: 's5', borda: 'entrada', chave: 's5@entrada' },
  ],
};

export default function PilotSonoroDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [aberto, setAberto] = useState<string | null>(null);
  const [vel, setVel] = useState<VelocidadeCfg>({ ...VELOCIDADE_CFG_DEFAULT, on: true, velocidade: 1.15 });
  const [sfx, setSfx] = useState<SfxCfg>({ ...SFX_CFG_DEFAULT, on: true });
  const [trilha, setTrilha] = useState<TrilhaCfg>(TRILHA_CFG_DEFAULT);
  const [leg, setLeg] = useState<LegendaCfg>({ ...LEGENDA_CFG_DEFAULT, on: true });
  const [trans, setTrans] = useState<TipoTransicao>('piscar');
  const fechar = () => setAberto(null);
  return (
    <main style={{ padding: 32, minHeight: '100vh', background: 'rgb(var(--bg))' }}>
      <h1 style={{ color: 'rgb(var(--text))', fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Pilot · janelas novas (bancada)</h1>
      <div data-testid="barra" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: 16, background: 'rgba(255,255,255,0.04)', width: 'fit-content' }}>
        <PilotBtn3D icon={<IconScissors size={16} />} color="cyan" active title="Decupagem" />
        <PilotBtn3D icon={<IconNivelar size={16} />} color="cyan" active title="Normalizador" />
        <PilotBtn3D icon={<IconVelocidade size={16} />} color={vel.on ? 'orange' : 'neutral'} active={vel.on} title="Mixer de velocidade" onClick={() => setAberto('vel')} />
        <PilotBtn3D icon={<IconLegenda size={16} />} color="amber" active title="Legenda" onClick={() => setAberto('leg')} />
        <PilotBtn3D icon={<IconZoomDinamica size={16} />} color="violet" active title="Zoom" />
        <PilotBtn3D icon={<IconInserts size={16} />} color="cyan" active title="Inserts" />
        <PilotBtn3D icon={<IconHeadline size={16} />} color="rose" active title="Headline" />
        <PilotBtn3D icon={<IconSonoplastia size={16} />} color={sfx.on || trilha.on ? 'emerald' : 'neutral'} active={sfx.on || trilha.on} title="SFX e trilha" onClick={() => setAberto('som')} />
        <PilotBtn3D icon={<IconVelocidade size={16} />} color="neutral" title="desligado (comparação)" />
        <PilotBtn3D icon={<IconSonoplastia size={16} />} color="neutral" title="desligado (comparação)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" data-testid="abrir-projeto" onClick={() => setAberto('proj')} style={{ color: 'rgb(var(--text))' }}>projeto editável</button>
      </div>
      <div style={{ marginTop: 20, maxWidth: 640 }}>
        <SeletorDeTransicao valor={trans} onMudar={setTrans} />
      </div>
      {aberto === 'vel' ? <PilotVelocidadeModal cfg={vel} onMudar={(c) => setVel(c)} onFechar={fechar} /> : null}
      {aberto === 'som' ? (
        <PilotSonoplastiaModal sfx={sfx} trilha={trilha} onSfx={(c) => setSfx(c)} onTrilha={(c) => setTrilha(c)} onFechar={fechar} roteiro={async () => ROTEIRO} />
      ) : null}
      {aberto === 'leg' ? (
        <LegendaZoomPopover tipo="legenda" onFechar={fechar} legenda={leg} zoom={ZOOM_CFG_DEFAULT} templates={BUILTIN_TEMPLATES.slice(0, 2)} onLegenda={(c) => setLeg(c)} onZoom={() => {}} />
      ) : null}
      {aberto === 'proj' ? (
        <PilotProjetoExportModal
          nomeAd="AD97G1VN - SOM"
          onFechar={fechar}
          exportar={async (alvo, onEtapa) => {
            for (const e of ['lendo o avatar', 'b-roll 2/3', 'desenhando a piscada', 'SFX', 'escrevendo o PDF de como abrir', 'compactando o pacote']) {
              onEtapa(`AD97G1VN - SOM.mp4: ${e}`);
              await new Promise((r) => setTimeout(r, 700));
            }
            return { arquivo: `AD97 SOM - ${alvo === 'capcut' ? 'CAPCUT' : 'PREMIERE'}.zip`, avisos: ['o b-roll "PROSTATA 3D" usa cards com cantos arredondados: no editor os cantos ficam retos.'] };
          }}
        />
      ) : null}
    </main>
  );
}
