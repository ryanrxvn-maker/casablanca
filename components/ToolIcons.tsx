/**
 * ToolIcons — SVG icons profissionais para cada ferramenta do DARKO LAB.
 *
 * Todos os icones:
 * - viewBox 24x24
 * - stroke-based (currentColor) pra herdar a cor do tema
 * - strokeWidth 1.6 (pro visual fino e tech)
 * - linejoin round + linecap round
 *
 * Cada icone reflete a funcao da ferramenta num desenho memoravel.
 */

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function baseProps(p: IconProps) {
  return {
    width: p.size ?? 22,
    height: p.size ?? 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: p.strokeWidth ?? 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: p.className,
    'aria-hidden': true,
  };
}

/** Decupagem — waveform com tesoura cortando silencios */
export function IconDecupagem(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M3 12h2M7 9v6M10 6v12M13 9v6M16 12h2M19 11v2" />
      <path d="M6 19l3-3M9 19l-3-3" opacity="0.7" />
    </svg>
  );
}

/** Camuflagem — mascara estereo / ondas espelhadas */
export function IconCamuflagem(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M4 8c0 4 2 7 8 10 6-3 8-6 8-10V6l-8-3-8 3v2z" />
      <path d="M9 11l2 2 4-4" />
    </svg>
  );
}

/** Compressor — setas convergindo ao centro, tipo "compactar" */
export function IconCompressor(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** Audio Split — waveform dividido por linhas verticais */
export function IconAudioSplit(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M3 12h1M5 10v4M7 8v8M9 6v12" />
      <path d="M12 3v18" strokeDasharray="2 2" opacity="0.6" />
      <path d="M15 6v12M17 8v8M19 10v4M21 12h-1" />
    </svg>
  );
}

/** Acelerador — duas setas de fast-forward */
export function IconAcelerador(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M4 5l8 7-8 7V5z" />
      <path d="M12 5l8 7-8 7V5z" />
    </svg>
  );
}

/** Normalizador — barras de equalizer alinhadas + linha media (volume nivelado) */
export function IconNormalizador(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      {/* linha media horizontal */}
      <path d="M3 12h18" strokeDasharray="2 2" opacity="0.6" />
      {/* barras antes da normalizacao (alturas variaveis) */}
      <path d="M5 8v8" />
      <path d="M8 6v12" />
      <path d="M11 9v6" />
      {/* divisor */}
      <path d="M13 5v14" opacity="0.4" />
      {/* barras depois (todas alinhadas em torno da linha media) */}
      <path d="M16 10v4" />
      <path d="M19 10v4" />
    </svg>
  );
}

/** Calculadora — grid + display */
export function IconCalculadora(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M7 7h10" />
      <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </svg>
  );
}

/** Auto B-Roll — film strip com particula/sparkle IA */
export function IconAutoBroll(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M3 10h18M3 14h18" />
      <path d="M7 6v12M11 6v12M15 6v12" opacity="0.4" />
      <path
        d="M18 3l0.6 1.4 1.4 0.6-1.4 0.6L18 7l-0.6-1.4L16 5l1.4-0.6L18 3z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Troca de Produto — balao de fala com setas trocando */
export function IconTrocaProduto(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M4 12c0-4 3-7 8-7 5 0 8 3 8 7 0 4-3 7-8 7-1.2 0-2.4-.2-3.5-.5L4 20l1.2-3.2C4.4 15.4 4 13.7 4 12z" />
      <path d="M9 10l6 0M9 10l2-2M9 10l2 2" />
      <path d="M15 14l-6 0M15 14l-2-2M15 14l-2 2" />
    </svg>
  );
}

/** Remover Elementos — borracha mágica (varinha + sparkle apagando) */
export function IconRemoverElementos(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      {/* Varinha em diagonal */}
      <path d="M5 19l9-9" />
      <path d="M14 10l1.5-1.5a2 2 0 012.8 2.8L16.8 12.8" />
      {/* Borracha apagando — duas linhas onduladas indicando "limpando" */}
      <path d="M3 21h6" opacity="0.5" />
      {/* Sparkle de IA no topo da varinha */}
      <path
        d="M18 4l0.5 1.2 1.2 0.5-1.2 0.5L18 7.4l-0.5-1.2L16.3 5.7l1.2-0.5L18 4z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M21 9l0.3 0.7 0.7 0.3-0.7 0.3L21 11l-0.3-0.7L20 10l0.7-0.3L21 9z"
        fill="currentColor"
        stroke="none"
        opacity="0.6"
      />
    </svg>
  );
}

/** Sparkle utilitario (pra decorar botoes "AI") */
export function IconSparkle(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path
        d="M12 3l1.5 5L18 9.5l-4.5 1.5L12 16l-1.5-5L6 9.5l4.5-1.5L12 3z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Wrench utilitario (pra decorar Base Suite) */
export function IconWrench(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.7 2.7-2.6-2.6 2.7-2.7z" />
    </svg>
  );
}
