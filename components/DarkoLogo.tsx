/**
 * AutoEditLogo (mantém nome legado DarkoLogo pra não quebrar imports).
 *
 * Renderiza a logo oficial do Auto Edit — coelho frontal neon roxo —
 * a partir do PNG transparente em /auto-edit-logo@256.png.
 *
 * O glow violet característico do neon é adicionado via CSS drop-shadow,
 * permitindo que o efeito acompanhe qualquer tamanho sem perda de
 * qualidade.
 */
export function DarkoLogo({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  // Escolhe a melhor resolução de origem pro tamanho pedido (evita downscale forte)
  const src =
    size <= 32
      ? '/auto-edit-logo@32.png'
      : size <= 64
        ? '/auto-edit-logo@64.png'
        : size <= 128
          ? '/auto-edit-logo@128.png'
          : size <= 256
            ? '/auto-edit-logo@256.png'
            : '/auto-edit-logo@512.png';

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      loading="eager"
      className={'auto-edit-logo ' + className}
      style={{
        width: size,
        height: size,
        filter: `drop-shadow(0 0 ${Math.max(6, size * 0.18)}px rgba(167, 139, 250, 0.55)) drop-shadow(0 0 ${Math.max(2, size * 0.06)}px rgba(217, 70, 239, 0.45))`,
      }}
    />
  );
}
