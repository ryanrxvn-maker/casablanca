import { ToolHero } from './tool-kit';

/**
 * ToolShell v3 — agora usa o ToolHero do tool-kit por baixo.
 *
 * Todas as ferramentas que usam ToolShell ganham automaticamente o
 * novo header cinematográfico (com glow, grid sutil, ícone gigante
 * flutuante). O conteúdo interno (children) continua igual — cada
 * ferramenta pode ser refinada individualmente pra usar ToolStep/
 * ToolDropzone/etc do tool-kit, mas até lá já tem visual decente.
 */
export function ToolShell({
  title,
  description,
  eyebrow,
  hue,
  icon,
  className,
  hero,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  hue?: string;
  icon?: React.ReactNode;
  /** Classe extra na raiz (ex.: a pele própria de uma ferramenta). Não muda
   *  o layout: o resto da casca é o mesmo pra todas. */
  className?: string;
  /** Herói próprio no lugar do ToolHero padrão (mesmo lugar, topo da casca). */
  hero?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={'mx-auto w-full max-w-[1080px] px-5 md:px-8' + (className ? ' ' + className : '')}>
      {hero ?? (
        <ToolHero
          title={title}
          eyebrow={eyebrow}
          subtitle={description}
          hue={hue}
          icon={icon}
        />
      )}
      <div className="tool-shell-panel mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 md:p-7 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}
