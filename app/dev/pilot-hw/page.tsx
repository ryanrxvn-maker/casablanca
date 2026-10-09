'use client';

/**
 * BANCADA DEV-ONLY do acabamento Hardware do Pilot (09.10): os componentes
 * REAIS (card de disparo, takes, botões da barra) em vários estados, dentro
 * da mesma raiz .pilot-hw do Pilot, com a fumaça atrás. Os cards de produção
 * só existem logado; aqui dá pra conferir sem disparar nada. Fora do dev: 404.
 */

import { notFound } from 'next/navigation';
import { BatchJobCard3D } from '@/components/BatchJobCard3D';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { PilotBtn3D, IconScissors, IconCamuflagem, IconLegenda, IconZoomDinamica, IconHeadline, IconInserts, IconNivelar } from '@/components/PilotCardActions';
import { PilotSmoke } from '@/components/pilot/PilotSmoke';

const VIDEO = '/landing/legendas-ugc.mp4';
const TAKES: LipsyncTake[] = [1, 2, 3, 4, 5].map((n) => ({ label: `BODY ${n}`, status: n === 5 ? 'processing' : 'completed', videoUrl: n === 5 ? null : VIDEO }));
const noop = () => {};

export default function PilotHwBench() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const start = Date.now() - 5 * 60_000;
  return (
    <div className="min-h-screen py-10">
      <div className="hw-atmos" aria-hidden style={{ top: 0, left: 0 }}>
        <PilotSmoke className="hw-atmos__smoke" />
      </div>
      <div className="pilot-hw mx-auto w-full max-w-[1080px] px-5 md:px-8">
        <div className="tool-shell-panel mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 md:p-7">
          <div className="hw-prod mt-4 rounded-[18px] border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/[0.06] via-fuchsia-500/[0.02] to-transparent p-4">
            <div className="label-tech mb-3 flex items-center justify-between text-[10px] tracking-widest text-fuchsia-200">
              <span className="inline-flex items-center gap-2">
                <span className="relative flex h-2 w-2"><span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-300" /></span>
                Tasks em produção · 3
              </span>
            </div>
            <ul className="grid gap-3">
              <BatchJobCard3D
                taskId="t1" taskName="AD01 - CREATOR" phase="done" partsTotal={5} partsDispatched={5} partsRendered={5}
                elapsedMs={309_000} allOk isPartialDone={false} onRetomar={noop} onPausar={noop} onDebug={noop} onRemove={noop} onDownload={noop}
                isRunning={false} isQueued={false} docUrl="https://docs.google.com" channels={[{ label: 'YOUTUBE', color: '#c00000' }]}
                selos={[{ tipo: 'decupagem', title: 'Silêncios' }, { tipo: 'normalizador', title: 'Volume' }, { tipo: 'legenda', title: 'Legenda' }, { tipo: 'zoom', title: 'Zoom' }, { tipo: 'stockframe', title: 'StockFrame' }, { tipo: 'velocidade', title: 'Velocidade' }, { tipo: 'sonoplastia', title: 'Som' }, { tipo: 'headline', title: 'Headline' }]}
                defaultMinimized={false}
              >
                <div className="mono mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted"><span>Takes (4/5 prontos)</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {TAKES.map((t, i) => <LipsyncPreviewCard key={i} take={t} position={i + 1} total={5} percent={80} onEdit={noop} />)}
                </div>
              </BatchJobCard3D>
              <BatchJobCard3D
                taskId="t2" taskName="AD61VN - PRPB09" phase="rendering" partsTotal={10} partsDispatched={10} partsRendered={4} message="renderizando"
                elapsedMs={128_000} startedAt={start} elapsedLive allOk={false} isPartialDone={false} onRetomar={noop} onPausar={noop} onDebug={noop}
                isRunning isQueued={false} channels={[{ label: 'META', color: '#2a9fd6' }]}
              />
              <BatchJobCard3D
                taskId="t3" taskName="AD03GL - ME - RIPCPWA" phase="waiting-heygen" partsTotal={8} partsDispatched={8} partsRendered={6}
                message="limite diário do HeyGen atingido" elapsedMs={1_840_000} allOk={false} isPartialDone={false} onRetomar={noop} onDebug={noop} onRemove={noop}
                isRunning={false} isQueued={false}
              />
            </ul>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-1.5">
            <PilotBtn3D icon={<IconScissors size={16} />} color="lime" active title="Remover Silêncios ON" />
            <PilotBtn3D icon={<IconNivelar size={16} />} color="cyan" active title="Nivelar ON" />
            <PilotBtn3D icon={<IconLegenda size={16} />} color="neutral" title="Legenda OFF" />
            <PilotBtn3D icon={<IconZoomDinamica size={16} />} color="neutral" title="Zoom OFF" />
            <PilotBtn3D icon={<IconInserts size={16} />} color="cyan" active title="Inserts" />
            <PilotBtn3D icon={<IconHeadline size={16} />} color="rose" active title="Headline" />
            <PilotBtn3D icon={<IconCamuflagem size={16} />} color="fuchsia" title="Camuflagem" />
          </div>
        </div>
      </div>
    </div>
  );
}
