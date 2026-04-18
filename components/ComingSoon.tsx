/**
 * Placeholder "Em breve" — usado enquanto o motor da ferramenta
 * ainda não foi implementado. Mostra uma lista de recursos planejados.
 */
export function ComingSoon({ features }: { features: string[] }) {
  return (
    <div className="flex flex-col items-center gap-5 py-10 text-center">
      <div className="badge-online">Em desenvolvimento</div>
      <p className="max-w-md text-sm text-text-muted">
        A interface está pronta e o motor de processamento está em
        implementação. Abaixo, os recursos planejados para esta ferramenta:
      </p>
      <ul className="flex flex-col gap-2 text-sm text-white">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
