/**
 * Shell visual para cada página de ferramenta.
 * Define título, descrição e container animado.
 * Usa tech-frame pra marcar os cantos com "HUD corners" lime — premium feel.
 */
export function ToolShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <h1 className="section-title">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="card-3d card-pad tech-frame">{children}</div>
    </div>
  );
}
