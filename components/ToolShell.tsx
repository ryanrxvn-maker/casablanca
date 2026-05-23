/**
 * ToolShell v2 — shell visual de cada ferramenta.
 *
 * - Eyebrow de identidade (categoria)
 * - Titulo kinetic com peso editorial
 * - Subtitulo curto, sem termos tecnicos
 * - Card 3D com tech-frame discreto
 */
export function ToolShell({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-7">
        {eyebrow ? (
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-bg-soft/60 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="section-title">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="card-3d card-pad tech-frame">{children}</div>
    </div>
  );
}
