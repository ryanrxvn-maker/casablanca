'use client';

/**
 * BANCADA DEV-ONLY da pele nova do Pilot (08.10).
 *
 * O Pilot real só mostra card de produção com sessão (os disparos moram nos
 * registros da conta). Aqui os componentes REAIS (BatchJobCard3D, takes,
 * botões-instrumento, motor, formato, seletores de avatar e voz) aparecem em
 * vários estados com dados de mentira, dentro da mesma casca (fumaça, luz de
 * borda), pra conferir o visual sem disparar nada. Fora do dev: 404.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';
import { PilotShell, PlSpot } from '@/components/pilot/PilotShell';
import { PilotModeHub } from '@/components/PilotModeHub';
import { CreatorBar } from '@/components/PilotFontesBar';
import { BatchJobCard3D } from '@/components/BatchJobCard3D';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { PilotBtn3D, IconScissors, IconCamuflagem, IconLegenda, IconZoomDinamica, IconHeadline, IconInserts, IconNivelar } from '@/components/PilotCardActions';
import { MotorConfigPicker } from '@/components/MotorConfigPicker';
import { PilotFormatoToggle } from '@/components/PilotFormatoToggle';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { CompactVoiceSelector } from '@/components/CompactVoiceSelector';
import { IconClickUpPilot } from '@/components/ToolIcons';
import type { ModoPilot } from '@/lib/pilot-fontes';
import type { FormatoVideo } from '@/lib/pilot-formato';
import type { MotorConfig } from '@/lib/motor-config';

const VIDEO = '/landing/legendas-ugc.mp4';
const TAKES: LipsyncTake[] = [1, 2, 3, 4, 5].map((n) => ({
  label: `BODY ${n}`,
  status: n === 5 ? 'processing' : 'completed',
  videoUrl: n === 5 ? null : VIDEO,
}));

const noop = () => {};

export default function PilotDesignBench() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const [modo, setModo] = useState<ModoPilot>('clickup');
  const [formato, setFormato] = useState<FormatoVideo>('9:16');
  const [motor, setMotor] = useState<MotorConfig>({ kind: 'global', motor: 'III' } as MotorConfig);
  const [decup, setDecup] = useState(true);
  const [nivel, setNivel] = useState(true);
  const [camu, setCamu] = useState(false);

  const start = Date.now() - 5 * 60_000 - 9_000;
  return (
    <PilotShell
      title="Pilot"
      eyebrow="Automação · Orquestrador"
      lead="O cérebro do estúdio."
      description="A copy pode vir do zero, de um Google Docs ou das tasks do ClickUp. O Pilot prepara avatar e voz, dispara no HeyGen e entrega o vídeo montado, com silêncios removidos e legenda em fila, sem você abrir uma aba sequer."
      icon={<IconClickUpPilot size={56} />}
    >
      <PilotModeHub value={modo} onChange={setModo} contagem={{ creator: 1, clickup: 14 }}>
        {modo === 'creator' ? <CreatorBar onNova={noop} /> : null}
      </PilotModeHub>

      <div className="pl-glass pl-prod" data-pl-spot>
        <PlSpot />
        <div className="pl-prod__head">
          <span className="inline-flex items-center gap-3">
            <span className="pl-prod__dot" aria-hidden />
            <span className="pl-h3">Tasks em produção</span>
            <span className="pl-count" style={{ color: 'rgb(var(--pink))', background: 'rgb(var(--pink) / 0.1)', boxShadow: 'inset 0 0 0 1px rgb(var(--pink) / 0.32)' }}>4</span>
          </span>
        </div>
        <ul className="grid gap-3">
          <BatchJobCard3D
            taskId="t1"
            taskName="AD01 - CREATOR"
            phase="done"
            partsTotal={5}
            partsDispatched={5}
            partsRendered={5}
            elapsedMs={309_000}
            allOk
            isPartialDone={false}
            onRetomar={noop}
            onPausar={noop}
            onDebug={noop}
            onRemove={noop}
            onDownload={noop}
            isRunning={false}
            isQueued={false}
            docUrl="https://docs.google.com"
            channels={[{ label: 'YOUTUBE', color: '#c00000' }]}
            selos={[{ tipo: 'decupagem', title: 'Silêncios removidos' }, { tipo: 'normalizador', title: 'Volume nivelado' }, { tipo: 'legenda', title: 'Legenda' }, { tipo: 'zoom', title: 'Zoom' }, { tipo: 'stockframe', title: 'StockFrame' }, { tipo: 'velocidade', title: 'Velocidade' }, { tipo: 'sonoplastia', title: 'Sonoplastia' }, { tipo: 'headline', title: 'Headline' }]}
            defaultMinimized={false}
          >
            <div className="mb-2.5 flex items-center justify-between px-0.5">
              <span className="pl-label"><b className="font-semibold" style={{ color: 'rgb(var(--text))' }}>Takes</b> · 4 de 5 prontos</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {TAKES.map((t, i) => (
                <LipsyncPreviewCard key={i} take={t} position={i + 1} total={TAKES.length} percent={80} onEdit={noop} />
              ))}
            </div>
          </BatchJobCard3D>
          <BatchJobCard3D
            taskId="t2"
            taskName="AD61VN - PRPB09"
            phase="rendering"
            partsTotal={10}
            partsDispatched={10}
            partsRendered={4}
            message="renderizando"
            elapsedMs={128_000}
            startedAt={start}
            elapsedLive
            allOk={false}
            isPartialDone={false}
            onRetomar={noop}
            onPausar={noop}
            onDebug={noop}
            isRunning
            isQueued={false}
            channels={[{ label: 'META', color: '#2a9fd6' }]}
          />
          <BatchJobCard3D
            taskId="t3"
            taskName="AD03GL - ME - RIPCPWA"
            phase="waiting-heygen"
            partsTotal={8}
            partsDispatched={8}
            partsRendered={6}
            message="limite diário do HeyGen atingido"
            elapsedMs={1_840_000}
            allOk={false}
            isPartialDone={false}
            onRetomar={noop}
            onDebug={noop}
            onRemove={noop}
            isRunning={false}
            isQueued={false}
          />
          <BatchJobCard3D
            taskId="t4"
            taskName="AD48VN - FLPB02"
            phase="failed"
            partsTotal={6}
            partsDispatched={3}
            partsRendered={2}
            message="falhou"
            elapsedMs={66_000}
            allOk={false}
            isPartialDone={false}
            onRetomar={noop}
            onRemove={noop}
            isRunning={false}
            isQueued={false}
          />
        </ul>
      </div>

      <div className="mt-8">
        <div className="pl-sechead mb-4 px-1">
          <h2 className="pl-h2">Análise</h2>
          <span className="pl-sub">o que vai ser disparado</span>
        </div>
        <ul className="grid gap-5">
          <li className="pl-ana-card" data-st="ready" data-pl-spot>
            <PlSpot />
            <div className="pl-ana-head">
              <span className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="pl-ana-sym" aria-hidden>✓</span>
                <span className="pl-h3 truncate">AD51VN - PRPB09</span>
              </span>
              <button type="button" className="pl-btn pl-btn--ghost pl-btn--sm pl-btn--danger">Remover</button>
            </div>
            <div className="mt-2">
              <MotorConfigPicker config={motor} setConfig={setMotor} takeCount={10} />
            </div>
            <div className="mt-2">
              <PilotFormatoToggle formato={formato} onChange={setFormato} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span />
              <div className="pl-toolbar shrink-0">
                <PilotBtn3D icon={<IconScissors size={16} />} color={decup ? 'lime' : 'neutral'} active={decup} title="Remover Silêncios" onClick={() => setDecup((v) => !v)} />
                <PilotBtn3D icon={<IconNivelar size={16} />} color={nivel ? 'cyan' : 'neutral'} active={nivel} title="Nivelar" onClick={() => setNivel((v) => !v)} />
                <PilotBtn3D icon={<IconCamuflagem size={16} />} color={camu ? 'fuchsia' : 'neutral'} active={camu} title="Camuflagem" onClick={() => setCamu((v) => !v)} />
                <PilotBtn3D icon={<IconLegenda size={16} />} color="neutral" title="Legenda" />
                <PilotBtn3D icon={<IconZoomDinamica size={16} />} color="neutral" title="Zoom" />
                <PilotBtn3D icon={<IconInserts size={16} />} color="cyan" active title="Inserts" />
                <PilotBtn3D icon={<IconHeadline size={16} />} color="rose" active title="Headline" />
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="pl-h3">Avatares</span>
                  <span className="pl-count" style={{ height: 20, minWidth: 22 }}>1</span>
                  <span className="pl-sub" style={{ fontSize: 15 }}>selecione cada um e a voz</span>
                </div>
                <button type="button" className="pl-btn pl-btn--ghost pl-btn--sm">Versões <span className="pl-btn__n" style={{ height: 18, minWidth: 20, fontSize: 10.5 }}>1</span></button>
              </div>
              <div className="pl-slot">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="pl-role">Avatar</span>
                  <span className="pl-label" style={{ color: 'rgb(var(--text) / 0.72)' }}>@doutorjapa</span>
                  <span className="info-chip">10 partes</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">Avatar HeyGen</div>
                    <CompactAvatarPicker selected={null} setSelected={noop} fallback={null} />
                  </div>
                  <div>
                    <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">Voz</div>
                    <CompactVoiceSelector selected={{ id: 'v1', name: 'DR MARCO MAKOTO' }} setSelected={noop} />
                  </div>
                </div>
              </div>
              <button type="button" className="pl-add">
                <span className="pl-add__ico" aria-hidden>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
                Adicionar outro avatar
              </button>
            </div>
          </li>
        </ul>
        <div className="pl-footbar">
          <span className="flex flex-wrap items-center gap-2">
            <span className="pl-pill-lime">1 pronta pra disparar</span>
          </span>
          <button type="button" className="pl-btn pl-btn--violet pl-btn--icon-end" style={{ height: 46 }}>
            Iniciar 1 task em background
            <span className="pl-btn__ico" style={{ width: 34, height: 34 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13l10.5-6.5z" /></svg>
            </span>
          </button>
        </div>
      </div>
    </PilotShell>
  );
}
