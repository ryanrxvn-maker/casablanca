'use client';

import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { PilotHowItWorks } from '@/components/Landing';
import { SmokeText } from '@/components/SmokeText';
import { IconClickUpPilot } from '@/components/ToolIcons';

/**
 * /pilot — página dedicada explicando o ClickUp Pilot.
 *
 * Reutiliza o `PilotHowItWorks` da landing (mesmo conteúdo, mesmo design),
 * mas standalone com hero próprio. Acessível por qualquer tier.
 */
export default function PilotPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(45% 35% at 18% 12%, rgba(167,139,250,0.18), transparent 65%),' +
            'radial-gradient(50% 35% at 84% 90%, rgba(200,255,0,0.12), transparent 65%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Brand href="/" />
          <div className="flex items-center gap-2">
            <Link href="/tools" className="btn-ghost">
              ← Voltar ao estúdio
            </Link>
          </div>
        </div>
      </header>

      {/* Hero do Pilot */}
      <section className="relative z-10 mx-auto max-w-[1200px] px-5 pb-4 pt-16 md:px-8 md:pt-24">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-lime/45 bg-lime/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime backdrop-blur-md"
              style={{
                fontFamily: 'var(--font-tech)',
                boxShadow:
                  '0 0 22px -6px rgba(200,255,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-lime"
                style={{ boxShadow: '0 0 10px rgba(200,255,0,0.95)' }}
              />
              ClickUp Pilot
            </div>
            <h1
              className="text-[40px] font-extrabold leading-[1] tracking-tight text-white md:text-[68px]"
              style={{
                fontFamily: 'var(--font-tech)',
                letterSpacing: '-0.03em',
              }}
            >
              <SmokeText text="Você sai do escritório." className="block" />
              <span
                className="block"
                style={{
                  background:
                    'linear-gradient(135deg, #c8ff00 0%, #a78bfa 60%, #67e8f9 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                <SmokeText text="Ele continua editando." />
              </span>
            </h1>
            <p className="mt-6 max-w-[560px] text-[16px] leading-relaxed text-white/80">
              O Pilot lê os briefings no seu ClickUp, identifica avatar e
              roteiro de cada task, e dispara o lipsync sozinho no HeyGen —
              parte por parte.
              <br />
              <span className="text-white/65">
                Você dorme. Acorda. Tudo já tá pronto pra revisar.
              </span>
            </p>
          </div>

          {/* Ícone decorativo */}
          <div className="hidden justify-center lg:flex">
            <div
              style={{
                filter:
                  'drop-shadow(0 0 36px rgba(200,255,0,0.42)) drop-shadow(0 0 18px rgba(167,139,250,0.38))',
                animation: 'pilot-hero-float 5s ease-in-out infinite',
              }}
            >
              <IconClickUpPilot size={300} strokeWidth={1.1} />
            </div>
            <style jsx>{`
              @keyframes pilot-hero-float {
                0%, 100% { transform: translateY(0) rotate(0); }
                50% { transform: translateY(-12px) rotate(-3deg); }
              }
            `}</style>
          </div>
        </div>
      </section>

      {/* Conteúdo principal — passos / briefing / pra quem */}
      <div className="relative z-10">
        <PilotHowItWorks />
      </div>

      {/* Footer */}
      <footer className="relative z-10 mx-auto mt-16 max-w-[1280px] px-5 pb-12 md:px-8">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-line/60 pt-8 md:flex-row md:items-center">
          <Brand href="/" />
          <p className="text-[12.5px] text-text-muted">
            Auto Edit · © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </main>
  );
}
