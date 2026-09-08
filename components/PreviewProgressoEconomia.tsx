'use client';

/**
 * PREVIEW DEV-ONLY da BARRA DE PROGRESSO do modo economia.
 *
 * Existe pra ENXERGAR a barra andando sem precisar de HeyGen, de task no
 * ClickUp nem de crédito — e pra deixar visível, lado a lado, o defeito que
 * foi corrigido: antes, a barra ficava CRAVADA no mínimo o disparo inteiro
 * (porque nenhuma parte ganha `videoId` no meio do modo economia) e só pulava
 * pra 100% no fim.
 *
 * A linha do tempo NÃO é inventada aqui: vem de `linhaDoTempoEconomia`, a
 * mesma matemática que a extensão usa em produção (e que o teste
 * `pilot-progresso.test.ts` compara com o código da extensão pra elas não
 * divergirem). Ou seja, o que se vê aqui é o que o usuário vê lá.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BatchJobCard3D } from './BatchJobCard3D';
import { linhaDoTempoEconomia } from '@/lib/pilot-progresso';

const DURACOES = [30, 42, 28]; // segundos de render por cena, medidos ao vivo

export function PreviewProgressoEconomia() {
  const linha = useMemo(() => linhaDoTempoEconomia(DURACOES), []);
  const duracaoTotal = linha.length ? linha[linha.length - 1].t : 1;

  const [i, setI] = useState(0);
  const [rodando, setRodando] = useState(true);
  const [velocidade, setVelocidade] = useState(8);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rodando) return;
    if (i >= linha.length - 1) { setRodando(false); return; }
    const dt = Math.max(60, ((linha[i + 1].t - linha[i].t) * 1000) / velocidade);
    timer.current = setTimeout(() => setI((n) => n + 1), dt);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [i, rodando, velocidade, linha]);

  const ev = linha[Math.min(i, linha.length - 1)];
  const terminou = i >= linha.length - 1;

  function reiniciar() {
    setI(0);
    setRodando(true);
  }

  const comum = {
    taskId: 'demo',
    taskName: 'AD07MEPB · MEMORIA — 3 takes',
    channels: [] as { label: string; color: string }[],
    partsTotal: DURACOES.length,
    // ⚠ ZERO de propósito: é o estado REAL do modo economia enquanto roda.
    //   Nenhuma parte ganha videoId até o job inteiro voltar.
    partsDispatched: 0,
    partsRendered: 0,
    elapsedMs: ev.t * 1000,
    allOk: false,
    isPartialDone: false,
    downloadBlocked: false,
    isRunning: true,
    isQueued: false,
    onRetomar: () => {},
    onPausar: () => {},
    onDebug: () => {},
    onRemove: () => {},
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={reiniciar}
          className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25"
        >
          ▶ rodar de novo
        </button>
        <button
          type="button"
          onClick={() => setRodando((r) => !r)}
          disabled={terminou}
          className="mono rounded border border-white/20 px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-white/40 disabled:opacity-30"
        >
          {rodando ? '⏸ pausar' : '▶ seguir'}
        </button>
        {[1, 4, 8, 20].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVelocidade(v)}
            className={`mono rounded border px-2 py-1 text-[10px] uppercase tracking-widest ${
              velocidade === v
                ? 'border-lime/60 bg-lime/15 text-lime'
                : 'border-white/15 text-text-muted hover:border-white/35'
            }`}
          >
            {v}×
          </button>
        ))}
        <span className="mono text-[10px] text-text-muted">
          t={ev.t}s de {duracaoTotal}s · barra={Math.round(ev.pct)}%
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <div className="label-tech text-[9.5px] tracking-[0.18em] text-red-300">
ANTES · barra travada em 3%
          </div>
          <BatchJobCard3D
            {...comum}
            phase="rendering"
            message={ev.msg}
            /* sem progressoMotor: é exatamente o que acontecia */
          />
        </div>
        <div className="grid gap-1.5">
          <div className="label-tech text-[9.5px] tracking-[0.18em] text-lime">
AGORA · anda a cada volta
          </div>
          <BatchJobCard3D
            {...comum}
            phase="rendering"
            message={ev.msg}
            progressoMotor={ev.pct}
          />
        </div>
      </div>

      <div className="mono rounded-[10px] border border-white/10 bg-black/30 p-2 text-[10px] leading-relaxed text-text-muted">
        Linha do tempo real: {linha.length} avisos em {duracaoTotal}s.
        {' '}Maior intervalo com a barra parada:{' '}
        <b className="text-lime">
          {(() => {
            let m = 0;
            for (let k = 1; k < linha.length; k++) {
              if (linha[k].pct === linha[k - 1].pct) m = Math.max(m, linha[k].t - linha[k - 1].t);
            }
            return `${m}s`;
          })()}
        </b>
        {' '}· nunca anda pra trás ·{' '}
        {DURACOES.length} cena(s) de {DURACOES.join('s, ')}s de render.
      </div>
    </div>
  );
}
