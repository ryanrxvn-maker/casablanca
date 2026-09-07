'use client';

/**
 * PilotEconomiaBtn — o liga/desliga do MODO ECONOMIA no card do Pilot.
 *
 * Pertence à família do PilotBtn3D (mesmo tamanho, mesma forma redonda, mesmo
 * lugar na barra de ações), mas é o único botão que MUDA O MOTOR DE DISPARO —
 * então ganha um gesto próprio: uma moeda que gira de verdade (rotateY em 3D)
 * ao ligar, com a face acesa em esmeralda. Quem olha a barra sabe, sem ler
 * nada, que aquele botão foi virado.
 *
 * Só ícone, por pedido do dono: bateria em modo economia — o desenho que em
 * pt-BR já quer dizer exatamente isso. O tooltip carrega o significado inteiro,
 * porque ícone sozinho nunca explica consequência.
 *
 * Sem travessão no texto visível. Movimento respeita prefers-reduced-motion.
 */

import type { CSSProperties } from 'react';

export function PilotEconomiaBtn({
  on,
  onToggle,
  disabled = false,
  /** Por que não dá pra ligar (vai pro tooltip quando `disabled`). */
  motivoBloqueio,
  size = 36,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  motivoBloqueio?: string;
  size?: number;
}) {
  const title = on && motivoBloqueio
    ? `Modo economia LIGADO, mas este AD não cabe mais nele: ${motivoBloqueio} Clique pra desligar.`
    : disabled
    ? motivoBloqueio || 'Modo economia indisponível neste AD'
    : on
      ? 'Modo economia LIGADO: o disparo vai pelo Studio do HeyGen e renderiza cena por cena, sem consumir crédito. Trava o Avatar III e desliga o gesto. Clique pra voltar ao disparo normal.'
      : 'Modo economia: dispara pelo Studio do HeyGen e renderiza cena por cena, sem consumir crédito. Só Avatar III, sem gesto.';

  const estilo: CSSProperties = { height: size, width: size };

  return (
    <span className="eco-wrap" style={estilo}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        title={title}
        aria-label="Modo economia"
        aria-pressed={on}
        className={'eco-btn' + (on ? ' is-on' : '') + (disabled ? ' is-off-limits' : '')}
      >
        <span className={'eco-flip' + (on ? ' is-on' : '')}>
          {/* face DESLIGADA */}
          <span className="eco-side eco-front">
            <IconeBateria size={Math.round(size * 0.5)} />
          </span>
          {/* face LIGADA */}
          <span className="eco-side eco-back">
            <IconeBateria size={Math.round(size * 0.5)} carregada />
          </span>
        </span>
        {on && !disabled ? <span className="eco-halo" aria-hidden /> : null}
      </button>

      <style jsx>{`
        .eco-wrap {
          position: relative;
          display: inline-flex;
          perspective: 620px;
        }
        .eco-btn {
          position: relative;
          display: inline-flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          /* moeda: aro fino por fora, núcleo escuro por dentro */
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.015));
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            inset 0 -2px 4px rgba(0, 0, 0, 0.35),
            0 3px 10px -4px rgba(0, 0, 0, 0.5);
          transition:
            transform 220ms cubic-bezier(0.32, 0.72, 0, 1),
            box-shadow 260ms ease,
            background 260ms ease;
        }
        .eco-btn.is-on {
          background: linear-gradient(160deg, #6ee7b7 0%, #34d399 46%, #10b981 100%);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.6),
            inset 0 -2px 0 rgba(0, 0, 0, 0.24),
            0 0 32px -6px rgba(52, 211, 153, 0.85),
            0 6px 18px -8px rgba(16, 185, 129, 0.7);
        }
        .eco-btn:not(:disabled):hover {
          transform: translateY(-2px) scale(1.06);
        }
        .eco-btn:not(:disabled):active {
          transform: translateY(1px) scale(0.95);
          transition-duration: 90ms;
        }
        .eco-btn:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.6);
          outline-offset: 3px;
        }
        .eco-btn.is-off-limits {
          cursor: not-allowed;
          opacity: 0.45;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        /* a moeda vira: duas faces, uma de cada lado */
        .eco-flip {
          position: relative;
          display: block;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          transition: transform 620ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .eco-flip.is-on {
          transform: rotateY(180deg);
        }
        .eco-side {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .eco-front {
          color: rgba(255, 255, 255, 0.55);
        }
        .eco-back {
          transform: rotateY(180deg);
          color: #05271c;
        }

        /* respiro do estado ligado: lembra que o disparo mudou, sem piscar */
        .eco-halo {
          position: absolute;
          inset: -3px;
          border-radius: 999px;
          box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.55);
          animation: eco-respiro 2.6s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes eco-respiro {
          0%,
          100% {
            opacity: 0.25;
            transform: scale(1);
          }
          50% {
            opacity: 0.75;
            transform: scale(1.09);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .eco-flip {
            transition: none;
          }
          .eco-btn:hover,
          .eco-btn:active {
            transform: none;
          }
          .eco-halo {
            animation: none;
            opacity: 0.5;
          }
        }
      `}</style>
    </span>
  );
}

/** Bateria em modo economia: contorno e, quando ligada, o raio dentro. */
function IconeBateria({ size = 18, carregada = false }: { size?: number; carregada?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="7" width="16" height="10" rx="2.6" />
      <path d="M21 10.5v3" />
      {carregada ? (
        <path d="M10.9 9.4 8.4 12.6h3.2l-2.5 3.2" fill="none" strokeWidth="1.9" />
      ) : (
        <path d="M5.4 12h5.2" opacity="0.5" />
      )}
    </svg>
  );
}
