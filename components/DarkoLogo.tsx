/**
 * DarkoLogo — coelho sombrio estilo Donnie Darko.
 *
 * Silhueta preta com dois olhos lime brilhantes (drop-shadow lime).
 * Vetor desenhado a mao (path SVG), sem dependencia externa.
 *
 * O "brilho" do olho e feito com um radial gradient + drop-shadow CSS.
 */
export function DarkoLogo({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="darko-eye-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#eaff00" stopOpacity="1" />
          <stop offset="60%" stopColor="#b4ff00" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#3b6000" stopOpacity="0" />
        </radialGradient>
        <filter id="darko-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Silhueta do coelho — orelhas longas afiladas + cabeca */}
      <path
        d="
          M22 4
          C21 14 20 22 22 30
          C18 30 14 32 12 36
          C10 40 10 46 13 50
          C16 54 21 57 26 58
          L38 58
          C43 57 48 54 51 50
          C54 46 54 40 52 36
          C50 32 46 30 42 30
          C44 22 43 14 42 4
          C40 8 38 18 38 28
          L26 28
          C26 18 24 8 22 4
          Z
        "
        fill="#0a0a0a"
        stroke="#1a1a1a"
        strokeWidth="1"
      />

      {/* Dentes / rictus inferior - faz parecer cranio */}
      <path
        d="M24 50 L28 54 L32 50 L36 54 L40 50"
        stroke="#1a1a1a"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
      />

      {/* Olho esquerdo - brilho lime */}
      <g filter="url(#darko-shadow)">
        <circle cx="25" cy="40" r="4.5" fill="url(#darko-eye-glow)" />
        <circle cx="25" cy="40" r="1.6" fill="#eaff00" />
      </g>

      {/* Olho direito */}
      <g filter="url(#darko-shadow)">
        <circle cx="39" cy="40" r="4.5" fill="url(#darko-eye-glow)" />
        <circle cx="39" cy="40" r="1.6" fill="#eaff00" />
      </g>
    </svg>
  );
}
