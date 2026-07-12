'use client';

/**
 * FlagshipSections — prova numérica + os dois carros-chefe (ClickUp Pilot e
 * Auto B-roll) em painéis cinematográficos com pipeline animado.
 *
 * Copy 100% honesta: os dois são plano PRO (lançamento em breve) e carregam
 * o selo. Nenhuma promessa fora do que o produto faz.
 */

import Link from 'next/link';
import { SmokeText } from '../SmokeText';
import { Tilt3D } from '../Tilt3D';
import { CountUp, Magnetic, Reveal } from './LandingKit';

/* ────────────────────── selo PRO · EM BREVE ────────────────────── */

export function ProSoonChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full border border-violet/50 bg-violet/12 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-violet backdrop-blur-md ' +
        className
      }
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
      </span>
      Pro · em breve
    </span>
  );
}

/* ────────────────────── Faixa de prova (stats) ────────────────────── */

export function ProofStrip() {
  const stats = [
    { n: 1, suffix: '', label: 'clique', sub: 'dispara a fila do dia inteiro' },
    { n: 3, suffix: '', label: 'ZIPs', sub: 'por disparo: takes, montado e camuflado' },
    { n: 24, suffix: '/7', label: 'fila viva', sub: 'segue rodando enquanto você descansa' },
    { n: 0, suffix: '', label: 'crédito extra', sub: 'b-roll roda na sua conta Magnific' },
  ];
  return (
    <section className="mx-auto mt-20 max-w-[1240px] px-5 md:mt-24 md:px-8">
      <Reveal>
        <div className="glass-panel grid grid-cols-2 gap-y-8 rounded-[24px] px-6 py-8 md:grid-cols-4 md:px-10">
          {stats.map((s, i) => (
            <div key={i} className="relative text-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute -left-3 top-1/2 hidden h-10 w-px -translate-y-1/2 md:block"
                  style={{
                    background:
                      'linear-gradient(180deg, transparent, rgba(255,255,255,0.14), transparent)',
                  }}
                />
              )}
              <div
                className="text-[38px] font-extrabold leading-none tracking-tight md:text-[46px]"
                style={{
                  fontFamily: 'var(--font-tech)',
                  letterSpacing: '-0.03em',
                  background: 'linear-gradient(135deg, #fff 10%, #a78bfa 110%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                <CountUp to={s.n} suffix={s.suffix} duration={1200} />
              </div>
              <div
                className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-white/75"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.label}
              </div>
              <p className="mx-auto mt-1.5 max-w-[180px] text-[11.5px] leading-snug text-text-muted">
                {s.sub}
              </p>
            </div>
          ))}
        </div>
        {/* Honestidade: os números acima vêm da suíte de automação (Pilot /
            Auto B-roll), que é Pro — e o Pro ainda está travado. Dizer isso
            aqui evita vender como "de hoje" o que o cliente só usa no Pro. */}
        <p
          className="mt-3 text-center text-[10.5px] font-semibold uppercase tracking-[0.2em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Números da suíte de automação · plano Pro, em breve
        </p>
      </Reveal>
    </section>
  );
}

/* ────────────────────── cabeçalho numerado de seção ────────────────────── */

export function SectionKicker({
  index,
  label,
  accent = 'rgb(var(--violet))',
  right,
  invert = false,
}: {
  index: string;
  label: string;
  accent?: string;
  right?: React.ReactNode;
  invert?: boolean;
}) {
  return (
    <div
      className={
        'flex items-baseline gap-3 text-white/35 ' + (invert ? 'flex-row-reverse' : '')
      }
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      <span className="num text-[10.5px] tracking-[0.32em]">{index}</span>
      <span className="h-px w-10 self-center bg-white/25" />
      <span
        className="text-[10.5px] uppercase tracking-[0.28em]"
        style={{ fontFamily: 'var(--font-tech)', color: accent }}
      >
        {label}
      </span>
      {right}
    </div>
  );
}

/* ────────────────────── ClickUp Pilot ────────────────────── */

export function PilotFlagship() {
  return (
    <section id="pilot" className="mx-auto mt-24 max-w-[1240px] px-5 md:mt-32 md:px-8">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[32px] border border-line/70"
          style={{
            background:
              'linear-gradient(120deg, rgba(200,214,132,0.14) 0%, rgba(167,139,250,0.20) 50%, rgba(126,213,226,0.12) 100%), linear-gradient(180deg, rgb(var(--bg-softer)), #08080a)',
          }}
        >
          {/* fundo cinematográfico */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/pilot-bg.jpg"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
            style={{
              maskImage:
                'linear-gradient(100deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 55%, #000 100%)',
              WebkitMaskImage:
                'linear-gradient(100deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 55%, #000 100%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(8,8,10,0.94) 0%, rgba(8,8,10,0.6) 48%, rgba(8,8,10,0.22) 100%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '46px 46px',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 fs-pulse-a"
            style={{
              background:
                'radial-gradient(55% 90% at 0% 50%, rgba(200,214,132,0.26), transparent 58%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 fs-pulse-b"
            style={{
              background:
                'radial-gradient(55% 90% at 100% 50%, rgba(167,139,250,0.36), transparent 58%)',
            }}
          />

          {/* mockup 3D à direita */}
          <div className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 lg:block xl:right-12">
            <Tilt3D max={6} scale={false} className="pointer-events-auto">
              <PilotWindow />
            </Tilt3D>
          </div>

          {/* conteúdo */}
          <div className="relative flex max-w-[640px] flex-col items-start gap-7 px-7 py-14 md:px-14 md:py-20">
            <div className="flex flex-wrap items-center gap-3">
              <SectionKicker index="001" label="O centro da operação" accent="#c8d684" />
              <ProSoonChip />
            </div>

            <h2
              className="text-[38px] font-extrabold leading-[0.98] tracking-tight text-white md:text-[62px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
            >
              <SmokeText text="Você sai do escritório." className="block" />
              {/* texto puro: SmokeText dentro de background-clip:text some */}
              <span
                className="block"
                style={{
                  background: 'linear-gradient(135deg, #c8d684 0%, #a78bfa 60%, #7ed5e2 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Ele continua editando.
              </span>
            </h2>

            <p className="max-w-[560px] text-[15.5px] leading-relaxed text-white/85">
              O Pilot lê os briefings no seu ClickUp, identifica o avatar e o
              roteiro de cada task e dispara os lipsyncs no HeyGen — parte por
              parte, em fila.{' '}
              <span className="text-white/60">
                Quando você volta, está tudo pronto pra revisar.
              </span>
            </p>

            {/* pipeline animado */}
            <PipelineRail />

            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Magnetic strength={7}>
                <Link
                  href="/register"
                  className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-[14px] font-bold text-black"
                  style={{
                    background: 'linear-gradient(135deg, #cdd88f 0%, #aebd72 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.5), 0 14px 36px -8px rgba(200,214,132,0.55)',
                  }}
                >
                  <span className="relative z-10">Começar grátis</span>
                  <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                    →
                  </span>
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
                  />
                </Link>
              </Magnetic>
              <a
                href="#precos"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/35 hover:bg-white/10"
              >
                Ver planos
              </a>
            </div>
          </div>
        </div>
      </Reveal>

      <style jsx>{`
        .fs-pulse-a { animation: fs-pulse 6s ease-in-out infinite; }
        .fs-pulse-b { animation: fs-pulse 7s ease-in-out infinite reverse; }
        @keyframes fs-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.95; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fs-pulse-a, .fs-pulse-b { animation: none; }
        }
      `}</style>
    </section>
  );
}

/** Trilho BRIEFING → LIPSYNC → MONTAGEM → ENTREGA com pulso viajando. */
function PipelineRail() {
  const steps = [
    { label: 'Briefing', sub: 'ClickUp', icon: <DocIcon /> },
    { label: 'Lipsync', sub: 'sua conta HeyGen', icon: <FaceIcon /> },
    { label: 'Montagem', sub: 'parte por parte', icon: <FilmIcon /> },
    { label: 'Entrega', sub: '3 ZIPs prontos', icon: <BoxIcon /> },
  ];
  return (
    <div className="w-full max-w-[560px] rounded-[18px] border border-white/10 bg-black/45 px-5 py-5 backdrop-blur-xl">
      <div className="relative">
        {/* trilho */}
        <div className="absolute left-[7%] right-[7%] top-[19px] h-px overflow-hidden bg-white/12">
          <span className="pr-pulse" aria-hidden />
        </div>
        <div className="relative grid grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.label} className="flex flex-col items-center text-center">
              <span
                className="pr-node relative z-10 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-[#0c0c10] text-white/85"
                style={{ animationDelay: `${i * 1.4}s` }}
              >
                {s.icon}
              </span>
              <span
                className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/85"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.label}
              </span>
              <span className="mt-0.5 text-[9.5px] leading-tight text-white/45">{s.sub}</span>
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        .pr-pulse {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: 74px;
          background: linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.95), rgba(200, 214, 132, 0.8), transparent);
          box-shadow: 0 0 14px rgba(167, 139, 250, 0.8);
          animation: pr-travel 5.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        @keyframes pr-travel {
          0% { transform: translateX(-90px); }
          100% { transform: translateX(560px); }
        }
        .pr-node {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px -8px rgba(0, 0, 0, 0.8);
          animation: pr-node-glow 5.6s ease-in-out infinite;
        }
        @keyframes pr-node-glow {
          0%, 18%, 100% {
            border-color: rgba(255, 255, 255, 0.15);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px -8px rgba(0, 0, 0, 0.8);
          }
          8% {
            border-color: rgba(167, 139, 250, 0.85);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 26px -6px rgba(167, 139, 250, 0.85);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pr-pulse, .pr-node { animation: none; }
        }
      `}</style>
    </div>
  );
}

/** Janela-mockup do Pilot (lado direito do flagship). */
function PilotWindow() {
  const rows = [
    { name: 'Lipsync · ADS04', state: 'done' as const },
    { name: 'Lipsync · ADS05', state: 'done' as const },
    { name: 'Lipsync · ADS06', state: 'running' as const },
    { name: 'Lipsync · ADS07', state: 'queued' as const },
    { name: 'Lipsync · ADS08', state: 'queued' as const },
  ];
  return (
    <div
      className="w-[330px] xl:w-[380px]"
      style={{
        filter:
          'drop-shadow(0 34px 64px rgba(0,0,0,0.6)) drop-shadow(0 0 44px rgba(167,139,250,0.35))',
      }}
    >
      <div className="overflow-hidden rounded-[18px] border border-white/12 bg-black/60 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 border-b border-white/8 px-3.5 py-2.5">
          <span className="h-2 w-2 rounded-full bg-red-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          <span
            className="ml-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-lime"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Pilot · em execução
          </span>
        </div>
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-white/55"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Fila do dia
            </span>
            <span className="num text-[11px] text-lime" style={{ fontFamily: 'var(--font-mono)' }}>
              12 / 18
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: '66%',
                background: 'linear-gradient(90deg, #c8d684, #a78bfa, #7ed5e2)',
                boxShadow: '0 0 12px rgba(200,214,132,0.6)',
              }}
            />
          </div>
        </div>
        <div className="space-y-2 px-4 py-4">
          {rows.map((t, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      t.state === 'done' ? '#c8d684' : t.state === 'running' ? '#a78bfa' : '#3a3a44',
                    boxShadow:
                      t.state !== 'queued'
                        ? `0 0 8px ${t.state === 'done' ? '#c8d684' : '#a78bfa'}`
                        : 'none',
                  }}
                />
                <span className="text-[11.5px] font-medium text-white/90">{t.name}</span>
              </div>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.14em]"
                style={{
                  fontFamily: 'var(--font-tech)',
                  color:
                    t.state === 'done' ? '#c8d684' : t.state === 'running' ? '#c084fc' : '#5a5a64',
                }}
              >
                {t.state === 'done' ? 'pronto' : t.state === 'running' ? 'rodando' : 'fila'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="mt-3 inline-flex items-center gap-2 rounded-[12px] border border-white/12 bg-black/65 px-3 py-2 backdrop-blur-xl"
        style={{ boxShadow: '0 16px 32px -10px rgba(0,0,0,0.6)' }}
      >
        <span
          className="text-[9px] font-bold uppercase tracking-[0.2em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Último disparo
        </span>
        <span className="num text-[11px] text-white/85" style={{ fontFamily: 'var(--font-mono)' }}>
          AD15VN_PRPB06.mp4
        </span>
      </div>
    </div>
  );
}

/* ────────────────────── Auto B-roll ────────────────────── */

export function BrollFlagship() {
  return (
    <section id="broll" className="mx-auto mt-6 max-w-[1240px] px-5 md:mt-8 md:px-8">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[32px] border border-violet/35"
          style={{
            background:
              'linear-gradient(120deg, rgba(167,139,250,0.20) 0%, rgba(224,132,176,0.14) 50%, rgba(200,214,132,0.08) 100%), linear-gradient(180deg, rgb(var(--bg-softer)), #08080a)',
          }}
        >
          {/* fundo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/auto-broll-bg.jpg"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
            style={{
              maskImage:
                'linear-gradient(260deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 55%, #000 100%)',
              WebkitMaskImage:
                'linear-gradient(260deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 55%, #000 100%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(270deg, rgba(8,8,10,0.94) 0%, rgba(8,8,10,0.6) 48%, rgba(8,8,10,0.22) 100%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '46px 46px',
            }}
          />

          {/* trio de takes 3D à esquerda */}
          <div className="pointer-events-none absolute left-6 top-1/2 hidden -translate-y-1/2 lg:block xl:left-12">
            <BrollTrio />
          </div>

          {/* conteúdo à direita */}
          <div className="relative ml-auto flex max-w-[640px] flex-col items-end gap-7 px-7 py-14 text-right md:px-14 md:py-20">
            <div className="flex flex-wrap items-center gap-3">
              <ProSoonChip />
              <SectionKicker index="002" label="Vídeos em escala" invert />
            </div>

            <h2
              className="text-[38px] font-extrabold leading-[0.98] tracking-tight text-white md:text-[62px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
            >
              <SmokeText text="Sua lista de prompts." className="block" />
              {/* texto puro: SmokeText dentro de background-clip:text some */}
              <span
                className="block"
                style={{
                  background: 'linear-gradient(135deg, #a78bfa 0%, #e084b0 50%, #c8d684 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {/* hífen não-quebrável (U+2011): "b-rolls" nunca parte no meio */}
                Dezenas de b‑rolls prontos.
              </span>
            </h2>

            <p className="max-w-[540px] text-[15.5px] leading-relaxed text-white/85">
              Cole a lista, ligue a fila e vá fazer outra coisa. Cada take
              renderiza em Kling 720p sobre frame Nano Banana 1K, na sua conta
              Magnific — sem crédito extra por vídeo.{' '}
              <span className="text-white/60">
                No final, um ZIP nomeado, pronto pra timeline.
              </span>
            </p>

            {/* requisito honesto */}
            <div
              className="flex max-w-[540px] items-start gap-3 rounded-[14px] border border-amber-400/35 bg-amber-400/[0.06] px-4 py-3 text-left backdrop-blur-md"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ebc860"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0"
                aria-hidden
              >
                <path d="M12 2L9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7z" />
              </svg>
              <p className="text-[12.5px] leading-relaxed text-white/80">
                <strong className="text-amber-200">Pré-requisito:</strong>{' '}
                assinatura Freepik Premium+ ativa — o Auto B-roll roda no{' '}
                <strong className="text-white">seu</strong> acesso ao Magnific.
                É a única dependência externa da ferramenta.
              </p>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Magnetic strength={7}>
                <Link
                  href="/register"
                  className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-[14px] font-bold text-white"
                  style={{
                    background: 'linear-gradient(135deg, #a78bfa 0%, #6d4ee8 60%, #4f3ddb 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.4), 0 14px 36px -10px rgba(167,139,250,0.6)',
                  }}
                >
                  <span className="relative z-10">Começar grátis</span>
                  <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                    →
                  </span>
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
                  />
                </Link>
              </Magnetic>
              <a
                href="#suite"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/35 hover:bg-white/10"
              >
                Ver a suíte toda
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** Trio de takes 9:16 — o do centro toca o mp4 REAL do produto. */
function BrollTrio() {
  return (
    <div className="flex items-center gap-4" style={{ perspective: '1100px' }}>
      <FakeTake tone="#a78bfa" tone2="#e084b0" label="TAKE 03" state="renderizando" tilt="rotateY(14deg)" />
      <div
        className="bt-center relative w-[176px] overflow-hidden rounded-[16px] border border-lime/45 xl:w-[196px]"
        style={{
          aspectRatio: '9/16',
          boxShadow:
            '0 34px 64px -22px rgba(0,0,0,0.9), 0 0 52px -14px rgba(200,214,132,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
        }}
      >
        <video
          src="/cards/auto-broll.mp4"
          poster="/cards/auto-broll.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 28%, transparent 60%, rgba(0,0,0,0.55) 100%)',
          }}
        />
        <div
          className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="text-[8px] font-bold uppercase tracking-widest text-violet">Take</span>
          <span className="num text-[8px] font-extrabold text-white">04</span>
        </div>
        <div
          className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 backdrop-blur-sm"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="h-1 w-1 rounded-full bg-lime shadow-[0_0_6px_rgba(200,214,132,0.9)]" />
          <span className="text-[7.5px] font-bold uppercase tracking-widest text-lime">pronto</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2.5 pb-2">
          <span
            className="text-[7.5px] font-bold uppercase tracking-widest text-white/80"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Kling 720p
          </span>
          <span className="num text-[7.5px] font-bold text-lime" style={{ fontFamily: 'var(--font-mono)' }}>
            10s · 9:16
          </span>
        </div>
      </div>
      <FakeTake tone="#7ed5e2" tone2="#a78bfa" label="TAKE 05" state="na fila" tilt="rotateY(-14deg)" />
      <style jsx>{`
        .bt-center {
          animation: bt-hover 6.5s ease-in-out infinite;
        }
        @keyframes bt-hover {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bt-center { animation: none; }
        }
      `}</style>
    </div>
  );
}

function FakeTake({
  tone,
  tone2,
  label,
  state,
  tilt,
}: {
  tone: string;
  tone2: string;
  label: string;
  state: string;
  tilt: string;
}) {
  return (
    <div
      className="ft-card relative hidden w-[128px] overflow-hidden rounded-[14px] border xl:block"
      style={{
        aspectRatio: '9/16',
        transform: tilt,
        borderColor: `${tone}55`,
        background: `linear-gradient(150deg, ${tone}22 0%, ${tone2}20 55%, #0a0a0c 100%)`,
        boxShadow: `0 22px 44px -18px rgba(0,0,0,0.85), 0 0 34px -16px ${tone}66`,
      }}
    >
      <div
        aria-hidden
        className="ft-scan absolute inset-0"
        style={{
          background: `linear-gradient(180deg, transparent 0%, ${tone}45 50%, transparent 100%)`,
          filter: 'blur(2px)',
        }}
      />
      <div
        className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest text-white/85 backdrop-blur-sm"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {label}
      </div>
      <div
        className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 backdrop-blur-sm"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span
          className="ft-dot h-1 w-1 rounded-full"
          style={{ background: tone, boxShadow: `0 0 6px ${tone}` }}
        />
        <span className="text-[6.5px] font-bold uppercase tracking-widest" style={{ color: tone }}>
          {state}
        </span>
      </div>
      <style jsx>{`
        .ft-scan {
          transform: translateY(-100%);
          animation: ft-scan-run 2.6s ease-in-out infinite;
        }
        @keyframes ft-scan-run {
          0% { transform: translateY(-100%); opacity: 0; }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { transform: translateY(200%); opacity: 0; }
        }
        .ft-dot { animation: ft-blink 1.4s ease-in-out infinite; }
        @keyframes ft-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ft-scan, .ft-dot { animation: none; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────── mini-ícones do pipeline ────────────────────── */

function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
function FaceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1" />
      <path d="M17 8c1.4 1 1.4 4.4 0 5.4" opacity="0.7" />
      <path d="M19.6 6.4c2.3 1.7 2.3 6.9 0 8.6" opacity="0.45" />
    </svg>
  );
}
function FilmIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4" opacity="0.7" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}
