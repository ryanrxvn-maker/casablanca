'use client';

/**
 * ElevenToggle3D — liga o MODO ELEVEN do ClickUp Pilot.
 *
 * O que muda ao ligar: em vez de escolher avatar no HeyGen e gerar vídeo, o
 * painel passa a escolher VOZ no ElevenLabs e gerar o áudio do anúncio. É uma
 * troca de modo inteira, não um checkbox de detalhe — por isso o controle
 * grita: as barras do equalizador ficam PARADAS quando desligado e começam a
 * dançar no instante em que liga. Bater o olho já diz em que modo você está.
 *
 * Só aparece no DR MILLION ([[teamSupportsEleven]]).
 */

const BARRAS = [
  { h: 7, delay: 0 },
  { h: 13, delay: 120 },
  { h: 18, delay: 240 },
  { h: 11, delay: 360 },
  { h: 6, delay: 480 },
];

export function ElevenToggle3D({
  on,
  onChange,
  disabled = false,
  /** Texto do tooltip quando há algo a avisar (ex: extensão desconectada). */
  hint,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-label="Modo ElevenLabs — gerar voz em vez de vídeo"
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={
        hint ||
        (on
          ? 'Modo ElevenLabs LIGADO — você escolhe a voz e o disparo gera o áudio. Clique pra voltar ao HeyGen (vídeo).'
          : 'Ligar o modo ElevenLabs — escolher voz e gerar o áudio do anúncio em vez do vídeo')
      }
      className={
        'el3d group relative inline-flex select-none items-center gap-2.5 rounded-[13px] border px-3.5 py-2 transition-all duration-300 ' +
        (on ? 'el3d-on border-white/70' : 'border-line/70') +
        (disabled ? ' cursor-not-allowed opacity-45' : ' cursor-pointer')
      }
      style={{
        fontFamily: 'var(--font-tech)',
        background: on
          ? 'linear-gradient(135deg, #ffffff 0%, #d8dde6 100%)'
          : 'linear-gradient(180deg, rgb(var(--bg) / 0.85), rgb(var(--bg-soft) / 0.65))',
        boxShadow: on
          ? '0 0 26px -4px rgba(255,255,255,0.55), 0 3px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 0 rgba(0,0,0,0.18)'
          : 'inset 0 2px 5px rgb(0 0 0 / 0.30), inset 0 -1px 0 rgb(255 255 255 / 0.06)',
      }}
    >
      {/* Equalizador — parado quando OFF, dançando quando ON */}
      <span
        aria-hidden
        className="flex h-[20px] items-center gap-[2.5px]"
        style={{ color: on ? '#0b0d12' : undefined }}
      >
        {BARRAS.map((b, i) => (
          <span
            key={i}
            className={'el3d-bar block w-[2.5px] rounded-full ' + (on ? 'el3d-bar-on' : '')}
            style={{
              height: on ? `${b.h}px` : '3px',
              background: on ? 'currentColor' : 'rgb(var(--text-muted) / 0.55)',
              animationDelay: `${b.delay}ms`,
            }}
          />
        ))}
      </span>

      <span
        className={
          'text-[11px] font-extrabold uppercase tracking-[0.16em] transition-colors duration-300 ' +
          (on ? '' : 'text-text-muted')
        }
        style={{
          color: on ? '#0b0d12' : undefined,
          textShadow: on ? '0 1px 0 rgba(255,255,255,0.4)' : undefined,
        }}
      >
        Eleven
      </span>

      {/* Selo de estado — some a dúvida de "liguei ou não?" */}
      <span
        className={
          'rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ' +
          (on ? 'bg-black/85 text-white' : 'border border-line-strong text-text-muted/70')
        }
      >
        {on ? 'voz' : 'off'}
      </span>

      <style jsx>{`
        .el3d:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .el3d:not(:disabled):active {
          transform: translateY(1px) scale(0.98);
          transition-duration: 80ms;
        }
        .el3d:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.6);
          outline-offset: 2px;
        }
        .el3d-bar {
          transition: height 320ms cubic-bezier(0.34, 1.56, 0.44, 1), background 260ms ease;
        }
        .el3d-bar-on {
          animation: el3d-dance 900ms ease-in-out infinite alternate;
        }
        @keyframes el3d-dance {
          from {
            transform: scaleY(0.42);
          }
          to {
            transform: scaleY(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .el3d-bar-on {
            animation: none;
          }
          .el3d:hover,
          .el3d:active {
            transform: none;
          }
        }
      `}</style>
    </button>
  );
}
