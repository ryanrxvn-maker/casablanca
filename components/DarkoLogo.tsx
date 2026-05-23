/**
 * DarkoLogo v2 — coelho sombrio com profundidade 3D real.
 *
 * Esculpido com 4 camadas:
 *  1. Halo violeta (presenca, evita verde dominante)
 *  2. Silhueta com gradiente vertical (claro no topo, escuro embaixo)
 *  3. Highlight superior (rim light) + sombra inferior interna
 *  4. Olhos lime brilhantes (a unica peca lime — pontual, intencional)
 *
 * Toda a peca esta agrupada num <g> com transform-origin pra responder
 * a animacoes externas. Os olhos ainda pulsam (mantido — assinatura).
 */
export function DarkoLogo({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const id = `darko-${Math.round(size * 7919) % 99999}`;
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
        {/* Halo de presenca (violet sutil, nao dominante) */}
        <radialGradient id={`${id}-halo`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.22" />
          <stop offset="60%" stopColor="#a78bfa" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>

        {/* Body gradient — claro no topo, escuro embaixo (volume 3D) */}
        <linearGradient id={`${id}-body`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#26262e" />
          <stop offset="60%" stopColor="#121215" />
          <stop offset="100%" stopColor="#08080a" />
        </linearGradient>

        {/* Rim light superior (luz violet vinda de cima) */}
        <linearGradient id={`${id}-rim`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.55" />
          <stop offset="40%" stopColor="#a78bfa" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>

        {/* Eye glow */}
        <radialGradient id={`${id}-eye`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#eaff00" stopOpacity="1" />
          <stop offset="60%" stopColor="#b4ff00" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#3b6000" stopOpacity="0" />
        </radialGradient>

        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Halo background */}
      <circle cx="32" cy="36" r="30" fill={`url(#${id}-halo)`} />

      {/* Silhueta principal — coelho com volume 3D */}
      <g>
        {/* Body shadow drop (atras pra dar profundidade) */}
        <path
          d="
            M22 5
            C21 14 20 22 22 30
            C18 30 13 32 11 36
            C9 41 9 47 12 51
            C16 55 21 58 26 59
            L38 59
            C43 58 48 55 52 51
            C55 47 55 41 53 36
            C51 32 46 30 42 30
            C44 22 43 14 42 5
            C40 9 38 19 38 28
            L26 28
            C26 19 24 9 22 5
            Z
          "
          fill="rgba(0,0,0,0.55)"
          transform="translate(0.6, 1.2)"
        />

        {/* Body principal com gradiente vertical */}
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
          fill={`url(#${id}-body)`}
          stroke="rgba(167, 139, 250, 0.42)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* Rim light na borda superior (luz vinda de cima) */}
        <path
          d="
            M22 4
            C21 14 20 22 22 30
            L26 28
            C26 18 24 8 22 4
            Z
          "
          fill={`url(#${id}-rim)`}
          opacity="0.7"
        />
        <path
          d="
            M42 4
            C43 14 44 22 42 30
            L38 28
            C38 18 40 8 42 4
            Z
          "
          fill={`url(#${id}-rim)`}
          opacity="0.7"
        />

        {/* Highlight central (cabeca - sutil reflexo) */}
        <ellipse cx="32" cy="34" rx="11" ry="3" fill="rgba(255,255,255,0.04)" />

        {/* Rictus inferior */}
        <path
          d="M24 50 L28 54 L32 50 L36 54 L40 50"
          stroke="rgba(167, 139, 250, 0.32)"
          strokeWidth="0.85"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* Olhos lime — UNICO ponto lime do logo, assinatura */}
      <g filter={`url(#${id}-glow)`}>
        <circle
          cx="25"
          cy="40"
          r="4.6"
          fill={`url(#${id}-eye)`}
          className="darko-eye-pulse"
        />
        <circle cx="25" cy="40" r="1.6" fill="#eaff00" />
      </g>
      <g filter={`url(#${id}-glow)`}>
        <circle
          cx="39"
          cy="40"
          r="4.6"
          fill={`url(#${id}-eye)`}
          className="darko-eye-pulse delay"
        />
        <circle cx="39" cy="40" r="1.6" fill="#eaff00" />
      </g>
    </svg>
  );
}
