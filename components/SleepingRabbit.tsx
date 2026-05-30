/**
 * SleepingRabbit — coelho com Zzz subindo.
 *
 * Visual: card preto com o logo do coelho gigante respirando (scale)
 * + 3 letras "Z" gigantes subindo em loop com fade.
 * Glow violet ambient pulsando.
 */
export function SleepingRabbit() {
  return (
    <div
      className="relative overflow-hidden rounded-[22px] border border-line/70"
      style={{
        height: 280,
        background:
          'radial-gradient(60% 80% at 50% 50%, rgba(167,139,250,0.20), transparent 70%), linear-gradient(180deg, rgb(var(--bg-softer)), #0a0a0c)',
      }}
    >
      {/* Halo respirando */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(40% 50% at 50% 60%, rgba(167,139,250,0.32), transparent 65%)',
          animation: 'sleep-halo 4s ease-in-out infinite',
        }}
      />

      {/* Coelho central */}
      <div
        className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2"
        style={{
          animation: 'sleep-breathe 5s ease-in-out infinite',
          filter:
            'drop-shadow(0 0 28px rgba(167,139,250,0.65)) drop-shadow(0 0 14px rgba(217,70,239,0.4))',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auto-edit-logo@256.png"
          alt=""
          aria-hidden
          width={140}
          height={140}
        />
      </div>

      {/* Z's subindo */}
      <Z className="sleep-z sleep-z-1" />
      <Z className="sleep-z sleep-z-2" />
      <Z className="sleep-z sleep-z-3" />

      {/* Label rodapé */}
      <div
        className="absolute bottom-3 left-3 right-3 text-center"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <div className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-violet">
          MODO DESCANSO
        </div>
      </div>

      <style jsx>{`
        @keyframes sleep-halo {
          0%, 100% { opacity: 0.65; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes sleep-breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1) rotate(-3deg); }
          50% { transform: translate(-50%, calc(-50% - 4px)) scale(1.04) rotate(-3deg); }
        }
      `}</style>
    </div>
  );
}

function Z({ className }: { className: string }) {
  return (
    <>
      <span
        className={className}
        aria-hidden
        style={{
          position: 'absolute',
          fontFamily: 'var(--font-tech)',
          fontWeight: 800,
          color: 'rgba(192,132,252,0.85)',
          textShadow:
            '0 0 12px rgba(192,132,252,0.9), 0 0 24px rgba(167,139,250,0.5)',
          letterSpacing: '-0.02em',
          pointerEvents: 'none',
        }}
      >
        Z
      </span>
      <style jsx>{`
        .sleep-z {
          animation-name: sleep-z-rise;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
          animation-iteration-count: infinite;
        }
        .sleep-z-1 {
          left: 58%;
          top: 38%;
          font-size: 28px;
          animation-duration: 3.6s;
          animation-delay: 0s;
        }
        .sleep-z-2 {
          left: 64%;
          top: 30%;
          font-size: 36px;
          animation-duration: 3.6s;
          animation-delay: 1.2s;
        }
        .sleep-z-3 {
          left: 70%;
          top: 22%;
          font-size: 48px;
          animation-duration: 3.6s;
          animation-delay: 2.4s;
        }
        @keyframes sleep-z-rise {
          0% {
            opacity: 0;
            transform: translateY(0) translateX(0) rotate(-10deg) scale(0.6);
          }
          15% {
            opacity: 1;
          }
          70% {
            opacity: 0.6;
          }
          100% {
            opacity: 0;
            transform: translateY(-110px) translateX(28px) rotate(18deg) scale(1.5);
          }
        }
      `}</style>
    </>
  );
}
