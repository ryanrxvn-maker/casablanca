'use client';

/**
 * Ambient background: 3 blobs de gradiente radial que flutuam devagar.
 * Pintado atras de todo conteudo (z-index 0, fixed). Da profundidade
 * "fintech escuro" sem dominar a UI.
 *
 * Respeita prefers-reduced-motion: desliga a animacao mas mantem as
 * manchas estaticas (pra nao quebrar o look-and-feel).
 */
export function FloatingOrbs() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
    </div>
  );
}
