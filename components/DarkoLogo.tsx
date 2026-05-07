/**
 * DarkoLogo — coelho sombrio estilo Donnie Darko.
 *
 * Silhueta com fill escuro + outline lime translúcido que aparece em dark bg.
 * Olhos lime brilhantes (glow + pulso). O outline lime e' o que da o
 * "fantasma" caracteristico do coelho.
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
          <stop offset="60%" stopColor="#b4ff00" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#3b6000" stopOpacity="0" />
        </radialGradient>
        <filter id="darko-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Silhueta do coelho — outline lime translúcido visível em dark bg */}
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
        fill="rgba(10, 10, 10, 0.85)"
        stroke="rgba(200, 255, 0, 0.55)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* Dentes / rictus inferior — pequenos riscos lime sutis */}
      <path
        d="M24 50 L28 54 L32 50 L36 54 L40 50"
        stroke="rgba(200, 255, 0, 0.35)"
        strokeWidth="0.9"
        fill="none"
        strokeLinecap="round"
      />

      {/* Olho esquerdo */}
      <g filter="url(#darko-shadow)">
        <circle
          cx="25"
          cy="40"
          r="4.8"
          fill="url(#darko-eye-glow)"
          className="darko-eye-pulse"
        />
        <circle cx="25" cy="40" r="1.7" fill="#eaff00" />
      </g>

      {/* Olho direito */}
      <g filter="url(#darko-shadow)">
        <circle
          cx="39"
          cy="40"
          r="4.8"
          fill="url(#darko-eye-glow)"
          className="darko-eye-pulse delay"
        />
        <circle cx="39" cy="40" r="1.7" fill="#eaff00" />
      </g>
    </svg>
  );
}
