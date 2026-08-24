/**
 * AutoEditLogo (mantém nome legado DarkoLogo pra compat).
 *
 * Renderiza a logo oficial do Auto Edit — coelho frontal em relevo 3D
 * roxo (versão robusta, 22.08.2026) — a partir do PNG transparente em
 * /auto-edit-logo@*.png.
 *
 * Escolhe a melhor resolução de origem conforme o `size` pedido.
 * A logo já traz o próprio sombreado; aqui entra só um brilho violeta
 * leve + uma sombra projetada suave via CSS drop-shadow, proporcionais
 * ao tamanho pra escalar sem perda.
 */
export function DarkoLogo({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
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
        filter: `drop-shadow(0 ${Math.max(1, size * 0.05)}px ${Math.max(3, size * 0.1)}px rgba(24, 10, 48, 0.28)) drop-shadow(0 0 ${Math.max(4, size * 0.14)}px rgba(167, 139, 250, 0.32))`,
      }}
    />
  );
}
