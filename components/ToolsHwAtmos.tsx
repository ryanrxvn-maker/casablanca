'use client';

import { PilotSmoke } from '@/components/pilot/PilotSmoke';

/**
 * Acabamento HARDWARE nas ferramentas (o mesmo do Pilot, aprovado em 09.10).
 *
 * `toolsHwOn` diz quais rotas vestem a pele `.tools-hw` (app/tools-hw.css):
 * toda ferramenta em /tools/*, menos o Pilot, que já tem a pele e a fumaça
 * próprias (.pilot-hw). O hub /tools fica como é.
 *
 * `ToolsHwAtmos` é a fumaça da landing atrás do conteúdo: UMA só, no layout,
 * então não reinicia o WebGL a cada troca de ferramenta. Fica fora do <main>
 * (o saturate do <main> prenderia o fixed na rolagem) e começa depois da
 * sub-sidebar quando ela está aberta.
 */
export function toolsHwOn(path: string | null | undefined): boolean {
  if (!path || !path.startsWith('/tools/')) return false;
  // '/tools/pilot' é o nome da prévia de dev (/dev/redesign/pilot)
  return !path.startsWith('/tools/clickup-pilot') && path !== '/tools/pilot';
}

export function ToolsHwAtmos({ sub }: { sub: boolean }) {
  return (
    <div className={'hw-atmos' + (sub ? ' hw-atmos--sub' : '')} aria-hidden>
      <PilotSmoke className="hw-atmos__smoke" />
    </div>
  );
}
